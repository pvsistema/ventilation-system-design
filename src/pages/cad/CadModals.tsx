// ─────────────────────────────────────────────────────────────────────────────
// CadModals — presentational-обёртка над модальными окнами: настройки пределов
// масштабов, возврат к маркшейдерским координатам, удаление ветвей, объединение
// ветвей при удалении узла, число людей в отделении, подтверждение закрытия,
// «О программе», сравнение схем.
// Разметка вынесена в ./modals/* — здесь остаётся только раскладка пропсов.
// Логика/состояние остаются в CadPage. Поведение 1:1 с исходником.
// ─────────────────────────────────────────────────────────────────────────────
import type React from "react";
import CadScaleSettingsModal from "./modals/CadScaleSettingsModal";
import CadTopologyModals from "./modals/CadTopologyModals";
import CadAppInfoModals from "./modals/CadAppInfoModals";
import CadCompareModal from "./modals/CadCompareModal";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type CompareResult } from "./cadTypes";
import { type DeleteBranchPlan } from "./deleteBranchPlan";

type MergeNodeState = { nodeId: string; branchA: string; branchB: string };
// t — доля длины ветви (точка клика курсором), чтобы отделение встало
// в указанное место, а не в середину ветви.
type SquadState = { typeId: string; x: number; y: number; branchId: string | null; t?: number };

export interface CadModalsProps {
  nodes: TopoNode[];
  branches: TopoBranch[];
  branchesRaw: TopoBranch[];
  projectFileName: string;

  // Диалог настройки пределов масштабов
  scaleSettingsOpen: boolean;
  setScaleSettingsOpen: (v: boolean) => void;
  scaleTextMin: number; setScaleTextMin: (v: number) => void;
  scaleTextMax: number; setScaleTextMax: (v: number) => void;
  scaleBranchMin: number; setScaleBranchMin: (v: number) => void;
  scaleBranchMax: number; setScaleBranchMax: (v: number) => void;
  /** Ширина ветви зависит от площади её сечения (см. branchWidthBySection.ts). */
  widthBySectionOn: boolean; setWidthBySectionOn: (v: boolean) => void;
  tube3dOn: boolean; setTube3dOn: (v: boolean) => void;
  scalePositionMin: number; setScalePositionMin: (v: number) => void;
  scalePositionMax: number; setScalePositionMax: (v: number) => void;
  positionGostMm: number; setPositionGostMm: (v: number) => void;
  bulkheadScale: number; setBulkheadScale: (v: number) => void;
  fanScale: number; setFanScale: (v: number) => void;
  setScaleLimitsEnabled: (v: boolean) => void;

  // Возврат схемы к маркшейдерским координатам (F5)
  resetSurveyDialog: boolean;
  setResetSurveyDialog: (v: boolean) => void;
  resetAllNodesToSurvey: () => void;
  movedNodeCount: number;
  nodeCount: number;

  // Подтверждение удаления ветвей (УО и осиротевшие узлы)
  deleteBranchDialog: DeleteBranchPlan | null;
  setDeleteBranchDialog: (v: DeleteBranchPlan | null) => void;
  confirmDeleteBranches: (plan: DeleteBranchPlan, removeOrphanNodes: boolean) => void;

  // Объединение ветвей при удалении промежуточного узла
  mergeNodeDialog: MergeNodeState | null;
  setMergeNodeDialog: (v: MergeNodeState | null) => void;
  doDeleteNode: (nodeId: string) => void;
  mergeAdjacentBranches: (nodeId: string, branchAId: string, branchBId: string) => void;

  // Число людей в отделении
  squadDialog: SquadState | null;
  setSquadDialog: (v: SquadState | null) => void;
  squadCount: string;
  setSquadCount: (v: string) => void;
  addSymbol: (typeId: string, x: number, y: number, branchId?: string | null, label?: string, scale?: number, t?: number) => void;
  setTool: (v: "select") => void;
  setActiveSymbolTypeId: (v: string | null) => void;

  // Подтверждение закрытия
  showCloseConfirm: boolean;
  setShowCloseConfirm: (v: boolean) => void;
  handleSave: () => Promise<void>;

  // О программе
  showAbout: boolean;
  setShowAbout: (v: boolean) => void;

