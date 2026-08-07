.PHONY: lint format typecheck test test-integration up down migrate migrate-down seed

migrate:
	alembic upgrade head

migrate-down:
	alembic downgrade base

# Dev/test fixtures only — see each script's docstring. Both idempotent.
# Производственный календарь 2026 года — единственные данные, которые
# приложению нужны для работы: норма периода считается по числу рабочих
# и предпраздничных дней. Скрипт строит УСТАВНУЮ основу и намеренно
# оставляет год неопубликованным: переносы выходных устанавливаются
# постановлением Правительства на каждый год отдельно, и подставлять их
# догадкой значило бы завысить норму.
seed:
	python -m scripts.seed_calendar_2026

lint:
	ruff check .
	lint-imports

format:
	ruff format .

typecheck:
	mypy src

test:
	pytest tests/unit -v

test-integration:
	pytest tests/integration -v

up:
	docker compose up -d

down:
	docker compose down
