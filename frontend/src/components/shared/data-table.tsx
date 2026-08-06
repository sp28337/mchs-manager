"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils/cn";

import { EmptyState } from "./empty-state";

/**
 * FE010 — таблица под конверт пагинации API.
 *
 * DoD: «компонент корректно рендерит конверт пагинации с сортировкой».
 *
 * --- Состояние таблицы живёт в URL --------------------------------------
 *
 * Страница, сортировка и фильтры — в `searchParams`, а не в `useState`.
 * Это решение Frontend_Architecture разд. 6 («URL — источник истины для
 * состояния списка»), и у него есть практический смысл: табельщик,
 * нашедший расхождение на третьей странице, должен иметь возможность
 * прислать командиру ССЫЛКУ, а не описание пути к ней.
 *
 * --- Сортировка объявлена, а не только нарисована -----------------------
 *
 * `aria-sort` на заголовке — единственный способ сообщить программе чтения
 * с экрана, по какой колонке отсортирована таблица (WCAG 2.2, 1.3.1).
 * Стрелка без него — украшение для зрячих.
 */

export interface Column<TRow> {
  /** Ключ поля; он же значение `sort` в строке запроса. */
  key: string;
  header: string;
  /** Отрисовка ячейки. По умолчанию — значение поля как есть. */
  cell: (row: TRow) => React.ReactNode;
  sortable?: boolean;
  /** Числовые колонки выравниваются вправо: так сравниваются разряды. */
  numeric?: boolean;
}

export interface PageEnvelope<TRow> {
  items: TRow[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface DataTableProps<TRow> {
  data: PageEnvelope<TRow>;
  columns: Column<TRow>[];
  rowKey: (row: TRow) => string;
  caption: string;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function DataTable<TRow>({
  data,
  columns,
  rowKey,
  caption,
  emptyTitle = "Записей нет",
  emptyDescription,
  className,
}: DataTableProps<TRow>) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sort = searchParams.get("sort");
  const order = searchParams.get("order") === "desc" ? "desc" : "asc";

  const totalPages = Math.max(1, Math.ceil(data.totalCount / Math.max(1, data.pageSize)));

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      router.push(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const toggleSort = useCallback(
    (key: string) => {
      const nextOrder = sort === key && order === "asc" ? "desc" : "asc";
      // Смена сортировки возвращает на первую страницу: третья страница
      // прежнего порядка не имеет отношения к новому.
      setParams({ sort: key, order: nextOrder, page: "1" });
    },
    [order, setParams, sort],
  );

  const range = useMemo(() => {
    if (data.totalCount === 0) return null;
    const from = (data.page - 1) * data.pageSize + 1;
    const to = Math.min(data.page * data.pageSize, data.totalCount);
    return { from, to };
  }, [data.page, data.pageSize, data.totalCount]);

  if (data.items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <Table caption={caption}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => {
              const active = sort === column.key;
              return (
                <TableHead
                  key={column.key}
                  aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
                  className={column.numeric ? "text-right" : undefined}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="inline-flex items-center gap-1 hover:text-ink"
                    >
                      {column.header}
                      <span aria-hidden className="text-ink-faint">
                        {active ? (order === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {data.items.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={column.numeric ? "text-right font-mono" : undefined}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <nav
        className="flex items-center justify-between gap-4 text-sm"
        aria-label="Постраничная навигация"
      >
        <p className="text-ink-muted" aria-live="polite">
          {range ? `${range.from}–${range.to} из ${data.totalCount}` : null}
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={data.page <= 1}
            onClick={() => setParams({ page: String(data.page - 1) })}
          >
            Назад
          </Button>
          <span className="font-mono text-xs text-ink-muted">
            {data.page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={data.page >= totalPages}
            onClick={() => setParams({ page: String(data.page + 1) })}
          >
            Вперёд
          </Button>
        </div>
      </nav>
    </div>
  );
}
