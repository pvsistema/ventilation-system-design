// ─────────────────────────────────────────────────────────────────────────────
// mineVentPipe.ts — ВЕНТИЛЯЦИОННЫЙ ТРУБОПРОВОД (СТАВ ВМП) В РЕЖИМЕ «МОДЕЛЬ».
//
// На чертеже став — отдельная узкая нить ветвей рядом с выработкой
// (isVentPipeBranch, см. buildVentPipeLine). Так удобно считать сеть, но в
// объёме такая нить выглядела бы отдельной тонкой выработкой за стенкой.
// Здесь став ставится так, как висит в натуре: ВНУТРИ хозяйской выработки
// (vpHostBranchId), под кровлей, у левой стенки (водопровод — у правой), на
// тросе-подвеске. Гибкий рукав — жёлто-оранжевый с кольцами, металл — серый с
// фланцами. На свободных концах — раструбы. ВМП — корпус на трубе с
// крыльчаткой, бегущие стрелки воздуха внутри става — по расчёту.
//
// Старые проекты без нити (галочка «вентрубопровод» на самой выработке) тоже
// показываются: труба под кровлей той же выработки.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { sectionOutline } from "@/lib/tube3d";
import { toThree, branchSectionQuaternion } from "./mineScene";
import { type TankLabel } from "./mineWater";
import { type VentSection, type VentNorms } from "@/lib/ventSections";
import { calcVentPipeDelivery, type VentPipeDelivery } from "@/lib/ventPipeDelivery";

export interface VentPipeInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  symbols?: SchemaSymbol[];
  xyScale: number;
  zScale: number;
  sizeK?: number;
  animSpeed?: number;
  /** Показывать бегущие стрелки воздуха внутри става. */
  flowArrows?: boolean;
  /** Ветви с исходящей струёй — стрелки в них синие. */
  pollutedBranchIds?: Set<string>;
  /** Нормы и участки — для требуемого расхода в забое (как во вкладке «Вентстав»). */
  ventNorms?: VentNorms;
  ventSections?: VentSection[];
}

export interface MineVentPipe {
  group: THREE.Group;
  dispose(): void;
  setTime(seconds: number): void;
  /** Есть что двигать: стрелки или вращающиеся крыльчатки. */
  hasMotion: boolean;
  labels: TankLabel[];
  pipeCount: number;
  /** Общая длина става, м натуры. */
  totalLength: number;
  fanCount: number;
  drawCalls: number;
}

const ENTRY_RE = /\((вход|выход)\)/;
/** Став висит у левой стенки: водопровод — у правой. */
const SIDE = -1;
const RUKAV_COLOR = 0xf2b33d;
const METAL_COLOR = 0x8b95a3;
const ARROW_FRESH = 0xdc2626;
const ARROW_POLLUTED = 0x2563eb;
const FAN_BODY = 0x2f855a;
const FAN_BAND = 0xdc2626;
const FAN_OFF = 0x6b7280;
const RING_STEP = 2;
const FLANGE_STEP = 4;
const HANGER_STEP = 4;
const ARROW_STEP = 4;
const MIN_FLOW = 0.05;
const MAX_RINGS = 40000;
const MAX_HANGERS = 30000;
const MAX_ARROWS = 8000;
const MAX_FANS = 300;

const fmt = (v: number, d = 2) =>
  v.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: 0 });

interface Pt { r: number; u: number }

/** Высота кровли контура над точкой r (самая верхняя точка пересечения). */
function roofAt(outline: Pt[], r: number): number {
  let best = -Infinity;
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const p = outline[i], q = outline[(i + 1) % n];
    if ((p.r - r) * (q.r - r) > 0) continue;
    const dr = q.r - p.r;
    const u = Math.abs(dr) < 1e-9 ? Math.max(p.u, q.u) : p.u + (q.u - p.u) * ((r - p.r) / dr);
    if (u > best) best = u;
  }
  return best;
}

