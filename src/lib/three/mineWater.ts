// ─────────────────────────────────────────────────────────────────────────────
// mineWater.ts — ВОДОПРОВОД ППЗ И ПОЖАРНЫЕ КРАНЫ В РЕЖИМЕ «МОДЕЛЬ».
//
// На чертеже водопровод — синяя линия у края выработки, воздухопровод —
// красная у противоположного (см. canvasRenderer). В объёме они ставятся так,
// как висят в натуре: труба своего диаметра ВНУТРИ выработки, у стенки, на
// кронштейнах, примерно на трети высоты от почвы. Водопровод — у правой
// стенки (по ходу from→to), воздухопровод — у левой: ровно та же сторона, что
// на чертеже.
//
// Пожарный кран (узел ППЗ «потребитель») — отвод от трубы с вентилем и
// маховиком, патрубком под рукав и красным указателем на стенке. Цвет
// маховика — как у значка на чертеже: синий — кран открыт, красный — закрыт.
//
// Всё пакетной отрисовкой (InstancedMesh): трубы, кронштейны и детали кранов —
// по одному вызову на тип детали, сколько бы их ни было на схеме.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type WaterBranchResult, type WaterNodeResult } from "@/lib/waterHydraulics";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { sectionOutline } from "@/lib/tube3d";
import { toThree, branchSectionQuaternion } from "./mineScene";

export interface WaterInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  xyScale: number;
  zScale: number;
  /** Множитель размера знаков (S/M/L) — для кранов. */
  sizeK?: number;
  /** Показывать воздухопровод (сжатый воздух). */
  airPipes?: boolean;
  /** Результаты гидравлического расчёта — направление и скорость воды. */
  waterBranchResults?: Map<string, WaterBranchResult>;
  /** Результаты расчёта по узлам — время истечения резервуаров. */
  waterNodeResults?: Map<string, WaterNodeResult>;
  /** Множитель скорости анимации — общий со стрелками воздуха. */
  animSpeed?: number;
  /** Показывать стрелки направления воды. */
  flowArrows?: boolean;
  /** Значки схемы — по ним ставятся запорные вентили и редукционные клапаны. */
  symbols?: SchemaSymbol[];
}

/** Значки, которые слой водопровода показывает объёмно. */
export const WATER_FITTING_IDS = new Set(["valve_water", "valve_reduce", "pump"]);

export interface MineWater {
  group: THREE.Group;
  dispose(): void;
  /** Двигает стрелки воды. Время — общие часы схемы (flowAnim.flowTime), с. */
  setTime(seconds: number): void;
  /** Есть ли что двигать: хотя бы одна труба с расходом. */
  hasFlow: boolean;
  arrowCount: number;
  pipeCount: number;
  hydrantCount: number;
  /** Сколько запорных вентилей и редукционных клапанов поставлено. */
  fittingCount: number;
  /** Сколько насосов поставлено. */
  pumpCount: number;
  /** Сколько резервуаров поставлено. */
  tankCount: number;
  /** Сколько баков сейчас опорожняется (есть разбор воды). */
  drainingTanks: number;
  drawCalls: number;
}

const WATER_COLOR = 0x1d4ed8;
const AIR_COLOR = 0xdc2626;
const BRACKET_COLOR = 0x6b7280;
const HYDRANT_OPEN = 0x1d4ed8;
const HYDRANT_CLOSED = 0xdc2626;

/** Шаг кронштейнов, м. */
const BRACKET_STEP = 6;
const MAX_BRACKETS = 20000;
const MAX_HYDRANTS = 2000;
const MAX_WATER_ARROWS = 6000;
/** Шаг стрелок воды вдоль трубы, м натуры. */
const ARROW_STEP = 5;
/** Ниже этого расхода (м³/ч) направление считать нельзя. */
const MIN_WATER_FLOW = 0.001;
const ARROW_COLOR = 0xdc2626;
const MAX_FITTINGS = 4000;
const GATE_OPEN = 0x2196f3;
const GATE_CLOSED = 0xdc2626;
const REDUCER_BODY = 0x1e3a8a;
const REDUCER_ACTIVE = 0xf59e0b;
const PUMP_BODY = 0x1f6f43;
const PUMP_MOTOR = 0x2b4c7e;
const PUMP_ON = 0x22c55e;
const PUMP_OFF = 0x6b7280;
const TANK_SHELL = 0x94a3b8;
const TANK_WATER = 0x2563eb;
const MAX_TANKS = 500;
/** Минута расчётного истечения = столько секунд показа (при скорости ×1). */
const DRAIN_SEC_PER_MIN = 1;
const DRAIN_MIN_SEC = 8;
const DRAIN_MAX_SEC = 90;
/** Пауза на пустом баке и время на заполнение перед новым циклом, с. */
const DRAIN_HOLD_SEC = 1.5;
const DRAIN_REFILL_SEC = 2.5;
const DRAIN_LOW = 0.04;

interface Pt { r: number; u: number }

/** Самая дальняя от оси точка контура справа (r>0) на высоте u. */
function wallAt(outline: Pt[], u: number): number {
  let best = 0;
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const p = outline[i], q = outline[(i + 1) % n];
    if ((p.u - u) * (q.u - u) > 0) continue;
    const du = q.u - p.u;
    const r = Math.abs(du) < 1e-9 ? Math.max(p.r, q.r) : p.r + (q.r - p.r) * ((u - p.u) / du);
    if (r > best) best = r;
  }
  return best;
}

