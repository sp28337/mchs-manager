/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APPEARANCE_STORAGE_KEY, parseAppearance } from "@/components/shared/appearance";

import { AppearanceEditor } from "./appearance-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom не знает модальных окон: открытие и закрытие — признак `open`.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
});

const render = () => act(() => root.render(createElement(AppearanceEditor)));
const stored = () => parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
const dialog = () => container.querySelector("dialog");
const button = (name: string | RegExp) =>
  [...container.querySelectorAll("button")].find((node) =>
    typeof name === "string"
      ? node.getAttribute("aria-label") === name || node.textContent?.trim() === name
      : name.test(node.getAttribute("aria-label") ?? node.textContent ?? ""),
  ) as HTMLButtonElement;
const press = (node: HTMLElement | undefined) => act(() => node?.click());

/** Вписать значение так, чтобы React его заметил. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const modalInputs = () => ({
  name: dialog()!.querySelector<HTMLInputElement>('input:not([type="color"])')!,
  colour: dialog()!.querySelector<HTMLInputElement>('input[type="color"]')!,
});

describe("оформление: лампа", () => {
  it("лампа включена, у неё один «Стандартный» цвет и кнопка добавления", () => {
    render();

    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    const group = container.querySelector('[role="radiogroup"][aria-label="Цвет света лампы"]');
    expect(group?.querySelectorAll("input[type=radio]")).toHaveLength(1);
    expect(group?.textContent).toContain("Стандартный");
    expect(button("Добавить цвет")).toBeTruthy();
  });

  it("выключатель гасит лампу, прячет список и помнит выключенное вместе с конфигами", () => {
    render();
    press(button("Добавить цвет"));
    type(modalInputs().name, "Охра");
    press(button("Готово"));
    expect(stored().lamp.configs).toHaveLength(1);

    press(container.querySelector<HTMLElement>('[role="switch"]')!);

    expect(stored().lamp.on).toBe(false);
    expect(stored().lamp.configs).toHaveLength(1);
    expect(container.querySelector('[role="radiogroup"][aria-label="Цвет света лампы"]')).toBeNull();
    // Погашенную лампу цвет не красит.
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("");

    press(container.querySelector<HTMLElement>('[role="switch"]')!);
    expect(stored().lamp.on).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).not.toBe("");
  });

  it("цвет добавляется по «Готово», встаёт в список и сразу действует", () => {
    render();
    press(button("Добавить цвет"));

    expect(dialog()?.hasAttribute("open")).toBe(true);
    expect(dialog()?.textContent).toContain("Новый цвет");
    type(modalInputs().name, "Охра");
    type(modalInputs().colour, "#ff8800");
    // Пока «Готово» не нажато, ничего не записано и страница не перекрашена.
    expect(stored().lamp.configs).toHaveLength(0);
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("");

    press(button("Готово"));

    const { lamp } = stored();
    expect(lamp.configs.map((item) => [item.name, item.hex])).toEqual([["Охра", "#ff8800"]]);
    expect(lamp.active).toBe(lamp.configs[0]?.id);
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("255 136 0");
    expect(dialog()?.hasAttribute("open")).toBe(false);
    expect(container.textContent).toContain("Охра");
  });

  it("крестик окна отменяет добавление без следа", () => {
    render();
    press(button("Добавить цвет"));
    type(modalInputs().name, "Лёд");

    press(button("Закрыть"));

    expect(dialog()?.hasAttribute("open")).toBe(false);
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
  });

  it("конфиг можно изменить, выбрать «Стандартный» и удалить", () => {
    render();
    press(button("Добавить цвет"));
    type(modalInputs().name, "Охра");
    type(modalInputs().colour, "#ff8800");
    press(button("Готово"));

    press(button("Изменить: Охра"));
    expect(dialog()?.textContent).toContain("Изменить цвет");
    expect(modalInputs().name.value).toBe("Охра");
    type(modalInputs().name, "Кирпич");
    type(modalInputs().colour, "#aa3300");
    press(button("Готово"));
    expect(stored().lamp.configs.map((item) => [item.name, item.hex])).toEqual([["Кирпич", "#aa3300"]]);
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("170 51 0");

    const standard = container.querySelector<HTMLInputElement>('input[type=radio]')!;
    press(standard);
    expect(stored().lamp.active).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--lamp-rgb")).toBe("");
    expect(stored().lamp.configs).toHaveLength(1);

    press(button("Удалить: Кирпич"));
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
  });

  it("удалить можно и из окна изменения", () => {
    render();
    press(button("Добавить цвет"));
    type(modalInputs().name, "Охра");
    press(button("Готово"));

    press(button("Изменить: Охра"));
    press(button("Удалить"));

    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(dialog()?.hasAttribute("open")).toBe(false);
  });
});

describe("оформление: события", () => {
  it("у каждого из семи событий свой список; цвет ставится по «Готово» только ему", () => {
    render();
    expect(container.querySelectorAll("details")).toHaveLength(7);

    const sick = [...container.querySelectorAll("details")].find((node) =>
      node.textContent?.includes("Больничный"),
    )!;
    press(sick.querySelector<HTMLButtonElement>("button:not([aria-label])")!);
    type(modalInputs().name, "Мятный");
    type(modalInputs().colour, "#00aa66");
    press(button("Готово"));

    expect(stored().events.kinds.sick_leave?.configs[0]?.name).toBe("Мятный");
    expect(Object.keys(stored().events.kinds)).toEqual(["sick_leave"]);
    expect(document.documentElement.style.getPropertyValue("--fps-sick")).toBe("#00aa66");
    expect(document.documentElement.style.getPropertyValue("--fps-leave")).toBe("");
    // Свёрнутая строка показывает, какой цвет действует.
    expect(sick.querySelector("summary")?.textContent).toContain("Мятный");
  });

  it("выключатель снимает цвета событий со страницы, но не из списков", () => {
    render();
    const sick = [...container.querySelectorAll("details")].find((node) =>
      node.textContent?.includes("Больничный"),
    )!;
    press(sick.querySelector<HTMLButtonElement>("button:not([aria-label])")!);
    type(modalInputs().colour, "#00aa66");
    press(button("Готово"));

    const switches = container.querySelectorAll<HTMLElement>('[role="switch"]');
    press(switches[1]);

    expect(stored().events.on).toBe(false);
    expect(stored().events.kinds.sick_leave?.configs).toHaveLength(1);
    expect(document.documentElement.style.getPropertyValue("--fps-sick")).toBe("");
    expect(container.querySelectorAll("details")).toHaveLength(0);
  });

  it("«Сбросить всё оформление» возвращает умолчания и стирает запись", () => {
    render();
    press(container.querySelector<HTMLElement>('[role="switch"]')!);
    expect(button("Сбросить всё оформление")).toBeTruthy();

    press(button("Сбросить всё оформление"));

    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  });
});
