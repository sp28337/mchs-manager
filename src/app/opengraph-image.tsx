import { ImageResponse } from "next/og";

/**
 * Картинка ссылки — то, что видно в мессенджере до перехода.
 *
 * Ссылку на этот расчёт пересылают в рабочем чате, и там она либо
 * разворачивается в понятную карточку, либо остаётся голым адресом. Второе
 * стоит переходов: человек не открывает то, о чём не знает, что это.
 *
 * Рисуется один раз на сборке, а не на лету: сайт выгружается в статику, и
 * сервера, который собрал бы картинку по запросу, у него нет.
 *
 * --- Почему всё-таки со шрифтами сайта -------------------------------------
 *
 * Здесь стоял системный гротеск — по доводу «карточку читают в ленте, а не
 * в документе». Довод неверный: карточка и есть первое, что человек видит о
 * сайте, и набранная чужой гарнитурой она обещает другой сайт. Числа
 * особенно: на всех экранах приложения они моноширинные, а в карточке
 * стояли пропорциональным гротеском — то есть ровно тем, чем в приложении
 * не набрано ничего.
 *
 * Гарнитуры те же, что в разметке (`layout.tsx`), и берутся оттуда же, где
 * их берёт `next/font`, — из Google Fonts, на сборке. Формат TTF: `satori`,
 * которым рисуется картинка, WOFF2 не понимает, а Google без заголовка
 * браузера отдаёт как раз TTF. Просить приходится ровно те знаки, что
 * набраны ниже (`text=`): полная кириллическая гарнитура весит сотни
 * килобайт, а нужно из неё три десятка букв.
 *
 * Не скачалось — карточка рисуется тем, что есть у `satori` своего. Ронять
 * из-за шрифта сборку сайта нельзя: без картинки ссылка разворачивается
 * хуже, без сайта не разворачивается вовсе.
 */
export const dynamic = "force-static";

export const alt = "График 1 3 — норма и переработка при сменном графике";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Цвета — тёмной темы приложения, теми же значениями, что в `globals.css`.
   Карточку смотрят в ленте мессенджера, а та почти всегда тёмная. */
const PAPER = "#1f2023";
const PAPER_RAISED = "#2a2c2f";
const INK = "#e8eae6";
const INK_MUTED = "#a3a9b0";
const SIGNAL = "#db0e17";
const VERIFY = "#45a352";

/** Знак приложения — та же геометрия, что в `ui/logo.tsx`, до десятой доли. */
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
<rect x="1" y="1" width="10" height="10" rx="2" fill="${SIGNAL}"/>
<rect x="13.75" y="1.75" width="8.5" height="8.5" rx="1.75" stroke="#8a8578" stroke-width="1.5" opacity="0.45"/>
<rect x="1.75" y="13.75" width="8.5" height="8.5" rx="1.75" stroke="#8a8578" stroke-width="1.5" opacity="0.45"/>
<rect x="13.75" y="13.75" width="8.5" height="8.5" rx="1.75" stroke="#8a8578" stroke-width="1.5" opacity="0.45"/>
</svg>`;

const BRAND = "ГРАФИК";
const MARK = "1|3";
/* Те же два слова, что стоят заголовком на первом экране, и тот же зелёный
   на первом из них: карточка обязана показывать сайт, а не пересказывать
   его своими словами. */
const HEAD_GREEN = "Удобный инструмент";
const HEAD_INK = "для учёта рабочего времени";
/* Графики названы словами все до одного. Прежде здесь стояло «сутки через
   трое, два через два, 5|2» — два названия словами, третье цифрами, будто
   пятидневка какая-то другая по природе. */
const SUB = "Сутки через трое, два через два, пятидневка или свой цикл";

/** Полоса итога — те же три числа и те же подписи, что над сеткой. */
const FIGURES: { value: string; unit: string; caption: string; tone?: string }[] = [
  { value: "1972", unit: "ч", caption: "Норма периода" },
  { value: "2192", unit: "ч", caption: "Фактически" },
  { value: "220", unit: "ч", caption: "Переработка", tone: VERIFY },
];

/**
 * Гарнитура из Google Fonts — той же дорогой, какой её берёт `next/font`.
 *
 * Без заголовка браузера Google отдаёт `src: url(....ttf)`, а `satori`
 * умеет TTF и не умеет WOFF2 — на этом всё и держится. `text` сужает
 * гарнитуру до нужных знаков: иначе на карточку уезжала бы вся кириллица.
 */
async function googleFont(
  family: string,
  weight: number,
  text: string,
): Promise<{ name: string; data: ArrayBuffer; weight: 400 | 500 | 700; style: "normal" }> {
  const url =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}` +
    `&text=${encodeURIComponent(text)}`;
  const css = await fetch(url).then((response) => response.text());
  const file = /src:\s*url\((?<url>[^)]+)\)/.exec(css)?.groups?.url;
  if (file === undefined) throw new Error(`Не нашлась гарнитура ${family} ${weight}`);
  const data = await fetch(file).then((response) => response.arrayBuffer());
  return { name: family, data, weight: weight as 400 | 500 | 700, style: "normal" };
}

