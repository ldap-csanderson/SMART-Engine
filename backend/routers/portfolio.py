"""Portfolio endpoints — stored in Firestore (portfolio/default) and synced to BigQuery."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, bq_client, ts_to_str, PROJECT_ID, DATASET_ID, T_PORTFOLIO_ITEMS

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
        
        # Update Firestore
        db.collection("portfolio").document("default").set({
            "items": unique_items,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        
        # Sync to BigQuery portfolio_items table
        if bq_client:
            try:
                # Clear existing items
                bq_client.query(
                    f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.{T_PORTFOLIO_ITEMS}` WHERE TRUE"
                ).result()
                
                # Insert new items (if any)
                if unique_items:
                    values = ", ".join(
                        f"('{item.replace(chr(39), chr(39)+chr(39))}', CURRENT_TIMESTAMP())"
                        for item in unique_items
                    )
                    bq_client.query(
                        f"INSERT INTO `{PROJECT_ID}.{DATASET_ID}.{T_PORTFOLIO_ITEMS}` "
                        f"(item_text, added_at) VALUES {values}"
                    ).result()
                print(f"✅ Synced {len(unique_items)} portfolio items to BigQuery")
            except Exception as e:
                print(f"⚠️ Failed to sync portfolio to BigQuery: {e}")
                # Don't fail the request if BQ sync fails
        
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
