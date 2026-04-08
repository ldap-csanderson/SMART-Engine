"""BigQuery ML helpers: model management and gap analysis pipeline."""
import hashlib
from db import (
    bq_client, db as firestore_db, PROJECT_ID, DATASET_ID, CONNECTION_ID,
    MODEL_GEMINI, MODEL_EMBEDDINGS,
    T_DATASET_ITEMS, T_DATASET_EMBEDDINGS,
    T_GAP_ANALYSIS, T_FILTER_RESULTS,
    FILTER_BATCH_SIZE,
    SEARCH_VOLUME_TYPES,
)

# ---------------------------------------------------------------------------
# BQ reference helpers
# ---------------------------------------------------------------------------

def _m(name: str) -> str:
    """Backtick-quoted model reference."""
    return f"`{PROJECT_ID}.{DATASET_ID}.{name}`"

def _t(name: str) -> str:
    """Backtick-quoted table reference."""
    return f"`{PROJECT_ID}.{DATASET_ID}.{name}`"

def _conn() -> str:
    """Backtick-quoted connection reference."""
    return f"`{PROJECT_ID}.{CONNECTION_ID}`"

def _sq(s: str) -> str:
    """Escape a string for embedding inside a BQ single-quoted literal."""
    return (
        s.replace("\\", "\\\\")
         .replace("'", "\\'")
         .replace("\n", "\\n")
         .replace("\r", "\\r")
    )

def compute_prompt_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode()).hexdigest()[:16]

def run_bq(sql: str, description: str = "") -> None:
    job = bq_client.query(sql)
    job.result()
    print(f"✅ BQ: {description or 'query complete'}")

def run_bq_scalar(sql: str) -> int:
    job = bq_client.query(sql)
    rows = list(job.result())
    return rows[0][0] if rows else 0


# ---------------------------------------------------------------------------
# Startup: create BQ ML models if not present
# ---------------------------------------------------------------------------

def create_models_if_not_exist():
    if bq_client is None:
        print("⚠️ BQ client not available — skipping model creation")
        return
    try:
        run_bq(
            f"""CREATE MODEL IF NOT EXISTS {_m(MODEL_GEMINI)}
                REMOTE WITH CONNECTION {_conn()}
                OPTIONS (ENDPOINT = 'gemini-2.5-flash')""",
            f"CREATE MODEL IF NOT EXISTS {MODEL_GEMINI}",
        )
        run_bq(
            f"""CREATE MODEL IF NOT EXISTS {_m(MODEL_EMBEDDINGS)}
                REMOTE WITH CONNECTION {_conn()}
                OPTIONS (ENDPOINT = 'text-embedding-005')""",
            f"CREATE MODEL IF NOT EXISTS {MODEL_EMBEDDINGS}",
        )
    except Exception as e:
        print(f"⚠️ Model creation encountered an error: {e}")


# ---------------------------------------------------------------------------
# Default intent prompts by dataset type
# ---------------------------------------------------------------------------

_DEFAULT_KEYWORD_PROMPT = """Analyze this search keyword and transform it into a user intent statement.

Return ONLY raw JSON (no markdown, no code blocks).

Transform the keyword into a normalized intent string with the exact format:
"I am [Persona] looking for [Specific Need]"

Guidelines:
- [Persona]: Who is the searcher? (e.g., 'a consumer', 'a shopper', 'a parent', 'an athlete', 'someone')
- [Specific Need]: What are they trying to find or accomplish? Be specific and actionable.
- Keep it concise and focused on the core intent
- Use natural, conversational language
- Capture purchase intent when present (e.g., 'shopping for', 'to buy', 'to purchase')

Examples:
- Keyword: 'best laptops' → Intent: 'I am a consumer shopping for the best laptops'
- Keyword: 'running shoes for flat feet' → Intent: 'I am an athlete looking for running shoes suitable for flat feet'
- Keyword: 'how to fix leaky faucet' → Intent: 'I am a homeowner looking for instructions to fix a leaky faucet'"""

