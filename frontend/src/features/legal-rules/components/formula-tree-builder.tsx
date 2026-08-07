"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

import {
  FORMULA_NODE_LABELS,
  KNOWN_FUNCTIONS,
  type ArithmeticOperator,
  type Condition,
  type Formula,
  type FormulaNodeType,
} from "../schemas";
import {
  ConditionTreeBuilder,
  DEFAULT_VARIABLES,
  emptyLeaf,
  validateCondition,
} from "./condition-tree-builder";

/**
 * FE042 — конструктор дерева `Formula`.
 *
 * DoD: «конструктор поддерживает все типы узлов Formula, включая
 * `rule_reference`».
 *
 * Все шесть: `literal`, `variable`, `operator`, `function`,
 * `conditional`, `rule_reference`. Последний назван в требовании отдельно
 * не случайно — он единственный, который выходит за пределы текущего
 * расчёта: формула ссылается на РЕЗУЛЬТАТ другого правила, разрешаемый
 * через Version Resolver на ту же дату. Без него норму периода нельзя
 * выразить через недельную норму, не переписав её заново, — и две копии
 * одной нормы разошлись бы при первом же изменении закона.
 *
 * --- Смена типа узла сохраняет, что можно ------------------------------
 *
 * При переключении с `operator` на `function` аргументы остаются: и то и
 * другое — вычисление над списком, и заставлять юриста набирать их
 * заново значило бы наказывать за исправление выбора. При переходе к
 * `literal` они теряются, потому что константа аргументов не имеет, и
 * прятать их «на всякий случай» означало бы хранить невидимое состояние.
 *
 * --- Об `as_of` в ссылке на правило ------------------------------------
 *
 * Поле необязательное, и умолчание существенно: пустое значение означает
 * «на дату расчёта», а не «сегодня». Норма берётся на дату события
 * (Алгоритм 0.2), поэтому перерасчёт марта обязан взять мартовскую
 * редакцию — фиксированная дата здесь нужна лишь там, где норма прямо
 * ссылается на конкретную редакцию другой нормы.
 */

export interface FormulaTreeBuilderProps {
  value: Formula;
  onChange: (next: Formula) => void;
  variables?: readonly string[];
  onRemove?: () => void;
  className?: string;
}

const NODE_TYPES = Object.keys(FORMULA_NODE_LABELS) as FormulaNodeType[];
const ARITHMETIC: ArithmeticOperator[] = ["+", "-", "*", "/"];

export function literalZero(): Formula {
  return { node_type: "literal", value: 0 };
}

function convert(current: Formula, target: FormulaNodeType): Formula {
  const args =
    current.node_type === "operator" || current.node_type === "function" ? current.args : [];

  switch (target) {
    case "literal":
      return { node_type: "literal", value: 0 };
    case "variable":
      return { node_type: "variable", name: "" };
    case "operator":
      return {
        node_type: "operator",
        op: "+",
        // `operator` требует минимум двух аргументов (`min_length=2`).
        args: args.length >= 2 ? args : [literalZero(), literalZero()],
      };
    case "function":
      return { node_type: "function", function_name: "min", args };
    case "conditional":
      return {
        node_type: "conditional",
        condition: emptyLeaf(),
        then_branch: literalZero(),
        else_branch: literalZero(),
      };
    case "rule_reference":
      return { node_type: "rule_reference", rule_code: "", scope: {}, as_of: null };
  }
}

