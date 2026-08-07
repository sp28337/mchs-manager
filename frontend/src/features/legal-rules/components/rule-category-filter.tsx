"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { RULE_CATEGORY_BASIS, RULE_CATEGORY_LABELS, type RuleCategory } from "../schemas";

/** Фильтр по категории правила. Как везде — в URL. */
export function RuleCategoryFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectId = useId();

  const current = searchParams.get("category") ?? "";
  const categories = Object.keys(RULE_CATEGORY_LABELS) as RuleCategory[];

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-sm border border-rule bg-paper-raised p-4">
      <div className="space-y-1.5">
        <Label htmlFor={selectId}>Категория</Label>
        <select
          id={selectId}
          value={current}
          onChange={(event) => {
            const next = new URLSearchParams(searchParams.toString());
            if (event.target.value) next.set("category", event.target.value);
            else next.delete("category");
            next.delete("page");
            router.push(`?${next.toString()}`, { scroll: false });
          }}
          className="block h-9 w-80 rounded-xs border border-rule-strong bg-paper px-2 text-sm"
          aria-describedby={`${selectId}-hint`}
        >
          <option value="">Все категории</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {RULE_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        {current ? (
          <p id={`${selectId}-hint`} className="max-w-80 text-xs text-ink-muted">
            {RULE_CATEGORY_BASIS[current as RuleCategory]}
          </p>
        ) : null}
      </div>

      {current ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-[1.375rem]"
          onClick={() => router.push("?", { scroll: false })}
        >
          Сбросить
        </Button>
      ) : null}
    </div>
  );
}
