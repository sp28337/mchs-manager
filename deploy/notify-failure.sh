#!/bin/sh
#
# Письмо владельцу, когда задача по расписанию не сработала.
#
# Вызывается из `OnFailure=` у служб (deploy/systemd/*.service), поэтому
# принимает имя упавшего юнита:
#
#   notify-failure.sh grafik-backup.service
#
# --- Зачем вообще письмо ----------------------------------------------------
#
# Молча падающая резервная копия — главная причина, по которой копий не
# оказывается в нужный день. Таймер отработал, служба упала, журнал об этом
# знает, а человек узнаёт через месяц. Чтобы узнавал сразу, нужна хоть
# какая-то доставка; на сервере уже стоит свой SMTP (им приложение
# отправляет подтверждения адреса), и дешевле всего отдать письмо ему.
#
# Адрес получателя — в /etc/grafik13/alerts.env, он не в репозитории:
# личный адрес владельца не публичные данные.

set -eu

UNIT=${1:-неизвестная служба}
ENV_FILE=${GRAFIK_ALERT_ENV:-/etc/grafik13/alerts.env}

# shellcheck source=/dev/null
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

TO=${ALERT_TO:-}
FROM=${ALERT_FROM:-noreply@grafik13.ru}

if [ -z "$TO" ]; then
  # Не падаем: обработчик неудачи, который сам падает, добавляет к одной
  # проблеме вторую. Просто говорим в журнал — он у systemd и так под
  # рукой у того, кто смотрит `systemctl status`.
  echo "ALERT_TO не задан в $ENV_FILE: письмо о сбое $UNIT не отправлено" >&2
  exit 0
fi

if ! command -v sendmail > /dev/null 2>&1; then
  echo "нет sendmail: письмо о сбое $UNIT не отправлено" >&2
  exit 0
fi

# Состояние и последние строки журнала — прямо в письме: чтобы решить,
# бежать ли к серверу, этого обычно достаточно.
{
  printf 'From: График 1 3 <%s>\n' "$FROM"
  printf 'To: %s\n' "$TO"
  printf 'Subject: [grafik13] сбой: %s\n' "$UNIT"
  printf 'Content-Type: text/plain; charset=utf-8\n'
  printf '\n'
  printf 'На сервере не сработала задача по расписанию.\n\n'
  systemctl status --full --lines=0 "$UNIT" 2>&1 || true
  printf '\n--- последние записи журнала ---\n'
  journalctl --unit "$UNIT" --lines=40 --no-pager 2>&1 || true
} | sendmail -t -i
