"""Handler for `GetUnitQuery`."""

from __future__ import annotations

from src.modules.personnel.application.ports import UnitRepositoryPort
from src.modules.personnel.application.queries.get_unit.query import GetUnitQuery
from src.modules.personnel.domain.errors import UnitNotFoundError
from src.modules.personnel.domain.unit import Unit


class GetUnitHandler:
    def __init__(self, repo: UnitRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, query: GetUnitQuery) -> Unit:
        unit = await self._repo.get(query.unit_id)
        if unit is None:
            raise UnitNotFoundError(str(query.unit_id))
        return unit
