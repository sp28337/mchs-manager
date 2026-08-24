/**
 * Хранение профиля — в браузере, и только в браузере.
 *
 * --- Почему не на сервере -----------------------------------------------
 *
 * Приложение знает про инвалидность I-II группы и даты больничных. И то и
 * другое — сведения о состоянии здоровья, то есть специальная категория
 * персональных данных (ст. 10 ФЗ-152), а даты смен и отсутствий вместе с
 * ними указывают на конкретного человека в конкретном коллективе. Хранить
 * такое на сервере значит стать оператором ПД со всем, что за этим
 * следует: уведомление РКН (ст. 22), письменное согласие (ст. 10 ч. 2),
 * локализация базы в РФ (ст. 18 ч. 5), меры защиты по ПП РФ № 1119,
 * уведомление об утечке за 24 часа.
 *
 * Но главное не бумаги. Инструмент существует, чтобы человек считал своё
 * время сам, НЕ ДОВЕРЯЯ чужому учёту. Хранить его больничные на чужом
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

import {
  DEFAULT_SCHEDULE_PATTERN,
  type SchedulePatternId,
} from "../domain/schedule-pattern";
import { DEFAULT_SHIFT_START } from "../domain/shift-hours";
import type { ShiftOverride } from "../domain/value-objects";
import type { DayType } from "../domain/production-calendar";
import type { IsoDate } from "../domain/plain-date";

const STORAGE_KEY = "shift-schedule.profile";

/**
 * Прежнее имя ключа.
 *
 * Профиль лежал под ним, пока приложение было заточено под одну
 * службу. Имя
 * сменилось, а данные — нет: у человека там год внесённых отпусков, и
 * потерять его из-за переименования нельзя. Поэтому старый ключ ещё
 * читается, а первая же запись переносит профиль под новое имя.
 */
const LEGACY_STORAGE_KEY = "mchs-timesheet.profile";

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
    "extra_leave",
    "sick_leave",
    "study_leave",
    "time_off_in_lieu",
  ]),
  startsOn: isoDate,
  endsOn: isoDate,
  note: z.string().max(500).nullish(),
});

