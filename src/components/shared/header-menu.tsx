"use client";

import { LogIn, LogOut, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  useRef,
  type ReactNode,
} from "react";

import { SYNC_ENABLED } from "@/features/sync/ui/enabled";
import { useSync } from "@/features/sync/ui/sync-provider";
import { cn } from "@/lib/utils/cn";

/**
 * Единственная кнопка в шапке: кружок с человечком и меню под ним.
 *
 * --- Что в нём лежит --------------------------------------------------------
 *
 * Сначала действия страницы (`items`) — на рабочем экране это настройки,
 * статистика, проводник и выгрузка в файл, — потом учётная запись: кто
 * вошёл, страница записи, выход. Не вошедшему вместо двух последних
 * строк — «Войти».
 *
 * --- Почему всё в одном меню ------------------------------------------------
 *
 * Кнопки рабочего экрана стояли в шапке в ряд, и это было верно, пока их
 * было четыре и больше в строку ничего не просилось. С учётной записью
 * строка перестала сходиться: на телефоне четыре кнопки, кружок и
 * название сайта в одну строку не встают — уступать приходилось названию,
 * и от него оставался один логотип.
 *
 * Меню снимает спор о ширине целиком: в шапке один предмет на любом
 * экране, а место под названием сайта не зависит от того, сколько
 * действий у страницы. Плата известна и названа вслух: до настроек теперь
 * два нажатия вместо одного.
 *
 * --- Почему кружок, когда всё остальное скруглено прямоугольниками ---------
 *
 * Круглый знак с человечком означает «это вы» — так он читается на любом
 * сайте, где есть вход, и спорить с этим ожиданием ради единообразия
 * скруглений значило бы сделать знак непонятным. Всё прочее у него общее
 * с кнопками приложения: та же поднятая бумага, тот же свет лампы по
 * кромке и тот же блик под курсором (`lit` в `globals.css`).
 */

/** Закрыть меню — любому пункту внутри него, без передачи обратного вызова. */
const Закрыть = createContext<() => void>(() => undefined);

/** Общий вид кнопки в шапке: кружок цвета поднятой бумаги под лампой. */
const КРУГ = cn(
  "lit inline-flex size-9 shrink-0 cursor-pointer items-center justify-center",
  "rounded-full bg-paper-raised text-ink",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);

/** Кнопка «Войти» — для страниц, у которых своих действий нет. */
const КНОПКА = cn(
  "lit inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl",
  "bg-paper-raised px-2 min-[360px]:px-3 text-sm font-medium text-ink",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);

export function HeaderMenu({ items }: { items?: ReactNode }) {
  const { account, actions } = useSync();
  const путь = usePathname();

  // Открыто не «да или нет», а «на какой странице открыто»: переход
  // закрывает меню сам, и сторожить это эффектом (то есть вторым проходом
  // отрисовки) не нужно.
  const [открытоНа, setОткрытоНа] = useState<string | null>(null);
  const открыто = открытоНа === путь;
  const гнездо = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!открыто) return;

    const закрыть = () => setОткрытоНа(null);
    const мимо = (событие: PointerEvent) => {
      if (!гнездо.current?.contains(событие.target as Node)) закрыть();
    };
    const клавиша = (событие: KeyboardEvent) => {
      if (событие.key === "Escape") закрыть();
    };
    const фокус = (событие: FocusEvent) => {
      if (!гнездо.current?.contains(событие.target as Node)) закрыть();
    };

    document.addEventListener("pointerdown", мимо);
    document.addEventListener("keydown", клавиша);
    document.addEventListener("focusin", фокус);

    return () => {
      document.removeEventListener("pointerdown", мимо);
      document.removeEventListener("keydown", клавиша);
      document.removeEventListener("focusin", фокус);
    };
  }, [открыто]);

  const пусто = items === undefined;

  // Страница без своих действий и без учётной записи — меню не из чего
  // собирать. В сборке без синхронизации это все страницы, кроме
  // рабочего экрана.
  if (пусто && (!SYNC_ENABLED || account === null)) {
    if (!SYNC_ENABLED || путь.startsWith("/account")) return null;

    // Одно действие — одна кнопка: меню из единственного пункта «Войти»
    // пряталo бы за нажатием то, что и так умещается словом.
    return (
      <Link href="/account" className={КНОПКА} data-account-entry>
        <LogIn aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
        <span className="max-sm:sr-only">Войти</span>
      </Link>
    );
  }

  return (
    <div ref={гнездо} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setОткрытоНа(открыто ? null : путь)}
        aria-expanded={открыто}
        aria-controls={id}
        aria-label="Меню"
        title={account?.email ?? "Меню"}
        className={КРУГ}
        data-account-entry
      >
        <UserRound aria-hidden className="size-4.5 text-ink-muted" />
      </button>

      {открыто && (
        <Закрыть.Provider value={() => setОткрытоНа(null)}>
          <div
            id={id}
            // `modal-lift` — та же кайма и тень, что у окон приложения:
            // меню лежит поверх страницы и поднято на ту же высоту.
            className={cn(
              "modal-lift absolute right-0 top-full z-100 mt-2 w-64 max-w-[calc(100vw-3rem)]",
              "overflow-hidden rounded-xl bg-paper-raised",
            )}
          >
            {account !== null && (
              <p
                className="truncate border-b border-rule px-4 py-3 text-sm font-medium text-ink"
                title={account.email}
              >
                {account.email}
              </p>
            )}

            {items !== undefined && <div className="p-1.5">{items}</div>}

            {SYNC_ENABLED && (
              <div className={cn("p-1.5", items !== undefined && "border-t border-rule")}>
                {account === null ? (
                  <MenuItem icon={LogIn} href="/account">
                    Войти
                  </MenuItem>
                ) : (
                  <>
                    <MenuItem icon={UserRound} href="/account">
                      Учётная запись
                    </MenuItem>
                    <MenuItem icon={LogOut} onClick={() => void actions.logout()}>
                      Выйти
                    </MenuItem>
                  </>
                )}
              </div>
            )}
          </div>
        </Закрыть.Provider>
      )}
    </div>
  );
}

/**
 * Строка меню: значок слева, слово за ним, во всю ширину.
 *
 * Нажатие закрывает меню само — через окружение, а не обратным вызовом
 * от каждого вызывающего: забытое закрытие оставляло бы меню висеть
 * поверх того, что человек только что открыл.
 */
export function MenuItem({
  icon: Icon,
  href,
  onClick,
  children,
}: {
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  children: string;
}) {
  const закрыть = useContext(Закрыть);

  if (href !== undefined) {
    return (
      // Переход закрывает меню сам (оно помнит свою страницу), но «Учётная
      // запись», нажатая НА странице учётной записи, никуда не ведёт — и
      // меню осталось бы висеть.
      <Link href={href} className={ПУНКТ} onClick={закрыть}>
        <Icon aria-hidden />
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        onClick?.();
        закрыть();
      }}
      className={ПУНКТ}
    >
      <Icon aria-hidden />
      {children}
    </button>
  );
}

const ПУНКТ = cn(
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink",
  "cursor-pointer transition-colors hover:bg-paper-sunken",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
  "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-muted",
);

/** Кость меню для заглушки: тот же кружок, пока читается профиль. */
export function HeaderMenuBone() {
  return <span className={cn(КРУГ, "skeleton-bone")} />;
}
