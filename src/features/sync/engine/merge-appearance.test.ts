import { describe, expect, it } from "vitest";

import {
  MAX_CONFIGS,
  NO_APPEARANCE,
  type Appearance,
  type ColourConfig,
  type Palette,
} from "@/components/shared/appearance";

import { deepEqual } from "./deep-equal";
import { mergeAppearance } from "./merge-appearance";

const cfg = (id: string, createdAt: string, hex = "#112233", name = id): ColourConfig => ({
  id,
  name,
  hex,
  createdAt,
});

const palette = (active: string | null, ...configs: ColourConfig[]): Palette => ({
  configs,
  active,
});

const make = (
  at: string,
  parts: {
    lamp?: Palette & { on?: boolean };
    sick?: Palette;
    eventsOn?: boolean;
  } = {},
): Appearance => ({
  at,
  lamp: { on: parts.lamp?.on ?? true, ...(parts.lamp ?? palette(null)) },
  events: {
    on: parts.eventsOn ?? true,
    kinds: parts.sick === undefined ? {} : { sick_leave: parts.sick },
  },
});

const T1 = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-02T10:00:00.000Z";
const T3 = "2026-10-03T10:00:00.000Z";

const ids = (value: Palette) => value.configs.map((config) => config.id);

describe("слияние оформления: конфиги", () => {
  it("заведённое на двух устройствах — оба цвета, в порядке создания", () => {
    const ours = make(T2, { lamp: palette("b", cfg("b", T2)) });
    const theirs = make(T3, { lamp: palette("a", cfg("a", T1)) });

    const merged = mergeAppearance(null, ours, theirs);

    expect(ids(merged.lamp)).toEqual(["a", "b"]);
    // Действующий — у свежей стороны.
    expect(merged.lamp.active).toBe("a");
  });

  it("принесённое с другой стороны берётся, свои правки не пропадают", () => {
    const base = make(T1, { lamp: palette("a", cfg("a", T1)) });
    const ours = make(T1, { lamp: palette("a", cfg("a", T1)) });
    const theirs = make(T2, { lamp: palette("a", cfg("a", T1), cfg("b", T2)) });

    expect(ids(mergeAppearance(base, ours, theirs).lamp)).toEqual(["a", "b"]);
    // И наоборот: у нас добавлено, у них нет.
    expect(ids(mergeAppearance(base, theirs, ours).lamp)).toEqual(["a", "b"]);
  });

  it("удаление побеждает — и непоправленное, и поправленное с другой стороны", () => {
    const base = make(T1, { lamp: palette("a", cfg("a", T1), cfg("b", T1)) });
    const deleted = make(T2, { lamp: palette(null, cfg("b", T1)) });
    const untouched = make(T1, { lamp: palette("a", cfg("a", T1), cfg("b", T1)) });
    const edited = make(T3, {
      lamp: palette("a", cfg("a", T1, "#ff0000", "Красный"), cfg("b", T1)),
    });

    expect(ids(mergeAppearance(base, deleted, untouched).lamp)).toEqual(["b"]);
    // Правка с другой стороны не воскрешает: стереть человек всегда успеет.
    expect(ids(mergeAppearance(base, deleted, edited).lamp)).toEqual(["b"]);
    expect(mergeAppearance(base, deleted, edited).lamp.active).toBeNull();
  });

  it("поправленное с одной стороны берётся, с обеих по-разному — свежее", () => {
    const base = make(T1, { lamp: palette("a", cfg("a", T1, "#111111", "Охра")) });
    const renamed = make(T2, { lamp: palette("a", cfg("a", T1, "#111111", "Кирпич")) });
    const recoloured = make(T3, { lamp: palette("a", cfg("a", T1, "#222222", "Охра")) });
    const same = make(T1, { lamp: palette("a", cfg("a", T1, "#111111", "Охра")) });

    expect(mergeAppearance(base, renamed, same).lamp.configs[0]?.name).toBe("Кирпич");
    expect(mergeAppearance(base, same, renamed).lamp.configs[0]?.name).toBe("Кирпич");

    // Обе правили: берётся запись той стороны, у которой `at` свежее.
    const both = mergeAppearance(base, renamed, recoloured).lamp.configs[0];
    expect(both).toEqual(cfg("a", T1, "#222222", "Охра"));
    expect(mergeAppearance(base, recoloured, renamed).lamp.configs[0]).toEqual(both);
  });

  it("действующий цвет, чей конфиг удалён, становится стандартным", () => {
    const base = make(T1, { sick: palette("s", cfg("s", T1)) });
    const deleted = make(T2, { sick: palette(null) });
    const picked = make(T3, { sick: palette("s", cfg("s", T1)) });

    const merged = mergeAppearance(base, deleted, picked);

    expect(merged.events.kinds.sick_leave).toBeUndefined();
  });

  it("у каждого события свой список", () => {
    const ours = make(T2, { sick: palette("s", cfg("s", T1)) });
    const theirs: Appearance = {
      ...make(T3),
      events: {
        on: true,
        kinds: { callout: palette("c", cfg("c", T2)) },
      },
    };

    const merged = mergeAppearance(null, ours, theirs);

    expect(Object.keys(merged.events.kinds).sort()).toEqual(["callout", "sick_leave"]);
  });

  it("больше предела не бывает: остаются самые ранние", () => {
    const many = (prefix: string, from: number) =>
      Array.from({ length: MAX_CONFIGS }, (_, index) =>
        cfg(`${prefix}${index}`, `2026-10-${String(from + index).padStart(2, "0")}T00:00:00.000Z`),
      );
    const ours = make(T2, { lamp: palette(null, ...many("a", 1).slice(0, 8)) });
    const theirs = make(T3, { lamp: palette(null, ...many("b", 10)) });

    const merged = mergeAppearance(null, ours, theirs);

    expect(merged.lamp.configs).toHaveLength(MAX_CONFIGS);
    // Ранние первыми — те, что завёл человек раньше всех.
    expect(merged.lamp.configs[0]?.id).toBe("a0");
  });
});

