"""Регистрация, вход, сессии.

Здесь живут правила, а не HTTP: сервис принимает значения и возвращает
значения, его можно позвать из теста без запроса и из команды без
веб-сервера.

--- Два правила, которые важнее удобства ----------------------------------

**Ответ не раскрывает существование аккаунта.** На неверное проверочное
значение и на незнакомый адрес ответ один — `bad_credentials`, и даже
время ответа одинаковое: при отсутствующем аккаунте проверка всё равно
выполняется, по заглушке.

**Токены живут семьями.** Каждое обновление выдаёт новый и помечает
прежний использованным. Предъявленный дважды токен означает, что копия
утекла, — тогда гасится вся семья. Иначе вор и хозяин ходили бы по
очереди, не замечая друг друга.
"""

from __future__ import annotations

import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.config import Settings
from grafik_api.core.errors import (
    BadCredentialsError,
    ConsentRequiredError,
    EmailTakenError,
    TokenExpiredError,
    TokenRevokedError,
    ValidationFailedError,
)
from grafik_api.core.legal import CURRENT_VERSIONS
from grafik_api.core.logging import get_logger
from grafik_api.core.security import (
    CURRENT_KDF,
    KDF_VERSIONS,
    KdfParams,
    hash_verifier,
    issue_access_token,
    needs_rehash,
    new_refresh_token,
    token_digest,
    verify_verifier,
)
from grafik_api.models import Consent, User
from grafik_api.repositories import (
    KIND_PWD,
    KIND_REC,
    AuditRepository,
    ConsentRepository,
    CredentialRepository,
    DataKeyRepository,
    RefreshTokenRepository,
    UserRepository,
)

logger = get_logger("service.auth")


def normalize_email(raw: str) -> str:
    """Привести адрес к единому виду: NFKC, без краёв, в нижнем регистре.

    Ровно то же делает браузер, прежде чем вывести из адреса соли
    (раздел 2.1 контракта). Разойдись эти две нормализации — и человек с
    адресом в другом регистре не войдёт по своему же паролю.
    """
    return unicodedata.normalize("NFKC", raw).strip().lower()


@dataclass(frozen=True)
class SessionResult:
    """Всё, что нужно отдать браузеру после успешного входа."""

    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime
    wrapped_dek_pwd: bytes | None
    kdf: KdfParams
    user: User
    consents: list[Consent]


