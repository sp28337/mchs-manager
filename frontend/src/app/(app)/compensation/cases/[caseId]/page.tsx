import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { ProvenanceTooltip } from "@/components/shared/provenance-tooltip";
import { StatusBadge } from "@/components/shared/status-badge";
import { getCase } from "@/features/compensation/api";
import { ElectionFormDialog } from "@/features/compensation/components/election-form-dialog";
import {
  HOUR_CATEGORY_BASIS,
  HOUR_CATEGORY_LABELS,
} from "@/features/compensation/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatHours, formatPeriod } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Дело о компенсации — Учёт служебного времени" };

/**
 * FE028 — карточка дела о компенсации (UC-08, UC-09).
 *
 * Категории показаны отдельными блоками, а не строками таблицы: у каждой
 * своё правовое основание и свой выбор формы, и втискивать рапорт в
 * ячейку значило бы сделать его похожим на настройку.
 */
export default async function CompensationCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const { caseId } = await params;

  let compensationCase;
  try {
    compensationCase = await getCase(caseId, { token: session.token, cache: "no-store" });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) notFound();
    return (
      <ErrorPanel
        error={
          cause instanceof ApiError
            ? cause
            : {
                type: "about:blank",
                title: "Сервер недоступен",
                status: 0,
                detail: "Не удалось получить дело. Обновите страницу.",
              }
        }
      />
    );
  }

  const locked = compensationCase.status === "finalized";

  return (
    <>
      <PageHeader
        eyebrow={`Сотрудник · ${compensationCase.employeeId}`}
        title="Дело о компенсации"
        period={formatPeriod(compensationCase.periodStart, compensationCase.periodEnd)}
        actions={<StatusBadge status={compensationCase.status} />}
      />

      {compensationCase.correctsCaseId ? (
        <p className="rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
          Дело-корректировка: исправляет ранее финализированное начисление.
          Исходное дело сохранено целиком — исправление оформляется новым делом,
          а не правкой прежнего.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {compensationCase.lines.map((line) => (
          <section
            key={line.id}
            className="space-y-3 rounded-sm border border-rule bg-paper-raised p-5"
          >
            <header className="space-y-1">
              <h2 className="text-base">
                {HOUR_CATEGORY_LABELS[line.hourCategory] ?? line.hourCategory}
              </h2>
              <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
                {HOUR_CATEGORY_BASIS[line.hourCategory]}
              </p>
            </header>

            <p className="text-3xl">
              <ProvenanceTooltip
                ruleVersionId={line.legalBasisRuleVersionId}
                ruleCode="COMPENSATION.COEFFICIENT"
                legalBasis={HOUR_CATEGORY_BASIS[line.hourCategory]}
                effectiveOn={compensationCase.periodEnd}
              >
                {formatHours(line.hoursAmount)}
              </ProvenanceTooltip>
              <span className="ml-2 font-sans text-base text-ink-muted">ч</span>
            </p>

            <ElectionFormDialog
              caseId={compensationCase.id}
              line={line}
              token={session.token}
              locked={locked}
            />
          </section>
        ))}
      </div>

      {compensationCase.lines.length === 0 ? (
        <p className="text-sm text-ink-muted">
          В деле нет строк начисления. Дело без строк не финализируется: «компенсация
          определена окончательно и равна ничему» неотличимо от «расчёт не выполнялся».
        </p>
      ) : null}
    </>
  );
}
