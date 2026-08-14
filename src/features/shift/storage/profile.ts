/**
 * Хранение профиля — в браузере, и только в браузере.
 *
 * --- Почему не на сервере -----------------------------------------------
 *
 * Приложение спрашивает пол, инвалидность I-II группы и даты больничных.
 * Инвалидность и больничный — это сведения о состоянии здоровья, то есть
 * специальная категория персональных данных (ст. 10 ФЗ-152), а караул,
 * дата первой смены и точные даты отсутствий указывают на конкретного
 * человека внутри части, где сорок сотрудников. Хранить такое на сервере
 * значит стать оператором ПД со всем, что за этим следует: уведомление
 * РКН (ст. 22), письменное согласие (ст. 10 ч. 2), локализация базы в РФ
 * (ст. 18 ч. 5), меры защиты по ПП РФ № 1119, уведомление об утечке за 24
 * часа.
 *
 * Но главное не бумаги. Инструмент существует, чтобы человек проверил
 * табель, НЕ ДОВЕРЯЯ работодателю. Хранить его больничные на чужом
 * сервере — ровно тот риск, от которого он и бежит. Данные, которых у нас
 * нет, невозможно ни истребовать, ни потерять.
 *
 * Расчёт целиком переехал в браузер вместе с ними, поэтому сеть здесь не
 * нужна вообще: приложение работает без соединения и ничего никуда не
 * отправляет.
 *
 * --- Что из этого следует для человека ----------------------------------
 *
 * Очистка данных браузера стирает профиль. Это честная цена, но о ней
 * нельзя молчать, поэтому есть выгрузка в файл, и экран о ней напоминает.
 */

import { z } from "zod";

import { DEFAULT_SHIFT_START } from "../domain/shift-hours";
import type { DayType } from "../domain/production-calendar";
import type { IsoDate } from "../domain/plain-date";

const STORAGE_KEY = "mchs-timesheet.profile";

/**
 * Версия формата. Хранится в самих данных, чтобы старый профиль можно
 * было опознать и перенести, а не молча принять за новый и неверно
 * прочитать.
 */
export const SCHEMA_VERSION = 1;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "дата в формате ГГГГ-ММ-ДД");

const dayType = z.enum(["working", "weekend", "holiday", "pre_holiday"]);

const absenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "annual_leave",
    "sick_leave",
    "study_leave",
    "unpaid_leave",
    "business_trip",
    "other_excused",
    "time_off_in_lieu",
  ]),
  startsOn: isoDate,
  endsOn: isoDate,
  note: z.string().max(500).nullish(),
});

/**
 * Вызов помимо графика: соревнования, сбор, резерв, мероприятие, выборы.
 *
 * Часы хранятся строкой, как и остальные величины: число с плавающей
 * точкой в JSON превратило бы 7,5 в 7.499999999999999 при первом же
 * круге записи и чтения.
 */
const calloutSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "competition",
    "training_camp",
    "reserve",
    "public_event",
    "elections",
    "other_callout",
  ]),
  startsOn: isoDate,
  endsOn: isoDate,
  hoursPerDay: z.string().min(1),
});

const reportedSchema = z.object({
  periodStart: isoDate,
  periodEnd: isoDate,
  normHours: z.string().nullish(),
  actualHours: z.string().nullish(),
  overtimeHours: z.string().nullish(),
});

export const storedProfileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  displayName: z.string().min(1).max(200),
  employmentKind: z.enum(["attested", "civilian"]),
  gender: z.enum(["male", "female"]),
  workingConditions: z.enum(["normal", "harmful_or_dangerous"]),
  northernLocality: z.boolean(),
  disabilityGroupIorII: z.boolean(),
  guardNumber: z.number().int().min(1).max(4),
  firstShiftDate: isoDate,
  /**
   * Время развода караула, «ЧЧ:ММ».
   *
   * Необязательное с умолчанием, а не новая версия формата: профили,
   * сохранённые до появления поля, обязаны читаться как есть. Заставить
   * человека заводить год отпусков заново из-за нового поля — цена, ничем
   * не оправданная.
   */
  shiftStartTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "время в формате ЧЧ:ММ")
    .default(DEFAULT_SHIFT_START),
  /**
   * Месячная база для расчёта денег за переработку, в рублях, строкой.
   *
   * Строкой по той же причине, что и часы: число с плавающей точкой в
   * JSON превращает 30000.50 в 30000.499999999996 за один круг записи и
   * чтения, а речь о деньгах.
   *
   * Пустая строка — «не указано», и это рабочее состояние: блок с
   * суммой просто не показывается. Что именно сюда кладут, зависит от
   * категории — должностной оклад сотрудника или заработная плата
   * работника вместе с выплатами; знание об этом живёт в интерфейсе и в
   * `domain/overtime-pay.ts`, а не в схеме хранения.
   *
   * Необязательное с умолчанием: профили, сохранённые до появления
   * расчёта денег, обязаны читаться как есть.
   */
  monthlyPayBase: z.string().max(20).default(""),
  /**
   * Реквизиты для рапорта и заявления.
   *
   * --- Почему это спрашивается, хотя расчёту не нужно --------------------
   *
   * Регистрация нарочно не спрашивает ни фамилии, ни звания, ни
   * подразделения: расчёт от них не зависит, и собирать их было бы сбором
   * чужих данных без причины. Но у бумаги, которую человек несёт
   * начальнику, есть шапка и подпись, и без них она не бумага, а черновик.
   *
   * Поэтому поля живут ЗДЕСЬ, а не в регистрации: их спрашивают ровно
   * тогда, когда человек собрался печатать документ, и каждое остаётся
   * пустым, если он этого не сделал. Уходят они туда же, куда всё
   * остальное, — в хранилище этого браузера.
   *
   * Необязательные с умолчанием: профили, сохранённые до появления
   * документов, обязаны читаться как есть.
   */
  documentAddressee: z.string().max(300).default(""),
  documentFullName: z.string().max(200).default(""),
  documentRank: z.string().max(200).default(""),
  documentPosition: z.string().max(300).default(""),
  accountingYear: z.number().int().min(2000).max(2100),
  absences: z.array(absenceSchema).max(200),
  /** Необязательное с умолчанием: профили, сохранённые до появления
   *  вызовов, обязаны читаться как есть. */
  callouts: z.array(calloutSchema).max(200).default([]),
  /** Правки производственного календаря: дата → тип дня. */
  calendarOverrides: z.record(isoDate, dayType),
  reported: reportedSchema.nullable(),
  savedAt: z.string(),
});

