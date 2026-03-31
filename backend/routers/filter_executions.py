"""Filter execution endpoints — run LLM filters against a gap analysis."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, bq_client, ts_to_str, PROJECT_ID, DATASET_ID, T_FILTER_RESULTS
from bq_ml import run_filter_pipeline

router = APIRouter(prefix="/gap-analyses", tags=["filter-executions"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class FilterExecutionCreate(BaseModel):
    filter_ids: List[str]


class FilterExecution(BaseModel):
    execution_id: str
    analysis_id: str
    filter_id: str
    filter_snapshot: dict
    status: str
    created_at: str
    total_evaluated: int
    error_message: Optional[str] = None


class FilterExecutionListResponse(BaseModel):
    executions: List[FilterExecution]
    total_count: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _doc_to_fe(d: dict) -> FilterExecution:
    return FilterExecution(
        execution_id=d["execution_id"],
        analysis_id=d["analysis_id"],
        filter_id=d["filter_id"],
        filter_snapshot=d["filter_snapshot"],
        status=d["status"],
        created_at=ts_to_str(d["created_at"]),
        total_evaluated=d.get("total_evaluated", 0),
        error_message=d.get("error_message"),
    )


def _run_filter_background(execution_id: str, analysis_id: str, filter_snapshot: dict):
    """Background task: run a single filter pipeline and update Firestore."""
    label = filter_snapshot.get("label", execution_id)
    print(f"🔄 Filter execution {execution_id} started (label={label})")
    try:
        count = run_filter_pipeline(
            execution_id=execution_id,
            analysis_id=analysis_id,
            filter_snapshot=filter_snapshot,
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/{analysis_id}/filter-executions", response_model=List[FilterExecution])
def create_filter_executions(
    analysis_id: str,
    payload: FilterExecutionCreate,
):
    """
    Run one or more filters against a completed gap analysis.
    Fails with 409 if any filter's label or name already has an execution
    (processing or completed) on this analysis.
    """
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    if not bq_client:
        raise HTTPException(503, "BigQuery not initialized")
    if not payload.filter_ids:
        raise HTTPException(400, "filter_ids must not be empty")

    # Verify analysis exists
    analysis_doc = db.collection("gap_analyses").document(analysis_id).get()
    if not analysis_doc.exists:
        raise HTTPException(404, f"Gap analysis {analysis_id} not found")

    ad = analysis_doc.to_dict()
    if ad.get("status") not in ("completed",):
        raise HTTPException(400, f"Gap analysis must be completed before running filters (status={ad.get('status')})")

    # Resolve filter documents
    filter_snapshots = []
    for filter_id in payload.filter_ids:
        fdoc = db.collection("filters").document(filter_id).get()
        if not fdoc.exists:
            raise HTTPException(404, f"Filter {filter_id} not found")
        fd = fdoc.to_dict()
        filter_snapshots.append({
            "filter_id": filter_id,
            "snapshot": {
                "name": fd["name"],
                "label": fd["label"],
                "text": fd["text"],
            },
        })

    # Collision check: reject if any label or name is already used on this analysis
    existing_execs = (
        db.collection("filter_executions")
        .where("analysis_id", "==", analysis_id)
        .where("status", "in", ["processing", "completed"])
        .stream()
    )
    existing_labels = set()
    existing_names = set()
    for ex in existing_execs:
        ed = ex.to_dict()
        snap = ed.get("filter_snapshot", {})
        if snap.get("label"):
            existing_labels.add(snap["label"])
        if snap.get("name"):
            existing_names.add(snap["name"])

    for fs in filter_snapshots:
        snap = fs["snapshot"]
        if snap["label"] in existing_labels:
            raise HTTPException(
                409,
                f"A filter with label '{snap['label']}' has already been run on this analysis.",
            )
        if snap["name"] in existing_names:
            raise HTTPException(
                409,
                f"A filter with name '{snap['name']}' has already been run on this analysis.",
            )

    # Create executions and trigger jobs
    from jobs import trigger_job, JOB_FILTER_EXECUTION
    created = []
    for fs in filter_snapshots:
        execution_id = str(uuid.uuid4())
        db.collection("filter_executions").document(execution_id).set({
            "execution_id": execution_id,
            "analysis_id": analysis_id,
            "filter_id": fs["filter_id"],
            "filter_snapshot": fs["snapshot"],
            "status": "processing",
            "created_at": firestore.SERVER_TIMESTAMP,
            "total_evaluated": 0,
            "error_message": None,
        })
        trigger_job(JOB_FILTER_EXECUTION, {
            "execution_id": execution_id,
            "analysis_id": analysis_id,
            "filter_snapshot": fs["snapshot"],
        })
        doc = db.collection("filter_executions").document(execution_id).get().to_dict()
        created.append(_doc_to_fe(doc))

    return created


@router.get("/{analysis_id}/filter-executions", response_model=FilterExecutionListResponse)
def list_filter_executions(analysis_id: str):
    """List all filter executions for a gap analysis."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    # Verify analysis exists
    if not db.collection("gap_analyses").document(analysis_id).get().exists:
        raise HTTPException(404, f"Gap analysis {analysis_id} not found")

    try:
        docs = (
            db.collection("filter_executions")
            .where("analysis_id", "==", analysis_id)
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .stream()
        )
        executions = [_doc_to_fe(d.to_dict()) for d in docs]
        return FilterExecutionListResponse(executions=executions, total_count=len(executions))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/{analysis_id}/filter-executions/{execution_id}")
def delete_filter_execution(analysis_id: str, execution_id: str):
    """Delete a filter execution and its BQ rows."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    ref = db.collection("filter_executions").document(execution_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(404, f"Filter execution {execution_id} not found")
    ed = doc.to_dict()
    if ed.get("analysis_id") != analysis_id:
        raise HTTPException(404, f"Filter execution {execution_id} does not belong to analysis {analysis_id}")

    # Delete BQ rows
    if bq_client:
        try:
            bq_client.query(
                f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.{T_FILTER_RESULTS}` "
                f"WHERE execution_id = '{execution_id}'"
            ).result()
        except Exception as e:
            print(f"⚠️ Could not delete BQ rows for filter execution {execution_id}: {e}")

    ref.delete()
    return {"message": f"Filter execution {execution_id} deleted", "execution_id": execution_id}
