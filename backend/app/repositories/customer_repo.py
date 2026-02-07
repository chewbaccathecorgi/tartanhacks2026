"""Customer repository: CRUD and context fetch using queries.py."""
from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.repositories.queries import SQL_CUSTOMER_CONTEXT


def get_customer_context(
    db: Session,
    customer_id: str,
    sessions_limit: int = 20,
) -> dict[str, Any] | None:
    """
    Fetch full customer context: profile, preferences, recent sessions.
    Returns single row with keys profile, preferences, recent_sessions.
    """
    row = db.execute(
        text(SQL_CUSTOMER_CONTEXT),
        {"customer_id": customer_id, "sessions_limit": sessions_limit},
    ).fetchone()
    if not row or row[0] is None:
        return None
    return {
        "profile": row[0],
        "preferences": row[1] or [],
        "recent_sessions": row[2] or [],
    }
