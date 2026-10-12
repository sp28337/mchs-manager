"use client";

import { Download, LogOut, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, Field } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";

import { LEGAL_URLS } from "../legal";
import { RecoveryKeyCard } from "./recovery-key-card";
import { useSync } from "./sync-provider";

/**
 * Страница аккаунта: вход, состояние, права субъекта.
 *
 * --- Почему отдельная страница, а не третья закладка настроек ----------------
 *
 * В настройках лежат ответы анкеты — то, из чего считается норма. Аккаунт
 * к расчёту не относится вовсе: он о том, где лежит копия данных. Рядом с
 * «датой смены» он сбивал бы с толку, а главное — здесь же, по тому же
 * адресу, появится «мои данные» (шаг 12): выгрузка, удаление, отзыв
 * согласия. Это страница про данные и права, а не про график.
 *
 * --- Чего здесь нет --------------------------------------------------------
 *
 * Пароль не хранится и не показывается; ключ восстановления показывается
 * один раз и больше никогда (`recovery-key-card.tsx`). Выгрузка уходит
 * файлом в браузер, а не открывается на странице: это все данные
 * человека, и место им не на экране, а на диске.
 */
export function AccountScreen() {
  const { enabled, phase, account, error, busy, freshRecoveryKey, actions, report } = useSync();

  if (!enabled) {
    return (
      <Note>
        Синхронизация в этой сборке не включена: сервер появится позже.
        Приложение работает полностью — данные лежат в этом браузере, перенос
        между устройствами пока файлом.
      </Note>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[44rem] space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-medium text-ink">Учётная запись</h1>
        <p className="text-sm text-ink-muted">
          Нужна одному: чтобы правка, сделанная на телефоне, оказалась на
          компьютере. Данные уходят на сервер{" "}
          <strong className="font-medium text-ink">зашифрованными</strong> — ключ
          выводится из пароля в этом браузере и на сервер не попадает.
        </p>
      </header>

      {error !== null && (
        <p
          role="alert"
          className="rounded-xl border border-signal/40 bg-paper-raised px-4 py-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      {freshRecoveryKey !== null && (
        <RecoveryKeyCard
          recoveryKey={freshRecoveryKey}
          onDone={actions.forgetRecoveryKey}
        />
      )}

      {account === null ? (
        <SignInForm />
      ) : (
        <>
          <Card>
            <Field label="Адрес почты">
              <span className="text-sm text-ink">{account.email}</span>
            </Field>
            <Field
              label="Адрес подтверждён"
              note={
                account.email_verified
                  ? undefined
                  : "Письмо отправлено при регистрации: перейдите по ссылке из него."
              }
            >
              <span className="text-sm text-ink">
                {account.email_verified ? "да" : "нет"}
              </span>
            </Field>
            <Field label="Состояние">
              <span className="text-sm text-ink">{СОСТОЯНИЕ[phase]}</span>
            </Field>
            {report !== null && report.skipped > 0 && (
              <Field
                label="Не удалось прочесть"
                note="Записи, сделанные другой версией приложения или другим ключом."
              >
                <span className="text-sm text-ink">{report.skipped}</span>
              </Field>
            )}
          </Card>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" disabled={busy} onClick={() => void actions.syncNow()}>
              <RefreshCw aria-hidden /> Синхронизировать сейчас
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void actions.logout()}>
              <LogOut aria-hidden /> Выйти
            </Button>
          </div>

          <PasswordChange />
          <MyData />
        </>
      )}

      <Note>
        Приложение работает и без учётной записи — как работало раньше: расчёт
        и данные живут в этом браузере. Учётная запись добавляет копию на
        сервере и перенос между устройствами, и ничего не забирает.{" "}
        <Link href={LEGAL_URLS.policy} className="underline">
          Политика обработки данных
        </Link>
        .
      </Note>
    </div>
  );
}

const СОСТОЯНИЕ: Record<string, string> = {
  off: "синхронизация не включена",
  "signed-out": "вход не выполнен",
  connecting: "подключение…",
  idle: "синхронизировано",
  syncing: "синхронизация…",
  offline: "нет связи — правки уедут позже",
  error: "синхронизация отложена",
};

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-faint">{children}</p>;
}

/**
 * Вход и регистрация — одной формой на два случая.
 *
 * Поля те же, разница в одном: при регистрации человек соглашается на
 * обработку данных, и это отдельная отметка со ссылками на документы
 * (ч. 1 ст. 9 152-ФЗ: согласие должно быть конкретным и информированным).
 */
