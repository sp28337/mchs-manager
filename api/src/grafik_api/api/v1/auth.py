"""Ручки входа: параметры, регистрация, вход, обновление, выход.

HTTP и только HTTP: разобрать тело, позвать сервис, поставить cookie,
собрать ответ. Правила — в `services/auth.py`.

--- Почему refresh-токен в cookie, а access — в теле ----------------------

Их воруют по-разному. Access живёт 15 минут и лежит в памяти вкладки:
скрипт его видит, но и срок у него короткий. Refresh живёт месяц, и его
скрипт видеть не должен — поэтому он уходит в cookie с `HttpOnly`.

У cookie три ограничения, и каждое закрывает свою дыру:

* `HttpOnly` — внедрённый скрипт не прочитает;
* `Secure` — не уйдёт по открытому каналу (на `localhost` браузеры делают
  исключение, так что разработке это не мешает);
* `SameSite=Strict` — не поедет с чужого сайта, то есть подделка запроса
  между сайтами на пути `/auth` не сработает;
* `Path=/api/v1/auth` — не поедет даже в наши собственные запросы
  синхронизации: там он не нужен, а чем реже секрет в пути, тем лучше.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status

from grafik_api.api.deps import (
    AuthServiceDep,
    ClientIpDep,
    DeviceIdDep,
    check_rate,
    rate_limit,
)
from grafik_api.core.limits import LOGIN, PARAMS, RECOVER, REGISTER
from grafik_api.core.security import decode_wrapped, encode_wrapped
from grafik_api.schemas.auth import (
    AccountOut,
    ConsentOut,
    KdfParamsOut,
    LoginIn,
    ParamsIn,
    RecoverClaimIn,
    RecoverClaimOut,
    RecoverFinishIn,
    RecoverStartIn,
    RegisterIn,
    SessionOut,
    VerifyEmailIn,
)
from grafik_api.services.auth import SessionResult, normalize_email
from grafik_api.services.consents import pending as pending_consents

router = APIRouter(prefix="/auth", tags=["auth"])

#: Имя cookie с refresh-токеном.
COOKIE_NAME = "grafik_refresh"

#: Путь, по которому cookie вообще отправляется.
COOKIE_PATH = "/api/v1/auth"


@router.post(
    "/params",
    summary="Параметры вывода ключа до входа",
    dependencies=[Depends(rate_limit("auth.params", PARAMS))],
)
async def params(данные: ParamsIn, service: AuthServiceDep) -> KdfParamsOut:
    """Отдать параметры argon2 для этого адреса.

    Ответ одинаковой формы и для известного адреса, и для незнакомого:
    иначе эта ручка становится оракулом существования аккаунта.
    """
    return KdfParamsOut.of(await service.kdf_params(данные.email))


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    summary="Регистрация",
    dependencies=[Depends(rate_limit("auth.register", REGISTER))],
)
async def register(
    данные: RegisterIn,
    response: Response,
    service: AuthServiceDep,
    ip: ClientIpDep,
    device_id: DeviceIdDep,
) -> SessionOut:
    """Завести аккаунт и сразу открыть сессию."""
    результат = await service.register(
        email=данные.email,
        verifier=данные.verifier,
        wrapped_dek_pwd=decode_wrapped(данные.wrapped_dek_pwd),
        wrapped_dek_rec=decode_wrapped(данные.wrapped_dek_rec),
        kdf_version=данные.kdf_version,
        consent=данные.consent.given(),
        ip=ip,
        device_id=device_id,
    )

    _поставить_cookie(response, результат, service.settings.refresh_ttl_days)
    return _ответ(результат)


@router.post("/login", summary="Вход")
async def login(
    данные: LoginIn,
    request: Request,
    response: Response,
    service: AuthServiceDep,
    ip: ClientIpDep,
    device_id: DeviceIdDep,
) -> SessionOut:
    """Войти по адресу и проверочному значению.

    Предел попыток считается на пару (адрес, IP) — так перебор пароля
    одного человека не запирает вход остальным, а подбор с одного адреса
    упирается в счётчик. Ключ строится по присланному адресу, а не по
    найденному аккаунту: существование аккаунта и тут не раскрывается.
    """
    check_rate(
        request,
        f"auth.login:{normalize_email(данные.email)}:{ip or 'неизвестно'}",
        LOGIN,
    )

    результат = await service.login(
        email=данные.email,
        verifier=данные.verifier,
        ip=ip,
        device_id=device_id,
    )

    _поставить_cookie(response, результат, service.settings.refresh_ttl_days)
    return _ответ(результат)


@router.post("/refresh", summary="Обновить access-токен по cookie")
async def refresh(
    request: Request,
    response: Response,
    service: AuthServiceDep,
    ip: ClientIpDep,
    device_id: DeviceIdDep,
) -> SessionOut:
    """Обменять refresh-токен на новый.

    Ротация обязательна: предъявленный дважды токен означает утечку, и
    тогда гасится вся семья (раздел 6 контракта).
    """
    результат = await service.refresh(
        token=request.cookies.get(COOKIE_NAME),
        ip=ip,
        device_id=device_id,
    )

    _поставить_cookie(response, результат, service.settings.refresh_ttl_days)
    return _ответ(результат)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Выход")
async def logout(
    request: Request,
    response: Response,
    service: AuthServiceDep,
    ip: ClientIpDep,
) -> None:
    """Погасить семью токенов и забыть cookie.

    Отвечает одинаково на живой токен, на чужой и на его отсутствие:
    выход — не место для рассказа о том, был ли токен настоящим.
    """
    await service.logout(token=request.cookies.get(COOKIE_NAME), ip=ip)
    _убрать_cookie(response)


@router.post(
    "/verify-email",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Подтверждение адреса по ссылке из письма",
)
async def verify_email(
    данные: VerifyEmailIn, service: AuthServiceDep, ip: ClientIpDep
) -> None:
    """Отметить адрес подтверждённым.

    Негодная ссылка и чужая не различаются в ответе: знать, существовала
    ли ссылка, посторонним незачем.
    """
    await service.verify_email(token=данные.token, ip=ip)


@router.post(
    "/recover/start",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Письмо для восстановления доступа",
    dependencies=[Depends(rate_limit("auth.recover", RECOVER))],
)
async def recover_start(
    данные: RecoverStartIn, service: AuthServiceDep, ip: ClientIpDep
) -> None:
    """Отправить письмо, если такой адрес есть.

    Ответ один и тот же в любом случае — `202`. Иначе достаточно
    перебрать адреса, чтобы узнать, кто у нас есть.
    """
    await service.recover_start(email=данные.email, ip=ip)


@router.post(
    "/recover/claim",
    summary="Обёртка ключа восстановления по ссылке из письма",
)
async def recover_claim(
    данные: RecoverClaimIn, service: AuthServiceDep, ip: ClientIpDep
) -> RecoverClaimOut:
    """Отдать то, чем браузер развернёт ключ данных.

    Ссылка при этом не гасится: ею же человек завершит восстановление.
    Иначе браузер оказался бы в тупике — обёртку получил, а предъявить
    ссылку второй раз не может.
    """
    email, обёртка, параметры = await service.recover_claim(token=данные.token, ip=ip)

    return RecoverClaimOut(
        email=email, wrapped_dek_rec=обёртка, kdf=KdfParamsOut.of(параметры)
    )


@router.post(
    "/recover/finish",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Новый пароль после восстановления",
)
async def recover_finish(
    данные: RecoverFinishIn, service: AuthServiceDep, ip: ClientIpDep
) -> None:
    """Заменить пароль по ссылке из письма.

    Все сессии при этом гаснут: неизвестно, кто и почему терял доступ.
    """
    await service.recover_finish(
        token=данные.token,
        verifier=данные.verifier,
        wrapped_dek_pwd=decode_wrapped(данные.wrapped_dek_pwd),
        kdf_version=данные.kdf_version,
        ip=ip,
    )


def _поставить_cookie(response: Response, результат: SessionResult, дней: int) -> None:
    response.set_cookie(
        COOKIE_NAME,
        результат.refresh_token,
        max_age=дней * 24 * 60 * 60,
        path=COOKIE_PATH,
        httponly=True,
        secure=True,
        samesite="strict",
    )


def _убрать_cookie(response: Response) -> None:
    response.delete_cookie(
        COOKIE_NAME,
        path=COOKIE_PATH,
        httponly=True,
        secure=True,
        samesite="strict",
    )


def _ответ(результат: SessionResult) -> SessionOut:
    """Собрать ответ о сессии.

    Refresh-токена в теле нет: он только в cookie, недоступной скриптам.
    """
    user = результат.user

    согласия = [
        ConsentOut(
            kind=запись.kind, version=запись.version, accepted_at=запись.accepted_at
        )
        for запись in результат.consents
    ]

    return SessionOut(
        access_token=результат.access_token,
        expires_in=результат.expires_in,
        wrapped_dek_pwd=(
            encode_wrapped(результат.wrapped_dek_pwd)
            if результат.wrapped_dek_pwd is not None
            else None
        ),
        kdf=KdfParamsOut.of(результат.kdf),
        account=AccountOut(
            id=user.id,
            email=user.email,
            email_verified=user.email_verified_at is not None,
            created_at=user.created_at,
            rev=user.rev,
            consents=согласия,
            consent_pending=pending_consents(результат.consents),
        ),
    )
