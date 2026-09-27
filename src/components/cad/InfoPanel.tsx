// Панель информации — что подписывать на схеме и какие объекты показывать.
// (аналог «Панели информации» в ПО Вентиляция / Аэросеть)
//
// Все цвета — из палитры темы (--c-accent, --c-s*, --c-b*, --c-t*), поэтому
// панель одинаково читается в светлой и тёмной теме.
import { useMemo, useState, type ReactNode } from "react";
import Icon from "@/components/ui/icon";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type TopoNode } from "@/lib/topology";
import { type Position } from "@/lib/positions";

type Key = keyof InfoDisplayConfig;
/** [ключ, понятная подпись, обозначение/единица справа] */
type Row = [Key, string, string?];

// ─── Списки параметров ─────────────────────────────────────────────────
const NODE_ROWS: Row[] = [
  ["nodeNumber", "Номер узла", "№"],
  ["nodeX", "Координата X", "м"],
  ["nodeY", "Координата Y", "м"],
  ["nodeZ", "Отметка Z", "м"],
  ["nodePressure", "Давление вентиляции", "даПа"],
  ["nodeTemp", "Температура", "°C"],
  ["nodeMethane", "Метан CH₄", "%"],
];

const BRANCH_ROWS: Row[] = [
  ["branchNumber", "Номер ветви", "№"],
  ["branchName", "Название", ""],
  ["branchFlow", "Расход Q", "м³/с"],
  ["branchFlowCalc", "Расход расчётный", "м³/с"],
  ["branchVelocity", "Скорость V", "м/с"],
  ["branchVMax", "Макс. скорость", "м/с"],
  ["branchDepression", "Депрессия H", "даПа"],
  ["branchExtraFan", "Доп. депрессия", "даПа"],
  ["branchResistance", "Сопротивление R", "kμ"],
  ["branchResistanceSum", "Сопротивление сумм.", "kμ"],
  ["branchLength", "Длина L", "м"],
  ["branchSection", "Сечение S", "м²"],
  ["branchAngle", "Угол наклона", "°"],
  ["branchHeight", "Высота", "м"],
  ["branchPeople", "Количество людей", "чел"],
];

const MS_ROWS: Row[] = [
  ["msIndNumber", "Номер станции", "№"],
  ["msIndLocation", "Местоположение", ""],
  ["msIndFlow", "Расход Q", "м³/с"],
  ["msIndArea", "Сечение S", "м²"],
  ["msIndVelocity", "Скорость V", "м/с"],
];

const WATER_ROWS: Row[] = [
  ["waterPipes", "Трубы", ""],
  ["waterFlowDirection", "Направление течения", ""],
  ["waterReservoir", "Резервуары", ""],
  ["waterConsumer", "Потребители", ""],
  ["waterPumpStation", "Насосные станции", ""],
  ["waterPipeJoint", "Соединения труб", ""],
  ["waterReducer", "Редукционные клапаны", ""],
  ["waterGateValve", "Запорные вентили", ""],
  ["waterReducerPressure", "Давление на редукторе", "МПа"],
  ["waterVelocity", "Скорость воды", "м/с"],
  ["waterFlow", "Расход воды", "м³/ч"],
  ["waterDeficit", "Дефицит воды", "м³/ч"],
  ["waterDynamicPressure", "Динамическое давление", "МПа"],
];

// Быстрые наборы меняют только подписи узлов и ветвей — водопровод,
// вентиляторы и замерные станции не трогают.
const PRESET_KEYS: Key[] = [...NODE_ROWS, ...BRANCH_ROWS].map((r) => r[0]);
const PRESETS: { label: string; title: string; on: Key[] }[] = [
  { label: "Минимум", title: "Номер ветви и расход", on: ["branchNumber", "branchFlow"] },
  { label: "Стандарт", title: "Название, Q, V, H", on: ["branchName", "branchFlow", "branchVelocity", "branchDepression"] },
  {
    label: "Полный", title: "Все основные параметры ветвей и узлов",
    on: ["branchNumber", "branchName", "branchLength", "branchSection", "branchResistance",
      "branchFlow", "branchVelocity", "branchDepression", "nodeNumber", "nodeZ", "nodePressure"],
  },
];