export function FormulaTreeBuilder({
  value,
  onChange,
  variables = DEFAULT_VARIABLES,
  onRemove,
  className,
}: FormulaTreeBuilderProps) {
  const typeId = useId();
  const fieldId = useId();
  const listId = useId();

  return (
    <div className={cn("space-y-3 rounded-sm border border-rule bg-paper p-3", className)}>
      {/* `items-start`: у части полей под ними есть пояснение, и
          выравнивание по нижнему краю опустило бы подписи соседних полей
          на разные строки. Подписи стоят в один ряд — по ним глаз и
          находит нужное поле. */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={typeId}>Узел</Label>
          <select
            id={typeId}
            value={value.node_type}
            onChange={(event) => onChange(convert(value, event.target.value as FormulaNodeType))}
            className="block h-9 w-56 rounded-xs border border-rule-strong bg-paper px-2 text-sm"
          >
            {NODE_TYPES.map((type) => (
              <option key={type} value={type}>
                {FORMULA_NODE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        {value.node_type === "literal" ? (
          <div className="space-y-1.5">
            <Label htmlFor={fieldId}>Значение</Label>
            <Input
              id={fieldId}
              value={String(value.value)}
              className="w-56 font-mono text-sm"
              aria-describedby={`${fieldId}-hint`}
              onChange={(event) => {
                const raw = event.target.value;
                // Порядок разбора повторяет серверный (`bool | float | str`):
                // иначе `true` уехало бы на сервер как 1, а форма
                // компенсации — как строка «0».
                const parsed: boolean | number | string =
                  raw === "true"
                    ? true
                    : raw === "false"
                      ? false
                      : raw !== "" && !Number.isNaN(Number(raw))
                        ? Number(raw)
                        : raw;
                onChange({ node_type: "literal", value: parsed });
              }}
            />
            <p id={`${fieldId}-hint`} className="max-w-56 text-xs text-ink-muted">
              Число, `true`/`false` или строка — например, форма компенсации
              `additional_rest_time`.
            </p>
          </div>
        ) : null}

        {value.node_type === "variable" ? (
          <div className="space-y-1.5">
            <Label htmlFor={fieldId}>Имя переменной</Label>
            <Input
              id={fieldId}
              list={listId}
              value={value.name}
              placeholder="working_days_count"
              className="w-64 font-mono text-sm"
              onChange={(event) => onChange({ ...value, name: event.target.value })}
            />
            <datalist id={listId}>
              {[
                "working_days_count",
                "pre_holiday_days_count",
                "weekly_norm_hours",
                "fact_hours",
                "norm_hours",
                ...variables,
              ].map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        ) : null}

        {value.node_type === "operator" ? (
          <div className="space-y-1.5">
            <Label htmlFor={fieldId}>Операция</Label>
            <select
              id={fieldId}
              value={value.op}
              onChange={(event) =>
                onChange({ ...value, op: event.target.value as ArithmeticOperator })
              }
              className="block h-9 w-24 rounded-xs border border-rule-strong bg-paper px-2 text-center font-mono text-sm"
            >
              {ARITHMETIC.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {value.node_type === "function" ? (
          <div className="space-y-1.5">
            <Label htmlFor={fieldId}>Функция</Label>
            <select
              id={fieldId}
              value={value.function_name}
              onChange={(event) => onChange({ ...value, function_name: event.target.value })}
              className="block h-9 w-56 rounded-xs border border-rule-strong bg-paper px-2 font-mono text-sm"
              aria-describedby={`${fieldId}-hint`}
            >
              {KNOWN_FUNCTIONS.map((fn) => (
                <option key={fn.name} value={fn.name}>
                  {fn.name} — {fn.note}
                </option>
              ))}
            </select>
            <p id={`${fieldId}-hint`} className="max-w-56 text-xs text-ink-muted">
              Реестр функций на сервере фиксирован: имени вне списка движок не
              найдёт.
            </p>
          </div>
        ) : null}

        {onRemove ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-[1.375rem]"
            onClick={onRemove}
          >
            Убрать
          </Button>
        ) : null}
      </div>

      {value.node_type === "rule_reference" ? (
        <RuleReferenceFields value={value} onChange={onChange} />
      ) : null}

      {value.node_type === "operator" || value.node_type === "function" ? (
        <ArgumentList
          args={value.args}
          variables={variables}
          minimum={value.node_type === "operator" ? 2 : arityMinimum(value.function_name)}
          onChange={(args) => onChange({ ...value, args } as Formula)}
        />
      ) : null}

      {value.node_type === "conditional" ? (
        <div className="space-y-3 border-t border-rule pt-3">
          <Branch label="Если выполняется">
            <ConditionTreeBuilder
              value={value.condition}
              variables={variables}
              onChange={(condition: Condition) => onChange({ ...value, condition })}
            />
          </Branch>
          <Branch label="то">
            <FormulaTreeBuilder
              value={value.then_branch}
              variables={variables}
              onChange={(then_branch) => onChange({ ...value, then_branch })}
            />
          </Branch>
          <Branch label="иначе">
            <FormulaTreeBuilder
              value={value.else_branch}
              variables={variables}
              onChange={(else_branch) => onChange({ ...value, else_branch })}
            />
          </Branch>
        </div>
      ) : null}
    </div>
  );
}

function arityMinimum(functionName: string): number {
  return functionName === "min" || functionName === "max" ? 2 : 1;
}

function Branch({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

function ArgumentList({
  args,
  minimum,
  variables,
  onChange,
}: {
  args: Formula[];
  minimum: number;
  variables: readonly string[];
  onChange: (args: Formula[]) => void;
}) {
  return (
    <div className="space-y-2 border-t border-rule pt-3">
      <div className="flex items-center gap-3">
        <p className="font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
          Аргументы
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...args, literalZero()])}
        >
          Добавить
        </Button>
        {args.length < minimum ? (
          <p className="text-xs text-signal">
            Нужно не меньше {minimum}: сейчас {args.length}.
          </p>
        ) : null}
      </div>

      <ol className="space-y-2">
        {args.map((arg, index) => (
          <li key={index} className="flex gap-2">
            <span
              aria-hidden
              className="mt-3 w-4 shrink-0 text-right font-mono text-xs text-ink-faint"
            >
              {index + 1}
            </span>
            <FormulaTreeBuilder
              className="min-w-0 flex-1"
              value={arg}
              variables={variables}
              onChange={(next) => {
                const copy = [...args];
                copy[index] = next;
                onChange(copy);
              }}
              onRemove={
                args.length > minimum
                  ? () => onChange(args.filter((_, i) => i !== index))
                  : undefined
              }
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function RuleReferenceFields({
  value,
  onChange,
}: {
  value: Extract<Formula, { node_type: "rule_reference" }>;
  onChange: (next: Formula) => void;
}) {
  const codeId = useId();
  const scopeId = useId();
  const asOfId = useId();

  return (
    <div className="flex flex-wrap items-start gap-3 border-t border-rule pt-3">
      <div className="space-y-1.5">
        <Label htmlFor={codeId}>Код правила</Label>
        <Input
          id={codeId}
          value={value.rule_code}
          placeholder="NORM.WEEKLY"
          className="w-64 font-mono text-sm"
          onChange={(event) => onChange({ ...value, rule_code: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={scopeId}>Область действия</Label>
        <Input
          id={scopeId}
          value={scopeToText(value.scope)}
          placeholder="category=normal"
          className="w-72 font-mono text-sm"
          aria-describedby={`${scopeId}-hint`}
          onChange={(event) => onChange({ ...value, scope: textToScope(event.target.value) })}
        />
        <p id={`${scopeId}-hint`} className="max-w-72 text-xs text-ink-muted">
          Пары `ключ=значение` через запятую. Пусто — та же область, что у
          текущего расчёта.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={asOfId}>На дату</Label>
        <Input
          id={asOfId}
          type="date"
          value={value.as_of ?? ""}
          className="w-44"
          aria-describedby={`${asOfId}-hint`}
          onChange={(event) => onChange({ ...value, as_of: event.target.value || null })}
        />
        <p id={`${asOfId}-hint`} className="max-w-44 text-xs text-ink-muted">
          Пусто — на дату события, как требует Алгоритм 0.2. Заполняйте только
          при прямой ссылке на конкретную редакцию.
        </p>
      </div>
    </div>
  );
}

function scopeToText(scope: Record<string, string>): string {
  return Object.entries(scope)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
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

/**
 * Незаполненные места формулы — до отправки, а не после отказа сервера.
 *
 * Проверяется то же, что проверит сервер, и теми же словами, какими
 * задан вопрос на экране: «функция `min`: нужно не меньше 2 аргументов»
 * вместо `actions.0.formula.args: List should have at least 2 items`.
 */
export function validateFormula(formula: Formula, path = "формула"): string[] {
  switch (formula.node_type) {
    case "literal":
      return String(formula.value).trim() === "" ? [`${path}: пустая константа`] : [];
    case "variable":
      return formula.name.trim() ? [] : [`${path}: не указано имя переменной`];
    case "operator": {
      const problems =
        formula.args.length < 2 ? [`${path}: операция требует не меньше 2 аргументов`] : [];
      return [
        ...problems,
        ...formula.args.flatMap((arg, index) =>
          validateFormula(arg, `${path} → аргумент ${index + 1}`),
        ),
      ];
    }
    case "function": {
      const minimum = arityMinimum(formula.function_name);
      const problems =
        formula.args.length < minimum
          ? [`${path}: функция ${formula.function_name} требует не меньше ${minimum} аргументов`]
          : [];
      return [
        ...problems,
        ...formula.args.flatMap((arg, index) =>
          validateFormula(arg, `${path} → аргумент ${index + 1}`),
        ),
      ];
    }
    case "conditional":
      return [
        ...validateCondition(formula.condition, `${path} → условие`),
        ...validateFormula(formula.then_branch, `${path} → то`),
        ...validateFormula(formula.else_branch, `${path} → иначе`),
      ];
    case "rule_reference":
      return formula.rule_code.trim() ? [] : [`${path}: не указан код правила`];
  }
}
