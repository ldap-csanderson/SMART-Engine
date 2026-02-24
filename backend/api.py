from fastapi import FastAPI, HTTPException
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

# Initialize Firestore client (for run metadata)
try:
    db = firestore.Client(project=PROJECT_ID)
    print(f"✅ Connected to Firestore: {PROJECT_ID}")
except Exception as e:
    print(f"❌ Failed to initialize Firestore client: {e}")
    db = None


class URLRequest(BaseModel):
    urls: List[str]


class KeywordPlannerResponse(BaseModel):
    run_id: str
    results: Dict[str, List[Dict[str, Any]]]
    summary: Dict[str, Any]


class Run(BaseModel):
    run_id: str
    created_at: str
    status: str
    urls: List[str]
    total_keywords_found: int
    error_message: Optional[str] = None


class RunsListResponse(BaseModel):
    runs: List[Run]
    total_count: int


def insert_run_to_firestore(run_id: str, urls: List[str], total_keywords: int, status: str = "completed", error_message: Optional[str] = None):
    """Insert a new run record into Firestore"""
    if not db:
        print("⚠️ Firestore client not initialized, skipping insert")
        return
    
    run_data = {
        "run_id": run_id,
        "created_at": firestore.SERVER_TIMESTAMP,
        "status": status,
        "urls": urls,
        "total_keywords_found": total_keywords,
        "error_message": error_message
    }
    
    try:
        db.collection("runs").document(run_id).set(run_data)
        print(f"✅ Inserted run {run_id} to Firestore")
    except Exception as e:
        print(f"❌ Failed to insert run to Firestore: {e}")


def insert_keywords_to_bq(run_id: str, url: str, keywords: List[Dict[str, Any]]):
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
            "run_id": run_id,
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
    
    # Create the request
    request = client.get_type("GenerateKeywordIdeasRequest")
    request.customer_id = customer_id
    
    # Set URL seed
    request.url_seed.url = url
    
    # Optional: Set language and location (defaults to US English if not set)
    # Using US as default location
    request.language = client.get_service("GoogleAdsService").language_constant_path("1000")  # English
    
    # Location criteria ID for United States (2840)
    request.geo_target_constants.append(
        client.get_service("GoogleAdsService").geo_target_constant_path("2840")
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
            print(f"Max retries reached. Returning empty list.")
            return []
            
    except Exception as ex:
        print(f"❌ Unexpected error: {ex}")
        
        if retry_count < MAX_RETRIES:
            print(f"Retrying in {RETRY_DELAY} seconds... (Attempt {retry_count + 1}/{MAX_RETRIES})")
            time.sleep(RETRY_DELAY)
            return fetch_keyword_ideas_from_url(client, customer_id, url, retry_count + 1)
        else:
            print(f"Max retries reached. Returning empty list.")
            return []


@app.get("/")
def read_root():
    """Root endpoint with API information"""
    return {
        "message": "Google Ads Keyword Planner API",
        "endpoints": {
            "/keyword-planner": "POST - Get keyword ideas from URLs",
            "/runs": "GET - List all runs",
            "/runs/{run_id}/keywords": "GET - Get keywords for a run",
            "/runs/{run_id}/archive": "PATCH - Archive a run",
            "/runs/{run_id}/unarchive": "PATCH - Unarchive a run",
            "/health": "GET - Check API health"
        }
    }


@app.get("/health")
def health_check():
    """Health check endpoint"""
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
        "firestore_connected": True
    }


@app.post("/keyword-planner", response_model=KeywordPlannerResponse)
def get_keyword_planner_data(request: URLRequest):
    """
    Fetch keyword planner data for multiple URLs and save to Firestore + BigQuery
    
    Args:
        request: URLRequest containing a list of URLs to analyze
        
    Returns:
        KeywordPlannerResponse with run_id, results for each URL and summary statistics
    """
    if ga_client is None:
        raise HTTPException(
            status_code=503, 
            detail="Google Ads client not initialized. Check google-ads.yaml configuration."
        )
    
    if not request.urls:
        raise HTTPException(status_code=400, detail="No URLs provided")
    
    if len(request.urls) > config["api"]["max_urls_per_request"]:
        raise HTTPException(status_code=400, detail=f"Maximum {config['api']['max_urls_per_request']} URLs allowed per request")
    
    # Generate run ID
    run_id = str(uuid.uuid4())
    
    print(f"🎯 Processing {len(request.urls)} URL(s) - Run ID: {run_id}")
    print("=" * 60)
    
    all_results = {}
    total_keywords = 0
    
    for idx, url in enumerate(request.urls):
        print(f"\n[{idx + 1}/{len(request.urls)}] Processing: {url}")
        print("-" * 60)
        
        try:
            keyword_ideas = fetch_keyword_ideas_from_url(ga_client, CUSTOMER_ID, url)
            all_results[url] = keyword_ideas
            total_keywords += len(keyword_ideas)
            print(f"Found {len(keyword_ideas)} keywords for this URL")
            
            # Insert keywords into BigQuery
            insert_keywords_to_bq(run_id, url, keyword_ideas)
            
        except Exception as e:
            print(f"Error processing {url}: {e}")
            all_results[url] = []
    
    # Build summary
    summary = {
        "urls_analyzed": len(request.urls),
        "total_keywords_found": total_keywords,
        "keywords_per_url": {url: len(keywords) for url, keywords in all_results.items()}
    }
    
    # Insert run metadata into Firestore
    insert_run_to_firestore(run_id, request.urls, total_keywords, status="completed")
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Run ID: {run_id}")
    print(f"URLs analyzed: {summary['urls_analyzed']}")
    print(f"Total keywords found: {summary['total_keywords_found']}")
    print("✅ Process complete!")
    
    return KeywordPlannerResponse(
        run_id=run_id,
        results=all_results,
        summary=summary
    )


