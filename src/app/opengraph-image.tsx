import { ImageResponse } from "next/og";

/**
 * Картинка ссылки — то, что видно в мессенджере до перехода.
 *
 * Ссылку на этот расчёт пересылают в рабочем чате, и там она либо
 * разворачивается в понятную карточку, либо остаётся голым адресом. Второе
 * стоит переходов: человек не открывает то, о чём не знает, что это.
 *
 * Рисуется один раз на сборке, а не на лету: сайт выгружается в статику,
 * сервера, который собрал бы картинку по запросу, у него нет. Шрифты не
 * подключаются — своя гарнитура потребовала бы скачивания файла на сборке,
 * а системного гротеска здесь достаточно: карточку читают в ленте, а не в
 * документе.
 */
export const dynamic = "force-static";

export const alt =
  "График 1/3 — норма и переработка при графике сутки через трое";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#1f2023",
          color: "#e8eae6",
          padding: 56,
          fontSize: 32,
        }}
      >
        {/* Знак и название — те же, что в шапке сайта: карточка и страница
            должны узнаваться как одно место. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", width: 44, height: 44, gap: 4 }}>
            <div style={{ width: 20, height: 20, background: "#db0e17" }} />
            <div style={{ width: 20, height: 20, background: "#2a2c2f" }} />
            <div style={{ width: 20, height: 20, background: "#2a2c2f" }} />
            <div style={{ width: 20, height: 20, background: "#2a2c2f" }} />
          </div>
          <div style={{ fontSize: 34, letterSpacing: 2, textTransform: "uppercase" }}>
            График 1 3
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 62, lineHeight: 1.12, maxWidth: 1000 }}>
            Переработка при графике сутки через трое
          </div>
          <div style={{ fontSize: 28, color: "#a3a9b0", maxWidth: 900 }}>
            Норма по производственному календарю. Отпуск уменьшает норму, а не
            отработанные часы.
          </div>
        </div>

        {/* Три числа полосы итогов — то, ради чего сюда идут. */}
        <div style={{ display: "flex", gap: 24 }}>
          {[
            ["1972 ч", "Норма"],
            ["2192 ч", "Фактически"],
            ["220 ч", "Переработка"],
          ].map(([value, caption], index) => (
            <div
              key={caption}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                background: "#2a2c2f",
                borderRadius: 14,
                padding: "16px 24px",
              }}
            >
              <div style={{ fontSize: 40, color: index === 2 ? "#45a352" : "#e8eae6" }}>
                {value}
              </div>
              <div style={{ fontSize: 20, color: "#a3a9b0" }}>{caption}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
