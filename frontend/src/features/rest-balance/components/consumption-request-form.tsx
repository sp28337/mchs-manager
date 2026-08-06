"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client/client";

import { requestConsumption } from "../api";

/**
 * FE032 — рапорт на использование суток отдыха.
 *
 * DoD: «заявка сверх остатка показывает ошибку 422 ИНЛАЙН».
 *
 * --- Почему отказ показывается у поля, а не всплывашкой -----------------
 *
 * Отказ здесь не сообщение о сбое, а ответ по существу: суток меньше, чем
 * запрошено. Человеку нужно исправить ЧИСЛО, и сказать ему об этом надо
 * там, где это число стоит. Всплывающее уведомление исчезнет раньше, чем
 * он вернётся к полю.
 *
 * Расширения RFC 7807 делают отказ действием, а не констатацией: сервер
 * присылает `balanceDays` и `requestedDays`, и форма показывает остаток
 * рядом с полем — вместе с кнопкой, подставляющей его целиком.
 *
 * --- Предварительной проверки на клиенте нет ---------------------------
 *
 * Соблазн проверить «запрошено > остатка» до отправки велик и ошибочен:
 * остаток на экране может быть минутной давности (он приходит из
 * материализованного представления), и форма, отказавшая по устаревшему
 * числу, запретила бы законный рапорт. Решает сервер, который считает по
 * журналу.
 *
 * Клиент проверяет только то, что от сервера не зависит: величина
 * положительна и дата указана.
 */

export interface ConsumptionRequestFormProps {
  employeeId: string;
  token?: string | null;
  /** Остаток на момент отрисовки — для подсказки, не для проверки. */
  balanceDays: number;
}

function formatDays(value: number): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ConsumptionRequestForm({
  employeeId,
  token,
  balanceDays,
}: ConsumptionRequestFormProps) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [amount, setAmount] = useState("");

  const amountId = useId();
  const dateId = useId();

  // Остаток, названный сервером в отказе, точнее показанного на экране.
  const serverBalance = error?.extensionNumber("balanceDays");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);

    try {
      await requestConsumption(
        employeeId,
        {
          amountDays: Number(form.get("amountDays")),
          movementDate: String(form.get("movementDate")),
        },
        { token, idempotencyKey: crypto.randomUUID() },
      );
      toast.success("Рапорт исполнен, сутки списаны");
      setAmount("");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError({
              type: "about:blank",
              title: "Сервер недоступен",
              status: 0,
              detail: "Не удалось отправить рапорт. Проверьте соединение.",
            }),
      );
    } finally {
      setPending(false);
    }
  }

  const insufficient = error?.code === "insufficient-balance";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && !insufficient ? <ErrorPanel error={error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={amountId}>Суток</Label>
          <Input
            id={amountId}
            name="amountDays"
            type="number"
            step="0.01"
            min="0.01"
            max="60"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={insufficient}
            aria-describedby={insufficient ? `${amountId}-error` : `${amountId}-hint`}
            className="font-mono"
          />

          {insufficient ? (
            <div id={`${amountId}-error`} role="alert" className="space-y-1">
              <p className="text-sm text-signal">
                Остаток — {formatDays(serverBalance ?? balanceDays)} сут.: этого
                недостаточно для запрошенного количества.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAmount(String(serverBalance ?? balanceDays));
                  setError(null);
                }}
              >
                Подставить весь остаток
              </Button>
            </div>
          ) : (
            <p id={`${amountId}-hint`} className="text-xs text-ink-muted">
              Доступно {formatDays(balanceDays)} сут.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={dateId}>Дата использования</Label>
          <Input id={dateId} name="movementDate" type="date" required />
        </div>
      </div>

      <Button type="submit" disabled={pending || balanceDays <= 0}>
        {pending ? "Отправка…" : "Подать рапорт"}
      </Button>

      {balanceDays <= 0 ? (
        <p className="text-xs text-ink-muted">
          Накопленных суток нет. Они начисляются по компенсации за переработку —
          автоматически, после утверждения табеля.
        </p>
      ) : null}
    </form>
  );
}