/**
 * Работа помимо графика: соревнования, сбор, резерв, мероприятие, выборы.
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
  ]),
  startsOn: isoDate,
  endsOn: isoDate,
  hoursPerDay: z.string().min(1),
});

export const storedProfileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  displayName: z.string().min(1).max(200),
  workingConditions: z.enum(["normal", "harmful_or_dangerous"]),
  disabilityGroupIorII: z.boolean(),
  firstShiftDate: isoDate,
  /**
   * Время начала смены, «ЧЧ:ММ».
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
   * График сменности: «1/3», «2/2», «5/2», «1/4».
   *
   * Необязательное с умолчанием: профили, сохранённые до появления
   * выбора, читаются как «сутки через трое» — единственный график, который
   * тогда и был.
   */
  schedulePattern: z
    .enum(["1/3", "2/2", "5/2", "1/4"])
    .default(DEFAULT_SCHEDULE_PATTERN),
  /**
   * Продолжительность смены в часах, строкой.
   *
   * Строкой по той же причине, что и часы вызова: 7,5 при первом же круге
   * записи и чтения в JSON превратилось бы в 7.499999999999999.
   *
   * Значение следует из графика, но им не задаётся намертво: у
   * двенадцатичасовых смен встречается одиннадцать с половиной, у
   * суточных — двадцать три. Необязательное с умолчанием: профили,
   * сохранённые до появления поля, читаются как суточные.
   */
  shiftDurationHours: z.string().min(1).max(6).default("24"),
  /**
   * Возраст до шестнадцати лет: самая короткая неделя, 24 часа.
   *
   * Признак, а не число, — как и остальные основания недельной нормы:
   * норму выводит домен, а профиль хранит то, из чего она следует.
   * Необязательное с умолчанием, профили без него читаются как есть.
   */
  underSixteen: z.boolean().default(false),
  /* Схема нестрогая намеренно: поля из неё со временем уходят — статус,
     пол, номер караула, северное сокращение, сверка с табелем, — а
     профили, сохранённые до этого, обязаны читаться как есть. Лишние
     ключи молча отбрасываются, и год внесённых отпусков переносить
     заново не нужно. */
  accountingYear: z.number().int().min(2000).max(2100),
  absences: z.array(absenceSchema).max(200),
  /** Необязательное с умолчанием: профили, сохранённые до появления
   *  вызовов, обязаны читаться как есть. */
  callouts: z.array(calloutSchema).max(200).default([]),
  /** Правки производственного календаря: дата → тип дня. */
  calendarOverrides: z.record(isoDate, dayType),
  /**
   * Правки графика смен: дата → «смена» или «выходной».
   *
   * Цикл описывает график, а не жизнь: подмены и переносы случаются, и без
   * этого поля человек не мог сказать приложению, что одну смену он
   * отработал не четвёртого, а седьмого. Хранятся ИСКЛЮЧЕНИЯ, а не
   * переписанный график: сам цикл остаётся прежним и строится дальше сам.
   *
   * Необязательное с умолчанием: профили, сохранённые до появления
   * переносов, обязаны читаться как есть.
   */
  shiftOverrides: z.record(isoDate, z.enum(["shift", "off"])).default({}),
  /**
   * Заметки к суткам: дата → текст.
   *
   * Расчёт их не читает и читать не должен — это память человека, а не
   * данные: «обещали отгул», «подменял Петрова». Разговор об учёте идёт
   * через полгода после событий, и без такой записи человек не вспомнит,
   * почему в этот день у него стоит выход помимо графика.
   *
   * Хранятся отдельно от отпусков и вызовов, а не полем внутри них,
   * потому что заметка бывает нужна и на дне, где ничего не отмечено, — и
   * потому что отпуск это период, а заметка всегда про конкретные сутки.
   *
   * Необязательное с умолчанием: профили, сохранённые до появления
   * заметок, обязаны читаться как есть.
   */
  dayNotes: z.record(isoDate, z.string().max(500)).default({}),
  /**
   * Режим «веду табель»: расчёт обрезается по сегодняшний день.
   *
   * Хранится в профиле, а не в состоянии экрана: человек ведёт табель
   * месяцами, и заново включать режим при каждом открытии страницы
   * значило бы каждый раз показывать ему итог, которого он не просил.
   */
  liveMode: z.boolean().default(false),
  /**
   * Показывать переработку сменами и часами, а не часами.
   *
   * Хранится в профиле, а не в состоянии экрана, по той же причине, что и
   * режим «веду табель»: это не разовый взгляд, а то, в чём человек привык
   * считать. Заново переключать это при каждом открытии страницы значило бы
   * каждый раз показывать ему число в чужой мере.
   *
   * Необязательное с умолчанием: профили, сохранённые до появления
   * переключателя, обязаны читаться как есть.
   */
  overtimeInDays: z.boolean().default(false),
  savedAt: z.string(),
});

export type StoredProfile = z.infer<typeof storedProfileSchema>;

export interface NewProfileInput {
  displayName: string;
  workingConditions: StoredProfile["workingConditions"];
  disabilityGroupIorII: boolean;
  underSixteen: boolean;
  /** Любые сутки, в которые человек выходил на смену или выйдет. */
  firstShiftDate: IsoDate;
  accountingYear: number;
  shiftStartTime: string;
  schedulePattern: StoredProfile["schedulePattern"];
  shiftDurationHours: string;
}

export function createProfile(input: NewProfileInput): StoredProfile {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...input,
    // Учётный год приходит ответом, а не выводится из даты смены. Выводился:
    // смена спрашивалась «первая в году» и лежала в первых четырёх сутках
    // января по определению цикла, так что год у неё был тот самый. Теперь
    // смена любая — хоть августовская, — и год из неё уже не следует.
    absences: [],
    callouts: [],
    calendarOverrides: {},
    shiftOverrides: {},
    dayNotes: {},
    liveMode: false,
    overtimeInDays: false,
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
    // Старое имя ключа читается следом за новым: профиль, заведённый до
    // переименования, обязан открыться без единого действия человека.
    raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY);
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

