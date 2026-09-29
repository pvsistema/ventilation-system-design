// ─────────────────────────────────────────────────────────────────────────────
// mineFire.ts — ПОЖАР В ОБЪЁМЕ (режим «Модель»).
//
// После расчёта пожара на чертеже видно ЧТО получилось: какие выработки
// задымлены и к какой минуте. В объёме показываем, КАК это происходит:
//
//   • ОЧАГ. Горящая техника (ПДМ/самосвал) стоит на почве выработки в точке
//     очага. Возгорание начинается в моторном отсеке (корма машины) маленьким
//     пламенем, затем огонь охватывает всю машину, корпус обугливается.
//     Пламя отклоняется по струе — тем сильнее, чем выше скорость воздуха.
//   • ЗАДЫМЛЕНИЕ. Дым от очага поднимается под кровлю и уходит ПО СТРУЕ.
//     Фронт дыма в каждой выработке — ровно тот, что посчитан для чертежа
//     на текущей минуте шкалы задымления (branchFireColors: fromT…toT), цвет
//     (плотность) — по уровню опасности. Дым держится у кровли: горячие
//     продукты горения легче воздуха и стратифицируются.
//   • СВЕТ. У очага — мерцающий оранжевый источник света: стенки выработки
//     вокруг пожара подсвечены, как в натуре.
//
// Время развития берётся со шкалы задымления (минуты). Если шкала не
// запущена, возгорание разыгрывается один раз в реальном времени (≈8 с),
// чтобы начало пожара было видно сразу после перехода в объём.
//
// Частицы считает видеокарта (шейдеры): процессор каждый кадр передаёт
// одно число — время. Поэтому тысячи частиц дыма не нагружают программу.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { sectionOutline } from "@/lib/tube3d";
import { isFireVehicleSymbol } from "@/lib/schemaSymbols";
import { arrowSpeedMps } from "@/lib/flowAnim";
import { toThree, branchSectionQuaternion } from "./mineScene";

/** Сегмент задымления выработки — тот же, что рисуется на чертеже. */
export type SmokeSegment = { color: string; fromT: number; toT: number };

export interface FireInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  symbols?: SchemaSymbol[];
  xyScale: number;
  zScale: number;
  /** Задымление по выработкам на текущей минуте (как на чертеже). */
  smoke?: Map<string, SmokeSegment>;
  /** Минута со шкалы задымления; null — шкала не запущена. */
  timeMin: number | null;
  animSpeed?: number;
}

export interface MineFire {
  group: THREE.Group;
  /** Время анимации, с (общие часы схемы) и масштаб «пикселей на единицу». */
  setTime(seconds: number, pxPerUnit: number): void;
  dispose(): void;
  /** Сколько очагов в сцене. */
  fires: number;
  /** Сколько частиц дыма. */
  smokeParticles: number;
  /** Текущая интенсивность (0…1) — для подписи в панели. */
  intensity(): number;
}

const MAX_SMOKE = 12000;
const FLAME_PARTICLES = 520;
/** За сколько минут пожар техники выходит на полную мощность. */
const GROWTH_MIN = 6;
/** Длительность «показательного» возгорания без шкалы, с. */
const DEMO_RAMP_S = 8;

/** Интенсивность пожара по минуте развития: 0,12 — возгорание, 1 — развитый. */
function growth(tMin: number): number {
  const k = Math.min(1, Math.max(0, tMin / GROWTH_MIN));
  return 0.12 + 0.88 * Math.pow(k, 1.4);
}

function outlineBox(pts: { r: number; u: number }[]) {
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity;
  for (const p of pts) {
    r0 = Math.min(r0, p.r); r1 = Math.max(r1, p.r);
    u0 = Math.min(u0, p.u); u1 = Math.max(u1, p.u);
  }
  if (!isFinite(r0)) return { w: 4, h: 3, u0: -1.5, u1: 1.5 };
  return { w: r1 - r0, h: u1 - u0, u0, u1 };
}

/** Тёмность дыма по цвету чертежа: чёрный → 1, светло-серый → 0. */
function darknessOf(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.6;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return Math.max(0, Math.min(1, 1 - lum));
}

// ── Шейдеры ──────────────────────────────────────────────────────────────────

