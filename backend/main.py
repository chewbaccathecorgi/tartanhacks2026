"""
Minimal FastAPI backend for Postgres + pgvector data layer.
DB access only; embeddings and attributes are passed in from outside.
"""
from fastapi import FastAPI

from app.routers import customers, search

app = FastAPI(
    title="Interaction Data API",
    description="Consent-safe storage and retrieval for customer/employee interactions (SQL + vector layer).",
)

app.include_router(customers.router)
app.include_router(search.router)


@app.get("/health")
def health():
    return {"status": "ok"}
