/**
 * Свои цвета: событий на сетке и света лампы — и сама лампа, включённая или нет.
 *
 * --- Что хранится ---------------------------------------------------------
 *
 * Не «один цвет на событие», а СПИСОК конфигов: каждый выбранный человеком цвет
 * записывается отдельной строкой — с названием, которое можно переписать, и
 * цветом, который можно поменять, — и удаляется той же строкой. Из списка
 * выбирается один действующий. У лампы список свой, у каждого события свой:
 * «красный для больничного» и «красный для вызова» — разные записи, и меняя
 * одну, вторую не задеть.
 *
 * Ни одного действующего конфига — значит цвет из таблицы стилей
 * (`--fps-*` в `globals.css`), и он же умолчание: «стандартный» — это не запись
 * в списке, а его отсутствие, и стереть его нельзя, потому что стирать нечего.
 *
 * Два выключателя — у лампы и у цветов событий. Выключенное не применяется, но
 * и не теряется: конфиги лежат, где лежали, и включённое возвращается теми же.
 *
 * Хранится в браузере, а не в графике: это вкус человека, а не часть расчёта,
 * и в файл с графиком он не уезжает.
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
 * Лампу цвет красит той же переменной (`--lamp-rgb`). А погасить её нельзя
 * одной переменной: весь свет — блик по кромке, тень, кайма под курсором —
 * висит на метке `data-lamp` на корне, и убрать лампу значит снять метку.
 * Этим занята сама лампа (`lamp.tsx`) и, до первой отрисовки, сценарий ниже.
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

/** Одна запись в списке: цвет под своим названием. */
export interface ColourConfig {
  id: string;
  name: string;
  /** `#rrggbb`, строчными. */
  hex: string;
}

/** Список конфигов и действующий из них; `null` — стандартный цвет. */
export interface Palette {
  configs: ColourConfig[];
  active: string | null;
}

export interface Appearance {
  lamp: Palette & {
    /** Лампа горит. Погашенной нет ни света, ни бликов, ни самой трубки. */
    on: boolean;
  };
  events: {
    /** Свои цвета событий применяются. Выключено — все события стандартные. */
    on: boolean;
    kinds: Partial<Record<EventColorKey, Palette>>;
  };
}

export const NO_PALETTE: Palette = { configs: [], active: null };

export const NO_APPEARANCE: Appearance = {
  lamp: { on: true, ...NO_PALETTE },
  events: { on: true, kinds: {} },
};

export const APPEARANCE_STORAGE_KEY = "shift-schedule.appearance";
export const APPEARANCE_EVENT = "grafik13:appearance";

/** Версия записи в хранилище; без неё — прежний формат «один цвет на событие». */
export const APPEARANCE_VERSION = 2;

/** Сколько конфигов в одном списке: больше списку незачем, а хранилищу — тесно. */
export const MAX_CONFIGS = 12;

/** Длина названия конфига. */
export const NAME_MAX = 24;

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

// --- Список: чистые правки ---------------------------------------------------

/** Цвет действующего конфига или `null`, если действует стандартный. */
export function activeHex(palette: Palette): string | null {
  return palette.configs.find((config) => config.id === palette.active)?.hex ?? null;
}

/** Название конфига: что написал человек, а если ничего — сам цвет. */
export function configName(name: string, hex: string): string {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  return clean === "" ? hex.toUpperCase() : clean;
}

/**
 * Новый конфиг в конец списка — и он сразу действующий: человек выбрал цвет,
 * чтобы увидеть его, а не чтобы потом искать его в списке и нажимать ещё раз.
 * Полный список остаётся как был.
 */
export function addConfig(
  palette: Palette,
  entry: { id: string; name: string; hex: string },
): Palette {
  if (palette.configs.length >= MAX_CONFIGS) return palette;
  const hex = entry.hex.toLowerCase();
  return {
    configs: [...palette.configs, { id: entry.id, name: configName(entry.name, hex), hex }],
    active: entry.id,
  };
}

/** Переписать название и цвет; чужой номер ничего не меняет. Действующий остаётся действующим. */
export function updateConfig(
  palette: Palette,
  id: string,
  patch: { name: string; hex: string },
): Palette {
  const hex = patch.hex.toLowerCase();
  return {
    ...palette,
    configs: palette.configs.map((config) =>
      config.id === id ? { id, name: configName(patch.name, hex), hex } : config,
    ),
  };
}

