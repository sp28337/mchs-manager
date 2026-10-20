"""Что приходит и уходит на путях `/auth`.

Схемы повторяют `docs/openapi-draft.yaml` — по нему пишут фронт, и
расходиться они не должны. Двоичное едет в base64url без выравнивающих
знаков: так оно переживает и JSON, и ссылку в письме.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, StringConstraints

from grafik_api.core.security import KdfParams
from grafik_api.services.consents import ConsentGiven

#: Зашифрованная обёртка ключа: 12 байт nonce + 32 ключа + 16 тег ≈ 80
#: знаков. Предел с запасом, но не в мегабайтах: обёртка — не блоб.
WrappedKey = Annotated[
    str, StringConstraints(pattern=r"^[A-Za-z0-9_-]+$", max_length=512)
]

#: Проверочное значение пароля — 32 байта в base64url.
Verifier = Annotated[
    str, StringConstraints(pattern=r"^[A-Za-z0-9_-]+$", min_length=32, max_length=128)
]

#: Адрес почты. 254 знака — предел по RFC 5321.
Email = Annotated[EmailStr, StringConstraints(max_length=254)]


class KdfParamsOut(BaseModel):
    """Параметры вывода ключа для браузера."""

    kdf_version: str
    algorithm: str
    memory_kib: int
    iterations: int
    parallelism: int
    length: int

    @classmethod
    def of(cls, params: KdfParams) -> Self:
        return cls(
            kdf_version=params.kdf_version,
            algorithm=params.algorithm,
            memory_kib=params.memory_kib,
            iterations=params.iterations,
            parallelism=params.parallelism,
            length=params.length,
        )


class ParamsIn(BaseModel):
    """Запрос параметров до входа."""

    email: Email


class ConsentIn(BaseModel):
    """Что человек принял: версии документов и два совершённых действия.

    Действий два, потому что согласие на обработку персональных данных
    оформляется отдельно от иных документов (ч. 1 ст. 9 152-ФЗ): отметка
    «принимаю соглашение и политику» и отдельная — «даю согласие на обработку».
    Признаки обязательны и должны быть истинными: запрос без них — не
    согласие, а три версии без сведений о том, что человек что-либо отметил.
    """

    policy_version: str = Field(max_length=32)
    consent_version: str = Field(max_length=32)
    terms_version: str = Field(max_length=32)
    accepted_terms_and_policy: bool
    accepted_personal_data: bool

    def given(self) -> ConsentGiven:
        return ConsentGiven(**self.model_dump())


class RegisterIn(BaseModel):
    """Регистрация.

    Пароля здесь нет и быть не может: на сервер приходит проверочное
    значение и две обёртки ключа данных — зашифрованные браузером.
    """

    email: Email
    verifier: Verifier
    wrapped_dek_pwd: WrappedKey
    wrapped_dek_rec: WrappedKey
    kdf_version: str = Field(max_length=32)
    consent: ConsentIn


class LoginIn(BaseModel):
    """Вход."""

    email: Email
    verifier: Verifier


#: Одноразовый токен из письма. Длина с запасом: это 32 случайных байта
#: в base64url, но формат может поменяться, а схема — нет.
LinkToken = Annotated[str, StringConstraints(min_length=16, max_length=512)]


class VerifyEmailIn(BaseModel):
    """Подтверждение адреса по ссылке из письма."""

    token: LinkToken


class RecoverStartIn(BaseModel):
    """Просьба прислать письмо для восстановления доступа."""

    email: Email


class RecoverClaimIn(BaseModel):
    """Ссылка из письма: по ней отдаётся обёртка ключа восстановления."""

    token: LinkToken


class RecoverClaimOut(BaseModel):
    """Что нужно браузеру, чтобы развернуть ключ данных.

    Обёртка бесполезна без самого ключа восстановления — тех 128 бит,
    которые человек переписал на бумагу при регистрации; сервер его не
    видел ни разу. Адрес почты здесь не разглашение: ссылку держит тот,
    кто прочитал письмо, то есть владелец ящика. Параметры вывода ключа —
    те, что у этого аккаунта: поднятые позже не должны ломать
    восстановление тем, кто зарегистрировался раньше.
    """

    email: str
    wrapped_dek_rec: WrappedKey
    kdf: KdfParamsOut


class RecoverFinishIn(BaseModel):
    """Новый пароль после восстановления.

    Ключ восстановления на сервер не приходит: браузер уже развернул им
    ключ данных и присылает новую обёртку.
    """

    token: LinkToken
    verifier: Verifier
    wrapped_dek_pwd: WrappedKey
    kdf_version: str = Field(max_length=32)


class ConsentOut(BaseModel):
    """Принятая редакция одного документа."""

    kind: Literal["policy", "consent", "terms"]
    version: str
    accepted_at: datetime


class AccountOut(BaseModel):
    """Сведения об аккаунте — ровно те, что сервер о нём знает."""

    id: UUID
    email: str
    email_verified: bool
    created_at: datetime
    #: Нынешняя ревизия аккаунта: курсор для первой выборки изменений.
    rev: int
    #: Последняя принятая редакция каждого документа.
    consents: list[ConsentOut]
    #: Документы, на которые надо ответить заново: их редакция сменилась
    #: после того, как человек их принял. Пусто — спрашивать нечего.
    consent_pending: list[Literal["consent", "terms"]]


class SessionOut(BaseModel):
    """Ответ на регистрацию, вход и обновление токена.

    Refresh-токена здесь нет намеренно: он уходит в cookie с `HttpOnly`,
    то есть недоступен скриптам. Тело ответа читает скрипт — значит, в
    теле ему делать нечего.
    """

    access_token: str
    expires_in: int
    #: Обёртка ключа данных паролем. Приходит при входе и регистрации; при
    #: обновлении токена её не присылают — ключ уже в памяти вкладки.
    wrapped_dek_pwd: WrappedKey | None = None
    kdf: KdfParamsOut
    account: AccountOut
