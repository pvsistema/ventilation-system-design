// ─────────────────────────────────────────────────────────────────────────────
// fnp494Network.ts — распространение УВВ от заряда ВВ по СЕТИ выработок
// по ФНП № 494 (пп. 816–822, прил. 29–30).
//
// Давление в точке пути длиной R:
//   ΔP = (3410·Qэ/(R·ΣS) + 794·√(Qэ/(R·ΣS))) · e^(−βср·R/dср) / ΠK
//   βср·R = Σ βi·Ri — шероховатость каждой пройденной выработки (прил. 29);
//   dср = (d1 + … + dn)/n, di = 1,12·√Si — пройденные выработки (ф. 24);
//   K — коэффициенты местных сопротивлений прил. 30 (п. 818).
// Тупиковый отвод короче ¼ пройденного пути как сопротивление не учитывается;
// плавные закругления (отклонение < 45°) — тоже.
//
// Один и тот же обход используется при расчёте взрыва и при окраске схемы.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch, type TopoNode } from "@/lib/topology";
import { type Fnp494Source, fnpBase, betaOf, reducedDiameter, localResistance, supportOf, supportName } from "@/lib/fnp494Blast";
import { crossBarriers, type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";

/** Состояние волны в точке пути. */
export interface FnpState {
  /** Путь от заряда, м. */
  d: number;
  /** Σ βi·Ri по пройденным выработкам. */
  sbr: number;
  /** Сумма и число приведённых диаметров пройденных выработок (ф. 24). */
  sumD: number;
  nD: number;
  /** Множитель местных сопротивлений и перемычек (1/ΠK · прохождение). */
  k: number;
  srcId: string;
  fromBranch?: string;
  /** Пройденные местные сопротивления — для протокола. */
  local?: string[];
}

interface Geom { area: number; beta: number; d: number }

export interface FnpNetResult {
  nodeState: Map<string, FnpState>;
  pressureAt: (branchId: string, t: number) => { p: number; d: number; srcId: string } | null;
  hits: Map<string, BarrierHit>;
  /** Давление по состоянию волны, кПа. */
  pressureOfState: (st: FnpState) => number;
}

/** Давление по состоянию волны с учётом добавочного участка (dist, β, d), кПа. */
export function fnpStatePressure(src: Fnp494Source, st: FnpState, extra?: { dist: number; beta: number; d: number; newBranch: boolean }): number {
  const R = st.d + (extra?.dist ?? 0);
  const sbr = st.sbr + (extra ? extra.beta * extra.dist : 0);
  const sumD = st.sumD + (extra?.newBranch ? extra.d : 0);
  const nD = st.nD + (extra?.newBranch ? 1 : 0);
  const dAvg = nD > 0 ? sumD / nD : src.d_m;
  const att = dAvg > 0 ? Math.exp(-sbr / dAvg) : 1;
  return fnpBase(R, src) * att * st.k;
}

function deflectionDeg(pPrev?: TopoNode, pNode?: TopoNode, pNext?: TopoNode): number {
  if (!pPrev || !pNode || !pNext) return 0;
  const ax = pNode.x - pPrev.x, ay = pNode.y - pPrev.y, az = pNode.z - pPrev.z;
  const bx = pNext.x - pNode.x, by = pNext.y - pNode.y, bz = pNext.z - pNode.z;
  const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
  if (!(la > 0 && lb > 0)) return 0;
  const c = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)));
  return Math.acos(c) * 180 / Math.PI;
}

/** Длина выработки: из поля «Длина», а при его отсутствии — по координатам. */
export function branchLength(b: TopoBranch, nodeById: Map<string, TopoNode>): number {
  if (b.length > 0) return b.length;
  const f = nodeById.get(b.fromId), t = nodeById.get(b.toId);
  if (!f || !t) return 1;
  return Math.hypot(t.x - f.x, t.y - f.y, t.z - f.z) || 1;
}

/** β, d и вид крепи выработки — для протокола. */
export function fnpBranchInfo(b: TopoBranch, bound: "min" | "max" = "min") {
  const area = b.area && b.area > 0 ? b.area : 12;
  return { beta: betaOf(b, bound), d: reducedDiameter(area), support: supportName(supportOf(b)) };
}

