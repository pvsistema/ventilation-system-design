// ─────────────────────────────────────────────────────────────────────────────
// Диаграмма нагружения перемычки ударной волной (как у расчёта пожара,
// ориентир — «Вентиляция 2.0»): давление на перемычке во времени и ползунок.
//
// КАК СТРОИТСЯ КРИВАЯ. Расчёт взрыва даёт для каждой перемычки давление во
// фронте ΔP, путь волны от очага d и время действия волны θ. По ним:
//   • время прихода фронта t₀ = d / D, где D — скорость фронта (по ΔP);
//   • форма импульса — треугольная (по методике i = ΔP·θ/2): скачок до ΔP
//     в момент t₀ и линейный спад до нуля к моменту t₀ + θ.
// На перемычку действует давление ОТРАЖЕНИЯ (поперёк хода волны), оно
// показывается второй кривой; разрушение — по давлению во фронте, как в
// расчёте (табл. 8 методики ВГСЧ). Момент разрушения — первый момент, когда
// давление во фронте достигло прочности перемычки.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Area,
} from "recharts";
import Icon from "@/components/ui/icon";
import type { TopoBranch } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { barrierDisplayName, type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";
import { reflectedPressure } from "@/lib/blastBulkhead";
import { waveFrontSpeed, type ExplosionResult } from "@/lib/explosionCalculator";

interface Props {
  branches: TopoBranch[];
  symbols: SchemaSymbol[];
  barriers: Map<string, BlastBarrier[]>;
  hits: Map<string, BarrierHit>;
  resultByBranch: Map<string, ExplosionResult>;
  /** Выделить перемычку на схеме. */
  onFocusBranch?: (branchId: string) => void;
  onClose: () => void;
}

type Row = {
  bar: BlastBarrier; hit: BarrierHit; name: string;
  d: number; t0_ms: number; theta_ms: number; fp_kPa: number;
};

/** Давление во фронте в момент t, кПа (треугольный импульс). */
function pAt(t: number, r: Row): number {
  if (t < r.t0_ms) return 0;
  const k = 1 - (t - r.t0_ms) / r.theta_ms;
  return k > 0 ? r.hit.incident_kPa * k : 0;
}

function useDraggable() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select")) return;
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { sx: e.clientX, sy: e.clientY, px: r.left, py: r.top };
    e.preventDefault();
  }, []);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const w = boxRef.current?.offsetWidth ?? 400;
      setPos({
        x: Math.min(Math.max(d.px + e.clientX - d.sx, 40 - w), window.innerWidth - 40),
        y: Math.min(Math.max(d.py + e.clientY - d.sy, 0), window.innerHeight - 40),
      });
    };
    const up = () => { drag.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);
  return { pos, onMouseDown, boxRef };
}