  // Сравнение схем
  compareShowDialog: boolean;
  setCompareShowDialog: (v: boolean) => void;
  compareLoading: boolean;
  setCompareLoading: (v: boolean) => void;
  setCompareResult: (v: CompareResult | null) => void;
  setCompareFilter: (v: "all" | "changed" | "added" | "removed") => void;
  setCompareSelectedId: (v: string | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setActiveSide: React.Dispatch<React.SetStateAction<any>>;
  setLeftPanelOpen: (v: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setActiveRibbon: React.Dispatch<React.SetStateAction<any>>;
}

export default function CadModals(p: CadModalsProps) {
  return (
    <>
      {/* ═══ ДИАЛОГ НАСТРОЙКИ ПРЕДЕЛОВ МАСШТАБОВ ═══════════════════════ */}
      <CadScaleSettingsModal
        scaleSettingsOpen={p.scaleSettingsOpen}
        setScaleSettingsOpen={p.setScaleSettingsOpen}
        scaleTextMin={p.scaleTextMin} setScaleTextMin={p.setScaleTextMin}
        scaleTextMax={p.scaleTextMax} setScaleTextMax={p.setScaleTextMax}
        scaleBranchMin={p.scaleBranchMin} setScaleBranchMin={p.setScaleBranchMin}
        scaleBranchMax={p.scaleBranchMax} setScaleBranchMax={p.setScaleBranchMax}
        widthBySectionOn={p.widthBySectionOn} setWidthBySectionOn={p.setWidthBySectionOn}
        tube3dOn={p.tube3dOn} setTube3dOn={p.setTube3dOn}
        scalePositionMin={p.scalePositionMin} setScalePositionMin={p.setScalePositionMin}
        scalePositionMax={p.scalePositionMax} setScalePositionMax={p.setScalePositionMax}
        positionGostMm={p.positionGostMm} setPositionGostMm={p.setPositionGostMm}
        bulkheadScale={p.bulkheadScale} setBulkheadScale={p.setBulkheadScale}
        fanScale={p.fanScale} setFanScale={p.setFanScale}
        setScaleLimitsEnabled={p.setScaleLimitsEnabled}
      />

      {/* ═══ ПРАВКА ТОПОЛОГИИ: F5, удаление ветвей, объединение, отделение ══ */}
      <CadTopologyModals
        branchesRaw={p.branchesRaw}
        resetSurveyDialog={p.resetSurveyDialog}
        setResetSurveyDialog={p.setResetSurveyDialog}
        resetAllNodesToSurvey={p.resetAllNodesToSurvey}
        movedNodeCount={p.movedNodeCount}
        nodeCount={p.nodeCount}
        deleteBranchDialog={p.deleteBranchDialog}
        setDeleteBranchDialog={p.setDeleteBranchDialog}
        confirmDeleteBranches={p.confirmDeleteBranches}
        mergeNodeDialog={p.mergeNodeDialog}
        setMergeNodeDialog={p.setMergeNodeDialog}
        doDeleteNode={p.doDeleteNode}
        mergeAdjacentBranches={p.mergeAdjacentBranches}
        squadDialog={p.squadDialog}
        setSquadDialog={p.setSquadDialog}
        squadCount={p.squadCount}
        setSquadCount={p.setSquadCount}
        addSymbol={p.addSymbol}
        setTool={p.setTool}
        setActiveSymbolTypeId={p.setActiveSymbolTypeId}
      />

      {/* ── Подтверждение закрытия и «О программе» ──────────────────────── */}
      <CadAppInfoModals
        projectFileName={p.projectFileName}
        showCloseConfirm={p.showCloseConfirm}
        setShowCloseConfirm={p.setShowCloseConfirm}
        handleSave={p.handleSave}
        showAbout={p.showAbout}
        setShowAbout={p.setShowAbout}
      />

      {/* ── Диалог сравнения схем ──────────────────────────────────────── */}
      <CadCompareModal
        nodes={p.nodes}
        branches={p.branches}
        branchesRaw={p.branchesRaw}
        projectFileName={p.projectFileName}
        compareShowDialog={p.compareShowDialog}
        setCompareShowDialog={p.setCompareShowDialog}
        compareLoading={p.compareLoading}
        setCompareLoading={p.setCompareLoading}
        setCompareResult={p.setCompareResult}
        setCompareFilter={p.setCompareFilter}
        setCompareSelectedId={p.setCompareSelectedId}
        setActiveSide={p.setActiveSide}
        setLeftPanelOpen={p.setLeftPanelOpen}
        setActiveRibbon={p.setActiveRibbon}
      />
    </>
  );
}
