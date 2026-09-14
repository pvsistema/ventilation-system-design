// ─────────────────────────────────────────────────────────────────────────────
// fromNetwork.ts — требуемые Q и H для подбора, взятые из расчёта сети.
//
// ЗАЧЕМ. Раньше окно подбора получало требуемые подачу и напор параметрами,
// которые задавались вручную (см. FanSelector: requiredQ / requiredH). Человек
// смотрел результат расчёта сети, переписывал два числа и мог ошибиться —
// например, взять потери одной ветви вместо потерь всего расчётного пути.
//
// Здесь эти величины извлекаются прямо из результата crossMethod:
//   • Q — расход в ветви, где стоит оборудование;
//   • H — суммарные потери вдоль расчётного пути (самого нагруженного),
//         именно их обязано преодолеть оборудование.
//
// Модуль только ЧИТАЕТ результат расчёта и ничего не пересчитывает: физика
// остаётся в aero.ts, здесь — выборка и суммирование.
// ─────────────────────────────────────────────────────────────────────────────
import type { CrossResult, NetworkBranch } from "@/lib/aero";

/** Требования к оборудованию, снятые с рассчитанной сети. */
export interface NetworkDemand {
  /** Требуемая подача, м³/ч. */
  requiredQ: number;
  /** Требуемый напор (Па для вентилятора, м вод. ст. для насоса). */
  requiredH: number;
  /** Ветви расчётного пути — по ним просуммирован напор. */
  pathBranchIds: string[];
  /** Расчёт сети сошёлся: при false числа ориентировочные. */
  converged: boolean;
  /** Пояснение для показа в окне подбора. */
  note: string;
}

/**
 * Требования по конкретной ветви: подача — её расход, напор — её потери.
 *
 * Подходит, когда оборудование обслуживает одну выработку (ВМП в тупике,
 * насос на участке трубопровода). Для сети с разветвлениями используйте
 * demandFromCriticalPath — иначе напор будет занижен.
 */
export function demandFromBranch(
  result: CrossResult,
  branchId: string,
): NetworkDemand {
  const Q = Math.abs(result.branchFlows[branchId] ?? 0);
  const calc = result.branchCalcs[branchId];
  const H = calc ? calc.dpTotal : 0;

  return {
    requiredQ: Math.round(Q),
    requiredH: Math.round(H * 10) / 10,
    pathBranchIds: [branchId],
    converged: result.converged,
    note: result.converged
      ? "Q и H взяты из расчёта сети по выбранной выработке"
      : "Расчёт сети не сошёлся — значения ориентировочные",
  };
}

/**
 * Требования по расчётному пути: подача — расход в ветви оборудования,
 * напор — сумма потерь вдоль самого нагруженного пути от источника к
 * потребителю.
 *
 * ПОЧЕМУ ИМЕННО САМЫЙ НАГРУЖЕННЫЙ ПУТЬ. Оборудование должно обеспечить
 * циркуляцию по всей сети, а не только по своей ветви. Если взять потери
 * одной ветви, подбор даст заниженный напор, и до дальнего потребителя
 * воздух (или вода) не дойдёт. Поэтому суммируются потери вдоль пути с
 * наибольшим сопротивлением.
 *
 * path — упорядоченный список ветвей расчётного пути. Если он не задан,
 * берётся ветвь оборудования (поведение demandFromBranch).
 */
export function demandFromPath(
  result: CrossResult,
  equipmentBranchId: string,
  path: string[],
): NetworkDemand {
  if (path.length === 0) return demandFromBranch(result, equipmentBranchId);

  const Q = Math.abs(result.branchFlows[equipmentBranchId] ?? 0);

  let H = 0;
  const used: string[] = [];
  for (const id of path) {
    const calc = result.branchCalcs[id];
    if (!calc) continue;
    H += calc.dpTotal;
    used.push(id);
  }

  return {
    requiredQ: Math.round(Q),
    requiredH: Math.round(H * 10) / 10,
    pathBranchIds: used,
    converged: result.converged,
    note: result.converged
      ? `Напор просуммирован по ${used.length} выработкам расчётного пути`
      : "Расчёт сети не сошёлся — значения ориентировочные",
  };
}

/**
 * Расчётный путь — цепочка ветвей с наибольшими суммарными потерями.
 *
 * Ищется обходом в ширину от узла источника: на каждом шаге выбирается
 * продолжение с большими потерями. Это не строгий поиск максимума по всем
 * путям (он экспоненциален), а практичное приближение — того же порядка, что
 * применяют при ручном расчёте: идут по «самой тяжёлой» ветке.
 *
 * Возвращает пустой массив, если источник не найден или сеть не связана.
 */
export function findCriticalPath(
  result: CrossResult,
  branches: NetworkBranch[],
  sourceNodeId: string,
): string[] {
  const adj = new Map<string, { to: string; id: string }[]>();
  for (const b of branches) {
    if (!adj.has(b.from)) adj.set(b.from, []);
    if (!adj.has(b.to)) adj.set(b.to, []);
    adj.get(b.from)!.push({ to: b.to, id: b.id });
    adj.get(b.to)!.push({ to: b.from, id: b.id });
  }
  if (!adj.has(sourceNodeId)) return [];

  const loss = (id: string): number => result.branchCalcs[id]?.dpTotal ?? 0;

  // Обход с накоплением потерь: для каждого узла храним самый «тяжёлый» путь.
  const best = new Map<string, { total: number; path: string[] }>();
  best.set(sourceNodeId, { total: 0, path: [] });

  const queue: string[] = [sourceNodeId];
  const visited = new Set<string>([sourceNodeId]);

  while (queue.length > 0) {
    const node = queue.shift()!;
    const cur = best.get(node)!;
    for (const edge of adj.get(node) ?? []) {
      // Ветвь уже в пути — кольцо, второй раз не идём.
      if (cur.path.includes(edge.id)) continue;
      const total = cur.total + loss(edge.id);
      const prev = best.get(edge.to);
      if (!prev || total > prev.total) {
        best.set(edge.to, { total, path: [...cur.path, edge.id] });
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
        // Узел уже посещали, но путь стал тяжелее — пересматриваем его ветки.
        if (visited.has(edge.to) && prev) queue.push(edge.to);
      }
    }
  }

  let heaviest = { total: 0, path: [] as string[] };
  for (const entry of best.values()) {
    if (entry.total > heaviest.total) heaviest = entry;
  }
  return heaviest.path;
}
