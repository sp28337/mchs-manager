"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Переключатель темы.
 *
 * --- Почему три положения, а не тумблер ---------------------------------
 *
 * «Как в системе» — не то же самое, что светлая: человек, у которого
 * телефон темнеет вечером, ожидает того же и здесь. Тумблер из двух
 * положений это состояние теряет, и вернуться к нему потом нельзя.
 *
 * --- Почему до монтирования рисуется заглушка ---------------------------
 *
 * Тема известна только в браузере: на сервере нет ни `localStorage`, ни
 * системной настройки. Нарисовать на сервере догадку — значит получить
 * ошибку гидратации и подсвеченную не ту кнопку в первый момент. Место
 * при этом занимается сразу, чтобы соседние элементы не прыгнули.
 */

const OPTIONS = [
  { value: "light", label: "Светлая", Icon: Sun },
  { value: "dark", label: "Тёмная", Icon: Moon },
  { value: "system", label: "Как в системе", Icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Тема известна только в браузере, и узнать об этом можно не раньше
  // монтирования — другого способа отличить сервер от клиента нет.
  // Правило запрещает синхронный `setState` в эффекте из-за лишнего
  // прогона отрисовки; здесь он однократный и оправдан.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  return (
    // `w-fit` — не украшение: рамка обводит три кнопки, а не полосу от
    // края до края. В колонке (подвал на телефоне) элемент по умолчанию
    // растягивается на всю ширину, и обводка растягивалась вместе с ним,
    // оставляя кнопки в левом углу пустого прямоугольника.
    <fieldset
      className="flex w-fit items-center gap-0.5 rounded-xl p-0.5"
      aria-label="Тема оформления"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={mounted ? active : undefined}
            className={cn(
              "flex size-7 items-center justify-center rounded-lg cursor-pointer",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
              active ? "bg-ink text-paper" : "text-ink-muted hover:text-ink",
            )}
            onClick={() => setTheme(value)}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * Тот же выбор темы — знаком в правом нижнем углу рабочего экрана.
 *
 * --- Почему в углу, а не в подвале ----------------------------------------
 *
 * В подвале он лежал за всей прокруткой страницы: человеку, которому
 * режет глаза прямо сейчас, идти до него через двенадцать сеток. Тема
 * относится не к странице, а к окну, и своего места ни в одном разделе
 * не имеет — значит, её место в углу окна, как и у легенды.
 *
 * --- Почему знак, а не три кнопки -----------------------------------------
 *
 * Углов у окна четыре, и в трёх уже стоит по одному знаку: сверху слева
 * знак сайта, сверху справа меню, снизу слева легенда. Полоса из трёх
 * кнопок в четвёртом углу вчетверо шире любого из них, и ряд, который
 * глаз читает по углам, на ней ломается.
 *
 * Поэтому в углу один знак того же размера, что остальные, а три
 * положения живут в окошке — ровно как легенда у своего знака и меню у
 * своего. Цена — одно лишнее нажатие, и платится она редко: тему
 * выбирают один раз.
 *
 * --- Почему на знаке солнце или месяц, а не выбранное положение -----------
 *
 * Положений три, а картинок на знаке две, и это не упущение. Тема
 * известна только в браузере, и знак, нарисованный по ней, на сервере
 * рисовать нечем: любая догадка — это или ошибка гидратации, или подмена
 * картинки на глазах у человека через миг после открытия.
 *
 * Поэтому знак показывает не ВЫБОР, а то, что человек и так видит перед
 * собой: светлую тему солнцем, тёмную месяцем. Делает это таблица стилей
 * по классу на `html` (`next-themes`, `attribute="class"`), то есть ещё
 * до того, как выполнится хоть одна строка нашего кода. Какое из трёх
 * положений выбрано — сказано в окошке, где об этом и спрашивают.
 */
export function ThemeCorner({
  aboveDeck = false,
  className,
}: {
  /**
   * Снизу на телефоне стоит панель сеток (`grid-deck.tsx`) — знак
   * поднимается над ней. Пока вместо расчёта показан раздел, панели нет,
   * и поднимать знак не над чем: он опускается в самый угол, как на
   * мониторе. Иначе он висел бы посреди анкеты настроек.
   */
  aboveDeck?: boolean;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [открыто, setОткрыто] = useState(false);
  const гнездо = useRef<HTMLDivElement>(null);
  const id = useId();

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // Закрывается всеми способами, какими обязано: `Esc`, нажатие мимо,
  // уход фокуса. Те же три, что у легенды (`legend-button.tsx`) и у меню
  // в шапке (`shared/header-menu.tsx`).
  useEffect(() => {
    if (!открыто) return;

    const закрыть = () => setОткрыто(false);
    const мимо = (событие: PointerEvent) => {
      if (!гнездо.current?.contains(событие.target as Node)) закрыть();
    };
    const клавиша = (событие: KeyboardEvent) => {
      if (событие.key === "Escape") закрыть();
    };
    const фокус = (событие: FocusEvent) => {
      if (!гнездо.current?.contains(событие.target as Node)) закрыть();
    };

    document.addEventListener("pointerdown", мимо);
    document.addEventListener("keydown", клавиша);
    document.addEventListener("focusin", фокус);

    return () => {
      document.removeEventListener("pointerdown", мимо);
      document.removeEventListener("keydown", клавиша);
      document.removeEventListener("focusin", фокус);
    };
  }, [открыто]);

  return (
    <div
      ref={гнездо}
      className={cn(
        // Зеркало легенды: та же высота от нижней кромки и то же поле от
        // боковой, только у другого края. На телефоне отсчёт идёт от
        // панели сеток и безопасной зоны — теми же числами, что у
        // легенды, иначе два знака в одном ряду стояли бы на разной
        // высоте.
        "fixed right-6 z-90 bottom-[calc(1.5rem+var(--safe-bottom))]",
        aboveDeck && "max-md:bottom-[calc(5.5rem+var(--safe-bottom))]",
        className,
      )}
    >
      {открыто && (
        <fieldset
          id={id}
          aria-label="Тема оформления"
          className={cn(
            "modal-lift absolute bottom-full right-0 mb-2 w-52 max-w-[calc(100vw-3rem)]",
            "overflow-hidden rounded-xl bg-paper-raised p-1.5",
          )}
        >
          {OPTIONS.map(({ value, label, Icon }) => {
            const active = mounted && theme === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={mounted ? active : undefined}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2",
                  "text-left text-sm transition-colors hover:bg-paper-sunken",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
                  "[&_svg]:size-4 [&_svg]:shrink-0",
                  active ? "bg-paper-sunken font-medium text-ink" : "text-ink-muted",
                )}
              >
                <Icon aria-hidden className={active ? "text-ink" : undefined} />
                {label}
                {/* Галочка, а не только цвет: выбранное положение названо
                    знаком, который читается и на чёрно-белом экране, и
                    тем, кто не различает оттенки серого. */}
                {active ? <Check aria-hidden className="ml-auto text-ink" /> : null}
              </button>
            );
          })}
        </fieldset>
      )}

      <button
        type="button"
        onClick={() => setОткрыто((было) => !было)}
        aria-expanded={открыто}
        aria-controls={id}
        aria-label="Тема оформления"
        title="Тема оформления"
        className={cn(
          // Ни плашки, ни кромки — один знак, как у легенды в левом углу
          // и у надписей в шапке. Размер знака — те же 28 точек, что у
          // знака сайта и у знака легенды: углы читаются как один ряд,
          // и знак на пару точек меньше ломал бы его.
          //
          // Место под палец при этом 44 точки: цель размером со значок —
          // промах через раз.
          "grid size-11 cursor-pointer place-items-center rounded-xl text-ink",
          "transition-opacity hover:opacity-80",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        )}
      >
        {/* Обе картинки стоят в разметке, а показывает одну таблица
            стилей по классу темы на `html`: ни гидратации, ни подмены
            через миг после открытия страницы. */}
        <Sun aria-hidden className="size-7 dark:hidden" />
        <Moon aria-hidden className="hidden size-7 dark:block" />
      </button>
    </div>
  );
}
