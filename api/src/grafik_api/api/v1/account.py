"""Ручки аккаунта: сведения, выгрузка, смена пароля, удаление.

Три из четырёх — права человека по 152-ФЗ, а не удобства: узнать, что о
нём есть (ст. 14), получить копию, отозвать согласие и удалить (ч. 2 ст. 9,
ст. 21). Поэтому они работают сразу и без переписки с оператором: ждать
ответа на письмо, чтобы забрать свои же данные, — это не исполнение права,
а его имитация.

Отзыв согласия отдельной ручки не имеет намеренно: без адреса почты и
обёрток ключа аккаунт не существует, поэтому отзыв — это и есть удаление.
Так написано и в политике, и в тексте согласия.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from grafik_api.api.deps import (
    AccountServiceDep,
    ClientIpDep,
    CurrentUserDep,
    DeviceIdDep,
    check_rate,
)
from grafik_api.api.v1.auth import COOKIE_NAME, COOKIE_PATH
from grafik_api.core.limits import EXPORT, SENSITIVE
from grafik_api.core.security import decode_wrapped
from grafik_api.schemas.account import (
    AccountOut,
    ConsentRenewalIn,
    DeleteIn,
    ExportOut,
    PasswordIn,
)

router = APIRouter(prefix="/account", tags=["account"])


@router.get("", summary="Сведения об аккаунте")
async def info(user_id: CurrentUserDep, service: AccountServiceDep) -> AccountOut:
    """Что сервер знает об этом аккаунте."""
    return AccountOut.of(await service.info(user_id))


@router.post("/consents", summary="Принять обновлённое согласие")
async def accept_consents(
    данные: ConsentRenewalIn,
    user_id: CurrentUserDep,
    service: AccountServiceDep,
    ip: ClientIpDep,
) -> AccountOut:
    """Принять действующую редакцию согласия заново.

    Нужна, когда текст согласия изменился после регистрации: старое согласие
    относится к старому тексту (ч. 1 ст. 9 152-ФЗ). Одна отметка, и отказ без
    неё. Записывается только устаревшее; повтор ничего не меняет.
    """
    return AccountOut.of(await service.accept_consent(user_id, данные.given(), ip=ip))


@router.get("/export", summary="Выгрузка всего, что о человеке есть")
async def export(
    request: Request,
    user_id: CurrentUserDep,
    service: AccountServiceDep,
    ip: ClientIpDep,
) -> ExportOut:
    """Один файл со всем, что хранится.

    Блобы — как есть, зашифрованными: расшифровать их может только
    владелец. Это не ущербность выгрузки, а её свойство — файл можно
    хранить где угодно, он бесполезен без пароля.
    """
    check_rate(request, f"export:{user_id}", EXPORT)

    return ExportOut.of(await service.export(user_id, ip=ip))


@router.post(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Смена пароля",
)
async def change_password(
    данные: PasswordIn,
    request: Request,
    user_id: CurrentUserDep,
    service: AccountServiceDep,
    ip: ClientIpDep,
    device_id: DeviceIdDep,
) -> None:
    """Заменить пароль, не перешифровывая данные.

    Прочие сессии гаснут: если пароль меняют из-за того, что его узнали,
    чужая сессия не должна его пережить.
    """
    check_rate(request, f"password:{user_id}", SENSITIVE)

    await service.change_password(
        user_id,
        current_verifier=данные.current_verifier,
        verifier=данные.verifier,
        wrapped_dek_pwd=decode_wrapped(данные.wrapped_dek_pwd),
        wrapped_dek_rec=(
            decode_wrapped(данные.wrapped_dek_rec)
            if данные.wrapped_dek_rec is not None
            else None
        ),
        kdf_version=данные.kdf_version,
        device_id=device_id,
        ip=ip,
    )


@router.delete(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить аккаунт со всеми данными",
)
async def delete(
    данные: DeleteIn,
    request: Request,
    response: Response,
    user_id: CurrentUserDep,
    service: AccountServiceDep,
    ip: ClientIpDep,
) -> None:
    """Уничтожить аккаунт: блобы, историю, обёртки, адрес, согласия, журнал.

    Остаётся одна обезличенная строка аудита — ею оператор подтверждает,
    что удаление исполнено. Резервные копии догоняют удаление по своему
    сроку (30 дней), и в политике это сказано прямо.
    """
    check_rate(request, f"delete:{user_id}", SENSITIVE)

    await service.delete(user_id, verifier=данные.verifier, ip=ip)

    # Браузеру незачем держать cookie от аккаунта, которого больше нет.
    response.delete_cookie(
        COOKIE_NAME,
        path=COOKIE_PATH,
        httponly=True,
        secure=True,
        samesite="strict",
    )
