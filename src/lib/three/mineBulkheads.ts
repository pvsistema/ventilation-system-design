// ─────────────────────────────────────────────────────────────────────────────
// mineBulkheads.ts — ПЕРЕМЫЧКИ И ДВЕРИ В ОБЪЁМЕ (режим «Модель»).
//
// ЧТО БЫЛО НЕ ТАК. Перемычка в объёме рисовалась плоской карточкой со значком
// из легенды, натянутой на габаритный прямоугольник сечения (см. mineSymbols).
// Отсюда две беды, обе — ошибки чтения схемы:
//
//   • карточка ПРЯМОУГОЛЬНАЯ, а выработка — арочная, круглая, трапецеидальная.
//     У арки углы карточки торчали сквозь свод, у круглого ствола квадрат
//     вылезал за стенки на треть диаметра. Перемычка выглядела вставленной «не
//     по месту», хотя в натуре она именно вписана в сечение;
//   • карточка ПЛОСКАЯ. При облёте она поворачивалась ребром и исчезала: на
//     схеме, где перемычек сотни, участок вдруг оказывался открытым, хотя он
//     заглушен. Толщина у сооружения есть и она видна — бетонная перемычка это
//     полметра бетона, а не лист бумаги.
//
// ЧТО ЗДЕСЬ. Перемычка собирается ОБЪЁМНОЙ ПЛИТОЙ по ТОМУ ЖЕ контуру сечения
// (sectionOutline из tube3d.ts), по которому построено тело самой выработки.
// Значит она вписана в ветвь при любой форме — прямоугольной, сводчатой,
// трапецеидальной, круглой — и при любой площади: контур там уже приведён к
// фактической S, по которой считается вентиляция. Толщина — по типу
// сооружения: у водяной перемычки она заметно больше, чем у паруса.
//
// ЧИТАЕТСЯ ТАК (и это ровно то, что несёт значок на чертеже):
//   • сплошная плита             → выработка заглушена наглухо;
//   • плита со створкой          → вентиляционная дверь, закрыта;
//   • две створки и жёлтый знак  → дверь автоматическая;
//   • сквозное окно с заслонкой  → регулятор: воздух идёт, но зажат;
//   • сквозной проём             → перемычка с проёмом, воздух проходит;
//   • решётка в проёме           → решётчатая дверь;
//   • рама и отведённая створка  → дверь открытая;
//   • цвет плиты                 → материал: бетон, дерево, кирпич, металл.
//
// Цвета взяты БУКВА В БУКВУ из легенды чертежа (schemaSymbols.ts): зелёный —
// бетон, жёлтый — дерево, оранжевый — кирпич, фиолетовый — металл. Человек,
// читающий чертёж, обязан узнать материал в объёме без всякой легенды.
//
// СКОРОСТЬ. Перемычки группируются по «тип + материал + сечение ветви»: на
// схеме таких сочетаний десятки, а самих перемычек — сотни. Каждая группа —
// один InstancedMesh: геометрия строится один раз по контуру первой ветви
// группы, экземпляр лишь поворачивается вдоль своей выработки и ставится на
// своё место. Ключ группы включает сечение — иначе перемычка получила бы
// ЧУЖОЙ контур и перестала бы вписываться в выработку, ради чего всё и
// затевалось.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { sectionOutline } from "@/lib/tube3d";
import { BULKHEAD_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { toThree, branchSectionQuaternion } from "./mineScene";

/**
 * Потолок числа объёмных перемычек в сцене.
 *
 * Плита — это полсотни граней, и они пакуются по группам, поэтому запас можно
 * брать щедрый: на крупной шахте перемычек сотни, но не десятки тысяч. Всё,
 * что за потолком, остаётся плоскими значками — см. mineSymbols.
 */
export const MAX_BULKHEADS = 2000;

/**
 * До какого числа перемычек рисуется контур плиты.
 *
 * Контур — то, чем плита отличается от пятна: по нему видно кромку сооружения
 * на фоне выработки того же цвета. Но линии инстансинг не поддерживают, и на
 * очень большой схеме их буфер вырастает. Дальше порога обходимся заливкой.
 */
const EDGE_LIMIT = 700;

/** Тип сооружения — по нему собирается геометрия. */
type Kind =
  | "solid"    // глухая перемычка
  | "door"     // дверь вентиляционная закрытая
  | "auto"     // дверь автоматическая
  | "window"   // регулятор / дверь с регулируемым окном
  | "proem"    // перемычка с проёмом (сквозной, без заслонки)
  | "lattice"  // решётчатая дверь
  | "open"     // дверь открытая: рама плюс отведённая створка
  | "sail"     // парус вентиляционный
  | "water"    // водяная перемычка
  | "barrier"  // барьерная перемычка
  | "fire";    // противопожарная дверь

/** Материал сооружения — по нему берётся цвет плиты. */
type Mat = "base" | "concrete" | "wood" | "brick" | "metal";

/**
 * Тип сооружения по id значка.
 *
 * Порядок проверок важен: «auto_» обязан разбираться раньше «door_», иначе
 * автоматическая дверь стала бы обычной закрытой и потеряла бы свой признак.
 */
function kindOf(id: string): Kind {
  if (id === "sail") return "sail";
  if (id.startsWith("water_dam")) return "water";
  if (id === "barrier" || id === "bulkhead_barrier") return "barrier";
  if (id === "fire_door" || id === "fire_door_pp") return "fire";
  if (id.startsWith("auto_") || id.startsWith("door_auto")) return "auto";
  if (id.startsWith("lat_") || id === "regulator_lattice") return "lattice";
  if (id.startsWith("proem_")) return "proem";
  if (id.startsWith("win_") || id === "bulkhead_window"
    || id === "regulator" || id === "regulator_open" || id === "regulator_window") return "window";
  if (id.startsWith("open_")) return "open";
  if (id.startsWith("door_")) return "door";
  return "solid";
}

/** Материал по окончанию id: те же пять исполнений, что в справочнике. */
function matOf(id: string): Mat {
  if (/(_concrete|_conc)$/.test(id)) return "concrete";
  if (/_wood$/.test(id)) return "wood";
  if (/_brick$/.test(id)) return "brick";
  if (/_metal$/.test(id)) return "metal";
  return "base";
}

/**
 * Цвет плиты по материалу — ровно тот же, что у значка на чертеже.
 *
 * Это не оформление: материал перемычки читают по цвету, и разойтись с
 * чертежом здесь нельзя. Исполнение «без материала» (белый значок) в объёме
 * белым делать нельзя — на светлом фоне сцены оно пропадает; берём светло-
 * серый бетонный тон.
 */
const MAT_COLOR: Record<Mat, number> = {
  base: 0xdfe4ea,
  concrete: 0x4caf50,
  wood: 0xffd600,
  brick: 0xff9800,
  metal: 0x9c27b0,
};

/** Шероховатость и металличность — чтобы дерево не блестело как сталь. */
const MAT_FINISH: Record<Mat, { rough: number; metal: number }> = {
  base: { rough: 0.85, metal: 0.05 },
  concrete: { rough: 0.92, metal: 0.0 },
  wood: { rough: 0.78, metal: 0.0 },
  brick: { rough: 0.95, metal: 0.0 },
  metal: { rough: 0.32, metal: 0.75 },
};

/**
 * Толщина сооружения в метрах — по типу, как в натуре.
 *
 * Это не «на глаз»: водяная перемычка держит столб воды и делается заметно
 * массивнее обычной, а парус — это ткань на раме, у которой толщины почти нет.
 * Разница видна в объёме и сама по себе говорит, что за сооружение стоит.
 */
const THICK: Record<Kind, number> = {
  solid: 0.45,
  door: 0.30,
  auto: 0.32,
  window: 0.38,
  proem: 0.38,
  lattice: 0.28,
  open: 0.26,
  sail: 0.10,
  water: 0.85,
  barrier: 0.55,
  fire: 0.34,
};

/**
 * Цвет полотна паруса — чёрный, при любом исполнении рамы.
 *
 * Парус в натуре это тёмное прорезиненное полотно, разрезанное на полосы,
 * и в шахте он читается именно чёрным пятном в сечении. Материал (дерево,
 * металл) относится к раме, а не к ткани, поэтому цвет полотна от него не
 * зависит: зелёный или жёлтый парус спутали бы с перемычкой.
 */
const SAIL_COLOR = 0x15171c;

/** На сколько полос разрезано полотно — как в натуре, чтобы люди проходили. */
function sailStripCount(width: number): number {
  return Math.max(4, Math.min(9, Math.round(width / 1.1)));
}

/** Ширина щели между полосами, м: по ней и видно, что полотно разрезано. */
const SAIL_GAP = 0.05;

/**
 * Насколько сильно полотно выдувает потоком — доля полуширины сечения.
 *
 * Ноль давал бы плоскую тряпку, поэтому даже в стоячем воздухе оставляем
 * заметный провис: парус висит, а не натянут. Верх предела подобран так,
 * чтобы выдутое полотно не протыкало стенки выработки.
 */
const SAIL_BOW_MAX = 0.55;

/** Скорость воздуха, при которой парус выдут полностью, м/с. */
const SAIL_V_FULL = 3.5;

/**
 * Насколько парус выдут в этой ветви: −1…+1.
 *
 * Знак — направление выдува: он обязан совпадать с направлением воздуха,
 * иначе полотно «дуло бы» против струи, и человек прочитал бы схему наоборот.
 */
function sailBow(b: TopoBranch): number {
  const v = Math.abs(b.velocity ?? 0);
  const t = Math.min(1, Math.pow(v / SAIL_V_FULL, 0.7));
  const mag = 0.14 + 0.86 * t;
  const sign = (b.flow ?? 0) < 0 ? -1 : 1;
  return mag * sign;
}

/** Габариты контура сечения: ширина, высота и центр по вертикали. */
function outlineBox(pts: { r: number; u: number }[]) {
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity;
  for (const p of pts) {
    if (p.r < r0) r0 = p.r;
    if (p.r > r1) r1 = p.r;
    if (p.u < u0) u0 = p.u;
    if (p.u > u1) u1 = p.u;
  }
  return { w: r1 - r0, h: u1 - u0, cu: (u0 + u1) / 2, r0, r1, u0, u1 };
}

/**
 * Насколько плита не доходит до стенки выработки.
 *
 * Впритык ставить нельзя: грань плиты и грань трубы оказались бы в одной
 * плоскости, и видеокарта показала бы их мерцающей рябью (z-fighting). Полтора
 * процента сечения глазом не различимы, а рябь снимают полностью.
 */
const FIT = 0.985;

/**
 * Переводит заготовку в местные оси ВЫРАБОТКИ.
 *
 * Фигуру сечения удобно строить в плоскости XY и выдавливать по Z. Но тело
 * выработки построено иначе: у него вдоль оси идёт X, а сечение лежит в
 * (Y=верх, Z=вбок) — см. buildProfileGeometry в mineScene. Плита обязана жить
 * в ТОЙ ЖЕ системе, потому что ставится ТОЙ ЖЕ матрицей, что и труба; иначе
 * при наклонной выработке свод плиты смотрел бы не туда, куда свод выработки.
 *
 * Поворот, а не перестановка осей: перестановка — зеркальное отображение, оно
 * вывернуло бы нормали наизнанку и плита почернела бы. Все наши сечения
 * симметричны поперёк, поэтому поворот ничего не ломает.
 */
function orient(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.rotateY(Math.PI / 2);
  return g;
}

/** Контур сечения как замкнутая фигура: r — вбок, u — вверх. */
function sectionShape(outline: { r: number; u: number }[]): THREE.Shape {
  const s = new THREE.Shape();
  outline.forEach((p, i) => {
    const x = p.r * FIT, y = p.u * FIT;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  });
  s.closePath();
  return s;
}

/** Прямоугольное отверстие в плите (окно, проём, решётка, рама двери). */
function holePath(cx: number, cy: number, w: number, h: number): THREE.Path {
  const p = new THREE.Path();
  const hw = w / 2, hh = h / 2;
  p.moveTo(cx - hw, cy - hh);
  p.lineTo(cx + hw, cy - hh);
  p.lineTo(cx + hw, cy + hh);
  p.lineTo(cx - hw, cy + hh);
  p.closePath();
  return p;
}

/** Размеры сквозного отверстия для типов, у которых оно есть. Доли сечения. */
function holeSize(kind: Kind): { w: number; h: number; cy: number } | null {
  if (kind === "window") return { w: 0.26, h: 0.40, cy: -0.06 };
  if (kind === "proem") return { w: 0.34, h: 0.52, cy: -0.10 };
  if (kind === "lattice") return { w: 0.46, h: 0.58, cy: -0.02 };
  if (kind === "open") return { w: 0.58, h: 0.80, cy: -0.04 };
  return null;
}

/**
 * Вертикальный просвет сечения в точке x: от почвы до кровли.
 *
 * Полоса паруса обязана быть подрезана по ТОМУ ЖЕ контуру, по которому
 * построена выработка, иначе у арочной кровли углы полотна торчали бы сквозь
 * свод — ровно та беда, ради которой перемычки и перевели с плоских карточек
 * на контур сечения. Ищем пересечения вертикали x со всеми рёбрами контура и
 * берём крайние: для наших сечений (прямоугольник, трапеция, арка, круг) этого
 * достаточно, они выпуклые.
 */
function spanAt(outline: { r: number; u: number }[], x: number): { u0: number; u1: number } | null {
  let lo = Infinity, hi = -Infinity;
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const p = outline[i], q = outline[(i + 1) % n];
    const pr = p.r * FIT, qr = q.r * FIT;
    const pu = p.u * FIT, qu = q.u * FIT;
    if (x < Math.min(pr, qr) - 1e-9 || x > Math.max(pr, qr) + 1e-9) continue;
    if (Math.abs(qr - pr) < 1e-9) {
      lo = Math.min(lo, pu, qu); hi = Math.max(hi, pu, qu);
      continue;
    }
    const t = (x - pr) / (qr - pr);
    const u = pu + t * (qu - pu);
    if (u < lo) lo = u;
    if (u > hi) hi = u;
  }
  return hi - lo > 1e-6 ? { u0: lo, u1: hi } : null;
}

