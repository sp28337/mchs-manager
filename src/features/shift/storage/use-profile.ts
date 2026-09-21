"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { forgetActive, syncActiveIntoLibrary } from "./library";
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
  /**
   * Поставить на место открытого профиля другой — целиком.
   *
   * Это не правка, а ПОДМЕНА: так открывают профиль из проводника, из
   * файла и только что созданный. Правкой она не считается намеренно —
   * см. `touched`.
   */
  save: (profile: StoredProfile) => StoredProfile;
  /** Изменить часть профиля. Бросает, если хранилище недоступно. */
  update: (change: (previous: StoredProfile) => StoredProfile) => void;
  /** Забыть профиль на этом устройстве. */
  forget: () => void;
  /**
   * Правил ли человек открытый профиль с тех пор, как его открыли.
   *
   * Нужно ровно одному вопросу — «сохранить в файл перед тем, как открыть
   * другой?» (`open-profile.tsx`). Без этого признака вопрос опирался на
   * одну отметку о выгрузке и задавался ВСЕГДА, пока профиль хоть раз не
   * унесли файлом: человек открывал приложение, тут же шёл в проводник за
   * другим графиком — и получал вопрос о сохранении того, к чему не
   * прикасался.
   *
   * Живёт в памяти вкладки, а не в хранилище: вопрос о том, не пропадёт
   * ли СДЕЛАННОЕ ТОЛЬКО ЧТО, и переживать перезагрузку ему незачем —
   * профиль к тому времени и так лежит в проводнике.
   */
  touched: boolean;
}

export function useProfile(): UseProfile {
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [touched, setTouched] = useState(false);
  const current = useRef<StoredProfile | null>(null);

  useEffect(() => {
    const result = loadProfile();
    current.current = result.status === "ok" ? result.profile : null;
    // Отражение в проводник — при чтении, а не только при записи. Так в
    // список сохранённых графиков попадает профиль, заведённый до появления
    // проводника: своей записи у него нет, и создаётся она здесь, при
    // первом же открытии страницы, без единого действия человека.
    if (result.status === "ok") syncActiveIntoLibrary(result.profile);
    // Правило запрещает синхронный `setState` в эффекте, и обычно верно:
    // это лишний прогон отрисовки. Здесь он неизбежен и однократен —
    // `localStorage` на сервере не существует, а прочитать его до
    // монтирования негде.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(result);
  }, []);

  const write = useCallback((profile: StoredProfile) => {
    const saved = saveProfile(profile);
    current.current = saved;
    // Проводник обновляется тем же движением, что и хранилище: своего
    // «сохранить в список» у приложения нет — правка сохранена в тот же
    // миг, когда сделана, и список, показывающий вчерашнее, врал бы.
    syncActiveIntoLibrary(saved);
    setState({ status: "ok", profile: saved });
    return saved;
  }, []);

  const save = useCallback(
    (profile: StoredProfile) => {
      const saved = write(profile);
      // Открытый профиль сменился целиком — считать его «правленым»
      // нечему: человек к нему ещё не прикасался.
      setTouched(false);
      return saved;
    },
    [write],
  );

  const update = useCallback(
    (change: (previous: StoredProfile) => StoredProfile) => {
      const previous = current.current;
      if (previous === null) return;
      write(change(previous));
      setTouched(true);
    },
    [write],
  );

  const forget = useCallback(() => {
    clearProfile();
    // Вместе с профилем уходит и его запись в проводнике. Оставить снимок
    // значило бы ответить «удалено» и сохранить копию — ровно то, чего
    // человек этой кнопкой и избегает.
    forgetActive();
    current.current = null;
    setTouched(false);
    setState({ status: "empty" });
  }, []);

  return { state, save, update, forget, touched };
}
