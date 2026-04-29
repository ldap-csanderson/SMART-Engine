"""BigQuery ML helpers: model management and gap analysis pipeline."""
import hashlib
import time
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
# Vector index management
# ---------------------------------------------------------------------------

def get_vector_index_coverage() -> int:
    """Return the vector index coverage % (0–100) for dataset_embeddings, or -1 if no index exists."""
    if bq_client is None:
        return -1
    try:
        rows = list(bq_client.query(f"""
            SELECT CAST(COALESCE(MAX(coverage_percentage), -1) AS INT64)
            FROM `{PROJECT_ID}.{DATASET_ID}.INFORMATION_SCHEMA.VECTOR_INDEXES`
            WHERE table_name = '{T_DATASET_EMBEDDINGS}'
              AND index_name = 'idx_dataset_embeddings_embedding'
        """).result())
        val = rows[0][0] if rows else -1
        return int(val) if val is not None else -1
    except Exception as e:
        print(f"⚠️ Could not check vector index coverage: {e}")
        return -1


def create_vector_index_if_not_exist():
    """Initiate creation of a persistent ANN vector index on dataset_embeddings.

    BQ builds the index asynchronously in the background — this function returns
    immediately. The index is required for VECTOR_SEARCH on large datasets
    (>10M rows) to avoid BQ shuffle memory limits on on-demand pricing.

    num_lists=2000 is appropriate for ~16M rows (sqrt(16M) ≈ 4000, we use half).
    """
    if bq_client is None:
        print("⚠️ BQ client not available — skipping vector index creation")
        return
    try:
        run_bq(
            f"""CREATE VECTOR INDEX IF NOT EXISTS idx_dataset_embeddings_embedding
                ON {_t(T_DATASET_EMBEDDINGS)}(embedding)
                OPTIONS(distance_type='COSINE', index_type='IVF',
                        ivf_options='{{"num_lists": 2000}}')""",
            "CREATE VECTOR INDEX IF NOT EXISTS on dataset_embeddings(embedding)",
        )
        coverage = get_vector_index_coverage()
        if coverage >= 0:
            print(f"📊 Vector index coverage: {coverage}%")
        else:
            print("⏳ Vector index building in the background...")
    except Exception as e:
        print(f"⚠️ Vector index creation encountered an error: {e}")


def _wait_for_vector_index(min_coverage: int = 99, timeout_seconds: int = 10800) -> int:
    """Poll until the vector index reaches min_coverage% or timeout_seconds elapses.

    Returns the final coverage % (may be < min_coverage if timed out).
    Logs progress every 2 minutes.
    """
    poll_interval = 120  # seconds
    waited = 0
    while waited < timeout_seconds:
        coverage = get_vector_index_coverage()
        if coverage < 0:
            # No index at all — try to create it and then wait
            print("⚠️ No vector index found — creating now (VECTOR_SEARCH may fail on large datasets without it)")
            create_vector_index_if_not_exist()
            time.sleep(poll_interval)
            waited += poll_interval
            continue
        if coverage >= min_coverage:
            print(f"✅ Vector index ready (coverage={coverage}%)")
            return coverage
        print(f"⏳ Vector index building: {coverage}% coverage — waiting {poll_interval}s...")
        time.sleep(poll_interval)
        waited += poll_interval
    coverage = get_vector_index_coverage()
    print(f"⚠️ Vector index timeout after {timeout_seconds}s — current coverage={coverage}%. Proceeding anyway.")
    return coverage


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
    if dataset_type in (
        "google_ads_keywords",
        "google_ads_keyword_planner",
        "google_ads_search_terms",
        "google_ads_account_keywords",
    ):
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

# Special prompt_hash used when intent normalization is disabled (items embedded directly).
_DIRECT_PROMPT_HASH = "__direct__"


