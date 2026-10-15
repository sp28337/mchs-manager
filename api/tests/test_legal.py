"""Манифест документов и сами документы должны совпадать.

Сервер хранит у согласия версию документа и отдаёт её вместе с хэшем
текста в `GET /legal/documents`; текст лежит в `docs/legal/*.md`.
Разойдись манифест с документами — и запись о согласии будет ссылаться на
редакцию, которой не существует, а хэш подтвердит не тот текст.

Манифест собирает `scripts/legal.mjs` (он же стоит проверкой в CI), а
здесь проверяется то, чего скрипт проверить не может: что сервер читает
собранное правильно и отдаёт наружу именно его.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest

from grafik_api.core.config import Settings
from grafik_api.core.legal import CURRENT_VERSIONS, LEGAL_DOCUMENTS
from grafik_api.main import create_app

ДОКУМЕНТЫ = Path(__file__).resolve().parents[2] / "docs" / "legal"

ФАЙЛЫ = {
    "policy": "privacy-policy.md",
    "consent": "consent.md",
    "terms": "terms.md",
    "cookies": "cookies.md",
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


def тело(путь: Path) -> str:
    """Текст документа без головного блока — то, что хэшируется."""
    текст = путь.read_text(encoding="utf-8")
    конец = текст.index("\n---\n", 3) + len("\n---\n")
    return текст[конец:].strip()


@pytest.mark.parametrize(("вид", "файл"), sorted(ФАЙЛЫ.items()))
def test_хэш_в_манифесте_от_того_же_текста(вид: str, файл: str) -> None:
    """Хэш — это подпись под текстом: правка текста обязана его менять."""
    посчитано = hashlib.sha256(тело(ДОКУМЕНТЫ / файл).encode("utf-8")).hexdigest()

    assert (
        посчитано == LEGAL_DOCUMENTS[вид].sha256
    ), f"{файл}: манифест устарел — пересоберите: node scripts/legal.mjs write"


@pytest.mark.parametrize(("вид", "файл"), sorted(ФАЙЛЫ.items()))
def test_манифест_повторяет_головной_блок(вид: str, файл: str) -> None:
    поля = головной_блок(ДОКУМЕНТЫ / файл)
    документ = LEGAL_DOCUMENTS[вид]

    assert документ.title == поля["title"]
    assert документ.url == поля["url"]
    assert документ.status == поля["status"]
    # `null` в головном блоке означает «не опубликован».
    ожидается = None if поля["effective_from"] == "null" else поля["effective_from"]
    assert документ.effective_from == ожидается


async def test_ручка_отдаёт_версии_и_хэши() -> None:
    """Открыта без опознания: политику оператор обязан публиковать для
    неограниченного доступа (ч. 2 ст. 18.1 152-ФЗ), а браузеру версии
    нужны до регистрации."""
    app = create_app(Settings(env="test"))
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="https://api") as клиент:
        ответ = await клиент.get("/api/v1/legal/documents")

    assert ответ.status_code == 200

    тело_ответа = ответ.json()
    assert set(тело_ответа) == {"policy", "consent", "terms", "cookies"}

    for вид, документ in тело_ответа.items():
        assert документ["version"] == CURRENT_VERSIONS[вид]
        assert документ["sha256"] == LEGAL_DOCUMENTS[вид].sha256
        assert документ["url"] == LEGAL_DOCUMENTS[вид].url
        # Пока документы не опубликованы, даты вступления в силу нет — и
        # врать о ней нельзя.
        assert документ["effective_from"] == LEGAL_DOCUMENTS[вид].effective_from


def test_опубликованный_документ_без_подстановок() -> None:
    """Публикация черновика с `{{ФИО_ОПЕРАТОРА}}` хуже отсутствия документа.

    Та же проверка стоит в `scripts/legal.mjs` и в CI; здесь она на случай,
    если документы опубликуют, не прогнав скрипт.
    """
    for вид, файл in sorted(ФАЙЛЫ.items()):
        if LEGAL_DOCUMENTS[вид].status != "published":
            continue

        assert "{{" not in тело(ДОКУМЕНТЫ / файл), f"{файл}: остались подстановки"
        assert LEGAL_DOCUMENTS[вид].effective_from is not None, f"{файл}: нет даты"
