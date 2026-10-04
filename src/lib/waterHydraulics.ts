// ─────────────────────────────────────────────────────────────────────────────
// Гидравлический расчёт водопроводной сети ППЗ
// Метод: глобальный градиентный (Ньютон по напорам узлов и расходам труб),
// см. waterSolver.ts. Здесь — общие формулы, типы результатов и утилиты.
// ─────────────────────────────────────────────────────────────────────────────

import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { solveWaterNetwork, nozzleResistance, MATERIAL_ROUGHNESS_MM, SMOOTH_ROUGHNESS_MM } from "@/lib/waterSolver";

export { MATERIAL_ROUGHNESS_MM, SMOOTH_ROUGHNESS_MM };

export interface WaterNodeResult {
  nodeId: string;
  staticP: number;    // МПа — статическое давление (давление в узле)
  dynamicP: number;   // МПа — динамическое давление (потери на кране)
  flow: number;       // м³/ч — расход через узел (потребители)
  resistance: number; // МН·с²/м⁸ — гидравлическое сопротивление узла
  drainTime: number;  // мин — время истечения (только для резервуаров)
  noWater?: boolean;  // вода до узла не доходит (давление < 0 или нет связи с резервуаром)
}

export interface WaterBranchResult {
  branchId: string;
  flow: number;           // м³/ч — суммарный расход в трубе
  velocity: number;       // м/с
  deltaP: number;         // МПа — потери давления
  resistance: number;     // МН·с²/м⁸
  reducerActive: boolean; // редуктор сработал (срезал давление)
  reducerInP: number;     // МПа — давление на входе клапана
  reducerOutP: number;    // МПа — давление на выходе клапана
  reducerDeltaP: number;  // МПа — сколько срезал клапан
  pumpActive?: boolean;   // насос повышает напор на этой ветви
  pumpHeadM?: number;     // м вод. ст. — напор насоса (суммарно)
  pumpDeltaP?: number;    // МПа — прибавка давления от насоса
  flowFromTo?: boolean;   // направление течения воды: true = fromId→toId, false = toId→fromId
  reducerOverCapacity?: boolean; // расход выше паспортной пропускной способности редуктора
  innerDiameter?: number; // мм — расчётный внутренний диаметр
  reynolds?: number;      // число Рейнольдса
  lambda?: number;        // коэффициент гидравлического трения
  regime?: "laminar" | "transition" | "turbulent" | "none"; // режим течения
}

// ─── Формулы ──────────────────────────────────────────────────────────────────

// Сопротивление трубы при квадратичном законе (МН·с²/м⁸) — оценка для
// справки; сам сетевой расчёт учитывает режим течения (waterSolver.ts).
export function calcPipeResistance(
  lengthM: number,
  diamMm: number,
  roughnessMm: number,
  localXi: number,
): number {
  if (diamMm <= 0 || lengthM <= 0) return 0;
  const d = diamMm / 1000;
  const A = Math.PI * d * d / 4;
  const lambda = 0.11 * Math.pow(roughnessMm / diamMm, 0.25);
  return (lambda * lengthM / d + localXi) / (A * A) * 1000 / 2 / 1e6;
}

// Скорость воды (м/с)
export function calcPipeVelocity(flowM3h: number, diamMm: number): number {
  if (diamMm <= 0) return 0;
  const d = diamMm / 1000;
  const A = Math.PI * d * d / 4;
  return (flowM3h / 3600) / A;
}

// Потери давления в трубе (МПа): ΔP = R × Q|Q|
export function calcPipeDeltaP(flowM3h: number, resistanceMNs2m8: number): number {
  const flowM3s = flowM3h / 3600;
  return resistanceMNs2m8 * flowM3s * Math.abs(flowM3s);
}

// Сопротивление выходного отверстия крана (МН·с²/м⁸)
export const calcNozzleResistance = nozzleResistance;

