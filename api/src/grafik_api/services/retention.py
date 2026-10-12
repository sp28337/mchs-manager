"""Сроки хранения: то, что обещано в документах, должно исполняться кодом.

Сроки перечислены в трёх местах — в разделе 8 технического контракта, в
карте данных и в политике, которую человек читает. До шага 14 из этого
перечня исполнялись два срока: надгробия (180 дней) и история ревизий
(30 дней) — их убирает `SyncService.collect_garbage`. Остальные
существовали только обещанием:

* журнал событий безопасности — 180 дней;
* хэши refresh-токенов — 30 дней или до выхода;
* хэши одноразовых ссылок — 24 часа;
* брошенная регистрация без данных — 30 дней.

Расхождение нашлось при составлении внутренних документов
(`docs/legal/internal/`): перечень сроков пришлось сверять со кодом строка
за строкой, и оказалось, что четыре строки обещаны, а не сделаны. Политика,
обещающая срок, которого нет, — это не формальность: именно за такое
расхождение и спрашивают, а главное — данные лежат дольше, чем человеку
сказали.

--- Почему отдельная служба, а не метод в `SyncService` --------------------

`collect_garbage` у синхронизации — про элементы: надгробия и ревизии, то
есть про свой предмет. Токены, журнал событий и брошенные регистрации к
синхронизации отношения не имеют, и складывать их в тот же метод значило бы
получить службу «всё остальное».

Обе службы вызывает команда `python -m grafik_api.cli gc` — она и есть
граница транзакции, как ручка для запроса. Так у каждой службы остаётся свой
предмет, а у расписания — одна команда.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.config import Settings
from grafik_api.core.logging import get_logger
from grafik_api.repositories import (
    AuditRepository,
    OneTimeTokenRepository,
    RefreshTokenRepository,
    UserRepository,
)

logger = get_logger("service.retention")

#: Журнал событий безопасности. 180 дней — столько же, сколько надгробия:
#: срок обещан в политике и в контракте, раздел 8.
AUDIT_DAYS = 180

#: Брошенная регистрация: адрес не подтверждён и данных нет.
DRAFT_DAYS = 30


@dataclass(frozen=True)
class RetentionReport:
    """Сколько строк убрано по каждому сроку."""

    audit: int
    sessions: int
    links: int
    drafts: int

    @property
    def total(self) -> int:
        return self.audit + self.sessions + self.links + self.drafts


class RetentionService:
    """Исполнение сроков хранения, кроме сроков синхронизации."""

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.audit = AuditRepository(session)
        self.refresh = RefreshTokenRepository(session)
        self.links = OneTimeTokenRepository(session)
        self.users = UserRepository(session)

    async def collect(self, *, now: datetime | None = None) -> RetentionReport:
        """Убрать всё, чему вышел срок.

        Фиксация — за вызывающим: у задачи по расписанию и у запроса это
        разные решения, и служба их не принимает (так же устроен
        `SyncService.collect_garbage`).

        Протухшие токены удаляются по их собственному сроку, а не по
        календарному: срок refresh-токена настраивается
        (`GRAFIK_REFRESH_TTL_DAYS`), и считать его здесь второй раз значило
        бы иметь два источника правды.
        """
        now = now or datetime.now(UTC)

        журнал = await self.audit.purge_older_than(now - timedelta(days=AUDIT_DAYS))
        сессии = await self.refresh.purge_expired(now)
        ссылки = await self.links.purge_expired(now)
        брошенные = await self.users.purge_unverified(now - timedelta(days=DRAFT_DAYS))

        # Сброс, а не фиксация: результат должен быть виден вызывающему в
        # его же запросах сразу, но решение «записать» принимает он.
        await self.session.flush()

        отчёт = RetentionReport(
            audit=журнал, sessions=сессии, links=ссылки, drafts=брошенные
        )

        logger.info(
            "сроки хранения исполнены",
            extra={
                "event": "retention.collect",
                "audit": отчёт.audit,
                "sessions": отчёт.sessions,
                "links": отчёт.links,
                "drafts": отчёт.drafts,
            },
        )

        return отчёт
