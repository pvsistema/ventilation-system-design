import type { TopoNode, TopoBranch } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { BULKHEAD_SYMBOL_IDS, OPEN_DOOR_IDS, WINDOW_BULKHEAD_IDS } from "@/lib/schemaSymbols";

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface DepressogramPoint {
  nodeId: string;
  nodeName: string;
  nodeNumber: string;
  branchId: string | null;
  branchName: string;
  branchNumber: string | null;
  cumulativeLength: number;
  pressure: number;
  dP: number;
}

// ─── Какие перемычки преграждают маршрут ─────────────────────────────────────
// Маршрут депрессиограммы идёт по СВОБОДНЫМ выработкам. Преграда — глухие и
// закрытые сооружения: глухие и взрывоустойчивые перемычки, закрытые и
// автоматические двери, водоподпорные, противопожарные, барьерные. Утечка
// через закрытую дверь (сотни Па на ней) — не повод вести через неё маршрут:
// раньше любая ветвь с расходом > 0,05 м³/с считалась проходимой.
// Проходимы: открытые двери/проёмы, окна, решётки, регуляторы, паруса и
// разрушенные взрывом перемычки.
const PASSABLE_SYMBOL_IDS = new Set([...OPEN_DOOR_IDS, ...WINDOW_BULKHEAD_IDS, "sail", "regulator"]);

function isBlockingSymbol(s: SchemaSymbol): boolean {
  if (PASSABLE_SYMBOL_IDS.has(s.typeId)) return false;
  // Окно, заданное в свойствах значка, — сооружение с проходом.
  if ((s.bkWindowArea ?? 0) > 0.001) return false;
  return true;
}

function isBlockingBranch(b: TopoBranch, symsByBranch: Map<string, SchemaSymbol[]>): boolean {
  if (b.bulkheadDestroyedByExplosion) return false;
  const syms = symsByBranch.get(b.id) ?? [];
  if (syms.length > 0) return syms.some(s => isBlockingSymbol(s));
  // Перемычка задана только во вкладке ветви, без значка на схеме.
  if (!b.hasBulkhead) return false;
  if ((b.bulkheadWindowArea ?? 0) > 0) return false;
  if (/парус|открыт|окн|решёт|решет|регулятор/i.test(b.bulkheadName ?? "")) return false;
  return true;
}

/** Ветви, через которые маршрут депрессиограммы не проходит (для подсказок). */
export function blockedBranchIds(branches: TopoBranch[], symbols: SchemaSymbol[] = []): Set<string> {
  const map = symbolsByBranch(symbols);
  return new Set(branches.filter(b => isBlockingBranch(b, map)).map(b => b.id));
}

function symbolsByBranch(symbols: SchemaSymbol[]): Map<string, SchemaSymbol[]> {
  const m = new Map<string, SchemaSymbol[]>();
  for (const s of symbols) {
    if (!s.branchId || !BULKHEAD_SYMBOL_IDS.has(s.typeId)) continue;
    (m.get(s.branchId) ?? m.set(s.branchId, []).get(s.branchId)!).push(s);
  }
  return m;
}

