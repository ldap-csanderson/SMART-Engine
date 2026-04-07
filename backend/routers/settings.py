"""Settings endpoints — prompt configuration stored in Firestore."""
from typing import Optional
from fastapi import APIRouter, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, ts_to_str
from routers.gap_analysis import _DEFAULT_KEYWORD_PROMPT, _DEFAULT_PORTFOLIO_PROMPT

router = APIRouter(prefix="/settings", tags=["settings"])


class PromptsUpdate(BaseModel):
    keyword_intent_prompt: Optional[str] = None
    portfolio_intent_prompt: Optional[str] = None


class Prompts(BaseModel):
    keyword_intent_prompt: str
    portfolio_intent_prompt: str
    updated_at: Optional[str] = None


def _ensure_defaults():
    """Write default prompts to Firestore if not already present."""
    if not db:
        return
    try:
        ref = db.collection("settings").document("prompts")
        if not ref.get().exists:
            ref.set({
                "keyword_intent_prompt": _DEFAULT_KEYWORD_PROMPT,
                "portfolio_intent_prompt": _DEFAULT_PORTFOLIO_PROMPT,
                "updated_at": firestore.SERVER_TIMESTAMP,
            })
            print("✅ Initialized default prompts in Firestore")
    except Exception as e:
        print(f"⚠️ Could not initialize default prompts in Firestore: {e}")


@router.get("/prompts", response_model=Prompts)
def get_prompts():
    if not db:
        return Prompts(
            keyword_intent_prompt=_DEFAULT_KEYWORD_PROMPT,
            portfolio_intent_prompt=_DEFAULT_PORTFOLIO_PROMPT,
        )
    doc = db.collection("settings").document("prompts").get()
    if not doc.exists:
        _ensure_defaults()
        doc = db.collection("settings").document("prompts").get()
    d = doc.to_dict()
    return Prompts(
        keyword_intent_prompt=d.get("keyword_intent_prompt", _DEFAULT_KEYWORD_PROMPT),
        portfolio_intent_prompt=d.get("portfolio_intent_prompt", _DEFAULT_PORTFOLIO_PROMPT),
        updated_at=ts_to_str(d.get("updated_at")),
    )


@router.put("/prompts", response_model=Prompts)
def update_prompts(payload: PromptsUpdate):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("settings").document("prompts")
    existing = ref.get()
    current = existing.to_dict() if existing.exists else {}

    updates = {"updated_at": firestore.SERVER_TIMESTAMP}
    if payload.keyword_intent_prompt is not None:
        updates["keyword_intent_prompt"] = payload.keyword_intent_prompt
    if payload.portfolio_intent_prompt is not None:
        updates["portfolio_intent_prompt"] = payload.portfolio_intent_prompt

    if existing.exists:
        ref.update(updates)
    else:
        updates.setdefault("keyword_intent_prompt", _DEFAULT_KEYWORD_PROMPT)
        updates.setdefault("portfolio_intent_prompt", _DEFAULT_PORTFOLIO_PROMPT)
        ref.set(updates)

    d = ref.get().to_dict()
    return Prompts(
        keyword_intent_prompt=d["keyword_intent_prompt"],
        portfolio_intent_prompt=d["portfolio_intent_prompt"],
        updated_at=ts_to_str(d.get("updated_at")),
    )
