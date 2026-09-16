// ─────────────────────────────────────────────────────────────────────────────
// mineSymbols.ts — УСЛОВНЫЕ ОБОЗНАЧЕНИЯ (УО) В РЕЖИМЕ «МОДЕЛЬ».
//
// ЗАЧЕМ. В режиме «Чертёж» перемычки, двери, вентиляторы, замерные станции и
// пожарные знаки — это половина содержания схемы: по ним читают, где воздух
// перекрыт, где он поднимается вентилятором и где стоит очаг. Объёмный режим
// без них показывал голую геометрию: красиво, но документом не является.
//
// ЧТО ЗДЕСЬ СДЕЛАНО. Значки берутся ТЕ ЖЕ, что на чертеже, — из общего
// справочника LEGEND_TYPES (src/lib/schemaSymbols.ts). Их SVG рисуется в
// текстуру и надевается на плоскую карточку, поставленную в выработку на то
// самое место (доля t вдоль оси), где значок стоит на чертеже. Никакой
// «объёмной модели двери» не выдумывается: обозначение обязано выглядеть ровно
// так, как в нормативной легенде, иначе комиссия его не опознает.
//
// ДВА СПОСОБА ПОСТАНОВКИ — и это не оформление, а смысл:
//
//   • ПОПЕРЁК СЕЧЕНИЯ («cross») — перемычки, двери, регуляторы, калориферы,
//     замерные станции. Такой объект физически перекрывает выработку, и в
//     объёме он должен стоять перегородкой поперёк неё, вписанной в сечение.
//     Видно сразу: эта выработка заглушена, эта — с регулируемым окном.
//
//   • ЛИЦОМ К ЧЕЛОВЕКУ («billboard») — вентиляторы, датчики, пожарные и
//     горноспасательные знаки. Это условные ЗНАКИ, а не конструкции: их
//     задача — читаться с любого ракурса. Поставь такой знак «поперёк» — при
//     облёте он повернётся ребром и исчезнет.
//
// СКОРОСТЬ. Карточки собираются в пакеты по текстуре (InstancedMesh): на схеме
// в тысячи обозначений получается десяток-другой вызовов отрисовки, а не
// тысячи. Знаки, смотрящие на человека, разворачиваются одной общей матрицей —
// камера ортографическая, поворот у всех одинаковый.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import {
  LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, HEATER_SYMBOL_IDS, fanSvgContent,
} from "@/lib/schemaSymbols";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { toThree } from "./mineScene";

/**
 * Потолок числа обозначений в сцене.
 *
 * Каждая карточка — это экземпляр в пакете: памяти немного, но на схеме, где
 * знаков десятки тысяч, они всё равно сливаются в рябь. Ставим первые — они
 * отсортированы так же, как приходят с чертежа.
 */
const MAX_SYMBOLS = 8000;

/** Разрешение текстуры значка. 128 px хватает: знак на экране редко крупнее. */
const TEX_SIZE = 128;

/**
 * УО, которые ставятся ПОПЕРЁК сечения выработки.
 *
 * Это всё, что реально перекрывает выработку: перемычки всех материалов,
 * двери, регуляторы, калориферы. Плюс замерная станция — она тоже привязана к
 * сечению, по нему и замеряют.
 */
function isCrossSymbol(typeId: string): boolean {
  return BULKHEAD_SYMBOL_IDS.has(typeId)
    || HEATER_SYMBOL_IDS.has(typeId)
    || typeId === "measure_station";
}

/**
 * Часть холста значка, растягиваемая на всё сечение («окно» viewBox).
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. На чертеже выработка — горизонтальная линия, и
 * перемычка нарисована как узкий блок ПОПЕРЁК неё: занимает лишь полосу
 * x=20..28 из сорока восьми единиц холста. В объёме мы смотрим на ту же
 * перемычку с другой стороны — со стороны выработки, — и там она обязана
 * закрывать сечение целиком, как настоящая стенка. Возьми холст полностью —
 * получилась бы узкая доска посреди выработки, мимо которой воздух вроде бы
 * свободно проходит. Это прямая ошибка чтения схемы.
 *
 * Поэтому на сечение натягивается ЦЕНТРАЛЬНАЯ полоса холста — сам блок
 * перемычки со всеми его признаками: заливкой по материалу, вентиляционным
 * окном, решёткой, жирной кромкой закрытой двери. Теряется лишь то, что
 * нарисовано СБОКУ от блока (кружок «А» у автоматической двери) — сбоку от
 * стенки в объёме его и не разместить.
 */
