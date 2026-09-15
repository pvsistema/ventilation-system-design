// ─────────────────────────────────────────────────────────────────────────────
// tube3d.ts — ПРОТОТИП объёмной отрисовки горных выработок («путь А»).
//
// ЧТО ЭТО. Сейчас выработка на схеме — линия с постоянной толщиной в пикселях.
// Здесь она превращается в ТРУБУ: по реальному сечению (ширина, высота, форма)
// строится контур, он сносится вдоль оси выработки, и получившаяся поверхность
// заливается с затенением. Получается объём, который поворачивается вместе со
// схемой и правильно перекрывается соседними выработками.
//
// ПОЧЕМУ ТАК, А НЕ WebGL. Всё считается тем же Canvas 2D, которым рисуется
// схема сейчас. Значит сохраняются печать, экспорт, слой печати, выделение и
// оверлей условных обозначений — их не нужно переписывать. Цена — процессорное
// время: объёмная выработка стоит примерно вчетверо дороже линии, поэтому
// объём включается только вблизи и только для видимых выработок (см. LOD ниже).
//
// ─────────────────────────────────────────────────────────────────────────────
// КАК СТРОИТСЯ ТРУБА
//
// 1. Сечение выработки задаётся в МИРОВЫХ метрах (ширина a, высота h, свод).
//    Оно лежит в плоскости, перпендикулярной оси выработки.
// 2. Берём два орта этой плоскости: «вправо» и «вверх». Для горных выработок
//    «вверх» — это мировая ось Z: кровля всегда сверху, как бы ни шла выработка.
// 3. Контур сечения переносим в оба конца выработки и проецируем ВСЕ точки
//    через тот же project3D, которым рисуется остальная схема. Никакой своей
//    математики камеры — поэтому объём не «разъезжается» со схемой.
// 4. Боковую поверхность разбиваем на полосы между соседними точками контура.
//    Каждая полоса — четырёхугольник, который заливается своим оттенком в
//    зависимости от наклона к источнику света. Это и даёт ощущение объёма.
//
// ЗАТЕНЕНИЕ. Освещение считается по нормали полосы — по закону Ламберта
// (яркость ∝ косинус угла между нормалью и направлением на свет). Формула
// простая и честная, «на глаз» ничего не подбиралось.
// ─────────────────────────────────────────────────────────────────────────────
import { project3D, type ProjOptions, type TopoBranch } from "@/lib/topology";

/** Точка контура сечения в локальных координатах, м. */
interface SectionPoint { r: number; u: number }

/**
 * Сколько граней у круглого сечения.
 *
 * 12 — компромисс: при 8 на крупном плане видны углы, при 16 растёт стоимость
 * отрисовки почти без видимого выигрыша.
 */
export const ROUND_FACETS = 12;

/**
 * Контур сечения выработки в локальных координатах (метры).
 *
 * r — поперёк оси («вправо»), u — по вертикали («вверх»).
 * Начало координат — центр сечения, поэтому контур симметричен по r.
 *
 * Формы повторяют те же поля ветви, что используются в расчёте площади:
 * никаких отдельных «графических» размеров нет — объём строится по тем же
 * числам, по которым считается вентиляция.
 */
