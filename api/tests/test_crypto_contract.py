"""Крипто-контракт: сервер и браузер считают одно и то же.

Векторы лежат в `docs/crypto-vectors.json` и выписаны браузерным
криптомодулем (`src/features/sync/crypto/`) на боевых параметрах
`kdf_v1`. Здесь те же значения пересчитываются **другими
реализациями**: argon2id считает argon2-cffi вместо hash-wasm, HKDF —
`hmac` из стандартной библиотеки вместо WebCrypto.

--- Зачем это сервер, который пароля не видит ------------------------------

Сервер и правда не выводит ключи: `verifier` приходит готовым. Но он
**объявляет параметры** (`POST /auth/params`), и если объявленное
расходится с тем, что считает браузер, человек не войдёт — причём
выяснится это на живом человеке, а не в тестах. Два независимых набора
реализаций, сходящихся на одних байтах, и означают, что параметры и
кодировки описаны однозначно.

Проверяется заодно то, что только сервер и может проверить: присланные
значения проходят его схемы и его хранение проверочного значения.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path
from typing import Any

import pytest
from argon2.low_level import Type, hash_secret_raw

from grafik_api.core.config import Settings
from grafik_api.core.security import (
    KDF_V1,
    decode_wrapped,
    encode_wrapped,
    hash_verifier,
    verify_verifier,
)
from grafik_api.schemas.auth import RegisterIn
from grafik_api.services.auth import normalize_email
from tests.factories import тело_регистрации

ВЕКТОРЫ = Path(__file__).resolve().parents[2] / "docs" / "crypto-vectors.json"

#: Приставки солей и метки HKDF — из раздела 2.1 контракта. Записаны
#: здесь буквами, а не взяты из кода браузера: смысл проверки в том,
#: чтобы две стороны пришли к одному независимо.
СОЛЬ_ОСНОВЫ = "grafik13/master/v1|"
СОЛЬ_ВОССТАНОВЛЕНИЯ = "grafik13/rec/v1|"
МЕТКА_ОПОЗНАНИЯ = b"grafik13/auth/v1"


def векторы() -> dict[str, Any]:
    данные: dict[str, Any] = json.loads(ВЕКТОРЫ.read_text(encoding="utf-8"))
    return данные


def случаи() -> list[dict[str, Any]]:
    список: list[dict[str, Any]] = векторы()["cases"]
    return список


def соль(приставка: str, адрес: str) -> bytes:
    """Первые 16 байт SHA-256 от приставки и нормализованного адреса."""
    return hashlib.sha256(
        (приставка + normalize_email(адрес)).encode("utf-8")
    ).digest()[:16]


def hkdf(материал: bytes, метка: bytes, длина: int = 32) -> bytes:
    """HKDF-SHA256 (RFC 5869) с пустой солью — как его делает WebCrypto.

    Пустая соль означает извлечение нулевым ключом: это определённое
    поведение, а не отсутствие шага, и именно поэтому его удаётся
    воспроизвести здесь двадцатью строками без сторонних библиотек.
    """
    prk = hmac.new(
        b"\x00" * hashlib.sha256().digest_size, материал, hashlib.sha256
    ).digest()

    выход = b""
    блок = b""
    счётчик = 1

    while len(выход) < длина:
        блок = hmac.new(prk, блок + метка + bytes([счётчик]), hashlib.sha256).digest()
        выход += блок
        счётчик += 1

    return выход[:длина]


def основа(пароль: str, адрес: str, kdf: dict[str, Any]) -> bytes:
    """Та самая одна дорогая операция: argon2id от пароля."""
    return hash_secret_raw(
        secret=пароль.encode("utf-8"),
        salt=соль(СОЛЬ_ОСНОВЫ, адрес),
        time_cost=kdf["iterations"],
        memory_cost=kdf["memory_kib"],
        parallelism=kdf["parallelism"],
        hash_len=kdf["length"],
        type=Type.ID,
    )


# --- Параметры --------------------------------------------------------------


def test_векторы_на_тех_же_параметрах_что_объявляет_сервер() -> None:
    """Разойдись числа — и браузер выведет не тот ключ, что ждут обёртки."""
    kdf = векторы()["kdf"]

    assert kdf["kdf_version"] == KDF_V1.kdf_version
    assert kdf["algorithm"] == KDF_V1.algorithm
    assert kdf["memory_kib"] == KDF_V1.memory_kib
    assert kdf["iterations"] == KDF_V1.iterations
    assert kdf["parallelism"] == KDF_V1.parallelism
    assert kdf["length"] == KDF_V1.length


# --- Сходимость двух реализаций --------------------------------------------


@pytest.mark.parametrize("случай", случаи(), ids=lambda случай: случай["email_norm"])
def test_адрес_приводится_к_тому_же_виду(случай: dict[str, Any]) -> None:
    assert normalize_email(случай["email"]) == случай["email_norm"]


@pytest.mark.parametrize("случай", случаи(), ids=lambda случай: случай["email_norm"])
def test_соли_сходятся(случай: dict[str, Any]) -> None:
    assert соль(СОЛЬ_ОСНОВЫ, случай["email"]).hex() == случай["salt_master"]
    assert соль(СОЛЬ_ВОССТАНОВЛЕНИЯ, случай["email"]).hex() == случай["salt_rec"]


@pytest.mark.parametrize("случай", случаи(), ids=lambda случай: случай["email_norm"])
def test_verifier_сходится(случай: dict[str, Any]) -> None:
    """Главная проверка: argon2id и HKDF у двух сторон дают одни байты."""
    посчитано = encode_wrapped(
        hkdf(
            основа(случай["password"], случай["email"], векторы()["kdf"]),
            МЕТКА_ОПОЗНАНИЯ,
        )
    )

    assert посчитано == случай["verifier"]


@pytest.mark.parametrize("случай", случаи(), ids=lambda случай: случай["email_norm"])
def test_ключ_восстановления_это_128_бит(случай: dict[str, Any]) -> None:
    """Печатный вид — способ переписать 128 бит, а не сами биты."""
    assert len(bytes.fromhex(случай["recovery_key_bytes"])) == 16
    assert len(случай["recovery_key"]) == 27
    assert случай["recovery_key_printed"].replace("-", "") == случай["recovery_key"]


# --- Что проверить может только сервер -------------------------------------


@pytest.mark.parametrize("случай", случаи(), ids=lambda случай: случай["email_norm"])
def test_присланное_проходит_схемы_сервера(случай: dict[str, Any]) -> None:
    """Регистрация с настоящими значениями из браузера, а не с правдоподобными."""
    данные = RegisterIn.model_validate(
        тело_регистрации(
            email=случай["email"],
            verifier=случай["verifier"],
            wrapped_dek_pwd=случай["wrapped_dek_pwd"],
            wrapped_dek_rec=случай["wrapped_dek_rec"],
        )
    )

    assert данные.kdf_version == KDF_V1.kdf_version
    # Обёртка — nonce, ключ и признак целостности, ровно 60 байт.
    assert len(decode_wrapped(данные.wrapped_dek_pwd)) == 60
    assert len(decode_wrapped(данные.wrapped_dek_rec)) == 60
    assert len(decode_wrapped(данные.verifier)) == 32


@pytest.mark.parametrize("случай", случаи(), ids=lambda случай: случай["email_norm"])
def test_проверочное_значение_хранится_и_сходится(случай: dict[str, Any]) -> None:
    """Браузерный verifier проходит весь серверный путь: перец, argon2, сверка."""
    settings = Settings(env="test")
    сохранено = hash_verifier(случай["verifier"], settings)

    assert verify_verifier(сохранено, случай["verifier"], settings)
    # Чужое значение не подходит — иначе проверка ничего не проверяет.
    assert not verify_verifier(
        сохранено, базовое_искажение(случай["verifier"]), settings
    )


def базовое_искажение(verifier: str) -> str:
    """Тот же verifier с одним изменённым байтом."""
    байты = bytearray(decode_wrapped(verifier))
    байты[0] ^= 1
    return encode_wrapped(bytes(байты))
