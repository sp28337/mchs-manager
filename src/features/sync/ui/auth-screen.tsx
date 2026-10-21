"use client";

import { Check, Eye, EyeOff, KeyRound, LogIn, Mail, TriangleAlert, UserPlus } from "lucide-react";
import {
  useCallback,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useNavigate } from "@/components/shared/navigation-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InsideModal } from "@/components/ui/modal";
import { Materialize } from "@/components/ui/materialize";
import { Reveal } from "@/components/ui/reveal";
import { hasGraphs } from "@/features/shift/storage/library";
import { cn } from "@/lib/utils/cn";

import { ConsentChecks } from "./consent-checks";
import { оценить, type Оценка } from "./password-strength";
import { useSync } from "./sync-provider";

/**
 * Вход и регистрация.
 *
 * --- Лист, а не колонка ---------------------------------------------------
 *
 * Прежде форма стояла голой колонкой посреди пустого экрана: значок,
 * заголовок, абзац объяснений, переключатель, плашка с полями и ещё пара
 * строк мелким. Каждый шаг был снабжён пояснением, и вместе они читались как
 * инструкция к форме из двух полей. Теперь форма — один поднятый лист,
 * такой же, как окна приложения (`lit modal-lift`), и на нём только то, что
 * заполняют и нажимают. Пояснения убраны: кто пришёл войти, знает зачем, а
 * кому нужно больше, прочтёт согласие и справку.
 *
 * --- Заголовок — это переключатель ---------------------------------------
 *
 * «Вход» и «Регистрация» стоят вверху листа теми же словами, каким в шапке
 * написано название сайта, и активное из них — заголовок страницы. Отдельной
 * надписи «Вход» над переключателем «Вход / Регистрация» не нужно: она
 * говорила бы то же самое дважды. Для программы чтения заголовок остаётся
 * (`h1` без видимости), а вкладки — настоящие вкладки.
 *
 * --- Знак ------------------------------------------------------------------
 *
 * Четыре клетки знака сайта, одна из них залита. На входе залита первая —
 * как в шапке, а при регистрации «смена» переходит на противоположную клетку:
 * знак отвечает движением на то же нажатие, что и вкладка, и ничего больше
 * не обещает.
 *
 * --- Почему пароль можно показать -----------------------------------------
 *
 * Пароль здесь не вспоминают из менеджера, а придумывают и набирают на
 * телефоне, где опечатка не видна вовсе. Молча не принятый пароль при
 * регистрации стоит человеку ключа шифрования — восстановить его потом
 * нечем, кроме ключа восстановления. Глаз у поля дешевле.
 */

/** Куда идти после входа: к графику, а если его нет — к окну, где его строят. */
export function toSchedule(): string {
  return hasGraphs() ? "/calculator" : "/#build";
}

type Mode = "login" | "register";

const TABS: readonly { id: Mode; label: string }[] = [
  { id: "login", label: "Вход" },
  { id: "register", label: "Регистрация" },
];

/** Подпись поля: тем же голосом, что подписи в окнах приложения. */
const LABEL = "font-display text-xs font-bold uppercase tracking-wide text-ink-muted";

