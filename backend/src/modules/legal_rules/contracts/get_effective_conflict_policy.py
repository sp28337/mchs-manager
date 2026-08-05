"""Публичный контракт `legal_rules`: действующая политика разрешения
конфликта категорий часов.

Второй контракт этого модуля, рядом с `get_effective_rule_version`, и
отвечает он на такой же вопрос («что действовало на дату»), но про другую
сущность. Отдельным файлом, а не параметром первого: `RuleVersion` и
`ConflictResolutionPolicyVersion` — разные агрегаты с разными
идентичностями (Domain Model 2.2 и 2.3), и склеивать их в один вопрос
значило бы делать вид, что порядок приоритетов — это ещё одно правило
расчёта. Он не правило, а мета-правило: он говорит, какое из применимых
правил применяется.

--- Почему у него нет `scope` ------------------------------------------

`get_effective_rule_version` отбирает версию по `(rule_code, scope,
as_of)`, здесь же `scope` нет вовсе, и это не упущение схемы:
`conflict_resolution_policy_version` (логическая модель разд. 1.6)
колонки `scope` не имеет. Причина содержательная — порядок приоритетов
категорий устанавливается ведомственным актом единообразно, а не
по-разному для аттестованного состава и гражданского персонала. Если
когда-нибудь понадобится различать, это будет изменение схемы и
осознанное решение, а не тихое добавление параметра.

--- Про статус ---------------------------------------------------------

Отбираются версии в статусе `published` и `superseded` — ровно как в
`version_resolver` для правил. `superseded` включён намеренно: версия,
которую уже сменила следующая, продолжает быть действовавшей для дат
своего интервала, и без неё пересчёт прошлого периода взял бы сегодняшний
порядок приоритетов (Принцип 0.2 — «правило берётся на дату события, а не
расчёта»).
"""

from __future__ import annotations

from datetime import date
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.infrastructure.write.orm_mapping import (
    conflict_resolution_policy_table,
    conflict_resolution_policy_version_table,
)

DEFAULT_POLICY_CODE = "HOURS.CATEGORY_PRECEDENCE"

_APPLICABLE_STATUSES = ("published", "superseded")


class ConflictPolicyNotApplicable(LookupError):
    """Ни одна версия политики не покрывает дату.

    Отдельный тип ошибки, а не `None`: отсутствие порядка приоритетов —
    это пробел в нормативной базе, а не «не найдено». Молчаливое умолчание
    («ну пусть праздничные важнее ночных») означало бы, что система сама
    решила вопрос, который SRS разд. 9.3 держит открытым и адресует
    юристу. Отображается в 422.
    """


class EffectiveConflictPolicy(BaseModel):
    """Проекция, а не агрегат `ConflictResolutionPolicy` (Architecture
    разд. 4.2 п. 3)."""

    model_config = ConfigDict(frozen=True)

    policy_version_id: UUID
    policy_code: str
    version_no: int
    valid_from: date
    valid_to: date | None
    # Порядок важен и является содержанием: первая применимая категория
    # забирает час целиком (Алгоритм Ж шаг 4).
    precedence_list: list[str]


class GetEffectiveConflictPolicy(Protocol):
    async def __call__(
        self, *, as_of: date, policy_code: str = DEFAULT_POLICY_CODE
    ) -> EffectiveConflictPolicy: ...


async def get_effective_conflict_policy(
    session: AsyncSession, *, as_of: date, policy_code: str = DEFAULT_POLICY_CODE
) -> EffectiveConflictPolicy:
    """Версия политики, действовавшая на `as_of`.

    Интервал полуоткрытый — `valid_from <= as_of < valid_to`, — как и у
    правил: версия, вступающая в силу 1 января, не действует 31 декабря, и
    день смены редакции не должен принадлежать обеим версиям сразу.
    """
    row = (
        await session.execute(
            select(
                conflict_resolution_policy_version_table.c.id,
                conflict_resolution_policy_table.c.code,
                conflict_resolution_policy_version_table.c.version_no,
                conflict_resolution_policy_version_table.c.valid_from,
                conflict_resolution_policy_version_table.c.valid_to,
                conflict_resolution_policy_version_table.c.precedence_list,
            )
            .select_from(
                conflict_resolution_policy_version_table.join(
                    conflict_resolution_policy_table,
                    conflict_resolution_policy_version_table.c.policy_id
                    == conflict_resolution_policy_table.c.id,
                )
            )
            .where(
                conflict_resolution_policy_table.c.code == policy_code,
                conflict_resolution_policy_version_table.c.status.in_(_APPLICABLE_STATUSES),
                conflict_resolution_policy_version_table.c.valid_from <= as_of,
                (conflict_resolution_policy_version_table.c.valid_to.is_(None))
                | (conflict_resolution_policy_version_table.c.valid_to > as_of),
            )
            # По инварианту версионирования подходящая версия ровно одна;
            # сортировка — на случай, если данные всё же разъехались:
            # взять более новую предсказуемее, чем произвольную.
            .order_by(conflict_resolution_policy_version_table.c.version_no.desc())
            .limit(1)
        )
    ).one_or_none()

    if row is None:
        raise ConflictPolicyNotApplicable(
            f"на {as_of} не найдено действующей версии политики {policy_code!r}: "
            f"без порядка приоритетов час, одновременно ночной и праздничный, "
            f"отнести не к чему (Алгоритм Ж шаг 3)"
        )

    return EffectiveConflictPolicy(
        policy_version_id=row.id,
        policy_code=row.code,
        version_no=row.version_no,
        valid_from=row.valid_from,
        valid_to=row.valid_to,
        precedence_list=list(row.precedence_list),
    )
