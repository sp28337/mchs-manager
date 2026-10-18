import { Moon, Shrink, Sun, ZoomIn, ZoomOut } from "lucide-react";

import type { ReactNode } from "react";

import { LegendMark, MARK_EMPTY_CLASS, MARK_EMPTY_TEXT } from "@/components/shared/header-action";
import { BoneText } from "@/components/ui/bone";
import { FooterBody } from "@/components/shared/site-footer";
import { KNOB_ICON, KNOB_NEST } from "@/components/ui/knob";
import { cn } from "@/lib/utils/cn";

import { datesOfMonth, dayOfMonth } from "../domain/plain-date";
import { DOCK, DOCK_LEFT, DOCK_RIGHT, SCALE_KNOBS, SHIFTS_ON } from "./grid-dock";
import { CalendarIcon, PeriodIcon, ShiftsIcon, YearMark } from "./grid-icons";
import { LiveSignal } from "./live-mode";
import { MetaSep, MonthGrid, YEAR_BOX, YEAR_GRID } from "./month-grid";
import { MONTH_NAMES } from "./month-names";

/**
 * Рабочий экран, пока читается профиль.
 *
 * --- Почему не строка «Открываем ваш профиль…» ---------------------------
 *
 * Страница отдаётся статикой, и до запуска сценария в браузере человек
 * видит именно этот кадр. Строка на пустом поле сообщала о том, что и так
 * очевидно — что-то грузится, — и при этом ВРАЛА о размере: экран,
 * занятый одной строчкой, через мгновение оказывался экраном с полосой
 * итога, легендой и двенадцатью сетками.
 *
 * --- Главное требование: ни одного сдвига --------------------------------
 *
 * Заглушка обязана занимать РОВНО то место, которое займёт расчёт. Иначе
 * в момент подстановки страница дёргается, и человек читает это как сбой,
 * даже если не может назвать причину.
 *
 * Отсюда способ: заглушка не «похожа» на рабочий экран, а повторяет его
 * разметку — те же контейнеры с теми же классами, та же сетка месяцев
 * (`MonthGrid`). Там,
 * где место задаёт СТРОКА, в разметке лежит настоящая строка — те же
 * слова тем же кеглем, только прозрачные и на плашке (`BoneText`): высота
 * строки тогда не подбирается на глаз, а получается сама.
 *
 * Совпадение проверено замером: положение и высота каждого блока — имени,
 * полосы итога, кнопок шапки, панели управления, легенды и сеток —
 * сходятся с рабочим экраном на 390, 768, 1024, 1280 и 1440 точках.
 *
 * --- Чего заглушка знать не может ----------------------------------------
 *
 * Длины имени и самих чисел: они в профиле, который ещё читается. Поэтому
 * подставлены образцы той же природы — имя из одного слова, четырёхзначные
 * часы. Ширина от них зависит, а вот высота и положение строк — нет, и
 * сдвига по вертикали такая замена не даёт.
 *
 * --- Почему `aria-hidden` ------------------------------------------------
 *
 * Читать вслух дюжину пустых прямоугольников незачем. О том, что страница
 * занята, диктору сообщает подпись рядом (`sr-only` в экране расчёта), а
 * не эта картинка.
 */

/** Год образца: от него зависит только раскладка чисел по клеткам. */
const SAMPLE_YEAR = new Date().getUTCFullYear();

/** Двенадцать месяцев — столько же, сколько в расчёте за год. */
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/**
 * Мелкие итоги полосы — те же четыре, что в расчёте, и по тем же сторонам:
 * слева смены, справа часы (`period-summary.tsx`, `sideItems`).
 *
 * Образцы — самый широкий случай из настоящих, чтобы колонка заглушки не
 * оказалась уже той, что встанет на её место.
 */
const LEFT_FIGURES = [
  // Единица — «см», как в расчёте: сокращение не склоняется, и заглушке не
  // нужно гадать про окончание.
  { value: "92", unit: "см", caption: "По графику" },
  { value: "92", unit: "см", caption: "Отработано" },
] as const;

const RIGHT_FIGURES = [
  { value: "734", unit: "ч", caption: "Ночные" },
  { value: "96", unit: "ч", caption: "Праздничные" },
] as const;

/**
 * Кость имени профиля для строки шапки — тем же кеглем и той же
 * гарнитурой, что настоящее имя там (`ProfileName`, `place="header"`):
 * высота строки шапки от неё не зависит, а ширина обещает имя, которое
 * встанет на её место.
 */
