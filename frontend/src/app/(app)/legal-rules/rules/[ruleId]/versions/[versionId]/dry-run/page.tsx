import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { listRuleVersions } from "@/features/legal-rules/api";
import { DryRunPanel } from "@/features/legal-rules/components/dry-run-panel";
import type { RuleVersion } from "@/features/legal-rules/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Пробный прогон — Учёт служебного времени" };

/**
 * FE044 — пробный прогон редакции перед публикацией (UC-01).
 *
 * Отдельная страница, а не блок на карточке правила, и это существенно:
 * прогон — самостоятельный акт проверки, у него есть параметры (период,
 * выборка) и результат, на который ссылаются. Ссылка на эту страницу
 * означает «вот что изменит редакция», и её можно приложить к
 * согласованию.
 */
export default async function DryRunPage({
  params,
}: {
  params: Promise<{ ruleId: string; versionId: string }>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const { ruleId, versionId } = await params;

  let version: RuleVersion | undefined;
  let error: ApiError | null = null;
  try {
    const versions = await listRuleVersions(ruleId, {
      token: session.token,
      cache: "no-store",
    });
    version = versions.find((candidate) => candidate.id === versionId);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) notFound();
    error =
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось получить редакцию правила.",
          });
  }

  if (!version && !error) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Пробный прогон"
        title={version ? `Редакция ${version.versionNo}` : "Редакция"}
        description="Сравнение черновика с редакцией, действовавшей в указанном периоде. Единственный способ узнать, что изменит публикация, пока она ещё обратима: после публикации редакция неизменяема, а расчёты попавших в её срок периодов меняются сами."
        actions={version ? <StatusBadge status={version.status} /> : null}
      />

      <p className="text-sm">
        <Link
          href={`/legal-rules/rules/${ruleId}`}
          className="text-trace underline underline-offset-2"
        >
          ← К правилу и его редакциям
        </Link>
      </p>

      {error ? <ErrorPanel error={error} /> : null}

      {version ? (
        <>
          <dl className="flex flex-wrap gap-x-10 gap-y-2 border-y border-rule py-3 text-sm">
            <div>
              <dt className="text-ink-muted">Действует с</dt>
              <dd className="font-mono">{formatDate(version.validFrom)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Действует по</dt>
              <dd className="font-mono">
                {version.validTo ? formatDate(version.validTo) : "бессрочно"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Область действия</dt>
              <dd className="font-mono text-xs">
                {Object.keys(version.scope).length === 0
                  ? "все"
                  : Object.entries(version.scope)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(", ")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Пункт акта</dt>
              <dd className="font-mono text-xs">{version.legalBasisNodeId}</dd>
            </div>
          </dl>

          <DryRunPanel version={version} token={session.token} />
        </>
      ) : null}
    </>
  );
}
