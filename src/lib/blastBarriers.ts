// ─────────────────────────────────────────────────────────────────────────────
// blastBarriers.ts — перемычки на пути ударной волны.
//
// ЧТО БЫЛО НЕ ТАК. Волна шла по сети выработок так, будто перемычек нет: они
// проверялись на разрушение уже ПОСЛЕ расчёта и на распространение никак не
// влияли. За устоявшей перемычкой давление оставалось прежним, за разрушенной —
// тоже. Отсюда завышенные зоны поражения и лишние разрушения цепочкой.
//
// КАК ТЕПЕРЬ. Перемычка учитывается прямо на пути волны:
//
//   1. На перемычку действует давление ОТРАЖЕНИЯ (стоит поперёк хода волны):
//        ΔP_отр = 2·ΔP + 6·ΔP² / (ΔP + 7·P₀)
//   2. ΔP_отр < P_разр — перемычка устояла, волна за неё не проходит.
//   3. ΔP_отр ≥ P_разр — перемычка разрушена, часть энергии ушла на разрушение,
//      дальше идёт ослабленная волна:
//        ΔP_за = ΔP · (1 − P_разр / ΔP_отр)
//
// Формула п. 3 — инженерная оценка по балансу энергии, в РБ №343 её нет. Она
// ведёт себя правильно на краях: перемычка едва не устояла — за ней почти
// ничего; перемычка много слабее волны — волна проходит почти целиком.
//
// Перемычки без заданного давления разрушения волну НЕ задерживают: прочность
// неизвестна, и считать их непреодолимыми нельзя — зоны за ними исчезли бы.
// Давление на них при этом записывается, чтобы подобрать толщину.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { reflectedPressure } from "@/lib/blastBulkhead";

/** Перемычка на ветви. */
export interface BlastBarrier {
  /** Уникальный ключ: id значка либо «ветвь:bulkhead» для перемычки без значка. */
  key: string;
  branchId: string;
  /** Положение вдоль ветви: 0 — узел fromId, 1 — узел toId. */
  t: number;
  /** Давление разрушения, МПа. 0 — не задано, волну не задерживает. */
  failure_MPa: number;
}

/** Что произошло с перемычкой при подходе волны. */
export interface BarrierHit {
  /** Давление набегающей волны, кПа. */
  incident_kPa: number;
  /** Давление отражения на перемычке, кПа. */
  reflected_kPa: number;
  destroyed: boolean;
  /** Доля давления, прошедшая за перемычку, 0…1. */
  transmit: number;
}

/**
 * Прохождение волны через одну перемычку.
 */
export function barrierTransmission(incident_kPa: number, failure_MPa: number): BarrierHit {
  const reflected_kPa = reflectedPressure(incident_kPa);
  if (!(incident_kPa > 0)) {
    return { incident_kPa: 0, reflected_kPa: 0, destroyed: false, transmit: 0 };
  }
  // Прочность не задана — перемычка на волну не влияет (см. шапку файла).
  if (!(failure_MPa > 0)) {
    return { incident_kPa, reflected_kPa, destroyed: false, transmit: 1 };
  }
  const fp_kPa = failure_MPa * 1000;
  if (reflected_kPa < fp_kPa) {
    // Устояла: волна отражается, за перемычку не проходит.
    return { incident_kPa, reflected_kPa, destroyed: false, transmit: 0 };
  }
  // Разрушена: энергия частично ушла на разрушение.
  const transmit = Math.max(0, Math.min(1, 1 - fp_kPa / reflected_kPa));
  return { incident_kPa, reflected_kPa, destroyed: true, transmit };
}

/**
 * Перемычки по ветвям, отсортированные по положению вдоль ветви.
 *
 * Источник — значки перемычек на схеме (у них есть положение и своя
 * прочность). Если у ветви отмечена перемычка, а значка нет (старые и
 * импортированные схемы), она считается стоящей посередине ветви.
 */
export function collectBarriers(
  branches: TopoBranch[],
  symbols: SchemaSymbol[],
  bulkheadSymbolIds: Set<string>,
): Map<string, BlastBarrier[]> {
  const byBranch = new Map<string, BlastBarrier[]>();
  const branchById = new Map(branches.map(b => [b.id, b]));
  const add = (bar: BlastBarrier) => {
    const arr = byBranch.get(bar.branchId);
    if (arr) arr.push(bar); else byBranch.set(bar.branchId, [bar]);
  };

  for (const s of symbols) {
    if (!bulkheadSymbolIds.has(s.typeId) || !s.branchId) continue;
    const br = branchById.get(s.branchId);
    if (!br) continue;
    const fp = s.bkFailurePressure && s.bkFailurePressure > 0
      ? s.bkFailurePressure
      : (br.bulkheadFailurePressure ?? 0);
    add({ key: s.id, branchId: br.id, t: clamp01(s.t ?? 0.5), failure_MPa: fp || 0 });
  }

  for (const br of branches) {
    if (!br.hasBulkhead || byBranch.has(br.id)) continue;
    add({ key: `${br.id}:bulkhead`, branchId: br.id, t: 0.5, failure_MPa: br.bulkheadFailurePressure ?? 0 });
  }

  for (const arr of byBranch.values()) arr.sort((a, b) => a.t - b.t);
  return byBranch;
}

/** Давление в точке по состоянию волны, кПа. */
export type PressureOf = (d: number, att: number, srcId: string) => number;

/**
 * Проводит волну вдоль ветви от точки tFrom к точке tTo через стоящие между
 * ними перемычки. Возвращает множитель ослабления за счёт перемычек (0…1).
 *
 * attAt(dist) — ослабление БЕЗ перемычек на расстоянии dist от tFrom (трение,
 * сопряжения); d0 — путь волны до точки tFrom. Давление на каждой перемычке
 * берётся с учётом всех перемычек, пройденных раньше неё: вторая по ходу
 * получает то, что осталось после первой.
 */
export function crossBarriers(opts: {
  list: BlastBarrier[] | undefined;
  tFrom: number;
  tTo: number;
  len: number;
  d0: number;
  attAt: (dist: number) => number;
  srcId: string;
  pressureOf: PressureOf;
  onHit?: (bar: BlastBarrier, hit: BarrierHit) => void;
  /**
   * Готовое решение по перемычке (из полного расчёта). Если задано — давление
   * не пересчитывается: схема обязана показывать то же, что решил расчёт.
   */
  decided?: (bar: BlastBarrier) => BarrierHit | undefined;
}): number {
  const { list, tFrom, tTo, len, d0, attAt, srcId, pressureOf, onHit, decided } = opts;
  if (!list || list.length === 0 || tFrom === tTo) return 1;
  const forward = tTo > tFrom;
  const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
  const passed = list.filter(b => b.t > lo && b.t < hi);
  if (passed.length === 0) return 1;
  if (!forward) passed.reverse();

  let factor = 1;
  for (const bar of passed) {
    const fixed = decided?.(bar);
    const dist = Math.abs(bar.t - tFrom) * len;
    const hit = fixed ?? barrierTransmission(pressureOf(d0 + dist, attAt(dist) * factor, srcId), bar.failure_MPa);
    onHit?.(bar, hit);
    factor *= hit.transmit;
    if (factor <= 0) return 0;
  }
  return factor;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}