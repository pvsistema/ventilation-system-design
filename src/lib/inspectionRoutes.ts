// ─────────────────────────────────────────────────────────────────────────────
// inspectionRoutes.ts — Маршруты профилактического обследования (МПО).
//
// Маршрут — упорядоченный набор выработок (как привязка ветвей у позиции ПЛА),
// по которому горноспасатели проходят профилактическое обследование.
// Для маршрута считается длина, время хода по нормативным скоростям
// (горноспасатель / горнорабочий) с учётом уклона и направления движения,
// и — по галочке — время на обследование пожарных кранов на маршруте.
// ─────────────────────────────────────────────────────────────────────────────
import { rescuerCleanSpeed, workerSpeedFor } from "./rescueCalculator";

export type InspectionSpeedMode = "rescuer" | "rd" | "fnip" | "selfrescuer";

export const INSPECTION_SPEED_MODES: { value: InspectionSpeedMode; label: string; hint: string }[] = [
  { value: "rescuer",     label: "Горноспасатель (в ИДА)",      hint: "Нормативные скорости горноспасателей в чистом воздухе (Инструкция № 520, прил. 4)" },
  { value: "rd",          label: "Горнорабочий, РД 15-11-2007", hint: "Скорость горнорабочего без ИДА по РД 15-11-2007" },
  { value: "fnip",        label: "Горнорабочий, ФНиП № 467",    hint: "Скорость горнорабочего по ФНиП № 467" },
  { value: "selfrescuer", label: "В самоспасателе",             hint: "Скорость в изолирующем самоспасателе (РД 15-11-2007, п. 46)" },
];

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
    speedMode: "rescuer",
    reversed: false,
    includeReturn: false,
    countHydrants: true,
    hydrantMinutes: 5,
    hydrantCountOverride: null,
    extraMinutes: 0,
    comment: "",
    ...partial,
  };
}

/** Типы значков УО, считающиеся пожарными кранами */
export const HYDRANT_SYMBOL_IDS = new Set(["fire_crane", "fire_crane_conn"]);

interface BranchLike { id: string; fromId: string; toId: string; length: number; angle: number; type?: string }
interface NodeLike { id: string; fireNodeType?: string; fireConsumerType?: string }
interface SymbolLike { typeId: string; branchId: string | null }

export interface InspectionSegment {
  branchId: string;
  label: string;
  forward: boolean;
  length: number;
  angle: number;     // знаковый угол по ходу движения
  speed: number;     // м/мин
  time: number;      // мин
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
}

function speedFor(mode: InspectionSpeedMode, signedAngle: number): number {
  if (mode === "rescuer") return rescuerCleanSpeed(signedAngle);
  if (mode === "selfrescuer") return workerSpeedFor("rescuer", signedAngle);
  return workerSpeedFor(mode, signedAngle);
}

export function calcInspectionRoute(
  route: InspectionRoute,
  branchById: Map<string, BranchLike>,
  nodeById: Map<string, NodeLike>,
  symbols: SymbolLike[],
): InspectionRouteResult {
  const ids = route.reversed ? [...route.branchIds].reverse() : route.branchIds;
  const list = ids.map(id => branchById.get(id)).filter((b): b is BranchLike => !!b);
  const missing = ids.length - list.length;

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

  const segments: InspectionSegment[] = [];
  let cur: string | null = null;
  let gaps = 0;
  list.forEach((b, i) => {
    let forward = true;
    let gapBefore = false;
    if (cur == null) {
      // Первая выработка: направление — к следующей выработке маршрута.
      const next = list[i + 1];
      if (next && (b.fromId === next.fromId || b.fromId === next.toId)
          && !(b.toId === next.fromId || b.toId === next.toId)) forward = false;
    } else if (cur === b.fromId) forward = true;
    else if (cur === b.toId) forward = false;
    else { gapBefore = true; gaps++; }
    const angle = forward ? (b.angle ?? 0) : -(b.angle ?? 0);
    const speed = speedFor(route.speedMode, angle);
    const length = Math.max(0, b.length || 0);
    const time = speed > 0 ? length / speed : 0;
    const hyd = (hydrantsByBranch.get(b.id) ?? 0) + nodeHydrant(b.fromId) + nodeHydrant(b.toId);
    segments.push({
      branchId: b.id, label: `${b.id}${b.type ? ". " + b.type : ""}`,
      forward, length, angle, speed, time, hydrants: hyd, gapBefore,
    });
    cur = forward ? b.toId : b.fromId;
  });

  const length = segments.reduce((s, x) => s + x.length, 0);
  const travelTime = segments.reduce((s, x) => s + x.time, 0);
  const returnTime = route.includeReturn
    ? segments.reduce((s, x) => {
        const sp = speedFor(route.speedMode, -x.angle);
        return s + (sp > 0 ? x.length / sp : 0);
      }, 0)
    : 0;
  const hydrantsAuto = segments.reduce((s, x) => s + x.hydrants, 0);
  const hydrants = route.hydrantCountOverride != null ? Math.max(0, route.hydrantCountOverride) : hydrantsAuto;
  const hydrantTime = route.countHydrants ? hydrants * Math.max(0, route.hydrantMinutes || 0) : 0;
  const extraTime = Math.max(0, route.extraMinutes || 0);
  const totalTime = travelTime + returnTime + hydrantTime + extraTime;
  return { segments, length, travelTime, returnTime, hydrantsAuto, hydrants, hydrantTime, extraTime, totalTime, gaps, missing };
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
