import { ChartColumn, FolderOpen, Save, Settings, ZoomIn, ZoomOut } from "lucide-react";

import type { ReactNode } from "react";

import { Bone, BoneText } from "@/components/ui/bone";
import { cn } from "@/lib/utils/cn";

import { datesOfMonth, dayOfMonth } from "../domain/plain-date";
import {
  CALENDAR_SHORT,
  CAPTION_NARROW,
  CAPTION_WIDE,
  DECK_CAPTION,
  DECK_CELL,
  DECK_PAIR,
  DECK_RAISED,
  DECK_SHELL,
  DECK_ROW,
  WORKSPACE_PAD,
} from "./grid-deck";
import { CalendarIcon, PeriodIcon, ShiftsIcon } from "./grid-icons";
import { LABELS_FROM } from "./header-tools";
import { LiveSignal, LIVE_ROW_CAPTION, LIVE_ROW_CELL } from "./live-mode";
import { MetaSep, MonthGrid, YEAR_BOX, YEAR_GRID } from "./month-grid";
import { MONTH_NAMES } from "./month-names";
import { ShiftLegend } from "./shift-strip";

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
 * (`MonthGrid`) и та же легенда (`ShiftLegend` в режиме заглушки). Там,
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
 * Мелкие итоги полосы: те же пять, что считает расчёт.
 *
 * Образцы четырёхзначные — самый широкий случай из настоящих, чтобы
 * плашка заглушки не оказалась уже той, что встанет на её место.
 */
const MINOR_FIGURES = [
  { value: "92", caption: "Смен по графику" },
  { value: "92", caption: "Отработано смен" },
  { value: "0", caption: "Пропущено" },
  { value: "734", unit: "ч", caption: "Ночные часы" },
  { value: "96", unit: "ч", caption: "Праздничные часы" },
];

export function WorkspaceSkeleton() {
  return (
    <main
      aria-hidden
      className={cn("mx-auto w-full px-6 pt-26 2xl:max-w-[2000px]", WORKSPACE_PAD)}
    >
      {/* Имя человека — водяным знаком: по центру и почти прозрачное.
          Кость под ним такая же бледная, иначе плотный прямоугольник
          обещал бы блок, которого через мгновение почти не видно. Поле
          под ним — то же, что в рабочем экране: полоса итога поднята на
          восемь точек и легла бы прямо на имя. */}
      <header className="pb-12">
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
      <div data-summary className="sticky top-[calc(6rem+var(--safe-top))] z-40 -mx-6 -translate-y-8">
        <div className="relative flex items-stretch gap-2  px-6 pb-3">
          <MainPlateBone />

          {/* Мелкие плашки появляются там же, где в расчёте: тот меряет
              строку и прячет их, когда не помещаются, и порог у него
              приходится ровно на 1024 точки — проверено замером. */}
          <div className="hidden h-14 min-w-0 flex-1 gap-2 lg:flex">
            {MINOR_FIGURES.map((figure) => (
              <MinorPlateBone key={figure.caption} {...figure} />
            ))}
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
            {/* Панель управления сеткой: что показывать, за какой период,
                живым временем или целиком, и каким размером. */}
            <div className="space-y-3">
              {/* До `md` строки нет — как и в расчёте: там же, где у него,
                  органы управления уезжают в нижнюю панель. */}
              <div className="hidden flex-wrap items-center gap-2 md:flex">
                <div className="flex-wrap flex lg:min-w-92.5 gap-2 justify-between">
                  <div className="inline-flex h-9 items-center gap-0.5 rounded-xl lg:flex-1 lg:justify-between bg-paper-sunken">
                    <SegmentBone active wide>
                      <ShiftsIcon />
                      График
                    </SegmentBone>
                    <SegmentBone wide>
                      <CalendarIcon />
                      Календарь
                    </SegmentBone>
                  </div>

                  <span
                    className={cn(
                      "lit inline-flex h-9 shrink-0 items-center gap-2 rounded-xl",
                      "skeleton-bone bg-paper-raised px-3 text-sm font-medium text-transparent",
                    )}
                  >
                    <PeriodIcon className="opacity-0" />
                    {SAMPLE_YEAR} год
                  </span>
                </div>

                {/* Кнопка «Онлайн»: знак и подпись рядом, в той же мере,
                    что у настоящей (`live-mode.tsx`). Знак настоящий —
                    выключенный: он не зависит от профиля, и серый
                    прямоугольник на его месте прятал бы то, что уже
                    известно. Подпись — кость той же гарнитуры и кегля,
                    иначе строка перестроится в момент подстановки. */}
                <span className={cn(LIVE_ROW_CELL, "text-ink-muted")}>
                  <LiveSignal on={false} />
                  <span className={LIVE_ROW_CAPTION}>
                    <BoneText skeleton>Онлайн</BoneText>
                  </span>
                </span>

                <div className="ml-auto hidden items-center gap-1 lg:flex">
                  <span className="mr-1 font-display text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                    <BoneText skeleton>Масштаб</BoneText>
                  </span>
                  {/* Кнопки масштаба подняты и ловят свет, как и всё в этой
                      строке: те же девять десятых рема, то же скругление,
                      тот же `lit`, что у настоящих (`year-view.tsx`). */}
                  <Bone className="lit size-9 rounded-xl" />
                  <Bone className="lit size-9 rounded-xl" />
                  <span className="sr-only">
                    <ZoomIn aria-hidden />
                    <ZoomOut aria-hidden />
                  </span>
                </div>
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

              <ShiftLegend skeleton />
            </div>
          </div>
        </section>

        <ProfileFooterBones />
      </div>

      {/* Нижняя панель телефона — костями, но той же меры: корыто, четыре
          ячейки, поднятые ровно те же (`grid-deck.tsx`). Оставь её пустой —
          и в миг подстановки у нижней кромки экрана из ничего появилась бы
          панель, то есть ровно тот рывок, ради которого заглушка и
          существует. */}
      <div className={DECK_SHELL}>
        <div className={DECK_ROW}>
          {/* Пара сеток обёрнута так же, как в расчёте: обёртка забирает
              две доли места и держит просвет между ячейками, а без неё
              строка делилась бы на четыре равные части. */}
          <div className={DECK_PAIR}>
            <DeckCellBone raised caption="График" icon={<ShiftsIcon />} />
            <DeckCellBone caption="Календарь" short={CALENDAR_SHORT} icon={<CalendarIcon />} />
          </div>
          <DeckCellBone
            raised
            caption={`${SAMPLE_YEAR} год`}
            icon={<PeriodIcon />}
          />
          <DeckCellBone caption="Онлайн" icon={<LiveSignal on={false} />} />
        </div>
      </div>

    </main>
  );
}

