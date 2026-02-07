"""Opt-out repository: hard-delete sequence for biometric and derived data."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.repositories.queries import SQL_OPT_OUT_DELETE_CUSTOMER, SQL_OPT_OUT_NULL_SESSIONS


def opt_out_customer(db: Session, customer_id: str) -> None:
    """
    Hard-delete / opt-out sequence:
    1) NULL customer_id on all sessions (sessions remain for analytics).
    2) DELETE customer (CASCADE deletes face_embeddings, preferences, customer_memory).
    Call within a transaction; caller should commit.
    """
    db.execute(text(SQL_OPT_OUT_NULL_SESSIONS), {"customer_id": customer_id})
    db.execute(text(SQL_OPT_OUT_DELETE_CUSTOMER), {"customer_id": customer_id})
