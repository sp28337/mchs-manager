"use client";

import { useSyncExternalStore } from "react";

import {
  APPEARANCE_EVENT,
  APPEARANCE_STORAGE_KEY,
  NO_APPEARANCE,
  applyAppearance,
  isCustomised,
  parseAppearance,
  serializeAppearance,
  type Appearance,
} from "./appearance";

let lastRaw: string | null = null;
let lastValue: Appearance = NO_APPEARANCE;

/**
 * Снимок для React сравнивается по ссылке, а разбор каждый раз даёт новый
 * объект и зациклил бы подписку: поэтому разобранное помнится, пока не
 * изменилась сама строка в хранилище.
 */
function snapshot(): Appearance {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    // Хранилище закрыто — цветов нет, и ничего не запомнится.
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastValue = parseAppearance(raw);
  }
  return lastValue;
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== null) return;
    // Выбор изменили в другой вкладке: цвета на корне этой ставятся заново.
    applyAppearance(document.documentElement, snapshot());
    listener();
  };
  window.addEventListener(APPEARANCE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(APPEARANCE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Записать выбор и сразу поставить цвета на страницу; пустой выбор стирает запись. */
export function saveAppearance(next: Appearance): void {
  try {
    if (isCustomised(next)) {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearance(next));
    } else {
      window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    }
  } catch {
    // Не запомнить выбор — не повод его не показать.
  }
  applyAppearance(document.documentElement, next);
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

/**
 * Свой цвет лампы больше не действует: лампа снова светит собственным.
 *
 * Конфиги остаются в списке — снимается только выбор. Так лампа и меняет цвет
 * нажатием на неё: свой цвет, выбранный в настройках, перебивал бы её выбор, и
 * нажатие ничего не меняло бы на глаз.
 */
export function clearLampColour(): void {
  const current = snapshot();
  if (current.lamp.active === null) return;
  saveAppearance({ ...current, lamp: { ...current.lamp, active: null } });
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, snapshot, () => NO_APPEARANCE);
}
