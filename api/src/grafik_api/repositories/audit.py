"""Журнал событий безопасности.

Пишется в базу, а не в логи: это требование к регистрации событий
(ч. 1 ст. 19 152-ФЗ), а логи — отладка и живут сроком хранения журналов
контейнера.

Персональных данных в подробностях быть не должно: ни адреса почты, ни
блобов. Человек здесь — `user_id`.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select

from grafik_api.core.context import get_request_id
from grafik_api.models import AuditEntry
from grafik_api.repositories.base import Repository


class AuditRepository(Repository[AuditEntry]):
    """Строки таблицы `audit_log`."""

    model = AuditEntry

    async def all_of(self, user_id: uuid.UUID) -> Sequence[AuditEntry]:
        """Журнал событий аккаунта по порядку — для выгрузки."""
        строки = await self.session.scalars(
            select(AuditEntry)
            .where(AuditEntry.user_id == user_id)
            .order_by(AuditEntry.at)
        )
        return строки.all()

    async def forget(self, user_id: uuid.UUID) -> int:
        """Стереть журнал аккаунта.

        Вызывается при удалении: журнал входов — тоже персональные данные,
        и обещание «уничтожается всё» распространяется и на него. Взамен
        остаётся одна обезличенная строка о самом удалении.
        """
        строки = await self.session.execute(
            delete(AuditEntry)
            .where(AuditEntry.user_id == user_id)
            .returning(AuditEntry.id)
        )
        return len(строки.scalars().all())

    def record(
        self,
        event: str,
        *,
        user_id: uuid.UUID | None = None,
        ip: str | None = None,
        details: dict[str, Any] | None = None,
        at: datetime | None = None,
    ) -> AuditEntry:
        """Записать событие.

        Идентификатор запроса подставляется сам — он мост между этой
        строкой и логами приложения.
        """
        return self.add(
            AuditEntry(
                at=at or datetime.now(UTC),
                user_id=user_id,
                event=event,
                ip=ip,
                request_id=get_request_id(),
                details=details,
            )
        )
