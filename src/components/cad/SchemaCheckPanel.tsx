// Панель «Проверка схемы» — список проверок в стиле панели информации.
//
// Каждая проверка — раскрывающаяся карточка: понятное название, число
// найденных нарушений и список объектов. Клик по строке показывает объект
// на схеме. Все цвета берутся из палитры темы (--c-*), поэтому панель
// одинаково читается в светлой и тёмной теме.
import { useState, type ReactNode } from "react";
import Icon from "@/components/ui/icon";
import { type TopoNode, type TopoBranch, type Horizon, calcBranchLength } from "@/lib/topology";
import { type BranchNote, type NodeNote, type GroupNote } from "@/lib/schemaCheckTypes";
import { type CheckTab, type FullCheckResult } from "@/pages/cad/useCadSchemaCheck";
import {
  type SchemaCheckSettings, DEFAULT_SCHEMA_CHECK_SETTINGS, SCHEMA_CHECK_SETTING_GROUPS, countChangedSettings,
} from "@/lib/schemaCheckSettings";

type Level = "error" | "warn" | "info";

const LEVEL_COLOR: Record<Level, string> = {
  error: "var(--c-red, #dc2626)",
  warn: "var(--c-amber, #a66b0d)",
  info: "var(--c-accent, #1e5a7a)",
};

/**
 * Критические проверки — из-за них расчёт воздухораспределения невозможен
 * или его результат заведомо неверен (ошибка самой модели сети).
 * Остальные проверки — некритические: расчёт корректен, но есть нарушения
 * норм по его результатам, подозрительные значения или справочные замечания.
 */
const CRITICAL_CHECKS = new Set<CheckTab>([
  // Расчёт не прошёл
  "solveBlock",
  // Топология: сеть в расчёте не совпадает с чертежом
  "noFan", "components", "deadFan", "tJunction", "selfLoop",
  "brokenBranch", "isolatedBranch", "dupes", "surfaceMulti",
  // Параметры, искажающие сопротивления и тягу
  "invalidValues", "fanNoCurve", "zeroLen", "zeroR", "badArea",
  "shortManualLen", "zeroBulkhead", "lostZ",
  // Результат вентилятора недостоверен
  "fanAgainst", "fanRange",
  // Модель не совпадает с замерами — воздухораспределение в модели неверное
  "measureMismatch",
]);

const tint = (color: string, pct = 14) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");

