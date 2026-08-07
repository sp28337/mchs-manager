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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
