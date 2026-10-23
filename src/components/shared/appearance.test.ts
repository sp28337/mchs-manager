/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";

import {
  APPEARANCE_MARK_SCRIPT,
  APPEARANCE_STORAGE_KEY,
  EVENT_COLOR_KEYS,
  MAX_CONFIGS,
  NAME_MAX,
  NO_APPEARANCE,
  NO_PALETTE,
  activeHex,
  addConfig,
  applyAppearance,
  hexToChannels,
  isCustomised,
  paletteOf,
  parseAppearance,
  removeConfig,
  selectConfig,
  serializeAppearance,
  updateConfig,
  withEventPalette,
  type Appearance,
  type Palette,
} from "./appearance";

const properties = (root: HTMLElement) =>
  Object.fromEntries(
    [...root.style].map((name) => [name, root.style.getPropertyValue(name)]),
  );

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-lamp");
});

const config = (id: string, hex: string, name = id, createdAt = "") => ({
  id,
  name,
  hex,
  createdAt,
});

/** Новый цвет без времени создания — для тестов, которым оно не нужно. */
const add = (
  palette: Palette,
  entry: { id: string; name: string; hex: string; createdAt?: string },
) => addConfig(palette, { createdAt: "", ...entry });

/** Выбор человека: у лампы два цвета, у больничного один; лампа горит. */
const chosen: Appearance = {
  at: "2026-10-23T09:00:00.000Z",
  lamp: {
    on: true,
    configs: [config("l1", "#ffd080", "Янтарь"), config("l2", "#88aaff", "Лёд")],
    active: "l2",
  },
  events: {
    on: true,
    kinds: { sick_leave: { configs: [config("s1", "#112233", "Тёмный")], active: "s1" } },
  },
};

describe("список конфигов", () => {
  it("новый цвет встаёт в конец и сразу действует", () => {
    const next = add(NO_PALETTE, { id: "a", name: "Охра", hex: "#C4400F" });
    expect(next).toEqual({ configs: [config("a", "#c4400f", "Охра")], active: "a" });

    const more = add(next, { id: "b", name: "Мох", hex: "#336633" });
    expect(more.configs.map((item) => item.id)).toEqual(["a", "b"]);
    expect(more.active).toBe("b");
  });

  it("без названия конфиг называется своим цветом; длинное название обрезается", () => {
    expect(add(NO_PALETTE, { id: "a", name: "   ", hex: "#c4400f" }).configs[0]?.name).toBe(
      "#C4400F",
    );
    const long = add(NO_PALETTE, { id: "a", name: "я".repeat(60), hex: "#c4400f" });
    expect(long.configs[0]?.name).toHaveLength(NAME_MAX);
  });

  it("полный список новых не принимает", () => {
    let palette: Palette = NO_PALETTE;
    for (let index = 0; index < MAX_CONFIGS + 3; index += 1) {
      palette = add(palette, { id: `c${index}`, name: "", hex: "#102030" });
    }
    expect(palette.configs).toHaveLength(MAX_CONFIGS);
    expect(palette.active).toBe(`c${MAX_CONFIGS - 1}`);
  });

  it("изменение переписывает название и цвет и не меняет выбор", () => {
    const base = add(NO_PALETTE, { id: "a", name: "Охра", hex: "#c4400f" });
    const other = add(base, { id: "b", name: "Мох", hex: "#336633" });
    const edited = updateConfig(other, "a", { name: "Кирпич", hex: "#AA3300" });

    expect(edited.configs[0]).toEqual(config("a", "#aa3300", "Кирпич"));
    expect(edited.configs[1]).toEqual(other.configs[1]);
    expect(edited.active).toBe("b");
    // Чужой номер ничего не меняет.
    expect(updateConfig(other, "нет", { name: "x", hex: "#000000" })).toEqual(other);
  });

  it("удаление действующего возвращает стандартный цвет, а не соседний", () => {
    const base = add(
      add(NO_PALETTE, { id: "a", name: "Охра", hex: "#c4400f" }),
      { id: "b", name: "Мох", hex: "#336633" },
    );
    expect(removeConfig(base, "b")).toEqual({ configs: [config("a", "#c4400f", "Охра")], active: null });
    // Удалённое не действовавшее выбор не трогает.
    expect(removeConfig(base, "a").active).toBe("b");
  });

  it("выбор: свой номер действует, пустой и чужой — стандартный цвет", () => {
    const base = add(NO_PALETTE, { id: "a", name: "Охра", hex: "#c4400f" });
    expect(selectConfig(base, null).active).toBeNull();
    expect(selectConfig(selectConfig(base, null), "a").active).toBe("a");
    expect(selectConfig(base, "нет").active).toBeNull();
    expect(activeHex(base)).toBe("#c4400f");
    expect(activeHex(selectConfig(base, null))).toBeNull();
  });

  it("список события: пустой не занимает записи, остальные не задеваются", () => {
    const withSick = withEventPalette(
      NO_APPEARANCE,
      "sick_leave",
      add(NO_PALETTE, { id: "s", name: "", hex: "#112233" }),
    );
    const both = withEventPalette(
      withSick,
      "callout",
      add(NO_PALETTE, { id: "c", name: "", hex: "#445566" }),
    );
    expect(Object.keys(both.events.kinds).sort()).toEqual(["callout", "sick_leave"]);
    expect(paletteOf(both, "annual_leave")).toEqual(NO_PALETTE);

    const cleared = withEventPalette(both, "sick_leave", removeConfig(paletteOf(both, "sick_leave"), "s"));
    expect(Object.keys(cleared.events.kinds)).toEqual(["callout"]);
  });
});

