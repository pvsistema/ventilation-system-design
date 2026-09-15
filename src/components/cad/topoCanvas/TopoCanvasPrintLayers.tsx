import {
  type TopoNode, type TopoBranch, type ProjOptions, type WorkPlane,
} from "@/lib/topology";
import { type Props, type ProjNodeEntry } from "@/components/cad/topoCanvas/topoCanvasTypes";
import {
  renderGroundGrid as renderGroundGridImpl,
  renderWorkPlane as renderWorkPlaneImpl,
  makeUnprojFrame,
  computePrintFrameLayout,
  readPaperSpec,
} from "@/components/cad/topoCanvas/printLayers/printLayersScene";
import { PrintFrameBase, PrintFrameHandles } from "@/components/cad/topoCanvas/printLayers/PrintFrame";
import { ApproverBlock, StampBlock } from "@/components/cad/topoCanvas/printLayers/PrintStampBlocks";
import { LegendBlock } from "@/components/cad/topoCanvas/printLayers/PrintLegendBlock";

// ─────────────────────────────────────────────────────────────────────────────
// Слой ПЕЧАТИ и вспомогательная геометрия холста (вынесено из TopoCanvas.tsx).
// Логика и разметка перенесены 1:1, без изменений поведения:
//   renderGroundGrid  — сетка плоскости z=0 и тройка осей (только в 3D)
//   renderWorkPlane   — полупрозрачный квадрат активной рабочей плоскости
//   unprojFrame       — единая распроекция экран→мир для рамки слоя печати
//   renderPrintLayers — рамка листа, заголовок, штамп, блок «УТВЕРЖДАЮ», легенда
//
// Файл собирает лист из четырёх частей, каждая в своём модуле:
//   printLayers/printLayersScene  — сетка, рабочая плоскость, распроекция, bbox
//   printLayers/PrintFrame        — подложка, рамки, заголовок, ручки
//   printLayers/PrintStampBlocks  — «УТВЕРЖДАЮ» и штамп ГОСТ
//   printLayers/PrintLegendBlock  — условные обозначения
//
// ВАЖНО: порядок вставки частей внутри <g> повторяет исходный. В SVG порядок
// определяет и перекрытие, и попадание мыши, поэтому менять его нельзя.
// ─────────────────────────────────────────────────────────────────────────────

export interface PrintLayersDeps {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons?: Props["horizons"];
  visibleBranches: TopoBranch[];
  projNodes: ProjNodeEntry[];
  proj: ProjOptions;
  is3D: boolean;
  effPlane: WorkPlane;
  xyScale: number;
  zScale: number;
  schemaSymbols?: Props["schemaSymbols"];
  editingPrintLayerId?: string | null;
  onPrintLayerBoundsChange?: Props["onPrintLayerBoundsChange"];
  onPrintLayerChange?: Props["onPrintLayerChange"];
  editingTitleId: string | null;
  setEditingTitleId: (v: string | null) => void;
  editingTitleDraft: string;
  setEditingTitleDraft: (v: string) => void;
  editingStampCell: { horizonId: string; field: string; draft: string } | null;
  setEditingStampCell: React.Dispatch<React.SetStateAction<{ horizonId: string; field: string; draft: string } | null>>;
  editingApproverCell: { horizonId: string; field: string; draft: string } | null;
  setEditingApproverCell: React.Dispatch<React.SetStateAction<{ horizonId: string; field: string; draft: string } | null>>;
  setDraggingPrintCorner: (v: { horizonId: string; corner: "tl" | "tr" | "bl" | "br" | "move"; startWx: number; startWy: number; startBounds: { x1: number; y1: number; x2: number; y2: number } } | null) => void;
  draggingPrintTitle: { horizonId: string; startSx: number; startSy: number; startOffX: number; startOffY: number; pxPerMm: number } | null;
  setDraggingPrintTitle: (v: { horizonId: string; startSx: number; startSy: number; startOffX: number; startOffY: number; pxPerMm: number } | null) => void;
}

/**
 * Возвращает функции отрисовки сетки, рабочей плоскости и слоёв печати.
 * Вызывается из TopoCanvas — там же, где раньше жили эти функции.
 */
