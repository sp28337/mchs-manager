"use client";

import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

/**
 * Время суток — двумя списками, а не полем `type="time"`.
 *
 * --- Почему не родное поле времени ---------------------------------------
 *
 * Родное поле рисует то, что принято в ЯЗЫКЕ БРАУЗЕРА, а не на странице:
 * у человека с английской системой начало смены превращалось в «08:30 AM»
 * с американским порядком и переключателем AM/PM. Атрибут `lang` на это
 * не влияет — Chrome смотрит на язык интерфейса, а не документа.
 *
 * Здесь же счёт всегда двадцатичетырёхчасовой: восемь ноль-ноль — это
 * восемь утра, и никаких «AM» на экране быть не может, потому что их
 * попросту нечем нарисовать.
 *
 * --- Почему списки, а не набор руками ------------------------------------
 *
 * Начало смены — величина из распорядка, и она круглая: восемь,
 * половина девятого, девять. Набирать её цифрами не нужно, а списком
 * нельзя ввести «08:6» или «25:00» — те самые полусобранные значения, из-за
 * которых поле времени приходилось стеречь отдельной проверкой.
 *
 * Минуты идут по пять: этого хватает на любой распорядок, а список из
 * шестидесяти пунктов пришлось бы прокручивать.
 */

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, index) =>
  String(index * 5).padStart(2, "0"),
);

export function TimeField({
  value,
  onChange,
  id,
  className,
  ...rest
}: {
  /** Время как «ЧЧ:ММ». */
  value: string;
  onChange: (value: string) => void;
  /** Опознаватель первого списка: на него указывает подпись поля. */
  id?: string;
  className?: string;
  "aria-describedby"?: string;
}) {
  const [hour = "08", minute = "00"] = value.split(":");

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        id={id}
        aria-label="Часы"
        className="w-auto font-mono"
        value={hour}
        onChange={(event) => onChange(`${event.target.value}:${minute}`)}
        {...rest}
      >
        {HOURS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
      <span aria-hidden className="font-mono text-ink-muted">
        :
      </span>
      <Select
        aria-label="Минуты"
        className="w-auto font-mono"
        value={
          // Минуты вне пятиминутной сетки могли прийти из файла или из
          // прежней версии профиля. Ближайший пункт списка честнее пустого
          // поля: он и показывает, что записано, и не молчит.
          MINUTES.includes(minute)
            ? minute
            : (MINUTES.find((option) => Number(option) >= Number(minute)) ?? "55")
        }
        onChange={(event) => onChange(`${hour}:${event.target.value}`)}
      >
        {MINUTES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </div>
  );
}
