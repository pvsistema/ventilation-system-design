// ─────────────────────────────────────────────────────────────────────────────
// Калькулятор толщины взрывоустойчивой изолирующей перемычки
// (РБ № 343 от 08.11.2024, п. 25–27, формулы 6–7) с выгрузкой акта в Excel.
//
// Расчёт ведётся ДЛЯ ОДНОЙ перемычки, которую выбирает пользователь:
//   • давление берётся из расчёта взрыва по схеме (у выбранной перемычки или
//     выработки) — либо вводится вручную;
//   • размеры — по сечению выбранной выработки, их можно поправить;
//   • материал и условия — из справочника смесей.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import {
  BLAST_MIXES, blastMixById, blastMixAge, blastMixAgeLabel, calcBlastBulkheadThickness,
  bulkheadDimensions, reflectedPressure, BLAST_SAFETY_FACTOR,
} from "@/lib/blastBulkhead";
import { barrierDisplayName, type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";
import { exportBlastBulkheadAct } from "@/lib/blastBulkheadAct";

interface Props {
  projectName: string;
  branches: TopoBranch[];
  nodes: TopoNode[];
  symbols: SchemaSymbol[];
  /** Перемычки и удары по ним из расчёта взрыва (если выполнен). */
  barriers: Map<string, BlastBarrier[]> | null;
  hits: Map<string, BarrierHit> | null;
  /** Предварительная оценка давления по ветви (до полного расчёта), кПа. */
  previewPressureAt?: (b: TopoBranch) => number;
  /** Выработка, выделенная на схеме, — предлагается по умолчанию. */
  initialBranchId?: string | null;
  mixId: string;
  onMixId: (id: string) => void;
  mixCustomR: number;
  onMixCustomR: (v: number) => void;
  duringEmergency: boolean;
  onDuringEmergency: (v: boolean) => void;
  onClose: () => void;
}

type Option = { key: string; branchId: string; label: string; incident_kPa: number; fromCalc: boolean };

const INP = "w-full text-[12px] rounded-md px-2 py-1 outline-none";
const INP_STYLE = { background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d1d5db)", color: "var(--c-t1, #111827)" };

// Компоненты вынесены НА УРОВЕНЬ МОДУЛЯ. Внутри окна они пересоздавались бы
// при каждой перерисовке, React размонтировал бы поле ввода, и фокус терялся
// после первой же цифры — поле выглядело «некликабельным».
function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--c-t3, #6b7280)" }}>{children}</div>;
}

/**
 * Числовое поле: свободный ввод с клавиатуры, стрелки ↑/↓ (Shift — ×10) меняют
 * значение на шаг. Пока поле в фокусе, текст хранится локально — значение
 * не округляется и не перезаписывается на каждое нажатие.
 */
function NumField({ value, auto, onChange, step = 0.1, digits = 2 }: {
  value: number; auto: boolean; onChange: (v: number | null) => void; step?: number; digits?: number;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(digits)) : "");
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt(value)); }, [value, focused]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (t: string) => {
    const v = parseFloat(t.replace(",", "."));
    if (t.trim() === "") onChange(null);
    else if (Number.isFinite(v) && v >= 0) onChange(v);
  };
  const bump = (dir: 1 | -1, mult = 1) => {
    const base = parseFloat(text.replace(",", "."));
    const cur = Number.isFinite(base) ? base : value;
    const next = Math.max(0, +(cur + dir * step * mult).toFixed(6));
    setText(fmt(next));
    onChange(next);
  };

  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 flex items-stretch rounded-md overflow-hidden" style={{ border: "1px solid var(--c-b2, #d1d5db)" }}>
        <input type="text" inputMode="decimal" value={text}
          onFocus={e => { setFocused(true); e.currentTarget.select(); }}
          onBlur={() => { setFocused(false); commit(text); }}
          onChange={e => { setText(e.target.value); commit(e.target.value); }}
          onKeyDown={e => {
            if (e.key === "ArrowUp") { e.preventDefault(); bump(1, e.shiftKey ? 10 : 1); }
            else if (e.key === "ArrowDown") { e.preventDefault(); bump(-1, e.shiftKey ? 10 : 1); }
            else if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          className="flex-1 min-w-0 text-[12px] px-2 py-1 outline-none text-right tabular-nums"
          style={{ background: auto ? "var(--c-s2, #f9fafb)" : "var(--c-s1, #fff)", color: "var(--c-t1, #111827)" }} />
        <div className="flex flex-col" style={{ borderLeft: "1px solid var(--c-b2, #d1d5db)" }}>
          <button type="button" tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={e => bump(1, e.shiftKey ? 10 : 1)}
            className="px-1 flex-1 hover:bg-black/5 leading-none" style={{ color: "var(--c-t3, #6b7280)" }} title="Больше (Shift — ×10)">
            <Icon name="ChevronUp" size={11} />
          </button>
          <button type="button" tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={e => bump(-1, e.shiftKey ? 10 : 1)}
            className="px-1 flex-1 hover:bg-black/5 leading-none" style={{ color: "var(--c-t3, #6b7280)", borderTop: "1px solid var(--c-b1, #e5e7eb)" }} title="Меньше (Shift — ×10)">
            <Icon name="ChevronDown" size={11} />
          </button>
        </div>
      </div>
      {!auto && (
        <button type="button" onClick={() => onChange(null)} title="Вернуть авто" className="px-1 rounded hover:bg-black/5" style={{ color: "var(--c-t3, #6b7280)" }}>
          <Icon name="RotateCcw" size={12} />
        </button>
      )}
    </div>
  );
}

/** Перетаскивание окна за шапку. */
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

export default function BlastBulkheadCalcDialog(p: Props) {
  const brById = useMemo(() => new Map(p.branches.map(b => [b.id, b])), [p.branches]);
  const nodeById = useMemo(() => new Map(p.nodes.map(n => [n.id, n])), [p.nodes]);
  const symById = useMemo(() => new Map(p.symbols.map(s => [s.id, s])), [p.symbols]);

  const placeOf = (b?: TopoBranch) => {
    if (!b) return "—";
    const nm = String(b.type ?? "").replace(/^"(.*)"$/, "$1").trim() || `Ветвь ${b.id}`;
    const f = nodeById.get(b.fromId), t = nodeById.get(b.toId);
    return `${nm} (${f?.number || b.fromId}→${t?.number || b.toId})`;
  };

  // Перемычки, до которых дошла волна, — по убыванию давления
  const options: Option[] = useMemo(() => {
    const list: Option[] = [];
    if (p.barriers && p.hits) {
      for (const bars of p.barriers.values()) for (const bar of bars) {
        const h = p.hits.get(bar.key);
        if (!h || !(h.incident_kPa > 0)) continue;
        list.push({
          key: bar.key, branchId: bar.branchId, fromCalc: true, incident_kPa: h.incident_kPa,
          label: barrierDisplayName(symById.get(bar.key), brById.get(bar.branchId), bar.branchId),
        });
      }
    }
    return list.sort((a, b) => b.incident_kPa - a.incident_kPa);
  }, [p.barriers, p.hits, symById, brById]);

  const [mode, setMode] = useState<"barrier" | "branch">(options.length ? "barrier" : "branch");
  const [barKey, setBarKey] = useState<string>(options[0]?.key ?? "");
  const [branchId, setBranchId] = useState<string>(p.initialBranchId ?? p.branches.find(b => b.hasBulkhead)?.id ?? "");
  const [manualP, setManualP] = useState<number | null>(null);   // кПа, набегающей
  const [manualH, setManualH] = useState<number | null>(null);
  const [manualW, setManualW] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const opt = options.find(o => o.key === barKey);
  const branch = mode === "barrier" ? brById.get(opt?.branchId ?? "") : brById.get(branchId);

  // Давление: из расчёта / из предварительной оценки / вручную
  const autoP = mode === "barrier"
    ? (opt?.incident_kPa ?? 0)
    : branch ? ((branch.explosionComputedDeltaP ?? 0) > 0 ? branch.explosionComputedDeltaP! : (p.previewPressureAt?.(branch) ?? 0)) : 0;
  const pSource = manualP != null ? "задано вручную"
    : mode === "barrier" ? "расчёт взрыва по схеме (методика ВГСЧ)"
    : (branch?.explosionComputedDeltaP ?? 0) > 0 ? "расчёт взрыва по схеме (методика ВГСЧ)"
    : "предварительная оценка по прямому расстоянию до очага";
  const incident = manualP ?? autoP;
  const reflected = reflectedPressure(incident);

  const dimAuto = branch ? bulkheadDimensions(branch) : { height_m: 0, width_m: 0, approximate: false };
  const h = manualH ?? dimAuto.height_m;
  const w = manualW ?? dimAuto.width_m;

  const mix = blastMixById(p.mixId);
  const age = blastMixAge(mix.binder, p.duringEmergency);
  const rBend = p.mixId === "custom" && p.mixCustomR > 0 ? p.mixCustomR : mix.rBend[age];

  const res = calcBlastBulkheadThickness({ reflectedPressure_MPa: reflected / 1000, height_m: h, width_m: w, rBend_MPa: rBend });

  const branchList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return p.branches
      .filter(b => !q || placeOf(b).toLowerCase().includes(q) || b.id.includes(q))
      .sort((a, b) => Number(b.hasBulkhead) - Number(a.hasBulkhead) || (b.explosionComputedDeltaP ?? 0) - (a.explosionComputedDeltaP ?? 0))
      .slice(0, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.branches, query]);

  const resetManual = () => { setManualP(null); setManualH(null); setManualW(null); };

  async function exportAct() {
    if (!res || !branch) return;
    await exportBlastBulkheadAct({
      projectName: p.projectName,
      place: mode === "barrier" && opt ? `${opt.label}; выработка ${placeOf(branch)}` : placeOf(branch),
      pressureSource: pSource,
      incident_kPa: incident, reflected_kPa: reflected,
      height_m: h, width_m: w,
      dimsNote: manualH != null || manualW != null ? "задано вручную"
        : dimAuto.approximate ? "габарит сечения выработки (сечение непрямоугольное), п. 26" : undefined,
      mixName: mix.name, mixNote: p.mixId === "custom" ? "по паспорту изделия" : mix.note,
      ageLabel: blastMixAgeLabel(age), rBend_MPa: rBend,
      duringEmergency: p.duringEmergency, result: res,
    });
  }

  const inp = INP;
  const inpStyle = INP_STYLE;
  const { pos, onMouseDown: onHeaderDrag, boxRef } = useDraggable();

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none"
      style={pos ? undefined : { display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div ref={boxRef} className="rounded-xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
        style={{
          width: 820, maxWidth: "96vw", maxHeight: "92vh", background: "var(--c-s1, #fff)", border: "1.5px solid var(--c-b2, #d1d5db)",
          ...(pos ? { position: "fixed", left: pos.x, top: pos.y } : {}),
        }}
        onKeyDown={e => { if (e.key === "Escape") p.onClose(); }}>

        <div onMouseDown={onHeaderDrag} title="Перетащите, чтобы переместить окно"
          className="flex items-center gap-3 px-5 pt-4 pb-3 select-none" style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)", cursor: "move" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--c-tint-blue, #eef5f8)", border: "1px solid var(--c-tint-blue2, #d7e7ee)" }}>
            <Icon name="BrickWall" size={19} style={{ color: "var(--c-accent, #1e5a7a)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold" style={{ color: "var(--c-t1, #111827)" }}>Толщина взрывоустойчивой перемычки</div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>
              РБ № 343 от 08.11.2024, п. 25–27, формулы (6)–(7) · шарнирно опёртая плита, k<sub>з</sub> = {BLAST_SAFETY_FACTOR}
            </div>
          </div>
          <button onClick={p.onClose} className="rounded p-1 hover:bg-black/5" style={{ color: "var(--c-t4, #9ca3af)" }}>
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Исходные данные */}
          <div className="flex flex-col gap-3 px-4 py-4 overflow-y-auto" style={{ width: 430, borderRight: "1px solid var(--c-b1, #e5e7eb)" }}>
            <div>
              <Label>Место установки</Label>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {([["barrier", "Перемычка из расчёта", options.length], ["branch", "Любая выработка", null]] as const).map(([m, t, n]) => (
                  <button key={m} disabled={m === "barrier" && !options.length}
                    onClick={() => { setMode(m); resetManual(); }}
                    className="rounded-md px-2 py-1.5 text-[11.5px] text-left disabled:opacity-40"
                    style={{
                      background: mode === m ? "var(--c-tint-blue, #eef5f8)" : "var(--c-s1, #fff)",
                      border: `1.5px solid ${mode === m ? "var(--c-accent, #1e5a7a)" : "var(--c-b2, #d1d5db)"}`,
                      color: "var(--c-t1, #111827)",
                    }}>
                    {t}{n != null && <span className="text-[10px] ml-1" style={{ color: "var(--c-t4, #9ca3af)" }}>{n}</span>}
                  </button>
                ))}
              </div>
              {mode === "barrier" ? (
                options.length ? (
                  <select value={barKey} onChange={e => { setBarKey(e.target.value); resetManual(); }} className={inp} style={inpStyle}>
                    {options.map(o => <option key={o.key} value={o.key}>{o.label} — {(o.incident_kPa / 1000).toFixed(3)} МПа</option>)}
                  </select>
                ) : (
                  <div className="text-[11px]" style={{ color: "var(--c-t3, #6b7280)" }}>Сначала выполните «Расчёт взрыва».</div>
                )
              ) : (
                <>
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск выработки…" className={inp + " mb-1"} style={inpStyle} />
                  <select value={branchId} onChange={e => { setBranchId(e.target.value); resetManual(); }} size={5} className={inp} style={inpStyle}>
                    {branchList.map(b => (
                      <option key={b.id} value={b.id}>
                        {placeOf(b)}{b.hasBulkhead ? " · перемычка" : ""}{(b.explosionComputedDeltaP ?? 0) > 0 ? ` · ${(b.explosionComputedDeltaP! / 1000).toFixed(3)} МПа` : ""}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            <div>
              <Label>Давление ударной волны</Label>
              <div className="grid grid-cols-2 gap-2 items-end">
                <div>
                  <div className="text-[11px] mb-0.5" style={{ color: "var(--c-t2, #374151)" }}>ΔP во фронте, кПа</div>
                  <NumField value={incident} auto={manualP == null} onChange={setManualP} step={1} digits={1} />
                </div>
                <div className="text-[11px] pb-1.5" style={{ color: "var(--c-t2, #374151)" }}>
                  ΔP<sub>отр</sub> = <b>{(reflected / 1000).toFixed(4)} МПа</b>
                </div>
              </div>
              <div className="text-[10px] mt-1" style={{ color: "var(--c-t4, #9ca3af)" }}>{pSource}</div>
            </div>

            <div>
              <Label>Размеры перемычки (сечение выработки)</Label>
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-[11px] mb-0.5" style={{ color: "var(--c-t2, #374151)" }}>Высота h, м</div>
                  <NumField value={h} auto={manualH == null} onChange={setManualH} step={0.1} digits={2} /></div>
                <div><div className="text-[11px] mb-0.5" style={{ color: "var(--c-t2, #374151)" }}>Ширина w, м</div>
                  <NumField value={w} auto={manualW == null} onChange={setManualW} step={0.1} digits={2} /></div>
              </div>
              {dimAuto.approximate && manualH == null && manualW == null && (
                <div className="text-[10px] mt-1" style={{ color: "#a16207" }}>Сечение непрямоугольное — взят габарит сечения</div>
              )}
            </div>

            <div>
              <Label>Материал и условия</Label>
              <select value={p.mixId} onChange={e => p.onMixId(e.target.value)} className={inp} style={inpStyle}>
                {BLAST_MIXES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {p.mixId === "custom" && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[11px]" style={{ color: "var(--c-t2, #374151)" }}>R<sub>раст</sub>, МПа:</span>
                  <div className="flex-1">
                    <NumField value={p.mixCustomR} auto={false} onChange={v => p.onMixCustomR(v ?? 0)} step={0.1} digits={2} />
                  </div>
                </div>
              )}
              <label className="flex items-start gap-1.5 mt-2 cursor-pointer select-none">
                <input type="checkbox" checked={p.duringEmergency} onChange={e => p.onDuringEmergency(e.target.checked)} className="mt-0.5" />
                <span className="text-[11px]" style={{ color: "var(--c-t2, #374151)" }}>
                  Расчёт в ходе ликвидации аварии
                  <span className="block text-[10px]" style={{ color: "var(--c-t4, #9ca3af)" }}>п. 27: прочность раствора через 24 ч</span>
                </span>
              </label>
              <div className="mt-1.5 text-[11px]" style={{ color: "var(--c-t2, #374151)" }}>
                R<sub>раст</sub> = <b>{rBend} МПа</b> · возраст раствора {blastMixAgeLabel(age)}
              </div>
            </div>
          </div>

          {/* Результат */}
          <div className="flex-1 min-w-0 px-5 py-4 overflow-y-auto" style={{ background: "var(--c-s2, #f9fafb)" }}>
            <Label>Результат</Label>
            {!res ? (
              <div className="text-[12px] rounded-md px-3 py-3" style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fde68a", color: "var(--c-amber-ink, #92400e)" }}>
                Недостаточно данных: {!(incident > 0) ? "давление волны равно нулю (волна не дошла — выберите другую перемычку или введите давление)" : !(h > 0 && w > 0) ? "не заданы размеры перемычки" : "не задана прочность материала"}.
              </div>
            ) : (
              <>
                <div className="rounded-lg px-4 py-3 mb-3" style={{
                  background: res.clampedMax ? "var(--c-tint-red, #fef2f2)" : "var(--c-s1, #fff)",
                  border: `1.5px solid ${res.clampedMax ? "var(--c-red, #dc2626)" : "var(--c-accent, #1e5a7a)"}`,
                }}>
                  <div className="text-[11px]" style={{ color: "var(--c-t3, #6b7280)" }}>Принятая толщина перемычки</div>
                  <div className="text-[30px] font-bold leading-tight" style={{ color: res.clampedMax ? "var(--c-red, #dc2626)" : "var(--c-accent, #1e5a7a)" }}>
                    {res.thickness_m.toFixed(2)} м
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--c-t2, #374151)" }}>{res.note}</div>
                </div>
                <div className="text-[11.5px] leading-relaxed rounded-md px-3 py-2" style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b1, #e5e7eb)", color: "var(--c-t2, #374151)" }}>
                  <div>Формула ({res.formula}): {res.formula === 6 ? "h ≤ w" : "h > w"}</div>
                  <div className="font-mono text-[11px] my-1">
                    m = {res.span_m}·√({(reflected / 1000).toFixed(4)}·(3 − 2·{res.ratio}) / (24·{rBend}·{BLAST_SAFETY_FACTOR}))
                  </div>
                  <div>Расчётная толщина: <b>{res.thicknessRaw_m} м</b></div>
                  <div className="mt-1 text-[10.5px]" style={{ color: "var(--c-t4, #9ca3af)" }}>
                    п. 26: менее 2 м не принимается; более 5 м — схема плиты неприменима, нужны дополнительные решения.
                  </div>
                </div>
                <div className="mt-3 text-[10.5px] rounded-md px-3 py-2" style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fde68a", color: "var(--c-amber-ink, #92400e)" }}>
                  Прочность материала п. 27 требует принимать по паспорту изделия. Справочные значения — для предварительной оценки.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)", background: "var(--c-s2, #f9fafb)" }}>
          <button onClick={p.onClose} className="px-4 py-1.5 text-sm rounded hover:bg-black/5" style={{ color: "var(--c-t3, #6b7280)" }}>Закрыть</button>
          <div className="flex-1" />
          <button onClick={() => void exportAct()} disabled={!res || !branch}
            className="flex items-center gap-1.5 px-5 py-1.5 text-sm font-semibold text-white rounded-lg"
            style={{ background: res && branch ? "var(--c-green, #15803d)" : "#9ca3af", cursor: res && branch ? "pointer" : "not-allowed" }}>
            <Icon name="FileSpreadsheet" size={14} />
            Акт в Excel
          </button>
        </div>
      </div>
    </div>
  );
}
