import { diffDocuments, type DocumentChange } from "./diff";
import {
  LEGAL_FILES,
  listArchivedVersions,
  loadArchivedBody,
  loadLegalDocument,
  type LegalId,
} from "./documents";

/**
 * Чем действующая редакция документа отличается от одной из прошлых.
 *
 * Серверный модуль: читает файлы на сборке (`documents.ts`). Результат уходит
 * статическим JSON (`app/legal-changes/[id]/[from]/route.ts`), а браузер
 * показывает его в окне «Документы обновились». Сравнение с редакцией, которой
 * нет в архиве, невозможно, и это не ошибка: окно честно скажет, что
 * сравнивать не с чем.
 */
export function buildChange(id: LegalId, from: string): DocumentChange | null {
  const before = loadArchivedBody(id, from);
  if (before === null) return null;

  const now = loadLegalDocument(id);
  if (now.version === from) return null;

  return diffDocuments(before, now.body, from, now.version);
}

/** Какие сравнения собираются на сборке: каждая архивная редакция с действующей. */
export function changeParams(): { id: LegalId; from: string }[] {
  const params: { id: LegalId; from: string }[] = [];

  for (const id of Object.keys(LEGAL_FILES) as LegalId[]) {
    const current = loadLegalDocument(id).version;

    for (const from of listArchivedVersions(id)) {
      if (from !== current) params.push({ id, from });
    }
  }

  return params;
}
