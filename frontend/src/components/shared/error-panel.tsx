import { cn } from "@/lib/utils/cn";
import { ApiError, type Problem, problemCode } from "@/lib/api-client/problem";

/**
 * FE015 — показ отказа.
 *
 * DoD: «`ErrorPanel` человекочитаемо показывает `Problem`-объект».
 *
 * --- Что значит «человекочитаемо» --------------------------------------
 *
 * Не «покрасить в красное». Отказ обязан сказать три вещи: что произошло,
 * почему и что теперь делать. Первые две приходят с сервера — `title` и
 * `detail` бэкенда написаны по-русски и по существу, и подменять их
 * фразой «Произошла ошибка» значило бы выбросить единственное, что
 * объясняет причину.
 *
 * Третью сервер сказать не может: он не знает, на каком экране человек.
 * Поэтому подсказка о следующем шаге выводится из КОДА проблемы —
 * `insufficient-balance` означает «уменьшите число суток», `conflict` —
 * «состояние изменилось, обновите страницу».
 *
 * --- `traceId` --------------------------------------------------------
 *
 * Показывается всегда и мелко. Это единственная нить между жалобой
 * человека и записью в журнале сервера (API_Conventions разд. 3), и
 * прятать её значило бы обречь разбор обращения на угадывание.
 *
 * --- Доступность -------------------------------------------------------
 *
 * `role="alert"`: отказ обязан быть объявлен программе чтения с экрана
 * сразу, а не при следующем перемещении фокуса (WCAG 2.2, 4.1.3).
 */

const NEXT_STEP: Record<string, string> = {
  "insufficient-balance": "Уменьшите запрашиваемое количество или дождитесь начисления.",
  conflict: "Состояние изменилось. Обновите страницу и повторите действие.",
  "immutable-resource": "Документ закрыт для изменений. Исправление оформляется отдельно.",
  "not-found": "Проверьте ссылку — запись могла быть удалена или перенесена.",
  "validation-failed": "Проверьте заполненные поля и повторите отправку.",
  "domain-invariant-violation": "Действие противоречит установленному порядку.",
  "rule-version-not-found": "Обратитесь к юристу подразделения: норма не заведена в системе.",
  "upstream-unavailable": "Повторите попытку через минуту.",
};

export interface ErrorPanelProps {
  error: ApiError | Problem;
  className?: string;
}

export function ErrorPanel({ error, className }: ErrorPanelProps) {
  const problem = error instanceof ApiError ? error.problem : error;
  const code = problemCode(problem);
  const nextStep = NEXT_STEP[code];

  return (
    <div
      role="alert"
      className={cn(
        "space-y-2 rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3",
        className,
      )}
    >
      <p className="font-display text-sm font-bold uppercase tracking-wide text-signal">
        {problem.title}
      </p>

      {problem.detail ? (
        <p className="text-sm leading-relaxed text-ink">{problem.detail}</p>
      ) : null}

      {nextStep ? <p className="text-sm text-ink-muted">{nextStep}</p> : null}

      {problem.traceId ? (
        <p className="font-mono text-[11px] text-ink-faint">
          Идентификатор обращения: {problem.traceId}
        </p>
      ) : null}
    </div>
  );
}
