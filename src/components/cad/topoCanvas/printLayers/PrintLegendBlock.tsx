import { type TopoBranch, type PaperFormat, PAPER_SIZES_MM } from "@/lib/topology";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, FAN_SVG_STATION, FAN_SVG_PROPELLER } from "@/lib/schemaSymbols";
import { type Props } from "@/components/cad/topoCanvas/topoCanvasTypes";
import type { PrintHorizon, PrintLayerCfg } from "./printLayersScene";

// ─────────────────────────────────────────────────────────────────────────────
// Блок условных обозначений (УО) на листе. Перенесено из
// TopoCanvasPrintLayers 1:1.
//
// Легенда строится по РЕАЛЬНО установленным на схеме значкам, а не по всему
// каталогу: в лист попадает только то, что на чертеже действительно есть.
// Вентилятор — особый случай: один и тот же typeId рисуется разными УО в
// зависимости от назначения ветви (ГВУ/ВВУ — двойное кольцо, ВМП — пропеллер).
// ─────────────────────────────────────────────────────────────────────────────

export interface LegendBlockProps {
  h: PrintHorizon;
  pl: PrintLayerCfg;
  rx: number; ry: number; rw: number; rh: number;
  inset: number;
  branches: TopoBranch[];
  schemaSymbols: NonNullable<Props["schemaSymbols"]>;
  onPrintLayerChange?: Props["onPrintLayerChange"];
}

/** Блок УО на схеме — из реально установленных символов. */
export function LegendBlock(props: LegendBlockProps) {
  const { h, pl, rx, ry, rw, rh, inset, branches, schemaSymbols, onPrintLayerChange } = props;

  // Собираем уникальные типы УО
  const usedTypeIds = [...new Set(schemaSymbols.map(s => s.typeId))];
  const legendItems: { name: string; svgContent: string; isBulkhead: boolean; tid: string }[] = [];
  for (const tid of usedTypeIds) {
    const lt = LEGEND_TYPES.find(l => l.id === tid);
    const isBk = BULKHEAD_SYMBOL_IDS.has(tid);
    if (tid === "fan") {
      // Вентилятор: разные УО по назначению ветви (ГВУ/ВВУ — двойное кольцо, ВМП — пропеллер)
      const fanTypes = new Set(
        schemaSymbols.filter(s => s.typeId === "fan")
          .map(s => branches.find(b => b.id === s.branchId)?.fanType ?? "ВМП")
      );
      if (fanTypes.has("ГВУ") || fanTypes.has("ВВУ"))
        legendItems.push({ name: "Вентиляторная установка (ГВУ/ВВУ)", svgContent: FAN_SVG_STATION, isBulkhead: false, tid });
      if (fanTypes.has("ВМП") || fanTypes.size === 0)
        legendItems.push({ name: "Вентилятор местного проветривания (ВМП)", svgContent: FAN_SVG_PROPELLER, isBulkhead: false, tid });
    }
    else if (lt) legendItems.push({ name: lt.name, svgContent: lt.svgContent, isBulkhead: false, tid });
    else if (isBk) legendItems.push({ name: tid.replace(/_/g, " "), svgContent: "", isBulkhead: true, tid });
  }
  if (legendItems.length === 0) return null;

  // Фиксированный масштаб по формату листа (как у штампа)
  const _mmL = PAPER_SIZES_MM[(pl.paperFormat ?? "A3") as PaperFormat];
  const _paperWmmL = (pl.orientation ?? "landscape") === "landscape" ? Math.max(_mmL.w, _mmL.h) : Math.min(_mmL.w, _mmL.h);
  const pxPerMmL = rw / _paperWmmL;
  const legFontSize = pxPerMmL * 2.6;
  const legIconSZ = pxPerMmL * 5.5;
  const legLineH = legIconSZ + legFontSize * 0.4;
  const legPad = legFontSize * 0.6;
  const legW = pxPerMmL * 60;
  const legH = legPad * 2 + legendItems.length * legLineH + legFontSize * 1.5;
  // Смещение УО хранится в ММ листа (как внутренние координаты штампа),
  // поэтому умножаем на pxPerMmL — блок масштабируется вместе с листом
  // и не "убегает" при зуме.
  const legOffX = (pl.legendOffsetX ?? 0) * pxPerMmL;
  const legOffY = (pl.legendOffsetY ?? 0) * pxPerMmL;
  const lx = rx + inset + legOffX;
  const ly = ry + rh - inset - legH + legOffY;
  const canDrag = !!onPrintLayerChange;

  return (
    <g key="legend-block">
      <text x={lx} y={ly + legPad + legFontSize} fontSize={legFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
        Условные обозначения
      </text>
      {legendItems.map((item, idx) => {
        const iy = ly + legPad + legFontSize * 1.5 + idx * legLineH;
        const icX = lx;
        const icY = iy + (legLineH - legIconSZ) / 2;
        return (
          <g key={idx}>
            {!item.isBulkhead && item.svgContent ? (
              <image
                x={icX} y={icY} width={legIconSZ} height={legIconSZ}
                href={`data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40">${encodeURIComponent(item.svgContent)}</svg>`}
              />
            ) : (
              <g>
                <line x1={icX} y1={iy + legLineH / 2} x2={icX + legIconSZ} y2={iy + legLineH / 2} stroke="#555" strokeWidth={1.2} />
                <rect
                  x={icX + legIconSZ / 2 - legIconSZ * 0.175} y={icY + legIconSZ * 0.1}
                  width={legIconSZ * 0.35} height={legIconSZ * 0.8}
                  fill={item.tid.includes("conc") ? "#4caf50" : item.tid.includes("wood") ? "#ffd600" : item.tid.includes("brick") ? "#ff9800" : item.tid.includes("metal") ? "#9c27b0" : item.tid.includes("regulator") ? "#ffd600" : "white"}
                  stroke="#1a1a1a" strokeWidth={1}
                />
              </g>
            )}
            <text x={lx + legIconSZ + legPad * 0.8} y={iy + legLineH * 0.6}
              fontSize={legFontSize * 0.88} fontFamily="Arial, sans-serif" fill="#333">
              {item.name}
            </text>
          </g>
        );
      })}
      {/* Ручка перемещения */}
      {canDrag && (
        <rect x={lx} y={ly} width={legW} height={legH} fill="transparent"
          style={{ cursor: "move" }}
          onMouseDown={(e) => {
            e.stopPropagation(); e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const startOX = pl.legendOffsetX ?? 0, startOY = pl.legendOffsetY ?? 0;
            const pxmm = pxPerMmL || 1;
            const onMove = (me: MouseEvent) => onPrintLayerChange?.(h.id, { legendOffsetX: startOX + (me.clientX - startX) / pxmm, legendOffsetY: startOY + (me.clientY - startY) / pxmm });
            const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
            window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
          }}
        />
      )}
    </g>
  );
}
