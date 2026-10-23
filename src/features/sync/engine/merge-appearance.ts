/**
 * Слияние оформления: цвета лампы и событий, выключатели.
 *
 * Тот же трёхсторонний разбор `base` ↔ `local` ↔ `remote`, что у профиля
 * (`merge.ts`), но проще, и вот почему: оформление — вкус, а не данные. Спрашивать
 * человека «на другом устройстве лампа настроена иначе» нельзя: такое окно
 * приучило бы закрывать окна не читая. Поэтому здесь НЕТ расхождений, на которые
 * нужен ответ, — всегда есть решение, и ничего при нём не теряется молча.
 *
 * --- Три природы данных ------------------------------------------------------
 *
 * | Что | Правило |
 * |---|---|
 * | Конфиги цветов (внутри списка лампы и каждого события) | Объединение по `id`. Был в `base` и пропал с одной стороны — удаление побеждает (как у записей профиля). Правлен по-разному с двух — сторона с более свежим `at`. Заведён с одной стороны — берётся. |
 * | Выключатели, действующий цвет | Изменились с одной стороны — берётся она. С обеих по-разному — более свежая правка. |
 * | Порядок в списке | Не выбирается, а выводится: по времени создания, затем по `id`. |
 *
 * --- Почему порядок выводится ------------------------------------------------
 *
 * Оставь слияние порядок «сначала наши, потом чужие» — и два устройства,
 * слившие одно и то же, получили бы списки в разном порядке. Каждое увидело бы
 * в чужом списке «изменение» и отправило бы своё: до бесконечности. Порядок по
 * `createdAt` (а при равенстве по `id`) один и тот же при любой очерёдности
 * слияний, и второй проход подряд не находит, что отправить.
 *
 * --- Почему «более свежая» считается по `at` целиком --------------------------
 *
 * У каждого скаляра своего времени нет: оно множило бы размер записи и ничего не
 * давало — человек двигает несколько ручек за один заход, и важнее, у кого
 * правка последняя вообще. Равное время (одна миллисекунда на двух устройствах —
 * случай, которого не бывает, но слияние обязано его пережить) решается
 * сравнением записей как строк: любая из сторон при этом выбирает ОДНО И ТО ЖЕ,
 * потому что сравнение симметрично.
 */

import {
  EVENT_COLOR_KEYS,
  MAX_CONFIGS,
  NO_PALETTE,
  type Appearance,
  type ColourConfig,
  type EventColorKey,
  type Palette,
} from "@/components/shared/appearance";

import { deepEqual } from "./deep-equal";

type Side = "local" | "remote";

/** Чья правка свежее: по `at`, при равенстве — по записи как строке. */
function fresher(local: Appearance, remote: Appearance): Side {
  if (local.at !== remote.at) return local.at > remote.at ? "local" : "remote";
  return JSON.stringify(local) > JSON.stringify(remote) ? "local" : "remote";
}

/** Значение, изменённое с одной стороны, — её; с обеих по-разному — свежей. */
function scalar<T>(base: T | undefined, local: T, remote: T, newer: Side): T {
  if (deepEqual(local, remote)) return local;
  if (base !== undefined) {
    if (deepEqual(base, local)) return remote;
    if (deepEqual(base, remote)) return local;
  }
  return newer === "local" ? local : remote;
}

/** Порядок списка: по времени создания, при равенстве — по `id`. */
function byCreation(first: ColourConfig, second: ColourConfig): number {
  if (first.createdAt !== second.createdAt) return first.createdAt < second.createdAt ? -1 : 1;
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
}

function mergeConfigs(
  base: readonly ColourConfig[] | null,
  local: readonly ColourConfig[],
  remote: readonly ColourConfig[],
  newer: Side,
): ColourConfig[] {
  const ids = new Set([...local, ...remote].map((config) => config.id));
  const merged: ColourConfig[] = [];

  for (const id of ids) {
    const was = base?.find((config) => config.id === id);
    const ours = local.find((config) => config.id === id);
    const theirs = remote.find((config) => config.id === id);

    // Был у обеих сторон на момент прошлой сверки и пропал с одной: её
    // удаление побеждает — стереть человек всегда успеет, а воскресить нет.
    if (was !== undefined && (ours === undefined || theirs === undefined)) continue;

    if (ours !== undefined && theirs !== undefined) {
      merged.push(scalar(was, ours, theirs, newer));
      continue;
    }

    // Заведён с одной стороны.
    const only = ours ?? theirs;
    if (only !== undefined) merged.push(only);
  }

  // Предел списка: больше двенадцати не бывает, а слияние двух полных списков
  // его перешагнёт. Остаются самые ранние — те, что человек завёл первыми, —
  // одинаково на всех устройствах.
  return merged.sort(byCreation).slice(0, MAX_CONFIGS);
}

function mergePalette(
  base: Palette | null,
  local: Palette,
  remote: Palette,
  newer: Side,
): Palette {
  const configs = mergeConfigs(
    base?.configs ?? null,
    local.configs,
    remote.configs,
    newer,
  );
  const active = scalar(base?.active, local.active, remote.active, newer);

  // Действующий цвет, чей конфиг удалён с другой стороны, — стандартный.
  return {
    configs,
    active: configs.some((config) => config.id === active) ? active : null,
  };
}

/**
 * Слить оформление.
 *
 * `base` — то, что сервер подтвердил в прошлый раз, или `null`, если этого
 * устройства он ещё не видел: тогда списки просто объединяются, а удаление
 * определить не по чему.
 */
export function mergeAppearance(
  base: Appearance | null,
  local: Appearance,
  remote: Appearance,
): Appearance {
  const newer = fresher(local, remote);

  const lamp = mergePalette(
    base === null ? null : base.lamp,
    local.lamp,
    remote.lamp,
    newer,
  );

  const kinds: Partial<Record<EventColorKey, Palette>> = {};

  for (const key of EVENT_COLOR_KEYS) {
    const ours = local.events.kinds[key] ?? NO_PALETTE;
    const theirs = remote.events.kinds[key] ?? NO_PALETTE;
    // Нет в `base` при живом `base` — значит, список был пуст, а не «неизвестен».
    const was = base === null ? null : (base.events.kinds[key] ?? NO_PALETTE);

    const palette = mergePalette(was, ours, theirs, newer);
    // Пустой список записи не занимает: так же хранит и разбор.
    if (palette.configs.length > 0) kinds[key] = palette;
  }

  return {
    at: local.at > remote.at ? local.at : remote.at,
    lamp: {
      on: scalar(base?.lamp.on, local.lamp.on, remote.lamp.on, newer),
      ...lamp,
    },
    events: {
      on: scalar(base?.events.on, local.events.on, remote.events.on, newer),
      kinds,
    },
  };
}
