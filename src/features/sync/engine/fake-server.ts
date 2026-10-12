/**
 * Поддельный сервер синхронизации — для тестов, и только для них.
 *
 * Ведёт себя по разделам 4–6 контракта: одна последовательность ревизий
 * на аккаунт, расхождение в ответе `200` списком `conflicts`,
 * идемпотентность по `mutation_id`, `resync_required` для курсора старше
 * полной истории. Блобы не расшифровывает — как и настоящий.
 *
 * Зачем он: проверить движок целиком, с шифрованием, слиянием, двумя
 * устройствами и гонкой между выборкой и отправкой. Моки отдельных
 * вызовов такого не показывают — а ровно здесь и живут ошибки, из-за
 * которых у человека пропадает год отмеченных смен.
 *
 * Файл не называется `*.test.ts` намеренно: это не набор проверок, а их
 * общая часть. В сборку не попадает — приложение его не ввозит.
 */

interface Строка {
  id: string;
  kind: "index" | "profile";
  rev: number;
  deleted: boolean;
  blob: string | null;
  updated_at: string;
  size: number;
  mutations: Map<string, number>;
}

export interface FakeServerOptions {
  /** Ревизия, с которой история полна: ниже — `resync_required`. */
  minRevAvailable?: number;
}

export class FakeServer {
  rev = 0;
  minRevAvailable: number;
  readonly items = new Map<string, Строка>();
  /** Сколько запросов пришло — по ним видно, не ходит ли движок лишний раз. */
  readonly calls: { method: string; path: string }[] = [];
  /** Что сделать перед применением отправки: гонка в тестах ставится так. */
  beforePush: (() => void) | null = null;

  constructor(options: FakeServerOptions = {}) {
    this.minRevAvailable = options.minRevAvailable ?? 0;
  }

  /** `fetch` для `ApiClient`. */
  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    this.calls.push({ method, path: url.pathname });

    if (url.pathname.endsWith("/sync") && method === "GET") {
      return this.pull(url);
    }

    if (url.pathname.endsWith("/sync") && method === "POST") {
      return this.push(JSON.parse(String(init?.body ?? "{}")));
    }

    return проблема(404, "not_found");
  };

  private pull(url: URL): Response {
    const since = Number(url.searchParams.get("since") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "50");

    if (since > 0 && since < this.minRevAvailable) {
      return проблема(409, "resync_required");
    }

    const все = [...this.items.values()]
      .filter((строка) => строка.rev > since)
      .sort((первая, вторая) => первая.rev - вторая.rev);

    const страница = все.slice(0, limit);

    return json(200, {
      rev: this.rev,
      min_rev_available: this.minRevAvailable,
      items: страница.map((строка) => ({
        id: строка.id,
        kind: строка.kind,
        rev: строка.rev,
        deleted: строка.deleted,
        updated_at: строка.updated_at,
        size: строка.size,
        blob: строка.deleted ? null : строка.blob,
      })),
      has_more: все.length > страница.length,
    });
  }

  private push(body: { items?: unknown }): Response {
    this.beforePush?.();

    const items = Array.isArray(body.items) ? body.items : [];
    const applied: { id: string; kind: string; rev: number }[] = [];
    const conflicts: unknown[] = [];

    for (const сырое of items) {
      const правка = сырое as {
        id: string;
        kind: "index" | "profile";
        base_rev: number;
        mutation_id: string;
        deleted?: boolean;
        blob?: string | null;
      };

      const было = this.items.get(правка.id);
      const повтор = было?.mutations.get(правка.mutation_id);

      // Повтор той же правки не создаёт новой ревизии: сеть рвётся,
      // клиент повторяет, и дважды записанное выглядело бы конфликтом с
      // самим собой.
      if (повтор !== undefined) {
        applied.push({ id: правка.id, kind: правка.kind, rev: повтор });
        continue;
      }

      if ((было?.rev ?? 0) !== правка.base_rev) {
        conflicts.push({
          id: правка.id,
          kind: правка.kind,
          rev: было?.rev ?? 0,
          deleted: было?.deleted ?? false,
          updated_at: было?.updated_at ?? new Date(0).toISOString(),
          size: было?.size ?? 0,
          blob: было?.deleted === true ? null : (было?.blob ?? null),
        });
        continue;
      }

      this.rev += 1;
      const строка: Строка = {
        id: правка.id,
        kind: правка.kind,
        rev: this.rev,
        deleted: правка.deleted === true,
        blob: правка.deleted === true ? null : (правка.blob ?? null),
        updated_at: new Date().toISOString(),
        size: правка.blob?.length ?? 0,
        mutations: было?.mutations ?? new Map(),
      };
      строка.mutations.set(правка.mutation_id, this.rev);
      this.items.set(правка.id, строка);
      applied.push({ id: правка.id, kind: правка.kind, rev: this.rev });
    }

    return json(200, { rev: this.rev, applied, conflicts });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "test" },
  });
}

function проблема(status: number, code: string): Response {
  return new Response(JSON.stringify({ code, title: code, status }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}
