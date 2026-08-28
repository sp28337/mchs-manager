"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { BalanceCaption, BALANCE_SWAP_MS } from "@/components/ui/balance-caption";
import { CountedNumber } from "@/components/ui/counted-number";
import { cn } from "@/lib/utils/cn";

import {
  daysWord,
  formatHoursTrim as hoursTrim,
  shiftsWord,
  splitIntoDays,
  type Decimal,
} from "../domain/decimal";
import { shiftMinutes } from "../domain/shift-hours";
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
 * ст. 95 и 104 ТК РФ и письмо Роструда — и отдельная карточка про
 * неуменьшенную норму. Всё это правда и всё это нужно, но не
 * в тот момент, когда человек ищет глазами переработку.
 *
 * Основание недельной нормы при этом никуда не делось: оно живёт при
 * самой норме (`WeeklyNorm.basis`), и показать его можно там, где до него
 * дойдёт очередь.
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
  overtimeInDays,
  shiftDurationHours,
}: {
  calculation: PeriodCalculation;
  accountingYear: number;
  /** В чём показывать переработку: в часах или сменами и часами. */
  overtimeInDays: boolean;
  /**
   * Продолжительность смены, часами.
   *
   * Переработка «сменами» делится именно на неё: у графика «два через
   * два» смена двенадцатичасовая, и делить её переработку на сутки значило
   * бы назвать вдвое меньше смен, чем человек отработал сверх нормы.
   */
  shiftDurationHours: string;
}) {
  return (
    <>
      <div className="sticky top-24 z-40 -mx-6 -translate-y-8">
        <FiguresRow
          calculation={calculation}
          inDays={overtimeInDays}
          shiftHours={shiftDurationHours}
        />
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
 * Строка главных чисел не одной ширины: разница бывает и «212,0 ч», и
 * «8 суток 20 ч», а норма — и «160», и «1972,5». Любой порог вроде
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
  shiftHours,
}: {
  calculation: PeriodCalculation;
  inDays: boolean;
  shiftHours: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);

  // Замер ДО первой отрисовки, а не после неё.
  //
  // Раньше первое значение ставил `ResizeObserver`: он вызывает обработчик
  // сразу при подписке, и казалось, что отдельный замер не нужен. Но
  // подписка шла из обычного эффекта, а тот работает уже ПОСЛЕ отрисовки —
  // и обработчик приходил только следующим кадром. Между этими двумя
  // моментами человек успевал увидеть кадр, нарисованный по умолчанию
  // «не помещается»: плашка во всю ширину экрана и без мелких итогов.
  // Замерено при обновлении страницы — два кадра, полторы десятых доли
  // секунды, плашка 1862 точки вместо 370.
  //
  // Теперь замер идёт из layout-эффекта и сразу: React успевает
  // перерисовать полосу до того, как кадр попадёт на экран. Наблюдатель
  // остаётся, но отвечает уже только за ПОСЛЕДУЮЩИЕ изменения — смену
  // ширины окна и длины самих чисел.
  useLayoutEffect(() => {
    const room = row.current;
    const content = probe.current;
    if (!room || !content) return;

    // Запас в зазор между плашками: ряд, помещающийся впритык, читается
    // как переполненный, даже когда формально влез.
    const measure = () =>
      setFits(content.scrollWidth + 8 <= room.clientWidth - 48);

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(room);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const items = minorItems(calculation);

  return (
    // Полоса залита бумагой, хотя плашки в ней и свои: без заливки между
    // ними просвечивает календарь — он проезжает под закреплённой полосой,
    // и в зазорах видно, как едут клетки.
    <div ref={row} className="relative flex items-stretch gap-2  px-6 pb-3">
      <MainPlate
        calculation={calculation}
        inDays={inDays}
        shiftHours={shiftHours}
        grow={!fits}
      />

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
        <MainPlate
          calculation={calculation}
          inDays={inDays}
          shiftHours={shiftHours}
          tight
        />
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
}

function minorItems(calculation: PeriodCalculation): MinorItem[] {
  return [
    { value: String(calculation.scheduledShifts), caption: "Смен по графику" },
    { value: String(calculation.workedShifts), caption: "Отработано смен" },
    { value: String(calculation.absentShifts), caption: "Пропущено" },
    { value: hoursTrim(calculation.nightHours), unit: "ч", caption: "Ночные часы" },
    { value: hoursTrim(calculation.holidayHours), unit: "ч", caption: "Праздничные часы" },
  ];
}

/**
 * Мелкий итог: то же построение, что у главного числа, но вполголоса и на
 * своей плашке.
 *
 * Единица измерения остаётся при числе, хотя подпись под ним и повторяет
 * её словом. Без «ч» ряд из «92», «92», «0», «734», «96» выглядит пятью
 * числами одной природы, тогда как первые три — это смены, а последние
 * два — часы. Нулевого хвоста при этом нет ни у тех, ни у других: ноль
 * после запятой ничего не уточняет, а показывать его только в двух
 * плашках из пяти значило бы делать вид, что там точность выше.
 */
function MinorPlate({
  value,
  unit,
  caption,
  tight,
}: MinorItem & {
  /** Плашка эталона: по содержимому, а не в общую долю ширины. */
  tight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center justify-end rounded-xl bg-paper-raised px-3 pb-2",
        // Свет лампы: блик по верху, тень вниз. У эталона его нет — тот
        // невидим, и лишняя тень в нём только сбила бы замер ширины.
        tight ? "shrink-0" : "lit flex-1",
      )}
    >
      <dd className="whitespace-nowrap font-mono text-base leading-none text-ink">
        {tight ? value : <CountedNumber value={value} />}
        {unit ? <span className="ml-1 text-[11px] text-ink-muted">{unit}</span> : null}
      </dd>
      <dt className="mt-1.5 flex h-3.5 items-center gap-1 whitespace-nowrap text-[11px] leading-tight text-ink-muted">
        {caption}
      </dt>
    </div>
  );
}

/**
 * Главная плашка: норма, факт и разница между ними.
 *
 * Чисел ровно три, всегда. Разница бывает в обе стороны, но она ОДНА
 * величина: переработка и недоработка — это её знак, а не два разных
 * итога. Показывает знак сама разница — именем и цветом
 * (`BalanceCaption`), а не второе число рядом.
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
  shiftHours,
  grow,
  tight,
}: {
  calculation: PeriodCalculation;
  /** Переработку — сменами и часами, а не часами. */
  inDays: boolean;
  /** Продолжительность смены: на неё делится переработка. */
  shiftHours: string;
  /** Мелких итогов рядом нет — занять всю строку и развести числа. */
  grow?: boolean;
  /** Плашка эталона: по содержимому. */
  tight?: boolean;
}) {
  const under = calculation.undertimeHours.greaterThan(0);
  const balance = under ? calculation.undertimeHours : calculation.overtimeHours;

  return (
    <dl
      className={cn(
        "flex h-14 items-center rounded-xl bg-paper-raised px-4 py-2 lg:min-w-92.5 justify-around",
        // Свет лампы — на видимой плашке, но не на эталоне: тот невидим и
        // служит линейкой, а лишняя тень сбила бы замер ширины.
        !tight && "lit",
        // Пока мелких итогов нет, плашка занимает строку целиком, а числа
        // расходятся по ней: три числа, сжатые в левый угол полосы во всю
        // ширину экрана, читаются как незаконченная вёрстка.
        grow && !tight
          ? "min-w-0 flex-1 justify-around gap-x-3"
          : "shrink-0 gap-x-5 sm:gap-x-6",
      )}
    >
      <Figure
        parts={[{ value: hoursTrim(calculation.normHours), unit: "ч" }]}
        caption="Норма периода"
        emphatic
        still={tight}
      />
      <Figure
        parts={[{ value: hoursTrim(calculation.actualHours), unit: "ч" }]}
        caption="Фактически"
        still={tight}
      />
      <Figure
        parts={overtimeParts(balance, inDays, shiftHours)}
        caption={<BalanceCaption under={under} />}
        // Ноль — это попадание в норму, и цвета у него нет: ни зелёного,
        // ни красного. Сигнальным становится только то, что требует
        // разговора с работодателем.
        tone={under ? "signal" : balance.greaterThan(0) ? "verify" : undefined}
        still={tight}
      />
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
function overtimeParts(
  value: Decimal,
  inDays: boolean,
  shiftHours: string,
): FigurePart[] {
  if (!inDays) return [{ value: hoursTrim(value), unit: "ч" }];

  // Мера — своя смена, а не астрономические сутки. У суточной смены слово
  // остаётся прежним, «сутки»: так на этом графике и говорят. У всех
  // остальных оно превратилось бы в неправду, поэтому там — «смены».
  const perShift = shiftMinutes(shiftHours) / 60;
  const whole24 = perShift === 24;
  const { days: whole, hours: rest } = splitIntoDays(value, perShift);
  const parts: FigurePart[] = [];
  if (whole > 0) {
    parts.push({
      value: String(whole),
      unit: whole24 ? daysWord(whole) : shiftsWord(whole),
    });
  }
  // Ровные сутки не тянут за собой «0 ч», но и пустой строки не бывает:
  // меньше смены — значит просто часы.
  if (!rest.isZero() || whole === 0) {
    parts.push({ value: hoursTrim(rest), unit: "ч" });
  }
  return parts;
}

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

/**
 * Величина числом с единицей — и, если нужно, не одним.
 *
 * Пар бывает две: переработка в сутках это «8 суток 20 ч», и остаток от
 * смены такое же число, как сами сутки. Оформлять его иначе значило бы
 * сказать, что он менее настоящий.
 *
 * --- Почему число доходит до нового значения, а не подменяется -----------
 *
 * Полоса итога затем и закреплена под шапкой, что человек правит календарь
 * и смотрит на неё. Правка меняет разом несколько чисел из восьми, а
 * подменённые мгновенно они не говорят, КАКОЕ из них двинулось: разницу в
 * час на одном и том же месте глаз не замечает вовсе.
 *
 * Отсчёт (`CountedNumber`) отвечает на это движением — тот же самый, что
 * крутит числа на первом экране. Эталон, по которому меряется ширина
 * полосы, при этом стоит неподвижно (`still`): считать место по числу в
 * пути значило бы менять раскладку, пока оно идёт.
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
  still,
}: {
  parts: readonly FigurePart[];
  caption: ReactNode;
  emphatic?: boolean;
  tone?: "signal" | "verify";
  /** Плашка эталона: считать по ней ширину, пока число в пути, нельзя. */
  still?: boolean;
}) {
  return (
    <div className="min-w-0 sm:flex sm:flex-row-reverse sm:items-center sm:gap-4 lg:block">
      {/* Число и его единица не разрываются переносом: «1796,00» на одной
          строке и «ч» на следующей читается как другое число. */}
      <dd
        className={cn(
          "whitespace-nowrap font-mono leading-none text-center",
          emphatic ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
          // Цвет меняется столько же, сколько едет приставка в подписи:
          // это одно событие, показанное с двух сторон, и разъезжаться им
          // нельзя. Поэтому длительность приходит оттуда же, откуда её
          // берёт сама приставка, а не повторяется здесь числом.
          "transition-colors",
          tone === "signal" && "text-signal",
          tone === "verify" && "text-verify font-medium",
        )}
        style={{ transitionDuration: `${BALANCE_SWAP_MS}ms` }}
      >
        {parts.map((part, index) => (
          <span key={part.unit} className={index > 0 ? "ml-2" : undefined}>
            {still ? part.value : <CountedNumber value={part.value} />}
            <span className="ml-1 text-xs text-ink-muted sm:text-sm">{part.unit}</span>
          </span>
        ))}
      </dd>
      <dt className="flex h-3.5 items-center justify-center gap-1 whitespace-nowrap text-[11px] leading-tight text-ink-muted">
        {/* Двоеточие принадлежит строчной записи «Норма периода: 1972 ч»,
            которая стоит на средних экранах. Там, где подпись снова
            уходит под число, двоеточию не к чему прицепиться — и оно
            снимается вместе со строчной раскладкой. */}
        <span className="sm:after:content-[':'] lg:after:content-none">
          {caption}
        </span>
      </dt>
    </div>
  );
}
