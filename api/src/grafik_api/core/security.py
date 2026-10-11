"""Крипто-примитивы: проверочное значение пароля, токены, подпись.

Главное, что стоит понять про этот модуль: **пароля здесь нет**. Браузер
выводит из пароля ключ (`KEK`) и проверочное значение (`verifier`), и на
сервер приходит только второе. Поэтому ниже нет ни слова `password` в
смысле «то, что ввёл человек» — и это не придирка к названиям, а свойство
схемы: сервер не может узнать пароль, даже если захочет.

--- Как хранится проверочное значение --------------------------------------

```
verifier (из браузера) ──HMAC-SHA256(перец)──► argon2id ──► строка в базе
```

Два шага, и у каждого своя работа. **Перец** лежит в окружении, а не в
базе: украденной базы не должно хватать для подбора — без перца подбирать
нечего. **argon2id** стоит на случай утечки перца вместе с базой: тогда
подбор снова станет возможным, но дорогим.

Параметры argon2 на сервере скромнее, чем в браузере (19 МиБ против 64), и
это осознанно: на вход подаётся не пароль, а уже результат браузерного
argon2 — то есть подбор и так стоит 64 МиБ за попытку. Вторая
рекомендация RFC 9106 здесь уместнее первой: вход у нас с высокой
энтропией, а каждый вход на сервере — это память и время сервера.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID, uuid4

import jwt
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from grafik_api.core.config import Settings
from grafik_api.core.errors import (
    BadCredentialsError,
    TokenExpiredError,
    ValidationFailedError,
)


@dataclass(frozen=True)
class KdfParams:
    """Параметры вывода ключа на стороне браузера.

    Версионируются и хранятся у аккаунта: поднять стойкость позже можно
    будет, не ломая вход тем, кто зарегистрировался раньше (раздел 2.1
    контракта).
    """

    kdf_version: str
    algorithm: str
    memory_kib: int
    iterations: int
    parallelism: int
    length: int


#: Единственная пока версия — та, что описана в контракте.
KDF_V1: Final = KdfParams(
    kdf_version="kdf_v1",
    algorithm="argon2id",
    memory_kib=65536,
    iterations=3,
    parallelism=1,
    length=32,
)

KDF_VERSIONS: Final[dict[str, KdfParams]] = {KDF_V1.kdf_version: KDF_V1}

#: Какую версию предлагать новым аккаунтам.
CURRENT_KDF: Final = KDF_V1

# Параметры серверного хэша. Вторая рекомендация RFC 9106: 19 МиБ, 2
# проходa, один поток.
_hasher: Final = PasswordHasher(
    time_cost=2,
    memory_cost=19 * 1024,
    parallelism=1,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)

# Хэш заглушки: по нему проверяется несуществующий аккаунт, чтобы ответ
# занимал столько же времени, сколько настоящая проверка. Иначе время
# ответа становится оракулом существования адреса.
_DUMMY_HASH: Final = _hasher.hash("заглушка-для-ровного-времени-ответа")


def decode_wrapped(value: str) -> bytes:
    """Разобрать base64url без выравнивающих знаков.

    Без них, потому что знак `=` в ссылке и в JSON только мешает. Разбор
    отдельной функцией, а не в схеме: схема описывает то, что едет по
    HTTP, а байты — уже внутреннее дело.
    """
    остаток = len(value) % 4
    выровнено = value + "=" * (4 - остаток if остаток else 0)

    try:
        return base64.urlsafe_b64decode(выровнено)
    except (binascii.Error, ValueError) as error:
        raise ValidationFailedError("значение не в base64url") from error


def encode_wrapped(value: bytes) -> str:
    """Собрать base64url без выравнивающих знаков."""
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def peppered(verifier: str, pepper: str) -> bytes:
    """Проверочное значение с перцем.

    HMAC, а не склейка строк: склейка позволяет удлинить сообщение, HMAC —
    нет. Перец на стороне сервера, значения из базы для подбора мало.
    """
    return hmac.new(
        pepper.encode("utf-8"), verifier.encode("utf-8"), hashlib.sha256
    ).digest()


def hash_verifier(verifier: str, settings: Settings) -> str:
    """Строка, которую можно положить в базу."""
    return _hasher.hash(peppered(verifier, settings.pepper.get_secret_value()))


def verify_verifier(stored: str | None, verifier: str, settings: Settings) -> bool:
    """Сверить присланное значение с хранимым.

    `stored=None` (аккаунта нет) — не повод ответить быстрее: проверка
    всё равно выполняется, по заглушке.
    """
    пришло = peppered(verifier, settings.pepper.get_secret_value())

    try:
        return _hasher.verify(stored if stored is not None else _DUMMY_HASH, пришло)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    except UnicodeEncodeError:
        # Строка в базе оказалась не хэшем argon2 (кто-то правил базу
        # руками). Это «не подошло», а не пятисотка: вход должен
        # отказать, а не упасть.
        return False


def needs_rehash(stored: str) -> bool:
    """Пора ли перехэшировать: параметры в коде стали строже хранимых."""
    return _hasher.check_needs_rehash(stored)


# --- Токены ---------------------------------------------------------------

#: Длина refresh-токена в байтах. 32 случайных байта — 256 бит: подбирать
#: нечем, и хранить можно быстрый хэш, а не argon2.
REFRESH_BYTES: Final = 32


def new_refresh_token() -> tuple[str, bytes]:
    """Новый refresh-токен: что отдать браузеру и что положить в базу."""
    token = secrets.token_urlsafe(REFRESH_BYTES)
    return token, token_digest(token)


def token_digest(token: str) -> bytes:
    """SHA-256 от токена.

    Быстрый хэш здесь уместен, в отличие от пароля: значение случайное и
    длинное, перебирать его бессмысленно.
    """
    return hashlib.sha256(token.encode("utf-8")).digest()


def issue_access_token(user_id: UUID, settings: Settings) -> tuple[str, int]:
    """Access-токен и его срок жизни в секундах.

    Он живёт в памяти вкладки и не попадает ни в `localStorage`, ни в
    cookie: оттуда его читает любой внедрённый скрипт.
    """
    выдан = datetime.now(UTC)
    истекает = выдан + timedelta(seconds=settings.access_ttl)

    payload = {
        "sub": str(user_id),
        "iat": int(выдан.timestamp()),
        "exp": int(истекает.timestamp()),
        # Назначение токена — чтобы refresh нельзя было предъявить вместо
        # access, если он когда-нибудь тоже станет подписанным.
        "typ": "access",
        # Опознание самого токена (RFC 7519). Без него два токена,
        # выданных в одну секунду, совпадают до байта: беды в этом нет,
        # но и пользы — ни в журнале, ни в будущем списке отозванных.
        "jti": uuid4().hex,
    }

    token = jwt.encode(
        payload, settings.jwt_secret.get_secret_value(), algorithm="HS256"
    )
    return token, settings.access_ttl


def read_access_token(token: str, settings: Settings) -> UUID:
    """Опознать владельца токена.

    Протухший токен и подделка — разные ошибки: по первой приложение
    молча обновляет токен, по второй просит войти заново.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            options={"require": ["sub", "iat", "exp"]},
        )
    except jwt.ExpiredSignatureError as error:
        raise TokenExpiredError() from error
    except jwt.InvalidTokenError as error:
        raise BadCredentialsError() from error

    if payload.get("typ") != "access":
        raise BadCredentialsError()

    try:
        return UUID(payload["sub"])
    except (ValueError, TypeError) as error:
        raise BadCredentialsError() from error
