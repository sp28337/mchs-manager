"""Версии документов в коде и в самих документах должны совпадать.

Сервер хранит у согласия версию документа, а текст лежит в
`docs/legal/*.md`. Разойдись они — и запись о согласии будет ссылаться на
редакцию, которой не существует. Проверяется это здесь, потому что
автоматической связи между ними пока нет: манифест с версиями и хэшами
появится на шаге 12.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from grafik_api.core.legal import CURRENT_VERSIONS

ДОКУМЕНТЫ = Path(__file__).resolve().parents[2] / "docs" / "legal"

ФАЙЛЫ = {
    "policy": "privacy-policy.md",
    "consent": "consent.md",
    "terms": "terms.md",
}


def головной_блок(путь: Path) -> dict[str, str]:
    """Разобрать блок между строками `---` в начале файла.

    Своими руками, а не через YAML: нужны две строки, а зависимость ради
    этого тянуть незачем.
    """
    строки = путь.read_text(encoding="utf-8").splitlines()
    assert строки[0] == "---", f"{путь.name}: нет головного блока"

    поля: dict[str, str] = {}
    for строка in строки[1:]:
        if строка == "---":
            break
        ключ, _, значение = строка.partition(":")
        поля[ключ.strip()] = значение.strip().strip('"')

    return поля


def test_перечень_документов_полон() -> None:
    assert set(CURRENT_VERSIONS) == set(ФАЙЛЫ)


@pytest.mark.parametrize(("вид", "файл"), sorted(ФАЙЛЫ.items()))
def test_версия_в_коде_совпадает_с_документом(вид: str, файл: str) -> None:
    поля = головной_блок(ДОКУМЕНТЫ / файл)

    assert поля["id"] == вид
    assert поля["version"] == CURRENT_VERSIONS[вид], (
        f"{файл}: в документе {поля['version']}, "
        f"в core/legal.py {CURRENT_VERSIONS[вид]}"
    )
