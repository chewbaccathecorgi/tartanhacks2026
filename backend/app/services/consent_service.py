"""
Consent and opt-out service: enforces hard-delete and session nulling.
Uses repositories for DB access; no ML/embedding logic.
"""
from __future__ import annotations

from app.db.session import get_db
from app.repositories.opt_out_repo import opt_out_customer


def customer_opt_out(customer_id: str) -> None:
    """
    Opt-out: hard-delete all customer-owned biometric and derived data.
    - Deletes face_embeddings (CASCADE)
    - Deletes customer_memory (CASCADE)
    - Deletes customer_preferences (CASCADE)
    - Sets customer_id to NULL on sessions (sessions remain for analytics)
    - Deletes the customer row.
    Must be run in a transaction; get_db() provides commit/rollback.
    """
    with get_db() as db:
        opt_out_customer(db, customer_id)
