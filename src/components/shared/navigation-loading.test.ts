/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Маршрутизатор в тесте: адрес и вызовы подставляются, настоящего нет.
const mocked = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocked.pathname,
  useRouter: () => ({ push: mocked.push, replace: mocked.replace }),
}));

import { CURTAIN_EXIT_MS, CURTAIN_SETTLE_MIN_MS } from "@/components/ui/loading-curtain";
import { NavigationLoading, startNavigation, useNavigate } from "./navigation-loading";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = () => act(() => root.render(createElement(NavigationLoading)));

/** Знак на месте и держит страницу; уходящий (`data-leaving`) уже не в счёт. */
const shown = () => container.querySelector(".nav-loading:not([data-leaving])") !== null;

/** Плёнка есть в разметке — на месте или ещё растворяется. */
const present = () => container.querySelector(".nav-loading") !== null;

/** Нажатие на ссылку так, как оно доходит до документа: `Link` уже отменил переход. */
function clickLink(href: string, init: MouseEventInit & { prevent?: boolean; target?: string } = {}) {
  const link = document.createElement("a");
  link.href = href;
  if (init.target !== undefined) link.target = init.target;
  if (init.prevent !== false) link.addEventListener("click", (event) => event.preventDefault());
  document.body.append(link);

  link.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }),
  );
  link.remove();
}

const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

/** Нажатие и вызов из кода — внутри `act`: эффект с таймером должен встать до того, как время пойдёт. */
const click = (href: string, init?: Parameters<typeof clickLink>[1]) =>
  act(() => clickLink(href, init));
const start = (href: string) => act(() => startNavigation(href));

beforeEach(async () => {
  vi.useFakeTimers();
  mocked.pathname = "/";
  mocked.push.mockClear();
  mocked.replace.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("загрузка при переходе", () => {
  it("затянувшийся переход по ссылке показывает знак, а смена страницы его убирает", async () => {
    await click("/calculator");
    expect(shown()).toBe(false); // сразу — нет: быстрый переход мигать не должен

    await wait(130);
    expect(shown()).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Загружаем страницу");

    mocked.pathname = "/calculator";
    await render();
    expect(shown()).toBe(false);
  });

  it("знак уходит не рывком: пока растворяется, он в разметке, но скрыт и не ловит нажатий", async () => {
    await click("/calculator");
    await wait(130);
    expect(present()).toBe(true);

    mocked.pathname = "/calculator";
    await render();

    const film = container.querySelector<HTMLElement>(".nav-loading");
    expect(film).not.toBeNull(); // страница открылась, а знак ещё тает
    expect(film?.hasAttribute("data-leaving")).toBe(true);
    expect(film?.getAttribute("aria-hidden")).toBe("true");
    expect(film?.className).toContain("pointer-events-none");

    // Знак ждёт, пока новая страница затихнет, и только потом тает.
    await wait(CURTAIN_SETTLE_MIN_MS + CURTAIN_EXIT_MS - 1);
    expect(present()).toBe(true);

    await wait(1);
    expect(present()).toBe(false);
  });

  it("если страница не открылась и знак отступился, он тоже растворяется, а не пропадает", async () => {
    await click("/calculator");
    await wait(200);

    await wait(10_000);
    expect(shown()).toBe(false);
    expect(present()).toBe(true);

    await wait(CURTAIN_SETTLE_MIN_MS + CURTAIN_EXIT_MS);
    expect(present()).toBe(false);
  });

  it("новый переход, пока прежний знак тает, возвращает знак на место", async () => {
    await click("/calculator");
    await wait(130);
    mocked.pathname = "/calculator";
    await render();
    expect(shown()).toBe(false);
    expect(present()).toBe(true);

    await click("/help");
    await wait(130);

    expect(shown()).toBe(true);
    expect(container.querySelectorAll(".nav-loading")).toHaveLength(1);

    // Старый таймер ухода не должен снять вернувшийся знак.
    await wait(CURTAIN_EXIT_MS);
    expect(shown()).toBe(true);
  });

  it("быстрый переход знака не показывает вовсе", async () => {
    await click("/calculator");
    await wait(50);

    mocked.pathname = "/calculator";
    await render();
    await wait(500);

    expect(present()).toBe(false);
  });

  it("ссылку, которую ведёт браузер, а не приложение, знаком не встречают", async () => {
    await click("/calculator", { prevent: false });
    await wait(500);

    expect(present()).toBe(false);
  });

  it("переход на ту же страницу (другой якорь) ничего не начинает", async () => {
    await click("/#build");
    await wait(500);

    expect(shown()).toBe(false);
  });

  it("чужой сайт, новая вкладка и клик с клавишей — не переход в этой вкладке", async () => {
    await click("https://example.org/");
    await click("/calculator", { target: "_blank" });
    await click("/calculator", { ctrlKey: true });
    await click("/calculator", { metaKey: true });
    await click("/calculator", { shiftKey: true });
    await wait(500);

    expect(shown()).toBe(false);
  });

  it("если страница так и не открылась, знак уходит сам", async () => {
    await click("/calculator");
    await wait(200);
    expect(shown()).toBe(true);

    await wait(10_000);
    expect(shown()).toBe(false);
  });

  it("два перехода подряд к одному адресу: второй снова ждёт, а не наследует показ", async () => {
    await click("/calculator");
    await wait(200);
    mocked.pathname = "/calculator";
    await render();
    expect(shown()).toBe(false);

    mocked.pathname = "/";
    await render();
    await click("/calculator");
    expect(shown()).toBe(false);

    await wait(130);
    expect(shown()).toBe(true);
  });

  it("startNavigation без нажатия на ссылку — те же правила", async () => {
    await start("/help");
    await wait(130);
    expect(shown()).toBe(true);

    await start("https://example.org/");
    mocked.pathname = "/help";
    await render();
    expect(shown()).toBe(false);
  });
});

describe("useNavigate", () => {
  function Probe({ href, mode }: { href: string; mode: "push" | "replace" }) {
    const navigate = useNavigate();
    return createElement("button", { id: "go", onClick: () => navigate[mode](href) });
  }

  it("ведёт переход через маршрутизатор и показывает знак, если он затянулся", async () => {
    await act(() =>
      root.render(
        createElement("div", null, createElement(NavigationLoading), createElement(Probe, { href: "/calculator", mode: "push" })),
      ),
    );

    await act(() => container.querySelector<HTMLButtonElement>("#go")?.click());
    expect(mocked.push).toHaveBeenCalledWith("/calculator");

    await wait(130);
    expect(shown()).toBe(true);
  });

  it("replace тоже", async () => {
    await act(() =>
      root.render(
        createElement("div", null, createElement(NavigationLoading), createElement(Probe, { href: "/", mode: "replace" })),
      ),
    );
    mocked.pathname = "/calculator";
    await render();
    await act(() =>
      root.render(
        createElement("div", null, createElement(NavigationLoading), createElement(Probe, { href: "/", mode: "replace" })),
      ),
    );

    await act(() => container.querySelector<HTMLButtonElement>("#go")?.click());
    expect(mocked.replace).toHaveBeenCalledWith("/");
  });
});
