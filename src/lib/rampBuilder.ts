// ─────────────────────────────────────────────────────────────────────────────
// rampBuilder.ts — построение наклонного съезда по нарисованной трассе.
//
// ЗАДАЧА. Человек обводит съезд по маркшейдерской подложке (план, вид сверху),
// то есть задаёт X и Y. Отметки Z при этом либо нулевые, либо взяты с активного
// горизонта. Остаётся раздать узлам высоты так, чтобы от начальной отметки до
// конечной уклон нигде не превысил предел для подземного транспорта.
//
// ГЛАВНОЕ ПРАВИЛО: уклон считается по ГОРИЗОНТАЛЬНОЙ (плановой) длине, а не по
// длине выработки. Плановая длина — это то, что видно на плане и что реально
// ограничивает трассу; длина по выработке всегда больше на 1/cos(угла) и для
// проверки уклона не годится.
//
//   Lпл = Σ √(Δx² + Δy²)      — плановая длина трассы
//   i   = |Δz| / Lпл           — уклон (доли; ‰ = i · 1000)
//   θ   = atan(i)              — угол наклона, градусы
//
// Контроль для Δz = 100 м:
//   12° → i = 0.2126 (≈213‰) → нужно ≥ 470 м в плане;
//   15° → i = 0.2679 (≈268‰) → нужно ≥ 373 м в плане.
//
// Координаты берём МАРКШЕЙДЕРСКИЕ (surveyXYZ): узел мог быть сдвинут по схеме
// ради читаемости, и считать уклон по картинке — значит получить неверный
// проект. Записываем тоже в маркшейдерские (surveyZ) и в отображаемые (z).
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch, surveyXYZ } from "./topology";

/** Рабочий уклон подземного транспорта, ° — на нём машина ходит постоянно. */
export const RAMP_WORK_ANGLE = 12;
/** Предельный уклон, ° — допускается лишь на коротких участках. */
export const RAMP_LIMIT_ANGLE = 15;

export type RampMode = "even" | "maxSlope";

export interface RampOptions {
  /** Отметка первого узла цепочки, м. */
  z0: number;
  /** Отметка последнего узла цепочки, м. */
  z1: number;
  /** Рабочий угол, ° (по умолчанию 12). Выше — предупреждение. */
  workAngle?: number;
  /** Предельный угол, ° (по умолчанию 15). Выше — построить нельзя. */
  limitAngle?: number;
  /**
   * even     — весь съезд одним уклоном (θ = atan(Δz / Lпл));
   * maxSlope — идём под рабочим углом до нужной отметки, остаток горизонтальный.
   *            Нужен, когда трасса нарисована с запасом по длине.
   */
  mode?: RampMode;
  /** Через сколько метров вставлять горизонтальную площадку (0 = не вставлять). */
  platformEvery?: number;
  /** Длина площадки, м. */
  platformLen?: number;
  /**
   * Не трогать узлы, привязанные к горизонту (horizonId). Такие узлы — это
   * сопряжения со штреками: их отметка задана горизонтом, и менять её нельзя.
   * Они становятся опорными, а трасса раскладывается кусками между ними.
   */
  lockHorizonNodes?: boolean;
}

export interface RampSegment {
  branchId: string;
  /** Угол наклона сегмента, ° (по модулю). */
  angle: number;
  /** Плановая длина сегмента, м. */
  planLength: number;
  /** Длина по выработке (3D), м. */
  length3d: number;
  /** Превышает рабочий угол, но в пределах предельного. */
  warn: boolean;
  /** Превышает предельный угол — так строить нельзя. */
  over: boolean;
}

export interface RampResult {
  /** Новые отметки узлов: id → z. Пусто, если построить нельзя. */
  nodes: { id: string; z: number }[];
  segments: RampSegment[];
  /** Плановая длина всей трассы, м. */
  planLength: number;
  /** Длина по выработке (3D) после раскладки, м. */
  length3d: number;
  /** Наибольший угол по трассе, °. */
  maxAngle: number;
  /** Средний уклон, ‰. */
  slopePermille: number;
  /** Перепад отметок, м (|z1 − z0|). */
  drop: number;
  /** Минимальная плановая длина, при которой уклон уложится в предел, м. */
  requiredPlanLength: number;
  /** Какая отметка достижима на этой трассе при рабочем угле, м. */
  reachableZ: number;
  status: "ok" | "warn" | "fail";
  /** Готовое объяснение для человека — его же показываем в диалоге. */
  message: string;
}

