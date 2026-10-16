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
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Card, Field } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";

import { LEGAL_URLS } from "../legal";
import { AuthScreen, PasswordField, PasswordStrength } from "./auth-screen";
import { оценить } from "./password-strength";
import { когда } from "./presence";
import { RecoveryKeyCard } from "./recovery-key-card";
import { useSync } from "./sync-provider";

/**
 * Страница учётной записи: кто вошёл, что с синхронизацией, права субъекта.
 *
 * --- Почему отдельная страница, а не третья закладка настроек ----------------
 *
 * В настройках лежат ответы анкеты — то, из чего считается норма. Учётная
 * запись к расчёту не относится вовсе: она о том, где лежит копия данных.
 * Рядом с «датой смены» она сбивала бы с толку, а главное — здесь же, по
 * тому же адресу, стоят «мои данные»: выгрузка и удаление. Это страница
 * про данные и права, а не про график.
 *
 * --- Как она собрана ---------------------------------------------------------
 *
 * Не вошедшему — только вход (`auth-screen.tsx`): одно действие, узкая
 * колонка, никаких разделов про чужие данные.
 *
 * Вошедшему — три раздела в том порядке, в каком о них спрашивают:
 * синхронизация (моё уехало?), доступ (сменить пароль), мои данные
 * (забрать и удалить). У каждого свой заголовок со значком: без них
 * страница была лентой из карточек и кнопок, где удаление учётной записи
 * стояло в том же ряду, что и «синхронизировать сейчас».
 *
 * Наверху — знак учётной записи с адресом: тот же кружок, что в шапке, и
 * та же точка состояния. Человек, нажавший в шапке на себя, попадает на
 * страницу, которая начинается с него же.
 *
 * --- Чего здесь нет ----------------------------------------------------------
 *
 * Пароль не хранится и не показывается; ключ восстановления показывается
 * один раз и больше никогда (`recovery-key-card.tsx`). Выгрузка уходит
 * файлом в браузер, а не открывается на странице: это все данные
 * человека, и место им не на экране, а на диске.
 */
