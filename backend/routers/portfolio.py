"""Portfolio endpoints — stored entirely in Firestore (portfolio/default)."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, ts_to_str

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


class PortfolioUpdate(BaseModel):
    items: List[str]


class Portfolio(BaseModel):
    items: List[str]
    total_items: int
    updated_at: Optional[str] = None


class PortfolioMeta(BaseModel):
    total_items: int
    updated_at: Optional[str] = None


@router.get("", response_model=Portfolio)
def get_portfolio():
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    try:
        doc = db.collection("portfolio").document("default").get()
        if not doc.exists:
            return Portfolio(items=[], total_items=0, updated_at=None)
        d = doc.to_dict()
        items = d.get("items", [])
        return Portfolio(
            items=items,
            total_items=len(items),
            updated_at=ts_to_str(d.get("updated_at")),
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to get portfolio: {e}")


@router.put("", response_model=Portfolio)
def update_portfolio(payload: PortfolioUpdate):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    try:
        unique_items = list(dict.fromkeys(i.strip() for i in payload.items if i.strip()))
        db.collection("portfolio").document("default").set({
            "items": unique_items,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        # Re-fetch to get the SERVER_TIMESTAMP value
        d = db.collection("portfolio").document("default").get().to_dict()
        items = d.get("items", [])
        return Portfolio(
            items=items,
            total_items=len(items),
            updated_at=ts_to_str(d.get("updated_at")),
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to update portfolio: {e}")


@router.get("/meta", response_model=PortfolioMeta)
def get_portfolio_meta():
    if not db:
        return PortfolioMeta(total_items=0)
    doc = db.collection("portfolio").document("default").get()
    if not doc.exists:
        return PortfolioMeta(total_items=0)
    d = doc.to_dict()
    items = d.get("items", [])
    return PortfolioMeta(
        total_items=len(items),
        updated_at=ts_to_str(d.get("updated_at")),
    )
