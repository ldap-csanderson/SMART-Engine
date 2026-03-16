"""Shared clients and configuration constants."""
import os
import yaml
from google.ads.googleads.client import GoogleAdsClient
from google.cloud import bigquery, firestore

# Load configuration
with open("config.yaml", "r") as f:
    config = yaml.safe_load(f)

PROJECT_ID = config["gcp"]["project_id"]
DATASET_ID = config["bigquery"]["dataset"]
REGION = config["gcp"]["region"]
CONNECTION_ID = config["bigquery"]["connection"]

# Table names
T_RUNS = config["bigquery"]["tables"]["runs"]
T_RESULTS = config["bigquery"]["tables"]["results"]
T_PORTFOLIO_ITEMS = config["bigquery"]["tables"]["portfolio_items"]
T_PORTFOLIO_EMBEDDINGS = config["bigquery"]["tables"]["portfolio_embeddings"]
T_PORTFOLIO_ITEMS_V2 = config["bigquery"]["tables"]["portfolio_items_v2"]
T_PORTFOLIO_EMBEDDINGS_V2 = config["bigquery"]["tables"]["portfolio_embeddings_v2"]
T_GAP_ANALYSIS = config["bigquery"]["tables"]["gap_analysis_results"]
T_FILTER_RESULTS = config["bigquery"]["tables"]["filter_results"]

# Model names
MODEL_GEMINI = config["bigquery"]["models"]["gemini_flash"]
MODEL_EMBEDDINGS = config["bigquery"]["models"]["text_embeddings"]

# Misc
CUSTOMER_ID = config["google_ads"]["customer_id"]
MAX_RETRIES = config["api"]["max_retries"]
RETRY_DELAY = config["api"]["retry_delay_seconds"]

# ---------------------------------------------------------------------------
# Client initialization
# ---------------------------------------------------------------------------

credentials_path = os.getenv("GCP_SERVICE_ACCOUNT_KEY_PATH")
if credentials_path:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

# Google Ads client - check for Cloud Run secret mount first, then fall back to local path
google_ads_config_path = "/secrets/google-ads.yaml"
if not os.path.exists(google_ads_config_path):
    google_ads_config_path = config["google_ads"]["config_path"]

try:
    ga_client = GoogleAdsClient.load_from_storage(google_ads_config_path)
    print(f"✅ Connected to Google Ads API (config: {google_ads_config_path})")
except Exception as e:
    print(f"❌ Failed to load Google Ads client: {e}")
    ga_client = None

try:
    bq_client = bigquery.Client(project=PROJECT_ID)
    print(f"✅ Connected to BigQuery: {PROJECT_ID}.{DATASET_ID}")
except Exception as e:
    print(f"❌ Failed to initialize BigQuery client: {e}")
    bq_client = None

try:
    db = firestore.Client(project=PROJECT_ID)
    print(f"✅ Connected to Firestore: {PROJECT_ID}")
except Exception as e:
    print(f"❌ Failed to initialize Firestore client: {e}")
    db = None


def ts_to_str(ts) -> str:
    """Convert a Firestore timestamp (or anything with isoformat) to ISO string."""
    if ts is None:
        return ""
    if hasattr(ts, "isoformat"):
        return ts.isoformat()
    return str(ts)