export function ProfileNameBone() {
  return (
    // Одной строкой, как настоящее имя (`truncate` у него): кость в два
    // слова иначе переносилась, когда шапке тесно, и раздувала строку.
    <span aria-hidden className="font-hand text-3xl leading-none whitespace-nowrap">
      <BoneText skeleton className="rounded-md">
        Мой график
      </BoneText>
    </span>
  );
}

/**
 * Кость кнопки периода посередине шапки — той же меры, что настоящая
 * (`PeriodPicker`): те же часы в той же клетке. Круг целый — это год:
 * учётный период по умолчанию — год целиком, и в большинстве профилей
 * кнопка встанет ровно на место кости. Знак настоящий, но не нажимается —
 * как у знаков нижнего ряда.
 */
export function PeriodPickerBone() {
  return (
    <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center text-ink">
      <PeriodIcon kind="year" index={0} className="size-7" />
    </span>
  );
}

export function WorkspaceSkeleton() {
  return (
    <>
      <main
        aria-hidden
        className={cn(
          "mx-auto w-full px-6 pt-26 2xl:max-w-[2000px]",
          // Та же высота, что у рабочего экрана, и подвал так же за ней, вне
          // `main`: иначе страница дёрнулась бы ровно в тот миг, ради
          // которого заглушка и существует.
          "min-h-[var(--fold-min-h)]",
        )}
      >
        {/* Имя человека — водяным знаком: по центру и почти прозрачное.
            Кость под ним такая же бледная, иначе плотный прямоугольник
            обещал бы блок, которого через мгновение почти не видно. Поле
            под ним — то же, что в рабочем экране: полоса итога поднята на
            восемь точек и легла бы прямо на имя. */}
        {/* С `md` имя стоит в строке шапки (`ProfileNameBone` ниже), а
            здесь его нет — как у расчёта. */}
        <header className="pb-12 md:hidden">
          <h1 className="text-3xl font-hand sm:text-5xl opacity-10 leading-tight text-center">
            <BoneText skeleton className="rounded-xl">
              Мой график
            </BoneText>
          </h1>
        </header>

        {/* Полоса итога. Закреплена так же, как настоящая: иначе при
            прокрутке заглушка вела бы себя иначе, чем расчёт. */}
        {/* Та же примета, что у настоящей полосы: дымка обязана быть той же
            высоты и в заглушке — иначе в миг подстановки она поменяла бы
            высоту, и страница дёрнулась бы ровно там, где заглушка и
            существует, чтобы этого не случилось. */}
        {/* `md:-mt-2` — то же поле, что у настоящей полосы
            (`period-summary.tsx`): с `md` имя стоит в шапке, и полоса в
            потоке должна стоять ровно там, где закрепится. */}
        <div
          data-summary
          className="sticky top-[calc(6rem+var(--safe-top))] z-40 -mx-6 -translate-y-8 md:-mt-2"
        >
          {/* Мелкие итоги появляются там же, где в расчёте. Тот меряет
              строку и открывает их парами — по одной с каждой стороны, —
              и пороги у него приходятся на 542 точки (первая пара) и на
              785 (вторая): замер с шагом в одну точку, окно менялось на
              месте. Пороги задают подписи и числа, а не профиль, поэтому
              от него они почти не зависят. Заглушка мерить не умеет,
              поэтому держит те же пороги числами. */}
          <div
            className={cn(
              "relative flex items-center justify-center px-6 pb-3",
              "min-[542px]:grid min-[542px]:grid-cols-[1fr_auto_1fr] min-[542px]:justify-normal min-[542px]:gap-x-8",
            )}
          >
            <MainPlateBone />

            {/* Слева — к главным, то есть вправо; справа — влево. */}
            <div className={cn(SIDE_BONE, "col-start-1 row-start-1 justify-self-end")}>
              <FigureBone {...LEFT_FIGURES[0]} minor />
              <FigureBone {...LEFT_FIGURES[1]} minor className="hidden min-[785px]:flex" />
            </div>
            <div className={cn(SIDE_BONE, "col-start-3 row-start-1 justify-self-start")}>
              <FigureBone {...RIGHT_FIGURES[0]} minor />
              <FigureBone {...RIGHT_FIGURES[1]} minor className="hidden min-[785px]:flex" />
            </div>
          </div>
        </div>

        <div className="space-y-10">
          <section className="space-y-4 -translate-y-2">
            {/* Заголовок «Календарь» виден только программе чтения — как и в
                расчёте. Кости под него не ставится: он вынесен из потока и
                места на экране не занимает, а нарисованная на пустом месте
                полоса сдвинула бы всё под собой на строку. */}
            <h2 className="flex items-center gap-2 text-xl sr-only">Календарь</h2>

            {/* `year-room` — та же метка, что на корне `YearView`: из неё
                берётся число месяцев в ряду на каждой ширине. */}
            <div className="year-room space-y-4">
              {/* Сетка месяцев и легенда — тем же строем, что в графике: с
                  1280 точек легенда стоит колонкой слева на экране, ниже —
                  полосой над сеткой. */}
              <div className="space-y-6 xl:flex xl:flex-row-reverse xl:gap-4">
                {/* Раскладка года — теми же двумя классами, что у расчёта.
                    Ни числа месяцев в ряду, ни кегля здесь больше не
                    назначается: и то и другое приходит из `globals.css`, а
                    кегль вдобавок считается по ЗАМЕРУ мерной коробки —
                    запросом к ней, а не скриптом, которого у заглушки нет.

                    Раньше ступени были переписаны сюда руками
                    (`lg:grid-cols-4`, `text-xs`), и переписаны неточно: 12
                    точек против 11,28 у расчёта. От этой разницы разъезжалось
                    всё — буквы недели, клетка, шапка месяца, — и к декабрю
                    набегало девять точек, которые страница отыгрывала рывком
                    в момент подстановки. */}
                <div className={YEAR_BOX}>
                <div
                  className={cn(
                    YEAR_GRID,
                    // Названия месяцев и итоги под ними — кости. Обводка
                    // назначается отсюда, а не оборачивает текст в `span`:
                    // лишняя строчная коробка меняет округление ширины на
                    // доли пикселя, и шапка месяца переносится на вторую
                    // строку не там, где у расчёта.
                    "[&_h3]:skeleton-bone [&_h3]:rounded-xs [&_h3]:bg-paper-raised [&_h3]:text-transparent",
                    "[&_p]:skeleton-bone [&_p]:rounded-xs [&_p]:bg-paper-raised [&_p]:text-transparent",
                  )}
                >
                  {MONTHS.map((month) => (
                    <MonthBones key={month} month={month} />
                  ))}
                </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Нижний ряд знаков — тем же строем, что в расчёте (`grid-dock.tsx`):
            знаки в нём от профиля почти не зависят, и оставь ряд пустым — в
            миг подстановки у нижней кромки из ничего возникли бы шесть
            значков, то есть ровно тот рывок, ради которого заглушка и
            существует. Знаки настоящие, но не нажимаются: показан график,
            «Онлайн» выключен — как у расчёта по умолчанию. */}
        <div aria-hidden className={DOCK}>
          <div className={DOCK_LEFT}>
            <KnobBone>
              <LegendMark />
            </KnobBone>
            <KnobBone className={SHIFTS_ON}>
              <ShiftsIcon className="scale-100" />
            </KnobBone>
            <KnobBone className={MARK_EMPTY_CLASS}>
              <CalendarIcon className="scale-100" />
            </KnobBone>
            <KnobBone className="text-ink-muted">
              <YearMark year={SAMPLE_YEAR} />
            </KnobBone>
            <KnobBone>
              <LiveSignal on={false} className={MARK_EMPTY_CLASS} />
            </KnobBone>
          </div>
          <div className={DOCK_RIGHT}>
            {/* Знаки масштаба — как в расчёте, и тоже только с `lg`
                (`grid-dock.tsx`): та же колонка, те же три знака, чтобы в
                миг подстановки у правой кромки не возникли они из ничего. */}
            <div className={SCALE_KNOBS}>
              <KnobBone className={MARK_EMPTY_CLASS}>
                <Shrink />
              </KnobBone>
              <KnobBone className={MARK_EMPTY_CLASS}>
                <ZoomIn />
              </KnobBone>
              <KnobBone className={MARK_EMPTY_CLASS}>
                <ZoomOut />
              </KnobBone>
            </div>
            {/* Тема — той же картинкой, что у настоящего знака: солнце или
                месяц по классу темы на `html`, без сценария. */}
            <KnobBone>
              <Sun className={cn("dark:hidden", MARK_EMPTY_CLASS)} />
              <Moon className={cn("hidden dark:block", MARK_EMPTY_CLASS)} />
            </KnobBone>
          </div>
        </div>
      </main>

      <ProfileFooterBones />
    </>
  );
}

