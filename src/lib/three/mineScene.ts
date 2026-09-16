// ─────────────────────────────────────────────────────────────────────────────
// mineScene.ts — построение 3D-сцены рудника на three.js (режим «Модель»).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ РЕЖИМ, А НЕ ЗАМЕНА ЧЕРТЕЖА.
// Режим «Чертёж» (Canvas 2D) остаётся основным: он векторный, печатается,
// выгружается в SVG и несёт слой печати с рамкой и штампом. Из WebGL вектор
// снять нельзя — оттуда снимается только растр, поэтому подменять им чертёж
// нельзя. Зато объём, вращение и облёт на Canvas 2D упираются в процессор:
// каждая грань там — отдельная команда растеризатору, и на 14 000 выработок
// кадр уходит за сотню миллисекунд.
//
// Здесь другой подход: вся геометрия грузится в видеопамять ОДИН раз, а
// выработки одного типа сечения рисуются пакетом через InstancedMesh. Вместо
// сотни тысяч команд — единицы вызовов отрисовки, и число выработок почти
// перестаёт влиять на скорость.
//
// ─────────────────────────────────────────────────────────────────────────────
// ОТКУДА БЕРЁТСЯ ГЕОМЕТРИЯ
//
// Контур сечения — из того же sectionOutline(), которым рисует режим «Чертёж».
// Это принципиально: объём строится по тем же числам (ширина, высота, свод,
// диаметр), по которым считается вентиляция. Никаких отдельных «графических»
// размеров нет, и картинка не может разойтись с расчётом.
//
// СИСТЕМА КООРДИНАТ. В three.js вверх — ось Y, у нас в горном деле вверх —
// ось Z (z=0 поверхность, z<0 глубина). Поэтому при переносе меняем оси:
//   three.x = мир.x     three.y = мир.z     three.z = −мир.y
// Знак у Y сохраняет правую тройку, иначе схема окажется зеркальной.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { sectionOutline } from "@/lib/tube3d";

/**
 * Порог, выше которого контурные рёбра не строятся.
 *
 * Каркас — это дополнительный буфер вершин на каждую выработку. До нескольких
 * тысяч выработок он бесплатен по скорости (вызовов отрисовки столько же), но
 * на схеме в десятки тысяч выработка занимает считаные пиксели: рёбра сливаются
 * в сплошную сетку, пользы от них нет, а видеопамяти уходит вдвое.
 */
const EDGE_LIMIT = 6000;

/** Мир → three.js: у нас вверх Z, у three — Y. */
export function toThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

/** Что нужно сцене от схемы. */
export interface SceneInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  /** Масштаб плана — тот же, что в режиме «Чертёж». */
  xyScale: number;
  /** Масштаб по вертикали. */
  zScale: number;
  /** Цвет выработки: id → hex. Считается снаружи, чтобы окраска совпадала с чертежом. */
  colorOf: (b: TopoBranch) => string;
  /**
   * Непрозрачность тела выработки, 0.08…1.
   *
   * Единица — привычный сплошной объём. Меньше единицы — «стеклянный» режим,
   * как просмотр 3D-модели в CAD: сквозь ближние выработки видны дальние, и
   * схема перестаёт быть сплошным пятном, в котором ничего не разобрать.
   *
   * Нижний предел опущен с 0.15 до 0.08 ради режима «Каркас»: там тело —
   * только лёгкая подсказка об объёме, а структуру держат контурные рёбра.
   */
  opacity?: number;
  /**
   * Рисовать ли контурные рёбра сечения.
   *
   * Без них форма выработки читается только по светотени, а на однотонной
   * заливке соседние выработки сливаются в одно тело. Рёбра — это ровно то,
   * чем CAD отделяет объект от объекта.
   */
  edges?: boolean;
}

