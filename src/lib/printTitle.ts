// Заголовок листа слоя печати: размер шрифта, ширина строки и перенос текста.
// Общая геометрия для рабочей области, предпросмотра и экспорта в SVG.
import type { HorizonPrintLayer } from "@/lib/topology";

export const TITLE_FONT_MIN = 0.4, TITLE_FONT_MAX = 3;
export const TITLE_WIDTH_MIN = 0.2, TITLE_WIDTH_MAX = 0.95;
/** Ширина строки заголовка по умолчанию — доля ширины листа */
export const TITLE_WIDTH_DEFAULT = 0.6;

/** Приблизительная ширина символа Arial Bold в долях кегля */
const CHAR_W = 0.6;

/** Разбить текст на строки: ручные переводы строки + перенос по словам. */
export function wrapTitleLines(text: string, maxWidthPx: number, fs: number): string[] {
  const maxChars = Math.max(4, Math.floor(maxWidthPx / (fs * CHAR_W)));
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (cand.length <= maxChars || !line) line = cand;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}

export interface TitleLayout {
  /** Центр текста по X и верх первой строки, px */
  x: number; y: number;
  fs: number; lineH: number;
  lines: string[];
  /** Ширина области переноса, px */
  wrapW: number;
}

/** Геометрия заголовка в экранных px (pxPerMm — px на мм листа). */
export function computeTitleLayout(
  pl: Partial<HorizonPrintLayer>, rx: number, ry: number, rw: number, inset: number, pxPerMm: number,
): TitleLayout {
  const scale = Math.min(TITLE_FONT_MAX, Math.max(TITLE_FONT_MIN, pl.titleFontScale ?? 1));
  const widthK = Math.min(TITLE_WIDTH_MAX, Math.max(TITLE_WIDTH_MIN, pl.titleWidth ?? TITLE_WIDTH_DEFAULT));
  const fs = Math.max(4, pxPerMm * 5.5 * scale);
  const wrapW = rw * widthK;
  const baseFs = Math.max(6, pxPerMm * 5.5);
  return {
    x: rx + rw / 2 + (pl.titleOffsetX ?? 0) * pxPerMm,
    y: ry + inset + baseFs + 4 + (pl.titleOffsetY ?? 0) * pxPerMm,
    fs, lineH: fs * 1.2,
    lines: wrapTitleLines(pl.title ?? "", wrapW, fs),
    wrapW,
  };
}
