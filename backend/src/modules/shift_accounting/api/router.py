"""API учёта смен пожарного.

Профиль, отсутствия, расчёт периода и сверка с выданным табелем — всё,
что делает приложение.

--- О владении данными --------------------------------------------------

Каждый профиль сам себе владелец: операции адресуются по `profileId`, и
никакой иерархии над ним нет. Настоящая проверка прав появится вместе с
аутентификацией; сейчас её нет ни здесь, ни где-либо ещё, и об этом
сказано прямо, а не умолчано.
"""

from __future__ import annotations

from datetime import date as date_cls
from decimal import Decimal
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy import delete, func, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.application.problem import problem_exception
from src.building_blocks.infrastructure.db import get_session
from src.modules.service_calendar.infrastructure.orm_mapping import (
    calendar_day_table,
    calendar_year_table,
)
from src.modules.shift_accounting.api.schemas import (
    AbsenceResponse,
    CalculationResponse,
    CreateAbsenceRequest,
    CreateProfileRequest,
    DiscrepancyResponse,
    ProfileResponse,
    ReconciliationResponse,
    ReportedFiguresRequest,
    ShiftResponse,
)
from src.modules.shift_accounting.domain.calculation import (
    AbsencePeriod,
    CalendarFacts,
    PeriodCalculation,
    calculate_period,
)
from src.modules.shift_accounting.domain.reconciliation import (
    EmployerFigures,
    reconcile,
)
from src.modules.shift_accounting.domain.value_objects import (
    ABSENCE_KIND_BASIS,
    AbsenceKind,
    EmploymentKind,
    Gender,
    GuardCycle,
    GuardNumber,
    WorkingConditions,
    derive_weekly_norm,
)
from src.modules.shift_accounting.infrastructure.orm_mapping import (
    absence_table,
    profile_table,
    reported_timesheet_table,
)

router = APIRouter()

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ProfileId = Annotated[UUID, Path(alias="profileId")]

_problem = problem_exception


# ---------------------------------------------------------------- профиль


def _profile_response(row) -> ProfileResponse:  # type: ignore[no-untyped-def]
    weekly = derive_weekly_norm(
        employment=EmploymentKind(row.employment_kind),
        gender=Gender(row.gender),
        conditions=WorkingConditions(row.working_conditions),
        rural_locality=row.rural_locality,
    )
    return ProfileResponse(
        id=row.id,
        display_name=row.display_name,
        employment_kind=EmploymentKind(row.employment_kind),
        gender=Gender(row.gender),
        working_conditions=WorkingConditions(row.working_conditions),
        rural_locality=row.rural_locality,
        guard_number=row.guard_number,
        first_shift_date=row.first_shift_date,
        accounting_year=row.accounting_year,
        weekly_norm_hours=weekly.hours,
        weekly_norm_basis=weekly.basis,
    )


