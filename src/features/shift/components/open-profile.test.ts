/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Состояние входа подставляется: настоящий провайдер синхронизации тут не нужен.
const sync = vi.hoisted(() => ({ account: null as { email: string } | null }));
vi.mock("@/features/sync/ui/sync-provider", () => ({
  useSync: () => ({ account: sync.account }),
}));

import { createProfile } from "../storage/profile";
import { useConfirmSwitch } from "./open-profile";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  sync.account = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const profile = createProfile({
  displayName: "Тест",
  workingConditions: "normal",
  disabilityGroupIorII: false,
  firstShiftDate: "2026-10-21",
  accountingYear: 2026,
  shiftStartTime: "08:00",
  schedulePattern: "1|3",
  shiftDurationHours: "24",
  customWorkDays: 1,
  customRestDays: 3,
});

/**
 * Окна не рисуются: `dialog` в jsdom не умеет открываться, а проверять нужно
 * другое — пошёл ли человек дальше сразу или его остановил вопрос.
 */
function askOnce(changed: boolean): boolean {
  let proceeded = false;
  let ask: (proceed: () => void) => void = () => undefined;

  function Probe(): ReactNode {
    ask = useConfirmSwitch(profile, changed).ask;
    return null;
  }

  act(() => root.render(createElement(Probe)));
  act(() => ask(() => (proceeded = true)));
  return proceeded;
}

describe("вопрос о файле перед сменой графика", () => {
  it("гостю с несохранённой правкой — вопрос: дальше сразу не идём", () => {
    expect(askOnce(true)).toBe(false);
  });

  it("вошедшему вопроса нет: график лежит на сервере, файл ему не нужен", () => {
    sync.account = { email: "a@b.ru" };

    expect(askOnce(true)).toBe(true);
  });

  it("если график не правили — вопроса нет ни у кого", () => {
    expect(askOnce(false)).toBe(true);

    sync.account = { email: "a@b.ru" };
    expect(askOnce(false)).toBe(true);
  });
});
