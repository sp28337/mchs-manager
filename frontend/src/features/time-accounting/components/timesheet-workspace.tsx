"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorPanel } from "@/components/shared/error-panel";
import { IdempotentActionButton } from "@/components/shared/idempotent-action-button";
import { RoleGate } from "@/components/shared/role-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api-client/client";
import { browserTimeZone, formatHours, formatMoment } from "@/lib/utils/format";

import { useApproveTimesheetMutation, useReopenTimesheetMutation } from "../hooks";
import { EVENT_TYPE_LABELS, type Timesheet } from "../schemas";
import { TimesheetEventForm } from "./timesheet-event-form";

/**
 * Клиентский остров карточки табеля: факты, регистрация, утверждение.
 *
 * --- Почему действия зависят от статуса, а не только от роли ------------
 *
 * Утверждённый табель неизменяем (инвариант 6.1.4): сервер ответит 423 на
 * любую попытку добавить факт. Форма, показанная в этом состоянии, была бы
 * приглашением к отказу, поэтому её нет.
 *
 * Обратное тоже верно: «Утвердить» бессмысленно для табеля без фактов —
 * утверждать нечего, — и для уже утверждённого.
 *
 * --- Переоткрытие требует причины --------------------------------------
 *
 * Не короче десяти символов, и это требование сервера, а не формы.
 * Переоткрытие утверждённого табеля отменяет окончательный расчёт, по
 * которому уже могла быть начислена компенсация; «ошибка» в поле причины
 * не объясняет ничего тому, кто будет разбирать это через год.
 */

export interface TimesheetWorkspaceProps {
  timesheet: Timesheet;
  token?: string | null;
  /** Пояс, в котором показывать время фактов. */
  timeZone?: string;
}

function durationHours(start: string, end: string): string {
  return formatHours((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
}

export function TimesheetWorkspace({ timesheet, token, timeZone }: TimesheetWorkspaceProps) {
  const router = useRouter();
  // Пояс подразделения `Timesheet` не несёт (его знает только
  // `HoursBreakdown`), поэтому здесь пояс смотрящего — и он НАЗВАН.
  // См. `formatMoment`: названный пояс не делает число верным, но делает
  // его проверяемым.
  const zone = timeZone ?? browserTimeZone();
  const [error, setError] = useState<ApiError | null>(null);
  const [reopening, setReopening] = useState(false);

  const editable = timesheet.status !== "approved";
  const events = timesheet.events ?? [];

  const approve = useApproveTimesheetMutation(timesheet.id, token, {
    onSuccess: () => {
      toast.success("Табель утверждён");
      setError(null);
      router.refresh();
    },
    onError: setError,
  });

  const reopen = useReopenTimesheetMutation(timesheet.id, token, {
    onSuccess: () => {
      toast.success("Табель переоткрыт");
      setError(null);
      setReopening(false);
      router.refresh();
    },
    onError: setError,
  });

  return (
    <div className="space-y-6">
      {error ? <ErrorPanel error={error} /> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base">Факты периода</h2>
          <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
            время в поясе {zone}
          </p>
        </div>

        {events.length === 0 ? (
          <EmptyState
            title="Фактов не зарегистрировано"
            description="Табель заполняется по мере несения службы: дежурства, больничные, командировки."
          />
        ) : (
          <Table caption="Зарегистрированные факты служебного времени">
            <TableHeader>
              <TableRow>
                <TableHead>Вид</TableHead>
                <TableHead>Начало</TableHead>
                <TableHead>Окончание</TableHead>
                <TableHead className="text-right">Часов</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>{EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatMoment(event.startTime, zone)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatMoment(event.endTime, zone)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {durationHours(event.startTime, event.endTime)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {editable ? (
        <RoleGate allow={["shift_commander", "timekeeper"]}>
          <section className="space-y-3 rounded-sm border border-rule bg-paper-raised p-5">
            <h2 className="text-base">Зарегистрировать факт</h2>
            <TimesheetEventForm
              timesheetId={timesheet.id}
              token={token}
              onRegistered={() => router.refresh()}
            />
          </section>
        </RoleGate>
      ) : null}

      <section className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        {editable ? (
          <RoleGate allow={["unit_commander", "timekeeper"]}>
            <IdempotentActionButton
              action={(idempotencyKey) => approve.mutateAsync({ idempotencyKey })}
              disabled={events.length === 0}
              pendingLabel="Утверждение…"
            >
              Утвердить табель
            </IdempotentActionButton>
            {events.length === 0 ? (
              <p className="text-xs text-ink-muted">
                Утверждать нечего: в табеле нет ни одного факта.
              </p>
            ) : null}
          </RoleGate>
        ) : (
          <RoleGate allow={["unit_commander"]}>
            {reopening ? (
              <ReopenForm
                pending={reopen.isPending}
                onCancel={() => setReopening(false)}
                onSubmit={(reason) =>
                  reopen.mutate({ reason, idempotencyKey: crypto.randomUUID() })
                }
              />
            ) : (
              <div className="space-y-2">
                <Button variant="signal" onClick={() => setReopening(true)}>
                  Переоткрыть табель
                </Button>
                <p className="max-w-prose text-xs text-ink-muted">
                  Переоткрытие отменяет окончательность расчёта. Если по периоду уже
                  начислена компенсация, её придётся оформлять заново.
                </p>
              </div>
            )}
          </RoleGate>
        )}
      </section>
    </div>
  );
}

function ReopenForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const reasonId = "reopen-reason";

  return (
    <form
      className="w-full space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit(String(form.get("reason") ?? ""));
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={reasonId}>Причина переоткрытия</Label>
        <Input
          id={reasonId}
          name="reason"
          required
          minLength={10}
          maxLength={2000}
          aria-describedby={`${reasonId}-hint`}
          placeholder="Например: обнаружено незарегистрированное дежурство 14 марта"
        />
        <p id={`${reasonId}-hint`} className="text-xs text-ink-muted">
          Не короче десяти символов: причину будет читать тот, кто станет
          разбирать расхождение через год.
        </p>
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="signal" disabled={pending}>
          {pending ? "Переоткрытие…" : "Переоткрыть"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
