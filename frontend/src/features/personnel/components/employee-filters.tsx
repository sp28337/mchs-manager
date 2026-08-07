"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { EMPLOYMENT_STATUS_LABELS, type EmploymentStatus, type Unit } from "../schemas";

/**
 * FE036 — фильтры списка сотрудников.
 *
 * DoD: «фильтры сохраняются в URL». Как и везде в этой системе: кадровик,
 * нашедший расхождение среди сотрудников части, присылает ссылку, а не
 * описание пути к ней.
 *
 * --- Почему статус фильтруется на клиенте, а подразделение на сервере ---
 *
 * `GET /personnel/employees` принимает `unitId`, `page`, `pageSize` — и
 * ничего про статус. Отправлять `status` в запрос значило бы получить
 * молча проигнорированный параметр: список выглядел бы отфильтрованным,
 * не будучи им.
 *
 * Поэтому фильтр по статусу отсеивает СТРАНИЦУ, и страница говорит об
 * этом прямо. Разница существенна на второй сотне сотрудников, и молчать
 * о ней — значит дать кадровику неверный ответ на вопрос «сколько у нас
 * на больничном».
 */

export interface EmployeeFiltersProps {
  units: readonly Unit[];
}

const STATUSES: EmploymentStatus[] = ["active", "on_leave", "sick", "dismissed"];

export function EmployeeFilters({ units }: EmployeeFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const unitId = useId();
  const statusId = useId();

  const currentUnit = searchParams.get("unitId") ?? "";
  const currentStatus = searchParams.get("status") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Смена фильтра возвращает на первую страницу: третья страница
    // прежней выборки не имеет отношения к новой.
    next.delete("page");
    router.push(`?${next.toString()}`, { scroll: false });
  }

  const filtered = currentUnit || currentStatus;

  return (
    // `items-start`, а не `items-end`: у фильтра по состоянию под полем
    // есть пояснение, и выравнивание по нижнему краю подняло бы его поле
    // выше соседнего. Подписи должны стоять на одной линии — по ним
    // глаз и находит нужный фильтр.
    <div className="flex flex-wrap items-start gap-4 rounded-sm border border-rule bg-paper-raised p-4">
      <div className="space-y-1.5">
        <Label htmlFor={unitId}>Подразделение</Label>
        <select
          id={unitId}
          value={currentUnit}
          onChange={(event) => setParam("unitId", event.target.value)}
          className="block h-9 w-72 rounded-xs border border-rule-strong bg-paper px-2 text-sm"
        >
          <option value="">Все подразделения</option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {" ".repeat((unit.hierarchyPath.split(".").length - 1) * 2)}
              {unit.name} ({unit.code})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={statusId}>Состояние</Label>
        <select
          id={statusId}
          value={currentStatus}
          onChange={(event) => setParam("status", event.target.value)}
          className="block h-9 w-56 rounded-xs border border-rule-strong bg-paper px-2 text-sm"
          aria-describedby={`${statusId}-hint`}
        >
          <option value="">Любое</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {EMPLOYMENT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <p id={`${statusId}-hint`} className="max-w-64 text-xs text-ink-muted">
          Отбирает записи текущей страницы: сервер по состоянию не фильтрует.
        </p>
      </div>

      {filtered ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-[1.375rem]"
          onClick={() => router.push("?", { scroll: false })}
        >
          Сбросить фильтры
        </Button>
      ) : null}
    </div>
  );
}
