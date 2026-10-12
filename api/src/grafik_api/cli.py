"""Команды, которые запускает расписание, а не человек по HTTP.

Пока одна: сборка мусора. Срок хранения — обязанность оператора, а не
пожелание: надгробия удалённых записей живут 180 дней, история версий — 30
(раздел 8 контракта и `docs/legal/data-map.md`), и «удалено» должно
означать «не лежит», иначе обещание политики не исполняется.

--- Почему отдельная команда, а не задача внутри приложения ----------------

Планировщик внутри веб-процесса — старая ловушка: при нескольких рабочих
процессах задача выполняется столько раз, сколько процессов; при
перезапуске контейнера пропускает срок молча; а её ошибку видно только в
журнале, и то если смотреть. Отдельный процесс с кодом возврата умеет то,
чего внутренний планировщик не умеет: о неудаче узнаёт systemd (а значит и
тот, кто читает `systemctl status`), повторный запуск не наслаивается на
предыдущий, а само расписание видно снаружи приложения — в таймере
(`deploy/systemd/grafik-gc.timer`).

Запуск: `python -m grafik_api.cli gc`. Внутри контейнера это делает
`docker compose run --rm gc`, снаружи — таймер systemd.
"""

from __future__ import annotations

import argparse
import asyncio

from grafik_api.core.config import Settings, get_settings
from grafik_api.core.logging import configure_logging, get_logger
from grafik_api.db import create_engine, create_sessionmaker
from grafik_api.services.sync import GcReport, SyncService

logger = get_logger("cli")


async def collect_garbage(settings: Settings) -> GcReport:
    """Убрать просроченное и зафиксировать.

    Фиксация здесь, а не в сервисе: сервис одинаково годится и для запроса,
    и для расписания, а решение «фиксировать» принимает тот, кто знает
    границу работы. У запроса эта граница — зависимость `get_session`, у
    команды — вот эта функция.
    """
    engine = create_engine(settings)

    try:
        sessionmaker = create_sessionmaker(engine)
        async with sessionmaker() as session:
            отчёт = await SyncService(session, settings).collect_garbage()
            await session.commit()
            return отчёт
    finally:
        # Закрыть обязательно: без этого соединения висят на стороне базы
        # до её собственного таймаута, а команда запускается по расписанию
        # — то есть регулярно.
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    """Разобрать команду и выполнить её.

    Код возврата — не формальность: по нему systemd отличает «сработало»
    от «не сработало», и только поэтому о сломанной сборке мусора можно
    узнать, не читая журналов.
    """
    parser = argparse.ArgumentParser(
        prog="python -m grafik_api.cli",
        description="Служебные команды сервера синхронизации",
    )
    parser.add_argument(
        "команда",
        choices=["gc"],
        help="gc — убрать просроченные надгробия и версии",
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.env, settings.log_level)

    try:
        отчёт = asyncio.run(collect_garbage(settings))
    except Exception:
        # `exception`, а не `error`: без следа вызовов разбирать сбой
        # базы по одной строке невозможно.
        logger.exception("команда не выполнена", extra={"event": f"cli.{args.команда}"})
        return 1

    logger.info(
        "команда выполнена",
        extra={
            "event": f"cli.{args.команда}",
            "accounts": отчёт.accounts,
            "tombstones": отчёт.tombstones,
            "revisions": отчёт.revisions,
        },
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - проверяется запуском, не тестом
    raise SystemExit(main())