_DEFAULT_TEXT_LIST_PROMPT = """Analyze this topic and transform it into a user intent statement.

Return ONLY raw JSON (no markdown, no code blocks).

Transform the topic into a normalized intent string with the exact format:
"I am [Persona] looking for [Specific Need]"

Guidelines:
- [Persona]: Who is interested in this topic? (e.g., 'a consumer', 'a shopper', 'someone', 'a person')
- [Specific Need]: What are they trying to find? Be specific about the product or information.
- Keep it concise and focused on the core intent
- Use natural, conversational language

Examples:
- Topic: 'cologne' → Intent: 'I am a shopper looking for cologne'
- Topic: 'non toxic cookware' → Intent: 'I am a consumer looking for non-toxic cookware'
- Topic: 'luggage' → Intent: 'I am a traveler looking for luggage'"""

_DEFAULT_AD_COPY_PROMPT = """Analyze this ad copy and describe the user intent it is targeting.

Return ONLY raw JSON (no markdown, no code blocks).

Transform the ad copy into a normalized intent string with the exact format:
"I am [Persona] looking for [Specific Need]"

Guidelines:
- Infer the target audience from the ad's messaging and offers
- [Persona]: Who is the ad targeting? (e.g., 'a consumer', 'a business owner', 'a parent')
- [Specific Need]: What need or desire does the ad address?
- Keep it concise and focused on the core intent the ad is designed to capture

Examples:
- Ad: 'Headline1: Get Car Insurance Today\\nDescription1: Compare rates from top providers.' → Intent: 'I am a driver looking for affordable car insurance'
- Ad: 'Headline1: Best Running Shoes\\nDescription1: Shop top brands with free shipping.' → Intent: 'I am an athlete shopping for running shoes'"""


def get_default_prompt_for_type(dataset_type: str) -> str:
    """Return the default intent prompt for a given dataset type."""
    if dataset_type in ("google_ads_keywords", "google_ads_keyword_planner", "google_ads_search_terms"):
        return _DEFAULT_KEYWORD_PROMPT
    elif dataset_type == "google_ads_ad_copy":
        return _DEFAULT_AD_COPY_PROMPT
    else:
        return _DEFAULT_TEXT_LIST_PROMPT


# ---------------------------------------------------------------------------
# Gap analysis pipeline (v3)
# ---------------------------------------------------------------------------

_INTENT_JSON_SUFFIX = (
    r"\n\nReturn ONLY raw JSON. Do not return this example. "
    r'Example: {\"intent_string\": \"I am a consumer shopping for the best laptops\"}'
)

_PARSE_INTENT = r"""JSON_VALUE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(ml_generate_text_llm_result, r'```json\s*', ''),
      r'\s*```', ''
    ),
    '$.intent_string'
  )"""

_LLM_OPTS = "STRUCT(250 AS max_output_tokens, 0.2 AS temperature, TRUE AS flatten_json_output)"
_EMB_OPTS = "STRUCT(TRUE AS flatten_json_output, 'SEMANTIC_SIMILARITY' AS task_type, 512 AS output_dimensionality)"


