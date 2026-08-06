"""Обработчик `RecordEmployeeElectionCommand` (CO008).

Волеизъявление — юридический факт: рапорт сотрудника о выборе между
повышенной оплатой и дополнительным временем отдыха (ТК РФ ст. 152/153,
ФЗ-141 ст. 55). Обработчик его только записывает; решать, допустим ли
выбор по этой категории, — дело агрегата (инвариант 7.1.3), потому что
признак живёт на строке, а не в оркестрации.

DoD задачи: «выбор формы после финализации дела отклоняется». Это тоже
инвариант агрегата (7.1.4), и второй проверки здесь нет намеренно: два
места, где написано одно и то же, однажды разойдутся, и разойдутся молча.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.compensation.application.commands.record_employee_election.command import (
    RecordEmployeeElectionCommand,
)
from src.modules.compensation.application.ports import CompensationCaseRepositoryPort
from src.modules.compensation.domain.compensation_case import CompensationLine
from src.modules.compensation.domain.errors import CaseNotFoundError
from src.modules.compensation.domain.value_objects import EmployeeElection


class RecordEmployeeElectionHandler:
    def __init__(self, session: AsyncSession, repo: CompensationCaseRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: RecordEmployeeElectionCommand) -> CompensationLine:
        case = await self._repo.get(command.case_id)
        if case is None:
            raise CaseNotFoundError(str(command.case_id))

        line = case.record_election(
            hour_category=command.hour_category,
            election=EmployeeElection(form=command.form, elected_at=command.elected_at),
        )
        await self._session.commit()
        return line
