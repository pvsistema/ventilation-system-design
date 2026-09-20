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
//
// ЕДИНИЦЫ (важно). Функции *RkMurg в lib/bulkheads.ts откалиброваны по
// эталонам «АэроСети» и возвращают РУДНИЧНЫЕ кМюрг — такими они и остаются,
// потому что именно в кМюрг сверяются с эталонами и показываются в панели.
// А наружу этот модуль отдаёт СИ (Н·с²/м⁸): его результат складывается с
// сопротивлением выработки и уходит в решатель, где ΔP=R·Q² в паскалях.
// Перевод выполняется ровно здесь, в одном месте — раньше его не было вовсе,
// и в одной сумме лежали слагаемые, отличающиеся множителем g.
import type { TopoBranch } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { solidBulkheadRkMurg, windowBulkheadRkMurg } from "@/lib/bulkheads";
import { kmurgToSi, murgToSi, resistanceFromSurvey } from "@/lib/resistanceUnits";
import { BULKHEAD_SYMBOL_IDS, OPEN_DOOR_IDS } from "@/lib/schemaSymbols";

/** Запись справочника перемычек рудника — нужны только эти поля. */
export interface BulkheadRef {
  id: string;
  airPermeability?: number;
  /** Сопротивление из справочника, Мюрг. */
  rMkyurg?: number;
}

/**
 * Сопротивление ОДНОГО значка вентсооружения, Н·с²/м⁸ (СИ).
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

  // Введено вручную в кМюрг (так подписано поле) → в СИ.
  if (mode === "manual") return kmurgToSi(s.bkManualR ?? 0);
  // По съёмке: ΔP замерено в паскалях, значит R=ΔP/Q² выходит сразу в СИ.
  // Деления на g, которое здесь стояло раньше, быть не должно — оно занижало
  // сопротивление замеренной перемычки почти на порядок.
  if (mode === "survey") {
    return resistanceFromSurvey(s.bkSurveyDP ?? 0, s.bkSurveyQ ?? 0);
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
  if (sw > 0.001) return kmurgToSi(windowBulkheadRkMurg(sw, branchArea, s.typeId));

  const bkEntry = s.bkBulkheadId ? bulkheadsMap.get(s.bkBulkheadId) : undefined;
  const kAir = s.bkManualAirPerm
    ? (s.bkCustomAirPerm ?? 0)
    : (s.bkAirPerm ?? bkEntry?.airPermeability ?? branch.bulkheadAirPerm ?? 0);
  // Глухая/парус — калиброванная формула, её результат в кМюрг.
  if (kAir > 0) return kmurgToSi(solidBulkheadRkMurg(kAir, branchArea));
  // Запасной путь — готовое число из справочника. Эти поля хранятся в МЮРГ
  // (см. TopoBranch.bulkheadR), а не в кМюрг: раньше их брали как кМюрг, и
  // перемычка из справочника получалась в тысячу раз жёстче, чем заявлено.
  const rRefMurg = bkEntry?.rMkyurg ?? 0;
  return murgToSi(s.bkBulkheadR ?? rRefMurg ?? branch.bulkheadR ?? 0);
}

/**
 * Сопротивление перемычки, заданной во вкладке ветви, Н·с²/м⁸ (СИ).
 *
 * Такой способ остался от схем без значков: если на ветви есть значок,
 * он главнее и это поле не учитывается (иначе одна перемычка посчиталась бы
 * дважды).
 */
export function branchOwnBulkheadR(b: TopoBranch): number {
  const mode = b.bulkheadResMode ?? "project";
  if (mode === "manual") return kmurgToSi(b.bulkheadManualR ?? 0);
  // По съёмке ΔP в паскалях → R=ΔP/Q² сразу в СИ (см. symbolBulkheadR).
  if (mode === "survey") {
    return resistanceFromSurvey(b.bulkheadSurveyDP ?? 0, b.bulkheadSurveyQ ?? 0);
  }
  const winA = b.bulkheadWindowArea ?? 0;
  if (winA > 0.001) return kmurgToSi(windowBulkheadRkMurg(winA, b.area ?? 0, b.bulkheadId));
  const rSolid = (A: number) => kmurgToSi(solidBulkheadRkMurg(A, b.area ?? 0));
  if (b.bulkheadManualAirPerm && (b.bulkheadCustomAirPerm ?? 0) > 0) {
    return rSolid(b.bulkheadCustomAirPerm as number);
  }
  if ((b.bulkheadAirPerm ?? 0) > 0) return rSolid(b.bulkheadAirPerm);
  return kmurgToSi(b.bulkheadR ?? 0);
}

/** Значки вентсооружений, привязанные к ветви. */
export function bulkheadSymbolsOf(b: TopoBranch, symbols: SchemaSymbol[]): SchemaSymbol[] {
  return symbols.filter(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
}

/**
 * Полное сопротивление вентсооружений ветви (значки + вкладка), Н·с²/м⁸.
 *
 * Именно эта величина складывается с b.resistance и уходит в решатель —
 * поэтому она обязана быть в тех же единицах, что и b.resistance (СИ).
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
 * Карта «ветвь → сопротивление её вентсооружений», Н·с²/м⁸.
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