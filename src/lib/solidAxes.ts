// ─────────────────────────────────────────────────────────────────────────────
// solidAxes.ts — оси выработок по их 3D-телам.
//
// Горные чертежи (Micromine, Datamine, Surpac → AutoCAD) часто содержат не
// осевые линии, а ТЕЛА выработок: многогранные сетки (POLYLINE-PFACE) и
// наборы граней 3DFACE. В «Джеруй» так нарисована вся схема вскрытия:
// 964 сетки и 7 539 граней, ни одной осевой линии. Наш импорт строит сеть по
// линиям, поэтому из такого чертежа не получалось ни одной ветви.
//
// Здесь каждое тело превращается в осевую линию:
//   • прямое тело (большинство: штреки, орты, заезды, стволы) — главная ось
//     облака вершин (метод главных компонент), проходящая через центр сечения;
//   • изогнутое (спиральный съезд, повороты) — цепочка центров по длине тела:
//     вершины группируются в ячейки размером с сечение, центры ячеек
//     соединяются минимальным остовным деревом, и берётся его самый длинный
//     путь.
// Сечение (S, P) — по выпуклой оболочке поперечного профиля.
//
// Затем оси сшиваются в сеть: конец выработки, упирающийся в соседнее тело
// (в торец или в бок — сопряжение «Т»), соединяется с ним; боковое примыкание
// разрезает соседнюю выработку в точке сопряжения. Допуск — по размерам
// сечений обеих выработок: тела в чертеже касаются стенками, а не осями.
// ─────────────────────────────────────────────────────────────────────────────

export interface V3 { x: number; y: number; z: number }

export interface SolidBody { layer: string; pts: V3[] }

export interface AxisSegment {
  x1: number; y1: number; z1: number; x2: number; y2: number; z2: number;
  layer: string;
  /** Сечение по телу, м² и м (если удалось определить). */
  area?: number;
  perimeter?: number;
}

export interface SolidAxesResult {
  segments: AxisSegment[];
  bodies: number;
  straight: number;
  curved: number;
  junctions: number;
  /** Отдельных кусков сети после сшивки (1 — сеть связная). */
  components: number;
}

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V3) => Math.sqrt(dot(a, a));
const dist = (a: V3, b: V3) => len(sub(a, b));
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V3): V3 => { const l = len(a) || 1; return mul(a, 1 / l); };

/** Главная ось облака точек: центр и единичное направление (степенной метод). */
function principal(pts: V3[]): { c: V3; d: V3 } {
  const n = pts.length;
  const c = mul(pts.reduce((s, p) => add(s, p), { x: 0, y: 0, z: 0 }), 1 / n);
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of pts) {
    const q = sub(p, c);
    xx += q.x * q.x; xy += q.x * q.y; xz += q.x * q.z; yy += q.y * q.y; yz += q.y * q.z; zz += q.z * q.z;
  }
  // Старт — направление наибольшего разброса по осям, чтобы не попасть
  // в собственный вектор с нулевой проекцией.
  let v: V3 = xx >= yy && xx >= zz ? { x: 1, y: 0.1, z: 0.1 } : yy >= zz ? { x: 0.1, y: 1, z: 0.1 } : { x: 0.1, y: 0.1, z: 1 };
  for (let i = 0; i < 60; i++) {
    v = norm({
      x: xx * v.x + xy * v.y + xz * v.z,
      y: xy * v.x + yy * v.y + yz * v.z,
      z: xz * v.x + yz * v.y + zz * v.z,
    });
  }
  return { c, d: v };
}

