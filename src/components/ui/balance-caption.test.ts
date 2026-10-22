/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BalanceCaption } from "./balance-caption";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // В jsdom нет ни `matchMedia`, ни `animate`. Движение смены здесь не предмет:
  // «уменьшенное движение» его отключает, и остаётся то, что стоит на месте.
  window.matchMedia = ((query: string) => ({ matches: true, media: query }) as MediaQueryList);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
  act(() => root.unmount());
  container.remove();
});

function render(under: boolean) {
  act(() => root.render(createElement(BalanceCaption, { under })));
}

/** Приставки подписи: «недо» и «пере», в том порядке, в каком лежат в разметке. */
const prefixes = () => [...container.querySelectorAll<HTMLElement>("span.col-start-1")];

describe("подпись разницы: «пере» и «недо»", () => {
  it("читается словом целиком: видна одна приставка, хвост «работка» общий", () => {
    render(false);
    expect(container.textContent).toBe("НедоПереработка");
    expect(prefixes().map((it) => it.getAttribute("aria-hidden"))).toEqual(["true", "false"]);

    render(true);
    expect(prefixes().map((it) => it.getAttribute("aria-hidden"))).toEqual(["false", "true"]);
  });

  it("смена знака по-прежнему играет ход: обе приставки едут от старого места к новому", () => {
    const calls: { element: HTMLElement; frames: Keyframe[] }[] = [];
    HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement, frames: Keyframe[]) {
      calls.push({ element: this, frames });
      return {} as Animation;
    });
    window.matchMedia = ((query: string) => ({ matches: false, media: query }) as MediaQueryList);

    render(false);
    expect(calls).toHaveLength(0); // первая отрисовка ничего не играет

    render(true);
    expect(calls).toHaveLength(2);
    const [under, over] = prefixes();
    const of = (element: HTMLElement) => calls.find((it) => it.element === element)!.frames;

    // «недо» приходит сверху на своё место, «пере» уезжает вниз за край.
    expect(of(under!)[0]).toMatchObject({ transform: "translateY(-100%)" });
    expect(of(under!).at(-1)).toMatchObject({ transform: "translateY(0%)" });
    expect(of(over!)[0]).toMatchObject({ transform: "translateY(0%)" });
    expect(of(over!).at(-1)).toMatchObject({ transform: "translateY(100%)" });
  });

  it("приставка и «работка» — один поток строки: на одной базовой линии без центрирования боксов", () => {
    render(false);
    const slot = container.querySelector<HTMLElement>("span > span.inline-grid")!;
    const root = slot.parentElement!;

    // Коробка приставок встаёт в строку и выравнивается браузером по базовой линии.
    // Ни `overflow` (у такой коробки базовая линия — её дно), ни заданной высоты, ни
    // `items-center` у обёртки: дробное центрирование двух боксов разной высоты и
    // давало смещение приставки на точку, разное в разных браузерах.
    expect(slot.className).not.toMatch(/overflow|\bh-|items-center/);
    expect(slot.className).toContain("[clip-path:inset(0)]");
    expect(root.className).not.toMatch(/flex|grid|items-center/);
    expect(root.lastChild?.textContent).toBe("работка");
  });

  it("приставка на виду стоит без transform — иначе она рисуется на дробной высоте, а хвост рядом на целой", () => {
    render(false);
    const [under, over] = prefixes();
    expect(over!.style.transform).toBe("");
    expect(under!.style.transform).toBe("translateY(-100%)");

    render(true);
    const [underNow, overNow] = prefixes();
    expect(underNow!.style.transform).toBe("");
    expect(overNow!.style.transform).toBe("translateY(100%)");
  });
});
