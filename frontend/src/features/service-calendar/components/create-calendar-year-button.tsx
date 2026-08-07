"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorPanel } from "@/components/shared/error-panel";
import { IdempotentActionButton } from "@/components/shared/idempotent-action-button";
import { ApiError } from "@/lib/api-client/client";

import { createCalendarYear } from "../api";

/**
 * Заведение года.
 *
 * Год создаётся пустым — без единого размеченного дня, — и это верно:
 * подставить «выходные по субботам и воскресеньям» значило бы выдать
 * догадку за производственный календарь Российской Федерации, который
 * утверждается постановлением Правительства и переносы в котором
 * ежегодно разные.
 */
export interface CreateCalendarYearButtonProps {
  year: number;
  token?: string | null;
}

export function CreateCalendarYearButton({ year, token }: CreateCalendarYearButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  return (
    <div className="space-y-3">
      {error ? <ErrorPanel error={error} /> : null}

      <IdempotentActionButton
        pendingLabel="Создание…"
        action={async (idempotencyKey) => {
          setError(null);
          try {
            await createCalendarYear(year, { token, idempotencyKey });
            toast.success(`Календарь ${year} года заведён`);
            router.refresh();
          } catch (cause) {
            setError(
              cause instanceof ApiError
                ? cause
                : new ApiError({
                    type: "about:blank",
                    title: "Сервер недоступен",
                    status: 0,
                    detail: "Не удалось завести календарь года.",
                  }),
            );
          }
        }}
      >
        Завести {year} год
      </IdempotentActionButton>
    </div>
  );
}
