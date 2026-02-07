"""Customer memory repository: top-k by text embedding similarity."""
from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.repositories.queries import (
    SQL_MEMORY_NEAREST_NEIGHBOR,
    SQL_MEMORY_NEAREST_NEIGHBOR_GLOBAL,
)


def search_memory_nearest(
    db: Session,
    customer_id: str,
    embedding: list[float],
    limit: int = 10,
) -> list[dict[str, Any]]:
    """
    Top-k customer memories by text embedding similarity for one customer.
    embedding: list of 1536 floats (text_embedding_dim).
    """
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
    rows = db.execute(
        text(SQL_MEMORY_NEAREST_NEIGHBOR),
        {"customer_id": customer_id, "embedding": embedding_str, "limit": limit},
    ).fetchall()
    return [
        {
            "id": str(r[0]),
            "customer_id": str(r[1]),
            "nugget": r[2],
            "model_name": r[3],
            "source_session_id": str(r[4]) if r[4] else None,
            "created_at": r[5].isoformat() if r[5] else None,
            "distance": float(r[6]),
        }
        for r in rows
    ]


def search_memory_nearest_global(
    db: Session,
    embedding: list[float],
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Top-k memories across all customers by text embedding similarity."""
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
    rows = db.execute(
        text(SQL_MEMORY_NEAREST_NEIGHBOR_GLOBAL),
        {"embedding": embedding_str, "limit": limit},
    ).fetchall()
    return [
        {
            "id": str(r[0]),
            "customer_id": str(r[1]),
            "nugget": r[2],
            "model_name": r[3],
            "source_session_id": str(r[4]) if r[4] else None,
            "created_at": r[5].isoformat() if r[5] else None,
            "distance": float(r[6]),
        }
        for r in rows
    ]