export function AuthScreen() {
  const { busy, error, actions } = useSync();
  const navigate = useNavigate();
  const [выбор, setВыбор] = useState<Mode | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [принял, setПринял] = useState(false);
  const [согласен, setСогласен] = useState(false);
  const [письмо, setПисьмо] = useState(false);
  const [нужнаПочта, setНужнаПочта] = useState(false);

  const emailId = useId();
  const passwordId = useId();
  const emailField = useRef<HTMLInputElement>(null);

  // Откуда пришли, то и открыто.
  // ------------------------------------------------------------------
  // С посадочной сюда ведут две кнопки — «Создать учётную запись» и
  // «Войти» (`landing/sync-invite.tsx`), — и первая обещает регистрацию.
  // Страница, открывшаяся на входе, заставила бы человека переключать
  // закладку сразу после нажатия на кнопку, которая уже назвала действие.
  //
  // Адрес страницы при этом читается как ВНЕШНЕЕ состояние: при
  // статическом экспорте разметка собирается заранее, одна на все адреса,
  // и до сверки с ней хэша как бы нет (`() => ""`). Выбор человека, если
  // он уже переключил закладку, старше адреса — поэтому `выбор` сначала
  // пуст, а не равен «вход».
  const хэш = useSyncExternalStore(
    useCallback((заметить: () => void) => {
      window.addEventListener("hashchange", заметить);
      return () => window.removeEventListener("hashchange", заметить);
    }, []),
    () => window.location.hash,
    () => "",
  );
  const mode: Mode = выбор ?? (хэш === "#register" ? "register" : "login");
  const регистрация = mode === "register";

  const переключить = (next: Mode) => {
    if (next === mode) return;
    setВыбор(next);
    // Отказ, прочитанный на одной вкладке, к другой не относится.
    actions.clearError();
    setПисьмо(false);
    setНужнаПочта(false);
  };

  // Крепость спрашивается только там, где пароль придумывают. На входе
  // проверять нечего и незачем: человек с паролем, заведённым до того,
  // как эта проверка появилась, обязан войти (`password-strength.ts`).
  const оценка = оценить(password, { email });
  const нельзя =
    busy ||
    email.trim() === "" ||
    (регистрация ? !оценка.годится || !принял || !согласен : password.length < 8);

  const отправить = async (event: React.FormEvent) => {
    event.preventDefault();
    if (нельзя) return;

    const данные = { email: email.trim(), password };

    if (регистрация) {
      // Регистрация остаётся на странице: на ней показывается ключ
      // восстановления, и уйти раньше, чем он записан, значит потерять его.
      await actions
        .register({ ...данные, acts: { termsAndPolicy: принял, personalData: согласен } })
        .catch(() => undefined);
      return;
    }

    // Вошедший приходит за своим графиком, а не за страницей учётной записи.
    // К этому моменту первый проход синхронизации закончен (`login` ждёт его),
    // и график с другого устройства уже лежит здесь: есть он — открываем,
    // нет — просим построить.
    const вошёл = await actions.login(данные).then(
      () => true,
      () => false,
    );
    if (вошёл) navigate.push(toSchedule());
  };

  // «Забыли пароль?» без адреса: не молчать, а вернуть человека в поле, где
  // его не хватает, — ссылка уходит на почту, и без адреса ей некуда.
  const забыли = () => {
    if (email.trim() === "") {
      setНужнаПочта(true);
      emailField.current?.focus();
      return;
    }
    void actions.recoverStart(email.trim()).then(() => setПисьмо(true));
  };

  return (
    <AuthSheet>
      <h1 className="sr-only">{регистрация ? "Регистрация" : "Вход"}</h1>

      <div className="mb-7 flex flex-col items-center gap-6">
        <AuthMark lit={регистрация ? 3 : 0} />
        <AuthTabs mode={mode} onChange={переключить} />
      </div>

      <form
        id={`${passwordId}-panel`}
        role="tabpanel"
        aria-labelledby={`tab-${mode}`}
        noValidate
        onSubmit={(event) => void отправить(event)}
        // Промежутки заданы блокам, а не `space-y` у формы: у раскрывающихся
        // блоков (`Reveal`) свёрнутая высота равна нулю, а межстрочный отступ
        // `space-y` остался бы и держал пустое место там, где блока нет.
        className="flex flex-col"
      >
        <AuthField
          id={emailId}
          label="Адрес почты"
          problem={нужнаПочта ? "Введите адрес почты" : undefined}
        >
          <WithIcon icon={Mail}>
            <Input
              ref={emailField}
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setНужнаПочта(false);
              }}
              className={ПОЛЕ}
            />
          </WithIcon>
        </AuthField>

        <AuthField
          id={passwordId}
          label="Пароль"
          aside={
            // Слово «Забыли пароль?» стоит всегда и проступает на «Входе»:
            // подмена его пустотой на «Регистрации» дёргала бы строку подписи.
            <span inert={регистрация}>
              <Materialize show={!регистрация} durationClassName="duration-300">
                <button
                  type="button"
                  disabled={busy}
                  onClick={забыли}
                  className={cn(
                    "cursor-pointer rounded-sm text-xs text-ink-muted transition-colors",
                    "hover:text-ink hover:underline hover:underline-offset-4",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  Забыли пароль?
                </button>
              </Materialize>
            </span>
          }
        >
          <PasswordField
            id={passwordId}
            autoComplete={регистрация ? "new-password" : "current-password"}
            value={password}
            onChange={setPassword}
          />
          {/* Полоска крепости раскрывается, а не возникает: на «Регистрации»
              она появляется с первой набранной буквы, и без хода поле
              пароля уезжало вниз рывком. */}
          <Reveal show={регистрация && password !== ""}>
            <div className="pt-2">
              <PasswordStrength оценка={оценка} />
            </div>
          </Reveal>
          {письмо && !регистрация && (
            <p
              role="status"
              className="mt-2 flex items-center gap-1.5 text-xs leading-5 text-ink-muted"
            >
              <Check aria-hidden className="size-3.5 shrink-0 text-verify" />
              Если такая запись есть, письмо уже отправлено.
            </p>
          )}
        </AuthField>

        <Reveal show={регистрация}>
          {/* Две отметки — `ConsentChecks`: почему две и что сервер пишет по
              ним, сказано там. Без обеих регистрация не идёт (`нельзя`). */}
          <div className="pb-5">
            <ConsentChecks
              termsAndPolicy={принял}
              personalData={согласен}
              onTermsAndPolicy={setПринял}
              onPersonalData={setСогласен}
            />
          </div>
        </Reveal>

        {error !== null && (
          <p
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-xl bg-signal-soft px-3.5 py-3 text-sm leading-5 text-ink"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={нельзя}>
          {регистрация ? <UserPlus aria-hidden /> : <LogIn aria-hidden />}
          {busy
            ? регистрация
              ? "Создаём…"
              : "Входим…"
            : регистрация
              ? "Создать учётную запись"
              : "Войти"}
        </Button>
      </form>
    </AuthSheet>
  );
}

/**
 * Лист, на котором стоит всё, что связано с доступом: вход, регистрация,
 * подтверждение адреса, восстановление по ссылке из письма.
 *
 * Страниц этих несколько, приходят на них по-разному — из шапки, из письма,
 * из другого письма, — а дело у человека на всех одно и то же: разобраться с
 * доступом и вернуться к графику. Поэтому и лист один: поднятая бумага с
 * кромкой от лампы, по середине экрана. Несколько по-разному собранных
 * страниц читались бы как несколько разных сервисов, особенно если на
 * вторую и третью человек попадает из почты, то есть вообще не из
 * приложения.
 *
 * Лист поднят так же, как окно приложения, поэтому карточки полей внутри него
 * растворяются, оставляя линовку (`InsideModal`, `ui/panel.tsx`): коробка
 * в коробке — две кромки и два фона — здесь так же лишняя, как и в окне.
 */
function AuthSheet({ children }: { children: ReactNode }) {
  return (
    // Лист стоит примерно по середине экрана, а не под шапкой: на этих
    // страницах больше ничего нет, и прижатая кверху форма оставляла бы под
    // собой пустой экран. Но не ровно по середине (`justify-center`), а от
    // верха с отступом, посчитанным на самый высокий лист — регистрацию, около
    // тридцати пяти рем: при `justify-center` лист, растущий на «Регистрации»,
    // уходил бы вверх обоими краями, и вкладки ездили бы под курсором. Теперь
    // верхняя кромка и вкладки стоят на месте, а лист тянется вниз.
    <div className="mx-auto flex w-full max-w-[27rem] flex-col md:min-h-[calc(100svh-14rem)] md:pt-[max(0px,calc((100svh-14rem-35rem)/2))]">
      <div className="lit modal-lift rounded-2xl bg-paper-raised px-6 py-8 sm:px-9 sm:py-10">
        <InsideModal value={true}>{children}</InsideModal>
      </div>
    </div>
  );
}

/**
 * Четыре клетки знака сайта; залитая — одна из них.
 *
 * Клетки те же, что в логотипе (`ui/logo.tsx`), но все одного размера:
 * залитая, а не крупнее остальных, чтобы при переходе она не прыгала по
 * размеру, а только меняла цвет. Переход — заливка и обводка за треть
 * секунды; тем, кто просил поменьше движения, общее правило сводит его к
 * нулю.
 */
const SQUARES = [
  [1.25, 1.25],
  [13.25, 1.25],
  [1.25, 13.25],
  [13.25, 13.25],
] as const;

function AuthMark({ lit }: { lit: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" className="size-12 shrink-0">
      {SQUARES.map(([x, y], at) => (
        <rect
          key={at}
          x={x}
          y={y}
          width="9.5"
          height="9.5"
          rx="2"
          strokeWidth="1.5"
          className={cn(
            "transition-[fill,stroke] duration-300 ease-out",
            at === lit ? "fill-signal stroke-signal" : "fill-transparent stroke-ink/25",
          )}
        />
      ))}
    </svg>
  );
}

/**
 * Вкладки «Вход» и «Регистрация».
 *
 * Слова, а не кнопки: тем же узким прописным шрифтом, каким написано
 * название сайта в шапке и заголовки окон. Выбранная — чернилами, другая —
 * вполсилы. Под ними тонкая линия на всю ширину и жирная под выбранной;
 * жирная ездит от одной к другой (`translate-x-full`), и этого движения
 * довольно, чтобы переключение читалось как переход, а не как подмена.
 *
 * Названия разделов, а не действий: кнопка действия стоит ниже и называется
 * «Войти». Два «Войти» рядом — это две одинаково названные кнопки для
 * программы чтения, и человек с экранным диктором не отличил бы вкладку от
 * отправки формы.
 */
function AuthTabs({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  // Стрелки переходят между вкладками, как у настоящих: в фокусе при этом
  // одна — выбранная (`tabIndex`), остальные до неё достают стрелкой.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;

    event.preventDefault();
    const next = TABS[(TABS.findIndex((tab) => tab.id === mode) + step + TABS.length) % TABS.length];
    if (next === undefined) return;
    onChange(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Вход или регистрация"
      onKeyDown={onKeyDown}
      className="relative grid w-full grid-cols-2"
    >
      {TABS.map(({ id, label }) => {
        const active = id === mode;
        return (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(
              "cursor-pointer rounded-sm pb-3.5 font-display text-xl font-bold uppercase tracking-wide",
              "transition-colors duration-200",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
              active ? "text-ink" : "text-ink/35 hover:text-ink/60",
            )}
          >
            {label}
          </button>
        );
      })}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-rule" />
      <span
        aria-hidden
        className={cn(
          "absolute bottom-0 left-0 h-0.5 w-1/2 bg-ink",
          "transition-transform duration-300 ease-out",
          mode === "register" && "translate-x-full",
        )}
      />
    </div>
  );
}

/**
 * Поле формы: подпись над ним, при нужде слово справа и строка под ним.
 *
 * Подпись и слово справа стоят в одной строке — так «Забыли пароль?» оказывается
 * рядом с паролем, к которому относится, а не отдельной ссылкой под кнопкой.
 * Строка под полем — только отказ (`problem`): пояснений поле не несёт.
 */
function AuthField({
  id,
  label,
  aside,
  problem,
  children,
}: {
  id: string;
  label: string;
  aside?: ReactNode;
  problem?: string;
  children: ReactNode;
}) {
  return (
    // Отступы у частей свои (`mb-2`, `pt-2` у раскрывающегося), а не `space-y`:
    // сворачиваемая часть без высоты не должна оставлять после себя зазор.
    <div className="mb-5 flex flex-col">
      <div className="mb-2 flex min-h-5 items-center justify-between gap-3">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        {aside}
      </div>
      {children}
      {problem !== undefined && (
        <p role="alert" className="mt-2 text-xs leading-5 text-signal">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * Рама страниц про доступ, у которых вместо вкладок — своё название:
 * подтверждение адреса и восстановление по ссылке из письма.
 *
 * Знак над заголовком — не украшение: он называет, о чём эта страница,
 * прежде чем прочитан заголовок. Заголовок тем же голосом, что вкладки входа.
 */
export function AuthFrame({
  icon: Icon,
  title,
  lead,
  children,
}: {
  icon: typeof LogIn;
  title: string;
  /** Одна строка о том, что здесь происходит. */
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AuthSheet>
      <header className="mb-7 space-y-3 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-paper-sunken">
          <Icon aria-hidden className="size-5 text-ink-muted" />
        </span>
        <h1 className="font-display text-xl font-bold uppercase tracking-wide text-ink">
          {title}
        </h1>
        {lead !== undefined && <p className="text-sm leading-6 text-ink-muted">{lead}</p>}
      </header>
      {children}
    </AuthSheet>
  );
}

/**
 * Поля входа выше обычных.
 *
 * В приложении поля девять десятых рема высотой: их там по десятку в
 * настройках, и высокие превратили бы список вопросов в лестницу. Здесь
 * полей два, набирают их один раз и часто с телефона, и нажимать в них
 * пальцем — главное, что с ними делают.
 */
const ПОЛЕ = "h-11 pl-9";

/** Поле со значком у левого края: значок называет, что набирают. */
function WithIcon({
  icon: Icon,
  children,
}: {
  icon: typeof Mail;
  children: React.ReactNode;
}) {
  return (
    <span className="relative block w-full">
      <Icon
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
      />
      {children}
    </span>
  );
}

/**
 * Пароль: значок у края, глаз у другого.
 *
 * Вынесен отдельно, потому что полей пароля в приложении четыре — вход,
 * регистрация, смена пароля (два) и подтверждение удаления, — и глаз нужен
 * им всем одинаково.
 */
export function PasswordField({
  id,
  autoComplete,
  value,
  onChange,
}: {
  id?: string;
  autoComplete: string;
  value: string;
  onChange: (значение: string) => void;
}) {
  const [видно, setВидно] = useState(false);

  return (
    <WithIcon icon={KeyRound}>
      <Input
        id={id}
        type={видно ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(ПОЛЕ, "pr-11")}
      />
      <button
        type="button"
        onClick={() => setВидно((было) => !было)}
        // Имя меняется вместе с действием: «Показать пароль», пока он
        // скрыт, и «Скрыть пароль», пока виден. Один значок с одним именем
        // на оба положения оставлял бы диктору загадку.
        aria-label={видно ? "Скрыть пароль" : "Показать пароль"}
        title={видно ? "Скрыть пароль" : "Показать пароль"}
        className={cn(
          "absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center",
          "cursor-pointer rounded-lg text-ink-faint transition-colors hover:text-ink",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
        )}
      >
        {видно ? (
          <EyeOff aria-hidden className="size-4" />
        ) : (
          <Eye aria-hidden className="size-4" />
        )}
      </button>
    </WithIcon>
  );
}

/**
 * Полоска крепости пароля и строка под ней.
 *
 * --- Почему полоска, а не одна надпись ------------------------------------
 *
 * Надпись отвечает на вопрос «приняли или нет», а человек, придумывающий
 * пароль, решает другой — «дописать ещё или хватит». На этот вопрос
 * отвечает только непрерывная шкала: добавил слово — ступенька сдвинулась.
 *
 * --- Почему цветов всего два ----------------------------------------------
 *
 * Сигнальный цвет в приложении означает «требует решения человека», и
 * тратить его на «пароль средний» нельзя — он тогда перестанет значить
 * что-либо на сетке, где им помечена переработка. Поэтому красным горит
 * только то, что и правда не принято, зелёным — то, что уже хорошо, а
 * между ними обычные чернила.
 */
export function PasswordStrength({ оценка }: { оценка: Оценка }) {
  if (оценка.биты === 0 && оценка.причина === null) return null;

  const ступеней =
    оценка.причина !== null
      ? 1
      : оценка.уровень === "средний"
        ? 2
        : оценка.уровень === "хороший"
          ? 3
          : 4;

  const цвет =
    оценка.причина !== null
      ? "bg-signal"
      : оценка.уровень === "средний"
        ? "bg-ink-muted"
        : "bg-verify";

  return (
    <div className="space-y-1.5">
      {/* Полоска — картинка к тому, что сказано словами ниже, и своего
          имени для программы чтения не имеет: диктору достаётся строка. */}
      <div aria-hidden className="flex gap-1">
        {[0, 1, 2, 3].map((ступень) => (
          <span
            key={ступень}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              ступень < ступеней ? цвет : "bg-paper-sunken",
            )}
          />
        ))}
      </div>
      {/* `aria-live` — не прихоть: оценка меняется от набора, и человек,
          который поля не видит, иначе узнал бы об отказе только по
          неработающей кнопке. */}
      <p className="text-xs leading-5 text-ink-muted" aria-live="polite">
        <span className="sr-only">Пароль: </span>
        {оценка.причина ?? `${оценка.уровень[0]?.toUpperCase()}${оценка.уровень.slice(1)}`}
      </p>
    </div>
  );
}
