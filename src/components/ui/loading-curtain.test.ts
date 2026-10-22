/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CURTAIN_EXIT_MS,
  CURTAIN_SETTLE_MAX_MS,
  CURTAIN_SETTLE_MIN_MS,
  LoadingCurtain,
} from "./loading-curtain";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = (show: boolean, variant?: "page" | "navigation") =>
  act(() => root.render(createElement(LoadingCurtain, { show, label: "Открываем", variant })));

const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

/** Страница затихла: плёнка отсчитала спокойные проверки и приступила к уходу. */
const settle = () => wait(CURTAIN_SETTLE_MIN_MS);

/**
 * Главный поток занят: каждая проверка приходит с опозданием на длину «долгой
 * задачи». Часы тестов двигаются вместе с таймерами, поэтому опоздание
 * изображается прыжком текущего времени, а не самих таймеров.
 */
async function busy(ticks: number, late = 200) {
  for (let i = 0; i < ticks; i++) {
    vi.setSystemTime(Date.now() + late);
    await wait(16);
  }
}

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
  Reflect.deleteProperty(document, "fonts");
  Reflect.deleteProperty(document, "getAnimations");
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

  it("называет свой вид признаком: по нему стили различают плёнку экрана и плёнку перехода", async () => {
    await render(true);
    expect(film()?.getAttribute("data-curtain")).toBe("page");

    await render(true, "navigation");
    expect(film()?.getAttribute("data-curtain")).toBe("navigation");
  });

  it("если показывать нечего, не рисует ничего", async () => {
    await render(false);
    await wait(CURTAIN_SETTLE_MAX_MS + CURTAIN_EXIT_MS);

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

    await wait(CURTAIN_SETTLE_MIN_MS + CURTAIN_EXIT_MS - 1);
    expect(film()).not.toBeNull();

    await wait(1);
    expect(film()).toBeNull();
  });

  it("показали снова, пока она тает: плёнка возвращается и таймер ухода её не снимает", async () => {
    await render(true);
    await render(false);
    await wait(CURTAIN_SETTLE_MIN_MS + CURTAIN_EXIT_MS / 2);

    await render(true);
    expect(film()?.hasAttribute("data-leaving")).toBe(false);

    await wait(CURTAIN_EXIT_MS * 2);
    expect(film()).not.toBeNull();
    expect(film()?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("после полного ухода показывается снова", async () => {
    await render(true);
    await render(false);
    await wait(CURTAIN_SETTLE_MIN_MS + CURTAIN_EXIT_MS);
    expect(film()).toBeNull();

    await render(true);
    expect(film()).not.toBeNull();
    expect(mark()).not.toBeNull();
  });

  it("у тех, кто просил поменьше движения, уходит сразу — но тоже по затишью", async () => {
    const animate = vi.fn();
    Object.assign(Element.prototype, { animate, getAnimations: () => [] });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    await render(true);
    await render(false);
    await settle();
    // Нулевая задержка внутри таймера у тестовых часов — миллисекунда.
    await wait(1);

    expect(animate).not.toHaveBeenCalled();
    expect(film()).toBeNull();
  });
});

describe("плёнка загрузки: ожидание затишья", () => {
  /** Подмена Web Animations — чтобы видеть, когда растворение действительно началось. */
  function watchAnimate() {
    const animate = vi.fn(() => ({ cancel: () => undefined, onfinish: null }));
    Object.assign(Element.prototype, { animate, getAnimations: () => [] });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    return animate;
  }

  it("пока страница тяжело рисуется, плёнка на месте и не тает", async () => {
    const animate = watchAnimate();
    await render(true);
    await render(false);

    await busy(10);

    expect(animate).not.toHaveBeenCalled();
    expect(film()).not.toBeNull();
  });

  it("как только главный поток затих, начинает таять — не раньше нескольких спокойных проверок", async () => {
    const animate = watchAnimate();
    await render(true);
    await render(false);
    await busy(3);

    await wait(CURTAIN_SETTLE_MIN_MS - 1);
    expect(animate).not.toHaveBeenCalled();

    await wait(1);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("одна спокойная проверка между долгими задачами затишьем не считается", async () => {
    const animate = watchAnimate();
    await render(true);
    await render(false);

    // Тихо, тихо — и снова долгая задача: счёт спокойных проверок начинается заново.
    await wait(32);
    await busy(1);
    await wait(32);
    await busy(1);

    expect(animate).not.toHaveBeenCalled();
  });

  it("дольше потолка не ждёт: слабое устройство не должно держать плёнку вечно", async () => {
    const animate = watchAnimate();
    await render(true);
    await render(false);

    await busy(Math.floor(CURTAIN_SETTLE_MAX_MS / 16) - 2);
    expect(animate).not.toHaveBeenCalled();

    await busy(4);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("пока грузятся шрифты, ждёт: подмена текста под тающей плёнкой была бы видна", async () => {
    const animate = watchAnimate();
    const fonts = { status: "loading" };
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });

    await render(true);
    await render(false);
    await wait(CURTAIN_SETTLE_MIN_MS * 3);
    expect(animate).not.toHaveBeenCalled();

    fonts.status = "loaded";
    await wait(16);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  /** Подмена `document.getAnimations`: список чужих анимаций страницы, который можно менять. */
  function pageAnimations() {
    const list: unknown[] = [];
    Object.defineProperty(document, "getAnimations", { value: () => list, configurable: true });
    const running = (target: Node | null, iterations = 1) => ({
      playState: "running",
      effect: { getComputedTiming: () => ({ iterations }), target },
    });
    return { list, running };
  }

  it("пока на странице доигрывает вводная анимация (лампа), плёнка ждёт: два движения разом тормозят", async () => {
    const animate = watchAnimate();
    const { list, running } = pageAnimations();
    list.push(running(document.body));

    await render(true);
    await render(false);
    await wait(CURTAIN_SETTLE_MIN_MS * 4);
    expect(animate).not.toHaveBeenCalled();

    list.length = 0;
    await wait(16);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("бесконечные анимации не в счёт: клетки знака горят по кругу, и ждать их конца значило бы не уйти", async () => {
    const animate = watchAnimate();
    const { list, running } = pageAnimations();
    list.push(running(document.body, Infinity));

    await render(true);
    await render(false);
    await settle();

    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("анимации на самой плёнке тоже не в счёт", async () => {
    const animate = watchAnimate();
    const { list, running } = pageAnimations();

    await render(true);
    list.push(running(film()));
    await render(false);
    await settle();

    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("анимация, не закончившаяся вовремя, не держит плёнку дольше потолка", async () => {
    const animate = watchAnimate();
    const { list, running } = pageAnimations();
    list.push(running(document.body));

    await render(true);
    await render(false);
    await wait(CURTAIN_SETTLE_MAX_MS);

    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("показали снова, пока плёнка ждала затишья, — растворение не начинается вовсе", async () => {
    const animate = watchAnimate();
    await render(true);
    await render(false);
    await wait(32);

    await render(true);
    await wait(CURTAIN_SETTLE_MAX_MS * 2);

    expect(animate).not.toHaveBeenCalled();
    expect(film()?.hasAttribute("data-leaving")).toBe(false);
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
    await settle();

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
    await settle();

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
    await settle();

    // Появление знака снято (иначе оно доводило бы его до единицы), а значение
    // осталось прежним: призрак посреди ухода не мелькнёт.
    expect(cancelled).toContain("svg");
    expect(mark()?.style.opacity).toBe("0");
  });

  it("пока плёнка ждёт затишья, знак не трогается: он ещё на экране и должен идти как шёл", async () => {
    const { cancelled } = stubAnimations();
    await render(true);

    await render(false);
    await busy(5);

    expect(cancelled).not.toContain("svg");
    expect(mark()?.style.opacity).toBe("");
  });

  it("на время растворения на корне стоит признак (размытие дымки выключено), потом он снимается", async () => {
    const { fades } = stubAnimations();
    const root = document.documentElement;
    await render(true);
    await render(false);

    // Пока плёнка ждёт затишья, она ещё непрозрачна, и размытие трогать рано.
    expect(root.hasAttribute("data-curtain-fading")).toBe(false);

    await settle();
    expect(root.hasAttribute("data-curtain-fading")).toBe(true);

    await act(() => fades[0]!.onfinish?.());
    expect(root.hasAttribute("data-curtain-fading")).toBe(false);
  });

  it("возврат плёнки посреди растворения тоже снимает признак", async () => {
    stubAnimations();
    const root = document.documentElement;
    await render(true);
    await render(false);
    await settle();
    expect(root.hasAttribute("data-curtain-fading")).toBe(true);

    await render(true);
    expect(root.hasAttribute("data-curtain-fading")).toBe(false);
  });

  it("возврат плёнки отменяет растворение и отпускает знак", async () => {
    const { cancelled, fades } = stubAnimations();
    await render(true);
    mark()!.style.opacity = "0.5";

    await render(false);
    await settle();
    expect(mark()?.style.opacity).toBe("0.5");

    await render(true);
    expect(cancelled).toContain("fade");
    // Отменённое растворение не должно снять вернувшуюся плёнку по своему концу.
    expect(fades[0]!.onfinish).toBeNull();
    expect(mark()?.style.opacity).toBe("");
  });
});
