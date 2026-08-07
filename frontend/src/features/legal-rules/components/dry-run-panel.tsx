"use client";

import { useId, useState } from "react";

import { ErrorPanel } from "@/components/shared/error-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client/client";

import { dryRunRuleVersion, publishRuleVersion } from "../api";
import type { DryRunResult, RuleVersion } from "../schemas";
import { RuleVersionDiffViewer } from "./rule-version-diff-viewer";

/**
 * FE044 — пробный прогон черновика и публикация.
 *
 * --- Прогон стоит ПЕРЕД публикацией, и это не совет ---------------------
 *
 * Публикация необратима: редакция становится основанием расчёта, прежняя
 * закрывается, а перерасчёт затрагивает уже начисленные компенсации.
 * Поэтому кнопка публикации на этом экране появляется только после
 * прогона — не «рекомендуется сначала прогнать», а буквально: до прогона
 * публиковать нечем.
 *
 * Это ограничение экрана, а не сервера: сервер опубликует черновик и без
 * прогона. Но человек, дошедший до этой страницы, публикует норму, по
 * которой пересчитают чужое довольствие, и предложить ему сделать это
 * вслепую значило бы участвовать в ошибке.
 *
 * --- Причина изменения обязательна --------------------------------------
 *
 * Сервер требует `changeReason` длиной не меньше 10 символов, и это
 * содержательное требование: публикация редакции — юридическое действие,
 * а запись о нём без указания, каким актом изменение вызвано, не
 * объясняет ничего проверяющему через два года.
 */

export interface DryRunPanelProps {
  version: RuleVersion;
  token?: string | null;
}

function isoMonthsAgo(months: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1))
    .toISOString()
    .slice(0, 10);
}

export function DryRunPanel({ version, token }: DryRunPanelProps) {
  const fromId = useId();
  const toId = useId();
  const sizeId = useId();
  const reasonId = useId();

  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [running, setRunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  function fail(cause: unknown) {
    setError(
      cause instanceof ApiError
        ? cause
        : new ApiError({
            type: "about:blank",
            title: "Сервер недоступен",
            status: 0,
            detail: "Не удалось выполнить действие. Проверьте соединение.",
          }),
    );
  }

  if (version.status !== "draft") {
    return (
      <p className="rounded-sm border-l-2 border-rule-strong bg-paper-sunken px-4 py-3 text-sm text-ink-muted">
        Пробный прогон делается для черновика: он сравнивает его с действующей
        редакцией. Эта редакция уже{" "}
        {version.status === "published" ? "опубликована" : "заменена следующей"},
        сравнивать её не с чем.
      </p>
    );
  }

  if (published) {
    return (
      <p className="rounded-sm border-l-2 border-verify bg-verify-soft px-4 py-3 text-sm">
        Редакция {version.versionNo} опубликована. Обновите страницу, чтобы увидеть
        новое состояние.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorPanel error={error} /> : null}

      <form
        className="flex flex-wrap items-start gap-4 rounded-sm border border-rule bg-paper-raised p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setRunning(true);
          setError(null);
          try {
            const outcome = await dryRunRuleVersion(
              version.id,
              {
                historicalPeriodStart: String(form.get("from") ?? ""),
                historicalPeriodEnd: String(form.get("to") ?? ""),
                sampleSize: Number(form.get("sampleSize") ?? 100),
              },
              { token, idempotencyKey: crypto.randomUUID() },
            );
            setResult(outcome);
          } catch (cause) {
            setResult(null);
            fail(cause);
          } finally {
            setRunning(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={fromId}>Исторический период с</Label>
          <Input
            id={fromId}
            name="from"
            type="date"
            required
            defaultValue={isoMonthsAgo(3)}
            className="w-44"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={toId}>по</Label>
          <Input
            id={toId}
            name="to"
            type="date"
            required
            defaultValue={isoMonthsAgo(0)}
            className="w-44"
          />
          <p className="max-w-44 text-xs text-ink-muted">
            Верхняя граница исключающая, как во всём API.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={sizeId}>Размер выборки</Label>
          <Input
            id={sizeId}
            name="sampleSize"
            type="number"
            min={1}
            max={10000}
            defaultValue={100}
            className="w-32"
            aria-describedby={`${sizeId}-hint`}
          />
          <p id={`${sizeId}-hint`} className="max-w-40 text-xs text-ink-muted">
            Предел поимённой выборки. Сегодня сравниваются значения формул, и
            размер на результат не влияет.
          </p>
        </div>

        <Button type="submit" variant="outline" className="mt-[1.375rem]" disabled={running}>
          {running ? "Прогон…" : "Прогнать вхолостую"}
        </Button>
      </form>

      {result ? <RuleVersionDiffViewer result={result} /> : null}

      {result ? (
        <form
          className="space-y-3 border-t border-rule pt-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const reason = String(form.get("changeReason") ?? "").trim();
            if (reason.length < 10) return;

            setPublishing(true);
            setError(null);
            try {
              await publishRuleVersion(
                version.id,
                { changeReason: reason },
                { token, idempotencyKey: crypto.randomUUID() },
              );
              setPublished(true);
            } catch (cause) {
              fail(cause);
            } finally {
              setPublishing(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Причина изменения</Label>
            <Input
              id={reasonId}
              name="changeReason"
              required
              minLength={10}
              maxLength={2000}
              placeholder="Приказ МЧС России от 27.06.2024 № 539, п. 103"
              className="max-w-xl"
              aria-describedby={`${reasonId}-hint`}
            />
            <p id={`${reasonId}-hint`} className="max-w-xl text-xs text-ink-muted">
              Не меньше 10 символов. Проверяющий через два года прочитает
              именно эту строку, поэтому назовите акт и пункт, а не «правка».
            </p>
          </div>

          <Button type="submit" variant="signal" disabled={publishing}>
            {publishing ? "Публикация…" : `Опубликовать редакцию ${version.versionNo}`}
          </Button>

          <p className="max-w-prose text-xs text-ink-muted">
            Публикация необратима: редакция станет основанием расчёта, предыдущая
            закроется этой датой.
            {result.differencesFound > 0
              ? " По результатам прогона величина изменится — а вместе с ней и расчёт всем, к кому относится область действия редакции."
              : " По результатам прогона величина не изменится."}
          </p>
        </form>
      ) : (
        <p className="max-w-prose text-sm text-ink-muted">
          Публикация станет доступна после пробного прогона. Опубликовать
          редакцию, не зная, чей расчёт она изменит, — не то действие, которое
          этот экран предлагает.
        </p>
      )}
    </div>
  );
}
