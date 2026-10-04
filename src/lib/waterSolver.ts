// ─────────────────────────────────────────────────────────────────────────────
// Сетевой гидравлический расчёт водопровода ППЗ — глобальный градиентный метод
// (Todini–Pilati, как в EPANET). Точная копия backend/water-hydraulics/solver.py:
// браузер (проверка ППЗ) и сервер обязаны давать одинаковые цифры.
//
//   • Неизвестные — пьезометрический напор узлов H (МПа, H = P + ρ·g·z) и
//     расходы в связях q (м³/с, знак относительно from→to).
//   • Резервуар — источник с заданным напором и обратным клапаном (только отдаёт).
//   • Открытый кран — истечение в атмосферу через насадок: P = R·Q².
//   • Труба — Дарси–Вейсбах, λ по режиму: ламинарный 64/Re, переходный —
//     интерполяция, турбулентный — Альтшуль 0.11·(Δ/d + 68/Re)^0.25.
//   • Насос — прирост напора по направлению качания (с обратным клапаном).
//   • Редуктор — дросселирует до уставки давления за собой.
// Выполняются оба закона Кирхгофа: развилки и кольца считаются честно.
// ─────────────────────────────────────────────────────────────────────────────

import { type TopoNode, type TopoBranch, surveyXYZ } from "@/lib/topology";

const RHO = 1000;
const G = 9.81;
const NU = 1.31e-6;
const RHO_G_MPA = (RHO * G) / 1e6;
const NOZZLE_MU = 0.92; // конический насадок пожарного ствола (по паспортам РС-50/РС-70)
export const SMOOTH_ROUGHNESS_MM = 0.03;
const RE_LAM = 2000;
const RE_TURB = 4000;
const MIN_PIPE_LEN = 1;
const Q_REG = 1e-4;
const C_CLOSED = 1e-8;
const MAX_ITER = 120;
const SOURCE_R = 1e-3;

/** Материалы, для которых «по материалу» = формула Шевелёва (как в «Аэросети»). */
export const SHEVELEV_MATERIALS = new Set(["Сталь", "Чугун", "Прочее"]);

/** λ = 0.021 / d^0.3 — стальные и чугунные трубы в эксплуатации (Шевелёв). */
export const shevelevLambda = (dM: number): number => 0.021 / dM ** 0.3;

export function usesShevelev(b: Partial<TopoBranch>): boolean {
  const mode = b.wpRoughnessMode ?? "shevelev";
  return mode === "shevelev" || (mode === "material" && SHEVELEV_MATERIALS.has(b.wpMaterial ?? "Сталь"));
}

/** Эквивалентная шероховатость Δ, мм — для труб, бывших в эксплуатации. */
export const MATERIAL_ROUGHNESS_MM: Record<string, number> = {
  "Сталь": 0.5,
  "Чугун": 1.0,
  "Полиэтилен": 0.02,
  "ПВХ": 0.02,
  "Асбестоцемент": 0.6,
  "Прочее": 0.5,
};

const num = (x: unknown, def = 0): number => {
  const v = Number(x);
  return Number.isFinite(v) ? v : def;
};

const nodeZ = (n?: TopoNode): number => (n ? num(surveyXYZ(n).z, 0) : 0);

/** Внутренний диаметр трубы, мм: при наружном вычитаем две толщины стенки. */
export function pipeInnerDiameterMm(b: Partial<TopoBranch>): number {
  let d = num(b.wpDiameter, 100) || 100;
  if ((b.wpDiameterKind ?? "inner") === "outer") d -= 2 * Math.max(0, num(b.wpWallThickness, 0));
  return d > 1 ? d : 1;
}

/** Расчётная шероховатость трубы, мм. */
export function pipeRoughnessMm(b: Partial<TopoBranch>): number {
  const mode = b.wpRoughnessMode ?? "rough";
  if (mode === "smooth") return SMOOTH_ROUGHNESS_MM;
  if (mode === "material") return MATERIAL_ROUGHNESS_MM[b.wpMaterial ?? "Сталь"] ?? 0.5;
  return Math.max(0, num(b.wpRoughness, 0.5));
}

