import { type PaperFormat, PAPER_SIZES_MM } from "@/lib/topology";
import {
  STAMP_W_MM, STAMP_H_MM, buildStampCells, buildStampGridLines, getStampFieldValue,
  type StampFieldKey,
} from "@/lib/stampTemplate";
import {
  buildApproverElements, buildApproverLines, getApproverFieldValue, computeApproverBox,
  type ApproverFieldKey,
} from "@/lib/approverTemplate";
import { type Props } from "@/components/cad/topoCanvas/topoCanvasTypes";
import type { PrintHorizon, PrintLayerCfg } from "./printLayersScene";

// ─────────────────────────────────────────────────────────────────────────────
// Табличные блоки листа: «УТВЕРЖДАЮ» и штамп ГОСТ 185×55 мм.
// Перенесено из TopoCanvasPrintLayers 1:1.
//
// Оба блока устроены одинаково: шаблон отдаёт линии сетки и ячейки в
// МИЛЛИМЕТРАХ листа, а здесь они переводятся в экранные координаты через
// pxPerMm. Поэтому размеры остаются «как на печати» при любом зуме.
// ─────────────────────────────────────────────────────────────────────────────

type EditingCell = { horizonId: string; field: string; draft: string } | null;

export interface ApproverBlockProps {
  h: PrintHorizon;
  pl: PrintLayerCfg;
  rx: number; ry: number; rw: number;
  inset: number;
  onPrintLayerChange?: Props["onPrintLayerChange"];
  editingApproverCell: EditingCell;
  setEditingApproverCell: React.Dispatch<React.SetStateAction<EditingCell>>;
}

/** Блок УТВЕРЖДАЮ — правый верхний угол рамки. */
export function ApproverBlock(props: ApproverBlockProps) {
  const {
    h, pl, rx, ry, rw, inset,
    onPrintLayerChange, editingApproverCell, setEditingApproverCell,
  } = props;

  // Фиксированный размер блока по формату листа (как штамп)
  const fmtA = (pl.paperFormat ?? "A3") as PaperFormat;
  const oriA = pl.orientation ?? "landscape";
  const mmA = PAPER_SIZES_MM[fmtA];
  const paperWmmA = oriA === "landscape" ? Math.max(mmA.w, mmA.h) : Math.min(mmA.w, mmA.h);
  const box = computeApproverBox(rx, ry, rw, inset, paperWmmA);
  const { pxPerMm, w: apW, h: apH, ax, ay } = box;
  const mx = (m: number) => ax + m * pxPerMm;
  const my = (m: number) => ay + m * pxPerMm;
  const baseFs = Math.max(6, pxPerMm * 2.6);
  const lw2 = Math.max(0.4, pxPerMm * 0.15);
  const canEdit = !!onPrintLayerChange;
  const yearNow = String(new Date().getFullYear());
  const els = buildApproverElements();
  const lines = buildApproverLines();

  const startEdit = (field: ApproverFieldKey) => {
    setEditingApproverCell({ horizonId: h.id, field, draft: getApproverFieldValue(pl, field) });
  };
  const commitEdit = () => {
    if (editingApproverCell && editingApproverCell.horizonId === h.id) {
      onPrintLayerChange?.(h.id, { [editingApproverCell.field]: editingApproverCell.draft } as Partial<import("@/lib/topology").HorizonPrintLayer>);
    }
    setEditingApproverCell(null);
  };

  return (
    <g key="approver-block">
      <rect x={ax} y={ay} width={apW} height={apH} fill="white" style={{ pointerEvents: "none" }} />
      {lines.map((ln, i) => (
        <line key={`al-${i}`} x1={mx(ln.x1)} y1={my(ln.y1)} x2={mx(ln.x2)} y2={my(ln.y2)} stroke="#111" strokeWidth={lw2} style={{ pointerEvents: "none" }} />
      ))}
      {els.map((el, i) => {
        const fs = baseFs * (el.fontScale ?? 1);
        const anchor = el.align === "left" ? "start" : el.align === "right" ? "end" : "middle";
        const color = el.color ?? "#111";
        // Статичная надпись
        if (el.label && !el.field) {
          return (
            <text key={`lbl-${i}`} x={mx(el.x)} y={my(el.y)} textAnchor={anchor} dominantBaseline="central"
              fontSize={fs} fontFamily="Arial, sans-serif" fill={color} style={{ pointerEvents: "none", userSelect: "none" }}>
              {el.label}
            </text>
          );
        }
        // Редактируемое поле
        if (el.field) {
          const isEd = editingApproverCell?.horizonId === h.id && editingApproverCell?.field === el.field;
          const val = getApproverFieldValue(pl, el.field);
          if (isEd && canEdit) {
            const cellX = mx(el.cellX ?? 0);
            const cellW = (el.cellW ?? (14)) * pxPerMm;
            return (
              <foreignObject key={`ed-${i}`} x={cellX} y={my(el.y) - fs} width={Math.max(12, cellW)} height={fs * 2}>
                <input
                  // @ts-expect-error xmlns
                  xmlns="http://www.w3.org/1999/xhtml"
                  autoFocus
                  value={editingApproverCell.draft}
                  onChange={e => setEditingApproverCell(s => s ? { ...s, draft: e.target.value } : s)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingApproverCell(null);
                    e.stopPropagation();
                  }}
                  onMouseDown={e => e.stopPropagation()}
                  style={{
                    width: "100%", height: "100%",
                    textAlign: el.align === "left" ? "left" : el.align === "right" ? "right" : "center",
                    fontSize: fs, fontFamily: "Arial, sans-serif",
                    border: "1.5px solid #7c3aed", borderRadius: 2, outline: "none",
                    background: "rgba(255,253,230,0.97)", padding: "0 2px",
                    boxSizing: "border-box" as const, color,
                  }}
                />
              </foreignObject>
            );
          }
          // Отображение значения (с плейсхолдером и суффиксом «г.» для года)
          let shown = val || (canEdit ? (el.placeholder || "") : "");
          if (el.field === "year") shown = (val || yearNow) + " г.";
          return (
            <text key={`val-${i}`} x={mx(el.x)} y={my(el.y)} textAnchor={anchor} dominantBaseline="central"
              fontSize={fs} fontFamily="Arial, sans-serif" fill={val ? color : "#bbb"}
              style={{ cursor: canEdit ? "text" : "default", userSelect: "none" }}
              onDoubleClick={canEdit ? (e) => { e.stopPropagation(); startEdit(el.field!); } : undefined}>
              {shown}
            </text>
          );
        }
        return null;
      })}
    </g>
  );
}

