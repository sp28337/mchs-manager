/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  NO_APPEARANCE,
  applyAppearance,
  parseAppearance,
  serializeAppearance,
  type Appearance,
} from "./appearance";
import { Lamp } from "./lamp";
import { forgetAppearance, saveAppearance, writeAppearance } from "./use-appearance";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  document.documentElement.className = "dark";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-lamp");
  document.documentElement.removeAttribute("data-lamp-play");
});

const mount = (stored?: Appearance) => {
  if (stored) {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearance(stored));
    // До первой отрисовки цвета ставит сценарий страницы; здесь его роль — та же строка.
    applyAppearance(document.documentElement, stored);
  }
  act(() => root.render(createElement(Lamp)));
};
const lampOn = () => container.querySelector(".lamp") !== null;
const mark = () => document.documentElement.getAttribute("data-lamp");

const off: Appearance = { ...NO_APPEARANCE, lamp: { ...NO_APPEARANCE.lamp, on: false } };

describe("лампа: горит и гаснет", () => {
  it("по умолчанию горит: трубка, налёт, переключатель и метка на корне", () => {
    mount();

    expect(lampOn()).toBe(true);
    expect(container.querySelector(".lamp-wash")).not.toBeNull();
    expect(container.querySelector(".lamp-switch")).not.toBeNull();
    expect(mark()).toBe("green");
  });

  it("погашенная при открытии не рисуется вовсе, и метки нет — а с ней и всего света на блоках", () => {
    mount(off);

    expect(lampOn()).toBe(false);
    expect(container.querySelector(".lamp-wash")).toBeNull();
    expect(container.querySelector(".lamp-switch")).toBeNull();
    expect(mark()).toBeNull();
  });

  it("гаснет и зажигается на ходу, без перезагрузки", () => {
    mount();
    expect(mark()).toBe("green");

    act(() => saveAppearance(off));
    expect(lampOn()).toBe(false);
    expect(mark()).toBeNull();
    expect(document.documentElement.dataset.lampPlay).toBeUndefined();

    act(() => saveAppearance(NO_APPEARANCE));
    expect(lampOn()).toBe(true);
    expect(mark()).toBe("green");
    // Зажигается розжигом, а не появляется молча.
    expect(document.documentElement.dataset.lampPlay).toBeDefined();
  });

  it("нажатие на лампу снимает выбранный цвет, но не стирает конфиги", () => {
    mount({
      ...NO_APPEARANCE,
      lamp: {
        on: true,
        configs: [{ id: "a", name: "Охра", hex: "#ff8800", createdAt: "" }],
        active: "a",
      },
    });
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("255 136 0");

    act(() => container.querySelector<HTMLElement>(".lamp-switch")?.click());

    const { lamp } = parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
    expect(lamp.active).toBeNull();
    expect(lamp.configs).toHaveLength(1);
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("");
  });

  it("выход из учётной записи убирает оформление: погашенная лампа снова горит, цвета стандартные", () => {
    mount({
      ...NO_APPEARANCE,
      at: "2026-10-23T09:00:00.000Z",
      lamp: {
        on: false,
        configs: [{ id: "a", name: "Охра", hex: "#ff8800", createdAt: "" }],
        active: "a",
      },
    });
    expect(lampOn()).toBe(false);

    act(() => forgetAppearance());

    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(lampOn()).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("");
  });

  it("принятое с другого устройства пишется со своим временем, а не «сейчас»", () => {
    mount();
    const чужое = { ...NO_APPEARANCE, at: "2026-01-01T00:00:00.000Z" };

    act(() => writeAppearance(чужое));

    expect(parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).at).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("правка человека ставит время правки", () => {
    mount();

    act(() => saveAppearance(NO_APPEARANCE));

    expect(parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).at).not.toBe("");
  });
});
