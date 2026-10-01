// ─────────────────────────────────────────────────────────────────────────────
// FanChart — график характеристик вентилятора (Q-H или Q-N) в SVG.
// Используется в справочнике (миниатюра) и в окне увеличенного просмотра.
// ─────────────────────────────────────────────────────────────────────────────

import type { FanPt, FanIsoLine } from "@/lib/fanChartData";

export interface FanChartCurve { pts: FanPt[]; color: string; dash?: boolean; label?: string }
export interface FanChartPoint { q: number; h: number; color: string; label?: string }

interface Props {
  curves: FanChartCurve[];
  type: "qh" | "qp";
  operatingPoints?: FanChartPoint[];
  isolines?: FanIsoLine[];
  width?: number;
  height?: number;
  /** Подписывать кривые и точки (в увеличенном виде) */
  labels?: boolean;
}

/** «Красивый» шаг сетки: 1, 2, 2.5, 5 × 10ⁿ */
function niceStep(range: number, ticks: number): number {
  const raw = range / Math.max(1, ticks);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const k = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return k * p;
}

export default function FanChart({ curves, type, operatingPoints, isolines, width = 340, height = 190, labels = false }: Props) {
  const W = width, H = height;
  const big = W > 500;
  const fs = big ? 11 : 8;
  const PL = big ? 64 : 46, PR = big ? 24 : 12, PT = big ? 16 : 10, PB = big ? 44 : 30;
  const cw = W - PL - PR, ch = H - PT - PB;

  const val = (p: { h: number; p?: number }) => (type === "qh" ? p.h : (p.p ?? 0));
  const allPts = curves.flatMap(c => c.pts);
  if (allPts.length === 0) {
    return <svg width={W} height={H}><text x={W / 2} y={H / 2} textAnchor="middle" fontSize="11" style={{ fill: "var(--c-t4, #999)" }}>Нет данных</text></svg>;
  }

  const qs = [...allPts.map(p => p.q), ...(type === "qh" ? (operatingPoints ?? []).map(p => p.q) : [])];
  const vs = [...allPts.map(val), ...(type === "qh" ? (operatingPoints ?? []).map(p => p.h) : [])];
  const xStep = niceStep(Math.max(...qs) * 1.05 || 100, big ? 10 : 5);
  const maxQ = Math.ceil((Math.max(...qs) * 1.05 || 100) / xStep) * xStep;
  const yStep = niceStep(Math.max(...vs) * 1.1 || 1000, big ? 8 : 4);
  const maxV = Math.ceil((Math.max(...vs) * 1.1 || 1000) / yStep) * yStep;

  const toX = (q: number) => PL + (q / maxQ) * cw;
  const toY = (v: number) => PT + ch - (Math.max(0, v) / maxV) * ch;
  const fmtY = (v: number) => (!big && v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

  const xTicks = Math.round(maxQ / xStep), yTicks = Math.round(maxV / yStep);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg"
      style={{ fontFamily: "var(--font-num, sans-serif)", display: "block", background: big ? "#fff" : undefined }}>
      <defs>
        <clipPath id={`fc-clip-${W}-${H}-${type}`}><rect x={PL} y={PT} width={cw} height={ch} /></clipPath>
      </defs>
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const v = i * yStep, y = toY(v);
        return <g key={`y${i}`}>
          <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#e5e7eb" strokeWidth="0.7" />
          <text x={PL - 4} y={y + fs / 3} fontSize={fs} textAnchor="end" fill="#6b7280">{fmtY(v)}</text>
        </g>;
      })}
      {Array.from({ length: xTicks + 1 }).map((_, i) => {
        const v = i * xStep, x = toX(v);
        return <g key={`x${i}`}>
          <line x1={x} y1={PT} x2={x} y2={PT + ch} stroke="#e5e7eb" strokeWidth="0.7" />
          <text x={x} y={PT + ch + fs + 4} fontSize={fs} textAnchor="middle" fill="#6b7280">{+v.toFixed(1)}</text>
        </g>;
      })}
      <rect x={PL} y={PT} width={cw} height={ch} fill="none" stroke="#c9c5bc" strokeWidth="0.8" />

      <g clipPath={`url(#fc-clip-${W}-${H}-${type})`}>
        {/* Линии равного КПД */}
        {type === "qh" && isolines?.map((l, li) => {
          const d = l.pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.q).toFixed(1)},${toY(p.h).toFixed(1)}`).join(" ");
          return <path key={`iso${li}`} d={d} fill="none" stroke="#8a8f98" strokeWidth={big ? 1 : 0.8} strokeDasharray="5,3" />;
        })}
        {curves.map((c, ci) => {
          if (c.pts.length === 0) return null;
          const d = c.pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.q).toFixed(1)},${toY(val(p)).toFixed(1)}`).join(" ");
          return <path key={ci} d={d} fill="none" stroke={c.color} strokeWidth={c.dash ? 1.4 : big ? 2.4 : 2}
            strokeDasharray={c.dash ? "6,4" : undefined} strokeLinejoin="round" />;
        })}
      </g>

      {/* Подписи */}
      {labels && type === "qh" && isolines?.map((l, li) => {
        const p = l.pts[0];
        return <text key={`isol${li}`} x={toX(p.q) - 4} y={toY(p.h) - 4} fontSize={fs - 1} textAnchor="end" fill="#6b7280">η {l.label}</text>;
      })}
      {labels && curves.map((c, ci) => {
        if (!c.label || c.pts.length === 0) return null;
        const p = c.pts[0];
        return <text key={`cl${ci}`} x={toX(p.q) + 3} y={toY(val(p)) - 5} fontSize={fs} fontWeight={600} fill={c.color}>{c.label}</text>;
      })}

      {type === "qh" && operatingPoints?.map((op, i) => (
        <g key={`op${i}`}>
          {big && <>
            <line x1={toX(op.q)} y1={toY(op.h)} x2={toX(op.q)} y2={PT + ch} stroke={op.color} strokeWidth="0.8" strokeDasharray="3,3" />
            <line x1={PL} y1={toY(op.h)} x2={toX(op.q)} y2={toY(op.h)} stroke={op.color} strokeWidth="0.8" strokeDasharray="3,3" />
          </>}
          <circle cx={toX(op.q)} cy={toY(op.h)} r={big ? 6 : 4} fill={op.color} stroke="white" strokeWidth={1.5} />
          {labels && (
            <text x={toX(op.q) + 9} y={toY(op.h) - 8} fontSize={fs} fontWeight={600} fill="#1f2937"
              stroke="#fff" strokeWidth={3} paintOrder="stroke">
              {op.label ? `${op.label}: ` : ""}Q={op.q.toFixed(2)}, H={Math.round(op.h)}
            </text>
          )}
        </g>
      ))}

      <text x={PL + cw / 2} y={H - (big ? 6 : 1)} fontSize={fs} textAnchor="middle" fill="#4b5563">Расход Q, м³/с</text>
      <text transform={`translate(${big ? 14 : 9},${PT + ch / 2}) rotate(-90)`} fontSize={fs} textAnchor="middle" fill="#4b5563">
        {type === "qh" ? "Напор H, Па" : "Мощность N, кВт"}
      </text>
    </svg>
  );
}
