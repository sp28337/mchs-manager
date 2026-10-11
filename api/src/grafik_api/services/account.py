"""Права субъекта персональных данных и смена пароля.

Четыре действия, и три из них — права, которые закон даёт человеку, а не
удобства, которые мы придумали:

* **узнать, что о нём есть** (ст. 14 152-ФЗ) — сведения об аккаунте;
* **получить копию** — выгрузка одним файлом;
* **отозвать согласие и удалить** (ч. 2 ст. 9, ст. 21) — удаление аккаунта.

Четвёртое — смена пароля, и она здесь потому, что в нашей схеме это тоже
работа с ключами: пароль шифрует не данные, а обёртку ключа данных,
поэтому меняется не всё, а тридцать два байта.

--- Удаление: что именно уничтожается -------------------------------------

Всё. Блобы, история, обёртки ключей, адрес почты, согласия, сессии,
журнал входов. Остаётся одна обезличенная строка аудита — «аккаунт
`<uuid>` удалён» — и по ней человека определить нельзя: адреса в базе уже
нет. Ею же оператор подтверждает, что удаление было исполнено.

Резервные копии догоняют удаление по своему сроку (30 дней) — это прямо
сказано в политике, и обещать мгновенное стирание из копий значило бы
обещать невыполнимое.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.config import Settings
from grafik_api.core.errors import BadCredentialsError, ValidationFailedError
from grafik_api.core.logging import get_logger
from grafik_api.core.security import KDF_VERSIONS, hash_verifier, verify_verifier
from grafik_api.models import Consent, Credential, User
from grafik_api.repositories import (
    KIND_PWD,
    KIND_REC,
    AuditRepository,
    BlobRepository,
    ConsentRepository,
    CredentialRepository,
    DataKeyRepository,
    RefreshTokenRepository,
    UserRepository,
)
from grafik_api.services.sync import Item

logger = get_logger("service.account")


@dataclass(frozen=True)
class ConsentRecord:
    """Принятая редакция одного документа."""

    kind: str
    version: str
    accepted_at: datetime


@dataclass(frozen=True)
class AccountInfo:
    """Что сервер знает об аккаунте."""

    id: uuid.UUID
    email: str
    email_verified: bool
    created_at: datetime
    rev: int
    items: int
    bytes: int
    consents: list[ConsentRecord]


@dataclass(frozen=True)
class SignIn:
    """Строка журнала событий безопасности."""

    at: datetime
    event: str
    ip: str | None
    device_id: str | None


@dataclass(frozen=True)
class ExportData:
    """Выгрузка: всё, что о человеке есть, одним куском."""

    account: AccountInfo
    items: list[Item]
    consents: list[ConsentRecord]
    sign_ins: list[SignIn]
    exported_at: datetime


def согласия(записи: Sequence[Consent]) -> list[ConsentRecord]:
    """Разложить запись о согласии на три документа.

    В базе это одна строка с тремя версиями — так её проще доказывать. А
    человеку показывают три документа, потому что их три.
    """
    разложено: list[ConsentRecord] = []

    for запись in записи:
        for вид, версия in (
            ("policy", запись.policy_version),
            ("consent", запись.consent_version),
            ("terms", запись.terms_version),
        ):
            разложено.append(
                ConsentRecord(kind=вид, version=версия, accepted_at=запись.accepted_at)
            )

    return разложено


class AccountService:
    """Права субъекта и смена пароля."""

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.users = UserRepository(session)
        self.credentials = CredentialRepository(session)
        self.data_keys = DataKeyRepository(session)
        self.consents = ConsentRepository(session)
        self.blobs = BlobRepository(session)
        self.tokens = RefreshTokenRepository(session)
        self.audit = AuditRepository(session)

    # --- Сведения ---------------------------------------------------------

    async def info(self, user_id: uuid.UUID) -> AccountInfo:
        """Что о человеке есть (ст. 14 152-ФЗ)."""
        user = await self._взять(user_id)
        элементов, байтов = await self.blobs.usage(user_id)

        return AccountInfo(
            id=user.id,
            email=user.email,
            email_verified=user.email_verified_at is not None,
            created_at=user.created_at,
            rev=user.rev,
            items=элементов,
            bytes=байтов,
            consents=согласия(await self.consents.all_of(user_id)),
        )

    # --- Выгрузка ---------------------------------------------------------

    async def export(self, user_id: uuid.UUID, *, ip: str | None = None) -> ExportData:
        """Копия всего, что о человеке есть.

        Блобы уходят как есть — зашифрованными. Расшифровать их может
        только владелец, и это не ущербность выгрузки, а её свойство:
        файл можно хранить где угодно, он бесполезен без пароля.

        Сама выгрузка попадает в журнал событий безопасности: вынос всех
        данных аккаунта наружу — именно то событие, по которому человек
        потом поймёт, что в аккаунт заходили не он. Так это и обещано в
        политике (раздел о журнале входов и операций).
        """
        сведения = await self.info(user_id)
        строки = await self.blobs.all_of(user_id)
        события = await self.audit.all_of(user_id)

        self.audit.record(
            "account.exported",
            user_id=user_id,
            ip=ip,
            details={"items": сведения.items, "bytes": сведения.bytes},
        )
        logger.info(
            "выгрузка отдана",
            extra={
                "event": "account.exported",
                "user_id": str(user_id),
                "items": сведения.items,
            },
        )

        return ExportData(
            account=сведения,
            items=[Item.of(строка) for строка in строки],
            consents=сведения.consents,
            sign_ins=[
                SignIn(
                    at=событие.at,
                    event=событие.event,
                    ip=событие.ip,
                    device_id=(событие.details or {}).get("device_id"),
                )
                for событие in события
            ],
            exported_at=datetime.now(UTC),
        )

    # --- Удаление ---------------------------------------------------------

    async def delete(
        self, user_id: uuid.UUID, *, verifier: str, ip: str | None
    ) -> None:
        """Удалить аккаунт со всеми данными.

        Проверочное значение спрашиваем не из недоверия: украденного
        access-токена не должно хватать, чтобы стереть человеку год
        работы.
        """
        user = await self._взять(user_id)
        await self._сверить(user, verifier, событие="account.delete.failed", ip=ip)

        элементов, байтов = await self.blobs.usage(user_id)
        now = datetime.now(UTC)

        # Сначала журнал: он не связан с аккаунтом внешним ключом и
        # каскадом не удалится.
        стёрто = await self.audit.forget(user_id)
        await self.users.delete(user)
        await self.session.flush()

        # Единственная строка, которая остаётся. Подробности —
        # обезличенные счётчики: по ним видно, что удалять было что.
        self.audit.record(
            "account.deleted",
            user_id=user_id,
            ip=ip,
            details={"items": элементов, "bytes": байтов, "log_rows": стёрто},
            at=now,
        )

        logger.info(
            "аккаунт удалён",
            extra={
                "event": "account.deleted",
                "user_id": str(user_id),
                "items": элементов,
            },
        )

    # --- Смена пароля -----------------------------------------------------

    async def change_password(
        self,
        user_id: uuid.UUID,
        *,
        current_verifier: str,
        verifier: str,
        wrapped_dek_pwd: bytes,
        wrapped_dek_rec: bytes | None,
        kdf_version: str,
        device_id: str | None,
        ip: str | None,
    ) -> None:
        """Заменить пароль, не перешифровывая данные.

        Пароль шифрует обёртку ключа данных, а не сами данные, — поэтому
        смена стоит перешифровки тридцати двух байт. Делает её браузер и
        присылает готовую обёртку; сервер её только кладёт на место.
        """
        if kdf_version not in KDF_VERSIONS:
            raise ValidationFailedError(f"неизвестная версия параметров: {kdf_version}")

        user = await self._взять(user_id)
        credential = await self._сверить(
            user, current_verifier, событие="account.password.failed", ip=ip
        )

        credential.verifier_hash = hash_verifier(verifier, self.settings)
        credential.kdf_version = kdf_version
        await self.data_keys.put(user_id, KIND_PWD, wrapped_dek_pwd)

        if wrapped_dek_rec is not None:
            # Человек заодно перевыпустил ключ восстановления.
            await self.data_keys.put(user_id, KIND_REC, wrapped_dek_rec)

        now = datetime.now(UTC)
        # Прочие сессии гаснут: если пароль меняют из-за того, что его
        # узнали, чужая сессия не должна его пережить. То устройство, на
        # котором меняли, остаётся в деле.
        погашено = await self.tokens.revoke_all(user_id, now, keep_device=device_id)

        self.audit.record(
            "account.password.changed",
            user_id=user_id,
            ip=ip,
            details={
                "revoked": погашено,
                "recovery_rewrapped": wrapped_dek_rec is not None,
            },
            at=now,
        )

        logger.info(
            "пароль заменён",
            extra={
                "event": "account.password.changed",
                "user_id": str(user_id),
                "revoked": погашено,
            },
        )

    # --- Внутреннее -------------------------------------------------------

    async def _взять(self, user_id: uuid.UUID) -> User:
        user = await self.users.get(user_id)

        if user is None:  # pragma: no cover - токен живёт меньше аккаунта
            raise BadCredentialsError()

        return user

    async def _сверить(
        self, user: User, verifier: str, *, событие: str, ip: str | None
    ) -> Credential:
        """Проверить проверочное значение перед опасным действием.

        Проверка выполняется и когда доступа нет вовсе: время ответа не
        должно подсказывать, в каком состоянии аккаунт.
        """
        credential = await self.credentials.by_user(user.id)
        подошло = verify_verifier(
            credential.verifier_hash if credential else None, verifier, self.settings
        )

        if credential is None or not подошло:
            self.audit.record(событие, user_id=user.id, ip=ip)
            # Запись об отказе обязана пережить сам отказ.
            await self.session.commit()
            raise BadCredentialsError()

        return credential
