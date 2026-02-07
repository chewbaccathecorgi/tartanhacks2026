"""
Embedding dimensions and DB configuration.
All embedding/text dimensions are configurable; vectors are enforced at DB level.
"""
from __future__ import annotations

import os
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings; embedding dims and DB URL."""

    # Database
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/tartanhacks",
    )

    # Vector dimensions (must match migration column definitions)
    face_embedding_dim: int = 512
    text_embedding_dim: int = 1536

    # Optional: pool settings
    pool_size: int = 5
    max_overflow: int = 10

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
