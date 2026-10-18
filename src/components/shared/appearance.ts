/**
 * Свои цвета: событий на сетке и света лампы.
 *
 * --- Что хранится ---------------------------------------------------------
 *
 * Только то, что человек сам выбрал: по цвету на событие и цвет лампы. У
 * остальных — цвета из таблицы стилей (`--fps-*` в `globals.css`), и они же
 * умолчание: убрать выбор значит снять переопределение, а не записать «как
 * было». Хранится в браузере, а не в графике: это вкус человека, а не часть
 * расчёта, и в файл с графиком он не уезжает.
 *
 * --- Как применяется ------------------------------------------------------
 *
 * Переопределением переменных на корне документа: у каждого события в
 * таблице стилей есть пара `--fps-<имя>` (цвет) и `--fps-<имя>-soft`
 * (подложка клетки), и всё, что окрашено этим событием, — клетка, легенда,
 * перечень видов у дня, первый экран, — перекрашивается само, без правки
 * компонентов. Подложка считается от выбранного цвета и бумаги темы, а не
 * выбирается вторым цветом: человек называет один цвет на событие.
 *
 * --- Почему модуль без стороны ----------------------------------------------
 *
 * Тот же довод, что у `lamp-colour.ts`: применить цвета нужно ДО первой
 * отрисовки, крохотным сценарием в разметке страницы, а разметка, собранная на
 * сервере, не может взять постоянные из модуля браузера. Здесь только данные и
 * чистые функции.
 */

export const EVENT_COLOR_KEYS = [
  "annual_leave",
  "extra_leave",
  "study_leave",
  "business_trip",
  "sick_leave",
  "time_off_in_lieu",
  "callout",
] as const;

export type EventColorKey = (typeof EVENT_COLOR_KEYS)[number];

/** Имя семейства цветов в таблице стилей: `--fps-<имя>` и `--fps-<имя>-soft`. */
export const EVENT_COLOR_TOKEN: Record<EventColorKey, string> = {
  annual_leave: "leave",
  extra_leave: "trip",
  study_leave: "study",
  business_trip: "errand",
  sick_leave: "sick",
  time_off_in_lieu: "rest",
  callout: "callout",
};

export interface Appearance {
  /** Выбранные цвета событий, `#rrggbb`; у остальных — умолчание. */
  events: Partial<Record<EventColorKey, string>>;
  /** Выбранный цвет света лампы, `#rrggbb`, или `null` — свет по выбору лампы. */
  lamp: string | null;
}

export const NO_APPEARANCE: Appearance = { events: {}, lamp: null };

export const APPEARANCE_STORAGE_KEY = "shift-schedule.appearance";
export const APPEARANCE_EVENT = "grafik13:appearance";

/** Доля выбранного цвета в подложке клетки: бледный налёт на бумаге темы. */
const SOFT_PERCENT = 14;

const HEX = /^#[0-9a-f]{6}$/i;

export const isHex = (value: unknown): value is string =>
  typeof value === "string" && HEX.test(value);

/** `#c4400f` → `196 64 15` — так лампа хранит свой цвет (`--lamp-rgb`). */
export function hexToChannels(hex: string): string {
  const channel = (from: number) => parseInt(hex.slice(from, from + 2), 16);
  return `${channel(1)} ${channel(3)} ${channel(5)}`;
}

/** Прочитать то, что лежит в хранилище; испорченное и чужое отбрасывается по частям. */
export function parseAppearance(raw: string | null): Appearance {
  if (raw === null) return NO_APPEARANCE;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return NO_APPEARANCE;
    const { events, lamp } = data as Record<string, unknown>;
    const picked: Partial<Record<EventColorKey, string>> = {};
    if (typeof events === "object" && events !== null) {
      for (const key of EVENT_COLOR_KEYS) {
        const value = (events as Record<string, unknown>)[key];
        if (isHex(value)) picked[key] = value.toLowerCase();
      }
    }
    return { events: picked, lamp: isHex(lamp) ? lamp.toLowerCase() : null };
  } catch {
    return NO_APPEARANCE;
  }
}

/** Есть ли хоть один выбранный цвет. */
export function isCustomised(appearance: Appearance): boolean {
  return appearance.lamp !== null || Object.keys(appearance.events).length > 0;
}

/**
 * Поставить цвета на корень документа — или снять те, что не выбраны.
 *
 * Снимается именно то, что было поставлено здесь: остальные переменные корня
 * (тема, лампа) принадлежат таблице стилей и не трогаются.
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  for (const key of EVENT_COLOR_KEYS) {
    const token = `--fps-${EVENT_COLOR_TOKEN[key]}`;
    const hex = appearance.events[key];
    if (hex === undefined) {
      root.style.removeProperty(token);
      root.style.removeProperty(`${token}-soft`);
      continue;
    }
    root.style.setProperty(token, hex);
    root.style.setProperty(
      `${token}-soft`,
      `color-mix(in srgb, ${hex} ${SOFT_PERCENT}%, var(--fps-paper))`,
    );
  }

  if (appearance.lamp === null) root.style.removeProperty("--lamp-rgb");
  else root.style.setProperty("--lamp-rgb", hexToChannels(appearance.lamp));
}

/**
 * То же самое крохотным сценарием для разметки страницы.
 *
 * Собран из тех же постоянных и повторяет те же шаги: прочесть, проверить, что
 * это цвет, поставить переменные. Выполняется, пока браузер разбирает страницу,
 * — цвета стоят с первого кадра, и сетка не мигает умолчанием перед выбранным.
 * Хранилище может быть закрыто — тогда просто умолчание. Тест рядом
 * (`appearance.test.ts`) сверяет его результат с `applyAppearance`.
 */
export const APPEARANCE_MARK_SCRIPT = `(function(){try{var raw=localStorage.getItem(${JSON.stringify(
  APPEARANCE_STORAGE_KEY,
)});if(!raw)return;var d=JSON.parse(raw)||{},r=document.documentElement.style,h=/^#[0-9a-f]{6}$/i,m=${JSON.stringify(
  EVENT_COLOR_TOKEN,
)},e=d.events||{};for(var k in m){var c=e[k];if(typeof c==="string"&&h.test(c)){c=c.toLowerCase();r.setProperty("--fps-"+m[k],c);r.setProperty("--fps-"+m[k]+"-soft","color-mix(in srgb, "+c+" ${SOFT_PERCENT}%, var(--fps-paper))")}}var l=d.lamp;if(typeof l==="string"&&h.test(l)){r.setProperty("--lamp-rgb",parseInt(l.slice(1,3),16)+" "+parseInt(l.slice(3,5),16)+" "+parseInt(l.slice(5,7),16))}}catch(x){}})()`;
