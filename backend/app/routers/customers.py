"""Thin API layer: customer context and opt-out."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.session import get_db
from app.repositories import get_customer_context
from app.services.consent_service import customer_opt_out

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("/{customer_id}/context")
def get_context(
    customer_id: str,
    sessions_limit: int = 20,
):
    """Fetch full customer context: profile, preferences, recent sessions."""
    with get_db() as db:
        ctx = get_customer_context(db, customer_id, sessions_limit=sessions_limit)
    if ctx is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return ctx


@router.delete("/{customer_id}/opt-out")
def opt_out(customer_id: str):
    """
    Hard-delete customer and all biometric/derived data; sessions keep row with customer_id NULL.
    """
    try:
        customer_opt_out(customer_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "ok", "customer_id": customer_id}
