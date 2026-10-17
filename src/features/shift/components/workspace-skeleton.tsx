import { Moon, Sun, ZoomIn, ZoomOut } from "lucide-react";

import type { ReactNode } from "react";

import { LegendMark, MARK_EMPTY_CLASS } from "@/components/shared/header-action";
import { Bone, BoneText } from "@/components/ui/bone";
import { KNOB_ICON, KNOB_NEST } from "@/components/ui/knob";
import { cn } from "@/lib/utils/cn";

import { datesOfMonth, dayOfMonth } from "../domain/plain-date";
import { DOCK, DOCK_LEFT, SHIFTS_ON } from "./grid-dock";
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
 * Образцы — самый широкий случай из настоящих, чтобы плашка заглушки не
 * оказалась уже той, что встанет на её место.
 */
const LEFT_FIGURES = [
  { value: "92", caption: "Смен по графику" },
  { value: "92", caption: "Отработано смен" },
] as const;

const RIGHT_FIGURES = [
  { value: "734", unit: "ч", caption: "Ночные часы" },
  { value: "96", unit: "ч", caption: "Праздничные часы" },
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
          {/* Мелкие плашки появляются там же, где в расчёте. Тот меряет
              строку и открывает их парами — по одной с каждой стороны, —
              и пороги у него приходятся на 814 точек (первая пара) и на
              1114 (вторая): замер с шагом в две точки, окно менялось на
              месте. Пороги задают подписи главных чисел («НОРМА ПЕРИОДА» —
              137 точек), а не сами числа, поэтому от профиля они почти не
              зависят. Заглушка мерить не умеет, поэтому держит те же
              пороги числами. */}
          <div
            className={cn(
              "relative flex items-stretch gap-2 px-6 pb-3",
              "min-[814px]:grid min-[814px]:grid-cols-[1fr_auto_1fr]",
              // С двумя парами мелкие плашки растут лишь до 10,5 рем, а дальше
              // растёт главная — тот же предел колонок, что в расчёте.
              "min-[1114px]:grid-cols-[minmax(0,21.5rem)_minmax(auto,1fr)_minmax(0,21.5rem)]",
            )}
          >
            <MainPlateBone />

            <div className="col-start-1 row-start-1 hidden h-14 min-w-0 gap-2 min-[814px]:flex">
              <MinorPlateBone {...LEFT_FIGURES[0]} />
              <MinorPlateBone {...LEFT_FIGURES[1]} className="hidden min-[1114px]:flex" />
            </div>
            <div className="col-start-3 row-start-1 hidden h-14 min-w-0 gap-2 min-[814px]:flex">
              <MinorPlateBone {...RIGHT_FIGURES[0]} />
              <MinorPlateBone {...RIGHT_FIGURES[1]} className="hidden min-[1114px]:flex" />
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
              {/* Над сеткой — только масштаб и только с `lg`, как в расчёте
                  (`year-view.tsx`): остальное управление — знаками нижнего
                  ряда. Кнопки подняты и ловят свет: те же девять десятых
                  рема, то же скругление, тот же `lit`, что у настоящих. */}
              <div className="hidden items-center lg:flex">
                <div className="ml-auto flex items-center gap-1">
                  <Bone className="lit size-9 rounded-xl" />
                  <Bone className="lit size-9 rounded-xl" />
                  <span className="sr-only">
                    <ZoomIn aria-hidden />
                    <ZoomOut aria-hidden />
                  </span>
                </div>
              </div>

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
          {/* Тема — той же картинкой, что у настоящего знака: солнце или
              месяц по классу темы на `html`, без сценария. */}
          <KnobBone>
            <Sun className={cn("dark:hidden", MARK_EMPTY_CLASS)} />
            <Moon className={cn("hidden dark:block", MARK_EMPTY_CLASS)} />
          </KnobBone>
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
 * Главные числа: то же построение, что в расчёте (`MainPlate`) — три
 * колонки поровну, число над подписью, без плашки и без света.
 *
 * Колонки делят строку целиком, пока мелких итогов рядом нет, и сжимаются
 * по содержимому и встают посередине, когда они появляются, — ровно как
 * настоящие. Без плашки и света заглушка не отличается от расчёта и в
 * том, что у главных чисел под ними ничего нет: в миг подстановки
 * зажигаться на этом месте нечему.
 */
function MainPlateBone() {
  return (
    <dl
      className={cn(
        "grid h-14 grid-cols-3 items-center",
        "min-w-0 flex-1 gap-x-1",
        "min-[814px]:col-start-2 min-[814px]:row-start-1 min-[814px]:flex-none",
        "min-[814px]:shrink-0 min-[814px]:gap-x-6 min-[814px]:px-5",
        // В сетке со сторонами колонки не уже своего содержимого — как
        // настоящие (`min-w-max`, довод — в `MainPlate`). С `min-w-0`
        // средняя колонка (`minmax(auto, 1fr)`) считала бы её нижней
        // границей ноль, и стороны, растущие до своего предела первыми,
        // сжимали бы её: на 1114–1250 точках колонки выходили вдвое уже
        // подписей.
        "min-[814px]:min-w-max",
      )}
    >
      <FigureBone value="1972" caption="Норма периода" />
      <FigureBone value="2192" caption="Отработано" />
      <FigureBone value="220" caption="Переработка" />
    </dl>
  );
}

/**
 * Число с подписью внутри главных чисел: тот же `Figure`, что в расчёте,
 * — число ростом нормы и жирное, подпись прописными гарнитурой названий.
 *
 * Кегль подписи ступенями, как у настоящей: классы с порогами написаны
 * целиком, а не собраны из переменной — Tailwind находит их в исходнике
 * как строки.
 */
function FigureBone({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-1">
      <dd className="whitespace-nowrap font-mono text-xl font-bold leading-none text-center sm:text-2xl">
        <BoneText skeleton>
          {value}
          <span className="ml-1 text-xs font-normal sm:text-sm">ч</span>
        </BoneText>
      </dd>
      <dt
        className={cn(
          "flex h-[1.25em] items-center justify-center whitespace-nowrap",
          "font-display font-bold uppercase leading-tight tracking-wide text-ink-muted",
          "text-xs min-[360px]:text-sm min-[414px]:text-base min-[470px]:text-lg min-[520px]:text-xl",
        )}
      >
        <BoneText skeleton>{caption}</BoneText>
      </dt>
    </div>
  );
}

/** Мелкий итог: то же построение, что у главного, но вполголоса. */
function MinorPlateBone({
  value,
  unit,
  caption,
  className,
}: {
  value: string;
  unit?: string;
  caption: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "lit flex min-w-0 flex-1 flex-col items-center justify-end rounded-xl bg-paper-raised px-3 pb-2",
        className,
      )}
    >
      <dd className="whitespace-nowrap font-mono text-base leading-none">
        <BoneText skeleton>
          {value}
          {unit ? <span className="ml-1 text-[11px]">{unit}</span> : null}
        </BoneText>
      </dd>
      <dt className="mt-1.5 flex h-3.5 items-center gap-1 whitespace-nowrap text-[11px] leading-tight text-ink-muted">
        <BoneText skeleton>{caption}</BoneText>
      </dt>
    </div>
  );
}

