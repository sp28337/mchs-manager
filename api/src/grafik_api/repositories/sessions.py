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

from grafik_api.models import OneTimeToken, RefreshToken
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

    async def revoke_all(
        self, user_id: uuid.UUID, at: datetime, *, keep_device: str | None = None
    ) -> int:
        """Погасить все сессии аккаунта, кроме одного устройства.

        Так ведёт себя смена пароля: прочие сессии гаснут, а то устройство,
        на котором пароль меняли, остаётся в деле. Устройство опознаётся
        по заголовку `X-Device-Id` — подделать его может только сам хозяин
        аккаунта, которому это ничего не даёт.

        Без `keep_device` гасится всё — так ведёт себя восстановление
        доступа: там неизвестно, кто именно восстанавливает.
        """
        условия = [
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        ]
        if keep_device is not None:
            условия.append(RefreshToken.device_id.is_distinct_from(keep_device))

        строки = await self.session.execute(
            update(RefreshToken)
            .where(*условия)
            .values(revoked_at=at)
            .returning(RefreshToken.id)
        )
        return len(строки.scalars().all())


class OneTimeTokenRepository(Repository[OneTimeToken]):
    """Строки таблицы `one_time_tokens` — ссылки из писем.

    Живут сутки и срабатывают один раз. В базе только хэш: письмо может
    осесть в чужом ящике, но из базы ссылку не восстановить.
    """

    model = OneTimeToken

    def create(
        self,
        *,
        user_id: uuid.UUID,
        purpose: str,
        digest: bytes,
        created_at: datetime,
        expires_at: datetime,
    ) -> OneTimeToken:
        return self.add(
            OneTimeToken(
                user_id=user_id,
                purpose=purpose,
                token_hash=digest,
                created_at=created_at,
                expires_at=expires_at,
            )
        )

    async def by_digest(self, digest: bytes) -> OneTimeToken | None:
        return await self.session.scalar(
            select(OneTimeToken).where(OneTimeToken.token_hash == digest)
        )