const pipeLengthM = (b: TopoBranch): number =>
  Math.max(0, num(b.wpLengthManual ? b.wpLength : b.length, 0));

export function nozzleResistance(diamMm: number, mu = NOZZLE_MU): number {
  if (diamMm <= 0) return 0;
  const d = diamMm / 1000;
  const a = (Math.PI * d * d) / 4;
  return RHO / (2 * (mu * a) ** 2) / 1e6;
}

export function consumerResistance(n: TopoNode): number {
  if ((n.fireResistanceMode ?? "project") === "project") return nozzleResistance(num(n.fireHydrantDiameter, 0));
  return Math.max(0, num(n.fireManualR, 0));
}

// ─── Модель трубы ──────────────────────────────────────────────────────────────
class Pipe {
  d: number; A: number; L: number; e: number; xi: number; K: number; C1: number;
  manualR: number | null = null; lamA: number; lamB: number;

  constructor(b: TopoBranch) {
    if ((b.wpRoughnessMode ?? "rough") === "manual") this.manualR = Math.max(0, num(b.wpManualR, 0));
    this.d = pipeInnerDiameterMm(b) / 1000;
    this.A = (Math.PI * this.d * this.d) / 4;
    this.L = Math.max(MIN_PIPE_LEN, pipeLengthM(b));
    this.e = pipeRoughnessMm(b) / 1000 / this.d;
    this.xi = Math.max(0, num(b.wpLocalXi, 0));
    this.K = RHO / (2 * this.A * this.A) / 1e6;
    // Шевелёв: постоянное сопротивление R = (λ·L/d + Σξ)·ρ/(2S²)
    if (this.manualR === null && usesShevelev(b)) {
      this.manualR = this.K * ((shevelevLambda(this.d) * this.L) / this.d + this.xi);
    }
    this.C1 = this.d / (this.A * NU);
    const lamL = 64 / RE_LAM;
    const lamT = 0.11 * (this.e + 68 / RE_TURB) ** 0.25;
    this.lamB = (lamT - lamL) / (RE_TURB - RE_LAM);
    this.lamA = lamL - this.lamB * RE_LAM;
  }

  lam(aq: number): [number, number] {
    const re = this.C1 * aq;
    if (this.manualR !== null) return [Math.max(0, ((this.manualR / this.K - this.xi) * this.d) / this.L), re];
    if (re <= RE_LAM) return [re > 0 ? 64 / re : Infinity, re];
    if (re < RE_TURB) return [this.lamA + this.lamB * re, re];
    return [0.11 * (this.e + 68 / re) ** 0.25, re];
  }

  loss(q: number): [number, number] {
    const aq = Math.abs(q);
    if (this.manualR !== null) {
      const r = this.manualR;
      const s = Math.sqrt(q * q + Q_REG * Q_REG);
      return [r * q * s, r * (s + (q * q) / s)];
    }
    const K = this.K, Ld = this.L / this.d;
    const re = this.C1 * aq;
    if (re <= RE_LAM) {
      const lin = (K * 64 * Ld) / this.C1;
      return [lin * q + K * this.xi * q * aq, lin + 2 * K * this.xi * aq];
    }
    let lam: number, dlam: number;
    if (re < RE_TURB) {
      lam = this.lamA + this.lamB * re;
      dlam = this.lamB * this.C1;
    } else {
      const t = this.e + 68 / re;
      lam = 0.11 * t ** 0.25;
      dlam = 0.11 * 0.25 * t ** -0.75 * (-68 / (re * re)) * this.C1;
    }
    const h = K * (lam * Ld + this.xi) * q * aq;
    const dh = K * (dlam * Ld * aq * aq + 2 * (lam * Ld + this.xi) * aq);
    return [h, dh];
  }

  equivR(q: number): number {
    if (this.manualR !== null) return this.manualR;
    const aq = Math.abs(q);
    if (aq < 1e-6) {
      const lam = this.e > 0 ? 0.11 * this.e ** 0.25 : 0;
      return this.K * ((lam * this.L) / this.d + this.xi);
    }
    return this.loss(aq)[0] / (aq * aq);
  }
}

