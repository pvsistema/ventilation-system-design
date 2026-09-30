// ─────────────────────────────────────────────────────────────────────────────
// inspectionRoutes.ts — Маршруты профилактического обследования (МПО).
//
// Маршрут — упорядоченный набор выработок (как привязка ветвей у позиции ПЛА),
// по которому горноспасатели проходят профилактическое обследование.
// Для маршрута считается длина, время хода по нормативным скоростям
// (горноспасатель / горнорабочий) с учётом уклона и направления движения,
// и — по галочке — время на обследование пожарных кранов на маршруте.
// ─────────────────────────────────────────────────────────────────────────────
import { workerSpeedFor } from "./rescueCalculator";

/**
 * Методика расчёта времени — ТА ЖЕ, что в «Время хода горнорабочего»:
 * РД 15-11-2007 или ФНиП № 467, скорость по углу наклона с учётом
 * направления движения (подъём/спуск). Задымление при профилактическом
 * обследовании не учитывается — выработки считаются чистыми.
 */
export type InspectionSpeedMode = "rd" | "fnip";

export const INSPECTION_SPEED_MODES: { value: InspectionSpeedMode; label: string; hint: string }[] = [
  { value: "rd",   label: "РД 15-11-2007 (Методические рекомендации)", hint: "Скорость горнорабочего по РД 15-11-2007, Прил. 4" },
  { value: "fnip", label: "ФНиП №467 (Инструкция, угольные шахты)",     hint: "Скорость горнорабочего по ФНиП № 467" },
];

/** Скорость горнорабочего, м/мин (округлённая, как в расчёте горнорабочего). */
export function inspectionSpeed(mode: InspectionSpeedMode, signedAngle: number): number {
  return Math.max(1, Math.round(workerSpeedFor(mode, signedAngle)));
}

/** Старые проекты хранили «rescuer»/«selfrescuer» — приводим к РД. */
export function normalizeSpeedMode(m: unknown): InspectionSpeedMode {
  return m === "fnip" ? "fnip" : "rd";
}

export interface InspectionRoute {
  id: string;
  number: number;
  name: string;
  color: string;
  /** Выработки маршрута в порядке обхода */
  branchIds: string[];
  /** Маршрут виден на схеме (окраска + подпись) */
  visible: boolean;
  /** Показывать подпись «длина · время» на схеме */
  showLabel: boolean;
  speedMode: InspectionSpeedMode;
  /** Пройти маршрут в обратном порядке */
  reversed: boolean;
  /** Учитывать обратный путь (возврат по тому же маршруту) */
  includeReturn: boolean;
  /** Суммировать время на обследование пожарных кранов */
  countHydrants: boolean;
  /** Время обследования одного пожарного крана, мин */
  hydrantMinutes: number;
  /** Ручное число кранов (null — считать автоматически по схеме) */
  hydrantCountOverride: number | null;
  /** Прочие затраты времени на маршруте, мин */
  extraMinutes: number;
  comment: string;
  /** Окраска маршрута внутри ветвей (заливка тела выработки) */
  colorInner?: boolean;
  /** Окраска маршрута снаружи ветвей (контур вокруг выработки) */
  colorOuter?: boolean;
  /** Положение таблички на схеме (мировые координаты). null — авто, у середины маршрута */
  labelX?: number | null;
  labelY?: number | null;
  labelZ?: number | null;
}

export const ROUTE_COLORS = [
  "#e11d48", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d",
];

export function makeInspectionRoute(partial?: Partial<InspectionRoute>): InspectionRoute {
  return {
    id: "mpo_" + Math.random().toString(36).slice(2, 10),
    number: 1,
    name: "",
    color: ROUTE_COLORS[0],
    branchIds: [],
    visible: true,
    showLabel: true,
    speedMode: "rd",
    reversed: false,
    includeReturn: false,
    countHydrants: true,
    hydrantMinutes: 5,
    hydrantCountOverride: null,
    extraMinutes: 0,
    comment: "",
    colorInner: false,
    colorOuter: true,
    labelX: null,
    labelY: null,
    labelZ: null,
    ...partial,
  };
}

/** Типы значков УО, считающиеся пожарными кранами */
export const HYDRANT_SYMBOL_IDS = new Set(["fire_crane", "fire_crane_conn"]);

interface BranchLike {
  id: string; fromId: string; toId: string; length: number; angle: number; type?: string; name?: string;
}
interface NodeLike {
  id: string; name?: string; number?: string; x?: number; y?: number; z?: number;
  fireNodeType?: string; fireConsumerType?: string;
}
interface SymbolLike { typeId: string; branchId: string | null }