export default function BlastBarrierChartDialog(p: Props) {
  const brById = useMemo(() => new Map(p.branches.map(b => [b.id, b])), [p.branches]);
  const symById = useMemo(() => new Map(p.symbols.map(s => [s.id, s])), [p.symbols]);

  // Перемычки, до которых дошла волна, — по времени прихода фронта
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const list of p.barriers.values()) for (const bar of list) {
      const hit = p.hits.get(bar.key);
      if (!hit || !(hit.incident_kPa > 0)) continue;
      const res = hit.srcId ? p.resultByBranch.get(hit.srcId) : [...p.resultByBranch.values()][0];
      const d = hit.d_m ?? 0;
      // Средняя скорость фронта на пути: от давления у очага до давления у перемычки
      const D0 = waveFrontSpeed(res?.vgsch?.dPn_kPa ?? res?.maxDeltaP_kPa ?? hit.incident_kPa);
      const D1 = waveFrontSpeed(hit.incident_kPa);
      const t0 = d > 0 ? (d / ((D0 + D1) / 2)) * 1000 : 0;
      const theta = Math.max(res?.phaseDuration_ms ?? 50, 1);
      out.push({
        bar, hit, d, t0_ms: t0, theta_ms: theta, fp_kPa: bar.failure_MPa * 1000,
        name: barrierDisplayName(symById.get(bar.key), brById.get(bar.branchId), bar.branchId),
      });
    }
    return out.sort((a, b) => a.t0_ms - b.t0_ms);
  }, [p.barriers, p.hits, p.resultByBranch, symById, brById]);

  const [key, setKey] = useState(rows.find(r => r.hit.destroyed)?.bar.key ?? rows[0]?.bar.key ?? "");
  const row = rows.find(r => r.bar.key === key) ?? rows[0];

  // Окно времени — вокруг прихода волны к ЭТОЙ перемычке: до прихода график
  // пустой, поэтому ось начинается чуть раньше фронта, а не с нуля.
  const tMin = row ? Math.max(0, Math.floor((row.t0_ms - row.theta_ms * 0.4) / 5) * 5) : 0;
  const tMax = row ? Math.ceil((row.t0_ms + row.theta_ms * 1.3) / 5) * 5 : 100;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setT(tMin); setPlaying(false); }, [key, tMin]);
  useEffect(() => {
    if (!playing) return;
    const step = (tMax - tMin) / 150;
    const id = setInterval(() => setT(prev => {
      const n = prev + step;
      if (n >= tMax) { setPlaying(false); return tMax; }
      return n;
    }), 40);
    return () => clearInterval(id);
  }, [playing, tMax]);

  const data = useMemo(() => {
    if (!row) return [];
    const N = 240;
    return Array.from({ length: N + 1 }, (_, i) => {
      const tt = tMin + ((tMax - tMin) * i) / N;
      const pf = pAt(tt, row);
      return { t: +tt.toFixed(2), front: +pf.toFixed(2), refl: +reflectedPressure(pf).toFixed(2) };
    });
  }, [row, tMin, tMax]);

  // Момент разрушения: первое достижение прочности давлением во фронте
  const tBreak = row && row.hit.destroyed ? row.t0_ms : null;
  const pNow = row ? pAt(t, row) : 0;
  const reflNow = reflectedPressure(pNow);
  const state = !row ? "" : tBreak != null && t >= tBreak ? "destroyed"
    : t >= row.t0_ms && t <= row.t0_ms + row.theta_ms ? "loaded" : t < row.t0_ms ? "waiting" : "held";

  const { pos, onMouseDown, boxRef } = useDraggable();
  const muted = "var(--c-t3, #6b7280)";

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none"
      style={pos ? undefined : { display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div ref={boxRef} className="rounded-xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
        style={{
          width: 900, maxWidth: "96vw", maxHeight: "92vh", background: "var(--c-s1, #fff)", border: "1.5px solid var(--c-b2, #d1d5db)",
          ...(pos ? { position: "fixed", left: pos.x, top: pos.y } : {}),
        }}
        onKeyDown={e => { if (e.key === "Escape") p.onClose(); }}>

        <div onMouseDown={onMouseDown} className="flex items-center gap-3 px-5 pt-4 pb-3 select-none"
          style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)", cursor: "move" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fde68a" }}>
            <Icon name="Activity" size={19} style={{ color: "var(--c-amber, #a66b0d)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold" style={{ color: "var(--c-t1, #111827)" }}>Нагружение перемычки ударной волной</div>
            <div className="text-[11px] mt-0.5" style={{ color: muted }}>
              Давление на перемычке во времени · разрушение при ΔP во фронте ≥ давления разрушения (табл. 8 методики ВГСЧ)
            </div>
          </div>
          <button onClick={p.onClose} className="rounded p-1 hover:bg-black/5" style={{ color: "var(--c-t4, #9ca3af)" }}>
            <Icon name="X" size={18} />
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-8 text-[12px] text-center" style={{ color: muted }}>
            Волна не дошла ни до одной перемычки. Выполните «Расчёт взрыва».
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Список перемычек */}
            <div className="overflow-y-auto shrink-0" style={{ width: 290, borderRight: "1px solid var(--c-b1, #e5e7eb)", background: "var(--c-s2, #f9fafb)" }}>
              <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: muted }}>
                Перемычки по времени прихода волны ({rows.length})
              </div>
              {rows.map(r => {
                const on = r.bar.key === row?.bar.key;
                return (
                  <button key={r.bar.key} type="button" onClick={() => { setKey(r.bar.key); p.onFocusBranch?.(r.bar.branchId); }}
                    className="w-full text-left px-3 py-1.5"
                    style={{
                      background: on ? "var(--c-tint-blue, #eef5f8)" : "transparent",
                      borderLeft: `3px solid ${on ? "var(--c-accent, #1e5a7a)" : "transparent"}`,
                      borderBottom: "1px solid var(--c-b1, #e5e7eb)",
                    }}>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.hit.destroyed ? "#dc2626" : "#16a34a" }} />
                      <span className="text-[11.5px] truncate flex-1" style={{ color: "var(--c-t1, #111827)", fontWeight: on ? 600 : 400 }} title={r.name}>{r.name}</span>
                    </div>
                    <div className="text-[10px] pl-3.5 tabular-nums" style={{ color: muted }}>
                      t = {r.t0_ms.toFixed(1)} мс · {r.d.toFixed(0)} м · ΔP {(r.hit.incident_kPa / 1000).toFixed(3)} / {(r.fp_kPa / 1000).toFixed(3)} МПа
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Диаграмма */}
            {row && (
              <div className="flex-1 min-w-0 flex flex-col px-4 py-3 gap-2">
                <div className="grid grid-cols-4 gap-2 text-[11px]">
                  {[
                    ["Путь волны", `${row.d.toFixed(0)} м`],
                    ["Приход фронта", `${row.t0_ms.toFixed(1)} мс`],
                    ["Время действия θ", `${row.theta_ms.toFixed(1)} мс`],
                    ["Прочность P_разр", `${(row.fp_kPa / 1000).toFixed(3)} МПа`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-md px-2 py-1" style={{ background: "var(--c-s2, #f9fafb)", border: "1px solid var(--c-b1, #e5e7eb)" }}>
                      <div style={{ color: muted }}>{k}</div>
                      <div className="font-semibold tabular-nums" style={{ color: "var(--c-t1, #111827)" }}>{v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ height: 290 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 18, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="t" type="number" domain={[tMin, tMax]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(0)}
                        label={{ value: "Время от взрыва, мс", position: "insideBottom", offset: -8, fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} width={52}
                        label={{ value: "ΔP, кПа", angle: -90, position: "insideLeft", fontSize: 10 }} />
                      <Tooltip formatter={(v: number, n: string) => [`${v.toFixed(1)} кПа`, n === "front" ? "Во фронте" : "Отражения"]}
                        labelFormatter={(l: number) => `t = ${Number(l).toFixed(1)} мс`} contentStyle={{ fontSize: 11 }} />
                      <Area type="linear" dataKey="front" stroke="none" fill="#f59e0b" fillOpacity={0.15} isAnimationActive={false} />
                      <Line type="linear" dataKey="front" name="front" stroke="#d97706" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="linear" dataKey="refl" name="refl" stroke="#7c3aed" strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                      <ReferenceLine y={row.fp_kPa} stroke="#dc2626" strokeDasharray="6 3"
                        label={{ value: `P_разр = ${row.fp_kPa.toFixed(0)} кПа`, position: "insideTopRight", fontSize: 10, fill: "#dc2626" }} />
                      {tBreak != null && (
                        <ReferenceLine x={tBreak} stroke="#dc2626"
                          label={{ value: "разрушение", position: "insideTopLeft", fontSize: 10, fill: "#dc2626" }} />
                      )}
                      <ReferenceLine x={t} stroke="#1e5a7a" strokeWidth={2} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex items-center gap-4 text-[10.5px] whitespace-nowrap flex-wrap" style={{ color: muted }}>
                  <span className="flex items-center gap-1"><span style={{ width: 16, height: 2, background: "#d97706", display: "inline-block" }} /> во фронте (по нему — разрушение)</span>
                  <span className="flex items-center gap-1"><span style={{ width: 16, height: 0, borderTop: "2px dashed #7c3aed", display: "inline-block" }} /> отражения (справочно, для толщины)</span>
                  <span className="flex items-center gap-1"><span style={{ width: 16, height: 0, borderTop: "2px dashed #dc2626", display: "inline-block" }} /> прочность перемычки</span>
                </div>

                {/* Ползунок времени */}
                <div className="flex items-center gap-2 rounded-md px-2 py-2" style={{ background: "var(--c-s2, #f9fafb)", border: "1px solid var(--c-b1, #e5e7eb)" }}>
                  <button type="button" onClick={() => { if (t >= tMax) setT(tMin); setPlaying(v => !v); }}
                    className="px-2 py-1 rounded text-[11px] font-semibold text-white flex items-center gap-1"
                    style={{ background: "var(--c-amber-bg, #c98a0c)" }}>
                    <Icon name={playing ? "Pause" : "Play"} size={12} />{playing ? "Пауза" : "Пуск"}
                  </button>
                  <button type="button" onClick={() => { setPlaying(false); setT(tMin); }} className="px-1.5 py-1 rounded hover:bg-black/5" style={{ color: muted }}>
                    <Icon name="SkipBack" size={13} />
                  </button>
                  <input type="range" min={tMin} max={tMax} step={(tMax - tMin) / 500} value={t}
                    onChange={e => { setPlaying(false); setT(Number(e.target.value)); }}
                    className="flex-1" style={{ accentColor: "#1e5a7a" }} />
                  <span className="text-[12px] font-bold tabular-nums px-2 py-0.5 rounded" style={{ background: "#1e5a7a", color: "#fff", minWidth: 82, textAlign: "center" }}>
                    t = {t.toFixed(1)} мс
                  </span>
                </div>

                {/* Состояние в текущий момент */}
                <div className="flex items-center gap-3 rounded-md px-3 py-2 text-[12px]" style={{
                  background: state === "destroyed" ? "var(--c-tint-red, #fef2f2)" : state === "loaded" || state === "held" ? "var(--c-tint-green, #f0fdf4)" : "var(--c-s2, #f9fafb)",
                  border: `1px solid ${state === "destroyed" ? "#fca5a5" : state === "waiting" ? "var(--c-b1, #e5e7eb)" : "#86efac"}`,
                }}>
                  <Icon name={state === "destroyed" ? "OctagonX" : state === "waiting" ? "Clock" : "ShieldCheck"} size={16}
                    style={{ color: state === "destroyed" ? "#dc2626" : state === "waiting" ? muted : "#16a34a" }} />
                  <div className="flex-1">
                    <b>{state === "destroyed" ? `Перемычка разрушена на ${tBreak!.toFixed(1)} мс`
                      : state === "waiting" ? `Волна ещё не дошла (придёт через ${(row.t0_ms - t).toFixed(1)} мс)`
                      : state === "loaded" ? "Перемычка под нагрузкой — держит"
                      : "Волна прошла — перемычка устояла"}</b>
                    <div className="text-[11px] tabular-nums" style={{ color: muted }}>
                      ΔP во фронте = {pNow.toFixed(1)} кПа · ΔP отражения = {reflNow.toFixed(1)} кПа · запас {pNow > 0 ? (row.fp_kPa / pNow).toFixed(2) : "—"}
                    </div>
                  </div>
                  <div className="text-right text-[11px]" style={{ color: muted }}>
                    итог:<br />
                    <b style={{ color: row.hit.destroyed ? "#dc2626" : "#16a34a" }}>
                      {row.hit.destroyed ? `разрушена, прошло ${Math.round(row.hit.transmit * 100)} %` : "устояла"}
                    </b>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
