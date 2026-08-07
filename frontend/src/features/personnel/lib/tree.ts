import type { Unit } from "../schemas";

/**
 * Сборка дерева подразделений из плоского списка.
 *
 * --- Почему за один проход ----------------------------------------------
 *
 * `GET /personnel/units` отдаёт список, упорядоченный по `hierarchy_path`
 * (ltree), а путь родителя — префикс пути потомка. Значит, родитель в
 * списке всегда стоит раньше потомка, и к моменту, когда очередь доходит
 * до узла, его родитель уже создан. Это превращает сборку в один проход
 * вместо повторных поисков по массиву — и делает глубину произвольной без
 * рекурсии по данным.
 *
 * --- Осиротевшие узлы не теряются ----------------------------------------
 *
 * `rootUnitId` сужает выдачу до поддерева, а сотрудник может видеть своё
 * подразделение, не видя вышестоящего. Тогда узел, чей `parentUnitId`
 * есть, но в выдаче отсутствует, — не ошибка, а край области видимости.
 * Такой узел становится корнем показываемого дерева: спрятать его значило
 * бы показать пустой экран человеку, у которого доступ есть.
 */

export interface UnitNode {
  unit: Unit;
  children: UnitNode[];
}

export function buildUnitTree(units: readonly Unit[]): UnitNode[] {
  const nodes = new Map<string, UnitNode>();
  const roots: UnitNode[] = [];

  for (const unit of units) {
    const node: UnitNode = { unit, children: [] };
    nodes.set(unit.id, node);

    const parent = unit.parentUnitId ? nodes.get(unit.parentUnitId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

/**
 * Отбор по названию или коду — С СОХРАНЕНИЕМ ПРЕДКОВ.
 *
 * Отфильтровать дерево простым `filter` нельзя: совпавшая часть без своего
 * гарнизона превращается в корень, и структура, ради которой экран
 * существует, исчезает ровно тогда, когда её ищут. Поэтому к каждому
 * совпадению добавляется вся цепочка вверх — она показывается как путь,
 * а не как результат поиска.
 *
 * Порядок исходного списка сохраняется, и это важно: `buildUnitTree`
 * рассчитывает, что родитель идёт раньше потомка.
 */
export function filterUnits(units: readonly Unit[], query: string): Unit[] {
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  if (!needle) return [...units];

  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const keep = new Set<string>();

  for (const unit of units) {
    const matches =
      unit.name.toLocaleLowerCase("ru-RU").includes(needle) ||
      unit.code.toLocaleLowerCase("ru-RU").includes(needle);
    if (!matches) continue;

    keep.add(unit.id);
    let ancestor = unit.parentUnitId;
    while (ancestor && !keep.has(ancestor)) {
      keep.add(ancestor);
      ancestor = byId.get(ancestor)?.parentUnitId ?? null;
    }
  }

  return units.filter((unit) => keep.has(unit.id));
}

/** Идентификаторы всех предков узла — то, что надо раскрыть, чтобы он стал виден. */
export function ancestorIdsOf(units: readonly Unit[], unitId: string): string[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const chain: string[] = [];

  let current = byId.get(unitId)?.parentUnitId ?? null;
  while (current) {
    chain.push(current);
    current = byId.get(current)?.parentUnitId ?? null;
  }
  return chain;
}
