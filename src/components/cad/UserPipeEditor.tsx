// Окно «Своя труба»: обозначение, ГОСТ/ТУ, материал, DN, наружный Ø и стенка.
// Внутренний диаметр, шероховатость и пропускная способность считаются сами.
import { useState } from "react";
import Icon from "@/components/ui/icon";
import { MATERIAL_ROUGHNESS_MM } from "@/lib/waterSolver";
import { capacityM3h, V_TECH, V_FIRE, checkWall, allowedPressureMPa, CORROSION_MM, type WaterPipeModel } from "@/lib/waterPipes";

const INPUT =
  "w-full h-8 px-2 text-[12px] rounded-md outline-none border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t1)] focus:border-[var(--c-accent)]";
const NUM = INPUT + " text-right";
const LABEL = "block text-[10px] font-medium mb-1 text-[var(--c-t3)]";
const BTN =
  "h-7 px-2.5 inline-flex items-center justify-center gap-1 text-[11px] rounded-md border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t2)] hover:bg-[var(--c-s3)] transition-colors";
const BTN_PRIMARY =
  "h-7 px-3 inline-flex items-center justify-center gap-1 text-[11px] font-medium rounded-md text-white bg-[var(--c-accent)] hover:bg-[var(--c-accent-ink)] disabled:opacity-40 transition-colors";

const num = (s: string) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};
const fmt = (v: number) => (Number.isFinite(v) ? String(v).replace(".", ",") : "");

export default function UserPipeEditor({ initial, onSave, onClose }: {
  initial: WaterPipeModel;
  onSave: (m: WaterPipeModel) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [gost, setGost] = useState(initial.gost);
  const [material, setMaterial] = useState(initial.material);
  const [dn, setDn] = useState(fmt(initial.dn));
  const [od, setOd] = useState(fmt(initial.outerDiameter));
  const [wall, setWall] = useState(fmt(initial.wall));
  const [notes, setNotes] = useState(initial.notes ?? "");

  const o = num(od), w = num(wall), d = num(dn);
  const inner = o - 2 * w;
  const errors: string[] = [];
  if (!(o > 0)) errors.push("Укажите наружный диаметр, мм");
  if (!(w > 0)) errors.push("Укажите толщину стенки, мм");
  if (o > 0 && w > 0 && !(inner > 1)) errors.push("Стенка больше половины диаметра — проверьте размеры");
  if (!(d > 0)) errors.push("Укажите условный проход DN, мм");
  const ok = errors.length === 0;
  const dims = { outerDiameter: o, wall: w };
  const wc = ok ? checkWall({ gost, dn: d, outerDiameter: o, wall: w }) : null;
  const pa = ok ? allowedPressureMPa({ gost, dn: d, outerDiameter: o, wall: w, material }) : 0;
  const warn = o > 1000 ? "Диаметр больше 1000 мм — проверьте единицы (мм)"
    : wc && (wc.status === "thin" || wc.status === "off-series") ? `Стенка: ${wc.note}` : "";

  const save = () => {
    if (!ok) return;
    onSave({
      ...initial,
      name: name.trim() || `${fmt(o)}×${fmt(w)}`,
      gost: gost.trim(), material, dn: d, outerDiameter: o, wall: w,
      notes: notes.trim(), isUser: true,
    });
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden bg-[var(--c-s1)] border border-[var(--c-b2)]"
        style={{ width: 500, maxWidth: "96vw", maxHeight: "92vh" }}>
        <div className="flex items-center gap-2 px-4 h-11 border-b border-[var(--c-b1)] flex-shrink-0">
          <Icon name="GitBranch" size={15} style={{ color: "var(--c-accent, #1e5a7a)" }} />
          <span className="text-[13px] font-semibold text-[var(--c-t1)]">{initial.name ? "Своя труба" : "Новая труба"}</span>
          <button onClick={onClose} className="ml-auto w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--c-t3)] hover:bg-[var(--c-s3)]">
            <Icon name="X" size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL}>Обозначение</label>
              <input className={INPUT} value={name} placeholder={o > 0 && w > 0 ? `${fmt(o)}×${fmt(w)}` : "108×4"} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <label className={LABEL}>ГОСТ / ТУ</label>
              <input className={INPUT} value={gost} placeholder="ГОСТ 8732-78" onChange={(e) => setGost(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Материал</label>
            <select className={INPUT} value={material} onChange={(e) => setMaterial(e.target.value)}>
              {Object.keys(MATERIAL_ROUGHNESS_MM).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--c-t3)] pt-1">Размеры</div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className={LABEL}>DN, мм</label>
              <input className={NUM} value={dn} inputMode="decimal" onChange={(e) => setDn(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Наружный Ø, мм</label>
              <input className={NUM} value={od} inputMode="decimal" onChange={(e) => setOd(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Стенка, мм</label>
              <input className={NUM} value={wall} inputMode="decimal" onChange={(e) => setWall(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Внутр. Ø, мм</label>
              <div className="h-8 px-2 flex items-center justify-end text-[12px] rounded-md bg-[var(--c-s3)] text-[var(--c-t2)]">
                {inner > 1 ? fmt(Math.round(inner * 10) / 10) : "—"}
              </div>
            </div>
          </div>

          <div className="rounded-md px-3 py-2 text-[11px] leading-relaxed" style={{ background: "var(--c-s3, #f1efea)", color: "var(--c-t2)" }}>
            Шероховатость для расчёта: <b>{fmt(MATERIAL_ROUGHNESS_MM[material] ?? 0.5)} мм</b> ({material.toLowerCase()}, в эксплуатации).
            {ok && <> Пропускает <b>{Math.round(capacityM3h(dims, V_TECH))} м³/ч</b> при {V_TECH} м/с
              и <b>{Math.round(capacityM3h(dims, V_FIRE))} м³/ч</b> при {V_FIRE} м/с (пожаротушение).</>}
            {ok && pa > 0 && <> Допустимое давление — <b>{String(pa).replace(".", ",")} МПа</b> (с запасом на коррозию {CORROSION_MM} мм).</>}
            {wc && (
              <div className="mt-1" style={{ color: wc.status === "ok" ? "var(--c-green, #15803d)" : wc.status === "unknown" ? "var(--c-t3)" : "var(--c-amber-ink, #865412)" }}>
                Стенка по ГОСТ: {wc.gostText} мм — {wc.note}.
              </div>
            )}
          </div>

          <div>
            <label className={LABEL}>Примечание</label>
            <input className={INPUT} value={notes} placeholder="Поставщик, где проложена" onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-[var(--c-b1)] flex items-center gap-2 flex-shrink-0">
          <div className="flex-1 min-w-0 text-[10px] leading-snug">
            {!ok
              ? <span style={{ color: "var(--c-red, #dc2626)" }}>{errors[0]}</span>
              : warn ? <span style={{ color: "var(--c-amber-ink, #865412)" }}>{warn}</span>
              : <span className="text-[var(--c-t4)]">Сохранится в проекте и появится в выборе трубы у ветви.</span>}
          </div>
          <button className={BTN} onClick={onClose}>Отмена</button>
          <button className={BTN_PRIMARY} disabled={!ok} onClick={save}>
            <Icon name="Check" size={12} /> Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