/** Результат сборки — меши и служебные карты для выделения. */
export interface BuiltScene {
  /** Корневая группа: всё содержимое схемы. */
  root: THREE.Group;
  /** Порядковый номер экземпляра → id выработки (для выбора мышью). */
  instanceToBranch: Map<THREE.InstancedMesh, string[]>;
  /**
   * Выработки в порядке экземпляров каждого меша. Нужны, чтобы перекрасить
   * схему, не собирая геометрию заново: смена режима заливки меняет только
   * цвет, а форма и положение выработок остаются прежними.
   */
  instanceBranches: Map<THREE.InstancedMesh, TopoBranch[]>;
  /**
   * Каркас сечения для каждой пакетной заливки.
   *
   * Нужен, чтобы перекрасить контур вместе с телом: рёбра лежат в общем буфере
   * группы, и цвет i-й выработки занимает в нём vertsPerBranch вершин подряд.
   */
  edgeOf: Map<THREE.InstancedMesh, { lines: THREE.LineSegments; vertsPerBranch: number }>;
  /** Габаритная сфера — по ней выставляется камера. */
  bounds: THREE.Sphere;
  /** Сколько выработок попало в сцену. */
  branchCount: number;
  /** Сколько вызовов отрисовки получилось (главный показатель скорости). */
  drawCalls: number;
}

/**
 * Ключ формы сечения. Выработки с одинаковым ключом рисуются одним
 * InstancedMesh — это и даёт выигрыш по скорости.
 *
 * Размеры округляем до 10 см: разница в сантиметрах на экране не видна, а без
 * округления почти каждая выработка получала бы собственный меш, и смысл
 * пакетной отрисовки терялся.
 */
function shapeKey(b: TopoBranch): string {
  const r = (v: number) => Math.round((v ?? 0) * 10) / 10;
  const s = b.shape ?? "rect";
  if (s === "round") return `round:${r(b.diameter ?? 0)}`;
  if (s === "trap") return `trap:${r(b.rectWidth)}:${r(b.rectHeight)}:${r(b.trapTopWidth ?? 0)}`;
  if (s === "arch") return `arch:${r(b.rectWidth)}:${r(b.rectHeight)}:${r(b.archHeight ?? 0)}`;
  return `rect:${r(b.rectWidth)}:${r(b.rectHeight)}`;
}

/**
 * Профиль выработки, вытянутый вдоль оси X на единичную длину.
 *
 * Строим вручную, а не через ExtrudeGeometry: нам нужна ровно боковая
 * поверхность с торцами и корректными нормалями, а Extrude добавляет скос
 * кромок и лишние вершины.
 *
 * Единичная длина позволяет растянуть один и тот же меш на любую выработку
 * матрицей экземпляра — именно так работает InstancedMesh.
 */
