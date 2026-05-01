"""Settings endpoints — per-dataset-type prompt configuration stored in Firestore."""
import yaml
from typing import Dict, Optional
from fastapi import APIRouter, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, ts_to_str, ga_auth_manager, get_customer_id, save_customer_id, CUSTOMER_ID
from bq_ml import get_default_prompt_for_type

router = APIRouter(prefix="/settings", tags=["settings"])

DATASET_TYPES = [
    "google_ads_keywords",
    "google_ads_keyword_planner",
    "google_ads_search_terms",
    "google_ads_ad_copy",
    "google_ads_account_keywords",
    "text_list",
]


# ---------------------------------------------------------------------------
# Prompts models
# ---------------------------------------------------------------------------

class PromptsUpdate(BaseModel):
    # Per-type prompt overrides — any key can be omitted to keep existing value
    google_ads_keywords_intent_prompt: Optional[str] = None
    google_ads_keyword_planner_intent_prompt: Optional[str] = None
    google_ads_search_terms_intent_prompt: Optional[str] = None
    google_ads_ad_copy_intent_prompt: Optional[str] = None
    google_ads_account_keywords_intent_prompt: Optional[str] = None
    text_list_intent_prompt: Optional[str] = None


class Prompts(BaseModel):
    google_ads_keywords_intent_prompt: str
    google_ads_keyword_planner_intent_prompt: str
    google_ads_search_terms_intent_prompt: str
    google_ads_ad_copy_intent_prompt: str
    google_ads_account_keywords_intent_prompt: str
    text_list_intent_prompt: str
    updated_at: Optional[str] = None


def _prompt_key(dataset_type: str) -> str:
    return f"{dataset_type}_intent_prompt"


def _get_defaults() -> Dict[str, str]:
    return {_prompt_key(t): get_default_prompt_for_type(t) for t in DATASET_TYPES}


def _ensure_defaults():
    """Write default prompts to Firestore if not already present."""
    if not db:
        return
    try:
        ref = db.collection("settings").document("prompts")
        if not ref.get().exists:
            data = _get_defaults()
            data["updated_at"] = firestore.SERVER_TIMESTAMP
            ref.set(data)
            print("✅ Initialized default prompts in Firestore")
    except Exception as e:
        print(f"⚠️ Could not initialize default prompts in Firestore: {e}")


def _build_prompts_response(d: dict) -> Prompts:
    defaults = _get_defaults()
    return Prompts(
        google_ads_keywords_intent_prompt=d.get(
            "google_ads_keywords_intent_prompt", defaults["google_ads_keywords_intent_prompt"]
        ),
        google_ads_keyword_planner_intent_prompt=d.get(
            "google_ads_keyword_planner_intent_prompt", defaults["google_ads_keyword_planner_intent_prompt"]
        ),
        google_ads_search_terms_intent_prompt=d.get(
            "google_ads_search_terms_intent_prompt", defaults["google_ads_search_terms_intent_prompt"]
        ),
        google_ads_ad_copy_intent_prompt=d.get(
            "google_ads_ad_copy_intent_prompt", defaults["google_ads_ad_copy_intent_prompt"]
        ),
        google_ads_account_keywords_intent_prompt=d.get(
            "google_ads_account_keywords_intent_prompt", defaults["google_ads_account_keywords_intent_prompt"]
        ),
        text_list_intent_prompt=d.get(
            "text_list_intent_prompt", defaults["text_list_intent_prompt"]
        ),
        updated_at=ts_to_str(d.get("updated_at")),
    )


@router.get("/prompts-defaults", response_model=Prompts)
def get_prompt_defaults():
    """Return the hardcoded default prompts (never reads Firestore)."""
    defaults = _get_defaults()
    return Prompts(
        google_ads_keywords_intent_prompt=defaults["google_ads_keywords_intent_prompt"],
        google_ads_keyword_planner_intent_prompt=defaults["google_ads_keyword_planner_intent_prompt"],
        google_ads_search_terms_intent_prompt=defaults["google_ads_search_terms_intent_prompt"],
        google_ads_ad_copy_intent_prompt=defaults["google_ads_ad_copy_intent_prompt"],
        google_ads_account_keywords_intent_prompt=defaults["google_ads_account_keywords_intent_prompt"],
        text_list_intent_prompt=defaults["text_list_intent_prompt"],
        updated_at=None,
    )