/** Узел цепочки с накопленной плановой длиной от начала. */
interface ChainPoint {
  id: string;
  /** Накопленная плановая длина от первого узла, м. */
  s: number;
  /** Отметка закреплена (горизонт) — менять нельзя. */
  locked: boolean;
  /** Текущая отметка (нужна для закреплённых). */
  z: number;
}

/**
 * Упорядоченная цепочка узлов между двумя концами.
 *
 * Съезд — это цепочка ветвей, но пользователь выделяет их в произвольном
 * порядке, поэтому порядок восстанавливаем по связям, а не по выделению.
 * Возвращает null, если ветви не образуют непрерывную незамкнутую цепочку
 * (развилка, разрыв, кольцо) — молча строить в таком случае нельзя.
 */
export function orderChain(
  branches: TopoBranch[],
): { nodeIds: string[]; branchIds: string[] } | null {
  if (branches.length === 0) return null;

  // Степень каждого узла: концы цепочки имеют степень 1.
  const deg = new Map<string, number>();
  const adj = new Map<string, { nodeId: string; branchId: string }[]>();
  for (const b of branches) {
    deg.set(b.fromId, (deg.get(b.fromId) ?? 0) + 1);
    deg.set(b.toId, (deg.get(b.toId) ?? 0) + 1);
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    adj.get(b.fromId)!.push({ nodeId: b.toId, branchId: b.id });
    adj.get(b.toId)!.push({ nodeId: b.fromId, branchId: b.id });
  }

  // Развилка — цепочки нет.
  for (const d of deg.values()) if (d > 2) return null;

  const ends = [...deg.entries()].filter(([, d]) => d === 1).map(([id]) => id);
  if (ends.length !== 2) return null;   // кольцо или разрыв

  // Идём от одного конца к другому.
  const startId = ends[0];
  const nodeIds: string[] = [startId];
  const branchIds: string[] = [];
  const usedBranches = new Set<string>();
  let current = startId;

  while (branchIds.length < branches.length) {
    const next = (adj.get(current) ?? []).find((e) => !usedBranches.has(e.branchId));
    if (!next) break;
    usedBranches.add(next.branchId);
    branchIds.push(next.branchId);
    nodeIds.push(next.nodeId);
    current = next.nodeId;
  }

  // Прошли не все ветви — значит выделение распадается на куски.
  if (branchIds.length !== branches.length) return null;
  return { nodeIds, branchIds };
}

