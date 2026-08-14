import { describe, expect, test } from "vitest";

import { Dec } from "./decimal";
import {
  REPORT_BASIS,
  buildReport,
  renderPlainText,
  renderRtf,
  reportFileName,
  type ReportInput,
} from "./report-documents";

const IDENTITY = {
  addressee: "Начальнику ПСЧ-5\nподполковнику внутренней службы А. А. Петрову",
  fullName: "Иванов Иван Иванович",
  rank: "старший сержант внутренней службы",
  position: "пожарный 3 караула ПСЧ-5",
};

const MONEY = {
  monthlyBase: new Dec(30_000),
  hourlyRate: new Dec("182.56"),
  total: new Dec("65720.08"),
  atOneAndHalfHours: new Dec(240),
  atDoubleHours: new Dec(0),
};

function report(overrides: Partial<ReportInput> = {}) {
  return buildReport({
    employment: "attested",
    request: "payment",
    identity: IDENTITY,
    periodStart: "2026-01-01",
    periodEnd: "2027-01-01",
    overtimeHours: new Dec(240),
    money: MONEY,
    ...overrides,
  });
}

const text = (overrides: Partial<ReportInput> = {}) => renderPlainText(report(overrides));

describe("что за бумага", () => {
  test("сотрудник подаёт рапорт, работник — заявление", () => {
    // Не придирка к слову: это разные документы с разными основаниями.
    expect(report({ employment: "attested" }).heading).toBe("РАПОРТ");
    expect(report({ employment: "civilian" }).heading).toBe("ЗАЯВЛЕНИЕ");
  });

  test("шапка разбита по строкам и не попадает в тело", () => {
    const doc = report();
    expect(doc.addressLines).toEqual([
      "Начальнику ПСЧ-5",
      "подполковнику внутренней службы А. А. Петрову",
    ]);
    expect(doc.bodyParagraphs.join(" ")).not.toContain("Начальнику");
  });
});

describe("период и часы", () => {
  test("в бумаге стоит последний ВКЛЮЧЁННЫЙ день, а не следующий за ним", () => {
    // Внутри всё считается полуинтервалом, кончающимся 1 января. Написать
    // «по 01.01.2027» в рапорте значило бы потребовать за день, которого в
    // периоде нет, — и дать повод придраться к расчёту целиком.
    expect(text()).toContain("с 01.01.2026 по 31.12.2026");
    expect(text()).not.toContain("01.01.2027");
  });

  test("часы названы ровно те, что в расчёте", () => {
    expect(text({ overtimeHours: new Dec("167.5") })).toContain("167,50 ч");
  });
});

describe("о чём просят", () => {
  test("рапорт на отдых просит отдых и молчит про деньги", () => {
    const rest = text({ request: "rest" });
    expect(rest).toContain("дополнительного времени отдыха");
    expect(rest).not.toContain("руб.");
  });

  test("рапорт на выплату прямо говорит, что отдых не предоставлялся", () => {
    // Пункт 103 приказа № 539 связывает выплату именно с этим
    // обстоятельством. Умолчание оставляет повод отложить рапорт.
    expect(text()).toContain("не предоставлялись");
  });

  test("сумма в бумаге совпадает с суммой на экране", () => {
    const body = text();
    expect(body).toContain("65 720,08 руб.");
    expect(body).toContain("182,56 руб.");
    expect(body).toContain("240,00 ч в полуторном размере");
    // Двойного размера не было — про него в бумаге ни слова.
    expect(body).not.toContain("в двойном размере");
  });

  test("без указанного оклада сумма не выдумывается", () => {
    const body = text({ money: null });
    expect(body).not.toContain("руб.");
    expect(body).toContain("Прошу выплатить");
  });

  test("работник просит оплату по статье 152, а не по приказу МЧС", () => {
    const body = text({ employment: "civilian" });
    expect(body).toContain("в полуторном");
    expect(body).toContain("152");
    expect(body).not.toContain("служебного времени");
  });

  test("работнику сумма названа как «не менее», с оговоркой про локальный акт", () => {
    // Порог полуторного размера приказ № 747 не устанавливает, а порядок
    // исчисления часовой ставки задаёт локальный акт. Выдать спорное
    // прочтение за бесспорное значило бы подставить человека.
    const body = text({ employment: "civilian" });
    expect(body).toContain("не менее 65\u00a0720,08 руб.");
    expect(body).toContain("локальным нормативным актом");
    expect(body).not.toContain("определяется приказом");
  });

  test("сотруднику сумма выведена по пункту 105, с разбивкой по размерам", () => {
    const body = text();
    expect(body).toContain("пункт 105 Порядка");
    expect(body).toContain("должностного оклада");
    expect(body).toContain("определяется приказом");
  });
});