/**
 * Полотно паруса: несколько отдельных полос, подрезанных по сечению.
 *
 * Парус — не плита, а занавес из прорезиненных полос, подвешенный к кровле:
 * полосы расходятся, пропуская людей и вагонетки, и при этом почти не выпускают
 * воздух. Поэтому геометрия здесь — не выдавленный контур, а набор тонких
 * сеток: каждая полоса своей ширины, сверху и по бокам обрезана кровлей и
 * стенками, снизу доходит до почвы.
 *
 * Каждой вершине кладём aG — её место на полотне (0…1 поперёк всего сечения и
 * 0 у кровли … 1 у почвы). По этим двум числам вершинный шейдер выдувает
 * полотно вдоль выработки: ткань закреплена у стенок и вверху, а низ полосы
 * свободно отходит по потоку. Считать это на процессоре для сотен парусов
 * нельзя — поэтому форма живёт в шейдере, а геометрия остаётся неподвижной.
 */
function sailGeometry(outline: { r: number; u: number }[]): THREE.BufferGeometry | null {
  const box = outlineBox(outline);
  const r0 = box.r0 * FIT, r1 = box.r1 * FIT;
  const W = r1 - r0;
  if (!(W > 0.05)) return null;

  const n = sailStripCount(W);
  const gap = Math.min(SAIL_GAP, W / (n * 4));
  const sw = (W - gap * (n - 1)) / n;
  if (!(sw > 0.02)) return null;

  const NX = 4;   // столбцов в полосе
  const NY = 10;  // рядов по высоте: по ним и складывается провис

  const pos: number[] = [];
  const gs: number[] = [];
  const idx: number[] = [];

  for (let s = 0; s < n; s++) {
    const x0 = r0 + s * (sw + gap);
    const base = pos.length / 3;
    let ok = true;
    for (let i = 0; i <= NX && ok; i++) {
      const x = x0 + (sw * i) / NX;
      const sp = spanAt(outline, x);
      if (!sp) { ok = false; break; }
      for (let j = 0; j <= NY; j++) {
        const v = j / NY;                       // 0 — кровля, 1 — почва
        const u = sp.u1 + (sp.u0 - sp.u1) * v;
        pos.push(x, u, 0);
        gs.push((x - r0) / W, v);
      }
    }
    if (!ok) { pos.length = base * 3; gs.length = base * 2; continue; }
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        const a = base + i * (NY + 1) + j;
        const b = a + (NY + 1);
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }

  if (idx.length === 0) return null;

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aG", new THREE.Float32BufferAttribute(gs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return orient(g);
}

