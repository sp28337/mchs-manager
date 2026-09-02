import type { Metadata } from "next";

import { CalculatorScreen } from "@/features/shift/components/calculator-screen";

export const metadata: Metadata = {
  // Коротко: шаблон из корневого layout допишет название приложения.
  title: "Расчёт",
  description:
    "Постройте свой сменный график на год и посчитайте норму и переработку " +
    "по производственному календарю. Данные остаются в браузере.",
  // Страница расчёта индексироваться не должна: искать нужно лендинг, где
  // объяснено, что это и кому. Пустой калькулятор в выдаче — это переход
  // на форму без единого слова о том, зачем её заполнять.
  robots: { index: false, follow: true },
};

export default function CalculatorPage() {
  return <CalculatorScreen />;
}
