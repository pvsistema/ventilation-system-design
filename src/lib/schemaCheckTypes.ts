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
export interface GroupNote {
  title: string; nodeIds: string[]; branchIds: string[]; note: string;
  /** Точка для центрирования вида (координаты отрисовки), если известна. */
  focus?: { x: number; y: number; z: number };
}

/** Лимит длины каждого списка — защита от зависания интерфейса. */
export const CHECK_MAX_ITEMS = 500;

/** Помощник: добавить в список с учётом лимита. Возвращает false, если лимит достигнут. */
export function pushCapped<T>(arr: T[], item: T, max = CHECK_MAX_ITEMS): boolean {
  if (arr.length >= max) return false;
  arr.push(item);
  return true;
}

export const fmtNum = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
/**
 * Сопротивление в кМюрг с нужным числом знаков: мелкие значения (паруса,
 * регуляторы — тысячные доли кМюрг) не превращаются в «0.00».
 * Лишние нули в конце отбрасываются: 0.00146, 2.5, 305.
 */
export function fmtKmu(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : Math.min(7, 3 - Math.floor(Math.log10(a)));
  const t = v.toFixed(d);
  return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t;
}
