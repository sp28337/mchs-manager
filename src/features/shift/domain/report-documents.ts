/**
 * Рапорт и заявление: бумага, которую человек несёт начальнику.
 *
 * --- Зачем приложению этим заниматься -----------------------------------
 *
 * Расчёт сам по себе ничего не меняет. Часы возвращают не потому, что
 * человек посчитал их дома, а потому, что он подал рапорт и на своём
 * экземпляре стоит отметка о принятии. Между «я знаю, что мне должны» и
 * «я это потребовал» лежит один лист бумаги, и он же — единственное, что
 * потом можно предъявить.
 *
 * Поэтому документ собирается здесь, из тех же чисел, что стоят в расчёте.
 * Переписывать их от руки — лишний шаг, на котором цифра меняется.
 *
 * --- Почему домен, а не разметка ----------------------------------------
 *
 * Текст рапорта — такое же утверждение о праве, как формула. В нём стоят
 * реквизиты приказов, и если приказ отменят, текст обязан протухнуть
 * ЗАМЕТНО: тест сверяет реквизиты, как и в `overtime-pay.ts`. В разметке
 * такой текст никто бы не проверял.
 *
 * --- Почему четыре документа, а не один --------------------------------
 *
 * Развилок две, и они независимы:
 *
 * * КТО подаёт. Сотрудник ФПС ГПС подаёт РАПОРТ по ФЗ-141 и приказам МЧС;
 *   работник по трудовому договору — ЗАЯВЛЕНИЕ по Трудовому кодексу. Это
 *   разные документы с разными основаниями, а не разные слова.
 * * ЧТО просят. Отдых или деньги. Приказ № 539 связывает их прямо: часы,
 *   за которые дали отдых, в оплату не включаются (п. 109). Просить и то
 *   и другое за одни часы нельзя, и документ обязан быть один.
 */

import { formatHours, type Decimal } from "./decimal";
import { formatDateRu } from "./format";
import { formatMoneyAmount } from "./overtime-pay";
import { addDays, type IsoDate } from "./plain-date";
import type { EmploymentKind } from "./value-objects";

/**
 * О чём бумага.
 *
 * Первые два — про то, что человеку положено за переработку. Вторые два —
 * про то, что переработку сначала надо заставить появиться в табеле:
 *
 * * `correction` — учёт ведут неверно. Самое частое: норму не уменьшают на
 *   часы отсутствия, а вместо этого вычитают их из ОТРАБОТАННОГО. Ошибка
 *   бьёт дважды, и требовать компенсацию, не исправив её, бессмысленно —
 *   считать будут от неверных чисел.
 * * `callout_record` — привлекали помимо графика, но приказа никто не
 *   издавал и рапорта не подавал. Часов в табеле нет, и доказывать их
 *   человеку нечем. Его собственный рапорт — единственный способ завести
 *   бумагу там, где её не завели.
 */
export type ReportRequest = "rest" | "payment" | "correction" | "callout_record";

export const REPORT_REQUEST_LABELS: Record<ReportRequest, string> = {
  rest: "Дополнительное время отдыха",
  payment: "Денежная компенсация",
  correction: "Исправить учёт",
  callout_record: "Зафиксировать вызовы",
};

/**
 * Как называется бумага у каждой категории.
 *
 * Не придирка к слову: сотрудник подаёт рапорт по правилам служебной
 * переписки, работник — заявление по Трудовому кодексу. Заявление от
 * сотрудника в части примут, но оно выдаёт, что человек не знает своего
 * правового положения, — а с этого начинается разговор о том, что он
 * вообще насчитал неверно.
 */
export const DOCUMENT_NOUN: Record<EmploymentKind, string> = {
  attested: "рапорт",
  civilian: "заявление",
};

/** Реквизиты, из которых собирается шапка и подпись. */
export interface ReportIdentity {
  /** Кому — в дательном падеже, целиком: «Начальнику ПСЧ-5 …». */
  readonly addressee: string;
  /** ФИО в именительном падеже — для подписи. */
  readonly fullName: string;
  /** Звание. У работника его нет. */
  readonly rank: string;
  readonly position: string;
}

