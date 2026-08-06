"""Публичный контракт `personnel`: состояние сотрудника НА ДАТУ.

Третий контракт модуля, и он закрывает то, что `get_employee_snapshot`
честно объявлял своим пределом: тот отдаёт снимок «как известно сейчас» и
прямо предупреждает, что вопрос «где сотрудник служил в марте 2024»
отвечается из `service_record_entry` и «был бы другим контрактом с другой
подписью, намеренно не протащенным сюда необязательным параметром
`as_of`». Вот он.

--- Зачем он понадобился -----------------------------------------------

Алгоритм Б шаг 1 предписывает дословно: определить `position_category` и
`service_condition_category` **на дату `period_start`** — «не на текущую
дату — путём выборки последней записи `personnel.service_record_entry` с
`effective_date ≤ period_start`. Это обеспечивает корректный пересчёт
задним числом, если сотрудник позже сменил должность».

Требование не техническое, а правовое. SRS разд. 4 требует «пересчитать
переработку за любой прошлый год», Domain Model инвариант 6.1.5 — чтобы
повторный расчёт тех же данных дал идентичный результат. Пока категории
брались текущими, пересчёт марта 2024 после перевода сотрудника с
оперативной должности на административную тихо давал другую норму: другой
`scope` → другая `RuleVersion` → другое число. Без ошибки, без следа и не
в пользу сотрудника.

--- Как определяется состояние на дату ---------------------------------

`service_record_entry` — append-only летопись событий службы
(`assignment`, `transfer`, `rank_change`, `dismissal`), у каждого своя
`effective_date`. Состояние на дату — это последняя запись, вступившая в
силу не позже неё.

Три тонкости, каждая из которых меняет ответ:

1. **`position_id` и `unit_id` берутся из РАЗНЫХ записей.** Запись
   `rank_change` не несёт ни должности, ни подразделения (они `NULL`), и
   считать, что присвоение звания перевело человека в никуда, было бы
   абсурдом. Поэтому каждое поле ищется независимо: последняя запись, где
   ЭТО поле заполнено.
2. **Порядок при совпадении дат — по `recorded_at`.** Две записи одной
   `effective_date` разрешаются в пользу внесённой позже: это исправление,
   а не альтернатива.
3. **До первой записи ответа нет.** Если сотрудник принят позже
   запрошенной даты, поднимается `EmployeeStateUnknownAsOf`, а не
   подставляется текущее состояние. Расчёт периода, в котором человек ещё
   не служил, обязан отказать, а не посчитать ему норму.

--- `legal_base` историзирован (миграция 0020) -------------------------

Правовая база берётся из летописи наравне с должностью, и это не
удобство, а требование Алгоритма А шага 4. ФЗ-141 и ТК РФ дают разные
нормы: у аттестованного состава служебное время (ст. 54-55 ФЗ-141), у
гражданского персонала рабочее (ст. 91, 99, 104, 152, 153 ТК РФ).
Пересчёт периода, когда человек был вольнонаёмным, по нормам ФЗ-141 —
это применение к нему закона, который на него тогда не распространялся.

--- Чего здесь по-прежнему НЕТ ----------------------------------------

`service_condition_category` (обычные / вредные и опасные /
педагогические условия) остаётся текущим значением карточки: в летописи
его нет, а завести — значит решить, каким кадровым событием меняются
условия службы. Практически они меняются вместе с должностью, поэтому
`position_category` на дату уже несёт большую часть этого различия; но
совпадение неполное, и расхождение помечено здесь, а не спрятано.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import ColumnElement, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.personnel.infrastructure.orm_mapping import (
    employee_table,
    position_table,
    service_record_entry_table,
    unit_table,
)


class EmployeeStateUnknownAsOf(LookupError):
    """На запрошенную дату состояние сотрудника неизвестно: летопись
    службы не содержит ни одной записи, вступившей в силу не позже неё.

    Отдельная ошибка, а не подстановка текущего состояния: «сотрудник ещё
    не служил» и «сотрудник служил вот на этой должности» — разные ответы,
    и подменять первый вторым значит начислять норму за период до приёма
    на службу.
    """


class EmployeeStateAsOf(BaseModel):
    """Проекция состояния на дату — то, что нужно `scope` расчёта
    (Алгоритм Б шаг 2).

    Заметно уже `EmployeeSnapshot`: ни ФИО, ни табельного номера, ни
    статуса. Всё это либо не историзировано, либо не влияет на выбор
    `RuleVersion`, а контракт обязан отдавать то, ради чего его зовут, а
    не всё, что смог найти.
    """

    model_config = ConfigDict(frozen=True)

    employee_id: UUID
    as_of: date
    unit_id: UUID
    position_id: UUID
    # Строками, как и во всех контрактах этого модуля: enum'ы —
    # его собственный словарь.
    position_category: str
    service_condition_category: str
    regime_type: str
    time_zone: str
    rank: str | None
    # Правовая база НА ДАТУ (миграция 0020). `None`, если летопись о ней
    # молчит: у сотрудника, заведённого до появления колонки, запись о
    # приёме её несёт, а вот у заведённого мимо `assignment` — нет.
    # Потребитель решает сам, отказать или взять текущую; молча подставить
    # что-нибудь контракт не вправе.
    legal_base: str | None


class GetEmployeeStateAsOf(Protocol):
    async def __call__(self, *, employee_id: UUID, as_of: date) -> EmployeeStateAsOf: ...


async def get_employee_state_as_of(
    session: AsyncSession, *, employee_id: UUID, as_of: date
) -> EmployeeStateAsOf:
    """Состояние сотрудника на дату по append-only летописи службы."""
    position_id = await _latest_value(
        session,
        employee_id=employee_id,
        as_of=as_of,
        column=service_record_entry_table.c.position_id,
    )
    unit_id = await _latest_value(
        session,
        employee_id=employee_id,
        as_of=as_of,
        column=service_record_entry_table.c.unit_id,
    )
    rank = await _latest_value(
        session,
        employee_id=employee_id,
        as_of=as_of,
        column=service_record_entry_table.c.rank,
    )
    legal_base = await _latest_value(
        session,
        employee_id=employee_id,
        as_of=as_of,
        column=service_record_entry_table.c.legal_base,
    )

    if position_id is None or unit_id is None:
        raise EmployeeStateUnknownAsOf(
            f"на {as_of} состояние сотрудника {employee_id} неизвестно: в летописи "
            f"службы нет записи с должностью и подразделением, вступившей в силу "
            f"не позже этой даты"
        )

    row = (
        await session.execute(
            select(
                employee_table.c.service_condition_category,
                position_table.c.category,
                position_table.c.default_regime_type,
                unit_table.c.time_zone,
            )
            .select_from(employee_table)
            .join(position_table, position_table.c.id == position_id)
            .join(unit_table, unit_table.c.id == unit_id)
            .where(employee_table.c.id == employee_id)
        )
    ).one_or_none()

    if row is None:
        raise EmployeeStateUnknownAsOf(
            f"сотрудник {employee_id} не найден (или должность {position_id} / "
            f"подразделение {unit_id} из летописи больше не существуют)"
        )

    return EmployeeStateAsOf(
        employee_id=employee_id,
        as_of=as_of,
        unit_id=unit_id,
        position_id=position_id,
        position_category=row.category,
        # `service_condition_category` живёт на `employee`, а не на записи
        # летописи, поэтому историзировать его сегодня не из чего — берётся
        # текущее. Ограничение того же рода, что и с `legal_base`
        # (см. докстринг модуля).
        service_condition_category=row.service_condition_category,
        regime_type=row.default_regime_type,
        time_zone=row.time_zone,
        rank=rank,
        legal_base=legal_base,
    )


async def _latest_value(
    session: AsyncSession, *, employee_id: UUID, as_of: date, column: ColumnElement[Any]
) -> Any:
    """Значение поля из последней записи, где оно заполнено.

    Именно «где заполнено», а не «из последней записи»: `rank_change` не
    несёт должности, и брать её из такой записи значило бы получить `NULL`
    там, где должность не менялась (см. п. 1 докстринга модуля).
    """
    return await session.scalar(
        select(column)
        .where(
            service_record_entry_table.c.employee_id == employee_id,
            service_record_entry_table.c.effective_date <= as_of,
            column.isnot(None),
        )
        .order_by(
            desc(service_record_entry_table.c.effective_date),
            desc(service_record_entry_table.c.recorded_at),
        )
        .limit(1)
    )
