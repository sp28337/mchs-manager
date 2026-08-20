import { cn } from "@/lib/utils/cn";

/**
 * Рабочий экран, пока читается профиль.
 *
 * --- Почему не строка «Открываем ваш профиль…» ---------------------------
 *
 * Страница отдаётся статикой, и до запуска сценария в браузере человек
 * видит именно этот кадр. Строка на пустом поле сообщала о том, что и так
 * очевидно — что-то грузится, — и при этом ВРАЛА о размере: экран,
 * занятый одной строчкой, через мгновение оказывался экраном с полосой
 * итога и двенадцатью сетками. Каждый такой скачок человек читает как
 * сбой, даже если не может назвать причину.
 *
 * Заглушка повторяет раскладку рабочего экрана по местам и размерам:
 * имя, закреплённая полоса с плашками, заголовок календаря, панель
 * управления и сетка месяцев. Когда профиль прочитан, на месте каждого
 * прямоугольника оказывается то, что он занимал, и страница не
 * перестраивается.
 *
 * --- Почему прямоугольники, а не силуэты чисел ---------------------------
 *
 * Заглушка не должна показывать содержание, которого ещё нет: ни числа,
 * ни клетки смен. Она показывает ФОРМУ — те же плашки того же цвета, что
 * будут стоять здесь через мгновение. Пульсация отличает её от готового
 * экрана: без неё человек секунду решает, не пустой ли у него профиль.
 *
 * `prefers-reduced-motion` гасит пульсацию общим правилом в `globals.css`:
 * остаётся неподвижная раскладка, что для заглушки достаточно.
 *
 * --- Почему `aria-hidden` ------------------------------------------------
 *
 * Читать вслух двенадцать пустых прямоугольников незачем. О том, что
 * страница занята, диктору сообщает подпись рядом (`sr-only` в шапке
 * экрана), а не эта картинка.
 */

/** Столько месяцев стоит в сетке на широком экране. */
const MONTHS = 12;

/** Клеток в месяце: шесть недель по семь дней. */
const CELLS = 42;

export function WorkspaceSkeleton() {
  return (
    <main
      aria-hidden
      className="mx-auto w-full px-6 pb-12 pt-26 2xl:max-w-[2000px]"
    >
      {/* Имя человека. Поле под ним — то же, что в рабочем экране: полоса
          итога поднята на восемь точек и легла бы прямо на имя. */}
      <header className="pb-12">
        <Bone className="h-9 w-52 rounded-xl" />
      </header>

      {/* Полоса итога. Главная плашка и пять мелких — как в расчёте: на
          узком экране мелкие не помещаются и там их нет тоже. */}
      <div className="-mx-6 -translate-y-8">
        <div className="flex items-stretch gap-2 px-6 pb-3">
          <Bone className="h-14 w-full max-w-64 rounded-xl" />
          <div className="hidden h-14 min-w-0 flex-1 gap-2 md:flex">
            {Array.from({ length: 5 }, (_, index) => (
              <Bone key={index} className="h-14 flex-1 rounded-xl" />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <Bone className="h-7 w-40 rounded-xl" />

        {/* Панель управления сеткой: что показывать, за какой период и
            каким размером. */}
        <div className="flex flex-wrap items-center gap-3">
          <Bone className="h-9 w-48 rounded-xl" />
          <Bone className="h-9 w-32 rounded-xl" />
          <Bone className="h-9 w-36 rounded-xl" />
          <div className="ml-auto hidden gap-1 lg:flex">
            <Bone className="size-9 rounded-xl" />
            <Bone className="size-9 rounded-xl" />
          </div>
        </div>

        {/* Сетка месяцев и легенда — той же раскладкой, что в графике:
            от 1280 точек легенда стоит колонкой справа в разметке и слева
            на экране (`flex-row-reverse`), ниже — полосой над сеткой.

            Число месяцев в ряду взято из `YearView`
            (`DEFAULT_ZOOMABLE_SCALE`), а не на глаз: разойдись они — и
            заглушка сменялась бы перестроением всей сетки. */}
        <div className="space-y-6 xl:flex xl:flex-row-reverse xl:gap-4">
          <div className="grid flex-1 gap-x-6 gap-y-5 max-sm:px-[5%] sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: MONTHS }, (_, index) => (
              <MonthBones key={index} />
            ))}
          </div>

          <div className="space-y-4 rounded-xl bg-paper-raised/70 p-4 lg:min-w-92.5 xl:w-full xl:max-w-70 xl:self-start">
            {[4, 4, 6].map((rows, group) => (
              <div key={group} className="space-y-2">
                <Bone className="h-3 w-32 rounded-xs" />
                {Array.from({ length: rows }, (_, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Bone className="size-6 rounded-sm" />
                    <Bone className="h-3 flex-1 rounded-xs" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

/** Месяц: подпись с итогом, буквы дней недели и сомкнутая плашка клеток. */
function MonthBones() {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1">
        <Bone className="h-3.5 w-16 rounded-xs" />
        <Bone className="h-3 w-20 rounded-xs" />
      </div>

      <div className="grid grid-cols-7 pb-1.5">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="flex justify-center">
            <Bone className="h-2 w-3 rounded-xs" />
          </div>
        ))}
      </div>

      {/* Клетки сомкнуты и обрезаны общим скруглением — так же, как месяц
          в расчёте держит форму собственным контуром, а не рамками
          каждой клетки. */}
      <div className="grid grid-cols-7 overflow-hidden rounded-lg">
        {Array.from({ length: CELLS }, (_, index) => (
          <Bone key={index} className="aspect-square rounded-none" />
        ))}
      </div>
    </section>
  );
}

/** Место будущего блока: тот же тон, что у плашки, которая сюда встанет. */
function Bone({ className }: { className?: string }) {
  return <div className={cn("skeleton-bone bg-paper-raised", className)} />;
}
