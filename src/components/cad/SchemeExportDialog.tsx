// ─────────────────────────────────────────────────────────────────────────────
// Окно параметров выгрузки схемы в чужой формат: АэроСеть (.erp),
// Вентиляция 2.0 (.cdf3) и Вентиляция 2.0 «Водоснабжение» (.hdr).
//
// Зачем: раньше оба экспорта срабатывали сразу по нажатию пункта меню и всегда
// выгружали всё. Иногда нужна «чистая» схема — только выработки, без
// вентиляционных сооружений и позиций ПЛА. Здесь пользователь отмечает, что
// именно перенести, и сразу видит, сколько таких объектов в схеме.
//
// Само окно НИЧЕГО не пишет в файл: оно только собирает набор объектов и
// отдаёт его наружу. Запись форматов живёт в erpExport.ts, vent2Cdf3Export.ts
// и vent2HdrExport.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Icon from "@/components/ui/icon";
import type { TopoNode, TopoBranch, Horizon } from "@/lib/topology";
import type { Position } from "@/lib/positions";

/** Какой формат выгружаем. */
export type SchemeExportFormat = "erp" | "cdf3" | "hdr";

/** Отмеченные пользователем разделы схемы. */
export interface SchemeExportOptions {
  fans: boolean;
  bulkheads: boolean;
  positions: boolean;
  horizons: boolean;
  /** Расходы и сопротивления выработок — только для .erp. */
  results: boolean;
  /** Задвижки, клапаны, потребители и резервуары — только для .hdr. */
  water: boolean;
  /** Выгрузить только выработки с трубопроводом ППЗ — только для .hdr. */
  onlyPipes: boolean;
}

interface Props {
  format: SchemeExportFormat;
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  positions: Position[];
  onExport: (opts: SchemeExportOptions) => void;
  onClose: () => void;
}

/** Описание формата: как называется и что вообще умеет хранить. */
const FORMATS = {
  erp: {
    title: "Экспорт в АэроСеть (.erp)",
    subtitle: "Родной формат проекта АэроСети",
    note: "Файл открывается в АэроСети напрямую — выгружать промежуточные таблицы не нужно.",
    supports: { fans: true, bulkheads: true, positions: true, horizons: true, results: true, water: false },
  },
  cdf3: {
    title: "Экспорт в Вентиляцию 2.0 (.cdf3)",
    subtitle: "Файл схемы ПО «Вентиляция 2.0»",
    note: "Формат хранит только схему: сопротивления и расходы выработок, напоры вентиляторов и позиции ПЛА в нём не предусмотрены — для них служит экспорт в CSV.",
    supports: { fans: false, bulkheads: true, positions: false, horizons: true, results: false, water: false },
  },
  hdr: {
    title: "Экспорт водоснабжения в Вентиляцию 2.0 (.hdr)",
    subtitle: "Файл схемы водоснабжения (ППЗ) ПО «Вентиляция 2.0»",
    note: "Переносятся трубопроводы ППЗ с диаметрами, задвижки, редукционные клапаны, пожарные краны и резервуары. Давления в формате не хранятся — «Вентиляция 2.0» рассчитает их сама.",
    supports: { fans: false, bulkheads: false, positions: false, horizons: true, results: true, water: true },
  },
} as const;

