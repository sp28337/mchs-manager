"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

import {
  COMPARISON_LABELS,
  LOGICAL_LABELS,
  type ComparisonOperator,
  type CompositeCondition,
  type Condition,
  type LeafCondition,
  type LogicalOperator,
} from "../schemas";

/**
 * FE041 — конструктор дерева `Condition`.
 *
 * DoD: «конструктор собирает дерево Condition, экспортирует валидный
 * JSON».
 *
 * --- Почему конструктор, а не поле для JSON -----------------------------
 *
 * Условие применения нормы — это текст закона, переведённый в машинную
 * форму, и переводит его юрист, а не программист. Поле с JSON требует от
 * него помнить имена узлов, порядок ключей и правило «`not` — унарный», а
 * ошибку показывает не здесь, а при расчёте табеля месяцем позже.
 *
 * Конструктор делает недопустимые состояния непредставимыми: `not`
 * физически не принимает второе условие, оператор выбирается из списка,
 * а имя переменной подсказывается. Это и есть смысл требования «без
 * ручного редактирования JSON».
 *
 * --- Об управляемом компоненте ------------------------------------------
 *
 * Дерево целиком приходит сверху и целиком уходит наверх при каждом
 * изменении: своего состояния у конструктора нет. Иначе значение,
 * показанное на экране, и значение, которое уйдёт на сервер, — две разные
 * вещи, и расхождение между ними обнаружится после публикации.
 *
 * --- О `value` ----------------------------------------------------------
 *
 * Значение сравнения вводится текстом и разбирается: `true`/`false` — в
 * булево, число — в число, список через запятую (для `in`/`not_in`) — в
 * массив, остальное — строка. Так сделано потому, что scope нормы
 * оперирует и перечислениями («normal», «hazardous_or_dangerous»), и
 * числами (стаж), и признаками, а заставлять юриста выбирать тип
 * значения из выпадающего списка значило бы задать вопрос, ответ на
 * который виден из самого значения.
 */

export interface ConditionTreeBuilderProps {
  value: Condition;
  onChange: (next: Condition) => void;
  /** Имена переменных, доступных в контексте расчёта. */
  variables?: readonly string[];
  /** Глубина — для отступа и заголовков; снаружи не задаётся. */
  depth?: number;
  onRemove?: () => void;
  className?: string;
}

const COMPARISONS = Object.keys(COMPARISON_LABELS) as ComparisonOperator[];
const LOGICALS = Object.keys(LOGICAL_LABELS) as LogicalOperator[];

export const DEFAULT_VARIABLES = [
  "service_condition_category",
  "legal_base",
  "position_category",
  "regime_type",
  "hour_category",
  "seniority_years",
] as const;

export function emptyLeaf(): LeafCondition {
  return { node_type: "leaf", variable: "", operator: "eq", value: "" };
}

/** Текст → значение сравнения. См. комментарий «О `value`» выше. */
export function parseConditionValue(raw: string, operator: ComparisonOperator): unknown {
  const trimmed = raw.trim();

  if (operator === "in" || operator === "not_in") {
    return trimmed
      .split(",")
      .map((part) => parseScalar(part.trim()))
      .filter((part) => part !== "");
  }
  return parseScalar(trimmed);
}

function parseScalar(text: string): unknown {
  if (text === "true") return true;
  if (text === "false") return false;
  if (text !== "" && !Number.isNaN(Number(text))) return Number(text);
  return text;
}

