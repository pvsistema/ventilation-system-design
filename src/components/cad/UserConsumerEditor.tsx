// Окно «Свой потребитель»: пожарный ствол, распылитель или установка пенного
// тушения с паспортными характеристиками. Расход вводится в л/с, остальные
// единицы (м³/ч, л/мин) и давление в кгс/см² пересчитываются сами.
import { useState } from "react";
import Icon from "@/components/ui/icon";
import {
  CONSUMER_GROUP_NAMES, lpsToM3h, lpsToLmin, mpaToAtm,
  type WaterConsumerModel, type ConsumerGroup,
} from "@/lib/waterConsumers";

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

export default function UserConsumerEditor({ initial, onSave, onClose }: {
  initial: WaterConsumerModel;
  onSave: (c: WaterConsumerModel) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [group, setGroup] = useState<ConsumerGroup>(initial.group);
  const [diam, setDiam] = useState(initial.outletDiameter > 0 ? fmt(initial.outletDiameter) : "");
  const [lps, setLps] = useState(fmt(initial.flowLps));
  const [area, setArea] = useState(initial.extinguishArea > 0 ? fmt(initial.extinguishArea) : "");
  const [range, setRange] = useState(initial.jetRange.replace(/\s*м\s*$/, ""));
  const [mpa, setMpa] = useState(initial.workPressureMPa);
  const [notes, setNotes] = useState(initial.notes ?? "");

  const q = num(lps);
  const errors: string[] = [];
  if (!name.trim()) errors.push("Укажите наименование");
  if (!(q > 0)) errors.push("Укажите расход воды, л/с");
  if (diam.trim() && !(num(diam) > 0)) errors.push("Диаметр отверстия — положительное число (или оставьте пустым)");
  if (!/\d/.test(mpa)) errors.push("Укажите рабочее давление, МПа (например 0,4–0,6)");
  const warn = num(diam) > 100 ? "Диаметр больше 100 мм — проверьте единицы (мм)"
    : q > 50 ? "Расход больше 50 л/с — проверьте единицы (л/с, не л/мин)"
    : /\d/.test(mpa) && parseFloat(mpa.replace(",", ".")) > 10 ? "Давление больше 10 МПа — проверьте единицы (МПа, не кгс/см²)" : "";

  const save = () => {
    if (errors.length) return;
    const r = range.trim();
    onSave({
      ...initial,
      name: name.trim(), group,
      outletDiameter: num(diam) > 0 ? num(diam) : 0,
      flowLps: q, flowM3h: lpsToM3h(q), flowLmin: lpsToLmin(q),
      extinguishArea: num(area) > 0 ? num(area) : 0,
      jetRange: r ? (/\d$/.test(r) ? `${r} м` : r) : "—",
      workPressureMPa: mpa.trim().replace(/-/g, "–"),
      workPressureAtm: mpaToAtm(mpa.trim().replace(/-/g, "–")),
      notes: notes.trim(),
      isUser: true,
    });
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden bg-[var(--c-s1)] border border-[var(--c-b2)]"
        style={{ width: 520, maxWidth: "96vw", maxHeight: "92vh" }}>
        <div className="flex items-center gap-2 px-4 h-11 border-b border-[var(--c-b1)] flex-shrink-0">
          <Icon name="Flame" size={15} style={{ color: "var(--c-accent, #1e5a7a)" }} />
          <span className="text-[13px] font-semibold text-[var(--c-t1)]">{initial.name ? "Свой потребитель" : "Новый потребитель"}</span>
          <button onClick={onClose} className="ml-auto w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--c-t3)] hover:bg-[var(--c-s3)]">
            <Icon name="X" size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className={LABEL}>Наименование</label>
            <input className={INPUT} value={name} placeholder="Ствол пожарный РС-50" onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className={LABEL}>Группа</label>
            <div className="flex gap-1 p-0.5 rounded-md" style={{ background: "var(--c-s3, #f1efea)" }}>
              {(Object.keys(CONSUMER_GROUP_NAMES) as ConsumerGroup[]).map((g) => (
                <button key={g} type="button" onClick={() => setGroup(g)}
                  className="flex-1 h-7 rounded text-[11px] transition-colors"
                  style={{
                    background: group === g ? "var(--c-s1, #fff)" : "transparent",
                    color: group === g ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)",
                    fontWeight: group === g ? 600 : 400,
                    boxShadow: group === g ? "0 1px 2px rgba(0,0,0,.12)" : "none",
                  }}>
                  {CONSUMER_GROUP_NAMES[g]}
                </button>
              ))}
            </div>
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--c-t3)] pt-1">Расход воды</div>
          <div className="grid grid-cols-3 gap-2 items-end">
            <div>
              <label className={LABEL}>Расход, л/с</label>
              <input className={NUM} value={lps} inputMode="decimal" onChange={(e) => setLps(e.target.value)} />
            </div>
            <div className="text-[11px] text-[var(--c-t3)] pb-2">= {q > 0 ? fmt(lpsToM3h(q)) : "—"} м³/ч</div>
            <div className="text-[11px] text-[var(--c-t3)] pb-2">= {q > 0 ? lpsToLmin(q) : "—"} л/мин</div>
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--c-t3)] pt-1">Характеристики</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={LABEL}>Ø отверстия, мм</label>
              <input className={NUM} value={diam} inputMode="decimal" placeholder="—" onChange={(e) => setDiam(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Площадь тушения, м²</label>
              <input className={NUM} value={area} inputMode="decimal" placeholder="—" onChange={(e) => setArea(e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Дальность струи, м</label>
              <input className={NUM} value={range} placeholder="28 или 5–6" onChange={(e) => setRange(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 items-end">
            <div>
              <label className={LABEL}>Рабочее давление, МПа</label>
              <input className={NUM} value={mpa} placeholder="0,4–0,6" onChange={(e) => setMpa(e.target.value)} />
            </div>
            <div className="text-[11px] text-[var(--c-t3)] pb-2 col-span-2">
              = {/\d/.test(mpa) ? mpaToAtm(mpa.replace(/-/g, "–")) : "—"} кгс/см²
            </div>
          </div>
          <div>
            <label className={LABEL}>Примечание</label>
            <input className={INPUT} value={notes} placeholder="Поставщик, ГОСТ, где установлен" onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-[var(--c-b1)] flex items-center gap-2 flex-shrink-0">
          <div className="flex-1 min-w-0 text-[10px] leading-snug">
            {errors.length > 0
              ? <span style={{ color: "var(--c-red, #dc2626)" }}>{errors[0]}</span>
              : warn ? <span style={{ color: "var(--c-amber-ink, #865412)" }}>{warn}</span>
              : <span className="text-[var(--c-t4)]">Сохранится в проекте и появится в выборе модели у узла-потребителя.</span>}
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
