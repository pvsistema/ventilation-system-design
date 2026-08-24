import { useState, useRef } from "react";
import { parseErp, type ErpImportResult, type ErpResistanceUnit } from "@/lib/erpImport";
import Icon from "@/components/ui/icon";

interface Props {
  onImport: (result: ErpImportResult, mode: "replace" | "append") => void;
  onClose: () => void;
}

export default function ErpImportDialog({ onImport, onClose }: Props) {
  const [result, setResult] = useState<ErpImportResult | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  // Единицы сопротивления в файле. Обычно АэроСеть пишет кМюрг, но проект
  // могли перевести в СИ — тогда числа больше в 9,81 раза. По умолчанию
  // определяем сами, пользователь может переопределить.
  const [rUnit, setRUnit] = useState<ErpResistanceUnit>("auto");
  // Переносить ли перемычки. Иногда нужна «чистая» схема выработок без
  // вентиляционных сооружений — тогда галочку снимают.
  const [withBulkheads, setWithBulkheads] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  // Файл держим в памяти, чтобы перечитать его при смене единиц без
  // повторного выбора на диске.
  const bufRef = useRef<ArrayBuffer | null>(null);

  const runParse = async (buf: ArrayBuffer, unit: ErpResistanceUnit) => {
    setError(null); setResult(null); setLoading(true);
    try {
      setResult(await parseErp(buf, { resistanceUnit: unit }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (f: File) => {
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    bufRef.current = buf;
    await runParse(buf, rUnit);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const ready = !!result && result.stats.branches > 0;

  // Если перемычки переносить не нужно — снимаем их с выработок ещё до
  // передачи в схему: тогда ни значков, ни сопротивления в расчёте не будет.
  const applyOptions = (r: ErpImportResult): ErpImportResult => {
    if (withBulkheads) return r;
    return {
      ...r,
      branches: r.branches.map(b => b.hasBulkhead
        ? { ...b, hasBulkhead: false, bulkheadName: "", bulkheadR: 0, bulkheadManualR: 0, bulkheadResMode: "project" as const, bulkheadSurveyQ: 0 }
        : b),
      stats: { ...r.stats, bulkheads: 0 },
    };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto flex flex-col" style={{ border: "1.5px solid var(--c-b2, #d1d5db)" }}>

        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-200">
          <div className="text-[15px] font-bold text-gray-900">Импорт проекта АэроСеть (.erp)</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 rounded p-1"><Icon name="X" size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1">

          <div className="rounded-lg px-3 py-2.5 text-[11px] space-y-0.5" style={{ background: "var(--c-tint-green, #f0fdf4)", border: "1px solid #86efac" }}>
            <div className="font-semibold text-green-800 mb-1">Что переносится из файла:</div>
            <div className="text-green-700">Узлы с отметками, выработки, сечения и периметры</div>
            <div className="text-green-700">Сопротивления, расходы воздуха, слои-горизонты</div>
            <div className="text-green-700">Вентиляторы и перемычки</div>
            <div className="text-green-700">Позиции ПЛА: номера, цвета, выноски и выработки</div>
            <div className="text-gray-500 text-[10px] mt-1">Файл проекта АэроСети целиком — выгружать ничего не нужно</div>
          </div>

          <div
            className="border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors py-6"
            style={{ borderColor: fileName ? "var(--c-green-lt, #22c55e)" : "var(--c-b2, #d1d5db)", background: fileName ? "var(--c-tint-green, #f0fdf4)" : "var(--c-s2, #fafafa)" }}
            onClick={() => inputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
          >
            <Icon name={fileName ? "CheckCircle" : "FolderOpen"} size={28} style={{ color: fileName ? "var(--c-green-lt, #22c55e)" : "var(--c-t4, #9ca3af)" }} />
            <div className="mt-2 text-sm font-medium text-center px-3" style={{ color: fileName ? "var(--c-green, #15803d)" : "var(--c-t3, #6b7280)" }}>
              {loading ? "Читаю проект…" : fileName ? `${fileName} — нажмите для замены` : "Перетащите файл .erp или нажмите для выбора"}
            </div>
            <input ref={inputRef} type="file" accept=".erp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {/* Единицы сопротивления выработок */}
          <div className="text-[11px] text-gray-700">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-medium">Единицы R в файле:</span>
              {(["auto", "kmu", "si"] as const).map(u => (
                <label key={u} className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name="erp-runit" value={u} checked={rUnit === u}
                    onChange={() => {
                      setRUnit(u);
                      if (bufRef.current) runParse(bufRef.current, u);
                    }} />
                  {u === "auto" ? "Авто (рекомендуется)" : u === "kmu" ? "кМюрг" : "Н·с²/м⁸ (СИ)"}
                </label>
              ))}
            </div>
            {result && (
              <div className="mt-1 px-2 py-0.5 rounded text-[10px] inline-block"
                style={{ background: "var(--c-tint-blue2, #dbeafe)", color: "var(--c-blue-ink, #1e40af)" }}>
                {result.resistanceUnit === "si"
                  ? "СИ — сопротивления пересчитаны в кМюрг (÷9,81)"
                  : "кМюрг — сопротивления перенесены без пересчёта"}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded border border-red-300 px-3 py-2 text-xs text-red-700 bg-red-50 flex items-start gap-2">
              <Icon name="AlertCircle" size={14} className="mt-0.5 shrink-0" />{error}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { label: "Узлов", value: result.stats.nodes },
                  { label: "Ветвей", value: result.stats.branches },
                  { label: "Гориз.", value: result.stats.horizons },
                  { label: "Вент.", value: result.stats.fans },
                  { label: "Перем.", value: result.stats.bulkheads },
                  { label: "Позиций", value: result.stats.positions },
                ].map(s => (
                  <div key={s.label} className="rounded px-1 py-2 text-center border"
                    style={{ background: s.value > 0 ? "var(--c-tint-green2, #dcfce7)" : "var(--c-s2, #f9f9f9)", borderColor: s.value > 0 ? "#86efac" : "var(--c-b1, #e0e0e0)" }}>
                    <div className="text-lg font-bold" style={{ color: s.value > 0 ? "var(--c-green, #15803d)" : "var(--c-t3, #6b7280)" }}>{s.value}</div>
                    <div className="text-[9px] text-gray-500">{s.label}</div>
                  </div>
                ))}
              </div>

              {result.warnings.length > 0 && (
                <div className="rounded border border-yellow-300 px-3 py-2 space-y-1" style={{ background: "var(--c-tint-amber, #fffbeb)" }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-800">
                      <Icon name="AlertTriangle" size={12} className="mt-0.5 shrink-0" /><span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setShowDebug(v => !v)} className="text-[11px] text-blue-600 underline">
                {showDebug ? "Скрыть лог" : "Показать лог разбора"}
              </button>
              {showDebug && <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">{result.debug}</pre>}

              <div className="border rounded px-3 py-2" style={{ background: "var(--c-s2, #f9f9f9)" }}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={withBulkheads} onChange={e => setWithBulkheads(e.target.checked)} className="w-3 h-3 mt-0.5" />
                  <div>
                    <div className="text-xs text-gray-800">Переносить перемычки{result.stats.bulkheads > 0 ? ` (${result.stats.bulkheads})` : ""}</div>
                    <div className="text-[10px] text-gray-500">Снимите, чтобы получить схему выработок без вентиляционных сооружений</div>
                  </div>
                </label>
              </div>

              <div className="border rounded px-3 py-2 space-y-1.5" style={{ background: "var(--c-s2, #f9f9f9)" }}>
                <div className="text-[11px] font-semibold text-gray-700">Способ добавления:</div>
                {(["replace", "append"] as const).map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="erpmode" value={m} checked={mode === m} onChange={() => setMode(m)} className="w-3 h-3" />
                    <div className="text-xs text-gray-800">{m === "replace" ? "Заменить текущую схему" : "Добавить к текущей"}</div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center px-5 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-200">Отмена</button>
          <button
            onClick={() => result && onImport(applyOptions(result), mode)}
            disabled={!ready}
            className="px-5 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors"
            style={{ background: ready ? "var(--c-green, #16a34a)" : "#9ca3af", cursor: ready ? "pointer" : "not-allowed" }}
          >
            {result ? `Импортировать (${result.stats.branches} ветвей)` : "Выберите файл"}
          </button>
        </div>
      </div>
    </div>
  );
}