import { cn } from "@/lib/utils/cn";

import type { DryRunResult } from "../schemas";

/**
 * FE044 — расхождения черновика с действующей редакцией.
 *
 * DoD: «diff подсвечивает расхождения draft/текущей версии по
 * сотрудникам».
 *
 * --- Почему сравниваются ЛЮДИ, а не тексты формул -----------------------
 *
 * Текстовый diff двух формул показывает, что изменилось в записи. Вопрос
 * же, на который юрист обязан ответить перед публикацией, другой: КОГО и
 * НА СКОЛЬКО это изменит. Две формулы могут отличаться до неузнаваемости
 * и давать одно и то же число; и наоборот — правка одной константы
 * меняет расчёт трёмстам сотрудникам.
 *
 * Поэтому «расхождение» здесь — результат пробного прогона по реальным
 * историческим данным: сервер считает обе редакции и возвращает тех, у
 * кого числа разошлись.
 *
 * --- Что сервер сравнивает НА САМОМ ДЕЛЕ --------------------------------
 *
 * Сегодня — ЗНАЧЕНИЯ ФОРМУЛ, а не пересчитанные табели. Так решено в
 * `dry_run_rule_version`, и решено обоснованно: поимённый прогон требует
 * расчётов, принадлежащих `time_accounting`, а `legal_rules` о его
 * существовании не знает и знать не должен.
 *
 * Отсюда форма ответа: `comparedEntities` равен нулю, а
 * `differencesFound` — это 0 или 1, признак «величина изменилась», а не
 * число людей. Показать «расхождений: 1 из 0 сотрудников» значило бы
 * выдать признак за счёт и дать юристу число, которого никто не считал.
 * Поэтому вывод формулируется тем языком, каким сделано сравнение:
 * изменилась ли ВЕЛИЧИНА.
 *
 * Поимённая таблица остаётся: контракт допускает `sampleDifferences`, и
 * когда ретроспективный пересчёт появится на стороне `time_accounting`,
 * она заполнится. Пока её нет — сказано, что её нет, а не показано
 * пустое место.
 *
 * --- Ноль расхождений — это ответ, а не пустота -------------------------
 *
 * «Величина не изменилась» — законный и важный результат: редакция
 * уточняет формулировку, не меняя расчёта. Показать на это место пустой
 * экран значило бы заставить юриста гадать, прошёл ли прогон.
 */

export interface RuleVersionDiffViewerProps {
  result: DryRunResult;
  className?: string;
}

function formatValue(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function formatDelta(oldValue: number, newValue: number): string {
  const delta = newValue - oldValue;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${formatValue(delta)}`;
}

export function RuleVersionDiffViewer({ result, className }: RuleVersionDiffViewerProps) {
  const clean = result.differencesFound === 0;
  // Поимённый прогон состоялся только если сервер кого-то сверял. Сегодня
  // он этого не делает (см. заголовок файла), и молчаливо приписывать
  // сравнению людей нельзя.
  const perEmployee = result.comparedEntities > 0;

  return (
    <div className={cn("space-y-4", className)}>
      <div
        className={cn(
          "rounded-sm border-l-2 px-4 py-3",
          clean ? "border-verify bg-verify-soft" : "border-signal bg-signal-soft",
        )}
      >
        <p className="font-medium">
          {clean
            ? "Величина не изменится"
            : `Величина изменится: ${formatValue(result.oldValue)} → ${formatValue(result.newValue)}`}
        </p>
        <p className="mt-1 max-w-prose text-sm">
          {clean
            ? "Черновик даёт то же значение, что действующая редакция. Публикация не изменит расчёт по этому правилу."
            : "Публикация изменит расчёт всем, к кому применяется эта область действия, за периоды, попадающие в срок действия редакции."}
        </p>

        {perEmployee ? (
          <p className="mt-1 max-w-prose text-sm">
            Сверено сотрудников: {result.comparedEntities}, расхождений:{" "}
            {result.differencesFound}. Это утверждение о выборке, а не обо всём
            личном составе.
          </p>
        ) : (
          // Умолчать об этом нельзя: юрист вправе знать, что «изменится»
          // получено сравнением ФОРМУЛ, а не пересчётом чьих-то табелей.
          <p className="mt-1 max-w-prose text-sm">
            Сравнивались значения формул, а не пересчитанные табели: поимённый
            прогон — операция модуля учёта времени, и эта проверка её не
            выполняет. Для правила, задающего одну величину, разница величин и
            есть разница расчёта.
          </p>
        )}
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        <Figure caption="Действующая редакция" value={formatValue(result.oldValue)} />
        <Figure caption="Черновик" value={formatValue(result.newValue)} />
        <Figure
          caption="Разница"
          value={formatDelta(result.oldValue, result.newValue)}
          emphatic={result.oldValue !== result.newValue}
        />
        {perEmployee ? (
          <Figure caption="Сверено сотрудников" value={String(result.comparedEntities)} />
        ) : null}
      </dl>

      {result.sampleDifferences.length === 0 && !clean ? (
        <p className="max-w-prose text-sm text-ink-muted">
          Списка сотрудников нет: поимённое сравнение здесь не выполняется.
          Ретроспективный пересчёт по конкретным людям — отдельная операция
          модуля учёта времени, и до её появления «кого затронет» определяется
          областью действия редакции, а не этим прогоном.
        </p>
      ) : null}

      {result.sampleDifferences.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink-muted">
            Расхождения по сотрудникам
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Сотрудники, у которых черновик даёт результат, отличный от действующей
                редакции
              </caption>
              <thead>
                <tr className="border-b border-rule-strong">
                  <th scope="col" className="py-1 pr-4 text-left font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
                    Сотрудник
                  </th>
                  <th scope="col" className="py-1 pr-4 text-right font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
                    Сейчас
                  </th>
                  <th scope="col" className="py-1 pr-4 text-right font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
                    По черновику
                  </th>
                  <th scope="col" className="py-1 text-right font-display text-xs font-bold uppercase tracking-wide text-ink-muted">
                    Разница
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.sampleDifferences.map((row) => {
                  const grew = row.newValue > row.oldValue;
                  return (
                    <tr key={row.employeeId} className="border-b border-rule">
                      <td className="py-1 pr-4 font-mono text-xs">{row.employeeId}</td>
                      <td className="py-1 pr-4 text-right font-mono">
                        {formatValue(row.oldValue)}
                      </td>
                      <td className="py-1 pr-4 text-right font-mono">
                        {formatValue(row.newValue)}
                      </td>
                      <td
                        className={cn(
                          "py-1 text-right font-mono font-medium",
                          grew ? "text-verify" : "text-signal",
                        )}
                      >
                        {/* Знак — не только цвет: направление изменения
                            читается и в монохроме (WCAG 2.2, 1.4.1). */}
                        {formatDelta(row.oldValue, row.newValue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {result.differencesFound > result.sampleDifferences.length ? (
            <p className="text-xs text-ink-muted">
              Показаны первые {result.sampleDifferences.length} из{" "}
              {result.differencesFound}. Увеличьте размер выборки, чтобы увидеть
              больше.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Figure({
  caption,
  value,
  emphatic,
}: {
  caption: string;
  value: string;
  emphatic?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <dd
        className={cn("font-mono text-2xl leading-none", emphatic ? "text-signal" : undefined)}
      >
        {value}
      </dd>
      <dt className="text-xs text-ink-muted">{caption}</dt>
    </div>
  );
}
