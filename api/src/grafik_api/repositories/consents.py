"""Записи о согласии.

Запись не меняют и не удаляют: новая редакция документа — новая строка.
Так остаётся видно, с чем человек соглашался и когда: оператор обязан
доказать получение согласия (ч. 3 ст. 9 152-ФЗ).

Одна строка — один документ. Согласие на обработку и принятие соглашения —
разные действия человека, и в базе они разные строки (ч. 1 ст. 9: согласие
оформляется отдельно от иных документов).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import distinct_on

from grafik_api.models import Consent
from grafik_api.repositories.base import Repository


class ConsentRepository(Repository[Consent]):
    """Строки таблицы `consents`."""

    model = Consent

    def create(
        self,
        *,
        user_id: uuid.UUID,
        kind: str,
        version: str,
        sha256: str,
        via: str,
        accepted_at: datetime,
        ip: str | None,
    ) -> Consent:
        """Записать принятие одной редакции одного документа."""
        return self.add(
            Consent(
                user_id=user_id,
                kind=kind,
                version=version,
                sha256=sha256,
                via=via,
                accepted_at=accepted_at,
                ip=ip,
            )
        )

    async def all_of(self, user_id: uuid.UUID) -> Sequence[Consent]:
        """Вся история согласий аккаунта по порядку — для выгрузки."""
        строки = await self.session.scalars(
            select(Consent)
            .where(Consent.user_id == user_id)
            .order_by(Consent.accepted_at, Consent.kind)
        )
        return строки.all()

    async def latest_per_kind(self, user_id: uuid.UUID) -> list[Consent]:
        """Последняя принятая редакция каждого документа.

        «Что человек принял на сейчас» — это по строке на документ, а не вся
        история: старые редакции нужны выгрузке и доказательству, но не ответу
        на вопрос, нужно ли спрашивать заново.
        """
        строки = await self.session.scalars(
            select(Consent)
            .where(Consent.user_id == user_id)
            .order_by(Consent.kind, Consent.accepted_at.desc())
            .ext(distinct_on(Consent.kind))
        )
        return list(строки.all())
