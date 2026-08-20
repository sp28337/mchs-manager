"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils/cn";

import {
  atLeastZero,
  daysWord,
  formatHours as hours,
  formatHoursTrim as hoursTrim,
  splitIntoDays,
  type Decimal,
} from "../domain/decimal";
import { pendingTransfers } from "../domain/production-calendar";
import type { PeriodCalculation } from "../domain/calculation";

/**
 * Итог периода.
 *
 * --- Почему три числа, а не одно ---------------------------------------
 *
 * Норма, исключённые часы и факт показаны раздельно, потому что спор
 * идёт именно об их соотношении. Свести всё к «переработка: 24 ч»
 * значило бы спрятать то самое место, где расходятся расчёты.
 *
 * --- Почему числа держатся на месте --------------------------------------
 *
 * Они нужны при каждой правке в календаре: человек отмечает день в
 * декабре и тут же смотрит, что стало с нормой. Пока они были первым
 * экраном страницы, до них приходилось прокручивать назад через
 * двенадцать сеток — именно в тот момент, когда важна точность.
 *
 * Поэтому это полоса, закреплённая под шапкой. В саму шапку числа тоже
 * пробовали переселить, но там они вытесняли название сайта и на узком
 * экране ломали строку надвое; своя полоса обходится одной строкой и
 * ничего у шапки не отнимает.
 *
 * --- Куда делись статьи и приказы ----------------------------------------
 *
 * Под числами стояли два абзаца в рамке — вывод нормы со ссылками на
 * ст. 95 и 104 ТК РФ, письмо Роструда, приказ № 410 — и отдельная
 * карточка про неуменьшенную норму. Всё это правда и всё это нужно, но не
 * в тот момент, когда человек ищет глазами переработку.
 *
 * Обоснование ушло за знаки вопроса — туда же, куда на этой странице ушли
 * остальные пояснения. Оно не удалено и не смягчено: раскрывается у того
 * самого числа, к которому относится, и программе чтения экрана видно
 * всегда.
 */

/**
 * Итог периода: закреплённая полоса под шапкой.
 *
 * Полоса обязана быть тонкой — она отнимает высоту у календаря, — поэтому
 * внутри всё в одну-две строки: числа и подписанная строка мелких итогов.
 */
export function PeriodSummary({
  calculation,
  accountingYear,
  periodLabel,
  overtimeInDays,
}: {
  calculation: PeriodCalculation;
  accountingYear: number;
  periodLabel: string;
  /** В чём показывать переработку: в часах или сменами и часами. */
  overtimeInDays: boolean;
}) {

  return (
    <>
      <div className="sticky top-24 z-40 -mx-6 -translate-y-8">
        <FiguresRow calculation={calculation} inDays={overtimeInDays} />
      </div>

      <PendingNotice accountingYear={accountingYear} />
    </>
  );
}

/**
 * Мелкие итоги — плашками в ряд, если для них есть место.
 *
 * --- Почему плашки одной ширины ------------------------------------------
 *
 * Их пять, и содержание у них разной длины: «0» против «734,0», «Пропущено»
 * против «Смен по графику». Плашки по содержимому давали пять разных
 * прямоугольников с рваным правым краем — то самое, из-за чего ряд
 * выглядел случайным. Одинаковые плашки складываются в ленту, а лента
 * читается как одна вещь, а не как пять наклеек.
 *
 * --- Почему число над подписью, а не рядом -------------------------------
 *
 * Так же, как в главной плашке. Число и подпись, стоящие в строку, при
 * растянутой плашке разъезжаются по её краям, и между ними появляется
 * пустота, которую глаз читает как границу: «92» отдельно, «смен по
 * графику» отдельно. Столбиком они остаются одним целым при любой ширине.
 *
 * И главное: подписи всех восьми чисел — и крупных, и мелких — встают на
 * одну линию. Ряд держится этой линией, а не рамками плашек.
 *
 * --- Почему по замеру, а не по ширине экрана ------------------------------
 *
 * Строка главных чисел не одной ширины: недоработка появляется не всегда,
 * переработка бывает и «212,0 ч», и «8 суток 20 ч». Любой порог вроде
 * «показывать с 1280» на одном профиле оставил бы пустоту, а на другом
 * полез бы за край.
 *
 * Замер идёт по невидимому эталону — тем же плашкам, сжатым по
 * содержимому. Круга здесь нет именно поэтому: эталон не зависит от того,
 * что показано. Мерить видимый ряд было бы нельзя — спрятав его, мы
 * получили бы «теперь помещается» и показали снова.
 */
