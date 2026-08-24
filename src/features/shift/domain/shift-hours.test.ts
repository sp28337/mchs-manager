/**
 * Раскладка суточной смены по календарным суткам.
 *
 * Числа здесь — не из кода, а с часов: смена с развода 08:30 идёт до 08:30
 * следующих суток, значит в сутках начала её 15,5 часа (из них ночных
 * два: с 22:00 до 24:00), а в следующих 8,5 (из них ночных шесть: с 00:00
 * до 06:00).
 */

import { describe, expect, test } from "vitest";

import {
  DEFAULT_SHIFT_START,
  shiftMinutes,
  minutesToHours,
  parseTimeOfDay,
  shiftStartMinute,
  splitShift,
} from "./shift-hours";
import type { IsoDate } from "./plain-date";

describe("время развода", () => {
  test("разбирается из ЧЧ:ММ", () => {
    expect(parseTimeOfDay("08:30")).toBe(510);
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("23:59")).toBe(1439);
  });

  test("мусор отвергается, а не толкуется", () => {
    expect(parseTimeOfDay("8:30")).toBeNull();
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("08:60")).toBeNull();
    expect(parseTimeOfDay("")).toBeNull();
  });

  test("умолчание — 08:00", () => {
    expect(DEFAULT_SHIFT_START).toBe("08:00");
    expect(shiftStartMinute(undefined)).toBe(480);
    // Неразбираемое значение не должно ронять расчёт: профиль мог прийти из
    // файла, а без часов считать нечего.
    expect(shiftStartMinute("ерунда")).toBe(480);
  });
});

describe("развод в 08:30", () => {
  const parts = splitShift("2026-03-31", 510);

  test("смена лежит в двух сутках", () => {
    expect(parts).toHaveLength(2);
    expect(parts[0]!.day).toBe("2026-03-31");
    expect(parts[1]!.day).toBe("2026-04-01");
  });

  test("сутки начала смены получают 15,5 часа, следующие 8,5", () => {
    expect(minutesToHours(parts[0]!.minutes).toString()).toBe("15.5");
    expect(minutesToHours(parts[1]!.minutes).toString()).toBe("8.5");
    expect(parts[0]!.minutes + parts[1]!.minutes).toBe(1440);
  });

  test("ночные — по часам, а не пропорцией", () => {
    // Пропорция дала бы 8 × 15,5/24 = 5,17 в первых сутках. На часах там
    // ровно два ночных часа: с 22:00 до 24:00.
    expect(minutesToHours(parts[0]!.nightMinutes).toString()).toBe("2");
    expect(minutesToHours(parts[1]!.nightMinutes).toString()).toBe("6");
  });

  test("начало смены помечено только в первых сутках", () => {
    expect(parts[0]!.isStart).toBe(true);
    expect(parts[1]!.isStart).toBe(false);
  });
});

describe("другое время развода", () => {
  test("развод в 08:00 даёт 16 и 8 при тех же ночных", () => {
    // Ночные от времени развода не зависят, пока он между 06:00 и 22:00:
    // окна 22:00-24:00 и 00:00-06:00 целиком внутри смены.
    const parts = splitShift("2026-03-31", 480);
    expect(minutesToHours(parts[0]!.minutes).toString()).toBe("16");
    expect(minutesToHours(parts[1]!.minutes).toString()).toBe("8");
    expect(minutesToHours(parts[0]!.nightMinutes).toString()).toBe("2");
    expect(minutesToHours(parts[1]!.nightMinutes).toString()).toBe("6");
  });

  test("развод в полночь оставляет смену в одних сутках", () => {
    const parts = splitShift("2026-03-31", 0);
    expect(parts).toHaveLength(1);
    expect(minutesToHours(parts[0]!.minutes).toString()).toBe("24");
    expect(minutesToHours(parts[0]!.nightMinutes).toString()).toBe("8");
  });

  test("развод в 23:00 переносит ночь целиком во вторые сутки", () => {
    // 23:00-24:00 — час ночной; 00:00-06:00 в следующих сутках — шесть;
    // 22:00-23:00 следующих суток — ещё один. Всего восемь.
    const parts = splitShift("2026-03-31", 23 * 60);
    expect(minutesToHours(parts[0]!.nightMinutes).toString()).toBe("1");
    expect(minutesToHours(parts[1]!.nightMinutes).toString()).toBe("7");
  });

  test("ночных в сутках смены всегда восемь", () => {
    // Инвариант: окно 22:00-06:00 длится 8 часов, и смена в 24 часа
    // накрывает его ровно один раз, как бы она ни была сдвинута.
    for (let minute = 0; minute < 1440; minute += 15) {
      const total = splitShift("2026-06-15", minute).reduce(
        (sum, part) => sum + part.nightMinutes,
        0,
      );
      expect(minutesToHours(total).toString()).toBe("8");
    }
  });
});