export interface ReportMoney {
  readonly monthlyBase: Decimal;
  readonly hourlyRate: Decimal;
  readonly total: Decimal;
  readonly atOneAndHalfHours: Decimal;
  readonly atDoubleHours: Decimal;
}

/**
 * Числа для рапорта об исправлении учёта.
 *
 * Из табеля берётся то, что человек в него прочитал; из расчёта — то, что
 * должно стоять. Обе тройки в бумаге называются рядом: требование
 * «исправьте» без двух колонок чисел проверить нельзя, а с ними — можно на
 * месте.
 */
export interface ReportCorrection {
  readonly reportedNormHours: Decimal | null;
  readonly reportedActualHours: Decimal | null;
  readonly reportedOvertimeHours: Decimal | null;
  readonly normHours: Decimal;
  readonly actualHours: Decimal;
  /** Часы по НОРМЕ, приходящиеся на отсутствие, — то, что вычитается. */
  readonly excludedHours: Decimal;
  readonly absentShifts: number;
}

/** Один вызов помимо графика, как он попадёт в перечень рапорта. */
export interface ReportCallout {
  readonly start: IsoDate;
  readonly endInclusive: IsoDate;
  /** Название вида: «Соревнования», «Резерв». */
  readonly kindLabel: string;
  readonly hoursPerDay: Decimal;
  readonly totalHours: Decimal;
}

export interface ReportInput {
  readonly employment: EmploymentKind;
  readonly request: ReportRequest;
  readonly identity: ReportIdentity;
  readonly periodStart: IsoDate;
  /** Исключающая граница, как во всём коде. */
  readonly periodEnd: IsoDate;
  readonly overtimeHours: Decimal;
  /** Деньги — только если человек указал базу расчёта. */
  readonly money?: ReportMoney | null;
  /** Числа табеля — только если человек их внёс в сверку. */
  readonly correction?: ReportCorrection | null;
  /** Вызовы периода — для рапорта об их фиксации. */
  readonly callouts?: readonly ReportCallout[];
}

/**
 * Документ разобранный на части, а не готовая строка.
 *
 * Экран показывает шапку справа, а тело с отступом первой строки; файл
 * повторяет то же средствами RTF. Склеить всё в одну строку значило бы
 * потерять эту разметку в обоих местах.
 */
export interface ReportDocument {
  /** Заголовок для экрана и для имени файла. */
  readonly title: string;
  /** Слово в центре листа: «РАПОРТ» или «ЗАЯВЛЕНИЕ». */
  readonly heading: string;
  /** Шапка: выравнивается по правому краю. */
  readonly addressLines: readonly string[];
  readonly bodyParagraphs: readonly string[];
  /** Строки подписи: звание, должность, ФИО, дата. */
  readonly signatureLines: readonly string[];
  /** Что человек должен вписать сам, прежде чем нести бумагу. */
  readonly blanks: readonly string[];
}

const BLANK = "_________________________";

/** Пустое поле не выдумывается, а остаётся прочерком: подпись под чужой
 *  должностью — не мелочь. */
