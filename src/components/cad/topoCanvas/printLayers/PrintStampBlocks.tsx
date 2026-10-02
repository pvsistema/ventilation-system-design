import { type PaperFormat, PAPER_SIZES_MM } from "@/lib/topology";
import {
  STAMP_W_MM, STAMP_H_MM, buildStampCells, buildStampGridLines, getStampFieldValue,
  type StampFieldKey,
} from "@/lib/stampTemplate";
import {
  buildApproverElements, buildApproverLines, getApproverFieldValue, computeApproverBox,
  signBlockKeys, isYearField, SIGN_SCALE_MIN, SIGN_SCALE_MAX,
  type ApproverFieldKey, type SignBlockKind,
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
  /** Высота рамки — нужна блоку «Разработал» (у нижнего края) */
  rh?: number;
  inset: number;
  onPrintLayerChange?: Props["onPrintLayerChange"];
  editingApproverCell: EditingCell;
  setEditingApproverCell: React.Dispatch<React.SetStateAction<EditingCell>>;
  /** «УТВЕРЖДАЮ» (справа) или «СОГЛАСОВАНО» (слева) */
  kind?: SignBlockKind;
}

/**
 * Блок подписи «УТВЕРЖДАЮ» / «СОГЛАСОВАНО».
 *   • перетаскивание за рамку блока (позиция — в мм листа);
 *   • уголок справа снизу — изменение размера (весь блок пропорционально);
 *   • двойной щелчок по полю — правка текста.
 */
export function ApproverBlock(props: ApproverBlockProps) {
  const {
    h, pl, rx, ry, rw, rh, inset,
    onPrintLayerChange, editingApproverCell, setEditingApproverCell,
    kind = "approve",
  } = props;
  const keys = signBlockKeys(kind);

  // Фиксированный размер блока по формату листа (как штамп)
  const fmtA = (pl.paperFormat ?? "A3") as PaperFormat;
  const oriA = pl.orientation ?? "landscape";
  const mmA = PAPER_SIZES_MM[fmtA];
  const paperWmmA = oriA === "landscape" ? Math.max(mmA.w, mmA.h) : Math.min(mmA.w, mmA.h);
  const box = computeApproverBox(rx, ry, rw, inset, paperWmmA, pl, kind, rh);
  const { pxPerMm, w: apW, h: apH, ax, ay, sheetPxPerMm } = box;
  const mx = (m: number) => ax + m * pxPerMm;
  const my = (m: number) => ay + m * pxPerMm;
  const baseFs = box.baseFs;
  const lw2 = box.lw;
  const canEdit = !!onPrintLayerChange;
  const yearNow = String(new Date().getFullYear());
  const els = buildApproverElements(kind);
  const rec = pl as unknown as Record<string, number | undefined>;

  // Перетаскивание блока (смещение копится в мм листа)
  const startDrag = (e: React.MouseEvent) => {
    if (!canEdit || e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const sx0 = e.clientX, sy0 = e.clientY;
    const ox = rec[keys.offX] ?? 0, oy = rec[keys.offY] ?? 0;
    const pxmm = sheetPxPerMm || 1;
    const onMove = (me: MouseEvent) => onPrintLayerChange?.(h.id, {
      [keys.offX]: ox + (me.clientX - sx0) / pxmm,
      [keys.offY]: oy + (me.clientY - sy0) / pxmm,
    } as Partial<import("@/lib/topology").HorizonPrintLayer>);
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  // Изменение размера за уголок. У «УТВЕРЖДАЮ» правый край привязан к рамке,
  // поэтому при росте блока сдвигаем смещение влево — уголок идёт за мышью.
  const startResize = (e: React.MouseEvent) => {
    if (!canEdit || e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const sx0 = e.clientX, sy0 = e.clientY;
    const s0 = rec[keys.scale] ?? 1;
    const ox = rec[keys.offX] ?? 0;
    const w0 = apW;
    const onMove = (me: MouseEvent) => {
      const d = Math.max(me.clientX - sx0, (me.clientY - sy0) * (apW / apH));
      const s = Math.min(SIGN_SCALE_MAX, Math.max(SIGN_SCALE_MIN, s0 * (w0 + d) / w0));
      const patch: Record<string, number> = { [keys.scale]: Math.round(s * 100) / 100 };
      if (kind === "approve") patch[keys.offX] = ox + (75 * (s - s0));
      onPrintLayerChange?.(h.id, patch as Partial<import("@/lib/topology").HorizonPrintLayer>);
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  const lines = buildApproverLines(kind);

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
    <g key={`sign-block-${kind}`}>
      <rect x={ax} y={ay} width={apW} height={apH} fill="white"
        style={{ cursor: canEdit ? "move" : "default", pointerEvents: canEdit ? "all" : "none" }}
        onMouseDown={startDrag}>
        {canEdit && <title>Перетащите, чтобы переместить блок. Двойной щелчок по тексту — правка.</title>}
      </rect>
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
          if (isYearField(el.field)) shown = (val || yearNow) + " г.";
          return (
            <text key={`val-${i}`} x={mx(el.x)} y={my(el.y)} textAnchor={anchor} dominantBaseline="central"
              fontSize={fs} fontFamily="Arial, sans-serif" fill={val ? color : "#bbb"}
              style={{ cursor: canEdit ? "move" : "default", userSelect: "none" }}
              onMouseDown={startDrag}
              onDoubleClick={canEdit ? (e) => { e.stopPropagation(); startEdit(el.field!); } : undefined}>
              {shown}
            </text>
          );
        }
        return null;
      })}
      {canEdit && (() => {
        const hs = Math.max(6, Math.min(14, pxPerMm * 3));
        return (
          <g style={{ cursor: "nwse-resize" }} onMouseDown={startResize}>
            <rect x={ax + apW - hs} y={ay + apH - hs} width={hs} height={hs} fill="transparent" />
            <path d={`M ${ax + apW - hs * 0.9} ${ay + apH - 1} L ${ax + apW - 1} ${ay + apH - hs * 0.9} M ${ax + apW - hs * 0.5} ${ay + apH - 1} L ${ax + apW - 1} ${ay + apH - hs * 0.5}`}
              stroke="#7c3aed" strokeWidth={1.2} fill="none" />
            <title>Потяните, чтобы изменить размер блока</title>
          </g>
        );
      })()}
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
