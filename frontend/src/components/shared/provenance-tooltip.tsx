"use client";

import Link from "next/link";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

/**
 * FE014 — ПРАВОВОЙ СЛЕД. Подпись этого интерфейса.
 *
 * DoD: «наведение на число показывает `usedRuleVersionId` и ссылку на
 * Source».
 *
 * --- Зачем это вообще ---------------------------------------------------
 *
 * Каждое вычисленное число в системе — юридическое утверждение о времени
 * человека. Табельщик, командир и проверяющий смотрят на одну и ту же
 * цифру, и первый вопрос у всех троих один: «откуда она». Domain Model
 * называет это провенансом и делает инвариантом (6.1.5): расчёт обязан
 * ссылаться на версию правила, по которой выполнен.
 *
 * Интерфейс, который показывает результат без основания, теряет
 * единственное, ради чего система построена. Поэтому вычисленное число
 * ВЫГЛЯДИТ ИНАЧЕ, чем записанное: пунктирное подчёркивание цвета `trace`
 * отделяет выведенное от внесённого ещё до того, как человек наведёт
 * курсор.
 *
 * --- Почему `button`, а не `span` --------------------------------------
 *
 * Подсказка обязана открываться с клавиатуры. `span` с `title` не
 * фокусируется, а `tabIndex` на неинтерактивном элементе — обещание,
 * которого разметка не выполняет. Кнопка без рамки решает и то и другое
 * (WCAG 2.2, 1.4.13 Content on Hover or Focus: содержимое, доступное по
 * наведению, обязано быть доступно и по фокусу).
 */
export interface ProvenanceTooltipProps {
  /** Отображаемое значение — число, срок, категория. */
  children: React.ReactNode;
  /** `usedRuleVersionId` расчёта. */
  ruleVersionId: string;
  /** Код правила, если известен: `NORM.WEEKLY_HOURS`. */
  ruleCode?: string;
  /** Человекочитаемая норма-основание: «ФЗ-141 ст. 55 ч. 2». */
  legalBasis?: string;
  /** Дата, на которую версия действовала. */
  effectiveOn?: string;
  className?: string;
}

export function ProvenanceTooltip({
  children,
  ruleVersionId,
  ruleCode,
  legalBasis,
  effectiveOn,
  className,
}: ProvenanceTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn("legal-trace bg-transparent p-0 text-inherit", className)}
          aria-label={
            legalBasis
              ? `Значение рассчитано по норме ${legalBasis}. Открыть основание.`
              : "Значение рассчитано. Открыть основание расчёта."
          }
        >
          {children}
        </button>
      </TooltipTrigger>

      <TooltipContent className="space-y-2">
        <p className="font-display text-xs font-bold uppercase tracking-wide text-trace">
          Основание расчёта
        </p>

        <dl className="space-y-1">
          {legalBasis ? (
            <div>
              <dt className="sr-only">Норма</dt>
              <dd className="text-sm text-ink">{legalBasis}</dd>
            </div>
          ) : null}

          {ruleCode ? (
            <div className="flex gap-2">
              <dt className="text-ink-faint">Правило</dt>
              <dd className="font-mono">{ruleCode}</dd>
            </div>
          ) : null}

          {effectiveOn ? (
            <div className="flex gap-2">
              <dt className="text-ink-faint">Действует на</dt>
              <dd className="font-mono">{effectiveOn}</dd>
            </div>
          ) : null}

          <div className="flex gap-2">
            <dt className="text-ink-faint">Версия</dt>
            <dd className="font-mono text-[11px] break-all">{ruleVersionId}</dd>
          </div>
        </dl>

        <Link
          href={`/legal-rules/rule-versions/${ruleVersionId}`}
          className="inline-block text-trace underline underline-offset-2"
        >
          Открыть норму
        </Link>
      </TooltipContent>
    </Tooltip>
  );
}
