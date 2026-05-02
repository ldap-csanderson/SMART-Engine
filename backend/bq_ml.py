"""BigQuery ML helpers: model management, image embedding, and gap analysis pipeline."""
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
    return f"`{PROJECT_ID}.{DATASET_ID}.{name}`"

def _t(name: str) -> str:
    return f"`{PROJECT_ID}.{DATASET_ID}.{name}`"

def _conn() -> str:
    return f"`{PROJECT_ID}.{CONNECTION_ID}`"

def _sq(s: str) -> str:
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
# Image dataset types
# ---------------------------------------------------------------------------

IMAGE_TYPES = {"image_urls", "image_google_drive"}

# Prompt hashes for cached image embeddings (stored in dataset_embeddings)
_IMG_DIRECT_HASH = "__image_direct__"
_IMG_CAPTION_HASH = "__image_caption__"


def _download_image(url: str, timeout: int = 30) -> tuple:
    """Download image from URL. Returns (bytes, mime_type)."""
    import requests as _requests
    r = _requests.get(
        url, timeout=timeout,
        headers={"User-Agent": "SMART-Engine/3.0"},
        allow_redirects=True,
    )
    r.raise_for_status()
    mime = r.headers.get("content-type", "image/jpeg").split(";")[0].strip()
    if not mime.startswith("image/"):
        mime = "image/jpeg"
    return r.content, mime


def _embed_image_direct_sdk(image_bytes: bytes, mime_type: str) -> list:
    """Embed image bytes directly via gemini-embedding-2 multimodal."""
    from google import genai as _genai
    from google.genai import types as _gt
    client = _genai.Client()
    result = client.models.embed_content(
        model="gemini-embedding-2",
        contents=[_gt.Part.from_bytes(data=image_bytes, mime_type=mime_type)],
        config=_gt.EmbedContentConfig(output_dimensionality=768),
    )
    return list(result.embeddings[0].values)


def _generate_image_caption_sdk(image_bytes: bytes, mime_type: str,
                                model: str = "gemini-2.5-flash") -> str:
    """Generate a detailed description of an image using Gemini."""
    from google import genai as _genai
    from google.genai import types as _gt
    client = _genai.Client()
    response = client.models.generate_content(
        model=model,
        contents=[
            ("Describe this image in comprehensive detail. Include: visual elements, "
             "subjects, colors, composition, context, mood, any visible text, and what "
             "the image communicates overall. Be thorough and specific."),
            _gt.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        ],
    )
    return (response.text or "").strip()


def _embed_text_sdk(text: str) -> list:
    """Embed a text string via gemini-embedding-2 Python SDK."""
    from google import genai as _genai
    from google.genai import types as _gt
    client = _genai.Client()
    result = client.models.embed_content(
        model="gemini-embedding-2",
        contents=f"task: sentence similarity | query: {text}",
        config=_gt.EmbedContentConfig(output_dimensionality=768),
    )
    return list(result.embeddings[0].values)


def _normalize_intent_sdk(text: str, intent_prompt: str,
                           model: str = "gemini-2.5-flash") -> str:
    """Run intent normalization on text via Gemini (Python SDK, for image captions)."""
    import re, json as _json
    from google import genai as _genai
    client = _genai.Client()
    suffix = (
        "\n\nReturn ONLY raw JSON. Do not return this example. "
        '{"intent_string": "I am a consumer shopping for the best laptops"}'
    )
    full_prompt = f"{intent_prompt}\n\nKeyword: {text}{suffix}"
    response = client.models.generate_content(model=model, contents=full_prompt)
    raw = (response.text or "").strip()
    raw = re.sub(r'```json\s*', '', raw)
    raw = re.sub(r'\s*```', '', raw)
    try:
        return _json.loads(raw).get("intent_string", text)
    except Exception:
        return text