def run_gap_analysis_pipeline(
    analysis_id: str,
    source_dataset_id: str,
    target_dataset_ids: list,  # list of dataset_ids (1 for single dataset, N for group)
    source_prompt: str,
    target_prompt: str,
    source_dataset_type: str,
    min_monthly_searches: int = 1000,
) -> int:
    """
    Run the full gap analysis pipeline using v3 dataset_items / dataset_embeddings tables.

    source_dataset_id: the dataset to search (universe)
    target_dataset_ids: list of dataset IDs to compare against (existing coverage)
    source_prompt: intent prompt for source items
    target_prompt: intent prompt for target items
    source_dataset_type: used to decide whether to apply min_monthly_searches filter
    Returns the number of result rows inserted.
    """
    source_ph = compute_prompt_hash(source_prompt)
    target_ph = compute_prompt_hash(target_prompt)
    sp = _sq(source_prompt)
    tp = _sq(target_prompt)
    tid = analysis_id.replace("-", "_")

    tmp_src_intent = f"_tmp_{tid}_src_intent"
    tmp_src_emb = f"_tmp_{tid}_src_emb"
    tmp_tgt_intent = f"_tmp_{tid}_tgt_intent"

    # Build SQL IN clause for target dataset IDs
    target_ids_sql = ", ".join(f"'{did}'" for did in target_dataset_ids)

    # Step 1: source item intent strings
    # Apply min_monthly_searches filter only for types that have search volume
    search_vol_filter = ""
    if source_dataset_type in SEARCH_VOLUME_TYPES and min_monthly_searches > 0:
        search_vol_filter = f"AND avg_monthly_searches >= {min_monthly_searches}"

    run_bq(f"""
        CREATE OR REPLACE TABLE {_t(tmp_src_intent)} AS
        WITH llm AS (
          SELECT * FROM ML.GENERATE_TEXT(
            MODEL {_m(MODEL_GEMINI)},
            (
              SELECT DISTINCT
                item_text,
                CONCAT('{sp}', '\\n\\nKeyword: ', item_text, '{_INTENT_JSON_SUFFIX}') AS prompt
              FROM {_t(T_DATASET_ITEMS)}
              WHERE dataset_id = '{source_dataset_id}'
                {search_vol_filter}
            ),
            {_LLM_OPTS}
          )
        )
        SELECT item_text, {_PARSE_INTENT} AS intent_string FROM llm
    """, "Step 1: source item intents")

    # Step 2: source item embeddings
    run_bq(f"""
        CREATE OR REPLACE TABLE {_t(tmp_src_emb)} AS
        SELECT item_text, intent_string, ml_generate_embedding_result AS embedding
        FROM ML.GENERATE_EMBEDDING(
          MODEL {_m(MODEL_EMBEDDINGS)},
          (
            SELECT DISTINCT item_text, intent_string, intent_string AS content
            FROM {_t(tmp_src_intent)}
            WHERE intent_string IS NOT NULL
          ),
          {_EMB_OPTS}
        )
    """, "Step 2: source item embeddings")

    # Step 3a: count uncached target items
    uncached = run_bq_scalar(f"""
        SELECT COUNT(DISTINCT di.item_text)
        FROM {_t(T_DATASET_ITEMS)} di
        LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
          ON di.item_text = de.item_text
          AND di.dataset_id = de.dataset_id
          AND de.prompt_hash = '{target_ph}'
        WHERE di.dataset_id IN ({target_ids_sql})
          AND de.item_text IS NULL
    """)
    print(f"📊 Uncached target items: {uncached}")

    if uncached > 0:
        # Step 3b: target item intent strings for uncached items
        run_bq(f"""
            CREATE OR REPLACE TABLE {_t(tmp_tgt_intent)} AS
            WITH llm AS (
              SELECT * FROM ML.GENERATE_TEXT(
                MODEL {_m(MODEL_GEMINI)},
                (
                  SELECT DISTINCT di.item_text,
                    CONCAT('{tp}', '\\n\\nTopic: ', di.item_text, '{_INTENT_JSON_SUFFIX}') AS prompt
                  FROM {_t(T_DATASET_ITEMS)} di
                  LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                    ON di.item_text = de.item_text
                    AND di.dataset_id = de.dataset_id
                    AND de.prompt_hash = '{target_ph}'
                  WHERE di.dataset_id IN ({target_ids_sql})
                    AND de.item_text IS NULL
                ),
                {_LLM_OPTS}
              )
            )
            SELECT item_text, {_PARSE_INTENT} AS intent_string FROM llm
        """, "Step 3b: target item intents for uncached items")

        # Step 3c: insert new embeddings into cache (one row per dataset_id × item_text)
        # We insert for each target dataset separately to maintain dataset_id keying
        for did in target_dataset_ids:
            run_bq(f"""
                INSERT INTO {_t(T_DATASET_EMBEDDINGS)}
                  (dataset_id, item_text, intent_string, embedding, prompt_hash, embedded_at)
                SELECT '{did}' AS dataset_id,
                       item_text, intent_string, ml_generate_embedding_result AS embedding,
                       '{target_ph}' AS prompt_hash, CURRENT_TIMESTAMP() AS embedded_at
                FROM ML.GENERATE_EMBEDDING(
                  MODEL {_m(MODEL_EMBEDDINGS)},
                  (
                    SELECT DISTINCT t.item_text, t.intent_string, t.intent_string AS content
                    FROM {_t(tmp_tgt_intent)} t
                    INNER JOIN {_t(T_DATASET_ITEMS)} di
                      ON t.item_text = di.item_text AND di.dataset_id = '{did}'
                    WHERE t.intent_string IS NOT NULL
                  ),
                  {_EMB_OPTS}
                )
                WHERE item_text NOT IN (
                  SELECT item_text
                  FROM {_t(T_DATASET_EMBEDDINGS)}
                  WHERE dataset_id = '{did}' AND prompt_hash = '{target_ph}'
                )
            """, f"Step 3c: populate target embeddings cache (dataset_id={did})")

    # Step 4: VECTOR_SEARCH against all target embeddings and insert results
    run_bq(f"""
        INSERT INTO {_t(T_GAP_ANALYSIS)}
          (analysis_id, created_at, keyword_text, keyword_intent,
           closest_portfolio_item, closest_portfolio_intent,
           semantic_distance, avg_monthly_searches)
        WITH vs AS (
          SELECT
            query.item_text AS keyword_text,
            query.intent_string AS keyword_intent,
            base.item_text AS target_item,
            base.intent_string AS target_intent,
            distance AS semantic_distance
          FROM VECTOR_SEARCH(
            (
              SELECT *
              FROM {_t(T_DATASET_EMBEDDINGS)}
              WHERE dataset_id IN ({target_ids_sql}) AND prompt_hash = '{target_ph}'
            ),
            'embedding',
            (SELECT item_text, intent_string, embedding FROM {_t(tmp_src_emb)}),
            top_k => 3,
            distance_type => 'COSINE',
            options => '{{"use_brute_force": true}}'
          )
        )
        SELECT
          '{analysis_id}' AS analysis_id,
          CURRENT_TIMESTAMP() AS created_at,
          vs.keyword_text,
          vs.keyword_intent,
          vs.target_item AS closest_portfolio_item,
          vs.target_intent AS closest_portfolio_intent,
          vs.semantic_distance,
          kw.avg_monthly_searches
        FROM vs
        LEFT JOIN (
          SELECT item_text, MAX(avg_monthly_searches) AS avg_monthly_searches
          FROM {_t(T_DATASET_ITEMS)}
          WHERE dataset_id = '{source_dataset_id}'
          GROUP BY item_text
        ) kw ON vs.keyword_text = kw.item_text
    """, "Step 4: insert gap analysis results (VECTOR_SEARCH)")

    # Count distinct source items analyzed
    count = run_bq_scalar(f"""
        SELECT COUNT(DISTINCT keyword_text) FROM {_t(T_GAP_ANALYSIS)} WHERE analysis_id = '{analysis_id}'
    """)

    # Step 5: cleanup temp tables (best effort)
    for tmp in [tmp_src_intent, tmp_src_emb, tmp_tgt_intent]:
        try:
            run_bq(f"DROP TABLE IF EXISTS {_t(tmp)}", f"Cleanup {tmp}")
        except Exception:
            pass

    return count


