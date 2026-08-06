import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceTooltip } from "@/components/shared/provenance-tooltip";
import { getServerSession } from "@/lib/auth/server";
import { navigationFor } from "@/lib/auth/navigation";
import { ROLE_LABELS } from "@/lib/auth/session";
import Link from "next/link";

export const metadata: Metadata = { title: "Обзор — Учёт служебного времени ФПС ГПС" };

/**
 * Ролевая точка входа.
 *
 * Server Component: набор виджетов зависит от ролей, а роли известны на
 * сервере. Отдавать их браузеру, чтобы он решил, что показать, значило бы
 * послать по сети список того, чего человек не увидит.
 *
 * --- О содержимом --------------------------------------------------------
 *
 * Пока здесь навигационная сводка, а не показатели: данные приходят из
 * эндпоинтов, которые ещё никто не вызывает (FE017 и далее), и рисовать
 * вместо них правдоподобные числа было бы хуже пустоты. Пустой экран
 * виден, выдуманный — нет.
 *
 * Единственное настоящее число на экране — демонстрация правового следа:
 * норма 40 часов приходит из версии правила, и подчёркивание показывает,
 * что это ВЫВЕДЕННАЯ величина, а не введённая.
 */
export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session) return null;

  const sections = navigationFor(session.roles);
  const roles = session.roles.map((role) => ROLE_LABELS[role]);

  return (
    <>
      <PageHeader
        eyebrow={session.fullName}
        title="Обзор"
        description={
          roles.length > 0
            ? `Доступные разделы определены ролями: ${roles.join(", ").toLowerCase()}.`
            : "Роли не назначены — обратитесь к администратору системы."
        }
      />

      <section className="rounded-sm border border-rule bg-paper-raised p-5">
        <h2 className="text-base">Норма служебного времени</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Пример правового следа: подчёркнутое число выведено расчётом, и его
          основание открывается наведением или с клавиатуры.
        </p>
        <p className="mt-4 text-3xl">
          <ProvenanceTooltip
            ruleVersionId="00000000-0000-0000-0000-000000000000"
            ruleCode="NORM.WEEKLY_HOURS"
            legalBasis="ФЗ-141 ст. 54 ч. 2"
            effectiveOn="2026-03-01"
          >
            40,00
          </ProvenanceTooltip>
          <span className="ml-2 text-base text-ink-muted">ч в неделю</span>
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-base">Разделы</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.flatMap((section) =>
            section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-sm border border-rule bg-paper-raised p-4 transition-colors hover:border-rule-strong hover:bg-paper-sunken"
              >
                <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
                  {section.title}
                </p>
                <p className="mt-1 font-display text-lg font-bold">{item.label}</p>
              </Link>
            )),
          )}
        </div>
      </section>
    </>
  );
}
