// ─────────────────────────────────────────────────────────────────────────────
// fireZones.ts — «до очага пожара» и «за очагом пожара» по РД-15-11-2007, п.25.
//
// ЗАЧЕМ. РД предписывает два РАЗНЫХ способа вывода людей:
//   • из выработок ДО очага — навстречу свежей струе к выходу на поверхность;
//   • из выработок ЗА очагом — в изолирующих самоспасателях КРАТЧАЙШИМ путём
//     в выработки со свежей струёй и далее на поверхность.
//
// Примечание к п.25 задаёт правило определения: места «до очага» и «за очагом»
// определяются ПО ХОДУ ДВИЖЕНИЯ ВЕНТИЛЯЦИОННОЙ СТРУИ при режиме вентиляции,
// предусмотренном для данной позиции плана ликвидации аварий.
//
// Отсюда главное свойство: принадлежность зоне зависит от РЕЖИМА. Реверс ВГП
// переворачивает струю, и рабочее место «за очагом» становится «до очага».
// Поэтому число людей за очагом — прямой критерий качества режима, а не
// справочная пометка: режим, уводящий людей из-за очага, объективно лучше.
//
// Физики здесь нет: расходы уже посчитаны решателем, мы лишь идём по знаку
// потока от очага вниз по струе.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch } from "./topology";

/** Положение относительно очага по ходу вентиляционной струи (п.25). */
export type FireZone =
  /** До очага — струя идёт СЮДА раньше, чем к очагу. Выход навстречу свежему воздуху. */
  | "before"
  /** За очагом — струя приходит от очага. Выход только в самоспасателе. */
  | "after"
  /** Вне влияния очага — ни по струе, ни против неё дым сюда не идёт. */
  | "aside";

export const FIRE_ZONE_LABEL: Record<FireZone, string> = {
  before: "до очага",
  after:  "за очагом",
  aside:  "вне струи очага",
};

/** Результат разметки сети по зонам. */
export interface FireZoneMap {
  /** Зона для каждой ветви. */
  branchZone: Map<string, FireZone>;
  /** Зона для каждого узла. */
  nodeZone: Map<string, FireZone>;
  /** Узлы, куда струя приносит продукты горения (вниз по потоку от очага). */
  afterNodes: Set<string>;
  /** Есть ли вообще очаг на схеме. */
  hasFire: boolean;
}

/**
 * Направление потока в ветви с учётом знака расхода.
 *
 * Решатель возвращает расход со знаком: положительный — от fromId к toId,
 * отрицательный — наоборот. Ноль означает, что струи нет и ветвь не проводит
 * дым ни в одну сторону.
 */
function flowDirection(b: TopoBranch, flows?: Map<string, number>): 0 | 1 | -1 {
  const q = flows?.get(b.id) ?? b.flow ?? 0;
  if (!Number.isFinite(q) || Math.abs(q) < 1e-9) return 0;
  return q > 0 ? 1 : -1;
}

/**
 * Разметить сеть на «до очага» / «за очагом» для ЗАДАННОГО режима.
 *
 * @param branches ветви сети
 * @param flows    расходы этого режима (из runFireMode). Если не переданы —
 *                 берётся b.flow, то есть текущее состояние схемы.
 *
 * Алгоритм — обход по направлению струи:
 *   • «за очагом» = всё, куда можно дойти ОТ очага, двигаясь ПО потоку;
 *   • «до очага»  = всё, откуда можно дойти К очагу, двигаясь по потоку
 *     (то есть обход против струи от входного узла очага);
 *   • остальное — в стороне: дым туда не попадает.
 *
 * Сама ветвь с очагом всегда «за очагом»: люди в ней уже в дыму.
 */
