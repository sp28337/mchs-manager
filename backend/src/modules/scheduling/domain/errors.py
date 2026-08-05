"""Доменные исключения Scheduling. Поднимаются только методами агрегата;
в HTTP отображаются на границе API (API_Conventions разд. 3)."""

from __future__ import annotations


class SchedulingDomainError(Exception):
    """База для всех ошибок доменного слоя этого модуля."""


class OverlappingShiftError(SchedulingDomainError):
    """Domain Model инвариант 5.1.1: у сотрудника не может быть двух
    пересекающихся смен. Зеркало `excl_planned_shift_no_overlap`
    (миграция 0012). Отображается в 409 — openapi описывает именно этот
    код для «Пересечение смен сотрудника (EXCLUDE-инвариант)»."""


class ScheduleApprovedError(SchedulingDomainError):
    """Domain Model инвариант 5.1.3: утверждённый график неизменяем, любое
    изменение требует явного пересмотра. Отображается в 423."""


class ShiftOutsideSchedulePeriodError(SchedulingDomainError):
    """Смена должна начинаться внутри периода своего графика.

    Проверяется НАЧАЛО, а не весь интервал: суточное дежурство,
    начавшееся 31-го числа, законно заканчивается уже в следующем месяце
    (Алгоритм И: `shift_boundary_policy = 'assign_by_start'` — вся
    длительность относится к периоду начала). Требовать вложенности
    целиком значило бы запретить дежурство на стыке периодов.
    Отображается в 422."""


class EmployeeNotAvailableForShiftError(SchedulingDomainError):
    """Domain Model инвариант 5.1.4: смену нельзя назначить сотруднику,
    чей `EmploymentStatus` не `active` на дату её начала. Факт
    межмодульный (живёт в `personnel`), поэтому проверяется обработчиком
    через контракт, а не самим агрегатом. Отображается в 422."""


class MinimumRestPeriodViolationError(SchedulingDomainError):
    """Domain Model инвариант 5.1.2: между сменами должен соблюдаться
    минимальный межсменный отдых, величина которого берётся из
    `RuleVersion` категории `minimum_rest_period`. Проверка выходит за
    границы одного агрегата (соседний период), поэтому живёт в
    `RestPeriodPolicyService`. Отображается в 422."""


class ScheduleNotFoundError(SchedulingDomainError):
    """График не найден. Отображается в 404."""


class SchedulePeriodAlreadyExistsError(SchedulingDomainError):
    """`uq_duty_schedule_unit_period` (миграция 0012) — на пару
    «подразделение + период» график один. Отображается в 409."""
