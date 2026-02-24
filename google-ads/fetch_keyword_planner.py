from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException
import json
import time

# Hardcoded configuration
TARGET_URLS = [
    "https://example.com",
    # Add more URLs here
]
CUSTOMER_ID = "2900871247"

# Retry configuration
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

def fetch_keyword_ideas_from_url(client, customer_id, url, retry_count=0):
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

def main():
    """
    Main function to fetch keyword ideas from Google Ads Keyword Planner.
    Outputs results as JSON to terminal.
    """
    print("🎯 Starting Keyword Planner Fetch")
    print("=" * 60)
    
    # Initialize Google Ads client
    try:
        ga_client = GoogleAdsClient.load_from_storage("google-ads.yaml")
        print("✅ Connected to Google Ads API")
    except Exception as e:
        print(f"❌ Failed to load Google Ads client: {e}")
        print("Make sure google-ads.yaml exists in the google-ads directory")
        return
    
    print(f"Processing {len(TARGET_URLS)} URL(s)")
    print("=" * 60)
    
    # Fetch keyword ideas for all URLs
    all_results = {}
    total_keywords = 0
    
    for idx, url in enumerate(TARGET_URLS):
        print(f"\n[{idx + 1}/{len(TARGET_URLS)}] Processing: {url}")
        print("-" * 60)
        
        keyword_ideas = fetch_keyword_ideas_from_url(ga_client, CUSTOMER_ID, url)
        all_results[url] = keyword_ideas
        total_keywords += len(keyword_ideas)
        
        print(f"Found {len(keyword_ideas)} keywords for this URL")
    
    # Output results as JSON
    print("\n" + "=" * 60)
    print("RESULTS (JSON OUTPUT)")
    print("=" * 60)
    print(json.dumps(all_results, indent=2))
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"URLs analyzed: {len(TARGET_URLS)}")
    print(f"Total keywords found: {total_keywords}")
    for url, keywords in all_results.items():
        print(f"  {url}: {len(keywords)} keywords")
    print("\n✅ Process complete!")

if __name__ == '__main__':
    main()