export function computeFireZones(
  branches: TopoBranch[],
  flows?: Map<string, number>,
): FireZoneMap {
  const branchZone = new Map<string, FireZone>();
  const nodeZone = new Map<string, FireZone>();
  const afterNodes = new Set<string>();

  const fireBranches = branches.filter(b => b.hasFire);
  if (fireBranches.length === 0) {
    for (const b of branches) branchZone.set(b.id, "aside");
    return { branchZone, nodeZone, afterNodes, hasFire: false };
  }

  // Списки смежности ПО потоку и ПРОТИВ потока. Ветви с нулевым расходом
  // не проводят дым и в обходе не участвуют: тупик без движения воздуха
  // не становится «за очагом» только из-за того, что он рядом.
  const downstream = new Map<string, { to: string; id: string }[]>();
  const upstream = new Map<string, { to: string; id: string }[]>();
  const push = (m: Map<string, { to: string; id: string }[]>, k: string, v: { to: string; id: string }) => {
    const arr = m.get(k);
    if (arr) arr.push(v); else m.set(k, [v]);
  };

  for (const b of branches) {
    const dir = flowDirection(b, flows);
    if (dir === 0) continue;
    const inNode  = dir > 0 ? b.fromId : b.toId;
    const outNode = dir > 0 ? b.toId   : b.fromId;
    push(downstream, inNode,  { to: outNode, id: b.id });
    push(upstream,   outNode, { to: inNode,  id: b.id });
  }

  // ── «За очагом»: от выходного узла очага вниз по струе ───────────────────
  const afterBranches = new Set<string>();
  const beforeBranches = new Set<string>();
  const beforeNodes = new Set<string>();

  const seedsAfter: string[] = [];
  const seedsBefore: string[] = [];
  for (const fb of fireBranches) {
    const dir = flowDirection(fb, flows);
    // Ветвь очага всегда задымлена — относим её к «за очагом».
    afterBranches.add(fb.id);
    if (dir === 0) {
      // Струи нет: направление неизвестно, оба конца считаем задымлёнными.
      seedsAfter.push(fb.fromId, fb.toId);
      continue;
    }
    const inNode  = dir > 0 ? fb.fromId : fb.toId;
    const outNode = dir > 0 ? fb.toId   : fb.fromId;
    seedsAfter.push(outNode);
    seedsBefore.push(inNode);
  }

  const walk = (
    seeds: string[],
    adj: Map<string, { to: string; id: string }[]>,
    outNodes: Set<string>,
    outBranches: Set<string>,
  ) => {
    const stack = [...seeds];
    for (const s of seeds) outNodes.add(s);
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      for (const e of adj.get(cur) ?? []) {
        outBranches.add(e.id);
        if (!outNodes.has(e.to)) {
          outNodes.add(e.to);
          stack.push(e.to);
        }
      }
    }
  };

  walk(seedsAfter, downstream, afterNodes, afterBranches);
  walk(seedsBefore, upstream, beforeNodes, beforeBranches);

  // ── Сводим в карты ───────────────────────────────────────────────────────
  // «За очагом» приоритетнее: если узел достижим и по струе от очага, и
  // против неё (кольцевая схема), дым до него дойдёт — значит он в опасности.
  for (const b of branches) {
    branchZone.set(
      b.id,
      afterBranches.has(b.id) ? "after"
        : beforeBranches.has(b.id) ? "before"
        : "aside",
    );
  }
  const allNodes = new Set<string>();
  for (const b of branches) { allNodes.add(b.fromId); allNodes.add(b.toId); }
  for (const id of allNodes) {
    nodeZone.set(
      id,
      afterNodes.has(id) ? "after"
        : beforeNodes.has(id) ? "before"
        : "aside",
    );
  }

  return { branchZone, nodeZone, afterNodes, hasFire: true };
}

/**
 * Узлы, стоящие на СВЕЖЕЙ струе, — цель вывода для людей за очагом (п.25).
 *
 * «Выработка со свежей струёй» — та, куда продукты горения не приходят,
 * то есть зона «до очага» или «в стороне». Для людей за очагом РД требует
 * выводить именно туда кратчайшим путём, а уже оттуда — на поверхность;
 * идти сразу к дальнему устью через весь дым нельзя.
 */
export function freshAirNodes(zones: FireZoneMap, allNodeIds: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of allNodeIds) {
    if ((zones.nodeZone.get(id) ?? "aside") !== "after") out.add(id);
  }
  return out;
}
