"""Секреты аккаунта: проверочное значение пароля и обёртки ключа данных.

Две таблицы в одном модуле намеренно: обе ровно про один аккаунт, обе
заполняются при регистрации и обе переписываются при смене пароля. Порознь
к ним не обращаются.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from grafik_api.models import Credential, DataKey
from grafik_api.repositories.base import Repository

# Чем открывается обёртка ключа данных; значения проверяет ограничение в
# базе. `noqa` здесь по делу: линтер ищет зашитые пароли по строке
# "password", а это вид обёртки, и пароля в коде нет вовсе — он не доходит
# до сервера даже в виде хэша.
KIND_PWD = "password"  # noqa: S105
KIND_REC = "recovery"


class CredentialRepository(Repository[Credential]):
    """Строки таблицы `credentials`."""

    model = Credential

    async def by_user(self, user_id: uuid.UUID) -> Credential | None:
        return await self.session.scalar(
            select(Credential).where(Credential.user_id == user_id)
        )

    async def create(
        self, user_id: uuid.UUID, *, verifier_hash: str, kdf_version: str
    ) -> Credential:
        return self.add(
            Credential(
                user_id=user_id,
                verifier_hash=verifier_hash,
                kdf_version=kdf_version,
            )
        )


class DataKeyRepository(Repository[DataKey]):
    """Строки таблицы `data_keys` — зашифрованные обёртки ключа данных."""

    model = DataKey

    async def by_user(self, user_id: uuid.UUID) -> dict[str, bytes]:
        """Обёртки аккаунта: `{"password": …, "recovery": …}`."""
        строки = await self.session.scalars(
            select(DataKey).where(DataKey.user_id == user_id)
        )
        return {строка.kind: строка.wrapped for строка in строки}

    async def put(self, user_id: uuid.UUID, kind: str, wrapped: bytes) -> None:
        """Записать обёртку — вставкой или заменой.

        Одним запросом (`ON CONFLICT`), а не «прочитать и решить»: при
        смене пароля обёртка заменяется, и отдельный путь для этого писать
        незачем. `updated_at` ставится руками: автоматическое обновление
        срабатывает на UPDATE от ORM, а это запрос ядра.
        """
        запрос = insert(DataKey).values(user_id=user_id, kind=kind, wrapped=wrapped)
        await self.session.execute(
            запрос.on_conflict_do_update(
                index_elements=[DataKey.user_id, DataKey.kind],
                set_={"wrapped": запрос.excluded.wrapped, "updated_at": func.now()},
            )
        )
