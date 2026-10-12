"""Команда сборки мусора — та, которую запускает расписание.

Проверяется не столько сама уборка (её правила проверены в `test_sync.py`),
сколько поведение команды как процесса: своё соединение с базой, фиксация,
код возврата и строка в журнале. Именно по коду возврата systemd отличает
«сработало» от «не сработало», и только поэтому о сломанной уборке можно
узнать, не читая журналов.

--- Почему журнал читается из stdout, а не из `caplog` ---------------------

`main()` настраивает журналирование сам — он точка входа процесса, и это
его работа. `dictConfig` при этом заменяет обработчики у корневого
логгера, в том числе тот, которым перехватывает записи pytest. Поэтому
записи здесь берутся оттуда, где их увидит systemd: из stdout, по строке
JSON. Заодно это проверка формата — того самого, на который рассчитан
сборщик журналов.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator

import pytest

from grafik_api import cli
from grafik_api.core.config import Settings, get_settings


def последняя_запись(вывод: str) -> dict[str, object]:
    """Разобрать последнюю строку журнала как JSON."""
    строки = [строка for строка in вывод.splitlines() if строка.startswith("{")]

    assert строки, f"в выводе нет ни одной записи журнала: {вывод!r}"

    разобрано: dict[str, object] = json.loads(строки[-1])
    return разобрано


@pytest.fixture
def своё_окружение(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Настройки из переменных окружения — и уборка за командой.

    `main()` читает настройки сам, поэтому подменяется окружение, а не
    аргумент. Убирать за ним нужно двоякое: кэш настроек (он общий на
    процесс — иначе соседние тесты получат чужую базу) и обработчики
    журнала (команда настраивает их процессу, а поток, в который они
    пишут, живёт только до конца теста).
    """
    обработчики = logging.getLogger().handlers[:]
    monkeypatch.setenv("GRAFIK_ENV", "test")
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()
        logging.getLogger().handlers[:] = обработчики


async def test_уборка_на_пустой_базе_ничего_не_находит(схема: str) -> None:
    """Пустая база — не повод для ошибки: уборке просто нечего делать."""
    мусор, сроки = await cli.collect_garbage(Settings(env="test", database_url=схема))

    assert (мусор.accounts, мусор.tombstones, мусор.revisions) == (0, 0, 0)
    assert сроки.total == 0


def test_команда_сообщает_об_успехе(
    схема: str,
    своё_окружение: None,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("GRAFIK_DATABASE_URL", схема)
    get_settings.cache_clear()

    код = cli.main(["gc"])

    assert код == 0

    запись = последняя_запись(capsys.readouterr().out)
    assert запись["event"] == "cli.gc"
    assert запись["level"] == "INFO"
    # Числа в записи — то, по чему в журнале видно, что уборка работает, а
    # не просто завершается.
    assert запись["revisions"] == 0
    assert запись["tombstones"] == 0
    # Сроки, которые исполняет вторая служба, — в той же записи: по одной
    # строке журнала должно быть видно всё, что убрала задача.
    assert запись["audit"] == 0
    assert запись["sessions"] == 0
    assert запись["links"] == 0
    assert запись["drafts"] == 0


def test_недоступная_база_это_код_один(
    своё_окружение: None,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Иначе таймер молча отчитается об успехе, не сделав ничего.

    Адрес заведомо мёртвый: первый порт, на котором ничего не слушает.
    """
    monkeypatch.setenv(
        "GRAFIK_DATABASE_URL", "postgresql+psycopg://grafik@127.0.0.1:1/grafik"
    )
    get_settings.cache_clear()

    код = cli.main(["gc"])

    assert код == 1

    запись = последняя_запись(capsys.readouterr().out)
    assert запись["level"] == "ERROR"
    assert запись["event"] == "cli.gc"
    # Со следом вызовов: без него сбой базы разбирать по одной строке
    # невозможно.
    assert "Connection refused" in str(запись["exception"])


def test_неизвестная_команда_не_запускается(своё_окружение: None) -> None:
    """argparse отвечает кодом 2 — так принято у разбора аргументов."""
    with pytest.raises(SystemExit) as отказ:
        cli.main(["почистить-всё"])

    assert отказ.value.code == 2
