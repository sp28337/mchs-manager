"""Команды, которые запускает расписание, а не человек по HTTP.

Пока одна: сборка мусора. Срок хранения — обязанность оператора, а не
пожелание: надгробия удалённых записей живут 180 дней, история версий — 30,
журнал событий безопасности — 180, хэши токенов — до своего срока,
брошенная регистрация без данных — 30 дней (раздел 8 контракта и
`docs/legal/data-map.md`). «Удалено» должно означать «не лежит», иначе
обещание политики не исполняется.

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
from grafik_api.services.retention import RetentionReport, RetentionService
from grafik_api.services.sync import GcReport, SyncService

logger = get_logger("cli")


async def collect_garbage(settings: Settings) -> tuple[GcReport, RetentionReport]:
    """Убрать просроченное и зафиксировать.

    Две службы, одна транзакция. `SyncService` отвечает за свои сроки
    (надгробия и история ревизий), `RetentionService` — за остальные
    (журнал событий, токены, брошенные регистрации). Складывать их в одну
    службу незачем: у каждой свой предмет, а общего у них только
    расписание.

    Фиксация здесь, а не в службах: служба одинаково годится и для
    запроса, и для расписания, а решение «фиксировать» принимает тот, кто
    знает границу работы. У запроса эта граница — зависимость
    `get_session`, у команды — вот эта функция.
    """
    engine = create_engine(settings)

    try:
        sessionmaker = create_sessionmaker(engine)
        async with sessionmaker() as session:
            мусор = await SyncService(session, settings).collect_garbage()
            сроки = await RetentionService(session, settings).collect()
            await session.commit()
            return мусор, сроки
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
        help="gc — исполнить сроки хранения (раздел 8 контракта)",
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.env, settings.log_level)

    try:
        мусор, сроки = asyncio.run(collect_garbage(settings))
    except Exception:
        # `exception`, а не `error`: без следа вызовов разбирать сбой
        # базы по одной строке невозможно.
        logger.exception("команда не выполнена", extra={"event": f"cli.{args.команда}"})
        return 1

    logger.info(
        "команда выполнена",
        extra={
            "event": f"cli.{args.команда}",
            "accounts": мусор.accounts,
            "tombstones": мусор.tombstones,
            "revisions": мусор.revisions,
            "audit": сроки.audit,
            "sessions": сроки.sessions,
            "links": сроки.links,
            "drafts": сроки.drafts,
        },
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - проверяется запуском, не тестом
    raise SystemExit(main())
