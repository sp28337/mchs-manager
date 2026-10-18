"use client";

import {
  CircleCheck,
  CircleDashed,
  Download,
  FolderSync,
  KeyRound,
  LogOut,
  ShieldCheck,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { SectionLayout } from "@/components/ui/section-layout";
import { Card, Field } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";

import { LEGAL_URLS } from "../legal";
import { AuthScreen, PasswordField, PasswordStrength } from "./auth-screen";
import { оценить } from "./password-strength";
import { когда } from "./presence";
import { RecoveryKeyCard } from "./recovery-key-card";
import { useSync } from "./sync-provider";

type SectionId = "profile" | "sync" | "access" | "data";

const SECTIONS: readonly { id: SectionId; title: string; icon: LucideIcon }[] = [
  { id: "profile", title: "Профиль", icon: UserRound },
  { id: "sync", title: "Синхронизация", icon: FolderSync },
  { id: "access", title: "Доступ", icon: KeyRound },
  { id: "data", title: "Мои данные", icon: ShieldCheck },
];

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

/** Открытый раздел; живёт и в адресе (`#sync`), чтобы на него можно было сослаться. */
function useSection(): [SectionId, (id: SectionId) => void] {
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash.slice(1),
    () => "",
  );
  const section = SECTIONS.find((item) => item.id === hash)?.id ?? "profile";

  const choose = useCallback((id: SectionId) => {
    // Без прокрутки к якорю и без записи в историю; подписчикам об этом
    // сообщаем сами — `replaceState` `hashchange` не вызывает.
    window.history.replaceState(null, "", `#${id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  return [section, choose];
}

export function AccountScreen() {
  const { enabled, account, error, freshRecoveryKey, actions } = useSync();
  const [section, choose] = useSection();

  if (!enabled) {
    return (
      <p className="mx-auto max-w-prose text-center text-sm text-ink-muted">
        Синхронизация в этой сборке не включена: сервер появится позже.
        Приложение работает полностью — данные лежат в этом браузере, перенос
        между устройствами пока файлом.
      </p>
    );
  }

  if (account === null) {
    return (
      <div className="space-y-6">
        {error !== null && <Отказ>{error}</Отказ>}
        <AuthScreen />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <h1 className="text-xl font-medium text-ink">Учётная запись</h1>

      {error !== null && <Отказ>{error}</Отказ>}

      {freshRecoveryKey !== null && (
        <RecoveryKeyCard recoveryKey={freshRecoveryKey} onDone={actions.forgetRecoveryKey} />
      )}

      <SectionLayout
        label="Разделы учётной записи"
        sections={SECTIONS}
        active={section}
        onSelect={choose}
        footer={
          <p>
            Приложение работает и без учётной записи. Она добавляет копию на сервере и
            перенос между устройствами.{" "}
            <Link href={LEGAL_URLS.policy} className="underline hover:no-underline">
              Политика обработки данных
            </Link>
          </p>
        }
      >
        {section === "profile" && <Profile />}
        {section === "sync" && <Sync />}
        {section === "access" && <Access />}
        {section === "data" && <MyData />}
      </SectionLayout>
    </div>
  );
}

function Отказ({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-signal/40 bg-paper-raised px-4 py-3 text-sm text-ink"
    >
      {children}
    </p>
  );
}

/** Ряд кнопок раздела: по ширине надписей, а на телефоне столбцом. */
function Кнопки({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-flow-col sm:auto-cols-max sm:justify-start">
      {children}
    </div>
  );
}

/** Метка состояния: значок и слово, без заливки. */
function Значок({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: "ok" | "wait";
  children: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
        tone === "ok" ? "border-verify/40 text-ink" : "border-rule-strong text-ink-muted",
      )}
    >
      <Icon
        aria-hidden
        className={cn("size-3.5 shrink-0", tone === "ok" ? "text-verify" : "text-ink-faint")}
      />
      {children}
    </span>
  );
}

function Profile() {
  const { account, busy, actions } = useSync();
  if (account === null) return null;

  return (
    <div className="space-y-4">
      <Card>
        <Field label="Адрес почты">
          <span className="truncate text-sm text-ink">{account.email}</span>
        </Field>
        <Field label="Подтверждение">
          <Значок
            icon={account.email_verified ? CircleCheck : CircleDashed}
            tone={account.email_verified ? "ok" : "wait"}
          >
            {account.email_verified ? "Адрес подтверждён" : "Адрес не подтверждён"}
          </Значок>
        </Field>
      </Card>

      {!account.email_verified && (
        <p className="text-xs leading-5 text-ink-muted">
          Письмо со ссылкой отправлено при регистрации. Синхронизация работает и
          без подтверждения, но без него нельзя восстановить доступ письмом,
          если забудется пароль.
        </p>
      )}

      <Кнопки>
        <Button variant="ghost" disabled={busy} onClick={() => void actions.logout()}>
          <LogOut aria-hidden /> Выйти
        </Button>
      </Кнопки>
    </div>
  );
}

function Sync() {
  const { dirty, syncedAt, report } = useSync();
  const принято = report === null ? 0 : report.received + report.deleted;

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-ink-muted">
        Синхронизация идёт сама: после правки, при появлении связи и при
        возвращении на вкладку.
      </p>
      <Card>
        <Field
          label="Последняя синхронизация"
          note={dirty ? "Есть правки, которые ещё не уехали — уедут через мгновение." : undefined}
        >
          <span className="text-sm text-ink">
            {syncedAt === null ? "в этом сеансе ещё не было" : когда(syncedAt)}
          </span>
        </Field>
        {принято > 0 && (
          <Field label="Принято с другого устройства">
            <span className="text-sm text-ink">{принято}</span>
          </Field>
        )}
        {report !== null && report.skipped > 0 && (
          <Field
            label="Не удалось прочесть"
            note="Записи, сделанные другой версией приложения или другим ключом."
          >
            <span className="text-sm text-ink">{report.skipped}</span>
          </Field>
        )}
      </Card>
    </div>
  );
}

function Access() {
  const { account } = useSync();
  if (account === null) return null;

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-ink-muted">
        Пароль защищает ключ шифрования данных. При смене перешифровывается
        только он, сами записи не меняются.
      </p>
      <PasswordChange email={account.email} />
    </div>
  );
}

function PasswordChange({ email }: { email: string }) {
  const { busy, actions } = useSync();
  const [открыто, setОткрыто] = useState(false);
  const [текущий, setТекущий] = useState("");
  const [новый, setНовый] = useState("");
  const [готово, setГотово] = useState(false);

  const текущийId = useId();
  const новыйId = useId();

  if (!открыто) {
    return (
      <Кнопки>
        <Button variant="outline" onClick={() => setОткрыто(true)}>
          <KeyRound aria-hidden /> Сменить пароль
        </Button>
      </Кнопки>
    );
  }

  const оценка = оценить(новый, { email });
  const нельзя = busy || текущий === "" || !оценка.годится;

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
          <PasswordField
            id={текущийId}
            autoComplete="current-password"
            value={текущий}
            onChange={setТекущий}
          />
        </Field>
        <Field
          id={новыйId}
          label="Новый пароль"
          stack
          note="Ключ восстановления остаётся прежним."
        >
          <div className="w-full space-y-2">
            <PasswordField
              id={новыйId}
              autoComplete="new-password"
              value={новый}
              onChange={setНовый}
            />
            <PasswordStrength оценка={оценка} />
          </div>
        </Field>
      </Card>

      {готово && (
        <p className="text-sm text-ink">
          Пароль заменён. На остальных устройствах придётся войти заново.
        </p>
      )}

      <Кнопки>
        <Button type="submit" disabled={нельзя}>
          Сменить пароль
        </Button>
        <Button type="button" variant="ghost" onClick={() => setОткрыто(false)}>
          Отмена
        </Button>
      </Кнопки>
    </form>
  );
}

/** Права субъекта: выгрузка и удаление работают сразу, без переписки (ст. 14, 21 152-ФЗ). */
function MyData() {
  const { busy, actions } = useSync();
  const [спросить, setСпросить] = useState(false);
  const [пароль, setПароль] = useState("");
  const парольId = useId();

  const выгрузить = async () => {
    const текст = await actions.exportAll().catch(() => null);
    if (текст === null) return;

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
    <div className="space-y-4">
      <p className="text-xs leading-5 text-ink-muted">
        Удаление уничтожает на сервере копии графиков и их историю, ключи, адрес
        почты и журнал входов; отзыв согласия — это оно же. Графики на этом
        устройстве останутся. Резервные копии очищаются в течение 30 дней.
      </p>

      <Кнопки>
        <Button variant="outline" disabled={busy} onClick={() => void выгрузить()}>
          <Download aria-hidden /> Выгрузить всё, что обо мне есть
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setСпросить(true)}>
          <Trash2 aria-hidden /> Удалить учётную запись
        </Button>
      </Кнопки>

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
            <PasswordField
              id={парольId}
              autoComplete="current-password"
              value={пароль}
              onChange={setПароль}
            />
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
