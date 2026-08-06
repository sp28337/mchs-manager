"""LM013 — dev/test seed: по одному отпуску каждого вида.

    python -m scripts.seed_leave_dev

DoD задачи: «скрипт создаёт по одному отпуску каждого типа». Шесть видов
`LeaveType`, шесть предоставлений одному сотруднику — и здесь важнее
всего, что периоды НЕ пересекаются и не совпадают: инвариант 9.1.1
отверг бы такой набор, и данные, которые нельзя завести через домен, не
данные, а иллюстрация.

Идёт через ДОМЕН (`LeaveGrant.grant`), а не INSERT'ами — тот же приём,
что в `seed_personnel_dev`: засеянный набор не может нарушить инвариант,
который проверяют агрегаты.

--- Что этот скрипт НЕ делает -----------------------------------------

Не считает продолжительность по правилам. `EntitlementBasis` требует
ссылки на `RuleVersion`, а заводить нормативный акт ради тестовых данных
значило бы подменить `legal_rules` скриптом. Поэтому берётся ЛЮБАЯ
опубликованная версия правила категории `leave_entitlement`, а если её
нет — скрипт честно отказывается работать, называя причину.

Не сеет отзывы: отзыв меняет статус на `recalled`, и половина видов
отпуска перестала бы годиться для проверки «активного» пути. Один отзыв
делается вручную одной командой, а его отсутствие в данных заметно, в
отличие от лишнего.

Идемпотентен по паре {сотрудник, вид}: повторный запуск дополняет набор,
а не удваивает его.
"""

from __future__ import annotations

import asyncio
from datetime import date

from sqlalchemy import select

from src.building_blocks.infrastructure.db import dispose_engine, get_session, init_engine
from src.composition.settings import get_settings
from src.modules.leave_management.domain.leave_grant import LeaveGrant
from src.modules.leave_management.domain.value_objects import (
    EntitlementBasis,
    LeavePeriod,
    LeaveType,
)
from src.modules.leave_management.infrastructure.orm_mapping import (
    leave_grant_table,
)
from src.modules.leave_management.infrastructure.orm_mapping import (
    start_mappers as start_leave_mappers,
)
from src.modules.legal_rules.infrastructure.write.orm_mapping import (
    rule_table,
    rule_version_table,
)
from src.modules.legal_rules.infrastructure.write.orm_mapping import (
    start_mappers as start_legal_rules_mappers,
)
from src.modules.personnel.infrastructure.orm_mapping import (
    employee_table,
)
from src.modules.personnel.infrastructure.orm_mapping import (
    start_mappers as start_personnel_mappers,
)

# Периоды подобраны так, чтобы не пересекаться и не быть смежными: набор
# должен проходить инвариант 9.1.1 без оговорок.
SEED_YEAR = 2027
PLAN: tuple[tuple[LeaveType, tuple[int, int], int, int], ...] = (
    (LeaveType.BASIC, (1, 12), 30, 45),
    (LeaveType.ADDITIONAL, (2, 20), 10, 10),
    (LeaveType.PERSONAL_CIRCUMSTANCES_20Y, (4, 6), 30, 30),
    (LeaveType.EDUCATIONAL, (6, 1), 14, 14),
    (LeaveType.MATERNITY, (8, 3), 140, 140),
    (LeaveType.CHILD_CARE, (12, 24), 30, 30),
)


async def main() -> None:
    settings = get_settings()
    init_engine(dsn=settings.database_dsn, pool_size=settings.database_pool_size)

    start_personnel_mappers()
    start_legal_rules_mappers()
    start_leave_mappers()

    async for session in get_session():
        employee_id = await session.scalar(
            select(employee_table.c.id).order_by(employee_table.c.personnel_number).limit(1)
        )
        if employee_id is None:
            raise SystemExit(
                "нет ни одного сотрудника: сначала `make seed-personnel` — "
                "отпуск без сотрудника завести не из чего"
            )

        rule_version_id = await session.scalar(
            select(rule_version_table.c.id)
            .select_from(
                rule_version_table.join(
                    rule_table, rule_table.c.id == rule_version_table.c.rule_id
                )
            )
            .where(
                rule_table.c.category == "leave_entitlement",
                rule_version_table.c.status == "published",
            )
            .limit(1)
        )
        if rule_version_id is None:
            raise SystemExit(
                "нет опубликованной версии правила категории leave_entitlement: "
                "продолжительность отпуска обязана ссылаться на норму "
                "(Domain Model разд. 9.1), и подставить её скриптом нельзя"
            )

        existing = {
            row.leave_type
            for row in await session.execute(
                select(leave_grant_table.c.leave_type).where(
                    leave_grant_table.c.employee_id == employee_id
                )
            )
        }

        created = 0
        for leave_type, (month, day), length, entitled in PLAN:
            if leave_type.value in existing:
                continue

            start = date(SEED_YEAR, month, day)
            grant = LeaveGrant.grant(
                employee_id=employee_id,
                leave_type=leave_type,
                period=LeavePeriod(start=start, end=_plus_days(start, length)),
                entitlement=EntitlementBasis(
                    rule_version_id=rule_version_id,
                    entitled_days=entitled,
                    seniority_years=21,
                ),
            )
            # События не публикуются: seed не есть кадровое решение, и
            # рассылать по нему уведомления было бы неверно.
            grant.pull_pending_events()
            session.add(grant)
            created += 1

        await session.commit()
        print(
            f"seed_leave_dev: сотрудник {employee_id}, создано предоставлений: "
            f"{created}, уже было: {len(existing)}"
        )

    await dispose_engine()


def _plus_days(start: date, days: int) -> date:
    from datetime import timedelta

    return start + timedelta(days=days)


if __name__ == "__main__":
    asyncio.run(main())
