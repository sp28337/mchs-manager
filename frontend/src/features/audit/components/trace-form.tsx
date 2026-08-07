"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Employee } from "@/features/personnel/schemas";

/**
 * FE045 — параметры выгрузки.
 *
 * Форма НЕ отправляет POST: она переписывает строку запроса. У выгрузки
 * для служебной проверки не должно быть побочных эффектов, а ссылка на
 * отчёт обязана открывать тот же отчёт — на неё ссылаются в акте.
 */
export interface TraceFormProps {
  roster: readonly Employee[];
}

export function TraceForm({ roster }: TraceFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const employeeId = useId();
  const fromId = useId();
  const toId = useId();

  return (
    <form
      className="flex flex-wrap items-start gap-4 rounded-sm border border-rule bg-paper-raised p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const next = new URLSearchParams();
        const chosen = String(form.get("employeeId") ?? "");
        if (!chosen) return;
        next.set("employeeId", chosen);
        next.set("periodStart", String(form.get("periodStart") ?? ""));
        next.set("periodEnd", String(form.get("periodEnd") ?? ""));
        router.push(`?${next.toString()}`, { scroll: false });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={employeeId}>Сотрудник</Label>
        <select
          id={employeeId}
          name="employeeId"
          required
          defaultValue={searchParams.get("employeeId") ?? ""}
          className="block h-9 w-96 rounded-xs border border-rule-strong bg-paper px-2 text-sm"
        >
          <option value="">Выберите сотрудника</option>
          {roster.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.fullName} — № {employee.personnelNumber}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={fromId}>Период с</Label>
        <Input
          id={fromId}
          name="periodStart"
          type="date"
          required
          defaultValue={searchParams.get("periodStart") ?? ""}
          className="w-44"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={toId}>по</Label>
        <Input
          id={toId}
          name="periodEnd"
          type="date"
          required
          defaultValue={searchParams.get("periodEnd") ?? ""}
          className="w-44"
        />
        <p className="max-w-44 text-xs text-ink-muted">
          Верхняя граница исключающая, как во всём учёте.
        </p>
      </div>

      <Button type="submit" className="mt-[1.375rem]">
        Собрать трассу
      </Button>

      <Button
        type="button"
        variant="outline"
        className="mt-[1.375rem] print:hidden"
        onClick={() => window.print()}
      >
        Печать
      </Button>
    </form>
  );
}
