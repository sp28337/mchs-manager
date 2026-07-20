"""VersionResolver — Calculation_Engine_Algorithms_FPS.md, принцип 0.2:
"Правило берётся на дату события, а не на дату расчёта". Resolves
(rule_code, scope, as_of) to the single applicable `legal_rules.rule_version`
row.

Talks to the DB only via raw SQL against the already-migrated schema (see
migrations 0002-0004) — never imports `src.modules.legal_rules` Python
code. `rule_engine` is a cross-cutting package usable BY every module but
must depend on none (Backend_Architecture разд. 1; enforced by
`.importlinter` contract `rule_engine has zero dependency on any module`).
Once `legal_rules.infrastructure` exists (LR004+) it will call this
function with its own `AsyncConnection`, not the other way around.

KNOWN SCHEMA GAP, resolved here explicitly rather than left implicit:
`openapi.yaml` `CreateRuleVersionRequest` has `formulaDefinition` and
`actions` as two separate required fields, but
`PostgreSQL_Logical_Model_FPS.md` разд. 1.5 only defines a single
`formula_definition jsonb` column on `rule_version` — there is no
`actions` column. Resolution adopted here: the persisted JSON in
`formula_definition` IS the `actions` array (`list[Action]`, RE005), i.e.
`formula_definition = [{"node_type": "set_result", "field": ..., "formula": ...}, ...]`.
This keeps the DB migrations unchanged and matches openapi's
`minItems: 1` list semantics; a bare single-Formula value (no `actions`
wrapper) is not supported by this resolver. If the schema is revisited,
the fix is confined to this module's `_parse_actions`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from src.rule_engine.schemas.action import Action

_actions_adapter: TypeAdapter[list[Action]] = TypeAdapter(list[Action])


@dataclass(frozen=True, kw_only=True)
class ResolvedRuleVersion:
    """What a caller needs to evaluate a rule — deliberately NOT the raw
    DB row or an ORM object (rule_engine has no ORM mapping; that belongs
    to `legal_rules.infrastructure` once LR004 lands)."""

    id: UUID
    rule_id: UUID
    version_no: int
    valid_from: date
    valid_to: date | None
    actions: list[Action]


class NoApplicableRuleVersionError(LookupError):
    """No published/superseded rule_version covers (rule_code, scope, as_of).

    Maps to 404 at the API boundary (API_Conventions разд. 3:
    `.../errors/rule-version-not-found`) — deliberately never silently
    defaulted, since a missing rule is a legal/compliance gap, not an
    ordinary "not found"."""


async def resolve_effective_version(
    connection: AsyncConnection,
    *,
    rule_code: str,
    scope: dict[str, str],
    as_of: date,
) -> ResolvedRuleVersion:
    """Finds the rule_version active for (rule_code, scope) on `as_of`.

    Both `published` AND `superseded` versions participate (`WHERE status
    <> 'draft'`, mirroring the DB's own EXCLUDE constraint,
    PostgreSQL_Logical_Model разд. 1.5) — a `superseded` version is exactly
    the one applicable to a past date once a newer version has since been
    published; excluding it would make retroactive recalculation
    (Calculation Engine, Алгоритм М) impossible.

    Comparison is by jsonb value equality (`scope = :scope::jsonb`), not by
    reproducing the `scope_key` generated column's exact text form in
    Python — Postgres's own `jsonb::text` canonicalization (key order,
    whitespace) is not something client code should have to replicate.
    """
    result = await connection.execute(
        text("""
            SELECT rv.id, rv.rule_id, rv.version_no, rv.valid_from,
                   rv.valid_to, rv.formula_definition
            FROM legal_rules.rule_version rv
            JOIN legal_rules.rule r ON r.id = rv.rule_id
            WHERE r.code = :rule_code
              AND rv.scope = CAST(:scope AS jsonb)
              AND rv.status <> 'draft'
              AND rv.valid_from <= :as_of
              AND (rv.valid_to IS NULL OR rv.valid_to > :as_of)
        """),
        {"rule_code": rule_code, "scope": json.dumps(scope), "as_of": as_of},
    )
    rows = result.mappings().all()

    if not rows:
        raise NoApplicableRuleVersionError(
            f"No published rule_version for rule_code={rule_code!r} scope={scope!r} as_of={as_of}"
        )
    if len(rows) > 1:
        # The EXCLUDE constraint (excl_rule_version_no_overlap) guarantees
        # this cannot legitimately happen — surfacing it as a hard
        # assertion rather than "take the first row" turns a silent
        # data-integrity bug into a loud one.
        raise AssertionError(
            f"EXCLUDE constraint invariant violated: {len(rows)} overlapping rule_versions "
            f"for rule_code={rule_code!r} scope={scope!r} as_of={as_of}"
        )

    row = rows[0]
    raw_formula_definition = row["formula_definition"]
    # asyncpg returns jsonb columns as already-decoded Python objects when
    # using the SQLAlchemy asyncpg dialect's default jsonb codec; guard
    # for the str case too so this also works against a plain-text SQL
    # driver in tests.
    actions_data = (
        json.loads(raw_formula_definition)
        if isinstance(raw_formula_definition, str)
        else raw_formula_definition
    )
    actions = _actions_adapter.validate_python(actions_data)

    return ResolvedRuleVersion(
        id=row["id"],
        rule_id=row["rule_id"],
        version_no=row["version_no"],
        valid_from=row["valid_from"],
        valid_to=row["valid_to"],
        actions=actions,
    )
