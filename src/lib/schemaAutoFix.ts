// ─────────────────────────────────────────────────────────────────────────────
// АВТОИСПРАВЛЕНИЕ СХЕМЫ — то, что можно исправить без участия инженера.
//
// Каждое исправление чисто механическое и не меняет «замысел» модели:
//   • удалить ветви, висящие на удалённых узлах, и ветви-петли;
//   • слить узлы, стоящие в одной точке, и концы очень коротких ветвей;
//   • удалить узлы без ветвей;
//   • разделить ветвь узлом, лежащим на её оси (Т-примыкание);
//   • длину нулевых и ручных выработок — по координатам;
//   • отрицательные и нечисловые значения — сбросить к рабочим;
//   • потерянную отметку Z = 0 — взять по соседним узлам;
//   • одинаковые номера разных позиций ПЛА — перенумеровать.
//
// Функция чистая: на входе схема, на выходе новая схема + отчёт по каждому
// виду исправлений. Применение и отмена (Ctrl+Z) — на стороне страницы.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch, calcBranchLength, makeBranch } from "./topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import type { Position } from "./positions";

export type AutoFixKind =
  | "brokenBranch" | "selfLoop" | "dupes" | "tinyBranch" | "isolated"
  | "tJunction" | "zeroLen" | "manualLen" | "invalidValues" | "lostZ" | "positionDupes";

export interface AutoFixInfo {
  kind: AutoFixKind;
  title: string;
  /** Что именно будет сделано — понятным языком. */
  action: string;
  /** По умолчанию включено (ручные длины — выключено: это бывает осознанно). */
  defaultOn: boolean;
}

export const AUTO_FIX_LIST: AutoFixInfo[] = [
  { kind: "brokenBranch", title: "Ветви на удалённых узлах", action: "удалить ветвь", defaultOn: true },
  { kind: "selfLoop", title: "Ветви, замкнутые сами на себя", action: "удалить ветвь", defaultOn: true },
  { kind: "dupes", title: "Узлы в одной точке", action: "слить в один узел", defaultOn: true },
  { kind: "tinyBranch", title: "Очень короткие ветви", action: "слить узлы, ветвь удалить", defaultOn: true },
  { kind: "tJunction", title: "Примыкания без общего узла", action: "разделить ветвь узлом", defaultOn: true },
  { kind: "isolated", title: "Узлы без ветвей", action: "удалить узел", defaultOn: true },
  { kind: "zeroLen", title: "Ветви нулевой длины", action: "длина по координатам", defaultOn: true },
  { kind: "invalidValues", title: "Некорректные числа", action: "сбросить к рабочим значениям", defaultOn: true },
  { kind: "lostZ", title: "Потерянные отметки Z", action: "отметка по соседним узлам", defaultOn: true },
  { kind: "positionDupes", title: "Повторяющиеся номера позиций ПЛА", action: "перенумеровать", defaultOn: true },
  { kind: "manualLen", title: "Длины, заданные вручную", action: "пересчитать по координатам", defaultOn: false },
];

export interface AutoFixOptions {
  /** м — узлы ближе считаются «в одной точке» (как в проверке: 1 см). */
  dupEps?: number;
  /** м — ветви короче сливаются (порог «очень короткой» ветви). */
  tinyLength?: number;
  /** м — допуск «узел на оси ветви». */
  onAxisTolerance?: number;
  /** Какие виды исправлений применять (по умолчанию — defaultOn). */
  enabled?: Partial<Record<AutoFixKind, boolean>>;
}

export interface AutoFixInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  symbols: SchemaSymbol[];
  positions: Position[];
}

