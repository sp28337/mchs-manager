"""Крипто-примитивы по отдельности.

Базы здесь не нужно: проверяются чистые функции, на которых держится вход.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest

from grafik_api.core.config import Settings
from grafik_api.core.errors import (
    BadCredentialsError,
    TokenExpiredError,
    ValidationFailedError,
)
from grafik_api.core.security import (
    CURRENT_KDF,
    decode_wrapped,
    encode_wrapped,
    hash_verifier,
    issue_access_token,
    new_refresh_token,
    peppered,
    read_access_token,
    token_digest,
    verify_verifier,
)
from grafik_api.services.auth import normalize_email

НАСТРОЙКИ = Settings(env="test")
ЗНАЧЕНИЕ = encode_wrapped(b"\x01" * 32)


def test_хэш_проверяется_и_не_повторяется() -> None:
    """Соль у argon2 своя на каждый вызов — одинаковых строк быть не должно."""
    первый = hash_verifier(ЗНАЧЕНИЕ, НАСТРОЙКИ)
    второй = hash_verifier(ЗНАЧЕНИЕ, НАСТРОЙКИ)

    assert первый != второй
    assert verify_verifier(первый, ЗНАЧЕНИЕ, НАСТРОЙКИ)
    assert verify_verifier(второй, ЗНАЧЕНИЕ, НАСТРОЙКИ)


def test_чужое_значение_не_подходит() -> None:
    хэш = hash_verifier(ЗНАЧЕНИЕ, НАСТРОЙКИ)

    assert not verify_verifier(хэш, encode_wrapped(b"\x02" * 32), НАСТРОЙКИ)


def test_отсутствие_аккаунта_всё_равно_считается() -> None:
    """Проверка по заглушке: иначе время ответа выдаёт существование адреса."""
    assert not verify_verifier(None, ЗНАЧЕНИЕ, НАСТРОЙКИ)


def test_испорченный_хэш_не_ломает_вход() -> None:
    assert not verify_verifier("это не хэш argon2", ЗНАЧЕНИЕ, НАСТРОЙКИ)


def test_перец_меняет_результат() -> None:
    """Без перца украденной базы хватило бы для подбора."""
    assert peppered(ЗНАЧЕНИЕ, "один") != peppered(ЗНАЧЕНИЕ, "другой")


def test_разный_перец_разные_хэши() -> None:
    другие = Settings(env="test", pepper="совсем-другой-перец-для-разработки")
    хэш = hash_verifier(ЗНАЧЕНИЕ, НАСТРОЙКИ)

    assert not verify_verifier(хэш, ЗНАЧЕНИЕ, другие)


def test_base64url_туда_и_обратно() -> None:
    байты = bytes(range(60))

    assert decode_wrapped(encode_wrapped(байты)) == байты
    # Без выравнивающих знаков: в ссылке и в JSON они только мешают.
    assert "=" not in encode_wrapped(байты)


def test_мусор_вместо_base64url() -> None:
    with pytest.raises(ValidationFailedError):
        decode_wrapped("это+не/base64url")


def test_refresh_токен_случайный_и_хранится_хэшем() -> None:
    первый, хэш_первого = new_refresh_token()
    второй, _ = new_refresh_token()

    assert первый != второй
    assert хэш_первого == token_digest(первый)
    assert len(хэш_первого) == 32
    # В базе лежит хэш, а не токен: утечка базы не даёт войти.
    assert первый.encode("utf-8") not in хэш_первого


def test_access_токен_опознаёт_владельца() -> None:
    кто = uuid4()

    токен, срок = issue_access_token(кто, НАСТРОЙКИ)

    assert срок == НАСТРОЙКИ.access_ttl
    assert read_access_token(токен, НАСТРОЙКИ) == кто


def test_протухший_токен() -> None:
    кто = uuid4()
    выдан = datetime.now(UTC) - timedelta(hours=1)
    токен = jwt.encode(
        {
            "sub": str(кто),
            "iat": int(выдан.timestamp()),
            "exp": int((выдан + timedelta(minutes=15)).timestamp()),
            "typ": "access",
        },
        НАСТРОЙКИ.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )

    with pytest.raises(TokenExpiredError):
        read_access_token(токен, НАСТРОЙКИ)


def test_чужая_подпись_не_проходит() -> None:

    # а это заведомо тестовое значение.
    чужие = Settings(env="test", jwt_secret="чужая-подпись-для-разработки")
    токен, _ = issue_access_token(uuid4(), чужие)

    with pytest.raises(BadCredentialsError):
        read_access_token(токен, НАСТРОЙКИ)


def test_токен_не_того_назначения() -> None:
    """Refresh нельзя предъявить вместо access."""
    токен = jwt.encode(
        {
            "sub": str(uuid4()),
            "iat": int(datetime.now(UTC).timestamp()),
            "exp": int((datetime.now(UTC) + timedelta(minutes=5)).timestamp()),
            "typ": "refresh",
        },
        НАСТРОЙКИ.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )

    with pytest.raises(BadCredentialsError):
        read_access_token(токен, НАСТРОЙКИ)


def test_мусор_вместо_токена() -> None:
    with pytest.raises(BadCredentialsError):
        read_access_token("не.токен.вовсе", НАСТРОЙКИ)


def test_подпись_без_обязательных_полей() -> None:
    токен = jwt.encode(
        {"sub": str(uuid4())},
        НАСТРОЙКИ.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )

    with pytest.raises(BadCredentialsError):
        read_access_token(токен, НАСТРОЙКИ)


def test_нечисловой_владелец() -> None:
    токен = jwt.encode(
        {
            "sub": "никакой не uuid",
            "iat": int(datetime.now(UTC).timestamp()),
            "exp": int((datetime.now(UTC) + timedelta(minutes=5)).timestamp()),
            "typ": "access",
        },
        НАСТРОЙКИ.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )

    with pytest.raises(BadCredentialsError):
        read_access_token(токен, НАСТРОЙКИ)


@pytest.mark.parametrize(
    ("пришло", "ожидается"),
    [
        ("  Петров@Example.COM  ", "петров@example.com"),
        ("ПЕТРОВ@EXAMPLE.COM", "петров@example.com"),
        ("петров@example.com", "петров@example.com"),
    ],
)
def test_адрес_нормализуется(пришло: str, ожидается: str) -> None:
    """Браузер нормализует так же — иначе соли выйдут разные."""
    assert normalize_email(пришло) == ожидается


def test_параметры_по_умолчанию_те_что_в_контракте() -> None:
    assert CURRENT_KDF.kdf_version == "kdf_v1"
    assert CURRENT_KDF.algorithm == "argon2id"
    assert (CURRENT_KDF.memory_kib, CURRENT_KDF.iterations) == (65536, 3)
    assert (CURRENT_KDF.parallelism, CURRENT_KDF.length) == (1, 32)


def test_боевое_окружение_не_терпит_разработческих_секретов() -> None:
    """Приложение с перцем из репозитория лучше не поднять вовсе."""
    with pytest.raises(ValueError, match="боевом окружении"):
        Settings(env="prod")

    # Со своими длинными значениями — поднимается.
    Settings(
        env="prod",
        pepper="x" * 40,
        jwt_secret="y" * 40,
    )
