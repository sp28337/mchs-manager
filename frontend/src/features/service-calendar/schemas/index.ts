/** Формы ответов `service-calendar` (модуль ServiceCalendar, фаза 4). */

export type DayType = "working" | "pre_holiday" | "holiday" | "weekend";

export interface CalendarDay {
  day: string;
  dayType: DayType;
}

export interface CalendarYear {
  id: string;
  year: number;
  published: boolean;
  publishedAt?: string | null;
  days: CalendarDay[];
}

/**
 * Четыре типа дня — не оттенки одного признака, а входы РАЗНЫХ алгоритмов,
 * и путаница между ними меняет число в табеле:
 *
 * * `working` — множитель нормы периода (Алгоритм Б шаг 6);
 * * `pre_holiday` — вычитает час из нормы (шаг 7) и в классификации
 *   праздничных часов НЕ участвует вовсе;
 * * `holiday` — делает часы праздничными (Алгоритм Д, ТК РФ ст. 112);
 * * `weekend` — делает часы выходными (Алгоритм Е, ТК РФ ст. 153).
 *
 * Подписи в редакторе поэтому называют последствие, а не только сам день.
 */
export const DAY_TYPE_LABELS: Record<DayType, string> = {
  working: "Рабочий",
  pre_holiday: "Предпраздничный",
  holiday: "Праздничный",
  weekend: "Выходной",
};

export const DAY_TYPE_EFFECT: Record<DayType, string> = {
  working: "Входит в норму периода полностью",
  pre_holiday: "Норма периода уменьшается на 1 час; праздничным день НЕ становится",
  holiday: "Часы этого дня — праздничные (ТК РФ ст. 112)",
  weekend: "Часы этого дня — выходные (ТК РФ ст. 153)",
};

/**
 * Цвета клеток.
 *
 * Различие несёт не только цвет: в клетке стоит буква типа, и она
 * остаётся единственным носителем различия там, где цвет не виден —
 * при монохромной печати табеля и у людей с дефицитом цветовосприятия
 * (WCAG 2.2, 1.4.1).
 */
export const DAY_TYPE_TONE: Record<DayType, string> = {
  working: "border-rule bg-paper text-ink",
  pre_holiday: "border-trace bg-trace-soft text-trace",
  holiday: "border-signal bg-signal-soft text-signal",
  weekend: "border-rule-strong bg-paper-sunken text-ink-muted",
};

/** Односимвольная метка — то, что видно в клетке 24×24. */
export const DAY_TYPE_MARK: Record<DayType, string> = {
  working: "Р",
  pre_holiday: "П*",
  holiday: "П",
  weekend: "В",
};