/**
 * Продолжительность смены перестала быть константой, и от неё зависит
 * главное: попадает ли смена в следующие сутки. Двенадцатичасовая с восьми
 * утра не попадает вовсе, с восьми вечера — попадает; суточная попадает
 * всегда. Ошибка здесь молча переносит часы между месяцами.
 */
describe("смена короче суток", () => {
  test("двенадцать часов с утра целиком лежат в своих сутках", () => {
    const parts = splitShift("2026-03-10" as IsoDate, shiftStartMinute("08:00"), shiftMinutes("12"));
    expect(parts).toHaveLength(1);
    expect(parts[0]?.minutes).toBe(12 * 60);
    expect(parts[0]?.day).toBe("2026-03-10");
    // С 08:00 до 20:00 ночных нет ни минуты.
    expect(parts[0]?.nightMinutes).toBe(0);
  });

  test("двенадцать часов с вечера переваливают за полночь", () => {
    const parts = splitShift("2026-03-10" as IsoDate, shiftStartMinute("20:00"), shiftMinutes("12"));
    expect(parts).toHaveLength(2);
    expect(parts[0]?.minutes).toBe(4 * 60);
    expect(parts[1]?.day).toBe("2026-03-11");
    expect(parts[1]?.minutes).toBe(8 * 60);
    // Ночные: с 22:00 до полуночи — два часа, с полуночи до 06:00 — шесть.
    expect(parts[0]?.nightMinutes).toBe(2 * 60);
    expect(parts[1]?.nightMinutes).toBe(6 * 60);
  });

  test("восьмичасовая смена пятидневки не выходит за сутки", () => {
    const parts = splitShift("2026-03-10" as IsoDate, shiftStartMinute("09:00"), shiftMinutes("8"));
    expect(parts).toHaveLength(1);
    expect(parts[0]?.minutes).toBe(8 * 60);
  });

  test("половина часа не теряется", () => {
    expect(shiftMinutes("11,5")).toBe(11 * 60 + 30);
    expect(shiftMinutes("11.5")).toBe(11 * 60 + 30);
  });

  test("бессмыслица читается как суточная смена, а не как ноль", () => {
    // Смена нулевой длины — это не настройка, а поломка: показывать её
    // расчётом молча нельзя.
    for (const value of ["", "0", "-5", "чепуха", undefined]) {
      expect(shiftMinutes(value), String(value)).toBe(24 * 60);
    }
    // Длиннее суток смена не бывает: она разложилась бы на трое суток.
    expect(shiftMinutes("30")).toBe(24 * 60);
  });

  test("сумма кусков всегда равна продолжительности", () => {
    for (const hours of ["8", "11,5", "12", "23", "24"]) {
      for (const start of ["00:00", "08:00", "13:30", "20:00", "23:45"]) {
        const total = splitShift(
          "2026-03-10" as IsoDate,
          shiftStartMinute(start),
          shiftMinutes(hours),
        ).reduce((sum, part) => sum + part.minutes, 0);
        expect(total, `${hours} с ${start}`).toBe(shiftMinutes(hours));
      }
    }
  });
});