/** Все четыре начертания разом. Не вышло — рисуем без них. */
async function fonts() {
  const digits = "0123456789ч";
  try {
    return await Promise.all([
      googleFont("PT Sans Narrow", 700, `${BRAND}${MARK}`),
      googleFont("PT Sans Narrow", 400, MARK),
      googleFont("IBM Plex Sans", 400, `${HEAD_GREEN}${HEAD_INK}${SUB}${FIGURES.map((f) => f.caption).join("")}`),
      googleFont("IBM Plex Mono", 400, digits),
      googleFont("IBM Plex Mono", 500, digits),
    ]);
  } catch {
    return undefined;
  }
}

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: INK,
          padding: 64,
          fontFamily: "IBM Plex Sans",
        }}
      >
        {/* Знак и название — те же, что в шапке сайта: карточка и страница
            должны узнаваться как одно место. Цифры графика приглушены и
            набраны моноширинной, как и в шапке. */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img
            width={52}
            height={52}
            alt=""
            src={`data:image/svg+xml;utf8,${encodeURIComponent(LOGO)}`}
          />
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              fontFamily: "PT Sans Narrow",
              fontWeight: 700,
              fontSize: 40,
              letterSpacing: 1.5,
            }}
          >
            {/* Цифры графика набраны той же узкой гарнитурой, что и слово,
                и тем же кеглем — как в шапке сайта, где они просто
                наследуют её. Приглушены они там же и так же. Разделитель
                тоньше цифр: в шапке он `font-extralight`. */}
            <span>{BRAND}</span>
            <span style={{ display: "flex", color: INK_MUTED }}>
              <span>{MARK[0]}</span>
              <span style={{ fontWeight: 400, padding: "0 2px" }}>{MARK[1]}</span>
              <span>{MARK[2]}</span>
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 76,
              lineHeight: 1.06,
              letterSpacing: -1,
            }}
          >
            <span style={{ color: VERIFY }}>{HEAD_GREEN}</span>
            <span>{HEAD_INK}</span>
          </div>
          <div style={{ fontSize: 28, color: INK_MUTED, maxWidth: 960 }}>{SUB}</div>
        </div>

        {/* Полоса итога — ОДНОЙ плашкой на три числа, как над сеткой:
            норму, факт и разницу сравнивают между собой, и рамка вокруг
            каждого разрезала бы то, что читается вместе. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 72,
            alignSelf: "flex-start",
            background: PAPER_RAISED,
            borderRadius: 24,
            padding: "22px 44px",
            // Свет лампы на поднятой плашке — тот же блик по верхней кромке
            // и та же тень вниз, что у неё на экране (`lit` в
            // `globals.css`). Без них плашка лежит на бумаге наклейкой.
            boxShadow:
              "inset 0 1px 0 0 rgba(168, 232, 186, 0.28), 0 12px 26px -16px rgba(0, 0, 0, 0.7)",
          }}
        >
          {FIGURES.map((figure) => (
            <div
              key={figure.caption}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  fontFamily: "IBM Plex Mono",
                  fontWeight: figure.tone ? 500 : 400,
                  fontSize: 46,
                  color: figure.tone ?? INK,
                }}
              >
                {figure.value}
                <span style={{ marginLeft: 6, fontSize: 22, color: INK_MUTED }}>
                  {figure.unit}
                </span>
              </div>
              <div style={{ fontSize: 20, color: INK_MUTED }}>{figure.caption}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts: await fonts() },
  );
}