// Расход через потребитель: Q = √(ΔP / R) [м³/с] → м³/ч
export function calcConsumerFlow(pressureMPa: number, resistanceMNs2m8: number): number {
  if (resistanceMNs2m8 <= 0 || pressureMPa <= 0) return 0;
  const pressurePa = pressureMPa * 1e6;
  const R = resistanceMNs2m8 * 1e6;
  return Math.sqrt(pressurePa / R) * 3600;
}

// Время истечения резервуара (мин)
export function calcDrainTime(capacityM3: number, flowM3h: number): number {
  if (flowM3h <= 0) return 0;
  return (capacityM3 / flowM3h) * 60;
}

// ─── Насосные станции на водопроводе ─────────────────────────────────────────
/**
 * Минимальные сведения о символе насоса со схемы.
 * Насос хранится не в ветви, а как символ (typeId="pump"), привязанный к ней.
 */
export interface PumpSymbolLite {
  typeId: string;
  // null — символ не привязан к ветви (свободно стоит на схеме). Раньше здесь
  // допускалась только строка, и реальный тип символа сюда не подходил.
  branchId?: string | null;
  pumpHead?: number;      // м вод. ст. — номинальный напор одного насоса
  pumpParallel?: number;  // число параллельно работающих насосов
  airDirection?: string;  // "reverse" = качает против направления ветви
}

/**
 * «Впечатывает» параметры насосных станций со схемы в поля ветвей, чтобы
 * гидравлический расчёт учёл создаваемый ими напор.
 *
 * ВАЖНО: любой расчёт водопровода (гидравлика, проверка ППЗ, акт) обязан
 * прогонять ветви через эту функцию — иначе насос на схеме есть, а давление
 * в расчёте не поднимается.
 */
export function withWaterPumps<T extends TopoBranch>(
  branches: T[],
  symbols: PumpSymbolLite[],
): T[] {
  const pumpByBranch = new Map<string, PumpSymbolLite>();
  for (const s of symbols) {
    if (s.typeId === "pump" && s.branchId) pumpByBranch.set(s.branchId, s);
  }
  if (pumpByBranch.size === 0) return branches;
  return branches.map(b => {
    const pump = pumpByBranch.get(b.id);
    if (!pump) return b;
    const head = (pump.pumpHead ?? 0) * (pump.pumpParallel ?? 1);
    return {
      ...b,
      wpHasPump: head > 0,
      wpPumpHead: head,
      wpPumpReverse: pump.airDirection === "reverse",
    };
  });
}

// ─── Отпечаток исходных данных водопровода ───────────────────────────────────
/**
 * Компактная строка-«отпечаток» всех данных, от которых ЗАВИСИТ гидравлический
 * расчёт водопровода.
 *
 * Зачем: расчёт гидравлики выполняется на сервере, и раньше он перезапускался
 * при ЛЮБОМ изменении схемы — сдвинули узел мышкой, переименовали выработку,
 * поменяли сечение под воздух. Гидравлике всё это безразлично, но запрос
 * улетал, и при активном редактировании набегали десятки лишних вызовов
 * в минуту.
 *
 * Теперь расчёт сравнивает отпечаток с предыдущим и уходит на сервер, только
 * если реально изменилось что-то водопроводное: труба, вентиль, редуктор,
 * насос, резервуар, кран или высотная отметка узла (влияет на столб воды).
 *
 * ВАЖНО: набор полей обязан совпадать с тем, что читает backend/water-hydraulics.
 * Добавили новый параметр трубы или узла в расчёт — добавьте его и сюда,
 * иначе результат перестанет обновляться при его изменении.
 */