export interface InspectionSegment {
  branchId: string;
  /** Наименование выработки (тип / название) */
  branchLabel: string;
  /** Полное наименование: «Штрек (Узел 1 → Узел 2)» */
  label: string;
  segmentNumber: number;
  forward: boolean;
  fromNodeId: string;
  toNodeId: string;
  length: number;
  angle: number;       // знаковый угол по ходу движения, °
  speed: number;       // м/мин туда
  speedBack: number;   // м/мин обратно
  time: number;        // мин туда
  timeBack: number;    // мин обратно
  cumulTime: number;   // Σt туда, мин
  hydrants: number;
  gapBefore: boolean;
}

export interface InspectionRouteResult {
  segments: InspectionSegment[];
  length: number;          // м (в одну сторону)
  travelTime: number;      // мин туда
  returnTime: number;      // мин обратно (0, если не учитывается)
  hydrantsAuto: number;
  hydrants: number;
  hydrantTime: number;     // мин
  extraTime: number;       // мин
  totalTime: number;       // мин
  gaps: number;            // разрывы в цепочке выработок
  missing: number;         // удалённые из схемы выработки
  warnings: string[];
}

export function calcInspectionRoute(
  route: InspectionRoute,
  branchById: Map<string, BranchLike>,
  nodeById: Map<string, NodeLike>,
  symbols: SymbolLike[],
): InspectionRouteResult {
  const mode = normalizeSpeedMode(route.speedMode);
  const ids = route.reversed ? [...route.branchIds].reverse() : route.branchIds;
  const list = ids.map(id => branchById.get(id)).filter((b): b is BranchLike => !!b);
  const missing = ids.length - list.length;

  // Длина как в расчёте горнорабочего: не задана — по координатам узлов.
  const effLength = (b: BranchLike): number => {
    if (Number.isFinite(b.length) && b.length > 0) return b.length;
    const a = nodeById.get(b.fromId), c = nodeById.get(b.toId);
    if (a && c) {
      const d = Math.hypot((c.x ?? 0) - (a.x ?? 0), (c.y ?? 0) - (a.y ?? 0), (c.z ?? 0) - (a.z ?? 0));
      if (Number.isFinite(d) && d > 0) return d;
    }
    return 0;
  };
  const nodeName = (id: string) => {
    const n = nodeById.get(id);
    return n?.name || (n?.number ? `Узел ${n.number}` : id);
  };

  // Краны: значки УО на выработках маршрута + узлы ППЗ «пожарный кран».
  const hydrantsByBranch = new Map<string, number>();
  const routeSet = new Set(list.map(b => b.id));
  for (const s of symbols) {
    if (s.branchId && routeSet.has(s.branchId) && HYDRANT_SYMBOL_IDS.has(s.typeId)) {
      hydrantsByBranch.set(s.branchId, (hydrantsByBranch.get(s.branchId) ?? 0) + 1);
    }
  }
  const countedNodes = new Set<string>();
  const nodeHydrant = (id: string) => {
    if (countedNodes.has(id)) return 0;
    const n = nodeById.get(id);
    if (n && n.fireNodeType === "consumer" && n.fireConsumerType === "fire_hydrant") {
      countedNodes.add(id);
      return 1;
    }
    return 0;
  };

  // ── Разрывы маршрута ────────────────────────────────────────────────────
  // Обследование захватывает выработки по пути: боковые ответвления, камеры,
  // тупики — в них заходят и возвращаются к основной трассе. Такие выработки
  // примыкают не к ПОСЛЕДНЕЙ пройденной, а к любому уже пройденному узлу, и
  // разрывом не считаются. Разрыв — только когда выработки маршрута вообще не
  // соединены между собой: при выборе пропущена выработка, лежащая на пути.
  // Считаем связные группы выработок маршрута (общие узлы); каждая группа,
  // кроме первой, — один разрыв. Отмечается первая выработка такой группы.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const b of list) {
    if (!parent.has(b.fromId)) parent.set(b.fromId, b.fromId);
    if (!parent.has(b.toId)) parent.set(b.toId, b.toId);
    const ra = find(b.fromId), rb = find(b.toId);
    if (ra !== rb) parent.set(ra, rb);
  }
  const seenGroups = new Set<string>();
  const gapAt = new Set<number>();
  list.forEach((b, i) => {
    const g = find(b.fromId);
    if (seenGroups.has(g)) return;
    if (seenGroups.size > 0) gapAt.add(i);
    seenGroups.add(g);
  });
  const gaps = gapAt.size;

  const segments: InspectionSegment[] = [];
  const visited = new Set<string>();
  let cur: string | null = null;
  let cum = 0;
  list.forEach((b, i) => {
    let forward = true;
    const gapBefore = gapAt.has(i);
    if (cur === b.fromId) forward = true;
    else if (cur === b.toId) forward = false;
    // Ответвление от уже пройденного узла (заход в камеру/тупик и т.п.)
    else if (visited.has(b.fromId)) forward = true;
    else if (visited.has(b.toId)) forward = false;
    else {
      // Начало маршрута или новой группы: направление — к следующей выработке.
      const next = list[i + 1];
      if (next && (b.fromId === next.fromId || b.fromId === next.toId)
          && !(b.toId === next.fromId || b.toId === next.toId)) forward = false;
    }
    visited.add(b.fromId);
    visited.add(b.toId);

    const rawAngle = Number.isFinite(b.angle) ? b.angle : 0;
    const angle = forward ? rawAngle : -rawAngle;
    const speed = inspectionSpeed(mode, angle);
    const speedBack = inspectionSpeed(mode, -angle);
    const length = effLength(b);
    const time = length > 0 ? length / speed : 0;
    const timeBack = length > 0 ? length / speedBack : 0;
    cum += time;
    const fromNodeId = forward ? b.fromId : b.toId;
    const toNodeId = forward ? b.toId : b.fromId;
    const branchLabel = b.type?.trim() || b.name?.trim() || "";
    const route2 = `${nodeName(fromNodeId)} → ${nodeName(toNodeId)}`;
    const hyd = (hydrantsByBranch.get(b.id) ?? 0) + nodeHydrant(b.fromId) + nodeHydrant(b.toId);
    segments.push({
      branchId: b.id, branchLabel,
      label: branchLabel ? `${branchLabel} (${route2})` : route2,
      segmentNumber: i + 1, forward, fromNodeId, toNodeId,
      length, angle, speed, speedBack, time, timeBack, cumulTime: cum,
      hydrants: hyd, gapBefore,
    });
    cur = toNodeId;
  });

  const length = segments.reduce((s, x) => s + x.length, 0);
  const travelTime = segments.reduce((s, x) => s + x.time, 0);
  const returnTime = route.includeReturn ? segments.reduce((s, x) => s + x.timeBack, 0) : 0;
  const hydrantsAuto = segments.reduce((s, x) => s + x.hydrants, 0);
  const hydrants = route.hydrantCountOverride != null ? Math.max(0, route.hydrantCountOverride) : hydrantsAuto;
  const hydrantTime = route.countHydrants ? hydrants * Math.max(0, route.hydrantMinutes || 0) : 0;
  const extraTime = Math.max(0, route.extraMinutes || 0);
  const totalTime = travelTime + returnTime + hydrantTime + extraTime;
  const warnings: string[] = [];
  if (gaps > 0) warnings.push(`Разрывов маршрута: ${gaps} — выработки не соединены между собой, добавьте пропущенные выработки на пути`);
  if (missing > 0) warnings.push(`Выработок, удалённых из схемы: ${missing}`);
  return {
    segments, length, travelTime, returnTime, hydrantsAuto, hydrants, hydrantTime, extraTime, totalTime,
    gaps, missing, warnings,
  };
}