def run_gap_analysis_pipeline(
    analysis_id: str,
    source_dataset_ids: list,  # list of dataset_ids (1 for single dataset, N for group)
    target_dataset_ids: list,  # list of dataset_ids (1 for single dataset, N for group)
    source_prompt: str,
    target_prompt: str,
    source_dataset_type: str,
    min_monthly_searches: int = 1000,
    use_intent_normalization: bool = True,
) -> int:
    """
    Run the full gap analysis pipeline using v3 dataset_items / dataset_embeddings tables.

    source_dataset_ids: list of dataset IDs to search (universe) — 1 for single dataset, N for group
    target_dataset_ids: list of dataset IDs to compare against (existing coverage)
    source_prompt: intent prompt for source items (used only when use_intent_normalization=True)
    target_prompt: intent prompt for target items (used only when use_intent_normalization=True)
    source_dataset_type: used to decide whether to apply min_monthly_searches filter
    use_intent_normalization: when False, items are embedded directly without LLM normalization
    Returns the number of result rows inserted.
    """
    tid = analysis_id.replace("-", "_")
    tmp_src_intent = f"_tmp_{tid}_src_intent"
    tmp_src_emb = f"_tmp_{tid}_src_emb"
    tmp_tgt_intent = f"_tmp_{tid}_tgt_intent"

    # Build SQL IN clauses for source and target dataset IDs
    source_ids_sql = ", ".join(f"'{did}'" for did in source_dataset_ids)
    target_ids_sql = ", ".join(f"'{did}'" for did in target_dataset_ids)

    # Apply min_monthly_searches filter only for types that have search volume
    search_vol_filter = ""
    if source_dataset_type in SEARCH_VOLUME_TYPES and min_monthly_searches > 0:
        search_vol_filter = f"AND avg_monthly_searches >= {min_monthly_searches}"

    if use_intent_normalization:
        source_ph = compute_prompt_hash(source_prompt)
        target_ph = compute_prompt_hash(target_prompt)
        sp = _sq(source_prompt)
        tp = _sq(target_prompt)

        # Step 1: source item intent strings via LLM
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
                  WHERE dataset_id IN ({source_ids_sql})
                    {search_vol_filter}
                ),
                {_LLM_OPTS}
              )
            )
            SELECT item_text, {_PARSE_INTENT} AS intent_string FROM llm
        """, "Step 1: source item intents")

        # Step 2: source item embeddings (embed intent_string)
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
            # Step 3b: target item intent strings for uncached items via LLM
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

            # Step 3c: insert new embeddings into cache (intent_string as content)
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

    else:
        # Direct mode: skip LLM entirely, embed item_text directly for source and target.
        # Target embeddings are cached under _DIRECT_PROMPT_HASH so repeated runs reuse the cache.
        source_ph = target_ph = _DIRECT_PROMPT_HASH

        # Step 2 (direct): embed source item_text directly (no intent step)
        run_bq(f"""
            CREATE OR REPLACE TABLE {_t(tmp_src_emb)} AS
            SELECT item_text, CAST(NULL AS STRING) AS intent_string, ml_generate_embedding_result AS embedding
            FROM ML.GENERATE_EMBEDDING(
              MODEL {_m(MODEL_EMBEDDINGS)},
              (
                SELECT DISTINCT item_text, item_text AS content
                FROM {_t(T_DATASET_ITEMS)}
                WHERE dataset_id IN ({source_ids_sql})
                  {search_vol_filter}
              ),
              {_EMB_OPTS}
            )
        """, "Step 2 (direct): source item embeddings")

        # Step 3a (direct): count uncached target items
        uncached = run_bq_scalar(f"""
            SELECT COUNT(DISTINCT di.item_text)
            FROM {_t(T_DATASET_ITEMS)} di
            LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
              ON di.item_text = de.item_text
              AND di.dataset_id = de.dataset_id
              AND de.prompt_hash = '{_DIRECT_PROMPT_HASH}'
            WHERE di.dataset_id IN ({target_ids_sql})
              AND de.item_text IS NULL
        """)
        print(f"📊 Uncached target items (direct): {uncached}")

        if uncached > 0:
            # Step 3b (direct): embed target item_text directly and cache
            for did in target_dataset_ids:
                run_bq(f"""
                    INSERT INTO {_t(T_DATASET_EMBEDDINGS)}
                      (dataset_id, item_text, intent_string, embedding, prompt_hash, embedded_at)
                    SELECT '{did}' AS dataset_id,
                           item_text, CAST(NULL AS STRING) AS intent_string,
                           ml_generate_embedding_result AS embedding,
                           '{_DIRECT_PROMPT_HASH}' AS prompt_hash,
                           CURRENT_TIMESTAMP() AS embedded_at
                    FROM ML.GENERATE_EMBEDDING(
                      MODEL {_m(MODEL_EMBEDDINGS)},
                      (
                        SELECT DISTINCT di.item_text, di.item_text AS content
                        FROM {_t(T_DATASET_ITEMS)} di
                        LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                          ON di.item_text = de.item_text
                          AND di.dataset_id = de.dataset_id
                          AND de.prompt_hash = '{_DIRECT_PROMPT_HASH}'
                        WHERE di.dataset_id = '{did}'
                          AND de.item_text IS NULL
                      ),
                      {_EMB_OPTS}
                    )
                """, f"Step 3b (direct): cache target embeddings (dataset_id={did})")

    # Step 4: VECTOR_SEARCH in batches to avoid shuffle memory limits on large datasets.
    # Brute-force cross-products on 1M+ items can exceed BQ's on-demand shuffle quota.
    # Requires a persistent VECTOR INDEX on dataset_embeddings(embedding) to avoid shuffle OOM.
    _VS_BATCH = 100_000

    # Wait for the vector index to be ready before running VECTOR_SEARCH.
    # Without it, BQ builds a temporary ANN index at query time which exceeds on-demand
    # shuffle memory limits for tables with >10M rows.
    print("⏳ Checking vector index readiness before VECTOR_SEARCH...")
    _wait_for_vector_index(min_coverage=99, timeout_seconds=10800)

    src_count = run_bq_scalar(f"SELECT COUNT(*) FROM {_t(tmp_src_emb)}")
    num_vs_batches = max(1, (src_count + _VS_BATCH - 1) // _VS_BATCH)
    print(f"📊 Vector search: {src_count} source items → {num_vs_batches} batch(es) of {_VS_BATCH}")

    for vs_batch in range(num_vs_batches):
        vs_offset = vs_batch * _VS_BATCH
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
                (
                  SELECT item_text, intent_string, embedding
                  FROM {_t(tmp_src_emb)}
                  LIMIT {_VS_BATCH} OFFSET {vs_offset}
                ),
                top_k => 3,
                distance_type => 'COSINE',
                options => '{{"use_brute_force": false}}'
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
              WHERE dataset_id IN ({source_ids_sql})
              GROUP BY item_text
            ) kw ON vs.keyword_text = kw.item_text
        """, f"Step 4 batch {vs_batch + 1}/{num_vs_batches}: vector search ({vs_offset}–{vs_offset + _VS_BATCH})")

    # Count distinct source items analyzed
    count = run_bq_scalar(f"""
        SELECT COUNT(DISTINCT keyword_text) FROM {_t(T_GAP_ANALYSIS)} WHERE analysis_id = '{analysis_id}'
    """)

    # Step 5: cleanup temp tables (best effort; some may not exist in direct mode)
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
    min_distance: float = 0.0,
) -> int:
    """
    Run LLM-based boolean filter over all keywords in a gap analysis.

    Processes keywords in batches of FILTER_BATCH_SIZE to stay within
    BigQuery on-demand pricing CPU/bytes ratio limits.

    filter_snapshot must have: label (str), text (str)
    on_batch_complete: optional callable(rows_done: int) for progress updates
    min_distance: only evaluate keywords whose MIN(semantic_distance) >= this value.
                  Skips items that are already close to the target (well-covered).

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

    distance_filter = f"AND MIN(semantic_distance) >= {min_distance}" if min_distance > 0.0 else ""
    total_keywords = run_bq_scalar(f"""
        SELECT COUNT(*)
        FROM (
          SELECT keyword_text
          FROM {_t(T_GAP_ANALYSIS)}
          WHERE analysis_id = '{analysis_id}'
          GROUP BY keyword_text
          HAVING 1=1 {distance_filter}
        )
    """)
    print(f"🔢 Filter '{label}': {total_keywords} keywords to process in batches of {FILTER_BATCH_SIZE}"
          + (f" (min_distance={min_distance})" if min_distance > 0.0 else ""))

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
                SELECT keyword_text
                FROM {_t(T_GAP_ANALYSIS)}
                WHERE analysis_id = '{analysis_id}'
                GROUP BY keyword_text
                HAVING 1=1 {distance_filter}
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
