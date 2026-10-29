// Окно «Свой насос»: паспортные данные и напорная характеристика по точкам.
// Кривая H(Q) подбирается по точкам (H₀ + a·Q + b·Q²) и сразу рисуется
// на графике вместе с введёнными точками — видно, насколько точно она легла.
import { useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import PumpChart from "@/components/cad/PumpChart";
import {
  PUMP_TYPE_NAMES, fitPumpCurve, pumpHead,
  type PumpModel, type PumpType, type PumpCurvePoint,
} from "@/lib/pumps";

const INPUT =
  "w-full h-7 px-2 text-[12px] rounded-md outline-none border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t1)] focus:border-[var(--c-accent)]";
const NUM = INPUT + " text-right";
const LABEL = "block text-[10px] font-medium mb-0.5 text-[var(--c-t3)]";
const BTN =
  "h-7 px-2.5 inline-flex items-center justify-center gap-1 text-[11px] rounded-md border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t2)] hover:bg-[var(--c-s3)] transition-colors";
const BTN_PRIMARY =
  "h-7 px-3 inline-flex items-center justify-center gap-1 text-[11px] font-medium rounded-md text-white bg-[var(--c-accent)] hover:bg-[var(--c-accent-ink)] disabled:opacity-40 transition-colors";

const num = (s: string) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

type Row = { Q: string; H: string };

export default function UserPumpEditor({ initial, onSave, onClose }: {
  initial: PumpModel;
  onSave: (p: PumpModel) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.isUser || !initial.brand ? initial.model : `${initial.brand} ${initial.model}`.trim());
  const [type, setType] = useState<PumpType>(initial.type);
  const [rpm, setRpm] = useState(String(initial.rpm));
  const [power, setPower] = useState(String(initial.power));
  const [eta, setEta] = useState(String(Math.round(initial.etaMax * 100)));
  const [weight, setWeight] = useState(initial.weight ? String(initial.weight) : "");
  const [qmin, setQmin] = useState(String(initial.Qmin));
  const [qopt, setQopt] = useState(String(initial.Qopt));
  const [qmax, setQmax] = useState(String(initial.Qmax));
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.curvePoints?.length ? initial.curvePoints : sampleCurve(initial))
      .map((p) => ({ Q: String(p.Q), H: String(p.H) })));

  const points: PumpCurvePoint[] = rows
    .map((r) => ({ Q: num(r.Q), H: num(r.H) }))
    .filter((p) => Number.isFinite(p.Q) && Number.isFinite(p.H));
  const fit = useMemo(() => fitPumpCurve(points), [JSON.stringify(points)]); // eslint-disable-line react-hooks/exhaustive-deps

  const Qmin = num(qmin), Qopt = num(qopt), Qmax = num(qmax);
  const etaV = num(eta) / 100;
  const errors: string[] = [];
  if (!name.trim()) errors.push("Укажите марку насоса");
  if (!fit) errors.push("Нужно минимум 2 точки характеристики с разной подачей (лучше 3–5)");
  if (!(Qmax > 0)) errors.push("Укажите максимальную подачу");
  if (Qmax > 0 && !(Qopt > 0 && Qopt <= Qmax)) errors.push("Оптимальная подача должна быть больше 0 и не больше максимальной");
  if (Qopt > 0 && !(Qmin >= 0 && Qmin < Qopt)) errors.push("Минимальная подача должна быть меньше оптимальной");
  if (!(etaV > 0 && etaV <= 1)) errors.push("КПД — от 1 до 100 %");
  if (fit && Qopt > 0 && fit.H0 + fit.a * Qopt + fit.b * Qopt * Qopt <= 0) errors.push("По характеристике напор при оптимальной подаче не положителен — проверьте точки");
  const warn = fit && fit.H0 > 0 && fit.maxErr > fit.H0 * 0.05
    ? `Кривая отклоняется от введённых точек до ${fit.maxErr.toFixed(1)} м — проверьте точки или добавьте ещё`
    : fit && fit.b > 0 ? "Напор растёт с подачей — для центробежного насоса это необычно, проверьте точки" : "";

  const preview: PumpModel | null = fit && Qmax > 0 && Qopt > 0 ? {
    ...initial, type,
    H0: fit.H0, a: fit.a, b: fit.b,
    Qmin: Qmin >= 0 ? Qmin : 0, Qopt, Qmax,
    etaMax: etaV > 0 && etaV <= 1 ? etaV : 0.7,
    power: num(power) || 0, rpm: num(rpm) || 0,
  } : null;

  const save = () => {
    if (errors.length || !preview || !fit) return;
    onSave({
      ...preview,
      // Полное название — в «модели», марка пустая: иначе «ЦНС ЦНС 300-600».
      brand: "",
      model: name.trim(),
      weight: num(weight) || 0,
      notes: notes.trim(),
      curvePoints: [...points].sort((a, b) => a.Q - b.Q),
      isUser: true,
    });
  };

  const setRow = (i: number, patch: Partial<Row>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const field = (label: string, v: string, set: (s: string) => void, unit: string) => (
    <div>
      <label className={LABEL}>{label}, {unit}</label>
      <input className={NUM} value={v} inputMode="decimal" onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden bg-[var(--c-s1)] border border-[var(--c-b2)]"
        style={{ width: 760, maxWidth: "96vw", maxHeight: "92vh" }}>
        <div className="flex items-center gap-2 px-4 h-11 border-b border-[var(--c-b1)] flex-shrink-0">
          <Icon name="Waves" size={15} style={{ color: "var(--c-accent, #1e5a7a)" }} />
          <span className="text-[13px] font-semibold text-[var(--c-t1)]">
            {initial.curvePoints?.length || initial.isUser ? "Свой насос" : "Новый насос"}
          </span>
          <button onClick={onClose} className="ml-auto w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--c-t3)] hover:bg-[var(--c-s3)]">
            <Icon name="X" size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex gap-4">
          {/* Паспорт */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--c-t3)]">Паспорт</div>
            <div>
              <label className={LABEL}>Марка</label>
              <input className={INPUT} value={name} placeholder="ЦНС 300-600" onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Тип</label>
              <select className={INPUT} value={type} onChange={(e) => setType(e.target.value as PumpType)}>
                {(Object.keys(PUMP_TYPE_NAMES) as PumpType[]).map((t) => <option key={t} value={t}>{PUMP_TYPE_NAMES[t]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {field("Подача мин", qmin, setQmin, "м³/ч")}
              {field("Подача опт", qopt, setQopt, "м³/ч")}
              {field("Подача макс", qmax, setQmax, "м³/ч")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {field("Обороты", rpm, setRpm, "об/мин")}
              {field("Мощность двигателя", power, setPower, "кВт")}
              {field("КПД максимальный", eta, setEta, "%")}
              {field("Масса", weight, setWeight, "кг")}
            </div>
            <div>
              <label className={LABEL}>Примечание</label>
              <input className={INPUT} value={notes} placeholder="Секционный, 6 колёс" onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {/* Характеристика */}
          <div className="flex-shrink-0 space-y-2" style={{ width: 330 }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--c-t3)]">Напорная характеристика Q–H</div>
            <div className="text-[10px] text-[var(--c-t4)] leading-snug">
              Точки из паспорта насоса: подача и напор. По ним строится кривая — чем больше точек, тем точнее.
            </div>
            <div className="rounded-md border border-[var(--c-b1)] overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_28px] text-[10px] font-semibold uppercase text-[var(--c-t3)] px-2 h-6 items-center"
                style={{ background: "var(--c-s3, #f1efea)" }}>
                <span>Q, м³/ч</span><span>H, м</span><span />
              </div>
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_28px] gap-1 px-2 py-1 items-center border-t border-[var(--c-b1)]">
                  <input className={NUM} value={r.Q} inputMode="decimal" onChange={(e) => setRow(i, { Q: e.target.value })} />
                  <input className={NUM} value={r.H} inputMode="decimal" onChange={(e) => setRow(i, { H: e.target.value })} />
                  <button title="Удалить точку" disabled={rows.length <= 2}
                    onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                    className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--c-t4)] hover:text-[var(--c-red)] disabled:opacity-30">
                    <Icon name="Trash2" size={12} />
                  </button>
                </div>
              ))}
              <button onClick={() => setRows((p) => [...p, { Q: "", H: "" }])}
                className="w-full h-7 text-[11px] flex items-center justify-center gap-1 border-t border-[var(--c-b1)] text-[var(--c-accent)] hover:bg-[var(--c-s3)]">
                <Icon name="Plus" size={11} /> Добавить точку
              </button>
            </div>

            {preview ? (
              <div className="relative">
                <PumpChart pump={preview} width={330} height={190} />
                <svg width={330} height={190} className="absolute inset-0 pointer-events-none">
                  {points.map((p, i) => {
                    const pad = { l: 34, r: 12, t: 12, b: 24 };
                    const Qm = preview.Qmax * 1.1, Hm = preview.H0 * 1.15;
                    const x = pad.l + (p.Q / Qm) * (330 - pad.l - pad.r);
                    const y = 190 - pad.b - (p.H / Hm) * (190 - pad.t - pad.b);
                    return <circle key={i} cx={x} cy={y} r={3} fill="white" stroke="#1e5a7a" strokeWidth={1.5} />;
                  })}
                </svg>
                <div className="text-[10px] text-[var(--c-t4)] mt-1">
                  Красная — кривая насоса, кружки — точки паспорта. При Qопт напор {Math.round(pumpHead(preview, preview.Qopt))} м.
                </div>
              </div>
            ) : (
              <div className="h-[190px] rounded-md border border-dashed border-[var(--c-b2)] flex items-center justify-center text-[11px] text-[var(--c-t4)] text-center px-4">
                Введите точки характеристики и подачу — здесь появится график
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-[var(--c-b1)] flex items-center gap-2 flex-shrink-0">
          <div className="flex-1 min-w-0 text-[10px] leading-snug">
            {errors.length > 0
              ? <span style={{ color: "var(--c-red, #dc2626)" }}>{errors[0]}</span>
              : warn ? <span style={{ color: "var(--c-amber-ink, #865412)" }}>{warn}</span>
              : <span className="text-[var(--c-t4)]">Насос сохранится в проекте и появится в выборе модели у насоса на схеме.</span>}
          </div>
          <button className={BTN} onClick={onClose}>Отмена</button>
          <button className={BTN_PRIMARY} disabled={errors.length > 0} onClick={save}>
            <Icon name="Check" size={12} /> Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

/** Точки по готовой кривой — для насосов без сохранённых точек. */
function sampleCurve(p: PumpModel): PumpCurvePoint[] {
  return [0, 0.5, 1, 1.25].map((k) => {
    const Q = Math.round(p.Qopt * k);
    return { Q, H: Math.round(pumpHead(p, Q) * 10) / 10 };
  }).filter((x) => x.H > 0);
}
