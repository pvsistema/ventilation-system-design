// ─────────────────────────────────────────────────────────────────────────────
// vectorPdf.ts — сборка векторного PDF из SVG-листов прямо в программе.
//
// Раньше SVG уходил на сервер (svglib/reportlab), который: всегда делал лист A3
// (формат из окна печати игнорировался), по-своему вписывал рисунок и терял
// часть оформления. Теперь PDF собирается локально (jsPDF + svg2pdf.js):
// лист ровно того формата, что выбран, 1 px листа = 25,4/VECTOR_DPI мм.
// Работает и без сети — в десктопной версии на руднике это важно.
// ─────────────────────────────────────────────────────────────────────────────
import { VECTOR_FONT_FAMILY, type VectorFontUrls } from "@/lib/svgRecordingContext";
// Golos Text — тот же шрифт, что на экране (см. canvasFont.ts), в статических
// начертаниях 400/500/600/700. Метрики латиницы и кириллицы совпадают с
// веб-шрифтом @fontsource/golos-text 1:1, поэтому ширины подписей и плашек
// в PDF/SVG те же, что на схеме. Греческие буквы (η, Δ, ρ…) добавлены из
// IBM Plex Sans — как и на экране, где Plex стоит запасным шрифтом; редкие
// значки (⌀, стрелки, рамки) — из DejaVu Sans, чтобы не было «квадратиков».
import golos400Url from "@/assets/fonts/GolosVector-400.ttf?url";
import golos500Url from "@/assets/fonts/GolosVector-500.ttf?url";
import golos600Url from "@/assets/fonts/GolosVector-600.ttf?url";
import golos700Url from "@/assets/fonts/GolosVector-700.ttf?url";

/** Файлы шрифта векторного листа по начертаниям. */
export const VECTOR_FONT_URLS: VectorFontUrls = {
  400: golos400Url, 500: golos500Url, 600: golos600Url, 700: golos700Url,
};

/**
 * Разрешение координат векторного листа. Совпадает с разрешением печати
 * (300 dpi) — те же числа толщин, кеглей и размеров, что у листа печати.
 */
export const VECTOR_DPI = 300;

const fontCache = new Map<string, Promise<string>>();
function loadFontBase64(url: string): Promise<string> {
  let p = fontCache.get(url);
  if (!p) {
    p = fetch(url)
      .then(r => { if (!r.ok) throw new Error(`Шрифт не загружен (${r.status})`); return r.arrayBuffer(); })
      .then(buf => {
        const bytes = new Uint8Array(buf);
        let bin = "";
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) {
          bin += String.fromCharCode(...bytes.subarray(i, i + CH));
        }
        return btoa(bin);
      });
    p.catch(() => fontCache.delete(url));
    fontCache.set(url, p);
  }
  return p;
}

export interface VectorPdfOptions {
  paperWmm: number;
  paperHmm: number;
  /** Файлы шрифта по начертаниям (по умолчанию — Golos Text). */
  fontUrls?: VectorFontUrls;
  /** Номера листов «N / M» в правом нижнем углу (отступы в мм) или null. */
  pageNumbers?: { rightMm: number; bottomMm: number } | null;
  title?: string;
}

/** Несколько SVG-листов (каждый — paperW×paperH мм при VECTOR_DPI) → PDF. */
export async function svgStringToPdf(svgPages: string[], o: VectorPdfOptions): Promise<Blob> {
  const urls = o.fontUrls ?? VECTOR_FONT_URLS;
  const weights = [400, 500, 600, 700] as const;
  const [{ jsPDF }, { svg2pdf }, ...fonts] = await Promise.all([
    import("jspdf"),
    import("svg2pdf.js"),
    ...weights.map(w => loadFontBase64(urls[w])),
  ]);
  const landscape = o.paperWmm > o.paperHmm;
  const pdf = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "mm",
    format: [o.paperWmm, o.paperHmm],
    compress: true,
  });
  // Шрифт встраивается в PDF (подмножество символов). Начертания регистрируются
  // так, как их ищет svg2pdf: 400 → "normal", 700 → "bold", 500/600 →
  // "500normal"/"600normal" (font-weight="500" / "600" в разметке листа).
  weights.forEach((w, i) => {
    const file = `GolosText-${w}.ttf`;
    pdf.addFileToVFS(file, fonts[i]);
    if (w === 400) pdf.addFont(file, VECTOR_FONT_FAMILY, "normal");
    else if (w === 700) pdf.addFont(file, VECTOR_FONT_FAMILY, "bold");
    else pdf.addFont(file, VECTOR_FONT_FAMILY, "normal", w);
  });
  pdf.setFont(VECTOR_FONT_FAMILY, "normal");
  if (o.title) pdf.setProperties({ title: o.title, creator: "ПВ-Система" });

  const parser = new DOMParser();
  // svg2pdf читает стили через getComputedStyle — узел должен быть в документе.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden";
  document.body.appendChild(host);
  try {
    for (let i = 0; i < svgPages.length; i++) {
      if (i > 0) pdf.addPage([o.paperWmm, o.paperHmm], landscape ? "landscape" : "portrait");
      const doc = parser.parseFromString(svgPages[i], "image/svg+xml");
      const err = doc.querySelector("parsererror");
      if (err) throw new Error("Некорректная разметка листа: " + (err.textContent ?? "").slice(0, 120));
      const svgEl = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
      host.appendChild(svgEl);
      await svg2pdf(svgEl, pdf, { x: 0, y: 0, width: o.paperWmm, height: o.paperHmm });
      host.removeChild(svgEl);
      if (o.pageNumbers) {
        pdf.setFont(VECTOR_FONT_FAMILY, "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(85);
        pdf.text(`${i + 1} / ${svgPages.length}`,
          o.paperWmm - o.pageNumbers.rightMm, o.paperHmm - o.pageNumbers.bottomMm, { align: "right" });
      }
      // Отдаём управление интерфейсу между листами.
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    document.body.removeChild(host);
  }
  return pdf.output("blob");
}
