"""Chat agent endpoints — Gemini-powered analysis of datasets and gap analyses."""
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests as _http

from fastapi import APIRouter, BackgroundTasks, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import (
    bq_client, db, PROJECT_ID, DATASET_ID, REGION,
    T_DATASET_ITEMS, T_GAP_ANALYSIS, config,
)

# Two routers — each mounted at its own prefix in api.py
dataset_chat_router = APIRouter(prefix="/datasets", tags=["dataset-chat"])
gap_chat_router = APIRouter(prefix="/gap-analyses", tags=["gap-chat"])

_TABLE_ITEMS = f"`{PROJECT_ID}.{DATASET_ID}.{T_DATASET_ITEMS}`"
_TABLE_GAP = f"`{PROJECT_ID}.{DATASET_ID}.{T_GAP_ANALYSIS}`"

AVAILABLE_MODELS: List[str] = config.get("gemini_models", [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-pro-preview",
    "gemini-3-deep-think",
])

_MAX_RESULT_ROWS = 100_000

# ---------------------------------------------------------------------------
# Model / client helpers
# ---------------------------------------------------------------------------

def _get_agent_model() -> str:
    """Return the active Gemini model. Reads from Firestore settings/agent, falls back to config."""
    if db:
        try:
            doc = db.collection("settings").document("agent").get()
            if doc.exists:
                model = doc.to_dict().get("model")
                if model:
                    return model
        except Exception:
            pass
    return config.get("gemini", {}).get("model", "gemini-2.5-flash")


def _gemini_client():
    """Return a configured Gemini client (Google AI Studio key or Vertex AI fallback)."""
    try:
        from google import genai
        import os as _os
        api_key = _os.environ.get("GOOGLE_API_KEY")
        if api_key:
            return genai.Client(api_key=api_key)
        return genai.Client(vertexai=True, project=PROJECT_ID, location=REGION)
    except ImportError:
        raise HTTPException(503, "google-genai package not installed")
    except Exception as e:
        raise HTTPException(503, f"Failed to initialize Gemini client: {e}")


def _call_gemini(prompt: str, temperature: float = 0.0, max_tokens: int = 2048) -> str:
    model = _get_agent_model()
    client = _gemini_client()
    try:
        from google.genai import types as genai_types
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
            ),
        )
        return response.text.strip()
    except Exception as e:
        raise HTTPException(502, f"Gemini error: {e}")


def _call_gemini_multimodal(text_prompt: str, images: List[Tuple[bytes, str]], temperature: float = 0.2, max_tokens: int = 4096) -> str:
    """Call Gemini with a text prompt plus raw image bytes for multimodal analysis."""
    model = _get_agent_model()
    client = _gemini_client()
    try:
        from google.genai import types as genai_types
        parts = [genai_types.Part.from_text(text=text_prompt)]
        for img_bytes, mime_type in images:
            parts.append(genai_types.Part.from_bytes(data=img_bytes, mime_type=mime_type))
        response = client.models.generate_content(
            model=model,
            contents=parts,
            config=genai_types.GenerateContentConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
            ),
        )
        return response.text.strip()
    except Exception as e:
        raise HTTPException(502, f"Gemini multimodal error: {e}")


_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"}
_IMAGE_URL_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)


def _is_image_url(val: str) -> bool:
    if not val or not val.startswith("http"):
        return False
    lower = val.lower().split("?")[0]
    if any(lower.endswith(ext) for ext in _IMAGE_EXTS):
        return True
    if "storage.googleapis.com" in lower:
        return True
    return False


def _download_images_for_peek(rows: list, columns: List[str]) -> List[Tuple[bytes, str, int]]:
    """Detect image URLs in peek rows, download them, return (bytes, mime, row_index) tuples."""
    results = []
    # Prefer explicit image_url column; fall back to item_text
    url_col = "image_url" if "image_url" in columns else ("item_text" if "item_text" in columns else None)
    if not url_col:
        return results
    for i, row in enumerate(rows):
        url = row.get(url_col) or ""
        if _is_image_url(str(url)):
            try:
                resp = _http.get(url, timeout=10)
                resp.raise_for_status()
                mime = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
                if not mime.startswith("image/"):
                    mime = "image/jpeg"
                results.append((resp.content, mime, i))
            except Exception as exc:
                print(f"⚠️ Peek image download failed for row {i} ({url}): {exc}")
    return results