/**
 * Ячейка нижней панели костью: знак виден, подпись — плашка.
 *
 * Знак оставлен настоящим, а не спрятан: он не меняется от того, прочитан
 * профиль или нет, и заменять его серым прямоугольником значило бы прятать
 * то, что уже известно. Меняется только подпись — год у периода зависит от
 * профиля, — и под неё стоит кость.
 */
function DeckCellBone({
  raised,
  icon,
  caption,
  short,
}: {
  raised?: boolean;
  icon: ReactNode;
  caption: string;
  /** Укороченная подпись на узком экране — как и в панели. */
  short?: string;
}) {
  return (
    <span className={cn(DECK_CELL, raised && DECK_RAISED, "text-ink-muted")}>
      {icon}
      <span className={DECK_CAPTION}>
        {short === undefined ? (
          <BoneText skeleton>{caption}</BoneText>
        ) : (
          <>
            <span className={CAPTION_WIDE}>
              <BoneText skeleton>{caption}</BoneText>
            </span>
            <span className={CAPTION_NARROW}>
              <BoneText skeleton>{short}</BoneText>
            </span>
          </>
        )}
      </span>
    </span>
  );
}

/**
 * Кнопки шапки: настройки, статистика, открытие и выгрузка.
 *
 * Живут они в рабочем экране, а тот появляется только с профилем, — и
 * пока профиль читается, шапка стояла пустой, а потом в ней разом
 * возникали кнопки. Заглушка обещает КАЖДУЮ кнопку расчёта: они на виду с
 * первого кадра.
 *
 * Разметка повторяет `HeaderTools` целиком, вместе с порогом подписей —
 * и порог берётся оттуда же переменной, а не переписывается сюда: без
 * него на телефоне кость была бы шире кнопки, которая её сменит, а с
 * переписанным он рано или поздно разошёлся бы с настоящим.
 */
