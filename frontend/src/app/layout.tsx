import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, PT_Sans_Narrow } from "next/font/google";

import { ThemeToggle } from "@/components/ui/theme-toggle";

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
  title: "Учёт служебного времени ФПС ГПС",
  description:
    "Учёт служебного времени, компенсаций и отпусков сотрудников федеральной противопожарной службы",
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
        <Providers>
          {/* Переключатель темы стоит вне страницы, потому что относится
              не к расчёту, а к окну. Он же — единственное, что закреплено
              наверху: панель с чем-то ещё отнимала бы высоту у календаря
              на весь год. */}
          <div className="flex justify-end px-6 pt-4">
            <ThemeToggle />
          </div>
          {children}
        </Providers>
      </body>
    </html>
  );
}
