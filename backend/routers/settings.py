"""Settings endpoints — per-dataset-type prompt configuration stored in Firestore."""
from typing import Dict, Optional
from fastapi import APIRouter, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, ts_to_str
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
