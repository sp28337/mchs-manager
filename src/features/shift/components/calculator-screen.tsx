"use client";

import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/shared/site-header";
import { RegisterForm } from "./register-form";
import { Workspace } from "./workspace";
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
 *
 * --- Почему шапку рисует не этот экран, а рабочий ------------------------
 *
 * У расчёта в шапке стоят настройки и выгрузка профиля, а обеим нужен
 * профиль ВЫБРАННОГО периода — он живёт в рабочем экране вместе с выбором.
 * Поднять его сюда значило бы поднять сюда и половину рабочего экрана. Поэтому
 * рабочий экран отдаёт шапку и содержимое разом, а здесь остаются шапки
 * двух других состояний, где в них ничего, кроме знака, и нет.
 */
export function CalculatorScreen() {
  const { state, save, update, forget } = useProfile();

  if (state.status === "ok") {
    return <Workspace profile={state.profile} onChange={update} onForget={forget} />;
  }

  return (
    <>
      <SiteHeader />

      {state.status === "loading" ? (
        <main className="mx-auto w-full max-w-4xl px-6 pb-12 pt-26 xl:max-w-6xl 2xl:max-w-7xl">
          <p className="text-sm text-ink-muted">Открываем ваш профиль…</p>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-3xl space-y-10 px-6 pb-12 pt-22">
          <header className="space-y-3">
            <h1 className="text-3xl leading-tight">Расскажите о себе</h1>
            <p className="max-w-prose text-ink-muted">
              Пять ответов — и приложение построит ваш график караула на год,
              посчитает норму по производственному календарю и покажет, где
              выданный табель с ней расходится. Спрашиваются они в окне
              «Создать профиль»; те же вопросы потом стоят в настройках.
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
