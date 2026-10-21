/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RhythmPicker } from "./rhythm-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const onPick = vi.fn();

function render(props: Partial<Parameters<typeof RhythmPicker>[0]> = {}) {
  act(() =>
    root.render(
      createElement(RhythmPicker, {
        value: "1|3",
        custom: null,
        customLabel: "Свой",
        onPick,
        ...props,
      }),
    ),
  );
}

const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

beforeEach(() => {
  onPick.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("выбор графика ритмом", () => {
  it("пять вариантов в одной группе, выбран один", () => {
    render({ value: "2|2" });

    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(radios().map((radio) => radio.value)).toEqual(["1|3", "1|4", "2|2", "5|2", "custom"]);
    expect(radios().filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(["2|2"]);
  });

  it("имя варианта сохраняет надпись из клеток: «2|2», а не только «Два через два»", () => {
    render();

    const names = radios().map((radio) => radio.getAttribute("aria-label"));
    expect(names).toContain("2|2, два через два");
    expect(names).toContain("Свой цикл");
  });

  it("выбор другого варианта сообщает его номер", () => {
    render();

    act(() => radios().find((radio) => radio.value === "5|2")?.click());
    expect(onPick).toHaveBeenCalledExactlyOnceWith("5|2");
  });

  it("повторное нажатие на выбранный ничего не сообщает: окно со своими числами открывает карандаш", () => {
    render({ value: "1|4" });

    act(() => radios().find((radio) => radio.value === "1|4")?.click());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("свой цикл называет себя названием, когда он задан, и «Свой», пока нет", () => {
    render({ value: "custom", custom: { workDays: 3, cycleDays: 4 }, customLabel: "3|1" });
    const custom = radios().find((radio) => radio.value === "custom");
    expect(custom?.getAttribute("aria-label")).toBe("3|1, свой цикл");
    expect(container.textContent).toContain("3|1");

    render({ value: "1|3", custom: null, customLabel: "Свой" });
    expect(container.textContent).toContain("Свой");
  });

  it("рисунок цикла: у «1|3» одна рабочая клетка из четырёх", () => {
    render();

    const strip = container.querySelector("label[title='Сутки через трое'] [aria-hidden]");
    const cells = [...(strip?.children ?? [])];
    expect(cells).toHaveLength(4);
    expect(cells.filter((cell) => cell.className.includes("bg-verify"))).toHaveLength(1);
  });
});
