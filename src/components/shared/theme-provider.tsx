"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  parseTheme,
  resolveTheme,
  type ResolvedTheme,
  type Theme,
} from "./theme";

/**
 * Тема оформления в браузере: выбор человека и класс на корне документа.
 *
 * Класс до первой отрисовки кладёт сценарий из разметки (`THEME_MARK_SCRIPT`
 * в `theme.ts`); здесь — всё, что происходит после: выбор из переключателя,
 * ответ на смену системной темы при «как в системе» и тот же выбор в другой
 * вкладке. Зачем свой провайдер, а не `next-themes`, — в `theme.ts`.
 *
 * --- Почему выбор — внешнее хранилище, а не состояние ------------------------
 *
 * Его читает несколько переключателей на странице (в подвале и в углу), и у
 * них должно быть одно мнение. Хранилище на уровне модуля и
 * `useSyncExternalStore` дают это без обёртки-контекста: хук работает и там,
 * куда провайдер не дотянулся, а провайдеру остаётся одно дело — приводить
 * класс на корне в соответствие с выбором.
 *
 * Выбор помнится ещё и в памяти вкладки: в приватном режиме запись в
 * хранилище бывает запрещена, и тема, выбранная человеком, не должна
 * откатываться от этого на следующем же чтении.
 */

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Что выбрано в этой вкладке; `null` — читать хранилище (его могла поменять другая). */
let chosen: Theme | null = null;
const listeners = new Set<() => void>();

function readTheme(): Theme {
  if (chosen !== null) return chosen;
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY)) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function subscribeToTheme(callback: () => void): () => void {
  listeners.add(callback);

  // Другая вкладка выбрала тему — выбор этой вкладки больше не последний.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    chosen = null;
    callback();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function setTheme(theme: Theme): void {
  chosen = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Хранилище закрыто — тема продержится до закрытия вкладки.
  }
  for (const listener of listeners) listener();
}

function subscribeToSystem(callback: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

const readSystemDark = () => window.matchMedia(DARK_QUERY).matches;

/** `false` на сервере и при гидратации, `true` — со следующей отрисовки. */
const subscribeNever = () => () => undefined;
const readHydrated = () => true;
const readNotHydrated = () => false;

/**
 * Выбранная тема и способ её сменить.
 *
 * `theme` — выбор («светлая», «тёмная», «как в системе»), а не то, что
 * нарисовано. До гидратации это умолчание, и переключатели, которым важно не
 * расходиться с разметкой сервера, показывают выбор только после монтирования
 * (`theme-toggle.tsx`).
 */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => DEFAULT_THEME);
  return { theme, setTheme };
}

/**
 * Класс на корне документа.
 *
 * Переход цветов на время смены отключается: иначе половина страницы успевала
 * бы поменять цвет раньше другой, и тема переключалась бы волной, а не разом
 * (то же делал `disableTransitionOnChange` у библиотеки). Ничего не делает, если
 * класс уже тот: так на первом проходе, когда его только что положил сценарий
 * из разметки, не отключается ни один переход.
 */
function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  if (root.classList.contains(resolved) && root.style.colorScheme === resolved) return;

  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(style);

  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;

  // Чтение стиля заставляет браузер применить изменения при отключённых
  // переходах; к следующему такту они уже посчитаны, и стиль можно убирать.
  void window.getComputedStyle(document.body).opacity;
  window.setTimeout(() => style.remove(), 1);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const systemDark = useSyncExternalStore(subscribeToSystem, readSystemDark, () => true);
  const hydrated = useSyncExternalStore(subscribeNever, readHydrated, readNotHydrated);
  const resolved = resolveTheme(theme, systemDark);

  // Пока идёт гидратация, хранилище отдаёт умолчание, а не выбор человека
  // (серверное значение), — применить его значило бы на миг положить на
  // страницу не тот класс, что только что поставил сценарий из разметки.
  useEffect(() => {
    if (hydrated) applyTheme(resolved);
  }, [hydrated, resolved]);

  return children;
}
