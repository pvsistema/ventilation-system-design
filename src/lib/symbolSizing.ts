// ─────────────────────────────────────────────────────────────────────────────
// symbolSizing.ts — ЕДИНЫЕ формулы размера условных обозначений (УО) и их
// подписей-индикаторов для всех трёх рендеров: рабочая область (SVG/canvas),
// предпросмотр печати и экспорт (PNG/PDF/SVG).
//
// ЗАЧЕМ. Раньше каждый рендер считал размер по-своему:
//   • экран        — от РЕАЛЬНОЙ ширины ветви на экране (hostW × objSF) и
//                    пользовательских процентов «Перемычки»/«Вентиляторы»;
//   • печать/экспорт — от «сырого» view.scale (замерная станция) или вовсе от
//                    константы 32 × symScale (вентилятор, насос, вентиль).
// На листе view.scale в разы больше экранного (схема подгоняется под 300 DPI),
// поэтому значки замерных станций и вентиляторов вылезали огромными, а их
// подписи — вместе с ними. Теперь и экран, и лист используют функции отсюда.
// ─────────────────────────────────────────────────────────────────────────────
import {
  BULKHEAD_SYMBOL_IDS, HEATER_SYMBOL_IDS, SHAFT_MOUTH_SYMBOL_IDS, shaftMouthSize,
} from "@/lib/schemaSymbols";

/** УО, размер которых задан процентом «Вентиляторы» (fanScale). */
export const FAN_LIKE_SYMBOL_IDS = new Set([
  "fan", "pump", "valve_water", "valve_reduce",
]);

/** Контекст масштабирования: одинаково считается на экране и на листе. */
export interface SymbolSizing {
  /** Масштаб объектов — тот же, с которым рисуются ветви (см. computeObjSF). */
  objSF: number;
  /** Дополнительное сжатие подписей при отдалении схемы. */
  indZoomSF: number;
  /** Размер перемычек/замерных станций, % от ширины ветви. */
  bulkheadScale: number;
  /** Размер вентиляторов/насосов/вентилей, % от ширины ветви. */
  fanScale: number;
  /** Режим «тонкие линии»: подписи считаются от ширины 1 px. */
  thinLines: boolean;
}

/**
 * Коэффициент сжатия подписей при отдалении.
 * Опорный масштаб — тот, при котором objSF = 1 (view.scale = xyScale × 0.4).
 * Ниже него подписи уменьшаются вместе с геометрией схемы, выше — не растут.
 */
export function computeIndZoomSF(viewScale: number, xyScale?: number): number {
  const ref = Math.max(1, xyScale ?? 1) * 0.4;
  return viewScale < ref ? viewScale / ref : 1;
}

/** Собирает контекст масштабирования из параметров рендера. */
export function makeSymbolSizing(p: {
  objSF: number;
  viewScale: number;
  xyScale?: number;
  bulkheadScale?: number;
  fanScale?: number;
  thinLines?: boolean;
}): SymbolSizing {
  return {
    objSF: p.objSF,
    indZoomSF: computeIndZoomSF(p.viewScale, p.xyScale),
    bulkheadScale: p.bulkheadScale ?? 150,
    fanScale: p.fanScale ?? 450,
    thinLines: p.thinLines ?? false,
  };
}

/**
 * Размер УО, стоящего на ветви.
 *
 * @param typeId  тип условного обозначения
 * @param sc      пользовательский множитель символа (sym.scale)
 * @param hostW   ширина выработки-хозяина (symbolHostWidth), до масштаба
 * @returns размер в пикселях либо null — если тип не привязан к ширине ветви
 *          (тогда вызывающий код применяет свою формулу «свободного» значка).
 */
export function symbolSizeOnBranch(
  typeId: string,
  sc: number,
  hostW: number,
  s: SymbolSizing,
): number | null {
  const realW = Math.max(hostW * s.objSF, 1.0);

  if (BULKHEAD_SYMBOL_IDS.has(typeId) || HEATER_SYMBOL_IDS.has(typeId)
      || typeId === "measure_station" || typeId === "emergency_exit") {
    // Высота поперёк ветви = ширина ветви × bulkheadScale%; ph = SZ × 0.85.
    const ph = realW * (s.bulkheadScale / 100);
    return Math.max(6, (ph / 0.85) * sc);
  }
  if (SHAFT_MOUTH_SYMBOL_IDS.has(typeId)) {
    return shaftMouthSize(realW, sc);
  }
  if (FAN_LIKE_SYMBOL_IDS.has(typeId)) {
    return Math.max(8, realW * (s.fanScale / 100) * sc);
  }
  return null;
}

/**
 * Масштаб текста подписи-индикатора у УО.
 * Считается от ширины ветви — ровно как подписи самих выработок
 * (canvasRenderer: textSc = max(0.3, branchPx × 0.28)), чтобы подписи
 * перемычки, вентилятора и выработки на одной ветви были одного размера.
 */
export function indicatorTextScale(hostW: number, s: SymbolSizing): number {
  const branchPx = (s.thinLines ? 1 : hostW) * s.objSF;
  return Math.max(0.3, branchPx * 0.28) * s.indZoomSF;
}

/** Кегль подписи-индикатора: базовые 8.5 px × масштаб × польз. «Размер» (9 = 100%). */
export function indicatorFontSize(hostW: number, fontSize: number | undefined, s: SymbolSizing): number {
  return Math.max(3, 8.5 * indicatorTextScale(hostW, s) * ((fontSize ?? 9) / 9));
}

/** Отступ подписи от значка и коэффициент её пользовательского смещения. */
export function indicatorOffsetSF(s: SymbolSizing): number {
  return (s.objSF * s.indZoomSF) || 1;
}
