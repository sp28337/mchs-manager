import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorPanel } from "@/components/shared/error-panel";
import { PageHeader } from "@/components/shared/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listRules } from "@/features/legal-rules/api";
import { RuleCategoryFilter } from "@/features/legal-rules/components/rule-category-filter";
import {
  RULE_CATEGORY_BASIS,
  RULE_CATEGORY_LABELS,
  type Rule,
  type RuleCategory,
} from "@/features/legal-rules/schemas";
import { ApiError } from "@/lib/api-client/client";
import { getServerSession } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Нормативная база — Учёт служебного времени" };

const PAGE_SIZE = 50;

/**
 * FE043 — правила расчёта (UC-01).
 *
 * --- Что такое «правило» на этом экране --------------------------------
 *
 * Не формула, а ТОЖДЕСТВО нормы: код, категория, название. Формулы живут
 * в редакциях, и у одного правила их столько, сколько раз менялся закон.
 * Разделение не техническое: перерасчёт марта обязан взять мартовскую
 * редакцию, и правило, у которого «формула» одна, такой вопрос сделало бы
 * неразрешимым.
 *
 * Поэтому список показывает основание категории рядом с названием: юрист,
 * ищущий, где закреплены 42 часа междусменного отдыха, находит правило по
 * норме, а не по придуманному кем-то коду.
 */
export default async function LegalRulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (!session) return null;

  const params = await searchParams;
  const category =
    typeof params.category === "string" ? (params.category as RuleCategory) : undefined;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  let envelope: Awaited<ReturnType<typeof listRules>> | null = null;
  let error: ApiError | null = null;
  try {
    envelope = await listRules(
      { category, page, pageSize: PAGE_SIZE },
      { token: session.token, cache: "no-store" },
    );
  } catch (cause) {
    error =
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось получить список правил.",
          });
  }

  const rules: Rule[] = envelope?.items ?? [];

  return (
    <>
      <PageHeader
        title="Нормативная база"
        description="Правило — это тождество нормы; её редакции хранят формулы и даты действия. Расчёт за период берёт редакцию, действовавшую на дату события, поэтому прошлые редакции не удаляются никогда."
      />

      <RuleCategoryFilter />

      {error ? <ErrorPanel error={error} /> : null}

      {!error && rules.length === 0 ? (
        <EmptyState
          title={category ? "В этой категории правил нет" : "Правил нет"}
          description={
            category
              ? "Снимите фильтр, чтобы увидеть остальные."
              : "Правила заводит юрист: код, категория и название, затем — первая редакция со ссылкой на пункт акта."
          }
        />
      ) : null}

      {rules.length > 0 ? (
        <Table caption="Правила расчёта">
          <TableHeader>
            <TableRow>
              <TableHead>Код</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Категория и основание</TableHead>
              <TableHead>Редакции</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-mono text-xs">{rule.code}</TableCell>
                <TableCell>
                  <Link
                    href={`/legal-rules/rules/${rule.id}`}
                    className="text-trace underline underline-offset-2"
                  >
                    {rule.displayName}
                  </Link>
                  {rule.description ? (
                    <p className="max-w-prose text-xs text-ink-muted">{rule.description}</p>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">
                  {RULE_CATEGORY_LABELS[rule.category] ?? rule.category}
                  <span className="block text-xs text-ink-muted">
                    {RULE_CATEGORY_BASIS[rule.category]}
                  </span>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/legal-rules/rules/${rule.id}`}
                    className="text-trace underline underline-offset-2"
                  >
                    Открыть
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {envelope && envelope.totalCount > rules.length ? (
        <p className="text-sm text-ink-muted">
          Показано {rules.length} из {envelope.totalCount}.
        </p>
      ) : null}
    </>
  );
}
