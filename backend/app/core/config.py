"""
Embedding dimensions and DB configuration.
All values are overridable via env; suitable for deployment (no localhost assumptions).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings

# Prefer backend/.env so scripts work regardless of CWD (run from backend/ or repo root)
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_ENV_PATH = _BACKEND_DIR / ".env"


def _ensure_supabase_ssl(url: str) -> str:
    """Append sslmode=require for Supabase URLs if missing (Supabase requires SSL)."""
    if "supabase" not in url.lower():
        return url
    if "sslmode=" in url.lower():
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}sslmode=require"


class Settings(BaseSettings):
    """Application settings; override via env or .env for deployment."""

    # Database (required in production; set DATABASE_URL to your Postgres URI)
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/tartanhacks",
    )

    # Vector dimensions (must match migration column definitions)
    face_embedding_dim: int = 512
    text_embedding_dim: int = 1536

    # Server (for deployment: bind to 0.0.0.0, set PORT via env)
    host: str = "0.0.0.0"
    port: int = 8000

    # CORS: comma-separated origins, or "*" for allow-all (e.g. "https://app.example.com")
    cors_origins: str = "*"

    # Optional: pool settings
    pool_size: int = 5
    max_overflow: int = 10

    model_config = {
        "env_file": str(_ENV_PATH) if _ENV_PATH.exists() else ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.database_url = _ensure_supabase_ssl(self.database_url)

    def cors_origins_list(self) -> list[str]:
        if not self.cors_origins or self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
