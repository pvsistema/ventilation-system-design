// ─────────────────────────────────────────────────────────────────────────────
// UserFanEditorDialog — создание и правка СВОЕГО вентилятора (которого нет в
// заводском каталоге): паспорт (название, тип, Ø, обороты), характеристики
// по углам лопаток — точками Q / H / КПД с паспортного графика, реверс.
// Кривые строятся по точкам сразу, на графике видно, насколько они совпали.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import FanChart from "@/components/cad/FanChart";
import type { FanCurve, UserFanPoint } from "@/lib/fanCurves";
import { buildUserFanCurve, fitAngleCurve, type UserFanDraft } from "@/lib/userFanFit";
import {
  fanCurvePoints, reverseCurvePoints, FAN_CURVE_COLORS, FAN_REVERSE_COLOR, angleLabel,
} from "@/lib/fanChartData";

interface Props {
  /** Существующий вентилятор для правки (иначе — новый) */
  initial?: FanCurve;
  onSave: (c: FanCurve) => void;
  onClose: () => void;
}

const INPUT =
  "w-full h-7 px-2 text-[12px] rounded-md outline-none border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t1)] focus:border-[var(--c-accent)]";
const CELL =
  "w-full h-6 px-1 text-[11px] text-right rounded border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t1)] outline-none focus:border-[var(--c-accent)]";
const LABEL = "block text-[10px] font-medium mb-0.5 text-[var(--c-t3)]";
const BTN =
  "h-7 px-2.5 inline-flex items-center justify-center gap-1 text-[11px] rounded-md border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t2)] hover:bg-[var(--c-s3)]";

interface RowS { q: string; h: string; eta: string }
interface AngleS { key: string; angle: string; rows: RowS[] }

const emptyRows = (n = 5): RowS[] => Array.from({ length: n }, () => ({ q: "", h: "", eta: "" }));
const num = (s: string) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};
const toRows = (pts: UserFanPoint[]): RowS[] => {
  const r = pts.map(p => ({ q: String(p.q), h: String(p.h), eta: p.eta !== undefined ? String(p.eta) : "" }));
  while (r.length < 5) r.push({ q: "", h: "", eta: "" });
  return r;
};
const toPoints = (rows: RowS[]): UserFanPoint[] =>
  rows.map(r => ({ q: num(r.q), h: num(r.h), eta: r.eta.trim() ? num(r.eta) : undefined }))
    .filter(p => Number.isFinite(p.q) && Number.isFinite(p.h))
    .map(p => ({ ...p, eta: p.eta !== undefined && Number.isFinite(p.eta) ? p.eta : undefined }));

let keySeq = 0;
const nk = () => `k${++keySeq}`;

