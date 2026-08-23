import { CalendarDays } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Кнопка в расчёт. Одна деталь на обе: в шапке она меньше, на первом
 * экране крупнее, но разъехаться формой или цветом им нельзя — это одна
 * и та же дверь.
 *
 * Лежит отдельным файлом, а не в самой странице, потому что надпись на
 * ней решает `HeroCta` — а он читает хранилище и потому работает в
 * браузере. Кнопка при этом остаётся обычной: ни состояния, ни эффектов у
 * неё нет, и в шапку она попадает прямо из серверной разметки.
 */
export function ToCalculator({
  children,
  size = "md",
}: {
  children: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <Link href="/calculator" className={ctaClass(size)}>
      <CtaIcon size={size} />
      {children}
    </Link>
  );
}

/**
 * Значок кнопки — тот же, что у графика в переключателе сеток.
 *
 * Кнопка ведёт к сетке месяцев, и значок называет её тем же рисунком, что
 * стоит над самой сеткой внутри. Совпадение здесь не украшение: человек,
 * попавший внутрь, узнаёт кнопку, которой пришёл.
 *
 * `aria-hidden` обязателен: значок повторяет надпись рядом, и без него
 * программа чтения произносит кнопку дважды.
 */
export function CtaIcon({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <CalendarDays
      aria-hidden
      className={cn("shrink-0", size === "sm" ? "size-4" : "size-5")}
    />
  );
}

/**
 * Вид кнопки первого экрана — отдельно от неё самой.
 *
 * У кнопки два поведения: у того, кто уже завёл график, она ссылка в
 * расчёт; у того, кто здесь впервые, — кнопка, открывающая окно на месте.
 * Это разные элементы разметки (`a` и `button`), и разъехаться видом им
 * нельзя: человек нажимает одно и то же место, и одинаковость здесь —
 * обещание, что за ней одно и то же.
 */
export function ctaClass(size: "sm" | "md" = "md"): string {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-ink font-bold text-paper no-underline",
    "hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
    size === "sm" ? "h-9 px-4 text-sm" : "h-11 px-6 text-base",
  );
}
