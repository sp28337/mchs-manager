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

/** Что человек просит за переработку. */
export type ReportRequest = "rest" | "payment";

export const REPORT_REQUEST_LABELS: Record<ReportRequest, string> = {
  rest: "Дополнительное время отдыха",
  payment: "Денежная компенсация",
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
} as const;

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

  // Первый абзац — факт: сколько часов и за какой период. Он один и тот же
  // в обоих документах, потому что спор идёт именно о нём.
  body.push(
    attested
      ? `По итогам учётного периода ${period} мною выполнено ${hours} службы сверх установленной нормальной продолжительности служебного времени.`
      : `По итогам учётного периода ${period} мною отработано сверхурочно ${hours}.`,
  );

  if (request === "rest") {
    body.push(
      attested
        ? `Прошу предоставить мне за указанное время компенсацию в виде дополнительного времени отдыха соответствующей продолжительности — ${hours}.`
        : `На основании части 1 статьи 152 Трудового кодекса Российской Федерации прошу вместо повышенной оплаты предоставить мне дополнительное время отдыха продолжительностью не менее времени, отработанного сверхурочно, — ${hours}.`,
    );
    body.push(
      `Основание: ${attested ? REPORT_BASIS.restAttested : REPORT_BASIS.restCivilian}.`,
    );
  } else {
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

  body.push(
    `Приложение: расчёт ${attested ? "служебного" : "рабочего"} времени за учётный период на ___ л.`,
  );

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
    title: `${attested ? "Рапорт" : "Заявление"} ${
      request === "rest"
        ? "о предоставлении дополнительного времени отдыха"
        : attested
          ? "о выплате денежной компенсации за сверхурочную работу"
          : "об оплате сверхурочной работы"
    }`,
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
  const what = request === "rest" ? "otdyh" : "vyplata";
  return `${kind}-${what}-${periodStart.slice(0, 4)}.rtf`;
}
