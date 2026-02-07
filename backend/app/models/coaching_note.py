"""Optional: coaching notes per session (text only)."""
from __future__ import annotations

from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class CoachingNote(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "coaching_notes"

    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)

    session: Mapped["Session"] = relationship("Session", back_populates="coaching_notes")
