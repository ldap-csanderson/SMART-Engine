"""Gap analysis endpoints and background pipeline (v3)."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from google.cloud import firestore
from pydantic import BaseModel

from db import db, bq_client, ts_to_str, PROJECT_ID, DATASET_ID, T_GAP_ANALYSIS, T_FILTER_RESULTS, T_DATASET_ITEMS, SEARCH_VOLUME_TYPES
from bq_ml import run_gap_analysis_pipeline, run_filter_pipeline, get_default_prompt_for_type

router = APIRouter(prefix="/gap-analyses", tags=["gap-analysis"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class GapAnalysisCreate(BaseModel):
    name: str
    source_dataset_id: str
    target_dataset_id: str        # dataset_id OR group_id
    target_is_group: bool = False
    filter_ids: Optional[List[str]] = None
    min_monthly_searches: int = 1000


class GapAnalysisEstimateRequest(BaseModel):
    source_dataset_id: str
    min_monthly_searches: int = 1000


class GapAnalysisEstimateResponse(BaseModel):
    unique_items: int
    estimated_llm_cost_usd: float
    estimated_embedding_cost_usd: float
    estimated_cost_usd: float


class GapAnalysis(BaseModel):
    analysis_id: str
    name: str
    source_dataset_id: str
    source_dataset_name: str
    source_dataset_type: str
    target_dataset_id: str
    target_dataset_name: str
    target_is_group: bool
    status: str
    created_at: str
    total_items_analyzed: int
    min_monthly_searches: Optional[int] = None
    error_message: Optional[str] = None


class GapAnalysisListResponse(BaseModel):
    analyses: List[GapAnalysis]
    total_count: int


class PortfolioMatch(BaseModel):
    item: Optional[str] = None
    intent: Optional[str] = None
    distance: Optional[float] = None


class GapAnalysisResult(BaseModel):
    keyword_text: str
    keyword_intent: Optional[str] = None
    portfolio_matches: List[PortfolioMatch] = []
    semantic_distance: Optional[float] = None
    avg_monthly_searches: Optional[int] = None


class GapAnalysisResultsResponse(BaseModel):
    analysis_id: str
    results: List[GapAnalysisResult]
    total_count: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_prompts_for_type(dataset_type: str) -> str:
    """Get the intent prompt for a dataset type, checking Firestore settings first."""
    if not db:
        return get_default_prompt_for_type(dataset_type)
    # Check for custom prompt override in settings
    doc = db.collection("settings").document("prompts").get()
    if doc.exists:
        d = doc.to_dict()
        key = f"{dataset_type}_intent_prompt"
        if key in d and d[key]:
            return d[key]
    return get_default_prompt_for_type(dataset_type)


def _run_filter_execution(execution_id: str, analysis_id: str, filter_snapshot: dict):
    """Run a single filter execution in the background and update Firestore."""
    label = filter_snapshot.get("label", execution_id)
    print(f"🔄 Filter execution {execution_id} started (label={label})")

    def on_batch_complete(rows_done: int):
        try:
            db.collection("filter_executions").document(execution_id).update({
                "total_evaluated": rows_done,
            })
        except Exception as e:
            print(f"⚠️ Could not update filter execution progress: {e}")

    try:
        count = run_filter_pipeline(
            execution_id=execution_id,
            analysis_id=analysis_id,
            filter_snapshot=filter_snapshot,
            on_batch_complete=on_batch_complete,
        )
        db.collection("filter_executions").document(execution_id).update({
            "status": "completed",
            "total_evaluated": count,
        })
        print(f"✅ Filter execution {execution_id} completed — {count} rows")
    except Exception as e:
        print(f"❌ Filter execution {execution_id} failed: {e}")
        try:
            db.collection("filter_executions").document(execution_id).update({
                "status": "failed",
                "error_message": str(e),
            })
        except Exception:
            pass


def _run_analysis_background(
    analysis_id: str,
    source_dataset_id: str,
    source_dataset_type: str,
    target_dataset_ids: List[str],
    target_dataset_type: str,
    filter_ids: Optional[List[str]] = None,
    min_monthly_searches: int = 1000,
):
    """Background task: run the full gap analysis pipeline, then any chained filters."""
    print(f"🔄 Gap analysis {analysis_id} started")
    try:
        # Pre-count source items
        if bq_client:
            try:
                search_vol_filter = ""
                if source_dataset_type in SEARCH_VOLUME_TYPES and min_monthly_searches > 0:
                    search_vol_filter = f"AND avg_monthly_searches >= {min_monthly_searches}"
                kw_rows = bq_client.query(f"""
                    SELECT COUNT(DISTINCT item_text)
                    FROM `{PROJECT_ID}.{DATASET_ID}.{T_DATASET_ITEMS}`
                    WHERE dataset_id = '{source_dataset_id}'
                      {search_vol_filter}
                """).result()
                kw_count = list(kw_rows)[0][0] or 0
                db.collection("gap_analyses").document(analysis_id).update({
                    "total_items_analyzed": kw_count,
                })
                print(f"📊 Pre-counted {kw_count} source items")
            except Exception as _e:
                print(f"⚠️ Could not pre-count source items: {_e}")

        source_prompt = _get_prompts_for_type(source_dataset_type)
        target_prompt = _get_prompts_for_type(target_dataset_type)

        count = run_gap_analysis_pipeline(
            analysis_id=analysis_id,
            source_dataset_id=source_dataset_id,
            target_dataset_ids=target_dataset_ids,
            source_prompt=source_prompt,
            target_prompt=target_prompt,
            source_dataset_type=source_dataset_type,
            min_monthly_searches=min_monthly_searches,
        )
        db.collection("gap_analyses").document(analysis_id).update({
            "status": "completed",
            "total_items_analyzed": count,
        })
        print(f"✅ Gap analysis {analysis_id} completed — {count} rows")
    except Exception as e:
        print(f"❌ Gap analysis {analysis_id} failed: {e}")
        try:
            db.collection("gap_analyses").document(analysis_id).update({
                "status": "failed",
                "error_message": str(e),
            })
        except Exception:
            pass
        return

    # Chain filter executions if requested
    if filter_ids:
        for filter_id in filter_ids:
            try:
                fdoc = db.collection("filters").document(filter_id).get()
                if not fdoc.exists:
                    print(f"⚠️ Filter {filter_id} not found — skipping")
                    continue
                fd = fdoc.to_dict()
                filter_snapshot = {
                    "name": fd["name"],
                    "label": fd["label"],
                    "text": fd["text"],
                }
                execution_id = str(uuid.uuid4())
                db.collection("filter_executions").document(execution_id).set({
                    "execution_id": execution_id,
                    "analysis_id": analysis_id,
                    "filter_id": filter_id,
                    "filter_snapshot": filter_snapshot,
                    "status": "processing",
                    "created_at": firestore.SERVER_TIMESTAMP,
                    "total_evaluated": 0,
                    "error_message": None,
                })
                _run_filter_execution(execution_id, analysis_id, filter_snapshot)
            except Exception as e:
                print(f"⚠️ Failed to chain filter {filter_id} on analysis {analysis_id}: {e}")


def _doc_to_gap_analysis(d: dict) -> GapAnalysis:
    return GapAnalysis(
        analysis_id=d["analysis_id"],
        name=d.get("name", ""),
        source_dataset_id=d.get("source_dataset_id", ""),
        source_dataset_name=d.get("source_dataset_name", ""),
        source_dataset_type=d.get("source_dataset_type", ""),
        target_dataset_id=d.get("target_dataset_id", ""),
        target_dataset_name=d.get("target_dataset_name", ""),
        target_is_group=d.get("target_is_group", False),
        status=d.get("status", ""),
        created_at=ts_to_str(d["created_at"]),
        total_items_analyzed=d.get("total_items_analyzed", 0),
        min_monthly_searches=d.get("min_monthly_searches"),
        error_message=d.get("error_message"),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=GapAnalysis)
def create_gap_analysis(payload: GapAnalysisCreate, background_tasks: BackgroundTasks):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    if not bq_client:
        raise HTTPException(503, "BigQuery not initialized")

    # Verify source dataset
    src_doc = db.collection("datasets").document(payload.source_dataset_id).get()
    if not src_doc.exists:
        raise HTTPException(404, f"Source dataset {payload.source_dataset_id} not found")
    src_data = src_doc.to_dict()
    if src_data.get("item_count", 0) == 0 and src_data.get("status") == "completed":
        raise HTTPException(400, "Source dataset is empty.")

    source_dataset_type = src_data.get("type", "text_list")

    # Resolve target: dataset or group
    target_dataset_ids = []
    target_dataset_name = ""
    target_dataset_type = "text_list"

    if payload.target_is_group:
        grp_doc = db.collection("dataset_groups").document(payload.target_dataset_id).get()
        if not grp_doc.exists:
            raise HTTPException(404, f"Dataset group {payload.target_dataset_id} not found")
        grp_data = grp_doc.to_dict()
        target_dataset_ids = grp_data.get("dataset_ids", [])
        target_dataset_name = grp_data.get("name", "")
        if not target_dataset_ids:
            raise HTTPException(400, "Target dataset group is empty.")
        # Use the type of the first dataset in the group for prompt selection
        first_ds = db.collection("datasets").document(target_dataset_ids[0]).get()
        if first_ds.exists:
            target_dataset_type = first_ds.to_dict().get("type", "text_list")
    else:
        tgt_doc = db.collection("datasets").document(payload.target_dataset_id).get()
        if not tgt_doc.exists:
            raise HTTPException(404, f"Target dataset {payload.target_dataset_id} not found")
        tgt_data = tgt_doc.to_dict()
        if tgt_data.get("item_count", 0) == 0 and tgt_data.get("status") == "completed":
            raise HTTPException(400, "Target dataset is empty.")
        target_dataset_ids = [payload.target_dataset_id]
        target_dataset_name = tgt_data.get("name", "")
        target_dataset_type = tgt_data.get("type", "text_list")

    # Validate filter IDs if provided
    if payload.filter_ids:
        for filter_id in payload.filter_ids:
            if not db.collection("filters").document(filter_id).get().exists:
                raise HTTPException(404, f"Filter {filter_id} not found")

    analysis_id = str(uuid.uuid4())
    db.collection("gap_analyses").document(analysis_id).set({
        "analysis_id": analysis_id,
        "name": payload.name,
        "source_dataset_id": payload.source_dataset_id,
        "source_dataset_name": src_data.get("name", ""),
        "source_dataset_type": source_dataset_type,
        "target_dataset_id": payload.target_dataset_id,
        "target_dataset_name": target_dataset_name,
        "target_is_group": payload.target_is_group,
        "min_monthly_searches": payload.min_monthly_searches,
        "status": "processing",
        "created_at": firestore.SERVER_TIMESTAMP,
        "total_items_analyzed": 0,
        "error_message": None,
    })

    background_tasks.add_task(
        _run_analysis_background,
        analysis_id,
        payload.source_dataset_id,
        source_dataset_type,
        target_dataset_ids,
        target_dataset_type,
        payload.filter_ids,
        payload.min_monthly_searches,
    )

    doc = db.collection("gap_analyses").document(analysis_id).get().to_dict()
    return _doc_to_gap_analysis(doc)


@router.post("/estimate", response_model=GapAnalysisEstimateResponse)
def estimate_gap_analysis(payload: GapAnalysisEstimateRequest):
    """Estimate cost for running a gap analysis on a source dataset."""
    if not bq_client:
        raise HTTPException(503, "BigQuery not initialized")
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    src_doc = db.collection("datasets").document(payload.source_dataset_id).get()
    if not src_doc.exists:
        raise HTTPException(404, f"Source dataset {payload.source_dataset_id} not found")
    src_type = src_doc.to_dict().get("type", "text_list")

    search_vol_filter = ""
    if src_type in SEARCH_VOLUME_TYPES and payload.min_monthly_searches > 0:
        search_vol_filter = f"AND avg_monthly_searches >= {payload.min_monthly_searches}"

    try:
        row = bq_client.query(f"""
            SELECT COUNT(DISTINCT item_text)
            FROM `{PROJECT_ID}.{DATASET_ID}.{T_DATASET_ITEMS}`
            WHERE dataset_id = '{payload.source_dataset_id}'
              {search_vol_filter}
        """).result()
        unique_items = list(row)[0][0] or 0
    except Exception as e:
        raise HTTPException(500, f"Failed to count items: {e}")

    llm_cost_per_item = (200 * 0.25 + 50 * 1.50) / 1_000_000
    estimated_llm_cost = round(unique_items * llm_cost_per_item, 2)
    emb_cost_per_item = 100 * 0.000025 / 1_000
    estimated_emb_cost = round(unique_items * emb_cost_per_item, 2)

    return GapAnalysisEstimateResponse(
        unique_items=unique_items,
        estimated_llm_cost_usd=estimated_llm_cost,
        estimated_embedding_cost_usd=estimated_emb_cost,
        estimated_cost_usd=round(estimated_llm_cost + estimated_emb_cost, 2),
    )


@router.get("", response_model=GapAnalysisListResponse)
def list_gap_analyses(source_dataset_id: Optional[str] = None, status: Optional[str] = None, limit: int = 100):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    try:
        query = (
            db.collection("gap_analyses")
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(limit)
        )
        docs = query.stream()
        analyses = []
        for doc in docs:
            d = doc.to_dict()
            if source_dataset_id and d.get("source_dataset_id") != source_dataset_id:
                continue
            doc_status = d.get("status", "")
            if status == "archived":
                if doc_status != "archived":
                    continue
            else:
                if doc_status == "archived":
                    continue
            analyses.append(_doc_to_gap_analysis(d))
        return GapAnalysisListResponse(analyses=analyses, total_count=len(analyses))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/{analysis_id}", response_model=GapAnalysis)
def get_gap_analysis(analysis_id: str):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    doc = db.collection("gap_analyses").document(analysis_id).get()
    if not doc.exists:
        raise HTTPException(404, f"Analysis {analysis_id} not found")
    return _doc_to_gap_analysis(doc.to_dict())


class FilterResultRow(BaseModel):
    keyword_text: str
    result: Optional[bool]
    confidence: Optional[str]


@router.get("/{analysis_id}/filter-executions/{execution_id}/results", response_model=List[FilterResultRow])
def get_filter_execution_results(analysis_id: str, execution_id: str):
    if not bq_client:
        raise HTTPException(503, "BigQuery not initialized")
    try:
        filter_table = f"`{PROJECT_ID}.{DATASET_ID}.{T_FILTER_RESULTS}`"
        rows = bq_client.query(f"""
            SELECT keyword_text, result, confidence
            FROM {filter_table}
            WHERE execution_id = '{execution_id}' AND analysis_id = '{analysis_id}'
        """).result()
        return [FilterResultRow(keyword_text=r.keyword_text, result=r.result, confidence=r.confidence) for r in rows]
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/{analysis_id}/results", response_model=GapAnalysisResultsResponse)
def get_gap_analysis_results(
    analysis_id: str,
    limit: int = 500,
    offset: int = 0,
    order_by: str = "semantic_distance",
    order_dir: str = "DESC",
    min_monthly_searches: int = 0,
    filter_execution_ids: Optional[List[str]] = Query(default=None),
    filter_execution_ids_false: Optional[List[str]] = Query(default=None),
):
    if not bq_client:
        raise HTTPException(503, "BigQuery not initialized")
    if order_dir.upper() not in ("ASC", "DESC"):
        raise HTTPException(400, "order_dir must be ASC or DESC")
    valid_cols = {"semantic_distance", "avg_monthly_searches", "keyword_text"}
    if order_by not in valid_cols:
        order_by = "semantic_distance"

    try:
        table = f"`{PROJECT_ID}.{DATASET_ID}.{T_GAP_ANALYSIS}`"
        filter_table = f"`{PROJECT_ID}.{DATASET_ID}.{T_FILTER_RESULTS}`"

        true_clause = ""
        if filter_execution_ids:
            ids_sql = ", ".join(f"'{eid}'" for eid in filter_execution_ids)
            n = len(filter_execution_ids)
            true_clause = f"""
            AND g.keyword_text IN (
              SELECT keyword_text
              FROM {filter_table}
              WHERE analysis_id = '{analysis_id}'
                AND execution_id IN ({ids_sql})
                AND result = TRUE
              GROUP BY keyword_text
              HAVING COUNT(DISTINCT execution_id) = {n}
            )"""

        false_clause = ""
        if filter_execution_ids_false:
            ids_sql_f = ", ".join(f"'{eid}'" for eid in filter_execution_ids_false)
            nf = len(filter_execution_ids_false)
            false_clause = f"""
            AND g.keyword_text IN (
              SELECT keyword_text
              FROM {filter_table}
              WHERE analysis_id = '{analysis_id}'
                AND execution_id IN ({ids_sql_f})
                AND result = FALSE
              GROUP BY keyword_text
              HAVING COUNT(DISTINCT execution_id) = {nf}
            )"""

        base_where = f"WHERE g.analysis_id = '{analysis_id}'"
        if min_monthly_searches > 0:
            base_where += f" AND g.avg_monthly_searches >= {min_monthly_searches}"

        rows = bq_client.query(f"""
            SELECT
              g.keyword_text,
              MIN(g.keyword_intent) AS keyword_intent,
              ARRAY_AGG(
                STRUCT(
                  g.closest_portfolio_item AS item,
                  g.closest_portfolio_intent AS intent,
                  g.semantic_distance AS distance
                )
                ORDER BY g.semantic_distance ASC
                LIMIT 3
              ) AS portfolio_matches,
              MIN(g.semantic_distance) AS semantic_distance,
              MAX(g.avg_monthly_searches) AS avg_monthly_searches
            FROM {table} g
            {base_where}
            {true_clause}
            {false_clause}
            GROUP BY g.keyword_text
            ORDER BY {order_by} {order_dir.upper()}
            LIMIT {limit} OFFSET {offset}
        """).result()

        results = [GapAnalysisResult(
            keyword_text=row.keyword_text,
            keyword_intent=row.keyword_intent,
            portfolio_matches=[
                PortfolioMatch(item=m["item"], intent=m["intent"], distance=m["distance"])
                for m in (row.portfolio_matches or [])
            ],
            semantic_distance=row.semantic_distance,
            avg_monthly_searches=row.avg_monthly_searches,
        ) for row in rows]

        total_rows = bq_client.query(f"""
            SELECT COUNT(DISTINCT g.keyword_text)
            FROM {table} g
            {base_where}
            {true_clause}
            {false_clause}
        """).result()
        total_count = list(total_rows)[0][0]

        return GapAnalysisResultsResponse(
            analysis_id=analysis_id, results=results, total_count=total_count
        )
    except Exception as e:
        raise HTTPException(500, str(e))


class RenameRequest(BaseModel):
    name: str


@router.patch("/{analysis_id}/rename")
def rename_gap_analysis(analysis_id: str, payload: RenameRequest):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("gap_analyses").document(analysis_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Analysis {analysis_id} not found")
    ref.update({"name": name})
    return {"analysis_id": analysis_id, "name": name}


@router.patch("/{analysis_id}/archive")
def archive_gap_analysis(analysis_id: str):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("gap_analyses").document(analysis_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Analysis {analysis_id} not found")
    ref.update({"status": "archived"})
    return {"message": f"Analysis {analysis_id} archived", "analysis_id": analysis_id}


@router.patch("/{analysis_id}/unarchive")
def unarchive_gap_analysis(analysis_id: str):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("gap_analyses").document(analysis_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Analysis {analysis_id} not found")
    ref.update({"status": "completed"})
    return {"message": f"Analysis {analysis_id} unarchived", "analysis_id": analysis_id}


@router.delete("/{analysis_id}")
def delete_gap_analysis(analysis_id: str):
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    if bq_client:
        try:
            bq_client.query(
                f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.{T_GAP_ANALYSIS}` "
                f"WHERE analysis_id = '{analysis_id}'"
            ).result()
        except Exception as e:
            print(f"⚠️ Could not delete BQ gap analysis rows for {analysis_id}: {e}")
        try:
            bq_client.query(
                f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.{T_FILTER_RESULTS}` "
                f"WHERE analysis_id = '{analysis_id}'"
            ).result()
        except Exception as e:
            print(f"⚠️ Could not delete BQ filter rows for {analysis_id}: {e}")

    if db:
        try:
            exec_docs = (
                db.collection("filter_executions")
                .where("analysis_id", "==", analysis_id)
                .stream()
            )
            for ed in exec_docs:
                ed.reference.delete()
        except Exception as e:
            print(f"⚠️ Could not delete filter_executions for {analysis_id}: {e}")

    ref = db.collection("gap_analyses").document(analysis_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Analysis {analysis_id} not found")
    ref.delete()
    return {"message": f"Analysis {analysis_id} deleted", "analysis_id": analysis_id}
