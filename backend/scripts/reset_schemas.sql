-- Сброс базы под новую цепочку миграций. См. цель `reset-db` в Makefile.
--
-- Семь схем ниже принадлежали прежней версии приложения — ведомственной
-- системе учёта. Разворот их удалил, и `alembic upgrade head` на старой
-- базе падает с «Can't locate revision identified by '0022'»: в
-- `alembic_version` записана ревизия, которой в коде больше нет.

DROP SCHEMA IF EXISTS personnel CASCADE;
DROP SCHEMA IF EXISTS legal_rules CASCADE;
DROP SCHEMA IF EXISTS scheduling CASCADE;
DROP SCHEMA IF EXISTS time_accounting CASCADE;
DROP SCHEMA IF EXISTS compensation CASCADE;
DROP SCHEMA IF EXISTS rest_balance CASCADE;
DROP SCHEMA IF EXISTS leave_management CASCADE;

-- Эти две пересоздаст миграция 0001. Производственный календарь
-- придётся засеять заново: `make seed`.
DROP SCHEMA IF EXISTS service_calendar CASCADE;
DROP SCHEMA IF EXISTS shift_accounting CASCADE;

-- Без этого Alembic продолжит искать несуществующую ревизию.
DROP TABLE IF EXISTS alembic_version;