export function sectionOutline(b: TopoBranch): SectionPoint[] {
  const shape = b.shape ?? "rect";

  if (shape === "round") {
    const rad = Math.max(0.1, (b.diameter ?? 0) / 2);
    const pts: SectionPoint[] = [];
    for (let i = 0; i < ROUND_FACETS; i++) {
      const a = (2 * Math.PI * i) / ROUND_FACETS;
      pts.push({ r: rad * Math.cos(a), u: rad * Math.sin(a) });
    }
    return pts;
  }

  const w = Math.max(0.1, b.rectWidth ?? 0);
  const h = Math.max(0.1, b.rectHeight ?? 0);
  const halfW = w / 2;

  if (shape === "trap") {
    // Трапеция: узкое верхнее основание, широкое нижнее.
    const topHalf = Math.max(0.05, (b.trapTopWidth ?? w) / 2);
    return [
      { r: -halfW,   u: -h / 2 },
      { r:  halfW,   u: -h / 2 },
      { r:  topHalf, u:  h / 2 },
      { r: -topHalf, u:  h / 2 },
    ];
  }

  if (shape === "arch") {
    // Сводчатое сечение: прямые стенки высотой h, сверху свод высотой archHeight.
    const arch = Math.max(0, b.archHeight ?? 0);
    const pts: SectionPoint[] = [
      { r: -halfW, u: -h / 2 },
      { r:  halfW, u: -h / 2 },
      { r:  halfW, u:  h / 2 },
    ];
    if (arch > 0.01) {
      // Свод —半окружность, сплющенная до высоты arch.
      const steps = 6;
      for (let i = 1; i < steps; i++) {
        const a = (Math.PI * i) / steps;          // от 0 до π
        pts.push({ r: halfW * Math.cos(a), u: h / 2 + arch * Math.sin(a) });
      }
    }
    pts.push({ r: -halfW, u: h / 2 });
    return pts;
  }

  // Прямоугольник и всё неизвестное — самый безопасный вариант.
  return [
    { r: -halfW, u: -h / 2 },
    { r:  halfW, u: -h / 2 },
    { r:  halfW, u:  h / 2 },
    { r: -halfW, u:  h / 2 },
  ];
}

/** Мировая точка. */
interface Vec3 { x: number; y: number; z: number }

/**
 * Орты плоскости сечения для выработки, идущей из A в B.
 *
 * «Вверх» привязан к мировой оси Z — у горной выработки кровля сверху при любом
 * направлении. Исключение — вертикальный ствол: там за «вверх» берётся мировая
 * ось Y, иначе орт вырождается в ноль и сечение схлопывается.
 */
function sectionBasis(a: Vec3, b: Vec3): { right: Vec3; up: Vec3 } | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-6)) return null;
  const ax = dx / len, ay = dy / len, az = dz / len;

  // Ось выработки почти вертикальна — берём другой опорный вектор.
  const vertical = Math.abs(az) > 0.99;
  const refX = vertical ? 0 : 0;
  const refY = vertical ? 1 : 0;
  const refZ = vertical ? 0 : 1;

  // right = ось × ref  (перпендикуляр к оси, лежит горизонтально)
  let rx = ay * refZ - az * refY;
  let ry = az * refX - ax * refZ;
  let rz = ax * refY - ay * refX;
  const rl = Math.hypot(rx, ry, rz);
  if (!(rl > 1e-6)) return null;
  rx /= rl; ry /= rl; rz /= rl;

  // up = right × ось  (замыкает правую тройку)
  const ux = ry * az - rz * ay;
  const uy = rz * ax - rx * az;
  const uz = rx * ay - ry * ax;

  return { right: { x: rx, y: ry, z: rz }, up: { x: ux, y: uy, z: uz } };
}

/** Одна полоса боковой поверхности: четырёхугольник + яркость затенения. */
export interface TubeStrip {
  /** Экранные координаты четырёх углов */
  pts: [number, number, number, number, number, number, number, number];
  /** Множитель яркости 0…1 (1 — прямо освещённая грань) */
  shade: number;
  /** Средняя глубина — для сортировки полос между собой */
  depth: number;
}

export interface TubeGeometry {
  strips: TubeStrip[];
  /** Средняя глубина трубы — для сортировки выработок между собой */
  depth: number;
}

/**
 * Направление на источник света в мировых координатах.
 *
 * Свет «сверху-сбоку-спереди»: так привычнее всего читается объём на
 * инженерных схемах. Вектор единичный.
 */
