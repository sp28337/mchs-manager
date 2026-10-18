import {
  ABSENCE_MARK,
  ABSENCE_TONE,
  CALLOUT_MARK,
  CALLOUT_TONE,
  SHIFT_TONE,
} from "@/features/shift/components/day-marks";

/**
 * Перечень видов у клетки — каким его показывает главная.
 *
 * --- Почему отдельным файлом --------------------------------------------------
 *
 * Показ «События» рисует то же окошко, что раскрывается в расчёте при
 * нажатии по дню (`day-ring.tsx`): знак и название в строке, девять видов
 * сверху вниз. Знаки и цвета берутся оттуда же (`day-marks.ts` — лёгкий
 * словарь без домена), а вот названия лежат в схемах (`ABSENCE_LABELS`), за
 * которыми тянутся zod и весь домен, и ради восьми слов тащить их на
 * лендинг нельзя: он обязан оставаться лёгким.
 *
 * Поэтому названия записаны здесь, а сверяет их с настоящими тест рядом
 * (`demo-list.test.ts`): разойдись они хоть буквой — человек, увидевший на
 * главной «Отпуск», внутри нашёл бы «Ежегодный», и сверка это поймала бы.
 *
 * --- Почему восемь строк, а не девять -------------------------------------------
 *
 * В расчёте «Отгул» последний, но его нет на сутках, где своей смены не
 * было: отгул берут вместо неё. Показ нажимает как раз по таким суткам —
 * продолжению смены и свободным, — поэтому отгула в нём нет, а строка про
 * смену называет то, чего в сутках ещё нет: «Поставить смену». Остальное
 * идёт в том же порядке, что и `SHIFT_RING`.
 */

export interface DemoListRow {
  /** Вид — по нему показ выбирает строку, на которую нажимает. */
  key: "annual_leave" | "extra_leave" | "study_leave" | "business_trip" | "sick_leave" | "callout" | "shift" | "note";
  mark: string;
  /** Цвет, рамка и скругление знака — те же, что у клетки с таким видом. */
  tone: string;
  label: string;
  /** Уголок заметки: на сетке цвет занят видом суток, и заметку показывает он. */
  corner?: boolean;
}

/**
 * Знак заметки — тот же ✎ (U+270E), что и в расчёте (`NOTE_MARK`), и тот же
 * цвет: у заметки своей заливки нет, цвет занят видом суток.
 */
const NOTE_TONE = "border-rule bg-paper-raised text-ink-muted rounded-md";

/**
 * «Поставить смену»: на сутках без смены перечень называет то, чего в них
 * ещё нет (довод целиком — в шапке `day-ring.tsx`).
 */
const SHIFT_ROW_MARK = "С";

export const DEMO_LIST: readonly DemoListRow[] = [
  { key: "annual_leave", mark: ABSENCE_MARK.annual_leave, tone: ABSENCE_TONE.annual_leave, label: "Отпуск" },
  { key: "extra_leave", mark: ABSENCE_MARK.extra_leave, tone: ABSENCE_TONE.extra_leave, label: "Доп. отпуск" },
  { key: "study_leave", mark: ABSENCE_MARK.study_leave, tone: ABSENCE_TONE.study_leave, label: "Учебный отпуск" },
  { key: "business_trip", mark: ABSENCE_MARK.business_trip, tone: ABSENCE_TONE.business_trip, label: "Командировка" },
  { key: "sick_leave", mark: ABSENCE_MARK.sick_leave, tone: ABSENCE_TONE.sick_leave, label: "Больничный" },
  { key: "callout", mark: CALLOUT_MARK, tone: `rounded-md ${CALLOUT_TONE}`, label: "Вызов" },
  { key: "shift", mark: SHIFT_ROW_MARK, tone: `rounded-md ${SHIFT_TONE}`, label: "Поставить смену" },
  { key: "note", mark: "✎", tone: NOTE_TONE, label: "Заметка", corner: true },
];

/** Место строки в перечне — по нему идёт рука. */
export function rowOf(key: DemoListRow["key"]): number {
  return DEMO_LIST.findIndex((row) => row.key === key);
}