/** Два единичных вектора, перпендикулярных d. */
function basis(d: V3): [V3, V3] {
  const ref = Math.abs(d.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const e1 = norm(cross(d, ref));
  return [e1, norm(cross(d, e1))];
}

/** Выпуклая оболочка на плоскости: площадь и периметр. */
function hull2(pts: [number, number][]): { area: number; perim: number } {
  if (pts.length < 3) return { area: 0, perim: 0 };
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let a = 0, per = 0;
  for (let i = 0; i < h.length; i++) {
    const [x1, y1] = h[i], [x2, y2] = h[(i + 1) % h.length];
    a += x1 * y2 - x2 * y1; per += Math.hypot(x2 - x1, y2 - y1);
  }
  return { area: Math.abs(a) / 2, perim: per };
}

/** Упрощение ломаной (Дуглас — Пекер). */
function simplify(P: V3[], eps: number): V3[] {
  if (P.length < 3) return P;
  const a = P[0], b = P[P.length - 1], ab = sub(b, a), l = len(ab) || 1;
  let best = 0, bi = 0;
  for (let i = 1; i < P.length - 1; i++) {
    const d = len(cross(sub(P[i], a), ab)) / l;
    if (d > best) { best = d; bi = i; }
  }
  if (best > eps) return [...simplify(P.slice(0, bi + 1), eps).slice(0, -1), ...simplify(P.slice(bi), eps)];
  return [a, b];
}

interface Axis { layer: string; pts: V3[]; area: number; perimeter: number; r: number }

/** Ось одного тела. null — тело слишком мало или вырождено. */
function bodyAxis(body: SolidBody): (Axis & { curved: boolean }) | null {
  const pts = body.pts;
  if (pts.length < 4) return null;
  const { c, d } = principal(pts);
  const [e1, e2] = basis(d);
  let tMin = Infinity, tMax = -Infinity;
  const ts = pts.map(p => { const t = dot(sub(p, c), d); if (t < tMin) tMin = t; if (t > tMax) tMax = t; return t; });
  const L = tMax - tMin;
  const prof: [number, number][] = pts.map(p => { const q = sub(p, c); return [dot(q, e1), dot(q, e2)]; });
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [u, v] of prof) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const hl = hull2(prof);
  const r = Math.max(0.5, Math.sqrt(hl.area / Math.PI));
  if (L < 0.5) return null;

  // Прямое ли тело: центры поперечных «ломтиков» должны лежать на одной оси.
  const nb = Math.max(2, Math.min(60, Math.round(L / 3)));
  const sums = Array.from({ length: nb }, () => ({ u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity, n: 0 }));
  ts.forEach((t, i) => {
    const k = Math.min(nb - 1, Math.floor(((t - tMin) / L) * nb));
    const s = sums[k], [u, v] = prof[i];
    s.u0 = Math.min(s.u0, u); s.u1 = Math.max(s.u1, u); s.v0 = Math.min(s.v0, v); s.v1 = Math.max(s.v1, v); s.n++;
  });
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  let drift = 0;
  for (const s of sums) if (s.n > 0) drift = Math.max(drift, Math.hypot((s.u0 + s.u1) / 2 - cu, (s.v0 + s.v1) / 2 - cv));
  const straight = drift < Math.max(1.5, r * 0.6) || L < r * 3;

  if (straight) {
    // Сечение по ломтикам (а не по всему телу) — у наклонных торцов полная
    // оболочка завышает площадь.
    const mid = ts.map((t, i) => [t, i] as const).filter(([t]) => Math.abs(t - (tMin + tMax) / 2) < Math.max(1, L * 0.3)).map(([, i]) => prof[i]);
    const hm = mid.length >= 3 ? hull2(mid) : hl;
    const base = add(c, add(mul(e1, cu), mul(e2, cv)));
    return {
      layer: body.layer, curved: false,
      pts: [add(base, mul(d, tMin)), add(base, mul(d, tMax))],
      area: hm.area, perimeter: hm.perim, r: Math.max(0.5, Math.sqrt(hm.area / Math.PI)),
    };
  }

  // ── Изогнутое тело: цепочка центров ────────────────────────────────────
  // Размер ячейки — по поперечнику ломтика (≈ ширина выработки).
  const widths = sums.filter(s => s.n > 0).map(s => Math.max(s.u1 - s.u0, s.v1 - s.v0)).sort((a, b) => a - b);
  const w = widths[Math.floor(widths.length / 4)] || 2 * r;
  const cell = Math.max(2, Math.min(10, w));
  const cells = new Map<string, { s: V3; n: number }>();
  for (const p of pts) {
    const k = `${Math.floor(p.x / cell)}|${Math.floor(p.y / cell)}|${Math.floor(p.z / cell)}`;
    const e = cells.get(k);
    if (e) { e.s = add(e.s, p); e.n++; } else cells.set(k, { s: { ...p }, n: 1 });
  }
  const C = [...cells.values()].map(e => mul(e.s, 1 / e.n));
  const n = C.length;
  if (n < 2) return null;
  // Минимальное остовное дерево (Прим, O(n²)).
  const inT = new Array(n).fill(false), best = new Array(n).fill(Infinity), par = new Array(n).fill(-1);
  best[0] = 0;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i;
    inT[u] = true;
    if (par[u] >= 0) { adj[u].push(par[u]); adj[par[u]].push(u); }
    for (let v = 0; v < n; v++) if (!inT[v]) { const dd = dist(C[u], C[v]); if (dd < best[v]) { best[v] = dd; par[v] = u; } }
  }
  const far = (src: number) => {
    const dd = new Array(n).fill(-1), pr = new Array(n).fill(-1); dd[src] = 0;
    const st = [src];
    while (st.length) { const u = st.pop()!; for (const v of adj[u]) if (dd[v] < 0) { dd[v] = dd[u] + dist(C[u], C[v]); pr[v] = u; st.push(v); } }
    let e = src; for (let i = 0; i < n; i++) if (dd[i] > dd[e]) e = i;
    return { e, pr };
  };
  const a = far(0).e;
  const { e: b, pr } = far(a);
  const path: V3[] = [];
  for (let u = b; u >= 0; u = pr[u]) path.push(C[u]);
  // Сгладим цепочку скользящим средним — центры ячеек «дрожат» по сечению.
  const sm = path.map((_, i) => {
    let s = { x: 0, y: 0, z: 0 }, k = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(path.length - 1, i + 1); j++) { s = add(s, path[j]); k++; }
    return i === 0 || i === path.length - 1 ? path[i] : mul(s, 1 / k);
  });
  const simple = simplify(sm, Math.max(0.5, cell * 0.25));
  const rr = Math.max(0.5, w / 2);
  return {
    layer: body.layer, curved: true, pts: simple,
    area: Math.PI * rr * rr, perimeter: 2 * Math.PI * rr, r: rr,
  };
}

