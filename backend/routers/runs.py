"""
Compatibility router: /runs and /keyword-planner.

The homepage (RunsList / RunDetailPage) uses the older /api/runs endpoints.
The new KeywordReportsPage uses /api/keyword-reports.
Both read from the same Firestore 'keyword_reports' collection + BQ keyword_results.
"""
from routers.keyword_reports import (
    router as _kr_router,
    URLRequest,
    _insert_report_to_firestore,
    _insert_keywords_to_bq,
    _process_report_background,
)
from fastapi import APIRouter, BackgroundTasks, HTTPException
from google.cloud import firestore
from typing import Optional
import uuid
from datetime import datetime, timezone

from db import db, bq_client, ts_to_str, CUSTOMER_ID, PROJECT_ID, DATASET_ID, T_RESULTS, config, ga_client

router = APIRouter(tags=["runs"])


# ---------------------------------------------------------------------------
# GET /runs — list (mirrors /keyword-reports)
# ---------------------------------------------------------------------------

@router.get("/runs")
def list_runs(status: Optional[str] = None, limit: int = 100):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    docs = (
        db.collection("keyword_reports")
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(limit * 2)
        .stream()
    )
    runs = []
    for doc in docs:
        d = doc.to_dict()
        if status:
            if d.get("status") != status:
                continue
        else:
            if d.get("status") == "archived":
                continue
        if len(runs) >= limit:
            break
        runs.append({
            "run_id": d["report_id"],
            "name": d.get("name", ""),
            "created_at": ts_to_str(d["created_at"]),
            "status": d["status"],
            "urls": d["urls"],
            "total_keywords_found": d["total_keywords_found"],
            "error_message": d.get("error_message"),
        })
    return {"runs": runs, "total_count": len(runs)}


# ---------------------------------------------------------------------------
# GET /runs/{run_id}/keywords
# ---------------------------------------------------------------------------

@router.get("/runs/{run_id}/keywords")
def get_run_keywords(run_id: str):
    if not db or not bq_client:
        raise HTTPException(503, "Service not initialized")
    report_doc = db.collection("keyword_reports").document(run_id).get()
    if not report_doc.exists:
        raise HTTPException(404, f"Run {run_id} not found")
    rd = report_doc.to_dict()

    rows = bq_client.query(f"""
        SELECT source_url, keyword_text, avg_monthly_searches, competition,
               competition_index, low_top_of_page_bid_usd, high_top_of_page_bid_usd
        FROM `{PROJECT_ID}.{DATASET_ID}.{T_RESULTS}`
        WHERE run_id = '{run_id}'
        ORDER BY source_url, avg_monthly_searches DESC
    """).result()

    by_url = {}
    for row in rows:
        by_url.setdefault(row.source_url, []).append({
            "keyword_text": row.keyword_text,
            "avg_monthly_searches": row.avg_monthly_searches,
            "competition": row.competition,
            "competition_index": row.competition_index,
            "low_top_of_page_bid_usd": row.low_top_of_page_bid_usd,
            "high_top_of_page_bid_usd": row.high_top_of_page_bid_usd,
        })

    return {
        "run_id": rd["report_id"],
        "name": rd.get("name", ""),
        "created_at": ts_to_str(rd["created_at"]),
        "status": rd["status"],
        "urls": rd["urls"],
        "total_keywords_found": rd["total_keywords_found"],
        "keywords": by_url,
    }


# ---------------------------------------------------------------------------
# PATCH /runs/{run_id}/archive|unarchive
# ---------------------------------------------------------------------------

@router.patch("/runs/{run_id}/archive")
def archive_run(run_id: str):
    ref = db.collection("keyword_reports").document(run_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Run {run_id} not found")
    ref.update({"status": "archived"})
    return {"message": f"Run {run_id} archived", "run_id": run_id}


@router.patch("/runs/{run_id}/unarchive")
def unarchive_run(run_id: str):
    ref = db.collection("keyword_reports").document(run_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Run {run_id} not found")
    ref.update({"status": "completed"})
    return {"message": f"Run {run_id} unarchived", "run_id": run_id}


# ---------------------------------------------------------------------------
# POST /keyword-planner — legacy alias for POST /keyword-reports
# ---------------------------------------------------------------------------

@router.post("/keyword-planner")
def create_run_via_keyword_planner(request: URLRequest, background_tasks: BackgroundTasks):
    if ga_client is None:
        raise HTTPException(503, "Google Ads client not initialized")
    if not request.urls:
        raise HTTPException(400, "No URLs provided")

    report_id = str(uuid.uuid4())
    name = request.name or f"Run {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}"
    _insert_report_to_firestore(report_id, name, request.urls, 0, status="processing")
    background_tasks.add_task(_process_report_background, report_id, request.urls)

    return {"run_id": report_id, "status": "processing", "name": name}
