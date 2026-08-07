"""`ListUnitsQuery` — `GET /personnel/units`.

**Дополнение к `openapi.yaml`** (политика изменений API_Conventions разд.
1 допускает ADDITIVE-расширения). Спецификация описывает создание
подразделения и чтение его по идентификатору, но не даёт способа узнать,
какие подразделения существуют. Всякий экран, показывающий иерархию,
начинается с корня, а идентификатора корня взять неоткуда: он не
угадывается и не выводится из чего-либо уже известного клиенту.

`rootUnitId` сужает выборку до поддерева — ровно та операция, которую
`unit_scope` из JWT (API_Conventions разд. 2) будет требовать, когда
авторизация появится: пользователь видит своё подразделение и всё под
ним, а не справочник целиком. Пока проверки нет, параметр остаётся
средством навигации, но форма запроса уже та, которая переживёт её
появление.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ListUnitsQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    root_unit_id: UUID | None = None
