import { type PaperFormat, type ProjOptions, PAPER_SIZES_MM } from "@/lib/topology";
import { screenToFrameNorm } from "@/lib/printFrameNorm";
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
  zScale: number;
  proj: ProjOptions;
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
    xyScale, zScale, proj, onPrintLayerChange,
    editingTitleId, setEditingTitleId, editingTitleDraft, setEditingTitleDraft,
    setDraggingPrintCorner, draggingPrintTitle, setDraggingPrintTitle,
  } = props;

  return (
    <>
      {/* Белая подложка */}
      {/* В режиме редактирования лист поднят НАД холстом схемы — сплошная белая
          заливка закрыла бы схему. Делаем её почти прозрачной: схема видна,
          а прямоугольник по-прежнему ловит мышь для перетаскивания листа. */}
      <rect x={rx} y={ry} width={rw} height={rh} fill="white"
        fillOpacity={isEditing ? 0.15 : 1}
        style={{ cursor: isEditing ? "move" : "default" }}
        onMouseDown={isEditing ? (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          // Перенос листа — в экранных координатах: лист идёт строго за мышью
          // в любом виде (план/ИЗО/фронт), без пересчёта через плоскость мира.
          const sx0 = e.clientX, sy0 = e.clientY;
          const r0 = { rx, ry, rw, rh };
          setDraggingPrintCorner({ horizonId: h.id, corner: "move", startWx: 0, startWy: 0, startBounds: wb });
          const onMove = (me: MouseEvent) => {
            const r = { ...r0, rx: r0.rx + me.clientX - sx0, ry: r0.ry + me.clientY - sy0 };
            onPrintLayerChange?.(h.id, { frameNorm: screenToFrameNorm(r, proj, xyScale ?? 1, zScale ?? 1) });
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
  zScale: number;
  proj: ProjOptions;
  unprojFrame: UnprojFrame;
  onPrintLayerBoundsChange?: Props["onPrintLayerBoundsChange"];
  onPrintLayerChange?: Props["onPrintLayerChange"];
  setDraggingPrintCorner: (v: { horizonId: string; corner: "tl" | "tr" | "bl" | "br" | "move"; startWx: number; startWy: number; startBounds: FrameWorldBounds } | null) => void;
}

type Corner = "tl" | "tr" | "bl" | "br";
type HandleKind = Corner | "t" | "b" | "l" | "r";

/**
 * Подсветка режима редактирования и ручки изменения размера листа.
 *
 * Размер меняется в ЭКРАННЫХ координатах с привязкой к противоположному углу
 * (или к противоположной стороне — для ручек на серединах сторон), строго
 * в пропорциях листа. Раньше размер пересчитывался через плоскость мира: в ИЗО
 * прямоугольник листа превращался в ромб, ручки стояли не в углах, а сдвиг
 * мыши на пиксель давал непредсказуемо большой скачок размера.
 *
 * Shift — изменять размер от центра листа.
 */
export function PrintFrameHandles(props: PrintFrameHandlesProps) {
  const {
    h, rx, ry, rw, rh, wb, isEditing,
    xyScale, zScale, proj, onPrintLayerChange, setDraggingPrintCorner,
  } = props;
  if (!isEditing) return null;

  const pl = h.printLayer!;
  const mm = PAPER_SIZES_MM[(pl.paperFormat ?? "A3") as PaperFormat];
  const aspect = (pl.orientation ?? "landscape") === "landscape" ? mm.w / mm.h : mm.h / mm.w;

  const handles: { key: HandleKind; sx: number; sy: number; cur: string }[] = [
    { key: "tl", sx: rx,          sy: ry,          cur: "nwse-resize" },
    { key: "tr", sx: rx + rw,     sy: ry,          cur: "nesw-resize" },
    { key: "bl", sx: rx,          sy: ry + rh,     cur: "nesw-resize" },
    { key: "br", sx: rx + rw,     sy: ry + rh,     cur: "nwse-resize" },
    { key: "t",  sx: rx + rw / 2, sy: ry,          cur: "ns-resize" },
    { key: "b",  sx: rx + rw / 2, sy: ry + rh,     cur: "ns-resize" },
    { key: "l",  sx: rx,          sy: ry + rh / 2, cur: "ew-resize" },
    { key: "r",  sx: rx + rw,     sy: ry + rh / 2, cur: "ew-resize" },
  ];

  const startResize = (e: React.MouseEvent, key: HandleKind) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sx0 = e.clientX, sy0 = e.clientY;
    const r0 = { rx, ry, rw, rh };
    const cx0 = rx + rw / 2, cy0 = ry + rh / 2;
    const minW = 60;
    setDraggingPrintCorner({ horizonId: h.id, corner: key.length === 2 ? key as Corner : "br", startWx: 0, startWy: 0, startBounds: wb });
    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - sx0, dy = me.clientY - sy0;
      const fromCenter = me.shiftKey;
      // Новая ширина по смещению мыши; для угловых ручек — по оси, которая
      // при пропорциях листа даёт большее изменение (курсор не «отрывается»).
      const sxSign = key.includes("l") ? -1 : key.includes("r") ? 1 : 0;
      const sySign = key.includes("t") ? -1 : key.includes("b") ? 1 : 0;
      const k = fromCenter ? 2 : 1;
      const wByX = sxSign ? r0.rw + sxSign * dx * k : null;
      const wByY = sySign ? (r0.rh + sySign * dy * k) * aspect : null;
      let w = wByX !== null && wByY !== null
        ? (Math.abs(wByX - r0.rw) >= Math.abs(wByY - r0.rw) ? wByX : wByY)
        : (wByX ?? wByY ?? r0.rw);
      w = Math.max(minW, w);
      const hh = w / aspect;
      let nx: number, ny: number;
      if (fromCenter) {
        nx = cx0 - w / 2; ny = cy0 - hh / 2;
      } else {
        // Привязка: противоположный угол / сторона остаются на месте
        nx = sxSign < 0 ? r0.rx + r0.rw - w : sxSign > 0 ? r0.rx : cx0 - w / 2;
        ny = sySign < 0 ? r0.ry + r0.rh - hh : sySign > 0 ? r0.ry : cy0 - hh / 2;
      }
      onPrintLayerChange?.(h.id, {
        frameNorm: screenToFrameNorm({ rx: nx, ry: ny, rw: w, rh: hh }, proj, xyScale ?? 1, zScale ?? 1),
      });
    };
    const onUp = () => {
      setDraggingPrintCorner(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <>
      {/* Цветная рамка-подсветка в режиме редактирования */}
      <rect x={rx - 1} y={ry - 1} width={rw + 2} height={rh + 2}
        fill="none" stroke="#7c3aed" strokeWidth={2} strokeDasharray="8 4"
        style={{ pointerEvents: "none" }} />
      {handles.map(c => {
        const corner = c.key.length === 2;
        return (
          <g key={c.key} style={{ cursor: c.cur }} onMouseDown={(e) => startResize(e, c.key)}>
            {/* Невидимая увеличенная зона захвата */}
            <circle cx={c.sx} cy={c.sy} r={12} fill="transparent" />
            {corner ? (
              <>
                <circle cx={c.sx} cy={c.sy} r={7} fill="white" stroke="#7c3aed" strokeWidth={2} />
                <circle cx={c.sx} cy={c.sy} r={2.5} fill="#7c3aed" />
              </>
            ) : (
              <rect x={c.sx - 5} y={c.sy - 5} width={10} height={10} rx={2}
                fill="white" stroke="#7c3aed" strokeWidth={2} />
            )}
            <title>{corner ? "Потяните, чтобы изменить размер листа (Shift — от центра)" : "Потяните, чтобы изменить размер листа"}</title>
          </g>
        );
      })}
    </>
  );
}
