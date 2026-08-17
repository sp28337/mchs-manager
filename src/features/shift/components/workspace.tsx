"use client";

import { useMemo, useState } from "react";

import { Hint } from "@/components/ui/hint";
import { SiteHeader } from "@/components/shared/site-header";
import { formatPeriodRu } from "../domain/format";
import { todayIso, type IsoDate } from "../domain/plain-date";
import {
  accountingPeriodsOf,
  calculateFor,
  liveBounds,
  monthBounds,
  overtimePayFor,
  statutoryBounds,
} from "../model/derive";
import type { StoredProfile } from "../storage/profile";
import { DayEditor } from "./day-editor";
import { HeaderTools } from "./header-tools";
import { PeriodSummary } from "./period-summary";
import { ProfileFooter } from "./profile-footer";
import { CalendarNote } from "./year-calendar-editor";
import {
  YearView,
  type StatutoryChoice,
  type YearViewKind,
} from "./year-view";

/**
 * Рабочий экран: период, расчёт, график, отсутствия и сверка.
 *
 * Всё на одной странице намеренно. Человек сверяет бумажный табель за
 * один месяц, и разносить норму, график и расхождения по вкладкам значило
 * бы заставить его держать числа в голове, переходя между ними, — ровно в
 * тот момент, когда важна точность.
 *
 * --- Что стоит в боковой колонке и почему именно это --------------------
 *
 * Слева — ВВОД, справа — ВЫВОД. Слева человек говорит приложению, что он
 * знает: какой период смотрим, какой у него оклад, когда он был в отпуске,
 * куда его вызывали и что написано в выданном табеле. Справа приложение
 * отвечает: вот норма, вот график, вот производственный календарь.
 *
 * Раньше и то и другое стояло одной лентой сверху вниз, и это стоило
 * человеку прокрутки на каждом шаге: чтобы посмотреть тот же график за
 * соседний месяц, приходилось листать двенадцать календарных сеток вверх,
 * переключать и листать обратно; чтобы внести отпуск и увидеть, как
 * изменилась норма, — то же самое в другую сторону.
 *
 * Колонка закреплена, поэтому ввод и его последствие видны одновременно:
 * внесённый отпуск сразу меняет норму справа, и человеку не нужно
 * запоминать, сколько было до.
 *
 * --- Чем колонка заменена на телефоне ------------------------------------
 *
 * Ничем на самой странице: там её нет вовсе. Значки блоков переехали в
 * шапку (`aside-panels`, `PanelDock`), и нажатие открывает ОДИН блок в
 * окне — тот, который значок называет.
 *
 * Колонка на трёхсотвосьмидесяти точках была бы лентой закрытых крышек над
 * расчётом: до первого числа пять нажатий. Плавающая полоска у правого
 * края, которая была здесь до шапки, эту ленту убрала, но висела поверх
 * содержимого и отнимала у календаря полосу справа. В шапке строка всё
 * равно есть, и справа в ней пусто — название сайта там скрыто.
 *
 * --- Почему все блоки колонки сворачиваются ------------------------------
 *
 * Их пять, и развёрнутыми они не помещаются ни в один экран. Открытым
 * держится только то, что нужно всегда: период и сумма. Остальное человек
 * открывает, когда вносит, — а свёрнутая крышка при этом отвечает на свой
 * вопрос без раскрытия («внесено периодов: 3», «расхождений нет»).
 *
 * --- Почему колонку можно убрать целиком ---------------------------------
 *
 * График на год и двенадцать календарных сеток — самое широкое, что есть
 * на экране, и девятнадцать рем слева им мешают. Но убрать колонку совсем
 * значило бы спрятать вход в неё: человек, свернувший её ради календаря,
 * должен видеть, куда нажать, чтобы вернуться к отпускам.
 *
 * Поэтому она сворачивается не в ничто, а в полоску значков. Значок в
 * полоске — тот же, что в заголовке блока, и нажатие на него делает сразу
 * два дела: возвращает колонку и открывает именно этот блок. Иначе
 * человек, нажавший на сирену, получил бы развёрнутую колонку и всё тот же
 * закрытый блок вызовов.
 *
 * Свёрнутость — состояние экрана, а не данных, и в профиль не пишется:
 * человек сворачивает колонку на время, пока смотрит календарь.
 *
 * --- Почему нет состояний загрузки --------------------------------------
 *
 * Считать больше нечего ждать: расчёт идёт здесь же, за доли миллисекунды,
 * и ошибок сети у него не бывает. Экран, который раньше умел показывать
 * «Считаем…» и «Сервер недоступен», теперь просто всегда показывает
 * результат — и это самое заметное следствие переноса расчёта в браузер.
 */

export interface WorkspaceProps {
  profile: StoredProfile;
  onChange: (change: (previous: StoredProfile) => StoredProfile) => void;
  onForget: () => void;
}

