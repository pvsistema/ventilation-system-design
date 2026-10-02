// ─────────────────────────────────────────────────────────────────────────────
// Проверка схемы по «Методическим рекомендациям по проверке электронных
// моделей топологии горных выработок ОПО» (ВГСЧ, 2023) — критерии, которых
// не было в остальных модулях проверки:
//
//   • замерные станции: замер против модели (п. 4.1.8 и 4.2.3) — не более
//     10 % для капитальных выработок и 20 % для остальных;
//   • контрольный коэффициент α = R·S³/(P·L) по ИТОГОВОМУ сопротивлению
//     ветви, в т. ч. заданному вручную (п. 4.1.4): 0,001…1,0 Н·с²/м⁴;
//   • соседние ветви одной выработки (Приложение 3): α отличается более
//     чем на 100 % при сечениях, отличающихся не более чем на 10 %, —
//     местное сопротивление или ошибка R; сечения соседних ветвей,
//     отличающиеся более чем на 10 %, — сверить с документацией;
//   • поверхностный узел соединён более чем с одной ветвью (п. 4.1.1);
//   • сопротивление вентсооружений по видам (п. 4.1.6);
//   • давление разрушения перемычек — задано ли оно (нужно для расчёта взрыва);
//   • позиции ПЛА: повторяющиеся номера и выработки, не вошедшие ни в одну позицию.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch } from "./topology";
import { type BranchNote, type NodeNote, type GroupNote, pushCapped, fmtNum, fmtKmu } from "./schemaCheckTypes";
import type { BranchBulkheadInfo } from "./branchBulkheadInfo";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { BULKHEAD_SYMBOL_IDS, WINDOW_BULKHEAD_IDS, OPEN_DOOR_IDS, LEGEND_TYPES } from "./schemaSymbols";
import { defaultFailureMPa } from "./blastBarriers";
import type { Position } from "./positions";

/** g: перевод кгс·с²/м⁸ (кМюрг) в Н·с²/м⁸ и кгс·с²/м⁴ в Н·с²/м⁴. */
const G = 9.81;

const MEASURE_STATION_ID = "measure_station";

export interface MethodCheckResult {
  /** Расчёт выполнялся — без него сравнение с замерами невозможно. */
  solved: boolean;
  /** Замерные станции с расходом, отличающимся от модели больше допуска. */
  measureMismatch: BranchNote[];
  /** Замерные станции без замеренного расхода — не с чем сравнивать. */
  measureNoData: number;
  /** Всего замерных станций на выработках. */
  measureTotal: number;
  /** Контрольный α вне 0,001…1,0 Н·с²/м⁴. */
  controlAlpha: BranchNote[];
  /** Соседние ветви одной выработки: α различается более чем в 2 раза. */
  alphaJump: GroupNote[];
  /** Соседние ветви одной выработки: сечения различаются более чем на 10 %. */
  areaJump: GroupNote[];
  /** Поверхностный узел соединён более чем с одной ветвью. */
  surfaceMulti: NodeNote[];
  /** Сопротивление вентсооружения вне нормы для своего вида. */
  bulkheadNorm: BranchNote[];
  /** Закрытые и глухие перемычки, у которых сопротивление не задано (R = 0). */
  bulkheadZero: BranchNote[];
  /** Изолирующие перемычки выше нормы, но в пределах допуска с герметизацией (×2,25). */
  bulkheadAllowed: BranchNote[];
  /** Перемычки без заданного давления разрушения (или с неправдоподобным). */
  bulkheadFailure: BranchNote[];
  /** Глухие перемычки и двери без толщины или с неправдоподобной толщиной. */
  bulkheadThickness: BranchNote[];
  /** Всего позиций ПЛА на схеме. */
  positionsTotal: number;
  /** Разные позиции ПЛА с одинаковым номером. */
  positionDupes: GroupNote[];
  /** Выработки, не вошедшие ни в одну позицию ПЛА. */
  branchNoPosition: BranchNote[];
  truncated: boolean;
}

export interface MethodCheckOptions {
  /** % — допуск «замер/модель» для капитальных выработок (методика: 10). */
  measureTolCapital?: number;
  /** % — допуск для остальных выработок (методика: 20). */
  measureTolOther?: number;
  /** Н·с²/м⁴ — допустимый диапазон контрольного α (методика: 0,001…1,0). */
  controlAlphaMin?: number;
  controlAlphaMax?: number;
  /** Разница α соседних ветвей, раз (методика: > 100 % → 2). */
  alphaJumpRatio?: number;
  /** % — разница сечений соседних ветвей (методика: 10). */
  areaJumpPercent?: number;
  /** кМюрг — максимум сопротивления изолирующей перемычки (методика: 305, с герметизацией ×2,25). */
  isolMaxR?: number;
  /** кМюрг — максимум сопротивления вентиляционной перемычки (парус). По умолчанию 10. */
  ventMaxR?: number;
  bulkheads?: Map<string, BranchBulkheadInfo>;
  symbols?: SchemaSymbol[];
  /** Позиции плана ликвидации аварий. */
  positions?: Position[];
}

