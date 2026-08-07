"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client/client";

import { createRuleVersion } from "../api";
import { KNOWN_RESULT_FIELDS, type Action, type Formula, type Rule } from "../schemas";
import { FormulaTreeBuilder, literalZero, validateFormula } from "./formula-tree-builder";

/**
 * FE043 — черновик новой редакции правила.
 *
 * DoD: «флоу создания черновика доступен без ручного редактирования
 * JSON».
 *
 * --- Что здесь обязательно и почему -------------------------------------
 *
 * `legalBasisNodeId` — ссылка на пункт нормативного акта, и сервер
 * отвергает версию без неё. Это не формальность: правило без указания, из
 * какого пункта какого приказа оно выведено, невозможно проверить, а весь
 * модуль существует ради проверяемости. Поле подписано так, чтобы это
 * было ясно до отправки.
 *
 * `validFrom` — дата начала действия РЕДАКЦИИ, а не дата издания.
 * Редакция, изданная в июне, может действовать с января, и путаница
 * между этими датами меняет результат перерасчёта за первое полугодие.
 *
 * --- Черновик, а не публикация -----------------------------------------
 *
 * Форма создаёт только черновик. Публикация — отдельное действие, и
 * между ними стоит пробный прогон: узнать, что изменит новая редакция, до
 * того как изменение станет необратимым. Совместить их одной кнопкой
 * значило бы сделать прогон необязательным на практике.
 */

export interface RuleVersionFormProps {
  rule: Rule;
  token?: string | null;
  onCreated?: () => void;
}

export function RuleVersionForm({ rule, token, onCreated }: RuleVersionFormProps) {
  const router = useRouter();
  const basisId = useId();
  const fromId = useId();
  const toId = useId();
  const scopeId = useId();
  const fieldId = useId();
  const fieldsListId = useId();

  const [field, setField] = useState("norm_hours");
  const [formula, setFormula] = useState<Formula>(literalZero());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const action: Action = { node_type: "set_result", field, formula };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const found = [
      ...(field.trim() ? [] : ["Не указано поле результата"]),
      ...validateFormula(formula),
    ];
    setProblems(found);
    if (found.length > 0) return;

    setPending(true);
    setError(null);
    try {
      await createRuleVersion(
        rule.id,
        {
          scope: textToScope(String(form.get("scope") ?? "")),
          legalBasisNodeId: String(form.get("legalBasisNodeId") ?? "").trim(),
          actions: [action],
          validFrom: String(form.get("validFrom") ?? ""),
          validTo: String(form.get("validTo") ?? "") || null,
        },
        { token, idempotencyKey: crypto.randomUUID() },
      );
      toast.success("Черновик редакции создан");
      onCreated?.();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError({
              type: "about:blank",
              title: "Сервер недоступен",
              status: 0,
              detail: "Не удалось создать черновик редакции.",
            }),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {error ? <ErrorPanel error={error} /> : null}

      {problems.length > 0 ? (
        <div
          role="alert"
          className="space-y-1 rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm"
        >
          <p className="font-medium">Редакцию нельзя сохранить:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={basisId}>Пункт нормативного акта</Label>
          <Input
            id={basisId}
            name="legalBasisNodeId"
            required
            placeholder="UUID узла документа"
            className="w-80 font-mono text-sm"
            aria-describedby={`${basisId}-hint`}
          />
          <p id={`${basisId}-hint`} className="max-w-80 text-xs text-ink-muted">
            Правило без ссылки на пункт акта проверить невозможно — сервер такую
            редакцию не примет.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={scopeId}>Область действия</Label>
          <Input
            id={scopeId}
            name="scope"
            placeholder="category=normal"
            className="w-72 font-mono text-sm"
            aria-describedby={`${scopeId}-hint`}
          />
          <p id={`${scopeId}-hint`} className="max-w-72 text-xs text-ink-muted">
            Пары `ключ=значение` через запятую. Пусто — правило применяется ко
            всем.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={fromId}>Действует с</Label>
          <Input id={fromId} name="validFrom" type="date" required className="w-44" />
          <p className="max-w-44 text-xs text-ink-muted">
            Дата начала действия редакции, а не дата её издания.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={toId}>Действует по</Label>
          <Input id={toId} name="validTo" type="date" className="w-44" />
          <p className="max-w-44 text-xs text-ink-muted">
            Пусто — бессрочно. Публикация следующей редакции закроет эту сама.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={fieldId}>Поле результата</Label>
          <Input
            id={fieldId}
            list={fieldsListId}
            value={field}
            onChange={(event) => setField(event.target.value)}
            className="w-64 font-mono text-sm"
          />
          <datalist id={fieldsListId}>
            {KNOWN_RESULT_FIELDS.map((known) => (
              <option key={known.field} value={known.field}>
                {known.note}
              </option>
            ))}
          </datalist>
          <p className="max-w-64 text-xs text-ink-muted">
            {KNOWN_RESULT_FIELDS.find((known) => known.field === field)?.note ??
              "Имя вне списка сервер примет, но расчёт его не прочитает."}
          </p>
        </div>
      </div>

      <section aria-labelledby="formula-heading" className="space-y-2">
        <h3
          id="formula-heading"
          className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted"
        >
          Формула
        </h3>
        <FormulaTreeBuilder value={formula} onChange={setFormula} />
      </section>

      <details className="rounded-sm border border-rule bg-paper-sunken px-4 py-3">
        <summary className="cursor-pointer text-sm text-ink-muted">
          Показать, что уйдёт на сервер
        </summary>
        {/* JSON показывается, но не редактируется. Юрист имеет право
            увидеть, что подписывает; вводить это руками он не обязан. */}
        <pre className="mt-2 overflow-x-auto font-mono text-xs">
          {JSON.stringify([action], null, 2)}
        </pre>
      </details>

      <Button type="submit" disabled={pending}>
        {pending ? "Сохранение…" : "Создать черновик редакции"}
      </Button>
    </form>
  );
}

function textToScope(text: string): Record<string, string> {
  const scope: Record<string, string> = {};
  for (const pair of text.split(",")) {
    const [key, ...rest] = pair.split("=");
    const name = key?.trim();
    if (!name) continue;
    scope[name] = rest.join("=").trim();
  }
  return scope;
}
