"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

import type { Unit } from "../schemas";
import { ancestorIdsOf, buildUnitTree, type UnitNode } from "../lib/tree";

/**
 * FE035 — иерархия подразделений.
 *
 * DoD: «UnitTreeView отображает ltree-иерархию произвольной глубины».
 *
 * --- Почему это `role="tree"`, а не список ссылок -----------------------
 *
 * Дерево нарисованное и дерево объявленное — разные вещи. Отступ слева
 * сообщает вложенность только тому, кто видит экран; программе чтения
 * нужны `aria-level`, `aria-expanded`, `aria-setsize`/`aria-posinset` —
 * тогда она произносит «ПЧ-12, уровень 3, 2 из 5, свёрнуто», и человек
 * знает, где находится, не видя отступов (WCAG 2.2, 1.3.1).
 *
 * --- Roving tabindex ----------------------------------------------------
 *
 * В дереве ровно одна точка входа с клавиатуры: `tabIndex=0` стоит на
 * активном узле, на остальных `-1`. Иначе Tab пришлось бы нажимать
 * столько раз, сколько в гарнизоне частей, — а перемещение внутри дерева
 * и так делается стрелками (шаблон ARIA Tree View).
 *
 * Стрелки работают по ВИДИМЫМ узлам: свёрнутая ветвь для навигации не
 * существует, ровно как на экране. Влево на раскрытом узле сворачивает
 * его, на свёрнутом — переводит к родителю; вправо симметрично. Это
 * поведение люди уже знают по проводнику файлов, и придумывать своё
 * значило бы заставить их учить его заново.
 *
 * --- Что раскрыто изначально -------------------------------------------
 *
 * Корни и путь до `selectedUnitId`. Полностью развёрнутое дерево
 * гарнизона — это сотни строк, среди которых нужную не найти; полностью
 * свёрнутое требует раскрыть его вручную, чтобы увидеть хоть что-то.
 */

export interface UnitTreeViewProps {
  units: readonly Unit[];
  selectedUnitId?: string;
  onSelect?: (unit: Unit) => void;
  /** Приписка справа от названия — например, число сотрудников. */
  renderMeta?: (unit: Unit) => React.ReactNode;
  /**
   * Что раскрыто при появлении набора.
   *
   * `all` нужен для результатов поиска: найденная часть лежит на третьем
   * уровне, и показать её свёрнутой под корнем — то же, что не найти.
   * Для полного справочника это, наоборот, стена из строк, поэтому
   * умолчание — только корни.
   */
  initialExpansion?: "roots" | "all";
  className?: string;
  label?: string;
}

interface FlatRow {
  node: UnitNode;
  level: number;
  posInSet: number;
  setSize: number;
  hasChildren: boolean;
  expanded: boolean;
  parentId: string | null;
  /** Пояс отличается от вышестоящего — единственный случай, когда он значим. */
  timeZoneDiffers: boolean;
}

function flatten(
  nodes: readonly UnitNode[],
  expanded: ReadonlySet<string>,
  level: number,
  parent: UnitNode | null,
  out: FlatRow[],
): FlatRow[] {
  nodes.forEach((node, index) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.unit.id);

    out.push({
      node,
      level,
      posInSet: index + 1,
      setSize: nodes.length,
      hasChildren,
      expanded: isExpanded,
      parentId: parent?.unit.id ?? null,
      // У корня сравнивать не с чем: его пояс — исходное значение, а не
      // отклонение, и подсвечивать его значило бы объявить особенным
      // каждый гарнизон.
      timeZoneDiffers: parent !== null && parent.unit.timeZone !== node.unit.timeZone,
    });

    if (isExpanded) flatten(node.children, expanded, level + 1, node, out);
  });
  return out;
}

