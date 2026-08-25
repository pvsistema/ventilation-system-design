// ─────────────────────────────────────────────────────────────────────────────
// airPollution.ts — доля загрязнённого воздуха в каждой выработке.
//
// Раньше загрязнение было признаком «да/нет»: любая струя ниже по потоку от
// загрязняющей выработки считалась полностью грязной. На практике это неверно —
// 3 м³/с из-за перемычки не могут испортить ствол, куда вентилятор подаёт
// десятки м³/с. Здесь считается ДОЛЯ загрязнённого воздуха (0..1) по балансу
// расходов в узлах: сколько грязного втекает в узел, столько же распределяется
// по исходящим струям пропорционально их расходам.
//
// Модель — полное мгновенное смешение в узле. Расслоение дыма по сечению
// выработки не учитывается; для задач ПЛА этого достаточно.
// ─────────────────────────────────────────────────────────────────────────────

/** Минимум, что нужно от ветви для расчёта смешения. */
export interface PollutionBranchLite {
  id: string;
  fromId: string;
  toId: string;
  flow?: number;
  isDead?: boolean;
  pollutesAir?: boolean;
}

/** Порог загрязнения по умолчанию: струя считается грязной от 12 %. */
export const DEFAULT_POLLUTION_THRESHOLD = 0.12;

/** Расходы ниже этого значения (м³/с) считаем нулевыми — шум расчёта. */
const FLOW_EPS = 1e-6;

/** Сколько раз уточняем результат в схемах с кольцами (рециркуляция). */
const MAX_PASSES = 50;

/** Изменение доли меньше этого — считаем, что расчёт сошёлся. */
const CONVERGE_EPS = 1e-6;

/**
 * Доля загрязнённого воздуха в каждой выработке: 0 — чистый, 1 — полностью
 * загрязнённый.
 *
 * Загрязняющая выработка всегда отдаёт 1.0 на своём выходе. В остальных долю
 * даёт смешение входящих струй:
 *
 *   доля = (Σ грязного расхода на входе) / (Σ расхода на входе)
 *
 * Тупиковые выработки (расход нулевой) в переносе не участвуют, но сами
 * помечаются, если являются источником.
 */
export function computePollutionFractions(
  branches: PollutionBranchLite[],
): Map<string, number> {
  const frac = new Map<string, number>();
  for (const b of branches) frac.set(b.id, b.pollutesAir ? 1 : 0);

  // Нет источников — считать нечего.
  if (!branches.some(b => b.pollutesAir)) return frac;

  // Направление движения воздуха: расход со знаком минус означает, что воздух
  // идёт против записанного направления выработки.
  type Dir = { id: string; inNode: string; outNode: string; q: number; src: boolean };
  const dirs: Dir[] = [];
  for (const b of branches) {
    const q = Math.abs(b.flow ?? 0);
    if (b.isDead || q < FLOW_EPS) continue;
    const forward = (b.flow ?? 0) >= 0;
    dirs.push({
      id: b.id,
      inNode: forward ? b.fromId : b.toId,
      outNode: forward ? b.toId : b.fromId,
      q,
      src: !!b.pollutesAir,
    });
  }
  if (dirs.length === 0) return frac;

  // Входящие в узел струи — из них складывается смесь на выходе.
  const incoming = new Map<string, Dir[]>();
  for (const d of dirs) {
    let arr = incoming.get(d.outNode);
    if (!arr) { arr = []; incoming.set(d.outNode, arr); }
    arr.push(d);
  }

  // Порядок обхода: сначала струи, в которые воздух приходит «извне» (устья,
  // забои), затем вниз по течению. На кольцевых схемах порядок не даёт точного
  // ответа за один проход, поэтому ниже расчёт повторяется до сходимости.
  const order = topoOrder(dirs, incoming);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let maxDelta = 0;
    for (const d of order) {
      // Источник загрязняет струю целиком — что бы в него ни втекало.
      if (d.src) continue;

      let qIn = 0;
      let qDirty = 0;
      for (const up of incoming.get(d.inNode) ?? []) {
        if (up.id === d.id) continue;   // сама себя струя не питает
        qIn += up.q;
        qDirty += up.q * (frac.get(up.id) ?? 0);
      }

      // В узел ничего не втекает (устье, поверхность) — воздух свежий.
      const next = qIn > FLOW_EPS ? qDirty / qIn : 0;
      const prev = frac.get(d.id) ?? 0;
      const delta = Math.abs(next - prev);
      if (delta > maxDelta) maxDelta = delta;
      frac.set(d.id, next);
    }
    if (maxDelta < CONVERGE_EPS) break;
  }

  return frac;
}

/**
 * Порядок обхода струй сверху вниз по течению (алгоритм Кана). Струи внутри
 * колец в порядок не попадают — они дописываются в конец и уточняются
 * повторными проходами.
 */
function topoOrder(dirs: Dir[], incoming: Map<string, Dir[]>): Dir[] {
  type D = typeof dirs[number];
  const outgoing = new Map<string, D[]>();
  for (const d of dirs) {
    let arr = outgoing.get(d.inNode);
    if (!arr) { arr = []; outgoing.set(d.inNode, arr); }
    arr.push(d);
  }

  // Сколько струй должно быть посчитано раньше данной.
  const waitFor = new Map<string, number>();
  for (const d of dirs) {
    const ups = (incoming.get(d.inNode) ?? []).filter(u => u.id !== d.id);
    waitFor.set(d.id, ups.length);
  }

  const queue: D[] = dirs.filter(d => (waitFor.get(d.id) ?? 0) === 0);
  const seen = new Set<string>(queue.map(d => d.id));
  const order: D[] = [];

  for (let i = 0; i < queue.length; i++) {
    const d = queue[i];
    order.push(d);
    for (const next of outgoing.get(d.outNode) ?? []) {
      if (next.id === d.id || seen.has(next.id)) continue;
      const left = (waitFor.get(next.id) ?? 0) - 1;
      waitFor.set(next.id, left);
      if (left <= 0) { seen.add(next.id); queue.push(next); }
    }
  }

  // Оставшиеся — участники колец.
  for (const d of dirs) if (!seen.has(d.id)) order.push(d);
  return order;
}

type Dir = { id: string; inNode: string; outNode: string; q: number; src: boolean };

/**
 * Выработки, которые считаются загрязнёнными: доля загрязнения достигла порога.
 * Источники загрязнения входят всегда.
 */
export function computePollutedBranchIds(
  branches: PollutionBranchLite[],
  threshold: number = DEFAULT_POLLUTION_THRESHOLD,
): Set<string> {
  const frac = computePollutionFractions(branches);
  const out = new Set<string>();
  for (const b of branches) {
    if (b.pollutesAir) { out.add(b.id); continue; }
    if ((frac.get(b.id) ?? 0) >= threshold) out.add(b.id);
  }
  return out;
}
