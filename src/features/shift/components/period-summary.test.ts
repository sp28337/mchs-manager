/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Dec } from "../domain/decimal";
import { SummaryExtras, type FigurePairs, type MinorTotals } from "./period-summary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const totals: MinorTotals = {
  scheduledShifts: 91,
  workedShifts: 73,
  absentShifts: 18,
  nightHours: new Dec(584),
  holidayHours: new Dec(48),
};

let host: HTMLDivElement;
let root: Root;

const render = (pairs: FigurePairs) =>
  act(() => root.render(createElement(SummaryExtras, { totals, pairs })));

/** Подписи и числа так, как их видит человек: «Отработано: 73 см». */
const shown = () =>
  [...host.querySelectorAll("dt")].map((caption) => {
    const figure = caption.parentElement!;
    return `${caption.textContent}: ${figure.querySelector("dd")?.textContent}`;
  });

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("продолжение полосы цифр", () => {
  it("когда полоса не показала ни одной пары, дописывает всё остальное — по порядку полосы", async () => {
    await render(0);

    expect(shown()).toEqual([
      "По графику: 91см",
      "Отработано: 73см",
      "Пропущено: 18см",
      "Ночные: 584ч",
      "Праздничные: 48ч",
    ]);
  });

  it("полоса показала по числу с каждой стороны — дописывается только то, чего там нет", async () => {
    await render(1);

    // «По графику» и «Ночные» уже наверху; повторять их — эхо, а не продолжение.
    expect(shown()).toEqual(["Отработано: 73см", "Пропущено: 18см", "Праздничные: 48ч"]);
  });

  it("полоса показала всё — второго ряда нет вовсе", async () => {
    await render(2);

    expect(host.querySelector("dl")).toBeNull();
  });

  it("числа стоят колонками одной ширины и переносятся, а не лезут за край", async () => {
    await render(0);

    const row = host.querySelector("dl");
    expect(row?.className).toContain("flex-wrap");
    expect(row?.className).toContain("justify-center");
    for (const figure of row!.children) expect(figure.className).toContain("w-24");
  });

  it("у каждого числа есть подсказка — подписи вроде «с 22 до 6» живут в ней", async () => {
    await render(0);

    const hints = [...host.querySelectorAll("dl > div")].map((it) => it.getAttribute("title"));
    expect(hints.every((hint) => hint !== null && hint.length > 10)).toBe(true);
    expect(hints.find((hint) => hint?.startsWith("Ночные"))).toContain("22:00");
  });
});
