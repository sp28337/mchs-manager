"""Отправщик писем: кто отправляет, что уходит и чего нет в журнале.

Сеть здесь не нужна и не трогается: `aiosmtplib.send` подменяется, и
проверяется именно то, что мы ему отдаём. Подменять можно спокойно —
«умеет ли aiosmtplib отправлять письма» не наш вопрос; наш — «правильное
ли письмо мы ему вручили».
"""

from __future__ import annotations

import logging
from email.message import EmailMessage
from typing import Any

import aiosmtplib
import pytest
from pydantic import SecretStr

from grafik_api.core.config import Settings
from grafik_api.core.errors import ServiceUnavailableError
from grafik_api.core.mail import (
    Letter,
    NullMailer,
    SmtpMailer,
    create_mailer,
    recovery_letter,
    verify_letter,
)

ТОКЕН = "odnorazovaya-ssylka"


def настройки(**правки: Any) -> Settings:
    return Settings(env="test", **правки)


# --- Кто отправляет ---------------------------------------------------------


def test_без_адреса_сервера_писем_нет() -> None:
    """Так приложение поднимается там, где почты нет вовсе."""
    assert isinstance(create_mailer(настройки(smtp_host="")), NullMailer)


def test_с_адресом_сервера_отправляет_smtp() -> None:
    assert isinstance(create_mailer(настройки(smtp_host="mailpit")), SmtpMailer)


async def test_молчаливый_отправщик_оставляет_запись(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Молчать совсем нельзя: иначе непонятно, дошло ли до отправки."""
    with caplog.at_level(logging.INFO, logger="grafik.service.mail"):
        await NullMailer().send(Letter(to="петров@example.com", subject="а", text="б"))

    [запись] = caplog.records
    assert запись.event == "mail.skipped"  # type: ignore[attr-defined]


# --- Что уходит -------------------------------------------------------------


async def test_письмо_уходит_с_нашими_заголовками(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    отправленное: list[tuple[EmailMessage, dict[str, Any]]] = []

    async def перехват(сообщение: EmailMessage, **параметры: Any) -> None:
        отправленное.append((сообщение, параметры))

    monkeypatch.setattr(aiosmtplib, "send", перехват)

    настроено = настройки(
        smtp_host="pochta",
        smtp_port=2525,
        smtp_tls=True,
        smtp_user="grafik",
        smtp_password=SecretStr("тайна"),
    )
    await SmtpMailer(настроено).send(
        Letter(to="петров@example.com", subject="заголовок", text="тело")
    )

    [(сообщение, параметры)] = отправленное
    assert сообщение["From"] == настроено.mail_from
    assert сообщение["To"] == "петров@example.com"
    assert сообщение["Subject"] == "заголовок"
    assert сообщение.get_content().strip() == "тело"
    assert параметры["hostname"] == "pochta"
    assert параметры["port"] == 2525
    assert параметры["start_tls"] is True
    assert параметры["username"] == "grafik"
    assert параметры["password"] == "тайна"


async def test_без_пользователя_пароль_не_отдаётся(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Свой SMTP на том же сервере обычно без входа — и это не «забыли»."""
    параметры: dict[str, Any] = {}

    async def перехват(сообщение: EmailMessage, **прочее: Any) -> None:
        параметры.update(прочее)

    monkeypatch.setattr(aiosmtplib, "send", перехват)

    await SmtpMailer(настройки(smtp_host="pochta")).send(
        Letter(to="петров@example.com", subject="а", text="б")
    )

    assert параметры["username"] is None
    assert параметры["password"] is None
    # `False` отдавать нельзя: у aiosmtplib это «запретить STARTTLS», а не
    # «решай сам».
    assert параметры["start_tls"] is None


async def test_в_журнале_нет_ни_адреса_ни_ссылки(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Адрес — персональные данные, ссылка — одноразовый ключ к аккаунту."""

    async def перехват(сообщение: EmailMessage, **параметры: Any) -> None:
        return None

    monkeypatch.setattr(aiosmtplib, "send", перехват)
    настроено = настройки(smtp_host="pochta")

    with caplog.at_level(logging.INFO, logger="grafik.service.mail"):
        await SmtpMailer(настроено).send(
            verify_letter("петров@example.com", ТОКЕН, настроено)
        )

    [запись] = caplog.records
    assert запись.event == "mail.sent"  # type: ignore[attr-defined]
    написано = caplog.text
    assert "петров@example.com" not in написано
    assert ТОКЕН not in написано


# --- Тексты -----------------------------------------------------------------


def test_в_письме_подтверждения_есть_ссылка_и_срок() -> None:
    настроено = настройки(public_url="https://grafik13.ru")

    письмо = verify_letter("петров@example.com", ТОКЕН, настроено)

    assert письмо.to == "петров@example.com"
    assert f"https://grafik13.ru/account/verify?token={ТОКЕН}" in письмо.text
    # Срок сказан прямо, чтобы «ссылка устарела» не было сюрпризом.
    assert str(настроено.link_ttl_hours) in письмо.text


def test_в_письме_восстановления_сказано_про_ключ() -> None:
    """Без ключа восстановления данные не расшифровать, и это не мелочь."""
    настроено = настройки(public_url="https://grafik13.ru")

    письмо = recovery_letter("петров@example.com", ТОКЕН, настроено)

    assert f"https://grafik13.ru/account/recover?token={ТОКЕН}" in письмо.text
    assert "ключ восстановления" in письмо.text


# --- Когда почта недоступна -------------------------------------------------


async def test_недоступный_сервер_это_временная_неработоспособность(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """`service_unavailable`, а не «внутренняя ошибка».

    Разница не косметическая: по `503` клиенту понятно, что делать
    (повторить позже), а в журнале это не выглядит поломкой нашего кода.
    """

    async def упасть(сообщение: EmailMessage, **параметры: Any) -> None:
        raise aiosmtplib.SMTPConnectError("сервер не отвечает")

    monkeypatch.setattr(aiosmtplib, "send", упасть)
    настроено = настройки(smtp_host="pochta")

    with (
        caplog.at_level(logging.ERROR, logger="grafik.service.mail"),
        pytest.raises(ServiceUnavailableError),
    ):
        await SmtpMailer(настроено).send(
            verify_letter("петров@example.com", ТОКЕН, настроено)
        )

    [запись] = caplog.records
    assert запись.event == "mail.failed"  # type: ignore[attr-defined]
    # Ни получателя, ни ссылки — даже в разборе неисправности.
    assert "петров@example.com" not in caplog.text
    assert ТОКЕН not in caplog.text