export interface StampBlockProps {
  h: PrintHorizon;
  pl: PrintLayerCfg;
  rx: number; ry: number; rw: number; rh: number;
  inset: number;
  onPrintLayerChange?: Props["onPrintLayerChange"];
  editingStampCell: EditingCell;
  setEditingStampCell: React.Dispatch<React.SetStateAction<EditingCell>>;
}

/** Штамп ГОСТ 185×55мм на схеме (правый нижний угол). */
export function StampBlock(props: StampBlockProps) {
  const {
    h, pl, rx, ry, rw, rh, inset,
    onPrintLayerChange, editingStampCell, setEditingStampCell,
  } = props;

  // Фиксированный размер штампа по формату листа:
  // rw (px рамки) соответствует ширине листа в мм → px/мм = rw / paperWmm.
  const fmtS = (pl.paperFormat ?? "A3") as PaperFormat;
  const oriS = pl.orientation ?? "landscape";
  const mmS = PAPER_SIZES_MM[fmtS];
  const paperWmm = oriS === "landscape" ? Math.max(mmS.w, mmS.h) : Math.min(mmS.w, mmS.h);
  const pxPerMm = rw / paperWmm;              // масштаб мир→экран для штампа
  const stW = STAMP_W_MM * pxPerMm;
  const stH = STAMP_H_MM * pxPerMm;
  const stOffX = pl.stampOffsetX ?? 0;
  const stOffY = pl.stampOffsetY ?? 0;
  // Внутренний отступ рамки чертежа (по ГОСТ штамп прижат к рамке)
  const sx2 = rx + rw - inset - stW + stOffX;
  const sy2 = ry + rh - inset - stH + stOffY;
  const sw2 = Math.max(0.4, pxPerMm * 0.35);  // толщина основных линий
  const swThin = Math.max(0.25, pxPerMm * 0.18);
  const baseFs = Math.max(5, pxPerMm * 2.3);  // базовый размер шрифта
  const canDrag = !!onPrintLayerChange;
  const cells = buildStampCells(pl);
  const gridLines = buildStampGridLines();
  // мм → экранные координаты штампа
  const mx = (m: number) => sx2 + m * pxPerMm;
  const my = (m: number) => sy2 + m * pxPerMm;

  const startEdit = (field: StampFieldKey) => {
    setEditingStampCell({ horizonId: h.id, field, draft: getStampFieldValue(pl, field) });
  };
  const commitEdit = () => {
    if (editingStampCell && editingStampCell.horizonId === h.id) {
      onPrintLayerChange?.(h.id, { [editingStampCell.field]: editingStampCell.draft } as Partial<import("@/lib/topology").HorizonPrintLayer>);
    }
    setEditingStampCell(null);
  };

  return (
    <g key="stamp-block">
      {/* Белый фон */}
      <rect x={sx2} y={sy2} width={stW} height={stH} fill="white" />

      {/* Сетка штампа */}
      {gridLines.map((ln, i) => (
        <line key={`gl-${i}`}
          x1={mx(ln.x1)} y1={my(ln.y1)} x2={mx(ln.x2)} y2={my(ln.y2)}
          stroke="#1a1a1a" strokeWidth={ln.thick ? sw2 : swThin} />
      ))}

      {/* Ячейки: подписи граф + редактируемые значения */}
      {cells.map((c, i) => {
        const cx = mx(c.x);
        const cy = my(c.y);
        const cw = c.w * pxPerMm;
        const ch = c.h * pxPerMm;
        const fs = baseFs * (c.fontScale ?? 1);
        const textX = c.align === "left" ? cx + pxPerMm * 1.2 : cx + cw / 2;
        const textY = cy + ch / 2;
        const anchor = c.align === "left" ? "start" : "middle";

        // Нередактируемая подпись графы
        if (c.label && !c.field) {
          return (
            <text key={`lbl-${i}`} x={textX} y={textY}
              textAnchor={anchor} dominantBaseline="central"
              fontSize={fs} fontFamily="Arial, sans-serif"
              fontWeight={c.bold ? "bold" : "normal"} fill="#333"
              style={{ pointerEvents: "none", userSelect: "none" }}>
              {c.label}
            </text>
          );
        }

        // Редактируемая ячейка
        if (c.field) {
          const isEd = editingStampCell?.horizonId === h.id && editingStampCell?.field === c.field;
          const val = getStampFieldValue(pl, c.field);
          if (isEd && canDrag) {
            return (
              <foreignObject key={`ed-${i}`} x={cx + 1} y={cy + 1} width={Math.max(10, cw - 2)} height={Math.max(10, ch - 2)}>
                <input
                  // @ts-expect-error xmlns
                  xmlns="http://www.w3.org/1999/xhtml"
                  autoFocus
                  value={editingStampCell.draft}
                  onChange={e => setEditingStampCell(s => s ? { ...s, draft: e.target.value } : s)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingStampCell(null);
                    e.stopPropagation();
                  }}
                  onMouseDown={e => e.stopPropagation()}
                  style={{
                    width: "100%", height: "100%",
                    textAlign: c.align === "left" ? "left" : "center",
                    fontSize: fs, fontFamily: "Arial, sans-serif",
                    fontWeight: c.bold ? "bold" : "normal",
                    border: "1.5px solid #7c3aed", borderRadius: 2, outline: "none",
                    background: "rgba(255,253,230,0.97)", padding: "0 2px",
                    boxSizing: "border-box" as const, color: "#111",
                  }}
                />
              </foreignObject>
            );
          }
          return (
            <text key={`val-${i}`} x={textX} y={textY}
              textAnchor={anchor} dominantBaseline="central"
              fontSize={fs} fontFamily="Arial, sans-serif"
              fontWeight={c.bold ? "bold" : "normal"}
              fill={val ? "#111" : "#bbb"}
              style={{ cursor: canDrag ? "text" : "default", userSelect: "none" }}
              onDoubleClick={canDrag ? (e) => { e.stopPropagation(); startEdit(c.field!); } : undefined}>
              {val || (canDrag ? (c.placeholder || "—") : "")}
            </text>
          );
        }
        return null;
      })}

      {/* Ручка перемещения — узкая полоса по левому краю штампа */}
      {canDrag && (
        <rect x={sx2} y={sy2} width={Math.max(6, pxPerMm * 2)} height={stH} fill="transparent" style={{ cursor: "move" }}
          onMouseDown={(e) => {
            e.stopPropagation(); e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const startOX = pl.stampOffsetX ?? 0, startOY = pl.stampOffsetY ?? 0;
            const onMove = (me: MouseEvent) => onPrintLayerChange?.(h.id, { stampOffsetX: startOX + me.clientX - startX, stampOffsetY: startOY + me.clientY - startY });
            const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
            window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
          }}
        />
      )}
    </g>
  );
}
