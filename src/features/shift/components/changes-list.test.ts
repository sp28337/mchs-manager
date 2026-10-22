/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changeCountOf } from "../model/derive";
import type { StoredProfile } from "../storage/profile";
import { ChangesList, changesOf } from "./changes-list";
import { blankProfile } from "./create-profile-modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Сегодня — пятница, 10 июля 2026: посреди отпуска, с прошлым и будущим.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(2026, 6, 10, 12, 0, 0));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const withEvents = (extra: Partial<StoredProfile> = {}): StoredProfile => ({
  ...blankProfile(),
  accountingYear: 2026,
  absences: [
    { id: "sick", kind: "sick_leave", startsOn: "2026-03-10", endsOn: "2026-03-20" },
    { id: "leave", kind: "annual_leave", startsOn: "2026-07-06", endsOn: "2026-07-26" },
  ],
  callouts: [
    { id: "call", kind: "callout", startsOn: "2026-09-13", endsOn: "2026-09-13", hoursPerDay: "14" },
  ],
  dayNotes: { "2026-03-12": "Был на приёме" },
  ...extra,
});

const noop = () => undefined;

/** Список с живым состоянием: правка профиля видна в разметке, как на странице. */
function mount(initial: StoredProfile, onOpenCalendar: () => void = noop) {
  const seen: { profile: StoredProfile } = { profile: initial };
  function Harness() {
    const [profile, setProfile] = useState(initial);
    seen.profile = profile;
    return createElement(ChangesList, {
      profile,
      onChange: (change: (previous: StoredProfile) => StoredProfile) => setProfile(change),
      onOpenProfile: noop,
      onOpenCalendar,
    });
  }
  act(() => root.render(createElement(Harness)));
  return seen;
}

/** Заголовки месяцев: название и счёт — двумя словами через пробел. */
const headings = () =>
  [...container.querySelectorAll("h3")].map((it) =>
    [...it.children].map((part) => part.textContent?.trim()).join(" "),
  );
const button = (name: RegExp | string) => {
  const found = [...container.querySelectorAll("button")].find((it) => {
    const label = it.getAttribute("aria-label") ?? it.textContent ?? "";
    return typeof name === "string" ? label.trim() === name : name.test(label);
  });
  if (found === undefined) throw new Error(`нет кнопки ${String(name)}`);
  return found;
};
/** Клик с клавиатуры: `detail` у него 0, как у Enter и пробела на кнопке. */
const click = (el: Element) => act(() => (el as HTMLElement).click());
/** Клик мышью: у настоящего щелчка `detail` — число нажатий подряд, то есть 1. */
const mouseClick = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });

describe("лента по месяцам", () => {
  it("над каждым месяцем заголовок со счётом, строки по порядку дат", () => {
    mount(withEvents());

    expect(headings()).toEqual([
      "Март 2026 2 события",
      "Июль 2026 1 событие",
      "Сентябрь 2026 1 событие",
    ]);
    const titles = [...container.querySelectorAll("li button[aria-label^='Изменить']")].map((it) =>
      it.getAttribute("aria-label"),
    );
    expect(titles).toEqual([
      "Изменить: Больничный, 10–20 марта · 11 дн.",
      "Изменить: Был на приёме, Заметка · 12 марта, чт",
      "Изменить: Отпуск, 6–26 июля · 21 дн.",
      "Изменить: Вызов, 13 сентября, вс · 14 ч в сутки",
    ]);
  });

  it("линия «сегодня» стоит после идущего отпуска и перед будущим, а отпуск помечен «Идёт»", () => {
    mount(withEvents());

    const items = [...container.querySelectorAll("ul > li")].map((it) => it.textContent ?? "");
    const leave = items.findIndex((it) => it.includes("Отпуск"));
    const today = items.findIndex((it) => it.includes("Сегодня · 10 июля, пт"));
    const september = items.findIndex((it) => it.includes("Сентябрь 2026"));

    expect(leave).toBeGreaterThan(-1);
    expect(today).toBe(leave + 1);
    expect(september).toBe(today + 1);
    expect(items[leave]).toContain("Идёт");
    // У будущего и прошедшего метки нет.
    expect(items.filter((it) => /Идёт/.test(it))).toHaveLength(1);
  });

  it("если всё в прошлом, линии «сегодня» нет", () => {
    mount(
      withEvents({
        absences: [{ id: "a", kind: "sick_leave", startsOn: "2026-02-02", endsOn: "2026-02-04" }],
        callouts: [],
        dayNotes: {},
      }),
    );

    expect(container.textContent).not.toContain("Сегодня ·");
  });
});

describe("фильтр", () => {
  it("кнопки групп со счётом; нажатая сужает ленту, «Все» возвращает", () => {
    mount(withEvents());

    expect(
      [...container.querySelectorAll("[role=group] button")].map((it) => it.textContent),
    ).toEqual(["Все4", "Отсутствия2", "Вызовы1", "Заметки1"]);

    click(button(/^Вызовы/));
    expect(button(/^Вызовы/).getAttribute("aria-pressed")).toBe("true");
    expect(headings()).toEqual(["Сентябрь 2026 1 событие"]);

    click(button(/^Все/));
    expect(headings()).toHaveLength(3);
  });

  it("при одной группе кнопок нет: выбирать не из чего", () => {
    mount(withEvents({ callouts: [], dayNotes: {}, absences: [withEvents().absences[0]!] }));
    expect(container.querySelector("[role=group]")).toBeNull();
  });
});