export function AccountScreen() {
  const {
    enabled,
    account,
    error,
    busy,
    dirty,
    syncedAt,
    freshRecoveryKey,
    actions,
    report,
  } = useSync();

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

  const принято = report === null ? 0 : report.received + report.deleted;

  return (
    <div className="mx-auto w-full max-w-[44rem] space-y-8">
      <h1 className="text-xl font-medium text-ink">Учётная запись</h1>

      {error !== null && <Отказ>{error}</Отказ>}

      {freshRecoveryKey !== null && (
        <RecoveryKeyCard
          recoveryKey={freshRecoveryKey}
          onDone={actions.forgetRecoveryKey}
        />
      )}

      {/* Кто вошёл — первой строкой и теми же знаками, что в шапке. */}
      <div className="lit flex flex-wrap items-center gap-4 rounded-xl bg-paper-raised px-5 py-4">
        {/* Тот же кружок с человечком, что в шапке (`header-menu.tsx`):
            человек, нажавший там на себя, попадает на страницу, которая
            начинается с того же знака. */}
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-paper-sunken">
          <UserRound aria-hidden className="size-6 text-ink-muted" />
        </span>
        {/* Под адресом здесь стояло «Синхронизировано только что» — та же
            строка, что была в подвале расчёта. Убрана вместе с ней: о
            синхронизации на экране говорится, только когда она встала
            (полоса наверху), а время последнего прохода — ниже, в разделе
            «Синхронизация», для того, кто пришёл его проверить. */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-medium text-ink">{account.email}</p>
        </div>
        <Значок
          icon={account.email_verified ? CircleCheck : CircleDashed}
          tone={account.email_verified ? "ok" : "wait"}
        >
          {account.email_verified ? "Адрес подтверждён" : "Адрес не подтверждён"}
        </Значок>
      </div>

      {/* Та же беда, что в метке выше, но сказанная не теми же словами:
          метка называет состояние, а строка отвечает на вопрос «и что
          теперь». Повтор слово в слово читался бы как сбой разметки. */}
      {!account.email_verified && (
        <p className="text-xs leading-5 text-ink-muted">
          Письмо со ссылкой отправлено при регистрации. Синхронизация работает
          и до подтверждения; без него нельзя восстановить доступ письмом, если
          забудется пароль.
        </p>
      )}

      <Раздел
        icon={FolderSync}
        title="Синхронизация"
        note="Проход случается сам: после правки, при появлении связи и при возвращении на вкладку."
      >
        <Card>
          {/* Время последнего удачного прохода — единственный ответ на
              вопрос «а точно уехало?», который можно проверить. Слово
              «синхронизировано» без времени его не даёт: оно говорит,
              что сейчас нечего отправлять, а не когда отправляли. */}
          <Field
            label="Последняя синхронизация"
            note={
              dirty
                ? "Есть правки, которые ещё не уехали — уедут через мгновение."
                : undefined
            }
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

        {/* Кнопки «синхронизировать сейчас» здесь нет и не должно быть:
            проход случается сам — после правки, при появлении связи и при
            возвращении на вкладку, — и кнопка предлагала бы человеку
            делать работу, которую приложение уже делает. Хуже того, она
            заставляла бы сомневаться: раз кнопка есть, может, без неё не
            уедет? */}
        <Кнопки>
          <Button variant="ghost" disabled={busy} onClick={() => void actions.logout()}>
            <LogOut aria-hidden /> Выйти
          </Button>
        </Кнопки>
      </Раздел>

      <Раздел
        icon={KeyRound}
        title="Доступ"
        note="Пароль защищает ключ, которым шифруются данные, а не сами записи: при смене перешифровывается только обёртка ключа."
      >
        <PasswordChange email={account.email} />
      </Раздел>

      <Раздел icon={ShieldCheck} title="Мои данные">
        <MyData />
      </Раздел>

      <p className="border-t border-rule pt-4 text-xs leading-5 text-ink-faint">
        Приложение работает и без учётной записи — как работало раньше: расчёт
        и данные живут в этом браузере. Учётная запись добавляет копию на
        сервере и перенос между устройствами, и ничего не забирает.{" "}
        <Link href={LEGAL_URLS.policy} className="underline hover:no-underline">
          Политика обработки данных
        </Link>
        .
      </p>
    </div>
  );
}

/** Отказ сервера или неудача действия — одной рамкой на всю страницу. */
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

/**
 * Раздел страницы: заголовок со значком, под ним содержимое.
 *
 * Значок здесь не украшение, а то, чем раздел отличается от соседнего на
 * бегу: страница читается сверху вниз один раз, а возвращаются на неё за
 * чем-то одним — сменить пароль, забрать данные, посмотреть, уехало ли.
 */
function Раздел({
  icon: Icon,
  title,
  note,
  children,
}: {
  icon: LucideIcon;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
          {title}
        </h2>
        {note !== undefined && (
          <p className="text-xs leading-5 text-ink-muted">{note}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Ряд кнопок раздела.
 *
 * Кнопки в приложении растянуты по ширине своего места (`ui/button.tsx`),
 * и строкой это значило бы «выгрузить всё» и «удалить» во всю страницу —
 * два пятна по пол-экрана, одинаково громких. Поэтому сетка, где доля
 * каждой кнопки равна её собственной надписи: ряд получается такой
 * длины, какой требуют слова, и кончается там, где кончаются они.
 *
 * На телефоне доля одна, и кнопки встают столбцом во всю ширину — там
 * иначе и нельзя: в строку они не встанут, а половинчатая кнопка на
 * трёхстах точках это обрезанная надпись.
 */
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
        tone === "ok"
          ? "border-verify/40 text-ink"
          : "border-rule-strong text-ink-muted",
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

/** Смена пароля: перешифровывается обёртка ключа, данные не трогаются. */
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

  // Новый пароль проверяется так же, как при регистрации: это тот же
  // придуманный пароль, и слабеть при смене ему незачем. Нынешний не
  // проверяется вовсе — он уже существует.
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
    <div className="space-y-3">
      <Кнопки>
        <Button variant="outline" disabled={busy} onClick={() => void выгрузить()}>
          <Download aria-hidden /> Выгрузить всё, что обо мне есть
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setСпросить(true)}>
          <Trash2 aria-hidden /> Удалить учётную запись
        </Button>
      </Кнопки>

      <p className="text-xs leading-5 text-ink-muted">
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
