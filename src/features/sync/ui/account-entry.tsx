"use client";

import { LogIn, LogOut, RefreshCw, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

import { ПОЧТА_НЕ_ПОДТВЕРЖДЕНА } from "./messages";
import { инициал, короткоОСинхронизации, огонёк } from "./presence";
import { useSync } from "./sync-provider";

/**
 * Учётная запись в шапке — на каждой странице.
 *
 * --- Почему в шапке, а не только на своей странице -------------------------
 *
 * Раньше войти можно было двумя путями: по строчке в подвале рабочего
 * экрана и по плашке на посадочной, до которой надо долистать. То есть
 * возможность в приложении была, а в интерфейсе её не было: человек,
 * открывший сайт и желающий войти, искал вход там, где он есть у всех
 * сайтов, — в правом верхнем углу, — и не находил.
 *
 * Шапка — единственное место, которое видно ОТКУДА УГОДНО, и место входа
 * в ней не вопрос вкуса: там его ищут. Поэтому знак учётной записи стоит
 * последним в правом углу, за кнопками страницы и за выбором темы, и
 * стоит он на всех страницах одинаково — на посадочной, в расчёте, в
 * документах.
 *
 * --- Что он показывает -----------------------------------------------------
 *
 * Вошедшему — себя: кружок с буквой из адреса и точка состояния на нём
 * (`presence.ts`). Точка отвечает на вопрос «моё уехало?» без нажатия:
 * спокойная — уехало, приглушённая — ждёт связи, сигнальная — встало и
 * ждёт человека. Остальное за нажатием: адрес, строка состояния и три
 * действия — страница учётной записи, проход сейчас, выход.
 *
 * Не вошедшему — кнопку «Войти». Ею же заводят учётную запись: разводить
 * вход и регистрацию по двум кнопкам в шапке значило бы занять два места
 * из трёх свободных одним и тем же действием — открыть одну и ту же
 * страницу.
 *
 * --- Чего он не показывает -------------------------------------------------
 *
 * В сборке без синхронизации — ничего (`enabled.ts`): сервера нет, и
 * кнопка «Войти» вела бы на страницу, которая честно отвечает, что входить
 * некуда.
 *
 * На самой странице учётной записи кнопки «Войти» тоже нет: она привела бы
 * туда, где человек уже стоит. Знак вошедшего остаётся — он там не дверь,
 * а состояние, и по нему делают выход.
 */

/**
 * Вид кнопки в шапке — тот же, что у кнопок рабочего экрана
 * (`header-tools.tsx`): поднятая бумага, свет лампы по кромке, та же
 * высота и то же скругление. Своего вида у учётной записи быть не должно:
 * в одной строке стоят пять кнопок, и пятая, нарисованная иначе,
 * читалась бы чужой.
 */
const КНОПКА = cn(
  "lit inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl",
  "bg-paper-raised px-2 min-[360px]:px-3 text-sm font-medium text-ink",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
);

export function AccountEntry() {
  const { enabled, account } = useSync();
  const путь = usePathname();

  if (!enabled) return null;

  if (account === null) {
    // На странице учётной записи вход уже перед глазами: там форма.
    if (путь.startsWith("/account")) return null;

    return (
      <Link href="/account" className={КНОПКА} data-account-entry>
        <LogIn aria-hidden className="size-4.5 shrink-0 text-ink-muted" />
        {/* Слово появляется там, где для него есть место, — как у кнопок
            рабочего экрана. Ниже 640 точек от кнопки остаётся значок, а
            имя действия достаётся программе чтения. */}
        <span className="max-sm:sr-only">Войти</span>
      </Link>
    );
  }

  return <AccountMenu email={account.email} verified={account.email_verified} />;
}

/**
 * Меню вошедшего.
 *
 * --- Почему меню, а не ссылка прямо на страницу ----------------------------
 *
 * Действий у вошедшего три, и два из них со страницей не связаны вовсе:
 * «синхронизировать сейчас» нужно там, где человек правит график, а не на
 * странице про данные; «выйти» — тем более. Ссылка в шапке означала бы, что
 * ради выхода надо сперва уйти со своего графика.
 *
 * --- Что здесь сделано руками и почему -------------------------------------
 *
 * Готового выпадающего меню в приложении нет, и заводить его ради одного
 * места — лишняя зависимость. Поведение у такого меню, впрочем, не
 * «показать и спрятать»: оно закрывается по `Esc`, по нажатию мимо, по
 * уходу фокуса наружу и при переходе на другую страницу. Пропусти любое из
 * четырёх — и меню остаётся висеть поверх страницы, которую человек уже
 * читает.
 *
 * Роль `menu` не объявлена намеренно: с ней программа чтения обещает
 * человеку стрелки и переходы по буквам, которых здесь нет. Внутри обычные
 * ссылка и кнопки, и ходят по ним табуляцией — ровно так, как они и
 * устроены.
 */
function AccountMenu({ email, verified }: { email: string; verified: boolean }) {
  const { phase, dirty, syncedAt, report, stalled, busy, actions } = useSync();
  const гнездо = useRef<HTMLDivElement>(null);
  const id = useId();
  const путь = usePathname();

  // Открыто не «да или нет», а «на какой странице открыто».
  // ------------------------------------------------------------------
  // Переход на другую страницу обязан закрывать меню: оно висело бы
  // поверх уже другого содержимого, а нажатие по его собственной ссылке —
  // это и есть переход. Сторожить это эффектом нельзя (он гасил бы меню
  // вторым проходом отрисовки), да и незачем: достаточно помнить страницу,
  // на которой меню открыли, и считать открытым только её.
  const [открытоНа, setОткрытоНа] = useState<string | null>(null);
  const открыто = открытоНа === путь;
  const setОткрыто = (надо: boolean) => setОткрытоНа(надо ? путь : null);

  useEffect(() => {
    if (!открыто) return;

    // Закрывается прямо `setОткрытоНа(null)`, а не через `setОткрыто`:
    // тот замкнут на нынешний путь, и зависимость эффекта от него
    // пересоздавала бы три слушателя на каждом переходе.
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

  const состояние = короткоОСинхронизации({
    phase,
    dirty,
    syncedAt,
    принято: report === null ? 0 : report.received + report.deleted,
  });

  return (
    <div ref={гнездо} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setОткрыто(!открыто)}
        aria-expanded={открыто}
        aria-controls={id}
        // Имя кнопки называет и чья она, и что по ней будет: без адреса
        // диктор прочёл бы «кнопка Б», а буква в кружке — это весь её
        // видимый текст.
        aria-label={`Учётная запись ${email}`}
        title={email}
        className={cn(КНОПКА, "px-1 min-[360px]:px-1")}
        data-account-entry
      >
        <Avatar email={email} state={огонёк({ phase, dirty, syncedAt, stalled })} />
      </button>

      {открыто && (
        <div
          id={id}
          // `modal-lift` — та же каймá и тень, что у окон приложения: меню
          // лежит поверх страницы, и поднято оно на ту же высоту.
          className={cn(
            "modal-lift absolute right-0 top-full z-100 mt-2 w-72 max-w-[calc(100vw-3rem)]",
            "overflow-hidden rounded-xl bg-paper-raised",
          )}
        >
          <div className="space-y-0.5 border-b border-rule px-4 py-3">
            <p className="truncate text-sm font-medium text-ink" title={email}>
              {email}
            </p>
            <p className="text-xs text-ink-muted">{состояние}</p>
            {!verified && (
              <p className="pt-1 text-xs text-signal">{ПОЧТА_НЕ_ПОДТВЕРЖДЕНА}</p>
            )}
          </div>

          <div className="p-1.5">
            <Пункт href="/account" icon={UserRound}>
              Учётная запись
            </Пункт>
            <Пункт
              icon={RefreshCw}
              disabled={busy}
              onClick={() => {
                void actions.syncNow();
                setОткрыто(false);
              }}
            >
              Синхронизировать сейчас
            </Пункт>
            <Пункт
              icon={LogOut}
              disabled={busy}
              onClick={() => {
                void actions.logout();
                setОткрыто(false);
              }}
            >
              Выйти
            </Пункт>
          </div>
        </div>
      )}
    </div>
  );
}

/** Строка меню: значок слева, слово за ним, во всю ширину. */
const ПУНКТ = cn(
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink",
  "cursor-pointer transition-colors hover:bg-paper-sunken",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-muted",
);

function Пункт({
  href,
  icon: Icon,
  disabled,
  onClick,
  children,
}: {
  href?: string;
  icon: typeof UserRound;
  disabled?: boolean;
  onClick?: () => void;
  children: string;
}) {
  if (href !== undefined) {
    return (
      <Link href={href} className={ПУНКТ}>
        <Icon aria-hidden />
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={ПУНКТ}>
      <Icon aria-hidden />
      {children}
    </button>
  );
}

/**
 * Знак учётной записи: буква из адреса и точка состояния.
 *
 * --- Почему круг, когда всё приложение скруглено прямоугольниками ---------
 *
 * Круг здесь единственный, и это нарочно: круглый знак с буквой означает
 * «это вы» — так он читается на любом сайте, где есть вход, и спорить с
 * этим ожиданием ради единообразия скруглений значило бы сделать знак
 * непонятным. Всё остальное в шапке — прямоугольники с `rounded-xl`.
 *
 * Буквы может и не быть: адрес, начинающийся с цифры, даёт знак со
 * значком человека (`presence.ts`).
 */
export function Avatar({
  email,
  state,
  big,
  className,
}: {
  email: string;
  state: "ok" | "wait" | "attention";
  /** Крупный знак — для страницы учётной записи, где он называет хозяина. */
  big?: boolean;
  className?: string;
}) {
  const буква = инициал(email);

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={cn(
          "grid place-items-center rounded-full bg-paper-sunken",
          "font-display font-bold uppercase leading-none text-ink",
          big ? "size-12 text-lg" : "size-7 text-xs",
        )}
      >
        {буква ?? <UserRound className={big ? "size-6 text-ink-muted" : "size-4 text-ink-muted"} />}
      </span>
      {/* Точка на знаке — не украшение: она отвечает на «моё уехало?» без
          нажатия. Обводка цвета поднятой бумаги отделяет её от буквы, иначе
          на светлой теме точка сливалась бы с кромкой кружка. */}
      <span
        aria-hidden
        className={cn(
          "absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-paper-raised",
          big ? "size-3.5" : "size-2.5",
          state === "ok" && "bg-verify",
          state === "wait" && "bg-ink-faint",
          state === "attention" && "bg-signal",
        )}
      />
    </span>
  );
}
