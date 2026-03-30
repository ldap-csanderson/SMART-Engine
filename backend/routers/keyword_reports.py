"""Keyword reports endpoints."""
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from google.ads.googleads.errors import GoogleAdsException
from google.cloud import firestore
from pydantic import BaseModel

from db import (
    ga_client, ga_auth_manager, bq_client, db, ts_to_str,
    CUSTOMER_ID, MAX_RETRIES, RETRY_DELAY,
    PROJECT_ID, DATASET_ID, T_RESULTS, config,
)

router = APIRouter(prefix="/keyword-reports", tags=["keyword-reports"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class URLRequest(BaseModel):
    urls: List[str]
    name: Optional[str] = None


class KeywordReport(BaseModel):
    report_id: str
    name: str
    created_at: str
    status: str
    urls: List[str]
    total_keywords_found: int
    error_message: Optional[str] = None


class KeywordReportsListResponse(BaseModel):
    reports: List[KeywordReport]
    total_count: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _insert_report_to_firestore(
    report_id: str, name: str, urls: List[str],
    total_keywords: int, status: str = "completed",
    error_message: Optional[str] = None
):
    if not db:
        return
    db.collection("keyword_reports").document(report_id).set({
        "report_id": report_id,
        "name": name,
        "created_at": firestore.SERVER_TIMESTAMP,
        "status": status,
        "urls": urls,
        "total_keywords_found": total_keywords,
        "error_message": error_message,
    })


def _insert_keywords_to_bq(report_id: str, url: str, keywords: List[Dict[str, Any]]):
    if not bq_client or not keywords:
        return
    table_id = f"{PROJECT_ID}.{DATASET_ID}.{T_RESULTS}"
    timestamp = datetime.now(timezone.utc).isoformat()
    rows = [{
        "run_id": report_id,
        "created_at": timestamp,
        "source_url": url,
        "keyword_text": kw["keyword_text"],
        "avg_monthly_searches": kw.get("avg_monthly_searches"),
        "competition": kw.get("competition"),
        "competition_index": kw.get("competition_index"),
        "low_top_of_page_bid_usd": kw.get("low_top_of_page_bid_usd"),
        "high_top_of_page_bid_usd": kw.get("high_top_of_page_bid_usd"),
    } for kw in keywords]
    errors = bq_client.insert_rows_json(table_id, rows)
    if errors:
        print(f"❌ BQ insert errors: {errors}")
    else:
        print(f"✅ Inserted {len(rows)} keywords to BQ")


def _fetch_keyword_ideas(client, customer_id: str, url: str, retry: int = 0, auth_retry: bool = False) -> List[Dict]:
    keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")
    request = client.get_type("GenerateKeywordIdeasRequest")
    request.customer_id = customer_id
    request.url_seed.url = url
    request.language = client.get_service("GoogleAdsService").language_constant_path("1000")
    request.geo_target_constants.append(
        client.get_service("GoogleAdsService").geo_target_constant_path("2840")
    )
    try:
        response = keyword_plan_idea_service.generate_keyword_ideas(request=request)
        ideas = []
        for idea in response:
            m = idea.keyword_idea_metrics
            ideas.append({
                "keyword_text": idea.text,
                "avg_monthly_searches": m.avg_monthly_searches if m else None,
                "competition": m.competition.name if m and m.competition else None,
                "competition_index": m.competition_index if m else None,
                "low_top_of_page_bid_usd": m.low_top_of_page_bid_micros / 1_000_000 if m and m.low_top_of_page_bid_micros else None,
                "high_top_of_page_bid_usd": m.high_top_of_page_bid_micros / 1_000_000 if m and m.high_top_of_page_bid_micros else None,
            })
        return ideas
    except GoogleAdsException as ex:
        # Check if this is an authentication error (401/UNAUTHENTICATED)
        error_msg = str(ex)
        is_auth_error = (
            "UNAUTHENTICATED" in error_msg or 
            "401" in error_msg or
            "invalid_grant" in error_msg or
            "Request had invalid authentication credentials" in error_msg
        )
        
        if is_auth_error and not auth_retry and ga_auth_manager:
            print(f"🔄 Authentication error detected, attempting to refresh token...")
            if ga_auth_manager.handle_auth_error():
                # Token refreshed successfully, retry with new client
                refreshed_client = ga_auth_manager.client
                if refreshed_client:
                    print(f"✅ Retrying request with refreshed token...")
                    return _fetch_keyword_ideas(refreshed_client, customer_id, url, retry, auth_retry=True)
            else:
                print(f"❌ Failed to refresh authentication token")
        
        print(f"❌ Error fetching keywords: {ex}")
        if retry < MAX_RETRIES:
            time.sleep(RETRY_DELAY)
            return _fetch_keyword_ideas(client, customer_id, url, retry + 1, auth_retry)
        return []
    except Exception as ex:
        print(f"❌ Error fetching keywords: {ex}")
        if retry < MAX_RETRIES:
            time.sleep(RETRY_DELAY)
            return _fetch_keyword_ideas(client, customer_id, url, retry + 1, auth_retry)
        return []


def _process_report_background(report_id: str, urls: List[str]):
    total = 0
    try:
        for i, url in enumerate(urls):
            print(f"[{i+1}/{len(urls)}] Processing: {url}")
            keywords = _fetch_keyword_ideas(ga_client, CUSTOMER_ID, url)
            _insert_keywords_to_bq(report_id, url, keywords)
            total += len(keywords)
            if i < len(urls) - 1:
                time.sleep(1)
        db.collection("keyword_reports").document(report_id).update({
            "status": "completed", "total_keywords_found": total,
        })
        print(f"✅ Report {report_id} completed — {total} keywords")
    except Exception as e:
        print(f"❌ Background processing failed for {report_id}: {e}")
        try:
            db.collection("keyword_reports").document(report_id).update({
                "status": "failed", "error_message": str(e),
            })
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=KeywordReport)
def create_keyword_report(request: URLRequest, background_tasks: BackgroundTasks):
    if ga_client is None:
        raise HTTPException(503, "Google Ads client not initialized")
    if not request.urls:
        raise HTTPException(400, "No URLs provided")
    if len(request.urls) > config["api"]["max_urls_per_request"]:
        raise HTTPException(400, f"Maximum {config['api']['max_urls_per_request']} URLs per request")

    report_id = str(uuid.uuid4())
    name = request.name or f"Report {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}"
    _insert_report_to_firestore(report_id, name, request.urls, 0, status="processing")
    background_tasks.add_task(_process_report_background, report_id, request.urls)

    doc = db.collection("keyword_reports").document(report_id).get().to_dict()
    return KeywordReport(
        report_id=doc["report_id"], name=doc["name"],
        created_at=ts_to_str(doc["created_at"]), status=doc["status"],
        urls=doc["urls"], total_keywords_found=doc["total_keywords_found"],
    )


@router.get("", response_model=KeywordReportsListResponse)
def list_keyword_reports(status: Optional[str] = None, limit: int = 100):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    try:
        docs = (
            db.collection("keyword_reports")
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(limit * 2)
            .stream()
        )
        reports = []
        for doc in docs:
            d = doc.to_dict()
            if status:
                if d.get("status") != status:
                    continue
            else:
                if d.get("status") == "archived":
                    continue
            if len(reports) >= limit:
                break
            reports.append(KeywordReport(
                report_id=d["report_id"], name=d.get("name", "Unnamed"),
                created_at=ts_to_str(d["created_at"]), status=d["status"],
                urls=d["urls"], total_keywords_found=d["total_keywords_found"],
                error_message=d.get("error_message"),
            ))
        return KeywordReportsListResponse(reports=reports, total_count=len(reports))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/{report_id}/keywords")
def get_report_keywords(report_id: str):
    if not db or not bq_client:
        raise HTTPException(503, "Service not initialized")
    report_doc = db.collection("keyword_reports").document(report_id).get()
    if not report_doc.exists:
        raise HTTPException(404, f"Report {report_id} not found")
    rd = report_doc.to_dict()

    rows = bq_client.query(f"""
        SELECT source_url, keyword_text, avg_monthly_searches, competition,
               competition_index, low_top_of_page_bid_usd, high_top_of_page_bid_usd
        FROM `{PROJECT_ID}.{DATASET_ID}.{T_RESULTS}`
        WHERE run_id = '{report_id}'
        ORDER BY source_url, avg_monthly_searches DESC
    """).result()

    by_url: Dict[str, list] = {}
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
        "report_id": rd["report_id"], "name": rd.get("name", "Unnamed"),
        "created_at": ts_to_str(rd["created_at"]), "status": rd["status"],
        "urls": rd["urls"], "total_keywords_found": rd["total_keywords_found"],
        "error_message": rd.get("error_message"),
        "keywords": by_url,
    }


@router.patch("/{report_id}/archive")
def archive_report(report_id: str):
    ref = db.collection("keyword_reports").document(report_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Report {report_id} not found")
    ref.update({"status": "archived"})
    return {"message": f"Report {report_id} archived", "report_id": report_id}


@router.patch("/{report_id}/unarchive")
def unarchive_report(report_id: str):
    ref = db.collection("keyword_reports").document(report_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Report {report_id} not found")
    ref.update({"status": "completed"})
    return {"message": f"Report {report_id} unarchived", "report_id": report_id}


@router.delete("/{report_id}")
def delete_report(report_id: str):
    """Hard-delete a report from Firestore. Only intended for failed reports."""
    ref = db.collection("keyword_reports").document(report_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Report {report_id} not found")
    ref.delete()
    return {"message": f"Report {report_id} deleted", "report_id": report_id}