export default function UserFanEditorDialog({ initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<FanCurve["type"]>(initial?.type ?? "axial");
  const [diameter, setDiameter] = useState(String(initial?.diameter ?? ""));
  const [rpmNominal, setRpmNominal] = useState(String(initial?.rpmNominal ?? 1000));
  const [rpmMin, setRpmMin] = useState(String(initial?.rpmMin ?? 0));
  const [rpmMax, setRpmMax] = useState(String(initial?.rpmMax ?? initial?.rpmNominal ?? 1000));
  const [angles, setAngles] = useState<AngleS[]>(() =>
    initial?.source?.angles.length
      ? initial.source.angles.map(a => ({ key: nk(), angle: String(a.angle), rows: toRows(a.points) }))
      : [{ key: nk(), angle: "0", rows: emptyRows() }]);
  const [hasRev, setHasRev] = useState(!!initial?.source?.reverse?.points.length);
  const [revRows, setRevRows] = useState<RowS[]>(() => toRows(initial?.source?.reverse?.points ?? []));
  const [revEff, setRevEff] = useState(String(Math.round((initial?.reverseEfficiencyFactor ?? 0.82) * 100)));
  const [activeKey, setActiveKey] = useState<string>(() => angles[0]?.key ?? "");
  const [showErr, setShowErr] = useState(false);

  const active = angles.find(a => a.key === activeKey) ?? angles[0];
  const editingRev = activeKey === "rev";

  const draft: UserFanDraft = useMemo(() => ({
    id: initial?.id,
    name, type,
    diameter: num(diameter) || 0,
    rpmNominal: num(rpmNominal) || 0,
    rpmMin: num(rpmMin) || 0,
    rpmMax: num(rpmMax) || 0,
    reverseEfficiencyFactor: Math.min(1, Math.max(0.3, (num(revEff) || 82) / 100)),
    source: {
      angles: angles.map(a => ({ angle: num(a.angle) || 0, points: toPoints(a.rows) })),
      reverse: hasRev ? { points: toPoints(revRows) } : undefined,
    },
  }), [initial?.id, name, type, diameter, rpmNominal, rpmMin, rpmMax, revEff, angles, hasRev, revRows]);

  const built = useMemo(() => buildUserFanCurve(draft), [draft]);

  // Кривые для предпросмотра и отклонение кривой от введённых точек
  const preview = useMemo(() => {
    const c = built.curve;
    const curves = c ? (c.angleCurves ?? []).map((ac, i) => ({
      pts: fanCurvePoints(c, ac.angle, 40),
      color: FAN_CURVE_COLORS[i % FAN_CURVE_COLORS.length],
      label: angleLabel(ac.angle),
      highlight: !editingRev && ac.angle === (num(active?.angle ?? "") || 0),
    })) : [];
    if (c && c.reverseH0 !== undefined) {
      curves.push({ pts: reverseCurvePoints(c, 40), color: FAN_REVERSE_COLOR, label: "Реверс", highlight: editingRev, dash: true } as typeof curves[number]);
    }
    const marks = editingRev ? toPoints(revRows) : toPoints(active?.rows ?? []);
    return { curves, marks };
  }, [built.curve, active, editingRev, revRows]);

  const fitInfo = useMemo(() => {
    if (editingRev) return fitAngleCurve(0, toPoints(revRows));
    return active ? fitAngleCurve(num(active.angle) || 0, toPoints(active.rows)) : null;
  }, [active, editingRev, revRows]);

  const setRows = (rows: RowS[]) => {
    if (editingRev) { setRevRows(rows); return; }
    setAngles(as => as.map(a => a.key === active.key ? { ...a, rows } : a));
  };
  const rows = editingRev ? revRows : (active?.rows ?? []);
  const setCell = (i: number, k: keyof RowS, v: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  // Вставка из Excel: столбцы Q, H, (КПД) — табуляция/точка с запятой
  const onPaste = (e: React.ClipboardEvent, i: number) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n") && !text.includes("\t")) return;
    e.preventDefault();
    const lines = text.trim().split(/\r?\n/).map(l => l.split(/\t|;/).map(x => x.trim()));
    const next = [...rows];
    lines.forEach((cols, n) => {
      const idx = i + n;
      while (next.length <= idx) next.push({ q: "", h: "", eta: "" });
      next[idx] = { q: cols[0] ?? "", h: cols[1] ?? "", eta: cols[2] ?? "" };
    });
    setRows(next);
  };

  const addAngle = () => {
    const used = angles.map(a => num(a.angle)).filter(Number.isFinite);
    const nextAngle = used.length ? Math.max(...used) + 5 : 0;
    const a = { key: nk(), angle: String(nextAngle), rows: emptyRows() };
    setAngles(as => [...as, a]);
    setActiveKey(a.key);
  };
  const removeAngle = (key: string) => {
    if (angles.length <= 1) return;
    const rest = angles.filter(a => a.key !== key);
    setAngles(rest);
    if (activeKey === key) setActiveKey(rest[0].key);
  };

  const save = () => {
    setShowErr(true);
    if (built.curve) onSave(built.curve);
  };

  const tab = (on: boolean) =>
    "h-7 px-2 inline-flex items-center gap-1 text-[11px] rounded-md border whitespace-nowrap " +
    (on ? "bg-[var(--c-accent)] text-white border-[var(--c-accent)]" : "bg-[var(--c-s1)] text-[var(--c-t2)] border-[var(--c-b2)] hover:bg-[var(--c-s3)]");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(15,20,25,0.45)" }}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden bg-[var(--c-s1)] border border-[var(--c-b2)]"
        style={{ width: Math.min(980, window.innerWidth - 24), height: Math.min(640, window.innerHeight - 24) }}>
        {/* Шапка */}
        <div className="flex items-center gap-2 px-4 h-11 border-b border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s2, #f8f7f4)" }}>
          <Icon name="Wind" size={15} className="text-[var(--c-accent)]" />
          <span className="text-[13px] font-semibold text-[var(--c-t1)]">
            {initial ? `Свой вентилятор — ${initial.name}` : "Новый вентилятор"}
          </span>
          <button onClick={onClose} className="ml-auto w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--c-t3)] hover:bg-[var(--c-s3)]">
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Левая колонка — паспорт и точки */}
          <div className="flex flex-col border-r border-[var(--c-b1)] overflow-y-auto" style={{ width: 400, flexShrink: 0 }}>
            <div className="p-3 space-y-2 border-b border-[var(--c-b1)]">
              <div>
                <label className={LABEL}>Название (марка)</label>
                <input className={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="Например, ВОД-21М" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={LABEL}>Тип</label>
                  <select className={INPUT} value={type} onChange={e => setType(e.target.value as FanCurve["type"])}>
                    <option value="axial">Осевой</option>
                    <option value="centrifugal">Центробежный</option>
                    <option value="vmp">ВМП</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Диаметр колеса, м</label>
                  <input className={INPUT} value={diameter} onChange={e => setDiameter(e.target.value)} inputMode="decimal" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={LABEL} title="Обороты, при которых сняты точки характеристики">Номин. об/мин</label>
                  <input className={INPUT} value={rpmNominal} onChange={e => setRpmNominal(e.target.value)} inputMode="numeric" />
                </div>
                <div>
                  <label className={LABEL}>Мин. об/мин</label>
                  <input className={INPUT} value={rpmMin} onChange={e => setRpmMin(e.target.value)} inputMode="numeric" />
                </div>
                <div>
                  <label className={LABEL}>Макс. об/мин</label>
                  <input className={INPUT} value={rpmMax} onChange={e => setRpmMax(e.target.value)} inputMode="numeric" />
                </div>
              </div>
            </div>

            {/* Характеристики */}
            <div className="p-3 space-y-2 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[var(--c-t2)]">Характеристики по углам лопаток</span>
                <button className={BTN} onClick={addAngle}><Icon name="Plus" size={11} /> Угол</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {angles.map((a, i) => (
                  <button key={a.key} className={tab(a.key === activeKey)} onClick={() => setActiveKey(a.key)}>
                    <span className="w-2 h-2 rounded-full" style={{ background: FAN_CURVE_COLORS[i % FAN_CURVE_COLORS.length] }} />
                    {angleLabel(num(a.angle) || 0)}
                  </button>
                ))}
                <label className="h-7 px-2 inline-flex items-center gap-1 text-[11px] text-[var(--c-t2)] cursor-pointer select-none">
                  <input type="checkbox" checked={hasRev} style={{ accentColor: FAN_REVERSE_COLOR }}
                    onChange={e => { setHasRev(e.target.checked); if (e.target.checked) setActiveKey("rev"); else if (editingRev) setActiveKey(angles[0].key); }} />
                  Реверс
                </label>
                {hasRev && (
                  <button className={tab(editingRev)} onClick={() => setActiveKey("rev")}>
                    <span className="w-2 h-2 rounded-full" style={{ background: FAN_REVERSE_COLOR }} /> Реверс
                  </button>
                )}
              </div>

              {editingRev ? (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-[var(--c-t3)]">КПД реверса от прямого, %</label>
                  <input className={CELL + " w-16"} value={revEff} onChange={e => setRevEff(e.target.value)} />
                </div>
              ) : active && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-[var(--c-t3)]">Угол лопаток, °</label>
                  <input className={CELL + " w-16"} value={active.angle}
                    onChange={e => setAngles(as => as.map(a => a.key === active.key ? { ...a, angle: e.target.value } : a))} />
                  {angles.length > 1 && (
                    <button className="ml-auto text-[11px] text-[var(--c-red)] hover:underline" onClick={() => removeAngle(active.key)}>
                      Удалить угол
                    </button>
                  )}
                </div>
              )}

              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[var(--c-t3)]">
                    <th className="font-medium text-left w-6">№</th>
                    <th className="font-medium text-right pr-1">Q, м³/с</th>
                    <th className="font-medium text-right pr-1">H, Па</th>
                    <th className="font-medium text-right pr-1" title="Можно не заполнять — КПД оценится автоматически">КПД, %</th>
                    <th className="w-5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="text-[var(--c-t4)]">{i + 1}</td>
                      <td className="py-0.5 pr-1"><input className={CELL} value={r.q} onChange={e => setCell(i, "q", e.target.value)} onPaste={e => onPaste(e, i)} inputMode="decimal" /></td>
                      <td className="py-0.5 pr-1"><input className={CELL} value={r.h} onChange={e => setCell(i, "h", e.target.value)} onPaste={e => onPaste(e, i)} inputMode="decimal" /></td>
                      <td className="py-0.5 pr-1"><input className={CELL} value={r.eta} onChange={e => setCell(i, "eta", e.target.value)} onPaste={e => onPaste(e, i)} inputMode="decimal" /></td>
                      <td>
                        {rows.length > 2 && (
                          <button className="text-[var(--c-b3)] hover:text-[var(--c-red)]" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                            <Icon name="X" size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="text-[11px] text-[var(--c-blue)] hover:underline" onClick={() => setRows([...rows, { q: "", h: "", eta: "" }])}>
                + строка
              </button>
              <div className="text-[10px] leading-snug text-[var(--c-t4)]">
                Снимите с паспортного графика 4–8 точек по каждому углу — от левого края зоны до правого.
                Можно вставить столбцы Q / H / КПД из Excel (Ctrl+V в первую ячейку).
              </div>
            </div>
          </div>

          {/* Правая колонка — предпросмотр */}
          <div className="flex-1 min-w-0 flex flex-col overflow-y-auto p-3 gap-2">
            <div className="text-[11px] font-semibold text-[var(--c-t2)]">Предпросмотр характеристики</div>
            <div className="rounded-md border border-[var(--c-b1)] overflow-hidden bg-white">
              {preview.curves.length > 0 ? (
                <FanChart curves={preview.curves} type="qh" fluid width={520} height={320} labels
                  operatingPoints={preview.marks.map(p => ({ q: p.q, h: p.h, color: "#111827" }))} />
              ) : (
                <div className="h-60 flex items-center justify-center text-[12px] text-[var(--c-t4)] text-center px-6">
                  Введите хотя бы 2 точки (Q и H) — кривая появится здесь
                </div>
              )}
            </div>
            <div className="text-[10px] text-[var(--c-t4)]">Чёрные точки — введённые значения выбранной характеристики, линия — построенная по ним кривая.</div>
            {fitInfo && (
              <div className="text-[11px] px-2 py-1.5 rounded-md"
                style={{ background: fitInfo.maxErrPct > 8 ? "var(--c-tint-amber, #fffbeb)" : "var(--c-tint-green, #f0fdf4)",
                  color: fitInfo.maxErrPct > 8 ? "var(--c-amber-ink, #865412)" : "var(--c-green, #15803d)" }}>
                {fitInfo.maxErrPct > 8
                  ? `Кривая отклоняется от точек до ${fitInfo.maxErrPct.toFixed(1)} % — проверьте значения (возможна опечатка).`
                  : `Кривая совпадает с точками (отклонение до ${fitInfo.maxErrPct.toFixed(1)} %).`}
                {" "}Паспортная зона: {fitInfo.curve.qMin}–{fitInfo.curve.qMax} м³/с.
              </div>
            )}
            {showErr && built.errors.length > 0 && (
              <div className="text-[11px] px-2 py-1.5 rounded-md" style={{ background: "var(--c-tint-red, #fef2f2)", color: "var(--c-red-ink, #991b1b)" }}>
                {built.errors.map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}
          </div>
        </div>

        {/* Кнопки */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s2, #f8f8f8)" }}>
          <span className="text-[11px] text-[var(--c-t3)] flex-1">
            Вентилятор сохранится в проекте и в вашей библиотеке — его можно будет добавлять в другие проекты.
          </span>
          <button onClick={onClose} className={BTN}>Отмена</button>
          <button onClick={save}
            className="h-7 px-3 inline-flex items-center gap-1 text-[11px] font-medium rounded-md text-white bg-[var(--c-accent)] hover:bg-[var(--c-accent-ink)]">
            <Icon name="Check" size={12} /> {initial ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}