// ─── Разреженный LDLᵀ с упорядочением минимальной степени ─────────────────────
function minDegreeOrder(n: number, adjSets: Set<number>[]): number[] {
  const adj = adjSets.map(s => new Set(s));
  const alive = new Array<boolean>(n).fill(true);
  // Бинарная куча [deg, id]
  const heap: [number, number][] = [];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] < heap[i][0] || (heap[p][0] === heap[i][0] && heap[p][1] <= heap[i][1])) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let m = i;
        const l = 2 * i + 1, r = l + 1;
        const less = (a: number, b: number) =>
          heap[a][0] < heap[b][0] || (heap[a][0] === heap[b][0] && heap[a][1] < heap[b][1]);
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i++) push([adj[i].size, i]);
  const order: number[] = [];
  while (heap.length > 0) {
    const [deg, k] = pop();
    if (!alive[k] || deg !== adj[k].size) continue;
    alive[k] = false;
    order.push(k);
    const nb = adj[k];
    for (const i of nb) {
      const ai = adj[i];
      ai.delete(k);
      for (const x of nb) if (x !== i) ai.add(x);
      push([ai.size, i]);
    }
    adj[k] = new Set();
  }
  return order;
}

function ldlSolve(n: number, diag: number[], off: Map<number, number>[], rhs: number[], order: number[]): number[] {
  const rows = off.map(r => new Map(r));
  const d = diag.slice();
  const b = rhs.slice();
  const saved: [number, number, [number, number][]][] = [];
  for (const k of order) {
    const dk = d[k];
    const items = [...rows[k].entries()];
    const bk = b[k];
    for (const [i, aik] of items) {
      const f = aik / dk;
      d[i] -= f * aik;
      b[i] -= f * bk;
      const ri = rows[i];
      ri.delete(k);
      for (const [j, ajk] of items) {
        if (j !== i) ri.set(j, (ri.get(j) ?? 0) - f * ajk);
      }
    }
    saved.push([k, dk, items]);
  }
  const x = new Array<number>(n).fill(0);
  for (let s = saved.length - 1; s >= 0; s--) {
    const [k, dk, items] = saved[s];
    let v = b[k];
    for (const [i, aik] of items) v -= aik * x[i];
    x[k] = v / dk;
  }
  return x;
}

// ─── Результаты ───────────────────────────────────────────────────────────────
export interface SolverNodeResult {
  nodeId: string; staticP: number; dynamicP: number; flow: number;
  resistance: number; drainTime: number; noWater?: boolean;
}
export interface SolverBranchResult {
  branchId: string; flow: number; velocity: number; deltaP: number; resistance: number;
  reducerActive: boolean; reducerInP: number; reducerOutP: number; reducerDeltaP: number;
  reducerOverCapacity?: boolean;
  pumpActive?: boolean; pumpHeadM?: number; pumpDeltaP?: number; flowFromTo?: boolean;
  innerDiameter?: number; reynolds?: number; lambda?: number;
  regime?: "laminar" | "transition" | "turbulent" | "none";
}

const zeroBranch = (id: string): SolverBranchResult => ({
  branchId: id, flow: 0, velocity: 0, deltaP: 0, resistance: 0,
  reducerActive: false, reducerInP: 0, reducerOutP: 0, reducerDeltaP: 0,
  pumpActive: false, pumpHeadM: 0, pumpDeltaP: 0,
});

interface Link {
  kind: "pipe" | "emitter" | "source";
  i: string; j: string | null;
  b?: TopoBranch; pipe?: Pipe; R?: number; hAtm?: number;
  d: number; pump: number; pumpHeadM: number;
  red: boolean; redTarget: number; dv: number; q: number; open: boolean;
}

