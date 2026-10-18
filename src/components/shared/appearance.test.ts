/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";

import {
  APPEARANCE_MARK_SCRIPT,
  APPEARANCE_STORAGE_KEY,
  EVENT_COLOR_KEYS,
  applyAppearance,
  hexToChannels,
  isCustomised,
  parseAppearance,
} from "./appearance";

const properties = (root: HTMLElement) =>
  Object.fromEntries(
    [...root.style].map((name) => [name, root.style.getPropertyValue(name)]),
  );

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("parseAppearance", () => {
  it("нет записи — ничего не выбрано", () => {
    expect(parseAppearance(null)).toEqual({ events: {}, lamp: null });
  });

  it("берёт годные цвета и отбрасывает остальное по частям", () => {
    const parsed = parseAppearance(
      JSON.stringify({
        events: { sick_leave: "#B3123A", callout: "red", unknown: "#000000" },
        lamp: "#aabbcc",
      }),
    );
    expect(parsed).toEqual({ events: { sick_leave: "#b3123a" }, lamp: "#aabbcc" });
  });

  it("испорченная строка — как пустая", () => {
    expect(parseAppearance("{не json")).toEqual({ events: {}, lamp: null });
    expect(parseAppearance("42")).toEqual({ events: {}, lamp: null });
  });

  it("isCustomised видит и событие, и лампу", () => {
    expect(isCustomised(parseAppearance(null))).toBe(false);
    expect(isCustomised({ events: { callout: "#112233" }, lamp: null })).toBe(true);
    expect(isCustomised({ events: {}, lamp: "#112233" })).toBe(true);
  });
});

describe("applyAppearance", () => {
  it("ставит цвет, подложку и свет лампы; пустое — снимает", () => {
    const root = document.documentElement;
    applyAppearance(root, { events: { sick_leave: "#112233" }, lamp: "#ff8000" });
    expect(root.style.getPropertyValue("--fps-sick")).toBe("#112233");
    expect(root.style.getPropertyValue("--fps-sick-soft")).toContain("#112233");
    expect(root.style.getPropertyValue("--lamp-rgb")).toBe("255 128 0");

    applyAppearance(root, { events: {}, lamp: null });
    expect(properties(root)).toEqual({});
  });

  it("у каждого события своё имя в таблице стилей", () => {
    const root = document.documentElement;
    const events = Object.fromEntries(EVENT_COLOR_KEYS.map((key) => [key, "#123456"]));
    applyAppearance(root, { events, lamp: null });
    expect(Object.keys(properties(root))).toHaveLength(EVENT_COLOR_KEYS.length * 2);
  });

  it("hexToChannels", () => {
    expect(hexToChannels("#c4400f")).toBe("196 64 15");
  });
});

describe("сценарий для разметки страницы", () => {
  it("ставит то же, что applyAppearance", () => {
    const saved = {
      events: { annual_leave: "#aa1100", callout: "#0044cc", time_off_in_lieu: "#00aa88" },
      lamp: "#ffd080",
    };
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(saved));
    new Function(APPEARANCE_MARK_SCRIPT)();
    const fromScript = properties(document.documentElement);

    document.documentElement.removeAttribute("style");
    applyAppearance(document.documentElement, parseAppearance(JSON.stringify(saved)));
    expect(fromScript).toEqual(properties(document.documentElement));
    expect(Object.keys(fromScript).length).toBeGreaterThan(0);
  });

  it("без записи и с мусором молчит", () => {
    new Function(APPEARANCE_MARK_SCRIPT)();
    expect(properties(document.documentElement)).toEqual({});
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "{мусор");
    expect(() => new Function(APPEARANCE_MARK_SCRIPT)()).not.toThrow();
    expect(properties(document.documentElement)).toEqual({});
  });
});
