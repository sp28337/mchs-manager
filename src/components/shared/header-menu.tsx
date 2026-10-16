"use client";

import { CalendarDays, LogIn, LogOut, UserRound, type LucideIcon } from "lucide-react";
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

import {
  DoorMark,
  HEADER_ACTION,
  HEADER_WORD,
  MenuMark,
} from "@/components/shared/header-action";
import { Materialize } from "@/components/ui/materialize";
import { SYNC_ENABLED } from "@/features/sync/ui/enabled";
import { useSync } from "@/features/sync/ui/sync-provider";
import { cn } from "@/lib/utils/cn";

/**
 * Единственная кнопка в шапке: слово «МЕНЮ» с тремя полосами и список под
 * ним — на каждой странице сайта.
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
 * --- Как оно называет открытый раздел --------------------------------------
 *
 * Пока на месте графика показаны настройки, статистика или проводник, на
 * месте слова «МЕНЮ» стоит имя раздела, а три полосы складываются в
 * крестик — и нажатие закрывает раздел, а не открывает список. Так кнопка
 * называет то, что нажатие СЕЙЧАС сделает, а не то, чем она была минуту
 * назад.
 *
 * Прежде имя раздела подменяло название сайта слева. Это было неверно по
 * существу: раздел называла ссылка ДОМОЙ, и человек, нажав по слову
 * «НАСТРОЙКИ», уходил на посадочную страницу.
 *
 * Пока раздел открыт, список не открыть вовсе, и это намеренно: у
 * настроек и статистики своих действий в нём нет, а три действия
 * проводника переехали в сам проводник (`profile-explorer.tsx`).
 *
 * --- Почему словом, а не значком -------------------------------------------
 *
 * Кружок с человечком здесь был, и был понятен, но в строке с «ГРАФИК 1|3»
 * читался чужим: слева узкие прописные буквы и квадраты знака, справа
 * кругляш с иконкой из набора. Теперь справа то же самое, что слева, —
 * слово тем же шрифтом и знак того же размера (`header-action.tsx`):
 * «МЕНЮ» с тремя полосами вошедшему, «ВХОД» с дверью остальным.
 *
 * Заодно отпал вопрос, что рисовать на знаке не вошедшему: человечек
 * обещал учётную запись там, где её ещё нет.
 */

/** Закрыть меню — любому пункту внутри него, без передачи обратного вызова. */
const Закрыть = createContext<() => void>(() => undefined);

/** Открытый раздел: чем он называется и чем закрывается. */
export interface OpenSection {
  /** Имя раздела — встаёт вместо слова «Меню». */
  label: string;
  /** Закрыть раздел: это и делает нажатие, пока он открыт. */
  close: () => void;
}