export interface AutoFixResult extends AutoFixInput {
  /** Сколько объектов исправлено по каждому виду. */
  counts: Record<AutoFixKind, number>;
  total: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Узлы, которые нельзя «съесть» при слиянии: выход на поверхность важнее. */
const keepRank = (n: TopoNode) => (n.atmosphereLink ? 2 : 0) + (n.name ? 1 : 0);

export function autoFixSchema(input: AutoFixInput, opts: AutoFixOptions = {}): AutoFixResult {
  const on = (k: AutoFixKind) =>
    opts.enabled?.[k] ?? AUTO_FIX_LIST.find((f) => f.kind === k)!.defaultOn;
  const dupEps = opts.dupEps ?? 0.01;
  const tiny = opts.tinyLength ?? 0.5;
  const tol = opts.onAxisTolerance ?? 0.5;

  const counts = Object.fromEntries(AUTO_FIX_LIST.map((f) => [f.kind, 0])) as Record<AutoFixKind, number>;
  let nodes = input.nodes.slice();
  let branches = input.branches.slice();
  let symbols = input.symbols.slice();
  let positions = input.positions.slice();

  const removedBranches = new Set<string>();
  const dropBranches = (ids: Set<string>) => {
    if (ids.size === 0) return;
    ids.forEach((id) => removedBranches.add(id));
    branches = branches.filter((b) => !ids.has(b.id));
  };

  // ── 1. Ветви на удалённых узлах ─────────────────────────────────────────
  if (on("brokenBranch")) {
    const ids = new Set(nodes.map((n) => n.id));
    const bad = new Set(branches.filter((b) => !ids.has(b.fromId) || !ids.has(b.toId)).map((b) => b.id));
    counts.brokenBranch = bad.size;
    dropBranches(bad);
  }

  // ── 2. Слияние узлов: одна точка + очень короткие ветви ─────────────────
  // Система непересекающихся множеств: какой узел в какой сливается.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return false;
    const na = nodeById.get(ra)!, nb = nodeById.get(rb)!;
    // Остаётся узел с выходом на поверхность / с названием / с меньшим id
    const keepA = keepRank(na) !== keepRank(nb) ? keepRank(na) > keepRank(nb)
      : (parseInt(na.id, 10) || 0) <= (parseInt(nb.id, 10) || 0);
    if (keepA) parent.set(rb, ra); else parent.set(ra, rb);
    return true;
  };

  // Пары узлов, соединённые ветвью напрямую: такие совпадения бывают
  // намеренными (вентилятор, утечка, перемычка между совпавшими узлами) —
  // сливать их нельзя, ветвь пропала бы.
  const linked = new Set<string>();
  for (const b of branches) { linked.add(`${b.fromId}|${b.toId}`); linked.add(`${b.toId}|${b.fromId}`); }

