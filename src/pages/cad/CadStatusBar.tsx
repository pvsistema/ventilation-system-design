// ─────────────────────────────────────────────────────────────────────────────
// CadStatusBar.tsx — нижняя строка состояния: выделенный объект, инструмент,
// режим вида, Z-уровень, итог расчёта сети и кнопка журнала.
//
// Оформлена как панель инженерного прибора: тёмная антрацитовая полоса,
// светлые подписи, числа — моноширинным шрифтом янтарного цвета, индикаторы
// состояния — светящимися точками. Стили — классы .sb-* в index.css.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type SolveResult } from "@/lib/networkSolver";
import { type LogEntry } from "@/components/cad/LogPanel";
import { type CadTool } from "@/components/cad/TopoCanvas";
import { toolLabel } from "./cadComponents";

interface CadStatusBarProps {
  selectedNode: TopoNode | null | undefined;
  selectedBranch: TopoBranch | null | undefined;
  tool: CadTool;
  viewInfo: { is3D: boolean; azimuth: number; elevation: number };
  zLevel: number;
  solveResult: SolveResult | null;
  branches: TopoBranch[];
  showLogPanel: boolean;
  setShowLogPanel: (fn: (v: boolean) => boolean) => void;
  logEntries: LogEntry[];
  /** Включён ли режим правки маркшейдерских координат (F2) */
  surveyEditMode?: boolean;
  /** Сколько узлов сдвинуто с маркшейдерских мест */
  movedNodeCount?: number;
}

/** Разделитель секций — тонкая вертикальная черта. */
const Sep = () => <span className="sb-sep" />;

/** Пара «подпись — значение»: подпись приглушена, значение — моноширинное. */
const Kv = ({ k, v, unit }: { k: string; v: React.ReactNode; unit?: string }) => (
  <span className="sb-kv"><span className="sb-k">{k}</span><span className="sb-v">{v}</span>{unit && <span className="sb-k">{unit}</span>}</span>
);

export default function CadStatusBar({
  selectedNode, selectedBranch, tool, viewInfo, zLevel,
  solveResult, branches, showLogPanel, setShowLogPanel, logEntries,
  surveyEditMode, movedNodeCount = 0,
}: CadStatusBarProps) {
  return (
  <div className="sb-bar">
    <div className="flex items-center gap-2.5 min-w-0">
      {/* Режим правки координат должно быть невозможно не заметить: в нём
          перетаскивание меняет длины выработок и результат расчёта. */}
      {surveyEditMode ? (
        <span className="sb-alert">ПРАВКА КООРДИНАТ (F2)</span>
      ) : (
        <span className="sb-led sb-led-on" title="Программа готова">Готово</span>
      )}
      <Sep />
      {movedNodeCount > 0 && (
        <>
          <span className="sb-warn" title="Узлы сдвинуты для читаемости схемы. Расчёт идёт по маркшейдерским координатам.">
            Сдвинуто узлов: <span className="sb-v">{movedNodeCount}</span>
          </span>
          <Sep />
        </>
      )}
      {selectedNode && (
        <span className="flex items-center gap-2 truncate">
          <Kv k="Узел" v={selectedNode.number || selectedNode.id} />
          <Kv k="X" v={selectedNode.x} />
          <Kv k="Y" v={selectedNode.y} />
          <Kv k="Z" v={selectedNode.z} />
        </span>
      )}
      {selectedBranch && (
        <span className="flex items-center gap-2 truncate">
          <Kv k="Ветвь" v={selectedBranch.id} />
          <span className="sb-k truncate">({selectedBranch.fromId} → {selectedBranch.toId})</span>
          <Kv k="L" v={selectedBranch.length} unit="м" />
        </span>
      )}
      {!selectedNode && !selectedBranch && <span className="sb-k">Выделите узел или ветвь</span>}
    </div>
    <div className="flex items-center gap-2.5 shrink-0">
      <span className="sb-k">Инструмент <span className="sb-strong">{toolLabel(tool)}</span></span>
      <Sep />
      {viewInfo.is3D ? (
        <span className="flex items-center gap-2">
          <span className="sb-tag">3D</span>
          <Kv k="Az" v={`${viewInfo.azimuth.toFixed(0)}°`} />
          <Kv k="El" v={`${viewInfo.elevation.toFixed(0)}°`} />
        </span>
      ) : (
        <span className="sb-tag">2D ПЛАН</span>
      )}
      <Sep />
      <Kv k="Z-ур." v={zLevel} unit="м" />
      <Sep />
      {solveResult ? (
        <>
          <span className={`sb-led ${solveResult.ok ? "sb-led-on" : "sb-led-err"}`}>
            {solveResult.ok ? "Сошёлся" : "Не сошёлся"} · <span className="sb-v">{solveResult.iterations}</span> итер.
          </span>
          {/* Статус реверса по нормативу ПБ */}
          {branches.some(b => b.fanReverse) && (() => {
            const revDiag = solveResult.diagnostics?.find(d => d.category === "fan" && (d.level === "error" || d.level === "warning" || d.level === "info"));
            if (!revDiag) return null;
            const cls = revDiag.level === "error" ? "sb-led-err" : revDiag.level === "warning" ? "sb-led-warn" : "sb-led-on";
            return <span className={`sb-led ${cls}`} title={revDiag.message}>Реверс</span>;
          })()}
        </>
      ) : (
        <span className="sb-led sb-led-warn" title="Нажмите F9, чтобы выполнить расчёт сети">
          Расчёт не выполнялся — <span className="sb-key">F9</span>
        </span>
      )}

      <Sep />
      <button onClick={() => setShowLogPanel(v => !v)} className={`sb-btn ${showLogPanel ? "sb-btn-on" : ""}`}>
        Лог{logEntries.length > 0 && <span className="sb-v ml-1">{logEntries.length}</span>}
      </button>
      <Sep />
      <span className="sb-k"><span className="sb-key">S</span>+<span className="sb-key">S</span> выделить подобное</span>
    </div>
  </div>
  );
}
