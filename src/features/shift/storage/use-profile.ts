"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearProfile,
  loadProfile,
  saveProfile,
  type StoredProfile,
} from "./profile";

/**
 * Профиль из `localStorage` как состояние React.
 *
 * --- Почему начальное состояние «загружается» ----------------------------
 *
 * `localStorage` на сервере не существует, а Next.js рисует первую
 * разметку на сервере. Прочитать хранилище сразу в `useState` значило бы
 * получить разную разметку на сервере и в браузере — React назовёт это
 * ошибкой гидратации, а человек увидит мигание формы регистрации поверх
 * своего расчёта. Поэтому чтение — в эффекте, а до него честное
 * «загружается».
 *
 * --- Почему запись не внутри `setState` ----------------------------------
 *
 * Функция обновления состояния обязана быть чистой: React вправе вызвать
 * её дважды, и в режиме строгой проверки он это и делает. Запись в
 * хранилище оттуда означала бы двойное сохранение и, что хуже, потерю
 * исключения о недоступном хранилище. Поэтому текущий профиль
 * дублируется в ref, а запись идёт снаружи — синхронно, с исключением,
 * которое вызывающий может показать человеку.
 */
export type ProfileState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ok"; profile: StoredProfile }
  | { status: "corrupt"; reason: string; raw: string };

export interface UseProfile {
  state: ProfileState;
  /** Записать профиль целиком. */
  save: (profile: StoredProfile) => StoredProfile;
  /** Изменить часть профиля. Бросает, если хранилище недоступно. */
  update: (change: (previous: StoredProfile) => StoredProfile) => void;
  /** Забыть профиль на этом устройстве. */
  forget: () => void;
}

export function useProfile(): UseProfile {
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const current = useRef<StoredProfile | null>(null);

  useEffect(() => {
    const result = loadProfile();
    current.current = result.status === "ok" ? result.profile : null;
    // Правило запрещает синхронный `setState` в эффекте, и обычно верно:
    // это лишний прогон отрисовки. Здесь он неизбежен и однократен —
    // `localStorage` на сервере не существует, а прочитать его до
    // монтирования негде.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(result);
  }, []);

  const save = useCallback((profile: StoredProfile) => {
    const saved = saveProfile(profile);
    current.current = saved;
    setState({ status: "ok", profile: saved });
    return saved;
  }, []);

  const update = useCallback(
    (change: (previous: StoredProfile) => StoredProfile) => {
      const previous = current.current;
      if (previous === null) return;
      save(change(previous));
    },
    [save],
  );

  const forget = useCallback(() => {
    clearProfile();
    current.current = null;
    setState({ status: "empty" });
  }, []);

  return { state, save, update, forget };
}
