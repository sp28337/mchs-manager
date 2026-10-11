"""Письма: подтверждение адреса и восстановление доступа.

Писем у нас всего два вида, и оба — служебные: ссылка, по которой человек
подтверждает свой адрес, и ссылка, по которой он возвращает себе доступ.
Рассылок нет и не будет: на них нужно отдельное согласие, которого мы не
просим.

--- Кто отправляет ---------------------------------------------------------

Свой SMTP на том же сервере — решение из карты данных (раздел 4
`docs/legal/data-map.md`): внешний отправщик стал бы вторым обработчиком
персональных данных, которого пришлось бы называть в уведомлении РКН и с
которым нужен договор поручения. Адрес почты при этом никуда за пределы
нашей машины не уходит.

В разработке письма ловит `mailpit` из `docker-compose.yml` — они видны на
`http://127.0.0.1:8025` и никуда не уезжают.

Если `GRAFIK_SMTP_HOST` пуст, письма не отправляются вовсе: остаётся
запись в журнале. Так приложение поднимается там, где почты нет.

--- Чего в письмах нет -----------------------------------------------------

Ни пароля, ни ключа восстановления, ни содержимого графика — их у сервера
и нет. Только ссылка с одноразовым токеном, который живёт сутки и
срабатывает один раз.
"""

from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

import aiosmtplib

from grafik_api.core.config import Settings
from grafik_api.core.errors import ServiceUnavailableError
from grafik_api.core.logging import get_logger

logger = get_logger("service.mail")


@dataclass(frozen=True)
class Letter:
    """Письмо: кому, о чём и текстом."""

    to: str
    subject: str
    text: str


class Mailer(Protocol):
    """Чем отправляют письма."""

    async def send(self, letter: Letter) -> None: ...


class SmtpMailer:
    """Отправка через SMTP."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def send(self, letter: Letter) -> None:
        """Отправить письмо или сказать, что сейчас не получается.

        Неудача превращается в `service_unavailable`, а не в «внутреннюю
        ошибку»: недоступный почтовый сервер — это именно временная
        неработоспособность, и клиенту по такому ответу понятно, что
        делать (повторить позже), а в журнале это не выглядит поломкой
        нашего кода. Тот, кто ответ получит, решает сам: регистрация без
        письма бессмысленна и отменяется целиком, а восстановление
        доступа отвечает `202` в любом случае (см. `AuthService`).
        """
        сообщение = EmailMessage()
        сообщение["From"] = self.settings.mail_from
        сообщение["To"] = letter.to
        сообщение["Subject"] = letter.subject
        сообщение.set_content(letter.text)

        try:
            await aiosmtplib.send(
                сообщение,
                hostname=self.settings.smtp_host,
                port=self.settings.smtp_port,
                start_tls=self.settings.smtp_tls or None,
                username=self.settings.smtp_user or None,
                password=(
                    self.settings.smtp_password.get_secret_value()
                    if self.settings.smtp_user
                    else None
                ),
            )
        except aiosmtplib.SMTPException as ошибка:
            # В журнал — сорт неисправности и адрес сервера, но ни адреса
            # получателя, ни текста письма: в тексте едет одноразовая
            # ссылка.
            logger.error(
                "письмо не отправлено: %s",
                type(ошибка).__name__,
                extra={
                    "event": "mail.failed",
                    "smtp_host": self.settings.smtp_host,
                },
            )
            raise ServiceUnavailableError() from ошибка

        # Ни адреса, ни ссылки в журнале: адрес — персональные данные, а
        # ссылка — одноразовый ключ к аккаунту.
        logger.info("письмо отправлено", extra={"event": "mail.sent"})


class NullMailer:
    """Не отправляет ничего.

    Нужен там, где почты нет: при разработке без контейнеров и в тестах.
    Молчать совсем нельзя — иначе непонятно, дошло ли дело до отправки.
    """

    async def send(self, letter: Letter) -> None:
        logger.info(
            "письмо не отправлено: отправщик не настроен",
            extra={"event": "mail.skipped"},
        )


def create_mailer(settings: Settings) -> Mailer:
    """Отправщик по настройкам."""
    return SmtpMailer(settings) if settings.smtp_host else NullMailer()


# --- Тексты -----------------------------------------------------------------
#
# Письма короткие и без украшений: человек ждёт от них одного — ссылки.
# Сроком в тексте сказано прямо, чтобы не было сюрприза «ссылка устарела».


def verify_letter(to: str, token: str, settings: Settings) -> Letter:
    """Подтверждение адреса."""
    ссылка = f"{settings.public_url}/account/verify?token={token}"

    return Letter(
        to=to,
        subject="График 1 3: подтверждение адреса",
        text=(
            "Здравствуйте!\n\n"
            "Вы указали этот адрес при создании учётной записи в «График 1 3».\n"
            "Подтвердите его по ссылке:\n\n"
            f"{ссылка}\n\n"
            f"Ссылка действует {settings.link_ttl_hours} часа\n"
            "и срабатывает один раз.\n\n"
            "Если учётную запись создавали не вы — просто не переходите по\n"
            "ссылке: без подтверждения она будет удалена через 30 дней.\n"
        ),
    )


def recovery_letter(to: str, token: str, settings: Settings) -> Letter:
    """Восстановление доступа."""
    ссылка = f"{settings.public_url}/account/recover?token={token}"

    return Letter(
        to=to,
        subject="График 1 3: восстановление доступа",
        text=(
            "Здравствуйте!\n\n"
            "Кто-то (надеемся, вы) попросил восстановить доступ к учётной\n"
            "записи «График 1 3». Чтобы задать новый пароль, перейдите по\n"
            "ссылке:\n\n"
            f"{ссылка}\n\n"
            f"Ссылка действует {settings.link_ttl_hours} часа\n"
            "и срабатывает один раз.\n\n"
            "Понадобится ключ восстановления — те слова, которые вы сохранили\n"
            "при регистрации. Без него данные расшифровать невозможно: ключа\n"
            "от них у нас нет.\n\n"
            "Если доступ восстанавливали не вы — ничего делать не нужно,\n"
            "пароль останется прежним.\n"
        ),
    )
