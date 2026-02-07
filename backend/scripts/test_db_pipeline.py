#!/usr/bin/env python3
"""
End-to-end test for the SQL + pgvector DB layer.

Run from the backend directory:
  python scripts/test_db_pipeline.py

Uses deterministic synthetic vectors (fixed seed). Dimensions come from config
(FACE_EMBEDDING_DIM, TEXT_EMBEDDING_DIM; default 512, 1536) and must match
your migrated schema.
"""
from __future__ import annotations

import os
import random
import sys
import uuid

# Ensure backend is on path so app is importable (whether run as script or from repo root)
_script_dir = os.path.dirname(os.path.abspath(__file__))
_backend = os.path.dirname(_script_dir)
if _backend not in sys.path:
    sys.path.insert(0, _backend)

from app.core.config import get_settings
from app.db.session import get_db
from app.models import (
    Customer,
    CustomerFaceEmbedding,
    CustomerMemory,
    CustomerPreference,
    Employee,
    Session,
    TranscriptChunk,
)
from app.repositories import (
    get_customer_context,
    search_face_nearest,
    search_memory_nearest,
)
from app.services.consent_service import customer_opt_out
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

SEED = 42
TEST_PREFIX = "test-e2e-"


def _check_db() -> None:
    """Fail fast with a clear message if Postgres is not reachable."""
    try:
        with get_db() as db:
            db.execute(select(1))
    except OperationalError as e:
        if "5432" in str(e) or "Connection refused" in str(e) or "could not connect" in str(e).lower():
            print(
                "[FAIL] Cannot connect to Postgres. Is it running?\n"
                "  1. Get a DB URL: sign up at https://neon.tech or https://supabase.com (free, pgvector included).\n"
                "  2. Set DATABASE_URL in backend/.env to that connection string.\n"
                "  3. Run migrations: python scripts/run_migrations.py\n"
                "  4. Run this script again.",
                file=sys.stderr,
            )
        raise SystemExit(1) from e


def _synthetic_vector(dim: int, seed_offset: int = 0) -> list[float]:
    """Deterministic synthetic embedding; length must match DB column dim."""
    rng = random.Random(SEED + seed_offset)
    return [rng.random() for _ in range(dim)]