// ─── Алгоритм: маршрут наибольшего расхода воздуха от ГВУ до поверхности ──────
// НОРМАТИВ: маршрут, определяющий аэродинамическое сопротивление шахтной сети —
// путь, по которому проходит НАИБОЛЬШЕЕ КОЛИЧЕСТВО ВОЗДУХА (расход Q) от
// поверхности (воздухоподающий ствол) до ГВУ, не перекрытый глухими и
// закрытыми перемычками.
//
// Реализация (сеть рассчитана): «самый широкий путь» — среди всех путей ПО
// НАПРАВЛЕНИЮ ДВИЖЕНИЯ ВОЗДУХА от шахтного конца ГВУ до поверхностного узла
// выбирается тот, у которого наименьший расход на пути наибольший. При равенстве —
// с большей суммарной депрессией. Так маршрут не уходит в тупики, как раньше
// жадный обход, и идёт по реальной струе, а не против неё.
// Если сеть не рассчитана (расходов нет) — прежний жадный обход.
//
// ВГП выбирается автоматически (приоритет типу "ГВУ"), либо явно задаётся
// параметром preferredFanBranchId. При нескольких ВГП берётся маршрут с
// наибольшим расходом воздуха через ГВУ.
export function findMainRoute(
  nodes: TopoNode[],
  branches: TopoBranch[],
  preferredFanBranchId?: string,
  symbols: SchemaSymbol[] = [],
): { path: string[]; branchPath: string[]; fanId?: string } | null {
  const surfaceNodeIds = new Set(nodes.filter(n => n.atmosphereLink).map(n => n.id));
  if (surfaceNodeIds.size === 0) return null;
  const symsByBranch = symbolsByBranch(symbols);

  type Edge = { branchId: string; neighborId: string; flow: number; dP: number; blocking: boolean; blockingFan: boolean; signedOut: number };
  // signedOut — расход, ВЫХОДЯЩИЙ из текущего узла по этой ветви (+ — воздух
  // уходит к соседу, − — приходит от соседа).
  const adj = new Map<string, Edge[]>();
  for (const b of branches) {
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    const blockingFan = b.hasFan && !b.fanStopped && b.fanType !== "ВМП";
    const q = b.flow ?? 0;
    const entry = { branchId: b.id, flow: Math.abs(q), dP: Math.abs(b.dPTotal ?? b.dP ?? 0), blocking: isBlockingBranch(b, symsByBranch), blockingFan };
    adj.get(b.fromId)!.push({ ...entry, neighborId: b.toId, signedOut: q });
    adj.get(b.toId)!.push({ ...entry, neighborId: b.fromId, signedOut: -q });
  }

  let fanBranches = branches.filter(b => b.hasFan && !b.fanStopped);
  if (preferredFanBranchId) {
    const preferred = branches.find(b => b.id === preferredFanBranchId);
    fanBranches = preferred ? [preferred] : fanBranches;
  } else {
    const gvu = fanBranches.filter(b => b.fanType === "ГВУ");
    if (gvu.length > 0) fanBranches = gvu;
  }
  if (fanBranches.length === 0) return null;

  let bestPath: string[] = [];
  let bestBranchPath: string[] = [];
  let bestFlow = -1;
  let bestFanId: string | undefined;

  const MIN_Q = 0.05;

  for (const fan of fanBranches) {
    const flow = fan.flow ?? 0;
    let shaftNodeId: string;
    let surfNodeId: string;
    if (Math.abs(flow) < 0.001) {
      if (surfaceNodeIds.has(fan.toId)) { shaftNodeId = fan.fromId; surfNodeId = fan.toId; }
      else { shaftNodeId = fan.toId; surfNodeId = fan.fromId; }
    } else if (flow > 0) {
      shaftNodeId = fan.fromId; surfNodeId = fan.toId;
    } else {
      shaftNodeId = fan.toId; surfNodeId = fan.fromId;
    }
    if (surfaceNodeIds.has(shaftNodeId) && !surfaceNodeIds.has(surfNodeId)) {
      [shaftNodeId, surfNodeId] = [surfNodeId, shaftNodeId];
    }
    // Всасывающая ГВУ: воздух идёт шахта → ГВУ → поверхность, маршрут ищем
    // ПРОТИВ струи от шахтного конца. Нагнетательная — по струе.
    const fanQ = Math.abs(flow);
    const exhaust = fanQ < 0.001
      ? true
      : (flow > 0 ? fan.fromId === shaftNodeId : fan.toId === shaftNodeId);

    let nodePath: string[] = [];
    let branchPath: string[] = [];

    if (fanQ >= 0.001) {
      // ── Самый широкий путь по направлению струи ──
      const width = new Map<string, number>([[shaftNodeId, Infinity]]);
      const depth = new Map<string, number>([[shaftNodeId, 0]]);
      const prev = new Map<string, { node: string; branch: string }>();
      const done = new Set<string>([surfNodeId]);
      const queue: string[] = [shaftNodeId];
      let target: string | null = null;
      while (queue.length > 0) {
        let bi = 0;
        for (let i = 1; i < queue.length; i++) {
          const a = queue[i], c = queue[bi];
          const wa = width.get(a)!, wc = width.get(c)!;
          if (wa > wc || (wa === wc && (depth.get(a)! > depth.get(c)!))) bi = i;
        }
        const cur = queue.splice(bi, 1)[0];
        if (done.has(cur)) continue;
        done.add(cur);
        if (cur !== shaftNodeId && surfaceNodeIds.has(cur)) { target = cur; break; }
        for (const e of adj.get(cur) ?? []) {
          if (e.blocking || e.blockingFan || done.has(e.neighborId)) continue;
          // Всасывающая: идём против струи — воздух ПРИХОДИТ в cur от соседа.
          const along = exhaust ? -e.signedOut : e.signedOut;
          if (along < MIN_Q) continue;
          const w = Math.min(width.get(cur)!, e.flow);
          const d = depth.get(cur)! + e.dP;
          const ow = width.get(e.neighborId);
          if (ow === undefined || w > ow || (w === ow && d > (depth.get(e.neighborId) ?? 0))) {
            width.set(e.neighborId, w);
            depth.set(e.neighborId, d);
            prev.set(e.neighborId, { node: cur, branch: e.branchId });
            queue.push(e.neighborId);
          }
        }
      }
      if (target) {
        const nodesRev: string[] = [target];
        const brRev: string[] = [];
        let n = target;
        while (n !== shaftNodeId) {
          const p = prev.get(n)!;
          brRev.push(p.branch);
          nodesRev.push(p.node);
          n = p.node;
        }
        // nodesRev: поверхность → … → шахтный конец ГВУ
        nodePath = nodesRev.reverse();   // шахтный конец → … → поверхность
        branchPath = brRev.reverse();
      }
    }

    if (branchPath.length === 0) {
      // ── Запасной вариант: жадный обход по максимальному расходу ──
      const visited = new Set<string>([shaftNodeId, surfNodeId]);
      nodePath = [shaftNodeId];
      branchPath = [];
      let current = shaftNodeId;
      for (let steps = 0; steps < 2000; steps++) {
        const chosen = (adj.get(current) ?? [])
          .filter(n => !visited.has(n.neighborId) && !n.blocking && !n.blockingFan)
          .sort((a, b) => b.flow - a.flow)[0];
        if (!chosen) break;
        visited.add(chosen.neighborId);
        nodePath.push(chosen.neighborId);
        branchPath.push(chosen.branchId);
        current = chosen.neighborId;
      }
    }

    // Порядок по движению воздуха. Всасывающая: поверхность → … → ГВУ → поверхность.
    // Нагнетательная: поверхность → ГВУ → … → выход на поверхность.
    const fullNodes = exhaust
      ? [...[...nodePath].reverse(), surfNodeId]
      : [surfNodeId, ...nodePath];
    const fullBranches = exhaust
      ? [...[...branchPath].reverse(), fan.id]
      : [fan.id, ...branchPath];

    if (fanQ > bestFlow && fullBranches.length > 1) {
      bestFlow = fanQ;
      bestPath = fullNodes;
      bestBranchPath = fullBranches;
      bestFanId = fan.id;
    }
  }

  if (bestBranchPath.length === 0) return null;
  return { path: bestPath, branchPath: bestBranchPath, fanId: bestFanId };
}

