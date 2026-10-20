"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils/cn";

import { changeSchema, type ChangeBlock, type DocumentChange } from "./diff";

/** `2026-10-11` → `11.10.2026` */
function date(version: string): string {
  const [year, month, day] = version.split("-");
  return year === undefined || month === undefined || day === undefined
    ? version
    : `${day}.${month}.${year}`;
}

type State =
  | { phase: "loading" }
  | { phase: "ready"; change: DocumentChange }
  | { phase: "missing" };

/**
 * Что изменилось в документе против редакции, которую человек уже принимал.
 *
 * Показывает правки наглядно, без сравнения «глазами»: убранное зачёркнуто и
 * подсвечено красным, добавленное — зелёным, переписанное предложение — правкой
 * слов внутри него. Неизменившееся не показывается: названо только, сколько его.
 * Сравнение готово на сборке (`app/legal-changes/…`) и забирается, только когда
 * человек его попросил. Прежней редакции в архиве нет — сравнивать не с чем, и
 * вместо правок стоит честная строка с дорогой к тексту целиком.
 *
 * Не опирается на один цвет: убранное ещё и зачёркнуто, добавленное — подчёркнуто,
 * и у каждого абзаца есть скрытая от глаз, но читаемая диктором пометка.
 */
export function DocumentChanges({
  id,
  from,
  href,
}: {
  id: string;
  /** Редакция, которую человек принимал. */
  from: string;
  /** Страница документа целиком. */
  href: string;
}) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/legal-changes/${id}/${from}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return changeSchema.parse(await response.json());
      })
      .then((change) => setState({ phase: "ready", change }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("сравнение редакций недоступно", error);
        setState({ phase: "missing" });
      });

    return () => controller.abort();
  }, [id, from]);

  if (state.phase === "loading") {
    return <p className="text-sm text-ink-muted">Готовлю сравнение…</p>;
  }

  if (state.phase === "missing") {
    return (
      <p className="text-sm text-ink-muted">
        Сравнить не с чем: прежняя редакция от {date(from)} не сохранена.{" "}
        <Link href={href} target="_blank" rel="noopener" className="text-ink underline">
          Открыть документ целиком
        </Link>
        .
      </p>
    );
  }

  const { change } = state;
  const edits = change.blocks.filter((block) => block.kind !== "heading").length;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-ink-muted">
        Было — редакция от {date(change.from)}, стало — от {date(change.to)}.{" "}
        <del className="rounded-sm bg-signal-soft px-1 text-ink-muted line-through decoration-signal">
          убрано
        </del>{" "}
        <ins className="rounded-sm bg-verify-soft px-1 text-ink underline decoration-verify decoration-2 underline-offset-2">
          добавлено
        </ins>
        {change.unchanged > 0 && <> Без изменений: {change.unchanged}.</>}
      </p>

      {edits === 0 ? (
        <p className="text-ink-muted">Текст не изменился — поменялась только дата редакции.</p>
      ) : (
        <div className="space-y-2">
          {change.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}

function Block({ block }: { block: ChangeBlock }) {
  if (block.kind === "heading") {
    return (
      <p className="pt-2 text-xs font-bold tracking-wide text-ink-faint uppercase">
        {block.text}
      </p>
    );
  }

  const text = cn("border-l-2 py-1 pl-3 leading-relaxed", block.heading && "font-bold");

  if (block.kind === "added") {
    return (
      <p className={cn(text, "border-verify bg-verify-soft")}>
        <span className="sr-only">Добавлено: </span>
        <ins className="underline decoration-verify decoration-2 underline-offset-2">
          {block.text}
        </ins>
      </p>
    );
  }

  if (block.kind === "removed") {
    return (
      <p className={cn(text, "border-signal bg-signal-soft text-ink-muted")}>
        <span className="sr-only">Убрано: </span>
        <del className="line-through decoration-signal">{block.text}</del>
      </p>
    );
  }

  return (
    <p className={cn(text, "border-rule-strong")}>
      <span className="sr-only">Изменено: </span>
      {block.tokens.map((token, index) =>
        token.op === "add" ? (
          <ins
            key={index}
            className="rounded-sm bg-verify-soft underline decoration-verify decoration-2 underline-offset-2"
          >
            {token.text}
          </ins>
        ) : token.op === "del" ? (
          <del
            key={index}
            className="rounded-sm bg-signal-soft text-ink-muted line-through decoration-signal"
          >
            {token.text}
          </del>
        ) : (
          <span key={index}>{token.text}</span>
        ),
      )}
    </p>
  );
}
