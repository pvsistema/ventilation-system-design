import { type PaperFormat, PAPER_SIZES_MM } from "@/lib/topology";
import { type Props } from "@/components/cad/topoCanvas/topoCanvasTypes";
import { computeTitleLayout, wrapTitleLines, TITLE_FONT_MIN, TITLE_FONT_MAX } from "@/lib/printTitle";
import type {
  PrintHorizon, PrintLayerCfg, UnprojFrame, FrameWorldBounds, FrameCorner,
} from "./printLayersScene";

// ─────────────────────────────────────────────────────────────────────────────
// Рамка листа: подложка, внешняя/внутренняя рамка, заголовок, подсветка
// и угловые ручки. Перенесено из TopoCanvasPrintLayers 1:1.
//
// ВАЖНО про порядок отрисовки. В SVG порядок элементов задаёт и перекрытие,
// и попадание мыши. Между заголовком и подсветкой в исходнике стоит блок
// «УТВЕРЖДАЮ», поэтому рамка отдаёт наружу ДВЕ части — PrintFrameBase
// (подложка…заголовок) и PrintFrameHandles (подсветка + ручки), а вызывающий
// код вставляет между ними блок утверждения, сохраняя исходную очерёдность.
// ─────────────────────────────────────────────────────────────────────────────

export interface PrintFrameBaseProps {
  h: PrintHorizon;
  pl: PrintLayerCfg;
  rx: number; ry: number; rw: number; rh: number;
  wb: FrameWorldBounds;
  pxPerMm: number;
  inset: number;
  titleFontSize: number;
  isEditing: boolean;
  xyScale: number;
  unprojFrame: UnprojFrame;
  onPrintLayerBoundsChange?: Props["onPrintLayerBoundsChange"];
  onPrintLayerChange?: Props["onPrintLayerChange"];
  editingTitleId: string | null;
  setEditingTitleId: (v: string | null) => void;
  editingTitleDraft: string;
  setEditingTitleDraft: (v: string) => void;
  setDraggingPrintCorner: (v: { horizonId: string; corner: "tl" | "tr" | "bl" | "br" | "move"; startWx: number; startWy: number; startBounds: FrameWorldBounds } | null) => void;
  draggingPrintTitle: { horizonId: string; startSx: number; startSy: number; startOffX: number; startOffY: number; pxPerMm: number } | null;
  setDraggingPrintTitle: (v: { horizonId: string; startSx: number; startSy: number; startOffX: number; startOffY: number; pxPerMm: number } | null) => void;
}

