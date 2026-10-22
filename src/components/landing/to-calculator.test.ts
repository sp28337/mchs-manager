/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CtaBody } from "./to-calculator";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("знак кнопки первого экрана", () => {
  // Надпись — третьим аргументом, как велит правило React; тип же требует
  // `children` среди свойств, поэтому свойства приводятся к типу целиком.
  const render = (size?: "sm" | "md") =>
    act(() =>
      root.render(
        createElement(CtaBody, { size } as Parameters<typeof CtaBody>[0], "Открыть график"),
      ),
    );

  it("тот же знак, что у «График» в левом столбце: четыре клетки знака сайта", () => {
    render();

    const tile = container.querySelector("span[aria-hidden]")!;
    expect(tile.querySelectorAll("svg > rect")).toHaveLength(4);
    // Не «календарик»: у того нет четырёх квадратов.
    expect(tile.querySelector("svg path[d*='M8 2v4']")).toBeNull();
  });

  it("залитая клетка зелёная, а не красная", () => {
    render();

    const tile = container.querySelector("span[aria-hidden]")!;
    // Тот же класс, что красит знак у нижнего ряда: заливка первой клетки.
    expect(tile.className).toContain("[&_svg>rect:first-child]:fill-verify");
  });

  it("под знаком нет ни рамки, ни заливки: он стоит прямо на бумаге плашки", () => {
    render();

    const tile = container.querySelector("span[aria-hidden]")!;
    const classes = tile.className.split(/\s+/);
    expect(classes.some((name) => /^(border|bg-|rounded|ring|shadow)/.test(name))).toBe(false);
  });

  it("у обоих размеров знак без поправки размера знака сайта", () => {
    for (const size of ["sm", "md"] as const) {
      render(size);
      const icon = container.querySelector("span[aria-hidden] svg")!;
      expect(icon.getAttribute("class")).toContain("scale-100");
      expect(icon.getAttribute("class")).toContain(size === "sm" ? "size-5.5" : "size-7");
    }
  });

  it("надпись и стрелка на месте, а знак и стрелка скрыты от программы чтения", () => {
    render();

    expect(container.textContent).toBe("Открыть график");
    expect(container.querySelectorAll("[aria-hidden]").length).toBeGreaterThanOrEqual(2);
  });
});
