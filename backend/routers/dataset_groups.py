"""Dataset Groups endpoints — named collections of datasets for gap analysis."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from db import db, ts_to_str

router = APIRouter(prefix="/dataset-groups", tags=["dataset-groups"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class DatasetGroupCreate(BaseModel):
    name: str
    dataset_ids: List[str]


class DatasetGroupUpdate(BaseModel):
    name: str
    dataset_ids: List[str]


class DatasetGroupListItem(BaseModel):
    group_id: str
    name: str
    dataset_count: int
    created_at: str
    updated_at: str


class DatasetGroup(BaseModel):
    group_id: str
    name: str
    dataset_ids: List[str]
    dataset_count: int
    created_at: str
    updated_at: str


class DatasetGroupListResponse(BaseModel):
    groups: List[DatasetGroupListItem]
    total_count: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=DatasetGroupListResponse)
def list_dataset_groups(limit: int = 100):
    """List all dataset groups."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    try:
        docs = (
            db.collection("dataset_groups")
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        groups = []
        for doc in docs:
            d = doc.to_dict()
            groups.append(DatasetGroupListItem(
                group_id=d["group_id"],
                name=d["name"],
                dataset_count=len(d.get("dataset_ids", [])),
                created_at=ts_to_str(d["created_at"]),
                updated_at=ts_to_str(d.get("updated_at") or d["created_at"]),
            ))
        return DatasetGroupListResponse(groups=groups, total_count=len(groups))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("", response_model=DatasetGroup)
def create_dataset_group(payload: DatasetGroupCreate):
    """Create a new dataset group."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    if not payload.name.strip():
        raise HTTPException(400, "Name cannot be empty")

    # Validate all dataset IDs exist
    for did in payload.dataset_ids:
        if not db.collection("datasets").document(did).get().exists:
            raise HTTPException(404, f"Dataset {did} not found")

    group_id = str(uuid.uuid4())
    db.collection("dataset_groups").document(group_id).set({
        "group_id": group_id,
        "name": payload.name.strip(),
        "dataset_ids": list(dict.fromkeys(payload.dataset_ids)),  # deduplicate, preserve order
        "created_at": firestore.SERVER_TIMESTAMP,
        "updated_at": firestore.SERVER_TIMESTAMP,
    })

    doc = db.collection("dataset_groups").document(group_id).get().to_dict()
    return DatasetGroup(
        group_id=doc["group_id"],
        name=doc["name"],
        dataset_ids=doc["dataset_ids"],
        dataset_count=len(doc["dataset_ids"]),
        created_at=ts_to_str(doc["created_at"]),
        updated_at=ts_to_str(doc.get("updated_at") or doc["created_at"]),
    )


@router.get("/{group_id}", response_model=DatasetGroup)
def get_dataset_group(group_id: str):
    """Get a single dataset group by ID."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    doc = db.collection("dataset_groups").document(group_id).get()
    if not doc.exists:
        raise HTTPException(404, f"Dataset group {group_id} not found")
    d = doc.to_dict()
    return DatasetGroup(
        group_id=d["group_id"],
        name=d["name"],
        dataset_ids=d.get("dataset_ids", []),
        dataset_count=len(d.get("dataset_ids", [])),
        created_at=ts_to_str(d["created_at"]),
        updated_at=ts_to_str(d.get("updated_at") or d["created_at"]),
    )


@router.put("/{group_id}", response_model=DatasetGroup)
def update_dataset_group(group_id: str, payload: DatasetGroupUpdate):
    """Update a dataset group's name and/or dataset list."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("dataset_groups").document(group_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Dataset group {group_id} not found")
    if not payload.name.strip():
        raise HTTPException(400, "Name cannot be empty")

    # Validate all dataset IDs exist
    for did in payload.dataset_ids:
        if not db.collection("datasets").document(did).get().exists:
            raise HTTPException(404, f"Dataset {did} not found")

    ref.update({
        "name": payload.name.strip(),
        "dataset_ids": list(dict.fromkeys(payload.dataset_ids)),
        "updated_at": firestore.SERVER_TIMESTAMP,
    })

    doc = ref.get().to_dict()
    return DatasetGroup(
        group_id=doc["group_id"],
        name=doc["name"],
        dataset_ids=doc["dataset_ids"],
        dataset_count=len(doc["dataset_ids"]),
        created_at=ts_to_str(doc["created_at"]),
        updated_at=ts_to_str(doc.get("updated_at") or doc["created_at"]),
    )


@router.delete("/{group_id}")
def delete_dataset_group(group_id: str):
    """Delete a dataset group (does not delete the member datasets)."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("dataset_groups").document(group_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Dataset group {group_id} not found")
    ref.delete()
    return {"message": f"Dataset group {group_id} deleted", "group_id": group_id}
