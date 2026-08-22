import { useState, useRef } from "react";
import { parseVent2Cdf3, type Vent2Cdf3Result } from "@/lib/import/vent2Cdf3Import";
import Icon from "@/components/ui/icon";

interface Props {
  onImport: (result: Vent2Cdf3Result, mode: "replace" | "append") => void;
  onClose: () => void;
}

export default function Vent2Cdf3ImportDialog({ onImport, onClose }: Props) {
  const [result, setResult] = useState<Vent2Cdf3Result | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setError(null); setResult(null); setLoading(true); setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      setResult(parseVent2Cdf3(buf));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const ready = !!result && result.stats.branches > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto flex flex-col" style={{ border: "1.5px solid var(--c-b2, #d1d5db)" }}>

        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-200">
          <div className="text-[15px] font-bold text-gray-900">Импорт схемы из Вентиляции 2.0</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 rounded p-1"><Icon name="X" size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1">

          <div className="rounded-lg px-3 py-2.5 text-[11px] space-y-0.5" style={{ background: "var(--c-tint-green, #f0fdf4)", border: "1px solid #86efac" }}>
            <div className="font-semibold text-green-800 mb-1">Файл схемы .cdf3 — напрямую, без выгрузки в CSV</div>
            <div className="text-green-700">Переносятся: узлы с координатами, выработки, сечения, названия и выходы на поверхность</div>
            <div className="text-gray-500 text-[10px] mt-1">
              Сопротивление и расход в файле не хранятся — их рассчитает ПВ-Система
            </div>
          </div>

          <div
            className="border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors py-6"
            style={{ borderColor: fileName ? "var(--c-green-lt, #22c55e)" : "var(--c-b2, #d1d5db)", background: fileName ? "var(--c-tint-green, #f0fdf4)" : "var(--c-s2, #fafafa)" }}
            onClick={() => inputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
          >
            <Icon name={fileName ? "CheckCircle" : "FolderOpen"} size={28} style={{ color: fileName ? "var(--c-green-lt, #22c55e)" : "var(--c-t4, #9ca3af)" }} />
            <div className="mt-2 text-sm font-medium px-4 text-center" style={{ color: fileName ? "var(--c-green, #15803d)" : "var(--c-t3, #6b7280)" }}>
              {loading ? "Читаю схему…" : fileName ? `${fileName} — нажмите для замены` : "Перетащите файл .cdf3 или нажмите для выбора"}
            </div>
            <input ref={inputRef} type="file" accept=".cdf3" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {error && (
            <div className="rounded border border-red-300 px-3 py-2 text-xs text-red-700 bg-red-50 flex items-start gap-2">
              <Icon name="AlertCircle" size={14} className="mt-0.5 shrink-0" />{error}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Узлов",     value: result.stats.nodes,      hi: result.stats.nodes > 0,      bad: false },
                  { label: "Выработок", value: result.stats.branches,   hi: result.stats.branches > 0,   bad: false },
                  { label: "Горизонтов", value: result.stats.layers,    hi: result.stats.layers > 0,     bad: false },
                  { label: "Перемычек", value: result.stats.bulkheads, hi: result.stats.bulkheads > 0,  bad: false },
                  { label: "На поверхность", value: result.stats.atmosphere, hi: result.stats.atmosphere > 0, bad: result.stats.atmosphere === 0 },
                  {
                    label: result.stats.parts > 1 ? "Частей" : "Сеть цельная",
                    value: result.stats.parts,
                    hi: result.stats.parts === 1,
                    bad: result.stats.parts > 1,
                  },
                ].map(s => (
                  <div key={s.label} className="rounded px-2 py-2 text-center border"
                    style={{
                      background: s.bad ? "#fef2f2" : s.hi ? "var(--c-tint-green2, #dcfce7)" : "var(--c-s2, #f9f9f9)",
                      borderColor: s.bad ? "#fca5a5" : s.hi ? "#86efac" : "var(--c-b1, #e0e0e0)",
                    }}>
                    <div className="text-xl font-bold" style={{ color: s.bad ? "var(--c-red, #b91c1c)" : s.hi ? "var(--c-green, #15803d)" : "var(--c-t3, #6b7280)" }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500 leading-tight">{s.label}</div>
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
                {showDebug ? "Скрыть подробности" : "Показать подробности чтения"}
              </button>
              {showDebug && <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">{result.debug}</pre>}

              <div className="border rounded px-3 py-2 space-y-1.5" style={{ background: "var(--c-s2, #f9f9f9)" }}>
                <div className="text-[11px] font-semibold text-gray-700">Способ добавления:</div>
                {(["replace", "append"] as const).map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="cdf3mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="w-3 h-3" />
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
            onClick={() => result && onImport(result, mode)}
            disabled={!ready}
            className="px-5 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors"
            style={{ background: ready ? "var(--c-green, #16a34a)" : "#9ca3af", cursor: ready ? "pointer" : "not-allowed" }}
          >
            {result ? `Импортировать (${result.stats.branches} выработок)` : "Выберите файл"}
          </button>
        </div>
      </div>
    </div>
  );
}