/** Ветви нити става, которые в объёме заменяются трубой в хозяйской выработке. */
export function ventPipeHiddenIds(branches: TopoBranch[]): Set<string> {
  const byId = new Map(branches.map(b => [b.id, b]));
  const out = new Set<string>();
  for (const b of branches) {
    if (!b.isVentPipeBranch || !b.vpHostBranchId) continue;
    const host = byId.get(b.vpHostBranchId);
    if (host && !host.isVentPipeBranch) out.add(b.id);
  }
  return out;
}

/** Значки вентиляторов, стоящие на нити става: их рисует слой става. */
export function ventPipeFanSymbolIds(symbols: SchemaSymbol[] | undefined, hidden: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const s of symbols ?? []) {
    if (s.typeId === "fan" && s.branchId && hidden.has(s.branchId)) out.add(s.id);
  }
  return out;
}

export function buildMineVentPipe(input: VentPipeInput): MineVentPipe | null {
  const { nodes, branches } = input;
  const kx = input.xyScale > 0 ? input.xyScale : 1;
  const kz = input.zScale > 0 ? input.zScale : 1;
  const sizeK = Math.max(0.3, Math.min(4, input.sizeK ?? 1));
  const animK = Math.max(0.1, input.animSpeed ?? 1);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const byId = new Map(branches.map(b => [b.id, b]));
  const hidden = ventPipeHiddenIds(branches);

  interface Run {
    flowB: TopoBranch; host: TopoBranch;
    a: THREE.Vector3; dir: THREE.Vector3; len: number; q: THREE.Quaternion;
    up: THREE.Vector3; right: THREE.Vector3;
    rc: number; u: number; R: number; roof: number;
    metal: boolean; color: number;
    /** Расход в ставе, м³/с, скорость, м/с, и куда идёт воздух вдоль хозяйской выработки. */
    Q: number; v: number; sign: 1 | -1;
  }

  const finite = (n?: TopoNode) => !!n && isFinite(n.x) && isFinite(n.y) && isFinite(n.z);

  const mkRun = (flowB: TopoBranch, host: TopoBranch, orient: 1 | -1, legacy: boolean): Run | null => {
    const fn = nodeById.get(host.fromId), tn = nodeById.get(host.toId);
    if (!finite(fn) || !finite(tn)) return null;
    const a = toThree(fn!.x * kx, fn!.y * kx, fn!.z * kz);
    const c = toThree(tn!.x * kx, tn!.y * kx, tn!.z * kz);
    const dir = new THREE.Vector3().subVectors(c, a);
    const len = dir.length();
    if (!(len > 1e-6)) return null;
    dir.normalize();
    const q = branchSectionQuaternion(dir);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(q);

    const outline = sectionOutline(host);
    let halfW = 0, uMin = Infinity, uMax = -Infinity;
    for (const p of outline) {
      halfW = Math.max(halfW, Math.abs(p.r));
      uMin = Math.min(uMin, p.u); uMax = Math.max(uMax, p.u);
    }
    const h = uMax - uMin;
    const diamMm = flowB.vpDiameter > 0 ? flowB.vpDiameter
      : (!legacy && flowB.diameter && flowB.diameter > 0 ? flowB.diameter * 1000 : 500);
    const Rmax = Math.max(0.1, Math.min(0.75, h * 0.28, halfW * 0.6));
    const R = Math.max(0.1, Math.min(Rmax, diamMm / 2000));
    const rc = SIDE * Math.max(0, Math.min(halfW * 0.55, halfW - R - 0.25));
    const lim = Math.max(0, halfW - 1e-3);
    const clampR = (r: number) => Math.max(-lim, Math.min(lim, r));
    let roof = Math.min(roofAt(outline, clampR(rc - R)), roofAt(outline, clampR(rc + R)));
    if (!isFinite(roof) || roof <= uMin) roof = uMax;
    const u = Math.max(uMin + R, roof - 0.12 - R);
    const metal = /металл/i.test(flowB.vpMaterial ?? "");

    let Q: number, v: number, sign: 1 | -1;
    const area = Math.PI * R * R;
    if (legacy) {
      Q = Math.abs(flowB.vpComputedFlow ?? 0);
      v = Math.abs(flowB.vpComputedVelocity ?? 0) || (Q > 0 ? Q / area : 0);
      sign = (flowB.flow ?? 0) < 0 ? -1 : 1;
    } else {
      const f = flowB.flow ?? 0;
      Q = Math.abs(f);
      v = Math.abs(flowB.velocity ?? 0) || (Q > 0 ? Q / area : 0);
      sign = ((f < 0 ? -1 : 1) * orient) as 1 | -1;
    }
    return {
      flowB, host, a, dir, len, q, up, right, rc, u, R, roof, metal,
      color: metal ? METAL_COLOR : RUKAV_COLOR, Q, v, sign,
    };
  };

  const runs: Run[] = [];
  const runByThread = new Map<string, Run>();
  const runByHost = new Map<string, Run>();
  const hosted = new Set<string>();

  for (const b of branches) {
    if (!hidden.has(b.id)) continue;
    const host = byId.get(b.vpHostBranchId!)!;
    hosted.add(host.id);
    if (ENTRY_RE.test(b.type ?? "")) continue;
    const tf = nodeById.get(b.fromId);
    const hf = nodeById.get(host.fromId), ht = nodeById.get(host.toId);
    let orient: 1 | -1 = 1;
    if (tf && hf && ht) {
      const d1 = Math.hypot(tf.x - hf.x, tf.y - hf.y);
      const d2 = Math.hypot(tf.x - ht.x, tf.y - ht.y);
      orient = d1 <= d2 ? 1 : -1;
    }
    const run = mkRun(b, host, orient, false);
    if (!run) continue;
    runs.push(run);
    runByThread.set(b.id, run);
    if (!runByHost.has(host.id)) runByHost.set(host.id, run);
  }
  for (const b of branches) {
    if (!b.hasVentPipe || b.isVentPipeBranch || hosted.has(b.id)) continue;
    const run = mkRun(b, b, 1, true);
    if (!run) continue;
    runs.push(run);
    runByHost.set(b.id, run);
  }
  if (runs.length === 0) return null;

  const pt = (run: Run, s: number, r: number, u: number, out: THREE.Vector3) =>
    out.copy(run.a)
      .addScaledVector(run.dir, s)
      .addScaledVector(run.up, u * kx)
      .addScaledVector(run.right, r * kx);

  // ── Связность става: по узлам хозяйских выработок ─────────────────────
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const atNode = new Map<string, number[]>();
  runs.forEach((r, i) => {
    for (const id of [r.host.fromId, r.host.toId]) {
      const arr = atNode.get(id) ?? [];
      arr.push(i); atNode.set(id, arr);
    }
  });
  for (const arr of atNode.values()) for (let k = 1; k < arr.length; k++) parent[find(arr[k])] = find(arr[0]);
  const compQ = new Map<number, { qin: number; qout: number }>();
  runs.forEach((r, i) => {
    if (!(r.Q > MIN_FLOW)) return;
    const c = find(i);
    const cur = compQ.get(c) ?? { qin: 0, qout: Infinity };
    cur.qin = Math.max(cur.qin, r.Q); cur.qout = Math.min(cur.qout, r.Q);
    compQ.set(c, cur);
  });

  // ── ВМП на ставе ──────────────────────────────────────────────────────
  interface FanPlace { run: Run; runIdx: number; s: number; sign: 1 | -1; fb: TopoBranch }
  const fans: FanPlace[] = [];
  for (const sym of input.symbols ?? []) {
    if (fans.length >= MAX_FANS) break;
    if (sym.typeId !== "fan" || !sym.branchId || !hidden.has(sym.branchId)) continue;
    const fb = byId.get(sym.branchId);
    if (!fb) continue;
    const f = fb.flow ?? 0;
    let run: Run | undefined, s = 0, sign: 1 | -1 = 1;
    if (!ENTRY_RE.test(fb.type ?? "")) {
      run = runByThread.get(fb.id);
      if (!run) continue;
      const t = Math.max(0.05, Math.min(0.95, sym.t ?? 0.5));
      const orient = run.sign * (f < 0 ? -1 : 1);
      s = (orient > 0 ? t : 1 - t) * run.len;
      sign = run.sign;
      if (f >= 0 && fb.fanReverse) sign = (-sign) as 1 | -1;
    } else {
      run = runByHost.get(fb.vpHostBranchId ?? "");
      if (!run) continue;
      const atFrom = fb.fromId === run.host.fromId || fb.toId === run.host.fromId;
      const route = atFrom ? run.host.fromId : run.host.toId;
      const pull = Math.min(run.len * 0.2, 1.5 * kx);
      s = atFrom ? pull : run.len - pull;
      let inward = Math.abs(f) < 1e-6 ? true : (f > 0) === (fb.fromId === route);
      if (f >= 0 && fb.fanReverse) inward = !inward;
      sign = ((atFrom ? 1 : -1) * (inward ? 1 : -1)) as 1 | -1;
    }
    fans.push({ run, runIdx: runs.indexOf(run), s, sign, fb });
  }

  // ── Доставка воздуха — тот же расчёт, что во вкладке «Вентстав» ───────
  const delivByComp = new Map<number, VentPipeDelivery>();
  if (input.ventNorms) {
    const tryCalc = (b: TopoBranch, runIdx: number) => {
      const c = find(runIdx);
      if (delivByComp.has(c)) return;
      const d = calcVentPipeDelivery(b, branches, input.ventNorms!, input.ventSections ?? []);
      if (d) delivByComp.set(c, d);
    };
    for (const fp of fans) if (fp.runIdx >= 0) tryCalc(fp.fb, fp.runIdx);
    runs.forEach((r, i) => { if (r.flowB === r.host) tryCalc(r.flowB, i); });
  }

  // ── Свободные концы — раструбы ────────────────────────────────────────
  interface End { run: Run; atStart: boolean; out: boolean }
  const ends: End[] = [];
  for (const run of runs) {
    for (const atStart of [true, false]) {
      const id = atStart ? run.host.fromId : run.host.toId;
      if ((atNode.get(id)?.length ?? 0) !== 1) continue;
      const out = run.Q > MIN_FLOW && (atStart ? run.sign < 0 : run.sign > 0);
      ends.push({ run, atStart, out });
    }
  }

  // ── Сборка геометрии ──────────────────────────────────────────────────
  const group = new THREE.Group();
  group.name = "mine-vent-pipe";
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const m4 = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const qTmp = new THREE.Quaternion();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  const makeMesh = (geom: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
    geoms.push(geom); mats.push(mat);
    const mesh = new THREE.InstancedMesh(geom, mat, Math.max(1, count));
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    meshes.push(mesh);
    group.add(mesh);
    return mesh;
  };

  // Стрелки внутри — тогда труба на просвет, иначе их не видно.
  interface Lane { run: Run; n: number; step: number; speed: number; first: number; color: number }
  const lanes: Lane[] = [];
  let arrowCount = 0;
  if (input.flowArrows !== false) {
    for (const run of runs) {
      if (!(run.Q > MIN_FLOW)) continue;
      const n = Math.max(1, Math.round(run.len / kx / ARROW_STEP));
      if (arrowCount + n > MAX_ARROWS) break;
      const speed = Math.max(1.5, Math.min(6, 1.5 + run.v * 0.25)) * kx * animK;
      const color = input.pollutedBranchIds?.has(run.flowB.id) ? ARROW_POLLUTED : ARROW_FRESH;
      lanes.push({ run, n, step: run.len / n, speed, first: arrowCount, color });
      arrowCount += n;
    }
  }

  // Труба
  const pipeGeom = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true);
  pipeGeom.rotateZ(-Math.PI / 2);
  pipeGeom.translate(0.5, 0, 0);
  const see = arrowCount > 0;
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 0.15, roughness: 0.6, side: THREE.DoubleSide,
    transparent: see, opacity: see ? 0.5 : 1, depthWrite: !see,
  });
  const pipeMesh = makeMesh(pipeGeom, pipeMat, runs.length);
  pipeMesh.renderOrder = 5;
  let totalLength = 0;
  runs.forEach((run, i) => {
    totalLength += run.len / kx;
    pt(run, 0, run.rc, run.u, tmpPos);
    tmpScale.set(run.len, run.R * kx, run.R * kx);
    m4.compose(tmpPos, run.q, tmpScale);
    pipeMesh.setMatrixAt(i, m4);
    pipeMesh.setColorAt(i, tmpColor.set(run.color));
  });

  // Кольца рукава и фланцы металла
  interface Mark { run: Run; s: number }
  const rings: Mark[] = [], flanges: Mark[] = [], hangers: Mark[] = [];
  for (const run of runs) {
    const realLen = run.len / kx;
    const list = run.metal ? flanges : rings;
    const step = run.metal ? FLANGE_STEP : RING_STEP;
    const n = Math.max(1, Math.floor(realLen / step));
    for (let k = 1; k <= n && list.length < MAX_RINGS; k++) list.push({ run, s: (k / (n + 1)) * run.len });
    const nh = Math.max(2, Math.floor(realLen / HANGER_STEP) + 1);
    for (let k = 0; k < nh && hangers.length < MAX_HANGERS; k++) {
      hangers.push({ run, s: ((k + 0.5) / nh) * run.len });
    }
  }
  if (rings.length > 0) {
    const ringGeom = new THREE.TorusGeometry(1, 0.06, 6, 22);
    ringGeom.rotateY(Math.PI / 2);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x7c5a16, roughness: 0.7 });
    const ringMesh = makeMesh(ringGeom, ringMat, rings.length);
    rings.forEach(({ run, s }, i) => {
      pt(run, s, run.rc, run.u, tmpPos);
      tmpScale.setScalar(run.R * 1.02 * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      ringMesh.setMatrixAt(i, m4);
    });
  }
  if (flanges.length > 0) {
    const flGeom = new THREE.CylinderGeometry(1, 1, 1, 18);
    flGeom.rotateZ(-Math.PI / 2);
    const flMat = new THREE.MeshStandardMaterial({ color: 0x5b6472, metalness: 0.6, roughness: 0.35 });
    const flMesh = makeMesh(flGeom, flMat, flanges.length);
    flanges.forEach(({ run, s }, i) => {
      pt(run, s, run.rc, run.u, tmpPos);
      tmpScale.set(0.05 * kx, run.R * 1.14 * kx, run.R * 1.14 * kx);
      m4.compose(tmpPos, run.q, tmpScale);
      flMesh.setMatrixAt(i, m4);
    });
  }

  // Подвесы до троса и сам трос под кровлей
  const fanRb = (run: Run) => run.R * 1.45 * Math.max(0.8, Math.min(1.6, Math.sqrt(sizeK)));
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.6, roughness: 0.4 });
  mats.push(steelMat);
  const boxGeom = new THREE.BoxGeometry(1, 1, 1);
  geoms.push(boxGeom);
  const hangerMesh = new THREE.InstancedMesh(boxGeom, steelMat, Math.max(1, hangers.length + fans.length * 2));
  hangerMesh.frustumCulled = false;
  meshes.push(hangerMesh); group.add(hangerMesh);
  let hi = 0;
  const hang = (run: Run, s: number, top: number) => {
    const hgt = run.roof - 0.04 - top;
    if (!(hgt > 0.02)) { hangerMesh.setMatrixAt(hi++, zero); return; }
    pt(run, s, run.rc, top + hgt / 2, tmpPos);
    tmpScale.set(0.025 * kx, hgt * kx, 0.025 * kx);
    m4.compose(tmpPos, run.q, tmpScale);
    hangerMesh.setMatrixAt(hi++, m4);
  };
  hangers.forEach(({ run, s }) => hang(run, s, run.u + run.R));

  const cableGeom = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  cableGeom.rotateZ(-Math.PI / 2);
  cableGeom.translate(0.5, 0, 0);
  geoms.push(cableGeom);
  const cableMesh = new THREE.InstancedMesh(cableGeom, steelMat, runs.length);
  cableMesh.frustumCulled = false;
  meshes.push(cableMesh); group.add(cableMesh);
  runs.forEach((run, i) => {
    pt(run, 0, run.rc, run.roof - 0.04, tmpPos);
    tmpScale.set(run.len, 0.012 * kx, 0.012 * kx);
    m4.compose(tmpPos, run.q, tmpScale);
    cableMesh.setMatrixAt(i, m4);
  });

  // Раструбы на свободных концах
  if (ends.length > 0) {
    const flareGeom = new THREE.CylinderGeometry(1.4, 1, 1, 20, 1, true);
    flareGeom.rotateZ(-Math.PI / 2);
    flareGeom.translate(0.5, 0, 0);
    const flareMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, side: THREE.DoubleSide });
    const flareMesh = makeMesh(flareGeom, flareMat, ends.length);
    ends.forEach(({ run, atStart }, i) => {
      pt(run, atStart ? 0 : run.len, run.rc, run.u, tmpPos);
      qTmp.copy(run.q);
      if (atStart) qTmp.multiply(qFlip);
      tmpScale.set(run.R * 0.9 * kx, run.R * kx, run.R * kx);
      m4.compose(tmpPos, qTmp, tmpScale);
      flareMesh.setMatrixAt(i, m4);
      flareMesh.setColorAt(i, tmpColor.set(run.color).multiplyScalar(0.85));
    });
  }

  // Стрелки воздуха
  let arrowMesh: THREE.InstancedMesh | null = null;
  if (arrowCount > 0) {
    const head = new THREE.ConeGeometry(1, 1.4, 12, 1, false);
    head.rotateZ(-Math.PI / 2);
    head.translate(0.7, 0, 0);
    const tail = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 10, 1, false);
    tail.rotateZ(-Math.PI / 2);
    tail.translate(-0.6, 0, 0);
    const arrowGeom = mergeGeometries([head, tail], false) ?? head;
    if (arrowGeom !== head) head.dispose();
    tail.dispose();
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.45, emissive: 0x330000, emissiveIntensity: 0.4,
    });
    arrowMesh = makeMesh(arrowGeom, arrowMat, arrowCount);
    arrowMesh.renderOrder = 4;
    for (const ln of lanes) for (let k = 0; k < ln.n; k++) arrowMesh.setColorAt(ln.first + k, tmpColor.set(ln.color));
  }

  // ── Модели ВМП ────────────────────────────────────────────────────────
  const rotors: { obj: THREE.Object3D; w: number }[] = [];
  const labels: TankLabel[] = [];
  if (fans.length > 0) {
    const bodyG = new THREE.CylinderGeometry(1, 1, 1, 26, 1, true);
    bodyG.rotateZ(-Math.PI / 2);
    const coneG = new THREE.CylinderGeometry(1, 0.69, 1, 26, 1, true);
    coneG.rotateZ(-Math.PI / 2);
    const motorG = new THREE.CylinderGeometry(1, 1, 1, 18);
    motorG.rotateZ(-Math.PI / 2);
    const bandG = new THREE.TorusGeometry(1, 0.05, 8, 32);
    bandG.rotateY(Math.PI / 2);
    const bladeParts: THREE.BufferGeometry[] = [new THREE.SphereGeometry(0.22, 14, 10)];
    for (let k = 0; k < 6; k++) {
      const bl = new THREE.BoxGeometry(0.06, 0.78, 0.3);
      bl.translate(0, 0.5, 0);
      bl.rotateY(0.5);
      bl.rotateX((k * Math.PI * 2) / 6);
      bladeParts.push(bl);
    }
    const rotorG = mergeGeometries(bladeParts, false) ?? bladeParts[0];
    bladeParts.forEach(g => { if (g !== rotorG) g.dispose(); });
    geoms.push(bodyG, coneG, motorG, bandG, rotorG);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: FAN_BODY, metalness: 0.4, roughness: 0.4,
      transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide,
    });
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7, roughness: 0.3 });
    const rotorStop = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.3, roughness: 0.7 });
    const motorMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.5, roughness: 0.5 });
    const bandOn = new THREE.MeshStandardMaterial({ color: FAN_BAND, emissive: FAN_BAND, emissiveIntensity: 0.35 });
    const bandOff = new THREE.MeshStandardMaterial({ color: FAN_OFF });
    mats.push(bodyMat, rotorMat, rotorStop, motorMat, bandOn, bandOff);

    for (const fp of fans) {
      const { run, s, sign, fb } = fp;
      const Rb = fanRb(run);
      const L = Rb * 3;
      const cl = Rb * 1.1;
      const stopped = !!fb.fanStopped;
      const g = new THREE.Group();
      pt(run, s, run.rc, run.u, g.position);
      g.quaternion.copy(run.q);
      if (sign < 0) g.quaternion.multiply(qFlip);
      g.scale.setScalar(kx);

      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, sx: number, sy: number, order = 3) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, 0, 0);
        m.scale.set(sx, sy, sy);
        m.frustumCulled = false;
        m.renderOrder = order;
        g.add(m);
        return m;
      };
      add(motorG, motorMat, L * 0.2, L * 0.35, Rb * 0.42);
      const rotor = add(rotorG, stopped ? rotorStop : rotorMat, -L * 0.15, Rb * 0.92, Rb * 0.92);
      rotor.scale.setScalar(Rb * 0.92);
      add(bandG, stopped ? bandOff : bandOn, 0, Rb * 1.02, Rb * 1.02);
      add(bodyG, bodyMat, 0, L, Rb, 6);
      add(coneG, bodyMat, -L / 2 - cl / 2, cl, Rb, 6);
      add(coneG, bodyMat, L / 2 + cl / 2, -cl, Rb, 6);
      group.add(g);

      const rpm = Math.max(0, fb.fanRpm ?? 0) || 2900;
      const w = stopped ? 0 : Math.max(2, Math.min(9, 1.5 * Math.log(rpm / 100))) * animK;
      rotors.push({ obj: rotor, w });

      hang(run, s - (L * 0.3) * kx, run.u + Rb);
      hang(run, s + (L * 0.3) * kx, run.u + Rb);

      const Q = Math.abs(fb.flow ?? 0);
      const lines: string[] = [];
      let warn = false;
      if (stopped) { lines.push("Остановлен"); warn = true; }
      else if (Q > MIN_FLOW) {
        lines.push(`Q = ${fmt(Q)} м³/с`);
        if ((fb.fanPressure ?? 0) > 0) lines.push(`H = ${fmt(fb.fanPressure, 0)} Па`);
        const dv = delivByComp.get(find(fp.runIdx));
        const cq = compQ.get(find(fp.runIdx));
        if (dv) {
          lines.push(`В забой: ${fmt(dv.flowFace)} м³/с · Kдост = ${fmt(dv.delivery)}`);
          if (dv.flowShort) { lines.push(`Нужно ${fmt(dv.required)} м³/с — не хватает`); warn = true; }
        } else if (cq && cq.qin > 0 && isFinite(cq.qout) && cq.qin - cq.qout > 1e-3) {
          lines.push(`До конца става: ${fmt(cq.qout)} м³/с`);
          lines.push(`Kдост = ${fmt(cq.qout / cq.qin)} · утечки ${fmt(cq.qin - cq.qout)} м³/с`);
        }
      } else { lines.push("Расчёт не выполнен"); warn = true; }
      labels.push({
        id: `vmp:${fb.id}`,
        pos: pt(run, s, run.rc, run.u + Rb + 0.25, new THREE.Vector3()),
        title: fb.fanName ? `ВМП ${fb.fanName}` : "ВМП",
        lines, warn,
      });
    }
  }

  // Подписи на выходе става — сколько воздуха дошло
  for (const e of ends) {
    if (!e.out) continue;
    const { run } = e;
    const dv = delivByComp.get(find(runs.indexOf(run)));
    const lines: string[] = [];
    let warn = false;
    if (dv) {
      lines.push(`Q забой = ${fmt(dv.flowFace)} м³/с (вент. ${fmt(dv.flowFan)})`);
      lines.push(`Kдост = ${fmt(dv.delivery)} · утечки ${fmt(dv.leakagePercent, 0)} %`);
      lines.push(`v выхода = ${fmt(dv.velocityFace, 1)} м/с`);
      if (dv.required > 0) {
        lines.push(`Требуется: ${fmt(dv.required)} м³/с${dv.flowShort ? " — не хватает" : ""}`);
        if (dv.flowShort) warn = true;
      }
      if (dv.maxLength != null) {
        const by = dv.limitedBy === "pressure" ? " (по давлению)" : dv.limitedBy === "flow" ? " (по расходу)" : "";
        if (dv.maxLength <= 0) {
          lines.push("Lпред: расход недостижим");
          warn = true;
        } else {
          lines.push(`Lпред = ${fmt(dv.maxLength, 0)} м${by}`);
          const r = dv.reserve ?? 0;
          lines.push(r >= 0
            ? `Запас: ${fmt(r, 0)} м (став ${fmt(dv.length, 0)} м)`
            : `Став длиннее предела на ${fmt(-r, 0)} м`);
          if (r < 0) warn = true;
        }
      } else {
        lines.push("Lпред: не задан требуемый расход");
      }
      if (dv.overPressure) { lines.push("Депрессия выше паспорта рукава"); warn = true; }
    } else {
      lines.push(`Q = ${fmt(run.Q)} м³/с`, `v = ${fmt(run.v, 1)} м/с`);
      const cq = compQ.get(find(runs.indexOf(run)));
      if (cq && cq.qin - cq.qout > 1e-3) lines.push(`Утечки: ${fmt(cq.qin - cq.qout)} м³/с`);
    }
    if (run.v > 0 && run.v < 0.25) { lines.push("Скорость ниже 0,25 м/с"); warn = true; }
    labels.push({
      id: `vpend:${run.flowB.id}:${e.atStart ? 0 : 1}`,
      pos: pt(run, e.atStart ? 0 : run.len, run.rc, run.u + run.R + 0.2, new THREE.Vector3()),
      title: "Выход става",
      lines, warn,
    });
  }

  const qArrow = new THREE.Quaternion();
  const setTime = (t: number) => {
    for (const r of rotors) if (r.w !== 0) r.obj.rotation.x = (r.w * t) % (Math.PI * 2);
    if (!arrowMesh) return;
    for (const ln of lanes) {
      const { run } = ln;
      const aR = run.R * 0.55 * kx;
      const half = aR * 1.4;
      const span = Math.max(1e-6, run.len - 2 * half);
      qArrow.copy(run.q);
      if (run.sign < 0) qArrow.multiply(qFlip);
      for (let k = 0; k < ln.n; k++) {
        let d = (k * ln.step + t * ln.speed) % run.len;
        if (d < 0) d += run.len;
        const along = run.sign > 0 ? d : run.len - d;
        pt(run, half + (along / run.len) * span, run.rc, run.u, tmpPos);
        const edge = Math.min(d, run.len - d) / Math.max(1e-6, Math.min(run.len / 2, 1.5 * kx));
        tmpScale.setScalar(aR * Math.min(1, Math.max(0.05, edge)));
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
    rotors.length = 0;
    meshes.forEach(m => m.dispose());
    geoms.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
  };

  return {
    group, dispose, setTime,
    hasMotion: arrowCount > 0 || rotors.some(r => r.w !== 0),
    labels,
    pipeCount: runs.length,
    totalLength,
    fanCount: fans.length,
    drawCalls: meshes.length + fans.length * 6,
  };
}
