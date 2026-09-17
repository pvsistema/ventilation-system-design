// ─────────────────────────────────────────────────────────────────────────────
// mineFans.ts — ВЕНТИЛЯТОР В РЕЖИМЕ «МОДЕЛЬ»: ОБЪЁМНАЯ МАШИНА, А НЕ КАРТОЧКА.
//
// ЗАЧЕМ. Все прочие условные обозначения в объёме — плоские карточки со значком
// из нормативной легенды (см. mineSymbols.ts), и это правильно: перемычку,
// дверь, очаг пожара комиссия обязана опознать ровно по тому рисунку, который
// стоит на бумаге. Но вентилятор на схеме — единственный ИСТОЧНИК ДВИЖЕНИЯ:
// по нему читают, откуда вообще идёт воздух, в какую сторону он подан и
// работает ли машина сейчас. Плоский кружок этого не показывает: он одинаков у
// работающего и остановленного вентилятора, у прямого хода и у реверса.
//
// ЧТО СДЕЛАНО. Вентилятор собирается настоящей объёмной моделью — кожух с
// кольцевыми обечайками, втулка с обтекателем, закрученные лопасти — и ставится
// В ОСЬ выработки, как стоит в натуре. Ротор ВРАЩАЕТСЯ, скорость вращения идёт
// от оборотов из карточки вентилятора, направление — от знака расхода и признака
// реверса. Сквозь кожух пропущена объёмная стрелка потока тем же цветом, что
// бегущие стрелки на схеме: красная — свежая струя, синяя — исходящая.
//
// ЧИТАЕТСЯ ТАК:
//   • лопасти крутятся   → машина в работе;
//   • ротор стоит        → вентилятор остановлен (fanStopped);
//   • куда смотрит стрелка и в какую сторону закручены лопасти → направление
//     подачи, с учётом реверса;
//   • размер машины      → сечение выработки, в которую она врезана.
//
// ПОЧЕМУ НЕ INSTANCEDMESH. Вентиляторов на схеме единицы — на большом руднике
// десятки, — и каждый вращается со своей скоростью. Пакетная отрисовка здесь
// ничего не экономит, зато лишает возможности крутить каждый ротор отдельно.
// Зато ГЕОМЕТРИЯ и МАТЕРИАЛЫ общие на все машины: строится единичная модель
// радиусом 1 вдоль +Z, а каждый экземпляр лишь поворачивается и масштабируется.
//
// ВРЕМЯ ОБЩЕЕ. Угол поворота берётся от тех же часов (flowAnim.flowTime), по
// которым бегут стрелки на чертеже и в объёме: два режима обязаны показывать
// одно движение, а не каждый своё.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { toThree } from "./mineScene";

/**
 * Потолок числа объёмных вентиляторов в сцене.
 *
 * Модель вентилятора — это полсотни граней на лопасть плюс кожух; на схеме,
 * где «вентиляторов» вдруг оказались тысячи (обычно это ошибка расстановки
 * значков), сцена встала бы колом. Ставим первые, остальные остаются плоскими
 * значками — см. mineSymbols.
 */
export const MAX_FANS = 400;

/** Цвета струи — те же, что у бегущих стрелок и на чертеже. */
const COLOR_FRESH = 0xdc2626;     // свежая
const COLOR_POLLUTED = 0x2563eb;  // исходящая (загазованная)

/** Ниже этого расхода направление считать нельзя: это уже погрешность. */
const MIN_FLOW = 0.1;

// ── Единичная геометрия ──────────────────────────────────────────────────────
// Всё строится в местных координатах: ось машины — +Z, радиус рабочего колеса —
// единица. Дальше экземпляр поворачивается вдоль выработки и масштабируется на
// свой радиус, поэтому одна и та же геометрия обслуживает и ствольную ГВУ, и
// метровый ВМП в сбойке.

/** Длина кожуха в долях радиуса колеса. */
const CASE_LEN = 1.5;

