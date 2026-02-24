from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException
from google.cloud import bigquery, firestore
import time
import os
import yaml
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

app = FastAPI(title="Google Ads Keyword Planner API")

# Load configuration
with open("config.yaml", "r") as f:
    config = yaml.safe_load(f)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=config["api"]["cors_origins"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
CUSTOMER_ID = config["google_ads"]["customer_id"]
MAX_RETRIES = config["api"]["max_retries"]
RETRY_DELAY = config["api"]["retry_delay_seconds"]
PROJECT_ID = config["gcp"]["project_id"]
DATASET_ID = config["bigquery"]["dataset"]
RESULTS_TABLE = config["bigquery"]["tables"]["results"]

# Initialize Google Ads client
try:
    ga_client = GoogleAdsClient.load_from_storage(config["google_ads"]["config_path"])
    print("✅ Connected to Google Ads API")
except Exception as e:
    print(f"❌ Failed to load Google Ads client: {e}")
    ga_client = None

# Initialize BigQuery client (for keyword data only)
try:
    credentials_path = os.getenv("GCP_SERVICE_ACCOUNT_KEY_PATH")
    if credentials_path:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

    bq_client = bigquery.Client(project=PROJECT_ID)
    print(f"✅ Connected to BigQuery: {PROJECT_ID}.{DATASET_ID}")
except Exception as e:
    print(f"❌ Failed to initialize BigQuery client: {e}")
    bq_client = None

# Initialize Firestore client
try:
    db = firestore.Client(project=PROJECT_ID)
    print(f"✅ Connected to Firestore: {PROJECT_ID}")
except Exception as e:
    print(f"❌ Failed to initialize Firestore client: {e}")
    db = None


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------

class URLRequest(BaseModel):
    urls: List[str]
    name: Optional[str] = None


class KeywordPlannerResponse(BaseModel):
    report_id: str
    results: Dict[str, List[Dict[str, Any]]]
    summary: Dict[str, Any]


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


class FilterCreate(BaseModel):
    name: str
    label: str
    text: str


class FilterUpdate(BaseModel):
    name: Optional[str] = None
    label: Optional[str] = None
    text: Optional[str] = None


class Filter(BaseModel):
    filter_id: str
    name: str
    label: str
    text: str
    created_at: str
    updated_at: Optional[str] = None
    status: str


class FiltersListResponse(BaseModel):
    filters: List[Filter]
    total_count: int


class PortfolioUpdate(BaseModel):
    items: List[str]


class Portfolio(BaseModel):
    items: List[str]
    updated_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers: Keyword Reports
# ---------------------------------------------------------------------------

def insert_report_to_firestore(report_id: str, name: str, urls: List[str], total_keywords: int, status: str = "completed", error_message: Optional[str] = None):
    """Insert a new keyword report record into Firestore"""
    if not db:
        print("⚠️ Firestore client not initialized, skipping insert")
        return

    report_data = {
        "report_id": report_id,
        "name": name,
        "created_at": firestore.SERVER_TIMESTAMP,
        "status": status,
        "urls": urls,
        "total_keywords_found": total_keywords,
        "error_message": error_message,
    }

    try:
        db.collection("keyword_reports").document(report_id).set(report_data)
        print(f"✅ Inserted report {report_id} to Firestore")
    except Exception as e:
        print(f"❌ Failed to insert report to Firestore: {e}")


def insert_keywords_to_bq(report_id: str, url: str, keywords: List[Dict[str, Any]]):
    """Insert keyword results into BigQuery"""
    if not bq_client:
        print("⚠️ BigQuery client not initialized, skipping insert")
        return

    if not keywords:
        return

    table_id = f"{PROJECT_ID}.{DATASET_ID}.{RESULTS_TABLE}"
    timestamp = datetime.now(timezone.utc).isoformat()

    rows_to_insert = []
    for keyword in keywords:
        rows_to_insert.append({
            "run_id": report_id,
            "created_at": timestamp,
            "source_url": url,
            "keyword_text": keyword["keyword_text"],
            "avg_monthly_searches": keyword.get("avg_monthly_searches"),
            "competition": keyword.get("competition"),
            "competition_index": keyword.get("competition_index"),
            "low_top_of_page_bid_usd": keyword.get("low_top_of_page_bid_usd"),
            "high_top_of_page_bid_usd": keyword.get("high_top_of_page_bid_usd"),
        })

    try:
        errors = bq_client.insert_rows_json(table_id, rows_to_insert)
        if errors:
            print(f"❌ BigQuery insert errors for keywords: {errors}")
        else:
            print(f"✅ Inserted {len(rows_to_insert)} keywords to BigQuery")
    except Exception as e:
        print(f"❌ Failed to insert keywords to BigQuery: {e}")


def fetch_keyword_ideas_from_url(client, customer_id: str, url: str, retry_count: int = 0) -> List[Dict[str, Any]]:
    """
    Fetches keyword ideas from Google Ads Keyword Planner API based on a URL.
    Returns list of keyword ideas with all available fields.
    """
    print(f"Fetching keyword ideas for URL: {url}")
    print(f"Using customer ID: {customer_id}")

    keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")

    request = client.get_type("GenerateKeywordIdeasRequest")
    request.customer_id = customer_id
    request.url_seed.url = url
    request.language = client.get_service("GoogleAdsService").language_constant_path("1000")  # English
    request.geo_target_constants.append(
        client.get_service("GoogleAdsService").geo_target_constant_path("2840")  # US
    )

    keyword_ideas = []

    try:
        print("Sending request to Google Ads API...")
        response = keyword_plan_idea_service.generate_keyword_ideas(request=request)

        for idea in response:
            keyword_data = {
                "keyword_text": idea.text,
                "avg_monthly_searches": idea.keyword_idea_metrics.avg_monthly_searches if idea.keyword_idea_metrics else None,
                "competition": idea.keyword_idea_metrics.competition.name if idea.keyword_idea_metrics and idea.keyword_idea_metrics.competition else None,
                "competition_index": idea.keyword_idea_metrics.competition_index if idea.keyword_idea_metrics else None,
                "low_top_of_page_bid_micros": idea.keyword_idea_metrics.low_top_of_page_bid_micros if idea.keyword_idea_metrics else None,
                "high_top_of_page_bid_micros": idea.keyword_idea_metrics.high_top_of_page_bid_micros if idea.keyword_idea_metrics else None,
                "low_top_of_page_bid_usd": idea.keyword_idea_metrics.low_top_of_page_bid_micros / 1_000_000 if idea.keyword_idea_metrics and idea.keyword_idea_metrics.low_top_of_page_bid_micros else None,
                "high_top_of_page_bid_usd": idea.keyword_idea_metrics.high_top_of_page_bid_micros / 1_000_000 if idea.keyword_idea_metrics and idea.keyword_idea_metrics.high_top_of_page_bid_micros else None,
            }
            keyword_ideas.append(keyword_data)

        print(f"✅ Successfully fetched {len(keyword_ideas)} keyword ideas")
        return keyword_ideas

    except GoogleAdsException as ex:
        print(f'❌ Request failed with status "{ex.error.code().name}"')
        for error in ex.failure.errors:
            print(f'  Error: "{error.message}"')

        if retry_count < MAX_RETRIES:
            print(f"Retrying in {RETRY_DELAY} seconds... (Attempt {retry_count + 1}/{MAX_RETRIES})")
            time.sleep(RETRY_DELAY)
            return fetch_keyword_ideas_from_url(client, customer_id, url, retry_count + 1)
        else:
            print("Max retries reached. Returning empty list.")
            return []

    except Exception as ex:
        print(f"❌ Unexpected error: {ex}")

        if retry_count < MAX_RETRIES:
            print(f"Retrying in {RETRY_DELAY} seconds... (Attempt {retry_count + 1}/{MAX_RETRIES})")
            time.sleep(RETRY_DELAY)
            return fetch_keyword_ideas_from_url(client, customer_id, url, retry_count + 1)
        else:
            print("Max retries reached. Returning empty list.")
            return []


def _ts_to_str(ts) -> str:
    """Convert a Firestore timestamp (or anything) to an ISO string."""
    if ts is None:
        return ""
    if hasattr(ts, "isoformat"):
        return ts.isoformat()
    return str(ts)


# ---------------------------------------------------------------------------
# Root / Health
# ---------------------------------------------------------------------------

@app.get("/")
def read_root():
    return {
        "message": "Google Ads Keyword Planner API",
        "endpoints": {
            "/keyword-reports": "POST - Create keyword report | GET - List reports",
            "/keyword-reports/{report_id}/keywords": "GET - Get keywords for a report",
            "/keyword-reports/{report_id}/archive": "PATCH - Archive a report",
            "/keyword-reports/{report_id}/unarchive": "PATCH - Unarchive a report",
            "/filters": "GET - List filters | POST - Create filter",
            "/filters/{filter_id}": "GET - Get filter | PUT - Update filter | DELETE - Delete filter",
            "/filters/{filter_id}/archive": "PATCH - Archive filter",
            "/filters/{filter_id}/unarchive": "PATCH - Unarchive filter",
            "/portfolio": "GET - Get portfolio | PUT - Update portfolio",
            "/health": "GET - Check API health",
        },
    }


@app.get("/health")
def health_check():
    if ga_client is None:
        raise HTTPException(status_code=503, detail="Google Ads client not initialized")
    if bq_client is None:
        raise HTTPException(status_code=503, detail="BigQuery client not initialized")
    if db is None:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")
    return {
        "status": "healthy",
        "google_ads_connected": True,
        "bigquery_connected": True,
        "firestore_connected": True,
    }


# ---------------------------------------------------------------------------
# Keyword Reports
# ---------------------------------------------------------------------------

def _process_report_background(report_id: str, urls: List[str]):
    """Background task: run Google Ads API and write results to BigQuery + update Firestore."""
    print(f"🔄 Background processing started for report {report_id}")
    total_keywords = 0

    try:
        for idx, url in enumerate(urls):
            print(f"\n[{idx + 1}/{len(urls)}] Processing: {url}")
            keyword_ideas = fetch_keyword_ideas_from_url(ga_client, CUSTOMER_ID, url)
            insert_keywords_to_bq(report_id, url, keyword_ideas)
            total_keywords += len(keyword_ideas)
            print(f"Found {len(keyword_ideas)} keywords for this URL")

        # Mark as completed
        db.collection("keyword_reports").document(report_id).update({
            "status": "completed",
            "total_keywords_found": total_keywords,
        })
        print(f"✅ Report {report_id} completed — {total_keywords} keywords")

    except Exception as e:
        print(f"❌ Background processing failed for report {report_id}: {e}")
        try:
            db.collection("keyword_reports").document(report_id).update({
                "status": "failed",
                "error_message": str(e),
            })
        except Exception:
            pass


@app.post("/keyword-reports", response_model=KeywordReport)
def create_keyword_report(request: URLRequest, background_tasks: BackgroundTasks):
    """
    Write report metadata to Firestore immediately (status: processing),
    then kick off Google Ads API work in the background.
    """
    if ga_client is None:
        raise HTTPException(
            status_code=503,
            detail="Google Ads client not initialized. Check google-ads.yaml configuration.",
        )

    if not request.urls:
        raise HTTPException(status_code=400, detail="No URLs provided")

    if len(request.urls) > config["api"]["max_urls_per_request"]:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {config['api']['max_urls_per_request']} URLs allowed per request",
        )

    report_id = str(uuid.uuid4())
    report_name = request.name if request.name else f"Report {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}"

    # Write metadata immediately so the frontend can see it right away
    insert_report_to_firestore(report_id, report_name, request.urls, 0, status="processing")

    # Kick off the heavy lifting in the background
    background_tasks.add_task(_process_report_background, report_id, request.urls)

    # Re-fetch to get the server timestamp
    doc = db.collection("keyword_reports").document(report_id).get()
    data = doc.to_dict()

    print(f"🎯 Report {report_id} queued for processing")

    return KeywordReport(
        report_id=data["report_id"],
        name=data["name"],
        created_at=_ts_to_str(data["created_at"]),
        status=data["status"],
        urls=data["urls"],
        total_keywords_found=data["total_keywords_found"],
    )


