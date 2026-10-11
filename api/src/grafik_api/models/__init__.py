"""Таблицы: модели SQLAlchemy (ORM).

Перечень столбцов и сроков сверяется с `docs/legal/data-map.md`: данных,
которых нет в карте, в базе быть не должно. Обратное тоже верно — строка
карты без столбца означает, что обещание в политике не исполнено.

Все модели импортируются здесь, и это не стиль, а необходимость: Alembic
сравнивает базу с `Base.metadata`, а в метаданных оказывается только то,
что успели импортировать. Пропущенный импорт означает миграцию, которая
молча удаляет таблицу.

Наружу из слоя сервисов ORM-объекты без нужды не отдаются: ленивая
подгрузка за пределами сессии — самый тихий способ получить запрос к базе
там, где его никто не ждёт.
"""

from grafik_api.models.audit import AuditEntry
from grafik_api.models.session import OneTimeToken, RefreshToken
from grafik_api.models.sync import ITEM_KINDS, Blob, BlobRevision
from grafik_api.models.user import Consent, Credential, DataKey, User

__all__ = [
    "ITEM_KINDS",
    "AuditEntry",
    "Blob",
    "BlobRevision",
    "Consent",
    "Credential",
    "DataKey",
    "OneTimeToken",
    "RefreshToken",
    "User",
]
