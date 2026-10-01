// ─────────────────────────────────────────────────────────────────────────────
// InspectionRoutesPanel.tsx — вкладка «Маршруты профилактического обследования
// (МПО)». Работа устроена как у позиций ПЛА: список карточек, привязка
// выработок кликом по схеме. Для маршрута считаются длина и время обхода
// (нормативные скорости горноспасателя/горнорабочего), по галочке добавляется
// время на обследование пожарных кранов.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import Icon from "@/components/ui/icon";
import {
  type InspectionRoute, type InspectionSpeedMode, makeInspectionRoute, calcInspectionRoute,
  INSPECTION_SPEED_MODES, ROUTE_COLORS, fmtMinutes, fmtLength, normalizeSpeedMode,
} from "@/lib/inspectionRoutes";

interface BranchLite {
  id: string; fromId: string; toId: string; length: number; angle: number; type?: string; name?: string;
}
interface NodeLite {
  id: string; name?: string; number?: string; x?: number; y?: number; z?: number;
  fireNodeType?: string; fireConsumerType?: string;
}
interface SymbolLite { typeId: string; branchId: string | null }

interface Props {
  routes: InspectionRoute[];
  branches: BranchLite[];
  nodes: NodeLite[];
  symbols: SymbolLite[];
  selectedRouteId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (r: InspectionRoute) => void;
  onUpdate: (id: string, patch: Partial<InspectionRoute>) => void;
  onDelete: (id: string) => void;
  bindMode: boolean;
  onToggleBind: () => void;
  onFocusBranch?: (branchId: string) => void;
  projectName?: string;
  /** Режим «только маршруты»: на схеме видны лишь выработки видимых маршрутов */
  isolate?: boolean;
  /** ids — показать на схеме только эти маршруты; null — показать всю схему */
  onShowRoutes?: (ids: string[] | null) => void;
}

const methodLabel = (m: string) => normalizeSpeedMode(m) === "fnip" ? "ФНиП №467" : "РД 15-11-2007";

const inputCls = "w-full h-7 px-2 text-[11.5px] outline-none";
const inputStyle: React.CSSProperties = {
  color: "var(--c-t1)", border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)",
};

function IconBtn({ icon, title, onClick, danger, active, disabled }: {
  icon: string; title: string; onClick: () => void; danger?: boolean; active?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }} title={title}
      className="w-6 h-6 flex items-center justify-center rounded flex-shrink-0 transition-colors hover:bg-[var(--c-s4)] disabled:opacity-30"
      style={{ color: danger ? "var(--c-red)" : active ? "var(--c-accent)" : "var(--c-t3)" }}>
      <Icon name={icon} size={13} />
    </button>
  );
}

function Btn({ icon, children, onClick, active, danger, title, grow, disabled }: {
  icon?: string; children: ReactNode; onClick: () => void; active?: boolean; danger?: boolean;
  title?: string; grow?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={title} disabled={disabled}
      className={`${grow ? "flex-1" : ""} min-h-7 py-1 px-2 flex items-center justify-center gap-1 text-[11px] font-medium rounded transition-colors disabled:opacity-40 ${active ? "" : "hover:bg-[var(--c-s3)]"}`}
      style={{
        border: `1px solid ${active ? "var(--c-accent)" : "var(--c-b2)"}`,
        background: active ? "var(--c-accent)" : "var(--c-s1)",
        color: active ? "#fff" : danger ? "var(--c-red)" : "var(--c-t2)",
      }}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </button>
  );
}

