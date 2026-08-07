"""Handler for `ListUnitsQuery`.

Возвращает ПЛОСКИЙ список, упорядоченный по `hierarchy_path`, а не
собранное дерево. Причина не в лени: дерево — форма представления, и
собирать его на сервере значит навязать клиенту одну-единственную
раскладку. Плоский список, отсортированный по ltree-пути, уже несёт всю
структуру (родитель всегда идёт раньше потомка, соседи стоят рядом), и
клиент собирает из него ту форму, которая нужна экрану, — за один проход
по массиву.
"""

from __future__ import annotations

from src.modules.personnel.application.ports import UnitRepositoryPort
from src.modules.personnel.application.queries.list_units.query import ListUnitsQuery
from src.modules.personnel.domain.errors import UnitNotFoundError
from src.modules.personnel.domain.unit import Unit


class ListUnitsHandler:
    def __init__(self, repo: UnitRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, query: ListUnitsQuery) -> list[Unit]:
        if query.root_unit_id is None:
            return await self._repo.list_all()

        # Пустой результат `list_subtree` двусмыслен: подразделения нет
        # либо оно есть и пусто (но тогда в списке был бы хотя бы сам
        # корень). Разрешаем двусмысленность явно, чтобы API отвечал 404
        # на несуществующий корень, а не пустым списком — иначе опечатка
        # в идентификаторе выглядит как «в части нет подразделений».
        subtree = await self._repo.list_subtree(query.root_unit_id)
        if not subtree:
            raise UnitNotFoundError(str(query.root_unit_id))
        return subtree
