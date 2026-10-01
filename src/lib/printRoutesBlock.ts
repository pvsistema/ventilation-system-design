// Блок «Маршруты профилактического обследования» на листе печати.
// Таблица: цвет маршрута · наименование · длина · время хода.
// Одна раскладка для рабочей области, предпросмотра и экспорта (SVG-строка).
import type { HorizonPrintLayer, PaperFormat } from "@/lib/topology";
import { PAPER_SIZES_MM } from "@/lib/topology";
import type { RouteLegendItem } from "@/lib/inspectionRoutes";

export const ROUTES_BLOCK_TITLE = "Маршруты профилактического обследования";

export interface RoutesBlockLayout {
  pxPerMm: number;
  x: number; y: number; w: number; h: number;
  fs: number; titleFs: number;
  pad: number; titleH: number; headH: number; rowH: number;
  /** Левые границы колонок: цвет, маршрут, длина, время; и правая граница */
  cols: [number, number, number, number, number];
}

function paperWidthMm(pl: HorizonPrintLayer): number {
  const mm = PAPER_SIZES_MM[(pl.paperFormat ?? "A3") as PaperFormat];
  return (pl.orientation ?? "landscape") === "landscape" ? Math.max(mm.w, mm.h) : Math.min(mm.w, mm.h);
}

/** Приблизительная ширина строки Arial (в долях кегля). */
function textW(s: string, fs: number): number {
  return s.length * fs * 0.56;
}

export function computeRoutesBlockLayout(
  pl: HorizonPrintLayer,
  items: RouteLegendItem[],
  rx: number, ry: number, rw: number, rh: number, inset: number,
): RoutesBlockLayout {
  const pxPerMm = rw / paperWidthMm(pl);
  const fs = pxPerMm * 2.3;
  const titleFs = pxPerMm * 2.6;
  const pad = pxPerMm * 1.5;
  const titleH = titleFs * 1.7;
  const headH = fs * 1.8;
  const rowH = fs * 2;
  const swatchW = pxPerMm * 12;
  const nameW = Math.max(pxPerMm * 40, ...items.map(i => textW(i.title, fs))) + pad * 2;
  const lenW = Math.max(pxPerMm * 16, ...items.map(i => textW(i.length, fs))) + pad * 2;
  const timeW = Math.max(pxPerMm * 18, ...items.map(i => textW(i.time, fs))) + pad * 2;
  const w = Math.max(swatchW + nameW + lenW + timeW, textW(ROUTES_BLOCK_TITLE, titleFs) + pad * 2);
  const extra = w - (swatchW + nameW + lenW + timeW);
  const h = titleH + headH + items.length * rowH;
  // По умолчанию — нижний левый угол; если включены УО, блок встаёт правее них.
  const baseX = rx + inset + pxPerMm * 4 + (pl.showLegend ? pxPerMm * 66 : 0);
  const x = baseX + (pl.routesOffsetX ?? 0) * pxPerMm;
  const y = ry + rh - inset - pxPerMm * 4 - h + (pl.routesOffsetY ?? 0) * pxPerMm;
  const c0 = x, c1 = c0 + swatchW, c2 = c1 + nameW + extra, c3 = c2 + lenW, c4 = c3 + timeW;
  return { pxPerMm, x, y, w, h, fs, titleFs, pad, titleH, headH, rowH, cols: [c0, c1, c2, c3, c4] };
}

export interface RoutesBlockLine { x1: number; y1: number; x2: number; y2: number; thick?: boolean }
export interface RoutesBlockText { x: number; y: number; text: string; anchor: "start" | "middle" | "end"; bold?: boolean; size: number; color?: string }
export interface RoutesBlockSwatch { x1: number; x2: number; y: number; color: string; width: number }