/** Значение сравнения → текст для поля ввода. */
export function conditionValueToText(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

export function ConditionTreeBuilder({
  value,
  onChange,
  variables = DEFAULT_VARIABLES,
  depth = 0,
  onRemove,
  className,
}: ConditionTreeBuilderProps) {
  const variableId = useId();
  const operatorId = useId();
  const valueId = useId();
  const logicalId = useId();
  const listId = useId();

  if (value.node_type === "leaf") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-start gap-3 rounded-sm border border-rule bg-paper p-3",
          className,
        )}
      >
        <div className="space-y-1.5">
          <Label htmlFor={variableId}>Переменная</Label>
          <Input
            id={variableId}
            list={listId}
            value={value.variable}
            placeholder="service_condition_category"
            className="w-64 font-mono text-sm"
            onChange={(event) => onChange({ ...value, variable: event.target.value })}
          />
          {/* `datalist`, а не `select`: контекст расчёта расширяется вместе
              с алгоритмами, и закрытый список запретил бы юристу сослаться
              на переменную, которая на сервере уже есть, а здесь ещё нет. */}
          <datalist id={listId}>
            {variables.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={operatorId}>Сравнение</Label>
          <select
            id={operatorId}
            value={value.operator}
            onChange={(event) => {
              const operator = event.target.value as ComparisonOperator;
              // Значение перечитывается под новый оператор: при переходе
              // на `in` одиночное «normal» обязано стать списком из одного
              // элемента, иначе сервер получит скаляр там, где ждёт массив.
              onChange({
                ...value,
                operator,
                value: parseConditionValue(conditionValueToText(value.value), operator),
              });
            }}
            className="block h-9 w-52 rounded-xs border border-rule-strong bg-paper px-2 text-sm"
          >
            {COMPARISONS.map((operator) => (
              <option key={operator} value={operator}>
                {COMPARISON_LABELS[operator]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={valueId}>Значение</Label>
          <Input
            id={valueId}
            value={conditionValueToText(value.value)}
            placeholder={value.operator === "in" || value.operator === "not_in" ? "a, b, c" : "normal"}
            className="w-64 font-mono text-sm"
            aria-describedby={`${valueId}-hint`}
            onChange={(event) =>
              onChange({
                ...value,
                value: parseConditionValue(event.target.value, value.operator),
              })
            }
          />
          <p id={`${valueId}-hint`} className="text-xs text-ink-muted">
            {value.operator === "in" || value.operator === "not_in"
              ? "Через запятую."
              : "true/false — признак, число — число, остальное — строка."}
          </p>
        </div>

        <div className="mt-[1.375rem] flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                node_type: "composite",
                logical_operator: "and",
                conditions: [value, emptyLeaf()],
              })
            }
          >
            Сгруппировать
          </Button>
          {onRemove ? (
            <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
              Убрать
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const composite: CompositeCondition = value;
  const unary = composite.logical_operator === "not";

  return (
    <div
      className={cn(
        "space-y-3 rounded-sm border-l-2 border-rule-strong bg-paper-sunken p-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={logicalId}>Связка</Label>
          <select
            id={logicalId}
            value={composite.logical_operator}
            onChange={(event) => {
              const logical = event.target.value as LogicalOperator;
              onChange({
                ...composite,
                logical_operator: logical,
                // `not` унарный — сервер отвергнет иное (`_check_not_is_unary`).
                // Обрезаем здесь, чтобы отказ не пришёл после отправки.
                conditions:
                  logical === "not" ? composite.conditions.slice(0, 1) : composite.conditions,
              });
            }}
            className="block h-9 w-56 rounded-xs border border-rule-strong bg-paper px-2 text-sm"
          >
            {LOGICALS.map((logical) => (
              <option key={logical} value={logical}>
                {LOGICAL_LABELS[logical]}
              </option>
            ))}
          </select>
        </div>

        {!unary ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-[1.375rem]"
            onClick={() =>
              onChange({ ...composite, conditions: [...composite.conditions, emptyLeaf()] })
            }
          >
            Добавить условие
          </Button>
        ) : (
          <p className="mt-[1.375rem] max-w-56 text-xs text-ink-muted">
            Отрицание применяется ровно к одному условию.
          </p>
        )}

        {composite.conditions.length === 1 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-[1.375rem]"
            onClick={() => onChange(composite.conditions[0]!)}
          >
            Разгруппировать
          </Button>
        ) : null}

        {onRemove ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-[1.375rem]"
            onClick={onRemove}
          >
            Убрать группу
          </Button>
        ) : null}
      </div>

      <ul className="space-y-3">
        {composite.conditions.map((child, index) => (
          <li key={index}>
            <ConditionTreeBuilder
              value={child}
              variables={variables}
              depth={depth + 1}
              onChange={(next) => {
                const conditions = [...composite.conditions];
                conditions[index] = next;
                onChange({ ...composite, conditions });
              }}
              onRemove={
                // Пустая группа недопустима (`min_length=1` на сервере),
                // поэтому последнее условие убрать нельзя — вместо этого
                // группа разгруппировывается.
                composite.conditions.length > 1
                  ? () =>
                      onChange({
                        ...composite,
                        conditions: composite.conditions.filter((_, i) => i !== index),
                      })
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Незаполненные места дерева.
 *
 * Сервер отвергнет их своими средствами, но отказ придёт после отправки
 * и назовёт путь вида `actions.0.formula.condition.conditions.1.variable`
 * — то есть потребует от юриста прочитать JSON, которого он не писал.
 */
export function validateCondition(condition: Condition, path = "условие"): string[] {
  if (condition.node_type === "leaf") {
    const problems: string[] = [];
    if (!condition.variable.trim()) problems.push(`${path}: не указана переменная`);
    if (conditionValueToText(condition.value).trim() === "") {
      problems.push(`${path}: не указано значение сравнения`);
    }
    return problems;
  }

  if (condition.logical_operator === "not" && condition.conditions.length !== 1) {
    return [`${path}: отрицание требует ровно одного условия`];
  }
  if (condition.conditions.length === 0) {
    return [`${path}: группа пуста`];
  }
  return condition.conditions.flatMap((child, index) =>
    validateCondition(child, `${path} → ${index + 1}`),
  );
}
