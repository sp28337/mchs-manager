/**
 * Деньги за переработку.
 *
 * --- Почему это отдельный модуль ----------------------------------------
 *
 * Расчёт часов и расчёт денег живут по разным нормам и ошибаются
 * по-разному. Часы считает производственный календарь и ст. 104 ТК РФ;
 * деньги — приказ МЧС России от 27.06.2024 № 539 для сотрудников и приказ
 * МЧС России от 14.12.2019 № 747 для работников. Смешать их в одном месте
 * значило бы получить функцию, в которой нельзя проверить ни то, ни
 * другое.
 *
 * --- Две системы, а не одна с вариантами --------------------------------
 *
 * У сотрудника ФПС и у вольнонаёмного работника той же части совпадает
 * только множитель «полтора и два». Всё остальное разное:
 *
 * СОТРУДНИК (приказ № 539). Часовая ставка задана приказом жёстко:
 * должностной оклад, делённый на среднемесячное количество рабочих часов
 * по производственному календарю на год (п. 105). Порог полуторного
 * размера при суммированном учёте тоже задан — в среднем два часа на
 * каждый рабочий день учётного периода (п. 107).
 *
 * Приказ № 539 действует с 2024 года и отменил прежний приказ № 195
 * целиком. Формулы он не тронул — все пять проверены дословным
 * сличением, — но условие выплаты развернул: раньше деньги шли «по
 * рапорту сотрудника», теперь они положены, если отдых НЕ предоставлен.
 *
 * РАБОТНИК (приказ № 747). База шире: не оклад, а заработная плата
 * ЦЕЛИКОМ, включая компенсационные и стимулирующие выплаты (приложение 2
 * п. 10, в редакции с 01.05.2026; ч. 1 ст. 152 ТК РФ). Зато способ
 * исчисления часовой ставки приказом НЕ УСТАНОВЛЕН: п. 8 приложения 2
 * отдаёт его коллективному договору, соглашению или локальному акту.
 * Поэтому для работника любая цифра — расчёт по предположению, и модуль
 * обязан сказать об этом вслух, а не выдать число молча.
 *
 * --- Чего здесь сознательно нет -----------------------------------------
 *
 * Ночных и праздничных. Ночные оплачиваются ежемесячно (п. 95 приказа
 * № 539 — 20 % часовой ставки; п. 19 приказа № 747 — 35 % и выше),
 * праздничные — по п. 94(б) и п. 11 соответственно. Это ДРУГИЕ деньги за
 * ДРУГИЕ часы, уже полученные. Прибавить их к переработке значило бы
 * посчитать одни и те же часы дважды — и человека поймают на этом в
 * первом же разговоре с бухгалтерией.
 *
 * Здесь считается ровно одно: часы сверх нормы учётного периода.
 */

import { Dec, atLeastZero, toDecimal, type Decimal } from "./decimal";
import type { EmploymentKind } from "./value-objects";

const MONTHS_IN_YEAR = new Dec(12);

/** Приказ № 539 п. 103(а); ч. 1 ст. 152 ТК РФ. */
const FIRST_HOURS_MULTIPLIER = new Dec("1.5");
const LATER_HOURS_MULTIPLIER = new Dec(2);

/**
 * Приказ № 539 п. 107: полуторный размер — за часы, «не превышающие в
 * среднем двух часов за каждый рабочий день в учётном периоде».
 */
const HOURS_PER_WORKING_DAY_AT_LOWER_RATE = new Dec(2);

export const PAY_BASIS: Record<EmploymentKind, string> = {
  attested: "Приказ МЧС России от 27.06.2024 № 539, пп. 103, 105, 107",
  civilian:
    "Приказ МЧС России от 14.12.2019 № 747, приложение 2 пп. 8, 10; ч. 1 ст. 152 ТК РФ",
};

/**
 * Что человек ввёл про свои деньги.
 *
 * Одно поле, а не разбор оклада по составляющим, потому что состав базы
 * различается по категориям, а число человек берёт из расчётного листка
 * одним взглядом. Что именно спрашивать — решает интерфейс, здесь важно
 * лишь то, что величина месячная.
 */