export type StoredProfile = z.infer<typeof storedProfileSchema>;
export type StoredAbsence = z.infer<typeof absenceSchema>;
export type StoredCallout = z.infer<typeof calloutSchema>;
export type ReportedFigures = z.infer<typeof reportedSchema>;

export interface NewProfileInput {
  displayName: string;
  employmentKind: StoredProfile["employmentKind"];
  gender: StoredProfile["gender"];
  workingConditions: StoredProfile["workingConditions"];
  northernLocality: boolean;
  disabilityGroupIorII: boolean;
  guardNumber: number;
  firstShiftDate: IsoDate;
  shiftStartTime: string;
}

export function createProfile(input: NewProfileInput): StoredProfile {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...input,
    // Учётный год берётся из даты первой смены, а не спрашивается
    // отдельно: первая смена караула лежит в первых четырёх сутках года
    // по определению цикла, и спрашивать год вдобавок значило бы дать
    // возможность их рассогласовать.
    accountingYear: Number(input.firstShiftDate.slice(0, 4)),
    monthlyPayBase: "",
    documentAddressee: "",
    documentFullName: "",
    documentRank: "",
    documentPosition: "",
    absences: [],
    callouts: [],
    calendarOverrides: {},
    reported: null,
    savedAt: new Date().toISOString(),
  };
}

/**
 * Профиль из хранилища или `null`, если его нет.
 *
 * Испорченные данные — тоже `null`, а не исключение: белый экран вместо
 * приложения из-за одной битой строки в `localStorage` человек починить
 * не сможет, а завести профиль заново — сможет. Причина при этом
 * возвращается, чтобы экран мог о ней сказать, а не сделать вид, что
 * профиля не было.
 */
export type LoadResult =
  | { status: "empty" }
  | { status: "ok"; profile: StoredProfile }
  | { status: "corrupt"; reason: string; raw: string };

export function loadProfile(): LoadResult {
  if (typeof window === "undefined") return { status: "empty" };

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Хранилище может быть недоступно: приватный режим, запрет сторонних
    // данных, переполнение квоты.
    return { status: "empty" };
  }
  if (raw === null) return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "corrupt", reason: "файл профиля не читается как JSON", raw };
  }

  const result = storedProfileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      status: "corrupt",
      reason: first ? `${first.path.join(".")}: ${first.message}` : "неизвестное поле",
      raw,
    };
  }
  return { status: "ok", profile: result.data };
}

export class StorageUnavailableError extends Error {
  constructor() {
    super(
      "Браузер не дал сохранить данные. Проверьте, не открыта ли страница в " +
        "приватном окне и не запрещено ли сайту хранить данные.",
    );
    this.name = "StorageUnavailableError";
  }
}

export function saveProfile(profile: StoredProfile): StoredProfile {
  const next: StoredProfile = { ...profile, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Молча потерять правку нельзя: человек увидел бы «сохранено» и ушёл.
    throw new StorageUnavailableError();
  }
  return next;
}

export function clearProfile(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Нечего чистить — и нечего сообщать.
  }
}

/** Выгрузка в файл: единственный способ пережить очистку браузера. */
export function exportProfile(profile: StoredProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function importProfile(text: string): StoredProfile {
  const parsed: unknown = JSON.parse(text);
  const result = storedProfileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(
      first
        ? `Это не файл профиля: ${first.path.join(".")} — ${first.message}`
        : "Это не файл профиля.",
    );
  }
  return result.data;
}

/** Правки календаря в виде, который понимает домен. */
export function overridesOf(profile: StoredProfile): Map<IsoDate, DayType> {
  return new Map(Object.entries(profile.calendarOverrides) as [IsoDate, DayType][]);
}
