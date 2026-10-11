"""Элементы синхронизации и их история.

Две таблицы в одном репозитории намеренно: `blob_revisions` без `blobs` не
существует, и пишутся они всегда вместе — новая версия вытесняет прежнюю в
историю одним действием.

Сервер не знает, что внутри: для него это байты, размер и ревизия.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import delete, func, select

from grafik_api.models import Blob, BlobRevision
from grafik_api.repositories.base import Repository


class BlobRepository(Repository[Blob]):
    """Строки таблиц `blobs` и `blob_revisions`."""

    model = Blob

    async def by_item(self, user_id: uuid.UUID, kind: str, item_id: str) -> Blob | None:
        """Текущая версия элемента — вместе с надгробием, если он удалён."""
        return await self.session.scalar(
            select(Blob).where(
                Blob.user_id == user_id,
                Blob.kind == kind,
                Blob.item_id == item_id,
            )
        )

    async def changed_since(
        self, user_id: uuid.UUID, since: int, limit: int
    ) -> Sequence[Blob]:
        """Элементы, изменившиеся после ревизии, по возрастанию ревизии.

        Порядок — не вкусовщина: клиент запоминает курсором ревизию
        последнего полученного элемента, и при обрыве на середине страницы
        продолжит с того же места, не пропустив ничего.
        """
        строки = await self.session.scalars(
            select(Blob)
            .where(Blob.user_id == user_id, Blob.rev > since)
            .order_by(Blob.rev)
            .limit(limit)
        )
        return строки.all()

    async def usage(self, user_id: uuid.UUID) -> tuple[int, int]:
        """Сколько у аккаунта элементов и байтов — для проверки квот.

        Надгробия в счёт не идут: они пусты, и держать их за элементы
        значило бы наказывать за удаление.
        """
        строка = (
            await self.session.execute(
                select(func.count(), func.coalesce(func.sum(Blob.size), 0)).where(
                    Blob.user_id == user_id, Blob.deleted_at.is_(None)
                )
            )
        ).one()
        return int(строка[0]), int(строка[1])

    def create(
        self,
        *,
        user_id: uuid.UUID,
        kind: str,
        item_id: str,
        rev: int,
        blob: bytes | None,
        mutation_id: uuid.UUID,
        deleted_at: datetime | None = None,
    ) -> Blob:
        return self.add(
            Blob(
                user_id=user_id,
                kind=kind,
                item_id=item_id,
                rev=rev,
                blob=blob,
                size=len(blob) if blob else 0,
                mutation_id=mutation_id,
                deleted_at=deleted_at,
            )
        )

    def keep_revision(self, строка: Blob, written_at: datetime) -> BlobRevision | None:
        """Отложить нынешнюю версию в историю.

        У надгробия откладывать нечего. История — страховка от «стёр год
        одним нажатием», и живёт она по правилам раздела 4 контракта.
        """
        if строка.blob is None:
            return None

        return self.add_revision(
            BlobRevision(
                blob_id=строка.id,
                rev=строка.rev,
                blob=строка.blob,
                size=строка.size,
                written_at=written_at,
            )
        )

    def add_revision(self, revision: BlobRevision) -> BlobRevision:
        self.session.add(revision)
        return revision

    async def trim_history(
        self, blob_id: uuid.UUID, keep: int, older_than: datetime
    ) -> None:
        """Оставить последние `keep` версий и ничего старше срока.

        Два правила вместе: десять версий — чтобы откатить случайное
        стирание, тридцать дней — чтобы история не превращалась в архив.
        """
        оставить = (
            select(BlobRevision.rev)
            .where(BlobRevision.blob_id == blob_id)
            .order_by(BlobRevision.rev.desc())
            .limit(keep)
            .scalar_subquery()
        )

        await self.session.execute(
            delete(BlobRevision).where(
                BlobRevision.blob_id == blob_id,
                BlobRevision.rev.notin_(оставить),
            )
        )
        await self.session.execute(
            delete(BlobRevision).where(
                BlobRevision.blob_id == blob_id,
                BlobRevision.written_at < older_than,
            )
        )

    async def drop_history(self, blob_id: uuid.UUID) -> None:
        """Стереть историю элемента.

        Вызывается при удалении: иначе «удалил» означало бы «не видно», а
        содержимое продолжало бы лежать в истории до истечения срока.
        """
        await self.session.execute(
            delete(BlobRevision).where(BlobRevision.blob_id == blob_id)
        )

    async def purge_tombstones(self, before: datetime) -> dict[uuid.UUID, int]:
        """Убрать надгробия старше срока.

        Возвращает по аккаунту наибольшую ревизию убранного надгробия. Эта
        ревизия и становится границей полной истории: устройство с
        курсором меньше неё об удалениях уже не узнает, и честнее
        попросить его выбрать всё с нуля, чем промолчать.

        Границу считаем на аккаунт, а не общую: у разных людей истории
        разной длины, и наказывать одного за давние удаления другого
        незачем.
        """
        строки = await self.session.execute(
            delete(Blob)
            .where(Blob.deleted_at.is_not(None), Blob.deleted_at < before)
            .returning(Blob.user_id, Blob.rev)
        )

        границы: dict[uuid.UUID, int] = {}
        for user_id, rev in строки.all():
            границы[user_id] = max(границы.get(user_id, 0), rev)

        return границы

    async def purge_old_revisions(self, before: datetime) -> int:
        """Убрать версии старше срока у всех элементов."""
        строки = await self.session.scalars(
            delete(BlobRevision)
            .where(BlobRevision.written_at < before)
            .returning(BlobRevision.rev)
        )
        return len(строки.all())
