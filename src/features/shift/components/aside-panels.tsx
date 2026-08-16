"use client";

import {
  Banknote,
  CalendarMinus2,
  CalendarRange,
  ClipboardCheck,
  Settings2,
  Siren,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Блоки боковой колонки: состав, порядок и значки.
 *
 * --- Почему это отдельный файл -------------------------------------------
 *
 * Список читают трое, и все в разных местах экрана: сама колонка рисует из
 * него карточки, свёрнутая полоска — значки, а шапка на телефоне — те же
 * значки в своей строке. Живи он внутри рабочего экрана, шапке пришлось бы
 * либо тянуть его оттуда, либо завести свою копию — и первая же новая
 * карточка появилась бы не везде.
 *
 * --- Почему значки именно такие ------------------------------------------
 *
 * Выбраны по смыслу, а не по красоте: диапазон дат у периода, купюра у
 * денег, календарь с минусом у отсутствий (они вычитаются из нормы), сирена
 * у вызовов, ползунки у настроек. Значок обязан быть ОДНИМ И ТЕМ ЖЕ в
 * заголовке карточки и в полоске, иначе полоска превращается в ребус.
 */
export type PanelId =
  | "period"
  | "pay"
  | "absences"
  | "callouts"
  | "reconcile"
  | "settings";

export const PANEL_META: Record<PanelId, { title: string; Icon: LucideIcon }> = {
  period: { title: "Период", Icon: CalendarRange },
  pay: { title: "Сколько это в деньгах", Icon: Banknote },
  absences: { title: "Отпуска и больничные", Icon: CalendarMinus2 },
  callouts: { title: "Вызовы помимо графика", Icon: Siren },
  reconcile: { title: "Что написано в вашем табеле", Icon: ClipboardCheck },
  settings: { title: "Настройки", Icon: Settings2 },
};

/**
 * Что показывается и в каком порядке.
 *
 * Здесь перечислены только работающие блоки: значок обязан куда-то вести, а
 * нажатие на значок выключенного блока не открыло бы ничего. Сверки в
 * списке нет — её карточка выключена в разметке рабочего экрана.
 *
 * Настройки последними: их задают однажды и почти не трогают, а остальное
 * открывают при каждом разборе.
 */
export const PANEL_ORDER: readonly PanelId[] = [
  "period",
  "pay",
  "absences",
  "callouts",
  "settings",
];

/** Опознаватель блока в разметке: по нему в блок уводится фокус. */
export const panelDomId = (id: PanelId) => `aside-panel-${id}`;

/** Значок блока — тот же в заголовке карточки и в полоске. */
export function PanelIcon({ id }: { id: PanelId }) {
  const { Icon } = PANEL_META[id];
  return <Icon aria-hidden />;
}

/**
 * Кнопка-значок: в полоске свёрнутой колонки и в шапке на телефоне.
 *
 * Подпись обязательна и живёт в двух местах сразу: `aria-label` — для
 * программы чтения, `title` — для всплывающей подсказки браузера. На
 * экране рядом со значком нет ни одного слова, и без второй человек, не
 * узнавший значок, остаётся гадать.
 */
export function RailButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg",
        "text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-trace",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Значки блоков в шапке — то, чем на телефоне заменена боковая колонка.
 *
 * --- Почему в шапке ------------------------------------------------------
 *
 * Сначала это была плавающая полоска у правого края. Она не занимала верх
 * страницы, но висела поверх содержимого и отнимала у календаря полосу
 * справа. В шапке места ровно столько же, а отнимать уже нечего: строка
 * там всё равно есть, и справа в ней пусто — название сайта на телефоне
 * убрано, остался только знак.
 *
 * --- Почему открывается один блок ----------------------------------------
 *
 * Значок называет блок, и открывать он обязан ровно его. Колонка целиком
 * на экране в триста восемьдесят точек — это та самая лента над расчётом,
 * из-за которой всё и затевалось, только поверх содержимого.
 *
 * --- Почему это одна обведённая группа, а не пять кнопок -----------------
 *
 * Рядом в шапке стоит «Сохранить в файл» — обведённая пилюля высотой в
 * девять единиц. Пять голых значков возле неё выглядели как обрывки: у
 * соседа есть край, у них нет. Общая рамка даёт им тот же край, ту же
 * скруглённость и ту же подложку, и заодно говорит правду о существе
 * дела — это один орган управления с пятью входами, а не пять независимых
 * действий.
 *
 * Высота считается до пикселя: два по краю плюс восемь на кнопку плюс два
 * — ровно девять единиц, как у соседней пилюли. Иначе в строке было бы
 * два разных роста.
 */
export function PanelDock({
  onOpen,
  className,
}: {
  onOpen: (id: PanelId) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Что вы вносите"
      className={cn(
        "inline-flex h-9 items-center rounded-xl border border-rule-strong bg-paper-raised p-0.5",
        className,
      )}
    >
      {PANEL_ORDER.map((id) => {
        const { title, Icon } = PANEL_META[id];
        return (
          <RailButton
            key={id}
            label={title}
            onClick={() => onOpen(id)}
            className="size-8 text-ink-muted"
          >
            <Icon aria-hidden className="size-4.5" />
          </RailButton>
        );
      })}
    </div>
  );
}
