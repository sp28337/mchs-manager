"""RFC 7807 `application/problem+json` — the single error envelope for the
whole API (API_Conventions_FPS.md разд. 3), and the helper that builds one.

Why this lives in `building_blocks` rather than in a module: it is a
cross-cutting concern in the literal sense the architecture uses the term
(Architecture разд. 10: "сквозные задачи... реализованы как единый
конвейер в BuildingBlocks/Application, применяемый одинаково ко всем
слайсам — не дублируется в каждом обработчике"). The alternative —
each module's `api/schemas.py` declaring its own `Problem` — would either
duplicate the shape N times or make one module import another module's
`api` package, which the boundary rule forbids outright (Architecture
разд. 4.2: only `Contracts/` crosses a module boundary, and an error
envelope is nobody's contract).

`building_blocks` still depends on no module (`.importlinter` contract 3);
the dependency runs the other way, as it must.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

ERRORS_BASE = "https://api.fps-timekeeping.gov.ru/errors"


class Problem(BaseModel):
    """Mirrors `openapi.yaml`'s `Problem` schema exactly."""

    model_config = ConfigDict(frozen=True, populate_by_name=True, serialize_by_alias=True)

    type: str
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None
    trace_id: str | None = Field(default=None, alias="traceId")


def problem_exception(status: int, error_type: str, title: str, detail: str) -> HTTPException:
    """Builds the `HTTPException` whose body is an RFC 7807 `Problem`.

    Every Problem carries a `traceId` so a rejected request can be
    correlated with `audit.audit_log` later (API_Conventions разд. 3:
    "без него невозможно связать отклонённый запрос с записью аудита").
    The audit table and its writer do not exist yet, so today this is a
    bare UUID with nothing to join against — flagged, not silently
    omitted.
    """
    problem = Problem(
        type=f"{ERRORS_BASE}/{error_type}",
        title=title,
        status=status,
        detail=detail,
        trace_id=str(uuid4()),
    )
    return HTTPException(status_code=status, detail=problem.model_dump(mode="json", by_alias=True))
