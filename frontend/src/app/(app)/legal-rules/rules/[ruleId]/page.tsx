import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { listRuleVersions, listRules } from "@/features/legal-rules/api";
import { RuleVersionForm } from "@/features/legal-rules/components/rule-version-form";
import {
  RULE_CATEGORY_BASIS,
  RULE_CATEGORY_LABELS,
  type Formula,
  type Rule,
  type RuleVersion,
} from "@/features/legal-rules/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Правило — Учёт служебного времени" };

/**
 * FE043 — правило и его редакции.
 *
 * --- Почему правило ищется в списке ------------------------------------
 *
 * `GET /legal-rules/rules/{id}` спецификацией не описан и не реализован:
 * есть список и есть действующая версия. Тождество правила (код,
 * название, категория) берётся из списка — он пагинирован, но правил в
 * системе десятки, а не тысячи, и одна страница покрывает их все.
 *
 * Отдельный эндпоинт был бы уместнее, но выдумывать его ради экрана,
 * который и так работает, значило бы расширять API без нужды. Если
 * правил станет больше страницы, это станет видно сразу — правило просто
 * не найдётся, и здесь стоит явный 404 вместо тихо пустого заголовка.
 */
export default async function RulePage({
  params,
}: {
  params: Promise<{ ruleId: string }>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const { ruleId } = await params;

  let rule: Rule | undefined;
  let versions: RuleVersion[] = [];
  let error: ApiError | null = null;

  try {
    const [catalogue, listing] = await Promise.all([
      listRules({ pageSize: 200 }, { token: session.token, cache: "no-store" }),
      listRuleVersions(ruleId, { token: session.token, cache: "no-store" }),
    ]);
    rule = catalogue.items.find((candidate) => candidate.id === ruleId);
    versions = listing;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) notFound();
    error =
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось получить правило.",
          });
  }

  if (!rule && !error) notFound();

  return (
    <>
      <PageHeader
        eyebrow={rule ? rule.code : "Правило"}
        title={rule?.displayName ?? "Правило"}
        description={
          rule
            ? `${RULE_CATEGORY_LABELS[rule.category] ?? rule.category} · ${RULE_CATEGORY_BASIS[rule.category]}`
            : undefined
        }
      />

      {error ? <ErrorPanel error={error} /> : null}

      <section aria-labelledby="versions" className="space-y-3">
        <h2
          id="versions"
          className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted"
        >
          Редакции
        </h2>

        {versions.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Редакций нет. Пока их нет, правило не применяется ни к какому расчёту:
            тождество без формулы ничего не вычисляет.
          </p>
        ) : (
          <ol className="space-y-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-sm border border-rule bg-paper px-4 py-3"
              >
                <span className="font-mono text-sm font-medium">
                  Редакция {version.versionNo}
                </span>
                <StatusBadge status={version.status} />
                <span className="text-sm">
                  {formatDate(version.validFrom)}
                  {version.validTo ? ` — ${formatDate(version.validTo)}` : " — бессрочно"}
                </span>
                <span className="text-xs text-ink-muted">
                  {Object.keys(version.scope).length === 0
                    ? "применяется ко всем"
                    : Object.entries(version.scope)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(", ")}
                </span>

                <span className="ml-auto">
                  {version.status === "draft" ? (
                    <Link
                      href={`/legal-rules/rules/${ruleId}/versions/${version.id}/dry-run`}
                      className="text-trace underline underline-offset-2"
                    >
                      Прогнать и опубликовать
                    </Link>
                  ) : (
                    <span className="text-xs text-ink-faint">
                      {version.publishedAt
                        ? `опубликована ${formatDate(version.publishedAt.slice(0, 10))}`
                        : null}
                    </span>
                  )}
                </span>

                {version.formulaDefinition ? (
                  <details className="w-full">
                    <summary className="cursor-pointer text-xs text-ink-muted">
                      Что задаёт эта редакция
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {version.formulaDefinition.map((action, index) => (
                        <li key={index} className="font-mono">
                          {action.field} = {describe(action.formula)}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {rule ? (
        <section aria-labelledby="new-version" className="space-y-3 border-t border-rule pt-6">
          <h2
            id="new-version"
            className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted"
          >
            Новая редакция
          </h2>
          <p className="max-w-prose text-sm text-ink-muted">
            Создаётся черновиком. Черновик не участвует ни в одном расчёте, пока не
            опубликован, — и опубликовать его предлагается только после пробного
            прогона.
          </p>
          <RuleVersionForm rule={rule} token={session.token} />
        </section>
      ) : null}
    </>
  );
}

/**
 * Формула одной строкой — для свёрнутого просмотра редакции.
 *
 * Это НЕ форма для правки и не полное представление: вложенные ветвления
 * читаются целиком только в конструкторе. Задача строки другая — дать
 * узнать редакцию среди соседних, не открывая её.
 */
function describe(formula: Formula): string {
  switch (formula.node_type) {
    case "literal":
      return String(formula.value);
    case "variable":
      return formula.name;
    case "operator":
      return `(${formula.args.map(describe).join(` ${formula.op} `)})`;
    case "function":
      return `${formula.function_name}(${formula.args.map(describe).join(", ")})`;
    case "conditional":
      return `если … то ${describe(formula.then_branch)} иначе ${describe(formula.else_branch)}`;
    case "rule_reference":
      return `→ ${formula.rule_code}`;
  }
}
