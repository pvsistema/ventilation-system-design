/**
 * Страница скачивания презентаций СДС филиала «Копейский ВГСО».
 *
 * Файлы лежат статикой в public/files и отдаются напрямую, без бэкенда —
 * презентации не секретные, а лишняя серверная логика тут только мешала бы.
 * Оформление повторяет стиль самих презентаций: песочный фон, тёмно-синие
 * заголовки, Times New Roman — чтобы страница и вложения выглядели единым
 * комплектом.
 */
import Icon from "@/components/ui/icon";

interface Deck {
  file: string;
  title: string;
  subtitle: string;
  slides: number;
  size: string;
  points: string[];
}

const DECKS: Deck[] = [
  {
    file: "/files/Opyt-primeneniya-II.pptx",
    title: "Практический опыт применения искусственного интеллекта",
    subtitle:
      "Обзор разработанных программ, решение задач группы инженерного " +
      "обеспечения и проблемы, возникающие при решении инженерных задач",
    slides: 22,
    size: "11,0 МБ",
    points: [
      "Предпосылки и задачи группы инженерного обеспечения",
      "Три действующих сервиса: СДС/ГИО, САУ, АРМ дежурного",
      "Практические результаты и объективные ограничения ИИ",
      "Меры снижения рисков, выводы и предложения",
    ],
  },
  {
    file: "/files/Inzhenernye-raschety.pptx",
    title: "Обзор программных комплексов для инженерных расчётов",
    subtitle:
      "Расчёты, предусмотренные пунктом 26 Инструкции № 520 " +
      "(в ред. приказа от 20.02.2026 № 49)",
    slides: 20,
    size: "0,4 МБ",
    points: [
      "Нормативная база: пункт 26 и Приложение № 11",
      "«АэроСеть», «Вентиляция», «ПВ-Система», MineFrame, Ventsim",
      "Сравнительная таблица по критериям выбора",
      "Импортозамещение, выводы и рекомендации",
    ],
  },
];

export default function Presentations() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, #FBF3DC 0%, #F5E9C8 50%, #EFDFB4 100%)",
        fontFamily: '"Times New Roman", Times, serif',
        padding: "48px 20px",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Шапка */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#002060",
              lineHeight: 1.5,
            }}
          >
            Служба депрессионных съемок филиала «Копейский ВГСО»
            <br />
            ФГУП «Военизированная горноспасательная часть» МЧС России
          </div>
          <h1
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: "#002060",
              margin: "22px 0 10px",
              lineHeight: 1.25,
            }}
          >
            Презентации докладов
          </h1>
          <div style={{ fontSize: 14, color: "#4a4a4a" }}>
            Формат PowerPoint (.pptx) · 4:3 · Times New Roman
          </div>
        </div>

        {/* Карточки презентаций */}
        <div style={{ display: "grid", gap: 20 }}>
          {DECKS.map((d) => (
            <div
              key={d.file}
              style={{
                background: "rgba(255,251,240,0.92)",
                border: "1px solid #333399",
                borderRadius: 10,
                padding: "22px 26px",
                boxShadow: "0 2px 10px rgba(0,32,96,0.08)",
              }}
            >
              <h2
                style={{
                  fontSize: 21,
                  fontWeight: 700,
                  color: "#002060",
                  margin: "0 0 8px",
                  lineHeight: 1.3,
                }}
              >
                {d.title}
              </h2>
              <div
                style={{
                  fontSize: 14,
                  color: "#4a4a4a",
                  marginBottom: 14,
                  lineHeight: 1.45,
                }}
              >
                {d.subtitle}
              </div>

              <ul
                style={{
                  margin: "0 0 18px",
                  paddingLeft: 20,
                  fontSize: 14,
                  color: "#1a1a1a",
                  lineHeight: 1.7,
                }}
              >
                {d.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <a
                  href={d.file}
                  download
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#333399",
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    padding: "10px 22px",
                    borderRadius: 6,
                    textDecoration: "none",
                  }}
                >
                  <Icon name="Download" size={17} />
                  Скачать презентацию
                </a>
                <span style={{ fontSize: 13, color: "#5a5a5a" }}>
                  {d.slides} слайдов · {d.size}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 34,
            textAlign: "center",
            fontSize: 13,
            color: "#5a5a5a",
          }}
        >
          Докладчик: командир взвода службы депрессионных съемок
          филиала «Копейский ВГСО» ФГУП «ВГСЧ» Ипатов С. Г.
        </div>
      </div>
    </div>
  );
}