export default function SchemeExportDialog(p: Props) {
  const f = FORMATS[p.format];
  const [opts, setOpts] = useState<SchemeExportOptions>({
    fans: true, bulkheads: true, positions: true, horizons: true, results: true,
    water: true, onlyPipes: false,
  });

  const fanCount = p.branches.filter(b => b.hasFan).length;
  const bulkCount = p.branches.filter(b => b.hasBulkhead).length;
  const flowCount = p.branches.filter(b => (b.flow ?? 0) !== 0).length;
  const pipeCount = p.branches.filter(b => b.hasWaterPipe).length;
  const waterCount =
    p.branches.filter(b => b.hasWaterPipe && b.wpHasGate).length +
    p.branches.filter(b => b.hasWaterPipe && b.wpHasReducer).length +
    p.nodes.filter(n => n.fireNodeType === "consumer" || n.fireNodeType === "reservoir").length;
  const isHdr = p.format === "hdr";

  const set = (k: keyof SchemeExportOptions) => (v: boolean) => setOpts(o => ({ ...o, [k]: v }));

  // Разделы, которые формат в принципе умеет хранить. Остальные показываем
  // отключёнными с пояснением — так видно, что данные не потерялись молча.
  const rows: Array<{
    key: keyof SchemeExportOptions; label: string; count: number; hint: string; supported: boolean;
  }> = [
    { key: "fans", label: "Вентиляторы", count: fanCount, supported: f.supports.fans,
      hint: f.supports.fans ? "Напор, КПД, обороты и число параллельных машин" : "Формат не хранит напор вентиляторов" },
    { key: "bulkheads", label: "Перемычки", count: bulkCount, supported: f.supports.bulkheads,
      hint: "Вентиляционные сооружения и их сопротивление" },
    { key: "positions", label: "Позиции ПЛА", count: p.positions.length, supported: f.supports.positions,
      hint: f.supports.positions ? "Номера, цвета, привязка к выработкам" : "Формат не хранит позиции ПЛА" },
    { key: "horizons", label: "Горизонты", count: p.horizons.length, supported: f.supports.horizons,
      hint: "Названия слоёв-горизонтов у выработок" },
    { key: "results", label: "Результаты расчёта", count: flowCount, supported: f.supports.results,
      hint: f.supports.results ? "Расходы воздуха и заданные вручную сопротивления" : "Формат не хранит расходы и сопротивления" },
  ];
  const visibleRows = isHdr
    ? [
        { key: "water" as const, label: "Оборудование водопровода", count: waterCount, supported: true,
          hint: "Задвижки, редукционные клапаны, пожарные краны и резервуары" },
        { key: "horizons" as const, label: "Горизонты", count: p.horizons.length, supported: true,
          hint: "Названия слоёв-горизонтов у выработок" },
        { key: "results" as const, label: "Расходы воздуха", count: flowCount, supported: true,
          hint: "Расчётный расход воздуха выработок" },
      ]
    : rows;

  const ready = p.branches.length > 0;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-[470px] max-h-[90vh] overflow-y-auto flex flex-col"
        style={{ border: "1.5px solid var(--c-b2, #d1d5db)" }}>

        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-200">
          <div>
            <div className="text-[15px] font-bold text-gray-900">{f.title}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{f.subtitle}</div>
          </div>
          <button onClick={p.onClose} className="text-gray-400 hover:text-gray-700 rounded p-1">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1">

          {/* Что уходит в файл всегда */}
          <div className="rounded-lg px-3 py-2.5 text-[11px] space-y-0.5"
            style={{ background: "var(--c-tint-green, #f0fdf4)", border: "1px solid #86efac" }}>
            <div className="font-semibold text-green-800 mb-1">Переносится всегда:</div>
            <div className="text-green-700">Узлы ({p.nodes.length}) с координатами и отметками</div>
            <div className="text-green-700">Выработки ({p.branches.length}): связи, длины, сечения и названия</div>
            <div className="text-green-700">Выходы на поверхность</div>
            {isHdr && <div className="text-green-700">Трубопроводы ППЗ ({pipeCount}) с диаметрами — на своих выработках; выработки без трубы тоже выгружаются</div>}
          </div>

          {/* Выбор разделов */}
          <div className="border rounded px-3 py-2 space-y-1.5" style={{ background: "var(--c-s2, #f9f9f9)" }}>
            <div className="text-[11px] font-semibold text-gray-700">Что переносить:</div>
            {visibleRows.map(r => (
              <label key={r.key}
                className={`flex items-start gap-2 ${r.supported ? "cursor-pointer" : "opacity-45"}`}>
                <input type="checkbox" className="w-3 h-3 mt-0.5"
                  checked={r.supported && opts[r.key]}
                  disabled={!r.supported}
                  onChange={e => set(r.key)(e.target.checked)} />
                <div>
                  <div className="text-xs text-gray-800">
                    {r.label}{r.supported && r.count > 0 ? ` (${r.count})` : ""}
                  </div>
                  <div className="text-[10px] text-gray-500">{r.hint}</div>
                </div>
              </label>
            ))}
          </div>

          {/* Особенности формата */}
          <div className="rounded border px-3 py-2 flex items-start gap-2"
            style={{ background: "var(--c-tint-amber, #fffbeb)", borderColor: "#fcd34d" }}>
            <Icon name="Info" size={13} className="mt-0.5 shrink-0 text-amber-700" />
            <div className="text-[11px] text-amber-800 leading-relaxed">{f.note}</div>
          </div>

          {!ready && (
            <div className="rounded border border-red-300 px-3 py-2 text-xs text-red-700 bg-red-50 flex items-start gap-2">
              <Icon name="AlertCircle" size={14} className="mt-0.5 shrink-0" />
              Схема пуста — выгружать нечего.
            </div>
          )}
        </div>

        <div className="flex justify-between items-center px-5 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={p.onClose} className="px-4 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-200">
            Отмена
          </button>
          <button
            onClick={() => ready && p.onExport(opts)}
            disabled={!ready}
            className="px-5 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors"
            style={{ background: ready ? "var(--c-green, #16a34a)" : "#9ca3af", cursor: ready ? "pointer" : "not-allowed" }}>
            {ready
              ? `Выгрузить (${p.branches.length} выработок)`
              : "Схема пуста"}
          </button>
        </div>
      </div>
    </div>
  );
}
