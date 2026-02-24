from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException
from google.cloud import bigquery
import pandas as pd
from tqdm import tqdm
from datetime import datetime, timedelta
import time
import yaml
import os

# Retry configuration
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

def load_workflow_settings():
    """
    Load configuration from workflow_settings.yaml file.
    Returns a dict with project_id, dataset_id, table_name, and customer_ids.
    """
    # Find the workflow_settings.yaml file (should be in parent directory)
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    yaml_path = os.path.join(parent_dir, 'workflow_settings.yaml')
    
    try:
        with open(yaml_path, 'r') as f:
            config = yaml.safe_load(f)
        
        # Extract configuration
        project_id = config.get('defaultProject')
        dataset_id = config.get('defaultDataset')
        table_name = config.get('vars', {}).get('source_ads', 'ads')
        customer_ids = config.get('vars', {}).get('customer_ids', [])
        
        if not project_id:
            raise ValueError("defaultProject not found in workflow_settings.yaml")
        if not dataset_id:
            raise ValueError("defaultDataset not found in workflow_settings.yaml")
        if not customer_ids:
            raise ValueError("No customer_ids found in workflow_settings.yaml vars")
        
        print(f"✅ Loaded configuration from workflow_settings.yaml")
        print(f"   Project: {project_id}")
        print(f"   Dataset: {dataset_id}")
        print(f"   Table: {table_name}")
        print(f"   Customer IDs: {len(customer_ids)}")
        
        return {
            'project_id': project_id,
            'dataset_id': dataset_id,
            'table_name': table_name,
            'customer_ids': customer_ids,
            'destination_table': f"{project_id}.{dataset_id}.{table_name}"
        }
        
    except FileNotFoundError:
        raise FileNotFoundError(f"Could not find workflow_settings.yaml at {yaml_path}")
    except Exception as e:
        raise Exception(f"Error loading configuration from workflow_settings.yaml: {e}")

def fetch_responsive_search_ads(client, customer_id, retry_count=0):
    """
    Fetches RESPONSIVE_SEARCH_AD data with performance metrics from Google Ads API.
    Includes customer_id in the returned data.
    Implements retry logic for transient failures.
    """
    print(f"Fetching RESPONSIVE_SEARCH_AD data for customer {customer_id}...")
    
    ga_service = client.get_service("GoogleAdsService")
    
    # Calculate date range for last 90 days
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=90)
    
    print(f"Fetching performance data from {start_date} to {end_date}")
    
    query = f"""
    SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        segments.date
    FROM ad_group_ad
    WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
      AND campaign.status IN ('ENABLED', 'PAUSED')
      AND ad_group.status IN ('ENABLED', 'PAUSED')
      AND ad_group_ad.status IN ('ENABLED', 'PAUSED')
      AND segments.date BETWEEN '{start_date}' AND '{end_date}'
    """
    
    # Dictionary to aggregate metrics by ad ID
    ads_dict = {}
    
    try:
        response = ga_service.search(customer_id=customer_id, query=query)
        
        for row in tqdm(response, desc=f"Processing ads for CID {customer_id}"):
            ad = row.ad_group_ad.ad
            ad_id = int(ad.id)
            
            # If this is the first time seeing this ad, store its details
            if ad_id not in ads_dict:
                # Extract headlines
                headlines = [
                    {
                        "text": h.text,
                        "pinned_field": h.pinned_field.name
                    }
                    for h in ad.responsive_search_ad.headlines
                ]
                
                # Extract descriptions
                descriptions = [
                    {
                        "text": d.text,
                        "pinned_field": d.pinned_field.name
                    }
                    for d in ad.responsive_search_ad.descriptions
                ]
                
                ads_dict[ad_id] = {
                    "customer_id": customer_id,  # Add customer_id to track source
                    "id": ad_id,
                    "headlines": headlines,
                    "descriptions": descriptions,
                    "path1": ad.responsive_search_ad.path1,
                    "path2": ad.responsive_search_ad.path2,
                    "impressions": 0,
                    "clicks": 0,
                    "cost": 0.0,
                }
            
            # Aggregate metrics (sum across all dates)
            ads_dict[ad_id]["impressions"] += row.metrics.impressions
            ads_dict[ad_id]["clicks"] += row.metrics.clicks
            ads_dict[ad_id]["cost"] += row.metrics.cost_micros / 1_000_000  # Convert micros to dollars
        
        # Convert dictionary back to list
        ads_data = list(ads_dict.values())
        
        print(f"Successfully fetched {len(ads_data)} ads for customer {customer_id}.")
        return ads_data
        
    except GoogleAdsException as ex:
        print(f'Request failed for customer {customer_id} with status "{ex.error.code().name}"')
        for error in ex.failure.errors:
            print(f'\tError: "{error.message}"')
        
        # Retry logic for transient errors
        if retry_count < MAX_RETRIES:
            print(f"Retrying in {RETRY_DELAY} seconds... (Attempt {retry_count + 1}/{MAX_RETRIES})")
            time.sleep(RETRY_DELAY)
            return fetch_responsive_search_ads(client, customer_id, retry_count + 1)
        else:
            print(f"Max retries reached for customer {customer_id}. Skipping.")
            return []
    except Exception as ex:
        print(f"Unexpected error for customer {customer_id}: {ex}")
        
        # Retry for unexpected errors too
        if retry_count < MAX_RETRIES:
            print(f"Retrying in {RETRY_DELAY} seconds... (Attempt {retry_count + 1}/{MAX_RETRIES})")
            time.sleep(RETRY_DELAY)
            return fetch_responsive_search_ads(client, customer_id, retry_count + 1)
        else:
            print(f"Max retries reached for customer {customer_id}. Skipping.")
            return []

