"""Журнал событий безопасности.

Пишется в базу, а не в логи: это требование к регистрации событий
(ч. 1 ст. 19 152-ФЗ), а логи — отладка и живут сроком хранения журналов
контейнера.

Персональных данных в подробностях быть не должно: ни адреса почты, ни
блобов. Человек здесь — `user_id`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from grafik_api.core.context import get_request_id
from grafik_api.models import AuditEntry
from grafik_api.repositories.base import Repository


class AuditRepository(Repository[AuditEntry]):
    """Строки таблицы `audit_log`."""

    model = AuditEntry

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