def _embed_images_to_bq(
    dataset_ids: list,
    prompt_hash: str,
    mode: str,                      # "direct" or "caption"
    use_intent_normalization: bool = False,
    intent_prompt: str = "",
    concurrency: int = 4,
) -> int:
    """Download and embed all uncached images, store results in dataset_embeddings.

    Fetches all (dataset_id, item_text) pairs not yet cached in dataset_embeddings
    under prompt_hash, deduplicates by URL (embed each image once), then inserts
    results for all dataset_ids that contain the URL.

    Returns the number of unique images embedded.
    """
    if bq_client is None:
        return 0
    from datetime import datetime, timezone as _tz
    import concurrent.futures

    ids_sql = ", ".join(f"'{did}'" for did in dataset_ids)

    # Fetch uncached (dataset_id, item_text) pairs
    all_rows = list(bq_client.query(f"""
        SELECT DISTINCT di.dataset_id, di.item_text
        FROM {_t(T_DATASET_ITEMS)} di
        LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
          ON di.item_text = de.item_text
          AND di.dataset_id = de.dataset_id
          AND de.prompt_hash = '{prompt_hash}'
        WHERE di.dataset_id IN ({ids_sql})
          AND di.item_text IS NOT NULL
          AND de.item_text IS NULL
    """).result())

    if not all_rows:
        print(f"✅ All image embeddings already cached (hash={prompt_hash})")
        return 0

    # Deduplicate by URL: one download+embed per unique URL
    url_to_datasets: dict = {}
    for row in all_rows:
        url_to_datasets.setdefault(row.item_text, []).append(row.dataset_id)

    total = len(url_to_datasets)
    print(f"📸 Embedding {total} unique images (mode={mode}, hash={prompt_hash})...")

    embedded = 0
    skipped = 0
    bq_rows = []
    timestamp = datetime.now(_tz.utc).isoformat()

    def _process_url(url: str) -> list:
        try:
            image_bytes, mime_type = _download_image(url)
            if mode == "direct":
                embedding = _embed_image_direct_sdk(image_bytes, mime_type)
                intent_string = None
            else:
                caption = _generate_image_caption_sdk(image_bytes, mime_type)
                if use_intent_normalization and intent_prompt:
                    intent_string = _normalize_intent_sdk(caption, intent_prompt)
                    embedding = _embed_text_sdk(intent_string)
                else:
                    intent_string = caption
                    embedding = _embed_text_sdk(caption)
            return [(did, url, intent_string, embedding) for did in url_to_datasets[url]]
        except Exception as e:
            print(f"⚠️ Failed to embed image {url[:80]}: {e}")
            return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(_process_url, url): url for url in url_to_datasets}
        for future in concurrent.futures.as_completed(futures):
            results = future.result()
            if results:
                for did, url, intent_string, embedding in results:
                    bq_rows.append({
                        "dataset_id": did,
                        "item_text": url,
                        "intent_string": intent_string,
                        "embedding": embedding,
                        "prompt_hash": prompt_hash,
                        "embedded_at": timestamp,
                    })
                embedded += 1
            else:
                skipped += 1
            # Flush in chunks
            if len(bq_rows) >= 50:
                table_id = f"{PROJECT_ID}.{DATASET_ID}.{T_DATASET_EMBEDDINGS}"
                errors = bq_client.insert_rows_json(table_id, bq_rows)
                if errors:
                    print(f"⚠️ BQ image insert errors: {errors[:2]}")
                bq_rows = []

    if bq_rows:
        table_id = f"{PROJECT_ID}.{DATASET_ID}.{T_DATASET_EMBEDDINGS}"
        errors = bq_client.insert_rows_json(table_id, bq_rows)
        if errors:
            print(f"⚠️ BQ image insert errors: {errors[:2]}")

    print(f"✅ Image embedding done: {embedded} embedded, {skipped} skipped/failed")
    return embedded


# ---------------------------------------------------------------------------
# Startup: create BQ ML models if not present, migrate embeddings model
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
            f"""CREATE OR REPLACE MODEL {_m(MODEL_EMBEDDINGS)}
                REMOTE WITH CONNECTION {_conn()}
                OPTIONS (ENDPOINT = 'gemini-embedding-2')""",
            f"CREATE OR REPLACE MODEL {MODEL_EMBEDDINGS} (gemini-embedding-2)",
        )
    except Exception as e:
        print(f"⚠️ Model creation encountered an error: {e}")


# ---------------------------------------------------------------------------
# One-time migration: wipe dataset_embeddings cache + rebuild vector index
# ---------------------------------------------------------------------------