/**
 * Лопасть: закрученная, сужающаяся к концу, с отгибом назад.
 *
 * Строится из бруска с частым делением ВДОЛЬ РАДИУСА, после чего каждое сечение
 * поворачивается вокруг радиальной оси на свой угол установки — у корня круче
 * (воздух там набегает почти в лоб), к концу площе. Это не украшение: именно по
 * закрутке глаз опознаёт осевую машину, а не диск с наклейками.
 *
 * Местные оси бруска: x — хорда, y — толщина, z — радиальное направление.
 */
function makeBladeGeometry(): THREE.BufferGeometry {
  const r0 = 0.26;             // начало лопасти — по втулке
  const r1 = 0.98;             // конец — почти по кожуху
  const bl = r1 - r0;
  // Хорда узкая намеренно: у широкой лопасти при густом колесе соседние
  // перекрывают друг друга, и колесо сливается в сплошной диск — вращение по
  // такому диску не прочитать вовсе.
  const g = new THREE.BoxGeometry(0.54, 0.075, bl, 2, 1, 14);
  const pos = g.attributes.position as THREE.BufferAttribute;

  const thetaRoot = 0.75;      // угол установки у корня, рад
  const thetaTip = 0.24;       // у конца
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Доля радиуса: 0 — корень, 1 — конец лопасти.
    const s = Math.min(1, Math.max(0, (z + bl / 2) / bl));
    // Сужение хорды и утоньшение к концу — как у настоящего колеса.
    const kx = 1 - 0.40 * s;
    const ky = 1 - 0.62 * s;
    const th = thetaRoot + (thetaTip - thetaRoot) * s;
    const c = Math.cos(th), sn = Math.sin(th);
    const x1 = x * kx, y1 = y * ky;
    pos.setX(i, x1 * c - y1 * sn + 0.20 * s * s);  // последнее слагаемое — отгиб конца назад
    pos.setY(i, x1 * sn + y1 * c);
    pos.setZ(i, z + r0 + bl / 2);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * Рабочее колесо: втулка с обтекателем плюс лопасти по кругу.
 *
 * Число лопастей — по назначению машины: у главной установки колесо густое,
 * у вентилятора местного проветривания лопастей заметно меньше. Разница видна
 * издали и помогает отличить ГВУ от ВМП, не читая подпись.
 */
function makeRotorGeometry(blades: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Втулка: короткий цилиндр по оси Z.
  const hub = new THREE.CylinderGeometry(0.24, 0.26, 0.52, 20, 1, false);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);

  // Обтекатель — конус остриём навстречу потоку (в −Z, то есть во вход).
  const nose = new THREE.ConeGeometry(0.24, 0.42, 20, 1, false);
  nose.rotateX(-Math.PI / 2);      // остриё в −Z
  nose.translate(0, 0, -0.47);
  parts.push(nose);

  const blade = makeBladeGeometry();
  const tang = new THREE.Vector3();
  const axial = new THREE.Vector3(0, 0, 1);
  const radial = new THREE.Vector3();
  const m = new THREE.Matrix4();
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    radial.set(Math.cos(a), Math.sin(a), 0);
    tang.set(-Math.sin(a), Math.cos(a), 0);
    // Базис лопасти: хорда — по касательной, толщина — вдоль оси машины,
    // длина — по радиусу. Поворот сечений (закрутка) уже вшит в геометрию.
    m.makeBasis(tang, axial, radial);
    const b = blade.clone().applyMatrix4(m);
    parts.push(b);
  }
  blade.dispose();

  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  // mergeGeometries возвращает null при расхождении наборов атрибутов. У всех
  // заготовок они одинаковые, но остаться без вентилятора хуже, чем без
  // лопастей: пусть в крайнем случае будет хотя бы втулка.
  if (!merged) {
    const fb = new THREE.CylinderGeometry(0.26, 0.26, 0.5, 16);
    fb.rotateX(Math.PI / 2);
    return fb;
  }
  return merged;
}

/**
 * Неподвижная часть: обечайки кожуха и стойки крепления ротора.
 *
 * Кожух даёт машине объём и «посадку» в выработку: без него лопасти висят в
 * пустоте и читаются как значок, а не как установка.
 */
function makeFrameGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Два кольцевых обода по краям кожуха.
  for (const z of [-CASE_LEN / 2, CASE_LEN / 2]) {
    const ring = new THREE.TorusGeometry(1.06, 0.07, 8, 28);
    ring.translate(0, 0, z);
    parts.push(ring);
  }
  // Кольцо жёсткости посередине — по нему видно длину кожуха при взгляде вдоль оси.
  const mid = new THREE.TorusGeometry(1.06, 0.04, 6, 24);
  parts.push(mid);

  // Стойки: три радиальные распорки от втулки к кожуху, сдвинутые за колесо,
  // чтобы не спорить с лопастями.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const strut = new THREE.BoxGeometry(0.82, 0.07, 0.10);
    strut.translate(0.62, 0, 0);
    strut.rotateZ(a);
    strut.translate(0, 0, CASE_LEN / 2 - 0.22);
    parts.push(strut);
  }

  // Лапы основания здесь СОЗНАТЕЛЬНО НЕТ. Машина врезана в выработку и стоит
  // в её оси; «пол» под ней в объёме — почва выработки, до которой от оси
  // ровно полсечения, и никакой фундамент в геометрии УО не описан. Нарисовать
  // лапу — значит показать опору там, где её положение выдумано, да ещё и
  // пробить ею стенку у вентилятора, поставленного в стволе.

  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  if (!merged) return new THREE.TorusGeometry(1.06, 0.07, 8, 24);
  return merged;
}

/** Обечайка кожуха — отдельно: она полупрозрачная, сквозь неё видно колесо. */
function makeShellGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1.06, 1.06, CASE_LEN, 28, 1, true);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Стрелка потока, пропущенная сквозь машину.
 *
 * Та же форма, что у бегущих стрелок схемы (конус плюс хвостик): направление
 * подачи обязано читаться одинаково и на выработке, и на вентиляторе. Остриё —
 * в +Z, то есть туда, куда вентилятор гонит воздух.
 */
function makeFlowArrowGeometry(): THREE.BufferGeometry {
  // Стрелка ВЫХОДИТ ЗА кожух с обеих сторон: только так видно, что воздух идёт
  // сквозь машину, а не начинается в ней. Внутри кожуха её частично закрывают
  // лопасти — это правильно, ротор ближе к человеку и обязан их перекрывать.
  const head = new THREE.ConeGeometry(0.26, 0.58, 14, 1, false);
  head.rotateX(Math.PI / 2);                 // остриё в +Z
  head.translate(0, 0, CASE_LEN * 0.95);
  const tail = new THREE.CylinderGeometry(0.075, 0.075, CASE_LEN * 1.6, 10, 1, false);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, CASE_LEN * 0.06);
  const merged = mergeGeometries([head, tail], false);
  head.dispose(); tail.dispose();
  if (!merged) {
    const fb = new THREE.ConeGeometry(0.3, 0.6, 12);
    fb.rotateX(Math.PI / 2);
    return fb;
  }
  return merged;
}

/** Габариты сечения выработки, м. По ним подбирается размер машины. */
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

/**
 * Угловая скорость ротора на экране, рад/с.
 *
 * Честные обороты (до 1500 об/мин) показывать нельзя: на шестидесяти кадрах в
 * секунду колесо провернулось бы между кадрами на несколько лопастей и
 * выглядело бы стоящим или крутящимся назад — тот самый эффект «колёс телеги в
 * кино». Поэтому обороты сжимаются в узкий видимый диапазон: быстрее машина —
 * заметно быстрее вращение, но всегда различимое глазом.
 */
function spinRate(b: TopoBranch, animSpeed: number): number {
  if (b.fanStopped) return 0;
  const rpm = Math.max(0, b.fanRpm ?? 0) || 750;
  // Логарифмическое сжатие: 300 об/мин → около 2 рад/с, 1500 → около 6.
  const k = Math.log10(Math.max(60, rpm) / 60) / Math.log10(25);
  const w = 1.4 + 5.0 * Math.min(1, k);
  return w * Math.max(0.1, animSpeed);
}