/** Знак нижнего ряда костью: та же клетка, что у настоящего, без кнопки. */
function KnobBone({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn(KNOB_NEST, "pointer-events-none")}>
      <span className={cn(KNOB_ICON, className)}>{children}</span>
    </span>
  );
}

/**
 * Месяц заглушки — той же деталью, что и в расчёте.
 *
 * Дни настоящие: от них зависит и число строк в месяце, и уступ в первой
 * неделе, и скругления по контуру. Подставить сюда «просто сорок две
 * клетки» значило бы получить сетку другой высоты.
 */
function MonthBones({ month }: { month: number }) {
  return (
    <MonthGrid
      joined
      // Строки настоящие, а не «примерно такие»: от их ширины зависит,
      // перенесётся ли шапка месяца на вторую строку. Образец итога взят
      // самый частый — норма месяца в сто шестьдесят восемь часов и восемь
      // смен по двадцать четыре.
      title={MONTH_NAMES[month - 1]}
      // Буквы недели — тоже кости: единственный настоящий текст посреди
      // пустых плашек читался бы как недогруженная страница, а не как
      // ожидание. Плашка по ширине буквы (`w-fit`), поэтому высота строки
      // остаётся той же, что у расчёта.
      weekdayProps={() => ({
        className: "skeleton-bone mx-auto w-fit rounded-xs bg-paper-raised text-transparent",
      })}
      // Итог собран из тех же кусков, что и настоящий (`MonthBalance` в
      // `shift-strip.tsx`): норма, факт и отдельная вставка с разницей и
      // её знаком. Склей их в одну строку — и строчных коробок станет
      // меньше, а округление ширины изменится на доли пикселя. Этих долей
      // хватает, чтобы шапка перенеслась на вторую строку не там, где у
      // расчёта, и сетка разъехалась на пятнадцать точек по высоте.
      meta={
        <span>
          {"168"} ч
          <MetaSep />
          {"192"} ч
          <MetaSep />
          <span>
            <span>+</span>
            {"24"} ч
          </span>
        </span>
      }
      days={datesOfMonth(SAMPLE_YEAR, month)}
      renderDay={(day, corners) => (
        // Клетка повторена целиком, вместе со вложенным квадратом и двумя
        // строками внутри. Без них клетка ниже настоящей: у той высоту
        // задаёт не только соотношение сторон, но и содержимое — на узких
        // экранах две строки в квадрат уже не помещаются и растягивают
        // его. Разница в полтора пикселя на клетку, но строк в году
        // шестьдесят, и внизу это складывалось в два десятка.
        <div
          className={cn(
            "relative flex aspect-square w-full min-w-0 flex-col",
            "items-center justify-center leading-tight bg-paper-raised lit-tile",
            corners,
          )}
        >
          {/* Рамка прозрачная, но настоящая — и стоит она там же, где в
              расчёте: у суток смены и у их продолжения, то есть у каждой
              второй пары. Рамка съедает у клетки две точки внутри, и на
              узкой клетке (с 1280 точек колонку у сетки отбирает легенда)
              это меняет её высоту на доли пикселя. Поставь рамку всем
              клеткам подряд — и год окажется на пиксель выше расчёта.

              Заливка здесь не для вида, а ради УГЛА. Клетка скруглена
              дважды: снаружи по контуру месяца (десять точек, приходят
              от сетки), внутри — своим квадратом (шесть). В расчёте
              внутренний квадрат непрозрачный и закрашивает наружную дугу
              обратно, поэтому по краю месяца видно скругление в шесть
              точек. Здесь он был прозрачным — и наружу выходили все
              десять: у заглушки углы получались круглее, чем у календаря,
              который встанет на её место.

              Пульсации на этом квадрате нет намеренно. Она меняет
              прозрачность, а под ним лежит клетка того же цвета: мигать
              было бы нечем, зато пульс на пятистах клетках разом читался
              бы как дыхание всего листа. */}
          <div
            className={cn(
              "flex aspect-square w-full min-w-0 flex-col items-center justify-center rounded-md leading-tight",
              "bg-paper-raised",
              (dayOfMonth(day) - 1) % 4 <= 1 ? "border border-transparent" : undefined,
            )}
          >
            <span className="font-mono text-[1em] text-transparent">
              {dayOfMonth(day)}
            </span>
            <span className="font-mono text-[0.75em] text-transparent">16</span>
          </div>
        </div>
      )}
    />
  );
}

