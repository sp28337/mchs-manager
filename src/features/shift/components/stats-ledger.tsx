import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { formatHoursTrim as hoursTrim, type Decimal } from "../domain/decimal";

/**
 * Числа периода таблицей, в которой месяцы стоят столбцами, а показатели — строками.
 *
 * --- Почему «лёжа» ---------------------------------------------------------
 *
 * Таблица стояла «стоя»: месяц — строка, показателей семь столбцов. Двенадцать
 * строк по тридцать семь точек — это почти полэкрана ради шести чисел на месяц, и
 * двенадцать месяцев приходилось листать, чтобы увидеть год. Положенная набок,
 * та же таблица занимает шесть строк и целиком открывает год: месяцы идут слева
 * направо, как на рисунках над ней, и рисунок с цифрами под ним читаются как одна
 * картинка.
 *
 * На телефоне столбцов тринадцать, и они не помещаются — таблица прокручивается
 * вбок сама, внутри плашки, а названия показателей остаются на месте: без них
 * прокрученное число — просто число.
 *
 * --- Что обязана эта таблица -----------------------------------------------
 *
 * Всё, что показано выше рисунком и цветом, обязано читаться и без них: цвет
 * столбца на светлой бумаге не дотягивает до трёх к одному, а число из таблицы
 * можно переписать в заявление, а число с рисунка нельзя. Поэтому это настоящая
 * `table`, с подписью и заголовками строк и столбцов, а не сетка из `div`.
 */

/** Один столбец: месяц, квартал, полугодие или итог. */
export interface LedgerColumn {
  readonly key: string;
  /** Подпись в шапке: «янв», «1-й кв.», «Год». */
  readonly head: string;
  /** Полное имя для программы чтения: «Январь», «1-й квартал». */
  readonly full: string;
  /** Что стоит под подписью мелко: у квартала — его месяцы. */
  readonly sub?: string;
  readonly norm: Decimal;
  readonly actual: Decimal;
  /** Факт минус норма, со знаком. */
  readonly balance: number;
  readonly night: Decimal;
  readonly holiday: Decimal;
  readonly shifts: number;
  /** Итог по периоду: стоит последним и отбит чертой. */
  readonly total?: boolean;
  /** Черта слева: полугодия отделены от кварталов, из которых сложены. */
  readonly split?: boolean;
}

/** Со знаком: «+24» и «−16». Минус — типографский, как и везде в числах. */
export function signed(value: number): string {
  if (value === 0) return "0";
  const text = hoursTrim(Math.abs(value));
  return value > 0 ? `+${text}` : `−${text}`;
}

const ROWS: readonly {
  readonly key: string;
  readonly label: string;
  readonly cell: (column: LedgerColumn) => ReactNode;
  readonly tone?: (column: LedgerColumn) => "over" | "under" | undefined;
}[] = [
  { key: "norm", label: "Норма, ч", cell: (it) => hoursTrim(it.norm) },
  { key: "actual", label: "Факт, ч", cell: (it) => hoursTrim(it.actual) },
  {
    key: "balance",
    label: "Баланс, ч",
    cell: (it) => signed(it.balance),
    tone: (it) => (it.balance > 0 ? "over" : it.balance < 0 ? "under" : undefined),
  },
  { key: "night", label: "Ночные, ч", cell: (it) => hoursTrim(it.night) },
  { key: "holiday", label: "Праздничные, ч", cell: (it) => hoursTrim(it.holiday) },
  { key: "shifts", label: "Смены", cell: (it) => it.shifts },
];

/**
 * Первый столбец остаётся на месте при прокрутке вбок и закрывает собой то, что
 * под него уезжает, — заливкой плашки, на которой стоит таблица.
 */
const STICKY = "sticky left-0 z-10 bg-paper-raised";

export function Ledger({
  caption,
  columns,
  className,
}: {
  caption: string;
  columns: readonly LedgerColumn[];
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>

        <thead>
          <tr className="text-[11px] tracking-wide text-ink-faint uppercase">
            <th scope="col" className={cn(STICKY, "py-1.5 pr-3 text-left font-medium")}>
              <span className="sr-only">Показатель</span>
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                title={column.full}
                className={cn(
                  "px-2 py-1.5 text-right font-medium whitespace-nowrap",
                  (column.total || column.split) && "border-l border-rule-strong",
                  column.total && "text-ink-muted",
                )}
              >
                {column.head}
                {column.sub === undefined ? null : (
                  <span className="block text-[10px] font-normal tracking-normal normal-case">
                    {column.sub}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-rule">
          {ROWS.map((row) => (
            <tr key={row.key}>
              <th
                scope="row"
                className={cn(
                  STICKY,
                  "py-1.5 pr-3 text-left text-xs font-normal whitespace-nowrap text-ink-muted",
                )}
              >
                {row.label}
              </th>
              {columns.map((column) => {
                const tone = row.tone?.(column);
                return (
                  <td
                    key={column.key}
                    className={cn(
                      "px-2 py-1.5 text-right font-mono tabular-nums",
                      (column.total || column.split) && "border-l border-rule-strong",
                      column.total && "font-medium",
                      tone === "over" && "text-verify",
                      tone === "under" && "text-signal",
                    )}
                  >
                    {row.cell(column)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