export function HeaderToolsBones() {
  return (
    <div className="flex items-center gap-2">
      {[
        { label: "Настройки", Icon: Settings },
        { label: "Статистика", Icon: ChartColumn },
        { label: "Открыть", Icon: FolderOpen },
        { label: "Сохранить", Icon: Save },
      ].map(({ label, Icon }) => (
        <span
          key={label}
          className={cn(
            "lit inline-flex h-9 shrink-0 items-center gap-2 rounded-xl",
            "px-3 text-sm font-medium",
            "skeleton-bone bg-paper-raised text-transparent",
          )}
        >
          <Icon aria-hidden className="size-4.5 shrink-0 opacity-0" />
          <span className={LABELS_FROM}>{label}</span>
        </span>
      ))}
    </div>
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
      // самый частый — восемь смен по двадцать четыре часа.
      title={MONTH_NAMES[month - 1]}
      // Буквы недели — тоже кости: единственный настоящий текст посреди
      // пустых плашек читался бы как недогруженная страница, а не как
      // ожидание. Плашка по ширине буквы (`w-fit`), поэтому высота строки
      // остаётся той же, что у расчёта.
      weekdayProps={() => ({
        className: "skeleton-bone mx-auto w-fit rounded-xs bg-paper-raised text-transparent",
      })}
      // Итог собран из тех же кусков, что и настоящий: число, слово,
      // отдельная вставка про ночные. Склей их в одну строку — и строчных
      // коробок станет меньше, а округление ширины изменится на доли
      // пикселя. Этих долей хватает, чтобы шапка перенеслась на вторую
      // строку не там, где у расчёта, и сетка разъехалась на пятнадцать
      // точек по высоте.
      meta={
        <>
          {"8"} см
          <MetaSep />
          {"192"} ч
          <MetaSep />
          <span>ноч. {"64"}</span>
        </>
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
 * Главное число: та же плашка и то же построение, что в расчёте.
 *
 * Плашка растягивается на всю строку, пока мелких итогов рядом нет, и
 * сжимается по содержимому, когда они появляются, — ровно как настоящая.
 */
function MainPlateBone() {
  return (
    <dl
      className={cn(
        // `lit` — тот же свет, что у настоящей плашки: блик по верхней
        // кромке и тень вниз. Без него заглушка была плоской, а на её
        // место вставала поднятая — и в этот миг по всей полосе итога
        // разом зажигался свет.
        "lit flex h-14 items-center justify-around rounded-xl bg-paper-raised px-4 py-2",
        "min-w-0 flex-1 gap-x-3",
        "lg:min-w-92.5 lg:flex-none lg:shrink-0 lg:gap-x-6",
      )}
    >
      <FigureBone value="1972" caption="Норма периода" emphatic />
      <FigureBone value="2192" caption="Фактически" />
      <FigureBone value="220" caption="Переработка" />
    </dl>
  );
}

/** Число с подписью внутри главной плашки. */
function FigureBone({
  value,
  caption,
  emphatic,
}: {
  value: string;
  caption: string;
  emphatic?: boolean;
}) {
  return (
    <div className="min-w-0 sm:flex sm:flex-row-reverse sm:items-center sm:gap-4 lg:block">
      <dd
        className={cn(
          "whitespace-nowrap font-mono leading-none text-center",
          emphatic ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
        )}
      >
        <BoneText skeleton>
          {value}
          <span className="ml-1 text-xs sm:text-sm">ч</span>
        </BoneText>
      </dd>
      <dt className="flex h-3.5 items-center justify-center gap-1 whitespace-nowrap text-[11px] leading-tight text-ink-muted">
        <BoneText skeleton>
          <span className="sm:after:content-[':'] lg:after:content-none">{caption}</span>
        </BoneText>
      </dt>
    </div>
  );
}

/** Мелкий итог: то же построение, что у главного, но вполголоса. */
function MinorPlateBone({
  value,
  unit,
  caption,
}: {
  value: string;
  unit?: string;
  caption: string;
}) {
  return (
    <div className="lit flex min-w-0 flex-1 flex-col items-center justify-end rounded-xl bg-paper-raised px-3 pb-2">
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

/** Ячейка переключателя вида сетки: те же размеры, что у настоящей. */
function SegmentBone({
  active,
  wide,
  children,
}: {
  active?: boolean;
  /** Знак в девять десятых рема — как в самой строке (`year-view.tsx`). */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5",
        "whitespace-nowrap rounded-lg px-3 text-xs font-medium",
        wide ? "[&_svg]:size-4.5" : "[&_svg]:size-4",
        "[&_svg]:shrink-0 [&_svg]:opacity-0",
        "skeleton-bone text-transparent lg:flex-1/2",
        // Светится ЗАНЯТАЯ, и только она: пустая утоплена вместе с
        // подложкой, а блик на утопленном — свет без предмета. То же
        // правило, что в самом переключателе (`ui/segmented.tsx`).
        active ? "lit bg-paper-raised" : undefined,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Подвал профиля: переключатель темы, ссылки и время последней правки.
 *
 * Ровно то, что стоит в `ProfileFooter`, и ничего сверх того. Здесь долго
 * лежал прежний подвал — рассказ «Где лежат ваши данные» на три абзаца,
 * кнопка выгрузки и удаление профиля, — уже после того, как всё это оттуда
 * ушло: выгрузка в шапку, удаление в настройки, рассказ на посадочную.
 * Заглушка обещала блок, которого через мгновение не оказывалось, и
 * страница на двести тридцать точек короче — то есть врала ровно о том, ради
 * чего она существует.
 */
function ProfileFooterBones() {
  return (
    <footer className="space-y-4 border-t border-rule py-6 text-sm">
      <div className="flex flex-col items-center justify-between md:flex-row-reverse">
        <div className="flex justify-center pt-8 pb-12 md:ml-auto md:pb-8 ">
          {/* Переключатель темы: рамка, поле в полточки и три кнопки по
              двадцать восемь — тридцать четыре точки в высоту, а не
              «примерно тридцать два». */}
          <span className="flex w-fit items-center gap-0.5 rounded-xl p-0.5">
            <Bone className="size-7 rounded-xl" />
            <Bone className="size-7 rounded-xl" />
            <Bone className="size-7 rounded-xl" />
          </span>
        </div>

        {/* Строка ссылок и времени — теми же словами и тем же кеглем, что в
            подвале расчёта: её высота и переносы получаются сами. */}
        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <BoneText skeleton>Условия использования</BoneText>
          <BoneText skeleton>Данные и приватность</BoneText>
          <BoneText skeleton>
            Последнее изменение: 20 августа 2026 г., 19:04.
          </BoneText>
        </p>
      </div>
    </footer>
  );
}