describe("убрать и вернуть", () => {
  it("убранная строка остаётся полоской «Убрано», «Вернуть» кладёт запись назад", () => {
    const seen = mount(withEvents());
    expect(seen.profile.absences).toHaveLength(2);

    click(button(/^Убрать: Отпуск/));
    expect(seen.profile.absences.map((it) => it.id)).toEqual(["sick"]);
    expect(container.textContent).toContain("Убрано: Отпуск");

    click(button("Вернуть"));
    expect(seen.profile.absences.map((it) => it.id).sort()).toEqual(["leave", "sick"]);
    expect(container.textContent).not.toContain("Убрано: Отпуск");
    // Фокус вернулся на строку: с клавиатуры не оказаться в начале страницы.
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Изменить: Отпуск, 6–26 июля · 21 дн.",
    );
  });

  it("после клика мышью полоска исчезает через восемь секунд", () => {
    mount(withEvents());
    mouseClick(button(/^Убрать: Вызов/));
    expect(container.textContent).toContain("Убрано: Вызов");

    act(() => vi.advanceTimersByTime(7900));
    expect(container.textContent).toContain("Убрано: Вызов");
    act(() => vi.advanceTimersByTime(200));
    expect(container.textContent).not.toContain("Убрано: Вызов");
  });

  it("с клавиатуры фокус уходит на «Вернуть» и время стоит, пока он там", () => {
    mount(withEvents());
    click(button(/^Убрать: Вызов/));

    expect(document.activeElement?.textContent).toContain("Вернуть");
    act(() => vi.advanceTimersByTime(60_000));
    expect(container.textContent).toContain("Убрано: Вызов");

    // Фокус ушёл — отсчёт пошёл заново.
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => vi.advanceTimersByTime(8100));
    expect(container.textContent).not.toContain("Убрано: Вызов");
  });

  it("пока на полоске курсор, время не идёт", () => {
    mount(withEvents());
    mouseClick(button(/^Убрать: Вызов/));

    const strip = container.querySelector("[role=status]") as HTMLElement;
    act(() => {
      strip.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      strip.dispatchEvent(new PointerEvent("pointerenter"));
    });
    act(() => vi.advanceTimersByTime(30_000));
    expect(container.textContent).toContain("Убрано: Вызов");

    act(() => {
      strip.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
      strip.dispatchEvent(new PointerEvent("pointerleave"));
    });
    act(() => vi.advanceTimersByTime(8100));
    expect(container.textContent).not.toContain("Убрано: Вызов");
  });

  it("убрана последняя заметка — её кнопка фильтра гаснет, лента показывает всё", () => {
    mount(withEvents());
    click(button(/^Заметки/));
    expect(headings()).toEqual(["Март 2026 1 событие"]);

    click(button(/^Убрать: Был на приёме/));
    expect(button(/^Все/).getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Больничный");
  });
});

describe("обратное к удалению", () => {
  /**
   * Главное свойство: убрать и вернуть — значит оказаться там же, откуда
   * начали. Проверяется на профиле, где по одной записи каждого вида: у
   * массивов порядок после возврата другой, а у единственной записи его нет.
   */
  it("у каждого вида записи restore(remove(профиль)) равно профилю", () => {
    const profile = withEvents({
      absences: [{ id: "leave", kind: "annual_leave", startsOn: "2026-07-06", endsOn: "2026-07-26" }],
      callouts: [{ id: "call", kind: "callout", startsOn: "2026-09-13", endsOn: "2026-09-13", hoursPerDay: "14" }],
      shiftOverrides: { "2026-05-01": "shift", "2026-05-02": "off" },
      shiftTimes: { "2026-05-03": { startsAt: "09:00", endsAt: "13:00" } },
      calendarOverrides: { "2026-05-04": "holiday" },
      countFrom: "2026-02-01",
      dayNotes: { "2026-03-12": "Был на приёме" },
    });

    const rows = changesOf(profile);
    expect(rows.map((it) => it.id).sort()).toEqual(
      [
        "absence:leave",
        "callout:call",
        "shift:2026-05-01",
        "shift:2026-05-02",
        "time:2026-05-03",
        "calendar:2026-05-04",
        "count-from",
        "note:2026-03-12",
      ].sort(),
    );

    for (const row of rows) {
      const removed = row.remove(profile);
      expect(removed, row.id).not.toEqual(profile);
      expect(row.restore(removed), row.id).toEqual(profile);
    }
  });

  it("число внесённого, которое видит окно сохранения, равно числу строк перечня", () => {
    const full = withEvents({
      shiftOverrides: { "2026-05-01": "shift", "2026-05-02": "off" },
      shiftTimes: { "2026-05-03": { startsAt: "09:00", endsAt: "13:00" } },
      calendarOverrides: { "2026-05-04": "holiday" },
      countFrom: "2026-02-01",
    });
    expect(changeCountOf(full)).toBe(changesOf(full).length);
    expect(changeCountOf(withEvents())).toBe(changesOf(withEvents()).length);
    // Пустое начало отсчёта — не правка, а умолчание.
    expect(changeCountOf({ ...full, countFrom: null })).toBe(changesOf({ ...full, countFrom: null }).length);
    expect(changeCountOf(withEvents({ absences: [], callouts: [], dayNotes: {} }))).toBe(0);
  });

  it("возврат того, что уже на месте, ничего не удваивает", () => {
    const profile = withEvents();
    for (const row of changesOf(profile)) {
      expect(row.restore(profile), row.id).toEqual(profile);
    }
  });
});

describe("пустой раздел", () => {
  it("говорит, что делать, и ведёт к календарю", () => {
    const onOpenCalendar = vi.fn();
    mount(withEvents({ absences: [], callouts: [], dayNotes: {} }), onOpenCalendar);

    expect(container.textContent).toContain("Событий пока нет");
    expect(container.querySelector("ul")).toBeNull();

    click(button("К календарю"));
    expect(onOpenCalendar).toHaveBeenCalledTimes(1);
  });
});
