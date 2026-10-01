import type { HorizonPrintLayer } from "@/lib/topology";
import type { RouteLegendItem } from "@/lib/inspectionRoutes";
import { computeRoutesBlockLayout, buildRoutesBlockElements } from "@/lib/printRoutesBlock";

// ─────────────────────────────────────────────────────────────────────────────
// Блок «Маршруты профилактического обследования» на листе печати:
// цвет маршрута, наименование, длина, время хода. Перетаскивается мышью,
// смещение хранится в мм листа (routesOffsetX/Y), как у блока УО.
// ─────────────────────────────────────────────────────────────────────────────

export interface RoutesBlockProps {
  horizonId: string;
  pl: HorizonPrintLayer;
  items: RouteLegendItem[];
  rx: number; ry: number; rw: number; rh: number;
  inset: number;
  onPrintLayerChange?: (horizonId: string, patch: Partial<HorizonPrintLayer>) => void;
}

export function RoutesBlock({ horizonId, pl, items, rx, ry, rw, rh, inset, onPrintLayerChange }: RoutesBlockProps) {
  if (items.length === 0) return null;
  const L = computeRoutesBlockLayout(pl, items, rx, ry, rw, rh, inset);
  const { lines, texts, swatches, lw, lwThin } = buildRoutesBlockElements(items, L);
  const canDrag = !!onPrintLayerChange;

  return (
    <g key="routes-block">
      <rect x={L.x} y={L.y + L.titleH} width={L.w} height={L.h - L.titleH} fill="white" style={{ pointerEvents: "none" }} />
      {lines.map((ln, i) => (
        <line key={`rl-${i}`} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke="#1a1a1a" strokeWidth={ln.thick ? lw : lwThin} />
      ))}
      {swatches.map((sw, i) => (
        <line key={`rs-${i}`} x1={sw.x1} y1={sw.y} x2={sw.x2} y2={sw.y} stroke={sw.color} strokeWidth={sw.width} strokeLinecap="round" />
      ))}
      {texts.map((t, i) => (
        <text key={`rt-${i}`} x={t.x} y={t.y} textAnchor={t.anchor} dominantBaseline="central"
          fontSize={t.size} fontFamily="Arial, sans-serif" fontWeight={t.bold ? "bold" : undefined} fill={t.color ?? "#222"}>
          {t.text}
        </text>
      ))}
      {canDrag && (
        <rect x={L.x} y={L.y} width={L.w} height={L.h} fill="transparent"
          style={{ cursor: "move" }}
          onMouseDown={(e) => {
            e.stopPropagation(); e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const startOX = pl.routesOffsetX ?? 0, startOY = pl.routesOffsetY ?? 0;
            const pxmm = L.pxPerMm || 1;
            const onMove = (me: MouseEvent) => onPrintLayerChange?.(horizonId, {
              routesOffsetX: startOX + (me.clientX - startX) / pxmm,
              routesOffsetY: startOY + (me.clientY - startY) / pxmm,
            });
            const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
            window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
          }}
        />
      )}
    </g>
  );
}