// ─── Построение точек депрессиограммы ────────────────────────────────────────
export function buildPointsFromBranchIds(
  branchIds: string[],
  nodes: TopoNode[],
  branches: TopoBranch[]
): DepressogramPoint[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const branchMap = new Map(branches.map(b => [b.id, b]));
  if (branchIds.length === 0) return [];

  type ChainItem = { b: TopoBranch; fromId: string; toId: string };
  const chain: ChainItem[] = [];
  const first = branchMap.get(branchIds[0]);
  if (!first) return [];
  chain.push({ b: first, fromId: first.fromId, toId: first.toId });

  for (let i = 1; i < branchIds.length; i++) {
    const b = branchMap.get(branchIds[i]);
    if (!b) continue;
    const prev = chain[chain.length - 1];
    if (b.fromId === prev.toId) chain.push({ b, fromId: b.fromId, toId: b.toId });
    else if (b.toId === prev.toId) chain.push({ b, fromId: b.toId, toId: b.fromId });
    else chain.push({ b, fromId: b.fromId, toId: b.toId });
  }

  let totalDP = 0;
  for (const c of chain) totalDP += Math.abs(c.b.dP ?? 0);

  const points: DepressogramPoint[] = [];
  let cumLen = 0;
  let pressure = totalDP;

  const firstNode = nodeMap.get(chain[0].fromId);
  points.push({ nodeId: chain[0].fromId, nodeName: firstNode?.name ?? "", nodeNumber: firstNode?.number ?? "", branchId: null, branchName: "", branchNumber: null, cumulativeLength: 0, pressure, dP: 0 });

  for (const c of chain) {
    cumLen += c.b.length ?? 0;
    const dp = Math.abs(c.b.dP ?? 0);
    pressure -= dp;
    const toNode = nodeMap.get(c.toId);
    points.push({ nodeId: c.toId, nodeName: toNode?.name ?? "", nodeNumber: toNode?.number ?? "", branchId: c.b.id, branchName: c.b.type || c.b.id, branchNumber: c.b.id, cumulativeLength: Math.round(cumLen * 100) / 100, pressure: Math.round(pressure * 100) / 100, dP: Math.round(dp * 100) / 100 });
  }
  return points;
}