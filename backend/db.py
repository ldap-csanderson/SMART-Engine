"""Shared clients and configuration constants."""
import os
import yaml
from google.cloud import bigquery, firestore
import google_ads_auth

# Load configuration
with open("config.yaml", "r") as f:
    config = yaml.safe_load(f)

# ---------------------------------------------------------------------------
# Project / region — env vars take precedence over config.yaml so that the
# same image can be deployed to any GCP project without rebuilding.
# ---------------------------------------------------------------------------

PROJECT_ID = os.getenv("GCP_PROJECT_ID") or config["gcp"]["project_id"]
if not PROJECT_ID:
    raise ValueError(
        "GCP project ID not set. Pass GCP_PROJECT_ID env var to Cloud Run "
        "or set gcp.project_id in config.yaml."
    )

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
# The config.yaml default (blank on fresh installs). Use get_customer_id() at runtime.
CUSTOMER_ID = config["google_ads"].get("customer_id", "")
MAX_RETRIES = config["api"]["max_retries"]
RETRY_DELAY = config["api"]["retry_delay_seconds"]
FILTER_BATCH_SIZE = config["bigquery"].get("filter_batch_size", 500)

# Dataset types that have search volume enrichment data
SEARCH_VOLUME_TYPES = {"google_ads_keywords", "google_ads_keyword_planner"}

# ---------------------------------------------------------------------------
# OAuth redirect URIs
# Derived from CLOUD_RUN_URL env var when set (preferred), otherwise fall back
# to explicit OAUTH_REDIRECT_URI / DRIVE_REDIRECT_URI env vars, then config.yaml.
# CLOUD_RUN_URL is set automatically by deploy.sh at deploy time.
# ---------------------------------------------------------------------------

_cloud_run_url = os.getenv("CLOUD_RUN_URL", "")
_cfg_oauth = config.get("oauth", {})

OAUTH_REDIRECT_URI = (
    os.getenv("OAUTH_REDIRECT_URI")
    or (f"{_cloud_run_url}/api/auth/google-ads/callback" if _cloud_run_url else "")
    or _cfg_oauth.get("redirect_uri", "")
)

DRIVE_REDIRECT_URI = (
    os.getenv("DRIVE_REDIRECT_URI")
    or (f"{_cloud_run_url}/api/auth/google-drive/callback" if _cloud_run_url else "")
    or _cfg_oauth.get("drive_redirect_uri", "")
)

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


# ---------------------------------------------------------------------------
# Customer ID helpers (dynamic — configurable via Settings UI)
# ---------------------------------------------------------------------------

def get_customer_id() -> str:
    """Return the active Google Ads Customer ID.

    Reads from Firestore settings/google_ads (customer_id field) if set,
    otherwise falls back to the value from config.yaml. Strips dashes so
    both formatted (XXX-XXX-XXXX) and plain numeric IDs are accepted.
    """
    if db:
        try:
            doc = db.collection("settings").document("google_ads").get()
            if doc.exists:
                cid = doc.to_dict().get("customer_id", "")
                if cid:
                    return str(cid).replace("-", "")
        except Exception:
            pass
    return CUSTOMER_ID


def save_customer_id(new_cid: str) -> str:
    """Persist a new Customer ID to Firestore. Returns the normalised CID.

    Strips dashes and validates that the result is numeric.
    Raises ValueError if the CID is not valid.
    """
    normalised = str(new_cid).strip().replace("-", "")
    if not normalised.isdigit():
        raise ValueError(f"Invalid Customer ID '{new_cid}' — must be numeric (dashes OK)")
    if db:
        db.collection("settings").document("google_ads").set(
            {"customer_id": normalised},
            merge=True,
        )
    return normalised


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
