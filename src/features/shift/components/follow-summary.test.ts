/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FollowSummary, summaryLift } from "./follow-summary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("смещение полосы цифр", () => {
  // Полоса закреплена на 96 от верха окна и высотой 68: её низ — на 164.
  const strip = { stuckTop: 96, height: 68 };

  it("пока низ контейнера не выше низа полосы — нуль", () => {
    expect(summaryLift({ ...strip, containerBottom: 900 })).toBe(0);
    expect(summaryLift({ ...strip, containerBottom: 164 })).toBe(0);
  });

  it("когда контейнер кончается раньше, полоса ложится на его низ", () => {
    expect(summaryLift({ ...strip, containerBottom: 134 })).toBe(-30);
    expect(summaryLift({ ...strip, containerBottom: -100 })).toBe(-264);
  });
});

describe("кнопка периода следует за полосой", () => {
  let host: HTMLDivElement;
  let page: HTMLElement;
  let root: Root;
  let containerBottom = 900;

  /** Полоса и её контейнер — как в `workspace.tsx`: `main` и `[data-summary]` в нём. */
  beforeEach(() => {
    containerBottom = 900;
    page = document.createElement("main");
    page.getBoundingClientRect = () => ({ bottom: containerBottom }) as DOMRect;

    const strip = document.createElement("div");
    strip.setAttribute("data-summary", "");
    strip.style.top = "96px";
    Object.defineProperty(strip, "offsetHeight", { value: 68 });
    page.append(strip);
    document.body.append(page);

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    page.remove();
  });

  const wrapper = () => host.firstElementChild as HTMLElement;

  function mount() {
    act(() => root.render(createElement(FollowSummary, null, createElement("button", null, "Период"))));
  }

  async function scrolled() {
    window.dispatchEvent(new Event("scroll"));
    // Пересчёт — раз за кадр, а не на каждое событие.
    await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  }

  it("детей не трогает", () => {
    mount();
    expect(wrapper().textContent).toBe("Период");
  });

  it("пока полоса закреплена, кнопка стоит на месте", () => {
    mount();
    expect(wrapper().style.transform).toBe("");
  });

  it("при открытии уже в конце страницы встаёт сразу, без прокрутки", () => {
    containerBottom = 134;
    mount();
    expect(wrapper().style.transform).toBe("translateY(-30px)");
  });

  it("уезжает вверх вместе с полосой и возвращается обратно", async () => {
    mount();

    containerBottom = 134;
    await scrolled();
    expect(wrapper().style.transform).toBe("translateY(-30px)");

    containerBottom = -100;
    await scrolled();
    expect(wrapper().style.transform).toBe("translateY(-264px)");

    containerBottom = 900;
    await scrolled();
    expect(wrapper().style.transform).toBe("");
  });

  it("без полосы на странице (проводник, настройки) ничего не двигает", () => {
    page.querySelector("[data-summary]")?.remove();
    containerBottom = 0;
    mount();
    expect(wrapper().style.transform).toBe("");
  });

  it("при размонтировании возвращает кнопку на место и слушателей не оставляет", async () => {
    containerBottom = 134;
    mount();
    const node = wrapper();
    expect(node.style.transform).not.toBe("");

    act(() => root.unmount());
    expect(node.style.transform).toBe("");

    // Прокрутка после размонтирования ничего не ломает и ничего не пишет.
    containerBottom = -100;
    window.dispatchEvent(new Event("scroll"));
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
    expect(node.style.transform).toBe("");

    // `afterEach` размонтирует корень ещё раз — пустой корень это переносит.
    root = createRoot(host);
  });
});
