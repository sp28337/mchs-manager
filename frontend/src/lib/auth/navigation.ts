/**
 * Состав меню по ролям — таблица маршрутов из Frontend_Architecture
 * разд. 2, где у каждой страницы названы роли.
 *
 * Словарь один и лежит здесь, а не в компоненте сайдбара: тот же список
 * нужен и серверному layout'у (что показать), и клиенту (что подсветить),
 * и разъехавшиеся копии дали бы меню, где пункт есть, а страница
 * отвечает 403.
 */

import type { Role } from "./session";

export interface NavItem {
  href: string;
  label: string;
  /** Пустой список — доступно всем, у кого есть сессия. */
  roles: readonly Role[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    title: "Служебное время",
    items: [
      { href: "/time-accounting/my", label: "Мой табель", roles: [] },
      {
        href: "/time-accounting/timesheets",
        label: "Табели подразделения",
        roles: ["timekeeper", "unit_commander", "shift_commander"],
      },
      {
        href: "/time-accounting/dashboard",
        label: "Сводка подразделения",
        roles: ["unit_commander", "regional_commander"],
      },
    ],
  },
  {
    title: "Дежурство",
    items: [
      {
        href: "/scheduling",
        label: "Графики дежурств",
        roles: ["timekeeper", "unit_commander"],
      },
    ],
  },
  {
    title: "Компенсации и отдых",
    items: [
      { href: "/compensation/my", label: "Мои компенсации", roles: [] },
      {
        href: "/compensation/forecast",
        label: "Прогноз затрат",
        roles: ["regional_commander", "finance_specialist"],
      },
      { href: "/rest-balance/my", label: "Баланс суток отдыха", roles: [] },
      { href: "/leave/my", label: "Мои отпуска", roles: [] },
      {
        href: "/leave/grants",
        label: "Предоставление отпусков",
        roles: ["hr_specialist"],
      },
    ],
  },
  {
    title: "Справочники",
    items: [
      {
        href: "/personnel/employees",
        label: "Сотрудники",
        roles: ["hr_specialist", "unit_commander"],
      },
      {
        href: "/personnel/units",
        label: "Подразделения",
        roles: ["hr_specialist", "system_admin"],
      },
      {
        href: "/service-calendar",
        label: "Производственный календарь",
        roles: ["system_admin"],
      },
      {
        href: "/legal-rules/rules",
        label: "Нормативная база",
        roles: ["legal_officer"],
      },
    ],
  },
  {
    title: "Контроль",
    items: [{ href: "/audit/exports", label: "Выгрузки для проверки", roles: ["auditor"] }],
  },
];

/** Разделы, в которых у сессии есть хотя бы один доступный пункт. */
export function navigationFor(roles: readonly Role[]): NavSection[] {
  const permitted = (item: NavItem) =>
    item.roles.length === 0 || item.roles.some((role) => roles.includes(role));

  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter(permitted),
  })).filter((section) => section.items.length > 0);
}
