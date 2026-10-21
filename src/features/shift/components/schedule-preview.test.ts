/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProfile, type StoredProfile } from "../storage/profile";
import { SchedulePreview } from "./schedule-preview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

// 21 октября 2026, среда: в окне стола — с 19 октября по 22 ноября.
const TODAY = new Date(2026, 9, 21, 12);

function profile(over: Partial<StoredProfile> = {}): StoredProfile {
  return createProfile({
    displayName: "",
    workingConditions: "normal",
    disabilityGroupIorII: false,
    firstShiftDate: "2026-10-21",
    accountingYear: 2026,
    shiftStartTime: "08:00",
    schedulePattern: "1|3",
    shiftDurationHours: "24",
    customWorkDays: 1,
    customRestDays: 3,
    ...over,
  });
}

function render(value: StoredProfile, round = 1) {
  act(() => root.render(createElement(SchedulePreview, { profile: value, round })));
}

const cells = () => container.querySelectorAll(".stage-cell");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("стол в окне «Создать график»", () => {
  it("пять недель клетками, сегодня отмечено один раз — красным кольцом", () => {
    render(profile());

    expect(cells()).toHaveLength(35);

    const marked = [...cells()].filter((cell) =>
      cell.firstElementChild?.className.includes("inset-ring-signal"),
    );
    expect(marked).toHaveLength(1);
    // Окно начинается с понедельника 19 октября: сегодня в нём третья клетка.
    expect(marked[0]?.textContent).toContain("21");
  });

  it("пустое имя — блёклое «Ваш график», а названное встаёт над сеткой как есть", () => {
    render(profile());
    expect(container.querySelector(".font-hand")?.textContent).toBe("Ваш график");

    render(profile({ displayName: "Пожарная часть 12" }));
    expect(container.querySelector(".font-hand")?.textContent).toBe("Пожарная часть 12");
  });

  it("сетка скрыта от программы чтения, вместо неё — одна фраза про ближайшие смены", () => {
    render(profile());

    expect(container.querySelector("[aria-hidden] .stage-cell")).not.toBeNull();
    expect(container.querySelector(".sr-only")?.textContent).toBe(
      "Сутки через трое. Ближайшие смены: 21 октября, 25 октября, 29 октября, 2 ноября.",
    );
  });

  it("свой цикл называется тем, что задал человек, а не словом «Настроить»", () => {
    render(profile({ schedulePattern: "custom", customWorkDays: 3, customRestDays: 1 }));

    expect(container.textContent).toContain("Свой цикл 3|1");
    expect(container.textContent).not.toContain("Настроить");
  });

  it("правка ответа перестраивает клетки: «2|2» вместо «1|3»", () => {
    const hours = (value: StoredProfile) => {
      render(value);
      return [...cells()].map((cell) => cell.textContent);
    };

    const daily = hours(profile());
    const twoByTwo = hours(profile({ schedulePattern: "2|2", shiftDurationHours: "12" }));
    expect(twoByTwo).not.toEqual(daily);
  });

  it("итог месяца подписан октябрём", () => {
    render(profile());

    expect(container.textContent).toContain("Итог месяца · Октябрь");
  });
});