/** Геометрия блока: линии таблицы, тексты и цветные образцы маршрутов. */
export function buildRoutesBlockElements(items: RouteLegendItem[], L: RoutesBlockLayout) {
  const { x, y, w, h, fs, titleFs, pad, titleH, headH, rowH, cols, pxPerMm } = L;
  const lines: RoutesBlockLine[] = [];
  const texts: RoutesBlockText[] = [];
  const swatches: RoutesBlockSwatch[] = [];
  const tableY = y + titleH;
  // Рамка таблицы
  lines.push({ x1: x, y1: tableY, x2: x + w, y2: tableY, thick: true });
  lines.push({ x1: x, y1: y + h, x2: x + w, y2: y + h, thick: true });
  lines.push({ x1: x, y1: tableY, x2: x, y2: y + h, thick: true });
  lines.push({ x1: x + w, y1: tableY, x2: x + w, y2: y + h, thick: true });
  // Колонки
  for (let i = 1; i < 4; i++) lines.push({ x1: cols[i], y1: tableY, x2: cols[i], y2: y + h });
  // Строки
  lines.push({ x1: x, y1: tableY + headH, x2: x + w, y2: tableY + headH });
  for (let i = 1; i < items.length; i++) {
    const ly = tableY + headH + i * rowH;
    lines.push({ x1: x, y1: ly, x2: x + w, y2: ly });
  }
  texts.push({ x: x + w / 2, y: y + titleH / 2, text: ROUTES_BLOCK_TITLE, anchor: "middle", bold: true, size: titleFs, color: "#111" });
  const hy = tableY + headH / 2;
  texts.push({ x: (cols[0] + cols[1]) / 2, y: hy, text: "Цвет", anchor: "middle", bold: true, size: fs });
  texts.push({ x: (cols[1] + cols[2]) / 2, y: hy, text: "Маршрут", anchor: "middle", bold: true, size: fs });
  texts.push({ x: (cols[2] + cols[3]) / 2, y: hy, text: "Длина", anchor: "middle", bold: true, size: fs });
  texts.push({ x: (cols[3] + cols[4]) / 2, y: hy, text: "Время хода", anchor: "middle", bold: true, size: fs });
  items.forEach((it, i) => {
    const cy = tableY + headH + i * rowH + rowH / 2;
    swatches.push({ x1: cols[0] + pad, x2: cols[1] - pad, y: cy, color: it.color, width: pxPerMm * 1.4 });
    texts.push({ x: cols[1] + pad, y: cy, text: it.title, anchor: "start", size: fs });
    texts.push({ x: (cols[2] + cols[3]) / 2, y: cy, text: it.length, anchor: "middle", size: fs });
    texts.push({ x: (cols[3] + cols[4]) / 2, y: cy, text: it.time, anchor: "middle", size: fs });
  });
  const lw = Math.max(0.4, pxPerMm * 0.3);
  const lwThin = Math.max(0.25, pxPerMm * 0.15);
  return { lines, texts, swatches, lw, lwThin };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const n = (v: number) => v.toFixed(2);

/** SVG-разметка блока (для экспорта/печати через canvas и векторный файл). */
export function buildRoutesBlockSvgString(items: RouteLegendItem[], L: RoutesBlockLayout): string {
  const { lines, texts, swatches, lw, lwThin } = buildRoutesBlockElements(items, L);
  let s = `<rect x="${n(L.x)}" y="${n(L.y + L.titleH)}" width="${n(L.w)}" height="${n(L.h - L.titleH)}" fill="white"/>`;
  for (const ln of lines) s += `<line x1="${n(ln.x1)}" y1="${n(ln.y1)}" x2="${n(ln.x2)}" y2="${n(ln.y2)}" stroke="#1a1a1a" stroke-width="${n(ln.thick ? lw : lwThin)}"/>`;
  for (const sw of swatches) s += `<line x1="${n(sw.x1)}" y1="${n(sw.y)}" x2="${n(sw.x2)}" y2="${n(sw.y)}" stroke="${esc(sw.color)}" stroke-width="${n(sw.width)}" stroke-linecap="round"/>`;
  for (const t of texts) s += `<text x="${n(t.x)}" y="${n(t.y)}" text-anchor="${t.anchor}" dominant-baseline="central" font-size="${n(t.size)}" font-family="Arial, sans-serif"${t.bold ? ` font-weight="bold"` : ""} fill="${t.color ?? "#222"}">${esc(t.text)}</text>`;
  return s;
}
