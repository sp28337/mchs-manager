"""Handler for `CreateUnitCommand` (PE006) — orchestration only.

The one decision it makes is root-vs-child, and it makes it by looking at
whether a parent was named, then delegating to the matching `Unit` factory.
Deriving the child's `hierarchy_path` is `Unit.create_child`'s job, not
this handler's (Architecture разд. 6: "бизнес-инварианты не проверяются в
Handler — они уже инкапсулированы в методах агрегата").
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.personnel.application.commands.create_unit.command import CreateUnitCommand
from src.modules.personnel.application.ports import UnitRepositoryPort
from src.modules.personnel.domain.errors import UnitCodeAlreadyExistsError, UnitNotFoundError
from src.modules.personnel.domain.unit import DEFAULT_TIME_ZONE, Unit


class CreateUnitHandler:
    def __init__(self, session: AsyncSession, repo: UnitRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: CreateUnitCommand) -> Unit:
        # `uq_unit_code` would reject this too; checking first turns a raw
        # IntegrityError into the domain error the API maps to a 409 with
        # a usable message. The DB constraint remains the real guarantee
        # under concurrency — this is the friendly path, not the safe one.
        if await self._repo.get_by_code(command.code) is not None:
            raise UnitCodeAlreadyExistsError(command.code)

        if command.parent_unit_id is None:
            unit = Unit.create_root(
                code=command.code,
                name=command.name,
                time_zone=command.time_zone or DEFAULT_TIME_ZONE,
            )
        else:
            parent = await self._repo.get(command.parent_unit_id)
            if parent is None:
                raise UnitNotFoundError(str(command.parent_unit_id))
            unit = Unit.create_child(
                code=command.code,
                name=command.name,
                parent=parent,
                time_zone=command.time_zone,
            )

        self._repo.add(unit)
        # No UnitOfWork/Outbox yet (Architecture разд. 9.2 — not migrated,
        # see infrastructure/repositories.py) — the handler commits
        # directly as a temporary simplification, flagged rather than
        # hidden. Same shape as every `legal_rules` command handler.
        await self._session.commit()
        return unit
