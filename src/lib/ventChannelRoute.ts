// ─────────────────────────────────────────────────────────────────────────────
// Маршрут вентиляционного канала ГВУ.
//
// Вентиляционный канал — это не одна ветвь с вентилятором, а цепочка выработок:
// ветвь, в которой установлен вентилятор, и все последовательные ветви от неё
// до сопряжения с вертикальным стволом (с другой стороны — до выхода на
// поверхность / узла связи с атмосферой).
//
// Автотрассировка идёт от ветви вентилятора в обе стороны по «простым» узлам
// (в узле ровно одна следующая ветвь) и останавливается, когда:
//   • узел связан с атмосферой            → «поверхность»;
//   • в узел входит вертикальная выработка → «сопряжение со стволом»;
//   • узел — развилка (≥2 следующих ветви) → «развилка»;
//   • следующей ветви нет                  → «тупик».
// Вертикальной считается ветвь с |угол| ≥ порога (по умолчанию 60°).
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch, TopoNode } from "@/lib/topology";

export type RouteEndKind = "surface" | "surfaceShaft" | "shaft" | "fork" | "dead" | "manual";

export interface RouteEnd {
  nodeId: string;
  kind: RouteEndKind;
}

export interface ChannelRoute {
  /** Ветви по порядку: от начала (обычно поверхность) к концу (обычно ствол) */
  branchIds: string[];
  /** Узлы по порядку: на 1 больше, чем ветвей */
  nodeIds: string[];
  start: RouteEnd;
  end: RouteEnd;
}

export const END_LABEL: Record<RouteEndKind, string> = {
  surface: "поверхность",
  surfaceShaft: "сопряжение с выходом на поверхность",
  shaft: "сопряжение со стволом",
  fork: "развилка",
  dead: "тупик",
  manual: "задано вручную",
};

export function isVertical(b: TopoBranch, thr: number): boolean {
  return Math.abs(b.angle ?? 0) >= thr;
}

export function buildAdjacency(branches: TopoBranch[]): Map<string, TopoBranch[]> {
  const adj = new Map<string, TopoBranch[]>();
  for (const b of branches) {
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    adj.get(b.fromId)!.push(b);
    adj.get(b.toId)!.push(b);
  }
  return adj;
}

const other = (b: TopoBranch, nodeId: string) => (b.fromId === nodeId ? b.toId : b.fromId);

/**
 * Вертикальная выработка из узла выходит на поверхность: идём по цепочке
 * вертикальных ветвей вверх и проверяем, есть ли на ней узел связи с
 * атмосферой. Такой узел — сопряжение с выходом на поверхность (устье
 * ствола/шурфа), а не подземное сопряжение со стволом.
 */
function verticalLeadsToSurface(
  nodeId: string, vert: TopoBranch, adj: Map<string, TopoBranch[]>,
  nodeById: Map<string, TopoNode>, thr: number,
): boolean {
  const seen = new Set<string>([vert.id]);
  const stack: string[] = [other(vert, nodeId)];
  const visitedNodes = new Set<string>([nodeId]);
  while (stack.length) {
    const u = stack.pop()!;
    if (visitedNodes.has(u)) continue;
    visitedNodes.add(u);
    if (nodeById.get(u)?.atmosphereLink) return true;
    for (const e of adj.get(u) ?? []) {
      if (seen.has(e.id) || !isVertical(e, thr)) continue;
      seen.add(e.id);
      stack.push(other(e, u));
    }
  }
  return false;
}

/** Тип узла-сопряжения с вертикальной выработкой: ствол или выход на поверхность. */
function shaftKind(
  nodeId: string, verts: TopoBranch[], adj: Map<string, TopoBranch[]>,
  nodeById: Map<string, TopoNode>, thr: number,
): RouteEndKind {
  return verts.some(v => !verticalLeadsToSurface(nodeId, v, adj, nodeById, thr)) ? "shaft" : "surfaceShaft";
}

/** Идём от узла startNode, пришли по ветви prev. Возвращает ветви и узлы пути. */
function walk(
  startNode: string,
  prev: TopoBranch,
  adj: Map<string, TopoBranch[]>,
  nodeById: Map<string, TopoNode>,
  used: Set<string>,
  thr: number,
): { branches: TopoBranch[]; nodes: string[]; end: RouteEnd } {
  const out: TopoBranch[] = [];
  const nodes: string[] = [];
  let u = startNode;
  let cur = prev;
  for (let step = 0; step < 500; step++) {
    const node = nodeById.get(u);
    if (node?.atmosphereLink) return { branches: out, nodes, end: { nodeId: u, kind: "surface" } };
    const inc = (adj.get(u) ?? []).filter(b => b.id !== cur.id && !used.has(b.id) && !b.isLeakage);
    // Сопряжение с вертикальной выработкой (мы пришли не по ней): подземный
    // ствол или выход на поверхность — различаем по тому, ведёт ли вертикаль
    // к узлу связи с атмосферой.
    const verts = inc.filter(b => isVertical(b, thr));
    if (!isVertical(cur, thr) && verts.length > 0) {
      return { branches: out, nodes, end: { nodeId: u, kind: shaftKind(u, verts, adj, nodeById, thr) } };
    }
    if (inc.length === 0) return { branches: out, nodes, end: { nodeId: u, kind: "dead" } };
    if (inc.length > 1) return { branches: out, nodes, end: { nodeId: u, kind: "fork" } };
    const nx = inc[0];
    used.add(nx.id);
    out.push(nx);
    u = other(nx, u);
    nodes.push(u);
    cur = nx;
  }
  return { branches: out, nodes, end: { nodeId: u, kind: "dead" } };
}

