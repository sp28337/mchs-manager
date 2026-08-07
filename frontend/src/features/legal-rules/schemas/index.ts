/**
 * Формы `legal_rules` и декларативный язык Rule Engine.
 *
 * Типы здесь — зеркало `src/rule_engine/schemas/*.py`: дискриминируемые
 * объединения по `node_type`, рекурсия через `args`/`conditions`. Держать
 * их вручную приходится потому, что `openapi.yaml` описывает
 * `formulaDefinition` как свободный объект, и генератор типов вывел бы из
 * него `unknown` — то есть ровно ту потерю, ради предотвращения которой
 * конструктор и пишется.
 */

export type RuleCategory =
  | "norm_calculation"
  | "night_hours_classification"
  | "holiday_hours_classification"
  | "overtime_classification"
  | "compensation_coefficient"
  | "leave_entitlement"
  | "minimum_rest_period";

export type RuleStatus = "draft" | "published" | "superseded";

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  norm_calculation: "Расчёт нормы",
  night_hours_classification: "Классификация ночных часов",
  holiday_hours_classification: "Классификация праздничных часов",
  overtime_classification: "Классификация переработки",
  compensation_coefficient: "Коэффициент компенсации",
  leave_entitlement: "Продолжительность отпуска",
  minimum_rest_period: "Минимальный междусменный отдых",
};

/** Норма, из которой категория растёт. Показывается рядом с названием. */
export const RULE_CATEGORY_BASIS: Record<RuleCategory, string> = {
  norm_calculation: "ФЗ-141 ст. 54 (40 ч/нед; 36 ч/нед во вредных условиях)",
  night_hours_classification: "ТК РФ ст. 96 (с 22:00 до 06:00)",
  holiday_hours_classification: "ТК РФ ст. 112",
  overtime_classification: "ФЗ-141 ст. 55, Приказ № 410 пп. 10-11",
  compensation_coefficient: "Приказ № 410 п. 11, Приказ № 539 п. 103",
  leave_entitlement: "ФЗ-141 ст. 63, Приказ № 410 п. 12",
  minimum_rest_period: "ФЗ-141 ст. 55 (не менее 42 часов)",
};

export interface Rule {
  id: string;
  code: string;
  category: RuleCategory;
  displayName: string;
  description?: string | null;
}

export interface RuleVersion {
  id: string;
  ruleId: string;
  versionNo: number;
  scope: Record<string, string>;
  legalBasisNodeId: string;
  validFrom: string;
  validTo?: string | null;
  status: RuleStatus;
  publishedAt?: string | null;
  publishedBy?: string | null;
  /** `list[Action]` — то, что версия делает. */
  formulaDefinition?: Action[] | null;
}

export interface PageEnvelope<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

// ------------------------------------------------------------- Condition

export type ComparisonOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in";
export type LogicalOperator = "and" | "or" | "not";

export interface LeafCondition {
  node_type: "leaf";
  variable: string;
  operator: ComparisonOperator;
  value: unknown;
}

export interface CompositeCondition {
  node_type: "composite";
  logical_operator: LogicalOperator;
  conditions: Condition[];
}

export type Condition = LeafCondition | CompositeCondition;

export const COMPARISON_LABELS: Record<ComparisonOperator, string> = {
  eq: "равно",
  ne: "не равно",
  gt: "больше",
  gte: "больше или равно",
  lt: "меньше",
  lte: "меньше или равно",
  in: "входит в",
  not_in: "не входит в",
};

export const LOGICAL_LABELS: Record<LogicalOperator, string> = {
  and: "И (все условия)",
  or: "ИЛИ (хотя бы одно)",
  not: "НЕ (отрицание)",
};

// --------------------------------------------------------------- Formula

export type ArithmeticOperator = "+" | "-" | "*" | "/";

export interface LiteralFormula {
  node_type: "literal";
  value: boolean | number | string;
}

export interface VariableFormula {
  node_type: "variable";
  name: string;
}

export interface OperatorFormula {
  node_type: "operator";
  op: ArithmeticOperator;
  args: Formula[];
}

export interface FunctionFormula {
  node_type: "function";
  function_name: string;
  args: Formula[];
}

export interface ConditionalFormula {
  node_type: "conditional";
  condition: Condition;
  then_branch: Formula;
  else_branch: Formula;
}

export interface RuleReferenceFormula {
  node_type: "rule_reference";
  rule_code: string;
  scope: Record<string, string>;
  as_of?: string | null;
}

export type Formula =
  | LiteralFormula
  | VariableFormula
  | OperatorFormula
  | FunctionFormula
  | ConditionalFormula
  | RuleReferenceFormula;

export type FormulaNodeType = Formula["node_type"];

export const FORMULA_NODE_LABELS: Record<FormulaNodeType, string> = {
  literal: "Константа",
  variable: "Переменная",
  operator: "Арифметика",
  function: "Функция",
  conditional: "Ветвление",
  rule_reference: "Ссылка на другое правило",
};

/**
 * Реестр функций ФИКСИРОВАН на сервере
 * (`rule_engine/function_registry/registry.py`): формула, вызывающая
 * незарегистрированное имя, — это данные, которые движок не сможет
 * посчитать. Поэтому конструктор предлагает выбор из списка, а не
 * свободный ввод: опечатка в имени функции обнаружилась бы только при
 * расчёте табеля, то есть месяцем позже.
 */
export const KNOWN_FUNCTIONS: { name: string; arity: string; note: string }[] = [
  { name: "min", arity: "2+", note: "наименьшее из значений" },
  { name: "max", arity: "2+", note: "наибольшее из значений" },
  { name: "round", arity: "1", note: "округление до целого" },
  { name: "ceil", arity: "1", note: "округление вверх" },
  { name: "floor", arity: "1", note: "округление вниз" },
  { name: "abs", arity: "1", note: "модуль числа" },
];

export interface SetResultAction {
  node_type: "set_result";
  field: string;
  formula: Formula;
}

export type Action = SetResultAction;

/**
 * Поля результата, которые правило может задать.
 *
 * Список подсказочный, а не запирающий: сервер принимает любое имя, и
 * новая норма может потребовать поля, которого здесь нет. Но опечатка в
 * `norm_hours` тоже принимается сервером — и молча даёт правило, ничего
 * не задающее, поэтому известные имена предлагаются первыми.
 */
export const KNOWN_RESULT_FIELDS: { field: string; note: string }[] = [
  { field: "weekly_norm_hours", note: "Недельная норма (Алгоритм Б)" },
  { field: "norm_hours", note: "Норма периода (Алгоритм Б)" },
  { field: "coefficient", note: "Коэффициент компенсации (Алгоритм К)" },
  { field: "election_allowed", note: "Допускается ли выбор формы (инвариант 7.1.3)" },
  {
    field: "default_compensation_form",
    note: "Форма компенсации по умолчанию (Приказ № 410 п. 11)",
  },
  { field: "entitled_days", note: "Продолжительность отпуска (ФЗ-141 ст. 63)" },
  { field: "minimum_rest_hours", note: "Междусменный отдых (ФЗ-141 ст. 55)" },
];

export interface DryRunResult {
  oldValue: number;
  newValue: number;
  comparedEntities: number;
  differencesFound: number;
  sampleDifferences: { employeeId: string; oldValue: number; newValue: number }[];
}
