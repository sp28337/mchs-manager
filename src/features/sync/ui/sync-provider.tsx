"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { forgetEverything, subscribeToLibrary } from "@/features/shift/storage/library";
import { subscribeToStoredProfile } from "@/features/shift/storage/profile";

import { ApiClient } from "../api/client";
import { isApiError, isNetworkError } from "../api/errors";
import type { Account } from "../api/schemas";
import type { DataKey } from "../crypto";
import { hasUnsentChanges, resolvePending, syncOnce, type SyncReport } from "../engine/sync";
import type { ConsentActs } from "../legal";
import * as session from "../session";
import { clearVault, readPending, type PendingRow } from "../store/vault";
import { SyncConflicts } from "./conflict-dialog";
import { ConsentRenewal } from "./consent-renewal";
import { SYNC_ENABLED } from "./enabled";
import { explain, СЕССИЯ_КОНЧИЛАСЬ } from "./messages";

/**
 * Состояние синхронизации на всё приложение.
 *
 * Провайдер здесь, а не хук на странице аккаунта, по двум причинам.
 * Первая: строка состояния стоит в подвале рабочего экрана, а страница
 * аккаунта — отдельная, и обе должны говорить одно и то же. Вторая: о
 * расхождении настроек человека спрашивают там, где он в этот миг
 * находится, — окно живёт в провайдере и всплывает на любой странице.
 *
 * --- Что происходит само ---------------------------------------------------
 *
 * * при открытии страницы — продолжение сессии по cookie и первый проход;
 * * после правки профиля или проводника — проход с задержкой: человек
 *   правит подряд, и отправлять на каждое нажатие незачем;
 * * при появлении сети и при возвращении на вкладку — проход, если есть
 *   что отправить или давно не синхронизировались.
 *
 * Чего не происходит само: ничего, что требует пароля. Ключ данных
 * переживает перезагрузку в хранилище слоя, а не выводится заново.
 *
 * --- Почему «нет сети» — это не ошибка -------------------------------------
 *
 * Приложение остаётся полностью работоспособным без сервера: расчёт,
 * правки, проводник — всё в браузере, как было до аккаунта. Поэтому
 * отсутствие связи показывается спокойной строкой, а не красным
 * сообщением: человеку ничего не нужно делать, синхронизация подождёт.
 */
export type SyncPhase =
  | "off"
  | "signed-out"
  | "connecting"
  | "idle"
  | "syncing"
  | "offline"
  | "error";

export interface SyncState {
  enabled: boolean;
  phase: SyncPhase;
  account: Account | null;
  /** Когда последний проход закончился удачей. */
  syncedAt: string | null;
  /** Есть правки, которые ещё не уехали. */
  dirty: boolean;
  /** Что принято в последний проход — для спокойной строки. */
  report: SyncReport | null;
  /** Расхождения, о которых надо спросить человека. */
  pending: PendingRow[];
  error: string | null;
  /**
   * Синхронизация встала и ждёт человека.
   *
   * Отличает беду, случившуюся САМУ (сессия кончилась в фоне, сервер
   * отказал на проходе), от неудачи того, что человек затеял сам
   * (не тот пароль в форме входа). Вторая объясняется там, где он её
   * затеял; первой он не видел вовсе, и сказать о ней надо на том
   * экране, где он стоит (`sync-notice.tsx`).
   */
  stalled: boolean;
  /** Идёт действие, затеянное человеком (вход, регистрация, выгрузка). */
  busy: boolean;
  /** Ключ восстановления — показывается один раз, сразу после регистрации. */
  freshRecoveryKey: string | null;
}

/** Чем кончился выход: ушёл или остановлен непереданными правками. */
export type LogoutResult = "done" | "unsynced";

export interface SyncActions {
  register: (данные: { email: string; password: string; acts: ConsentActs }) => Promise<void>;
  login: (данные: { email: string; password: string }) => Promise<void>;
  /**
   * Выйти. Графики с устройства уходят (`forgetEverything`), поэтому сначала
   * всё, что ещё не доехало до сервера, отправляется: не удалось — выход не
   * происходит и отвечает `"unsynced"`; `force` выходит всё равно.
   */
  logout: (options?: { force?: boolean }) => Promise<LogoutResult>;
  syncNow: () => Promise<void>;
  /**
   * Принять действующую редакцию согласия на обработку заново. Вызывать только
   * после отметки: отвечает человек, а не приложение за него.
   */
  acceptConsent: (personalData: boolean) => Promise<void>;
  resolve: (itemId: string, choice: "local" | "remote") => Promise<void>;
  changePassword: (данные: {
    currentPassword: string;
    newPassword: string;
  }) => Promise<void>;
  exportAll: () => Promise<string>;
  deleteAccount: (данные: { password: string }) => Promise<void>;
  recoverStart: (email: string) => Promise<void>;
  forgetRecoveryKey: () => void;
  clearError: () => void;
}

