"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";

import { MARK_EMPTY_CLASS } from "@/components/shared/header-action";
import { KNOB, KNOB_ICON, KNOB_NEST, KnobLabel } from "@/components/ui/knob";
import { useDismiss } from "@/components/ui/use-dismiss";
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
 * Угол один и тот же на всех страницах — правый нижний, — даже там, где
 * легенды нет и левый свободен: орган управления, переезжающий из угла
 * в угол от страницы к странице, каждый раз ищут заново.
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
  docked = false,
  className,
}: {
  /**
   * Знак стоит в нижнем ряду рабочего экрана (`grid-dock.tsx`) — последним,
   * у правого края, — и место ему задаёт ряд. Без ряда (посадочная,
   * открытый раздел) знак закреплён в правом нижнем углу сам — ровно там
   * же, где кончается ряд: при открытии раздела он не сдвигается ни на
   * точку.
   */
  docked?: boolean;
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
  // уход фокуса. Те же три, что у легенды и у меню в шапке.
  useDismiss(открыто, setОткрыто, гнездо);

  return (
    <div
      ref={гнездо}
      className={cn(
        // Сам по себе — в углу: та же высота от нижней кромки и то же поле
        // от боковой, что у нижнего ряда рабочего экрана, иначе знак
        // прыгал бы, когда ряд появляется и уходит.
        //
        // Гнездо держит наведение (`group/knob`), как у знаков нижнего
        // ряда: подпись не убегает, пока курсор в раскрытом окошке.
        docked
          ? KNOB_NEST
          : "group/knob fixed right-6 z-90 flex bottom-[calc(1.5rem+var(--safe-bottom))]",
        className,
      )}
    >
      {открыто && (
        <fieldset
          id={id}
          aria-label="Тема оформления"
          className={cn(
            // Вверх, а не вниз: знак стоит у нижней кромки, и раскрытое
            // вниз окошко уехало бы за экран целиком. Прижато к правому
            // краю, у которого стоит знак, — иначе оно вылезало бы за
            // кромку окна. Кайма — живая, как у всех окошек (`KNOB_POPOVER`).
            "lit modal-lift absolute bottom-full right-0 mb-2 w-52 max-w-[calc(100vw-3rem)]",
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
                onClick={() => {
                  setTheme(value);
                  // Выбрали — и спрашивать больше нечего: окошко
                  // открывали ради одного этого нажатия, а оставшись
                  // висеть, оно заставляло бы закрывать его отдельно.
                  setОткрыто(false);
                }}
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
        // Ни плашки, ни кромки — тот же знак, что у нижнего ряда (`KNOB`):
        // значок в 28 точек, место под палец в 44. Всплывающего `title`
        // нет, как и у соседей: на широком экране знак называет подпись,
        // и вторая, браузерная, вылезла бы поверх неё.
        className={KNOB}
      >
        {/* Подпись — слева: справа у знака кромка окна. Перед значком в
            разметке, чтобы значок стоял на месте, а подпись росла от него
            (`KnobLabel`). */}
        <KnobLabel side="left">Выбрать тему</KnobLabel>
        <span className={KNOB_ICON}>
          {/* Обе картинки стоят в разметке, а показывает одну таблица
              стилей по классу темы на `html`: ни гидратации, ни подмены
              через миг после открытия страницы.

              Цвет — ровно тот, которым нарисованы пустые квадраты логотипа
              (`shared/header-action.tsx`, `MARK_EMPTY`): знаки по углам
              окна стоят одним набором, и любое расхождение в полутоне
              читается как значки, собранные из разных мест. */}
          <Sun aria-hidden className={cn("dark:hidden", MARK_EMPTY_CLASS)} />
          <Moon aria-hidden className={cn("hidden dark:block", MARK_EMPTY_CLASS)} />
        </span>
      </button>
    </div>
  );
}
