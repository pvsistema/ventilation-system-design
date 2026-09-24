// ─────────────────────────────────────────────────────────────────────────────
// canvasFont.ts — шрифт подписей, которые рисуются прямо на холсте схемы.
//
// Canvas 2D не понимает CSS-переменные (ctx.font = "var(--font-ui)" молча
// игнорируется), поэтому семейство задаётся здесь строкой — тем же набором,
// что и --font-ui в index.css. Запасные шрифты те же: если Golos Text почему-то
// не загрузился, подписи падают на IBM Plex / Segoe UI, а не на Times.
//
// Ширину рамок подписей схема считает через measureText по реальному шрифту,
// поэтому смена шрифта не ломает раскладку. Единственная ловушка — холст
// рисует сразу, а веб-шрифт догружается позже: первый кадр вышел бы запасным
// шрифтом и так и остался. Для этого есть onCanvasFontsReady — схема
// перерисовывается, когда шрифты готовы.
// ─────────────────────────────────────────────────────────────────────────────

/** Семейство шрифта подписей на холсте (синхронно с --font-ui). */
export const CANVAS_FONT_FAMILY = `"Golos Text","IBM Plex Sans","Segoe UI",sans-serif`;

/** Готовая строка для ctx.font: вес, размер в px и семейство. */
export function canvasFont(sizePx: number, weight: number | string = 400): string {
  return `${weight} ${sizePx}px ${CANVAS_FONT_FAMILY}`;
}

let readyPromise: Promise<void> | null = null;

/**
 * Промис, который разрешается, когда шрифты подписей загружены.
 * Грузим явно нужные начертания: document.fonts.ready не ждёт шрифтов,
 * которые ещё ни разу не использовались в разметке.
 */
export function canvasFontsReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  if (typeof document === "undefined" || !document.fonts?.load) {
    readyPromise = Promise.resolve();
    return readyPromise;
  }
  readyPromise = Promise.all(
    ["400", "500", "600", "700"].map(w =>
      document.fonts.load(`${w} 12px "Golos Text"`, "Аа0").catch(() => []),
    ),
  ).then(() => undefined);
  return readyPromise;
}

/** Вызвать cb один раз, когда шрифты подписей готовы (для перерисовки схемы). */
export function onCanvasFontsReady(cb: () => void): () => void {
  let alive = true;
  canvasFontsReady().then(() => { if (alive) cb(); });
  return () => { alive = false; };
}

let measureCtx: CanvasRenderingContext2D | null = null;

/**
 * Ширина самой длинной строки подписи в пикселях — по реальному шрифту.
 *
 * Плашки подписей раньше оценивались как «символов × кегль × 0,52» — это
 * средняя ширина символа Segoe UI. У Golos Text средняя ширина другая
 * (0,50…0,66 em в зависимости от текста), и рамка расходилась бы с текстом.
 * Первая строка меряется полужирной — она у подписей обычно заголовок.
 */
export function measureLabelW(lines: string[], sizePx: number, firstBold = true): number {
  if (!measureCtx) {
    if (typeof document === "undefined") return Math.max(0, ...lines.map(l => l.length)) * sizePx * 0.58;
    measureCtx = document.createElement("canvas").getContext("2d");
    if (!measureCtx) return Math.max(0, ...lines.map(l => l.length)) * sizePx * 0.58;
  }
  let w = 0;
  lines.forEach((l, i) => {
    measureCtx!.font = canvasFont(sizePx, firstBold && i === 0 ? 700 : 400);
    w = Math.max(w, measureCtx!.measureText(l).width);
  });
  return w;
}
