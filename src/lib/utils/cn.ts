import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Слияние классов Tailwind: последний выигрывает по конфликтующей группе. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
