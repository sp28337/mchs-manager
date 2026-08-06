"use client";

import { useRouter } from "next/navigation";

import type { DutySchedule } from "../schemas";
import { ScheduleActions } from "./schedule-actions";
import { ShiftCalendarGrid, type RosterEntry } from "./shift-calendar-grid";

/**
 * Клиентский остров карточки графика.
 *
 * Существует ради одного: после расстановки смены страница должна
 * перечитать график с сервера. Сетка не держит собственной копии смен —
 * иначе на экране появилась бы вторая версия расписания, расходящаяся с
 * той, по которой люди заступают в наряд.
 */
export function ScheduleWorkspace({
  schedule,
  roster,
  token,
}: {
  schedule: DutySchedule;
  roster: RosterEntry[];
  token?: string | null;
}) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <ShiftCalendarGrid
        schedule={schedule}
        roster={roster}
        token={token}
        onChanged={() => router.refresh()}
      />

      <section className="border-t border-rule pt-4">
        <ScheduleActions schedule={schedule} token={token} />
      </section>
    </div>
  );
}
