"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { DEFAULT_SCHEDULE_LABEL } from "@/features/shift/domain/schedule-pattern";
import {
  storedScheduleLabel,
  subscribeToStoredProfile,
} from "@/features/shift/storage/profile";

/**
 * Цифры графика в названии сайта: «График 1 3».
 *
 * --- Почему они не постоянные ---------------------------------------------
 *
 * Название сайта — «График 1 3», и цифры в нём назывались тем же, чем
 * приложение и было: одним-единственным графиком. Теперь график выбирается,
 * и человек, ведущий два через два, каждый раз читал бы в шапке чужой.
 *
 * Меняется только вторая часть. «График» остаётся: это имя сервиса, а не
 * описание чьего-то расписания.
 *
 * --- Почему это решается в браузере ----------------------------------------
 *
 * Профиль лежит в `localStorage`, страницы отдаются статикой — одни на
 * всех. В разметку уходит «1 3»: посадочную открывают в основном те, кто
 * пришёл из поиска и ничего ещё не заводил, да и название сервиса именно
 * такое. У кого выбран другой график, цифры меняются первым же кадром.
 *
 * `useSyncExternalStore` взят ради этого честно: он сам отдаёт разметке
 * серверное значение, а браузеру — своё, и подмена не считается
 * расхождением при гидратации.
 *
 * --- Почему цифры истлевают -------------------------------------------------
 *
 * Смена графика — не мелкая правка настроек: под неё перестраивается весь
 * календарь. Подменить цифры мгновенно значило бы не сказать об этом
 * ничего; глаз в шапку в этот момент не смотрит — он смотрит в настройки,
 * где только что щёлкнул.
 *
 * Поэтому старые цифры не исчезают, а прогорают: истлевают наискось, как
 * бумага от края, и остатки сносит вверх и вправо. Движение в стороне от
 * взгляда заметно именно движением, а не цветом, и человек успевает
 * увидеть, ЧТО там поменялось, а не обнаружить это потом.
 *
 * Цифры тлеют по очереди — вторая на девяносто миллисекунд позже первой:
 * ветер не сдувает обе разом.
 */

/** Сколько прогорают старые цифры. Столько же стоит в `globals.css`. */
const ASH_MS = 760;

/** Догорающая пара со счётчиком: он отличает одно прогорание от другого. */
interface Burning {
  pattern: string;
  at: number;
}

export function ScheduleMark() {
  const pattern = useSyncExternalStore(
    subscribeToStoredProfile,
    storedScheduleLabel,
    () => DEFAULT_SCHEDULE_LABEL,
  );

  // Что нарисовано сейчас и что догорает поверх. Второе живёт ровно до
  // конца анимации: держать его дольше значило бы оставить в шапке две
  // пары цифр, из которых одна уже ничего не значит.
  const [shown, setShown] = useState<string>(pattern);
  const [burning, setBurning] = useState<Burning | null>(null);

  // Правка состояния ПРЯМО В ОТРИСОВКЕ, а не в эффекте, и это здесь
  // единственный верный способ: эффект работает после того, как кадр уже
  // нарисован, и человек увидел бы старые цифры лишний кадр, а потом
  // прыжок. React такую правку поощряет — она сворачивается в ту же
  // отрисовку, до показа.
  if (pattern !== shown) {
    // Счётчик, а не просто график: переключи 1/3 → 2/2 → 1/3, и догорать
    // будет дважды один и тот же — без счётчика второй раз не отличить от
    // первого, и таймер бы не перезапустился.
    setBurning({ pattern: shown, at: (burning?.at ?? 0) + 1 });
    setShown(pattern);
  }

  useEffect(() => {
    if (burning === null) return;
    const timer = window.setTimeout(() => setBurning(null), ASH_MS);
    return () => window.clearTimeout(timer);
  }, [burning]);

  return (
    // Место под цифры держит текущая пара, догорающая лежит поверх и из
    // потока вынута: иначе на время анимации название становилось бы вдвое
    // длиннее и толкало кнопки шапки.
    <span className="relative inline-block text-ink-muted">
      <Digits key={shown} pattern={shown} kindle={burning !== null} />
      {burning ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 whitespace-nowrap"
        >
          <Digits key={`ash-${burning.at}`} pattern={burning.pattern} ash />
        </span>
      ) : null}
    </span>
  );
}

/**
 * Пара цифр с разделителем между ними.
 *
 * Разделитель стоит в разметке всегда и просто прозрачен: появись он
 * только при наведении, название дёргалось бы по ширине. Пробел перед
 * цифрами тоже намеренный — без него программа чтения произносит
 * «График13».
 */
function Digits({
  pattern,
  ash,
  kindle,
}: {
  /** Подпись графика: «1/3», «2/2», «3/1». */
  pattern: string;
  /** Эти цифры догорают: их сносит и растворяет. */
  ash?: boolean;
  /** Эти цифры приходят на смену догорающим. */
  kindle?: boolean;
}) {
  const [first = "1", second = "3"] = pattern.split("/");
  const digit = ash ? "mark-ash" : kindle ? "mark-kindle" : undefined;

  return (
    <>
      <span className={digit} style={{ "--mark-i": 0 } as React.CSSProperties}>
        {first}
      </span>
      <span className="font-extralight opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        |
      </span>
      <span className={digit} style={{ "--mark-i": 1 } as React.CSSProperties}>
        {second}
      </span>
    </>
  );
}