/**
 * Кусок шейдера: куда отходит вершина полотна.
 *
 * bow — насколько выдут парус (знак = по какую сторону идёт воздух), phase —
 * собственный сдвиг полосы, чтобы соседние не колыхались как одно целое, spd —
 * темп колыхания: чем быстрее струя, тем чаще ходит ткань.
 */
const SAIL_GLSL = /* glsl */`
attribute vec2 aG;
attribute vec3 aSail;
uniform float uSailTime;
float sailDisp(vec2 g, vec3 sp, float t) {
  float bow = sp.x;
  // Поперёк сечения: у стенок ткань прижата, в середине выдута сильнее всего.
  float kx = 1.0 - pow(abs(g.x * 2.0 - 1.0), 2.0);
  // Своя фаза каждой полосы — берём из её места поперёк выработки.
  float ph = sp.y + g.x * 7.0;
  float v = g.y;
  // Постоянный выдув: вверху ткань подвешена, книзу отходит всё дальше.
  float base = kx * (0.40 * sin(3.14159 * v) + 0.60 * pow(v, 1.5));
  // Колыхание: волна бежит сверху вниз, у подвеса её нет, у низа — вся.
  float wave = 0.22 * sin(uSailTime * sp.z + ph - v * 4.0) * pow(v, 1.6) * kx;
  return bow * (base + wave);
}
`;

