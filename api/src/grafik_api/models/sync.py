"""Элементы синхронизации: зашифрованные куски и их история.

Сервер не знает, что внутри: `blob` — это `nonce ‖ шифротекст ‖ тег`, а
ключа у сервера нет (раздел 1 контракта). Отсюда и форма таблиц: ни одного
столбца, который пришлось бы читать по содержимому.

**Надгробия — не отдельная таблица.** Удалённый элемент остаётся своей
строкой с `deleted_at` и новой ревизией: так другие устройства узнают об
удалении (раздел 4 контракта), а выборка изменений остаётся одним запросом
к одной таблице. План шага 5 обещал таблицу `tombstones`; контракт описал
надгробие как состояние элемента, и это расхождение осознанное.

Содержимое при удалении стирается: `blob` обнуляется, строки истории
удаляются. Иначе «удалил» означало бы «не видно», а это не удаление.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from grafik_api.db.base import Base, TimestampMixin

# Виды элементов (раздел 3 контракта). Перечислением в проверке, а не типом
# PostgreSQL: добавить значение в CHECK — одна строка миграции, а в тип
# `enum` — ALTER TYPE, который до PostgreSQL 12 не откатывался и до сих
# пор не умеет убирать значения.
ITEM_KINDS = ("index", "profile", "appearance")


class Blob(TimestampMixin, Base):
    """Текущая версия элемента: указателя библиотеки, профиля или оформления."""

    __tablename__ = "blobs"
    __table_args__ = (
        # Опознание элемента внутри аккаунта — вид и идентификатор. Ключ
        # составной, а не суррогатный только ради удобства ссылок: по нему
        # ищут и по нему же обновляют.
        UniqueConstraint("user_id", "kind", "item_id"),
        CheckConstraint("kind IN ('index', 'profile', 'appearance')", name="kind"),
        CheckConstraint("size >= 0", name="size"),
        # Выборка изменений — «всё, что новее ревизии N», и этот индекс
        # единственное, что держит её быстрой.
        Index("ix_blobs_user_id_rev", "user_id", "rev"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    kind: Mapped[str] = mapped_column(String(16), nullable=False)

    # `index` для указателя и `appearance` для оформления (по одному на
    # аккаунт) или uuid записи проводника. Строкой, а не uuid: у двух
    # элементов из трёх идентификатор — слово.
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)

    rev: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Пусто у надгробия — и это единственный случай.
    blob: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # Серверное значение по умолчанию, а не только питоновское: схема
    # должна быть самодостаточной — вставка мимо ORM (миграция данных,
    # разбор происшествия руками) не должна падать на `NOT NULL`.
    size: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Последняя применённая правка. Повтор отправки с тем же значением не
    # создаёт новой ревизии (раздел 6 контракта): сеть рвётся, клиент
    # повторяет, и дважды записанная правка выглядела бы конфликтом с самим
    # собой. Хранится только последняя — на повтор сразу после обрыва этого
    # хватает; понадобится окно шире, его завести придётся отдельной
    # таблицей (решение шага 8).
    mutation_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    revisions: Mapped[list[BlobRevision]] = relationship(
        back_populates="blob_row",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class BlobRevision(Base):
    """Прошлая версия элемента.

    Страховка от «стёр год одним нажатием», а не архив: сервер держит
    последние 10 ревизий каждого элемента и не дольше 30 дней (раздел 4
    контракта). Чистит сборщик.
    """

    __tablename__ = "blob_revisions"

    blob_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("blobs.id", ondelete="CASCADE"), primary_key=True
    )
    rev: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    blob: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)

    written_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    blob_row: Mapped[Blob] = relationship(back_populates="revisions")
