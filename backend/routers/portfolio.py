"""Portfolio endpoints — CRUD operations for multiple portfolios."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, bq_client, ts_to_str, PROJECT_ID, DATASET_ID, T_PORTFOLIO_ITEMS_V2

router = APIRouter(prefix="/portfolios", tags=["portfolios"])

# Note: portfolio items are synced to BigQuery on-demand at the start of each
# gap analysis pipeline (_sync_portfolio_items in bq_ml.py). Firestore is the
# source of truth; BQ is a runtime cache only.


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class PortfolioCreate(BaseModel):
    name: str
    items: List[str]


class PortfolioUpdate(BaseModel):
    name: str
    items: List[str]


class Portfolio(BaseModel):
    portfolio_id: str
    name: str
    items: List[str]
    total_items: int
    created_at: str
    updated_at: str


class PortfolioListItem(BaseModel):
    portfolio_id: str
    name: str
    total_items: int
    created_at: str
    updated_at: str


class PortfolioListResponse(BaseModel):
    portfolios: List[PortfolioListItem]
    total_count: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=PortfolioListResponse)
def list_portfolios(limit: int = 100):
    """List all portfolios."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    try:
        query = (
            db.collection("portfolios")
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(limit)
        )
        docs = query.stream()

        portfolios = []
        for doc in docs:
            d = doc.to_dict()
            portfolios.append(PortfolioListItem(
                portfolio_id=d["portfolio_id"],
                name=d["name"],
                total_items=len(d.get("items", [])),
                created_at=ts_to_str(d["created_at"]),
                updated_at=ts_to_str(d["updated_at"]),
            ))

        return PortfolioListResponse(portfolios=portfolios, total_count=len(portfolios))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("", response_model=Portfolio)
def create_portfolio(payload: PortfolioCreate):
    """Create a new portfolio."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    try:
        # Remove empty items and deduplicate
        unique_items = list(dict.fromkeys(i.strip() for i in payload.items if i.strip()))

        portfolio_id = str(uuid.uuid4())

        # Create Firestore document (source of truth)
        db.collection("portfolios").document(portfolio_id).set({
            "portfolio_id": portfolio_id,
            "name": payload.name.strip(),
            "items": unique_items,
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })

        # Re-fetch to get SERVER_TIMESTAMP values
        doc = db.collection("portfolios").document(portfolio_id).get().to_dict()

        return Portfolio(
            portfolio_id=doc["portfolio_id"],
            name=doc["name"],
            items=doc["items"],
            total_items=len(doc["items"]),
            created_at=ts_to_str(doc["created_at"]),
            updated_at=ts_to_str(doc["updated_at"]),
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to create portfolio: {e}")


@router.get("/{portfolio_id}", response_model=Portfolio)
def get_portfolio(portfolio_id: str):
    """Get a single portfolio by ID."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    try:
        doc = db.collection("portfolios").document(portfolio_id).get()

        if not doc.exists:
            raise HTTPException(404, f"Portfolio {portfolio_id} not found")

        d = doc.to_dict()

        return Portfolio(
            portfolio_id=d["portfolio_id"],
            name=d["name"],
            items=d["items"],
            total_items=len(d["items"]),
            created_at=ts_to_str(d["created_at"]),
            updated_at=ts_to_str(d["updated_at"]),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to get portfolio: {e}")


@router.put("/{portfolio_id}", response_model=Portfolio)
def update_portfolio(portfolio_id: str, payload: PortfolioUpdate):
    """Update an existing portfolio."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    try:
        ref = db.collection("portfolios").document(portfolio_id)

        if not ref.get().exists:
            raise HTTPException(404, f"Portfolio {portfolio_id} not found")

        # Remove empty items and deduplicate
        unique_items = list(dict.fromkeys(i.strip() for i in payload.items if i.strip()))

        # Update Firestore (source of truth)
        ref.update({
            "name": payload.name.strip(),
            "items": unique_items,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })

        # Re-fetch to get updated timestamp
        doc = ref.get().to_dict()

        return Portfolio(
            portfolio_id=doc["portfolio_id"],
            name=doc["name"],
            items=doc["items"],
            total_items=len(doc["items"]),
            created_at=ts_to_str(doc["created_at"]),
            updated_at=ts_to_str(doc["updated_at"]),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to update portfolio: {e}")


@router.delete("/{portfolio_id}")
def delete_portfolio(portfolio_id: str):
    """Delete a portfolio."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")

    try:
        ref = db.collection("portfolios").document(portfolio_id)

        if not ref.get().exists:
            raise HTTPException(404, f"Portfolio {portfolio_id} not found")

        # Delete from Firestore
        ref.delete()

        # Clean up BQ cache rows (best effort)
        if bq_client:
            try:
                bq_client.query(
                    f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.{T_PORTFOLIO_ITEMS_V2}` "
                    f"WHERE portfolio_id = '{portfolio_id}'"
                ).result()
                print(f"✅ Deleted portfolio items from BigQuery cache (portfolio_id={portfolio_id})")
            except Exception as e:
                print(f"⚠️ Could not delete BigQuery cache rows for portfolio {portfolio_id}: {e}")

        return {"message": f"Portfolio {portfolio_id} deleted", "portfolio_id": portfolio_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to delete portfolio: {e}")