/** Подложка, рамки и заголовок листа. */
export function PrintFrameBase(props: PrintFrameBaseProps) {
  const {
    h, pl, rx, ry, rw, rh, wb, pxPerMm, inset, isEditing,
    xyScale, unprojFrame, onPrintLayerBoundsChange, onPrintLayerChange,
    editingTitleId, setEditingTitleId, editingTitleDraft, setEditingTitleDraft,
    setDraggingPrintCorner, draggingPrintTitle, setDraggingPrintTitle,
  } = props;

  return (
    <>
      {/* Белая подложка */}
      <rect x={rx} y={ry} width={rw} height={rh} fill="white"
        style={{ cursor: isEditing ? "move" : "default" }}
        onMouseDown={isEditing ? (e) => {
          e.stopPropagation();
          e.preventDefault();
          const svgEl = (e.currentTarget as SVGElement).ownerSVGElement;
          if (!svgEl) return;
          const svgRect = svgEl.getBoundingClientRect();
          const csx = e.clientX - svgRect.left;
          const csy = e.clientY - svgRect.top;
          const wp = unprojFrame(csx, csy, h.z);
          if (!wp) return;
          const _xys = xyScale ?? 1;
          // activeBounds — углы рамки распроецируем ТЕМ ЖЕ unprojFrame, что и точку,
          // иначе рассинхрон в наклонных видах даёт скачок размера рамки.
          const activeBounds = (wb.x1 === 0 && wb.x2 === 0)
            ? (() => {
                const wBL = unprojFrame(rx,      ry + rh, h.z);
                const wTR = unprojFrame(rx + rw, ry,      h.z);
                if (!wBL || !wTR) return wb;
                return { x1: wBL.x / _xys, y1: wBL.y / _xys, x2: wTR.x / _xys, y2: wTR.y / _xys };
              })()
            : wb;
          // startWx/startWy тоже делим на xyScale чтобы быть в "чистых" мировых
          const startWx = wp.x / _xys;
          const startWy = wp.y / _xys;
          const startState = { horizonId: h.id, corner: "move" as const, startWx, startWy, startBounds: activeBounds };
          setDraggingPrintCorner(startState);
          const onMove = (me: MouseEvent) => {
            const sx2 = me.clientX - svgRect.left;
            const sy2 = me.clientY - svgRect.top;
            const wp2 = unprojFrame(sx2, sy2, h.z);
            if (!wp2) return;
            const dx = wp2.x / _xys - startState.startWx;
            const dy = wp2.y / _xys - startState.startWy;
            const sb = startState.startBounds;
            onPrintLayerBoundsChange?.(h.id, { x1: sb.x1 + dx, y1: sb.y1 + dy, x2: sb.x2 + dx, y2: sb.y2 + dy });
          };
          const onUp = () => {
            setDraggingPrintCorner(null);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        } : undefined}
      />
      {/* Внешняя рамка */}
      <rect x={rx} y={ry} width={rw} height={rh}
        fill="none" stroke="#1a1a1a" strokeWidth={2}
        style={{ pointerEvents: "none" }} />
      {/* Внутренняя рамка */}
      <rect x={rx + inset} y={ry + inset}
        width={rw - inset * 2} height={rh - inset * 2}
        fill="none" stroke="#1a1a1a" strokeWidth={0.8}
        style={{ pointerEvents: "none" }} />
      {/* Заголовок — редактируемый, перетаскиваемый, с переносом строк и изменением размера */}
      {(() => {
        const tl = computeTitleLayout(pl, rx, ry, rw, inset, pxPerMm);
        const titleX = tl.x;
        const titleY = tl.y;
        const fs = tl.fs;
        const canEdit = !!onPrintLayerChange;
        const isEditingTitle = editingTitleId === h.id;
        const commit = () => { onPrintLayerChange?.(h.id, { title: editingTitleDraft }); setEditingTitleId(null); };
        if (isEditingTitle) {
          const rows = Math.max(1, wrapTitleLines(editingTitleDraft, tl.wrapW, fs).length);
          return (
            <foreignObject x={titleX - tl.wrapW / 2 - 6} y={titleY - 4} width={tl.wrapW + 12} height={tl.lineH * rows + 12}>
              <textarea
                // @ts-expect-error xmlns
                xmlns="http://www.w3.org/1999/xhtml"
                autoFocus
                value={editingTitleDraft}
                onChange={e => setEditingTitleDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                  // Enter — сохранить, Shift+Enter — новая строка
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
                  if (e.key === "Escape") setEditingTitleId(null);
                  e.stopPropagation();
                }}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  width: "100%", height: "100%", resize: "none", overflow: "hidden",
                  textAlign: "center", lineHeight: 1.2,
                  fontSize: fs, fontFamily: "Arial, sans-serif", fontWeight: "bold",
                  border: "1.5px solid #7c3aed", borderRadius: "var(--radius-ui)", outline: "none",
                  background: "rgba(255,253,230,0.97)", padding: "1px 4px", boxSizing: "border-box" as const,
                }}
              />
            </foreignObject>
          );
        }
        if (!pl.title) return null;
        const blockH = tl.lineH * tl.lines.length;
        const maxLen = Math.max(...tl.lines.map(l => l.length), 1);
        const textW = Math.min(tl.wrapW, maxLen * fs * 0.6);
        // Изменение размера шрифта за уголок справа снизу
        const startResize = (e: React.MouseEvent) => {
          if (e.button !== 0) return;
          e.stopPropagation(); e.preventDefault();
          const sx0 = e.clientX, sy0 = e.clientY;
          const s0 = pl.titleFontScale ?? 1;
          const h0 = Math.max(4, blockH);
          const onMove = (me: MouseEvent) => {
            const d = Math.max(me.clientY - sy0, (me.clientX - sx0) * (h0 / Math.max(4, textW)));
            const s = Math.min(TITLE_FONT_MAX, Math.max(TITLE_FONT_MIN, s0 * (h0 + d) / h0));
            onPrintLayerChange?.(h.id, { titleFontScale: Math.round(s * 100) / 100 });
          };
          const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
          window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
        };
        const hs = Math.max(6, Math.min(14, pxPerMm * 3));
        const bx = titleX + textW / 2 + 2, by = titleY + blockH;
        return (
          <g>
          <text
            x={titleX} y={titleY}
            textAnchor="middle" dominantBaseline="hanging"
            fontSize={fs}
            fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111"
            style={{ cursor: canEdit ? (draggingPrintTitle?.horizonId === h.id ? "grabbing" : "grab") : "default", userSelect: "none" }}
            onDoubleClick={canEdit ? (e) => {
              e.stopPropagation();
              setEditingTitleDraft(pl.title);
              setEditingTitleId(h.id);
            } : undefined}
            onMouseDown={canEdit ? (e) => {
              if (e.detail >= 2) return;
              e.stopPropagation();
              e.preventDefault();
              const startOffX = pl.titleOffsetX ?? 0;
              const startOffY = pl.titleOffsetY ?? 0;
              const startSx = e.clientX;
              const startSy = e.clientY;
              setDraggingPrintTitle({ horizonId: h.id, startSx, startSy, startOffX, startOffY, pxPerMm });
              const pxmm = pxPerMm || 1;
              const onMove = (me: MouseEvent) => {
                onPrintLayerChange?.(h.id, {
                  titleOffsetX: startOffX + (me.clientX - startSx) / pxmm,
                  titleOffsetY: startOffY + (me.clientY - startSy) / pxmm,
                });
              };
              const onUp = () => {
                setDraggingPrintTitle(null);
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            } : undefined}
          >
            {tl.lines.map((ln, i) => (
              <tspan key={i} x={titleX} y={titleY + i * tl.lineH}>{ln || "\u00a0"}</tspan>
            ))}
            {canEdit && <title>Перетащите, чтобы переместить. Двойной щелчок — правка текста (Shift+Enter — новая строка).</title>}
          </text>
          {canEdit && (
            <g style={{ cursor: "nwse-resize" }} onMouseDown={startResize}>
              <rect x={bx - hs} y={by - hs} width={hs} height={hs} fill="transparent" />
              <path d={`M ${bx - hs * 0.9} ${by - 1} L ${bx - 1} ${by - hs * 0.9} M ${bx - hs * 0.5} ${by - 1} L ${bx - 1} ${by - hs * 0.5}`}
                stroke="#7c3aed" strokeWidth={1.2} fill="none" />
              <title>Потяните, чтобы изменить размер заголовка</title>
            </g>
          )}
          </g>
        );
      })()}
    </>
  );
}

