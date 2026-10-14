# Короткие команды для разработки.
#
# Фронт живёт в pnpm-скриптах (`pnpm test`, `pnpm build`) — дублировать их
# здесь незачем. Этот файл про бэкенд и про окружение целиком: у uv команды
# длинные, а запускаются десятки раз в день.

.DEFAULT_GOAL := help
.PHONY: help up down logs ps api-sync api-fmt api-lint api-type api-test api-check api-run api-shell api-migrate api-downgrade api-revision api-drift

# Все команды uv выполняются из api/: там лежит pyproject.toml, и uv сам
# находит и проект, и окружение.
UV := cd api && uv

help: ## Показать эту справку
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	 | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Поднять окружение (postgres + api + mailpit) и применить миграции
	docker compose up --build -d
# Миграции — частью подъёма, а не отдельной командой, которую надо
# вспомнить. База в свежем томе пуста, и приложение на ней отвечает
# пятисотой на первую же регистрацию: таблиц нет. Проверки `healthz` и
# `readyz` при этом говорят «всё хорошо» — они про связь с базой, а не про
# её содержимое, — так что догадаться не о чем.
#
# `run --rm`, а не `exec`: одноразовый контейнер не зависит от того, успел
# ли подняться основной, и всё равно дождётся здоровой базы
# (`depends_on`). Применять миграции дважды безопасно — второй раз они
# ничего не делают.
	docker compose run --rm api alembic upgrade head
	@echo "API      http://127.0.0.1:8000/api/v1/healthz"
	@echo "Письма   http://127.0.0.1:8025"

down: ## Остановить окружение (данные базы остаются в томе)
	docker compose down

logs: ## Смотреть журналы API
	docker compose logs -f api

ps: ## Что запущено
	docker compose ps

api-sync: ## Установить зависимости по uv.lock
	$(UV) sync --locked

api-fmt: ## Отформатировать код (black)
	$(UV) run black .

api-lint: ## Проверить код (ruff + black --check)
	$(UV) run ruff check .
	$(UV) run black --check .

api-type: ## Проверить типы (mypy)
	$(UV) run mypy

api-test: ## Прогнать тесты с покрытием
	$(UV) run pytest --cov --cov-report=term-missing

api-check: api-lint api-type api-test ## Всё, что проверяет CI

api-migrate: ## Применить миграции до головы
	$(UV) run alembic upgrade head

api-downgrade: ## Откатить одну миграцию
	$(UV) run alembic downgrade -1

api-revision: ## Новая миграция по разнице моделей с базой: make api-revision m="что сделано"
	@test -n "$(m)" || { echo 'нужно: make api-revision m="что сделано"'; exit 1; }
	$(UV) run alembic revision --autogenerate -m "$(m)"

api-drift: ## Не разошлись ли модели с базой
	$(UV) run alembic check

api-run: ## Запустить API без Docker (нужна своя база)
	$(UV) run uvicorn grafik_api.main:app --reload --port 8000

api-shell: ## Python с окружением проекта
	$(UV) run python