/**
 * Сторона мелких итогов: колонки поровну по самой широкой, вплотную к
 * главным числам — как в расчёте (`SIDE` в `period-summary.tsx`). Скрыта,
 * пока мелким итогам нет места.
 */
const SIDE_BONE =
  "hidden h-14 min-w-0 grid-flow-col auto-cols-fr items-center gap-x-5 min-[542px]:grid";

/**
 * Главные числа: то же построение, что в расчёте (`MainPlate`) — три
 * колонки поровну, число над подписью, без плашки и без света.
 *
 * Одной группой по середине строки, пока мелких итогов рядом нет, и
 * сжимаются по содержимому, когда они появляются, — ровно как настоящие.
 * Без плашки и света заглушка не отличается от расчёта и в том, что под
 * числами ничего нет: в миг подстановки зажигаться на этом месте нечему.
 */
function MainPlateBone() {
  return (
    <dl
      className={cn(
        "grid h-14 grid-cols-3 items-center",
        "min-w-0 gap-x-2 min-[360px]:gap-x-5",
        // В сетке со сторонами группа не уже своего содержимого — как
        // настоящая (`min-w-max`, довод — в `MainPlate`). С `min-w-0`
        // средняя колонка (`1fr auto 1fr`) считала бы её нижней границей
        // ноль, и стороны сжимали бы её: на 1114–1250 точках колонки
        // выходили вдвое уже подписей.
        "min-[542px]:col-start-2 min-[542px]:row-start-1 min-[542px]:min-w-max min-[542px]:shrink-0",
        "min-[542px]:gap-x-5",
      )}
    >
      <FigureBone value="1972" unit="ч" caption="Норма периода" />
      <FigureBone value="2192" unit="ч" caption="Отработано" />
      <FigureBone value="220" unit="ч" caption="Переработка" />
    </dl>
  );
}