const FLAME_VS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uInt;
uniform float uH;
uniform float uW;
uniform float uFloor;
uniform float uLean;
uniform float uBaseX;
uniform float uSize;
uniform float uPx;
uniform float uKx;
varying float vLife;
void main() {
  float life = fract(aSeed.x + uTime * (0.9 + aSeed.w * 0.7));
  float h = uH * (0.35 + 0.65 * uInt);
  float r = aSeed.z * uW * 0.5 * (1.0 - life * 0.75) * (0.3 + 0.7 * uInt);
  float ang = aSeed.y + uTime * 1.7 * (aSeed.x - 0.5);
  vec3 p;
  p.y = uFloor + life * h;
  p.x = uBaseX * (1.0 - uInt) + cos(ang) * r + life * life * uLean
      + sin(uTime * 7.0 + aSeed.x * 40.0) * 0.07 * h * life;
  p.z = sin(ang) * r * 0.8;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp((0.35 + 0.65 * (1.0 - life)) * uSize * uKx * uPx, 1.5, 256.0);
  vLife = life;
}`;

const FLAME_FS = /* glsl */ `
varying float vLife;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float soft = 1.0 - d * d;
  vec3 col = mix(vec3(1.0, 0.96, 0.65), vec3(1.0, 0.48, 0.05), smoothstep(0.0, 0.45, vLife));
  col = mix(col, vec3(0.6, 0.08, 0.02), smoothstep(0.45, 1.0, vLife));
  float a = soft * (1.0 - vLife) * 0.9;
  gl_FragColor = vec4(col, a);
}`;

const SMOKE_VS = /* glsl */ `
attribute vec3 aEnd;
attribute vec3 aRight;
attribute vec3 aUp;
attribute vec4 aSeed;
uniform float uTime;
uniform float uPx;
varying float vA;
varying float vDark;
void main() {
  float s = fract(aSeed.x + uTime * aSeed.y);
  vec3 p = mix(position, aEnd, s);
  float h1 = fract(aSeed.x * 7.13);
  float h2 = fract(aSeed.x * 3.71);
  float wob = sin(uTime * 0.8 + aSeed.x * 50.0);
  p += aRight * ((h2 * 2.0 - 1.0) * 0.75 + wob * 0.08);
  p += aUp * (0.1 + 0.8 * h1 + 0.06 * sin(uTime * 0.6 + aSeed.x * 30.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(aSeed.w * uPx * (0.8 + 0.5 * h2), 2.0, 256.0);
  vA = smoothstep(0.0, 0.06, s) * smoothstep(1.0, 0.92, s);
  vDark = aSeed.z;
}`;

const SMOKE_FS = /* glsl */ `
uniform float uOpacity;
varying float vA;
varying float vDark;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a = (1.0 - d) * (1.0 - d) * 0.5 * vA * uOpacity;
  vec3 col = mix(vec3(0.62), vec3(0.1), vDark);
  gl_FragColor = vec4(col, a);
}`;

// ── Горящая техника ─────────────────────────────────────────────────────────

/** Материал машины: glow — насколько светится от огня, charK — насколько обугливается. */
interface VehicleMat {
  m: THREE.MeshLambertMaterial;
  glow: number;
  base: THREE.Color;
  charK: number;
}

interface VehicleParts {
  group: THREE.Group;
  parts: VehicleMat[];
  /** Длина, ширина, высота машины в метрах (после вписывания в сечение). */
  L: number; W: number; H: number;
}

/**
 * Погрузочно-доставочная машина (ПДМ): ковш спереди, кабина, моторный отсек
 * сзади, четыре колеса. Местные оси: X — вдоль выработки, Y — вверх, Z — вбок.
 * Низ колёс — на y = 0 (почва).
 */
function buildVehicle(maxW: number, maxH: number, geoms: THREE.BufferGeometry[]): VehicleParts {
  const L0 = 9.5, W0 = 2.6, H0 = 2.5;
  const s = Math.max(0.25, Math.min(1, (maxW * 0.72) / W0, (maxH * 0.7) / H0));
  const L = L0 * s, W = W0 * s, H = H0 * s;

  const g = new THREE.Group();
  const parts: VehicleMat[] = [];
  const mk = (color: number, glow: number, charK: number) => {
    const m = new THREE.MeshLambertMaterial({ color, emissive: 0xff5a10, emissiveIntensity: 0 });
    parts.push({ m, glow, base: new THREE.Color(color), charK });
    return m;
  };
  // Окраска ПДМ: жёлтый корпус, чёрные шины, серые диски/ковш, тёмная рама.
  const yellow = mk(0xf2b31b, 0.06, 0.55);
  const engine = mk(0xe8a317, 0.35, 0.8);     // моторный отсек — очаг, сильнее светится
  const frame = mk(0x2a2d31, 0.02, 0.2);
  const steel = mk(0x6b7076, 0.03, 0.4);      // ковш, стрела
  const tire = mk(0x111111, 0, 0);            // шины — чёрные, не светятся
  const rim = mk(0x9aa0a6, 0.02, 0.5);
  const glass = mk(0x86b6c8, 0.12, 0.6);
  const lamp = mk(0xfff3c0, 0.05, 0.3);
  const stripe = mk(0x1b1b1b, 0, 0);          // чёрно-жёлтые полосы на бампере

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    geoms.push(geo);
    return m;
  };

  const wheelR = 0.62 * s;
  const tireW = W * 0.22;
  const bodyY = wheelR * 0.95;
  // Рама (тёмная), видна между колёсами
  add(new THREE.BoxGeometry(L * 0.84, H * 0.12, W * 0.5), frame, -L * 0.02, bodyY);
  // Задняя полурама — корпус над задним мостом
  add(new THREE.BoxGeometry(L * 0.4, H * 0.2, W * 0.9), yellow, -L * 0.27, bodyY + H * 0.14);
  // Моторный отсек (корма, -X) — здесь начинается возгорание
  add(new THREE.BoxGeometry(L * 0.3, H * 0.3, W * 0.78), engine, -L * 0.3, bodyY + H * 0.39);
  // Решётка радиатора на корме
  add(new THREE.BoxGeometry(L * 0.015, H * 0.24, W * 0.6), frame, -L * 0.455, bodyY + H * 0.37);
  // Задний бампер с полосами
  add(new THREE.BoxGeometry(L * 0.03, H * 0.1, W * 0.92), stripe, -L * 0.47, bodyY + H * 0.1);
  // Шарнир сочленения
  add(new THREE.BoxGeometry(L * 0.06, H * 0.14, W * 0.3), frame, -L * 0.04, bodyY + H * 0.08);
  // Передняя полурама
  add(new THREE.BoxGeometry(L * 0.34, H * 0.18, W * 0.86), yellow, L * 0.16, bodyY + H * 0.12);
  // Кабина оператора (сбоку, посередине машины)
  add(new THREE.BoxGeometry(L * 0.14, H * 0.3, W * 0.36), yellow, -L * 0.05, bodyY + H * 0.36, W * 0.24);
  add(new THREE.BoxGeometry(L * 0.145, H * 0.14, W * 0.365), glass, -L * 0.05, bodyY + H * 0.44, W * 0.24);
  // Защитная крыша кабины (ROPS)
  add(new THREE.BoxGeometry(L * 0.18, H * 0.04, W * 0.42), frame, -L * 0.05, bodyY + H * 0.54, W * 0.24);
  for (const dx of [-L * 0.08, L * 0.02]) {
    add(new THREE.BoxGeometry(L * 0.012, H * 0.2, W * 0.02), frame, dx - L * 0.01, bodyY + H * 0.44, W * 0.43);
  }
  // Фары
  for (const z of [-W * 0.3, W * 0.3]) {
    add(new THREE.BoxGeometry(L * 0.01, H * 0.05, W * 0.08), lamp, L * 0.335, bodyY + H * 0.2, z);
  }
  // Стрела и ковш (нос, +X) — сталь
  for (const z of [-W * 0.28, W * 0.28]) {
    add(new THREE.BoxGeometry(L * 0.2, H * 0.07, W * 0.08), steel, L * 0.36, bodyY + H * 0.16, z);
  }
  add(new THREE.BoxGeometry(L * 0.13, H * 0.05, W * 0.98), steel, L * 0.45, H * 0.04);        // днище ковша
  add(new THREE.BoxGeometry(L * 0.02, H * 0.32, W * 0.98), steel, L * 0.39, H * 0.2);         // задняя стенка
  for (const z of [-W * 0.48, W * 0.48]) {
    add(new THREE.BoxGeometry(L * 0.13, H * 0.26, W * 0.02), steel, L * 0.45, H * 0.16, z);   // щёки
  }
  add(new THREE.BoxGeometry(L * 0.02, H * 0.03, W * 0.98), frame, L * 0.515, H * 0.03);       // режущая кромка
  // Колёса: чёрная шина + серый диск + ступица
  const wg = new THREE.CylinderGeometry(wheelR, wheelR, tireW, 20);
  wg.rotateX(Math.PI / 2);
  const rg = new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, tireW * 1.04, 16);
  rg.rotateX(Math.PI / 2);
  const hg = new THREE.CylinderGeometry(wheelR * 0.2, wheelR * 0.2, tireW * 1.12, 10);
  hg.rotateX(Math.PI / 2);
  geoms.push(wg, rg, hg);
  for (const x of [-L * 0.3, L * 0.2]) {
    for (const z of [-W * 0.4, W * 0.4]) {
      for (const [geo, mat] of [[wg, tire], [rg, rim], [hg, frame]] as const) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, wheelR, z);
        g.add(m);
      }
    }
  }
  return { group: g, parts, L, W, H };
}

// ── Сборка слоя ──────────────────────────────────────────────────────────────

export function buildMineFire(input: FireInput): MineFire | null {
  const { nodes, branches, xyScale, zScale } = input;
  const fireBranches = branches.filter(b => b.hasFire);
  if (fireBranches.length === 0) return null;

  const kx = xyScale > 0 ? xyScale : 1;
  const kz = zScale > 0 ? zScale : 1;
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const branchById = new Map(branches.map(b => [b.id, b]));
  const syms = input.symbols ?? [];

  const group = new THREE.Group();
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  /** Точки выработки в сцене. */
  const ends = (b: TopoBranch) => {
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) return null;
    if (![fn.x, fn.y, fn.z, tn.x, tn.y, tn.z].every(Number.isFinite)) return null;
    const a = toThree(fn.x * kx, fn.y * kx, fn.z * kz);
    const c = toThree(tn.x * kx, tn.y * kx, tn.z * kz);
    const dir = new THREE.Vector3().subVectors(c, a);
    const len = dir.length();
    if (!(len > 1e-6)) return null;
    dir.divideScalar(len);
    return { a, c, dir, len };
  };

  // Интенсивность: по шкале или показательное возгорание в реальном времени.
  const t0 = performance.now();
  const intensityNow = () => input.timeMin != null
    ? growth(input.timeMin)
    : growth(Math.min(1, (performance.now() - t0) / 1000 / DEMO_RAMP_S) * GROWTH_MIN);

  interface FireObj {
    flameU: Record<string, THREE.IUniform>;
    light: THREE.PointLight;
    parts: VehicleMat[];
    hasVehicle: boolean;
  }
  const fires: FireObj[] = [];

  // Сегменты дыма: из шкалы (как на чертеже) + собственный шлейф у очага.
  interface Seg { b: TopoBranch; fromT: number; toT: number; dark: number; plume?: boolean }
  const segs: Seg[] = [];

  for (const b of fireBranches) {
    const e = ends(b);
    if (!e) continue;
    const box = outlineBox(sectionOutline(b));
    const vehSym = syms.find(s => s.branchId === b.id && isFireVehicleSymbol(s));
    const fireSym = syms.find(s => s.branchId === b.id && s.typeId === "fire_source");
    const t = Math.max(0, Math.min(1, vehSym?.t ?? fireSym?.t ?? b.fireT ?? 0.5));
    const isVehicle = (b.fireCombustible ?? "") === "vehicle";

    const pos = new THREE.Vector3().lerpVectors(e.a, e.c, t);
    const fg = new THREE.Group();
    fg.position.copy(pos);
    fg.quaternion.copy(branchSectionQuaternion(e.dir));
    fg.scale.set(kx, kx, kx);
    group.add(fg);

    // Направление струи вдоль оси X ветви (+ — от начала к концу).
    const flowSign = (b.flow ?? 0) < 0 ? -1 : 1;
    const v = Math.abs(b.velocity ?? 0);

    let parts: VehicleMat[] = [];
    let flameFloor = box.u0 + 0.1;
    let flameW = Math.min(box.w * 0.6, 2.5);
    let baseX = 0;
    if (isVehicle) {
      const veh = buildVehicle(box.w, box.h, geoms);
      veh.group.position.set(0, box.u0, 0);
      // Нос машины — по струе: так ПДМ обычно и стоит в выработке.
      if (flowSign < 0) veh.group.rotation.y = Math.PI;
      fg.add(veh.group);
      parts = veh.parts;
      mats.push(...veh.parts.map(p => p.m));
      flameFloor = box.u0 + veh.H * 0.55;
      flameW = veh.W * 0.95;
      // Возгорание — в моторном отсеке (корма, против струи).
      baseX = -flowSign * veh.L * 0.32;
    }

    // Пламя
    const n = FLAME_PARTICLES;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random() * Math.PI * 2;
      seed[i * 4 + 2] = Math.sqrt(Math.random());
      seed[i * 4 + 3] = Math.random();
    }
    pg.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    geoms.push(pg);
    const roomH = Math.max(0.5, box.u1 - flameFloor) * 0.95;
    const flameU: Record<string, THREE.IUniform> = {
      uTime: { value: 0 }, uInt: { value: 0.12 },
      uH: { value: roomH }, uW: { value: flameW }, uFloor: { value: flameFloor },
      // Отклонение пламени по струе: при 2 м/с и выше — почти к кровле вдоль потока.
      uLean: { value: flowSign * Math.min(1.6, v / 1.5) * roomH * 0.7 },
      uBaseX: { value: baseX },
      uSize: { value: Math.max(0.35, Math.min(box.w, box.h) * 0.22) },
      uPx: { value: 1 }, uKx: { value: kx },
    };
    const fm = new THREE.ShaderMaterial({
      uniforms: flameU, vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    mats.push(fm);
    const pts = new THREE.Points(pg, fm);
    pts.frustumCulled = false;
    pts.renderOrder = 8;
    fg.add(pts);

    // Свет пожара: освещает стенки выработки вокруг очага.
    const light = new THREE.PointLight(0xff7a1a, 0, Math.max(box.w, box.h) * 12 * kx, 0);
    light.position.set(0, flameFloor + roomH * 0.4, 0);
    fg.add(light);

    fires.push({ flameU, light, parts, hasVehicle: isVehicle });

    // Шлейф дыма у очага: подъём под кровлю и уход по струе на 10 высот.
    const plumeLen = Math.min(1, (box.h * 10 * kx) / e.len);
    segs.push(flowSign > 0
      ? { b, fromT: t, toT: Math.min(1, t + plumeLen), dark: 0.85, plume: true }
      : { b, fromT: Math.max(0, t - plumeLen), toT: t, dark: 0.85, plume: true });
  }

  if (input.smoke) {
    for (const [bid, s] of input.smoke) {
      const b = branchById.get(bid);
      if (!b || !(s.toT > s.fromT)) continue;
      segs.push({ b, fromT: s.fromT, toT: s.toT, dark: darknessOf(s.color) });
    }
  }

  // ── Дым: одна система частиц на всю схему ──────────────────────────────
  interface Pt { start: THREE.Vector3; end: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; seed: number; speed: number; dark: number; size: number }
  const ptsArr: Pt[] = [];
  const upV = new THREE.Vector3(), rightV = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (const sg of segs) {
    if (ptsArr.length >= MAX_SMOKE) break;
    const e = ends(sg.b);
    if (!e) continue;
    const box = outlineBox(sectionOutline(sg.b));
    branchSectionQuaternion(e.dir, q);
    upV.set(0, 1, 0).applyQuaternion(q);
    rightV.set(0, 0, 1).applyQuaternion(q);
    const flowSign = (sg.b.flow ?? 0) < 0 ? -1 : 1;
    const pA = new THREE.Vector3().lerpVectors(e.a, e.c, sg.fromT);
    const pB = new THREE.Vector3().lerpVectors(e.a, e.c, sg.toT);
    const [start, end] = flowSign > 0 ? [pA, pB] : [pB, pA];
    const segLen = start.distanceTo(end);
    if (!(segLen > 1e-3)) continue;
    const secW = Math.max(0.5, box.w) * kx;
    const spacing = Math.max(0.6 * kx, Math.min(box.w, box.h) * kx * 0.35);
    const cnt = Math.min(sg.plume ? 900 : 700, Math.max(12, Math.round((segLen / spacing) * 3)), MAX_SMOKE - ptsArr.length);
    const speedW = arrowSpeedMps(sg.b.velocity, input.animSpeed) * kx * 0.5;
    const speed = speedW / segLen;
    // Центр сечения — ось выработки; «вверх» — от оси до кровли, дым у кровли.
    const upOff = upV.clone().multiplyScalar(Math.max(0.3, box.u1) * 0.9 * kx);
    const baseUp = upV.clone().multiplyScalar(box.u0 * 0.4 * kx);
    const right = rightV.clone().multiplyScalar(secW * 0.45);
    const size = Math.max(0.8, Math.min(box.w, box.h) * 0.55) * kx;
    for (let i = 0; i < cnt; i++) {
      ptsArr.push({
        start: start.clone().add(baseUp), end: end.clone().add(baseUp),
        right, up: upOff, seed: Math.random(), speed, dark: sg.dark, size,
      });
    }
  }

  const smokeU: Record<string, THREE.IUniform> = {
    uTime: { value: 0 }, uPx: { value: 1 }, uOpacity: { value: 1 },
  };
  if (ptsArr.length > 0) {
    const N = ptsArr.length;
    const pos = new Float32Array(N * 3), end = new Float32Array(N * 3);
    const rgt = new Float32Array(N * 3), up = new Float32Array(N * 3);
    const sd = new Float32Array(N * 4);
    ptsArr.forEach((p, i) => {
      pos.set([p.start.x, p.start.y, p.start.z], i * 3);
      end.set([p.end.x, p.end.y, p.end.z], i * 3);
      rgt.set([p.right.x, p.right.y, p.right.z], i * 3);
      up.set([p.up.x, p.up.y, p.up.z], i * 3);
      sd.set([p.seed, p.speed, p.dark, p.size], i * 4);
    });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("aEnd", new THREE.BufferAttribute(end, 3));
    sg.setAttribute("aRight", new THREE.BufferAttribute(rgt, 3));
    sg.setAttribute("aUp", new THREE.BufferAttribute(up, 3));
    sg.setAttribute("aSeed", new THREE.BufferAttribute(sd, 4));
    geoms.push(sg);
    const sm = new THREE.ShaderMaterial({
      uniforms: smokeU, vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS,
      transparent: true, depthWrite: false,
    });
    mats.push(sm);
    const sp = new THREE.Points(sg, sm);
    sp.frustumCulled = false;
    sp.renderOrder = 7;
    group.add(sp);
  }

  const charColor = new THREE.Color(0x1d1d1d);

  const setTime = (seconds: number, pxPerUnit: number) => {
    const I = intensityNow();
    const flicker = 0.82 + 0.18 * Math.sin(seconds * 13.1) * Math.sin(seconds * 7.3 + 1.1);
    for (const f of fires) {
      f.flameU.uTime.value = seconds;
      f.flameU.uInt.value = I;
      f.flameU.uPx.value = pxPerUnit;
      f.light.intensity = (0.6 + 2.6 * I) * flicker;
      // Корпус обугливается по мере развития пожара и светится изнутри.
      for (const p of f.parts) {
        p.m.emissiveIntensity = p.glow * (0.3 + 0.7 * I) * flicker;
        p.m.color.copy(p.base).lerp(charColor, Math.min(1, I * p.charK));
      }
    }
    smokeU.uTime.value = seconds;
    smokeU.uPx.value = pxPerUnit;
    // Шлейф у очага густеет вместе с пожаром; дальний фронт — как на шкале.
    smokeU.uOpacity.value = 0.45 + 0.55 * I;
  };

  const dispose = () => {
    geoms.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
  };

  return {
    group, setTime, dispose,
    fires: fires.length,
    smokeParticles: ptsArr.length,
    intensity: intensityNow,
  };
}