function buildProfileGeometry(b: TopoBranch): THREE.BufferGeometry {
  const outline = sectionOutline(b);
  const n = outline.length;

  const pos: number[] = [];
  const nor: number[] = [];

  // Боковая поверхность: на каждое ребро контура — два треугольника.
  for (let i = 0; i < n; i++) {
    const p0 = outline[i];
    const p1 = outline[(i + 1) % n];

    // Нормаль ребра наружу: поворот направления ребра на 90°.
    const er = p1.r - p0.r, eu = p1.u - p0.u;
    const el = Math.hypot(er, eu) || 1;
    const nr = eu / el, nu = -er / el;

    // Четыре угла полосы: x=0 — начало выработки, x=1 — конец.
    const a0 = [0, p0.u, p0.r], a1 = [0, p1.u, p1.r];
    const b0 = [1, p0.u, p0.r], b1 = [1, p1.u, p1.r];

    // Два треугольника: a0-b0-b1 и a0-b1-a1
    pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
    for (let k = 0; k < 6; k++) nor.push(0, nu, nr);
  }

  // Торцы — веером от центра контура. Без них выработка выглядит открытым
  // рукавом: на повороте и в тупике сквозь неё видно то, что позади.
  for (let i = 1; i < n - 1; i++) {
    const c = outline[0], p = outline[i], q = outline[i + 1];
    // Начало (нормаль против оси)
    pos.push(0, c.u, c.r, 0, q.u, q.r, 0, p.u, p.r);
    for (let k = 0; k < 3; k++) nor.push(-1, 0, 0);
    // Конец (нормаль по оси)
    pos.push(1, c.u, c.r, 1, p.u, p.r, 1, q.u, q.r);
    for (let k = 0; k < 3; k++) nor.push(1, 0, 0);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/**
 * Каркас того же профиля: рёбра сечения на обоих торцах плюс продольные рёбра
 * вдоль выработки.
 *
 * ЗАЧЕМ. Заливка сама по себе форму не показывает: две выработки одного цвета,
 * идущие рядом, выглядят одним телом, а сводчатое сечение неотличимо от
 * прямоугольного. Контур — то, по чему CAD даёт понять, где кончается один
 * объект и начинается другой; в полупрозрачном режиме он вообще единственное,
 * что держит форму.
 *
 * Геометрия строится в тех же единичных координатах, что и тело (профиль вдоль
 * оси X на длину 1), поэтому к линиям подходит ТА ЖЕ матрица экземпляра —
 * каркас не может разъехаться с заливкой.
 *
 * У круглого сечения продольные рёбра берём не все: 12 линий вдоль ствола
 * превращают его в решётку. Достаточно четырёх — они и дают ощущение трубы.
 */
function buildProfileEdges(b: TopoBranch): THREE.BufferGeometry {
  const outline = sectionOutline(b);
  const n = outline.length;
  const round = (b.shape ?? "rect") === "round";
  const pos: number[] = [];

  for (let i = 0; i < n; i++) {
    const p0 = outline[i];
    const p1 = outline[(i + 1) % n];
    // Контур сечения на обоих торцах.
    pos.push(0, p0.u, p0.r, 0, p1.u, p1.r);
    pos.push(1, p0.u, p0.r, 1, p1.u, p1.r);
    // Продольное ребро. У круга — только каждое третье, иначе получается сетка.
    if (!round || i % 3 === 0) pos.push(0, p0.u, p0.r, 1, p0.u, p0.r);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/**
 * Матрица экземпляра: растягивает единичный профиль на конкретную выработку.
 *
 * Профиль лежит вдоль оси X, поэтому матрица должна повернуть ось X на
 * направление выработки, растянуть по длине и поставить в начальную точку.
 */
function branchMatrix(
  from: THREE.Vector3,
  to: THREE.Vector3,
  sectionScale: number,
): THREE.Matrix4 {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (!(len > 1e-6)) return new THREE.Matrix4().makeScale(0, 0, 0);
  dir.normalize();

  // Поворот, переводящий +X в направление выработки.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);

  return new THREE.Matrix4().compose(
    from,
    q,
    // По оси выработки — её длина, поперёк — масштаб сечения.
    new THREE.Vector3(len, sectionScale, sectionScale),
  );
}

/**
 * Собирает сцену: выработки, узлы, освещение, сетка.
 *
 * Выработки группируются по форме сечения; каждая группа — один InstancedMesh.
 * На реальной схеме форм обычно десяток-другой, поэтому вместо тысяч вызовов
 * отрисовки получается несколько десятков.
 */
export function buildMineScene(input: SceneInput): BuiltScene {
  const { nodes, branches, xyScale, zScale, colorOf } = input;
  // Ниже 0.08 тело выработки пропадает совсем — остаётся голый каркас, по
  // которому уже не понять, где выработка толстая, а где тонкая. Выше 1
  // непрозрачность бессмысленна.
  const opacity = Math.max(0.08, Math.min(1, input.opacity ?? 1));
  const glass = opacity < 0.995;
  const wantEdges = input.edges !== false;
  const root = new THREE.Group();
  const instanceToBranch = new Map<THREE.InstancedMesh, string[]>();
  const instanceBranches = new Map<THREE.InstancedMesh, TopoBranch[]>();
  const edgeOf = new Map<THREE.InstancedMesh, { lines: THREE.LineSegments; vertsPerBranch: number }>();

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const kx = xyScale > 0 ? xyScale : 1;
  const kz = zScale > 0 ? zScale : 1;

  // ── Группировка выработок по форме сечения ────────────────────────────
  const groups = new Map<string, TopoBranch[]>();
  for (const b of branches) {
    if (b.isDead) continue;
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) continue;
    // Узел без нормальных координат отбрасываем целиком.
    //
    // Одной такой выработки достаточно, чтобы габарит схемы стал нечислом, а
    // за ним — и весь расчёт камеры. Видеокарта в этом случае не рисует
    // НИЧЕГО: рабочая область остаётся пустой, хотя выработок тысячи. На
    // больших схемах, собранных импортом из разных источников, такие узлы
    // попадаются, и терять из-за одного всю картину нельзя.
    if (!isFinite(fn.x) || !isFinite(fn.y) || !isFinite(fn.z)) continue;
    if (!isFinite(tn.x) || !isFinite(tn.y) || !isFinite(tn.z)) continue;
    const k = shapeKey(b);
    let arr = groups.get(k);
    if (!arr) { arr = []; groups.set(k, arr); }
    arr.push(b);
  }

  const box = new THREE.Box3();
  let branchCount = 0;
  let drawCalls = 0;

  const tmpColor = new THREE.Color();

  for (const [, list] of groups) {
    if (list.length === 0) continue;

    const geom = buildProfileGeometry(list[0]);
    // Материал один на группу: цвет каждой выработки задаётся через
    // setColorAt (instanceColor), а не отдельным материалом — иначе пакетная
    // отрисовка распалась бы обратно на отдельные вызовы.
    //
    // vertexColors здесь НЕ ставим, хотя напрашивается. Этот флаг включает в
    // шейдере `vColor *= color`, где color — атрибут ВЕРШИН геометрии. Такого
    // атрибута у нас нет (профиль несёт только position и normal), поэтому
    // color приходит нулевым, и вся схема умножается на ноль — получается
    // ровно тот чёрный силуэт, который и был виден. Цвет экземпляра
    // подхватывается сам: three.js видит instanceColor у InstancedMesh и
    // включает USE_INSTANCING_COLOR независимо от vertexColors.
    //
    // Lambert заменён на Phong с лёгким бликом: у Lambert грань, отвёрнутая от
    // света, отличается от освещённой только яркостью, и на плоской заливке
    // рёбра сечения почти не видны. Слабый блик подчёркивает перелом граней —
    // становится видно, где кровля, где бок, где свод.
    const mat = new THREE.MeshPhongMaterial({
      shininess: 18,
      specular: 0x2a2f38,
      // Обе стороны: в «стеклянном» режиме сквозь ближнюю стенку видна
      // внутренняя поверхность дальней, и без DoubleSide выработка выглядела
      // бы рассечённой.
      side: glass ? THREE.DoubleSide : THREE.FrontSide,
      transparent: glass,
      opacity,
      // Прозрачное тело в буфер глубины не пишем: иначе выработка, нарисованная
      // первой, закрывала бы собой всё, что за ней, и «просвечивание» не
      // работало бы вовсе — получилось бы мутное стекло вместо CAD-режима.
      depthWrite: !glass,
    });
    const mesh = new THREE.InstancedMesh(geom, mat, list.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    // Прозрачные тела рисуются после непрозрачных — иначе смешивание цветов
    // зависит от случайного порядка в сцене.
    if (glass) mesh.renderOrder = 1;

    const ids: string[] = [];
    let idx = 0;
    for (const b of list) {
      const fn = nodeById.get(b.fromId)!;
      const tn = nodeById.get(b.toId)!;
      const a = toThree(fn.x * kx, fn.y * kx, fn.z * kz);
      const c = toThree(tn.x * kx, tn.y * kx, tn.z * kz);

      // Сечение масштабируется по плану — тем же множителем по всем осям,
      // иначе круглый ствол превратился бы в эллипс при «Масштаб Z ×14».
      mesh.setMatrixAt(idx, branchMatrix(a, c, kx));
      tmpColor.set(colorOf(b));
      mesh.setColorAt(idx, tmpColor);
      ids.push(b.id);
      box.expandByPoint(a);
      box.expandByPoint(c);
      idx++;
      branchCount++;
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;   // выработки тянутся через всю сцену
    root.add(mesh);
    instanceToBranch.set(mesh, ids);
    instanceBranches.set(mesh, list);
    drawCalls++;

    // ── Каркас сечения ──────────────────────────────────────────────────
    // Линии инстансинг в three.js не поддерживают, поэтому рёбра всей группы
    // сводим в ОДИН буфер: матрицу экземпляра применяем к точкам здесь, на
    // сборке. Получается по одному вызову отрисовки на группу — столько же,
    // сколько у заливки, и число выработок по-прежнему почти не влияет на
    // скорость.
    //
    // На очень больших схемах каркас отключаем: там выработка занимает
    // считаные пиксели, рёбра сливаются в сплошную сетку и только мешают, а
    // памяти под них уходит вдвое против заливки.
    if (wantEdges && list.length > 0 && branches.length <= EDGE_LIMIT) {
      const proto = buildProfileEdges(list[0]);
      const src = proto.getAttribute("position") as THREE.BufferAttribute;
      const cnt = src.count;
      const dst = new Float32Array(cnt * 3 * list.length);
      const col = new Float32Array(cnt * 3 * list.length);
      const v = new THREE.Vector3();
      const m = new THREE.Matrix4();
      let o = 0;

      for (let i = 0; i < list.length; i++) {
        mesh.getMatrixAt(i, m);
        // Ребро темнее заливки — так контур читается на своей же выработке,
        // а не спорит с ней по яркости.
        tmpColor.set(colorOf(list[i])).multiplyScalar(0.45);
        for (let k = 0; k < cnt; k++) {
          v.fromBufferAttribute(src, k).applyMatrix4(m);
          dst[o] = v.x; dst[o + 1] = v.y; dst[o + 2] = v.z;
          col[o] = tmpColor.r; col[o + 1] = tmpColor.g; col[o + 2] = tmpColor.b;
          o += 3;
        }
      }
      proto.dispose();

      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.BufferAttribute(dst, 3));
      eg.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const em = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        // В стеклянном режиме контур — главное, что держит форму, поэтому он
        // заметно плотнее тела. В сплошном хватает лёгкой обводки.
        opacity: glass ? 0.85 : 0.5,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(eg, em);
      lines.frustumCulled = false;
      lines.renderOrder = 2;   // поверх заливки, но под подсветкой выбора
      root.add(lines);
      // Запоминаем связь «заливка → её каркас»: при смене режима окраски
      // контур должен перекраситься вместе с телом, иначе рёбра остались бы
      // от прежней раскраски и спорили бы с новой.
      edgeOf.set(mesh, { lines, vertsPerBranch: cnt });
      drawCalls++;
    }
  }

  // ── Освещение ─────────────────────────────────────────────────────────
  // Два источника: направленный сверху-сбоку даёт объём, рассеянный не даёт
  // теневой стороне почернеть. Тени не считаем — на схеме в тысячи выработок
  // они стоят дорого и мешают читать геометрию.
  //
  // Яркости подобраны так, чтобы СУММА в самой освещённой точке была около
  // единицы (0.75 + 0.55·cos). Прежние 1.6 и 1.1 в сумме давали 2.7 — всё
  // светлое выбивалось в белое пятно, а разница между выработками пропадала.
  //
  // РАЗВЕС СМЕЩЁН В СТОРОНУ НАПРАВЛЕННОГО СВЕТА. Было 0.75 рассеянного против
  // 0.55 направленного: рассеянный светит одинаково во все стороны, поэтому
  // кровля и бок выработки отличались меньше чем на треть яркости — сечение
  // выглядело плоской лентой, что и видно на снимке. Теперь наоборот, и грани
  // расходятся по яркости вдвое: форма сечения читается без выделения.
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(-0.4, 0.9, 0.5);
  root.add(dir);
  // Второй направленный, с другой стороны и слабее — подсветка-заполнение.
  // Без неё грань, отвёрнутая от главного источника, проваливается в ровный
  // тёмный тон и теряет форму так же, как раньше теряла её на свету.
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(0.7, 0.2, -0.5);
  root.add(fill);
  root.add(new THREE.AmbientLight(0xffffff, 0.42));

  // Габарит — основа всего расчёта камеры, поэтому он обязан быть числом.
  // Пустая схема, единственный узел или уцелевшее нечисло дают нулевой либо
  // некорректный радиус; дальше он расходится по zoom и границам отсечения, и
  // на экране не остаётся ничего. Подстраховываемся разумным значением.
  const bounds = new THREE.Sphere();
  if (!box.isEmpty()) box.getBoundingSphere(bounds);
  if (!isFinite(bounds.radius) || bounds.radius <= 0) {
    bounds.center.set(0, 0, 0);
    bounds.radius = 100;
  }
  if (!isFinite(bounds.center.x) || !isFinite(bounds.center.y) || !isFinite(bounds.center.z)) {
    bounds.center.set(0, 0, 0);
  }

  return { root, instanceToBranch, instanceBranches, edgeOf, bounds, branchCount, drawCalls };
}

/**
 * Перекрашивает уже собранную сцену, не трогая геометрию.
 *
 * Смена режима заливки (расход, скорость, участки, горизонты) меняет только
 * цвет выработок — форма, длина и положение остаются теми же. Пересобирать
 * ради этого всю сцену незачем: это секунды на большой схеме и, главное,
 * сброс ракурса. Здесь переписывается только буфер цветов.
 */
export function recolorScene(built: BuiltScene | null, colorOf: (b: TopoBranch) => string): boolean {
  if (!built) return false;
  const tmp = new THREE.Color();
  let changed = false;

  for (const [mesh, list] of built.instanceBranches) {
    // Прошлые цвета помним на самом меше. Функция цвета приходит новой почти
    // на каждую перерисовку страницы, хотя сам цвет обычно тот же — без этой
    // проверки мы бы гоняли буфер в видеопамять впустую по десятку раз в
    // секунду. На схеме в тысячи выработок это заметно.
    const holder = mesh as THREE.InstancedMesh & { __lastColors?: string[] };
    const prev = holder.__lastColors;
    const next: string[] = prev ?? new Array<string>(list.length);

    // Каркас лежит в общем буфере группы: цвет i-й выработки занимает в нём
    // vertsPerBranch вершин подряд, начиная с i·vertsPerBranch.
    const edge = built.edgeOf.get(mesh);
    const eCol = edge
      ? (edge.lines.geometry.getAttribute("color") as THREE.BufferAttribute)
      : null;
    let edgeChanged = false;

    for (let i = 0; i < list.length; i++) {
      const col = colorOf(list[i]);
      if (prev && prev[i] === col) continue;
      next[i] = col;
      tmp.set(col);
      mesh.setColorAt(i, tmp);

      if (eCol && edge) {
        // Ребро темнее заливки — тот же коэффициент, что и при сборке.
        tmp.multiplyScalar(0.45);
        const base = i * edge.vertsPerBranch;
        for (let k = 0; k < edge.vertsPerBranch; k++) {
          eCol.setXYZ(base + k, tmp.r, tmp.g, tmp.b);
        }
        edgeChanged = true;
      }
      changed = true;
    }

    holder.__lastColors = next;
    if (changed && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (edgeChanged && eCol) eCol.needsUpdate = true;
  }
  return changed;
}

// ─────────────────────────────────────────────────────────────────────────────
// ВЫБОР ВЫРАБОТКИ МЫШЬЮ
//
// Выработки нарисованы пакетом (InstancedMesh), отдельных объектов под каждую
// в сцене нет — значит и «кликнуть по объекту» напрямую нельзя. Зато луч,
// пущенный из точки экрана, three.js умеет проверять по экземплярам и
// возвращает instanceId. Порядковый номер экземпляра мы при сборке сохранили в
// instanceBranches, отсюда и получается сама выработка.
//
// Луч бьёт по ВСЕМ мешам сразу, поэтому ближайшее пересечение и есть та
// выработка, которую человек видит под курсором — в том числе если перед ней
// проходит другая: выбирается передняя, как и ожидается в CAD.
// ─────────────────────────────────────────────────────────────────────────────

/** Что нашлось под курсором. */
export interface PickResult {
  branch: TopoBranch;
  /** Точка попадания в координатах сцены — по ней ставится подпись. */
  point: THREE.Vector3;
}

/**
 * Ищет выработку под лучом.
 *
 * Луч должен быть уже настроен снаружи (setFromCamera): здесь нет ни камеры,
 * ни размеров холста — сцена о них ничего не знает.
 */
export function pickBranch(built: BuiltScene | null, ray: THREE.Raycaster): PickResult | null {
  if (!built) return null;

  const meshes: THREE.InstancedMesh[] = [];
  for (const [mesh] of built.instanceBranches) meshes.push(mesh);
  if (meshes.length === 0) return null;

  // recursive=false: подсветка и источники света в проверку попадать не должны.
  const hits = ray.intersectObjects(meshes, false);
  for (const h of hits) {
    const mesh = h.object as THREE.InstancedMesh;
    const list = built.instanceBranches.get(mesh);
    if (!list) continue;
    const i = h.instanceId;
    if (i === undefined || i === null) continue;
    const branch = list[i];
    if (!branch) continue;
    return { branch, point: h.point.clone() };
  }
  return null;
}

/** Хранилище подсветки: висит на самой сцене, чтобы не плодить состояние. */
interface HighlightHolder {
  __hl?: {
    select: THREE.Mesh | null;
    hover: THREE.Mesh | null;
    selectId: string | null;
    hoverId: string | null;
  };
}

/** Цвета подсветки: выбранная — оранжевая (как в чертеже), под курсором — голубая. */
const HL_COLORS = { select: 0xff7a00, hover: 0x2ea8ff };

/**
 * Строит «рубашку» вокруг выработки: тот же профиль, раздутый поперёк.
 *
 * Геометрия берётся ТА ЖЕ, что у пакетного меша (не копия) — это бесплатно по
 * памяти, но значит, что освобождать её вместе с подсветкой нельзя: она ещё
 * нужна самой схеме. Поэтому при снятии подсветки мы удаляем только материал.
 */
function makeHighlightMesh(
  built: BuiltScene,
  id: string,
  kind: "select" | "hover",
): THREE.Mesh | null {
  for (const [mesh, list] of built.instanceBranches) {
    const idx = list.findIndex(b => b.id === id);
    if (idx < 0) continue;

    const m = new THREE.Matrix4();
    mesh.getMatrixAt(idx, m);
    // Раздуваем только сечение (локальные оси Y и Z), длину оставляем: иначе
    // подсветка вылезала бы за узлы и заходила в соседние выработки.
    const grow = kind === "select" ? 1.35 : 1.2;
    m.multiply(new THREE.Matrix4().makeScale(1, grow, grow));

    const mat = new THREE.MeshBasicMaterial({
      color: HL_COLORS[kind],
      transparent: true,
      opacity: kind === "select" ? 0.45 : 0.3,
      // Глубину не проверяем: выбранная выработка должна быть видна, даже если
      // она за другими. Так же ведёт себя выделение в объёмных вьюверах — иначе
      // человек щёлкнул по списку, а на экране ничего не изменилось.
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const hl = new THREE.Mesh(mesh.geometry, mat);
    hl.applyMatrix4(m);
    hl.matrixAutoUpdate = false;
    hl.frustumCulled = false;
    hl.renderOrder = kind === "select" ? 1000 : 999;

    // Обводка по рёбрам рубашки. Полупрозрачная заливка сама по себе даёт лишь
    // мутное пятно — на схеме, где тело выработки тоже прозрачное, по нему
    // невозможно понять, ГДЕ именно кончается выделенная выработка. Сплошная
    // линия по контуру решает это так же, как обводка выбора в CAD.
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 25),
      new THREE.LineBasicMaterial({
        color: HL_COLORS[kind],
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
      }),
    );
    // Рубашка уже стоит на месте выработки, поэтому обводке хватает единичной
    // матрицы относительно неё.
    wire.renderOrder = hl.renderOrder + 1;
    wire.frustumCulled = false;
    hl.add(wire);
    return hl;
  }
  return null;
}

/** Убирает подсветку со сцены. Геометрия общая со схемой — её не трогаем. */
function dropHighlight(root: THREE.Group, mesh: THREE.Mesh | null) {
  if (!mesh) return;
  root.remove(mesh);
  const mat = mesh.material as THREE.Material;
  mat.dispose();
  // Обводка — в отличие от рубашки — несёт СВОЮ геометрию (EdgesGeometry
  // строится заново на каждое выделение). Её нужно освобождать здесь: выбор
  // выработки происходит десятки раз за сеанс, и без этого видеопамять течёт
  // на каждый щелчок.
  for (const child of mesh.children) {
    const l = child as THREE.LineSegments;
    l.geometry?.dispose();
    (l.material as THREE.Material)?.dispose();
  }
  mesh.clear();
}

/**
 * Показывает подсветку выбранной выработки и той, что под курсором.
 *
 * Возвращает true, если картинка изменилась — вызывающая сторона по этому
 * признаку решает, просить ли новый кадр. Без проверки схема перерисовывалась
 * бы на каждое движение мыши, даже когда под курсором пусто.
 */
export function setHighlight(
  built: BuiltScene | null,
  selectId: string | null,
  hoverId: string | null,
): boolean {
  if (!built) return false;
  const holder = built.root as unknown as THREE.Group & HighlightHolder;
  const st = holder.__hl ?? (holder.__hl = { select: null, hover: null, selectId: null, hoverId: null });

  // Под курсором и так выбранная выработка — второй раз подсвечивать незачем.
  const hov = hoverId && hoverId !== selectId ? hoverId : null;
  if (st.selectId === selectId && st.hoverId === hov) return false;

  if (st.selectId !== selectId) {
    dropHighlight(built.root, st.select);
    st.select = selectId ? makeHighlightMesh(built, selectId, "select") : null;
    if (st.select) built.root.add(st.select);
    st.selectId = selectId;
  }
  if (st.hoverId !== hov) {
    dropHighlight(built.root, st.hover);
    st.hover = hov ? makeHighlightMesh(built, hov, "hover") : null;
    if (st.hover) built.root.add(st.hover);
    st.hoverId = hov;
  }
  return true;
}

/** Освобождает видеопамять сцены. Без этого при пересборке будет утечка. */
export function disposeScene(built: BuiltScene | null) {
  if (!built) return;
  built.root.traverse(obj => {
    const m = obj as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => x.dispose());
    else if (mat) mat.dispose();
  });
  built.root.clear();
}