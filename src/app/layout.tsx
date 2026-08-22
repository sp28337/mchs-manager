import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, PT_Sans_Narrow } from "next/font/google";

import { Providers } from "./providers";
import "./globals.css";

/* Кириллица подключена явно у всех трёх гарнитур: интерфейс русскоязычный
   целиком, и латинского подмножества ему недостаточно. */
const display = PT_Sans_Narrow({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "700"],
  variable: "--font-pt-sans-narrow",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // Шаблон, а не готовая строка: каждая страница подставляет своё, и
  // название приложения не приходится повторять руками.
  //
  // Название стоит вторым, а не первым: в выдаче первыми читаются слова
  // запроса, а «График 1 3» ни в один запрос не входит — по нему приходят
  // только те, кто уже знает, куда идёт.
  title: {
    default: "График 1 3 — норма и переработка при графике сутки через трое",
    template: "%s — График 1 3",
  },
  description:
    "График 1 3 на год: смены, отпуска, больничные, работа помимо графика. " +
    "Норма по производственному календарю. Расчёт идёт в браузере.",
  applicationName: "График 1 3",
  // Ссылки в разметке страниц относительные; без базы Open Graph получил
  // бы неполный адрес и не открылся бы при пересылке.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ru"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-paper text-ink">
        {/* Обёртка нужна ради полос во всю ширину окна — сейчас это
            первый экран, который шире колонки `main`.

            Обрезать такое приходится настоящим элементом: `overflow-x` на
            `body` всплывает на область просмотра, сам `body` остаётся
            необрезанным, и страница начинает ездить вбок на ширину полосы
            прокрутки. Ширина этой обёртки — 100% страницы, полосу
            прокрутки она не включает, поэтому лишнее срезается по краю
            содержимого.

            Именно `clip`, а не `hidden`: `hidden` создал бы контейнер
            прокрутки со всеми последствиями для `position: sticky`.
            Шапку это не задевает — она `fixed`, а такие элементы
            обрезаются только своим блоком-контейнером.

            Сама шапка рисуется страницами, а не здесь: у лендинга и
            калькулятора в ней разное главное действие, и общая шапка на
            оба означала бы либо пустое место, либо кнопку не к месту. */}
        <div className="overflow-x-clip">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