export type SyncValue = SyncState & { actions: SyncActions };

const ПУСТО: SyncState = {
  enabled: SYNC_ENABLED,
  phase: SYNC_ENABLED ? "connecting" : "off",
  account: null,
  syncedAt: null,
  dirty: false,
  report: null,
  pending: [],
  error: null,
  stalled: false,
  busy: false,
  freshRecoveryKey: null,
};

const Контекст = createContext<SyncValue | null>(null);

/** Задержка перед проходом после правки: человек правит подряд. */
const ЗАДЕРЖКА_МС = 2000;

/** Через столько после удачного прохода возвращение на вкладку вызывает новый. */
const УСТАРЕЛО_МС = 5 * 60 * 1000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SyncState>(ПУСТО);

  const client = useRef<ApiClient | null>(null);
  const dataKey = useRef<DataKey | null>(null);
  /** Обёртка ключа данных паролем — нужна смене пароля, живёт в памяти. */
  const wrapped = useRef<string | null>(null);
  const email = useRef<string | null>(null);
  /** Продолжение сессии затевается один раз на вкладку. */
  const продолжено = useRef(false);
  /** Продолжение сейчас идёт: второе параллельно не нужно и опасно. */
  const идётВосстановление = useRef(false);
  /** Продолжение не удалось из-за сети и повторится, когда она вернётся. */
  const сессияЖдёт = useRef(false);
  const идёт = useRef(false);
  /** Просьба, пришедшая во время прохода: проход повторится. */
  const ждёт = useRef(false);
  const таймер = useRef<number | null>(null);
  /**
   * На устройстве есть то, чего нет на сервере.
   *
   * Истина, пока первый проход сессии не прошёл: что лежало на устройстве до
   * него, неизвестно. Гаснет с проходом, в который попали все правки на
   * этот миг; любая правка включает снова (`правок` отличает «правка пришла
   * во время прохода» от «после»: в проход она не попала).
   */
  const неотправлено = useRef(true);
  /** Сколько правок устройства видела эта вкладка: метка для `неотправлено`. */
  const правок = useRef(0);
  /**
   * Текст согласия или соглашения изменился, и человек ещё не ответил.
   *
   * Пока так, синхронизация стоит: обработка на основании согласия с прежним
   * текстом не должна продолжаться как ни в чём не бывало (ч. 1 ст. 9 152-ФЗ —
   * согласие конкретное и информированное, а этот текст человек не видел).
   * Расчёт и графики на устройстве от этого не страдают — он работает без
   * сервера.
   */
  const ждётСогласия = useRef(false);
  /**
   * Номер сессии этой вкладки: растёт при каждом выходе — здесь или в другой
   * вкладке. Проход запоминает номер при старте и, если к концу он другой, значит
   * сессию закрыли, пока он шёл: всё, что он успел записать на устройство, —
   * графики аккаунта, из которого человек уже вышел, — стирается за ним.
   */
  const эпоха = useRef(0);

  const получить = useCallback((): ApiClient => {
    client.current ??= new ApiClient();
    return client.current;
  }, []);

  const sync = useCallback(async () => {
    if (!SYNC_ENABLED || dataKey.current === null) return;
    if (ждётСогласия.current) return;

    // Просьба во время прохода не теряется, а повторяет его.
    // ------------------------------------------------------------------
    // Иначе так: человек правит профиль в тот миг, когда идёт проход,
    // отложенный вызов натыкается на «уже идём» и пропадает, а признак
    // «есть изменения» остаётся висеть до следующего события — которого
    // может не быть часами. Правка при этом никуда не уедет, и человек
    // узнает об этом на другом устройстве.
    if (идёт.current) {
      ждёт.current = true;
      return;
    }

    идёт.current = true;
    const взято = правок.current;
    setState((было) => ({ ...было, phase: "syncing", error: null }));

    const эпохаПрохода = эпоха.current;

    try {
      const report = await syncOnce({ client: получить(), dataKey: dataKey.current });

      // Вышли, пока проход шёл: он вытянул с сервера и записал на устройство то,
      // что человек как раз унёс выходом. Оставить это значило бы вернуть чужие
      // графики на чистое устройство, поэтому за проходом стирается всё, включая
      // его след в хранилище слоя.
      if (эпоха.current !== эпохаПрохода) {
        forgetEverything();
        await clearVault();
        return;
      }

      if (правок.current === взято) неотправлено.current = false;

      setState((было) => ({
        ...было,
        phase: "idle",
        syncedAt: new Date().toISOString(),
        dirty: false,
        report,
        pending: report.pending.length > 0 ? report.pending : было.pending,
        error: null,
        stalled: false,
      }));

      // Вопросы могли появиться не только в этом проходе: ответ на
      // прошлый мог не доехать, и строка о нём лежит в хранилище.
      const вопросы = await readPending();
      setState((было) => ({ ...было, pending: вопросы }));
    } catch (error) {
      if (isNetworkError(error)) {
        setState((было) => ({ ...было, phase: "offline", dirty: true }));
      } else if (isApiError(error, "bad_credentials", "token_revoked", "token_expired")) {
        // Сессия кончилась: ключ данных остаётся, но ходить с ним некуда,
        // пока человек не войдёт заново.
        setState((было) => ({
          ...было,
          phase: "signed-out",
          account: null,
          // Не `explain`: он перевёл бы код отказа словами про ссылку из
          // письма, а здесь кончился вход.
          error: СЕССИЯ_КОНЧИЛАСЬ,
          stalled: true,
        }));
      } else {
        console.warn("проход синхронизации не удался", error);
        setState((было) => ({
          ...было,
          phase: "error",
          error: explain(error),
          stalled: true,
        }));
      }
    } finally {
      идёт.current = false;
    }

    if (ждёт.current) {
      ждёт.current = false;
      await sync();
    }
  }, [получить]);

  /** Дождаться, пока кончится идущий проход. */
  const дождаться = useCallback(async () => {
    for (let раз = 0; раз < 100 && идёт.current; раз += 1) {
      await new Promise<void>((готово) => window.setTimeout(готово, 100));
    }
  }, []);

  /**
   * Всё ли, что есть на устройстве, лежит на сервере. Если нет — пробует
   * отправить прямо сейчас, не дожидаясь отложенного прохода.
   *
   * «Всё» — это удачный проход и ни одного нерешённого расхождения: ответ на
   * вопрос о расхождении решает, чья версия настроек останется, и стереть
   * устройство до ответа значило бы выбрать за человека.
   */
  const сдано = useCallback(async (): Promise<boolean> => {
    if (dataKey.current === null) return true;

    // Согласие не принято — проход не идёт, и «дождаться отправки» нечего: флаг
    // `неотправлено` так и остался бы поднятым, и выход всякий раз грозил бы
    // потерей правок, даже если их не было. Отвечает честный подсчёт: есть ли на
    // устройстве то, что ещё не уехало.
    if (ждётСогласия.current) return !(await hasUnsentChanges());

    if (таймер.current !== null) {
      window.clearTimeout(таймер.current);
      таймер.current = null;
    }
    // Проходов до трёх: принятое с другого устройства тоже пишется в
    // хранилище и выглядит правкой (`правка` ниже), так что первый проход
    // мог закончиться «есть что отправлять» из-за собственной находки.
    // Следующий, в который уже ничего не приходит, это снимает.
    for (let раз = 0; раз < 3; раз += 1) {
      await дождаться();
      await sync();
      await дождаться();
      if (!неотправлено.current) break;
    }
    if (неотправлено.current) return false;
    return (await readPending()).length === 0;
  }, [дождаться, sync]);

  const позже = useCallback(() => {
    if (таймер.current !== null) window.clearTimeout(таймер.current);
    таймер.current = window.setTimeout(() => {
      таймер.current = null;
      void sync();
    }, ЗАДЕРЖКА_МС);
  }, [sync]);

  // --- Продолжение сессии при открытии страницы -----------------------------

  const продолжить = useCallback(async () => {
    // Два продолжения разом — это два обновления токена, а предъявленный
    // дважды refresh-токен сервер считает кражей и гасит всю семью. Поэтому
    // пока одно не кончилось, второе не начинается, кто бы ни просил.
    if (идётВосстановление.current) return;
    идётВосстановление.current = true;

    try {
      const открыто = await session.restore(получить());

      if (открыто === null) {
        сессияЖдёт.current = false;
        setState((было) => ({ ...было, phase: "signed-out" }));
        return;
      }

      сессияЖдёт.current = false;
      dataKey.current = открыто.dataKey;
      email.current = открыто.session.account.email;
      wrapped.current = открыто.session.wrapped_dek_pwd ?? null;
      ждётСогласия.current = открыто.session.account.consent_pending.length > 0;

      setState((было) => ({
        ...было,
        phase: "idle",
        account: открыто.session.account,
        pending: [],
      }));

      await sync();
    } catch (error) {
      if (isNetworkError(error)) {
        // Страницу открыли без сервера: нет сети, или сервер не поднят. Это
        // не поломка и не повод для следа с трассой в консоли — одна
        // строка, и всё. Сессию при этом ещё НЕ продолжили: ключ данных
        // не поднят, и `sync()` до него не дойдёт, сколько ни проси. Поэтому
        // продолжение ждёт возвращения сети (`online`, возврат на вкладку) и
        // повторяется само; без этого человек, открывший страницу в метро,
        // так и сидел бы «без сети» до перезагрузки, хотя сеть давно есть.
        сессияЖдёт.current = true;
        console.debug("сессия не продолжена: сервер недоступен, повторю позже");
        setState((было) => ({ ...было, phase: "offline", error: null, stalled: false }));
        return;
      }

      // Молча терять причину нельзя: продолжение сессии ломается
      // редко, а разбирать такое приходится по одному следу в чужой
      // консоли.
      console.warn("не удалось продолжить сессию", error);
      сессияЖдёт.current = false;

      setState((было) => ({
        ...было,
        phase: "signed-out",
        error: СЕССИЯ_КОНЧИЛАСЬ,
        // Всё, кроме сети, человек не увидит, пока ему не скажут.
        stalled: true,
      }));
    } finally {
      идётВосстановление.current = false;
    }
  }, [sync, получить]);

  useEffect(() => {
    if (!SYNC_ENABLED || продолжено.current) return;

    // Первый раз — один на вкладку, а не один на монтирование: строгая
    // проверка React монтирует эффекты дважды, и два продолжения сессии
    // означали бы два обновления токена (см. `продолжить`).
    продолжено.current = true;

    // Отмены по размонтированию здесь нет намеренно, и это не
    // небрежность. Была — и ровно из-за неё продолжение сессии не
    // доходило до конца: строгая проверка монтирует эффект, сразу
    // размонтирует и монтирует снова, первый проход помечал себя
    // «неживым», второй упирался в признак выше, и в итоге обновление
    // токена уходило, а состояние и первый проход синхронизации — нет.
    // Запоздавшая запись состояния после размонтирования безвредна:
    // провайдер живёт столько же, сколько вкладка.
    void продолжить();
  }, [продолжить]);

  // --- Правки, сеть, возвращение на вкладку ---------------------------------

  useEffect(() => {
    if (!SYNC_ENABLED) return;

    const правка = () => {
      правок.current += 1;
      неотправлено.current = true;
      setState((было) => (было.dirty ? было : { ...было, dirty: true }));
      позже();
    };

    const отписки = [subscribeToStoredProfile(правка), subscribeToLibrary(правка)];

    // Сессия ещё не продолжена — сеть возвращается к ней, а не к проходу:
    // у прохода без ключа данных идти некуда.
    const сеть = () => void (сессияЖдёт.current ? продолжить() : sync());
    const вкладка = () => {
      if (document.visibilityState !== "visible") return;

      if (сессияЖдёт.current) {
        void продолжить();
        return;
      }

      setState((было) => {
        const давно =
          было.syncedAt === null || Date.now() - Date.parse(было.syncedAt) > УСТАРЕЛО_МС;
        if (было.dirty || давно) void sync();
        return было;
      });
    };

    window.addEventListener("online", сеть);
    document.addEventListener("visibilitychange", вкладка);

    return () => {
      for (const отписка of отписки) отписка();
      window.removeEventListener("online", сеть);
      document.removeEventListener("visibilitychange", вкладка);
      if (таймер.current !== null) window.clearTimeout(таймер.current);
    };
  }, [sync, позже, продолжить]);

  // --- Выход в другой вкладке -----------------------------------------------

  const router = useRouter();
  const pathname = usePathname();
  /** Адрес страницы для обработчика, который не пересоздаётся при каждом переходе. */
  const адрес = useRef(pathname);
  useEffect(() => {
    адрес.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!SYNC_ENABLED) return;

    const вышли = (event: StorageEvent) => {
      if (event.key !== session.SIGNED_OUT_KEY) return;
      // В этой вкладке сессии и так нет — закрывать нечего.
      if (dataKey.current === null && !сессияЖдёт.current) return;

      эпоха.current += 1;
      dataKey.current = null;
      wrapped.current = null;
      email.current = null;
      ждётСогласия.current = false;
      сессияЖдёт.current = false;
      неотправлено.current = true;

      if (таймер.current !== null) {
        window.clearTimeout(таймер.current);
        таймер.current = null;
      }

      // Графики с устройства стёр вышедший, и стирать их второй раз нельзя:
      // человек мог уже завести на чистом устройстве новый.
      setState(() => ({ ...ПУСТО, phase: "signed-out" }));

      // Расчёт, открытый в этой вкладке, держит график в памяти, и первая же
      // правка записала бы его обратно в очищенное хранилище — так же, как при
      // выходе в этой вкладке (`logout-dialog.tsx`).
      if (!адрес.current.startsWith("/account")) router.push("/");
    };

    window.addEventListener("storage", вышли);
    return () => window.removeEventListener("storage", вышли);
  }, [router]);

  // --- Действия человека ----------------------------------------------------

  const действие = useCallback(
    async <T,>(дело: () => Promise<T>): Promise<T> => {
      setState((было) => ({ ...было, busy: true, error: null, stalled: false }));
      try {
        return await дело();
      } catch (error) {
        setState((было) => ({ ...было, error: explain(error) }));
        throw error;
      } finally {
        setState((было) => ({ ...было, busy: false }));
      }
    },
    [],
  );

  /**
   * Графики, построенные до входа, в аккаунт не попадают.
   *
   * Человек, не входя, строит график и потом входит в свою учётную запись, —
   * а в ней свои графики. Первый проход слил бы то, что лежит на устройстве, с
   * тем, что лежит на сервере, и гостевой график оказался бы среди его
   * настоящих. При входе человек должен увидеть то, что хранится в аккаунте, и
   * только это; при регистрации аккаунт пуст, и первый график он строит уже
   * внутри него.
   *
   * Стирается ПОСЛЕ удачного входа: неверный пароль график не трогает. И не
   * стирается, если устройство и так принадлежало этому аккаунту (`continued`:
   * сессия кончилась, человек вошёл снова) — там графики его, и в них могут
   * быть правки, которые не успели уехать.
   *
   * Стирание само сообщает «есть правки» (`subscribeToLibrary`); первый проход
   * сразу за ним, так что лишнего отправлять нечего — устройство пусто.
   */
  const убратьГрафикиГостя = useCallback((продолжение: boolean) => {
    if (продолжение) return;
    forgetEverything();
  }, []);

  const actions = useMemo<SyncActions>(
    () => ({
      register: async (данные) =>
        действие(async () => {
          const итог = await session.register(получить(), данные);

          dataKey.current = итог.dataKey;
          email.current = итог.session.account.email;
          wrapped.current = итог.session.wrapped_dek_pwd ?? null;

          убратьГрафикиГостя(итог.continued);
          ждётСогласия.current = итог.session.account.consent_pending.length > 0;

          setState((было) => ({
            ...было,
            phase: "idle",
            account: итог.session.account,
            freshRecoveryKey: итог.recoveryKeyPrinted,
            dirty: true,
          }));

          await sync();
        }),

      login: async (данные) =>
        действие(async () => {
          const итог = await session.login(получить(), данные);

          dataKey.current = итог.dataKey;
          email.current = итог.session.account.email;
          wrapped.current = итог.session.wrapped_dek_pwd ?? null;

          убратьГрафикиГостя(итог.continued);
          ждётСогласия.current = итог.session.account.consent_pending.length > 0;

          setState((было) => ({
            ...было,
            phase: "idle",
            account: итог.session.account,
            dirty: true,
          }));

          await sync();
        }),

      logout: async (options) =>
        действие<LogoutResult>(async () => {
          // Графики уйдут с устройства вместе с выходом, и всё, что не
          // доехало до сервера, ушло бы вместе с ними.
          if (options?.force !== true && !(await сдано())) return "unsynced";

          // С этой строки выход состоялся. Проходы, идущие сейчас, сотрут за
          // собой (`эпоха`), а остальные вкладки закроют сессию у себя: у них ключ
          // данных в памяти, и без сигнала первая же их правка вытянула бы весь
          // аккаунт обратно на только что очищенное устройство.
          эпоха.current += 1;
          session.announceSignedOut();

          // Не ответил сервер — не повод остаться «вошедшим» без ключа:
          // `session.logout` стирает ключ и ревизии с устройства в любом
          // случае, а серверная сессия без ключа ни к чему не даёт доступа
          // и догаснет сама.
          await session.logout(получить()).catch(() => undefined);

          dataKey.current = null;
          wrapped.current = null;
          email.current = null;
          ждётСогласия.current = false;

          // Стирается до сброса состояния: события хранилища пометили бы его
          // «есть правки», а оно уже не вошедшего.
          forgetEverything();
          неотправлено.current = true;

          setState(() => ({
            ...ПУСТО,
            phase: "signed-out",
          }));

          return "done";
        }),

      syncNow: sync,

      acceptConsent: async (personalData) =>
        действие(async () => {
          const сведения = await session.acceptConsents(получить(), personalData);
          ждётСогласия.current = сведения.consent_pending.length > 0;

          setState((было) => ({
            ...было,
            account:
              было.account === null
                ? null
                : {
                    ...было.account,
                    consents: сведения.consents,
                    consent_pending: сведения.consent_pending,
                  },
          }));

          await sync();
        }),

      resolve: async (itemId, choice) => {
        if (dataKey.current === null) return;

        await действие(async () => {
          await resolvePending({
            client: получить(),
            dataKey: dataKey.current as DataKey,
            itemId,
            choice,
          });

          setState((было) => ({
            ...было,
            pending: было.pending.filter((строка) => строка.itemId !== itemId),
          }));
        });
      },

      changePassword: async (данные) =>
        действие(async () => {
          if (email.current === null || wrapped.current === null) {
            throw new Error("нет сведений о сессии");
          }

          await session.changePassword(получить(), {
            email: email.current,
            currentPassword: данные.currentPassword,
            newPassword: данные.newPassword,
            wrappedDekPwd: wrapped.current,
          });

          // Прочие сессии сервер погасил; эта осталась, и ключ данных тот
          // же — перешифровалась только обёртка.
        }),

      exportAll: async () => действие(() => session.exportAll(получить())),

      deleteAccount: async (данные) =>
        действие(async () => {
          if (email.current === null) throw new Error("нет сведений о сессии");

          await session.deleteAccount(получить(), {
            email: email.current,
            password: данные.password,
          });

          dataKey.current = null;
          wrapped.current = null;
          email.current = null;
          ждётСогласия.current = false;

          setState(() => ({ ...ПУСТО, phase: "signed-out" }));
        }),

      recoverStart: async (адрес) =>
        действие(() => session.recoverStart(получить(), адрес)),

      forgetRecoveryKey: () => {
        setState((было) => ({ ...было, freshRecoveryKey: null }));
      },

      clearError: () => {
        setState((было) => ({ ...было, error: null, stalled: false }));
      },
    }),
    [действие, получить, sync, сдано, убратьГрафикиГостя],
  );

  const значение = useMemo<SyncValue>(() => ({ ...state, actions }), [state, actions]);

  return (
    <Контекст.Provider value={значение}>
      {children}
      {/* Вопрос о расхождении встаёт там, где человек в этот миг
          находится: окно живёт здесь, а не на странице аккаунта, куда он
          может не зайти неделю. */}
      <SyncConflicts />
      {/* Редакция согласия или соглашения сменилась — спрашивается там же, где
          человек сейчас, по той же причине (`consent-renewal.tsx`). */}
      <ConsentRenewal />
    </Контекст.Provider>
  );
}

/**
 * Состояние синхронизации.
 *
 * Без провайдера возвращает выключенное состояние, а не бросает: страница
 * условий и посадочная рисуются без него, а подвал у них общий.
 */
export function useSync(): SyncValue {
  const значение = useContext(Контекст);

  return (
    значение ?? {
      ...ПУСТО,
      phase: "off",
      actions: {
        register: async () => undefined,
        login: async () => undefined,
        logout: async () => "done",
        syncNow: async () => undefined,
        acceptConsent: async () => undefined,
        resolve: async () => undefined,
        changePassword: async () => undefined,
        exportAll: async () => "",
        deleteAccount: async () => undefined,
        recoverStart: async () => undefined,
        forgetRecoveryKey: () => undefined,
        clearError: () => undefined,
      },
    }
  );
}
