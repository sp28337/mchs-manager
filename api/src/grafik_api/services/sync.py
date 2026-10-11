"""Синхронизация: выборка изменений и отправка правок.

--- Чего сервер не делает --------------------------------------------------

**Не сливает.** Он не видит содержимого — ключа у него нет, — поэтому
слияние делает браузер трёхсторонней сверкой `base ↔ local ↔ remote`
(раздел 5 контракта). Сервер лишь сообщает о расхождении и отдаёт нынешнее
состояние.

**Не отвергает всю отправку из-за одного расхождения.** Конфликт — не
ошибка запроса: в ответе приходят и принятые элементы, и конфликтные.
Иначе клиент, у которого разошёлся один профиль из десяти, не смог бы
отправить остальные девять.

--- Как устроены ревизии ---------------------------------------------------

Одна последовательность на аккаунт, а не на элемент (раздел 4 контракта):
так курсор выборки — одно число, и «что изменилось после N» становится
одним запросом с одним индексом.

Чтобы два устройства, отправившие правки разом, не получили один номер,
отправка начинается с блокировки строки аккаунта. Блокировка держится до
конца транзакции запроса — миллисекунды.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.config import Settings
from grafik_api.core.errors import (
    BadCredentialsError,
    ItemTooLargeError,
    QuotaExceededError,
    ResyncRequiredError,
    ValidationFailedError,
)
from grafik_api.core.limits import (
    MAX_ACCOUNT_BYTES,
    MAX_BLOB_BYTES,
    MAX_ITEMS_PER_ACCOUNT,
)
from grafik_api.core.logging import get_logger
from grafik_api.core.security import encode_wrapped
from grafik_api.models import Blob
from grafik_api.models.sync import ITEM_KINDS
from grafik_api.repositories import BlobRepository, UserRepository

logger = get_logger("service.sync")

#: Опознание единственного указателя библиотеки.
INDEX_ID = "index"

#: Сколько версий элемента держим и сколько они живут (раздел 4 контракта).
HISTORY_KEEP = 10
HISTORY_DAYS = 30

#: Сколько живут надгробия: столько времени у редко включаемого устройства
#: есть, чтобы узнать об удалении.
TOMBSTONE_DAYS = 180


@dataclass(frozen=True)
class Item:
    """Состояние элемента — то, что уходит клиенту.

    Простые значения, а не строка ORM: за пределами сессии у ORM-объекта
    легко случается запрос к базе там, где его никто не ждёт.
    """

    kind: str
    item_id: str
    rev: int
    deleted: bool
    updated_at: datetime
    size: int
    blob: str | None

    @classmethod
    def of(cls, строка: Blob) -> Item:
        return cls(
            kind=строка.kind,
            item_id=строка.item_id,
            rev=строка.rev,
            deleted=строка.deleted_at is not None,
            updated_at=строка.updated_at,
            size=строка.size,
            blob=encode_wrapped(строка.blob) if строка.blob is not None else None,
        )

    @classmethod
    def отсутствует(cls, kind: str, item_id: str, now: datetime) -> Item:
        """Состояние «элемента нет».

        Бывает, когда клиент правил элемент, которого на сервере уже не
        существует: надгробие убрано сборщиком или аккаунт выбирали с
        нуля. Для клиента это то же, что удалён, и его правка победит при
        повторной отправке с базовой ревизией `0` — удалить человек всегда
        успеет, а воскресить стёртое нет (раздел 5 контракта).
        """
        return cls(
            kind=kind,
            item_id=item_id,
            rev=0,
            deleted=True,
            updated_at=now,
            size=0,
            blob=None,
        )


@dataclass(frozen=True)
class Applied:
    """Принятый элемент и выданная ему ревизия."""

    kind: str
    item_id: str
    rev: int


@dataclass(frozen=True)
class PushCommand:
    """Правка, пришедшая от клиента, — уже разобранная."""

    kind: str
    item_id: str
    base_rev: int
    mutation_id: uuid.UUID
    deleted: bool
    blob: bytes | None


@dataclass(frozen=True)
class PullResult:
    rev: int
    min_rev_available: int
    items: list[Item]
    has_more: bool


@dataclass(frozen=True)
class PushResult:
    rev: int
    applied: list[Applied]
    conflicts: list[Item]


@dataclass(frozen=True)
class GcReport:
    """Что убрал сборщик."""

    tombstones: int
    revisions: int
    accounts: int


class SyncService:
    """Правила обмена зашифрованными элементами."""

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.users = UserRepository(session)
        self.blobs = BlobRepository(session)

    # --- Выборка ----------------------------------------------------------

    async def pull(self, user_id: uuid.UUID, *, since: int, limit: int) -> PullResult:
        """Что изменилось после ревизии `since`."""
        user = await self.users.get(user_id)
        if user is None:  # pragma: no cover - токен без аккаунта
            raise BadCredentialsError()

        if since < user.min_rev_available:
            # Курсор указывает в стёртую часть истории: об удалениях за
            # этот срок клиент уже не узнает. Честнее попросить выбрать
            # всё с нуля, чем молча отдать неполную картину.
            raise ResyncRequiredError(
                "курсор старше полной истории",
                min_rev_available=user.min_rev_available,
            )

        # Берём на один больше, чем просили: лишний элемент — это и есть
        # ответ на вопрос «а есть ли ещё».
        строки = await self.blobs.changed_since(user_id, since, limit + 1)
        есть_ещё = len(строки) > limit

        return PullResult(
            rev=user.rev,
            min_rev_available=user.min_rev_available,
            items=[Item.of(строка) for строка in строки[:limit]],
            has_more=есть_ещё,
        )

    # --- Отправка ---------------------------------------------------------

    async def push(
        self, user_id: uuid.UUID, команды: Sequence[PushCommand]
    ) -> PushResult:
        """Применить правки — каждую со своей базовой ревизией."""
        for команда in команды:
            self._проверить(команда)

        user = await self.users.lock(user_id)
        if user is None:  # pragma: no cover - токен без аккаунта
            raise BadCredentialsError()

        now = datetime.now(UTC)
        количество, байты = await self.blobs.usage(user_id)

        принято: list[Applied] = []
        конфликты: list[Item] = []

        for команда in команды:
            строка = await self.blobs.by_item(user_id, команда.kind, команда.item_id)

            # Повтор той же попытки: отдаём ту же ревизию и ничего не
            # пишем. Без этого оборвавшийся ответ при повторе давал бы
            # ложный конфликт.
            if строка is not None and строка.mutation_id == команда.mutation_id:
                принято.append(
                    Applied(kind=команда.kind, item_id=команда.item_id, rev=строка.rev)
                )
                continue

            была = строка.rev if строка is not None else 0

            if команда.base_rev != была:
                конфликты.append(
                    Item.of(строка)
                    if строка is not None
                    else Item.отсутствует(команда.kind, команда.item_id, now)
                )
                continue

            количество, байты = self._проверить_квоты(
                команда, строка, количество=количество, байты=байты
            )

            user.rev += 1
            await self._записать(
                команда, строка, user_id=user_id, rev=user.rev, now=now
            )
            принято.append(
                Applied(kind=команда.kind, item_id=команда.item_id, rev=user.rev)
            )

        logger.info(
            "правки приняты",
            extra={
                "event": "sync.push",
                "user_id": str(user_id),
                "applied": len(принято),
                "conflicts": len(конфликты),
                "rev": user.rev,
            },
        )

        return PushResult(rev=user.rev, applied=принято, conflicts=конфликты)

    # --- Сборка мусора ----------------------------------------------------

    async def collect_garbage(self, *, now: datetime | None = None) -> GcReport:
        """Убрать то, чему вышел срок (раздел 8 контракта).

        Запускается не по запросу человека, а по расписанию (шаг 13).
        Здесь — только правила: надгробия живут 180 дней, версии — 30.
        """
        now = now or datetime.now(UTC)

        границы = await self.blobs.purge_tombstones(
            now - timedelta(days=TOMBSTONE_DAYS)
        )

        for user_id, ревизия in границы.items():
            user = await self.users.get(user_id)
            if user is None:  # pragma: no cover - блобы уходят вместе с аккаунтом
                continue
            user.min_rev_available = max(user.min_rev_available, ревизия)

        версий = await self.blobs.purge_old_revisions(
            now - timedelta(days=HISTORY_DAYS)
        )

        # Сброс, а не фиксация: увидеть результат в своих же запросах
        # вызвавший должен сразу, а фиксировать — его дело. У задачи по
        # расписанию и у запроса это разные решения.
        await self.session.flush()

        logger.info(
            "сборка мусора",
            extra={
                "event": "sync.gc",
                "tombstones": len(границы),
                "revisions": версий,
            },
        )

        return GcReport(
            tombstones=sum(1 for _ in границы),
            revisions=версий,
            accounts=len(границы),
        )

    # --- Внутреннее -------------------------------------------------------

    def _проверить(self, команда: PushCommand) -> None:
        """Проверки, для которых база не нужна.

        Делаются до блокировки аккаунта: отвергнутый запрос не должен
        задерживать чужую отправку.
        """
        if команда.kind not in ITEM_KINDS:
            raise ValidationFailedError(f"неизвестный вид элемента: {команда.kind}")

        if команда.kind == "index" and команда.item_id != INDEX_ID:
            raise ValidationFailedError("указатель библиотеки у аккаунта один")

        if команда.deleted:
            if команда.blob is not None:
                raise ValidationFailedError("у удаления не бывает содержимого")
            return

        if команда.blob is None:
            raise ValidationFailedError("элемент без содержимого")

        if len(команда.blob) > MAX_BLOB_BYTES:
            raise ItemTooLargeError(
                f"элемент больше {MAX_BLOB_BYTES} байт",
                limit=MAX_BLOB_BYTES,
                size=len(команда.blob),
            )

    def _проверить_квоты(
        self,
        команда: PushCommand,
        строка: Blob | None,
        *,
        количество: int,
        байты: int,
    ) -> tuple[int, int]:
        """Уместится ли правка в квоты аккаунта.

        Счётчики ведутся по ходу отправки, а не считаются заново на каждый
        элемент: пятьдесят элементов в одном запросе — это пятьдесят
        лишних запросов к базе.
        """
        было = 0 if строка is None or строка.deleted_at is not None else строка.size
        станет = len(команда.blob) if команда.blob is not None else 0

        новый = строка is None or строка.deleted_at is not None
        элементов = количество + (0 if команда.deleted else int(новый))

        if элементов > MAX_ITEMS_PER_ACCOUNT:
            raise QuotaExceededError(
                f"элементов на аккаунт не больше {MAX_ITEMS_PER_ACCOUNT}",
                limit=MAX_ITEMS_PER_ACCOUNT,
            )

        объём = байты - было + станет

        if объём > MAX_ACCOUNT_BYTES:
            raise QuotaExceededError(
                f"объём аккаунта не больше {MAX_ACCOUNT_BYTES} байт",
                limit=MAX_ACCOUNT_BYTES,
            )

        return элементов, объём

    async def _записать(
        self,
        команда: PushCommand,
        строка: Blob | None,
        *,
        user_id: uuid.UUID,
        rev: int,
        now: datetime,
    ) -> None:
        """Записать правку: новый элемент, новая версия или надгробие."""
        if строка is None:
            self.blobs.create(
                user_id=user_id,
                kind=команда.kind,
                item_id=команда.item_id,
                rev=rev,
                blob=команда.blob,
                mutation_id=команда.mutation_id,
                deleted_at=now if команда.deleted else None,
            )
            return

        if команда.deleted:
            # Содержимое стирается, история — тоже: иначе «удалил»
            # означало бы «не видно», а это не удаление.
            await self.blobs.drop_history(строка.id)
            строка.blob = None
            строка.size = 0
            строка.deleted_at = now
        else:
            # Прежняя версия уходит в историю, и только потом место
            # занимает новая.
            self.blobs.keep_revision(строка, now)
            строка.blob = команда.blob
            строка.size = len(команда.blob) if команда.blob else 0
            строка.deleted_at = None

        строка.rev = rev
        строка.mutation_id = команда.mutation_id

        if not команда.deleted:
            # Сброс нужен до чистки: автосброс у сессии выключен, и
            # запрос на удаление лишних версий иначе не увидел бы только
            # что добавленную.
            await self.blobs.flush()
            await self.blobs.trim_history(
                строка.id, HISTORY_KEEP, now - timedelta(days=HISTORY_DAYS)
            )
