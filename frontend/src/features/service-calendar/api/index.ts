/** FE039 — обёртки над эндпоинтами `service-calendar`. */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type { CalendarDay, CalendarYear } from "../schemas";

const BASE = "/service-calendar";

export function getCalendarYear(
  year: number,
  options?: RequestOptions,
): Promise<CalendarYear> {
  return apiClient.get<CalendarYear>(`${BASE}/years/${year}`, options);
}

export function createCalendarYear(
  year: number,
  context: RequestOptions & { idempotencyKey: string },
): Promise<CalendarYear> {
  return apiClient.post<CalendarYear>(`${BASE}/years`, { year }, context);
}

/**
 * Задаёт типы дней пачкой.
 *
 * Сервер принимает до 366 дней за раз и применяет их как одно изменение.
 * Это ровно та операция, которая нужна редактору: администратор
 * размечает не день, а ДИАПАЗОН — новогодние каникулы, майские, — и
 * отправлять их по одному значило бы получить календарь, наполовину
 * размеченный, если связь оборвалась посередине.
 */
export function setCalendarDays(
  year: number,
  days: CalendarDay[],
  context: RequestOptions & { idempotencyKey: string },
): Promise<CalendarYear> {
  return apiClient.post<CalendarYear>(`${BASE}/years/${year}/days`, { days }, context);
}

export function publishCalendarYear(
  year: number,
  context: RequestOptions & { idempotencyKey: string },
): Promise<CalendarYear> {
  return apiClient.post<CalendarYear>(`${BASE}/years/${year}/publish`, undefined, context);
}