# ---------------------------------------------------------------------------
# SQL safety
# ---------------------------------------------------------------------------

_SQL_BLOCKED = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|MERGE|CALL|LOAD|COPY)\b",
    re.IGNORECASE,
)
_SQL_COMMENT = re.compile(r"(--|/\*|\*/|;)")


def _validate_sql(sql: str) -> str:
    sql = sql.strip()
    if not sql.upper().startswith("SELECT"):
        raise ValueError("Only SELECT statements are allowed")
    if _SQL_COMMENT.search(sql):
        raise ValueError("SQL contains disallowed characters (comments or semicolons)")
    if _SQL_BLOCKED.search(sql):
        raise ValueError("SQL contains a disallowed keyword")
    return sql


def _strip_fences(raw: str) -> str:
    if "```" in raw:
        return "\n".join(
            line for line in raw.split("\n")
            if not line.strip().startswith("```")
        ).strip()
    return raw


def _parse_action(raw: str) -> Optional[dict]:
    text = _strip_fences(raw)
    try:
        action = json.loads(text)
        if isinstance(action, dict) and action.get("action"):
            return action
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _get_chat_type_prompt(type_key: str) -> str:
    """Load a type-specific context prompt from Firestore settings/chat_prompts.

    Falls back to the hardcoded defaults from settings.py if Firestore is unavailable
    or the key hasn't been overridden.
    """
    from routers.settings import _get_chat_prompt_defaults
    defaults = _get_chat_prompt_defaults()
    if db:
        try:
            doc = db.collection("settings").document("chat_prompts").get()
            if doc.exists:
                override = doc.to_dict().get(type_key)
                if override:
                    return override
        except Exception:
            pass
    return defaults.get(type_key, "")


def _build_history_block(history: Optional[List]) -> str:
    if not history:
        return ""
    lines = []
    for h in history[-10:]:
        role = "User" if h.role == "user" else "Assistant"
        lines.append(f"{role}: {h.content}")
    return "\n\nCONVERSATION HISTORY:\n" + "\n".join(lines) if lines else ""


# ---------------------------------------------------------------------------
# Shared: insert items into BQ for a new text_list dataset
# ---------------------------------------------------------------------------

