// ─────────────────────────────────────────────────────────────────────────────
// vgschNetwork.ts — распространение ударной воздушной волны по СЕТИ выработок
// по Методике ВГСЧ (Прил. 12 к Уставу ВГСЧ).
//
// Один и тот же обход используется и при расчёте взрыва (explosionModeRun),
// и при окраске схемы — поэтому давления на схеме и в протоколе совпадают.
//
// ПО ЗОНАМ МЕТОДИКИ:
//   • зона загазования (полудлина участка от точки очага по пути волны) —
//     давление постоянно;
//   • зона продуктов взрыва — давление по ф. (4) от заполненного объёма.
//     На сопряжениях продукты делятся между исходящими выработками
//     пропорционально их сечениям (как в примере методики: «ПВ разделяются
//     пополам»). Местными сопротивлениями здесь пренебрегают (раздел 4);
//   • после отрыва от продуктов — затухание по ф. (3) с Кз и периметром
//     КАЖДОЙ выработки, в узлах — коэффициент затекания Кзат (табл. 5).
//     Тупик длиннее 130 м снижает давление на 10 %.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch, type TopoNode } from "@/lib/topology";
import {
  type VgschSource, vgschZone2KPa, kzat, kzFromAlpha, perimeterOf,
  localResistanceKind, VGSCH_DEADEND_M,
} from "@/lib/vgschBlast";
import { crossBarriers, type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";

/** Состояние волны в точке пути. */
export interface VgschState {
  /** Путь от точки очага, м. */
  d: number;
  /** Объём, уже заполненный продуктами взрыва в этом направлении, м³. */
  vs: number;
  /** Ослабление после отрыва УВВ от продуктов взрыва (ф. 3). */
  det: number;
  /** Множитель местных сопротивлений и перемычек. */
  mult: number;
  /** Очаг-источник (id ветви). */
  srcId: string;
}

interface EdgeGeom { area: number; perimeter: number; kz: number }

function geomOf(b: TopoBranch): EdgeGeom {
  const area = b.area && b.area > 0 ? b.area : 12;
  return { area, perimeter: perimeterOf(area, b.perimeter), kz: kzFromAlpha(b.alphaCoef) };
}

/** Отношение давления в точке к ΔPн (давлению в месте отрыва УВВ). */
export function vgschRatio(src: VgschSource, st: VgschState): number {
  const half = src.zoneLength_m / 2;
  if (src.dPn_kPa <= 0) return 0;
  let base: number;
  if (st.d <= half) base = src.dPz_kPa / src.dPn_kPa;
  else if (st.vs < src.pvVolumePerSide_m3) base = vgschZone2KPa(src, st.vs) / src.dPn_kPa;
  else base = st.det;
  return base * st.mult;
}

/** Продвинуть волну вдоль выработки на dist метров. */
function advance(src: VgschSource, g: EdgeGeom, st: VgschState, dist: number): VgschState {
  let { d, vs, det } = st;
  let rem = Math.max(dist, 0);
  const half = src.zoneLength_m / 2;
  const pv = src.pvVolumePerSide_m3;
  // 1) зона загазования
  if (d < half && rem > 0) {
    const s = Math.min(rem, half - d);
    d += s; rem -= s;
  }
  // 2) зона продуктов взрыва — по объёму выработок
  if (rem > 0 && vs < pv) {
    const s = Math.min(rem, (pv - vs) / g.area);
    vs += s * g.area; d += s; rem -= s;
    if (pv - vs < 1e-6) vs = pv;
  }
  // 3) УВВ, оторвавшаяся от продуктов: ф. (3)
  if (rem > 0) {
    det *= Math.exp(-g.kz * g.perimeter * rem / g.area);
    d += rem;
  }
  return { ...st, d, vs, det };
}

function detached(src: VgschSource, st: VgschState): boolean {
  return st.d > src.zoneLength_m / 2 && st.vs >= src.pvVolumePerSide_m3;
}

export interface VgschNetResult {
  /** Лучшее (самое сильное) состояние волны в каждом узле. */
  nodeState: Map<string, VgschState>;
  /** Давление в точке t ветви (0 — fromId, 1 — toId), кПа, и путь до неё. */
  pressureAt: (branchId: string, t: number) => { p: number; d: number; srcId: string } | null;
  /** Решения по перемычкам (самый сильный удар). */
  hits: Map<string, BarrierHit>;
}

export function propagateVgsch(opts: {
  branches: TopoBranch[];
  nodes: TopoNode[];
  /** Очаги по методике ВГСЧ: id ветви → параметры источника. */
  sources: Map<string, VgschSource>;
  barriers: Map<string, BlastBarrier[]>;
  /** Готовые решения по перемычкам (из полного расчёта). */
  decided?: Map<string, BarrierHit>;
}): VgschNetResult {
  const { branches, nodes, sources, barriers, decided } = opts;
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const branchById = new Map(branches.map(b => [b.id, b]));
  const hits = new Map<string, BarrierHit>(decided ?? []);
  const recordHit = (bar: BlastBarrier, hit: BarrierHit) => {
    if (decided) return;
    const prev = hits.get(bar.key);
    if (!prev || hit.incident_kPa > prev.incident_kPa) hits.set(bar.key, hit);
  };
  const pressureOf = (_d: number, att: number, srcId: string) => {
    const s = sources.get(srcId);
    return s ? Math.round(s.dPn_kPa * att * 10) / 10 : 0;
  };

  const lenOf = (b: TopoBranch) => {
    const f = nodeById.get(b.fromId), t = nodeById.get(b.toId);
    if (!f || !t) return b.length > 0 ? b.length : 1;
    return Math.hypot(t.x - f.x, t.y - f.y, t.z - f.z) || (b.length > 0 ? b.length : 1);
  };

  type Edge = { to: string; len: number; g: EdgeGeom; branchId: string; tStart: 0 | 1 };
  const adj = new Map<string, Edge[]>();
  for (const b of branches) {
    const len = lenOf(b), g = geomOf(b);
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    adj.get(b.fromId)!.push({ to: b.toId, len, g, branchId: b.id, tStart: 0 });
    adj.get(b.toId)!.push({ to: b.fromId, len, g, branchId: b.id, tStart: 1 });
  }
  const degree = (nid: string) => adj.get(nid)?.length ?? 0;

  /** Проводит волну по ветви между точками tFrom → tTo через перемычки. */
  const cross = (branchId: string, g: EdgeGeom, len: number, st: VgschState, tFrom: number, tTo: number) => {
    const src = sources.get(st.srcId)!;
    return crossBarriers({
      list: barriers.get(branchId), tFrom, tTo, len, d0: st.d,
      attAt: dist => vgschRatio(src, advance(src, g, st, dist)),
      srcId: st.srcId, pressureOf, onHit: recordHit,
      decided: decided ? bar => decided.get(bar.key) : undefined,
    });
  };

  const nodeState = new Map<string, VgschState & { fromNode?: string }>();
  /** Вход волны в ветвь (после узла): ключ `${branchId}:${0|1}`. */
  const edgeEntry = new Map<string, VgschState>();
  const pq: Array<{ id: string; st: VgschState & { fromNode?: string } }> = [];
  const ratioOf = (st: VgschState) => {
    const s = sources.get(st.srcId);
    return s ? vgschRatio(s, st) : 0;
  };
  const push = (nid: string, st: VgschState & { fromNode?: string }) => {
    const cur = nodeState.get(nid);
    if (!cur || ratioOf(st) > ratioOf(cur) * 1.000001) {
      nodeState.set(nid, st);
      pq.push({ id: nid, st });
    }
  };
  const setEntry = (key: string, st: VgschState) => {
    const cur = edgeEntry.get(key);
    if (!cur || ratioOf(st) > ratioOf(cur)) edgeEntry.set(key, st);
  };

  // Старт: от точки очага в обе стороны своей ветви
  for (const [bid, src] of sources) {
    const b = branchById.get(bid);
    if (!b || src.dPn_kPa <= 0) continue;
    const len = lenOf(b), g = geomOf(b), t = b.explosionT ?? 0.5;
    const st0: VgschState = { d: 0, vs: 0, det: 1, mult: 1, srcId: bid };
    const toFrom = advance(src, g, st0, len * t);
    const toTo = advance(src, g, st0, len * (1 - t));
    const kF = cross(bid, g, len, st0, t, 0);
    const kT = cross(bid, g, len, st0, t, 1);
    if (kF > 0 && !nodeById.get(b.fromId)?.atmosphereLink) push(b.fromId, { ...toFrom, mult: toFrom.mult * kF });
    if (kT > 0 && !nodeById.get(b.toId)?.atmosphereLink) push(b.toId, { ...toTo, mult: toTo.mult * kT });
  }

  const visited = new Set<string>();
  let guard = 0;
  while (pq.length > 0 && guard++ < 200000) {
    pq.sort((a, b) => ratioOf(b.st) - ratioOf(a.st));
    const { id: cur, st } = pq.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const src = sources.get(st.srcId);
    if (!src) continue;
    const edges = adj.get(cur) ?? [];
    const out = edges.filter(e => e.to !== st.fromNode);
    if (out.length === 0) continue;
    const inEdge = edges.find(e => e.to === st.fromNode);
    const inArea = inEdge?.g.area ?? out[0].g.area;
    const outArea = out.reduce((s, e) => s + e.g.area, 0);
    const pNode = nodeById.get(cur), pPrev = st.fromNode ? nodeById.get(st.fromNode) : undefined;
    const isDet = detached(src, st);

    // Тупик длиннее 130 м в узле снижает давление в остальных направлениях на 10 %
    const longDeadEnd = isDet && out.some(e => degree(e.to) === 1 && e.len > VGSCH_DEADEND_M
      && !nodeById.get(e.to)?.atmosphereLink);

    for (const e of out) {
      const toNode = nodeById.get(e.to);
      let entry: VgschState = { ...st };
      if (isDet) {
        // Местное сопротивление: Кзат по табл. 5
        let defl = 0;
        if (pNode && pPrev && toNode) {
          const ax = pNode.x - pPrev.x, ay = pNode.y - pPrev.y, az = pNode.z - pPrev.z;
          const bx = toNode.x - pNode.x, by = toNode.y - pNode.y, bz = toNode.z - pNode.z;
          const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
          if (la > 0 && lb > 0) {
            const c = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)));
            defl = Math.acos(c) * 180 / Math.PI;
          }
        }
        const kind = localResistanceKind(defl, out.length);
        const delta = inArea > 0 ? e.g.area / inArea : 1;
        const pMPa = src.dPn_kPa * vgschRatio(src, st) / 1000;
        let k = kzat(kind, delta, pMPa);
        if (longDeadEnd && !(degree(e.to) === 1 && e.len > VGSCH_DEADEND_M)) k *= 0.9;
        entry = { ...entry, mult: entry.mult * k };
      } else if (st.d > src.zoneLength_m / 2 && st.vs < src.pvVolumePerSide_m3 && outArea > 0) {
        // Продукты взрыва делятся между выработками пропорционально сечениям
        const remaining = src.pvVolumePerSide_m3 - st.vs;
        entry = { ...entry, vs: src.pvVolumePerSide_m3 - remaining * (e.g.area / outArea) };
      }
      setEntry(`${e.branchId}:${e.tStart}`, entry);
      if (toNode?.atmosphereLink) continue;
      const kBar = cross(e.branchId, e.g, e.len, entry, e.tStart, e.tStart === 0 ? 1 : 0);
      const endSt = advance(src, e.g, entry, e.len);
      const next = { ...endSt, mult: endSt.mult * kBar, fromNode: cur };
      if (vgschRatio(src, next) * src.dPn_kPa < 0.5) continue;
      push(e.to, next);
    }
  }

  const pressureAt = (branchId: string, t: number) => {
    const b = branchById.get(branchId);
    if (!b) return null;
    const len = lenOf(b), g = geomOf(b);
    let best: { p: number; d: number; srcId: string } | null = null;
    const consider = (st: VgschState, dist: number, tFrom: number) => {
      const src = sources.get(st.srcId);
      if (!src) return;
      const k = cross(branchId, g, len, st, tFrom, t);
      const s2 = advance(src, g, st, dist);
      const p = src.dPn_kPa * vgschRatio(src, s2) * k;
      if (!best || p > best.p) best = { p: Math.round(p * 10) / 10, d: s2.d, srcId: st.srcId };
    };
    const e0 = edgeEntry.get(`${branchId}:0`);
    const e1 = edgeEntry.get(`${branchId}:1`);
    if (e0) consider(e0, len * t, 0);
    if (e1) consider(e1, len * (1 - t), 1);
    const own = sources.get(branchId);
    if (own) {
      const tSrc = b.explosionT ?? 0.5;
      consider({ d: 0, vs: 0, det: 1, mult: 1, srcId: branchId }, Math.abs(t - tSrc) * len, tSrc);
    }
    return best;
  };

  return { nodeState, pressureAt, hits };
}