function FiguresRow({
  calculation,
  inDays,
}: {
  calculation: PeriodCalculation;
  inDays: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);

  useEffect(() => {
    const room = row.current;
    const content = probe.current;
    if (!room || !content) return;

    // Состояние ставится только из наблюдателя, а не тут же в эффекте:
    // `ResizeObserver` вызывает обработчик сразу при подписке, так что
    // первый замер всё равно случится, и лишней отрисовки не будет.
    const observer = new ResizeObserver(() => {
      // Запас в зазор между плашками: ряд, помещающийся впритык, читается
      // как переполненный, даже когда формально влез.
      setFits(content.scrollWidth + 8 <= room.clientWidth - 48);
    });
    observer.observe(room);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const items = minorItems(calculation);

  return (
    // Полоса залита бумагой, хотя плашки в ней и свои: без заливки между
    // ними просвечивает календарь — он проезжает под закреплённой полосой,
    // и в зазорах видно, как едут клетки.
    <div ref={row} className="relative flex items-stretch gap-2 bg-paper px-6 pb-3">
      <MainPlate calculation={calculation} inDays={inDays} grow={!fits} />

      {fits ? (
        <div className="flex h-14 min-w-0 flex-1 gap-2">
          {items.map((item) => (
            <MinorPlate key={item.caption} {...item} />
          ))}
        </div>
      ) : null}

      {/* Эталон: та же полоса целиком, сжатая по содержимому и вынесенная
          из потока. `inert` — чтобы знак вопроса в нём не ловил ни курсор,
          ни клавиатуру. */}
      <div
        ref={probe}
        inert
        aria-hidden
        className="pointer-events-none invisible absolute bottom-0 left-6 flex h-14 gap-2 whitespace-nowrap"
      >
        <MainPlate calculation={calculation} inDays={inDays} tight />
        {items.map((item) => (
          <MinorPlate key={item.caption} {...item} tight />
        ))}
      </div>
    </div>
  );
}

interface MinorItem {
  value: string;
  unit?: string;
  caption: string;
  hint?: ReactNode;
}

function minorItems(calculation: PeriodCalculation): MinorItem[] {
  return [
    { value: String(calculation.scheduledShifts), caption: "Смен по графику" },
    { value: String(calculation.workedShifts), caption: "Отработано смен" },
    { value: String(calculation.absentShifts), caption: "Пропущено" },
    { value: hours(calculation.nightHours), unit: "ч", caption: "Ночные часы" },
    {
      value: hours(calculation.holidayHours),
      unit: "ч",
      caption: "Праздничные часы",
      hint: (
        <Hint label="Про ночные и праздничные часы">
          <FactOnlyNote />
        </Hint>
      ),
    },
  ];
}

/**
 * Мелкий итог: то же построение, что у главного числа, но вполголоса и на
 * своей плашке.
 *
 * Единица измерения остаётся при числе, хотя подпись под ним и повторяет
 * её словом. Без «ч» ряд из «92», «92», «0», «734,0», «96,0» выглядит
 * пятью числами одной природы, тогда как первые три — это смены, а
 * последние два — часы.
 */
function MinorPlate({
  value,
  unit,
  caption,
  hint,
  tight,
}: MinorItem & {
  /** Плашка эталона: по содержимому, а не в общую долю ширины. */
  tight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center justify-end rounded-xl bg-paper-raised px-3 pb-2",
        tight ? "shrink-0" : "flex-1",
      )}
    >
      <dd className="whitespace-nowrap font-mono text-base leading-none text-ink">
        {value}
        {unit ? <span className="ml-1 text-[11px] text-ink-muted">{unit}</span> : null}
      </dd>
      <dt className="mt-1.5 flex h-3.5 items-center gap-1 whitespace-nowrap text-[11px] leading-tight text-ink-muted">
        {caption}
        {hint}
      </dt>
    </div>
  );
}