export interface PrintFrameHandlesProps {
  h: PrintHorizon;
  rx: number; ry: number; rw: number; rh: number;
  wb: FrameWorldBounds;
  pTL: FrameCorner; pTR: FrameCorner; pBL: FrameCorner; pBR: FrameCorner;
  isEditing: boolean;
  xyScale: number;
  unprojFrame: UnprojFrame;
  onPrintLayerBoundsChange?: Props["onPrintLayerBoundsChange"];
  setDraggingPrintCorner: (v: { horizonId: string; corner: "tl" | "tr" | "bl" | "br" | "move"; startWx: number; startWy: number; startBounds: FrameWorldBounds } | null) => void;
}

/** Подсветка режима редактирования и угловые ручки масштабирования. */
export function PrintFrameHandles(props: PrintFrameHandlesProps) {
  const {
    h, rx, ry, rw, rh, wb, pTL, pTR, pBL, pBR, isEditing,
    xyScale, unprojFrame, onPrintLayerBoundsChange, setDraggingPrintCorner,
  } = props;

  return (
    <>
      {/* Цветная рамка-подсветка в режиме редактирования */}
      {isEditing && (
        <rect x={rx - 1} y={ry - 1} width={rw + 2} height={rh + 2}
          fill="none" stroke="#7c3aed" strokeWidth={2} strokeDasharray="8 4"
          style={{ pointerEvents: "none" }} />
      )}
      {/* Ручки угловые */}
      {isEditing && ([
        { key: "tl" as const, sx: pTL.sx, sy: pTL.sy, cur: "nw-resize" },
        { key: "tr" as const, sx: pTR.sx, sy: pTR.sy, cur: "ne-resize" },
        { key: "bl" as const, sx: pBL.sx, sy: pBL.sy, cur: "sw-resize" },
        { key: "br" as const, sx: pBR.sx, sy: pBR.sy, cur: "se-resize" },
      ].map(c => (
        <g key={c.key} style={{ cursor: c.cur }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const svgEl = (e.currentTarget as SVGElement).ownerSVGElement;
            if (!svgEl) return;
            const svgRect = svgEl.getBoundingClientRect();
            const csx = e.clientX - svgRect.left;
            const csy = e.clientY - svgRect.top;
            const wp = unprojFrame(csx, csy, h.z);
            if (!wp) return;
            const _xys2 = xyScale ?? 1;
            // Углы рамки распроецируем ТЕМ ЖЕ unprojFrame, что и точку (без рассинхрона).
            const activeBounds = (wb.x1 === 0 && wb.x2 === 0)
              ? (() => {
                  const wBL = unprojFrame(rx,      ry + rh, h.z);
                  const wTR = unprojFrame(rx + rw, ry,      h.z);
                  if (!wBL || !wTR) return wb;
                  return { x1: wBL.x / _xys2, y1: wBL.y / _xys2, x2: wTR.x / _xys2, y2: wTR.y / _xys2 };
                })()
              : wb;
            const startState = { horizonId: h.id, corner: c.key, startWx: wp.x / _xys2, startWy: wp.y / _xys2, startBounds: activeBounds };
            setDraggingPrintCorner(startState);
            const fmt2 = h.printLayer!.paperFormat ?? "A3";
            const ori2 = h.printLayer!.orientation ?? "landscape";
            const mm2 = PAPER_SIZES_MM[fmt2 as PaperFormat];
            const aspect2 = ori2 === "landscape" ? mm2.w / mm2.h : mm2.h / mm2.w;
            const onMove = (me: MouseEvent) => {
              const sx2 = me.clientX - svgRect.left;
              const sy2 = me.clientY - svgRect.top;
              const wp2 = unprojFrame(sx2, sy2, h.z);
              if (!wp2) return;
              const sb = startState.startBounds;
              const b2 = { ...sb };
              const wx2 = wp2.x / _xys2;
              switch (startState.corner) {
                case "br": { const w2 = wx2 - sb.x1; const nw2 = Math.max(Math.abs(sb.x2-sb.x1)*0.05, w2); b2.x2 = sb.x1+nw2; b2.y1 = sb.y2-nw2/aspect2; break; }
                case "bl": { const w2 = sb.x2 - wx2; const nw2 = Math.max(Math.abs(sb.x2-sb.x1)*0.05, w2); b2.x1 = sb.x2-nw2; b2.y1 = sb.y2-nw2/aspect2; break; }
                case "tr": { const w2 = wx2 - sb.x1; const nw2 = Math.max(Math.abs(sb.x2-sb.x1)*0.05, w2); b2.x2 = sb.x1+nw2; b2.y2 = sb.y1+nw2/aspect2; break; }
                case "tl": { const w2 = sb.x2 - wx2; const nw2 = Math.max(Math.abs(sb.x2-sb.x1)*0.05, w2); b2.x1 = sb.x2-nw2; b2.y2 = sb.y1+nw2/aspect2; break; }
              }
              onPrintLayerBoundsChange?.(h.id, b2);
            };
            const onUp = () => {
              setDraggingPrintCorner(null);
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}>
          <circle cx={c.sx} cy={c.sy} r={8} fill="white" stroke="#7c3aed" strokeWidth={2} />
          <circle cx={c.sx} cy={c.sy} r={3} fill="#7c3aed" />
        </g>
      )))}
    </>
  );
}