/**
 * Контрольный коэффициент α по итоговому R, Н·с²/м⁴.
 * R ветви хранится в кМюрг (кгс·с²/м⁸) — умножаем на g.
 */
export function controlAlphaSi(b: TopoBranch): number {
  const R = b.resistance ?? 0;
  const S = b.area ?? 0, P = b.perimeter ?? 0, L = b.length ?? 0;
  if (!(R > 0) || !(S > 0) || !(P > 0) || !(L > 0)) return 0;
  return (R * G * S * S * S) / (P * L);
}

/** Вид вентсооружения для норм методики (п. 4.1.6). */
type BulkKind = "isolating" | "sluice" | "regulator" | "open" | "vent";

function bulkKindOf(typeId: string): BulkKind | null {
  if (!BULKHEAD_SYMBOL_IDS.has(typeId)) return null;
  // Парус — вентиляционная перемычка с малым сопротивлением, не изолирующая.
  if (typeId === "sail") return "vent";
  if (OPEN_DOOR_IDS.has(typeId)) return "open";
  if (WINDOW_BULKHEAD_IDS.has(typeId) || typeId === "regulator") return "regulator";
  if (/^(door|auto|fire_door)/.test(typeId)) return "sluice";
  return "isolating";
}

export function checkMethod(
  nodes: TopoNode[],
  branches: TopoBranch[],
  solved: boolean,
  opts: MethodCheckOptions = {},
): MethodCheckResult {
  const tolCap = (opts.measureTolCapital ?? 10) / 100;
  const tolOther = (opts.measureTolOther ?? 20) / 100;
  const aMin = opts.controlAlphaMin ?? 0.001;
  const aMax = opts.controlAlphaMax ?? 1.0;
  const jumpRatio = opts.alphaJumpRatio ?? 2;
  const areaTol = (opts.areaJumpPercent ?? 10) / 100;
  const isolMaxR = opts.isolMaxR ?? 305;
  const ventMaxR = opts.ventMaxR ?? 10;
  const symbols = opts.symbols ?? [];

  let truncated = false;
  const push = <T,>(arr: T[], item: T) => { if (!pushCapped(arr, item)) truncated = true; };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const isAux = (b: TopoBranch) => !!b.isVentPipeBranch || b.isLeakage;
  const hasStructure = (b: TopoBranch) => !!b.hasFan || !!opts.bulkheads?.get(b.id)?.present;

  // ── Замерные станции: замер против модели ───────────────────────────────
  const measureMismatch: BranchNote[] = [];
  let measureNoData = 0, measureTotal = 0;
  for (const s of symbols) {
    if (s.typeId !== MEASURE_STATION_ID || !s.branchId) continue;
    const b = branchById.get(s.branchId);
    if (!b) continue;
    measureTotal++;
    const qFact = s.msFlow;
    if (typeof qFact !== "number" || !(qFact > 0)) { measureNoData++; continue; }
    if (!solved) continue;
    const qModel = Math.abs(b.flow ?? 0);
    const tol = b.capital ? tolCap : tolOther;
    const dev = Math.abs(qModel - qFact) / qFact;
    if (dev > tol) {
      push(measureMismatch, {
        branch: b,
        note: `ЗС ${s.msNumber || ""}: замер ${fmtNum(qFact, 2)}, модель ${fmtNum(qModel, 2)} м³/с — ${fmtNum(dev * 100, 0)} % (допуск ${fmtNum(tol * 100, 0)} %${b.capital ? ", капитальная" : ""})`.replace("ЗС :", "ЗС:"),
      });
    }
  }

  // ── Контрольный коэффициент α ───────────────────────────────────────────
  const controlAlpha: BranchNote[] = [];
  const alphaOf = new Map<string, number>();
  for (const b of branches) {
    if (isAux(b) || hasStructure(b) || b.fromId === b.toId) continue;
    const a = controlAlphaSi(b);
    if (!(a > 0)) continue;
    alphaOf.set(b.id, a);
    if (a < aMin || a > aMax) {
      push(controlAlpha, {
        branch: b,
        note: `α = ${a < 0.01 ? a.toExponential(2) : fmtNum(a, 4)} Н·с²/м⁴ — ${a < aMin ? "ниже" : "выше"} ${a < aMin ? aMin : aMax}${b.resistanceMode === "manual" ? " (R задано вручную)" : ""}`,
      });
    }
  }

  // ── Соседние ветви одной выработки ──────────────────────────────────────
  // «Одна выработка» — две ветви, сходящиеся в узле ровно двух ветвей
  // (промежуточный узел без примыканий) и не несущие вентсооружений.
  const byNode = new Map<string, TopoBranch[]>();
  for (const b of branches) {
    if (b.fromId === b.toId) continue;
    (byNode.get(b.fromId) ?? byNode.set(b.fromId, []).get(b.fromId)!).push(b);
    (byNode.get(b.toId) ?? byNode.set(b.toId, []).get(b.toId)!).push(b);
  }
  const alphaJump: GroupNote[] = [];
  const areaJump: GroupNote[] = [];
  for (const [nid, list] of byNode) {
    if (list.length !== 2) continue;
    const n = nodeById.get(nid);
    if (!n || n.atmosphereLink) continue;
    const [a, b] = list;
    if (isAux(a) || isAux(b)) continue;
    const sa = a.area ?? 0, sb = b.area ?? 0;
    if (!(sa > 0) || !(sb > 0)) continue;
    const areaDiff = Math.abs(sa - sb) / Math.min(sa, sb);
    const title = `${a.type || `Ветвь ${a.id}`} ↔ ${b.type || `Ветвь ${b.id}`}`;
    const focus = { x: n.x, y: n.y, z: n.z };
    if (areaDiff > areaTol) {
      push(areaJump, {
        title, nodeIds: [nid], branchIds: [a.id, b.id], focus,
        note: `S ${fmtNum(sa, 1)} и ${fmtNum(sb, 1)} м² — разница ${fmtNum(areaDiff * 100, 0)} %`,
      });
      continue;
    }
    if (hasStructure(a) || hasStructure(b)) continue;
    const aa = alphaOf.get(a.id) ?? 0, ab = alphaOf.get(b.id) ?? 0;
    if (!(aa > 0) || !(ab > 0)) continue;
    const ratio = Math.max(aa, ab) / Math.min(aa, ab);
    if (ratio > jumpRatio) {
      push(alphaJump, {
        title, nodeIds: [nid], branchIds: [a.id, b.id], focus,
        note: `α ${fmtNum(aa, 4)} и ${fmtNum(ab, 4)} Н·с²/м⁴ — в ${fmtNum(ratio, 1)} раза при равных сечениях`,
      });
    }
  }

  // ── Поверхностный узел соединён более чем с одной ветвью ────────────────
  const surfaceMulti: NodeNote[] = [];
  for (const n of nodes) {
    if (!n.atmosphereLink) continue;
    const deg = byNode.get(n.id)?.length ?? 0;
    if (deg > 1) push(surfaceMulti, { node: n, note: `Связь с атмосферой, но к узлу подходит ${deg} ветви — выход на поверхность должен быть отдельной ветвью` });
  }

  // ── Сопротивление вентсооружений по видам ───────────────────────────────
  // Методика (кμ = кМюрг): изолирующие ≥ 10 и ≤ 305 (с герметизацией ×2,25);
  // шлюзы: капитальные ≥ 1,5, прочие ≥ 0,8, конвейерные ≥ 0,3;
  // регуляторы с окном ≤ 10 и не меньше удельного R своей выработки.
  const bulkheadNorm: BranchNote[] = [];
  const bulkheadZero: BranchNote[] = [];
  const bulkheadAllowed: BranchNote[] = [];
  const R_ = (v: number) => `R ${fmtKmu(v)} кμ`;
  for (const b of branches) {
    const info = opts.bulkheads?.get(b.id);
    if (!info?.present || info.allOpen) continue;
    const syms = symbols.filter((s) => s.branchId === b.id && BULKHEAD_SYMBOL_IDS.has(s.typeId));
    const kinds = new Set(syms.map((s) => bulkKindOf(s.typeId)).filter((k): k is BulkKind => !!k));
    if (kinds.size === 0) {
      // Перемычка без значка (задана во вкладке ветви) — вид по названию.
      kinds.add(/парус/i.test(info.name) ? "vent" : info.hasWindow ? "regulator" : "isolating");
    }
    const R = info.rKmu;
    const name = info.name;
    const isolating = kinds.has("isolating") && !kinds.has("sluice") && !kinds.has("regulator");
    const sluice = kinds.has("sluice") && !kinds.has("regulator");
    // Только паруса (вентиляционные перемычки) — без глухих, дверей и регуляторов.
    const ventOnly = kinds.has("vent") && !kinds.has("isolating") && !kinds.has("sluice") && !kinds.has("regulator");
    if (!(R > 0)) {
      // Закрытая дверь или глухая перемычка без сопротивления — воздух через
      // неё проходит свободно, расчёт считает её открытым проёмом.
      if (isolating || sluice || ventOnly) {
        push(bulkheadZero, { branch: b, note: `${name}: сопротивление не задано (R = 0${info.modeLabel ? `, ${info.modeLabel}` : ""}) — в расчёте перемычки нет` });
      }
      continue;
    }
    const isConveyor = /конвейер/i.test(b.type || "");
    if (ventOnly) {
      if (R > ventMaxR) push(bulkheadNorm, { branch: b, note: `${name}: ${R_(R)} — вентиляционная перемычка (парус) не должна превышать ${fmtKmu(ventMaxR)} кμ; проверьте вид сооружения` });
    } else if (isolating) {
      if (R < 10) push(bulkheadNorm, { branch: b, note: `${name}: ${R_(R)} — изолирующая перемычка должна быть не менее 10 кμ` });
      else if (R > isolMaxR * 2.25) push(bulkheadNorm, { branch: b, note: `${name}: ${R_(R)} — больше ${fmtKmu(isolMaxR * 2.25)} кμ даже с герметизацией` });
      else if (R > isolMaxR) push(bulkheadAllowed, { branch: b, note: `${name}: ${R_(R)} — выше ${fmtKmu(isolMaxR)} кμ, но в пределах ${fmtKmu(isolMaxR * 2.25)} кμ при герметизации (превышение ×${fmtNum(R / isolMaxR, 2)})` });
    } else if (sluice) {
      const min = b.capital ? 1.5 : isConveyor ? 0.3 : 0.8;
      const what = b.capital ? "капитальной" : isConveyor ? "конвейерной" : "участковой";
      if (R < min) push(bulkheadNorm, { branch: b, note: `${name}: ${R_(R)} — шлюз в ${what} выработке должен быть не менее ${min} кμ` });
      else if (R > 10 && !kinds.has("isolating")) push(bulkheadNorm, { branch: b, note: `${name}: ${R_(R)} — выше 10 кμ (минимум изолирующей перемычки); проверьте вид сооружения` });
    } else if (kinds.has("regulator")) {
      // Сопротивление самой выработки (трение), без вентсооружений.
      const rOwn = b.resistance ?? 0;
      if (R > 10) push(bulkheadNorm, { branch: b, note: `${name}: ${R_(R)} — регулятор с окном не должен превышать 10 кμ` });
      else if (rOwn > 0 && R < rOwn) push(bulkheadNorm, { branch: b, note: `${name}: ${R_(R)} — меньше сопротивления самой выработки (${fmtKmu(rOwn)} кμ), регулятор не работает` });
    }
  }

  // ── Давление разрушения перемычек ───────────────────────────────────────
  // Без него расчёт взрыва подставляет значение «по материалу» — перемычка
  // может оказаться прочнее или слабее фактической. Открытые проёмы и окна
  // во всё сечение волну не держат — их не проверяем.
  const bulkheadFailure: BranchNote[] = [];
  const symName = (typeId: string) => LEGEND_TYPES.find((l) => l.id === typeId)?.name ?? "Перемычка";
  const symsByBranch = new Map<string, SchemaSymbol[]>();
  for (const s of symbols) {
    if (!s.branchId || !BULKHEAD_SYMBOL_IDS.has(s.typeId)) continue;
    (symsByBranch.get(s.branchId) ?? symsByBranch.set(s.branchId, []).get(s.branchId)!).push(s);
  }
  for (const b of branches) {
    const syms = symsByBranch.get(b.id) ?? [];
    const area = b.area ?? 0;
    const branchFp = b.bulkheadFailurePressure ?? 0;
    const probs: string[] = [];
    for (const s of syms) {
      const win = s.bkWindowArea ?? 0;
      if (OPEN_DOOR_IDS.has(s.typeId) && win <= 0.001) continue;
      if (win > 0.001 && area > 0 && win >= area * 0.999) continue;
      const fp = (s.bkFailurePressure ?? 0) > 0 ? (s.bkFailurePressure as number) : branchFp;
      const name = s.bkBulkheadName || symName(s.typeId);
      if (!(fp > 0)) probs.push(`${name}: не задано — в расчёте взрыва ${fmtNum(defaultFailureMPa(s.typeId), 3)} МПа по материалу`);
      else if (fp > 5) probs.push(`${name}: ${fmtNum(fp, 2)} МПа — неправдоподобно много (проверьте единицы: МПа, не кПа)`);
    }
    if (syms.length === 0 && b.hasBulkhead && !(branchFp > 0)) {
      probs.push("Перемычка ветви: не задано — в расчёте взрыва 0,16 МПа");
    }
    if (probs.length > 0) push(bulkheadFailure, { branch: b, note: probs.join("; ") });
  }

  // ── Толщина перемычек ───────────────────────────────────────────────────
  // Проверяем сплошные сооружения (глухие, двери, взрывоустойчивые, водо-
  // подпорные). Паруса, открытые проёмы и окна во всё сечение — без толщины.
  const bulkheadThickness: BranchNote[] = [];
  for (const b of branches) {
    const probs: string[] = [];
    for (const s of symsByBranch.get(b.id) ?? []) {
      if (s.typeId === "sail" || OPEN_DOOR_IDS.has(s.typeId)) continue;
      const win = s.bkWindowArea ?? 0;
      const area = b.area ?? 0;
      if (win > 0.001 && area > 0 && win >= area * 0.999) continue;
      const name = s.bkBulkheadName || symName(s.typeId);
      const t = s.bkThickness ?? 0;
      const blast = s.typeId.startsWith("bk_blast");
      if (!(t > 0)) probs.push(`${name}: толщина не задана`);
      else if (t < 0.02) probs.push(`${name}: ${fmtNum(t, 3)} м — слишком тонкая (проверьте единицы: метры, не см)`);
      else if (t > 10) probs.push(`${name}: ${fmtNum(t, 2)} м — неправдоподобно толстая (проверьте единицы: метры, не мм)`);
      else if (blast && t < 0.5) probs.push(`${name}: ${fmtNum(t, 2)} м — тоньше обычной для взрывоустойчивой перемычки (0,5 м и более); сверьте с проектом`);
    }
    if (probs.length > 0) push(bulkheadThickness, { branch: b, note: probs.join("; ") });
  }

  // ── Позиции ПЛА ─────────────────────────────────────────────────────────
  const positions = opts.positions ?? [];
  const positionDupes: GroupNote[] = [];
  const branchNoPosition: BranchNote[] = [];
  if (positions.length > 0) {
    // Копии одной позиции (тот же номер и то же название) допустимы —
    // это одна позиция, показанная в нескольких местах схемы.
    const byNum = new Map<number, Position[]>();
    for (const p of positions) (byNum.get(p.number) ?? byNum.set(p.number, []).get(p.number)!).push(p);
    const key = (p: Position) => `${(p.name || "").trim().toLowerCase()}|${p.accidentType}`;
    for (const [num, list] of [...byNum].sort((a, b) => a[0] - b[0])) {
      const distinct = new Set(list.map(key));
      if (distinct.size < 2) continue;
      const withBr = list.find((p) => p.branchIds.length > 0 || p.leaderBranchId);
      const brIds = withBr ? (withBr.branchIds.length > 0 ? withBr.branchIds : [withBr.leaderBranchId as string]) : [];
      push(positionDupes, {
        title: `Позиция № ${num}`,
        nodeIds: [], branchIds: brIds,
        focus: withBr && withBr.placed ? { x: withBr.x, y: withBr.y, z: withBr.z } : undefined,
        note: `${distinct.size} разных позиций: ${list.map((p) => `«${p.name || "без названия"}» (${p.accidentType.toLowerCase()})`).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`,
      });
    }
    // Выработки без позиции — не попали ни в одну позицию ПЛА.
    const covered = new Set<string>();
    for (const p of positions) {
      for (const id of p.branchIds) covered.add(id);
      if (p.leaderBranchId) covered.add(p.leaderBranchId);
      for (const l of p.extraLeaders ?? []) if (l.branchId) covered.add(l.branchId);
    }
    for (const b of branches) {
      if (isAux(b) || b.fromId === b.toId || covered.has(b.id)) continue;
      const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
      // Ветвь-выход на поверхность (атмосфера на обоих концах) — не выработка шахты.
      if (fn?.atmosphereLink && tn?.atmosphereLink) continue;
      push(branchNoPosition, { branch: b, note: `L ${fmtNum(b.length ?? 0, 0)} м — не входит ни в одну позицию ПЛА` });
    }
  }

  return {
    solved, measureMismatch, measureNoData, measureTotal,
    controlAlpha, alphaJump, areaJump, surfaceMulti, bulkheadNorm, bulkheadZero, bulkheadAllowed,
    bulkheadFailure, bulkheadThickness, positionsTotal: positions.length, positionDupes, branchNoPosition,
    truncated,
  };
}