"""Filters endpoints."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, ts_to_str

router = APIRouter(prefix="/filters", tags=["filters"])


class FilterCreate(BaseModel):
    name: str
    label: str
    text: str


class FilterUpdate(BaseModel):
    name: Optional[str] = None
    label: Optional[str] = None
    text: Optional[str] = None


class Filter(BaseModel):
    filter_id: str
    name: str
    label: str
    text: str
    created_at: str
    updated_at: Optional[str] = None
    status: str


class FiltersListResponse(BaseModel):
    filters: List[Filter]
    total_count: int


@router.get("", response_model=FiltersListResponse)
def list_filters(status: Optional[str] = None, limit: int = 100):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    docs = (
        db.collection("filters")
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(limit * 2)
        .stream()
    )
    filters = []
    for doc in docs:
        d = doc.to_dict()
        if status:
            if d.get("status") != status:
                continue
        else:
            if d.get("status") == "archived":
                continue
        if len(filters) >= limit:
            break
        filters.append(Filter(
            filter_id=d["filter_id"], name=d.get("name", ""),
            label=d.get("label", ""), text=d.get("text", ""),
            created_at=ts_to_str(d["created_at"]),
            status=d.get("status", "active"),
        ))
    return FiltersListResponse(filters=filters, total_count=len(filters))


@router.post("", response_model=Filter)
def create_filter(payload: FilterCreate):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    filter_id = str(uuid.uuid4())
    db.collection("filters").document(filter_id).set({
        "filter_id": filter_id,
        "name": payload.name,
        "label": payload.label,
        "text": payload.text,
        "created_at": firestore.SERVER_TIMESTAMP,
        "status": "active",
    })
    d = db.collection("filters").document(filter_id).get().to_dict()
    return Filter(
        filter_id=d["filter_id"], name=d["name"], label=d["label"],
        text=d["text"], created_at=ts_to_str(d["created_at"]),
        status=d["status"],
    )


@router.get("/{filter_id}", response_model=Filter)
def get_filter(filter_id: str):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    doc = db.collection("filters").document(filter_id).get()
    if not doc.exists:
        raise HTTPException(404, f"Filter {filter_id} not found")
    d = doc.to_dict()
    return Filter(
        filter_id=d["filter_id"], name=d["name"], label=d["label"],
        text=d["text"], created_at=ts_to_str(d["created_at"]),
        updated_at=ts_to_str(d.get("updated_at")) or None,
        status=d.get("status", "active"),
    )


@router.put("/{filter_id}", response_model=Filter)
def update_filter(filter_id: str, payload: FilterUpdate):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("filters").document(filter_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Filter {filter_id} not found")
    updates = {"updated_at": firestore.SERVER_TIMESTAMP}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.label is not None:
        updates["label"] = payload.label
    if payload.text is not None:
        updates["text"] = payload.text
    ref.update(updates)
    d = ref.get().to_dict()
    return Filter(
        filter_id=d["filter_id"], name=d["name"], label=d["label"],
        text=d["text"], created_at=ts_to_str(d["created_at"]),
        updated_at=ts_to_str(d.get("updated_at")) or None,
        status=d.get("status", "active"),
    )


@router.delete("/{filter_id}")
def delete_filter(filter_id: str):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("filters").document(filter_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Filter {filter_id} not found")
    ref.delete()
    return {"message": f"Filter {filter_id} deleted", "filter_id": filter_id}


@router.patch("/{filter_id}/archive")
def archive_filter(filter_id: str):
    ref = db.collection("filters").document(filter_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Filter {filter_id} not found")
    ref.update({"status": "archived"})
    return {"message": f"Filter {filter_id} archived", "filter_id": filter_id}


@router.patch("/{filter_id}/unarchive")
def unarchive_filter(filter_id: str):
    ref = db.collection("filters").document(filter_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Filter {filter_id} not found")
    ref.update({"status": "active"})
    return {"message": f"Filter {filter_id} unarchived", "filter_id": filter_id}