/**
 * Есть ли на этом устройстве готовый график.
 *
 * Нужно посадочной странице: кнопка первого экрана обещает разное тому,
 * кто здесь впервые, и тому, кто возвращается. Испорченный профиль — то же
 * самое, что его отсутствие: расчёт всё равно откроется анкетой.
 *
 * Подписка — на события хранилища: график, заведённый в соседней вкладке,
 * меняет надпись и здесь, без перезагрузки. Отдельного события на СВОЮ
 * вкладку браузер не шлёт, но там надпись и не нужна: заведя профиль,
 * человек уже в расчёте.
 */
export function hasStoredProfile(): boolean {
  return loadProfile().status === "ok";
}

/**
 * Имя события «профиль изменился в ЭТОЙ вкладке».
 *
 * Родное `storage` для этого не годится: браузер шлёт его только другим
 * вкладкам, а не той, что писала. Без своего события шапка узнавала бы о
 * смене графика лишь при перезагрузке страницы — то есть никогда, потому
 * что настройки правят и закрывают, не перезагружая.
 */
const PROFILE_EVENT = "shift-schedule.profile";

function announceProfile(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROFILE_EVENT));
}

export function subscribeToStoredProfile(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(PROFILE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PROFILE_EVENT, onChange);
  };
}

/**
 * График из сохранённого профиля — строкой, а не объектом.
 *
 * Строкой намеренно: значение читает `useSyncExternalStore`, а тот
 * сравнивает снимки по ссылке. Верни отсюда объект — и каждый снимок был
 * бы новым, то есть «изменившимся», и подписка зациклилась бы.
 */
export function storedSchedulePattern(): SchedulePatternId {
  const result = loadProfile();
  return result.status === "ok"
    ? result.profile.schedulePattern
    : DEFAULT_SCHEDULE_PATTERN;
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
    // Профиль переехал под новое имя — прежнее убирается, чтобы две копии
    // не разошлись и вторая не всплыла однажды вместо первой.
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Молча потерять правку нельзя: человек увидел бы «сохранено» и ушёл.
    throw new StorageUnavailableError();
  }
  announceProfile();
  return next;
}

export function clearProfile(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Нечего чистить — и нечего сообщать.
  }
  announceProfile();
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

/**
 * Имя профиля по умолчанию.
 *
 * Обращение нужно человеку, а не расчёту: пустое имя — не ошибка, но
 * безымянная страница выглядит недоделанной.
 */
export const DEFAULT_PROFILE_NAME = "Мой график";

/**
 * Пустые календарь и график — человек и его настройки при этом остаются.
 *
 * --- Что сбрасывается ------------------------------------------------------
 *
 * Всё, что человек НАСТАВИЛ НА СЕТКАХ: отпуска и больничные, вызовы,
 * правки производственного календаря, переносы и отмены смен, заметки к
 * суткам. Это единственное действие, стирающее их разом: по одному они
 * снимаются в окне дня, а после года ведения таких дней бывает две сотни.
 *
 * --- Что остаётся ----------------------------------------------------------
 *
 * Человек и то, как он отвечал о себе: имя, основание недельной нормы,
 * группа инвалидности, дата рабочей смены, время отсчёта смены, учётный
 * год, «Онлайн», мера переработки. Стирать их заодно значило бы за одно
 * нажатие ломать и данные, и профиль — а спрашивают здесь про календарь.
 *
 * Дата смены остаётся ещё и потому, что задаёт САМ ЦИКЛ: сетка после
 * сброса обязана быть чистым графиком этого человека, а не чужим.
 *
 * Для «стереть всё» есть отдельный, честно названный способ: удалить
 * профиль с устройства.
 */
export function resetCalendar(profile: StoredProfile): StoredProfile {
  return {
    ...profile,
    absences: [],
    callouts: [],
    calendarOverrides: {},
    shiftOverrides: {},
    dayNotes: {},
  };
}

/** Правки календаря в виде, который понимает домен. */
export function overridesOf(profile: StoredProfile): Map<IsoDate, DayType> {
  return new Map(Object.entries(profile.calendarOverrides) as [IsoDate, DayType][]);
}

/** Правки графика в виде, который понимает домен. */
export function shiftOverridesOf(profile: StoredProfile): Map<IsoDate, ShiftOverride> {
  return new Map(Object.entries(profile.shiftOverrides) as [IsoDate, ShiftOverride][]);
}
