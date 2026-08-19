// ─────────────────────────────────────────────────────────────────────────────
// OpoDataDialog.tsx — «Данные ОПО»: паспорт опасного производственного объекта.
//
// Верхняя часть — сведения, которые задаёт инженер (тип объекта, класс
// опасности, виды опасности). Нижняя — сводка по сети выработок, которая
// СЧИТАЕТСЯ по схеме и потому всегда актуальна.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";
import type { Horizon } from "@/lib/topology";
import {
  OPO_CLASS_LABELS, OPO_HAZARD_LABELS, OPO_HAZARD_ORDER,
  formatLengthM,
  type OpoData, type OpoHazardClass, type OpoHazardKind, type OpoNetworkSummary,
} from "@/lib/opoData";

interface Props {
  data: OpoData;
  onChange: (d: OpoData) => void;
  summary: OpoNetworkSummary;
  horizons: Horizon[];
  onClose: () => void;
}

/** Строка сводки: подпись слева, посчитанное значение справа. */
function SummaryRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-[11px] text-gray-600 flex-1 leading-tight">
        {label}
        {hint && <span className="block text-[10px] text-gray-400">{hint}</span>}
      </span>
      <span className="text-[12px] font-bold text-gray-900 text-right flex-shrink-0"
        style={{ minWidth: 110 }}>{value}</span>
    </div>
  );
}