function filled(value: string, fallback = BLANK): string {
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

/** Последний ВКЛЮЧЁННЫЙ день периода: в бумаге границы закрытые. */
function periodPhrase(periodStart: IsoDate, periodEnd: IsoDate): string {
  return `с ${formatDateRu(periodStart)} по ${formatDateRu(addDays(periodEnd, -1))}`;
}

/**
 * Реквизиты оснований, вынесенные из текста.
 *
 * Отдельной таблицей ровно потому же, почему `PAY_BASIS` в
 * `overtime-pay.ts`: приказ отменяют молча, а человек приходит с бумагой,
 * где написан недействующий акт. Тест сверяет эти строки.
 */
export const REPORT_BASIS = {
  restAttested:
    "статья 55 Федерального закона от 23.05.2016 № 141-ФЗ; Порядок, утверждённый приказом МЧС России от 24.09.2018 № 410; пункты 103 и 109 Порядка, утверждённого приказом МЧС России от 27.06.2024 № 539",
  paymentAttested:
    "статья 55 Федерального закона от 23.05.2016 № 141-ФЗ; пункты 103, 107 и 108 Порядка, утверждённого приказом МЧС России от 27.06.2024 № 539",
  restCivilian:
    "часть 1 статьи 152 Трудового кодекса Российской Федерации; статья 104 Трудового кодекса Российской Федерации",
  paymentCivilian:
    "часть 1 статьи 152 Трудового кодекса Российской Федерации; пункты 8 и 10 приложения 2 к приказу МЧС России от 14.12.2019 № 747",
  // Про обязанность вести учёт сказано без номера части: формулировка
  // ст. 91 ТК РФ переезжала между частями при поправках, и точный номер в
  // бумаге устареет раньше, чем сама норма.
  correctionAttested:
    "статья 54 Федерального закона от 23.05.2016 № 141-ФЗ; статьи 91 и 104 Трудового кодекса Российской Федерации; письмо Роструда от 01.03.2010 № 550-6-1",
  correctionCivilian:
    "статьи 91 и 104 Трудового кодекса Российской Федерации; письмо Роструда от 01.03.2010 № 550-6-1",
  calloutAttested:
    "часть 1 статьи 54 Федерального закона от 23.05.2016 № 141-ФЗ; Порядок, утверждённый приказом МЧС России от 24.09.2018 № 410",
  calloutCivilian:
    "статьи 91, 99 и 153 Трудового кодекса Российской Федерации",
} as const;

/**
 * Чему посвящена бумага — для заголовка на экране.
 *
 * Названия разные не ради разнообразия: «о выплате денежной компенсации за
 * сверхурочную работу» — формулировка приказа № 539, «об оплате
 * сверхурочной работы» — Трудового кодекса. Человек несёт бумагу тому, кто
 * эти слова и ищет.
 */
const SUBJECT: Record<ReportRequest, Record<EmploymentKind, string>> = {
  rest: {
    attested: "о предоставлении дополнительного времени отдыха",
    civilian: "о предоставлении дополнительного времени отдыха",
  },
  payment: {
    attested: "о выплате денежной компенсации за сверхурочную работу",
    civilian: "об оплате сверхурочной работы",
  },
  correction: {
    attested: "о приведении учёта служебного времени в соответствие",
    civilian: "о приведении учёта рабочего времени в соответствие",
  },
  callout_record: {
    attested: "о привлечении к службе помимо графика сменности",
    civilian: "о привлечении к работе помимо графика сменности",
  },
};

/**
 * «1 смена», «2 смены», «5 смен».
 *
 * Бумагу читает делопроизводитель, и «4 смен(ы)» в ней выглядит как
 * машинная заготовка, которую не потрудились вычитать. Это ровно то
 * впечатление, с которого начинается разговор о том, что и посчитано
 * небрежно.
 */
function shiftsWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return "смен";
  const last = count % 10;
  if (last === 1) return "смена";
  if (last >= 2 && last <= 4) return "смены";
  return "смен";
}

/** Факт, с которого начинается бумага о компенсации. */
function factParagraph(attested: boolean, period: string, hours: string): string {
  return attested
    ? `По итогам учётного периода ${period} мною выполнено ${hours} службы сверх установленной нормальной продолжительности служебного времени.`
    : `По итогам учётного периода ${period} мною отработано сверхурочно ${hours}.`;
}

/**
 * Рапорт об исправлении учёта.
 *
 * --- Почему это отдельный документ, а не абзац в рапорте о выплате ------
 *
 * Пока в табеле стоят неверные числа, требовать по ним компенсацию
 * бессмысленно: считать будут от того, что в табеле. Сначала числа, потом
 * деньги — и это два разных требования к двум разным действиям.
 *
 * --- Почему названа именно эта ошибка -----------------------------------
 *
 * Норму учётного периода уменьшают на часы, приходящиеся на время, когда
 * человек был освобождён от обязанностей с сохранением места службы. В
 * подразделениях эти часы нередко вычитают не из НОРМЫ, а из
 * ОТРАБОТАННОГО, и тогда ошибка бьёт дважды: норма осталась полной, а факт
 * ещё и уменьшили. Разница между верным и неверным счётом — двойная
 * величина исключаемых часов, и в бумаге она названа числом.
 */
