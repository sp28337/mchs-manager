"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

/**
 * Открытый раздел страницы «слева список — справа содержимое».
 *
 * Живёт и в адресе (`#sync`), чтобы на раздел можно было сослаться. Первый в
 * списке открыт, пока адрес ни о каком не просит: при статическом экспорте
 * разметка собирается заранее, одна на все адреса, и до сверки с ней адреса
 * как бы нет (`() => ""`).
 *
 * Выбор не пишется в историю и не прокручивает страницу к якорю.
 * `replaceState` события `hashchange` не вызывает — подписчикам о нём
 * сообщается вручную.
 */
export function useHashSection<Id extends string>(
  ids: readonly Id[],
): [Id, (id: Id) => void] {
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash.slice(1),
    () => "",
  );
  const section = ids.find((id) => id === hash) ?? ids[0]!;

  const choose = useCallback((id: Id) => {
    window.history.replaceState(null, "", `#${id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  return [section, choose];
}
