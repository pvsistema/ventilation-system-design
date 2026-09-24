// ─────────────────────────────────────────────────────────────────────────────
// Окно выгрузки таблицы параметров в Excel (.xlsx).
//
// Оформлено в едином стиле окон программы (переменные темы --c-*): слева —
// что выгружаем (выработки / узлы), горизонт и готовый шаблон столбцов;
// справа — сами столбцы, сгруппированные по смыслу, с поиском и счётчиками.
// Запись файла живёт в lib/excelExport.ts — окно только собирает настройки.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode, Horizon } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import type { UnitsConfig } from "@/lib/unitsConfig";
import type { VentNorms } from "@/lib/ventSections";
import {
  BRANCH_COLUMNS,
  NODE_COLUMNS,
  BRANCH_PRESETS,
  NODE_PRESETS,
  PRESET_ROW_FILTER,
  columnLabel,
  cleanText,
  countRows,
  exportToExcel,
  type ExportAreaId,
  type ExportType,
  type ExportPreset,
} from "@/lib/excelExport";

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  horizons: Horizon[];
  projectName?: string;
  /** Единицы проекта — те же, что на схеме и в панели свойств. */
  unitsConfig?: UnitsConfig;
  /** Нормы ФНиП — для допустимых скоростей. */
  ventNorms?: VentNorms;
  /** Значки схемы: перемычки и замерные станции. */
  schemaSymbols?: SchemaSymbol[];
  /** Сопротивление вентсооружений по ветвям, кМюрг. */
  bulkheadRByBranch?: Map<string, number>;
  onClose: () => void;
}

/** Шаблоны столбцов: короткое имя, пояснение и иконка. */
const TEMPLATES: Record<ExportPreset, { title: string; hint: string; icon: string }> = {
  all:         { title: "Полная таблица",        hint: "Все доступные столбцы",                          icon: "Table" },
  main_vent:   { title: "Модель сети",           hint: "Геометрия, сопротивления, расход, депрессия",   icon: "Network" },
  flows:       { title: "Расходы воздуха",       hint: "Расход и скорость по выработкам",                icon: "Wind" },
  depressions: { title: "Депрессии",             hint: "Сопротивления и депрессии с вентсооружениями",   icon: "Gauge" },
  speed_check: { title: "Проверка скоростей",    hint: "Скорость против норм ФНиП и vmax ветви",         icon: "ShieldCheck" },
  objects:     { title: "Оборудование",          hint: "Только выработки с перемычками, вентиляторами, замерными станциями", icon: "Box" },
  fire:        { title: "Пожар",                 hint: "Пожарная нагрузка и результаты расчёта пожара", icon: "Flame" },
  pipes:       { title: "Трубопроводы",          hint: "Только выработки с вентставом или водопроводом", icon: "Droplets" },
  node_coords: { title: "Координаты",            hint: "Номер, атмосфера, X / Y / Z",                    icon: "MapPin" },
  node_air:    { title: "Параметры воздуха",     hint: "Давление, температура, влажность, газы",         icon: "Thermometer" },
  custom:      { title: "Свой набор",            hint: "Столбцы отмечены вручную",                       icon: "SlidersHorizontal" },
};

const BRANCH_TEMPLATE_ORDER: ExportPreset[] =
  ["all", "main_vent", "flows", "depressions", "speed_check", "objects", "fire", "pipes", "custom"];
const NODE_TEMPLATE_ORDER: ExportPreset[] = ["all", "node_coords", "node_air", "custom"];