def _insert_new_dataset_items(dataset_id: str, items: List[str]):
    """Background task: insert items into BQ and mark dataset completed in Firestore."""
    if not bq_client or not items:
        return
    table_id = f"{PROJECT_ID}.{DATASET_ID}.{T_DATASET_ITEMS}"
    timestamp = datetime.now(timezone.utc).isoformat()
    rows = [{
        "dataset_id": dataset_id,
        "item_text": item,
        "added_at": timestamp,
        "source_url": "agent_cut",
        "avg_monthly_searches": None,
        "competition": None,
        "competition_index": None,
        "low_top_of_page_bid_usd": None,
        "high_top_of_page_bid_usd": None,
    } for item in items]

    chunk_size = 500
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        errors = bq_client.insert_rows_json(table_id, chunk)
        if errors:
            print(f"❌ BQ insert errors: {errors}")

    # Count and mark completed
    try:
        table = f"`{PROJECT_ID}.{DATASET_ID}.{T_DATASET_ITEMS}`"
        count_result = list(bq_client.query(
            f"SELECT COUNT(DISTINCT item_text) FROM {table} WHERE dataset_id = '{dataset_id}'"
        ).result())
        count = count_result[0][0] if count_result else len(items)
    except Exception:
        count = len(items)

    try:
        db.collection("datasets").document(dataset_id).update({
            "status": "completed",
            "item_count": count,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
    except Exception as e:
        print(f"⚠️ Could not mark dataset {dataset_id} completed: {e}")


# ============================================================================
# DATASET CHAT AGENT
# ============================================================================

_DATASET_SYSTEM_PROMPT = """You are a data analyst assistant for a keyword/advertising dataset in BigQuery.

DATASET: {dataset_name} (ID: {dataset_id}, Type: {dataset_type})
TABLE: {table}
IMPORTANT: Every query MUST include: WHERE dataset_id = '{dataset_id}'

DATASET TYPE CONTEXT:
{type_context}

COLUMN SCHEMA:
  item_text                STRING     — the keyword, search term, URL, or ad copy text
  source_url               STRING     — varies by type (seed URL, campaign/ad group, "manual", GA source key; may be null)
  avg_monthly_searches     INT64      — monthly search volume (null for non-keyword types)
  competition              STRING     — LOW / MEDIUM / HIGH (null for non-keyword types)
  competition_index        FLOAT64    — 0–1 competition score (null for non-keyword types)
  low_top_of_page_bid_usd  FLOAT64    — lower top-of-page bid estimate in USD (null for non-keyword types)
  high_top_of_page_bid_usd FLOAT64    — upper top-of-page bid estimate in USD (null for non-keyword types)
  added_at                 TIMESTAMP  — ingestion timestamp

DEDUPLICATION NOTE:
The table may contain duplicate item_text entries. To query distinct items use:
  QUALIFY ROW_NUMBER() OVER (PARTITION BY item_text ORDER BY added_at ASC) = 1

RESPONSE FORMAT (follow exactly — choose ONE):

1. To retrieve data for the user to view, respond ONLY with this JSON:
   {{"action":"query","sql":"SELECT ...","explanation":"One sentence describing what this returns"}}

2. To look at a sample of data yourself so you can analyze it and answer a question:
   {{"action":"peek","explanation":"What I need to understand from this sample","preview_rows":N,"include_images":false}}
   The data is pulled from the CURRENT VIEW. Do NOT write a SQL query for a peek.
   Guidelines: 5–15 rows for spot-checks, 15–50 for patterns, 50–100 for broad summaries. Never >100.
   For IMAGE datasets (type image_urls or image_google_drive): use 3–10 rows and set include_images=true to actually see the images — images are large and expensive to pass to the model.
   The user will approve before the peek runs and can adjust the row count.

3. To cut the current results into a new dataset:
   {{"action":"create_dataset","name":"Descriptive dataset name","sql":"SELECT item_text FROM {table} WHERE dataset_id='{dataset_id}' AND ..."}}
   Use this when the user wants to save a subset as a new dataset. The name should be descriptive.
   The user can edit the name before approving. The SQL must return an item_text column.

4. For conversational responses, follow-ups, or clarifications: plain text (markdown OK).

QUERY RULES:
- SELECT statements only
- Always reference: {table}
- Always filter: WHERE dataset_id = '{dataset_id}'
- Omit LIMIT unless the user asks for a limited result set
- No SQL comments (-- or /* */)"""


class HistoryItem(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class DatasetChatMessageRequest(BaseModel):
    message: str
    history: Optional[List[HistoryItem]] = None


class DatasetExecuteRequest(BaseModel):
    sql: str


class DatasetPeekRequest(BaseModel):
    rows: list
    columns: List[str]
    preview_rows: int
    explanation: Optional[str] = None
    include_images: bool = False
    history: Optional[List[HistoryItem]] = None


class DatasetCreateDatasetRequest(BaseModel):
    name: str
    sql: str


# ---------------------------------------------------------------------------
# Dataset endpoints
# ---------------------------------------------------------------------------

@dataset_chat_router.post("/{dataset_id}/chat/message")
def dataset_chat_message(dataset_id: str, payload: DatasetChatMessageRequest):
    """Send a user message to the dataset analysis agent.

    Returns one of:
    - {"type": "query", "sql": "...", "explanation": "..."}   — proposed SQL
    - {"type": "peek", "explanation": "...", "preview_rows": N} — data peek request
    - {"type": "create_dataset", "name": "...", "sql": "..."}  — new dataset proposal
    - {"type": "reply", "text": "..."}                          — plain response
    """
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    doc = db.collection("datasets").document(dataset_id).get()
    if not doc.exists:
        raise HTTPException(404, f"Dataset {dataset_id} not found")
    d = doc.to_dict()
    dataset_name = d.get("name", "Unnamed")
    dataset_type = d.get("type", "unknown")

    type_context = _get_chat_type_prompt(dataset_type)
    system = _DATASET_SYSTEM_PROMPT.format(
        dataset_name=dataset_name,
        dataset_id=dataset_id,
        dataset_type=dataset_type,
        table=_TABLE_ITEMS,
        type_context=type_context or "(No additional context configured for this dataset type.)",
    )
    history_block = _build_history_block(payload.history)
    prompt = f"{system}{history_block}\n\nUser: {payload.message}\nAssistant:"

    raw = _call_gemini(prompt)
    action = _parse_action(raw)

    if action:
        act_type = action.get("action")
        if act_type == "query" and "sql" in action:
            try:
                sql = _validate_sql(action["sql"].strip())
            except ValueError as exc:
                return {"type": "reply", "text": f"I tried to write a query but it was blocked for safety: {exc}. Please rephrase."}
            return {"type": "query", "sql": sql, "explanation": action.get("explanation", "")}

        elif act_type == "peek":
            preview_rows = max(1, min(int(action.get("preview_rows", 25)), 500))
            include_images = bool(action.get("include_images", False))
            return {"type": "peek", "explanation": action.get("explanation", ""), "preview_rows": preview_rows, "include_images": include_images}

        elif act_type == "create_dataset":
            name = action.get("name") or f"Subset from {dataset_name}"
            sql = (action.get("sql") or "").strip()
            if sql:
                try:
                    sql = _validate_sql(sql)
                except ValueError as exc:
                    return {"type": "reply", "text": f"I tried to create a dataset but the query was blocked: {exc}. Please rephrase."}
            return {"type": "create_dataset", "name": name, "sql": sql}

    return {"type": "reply", "text": raw}


@dataset_chat_router.post("/{dataset_id}/chat/execute")
def dataset_chat_execute(dataset_id: str, payload: DatasetExecuteRequest):
    """Execute a user-approved SQL query and return results."""
    if not bq_client:
        raise HTTPException(503, "BigQuery not initialized")
    try:
        sql = _validate_sql(payload.sql)
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        result = bq_client.query(sql).result()
        schema = result.schema
        rows = list(result)
    except Exception as e:
        raise HTTPException(400, f"Query failed: {e}")

    col_names = [field.name for field in schema]
    truncated = len(rows) > _MAX_RESULT_ROWS
    if truncated:
        rows = rows[:_MAX_RESULT_ROWS]

    serialised = [
        {col: (str(getattr(row, col)) if getattr(row, col, None) is not None else None) for col in col_names}
        for row in rows
    ]
    return {
        "columns": col_names,
        "rows": serialised,
        "row_count": len(serialised),
        "truncated": truncated,
        "truncated_at": _MAX_RESULT_ROWS if truncated else None,
    }


@dataset_chat_router.post("/{dataset_id}/chat/peek")
def dataset_chat_peek(dataset_id: str, payload: DatasetPeekRequest):
    """Receive pre-fetched rows, feed them to Gemini for analysis, return the analysis."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    doc = db.collection("datasets").document(dataset_id).get()
    if not doc.exists:
        raise HTTPException(404, f"Dataset {dataset_id} not found")
    d = doc.to_dict()
    dataset_name = d.get("name", "Unnamed")
    dataset_type = d.get("type", "unknown")

    rows = payload.rows
    col_names = payload.columns
    preview_rows = len(rows)

    header = " | ".join(col_names)
    separator = "-" * min(len(header), 120)
    table_lines = [header, separator]
    for row in rows:
        values = [str(row.get(col, "") or "") for col in col_names]
        table_lines.append(" | ".join(values))
    data_text = "\n".join(table_lines)
    data_block = f"[PEEK RESULTS — {preview_rows} rows from current dataset view (dataset: {dataset_name})]\n{data_text}"
    if payload.explanation:
        data_block = f"[Peek reason: {payload.explanation}]\n{data_block}"

    type_context = _get_chat_type_prompt(dataset_type)
    system = _DATASET_SYSTEM_PROMPT.format(
        dataset_name=dataset_name,
        dataset_id=dataset_id,
        dataset_type=dataset_type,
        table=_TABLE_ITEMS,
        type_context=type_context or "(No additional context configured for this dataset type.)",
    )
    history_block = _build_history_block(payload.history)
    prompt = (
        f"{system}{history_block}\n\n"
        f"Assistant: [Ran peek. Here are the results:]\n{data_block}\n\n"
        f"Assistant (analysis):"
    )

    if payload.include_images:
        image_data = _download_images_for_peek(rows, col_names)
        if image_data:
            image_parts = [(b, m) for b, m, _ in image_data]
            prompt += f"\n[{len(image_parts)} image(s) attached above in the order they appear in the table.]"
            analysis = _call_gemini_multimodal(prompt, image_parts, temperature=0.2, max_tokens=4096)
        else:
            analysis = _call_gemini(prompt, temperature=0.2, max_tokens=4096)
    else:
        analysis = _call_gemini(prompt, temperature=0.2, max_tokens=4096)

    return {"type": "reply", "text": analysis, "peek_rows": preview_rows}


@dataset_chat_router.post("/{dataset_id}/chat/create-dataset")
def dataset_chat_create_dataset(
    dataset_id: str,
    payload: DatasetCreateDatasetRequest,
    background_tasks: BackgroundTasks,
):
    """Execute approved create_dataset action: run SQL, create a new text_list dataset."""
    if not db or not bq_client:
        raise HTTPException(503, "Service not initialized")

    try:
        sql = _validate_sql(payload.sql)
    except ValueError as e:
        raise HTTPException(400, str(e))

    try:
        result = bq_client.query(sql).result()
        schema = result.schema
        rows = list(result)
    except Exception as e:
        raise HTTPException(400, f"Query failed: {e}")

    # Prefer item_text column, fall back to first column
    text_col = next((f.name for f in schema if f.name == "item_text"), None)
    if text_col is None and schema:
        text_col = schema[0].name
    if not text_col:
        raise HTTPException(400, "Query must return at least one column")

    items = list(dict.fromkeys(
        str(getattr(row, text_col)).strip()
        for row in rows
        if getattr(row, text_col, None)
    ))

    new_id = str(uuid.uuid4())
    db.collection("datasets").document(new_id).set({
        "dataset_id": new_id,
        "name": payload.name.strip(),
        "type": "text_list",
        "status": "processing",
        "item_count": 0,
        "source_config": {"parent_dataset_id": dataset_id, "source": "agent_cut"},
        "created_at": firestore.SERVER_TIMESTAMP,
        "updated_at": firestore.SERVER_TIMESTAMP,
        "error_message": None,
    })
    background_tasks.add_task(_insert_new_dataset_items, new_id, items)
    return {"dataset_id": new_id, "name": payload.name, "item_count": len(items)}


# ============================================================================
# GAP ANALYSIS CHAT AGENT
# ============================================================================

_GAP_SYSTEM_PROMPT = """You are a data analyst assistant for a semantic gap analysis in BigQuery.

GAP ANALYSIS: {analysis_name} (ID: {analysis_id})
SOURCE DATASET: {source_name} → TARGET DATASET: {target_name}
TABLE: {table}
IMPORTANT: Every query MUST include: WHERE analysis_id = '{analysis_id}'

ANALYSIS CONTEXT:
{type_context}

COLUMN SCHEMA (gap_analysis_results):
  analysis_id          STRING   — filter key
  keyword_text         STRING   — the source item (keyword, search term, URL, etc.)
  semantic_distance    FLOAT64  — semantic distance from source to closest target (higher = more distant / bigger gap)
  avg_monthly_searches INT64    — monthly search volume (null if source dataset has no search volume)
  portfolio_matches    JSON/STRING — closest matching items in the target dataset

FILTER EXECUTIONS (currently applied to the view):
{filter_context}

AVAILABLE FILTERS (can be run on this analysis):
{available_filters}

RESPONSE FORMAT (follow exactly — choose ONE):

1. To retrieve data for the user to view:
   {{"action":"query","sql":"SELECT ...","explanation":"One sentence describing what this returns"}}

2. To look at a sample of data yourself:
   {{"action":"peek","explanation":"What I need to understand","preview_rows":N,"include_images":false}}
   Data is pulled from the CURRENT VIEW (including active filter modes). Never >100 rows.
   For IMAGE datasets or analyses with image source/target: use 3–10 rows and set include_images=true to actually see the images.

3. To propose enabling or disabling a filter execution:
   {{"action":"toggle_filter","execution_id":"...","name":"...","mode":"true|false|any","reason":"..."}}
   Use the execution_id from the FILTER EXECUTIONS list above.
   "true" = show only items where filter matched, "false" = exclude where filter matched, "any" = no filter.

4. To propose running a new filter on this analysis:
   {{"action":"create_filter_execution","filter_id":"...","name":"...","reason":"..."}}
   Use the filter_id from the AVAILABLE FILTERS list above.
   Only propose filters that haven't already been run on this analysis.

5. To cut the current view into a new dataset:
   {{"action":"create_dataset","name":"Descriptive dataset name"}}
   The user's current visible items will be used. The name should be descriptive.
   The user can edit the name before approving.

6. For conversational responses: plain text (markdown OK).

QUERY RULES:
- SELECT statements only
- Always reference: {table}
- Always filter: WHERE analysis_id = '{analysis_id}'
- No SQL comments (-- or /* */)"""


class GapChatMessageRequest(BaseModel):
    message: str
    history: Optional[List[HistoryItem]] = None
    context: Optional[Dict[str, Any]] = None  # filter executions + available filters


class GapPeekRequest(BaseModel):
    rows: list
    columns: List[str]
    preview_rows: int
    explanation: Optional[str] = None
    include_images: bool = False
    history: Optional[List[HistoryItem]] = None
    context: Optional[Dict[str, Any]] = None


class GapCreateDatasetRequest(BaseModel):
    name: str
    items: List[str]  # item_text strings from the current view


# ---------------------------------------------------------------------------
# Gap analysis endpoints
# ---------------------------------------------------------------------------

@gap_chat_router.post("/{analysis_id}/chat/message")
def gap_chat_message(analysis_id: str, payload: GapChatMessageRequest):
    """Send a user message to the gap analysis agent.

    Returns one of:
    - {"type": "query", "sql": "...", "explanation": "..."}
    - {"type": "peek", "explanation": "...", "preview_rows": N}
    - {"type": "toggle_filter", "execution_id": "...", "name": "...", "mode": "...", "reason": "..."}
    - {"type": "create_filter_execution", "filter_id": "...", "name": "...", "reason": "..."}
    - {"type": "create_dataset", "name": "..."}
    - {"type": "reply", "text": "..."}
    """
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    doc = db.collection("gap_analyses").document(analysis_id).get()
    if not doc.exists:
        raise HTTPException(404, f"Gap analysis {analysis_id} not found")
    d = doc.to_dict()
    analysis_name = d.get("name", "Unnamed")
    source_name = d.get("source_dataset_name", "Source")
    target_name = d.get("target_dataset_name", "Target")

    # Build filter context from payload
    ctx = payload.context or {}
    executions = ctx.get("executions", [])
    available_filters = ctx.get("available_filters", [])

    if executions:
        filter_context = "\n".join(
            f"  - {e.get('name', e.get('id', '?'))} (execution_id={e.get('id', '?')}, current_mode={e.get('current_mode', 'any')})"
            for e in executions
        )
    else:
        filter_context = "  (none run yet)"

    if available_filters:
        available_filters_text = "\n".join(
            f"  - {f.get('name', '?')} (filter_id={f.get('id', '?')})"
            for f in available_filters
        )
    else:
        available_filters_text = "  (none available)"

    gap_type_context = _get_chat_type_prompt("gap_analysis")
    system = _GAP_SYSTEM_PROMPT.format(
        analysis_name=analysis_name,
        analysis_id=analysis_id,
        source_name=source_name,
        target_name=target_name,
        table=_TABLE_GAP,
        filter_context=filter_context,
        available_filters=available_filters_text,
        type_context=gap_type_context or "(No additional context configured.)",
    )
    history_block = _build_history_block(payload.history)
    prompt = f"{system}{history_block}\n\nUser: {payload.message}\nAssistant:"

    raw = _call_gemini(prompt)
    action = _parse_action(raw)

    if action:
        act_type = action.get("action")
        if act_type == "query" and "sql" in action:
            try:
                sql = _validate_sql(action["sql"].strip())
            except ValueError as exc:
                return {"type": "reply", "text": f"I tried to write a query but it was blocked for safety: {exc}. Please rephrase."}
            return {"type": "query", "sql": sql, "explanation": action.get("explanation", "")}

        elif act_type == "peek":
            preview_rows = max(1, min(int(action.get("preview_rows", 25)), 500))
            include_images = bool(action.get("include_images", False))
            return {"type": "peek", "explanation": action.get("explanation", ""), "preview_rows": preview_rows, "include_images": include_images}

        elif act_type == "toggle_filter":
            mode = action.get("mode", "any")
            if mode not in ("true", "false", "any"):
                mode = "any"
            return {
                "type": "toggle_filter",
                "execution_id": action.get("execution_id", ""),
                "name": action.get("name", ""),
                "mode": mode,
                "reason": action.get("reason", ""),
            }

        elif act_type == "create_filter_execution":
            return {
                "type": "create_filter_execution",
                "filter_id": action.get("filter_id", ""),
                "name": action.get("name", ""),
                "reason": action.get("reason", ""),
            }

        elif act_type == "create_dataset":
            name = action.get("name") or f"Subset from {analysis_name}"
            return {"type": "create_dataset", "name": name}

    return {"type": "reply", "text": raw}


@gap_chat_router.post("/{analysis_id}/chat/peek")
def gap_chat_peek(analysis_id: str, payload: GapPeekRequest):
    """Receive pre-fetched gap result rows, feed them to Gemini for analysis."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    doc = db.collection("gap_analyses").document(analysis_id).get()
    if not doc.exists:
        raise HTTPException(404, f"Gap analysis {analysis_id} not found")
    d = doc.to_dict()
    analysis_name = d.get("name", "Unnamed")
    source_name = d.get("source_dataset_name", "Source")
    target_name = d.get("target_dataset_name", "Target")

    rows = payload.rows
    col_names = payload.columns
    preview_rows = len(rows)

    header = " | ".join(col_names)
    separator = "-" * min(len(header), 120)
    table_lines = [header, separator]
    for row in rows:
        values = [str(row.get(col, "") or "") for col in col_names]
        table_lines.append(" | ".join(values))
    data_text = "\n".join(table_lines)
    data_block = f"[PEEK RESULTS — {preview_rows} rows from current gap analysis view]\n{data_text}"
    if payload.explanation:
        data_block = f"[Peek reason: {payload.explanation}]\n{data_block}"

    ctx = payload.context or {}
    executions = ctx.get("executions", [])
    available_filters = ctx.get("available_filters", [])
    filter_context = "\n".join(
        f"  - {e.get('name', '?')} (mode={e.get('current_mode', 'any')})" for e in executions
    ) or "  (none)"
    available_filters_text = "\n".join(
        f"  - {f.get('name', '?')}" for f in available_filters
    ) or "  (none)"

    gap_type_context = _get_chat_type_prompt("gap_analysis")
    system = _GAP_SYSTEM_PROMPT.format(
        analysis_name=analysis_name,
        analysis_id=analysis_id,
        source_name=source_name,
        target_name=target_name,
        table=_TABLE_GAP,
        filter_context=filter_context,
        available_filters=available_filters_text,
        type_context=gap_type_context or "(No additional context configured.)",
    )
    history_block = _build_history_block(payload.history)
    prompt = (
        f"{system}{history_block}\n\n"
        f"Assistant: [Ran peek. Here are the results:]\n{data_block}\n\n"
        f"Assistant (analysis):"
    )

    if payload.include_images:
        image_data = _download_images_for_peek(rows, col_names)
        if image_data:
            image_parts = [(b, m) for b, m, _ in image_data]
            prompt += f"\n[{len(image_parts)} image(s) attached above in the order they appear in the table.]"
            analysis = _call_gemini_multimodal(prompt, image_parts, temperature=0.2, max_tokens=4096)
        else:
            analysis = _call_gemini(prompt, temperature=0.2, max_tokens=4096)
    else:
        analysis = _call_gemini(prompt, temperature=0.2, max_tokens=4096)

    return {"type": "reply", "text": analysis, "peek_rows": preview_rows}


@gap_chat_router.post("/{analysis_id}/chat/create-dataset")
def gap_chat_create_dataset(
    analysis_id: str,
    payload: GapCreateDatasetRequest,
    background_tasks: BackgroundTasks,
):
    """Create a new text_list dataset from the current gap analysis view items."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    # Verify analysis exists
    if not db.collection("gap_analyses").document(analysis_id).get().exists:
        raise HTTPException(404, f"Gap analysis {analysis_id} not found")

    items = list(dict.fromkeys(i.strip() for i in payload.items if i.strip()))
    if not items:
        raise HTTPException(400, "items must not be empty")

    new_id = str(uuid.uuid4())
    db.collection("datasets").document(new_id).set({
        "dataset_id": new_id,
        "name": payload.name.strip(),
        "type": "text_list",
        "status": "processing",
        "item_count": 0,
        "source_config": {"parent_analysis_id": analysis_id, "source": "agent_cut"},
        "created_at": firestore.SERVER_TIMESTAMP,
        "updated_at": firestore.SERVER_TIMESTAMP,
        "error_message": None,
    })
    background_tasks.add_task(_insert_new_dataset_items, new_id, items)
    return {"dataset_id": new_id, "name": payload.name, "item_count": len(items)}
