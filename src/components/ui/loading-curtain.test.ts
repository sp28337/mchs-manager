/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURTAIN_EXIT_MS, LoadingCurtain } from "./loading-curtain";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = (show: boolean, variant?: "page" | "navigation") =>
  act(() => root.render(createElement(LoadingCurtain, { show, label: "Открываем", variant })));

const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

const film = () => container.querySelector<HTMLElement>("div");
const mark = () => container.querySelector<SVGElement>(".loading-mark");

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "animate");
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

describe("плёнка загрузки: на месте", () => {
  it("рисует знак и слово для программы чтения, ничего не скрывая", async () => {
    await render(true);

    expect(mark()).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Открываем");
    expect(film()?.hasAttribute("data-leaving")).toBe(false);
    expect(film()?.hasAttribute("aria-hidden")).toBe(false);
    expect(film()?.className).not.toContain("pointer-events-none");
  });

  it("с первого кадра плотная: лист цвета страницы, без своего появления", async () => {
    await render(true);

    expect(film()?.className).toContain("bg-paper-sunken");
    expect(film()?.className).not.toContain("nav-loading");
  });

  it("при переходе появляется по-своему (`nav-loading`)", async () => {
    await render(true, "navigation");

    expect(film()?.className).toContain("nav-loading");
  });

  it("если показывать нечего, не рисует ничего", async () => {
    await render(false);
    await wait(CURTAIN_EXIT_MS * 2);

    expect(film()).toBeNull();
  });
});

describe("плёнка загрузки: уход", () => {
  it("уходит не рывком: тает в разметке, скрыта и не ловит нажатий, потом снимается", async () => {
    await render(true);
    await render(false);

    expect(film()).not.toBeNull();
    expect(film()?.hasAttribute("data-leaving")).toBe(true);
    expect(film()?.getAttribute("aria-hidden")).toBe("true");
    expect(film()?.className).toContain("pointer-events-none");

    await wait(CURTAIN_EXIT_MS - 1);
    expect(film()).not.toBeNull();

    await wait(1);
    expect(film()).toBeNull();
  });

  it("показали снова, пока она тает: плёнка возвращается и таймер ухода её не снимает", async () => {
    await render(true);
    await render(false);
    await wait(CURTAIN_EXIT_MS / 2);

    await render(true);
    expect(film()?.hasAttribute("data-leaving")).toBe(false);

    await wait(CURTAIN_EXIT_MS * 2);
    expect(film()).not.toBeNull();
    expect(film()?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("после полного ухода показывается снова", async () => {
    await render(true);
    await render(false);
    await wait(CURTAIN_EXIT_MS);
    expect(film()).toBeNull();

    await render(true);
    expect(film()).not.toBeNull();
    expect(mark()).not.toBeNull();
  });

  it("у тех, кто просил поменьше движения, уходит сразу", async () => {
    const animate = vi.fn();
    Object.assign(Element.prototype, { animate, getAnimations: () => [] });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    await render(true);
    await render(false);
    await wait(0);

    expect(animate).not.toHaveBeenCalled();
    expect(film()).toBeNull();
  });
});

describe("плёнка загрузки: растворение средствами браузера", () => {
  /** Подмена Web Animations: запоминает, что и как запустили, и умеет отменяться. */
  function stubAnimations() {
    const cancelled: string[] = [];
    const fades: { cancel: () => void; onfinish: (() => void) | null }[] = [];
    const animate = vi.fn(function (this: Element) {
      const fade = { cancel: () => void cancelled.push("fade"), onfinish: null };
      fades.push(fade);
      return fade;
    });
    const getAnimations = vi.fn(function (this: Element) {
      return [{ cancel: () => cancelled.push(this.tagName.toLowerCase()) }];
    });
    Object.assign(Element.prototype, { animate, getAnimations });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    return { animate, cancelled, fades };
  }

  it("идёт к нулю от той прозрачности, где плёнка застала уход, а не от единицы", async () => {
    const { animate, cancelled } = stubAnimations();
    await render(true, "navigation");

    // Плёнка проступала и дошла до сорока процентов — вот с них и надо идти вниз.
    film()!.style.opacity = "0.4";

    await render(false);

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith([{ opacity: "0.4" }, { opacity: 0 }], {
      duration: CURTAIN_EXIT_MS,
      easing: "ease-out",
      fill: "forwards",
    });
    // Прежние анимации появления сняты: иначе они держали бы плёнку на единице.
    expect(cancelled).toContain("div");
  });

  it("снимается, когда растворение кончилось, а не по таймеру: кадр мог прийти с опозданием", async () => {
    const { fades } = stubAnimations();
    await render(true);
    await render(false);

    // Таймер на всю длину растворения прошёл, но анимация ещё не кончилась —
    // например, страница под плёнкой тяжело рисовалась, и кадр не пришёл.
    await wait(CURTAIN_EXIT_MS * 3);
    expect(film()).not.toBeNull();

    await act(() => fades[0]!.onfinish?.());
    expect(film()).toBeNull();
  });

  it("знак замирает на том, что был: невидимый остаётся невидимым", async () => {
    const { cancelled } = stubAnimations();
    await render(true);

    mark()!.style.opacity = "0";
    await render(false);

    // Появление знака снято (иначе оно доводило бы его до единицы), а значение
    // осталось прежним: призрак посреди ухода не мелькнёт.
    expect(cancelled).toContain("svg");
    expect(mark()?.style.opacity).toBe("0");
  });

  it("возврат плёнки отменяет растворение и отпускает знак", async () => {
    const { cancelled, fades } = stubAnimations();
    await render(true);
    mark()!.style.opacity = "0.5";

    await render(false);
    expect(mark()?.style.opacity).toBe("0.5");

    await render(true);
    expect(cancelled).toContain("fade");
    // Отменённое растворение не должно снять вернувшуюся плёнку по своему концу.
    expect(fades[0]!.onfinish).toBeNull();
    expect(mark()?.style.opacity).toBe("");
  });
});
