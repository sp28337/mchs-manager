"use client";

import { Eye, EyeOff, KeyRound, LogIn, Mail, UserPlus } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Card, Field } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { cn } from "@/lib/utils/cn";

import { LEGAL_URLS, LEGAL_VERSIONS } from "../legal";
import { оценить, type Оценка } from "./password-strength";
import { useSync } from "./sync-provider";

/**
 * Вход и регистрация.
 *
 * --- Почему это отдельный экран, а не часть страницы учётной записи -------
 *
 * Прежде форма стояла посреди страницы: над ней заголовок «Учётная
 * запись» с абзацем объяснений, под ней — ещё абзац о том, что приложение
 * работает и без неё. Для вошедшего такая страница верна, для входящего —
 * нет: он пришёл сделать одно действие, а читает три объяснения и ищет в
 * них поля.
 *
 * Поэтому у входа своя раскладка: узкая колонка по середине экрана,
 * заголовок называет действие, под ним два поля и одна залитая кнопка.
 * Так устроен вход всюду, и это не мода — узкая колонка не даёт глазу
 * разбегаться, а единственное залитое пятно в ней показывает, чем
 * заканчивают.
 *
 * --- Почему вход и регистрация в одном переключателе ----------------------
 *
 * Поля у них одни и те же, разница в двух вещах: при регистрации человек
 * даёт согласие на обработку данных (ч. 1 ст. 9 152-ФЗ — конкретное и
 * информированное, со ссылками и редакцией текста), и при ней же из
 * пароля впервые выводится ключ. Две страницы ради одной отметки заставили
 * бы человека, набравшего адрес не там, набирать его заново.
 *
 * --- Почему пароль можно показать -----------------------------------------
 *
 * Пароль здесь не вспоминают из менеджера, а придумывают и набирают на
 * телефоне, где опечатка не видна вовсе. Молча не принятый пароль при
 * регистрации стоит человеку ключа шифрования — восстановить его потом
 * нечем, кроме ключа восстановления. Глаз у поля дешевле.
 */
