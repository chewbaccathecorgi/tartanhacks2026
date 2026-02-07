"""Interaction session: links employee, optional customer, and derived data."""
from __future__ import annotations

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class Session(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "sessions"

    employee_id: Mapped[str] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # Nullable: on customer opt-out we NULL this; session remains for analytics
    customer_id: Mapped[str | None] = mapped_column(
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    session_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)

    employee: Mapped["Employee"] = relationship("Employee", back_populates="sessions")
    customer: Mapped["Customer | None"] = relationship("Customer", back_populates="sessions")
    transcript_chunks: Mapped[list] = relationship(
        "TranscriptChunk",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    face_embeddings: Mapped[list] = relationship(
        "CustomerFaceEmbedding",
        back_populates="source_session",
        foreign_keys="CustomerFaceEmbedding.source_session_id",
    )
    coaching_notes: Mapped[list] = relationship(
        "CoachingNote",
        back_populates="session",
        cascade="all, delete-orphan",
    )