export interface MonthlyPayBase {
  /** Рублей в месяц. Для сотрудника — должностной оклад, для работника —
   *  оклад вместе с компенсационными и стимулирующими выплатами. */
  readonly amount: Decimal;
}

export interface OvertimePayInput {
  readonly employment: EmploymentKind;
  readonly base: MonthlyPayBase;
  /**
   * Норма КАЛЕНДАРНОГО ГОДА по производственному календарю для категории
   * человека — из неё выводится среднемесячное количество часов.
   *
   * Именно года, а не учётного периода: п. 105 приказа № 539 говорит
   * «по производственному календарю на данный календарный год». При
   * полугодовом учётном периоде ставка обязана остаться годовой, иначе
   * она удвоится.
   */
  readonly annualNormHours: Decimal;
  /**
   * Рабочие дни производственного календаря в учётном периоде. По ним
   * считается порог полуторного размера (п. 97).
   */
  readonly workingDaysInPeriod: number;
  readonly overtimeHours: Decimal;
}

/** Часы, оплачиваемые по одному множителю. */
export interface OvertimePayBand {
  readonly hours: Decimal;
  readonly multiplier: Decimal;
  readonly amount: Decimal;
}

export interface OvertimePay {
  /** Месячная база, из которой выведена ставка. */
  readonly monthlyBase: Decimal;
  /** Норма года ÷ 12. */
  readonly averageMonthlyHours: Decimal;
  /** Рублей за час. */
  readonly hourlyRate: Decimal;
  /** Граница между полуторным и двойным размером, в часах. */
  readonly thresholdHours: Decimal;
  readonly atOneAndHalf: OvertimePayBand;
  readonly atDouble: OvertimePayBand;
  /** Начислено до удержания НДФЛ. */
  readonly total: Decimal;
  readonly basis: string;
}

/**
 * Оценка со всеми прочтениями, какие имеет смысл показать.
 *
 * Для сотрудника прочтение одно: п. 107 приказа № 539 не оставляет выбора.
 * Для работника приказ № 747 о пороге молчит, и практика расходится,
 * поэтому рядом с осторожным расчётом показывается второй — по прочтению
 * «два часа за весь учётный период». Человек должен видеть обе цифры:
 * идти в кабинет разумно с меньшей, но знать про большую он имеет право.
 */
export interface OvertimePayEstimate {
  readonly primary: OvertimePay;
  readonly alternative: OvertimePay | null;
}

function band(hours: Decimal, multiplier: Decimal, rate: Decimal): OvertimePayBand {
  return { hours, multiplier, amount: hours.times(multiplier).times(rate) };
}

/**
 * Часовая ставка: месячная база ÷ среднемесячное количество рабочих часов.
 *
 * Среднемесячное берётся из нормы ГОДА, а не месяца, и это принципиально:
 * в месячной норме от 136 до 184 часов, и ставка от неё скакала бы на
 * треть от месяца к месяцу. Приказ № 539 п. 105 требует именно годовую
 * базу — «по производственному календарю на данный календарный год».
 */
function hourlyRate(base: Decimal, annualNormHours: Decimal): Decimal | null {
  if (!annualNormHours.greaterThan(0)) return null;
  return base.dividedBy(annualNormHours.dividedBy(MONTHS_IN_YEAR));
}

function payAt(
  input: OvertimePayInput,
  rate: Decimal,
  averageMonthlyHours: Decimal,
  thresholdHours: Decimal,
): OvertimePay {
  const overtime = atLeastZero(input.overtimeHours);
  const lower = Dec.min(overtime, thresholdHours);
  const upper = atLeastZero(overtime.minus(thresholdHours));

  const atOneAndHalf = band(lower, FIRST_HOURS_MULTIPLIER, rate);
  const atDouble = band(upper, LATER_HOURS_MULTIPLIER, rate);

  return {
    monthlyBase: input.base.amount,
    averageMonthlyHours,
    hourlyRate: rate,
    thresholdHours,
    atOneAndHalf,
    atDouble,
    total: atOneAndHalf.amount.plus(atDouble.amount),
    basis: PAY_BASIS[input.employment],
  };
}

