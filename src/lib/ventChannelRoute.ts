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

export type RouteEndKind = "surface" | "shaft" | "fork" | "dead" | "manual";

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
    // Сопряжение со стволом: в узел входит вертикальная выработка, а мы пришли не по ней
    if (!isVertical(cur, thr) && inc.some(b => isVertical(b, thr))) {
      return { branches: out, nodes, end: { nodeId: u, kind: "shaft" } };
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
  const flip = start.kind === "shaft" && end.kind !== "shaft" || (end.kind === "surface" && start.kind !== "surface");
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