function SignInForm() {
  const { busy, actions } = useSync();
  const [вид, setВид] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [согласен, setСогласен] = useState(false);
  const [письмо, setПисьмо] = useState(false);

  const emailId = useId();
  const passwordId = useId();

  const регистрация = вид === "register";
  const нельзя = busy || email.trim() === "" || password.length < 8 || (регистрация && !согласен);

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
    <form onSubmit={(event) => void отправить(event)} className="space-y-4">
      <Segmented label="Вход или регистрация">
        {/* Названия разделов, а не действий: кнопка действия стоит ниже
            и называется «Войти». Два «Войти» рядом — это две одинаково
            названные кнопки для программы чтения, и человек с экранным
            диктором не отличил бы переключатель от отправки формы. */}
        <SegmentedItem active={!регистрация} onClick={() => setВид("login")}>
          Вход
        </SegmentedItem>
        <SegmentedItem active={регистрация} onClick={() => setВид("register")}>
          Регистрация
        </SegmentedItem>
      </Segmented>

      <Card>
        <Field id={emailId} label="Адрес почты" stack>
          <Input
            id={emailId}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field
          id={passwordId}
          label="Пароль"
          stack
          note={
            регистрация
              ? "Не меньше восьми знаков. Из пароля выводится ключ, которым шифруются данные, — восстановить его нельзя, поэтому при регистрации выдаётся ключ восстановления."
              : undefined
          }
        >
          <Input
            id={passwordId}
            type="password"
            autoComplete={регистрация ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </Card>

      {регистрация && (
        <label className="flex items-start gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={согласен}
            onChange={(event) => setСогласен(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-signal"
          />
          <span>
            Даю{" "}
            <Link href={LEGAL_URLS.consent} className="underline">
              согласие на обработку персональных данных
            </Link>{" "}
            и принимаю{" "}
            <Link href={LEGAL_URLS.terms} className="underline">
              условия использования
            </Link>
            . Прочитал{" "}
            <Link href={LEGAL_URLS.policy} className="underline">
              политику обработки данных
            </Link>
            .
          </span>
        </label>
      )}

      <Button type="submit" disabled={нельзя}>
        {регистрация ? "Создать учётную запись" : "Войти"}
      </Button>

      {!регистрация && (
        <div className="space-y-1">
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
            <p className="text-xs text-ink-faint">
              Если такая запись есть, письмо уже отправлено. Понадобится ключ
              восстановления — те знаки, что вы записали при регистрации.
            </p>
          )}
        </div>
      )}
    </form>
  );
}

/** Смена пароля: перешифровывается обёртка ключа, данные не трогаются. */
function PasswordChange() {
  const { busy, actions } = useSync();
  const [открыто, setОткрыто] = useState(false);
  const [текущий, setТекущий] = useState("");
  const [новый, setНовый] = useState("");
  const [готово, setГотово] = useState(false);

  const текущийId = useId();
  const новыйId = useId();

  if (!открыто) {
    return (
      <Button variant="ghost" onClick={() => setОткрыто(true)}>
        Сменить пароль
      </Button>
    );
  }

  const нельзя = busy || текущий === "" || новый.length < 8;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (нельзя) return;
        void actions
          .changePassword({ currentPassword: текущий, newPassword: новый })
          .then(() => {
            setГотово(true);
            setТекущий("");
            setНовый("");
          })
          .catch(() => undefined);
      }}
    >
      <Card>
        <Field id={текущийId} label="Нынешний пароль" stack>
          <Input
            id={текущийId}
            type="password"
            autoComplete="current-password"
            value={текущий}
            onChange={(event) => setТекущий(event.target.value)}
          />
        </Field>
        <Field
          id={новыйId}
          label="Новый пароль"
          stack
          note="Данные не перешифровываются: пароль защищает ключ, а не сами записи. Ключ восстановления остаётся прежним."
        >
          <Input
            id={новыйId}
            type="password"
            autoComplete="new-password"
            value={новый}
            onChange={(event) => setНовый(event.target.value)}
          />
        </Field>
      </Card>

      {готово && (
        <p className="text-sm text-ink">
          Пароль заменён. На остальных устройствах придётся войти заново.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={нельзя}>
          Сменить пароль
        </Button>
        <Button type="button" variant="ghost" onClick={() => setОткрыто(false)}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

/**
 * Права субъекта: выгрузка и удаление.
 *
 * Работают сразу и без переписки с оператором — ждать ответа на письмо,
 * чтобы забрать свои же данные, это не исполнение права (ст. 14, 21
 * 152-ФЗ), а его имитация.
 */
function MyData() {
  const { busy, actions } = useSync();
  const [спросить, setСпросить] = useState(false);
  const [пароль, setПароль] = useState("");
  const парольId = useId();

  const выгрузить = async () => {
    const текст = await actions.exportAll().catch(() => null);
    if (текст === null) return;

    // Файлом, а не на экран: это все данные человека, и место им на
    // диске. Тот же приём, что у выгрузки профиля (`save-to-file.tsx`).
    const url = URL.createObjectURL(new Blob([текст], { type: "application/json" }));
    const ссылка = document.createElement("a");
    ссылка.href = url;
    ссылка.download = `grafik13-moi-dannye-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(ссылка);
    ссылка.click();
    ссылка.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3 border-t border-rule pt-4">
      <h2 className="text-sm font-medium text-ink">Мои данные</h2>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" disabled={busy} onClick={() => void выгрузить()}>
          <Download aria-hidden /> Выгрузить всё, что о мне есть
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setСпросить(true)}>
          <Trash2 aria-hidden /> Удалить учётную запись
        </Button>
      </div>

      <p className="text-xs text-ink-faint">
        Удаление уничтожает на сервере всё: копии графиков, их историю,
        обёртки ключа, адрес почты, журнал входов. Отзыв согласия — это оно
        же: без адреса и ключа учётной записи не существует. Графики на этом
        устройстве останутся. Резервные копии догоняют удаление в течение 30
        дней.
      </p>

      <ConfirmDialog
        open={спросить}
        onClose={() => {
          setСпросить(false);
          setПароль("");
        }}
        onConfirm={() => {
          void actions.deleteAccount({ password: пароль }).catch(() => undefined);
          setСпросить(false);
          setПароль("");
        }}
        title="Удалить учётную запись?"
        confirm="Удалить"
        destructive
        icon={<Trash2 aria-hidden />}
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Копия данных на сервере будет уничтожена. Графики на этом
            устройстве останутся, и приложение продолжит работать без учётной
            записи.
          </p>
          <div className="space-y-1">
            <Label htmlFor={парольId}>Пароль — чтобы это были точно вы</Label>
            <Input
              id={парольId}
              type="password"
              autoComplete="current-password"
              value={пароль}
              onChange={(event) => setПароль(event.target.value)}
            />
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