/**
 * Подвал профиля: плитки документов и адрес для обращений.
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
    // (`ProfileFooter`): он тоже стоит после `main`.
    <footer aria-hidden className="mx-auto mt-10 w-full px-6 2xl:max-w-[2000px]">
      <div className="space-y-4 border-t border-rule py-6 text-sm">
        {/* Плитки документов: та же сетка и та же начинка, что в подвале
            расчёта (`shared/site-footer.tsx`), — высота плитки и переносы
            названия получаются сами, а не подобраны числом. */}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {ДОКУМЕНТЫ_КОСТИ.map((документ) => (
            <span
              key={документ.label}
              className="flex items-center gap-3 rounded-xl bg-paper-raised px-3 py-2.5"
            >
              <Bone className="size-7 shrink-0 rounded-lg" />
              <span className="min-w-0">
                <BoneText skeleton className="block text-xs leading-4">
                  {документ.label}
                </BoneText>
                <BoneText skeleton className="block text-[11px] leading-4">
                  {документ.note}
                </BoneText>
              </span>
            </span>
          ))}
        </div>

        {/* Строка адреса — теми же словами и тем же кеглем, что в подвале
            расчёта: её высота и переносы получаются сами. */}
        <p className="mt-16 text-center text-xs text-ink-muted">
          <BoneText skeleton>Вопросы и обращения: grafik1-3@yandex.ru</BoneText>
        </p>
      </div>
    </footer>
  );
}

/**
 * Названия документов для плиток заглушки.
 *
 * Своей копией, а не ввозом из подвала: заглушке нужна только длина строк,
 * а знаки и адреса ссылок — нет. Разойдутся в длине — разойдётся высота
 * плитки, и это видно глазом; разойдутся в словах — не видно ничего.
 */
const ДОКУМЕНТЫ_КОСТИ = [
  { label: "Пользовательское соглашение", note: "Условия работы приложения" },
  { label: "Политика конфиденциальности", note: "Какие данные обрабатываются" },
  { label: "Согласие на обработку данных", note: "Что принимается при регистрации" },
  { label: "Настройки cookie", note: "Разрешить счётчик или отказать" },
] as const;