function correctionBody(
  input: ReportInput,
  attested: boolean,
  period: string,
): string[] {
  const timeNoun = attested ? "служебного" : "рабочего";
  const out: string[] = [];
  const c = input.correction;

  if (!c) {
    // Числа табеля не внесены — выдумывать их нельзя. Бумага честно
    // остаётся с прочерками, а экран рядом говорит, что заполнить.
    out.push(
      `В табеле учёта ${timeNoun} времени за учётный период ${period} указаны: ` +
        `норма к отработке — ${BLANK} ч, фактически отработано — ${BLANK} ч, ` +
        `${attested ? "служба сверх нормальной продолжительности" : "сверхурочная работа"} — ${BLANK} ч.`,
    );
  } else {
    const said = [
      c.reportedNormHours ? `норма к отработке — ${formatHours(c.reportedNormHours)} ч` : null,
      c.reportedActualHours
        ? `фактически отработано — ${formatHours(c.reportedActualHours)} ч`
        : null,
      c.reportedOvertimeHours
        ? `${attested ? "служба сверх нормальной продолжительности" : "сверхурочная работа"} — ${formatHours(c.reportedOvertimeHours)} ч`
        : null,
    ].filter((part): part is string => part !== null);

    out.push(
      `В табеле учёта ${timeNoun} времени за учётный период ${period} указаны: ` +
        `${said.join(", ")}.`,
    );
    out.push(
      `По производственному календарю и графику сменности за тот же период ` +
        `норма к отработке составляет ${formatHours(c.normHours)} ч, ` +
        `фактически отработано ${formatHours(c.actualHours)} ч, ` +
        `${attested ? "службы сверх нормальной продолжительности" : "сверхурочной работы"} — ` +
        `${formatHours(input.overtimeHours)} ч.`,
    );
  }

  // Существо требования. Формулировка нарочно длинная: она обязана
  // одновременно назвать верный порядок и прямо отвергнуть неверный.
  const excluded = c && c.excludedHours.greaterThan(0)
    ? ` За указанный период это ${formatHours(c.excludedHours)} ч нормы: на такие ` +
      `периоды пришлось ${c.absentShifts} ${shiftsWord(c.absentShifts)} по графику сменности.`
    : "";
  out.push(
    `Норма учётного периода подлежит уменьшению на количество часов, ` +
      `приходящихся по норме на время, когда я был освобождён от выполнения ` +
      `${attested ? "служебных" : "трудовых"} обязанностей с сохранением места ` +
      `${attested ? "службы" : "работы"} (отпуск, временная нетрудоспособность и иные ` +
      `подобные периоды).${excluded}`,
  );
  out.push(
    `Уменьшение на эти часы ФАКТИЧЕСКИ ОТРАБОТАННОГО времени нормативными ` +
      `правовыми актами не предусмотрено: фактически отработанным является ` +
      `время, в течение которого я исполнял ${attested ? "служебные" : "трудовые"} ` +
      `обязанности, и часы отсутствия в него не входят изначально — ` +
      `вычитать их оттуда значит уменьшать отработанное дважды.`,
  );
  out.push(
    `Прошу привести учёт ${timeNoun} времени за указанный учётный период в ` +
      `соответствие с производственным календарём и графиком сменности и ` +
      `ознакомить меня с исправленным табелем.`,
  );
  out.push(
    `Основание: ${attested ? REPORT_BASIS.correctionAttested : REPORT_BASIS.correctionCivilian}.`,
  );
  return out;
}

/**
 * Рапорт о привлечении, которое никто не оформил.
 *
 * Порядок, утверждённый приказом № 410, допускает привлечение и в устной
 * форме — но тогда прямой руководитель обязан в течение двух рабочих дней
 * доложить о нём рапортом, указав основания привлечения и его
 * продолжительность. Если этого не сделано, нарушение на стороне
 * подразделения, а не человека; его собственный рапорт заводит бумагу там,
 * где её не завели, и с этого момента часы существуют документально.
 */
