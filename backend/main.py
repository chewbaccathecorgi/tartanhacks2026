"""
Minimal FastAPI backend for Postgres + pgvector data layer.
DB access only; embeddings and attributes are passed in from outside.
Deployment-ready: CORS, configurable host/port via env.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.routers import customers, search

settings = get_settings()

app = FastAPI(
    title="Interaction Data API",
    description="Consent-safe storage and retrieval for customer/employee interactions (SQL + vector layer).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(customers.router)
app.include_router(search.router)


@app.get("/health")
def health():
    return {"status": "ok"}
