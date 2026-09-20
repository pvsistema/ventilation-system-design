// ─────────────────────────────────────────────────────────────────────────────
// bulkheadResistance.ts — сопротивление вентиляционных сооружений ветви.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Перемычка, дверь и регулируемое окно задаются не в
// самой ветви, а ЗНАЧКОМ на схеме (SchemaSymbol с привязкой branchId), и их
// сопротивление приходится собирать отдельно от b.resistance. Этот сбор нужен
// в трёх разных местах: в payload для решателя, в карте общей депрессии ветви
// (панель свойств и аварийные расчёты) и в подборе режима при пожаре, где
// закрытие двери обязано менять сеть.
//
// Раньше он существовал двумя дословными копиями внутри Cad.tsx. Копии — это
// не вопрос вкуса: стоит поправить формулу окна в одной, и панель свойств
// начнёт показывать одно сопротивление, а решатель считать по другому.
// Поэтому логика собрана здесь в одном экземпляре.
//
// НОВОЙ ФИЗИКИ ЗДЕСЬ НЕТ — формулы, пороги и порядок ветвлений перенесены
// дословно из Cad.tsx.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { solidBulkheadRkMurg, windowBulkheadRkMurg } from "@/lib/bulkheads";
import { BULKHEAD_SYMBOL_IDS, OPEN_DOOR_IDS } from "@/lib/schemaSymbols";

/** Запись справочника перемычек рудника — нужны только эти поля. */
export interface BulkheadRef {
  id: string;
  airPermeability?: number;
  /** Сопротивление из справочника, Мюрг. */
  rMkyurg?: number;
}

/**
 * Сопротивление ОДНОГО значка вентсооружения, кМюрг.
 *
 * Три режима задания (bkResMode) неравноправны: «вручную» и «по съёмке» берут
 * готовое число и площадь окна игнорируют, и только «по проекту» считает R из
 * сечения. Поэтому подбор режима при пожаре, меняя площадь окна, обязан
 * переводить значок в режим «по проекту» — иначе изменение молча пропадёт
 * (см. applyActions в lib/fireControl/actions.ts).
 */
export function symbolBulkheadR(
  s: SchemaSymbol,
  branch: TopoBranch,
  bulkheadsMap: Map<string, BulkheadRef>,
): number {
  const mode = s.bkResMode ?? "project";

  if (mode === "manual") return s.bkManualR ?? 0; // кМюрг = Па·с²/м⁶, коэффициент = 1
  if (mode === "survey") {
    const q = s.bkSurveyQ ?? 0;
    const dp = s.bkSurveyDP ?? 0;
    return q > 0 ? dp / (q * q * 9.81) : 0; // ΔP/(Q²·9.81) кМюрг, как в АэроСети
  }

  const sw = s.bkWindowArea ?? 0;
  const branchArea = branch.area ?? 0;
  // Открытая настежь дверь сопротивления не создаёт. Ноль в поле окна здесь
  // означает «проём во всё сечение», а не «закрыто», — иначе распахнутая
  // дверь считалась бы глухой перемычкой.
  const isFullyOpen = (OPEN_DOOR_IDS.has(s.typeId) && sw <= 0.001)
    || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
  if (isFullyOpen) return 0;

  // Регулируемое окно: формула диафрагмы с учётом сечения (АэроСеть).
  if (sw > 0.001) return windowBulkheadRkMurg(sw, branchArea, s.typeId);

  const bkEntry = s.bkBulkheadId ? bulkheadsMap.get(s.bkBulkheadId) : undefined;
  const kAir = s.bkManualAirPerm
    ? (s.bkCustomAirPerm ?? 0)
    : (s.bkAirPerm ?? bkEntry?.airPermeability ?? branch.bulkheadAirPerm ?? 0);
  const rRef = bkEntry?.rMkyurg ?? 0;
  // Глухая: R=1/A²/1000; парус — калиброванная формула.
  return kAir > 0
    ? solidBulkheadRkMurg(kAir, branchArea)
    : (s.bkBulkheadR ?? rRef ?? branch.bulkheadR ?? 0);
}

/**
 * Сопротивление перемычки, заданной во вкладке ветви, кМюрг.
 *
 * Такой способ остался от схем без значков: если на ветви есть значок,
 * он главнее и это поле не учитывается (иначе одна перемычка посчиталась бы
 * дважды).
 */
export function branchOwnBulkheadR(b: TopoBranch): number {
  const mode = b.bulkheadResMode ?? "project";
  if (mode === "manual") return b.bulkheadManualR ?? 0; // кМюрг = Па·с²/м⁶
  if (mode === "survey") {
    const q = b.bulkheadSurveyQ ?? 0;
    const dp = b.bulkheadSurveyDP ?? 0;
    return q > 0 ? dp / (q * q * 9.81) : 0; // ΔP/(Q²·9.81) кМюрг, как в АэроСети
  }
  const winA = b.bulkheadWindowArea ?? 0;
  if (winA > 0.001) return windowBulkheadRkMurg(winA, b.area ?? 0, b.bulkheadId);
  const rSolid = (A: number) => solidBulkheadRkMurg(A, b.area ?? 0);
  if (b.bulkheadManualAirPerm && (b.bulkheadCustomAirPerm ?? 0) > 0) {
    return rSolid(b.bulkheadCustomAirPerm as number);
  }
  if ((b.bulkheadAirPerm ?? 0) > 0) return rSolid(b.bulkheadAirPerm);
  return b.bulkheadR ?? 0;
}

/** Значки вентсооружений, привязанные к ветви. */
export function bulkheadSymbolsOf(b: TopoBranch, symbols: SchemaSymbol[]): SchemaSymbol[] {
  return symbols.filter(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
}

/**
 * Полное сопротивление вентсооружений ветви (значки + вкладка), кМюрг.
 *
 * Именно эта величина складывается с b.resistance и уходит в решатель.
 */
export function bulkheadROfBranch(
  b: TopoBranch,
  symbols: SchemaSymbol[],
  bulkheadsMap: Map<string, BulkheadRef>,
): { total: number; symbolCount: number } {
  const bkSyms = bulkheadSymbolsOf(b, symbols);
  const rSyms = bkSyms.reduce((sum, s) => sum + symbolBulkheadR(s, b, bulkheadsMap), 0);
  const rBranch = (b.hasBulkhead && bkSyms.length === 0) ? branchOwnBulkheadR(b) : 0;
  return { total: rSyms + rBranch, symbolCount: bkSyms.length };
}

/**
 * Карта «ветвь → сопротивление её вентсооружений», кМюрг.
 *
 * В карту попадают только ветви, где сооружение действительно есть: нулевое
 * значение у ветви без перемычки и отсутствие записи — разные вещи для тех,
 * кто читает эту карту (например, выгрузки в CSV).
 */
export function buildBulkheadRMap(
  branches: TopoBranch[],
  symbols: SchemaSymbol[],
  bulkheads: BulkheadRef[],
): Map<string, number> {
  const bulkheadsMap = new Map<string, BulkheadRef>(bulkheads.map(mb => [mb.id, mb]));
  const map = new Map<string, number>();
  for (const b of branches) {
    const { total, symbolCount } = bulkheadROfBranch(b, symbols, bulkheadsMap);
    if (total > 0 || symbolCount > 0 || b.hasBulkhead) map.set(b.id, total);
  }
  return map;
}