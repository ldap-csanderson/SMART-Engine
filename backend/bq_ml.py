"""BigQuery ML helpers: model management and gap analysis pipeline."""
import hashlib
from db import (
    bq_client, db as firestore_db, PROJECT_ID, DATASET_ID, CONNECTION_ID,
    MODEL_GEMINI, MODEL_EMBEDDINGS,
    T_RESULTS, T_PORTFOLIO_ITEMS, T_PORTFOLIO_EMBEDDINGS, 
    T_PORTFOLIO_ITEMS_V2, T_PORTFOLIO_EMBEDDINGS_V2,
    T_GAP_ANALYSIS, T_FILTER_RESULTS,
    FILTER_BATCH_SIZE,
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
# Portfolio sync: Firestore → BQ (runtime, on-demand)
# ---------------------------------------------------------------------------

def _sync_portfolio_items(portfolio_id: str) -> int:
    """
    Read portfolio items from Firestore and upsert them into portfolio_items_v2.
    Firestore is the source of truth; BQ is a runtime cache.
    Returns the number of items synced.
    """
    if not firestore_db:
        raise RuntimeError("Firestore client not available")

    doc = firestore_db.collection("portfolios").document(portfolio_id).get()
    if not doc.exists:
        raise ValueError(f"Portfolio {portfolio_id} not found in Firestore")

    items = doc.to_dict().get("items", [])
    if not items:
        raise ValueError(f"Portfolio {portfolio_id} has no items")

    print(f"📋 Syncing {len(items)} portfolio items to BQ (portfolio_id={portfolio_id})")

    # Delete existing rows for this portfolio, then re-insert from Firestore
    bq_client.query(
        f"DELETE FROM {_t(T_PORTFOLIO_ITEMS_V2)} WHERE portfolio_id = '{portfolio_id}'"
    ).result()

    # BQ INSERT VALUES has a limit of ~1MB per query; batch in chunks of 500
    chunk_size = 500
    total_inserted = 0
    for i in range(0, len(items), chunk_size):
        chunk = items[i:i + chunk_size]
        values = ", ".join(
            f"('{portfolio_id}', '{_sq(item)}', CURRENT_TIMESTAMP())"
            for item in chunk
            if item and item.strip()
        )
        if values:
            bq_client.query(
                f"INSERT INTO {_t(T_PORTFOLIO_ITEMS_V2)} "
                f"(portfolio_id, item_text, added_at) VALUES {values}"
            ).result()
            total_inserted += len(chunk)

    print(f"✅ Synced {total_inserted} portfolio items to BQ (portfolio_id={portfolio_id})")
    return total_inserted


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
# Gap analysis pipeline
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
    report_id: str,
    portfolio_id: str,
    keyword_prompt: str,
    portfolio_prompt: str,
    min_monthly_searches: int = 1000,
) -> int:
    """
    Run the full 5-step gap analysis pipeline using v2 tables with portfolio_id.
    Returns the number of result rows inserted.
    Raises on any BQ error.
    """
    ph = compute_prompt_hash(portfolio_prompt)
    kp = _sq(keyword_prompt)
    pp = _sq(portfolio_prompt)
    tid = analysis_id.replace("-", "_")  # BQ table names can't have hyphens

    tmp_kw_intent = f"_tmp_{tid}_kw_intent"
    tmp_kw_emb = f"_tmp_{tid}_kw_emb"
    tmp_pi_intent = f"_tmp_{tid}_pi_intent"

    # Step 0: sync portfolio items from Firestore → BQ (source of truth is Firestore)
    _sync_portfolio_items(portfolio_id)

    # Step 1: keyword intent strings
    run_bq(f"""
        CREATE OR REPLACE TABLE {_t(tmp_kw_intent)} AS
        WITH llm AS (
          SELECT * FROM ML.GENERATE_TEXT(
            MODEL {_m(MODEL_GEMINI)},
            (
              SELECT DISTINCT
                keyword_text,
                CONCAT('{kp}', '\\n\\nKeyword: ', keyword_text, '{_INTENT_JSON_SUFFIX}') AS prompt
              FROM {_t(T_RESULTS)}
              WHERE run_id = '{report_id}'
                AND avg_monthly_searches >= {min_monthly_searches}
            ),
            {_LLM_OPTS}
          )
        )
        SELECT keyword_text, {_PARSE_INTENT} AS intent_string FROM llm
    """, "Step 1: keyword intents")

    # Step 2: keyword embeddings
    run_bq(f"""
        CREATE OR REPLACE TABLE {_t(tmp_kw_emb)} AS
        SELECT keyword_text, intent_string, ml_generate_embedding_result AS embedding
        FROM ML.GENERATE_EMBEDDING(
          MODEL {_m(MODEL_EMBEDDINGS)},
          (
            SELECT DISTINCT keyword_text, intent_string, intent_string AS content
            FROM {_t(tmp_kw_intent)}
            WHERE intent_string IS NOT NULL
          ),
          {_EMB_OPTS}
        )
    """, "Step 2: keyword embeddings")

    # Step 3a: count uncached portfolio items FOR THIS PORTFOLIO
    uncached = run_bq_scalar(f"""
        SELECT COUNT(DISTINCT pi.item_text)
        FROM {_t(T_PORTFOLIO_ITEMS_V2)} pi
        LEFT JOIN {_t(T_PORTFOLIO_EMBEDDINGS_V2)} pe
          ON pi.item_text = pe.item_text 
          AND pi.portfolio_id = pe.portfolio_id
          AND pe.prompt_hash = '{ph}'
        WHERE pi.portfolio_id = '{portfolio_id}'
          AND pe.item_text IS NULL
    """)
    print(f"📊 Uncached portfolio items (portfolio_id={portfolio_id}): {uncached}")

    if uncached > 0:
        # Step 3b: portfolio intent strings for uncached items
        run_bq(f"""
            CREATE OR REPLACE TABLE {_t(tmp_pi_intent)} AS
            WITH llm AS (
              SELECT * FROM ML.GENERATE_TEXT(
                MODEL {_m(MODEL_GEMINI)},
                (
                  SELECT DISTINCT pi.item_text,
                    CONCAT('{pp}', '\\n\\nTopic: ', pi.item_text, '{_INTENT_JSON_SUFFIX}') AS prompt
                  FROM {_t(T_PORTFOLIO_ITEMS_V2)} pi
                  LEFT JOIN {_t(T_PORTFOLIO_EMBEDDINGS_V2)} pe
                    ON pi.item_text = pe.item_text 
                    AND pi.portfolio_id = pe.portfolio_id
                    AND pe.prompt_hash = '{ph}'
                  WHERE pi.portfolio_id = '{portfolio_id}'
                    AND pe.item_text IS NULL
                ),
                {_LLM_OPTS}
              )
            )
            SELECT item_text, {_PARSE_INTENT} AS intent_string FROM llm
        """, "Step 3b: portfolio intents for uncached items")

        # Step 3c: insert new embeddings into v2 cache.
        # Re-check at write time (NOT IN subquery) to prevent duplicate rows if two
        # analyses for the same portfolio race past the step-3a uncached check simultaneously.
        run_bq(f"""
            INSERT INTO {_t(T_PORTFOLIO_EMBEDDINGS_V2)}
              (portfolio_id, item_text, intent_string, embedding, prompt_hash, embedded_at)
            SELECT '{portfolio_id}' AS portfolio_id,
                   item_text, intent_string, ml_generate_embedding_result AS embedding,
                   '{ph}' AS prompt_hash, CURRENT_TIMESTAMP() AS embedded_at
            FROM ML.GENERATE_EMBEDDING(
              MODEL {_m(MODEL_EMBEDDINGS)},
              (
                SELECT DISTINCT item_text, intent_string, intent_string AS content
                FROM {_t(tmp_pi_intent)}
                WHERE intent_string IS NOT NULL
              ),
              {_EMB_OPTS}
            )
            WHERE item_text NOT IN (
              SELECT item_text
              FROM {_t(T_PORTFOLIO_EMBEDDINGS_V2)}
              WHERE portfolio_id = '{portfolio_id}' AND prompt_hash = '{ph}'
            )
        """, "Step 3c: populate portfolio embeddings cache (v2)")

    # Step 4: compute top-3 distances via VECTOR_SEARCH (exact/brute-force) and insert results.
    # use_brute_force=TRUE bypasses the IVF index, which produces poor results when the
    # per-portfolio subset is small relative to the full embeddings table. Exact search is
    # safe here because portfolio size is at most a few thousand items, and the keyword set
    # is bounded by min_monthly_searches (≤100K unique keywords per BQ VECTOR_SEARCH limit).
    run_bq(f"""
        INSERT INTO {_t(T_GAP_ANALYSIS)}
          (analysis_id, created_at, keyword_text, keyword_intent,
           closest_portfolio_item, closest_portfolio_intent,
           semantic_distance, avg_monthly_searches)
        WITH vs AS (
          SELECT
            query.keyword_text,
            query.intent_string AS keyword_intent,
            base.item_text AS portfolio_item,
            base.intent_string AS portfolio_intent,
            distance AS semantic_distance
          FROM VECTOR_SEARCH(
            (
              SELECT *
              FROM {_t(T_PORTFOLIO_EMBEDDINGS_V2)}
              WHERE portfolio_id = '{portfolio_id}' AND prompt_hash = '{ph}'
            ),
            'embedding',
            (SELECT keyword_text, intent_string, embedding FROM {_t(tmp_kw_emb)}),
            top_k => 3,
            distance_type => 'COSINE',
            options => '{{"use_brute_force": true}}'
          )
          INNER JOIN {_t(T_PORTFOLIO_ITEMS_V2)} pi
            ON base.item_text = pi.item_text AND base.portfolio_id = pi.portfolio_id
        )
        SELECT
          '{analysis_id}' AS analysis_id,
          CURRENT_TIMESTAMP() AS created_at,
          vs.keyword_text,
          vs.keyword_intent,
          vs.portfolio_item AS closest_portfolio_item,
          vs.portfolio_intent AS closest_portfolio_intent,
          vs.semantic_distance,
          kw.avg_monthly_searches
        FROM vs
        LEFT JOIN (
          SELECT keyword_text, MAX(avg_monthly_searches) AS avg_monthly_searches
          FROM {_t(T_RESULTS)}
          WHERE run_id = '{report_id}'
          GROUP BY keyword_text
        ) kw ON vs.keyword_text = kw.keyword_text
    """, "Step 4: insert gap analysis results (VECTOR_SEARCH)")

    # Count distinct keywords analyzed (up to 3 rows per keyword now)
    count = run_bq_scalar(f"""
        SELECT COUNT(DISTINCT keyword_text) FROM {_t(T_GAP_ANALYSIS)} WHERE analysis_id = '{analysis_id}'
    """)

    # Step 5: cleanup temp tables (best effort — leave on failure for debugging)
    for tmp in [tmp_kw_intent, tmp_kw_emb, tmp_pi_intent]:
        try:
            run_bq(f"DROP TABLE IF EXISTS {_t(tmp)}", f"Cleanup {tmp}")
        except Exception:
            pass

    return count


