"""Сессии и одноразовые ссылки.

Общее у этих двух таблиц одно: в них лежат не сами значения, а их хэши.
Утечка базы не должна давать возможности войти — ни по refresh-токену, ни
по ссылке из письма.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from grafik_api.db.base import Base


class RefreshToken(Base):
    """Длинный ключ сессии — в виде хэша.

    Токены живут семьями: при каждом обновлении выдаётся новый, старый
    помечается использованным. Повторное использование использованного —
    признак кражи, и тогда гасится вся семья (раздел 6 контракта). Поэтому
    `family_id` и `used_at` здесь не украшение: без них кражу не отличить
    от обычного обновления.
    """

    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("ix_refresh_tokens_user_id_family_id", "user_id", "family_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    family_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    # SHA-256 от случайных 32 байт. Быстрый хэш здесь уместен, в отличие от
    # пароля: значение случайное и длинное, подбирать его нечем.
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, unique=True)

    # Случайный uuid устройства, который заводит браузер. Персональных
    # данных в нём нет; нужен журналу входов и разбору «кто это входил».
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class OneTimeToken(Base):
    """Ссылка из письма: подтверждение адреса или восстановление доступа.

    Живёт сутки и срабатывает один раз. Хранится хэш — письмо может
    осесть в чужом ящике, но из базы ссылку не восстановить.
    """

    __tablename__ = "one_time_tokens"
    __table_args__ = (
        CheckConstraint("purpose IN ('verify_email', 'recover')", name="purpose"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, unique=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
