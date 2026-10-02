"use client";

import { readLibraryFile, type LibraryFile } from "../storage/library";
import { importProfile, type StoredProfile } from "../storage/profile";

/**
 * Выбор файла профиля — полем, созданным на месте и тут же выброшенным.
 *
 * Поле, лежащее в разметке невидимкой, потребовало бы ссылки на себя
 * (`ref`), а ссылка эта нужна была бы в ШАПКЕ, где стоит кнопка «Из
 * файла», — то есть в чужом дереве. Здесь поле живёт ровно столько, сколько
 * длится нажатие.
 *
 * В документ оно всё же вставляется: Chromium срабатывает и на оторванном
 * от дерева, а Safari исторически требует, чтобы поле в нём было, — та же
 * оговорка, что и у ссылки для выгрузки (`save-to-file.tsx`).
 *
 * --- Почему это отдельный файл ---------------------------------------------
 *
 * Выбор файла нужен в двух местах: в проводнике («Из файла») и в окне
 * создания профиля («Открыть из файла»). Проводник же сам рисует это окно —
 * оставь выбор в нём, и окно тянулось бы за ним по кругу.
 *
 * --- Почему папки отдаются ОТДЕЛЬНО от профиля ------------------------------
 *
 * В файле лежит профиль, а рядом с ним — папки проводника и остальные
 * профили (`storage/library.ts`). Разбирают их два разных разбора: профиль
 * — строго, с ошибкой на весь файл, папки — молча, потому что их там может
 * не быть вовсе (файл прежней версии), и отказывать из-за этого человеку в
 * его же профиле было бы нелепо.
 */
export function pickProfileFile(
  onPicked: (profile: StoredProfile, file: LibraryFile | null) => void,
  onError: (message: string) => void,
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.className = "sr-only";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      const text = await file.text();
      onPicked(importProfile(text), readLibraryFile(text));
    } catch (cause) {
      onError(
        cause instanceof Error
          ? `${cause.message} Нужен файл, сохранённый этим же приложением.`
          : "Файл не прочитан.",
      );
    }
  });
  document.body.append(input);
  input.click();
}