function calloutBody(
  input: ReportInput,
  attested: boolean,
  period: string,
): string[] {
  const out: string[] = [];
  const callouts = input.callouts ?? [];

  out.push(
    `Докладываю, что в период ${period} я привлекался к выполнению ` +
      `${attested ? "служебных" : "трудовых"} обязанностей помимо графика сменности:`,
  );

  if (callouts.length === 0) {
    out.push(`${BLANK} — ${BLANK} — ${BLANK} ч.`);
  } else {
    for (const callout of callouts) {
      const when =
        callout.start === callout.endInclusive
          ? formatDateRu(callout.start)
          : `${formatDateRu(callout.start)} — ${formatDateRu(callout.endInclusive)}`;
      out.push(
        `${when} — ${callout.kindLabel.toLowerCase()} — ${formatHours(callout.hoursPerDay)} ч в сутки, ` +
          `всего ${formatHours(callout.totalHours)} ч.`,
      );
    }
    const total = callouts.reduce(
      (sum, callout) => sum.plus(callout.totalHours),
      callouts[0]!.totalHours.times(0),
    );
    out.push(`Всего за период — ${formatHours(total)} ч.`);
  }

  out.push(
    attested
      ? "Приказы о привлечении меня к выполнению служебных обязанностей помимо графика сменности до моего сведения не доводились, с рапортами прямых руководителей о привлечении я не ознакомлен."
      : "Приказы (распоряжения) о привлечении меня к работе помимо графика сменности до моего сведения не доводились.",
  );
  out.push(
    attested
      ? `Прошу учесть указанное время в табеле учёта служебного времени, ` +
          `оформить привлечение в соответствии с Порядком, утверждённым приказом ` +
          `МЧС России от 24.09.2018 № 410, и ознакомить меня с приказами о ` +
          `привлечении либо выдать их копии.`
      : `Прошу учесть указанное время в табеле учёта рабочего времени, ` +
          `оформить привлечение приказом (распоряжением) и ознакомить меня с ним ` +
          `либо выдать копию.`,
  );
  out.push(
    `Основание: ${attested ? REPORT_BASIS.calloutAttested : REPORT_BASIS.calloutCivilian}.`,
  );
  return out;
}

