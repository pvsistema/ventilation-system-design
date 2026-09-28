// ─────────────────────────────────────────────────────────────────────────────
// branchBulkheadInfo.ts — сведения о вентсооружениях ветви ДЛЯ ПРОВЕРКИ СХЕМЫ.
//
// ЗАЧЕМ. Проверки схемы («Перемычка без сопротивления», «Перемычка выше
// норматива», «Большие утечки через перемычки») раньше смотрели только на
// флаг ветви hasBulkhead и поле вкладки ветви (branchBulkheadRkMurg). Но
// перемычка почти всегда задаётся ЗНАЧКОМ на схеме, и её сопротивление —
// в том числе заданное вручную — живёт в самом значке (bkResMode / bkManualR).
// Решатель считает ветвь по значкам (bulkheadROfBranch), а проверка — нет.
// Отсюда ложные «Перемычка без сопротивления» и чужие ветви в утечках.
//
// Здесь сопротивление берётся ТОЙ ЖЕ функцией, что уходит в решатель, —
// проверка и расчёт больше не могут разойтись в числах.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { LEGEND_TYPES, OPEN_DOOR_IDS, WINDOW_BULKHEAD_IDS } from "@/lib/schemaSymbols";
import {
  bulkheadSymbolsOf, symbolBulkheadR, branchOwnBulkheadR, type BulkheadRef,
} from "@/lib/bulkheadResistance";

export interface BranchBulkheadInfo {
  /** На ветви действительно есть вентсооружение (значок или вкладка ветви). */
  present: boolean;
  /** Полное сопротивление сооружений ветви, кМюрг — ровно то, что уходит в решатель. */
  rKmu: number;
  /** Все сооружения — открытые двери/проёмы (R = 0 — это их норма, не ошибка). */
  allOpen: boolean;
  /** Есть сооружение с окном/проёмом — оно предназначено пропускать воздух. */
  hasWindow: boolean;
  /** Понятное название: «Дверь вентиляционная закрытая», «Глухая перемычка + …». */
  name: string;
  /** Как задано R: «вручную», «по съёмке», «по проекту» (для подсказки). */
  modeLabel: string;
}

const MODE_LABEL: Record<string, string> = { manual: "вручную", survey: "по съёмке", project: "по проекту" };
const nameOf = (typeId: string) => LEGEND_TYPES.find(l => l.id === typeId)?.name ?? "Перемычка";

/** Карта «ветвь → сведения о её вентсооружениях». В карте только ветви, где сооружение есть. */
export function buildBulkheadInfoMap(
  branches: TopoBranch[],
  symbols: SchemaSymbol[],
  bulkheads: BulkheadRef[],
): Map<string, BranchBulkheadInfo> {
  const refMap = new Map<string, BulkheadRef>(bulkheads.map(b => [b.id, b]));
  const out = new Map<string, BranchBulkheadInfo>();
  for (const b of branches) {
    const syms = bulkheadSymbolsOf(b, symbols);
    if (syms.length > 0) {
      const rKmu = syms.reduce((s, sym) => s + symbolBulkheadR(sym, b, refMap), 0);
      const modes = [...new Set(syms.map(s => MODE_LABEL[s.bkResMode ?? "project"]))];
      // Открытое сооружение: распахнутая дверь или окно во всё сечение (R = 0 по проекту).
      const isOpen = (s: SchemaSymbol) => {
        const sw = s.bkWindowArea ?? 0;
        return (OPEN_DOOR_IDS.has(s.typeId) && sw <= 0.001)
          || (sw > 0.001 && (b.area ?? 0) > 0 && sw >= (b.area ?? 0) * 0.999);
      };
      out.set(b.id, {
        present: true,
        rKmu,
        allOpen: syms.every(s => (s.bkResMode ?? "project") === "project" && isOpen(s)),
        hasWindow: syms.some(s => WINDOW_BULKHEAD_IDS.has(s.typeId) || (s.bkWindowArea ?? 0) > 0.001),
        name: syms.map(s => s.bkBulkheadName || nameOf(s.typeId)).join(" + "),
        modeLabel: modes.join(", "),
      });
    } else if (b.hasBulkhead) {
      out.set(b.id, {
        present: true,
        rKmu: branchOwnBulkheadR(b),
        allOpen: false,
        hasWindow: (b.bulkheadWindowArea ?? 0) > 0.001,
        name: b.bulkheadName || "Перемычка",
        modeLabel: MODE_LABEL[b.bulkheadResMode ?? "project"],
      });
    }
  }
  return out;
}