  if (on("dupes")) {
    const cell = Math.max(dupEps, 1e-6);
    const grid = new Map<string, TopoNode[]>();
    const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
    for (const n of nodes) {
      const k = key(n.x, n.y, n.z);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(n);
    }
    for (const n of nodes) {
      const cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell), cz = Math.floor(n.z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const m of grid.get(`${cx + dx}|${cy + dy}|${cz + dz}`) ?? []) {
          if (m.id <= n.id || linked.has(`${n.id}|${m.id}`)) continue;
          if (Math.abs(n.x - m.x) < dupEps && Math.abs(n.y - m.y) < dupEps && Math.abs(n.z - m.z) < dupEps) {
            if (union(n.id, m.id)) counts.dupes++;
          }
        }
      }
    }
  }

  if (on("tinyBranch")) {
    const withSymbols = new Set(symbols.map((s) => s.branchId).filter(Boolean) as string[]);
    for (const b of branches) {
      if (b.fromId === b.toId || b.manualLength || b.isVentPipeBranch) continue;
      // Ветвь с вентилятором или перемычкой не трогаем — это объект модели.
      if (b.hasFan || b.hasBulkhead || b.isLeakage || b.resistanceMode === "manual") continue;
      if (withSymbols.has(b.id)) continue;
      const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
      if (!fn || !tn) continue;
      const geo = calcBranchLength(fn, tn);
      if (geo > 0 && geo < tiny && union(b.fromId, b.toId)) counts.tinyBranch++;
    }
  }

  if (parent.size > 0) {
    const remap = (id: string) => find(id);
    branches = branches.map((b) => {
      const f = remap(b.fromId), t = remap(b.toId);
      return f === b.fromId && t === b.toId ? b : { ...b, fromId: f, toId: t };
    });
    const gone = new Set([...parent.keys()].filter((id) => find(id) !== id));
    nodes = nodes.filter((n) => !gone.has(n.id));
    // Ветви, ставшие петлями после слияния (короткие ветви и ветви между
    // совпавшими узлами), удаляем — их длина была меньше порога.
    const wasLoop = new Set(input.branches.filter((o) => o.fromId === o.toId).map((o) => o.id));
    dropBranches(new Set(branches.filter((b) => b.fromId === b.toId && !wasLoop.has(b.id)).map((b) => b.id)));
  }

  // ── 3. Ветви-петли (начало и конец в одном узле) ────────────────────────
  if (on("selfLoop")) {
    const loops = new Set(branches.filter((b) => b.fromId === b.toId).map((b) => b.id));
    counts.selfLoop = loops.size;
    dropBranches(loops);
  }

  // ── 4. Т-примыкания: узел на оси чужой ветви → разделить ветвь ──────────
  if (on("tJunction")) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const CELL = 50;
    const grid = new Map<string, TopoBranch[]>();
    for (const b of branches) {
      if (b.isVentPipeBranch || b.fromId === b.toId) continue;
      const a = byId.get(b.fromId), c = byId.get(b.toId);
      if (!a || !c) continue;
      const x0 = Math.floor((Math.min(a.x, c.x) - tol) / CELL), x1 = Math.floor((Math.max(a.x, c.x) + tol) / CELL);
      const y0 = Math.floor((Math.min(a.y, c.y) - tol) / CELL), y1 = Math.floor((Math.max(a.y, c.y) + tol) / CELL);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) continue;
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
        const k = `${i}|${j}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(b);
      }
    }
    // Ветвь → список узлов на её оси с долей t (ветвь режем по всем сразу).
    const cuts = new Map<string, { nodeId: string; t: number }[]>();
    const taken = new Set<string>();
    for (const n of nodes) {
      for (const b of grid.get(`${Math.floor(n.x / CELL)}|${Math.floor(n.y / CELL)}`) ?? []) {
        if (b.fromId === n.id || b.toId === n.id) continue;
        const a = byId.get(b.fromId)!, c = byId.get(b.toId)!;
        const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z;
        const len2 = dx * dx + dy * dy + dz * dz;
        if (len2 < 1e-6) continue;
        const t = ((n.x - a.x) * dx + (n.y - a.y) * dy + (n.z - a.z) * dz) / len2;
        if (t <= 0.01 || t >= 0.99) continue;
        const d = Math.hypot(a.x + dx * t - n.x, a.y + dy * t - n.y, a.z + dz * t - n.z);
        if (d > tol || taken.has(n.id)) continue;
        taken.add(n.id);
        (cuts.get(b.id) ?? cuts.set(b.id, []).get(b.id)!).push({ nodeId: n.id, t });
        break;
      }
    }
    if (cuts.size > 0) {
      // Номера удалённых ветвей не переиспользуем: на них ещё ссылаются
      // значки, которые будут убраны вместе с удалёнными ветвями.
      const used = new Set([...input.branches.map((b) => b.id), ...branches.map((b) => b.id)]);
      let nextId = 1;
      const newId = () => { while (used.has(String(nextId))) nextId++; const id = String(nextId); used.add(id); return id; };
      const out: TopoBranch[] = [];
      for (const b of branches) {
        const list = cuts.get(b.id);
        if (!list) { out.push(b); continue; }
        list.sort((p, q) => p.t - q.t);
        const pts = [{ nodeId: b.fromId, t: 0 }, ...list, { nodeId: b.toId, t: 1 }];
        const segIds: string[] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const first = i === 0;
          const id = first ? b.id : newId();
          segIds.push(id);
          const share = pts[i + 1].t - pts[i].t;
          out.push(first
            ? { ...b, toId: pts[1].nodeId, manualLength: false, ...(b.manualLength ? { length: Math.round(b.length * share) } : {}) }
            : makeBranch(id, pts[i].nodeId, pts[i + 1].nodeId, {
              ...b, id, fromId: pts[i].nodeId, toId: pts[i + 1].nodeId, manualLength: false,
              // Вентилятор и перемычка остаются на первом отрезке — не задваиваем.
              hasFan: false, fanMode: "constant", fanPressure: 0, fanName: "", fanCurveId: "",
              fanEfficiency: 0, fanShaftPower: 0, hasBulkhead: false,
            }));
        }
        // Значки ветви — на тот отрезок, куда они попадают по положению.
        symbols = symbols.map((s) => {
          if (s.branchId !== b.id || typeof s.t !== "number") return s;
          const k = pts.findIndex((_, i) => i < pts.length - 1 && s.t! <= pts[i + 1].t);
          const i = k < 0 ? pts.length - 2 : k;
          const span = pts[i + 1].t - pts[i].t;
          return { ...s, branchId: segIds[i], t: span > 0 ? (s.t! - pts[i].t) / span : 0.5 };
        });
        counts.tJunction += list.length;
      }
      branches = out;
    }
  }

  // ── 5. Узлы без ветвей ──────────────────────────────────────────────────
  if (on("isolated")) {
    const used = new Set<string>();
    for (const b of branches) { used.add(b.fromId); used.add(b.toId); }
    const before = nodes.length;
    // Узел с выходом на поверхность без ветвей тоже лишний — расчёт его не видит.
    nodes = nodes.filter((n) => used.has(n.id));
    counts.isolated = before - nodes.length;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // ── 6. Некорректные числа ───────────────────────────────────────────────
  if (on("invalidValues")) {
    branches = branches.map((b) => {
      const patch: Partial<TopoBranch> = {};
      if (!finite(b.area) || b.area < 0) { patch.area = 0; patch.manualSection = false; }
      if (!finite(b.length) || b.length < 0) { patch.length = 0; patch.manualLength = false; }
      if (b.resistanceMode === "manual" && (!finite(b.manualR) || b.manualR < 0)) patch.manualR = 0;
      if (!finite(b.alphaCoef) || b.alphaCoef < 0) patch.alphaCoef = 0;
      if (Object.keys(patch).length === 0) return b;
      counts.invalidValues++;
      return { ...b, ...patch };
    });
  }

  // ── 7. Длина: нулевая и ручная → по координатам ─────────────────────────
  const fixLen = (b: TopoBranch) => {
    const fn = byId.get(b.fromId), tn = byId.get(b.toId);
    const auto = fn && tn ? Math.round(calcBranchLength(fn, tn)) : 0;
    return auto > 0 ? { ...b, manualLength: false, length: auto } : null;
  };
  if (on("zeroLen") || on("manualLen")) {
    branches = branches.map((b) => {
      if (on("zeroLen") && !((b.length ?? 0) > 0)) {
        const f = fixLen(b);
        if (f) { counts.zeroLen++; return f; }
        return b;
      }
      if (on("manualLen") && b.manualLength) {
        const f = fixLen(b);
        if (f && f.length !== b.length) { counts.manualLen++; return f; }
      }
      return b;
    });
  }

  // ── 8. Потерянные отметки Z = 0 среди глубокой сети ─────────────────────
  if (on("lostZ")) {
    const zs = nodes.map((n) => n.z).filter((z) => Number.isFinite(z) && Math.abs(z) > 1e-6).sort((a, b) => a - b);
    const median = zs.length >= 5 ? zs[Math.floor(zs.length / 2)] : 0;
    if (Math.abs(median) >= 50) {
      const nb = new Map<string, number[]>();
      for (const b of branches) {
        const fz = byId.get(b.fromId)?.z, tz = byId.get(b.toId)?.z;
        if (fz === undefined || tz === undefined) continue;
        (nb.get(b.fromId) ?? nb.set(b.fromId, []).get(b.fromId)!).push(tz);
        (nb.get(b.toId) ?? nb.set(b.toId, []).get(b.toId)!).push(fz);
      }
      nodes = nodes.map((n) => {
        if (Math.abs(n.z) > 1e-6 || n.atmosphereLink) return n;
        const neigh = nb.get(n.id) ?? [];
        if (neigh.length === 0 || !neigh.every((z) => Math.abs(z) >= 30)) return n;
        const z = +(neigh.reduce((s, v) => s + v, 0) / neigh.length).toFixed(2);
        counts.lostZ++;
        // Отметка — и в маркшейдерских координатах: по ним считается длина.
        return { ...n, z, surveyZ: z };
      });
    }
  }

  // ── 9. Повторяющиеся номера разных позиций ПЛА ──────────────────────────
  if (on("positionDupes") && positions.length > 0) {
    const key = (p: Position) => `${(p.name || "").trim().toLowerCase()}|${p.accidentType}`;
    const usedNums = new Set(positions.map((p) => p.number));
    let next = Math.max(0, ...positions.map((p) => p.number)) + 1;
    const firstKeyByNum = new Map<number, string>();
    // Копии одной позиции (тот же номер, название и вид) — получают общий новый номер.
    const renamed = new Map<string, number>();
    positions = positions.map((p) => {
      const k = key(p);
      const first = firstKeyByNum.get(p.number);
      if (first === undefined) { firstKeyByNum.set(p.number, k); return p; }
      if (first === k) return p;
      const rk = `${p.number}|${k}`;
      let num = renamed.get(rk);
      if (num === undefined) {
        while (usedNums.has(next)) next++;
        num = next; usedNums.add(num); renamed.set(rk, num);
        counts.positionDupes++;
      }
      return { ...p, number: num };
    });
  }

  // Значки на удалённых ветвях — убираем вместе с ветвями.
  if (removedBranches.size > 0) {
    symbols = symbols.filter((s) => !s.branchId || !removedBranches.has(s.branchId));
    positions = positions.map((p) => {
      const ids = p.branchIds.filter((id) => !removedBranches.has(id));
      const lead = p.leaderBranchId && removedBranches.has(p.leaderBranchId) ? null : p.leaderBranchId;
      return ids.length === p.branchIds.length && lead === p.leaderBranchId ? p : { ...p, branchIds: ids, leaderBranchId: lead };
    });
  }

  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  return { nodes, branches, symbols, positions, counts, total };
}