# ---------------------------------------------------------------------------
# Filter execution pipeline
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
    label_sql = _sq(label)  # label safe for BQ single-quoted string

    # Build the full prompt text in Python first, then escape once with _sq().
    # The LLM is asked to return: {"<label>": true/false, "confidence": "high/medium/low"}
    prompt_prefix = (
        f"{filter_snapshot['text']}\n\n"
        f"Evaluate this keyword.\n\n"
        f"Return ONLY raw JSON (no markdown, no code blocks).\n"
        f'JSON: {{"{label}": true/false, "confidence": "high/medium/low"}}\n\n'
        f"Keyword: "
    )
    escaped_prefix = _sq(prompt_prefix)

    # CONCAT appends the keyword_text to the static prompt prefix
    prompt_concat = f"CONCAT('{escaped_prefix}', keyword_text)"

    # JSON parse helpers — strip markdown fences then extract fields
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

    # Count total distinct keywords for this analysis
    total_keywords = run_bq_scalar(f"""
        SELECT COUNT(DISTINCT keyword_text)
        FROM {_t(T_GAP_ANALYSIS)}
        WHERE analysis_id = '{analysis_id}'
    """)
    print(f"🔢 Filter '{label}': {total_keywords} keywords to process in batches of {FILTER_BATCH_SIZE}")

    if total_keywords == 0:
        print(f"⚠️ No keywords found for analysis {analysis_id} — nothing to filter")
        return 0

    # Process in batches using ROW_NUMBER() for stable pagination.
    # Each batch stays well under the BQ on-demand CPU/bytes ratio limit.
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

        # Notify caller of progress (used to update Firestore total_evaluated)
        if on_batch_complete:
            try:
                on_batch_complete(total_inserted)
            except Exception as e:
                print(f"⚠️ on_batch_complete callback error: {e}")

    # Final count from BQ (source of truth)
    count = run_bq_scalar(f"""
        SELECT COUNT(*) FROM {_t(T_FILTER_RESULTS)}
        WHERE execution_id = '{execution_id}'
    """)
    print(f"✅ Filter '{label}' complete: {count} rows inserted")
    return count
