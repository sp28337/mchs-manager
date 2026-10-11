"""Слой доступа к данным.

Здесь — запросы к базе и ничего больше. Репозиторий не решает, законна ли
операция, и не считает лимитов: он умеет найти, записать, удалить. Так
бизнес-правила остаются проверяемыми без базы, а запросы — без подмены
половины приложения.

Сессию репозиторий получает извне (из зависимости `get_session`), а не
создаёт сам: иначе одна операция из двух шагов окажется в двух
транзакциях.
"""

from grafik_api.repositories.audit import AuditRepository
from grafik_api.repositories.base import Repository
from grafik_api.repositories.blobs import BlobRepository
from grafik_api.repositories.consents import ConsentRepository
from grafik_api.repositories.credentials import (
    KIND_PWD,
    KIND_REC,
    CredentialRepository,
    DataKeyRepository,
)
from grafik_api.repositories.sessions import RefreshTokenRepository
from grafik_api.repositories.users import UserRepository

__all__ = [
    "KIND_PWD",
    "KIND_REC",
    "AuditRepository",
    "BlobRepository",
    "ConsentRepository",
    "CredentialRepository",
    "DataKeyRepository",
    "RefreshTokenRepository",
    "Repository",
    "UserRepository",
]
