"use client";

import { RegisterForm } from "@/features/shift/components/register-form";
import { Workspace } from "@/features/shift/components/workspace";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/features/shift/storage/use-profile";

/**
 * Единственная страница приложения.
 *
 * --- Почему одна, а не `/` и `/p/{id}` ----------------------------------
 *
 * Раньше профиль лежал на сервере, и адрес страницы с его идентификатором
 * был единственным способом к нему вернуться — а заодно и единственной
 * защитой: у кого ссылка, тот и видит чужие больничные. Профиль теперь
 * живёт в браузере, поэтому и адрес не нужен, и защищать ссылкой нечего.
 *
 * --- Почему это клиентский компонент ------------------------------------
 *
 * Что показать — форму или расчёт — известно только из `localStorage`, а
 * его на сервере нет. Отрисовать на сервере догадку и заменить её в
 * браузере значило бы мигнуть человеку формой регистрации поверх его же
 * готового расчёта.
 */
export default function HomePage() {
  const { state, save, update, forget } = useProfile();

  if (state.status === "loading") {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-sm text-ink-muted">Открываем ваш профиль…</p>
      </main>
    );
  }

  if (state.status === "ok") {
    const { profile } = state;
    return (
      /* Шире на больших экранах: календарь года — двенадцать месячных
         сеток, и на 4xl они жались в три узких столбца с переносом. */
      <main className="mx-auto w-full max-w-4xl space-y-10 px-6 pb-12 pt-6 xl:max-w-6xl 2xl:max-w-7xl">
        <header className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
            {profile.accountingYear} год · {profile.guardNumber}-й караул · первая
            смена {Number(profile.firstShiftDate.slice(8, 10))} января
          </p>
          <h1 className="text-3xl leading-tight">{profile.displayName}</h1>
        </header>

        <Workspace profile={profile} onChange={update} onForget={forget} />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-6 pb-12 pt-6">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
          Суммированный учёт служебного времени
        </p>
        <h1 className="text-3xl leading-tight">Сверьте свой табель</h1>
        <p className="max-w-prose text-ink-muted">
          Инструмент для пожарных, дежурящих сутки через трое, — аттестованных и
          вольнонаёмных. Строит ваш график караула на год, считает норму по
          производственному календарю и показывает, где выданный табель с ней
          расходится.
        </p>
      </header>

      {state.status === "corrupt" ? <CorruptNotice reason={state.reason} raw={state.raw} /> : null}

      <section
        aria-labelledby="why"
        className="space-y-2 rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3"
      >
        <h2 id="why" className="font-display text-sm font-bold uppercase tracking-wide">
          Самая частая ошибка в табеле
        </h2>
        <p className="max-w-prose text-sm">
          За смену, попавшую в отпуск или на больничный, ставят «минус 24 часа».
          Так делать нельзя. При суммированном учёте часы по графику,
          пришедшиеся на отсутствие с сохранением места службы,{" "}
          <strong>исключаются из нормы</strong>, а не вычитаются из факта
          (письмо Роструда от 01.03.2010 № 550-6-1). Иначе отпуск превращается
          в долг, которого нет.
        </p>
      </section>

      <section
        aria-labelledby="privacy"
        className="max-w-prose space-y-2 border-y border-rule py-4 text-sm"
      >
        <h2 id="privacy" className="font-display text-sm font-bold uppercase tracking-wide">
          Ваши ответы останутся у вас
        </h2>
        <p>
          Здесь спрашивают о больничных и, у вольнонаёмных, об инвалидности —
          это сведения о здоровье. Сервера у приложения нет: всё, что вы
          введёте, записывается в память вашего браузера, расчёт идёт на вашем
          устройстве, и наружу не уходит ничего. Проверить просто — страница
          работает без интернета.
        </p>
      </section>

      <section aria-labelledby="register" className="space-y-4">
        <h2 id="register" className="text-xl">
          Расскажите о себе
        </h2>
        <RegisterForm onCreated={save} />
      </section>
    </main>
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
  function download() {
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "профиль-повреждён.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="max-w-prose space-y-3 rounded-sm border-l-2 border-signal bg-signal-soft px-4 py-3 text-sm">
      <p>
        <strong>Сохранённый профиль не читается</strong> ({reason}). Заполните
        форму заново — или сначала заберите старые данные файлом, чтобы
        внесённые отпуска не пропали.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={download}>
        Скачать как есть
      </Button>
    </section>
  );
}
