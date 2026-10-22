/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ctaClass, CtaBody } from "./to-calculator";

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

  it("надпись одна для программы чтения: невидимая, что держит ширину, скрыта", () => {
    render();

    // Видимой остаётся одна надпись; под самую длинную отведено место, но
    // озвучиваться она не должна — иначе кнопка называлась бы двумя.
    const heard = [...container.querySelectorAll("span")]
      .filter((el) => el.children.length === 0 && !el.closest("[aria-hidden='true']"))
      .map((el) => el.textContent)
      .filter(Boolean);
    expect(heard).toEqual(["Открыть график"]);
    expect(container.querySelector(".invisible")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".invisible")?.textContent).toBe("Построить график");
  });
});

describe("стрелка кнопки", () => {
  const render = (size?: "sm" | "md") =>
    act(() =>
      root.render(
        createElement(CtaBody, { size } as Parameters<typeof CtaBody>[0], "Открыть график"),
      ),
    );
  const arrow = () => container.querySelector("svg.lucide-arrow-right")!;

  it("стоит по середине свободного места: зона растягивается, стрелка в ней по центру", () => {
    render();

    const zone = arrow().parentElement!;
    expect(zone.className).toContain("flex-1");
    expect(zone.className).toContain("justify-center");
    // Зона лежит в одной клетке с видимой надписью, а не после неё: иначе запас,
    // оставленный под самую длинную надпись, лёг бы между текстом и стрелкой.
    expect(zone.parentElement?.className).toContain("col-start-1");
  });

  it("у невидимой надписи место под зону стрелки той же ширины: два поля и сама стрелка", () => {
    render();
    expect(container.querySelector(".invisible span")?.className).toContain("w-17");

    render("sm");
    expect(container.querySelector(".invisible span")?.className).toContain("w-12");
  });

  it("плавно отъезжает под указателем и под фокусом; переход назван по `translate`", () => {
    render();

    const classes = arrow().getAttribute("class") ?? "";
    expect(classes).toContain("group-hover:translate-x-1.5");
    expect(classes).toContain("group-focus-visible:translate-x-1.5");
    // В Tailwind 4 сдвиг пишет свойство `translate`; переход, назначенный на
    // `transform`, его не видит, и стрелка прыгала.
    expect(classes).toContain("transition-[translate,color]");
    expect(classes).not.toContain("transition-[transform");
    expect(classes).toMatch(/duration-\d+/);
  });

  it("справа от стрелки поля плашки нет: зазор до края задаёт сама зона", () => {
    for (const size of ["sm", "md"] as const) {
      const classes = ctaClass(size).split(/\s+/);
      expect(classes.some((name) => /^pr-/.test(name))).toBe(false);
    }
  });

  it("стрелка скрыта от программы чтения", () => {
    render();
    expect(arrow().closest("[aria-hidden='true']")).not.toBeNull();
  });
});
