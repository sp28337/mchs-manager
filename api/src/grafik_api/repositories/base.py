"""Базовый репозиторий: то немногое, что одинаково у всех.

Ровно четыре действия, и все — про доступ к строкам. Ни одного метода
«найти по чему угодно» и ни одной сборки запросов из словаря: такие
обобщения экономят десять строк и отнимают возможность понять, какие
запросы уходят в базу.

Транзакцией репозиторий не управляет: её открывает и закрывает зависимость
`get_session` на границе запроса. Иначе операция из двух шагов оказалась бы
в двух транзакциях.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.db.base import Base


class Repository[ModelT: Base]:
    """Доступ к одной таблице."""

    model: type[ModelT]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, pk: Any) -> ModelT | None:
        """Строка по первичному ключу или `None`."""
        return await self.session.get(self.model, pk)

    def add(self, instance: ModelT) -> ModelT:
        """Поставить строку в очередь на запись.

        Без `await`: SQLAlchemy ничего не отправляет, пока не понадобится.
        Если идентификатор нужен сразу — вызывается `flush`.
        """
        self.session.add(instance)
        return instance

    async def delete(self, instance: ModelT) -> None:
        await self.session.delete(instance)

    async def flush(self) -> None:
        """Отправить накопленное в базу, не фиксируя транзакцию.

        Нужно там, где дальше требуется выданный базой идентификатор или
        срабатывание ограничения — например, уникальности адреса.
        """
        await self.session.flush()
