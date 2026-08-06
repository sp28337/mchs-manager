"use client";

/**
 * FE017/FE018 — query- и mutation-хуки `time-accounting`.
 *
 * DoD FE017: «ключи запросов namespaced по модулю».
 * DoD FE018: «мутация вызывает `invalidateQueries` по тегу ресурса».
 *
 * --- Про ключи ----------------------------------------------------------
 *
 * Все ключи начинаются с `["time-accounting", ...]`. Это не порядок ради
 * порядка: инвалидация после утверждения табеля обязана задеть и сам
 * табель, и сводку, и историю, и дашборд подразделения — потому что
 * утверждение меняет их все. Общий корень позволяет сказать это одной
 * строкой вместо перечисления, которое однажды забудут дополнить.
 *
 * --- Про инвалидацию после утверждения ----------------------------------
 *
 * Утверждение табеля запускает цепочку на сервере: событие уходит в
 * outbox, релей публикует его, `compensation` заводит дело, `rest_balance`
 * начисляет сутки. Ничего из этого не происходит мгновенно (тик beat — 10
 * секунд), и делать вид, что данные готовы, нельзя.
 *
 * Поэтому инвалидируется только то, что меняется СИНХРОННО: сам табель и
 * его сводка. Компенсация появится позже, и её экран узнает об этом сам —
 * по своему `staleTime`, а не по нашему обещанию.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

import type { ApiError } from "@/lib/api-client/client";

import {
  approveTimesheet,
  correctEvent,
  registerEvent,
  reopenTimesheet,
  type CommandContext,
  type RegisterEventInput,
} from "../api/commands";
import {
  getHoursBreakdownHistory,
  getTimesheet,
  getTimesheetSummary,
  getUnitDashboard,
  type PeriodParams,
} from "../api/queries";
import type {
  CorrectionEntry,
  HoursBreakdown,
  ServiceTimeEvent,
  Timesheet,
  UnitTimesheetDashboard,
} from "../schemas";

const MODULE = "time-accounting" as const;

export const timeAccountingKeys = {
  all: [MODULE] as const,
  timesheet: (id: string) => [MODULE, "timesheet", id] as const,
  summary: (employeeId: string, period: PeriodParams) =>
    [MODULE, "summary", employeeId, period.periodStart, period.periodEnd] as const,
  history: (employeeId: string, page: number) =>
    [MODULE, "history", employeeId, page] as const,
  dashboard: (unitId: string, period: PeriodParams) =>
    [MODULE, "dashboard", unitId, period.periodStart, period.periodEnd] as const,
};

// ------------------------------------------------------------- queries

export function useTimesheetQuery(timesheetId: string, token?: string | null) {
  return useQuery<Timesheet, ApiError>({
    queryKey: timeAccountingKeys.timesheet(timesheetId),
    queryFn: () => getTimesheet(timesheetId, { token }),
  });
}

export function useTimesheetSummaryQuery(
  employeeId: string,
  period: PeriodParams,
  token?: string | null,
) {
  return useQuery<HoursBreakdown, ApiError>({
    queryKey: timeAccountingKeys.summary(employeeId, period),
    queryFn: () => getTimesheetSummary(employeeId, period, { token }),
  });
}

export function useHoursBreakdownHistoryQuery(
  employeeId: string,
  page = 1,
  token?: string | null,
) {
  return useQuery<HoursBreakdown[], ApiError>({
    queryKey: timeAccountingKeys.history(employeeId, page),
    queryFn: () => getHoursBreakdownHistory(employeeId, { page }, { token }),
  });
}

export function useUnitDashboardQuery(
  unitId: string,
  period: PeriodParams,
  token?: string | null,
) {
  return useQuery<UnitTimesheetDashboard, ApiError>({
    queryKey: timeAccountingKeys.dashboard(unitId, period),
    queryFn: () => getUnitDashboard(unitId, period, { token }),
  });
}

// ----------------------------------------------------------- mutations

type MutationExtras<TData, TVariables> = Omit<
  UseMutationOptions<TData, ApiError, TVariables>,
  "mutationFn"
>;

/**
 * Аргументы `onSuccess` берутся из типов самой библиотеки, а не
 * перечисляются: их число менялось между минорными версиями TanStack
 * Query (в 5.101 их четыре), и обёртка, знающая арифметику callback'а,
 * ломалась бы при обновлении.
 */
