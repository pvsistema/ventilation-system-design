// Панель «Проверка схемы» — список проверок в стиле панели информации.
//
// Каждая проверка — раскрывающаяся карточка: понятное название, число
// найденных нарушений и список объектов. Клик по строке показывает объект
// на схеме. Все цвета берутся из палитры темы (--c-*), поэтому панель
// одинаково читается в светлой и тёмной теме.
import { useState, type ReactNode } from "react";
import Icon from "@/components/ui/icon";
import { type TopoNode, type TopoBranch, type Horizon, calcBranchLength } from "@/lib/topology";
import { type SchemaCheckResult } from "@/lib/schemaCheck";
import { type CheckTab } from "@/pages/cad/useCadSchemaCheck";

type Level = "error" | "warn" | "info";

const LEVEL_COLOR: Record<Level, string> = {
  error: "var(--c-red, #dc2626)",
  warn: "var(--c-amber, #a66b0d)",
  info: "var(--c-accent, #1e5a7a)",
};

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

// ─── Панель ────────────────────────────────────────────────────────────
export interface SolveBlockers { nodeIds: string[]; branchIds: string[]; message: string }

interface SchemaCheckPanelProps {
  result: SchemaCheckResult;
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
  solveBlockers: SolveBlockers | null;
  onFocusNode: (id: string) => void;
  onFocusBranch: (id: string) => void;
  /** Выделить группу ветвей и показать первую */
  onSelectBranches: (ids: string[]) => void;
  onFocusSolveBlocker: (nodeIds: string[], branchIds: string[]) => void;
  onUpdateBranch: (id: string, patch: Partial<TopoBranch>) => void;
  onAllManualToAuto: () => void;
}

export default function SchemaCheckPanel(p: SchemaCheckPanelProps) {
  const {
    result: r, nodes, branches, horizons, selectedNodeId, selectedBranchId,
    openCheck, onOpenCheck, solveBlockers, onFocusNode, onFocusBranch,
  } = p;
  const [showAll, setShowAll] = useState(false);

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
            r.bulkBranches.map(({ branch: b, rKmu }) => branchRow(b, `${b.bulkheadName || "Перемычка"} · R ${fmt(rKmu)} кМюрг`))}
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

  const errors = checks.filter((c) => c.level === "error").reduce((s, c) => s + c.count, 0);
  const warns = checks.filter((c) => c.level === "warn").reduce((s, c) => s + c.count, 0);
  const found = checks.filter((c) => c.count > 0).length;
  // Раскрытую проверку показываем всегда — даже пустую: её мог открыть расчёт.
  const visible = checks.filter((c) => showAll || c.count > 0 || c.id === openCheck);
  const groups = [...new Set(visible.map((c) => c.group))];

  const status: { color: string; icon: string; text: string; sub: string } =
    errors > 0 ? { color: LEVEL_COLOR.error, icon: "CircleX", text: `Ошибок: ${errors}`, sub: "Расчёт может быть неверным — исправьте их в первую очередь" }
    : warns > 0 ? { color: LEVEL_COLOR.warn, icon: "AlertTriangle", text: `Замечаний: ${warns}`, sub: "Расчёт возможен, но стоит проверить" }
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
        {r.truncated && (
          <div className="text-[10px] flex items-start gap-1" style={{ color: "var(--c-t3, #6b7280)" }}>
            <Icon name="Info" size={11} className="flex-shrink-0 mt-px" />
            Показаны первые 500 результатов в каждом списке.
          </div>
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
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Icon name="ShieldCheck" size={28} style={{ color: "var(--c-green, #15803d)" }} />
            <span className="text-[11px]" style={{ color: "var(--c-t3, #6b7280)" }}>
              Все {checks.length} проверок пройдены
            </span>
          </div>
        )}
        {groups.map((g) => (
          <div key={g} className="space-y-1.5">
            <GroupTitle>{g}</GroupTitle>
            {visible.filter((c) => c.group === g).map((c) => (
              <CheckCard key={c.id} icon={c.icon} title={c.title} count={c.count} level={c.level}
                open={openCheck === c.id} onToggle={() => onOpenCheck(openCheck === c.id ? null : c.id)}>
                {c.body()}
              </CheckCard>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
