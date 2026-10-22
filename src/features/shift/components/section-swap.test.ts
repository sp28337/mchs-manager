/** @vitest-environment jsdom */
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SECTION_EXIT_MS, useSectionSwap, type Section } from "./section-swap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
/** Переключатель пробного экрана: выставляется эффектом, а не на отрисовке. */
const handle: { go: ((target: Section) => void) | null } = { go: null };
const applied: Section[] = [];

/** Пробный экран: помнит раздел, как рабочий экран, и отдаёт переключатель наружу. */
function Probe({ start }: { start: Section }) {
  const [current, setCurrent] = useState<Section>(start);
  const swap = useSectionSwap(current, (next) => {
    applied.push(next);
    setCurrent(next);
  });
  useEffect(() => {
    handle.go = swap;
  });
  return createElement("output", null, current);
}

const shown = () => container.querySelector("output")?.textContent;
const exitTo = () => document.documentElement.getAttribute("data-exit-to");
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const press = (target: Section) => act(() => handle.go?.(target));

function reducedMotion(on: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: on }));
}

beforeEach(async () => {
  vi.useFakeTimers();
  reducedMotion(false);
  applied.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(createElement(Probe, { start: "calendar" })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-exit-to");
});

describe("смена раздела: уход, потом смена", () => {
  it("на нажатие ставит признак цели на корень и ничего не меняет", async () => {
    await press("stats");

    expect(exitTo()).toBe("stats");
    expect(applied).toEqual([]);
    expect(shown()).toBe("calendar");
  });

  it("раздел сменяется через срок ухода, а не раньше", async () => {
    await press("stats");

    await wait(SECTION_EXIT_MS - 1);
    expect(shown()).toBe("calendar");

    await wait(1);
    expect(shown()).toBe("stats");
    expect(applied).toEqual(["stats"]);
  });

  it("со сменой признак снимается: возвращённая прозрачность не должна проступать вторым ходом", async () => {
    await press("settings");
    await wait(SECTION_EXIT_MS);

    expect(exitTo()).toBeNull();
  });

  it("нажатие на открытый раздел ведёт к графику", async () => {
    await press("stats");
    await wait(SECTION_EXIT_MS);
    expect(shown()).toBe("stats");

    await press("stats");
    expect(exitTo()).toBe("calendar");
    await wait(SECTION_EXIT_MS);
    expect(shown()).toBe("calendar");
  });

  it("раздел на раздел: цель — новый, график посередине не показывается", async () => {
    await press("stats");
    await wait(SECTION_EXIT_MS);

    await press("events");
    await wait(SECTION_EXIT_MS);

    expect(applied).toEqual(["stats", "events"]);
    expect(shown()).toBe("events");
  });
});

describe("смена раздела: повторное нажатие во время ухода", () => {
  it("лишь меняет цель, а срок ухода остаётся прежним", async () => {
    await press("stats");
    await wait(SECTION_EXIT_MS / 2);

    await press("events");
    expect(exitTo()).toBe("events");

    await wait(SECTION_EXIT_MS / 2);
    expect(applied).toEqual(["events"]);
    expect(shown()).toBe("events");
  });

  it("нажатие на ту же цель второй раз — график, и смена всего одна", async () => {
    await press("stats");
    await wait(30);
    await press("stats");
    expect(exitTo()).toBe("calendar");

    await wait(SECTION_EXIT_MS);
    expect(applied).toEqual(["calendar"]);
    expect(shown()).toBe("calendar");
  });

  it("считается от цели ухода, а не от раздела на экране", async () => {
    await press("settings");
    await wait(20);
    // На экране ещё график, но идём в настройки: «настройки» второй раз — график.
    await press("settings");
    await wait(SECTION_EXIT_MS);

    expect(shown()).toBe("calendar");
  });

  it("после смены новый уход заводится заново", async () => {
    await press("stats");
    await wait(SECTION_EXIT_MS);

    await press("settings");
    expect(exitTo()).toBe("settings");
    await wait(SECTION_EXIT_MS - 1);
    expect(shown()).toBe("stats");
    await wait(1);
    expect(shown()).toBe("settings");
  });
});

describe("смена раздела: особые случаи", () => {
  it("у тех, кто просил поменьше движения, смена сразу и без признака", async () => {
    reducedMotion(true);

    await press("stats");

    expect(applied).toEqual(["stats"]);
    expect(shown()).toBe("stats");
    expect(exitTo()).toBeNull();
  });

  it("экран закрыт посреди ухода: признак не остаётся на корне, смена не случается", async () => {
    await press("stats");
    expect(exitTo()).toBe("stats");

    await act(() => root.unmount());
    await wait(SECTION_EXIT_MS * 2);

    expect(exitTo()).toBeNull();
    expect(applied).toEqual([]);

    // Заново, чтобы `afterEach` размонтировал живое дерево.
    root = createRoot(container);
    await act(() => root.render(createElement(Probe, { start: "calendar" })));
  });
});