/** Плановое (горизонтальное) расстояние между узлами, м. */
function planDist(a: TopoNode, b: TopoNode): number {
  const p = surveyXYZ(a);
  const q = surveyXYZ(b);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

/** Угол наклона по плановой длине и перепаду, °. */
function angleOf(planLen: number, dz: number): number {
  if (planLen < 0.001) return Math.abs(dz) > 0.001 ? 90 : 0;
  return Math.abs(Math.atan(dz / planLen) * (180 / Math.PI));
}

/**
 * Раскладка отметок между двумя опорными точками цепочки.
 *
 * Интерполируем по НАКОПЛЕННОЙ ПЛАНОВОЙ ДЛИНЕ, а не по номеру узла: узлы стоят
 * неравномерно (на повороте чаще, на прямой реже), и раскладка «по счёту» дала
 * бы на коротких сегментах отвесные скачки, а на длинных — почти горизонталь.
 */
function interpolateSpan(points: ChainPoint[], from: number, to: number): void {
  const a = points[from];
  const b = points[to];
  const span = b.s - a.s;
  if (span < 0.001) {
    for (let i = from + 1; i < to; i++) points[i].z = a.z;
    return;
  }
  for (let i = from + 1; i < to; i++) {
    const t = (points[i].s - a.s) / span;
    points[i].z = a.z + (b.z - a.z) * t;
  }
}

/**
 * Раскладка «максимальный уклон»: идём под заданным углом до конечной отметки,
 * дальше — горизонтально. Нужна, когда трасса длиннее необходимого: съезд
 * получается компактным, а хвост остаётся площадкой.
 */
function layoutMaxSlope(points: ChainPoint[], z0: number, z1: number, angleDeg: number): void {
  const dir = Math.sign(z1 - z0) || 1;
  const i = Math.tan((angleDeg * Math.PI) / 180);
  const need = Math.abs(z1 - z0);
  for (const p of points) {
    const gained = Math.min(need, p.s * i);
    p.z = z0 + dir * gained;
  }
}

/**
 * Вставка горизонтальных площадок.
 *
 * Площадки съедают плановую длину, поэтому наклонные участки становятся круче:
 * i = Δz / (Lпл − ΣLплощадок). Это обязательно проверяется на предельный угол
 * повторно — иначе площадки «для безопасности» тайно выводят съезд за предел.
 */
function layoutWithPlatforms(
  points: ChainPoint[],
  z0: number,
  z1: number,
  planLength: number,
  every: number,
  platLen: number,
): void {
  const dir = Math.sign(z1 - z0) || 1;
  const drop = Math.abs(z1 - z0);

  // Сколько площадок помещается и сколько длины они займут.
  const count = Math.max(0, Math.floor(planLength / Math.max(1, every)) - 0);
  const platTotal = Math.min(count * platLen, planLength * 0.9);
  const slopeLen = Math.max(1, planLength - platTotal);
  const i = drop / slopeLen;

  for (const p of points) {
    // Сколько площадок осталось позади к этой точке.
    const passed = Math.min(count, Math.floor(p.s / Math.max(1, every)));
    const onSlope = Math.max(0, p.s - passed * platLen);
    p.z = z0 + dir * Math.min(drop, onSlope * i);
  }
}

/**
 * Построение наклонного съезда: раздаёт отметки узлам нарисованной трассы.
 *
 * Ничего не меняет — только считает. Применение результата остаётся за вызовом,
 * чтобы можно было показать предпросчёт до того, как схема изменится.
 */
export function buildRamp(
  nodes: TopoNode[],
  branches: TopoBranch[],
  chainBranchIds: string[],
  opts: RampOptions,
): RampResult {
  const workAngle = opts.workAngle ?? RAMP_WORK_ANGLE;
  const limitAngle = opts.limitAngle ?? RAMP_LIMIT_ANGLE;
  const mode: RampMode = opts.mode ?? "even";

  const empty = (message: string): RampResult => ({
    nodes: [], segments: [], planLength: 0, length3d: 0, maxAngle: 0,
    slopePermille: 0, drop: Math.abs(opts.z1 - opts.z0),
    requiredPlanLength: 0, reachableZ: opts.z0, status: "fail", message,
  });

  const brById = new Map(branches.map((b) => [b.id, b]));
  const chain = chainBranchIds
    .map((id) => brById.get(id))
    .filter(Boolean) as TopoBranch[];
  if (chain.length === 0) return empty("Не выбрано ни одной выработки.");

  const ordered = orderChain(chain);
  if (!ordered) {
    return empty(
      "Выбранные выработки не образуют одну непрерывную трассу. "
      + "Съезд строится по цепочке от начала до конца — без развилок, разрывов и колец.",
    );
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const chainNodes = ordered.nodeIds.map((id) => nodeById.get(id));
  if (chainNodes.some((n) => !n)) return empty("Часть узлов трассы не найдена.");
  const ns = chainNodes as TopoNode[];

  // Узлы, где к трассе примыкает выработка, привязанная к горизонту.
  //
  // Горизонт — свойство ВЫРАБОТКИ, а не узла, поэтому сопряжение ищем по
  // соседним ветвям вне цепочки. Такой узел — это стык со штреком: его отметка
  // задана горизонтом, и двигать её нельзя, иначе примыкающая выработка
  // повиснет в воздухе. Такие узлы становятся опорными, а трасса
  // раскладывается кусками между ними.
  const inChain = new Set(ordered.branchIds);
  const anchored = new Set<string>();
  if (opts.lockHorizonNodes) {
    for (const b of branches) {
      if (inChain.has(b.id) || !b.horizonId) continue;
      anchored.add(b.fromId);
      anchored.add(b.toId);
    }
  }

  // Накопленная плановая длина по узлам.
  const points: ChainPoint[] = [];
  let acc = 0;
  for (let k = 0; k < ns.length; k++) {
    if (k > 0) acc += planDist(ns[k - 1], ns[k]);
    // Концы трассы не закрепляем: их отметки человек задаёт сам в диалоге.
    const locked = anchored.has(ns[k].id) && k > 0 && k < ns.length - 1;
    points.push({ id: ns[k].id, s: acc, locked, z: surveyXYZ(ns[k]).z });
  }
  const planLength = acc;
  const drop = Math.abs(opts.z1 - opts.z0);

  if (planLength < 0.5) {
    return empty("Трасса имеет нулевую длину в плане — раздать отметки невозможно.");
  }

  // Минимально нужная длина и достижимая отметка — для понятных подсказок.
  const requiredPlanLength = drop / Math.tan((limitAngle * Math.PI) / 180);
  const reachableZ = opts.z0
    + Math.sign(opts.z1 - opts.z0) * planLength * Math.tan((workAngle * Math.PI) / 180);

  // ── Раскладка отметок ──────────────────────────────────────────────────
  points[0].z = opts.z0;
  points[points.length - 1].z = opts.z1;

  if (opts.platformEvery && opts.platformEvery > 0 && opts.platformLen && opts.platformLen > 0) {
    layoutWithPlatforms(points, opts.z0, opts.z1, planLength, opts.platformEvery, opts.platformLen);
    points[0].z = opts.z0;
    points[points.length - 1].z = opts.z1;
  } else if (mode === "maxSlope") {
    layoutMaxSlope(points, opts.z0, opts.z1, workAngle);
    points[0].z = opts.z0;
  } else {
    // Равномерный уклон с учётом закреплённых узлов: раскладываем кусками
    // между опорными точками, каждый кусок — своим уклоном.
    const anchors: number[] = [0];
    for (let k = 1; k < points.length - 1; k++) if (points[k].locked) anchors.push(k);
    anchors.push(points.length - 1);
    for (let a = 0; a < anchors.length - 1; a++) {
      interpolateSpan(points, anchors[a], anchors[a + 1]);
    }
  }

  // ── Проверка уклонов по сегментам ──────────────────────────────────────
  const segments: RampSegment[] = [];
  let maxAngle = 0;
  let length3d = 0;
  for (let k = 0; k < ordered.branchIds.length; k++) {
    const a = points[k];
    const b = points[k + 1];
    const pl = b.s - a.s;
    const dz = b.z - a.z;
    const ang = angleOf(pl, dz);
    const len3 = Math.hypot(pl, dz);
    length3d += len3;
    if (ang > maxAngle) maxAngle = ang;
    segments.push({
      branchId: ordered.branchIds[k],
      angle: Math.round(ang * 10) / 10,
      planLength: Math.round(pl * 10) / 10,
      length3d: Math.round(len3 * 10) / 10,
      warn: ang > workAngle + 0.05 && ang <= limitAngle + 0.05,
      over: ang > limitAngle + 0.05,
    });
  }

  maxAngle = Math.round(maxAngle * 10) / 10;
  // Промилле считаем от НАИБОЛЬШЕГО угла, а не от среднего по трассе.
  // Средний уклон (drop/planLength) вводит в заблуждение там, где часть трассы
  // горизонтальна: в режиме «максимальный уклон» и при вставке площадок
  // наклонные участки круче среднего, а нормируется именно они.
  const slopePermille = Math.round(Math.tan((maxAngle * Math.PI) / 180) * 1000);

  // ── Вердикт ────────────────────────────────────────────────────────────
  let status: RampResult["status"] = "ok";
  let message = "";
  const overCount = segments.filter((s) => s.over).length;
  const warnCount = segments.filter((s) => s.warn).length;

  if (overCount > 0) {
    status = "fail";
    const shortfall = Math.max(0, requiredPlanLength - planLength);
    message = shortfall > 1
      ? `Уклон ${maxAngle}° превышает предел ${limitAngle}°. `
        + `Трассы не хватает: сейчас ${Math.round(planLength)} м в плане, `
        + `нужно не менее ${Math.round(requiredPlanLength)} м — добавьте ещё `
        + `${Math.round(shortfall)} м. На этой длине достижима отметка `
        + `${Math.round(reachableZ)} м при ${workAngle}°.`
      : `Уклон ${maxAngle}° превышает предел ${limitAngle}° на ${overCount} `
        + `${overCount === 1 ? "участке" : "участках"}. Виноваты короткие сегменты: `
        + `узлы стоят слишком часто при большом перепаде. Сдвиньте узлы или снимите `
        + `закрепление отметок горизонта.`;
  } else if (warnCount > 0) {
    status = "warn";
    message = `Уклон ${maxAngle}° — выше рабочего ${workAngle}°, но в пределах ${limitAngle}°. `
      + `Так допускается только на коротких участках: ${warnCount} `
      + `${warnCount === 1 ? "участок" : "участков"} из ${segments.length}. `
      + `Проверьте, что это согласуется с принятым транспортом.`;
  } else {
    status = "ok";
    message = `Съезд построен: уклон ${maxAngle}° (${slopePermille}‰), `
      + `перепад ${Math.round(drop)} м на ${Math.round(planLength)} м в плане. `
      + `Длина по выработке ${Math.round(length3d)} м.`;
  }

  return {
    nodes: points.map((p) => ({ id: p.id, z: Math.round(p.z * 100) / 100 })),
    segments,
    planLength: Math.round(planLength * 10) / 10,
    length3d: Math.round(length3d * 10) / 10,
    maxAngle,
    slopePermille,
    drop: Math.round(drop * 10) / 10,
    requiredPlanLength: Math.round(requiredPlanLength),
    reachableZ: Math.round(reachableZ * 10) / 10,
    status,
    message,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Спиральный съезд
//
// Когда прямой трассы не хватает по длине, съезд закручивают в спираль: на
// небольшой площади набирается любой перепад. Число витков определяется
// перепадом и длиной витка:
//     длина витка (в плане) = 2πR
//     набор высоты за виток = 2πR · tan θ
//     число витков n        = Δz / (2πR · tan θ)
// ─────────────────────────────────────────────────────────────────────────────

export interface SpiralOptions {
  /** Центр спирали, м (маркшейдерские координаты). */
  cx: number;
  cy: number;
  /** Радиус по оси выработки, м. */
  radius: number;
  z0: number;
  z1: number;
  /** Угол наклона, ° (обычно рабочий — 12). */
  angle?: number;
  /** Шаг по дуге между узлами, ° (меньше — глаже спираль, но больше узлов). */
  stepDeg?: number;
  /** Направление: по часовой стрелке или против. */
  clockwise?: boolean;
  /** Начальный азимут, ° — чтобы стыковать спираль с существующей выработкой. */
  startAngleDeg?: number;
}

export interface SpiralPoint { x: number; y: number; z: number }

export interface SpiralResult {
  points: SpiralPoint[];
  /** Число витков (может быть дробным). */
  turns: number;
  /** Плановая длина спирали, м. */
  planLength: number;
  /** Длина по выработке, м. */
  length3d: number;
  angle: number;
  slopePermille: number;
  message: string;
}

/**
 * Точки спирального съезда. Готовую геометрию остаётся превратить в узлы и
 * ветви — расчёт намеренно отделён от изменения схемы.
 */
export function buildSpiral(opts: SpiralOptions): SpiralResult {
  const angle = opts.angle ?? RAMP_WORK_ANGLE;
  const stepDeg = Math.max(2, Math.min(45, opts.stepDeg ?? 15));
  const R = Math.max(1, opts.radius);
  const drop = Math.abs(opts.z1 - opts.z0);
  const dir = Math.sign(opts.z1 - opts.z0) || -1;
  const cw = opts.clockwise !== false;
  const start = ((opts.startAngleDeg ?? 0) * Math.PI) / 180;

  const i = Math.tan((angle * Math.PI) / 180);
  const perTurn = 2 * Math.PI * R * i;              // набор высоты за виток, м
  const turns = perTurn > 0.001 ? drop / perTurn : 0;
  const totalRad = turns * 2 * Math.PI;
  const stepRad = (stepDeg * Math.PI) / 180;
  const steps = Math.max(1, Math.ceil(totalRad / stepRad));

  const points: SpiralPoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;                             // 0..1 по всей спирали
    const a = start + (cw ? 1 : -1) * totalRad * t;
    points.push({
      x: Math.round((opts.cx + R * Math.cos(a)) * 100) / 100,
      y: Math.round((opts.cy + R * Math.sin(a)) * 100) / 100,
      z: Math.round((opts.z0 + dir * drop * t) * 100) / 100,
    });
  }

  const planLength = totalRad * R;
  const length3d = planLength / Math.cos((angle * Math.PI) / 180);

  return {
    points,
    turns: Math.round(turns * 100) / 100,
    planLength: Math.round(planLength),
    length3d: Math.round(length3d),
    angle,
    slopePermille: Math.round(i * 1000),
    message:
      `Спираль: ${(Math.round(turns * 100) / 100).toFixed(2)} витка радиусом ${R} м, `
      + `перепад ${Math.round(drop)} м при уклоне ${angle}° (${Math.round(i * 1000)}‰). `
      + `Длина по выработке ${Math.round(length3d)} м, узлов ${points.length}.`,
  };
}