export function buildReport(input: ReportInput): ReportDocument {
  const { employment, request, identity } = input;
  const attested = employment === "attested";
  const hours = `${formatHours(input.overtimeHours)} ч`;
  const period = periodPhrase(input.periodStart, input.periodEnd);

  const addressLines = filled(identity.addressee, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const body: string[] = [];

  if (request === "correction") {
    body.push(...correctionBody(input, attested, period));
  } else if (request === "callout_record") {
    body.push(...calloutBody(input, attested, period));
  } else if (request === "rest") {
    // Первый абзац — факт: сколько часов и за какой период. Он один и тот
    // же в обоих документах о компенсации, потому что спор идёт о нём.
    body.push(factParagraph(attested, period, hours));
    body.push(
      attested
        ? `Прошу предоставить мне за указанное время компенсацию в виде дополнительного времени отдыха соответствующей продолжительности — ${hours}.`
        : `На основании части 1 статьи 152 Трудового кодекса Российской Федерации прошу вместо повышенной оплаты предоставить мне дополнительное время отдыха продолжительностью не менее времени, отработанного сверхурочно, — ${hours}.`,
    );
    body.push(
      `Основание: ${attested ? REPORT_BASIS.restAttested : REPORT_BASIS.restCivilian}.`,
    );
  } else {
    body.push(factParagraph(attested, period, hours));
    // Про непредоставление отдыха сказано прямо: пункт 103 приказа № 539
    // связывает выплату именно с этим обстоятельством, и умолчание о нём
    // оставляет бухгалтерии повод отложить рапорт.
    if (attested) {
      body.push(
        "Дополнительное время отдыха и дополнительные дни отпуска за указанное время мне не предоставлялись.",
      );
      body.push(
        `Прошу выплатить мне денежную компенсацию за сверхурочную работу за ${hours} и издать приказ с указанием количества часов, за которые она выплачивается.`,
      );
    } else {
      body.push(
        "Дополнительное время отдыха вместо повышенной оплаты мне не предоставлялось.",
      );
      body.push(
        `Прошу оплатить сверхурочную работу за ${hours} в повышенном размере: за первые два часа не менее чем в полуторном, за последующие часы не менее чем в двойном размере часовой ставки, исчисленной исходя из заработной платы, включая компенсационные и стимулирующие выплаты.`,
      );
    }
    body.push(
      `Основание: ${attested ? REPORT_BASIS.paymentAttested : REPORT_BASIS.paymentCivilian}.`,
    );

    if (input.money) {
      const { monthlyBase, hourlyRate, total, atOneAndHalfHours, atDoubleHours } =
        input.money;
      const bands = [
        atOneAndHalfHours.greaterThan(0)
          ? `${formatHours(atOneAndHalfHours)} ч в полуторном размере`
          : null,
        atDoubleHours.greaterThan(0)
          ? `${formatHours(atDoubleHours)} ч в двойном размере`
          : null,
      ].filter((part): part is string => part !== null);

      // Своя сумма названа как СВОЙ расчёт, а не как требование к копейке:
      // окончательную сумму определяет тот, кто платит, и спор о копейках
      // дал бы повод отклонить бумагу целиком.
      //
      // У работника оговорка другая и обязательна. Порог полуторного
      // размера при суммированном учёте приказ № 747 не устанавливает — он
      // взят из п. 107 приказа № 539 по аналогии, — а порядок исчисления
      // часовой ставки задаёт локальный акт (п. 8 приложения 2). Умолчать
      // об этом значило бы выдать спорное прочтение за бесспорное.
      body.push(
        attested
          ? `По моему расчёту сумма денежной компенсации составляет ${money(total)} — ` +
              `${bands.join(", ")} при часовой ставке ${money(hourlyRate)} за час, ` +
              `исчисленной от должностного оклада ${money(monthlyBase)} в месяц ` +
              `(пункт 105 Порядка). Расчёт прилагаю; окончательная сумма ` +
              `определяется приказом.`
          : `По моему расчёту сумма доплаты составляет не менее ${money(total)} ` +
              `при часовой ставке ${money(hourlyRate)} за час, исчисленной от ` +
              `${money(monthlyBase)} в месяц. Расчёт прилагаю. Порядок исчисления ` +
              `часовой ставки устанавливается локальным нормативным актом ` +
              `(пункт 8 приложения 2 к приказу МЧС России от 14.12.2019 № 747), ` +
              `поэтому окончательная сумма определяется работодателем.`,
      );
    }
  }

  // Приложение — только там, где к бумаге правда что-то прикладывают.
  // В рапорте о фиксации вызовов прилагать нечего: перечень уже в теле.
  if (request !== "callout_record") {
    body.push(
      `Приложение: расчёт ${attested ? "служебного" : "рабочего"} времени за учётный период на ___ л.`,
    );
  }

  const signatureLines = [
    ...(attested ? [filled(identity.rank)] : []),
    filled(identity.position),
    `${BLANK}   ${filled(identity.fullName)}`,
    "«____» ______________ 20____ г.",
  ];

  const blanks: string[] = [];
  if (filled(identity.addressee, "") === "") blanks.push("кому адресован документ");
  if (attested && filled(identity.rank, "") === "") blanks.push("звание");
  if (filled(identity.position, "") === "") blanks.push("должность");
  if (filled(identity.fullName, "") === "") blanks.push("фамилию, имя и отчество");

  return {
    title: `${attested ? "Рапорт" : "Заявление"} ${SUBJECT[request][employment]}`,
    heading: attested ? "РАПОРТ" : "ЗАЯВЛЕНИЕ",
    addressLines,
    bodyParagraphs: body,
    signatureLines,
    blanks,
  };
}

/**
 * Рубли в тексте документа: словом «руб.», а не значком.
 *
 * Разряды и копейки — тем же кодом, что на экране расчёта: сумма в бумаге
 * обязана совпадать с суммой, которую человек видел, до последней цифры.
 * Разделитель разрядов там неразрывный, и `escapeRtf` знает, что с ним
 * делать.
 */
function money(value: Decimal): string {
  return `${formatMoneyAmount(value)} руб.`;
}

/**
 * Документ как обычный текст.
 *
 * Нужен для двух вещей сразу: показать на экране и положить в буфер
 * обмена. С телефона «скопировать» — единственный удобный способ: файл там
 * ещё надо найти и чем-то открыть.
 */
export function renderPlainText(doc: ReportDocument): string {
  const lines: string[] = [];
  for (const line of doc.addressLines) lines.push(line);
  if (doc.addressLines.length > 0) lines.push("");
  lines.push(doc.heading, "");
  for (const paragraph of doc.bodyParagraphs) lines.push(paragraph, "");
  for (const line of doc.signatureLines) lines.push(line);
  return lines.join("\n");
}

/**
 * Документ в RTF.
 *
 * --- Почему RTF, а не DOCX и не PDF ------------------------------------
 *
 * Бумагу нужно ДОПИСАТЬ: вставить дату, номер листов, поправить
 * формулировку под свою часть. PDF для этого не годится. DOCX — это ZIP с
 * несколькими XML внутри, то есть либо внешняя библиотека в сборке, либо
 * свой архиватор; RTF же собирается конкатенацией строк и открывается
 * Word, LibreOffice, «Google Документами» и даже WordPad.
 *
 * Кириллица уходит в `\uN?`-escape'ы: единственный способ, не зависящий ни
 * от кодовой страницы читающей программы, ни от её локали.
 */
export function renderRtf(doc: ReportDocument): string {
  const parts: string[] = [
    // Times New Roman 14 пт — то, как выглядит служебная переписка.
    "{\\rtf1\\ansi\\ansicpg1251\\deff0",
    "{\\fonttbl{\\f0\\froman\\fcharset204 Times New Roman;}}",
    "\\viewkind4\\uc1\\f0\\fs28",
    // Поля листа: слева шире — под подшивку.
    "\\margl1701\\margr851\\margt1134\\margb1134",
  ];

  for (const line of doc.addressLines) {
    parts.push(`\\pard\\qr\\sb0\\sa0 ${escapeRtf(line)}\\par`);
  }
  parts.push("\\pard\\qc\\sb400\\sa400\\b " + escapeRtf(doc.heading) + "\\b0\\par");

  for (const paragraph of doc.bodyParagraphs) {
    parts.push(`\\pard\\qj\\fi709\\sa200\\sl360\\slmult1 ${escapeRtf(paragraph)}\\par`);
  }

  parts.push("\\pard\\ql\\sb400\\sa0");
  parts.push(doc.signatureLines.map(escapeRtf).join("\\par "));
  parts.push("\\par}");
  return parts.join("\n");
}

/**
 * Экранирование для RTF.
 *
 * Порядок существенен: обратная косая и фигурные скобки заменяются ДО
 * того, как появятся собственные управляющие последовательности, иначе
 * экранирование съело бы само себя.
 */
function escapeRtf(text: string): string {
  let out = "";
  for (const char of text.replace(/\\/gu, "\\\\").replace(/([{}])/gu, "\\$1")) {
    const code = char.codePointAt(0) ?? 0;
    // Неразрывный пробел из разрядов суммы — своим управляющим словом:
    // «65 720,08» не должно разорваться переносом строки посередине.
    if (char === "\u00a0") out += "\\~";
    else if (code < 128) out += char;
    else out += `\\u${code}?`;
  }
  return out;
}

/** Имя файла: без пробелов и кириллицы, чтобы не зависеть от файловой системы. */
export function reportFileName(
  employment: EmploymentKind,
  request: ReportRequest,
  periodStart: IsoDate,
): string {
  const kind = employment === "attested" ? "raport" : "zayavlenie";
  const what = {
    rest: "otdyh",
    payment: "vyplata",
    correction: "ispravit-uchet",
    callout_record: "vyzovy",
  }[request];
  return `${kind}-${what}-${periodStart.slice(0, 4)}.rtf`;
}