describe("слияние оформления: выключатели", () => {
  it("лампу погасили с одной стороны — гаснет, на другой ничего не менялось", () => {
    const base = make(T1);
    const off = make(T2, { lamp: { ...palette(null), on: false } });

    expect(mergeAppearance(base, off, base).lamp.on).toBe(false);
    expect(mergeAppearance(base, base, off).lamp.on).toBe(false);
  });

  it("с обеих сторон по-разному — побеждает более свежая правка", () => {
    const base = make(T1);
    const off = make(T2, { lamp: { ...palette(null), on: false } });
    const stillOn = make(T3, { eventsOn: false });

    // `on` лампы менял только off: берётся он. `on` событий менял только второй.
    const merged = mergeAppearance(base, off, stillOn);
    expect(merged.lamp.on).toBe(false);
    expect(merged.events.on).toBe(false);

  });

  it("действующий цвет: выбрали по-разному на двух устройствах — свежий выбор", () => {
    const both = [cfg("a", T1), cfg("b", T1), cfg("c", T1)];
    const base = make(T1, { lamp: palette("a", ...both) });
    const first = make(T2, { lamp: palette("b", ...both) });
    const second = make(T3, { lamp: palette("c", ...both) });

    expect(mergeAppearance(base, first, second).lamp.active).toBe("c");
    expect(mergeAppearance(base, second, first).lamp.active).toBe("c");
    // Выбрали на одном, на другом не трогали: берётся выбранное.
    expect(mergeAppearance(base, first, base).lamp.active).toBe("b");
  });

  it("время правки в слитом — самое позднее", () => {
    expect(mergeAppearance(null, make(T1), make(T3)).at).toBe(T3);
    expect(mergeAppearance(null, make(T3), make(T1)).at).toBe(T3);
  });

  it("нетронутое устройство принимает чужое оформление целиком", () => {
    const theirs = make(T3, {
      lamp: { ...palette("a", cfg("a", T1)), on: false },
      sick: palette("s", cfg("s", T2)),
      eventsOn: false,
    });

    expect(mergeAppearance(null, NO_APPEARANCE, theirs)).toEqual(theirs);
  });
});

describe("слияние оформления: сходимость", () => {
  const base = make(T1, { lamp: palette("a", cfg("a", T1)) });
  const phone = make(T2, {
    lamp: palette("p", cfg("a", T1), cfg("p", T2, "#ff8800")),
    sick: palette("s", cfg("s", T2)),
  });
  const laptop = make(T3, {
    lamp: { ...palette("l", cfg("a", T1), cfg("l", T3, "#3366ff")), on: false },
  });

  it("порядок слияния ничего не меняет", () => {
    expect(deepEqual(mergeAppearance(base, phone, laptop), mergeAppearance(base, laptop, phone))).toBe(
      true,
    );
  });

  it("слитое сливается с каждой из сторон в себя же: второй круг ничего не находит", () => {
    const merged = mergeAppearance(base, phone, laptop);

    expect(deepEqual(mergeAppearance(merged, merged, merged), merged)).toBe(true);
    // Телефон принял слитое, ноутбук принял слитое — и снова сверка с ним же.
    expect(deepEqual(mergeAppearance(phone, phone, merged), merged)).toBe(true);
    expect(deepEqual(mergeAppearance(laptop, laptop, merged), merged)).toBe(true);
  });

  it("равное время правки решается одинаково с обеих сторон", () => {
    const first = make(T2, { lamp: palette("x", cfg("x", T1, "#111111")) });
    const second = make(T2, { lamp: palette("y", cfg("x", T1, "#222222")) });

    expect(deepEqual(mergeAppearance(null, first, second), mergeAppearance(null, second, first))).toBe(
      true,
    );
  });
});