export function Workspace({ profile, onChange, onForget }: WorkspaceProps) {
  const periods = accountingPeriodsOf(profile);

  // Умолчание — учётный период целиком: именно по его итогу определяется
  // переработка (ст. 104 ТК РФ), и открывать экран на месяце значило бы
  // показывать первым то число, которое ничего не решает.
  const widest = periods.at(-1) ?? "year";
  const [statutory, setStatutory] = useState<StatutoryChoice>({
    kind: widest,
    index: 0,
  });
  // Месяц хранится отдельно от периода, а не вместо него: это уточнение
  // поверх выбранного периода, и `null` значит «весь период». Раньше это
  // было одно поле с двумя режимами, и выбор месяца стирал выбранный
  // период — вернуться к нему можно было, только вспомнив, какой он был.
  const [month, setMonth] = useState<number | null>(null);

  const chosen =
    month === null
      ? statutoryBounds(profile.accountingYear, statutory.kind, statutory.index)
      : monthBounds(profile.accountingYear, month);

  // Режим «веду табель» обрезает выбранный отрезок живым временем: от
  // первой смены по сегодня. Сегодняшний день берётся один раз за
  // отрисовку — переживать полночь странице не приходится, её открывают
  // и закрывают в тот же день.
  const { periodStart, periodEnd } = profile.liveMode
    ? liveBounds(chosen, profile.firstShiftDate, todayIso())
    : chosen;

  const calculation = useMemo(
    () => calculateFor(profile, periodStart, periodEnd),
    [profile, periodStart, periodEnd],
  );

  const pay = useMemo(() => overtimePayFor(profile, calculation), [profile, calculation]);

  // Что показано на сетке года. Живёт здесь, а не в самой сетке, потому
  // что от этого зависят заголовок и подпись раздела вокруг неё.
  const [yearView, setYearView] = useState<YearViewKind>("shifts");

  // День, по которому нажали в сетке. Правка идёт от дня, а не от формы
  // со списком: человек уже нашёл в календаре те сутки, из-за которых
  // спорит, и переносить их дату в отдельную форму глазами — лишний шаг,
  // в котором и ошибаются.
  const [pickedDay, setPickedDay] = useState<IsoDate | null>(null);

  return (
    <>
      {/* Шапка рисуется отсюда, а не с экрана вокруг: в ней стоят
          настройки и расчёт денег, а им нужен `calculation` выбранного
          периода — он живёт здесь. Тянуть его наверх значило бы поднять
          туда и выбор периода, то есть половину этого экрана. */}
      <SiteHeader
        tagline={`${profile.accountingYear} год / ${profile.guardNumber}-й караул`}
        tools={
          <HeaderTools
            profile={profile}
            calculation={calculation}
            pay={pay}
            onChange={onChange}
          />
        }
      />

      <main className="mx-auto w-full px-6 pb-12 pt-26 2xl:max-w-[2000px]">
      {/* Поле под именем — не про воздух: полоса с числами закрывает над
          собой двенадцать точек бумаги (щиток в `PeriodSummary`, он гасит
          просвет под шапкой), и без этого зазора щиток лёг бы прямо на
          имя. */}
      <header className="pb-12">
        <h1 className="text-3xl leading-tight">{profile.displayName}</h1>
      </header>

      {/* Итог — закреплённой полосой, календарь — во всю ширину под ней.
          Числа и сетка нужны одновременно: человек отмечает день и тут же
          смотрит, что стало с нормой. Колонкой слева это стоило календарю
          четырёхсот точек ширины, а лентой сверху — прокрутки назад через
          двенадцать сеток. */}
      <PeriodSummary
        calculation={calculation}
        accountingYear={profile.accountingYear}
        payTotal={pay?.primary.total ?? null}
        periodLabel={formatPeriodRu(periodStart, periodEnd)}
      />

      <div className="space-y-10">
      {/* Календарь не сворачивается. Крышка над ним была наследством от
          времён, когда на странице стояло пять разделов и двенадцать сеток
          отодвигали всё остальное вниз. Теперь ниже только подвал, а сетка
          — то, ради чего экран открыт: закрывать её значит закрывать
          страницу. */}
      <section aria-labelledby="calendar-heading" className="space-y-4">
        <h2 id="calendar-heading" className="flex items-center gap-2 text-xl">
          Календарь
          {yearView === "calendar" ? (
            <Hint label="Про производственный календарь">
              <CalendarNote profile={profile} />
            </Hint>
          ) : null}
        </h2>
        <YearView
          profile={profile}
          calculation={calculation}
          view={yearView}
          onViewChange={setYearView}
          onChange={onChange}
          statutory={statutory}
          onStatutory={setStatutory}
          month={month}
          onMonth={setMonth}
          onPickDay={setPickedDay}
        />
      </section>

      <ProfileFooter profile={profile} onForget={onForget} />
      </div>

      <DayEditor
        day={pickedDay}
        profile={profile}
        onChange={onChange}
        onClose={() => setPickedDay(null)}
      />
      </main>
    </>
  );
}
