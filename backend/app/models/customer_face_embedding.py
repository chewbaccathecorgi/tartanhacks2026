"""Face embeddings: provenance + vector; consent gated at query time."""
from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin

try:
    from pgvector.sqlalchemy import Vector as PgVector
except ImportError:
    PgVector = None  # type: ignore[misc, assignment]


class CustomerFaceEmbedding(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "customer_face_embeddings"

    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_session_id: Mapped[str | None] = mapped_column(
        ForeignKey("sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    idempotency_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    embedding: Mapped[list] = (
        mapped_column(PgVector(512), nullable=False)  # type: ignore[arg-type]
        if PgVector is not None
        else mapped_column(String(1), nullable=True)  # placeholder when pgvector not installed
    )

    customer: Mapped["Customer"] = relationship("Customer", back_populates="face_embeddings")
    source_session: Mapped["Session | None"] = relationship(
        "Session",
        back_populates="face_embeddings",
        foreign_keys=[source_session_id],
    )