function cropViewBox(typeId: string): string | null {
  if (BULKHEAD_SYMBOL_IDS.has(typeId)) return "19.2 3.2 9.6 33.6";
  // Калорифер шире перемычки: корпус занимает x=16..32.
  if (HEATER_SYMBOL_IDS.has(typeId)) return "15.2 5.2 17.6 29.6";
  // Замерная станция: на чертеже это две красные полосы вдоль выработки, они
  // размечают участок замера. В объёме берём полосу холста между ними и
  // натягиваем на сечение — получается красная рамка поперёк выработки, ровно
  // то место, по которому меряют расход.
  if (typeId === "measure_station") return "2 13.4 44 11.2";
  return null;
}

/** Габариты сечения выработки в метрах: ширина и высота. */
function sectionDims(b: TopoBranch): { w: number; h: number } {
  const shape = b.shape ?? "rect";
  if (shape === "round") {
    const d = Math.max(0.5, b.diameter ?? 0);
    return { w: d, h: d };
  }
  const w = Math.max(0.5, b.rectWidth ?? 0);
  let h = Math.max(0.5, b.rectHeight ?? 0);
  if (shape === "arch") h += Math.max(0, b.archHeight ?? 0);
  const wTop = shape === "trap" ? Math.max(0, b.trapTopWidth ?? 0) : 0;
  return { w: Math.max(w, wTop), h };
}

// ── Текстуры значков ─────────────────────────────────────────────────────────
// Кэш общий на всё приложение: один и тот же значок стоит на схеме сотни раз,
// и готовить его картинку заново для каждого — впустую жечь память.
const texCache = new Map<string, THREE.Texture>();

/**
 * Готовит текстуру из SVG-содержимого значка.
 *
 * Картинка грузится браузером асинхронно, поэтому текстура возвращается сразу
 * (пустая), а когда изображение дойдёт — помечается на обновление и вызывается
 * onReady: режим «Модель» рисует по событию, и без этого сигнала значки
 * появились бы только после первого поворота схемы.
 */
function symbolTexture(
  svgContent: string,
  /** Окно холста. null — весь холст значка, как на чертеже. */
  crop: string | null,
  onReady: () => void,
): THREE.Texture {
  // Окно перегородки растягиваем на всё сечение (preserveAspectRatio="none"):
  // стенка обязана закрывать выработку целиком, её пропорции задаёт сечение, а
  // не рисунок. Целый же значок растягивать нельзя — круг вентилятора стал бы
  // эллипсом, а это уже не то обозначение; ему оставляем вписывание с полями.
  const viewBox = crop ?? "0 0 48 40";
  const par = crop ? "none" : "xMidYMid meet";
  // Отдельно стоящему знаку нужна подложка. На чертеже он лежит на белом листе
  // и его тонкий контур читается сам собой; в объёме за ним оказывается тело
  // выработки — тёмно-синее по расходу, красное по скорости, — и чёрный
  // контур вентилятора на нём пропадает. Перегородке подложка не нужна: у неё
  // своя заливка по материалу, и подкладывать под неё белое — значит закрасить
  // цвет, по которому материал и опознают.
  const backing = crop
    ? ""
    : `<rect x="0" y="0" width="48" height="40" rx="3" fill="rgba(255,255,255,0.88)"/>`;
  const key = `${viewBox}|${par}|${backing}|${svgContent}`;
  const cached = texCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Значок мелкий и часто виден под углом — без анизотропии и мипов он
  // рассыпается в шум. Мипы строит three сам, когда картинка доедет.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  texCache.set(key, tex);

  // viewBox по умолчанию тот же, что на чертеже (48×40): рисунок значка в
  // объёме и на бумаге обязан совпадать, иначе это уже другое обозначение.
  // У перегородок берётся окно по их блоку — см. cropViewBox.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TEX_SIZE}" height="${TEX_SIZE}" ` +
    `viewBox="${viewBox}" preserveAspectRatio="${par}">${backing}${svgContent}</svg>`;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const img = new Image(TEX_SIZE, TEX_SIZE);
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
      // Белая подложка под знаком: на тёмной выработке чёрный контур значка
      // иначе не читается. Скруглять не нужно — на чертеже подложка тоже
      // прямоугольная (см. drawSymbolsToCanvas).
      ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
    }
    tex.needsUpdate = true;
    URL.revokeObjectURL(url);
    onReady();
  };
  img.onerror = () => { URL.revokeObjectURL(url); };
  img.src = url;
  return tex;
}

export interface SymbolsInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  /** Условные обозначения со схемы — те же, что на чертеже. */
  symbols: SchemaSymbol[];
  xyScale: number;
  zScale: number;
  /**
   * Общий размер знаков, доля. 1 — знак размером с сечение выработки.
   *
   * Ручка нужна: на схеме рудника с полукилометровыми стволами и
   * двухметровыми сбойками единый размер устроить нельзя, и человек
   * подгоняет его под свою схему.
   */
  sizeK?: number;
  /** Картинка значка догрузилась — нужен новый кадр. */
  onReady?: () => void;
}

