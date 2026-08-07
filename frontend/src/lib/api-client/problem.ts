/**
 * RFC 7807 `application/problem+json` — единственный конверт ошибок этого
 * API (API_Conventions разд. 3). Здесь он становится типом, который можно
 * показать человеку.
 *
 * Зачем отдельный тип, если можно прочитать `detail` строкой: у проблемы
 * есть расширения (RFC 7807 разд. 3.2), и некоторые из них — числа, без
 * которых ответ бесполезен. Отказ в списании суток отдыха несёт
 * `balanceDays` и `requestedDays`; выводить их регулярным выражением из
 * русского текста `detail` — ровно то, ради чего расширения и заведены.
 */

export interface Problem {
  /** URI вида `https://.../errors/insufficient-balance`. */
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  /** Расширения RFC 7807 разд. 3.2 — состав зависит от `type`. */
  [extension: string]: unknown;
}

const PROBLEM_CONTENT_TYPE = "application/problem+json";

export function isProblem(value: unknown): value is Problem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number"
  );
}

/** Короткий код ошибки из URI: `.../errors/conflict` -> `conflict`. */
export function problemCode(problem: Problem): string {
  const slash = problem.type.lastIndexOf("/");
  return slash === -1 ? problem.type : problem.type.slice(slash + 1);
}

/**
 * Ошибка запроса. Наследует `Error`, чтобы её ловил обычный `try/catch` и
 * `onError` TanStack Query, но несёт разобранный `Problem` — иначе каждый
 * потребитель разбирал бы тело сам.
 */
export class ApiError extends Error {
  readonly problem: Problem;
  readonly status: number;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.problem = problem;
    this.status = problem.status;
  }

  get code(): string {
    return problemCode(this.problem);
  }

  /** Числовое расширение проблемы, если оно есть и разбирается. */
  extensionNumber(key: string): number | undefined {
    const raw = this.problem[key];
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }
}

/**
 * Разбирает ответ в `ApiError`. Тело, не являющееся Problem, не
 * подменяется выдуманным: собирается проблема с тем, что есть, и
 * `type` = `about:blank`, как предписывает RFC 7807 для случая без типа.
 */
export async function toApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes(PROBLEM_CONTENT_TYPE) || contentType.includes("json")) {
    try {
      const body: unknown = await response.json();
      if (isProblem(body)) return new ApiError(body);
    } catch {
      // Тело нечитаемо — падать здесь нельзя, иначе исходная ошибка
      // потеряется за ошибкой её разбора.
    }
  }

  return new ApiError({
    type: "about:blank",
    title: response.statusText || "Запрос не выполнен",
    status: response.status,
  });
}