/**
 * Плита сооружения: контур сечения, выдавленный на толщину.
 *
 * Фигура строится в местных осях сечения (x — вбок, y — вверх), выдавливается
 * вдоль z и центрируется: экземпляр ставится в точку на оси выработки, и плита
 * должна сидеть на ней серединой, а не начинаться от неё.
 */
function plateGeometry(
  outline: { r: number; u: number }[],
  kind: Kind,
  thick: number,
): THREE.BufferGeometry {
  const shape = sectionShape(outline);
  const box = outlineBox(outline);
  const hs = holeSize(kind);
  if (hs) {
    shape.holes.push(holePath(0, box.cu + box.h * hs.cy, box.w * hs.w, box.h * hs.h));
  }

  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: false, curveSegments: 1,
  });
  g.translate(0, 0, -thick / 2);

  return orient(g);
}

/** Брусок в местных осях сечения: размеры и смещение центра. */
function bar(w: number, h: number, d: number, x: number, y: number, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Слить набор заготовок в одну геометрию (или ничего, если набор пуст). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const m = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  // Детали строились в тех же осях сечения, что и плита, — значит и повернуть
  // их надо так же, иначе створка встала бы поперёк собственного полотна.
  return m ? orient(m) : null;
}

/**
 * Подробности сооружения поверх плиты.
 *
 * frame — то, что сделано из того же материала, что и плита (створка двери,
 * рама): цвет берётся от материала, только темнее, иначе створка сливается с
 * полотном. accent — то, что материалу не подчиняется: заслонка регулятора
 * (сталь), знак автоматики (жёлтый), полосы барьерной и противопожарной
 * (красные), пояса водяной перемычки (синие). Их цвет одинаков при любом
 * исполнении — по ним узнают САМО сооружение, а не то, из чего оно сделано.
 */
