"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useId, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { filterUnits } from "../lib/tree";
import type { Unit } from "../schemas";
import { UnitTreeView } from "./unit-tree-view";

/**
 * FE038 — обозреватель структуры подразделений.
 *
 * DoD: «дерево раскрывается/сворачивается».
 *
 * --- Выбранное подразделение — в URL ------------------------------------
 *
 * `?unitId=…` вместо состояния компонента: карточка сотрудника ссылается
 * сюда на его часть, и ссылка обязана открывать именно её, а не корень с
 * предложением поискать. То же и в обратную сторону — найденное
 * подразделение можно переслать.
 *
 * --- Почему список сотрудников не грузится здесь ------------------------
 *
 * Соблазн показать личный состав рядом с деревом велик, но это тот же
 * экран, что `/personnel/employees`, только хуже: без фильтров и без
 * пагинации. Вместо копии — ссылка с проставленным фильтром.
 */

export interface UnitBrowserProps {
  units: readonly Unit[];
  /**
   * Область видимости сессии (`unit_scope`).
   *
   * Нужна, чтобы не предлагать переход туда, откуда пользователь вернётся
   * ни с чем: сводка табелей открывается только по подразделению из
   * области видимости. Справочник при этом виден целиком — структуру
   * ведомства знать не запрещено, а вот показатели чужой части — да.
   */
  unitScope: readonly string[];
}

export function UnitBrowser({ units, unitScope }: UnitBrowserProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("unitId") ?? undefined;
  const searchId = useId();

  // Поиск — состояние компонента, а не URL: он сужает ВИД, а не выборку,
  // и ссылка «смотри на это подразделение» уже есть — `?unitId=`.
  const [query, setQuery] = useState("");
  // Перебор всего справочника на каждое нажатие клавиши задерживал бы
  // сам ввод; отложенное значение оставляет поле отзывчивым, а дерево
  // догоняет.
  const deferredQuery = useDeferredValue(query);

  const visible = useMemo(
    () => filterUnits(units, deferredQuery),
    [units, deferredQuery],
  );

  const selected = useMemo(
    () => units.find((unit) => unit.id === selectedId) ?? null,
    [units, selectedId],
  );

  const parent = useMemo(
    () => (selected?.parentUnitId ? units.find((u) => u.id === selected.parentUnitId) : null),
    [units, selected],
  );

  const children = useMemo(
    () => (selected ? units.filter((unit) => unit.parentUnitId === selected.id) : []),
    [units, selected],
  );

  function select(unit: Unit) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("unitId", unit.id);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  if (units.length === 0) {
    return (
      <EmptyState
        title="Структура не заведена"
        description="Подразделения создаются администратором системы: гарнизон, часть, караул."
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-3 rounded-sm border border-rule bg-paper-raised p-3">
        <div className="space-y-1.5">
          <Label htmlFor={searchId}>Найти подразделение</Label>
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название или код"
            aria-describedby={`${searchId}-count`}
          />
          <p id={`${searchId}-count`} className="text-xs text-ink-muted" aria-live="polite">
            {deferredQuery.trim()
              ? `Показано ${visible.length} из ${units.length}: совпадения и путь к ним.`
              : `Всего подразделений: ${units.length}.`}
          </p>
        </div>

        <div className="max-h-[32rem] overflow-y-auto border-t border-rule pt-2">
          <UnitTreeView
            units={visible}
            selectedUnitId={selectedId}
            onSelect={select}
            initialExpansion={deferredQuery.trim() ? "all" : "roots"}
          />
        </div>

        <p className="border-t border-rule pt-2 text-xs text-ink-muted">
          Стрелки — перемещение, «→» раскрывает ветвь, «←» сворачивает.
        </p>
      </div>

      <div className="min-w-0">
        {selected ? (
          <section aria-labelledby="unit-card" className="space-y-4">
            <div className="space-y-1">
              <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
                {selected.code}
              </p>
              <h2 id="unit-card" className="text-xl">
                {selected.name}
              </h2>
            </div>

            <dl className="grid max-w-xl gap-x-8 gap-y-2 sm:grid-cols-[auto_1fr]">
              <dt className="text-sm text-ink-muted">Вышестоящее</dt>
              <dd className="text-sm">
                {parent ? (
                  <button
                    type="button"
                    onClick={() => select(parent)}
                    className="text-trace underline underline-offset-2"
                  >
                    {parent.name}
                  </button>
                ) : (
                  "нет — это корень структуры"
                )}
              </dd>

              <dt className="text-sm text-ink-muted">Подчинённых</dt>
              <dd className="font-mono text-sm">{children.length}</dd>

              <dt className="text-sm text-ink-muted">Часовой пояс</dt>
              <dd className="font-mono text-sm">{selected.timeZone}</dd>

              <dt className="text-sm text-ink-muted">Уровень</dt>
              <dd className="font-mono text-sm">
                {selected.hierarchyPath.split(".").length}
              </dd>
            </dl>

            {/* Часовой пояс — не справочная подробность: ночные часы (ТК
                РФ ст. 96) считаются в поясе подразделения, и смена
                суточного дежурства в другом поясе даёт другую разбивку. */}
            <p className="max-w-prose text-sm text-ink-muted">
              Служебное время этого подразделения считается в поясе{" "}
              <span className="font-mono">{selected.timeZone}</span>: ночные часы
              (с 22:00 до 06:00, ТК РФ ст. 96) определяются местным временем, а не
              временем составителя табеля.
            </p>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <Link
                href={`/personnel/employees?unitId=${selected.id}`}
                className="text-trace underline underline-offset-2"
              >
                Личный состав
              </Link>
              {unitScope.includes(selected.id) ? (
                <Link
                  href={`/time-accounting/dashboard?unitId=${selected.id}`}
                  className="text-trace underline underline-offset-2"
                >
                  Сводка табелей
                </Link>
              ) : (
                <span className="text-ink-faint">
                  Сводка табелей — вне вашей области видимости
                </span>
              )}
            </div>

            <p className="font-mono text-xs break-all text-ink-faint">
              {selected.hierarchyPath}
            </p>
          </section>
        ) : (
          <div className="rounded-sm border border-dashed border-rule-strong px-6 py-12 text-center">
            <p className="font-display text-lg font-bold">Подразделение не выбрано</p>
            <p className="mx-auto mt-2 max-w-prose text-sm text-ink-muted">
              Выберите подразделение в дереве слева, чтобы увидеть его часовой пояс,
              место в структуре и личный состав.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
