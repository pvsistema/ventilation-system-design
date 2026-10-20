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

export interface RouteOptions {
  /**
   * Ветви, закрытые для воздуха: глухие перемычки, закрытые двери, стенки.
   * Открытые двери и проёмы сюда не входят — через них струя проходит.
   */
  closed?: Set<string>;
  /** Расчёт сети выполнен: расход и направление струи в ветвях достоверны. */
  solved?: boolean;
}

/** Как удалось построить маршрут — от лучшего к запасному варианту. */
export type RouteMode = "flow" | "open" | "length";

export interface ABRoute {
  branchIds: string[];
  nodeIds: string[];
  mode: RouteMode;
  /** Наименьший расход на маршруте, м³/с (слабое звено), 0 — без расчёта. */
  minQ: number;
  /** Длина маршрута, м. */
  length: number;
}

const FLOW_EPS = 1e-3;

/**
 * Маршрут канала между узлами А и Б через ветвь вентилятора.
 *
 * Канал ГВУ — это главная струя: весь воздух вентилятора идёт по нему одной
 * трубой. Поэтому маршрут выбирается не по длине, а по воздуху:
 *   1) через закрытые перемычки, глухие стенки и двери путь не идёт —
 *      открытые двери и проёмы проходимы;
 *   2) после расчёта сети — только по ветвям с расходом и строго по ходу
 *      струи (А → вентилятор → Б либо целиком навстречу, если А на выдаче);
 *   3) из возможных путей берётся тот, у которого слабое звено пропускает
 *      наибольший расход (самая «толстая» струя), а длина решает только при
 *      равном расходе.
 * Раньше брался кратчайший по длине путь без этих условий — он срезал через
 * сбойки с ничтожным расходом и проходил сквозь закрытые перемычки.
 *
 * Если по струе пути нет (например, расчёт не выполнен или узел выбран вне
 * главной струи), ищется путь через открытые выработки, а в крайнем случае —
 * прежний кратчайший; mode сообщает, какой вариант сработал.
 */
