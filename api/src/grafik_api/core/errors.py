"""Доменные ошибки: то, что приложение умеет объяснить человеку.

Форма ответа — `application/problem+json` по RFC 9457, и в нём главное не
текст, а машинный код: текст человеку рисует фронт на своём языке, а по
коду он решает, что делать (перелогинить, показать конфликт, подождать и
повторить). Перечень кодов — раздел 6 контракта, и он закрытый: новый код
это правка контракта, а не выдумка на месте.

Почему статус живёт прямо в исключении. Код и статус — часть контракта
ошибки, а не деталь транспорта: `rev_conflict` это всегда 409, и держать
это соответствие в отдельной таблице значит однажды её разойтись. Ничего
другого про HTTP эти классы не знают — ни заголовков, ни тела, ни запроса.

Отдельное правило, которое важнее формата: **ответ об ошибке не раскрывает
существование аккаунта**. На неверный пароль и на незнакомый адрес ответ
один и тот же — `bad_credentials`.

Кода расхождения ревизий здесь нет намеренно. Расхождение — не ошибка
запроса: `POST /sync` отвечает `200` и приносит нынешнее состояние
разошедшихся элементов списком, чтобы клиент слил их и повторил. Ошибкой
это сделать значило бы отвергать всю отправку из-за одного профиля.
"""

from __future__ import annotations

from typing import Any, Literal

# Коды из раздела 6 контракта. `not_found`, `method_not_allowed` и
# `service_unavailable` добавлены к ним за то, что их умеет вернуть сам
# веб-сервер: ответ в чужом формате на незнакомый путь заставил бы клиента
# разбирать два вида ошибок вместо одного.
ProblemCode = Literal[
    "validation_failed",
    "email_taken",
    "bad_credentials",
    "email_not_verified",
    "token_expired",
    "token_revoked",
    "consent_required",
    "resync_required",
    "item_too_large",
    "quota_exceeded",
    "rate_limited",
    "not_found",
    "method_not_allowed",
    "service_unavailable",
    "internal_error",
]

# Адрес с объяснением кода. Страниц по этим адресам пока нет; RFC 9457
# этого и не требует («SHOULD»), но держать `type` осмысленным дешевле
# сейчас, чем менять формат ошибок потом.
PROBLEM_BASE = "https://grafik13.ru/problems/"


def problem_type(code: str) -> str:
    """Адрес описания кода: `rev_conflict` → `…/problems/rev-conflict`."""
    return PROBLEM_BASE + code.replace("_", "-")


class DomainError(Exception):
    """Ошибка, про которую приложение знает, что она значит.

    Всё, что не наследуется от неё, — непредвиденное, и наружу уходит как
    `internal_error` без подробностей: подробности идут в журнал, а не
    человеку.
    """

    code: ProblemCode = "internal_error"
    status: int = 500
    title: str = "Внутренняя ошибка"

    def __init__(self, detail: str | None = None, **extra: Any) -> None:
        super().__init__(detail or self.title)
        self.detail = detail
        # Дополнительные члены документа об ошибке (RFC 9457 их разрешает):
        # нынешний элемент при конфликте ревизий, `min_rev_available` при
        # требовании полной выборки, `retry_after` при лимите.
        self.extra = extra


class ValidationFailedError(DomainError):
    code = "validation_failed"
    status = 422
    title = "Тело запроса не прошло проверку"


class EmailTakenError(DomainError):
    code = "email_taken"
    status = 409
    title = "Адрес уже занят"


class BadCredentialsError(DomainError):
    code = "bad_credentials"
    status = 401
    title = "Неверный адрес или пароль"


class EmailNotVerifiedError(DomainError):
    code = "email_not_verified"
    status = 403
    title = "Адрес не подтверждён"


class TokenExpiredError(DomainError):
    code = "token_expired"
    status = 401
    title = "Токен протух"


class TokenRevokedError(DomainError):
    code = "token_revoked"
    status = 401
    title = "Токен отозван"


class ConsentRequiredError(DomainError):
    code = "consent_required"
    status = 403
    title = "Нужно согласие с новой редакцией документов"


class ResyncRequiredError(DomainError):
    code = "resync_required"
    status = 409
    title = "История не полна, нужна выборка с нуля"


class ItemTooLargeError(DomainError):
    code = "item_too_large"
    status = 413
    title = "Элемент больше допустимого"


class QuotaExceededError(DomainError):
    code = "quota_exceeded"
    status = 413
    title = "Превышена квота аккаунта"


class RateLimitedError(DomainError):
    code = "rate_limited"
    status = 429
    title = "Слишком часто"

    def __init__(self, retry_after: int, detail: str | None = None) -> None:
        super().__init__(detail, retry_after=retry_after)
        self.retry_after = retry_after


class NotFoundError(DomainError):
    code = "not_found"
    status = 404
    title = "Не найдено"


class ServiceUnavailableError(DomainError):
    code = "service_unavailable"
    status = 503
    title = "Сервис не готов"
