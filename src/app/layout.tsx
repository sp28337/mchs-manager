import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, PT_Sans_Narrow } from "next/font/google";

import { LiveryBand } from "@/components/shared/livery-band";
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
  title: {
    default: "Калькулятор переработки для пожарных",
    template: "%s — калькулятор переработки для пожарных",
  },
  description:
    "Проверка табеля суммированного учёта при графике сутки через трое: " +
    "норма по производственному календарю, исключение отпусков и больничных, " +
    "сверка с выданным табелем.",
  applicationName: "Калькулятор переработки для пожарных",
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
      <body className="min-h-dvh bg-paper-sunken text-ink">
        {/* Свечение под содержимым, а не за ним: слой фиксированный,
            поэтому при прокрутке не уезжает и не создаёт второй горизонт.
            Он же задаёт направление взгляда — светлее там, где начинается
            чтение. */}
        <div aria-hidden className="app-glow" />
        {/* Обёртка нужна ради полос во всю ширину окна — сейчас это
            фоновый табель первого экрана, который шире колонки `main`.

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
        <div className="relative z-10 overflow-x-clip">
          <Providers>{children}</Providers>
          {/* Кромка страницы — общая на оба раздела: и лендинг, и
              калькулятор кончаются одинаково, потому что это один сайт, а
              не два. */}
          <LiveryBand />
        </div>
      </body>
    </html>
  );
}
