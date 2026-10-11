"""Ручки синхронизации: выборка изменений и отправка правок.

Обе требуют access-токена, и обе работают только со своим аккаунтом:
идентификатор берётся из токена, а не из запроса, — поэтому попросить
чужие элементы попросту нечем.

Предел частоты стоит на отправке: шестьдесят запросов в минуту на аккаунт
(раздел 7 контракта). Выборка не ограничена — она ничего не меняет, а
защита от слишком частых чтений, если понадобится, встанет на nginx
(шаг 13).
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from grafik_api.api.deps import CurrentUserDep, SyncServiceDep, check_rate
from grafik_api.core.limits import PAGE_SIZE, SYNC
from grafik_api.core.security import decode_wrapped
from grafik_api.schemas.sync import (
    AppliedOut,
    ItemOut,
    PullOut,
    PushIn,
    PushOut,
)
from grafik_api.services.sync import PushCommand

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("", summary="Что изменилось после ревизии")
async def pull(
    user_id: CurrentUserDep,
    service: SyncServiceDep,
    since: int = Query(ge=0, description="Ревизия, после которой нужны изменения"),
    limit: int = Query(default=PAGE_SIZE, ge=1, le=PAGE_SIZE),
) -> PullOut:
    """Отдать изменения после ревизии `since`.

    Курсор обязателен и начинается с нуля: «выбрать всё» — это `since=0`,
    и отдельного слова для этого не нужно.
    """
    результат = await service.pull(user_id, since=since, limit=limit)

    return PullOut(
        rev=результат.rev,
        min_rev_available=результат.min_rev_available,
        items=[ItemOut.of(item) for item in результат.items],
        has_more=результат.has_more,
    )


@router.post("", summary="Отправить изменения")
async def push(
    данные: PushIn,
    request: Request,
    user_id: CurrentUserDep,
    service: SyncServiceDep,
) -> PushOut:
    """Применить правки.

    Код ответа 200 и при расхождениях: конфликт — не ошибка запроса.
    Клиент получает и принятые элементы, и нынешнее состояние тех, что
    разошлись, сливает их у себя и отправляет снова.
    """
    check_rate(request, f"sync:{user_id}", SYNC)

    результат = await service.push(
        user_id,
        [
            PushCommand(
                kind=элемент.kind,
                item_id=элемент.id,
                base_rev=элемент.base_rev,
                mutation_id=элемент.mutation_id,
                deleted=элемент.deleted,
                blob=(
                    decode_wrapped(элемент.blob) if элемент.blob is not None else None
                ),
            )
            for элемент in данные.items
        ],
    )

    return PushOut(
        rev=результат.rev,
        applied=[AppliedOut.of(принят) for принят in результат.applied],
        conflicts=[ItemOut.of(item) for item in результат.conflicts],
    )