export default function OpoDataDialog({ data, onChange, summary, horizons, onClose }: Props) {
  const set = (patch: Partial<OpoData>) => onChange({ ...data, ...patch });

  const toggleHazard = (h: OpoHazardKind) => {
    const on = data.hazards.includes(h);
    set({
      hazards: on ? data.hazards.filter((x) => x !== h) : [...data.hazards, h],
      // Сняли «горные удары» — выбранные горизонты больше не нужны, иначе они
      // остались бы в файле проекта и попали в документы.
      ...(on && h === "rockburst" ? { rockburstHorizonIds: [] } : {}),
    });
  };

  const toggleHorizon = (id: string) => {
    const on = data.rockburstHorizonIds.includes(id);
    set({
      rockburstHorizonIds: on
        ? data.rockburstHorizonIds.filter((x) => x !== id)
        : [...data.rockburstHorizonIds, id],
    });
  };

  const rockburstOn = data.hazards.includes("rockburst");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded shadow-xl flex flex-col"
        style={{ width: 620, maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-300 flex-shrink-0"
          style={{ background: "var(--c-s3, #f0f0f0)" }}>
          <div className="flex items-center gap-2">
            <Icon name="ShieldAlert" size={15} className="text-amber-600" />
            <span className="text-[12px] font-semibold text-gray-800">Данные ОПО</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <Icon name="X" size={15} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-4">

          {/* ── 1. Тип объекта и 2. класс опасности ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-600 block mb-1">Тип объекта</label>
              <div className="flex gap-1">
                {(["рудник", "шахта"] as const).map((k) => (
                  <button key={k} onClick={() => set({ kind: k })}
                    className="flex-1 py-1 text-[11px] rounded border transition-colors"
                    style={{
                      background: data.kind === k ? "var(--c-blue, #2563eb)" : "white",
                      color: data.kind === k ? "white" : "var(--c-t1, #1f1f1f)",
                      borderColor: data.kind === k ? "var(--c-blue, #1d4ed8)" : "#b8b8b8",
                      fontWeight: data.kind === k ? 600 : 400,
                      textTransform: "capitalize",
                    }}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] text-gray-600 block mb-1">Класс опасности ОПО</label>
              <select value={data.hazardClass}
                onChange={(e) => set({ hazardClass: e.target.value as OpoHazardClass })}
                className="w-full text-[11px] border border-gray-400 rounded px-1.5 py-1 bg-white">
                {(Object.keys(OPO_CLASS_LABELS) as OpoHazardClass[]).map((c) => (
                  <option key={c} value={c}>{OPO_CLASS_LABELS[c]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── 3. Опасен по ── */}
          <div>
            <div className="text-[11px] font-semibold text-gray-700 mb-1.5 pb-1 border-b border-gray-200">
              Опасен по
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {OPO_HAZARD_ORDER.map((h) => (
                <label key={h} className="flex items-center gap-1.5 cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded">
                  <input type="checkbox" checked={data.hazards.includes(h)}
                    onChange={() => toggleHazard(h)}
                    className="w-[13px] h-[13px] cursor-pointer"
                    style={{ accentColor: "#2563eb" }} />
                  <span className="text-[11px] text-gray-800">{OPO_HAZARD_LABELS[h]}</span>
                </label>
              ))}
            </div>

            {/* Горизонты, опасные по горным ударам */}
            {rockburstOn && (
              <div className="mt-2 ml-1 pl-2 border-l-2 border-amber-300">
                <div className="text-[10.5px] text-gray-600 mb-1">
                  Опасно по горным ударам с горизонта:
                </div>
                {horizons.length === 0 ? (
                  <div className="text-[10.5px] text-gray-400 italic py-1">
                    В проекте пока нет горизонтов — добавьте их на схеме.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-x-2 gap-y-0.5">
                    {horizons.map((hz) => (
                      <label key={hz.id}
                        className="flex items-center gap-1.5 cursor-pointer hover:bg-amber-50 px-1 py-0.5 rounded">
                        <input type="checkbox"
                          checked={data.rockburstHorizonIds.includes(hz.id)}
                          onChange={() => toggleHorizon(hz.id)}
                          className="w-[12px] h-[12px] cursor-pointer"
                          style={{ accentColor: "#d97706" }} />
                        <span className="w-2 h-2 rounded-sm flex-shrink-0"
                          style={{ background: hz.color }} />
                        <span className="text-[10.5px] text-gray-800 truncate" title={hz.name}>
                          {hz.name}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 4-6. Сводка по схеме ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1 pb-1 border-b border-gray-200">
              <Icon name="Calculator" size={12} className="text-green-600" />
              <span className="text-[11px] font-semibold text-gray-700">Сведения по схеме</span>
              <span className="text-[10px] text-gray-400 ml-auto">считается автоматически</span>
            </div>

            <div className="rounded px-2.5 py-1.5" style={{ background: "var(--c-s2, #fafafa)", border: "1px solid #e5e7eb" }}>
              <SummaryRow
                label="Протяжённость сети выработок"
                hint={`без вентрубопровода · выработок: ${summary.workingsCount}`}
                value={formatLengthM(summary.workingsLengthM)} />
              <div className="border-t border-gray-200" />
              <SummaryRow
                label="Протяжённость вентиляционного трубопровода"
                value={formatLengthM(summary.ventPipeLengthM)} />
              <div className="border-t border-gray-200" />
              <SummaryRow
                label="Вентиляционные перемычки"
                hint="двери, паруса, регуляторы, водоподпорные"
                value={`${summary.ventDevicesCount} шт.`} />
              <div className="border-t border-gray-200" />
              <SummaryRow
                label="Перемычки глухие"
                value={`${summary.solidBulkheadsCount} шт.`} />
            </div>

            {/* Расшифровка по видам — чтобы цифры можно было проверить */}
            {summary.byType.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {summary.byType.map((t) => (
                  <span key={t.type}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: t.type === "solid" ? "#dcfce7" : "#e0e7ff",
                      color: t.type === "solid" ? "#15803d" : "#3730a3",
                    }}>
                    {t.label}: {t.count}
                  </span>
                ))}
              </div>
            )}

            {summary.workingsCount === 0 && (
              <div className="mt-1.5 text-[10.5px] text-amber-700 flex items-start gap-1">
                <Icon name="Info" size={12} className="flex-shrink-0 mt-px" />
                <span>Схема пуста — показатели появятся после добавления выработок.</span>
              </div>
            )}
          </div>
        </div>

        {/* Низ */}
        <div className="flex justify-end px-3 py-2 border-t border-gray-300 flex-shrink-0"
          style={{ background: "var(--c-s3, #f0f0f0)" }}>
          <button onClick={onClose}
            className="px-4 py-1 text-[11px] rounded text-white"
            style={{ background: "var(--c-blue, #2563eb)" }}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