def migrate_to_gemini_embedding_2():
    """One-time migration to gemini-embedding-2. Gated by Firestore flag."""
    if bq_client is None or firestore_db is None:
        print("⚠️ BQ/Firestore not available — skipping embedding migration")
        return
    try:
        doc = firestore_db.collection("settings").document("migrations").get()
        if doc.exists and doc.to_dict().get("embedding_v2_done"):
            print("✅ Embedding migration to gemini-embedding-2 already complete")
            return
    except Exception as e:
        print(f"⚠️ Could not check migration flag: {e}")
        return

    print("🔄 Migrating to gemini-embedding-2: wiping cached embeddings...")
    try:
        run_bq(
            f"DELETE FROM {_t(T_DATASET_EMBEDDINGS)} WHERE TRUE",
            "Wipe dataset_embeddings cache (gemini-embedding-2 migration)",
        )
        try:
            run_bq(
                f"""DROP VECTOR INDEX IF EXISTS idx_dataset_embeddings_embedding
                    ON {_t(T_DATASET_EMBEDDINGS)}""",
                "Drop old vector index",
            )
        except Exception as e:
            print(f"⚠️ Could not drop old vector index: {e}")

        firestore_db.collection("settings").document("migrations").set(
            {"embedding_v2_done": True}, merge=True,
        )
        print("✅ Embedding migration complete — cache wiped, index dropped")
    except Exception as e:
        print(f"❌ Embedding migration error: {e}")


# ---------------------------------------------------------------------------
# Schema migrations
# ---------------------------------------------------------------------------

def add_image_url_column_if_not_exist():
    """Add image_url column to dataset_items if not already present. Idempotent."""
    if bq_client is None:
        print("⚠️ BQ client not available — skipping image_url column migration")
        return
    try:
        run_bq(
            f"""ALTER TABLE {_t(T_DATASET_ITEMS)}
                ADD COLUMN IF NOT EXISTS image_url STRING
                OPTIONS(description='GCS path or original URL for image dataset items')""",
            "ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS image_url",
        )
    except Exception as e:
        print(f"⚠️ Could not add image_url column (may already exist): {e}")


# ---------------------------------------------------------------------------
# Vector index management
# ---------------------------------------------------------------------------

def get_vector_index_coverage() -> int:
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
    """Create persistent ANN vector index (768-dim, gemini-embedding-2)."""
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
    poll_interval = 120
    waited = 0
    while waited < timeout_seconds:
        coverage = get_vector_index_coverage()
        if coverage < 0:
            print("⚠️ No vector index — creating now...")
            create_vector_index_if_not_exist()
            time.sleep(poll_interval)
            waited += poll_interval
            continue
        if coverage >= min_coverage:
            print(f"✅ Vector index ready (coverage={coverage}%)")
            return coverage
        print(f"⏳ Vector index building: {coverage}% — waiting {poll_interval}s...")
        time.sleep(poll_interval)
        waited += poll_interval
    coverage = get_vector_index_coverage()
    print(f"⚠️ Vector index timeout — current coverage={coverage}%. Proceeding anyway.")
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

# gemini-embedding-2: no task_type parameter, use prompt prefix, 768 dims.
_EMB_OPTS = "STRUCT(TRUE AS flatten_json_output, 768 AS output_dimensionality)"
_EMB_TASK_PREFIX = "task: sentence similarity | query: "

_DIRECT_PROMPT_HASH = "__direct__"


