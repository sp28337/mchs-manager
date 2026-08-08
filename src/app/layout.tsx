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
      <body className="min-h-dvh bg-paper text-ink">
        {/* Шапка рисуется страницами, а не здесь: у лендинга и калькулятора
            в ней разное главное действие, и общая шапка на оба означала бы
            либо пустое место, либо кнопку не к месту. */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