/**
 * Главная плашка: норма, факт и разница между ними.
 *
 * Три числа, а иногда четыре: недоработка появляется только тогда, когда
 * она есть. Держать под неё место всегда значило бы показывать
 * «Недоработка 0,0 ч» рядом с переработкой — число, которое ничего не
 * говорит.
 *
 * Плашка одна на все три, а не по одной на число: норму, факт и разницу
 * сравнивают между собой, и рамка вокруг каждого разрезала бы то, что
 * читается вместе. Мелкие итоги — наоборот, пять независимых фактов, и
 * плашка у каждого своя.
 *
 * На телефоне плашка занимает всю ширину: мелких итогов там нет, и делить
 * строку не с кем.
 */
function MainPlate({
  calculation,
  inDays,
  grow,
  tight,
}: {
  calculation: PeriodCalculation;
  /** Переработку — сменами и часами, а не часами. */
  inDays: boolean;
  /** Мелких итогов рядом нет — занять всю строку и развести числа. */
  grow?: boolean;
  /** Плашка эталона: по содержимому. */
  tight?: boolean;
}) {
  const overtime = calculation.overtimeHours.greaterThan(0);
  const undertime = calculation.undertimeHours.greaterThan(0);

  return (
    <dl
      className={cn(
        "flex h-14 items-end rounded-xl bg-paper-raised px-4 pb-2",
        // Пока мелких итогов нет, плашка занимает строку целиком, а числа
        // расходятся по ней: три числа, сжатые в левый угол полосы во всю
        // ширину экрана, читаются как незаконченная вёрстка.
        grow && !tight
          ? "min-w-0 flex-1 justify-between gap-x-3"
          : "shrink-0 gap-x-5 sm:gap-x-6",
      )}
    >
      <Figure
        parts={[{ value: hours(calculation.normHours), unit: "ч" }]}
        caption="Норма"
        emphatic
      />
      <Figure
        parts={[{ value: hours(calculation.actualHours), unit: "ч" }]}
        caption="Фактически"
      />
      <Figure
        parts={overtimeParts(calculation.overtimeHours, inDays)}
        caption="Переработка"
        tone={overtime ? "verify" : undefined}
      />
      {undertime ? (
        <Figure
          parts={overtimeParts(calculation.undertimeHours, inDays)}
          caption="Недоработка"
          tone="signal"
        />
      ) : null}
    </dl>
  );
}

/**
 * Переработка — часами или сменами, по выбору человека.
 *
 * --- Почему выбор, а не оба сразу ----------------------------------------
 *
 * Оба и стояли: «212,0 ч Переработка ≈ 8,8 суток В сутках» — четыре числа
 * и знак приблизительности ради одной величины, и половина строки на то,
 * чтобы сказать её дважды. При этом «8,8 суток» само требовало пересчёта:
 * десятая доля суток это два часа с четвертью, а отгул берут сменами и
 * часами.
 *
 * Теперь величина одна, и мера у неё та, в которой человек привык считать:
 * либо «212,0 ч», либо «8 суток 20 ч».
 *
 * --- Почему недоработка в той же мере ------------------------------------
 *
 * Она такая же разница часов, только с другим знаком, и показывать её в
 * другой мере значило бы предложить сравнивать несравнимое.
 */
function overtimeParts(value: Decimal, inDays: boolean): FigurePart[] {
  if (!inDays) return [{ value: hours(value), unit: "ч" }];

  const { days: whole, hours: rest } = splitIntoDays(value);
  const parts: FigurePart[] = [];
  if (whole > 0) parts.push({ value: String(whole), unit: daysWord(whole) });
  // Ровные сутки не тянут за собой «0 ч», но и пустой строки не бывает:
  // меньше смены — значит просто часы.
  if (!rest.isZero() || whole === 0) {
    parts.push({ value: hoursTrim(rest), unit: "ч" });
  }
  return parts;
}

/**
 * Мелкие итоги — второй строкой полосы.
 *
 * Одной строкой, как подпись месяца в календаре: пять подписанных
 * столбиков занимали две строки там, где хватает одной. На узком экране
 * сюда же приходят даты периода и сутки — всё, что не влезло в первую
 * строку.
 */
