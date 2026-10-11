"""Документ об ошибке (RFC 9457).

Схема объявлена здесь, а не собирается на месте, по одной причине: она
попадает в описание API, и фронт пишут по ней. Поля — как в
`docs/openapi-draft.yaml`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from grafik_api.core.errors import ProblemCode


class Problem(BaseModel):
    """Ошибка в формате problem+json."""

    # RFC 9457 разрешает дополнительные члены, и они у нас есть: нынешний
    # элемент при конфликте ревизий, `min_rev_available`, `retry_after`.
    model_config = ConfigDict(extra="allow")

    type: str
    title: str
    status: int
    code: ProblemCode
    detail: str | None = None
    # Идентификатор запроса — чтобы человек мог прислать его в письме, а мы
    # нашли в журнале всё об этом обращении.
    request_id: str | None = None
