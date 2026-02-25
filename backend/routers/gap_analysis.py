"""Gap analysis endpoints and background pipeline."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, bq_client, ts_to_str, PROJECT_ID, DATASET_ID, T_GAP_ANALYSIS
from bq_ml import run_gap_analysis_pipeline

router = APIRouter(prefix="/gap-analyses", tags=["gap-analysis"])

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

_DEFAULT_PORTFOLIO_PROMPT = """Analyze this portfolio item and transform it into a user intent statement.

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


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class GapAnalysisCreate(BaseModel):
    report_id: str
    name: str


class GapAnalysis(BaseModel):
    analysis_id: str
    name: str
    report_id: str
    status: str
    created_at: str
    total_keywords_analyzed: int
    error_message: Optional[str] = None


class GapAnalysisListResponse(BaseModel):
    analyses: List[GapAnalysis]
    total_count: int


class GapAnalysisResult(BaseModel):
    keyword_text: str
    keyword_intent: Optional[str]
    closest_portfolio_item: Optional[str]
    closest_portfolio_intent: Optional[str]
    semantic_distance: Optional[float]
    avg_monthly_searches: Optional[int]


class GapAnalysisResultsResponse(BaseModel):
    analysis_id: str
    results: List[GapAnalysisResult]
    total_count: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_prompts() -> dict:
    """Fetch prompts from Firestore; fall back to defaults."""
    if not db:
        return {
            "keyword_intent_prompt": _DEFAULT_KEYWORD_PROMPT,
            "portfolio_intent_prompt": _DEFAULT_PORTFOLIO_PROMPT,
        }
    doc = db.collection("settings").document("prompts").get()
    if doc.exists:
        return doc.to_dict()
    return {
        "keyword_intent_prompt": _DEFAULT_KEYWORD_PROMPT,
        "portfolio_intent_prompt": _DEFAULT_PORTFOLIO_PROMPT,
    }


def _run_analysis_background(analysis_id: str, report_id: str):
    """Background task: run the full gap analysis pipeline."""
    print(f"🔄 Gap analysis {analysis_id} started")
    try:
        prompts = _get_prompts()
        count = run_gap_analysis_pipeline(
            analysis_id=analysis_id,
            report_id=report_id,
            keyword_prompt=prompts["keyword_intent_prompt"],
            portfolio_prompt=prompts["portfolio_intent_prompt"],
        )
        db.collection("gap_analyses").document(analysis_id).update({
            "status": "completed",
            "total_keywords_analyzed": count,
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=GapAnalysis)
def create_gap_analysis(payload: GapAnalysisCreate, background_tasks: BackgroundTasks):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    if not bq_client:
        raise HTTPException(503, "BigQuery not initialized")

    # Verify the keyword report exists
    report_doc = db.collection("keyword_reports").document(payload.report_id).get()
    if not report_doc.exists:
        raise HTTPException(404, f"Keyword report {payload.report_id} not found")

    # Check portfolio is not empty
    portfolio_count = bq_client.query(
        f"SELECT COUNT(*) FROM `{PROJECT_ID}.{DATASET_ID}.portfolio_items`"
    ).result()
    count = list(portfolio_count)[0][0]
    if count == 0:
        raise HTTPException(400, "Portfolio is empty. Add items to the portfolio before running an analysis.")

    analysis_id = str(uuid.uuid4())
    db.collection("gap_analyses").document(analysis_id).set({
        "analysis_id": analysis_id,
        "name": payload.name,
        "report_id": payload.report_id,
        "status": "processing",
        "created_at": firestore.SERVER_TIMESTAMP,
        "total_keywords_analyzed": 0,
        "error_message": None,
    })
    background_tasks.add_task(_run_analysis_background, analysis_id, payload.report_id)

    doc = db.collection("gap_analyses").document(analysis_id).get().to_dict()
    return GapAnalysis(
        analysis_id=doc["analysis_id"], name=doc["name"],
        report_id=doc["report_id"], status=doc["status"],
        created_at=ts_to_str(doc["created_at"]),
        total_keywords_analyzed=doc["total_keywords_analyzed"],
    )


@router.get("", response_model=GapAnalysisListResponse)
def list_gap_analyses(report_id: Optional[str] = None, limit: int = 100):
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
            if report_id and d.get("report_id") != report_id:
                continue
            analyses.append(GapAnalysis(
                analysis_id=d["analysis_id"], name=d.get("name", ""),
                report_id=d["report_id"], status=d["status"],
                created_at=ts_to_str(d["created_at"]),
                total_keywords_analyzed=d.get("total_keywords_analyzed", 0),
                error_message=d.get("error_message"),
            ))
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
    d = doc.to_dict()
    return GapAnalysis(
        analysis_id=d["analysis_id"], name=d.get("name", ""),
        report_id=d["report_id"], status=d["status"],
        created_at=ts_to_str(d["created_at"]),
        total_keywords_analyzed=d.get("total_keywords_analyzed", 0),
        error_message=d.get("error_message"),
    )


@router.get("/{analysis_id}/results", response_model=GapAnalysisResultsResponse)
def get_gap_analysis_results(
    analysis_id: str,
    limit: int = 500,
    offset: int = 0,
    order_by: str = "semantic_distance",
    order_dir: str = "DESC",
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
        rows = bq_client.query(f"""
            SELECT keyword_text, keyword_intent, closest_portfolio_item,
                   closest_portfolio_intent, semantic_distance, avg_monthly_searches
            FROM {table}
            WHERE analysis_id = '{analysis_id}'
            ORDER BY {order_by} {order_dir.upper()}
            LIMIT {limit} OFFSET {offset}
        """).result()

        results = [GapAnalysisResult(
            keyword_text=row.keyword_text,
            keyword_intent=row.keyword_intent,
            closest_portfolio_item=row.closest_portfolio_item,
            closest_portfolio_intent=row.closest_portfolio_intent,
            semantic_distance=row.semantic_distance,
            avg_monthly_searches=row.avg_monthly_searches,
        ) for row in rows]

        total = bq_client.query(
            f"SELECT COUNT(*) FROM {table} WHERE analysis_id = '{analysis_id}'"
        ).result()
        total_count = list(total)[0][0]

        return GapAnalysisResultsResponse(
            analysis_id=analysis_id, results=results, total_count=total_count
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/{analysis_id}")
def delete_gap_analysis(analysis_id: str):
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    # Delete BQ rows
    if bq_client:
        try:
            bq_client.query(
                f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.{T_GAP_ANALYSIS}` "
                f"WHERE analysis_id = '{analysis_id}'"
            ).result()
        except Exception as e:
            print(f"⚠️ Could not delete BQ rows for {analysis_id}: {e}")

    # Delete Firestore doc
    ref = db.collection("gap_analyses").document(analysis_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Analysis {analysis_id} not found")
    ref.delete()
    return {"message": f"Analysis {analysis_id} deleted", "analysis_id": analysis_id}
