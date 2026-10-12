"""Боевое развёртывание: настройка запуска и состав docker.

--- Почему это тесты, а не «посмотреть глазами при выкладке» ----------------

Всё, что проверяется ниже, ломается молча и обнаруживается в худший момент.
Порт базы, случайно выставленный наружу; забытая строка `logging` у новой
службы, из-за которой журнал растёт, пока не кончится диск; опечатка в имени
класса воркера, которая валит старт уже в бою; `GRAFIK_TRUSTED_PROXIES` и
шлюз сети, разъехавшиеся после правки подсети, — и в журнале вместо адреса
человека адрес шлюза.

Файлы из `deploy/` проверяются отсюда, а не из своего набора, по простой
причине: кроме pytest в репозитории нет ничего, что умело бы их прочитать.
Фронт проверяется vitest'ом и про сервер не знает.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import yaml

from grafik_api.core.config import Settings, get_settings

КОРЕНЬ = Path(__file__).resolve().parents[2]
ВЫКЛАДКА = КОРЕНЬ / "deploy"
СОСТАВ = ВЫКЛАДКА / "compose.prod.yml"
НАСТРОЙКА_GUNICORN = КОРЕНЬ / "api" / "gunicorn.conf.py"

#: Подсеть и шлюз боевой сети. Задана в составе, упомянута в настройках
#: приложения и в правилах экрана — три места должны совпадать.
ШЛЮЗ = "172.28.0.1"
ПОДСЕТЬ = "172.28.0.0/24"


def прочитать_yaml(путь: Path) -> dict[str, Any]:
    """Разобрать файл; подстановки вида `${VAR}` остаются строками."""
    данные: dict[str, Any] = yaml.safe_load(путь.read_text(encoding="utf-8"))
    return данные


@pytest.fixture
def состав() -> dict[str, Any]:
    return прочитать_yaml(СОСТАВ)


def загрузить_настройку_gunicorn() -> ModuleType:
    """Загрузить `gunicorn.conf.py` как модуль.

    Через `importlib`, потому что точка в имени файла делает его
    неимпортируемым обычным `import`. Ровно так его читает и сам gunicorn
    — как обычный Python-файл.
    """
    spec = importlib.util.spec_from_file_location(
        "gunicorn_conf_под_тестом", НАСТРОЙКА_GUNICORN
    )
    assert spec is not None and spec.loader is not None
    модуль = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(модуль)
    return модуль


# --- Настройка gunicorn ----------------------------------------------------


def test_настройка_gunicorn_читается() -> None:
    настройка = загрузить_настройку_gunicorn()

    assert настройка.wsgi_app == "grafik_api.main:app"
    assert настройка.bind.endswith(":8000")
    assert настройка.workers == get_settings().workers
    assert настройка.preload_app is True


def test_класс_воркера_существует() -> None:
    """Опечатка в этой строке валит старт — но только в бою.

    Поэтому строка не сверяется с эталоном, а проверяется по назначению:
    модуль ввозится, класс в нём есть.
    """
    настройка = загрузить_настройку_gunicorn()
    путь, _, имя = настройка.worker_class.rpartition(".")

    модуль = importlib.import_module(путь)

    assert hasattr(модуль, имя)
    # Из uvicorn этот класс вынесли в отдельный пакет; старое имя из
    # большинства инструкций в сети больше не существует.
    assert настройка.worker_class == "uvicorn_worker.UvicornWorker"


def test_мягкая_остановка_не_короче_предела_запроса() -> None:
    """Иначе остановка обрывает запросы, которым по сроку ещё можно отвечать."""
    настройка = загрузить_настройку_gunicorn()

    assert настройка.graceful_timeout >= настройка.timeout


def test_свой_журнал_доступа_а_не_gunicorn() -> None:
    """Строку про запрос пишем мы — с `request_id` и без адреса."""
    настройка = загрузить_настройку_gunicorn()

    assert настройка.accesslog is None
    assert настройка.errorlog == "-"
    assert настройка.capture_output is False


def test_журнал_gunicorn_не_двоится_и_не_пропадает() -> None:
    """Обработчик указан явно, распространение выключено.

    Почему именно так — в `core/logging.py`: пустой список обработчиков
    отправил бы записи uvicorn в никуда (рабочий процесс копирует
    обработчики `gunicorn.error` себе), а отсутствие записи вообще дало бы
    каждую строку дважды.
    """
    настройка = загрузить_настройку_gunicorn()
    логгеры = настройка.logconfig_dict["loggers"]

    for имя in ("gunicorn.error", "gunicorn.access"):
        assert логгеры[имя]["handlers"] == ["stdout"]
        assert логгеры[имя]["propagate"] is False

    assert настройка.logconfig_dict["handlers"]["stdout"]["formatter"] == "json"


def test_управляющий_сокет_выключен() -> None:
    """В контейнере его негде создать, а предупреждение на старте пугает.

    С версии 25.1 gunicorn открывает unix-сокет для `gunicornc` — по
    умолчанию в домашнем каталоге, которого у пользователя контейнера нет,
    на файловой системе, смонтированной только для чтения. Управляем мы
    не им, поэтому он выключен; проверка стоит, чтобы он не вернулся
    молча вместе с обновлением настроек.
    """
    настройка = загрузить_настройку_gunicorn()

    assert настройка.control_socket_disable is True


def test_при_одном_процессе_рабочих_не_перезапускаем() -> None:
    """Перезапуск единственного рабочего — это 502 на ровном месте."""
    настройка = загрузить_настройку_gunicorn()

    assert настройка.workers == 1
    assert настройка.max_requests == 0


def test_при_нескольких_процессах_перезапуск_включается(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Зато когда их несколько, смена одного незаметна — и утечки лечатся."""
    monkeypatch.setenv("GRAFIK_WORKERS", "3")
    get_settings.cache_clear()
    try:
        настройка = загрузить_настройку_gunicorn()

        assert настройка.workers == 3
        assert настройка.max_requests > 0
        assert настройка.max_requests_jitter > 0
    finally:
        # Кэш настроек общий на процесс: оставить в нём три рабочих значило
        # бы сломать соседние тесты.
        get_settings.cache_clear()