export function routeBetweenNodes(
  fan: TopoBranch,
  aNode: string,
  bNode: string,
  branches: TopoBranch[],
  opts: RouteOptions = {},
): ABRoute | null {
  const closed = opts.closed ?? new Set<string>();
  const hasFlow = !!opts.solved && branches.some(b => Math.abs(b.flow ?? 0) > FLOW_EPS);
  const usable = branches.filter(x => !x.isLeakage);
  const adj = buildAdjacency(usable);
  const q = (e: TopoBranch) => Math.round(Math.abs(e.flow ?? 0) * 100) / 100;

  /**
   * dir: +1 — идём по ходу струи, −1 — навстречу, 0 — направление не важно.
   * useFlow — критерий «наибольший расход слабого звена», иначе только длина.
   */
  const search = (
    src: string, dst: string, banned: Set<string>, bannedNodes: Set<string>,
    dir: 0 | 1 | -1, useFlow: boolean, skipClosed: boolean,
  ) => {
    if (src === dst) return { ids: [] as string[], nodes: [src], len: 0, minQ: Infinity };
    const lab = new Map<string, { w: number; len: number }>([[src, { w: Infinity, len: 0 }]]);
    const prev = new Map<string, { node: string; br: string }>();
    const done = new Set<string>();
    const better = (a: { w: number; len: number }, b?: { w: number; len: number }) =>
      !b || (useFlow ? (a.w > b.w || (a.w === b.w && a.len < b.len)) : a.len < b.len);
    for (;;) {
      let u: string | null = null, best: { w: number; len: number } | undefined;
      for (const [k, v] of lab) if (!done.has(k) && better(v, best)) { best = v; u = k; }
      if (u === null || !best) return null;
      if (u === dst) break;
      done.add(u);
      for (const e of adj.get(u) ?? []) {
        if (banned.has(e.id)) continue;
        if (skipClosed && closed.has(e.id)) continue;
        if (dir !== 0) {
          const f = e.flow ?? 0;
          if (Math.abs(f) <= FLOW_EPS) continue;
          // Ход воздуха в ветви: from→to при f > 0, иначе to→from.
          const airFrom = f > 0 ? e.fromId : e.toId;
          if (dir > 0 ? airFrom !== u : airFrom === u) continue;
        }
        const w = other(e, u);
        if (done.has(w)) continue;
        if (bannedNodes.has(w) && w !== dst) continue;
        const cand = { w: Math.min(best.w, q(e)), len: best.len + Math.max(0.01, e.length || 0) };
        if (better(cand, lab.get(w))) { lab.set(w, cand); prev.set(w, { node: u, br: e.id }); }
      }
    }
    const ids: string[] = [], nds: string[] = [dst];
    let c = dst;
    while (c !== src) { const pv = prev.get(c)!; ids.unshift(pv.br); nds.unshift(pv.node); c = pv.node; }
    const end = lab.get(dst)!;
    return { ids, nodes: nds, len: end.len, minQ: end.w };
  };

  const attempt = (dir: 0 | 1 | -1, useFlow: boolean, skipClosed: boolean) => {
    const tryDir = (p: string, qn: string) => {
      if (dir !== 0) {
        // Сам вентилятор должен стоять по ходу выбранного направления.
        const f = fan.flow ?? 0;
        if (Math.abs(f) > FLOW_EPS) {
          const airFrom = f > 0 ? fan.fromId : fan.toId;
          if (dir > 0 ? airFrom !== p : airFrom === p) return null;
        }
      }
      const left = search(aNode, p, new Set([fan.id]), new Set([qn]), dir, useFlow, skipClosed);
      if (!left) return null;
      const right = search(qn, bNode, new Set([fan.id, ...left.ids]), new Set(left.nodes), dir, useFlow, skipClosed);
      if (!right) return null;
      return {
        branchIds: [...left.ids, fan.id, ...right.ids],
        nodeIds: [...left.nodes, ...right.nodes],
        minQ: Math.min(left.minQ, right.minQ, hasFlow ? q(fan) : Infinity),
        length: left.len + right.len + Math.max(0, fan.length || 0),
      };
    };
    const cands = [tryDir(fan.fromId, fan.toId), tryDir(fan.toId, fan.fromId)]
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (!cands.length) return null;
    cands.sort((x, y) => (useFlow && x.minQ !== y.minQ ? y.minQ - x.minQ : x.length - y.length));
    return cands[0];
  };

  const fin = (r: NonNullable<ReturnType<typeof attempt>>, mode: RouteMode): ABRoute => ({
    branchIds: r.branchIds, nodeIds: r.nodeIds, mode,
    minQ: isFinite(r.minQ) ? r.minQ : 0, length: r.length,
  });

  if (hasFlow) {
    // По струе: А на всасе (воздух идёт А → Б) или на выдаче (Б → А).
    const fwd = attempt(1, true, true);
    const bwd = attempt(-1, true, true);
    const pick = !fwd ? bwd : !bwd ? fwd
      : (fwd.minQ !== bwd.minQ ? (fwd.minQ > bwd.minQ ? fwd : bwd) : (fwd.length <= bwd.length ? fwd : bwd));
    if (pick) return fin(pick, "flow");
    const open = attempt(0, true, true);
    if (open) return fin(open, "open");
  } else {
    const open = attempt(0, false, true);
    if (open) return fin(open, "open");
  }
  const any = attempt(0, false, false);
  return any ? fin(any, "length") : null;
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

/**
 * Упорядочивает произвольный набор ветвей (выбранных вручную на схеме) в
 * непрерывную линию. Если набор — простая цепочка, ветви выстраиваются от
 * одного её конца к другому (начало — узел связи с атмосферой, если он на
 * конце; иначе — сохраняется прежняя ориентация). Если ветви не образуют одну
 * цепочку (разрыв или развилка), порядок выбора сохраняется, chain = false.
 */
export function orderBranchChain(
  ids: string[],
  byId: Map<string, TopoBranch>,
  nodeById: Map<string, TopoNode>,
  prevFirstNode?: string,
): { branchIds: string[]; nodeIds: string[]; chain: boolean; problem?: "gap" | "fork" } {
  const list = ids.map(id => byId.get(id)).filter(Boolean) as TopoBranch[];
  if (list.length === 0) return { branchIds: [], nodeIds: [], chain: true };
  if (list.length === 1) {
    const b = list[0];
    const flip = (nodeById.get(b.toId)?.atmosphereLink && !nodeById.get(b.fromId)?.atmosphereLink) || prevFirstNode === b.toId;
    return { branchIds: [b.id], nodeIds: flip ? [b.toId, b.fromId] : [b.fromId, b.toId], chain: true };
  }
  const deg = new Map<string, TopoBranch[]>();
  for (const b of list) for (const n of [b.fromId, b.toId]) {
    if (!deg.has(n)) deg.set(n, []);
    deg.get(n)!.push(b);
  }
  if ([...deg.values()].some(v => v.length > 2)) {
    return { branchIds: list.map(b => b.id), nodeIds: [], chain: false, problem: "fork" };
  }
  const endsN = [...deg.entries()].filter(([, v]) => v.length === 1).map(([k]) => k);
  if (endsN.length !== 2) {
    return { branchIds: list.map(b => b.id), nodeIds: [], chain: false, problem: "gap" };
  }
  let start = endsN[0];
  const atm = (n: string) => !!nodeById.get(n)?.atmosphereLink;
  if (atm(endsN[1]) && !atm(endsN[0])) start = endsN[1];
  else if (!atm(endsN[0]) && prevFirstNode && endsN.includes(prevFirstNode)) start = prevFirstNode;
  const outIds: string[] = [];
  const outNodes: string[] = [start];
  const used = new Set<string>();
  let u = start;
  for (let i = 0; i < list.length; i++) {
    const e = (deg.get(u) ?? []).find(x => !used.has(x.id));
    if (!e) break;
    used.add(e.id); outIds.push(e.id);
    u = other(e, u); outNodes.push(u);
  }
  if (outIds.length !== list.length) {
    return { branchIds: list.map(b => b.id), nodeIds: [], chain: false, problem: "gap" };
  }
  return { branchIds: outIds, nodeIds: outNodes, chain: true };
}