/**
 * Число с подписью: тот же `Figure`, что в расчёте, — главное число жирное
 * и одного роста, подпись прописными гарнитурой названий, мелко. Мелкий
 * итог (`minor`) — обычный вес, число на ступень меньше, подпись на любой
 * ширине в 12 точек.
 *
 * Ступени кегля те же, что у настоящей подписи (`CAPTION` в
 * `period-summary.tsx`), и порог у них общий — 42,5 рема, а не `sm`: почему,
 * написано там же. Классы с порогами написаны целиком, а не собраны из
 * переменной — Tailwind находит их в исходнике как строки.
 */
function FigureBone({
  value,
  unit,
  caption,
  minor,
  className,
}: {
  value: string;
  unit?: string;
  caption: string;
  minor?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col items-center justify-center gap-1", className)}>
      <dd
        className={cn(
          "flex h-5 items-end justify-center whitespace-nowrap font-mono leading-none text-center min-[42.5rem]:h-6",
          minor
            ? "text-lg min-[42.5rem]:text-xl"
            : "text-xl font-bold min-[42.5rem]:text-2xl",
        )}
      >
        <BoneText skeleton>
          {value}
          {unit ? (
            <span className="ml-1 text-xs font-normal min-[42.5rem]:text-sm">{unit}</span>
          ) : null}
        </BoneText>
      </dd>
      <dt
        className={cn(
          "flex h-[1.125rem] items-center justify-center whitespace-nowrap",
          "font-display uppercase leading-tight tracking-wide",
          MARK_EMPTY_TEXT,
          "text-[11px] min-[340px]:text-xs",
          minor ? "min-[42.5rem]:text-xs" : "font-bold min-[42.5rem]:text-sm",
        )}
      >
        <BoneText skeleton>{caption}</BoneText>
      </dt>
    </div>
  );
}

/**
 * Подвал профиля: перечень документов и адрес для обращений.
 *
 * Ровно то, что стоит в `ProfileFooter`, и ничего сверх того. Здесь долго
 * лежал прежний подвал — рассказ «Где лежат ваши данные» на три абзаца,
 * кнопка выгрузки и удаление профиля, — уже после того, как всё это оттуда
 * ушло: выгрузка в шапку, удаление в настройки, рассказ на посадочную.
 * Заглушка обещала блок, которого через мгновение не оказывалось, и
 * страница на двести тридцать точек короче — то есть врала ровно о том, ради
 * чего она существует.
 *
 * Переключателя темы здесь больше нет по той же причине: он уехал в правый
 * нижний угол окна (`ui/theme-toggle.tsx`), и в потоке страницы его место
 * ничем не занято.
 */
function ProfileFooterBones() {
  return (
    // Те же поля, ширина и просвет сверху, что у настоящего подвала
    // (`ProfileFooter`): он тоже стоит после `main`, и рамка у него та же,
    // что у графика (`frame-inset`).
    <footer aria-hidden className="mx-auto mt-10 w-full px-6 2xl:max-w-[2000px]">
      <div className="frame-inset">
        <div className="py-10">
          {/* Тот же подвал, что у расчёта (`shared/site-footer.tsx`), только
              костями: высота получается сама, а не подбирается числом. */}
          <FooterBody skeleton />
        </div>
      </div>
    </footer>
  );
}