/** Автоматическая трассировка канала от ветви вентилятора. */
export function traceChannelRoute(
  fan: TopoBranch,
  branches: TopoBranch[],
  nodes: TopoNode[],
  thr = 60,
): ChannelRoute {
  const adj = buildAdjacency(branches);
  const nodeById = new Map(nodes.map(n => [n.id, n] as const));
  const used = new Set<string>([fan.id]);
  const a = walk(fan.fromId, fan, adj, nodeById, used, thr);
  const b = walk(fan.toId, fan, adj, nodeById, used, thr);

  // Сторона «a» идёт от fromId, «b» — от toId. Собираем: a(reversed) → fan → b
  let ids = [...a.branches.map(x => x.id).reverse(), fan.id, ...b.branches.map(x => x.id)];
  let nIds = [...[...a.nodes].reverse(), fan.fromId, fan.toId, ...b.nodes];
  let start = a.end;
  let end = b.end;

  // Ориентируем: ствол — в конце, поверхность — в начале
  const isSurf = (k: RouteEndKind) => k === "surface" || k === "surfaceShaft";
  const flip = (start.kind === "shaft" && end.kind !== "shaft") || (isSurf(end.kind) && !isSurf(start.kind));
  if (flip) {
    ids = ids.reverse();
    nIds = nIds.reverse();
    [start, end] = [end, start];
  }
  return { branchIds: ids, nodeIds: nIds, start, end };
}

/** Восстанавливает порядок узлов для произвольного (отредактированного) списка ветвей. */
export function routeNodes(ids: string[], byId: Map<string, TopoBranch>): string[] {
  if (ids.length === 0) return [];
  const first = byId.get(ids[0]);
  if (!first) return [];
  if (ids.length === 1) return [first.fromId, first.toId];
  const second = byId.get(ids[1]);
  let startNode = first.fromId;
  if (second && (second.fromId === first.fromId || second.toId === first.fromId)) startNode = first.toId;
  const res = [startNode];
  let u = startNode;
  for (const id of ids) {
    const b = byId.get(id);
    if (!b) break;
    u = other(b, u);
    res.push(u);
  }
  return res;
}

/**
 * Маршрут канала между узлами А и Б, обязательно проходящий через ветвь
 * вентилятора: путь А → (один конец вентилятора) + вентилятор + (другой
 * конец) → Б. Каждая половина — кратчайшая по длине (Дейкстра), ветвь
 * вентилятора и ветви первой половины во второй не используются. Из двух
 * ориентаций вентилятора берётся более короткая. null — пути нет.
 */
export function routeBetweenNodes(
  fan: TopoBranch,
  aNode: string,
  bNode: string,
  branches: TopoBranch[],
): { branchIds: string[]; nodeIds: string[] } | null {
  const adj = buildAdjacency(branches.filter(x => !x.isLeakage));
  const shortest = (src: string, dst: string, banned: Set<string>, bannedNodes: Set<string>) => {
    if (src === dst) return { ids: [] as string[], nodes: [src], len: 0 };
    const dist = new Map<string, number>([[src, 0]]);
    const prev = new Map<string, { node: string; br: string }>();
    const done = new Set<string>();
    for (;;) {
      let u: string | null = null, best = Infinity;
      for (const [k, v] of dist) if (!done.has(k) && v < best) { best = v; u = k; }
      if (u === null) return null;
      if (u === dst) break;
      done.add(u);
      for (const e of adj.get(u) ?? []) {
        if (banned.has(e.id)) continue;
        const w = other(e, u);
        if (bannedNodes.has(w) && w !== dst) continue;
        const d = best + Math.max(0.01, e.length || 0);
        if (d < (dist.get(w) ?? Infinity)) { dist.set(w, d); prev.set(w, { node: u, br: e.id }); }
      }
    }
    const ids: string[] = [], nds: string[] = [dst];
    let c = dst;
    while (c !== src) { const p = prev.get(c)!; ids.unshift(p.br); nds.unshift(p.node); c = p.node; }
    return { ids, nodes: nds, len: dist.get(dst)! };
  };
  const tryDir = (p: string, q: string) => {
    const left = shortest(aNode, p, new Set([fan.id]), new Set([q]));
    if (!left) return null;
    const used = new Set([fan.id, ...left.ids]);
    const right = shortest(q, bNode, used, new Set(left.nodes));
    if (!right) return null;
    return {
      branchIds: [...left.ids, fan.id, ...right.ids],
      nodeIds: [...left.nodes, ...right.nodes],
      len: left.len + right.len,
    };
  };
  const r1 = tryDir(fan.fromId, fan.toId);
  const r2 = tryDir(fan.toId, fan.fromId);
  const r = !r1 ? r2 : !r2 ? r1 : (r1.len <= r2.len ? r1 : r2);
  return r ? { branchIds: r.branchIds, nodeIds: r.nodeIds } : null;
}

/** Фактический тип конца маршрута по узлу (для подписи). */
export function classifyEnd(nodeId: string, prevBranchId: string | undefined, branches: TopoBranch[], nodes: TopoNode[], thr: number): RouteEndKind {
  const nodeById = new Map(nodes.map(n => [n.id, n] as const));
  if (nodeById.get(nodeId)?.atmosphereLink) return "surface";
  const adj = buildAdjacency(branches.filter(x => !x.isLeakage));
  const inc = (adj.get(nodeId) ?? []).filter(x => x.id !== prevBranchId);
  const prev = branches.find(x => x.id === prevBranchId);
  const verts = inc.filter(x => isVertical(x, thr));
  if (prev && !isVertical(prev, thr) && verts.length > 0) return shaftKind(nodeId, verts, adj, nodeById, thr);
  if (inc.length === 0) return "dead";
  if (inc.length > 1) return "fork";
  return "manual";
}
