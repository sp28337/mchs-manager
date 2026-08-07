/**
 * FE009 — доступ к сгенерированным типам.
 *
 * `schema.d.ts` порождается из `docs/openapi.yaml` командой
 * `pnpm generate:types` и НЕ правится руками: правка живёт ровно до
 * следующей регенерации, а расхождение с контрактом обнаруживается уже в
 * проде.
 *
 * Здесь — только удобные псевдонимы. Импортировать `schema.d.ts` напрямую
 * по всему приложению значило бы разнести по коду форму `components["schemas"][...]`,
 * и переход на другую версию генератора стал бы правкой сотни файлов.
 *
 * --- Оговорка о расхождениях со спецификацией --------------------------
 *
 * Реализация местами ОТСТУПАЕТ от `openapi.yaml`, и каждое отступление
 * обосновано (см. `tests/contract/test_openapi_conformance.py`): RFC 7807
 * вместо `{"detail": ...}`, ADDITIVE-поля ответов, отсутствующие в
 * спецификации операции. Поэтому сгенерированный тип — нижняя граница
 * того, что придёт, а не полное описание. Там, где ответ богаче, фиче-
 * модуль объявляет собственный тип и говорит об этом в комментарии.
 */

import type { components, operations, paths } from "./schema";

export type { components, operations, paths };

/** Схема DTO по имени: `Schema<"LeaveGrant">`. */
export type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

export type Problem = Schema<"Problem">;
export type Timesheet = Schema<"Timesheet">;
export type HoursBreakdown = Schema<"HoursBreakdown">;
export type CompensationCase = Schema<"CompensationCase">;
export type CompensationLine = Schema<"CompensationLine">;
export type RestBalance = Schema<"RestBalance">;
export type BalanceMovement = Schema<"BalanceMovement">;
export type LeaveGrant = Schema<"LeaveGrant">;
export type RecallEvent = Schema<"RecallEvent">;
export type Employee = Schema<"Employee">;
export type Unit = Schema<"Unit">;
export type PlannedShift = Schema<"PlannedShift">;
export type DutySchedule = Schema<"DutySchedule">;
export type Rule = Schema<"Rule">;
export type RuleVersion = Schema<"RuleVersion">;