@router.get("/prompts", response_model=Prompts)
def get_prompts():
    if not db:
        return _build_prompts_response({})
    doc = db.collection("settings").document("prompts").get()
    if not doc.exists:
        _ensure_defaults()
        doc = db.collection("settings").document("prompts").get()
    d = doc.to_dict() if doc.exists else {}
    return _build_prompts_response(d)


@router.put("/prompts", response_model=Prompts)
def update_prompts(payload: PromptsUpdate):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("settings").document("prompts")
    existing = ref.get()

    updates: Dict = {"updated_at": firestore.SERVER_TIMESTAMP}
    for field, value in payload.model_dump(exclude_none=True).items():
        updates[field] = value

    if existing.exists:
        ref.update(updates)
    else:
        data = _get_defaults()
        data.update(updates)
        ref.set(data)

    d = ref.get().to_dict()
    return _build_prompts_response(d)


# ---------------------------------------------------------------------------
# Google Ads account settings (Customer ID)
# ---------------------------------------------------------------------------

class GoogleAdsSettings(BaseModel):
    customer_id: str
    updated_at: Optional[str] = None


class GoogleAdsSettingsUpdate(BaseModel):
    customer_id: str


@router.get("")
def get_settings():
    """Return current app settings including the active customer ID."""
    active_cid = get_customer_id()
    return {
        "customer_id": active_cid,
        "customer_id_source": "firestore" if active_cid != CUSTOMER_ID else "config",
    }


@router.get("/google-ads", response_model=GoogleAdsSettings)
def get_google_ads_settings():
    """Return the current Google Ads customer ID from Firestore (or config fallback)."""
    active_cid = get_customer_id()
    return GoogleAdsSettings(customer_id=active_cid)


@router.put("/google-ads", response_model=GoogleAdsSettings)
def update_google_ads_settings(payload: GoogleAdsSettingsUpdate):
    """Save the Google Ads customer ID to Firestore and update the Secret Manager secret.

    Strips dashes and validates that the CID is numeric before saving.
    Also updates login_customer_id in the google-ads.yaml Secret Manager secret.
    """
    if not payload.customer_id or not payload.customer_id.strip():
        raise HTTPException(400, "customer_id cannot be empty")

    # 1. Normalize (strip dashes) + validate + persist to Firestore
    try:
        normalised = save_customer_id(payload.customer_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Failed to save Customer ID: {exc}")

    # 2. Update login_customer_id in Secret Manager and reload the GA client in-memory
    if ga_auth_manager:
        try:
            updated_config = _update_secret_login_customer_id(normalised)
            # Reload the GA client immediately so all subsequent API calls use the new CID.
            # The secret mount at /secrets/google-ads.yaml won't update until the next
            # container restart, so we must apply the change in-memory now.
            if updated_config:
                ga_auth_manager.reload_from_credentials(updated_config)
                print(f"✅ Google Ads client reloaded with new login_customer_id: {normalised}")
        except Exception as e:
            # Non-fatal — Firestore update already happened.
            print(f"⚠️  Could not update Secret Manager / reload GA client: {e}")

    return GoogleAdsSettings(customer_id=normalised)


def _update_secret_login_customer_id(new_cid: str) -> dict:
    """Read the current google-ads.yaml from Secret Manager, update login_customer_id,
    write a new secret version, and return the updated config dict for in-memory reload."""
    from db import PROJECT_ID
    from google.cloud import secretmanager

    sm_client = secretmanager.SecretManagerServiceClient()
    secret_name = "google-ads-yaml"
    parent = f"projects/{PROJECT_ID}/secrets/{secret_name}"

    # Read the latest version
    version_name = f"{parent}/versions/latest"
    try:
        response = sm_client.access_secret_version(request={"name": version_name})
        current_yaml_str = response.payload.data.decode("utf-8")
        current_config = yaml.safe_load(current_yaml_str) or {}
    except Exception as e:
        print(f"⚠️  Could not read current secret to update login_customer_id: {e}")
        # Fall back to just what the auth manager has in memory
        current_config = ga_auth_manager.get_config() if ga_auth_manager else {}

    # Update the login_customer_id
    current_config["login_customer_id"] = new_cid

    # Write new secret version (persists across restarts)
    content = yaml.dump(current_config, default_flow_style=False).encode("utf-8")
    sm_client.add_secret_version(
        request={"parent": parent, "payload": {"data": content}}
    )
    print(f"✅ Updated login_customer_id in Secret Manager to: {new_cid}")

    return current_config
