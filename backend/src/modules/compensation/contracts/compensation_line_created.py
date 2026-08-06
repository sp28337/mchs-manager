"""CO020 — публичная схема события `CompensationLineCreated`.

Единственный контракт этого модуля, и он не запрос, а СХЕМА СОБЫТИЯ:
`rest_balance` (фаза 9) не спрашивает `compensation` ни о чём — он
подписан на поток и получает факты сам.

--- Зачем схема, если событие и так сериализуется -----------------------

DoD задачи: «RestBalance валидирует входящее событие по опубликованной
схеме». Смысл в том, что подписчик не должен разбирать чужой JSON
руками: между публикацией и потреблением стоит Redis, то есть граница,
на которой типы теряются. Без схемы каждый потребитель заводил бы
собственное представление события, и первое же изменение поля
обнаружилось бы как `KeyError` в проде.

Схема живёт в `contracts/`, а не в `domain/`, ровно поэтому: доменное
событие — внутренний тип модуля, он может меняться вместе с агрегатом.
То, что уходит наружу, обязано меняться отдельно и осознанно
(Architecture разд. 4.2, разд. 9.2).

--- Почему часы строкой ------------------------------------------------

`hours_amount` приходит строкой, а не числом: в `jsonb` его кладёт
`to_jsonable`, и кладёт именно так, чтобы не потерять точность
(`float(Decimal("7.20"))` = 7.199999999999999). Здесь строка снова
становится `Decimal` — часы уходят в начисление ДДО, то есть в то, что
сотруднику причитается.

--- Что обязан сделать потребитель -------------------------------------

Начислять только по строкам с формой `additional_rest_time`: денежная
компенсация — предмет расчёта денежного довольствия, а не баланса ДДО.

Порядок выплаты установлен Приказом МЧС России от 27.06.2024 № 539
(пп. 103-111). П. 18 Приказа № 410 ссылается на Приказ МЧС России от
21.03.2013 № 195, но тот утратил силу: приложение N 2 к Приказу № 539,
п. 1. Ссылку следует читать как отсылку к действующему порядку —
отсылочная норма переживает акт, на который отсылает.

`legal_basis_rule_version_id` обязан попасть в провенанс начисления:
Domain Model инвариант 8.1.2 — «начисление ДДО не может возникнуть из
воздуха, вне процесса компенсации».
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

EVENT_TYPE = "CompensationLineCreated"
AGGREGATE_TYPE = "CompensationCase"


class CompensationLineCreatedPayload(BaseModel):
    """Опубликованная форма события.

    Имена полей — как в потоке (snake_case из `event_payload`), а не как в
    HTTP-API: это две разные границы, и подгонять их друг под друга
    значило бы связать их изменения.

    `extra="ignore"`, а не `"forbid"`: событие может обрасти новыми
    полями, и потребитель, падающий на незнакомом поле, превратил бы
    ADDITIVE-изменение публикующей стороны в аварию у себя.
    """

    model_config = ConfigDict(frozen=True, extra="ignore")

    case_id: UUID
    line_id: UUID
    employee_id: UUID
    hour_category: str
    hours_amount: Decimal
    compensation_form: str
    legal_basis_rule_version_id: UUID
    period_start: date
    period_end: date
    # Добавляется релеем из колонок таблицы outbox (см. `_payload`).
    aggregate_id: UUID | None = None

    @field_validator("hours_amount", mode="before")
    @classmethod
    def _decimal_from_string(cls, value: Any) -> Any:
        """Строка -> `Decimal` без промежуточного `float`.

        `Decimal(7.2)` даёт 7.2000000000000001776356839400250464677810668945…;
        `Decimal("7.2")` — ровно 7.2. Разница уходит в часы отдыха,
        которые сотруднику причитаются.
        """
        return Decimal(value) if isinstance(value, str) else value

    @property
    def is_rest_time(self) -> bool:
        """Единственная строка, по которой `rest_balance` начисляет сутки
        отдыха. Денежная — предмет другой системы."""
        return self.compensation_form == "additional_rest_time"