describe("рапорт об исправлении учёта", () => {
  const CORRECTION = {
    reportedNormHours: new Dec(1972),
    reportedActualHours: new Dec(2020),
    reportedOvertimeHours: new Dec(48),
    normHours: new Dec(1892),
    actualHours: new Dec(2100),
    excludedHours: new Dec(80),
    absentShifts: 4,
  };
  const body = (overrides: Partial<ReportInput> = {}) =>
    text({ request: "correction", correction: CORRECTION, overtimeHours: new Dec(208), ...overrides });

  test("названы обе тройки чисел: их и наша", () => {
    // Требование «исправьте» без двух колонок проверить нельзя.
    const out = body();
    expect(out).toContain("1972,00 ч");
    expect(out).toContain("2020,00 ч");
    expect(out).toContain("48,00 ч");
    expect(out).toContain("1892,00 ч");
    expect(out).toContain("2100,00 ч");
    expect(out).toContain("208,00 ч");
  });

  test("названа сама ошибка, а не только расхождение", () => {
    // Это и есть суть бумаги: вычитать часы отсутствия из отработанного
    // нельзя, их вычитают из НОРМЫ. Без этой формулировки рапорт
    // превращается в «у вас другие числа».
    const out = body();
    expect(out).toContain("Норма учётного периода подлежит уменьшению");
    expect(out).toContain("80,00 ч");
    expect(out).toContain("ФАКТИЧЕСКИ ОТРАБОТАННОГО");
    expect(out).toContain("не предусмотрено");
    expect(out).toContain("ознакомить меня с исправленным табелем");
  });

  test("без чисел табеля бумага остаётся с прочерками, а не выдумывает их", () => {
    const out = body({ correction: null });
    expect(out).toContain("____");
    expect(out).not.toContain("1972,00");
  });

  test("основание — учёт времени и письмо Роструда, а не приказ о довольствии", () => {
    expect(body()).toContain(REPORT_BASIS.correctionAttested);
    expect(REPORT_BASIS.correctionAttested).toContain("550-6-1");
    expect(REPORT_BASIS.correctionCivilian).toContain("550-6-1");
    expect(body()).not.toContain("539");
  });

  test("работнику — про трудовые обязанности и место работы", () => {
    const out = body({ employment: "civilian" });
    expect(out).toContain("трудовых");
    expect(out).toContain("рабочего времени");
    expect(out).not.toContain("служебных обязанностей");
  });
});

describe("рапорт о вызовах, которые не оформили", () => {
  const CALLOUTS = [
    {
      start: "2026-03-02" as const,
      endInclusive: "2026-03-02" as const,
      kindLabel: "Соревнования",
      hoursPerDay: new Dec(8),
      totalHours: new Dec(8),
    },
    {
      start: "2026-05-11" as const,
      endInclusive: "2026-05-13" as const,
      kindLabel: "Сбор",
      hoursPerDay: new Dec(6),
      totalHours: new Dec(18),
    },
  ];
  const body = (overrides: Partial<ReportInput> = {}) =>
    text({ request: "callout_record", callouts: CALLOUTS, ...overrides });

  test("перечень вызовов с датами, часами и итогом", () => {
    const out = body();
    expect(out).toContain("02.03.2026 — соревнования — 8,00 ч в сутки, всего 8,00 ч.");
    expect(out).toContain("11.05.2026 — 13.05.2026 — сбор — 6,00 ч в сутки, всего 18,00 ч.");
    expect(out).toContain("Всего за период — 26,00 ч.");
  });

  test("сказано, что приказов не доводили — это существо рапорта", () => {
    expect(body()).toContain("до моего сведения не доводились");
    expect(body()).toContain("Прошу учесть указанное время в табеле");
  });

  test("сотрудник ссылается на приказ № 410, работник — на кодекс", () => {
    expect(body()).toContain(REPORT_BASIS.calloutAttested);
    expect(REPORT_BASIS.calloutAttested).toContain("410");
    expect(body({ employment: "civilian" })).toContain(REPORT_BASIS.calloutCivilian);
    expect(body({ employment: "civilian" })).not.toContain("410");
  });

  test("без вызовов остаётся пустая строка перечня, а не молчание", () => {
    const out = body({ callouts: [] });
    expect(out).toContain("привлекался к выполнению");
    expect(out).toContain("____");
  });

  test("приложения нет: перечень уже в теле", () => {
    expect(body()).not.toContain("Приложение:");
    // А в рапорте о выплате приложение есть — расчёт прикладывают.
    expect(text()).toContain("Приложение:");
  });
});

