// ─────────────────────────────────────────────────────────────────────────────
// vgschNetwork.ts — распространение ударной воздушной волны по СЕТИ выработок
// по Методике ВГСЧ (Прил. 12 к Уставу ВГСЧ).
//
// Один и тот же обход используется и при расчёте взрыва (explosionModeRun),
// и при окраске схемы — поэтому давления на схеме и в протоколе совпадают.
//
// ПО ЗОНАМ МЕТОДИКИ:
//   • фронт характеризуется ОБЩИМ объёмом V, который уже занят смесью и
//     продуктами взрыва во всех направлениях. Путь несёт долю потока w:
//     на сопряжениях она делится пропорционально сечениям, а объём растёт
//     как dV = dx·S/w — то есть так, будто все фронты идут вровень.
//     Поэтому давление на развилке не скачет;
//   • зона загазования — пока V ≤ V₀ (по объёму, а не по длине участка):
//     давление постоянно;
//   • зона продуктов взрыва — пока V < 5V₀: давление по ф. (4) при V₂ = V.
//     Местными сопротивлениями здесь пренебрегают (раздел 4);
//   • если одна сторона от очага — тупик объёмом меньше половины 5V₀,
//     продукты заполняют его целиком, а остальное уходит в открытую сторону;
//   • после отрыва от продуктов — затухание по ф. (3) с Кз и периметром
//     КАЖДОЙ выработки, в узлах — коэффициент затекания Кзат (табл. 5):
//     проход прямо через сопряжение — п. 6–8, ответвление — п. 3–5 по углу,
//     поворот без сопряжения — п. 13. Тупик длиннее 130 м снижает давление на 10 %.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch, type TopoNode } from "@/lib/topology";
import {
  type VgschSource, vgschZone2KPaByV2, kzat, TURN_ANGLE_DEG, VGSCH_PV_FACTOR, kzFromAlpha, perimeterOf,
  localResistanceKind, VGSCH_DEADEND_M,
} from "@/lib/vgschBlast";
import { crossBarriers, type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";

/** Состояние волны в точке пути. */
export interface VgschState {
  /** Путь от точки очага, м. */
  d: number;
  /** Общий объём смеси и продуктов взрыва (все направления), м³. */
  V: number;
  /** Доля зоны загазования V₀, приходящаяся на этот путь (0…1). */
  wg: number;
  /** Доля общего потока продуктов, идущая по этому пути (0…1). */
  w: number;
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
  if (src.dPn_kPa <= 0) return 0;
  let base: number;
  if (st.V <= src.V0_m3 * (1 + 1e-9)) base = src.dPz_kPa / src.dPn_kPa;
  else if (st.V < pvTotal(src)) base = vgschZone2KPaByV2(src, st.V) / src.dPn_kPa;
  else base = st.det;
  return base * st.mult;
}

/** Полный объём продуктов взрыва 5V₀, м³. */
function pvTotal(src: VgschSource): number {
  return VGSCH_PV_FACTOR * src.V0_m3;
}

/** Продвинуть волну вдоль выработки на dist метров. */
function advance(src: VgschSource, g: EdgeGeom, st: VgschState, dist: number): VgschState {
  let { d, V, det } = st;
  let rem = Math.max(dist, 0);
  const V0 = src.V0_m3, pv = pvTotal(src);
  // 1) зона загазования — смесь занимает объём V₀, распределённый по путям
  if (rem > 0 && V < V0) {
    if (st.wg > 0) {
      const s = Math.min(rem, (V0 - V) * st.wg / g.area);
      V += s * g.area / st.wg; d += s; rem -= s;
      if (V0 - V < 1e-6 * V0) V = V0;
    } else V = V0; // смеси на этом пути нет
  }
  // 2) зона продуктов взрыва — общий объём растёт до 5V₀
  if (rem > 0 && V < pv) {
    if (st.w > 0) {
      const s = Math.min(rem, (pv - V) * st.w / g.area);
      V += s * g.area / st.w; d += s; rem -= s;
      if (pv - V < 1e-6 * pv) V = pv;
    } else V = pv; // продукты сюда не идут — дальше только УВВ
  }
  // 3) УВВ, оторвавшаяся от продуктов: ф. (3)
  if (rem > 0) {
    det *= Math.exp(-g.kz * g.perimeter * rem / g.area);
    d += rem;
  }
  return { ...st, d, V, det };
}

function detached(src: VgschSource, st: VgschState): boolean {
  return st.V >= pvTotal(src);
}

/** Угол отклонения направления pPrev→pNode→pNext, °. */
function deflectionDeg(pPrev?: TopoNode, pNode?: TopoNode, pNext?: TopoNode): number {
  if (!pPrev || !pNode || !pNext) return 0;
  const ax = pNode.x - pPrev.x, ay = pNode.y - pPrev.y, az = pNode.z - pPrev.z;
  const bx = pNext.x - pNode.x, by = pNext.y - pNode.y, bz = pNext.z - pNode.z;
  const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
  if (!(la > 0 && lb > 0)) return 0;
  const c = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)));
  return Math.acos(c) * 180 / Math.PI;
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

  /**
   * Объём замкнутой (тупиковой) части сети за узлом startId, если идти в неё
   * не через узел backId, м³. null — часть сети открыта: выходит к
   * поверхности или обратно к backId. Поиск ограничен 300 ветвями.
   */
  const deadCache = new Map<string, number | null>();
  const deadVolume = (startId: string, backId: string, viaBranch: string): number | null => {
    const key = `${startId}|${backId}|${viaBranch}`;
    if (deadCache.has(key)) return deadCache.get(key)!;
    let vol = 0, open = false;
    const seenN = new Set<string>([startId]);
    const seenB = new Set<string>([viaBranch]);
    const stack = [startId];
    while (stack.length && !open) {
      const n = stack.pop()!;
      if (nodeById.get(n)?.atmosphereLink) { open = true; break; }
      for (const e of adj.get(n) ?? []) {
        if (seenB.has(e.branchId)) continue;
        seenB.add(e.branchId);
        if (seenB.size > 300 || e.to === backId) { open = true; break; }
        vol += e.len * e.g.area;
        if (!seenN.has(e.to)) { seenN.add(e.to); stack.push(e.to); }
      }
    }
    const res = open ? null : vol;
    deadCache.set(key, res);
    return res;
  };

  /**
   * Делит долю потока продуктов w между исходящими выработками: по сечениям,
   * но тупик забирает не больше своего объёма, излишек уходит в открытые.
   */
  const splitShares = (
    w: number, remaining: number,
    outs: Array<{ area: number; dead: number | null }>,
  ): number[] => {
    const total = outs.reduce((a, o) => a + o.area, 0) || 1;
    const shares = outs.map(o => w * o.area / total);
    if (remaining <= 0) return shares;
    const openIdx = outs.map((o, i) => (o.dead === null ? i : -1)).filter(i => i >= 0);
    if (openIdx.length === 0) return shares;
    let excess = 0;
    outs.forEach((o, i) => {
      if (o.dead === null) return;
      const cap = w * o.dead / remaining;
      if (cap < shares[i]) { excess += shares[i] - cap; shares[i] = cap; }
    });
    if (excess > 0) {
      const openArea = openIdx.reduce((a, i) => a + outs[i].area, 0) || 1;
      openIdx.forEach(i => { shares[i] += excess * outs[i].area / openArea; });
    }
    return shares;
  };

  /**
   * Доли пути в зоне загазования (wg) и в зоне продуктов (w) для исходящих
   * выработок. dead — объём замкнутой части сети за выработкой (null — открыта).
   */
  const splitBoth = (
    src: VgschSource, st: { V: number; wg: number; w: number },
    outs: Array<{ area: number; dead: number | null }>,
  ): Array<{ wg: number; w: number }> => {
    const V0 = src.V0_m3, pv = pvTotal(src);
    const Rg = Math.max(V0 - st.V, 0);
    const Rp = pv - Math.max(st.V, V0);
    const wg = Rg > 0 ? splitShares(st.wg, st.wg * Rg, outs) : outs.map(() => st.wg);
    const outs2 = outs.map((o, i) => ({
      area: o.area,
      dead: o.dead === null ? null : Math.max(o.dead - (Rg > 0 ? wg[i] * Rg : 0), 0),
    }));
    const w = Rp > 0 ? splitShares(st.w, st.w * Rp, outs2) : outs.map(() => st.w);
    return outs.map((_, i) => ({ wg: wg[i], w: w[i] }));
  };

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

  const nodeState = new Map<string, VgschState & { fromNode?: string; fromBranch?: string }>();
  /** Вход волны в ветвь (после узла): ключ `${branchId}:${0|1}`. */
  const edgeEntry = new Map<string, VgschState>();
  const pq: Array<{ id: string; st: VgschState & { fromNode?: string; fromBranch?: string } }> = [];
  const ratioOf = (st: VgschState) => {
    const s = sources.get(st.srcId);
    return s ? vgschRatio(s, st) : 0;
  };
  const push = (nid: string, st: VgschState & { fromNode?: string; fromBranch?: string }) => {
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

  // Старт: от точки очага в обе стороны своей ветви. Доли потока продуктов
  // по сторонам: поровну, но тупиковая сторона забирает не больше своего
  // объёма — остальное уходит в открытую сторону.
  const startShare = new Map<string, { from: { wg: number; w: number }; to: { wg: number; w: number } }>();
  for (const [bid, src] of sources) {
    const b = branchById.get(bid);
    if (!b || src.dPn_kPa <= 0) continue;
    const len = lenOf(b), g = geomOf(b), t = b.explosionT ?? 0.5;
    const sideVol = (nodeId: string, backId: string, part: number): number | null => {
      if (nodeById.get(nodeId)?.atmosphereLink) return null;
      const rest = deadVolume(nodeId, backId, bid);
      return rest === null ? null : rest + len * part * g.area;
    };
    const [shF, shT] = splitBoth(src, { V: 0, wg: 1, w: 1 }, [
      { area: g.area, dead: sideVol(b.fromId, b.toId, t) },
      { area: g.area, dead: sideVol(b.toId, b.fromId, 1 - t) },
    ]);
    startShare.set(bid, { from: shF, to: shT });
    const base: VgschState = { d: 0, V: 0, wg: 1, w: 1, det: 1, mult: 1, srcId: bid };
    const stF = { ...base, ...shF }, stT = { ...base, ...shT };
    const toFrom = advance(src, g, stF, len * t);
    const toTo = advance(src, g, stT, len * (1 - t));
    const kF = cross(bid, g, len, stF, t, 0);
    const kT = cross(bid, g, len, stT, t, 1);
    if (kF > 0 && !nodeById.get(b.fromId)?.atmosphereLink) push(b.fromId, { ...toFrom, mult: toFrom.mult * kF, fromNode: b.toId, fromBranch: bid });
    if (kT > 0 && !nodeById.get(b.toId)?.atmosphereLink) push(b.toId, { ...toTo, mult: toTo.mult * kT, fromNode: b.fromId, fromBranch: bid });
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
    const out = edges.filter(e => e.branchId !== st.fromBranch);
    if (out.length === 0) continue;
    const inEdge = edges.find(e => e.branchId === st.fromBranch);
    const inArea = inEdge?.g.area ?? out[0].g.area;
    const pNode = nodeById.get(cur), pPrev = inEdge ? nodeById.get(inEdge.to) : undefined;
    const isDet = detached(src, st);

    // Тупик длиннее 130 м в узле снижает давление в остальных направлениях на 10 %
    const longDeadEnd = isDet && out.some(e => degree(e.to) === 1 && e.len > VGSCH_DEADEND_M
      && !nodeById.get(e.to)?.atmosphereLink);

    // Геометрия узла: отклонение каждого направления и «прямое» продолжение
    const defl = out.map(e => deflectionDeg(pPrev, pNode, nodeById.get(e.to)));
    let straightIdx = -1;
    defl.forEach((a, i) => {
      if (a <= TURN_ANGLE_DEG && (straightIdx < 0 || a < defl[straightIdx])) straightIdx = i;
    });
    // Угол боковой ветви для прохода прямо через сопряжение (п. 6–8)
    const sideAngles = defl.filter((_, i) => i !== straightIdx);
    const sideGamma = sideAngles.length ? Math.min(...sideAngles) : 90;

    // Доли потока продуктов взрыва (пока волна подпирается продуктами)
    const shares = !isDet
      ? splitBoth(src, st, out.map(e => ({
          area: e.g.area,
          dead: nodeById.get(e.to)?.atmosphereLink ? null : (() => {
            const rest = deadVolume(e.to, cur, e.branchId);
            return rest === null ? null : rest + e.len * e.g.area;
          })(),
        })))
      : out.map(() => ({ wg: st.wg, w: st.w }));

    out.forEach((e, idx) => {
      const toNode = nodeById.get(e.to);
      let entry: VgschState = { ...st };
      if (isDet) {
        // Местное сопротивление: Кзат по табл. 5
        const kind = localResistanceKind(defl[idx], out.length, idx === straightIdx);
        const gamma = kind === "through" ? sideGamma : defl[idx];
        const delta = inArea > 0 ? e.g.area / inArea : 1;
        const pMPa = src.dPn_kPa * vgschRatio(src, st) / 1000;
        let k = kzat(kind, delta, pMPa, gamma);
        if (longDeadEnd && !(degree(e.to) === 1 && e.len > VGSCH_DEADEND_M)) k *= 0.9;
        entry = { ...entry, mult: entry.mult * k };
      } else {
        // Продукты взрыва делятся между выработками; общий объём V не меняется —
        // поэтому давление на развилке без скачка
        entry = { ...entry, ...shares[idx] };
      }
      setEntry(`${e.branchId}:${e.tStart}`, entry);
      if (toNode?.atmosphereLink) return;
      const kBar = cross(e.branchId, e.g, e.len, entry, e.tStart, e.tStart === 0 ? 1 : 0);
      const endSt = advance(src, e.g, entry, e.len);
      const next = { ...endSt, mult: endSt.mult * kBar, fromNode: cur, fromBranch: e.branchId };
      if (vgschRatio(src, next) * src.dPn_kPa < 0.5) return;
      push(e.to, next);
    });
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
      const sh = startShare.get(branchId);
      const part = sh ? (t < tSrc ? sh.from : sh.to) : { wg: 0.5, w: 0.5 };
      consider({ d: 0, V: 0, ...part, det: 1, mult: 1, srcId: branchId }, Math.abs(t - tSrc) * len, tSrc);
    }
    return best;
  };

  return { nodeState, pressureAt, hits };
}