/** Где висит труба в сечении: высота, расстояние до стенки, радиус. */
function pipeSlot(b: TopoBranch, diamMm: number, side: 1 | -1) {
  const outline = sectionOutline(b);
  let uMin = Infinity, uMax = -Infinity;
  for (const p of outline) { uMin = Math.min(uMin, p.u); uMax = Math.max(uMax, p.u); }
  const h = uMax - uMin;
  // Реальный диаметр, но не тоньше 6 см — иначе труба теряется на обзоре.
  const R = Math.max(0.03, Math.min(0.4, (diamMm > 0 ? diamMm : 100) / 2000));
  const u = uMin + Math.min(1.3, h * 0.33);
  const mirrored = outline.map(p => ({ r: p.r * side, u: p.u }));
  const wall = wallAt(mirrored, u);
  const gap = 0.12;
  return { u, wall, r: Math.max(R, wall - gap - R), R, h, floor: uMin };
}

export function buildMineWater(input: WaterInput): MineWater | null {
  const { nodes, branches } = input;
  const kx = input.xyScale > 0 ? input.xyScale : 1;
  const kz = input.zScale > 0 ? input.zScale : 1;
  const sizeK = Math.max(0.3, Math.min(4, input.sizeK ?? 1));
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  interface Run {
    b: TopoBranch; a: THREE.Vector3; dir: THREE.Vector3; len: number;
    q: THREE.Quaternion; up: THREE.Vector3; right: THREE.Vector3;
    slot: ReturnType<typeof pipeSlot>; side: 1 | -1; color: number;
  }
  const runs: Run[] = [];
  const waterByNode = new Map<string, Run[]>();

  for (const b of branches) {
    const wantWater = !!b.hasWaterPipe;
    const wantAir = !!b.hasAirPipe && input.airPipes !== false;
    if (!wantWater && !wantAir) continue;
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) continue;
    const a = toThree(fn.x * kx, fn.y * kx, fn.z * kz);
    const c = toThree(tn.x * kx, tn.y * kx, tn.z * kz);
    const dir = new THREE.Vector3().subVectors(c, a);
    const len = dir.length();
    if (!(len > 1e-6)) continue;
    dir.normalize();
    const q = branchSectionQuaternion(dir);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const mk = (side: 1 | -1, diam: number, color: number): Run =>
      ({ b, a, dir, len, q, up, right, slot: pipeSlot(b, diam, side), side, color });
    if (wantWater) {
      const run = mk(1, b.wpDiameter ?? 100, WATER_COLOR);
      runs.push(run);
      for (const id of [b.fromId, b.toId]) {
        const arr = waterByNode.get(id) ?? [];
        arr.push(run); waterByNode.set(id, arr);
      }
    }
    if (wantAir) runs.push(mk(-1, b.apDiameter ?? 100, AIR_COLOR));
  }

  const hydrantNodes = nodes.filter(n =>
    (n.fireNodeType ?? "none") === "consumer" && waterByNode.has(n.id),
  ).slice(0, MAX_HYDRANTS);

  const tankNodes = nodes.filter(n => (n.fireNodeType ?? "none") === "reservoir").slice(0, MAX_TANKS);

  if (runs.length === 0 && tankNodes.length === 0) return null;

  const group = new THREE.Group();
  group.name = "mine-water";
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const meshes: THREE.InstancedMesh[] = [];

  const m4 = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpColor = new THREE.Color();

  /** Точка в сечении выработки run на расстоянии s от начала (м мира). */
  const at = (run: Run, s: number, r: number, u: number, out: THREE.Vector3) =>
    out.copy(run.a)
      .addScaledVector(run.dir, s)
      .addScaledVector(run.up, u * kx)
      .addScaledVector(run.right, r * run.side * kx);

  const makeMesh = (geom: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
    geoms.push(geom); mats.push(mat);
    const mesh = new THREE.InstancedMesh(geom, mat, Math.max(1, count));
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    meshes.push(mesh);
    group.add(mesh);
    return mesh;
  };

  // ── Трубы ─────────────────────────────────────────────────────────────
  // Единичный цилиндр вдоль X: длина 1, радиус 1.
  const pipeGeom = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
  pipeGeom.rotateZ(-Math.PI / 2);
  pipeGeom.translate(0.5, 0, 0);
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 0.45, roughness: 0.4,
    emissive: 0x0b1a3a, emissiveIntensity: 0.25, side: THREE.DoubleSide,
  });
  const pipeMesh = makeMesh(pipeGeom, pipeMat, runs.length);
  runs.forEach((run, i) => {
    at(run, 0, run.slot.r, run.slot.u, tmpPos);
    tmpScale.set(run.len, run.slot.R * kx, run.slot.R * kx);
    m4.compose(tmpPos, run.q, tmpScale);
    pipeMesh.setMatrixAt(i, m4);
    pipeMesh.setColorAt(i, tmpColor.set(run.color));
  });

  // ── Кронштейны и фланцы ───────────────────────────────────────────────
  // Кронштейн — брусок от стенки до трубы, фланец — кольцо на стыке звеньев.
  const bracketGeom = new THREE.BoxGeometry(1, 1, 1);
  const bracketMat = new THREE.MeshStandardMaterial({ color: BRACKET_COLOR, metalness: 0.3, roughness: 0.7 });
  const flangeGeom = new THREE.CylinderGeometry(1, 1, 1, 14);
  flangeGeom.rotateZ(-Math.PI / 2);
  const flangeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.35 });

  interface Mark { run: Run; s: number }
  const marks: Mark[] = [];
  for (const run of runs) {
    const realLen = run.len / kx;
    const n = Math.max(1, Math.floor(realLen / BRACKET_STEP));
    for (let k = 0; k < n && marks.length < MAX_BRACKETS; k++) {
      marks.push({ run, s: ((k + 0.5) / n) * run.len });
    }
  }
  const bracketMesh = makeMesh(bracketGeom, bracketMat, marks.length);
  const flangeMesh = makeMesh(flangeGeom, flangeMat, marks.length);
  marks.forEach(({ run, s }, i) => {
    const { r, R, wall } = run.slot;
    const span = Math.max(0.05, wall - r);
    at(run, s, r + span / 2, run.slot.u, tmpPos);
    tmpScale.set(0.06 * kx, 0.05 * kx, span * kx);
    m4.compose(tmpPos, run.q, tmpScale);
    bracketMesh.setMatrixAt(i, m4);
    // Фланец — чуть дальше кронштейна, на стыке звеньев.
    at(run, Math.min(run.len, s + 0.6 * kx), r, run.slot.u, tmpPos);
    tmpScale.set(0.05 * kx, R * 1.35 * kx, R * 1.35 * kx);
    m4.compose(tmpPos, run.q, tmpScale);
    flangeMesh.setMatrixAt(i, m4);
    flangeMesh.setColorAt(i, tmpColor.set(run.color).multiplyScalar(0.8));
  });

  // ── Пожарные краны ────────────────────────────────────────────────────
  // Местные размеры крана (м) — натурные, умноженные на размер знаков.
  const hk = sizeK * 1.4;
  const hydrantCount = hydrantNodes.length;
  if (hydrantCount > 0) {
    const riserGeom = new THREE.CylinderGeometry(1, 1, 1, 12);
    const bodyGeom = new THREE.SphereGeometry(1, 16, 12);
    const wheelGeom = new THREE.TorusGeometry(1, 0.14, 8, 20);
    const nozzleGeom = new THREE.CylinderGeometry(1, 1, 1, 12);
    const plateGeom = new THREE.BoxGeometry(1, 1, 1);
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.35 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, metalness: 0.2, roughness: 0.5, emissive: 0x330000, emissiveIntensity: 0.3,
    });
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626, roughness: 0.6, emissive: 0xdc2626, emissiveIntensity: 0.35,
    });

    const riserMesh = makeMesh(riserGeom, metalMat, hydrantCount);
    const bodyMesh = makeMesh(bodyGeom, metalMat, hydrantCount);
    const wheelMesh = makeMesh(wheelGeom, accentMat, hydrantCount);
    const nozzleMesh = makeMesh(nozzleGeom, metalMat, hydrantCount);
    const plateMesh = makeMesh(plateGeom, plateMat, hydrantCount);

    const qTmp = new THREE.Quaternion();
    const qRot = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3(1, 0, 0);
    const zAxis = new THREE.Vector3(0, 0, 1);

    hydrantNodes.forEach((n, i) => {
      const run = waterByNode.get(n.id)![0];
      const atStart = run.b.fromId === n.id;
      const pull = Math.min(run.len * 0.4, 1.2 * kx);
      const s = atStart ? pull : run.len - pull;
      const { r, u, R, wall } = run.slot;
      const open = !!n.fireHydrantOpen;
      const col = open ? HYDRANT_OPEN : HYDRANT_CLOSED;
      const pipeCol = run.color;

      // Стояк вверх от трубы
      const riseH = 0.35 * hk;
      at(run, s, r, u + R + riseH / 2, tmpPos);
      tmpScale.set(R * 0.6 * kx, riseH * kx, R * 0.6 * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      riserMesh.setMatrixAt(i, m4);
      riserMesh.setColorAt(i, tmpColor.set(pipeCol));

      // Корпус вентиля
      const vu = u + R + riseH;
      const bodyR = Math.max(R * 1.1, 0.09 * hk);
      at(run, s, r, vu, tmpPos);
      tmpScale.setScalar(bodyR * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      bodyMesh.setMatrixAt(i, m4);
      bodyMesh.setColorAt(i, tmpColor.set(0x9ca3af));

      // Маховик — над корпусом, в горизонтальной плоскости сечения
      const wheelR = 0.16 * hk;
      at(run, s, r, vu + bodyR + 0.06 * hk, tmpPos);
      qRot.setFromAxisAngle(xAxis, Math.PI / 2);
      qTmp.copy(run.q).multiply(qRot);
      tmpScale.setScalar(wheelR * kx);
      m4.compose(tmpPos, qTmp, tmpScale);
      wheelMesh.setMatrixAt(i, m4);
      wheelMesh.setColorAt(i, tmpColor.set(col));

      // Патрубок под рукав — от корпуса к оси выработки
      const nozLen = 0.28 * hk;
      at(run, s, r - bodyR - nozLen / 2, vu, tmpPos);
      qRot.setFromUnitVectors(yAxis, zAxis);
      qTmp.copy(run.q).multiply(qRot);
      tmpScale.set(bodyR * 0.55 * kx, nozLen * kx, bodyR * 0.55 * kx);
      m4.compose(tmpPos, qTmp, tmpScale);
      nozzleMesh.setMatrixAt(i, m4);
      nozzleMesh.setColorAt(i, tmpColor.set(col));

      // Указатель «ПК» на стенке над краном
      const pu = Math.min(vu + 0.55 * hk, u + run.slot.h * 0.6);
      const pw = wallAt(sectionOutline(run.b).map(p => ({ r: p.r * run.side, u: p.u })), pu) || wall;
      at(run, s, pw - 0.03, pu, tmpPos);
      tmpScale.set(0.45 * hk * kx, 0.45 * hk * kx, 0.04 * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      plateMesh.setMatrixAt(i, m4);
    });
  }

  // ── Запорные вентили и редукционные клапаны ───────────────────────────
  // Ставятся по значкам схемы (valve_water / valve_reduce) — в той же точке
  // ветви (t), что и на чертеже. Если значка нет, а признак в карточке ветви
  // стоит (старые проекты) — ставим в типовую точку: вентиль на 0,4, клапан на 0,6.
  //
  // Вентиль: корпус-шар на трубе, фланцы, шпиндель и маховик. Маховик синий —
  // открыт, красный — закрыт, и тогда поперёк трубы стоит красный диск-заслонка.
  // Клапан: тёмно-синий корпус-бочка, колпак пружины сверху и манометр. Если по
  // расчёту клапан срезает давление, колпак светится янтарным.
  interface Fit { run: Run; s: number; kind: "gate" | "reducer" | "pump" }
  const fits: Fit[] = [];
  const waterRunByBranch = new Map<string, Run>();
  for (const run of runs) if (run.color === WATER_COLOR) waterRunByBranch.set(run.b.id, run);
  const seen = new Set<string>();
  const addFit = (bid: string, t: number, kind: Fit["kind"]) => {
    const run = waterRunByBranch.get(bid);
    if (!run || fits.length >= MAX_FITTINGS) return;
    const tt = Math.max(0.05, Math.min(0.95, t));
    fits.push({ run, s: tt * run.len, kind });
    seen.add(`${kind}:${bid}`);
  };
  for (const sym of input.symbols ?? []) {
    if (!sym.branchId || !WATER_FITTING_IDS.has(sym.typeId)) continue;
    const kind = sym.typeId === "valve_water" ? "gate" : sym.typeId === "pump" ? "pump" : "reducer";
    addFit(sym.branchId, sym.t ?? 0.5, kind);
  }
  for (const run of waterRunByBranch.values()) {
    if (run.b.wpHasGate && !seen.has(`gate:${run.b.id}`)) addFit(run.b.id, 0.4, "gate");
    if (run.b.wpHasReducer && !seen.has(`reducer:${run.b.id}`)) addFit(run.b.id, 0.6, "reducer");
  }

  const gates = fits.filter(f => f.kind === "gate");
  const reducers = fits.filter(f => f.kind === "reducer");
  const pumps = fits.filter(f => f.kind === "pump");
  const fk = sizeK;
  const xAx = new THREE.Vector3(1, 0, 0);
  const qT = new THREE.Quaternion();
  const qR = new THREE.Quaternion();

  if (fits.length > 0) {
    const sphereG = new THREE.SphereGeometry(1, 16, 12);
    const flangeG = new THREE.CylinderGeometry(1, 1, 1, 16);
    flangeG.rotateZ(-Math.PI / 2);
    const stemG = new THREE.CylinderGeometry(1, 1, 1, 8);
    const wheelG = new THREE.TorusGeometry(1, 0.16, 8, 20);
    const discG = new THREE.CylinderGeometry(1, 1, 1, 20);
    discG.rotateZ(-Math.PI / 2);
    const drumG = new THREE.CylinderGeometry(1, 1, 1, 18);
    drumG.rotateZ(-Math.PI / 2);
    const capG = new THREE.CylinderGeometry(0.75, 1, 1, 16);
    const gaugeG = new THREE.CylinderGeometry(1, 1, 1, 18);
    gaugeG.rotateX(Math.PI / 2);

    const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.35 });
    const glow = new THREE.MeshStandardMaterial({
      color: 0xffffff, metalness: 0.2, roughness: 0.45, emissive: 0xffffff, emissiveIntensity: 0.0,
    });
    const shut = new THREE.MeshStandardMaterial({
      color: GATE_CLOSED, roughness: 0.5, emissive: GATE_CLOSED, emissiveIntensity: 0.5,
      transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    const face = new THREE.MeshBasicMaterial({ color: 0xf8fafc });

    // Пакеты на тип детали.
    const nG = gates.length, nR = reducers.length;
    const bodyM = makeMesh(sphereG, metal, nG);
    const flangeM = makeMesh(flangeG, metal, (nG + nR + pumps.length) * 2);
    const stemM = makeMesh(stemG, metal, nG + nR);
    const wheelM = makeMesh(wheelG, glow, nG);
    const closedGates = gates.filter(f => f.run.b.wpGateClosed);
    const discM = closedGates.length > 0 ? makeMesh(discG, shut, closedGates.length) : null;
    const drumM = nR > 0 ? makeMesh(drumG, metal, nR) : null;
    const capM = nR > 0 ? makeMesh(capG, glow, nR) : null;
    const gaugeM = nR > 0 ? makeMesh(gaugeG, face, nR) : null;
    const gaugeRimM = nR > 0 ? makeMesh(gaugeG.clone(), metal, nR) : null;
    if (gaugeRimM) geoms.push(gaugeRimM.geometry);

    let fi = 0, si = 0;
    const flange = (run: Run, s: number, R: number) => {
      at(run, s, run.slot.r, run.slot.u, tmpPos);
      tmpScale.set(0.05 * fk * kx, R * kx, R * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      flangeM.setMatrixAt(fi, m4);
      flangeM.setColorAt(fi++, tmpColor.set(0x64748b));
    };
    const stem = (run: Run, s: number, u0: number, h: number, r0: number) => {
      at(run, s, run.slot.r, u0 + h / 2, tmpPos);
      tmpScale.set(r0 * kx, h * kx, r0 * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      stemM.setMatrixAt(si, m4);
      stemM.setColorAt(si++, tmpColor.set(0x94a3b8));
    };

    let ci = 0;
    gates.forEach((f, i) => {
      const { run, s } = f;
      const { R, u } = run.slot;
      const closed = !!run.b.wpGateClosed;
      const bR = Math.max(R * 1.45, 0.08 * fk);
      at(run, s, run.slot.r, u, tmpPos);
      tmpScale.set(bR * 1.25 * kx, bR * kx, bR * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      bodyM.setMatrixAt(i, m4);
      bodyM.setColorAt(i, tmpColor.set(0x475569));
      const fR = Math.max(R * 1.6, bR * 0.9);
      flange(run, s - bR * 1.25 * kx, fR);
      flange(run, s + bR * 1.25 * kx, fR);
      const sh = 0.22 * fk;
      stem(run, s, u + bR * 0.8, sh, 0.018 * fk);
      const wR = 0.13 * fk;
      at(run, s, run.slot.r, u + bR * 0.8 + sh, tmpPos);
      qR.setFromAxisAngle(xAx, Math.PI / 2);
      qT.copy(run.q).multiply(qR);
      tmpScale.setScalar(wR * kx);
      m4.compose(tmpPos, qT, tmpScale);
      wheelM.setMatrixAt(i, m4);
      wheelM.setColorAt(i, tmpColor.set(closed ? GATE_CLOSED : GATE_OPEN));
      if (closed && discM) {
        at(run, s, run.slot.r, u, tmpPos);
        tmpScale.set(0.03 * fk * kx, bR * 1.7 * kx, bR * 1.7 * kx);
        m4.compose(tmpPos, run.q, tmpScale);
        discM.setMatrixAt(ci++, m4);
      }
    });

    // ── Насосы ──────────────────────────────────────────────────────
    // Насос стоит на трубе: улитка-корпус поперёк трубы, рядом — двигатель
    // вдоль трубы на общей раме с опорами до почвы. Работает — двигатель и
    // лампа светятся зелёным, крыльчатка вентилятора двигателя подсвечена;
    // стоит (нет напора или расчёт не включил его) — лампа серая.
    const resP = input.waterBranchResults;
    if (pumps.length > 0) {
      const nP = pumps.length;
      const voluteG = new THREE.CylinderGeometry(1, 1, 1, 22);
      voluteG.rotateX(Math.PI / 2);
      const motorG = new THREE.CylinderGeometry(1, 1, 1, 18);
      motorG.rotateZ(-Math.PI / 2);
      const finG = new THREE.CylinderGeometry(1.08, 1.08, 1, 18, 1, true);
      finG.rotateZ(-Math.PI / 2);
      const boxG = new THREE.BoxGeometry(1, 1, 1);
      const lampG = new THREE.SphereGeometry(1, 12, 10);
      const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.45 });
      const lit = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.6,
      });
      const steel = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.5, roughness: 0.5 });
      const voluteM = makeMesh(voluteG, paint, nP);
      const motorM = makeMesh(motorG, paint, nP);
      const finM = makeMesh(finG, lit, nP);
      const frameM = makeMesh(boxG, steel, nP * 3);
      const lampM = makeMesh(lampG, lit, nP);
      let fr = 0;
      pumps.forEach((f, i) => {
        const { run, s } = f;
        const { R, u, r, floor } = run.slot;
        const pr = resP?.get(run.b.id);
        const on = pr ? !!pr.pumpActive : (run.b.wpPumpHead ?? 0) > 0;
        const vR = Math.max(R * 2.4, 0.16 * fk);
        const vW = vR * 0.9;
        // Улитка — на трубе
        at(run, s, r, u, tmpPos);
        tmpScale.set(vR * kx, vR * kx, vW * kx);
        m4.compose(tmpPos, run.q, tmpScale);
        voluteM.setMatrixAt(i, m4);
        voluteM.setColorAt(i, tmpColor.set(PUMP_BODY));
        flange(run, s - vR * kx, Math.max(R * 1.6, 0.06 * fk));
        flange(run, s + vR * kx, Math.max(R * 1.6, 0.06 * fk));
        // Двигатель — рядом с улиткой, ближе к оси выработки, вдоль трубы
        const mR = vR * 0.62, mL = vR * 2.2;
        const mr = r - vW / 2 - mR - 0.02;
        const mu = u - vR * 0.35;
        at(run, s, mr, mu, tmpPos);
        tmpScale.set(mL * kx, mR * kx, mR * kx);
        m4.compose(tmpPos, run.q, tmpScale);
        motorM.setMatrixAt(i, m4);
        motorM.setColorAt(i, tmpColor.set(PUMP_MOTOR));
        // Рёбра охлаждения — светятся, когда насос работает
        at(run, s, mr, mu, tmpPos);
        tmpScale.set(mL * 0.55 * kx, mR * kx, mR * kx);
        m4.compose(tmpPos, run.q, tmpScale);
        finM.setMatrixAt(i, m4);
        finM.setColorAt(i, tmpColor.set(on ? PUMP_ON : PUMP_OFF).multiplyScalar(on ? 1 : 0.6));
        // Рама и две опоры до почвы
        const baseU = Math.min(mu - mR, u - vR) - 0.04;
        const midR = (r + mr) / 2;
        const frameW = Math.abs(r - mr) + vW + mR;
        at(run, s, midR, baseU, tmpPos);
        tmpScale.set(mL * 1.15 * kx, 0.06 * kx, frameW * kx);
        m4.compose(tmpPos, run.q, tmpScale);
        frameM.setMatrixAt(fr++, m4);
        const legH = Math.max(0.02, baseU - floor);
        for (const off of [-mL * 0.45, mL * 0.45]) {
          at(run, s + off * kx, midR, floor + legH / 2, tmpPos);
          tmpScale.set(0.07 * kx, legH * kx, frameW * 0.8 * kx);
          m4.compose(tmpPos, run.q, tmpScale);
          frameM.setMatrixAt(fr++, m4);
        }
        // Лампа состояния на двигателе
        at(run, s, mr, mu + mR + 0.05 * fk, tmpPos);
        tmpScale.setScalar(0.05 * fk * kx);
        m4.compose(tmpPos, run.q, tmpScale);
        lampM.setMatrixAt(i, m4);
        lampM.setColorAt(i, tmpColor.set(on ? PUMP_ON : PUMP_OFF));

      });
    }

    const res = input.waterBranchResults;
    reducers.forEach((f, i) => {
      const { run, s } = f;
      const { R, u } = run.slot;
      const active = !!res?.get(run.b.id)?.reducerActive;
      const dR = Math.max(R * 1.6, 0.1 * fk);
      const dL = dR * 2.2;
      at(run, s, run.slot.r, u, tmpPos);
      tmpScale.set(dL * kx, dR * kx, dR * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      drumM!.setMatrixAt(i, m4);
      drumM!.setColorAt(i, tmpColor.set(REDUCER_BODY));
      flange(run, s - dL / 2 * kx, dR * 1.1);
      flange(run, s + dL / 2 * kx, dR * 1.1);
      // Колпак пружины над корпусом
      const ch = dR * 1.4;
      stem(run, s, u + dR * 0.8, dR * 0.4, dR * 0.35);
      at(run, s, run.slot.r, u + dR * 1.2 + ch / 2, tmpPos);
      tmpScale.set(dR * 0.7 * kx, ch * kx, dR * 0.7 * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      capM!.setMatrixAt(i, m4);
      capM!.setColorAt(i, tmpColor.set(active ? REDUCER_ACTIVE : REDUCER_BODY));
      // Манометр — на выходе клапана, циферблатом к оси выработки
      const gR = Math.max(0.05, dR * 0.55);
      const gs = s + (dL / 2 - gR * 0.2) * kx;
      at(run, gs, run.slot.r - dR - gR * 0.15, u + dR * 0.6, tmpPos);
      tmpScale.set(gR * kx, gR * kx, gR * 0.35 * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      gaugeRimM!.setMatrixAt(i, m4);
      gaugeRimM!.setColorAt(i, tmpColor.set(0x334155));
      at(run, gs, run.slot.r - dR - gR * 0.15 - gR * 0.2, u + dR * 0.6, tmpPos);
      tmpScale.set(gR * 0.85 * kx, gR * 0.85 * kx, gR * 0.05 * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      gaugeM!.setMatrixAt(i, m4);
    });
  }

  // ── Резервуары ────────────────────────────────────────────────────────
  // Узел-источник ППЗ («резервуар») — вертикальный бак у выработки: стальная
  // обечайка на просвет, внутри — синий столб воды. Размер — по ёмкости
  // (fireCapacity, м³), высота воды — по заполнению. Бак стоит рядом с
  // выработкой со стороны водопровода, на её почве, и соединён с трубой
  // отводом с задвижкой. Обручи и крышка с люком — чтобы бак читался баком,
  // а не колонной.
  const tankCount = tankNodes.length;
  // Опорожнение бака. Время истечения (drainTime, мин) считает гидравлический
  // расчёт при открытых кранах. Реальные десятки минут сжаты: минута расчёта —
  // секунда показа (с учётом общей скорости анимации), затем бак на миг пустеет,
  // быстро наполняется и цикл повторяется. Кранов не открыто — уровень стоит.
  interface TankAnim { i: number; base: THREE.Vector3; tR: number; tH: number; fill: number; cycle: number }
  const tankAnims: TankAnim[] = [];
  let tankWaterMesh: THREE.InstancedMesh | null = null;
  if (tankCount > 0) {
    const shellG = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
    const waterG = new THREE.CylinderGeometry(1, 1, 1, 28);
    const hoopG = new THREE.TorusGeometry(1, 0.025, 6, 32);
    hoopG.rotateX(Math.PI / 2);
    const lidG = new THREE.CylinderGeometry(1, 1, 1, 28);
    const stubG = new THREE.CylinderGeometry(1, 1, 1, 12);
    const shellMat = new THREE.MeshStandardMaterial({
      color: TANK_SHELL, metalness: 0.5, roughness: 0.4,
      transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
    });
    const waterMat = new THREE.MeshStandardMaterial({
      color: TANK_WATER, roughness: 0.15, metalness: 0.1,
      emissive: TANK_WATER, emissiveIntensity: 0.25, transparent: true, opacity: 0.8,
    });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.55, roughness: 0.4 });
    const pipeMatT = new THREE.MeshStandardMaterial({ color: WATER_COLOR, metalness: 0.45, roughness: 0.4 });

    const waterM = makeMesh(waterG, waterMat, tankCount);
    tankWaterMesh = waterM;
    const shellM = makeMesh(shellG, shellMat, tankCount);
    shellM.renderOrder = 6;
    const hoopM = makeMesh(hoopG, steelMat, tankCount * 3);
    const lidM = makeMesh(lidG, steelMat, tankCount * 2);
    const stubM = makeMesh(stubG, pipeMatT, tankCount * 2);

    const yUp = new THREE.Vector3(0, 1, 0);
    const qI = new THREE.Quaternion();
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const tmpD = new THREE.Vector3();
    let hi = 0, li = 0, sti = 0;

    const cyl = (mesh: THREE.InstancedMesh, i: number, from: THREE.Vector3, to: THREE.Vector3, rad: number) => {
      tmpD.subVectors(to, from);
      const L = tmpD.length();
      if (!(L > 1e-6)) { mesh.setMatrixAt(i, m4.makeScale(0, 0, 0)); return; }
      qArrowT.setFromUnitVectors(yUp, tmpD.normalize());
      tmpPos.addVectors(from, to).multiplyScalar(0.5);
      tmpScale.set(rad, L, rad);
      m4.compose(tmpPos, qArrowT, tmpScale);
      mesh.setMatrixAt(i, m4);
    };
    const qArrowT = new THREE.Quaternion();

    tankNodes.forEach((n, i) => {
      const cap = Math.max(0, n.fireCapacity ?? 0);
      // Размер бака по ёмкости: H ≈ 1,2·D, в разумных пределах.
      const V = cap > 0 ? cap : 50;
      const D = Math.max(1.6, Math.min(12, Math.cbrt((4 * V) / (Math.PI * 1.2))));
      const H = Math.max(2, Math.min(14, D * 1.2));
      const tR = (D / 2) * kx, tH = H * kx;
      const fill = cap > 0 ? 0.85 : 0.08;

      const center = toThree(n.x * kx, n.y * kx, n.z * kz);
      const run = waterByNode.get(n.id)?.[0];
      let base: THREE.Vector3;
      let joint: THREE.Vector3 | null = null;
      if (run) {
        const s0 = run.b.fromId === n.id ? Math.min(run.len * 0.15, 1 * kx) : run.len - Math.min(run.len * 0.15, 1 * kx);
        joint = at(run, s0, run.slot.r, run.slot.u, new THREE.Vector3());
        // Бак за стенкой выработки, со стороны водопровода
        const off = (run.slot.wall + 0.6) * kx + tR;
        base = new THREE.Vector3().copy(run.a).addScaledVector(run.dir, s0)
          .addScaledVector(run.up, run.slot.floor * kx)
          .addScaledVector(run.right, run.side * off);
      } else {
        base = center.clone().addScaledVector(yUp, -tH * 0.1);
      }

      const nr = input.waterNodeResults?.get(n.id);
      const drainMin = nr?.drainTime ?? 0;
      if (cap > 0 && Number.isFinite(drainMin) && drainMin > 0 && !nr?.noWater) {
        const k = Math.max(0.1, input.animSpeed ?? 1);
        const cycle = Math.max(DRAIN_MIN_SEC, Math.min(DRAIN_MAX_SEC, drainMin * DRAIN_SEC_PER_MIN)) / k;
        tankAnims.push({ i, base: base.clone(), tR, tH, fill, cycle });
      }

      // Вода
      const wH = tH * fill;
      tmpPos.copy(base).addScaledVector(yUp, wH / 2);
      tmpScale.set(tR * 0.97, wH, tR * 0.97);
      m4.compose(tmpPos, qI, tmpScale);
      waterM.setMatrixAt(i, m4);
      // Обечайка
      tmpPos.copy(base).addScaledVector(yUp, tH / 2);
      tmpScale.set(tR, tH, tR);
      m4.compose(tmpPos, qI, tmpScale);
      shellM.setMatrixAt(i, m4);
      // Обручи: низ, середина, верх
      for (const k of [0.02, 0.5, 0.98]) {
        tmpPos.copy(base).addScaledVector(yUp, tH * k);
        tmpScale.setScalar(tR * 1.01);
        m4.compose(tmpPos, qI, tmpScale);
        hoopM.setMatrixAt(hi++, m4);
      }
      // Крышка и люк
      tmpPos.copy(base).addScaledVector(yUp, tH + 0.03 * kx);
      tmpScale.set(tR * 1.02, 0.06 * kx, tR * 1.02);
      m4.compose(tmpPos, qI, tmpScale);
      lidM.setMatrixAt(li++, m4);
      tmpPos.copy(base).addScaledVector(yUp, tH + 0.15 * kx);
      tmpScale.set(tR * 0.28, 0.2 * kx, tR * 0.28);
      m4.compose(tmpPos, qI, tmpScale);
      lidM.setMatrixAt(li++, m4);
      // Отвод от дна бака к водопроводу: вниз-вбок, затем к трубе
      const pr = Math.max(run ? run.slot.R : 0.05, 0.05) * kx;
      if (joint) {
        tmpA.copy(base).addScaledVector(yUp, Math.min(0.4 * kx, tH * 0.1));
        tmpB.copy(joint).sub(tmpA);
        tmpB.y = 0;
        const toward = tmpB.lengthSq() > 1e-9 ? tmpB.normalize() : tmpB.set(0, 0, 0);
        const outlet = tmpA.clone().addScaledVector(toward, tR);
        cyl(stubM, sti++, tmpA.clone().addScaledVector(toward, tR * 0.9), outlet.clone().setY(joint.y), pr);
        cyl(stubM, sti++, outlet.clone().setY(joint.y), joint, pr);
      } else {
        stubM.setMatrixAt(sti++, m4.makeScale(0, 0, 0));
        stubM.setMatrixAt(sti++, m4.makeScale(0, 0, 0));
      }
    });

  }

  // ── Бегущие стрелки воды ──────────────────────────────────────────────
  // Стрелка — «манжета» на трубе: конус шире трубы, надетый на её ось. Так она
  // видна с любой стороны и не прячется в теле трубы. Направление и скорость —
  // из гидравлического расчёта (как стрелка на чертеже): flowFromTo задаёт
  // сторону, скорость воды в трубе — темп бега, сжатый в читаемый диапазон.
  interface Lane { run: Run; sign: 1 | -1; n: number; step: number; speed: number; first: number }
  const lanes: Lane[] = [];
  let arrowCount = 0;
  if (input.flowArrows !== false) {
    const animK = Math.max(0.1, input.animSpeed ?? 1);
    for (const run of runs) {
      if (run.color !== WATER_COLOR) continue;
      const res = input.waterBranchResults?.get(run.b.id);
      const flow = res ? (res.flow ?? 0) : (run.b.wpComputedFlow ?? 0);
      if (!(Math.abs(flow) > MIN_WATER_FLOW)) continue;
      if (run.b.wpHasGate && run.b.wpGateClosed) continue;
      const fromTo = res ? res.flowFromTo !== false : flow >= 0;
      const realLen = run.len / kx;
      const n = Math.max(1, Math.round(realLen / ARROW_STEP));
      if (arrowCount + n > MAX_WATER_ARROWS) break;
      const v = Math.abs(res?.velocity ?? run.b.wpComputedVelocity ?? 1);
      // Натурная скорость воды 0,5…3 м/с → 1,5…5 м/с на экране (в метрах натуры).
      const speed = Math.max(1.5, Math.min(5, 1.2 + v * 1.3)) * kx * animK;
      lanes.push({ run, sign: fromTo ? 1 : -1, n, step: run.len / n, speed, first: arrowCount });
      arrowCount += n;
    }
  }

  let arrowMesh: THREE.InstancedMesh | null = null;
  if (arrowCount > 0) {
    // Единичная стрелка вдоль +X: наконечник-конус и короткая втулка-хвостик.
    const head = new THREE.ConeGeometry(1, 1.4, 14, 1, false);
    head.rotateZ(-Math.PI / 2);
    head.translate(0.7, 0, 0);
    const tail = new THREE.CylinderGeometry(0.62, 0.62, 1.2, 14, 1, false);
    tail.rotateZ(-Math.PI / 2);
    tail.translate(-0.6, 0, 0);
    const parts = [head, tail].map(g => g.toNonIndexed());
    head.dispose(); tail.dispose();
    const arrowGeom = new THREE.BufferGeometry();
    const pos: number[] = [], nor: number[] = [];
    for (const g of parts) {
      pos.push(...(g.attributes.position.array as Float32Array));
      nor.push(...(g.attributes.normal.array as Float32Array));
      g.dispose();
    }
    arrowGeom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    arrowGeom.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    const arrowMat = new THREE.MeshStandardMaterial({
      color: ARROW_COLOR, roughness: 0.45, metalness: 0.1,
      emissive: ARROW_COLOR, emissiveIntensity: 0.45,
    });
    arrowMesh = makeMesh(arrowGeom, arrowMat, arrowCount);
    arrowMesh.renderOrder = 4;
  }

  const qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const qArrow = new THREE.Quaternion();
  const tankLevel = (ta: TankAnim, t: number) => {
    const full = ta.cycle + DRAIN_HOLD_SEC + DRAIN_REFILL_SEC;
    const ph = ((t % full) + full) % full;
    if (ph < ta.cycle) {
      // Истечение под напором идёт быстрее в начале: уровень ~ (1 − τ)².
      const x = 1 - ph / ta.cycle;
      return DRAIN_LOW + (ta.fill - DRAIN_LOW) * x * x;
    }
    if (ph < ta.cycle + DRAIN_HOLD_SEC) return DRAIN_LOW;
    const y = (ph - ta.cycle - DRAIN_HOLD_SEC) / DRAIN_REFILL_SEC;
    return DRAIN_LOW + (ta.fill - DRAIN_LOW) * (y * y * (3 - 2 * y));
  };
  const qId = new THREE.Quaternion();
  const setTanks = (t: number) => {
    if (!tankWaterMesh || tankAnims.length === 0) return;
    for (const ta of tankAnims) {
      const wH = Math.max(1e-4, ta.tH * tankLevel(ta, t));
      tmpPos.copy(ta.base);
      tmpPos.y += wH / 2;
      tmpScale.set(ta.tR * 0.97, wH, ta.tR * 0.97);
      m4.compose(tmpPos, qId, tmpScale);
      tankWaterMesh.setMatrixAt(ta.i, m4);
    }
    tankWaterMesh.instanceMatrix.needsUpdate = true;
  };

  const setTime = (t: number) => {
    setTanks(t);
    if (!arrowMesh) return;
    for (const ln of lanes) {
      const { run } = ln;
      const R = run.slot.R * kx;
      const aR = R * 1.7;
      const half = aR * 1.4;
      const span = Math.max(1e-6, run.len - 2 * half);
      qArrow.copy(run.q);
      if (ln.sign < 0) qArrow.multiply(qFlip);
      for (let k = 0; k < ln.n; k++) {
        let d = (k * ln.step + t * ln.speed) % run.len;
        if (d < 0) d += run.len;
        const along = ln.sign > 0 ? d : run.len - d;
        const s = half + (along / run.len) * span;
        at(run, s, run.slot.r, run.slot.u, tmpPos);
        // У концов стрелка «вырастает» и «тает», чтобы не прыгать на стыках.
        const edge = Math.min(d, run.len - d) / Math.max(1e-6, Math.min(run.len / 2, 1.5 * kx));
        const sc = aR * Math.min(1, Math.max(0.05, edge));
        tmpScale.setScalar(sc);
        m4.compose(tmpPos, qArrow, tmpScale);
        arrowMesh.setMatrixAt(ln.first + k, m4);
      }
    }
    arrowMesh.instanceMatrix.needsUpdate = true;
  };
  setTime(0);

  for (const m of meshes) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  const dispose = () => {
    group.clear();
    meshes.forEach(m => m.dispose());
    geoms.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
  };

  return {
    group, dispose, setTime,
    hasFlow: arrowCount > 0 || tankAnims.length > 0,
    drainingTanks: tankAnims.length,
    arrowCount,
    pipeCount: runs.length,
    hydrantCount,
    fittingCount: gates.length + reducers.length,
    pumpCount: pumps.length,
    tankCount,
    drawCalls: meshes.length,
  };
}