@router.post("/profiles", response_model=ProfileResponse, status_code=201)
async def create_profile(
    request: CreateProfileRequest, session: SessionDep
) -> ProfileResponse:
    """Регистрация.

    Учётный год берётся из даты первой смены, а не спрашивается отдельно:
    первая смена караула лежит в первых четырёх сутках года по
    определению цикла, и спрашивать год вдобавок значило бы дать
    возможность их рассогласовать.
    """
    profile_id = uuid4()
    try:
        await session.execute(
            insert(profile_table).values(
                id=profile_id,
                display_name=request.display_name,
                employment_kind=request.employment_kind.value,
                gender=request.gender.value,
                working_conditions=request.working_conditions.value,
                rural_locality=request.rural_locality,
                guard_number=request.guard_number,
                first_shift_date=request.first_shift_date,
                accounting_year=request.first_shift_date.year,
            )
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _problem(
            422,
            "domain-invariant-violation",
            "Дата первой смены задана неверно",
            "Первая смена караула приходится на 1, 2, 3 или 4 января: цикл "
            "«сутки через трое» четырёхдневный, и пятое января — это уже "
            "вторая смена какого-то из караулов.",
        ) from exc

    return await get_profile(profile_id, session)


@router.get("/profiles/{profileId}", response_model=ProfileResponse)
async def get_profile(profile_id: ProfileId, session: SessionDep) -> ProfileResponse:
    row = (
        await session.execute(select(profile_table).where(profile_table.c.id == profile_id))
    ).one_or_none()
    if row is None:
        raise _problem(404, "not-found", "Профиль не найден", str(profile_id))
    return _profile_response(row)


# ------------------------------------------------------------- отсутствия


@router.get("/profiles/{profileId}/absences", response_model=list[AbsenceResponse])
async def list_absences(profile_id: ProfileId, session: SessionDep) -> list[AbsenceResponse]:
    rows = (
        await session.execute(
            select(absence_table)
            .where(absence_table.c.profile_id == profile_id)
            .order_by(absence_table.c.starts_on)
        )
    ).all()
    return [
        AbsenceResponse(
            id=row.id,
            kind=AbsenceKind(row.kind),
            starts_on=row.starts_on,
            ends_on=row.ends_on,
            note=row.note,
            basis=ABSENCE_KIND_BASIS[AbsenceKind(row.kind)],
        )
        for row in rows
    ]


@router.post(
    "/profiles/{profileId}/absences", response_model=AbsenceResponse, status_code=201
)
async def add_absence(
    profile_id: ProfileId, request: CreateAbsenceRequest, session: SessionDep
) -> AbsenceResponse:
    if request.ends_on < request.starts_on:
        raise _problem(
            400,
            "validation-failed",
            "Период задан наоборот",
            "Дата окончания раньше даты начала.",
        )

    absence_id = uuid4()
    try:
        await session.execute(
            insert(absence_table).values(
                id=absence_id,
                profile_id=profile_id,
                kind=request.kind.value,
                starts_on=request.starts_on,
                ends_on=request.ends_on,
                note=request.note,
            )
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        # `excl_absence_no_overlap`: пересечение запрещено на уровне БД,
        # потому что смена, попавшая и в отпуск, и в больничный, была бы
        # исключена из нормы дважды.
        raise _problem(
            409,
            "overlapping-absence",
            "Периоды отсутствия пересекаются",
            "Этот период накладывается на уже внесённый. Смена, попавшая в "
            "два отсутствия сразу, уменьшила бы норму дважды — на 48 часов "
            "за одни сутки.",
        ) from exc

    return AbsenceResponse(
        id=absence_id,
        kind=request.kind,
        starts_on=request.starts_on,
        ends_on=request.ends_on,
        note=request.note,
        basis=ABSENCE_KIND_BASIS[request.kind],
    )


@router.delete("/profiles/{profileId}/absences/{absenceId}", status_code=204)
async def remove_absence(
    profile_id: ProfileId,
    absence_id: Annotated[UUID, Path(alias="absenceId")],
    session: SessionDep,
) -> None:
    result = await session.execute(
        delete(absence_table)
        .where(
            absence_table.c.id == absence_id,
            absence_table.c.profile_id == profile_id,
        )
        # RETURNING вместо `rowcount`: он же и отвечает на вопрос «а был
        # ли такой период у ЭТОГО профиля», не требуя отдельного SELECT.
        .returning(absence_table.c.id)
    )
    deleted = result.scalar_one_or_none()
    await session.commit()
    if deleted is None:
        raise _problem(404, "not-found", "Отсутствие не найдено", str(absence_id))


# ----------------------------------------------------------------- расчёт


async def _calendar_facts(
    session: AsyncSession, period_start: date_cls, period_end: date_cls
) -> tuple[CalendarFacts, frozenset[date_cls], bool]:
    """Рабочие/предпраздничные дни и праздники периода из календаря.

    Возвращается ещё и признак публикации: неопубликованный календарь
    считается по неполным данным, и человек обязан узнать об этом до
    того, как понесёт расчёт начальнику.
    """
    counts = (
        await session.execute(
            select(calendar_day_table.c.day_type, func.count())
            .where(
                calendar_day_table.c.day >= period_start,
                calendar_day_table.c.day < period_end,
            )
            .group_by(calendar_day_table.c.day_type)
        )
    ).all()
    by_type = {row[0]: row[1] for row in counts}

    holidays = (
        await session.execute(
            select(calendar_day_table.c.day).where(
                calendar_day_table.c.day >= period_start,
                calendar_day_table.c.day < period_end,
                calendar_day_table.c.day_type == "holiday",
            )
        )
    ).scalars().all()

    published = (
        await session.execute(
            select(func.bool_and(calendar_year_table.c.published)).where(
                calendar_year_table.c.year.between(period_start.year, period_end.year)
            )
        )
    ).scalar()

    return (
        CalendarFacts(
            working_days=by_type.get("working", 0),
            pre_holiday_days=by_type.get("pre_holiday", 0),
        ),
        frozenset(holidays),
        bool(published),
    )


async def _calculate(
    session: AsyncSession,
    profile_id: UUID,
    period_start: date_cls,
    period_end: date_cls,
) -> tuple[PeriodCalculation, CalculationResponse]:
    """Расчёт периода: доменный результат и его представление.

    Возвращается пара, а не одно представление. Сверка работает над
    доменным результатом — правила квалификации расхождений живут в
    домене, — а слой представления собирается из него же. Собирать
    доменный объект обратно из DTO значило бы завести правилам второе
    место жительства и однажды их рассогласовать.
    """
    row = (
        await session.execute(select(profile_table).where(profile_table.c.id == profile_id))
    ).one_or_none()
    if row is None:
        raise _problem(404, "not-found", "Профиль не найден", str(profile_id))
    if period_end <= period_start:
        raise _problem(
            400, "validation-failed", "Период задан наоборот", "Конец не позже начала."
        )

    weekly = derive_weekly_norm(
        employment=EmploymentKind(row.employment_kind),
        gender=Gender(row.gender),
        conditions=WorkingConditions(row.working_conditions),
        rural_locality=row.rural_locality,
    )
    calendar, holidays, published = await _calendar_facts(session, period_start, period_end)

    absence_rows = (
        await session.execute(
            select(absence_table).where(absence_table.c.profile_id == profile_id)
        )
    ).all()
    absences = [
        AbsencePeriod(start=a.starts_on, end_inclusive=a.ends_on, kind=a.kind)
        for a in absence_rows
    ]

    result = calculate_period(
        period_start=period_start,
        period_end=period_end,
        cycle=GuardCycle(
            guard=GuardNumber(str(row.guard_number)),
            first_shift_date=row.first_shift_date,
        ),
        weekly=weekly,
        calendar=calendar,
        absences=absences,
        holiday_days=holidays,
    )

    response = CalculationResponse(
        period_start=result.period_start,
        period_end=result.period_end,
        weekly_norm_hours=weekly.hours,
        weekly_norm_basis=weekly.basis,
        working_days=calendar.working_days,
        pre_holiday_days=calendar.pre_holiday_days,
        base_norm_hours=result.base_norm_hours,
        excluded_hours=result.excluded_hours,
        norm_hours=result.norm_hours,
        actual_hours=result.actual_hours,
        overtime_hours=result.overtime_hours,
        undertime_hours=result.undertime_hours,
        wrong_norm_undertime_hours=result.wrong_norm_undertime_hours,
        night_hours=result.night_hours,
        holiday_hours=result.holiday_hours,
        scheduled_shifts=result.scheduled_shifts,
        worked_shifts=result.worked_shifts,
        absent_shifts=result.absent_shifts,
        calendar_published=published,
        shifts=[
            ShiftResponse(
                started_on=shift.started_on,
                hours=shift.hours,
                night_hours=shift.night_hours,
                holiday_hours=shift.holiday_hours,
                absence_kind=AbsenceKind(shift.absence_kind) if shift.absence_kind else None,
            )
            for shift in result.shifts
        ],
    )
    return result, response


@router.get("/profiles/{profileId}/calculation", response_model=CalculationResponse)
async def get_calculation(
    profile_id: ProfileId,
    session: SessionDep,
    period_start: Annotated[date_cls, Query(alias="periodStart")],
    period_end: Annotated[date_cls, Query(alias="periodEnd")],
) -> CalculationResponse:
    _, response = await _calculate(session, profile_id, period_start, period_end)
    return response


# ------------------------------------------------------------------ сверка


@router.put(
    "/profiles/{profileId}/reconciliation", response_model=ReconciliationResponse
)
async def reconcile_period(
    profile_id: ProfileId, request: ReportedFiguresRequest, session: SessionDep
) -> ReconciliationResponse:
    """Сверка выданного табеля с расчётом.

    `PUT`, а не `POST`: числа за период — это одно и то же значение, и
    повторная отправка обязана его ЗАМЕНИТЬ, а не завести второе.
    Человек уточняет цифры, глядя в бумажный табель, и каждая правка
    иначе плодила бы историю, которой он не просил.
    """
    domain_result, calculation = await _calculate(
        session, profile_id, request.period_start, request.period_end
    )

    statement = pg_insert(reported_timesheet_table).values(
        id=uuid4(),
        profile_id=profile_id,
        period_start=request.period_start,
        period_end=request.period_end,
        norm_hours=request.norm_hours,
        actual_hours=request.actual_hours,
        overtime_hours=request.overtime_hours,
    )
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[
                reported_timesheet_table.c.profile_id,
                reported_timesheet_table.c.period_start,
                reported_timesheet_table.c.period_end,
            ],
            set_={
                "norm_hours": statement.excluded.norm_hours,
                "actual_hours": statement.excluded.actual_hours,
                "overtime_hours": statement.excluded.overtime_hours,
                "recorded_at": func.now(),
            },
        )
    )
    await session.commit()

    discrepancies = reconcile(
        domain_result,
        EmployerFigures(
            norm_hours=request.norm_hours,
            actual_hours=request.actual_hours,
            overtime_hours=request.overtime_hours,
        ),
    )

    return ReconciliationResponse(
        calculation=calculation,
        reported=request,
        discrepancies=[
            DiscrepancyResponse(
                field_name=item.field,
                label=item.label,
                expected=item.expected,
                reported=item.reported,
                delta=item.delta,
                favours_employer=item.favours_employer,
                explanation=item.explanation,
                basis=item.basis,
            )
            for item in discrepancies
        ],
    )


@router.get("/profiles/{profileId}/reported", response_model=list[ReportedFiguresRequest])
async def list_reported(
    profile_id: ProfileId, session: SessionDep
) -> list[ReportedFiguresRequest]:
    rows = (
        await session.execute(
            select(reported_timesheet_table)
            .where(reported_timesheet_table.c.profile_id == profile_id)
            .order_by(reported_timesheet_table.c.period_start)
        )
    ).all()
    return [
        ReportedFiguresRequest(
            period_start=row.period_start,
            period_end=row.period_end,
            norm_hours=Decimal(row.norm_hours) if row.norm_hours is not None else None,
            actual_hours=Decimal(row.actual_hours) if row.actual_hours is not None else None,
            overtime_hours=(
                Decimal(row.overtime_hours) if row.overtime_hours is not None else None
            ),
        )
        for row in rows
    ]
