"""Thin API layer: vector search (face and memory)."""
from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.db.session import get_db
from app.repositories import (
    search_face_nearest,
    search_memory_nearest,
    search_memory_nearest_global,
)

router = APIRouter(prefix="/search", tags=["search"])


class FaceSearchRequest(BaseModel):
    embedding: list[float]


class MemorySearchRequest(BaseModel):
    embedding: list[float]


@router.post("/face")
def face_nearest(
    body: FaceSearchRequest,
    limit: int = Query(10, ge=1, le=100),
):
    """
    Nearest-neighbor customer match by face embedding.
    Consent-gated: excludes customers with consent_for_biometrics = false.
    """
    with get_db() as db:
        return search_face_nearest(db, body.embedding, limit=limit)


@router.post("/memory")
def memory_nearest(
    body: MemorySearchRequest,
    customer_id: str | None = Query(None),
    limit: int = Query(10, ge=1, le=100),
):
    """
    Top-k customer memories by text embedding similarity.
    If customer_id is set, search within that customer; else global.
    """
    with get_db() as db:
        if customer_id:
            return search_memory_nearest(db, customer_id, body.embedding, limit=limit)
        return search_memory_nearest_global(db, body.embedding, limit=limit)