@app.get("/runs", response_model=RunsListResponse)
def list_runs(status: Optional[str] = None, limit: int = 100):
    """
    List all keyword research runs from Firestore
    
    Args:
        status: Filter by status (completed, failed, archived). If None, shows all non-archived.
        limit: Maximum number of runs to return
    """
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")
    
    try:
        # Get all runs ordered by created_at (client-side filtering to avoid composite index)
        query = db.collection("runs").order_by("created_at", direction=firestore.Query.DESCENDING).limit(limit * 2)
        docs = query.stream()
        
        runs = []
        for doc in docs:
            data = doc.to_dict()
            
            # Client-side status filtering
            if status:
                # Filter by specific status
                if data.get("status") != status:
                    continue
            else:
                # Default: show only non-archived
                if data.get("status") == "archived":
                    continue
            
            # Stop if we've reached the limit
            if len(runs) >= limit:
                break
            # Convert Firestore timestamp to ISO string
            created_at = data["created_at"]
            if hasattr(created_at, 'isoformat'):
                created_at_str = created_at.isoformat()
            else:
                created_at_str = str(created_at)
            
            runs.append(Run(
                run_id=data["run_id"],
                created_at=created_at_str,
                status=data["status"],
                urls=data["urls"],
                total_keywords_found=data["total_keywords_found"],
                error_message=data.get("error_message")
            ))
        
        return RunsListResponse(runs=runs, total_count=len(runs))
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query runs: {str(e)}")


@app.get("/runs/{run_id}/keywords")
def get_run_keywords(run_id: str):
    """Get all keywords for a specific run (metadata from Firestore, keywords from BigQuery)"""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")
    if not bq_client:
        raise HTTPException(status_code=503, detail="BigQuery client not initialized")
    
    try:
        # Get run metadata from Firestore
        run_doc = db.collection("runs").document(run_id).get()
        
        if not run_doc.exists:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        
        run_data = run_doc.to_dict()
        
        # Get keywords from BigQuery
        keywords_query = f"""
            SELECT source_url, keyword_text, avg_monthly_searches, competition, 
                   competition_index, low_top_of_page_bid_usd, high_top_of_page_bid_usd
            FROM `{PROJECT_ID}.{DATASET_ID}.{RESULTS_TABLE}`
            WHERE run_id = '{run_id}'
            ORDER BY source_url, avg_monthly_searches DESC
        """
        
        keywords_job = bq_client.query(keywords_query)
        keywords_results = keywords_job.result()
        
        # Group keywords by URL
        keywords_by_url = {}
        for row in keywords_results:
            url = row.source_url
            if url not in keywords_by_url:
                keywords_by_url[url] = []
            
            keywords_by_url[url].append({
                "keyword_text": row.keyword_text,
                "avg_monthly_searches": row.avg_monthly_searches,
                "competition": row.competition,
                "competition_index": row.competition_index,
                "low_top_of_page_bid_usd": row.low_top_of_page_bid_usd,
                "high_top_of_page_bid_usd": row.high_top_of_page_bid_usd,
            })
        
        # Convert timestamp
        created_at = run_data["created_at"]
        if hasattr(created_at, 'isoformat'):
            created_at_str = created_at.isoformat()
        else:
            created_at_str = str(created_at)
        
        return {
            "run_id": run_data["run_id"],
            "created_at": created_at_str,
            "status": run_data["status"],
            "urls": run_data["urls"],
            "total_keywords_found": run_data["total_keywords_found"],
            "keywords": keywords_by_url
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query keywords: {str(e)}")


@app.patch("/runs/{run_id}/archive")
def archive_run(run_id: str):
    """Archive a run (instant update in Firestore)"""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")
    
    try:
        run_ref = db.collection("runs").document(run_id)
        run_doc = run_ref.get()
        
        if not run_doc.exists:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        
        run_ref.update({"status": "archived"})
        print(f"✅ Archived run {run_id} in Firestore")
        
        return {"message": f"Run {run_id} archived successfully", "run_id": run_id}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to archive run: {str(e)}")


@app.patch("/runs/{run_id}/unarchive")
def unarchive_run(run_id: str):
    """Unarchive a run (instant update in Firestore)"""
    if not db:
        raise HTTPException(status_code=503, detail="Firestore client not initialized")
    
    try:
        run_ref = db.collection("runs").document(run_id)
        run_doc = run_ref.get()
        
        if not run_doc.exists:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        
        run_ref.update({"status": "completed"})
        print(f"✅ Unarchived run {run_id} in Firestore")
        
        return {"message": f"Run {run_id} unarchived successfully", "run_id": run_id}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to unarchive run: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config["app"]["host"], port=config["app"]["port"])
