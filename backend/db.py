"""Shared clients and configuration constants."""
import os
import yaml
from google.cloud import bigquery, firestore
import google_ads_auth

# Load configuration
with open("config.yaml", "r") as f:
    config = yaml.safe_load(f)

PROJECT_ID = config["gcp"]["project_id"]
DATASET_ID = config["bigquery"]["dataset"]
REGION = config["gcp"]["region"]
CONNECTION_ID = config["bigquery"]["connection"]

# v3 table names
T_DATASET_ITEMS = config["bigquery"]["tables"]["dataset_items"]
T_DATASET_EMBEDDINGS = config["bigquery"]["tables"]["dataset_embeddings"]
T_GAP_ANALYSIS = config["bigquery"]["tables"]["gap_analysis_results"]
T_FILTER_RESULTS = config["bigquery"]["tables"]["filter_results"]

# Model names
MODEL_GEMINI = config["bigquery"]["models"]["gemini_flash"]
MODEL_EMBEDDINGS = config["bigquery"]["models"]["text_embeddings"]

# Misc
CUSTOMER_ID = config["google_ads"]["customer_id"]
MAX_RETRIES = config["api"]["max_retries"]
RETRY_DELAY = config["api"]["retry_delay_seconds"]
FILTER_BATCH_SIZE = config["bigquery"].get("filter_batch_size", 500)

# Dataset types that have search volume enrichment data
SEARCH_VOLUME_TYPES = {"google_ads_keywords", "google_ads_keyword_planner"}

# ---------------------------------------------------------------------------
# Client initialization
# ---------------------------------------------------------------------------

credentials_path = os.getenv("GCP_SERVICE_ACCOUNT_KEY_PATH")
if credentials_path:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

# Google Ads client with auth manager - check for Cloud Run secret mount first, then fall back to local path
google_ads_config_path = "/secrets/google-ads.yaml"
if not os.path.exists(google_ads_config_path):
    google_ads_config_path = config["google_ads"]["config_path"]

try:
    ga_auth_manager = google_ads_auth.GoogleAdsAuthManager(google_ads_config_path)
    ga_client = ga_auth_manager.client
    if ga_client:
        print(f"✅ Connected to Google Ads API (config: {google_ads_config_path})")
    else:
        # Token may be expired or revoked — keep ga_auth_manager so in-app
        # re-authorization can still read config and reload the client.
        print(f"⚠️  Google Ads token invalid — use Settings → Re-authorize to reconnect")
        ga_client = None
except Exception as e:
    print(f"❌ Failed to load Google Ads client: {e}")
    ga_client = None
    ga_auth_manager = None

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


def get_ga_client():
    """Return the current Google Ads client from the auth manager.

    Always reflects the live state — use this instead of the cached module-level
    ga_client variable so that in-app OAuth re-authorization takes effect
    immediately without a service restart.
    """
    return ga_auth_manager.client if ga_auth_manager else None


def ts_to_str(ts) -> str:
    """Convert a Firestore timestamp (or anything with isoformat) to ISO string."""
    if ts is None:
        return ""
    if hasattr(ts, "isoformat"):
        return ts.isoformat()
    return str(ts)
