"""Обработчик `CreateCorrectionEntryCommand` (TA014).

DoD: «исходная запись не изменяется, создаётся новая correction_entry».
Обработчику для этого ничего делать не нужно — и это главное, что о нём
стоит сказать: `Timesheet.correct()` только добавляет запись, а
`trg_correction_entry_append_only` (миграция 0015) не даст переписать и
её саму. Возможности «исправить на месте» нет ни в домене, ни в схеме,
поэтому её нельзя случайно получить и здесь.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.time_accounting.application.commands.create_correction_entry.command import (
    CreateCorrectionEntryCommand,
)
from src.modules.time_accounting.application.ports import TimesheetRepositoryPort
from src.modules.time_accounting.domain.errors import TimesheetNotFoundError
from src.modules.time_accounting.domain.timesheet import CorrectionEntry


class CreateCorrectionEntryHandler:
    def __init__(self, session: AsyncSession, repo: TimesheetRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: CreateCorrectionEntryCommand) -> CorrectionEntry:
        timesheet = await self._repo.get(command.timesheet_id)
        if timesheet is None:
            raise TimesheetNotFoundError(str(command.timesheet_id))

        entry = timesheet.correct(
            original_event_id=command.original_event_id,
            reason=command.reason,
            created_by=command.created_by,
        )
        await self._session.commit()
        return entry
