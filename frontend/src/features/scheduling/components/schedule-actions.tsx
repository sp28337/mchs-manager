"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ErrorPanel } from "@/components/shared/error-panel";
import { IdempotentActionButton } from "@/components/shared/idempotent-action-button";
import { RoleGate } from "@/components/shared/role-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client/client";

import { approveSchedule, reviseSchedule } from "../api";
import type { DutySchedule } from "../schemas";

/**
 * FE026 — утверждение и пересмотр графика.
 *
 * DoD: «Approve недоступен после Revise без повторного статуса `draft`».
 *
 * --- Почему это выполняется само собой ----------------------------------
 *
 * Пересмотр не переводит утверждённый график обратно в черновик. Он
 * создаёт НОВЫЙ график — следующую редакцию со ссылкой на предыдущий
 * (инвариант 5.1.4), а прежний уходит в архив. Утверждённый график есть
 * приказ, и переписывать приказ задним числом нельзя; можно издать
 * следующий.
 *
 * Поэтому «Утвердить» на этом экране показывается ровно при
 * `status === "draft"`, и после пересмотра экран показывает АРХИВНЫЙ
 * график — утверждать на нём нечего. Кнопка не «блокируется»: её нет,
 * потому что действия нет.
 *
 * --- Утверждение требует ссылки на приказ -------------------------------
 *
 * `approvalOrderRef` обязателен на сервере, и это не формальность: график
 * дежурств вводится в действие приказом начальника подразделения, и
 * запись без его номера — не документ. Поле подписано так, чтобы это было
 * ясно до отправки.
 */

export interface ScheduleActionsProps {
  schedule: DutySchedule;
  token?: string | null;
}

export function ScheduleActions({ schedule, token }: ScheduleActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [revising, setRevising] = useState(false);
  const [pending, setPending] = useState(false);

  const orderId = useId();
  const reasonId = useId();

  function fail(cause: unknown) {
    setError(
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось выполнить действие. Проверьте соединение.",
          }),
    );
  }

  if (schedule.status === "archived") {
    return (
      <p className="text-sm text-ink-muted">
        Редакция {schedule.revisionNo} заменена следующей и сохранена как есть:
        архивный график остаётся доказательством того, кто и когда был в наряде.
      </p>
    );
  }

  if (schedule.status === "draft") {
    return (
      <div className="space-y-3">
        {error ? <ErrorPanel error={error} /> : null}

        <RoleGate allow={["unit_commander", "timekeeper"]}>
          <form
            className="flex flex-wrap items-start gap-3"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={orderId}>Приказ о вводе графика</Label>
              <Input
                id={orderId}
                name="approvalOrderRef"
                required
                maxLength={100}
                placeholder="Приказ № 17 от 25.05.2026"
                className="w-72"
                aria-describedby={`${orderId}-hint`}
              />
              <p id={`${orderId}-hint`} className="text-xs text-ink-muted">
                График вводится в действие приказом: запись без его номера не
                является документом.
              </p>
            </div>

            <IdempotentActionButton
              className="mt-[1.375rem]"
              pendingLabel="Утверждение…"
              disabled={(schedule.shifts?.length ?? 0) === 0}
              action={async (idempotencyKey) => {
                const field = document.getElementById(orderId) as HTMLInputElement | null;
                const ref = field?.value?.trim() ?? "";
                if (!ref) {
                  field?.focus();
                  return;
                }
                setError(null);
                try {
                  await approveSchedule(
                    schedule.id,
                    { approvalOrderRef: ref },
                    { token, idempotencyKey },
                  );
                  toast.success("График утверждён");
                  router.refresh();
                } catch (cause) {
                  fail(cause);
                }
              }}
            >
              Утвердить график
            </IdempotentActionButton>
          </form>

          {(schedule.shifts?.length ?? 0) === 0 ? (
            <p className="text-xs text-ink-muted">
              Утверждать нечего: в графике нет ни одной смены.
            </p>
          ) : null}
        </RoleGate>
      </div>
    );
  }

  // status === "approved"
  return (
    <div className="space-y-3">
      {error ? <ErrorPanel error={error} /> : null}

      <p className="text-sm text-ink-muted">
        Введён в действие: {schedule.approvalOrderRef ?? "приказ не указан"}. Редакция{" "}
        {schedule.revisionNo}.
      </p>

      <RoleGate allow={["unit_commander"]}>
        {revising ? (
          <form
            className="max-w-xl space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const reason = String(form.get("reason") ?? "").trim();
              if (!reason) return;

              setPending(true);
              setError(null);
              try {
                const next = await reviseSchedule(
                  schedule.id,
                  { reason },
                  { token, idempotencyKey: crypto.randomUUID() },
                );
                toast.success(`Создана редакция ${next.revisionNo}`);
                setRevising(false);
                router.push(`/scheduling/schedules/${next.id}`);
                router.refresh();
              } catch (cause) {
                fail(cause);
              } finally {
                setPending(false);
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={reasonId}>Причина пересмотра</Label>
              <Input
                id={reasonId}
                name="reason"
                required
                maxLength={1000}
                placeholder="Например: болезнь начальника караула, замена на 14-16 марта"
                aria-describedby={`${reasonId}-hint`}
              />
              <p id={`${reasonId}-hint`} className="text-xs text-ink-muted">
                Пересмотр создаёт новую редакцию графика. Прежняя сохраняется в
                архиве целиком — она остаётся доказательством того, кто был в
                наряде до изменения.
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="submit" variant="signal" disabled={pending}>
                {pending ? "Создание редакции…" : "Пересмотреть"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRevising(false)}>
                Отмена
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="signal" onClick={() => setRevising(true)}>
            Пересмотреть график
          </Button>
        )}
      </RoleGate>
    </div>
  );
}