@app.get("/keyword-reports", response_model=KeywordReportsListResponse)
def list_keyword_reports(status: Optional[str] = None, limit: int = 100):
    """
    List keyword research reports from Firestore.
    status: Filter by status (completed, failed, archived). None shows all non-archived.
    """
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        query = (
            db.collection("keyword_reports")
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(limit * 2)
        )
        docs = query.stream()

        reports = []
        for doc in docs:
            data = doc.to_dict()

            if status:
                if data.get("status") != status:
                    continue
            else:
                if data.get("status") == "archived":
                    continue

            if len(reports) >= limit:
                break

            reports.append(
                KeywordReport(
                    report_id=data["report_id"],
                    name=data.get("name", "Unnamed Report"),
                    created_at=_ts_to_str(data["created_at"]),
                    status=data["status"],
                    urls=data["urls"],
                    total_keywords_found=data["total_keywords_found"],
                    error_message=data.get("error_message"),
                )
            )

        return KeywordReportsListResponse(reports=reports, total_count=len(reports))

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query reports: {str(e)}")


@app.get("/keyword-reports/{report_id}/keywords")
def get_report_keywords(report_id: str):
    """Get all keywords for a specific report (metadata from Firestore, keywords from BigQuery)."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")
    if not bq_client:
        raise HTTPException(status_code=503, detail="BigQuery client not initialized")

    try:
        report_doc = db.collection("keyword_reports").document(report_id).get()

        if not report_doc.exists:
            raise HTTPException(status_code=404, detail=f"Report {report_id} not found")

        report_data = report_doc.to_dict()

        keywords_query = f"""
            SELECT source_url, keyword_text, avg_monthly_searches, competition,
                   competition_index, low_top_of_page_bid_usd, high_top_of_page_bid_usd
            FROM `{PROJECT_ID}.{DATASET_ID}.{RESULTS_TABLE}`
            WHERE run_id = '{report_id}'
            ORDER BY source_url, avg_monthly_searches DESC
        """

        keywords_job = bq_client.query(keywords_query)
        keywords_results = keywords_job.result()

        keywords_by_url: Dict[str, list] = {}
        for row in keywords_results:
            url = row.source_url
            if url not in keywords_by_url:
                keywords_by_url[url] = []
            keywords_by_url[url].append(
                {
                    "keyword_text": row.keyword_text,
                    "avg_monthly_searches": row.avg_monthly_searches,
                    "competition": row.competition,
                    "competition_index": row.competition_index,
                    "low_top_of_page_bid_usd": row.low_top_of_page_bid_usd,
                    "high_top_of_page_bid_usd": row.high_top_of_page_bid_usd,
                }
            )

        return {
            "report_id": report_data["report_id"],
            "name": report_data.get("name", "Unnamed Report"),
            "created_at": _ts_to_str(report_data["created_at"]),
            "status": report_data["status"],
            "urls": report_data["urls"],
            "total_keywords_found": report_data["total_keywords_found"],
            "keywords": keywords_by_url,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query keywords: {str(e)}")


@app.patch("/keyword-reports/{report_id}/archive")
def archive_report(report_id: str):
    """Archive a keyword report."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        report_ref = db.collection("keyword_reports").document(report_id)
        if not report_ref.get().exists:
            raise HTTPException(status_code=404, detail=f"Report {report_id} not found")

        report_ref.update({"status": "archived"})
        print(f"✅ Archived report {report_id}")
        return {"message": f"Report {report_id} archived successfully", "report_id": report_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to archive report: {str(e)}")


@app.patch("/keyword-reports/{report_id}/unarchive")
def unarchive_report(report_id: str):
    """Unarchive a keyword report."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        report_ref = db.collection("keyword_reports").document(report_id)
        if not report_ref.get().exists:
            raise HTTPException(status_code=404, detail=f"Report {report_id} not found")

        report_ref.update({"status": "completed"})
        print(f"✅ Unarchived report {report_id}")
        return {"message": f"Report {report_id} unarchived successfully", "report_id": report_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to unarchive report: {str(e)}")


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

@app.get("/filters", response_model=FiltersListResponse)
def list_filters(status: Optional[str] = None, limit: int = 100):
    """
    List filters from Firestore.
    status: Filter by status (active, archived). None shows all non-archived.
    """
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        query = (
            db.collection("filters")
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(limit * 2)
        )
        docs = query.stream()

        filters = []
        for doc in docs:
            data = doc.to_dict()

            if status:
                if data.get("status") != status:
                    continue
            else:
                if data.get("status") == "archived":
                    continue

            if len(filters) >= limit:
                break

            filters.append(
                Filter(
                    filter_id=data["filter_id"],
                    name=data.get("name", ""),
                    label=data.get("label", ""),
                    text=data.get("text", ""),
                    created_at=_ts_to_str(data["created_at"]),
                    status=data.get("status", "active"),
                )
            )

        return FiltersListResponse(filters=filters, total_count=len(filters))

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query filters: {str(e)}")


@app.post("/filters", response_model=Filter)
def create_filter(payload: FilterCreate):
    """Create a new filter."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    filter_id = str(uuid.uuid4())
    filter_data = {
        "filter_id": filter_id,
        "name": payload.name,
        "label": payload.label,
        "text": payload.text,
        "created_at": firestore.SERVER_TIMESTAMP,
        "status": "active",
    }

    try:
        db.collection("filters").document(filter_id).set(filter_data)
        print(f"✅ Created filter {filter_id}")

        # Re-fetch to get the server timestamp
        doc = db.collection("filters").document(filter_id).get()
        data = doc.to_dict()

        return Filter(
            filter_id=data["filter_id"],
            name=data["name"],
            label=data["label"],
            text=data["text"],
            created_at=_ts_to_str(data["created_at"]),
            status=data["status"],
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create filter: {str(e)}")


@app.get("/filters/{filter_id}", response_model=Filter)
def get_filter(filter_id: str):
    """Get a single filter by ID."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        doc = db.collection("filters").document(filter_id).get()

        if not doc.exists:
            raise HTTPException(status_code=404, detail=f"Filter {filter_id} not found")

        data = doc.to_dict()
        return Filter(
            filter_id=data["filter_id"],
            name=data["name"],
            label=data["label"],
            text=data["text"],
            created_at=_ts_to_str(data["created_at"]),
            updated_at=_ts_to_str(data.get("updated_at")) or None,
            status=data.get("status", "active"),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get filter: {str(e)}")


@app.put("/filters/{filter_id}", response_model=Filter)
def update_filter(filter_id: str, payload: FilterUpdate):
    """Update a filter's fields."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        filter_ref = db.collection("filters").document(filter_id)
        if not filter_ref.get().exists:
            raise HTTPException(status_code=404, detail=f"Filter {filter_id} not found")

        updates = {"updated_at": firestore.SERVER_TIMESTAMP}
        if payload.name is not None:
            updates["name"] = payload.name
        if payload.label is not None:
            updates["label"] = payload.label
        if payload.text is not None:
            updates["text"] = payload.text

        filter_ref.update(updates)

        data = filter_ref.get().to_dict()
        return Filter(
            filter_id=data["filter_id"],
            name=data["name"],
            label=data["label"],
            text=data["text"],
            created_at=_ts_to_str(data["created_at"]),
            updated_at=_ts_to_str(data.get("updated_at")) or None,
            status=data.get("status", "active"),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update filter: {str(e)}")


@app.delete("/filters/{filter_id}")
def delete_filter(filter_id: str):
    """Hard delete a filter."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        filter_ref = db.collection("filters").document(filter_id)
        if not filter_ref.get().exists:
            raise HTTPException(status_code=404, detail=f"Filter {filter_id} not found")

        filter_ref.delete()
        print(f"✅ Deleted filter {filter_id}")
        return {"message": f"Filter {filter_id} deleted successfully", "filter_id": filter_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete filter: {str(e)}")


@app.patch("/filters/{filter_id}/archive")
def archive_filter(filter_id: str):
    """Archive a filter."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        filter_ref = db.collection("filters").document(filter_id)
        if not filter_ref.get().exists:
            raise HTTPException(status_code=404, detail=f"Filter {filter_id} not found")

        filter_ref.update({"status": "archived"})
        print(f"✅ Archived filter {filter_id}")
        return {"message": f"Filter {filter_id} archived successfully", "filter_id": filter_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to archive filter: {str(e)}")


@app.patch("/filters/{filter_id}/unarchive")
def unarchive_filter(filter_id: str):
    """Unarchive a filter."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        filter_ref = db.collection("filters").document(filter_id)
        if not filter_ref.get().exists:
            raise HTTPException(status_code=404, detail=f"Filter {filter_id} not found")

        filter_ref.update({"status": "active"})
        print(f"✅ Unarchived filter {filter_id}")
        return {"message": f"Filter {filter_id} unarchived successfully", "filter_id": filter_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to unarchive filter: {str(e)}")


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------

@app.get("/portfolio", response_model=Portfolio)
def get_portfolio():
    """Get the portfolio (single document at portfolio/default)."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        doc = db.collection("portfolio").document("default").get()

        if not doc.exists:
            # Return empty portfolio if not yet created
            return Portfolio(items=[], updated_at=None)

        data = doc.to_dict()
        return Portfolio(
            items=data.get("items", []),
            updated_at=_ts_to_str(data.get("updated_at")),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get portfolio: {str(e)}")


@app.put("/portfolio", response_model=Portfolio)
def update_portfolio(payload: PortfolioUpdate):
    """Update the portfolio list of URLs."""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")

    try:
        portfolio_data = {
            "items": payload.items,
            "updated_at": firestore.SERVER_TIMESTAMP,
        }

        db.collection("portfolio").document("default").set(portfolio_data)
        print(f"✅ Updated portfolio with {len(payload.items)} items")

        # Re-fetch to get server timestamp
        doc = db.collection("portfolio").document("default").get()
        data = doc.to_dict()

        return Portfolio(
            items=data.get("items", []),
            updated_at=_ts_to_str(data.get("updated_at")),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update portfolio: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config["app"]["host"], port=config["app"]["port"])