/** Готовый слой обозначений. */
export interface MineSymbols {
  group: THREE.Group;
  /**
   * Разворачивает знаки лицом к человеку. Вызывается перед отрисовкой, когда
   * камера могла повернуться.
   */
  updateFacing(cam: THREE.Camera): void;
  dispose(): void;
  /** Сколько обозначений попало в сцену — видно в счётчике внизу экрана. */
  count: number;
  /** Сколько вызовов отрисовки они добавили. */
  drawCalls: number;
}

/** Одна карточка, смотрящая на человека: положение и размер. */
interface Billboard {
  pos: THREE.Vector3;
  size: number;
}

/** Пакет знаков, смотрящих на человека. */
interface BillboardBatch {
  mesh: THREE.InstancedMesh;
  items: Billboard[];
}

/**
 * Строит слой обозначений.
 *
 * Возвращает null, если ставить нечего: на схеме нет УО либо ни один из них не
 * привязан к выработке с координатами.
 */
export function buildMineSymbols(input: SymbolsInput): MineSymbols | null {
  const { nodes, branches, symbols, xyScale, zScale } = input;
  if (!symbols || symbols.length === 0) return null;

  const kx = xyScale > 0 ? xyScale : 1;
  const kz = zScale > 0 ? zScale : 1;
  const sizeK = Math.max(0.2, Math.min(4, input.sizeK ?? 1));
  const onReady = input.onReady ?? (() => {});

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const branchById = new Map(branches.map(b => [b.id, b]));
  const legendById = new Map(LEGEND_TYPES.map(l => [l.id, l]));

  // Раскладка: на каждый значок — его картинка, способ постановки, положение,
  // размер и (для перегородок) оси сечения.
  interface Placed {
    svg: string;
    /** Окно холста значка (см. cropViewBox). null — весь холст. */
    crop: string | null;
    cross: boolean;
    pos: THREE.Vector3;
    /** Размер знака: для перегородки — ширина и высота сечения. */
    sx: number;
    sy: number;
    /** Направление выработки — нормаль перегородки. */
    dir: THREE.Vector3;
  }

  const placed: Placed[] = [];

  for (const sym of symbols) {
    if (placed.length >= MAX_SYMBOLS) break;
    // Свободные значки (без привязки к выработке) в объёме поставить некуда:
    // их экранные координаты к трёхмерной схеме отношения не имеют.
    if (!sym.branchId) continue;
    const b = branchById.get(sym.branchId);
    if (!b || b.isDead) continue;
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) continue;
    if (!isFinite(fn.x) || !isFinite(fn.y) || !isFinite(fn.z)) continue;
    if (!isFinite(tn.x) || !isFinite(tn.y) || !isFinite(tn.z)) continue;

    const lt = legendById.get(sym.typeId);
    if (!lt) continue;
    // Вентилятор рисуется по своему назначению: ГВУ и ВВУ — двойная окружность,
    // ВМП — пропеллер. Ровно та же развилка, что на чертеже.
    const svg = sym.typeId === "fan" ? fanSvgContent(b.fanType) : lt.svgContent;

    const a = toThree(fn.x * kx, fn.y * kx, fn.z * kz);
    const c = toThree(tn.x * kx, tn.y * kx, tn.z * kz);
    const dir = new THREE.Vector3().subVectors(c, a);
    const len = dir.length();
    if (!(len > 1e-6)) continue;
    dir.divideScalar(len);

    const t = Math.max(0, Math.min(1, sym.t ?? 0.5));
    const pos = new THREE.Vector3().lerpVectors(a, c, t);

    const dims = sectionDims(b);
    const sc = Math.max(0.1, Math.min(8, sym.scale ?? 1));
    const cross = isCrossSymbol(sym.typeId);

    if (cross) {
      // Перегородка вписывается в сечение с небольшим запасом: стенка должна
      // перекрывать выработку целиком, иначе издали кажется, что мимо
      // перемычки есть щель. Пользовательский масштаб значка (sym.scale) здесь
      // НЕ применяется: на чертеже он подгоняет картинку под толщину линии, а
      // в объёме размер задаёт само сечение — раздутая на треть перемычка
      // торчала бы сквозь стенки выработки.
      placed.push({
        svg, crop: cropViewBox(sym.typeId), cross: true, pos, dir,
        sx: dims.w * kx * 1.04,
        sy: dims.h * kx * 1.04,
      });
    } else {
      // Знак соразмерен выработке, но крупнее её сечения: иначе на стволе в
      // десяток метров вентилятор виден, а на сбойке — нет.
      const s = Math.max(dims.w, dims.h) * kx * 1.5 * sc * sizeK;
      placed.push({ svg, crop: null, cross: false, pos, dir, sx: s, sy: s });
    }
  }

  if (placed.length === 0) return null;

  const group = new THREE.Group();
  const geom = new THREE.PlaneGeometry(1, 1);
  const billboards: BillboardBatch[] = [];
  let drawCalls = 0;

  /** Материал карточки: своя текстура, отсечение по прозрачности. */
  const makeMaterial = (svg: string, crop: string | null): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      map: symbolTexture(svg, crop, onReady),
      // alphaTest вместо transparent: прозрачные поверхности приходится
      // сортировать, и знак то и дело оказывался бы позади «стеклянной»
      // выработки, в которой стоит. С отсечением он участвует в обычной
      // проверке глубины и всегда виден там, где должен быть.
      alphaTest: 0.5,
      transparent: false,
      // Карточка плоская, и с обратной стороны её видно так же часто, как с
      // лицевой: при облёте человек заходит за перемычку.
      side: THREE.DoubleSide,
      // Свет на знак не влияет: условное обозначение обязано выглядеть
      // одинаково на кровле и в забое, иначе его не опознать.
      toneMapped: false,
    });

  // ── Знаки поперёк сечения ───────────────────────────────────────────────
  // Группируем по картинке: одинаковых перемычек на схеме сотни, и каждая
  // отдельным вызовом отрисовки — та же беда, от которой ушли в геометрии.
  const crossGroups = new Map<string, Placed[]>();
  const billGroups = new Map<string, Placed[]>();
  for (const p of placed) {
    const map = p.cross ? crossGroups : billGroups;
    const key = `${p.crop ?? ""}|${p.svg}`;
    const arr = map.get(key);
    if (arr) arr.push(p); else map.set(key, [p]);
  }

  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();

  for (const [, list] of crossGroups) {
    const mesh = new THREE.InstancedMesh(geom, makeMaterial(list[0].svg, list[0].crop), list.length);
    mesh.frustumCulled = false;
    // Поверх тела выработки: знак стоит внутри неё, и в сплошном режиме
    // грань трубы то и дело оказывается на волос ближе к камере.
    mesh.renderOrder = 3;
    list.forEach((p, i) => {
      // Плоскость перегородки: нормаль — вдоль выработки, «вправо» —
      // горизонталь поперёк неё, «вверх» — то, что осталось. У вертикального
      // ствола «вверх» совпадает с осью, поэтому там за горизонталь берём
      // ось X сцены.
      zAxis.copy(p.dir);
      xAxis.crossVectors(up, zAxis);
      if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
      xAxis.normalize();
      yAxis.crossVectors(zAxis, xAxis).normalize();
      m.makeBasis(xAxis, yAxis, zAxis);
      m.scale(new THREE.Vector3(p.sx, p.sy, 1));
      m.setPosition(p.pos);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    drawCalls++;
  }

  // ── Знаки лицом к человеку ──────────────────────────────────────────────
  for (const [, list] of billGroups) {
    const mesh = new THREE.InstancedMesh(geom, makeMaterial(list[0].svg, list[0].crop), list.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    billboards.push({ mesh, items: list.map(p => ({ pos: p.pos, size: p.sx })) });
    drawCalls++;
  }

  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  let lastQuatKey = "";

  const updateFacing = (cam: THREE.Camera) => {
    if (billboards.length === 0) return;
    // Камера ортографическая: поворот у всех знаков один и тот же, считаем его
    // однажды за кадр. Если ракурс не менялся — не трогаем буферы вовсе,
    // иначе видеокарта перезаливала бы их на каждый кадр анимации стрелок.
    cam.getWorldQuaternion(q);
    const key = `${q.x.toFixed(5)},${q.y.toFixed(5)},${q.z.toFixed(5)},${q.w.toFixed(5)}`;
    if (key === lastQuatKey) return;
    lastQuatKey = key;

    for (const batch of billboards) {
      batch.items.forEach((it, i) => {
        scl.set(it.size, it.size, 1);
        m.compose(it.pos, q, scl);
        batch.mesh.setMatrixAt(i, m);
      });
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const dispose = () => {
    group.traverse(obj => {
      const mesh = obj as THREE.InstancedMesh;
      const mat = mesh.material as THREE.Material | undefined;
      // Геометрия у всех пакетов ОДНА (plane), освобождаем её отдельно, ниже.
      // Текстуры живут в общем кэше и переживают пересборку схемы: готовить
      // их заново при каждом изменении расхода незачем.
      if (mat) mat.dispose();
    });
    group.clear();
    geom.dispose();
  };

  return { group, updateFacing, dispose, count: placed.length, drawCalls };
}