export default function ExcelExportDialog({
  branches, nodes, horizons, projectName = "ПВ-Система",
  unitsConfig, ventNorms, schemaSymbols, bulkheadRByBranch, onClose,
}: Props) {
  const [areaId, setAreaId] = useState<ExportAreaId>("all");
  const [type, setType]     = useState<ExportType>("branches");
  const [preset, setPreset] = useState<ExportPreset>("all");
  const [keys, setKeys]     = useState<Set<string>>(() => new Set(BRANCH_COLUMNS.map(c => c.key)));
  const [query, setQuery]   = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const allColumns = type === "branches" ? BRANCH_COLUMNS : NODE_COLUMNS;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, typeof allColumns>();
    allColumns.forEach(c => {
      if (q && !columnLabel(c, unitsConfig).toLowerCase().includes(q) && !c.group.toLowerCase().includes(q)) return;
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    });
    return map;
  }, [allColumns, query, unitsConfig]);

  // Шаблоны «Оборудование» и «Трубопроводы» выгружают только «свои» выработки.
  // Фильтр живёт, пока шаблон выбран; при ручной правке столбцов он остаётся.
  const [rowFilter, setRowFilter] = useState<ExportPreset | undefined>(undefined);

  const rowCount = useMemo(() => countRows({
    areaId, type, branches, nodes, horizons,
    units: unitsConfig, norms: ventNorms, symbols: schemaSymbols, bulkheadRByBranch,
    rowFilter: type === "branches" ? rowFilter : undefined,
  }), [areaId, type, branches, nodes, horizons, unitsConfig, ventNorms, schemaSymbols, bulkheadRByBranch, rowFilter]);

  const presetsFor = (t: ExportType) => (t === "branches" ? BRANCH_PRESETS : NODE_PRESETS);

  function applyPreset(p: ExportPreset) {
    setPreset(p);
    if (p === "custom") return;
    if (p === "all") setKeys(new Set(allColumns.map(c => c.key)));
    else setKeys(new Set(presetsFor(type)[p] ?? []));
    setRowFilter(PRESET_ROW_FILTER[p] ? p : undefined);
  }

  function changeType(t: ExportType) {
    if (t === type) return;
    setType(t);
    setPreset("all");
    setRowFilter(undefined);
    setQuery("");
    setCollapsed(new Set());
    setKeys(new Set((t === "branches" ? BRANCH_COLUMNS : NODE_COLUMNS).map(c => c.key)));
  }

  function toggleKey(key: string) {
    setKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setPreset("custom");
  }

  function toggleGroup(groupKeys: string[]) {
    const allOn = groupKeys.every(k => keys.has(k));
    setKeys(prev => {
      const next = new Set(prev);
      groupKeys.forEach(k => (allOn ? next.delete(k) : next.add(k)));
      return next;
    });
    setPreset("custom");
  }

  function toggleCollapse(g: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }

  const selectedCount = keys.size;
  const ready = selectedCount > 0 && rowCount > 0 && !busy;

  async function handleExport() {
    if (!ready) return;
    setBusy(true);
    try {
      await exportToExcel({
        areaId,
        type,
        // Порядок столбцов — как в справочнике, а не как кликал пользователь.
        selectedKeys: allColumns.filter(c => keys.has(c.key)).map(c => c.key),
        branches, nodes, horizons, projectName,
        units: unitsConfig, norms: ventNorms, symbols: schemaSymbols, bulkheadRByBranch,
        rowFilter: type === "branches" ? rowFilter : undefined,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const templateOrder = type === "branches" ? BRANCH_TEMPLATE_ORDER : NODE_TEMPLATE_ORDER;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 780, maxWidth: "96vw", height: "min(640px, 90vh)",
          background: "var(--c-s1, #fff)", border: "1.5px solid var(--c-b2, #d1d5db)" }}>

        {/* ── Шапка ── */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3"
          style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--c-tint-green, #f0fdf4)", border: "1px solid #86efac" }}>
            <Icon name="FileSpreadsheet" size={19} style={{ color: "var(--c-green, #15803d)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold" style={{ color: "var(--c-t1, #111827)" }}>Выгрузка таблицы в Excel</div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>
              Файл .xlsx с закреплённой шапкой и автофильтром — проект «{projectName}»
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-black/5" style={{ color: "var(--c-t4, #9ca3af)" }}>
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* ── Левая колонка: что и откуда ── */}
          <div className="flex flex-col gap-4 px-4 py-4 overflow-y-auto shrink-0"
            style={{ width: 270, background: "var(--c-s2, #f9fafb)", borderRight: "1px solid var(--c-b1, #e5e7eb)" }}>

            {/* Объект выгрузки */}
            <div>
              <SectionTitle>Что выгружать</SectionTitle>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { t: "branches" as const, label: "Выработки", icon: "GitCommitHorizontal", count: branches.length },
                  { t: "nodes" as const,    label: "Узлы",      icon: "CircleDot",           count: nodes.length },
                ]).map(o => {
                  const on = type === o.t;
                  return (
                    <button key={o.t} onClick={() => changeType(o.t)}
                      className="rounded-lg px-2 py-2 text-left transition-colors"
                      style={{
                        background: on ? "var(--c-tint-blue, #eef5f8)" : "var(--c-s1, #fff)",
                        border: `1.5px solid ${on ? "var(--c-accent, #1e5a7a)" : "var(--c-b2, #d1d5db)"}`,
                      }}>
                      <Icon name={o.icon} size={15} style={{ color: on ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)" }} />
                      <div className="text-[12px] font-semibold mt-1" style={{ color: "var(--c-t1, #111827)" }}>{o.label}</div>
                      <div className="text-[10px]" style={{ color: "var(--c-t4, #9ca3af)" }}>{o.count} шт.</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Горизонт */}
            {(
              <div>
                <SectionTitle>Горизонт</SectionTitle>
                <select value={areaId} onChange={e => setAreaId(e.target.value as ExportAreaId)}
                  className="w-full text-[12px] rounded-md px-2 py-1.5 outline-none"
                  style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d1d5db)", color: "var(--c-t2, #374151)" }}>
                  <option value="all">Вся схема</option>
                  {horizons.map(h => <option key={h.id} value={h.id}>{cleanText(h.name) || "(без названия)"}</option>)}
                </select>
                {type === "nodes" && areaId !== "all" && (
                  <div className="text-[10px] mt-1 leading-snug" style={{ color: "var(--c-t4, #9ca3af)" }}>
                    Узлы, в которые входят выработки горизонта
                  </div>
                )}
              </div>
            )}

            {/* Шаблоны */}
            <div>
              <SectionTitle>Шаблон столбцов</SectionTitle>
              <div className="flex flex-col gap-1">
                {templateOrder.map(p => {
                  const t = TEMPLATES[p];
                  const on = preset === p;
                  const n = p === "all" ? allColumns.length : p === "custom" ? null : (presetsFor(type)[p]?.length ?? 0);
                  return (
                    <button key={p} onClick={() => applyPreset(p)}
                      disabled={p === "custom" && !on}
                      className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/[0.03] disabled:cursor-default"
                      style={{
                        background: on ? "var(--c-tint-blue, #eef5f8)" : "transparent",
                        border: `1px solid ${on ? "var(--c-tint-blue2, #d7e7ee)" : "transparent"}`,
                        opacity: p === "custom" && !on ? 0.55 : 1,
                      }}>
                      <Icon name={t.icon} size={14} className="mt-0.5 shrink-0"
                        style={{ color: on ? "var(--c-accent, #1e5a7a)" : "var(--c-t4, #9ca3af)" }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] leading-tight"
                          style={{ color: "var(--c-t1, #111827)", fontWeight: on ? 600 : 400 }}>{t.title}</div>
                        <div className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--c-t4, #9ca3af)" }}>{t.hint}</div>
                      </div>
                      {n !== null && (
                        <span className="text-[10px] tabular-nums mt-0.5" style={{ color: "var(--c-t4, #9ca3af)" }}>{n}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Правая колонка: столбцы таблицы ── */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)" }}>
              <div className="flex-1 flex items-center gap-1.5 rounded-md px-2 py-1"
                style={{ background: "var(--c-s2, #f9fafb)", border: "1px solid var(--c-b2, #d1d5db)" }}>
                <Icon name="Search" size={13} style={{ color: "var(--c-t4, #9ca3af)" }} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти столбец…"
                  className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: "var(--c-t2, #374151)" }} />
                {query && (
                  <button onClick={() => setQuery("")} style={{ color: "var(--c-t4, #9ca3af)" }}>
                    <Icon name="X" size={12} />
                  </button>
                )}
              </div>
              <button onClick={() => applyPreset("all")}
                className="text-[11px] px-2 py-1 rounded hover:bg-black/5" style={{ color: "var(--c-accent, #1e5a7a)" }}>
                Все
              </button>
              <button onClick={() => { setKeys(new Set()); setPreset("custom"); }}
                className="text-[11px] px-2 py-1 rounded hover:bg-black/5" style={{ color: "var(--c-t3, #6b7280)" }}>
                Сбросить
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {groups.size === 0 && (
                <div className="text-[12px] text-center py-8" style={{ color: "var(--c-t4, #9ca3af)" }}>
                  Столбцов по запросу «{query}» нет
                </div>
              )}
              {Array.from(groups.entries()).map(([groupName, cols]) => {
                const groupKeys = cols.map(c => c.key);
                const onCount = groupKeys.filter(k => keys.has(k)).length;
                const allOn = onCount === groupKeys.length;
                const isOpen = !collapsed.has(groupName) || !!query;
                return (
                  <div key={groupName} className="rounded-lg overflow-hidden"
                    style={{ border: "1px solid var(--c-b1, #e5e7eb)" }}>
                    <div className="flex items-center gap-2 px-2.5 py-1.5 select-none"
                      style={{ background: "var(--c-s3, #f3f4f6)" }}>
                      <button onClick={() => toggleCollapse(groupName)} style={{ color: "var(--c-t3, #6b7280)" }}>
                        <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} size={14} />
                      </button>
                      <input type="checkbox" checked={allOn}
                        ref={el => { if (el) el.indeterminate = !allOn && onCount > 0; }}
                        onChange={() => toggleGroup(groupKeys)}
                        className="w-3.5 h-3.5 cursor-pointer" style={{ accentColor: "var(--c-accent, #1e5a7a)" }} />
                      <span className="flex-1 text-[12px] font-semibold cursor-pointer"
                        style={{ color: "var(--c-t1, #111827)" }} onClick={() => toggleCollapse(groupName)}>
                        {groupName}
                      </span>
                      <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full"
                        style={{
                          background: onCount ? "var(--c-tint-blue2, #d7e7ee)" : "transparent",
                          color: onCount ? "var(--c-accent-ink, #173d52)" : "var(--c-t4, #9ca3af)",
                        }}>
                        {onCount}/{groupKeys.length}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="grid grid-cols-2 gap-x-3 px-2.5 py-1.5">
                        {cols.map(col => (
                          <label key={col.key} title={col.hint}
                            className="flex items-start gap-2 py-1 px-1 rounded cursor-pointer hover:bg-black/[0.03]">
                            <input type="checkbox" checked={keys.has(col.key)} onChange={() => toggleKey(col.key)}
                              className="w-3.5 h-3.5 mt-px shrink-0 cursor-pointer"
                              style={{ accentColor: "var(--c-accent, #1e5a7a)" }} />
                            <span className="text-[11.5px] leading-snug" style={{ color: "var(--c-t2, #374151)" }}>
                              {columnLabel(col, unitsConfig)}
                              {col.hint && (
                                <span className="block text-[10px] leading-tight" style={{ color: "var(--c-t4, #9ca3af)" }}>{col.hint}</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Подвал ── */}
        <div className="flex items-center gap-3 px-5 py-3"
          style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)", background: "var(--c-s2, #f9fafb)" }}>
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded hover:bg-black/5"
            style={{ color: "var(--c-t3, #6b7280)" }}>
            Отмена
          </button>
          <div className="flex-1 text-[11px] text-right" style={{ color: "var(--c-t4, #9ca3af)" }}>
            {rowCount === 0
              ? (rowFilter ? "Нет выработок для этого шаблона" : type === "branches" ? "На выбранном горизонте нет выработок" : "Нет узлов")
              : selectedCount === 0
                ? "Отметьте хотя бы один столбец"
                : `${rowCount} строк × ${selectedCount} столбцов`}
          </div>
          <button onClick={handleExport} disabled={!ready}
            className="flex items-center gap-1.5 px-5 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors"
            style={{ background: ready ? "var(--c-green, #15803d)" : "#9ca3af", cursor: ready ? "pointer" : "not-allowed" }}>
            <Icon name={busy ? "Loader2" : "Download"} size={14} className={busy ? "animate-spin" : undefined} />
            Выгрузить .xlsx
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--c-t3, #6b7280)" }}>
      {children}
    </div>
  );
}