/** «1 ч 05 мин» / «32 мин» */
export function fmtMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "0 мин";
  const total = Math.round(min);
  if (total < 60) return `${Math.max(1, total)} мин`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} ч ${String(m).padStart(2, "0")} мин`;
}

export function fmtLength(m: number): string {
  if (m >= 10000) return `${(m / 1000).toFixed(2).replace(".", ",")} км`;
  return `${Math.round(m).toLocaleString("ru-RU")} м`;
}
// ─── Таблички маршрутов МПО на схеме (рабочая область, печать, экспорт) ─────

export interface InspectionLabel {
  id: string;
  color: string;
  title: string;
  text: string;
  /** Точка маршрута (середина средней выработки), мировые координаты */
  ax: number; ay: number; az: number;
  /** Положение таблички (перемещённое или = якорь) */
  x: number; y: number; z: number;
  moved: boolean;
}

/**
 * Таблички «МПО № N · длина · время» для видимых маршрутов. Одна функция для
 * рабочей области, предпросмотра печати и экспорта — числа и положение
 * таблички везде одинаковые.
 */
export function buildInspectionLabels(
  routes: InspectionRoute[],
  branches: BranchLike[],
  nodes: (NodeLike & { x: number; y: number; z: number })[],
  symbols: SymbolLike[],
): InspectionLabel[] {
  const visible = routes.filter(r => r.visible && r.showLabel && r.branchIds.length > 0);
  if (visible.length === 0) return [];
  const branchById = new Map(branches.map(b => [b.id, b]));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const out: InspectionLabel[] = [];
  for (const r of visible) {
    const res = calcInspectionRoute(r, branchById, nodeById, symbols);
    const mid = res.segments[Math.floor((res.segments.length - 1) / 2)];
    const br = mid ? branchById.get(mid.branchId) : undefined;
    const a = br ? nodeById.get(br.fromId) : undefined;
    const b = br ? nodeById.get(br.toId) : undefined;
    if (!a || !b) continue;
    const ax = (a.x + b.x) / 2, ay = (a.y + b.y) / 2, az = ((a.z ?? 0) + (b.z ?? 0)) / 2;
    const moved = r.labelX != null && r.labelY != null;
    out.push({
      id: r.id, color: r.color,
      title: r.name ? `МПО № ${r.number} · ${r.name}` : `МПО № ${r.number}`,
      text: `${fmtLength(res.length)} · ${fmtMinutes(res.totalTime)}`,
      ax, ay, az, moved,
      x: moved ? (r.labelX as number) : ax,
      y: moved ? (r.labelY as number) : ay,
      z: moved ? (r.labelZ ?? az) : az,
    });
  }
  return out;
}

/**
 * Окраска ветвей маршрутами МПО: внутри (заливка) и снаружи (контур).
 * Маршруты приоритетнее позиций ПЛА — их цвета кладутся первыми.
 */
export function inspectionBranchColors(routes: InspectionRoute[]): { inner: Map<string, string>; outer: Map<string, string> } {
  const inner = new Map<string, string>();
  const outer = new Map<string, string>();
  for (const r of routes) {
    if (!r.visible) continue;
    for (const bid of r.branchIds) {
      if (r.colorInner && !inner.has(bid)) inner.set(bid, r.color);
      if (r.colorOuter !== false && !outer.has(bid)) outer.set(bid, r.color);
    }
  }
  return { inner, outer };
}

/**
 * Масштаб таблички — как у маркеров позиций ПЛА: при «Пределах масштаба»
 * размер не зависит от зума и зажат в posMin%..posMax%, иначе 0.25…8.
 */
export function inspectionLabelScale(viewScale: number, xyScale: number | undefined, fixed: boolean, posMin: number, posMax: number): number {
  const xy = Math.max(1, xyScale ?? 1);
  const raw = fixed ? 1 : viewScale / (xy * 0.4);
  return fixed ? Math.min(posMax / 100, Math.max(posMin / 100, raw)) : Math.min(8, Math.max(0.25, raw));
}

/**
 * Рисует табличку МПО на 2D-контексте (печать, PNG/PDF, векторный экспорт).
 * (sx, sy) — экранная точка таблички, (asx, asy) — точка маршрута, k — пикселей
 * на «пиксель рабочей области» (масштаб таблички × коэффициент листа).
 */
export function drawInspectionLabel(
  ctx: CanvasRenderingContext2D, l: InspectionLabel,
  sx: number, sy: number, asx: number, asy: number, k: number,
): void {
  const fsTitle = 10 * k, fsText = 11 * k;
  const padX = 7 * k, padY = 2 * k, lh = 1.25;
  ctx.save();
  ctx.font = `700 ${fsTitle}px Arial, sans-serif`;
  const wTitle = ctx.measureText(l.title).width;
  ctx.font = `600 ${fsText}px Arial, sans-serif`;
  const wText = ctx.measureText(l.text).width;
  const w = Math.max(wTitle, wText) + padX * 2 + 4 * k;
  const h = fsTitle * lh + fsText * lh + padY * 2 + 4 * k;
  // Прямоугольник таблички: перемещённая — центром в точке, иначе над маршрутом
  const x0 = sx - w / 2;
  const y0 = l.moved ? sy - h / 2 : sy - h - 10 * k;

  if (l.moved) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = Math.max(1, 1.5 * k);
    ctx.setLineDash([4 * k, 3 * k]);
    ctx.beginPath(); ctx.moveTo(asx, asy); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = l.color;
    ctx.beginPath(); ctx.arc(asx, asy, Math.max(2, 3 * k), 0, Math.PI * 2); ctx.fill();
  }

  const r = 6 * k;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x0 + w - r, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  ctx.lineTo(x0 + w, y0 + h - r); ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  ctx.lineTo(x0 + r, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  ctx.strokeStyle = l.color;
  ctx.lineWidth = 2 * k;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = l.color;
  ctx.font = `700 ${fsTitle}px Arial, sans-serif`;
  ctx.fillText(l.title, sx, y0 + 2 * k + padY);
  ctx.fillStyle = "#111827";
  ctx.font = `600 ${fsText}px Arial, sans-serif`;
  ctx.fillText(l.text, sx, y0 + 2 * k + padY + fsTitle * lh);
  ctx.restore();
}