function Check({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; title?: string }) {
  return (
    <label title={title} className="flex items-center gap-1.5 cursor-pointer select-none text-[11px]" style={{ color: "var(--c-t2)" }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 cursor-pointer" style={{ accentColor: "var(--c-accent)" }} />
      {label}
    </label>
  );
}

function NumBox({ prefix, unit, value, step, min, onChange, width = "w-16", placeholder }: {
  prefix?: string; unit: string; value: number | ""; step: number; min?: number; onChange: (v: number | null) => void; width?: string; placeholder?: string;
}) {
  return (
    <label className="flex items-stretch flex-shrink-0 overflow-hidden"
      style={{ border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)" }}>
      {prefix && <span className="px-1.5 flex items-center text-[10px]" style={{ color: "var(--c-t4)", background: "var(--c-s3)" }}>{prefix}</span>}
      <input type="number" value={value} step={step} min={min} placeholder={placeholder}
        onChange={(e) => {
          if (e.target.value === "") { onChange(null); return; }
          const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v);
        }}
        className={`font-num ${width} h-7 px-1.5 text-[11.5px] text-right outline-none bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
        style={{ color: "var(--c-t1)" }} />
      {unit && <span className="px-1.5 flex items-center text-[10px]" style={{ color: "var(--c-t4)", background: "var(--c-s3)" }}>{unit}</span>}
    </label>
  );
}

function SubBlock({ icon, title, badge, open, onToggle, children }: {
  icon: string; title: string; badge?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--c-b1)" }}>
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-[var(--c-s3)] transition-colors">
        <Icon name="ChevronRight" size={11}
          style={{ color: "var(--c-t4)", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
        <Icon name={icon} size={12} style={{ color: "var(--c-t3)" }} />
        <span className="flex-1 text-[11px] font-medium" style={{ color: "var(--c-t2)" }}>{title}</span>
        {badge}
      </button>
      {open && <div className="px-2 pb-2 space-y-1.5">{children}</div>}
    </div>
  );
}

function Pill({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span className="text-[9.5px] font-semibold px-1.5 rounded-full flex-shrink-0 font-num"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{children}</span>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span style={{ color: "var(--c-t3)" }}>{label}</span>
      <span className="font-num" style={{ color: "var(--c-t1)", fontWeight: strong ? 700 : 500 }}>{value}</span>
    </div>
  );
}

export default function InspectionRoutesPanel(p: Props) {
  const { routes, branches, nodes, symbols, selectedRouteId, onSelect, onAdd, onUpdate, onDelete, bindMode, onToggleBind } = p;
  const isolate = !!p.isolate && !bindMode;
  const visibleRoutes = routes.filter(r => r.visible && r.branchIds.length > 0);
  const showOnly = (ids: string[]) => p.onShowRoutes?.(ids);
  const showAll = () => p.onShowRoutes?.(null);
  const [open, setOpen] = useState<Set<string>>(new Set(["branches", "calc"]));
  const isOpen = (k: string) => open.has(k);
  const toggle = (k: string) => setOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const branchById = useMemo(() => new Map(branches.map(b => [b.id, b])), [branches]);
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const results = useMemo(() => {
    const m = new Map<string, ReturnType<typeof calcInspectionRoute>>();
    for (const r of routes) m.set(r.id, calcInspectionRoute(r, branchById, nodeById, symbols));
    return m;
  }, [routes, branchById, nodeById, symbols]);

  const sorted = useMemo(() => [...routes].sort((a, b) => a.number - b.number), [routes]);
  const totals = useMemo(() => {
    let len = 0, time = 0;
    for (const r of routes) { const res = results.get(r.id); if (res) { len += res.length; time += res.totalTime; } }
    return { len, time };
  }, [routes, results]);

  function addRoute() {
    const maxNum = routes.reduce((m, x) => Math.max(m, x.number), 0);
    const r = makeInspectionRoute({ number: maxNum + 1, color: ROUTE_COLORS[routes.length % ROUTE_COLORS.length] });
    onAdd(r);
    onSelect(r.id);
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const sum: (string | number)[][] = [[
      "№", "Маршрут", "Методика", "Выработок", "Длина, м", "Время хода, мин", "Обратный путь, мин",
      "Пожарных кранов", "Время на краны, мин", "Прочее, мин", "Итого, мин",
    ]];
    for (const r of sorted) {
      const res = results.get(r.id)!;
      sum.push([
        r.number, r.name || `МПО ${r.number}`, methodLabel(r.speedMode), res.segments.length, Math.round(res.length),
        +res.travelTime.toFixed(2), +res.returnTime.toFixed(2),
        r.countHydrants ? res.hydrants : "—", +res.hydrantTime.toFixed(2), +res.extraTime.toFixed(2), +res.totalTime.toFixed(2),
      ]);
    }
    sum.push([], ["", "ИТОГО", "", "", Math.round(totals.len), "", "", "", "", "", +totals.time.toFixed(2)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), "Сводка МПО");
    for (const r of sorted) {
      const res = results.get(r.id)!;
      const rows: (string | number)[][] = [
        [`Маршрут профилактического обследования № ${r.number}${r.name ? " — " + r.name : ""}`],
        [`Расчёт времени хода горнорабочего (${methodLabel(r.speedMode)})`], [],
        ["№", "Выработка", "Длина, м", "Угол, °", "V, м/мин", "t, мин", "Σt, мин", "Пожарных кранов"],
      ];
      res.segments.forEach(sg => rows.push([
        sg.segmentNumber, sg.label, Math.round(sg.length), +sg.angle.toFixed(0),
        sg.speed, +sg.time.toFixed(2), +sg.cumulTime.toFixed(2), sg.hydrants,
      ]));
      rows.push(["ИТОГО", "", Math.round(res.length), "", "", +res.travelTime.toFixed(2), "", res.hydrantsAuto]);
      rows.push([], ["", "Время хода (в одну сторону), мин", +res.travelTime.toFixed(2)]);
      if (r.includeReturn) rows.push(["", "Обратный путь, мин", +res.returnTime.toFixed(2)]);
      if (r.countHydrants) rows.push(["", `Обследование пожарных кранов (${res.hydrants} × ${r.hydrantMinutes} мин)`, +res.hydrantTime.toFixed(2)]);
      if (res.extraTime > 0) rows.push(["", "Прочие затраты, мин", +res.extraTime.toFixed(2)]);
      rows.push(["", "ИТОГО время обследования, мин", +res.totalTime.toFixed(2)]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `МПО ${r.number}`.slice(0, 31));
    }
    XLSX.writeFile(wb, `${(p.projectName || "Схема").replace(/\.vproj$/, "")} — МПО.xlsx`);
  }

  function exportCsv(r: InspectionRoute) {
    const res = results.get(r.id)!;
    const rows: string[][] = [];
    rows.push([`Маршрут профилактического обследования № ${r.number}${r.name ? " — " + r.name : ""}`]);
    rows.push([`Расчёт времени хода горнорабочего (${methodLabel(r.speedMode)})`]);
    rows.push(["Время хода (в одну сторону), мин", res.travelTime.toFixed(1)]);
    rows.push([]);
    rows.push(["Выработка", "Сегм.", "Длина, м", "Угол, °", "V, м/мин", "t, мин", "Σt, мин"]);
    for (const sg of res.segments) {
      rows.push([sg.label, String(sg.segmentNumber), String(Math.round(sg.length)), sg.angle.toFixed(0),
        String(sg.speed), sg.time.toFixed(2), sg.cumulTime.toFixed(2)]);
    }
    rows.push(["ИТОГО", "", String(Math.round(res.length)), "", "", res.travelTime.toFixed(2), ""]);
    if (r.includeReturn) rows.push(["Обратный путь, мин", res.returnTime.toFixed(2)]);
    if (r.countHydrants) rows.push([`Пожарные краны (${res.hydrants} × ${r.hydrantMinutes} мин)`, res.hydrantTime.toFixed(2)]);
    if (res.extraTime > 0) rows.push(["Прочие затраты, мин", res.extraTime.toFixed(2)]);
    rows.push(["ИТОГО время обследования, мин", res.totalTime.toFixed(2)]);
    const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `mpo_${r.number}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--c-s2)" }}>
      <div className="px-2 pt-2 pb-2 space-y-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-b1)" }}>
        <div className="flex gap-1">
          <Btn icon="Plus" grow onClick={addRoute}>Добавить маршрут</Btn>
          <Btn icon="FileSpreadsheet" disabled={routes.length === 0} title="Выгрузить маршруты в Excel" onClick={exportExcel}>Excel</Btn>
        </div>
        {bindMode && selectedRouteId && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10.5px]"
            style={{ background: "color-mix(in srgb, var(--c-green, #15803d) 12%, transparent)", color: "var(--c-green, #15803d)", border: "1px solid color-mix(in srgb, var(--c-green, #15803d) 35%, transparent)" }}>
            <Icon name="Route" size={12} className="flex-shrink-0" />
            <span className="flex-1 leading-snug">Кликайте по выработкам на схеме по ходу маршрута. Повторный клик — убрать.</span>
            <button type="button" onClick={onToggleBind} className="font-semibold underline flex-shrink-0">Готово</button>
          </div>
        )}
        {routes.length > 0 && p.onShowRoutes && (
          <div className="space-y-1">
            <div className="text-[10px] px-1" style={{ color: "var(--c-t4)" }}>Показ на схеме</div>
            <div className="flex gap-1">
              <Btn icon="Map" grow active={!isolate} onClick={showAll}
                title="Показать всю схему (маршруты остаются окрашенными)">Вся схема</Btn>
              <Btn icon="Route" grow active={isolate}
                disabled={visibleRoutes.length === 0}
                onClick={() => showOnly(visibleRoutes.map(r => r.id))}
                title="Показать на схеме только маршруты, отмеченные глазом">
                Только маршруты{visibleRoutes.length > 0 ? ` (${visibleRoutes.length})` : ""}
              </Btn>
            </div>
            {isolate && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10.5px]"
                style={{ background: "color-mix(in srgb, var(--c-accent) 10%, transparent)", color: "var(--c-t2)", border: "1px solid color-mix(in srgb, var(--c-accent) 30%, transparent)" }}>
                <Icon name="Filter" size={12} className="flex-shrink-0" style={{ color: "var(--c-accent)" }} />
                <span className="flex-1 leading-snug">
                  Остальная схема скрыта. Глазом <Icon name="Eye" size={10} className="inline" /> добавьте или уберите маршрут.
                </span>
                <button type="button" onClick={showAll} className="font-semibold underline flex-shrink-0">Вся схема</button>
              </div>
            )}
          </div>
        )}
        {routes.length > 0 && (
          <div className="flex items-center justify-between text-[10.5px] px-1" style={{ color: "var(--c-t3)" }}>
            <span>Всего: <b className="font-num" style={{ color: "var(--c-t1)" }}>{fmtLength(totals.len)}</b></span>
            <span>Время: <b className="font-num" style={{ color: "var(--c-t1)" }}>{fmtMinutes(totals.time)}</b></span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-1 pb-0.5 flex items-center gap-1 text-[10px]" style={{ color: "var(--c-t4)" }}>
          <Icon name="Route" size={11} />
          <span className="flex-1">Маршруты МПО · {routes.length}</span>
          <span>длина · время</span>
        </div>

        {routes.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Icon name="Route" size={24} style={{ color: "var(--c-t4)" }} />
            <span className="text-[11px] px-3" style={{ color: "var(--c-t3)" }}>
              Маршрутов нет. Нажмите «Добавить маршрут», затем отметьте выработки маршрута кликами по схеме.
            </span>
          </div>
        )}

        {sorted.map((r) => {
          const expanded = r.id === selectedRouteId;
          const res = results.get(r.id)!;
          const upd = (patch: Partial<InspectionRoute>) => onUpdate(r.id, patch);
          const move = (i: number, d: number) => {
            const arr = [...r.branchIds];
            const j = i + d;
            if (j < 0 || j >= arr.length) return;
            [arr[i], arr[j]] = [arr[j], arr[i]];
            upd({ branchIds: arr });
          };
          return (
            <section key={r.id} className="rounded-md overflow-hidden"
              style={{
                background: "var(--c-s1)",
                border: `1px solid ${expanded ? "var(--c-b3)" : "var(--c-b1)"}`,
                boxShadow: expanded ? "0 2px 6px -2px rgba(0,0,0,.15)" : undefined,
              }}>
              <div role="button" tabIndex={0}
                onClick={() => onSelect(expanded ? null : r.id)}
                className="flex items-center gap-1.5 pl-1 pr-1 h-8 cursor-pointer select-none hover:bg-[var(--c-s3)]"
                style={{ background: expanded ? "var(--c-s3)" : undefined }}>
                <Icon name="ChevronRight" size={12} className="flex-shrink-0"
                  style={{ color: "var(--c-t4)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 font-num"
                  style={{ background: r.color, opacity: r.visible ? 1 : 0.4 }}>{r.number}</span>
                <span className="flex-1 min-w-0 truncate text-[11.5px] font-medium" style={{ color: r.visible ? "var(--c-t1)" : "var(--c-t4)" }}>
                  {r.name || <span style={{ color: "var(--c-t4)", fontWeight: 400 }}>Маршрут {r.number}</span>}
                </span>
                <Pill color={r.color}>{fmtLength(res.length)}</Pill>
                <Pill color="var(--c-t2)">{fmtMinutes(res.totalTime)}</Pill>
                {p.onShowRoutes && (
                  <IconBtn icon="Focus" disabled={r.branchIds.length === 0}
                    active={isolate && r.visible && visibleRoutes.length === 1}
                    title="Показать на схеме только этот маршрут"
                    onClick={() => showOnly([r.id])} />
                )}
                <IconBtn icon={r.visible ? "Eye" : "EyeOff"} active={r.visible}
                  title={r.visible ? "Скрыть маршрут на схеме" : "Показать маршрут на схеме"}
                  onClick={() => upd({ visible: !r.visible })} />
              </div>

              {expanded && (<>
                <div className="px-2 py-2 space-y-1.5" style={{ borderTop: "1px solid var(--c-b1)" }}>
                  <div className="flex items-center gap-1.5">
                    <NumBox prefix="№" unit="" value={r.number} step={1} min={1} width="w-10"
                      onChange={(v) => upd({ number: Math.max(1, Math.round(v ?? 1)) })} />
                    <input type="text" value={r.name} onChange={(e) => upd({ name: e.target.value })}
                      placeholder="Название маршрута" autoFocus={!r.name}
                      className={`flex-1 min-w-0 ${inputCls}`} style={inputStyle} />
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {ROUTE_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => upd({ color: c })} title="Цвет маршрута на схеме"
                        className="w-5 h-5 rounded"
                        style={{ background: c, outline: r.color === c ? "2px solid var(--c-t1)" : "none", outlineOffset: 1 }} />
                    ))}
                    <label className="w-5 h-5 rounded relative overflow-hidden cursor-pointer flex items-center justify-center"
                      style={{ border: "1px dashed var(--c-b3)" }} title="Свой цвет">
                      <Icon name="Palette" size={11} style={{ color: "var(--c-t3)" }} />
                      <input type="color" value={r.color} onChange={(e) => upd({ color: e.target.value })}
                        className="absolute inset-0 opacity-0 cursor-pointer" />
                    </label>
                  </div>
                  <Check checked={r.showLabel} onChange={(v) => upd({ showLabel: v })} label="Подпись длины и времени на схеме" />
                  {r.showLabel && (r.labelX != null) && (
                    <button type="button" className="text-[10px] hover:underline ml-5"
                      style={{ color: "var(--c-accent)" }}
                      title="Табличка перемещена вручную — вернуть к середине маршрута"
                      onClick={() => upd({ labelX: null, labelY: null, labelZ: null })}>
                      ↺ Вернуть табличку на маршрут
                    </button>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px]" style={{ color: "var(--c-t3)" }}>Окраска ветвей:</span>
                    <Check checked={!!r.colorInner} onChange={(v) => upd({ colorInner: v })} label="внутри"
                      title="Заливать выработки маршрута его цветом" />
                    <Check checked={r.colorOuter !== false} onChange={(v) => upd({ colorOuter: v })} label="снаружи"
                      title="Цветной контур вокруг выработок маршрута" />
                  </div>
                  <div className="flex gap-1">
                    <Btn grow icon="Route" active={bindMode}
                      title="Клик по выработке на схеме добавляет её в конец маршрута или убирает"
                      onClick={onToggleBind}>
                      {bindMode ? "Выбор на схеме включён" : "Выбрать выработки на схеме"}
                    </Btn>
                    <Btn icon="Trash2" danger title="Удалить маршрут"
                      onClick={() => { if (window.confirm(`Удалить маршрут № ${r.number}?`)) { onDelete(r.id); onSelect(null); } }}>
                      Удалить
                    </Btn>
                  </div>
                </div>

                <SubBlock icon="ListOrdered" title="Выработки маршрута" open={isOpen("branches")} onToggle={() => toggle("branches")}
                  badge={<Pill color="var(--c-accent)">{r.branchIds.length}</Pill>}>
                  {r.branchIds.length === 0 ? (
                    <div className="text-[10px]" style={{ color: "var(--c-t3)" }}>Выработки не выбраны. Включите выбор на схеме и кликайте по выработкам в порядке обхода.</div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto rounded" style={{ border: "1px solid var(--c-b1)" }}>
                      {r.branchIds.map((bid, i) => {
                        const b = branchById.get(bid);
                        const seg = res.segments.find(s => s.branchId === bid);
                        return (
                          <div key={bid + i} className="flex items-center gap-1 pl-1.5 pr-0.5 h-6 text-[11px]"
                            style={{ borderBottom: "1px solid var(--c-b1)", background: seg?.gapBefore ? "color-mix(in srgb, var(--c-amber, #d97706) 10%, transparent)" : undefined }}
                            title={seg?.gapBefore ? "Разрыв: выработка не соединена с остальной частью маршрута — пропущена выработка на пути" : undefined}>
                            <span className="font-num w-5 text-right" style={{ color: "var(--c-t4)" }}>{i + 1}</span>
                            <button type="button" className="flex-1 truncate text-left hover:underline"
                              style={{ color: b ? "var(--c-t2)" : "var(--c-red)" }}
                              onClick={() => p.onFocusBranch?.(bid)}>
                              {b ? `${b.id}. ${b.type || "Ветвь"}` : `Ветвь ${bid} (удалена)`}
                            </button>
                            {seg && <span className="font-num text-[10px]" style={{ color: "var(--c-t3)" }}>{Math.round(seg.length)} м</span>}
                            {seg && seg.hydrants > 0 && <span title="Пожарные краны"><Icon name="Droplet" size={11} style={{ color: "#dc2626" }} /></span>}
                            <IconBtn icon="ChevronUp" title="Выше" disabled={i === 0} onClick={() => move(i, -1)} />
                            <IconBtn icon="ChevronDown" title="Ниже" disabled={i === r.branchIds.length - 1} onClick={() => move(i, 1)} />
                            <IconBtn icon="X" title="Убрать из маршрута" onClick={() => upd({ branchIds: r.branchIds.filter((_, k) => k !== i) })} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <select className={`${inputCls} cursor-pointer`} style={inputStyle} value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id && !r.branchIds.includes(id)) upd({ branchIds: [...r.branchIds, id] });
                    }}>
                    <option value="">+ Добавить выработку из списка…</option>
                    {branches.filter(b => !r.branchIds.includes(b.id)).slice(0, 2000).map(b => (
                      <option key={b.id} value={b.id}>{b.id}. {b.type || "Ветвь"} ({Math.round(b.length)} м)</option>
                    ))}
                  </select>
                  {res.warnings.map((w, k) => (
                    <div key={k} className="text-[10px] leading-snug" style={{ color: "var(--c-red, #b91c1c)" }}>⚠ {w}</div>
                  ))}
                  {r.branchIds.length > 0 && (
                    <div className="flex gap-1">
                      <Btn grow icon="ArrowUpDown" onClick={() => upd({ reversed: !r.reversed })} active={r.reversed}
                        title="Пройти маршрут в обратном порядке (меняется время на наклонных выработках)">
                        Обратное направление
                      </Btn>
                      <Btn icon="Eraser" danger onClick={() => upd({ branchIds: [] })}>Очистить</Btn>
                    </div>
                  )}
                </SubBlock>

                <SubBlock icon="Timer" title="Расчёт времени обследования" open={isOpen("calc")} onToggle={() => toggle("calc")}
                  badge={<Pill color="var(--c-t2)">{fmtMinutes(res.totalTime)}</Pill>}>
                  <div>
                    <div className="text-[10px] font-medium mb-1" style={{ color: "var(--c-t3)" }}>Методика расчёта (как время хода горнорабочего)</div>
                    {INSPECTION_SPEED_MODES.map(m => (
                      <label key={m.value} title={m.hint} className="flex items-center gap-1.5 mb-0.5 cursor-pointer text-[11px]" style={{ color: "var(--c-t2)" }}>
                        <input type="radio" name={`mpo_method_${r.id}`} checked={normalizeSpeedMode(r.speedMode) === m.value}
                          onChange={() => upd({ speedMode: m.value as InspectionSpeedMode })}
                          style={{ accentColor: "var(--c-accent)" }} />
                        {m.label}
                      </label>
                    ))}
                  </div>
                  <Check checked={r.includeReturn} onChange={(v) => upd({ includeReturn: v })} label="Учитывать обратный путь по маршруту" />

                  <div className="rounded p-1.5 space-y-1.5" style={{ border: "1px solid var(--c-b1)", background: "var(--c-s2)" }}>
                    <Check checked={r.countHydrants} onChange={(v) => upd({ countHydrants: v })}
                      label={<span className="flex items-center gap-1"><Icon name="Droplet" size={11} style={{ color: "#dc2626" }} />Суммировать время обследования пожарных кранов</span>} />
                    {r.countHydrants && (<>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <NumBox prefix="кранов" unit="шт" width="w-12" step={1} min={0}
                          value={r.hydrantCountOverride ?? res.hydrantsAuto}
                          onChange={(v) => upd({ hydrantCountOverride: v == null ? null : Math.max(0, Math.round(v)) })} />
                        <span className="text-[11px]" style={{ color: "var(--c-t4)" }}>×</span>
                        <NumBox unit="мин" width="w-12" step={0.5} min={0} value={r.hydrantMinutes}
                          onChange={(v) => upd({ hydrantMinutes: Math.max(0, v ?? 0) })} />
                      </div>
                      <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--c-t3)" }}>
                        <span>На схеме найдено: {res.hydrantsAuto} (значки «Пожарный кран» и узлы ППЗ)</span>
                        {r.hydrantCountOverride != null && (
                          <button type="button" className="underline" onClick={() => upd({ hydrantCountOverride: null })}>авто</button>
                        )}
                      </div>
                    </>)}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] flex-1" style={{ color: "var(--c-t2)" }}>Прочие затраты времени</span>
                    <NumBox unit="мин" width="w-14" step={1} min={0} value={r.extraMinutes}
                      onChange={(v) => upd({ extraMinutes: Math.max(0, v ?? 0) })} />
                  </div>

                  <div className="rounded p-2 space-y-0.5" style={{ border: `1px solid ${r.color}`, background: `color-mix(in srgb, ${r.color} 6%, var(--c-s1))` }}>
                    <Stat label="Длина маршрута" value={fmtLength(res.length)} />
                    <Stat label="Время хода (в одну сторону)" value={`${res.travelTime.toFixed(1)} мин`} />
                    {r.includeReturn && <Stat label="Обратный путь" value={`${res.returnTime.toFixed(1)} мин`} />}
                    {r.countHydrants && <Stat label={`Пожарные краны (${res.hydrants} × ${r.hydrantMinutes})`} value={`${res.hydrantTime.toFixed(1)} мин`} />}
                    {res.extraTime > 0 && <Stat label="Прочее" value={`${res.extraTime.toFixed(1)} мин`} />}
                    <div style={{ borderTop: "1px solid var(--c-b1)", marginTop: 3, paddingTop: 3 }}>
                      <Stat label="Итого на обследование" value={`${res.totalTime.toFixed(1)} мин (${fmtMinutes(res.totalTime)})`} strong />
                    </div>
                  </div>
                </SubBlock>

                <SubBlock icon="Table" title="Маршрут по выработкам" open={isOpen("table")} onToggle={() => toggle("table")}
                  badge={<Pill color="var(--c-t3)">{res.segments.length} уч.</Pill>}>
                  {res.segments.length === 0 ? (
                    <div className="text-[10px]" style={{ color: "var(--c-t3)" }}>Нет выработок.</div>
                  ) : (<>
                    <div className="overflow-auto rounded" style={{ border: "1px solid var(--c-b1)", maxHeight: 320 }}>
                      <table className="w-full text-[10px] border-separate border-spacing-0">
                        <thead className="sticky top-0 z-10">
                          <tr style={{ background: "var(--c-s3)", color: "var(--c-t3)" }}>
                            <th className="px-1 py-0.5 text-left font-medium">№</th>
                            <th className="px-1 py-0.5 text-left font-medium">Выработка</th>
                            <th className="px-1 py-0.5 text-right font-medium">L, м</th>
                            <th className="px-1 py-0.5 text-right font-medium">Угол</th>
                            <th className="px-1 py-0.5 text-right font-medium">V</th>
                            <th className="px-1 py-0.5 text-right font-medium">t</th>
                            <th className="px-1 py-0.5 text-right font-medium">Σt</th>
                          </tr>
                        </thead>
                        <tbody className="font-num">
                          {res.segments.map((sg, i) => {
                            const bg = i % 2 === 0 ? "var(--c-s1)" : "var(--c-s2)";
                            return (
                              <tr key={sg.branchId + i} style={{ background: bg, color: "var(--c-t2)" }}>
                                <td className="px-1 py-0.5" style={{ color: "var(--c-t4)" }}>{sg.segmentNumber}</td>
                                <td className="px-1 py-0.5 truncate max-w-[110px]" title={sg.label}>{sg.branchLabel || sg.branchId}</td>
                                <td className="px-1 py-0.5 text-right">{Math.round(sg.length)}</td>
                                <td className="px-1 py-0.5 text-right">{sg.angle.toFixed(0)}°</td>
                                <td className="px-1 py-0.5 text-right" style={{ color: "var(--c-blue, #1d4ed8)" }}>{sg.speed}</td>
                                <td className="px-1 py-0.5 text-right">{sg.time.toFixed(2)}</td>
                                <td className="px-1 py-0.5 text-right font-semibold" style={{ color: "var(--c-t1)" }}>{sg.cumulTime.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="sticky bottom-0 z-10 font-num">
                          <tr style={{ background: "var(--c-tint-blue, #e0f2fe)", color: "var(--c-t1)" }}>
                            <td className="px-1 py-0.5 font-bold" colSpan={2}>ИТОГО</td>
                            <td className="px-1 py-0.5 text-right font-bold">{Math.round(res.length)}</td>
                            <td colSpan={3}></td>
                            <td className="px-1 py-0.5 text-right font-bold">{res.travelTime.toFixed(2)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <Btn grow icon="Download" onClick={() => exportCsv(r)}>Экспорт в CSV</Btn>
                  </>)}
                </SubBlock>

                <SubBlock icon="MessageSquare" title="Примечание" open={isOpen("comment")} onToggle={() => toggle("comment")}>
                  <textarea value={r.comment} onChange={(e) => upd({ comment: e.target.value })} rows={3}
                    placeholder="Периодичность, ответственный, что обследуется…"
                    className="w-full px-2 py-1 text-[11px] outline-none resize-y" style={inputStyle} />
                </SubBlock>
              </>)}
            </section>
          );
        })}
      </div>
    </div>
  );
}