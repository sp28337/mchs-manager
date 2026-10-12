"""Действующие редакции юридических документов.

Текст документов лежит в `docs/legal/*.md` и больше нигде: сайт собирает
страницы из тех же файлов. Сервер хранит у согласия **версию** — дату
редакции из головного блока, — и отдаёт её вместе с `sha256` текста в
`GET /legal/documents`. По этой паре потом видно, с чем именно человек
согласился: версия называет редакцию, хэш подтверждает, что текст в
архиве — тот самый.

--- Почему манифест, а не чтение файлов ------------------------------------

Сервер и тексты живут в разных образах: в образ API попадает только папка
`api/`, и `docs/` там нет. Манифест (`legal_manifest.json`) собирает
`scripts/legal.mjs` из тех же файлов и кладёт рядом с этим модулем; тест
`test_legal.py` сверяет манифест с документами, а проверка в CI не даёт
ему устареть. Считать хэш на ходу было бы нечем, а держать второй текст
рядом с кодом — значит однажды разойтись с первым.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Final

МАНИФЕСТ: Final = Path(__file__).with_name("legal_manifest.json")


@dataclass(frozen=True)
class LegalDocument:
    """Редакция одного документа — то, что о нём знает сервер."""

    id: str
    title: str
    version: str
    #: Дата вступления в силу или `None`, пока документ не опубликован.
    effective_from: str | None
    status: str
    url: str
    #: Хэш текста (тела документа, без головного блока).
    sha256: str


def _прочитать() -> dict[str, LegalDocument]:
    данные: dict[str, dict[str, str | None]] = json.loads(
        МАНИФЕСТ.read_text(encoding="utf-8")
    )

    return {
        опознание: LegalDocument(
            id=опознание,
            title=str(поля["title"]),
            version=str(поля["version"]),
            effective_from=поля["effective_from"],
            status=str(поля["status"]),
            url=str(поля["url"]),
            sha256=str(поля["sha256"]),
        )
        for опознание, поля in данные.items()
    }


#: Ключ — `id` документа: `policy`, `consent`, `terms`.
LEGAL_DOCUMENTS: Final[dict[str, LegalDocument]] = _прочитать()

#: Версии, которые принимаются в записи о согласии. Выводятся из манифеста:
#: второй перечень разошёлся бы с первым в первую же правку.
CURRENT_VERSIONS: Final[dict[str, str]] = {
    опознание: документ.version for опознание, документ in LEGAL_DOCUMENTS.items()
}
