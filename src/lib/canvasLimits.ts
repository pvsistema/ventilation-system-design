// ─────────────────────────────────────────────────────────────────────────────
// canvasLimits.ts — пределы растрового холста браузера и безопасный подбор
// качества печати/экспорта.
//
// ЗАЧЕМ. Раньше проверялась только ДЛИНА СТОРОНЫ (32768 px), а у браузера есть
// второй, независимый предел — ОБЩАЯ ПЛОЩАДЬ. Замер в Chromium дал ровно
// 268 435 456 пикселей (2^28). Лист A0 при 600 dpi — это 19866×28087 px:
// каждая сторона укладывается в 32768, но площадь втрое больше предела.
// Браузер в этом случае не сообщает об ошибке — он молча отдаёт ПУСТОЙ холст,
// и на принтер уходил белый лист.
//
// Теперь оба предела считаются в одном месте, а качество при необходимости
// понижается так, чтобы лист гарантированно отрисовался.
// ─────────────────────────────────────────────────────────────────────────────

/** Предельная длина стороны холста. */
export function maxSidePx(): number {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  return isMobile ? 8192 : 32768;
}

/**
 * Предельная площадь холста в пикселях.
 *
 * Замер в Chromium: 2^28 = 268 435 456. Берём с запасом 10% — у части
 * устройств предел ниже из-за нехватки памяти под видеобуфер, и упереться
 * в него означает получить пустой лист.
 */
export function maxAreaPx(): number {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  return isMobile ? 16 * 1024 * 1024 : Math.floor(268435456 * 0.9);
}

export interface DpiFit {
  /** Качество, с которым лист реально будет отрисован. */
  effectiveDpi: number;
  /** Итоговый размер холста. */
  width: number;
  height: number;
  /** Качество пришлось понизить относительно запрошенного. */
  limited: boolean;
  /** Что именно упёрлось в предел — для текста предупреждения. */
  reason: "none" | "side" | "area";
  /** Размер, который получился бы без ограничения. */
  requestedWidth: number;
  requestedHeight: number;
}

/**
 * Подбирает качество, при котором лист заданного размера гарантированно
 * отрисуется: учитывает и длину стороны, и общую площадь.
 *
 * @param paperWmm ширина листа, мм
 * @param paperHmm высота листа, мм
 * @param dpi      желаемое качество
 */
export function fitDpiToCanvas(paperWmm: number, paperHmm: number, dpi: number): DpiFit {
  const toPx = (mm: number, d: number) => Math.max(1, Math.round(mm * d / 25.4));
  const reqW = toPx(paperWmm, dpi);
  const reqH = toPx(paperHmm, dpi);

  const maxSide = maxSidePx();
  const maxArea = maxAreaPx();

  // Во сколько раз нужно ужать по стороне и по площади. Коэффициент площади —
  // квадратный корень: уменьшение стороны в k раз снижает площадь в k².
  const sideK = Math.min(maxSide / reqW, maxSide / reqH, 1);
  const areaK = reqW * reqH > maxArea ? Math.sqrt(maxArea / (reqW * reqH)) : 1;
  const k = Math.min(sideK, areaK);

  if (k >= 1) {
    return {
      effectiveDpi: dpi, width: reqW, height: reqH,
      limited: false, reason: "none",
      requestedWidth: reqW, requestedHeight: reqH,
    };
  }

  // Округляем качество вниз до целого — дробное dpi выглядело бы в интерфейсе
  // странно, а лишняя доля процента роли не играет.
  const effectiveDpi = Math.max(36, Math.floor(dpi * k));
  return {
    effectiveDpi,
    width: toPx(paperWmm, effectiveDpi),
    height: toPx(paperHmm, effectiveDpi),
    limited: true,
    reason: areaK < sideK ? "area" : "side",
    requestedWidth: reqW,
    requestedHeight: reqH,
  };
}

/** Человеческое описание ограничения для подсказки в интерфейсе. */
export function describeLimit(fit: DpiFit): string {
  if (!fit.limited) return "";
  const mp = (w: number, h: number) => (w * h / 1e6).toFixed(0);
  if (fit.reason === "area") {
    return `Лист ${fit.requestedWidth}×${fit.requestedHeight} пикс. `
      + `(${mp(fit.requestedWidth, fit.requestedHeight)} Мпикс) превышает предел браузера `
      + `по площади — качество снижено до ${fit.effectiveDpi} dpi, иначе лист вышел бы пустым.`;
  }
  return `Сторона листа ${fit.requestedWidth}×${fit.requestedHeight} пикс. превышает предел `
    + `браузера (${maxSidePx()} пикс.) — качество снижено до ${fit.effectiveDpi} dpi.`;
}