const LIGHT: Vec3 = (() => {
  const v = { x: -0.4, y: -0.5, z: 0.77 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

/** Минимальная яркость — чтобы теневая сторона не становилась чёрной. */
const AMBIENT = 0.45;

/**
 * Строит боковую поверхность выработки как набор затенённых полос.
 *
 * @param b        ветвь (нужны форма и размеры сечения)
 * @param from     мировые координаты начала, уже умноженные на xyScale/zScale
 * @param to       мировые координаты конца
 * @param proj     та же проекция, которой рисуется вся схема
 * @param scaleXY  масштаб плана — сечение растягивается вместе со схемой
 * @param scaleZ   масштаб по вертикали
 */
export function buildTube(
  b: TopoBranch,
  from: Vec3,
  to: Vec3,
  proj: ProjOptions,
  scaleXY: number,
  scaleZ: number,
): TubeGeometry | null {
  const basis = sectionBasis(from, to);
  if (!basis) return null;

  const outline = sectionOutline(b);
  if (outline.length < 3) return null;

  const { right, up } = basis;

  // Точка контура в мировых координатах на заданном конце выработки.
  // Сечение масштабируется так же, как сама схема, иначе труба «оторвётся»
  // от осевой линии при изменении масштабов XY/Z.
  const worldPt = (base: Vec3, p: SectionPoint): Vec3 => ({
    x: base.x + (right.x * p.r + up.x * p.u) * scaleXY,
    y: base.y + (right.y * p.r + up.y * p.u) * scaleXY,
    z: base.z + (right.z * p.r + up.z * p.u) * scaleZ,
  });

  const n = outline.length;
  const strips: TubeStrip[] = [];
  let depthSum = 0;

  for (let i = 0; i < n; i++) {
    const p0 = outline[i];
    const p1 = outline[(i + 1) % n];

    const wA0 = worldPt(from, p0), wA1 = worldPt(from, p1);
    const wB0 = worldPt(to,   p0), wB1 = worldPt(to,   p1);

    const sA0 = project3D(wA0, proj), sA1 = project3D(wA1, proj);
    const sB1 = project3D(wB1, proj), sB0 = project3D(wB0, proj);

    // Нормаль полосы в мировых координатах: середина между нормалями углов
    // контура. Для выпуклого сечения это направление «наружу» от оси.
    const mr = (p0.r + p1.r) / 2, mu = (p0.u + p1.u) / 2;
    const ml = Math.hypot(mr, mu) || 1;
    const nx = (right.x * mr + up.x * mu) / ml;
    const ny = (right.y * mr + up.y * mu) / ml;
    const nz = (right.z * mr + up.z * mu) / ml;

    // Закон Ламберта: яркость ∝ косинусу угла между нормалью и светом.
    const dot = nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z;
    const shade = AMBIENT + (1 - AMBIENT) * Math.max(0, dot);

    const depth = (sA0.depth + sA1.depth + sB0.depth + sB1.depth) / 4;
    depthSum += depth;

    strips.push({
      pts: [sA0.sx, sA0.sy, sA1.sx, sA1.sy, sB1.sx, sB1.sy, sB0.sx, sB0.sy],
      shade,
      depth,
    });
  }

  // Дальние полосы рисуем первыми — ближние их перекроют. Без этого
  // просвечивала бы задняя стенка трубы.
  strips.sort((s1, s2) => s2.depth - s1.depth);

  return { strips, depth: depthSum / n };
}

/** Осветляет/затемняет цвет множителем яркости. */
export function shadeColor(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((v >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((v >> 8) & 255) * k));
  const bl = Math.min(255, Math.round((v & 255) * k));
  return `rgb(${r},${g},${bl})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOD — КОГДА ВКЛЮЧАТЬ ОБЪЁМ
//
// Объёмная выработка стоит примерно вчетверо дороже линии: вместо одного
// отрезка рисуются 4–12 залитых полос. На схеме в тысячи ветвей это заметно,
// поэтому объём включается только там, где он реально виден.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Максимум выработок, рисуемых объёмом за кадр.
 *
 * Дальше выигрыш в наглядности исчезает (трубы сливаются в кашу), а стоимость
 * растёт линейно. Значение подобрано так, чтобы кадр укладывался в 16 мс
 * на обычном офисном ноутбуке.
 */
export const TUBE_MAX_COUNT = 500;

/**
 * Минимальная экранная длина выработки, при которой объём имеет смысл, px.
 * Короче — труба вырождается в пятно, и линия выглядит даже аккуратнее.
 */
export const TUBE_MIN_SCREEN_LEN = 24;

/** Минимальная экранная толщина трубы, px. */
export const TUBE_MIN_SCREEN_WIDTH = 6;

/**
 * Решение: рисовать ли выработку объёмом.
 *
 * Проверяются оба размера — и длина, и толщина: выработка может быть длинной,
 * но настолько узкой на экране, что объём не читается.
 */
export function shouldDrawTube(
  screenLen: number,
  screenWidth: number,
): boolean {
  return screenLen >= TUBE_MIN_SCREEN_LEN && screenWidth >= TUBE_MIN_SCREEN_WIDTH;
}