export function AuthScreen() {
  const { busy, actions } = useSync();
  const [выбор, setВыбор] = useState<"login" | "register" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [согласен, setСогласен] = useState(false);
  const [письмо, setПисьмо] = useState(false);

  const emailId = useId();
  const passwordId = useId();

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
  const вид = выбор ?? (хэш === "#register" ? "register" : "login");
  const setВид = setВыбор;

  const регистрация = вид === "register";
  // Крепость спрашивается только там, где пароль придумывают. На входе
  // проверять нечего и незачем: человек с паролем, заведённым до того,
  // как эта проверка появилась, обязан войти (`password-strength.ts`).
  const оценка = оценить(password, { email });
  const нельзя =
    busy ||
    email.trim() === "" ||
    (регистрация ? !оценка.годится || !согласен : password.length < 8);

  const отправить = async (event: React.FormEvent) => {
    event.preventDefault();
    if (нельзя) return;

    const данные = { email: email.trim(), password };

    if (регистрация) {
      await actions.register(данные).catch(() => undefined);
    } else {
      await actions.login(данные).catch(() => undefined);
    }
  };

  return (
    <AuthFrame
      icon={регистрация ? UserPlus : LogIn}
      title={регистрация ? "Новая учётная запись" : "Вход"}
      // Строка под заголовком есть только у регистрации, и говорит она о
      // деле: что понадобится и что из этого выйдет. У входа такой строки
      // нет — человек, нажавший «Войти», знает, зачем он здесь, и
      // объяснять ему это значит задерживать.
      lead={
        регистрация
          ? "Нужны адрес почты и пароль. После этого график будет одним и тем же на телефоне и на компьютере."
          : undefined
      }
    >
      {/* `lg:flex-none` снимает то, что дорожке даёт её же собственный
          класс: `lg:flex-1` писался для строки управления над сеткой, где
          переключатель тянется вширь. Здесь колонка, и главная ось у неё
          вертикальная — доля места превращалась в растяжение ПО ВЫСОТЕ, и
          на широком экране дорожка вырастала в тёмный прямоугольник
          высотой в треть формы. */}
      <Segmented label="Вход или регистрация" className="w-full lg:flex-none">
        {/* Названия разделов, а не действий: кнопка действия стоит ниже
            и называется «Войти». Два «Войти» рядом — это две одинаково
            названные кнопки для программы чтения, и человек с экранным
            диктором не отличил бы переключатель от отправки формы. */}
        <SegmentedItem
          active={!регистрация}
          onClick={() => setВид("login")}
          className="flex-1"
        >
          Вход
        </SegmentedItem>
        <SegmentedItem
          active={регистрация}
          onClick={() => setВид("register")}
          className="flex-1"
        >
          Регистрация
        </SegmentedItem>
      </Segmented>

      <form onSubmit={(event) => void отправить(event)} className="space-y-4">
        <Card>
          <Field id={emailId} label="Адрес почты" stack>
            <WithIcon icon={Mail}>
              <Input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="вы@почта.рф"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={ПОЛЕ}
              />
            </WithIcon>
          </Field>
          <Field
            id={passwordId}
            label="Пароль"
            stack
            note={
              регистрация
                ? "Из пароля выводится ключ, которым шифруются данные, — сбросить его нельзя, поэтому при регистрации выдаётся ключ восстановления."
                : undefined
            }
          >
            <div className="w-full space-y-2">
              <PasswordField
                id={passwordId}
                autoComplete={регистрация ? "new-password" : "current-password"}
                value={password}
                onChange={setPassword}
              />
              {регистрация && <PasswordStrength оценка={оценка} />}
            </div>
          </Field>
        </Card>

        {регистрация && (
          <div className="space-y-2">
            {/* Флажок — тот же, что в окне дня (`ui/checkbox.tsx`): отметка
                справа, нажимается вся строка. Ссылки и редакция стоят под
                ним, а не внутри: нажатие по ссылке внутри флажка ставило бы
                отметку заодно с переходом. */}
            <Checkbox
              checked={согласен}
              onChange={setСогласен}
              label={
                <span className="text-left text-sm text-ink">
                  Даю согласие на обработку персональных данных
                </span>
              }
            />
            <p className="text-xs leading-5 text-ink-muted">
              {/* Редакция названа прямо: согласие должно быть конкретным и
                  информированным (ч. 1 ст. 9 152-ФЗ), а в записи о согласии
                  сервер хранит именно версию текста. Через год человек
                  сможет прочитать ровно ту редакцию, на которую соглашался:
                  опубликованные остаются в архиве. */}
              <Link href={LEGAL_URLS.consent} className="underline hover:no-underline">
                Текст согласия
              </Link>
              {" · "}
              <Link href={LEGAL_URLS.policy} className="underline hover:no-underline">
                политика обработки
              </Link>
              {" · "}
              <Link href={LEGAL_URLS.terms} className="underline hover:no-underline">
                условия использования
              </Link>
              {/* Точка после «г.» своя не ставится: её уже поставил
                  сокращённый год. */}
              . Редакция {редакция(LEGAL_VERSIONS.consent)}
            </p>
          </div>
        )}

        <Button type="submit" disabled={нельзя}>
          {регистрация ? <UserPlus aria-hidden /> : <LogIn aria-hidden />}
          {busy
            ? регистрация
              ? "Создаём…"
              : "Входим…"
            : регистрация
              ? "Создать учётную запись"
              : "Войти"}
        </Button>

        {!регистрация && (
          <div className="space-y-1 text-center">
            <Button
              type="button"
              variant="link"
              disabled={busy || email.trim() === ""}
              onClick={() => {
                void actions.recoverStart(email.trim()).then(() => setПисьмо(true));
              }}
            >
              Забыли пароль? Пришлём ссылку на почту
            </Button>
            {письмо && (
              <p className="text-xs leading-5 text-ink-faint">
                Если такая запись есть, письмо уже отправлено. Понадобится ключ
                восстановления — те знаки, что вы записали при регистрации.
              </p>
            )}
          </div>
        )}
      </form>

    </AuthFrame>
  );
}

/**
 * Общая рама всех страниц про доступ: вход, подтверждение адреса,
 * восстановление по ссылке из письма.
 *
 * Страниц этих три, приходят на них по-разному — из шапки, из письма, из
 * другого письма, — а дело у человека на всех одно и то же: разобраться с
 * доступом и вернуться к графику. Поэтому и рама одна: узкая колонка по
 * середине экрана, значок, заголовок в одно слово и строка под ним. Три
 * по-разному собранные страницы читались бы как три разных сервиса,
 * особенно если на вторую и третью человек попадает из почты, то есть
 * вообще не из приложения.
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
    // Колонка стоит по середине экрана, а не под шапкой: на этих
    // страницах больше ничего нет, и прижатая кверху форма оставляла бы
    // под собой пустой экран. Высота задана с запасом на шапку и поля.
    <div className="mx-auto flex w-full max-w-[27rem] flex-col justify-center gap-6 md:min-h-[calc(100svh-14rem)]">
      <header className="space-y-2 text-center">
        {/* Знак над заголовком — не украшение: он называет, о чём эта
            страница, прежде чем прочитан заголовок, и он же тот самый
            значок, по которому сюда нажали в шапке. */}
        <span className="lit mx-auto grid size-11 place-items-center rounded-xl bg-paper-raised">
          <Icon aria-hidden className="size-5 text-ink-muted" />
        </span>
        <h1 className="text-xl font-medium text-ink">{title}</h1>
        {lead !== undefined && (
          <p className="text-sm leading-6 text-ink-muted">{lead}</p>
        )}
      </header>
      {children}
    </div>
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
        {оценка.причина ?? `Пароль ${оценка.уровень}.`}
      </p>
    </div>
  );
}

/** `2026-10-11` → `11 октября 2026 г.` */
export function редакция(версия: string): string {
  const дата = new Date(`${версия}T00:00:00Z`);

  if (Number.isNaN(дата.getTime())) return версия;

  return дата.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