export function solveWaterNetwork(
  nodes: TopoNode[],
  branches: TopoBranch[],
): { nodeResults: Map<string, SolverNodeResult>; branchResults: Map<string, SolverBranchResult>; iterations: number } {
  const nodeResults = new Map<string, SolverNodeResult>();
  const branchResults = new Map<string, SolverBranchResult>();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const closed = (b: TopoBranch) => !!b.wpHasGate && !!b.wpGateClosed;

  for (const b of branches) if (b.hasWaterPipe && closed(b)) branchResults.set(b.id, zeroBranch(b.id));

  const pipes = branches.filter(b => b.hasWaterPipe && !closed(b) && b.fromId !== b.toId);
  const reservoirs = nodes.filter(n => (n.fireNodeType ?? "none") === "reservoir");
  const consumers = nodes.filter(n =>
    (n.fireNodeType ?? "none") === "consumer" && n.fireHydrantOpen && consumerResistance(n) > 0);

  // Связные компоненты — считаем только сети с резервуаром
  const adj = new Map<string, Set<string>>();
  const ensure = (id: string) => { if (!adj.has(id)) adj.set(id, new Set()); return adj.get(id)!; };
  for (const b of pipes) { ensure(b.fromId).add(b.toId); ensure(b.toId).add(b.fromId); }
  for (const n of [...reservoirs, ...consumers]) ensure(n.id);
  const comp = new Map<string, string>();
  for (const s of adj.keys()) {
    if (comp.has(s)) continue;
    comp.set(s, s);
    const st = [s];
    while (st.length) {
      const c = st.pop()!;
      for (const nb of adj.get(c)!) if (!comp.has(nb)) { comp.set(nb, s); st.push(nb); }
    }
  }
  const liveComps = new Set(reservoirs.map(r => comp.get(r.id)!));
  const live = new Set([...comp.entries()].filter(([, c]) => liveComps.has(c)).map(([id]) => id));

  const SRC = "__src__";
  const fixedH = new Map<string, number>();
  for (const r of reservoirs) fixedH.set(SRC + r.id, num(r.fireInitPressure, 0) + RHO_G_MPA * nodeZ(r));

  const freeIds = [...adj.keys()].filter(id => live.has(id));
  const idx = new Map(freeIds.map((id, i) => [id, i]));
  const nfree = freeIds.length;

  const links: Link[] = [];
  for (const b of pipes) {
    if (!live.has(b.fromId)) continue;
    const pumpHead = b.wpHasPump ? num(b.wpPumpHead, 0) : 0;
    const hasRed = !!b.wpHasReducer;
    const d = pumpHead > 0 ? (b.wpPumpReverse ? -1 : 1) : 0;
    const p = new Pipe(b);
    links.push({
      kind: "pipe", b, i: b.fromId, j: b.toId, pipe: p, d,
      pump: pumpHead > 0 ? pumpHead * RHO_G_MPA : 0, pumpHeadM: pumpHead,
      red: hasRed, redTarget: hasRed ? num(b.wpReducerOutPressure, 0.5) : 0,
      dv: 0, q: (d || 1) * p.A * 0.5, open: true,
    });
  }
  for (const r of reservoirs) {
    links.push({ kind: "source", i: SRC + r.id, j: r.id, R: SOURCE_R, d: 1, pump: 0, pumpHeadM: 0,
      red: false, redTarget: 0, dv: 0, q: 1e-3, open: true });
  }
  for (const c of consumers) {
    if (!live.has(c.id)) continue;
    links.push({ kind: "emitter", i: c.id, j: null, R: consumerResistance(c), hAtm: RHO_G_MPA * nodeZ(c),
      d: 1, pump: 0, pumpHeadM: 0, red: false, redTarget: 0, dv: 0, q: 1e-3, open: true });
  }

  let H: number[] = new Array<number>(nfree).fill(fixedH.size ? Math.max(...fixedH.values()) : 0);
  const headOf = (id: string): number => {
    const f = fixedH.get(id);
    if (f !== undefined) return f;
    const k = idx.get(id);
    return k !== undefined ? H[k] : 0;
  };

  const linkF = (L: Link, q: number): [number, number] => {
    if (L.kind !== "pipe") {
      const r = L.R!;
      const s = Math.sqrt(q * q + Q_REG * Q_REG);
      return [r * q * s, r * (s + (q * q) / s)];
    }
    let [h, dh] = L.pipe!.loss(q);
    if (L.pump) h -= L.d * L.pump;
    if (L.red && L.d) h += L.d * L.dv;
    return [h, dh];
  };
  const linkF0 = (L: Link): number => {
    let f0 = 0;
    if (L.kind === "pipe") {
      if (L.pump) f0 -= L.d * L.pump;
      if (L.red && L.d) f0 += L.d * L.dv;
    }
    return f0;
  };

  const struct: Set<number>[] = Array.from({ length: nfree }, () => new Set<number>());
  for (const L of links) {
    const a = idx.get(L.i);
    const bb = L.j !== null ? idx.get(L.j) : undefined;
    if (a !== undefined && bb !== undefined && a !== bb) { struct[a].add(bb); struct[bb].add(a); }
  }
  const order = minDegreeOrder(nfree, struct);

  const solveOnce = (): number => {
    let damping = 1;
    let prevErr = Infinity;
    for (let it = 0; it < MAX_ITER; it++) {
      const diag = new Array<number>(nfree).fill(0);
      const off: Map<number, number>[] = Array.from({ length: nfree }, () => new Map());
      const rhs = new Array<number>(nfree).fill(0);
      const cb: [number, number][] = [];
      for (const L of links) {
        let c: number, bval: number;
        if (L.open) {
          const [f, df] = linkF(L, L.q);
          c = 1 / Math.max(df, 1e-12);
          bval = L.q - c * f;
        } else {
          c = C_CLOSED * (L.kind === "emitter" ? 1e-4 : 1);
          bval = -c * linkF0(L);
        }
        cb.push([c, bval]);
        const a = idx.get(L.i);
        const bj = L.j !== null ? idx.get(L.j) : undefined;
        if (a !== undefined) {
          diag[a] += c;
          rhs[a] -= bval;
          if (bj !== undefined) {
            if (bj !== a) off[a].set(bj, (off[a].get(bj) ?? 0) - c);
          } else {
            rhs[a] += c * (L.j === null ? L.hAtm! : (fixedH.get(L.j) ?? 0));
          }
        }
        if (bj !== undefined) {
          diag[bj] += c;
          rhs[bj] += bval;
          if (a === undefined) rhs[bj] += c * (fixedH.get(L.i) ?? 0);
          else if (a !== bj) off[bj].set(a, (off[bj].get(a) ?? 0) - c);
        }
      }
      if (nfree) H = ldlSolve(nfree, diag, off, rhs, order);
      let err = 0;
      let changed = false;
      links.forEach((L, k) => {
        const [c, bval] = cb[k];
        const hi = headOf(L.i);
        const hj = L.j === null ? L.hAtm! : headOf(L.j);
        let qNew = bval + c * (hi - hj);
        const d = L.d;
        if (L.open) {
          qNew = L.q + damping * (qNew - L.q);
          if (d && qNew * d < 0) { L.open = false; changed = true; qNew = 0; }
        } else if (d && d * ((hi - hj) - linkF0(L)) > 1e-9) {
          L.open = true; changed = true; qNew = d * 1e-4;
        } else {
          qNew = 0;
        }
        err = Math.max(err, Math.abs(qNew - L.q) / (Math.abs(qNew) + 1e-3));
        L.q = qNew;
      });
      for (const L of links) {
        if (!(L.red && L.d)) continue;
        const up = L.d > 0 ? L.i : L.j!;
        const pUp = headOf(up) - RHO_G_MPA * nodeZ(nodeMap.get(up));
        const target = Math.max(0, pUp - L.redTarget);
        if (Math.abs(target - L.dv) > 1e-6) changed = true;
        L.dv += 0.8 * (target - L.dv);
      }
      if (err > prevErr * 1.5 && it > 5) damping = Math.max(0.3, damping * 0.7);
      prevErr = err;
      if (err < 1e-6 && !changed) return it + 1;
    }
    return MAX_ITER;
  };

  // Направление редукторов без насоса — по предварительному решению без них.
  let iterations = 0;
  const reducers = links.filter(L => L.red && !L.d);
  if (reducers.length) {
    for (const L of reducers) L.red = false;
    iterations += solveOnce();
    for (const L of reducers) {
      L.red = true;
      const hi = headOf(L.i);
      const hj = L.j !== null ? headOf(L.j) : 0;
      L.d = (L.q > 1e-9 || (Math.abs(L.q) <= 1e-9 && hi >= hj)) ? 1 : -1;
      if (L.q * L.d < 0) L.q = 0;
    }
  }
  iterations += solveOnce();

  // ── Результаты ветвей ───────────────────────────────────────────────────
  const outFlow = new Map<string, number>();
  const emitQ = new Map<string, number>();
  for (const L of links) {
    if (L.kind === "source") { outFlow.set(L.j!, (outFlow.get(L.j!) ?? 0) + Math.max(0, L.q)); continue; }
    if (L.kind === "emitter") { emitQ.set(L.i, L.q); continue; }
    const b = L.b!, p = L.pipe!;
    const q = L.q;
    const aq = Math.abs(q) * 3600 >= 5e-4 ? Math.abs(q) : 0;
    const qh = aq * 3600;
    const [lam, re] = aq > 0 ? p.lam(aq) : [0, 0];
    const regime = aq <= 0 ? "none" : re <= RE_LAM ? "laminar" : re < RE_TURB ? "transition" : "turbulent";
    const fromTo = q >= 0;
    const hLoss = aq > 0 ? Math.abs(p.loss(q)[0]) : 0;
    const up = fromTo ? b.fromId : b.toId;
    const pUp = headOf(up) - RHO_G_MPA * nodeZ(nodeMap.get(up));
    const dv = L.red && L.d ? L.dv : 0;
    const pumpOn = L.pump > 0 && L.open && aq > 1e-9;
    const maxFlow = num(b.wpReducerMaxFlow, 0);
    const r4 = (v: number, k = 4) => Math.round(v * 10 ** k) / 10 ** k;
    branchResults.set(b.id, {
      branchId: b.id,
      flow: r4(qh, 3),
      velocity: r4(aq / p.A, 3),
      deltaP: r4(hLoss, 5),
      resistance: r4(p.equivR(q), 6),
      reducerActive: L.red && dv > 1e-6,
      reducerInP: r4(Math.max(0, pUp)),
      reducerOutP: r4(Math.max(0, pUp - dv)),
      reducerDeltaP: r4(dv),
      reducerOverCapacity: L.red && maxFlow > 0 && qh > maxFlow,
      pumpActive: pumpOn,
      pumpHeadM: L.pump ? r4(L.pumpHeadM, 2) : 0,
      pumpDeltaP: pumpOn ? r4(L.pump) : 0,
      flowFromTo: fromTo,
      innerDiameter: r4(p.d * 1000, 1),
      reynolds: Math.round(re),
      lambda: Number.isFinite(lam) ? r4(lam, 5) : 0,
      regime,
    });
  }
  for (const b of pipes) if (!branchResults.has(b.id)) branchResults.set(b.id, zeroBranch(b.id));

  // ── Результаты узлов ────────────────────────────────────────────────────
  for (const n of nodes) {
    const ft = n.fireNodeType ?? "none";
    if (ft === "none") continue;
    if (ft === "reservoir") {
      let q = Math.max(0, outFlow.get(n.id) ?? 0) * 3600;
      if (q < 5e-4) q = 0;
      const cap = num(n.fireCapacity, 0);
      nodeResults.set(n.id, {
        nodeId: n.id, staticP: num(n.fireInitPressure, 0), dynamicP: 0, flow: q, resistance: 0,
        drainTime: q > 0 ? (cap / q) * 60 : 0,
      });
      continue;
    }
    const inNet = live.has(n.id) && idx.has(n.id);
    let p = inNet ? headOf(n.id) - RHO_G_MPA * nodeZ(n) : 0;
    const noWater = !inNet || p < 0;
    p = Math.max(0, p);
    const res: SolverNodeResult = { nodeId: n.id, staticP: p, dynamicP: 0, flow: 0, resistance: 0, drainTime: 0, noWater };
    if (ft === "consumer" && emitQ.has(n.id)) {
      let q = Math.max(0, emitQ.get(n.id)!);
      if (q * 3600 < 5e-4) q = 0;
      res.dynamicP = q > 0 ? p : 0;
      res.flow = q * 3600;
      res.resistance = consumerResistance(n);
    }
    nodeResults.set(n.id, res);
  }

  return { nodeResults, branchResults, iterations };
}