// ─── Примитивы ─────────────────────────────────────────────────────────
function CheckCard({ icon, title, count, level, open, onToggle, children }: {
  icon: string; title: string; count: number; level: Level;
  open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const ok = count === 0;
  const color = ok ? "var(--c-green, #15803d)" : LEVEL_COLOR[level];
  return (
    <section className="rounded-lg overflow-hidden"
      style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b1, #e7e4dd)" }}>
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left select-none hover:bg-[var(--c-s3,#f1efea)]"
        style={{ background: "transparent", border: "none", cursor: "pointer" }}>
        <Icon name="ChevronRight" size={12}
          style={{ color: "var(--c-t4, #767f8c)", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
        <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: tint(color), color }}>
          <Icon name={icon} size={12} />
        </span>
        <span className="flex-1 min-w-0 truncate text-[11px] font-medium"
          style={{ color: ok ? "var(--c-t3, #6b7280)" : "var(--c-t1, #1f2328)" }}>{title}</span>
        {ok ? (
          <Icon name="Check" size={12} style={{ color }} />
        ) : (
          <span className="text-[10px] px-1.5 rounded-full flex-shrink-0 font-semibold"
            style={{ fontFamily: "var(--font-num)", background: tint(color), color }}>
            {count}
          </span>
        )}
      </button>
      {open && <div className="px-1 pb-1.5">{children}</div>}
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1.5 text-[10px] leading-snug" style={{ color: "var(--c-t3, #6b7280)" }}>
      {children}
    </div>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="mx-1 mb-1.5 px-2 py-1 rounded text-[10px] flex items-start gap-1.5"
      style={{ background: tint(LEVEL_COLOR.error, 10), color: LEVEL_COLOR.error }}>
      <Icon name="AlertTriangle" size={12} className="flex-shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}

function ThresholdInput({ label, unit, value, min, step, onChange }: {
  label: string; unit: string; value: number; min: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1.5">
      <span className="text-[10px]" style={{ color: "var(--c-t3, #6b7280)" }}>{label}</span>
      <input type="number" min={min} step={step} value={value}
        onChange={(e) => onChange(Math.max(min, parseFloat(e.target.value) || min))}
        className="w-20 h-6 px-1.5 rounded text-right text-[11px] outline-none"
        style={{
          background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d5d1c8)",
          color: "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)",
        }} />
      <span className="text-[10px]" style={{ color: "var(--c-t4, #767f8c)" }}>{unit}</span>
    </div>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="h-6 px-2 rounded flex items-center gap-1 text-[10px] font-medium flex-shrink-0 transition-colors hover:bg-[var(--c-s3,#f1efea)]"
      style={{ background: "transparent", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-accent, #1e5a7a)", cursor: "pointer" }}>
      <Icon name={icon} size={11} />
      {label}
    </button>
  );
}

/** Строка объекта: клик — показать на схеме. */
function ItemRow({ title, detail, selected, onClick, action }: {
  title: ReactNode; detail?: ReactNode; selected?: boolean; onClick: () => void; action?: ReactNode;
}) {
  return (
    <div onClick={onClick} title="Показать на схеме"
      className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-[var(--c-s3,#f1efea)]"
      style={{ background: selected ? "var(--c-tint-blue2, #d7e7ee)" : undefined }}>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] truncate" style={{ color: "var(--c-t1, #1f2328)" }}>{title}</div>
        {detail && (
          <div className="text-[10px] truncate" style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-num)" }}>
            {detail}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="px-2 py-1 text-[11px] flex items-center gap-1.5" style={{ color: "var(--c-t4, #767f8c)" }}>
      <Icon name="CircleCheck" size={12} style={{ color: "var(--c-green, #15803d)" }} />
      {text}
    </div>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <div className="px-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-t4, #767f8c)" }}>
      {children}
    </div>
  );
}

// ─── Настройки проверки ────────────────────────────────────────────────
/** Диапазон утечки через одну перемычку, м³/с — правится прямо в проверке. */
function LeakRangeEditor({ min, max, onChange }: {
  min: number; max: number; onChange: (patch: Partial<SchemaCheckSettings>) => void;
}) {
  const box = (value: number, set: (v: number) => void, placeholder?: string) => (
    <input type="number" min={0} step={0.5} value={value === 0 && placeholder ? "" : value} placeholder={placeholder}
      onChange={(e) => { const v = parseFloat(e.target.value); set(Number.isFinite(v) && v >= 0 ? v : 0); }}
      onClick={(e) => e.stopPropagation()}
      className="w-16 h-6 px-1.5 text-[11px] text-right rounded outline-none"
      style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)" }} />
  );
  return (
    <div className="mx-2 mb-1.5 flex items-center gap-1.5 text-[10px]" style={{ color: "var(--c-t3, #6b7280)" }}>
      <span>Утечка через перемычку от</span>
      {box(min, (v) => onChange({ leakBulkMin: v }))}
      <span>до</span>
      {box(max, (v) => onChange({ leakBulkMax: v }), "∞")}
      <span>м³/с</span>
    </div>
  );
}

function SettingsForm({ settings, onChange }: {
  settings: SchemaCheckSettings; onChange: (patch: Partial<SchemaCheckSettings>) => void;
}) {
  const changed = countChangedSettings(settings);
  return (
    <div className="rounded-lg max-h-[45vh] overflow-y-auto"
      style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b1, #e7e4dd)" }}>
      <div className="px-2 pt-1.5 text-[10px] leading-snug" style={{ color: "var(--c-t3, #6b7280)" }}>
        Пороги сохраняются на этом компьютере и применяются ко всем схемам.
      </div>
      {SCHEMA_CHECK_SETTING_GROUPS.map((g) => (
        <div key={g.title}>
          <GroupTitle>{g.title}</GroupTitle>
          {g.fields.map((f) => {
            const def = DEFAULT_SCHEMA_CHECK_SETTINGS[f.key];
            const isChanged = settings[f.key] !== def;
            return (
              <div key={f.key} className="flex items-center gap-1.5 px-2 py-0.5">
                <span className="flex-1 min-w-0 text-[10px] leading-tight"
                  style={{ color: isChanged ? "var(--c-t1, #1f2328)" : "var(--c-t3, #6b7280)", fontWeight: isChanged ? 600 : 400 }}
                  title={`По умолчанию: ${def} ${f.unit}`}>
                  {f.label}
                </span>
                <input type="number" min={f.min} max={f.max} step={f.step} value={settings[f.key]}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isFinite(v)) return;
                    const clamped = Math.min(f.max ?? Infinity, Math.max(f.min, v));
                    onChange({ [f.key]: clamped } as Partial<SchemaCheckSettings>);
                  }}
                  className="w-16 h-5 px-1 rounded text-right text-[11px] outline-none flex-shrink-0"
                  style={{
                    background: "var(--c-s1, #fff)", border: `1px solid ${isChanged ? "var(--c-accent, #1e5a7a)" : "var(--c-b2, #d5d1c8)"}`,
                    color: "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)",
                  }} />
                <span className="w-10 text-[10px] flex-shrink-0" style={{ color: "var(--c-t4, #767f8c)" }}>{f.unit}</span>
              </div>
            );
          })}
        </div>
      ))}
      <div className="px-2 py-1.5">
        <button type="button" disabled={changed === 0}
          onClick={() => onChange({ ...DEFAULT_SCHEMA_CHECK_SETTINGS })}
          className="h-6 px-2 rounded flex items-center gap-1 text-[10px] font-medium transition-colors hover:bg-[var(--c-s3,#f1efea)] disabled:opacity-50"
          style={{ background: "transparent", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-accent, #1e5a7a)", cursor: changed ? "pointer" : "default" }}>
          <Icon name="RotateCcw" size={11} />
          Сбросить по умолчанию
        </button>
      </div>
    </div>
  );
}

// ─── Панель ────────────────────────────────────────────────────────────
export interface SolveBlockers { nodeIds: string[]; branchIds: string[]; message: string }

interface SchemaCheckPanelProps {
  result: FullCheckResult;
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  selectedNodeId: string | null;
  selectedBranchId: string | null;
  /** Раскрытая проверка. Её же открывает расчёт сети при ошибке. */
  openCheck: CheckTab | null;
  onOpenCheck: (id: CheckTab | null) => void;
  nearThreshold: number;
  onNearThreshold: (v: number) => void;
  highRThreshold: number;
  onHighRThreshold: (v: number) => void;
  bulkRThreshold: number;
  onBulkRThreshold: (v: number) => void;
  /** Все пороги проверки (настраиваются под рудник). */
  settings: SchemaCheckSettings;
  onSettings: (patch: Partial<SchemaCheckSettings>) => void;
  solveBlockers: SolveBlockers | null;
  onFocusNode: (id: string) => void;
  onFocusBranch: (id: string) => void;
  /** Выделить группу ветвей и показать первую */
  onSelectBranches: (ids: string[]) => void;
  onFocusSolveBlocker: (nodeIds: string[], branchIds: string[]) => void;
  onUpdateBranch: (id: string, patch: Partial<TopoBranch>) => void;
  onAllManualToAuto: () => void;
  /** Задать длину всем ветвям нулевой длины: по координатам узлов,
   *  а где узлы совпадают — указанное значение (вручную). */
  onFixZeroLen: (fallbackLen: number) => void;
  /** Выделить группу узлов и ветвей и показать её на схеме */
  onFocusGroup: (nodeIds: string[], branchIds: string[], focus?: { x: number; y: number; z: number }) => void;
}

export default function SchemaCheckPanel(p: SchemaCheckPanelProps) {
  const {
    result: r, nodes, branches, horizons, selectedNodeId, selectedBranchId,
    openCheck, onOpenCheck, solveBlockers, onFocusNode, onFocusBranch,
  } = p;
  const [showAll, setShowAll] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [zeroLenFallback, setZeroLenFallback] = useState(1);
  const cfg = p.settings;
  const changed = countChangedSettings(cfg);
  const num = (v: number) => String(v).replace(".", ",");

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const nodeName = (n: TopoNode) => n.name || `Узел ${n.number || n.id}`;
  const nodeNum = (id: string) => { const n = nodeById.get(id); return n?.number || n?.id || "?"; };
  const branchName = (b: TopoBranch) => `${b.type || `Ветвь ${b.id}`} (${nodeNum(b.fromId)}→${nodeNum(b.toId)})`;
  const autoLength = (b: TopoBranch) => {
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    return fn && tn ? Math.round(calcBranchLength(fn, tn)) : null;
  };

  const branchRow = (b: TopoBranch, detail: ReactNode, action?: ReactNode) => (
    <ItemRow key={b.id} title={branchName(b)} detail={detail} action={action}
      selected={selectedBranchId === b.id} onClick={() => onFocusBranch(b.id)} />
  );
  const nodePairRow = (a: TopoNode, b: TopoNode, detail: ReactNode) => (
    <ItemRow key={`${a.id}|${b.id}`} title={`${nodeName(a)} ↔ ${nodeName(b)}`} detail={detail}
      selected={selectedNodeId === a.id || selectedNodeId === b.id} onClick={() => onFocusNode(a.id)} />
  );
  const selectAllBtn = (ids: string[]) =>
    ids.length > 1 ? <div className="px-2 pb-1.5"><ActionBtn icon="MousePointerClick" label="Выделить все на схеме" onClick={() => p.onSelectBranches(ids)} /></div> : null;

  const branchNotes = (list: BranchNote[], empty: string, selectAll = true) => (
    <>
      {selectAll && selectAllBtn(list.map((x) => x.branch.id))}
      {list.length === 0 ? <Empty text={empty} /> : list.map(({ branch: b, note }) => branchRow(b, note))}
    </>
  );
  const nodeNotes = (list: NodeNote[], empty: string) =>
    list.length === 0 ? <Empty text={empty} /> : list.map(({ node: n, note }) => (
      <ItemRow key={n.id} title={nodeName(n)} detail={note}
        selected={selectedNodeId === n.id} onClick={() => onFocusNode(n.id)} />
    ));
  const groupNotes = (list: GroupNote[], empty: string) =>
    list.length === 0 ? <Empty text={empty} /> : list.map((g, i) => (
      <ItemRow key={`${g.title}|${i}`} title={g.title} detail={g.note}
        selected={g.branchIds.includes(selectedBranchId ?? "") || g.nodeIds.includes(selectedNodeId ?? "")}
        onClick={() => p.onFocusGroup(g.nodeIds, g.branchIds, g.focus)} />
    ));
  const { topo, params, solve, method } = r;
  const needSolve = <Empty text="Выполните расчёт сети (F9) — проверка использует его результаты" />;

  const solveCount = (solveBlockers?.nodeIds.length ?? 0) + (solveBlockers?.branchIds.length ?? 0);

  // Все проверки: порядок — от критичных к справочным.
  type Check = { id: CheckTab; group: string; icon: string; title: string; level: Level; count: number; body: () => ReactNode };
  const checks: Check[] = [
    {
      id: "solveBlock", group: "Расчёт сети", icon: "CircleAlert", level: "error", count: solveCount,
      title: "Участки, остановившие расчёт",
      body: () => (
        <>
          <Hint>Находятся при расчёте сети (F9): из-за этих узлов и ветвей сеть распалась на части и расчёт не прошёл.</Hint>
          {!solveBlockers ? <Empty text="Расчёт не сообщал о проблемах" /> : (
            <>
              <Alert>{solveBlockers.message}</Alert>
              <div className="px-2 pb-1.5">
                <ActionBtn icon="Crosshair" label="Показать на схеме"
                  onClick={() => p.onFocusSolveBlocker(solveBlockers.nodeIds, solveBlockers.branchIds)} />
              </div>
              {solveBlockers.nodeIds.map((id) => {
                const n = nodeById.get(id);
                if (!n) return null;
                return (
                  <ItemRow key={`n-${id}`} title={`Узел ${n.number || n.id}`} selected={selectedNodeId === id}
                    detail={`X ${fmt(n.x)} · Y ${fmt(n.y)} · Z ${fmt(n.z)}`}
                    onClick={() => p.onFocusSolveBlocker([id], [])} />
                );
              })}
              {solveBlockers.branchIds.map((id) => {
                const b = branchById.get(id);
                return b ? branchRow(b, `Горизонт: ${horizons.find((h) => h.id === b.horizonId)?.name ?? "не задан"}`) : null;
              })}
            </>
          )}
        </>
      ),
    },
    // ── Связность сети ──────────────────────────────────────────────────
    {
      id: "noFan", group: "Связность сети", icon: "Fan", level: "error", count: topo.noActiveFan ? 1 : 0,
      title: "Нет работающего вентилятора",
      body: () => (
        <>
          <Hint>Без главного или вспомогательного вентилятора воздух по сети движется только за счёт естественной тяги.</Hint>
          {topo.noActiveFan ? <Alert>Все вентиляторы остановлены или не заданы. Добавьте ГВУ на ветвь ствола или включите существующий.</Alert>
            : <Empty text="Вентиляторы заданы" />}
        </>
      ),
    },
    {
      id: "components", group: "Связность сети", icon: "Split", level: "error", count: topo.components.length,
      title: "Сеть распалась на части",
      body: () => (
        <>
          <Hint>Эти части не соединены с основной сетью ни одной ветвью. Воздух в них не попадёт — проверьте стыковку.</Hint>
          {groupNotes(topo.components, "Сеть единая")}
        </>
      ),
    },
    {
      id: "deadFan", group: "Связность сети", icon: "Fan", level: "error", count: topo.deadFans.length,
      title: "Вентилятор стоит в тупике",
      body: () => (
        <>
          <Hint>Один конец ветви с вентилятором никуда не ведёт — вентилятору некуда подавать воздух.</Hint>
          {branchNotes(topo.deadFans, "Все вентиляторы включены в сеть", false)}
        </>
      ),
    },
    {
      id: "tJunction", group: "Связность сети", icon: "GitCommitHorizontal", level: "error", count: topo.tJunctions.length,
      title: "Примыкание без общего узла",
      body: () => (
        <>
          <Hint>Узел лежит на оси другой выработки, но не соединён с ней. На чертеже примыкание есть, а в расчёте его нет. Разделите ветвь этим узлом.</Hint>
          {groupNotes(topo.tJunctions, "Несостыкованных примыканий нет")}
        </>
      ),
    },
    {
      id: "crossing", group: "Связность сети", icon: "X", level: "warn", count: topo.crossings.length,
      title: "Пересечение без общего узла",
      body: () => (
        <>
          <Hint>Оси выработок сходятся в объёме ближе допуска (по маркшейдерским координатам), но общего узла нет. Если это сопряжение — поставьте узел; если выработки на разных уровнях — поправьте отметки.</Hint>
          {groupNotes(topo.crossings, "Пересечений нет")}
        </>
      ),
    },
    {
      id: "selfLoop", group: "Связность сети", icon: "RefreshCcw", level: "error", count: topo.selfLoops.length,
      title: "Ветвь замкнута сама на себя",
      body: () => (
        <>
          <Hint>Начало и конец ветви — один узел. Обычно появляется после слияния узлов; такую ветвь нужно удалить.</Hint>
          {branchNotes(topo.selfLoops, "Таких ветвей нет")}
        </>
      ),
    },
    {
      id: "deadEnd", group: "Связность сети", icon: "CornerDownRight", level: "info", count: topo.deadEnds.length,
      title: "Тупики без проветривания",
      body: () => (
        <>
          <Hint>Тупиковая выработка длиной более 10 м (длина считается по всему тупику от забоя до сопряжения, через промежуточные узлы), в ней нет ВМП и вентстава — расход в модели будет 0. Тупики до 10 м проветриваются за счёт диффузии (ФНИП, приказ № 505) и не показываются. Если это забой, задайте ВМП; если ветвь «Тупиковая» — отметьте это в свойствах.</Hint>
          {groupNotes(topo.deadEnds, "Тупиков без проветривания нет")}
        </>
      ),
    },
    // ── Параметры ───────────────────────────────────────────────────────
    {
      id: "invalidValues", group: "Параметры ветвей", icon: "FileWarning", level: "error", count: params.invalidValues.length,
      title: "Некорректные числа",
      body: () => (
        <>
          <Hint>Отрицательные или нечисловые значения — обычно сдвиг столбцов или запятая вместо точки при импорте.</Hint>
          {branchNotes(params.invalidValues, "Все значения корректны")}
        </>
      ),
    },
    {
      id: "fanNoCurve", group: "Параметры ветвей", icon: "Fan", level: "error", count: params.fanNoCurve.length,
      title: "Вентилятор без характеристики",
      body: () => (
        <>
          <Hint>Вентилятор включён, но не создаёт напора: не выбрана модель или депрессия равна нулю.</Hint>
          {branchNotes(params.fanNoCurve, "У всех вентиляторов задана характеристика", false)}
        </>
      ),
    },
    {
      id: "badArea", group: "Параметры ветвей", icon: "Square", level: "warn", count: params.badArea.length,
      title: "Сечение не задано или неправдоподобно",
      body: () => (
        <>
          <Hint>Допустимым считается {num(cfg.areaMin)}…{num(cfg.areaMax)} м². Сечение входит в сопротивление в кубе — ошибка в 10 раз меняет R в 1000 раз.</Hint>
          {branchNotes(params.badArea, "Сечения в норме")}
        </>
      ),
    },
    {
      id: "shortManualLen", group: "Параметры ветвей", icon: "Ruler", level: "warn", count: params.shortManualLen.length,
      title: "Ручная длина короче расстояния между узлами",
      body: () => (
        <>
          <Hint>Выработка не может быть короче прямой между её концами — сопротивление занижено.</Hint>
          {params.shortManualLen.length === 0 ? <Empty text="Таких ветвей нет" /> :
            params.shortManualLen.map(({ branch: b, note }) => {
              const auto = autoLength(b);
              return branchRow(b, note, auto ? <ActionBtn icon="RefreshCw" label="Авто"
                onClick={() => p.onUpdateBranch(b.id, { manualLength: false, length: auto })} /> : undefined);
            })}
        </>
      ),
    },
    {
      id: "badAlpha", group: "Параметры ветвей", icon: "Waves", level: "warn", count: params.badAlpha.length,
      title: "Коэффициент α вне диапазона",
      body: () => (
        <>
          <Hint>Коэффициент аэродинамического сопротивления равен нулю или вне диапазона {num(cfg.alphaMin)}…{num(cfg.alphaMax)}·10⁻⁴ Н·с²/м⁴.</Hint>
          {branchNotes(params.badAlpha, "Коэффициенты в норме")}
        </>
      ),
    },
    {
      id: "zeroBulkhead", group: "Параметры ветвей", icon: "DoorOpen", level: "warn", count: params.zeroBulkhead.length,
      title: "Перемычка без сопротивления",
      body: () => (
        <>
          <Hint>Перемычка отмечена, но её сопротивление 0 — в расчёте это открытый проём.</Hint>
          {branchNotes(params.zeroBulkhead, "Все перемычки заданы")}
        </>
      ),
    },
    {
      id: "lostZ", group: "Параметры ветвей", icon: "ArrowDownToLine", level: "warn", count: params.lostZ.length,
      title: "Потерянные высотные отметки",
      body: () => (
        <>
          <Hint>Узел стоит на отметке 0, а вся сеть вокруг — глубоко. Это ложный перепад высот и ложная естественная тяга.</Hint>
          {nodeNotes(params.lostZ, "Отметки в порядке")}
        </>
      ),
    },
    {
      id: "tinyBranch", group: "Параметры ветвей", icon: "Minimize2", level: "info", count: params.tinyBranches.length,
      title: "Очень короткие ветви",
      body: () => (
        <>
          <Hint>Ветви короче {num(cfg.tinyLength)} м почти не влияют на расчёт, но усложняют схему и замедляют сходимость.</Hint>
          {branchNotes(params.tinyBranches, "Таких ветвей нет")}
        </>
      ),
    },
    // ── После расчёта ───────────────────────────────────────────────────
    {
      id: "fanAgainst", group: "Результаты расчёта", icon: "Undo2", level: "error", count: solve.fanAgainstFlow.length,
      title: "Вентилятор работает против потока",
      body: () => (
        <>
          <Hint>Воздух идёт через вентилятор в обратную сторону: соседний вентилятор сильнее или неверно задано направление ветви.</Hint>
          {!solve.solved ? needSolve : branchNotes(solve.fanAgainstFlow, "Все вентиляторы работают по направлению", false)}
        </>
      ),
    },
    {
      id: "faceDeficit", group: "Результаты расчёта", icon: "Pickaxe", level: "error", count: solve.faceDeficit.length,
      title: "Забою не хватает воздуха",
      body: () => (
        <>
          <Hint>Фактический расход меньше требуемого по нормам (люди, ВВ, дизель, мин. скорость).</Hint>
          {!solve.solved ? needSolve : branchNotes(solve.faceDeficit, "Воздуха хватает во всех забоях")}
        </>
      ),
    },
    {
      id: "highV", group: "Результаты расчёта", icon: "Wind", level: "error", count: solve.highVelocity.length,
      title: "Скорость воздуха выше допустимой",
      body: () => (
        <>
          <Hint>Предел берётся из справочника норм и свойства «Макс. скорость» ветви (меньшее из двух).</Hint>
          {!solve.solved ? needSolve : branchNotes(solve.highVelocity, "Скорости в пределах нормы")}
        </>
      ),
    },
    {
      id: "recirc", group: "Результаты расчёта", icon: "Repeat", level: "error", count: solve.recirculation.length,
      title: "Рециркуляция у ВМП",
      body: () => (
        <>
          <Hint>ВМП забирает больше {num(cfg.recircPercent)} % воздуха, идущего к нему по выработке, — он начнёт гонять по кругу загрязнённый воздух.</Hint>
          {!solve.solved ? needSolve : branchNotes(solve.recirculation, "Рециркуляции нет", false)}
        </>
      ),
    },
    {
      id: "fanRange", group: "Результаты расчёта", icon: "Gauge", level: "warn", count: solve.fanOutOfRange.length,
      title: "Рабочая точка вне характеристики",
      body: () => (
        <>
          <Hint>Расход вентилятора вышел за паспортную зону — результат ненадёжен, возможен помпаж или срыв.</Hint>
          {!solve.solved ? needSolve : branchNotes(solve.fanOutOfRange, "Все вентиляторы в рабочей зоне", false)}
        </>
      ),
    },
    {
      id: "leakNorm", group: "Результаты расчёта", icon: "DoorClosed", level: "warn", count: solve.leakNorm.length,
      title: "Утечки через перемычки выше нормы",
      body: () => (
        <>
          <Hint>Фактический расход через закрытую перемычку сравнивается с нормой утечек, пересчитанной на её перепад давления: Qн = Qн50·√(ΔP/50), где Qн50 — норма при 50 Па (м³/мин) из справочника перемычек или свойств значка. Список отсортирован по превышению.</Hint>
          {!solve.solved ? needSolve : (
            <>
              {solve.leakNormMissing > 0 && (
                <Hint>Не проверено перемычек без заданной нормы утечек: {solve.leakNormMissing}. Задайте норму в Справочники → Перемычки или в свойствах значка.</Hint>
              )}
              {branchNotes(solve.leakNorm, "Утечки через все перемычки в пределах нормы")}
            </>
          )}
        </>
      ),
    },
    {
      id: "leakage", group: "Результаты расчёта", icon: "Droplets", level: "warn", count: solve.leakage ? Math.max(1, solve.leakage.branches.length) : 0,
      title: "Большие утечки через перемычки",
      body: () => (
        <>
          <Hint>В список попадают закрытые перемычки и двери, через которые уходит от {num(cfg.leakBulkMin)}{cfg.leakBulkMax > 0 ? ` до ${num(cfg.leakBulkMax)}` : ""} м³/с. Отдельно проверяется общая доля: через все перемычки уходит больше {num(cfg.leakPercent)} % подачи главных вентиляторов. Регулируемые окна, открытые двери и ветви с вентиляторами в утечки не входят.</Hint>
          <LeakRangeEditor min={cfg.leakBulkMin} max={cfg.leakBulkMax} onChange={p.onSettings} />
          {!solve.solved ? needSolve : !solve.leakage ? <Empty text="Утечки в допустимых пределах" /> : (
            <>
              {solve.leakage.fanFlow > 0 && solve.leakage.percent > cfg.leakPercent && (
                <Alert>
                  Утечки {fmt(solve.leakage.leakFlow, 1)} м³/с — {fmt(solve.leakage.percent, 0)} % от подачи {fmt(solve.leakage.fanFlow, 1)} м³/с
                </Alert>
              )}
              {solve.leakage.windowFlow > 0.01 && (
                <Hint>Через регулируемые окна и открытые проёмы проходит ещё {fmt(solve.leakage.windowFlow, 1)} м³/с — это не утечки.</Hint>
              )}
              {solve.leakage.branches.length > 0 && (
                <Hint>В диапазоне: {solve.leakage.branches.length} шт., всего {fmt(solve.leakage.listedFlow, 1)} м³/с.</Hint>
              )}
              {solve.leakage.hiddenCount > 0 && (
                <Hint>Перемычек с утечкой вне диапазона (не показаны): {solve.leakage.hiddenCount}.</Hint>
              )}
              {solve.leakage.branches.length === 0
                ? <Empty text="Перемычек с утечкой в заданном диапазоне нет" />
                : branchNotes(solve.leakage.branches, "")}
            </>
          )}
        </>
      ),
    },
    {
      id: "lowV", group: "Результаты расчёта", icon: "Wind", level: "info", count: solve.lowVelocity.length,
      title: "Скорость ниже минимальной",
      body: () => (
        <>
          <Hint>Застой воздуха. Минимальные скорости для забоев и прочих выработок берутся из справочника норм (ФНиП).</Hint>
          {!solve.solved ? needSolve : branchNotes(solve.lowVelocity, "Застойных выработок нет")}
        </>
      ),
    },
    // ── По методике проверки моделей (ВГСЧ, 2023) ───────────────────────
    {
      id: "measureMismatch", group: "Результаты расчёта", icon: "Gauge", level: "error",
      count: method.measureMismatch.length,
      title: "Замер на станции не совпадает с моделью",
      body: () => (
        <>
          <Hint>Модельный расход отличается от замеренного на замерной станции более чем на {num(cfg.measureTolCapital)} % в капитальных и {num(cfg.measureTolOther)} % в остальных выработках. Модель не соответствует фактическому воздухораспределению — уточните сопротивления.</Hint>
          {method.measureTotal === 0 ? <Empty text="На схеме нет замерных станций" /> : (
            <>
              {method.measureNoData > 0 && (
                <Hint>Без замеренного расхода: {method.measureNoData} из {method.measureTotal} станций — они не проверялись.</Hint>
              )}
              {!solve.solved ? needSolve : branchNotes(method.measureMismatch, "Замеры совпадают с моделью")}
            </>
          )}
        </>
      ),
    },
    {
      id: "controlAlpha", group: "Параметры ветвей", icon: "Sigma", level: "warn", count: method.controlAlpha.length,
      title: "Контрольный α вне диапазона",
      body: () => (
        <>
          <Hint>α = R·S³/(P·L) по итоговому сопротивлению ветви, в т. ч. заданному вручную или по съёмке. Для действующих выработок {num(cfg.controlAlphaMin)}…{num(cfg.controlAlphaMax)} Н·с²/м⁴. Выход за пределы — неверное R или неучтённое местное сопротивление (укажите его в примечании ветви).</Hint>
          {branchNotes(method.controlAlpha, "Контрольные α в норме")}
        </>
      ),
    },
    {
      id: "alphaJump", group: "Параметры ветвей", icon: "ChartNoAxesColumn", level: "warn", count: method.alphaJump.length,
      title: "Скачок α между соседними ветвями",
      body: () => (
        <>
          <Hint>Соседние ветви одной выработки с близкими сечениями, а α отличается более чем на 100 %. Причина — местное (лобовое) сопротивление: привод, перегруз, энергопоезд — или ошибка в R. Местное сопротивление отметьте в примечании ветви.</Hint>
          {groupNotes(method.alphaJump, "Скачков α нет")}
        </>
      ),
    },
    {
      id: "areaJump", group: "Параметры ветвей", icon: "Scaling", level: "info", count: method.areaJump.length,
      title: "Сечение меняется вдоль выработки",
      body: () => (
        <>
          <Hint>Сечения соседних ветвей одной выработки отличаются более чем на {num(cfg.areaJumpPercent)} %. Сверьте с документацией ОПО; подтверждённое расширение или сужение укажите в примечании ветви.</Hint>
          {groupNotes(method.areaJump, "Сечения вдоль выработок согласованы")}
        </>
      ),
    },
    {
      id: "surfaceMulti", group: "Связность сети", icon: "Cloud", level: "error", count: method.surfaceMulti.length,
      title: "Поверхностный узел соединён с несколькими ветвями",
      body: () => (
        <>
          <Hint>Узел связи с атмосферой должен быть концом одной ветви (устье ствола, выход штольни). Если к нему подходит несколько ветвей, давление атмосферы подаётся внутрь сети и искажает воздухораспределение.</Hint>
          {nodeNotes(method.surfaceMulti, "Поверхностные узлы заданы верно")}
        </>
      ),
    },
    {
      id: "bulkheadNorm", group: "Ветви", icon: "ShieldAlert", level: "warn", count: method.bulkheadNorm.length,
      title: "Сопротивление сооружения вне нормы для вида",
      body: () => (
        <>
          <Hint>Ориентировочные нормы: изолирующие перемычки не менее 10 кμ и не более {num(cfg.isolMaxR)} кμ (с герметизацией ×2,25); шлюзы — от 1,5 кμ в капитальных, 0,8 кμ в участковых, 0,3 кμ в конвейерных выработках; регуляторы с окном — не более 10 кμ и не меньше сопротивления своей выработки.</Hint>
          {branchNotes(method.bulkheadNorm, "Сооружения в норме")}
        </>
      ),
    },
    {
      id: "bulkheadFailure", group: "Ветви", icon: "Bomb", level: "warn", count: method.bulkheadFailure.length,
      title: "Не задано давление разрушения перемычки",
      body: () => (
        <>
          <Hint>Давление разрушения нужно для расчёта взрыва и выбора взрывоустойчивых перемычек. Если оно не задано, расчёт берёт типовое значение по материалу (бетон 0,08, кирпич 0,04, металл 0,02, дерево 0,01 МПа) — перемычка может оказаться прочнее или слабее фактической. Задайте значение в свойствах перемычки или выберите её из справочника.</Hint>
          {branchNotes(method.bulkheadFailure, "Давление разрушения задано у всех перемычек")}
        </>
      ),
    },
    {
      id: "positionDupes", group: "План ликвидации аварий", icon: "ListOrdered", level: "warn", count: method.positionDupes.length,
      title: "Повторяющиеся номера позиций ПЛА",
      body: () => (
        <>
          <Hint>Разные позиции (другое название или вид аварии) имеют один номер — в оперативной части ПЛА ссылки на позицию станут неоднозначными. Копии одной позиции с тем же названием допустимы и не считаются ошибкой. Перенумеруйте позиции во вкладке «Позиции».</Hint>
          {method.positionsTotal === 0 ? <Empty text="На схеме нет позиций ПЛА" /> : groupNotes(method.positionDupes, "Номера позиций не повторяются")}
        </>
      ),
    },
    {
      id: "branchNoPosition", group: "План ликвидации аварий", icon: "MapPinOff", level: "info", count: method.branchNoPosition.length,
      title: "Выработки без позиции ПЛА",
      body: () => (
        <>
          <Hint>Каждая выработка должна входить хотя бы в одну позицию плана ликвидации аварий — иначе для аварии в ней не определены действия. Привяжите выработки к позициям во вкладке «Позиции» (кнопка привязки ветвей). Нити вентрубопроводов и ветви утечек не проверяются.</Hint>
          {method.positionsTotal === 0 ? <Empty text="На схеме нет позиций ПЛА — проверка не выполнялась" /> : branchNotes(method.branchNoPosition, "Все выработки входят в позиции")}
        </>
      ),
    },
    {
      id: "brokenBranch", group: "Ветви", icon: "Unlink", level: "error", count: r.brokenBranches.length,
      title: "Ветвь ссылается на удалённый узел",
      body: () => (
        <>
          <Hint>Узел удалили или перенумеровали, а ветвь осталась. Сеть распадается, расчёт обнуляется.</Hint>
          {selectAllBtn(r.brokenBranches.map((x) => x.branch.id))}
          {r.brokenBranches.length === 0 ? <Empty text="Все ветви привязаны к узлам" /> :
            r.brokenBranches.map(({ branch: b, missing, missingIds }) => branchRow(b,
              `Нет ${missing === "both" ? "обоих узлов" : missing === "from" ? "начального узла" : "конечного узла"}: ${missingIds.join(", ")}`))}
        </>
      ),
    },
    {
      id: "isolatedBranch", group: "Ветви", icon: "Network", level: "error",
      count: r.isolatedBranches.length + (r.noAtmosphere && branches.length > 0 ? 1 : 0),
      title: "Нет связи с поверхностью",
      body: () => (
        <>
          <Hint>У этих ветвей нет пути к атмосферному узлу — по ним невозможно рассчитать воздухораспределение.</Hint>
          {r.noAtmosphere && branches.length > 0 && (
            <Alert>В схеме нет ни одного выхода на поверхность. Отметьте хотя бы один узел как связанный с атмосферой.</Alert>
          )}
          {selectAllBtn(r.isolatedBranches.map((b) => b.id))}
          {r.isolatedBranches.length === 0
            ? (!r.noAtmosphere && <Empty text="Вся сеть связана с поверхностью" />)
            : r.isolatedBranches.map((b) => branchRow(b, `L ${fmt(b.length)} м · S ${fmt(b.area, 1)} м²`))}
        </>
      ),
    },
    {
      id: "zeroLen", group: "Ветви", icon: "MoveHorizontal", level: "error", count: r.zeroLenBranches.length,
      title: "Длина ветви равна нулю",
      body: () => (
        <>
          <Hint>Без длины у ветви нет сопротивления — расчёт невозможен.</Hint>
          {r.zeroLenBranches.length > 0 && (() => {
            const noCoords = r.zeroLenBranches.filter((b) => !autoLength(b)).length;
            return (
              <>
                {noCoords > 0 && (
                  <ThresholdInput label={`Узлы совпадают (${noCoords}) — длина`} unit="м"
                    value={zeroLenFallback} min={0.1} step={1} onChange={setZeroLenFallback} />
                )}
                <div className="px-2 pb-1.5">
                  <ActionBtn icon="Ruler" label={`Задать длину всем (${r.zeroLenBranches.length})`}
                    onClick={() => p.onFixZeroLen(zeroLenFallback)} />
                </div>
                <Hint>По координатам узлов; если узлы совпадают — заданное значение (как ручная длина).</Hint>
              </>
            );
          })()}
          {r.zeroLenBranches.length === 0 ? <Empty text="Таких ветвей нет" /> :
            r.zeroLenBranches.map((b) => {
              const auto = autoLength(b);
              return branchRow(b, `S ${fmt(b.area, 1)} м²${auto ? ` · по координатам ${auto} м` : ""}`,
                auto ? <ActionBtn icon="Ruler" label={`${auto} м`}
                  onClick={() => p.onUpdateBranch(b.id, { manualLength: false, length: auto })} /> : undefined);
            })}
        </>
      ),
    },
    {
      id: "zeroR", group: "Ветви", icon: "CircleSlash", level: "error", count: r.zeroRBranches.length,
      title: "Сопротивление ветви равно нулю",
      body: () => (
        <>
          <Hint>Ветвь с R = 0 искажает распределение воздуха.</Hint>
          {r.zeroRBranches.length === 0 ? <Empty text="Таких ветвей нет" /> :
            r.zeroRBranches.map((b) => branchRow(b, `L ${fmt(b.length)} м · S ${fmt(b.area, 1)} м²`))}
        </>
      ),
    },
    {
      id: "dupbranch", group: "Ветви", icon: "CopyPlus", level: "warn", count: r.dupBranches.length,
      title: "Несколько ветвей между двумя узлами",
      body: () => (
        <>
          <Hint>Одну пару узлов соединяют несколько ветвей. Проверьте, не построена ли выработка дважды.</Hint>
          {r.dupBranches.length === 0 ? <Empty text="Повторов нет" /> :
            r.dupBranches.map(({ branches: grp, key }) => (
              <div key={key} className="mb-1 pl-1.5 ml-1" style={{ borderLeft: "2px solid var(--c-b2, #d5d1c8)" }}>
                {grp.map((b) => branchRow(b, `L ${fmt(b.length)} м · R ${fmt(b.resistance ?? 0, 3)}`))}
              </div>
            ))}
        </>
      ),
    },
    {
      id: "highR", group: "Ветви", icon: "TrendingUp", level: "warn", count: r.highRBranches.length,
      title: "Слишком большое сопротивление",
      body: () => (
        <>
          <Hint>Сопротивление выше порога — вероятна ошибка в сечении или длине.</Hint>
          <ThresholdInput label="Порог" unit="кМюрг" value={p.highRThreshold} min={0} step={10} onChange={p.onHighRThreshold} />
          {r.highRBranches.length === 0 ? <Empty text="Таких ветвей нет" /> :
            r.highRBranches.map((b) => branchRow(b, `R ${fmt(b.resistance ?? 0, 2)} · L ${fmt(b.length)} м · S ${fmt(b.area, 1)} м²`))}
        </>
      ),
    },
    {
      id: "bulkR", group: "Ветви", icon: "DoorClosed", level: "warn", count: r.bulkBranches.length,
      title: "Перемычка выше норматива",
      body: () => (
        <>
          <Hint>Сопротивление перемычки превышает норматив.</Hint>
          <ThresholdInput label="Норматив" unit="кМюрг" value={p.bulkRThreshold} min={0} step={1} onChange={p.onBulkRThreshold} />
          {r.bulkBranches.length === 0 ? <Empty text="Все перемычки в норме" /> :
            r.bulkBranches.map(({ branch: b, rKmu }) => branchRow(b, `${r.bulkheads.get(b.id)?.name ?? (b.bulkheadName || "Перемычка")} · R ${fmt(rKmu)} кМюрг`))}
        </>
      ),
    },
    {
      id: "manualLen", group: "Ветви", icon: "Ruler", level: "info", count: r.manualLenBranches.length,
      title: "Длина задана вручную",
      body: () => (
        <>
          <Hint>Длина не пересчитывается из координат. Меньше реальной — сопротивление занижено, больше — завышено.</Hint>
          {r.manualLenBranches.length > 0 && (
            <div className="px-2 pb-1.5"><ActionBtn icon="RefreshCw" label="Все по координатам" onClick={p.onAllManualToAuto} /></div>
          )}
          {r.manualLenBranches.length === 0 ? <Empty text="Таких ветвей нет" /> :
            r.manualLenBranches.map((b) => {
              const auto = autoLength(b);
              return branchRow(b, `Вручную ${fmt(b.length)} м${auto != null ? ` · по координатам ${auto} м` : ""}`,
                <ActionBtn icon="RefreshCw" label="Авто"
                  onClick={() => p.onUpdateBranch(b.id, { manualLength: false, length: auto ?? b.length })} />);
            })}
        </>
      ),
    },
    {
      id: "near", group: "Узлы", icon: "GitMerge", level: "warn", count: r.nearPairs.length,
      title: "Близкие, но не соединённые узлы",
      body: () => (
        <>
          <Hint>Узлы почти совпадают в пространстве, но ветвью не соединены — возможно, выработки не состыкованы.</Hint>
          <ThresholdInput label="Расстояние до" unit="м" value={p.nearThreshold} min={0.01} step={0.1} onChange={p.onNearThreshold} />
          {r.nearPairs.length === 0 ? <Empty text="Таких узлов нет" /> :
            r.nearPairs.map(({ a, b, dist }) => nodePairRow(a, b, `${fmt(dist, dist < 0.1 ? 3 : dist < 1 ? 2 : 1)} м`))}
        </>
      ),
    },
    {
      id: "dupes", group: "Узлы", icon: "Copy", level: "warn", count: r.dupes.length,
      title: "Узлы с одинаковыми координатами",
      body: () => (
        <>
          <Hint>Два узла стоят в одной точке — обычно лишний узел после импорта или копирования.</Hint>
          {r.dupes.length === 0 ? <Empty text="Совпадений нет" /> :
            r.dupes.map(({ a, b }) => nodePairRow(a, b, `X ${fmt(a.x, 2)} · Y ${fmt(a.y, 2)} · Z ${fmt(a.z, 2)}`))}
        </>
      ),
    },
    {
      id: "isolated", group: "Узлы", icon: "CircleDashed", level: "warn", count: r.isolated.length,
      title: "Узлы без ветвей",
      body: () => (
        <>
          <Hint>К узлу не подходит ни одна ветвь — его можно удалить.</Hint>
          {r.isolated.length === 0 ? <Empty text="Таких узлов нет" /> :
            r.isolated.map((n) => (
              <ItemRow key={n.id} title={nodeName(n)} selected={selectedNodeId === n.id}
                detail={`X ${fmt(n.x)} · Y ${fmt(n.y)} · Z ${fmt(n.z)}`} onClick={() => onFocusNode(n.id)} />
            ))}
        </>
      ),
    },
  ];

  // Критические — ошибки модели, из-за которых расчёт невозможен или заведомо
  // неверен (топология, сопротивления, вентиляторы, высоты). Всё остальное —
  // некритические: нарушения норм по результатам корректного расчёта,
  // подозрительные, но допустимые значения и справочные замечания.
  const isCritical = (c: Check) => CRITICAL_CHECKS.has(c.id);
  for (const c of checks) {
    if (isCritical(c)) c.level = "error";
    else if (c.level === "error") c.level = "warn";
  }

  const critical = checks.filter(isCritical);
  const minor = checks.filter((c) => !isCritical(c));
  const errors = critical.reduce((s, c) => s + c.count, 0);
  const warns = minor.reduce((s, c) => s + c.count, 0);
  const found = checks.filter((c) => c.count > 0).length;
  // Раскрытую проверку показываем всегда — даже пустую: её мог открыть расчёт.
  const isVisible = (c: Check) => showAll || c.count > 0 || c.id === openCheck;
  const GROUP_ORDER = ["Расчёт сети", "Связность сети", "Ветви", "Параметры ветвей", "Узлы", "Результаты расчёта", "План ликвидации аварий"];
  const LEVEL_ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2 };
  const buildSection = (list: Check[]) => {
    const vis = list.filter(isVisible);
    return GROUP_ORDER
      .map((g) => ({ g, items: vis.filter((c) => c.group === g).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) }))
      .filter((x) => x.items.length > 0);
  };
  const sections = [
    {
      key: "critical", title: "Критические", sub: "Расчёт невозможен или будет неверным",
      icon: "OctagonAlert", color: LEVEL_COLOR.error, count: errors, groups: buildSection(critical),
    },
    {
      key: "minor", title: "Некритические", sub: "Расчёт верный — нарушения норм и замечания",
      icon: "AlertTriangle", color: LEVEL_COLOR.warn, count: warns, groups: buildSection(minor),
    },
  ].filter((s) => s.groups.length > 0);
  const visibleCount = sections.reduce((s, x) => s + x.groups.length, 0);

  const status: { color: string; icon: string; text: string; sub: string } =
    errors > 0 ? {
      color: LEVEL_COLOR.error, icon: "CircleX", text: `Критических ошибок: ${errors}`,
      sub: `Расчёт будет неверным — исправьте их в первую очередь${warns > 0 ? ` · некритических: ${warns}` : ""}`,
    }
    : warns > 0 ? { color: LEVEL_COLOR.warn, icon: "AlertTriangle", text: `Некритических замечаний: ${warns}`, sub: "Критических ошибок нет — расчёт корректен, но стоит проверить" }
    : { color: "var(--c-green, #15803d)", icon: "CircleCheck", text: "Схема в порядке", sub: "Ошибок и замечаний не найдено" };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--c-s2, #f8f7f4)" }}>
      {/* Итог + фильтр */}
      <div className="px-2 pt-2 pb-2 space-y-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-b1, #e7e4dd)" }}>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: tint(status.color, 10) }}>
          <Icon name={status.icon} size={16} style={{ color: status.color }} className="flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold" style={{ color: status.color }}>{status.text}</div>
            <div className="text-[10px]" style={{ color: "var(--c-t3, #6b7280)" }}>{status.sub}</div>
          </div>
        </div>
        {(r.truncated || topo.truncated || params.truncated || solve.truncated || method.truncated) && (
          <div className="text-[10px] flex items-start gap-1" style={{ color: "var(--c-t3, #6b7280)" }}>
            <Icon name="Info" size={11} className="flex-shrink-0 mt-px" />
            Показаны первые 500 результатов в каждом списке.
          </div>
        )}
        <button type="button" onClick={() => setShowSettings((v) => !v)}
          className="w-full h-6 px-2 rounded flex items-center gap-1.5 text-[11px] transition-colors hover:bg-[var(--c-s3,#f1efea)]"
          style={{ background: "transparent", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3d434b)", cursor: "pointer" }}>
          <Icon name="SlidersHorizontal" size={12} />
          <span className="flex-1 text-left">Настройки проверки</span>
          {changed > 0 && (
            <span className="text-[10px] px-1.5 rounded-full font-semibold"
              style={{ background: tint(LEVEL_COLOR.info), color: LEVEL_COLOR.info }} title="Изменено порогов">
              изм. {changed}
            </span>
          )}
          <Icon name={showSettings ? "ChevronUp" : "ChevronDown"} size={12} />
        </button>
        {showSettings && (
          <SettingsForm settings={cfg} onChange={p.onSettings} />
        )}
        <div className="flex p-0.5 rounded" style={{ background: "var(--c-s3, #f1efea)" }}>
          {([[false, `Найдено (${found})`], [true, `Все проверки (${checks.length})`]] as const).map(([all, label]) => {
            const on = showAll === all;
            return (
              <button key={label} type="button" onClick={() => setShowAll(all)}
                className="flex-1 h-6 px-2 rounded text-[11px] transition-colors"
                style={{
                  border: "none", cursor: "pointer",
                  background: on ? "var(--c-s1, #fff)" : "transparent",
                  color: on ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)",
                  fontWeight: on ? 600 : 400,
                  boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none",
                }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Проверки */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {visibleCount === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Icon name="ShieldCheck" size={28} style={{ color: "var(--c-green, #15803d)" }} />
            <span className="text-[11px]" style={{ color: "var(--c-t3, #6b7280)" }}>
              Все {checks.length} проверок пройдены
            </span>
          </div>
        )}
        {sections.map((s, si) => (
          <div key={s.key} className={`space-y-1.5 ${si > 0 ? "pt-2" : ""}`}>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
              style={{ background: tint(s.color, 8), borderLeft: `3px solid ${s.color}` }}>
              <Icon name={s.icon} size={14} style={{ color: s.color }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: s.color }}>{s.title}</div>
                <div className="text-[10px] leading-tight" style={{ color: "var(--c-t3, #6b7280)" }}>{s.sub}</div>
              </div>
              <span className="text-[10px] px-1.5 rounded-full font-semibold flex-shrink-0"
                style={{
                  fontFamily: "var(--font-num)",
                  background: s.count > 0 ? tint(s.color) : tint("var(--c-green, #15803d)"),
                  color: s.count > 0 ? s.color : "var(--c-green, #15803d)",
                }}>
                {s.count}
              </span>
            </div>
            {s.groups.map(({ g, items }) => (
              <div key={g} className="space-y-1.5">
                <GroupTitle>{g}</GroupTitle>
                {items.map((c) => (
                  <CheckCard key={c.id} icon={c.icon} title={c.title} count={c.count} level={c.level}
                    open={openCheck === c.id} onToggle={() => onOpenCheck(openCheck === c.id ? null : c.id)}>
                    {c.body()}
                  </CheckCard>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}