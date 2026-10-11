"""Записи о согласии.

Запись не меняют и не удаляют: новая редакция документов — новая строка.
Так остаётся видно, с чем человек соглашался и когда (ч. 1 ст. 9 152-ФЗ
возлагает доказывание на оператора).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select

from grafik_api.models import Consent
from grafik_api.repositories.base import Repository


class ConsentRepository(Repository[Consent]):
    """Строки таблицы `consents`."""

    model = Consent

    def create(
        self,
        *,
        user_id: uuid.UUID,
        policy_version: str,
        consent_version: str,
        terms_version: str,
        accepted_at: datetime,
        ip: str | None,
    ) -> Consent:
        return self.add(
            Consent(
                user_id=user_id,
                policy_version=policy_version,
                consent_version=consent_version,
                terms_version=terms_version,
                accepted_at=accepted_at,
                ip=ip,
            )
        )

    async def latest(self, user_id: uuid.UUID) -> Consent | None:
        """Последнее по времени согласие аккаунта."""
        return await self.session.scalar(
            select(Consent)
            .where(Consent.user_id == user_id)
            .order_by(Consent.accepted_at.desc())
            .limit(1)
        )