export function HeaderMenu({
  items,
  section,
  compact = false,
}: {
  items?: ReactNode;
  /** Раздел, показанный вместо страницы. */
  section?: OpenSection;
  /**
   * На узком экране — без слова, одни три полосы: середину шапки занимает
   * кнопка периода (`SiteHeader`, `center`), и слово рядом с ней в строку
   * не встаёт. Слово остаётся программе чтения (`COMPACT_WORD`).
   */
  compact?: boolean;
}) {
  const { account, actions } = useSync();
  const путь = usePathname();

  // Открыто не «да или нет», а «на какой странице открыто»: переход
  // закрывает меню сам, и сторожить это эффектом (то есть вторым проходом
  // отрисовки) не нужно.
  const [открытоНа, setОткрытоНа] = useState<string | null>(null);
  const открыто = открытоНа === путь && section === undefined;

  /**
   * Имя раздела держится и после закрытия — ради растворения.
   *
   * Слова лежат в одной ячейке грида и проступают друг в друга
   * (`Materialize`). Забудь мы имя в тот же миг, когда раздел закрыт, —
   * гаснуть было бы нечему: вместо растворения вышло бы мигание.
   *
   * Правка состояния во время отрисовки — приём из документации React
   * («adjusting state when props change»): React тут же отрисовывает
   * заново, ничего не показав человеку, и обходится без эффекта.
   */
  const [прежнее, setПрежнее] = useState("Меню");

  if (section !== undefined && section.label !== прежнее) setПрежнее(section.label);
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

  // На самой странице учётной записи из раздела учётной записи в меню
  // остаётся только выход. «Войти» и «Учётная запись» вели бы туда, где
  // человек уже стоит: вход здесь — форма посреди экрана, а сама запись —
  // вся эта страница.
  //
  // Прежде меню на этой странице не рисовалось вовсе, а вместо него
  // справа стояло «ОТКРЫТЬ ГРАФИК». Теперь переход к расчёту — строкой в
  // меню (`OpenScheduleItem`), и шапка одинакова на всех страницах:
  // справа всегда «МЕНЮ».
  const наЗаписи = путь === "/account";

  // Страница без своих действий и без учётной записи — меню не из чего
  // собирать. В сборке без синхронизации это все страницы, кроме
  // рабочего экрана.
  if (пусто && (!SYNC_ENABLED || account === null)) {
    if (!SYNC_ENABLED) return null;

    // Одно действие — одно слово: меню из единственного пункта «Войти»
    // прятало бы за нажатием то, что и так умещается в строке.
    return (
      <Link href="/account" className={HEADER_ACTION} data-account-entry>
        <span className={cn(HEADER_WORD, compact && COMPACT_WORD)}>Вход</span>
        <DoorMark />
      </Link>
    );
  }

  return (
    // `flex`, а не блок: в блоке кнопка встаёт в строку текста и садится
    // на её базовую линию. Пока слово видно, это незаметно, но в сжатой
    // шапке слова нет, и строка обёртки вырастала до 34 точек — три
    // полосы поднимались на три точки выше знака сайта.
    <div ref={гнездо} className="relative flex shrink-0">
      <button
        type="button"
        onClick={() => {
          if (section !== undefined) section.close();
          else setОткрытоНа(открыто ? null : путь);
        }}
        aria-expanded={section === undefined ? открыто : undefined}
        aria-controls={section === undefined ? id : undefined}
        // Имя кнопки, пока открыт раздел, называет действие целиком:
        // видимое слово — это имя раздела, и одного его мало, чтобы
        // понять, что нажатие закроет. Само слово в имя входит
        // (WCAG 2.5.3): «Закрыть: настройки».
        aria-label={section === undefined ? undefined : `Закрыть: ${section.label}`}
        // Адрес уходит в подсказку, а не в имя: диктор прочитает его в
        // первой же строке открытого меню.
        title={section !== undefined ? `Закрыть: ${section.label}` : (account?.email ?? "Меню")}
        className={HEADER_ACTION}
        data-account-entry
      >
        {/* Оба слова лежат в одной ячейке грида: ширина считается по
            большему из них, и подмена не дёргает знак рядом. Прижаты к
            правому краю — туда же, где стоит знак. */}
        <span className={cn("grid justify-items-end", compact && COMPACT_WORD)}>
          <Materialize
            show={section === undefined}
            ariaHidden={section !== undefined}
            durationClassName="duration-200"
            className={cn("col-start-1 row-start-1", HEADER_WORD)}
          >
            Меню
          </Materialize>
          <Materialize
            show={section !== undefined}
            ariaHidden={section === undefined}
            durationClassName="duration-200"
            className={cn("col-start-1 row-start-1", HEADER_WORD)}
          >
            {прежнее}
          </Materialize>
        </span>
        <MenuMark cross={section !== undefined} />
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

            {SYNC_ENABLED && !(наЗаписи && account === null) && (
              <div className={cn("p-1.5", items !== undefined && "border-t border-rule")}>
                {account === null ? (
                  <MenuItem icon={LogIn} href="/account">
                    Войти
                  </MenuItem>
                ) : (
                  <>
                    {наЗаписи ? null : (
                      <MenuItem icon={UserRound} href="/account">
                        Учётная запись
                      </MenuItem>
                    )}
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

/**
 * Переход к расчёту — строкой меню на страницах, где расчёта нет.
 *
 * --- Почему в меню, а не словом в шапке ------------------------------------
 *
 * Здесь справа в шапке стояло «ОТКРЫТЬ ГРАФИК» с четырьмя клетками, и
 * шапка была разной на разных страницах: на расчёте «МЕНЮ», на странице
 * учётной записи — переход, на странице «нет такой» — плашка «График».
 * Человек, привыкший нажимать в правый верхний угол за меню, на соседней
 * странице получал там другую кнопку. Теперь угол один на весь сайт, а
 * переход к расчёту — первая строка в нём.
 *
 * Стоит он там, откуда к расчёту и идут: на посадочной, на страницах
 * учётной записи и на странице «нет такой». На посадочной он дублирует
 * кнопку первого экрана, и это намеренно: кнопка видна, пока первый экран
 * на экране, а меню — с любого места страницы, докрученной хоть до
 * подвала. Со страниц документов переход убран (читать их приходят со
 * стороны), а на самом расчёте он вёл бы туда, где человек стоит.
 *
 * --- Почему отдельным компонентом ------------------------------------------
 *
 * Страницы, которым он нужен, — серверные компоненты, а значок пункта —
 * функция, и через границу сервера и клиента её не передать. Готовый
 * пункт без свойств передаётся без вопросов.
 */
export function OpenScheduleItem() {
  return (
    <MenuItem icon={CalendarDays} href="/calculator">
      Открыть график
    </MenuItem>
  );
}

/**
 * Слово кнопки в сжатой шапке: на узком экране оно уходит с глаз, но не
 * из разметки — имя кнопки остаётся тем же словом.
 *
 * Порог — замер: с 520 точек «ГРАФИК 1|3» (130), кнопка периода с самой
 * длинной подписью (150) и «СТАТИСТИКА» с крестиком (137) встают в строку
 * так, что кнопка остаётся точно по оси экрана. Уже — слово сталкивало бы
 * её с середины, а ещё уже — выталкивало бы из строки.
 *
 * `max-[520px]` в Tailwind 4 — это «уже 520» (`not (min-width: 520px)`):
 * на самих 520 слово уже видно.
 */
const COMPACT_WORD = "max-[520px]:sr-only";

const ПУНКТ = cn(
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink",
  "cursor-pointer transition-colors hover:bg-paper-sunken",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
  "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-muted",
);

/**
 * Кость меню для заглушки: то же слово и тот же знак, пока читается
 * профиль, — прозрачные и на плашке. Место, которое займёт меню,
 * отмеряется им самим, а не подобранным прямоугольником.
 */
export function HeaderMenuBone({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        HEADER_ACTION,
        "skeleton-bone pointer-events-none rounded-sm bg-paper-raised",
        "[&_*]:text-transparent [&_svg]:opacity-0",
      )}
    >
      <span className={cn(HEADER_WORD, compact && COMPACT_WORD)}>Меню</span>
      <MenuMark />
    </span>
  );
}