// function PeriodExtras({
//   calculation,
//   periodLabel,
//   wide,
// }: {
//   calculation: PeriodCalculation;
//   periodLabel: string;
//   /** На широком экране даты уже стоят числами выше. */
//   wide: boolean;
// }) {
//   const overtime = calculation.overtimeHours.greaterThan(0);

//   return (
//       <p className="flex flex-wrap items-center gap-x-1.5 -translate-y-7.5 gap-y-1 text-xs text-ink-muted">
//         {/* {!wide && overtime ? (
//           <Stat value={`≈ ${days(calculation.overtimeHours)}`} label="в сутках" />
//         ) : null} */}
//         <Stat value={String(calculation.scheduledShifts)} label="смен по графику" />
//         <Stat value={String(calculation.workedShifts)} label="отработано" />
//         <Stat value={String(calculation.absentShifts)} label="пропущено" />
//         <Stat value={`${hours(calculation.nightHours)} ч`} label="ночных" />
//         <Stat value={`${hours(calculation.holidayHours)} ч`} label="праздничных" last />
//         <Hint label="Про ночные и праздничные часы">
//           <FactOnlyNote />
//         </Hint>
//       </p>
//   );
// }

/**
 * Названная цена непроставленного переноса.
 *
 * Единственное, что осталось карточкой в потоке страницы: это не
 * пояснение, а недоделанное дело, и оно требует действия в календаре
 * ниже. В полосе ему не место — полоса это числа.
 */
function PendingNotice({ accountingYear }: { accountingYear: number }) {
  const pending = pendingTransfers(accountingYear).length;
  if (pending === 0) return null;

  return (
    // Не «календарь не опубликован» — эта формулировка досталась от
    // серверной версии и человеку ничего не говорила. Названа конкретная
    // недостача и её цена в часах.
    <p className="mt-6 max-w-prose rounded-xl bg-signal-soft px-4 py-3 text-sm">
      Норма может быть завышена на {pending * 8} часов: переносы новогодних
      выходных на {accountingYear} год ещё не проставлены. Откройте календарь
      года ниже и отметьте их по своему производственному календарю.
    </p>
  );
}

/** Знак вопроса с выводом нормы — у дат периода, где бы они ни стояли. */
function NormHint({ calculation }: { calculation: PeriodCalculation }) {
  return (
    <Hint label="Откуда взялась норма">
      <NormNote calculation={calculation} />
    </Hint>
  );
}

/**
 * Имя стоит ПЕРЕД числом, и это не вкусовщина: «91 смен по графику» —
 * ошибка согласования, а правильная форма зависит от последней цифры.
 * Порядок «смен по графику 91» верен при любом числе и не требует
 * склонять существительное в коде.
 */
function Stat({
  value,
  label,
  last,
}: {
  value: string;
  label: string;
  last?: boolean;
}) {
  return (
    <span className="whitespace-nowrap">
      {label} <span className="font-mono text-ink">{value}</span>
      {last ? "" : " /"}
    </span>
  );
}

/**
 * Откуда взялась норма — то, что стояло абзацами в рамке под числами.
 *
 * Живёт здесь, а не там, где показывается: текст обязан слово в слово
 * следовать за расчётом, и разойтись с ним ему нельзя.
 */
export function NormNote({ calculation }: { calculation: PeriodCalculation }) {
  return (
    <>
      <span className="block">
        {calculation.calendar.workingDays} рабочих дней по производственному
        календарю × {hours(calculation.weeklyNorm.hours)}&nbsp;ч ÷ 5
        {calculation.calendar.preHolidayDays > 0
          ? ` − ${calculation.calendar.preHolidayDays} ч за предпраздничные дни (ст. 95 ТК РФ)`
          : ""}{" "}
        = <span className="font-mono">{hours(calculation.baseNormHours)}</span>&nbsp;ч.
      </span>

      {calculation.excludedHours.greaterThan(0) ? (
        <span className="mt-2 block">
          Из неё исключено{" "}
          <span className="font-mono">{hours(calculation.excludedHours)}</span>&nbsp;ч
          — это {calculation.absentShifts} смен(ы) по графику, пришедшиеся на
          отсутствие с сохранением места службы. Остаётся{" "}
          <span className="font-mono">{hours(calculation.normHours)}</span>&nbsp;ч.
          Основание: письмо Роструда от 01.03.2010 № 550-6-1.
        </span>
      ) : null}

      <span className="mt-2 block text-ink-muted">
        Недельная норма: {calculation.weeklyNorm.basis}. Норма периода —
        ст. 104 ТК РФ.
      </span>
    </>
  );
}

