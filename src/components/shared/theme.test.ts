/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  THEME_MARK_SCRIPT,
  THEME_STORAGE_KEY,
  parseTheme,
  resolveTheme,
  type Theme,
} from "./theme";
import { ThemeProvider, useTheme } from "./theme-provider";

// Окружение отрисовки: без этой метки `act` ругается на каждую смену состояния.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Системная тема в тесте: jsdom `matchMedia` не знает, ответ подставляется. */
let systemDark = false;
const queryListeners = new Set<() => void>();

beforeEach(() => {
  systemDark = false;
  queryListeners.clear();
  window.matchMedia = ((query: string) => ({
    matches: query.includes("dark") ? systemDark : false,
    media: query,
    addEventListener: (_: string, listener: () => void) => queryListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => queryListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});

describe("parseTheme и resolveTheme", () => {
  it("знает три положения и отбрасывает чужое", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("sepia")).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });

  it("«как в системе» — то, что сейчас у системы", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("сценарий до первой отрисовки", () => {
  const run = () => new Function(THEME_MARK_SCRIPT)();
  const root = document.documentElement;

  it("без записи — тёмная, как у человека, который ничего не выбирал", () => {
    run();
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("выбранная светлая или тёмная кладётся как есть, а чужой класс снимается", () => {
    root.classList.add("dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    run();
    expect(root.classList.contains("light")).toBe(true);
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
  });

  it("«как в системе» спрашивает систему", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");

    systemDark = true;
    run();
    expect(root.classList.contains("dark")).toBe(true);

    systemDark = false;
    run();
    expect(root.classList.contains("light")).toBe(true);
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("чужая запись — умолчание", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    run();
    expect(root.classList.contains("dark")).toBe(true);
  });

  it("закрытое хранилище не роняет страницу и даёт умолчание", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("хранилище закрыто");
    };
    try {
      expect(run).not.toThrow();
      expect(root.classList.contains("dark")).toBe(true);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("провайдер", () => {
  let container: HTMLDivElement;
  let mounted: Root;
  let current: { theme: Theme; setTheme: (theme: Theme) => void } | null = null;

  function Probe() {
    current = useTheme();
    return null;
  }

  const render = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mounted = createRoot(container);
    act(() => mounted.render(createElement(ThemeProvider, null, createElement(Probe))));
  };

  afterEach(() => {
    // Выбор живёт в памяти модуля до чужого события хранилища: сбросить его
    // можно только так, как это делает другая вкладка, — и пока провайдер
    // ещё подписан, иначе событие уйдёт в пустоту.
    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });
    act(() => mounted.unmount());
    container.remove();
    current = null;
  });

  it("выбор человека применяется и запоминается", () => {
    render();
    expect(current?.theme).toBe("dark");

    act(() => current?.setTheme("light"));

    expect(current?.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("запомненный выбор читается при открытии", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render();

    expect(current?.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("«как в системе» следует за системой", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    render();
    expect(document.documentElement.classList.contains("light")).toBe(true);

    systemDark = true;
    act(() => {
      for (const listener of queryListeners) listener();
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("выбор из другой вкладки подхватывается", () => {
    render();

    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });

    expect(current?.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("не оставляет за собой стиль, отключающий переходы", async () => {
    render();
    act(() => current?.setTheme("light"));
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(document.head.querySelector("style")).toBeNull();
  });
});
