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
    EmailTakenError,
    ServiceUnavailableError,
    TokenExpiredError,
    TokenRevokedError,
    ValidationFailedError,
)
from grafik_api.core.logging import get_logger
from grafik_api.core.mail import (
    Mailer,
    NullMailer,
    recovery_letter,
    verify_letter,
)
from grafik_api.core.security import (
    CURRENT_KDF,
    KDF_VERSIONS,
    KdfParams,
    encode_wrapped,
    hash_verifier,
    issue_access_token,
    needs_rehash,
    new_refresh_token,
    token_digest,
    verify_verifier,
)
from grafik_api.models import Consent, OneTimeToken, User
from grafik_api.repositories import (
    KIND_PWD,
    KIND_REC,
    AuditRepository,
    ConsentRepository,
    CredentialRepository,
    DataKeyRepository,
    OneTimeTokenRepository,
    RefreshTokenRepository,
    UserRepository,
)
from grafik_api.services.consents import (
    PERSONAL_DATA,
    TERMS_AND_POLICY,
    ConsentGiven,
)
from grafik_api.services.consents import check as check_consent
from grafik_api.services.consents import record as record_consents

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

    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        mailer: Mailer | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        # Без отправщика сервис работает, только писем не будет: так его
        # можно позвать из команды, которой почта не нужна.
        self.mailer = mailer or NullMailer()
        self.users = UserRepository(session)
        self.credentials = CredentialRepository(session)
        self.data_keys = DataKeyRepository(session)
        self.consents = ConsentRepository(session)
        self.tokens = RefreshTokenRepository(session)
        self.links = OneTimeTokenRepository(session)
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
        consent: ConsentGiven,
        ip: str | None,
        device_id: str | None,
    ) -> SessionResult:
        """Завести аккаунт.

        Порядок проверок не случаен: сначала то, что не требует базы
        (версии параметров и документов), потом занятость адреса.
        """
        if kdf_version not in KDF_VERSIONS:
            raise ValidationFailedError(f"неизвестная версия параметров: {kdf_version}")

        check_consent(consent)

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
        # Два действия — две записи по документам: соглашение с политикой и
        # отдельно согласие на обработку (ч. 1 ст. 9 152-ФЗ). Время и адрес у
        # них общие по существу: оба совершены одним нажатием.
        записи = record_consents(
            self.consents,
            user_id=user.id,
            kinds=(*TERMS_AND_POLICY, *PERSONAL_DATA),
            via="registration",
            accepted_at=now,
            ip=ip,
        )

        self.audit.record(
            "auth.register",
            user_id=user.id,
            ip=ip,
            details={"device_id": device_id},
            at=now,
        )
        await self._послать_подтверждение(user, now)
        logger.info(
            "аккаунт заведён", extra={"event": "auth.register", "user_id": str(user.id)}
        )

        return await self._открыть_сессию(
            user,
            wrapped_dek_pwd=wrapped_dek_pwd,
            kdf_version=kdf_version,
            device_id=device_id,
            consents=записи,
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
        self.audit.record(
            "auth.login.ok",
            user_id=user.id,
            ip=ip,
            details={"device_id": device_id},
            at=now,
        )
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

    # --- Подтверждение адреса --------------------------------------------

    async def verify_email(self, *, token: str, ip: str | None) -> None:
        """Подтвердить адрес по ссылке из письма."""
        ссылка = await self._взять_ссылку(token, purpose="verify_email")
        now = datetime.now(UTC)

        user = await self.users.get(ссылка.user_id)
        if user is None:  # pragma: no cover - каскад уносит ссылки с аккаунтом
            raise TokenRevokedError()

        ссылка.used_at = now
        if user.email_verified_at is None:
            user.email_verified_at = now

        self.audit.record("auth.email.verified", user_id=user.id, ip=ip, at=now)
        logger.info(
            "адрес подтверждён",
            extra={"event": "auth.email.verified", "user_id": str(user.id)},
        )

    # --- Восстановление доступа -------------------------------------------

    async def recover_start(self, *, email: str, ip: str | None) -> None:
        """Отправить письмо для восстановления доступа.

        Ответ у ручки один и тот же, есть такой адрес или нет: иначе
        достаточно перебрать адреса, чтобы узнать, кто у нас есть.
        Поэтому и здесь ничего не возвращается — ни успеха, ни отказа.
        """
        user = await self.users.by_email(normalize_email(email))

        if user is None:
            logger.info(
                "восстановление запрошено для незнакомого адреса",
                extra={"event": "auth.recover.unknown"},
            )
            return

        now = datetime.now(UTC)
        токен, digest = new_refresh_token()
        self.links.create(
            user_id=user.id,
            purpose="recover",
            digest=digest,
            created_at=now,
            expires_at=now + timedelta(hours=self.settings.link_ttl_hours),
        )

        self.audit.record("auth.recover.started", user_id=user.id, ip=ip, at=now)

        try:
            await self.mailer.send(recovery_letter(user.email, токен, self.settings))
        except ServiceUnavailableError:
            # Ответ обязан быть одним и тем же, есть такой адрес или нет
            # (раздел 6 контракта). Отдай мы здесь `503`, а незнакомому
            # адресу — `202`, и разница в ответах стала бы способом
            # узнать, кто у нас есть: достаточно дождаться, когда почта
            # сломается. Отправщик уже записал неисправность в журнал,
            # ссылка в базе останется и протухнет сама через сутки.
            logger.warning(
                "письмо для восстановления не ушло",
                extra={"event": "auth.recover.mail_failed", "user_id": str(user.id)},
            )

    async def recover_claim(
        self, *, token: str, ip: str | None
    ) -> tuple[str, str, KdfParams]:
        """Отдать обёртку ключа восстановления по ссылке из письма.

        Ссылка при этом **не гасится**: ею же человек завершит
        восстановление (`recover_finish`). Иначе браузер оказался бы в
        тупике — обёртку он получил, а предъявить ссылку второй раз не
        может.

        Отдавать обёртку тому, кто предъявил ссылку, безопасно: она
        бесполезна без самого ключа восстановления — 128 бит, которые
        человек переписал на бумагу при регистрации. Сервер этого ключа
        не видел ни разу и развернуть обёртку не может сам.

        Адрес почты в ответе — не разглашение: ссылку из письма держит
        тот, кто это письмо прочитал, то есть владелец ящика.
        """
        ссылка = await self._взять_ссылку(token, purpose="recover")
        now = datetime.now(UTC)

        user = await self.users.get(ссылка.user_id)
        if user is None:  # pragma: no cover - каскад уносит ссылки с аккаунтом
            raise TokenRevokedError()

        обёртки = await self.data_keys.by_user(user.id)
        обёртка = обёртки.get(KIND_REC)
        if обёртка is None:  # pragma: no cover - аккаунт без обёрток
            raise TokenRevokedError()

        credential = await self.credentials.by_user(user.id)
        параметры = KDF_VERSIONS.get(
            credential.kdf_version if credential else CURRENT_KDF.kdf_version,
            CURRENT_KDF,
        )

        self.audit.record("auth.recover.claimed", user_id=user.id, ip=ip, at=now)
        logger.info(
            "обёртка ключа восстановления отдана",
            extra={"event": "auth.recover.claimed", "user_id": str(user.id)},
        )

        return user.email, encode_wrapped(обёртка), параметры

    async def recover_finish(
        self,
        *,
        token: str,
        verifier: str,
        wrapped_dek_pwd: bytes,
        kdf_version: str,
        ip: str | None,
    ) -> None:
        """Задать новый пароль по ссылке из письма.

        Ключ восстановления на сервер не приходит: браузер развернул им
        ключ данных сам и присылает новую обёртку. Сервер проверяет только
        токен из письма — больше ему проверять нечем.
        """
        if kdf_version not in KDF_VERSIONS:
            raise ValidationFailedError(f"неизвестная версия параметров: {kdf_version}")

        ссылка = await self._взять_ссылку(token, purpose="recover")
        now = datetime.now(UTC)

        user = await self.users.get(ссылка.user_id)
        if user is None:  # pragma: no cover - каскад уносит ссылки с аккаунтом
            raise TokenRevokedError()

        credential = await self.credentials.by_user(user.id)
        if credential is None:  # pragma: no cover - аккаунт без доступа
            raise TokenRevokedError()

        credential.verifier_hash = hash_verifier(verifier, self.settings)
        credential.kdf_version = kdf_version
        await self.data_keys.put(user.id, KIND_PWD, wrapped_dek_pwd)

        ссылка.used_at = now
        # Все сессии гаснут: неизвестно, кто и почему терял доступ.
        погашено = await self.tokens.revoke_all(user.id, now)

        self.audit.record(
            "auth.recover.finished",
            user_id=user.id,
            ip=ip,
            details={"revoked": погашено},
            at=now,
        )
        logger.info(
            "доступ восстановлен",
            extra={
                "event": "auth.recover.finished",
                "user_id": str(user.id),
                "revoked": погашено,
            },
        )

    # --- Внутреннее -------------------------------------------------------

    async def _послать_подтверждение(self, user: User, now: datetime) -> None:
        """Завести ссылку подтверждения и отправить письмо."""
        токен, digest = new_refresh_token()

        self.links.create(
            user_id=user.id,
            purpose="verify_email",
            digest=digest,
            created_at=now,
            expires_at=now + timedelta(hours=self.settings.link_ttl_hours),
        )

        await self.mailer.send(verify_letter(user.email, токен, self.settings))

    async def _взять_ссылку(self, token: str, *, purpose: str) -> OneTimeToken:
        """Найти живую одноразовую ссылку или отказать.

        Негодную ссылку от чужой не отличаем в ответе: `token_revoked` и
        там, и там. Знать, существовала ли ссылка, посторонним незачем.
        """
        ссылка = await self.links.by_digest(token_digest(token))

        if ссылка is None or ссылка.purpose != purpose or ссылка.used_at is not None:
            raise TokenRevokedError()

        if ссылка.expires_at <= datetime.now(UTC):
            raise TokenExpiredError()

        return ссылка

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

    async def _согласия(self, user_id: uuid.UUID) -> list[Consent]:
        """Последняя принятая редакция каждого документа."""
        return await self.consents.latest_per_kind(user_id)

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