# ---------------------------------------------------------------------------
# Filter execution pipeline (unchanged from v2)
# ---------------------------------------------------------------------------

_FILTER_LLM_OPTS = "STRUCT(100 AS max_output_tokens, 0.1 AS temperature, TRUE AS flatten_json_output)"


def run_filter_pipeline(
    execution_id: str,
    analysis_id: str,
    filter_snapshot: dict,
    on_batch_complete=None,
) -> int:
    """
    Run LLM-based boolean filter over all keywords in a gap analysis.

    Processes keywords in batches of FILTER_BATCH_SIZE to stay within
    BigQuery on-demand pricing CPU/bytes ratio limits.

    filter_snapshot must have: label (str), text (str)
    on_batch_complete: optional callable(rows_done: int) for progress updates

    Returns the number of rows inserted into filter_results.
    """
    label = filter_snapshot["label"]
    label_sql = _sq(label)

    prompt_prefix = (
        f"{filter_snapshot['text']}\n\n"
        f"Evaluate this keyword.\n\n"
        f"Return ONLY raw JSON (no markdown, no code blocks).\n"
        f'JSON: {{"{label}": true/false, "confidence": "high/medium/low"}}\n\n'
        f"Keyword: "
    )
    escaped_prefix = _sq(prompt_prefix)
    prompt_concat = f"CONCAT('{escaped_prefix}', keyword_text)"

    def _parse(field: str) -> str:
        return (
            f"JSON_VALUE(\n"
            f"              REGEXP_REPLACE(\n"
            f"                REGEXP_REPLACE(ml_generate_text_llm_result, r'```json\\s*', ''),\n"
            f"                r'\\s*```', ''\n"
            f"              ),\n"
            f"              '$.{field}'\n"
            f"            )"
        )

    total_keywords = run_bq_scalar(f"""
        SELECT COUNT(DISTINCT keyword_text)
        FROM {_t(T_GAP_ANALYSIS)}
        WHERE analysis_id = '{analysis_id}'
    """)
    print(f"🔢 Filter '{label}': {total_keywords} keywords to process in batches of {FILTER_BATCH_SIZE}")

    if total_keywords == 0:
        print(f"⚠️ No keywords found for analysis {analysis_id} — nothing to filter")
        return 0

    total_inserted = 0
    num_batches = (total_keywords + FILTER_BATCH_SIZE - 1) // FILTER_BATCH_SIZE

    for batch_num in range(num_batches):
        offset = batch_num * FILTER_BATCH_SIZE
        limit = offset + FILTER_BATCH_SIZE
        print(f"  Batch {batch_num + 1}/{num_batches}: rows {offset + 1}–{min(limit, total_keywords)}")

        run_bq(f"""
            INSERT INTO {_t(T_FILTER_RESULTS)}
              (execution_id, analysis_id, keyword_text, label, result, confidence, created_at)
            WITH ranked AS (
              SELECT
                keyword_text,
                ROW_NUMBER() OVER (ORDER BY keyword_text) AS rn
              FROM (
                SELECT DISTINCT keyword_text
                FROM {_t(T_GAP_ANALYSIS)}
                WHERE analysis_id = '{analysis_id}'
              )
            ),
            batch AS (
              SELECT keyword_text
              FROM ranked
              WHERE rn > {offset} AND rn <= {limit}
            ),
            llm AS (
              SELECT * FROM ML.GENERATE_TEXT(
                MODEL {_m(MODEL_GEMINI)},
                (
                  SELECT
                    keyword_text,
                    {prompt_concat} AS prompt
                  FROM batch
                ),
                {_FILTER_LLM_OPTS}
              )
            ),
            parsed AS (
              SELECT
                keyword_text,
                CAST({_parse(label)} AS BOOL) AS result,
                {_parse('confidence')} AS confidence
              FROM llm
            )
            SELECT
              '{execution_id}' AS execution_id,
              '{analysis_id}' AS analysis_id,
              keyword_text,
              '{label_sql}' AS label,
              result,
              confidence,
              CURRENT_TIMESTAMP() AS created_at
            FROM parsed
        """, f"Filter '{label}' batch {batch_num + 1}/{num_batches}")

        total_inserted += min(FILTER_BATCH_SIZE, total_keywords - offset)

        if on_batch_complete:
            try:
                on_batch_complete(total_inserted)
            except Exception as e:
                print(f"⚠️ on_batch_complete callback error: {e}")

    count = run_bq_scalar(f"""
        SELECT COUNT(*) FROM {_t(T_FILTER_RESULTS)}
        WHERE execution_id = '{execution_id}'
    """)
    print(f"✅ Filter '{label}' complete: {count} rows inserted")
    return count
