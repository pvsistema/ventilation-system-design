// ─────────────────────────────────────────────────────────────────────────────
// Давление в стволах и крутых выработках водопровода ППЗ.
//
// В вертикальном стволе вода набирает ~0,098 МПа на каждые 10 м высоты.
// Худший случай — краны закрыты (статический напор): так труба стоит большую
// часть времени. Если внизу ствола давление выше допустимого (норма «P макс»
// проверки ППЗ), подсказываем поставить бак разрыва струи: в нём давление
// сбрасывается до атмосферного, и ниже набирается заново. Для глубоких стволов —
// каскадом, шаг между баками не больше высоты, на которой набирается P макс.
//
// Баки, уже стоящие на схеме, учтены: расчёт идёт по ветвям, в которые
// параметры значков впечатаны функцией withWaterPumps.
// ─────────────────────────────────────────────────────────────────────────────

import { surveyXYZ, type TopoBranch, type TopoNode } from "./topology";
import { solveWaterNetwork } from "./waterSolver";

const RHO_G_MPA = (1000 * 9.81) / 1e6;
/** Крутизна, начиная с которой выработка считается стволом/восстающим (≈ 45°). */
const STEEP_RATIO = 0.7;
/** Перепад высоты, меньше которого ветвь не проверяем, м. */
const MIN_DROP_M = 10;

export interface ShaftPressureIssue {
  branchId: string;
  /** «Узел 3 → Узел 7» — сверху вниз */
  title: string;
  /** Перепад высоты по ветви, м */
  drop: number;
  /** Давление вверху / внизу ветви при закрытых кранах, МПа */
  pTop: number;
  pBottom: number;
  /** На ветви уже стоит бак разрыва струи / редукционный клапан */
  hasTank: boolean;
  hasReducer: boolean;
  /** Сколько баков нужно добавить на этой ветви */
  tanksNeeded: number;
  /** Глубины установки баков от верхнего узла ветви, м */
  tankDepths: number[];
  recommendation: string;
}

export interface ShaftPressureResult {
  issues: ShaftPressureIssue[];
  /** Сколько крутых ветвей проверено */
  total: number;
  /** Высота, на которой набирается P макс, м — наибольший шаг каскада */
  stepM: number;
}

const zOf = (n?: TopoNode) => (n ? surveyXYZ(n).z ?? 0 : 0);
const fmt = (v: number, k = 2) => String(+v.toFixed(k)).replace(".", ",");

export function checkShaftPressure(
  nodes: TopoNode[],
  branches: TopoBranch[],
  maxPressure: number,
): ShaftPressureResult {
  const stepM = maxPressure > 0 ? maxPressure / RHO_G_MPA : 0;
  const empty = { issues: [], total: 0, stepM };
  if (maxPressure <= 0) return empty;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const steep = branches.filter((b) => {
    if (!b.hasWaterPipe || b.fromId === b.toId) return false;
    const dz = Math.abs(zOf(nodeMap.get(b.fromId)) - zOf(nodeMap.get(b.toId)));
    const len = Math.max(b.length ?? 0, dz);
    return dz >= MIN_DROP_M && len > 0 && dz / len >= STEEP_RATIO;
  });
  if (!steep.length) return empty;

  // Все краны закрыты — статический напор, наибольшее давление в трубах.
  const closed = nodes.map((n) =>
    (n.fireNodeType ?? "none") === "consumer" && n.fireHydrantOpen ? { ...n, fireHydrantOpen: false } : n);
  const { pressures } = solveWaterNetwork(closed, branches);
  const label = new Map(nodes.map((n) => [n.id, n.number || n.name || n.id.slice(-4)]));

  const issues: ShaftPressureIssue[] = [];
  for (const b of steep) {
    const zFrom = zOf(nodeMap.get(b.fromId));
    const zTo = zOf(nodeMap.get(b.toId));
    const [topId, botId] = zFrom >= zTo ? [b.fromId, b.toId] : [b.toId, b.fromId];
    if (!pressures.has(topId) && !pressures.has(botId)) continue;
    const drop = Math.abs(zFrom - zTo);
    const pBottom = pressures.get(botId) ?? 0;
    if (pBottom <= maxPressure) continue;

    const hasTank = !!b.wpHasBreakTank;
    const hasReducer = !!b.wpHasReducer;
    // Давление, с которым вода входит в ствол сверху (без учёта баков на
    // этой ветви): внизу — оно плюс столб воды, если бака нет.
    const pTop = pressures.get(topId) ?? 0;
    // Где давление в стволе впервые достигает P макс (от верхнего узла).
    // Если бак уже стоит — считаем от уровня, на котором давление внизу
    // набирается после него: Δ = (pBottom − P макс) / ρg над нижним узлом.
    const excessM = (pBottom - maxPressure) / RHO_G_MPA;
    const firstDepth = Math.max(0, drop - excessM);
    const tanksNeeded = Math.max(1, Math.ceil(excessM / stepM));
    const depths: number[] = [];
    for (let k = 0; k < tanksNeeded; k++) {
      const d = firstDepth + k * stepM;
      if (d < drop) depths.push(Math.round(d));
    }

    const where = depths.length === 1
      ? `на глубине ${depths[0]} м от верхнего узла`
      : `каскадом на глубинах ${depths.join(", ")} м от верхнего узла (шаг не более ${Math.floor(stepM)} м)`;
    const prefix = hasTank ? "Добавить ещё бак разрыва струи" : "Установить бак разрыва струи";
    const note = hasReducer && !hasTank
      ? ". Редукционный клапан защищает только участок ниже себя — сам ствол выше клапана остаётся под давлением"
      : "";

    issues.push({
      branchId: b.id,
      title: `${label.get(topId) ?? "?"} → ${label.get(botId) ?? "?"}`,
      drop: Math.round(drop),
      pTop: +pTop.toFixed(2),
      pBottom: +pBottom.toFixed(2),
      hasTank, hasReducer,
      tanksNeeded: depths.length,
      tankDepths: depths,
      recommendation: `${prefix} ${where}: давление внизу ${fmt(pBottom)} МПа при допустимом ${fmt(maxPressure)} МПа${note}`,
    });
  }

  issues.sort((a, b) => b.pBottom - a.pBottom);
  return { issues, total: steep.length, stepM };
}