function detailGeometry(
  outline: { r: number; u: number }[],
  kind: Kind,
  thick: number,
): { frame: THREE.BufferGeometry | null; accent: THREE.BufferGeometry | null } {
  const { w, h, cu } = outlineBox(outline);
  const frame: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  // Накладные части выступают за плиту: иначе их не видно вовсе — они
  // оказались бы внутри её же толщины.
  const d = thick * 1.35;

  if (kind === "door" || kind === "fire") {
    // Створка: полотно двери в раме. На чертеже её показывают жирной кромкой,
    // в объёме — выступом, который видно с любой стороны.
    frame.push(bar(w * 0.50, h * 0.72, d, 0, cu - h * 0.03));
    // Ручка: короткий брусок у края створки. Мелочь, но по ней дверь читается
    // дверью, а не заплатой на перемычке.
    accent.push(bar(w * 0.05, h * 0.10, d * 1.2, w * 0.19, cu - h * 0.03));
  }

  if (kind === "auto") {
    // Две створки, расходящиеся от середины, — так автоматическую дверь и
    // показывают: она открывается сама, полотна разъезжаются.
    frame.push(bar(w * 0.22, h * 0.72, d, -w * 0.13, cu - h * 0.03));
    frame.push(bar(w * 0.22, h * 0.72, d,  w * 0.13, cu - h * 0.03));
    // Знак автоматики над проёмом — жёлтый: на чертеже это кружок «А» сбоку.
    accent.push(bar(w * 0.16, h * 0.09, d * 1.2, 0, cu + h * 0.30));
  }

  if (kind === "window") {
    // Заслонка регулятора: перекрывает окно не целиком — по остатку и видно,
    // что воздух идёт, но зажат. Сдвинута вбок, как реальный шибер.
    const hs = holeSize("window")!;
    accent.push(bar(
      w * hs.w * 0.62, h * hs.h * 1.06, d * 0.7,
      -w * hs.w * 0.20, cu + h * hs.cy, thick * 0.55,
    ));
  }

  if (kind === "lattice") {
    // Решётка в проёме: три прутка вертикально, три горизонтально — ровно так
    // же, как нарисовано на значке.
    const hs = holeSize("lattice")!;
    const hw = w * hs.w, hh = h * hs.h, cy = cu + h * hs.cy;
    const t = Math.max(0.03, Math.min(hw, hh) * 0.06);
    for (let i = -1; i <= 1; i++) {
      accent.push(bar(t, hh, thick * 0.8, (hw / 3) * i, cy));
      accent.push(bar(hw, t, thick * 0.8, 0, cy + (hh / 3) * i));
    }
  }

  if (kind === "open") {
    // Открытая дверь: створка отведена к стенке и стоит под углом к сечению.
    // Именно поэтому её не рисуют в проёме — в проёме воздух идёт свободно.
    const hs = holeSize("open")!;
    const leaf = new THREE.BoxGeometry(w * hs.w * 0.95, h * hs.h * 0.96, thick * 0.9);
    // Поворот вокруг вертикали: полотно распахнуто внутрь выработки.
    leaf.translate(w * hs.w * 0.47, 0, 0);
    leaf.rotateY(-1.15);
    leaf.translate(-w * hs.w * 0.47, cu + h * hs.cy, 0);
    frame.push(leaf);
  }

  if (kind === "water") {
    // Водяная перемычка: два синих пояса. Синий — вода, и он один при любом
    // материале корпуса.
    accent.push(bar(w * 0.86, h * 0.07, d, 0, cu + h * 0.16));
    accent.push(bar(w * 0.86, h * 0.07, d, 0, cu - h * 0.16));
  }

  if (kind === "barrier") {
    // Барьерная: косые красные полосы — общепринятая разметка препятствия.
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(w * 0.16, h * 1.05, d);
      g.rotateZ(s * 0.55);
      g.translate(w * 0.18 * s, cu, 0);
      accent.push(g);
    }
  }

  if (kind === "fire") {
    // Противопожарная: красный пояс поверх створки.
    accent.push(bar(w * 0.62, h * 0.10, d * 1.15, 0, cu + h * 0.26));
  }

  return { frame: merge(frame), accent: merge(accent) };
}

/**
 * Материал полотна паруса.
 *
 * Стандартный материал берём как есть (свет в сцене один на всё, и парус не
 * должен выпадать из него чужой закраской), но подменяем вершинную часть: форма
 * полотна считается на видеокарте. Иначе на схеме с сотней парусов пришлось бы
 * каждый кадр перебирать тысячи вершин на процессоре.
 *
 * Возвращаем и материал, и его uniform времени: по нему полотно колышется.
 */
