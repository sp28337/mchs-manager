# Короткие команды для разработки.
#
# Фронт живёт в pnpm-скриптах (`pnpm test`, `pnpm build`) — дублировать их
# здесь незачем. Этот файл про бэкенд и про окружение целиком: у uv команды
# длинные, а запускаются десятки раз в день.

.DEFAULT_GOAL := help
.PHONY: help up down logs ps api-sync api-fmt api-lint api-type api-test api-check api-run api-shell

# Все команды uv выполняются из api/: там лежит pyproject.toml, и uv сам
# находит и проект, и окружение.
UV := cd api && uv

help: ## Показать эту справку
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	 | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Поднять окружение (postgres + api + mailpit)
	docker compose up --build -d
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

api-run: ## Запустить API без Docker (нужна своя база)
	$(UV) run uvicorn grafik_api.main:app --reload --port 8000

api-shell: ## Python с окружением проекта
	$(UV) run python
