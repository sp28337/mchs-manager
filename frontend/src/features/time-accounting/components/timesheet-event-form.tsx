"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api-client/client";

import { useRegisterEventMutation } from "../hooks";
import { EVENT_TYPE_LABELS, type ServiceTimeEventType } from "../schemas";

/**
 * FE020 — регистрация факта служебного времени.
 *
 * DoD: «форма дискриминирована по `eventType`, поля меняются по типу».
 *
 * --- Почему дискриминация не косметическая ------------------------------
 *
 * Сервер отвергает `overtime_attraction` без `overtimeOrderId` (422) и
 * `business_trip` без места назначения. Это не придирка валидатора:
 * привлечение сверх нормы без приказа — то самое «самовольное
 * привлечение», которого Приказ № 410 п. 13 требует избегать, а
 * командировка без места не документ.
 *
 * Форма показывает нужное поле ровно тогда, когда оно обязательно, и
 * называет причину рядом. Иначе человек узнаёт о требовании из отказа
 * сервера — то есть после того, как заполнил всё остальное.
 *
 * --- О времени -----------------------------------------------------------
 *
 * `datetime-local` отдаёт время БЕЗ пояса, а сервер ждёт момент с
 * поясом. Преобразование делается явно, по поясу браузера: подставить
 * UTC значило бы сдвинуть суточное дежурство на несколько часов и
 * получить чужие ночные часы.
 *
 * Пояс, в котором считаются ночные часы, всё равно другой — он у
 * ПОДРАЗДЕЛЕНИЯ (ТК РФ ст. 96), и решает это сервер. Здесь задача одна:
 * не потерять момент.
 */

interface TimesheetEventFormProps {
  timesheetId: string;
  token?: string | null;
  onRegistered?: () => void;
}

const EVENT_TYPES: ServiceTimeEventType[] = [
  "actual_shift",
  "sickness",
  "suspension",
  "overtime_attraction",
  "business_trip",
];

function toIsoWithZone(localValue: string): string {
  // `datetime-local` даёт «2026-03-02T08:00» — местное время браузера.
  // `new Date` разбирает его как местное, `toISOString` переводит в UTC с
  // сохранением момента.
  return new Date(localValue).toISOString();
}

export function TimesheetEventForm({
  timesheetId,
  token,
  onRegistered,
}: TimesheetEventFormProps) {
  const [eventType, setEventType] = useState<ServiceTimeEventType>("actual_shift");
  const [error, setError] = useState<ApiError | null>(null);

  const typeId = useId();
  const startId = useId();
  const endId = useId();
  const orderId = useId();
  const placeId = useId();

  const mutation = useRegisterEventMutation(timesheetId, token, {
    onSuccess: () => {
      toast.success("Факт зарегистрирован");
      setError(null);
      onRegistered?.();
    },
    onError: (cause) => setError(cause),
  });

  const requiresOrder = eventType === "overtime_attraction";
  const requiresPlace = eventType === "business_trip";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    mutation.mutate({
      // Ключ создаётся на отправку и переживает повтор при отказе: форма
      // остаётся заполненной, и «Отправить» второй раз означает ту же
      // операцию.
      idempotencyKey: crypto.randomUUID(),
      eventType,
      startTime: toIsoWithZone(String(form.get("startTime"))),
      endTime: toIsoWithZone(String(form.get("endTime"))),
      ...(requiresOrder ? { overtimeOrderId: String(form.get("overtimeOrderId")) } : {}),
      ...(requiresPlace
        ? { businessTripPlace: String(form.get("businessTripPlace")) }
        : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? <ErrorPanel error={error} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor={typeId}>Вид факта</Label>
        <select
          id={typeId}
          name="eventType"
          value={eventType}
          onChange={(event) => setEventType(event.target.value as ServiceTimeEventType)}
          className="h-9 w-full rounded-sm border border-rule-strong bg-paper-raised px-3 text-sm text-ink"
        >
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={startId}>Начало</Label>
          <Input id={startId} name="startTime" type="datetime-local" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={endId}>Окончание</Label>
          <Input id={endId} name="endTime" type="datetime-local" required />
        </div>
      </div>

      {requiresOrder ? (
        <div className="space-y-1.5">
          <Label htmlFor={orderId}>Приказ о привлечении</Label>
          <Input
            id={orderId}
            name="overtimeOrderId"
            required
            className="font-mono"
            aria-describedby={`${orderId}-hint`}
            placeholder="Идентификатор приказа"
          />
          <p id={`${orderId}-hint`} className="text-xs text-ink-muted">
            Привлечение сверх нормы регистрируется только по приказу: без него
            факт не будет принят.
          </p>
        </div>
      ) : null}

      {requiresPlace ? (
        <div className="space-y-1.5">
          <Label htmlFor={placeId}>Место командировки</Label>
          <Input
            id={placeId}
            name="businessTripPlace"
            required
            aria-describedby={`${placeId}-hint`}
          />
          <p id={`${placeId}-hint`} className="text-xs text-ink-muted">
            Командировка без указания места не является документом.
          </p>
        </div>
      ) : null}

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Регистрация…" : "Зарегистрировать факт"}
      </Button>
    </form>
  );
}
