"use client";

import { useSyncExternalStore } from "react";

import {
  buildTimeline,
  HERO_SCRIPTS,
  heroStartAt,
  type HeroAction,
  type HeroChip,
  type HeroLayout,
  type HeroPatch,
} from "./hero-story";

/**
 * Часы истории первого экрана и всё, что от них зависит.
 *
 * --- Почему внешнее хранилище, а не состояние в предке ------------------------
 *
 * Историю читают четыре разных места: отметки на клетках, итоги над месяцами,
 * числа над сеткой и палец. Стоят они в разметке, собранной на сервере, и
 * общего клиентского предка у них нет: делать им предком всю плоскость значило
 * бы утянуть в бандл месяцы с клетками ради четырёх чисел. Поэтому состояние
 * живёт в модуле, а читают его через `useSyncExternalStore` — и каждый берёт
 * ровно ту долю, что ему нужна: клетка своей записи, итог — номер этапа, палец —
 * своё. Лишнее не перерисовывается.
 *
 * Хранилищ два, по раскладке: историю широкой раскладки (четыре месяца) и узкой
 * (один) показывает то, что сейчас видно, а второе спит.
 *
 * --- Как ходят часы --------------------------------------------------------------
 *
 * Круг истории разложен по мигам заранее (`buildTimeline`), здесь он только
 * проигрывается: на каждый миг свой `setTimeout`, отсчитанный от начала круга,
 * а не цепочкой «после предыдущего» — иначе ошибка каждого таймера копилась бы
 * и к концу круга уехали бы и числа, и палец. Круг кончился — начинается
 * следующий, и так, пока на странице есть кому смотреть: первый подписчик
 * запускает часы, последний — останавливает.
 *
 * --- Три случая, когда часы стоят -----------------------------------------------
 *
 * * Раскладка сейчас не показана (окно узкое, а это широкая, и наоборот). Часы
 *   ждут, пока её покажут: таймеры на то, что скрыто `display: none`, — пустая
 *   трата.
 * * Человек отключил анимацию (`prefers-reduced-motion`). Ему показывается СРАЗУ
 *   итоговая картина: все записи на месте, числа при них, пальца нет. Это
 *   честнее, чем оставить его с первым кадром истории, которую он не увидит.
 * * Вкладка скрыта. Браузер и сам тормозит таймеры, но по возвращении они
 *   сыпались бы пачкой, и палец метался бы по месяцам. Поэтому на скрытой
 *   вкладке часы останавливаются, а при возвращении история начинается круг
 *   заново — короткой паузой, без сборки: сетка уже собрана.
 * * Первый экран прокручен далеко вверх: история идёт по кругу без конца, и
 *   гонять её за кадром незачем — на нём работали бы таймеры и счётчики там, где
 *   смотреть некому. Когда человек возвращается к началу страницы, круг
 *   начинается заново с паузы.
 */

export interface PointerState {
  visible: boolean;
  /** Сутки, к которым едет рука, ISO; пока их нет — руке ехать некуда. */
  day: string | null;
  /** Счётчик нажатий: меняется — и круг от руки расходится заново. */
  press: number;
  chip: HeroChip | null;
}

export interface StoryState {
  /** Номер этапа расчёта: сколько записей стоит. */
  stage: number;
  /** Состояние записей по имени; отсутствующая — ещё не ложилась. */
  events: Readonly<Record<string, "idle" | "on" | "off">>;
  pointer: PointerState;
}

const HIDDEN_POINTER: PointerState = { visible: false, day: null, press: 0, chip: null };

const INITIAL: Record<HeroLayout, StoryState> = {
  wide: { stage: 0, events: {}, pointer: HIDDEN_POINTER },
  narrow: { stage: 0, events: {}, pointer: HIDDEN_POINTER },
};

/** Видна ли раскладка: тот же порог `md`, что у разметки (`hero-calendar.tsx`). */
const MEDIA: Record<HeroLayout, string> = {
  wide: "(min-width: 768px)",
  narrow: "(max-width: 767.98px)",
};

/** Пауза перед первым кругом после возвращения на вкладку: сетка уже собрана. */
const RESUME_MS = 700;

/**
 * Во сколько высот окна прокрутки первый экран считается ушедшим: он занимает
 * высоту окна и немного больше, и дальше полутора окон его не видно уже никак.
 */
const AWAY_SCREENS = 1.5;

const isAway = () => window.scrollY > window.innerHeight * AWAY_SCREENS;