type SuccessArgs<TData, TVariables> = Parameters<
  NonNullable<MutationExtras<TData, TVariables>["onSuccess"]>
>;

/** Регистрация факта: меняется табель, а вместе с ним и сводка периода. */
export function useRegisterEventMutation(
  timesheetId: string,
  token?: string | null,
  extras?: MutationExtras<ServiceTimeEvent, RegisterEventInput & { idempotencyKey: string }>,
) {
  const queryClient = useQueryClient();

  return useMutation<ServiceTimeEvent, ApiError, RegisterEventInput & { idempotencyKey: string }>({
    ...extras,
    mutationFn: ({ idempotencyKey, ...input }) =>
      registerEvent(timesheetId, input, { idempotencyKey, token } as CommandContext),
    onSuccess: (...args: SuccessArgs<ServiceTimeEvent, RegisterEventInput & { idempotencyKey: string }>) => {
      void queryClient.invalidateQueries({
        queryKey: timeAccountingKeys.timesheet(timesheetId),
      });
      // Сводка считается по фактам табеля, поэтому устаревает вместе с
      // ним. Точный ключ периода здесь неизвестен, и это не повод
      // угадывать: сбрасывается весь префикс сводок.
      void queryClient.invalidateQueries({ queryKey: [MODULE, "summary"] });
      extras?.onSuccess?.(...args);
    },
  });
}

export function useApproveTimesheetMutation(
  timesheetId: string,
  token?: string | null,
  extras?: MutationExtras<Timesheet, { idempotencyKey: string }>,
) {
  const queryClient = useQueryClient();

  return useMutation<Timesheet, ApiError, { idempotencyKey: string }>({
    ...extras,
    mutationFn: ({ idempotencyKey }) =>
      approveTimesheet(timesheetId, { idempotencyKey, token } as CommandContext),
    onSuccess: (...args: SuccessArgs<Timesheet, { idempotencyKey: string }>) => {
      // Утверждение меняет всё, что выведено из табеля, — проще сбросить
      // модуль целиком, чем перечислять и однажды забыть дополнить.
      void queryClient.invalidateQueries({ queryKey: timeAccountingKeys.all });
      extras?.onSuccess?.(...args);
    },
  });
}

export function useReopenTimesheetMutation(
  timesheetId: string,
  token?: string | null,
  extras?: MutationExtras<Timesheet, { reason: string; idempotencyKey: string }>,
) {
  const queryClient = useQueryClient();

  return useMutation<Timesheet, ApiError, { reason: string; idempotencyKey: string }>({
    ...extras,
    mutationFn: ({ idempotencyKey, reason }) =>
      reopenTimesheet(timesheetId, { reason }, { idempotencyKey, token } as CommandContext),
    onSuccess: (...args: SuccessArgs<Timesheet, { reason: string; idempotencyKey: string }>) => {
      void queryClient.invalidateQueries({ queryKey: timeAccountingKeys.all });
      extras?.onSuccess?.(...args);
    },
  });
}

export function useCorrectEventMutation(
  timesheetId: string,
  token?: string | null,
  extras?: MutationExtras<
    CorrectionEntry,
    { originalEventId: string; reason: string; idempotencyKey: string }
  >,
) {
  const queryClient = useQueryClient();

  return useMutation<
    CorrectionEntry,
    ApiError,
    { originalEventId: string; reason: string; idempotencyKey: string }
  >({
    ...extras,
    mutationFn: ({ idempotencyKey, ...input }) =>
      correctEvent(timesheetId, input, { idempotencyKey, token } as CommandContext),
    onSuccess: (
      ...args: SuccessArgs<
        CorrectionEntry,
        { originalEventId: string; reason: string; idempotencyKey: string }
      >
    ) => {
      void queryClient.invalidateQueries({
        queryKey: timeAccountingKeys.timesheet(timesheetId),
      });
      extras?.onSuccess?.(...args);
    },
  });
}