# --- Боевой состав ---------------------------------------------------------


def test_у_базы_нет_порта_наружу(состав: dict[str, Any]) -> None:
    """С базой говорит только приложение по внутренней сети."""
    assert "ports" not in состав["services"]["postgres"]


def test_приложение_слушает_только_петлю(состав: dict[str, Any]) -> None:
    """Иначе API окажется доступен без TLS и без защитных заголовков."""
    порты = состав["services"]["api"]["ports"]

    assert порты == ["127.0.0.1:8001:8000"]


def test_у_каждой_службы_ограничен_журнал(состав: dict[str, Any]) -> None:
    """Без ограничения json-file растёт, пока не кончится диск."""
    for имя, служба in состав["services"].items():
        правило = служба.get("logging")

        assert правило is not None, f"у службы {имя} нет правила журнала"
        assert правило["driver"] == "json-file"
        assert правило["options"]["max-size"]
        assert правило["options"]["max-file"]


def test_контейнеры_без_лишних_прав(состав: dict[str, Any]) -> None:
    for имя, служба in состав["services"].items():
        assert "no-new-privileges:true" in служба["security_opt"], имя

    for имя in ("api", "migrate", "gc"):
        служба = состав["services"][имя]
        # Приложение не пишет на диск ничего: журнал в stdout, данные в
        # базе. Файловая система только для чтения снимает целый класс
        # последствий.
        assert служба["read_only"] is True, имя
        assert служба["cap_drop"] == ["ALL"], имя


def test_образы_прибиты_к_версиям(состав: dict[str, Any]) -> None:
    """`latest` в бою означает «что приехало, то и работает»."""
    for имя, служба in состав["services"].items():
        образ = служба["image"]

        assert ":" in образ, имя
        assert not образ.endswith(":latest"), имя

    # Тег приложения приходит из .env и обязателен: подстановка с `:?`
    # роняет compose, если тега нет, вместо того чтобы поднять вчерашний
    # образ молча.
    assert состав["services"]["api"]["image"].startswith("grafik-api:${")
    assert ":?" in состав["services"]["api"]["image"]


def test_одноразовые_службы_не_поднимаются_сами(состав: dict[str, Any]) -> None:
    for имя in ("migrate", "gc"):
        assert состав["services"][имя]["profiles"] == ["tools"], имя
        assert состав["services"][имя]["restart"] == "no", имя


def test_сборка_мусора_запускает_нашу_команду(состав: dict[str, Any]) -> None:
    """Команда одна и та же в составе, в таймере и в приложении."""
    assert состав["services"]["gc"]["command"] == [
        "python",
        "-m",
        "grafik_api.cli",
        "gc",
    ]
    assert состав["services"]["migrate"]["command"] == ["alembic", "upgrade", "head"]