describe("реквизиты оснований", () => {
  // Та же причина, что у `PAY_BASIS`: приказ отменяют молча, а человек
  // приходит к начальнику с бумагой, где написан недействующий акт.
  test("сотруднику — действующий приказ № 539, а не отменённый № 195", () => {
    expect(REPORT_BASIS.paymentAttested).toContain("539");
    expect(REPORT_BASIS.paymentAttested).toContain("27.06.2024");
    expect(REPORT_BASIS.restAttested).not.toContain("195");
    expect(REPORT_BASIS.paymentAttested).not.toContain("195");
  });

  test("основание попадает в текст, а не остаётся в таблице", () => {
    expect(text()).toContain(REPORT_BASIS.paymentAttested);
    expect(text({ request: "rest" })).toContain(REPORT_BASIS.restAttested);
    expect(text({ employment: "civilian" })).toContain(REPORT_BASIS.paymentCivilian);
    expect(text({ employment: "civilian", request: "rest" })).toContain(
      REPORT_BASIS.restCivilian,
    );
  });

  test("рапорт на отдых ссылается на приказ № 410 — он задаёт порядок", () => {
    expect(REPORT_BASIS.restAttested).toContain("410");
    expect(REPORT_BASIS.restAttested).toContain("141-ФЗ");
  });
});

describe("незаполненные реквизиты", () => {
  const empty = { addressee: "", fullName: "", rank: "", position: "" };

  test("пустое поле остаётся прочерком, а не выдумывается", () => {
    const doc = report({ identity: empty });
    expect(doc.addressLines).toEqual([]);
    expect(renderPlainText(doc)).toContain("____");
  });

  test("человеку названо, чего именно не хватает", () => {
    expect(report({ identity: empty }).blanks).toEqual([
      "кому адресован документ",
      "звание",
      "должность",
      "фамилию, имя и отчество",
    ]);
    expect(report().blanks).toEqual([]);
  });

  test("у работника звания не спрашивают", () => {
    // Строки подписи работника — должность, ФИО и дата: звания у него нет,
    // и пустая строка под подписью выглядела бы как забытое поле.
    const doc = report({ employment: "civilian", identity: empty });
    expect(doc.blanks).not.toContain("звание");
    expect(doc.signatureLines).toHaveLength(3);
  });
});

describe("файл", () => {
  test("RTF открывается как RTF и не теряет кириллицу", () => {
    const rtf = renderRtf(report());
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    expect(rtf.trimEnd().endsWith("}")).toBe(true);
    // Кириллица уходит в \uN? — иначе кодировка зависела бы от читающей
    // программы. «Р» это U+0420.
    expect(rtf).toContain("\\u1056?");
    expect(rtf).not.toMatch(/[А-Яа-яЁё]/u);
  });

  test("фигурные скобки и обратная косая экранированы", () => {
    const rtf = renderRtf(
      report({ identity: { ...IDENTITY, position: "должность {особая} \\ смена" } }),
    );
    expect(rtf).toContain("\\{");
    expect(rtf).toContain("\\}");
    expect(rtf).toContain("\\\\");
  });

  test("скобки в RTF сбалансированы: иначе Word откажется открыть файл", () => {
    const rtf = renderRtf(report());
    let depth = 0;
    for (let index = 0; index < rtf.length; index += 1) {
      if (rtf[index - 1] === "\\") continue;
      if (rtf[index] === "{") depth += 1;
      if (rtf[index] === "}") depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  test("имя файла без кириллицы и пробелов", () => {
    expect(reportFileName("attested", "payment", "2026-01-01")).toBe(
      "raport-vyplata-2026.rtf",
    );
    expect(reportFileName("civilian", "rest", "2026-07-01")).toBe(
      "zayavlenie-otdyh-2026.rtf",
    );
  });
});