export function usePrintLayers(deps: PrintLayersDeps) {
  const {
    nodes, branches, horizons, visibleBranches, projNodes, proj, is3D, effPlane,
    xyScale, zScale, schemaSymbols, editingPrintLayerId,
    onPrintLayerBoundsChange, onPrintLayerChange,
    editingTitleId, setEditingTitleId, editingTitleDraft, setEditingTitleDraft,
    editingStampCell, setEditingStampCell,
    editingApproverCell, setEditingApproverCell,
    setDraggingPrintCorner, draggingPrintTitle, setDraggingPrintTitle,
  } = deps;

  // Сетка плоскости (план z=0)
  const renderGroundGrid = () => renderGroundGridImpl(is3D, proj);

  // Визуализация активной рабочей плоскости (полупрозрачный квадрат)
  const renderWorkPlane = () => renderWorkPlaneImpl(is3D, effPlane, proj);

  // Вертикальные направляющие — убраны (создавали сотни пунктирных линий при 3D-виде CSV-схем)

  // ─── Единая распроекция экран→мир для рамки слоя печати ───────────────────
  const unprojFrame = makeUnprojFrame(is3D, proj);

  // ─── Рендер шаблонов слоя печати горизонтов ──────────────────────────────
  const renderPrintLayers = () => (horizons ?? []).map((h) => {
    if (!h.printLayer?.visible) return null;
    const pl = h.printLayer;
    const { ori, mm, aspect } = readPaperSpec(pl);
    const isEditing = editingPrintLayerId === h.id;

    // ── Вычисляем экранный bbox рамки ──────────────────────────────────────
    const layout = computePrintFrameLayout({
      h, pl, aspect, ori, mm,
      nodes, branches, visibleBranches, projNodes, proj, xyScale, zScale,
    });
    if (!layout) return null;
    const { rx, ry, rw, rh, wb, pTL, pTR, pBL, pBR, pxPerMm, inset, titleFontSize } = layout;

    return (
      <g key={`printlayer-${h.id}`} data-printlayer={h.id}>
        {/* Подложка, внешняя и внутренняя рамки, заголовок */}
        <PrintFrameBase
          h={h} pl={pl}
          rx={rx} ry={ry} rw={rw} rh={rh} wb={wb}
          pxPerMm={pxPerMm} inset={inset} titleFontSize={titleFontSize}
          isEditing={isEditing}
          xyScale={xyScale} unprojFrame={unprojFrame}
          onPrintLayerBoundsChange={onPrintLayerBoundsChange}
          onPrintLayerChange={onPrintLayerChange}
          editingTitleId={editingTitleId} setEditingTitleId={setEditingTitleId}
          editingTitleDraft={editingTitleDraft} setEditingTitleDraft={setEditingTitleDraft}
          setDraggingPrintCorner={setDraggingPrintCorner}
          draggingPrintTitle={draggingPrintTitle} setDraggingPrintTitle={setDraggingPrintTitle}
        />
        {/* Блок УТВЕРЖДАЮ — правый верхний угол рамки */}
        {pl.showApprover && (
          <ApproverBlock
            h={h} pl={pl}
            rx={rx} ry={ry} rw={rw} inset={inset}
            onPrintLayerChange={onPrintLayerChange}
            editingApproverCell={editingApproverCell}
            setEditingApproverCell={setEditingApproverCell}
          />
        )}

        {/* Цветная рамка-подсветка в режиме редактирования и угловые ручки */}
        <PrintFrameHandles
          h={h}
          rx={rx} ry={ry} rw={rw} rh={rh} wb={wb}
          pTL={pTL} pTR={pTR} pBL={pBL} pBR={pBR}
          isEditing={isEditing}
          xyScale={xyScale} unprojFrame={unprojFrame}
          onPrintLayerBoundsChange={onPrintLayerBoundsChange}
          setDraggingPrintCorner={setDraggingPrintCorner}
        />

        {/* ── Блок УО на схеме — из реально установленных символов ──────────── */}
        {pl.showLegend && schemaSymbols && schemaSymbols.length > 0 && (
          <LegendBlock
            h={h} pl={pl}
            rx={rx} ry={ry} rw={rw} rh={rh} inset={inset}
            branches={branches} schemaSymbols={schemaSymbols}
            onPrintLayerChange={onPrintLayerChange}
          />
        )}

        {/* ── Штамп ГОСТ 185×55мм на схеме (правый нижний угол) ───────────── */}
        {pl.showStamp && (
          <StampBlock
            h={h} pl={pl}
            rx={rx} ry={ry} rw={rw} rh={rh} inset={inset}
            onPrintLayerChange={onPrintLayerChange}
            editingStampCell={editingStampCell}
            setEditingStampCell={setEditingStampCell}
          />
        )}

      </g>
    );
  });

  return { renderGroundGrid, renderWorkPlane, unprojFrame, renderPrintLayers };
}
