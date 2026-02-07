"""Structured customer preferences (likes/dislikes); no vectors."""
from __future__ import annotations

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class CustomerPreference(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "customer_preferences"

    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # e.g. 'like', 'dislike'
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    source_session_id: Mapped[str | None] = mapped_column(
        ForeignKey("sessions.id", ondelete="SET NULL"),
        nullable=True,
    )

    customer: Mapped["Customer"] = relationship("Customer", back_populates="preferences")