export interface FansInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  /** Условные обозначения схемы: берём из них только вентиляторы. */
  symbols: SchemaSymbol[];
  xyScale: number;
  zScale: number;
  /** Общий размер знаков — та же ручка S/M/L, что у плоских обозначений. */
  sizeK?: number;
  /** Выработки с исходящей струёй: стрелка потока в них синяя. */
  pollutedBranchIds?: Set<string>;
  /** Множитель скорости анимации из настроек. */
  animSpeed?: number;
}

/** Готовый слой вентиляторов. */
export interface MineFans {
  group: THREE.Group;
  /** Крутит роторы. Время в секундах от общих часов анимации. */
  setTime(seconds: number): void;
  dispose(): void;
  /** Сколько машин попало в сцену. */
  count: number;
  /** Сколько вызовов отрисовки они добавили. */
  drawCalls: number;
  /** Есть ли хоть один вращающийся ротор: нужен ли непрерывный показ кадров. */
  hasSpinning: boolean;
}

/**
 * Строит слой объёмных вентиляторов.
 *
 * Возвращает null, если на схеме нет ни одного вентилятора, привязанного к
 * выработке с координатами.
 */
export function buildMineFans(input: FansInput): MineFans | null {
  const { nodes, branches, symbols, xyScale, zScale } = input;
  if (!symbols || symbols.length === 0) return null;

  const kx = xyScale > 0 ? xyScale : 1;
  const kz = zScale > 0 ? zScale : 1;
  const sizeK = Math.max(0.2, Math.min(4, input.sizeK ?? 1));
  const animSpeed = Math.max(0.1, input.animSpeed ?? 1);
  const polluted = input.pollutedBranchIds;

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const branchById = new Map(branches.map(b => [b.id, b]));

  // ── Общие геометрии и материалы ─────────────────────────────────────────
  // Строим по одному разу: вентиляторы отличаются только положением, размером
  // и скоростью вращения.
  const shellGeom = makeShellGeometry();
  const frameGeom = makeFrameGeometry();
  const arrowGeom = makeFlowArrowGeometry();
  const rotorGeoms = new Map<number, THREE.BufferGeometry>();
  const rotorGeom = (blades: number) => {
    let g = rotorGeoms.get(blades);
    if (!g) { g = makeRotorGeometry(blades); rotorGeoms.set(blades, g); }
    return g;
  };

  // Кожух — полупрозрачный металл: сквозь него видно вращающееся колесо, ради
  // которого всё и затевалось. Запись глубины выключена, иначе прозрачная
  // обечайка загораживала бы собственные лопасти.
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x9fb0c4, metalness: 0.85, roughness: 0.32,
    transparent: true, opacity: 0.30, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x64748b, metalness: 0.9, roughness: 0.3,
  });
  // Колесо светлое: на тёмном теле выработки закрутка лопастей читается только
  // за счёт бликов, а они видны на светлом металле.
  const rotorMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0, metalness: 0.75, roughness: 0.28,
  });
  // Ротор остановленной машины — тусклый серый: видно, что стоит, даже на
  // стоп-кадре, когда вращения не оценить.
  const rotorStopMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8, metalness: 0.4, roughness: 0.7,
  });
  const arrowMatFresh = new THREE.MeshStandardMaterial({
    color: COLOR_FRESH, emissive: COLOR_FRESH, emissiveIntensity: 0.35,
    metalness: 0.2, roughness: 0.5,
  });
  const arrowMatPolluted = new THREE.MeshStandardMaterial({
    color: COLOR_POLLUTED, emissive: COLOR_POLLUTED, emissiveIntensity: 0.35,
    metalness: 0.2, roughness: 0.5,
  });

  const group = new THREE.Group();
  /** Роторы и их скорости: по ним идёт вращение в каждом кадре. */
  const rotors: { obj: THREE.Object3D; w: number }[] = [];
  let count = 0;
  let drawCalls = 0;
  let hasSpinning = false;

  const axisZ = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion();

  for (const sym of symbols) {
    if (count >= MAX_FANS) break;
    if (sym.typeId !== "fan") continue;
    if (!sym.branchId) continue;
    const b = branchById.get(sym.branchId);
    if (!b || b.isDead) continue;
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

    // Куда машина ГОНИТ воздух. Знак расхода — главный признак: он уже учёл
    // всю сеть. Реверс при нерассчитанном или прямом расходе разворачивает
    // машину сам: иначе включённый реверс на схеме ничем бы не отличался.
    const flow = b.flow ?? 0;
    const reverseOverride = (b.fanReverse ?? false) && flow >= 0;
    const flipped = flow < -MIN_FLOW || reverseOverride;
    const axis = flipped ? dir.clone().negate() : dir.clone();

    const t = Math.max(0, Math.min(1, sym.t ?? 0.5));
    const pos = new THREE.Vector3().lerpVectors(a, c, t);

    const dims = sectionDims(b);
    const sc = Math.max(0.1, Math.min(8, sym.scale ?? 1));
    // Радиус колеса: машина соразмерна выработке и чуть шире её сечения —
    // иначе на стволе в десяток метров вентилятор виден, а на сбойке нет.
    const R = Math.max(0.6, Math.max(dims.w, dims.h) * kx * 0.75 * sc * sizeK);

    const fan = new THREE.Group();
    fan.position.copy(pos);
    // Местная ось машины (+Z) разворачивается по направлению подачи.
    q.setFromUnitVectors(axisZ, axis);
    fan.quaternion.copy(q);
    fan.scale.setScalar(R);

    const blades = (b.fanType === "ГВУ") ? 8 : (b.fanType === "ВВУ" ? 6 : 4);
    const w = spinRate(b, animSpeed);
    // Против часовой при прямой подаче, по часовой при обратной: у двух
    // соседних машин, работающих навстречу, это видно сразу.
    const spin = (flipped ? -1 : 1) * w;

    const rotor = new THREE.Mesh(rotorGeom(blades), b.fanStopped ? rotorStopMat : rotorMat);
    rotor.frustumCulled = false;
    fan.add(rotor);
    rotors.push({ obj: rotor, w: spin });
    if (Math.abs(spin) > 1e-6) hasSpinning = true;

    const frame = new THREE.Mesh(frameGeom, frameMat);
    frame.frustumCulled = false;
    fan.add(frame);

    const shell = new THREE.Mesh(shellGeom, shellMat);
    shell.frustumCulled = false;
    // Прозрачный кожух рисуем последним: иначе он «съедает» лопасти за собой.
    shell.renderOrder = 4;
    fan.add(shell);

    // Стрелку у остановленной машины не ставим: потока через неё нет, и
    // указатель направления был бы прямой неправдой.
    if (!b.fanStopped && Math.abs(flow) >= MIN_FLOW) {
      const arrow = new THREE.Mesh(
        arrowGeom,
        polluted?.has(b.id) ? arrowMatPolluted : arrowMatFresh,
      );
      arrow.frustumCulled = false;
      arrow.renderOrder = 5;
      fan.add(arrow);
      drawCalls++;
    }

    group.add(fan);
    drawCalls += 3;
    count++;
  }

  if (count === 0) {
    shellGeom.dispose(); frameGeom.dispose(); arrowGeom.dispose();
    rotorGeoms.forEach(g => g.dispose());
    [shellMat, frameMat, rotorMat, rotorStopMat, arrowMatFresh, arrowMatPolluted]
      .forEach(m => m.dispose());
    return null;
  }

  const setTime = (seconds: number) => {
    for (const r of rotors) {
      if (r.w === 0) continue;
      // Угол приводим к обороту: за час работы число ушло бы в тысячи радиан и
      // поворот начал бы дёргаться на потере точности.
      r.obj.rotation.z = (r.w * seconds) % (Math.PI * 2);
    }
  };

  const dispose = () => {
    group.clear();
    rotors.length = 0;
    shellGeom.dispose(); frameGeom.dispose(); arrowGeom.dispose();
    rotorGeoms.forEach(g => g.dispose());
    rotorGeoms.clear();
    [shellMat, frameMat, rotorMat, rotorStopMat, arrowMatFresh, arrowMatPolluted]
      .forEach(m => m.dispose());
  };

  return { group, setTime, dispose, count, drawCalls, hasSpinning };
}