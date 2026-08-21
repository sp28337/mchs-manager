"use client";

import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/shared/site-header";
import { RegisterForm } from "./register-form";
import { Workspace } from "./workspace";
import { HeaderToolsBones, WorkspaceSkeleton } from "./workspace-skeleton";
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
 * --- Что человек видит, пока профиля нет --------------------------------
 *
 * Пока профиль читается — заглушку рабочего экрана: те же места и те же
 * размеры, что займут числа и сетки. Если профиля нет — главную с окном
 * «Создать профиль» поверх неё (`RegisterForm`), а не отдельный раздел с
 * анкетой: человек нажал кнопку и получил окно, а не новую страницу.
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
      {/* Пока профиль читается, в шапке стоят кости тех же двух кнопок,
          что появятся у расчёта: пустая шапка, в которой они возникают
          разом, читается как рывок ровно так же, как пустое поле под ней.
          Без профиля (анкета) кнопкам браться неоткуда — им нечего
          настраивать и нечего выгружать. */}
      <SiteHeader tools={state.status === "loading" ? <HeaderToolsBones /> : undefined} />

      {state.status === "loading" ? (
        <>
          {/* Заглушка молчит для глаз, но не для диктора: тому нужна не
              раскладка, а одно слово о том, чего он ждёт. */}
          <p className="sr-only" role="status">
            Открываем ваш профиль
          </p>
          <WorkspaceSkeleton />
        </>
      ) : (
        <RegisterForm
          onCreated={save}
          notice={
            state.status === "corrupt" ? (
              <CorruptNotice reason={state.reason} raw={state.raw} />
            ) : null
          }
        />
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
    <section className="space-y-3 rounded-xl bg-signal-soft px-4 py-3 text-sm">
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