def _run() -> None:
    _check_db()
    settings = get_settings()
    face_dim = getattr(settings, "face_embedding_dim", 512)
    text_dim = getattr(settings, "text_embedding_dim", 1536)

    random.seed(SEED)
    uid = str(uuid.uuid4())[:8]
    customer_id: str | None = None
    session_id: str | None = None

    customer_external_id = f"{TEST_PREFIX}customer-{uid}"
    employee_external_id = f"{TEST_PREFIX}employee-{uid}"

    # --- a) Create customer + employee ---
    with get_db() as db:
        customer = Customer(
            external_id=customer_external_id,
            display_name="Test Customer",
            notes="E2E test",
            consent_for_biometrics=True,
        )
        db.add(customer)
        db.flush()
        employee = Employee(
            external_id=employee_external_id,
            display_name="Test Employee",
        )
        db.add(employee)
        db.flush()
        customer_id = str(customer.id)

    # --- b) Create session ---
    with get_db() as db:
        emp = db.execute(select(Employee).where(Employee.external_id == employee_external_id)).scalar_one()
        cust = db.execute(select(Customer).where(Customer.id == customer_id)).scalar_one()
        session = Session(
            employee_id=str(emp.id),
            customer_id=str(cust.id),
            session_key=f"{TEST_PREFIX}session-{uid}",
        )
        db.add(session)
        db.flush()
        session_id = str(session.id)

    # --- c) Insert transcript chunks (text only) ---
    with get_db() as db:
        sess = db.get(Session, session_id)
        assert sess is not None
        for i, content in enumerate(["First chunk of transcript.", "Second chunk with more text."]):
            db.add(
                TranscriptChunk(
                    session_id=session_id,
                    chunk_index=i,
                    content=content,
                )
            )

    # --- d) Insert face embedding for customer ---
    face_vec = _synthetic_vector(face_dim, seed_offset=1)
    with get_db() as db:
        cust = db.get(Customer, customer_id)
        assert cust is not None
        db.add(
            CustomerFaceEmbedding(
                customer_id=customer_id,
                source_session_id=session_id,
                model_name="test-face-model",
                idempotency_hash=f"{TEST_PREFIX}face-{uid}",
                embedding=face_vec,
            )
        )

    # --- e) Insert preferences (likes/dislikes) ---
    with get_db() as db:
        db.add(
            CustomerPreference(
                customer_id=customer_id,
                kind="like",
                category="beverage",
                value="oat milk latte",
                source_session_id=session_id,
            )
        )
        db.add(
            CustomerPreference(
                customer_id=customer_id,
                kind="dislike",
                category="food",
                value="nuts",
                source_session_id=session_id,
            )
        )

    # --- Insert one customer_memory with text embedding (for retrieval step) ---
    text_vec = _synthetic_vector(text_dim, seed_offset=2)
    with get_db() as db:
        db.add(
            CustomerMemory(
                customer_id=customer_id,
                nugget="Customer prefers oat milk and avoids nuts.",
                model_name="test-text-model",
                source_session_id=session_id,
                idempotency_hash=f"{TEST_PREFIX}mem-{uid}",
                embedding=text_vec,
            )
        )

    # --- f) Retrieval 1: match customer by face embedding (top_k) ---
    with get_db() as db:
        face_results = search_face_nearest(db, face_vec, limit=5)
    match_ids = [r["customer_id"] for r in face_results]
    assert customer_id in match_ids, f"Expected customer {customer_id} in face results; got {face_results}"
    print("[PASS] Face search: customer matched in top_k")

    # --- f) Retrieval 2: customer memory by text embedding similarity (top_k) ---
    with get_db() as db:
        memory_results = search_memory_nearest(db, customer_id, text_vec, limit=5)
    assert len(memory_results) >= 1, f"Expected at least one memory; got {memory_results}"
    print("[PASS] Memory search: at least one memory returned")

    # --- g) Consent gating: set consent_for_biometrics = false, then face search returns nothing for this customer ---
    with get_db() as db:
        cust = db.get(Customer, customer_id)
        assert cust is not None
        cust.consent_for_biometrics = False

    with get_db() as db:
        face_results_after = search_face_nearest(db, face_vec, limit=10)
    ids_after = [r["customer_id"] for r in face_results_after]
    assert customer_id not in ids_after, (
        f"Consent gating: customer must not appear in face search when consent_for_biometrics=false; got {ids_after}"
    )
    print("[PASS] Consent gating: face search excluded customer when consent_for_biometrics=false")

    # --- h) Opt-out: hard delete customer; verify embeddings + preferences + memory removed, sessions customer_id nulled ---
    customer_opt_out(customer_id)

    with get_db() as db:
        sess = db.get(Session, session_id)
        assert sess is not None, "Session should still exist"
        assert sess.customer_id is None, "Session.customer_id must be NULL after opt-out"

        face_count = db.execute(
            select(func.count()).select_from(CustomerFaceEmbedding).where(
                CustomerFaceEmbedding.customer_id == customer_id
            )
        ).scalar()
        pref_count = db.execute(
            select(func.count()).select_from(CustomerPreference).where(
                CustomerPreference.customer_id == customer_id
            )
        ).scalar()
        mem_count = db.execute(
            select(func.count()).select_from(CustomerMemory).where(CustomerMemory.customer_id == customer_id)
        ).scalar()

    assert face_count == 0, f"Expected 0 face embeddings after opt-out; got {face_count}"
    assert pref_count == 0, f"Expected 0 preferences after opt-out; got {pref_count}"
    assert mem_count == 0, f"Expected 0 memories after opt-out; got {mem_count}"
    print("[PASS] Opt-out: session.customer_id nulled; face_embeddings, preferences, memory removed")

    # Optional: full context would 404 for deleted customer
    with get_db() as db:
        ctx = get_customer_context(db, customer_id, sessions_limit=10)
    assert ctx is None, "Customer context should be None after opt-out"
    print("[PASS] Customer context returns None after opt-out")

    print("\nAll assertions passed.")


def main() -> int:
    try:
        _run()
        return 0
    except Exception as e:
        print(f"\n[FAIL] {e}", file=sys.stderr)
        raise


if __name__ == "__main__":
    sys.exit(main())
