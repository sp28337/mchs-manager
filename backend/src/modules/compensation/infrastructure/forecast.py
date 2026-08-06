"""CO013-CO015 — проекция регионального прогноза затрат на компенсации.

Строится по расписанию (`compensation.rebuild_regional_forecast`, раз в
сутки) по всем подразделениям, у которых есть хотя бы одно
финализированное дело.

--- Только финализированные дела ---------------------------------------

Черновики в прогноз не входят. Дело в статусе `draft` — это ещё не
обязательство: его строки могут измениться волеизъявлением сотрудника,
а форма компенсации — ровно то, что прогноз и разделяет. Включить
черновики значило бы показать финансисту цифру, которая изменится сама
собой без единого действия с его стороны.

--- Пересчёт часов в сутки ---------------------------------------------

Приказ МЧС России № 410 п. 11: дополнительное время отдыха «равное
продолжительности» выполнения обязанностей, п. 12: если предоставить его
в другие дни недели невозможно, время «суммируется и предоставляются
дополнительные дни отдыха соответствующей продолжительности».

«Соответствующей продолжительности» — то есть день отдыха соответствует
нормальной продолжительности ежедневной службы, а не астрономическим
суткам. При 40-часовой служебной неделе это 8 часов (ФЗ-141 ст. 54,
ТК РФ ст. 91); при 36-часовой (вредные и опасные условия) — 7,2 ч.

Здесь взято 8 ч: прогноз считается по подразделению в целом, а состав
недельных норм внутри него разный, и точный пересчёт потребовал бы
разложить сумму обратно по сотрудникам. Это ОЦЕНКА, и названа она так же
в ответе API (`forecastRestDays`); точная величина причитающихся суток
определяется по каждому сотруднику при начислении в `rest_balance`
(Алгоритм Л), а не здесь.

Прежнее значение (24 ч) было выдумкой: приказа в проекте тогда не было,
и оно занижало прогноз втрое.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Numeric, cast, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.modules.compensation.domain.value_objects import CaseStatus, CompensationForm
from src.modules.compensation.infrastructure.orm_mapping import (
    compensation_case_table,
    compensation_line_table,
)
from src.modules.compensation.infrastructure.read_orm_mapping import (
    regional_forecast_table,
)
from src.modules.personnel.contracts.list_unit_subtree import list_unit_and_ancestor_ids

logger = logging.getLogger(__name__)

# Приказ № 410 п. 11-12 плюс ФЗ-141 ст. 54 — см. докстринг модуля.
HOURS_PER_REST_DAY = Decimal(8)


async def rebuild_forecast(session_factory: async_sessionmaker[AsyncSession]) -> int:
    """Перестраивает проекцию для всех подразделений. Возвращает число
    записанных строк.

    Затраты каждого дела попадают не только в его собственное
    подразделение, но и во все вышестоящие: прогноз регионального центра
    складывается из прогнозов его частей. Поэтому строки пишутся для
    подразделения дела И для каждого его предка — иначе региональный
    центр, у которого своих дел нет, показывал бы ноль.
    """
    async with session_factory() as session:
        totals: dict[tuple[UUID, date, date], _Totals] = {}
        ancestors_cache: dict[UUID, list[UUID]] = {}

        for unit_id, period_start, period_end in await _units_with_cases(session):
            measured = await _measure(
                session, unit_id=unit_id, period_start=period_start, period_end=period_end
            )
            if unit_id not in ancestors_cache:
                ancestors_cache[unit_id] = await list_unit_and_ancestor_ids(
                    session, unit_id=unit_id
                )
            for ancestor in ancestors_cache[unit_id] or [unit_id]:
                key = (ancestor, period_start, period_end)
                totals[key] = totals.get(key, _Totals()) + measured

        for (region_unit_id, period_start, period_end), measured in totals.items():
            await _upsert(
                session,
                region_unit_id=region_unit_id,
                period_start=period_start,
                period_end=period_end,
                totals=measured,
            )
        await session.commit()

    if totals:
        logger.info("compensation: перестроен прогноз, строк: %s", len(totals))
    return len(totals)


@dataclass(frozen=True)
class _Totals:
    monetary_hours: Decimal = Decimal(0)
    rest_hours: Decimal = Decimal(0)
    employee_count: int = 0
    case_count: int = 0

    def __add__(self, other: _Totals) -> _Totals:
        return _Totals(
            monetary_hours=self.monetary_hours + other.monetary_hours,
            rest_hours=self.rest_hours + other.rest_hours,
            # Сотрудник служит в одном подразделении, поэтому при
            # суммировании по иерархии он не может быть посчитан дважды:
            # его дело принадлежит ровно одной части.
            employee_count=self.employee_count + other.employee_count,
            case_count=self.case_count + other.case_count,
        )


async def _units_with_cases(session: AsyncSession) -> list[tuple[UUID, date, date]]:
    """Пары «подразделение + период», по которым есть что прогнозировать.

    Подразделение берётся из САМОГО ДЕЛА (миграция 0019), а не из текущей
    карточки сотрудника. Соединение с `personnel.employee` дало бы место
    службы СЕГОДНЯ: затраты марта переехали бы вслед за переведённым в
    апреле сотрудником, и бюджет части задним числом менялся бы от
    кадровых решений соседнего региона. Плюс это межсхемное обращение,
    которого разд. 10 не допускает.
    """
    rows = await session.execute(
        select(
            compensation_case_table.c.unit_id,
            compensation_case_table.c.period_start,
            compensation_case_table.c.period_end,
        )
        .where(compensation_case_table.c.status == CaseStatus.FINALIZED.value)
        .group_by(
            compensation_case_table.c.unit_id,
            compensation_case_table.c.period_start,
            compensation_case_table.c.period_end,
        )
    )
    return [(row.unit_id, row.period_start, row.period_end) for row in rows]


async def _measure(
    session: AsyncSession, *, unit_id: UUID, period_start: date, period_end: date
) -> _Totals:
    row = (
        await session.execute(
            select(
                func.coalesce(
                    func.sum(compensation_line_table.c.hours_amount).filter(
                        compensation_line_table.c.compensation_form
                        == CompensationForm.MONETARY.value
                    ),
                    cast(0, Numeric(12, 2)),
                ).label("monetary_hours"),
                func.coalesce(
                    func.sum(compensation_line_table.c.hours_amount).filter(
                        compensation_line_table.c.compensation_form
                        == CompensationForm.ADDITIONAL_REST_TIME.value
                    ),
                    cast(0, Numeric(12, 2)),
                ).label("rest_hours"),
                func.count(func.distinct(compensation_case_table.c.id)).label("case_count"),
                func.count(func.distinct(compensation_case_table.c.employee_id)).label(
                    "employee_count"
                ),
            )
            .select_from(
                compensation_line_table.join(
                    compensation_case_table,
                    compensation_case_table.c.id == compensation_line_table.c.case_id,
                )
            )
            .where(
                compensation_case_table.c.unit_id == unit_id,
                compensation_case_table.c.period_start == period_start,
                compensation_case_table.c.period_end == period_end,
                compensation_case_table.c.status == CaseStatus.FINALIZED.value,
            )
        )
    ).one()

    return _Totals(
        monetary_hours=Decimal(row.monetary_hours),
        rest_hours=Decimal(row.rest_hours),
        employee_count=row.employee_count,
        case_count=row.case_count,
    )


async def _upsert(
    session: AsyncSession,
    *,
    region_unit_id: UUID,
    period_start: date,
    period_end: date,
    totals: _Totals,
) -> None:
    values = {
        "region_unit_id": region_unit_id,
        "period_start": period_start,
        "period_end": period_end,
        "forecast_monetary_hours": totals.monetary_hours,
        "forecast_rest_days": (totals.rest_hours / HOURS_PER_REST_DAY).quantize(
            Decimal("0.01")
        ),
        "employee_count": totals.employee_count,
        "case_count": totals.case_count,
    }
    statement = pg_insert(regional_forecast_table).values(**values)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[
                regional_forecast_table.c.region_unit_id,
                regional_forecast_table.c.period_start,
                regional_forecast_table.c.period_end,
            ],
            set_={
                key: statement.excluded[key]
                for key in values
                if key not in {"region_unit_id", "period_start", "period_end"}
            }
            | {"computed_at": func.now()},
        )
    )
