import CadStatusBar from "./cad/CadStatusBar";
import { } from "@/lib/api-urls";
// Тип нужен и ВНУТРИ файла, и наружу: `export type { ... } from` только
// пробрасывает его дальше, но в самом файле имя остаётся неизвестным —
// из-за этого проверка типов не видела 18 мест использования.
import type { SchemaSymbol } from "./cad/cadTypes";
export type { SchemaSymbol };
import { useCadPage } from "./cad/useCadPage";
import CadRibbon from "./cad/CadRibbon";
import CadLeftPanel from "./cad/CadLeftPanel";
import CadWorkspace from "./cad/CadWorkspace";
import CadDialogs from "./cad/CadDialogs";

// ─────────────────────────────────────────────────────────────────────────────
// CAD-интерфейс шахтной/вентиляционной сети в стиле инженерного ПО
// (АэроСеть / Вентиляция-CAD): ribbon-меню + вертикальные вкладки + свойства
// ─────────────────────────────────────────────────────────────────────────────

export default function CadPage() {
  const c = useCadPage();
  const {
    tool,
    zLevel,
    surveyEditMode,
    movedNodeCount,
    branches,
    selectedNode,
    selectedBranch,
    solveResult,
    showLogPanel,
    setShowLogPanel,
    logEntries,
    viewInfo,
  } = c;

  return (
    <>
    <div className="w-full flex flex-col"
      style={{ background: "var(--c-s3, #f0f0f0)", fontFamily: "var(--font-ui)", fontSize: "12px", color: "var(--c-t1, #1f1f1f)", height: "calc(100dvh / var(--ui-zoom, 1))" }}>

      <CadRibbon c={c} />

      {/* ═══ MAIN AREA ════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden">

        <CadLeftPanel c={c} />

        <CadWorkspace c={c} />
      </div>

      {/* ═══ STATUS BAR ═══════════════════════════════════════════════════ */}
      <CadStatusBar
        selectedNode={selectedNode}
        selectedBranch={selectedBranch}
        tool={tool}
        viewInfo={viewInfo}
        zLevel={zLevel}
        solveResult={solveResult}
        branches={branches}
        showLogPanel={showLogPanel}
        setShowLogPanel={setShowLogPanel}
        logEntries={logEntries}
        surveyEditMode={surveyEditMode}
        movedNodeCount={movedNodeCount}
      />
    </div>

    <CadDialogs c={c} />
    </>
  );
}