def upload_to_bigquery(client, ads_data, table_name, write_disposition):
    """
    Uploads ad data to BigQuery.
    """
    if not ads_data:
        print("No ads to upload. Skipping.")
        return False
    
    print(f"Uploading {len(ads_data)} ads to {table_name}...")
    
    # Convert to DataFrame
    df = pd.DataFrame(ads_data)
    
    # Define schema - includes customer_id
    schema = [
        bigquery.SchemaField("customer_id", "STRING"),  # Customer ID field
        bigquery.SchemaField("id", "INT64"),
        bigquery.SchemaField("headlines", "RECORD", mode="REPEATED", fields=[
            bigquery.SchemaField("text", "STRING"),
            bigquery.SchemaField("pinned_field", "STRING"),
        ]),
        bigquery.SchemaField("descriptions", "RECORD", mode="REPEATED", fields=[
            bigquery.SchemaField("text", "STRING"),
            bigquery.SchemaField("pinned_field", "STRING"),
        ]),
        bigquery.SchemaField("path1", "STRING"),
        bigquery.SchemaField("path2", "STRING"),
        bigquery.SchemaField("impressions", "INT64"),
        bigquery.SchemaField("clicks", "INT64"),
        bigquery.SchemaField("cost", "FLOAT64"),
    ]
    
    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition=write_disposition,
    )
    
    try:
        job = client.load_table_from_dataframe(
            df, table_name, job_config=job_config
        )
        job.result()  # Wait for the job to complete
        
        print(f"✅ Successfully uploaded {len(df)} ads to {table_name}")
        return True
        
    except Exception as e:
        print(f"❌ Error uploading data to BigQuery: {e}")
        return False

def main():
    """
    Main function to fetch ads from Google Ads API for multiple customers and upload to BigQuery.
    """
    print("🎯 Starting Ad Copy Fetch & Upload to BigQuery")
    print("=" * 60)
    
    # Load configuration from workflow_settings.yaml
    try:
        config = load_workflow_settings()
        customer_ids = config['customer_ids']
        destination_table = config['destination_table']
        project_id = config['project_id']
    except Exception as e:
        print(f"❌ Failed to load configuration: {e}")
        return
    
    print(f"Processing {len(customer_ids)} customer account(s)")
    print("=" * 60)
    
    # Initialize Google Ads client
    try:
        ga_client = GoogleAdsClient.load_from_storage("google-ads.yaml")
        print("✅ Connected to Google Ads API")
    except Exception as e:
        print(f"❌ Failed to load Google Ads client: {e}")
        print("Make sure google-ads.yaml exists in the current directory")
        return
    
    # Initialize BigQuery client
    try:
        bq_client = bigquery.Client(project=project_id)
        print("✅ Connected to BigQuery")
    except Exception as e:
        print(f"❌ Failed to authenticate with Google Cloud: {e}")
        print("Make sure you have authenticated with: gcloud auth application-default login")
        return
    
    # Track statistics
    total_ads = 0
    successful_accounts = 0
    failed_accounts = []
    customer_counts = {}
    
    # Process each customer ID
    for idx, customer_id in enumerate(customer_ids):
        print(f"\n{'='*60}")
        print(f"Processing Customer ID: {customer_id} ({idx + 1}/{len(customer_ids)})")
        print(f"{'='*60}")
        
        # Fetch ads for this customer
        ads_data = fetch_responsive_search_ads(ga_client, customer_id)
        
        if ads_data:
            # First account truncates table, subsequent accounts append
            write_disposition = "WRITE_TRUNCATE" if idx == 0 else "WRITE_APPEND"
            
            # Upload to BigQuery
            success = upload_to_bigquery(bq_client, ads_data, destination_table, write_disposition)
            
            if success:
                successful_accounts += 1
                total_ads += len(ads_data)
                customer_counts[customer_id] = len(ads_data)
                print(f"✅ Completed customer {customer_id}: {len(ads_data)} ads uploaded")
            else:
                failed_accounts.append(customer_id)
                print(f"❌ Failed to upload ads for customer {customer_id}")
        else:
            print(f"⚠️  No ads fetched for customer {customer_id}")
            customer_counts[customer_id] = 0
    
    # Print summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"Customer IDs processed: {len(customer_ids)}")
    print(f"Successful accounts: {successful_accounts}")
    print(f"Failed accounts: {len(failed_accounts)}")
    if failed_accounts:
        print(f"  Failed CIDs: {', '.join(failed_accounts)}")
    print(f"Total ads uploaded: {total_ads}")
    print(f"Destination table: {destination_table}")
    
    print("\nAds per customer:")
    for cid, count in customer_counts.items():
        print(f"  {cid}: {count} ads")
    
    print("\n✅ Process complete!")

if __name__ == '__main__':
    main()
