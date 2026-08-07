import { cn } from "@/lib/utils/cn";

/**
 * FE030 — динамика прогноза по периодам.
 *
 * --- Почему две диаграммы, а не одна с двумя рядами ---------------------
 *
 * Ряда действительно два: часы под денежную компенсацию и сутки отдыха. Но
 * это разные величины в разных единицах, и общая вертикальная ось для них
 * — ложь в чистом виде: 40 часов оказались бы «в четыре раза больше» 10
 * суток, хотя сравнивать их не с чем. Каждая величина получает свою шкалу
 * и свою подпись; общей остаётся только горизонталь — период.
 *
 * --- Про масштаб --------------------------------------------------------
 *
 * Ось начинается с нуля, а не с минимума. Обрезанная снизу шкала делает
 * колебание в 3% похожим на обвал — приём, которому не место там, где по
 * числу планируют бюджет.
 *
 * --- Про доступность ----------------------------------------------------
 *
 * Диаграмма — картинка, и картинкой она и объявлена (`role="img"` с
 * `aria-label`). Сами числа доступны не через неё, а через таблицу ниже:
 * это единственный способ дать их программе чтения с экрана и человеку,
 * которому проще прочитать цифру, чем оценить высоту столбца (WCAG 2.2,
 * 1.1.1). Цвет ничего не различает — ряды разведены по разным диаграммам,
 * подписанным словами (1.4.1).
 */

export interface ForecastPoint {
  periodStart: string;
  periodEnd: string;
  /** Период словами — для подсказки и таблицы: «март 2026 г.». */
  label: string;
  /** То же в ширину столбца: «03.26». */
  shortLabel: string;
  monetaryHours: number | null;
  restDays: number | null;
}

export interface ForecastChartProps {
  points: readonly ForecastPoint[];
  className?: string;
}

interface SeriesProps {
  title: string;
  unit: string;
  points: readonly ForecastPoint[];
  valueOf: (point: ForecastPoint) => number | null;
  barClass: string;
}

/**
 * Круглый потолок шкалы чуть выше максимума.
 *
 * Шагов много намеренно. Грубая сетка (1-2-5-10) округлила бы 534 до
 * тысячи, и все столбцы съёжились бы вдвое — картинка стала бы ровной там,
 * где данные различаются.
 */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function formatValue(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function Series({ title, unit, points, valueOf, barClass }: SeriesProps) {
  const values = points.map(valueOf);
  const max = niceCeiling(Math.max(0, ...values.filter((v): v is number => v !== null)));

  return (
    <figure className="min-w-0 space-y-2">
      <figcaption className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
        {title}, {unit}
      </figcaption>

      <div
        role="img"
        aria-label={`${title} по периодам, максимум ${formatValue(max)} ${unit}`}
        // Без `items-end`: столбцы обязаны РАСТЯГИВАТЬСЯ на всю высоту
        // полосы, иначе процентная высота внутри них считается от
        // содержимого (то есть от нуля) и столбиков не видно вовсе. Вниз
        // их прижимает `justify-end` внутри каждого столбца.
        className="flex h-40 gap-1 border-b border-l border-rule-strong pl-1"
      >
        {points.map((point) => {
          const value = valueOf(point);
          const height = value === null ? 0 : (value / max) * 100;

          return (
            <div
              key={point.periodStart}
              className="flex min-w-0 flex-1 flex-col justify-end"
              // `title` — подсказка для мыши; те же числа стоят в таблице
              // ниже, поэтому она не единственный носитель информации.
              title={
                value === null
                  ? `${point.label}: прогноз не построен`
                  : `${point.label}: ${formatValue(value)} ${unit}`
              }
            >
              {value === null ? (
                // Пропуск НЕ рисуется нулём: «прогноз не строился» и «за
                // период ничего не начислено» — разные факты, и столбик
                // нулевой высоты сказал бы второе вместо первого.
                <span
                  aria-hidden
                  className="mx-auto h-full w-full border-x border-dashed border-rule bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,var(--color-rule)_3px,var(--color-rule)_4px)] opacity-40"
                />
              ) : (
                <span
                  aria-hidden
                  className={cn("w-full rounded-t-xs", barClass)}
                  style={{ height: `${Math.max(height, value > 0 ? 1.5 : 0)}%` }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Подписи периодов повторяют структуру полосы столбец в столбец —
          общая строка под обеими диаграммами не совпала бы ни с одной из
          них, а подпись, стоящая не над своим столбцом, хуже её
          отсутствия. */}
      <div className="flex gap-1 pl-1">
        {points.map((point) => (
          <span
            key={point.periodStart}
            className="min-w-0 flex-1 truncate text-center font-mono text-[10px] text-ink-faint"
            title={point.label}
          >
            {point.shortLabel}
          </span>
        ))}
      </div>

      <div className="flex justify-between font-mono text-[10px] text-ink-faint">
        <span>0</span>
        <span>
          максимум шкалы {formatValue(max)} {unit}
        </span>
      </div>
    </figure>
  );
}

export function ForecastChart({ points, className }: ForecastChartProps) {
  if (points.length === 0) return null;

  return (
    <div className={cn("space-y-6", className)}>
      <div className="grid gap-6 md:grid-cols-2">
        <Series
          title="Под денежную компенсацию"
          unit="ч"
          points={points}
          valueOf={(point) => point.monetaryHours}
          barClass="bg-signal"
        />
        <Series
          title="Дополнительное время отдыха"
          unit="сут"
          points={points}
          valueOf={(point) => point.restDays}
          barClass="bg-verify"
        />
      </div>
    </div>
  );
}