/** Убрать конфиг. Был действующим — действует стандартный, а не соседний: выбор делает человек. */
export function removeConfig(palette: Palette, id: string): Palette {
  return {
    configs: palette.configs.filter((config) => config.id !== id),
    active: palette.active === id ? null : palette.active,
  };
}

/** Сделать действующим конфиг с этим номером; `null` или чужой номер — стандартный цвет. */
export function selectConfig(palette: Palette, id: string | null): Palette {
  return {
    ...palette,
    active: palette.configs.some((config) => config.id === id) ? id : null,
  };
}

/** Список события — пустой, если своего ещё нет. */
export function paletteOf(appearance: Appearance, key: EventColorKey): Palette {
  return appearance.events.kinds[key] ?? NO_PALETTE;
}

/** Заменить список события, не трогая остальные; пустой список запись не занимает. */
export function withEventPalette(
  appearance: Appearance,
  key: EventColorKey,
  palette: Palette,
): Appearance {
  const kinds = { ...appearance.events.kinds };
  if (palette.configs.length === 0) delete kinds[key];
  else kinds[key] = palette;
  return { ...appearance, events: { ...appearance.events, kinds } };
}

// --- Хранилище ---------------------------------------------------------------

function readPalette(value: unknown): Palette {
  if (typeof value !== "object" || value === null) return NO_PALETTE;
  const { configs, active } = value as Record<string, unknown>;
  if (!Array.isArray(configs)) return NO_PALETTE;

  const seen = new Set<string>();
  const kept: ColourConfig[] = [];
  for (const item of configs) {
    if (kept.length >= MAX_CONFIGS) break;
    if (typeof item !== "object" || item === null) continue;
    const { id, name, hex } = item as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || seen.has(id) || !isHex(hex)) continue;
    seen.add(id);
    kept.push({
      id,
      name: configName(typeof name === "string" ? name : "", hex.toLowerCase()),
      hex: hex.toLowerCase(),
    });
  }
  return {
    configs: kept,
    active: typeof active === "string" && seen.has(active) ? active : null,
  };
}

/**
 * Прежний формат: по одному цвету на событие и один на лампу, без названий.
 *
 * Выбранное тогда человеком не теряется: каждый цвет становится единственным
 * конфигом своего списка — и действующим, как и был.
 */
function readLegacy(data: Record<string, unknown>): Appearance {
  const kinds: Partial<Record<EventColorKey, Palette>> = {};
  const events = data.events;
  if (typeof events === "object" && events !== null) {
    for (const key of EVENT_COLOR_KEYS) {
      const value = (events as Record<string, unknown>)[key];
      if (!isHex(value)) continue;
      const id = `legacy-${key}`;
      kinds[key] = {
        configs: [{ id, name: configName("Мой цвет", value), hex: value.toLowerCase() }],
        active: id,
      };
    }
  }
  const lamp = data.lamp;
  const palette: Palette = isHex(lamp)
    ? {
        configs: [{ id: "legacy-lamp", name: "Мой цвет", hex: lamp.toLowerCase() }],
        active: "legacy-lamp",
      }
    : NO_PALETTE;
  return { lamp: { on: true, ...palette }, events: { on: true, kinds } };
}

/** Прочитать то, что лежит в хранилище; испорченное и чужое отбрасывается по частям. */
export function parseAppearance(raw: string | null): Appearance {
  if (raw === null) return NO_APPEARANCE;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return NO_APPEARANCE;
    const record = data as Record<string, unknown>;
    if (record.v !== APPEARANCE_VERSION) return readLegacy(record);

    const lamp = typeof record.lamp === "object" && record.lamp !== null ? record.lamp : {};
    const events =
      typeof record.events === "object" && record.events !== null ? record.events : {};
    const kinds: Partial<Record<EventColorKey, Palette>> = {};
    const rawKinds = (events as Record<string, unknown>).kinds;
    if (typeof rawKinds === "object" && rawKinds !== null) {
      for (const key of EVENT_COLOR_KEYS) {
        const palette = readPalette((rawKinds as Record<string, unknown>)[key]);
        if (palette.configs.length > 0) kinds[key] = palette;
      }
    }
    return {
      lamp: {
        on: (lamp as Record<string, unknown>).on !== false,
        ...readPalette(lamp),
      },
      events: { on: (events as Record<string, unknown>).on !== false, kinds },
    };
  } catch {
    return NO_APPEARANCE;
  }
}

