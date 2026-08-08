import type { Metadata } from "next";

import { CalculatorScreen } from "@/features/shift/components/calculator-screen";

export const metadata: Metadata = {
  // Коротко: шаблон из корневого layout допишет название приложения.
  title: "Расчёт",
  description:
    "Постройте график караула на год, посчитайте норму по производственному " +
    "календарю и сверьте её с выданным табелем. Данные остаются в браузере.",
  // Страница расчёта индексироваться не должна: искать нужно лендинг, где
  // объяснено, что это и кому. Пустой калькулятор в выдаче — это переход
  // на форму без единого слова о том, зачем её заполнять.
  robots: { index: false, follow: true },
};

export default function CalculatorPage() {
  return <CalculatorScreen />;
}