export function propagateFnp(opts: {
  branches: TopoBranch[];
  nodes: TopoNode[];
  sources: Map<string, Fnp494Source>;
  barriers: Map<string, BlastBarrier[]>;
  decided?: Map<string, BarrierHit>;
}): FnpNetResult {
  const { branches, nodes, sources, barriers, decided } = opts;
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const branchById = new Map(branches.map(b => [b.id, b]));
  const hits = new Map<string, BarrierHit>(decided ?? []);
  const recordHit = (bar: BlastBarrier, hit: BarrierHit) => {
    if (decided) return;
    const prev = hits.get(bar.key);
    if (!prev || hit.incident_kPa > prev.incident_kPa) hits.set(bar.key, hit);
  };

  const geomCache = new Map<string, Geom>();
  const geomFor = (b: TopoBranch, src: Fnp494Source): Geom => {
    const key = `${b.id}|${src.betaBound}`;
    let g = geomCache.get(key);
    if (!g) {
      const area = b.area && b.area > 0 ? b.area : 12;
      g = { area, beta: betaOf(b, src.betaBound), d: reducedDiameter(area) };
      geomCache.set(key, g);
    }
    return g;
  };

  type Edge = { to: string; len: number; branch: TopoBranch; tStart: 0 | 1 };
  const adj = new Map<string, Edge[]>();
  for (const b of branches) {
    const len = branchLength(b, nodeById);
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    adj.get(b.fromId)!.push({ to: b.toId, len, branch: b, tStart: 0 });
    adj.get(b.toId)!.push({ to: b.fromId, len, branch: b, tStart: 1 });
  }
  const degree = (nid: string) => adj.get(nid)?.length ?? 0;

  const pressureOfState = (st: FnpState) => {
    const s = sources.get(st.srcId);
    return s ? fnpStatePressure(s, st) : 0;
  };

  /** Провести волну по ветви между точками tFrom → tTo через перемычки. */
  const cross = (b: TopoBranch, len: number, st: FnpState, tFrom: number, tTo: number, newBranch: boolean) => {
    const src = sources.get(st.srcId)!;
    const g = geomFor(b, src);
    const base = fnpStatePressure(src, { ...st, k: 1 });
    return crossBarriers({
      list: barriers.get(b.id), tFrom, tTo, len, d0: st.d,
      // att — доля от «базового» давления в начале участка
      attAt: dist => base > 0 ? fnpStatePressure(src, st, { dist, beta: g.beta, d: g.d, newBranch }) / base : 0,
      srcId: st.srcId,
      pressureOf: (_d, att) => Math.round(base * att * st.k * 10) / 10,
      onHit: recordHit,
      decided: decided ? bar => decided.get(bar.key) : undefined,
    });
  };

  const advance = (st: FnpState, g: Geom, dist: number, newBranch: boolean): FnpState => ({
    ...st,
    d: st.d + dist,
    sbr: st.sbr + g.beta * dist,
    sumD: st.sumD + (newBranch ? g.d : 0),
    nD: st.nD + (newBranch ? 1 : 0),
  });

  const nodeState = new Map<string, FnpState>();
  const edgeEntry = new Map<string, FnpState>();
  const pq: Array<{ id: string; st: FnpState }> = [];
  const push = (nid: string, st: FnpState) => {
    const cur = nodeState.get(nid);
    if (!cur || pressureOfState(st) > pressureOfState(cur) * 1.000001) {
      nodeState.set(nid, st);
      pq.push({ id: nid, st });
    }
  };
  const setEntry = (key: string, st: FnpState) => {
    const cur = edgeEntry.get(key);
    if (!cur || pressureOfState(st) > pressureOfState(cur)) edgeEntry.set(key, st);
  };

  // Старт: от заряда в обе стороны выработки-очага
  for (const [bid, src] of sources) {
    const b = branchById.get(bid);
    if (!b) continue;
    const len = branchLength(b, nodeById), t = b.explosionT ?? 0.5;
    const g = geomFor(b, src);
    const base: FnpState = { d: 0, sbr: 0, sumD: 0, nD: 0, k: 1, srcId: bid, local: [] };
    const kF = cross(b, len, base, t, 0, true);
    const kT = cross(b, len, base, t, 1, true);
    const toF = advance(base, g, len * t, true);
    const toT = advance(base, g, len * (1 - t), true);
    if (kF > 0 && !nodeById.get(b.fromId)?.atmosphereLink) push(b.fromId, { ...toF, k: kF, fromBranch: bid });
    if (kT > 0 && !nodeById.get(b.toId)?.atmosphereLink) push(b.toId, { ...toT, k: kT, fromBranch: bid });
  }

  const visited = new Set<string>();
  let guard = 0;
  while (pq.length > 0 && guard++ < 200000) {
    pq.sort((a, b) => pressureOfState(b.st) - pressureOfState(a.st));
    const { id: cur, st } = pq.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const src = sources.get(st.srcId);
    if (!src) continue;
    const edges = adj.get(cur) ?? [];
    const out = edges.filter(e => e.branch.id !== st.fromBranch);
    if (out.length === 0) continue;
    const inEdge = edges.find(e => e.branch.id === st.fromBranch);
    const inArea = inEdge ? geomFor(inEdge.branch, src).area : geomFor(out[0].branch, src).area;
    const pNode = nodeById.get(cur), pPrev = inEdge ? nodeById.get(inEdge.to) : undefined;

    // Тупиковые отводы короче ¼ пройденного пути как местное сопротивление
    // не учитываются (п. 818) — исключаем их из геометрии узла.
    const counts = out.map(e => !(degree(e.to) === 1 && !nodeById.get(e.to)?.atmosphereLink && e.len < st.d / 4));
    const geo = out.map(e => ({ area: geomFor(e.branch, src).area, defl: deflectionDeg(pPrev, pNode, nodeById.get(e.to)) }));
    const geoCounted = geo.filter((_, i) => counts[i]);

    out.forEach((e, idx) => {
      const g = geomFor(e.branch, src);
      let lk = { K: 1, label: "" };
      if (counts[idx]) {
        const ci = counts.slice(0, idx).filter(Boolean).length;
        lk = localResistance(inArea, geoCounted, ci);
      }
      const entry: FnpState = {
        ...st,
        k: st.k / (lk.K > 0 ? lk.K : 1),
        local: lk.label ? [...(st.local ?? []), `узел ${pNode?.number || cur}: ${lk.label}, K=${Math.round(lk.K * 100) / 100}`] : st.local,
      };
      setEntry(`${e.branch.id}:${e.tStart}`, entry);
      if (nodeById.get(e.to)?.atmosphereLink) return;
      const kBar = cross(e.branch, e.len, entry, e.tStart, e.tStart === 0 ? 1 : 0, true);
      const end = advance(entry, g, e.len, true);
      const next: FnpState = { ...end, k: end.k * kBar, fromBranch: e.branch.id };
      if (pressureOfState(next) < 0.5) return;
      push(e.to, next);
    });
  }

  const pressureAt = (branchId: string, t: number) => {
    const b = branchById.get(branchId);
    if (!b) return null;
    const len = branchLength(b, nodeById);
    let best: { p: number; d: number; srcId: string } | null = null;
    const consider = (st: FnpState, tFrom: number) => {
      const src = sources.get(st.srcId);
      if (!src) return;
      const g = geomFor(b, src);
      const dist = Math.abs(t - tFrom) * len;
      const k = cross(b, len, st, tFrom, t, true);
      const p = fnpStatePressure(src, st, { dist, beta: g.beta, d: g.d, newBranch: true }) * k;
      if (!best || p > best.p) best = { p: Math.round(p * 10) / 10, d: st.d + dist, srcId: st.srcId };
    };
    const e0 = edgeEntry.get(`${branchId}:0`);
    const e1 = edgeEntry.get(`${branchId}:1`);
    if (e0) consider(e0, 0);
    if (e1) consider(e1, 1);
    if (sources.has(branchId)) {
      consider({ d: 0, sbr: 0, sumD: 0, nD: 0, k: 1, srcId: branchId }, b.explosionT ?? 0.5);
    }
    return best;
  };

  return { nodeState, pressureAt, hits, pressureOfState };
}

/**
 * ΣS по схеме (п. 817): заряд в тупике — волна уходит в одну выработку (S),
 * иначе — в обе стороны выработки-очага (2·S). Задано вручную — берётся оно.
 */
export function autoSumS(b: TopoBranch, branches: TopoBranch[], nodes: TopoNode[]): number {
  if (b.explosionSumS && b.explosionSumS > 0) return b.explosionSumS;
  const area = b.area && b.area > 0 ? b.area : 12;
  const atm = new Set(nodes.filter(n => n.atmosphereLink).map(n => n.id));
  const deg = (nid: string) => branches.reduce((s, x) => s + (x.fromId === nid ? 1 : 0) + (x.toId === nid ? 1 : 0), 0);
  const deadFrom = deg(b.fromId) <= 1 && !atm.has(b.fromId);
  const deadTo = deg(b.toId) <= 1 && !atm.has(b.toId);
  return deadFrom || deadTo ? area : 2 * area;
}
