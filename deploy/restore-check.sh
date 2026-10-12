#!/usr/bin/env bash
#
# Проверка восстановления: развернуть копию с нуля и посмотреть, что
# развернулось.
#
# Запускается РУКАМИ и НЕ НА СЕРВЕРЕ — на машине владельца, где лежит
# закрытый ключ age (на сервере его нет намеренно, см. `backup.sh`). Раз в
# месяц, а также после каждой правки миграций, которая меняет схему
# заметно.
#
# --- Зачем вообще эта проверка ----------------------------------------------
#
# Непроверенная резервная копия — это не копия, а надежда. Ломается тут не
# шифрование, а всё вокруг: не тот ключ, не та версия PostgreSQL, забытое
# расширение, выгрузка только схемы без данных. Узнавать об этом в день
# аварии — значит не узнать вовсе.
#
# Поэтому проверка разворачивает копию в ПУСТУЮ базу (по умолчанию — в
# одноразовый контейнер, который после себя не оставляет ничего) и смотрит
# три вещи: все ли таблицы на месте, на какой миграции схема и сколько в
# ней строк. Строки важны: выгрузка без данных восстанавливается без
# единой ошибки.
#
#   Использование: restore-check.sh [файл.dump.age]
#
#   Переменные:
#     GRAFIK_BACKUP_KEY     закрытый ключ age (по умолчанию
#                           ~/.config/grafik13/backup-key.txt)
#     GRAFIK_BACKUP_DIR     откуда брать самую свежую копию, если файл не
#                           указан
#     GRAFIK_RESTORE_IMAGE  образ базы для одноразового контейнера
#     GRAFIK_RESTORE_TARGET строка подключения к ПУСТОЙ базе вместо
#                           контейнера — для машины, где есть PostgreSQL,
#                           но нет docker

set -euo pipefail

KEY=${GRAFIK_BACKUP_KEY:-$HOME/.config/grafik13/backup-key.txt}
DIR=${GRAFIK_BACKUP_DIR:-/var/backups/grafik13}
IMAGE=${GRAFIK_RESTORE_IMAGE:-postgres:18.6-trixie}
TARGET=${GRAFIK_RESTORE_TARGET:-}

# Таблицы, без которых восстановление не восстановление. Перечень тот же,
# что в `api/src/grafik_api/models/`; появилась таблица — дописать сюда,
# иначе проверка пройдёт и на половине схемы.
TABLES="users credentials data_keys blobs blob_revisions refresh_tokens one_time_tokens consents audit_log"

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { say "ОШИБКА: $*" >&2; exit 1; }

command -v age > /dev/null || die "нет age: apt install age"
[ -s "$KEY" ] || die "нет закрытого ключа: $KEY"

# --- Какой файл проверяем ---------------------------------------------------

FILE=${1:-}
if [ -z "$FILE" ]; then
  FILE=$(ls -1t "$DIR"/grafik13-*.dump.age 2> /dev/null | head -n 1 || true)
  [ -n "$FILE" ] || die "копия не указана и не найдена в $DIR"
fi
[ -s "$FILE" ] || die "нет файла: $FILE"

say "проверяю $FILE"

# --- Расшифровка в свой каталог --------------------------------------------

WORK=$(mktemp -d)
CONTAINER=""

# Уборка одна на все выходы: расшифрованная база не должна остаться на
# диске ни после успеха, ни после падения, ни после Ctrl+C.
cleanup() {
  [ -n "$CONTAINER" ] && docker rm --force --volumes "$CONTAINER" > /dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

chmod 700 "$WORK"
age --decrypt --identity "$KEY" --output "$WORK/db.dump" "$FILE"
say "расшифровано: $(stat -c %s "$WORK/db.dump") байт"

# --- Куда восстанавливаем ---------------------------------------------------

if [ -n "$TARGET" ]; then
  say "восстанавливаю в указанную базу (клиент местный)"
  RESTORE() { pg_restore --dbname="$TARGET" "$@"; }
  QUERY() { psql --dbname="$TARGET" --no-align --tuples-only --command="$1"; }
else
  command -v docker > /dev/null \
    || die "нет docker: укажите GRAFIK_RESTORE_TARGET на пустую базу"

  # Пароль случайный и живёт минуту: контейнер одноразовый, порт наружу не
  # публикуется вовсе — всё общение через `docker exec`.
  PASSWORD=$(head -c 18 /dev/urandom | base64)
  CONTAINER="grafik-restore-check-$$"

  say "поднимаю одноразовую базу ($IMAGE)"
  docker run --detach --name "$CONTAINER" \
    --env POSTGRES_PASSWORD="$PASSWORD" \
    --env POSTGRES_USER=grafik \
    --env POSTGRES_DB=grafik \
    --env POSTGRES_INITDB_ARGS="--locale=C.UTF-8 --encoding=UTF8" \
    "$IMAGE" > /dev/null

  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -U grafik -d grafik > /dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  docker exec "$CONTAINER" pg_isready -U grafik -d grafik > /dev/null \
    || die "одноразовая база не поднялась"

  # Клиент берётся из контейнера, а не с машины: версия клиента тогда та
  # же, что версия сервера, и несовпадение версий (обычная причина
  # «копия не восстанавливается») исключено по построению.
  RESTORE() { docker exec --interactive "$CONTAINER" \
      pg_restore --username=grafik --dbname=grafik "$@" < "$WORK/db.dump"; }
  QUERY() { docker exec "$CONTAINER" \
      psql --username=grafik --dbname=grafik --no-align --tuples-only \
           --command="$1"; }
fi

# --- Восстановление ---------------------------------------------------------

# `--exit-on-error` обязателен: без него pg_restore сообщает об ошибках и
# всё равно выходит с нулём, то есть «проверка пройдена» при битой копии.
#
# Владелец и права не переносятся: в целевой базе может не быть той же
# роли, а проверяем мы данные и схему, а не список ролей.
if [ -n "$TARGET" ]; then
  RESTORE --no-owner --no-privileges --exit-on-error "$WORK/db.dump"
else
  RESTORE --no-owner --no-privileges --exit-on-error
fi

say "восстановлено, смотрю, что получилось"

# --- Что получилось ---------------------------------------------------------

MISSING=""
for TABLE in $TABLES; do
  FOUND=$(QUERY "SELECT to_regclass('public.$TABLE') IS NOT NULL" | tr -d ' ')
  [ "$FOUND" = "t" ] || MISSING="$MISSING $TABLE"
done
[ -z "$MISSING" ] || die "в восстановленной базе нет таблиц:$MISSING"

REVISION=$(QUERY "SELECT version_num FROM alembic_version" | tr -d ' ')
[ -n "$REVISION" ] || die "в базе нет записи о миграции: схема не та"
say "схема на миграции $REVISION"

# Число строк по таблицам — глазами. Пустая база восстанавливается без
# единой ошибки, и только эти числа отличают копию от пустышки.
for TABLE in $TABLES; do
  COUNT=$(QUERY "SELECT count(*) FROM $TABLE" | tr -d ' ')
  printf '  %-16s %s\n' "$TABLE" "$COUNT"
done

USERS=$(QUERY "SELECT count(*) FROM users" | tr -d ' ')
[ "$USERS" -gt 0 ] || say "ВНИМАНИЕ: аккаунтов в копии ноль — так бывает на новом сервере, но проверьте"

say "копия разворачивается: $FILE"
