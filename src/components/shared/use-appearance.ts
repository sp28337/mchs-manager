"use client";

import { useSyncExternalStore } from "react";

import {
  APPEARANCE_EVENT,
  APPEARANCE_STORAGE_KEY,
  NO_APPEARANCE,
  applyAppearance,
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

/** Записать оформление на устройство и сразу поставить цвета на страницу. */
function persist(next: Appearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearance(next));
  } catch {
    // Не запомнить выбор — не повод его не показать.
  }
  applyAppearance(document.documentElement, next);
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

/**
 * Правка человека: записать и пометить временем.
 *
 * Время правки ставится здесь, а не вызывающим: им слияние решает, чья сторона
 * свежее (`features/sync/engine/merge-appearance.ts`), и забытая метка отдала бы
 * правку на милость чужой. Запись пишется ВСЕГДА, даже если в ней ничего нет:
 * сброс до умолчаний — тоже правка, и без метки он не доехал бы до других
 * устройств, а пришёл бы обратно с сервера прежним.
 */
export function saveAppearance(next: Appearance): void {
  persist({ ...next, at: new Date().toISOString() });
}

/**
 * Положить принятое с другого устройства — со временем, каким оно пришло.
 *
 * Не `saveAppearance`: это не правка человека, и ставить ей время «сейчас»
 * значило бы объявить чужую правку свежее всех своих.
 */
export function writeAppearance(next: Appearance): void {
  persist(next);
}

/** То, что сейчас лежит на устройстве. */
export function readAppearance(): Appearance {
  return snapshot();
}

/**
 * Убрать оформление с устройства — при выходе из учётной записи.
 *
 * Оформление принадлежит учётной записи (оно едет на сервер вместе с графиками),
 * и следующему человеку за этим браузером чужие цвета и погашенная лампа ни к
 * чему. Копия остаётся на сервере и вернётся при следующем входе; до выхода
 * `sync-provider` убеждается, что все правки уже там.
 */
export function forgetAppearance(): void {
  try {
    window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  } catch {
    // Хранилище закрыто — стирать нечего.
  }
  applyAppearance(document.documentElement, NO_APPEARANCE);
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

/**
 * Подписка на любую запись оформления — здесь или в другой вкладке.
 *
 * Для слоя синхронизации: правка оформления просит проход так же, как правка
 * графика. Чужая вкладка пишет в то же хранилище, и без `storage` её правку
 * этот слой заметил бы только на следующем проходе.
 */
export function subscribeToAppearance(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(APPEARANCE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(APPEARANCE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
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
