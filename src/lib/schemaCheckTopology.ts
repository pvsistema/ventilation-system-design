// ─────────────────────────────────────────────────────────────────────────────
// Проверка схемы: СВЯЗНОСТЬ И СТЫКОВКА ВЫРАБОТОК.
//
// Ошибки, из-за которых воздух в модели идёт не так, как в руднике:
// сеть распалась на части, выработка не состыкована с соседней, тупик без
// проветривания, некому гнать воздух. Типичны после импорта DXF/CSV, где
// примыкания нарисованы, но общих узлов нет (аналог проверок Ventsim
// «Unconnected / Crossing airways» и АэроСети «Контроль топологии»).
//
// Для поиска по геометрии используется пространственная сетка: каждая
// ветвь кладётся в ячейки своего габарита, сравниваются только ветви и узлы
// из общих ячеек — это O(n) вместо O(n²) на схемах в тысячи выработок.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoNode, TopoBranch } from "./topology";
import { type BranchNote, type GroupNote, pushCapped, fmtNum } from "./schemaCheckTypes";

export interface TopologyCheckResult {
  /** Ветвь начинается и заканчивается в одном узле. */
  selfLoops: BranchNote[];
  /** Отдельные части сети (кроме самой большой). */
  components: GroupNote[];
  /** Нет ни одного работающего вентилятора. */
  noActiveFan: boolean;
  /** Вентилятор стоит в тупике / в отрыве от сети. */
  deadFans: BranchNote[];
  /** Тупики без проветривания длиннее порога (весь тупик до сопряжения). */
  deadEnds: GroupNote[];
  /** Узел лежит на оси чужой ветви, но не соединён с ней. */
  tJunctions: GroupNote[];
  /** Ветви пересекаются в плане на одной отметке без общего узла. */
  crossings: GroupNote[];
  truncated: boolean;
}

export interface TopologyCheckOptions {
  /** м — насколько близко к оси ветви узел считается «лежащим на ней» */
  onAxisTolerance?: number;
  /** м — разница отметок, при которой пересечение считается «на одном уровне» */
  crossingZTolerance?: number;
  /** м — тупики не длиннее этого проветриваются диффузией (ФНИП № 505: 10 м) */
  deadEndMinLength?: number;
}

const CELL = 50; // м — шаг сетки для геометрического поиска

/** Ветви-нити вентрубопровода идут вдоль выработки — для геометрии их не берём. */
const isAuxLine = (b: TopoBranch) => !!b.isVentPipeBranch;