export function waterInputsFingerprint(
  nodes: TopoNode[],
  branches: TopoBranch[],
  symbols: PumpSymbolLite[],
): string {
  const parts: string[] = [];

  // Ветви с трубопроводом: геометрия трубы, арматура, редуктор.
  // Длина трубы по умолчанию берётся от длины выработки, поэтому length тоже учитываем.
  for (const b of branches) {
    if (!b.hasWaterPipe) continue;
    const x = b as TopoBranch & Record<string, unknown>;
    parts.push([
      "b", b.id, b.fromId, b.toId,
      x.wpDiameter, x.wpDiameterKind, x.wpWallThickness, x.wpMaterial, x.wpLength, x.wpLengthManual, b.length,
      x.wpRoughness, x.wpRoughnessMode, x.wpLocalXi, x.wpManualR,
      x.wpHasGate, x.wpGateClosed,
      x.wpHasReducer, x.wpReducerOutPressure, x.wpReducerMaxFlow,
      x.wpHasPump, x.wpPumpHead, x.wpPumpReverse,
    ].join(","));
  }

  // Узлы: резервуары, потребители (краны) и высотные отметки.
  // z нужен всем узлам водопровода — разность высот даёт напор столба воды.
  for (const n of nodes) {
    const x = n as TopoNode & Record<string, unknown>;
    const ft = (x.fireNodeType as string) ?? "none";
    if (ft === "none") continue;
    parts.push([
      "n", n.id, ft, n.z, n.surveyZ,
      x.fireInitPressure, x.fireCapacity,
      x.fireHydrantOpen, x.fireHydrantDiameter,
      x.fireResistanceMode, x.fireManualR,
    ].join(","));
  }

  // Высотные отметки узлов, через которые проходит труба (без fireNodeType).
  const pipeNodeIds = new Set<string>();
  for (const b of branches) {
    if (!b.hasWaterPipe) continue;
    pipeNodeIds.add(b.fromId); pipeNodeIds.add(b.toId);
  }
  for (const n of nodes) {
    if (!pipeNodeIds.has(n.id)) continue;
    parts.push(["z", n.id, n.z, n.surveyZ].join(","));
  }

  // Насосные станции со схемы: напор, число насосов, направление качания.
  for (const s of symbols) {
    if (s.typeId !== "pump" || !s.branchId) continue;
    parts.push(["p", s.branchId, s.pumpHead, s.pumpParallel, s.airDirection].join(","));
  }

  return parts.join(";");
}

/**
 * Открытые потребители, гидравлически СВЯЗАННЫЕ с указанным резервуаром.
 *
 * Обход идёт только по трубам с открытым запорным вентилем, поэтому краны из
 * другой ветки водопровода и краны, отрезанные закрытым вентилем, в список не
 * попадают. Используется панелью резервуара, чтобы «Открытые краны» и время
 * работы совпадали с гидравлическим расчётом.
 */
export function connectedOpenConsumers(
  reservoirId: string,
  nodes: TopoNode[],
  branches: TopoBranch[],
): TopoNode[] {
  const open = branches.filter(b => b.hasWaterPipe && !(b.wpHasGate && b.wpGateClosed));
  const adj = new Map<string, string[]>();
  for (const b of open) {
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    adj.get(b.fromId)!.push(b.toId);
    adj.get(b.toId)!.push(b.fromId);
  }
  const seen = new Set<string>([reservoirId]);
  const stack = [reservoirId];
  while (stack.length > 0) {
    const nid = stack.pop()!;
    for (const nb of adj.get(nid) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      stack.push(nb);
    }
  }
  return nodes.filter(n =>
    (n.fireNodeType ?? "none") === "consumer" &&
    (n.fireHydrantOpen ?? false) &&
    seen.has(n.id),
  );
}

// ─── Основная функция расчёта ──────────────────────────────────────────────────
/**
 * Гидравлический расчёт сети в браузере (проверка ППЗ). Решатель — общий
 * с сервером (waterSolver.ts ⇄ backend/water-hydraulics/solver.py).
 */
export function calcWaterNetwork(
  nodes: TopoNode[],
  branches: TopoBranch[],
): { nodeResults: Map<string, WaterNodeResult>; branchResults: Map<string, WaterBranchResult> } {
  const { nodeResults, branchResults } = solveWaterNetwork(nodes, branches);
  return { nodeResults, branchResults };
}
