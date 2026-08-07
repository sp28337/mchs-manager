import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ErrorPanel } from "@/components/shared/error-panel";
import { getProfile } from "@/features/shift/api";
import { Workspace } from "@/features/shift/components/workspace";
import {
  CONDITIONS_LABELS,
  EMPLOYMENT_LABELS,
  hours,
  type Profile,
} from "@/features/shift/schemas";
import { ApiError } from "@/lib/api-client/client";

export const metadata: Metadata = { title: "Мой табель — сверка" };

/**
 * Личный экран.
 *
 * --- Об адресе как ключе -------------------------------------------------
 *
 * Аутентификации в приложении нет, и профиль открывается по ссылке с его
 * идентификатором. Это осознанное упрощение, а не недосмотр: ссылку надо
 * беречь, потому что она и есть доступ. Сказано об этом прямо на самом
 * экране — умолчать значило бы дать человеку ложное чувство закрытости.
 *
 * Данные, которые здесь лежат, выбраны так, чтобы утечка ссылки стоила
 * недорого: график караула, периоды отпуска и часы. Ни фамилии, ни
 * табельного номера, ни подразделения приложение не спрашивает.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;

  let profile: Profile;
  try {
    profile = await getProfile(profileId, { cache: "no-store" });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) notFound();
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <ErrorPanel
          error={
            cause instanceof ApiError
              ? cause
              : new ApiError({
                  type: "about:blank",
                  title: "Сервер недоступен",
                  status: 0,
                  detail: "Не удалось получить профиль.",
                })
          }
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-6 py-12">
      <header className="space-y-3 border-b border-rule pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
          {profile.accountingYear} год · {profile.guardNumber}-й караул · первая смена{" "}
          {new Date(`${profile.firstShiftDate}T00:00:00Z`).getUTCDate()} января
        </p>
        <h1 className="text-3xl leading-tight">{profile.displayName}</h1>
        <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div>
            <dt className="text-xs text-ink-muted">Основание</dt>
            <dd>{EMPLOYMENT_LABELS[profile.employmentKind]}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Условия</dt>
            <dd>{CONDITIONS_LABELS[profile.workingConditions]}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Недельная норма</dt>
            <dd className="font-mono">
              {hours(profile.weeklyNormHours)} ч
              <span className="ml-2 font-sans text-xs text-ink-muted">
                {profile.weeklyNormBasis}
              </span>
            </dd>
          </div>
        </dl>
      </header>

      <Workspace profile={profile} />

      <footer className="space-y-2 border-t border-rule pt-6 text-xs text-ink-muted">
        <p className="max-w-prose">
          <strong>Сохраните адрес этой страницы.</strong> Входа по паролю в
          приложении пока нет, и ссылка — единственный способ вернуться к своему
          расчёту. Она же и единственная защита: у кого есть ссылка, тот видит
          эти данные.
        </p>
        <p>
          <Link href="/" className="underline underline-offset-2">
            Завести другой профиль
          </Link>
        </p>
      </footer>
    </main>
  );
}