describe("parseAppearance", () => {
  it("нет записи — ничего не выбрано, лампа горит", () => {
    expect(parseAppearance(null)).toEqual(NO_APPEARANCE);
    expect(NO_APPEARANCE.lamp.on).toBe(true);
    expect(NO_APPEARANCE.events.on).toBe(true);
  });

  it("записанное читается как было, и пустое умолчание обратно не меняется", () => {
    expect(parseAppearance(serializeAppearance(chosen))).toEqual(chosen);
    expect(parseAppearance(serializeAppearance(NO_APPEARANCE))).toEqual(NO_APPEARANCE);
  });

  it("выключенное помнится вместе с конфигами", () => {
    const off: Appearance = {
      ...chosen,
      lamp: { ...chosen.lamp, on: false },
      events: { ...chosen.events, on: false },
    };
    expect(parseAppearance(serializeAppearance(off))).toEqual(off);
  });

  it("берёт годное и отбрасывает остальное по частям", () => {
    const parsed = parseAppearance(
      JSON.stringify({
        v: 2,
        lamp: {
          on: true,
          configs: [
            { id: "a", name: "Охра", hex: "#C4400F" },
            { id: "a", name: "Двойник", hex: "#000000" },
            { id: "b", name: "Не цвет", hex: "red" },
            { id: "", name: "Без номера", hex: "#000000" },
            "мусор",
          ],
          active: "b",
        },
        events: {
          on: true,
          kinds: {
            sick_leave: { configs: [{ id: "s", hex: "#B3123A" }], active: "s" },
            callout: { configs: [{ id: "c", name: "Не цвет", hex: "x" }], active: "c" },
            unknown: { configs: [{ id: "u", hex: "#000000" }], active: "u" },
          },
        },
      }),
    );

    // Дубль и негодное ушли; действующий, которого нет, — стандартный цвет.
    expect(parsed.lamp.configs).toEqual([config("a", "#c4400f", "Охра")]);
    expect(parsed.lamp.active).toBeNull();
    // Конфиг без названия называется цветом; список без годных записей пуст и места не занимает.
    expect(parsed.events.kinds).toEqual({
      sick_leave: { configs: [config("s", "#b3123a", "#B3123A")], active: "s" },
    });
  });

  it("список не длиннее предела", () => {
    const configs = Array.from({ length: MAX_CONFIGS + 5 }, (_, index) => ({
      id: `c${index}`,
      hex: "#102030",
    }));
    const parsed = parseAppearance(JSON.stringify({ v: 2, lamp: { configs, active: null } }));
    expect(parsed.lamp.configs).toHaveLength(MAX_CONFIGS);
  });

  it("прежний формат — по цвету на событие и один на лампу — не теряется", () => {
    const parsed = parseAppearance(
      JSON.stringify({
        events: { sick_leave: "#B3123A", callout: "red", unknown: "#000000" },
        lamp: "#aabbcc",
      }),
    );
    expect(parsed.lamp).toEqual({
      on: true,
      configs: [config("legacy-lamp", "#aabbcc", "Мой цвет")],
      active: "legacy-lamp",
    });
    expect(parsed.events.on).toBe(true);
    expect(parsed.events.kinds).toEqual({
      sick_leave: { configs: [config("legacy-sick_leave", "#b3123a", "Мой цвет")], active: "legacy-sick_leave" },
    });
  });

  it("испорченная строка — как пустая", () => {
    expect(parseAppearance("{не json")).toEqual(NO_APPEARANCE);
    expect(parseAppearance("42")).toEqual(NO_APPEARANCE);
  });

  it("isCustomised видит конфиг, погашенную лампу и выключенные цвета", () => {
    expect(isCustomised(NO_APPEARANCE)).toBe(false);
    expect(isCustomised(chosen)).toBe(true);
    expect(isCustomised({ ...NO_APPEARANCE, lamp: { ...NO_APPEARANCE.lamp, on: false } })).toBe(true);
    expect(isCustomised({ ...NO_APPEARANCE, events: { on: false, kinds: {} } })).toBe(true);
    expect(
      isCustomised(
        withEventPalette(NO_APPEARANCE, "callout", add(NO_PALETTE, { id: "c", name: "", hex: "#112233" })),
      ),
    ).toBe(true);
  });
});