/**
 * Деньги за часы сверх нормы учётного периода.
 *
 * `null`, если считать не из чего: без базы или без нормы года ставка не
 * определена, и показывать ноль было бы враньём — ноль означал бы «вам
 * ничего не положено».
 *
 * --- Про отгулы ----------------------------------------------------------
 *
 * Пункт 109 приказа № 539 требует не включать в оплачиваемые часы то, за
 * что уже дали дни отдыха. Отдельного вычитания здесь нет НАМЕРЕННО: в
 * этом приложении отгул — это несостоявшаяся смена, её часы не попадают в
 * отработанное, и переработка приходит сюда уже уменьшенной. Вычесть их
 * ещё раз значило бы наказать человека за отгул дважды.
 */
export function calculateOvertimePay(input: OvertimePayInput): OvertimePayEstimate | null {
  if (!input.base.amount.greaterThan(0)) return null;

  const averageMonthlyHours = input.annualNormHours.dividedBy(MONTHS_IN_YEAR);
  const rate = hourlyRate(input.base.amount, input.annualNormHours);
  if (rate === null) return null;

  const cautiousThreshold = HOURS_PER_WORKING_DAY_AT_LOWER_RATE.times(
    input.workingDaysInPeriod,
  );
  const primary = payAt(input, rate, averageMonthlyHours, cautiousThreshold);

  // Второе прочтение показывается только работнику: у сотрудника п. 97
  // приказа № 539 не оставляет для него места, и предлагать выбор там,
  // где норма однозначна, значит подталкивать к заведомо проигрышному
  // спору.
  const alternative =
    input.employment === "civilian"
      ? payAt(input, rate, averageMonthlyHours, HOURS_PER_WORKING_DAY_AT_LOWER_RATE)
      : null;

  return { primary, alternative };
}

/**
 * Рубли для показа: «65 720,08 ₽».
 *
 * Половина копейки округляется ВВЕРХ, а не по-банковски, как часы.
 * Расхождение с остальным расчётом намеренное: банковское округление
 * выбрано для часов ради совпадения с прежней серверной арифметикой до
 * последней цифры, а деньги человек будет сверять с расчётным листком, где
 * применяют обычное арифметическое округление.
 */
export function formatMoney(value: Decimal): string {
  return `${formatMoneyAmount(value)}\u00a0\u20bd`;
}

/** То же без знака рубля — там, где знак стоит отдельной подписью. */
export function formatMoneyAmount(value: Decimal): string {
  const grouped = value
    .toDecimalPlaces(2, Dec.ROUND_HALF_UP)
    .toNumber()
    .toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Разделитель разрядов приводится к неразрывному пробелу принудительно.
  // `toLocaleString` берёт его из ICU, а тот менялся между версиями Node:
  // для ru-RU это был U+00A0, стал U+202F. Полагаться на версию значит
  // получить расхождение сборки с тестом там, где речь о сумме денег.
  return grouped.replace(/\s/gu, "\u00a0");
}

/** Разбор суммы, введённой человеком: «30 000», «30000,50», «30000.50». */
export function parseMoney(input: string): Decimal | null {
  // `\s` в JavaScript уже покрывает и неразрывный пробел U+00A0, и
  // узкий U+202F, которым `toLocaleString` разделяет разряды. Раньше
  // U+00A0 стоял в этом выражении отдельным символом — невидимым в
  // тексте программы и потому неотличимым от опечатки.
  const normalised = input.replace(/\s/gu, "").replace(",", ".");
  if (normalised === "") return null;
  const value = toDecimal(normalised);
  if (value === null || !value.isFinite() || value.isNegative()) return null;
  return value;
}
