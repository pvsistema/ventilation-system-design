// ─────────────────────────────────────────────────────────────────────────────
// Диаграмма нагружения перемычки ударной волной (как у расчёта пожара,
// ориентир — «Вентиляция 2.0»): давление на перемычке во времени и ползунок.
//
// КАК ЧИТАЕТСЯ. Время — ОБЩЕЕ для всех перемычек (от момента взрыва). Для
// выбранной перемычки показано три вещи:
//   1) где сейчас фронт волны относительно неё (полоса «очаг → перемычка»);
//   2) нагрузка в ПРОЦЕНТАХ ОТ ПРОЧНОСТИ — линия 100 % видна всегда, даже
//      когда давление в сотни раз меньше прочности или больше неё;
//   3) состояние простыми словами: ждёт / под нагрузкой / разрушена / устояла.
// В списке слева то же состояние у всех перемычек на текущий момент.
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
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, Area,
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

type Status = { kind: "waiting" | "loading" | "destroyed" | "held"; pct: number; remain_m: number };

/** Состояние перемычки в момент t. */
function statusAt(t: number, r: Row): Status {
  const pct = r.fp_kPa > 0 ? (pAt(t, r) / r.fp_kPa) * 100 : 0;
  if (t < r.t0_ms) return { kind: "waiting", pct: 0, remain_m: r.t0_ms > 0 ? r.d * (1 - t / r.t0_ms) : 0 };
  if (r.hit.destroyed) return { kind: "destroyed", pct, remain_m: 0 };
  if (t <= r.t0_ms + r.theta_ms) return { kind: "loading", pct, remain_m: 0 };
  return { kind: "held", pct: 0, remain_m: 0 };
}

const STATUS_STYLE: Record<Status["kind"], { color: string; bg: string; border: string; icon: string }> = {
  waiting:   { color: "#6b7280", bg: "var(--c-s2, #f9fafb)",        border: "var(--c-b1, #e5e7eb)", icon: "Clock" },
  loading:   { color: "#b45309", bg: "var(--c-tint-amber, #fffbeb)", border: "#fcd34d",              icon: "Activity" },
  destroyed: { color: "#dc2626", bg: "var(--c-tint-red, #fef2f2)",   border: "#fca5a5",              icon: "OctagonX" },
  held:      { color: "#16a34a", bg: "var(--c-tint-green, #f0fdf4)", border: "#86efac",              icon: "ShieldCheck" },
};

