"""Что приходит и уходит на путях `/account`.

Выгрузка — тот же формат, что и остальные ответы: один JSON, в котором
блобы лежат как есть, зашифрованными.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field

from grafik_api.schemas.auth import Verifier, WrappedKey
from grafik_api.schemas.sync import ItemOut
from grafik_api.services.account import AccountInfo, ConsentRecord, ExportData


class ConsentOut(BaseModel):
    """Принятая редакция одного документа — строка записи о согласии.

    Всё, что о ней хранится, отдаётся человеку (ст. 14 152-ФЗ): в том числе
    адрес, с которого принято, и хэш текста.
    """

    kind: Literal["policy", "consent", "terms"]
    version: str
    accepted_at: datetime
    #: `null` у строк, перенесённых из прежней схемы: хэш тогда не записывался.
    sha256: str | None = None
    via: Literal["registration", "renewal"] = "registration"
    ip: str | None = None


class UsageOut(BaseModel):
    """Сколько места занято — чтобы человек видел, к чему идёт дело."""

    items: int
    bytes: int


class AccountOut(BaseModel):
    """Сведения об аккаунте (ст. 14 152-ФЗ — право знать)."""

    id: UUID
    email: str
    email_verified: bool
    created_at: datetime
    rev: int
    usage: UsageOut
    #: Последняя принятая редакция каждого документа.
    consents: list[ConsentOut]
    #: Документы, на которые надо ответить заново.
    consent_pending: list[Literal["consent", "terms"]]

    @classmethod
    def of(cls, сведения: AccountInfo) -> Self:
        return cls(
            id=сведения.id,
            email=сведения.email,
            email_verified=сведения.email_verified,
            created_at=сведения.created_at,
            rev=сведения.rev,
            usage=UsageOut(items=сведения.items, bytes=сведения.bytes),
            consents=[_согласие(запись) for запись in сведения.consents],
            consent_pending=list(сведения.consent_pending),
        )


def _согласие(запись: ConsentRecord) -> ConsentOut:
    return ConsentOut(
        kind=запись.kind,
        version=запись.version,
        accepted_at=запись.accepted_at,
        sha256=запись.sha256,
        via=запись.via,
        ip=запись.ip,
    )


class SignInOut(BaseModel):
    """Строка журнала событий безопасности."""

    at: datetime
    event: str
    ip: str | None = None
    device_id: str | None = None


class ExportOut(BaseModel):
    """Выгрузка всего, что о человеке есть."""

    account: AccountOut
    items: list[ItemOut]
    consents: list[ConsentOut]
    sign_ins: list[SignInOut]
    exported_at: datetime

    @classmethod
    def of(cls, данные: ExportData) -> Self:
        аккаунт = AccountOut.of(данные.account)

        return cls(
            account=аккаунт,
            items=[ItemOut.of(item) for item in данные.items],
            consents=[_согласие(запись) for запись in данные.consents],
            sign_ins=[
                SignInOut(
                    at=вход.at,
                    event=вход.event,
                    ip=вход.ip,
                    device_id=вход.device_id,
                )
                for вход in данные.sign_ins
            ],
            exported_at=данные.exported_at,
        )


class DeleteIn(BaseModel):
    """Удаление аккаунта.

    Проверочное значение спрашивается не из недоверия: украденного
    access-токена не должно хватать, чтобы стереть человеку год работы.
    """

    verifier: Verifier


class PasswordIn(BaseModel):
    """Смена пароля.

    Браузер уже перешифровал обёртку ключа данных новым паролем и
    присылает её готовой: сервер ключа не видит и перешифровать не может.
    """

    current_verifier: Verifier
    verifier: Verifier
    wrapped_dek_pwd: WrappedKey
    #: Если человек заодно перевыпустил ключ восстановления.
    wrapped_dek_rec: WrappedKey | None = None
    kdf_version: str = Field(max_length=32)
