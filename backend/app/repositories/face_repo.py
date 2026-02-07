"""Face embedding repository: consent-gated nearest-neighbor search."""
from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.repositories.queries import SQL_FACE_NEAREST_NEIGHBOR


def search_face_nearest(
    db: Session,
    embedding: list[float],
    limit: int = 10,
) -> list[dict[str, Any]]:
    """
    Nearest-neighbor customer match by face embedding.
    EXCLUDES customers where consent_for_biometrics = false.
    embedding: list of 512 floats (face_embedding_dim).
    """
    # pgvector accepts string like '[0.1,0.2,...]'
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
    rows = db.execute(
        text(SQL_FACE_NEAREST_NEIGHBOR),
        {"embedding": embedding_str, "limit": limit},
    ).fetchall()
    return [
        {
            "customer_id": str(r[0]),
            "external_id": r[1],
            "display_name": r[2],
            "embedding_id": str(r[3]),
            "distance": float(r[4]),
        }
        for r in rows
    ]
