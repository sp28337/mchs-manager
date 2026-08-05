"""Доменные исключения Time Accounting. Поднимаются только доменным
слоем; в HTTP отображаются на границе API (API_Conventions разд. 3)."""

from __future__ import annotations


class TimeAccountingDomainError(Exception):
    """База для всех ошибок доменного слоя этого модуля."""


class OverlappingServiceTimeEventError(TimeAccountingDomainError):
    """Domain Model инвариант 6.1.1: события одного табеля не пересекаются.

    Один момент времени не бывает одновременно и болезнью, и фактической
    сменой. Случай «смена прервана болезнью» моделируется РАЗБИЕНИЕМ на
    два непересекающихся события, а не наложением, — иначе один и тот же
    час попал бы и в факт службы, и в объяснённое отсутствие, то есть был
    бы посчитан дважды в разные стороны.

    Зеркало `excl_service_time_event_no_overlap` (миграция 0014).
    Отображается в 409 — openapi для этой операции описывает
    «Пересечение с уже существующим фактом табеля»."""


class DailyServiceTimeLimitExceededError(TimeAccountingDomainError):
    """Domain Model инвариант 6.1.6: сумма часов фактических смен одного
    сотрудника за календарные сутки не может превышать 24.

    Проверка живёт НЕ в агрегате: внутри одного табеля она бессодержательна
    (инвариант 6.1.1 уже запрещает пересечения, а непересекающиеся
    интервалы не могут дать за сутки больше 24 ч). Смысл появляется только
    на стыке двух табелей одного сотрудника — см.
    `DailyServiceTimeLimitService`. Отображается в 422."""


class OvertimeWithoutOrderError(TimeAccountingDomainError):
    """Domain Model инвариант 6.1.2: не бывает сверхнормативного времени
    без документа-основания (SRS разд. 8). Зеркало
    `ck_overtime_requires_order` (миграция 0014). Отображается в 422."""


class BusinessTripWithoutPlaceError(TimeAccountingDomainError):
    """Командировка без места назначения не является командировкой:
    именно место отличает её от обычного исполнения обязанностей. Зеркало
    `ck_business_trip_has_place` (миграция 0014). Отображается в 422."""


class EventOutsideTimesheetPeriodError(TimeAccountingDomainError):
    """Событие должно НАЧИНАТЬСЯ внутри периода табеля.

    Проверяется начало, а не вложенность целиком: Алгоритм И
    (`shift_boundary_policy = 'assign_by_start'`) относит всю длительность
    к периоду начала и прямо оговаривает в шаге 4, что табель «может
    содержать событие, физически заканчивающееся уже в датах следующего
    периода — это допустимо и предусмотрено». Требование вложенности
    запретило бы суточное дежурство на стыке месяцев. Отображается в 422."""


class TimesheetApprovedError(TimeAccountingDomainError):
    """Domain Model инвариант 6.1.4: утверждённый табель неизменяем.

    Любое изменение возможно только через явное переоткрытие с указанием
    ответственного и причины. Отображается в 423 (`ImmutableResource`) —
    ровно тот код, который openapi описывает для операций над табелем."""


class TimesheetReopenError(TimeAccountingDomainError):
    """Переоткрыть можно только утверждённый табель, и только с причиной
    (Domain Model инвариант 6.1.4). Отображается в 422."""


class CorrectionTargetNotFoundError(TimeAccountingDomainError):
    """Исправление ссылается на событие, которого в этом табеле нет.

    Проверяется именно принадлежность ЭТОМУ табелю, а не существование
    события вообще: `CorrectionEntry` — часть агрегата, и исправление
    чужого табеля означало бы, что граница агрегата не держит."""


class TimesheetNotFoundError(TimeAccountingDomainError):
    """Табель не найден. Отображается в 404."""


class TimesheetPeriodAlreadyOpenError(TimeAccountingDomainError):
    """`uq_timesheet_employee_period` (миграция 0014) — на пару
    «сотрудник + период» табель один. Отображается в 409."""


class OvertimeOrderNumberTakenError(TimeAccountingDomainError):
    """`uq_overtime_order_number` (миграция 0014) — номер приказа
    уникален. Отображается в 409."""
