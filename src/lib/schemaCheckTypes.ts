// Общие типы проверки схемы — вынесены отдельно, чтобы модули проверок
// (связность, параметры, расчёт) не ссылались друг на друга по кругу.
import type { TopoNode, TopoBranch } from "./topology";

/** Ветвь + пояснение, что с ней не так (понятным языком). */
export interface BranchNote { branch: TopoBranch; note: string }
/** Узел + пояснение. */
export interface NodeNote { node: TopoNode; note: string }
/** Пара ветвей (например, пересечение без общего узла). */
export interface BranchPairNote { a: TopoBranch; b: TopoBranch; note: string }
/** Группа объектов (например, отдельная часть сети). */
export interface GroupNote { title: string; nodeIds: string[]; branchIds: string[]; note: string }

/** Лимит длины каждого списка — защита от зависания интерфейса. */
export const CHECK_MAX_ITEMS = 500;

/** Помощник: добавить в список с учётом лимита. Возвращает false, если лимит достигнут. */
export function pushCapped<T>(arr: T[], item: T, max = CHECK_MAX_ITEMS): boolean {
  if (arr.length >= max) return false;
  arr.push(item);
  return true;
}

export const fmtNum = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");