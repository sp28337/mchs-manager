# Образ API: сборка отдельно, запуск отдельно.
#
# Зачем две стадии. В сборочной нужны uv, компилятор колёс и кэш пакетов —
# в боевом образе всё это лишние сотни мегабайт и лишняя поверхность атаки.
# Бежит приложение в стадии `runtime`, куда переносится только готовое
# окружение.
#
# Базовый образ один и тот же в обеих стадиях, и это обязательно: путь к
# интерпретатору внутри .venv зашит абсолютным, и окружение, собранное на
# другом образе, в этом не запустится.

# Версия uv зафиксирована: обновление инструмента сборки должно быть
# отдельным осознанным коммитом, а не сюрпризом в чужом выпуске.
FROM python:3.14.8-slim-trixie AS builder

COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    # Интерпретатор берём из образа, а не скачиваем: иначе в боевую стадию
    # пришлось бы переносить ещё и его.
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# Зависимости ставятся до копирования исходников — тогда слой с ними
# переиспользуется, пока не изменился uv.lock. Монтирование вместо COPY:
# файлы нужны только на время команды и в слой не попадают.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

COPY . /app

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev


# Стадия разработки: то же окружение плюс dev-зависимости и перезагрузка.
# Собирается явным `--target dev` (так делает docker-compose.yml); при
# обычной сборке берётся последняя стадия, то есть боевая.
FROM builder AS dev

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked

# Под root, в отличие от боевой стадии: сюда монтируется каталог хозяина
# машины, и возня с совпадением uid в разработке мешает больше, чем даёт.
CMD ["uvicorn", "grafik_api.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--reload", "--reload-dir", "/app/src"]


FROM python:3.14.8-slim-trixie AS runtime

# Непривилегированный пользователь: приложение не должно иметь права
# писать в собственный образ. Домашнего каталога нет — он ему не нужен.
RUN groupadd --system --gid 10001 grafik \
 && useradd --system --uid 10001 --gid grafik --no-create-home grafik

COPY --from=builder --chown=grafik:grafik /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    # Без этого stdout буферизуется, и при падении логи пропадают вместе с
    # процессом — ровно тогда, когда они нужны.
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER grafik
WORKDIR /app

EXPOSE 8000

# Запуск — через gunicorn с ASGI-воркером uvicorn. Вся настройка (сколько
# процессов, какие сроки, какой журнал) лежит в `gunicorn.conf.py` рядом с
# кодом, а не в этой строке и не в compose-файле: иначе она разъедется с
# настройками приложения, из которых её и берут.
#
# Путь указан явно, хотя gunicorn подхватил бы файл и сам из рабочего
# каталога: при запуске с другим `--workdir` молчаливая потеря настройки
# выглядела бы как «в бою почему-то один процесс и текстовый журнал».
CMD ["gunicorn", "--config", "/app/gunicorn.conf.py"]
