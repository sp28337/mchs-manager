"""Что приходит и уходит на пути `/sync`.

Двоичное едет в base64url. Сервер в это тело не заглядывает: для него
элемент — байты, размер и ревизия.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

from grafik_api.core.limits import MAX_ITEMS_PER_PUSH, PAGE_SIZE
from grafik_api.services.sync import Applied, Item

#: Зашифрованный элемент: `nonce ‖ шифротекст ‖ тег` в base64url. Предел
#: чуть выше мегабайта — столько занимает в base64 блоб предельного
#: размера; точную проверку размера делает сервис, по расшифрованной длине.
Blob64 = Annotated[
    str, StringConstraints(pattern=r"^[A-Za-z0-9_-]+$", max_length=1_400_000)
]

ItemKind = Literal["index", "profile"]


class ItemOut(BaseModel):
    """Состояние элемента на сервере."""

    id: str
    kind: ItemKind
    rev: int
    deleted: bool
    updated_at: datetime
    size: int
    #: У надгробия отсутствует.
    blob: Blob64 | None = None

    @classmethod
    def of(cls, item: Item) -> Self:
        return cls(
            id=item.item_id,
            kind=item.kind,
            rev=item.rev,
            deleted=item.deleted,
            updated_at=item.updated_at,
            size=item.size,
            blob=item.blob,
        )


class PullOut(BaseModel):
    """Ответ на выборку изменений."""

    #: Ревизия аккаунта на момент ответа — курсор для следующей выборки.
    rev: int
    #: Ревизия, начиная с которой история полна. Клиент, чей курсор
    #: меньше, обязан выбрать всё с нуля.
    min_rev_available: int
    items: list[ItemOut]
    has_more: bool


class PushItemIn(BaseModel):
    """Один отправляемый элемент."""

    id: str = Field(max_length=64)
    kind: ItemKind
    #: Ревизия, на которой клиент правил. `0` — элемента на сервере не было.
    base_rev: int = Field(ge=0)
    #: Опознание попытки записи. Повтор с тем же значением не создаёт новой
    #: ревизии: сеть рвётся, клиент повторяет, и дважды записанная правка
    #: выглядела бы конфликтом с самим собой.
    mutation_id: UUID
    deleted: bool = False
    blob: Blob64 | None = None


class PushIn(BaseModel):
    """Отправка изменений."""

    items: list[PushItemIn] = Field(min_length=1, max_length=MAX_ITEMS_PER_PUSH)


class AppliedOut(BaseModel):
    """Что принято и под какой ревизией."""

    id: str
    kind: ItemKind
    rev: int

    @classmethod
    def of(cls, applied: Applied) -> Self:
        return cls(
            id=applied.item_id,
            kind=applied.kind,
            rev=applied.rev,
        )


class PushOut(BaseModel):
    """Ответ на отправку.

    Расхождение — не ошибка запроса: в ответе придут и принятые, и
    конфликтные, чтобы клиент слил и повторил. Поэтому код 200, а не 409.
    """

    rev: int
    applied: list[AppliedOut]
    #: Нынешнее состояние элементов, чья базовая ревизия не совпала.
    conflicts: list[ItemOut]


#: Сколько элементов отдавать за раз, если клиент не попросил иного.
DEFAULT_LIMIT = PAGE_SIZE
