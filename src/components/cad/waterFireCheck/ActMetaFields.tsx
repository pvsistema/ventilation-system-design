import { useState } from "react";
import Icon from "@/components/ui/icon";
import type { WaterActMeta } from "@/lib/waterCheckExport";
import { loadRequisites, saveRequisites } from "@/lib/actRequisites";

export type ActMetaInput = Omit<WaterActMeta, "date" | "projectName">;

function defaultPeriod(): string {
  const d = new Date();
  return `${d.getMonth() < 6 ? "I" : "II"} полугодие ${d.getFullYear()} г.`;
}

export function loadActMeta(): ActMetaInput {
  const r = loadRequisites();
  return {
    orgName: r.orgName,
    approverTitle: r.approverTitle || "Главный инженер",
    approverName: r.approverName,
    period: r.period || defaultPeriod(),
  };
}

function saveActMeta(m: ActMetaInput) {
  saveRequisites(m);
}

const FIELDS: { key: keyof ActMetaInput; label: string; placeholder: string; wide?: boolean }[] = [
  { key: "orgName", label: "Организация", placeholder: "АО «Рудник»", wide: true },
  { key: "approverTitle", label: "Должность утверждающего", placeholder: "Главный инженер" },
  { key: "approverName", label: "ФИО утверждающего", placeholder: "И. И. Иванов" },
  { key: "period", label: "Период ПМЛЛПА", placeholder: "II полугодие 2026 г.", wide: true },
];

export default function ActMetaFields({ value, onChange }: { value: ActMetaInput; onChange: (v: ActMetaInput) => void }) {
  const [open, setOpen] = useState(() => !value.orgName || !value.approverName);
  const set = (k: keyof ActMetaInput, v: string) => {
    const next = { ...value, [k]: v };
    onChange(next);
    saveActMeta(next);
  };
  const filled = FIELDS.filter((f) => value[f.key].trim()).length;

  return (
    <div className="border-t border-gray-200 bg-gray-50/60">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-1.5 text-[11px] text-gray-600 hover:bg-gray-100">
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={13} />
        <Icon name="FileSignature" size={13} fallback="FileText" />
        <span className="font-semibold">Реквизиты акта</span>
        <span className="text-gray-400">
          {filled === FIELDS.length
            ? `${value.orgName} · ${value.approverTitle} ${value.approverName} · ${value.period}`
            : `заполнено ${filled} из ${FIELDS.length} — общие для всех актов программы`}
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-4 pb-2.5 pt-0.5">
          {FIELDS.map((f) => (
            <label key={f.key} className={"flex flex-col gap-0.5" + (f.wide ? " col-span-2 sm:col-span-1" : "")}>
              <span className="text-[10px] text-gray-500">{f.label}</span>
              <input value={value[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder}
                className="text-[12px] px-2 py-1 rounded border border-gray-300 bg-white text-gray-800 focus:outline-none focus:border-blue-500" />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