const fmtMs = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)} с` : `${ms.toFixed(0)} мс`;
const fmtPct = (v: number) => v >= 1000 ? `${Math.round(v / 100) / 10}×10³ %` : v >= 10 ? `${v.toFixed(0)} %` : `${v.toFixed(1)} %`;

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

  // Общая шкала времени — от взрыва до ухода волны с последней перемычки
  const tEnd = rows.length ? Math.ceil(Math.max(...rows.map(r => r.t0_ms + r.theta_ms)) * 1.05) : 100;
  // Окно графика — вокруг прихода волны к выбранной перемычке
  const tMin = row ? Math.max(0, row.t0_ms - row.theta_ms * 0.5) : 0;
  const tMax = row ? row.t0_ms + row.theta_ms * 1.4 : 100;

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Анимация: до прихода волны — быстро, во время нагрузки — медленно,
  // иначе 70 мс удара проскакивают за пару кадров из 3 секунд.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT(prev => {
      const step = !row ? tEnd / 150
        : prev < tMin ? Math.max(tMin / 60, 0.5)
        : prev < tMax ? (tMax - tMin) / 160
        : tEnd / 120;
      const n = prev + step;
      if (n >= tEnd) { setPlaying(false); return tEnd; }
      return n;
    }), 40);
    return () => clearInterval(id);
  }, [playing, tEnd, tMin, tMax, row]);

  const selectRow = (r: Row) => {
    setKey(r.bar.key);
    p.onFocusBranch?.(r.bar.branchId);
    setPlaying(false);
    setT(Math.max(0, r.t0_ms - r.theta_ms * 0.3));
  };

  const peakPct = row && row.fp_kPa > 0 ? (row.hit.incident_kPa / row.fp_kPa) * 100 : 0;
  // Шкала ограничена 300 %: иначе при нагрузке в десятки раз выше прочности
  // линия 100 % сливается с осью и главное — «выше/ниже прочности» — не видно.
  const Y_CAP = 300;
  const yMax = Math.min(Y_CAP, Math.max(130, Math.ceil(peakPct * 1.15 / 10) * 10));
  const clipped = peakPct > yMax;

  const data = useMemo(() => {
    if (!row) return [];
    const N = 240;
    return Array.from({ length: N + 1 }, (_, i) => {
      const tt = tMin + ((tMax - tMin) * i) / N;
      const pct = row.fp_kPa > 0 ? (pAt(tt, row) / row.fp_kPa) * 100 : 0;
      return { t: +tt.toFixed(2), pct: +Math.min(pct, yMax).toFixed(3), real: +pct.toFixed(3) };
    });
  }, [row, tMin, tMax, yMax]);

  const st = row ? statusAt(t, row) : null;
  const pNow = row ? pAt(t, row) : 0;
  const destroyedCount = rows.filter(r => r.hit.destroyed && t >= r.t0_ms).length;
  const heldCount = rows.filter(r => !r.hit.destroyed && t > r.t0_ms + r.theta_ms).length;
  const loadingCount = rows.filter(r => statusAt(t, r).kind === "loading").length;

  const { pos, onMouseDown, boxRef } = useDraggable();
  const muted = "var(--c-t3, #6b7280)";
  const ink = "var(--c-t1, #111827)";

  // Фраза-итог по выбранной перемычке
  const summary = row ? (() => {
    const ratio = row.hit.incident_kPa / row.fp_kPa;
    const pMPa = (row.hit.incident_kPa / 1000).toFixed(3);
    const fMPa = (row.fp_kPa / 1000).toFixed(3);
    if (row.hit.destroyed) {
      return `Волна дошла через ${fmtMs(row.t0_ms)} с давлением ${pMPa} МПа — в ${ratio.toFixed(ratio >= 10 ? 0 : 1)} раза больше прочности (${fMPa} МПа). Перемычка разрушена в момент прихода фронта, за неё прошло ${Math.round(row.hit.transmit * 100)} % волны.`;
    }
    return `Волна дошла через ${fmtMs(row.t0_ms)} с давлением ${pMPa} МПа — это ${fmtPct(ratio * 100)} от прочности (${fMPa} МПа). Перемычка устояла${ratio > 0 ? ` с запасом ×${(1 / ratio).toFixed(1 / ratio >= 10 ? 0 : 1)}` : ""} и остановила волну.`;
  })() : "";

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none"
      style={pos ? undefined : { display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div ref={boxRef} className="rounded-xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
        style={{
          width: 1000, maxWidth: "96vw", maxHeight: "94vh", background: "var(--c-s1, #fff)", border: "1.5px solid var(--c-b2, #d1d5db)",
          ...(pos ? { position: "fixed", left: pos.x, top: pos.y } : {}),
        }}
        onKeyDown={e => { if (e.key === "Escape") p.onClose(); }}>

        {/* Шапка */}
        <div onMouseDown={onMouseDown} className="flex items-center gap-3 px-5 pt-4 pb-3 select-none"
          style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)", cursor: "move" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fde68a" }}>
            <Icon name="Activity" size={19} style={{ color: "var(--c-amber, #a66b0d)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold" style={{ color: ink }}>Как ударная волна доходит до перемычек</div>
            <div className="text-[11px] mt-0.5" style={{ color: muted }}>
              Нагрузка = давление во фронте волны ÷ прочность перемычки. 100 % и больше — перемычка разрушается (табл. 8 методики ВГСЧ)
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
        ) : (<>
          {/* Общее время */}
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)", background: "var(--c-s2, #f9fafb)" }}>
            <button type="button" onClick={() => { if (t >= tEnd) setT(0); setPlaying(v => !v); }}
              className="px-3 py-1 rounded text-[12px] font-semibold text-white flex items-center gap-1"
              style={{ background: "var(--c-amber-bg, #c98a0c)" }}>
              <Icon name={playing ? "Pause" : "Play"} size={13} />{playing ? "Пауза" : "Пуск"}
            </button>
            <button type="button" title="К моменту взрыва" onClick={() => { setPlaying(false); setT(0); }}
              className="px-1.5 py-1 rounded hover:bg-black/5" style={{ color: muted }}>
              <Icon name="SkipBack" size={14} />
            </button>
            <div className="relative flex-1">
              {/* Отметки прихода волны к каждой перемычке */}
              <div className="absolute left-0 right-0 pointer-events-none" style={{ top: -2, height: 6 }}>
                {rows.map(r => (
                  <span key={r.bar.key} title={r.name} style={{
                    position: "absolute", left: `${(r.t0_ms / tEnd) * 100}%`, width: 2, height: 6,
                    background: r.hit.destroyed ? "#dc2626" : "#16a34a", opacity: r.bar.key === row?.bar.key ? 1 : 0.55,
                    transform: "translateX(-1px)",
                  }} />
                ))}
              </div>
              <input type="range" min={0} max={tEnd} step={tEnd / 1000} value={t}
                onChange={e => { setPlaying(false); setT(Number(e.target.value)); }}
                className="w-full" style={{ accentColor: "#1e5a7a" }} />
            </div>
            <span className="text-[12px] font-bold tabular-nums px-2 py-0.5 rounded" style={{ background: "#1e5a7a", color: "#fff", minWidth: 110, textAlign: "center" }}>
              {fmtMs(t)} от взрыва
            </span>
            <div className="text-[11px] tabular-nums whitespace-nowrap pl-1" style={{ color: muted }}>
              <span style={{ color: "#dc2626" }}>● разрушено {destroyedCount}</span>{" · "}
              <span style={{ color: "#b45309" }}>● под нагрузкой {loadingCount}</span>{" · "}
              <span style={{ color: "#16a34a" }}>● устояло {heldCount}</span>
            </div>
          </div>

          <div className="flex flex-1 min-h-0">
            {/* Список перемычек с состоянием на текущий момент */}
            <div className="overflow-y-auto shrink-0" style={{ width: 300, borderRight: "1px solid var(--c-b1, #e5e7eb)", background: "var(--c-s2, #f9fafb)" }}>
              <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: muted }}>
                Перемычки по порядку прихода волны ({rows.length})
              </div>
              {rows.map(r => {
                const on = r.bar.key === row?.bar.key;
                const s = statusAt(t, r);
                const ss = STATUS_STYLE[s.kind];
                const peak = r.fp_kPa > 0 ? (r.hit.incident_kPa / r.fp_kPa) * 100 : 0;
                return (
                  <button key={r.bar.key} type="button" onClick={() => selectRow(r)}
                    className="w-full text-left px-3 py-1.5"
                    style={{
                      background: on ? "var(--c-tint-blue, #eef5f8)" : "transparent",
                      borderLeft: `3px solid ${on ? "var(--c-accent, #1e5a7a)" : "transparent"}`,
                      borderBottom: "1px solid var(--c-b1, #e5e7eb)",
                    }}>
                    <div className="flex items-center gap-1.5">
                      <Icon name={ss.icon} size={12} style={{ color: ss.color, flexShrink: 0 }} />
                      <span className="text-[11.5px] truncate flex-1" style={{ color: ink, fontWeight: on ? 600 : 400 }} title={r.name}>{r.name}</span>
                    </div>
                    <div className="pl-[18px] mt-0.5">
                      {/* Итоговая нагрузка: полоса до 100 % и выход за неё */}
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--c-b1, #e5e7eb)" }}>
                        <div style={{ width: `${Math.min(100, peak)}%`, height: "100%", background: r.hit.destroyed ? "#dc2626" : "#16a34a" }} />
                      </div>
                      <div className="text-[10px] tabular-nums mt-0.5 flex justify-between" style={{ color: muted }}>
                        <span>{fmtMs(r.t0_ms)} · {r.d.toFixed(0)} м</span>
                        <span style={{ color: s.kind === "waiting" ? muted : ss.color, fontWeight: 600 }}>
                          {s.kind === "waiting" ? `ждёт · итог ${fmtPct(peak)}`
                            : s.kind === "loading" ? `нагрузка ${fmtPct(s.pct)}`
                            : s.kind === "destroyed" ? `разрушена · ${fmtPct(peak)}`
                            : `устояла · ${fmtPct(peak)}`}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Выбранная перемычка */}
            {row && st && (
              <div className="flex-1 min-w-0 flex flex-col px-4 py-3 gap-2.5 overflow-y-auto">
                <div className="text-[13px] font-semibold truncate" style={{ color: ink }} title={row.name}>{row.name}</div>

                {/* 1. Где сейчас волна */}
                <div className="rounded-md px-3 py-2" style={{ border: "1px solid var(--c-b1, #e5e7eb)" }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: muted }}>1. Путь волны к перемычке</div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="flex items-center gap-1 shrink-0" style={{ color: "#dc2626" }}><Icon name="Flame" size={13} />очаг</span>
                    <div className="relative flex-1 h-3 rounded-full" style={{ background: "var(--c-b1, #e5e7eb)" }}>
                      <div className="absolute left-0 top-0 h-full rounded-full" style={{
                        width: `${Math.min(100, row.t0_ms > 0 ? (t / row.t0_ms) * 100 : 100)}%`,
                        background: "linear-gradient(90deg, #dc2626, #f59e0b)",
                      }} />
                      <span className="absolute top-1/2 -translate-y-1/2 text-[9px] font-bold text-white px-1 rounded" style={{
                        left: `calc(${Math.min(100, row.t0_ms > 0 ? (t / row.t0_ms) * 100 : 100)}% - 14px)`, background: "#b45309",
                        display: t > 0 && t < row.t0_ms ? "block" : "none",
                      }}>фронт</span>
                    </div>
                    <span className="flex items-center gap-1 shrink-0 font-semibold" style={{ color: STATUS_STYLE[st.kind].color }}>
                      <Icon name="BrickWall" size={13} />{row.d.toFixed(0)} м
                    </span>
                  </div>
                  <div className="text-[11px] mt-1 tabular-nums" style={{ color: muted }}>
                    {st.kind === "waiting"
                      ? <>Фронт волны в <b style={{ color: ink }}>{st.remain_m.toFixed(0)} м</b> от перемычки, придёт через <b style={{ color: ink }}>{fmtMs(row.t0_ms - t)}</b></>
                      : <>Волна дошла до перемычки через <b style={{ color: ink }}>{fmtMs(row.t0_ms)}</b> после взрыва, пройдя {row.d.toFixed(0)} м по выработкам</>}
                  </div>
                </div>

                {/* 2. Нагрузка во времени */}
                <div className="rounded-md px-3 pt-2 pb-1" style={{ border: "1px solid var(--c-b1, #e5e7eb)" }}>
                  <div className="flex items-center">
                    <div className="text-[10px] font-semibold uppercase tracking-wider flex-1" style={{ color: muted }}>2. Нагрузка на перемычку, % от прочности</div>
                    <button type="button" onClick={() => { setPlaying(false); setT(Math.max(0, row.t0_ms - row.theta_ms * 0.3)); }}
                      className="text-[10.5px] px-1.5 py-0.5 rounded hover:bg-black/5" style={{ color: "var(--c-accent, #1e5a7a)" }}>
                      К приходу волны
                    </button>
                  </div>
                  <div style={{ height: 230 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={data} margin={{ top: 8, right: 14, bottom: 16, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        {/* Зона разрушения — выше 100 % */}
                        <ReferenceArea y1={100} y2={yMax} fill="#fee2e2" fillOpacity={0.6} ifOverflow="hidden" />
                        <XAxis dataKey="t" type="number" domain={[tMin, tMax]} tick={{ fontSize: 10 }}
                          tickFormatter={(v: number) => v.toFixed(0)}
                          label={{ value: "Время от взрыва, мс", position: "insideBottom", offset: -6, fontSize: 10 }} />
                        <YAxis domain={[0, yMax]} ticks={yMax <= 150 ? [0, 25, 50, 75, 100, 125] : [0, 50, 100, 150, 200, 250, 300].filter(v => v <= yMax)}
                          tick={{ fontSize: 10 }} width={46} tickFormatter={(v: number) => `${v}%`} allowDataOverflow />
                        <Tooltip formatter={(_v: number, _n: string, it: { payload?: { real?: number } }) => {
                            const real = it?.payload?.real ?? 0;
                            return [`${fmtPct(real)} (${(row.fp_kPa * real / 100).toFixed(1)} кПа)`, "Нагрузка"];
                          }}
                          labelFormatter={(l: number) => `t = ${Number(l).toFixed(1)} мс`} contentStyle={{ fontSize: 11 }} />
                        <Area type="linear" dataKey="pct" stroke="none" fill={row.hit.destroyed ? "#dc2626" : "#f59e0b"} fillOpacity={0.18} isAnimationActive={false} />
                        <Line type="linear" dataKey="pct" stroke={row.hit.destroyed ? "#dc2626" : "#d97706"} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                        <ReferenceLine y={100} stroke="#dc2626" strokeWidth={1.5}
                          label={{ value: `прочность ${(row.fp_kPa / 1000).toFixed(3)} МПа = 100 %`, position: "insideBottomRight", fontSize: 10, fill: "#dc2626" }} />
                        {clipped && (
                          <ReferenceLine y={yMax} stroke="none"
                            label={{ value: `пик ${fmtPct(peakPct)} — выше шкалы`, position: "insideTopRight", fontSize: 10, fill: "#991b1b", fontWeight: 700 }} />
                        )}
                        <ReferenceLine x={row.t0_ms} stroke="#9ca3af" strokeDasharray="4 3"
                          label={{ value: row.hit.destroyed ? "приход волны → разрушение" : "приход волны", position: "insideTopLeft", fontSize: 10, fill: row.hit.destroyed ? "#dc2626" : "#6b7280" }} />
                        {t >= tMin && t <= tMax && <ReferenceLine x={t} stroke="#1e5a7a" strokeWidth={2} />}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[10.5px] pb-1" style={{ color: muted }}>
                    Фронт ударной волны — скачок: давление мгновенно поднимается до максимума и затем спадает за {row.theta_ms.toFixed(0)} мс.
                    Кривая заходит в красную зону (выше 100 %) — перемычка разрушается; остаётся ниже — держит.
                  </div>
                </div>

                {/* 3. Состояние сейчас */}
                <div className="flex items-start gap-3 rounded-md px-3 py-2.5" style={{ background: STATUS_STYLE[st.kind].bg, border: `1px solid ${STATUS_STYLE[st.kind].border}` }}>
                  <Icon name={STATUS_STYLE[st.kind].icon} size={20} style={{ color: STATUS_STYLE[st.kind].color, flexShrink: 0, marginTop: 1 }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold" style={{ color: STATUS_STYLE[st.kind].color }}>
                      {st.kind === "waiting" ? "Волна ещё не дошла"
                        : st.kind === "loading" ? `Перемычка под нагрузкой — ${fmtPct(st.pct)} прочности, держит`
                        : st.kind === "destroyed" ? `Перемычка разрушена на ${fmtMs(row.t0_ms)}`
                        : "Волна прошла — перемычка устояла"}
                    </div>
                    <div className="text-[11px] mt-0.5 tabular-nums" style={{ color: muted }}>
                      Сейчас давление во фронте {pNow.toFixed(1)} кПа · давление отражения на полотне {reflectedPressure(pNow).toFixed(1)} кПа (справочно, для толщины)
                    </div>
                    <div className="text-[11.5px] mt-1.5" style={{ color: ink }}><b>Итог расчёта:</b> {summary}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>)}
      </div>
    </div>
  );
}