export function checkTopology(
  nodes: TopoNode[],
  branches: TopoBranch[],
  opts: TopologyCheckOptions = {},
): TopologyCheckResult {
  const tol = opts.onAxisTolerance ?? 0.5;
  const zTol = opts.crossingZTolerance ?? 1;
  let truncated = false;
  const push = <T,>(arr: T[], item: T) => { if (!pushCapped(arr, item)) truncated = true; };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const degree = new Map<string, number>();
  const valid: TopoBranch[] = [];
  for (const b of branches) {
    if (!nodeById.has(b.fromId) || !nodeById.has(b.toId)) continue; // обрывы — отдельная проверка
    valid.push(b);
    degree.set(b.fromId, (degree.get(b.fromId) ?? 0) + 1);
    degree.set(b.toId, (degree.get(b.toId) ?? 0) + 1);
  }

  // ── Петли ────────────────────────────────────────────────────────────────
  const selfLoops: BranchNote[] = [];
  for (const b of valid) {
    if (b.fromId === b.toId) push(selfLoops, { branch: b, note: `Начало и конец в узле ${nodeById.get(b.fromId)?.number || b.fromId}` });
  }

  // ── Части сети (система непересекающихся множеств) ───────────────────────
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) { const nx = parent.get(c)!; parent.set(c, r); c = nx; }
    return r;
  };
  for (const b of valid) {
    if (!parent.has(b.fromId)) parent.set(b.fromId, b.fromId);
    if (!parent.has(b.toId)) parent.set(b.toId, b.toId);
    const ra = find(b.fromId), rb = find(b.toId);
    if (ra !== rb) parent.set(ra, rb);
  }
  const parts = new Map<string, { nodeIds: string[]; branchIds: string[]; atm: boolean; fan: boolean }>();
  for (const id of parent.keys()) {
    const r = find(id);
    let p = parts.get(r);
    if (!p) { p = { nodeIds: [], branchIds: [], atm: false, fan: false }; parts.set(r, p); }
    p.nodeIds.push(id);
    if (nodeById.get(id)?.atmosphereLink) p.atm = true;
  }
  for (const b of valid) {
    const p = parts.get(find(b.fromId))!;
    p.branchIds.push(b.id);
    if (b.hasFan && !b.fanStopped) p.fan = true;
  }
  const sorted = [...parts.values()].sort((a, b) => b.branchIds.length - a.branchIds.length);
  const components: GroupNote[] = [];
  if (sorted.length > 1) {
    sorted.slice(1).forEach((p, i) => {
      push(components, {
        title: `Отдельная часть ${i + 2}: ветвей ${p.branchIds.length}`,
        note: [
          p.atm ? "выход на поверхность есть" : "нет выхода на поверхность",
          p.fan ? "есть вентилятор" : "без вентилятора",
        ].join(" · "),
        nodeIds: p.nodeIds, branchIds: p.branchIds,
      });
    });
  }

  // ── Вентиляторы ──────────────────────────────────────────────────────────
  const activeFans = valid.filter((b) => b.hasFan && !b.fanStopped);
  const noActiveFan = valid.length > 0 && activeFans.length === 0;
  const deadFans: BranchNote[] = [];
  for (const b of activeFans) {
    const endDead = (id: string) => (degree.get(id) ?? 0) <= 1 && !nodeById.get(id)?.atmosphereLink;
    if (endDead(b.fromId) || endDead(b.toId)) {
      push(deadFans, { branch: b, note: `${b.fanType || "Вентилятор"} ${b.fanName || ""} — один из концов ветви ни к чему не присоединён`.replace(/\s+/g, " ") });
    }
  }

  // ── Тупики без проветривания ─────────────────────────────────────────────
  // Узел с одной ветвью — забой или недостроенная выработка. Воздух в такой
  // тупик в модели не пойдёт (расход = 0), если его не проветривает ВМП.
  // Тупик может состоять из нескольких ветвей, соединённых промежуточными
  // узлами (узел с двумя ветвями) — идём от забоя до первого сопряжения
  // (узел с 3+ ветвями) и суммируем длину всего тупика.
  // По ФНИП (приказ Ростехнадзора № 505) тупики длиной до 10 м
  // проветриваются за счёт диффузии — в проверку их не включаем.
  const minLen = opts.deadEndMinLength ?? 10;
  const deadEnds: GroupNote[] = [];
  // Нити вентрубопровода в топологию тупика не входят, но если труба
  // заходит в тупик — он проветривается.
  const branchesOf = new Map<string, TopoBranch[]>();
  const pipeNodes = new Set<string>();
  for (const b of valid) {
    if (b.fromId === b.toId) continue;
    if (isAuxLine(b)) { pipeNodes.add(b.fromId); pipeNodes.add(b.toId); continue; }
    (branchesOf.get(b.fromId) ?? branchesOf.set(b.fromId, []).get(b.fromId)!).push(b);
    (branchesOf.get(b.toId) ?? branchesOf.set(b.toId, []).get(b.toId)!).push(b);
  }
  const branchLen = (b: TopoBranch) => {
    if (b.length > 0) return b.length;
    const a = nodeById.get(b.fromId)!, c = nodeById.get(b.toId)!;
    return Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
  };
  const walked = new Set<string>();
  for (const n of nodes) {
    const own = branchesOf.get(n.id);
    if (!own || own.length !== 1 || n.atmosphereLink) continue;
    if (walked.has(own[0].id)) continue; // изолированная цепочка уже учтена с другого конца
    const chainB: TopoBranch[] = [];
    const chainN: string[] = [n.id];
    let cur = n.id, prev: TopoBranch | null = null, total = 0, endNode = n.id;
    let ventilated = pipeNodes.has(n.id);
    for (;;) {
      const next = (branchesOf.get(cur) ?? []).find((b) => b !== prev);
      if (!next || walked.has(next.id)) break;
      walked.add(next.id);
      chainB.push(next);
      total += branchLen(next);
      if (next.isDead || next.hasVentPipe || next.hasFan) ventilated = true;
      const other = next.fromId === cur ? next.toId : next.fromId;
      endNode = other;
      if (pipeNodes.has(other)) ventilated = true;
      const otherN = nodeById.get(other);
      if (otherN?.atmosphereLink || (branchesOf.get(other)?.length ?? 0) !== 2) break;
      chainN.push(other);
      prev = next; cur = other;
      if (chainB.length > 10000) break;
    }
    if (ventilated || chainB.length === 0 || total <= minLen) continue;
    const endN = nodeById.get(endNode);
    const type = chainB[0].type || `ветвь ${chainB[0].id}`;
    push(deadEnds, {
      title: `Узел ${n.number || n.id}${n.name ? ` (${n.name})` : ""}`,
      note: `Тупик выработки «${type}» длиной ${fmtNum(total, 1)} м` +
        (chainB.length > 1 ? ` (${chainB.length} ветвей)` : "") +
        ` до сопряжения в узле ${endN?.number || endNode} — расход в нём будет 0`,
      nodeIds: chainN, branchIds: chainB.map((b) => b.id),
    });
  }

  // ── Геометрия: сетка ветвей ──────────────────────────────────────────────
  const geo = valid.filter((b) => !isAuxLine(b) && b.fromId !== b.toId);
  const grid = new Map<string, TopoBranch[]>();
  const cellsOf = (b: TopoBranch) => {
    const a = nodeById.get(b.fromId)!, c = nodeById.get(b.toId)!;
    const x0 = Math.floor((Math.min(a.x, c.x) - tol) / CELL), x1 = Math.floor((Math.max(a.x, c.x) + tol) / CELL);
    const y0 = Math.floor((Math.min(a.y, c.y) - tol) / CELL), y1 = Math.floor((Math.max(a.y, c.y) + tol) / CELL);
    const keys: string[] = [];
    // Очень длинные ветви (стволы, магистрали) не раздуваем на тысячи ячеек
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) return keys;
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) keys.push(`${i}|${j}`);
    return keys;
  };
  for (const b of geo) {
    for (const k of cellsOf(b)) (grid.get(k) ?? grid.set(k, []).get(k)!).push(b);
  }

  // Узел на оси чужой ветви (Т-образное примыкание без узла)
  const tJunctions: GroupNote[] = [];
  for (const n of nodes) {
    if (truncated) break;
    const cand = grid.get(`${Math.floor(n.x / CELL)}|${Math.floor(n.y / CELL)}`);
    if (!cand) continue;
    for (const b of cand) {
      if (b.fromId === n.id || b.toId === n.id) continue;
      const a = nodeById.get(b.fromId)!, c = nodeById.get(b.toId)!;
      const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 < 1e-6) continue;
      const t = ((n.x - a.x) * dx + (n.y - a.y) * dy + (n.z - a.z) * dz) / len2;
      if (t <= 0.01 || t >= 0.99) continue;
      const px = a.x + dx * t - n.x, py = a.y + dy * t - n.y, pz = a.z + dz * t - n.z;
      const d = Math.sqrt(px * px + py * py + pz * pz);
      if (d > tol) continue;
      push(tJunctions, {
        title: `Узел ${n.number || n.id} на ветви ${b.type || b.id}`,
        note: `Отклонение от оси ${fmtNum(d, 2)} м — ветвь нужно разделить этим узлом`,
        nodeIds: [n.id], branchIds: [b.id],
      });
      break;
    }
  }

  // Пересечения в плане на одной отметке
  const crossings: GroupNote[] = [];
  const seen = new Set<string>();
  for (const cell of grid.values()) {
    if (truncated) break;
    for (let i = 0; i < cell.length; i++) {
      for (let j = i + 1; j < cell.length; j++) {
        const b1 = cell[i], b2 = cell[j];
        if (b1.fromId === b2.fromId || b1.fromId === b2.toId || b1.toId === b2.fromId || b1.toId === b2.toId) continue;
        const key = b1.id < b2.id ? `${b1.id}|${b2.id}` : `${b2.id}|${b1.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p1 = nodeById.get(b1.fromId)!, p2 = nodeById.get(b1.toId)!;
        const q1 = nodeById.get(b2.fromId)!, q2 = nodeById.get(b2.toId)!;
        const rx = p2.x - p1.x, ry = p2.y - p1.y, sx = q2.x - q1.x, sy = q2.y - q1.y;
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue;
        const qpx = q1.x - p1.x, qpy = q1.y - p1.y;
        const t = (qpx * sy - qpy * sx) / den;
        const u = (qpx * ry - qpy * rx) / den;
        if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) continue;
        const z1 = p1.z + (p2.z - p1.z) * t;
        const z2 = q1.z + (q2.z - q1.z) * u;
        if (Math.abs(z1 - z2) > zTol) continue;
        push(crossings, {
          title: `${b1.type || `Ветвь ${b1.id}`} × ${b2.type || `Ветвь ${b2.id}`}`,
          note: `Пересекаются на отметке ${fmtNum(z1, 1)} м без общего узла`,
          nodeIds: [], branchIds: [b1.id, b2.id],
        });
      }
    }
  }

  return { selfLoops, components, noActiveFan, deadFans, deadEnds, tJunctions, crossings, truncated };
}