/**
 * Цена чужой ошибки, названная числом. Без неё «считают неверно» — это
 * спор; с ней — довод.
 *
 * Последствие у ошибки ДВА, и какое наступит — зависит от того, перекрыл
 * ли факт неуменьшенную норму. Прежняя версия знала только про
 * недоработку и в самом частом случае — когда человек всё равно
 * переработал — печатала «недоработка 0,00 ч, которой нет». Число верное,
 * фраза бессмысленная, а настоящая потеря (заниженная переработка) при
 * этом не называлась вовсе.
 */
function WrongNormNote({ calculation }: { calculation: PeriodCalculation }) {
  // Переработка, которая получилась бы при НЕуменьшенной норме. Считается
  // от базовой нормы напрямую, а не вычитанием исключённых часов из
  // настоящей переработки: норма к отработке не уходит в минус, и при
  // длинном отсутствии разность дала бы неверное число.
  const wrongOvertime = atLeastZero(
    calculation.actualHours.minus(calculation.baseNormHours),
  );

  if (calculation.wrongNormUndertimeHours.greaterThan(0)) {
    return (
      <>
        Если в вашем табеле норму НЕ уменьшили на эти часы, у вас покажется
        недоработка{" "}
        <span className="font-mono">
          {hours(calculation.wrongNormUndertimeHours)}
        </span>{" "}
        ч, которой на самом деле нет.
      </>
    );
  }

  return (
    <>
      Если в вашем табеле норму НЕ уменьшили на эти часы, переработка выйдет на{" "}
      <span className="font-mono">
        {hours(calculation.overtimeHours.minus(wrongOvertime))}
      </span>{" "}
      ч меньше действительной: <span className="font-mono">{hours(wrongOvertime)}</span>{" "}
      ч вместо{" "}
      <span className="font-mono">{hours(calculation.overtimeHours)}</span> ч.
    </>
  );
}

/**
 * Почему ночные и праздничные часы здесь только названы.
 *
 * Обещать за них доплату было бы неправдой, и молчать об этом нельзя:
 * человек, увидевший 664 часа ночных, сам достроит вывод, которого закон
 * не даёт.
 */
function FactOnlyNote() {
  return (
    <>
      Показаны как факт. При суммированном учёте в пределах нормы ночные и
      праздничные часы дополнительным временем отдыха не компенсируются
      (Приказ МЧС России от 24.09.2018 № 410, п. 14) — обещать здесь доплату
      было бы неправдой.
    </>
  );
}

/**
 * Величина числом с единицей — и, если нужно, не одним.
 *
 * Пар бывает две: переработка в сутках это «8 суток 20 ч», и остаток от
 * смены такое же число, как сами сутки. Оформлять его иначе значило бы
 * сказать, что он менее настоящий.
 */
export interface FigurePart {
  value: string;
  unit: string;
}

function Figure({
  parts,
  caption,
  emphatic,
  tone,
  hint,
}: {
  parts: readonly FigurePart[];
  caption: string;
  emphatic?: boolean;
  tone?: "signal" | "verify";
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0 ">
      {/* Число и его единица не разрываются переносом: «1796,00» на одной
          строке и «ч» на следующей читается как другое число. */}
      <dd
        className={cn(
          "whitespace-nowrap font-mono leading-none",
          emphatic ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
          tone === "signal" && "text-signal",
          tone === "verify" && "text-verify font-medium",
        )}
      >
        {parts.map((part, index) => (
          <span key={part.unit} className={index > 0 ? "ml-2" : undefined}>
            {part.value}
            <span className="ml-1 text-xs text-ink-muted sm:text-sm">{part.unit}</span>
          </span>
        ))}
      </dd>
      <dt className="mt-1.5 flex h-3.5 items-center gap-1 whitespace-nowrap text-[11px] leading-tight text-ink-muted">
        {caption}
        {hint}
      </dt>
    </div>
  );
}