def run_gap_analysis_pipeline(
    analysis_id: str,
    source_dataset_ids: list,
    target_dataset_ids: list,
    source_prompt: str,
    target_prompt: str,
    source_dataset_type: str,
    target_dataset_type: str = "text_list",
    min_monthly_searches: int = 1000,
    use_intent_normalization: bool = True,
    image_embedding_mode: str = "direct",   # "direct" or "caption" for image datasets
    top_k: int = 10,
) -> int:
    """Run the full gap analysis pipeline.

    Handles text and image datasets on both source and target sides:
    - Text datasets: BQ ML embeddings (gemini-embedding-2 via remote model)
    - Image datasets: Python SDK embeddings (direct multimodal or caption-based)

    Returns the number of result rows inserted.
    """
    tid = analysis_id.replace("-", "_")
    tmp_src_intent = f"_tmp_{tid}_src_intent"
    tmp_src_emb = f"_tmp_{tid}_src_emb"
    tmp_tgt_intent = f"_tmp_{tid}_tgt_intent"

    source_ids_sql = ", ".join(f"'{did}'" for did in source_dataset_ids)
    target_ids_sql = ", ".join(f"'{did}'" for did in target_dataset_ids)

    search_vol_filter = ""
    if source_dataset_type in SEARCH_VOLUME_TYPES and min_monthly_searches > 0:
        search_vol_filter = f"AND avg_monthly_searches >= {min_monthly_searches}"

    source_is_image = source_dataset_type in IMAGE_TYPES
    target_is_image = target_dataset_type in IMAGE_TYPES

    # -----------------------------------------------------------------------
    # IMAGE PRE-PROCESSING: embed image datasets via Python SDK before BQ pipeline
    # -----------------------------------------------------------------------
    src_emb_hash = None  # set if source is image, for post-pipeline cleanup

    if source_is_image:
        # Build a unique per-run hash for source images (cleaned up after analysis)
        src_emb_hash = f"__src_{analysis_id[:12]}_{image_embedding_mode}__"
        print(f"🖼️ Pre-embedding image source ({image_embedding_mode} mode)...")
        _embed_images_to_bq(
            dataset_ids=source_dataset_ids,
            prompt_hash=src_emb_hash,
            mode=image_embedding_mode,
            use_intent_normalization=False,   # direct image embeds only for source
            intent_prompt=source_prompt,
        )
        # Populate tmp_src_emb from pre-computed embeddings (source_ph used in VECTOR_SEARCH)
        run_bq(f"""
            CREATE OR REPLACE TABLE {_t(tmp_src_emb)} AS
            SELECT item_text, intent_string, embedding
            FROM {_t(T_DATASET_EMBEDDINGS)}
            WHERE dataset_id IN ({source_ids_sql})
              AND prompt_hash = '{src_emb_hash}'
        """, "Image source: copy pre-embedded to tmp_src_emb")

    if target_is_image:
        # Build a stable cache hash for target image embeddings
        img_intent_suffix = compute_prompt_hash(target_prompt) if (use_intent_normalization and image_embedding_mode == "caption") else ""
        target_img_hash = f"__img_{image_embedding_mode}_{img_intent_suffix}__"
        print(f"🖼️ Pre-embedding image target ({image_embedding_mode} mode)...")
        _embed_images_to_bq(
            dataset_ids=target_dataset_ids,
            prompt_hash=target_img_hash,
            mode=image_embedding_mode,
            use_intent_normalization=(use_intent_normalization and image_embedding_mode == "caption"),
            intent_prompt=target_prompt,
        )

    # -----------------------------------------------------------------------
    # TEXT EMBEDDING (BQ ML) — skipped for image datasets
    # -----------------------------------------------------------------------

    if not source_is_image and not target_is_image:
        # Original path: both text — use BQ ML for all embeddings
        if use_intent_normalization:
            source_ph = compute_prompt_hash(source_prompt)
            target_ph = compute_prompt_hash(target_prompt)
            sp = _sq(source_prompt)
            tp = _sq(target_prompt)

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

            run_bq(f"""
                CREATE OR REPLACE TABLE {_t(tmp_src_emb)} AS
                SELECT item_text, intent_string, ml_generate_embedding_result AS embedding
                FROM ML.GENERATE_EMBEDDING(
                  MODEL {_m(MODEL_EMBEDDINGS)},
                  (
                    SELECT DISTINCT item_text, intent_string,
                      CONCAT('{_EMB_TASK_PREFIX}', intent_string) AS content
                    FROM {_t(tmp_src_intent)}
                    WHERE intent_string IS NOT NULL
                  ),
                  {_EMB_OPTS}
                )
            """, "Step 2: source item embeddings")

            uncached = run_bq_scalar(f"""
                SELECT COUNT(DISTINCT di.item_text)
                FROM {_t(T_DATASET_ITEMS)} di
                LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                  ON di.item_text = de.item_text AND di.dataset_id = de.dataset_id
                  AND de.prompt_hash = '{target_ph}'
                WHERE di.dataset_id IN ({target_ids_sql}) AND de.item_text IS NULL
            """)
            print(f"📊 Uncached target items: {uncached}")

            if uncached > 0:
                tp_sq = _sq(target_prompt)
                run_bq(f"""
                    CREATE OR REPLACE TABLE {_t(tmp_tgt_intent)} AS
                    WITH llm AS (
                      SELECT * FROM ML.GENERATE_TEXT(
                        MODEL {_m(MODEL_GEMINI)},
                        (
                          SELECT DISTINCT di.item_text,
                            CONCAT('{tp_sq}', '\\n\\nTopic: ', di.item_text, '{_INTENT_JSON_SUFFIX}') AS prompt
                          FROM {_t(T_DATASET_ITEMS)} di
                          LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                            ON di.item_text = de.item_text AND di.dataset_id = de.dataset_id
                            AND de.prompt_hash = '{target_ph}'
                          WHERE di.dataset_id IN ({target_ids_sql}) AND de.item_text IS NULL
                        ),
                        {_LLM_OPTS}
                      )
                    )
                    SELECT item_text, {_PARSE_INTENT} AS intent_string FROM llm
                """, "Step 3b: target item intents for uncached items")

                for did in target_dataset_ids:
                    run_bq(f"""
                        INSERT INTO {_t(T_DATASET_EMBEDDINGS)}
                          (dataset_id, item_text, intent_string, embedding, prompt_hash, embedded_at)
                        SELECT '{did}', item_text, intent_string,
                               ml_generate_embedding_result AS embedding,
                               '{target_ph}', CURRENT_TIMESTAMP()
                        FROM ML.GENERATE_EMBEDDING(
                          MODEL {_m(MODEL_EMBEDDINGS)},
                          (
                            SELECT DISTINCT t.item_text, t.intent_string,
                              CONCAT('{_EMB_TASK_PREFIX}', t.intent_string) AS content
                            FROM {_t(tmp_tgt_intent)} t
                            INNER JOIN {_t(T_DATASET_ITEMS)} di
                              ON t.item_text = di.item_text AND di.dataset_id = '{did}'
                            WHERE t.intent_string IS NOT NULL
                          ),
                          {_EMB_OPTS}
                        )
                        WHERE item_text NOT IN (
                          SELECT item_text FROM {_t(T_DATASET_EMBEDDINGS)}
                          WHERE dataset_id = '{did}' AND prompt_hash = '{target_ph}'
                        )
                    """, f"Step 3c: populate target embeddings cache (dataset_id={did})")

        else:
            # Direct text mode: no LLM, embed item_text directly
            source_ph = target_ph = _DIRECT_PROMPT_HASH

            run_bq(f"""
                CREATE OR REPLACE TABLE {_t(tmp_src_emb)} AS
                SELECT item_text, CAST(NULL AS STRING) AS intent_string,
                       ml_generate_embedding_result AS embedding
                FROM ML.GENERATE_EMBEDDING(
                  MODEL {_m(MODEL_EMBEDDINGS)},
                  (
                    SELECT DISTINCT item_text,
                      CONCAT('{_EMB_TASK_PREFIX}', item_text) AS content
                    FROM {_t(T_DATASET_ITEMS)}
                    WHERE dataset_id IN ({source_ids_sql}) {search_vol_filter}
                  ),
                  {_EMB_OPTS}
                )
            """, "Step 2 (direct): source item embeddings")

            uncached = run_bq_scalar(f"""
                SELECT COUNT(DISTINCT di.item_text)
                FROM {_t(T_DATASET_ITEMS)} di
                LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                  ON di.item_text = de.item_text AND di.dataset_id = de.dataset_id
                  AND de.prompt_hash = '{_DIRECT_PROMPT_HASH}'
                WHERE di.dataset_id IN ({target_ids_sql}) AND de.item_text IS NULL
            """)
            print(f"📊 Uncached target items (direct): {uncached}")

            if uncached > 0:
                for did in target_dataset_ids:
                    run_bq(f"""
                        INSERT INTO {_t(T_DATASET_EMBEDDINGS)}
                          (dataset_id, item_text, intent_string, embedding, prompt_hash, embedded_at)
                        SELECT '{did}', item_text, CAST(NULL AS STRING),
                               ml_generate_embedding_result,
                               '{_DIRECT_PROMPT_HASH}', CURRENT_TIMESTAMP()
                        FROM ML.GENERATE_EMBEDDING(
                          MODEL {_m(MODEL_EMBEDDINGS)},
                          (
                            SELECT DISTINCT di.item_text,
                              CONCAT('{_EMB_TASK_PREFIX}', di.item_text) AS content
                            FROM {_t(T_DATASET_ITEMS)} di
                            LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                              ON di.item_text = de.item_text AND di.dataset_id = de.dataset_id
                              AND de.prompt_hash = '{_DIRECT_PROMPT_HASH}'
                            WHERE di.dataset_id = '{did}' AND de.item_text IS NULL
                          ),
                          {_EMB_OPTS}
                        )
                    """, f"Step 3b (direct): cache target embeddings (dataset_id={did})")

    elif source_is_image and not target_is_image:
        # Image source → text target
        source_ph = src_emb_hash
        if use_intent_normalization:
            target_ph = compute_prompt_hash(target_prompt)
            tp_sq = _sq(target_prompt)
            uncached = run_bq_scalar(f"""
                SELECT COUNT(DISTINCT di.item_text)
                FROM {_t(T_DATASET_ITEMS)} di
                LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                  ON di.item_text = de.item_text AND di.dataset_id = de.dataset_id
                  AND de.prompt_hash = '{target_ph}'
                WHERE di.dataset_id IN ({target_ids_sql}) AND de.item_text IS NULL
            """)
            if uncached > 0:
                run_bq(f"""
                    CREATE OR REPLACE TABLE {_t(tmp_tgt_intent)} AS
                    WITH llm AS (
                      SELECT * FROM ML.GENERATE_TEXT(
                        MODEL {_m(MODEL_GEMINI)},
                        (
                          SELECT DISTINCT di.item_text,
                            CONCAT('{tp_sq}', '\\n\\nTopic: ', di.item_text, '{_INTENT_JSON_SUFFIX}') AS prompt
                          FROM {_t(T_DATASET_ITEMS)} di
                          LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                            ON di.item_text = de.item_text AND di.dataset_id = de.dataset_id
                            AND de.prompt_hash = '{target_ph}'
                          WHERE di.dataset_id IN ({target_ids_sql}) AND de.item_text IS NULL
                        ),
                        {_LLM_OPTS}
                      )
                    )
                    SELECT item_text, {_PARSE_INTENT} AS intent_string FROM llm
                """, "Target text intent (image-source mode)")
                for did in target_dataset_ids:
                    run_bq(f"""
                        INSERT INTO {_t(T_DATASET_EMBEDDINGS)}
                          (dataset_id, item_text, intent_string, embedding, prompt_hash, embedded_at)
                        SELECT '{did}', item_text, intent_string,
                               ml_generate_embedding_result, '{target_ph}', CURRENT_TIMESTAMP()
                        FROM ML.GENERATE_EMBEDDING(
                          MODEL {_m(MODEL_EMBEDDINGS)},
                          (
                            SELECT DISTINCT t.item_text, t.intent_string,
                              CONCAT('{_EMB_TASK_PREFIX}', t.intent_string) AS content
                            FROM {_t(tmp_tgt_intent)} t
                            INNER JOIN {_t(T_DATASET_ITEMS)} di
                              ON t.item_text = di.item_text AND di.dataset_id = '{did}'
                            WHERE t.intent_string IS NOT NULL
                          ),
                          {_EMB_OPTS}
                        )
                        WHERE item_text NOT IN (
                          SELECT item_text FROM {_t(T_DATASET_EMBEDDINGS)}
                          WHERE dataset_id = '{did}' AND prompt_hash = '{target_ph}'
                        )
                    """, f"Target text embed (image-source, dataset={did})")
        else:
            target_ph = _DIRECT_PROMPT_HASH
            uncached = run_bq_scalar(f"""
                SELECT COUNT(DISTINCT di.item_text) FROM {_t(T_DATASET_ITEMS)} di
                LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                  ON di.item_text = de.item_text AND di.dataset_id = de.dataset_id
                  AND de.prompt_hash = '{_DIRECT_PROMPT_HASH}'
                WHERE di.dataset_id IN ({target_ids_sql}) AND de.item_text IS NULL
            """)
            if uncached > 0:
                for did in target_dataset_ids:
                    run_bq(f"""
                        INSERT INTO {_t(T_DATASET_EMBEDDINGS)}
                          (dataset_id, item_text, intent_string, embedding, prompt_hash, embedded_at)
                        SELECT '{did}', item_text, CAST(NULL AS STRING),
                               ml_generate_embedding_result, '{_DIRECT_PROMPT_HASH}', CURRENT_TIMESTAMP()
                        FROM ML.GENERATE_EMBEDDING(
                          MODEL {_m(MODEL_EMBEDDINGS)},
                          (
                            SELECT DISTINCT di.item_text,
                              CONCAT('{_EMB_TASK_PREFIX}', di.item_text) AS content
                            FROM {_t(T_DATASET_ITEMS)} di
                            LEFT JOIN {_t(T_DATASET_EMBEDDINGS)} de
                              ON di.item_text = de.item_text AND di.dataset_id = de.dataset_id
                              AND de.prompt_hash = '{_DIRECT_PROMPT_HASH}'
                            WHERE di.dataset_id = '{did}' AND de.item_text IS NULL
                          ),
                          {_EMB_OPTS}
                        )
                    """, f"Target text direct embed (image-source, dataset={did})")

    elif not source_is_image and target_is_image:
        # Text source → image target
        target_ph = target_img_hash  # noqa — set earlier in image pre-processing
        if use_intent_normalization:
            source_ph = compute_prompt_hash(source_prompt)
            sp = _sq(source_prompt)
            run_bq(f"""
                CREATE OR REPLACE TABLE {_t(tmp_src_intent)} AS
                WITH llm AS (
                  SELECT * FROM ML.GENERATE_TEXT(
                    MODEL {_m(MODEL_GEMINI)},
                    (
                      SELECT DISTINCT item_text,
                        CONCAT('{sp}', '\\n\\nKeyword: ', item_text, '{_INTENT_JSON_SUFFIX}') AS prompt
                      FROM {_t(T_DATASET_ITEMS)}
                      WHERE dataset_id IN ({source_ids_sql}) {search_vol_filter}
                    ),
                    {_LLM_OPTS}
                  )
                )
                SELECT item_text, {_PARSE_INTENT} AS intent_string FROM llm
            """, "Step 1: source intents (text-source, image-target)")
            run_bq(f"""
                CREATE OR REPLACE TABLE {_t(tmp_src_emb)} AS
                SELECT item_text, intent_string, ml_generate_embedding_result AS embedding
                FROM ML.GENERATE_EMBEDDING(
                  MODEL {_m(MODEL_EMBEDDINGS)},
                  (
                    SELECT DISTINCT item_text, intent_string,
                      CONCAT('{_EMB_TASK_PREFIX}', intent_string) AS content
                    FROM {_t(tmp_src_intent)}
                    WHERE intent_string IS NOT NULL
                  ),
                  {_EMB_OPTS}
                )
            """, "Step 2: source embeddings (text-source, image-target)")
        else:
            source_ph = _DIRECT_PROMPT_HASH
            run_bq(f"""
                CREATE OR REPLACE TABLE {_t(tmp_src_emb)} AS
                SELECT item_text, CAST(NULL AS STRING) AS intent_string,
                       ml_generate_embedding_result AS embedding
                FROM ML.GENERATE_EMBEDDING(
                  MODEL {_m(MODEL_EMBEDDINGS)},
                  (
                    SELECT DISTINCT item_text,
                      CONCAT('{_EMB_TASK_PREFIX}', item_text) AS content
                    FROM {_t(T_DATASET_ITEMS)}
                    WHERE dataset_id IN ({source_ids_sql}) {search_vol_filter}
                  ),
                  {_EMB_OPTS}
                )
            """, "Step 2 (direct): source embeddings (text-source, image-target)")

    else:
        # Image source → image target (both Python SDK)
        source_ph = src_emb_hash  # noqa — set earlier
        target_ph = target_img_hash  # noqa — set earlier

    # -----------------------------------------------------------------------
    # Step 4: VECTOR_SEARCH in batches
    # -----------------------------------------------------------------------
    _VS_BATCH = 100_000

    print("⏳ Checking vector index readiness before VECTOR_SEARCH...")
    _wait_for_vector_index(min_coverage=99, timeout_seconds=10800)

    src_count = run_bq_scalar(f"SELECT COUNT(*) FROM {_t(tmp_src_emb)}")
    num_vs_batches = max(1, (src_count + _VS_BATCH - 1) // _VS_BATCH)
    print(f"📊 Vector search: {src_count} source items → {num_vs_batches} batch(es)")

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
                top_k => {top_k},
                distance_type => 'COSINE',
                options => '{{"use_brute_force": false}}'
              )
            )
            SELECT
              '{analysis_id}', CURRENT_TIMESTAMP(),
              vs.keyword_text, vs.keyword_intent,
              vs.target_item, vs.target_intent,
              vs.semantic_distance,
              kw.avg_monthly_searches
            FROM vs
            LEFT JOIN (
              SELECT item_text, MAX(avg_monthly_searches) AS avg_monthly_searches
              FROM {_t(T_DATASET_ITEMS)}
              WHERE dataset_id IN ({source_ids_sql})
              GROUP BY item_text
            ) kw ON vs.keyword_text = kw.item_text
        """, f"Step 4 batch {vs_batch + 1}/{num_vs_batches}: vector search")

    count = run_bq_scalar(f"""
        SELECT COUNT(DISTINCT keyword_text) FROM {_t(T_GAP_ANALYSIS)}
        WHERE analysis_id = '{analysis_id}'
    """)

    # Step 5: cleanup temp tables
    for tmp in [tmp_src_intent, tmp_src_emb, tmp_tgt_intent]:
        try:
            run_bq(f"DROP TABLE IF EXISTS {_t(tmp)}", f"Cleanup {tmp}")
        except Exception:
            pass

    # Cleanup temporary source image embeddings (per-run, not cached)
    if src_emb_hash:
        try:
            run_bq(
                f"DELETE FROM {_t(T_DATASET_EMBEDDINGS)} WHERE prompt_hash = '{src_emb_hash}'",
                f"Cleanup temp image source embeddings (hash={src_emb_hash})",
            )
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
    min_distance: float = 0.0,
) -> int:
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
          SELECT keyword_text FROM {_t(T_GAP_ANALYSIS)}
          WHERE analysis_id = '{analysis_id}'
          GROUP BY keyword_text HAVING 1=1 {distance_filter}
        )
    """)
    print(f"🔢 Filter '{label}': {total_keywords} keywords in batches of {FILTER_BATCH_SIZE}"
          + (f" (min_distance={min_distance})" if min_distance > 0.0 else ""))

    if total_keywords == 0:
        print(f"⚠️ No keywords found for analysis {analysis_id}")
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
              SELECT keyword_text,
                ROW_NUMBER() OVER (ORDER BY keyword_text) AS rn
              FROM (
                SELECT keyword_text FROM {_t(T_GAP_ANALYSIS)}
                WHERE analysis_id = '{analysis_id}'
                GROUP BY keyword_text HAVING 1=1 {distance_filter}
              )
            ),
            batch AS (
              SELECT keyword_text FROM ranked
              WHERE rn > {offset} AND rn <= {limit}
            ),
            llm AS (
              SELECT * FROM ML.GENERATE_TEXT(
                MODEL {_m(MODEL_GEMINI)},
                (SELECT keyword_text, {prompt_concat} AS prompt FROM batch),
                {_FILTER_LLM_OPTS}
              )
            ),
            parsed AS (
              SELECT keyword_text,
                CAST({_parse(label)} AS BOOL) AS result,
                {_parse('confidence')} AS confidence
              FROM llm
            )
            SELECT
              '{execution_id}', '{analysis_id}', keyword_text,
              '{label_sql}', result, confidence, CURRENT_TIMESTAMP()
            FROM parsed
        """, f"Filter '{label}' batch {batch_num + 1}/{num_batches}")

        total_inserted += min(FILTER_BATCH_SIZE, total_keywords - offset)

        if on_batch_complete:
            try:
                on_batch_complete(total_inserted)
            except Exception as e:
                print(f"⚠️ on_batch_complete callback error: {e}")

    count = run_bq_scalar(f"""
        SELECT COUNT(*) FROM {_t(T_FILTER_RESULTS)} WHERE execution_id = '{execution_id}'
    """)
    print(f"✅ Filter '{label}' complete: {count} rows inserted")
    return count
