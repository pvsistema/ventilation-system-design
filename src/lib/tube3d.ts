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

/**
 * Один плоский многоугольник поверхности трубы.
 *
 * Раньше это была строго полоса из четырёх углов. Теперь длина произвольная:
 * тем же типом описываются и торцевые заглушки, у которых углов столько же,
 * сколько точек в контуре сечения.
 */
export interface TubeStrip {
  /** Экранные координаты углов подряд: x0,y0, x1,y1, … */
  pts: number[];
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
 * Направление «от камеры вглубь сцены» в МИРОВЫХ координатах.
 *
 * Берётся не на глаз, а прямо из формулы проекции: depth = cosE·y1 − sinE·z,
 * где y1 = −sinA·x + cosA·y. Градиент этой функции по (x,y,z) и есть искомый
 * вектор — значит грань видна ровно тогда, когда её внешняя нормаль смотрит
 * навстречу, то есть скалярное произведение отрицательно.
 */
export function cameraDir(proj: ProjOptions): Vec3 {
  const az = ((proj.azimuth ?? 0) * Math.PI) / 180;
  const el = ((proj.elevation ?? 90) * Math.PI) / 180;
  const cosA = Math.cos(az), sinA = Math.sin(az);
  const cosE = Math.cos(el), sinE = Math.sin(el);
  return { x: -cosE * sinA, y: cosE * cosA, z: -sinE };
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
 * Строит поверхность выработки как набор затенённых граней.
 *
 * СЕЧЕНИЕ НЕ ДЕФОРМИРУЕТСЯ. Масштабы XY и Z — это способ РАЗНЕСТИ схему в
 * пространстве (растянуть план, преувеличить перепад высот), а не изменить
 * саму выработку. Раньше контур множился по горизонтали на scaleXY, а по
 * вертикали на scaleZ: при «Масштаб Z ×14» ствол сечением 3 м превращался в
 * плиту высотой 42 м, круглая выработка — в вытянутый эллипс. Именно отсюда
 * бралась «вытянутость», которой нет в AutoCAD.
 *
 * Теперь контур масштабируется ОДНИМ множителем по всем трём осям — форма
 * сечения остаётся честной: круг остаётся кругом при любых масштабах вида.
 *
 * @param b        ветвь (нужны форма и размеры сечения)
 * @param from     мировые координаты начала, уже умноженные на xyScale/zScale
 * @param to       мировые координаты конца
 * @param proj     та же проекция, которой рисуется вся схема
 * @param scaleXY  масштаб плана
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

  // Единый (изотропный) множитель сечения. Берём масштаб плана: по нему
  // читается схема в целом, и выработка остаётся соразмерной своей длине.
  // По вертикали НЕ берём scaleZ — иначе сечение растянется (см. выше).
  const secK = scaleXY > 0 ? scaleXY : 1;
  void scaleZ;

  // Точка контура в мировых координатах на заданном конце выработки.
  const worldPt = (base: Vec3, p: SectionPoint): Vec3 => ({
    x: base.x + (right.x * p.r + up.x * p.u) * secK,
    y: base.y + (right.y * p.r + up.y * p.u) * secK,
    z: base.z + (right.z * p.r + up.z * p.u) * secK,
  });

  const n = outline.length;
  const strips: TubeStrip[] = [];
  let depthSum = 0;
  let depthCount = 0;

  // Направление взгляда — по нему отбрасываются грани, повёрнутые к камере
  // изнанкой. Это надёжнее сортировки: у боковых полос трубы глубины почти
  // совпадают, и при приближении порядок начинал скакать от кадра к кадру —
  // труба «мерцала» и выглядела рваной. Невидимую грань просто не рисуем.
  const cam = cameraDir(proj);

  // Точки контура на обоих концах считаем ОДИН раз: раньше каждая точка
  // проецировалась дважды (как конец одной полосы и начало соседней).
  const scrA: { sx: number; sy: number; depth: number }[] = new Array(n);
  const scrB: { sx: number; sy: number; depth: number }[] = new Array(n);
  for (let i = 0; i < n; i++) {
    scrA[i] = project3D(worldPt(from, outline[i]), proj);
    scrB[i] = project3D(worldPt(to,   outline[i]), proj);
  }

  for (let i = 0; i < n; i++) {
    const p0 = outline[i];
    const p1 = outline[(i + 1) % n];
    const j = (i + 1) % n;

    // Нормаль полосы в мировых координатах: середина между нормалями углов
    // контура. Для выпуклого сечения это направление «наружу» от оси.
    const mr = (p0.r + p1.r) / 2, mu = (p0.u + p1.u) / 2;
    const ml = Math.hypot(mr, mu) || 1;
    const nx = (right.x * mr + up.x * mu) / ml;
    const ny = (right.y * mr + up.y * mu) / ml;
    const nz = (right.z * mr + up.z * mu) / ml;

    // Грань смотрит от камеры — её закрывает передняя стенка, пропускаем.
    if (nx * cam.x + ny * cam.y + nz * cam.z > 0) continue;

    // Закон Ламберта: яркость ∝ косинусу угла между нормалью и светом.
    const dot = nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z;
    const shade = AMBIENT + (1 - AMBIENT) * Math.max(0, dot);

    const a0 = scrA[i], a1 = scrA[j], b1 = scrB[j], b0 = scrB[i];
    const depth = (a0.depth + a1.depth + b0.depth + b1.depth) / 4;
    depthSum += depth;
    depthCount++;

    strips.push({
      pts: [a0.sx, a0.sy, a1.sx, a1.sy, b1.sx, b1.sy, b0.sx, b0.sy],
      shade,
      depth,
    });
  }

  // ── ТОРЦЫ ────────────────────────────────────────────────────────────────
  // Без крышек труба — открытый рукав: на повороте выработки и в тупике
  // сквозь неё просвечивало то, что лежит позади. Рисуем торец там, где он
  // обращён к камере.
  const axis = {
    x: to.x - from.x, y: to.y - from.y, z: to.z - from.z,
  };
  const axLen = Math.hypot(axis.x, axis.y, axis.z) || 1;
  axis.x /= axLen; axis.y /= axLen; axis.z /= axLen;
  const axDotCam = axis.x * cam.x + axis.y * cam.y + axis.z * cam.z;

  const pushCap = (scr: typeof scrA, normal: Vec3, reverse: boolean) => {
    const pts: number[] = [];
    let d = 0;
    for (let i = 0; i < n; i++) {
      const k = reverse ? n - 1 - i : i;
      pts.push(scr[k].sx, scr[k].sy);
      d += scr[k].depth;
    }
    const lam = normal.x * LIGHT.x + normal.y * LIGHT.y + normal.z * LIGHT.z;
    const depth = d / n;
    depthSum += depth;
    depthCount++;
    strips.push({ pts, shade: AMBIENT + (1 - AMBIENT) * Math.max(0, lam), depth });
  };

  // Торец в начале смотрит против оси, в конце — по оси. К камере обращён
  // тот, у которого скалярное произведение с направлением взгляда < 0.
  if (-axDotCam < 0) pushCap(scrA, { x: -axis.x, y: -axis.y, z: -axis.z }, true);
  if ( axDotCam < 0) pushCap(scrB, axis, false);

  if (strips.length === 0) return null;

  // Дальние грани рисуем первыми — ближние их перекроют.
  strips.sort((s1, s2) => s2.depth - s1.depth);

  return { strips, depth: depthSum / Math.max(1, depthCount) };
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