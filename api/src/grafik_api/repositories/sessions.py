"""Сессии: refresh-токены и их семьи.

Семья — это цепочка токенов одного входа: каждое обновление выдаёт новый и
помечает прежний использованным. Предъявленный дважды токен означает, что
копия утекла, и тогда гасится вся семья — иначе вор и хозяин ходили бы по
очереди, не замечая друг друга.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select, update

from grafik_api.models import RefreshToken
from grafik_api.repositories.base import Repository


class RefreshTokenRepository(Repository[RefreshToken]):
    """Строки таблицы `refresh_tokens`."""

    model = RefreshToken

    async def by_digest(self, digest: bytes) -> RefreshToken | None:
        return await self.session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == digest)
        )

    def create(
        self,
        *,
        user_id: uuid.UUID,
        family_id: uuid.UUID,
        digest: bytes,
        device_id: str | None,
        issued_at: datetime,
        expires_at: datetime,
    ) -> RefreshToken:
        return self.add(
            RefreshToken(
                user_id=user_id,
                family_id=family_id,
                token_hash=digest,
                device_id=device_id,
                issued_at=issued_at,
                expires_at=expires_at,
            )
        )

    async def revoke_family(self, family_id: uuid.UUID, at: datetime) -> int:
        """Погасить всю семью. Возвращает число погашенных токенов.

        Одним запросом по всей семье, а не перебором: токенов в семье
        столько, сколько было обновлений, и гасить их надо все сразу.
        """
        результат = await self.session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.family_id == family_id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=at)
            .returning(RefreshToken.id)
        )
        return len(результат.scalars().all())
