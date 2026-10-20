import { buildChange, changeParams } from "@/features/legal/changes";
import { LEGAL_FILES, type LegalId } from "@/features/legal/documents";

/**
 * Что изменилось в документе против прежней редакции — статический JSON.
 *
 * Сайт выгружается в статику, поэтому сравнение считается один раз на сборке:
 * по файлу на каждую архивную редакцию (`docs/legal/archive/<id>/<версия>.md`)
 * в каждом документе. Браузер забирает нужный, когда человек просит показать
 * правки в окне «Документы обновились», — вместе со страницами тяжёлый разбор
 * текста ему не нужен.
 *
 * Адресов, которых нет в архиве, не существует вовсе (`dynamicParams = false`):
 * окно получит 404 и скажет, что сравнивать не с чем.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return changeParams();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; from: string }> },
) {
  const { id, from } = await params;

  if (!(id in LEGAL_FILES)) return new Response("Not found", { status: 404 });

  const change = buildChange(id as LegalId, from);
  if (change === null) return new Response("Not found", { status: 404 });

  return Response.json(change);
}