/** Ближайшая точка ломаной: номер звена, параметр и расстояние. */
function nearestOn(P: V3[], q: V3): { seg: number; t: number; p: V3; d: number; s: number } {
  let best = { seg: 0, t: 0, p: P[0], d: Infinity, s: 0 };
  let acc = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], ab = sub(P[i + 1], a), l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
    const p = add(a, mul(ab, t)), d = dist(p, q), l = Math.sqrt(l2);
    if (d < best.d) best = { seg: i, t, p, d, s: acc + t * l };
    acc += l;
  }
  return best;
}

/**
 * Оси всех тел, сшитые в сеть. Возвращает отрезки с общими концами в узлах
 * сопряжений — дальше они идут в обычную сборку схемы.
 */
export function axesFromSolids(bodies: SolidBody[]): SolidAxesResult {
  const axes: Axis[] = [];
  let straight = 0, curved = 0;
  for (const b of bodies) {
    const a = bodyAxis(b);
    if (!a) continue;
    if (a.curved) curved++; else straight++;
    axes.push(a);
  }

  // Точки сети: концы осей и точки сопряжений на осях. Объединяем их
  // системой непересекающихся множеств.
  interface Pt { pos: V3; axis: number; s: number; loose?: boolean }
  const P: Pt[] = [];
  const parent: number[] = [];
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i: number, j: number) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
  const addPt = (pos: V3, axis: number, s: number) => { P.push({ pos, axis, s }); parent.push(P.length - 1); return P.length - 1; };

  const axLen = axes.map(a => { let l = 0; for (let i = 0; i < a.pts.length - 1; i++) l += dist(a.pts[i], a.pts[i + 1]); return l; });
  const endIdx = axes.map((a, i) => [addPt(a.pts[0], i, 0), addPt(a.pts[a.pts.length - 1], i, axLen[i])]);

  // Грубая сетка для поиска соседей.
  const G = 25;
  const grid = new Map<string, number[]>();
  axes.forEach((a, i) => {
    const seen = new Set<string>();
    for (let k = 0; k < a.pts.length - 1; k++) {
      const p = a.pts[k], q = a.pts[k + 1], steps = Math.max(1, Math.ceil(dist(p, q) / G));
      for (let s = 0; s <= steps; s++) {
        const r = add(p, mul(sub(q, p), s / steps));
        const key = `${Math.floor(r.x / G)}|${Math.floor(r.y / G)}|${Math.floor(r.z / G)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const l = grid.get(key); if (l) l.push(i); else grid.set(key, [i]);
      }
    }
  });
  const near = (q: V3): Set<number> => {
    const out = new Set<number>();
    const gx = Math.floor(q.x / G), gy = Math.floor(q.y / G), gz = Math.floor(q.z / G);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const i of grid.get(`${gx + dx}|${gy + dy}|${gz + dz}`) ?? []) out.add(i);
    return out;
  };

  let junctions = 0;
  axes.forEach((a, i) => {
    endIdx[i].forEach((pi, end) => {
      const q = P[pi].pos;
      for (const j of near(q)) {
        if (j === i) continue;
        const nb = nearestOn(axes[j].pts, q);
        // Тела касаются стенками: допуск — сумма «радиусов» сечений с запасом.
        const tol = Math.max(1, 1.6 * (a.r + axes[j].r));
        if (nb.d > tol) continue;
        // Не цепляемся «изнутри» короткой собственной частью: конец должен
        // смотреть на соседа, а не уходить от него.
        const dir = end === 0 ? sub(a.pts[0], a.pts[1]) : sub(a.pts[a.pts.length - 1], a.pts[a.pts.length - 2]);
        if (nb.d > a.r && dot(norm(dir), norm(sub(nb.p, q))) < -0.3) continue;
        const endTol = Math.max(1, axes[j].r * 1.5);
        if (nb.s <= endTol) union(pi, endIdx[j][0]);
        else if (axLen[j] - nb.s <= endTol) union(pi, endIdx[j][1]);
        else union(pi, addPt(nb.p, j, nb.s));
        junctions++;
      }
    });
  });

  // ── Второй проход: оторванные куски ────────────────────────────────────
  // В горных чертежах тело заезда или орта нередко не доходит до соседней
  // выработки на несколько метров (в «Джеруй» — 88 кусков, зазор 0,4…21 м,
  // медиана 7,6 м). Такой кусок подключаем к ближайшей выработке ДРУГОЙ части
  // сети, если зазор не больше 25 м и не больше пяти «радиусов» сечений.
  // Сшиваем только концы осей и только между разными частями — внутри
  // связной сети лишних перемычек не появляется.
  let stitched = 0;
  for (let pass = 0; pass < 4; pass++) {
    const axisRoot = new Map<number, number>();
    const af = (i: number): number => { let r = i; while (axisRoot.has(r) && axisRoot.get(r) !== r) r = axisRoot.get(r)!; return r; };
    const ptRootAxis = new Map<number, number>();
    P.forEach((p, k) => {
      const r = find(k);
      const prev = ptRootAxis.get(r);
      if (prev === undefined) ptRootAxis.set(r, p.axis);
      else { const x = af(prev), y = af(p.axis); if (x !== y) axisRoot.set(x, y); }
    });
    const size = new Map<number, number>();
    axes.forEach((_, i) => { const r = af(i); size.set(r, (size.get(r) ?? 0) + axLen[i]); });
    let mainRoot = -1, mainLen = -1;
    size.forEach((l, r) => { if (l > mainLen) { mainLen = l; mainRoot = r; } });
    // Для каждого оторванного куска — одно лучшее подключение.
    const bestFor = new Map<number, { d: number; pi: number; j: number; nb: ReturnType<typeof nearestOn> }>();
    axes.forEach((a, i) => {
      const ci = af(i);
      if (ci === mainRoot) return;
      endIdx[i].forEach(pi => {
        const q = P[pi].pos;
        for (const j of near(q)) {
          if (af(j) === ci) continue;
          const nb = nearestOn(axes[j].pts, q);
          const tol = Math.min(25, Math.max(3, 5 * (a.r + axes[j].r)));
          if (nb.d > tol) continue;
          const cur = bestFor.get(ci);
          if (!cur || nb.d < cur.d) bestFor.set(ci, { d: nb.d, pi, j, nb });
        }
      });
    });
    if (bestFor.size === 0) break;
    bestFor.forEach(({ pi, j, nb }) => {
      // Конец оторванного куска не тянет узел к себе: узел остаётся на
      // выработке, к которой подключаемся (иначе сдвигалось бы сопряжение).
      P[pi].loose = true;
      const endTol = Math.max(1, axes[j].r * 1.5);
      if (nb.s <= endTol) union(pi, endIdx[j][0]);
      else if (axLen[j] - nb.s <= endTol) union(pi, endIdx[j][1]);
      else union(pi, addPt(nb.p, j, nb.s));
      stitched++;
    });
  }
  junctions += stitched;

  // Положение узла — среднее его точек.
  const groups = new Map<number, V3[]>();
  const firm = new Set<number>();
  P.forEach((p, i) => { if (!p.loose) firm.add(find(i)); });
  P.forEach((p, i) => {
    const r = find(i);
    if (p.loose && firm.has(r)) return;
    const g = groups.get(r); if (g) g.push(p.pos); else groups.set(r, [p.pos]);
  });
  const nodePos = new Map<number, V3>();
  groups.forEach((g, r) => nodePos.set(r, mul(g.reduce((s, p) => add(s, p), { x: 0, y: 0, z: 0 }), 1 / g.length)));

  // Ось режем во всех её точках и строим отрезки между соседними.
  const segments: AxisSegment[] = [];
  const edgeParent = new Map<number, number>();
  const ef = (i: number): number => { let r = i; while (edgeParent.has(r) && edgeParent.get(r) !== r) r = edgeParent.get(r)!; return r; };
  const eu = (a: number, b: number) => { const x = ef(a), y = ef(b); if (x !== y) edgeParent.set(x, y); };
  const usedNodes = new Set<number>();
  axes.forEach((a, i) => {
    const onAxis = P.map((p, k) => ({ p, k })).filter(o => o.p.axis === i).sort((x, y) => x.p.s - y.p.s);
    // Точки одного узла подряд схлопываем.
    const marks: { s: number; node: number }[] = [];
    for (const o of onAxis) {
      const node = find(o.k);
      if (marks.length && marks[marks.length - 1].node === node) continue;
      marks.push({ s: o.p.s, node });
    }
    // Вершины ломаной с их длиной от начала.
    const cum: number[] = [0];
    for (let k = 1; k < a.pts.length; k++) cum.push(cum[k - 1] + dist(a.pts[k - 1], a.pts[k]));
    const at = (s: number): V3 => {
      for (let k = 0; k < a.pts.length - 1; k++) if (s <= cum[k + 1] || k === a.pts.length - 2) {
        const l = cum[k + 1] - cum[k];
        return add(a.pts[k], mul(sub(a.pts[k + 1], a.pts[k]), l > 0 ? (s - cum[k]) / l : 0));
      }
      return a.pts[a.pts.length - 1];
    };
    for (let m = 0; m < marks.length - 1; m++) {
      const s0 = marks[m].s, s1 = marks[m + 1].s;
      const chain: V3[] = [nodePos.get(marks[m].node)!];
      for (let k = 1; k < a.pts.length - 1; k++) if (cum[k] > s0 + 0.5 && cum[k] < s1 - 0.5) chain.push(at(cum[k]));
      chain.push(nodePos.get(marks[m + 1].node)!);
      if (dist(chain[0], chain[chain.length - 1]) < 0.3 && chain.length === 2) continue;
      for (let k = 0; k < chain.length - 1; k++) {
        const p = chain[k], q = chain[k + 1];
        segments.push({ x1: p.x, y1: p.y, z1: p.z, x2: q.x, y2: q.y, z2: q.z, layer: a.layer, area: a.area, perimeter: a.perimeter });
      }
      usedNodes.add(marks[m].node); usedNodes.add(marks[m + 1].node);
      eu(marks[m].node, marks[m + 1].node);
    }
  });
  const comps = new Set([...usedNodes].map(ef));

  return { segments, bodies: axes.length, straight, curved, junctions, components: comps.size };
}

/**
 * Грани 3DFACE → тела: грани с общими вершинами собираются в одно тело.
 */
export function bodiesFromFaces(faces: { layer: string; pts: V3[] }[]): SolidBody[] {
  const key = (p: V3) => `${p.x.toFixed(3)}|${p.y.toFixed(3)}|${p.z.toFixed(3)}`;
  const id = new Map<string, number>();
  const pos: V3[] = [], lay: string[] = [];
  const parent: number[] = [];
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const f of faces) {
    const ids = f.pts.map(p => {
      const k = f.layer + "#" + key(p);
      let i = id.get(k);
      if (i === undefined) { i = pos.length; id.set(k, i); pos.push(p); lay.push(f.layer); parent.push(i); }
      return i;
    });
    for (let k = 1; k < ids.length; k++) { const a = find(ids[0]), b = find(ids[k]); if (a !== b) parent[a] = b; }
  }
  const groups = new Map<number, number[]>();
  pos.forEach((_, i) => { const r = find(i); const g = groups.get(r); if (g) g.push(i); else groups.set(r, [i]); });
  return [...groups.values()].map(g => ({ layer: lay[g[0]], pts: g.map(i => pos[i]) }));
}