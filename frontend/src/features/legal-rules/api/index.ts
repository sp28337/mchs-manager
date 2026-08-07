/** FE041 — обёртки над эндпоинтами `legal-rules`. */

import { apiClient, type RequestOptions } from "@/lib/api-client/client";

import type {
  Action,
  DryRunResult,
  PageEnvelope,
  Rule,
  RuleCategory,
  RuleVersion,
} from "../schemas";

const BASE = "/legal-rules";

export function listRules(
  filters: { category?: RuleCategory; page?: number; pageSize?: number } = {},
  options?: RequestOptions,
): Promise<PageEnvelope<Rule>> {
  return apiClient.get<PageEnvelope<Rule>>(`${BASE}/rules`, {
    ...options,
    query: {
      category: filters.category,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });
}

export function createRule(
  input: {
    code: string;
    category: RuleCategory;
    displayName: string;
    description?: string;
  },
  context: RequestOptions & { idempotencyKey: string },
): Promise<Rule> {
  return apiClient.post<Rule>(`${BASE}/rules`, input, context);
}

export function listRuleVersions(
  ruleId: string,
  options?: RequestOptions,
): Promise<RuleVersion[]> {
  return apiClient.get<RuleVersion[]>(`${BASE}/rules/${ruleId}/versions`, options);
}

export interface CreateRuleVersionInput {
  scope: Record<string, string>;
  legalBasisNodeId: string;
  actions: Action[];
  validFrom: string;
  validTo?: string | null;
}

export function createRuleVersion(
  ruleId: string,
  input: CreateRuleVersionInput,
  context: RequestOptions & { idempotencyKey: string },
): Promise<RuleVersion> {
  return apiClient.post<RuleVersion>(`${BASE}/rules/${ruleId}/versions`, input, context);
}

export function publishRuleVersion(
  versionId: string,
  input: { changeReason: string },
  context: RequestOptions & { idempotencyKey: string },
): Promise<RuleVersion> {
  return apiClient.post<RuleVersion>(
    `${BASE}/rule-versions/${versionId}/publish`,
    input,
    context,
  );
}

/**
 * Пробный прогон черновика по историческому периоду.
 *
 * Сравнивает черновик с ДЕЙСТВУЮЩЕЙ версией того же правила на реальных
 * данных: это единственный способ узнать, что изменит публикация, до
 * того как она станет необратимой.
 */
export function dryRunRuleVersion(
  versionId: string,
  input: {
    historicalPeriodStart: string;
    historicalPeriodEnd: string;
    sampleSize: number;
  },
  context: RequestOptions & { idempotencyKey?: string },
): Promise<DryRunResult> {
  return apiClient.post<DryRunResult>(
    `${BASE}/rule-versions/${versionId}/dry-run`,
    input,
    context,
  );
}