// ─── Примитивы ─────────────────────────────────────────────────────────
function MiniSwitch({ on, mixed }: { on: boolean; mixed?: boolean }) {
  return (
    <span className="relative flex-shrink-0 rounded-full transition-colors"
      style={{
        width: 24, height: 13,
        background: on ? "var(--c-accent, #1e5a7a)"
          : mixed ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 45%, var(--c-b2, #d5d1c8))"
          : "var(--c-b2, #d5d1c8)",
      }}>
      <span className="absolute top-[2px] rounded-full transition-all"
        style={{ width: 9, height: 9, left: on ? 13 : mixed ? 7.5 : 2, background: "var(--c-s1, #fff)" }} />
    </span>
  );
}

function ToggleRow({ label, unit, checked, onChange }: {
  label: string; unit?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-2 h-6 px-2 rounded text-left transition-colors hover:bg-[var(--c-s3,#f1efea)]"
      style={{ background: "transparent", border: "none", cursor: "pointer" }}>
      <span className="flex-1 min-w-0 truncate text-[11px]"
        style={{ color: checked ? "var(--c-t1, #1f2328)" : "var(--c-t3, #6b7280)" }}>{label}</span>
      {unit && (
        <span className="text-[10px] flex-shrink-0" style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-num)" }}>
          {unit}
        </span>
      )}
      <MiniSwitch on={checked} />
    </button>
  );
}

function Section({ icon, title, count, total, open, onToggle, onAll, children }: {
  icon: string; title: string; count: number; total: number;
  open: boolean; onToggle: () => void; onAll?: (on: boolean) => void; children: ReactNode;
}) {
  const all = total > 0 && count === total;
  return (
    <section className="rounded-lg overflow-hidden"
      style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b1, #e7e4dd)" }}>
      <div className="flex items-center gap-1 pr-2">
        <button type="button" onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left select-none"
          style={{ background: "transparent", border: "none", cursor: "pointer" }}>
          <Icon name="ChevronRight" size={12}
            style={{ color: "var(--c-t4, #767f8c)", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
          <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)", color: "var(--c-accent, #1e5a7a)" }}>
            <Icon name={icon} size={12} />
          </span>
          <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--c-t2, #3a3f45)" }}>{title}</span>
          <span className="text-[10px] px-1.5 rounded-full flex-shrink-0"
            style={{
              fontFamily: "var(--font-num)",
              background: count > 0 ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)" : "var(--c-s3, #f1efea)",
              color: count > 0 ? "var(--c-accent, #1e5a7a)" : "var(--c-t4, #767f8c)",
            }}>
            {count}/{total}
          </span>
        </button>
        {onAll && (
          <button type="button" onClick={() => onAll(!all)}
            title={all ? "Выключить все" : "Включить все"}
            className="flex items-center"
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
            <MiniSwitch on={all} mixed={count > 0 && !all} />
          </button>
        )}
      </div>
      {open && <div className="px-1 pb-1.5">{children}</div>}
    </section>
  );
}

function IconBtn({ icon, title, active = true, onClick }: {
  icon: string; title: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="w-5 h-5 flex items-center justify-center rounded flex-shrink-0 hover:bg-[var(--c-s4,#e6e3dc)]"
      style={{
        background: "transparent", border: "none", cursor: "pointer",
        color: active ? "var(--c-accent, #1e5a7a)" : "var(--c-t4, #767f8c)",
      }}>
      <Icon name={icon} size={12} />
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-2 py-1.5 text-[11px]" style={{ color: "var(--c-t4, #767f8c)" }}>{text}</div>;
}

// ─── Панель ────────────────────────────────────────────────────────────
interface InfoPanelProps {
  config: InfoDisplayConfig;
  onChange: (patch: Partial<InfoDisplayConfig>) => void;
  nodes?: TopoNode[];
  selectedNodeId?: string | null;
  onNodeVisibilityChange?: (id: string, visible: boolean) => void;
  onAllNodesVisibility?: (visible: boolean) => void;
  onSelectNode?: (id: string) => void;
  positions?: Position[];
  onPositionVisibilityChange?: (id: string, visible: boolean) => void;
  onPositionBranchesVisibilityChange?: (id: string, branchesVisible: boolean) => void;
  onAllPositionsVisibility?: (visible: boolean, branchesVisible: boolean) => void;
}

type SectionId = "branches" | "nodes" | "ms" | "water" | "positions" | "nodeVis";

export default function InfoPanel({
  config, onChange,
  nodes = [], selectedNodeId,
  onNodeVisibilityChange, onAllNodesVisibility, onSelectNode,
  positions = [],
  onPositionVisibilityChange,
  onPositionBranchesVisibilityChange,
  onAllPositionsVisibility,
}: InfoPanelProps) {
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    branches: true, nodes: false, ms: false, water: false, positions: false, nodeVis: false,
  });
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const toggle = (id: SectionId) => setOpen((s) => ({ ...s, [id]: !s[id] }));
  // При поиске раскрываем все разделы, где что-то нашлось
  const isOpen = (id: SectionId) => (q ? true : open[id]);

  const setKey = (k: Key) => (v: boolean) => onChange({ [k]: v });
  const setRows = (rows: Row[]) => (on: boolean) =>
    onChange(Object.fromEntries(rows.map(([k]) => [k, on])) as Partial<InfoDisplayConfig>);
  const countOn = (rows: Row[]) => rows.filter(([k]) => config[k]).length;
  const filterRows = (rows: Row[]) =>
    q ? rows.filter(([, label, unit]) => `${label} ${unit ?? ""}`.toLowerCase().includes(q)) : rows;

  const applyPreset = (on: Key[]) =>
    onChange(Object.fromEntries(PRESET_KEYS.map((k) => [k, on.includes(k)])) as Partial<InfoDisplayConfig>);
  const activePreset = PRESETS.findIndex((p) => PRESET_KEYS.every((k) => config[k] === p.on.includes(k)));

  const filteredNodes = useMemo(
    () => (q ? nodes.filter((n) => String(n.number).toLowerCase().includes(q)) : nodes),
    [nodes, q],
  );
  const filteredPositions = useMemo(
    () => (q ? positions.filter((p) => `${p.number} ${p.name ?? ""}`.toLowerCase().includes(q)) : positions),
    [positions, q],
  );
  const visibleNodes = nodes.filter((n) => n.visible !== false).length;
  const visiblePositions = positions.filter((p) => p.visible !== false).length;

  const paramSection = (id: SectionId, icon: string, title: string, rows: Row[]) => {
    const shown = filterRows(rows);
    if (q && shown.length === 0) return null;
    return (
      <Section icon={icon} title={title} count={countOn(rows)} total={rows.length}
        open={isOpen(id)} onToggle={() => toggle(id)} onAll={setRows(rows)}>
        {shown.map(([k, label, unit]) => (
          <ToggleRow key={k} label={label} unit={unit} checked={config[k]} onChange={setKey(k)} />
        ))}
      </Section>
    );
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--c-s2, #f8f7f4)" }}>
      {/* Быстрые наборы + поиск */}
      <div className="px-2 pt-2 pb-2 space-y-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-b1, #e7e4dd)" }}>
        <div>
          <div className="text-[10px] font-medium mb-1" style={{ color: "var(--c-t3, #6b7280)" }}>
            Подписи на схеме — быстрый набор
          </div>
          <div className="flex p-0.5 rounded" style={{ background: "var(--c-s3, #f1efea)" }}>
            {PRESETS.map((p, i) => {
              const on = i === activePreset;
              return (
                <button key={p.label} type="button" onClick={() => applyPreset(p.on)} title={p.title}
                  className="flex-1 h-6 px-2 rounded text-[11px] transition-colors"
                  style={{
                    border: "none", cursor: "pointer",
                    background: on ? "var(--c-s1, #fff)" : "transparent",
                    color: on ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)",
                    fontWeight: on ? 600 : 400,
                    boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none",
                  }}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1.5 h-7 px-2 rounded"
          style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d5d1c8)" }}>
          <Icon name="Search" size={12} style={{ color: "var(--c-t4, #767f8c)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти параметр, узел, позицию…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[11px]"
            style={{ border: "none", color: "var(--c-t1, #1f2328)" }} />
          {query && <IconBtn icon="X" title="Очистить" active={false} onClick={() => setQuery("")} />}
        </div>
      </div>

      {/* Разделы */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {paramSection("branches", "GitBranch", "Ветви", BRANCH_ROWS)}
        {paramSection("nodes", "CircleDot", "Узлы", NODE_ROWS)}
        {paramSection("ms", "Gauge", "Замерные станции", MS_ROWS)}
        {paramSection("water", "Droplets", "Водопровод", WATER_ROWS)}

        {onPositionVisibilityChange && (!q || filteredPositions.length > 0) && (
          <Section icon="MapPin" title="Позиции ПЛА" count={visiblePositions} total={positions.length}
            open={isOpen("positions")} onToggle={() => toggle("positions")}
            onAll={onAllPositionsVisibility ? (on) => onAllPositionsVisibility(on, on) : undefined}>
            {positions.length === 0 && <Empty text="Позиций пока нет" />}
            {filteredPositions.map((pos) => {
              const posVis = pos.visible !== false;
              const brVis = pos.branchesVisible !== false;
              const name = pos.name || `Позиция ${pos.number}`;
              return (
                <div key={pos.id} className="flex items-center gap-1.5 h-6 px-2 rounded hover:bg-[var(--c-s3,#f1efea)]"
                  style={{ opacity: posVis ? 1 : 0.55 }}>
                  <span className="flex-shrink-0 flex items-center justify-center rounded-full font-bold"
                    style={{
                      width: 16, height: 16, fontSize: 8, color: "#fff",
                      background: pos.color, border: `1.5px solid ${pos.borderColor}`,
                    }}>
                    {pos.number}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[11px]" style={{ color: "var(--c-t1, #1f2328)" }} title={name}>
                    {name}
                  </span>
                  {pos.accidentType && pos.accidentType !== "Нет" && (
                    <span className="text-[9px] px-1 rounded flex-shrink-0 truncate max-w-[70px]"
                      title={pos.accidentType}
                      style={{ background: "var(--c-s3, #f1efea)", color: "var(--c-t3, #6b7280)" }}>
                      {pos.accidentType}
                    </span>
                  )}
                  {pos.branchIds.length > 0 && onPositionBranchesVisibilityChange && (
                    <IconBtn icon="GitBranch" active={brVis}
                      title={`${brVis ? "Скрыть" : "Показать"} ветви позиции (${pos.branchIds.length})`}
                      onClick={() => onPositionBranchesVisibilityChange(pos.id, !brVis)} />
                  )}
                  <IconBtn icon={posVis ? "Eye" : "EyeOff"} active={posVis}
                    title={posVis ? "Скрыть позицию" : "Показать позицию"}
                    onClick={() => onPositionVisibilityChange(pos.id, !posVis)} />
                </div>
              );
            })}
          </Section>
        )}

        {onNodeVisibilityChange && (!q || filteredNodes.length > 0) && (
          <Section icon="Eye" title="Видимость узлов" count={visibleNodes} total={nodes.length}
            open={isOpen("nodeVis")} onToggle={() => toggle("nodeVis")} onAll={onAllNodesVisibility}>
            {nodes.length === 0 && <Empty text="Узлов пока нет" />}
            {filteredNodes.map((node) => {
              const vis = node.visible !== false;
              const selected = selectedNodeId === node.id;
              return (
                <div key={node.id} className="flex items-center gap-1.5 h-6 px-2 rounded hover:bg-[var(--c-s3,#f1efea)]"
                  style={{
                    background: selected ? "var(--c-tint-blue2, #d7e7ee)" : undefined,
                    opacity: vis ? 1 : 0.55,
                  }}>
                  <span className="text-[11px] font-semibold flex-shrink-0"
                    style={{ color: "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)", minWidth: 28 }}>
                    {node.number}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[10px]"
                    style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-num)" }}>
                    {node.x}, {node.y}
                  </span>
                  {onSelectNode && (
                    <IconBtn icon="Crosshair" title="Выделить на схеме" onClick={() => onSelectNode(node.id)} />
                  )}
                  <IconBtn icon={vis ? "Eye" : "EyeOff"} active={vis}
                    title={vis ? "Скрыть узел" : "Показать узел"}
                    onClick={() => onNodeVisibilityChange(node.id, !vis)} />
                </div>
              );
            })}
          </Section>
        )}

        {q && filterRows([...BRANCH_ROWS, ...NODE_ROWS, ...MS_ROWS, ...WATER_ROWS]).length === 0
          && filteredNodes.length === 0 && filteredPositions.length === 0 && (
          <Empty text="Ничего не найдено" />
        )}
      </div>
    </div>
  );
}