export function UnitTreeView({
  units,
  selectedUnitId,
  onSelect,
  renderMeta,
  initialExpansion = "roots",
  className,
  label = "Структура подразделений",
}: UnitTreeViewProps) {
  const roots = useMemo(() => buildUnitTree(units), [units]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);

  // Раскрытие по умолчанию пересчитывается при смене состава: до
  // загрузки списка раскрывать нечего, а после — надо показать путь до
  // выбранного. Пользовательские раскрытия при этом не теряются: они
  // добавляются к умолчанию, а не заменяют его.
  useEffect(() => {
    if (units.length === 0) return;
    setExpanded((previous) => {
      const next = new Set(previous);
      for (const unit of units) {
        if (initialExpansion === "all" || unit.parentUnitId === null) next.add(unit.id);
      }
      if (selectedUnitId) for (const id of ancestorIdsOf(units, selectedUnitId)) next.add(id);
      return next;
    });
  }, [units, selectedUnitId, initialExpansion]);

  const rows = useMemo(
    () => flatten(roots, expanded, 1, null, []),
    [roots, expanded],
  );

  // Активный узел — выбранный, если он виден; иначе первый. Держать
  // `tabIndex=0` на узле, который свернули, значит потерять точку входа
  // с клавиатуры совсем.
  const activeIndex = useMemo(() => {
    const byActive = rows.findIndex((row) => row.node.unit.id === activeId);
    if (byActive >= 0) return byActive;
    const bySelected = rows.findIndex((row) => row.node.unit.id === selectedUnitId);
    return bySelected >= 0 ? bySelected : 0;
  }, [rows, activeId, selectedUnitId]);

  const focusRow = useCallback((index: number) => {
    const row = treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[index];
    row?.focus();
  }, []);

  const toggle = useCallback((unitId: string, open?: boolean) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      const shouldOpen = open ?? !next.has(unitId);
      if (shouldOpen) next.add(unitId);
      else next.delete(unitId);
      return next;
    });
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      const row = rows[index];
      if (!row) return;
      const id = row.node.unit.id;

      const move = (target: number) => {
        event.preventDefault();
        const clamped = Math.max(0, Math.min(rows.length - 1, target));
        setActiveId(rows[clamped]?.node.unit.id ?? null);
        focusRow(clamped);
      };

      switch (event.key) {
        case "ArrowDown":
          move(index + 1);
          break;
        case "ArrowUp":
          move(index - 1);
          break;
        case "Home":
          move(0);
          break;
        case "End":
          move(rows.length - 1);
          break;
        case "ArrowRight":
          if (row.hasChildren && !row.expanded) {
            event.preventDefault();
            toggle(id, true);
          } else if (row.hasChildren) {
            move(index + 1);
          }
          break;
        case "ArrowLeft":
          if (row.expanded) {
            event.preventDefault();
            toggle(id, false);
          } else if (row.parentId) {
            move(rows.findIndex((candidate) => candidate.node.unit.id === row.parentId));
          }
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          onSelect?.(row.node.unit);
          break;
        default:
          break;
      }
    },
    [rows, focusRow, toggle, onSelect],
  );

  if (units.length === 0) {
    return (
      <p className={cn("text-sm text-ink-muted", className)}>
        Подразделений не найдено.
      </p>
    );
  }

  return (
    <ul
      ref={treeRef}
      role="tree"
      aria-label={label}
      className={cn("space-y-0.5", className)}
    >
      {rows.map((row, index) => {
        const unit = row.node.unit;
        const selected = unit.id === selectedUnitId;

        return (
          <li key={unit.id} role="none">
            <div
              role="treeitem"
              tabIndex={index === activeIndex ? 0 : -1}
              aria-level={row.level}
              aria-posinset={row.posInSet}
              aria-setsize={row.setSize}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              aria-selected={selected}
              onKeyDown={(event) => onKeyDown(event, index)}
              onFocus={() => setActiveId(unit.id)}
              onClick={() => onSelect?.(unit)}
              className={cn(
                "flex cursor-default items-center gap-2 rounded-xs px-2 py-1 text-sm",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace",
                selected
                  ? "bg-paper-sunken font-medium text-ink"
                  : "text-ink hover:bg-paper-sunken/60",
              )}
              // Отступ уровня — в стиле, а не в разметке: вложенные <ul>
              // дали бы ту же картинку, но `flatten` уже расставил уровни,
              // и вторая иерархия рядом с первой рано или поздно с ней
              // разойдётся.
              style={{ paddingLeft: `${(row.level - 1) * 1.25 + 0.5}rem` }}
            >
              {row.hasChildren ? (
                <button
                  type="button"
                  // Раскрытие уже объявлено через `aria-expanded` на самом
                  // узле; повторять его кнопкой значит заставить чтец
                  // произнести состояние дважды.
                  aria-hidden
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(unit.id);
                  }}
                  className="w-3 shrink-0 text-ink-faint hover:text-ink"
                >
                  {row.expanded ? "▾" : "▸"}
                </button>
              ) : (
                <span aria-hidden className="w-3 shrink-0" />
              )}

              <span className="min-w-0 truncate" title={unit.name}>
                {unit.name}
              </span>
              <span className="shrink-0 font-mono text-xs text-ink-faint">{unit.code}</span>

              {/* Часовой пояс показывается только там, где он ОТЛИЧАЕТСЯ
                  от вышестоящего.

                  Он важен — ночные часы (ТК РФ ст. 96) считаются в поясе
                  подразделения, — но подразделения почти всегда наследуют
                  пояс родителя, и «Europe/Moscow» в каждой строке
                  вытесняет названия, ничего не сообщая. Отличие же
                  сообщает всё: именно эта часть считается по другому
                  времени. */}
              {row.timeZoneDiffers ? (
                <span
                  className="shrink-0 rounded-xs border border-rule-strong px-1 font-mono text-[10px] text-ink-muted"
                  title="Часовой пояс отличается от вышестоящего подразделения"
                >
                  {unit.timeZone}
                </span>
              ) : null}

              {renderMeta ? (
                <span className="ml-auto shrink-0">{renderMeta(unit)}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