function makeSailMaterial(): { mat: THREE.MeshStandardMaterial; time: { value: number } } {
  const time = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({
    color: SAIL_COLOR,
    roughness: 0.94,
    metalness: 0.0,
    // Полотно тонкое: его видно и с той стороны, откуда идёт воздух, и с
    // противоположной. Односторонняя ткань пропадала бы при облёте.
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSailTime = time;
    // Врезаемся в <common>, а не в начало файла: three.js дописывает сверху
    // свои определения и версию шейдера, и код, поставленный до них, на части
    // видеокарт не компилируется.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>", "#include <common>\n" + SAIL_GLSL,
    );
    // Смещаем и саму вершину, и её нормаль: без поворота нормали выдутое
    // полотно осталось бы плоско освещённым и провис был бы не виден.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      /* glsl */`
      #include <begin_vertex>
      float sD = sailDisp(aG, aSail, uSailTime);
      transformed.x += sD;
      `,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      /* glsl */`
      #include <beginnormal_vertex>
      {
        float d0 = sailDisp(aG, aSail, uSailTime);
        float du = sailDisp(aG + vec2(0.0, 0.03), aSail, uSailTime) - d0;
        float dv = sailDisp(aG + vec2(0.03, 0.0), aSail, uSailTime) - d0;
        objectNormal = normalize(vec3(1.0, -du * 12.0, -dv * 12.0));
      }
      `,
    );
  };
  return { mat, time };
}

/** Цвет накладных частей: то же исполнение, но темнее полотна. */
function frameColor(mat: Mat): THREE.Color {
  return new THREE.Color(MAT_COLOR[mat]).multiplyScalar(0.62);
}

/** Цвет опознавательных частей — по типу сооружения, не по материалу. */
function accentColor(kind: Kind): number {
  if (kind === "auto") return 0xfacc15;          // знак автоматики
  if (kind === "barrier" || kind === "fire") return 0xdc2626;
  if (kind === "water") return 0x2563eb;
  return 0x94a3b8;                                // сталь: заслонка, решётка, ручка
}

/**
 * Ключ группы: тип, материал и СЕЧЕНИЕ ветви.
 *
 * Сечение в ключе — главное. Геометрия строится по контуру ПЕРВОЙ ветви
 * группы и надевается на все остальные; попади в одну группу выработки с
 * разным сечением — перемычка получила бы чужой контур и перестала бы
 * вписываться в свою выработку. Округление до 10 см и 0,1 м² оставляет
 * группировку рабочей: сечения на схеме повторяются.
 */
function groupKey(b: TopoBranch, kind: Kind, mat: Mat): string {
  const r = (v: number) => Math.round((v ?? 0) * 10) / 10;
  const s = b.shape ?? "rect";
  const a = Math.round((b.area ?? 0) * 10) / 10;
  const geo = s === "round"
    ? `round:${r(b.diameter ?? 0)}`
    : s === "trap"
      ? `trap:${r(b.rectWidth)}:${r(b.rectHeight)}:${r(b.trapTopWidth ?? 0)}`
      : s === "arch"
        ? `arch:${r(b.rectWidth)}:${r(b.rectHeight)}:${r(b.archHeight ?? 0)}`
        : s === "custom" ? "custom" : `rect:${r(b.rectWidth)}:${r(b.rectHeight)}`;
  return `${kind}|${mat}|${geo}:${a}`;
}

/** Быстрота колыхания полотна, рад/с: чем сильнее струя, тем чаще ходит ткань. */
function sailFlutter(b: TopoBranch, animSpeed: number | undefined): number {
  const v = Math.min(8, Math.abs(b.velocity ?? 0));
  return (0.7 + v * 0.55) * Math.max(0.1, animSpeed ?? 1);
}

export interface BulkheadsInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  /** Условные обозначения схемы: берём из них только перемычки и двери. */
  symbols: SchemaSymbol[];
  xyScale: number;
  zScale: number;
  /**
   * Общий размер знаков — та же ручка S/M/L, что у плоских обозначений.
   *
   * На размер по сечению она НЕ влияет: перемычка вписана в выработку, и
   * раздутая на треть плита торчала бы сквозь её стенки. Ручка меняет только
   * ТОЛЩИНУ сооружения — насколько массивно оно выглядит вдоль выработки.
   */
  sizeK?: number;
  /** Множитель темпа анимации — тот же, что у стрелок и вентиляторов. */
  animSpeed?: number;
}

/** Готовый слой объёмных перемычек. */
export interface MineBulkheads {
  group: THREE.Group;
  dispose(): void;
  /** Сколько перемычек попало в сцену. */
  count: number;
  /** Сколько вызовов отрисовки они добавили. */
  drawCalls: number;
  /** Есть ли в слое паруса — только ради них стоит гонять кадры. */
  hasSail: boolean;
  /** Время анимации, с: по нему колышутся полотна парусов. */
  setTime(t: number): void;
}

/** Одна поставленная перемычка: положение и оси сечения. */
interface Placed {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  /** Ветвь, в которой стоит сооружение: у паруса по ней считается выдув. */
  branch: TopoBranch;
}

/**
 * Строит слой объёмных перемычек.
 *
 * Возвращает null, если на схеме нет ни одной перемычки, привязанной к
 * выработке с координатами: пустой слой только мешает освобождать память.
 */
export function buildMineBulkheads(input: BulkheadsInput): MineBulkheads | null {
  const { nodes, branches, symbols, xyScale, zScale } = input;
  if (!symbols || symbols.length === 0) return null;

  const kx = xyScale > 0 ? xyScale : 1;
  const kz = zScale > 0 ? zScale : 1;
  const sizeK = Math.max(0.2, Math.min(4, input.sizeK ?? 1));

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const branchById = new Map(branches.map(b => [b.id, b]));

  /** Группы: ключ → сечение-образец, тип, материал и список постановок. */
  const groups = new Map<string, {
    branch: TopoBranch; kind: Kind; mat: Mat; items: Placed[];
  }>();
  let total = 0;

  for (const sym of symbols) {
    if (total >= MAX_BULKHEADS) break;
    if (!BULKHEAD_SYMBOL_IDS.has(sym.typeId)) continue;
    // Знак без привязки к выработке в объёме поставить некуда: его экранные
    // координаты к трёхмерной схеме отношения не имеют.
    if (!sym.branchId) continue;
    const b = branchById.get(sym.branchId);
    // Перемычка в тупике — сооружение, которое там И СТОИТ: сплошь и рядом
    // именно ею выработку и заглушили, отчего она стала тупиковой. Скрывать
    // её — значит убирать со схемы причину нулевого расхода.
    if (!b) continue;
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) continue;
    if (!isFinite(fn.x) || !isFinite(fn.y) || !isFinite(fn.z)) continue;
    if (!isFinite(tn.x) || !isFinite(tn.y) || !isFinite(tn.z)) continue;

    const a = toThree(fn.x * kx, fn.y * kx, fn.z * kz);
    const c = toThree(tn.x * kx, tn.y * kx, tn.z * kz);
    const dir = new THREE.Vector3().subVectors(c, a);
    const len = dir.length();
    if (!(len > 1e-6)) continue;
    dir.divideScalar(len);

    const t = Math.max(0, Math.min(1, sym.t ?? 0.5));
    const pos = new THREE.Vector3().lerpVectors(a, c, t);

    const kind = kindOf(sym.typeId);
    const mat = matOf(sym.typeId);
    const key = groupKey(b, kind, mat);
    let g = groups.get(key);
    if (!g) { g = { branch: b, kind, mat, items: [] }; groups.set(key, g); }
    g.items.push({ pos, dir, branch: b });
    total++;
  }

  if (total === 0) return null;

  const group = new THREE.Group();
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  /** Uniform-ы времени полотен: по ним колышутся паруса. */
  const sailTimes: { value: number }[] = [];
  let drawCalls = 0;
  const wantEdges = total <= EDGE_LIMIT;

  // Масштаб сечения — тот же множитель плана, которым растянуто тело выработки
  // (см. branchMatrix в mineScene): иначе перемычка и труба разошлись бы в
  // размере при «Масштаб XY ×2,7». Одинаковый по всем осям — иначе круглый
  // ствол и его перемычка превратились бы в эллипсы по-разному.
  const scl = new THREE.Vector3(kx, kx, kx);

  for (const [, g] of groups) {
    const outline = sectionOutline(g.branch);
    if (outline.length < 3) continue;
    // Толщина в метрах; ручка S/M/L делает сооружение массивнее или тоньше, но
    // сечение не трогает. Нижняя граница — чтобы плита не выродилась в лист.
    const thick = Math.max(0.06, THICK[g.kind] * sizeK);

    // ── Матрицы экземпляров ──────────────────────────────────────────────
    // Поворот берётся РОВНО ТОТ ЖЕ, что у тела выработки — общей функцией из
    // mineScene. Считать его здесь по-своему нельзя: на наклонном съезде два
    // разных способа дают разный разворот вокруг оси, и свод плиты оказывается
    // повёрнут относительно свода выработки. Плита обязана сидеть в трубе как
    // влитая, а не «примерно там».
    const matrices: THREE.Matrix4[] = g.items.map(p => {
      const q = branchSectionQuaternion(p.dir);
      return new THREE.Matrix4().compose(p.pos, q, scl);
    });

    const addBatch = (geom: THREE.BufferGeometry, material: THREE.Material, order: number) => {
      const mesh = new THREE.InstancedMesh(geom, material, matrices.length);
      mesh.frustumCulled = false;
      // Поверх тела выработки: сооружение стоит ВНУТРИ неё, и в сплошном
      // режиме грань трубы то и дело оказывается на волос ближе к камере.
      mesh.renderOrder = order;
      matrices.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      geoms.push(geom);
      mats.push(material);
      drawCalls++;
      return mesh;
    };

    // ── Парус: полотно вместо плиты ──────────────────────────────────────
    // Парус не заглушает выработку, поэтому плитой его рисовать нельзя — это
    // занавес из чёрных прорезиненных полос, который выдувается струёй. Каждому
    // экземпляру кладём свой выдув по РАСХОДУ его ветви: рядом стоящие паруса в
    // разных выработках должны показывать разную струю, иначе по схеме не
    // прочитать, где воздух идёт сильнее и в какую сторону.
    if (g.kind === "sail") {
      const cloth = sailGeometry(outline);
      if (cloth) {
        const { mat: sailMat, time } = makeSailMaterial();
        sailTimes.push(time);
        const mesh = new THREE.InstancedMesh(cloth, sailMat, matrices.length);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        const wSec = outlineBox(outline).w;
        const sp = new Float32Array(matrices.length * 3);
        matrices.forEach((mm, i) => {
          mesh.setMatrixAt(i, mm);
          const b = g.items[i].branch;
          sp[i * 3] = sailBow(b) * wSec * SAIL_BOW_MAX;
          sp[i * 3 + 1] = (i * 2.399963) % 6.2832;   // своя фаза каждому парусу
          sp[i * 3 + 2] = sailFlutter(b, input.animSpeed);
        });
        mesh.instanceMatrix.needsUpdate = true;
        cloth.setAttribute("aSail", new THREE.InstancedBufferAttribute(sp, 3));
        group.add(mesh);
        geoms.push(cloth);
        mats.push(sailMat);
        drawCalls++;
        continue;
      }
      // Полотно не построилось (вырожденное сечение) — падаем на общий путь:
      // лучше показать тонкую плиту, чем не показать сооружение вовсе.
    }

    // ── Плита ────────────────────────────────────────────────────────────
    const finish = MAT_FINISH[g.mat];
    const plateGeom = plateGeometry(outline, g.kind, thick);
    const plateMat = new THREE.MeshStandardMaterial({
      color: MAT_COLOR[g.mat],
      roughness: finish.rough,
      metalness: finish.metal,
      // Парус выгнут и виден с обеих сторон; у остальных плита замкнута, но
      // человек заходит за перемычку при облёте — обратную грань тоже надо
      // рисовать, иначе сооружение пропадает с одной стороны.
      side: THREE.DoubleSide,
    });
    addBatch(plateGeom, plateMat, 3);

    // ── Створки, заслонки, знаки ─────────────────────────────────────────
    const det = detailGeometry(outline, g.kind, thick);
    if (det.frame) {
      addBatch(det.frame, new THREE.MeshStandardMaterial({
        color: frameColor(g.mat),
        roughness: finish.rough, metalness: finish.metal,
        side: THREE.DoubleSide,
      }), 4);
    }
    if (det.accent) {
      addBatch(det.accent, new THREE.MeshStandardMaterial({
        color: accentColor(g.kind),
        roughness: 0.45, metalness: 0.35,
        side: THREE.DoubleSide,
      }), 4);
    }

    // ── Контур плиты ─────────────────────────────────────────────────────
    // Линии инстансинг не поддерживают, поэтому рёбра всей группы сводим в
    // ОДИН буфер: матрицу экземпляра применяем здесь, на сборке. Получается
    // один вызов отрисовки на группу — столько же, сколько у заливки.
    if (wantEdges) {
      const proto = new THREE.EdgesGeometry(plateGeom, 25);
      const src = proto.getAttribute("position") as THREE.BufferAttribute;
      const cnt = src.count;
      const dst = new Float32Array(cnt * 3 * matrices.length);
      const v = new THREE.Vector3();
      let o = 0;
      for (const mm of matrices) {
        for (let k = 0; k < cnt; k++) {
          v.fromBufferAttribute(src, k).applyMatrix4(mm);
          dst[o] = v.x; dst[o + 1] = v.y; dst[o + 2] = v.z;
          o += 3;
        }
      }
      proto.dispose();

      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.BufferAttribute(dst, 3));
      const em = new THREE.LineBasicMaterial({
        color: new THREE.Color(MAT_COLOR[g.mat]).multiplyScalar(0.35),
        transparent: true, opacity: 0.9, depthWrite: false,
      });
      const lines = new THREE.LineSegments(eg, em);
      lines.frustumCulled = false;
      lines.renderOrder = 5;
      group.add(lines);
      geoms.push(eg);
      mats.push(em);
      drawCalls++;
    }
  }

  const dispose = () => {
    group.clear();
    geoms.forEach(g => g.dispose());
    mats.forEach(mt => mt.dispose());
    geoms.length = 0;
    mats.length = 0;
  };

  const setTime = (t: number) => {
    for (const u of sailTimes) u.value = t;
  };

  return { group, dispose, count: total, drawCalls, hasSail: sailTimes.length > 0, setTime };
}