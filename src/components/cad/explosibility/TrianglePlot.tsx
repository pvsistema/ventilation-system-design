// ─────────────────────────────────────────────────────────────────────────────
// TrianglePlot — треугольник взрываемости рудничной атмосферы в осях
// (C_г, % — O₂, %). Повторяет рисунки 1–6 Приложения № 11 к ФНП № 520:
// рисунок выбирается по доле оксида углерода P_CO, а семейство треугольников
// внутри рисунка — по доле метана P_CH4.
//
// На поле наносится точка пробы (C_г; O₂) — то самое «нанесение точки»,
// которое норма предписывает выполнять карандашом по бумаге.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from "react";
import {
  buildTriangle, O2_FRESH,
  type ExplosibilityResult, type TriPoint,
} from "@/lib/explosibility";

interface Props {
  result: ExplosibilityResult;
  /** Доли метана, для которых рисуется семейство треугольников */
  family?: number[];
  /** Показывать линию разбавления свежим воздухом */
  showDilution?: boolean;
  width?: number;
  height?: number;
}

/** Доли P_CH4 семейства — как на рисунках приложения. */
const DEFAULT_FAMILY = [0, 0.25, 0.5, 0.75, 1];

const PAD = { l: 52, r: 16, t: 18, b: 40 };

export default function TrianglePlot({
  result, family = DEFAULT_FAMILY, showDilution = true,
  width = 560, height = 420,
}: Props) {
  // Область осей: по горючим — с запасом до фактической точки, по кислороду 0…21
  // Запас +5 % по оси: иначе вершина ВПВ упирается в рамку и её подпись обрезается
  const xMax = useMemo(() => {
    const need = Math.max(result.cg, result.triangle.uel || 0, 20) + 5;
    return Math.ceil(need / 5) * 5;
  }, [result]);
  const yMax = 22;

  const W = width - PAD.l - PAD.r;
  const H = height - PAD.t - PAD.b;
  const sx = (x: number) => PAD.l + (x / xMax) * W;
  const sy = (y: number) => PAD.t + H - (y / yMax) * H;
  const pt = (p: TriPoint) => `${sx(p.x)},${sy(p.y)}`;

  // Семейство треугольников при выбранном P_CO — «как на рисунке приложения»
  const familyTris = useMemo(
    () => family.map(pCH4 => ({ pCH4, tri: buildTriangle(result.figurePCO, Math.min(pCH4, 1 - result.figurePCO)) })),
    [family, result.figurePCO],
  );

  const active = result.triangle;
  const xTicks = Array.from({ length: xMax / 5 + 1 }, (_, i) => i * 5);
  const yTicks = [0, 5, 10, 15, 20];

  const pointColor =
    result.state === "explosive" ? "#dc2626"
      : result.state === "explosive-on-dilution" ? "#d97706"
        : "#16a34a";

  return (
    <svg width={width} height={height} style={{ background: "#fff", display: "block" }}>
      {/* Сетка */}
      {xTicks.map(v => (
        <line key={`gx${v}`} x1={sx(v)} y1={PAD.t} x2={sx(v)} y2={PAD.t + H}
          stroke="#eceff5" strokeWidth={1} />
      ))}
      {yTicks.map(v => (
        <line key={`gy${v}`} x1={PAD.l} y1={sy(v)} x2={PAD.l + W} y2={sy(v)}
          stroke="#eceff5" strokeWidth={1} />
      ))}

      {/* Линия свежего воздуха: O₂ = 20,9·(1 − C_г/100) */}
      <line x1={sx(0)} y1={sy(O2_FRESH)} x2={sx(xMax)} y2={sy(O2_FRESH * (1 - xMax / 100))}
        stroke="#94a3b8" strokeWidth={1} strokeDasharray="5 3" />
      {/* Подпись ставится в начале линии: у правого края она налезала на
          вершину ВПВ треугольника. */}
      <text x={sx(xMax * 0.06)} y={sy(O2_FRESH * (1 - xMax * 0.06 / 100)) - 6}
        fontSize={9} fill="#64748b">
        линия свежего воздуха
      </text>

      {/* Семейство треугольников выбранного рисунка — тонкими линиями */}
      {familyTris.map(({ pCH4, tri }) => (
        <polygon key={`f${pCH4}`}
          points={`${pt(tri.low)} ${pt(tri.high)} ${pt(tri.nose)}`}
          fill="none" stroke="#c7d2e4" strokeWidth={1} />
      ))}

      {/* Активный треугольник — по фактическим долям пробы */}
      <polygon points={`${pt(active.low)} ${pt(active.high)} ${pt(active.nose)}`}
        fill="rgba(220,38,38,0.10)" stroke="#dc2626" strokeWidth={1.8} />

      {/* Подписи вершин активного треугольника */}
      <text x={sx(active.low.x)} y={sy(active.low.y) - 7} fontSize={9} fill="#b91c1c" textAnchor="middle">
        НПВ {active.lel.toFixed(1)}
      </text>
      <text x={sx(active.high.x) + 5} y={sy(active.high.y) - 6} fontSize={9} fill="#b91c1c">
        ВПВ {active.uel.toFixed(1)}
      </text>
      <text x={sx(active.nose.x) + 6} y={sy(active.nose.y) + 11} fontSize={9} fill="#b91c1c">
        O₂ пред. {active.nose.y.toFixed(1)} %
      </text>

      {/* Линия разбавления свежим воздухом — путь точки при подсосе */}
      {showDilution && result.cg > 0 && (
        <line x1={sx(result.point.x)} y1={sy(result.point.y)} x2={sx(0)} y2={sy(O2_FRESH)}
          stroke={result.state === "explosive-on-dilution" ? "#d97706" : "#cbd5e1"}
          strokeWidth={1.2} strokeDasharray="3 3" />
      )}

      {/* Точка пробы (C_г; O₂) */}
      {result.cg >= 0 && (
        <g>
          <circle cx={sx(result.point.x)} cy={sy(result.point.y)} r={5.5}
            fill={pointColor} stroke="#fff" strokeWidth={1.5} />
          <text x={sx(result.point.x) + 9} y={sy(result.point.y) - 7}
            fontSize={10} fontWeight={600} fill={pointColor}>
            ({result.cg.toFixed(2)}; {result.sample.o2.toFixed(2)})
          </text>
        </g>
      )}

      {/* Оси */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + H} stroke="#64748b" strokeWidth={1.2} />
      <line x1={PAD.l} y1={PAD.t + H} x2={PAD.l + W} y2={PAD.t + H} stroke="#64748b" strokeWidth={1.2} />

      {xTicks.map(v => (
        <text key={`tx${v}`} x={sx(v)} y={PAD.t + H + 14} fontSize={9} fill="#475569" textAnchor="middle">{v}</text>
      ))}
      {yTicks.map(v => (
        <text key={`ty${v}`} x={PAD.l - 6} y={sy(v) + 3} fontSize={9} fill="#475569" textAnchor="end">{v}</text>
      ))}

      <text x={PAD.l + W / 2} y={height - 8} fontSize={10} fill="#334155" textAnchor="middle">
        Содержание горючих газов C_г, %
      </text>
      <text x={13} y={PAD.t + H / 2} fontSize={10} fill="#334155" textAnchor="middle"
        transform={`rotate(-90 13 ${PAD.t + H / 2})`}>
        Содержание кислорода O₂, %
      </text>

      {/* Заголовок рисунка */}
      <text x={PAD.l + 6} y={PAD.t + 10} fontSize={10} fill="#1e3a8a" fontWeight={600}>
        Рис. {result.figureNo} приложения · P_CO = {result.figurePCO.toFixed(1).replace(".", ",")}
      </text>
    </svg>
  );
}