/** Итоговая картина — для тех, у кого анимация отключена. */
function finalState(layout: HeroLayout): StoryState {
  const { events } = HERO_SCRIPTS[layout];
  return {
    stage: events.length,
    events: Object.fromEntries(events.map((event) => [event.id, "on" as const])),
    pointer: HIDDEN_POINTER,
  };
}

class Story {
  state: StoryState;
  private readonly listeners = new Set<() => void>();
  private timers: number[] = [];
  private media: MediaQueryList | null = null;
  private motion: MediaQueryList | null = null;
  private readonly timeline: { actions: HeroAction[]; period: number };
  /** Сетка уже собрана: следующие запуски начинаются без ожидания сборки. */
  private assembled = false;
  /** Первый экран был прокручен прочь при последней проверке. */
  private away = false;

  constructor(private readonly layout: HeroLayout) {
    this.state = INITIAL[layout];
    this.timeline = buildTimeline(HERO_SCRIPTS[layout]);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.activate();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.deactivate();
    };
  };

  getServerState = (): StoryState => INITIAL[this.layout];

  private set(next: StoryState) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private activate() {
    this.media = window.matchMedia(MEDIA[this.layout]);
    this.motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.media.addEventListener("change", this.sync);
    this.motion.addEventListener("change", this.sync);
    document.addEventListener("visibilitychange", this.sync);
    window.addEventListener("scroll", this.onScroll, { passive: true });
    this.sync();
  }

  private deactivate() {
    this.stop();
    this.media?.removeEventListener("change", this.sync);
    this.motion?.removeEventListener("change", this.sync);
    document.removeEventListener("visibilitychange", this.sync);
    window.removeEventListener("scroll", this.onScroll);
    this.state = INITIAL[this.layout];
  }

  /** Часы трогаются только тогда, когда первый экран ушёл или вернулся. */
  private onScroll = () => {
    const away = isAway();
    if (away === this.away) return;
    this.away = away;
    this.sync();
  };

  /** Привести часы в соответствие с тем, что сейчас на экране. */
  private sync = () => {
    this.stop();
    if (this.media === null || this.motion === null) return;

    this.away = isAway();
    if (!this.media.matches || document.hidden || this.away) {
      this.set(INITIAL[this.layout]);
      return;
    }
    if (this.motion.matches) {
      this.set(finalState(this.layout));
      return;
    }

    this.set(INITIAL[this.layout]);
    this.runLoop(performance.now() + (this.assembled ? RESUME_MS : heroStartAt(this.layout)));
    this.assembled = true;
  };

  private stop() {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
  }

  /** Круг, начатый в `begin` (отсчёт `performance.now()`), и следом — следующий. */
  private runLoop(begin: number) {
    const { actions, period } = this.timeline;
    for (const action of actions) {
      this.later(begin + action.at, () => this.apply(action.patch));
    }
    this.later(begin + period, () => this.runLoop(begin + period));
  }

  private later(at: number, run: () => void) {
    this.timers.push(window.setTimeout(run, Math.max(0, at - performance.now())));
  }

  private apply(patch: HeroPatch) {
    const { pointer, ...rest } = patch;
    const previous = this.state;
    this.set({
      stage: rest.stage ?? previous.stage,
      events: rest.events ? { ...previous.events, ...rest.events } : previous.events,
      pointer: pointer
        ? {
            visible: pointer.visible ?? previous.pointer.visible,
            day: pointer.day ?? previous.pointer.day,
            press: previous.pointer.press + (pointer.press ? 1 : 0),
            chip: pointer.chip === undefined ? previous.pointer.chip : pointer.chip,
          }
        : previous.pointer,
    });
  }
}

const stories: Partial<Record<HeroLayout, Story>> = {};

function story(layout: HeroLayout): Story {
  return (stories[layout] ??= new Story(layout));
}

/** Номер этапа расчёта: сколько записей стоит сейчас. */
export function useStoryStage(layout: HeroLayout): number {
  const current = story(layout);
  return useSyncExternalStore(current.subscribe, () => current.state.stage, () => 0);
}

/** Где в своей истории запись: ещё не ложилась, лежит или убрана. */
export function useStoryEvent(layout: HeroLayout, id: string): "idle" | "on" | "off" {
  const current = story(layout);
  return useSyncExternalStore(
    current.subscribe,
    () => current.state.events[id] ?? "idle",
    () => "idle",
  );
}

export function useStoryPointer(layout: HeroLayout): PointerState {
  const current = story(layout);
  return useSyncExternalStore(
    current.subscribe,
    () => current.state.pointer,
    () => HIDDEN_POINTER,
  );
}