def test_подсеть_задана_явно(состав: dict[str, Any]) -> None:
    """От адреса шлюза зависит доверие к `X-Forwarded-For`."""
    сеть = состав["networks"]["grafik"]["ipam"]["config"][0]

    assert сеть["subnet"] == ПОДСЕТЬ
    assert сеть["gateway"] == ШЛЮЗ


# --- Согласованность файлов выкладки ---------------------------------------


def test_образец_окружения_перечисляет_все_настройки() -> None:
    """Добавили настройку — допишите в образец, иначе о ней никто не узнает.

    Проверка грубая намеренно: имя переменной в тексте. Так она ловит
    главное — забытую настройку, — и не мешает писать в образце пояснения.
    """
    образец = (ВЫКЛАДКА / "env.prod.example").read_text(encoding="utf-8")

    пропущены = [
        f"GRAFIK_{имя.upper()}"
        for имя in Settings.model_fields
        if f"GRAFIK_{имя.upper()}" not in образец
    ]

    assert пропущены == []


def test_доверенный_прокси_совпадает_со_шлюзом() -> None:
    """Разъедутся — и в журнале окажется адрес шлюза, один для всех."""
    образец = (ВЫКЛАДКА / "env.prod.example").read_text(encoding="utf-8")

    assert f"GRAFIK_TRUSTED_PROXIES={ШЛЮЗ}" in образец


def test_в_правилах_экрана_нет_общего_сброса() -> None:
    """`flush ruleset` снёс бы правила docker, и порты молча отвалились бы."""
    весь_файл = (ВЫКЛАДКА / "nftables.conf").read_text(encoding="utf-8")
    # Без комментариев: про `flush ruleset` в файле написано целым
    # абзацем — почему его там и не должно быть.
    правила = "\n".join(
        строка
        for строка in весь_файл.splitlines()
        if not строка.lstrip().startswith("#")
    )

    assert "flush ruleset" not in правила
    # Таблица своя — её и сбрасываем перед объявлением.
    assert "delete table inet grafik" in правила
    # Почта из контейнера: подсеть та же, что в составе.
    assert ПОДСЕТЬ in правила


def test_юниты_ссылаются_на_существующие_скрипты() -> None:
    """Переименовали скрипт — таймер перестал работать, и никто не заметил."""
    for юнит in sorted((ВЫКЛАДКА / "systemd").glob("*.service")):
        текст = юнит.read_text(encoding="utf-8")

        for путь in re.findall(r"^ExecStart=(/opt/grafik13/\S+)", текст, re.M):
            файл = ВЫКЛАДКА / Path(путь).name

            assert файл.exists(), f"{юнит.name} зовёт {путь}, которого нет"
            assert файл.stat().st_mode & 0o111, f"{файл.name} не исполняемый"


def test_у_задач_есть_обработчик_неудачи() -> None:
    """Молча падающая копия — главная причина, по которой копий не оказывается."""
    for имя in ("grafik-gc", "grafik-backup", "grafik-backup-verify"):
        текст = (ВЫКЛАДКА / "systemd" / f"{имя}.service").read_text(encoding="utf-8")

        assert "OnFailure=grafik-notify-failure@%n.service" in текст

    assert (ВЫКЛАДКА / "systemd" / "grafik-notify-failure@.service").exists()


def test_пропущенный_запуск_не_теряется() -> None:
    """Сервер был выключен в три ночи — срок хранения от этого не меняется."""
    for таймер in sorted((ВЫКЛАДКА / "systemd").glob("*.timer")):
        текст = таймер.read_text(encoding="utf-8")

        assert "Persistent=true" in текст, таймер.name
        assert "OnCalendar=" in текст, таймер.name


def test_выкладка_берёт_тот_образ_который_собрала_сборка() -> None:
    """Имя артефакта — единственная связь между двумя workflow'ами."""
    сборка = прочитать_yaml(КОРЕНЬ / ".github" / "workflows" / "api.yml")
    выкладка = прочитать_yaml(КОРЕНЬ / ".github" / "workflows" / "api-cd.yml")

    отданные = {
        шаг["with"]["name"]
        for шаг in сборка["jobs"]["image"]["steps"]
        if "upload-artifact" in шаг.get("uses", "")
    }
    взятые = {
        шаг["with"]["name"]
        for шаг in выкладка["jobs"]["deploy"]["steps"]
        if "download-artifact" in шаг.get("uses", "")
    }

    assert взятые == отданные == {"api-image"}
