from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException
import time
from typing import List, Dict, Any

app = FastAPI(title="Google Ads Keyword Planner API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
CUSTOMER_ID = "2900871247"
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

# Initialize Google Ads client
try:
    ga_client = GoogleAdsClient.load_from_storage("../scripts/google-ads.yaml")
    print("✅ Connected to Google Ads API")
except Exception as e:
    print(f"❌ Failed to load Google Ads client: {e}")
    ga_client = None


class URLRequest(BaseModel):
    urls: List[str]


class KeywordIdea(BaseModel):
    keyword_text: str
    avg_monthly_searches: int | None
    competition: str | None
    competition_index: int | None
    low_top_of_page_bid_micros: int | None
    high_top_of_page_bid_micros: int | None
    low_top_of_page_bid_usd: float | None
    high_top_of_page_bid_usd: float | None
    concepts: List[Dict[str, str]] | None = []


class KeywordPlannerResponse(BaseModel):
    results: Dict[str, List[Dict[str, Any]]]
    summary: Dict[str, Any]


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
            
            # Add keyword annotations if available
            if idea.keyword_annotations:
                keyword_data["concepts"] = [
                    {
                        "name": concept.concept_group.name,
                        "type": concept.concept_group.type_.name
                    }
                    for concept in idea.keyword_annotations.concepts
                ] if idea.keyword_annotations.concepts else []
            
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
            "/health": "GET - Check API health"
        }
    }


@app.get("/health")
def health_check():
    """Health check endpoint"""
    if ga_client is None:
        raise HTTPException(status_code=503, detail="Google Ads client not initialized")
    return {"status": "healthy", "google_ads_connected": True}


@app.post("/keyword-planner", response_model=KeywordPlannerResponse)
def get_keyword_planner_data(request: URLRequest):
    """
    Fetch keyword planner data for multiple URLs
    
    Args:
        request: URLRequest containing a list of URLs to analyze
        
    Returns:
        KeywordPlannerResponse with results for each URL and summary statistics
    """
    if ga_client is None:
        raise HTTPException(
            status_code=503, 
            detail="Google Ads client not initialized. Check google-ads.yaml configuration."
        )
    
    if not request.urls:
        raise HTTPException(status_code=400, detail="No URLs provided")
    
    if len(request.urls) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 URLs allowed per request")
    
    print(f"🎯 Processing {len(request.urls)} URL(s)")
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
        except Exception as e:
            print(f"Error processing {url}: {e}")
            all_results[url] = []
    
    # Build summary
    summary = {
        "urls_analyzed": len(request.urls),
        "total_keywords_found": total_keywords,
        "keywords_per_url": {url: len(keywords) for url, keywords in all_results.items()}
    }
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"URLs analyzed: {summary['urls_analyzed']}")
    print(f"Total keywords found: {summary['total_keywords_found']}")
    print("✅ Process complete!")
    
    return KeywordPlannerResponse(
        results=all_results,
        summary=summary
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