describe("applyAppearance", () => {
  it("ставит цвет, подложку и свет лампы только у действующих конфигов; пустое — снимает", () => {
    const root = document.documentElement;
    applyAppearance(root, chosen);
    expect(root.style.getPropertyValue("--fps-sick")).toBe("#112233");
    expect(root.style.getPropertyValue("--fps-sick-soft")).toContain("#112233");
    expect(root.style.getPropertyValue("--lamp-rgb")).toBe("136 170 255");

    applyAppearance(root, NO_APPEARANCE);
    expect(properties(root)).toEqual({});
  });

  it("конфиг, не ставший действующим, ничего не красит", () => {
    const root = document.documentElement;
    applyAppearance(root, {
      ...NO_APPEARANCE,
      lamp: { on: true, configs: [config("l", "#ffd080")], active: null },
    });
    expect(properties(root)).toEqual({});
  });

  it("выключенное не применяется", () => {
    const root = document.documentElement;
    applyAppearance(root, {
      ...chosen,
      lamp: { ...chosen.lamp, on: false },
      events: { ...chosen.events, on: false },
    });
    expect(properties(root)).toEqual({});
  });

  it("у каждого события своё имя в таблице стилей", () => {
    const root = document.documentElement;
    const kinds = Object.fromEntries(
      EVENT_COLOR_KEYS.map((key) => [key, { configs: [config("c", "#123456")], active: "c" }]),
    );
    applyAppearance(root, { ...NO_APPEARANCE, events: { on: true, kinds } });
    expect(Object.keys(properties(root))).toHaveLength(EVENT_COLOR_KEYS.length * 2);
  });

  it("метку лампы не трогает: она принадлежит лампе", () => {
    const root = document.documentElement;
    root.setAttribute("data-lamp", "green");
    applyAppearance(root, { ...NO_APPEARANCE, lamp: { ...NO_APPEARANCE.lamp, on: false } });
    expect(root.getAttribute("data-lamp")).toBe("green");
  });

  it("hexToChannels", () => {
    expect(hexToChannels("#c4400f")).toBe("196 64 15");
  });
});

describe("сценарий для разметки страницы", () => {
  const run = () => new Function(APPEARANCE_MARK_SCRIPT)();

  it("ставит то же, что applyAppearance", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearance(chosen));
    run();
    const fromScript = properties(document.documentElement);

    document.documentElement.removeAttribute("style");
    applyAppearance(document.documentElement, parseAppearance(serializeAppearance(chosen)));
    expect(fromScript).toEqual(properties(document.documentElement));
    expect(Object.keys(fromScript).length).toBeGreaterThan(0);
  });

  it("прежний формат читает тем же путём, что и разбор", () => {
    const legacy = JSON.stringify({
      events: { annual_leave: "#aa1100", callout: "#0044cc", time_off_in_lieu: "#00aa88" },
      lamp: "#ffd080",
    });
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, legacy);
    run();
    const fromScript = properties(document.documentElement);

    document.documentElement.removeAttribute("style");
    applyAppearance(document.documentElement, parseAppearance(legacy));
    expect(fromScript).toEqual(properties(document.documentElement));
    expect(fromScript["--lamp-rgb"]).toBe("255 208 128");
    expect(Object.keys(fromScript)).toHaveLength(3 * 2 + 1);
  });

  it("погашенная лампа теряет метку до первой отрисовки; цвета событий при этом на месте", () => {
    document.documentElement.setAttribute("data-lamp", "green");
    window.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      serializeAppearance({ ...chosen, lamp: { ...chosen.lamp, on: false } }),
    );
    run();
    expect(document.documentElement.hasAttribute("data-lamp")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--fps-sick")).toBe("#112233");
  });

  it("выключенные цвета событий не ставятся, а горящая лампа сохраняет метку", () => {
    document.documentElement.setAttribute("data-lamp", "green");
    window.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      serializeAppearance({ ...chosen, events: { ...chosen.events, on: false } }),
    );
    run();
    expect(document.documentElement.getAttribute("data-lamp")).toBe("green");
    expect(document.documentElement.style.getPropertyValue("--fps-sick")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("136 170 255");
  });

  it("без записи и с мусором молчит", () => {
    run();
    expect(properties(document.documentElement)).toEqual({});
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "{мусор");
    expect(run).not.toThrow();
    expect(properties(document.documentElement)).toEqual({});
  });
});