class AuthService:
    """Правила входа и сессий."""

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.users = UserRepository(session)
        self.credentials = CredentialRepository(session)
        self.data_keys = DataKeyRepository(session)
        self.consents = ConsentRepository(session)
        self.tokens = RefreshTokenRepository(session)
        self.audit = AuditRepository(session)

    # --- Параметры до входа ------------------------------------------------

    async def kdf_params(self, email: str) -> KdfParams:
        """Параметры вывода ключа для этого адреса.

        Для известного аккаунта — его версия (он мог зарегистрироваться
        при старых параметрах), для незнакомого — нынешняя. Ответ
        одинаковой формы в обоих случаях: иначе это оракул существования
        аккаунта.
        """
        user = await self.users.by_email(normalize_email(email))

        if user is None:
            return CURRENT_KDF

        credential = await self.credentials.by_user(user.id)
        if credential is None:
            return CURRENT_KDF

        return KDF_VERSIONS.get(credential.kdf_version, CURRENT_KDF)

    # --- Регистрация ------------------------------------------------------

    async def register(
        self,
        *,
        email: str,
        verifier: str,
        wrapped_dek_pwd: bytes,
        wrapped_dek_rec: bytes,
        kdf_version: str,
        consent: dict[str, str],
        ip: str | None,
        device_id: str | None,
    ) -> SessionResult:
        """Завести аккаунт.

        Порядок проверок не случаен: сначала то, что не требует базы
        (версии параметров и документов), потом занятость адреса.
        """
        if kdf_version not in KDF_VERSIONS:
            raise ValidationFailedError(f"неизвестная версия параметров: {kdf_version}")

        self._проверить_согласие(consent)

        адрес = normalize_email(email)

        if await self.users.by_email(адрес) is not None:
            raise EmailTakenError()

        try:
            user = await self.users.create(адрес)
        except IntegrityError as error:
            # Две регистрации на один адрес могли прийти одновременно:
            # проверка выше их не ловит, ограничение в базе — ловит.
            raise EmailTakenError() from error

        await self.credentials.create(
            user.id,
            verifier_hash=hash_verifier(verifier, self.settings),
            kdf_version=kdf_version,
        )
        await self.data_keys.put(user.id, KIND_PWD, wrapped_dek_pwd)
        await self.data_keys.put(user.id, KIND_REC, wrapped_dek_rec)

        now = datetime.now(UTC)
        запись = self.consents.create(
            user_id=user.id,
            policy_version=consent["policy_version"],
            consent_version=consent["consent_version"],
            terms_version=consent["terms_version"],
            accepted_at=now,
            ip=ip,
        )

        self.audit.record("auth.register", user_id=user.id, ip=ip, at=now)
        logger.info(
            "аккаунт заведён", extra={"event": "auth.register", "user_id": str(user.id)}
        )

        return await self._открыть_сессию(
            user,
            wrapped_dek_pwd=wrapped_dek_pwd,
            kdf_version=kdf_version,
            device_id=device_id,
            consents=[запись],
            now=now,
        )

    # --- Вход -------------------------------------------------------------

    async def login(
        self,
        *,
        email: str,
        verifier: str,
        ip: str | None,
        device_id: str | None,
    ) -> SessionResult:
        """Войти по адресу и проверочному значению."""
        адрес = normalize_email(email)
        user = await self.users.by_email(адрес)
        credential = await self.credentials.by_user(user.id) if user else None

        # Проверка выполняется всегда — даже когда аккаунта нет. Иначе
        # время ответа подсказывает, есть ли такой адрес.
        подошло = verify_verifier(
            credential.verifier_hash if credential else None, verifier, self.settings
        )

        if user is None or credential is None or not подошло:
            self.audit.record(
                "auth.login.failed",
                user_id=user.id if user else None,
                ip=ip,
                # Адреса здесь нет намеренно: журнал не должен хранить
                # перечень адресов, по которым стучались.
                details={"reason": "bad_credentials"},
            )
            logger.info(
                "вход не удался",
                extra={
                    "event": "auth.login.failed",
                    "user_id": str(user.id) if user else "-",
                },
            )
            await self._зафиксировать_до_отказа()
            raise BadCredentialsError()

        if needs_rehash(credential.verifier_hash):
            # Параметры в коде стали строже — пересчитываем тихо, пока
            # значение всё равно на руках.
            credential.verifier_hash = hash_verifier(verifier, self.settings)

        now = datetime.now(UTC)
        self.audit.record("auth.login.ok", user_id=user.id, ip=ip, at=now)
        logger.info("вход", extra={"event": "auth.login.ok", "user_id": str(user.id)})

        обёртки = await self.data_keys.by_user(user.id)

        return await self._открыть_сессию(
            user,
            wrapped_dek_pwd=обёртки.get(KIND_PWD),
            kdf_version=credential.kdf_version,
            device_id=device_id,
            consents=await self._согласия(user.id),
            now=now,
        )

    # --- Обновление и выход -----------------------------------------------

    async def refresh(
        self, *, token: str | None, ip: str | None, device_id: str | None
    ) -> SessionResult:
        """Обменять refresh-токен на новый и выдать access."""
        if not token:
            raise BadCredentialsError("нет refresh-токена")

        строка = await self.tokens.by_digest(token_digest(token))

        if строка is None:
            raise BadCredentialsError("неизвестный refresh-токен")

        now = datetime.now(UTC)

        if строка.revoked_at is not None:
            raise TokenRevokedError()

        if строка.used_at is not None:
            # Токен предъявлен дважды — значит, копия утекла. Гасим всю
            # семью: пусть войдут заново и оба, и вор останется ни с чем.
            погашено = await self.tokens.revoke_family(строка.family_id, now)
            self.audit.record(
                "auth.refresh.reuse",
                user_id=строка.user_id,
                ip=ip,
                details={"revoked": погашено},
                at=now,
            )
            logger.warning(
                "повторное использование refresh-токена: семья погашена",
                extra={
                    "event": "auth.refresh.reuse",
                    "user_id": str(строка.user_id),
                    "revoked": погашено,
                },
            )
            await self._зафиксировать_до_отказа()
            raise TokenRevokedError()

        if строка.expires_at <= now:
            raise TokenExpiredError()

        строка.used_at = now

        user = await self.users.get(строка.user_id)
        if user is None:  # pragma: no cover - каскад удаляет токены вместе с аккаунтом
            raise BadCredentialsError()

        credential = await self.credentials.by_user(user.id)

        return await self._открыть_сессию(
            user,
            # Обёртку при обновлении не присылаем: ключ уже в памяти
            # вкладки, а лишняя копия секрета в ответе ни к чему.
            wrapped_dek_pwd=None,
            kdf_version=(
                credential.kdf_version if credential else CURRENT_KDF.kdf_version
            ),
            device_id=device_id or строка.device_id,
            consents=await self._согласия(user.id),
            now=now,
            family_id=строка.family_id,
        )

    async def logout(self, *, token: str | None, ip: str | None) -> None:
        """Погасить семью токенов.

        Отвечает одинаково и на живой токен, и на чужой, и на отсутствие:
        выход — не то место, где стоит рассказывать, был ли токен настоящим.
        """
        if not token:
            return

        строка = await self.tokens.by_digest(token_digest(token))
        if строка is None:
            return

        now = datetime.now(UTC)
        await self.tokens.revoke_family(строка.family_id, now)
        self.audit.record("auth.logout", user_id=строка.user_id, ip=ip, at=now)
        logger.info(
            "выход", extra={"event": "auth.logout", "user_id": str(строка.user_id)}
        )

    # --- Внутреннее -------------------------------------------------------

    async def _зафиксировать_до_отказа(self) -> None:
        """Зафиксировать то, что должно пережить отказ.

        Исключение из правила «фиксация на границе запроса» (шаг 6), и
        единственное. Доменная ошибка откатывает транзакцию запроса —
        это правильно для данных, но неправильно для двух вещей:

        * **записи о неудачной попытке входа**: журнал событий
          безопасности для того и нужен, чтобы в нём остались именно
          отказы (ч. 1 ст. 19 152-ФЗ);
        * **погашения семьи токенов при краже**: откат вернул бы вору
          рабочий токен, а отказ в ответе оказался бы пустым обещанием.

        Поэтому здесь фиксация делается до `raise`. Дальнейший откат
        зависимости становится пустым действием.
        """
        await self.session.commit()

    def _проверить_согласие(self, consent: dict[str, str]) -> None:
        """Приняты ли действующие редакции документов.

        Старая редакция — не отказ навсегда: приложение покажет новый
        текст и спросит заново.
        """
        устарело = {
            вид: версия
            for вид, версия in (
                ("policy", consent["policy_version"]),
                ("consent", consent["consent_version"]),
                ("terms", consent["terms_version"]),
            )
            if версия != CURRENT_VERSIONS[вид]
        }

        if устарело:
            raise ConsentRequiredError(
                "приняты не действующие редакции документов",
                current=CURRENT_VERSIONS,
            )

    async def _согласия(self, user_id: uuid.UUID) -> list[Consent]:
        запись = await self.consents.latest(user_id)
        return [запись] if запись else []

    async def _открыть_сессию(
        self,
        user: User,
        *,
        wrapped_dek_pwd: bytes | None,
        kdf_version: str,
        device_id: str | None,
        consents: list[Consent],
        now: datetime,
        family_id: uuid.UUID | None = None,
    ) -> SessionResult:
        """Выдать пару токенов.

        `family_id` передаётся при обновлении: новый токен остаётся в той
        же семье, и кража в любом её звене гасит цепочку целиком.
        """
        token, digest = new_refresh_token()
        истекает = now + timedelta(days=self.settings.refresh_ttl_days)

        self.tokens.create(
            user_id=user.id,
            family_id=family_id or uuid.uuid4(),
            digest=digest,
            device_id=device_id,
            issued_at=now,
            expires_at=истекает,
        )

        access, срок = issue_access_token(user.id, self.settings)

        return SessionResult(
            access_token=access,
            expires_in=срок,
            refresh_token=token,
            refresh_expires_at=истекает,
            wrapped_dek_pwd=wrapped_dek_pwd,
            kdf=KDF_VERSIONS.get(kdf_version, CURRENT_KDF),
            user=user,
            consents=consents,
        )
