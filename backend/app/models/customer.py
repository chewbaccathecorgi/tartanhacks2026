"""Customer entity: profile and consent."""
from __future__ import annotations

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class Customer(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "customers"

    external_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Consent: must be true for any biometric (face) storage/search
    consent_for_biometrics: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Relationships (for ORM; deletion/consent enforced in service layer)
    face_embeddings: Mapped[list] = relationship(
        "CustomerFaceEmbedding",
        back_populates="customer",
        cascade="all, delete-orphan",
    )
    preferences: Mapped[list] = relationship(
        "CustomerPreference",
        back_populates="customer",
        cascade="all, delete-orphan",
    )
    memories: Mapped[list] = relationship(
        "CustomerMemory",
        back_populates="customer",
        cascade="all, delete-orphan",
    )
    sessions: Mapped[list] = relationship(
        "Session",
        back_populates="customer",
        foreign_keys="Session.customer_id",
    )
