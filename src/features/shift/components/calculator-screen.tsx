"use client";

import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/shared/site-header";
import { cn } from "@/lib/utils/cn";
import { Save } from "lucide-react";
import { RegisterForm } from "./register-form";
import { Workspace } from "./workspace";
import { exportProfile, type StoredProfile } from "../storage/profile";
import { useProfile } from "../storage/use-profile";

/**
 * Экран калькулятора: либо анкета, либо расчёт.
 *
 * --- Почему один адрес, а не `/p/{id}` ----------------------------------
 *
 * Раньше профиль лежал на сервере, и адрес с его идентификатором был
 * единственным способом к нему вернуться — а заодно и единственной
 * защитой: у кого ссылка, тот и видит чужие больничные. Профиль живёт в
 * браузере, поэтому и адрес не нужен, и защищать ссылкой нечего.
 *
 * --- Почему клиентский компонент ----------------------------------------
 *
 * Что показать — анкету или расчёт — известно только из `localStorage`, а
 * его на сервере нет. Отрисовать на сервере догадку и заменить её в
 * браузере значило бы мигнуть человеку анкетой поверх готового расчёта.
 */
/**
 * Ширина рабочей области.
 *
 * Раскладка панельная, и узкая колонка ей противопоказана: на широком
 * экране двенадцать календарных сеток и сводка помещаются рядом. Верхний
 * предел всё же есть — без него на мониторе в 3440 px панели растянулись
 * бы в ленты, а строка текста ушла бы за читаемую длину.
 */
const SHELL = "mx-auto w-full max-w-[112rem] px-3 pb-16 pt-24 sm:px-6 sm:pt-28";

export function CalculatorScreen() {
  const { state, save, update, forget } = useProfile();

  const profile = state.status === "ok" ? state.profile : null;

  return (
    <>
      <SiteHeader
        tagline={
          profile
            ? `${profile.accountingYear} год · ${profile.guardNumber}-й караул`
            : ""
        }
        action={profile ? <SaveToFile profile={profile} /> : null}
      />

      {state.status === "loading" ? (
        <main className={SHELL}>
          <p className="text-sm text-ink-muted">Открываем ваш профиль…</p>
        </main>
      ) : profile ? (
        <main className={cn(SHELL, "space-y-4")}>
          <header className="flex flex-wrap items-end justify-between gap-4 px-1">
            <div className="space-y-1.5">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.14em] text-beacon">
                {profile.accountingYear} год · {profile.guardNumber}-й караул
              </p>
              <h1 className="font-sans text-3xl font-semibold leading-tight tracking-tight">
                {profile.displayName}
              </h1>
            </div>
          </header>

          <Workspace profile={profile} onChange={update} onForget={forget} />
        </main>
      ) : (
        <main className="mx-auto w-full max-w-3xl space-y-10 px-6 pb-12 pt-22">
          <header className="space-y-3">
            <h1 className="text-3xl leading-tight">Расскажите о себе</h1>
            <p className="max-w-prose text-ink-muted">
              Семь ответов — и приложение построит ваш график караула на год,
              посчитает норму по производственному календарю и покажет, где
              выданный табель с ней расходится.
            </p>
          </header>

          {state.status === "corrupt" ? (
            <CorruptNotice reason={state.reason} raw={state.raw} />
          ) : null}

          <RegisterForm onCreated={save} />
        </main>
      )}
    </>
  );
}

/**
 * Выгрузка профиля прямо из шапки.
 *
 * Хранилище браузера — единственное место, где живут данные, и очистка
 * кэша стирает год внесённых отпусков. Такую кнопку нельзя держать только
 * в подвале, докуда нужно долистать двенадцать календарных сеток.
 */
function SaveToFile({ profile }: { profile: StoredProfile }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="rounded-xl"
      size="sm"
      onClick={() => {
        const blob = new Blob([exportProfile(profile)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `табель-${profile.accountingYear}-караул-${profile.guardNumber}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      <div className="hidden xxs:block">
        Сохранить в файл
      </div>
      <div className="xxs:hidden xs:block">
        <Save className="size-5"/>
      </div>
    </Button>
  );
}

/**
 * Испорченное хранилище.
 *
 * Профиль не читается, но выбрасывать его молча нельзя: там мог быть год
 * внесённых отпусков. Поэтому предлагается забрать содержимое как есть —
 * пусть даже разбирать его придётся вручную, это лучше, чем потерять.
 */
function CorruptNotice({ reason, raw }: { reason: string; raw: string }) {
  return (
    <section className="max-w-prose space-y-3 rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
      <p>
        <strong>Сохранённый профиль не читается</strong> ({reason}). Заполните
        анкету заново — или сначала заберите старые данные файлом, чтобы
        внесённые отпуска не пропали.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = "профиль-повреждён.json";
          link.click();
          URL.revokeObjectURL(url);
        }}
      >
        Скачать как есть
      </Button>
    </section>
  );
}
