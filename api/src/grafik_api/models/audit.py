"""Журнал событий безопасности — в базе, а не в логах.

Это разные вещи, и их нарочно не смешивают. Логи приложения — отладка, они
живут сроком хранения журналов контейнера и могут потеряться. Журнал
событий безопасности — обязанность оператора по ч. 1 ст. 19 152-ФЗ:
регистрация входов, смен пароля, выгрузок и удалений. Он живёт в базе 180
дней, и по нему отвечают человеку на вопрос «кто и когда заходил в мой
аккаунт».
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Identity, Index, String, Uuid
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from grafik_api.db.base import Base


class AuditEntry(Base):
    """Одно событие безопасности."""

    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_user_id_at", "user_id", "at"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)

    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Внешнего ключа здесь нет намеренно. С каскадом удаление аккаунта
    # стёрло бы и журнал — а одна обезличенная строка «аккаунт <uuid>
    # удалён <дата>» должна остаться: ею потом и подтверждают, что
    # удаление было исполнено. С `ON DELETE SET NULL` стёрся бы сам
    # идентификатор, то есть ровно то, что в этой строке и нужно.
    # Определить человека по такому uuid нельзя: адреса почты в базе уже
    # нет.
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    # `auth.login.ok`, `account.deleted`, `sync.push.conflict` — те же
    # имена, что у события в логах, чтобы одно искалось по другому.
    event: Mapped[str] = mapped_column(String(64), nullable=False)

    ip: Mapped[str | None] = mapped_column(INET, nullable=True)

    # Идентификатор запроса — мост между этой строкой и логами приложения.
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Подробности события: сколько элементов отправлено, какая ревизия,
    # почему отказ. Персональных данных здесь нет и быть не должно — ни
    # адреса почты, ни блобов, ни их частей.
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
