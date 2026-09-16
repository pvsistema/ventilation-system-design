// ─────────────────────────────────────────────────────────────────────────────
// mineArrows.ts — СТРЕЛКИ НАПРАВЛЕНИЯ ВОЗДУХА В РЕЖИМЕ «МОДЕЛЬ».
//
// Направление движения воздуха — главное, что читают на вентиляционной схеме:
// по нему видно, куда пойдёт дым при пожаре и откуда придёт свежая струя.
// В расчёте оно уже есть (знак расхода), но до сих пор показывалось только на
// чертеже — в объёме выработки выглядели одинаково в обе стороны.
//
// ПОЧЕМУ СТРЕЛКА — «МУФТА» ВОКРУГ ВЫРАБОТКИ, А НЕ ВНУТРИ НЕЁ.
// Выработка в объёме — сплошная непрозрачная труба. Стрелка, положенная по её
// оси, оказалась бы внутри и была бы не видна вообще. Обойти это отключением
// проверки глубины нельзя: тогда стрелки всплывут поверх всей схемы, и стрелки
// с дальнего горизонта будут висеть перед ближними выработками — направление
// станет читаться неверно, а это уже ошибка в документе.
//
// Поэтому стрелка надета НА выработку: конус чуть шире её сечения, остриём в
// сторону движения воздуха. Он виден снаружи, честно перекрывается тем, что
// стоит ближе к человеку, и не мешает видеть саму выработку.
//
// Как и геометрия схемы, все стрелки рисуются одним пакетом (InstancedMesh):
// на схеме в тысячи выработок отдельные объекты съели бы весь выигрыш.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { toThree } from "./mineScene";

/**
 * Ниже этого расхода стрелку не ставим.
 *
 * Тот же порог, что на чертеже: около нуля знак расхода — это уже не
 * направление, а погрешность расчёта, и показывать по нему стрелку нельзя.
 */
const MIN_FLOW = 0.1;

/** Цвет стрелок — тот же красный, что и на чертеже. */
const ARROW_COLOR = 0xdc2626;

/** Граней в конусе. Двенадцати хватает: стрелка мелкая, ребра на ней не видны. */
const CONE_FACETS = 12;

export interface ArrowsInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  xyScale: number;
  zScale: number;
}

/**
 * Единичный конус остриём вдоль +X.
 *
 * ConeGeometry в three смотрит вдоль оси Y, поэтому сразу разворачиваем её:
 * дальше матрица экземпляра работает так же, как у выработок, — переводит +X в
 * направление потока.
 *
 * Донышко (openEnded = false) оставляем: без него сквозь стрелку видно
 * внутренность конуса, и на светлой схеме она выглядит дырой.
 */
function makeConeGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 1, CONE_FACETS, 1, false);
  // Остриё ConeGeometry в +Y, центр в середине высоты. Сдвигаем так, чтобы
  // основание было в нуле, затем кладём на ось X.
  g.translate(0, 0.5, 0);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** Поперечный размер выработки, м — по нему подбирается размер стрелки. */
function sectionRadius(b: TopoBranch): number {
  if ((b.shape ?? "rect") === "round") return Math.max(0.5, (b.diameter ?? 0) / 2);
  const w = Math.max(0.5, b.rectWidth ?? 0);
  const h = Math.max(0.5, b.rectHeight ?? 0);
  return Math.max(w, h) / 2;
}

/**
 * Строит пакет стрелок потока.
 *
 * Возвращает null, если ставить нечего: схема не рассчитана или воздух никуда
 * не идёт. Вызывающая сторона в этом случае просто ничего не добавляет в сцену.
 */
export function buildFlowArrows(input: ArrowsInput): THREE.InstancedMesh | null {
  const { nodes, branches, xyScale, zScale } = input;
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const kx = xyScale > 0 ? xyScale : 1;
  const kz = zScale > 0 ? zScale : 1;

  // Сначала отбираем выработки со значимым расходом: размер пакета в
  // InstancedMesh задаётся заранее и потом не меняется.
  const list: TopoBranch[] = [];
  for (const b of branches) {
    if (b.isDead) continue;
    if (Math.abs(b.flow ?? 0) < MIN_FLOW) continue;
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) continue;
    if (!isFinite(fn.x) || !isFinite(fn.y) || !isFinite(fn.z)) continue;
    if (!isFinite(tn.x) || !isFinite(tn.y) || !isFinite(tn.z)) continue;
    list.push(b);
  }
  if (list.length === 0) return null;

  const geom = makeConeGeometry();
  const mat = new THREE.MeshLambertMaterial({
    color: ARROW_COLOR,
    // Конус надет на выработку, и изнутри его стенка тоже попадает в кадр —
    // без DoubleSide стрелка при взгляде «в хвост» выглядит рассечённой.
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geom, mat, list.length);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = false;
  // Рисуем после выработок: при равной глубине (стрелка вплотную к трубе)
  // побеждает то, что нарисовано позже, иначе стрелка местами исчезала бы
  // в поверхности выработки.
  mesh.renderOrder = 5;

  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const axisX = new THREE.Vector3(1, 0, 0);
  const q = new THREE.Quaternion();
  const base = new THREE.Vector3();
  const m = new THREE.Matrix4();

  let idx = 0;
  for (const b of list) {
    const fn = nodeById.get(b.fromId)!;
    const tn = nodeById.get(b.toId)!;

    // Направление стрелки — по воздуху, а не по тому, как выработку начертили.
    // Отрицательный расход означает движение против направления выработки; у
    // вентилятора в реверсе знак может не смениться, поэтому он учитывается
    // отдельно — ровно так же, как на чертеже.
    const fanReverseOverride = b.hasFan && (b.fanReverse ?? false) && (b.flow ?? 0) >= 0;
    const reversed = (b.flow ?? 0) < 0 || fanReverseOverride;
    const a = reversed ? tn : fn;
    const c = reversed ? fn : tn;

    from.copy(toThree(a.x * kx, a.y * kx, a.z * kz));
    to.copy(toThree(c.x * kx, c.y * kx, c.z * kz));
    dir.subVectors(to, from);
    const len = dir.length();
    if (!(len > 1e-6)) { m.makeScale(0, 0, 0); mesh.setMatrixAt(idx++, m); continue; }
    dir.divideScalar(len);

    // Радиус «муфты» — заметно шире сечения, иначе стрелка утонет в трубе.
    const rad = sectionRadius(b) * kx * 1.7;
    // Длина стрелки соразмерна её толщине, но не длиннее трети выработки:
    // на короткой сбойке стрелка иначе вылезла бы за оба узла и залезла в
    // соседние выработки.
    const aLen = Math.min(rad * 2.4, len * 0.34);

    q.setFromUnitVectors(axisX, dir);
    // Ставим стрелку так, чтобы её СЕРЕДИНА пришлась на середину выработки:
    // основание конуса в нуле, поэтому отступаем назад на половину длины.
    base.copy(from).addScaledVector(dir, len / 2 - aLen / 2);
    m.compose(base, q, new THREE.Vector3(aLen, rad, rad));
    mesh.setMatrixAt(idx++, m);
  }

  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