/** Запись для хранилища: с версией, чтобы прежний формат не путался с этим. */
export function serializeAppearance(appearance: Appearance): string {
  return JSON.stringify({ v: APPEARANCE_VERSION, ...appearance });
}

/** Есть ли хоть что-то, отличающееся от умолчания: выключенное, конфиг. */
export function isCustomised(appearance: Appearance): boolean {
  return (
    !appearance.lamp.on ||
    appearance.lamp.configs.length > 0 ||
    !appearance.events.on ||
    Object.values(appearance.events.kinds).some((palette) => palette.configs.length > 0)
  );
}

// --- На страницу -------------------------------------------------------------

/**
 * Поставить цвета на корень документа — или снять те, что не действуют.
 *
 * Снимается именно то, что было поставлено здесь: остальные переменные корня
 * (тема, лампа) принадлежат таблице стилей и не трогаются. Метку `data-lamp`
 * здесь НЕ трогают: она принадлежит лампе (`lamp.tsx`), которая следит за тем,
 * горит ли она, сама.
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  for (const key of EVENT_COLOR_KEYS) {
    const token = `--fps-${EVENT_COLOR_TOKEN[key]}`;
    const hex = appearance.events.on ? activeHex(paletteOf(appearance, key)) : null;
    if (hex === null) {
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

  const lamp = appearance.lamp.on ? activeHex(appearance.lamp) : null;
  if (lamp === null) root.style.removeProperty("--lamp-rgb");
  else root.style.setProperty("--lamp-rgb", hexToChannels(lamp));
}

/**
 * То же самое крохотным сценарием для разметки страницы.
 *
 * Собран из тех же постоянных и повторяет те же шаги: прочесть, проверить, что
 * это цвет, поставить переменные. Выполняется, пока браузер разбирает страницу,
 * — цвета стоят с первого кадра, и сетка не мигает умолчанием перед выбранным.
 * Погашенная лампа гасится так же: сценарий лампы (`LAMP_MARK_SCRIPT`) стоит
 * выше и метку уже поставил, а этот её снимает — иначе первые кадры страница
 * была бы освещена, и свет пропадал бы на глазах. Хранилище может быть закрыто —
 * тогда просто умолчание. Тест рядом (`appearance.test.ts`) сверяет его
 * результат с `applyAppearance`; прежний формат записи читается тем же путём.
 */
export const APPEARANCE_MARK_SCRIPT = `(function(){try{var raw=localStorage.getItem(${JSON.stringify(
  APPEARANCE_STORAGE_KEY,
)});if(!raw)return;var d=JSON.parse(raw)||{},o=document.documentElement,r=o.style,h=/^#[0-9a-f]{6}$/i,m=${JSON.stringify(
  EVENT_COLOR_TOKEN,
)},v=d.v===${APPEARANCE_VERSION};function q(p){if(!p||!p.configs)return null;for(var i=0;i<p.configs.length;i++){var c=p.configs[i];if(c&&c.id===p.active&&typeof c.hex==="string"&&h.test(c.hex))return c.hex.toLowerCase()}return null}function f(c){return typeof c==="string"&&h.test(c)?c.toLowerCase():null}var e=d.events||{},k=v?e.kinds||{}:e,on=!v||e.on!==false;for(var n in m){var c=on?(v?q(k[n]):f(k[n])):null;if(c){r.setProperty("--fps-"+m[n],c);r.setProperty("--fps-"+m[n]+"-soft","color-mix(in srgb, "+c+" ${SOFT_PERCENT}%, var(--fps-paper))")}}var l=d.lamp;if(v&&l&&l.on===false){o.removeAttribute("data-lamp");return}var x=v?q(l):f(l);if(x){r.setProperty("--lamp-rgb",parseInt(x.slice(1,3),16)+" "+parseInt(x.slice(3,5),16)+" "+parseInt(x.slice(5,7),16))}}catch(z){}})()`;
