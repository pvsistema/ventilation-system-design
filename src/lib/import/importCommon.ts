// ─────────────────────────────────────────────────────────────────────────────
// importCommon.ts — ОБЩАЯ ЧАСТЬ ВСЕХ ИМПОРТОВ СХЕМЫ.
//
// Здесь лежит только то, что нужно СРАЗУ НЕСКОЛЬКИМ форматам: типы результата
// импорта и разбор текста CSV. Ничего специфичного для конкретной программы
// (АэроСеть, Вентиляция 2.0, Ventsim) в этом файле быть не должно —
// иначе форматы снова перепутаются между собой.
//
// Кто чем занимается — см. src/lib/import/README.md
// ─────────────────────────────────────────────────────────────────────────────

import { type TopoNode, type TopoBranch } from "@/lib/topology";

// ── Типы результата импорта ──────────────────────────────────────────────────

export interface RawFan {
  branchId: string;    // ID выработки из АэроСети
  name: string;        // название вентилятора
  pressure: number;    // давление (напор), Па
  flow: number;        // расход, м³/с
  /** Вид установки из файла: main → ГВУ, simple/local → ВМП */
  fanType?: "ГВУ" | "ВВУ" | "ВМП";
}

export interface RawBulkhead {
  branchId: string;        // ID выработки из АэроСети
  typeName: string;        // название типа перемычки
  rKmu: number;            // сопротивление, кМюрг
  airPerm: number;         // воздухопроницаемость, м²/(с·√Па)
}

export interface RawPosition {
  id: string;              // исходный ID из АэроСети
  number: number;          // номер позиции
  name: string;            // название
  positionType: string;    // тип: безреверсивная / реверсивная
  accidentType: string;    // вид аварии
  x: number;               // мировые координаты X
  y: number;               // Y
  z: number;               // Z
  branchIds: string[];     // ID привязанных выработок (из АэроСети)
  /** Цвет границы маркера из файла (HEX, «#c53030») — пусто, если не задан. */
  borderColor: string;
}

/**
 * Горизонт (слой схемы), восстановленный из столбца «Слой выработки».
 *
 * В CSV слой хранится ТЕКСТОМ («КТВР +390/+130»), без отметки и цвета —
 * поэтому z вычисляем как среднюю высотную отметку узлов тех выработок,
 * что попали в этот слой, а цвет назначается уже на схеме.
 */
export interface RawHorizon {
  /** Идентификатор, сгенерированный при импорте. */
  id: string;
  /** Название слоя ровно как в файле. */
  name: string;
  /** Средняя высотная отметка выработок слоя, м. */
  z: number;
  /** Сколько выработок отнесено к слою (для журнала импорта). */
  branchCount: number;
}

export interface CsvImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  fans: RawFan[];
  bulkheads: RawBulkhead[];
  positions: RawPosition[];
  /** Горизонты, восстановленные из столбца «Слой выработки». */
  horizons: RawHorizon[];
  /** Маппинг: оригинальный ID выработки из АэроСети → сгенерированный ID ветви */
  branchOriginalIdMap: Record<string, string>;
  warnings: string[];
  /**
   * true — сопротивление выработок в файле УЖЕ включает перемычки
   * («Суммарное сопротивление» в терминах АэроСети). Тогда сопротивление
   * перемычек нельзя добавлять к ветви второй раз: перемычки создаются
   * только как символы на схеме, без вклада в расчёт.
   */
  resistanceIncludesBulkheads: boolean;
  stats: { nodes: number; branches: number; nodesWithZ: number; fans: number; bulkheads: number; positions: number; horizons: number };
  debug: string;
}
// ── Разбор текста CSV ────────────────────────────────────────────────────────

// ── Утилиты ──────────────────────────────────────────────────────────────────

export function parseNum(s: string | undefined): number {
  if (s === undefined || s === null) return 0;
  const n = parseFloat(s.replace(",", ".").trim());
  return isNaN(n) ? 0 : n;
}

export function detectSep(line: string): ";" | "\t" | "," {
  if (line.includes(";")) return ";";
  if (line.includes("\t")) return "\t";
  return ",";
}

/**
 * Разбивает строку CSV на ячейки С УЧЁТОМ КАВЫЧЕК.
 *
 * Простое разбиение по разделителю ломается на значениях вида
 * «Сопряжение ЮВС, гор. −130»: запятая внутри названия принималась за границу
 * ячейки, и ВСЕ последующие столбцы съезжали (цвет читался как вид аварии
 * и т. д.). Поэтому разделитель внутри кавычек игнорируем, а удвоенные
 * кавычки («""») понимаем как одну — это стандартное экранирование CSV.
 */
export function splitRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === sep) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function normalizeLines(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
}
// ── Восстановление горизонтов из столбца «Слой выработки» ────────────────────

// осознанно, ветви только что созданы импортом и никому ещё не отданы.
//
// Служебные значения («Выработки» — заглушка парсера, пустая строка) слоями
// не считаем, иначе на схеме появился бы мусорный горизонт.
export function buildHorizonsFromLayers(
  branches: TopoBranch[],
  nodes: Iterable<TopoNode>,
  ts: number,
  debug: string[],
): RawHorizon[] {
  const nodeById = new Map<string, TopoNode>();
  for (const n of nodes) nodeById.set(n.id, n);

  const acc = new Map<string, { zSum: number; zCount: number; branchIds: string[] }>();
  for (const b of branches) {
    const nm = (b.layer || "").trim();
    if (!nm || nm === "Выработки") continue;
    let e = acc.get(nm);
    if (!e) { e = { zSum: 0, zCount: 0, branchIds: [] }; acc.set(nm, e); }
    e.branchIds.push(b.id);
    const fn = nodeById.get(b.fromId);
    const tn = nodeById.get(b.toId);
    if (fn) { e.zSum += fn.z; e.zCount++; }
    if (tn) { e.zSum += tn.z; e.zCount++; }
  }

  const horizons: RawHorizon[] = [];
  let hi = 0;
  for (const [name, e] of acc) {
    const id = `H_CSV_${ts}_${hi++}`;
    horizons.push({
      id,
      name,
      z: e.zCount > 0 ? Math.round((e.zSum / e.zCount) * 10) / 10 : 0,
      branchCount: e.branchIds.length,
    });
    const idSet = new Set(e.branchIds);
    for (const b of branches) if (idSet.has(b.id)) b.horizonId = id;
  }

  if (horizons.length > 0) {
    debug.push(`Горизонтов восстановлено из столбца «Слой»: ${horizons.length} (${horizons.map(h => `${h.name}: ${h.branchCount} выр., z=${h.z}`).join("; ")})`);
  }
  return horizons;
}

// ── Распознавание единиц сопротивления ───────────────────────────────────────

export function resistanceUnitFromHeader(header: string): "kmu" | "si" | null {
  const h = header.toLowerCase();
  if (!/сопротивл|resist/.test(h)) return null;
  // кМюрг / кмю / kmu / мюрг — единицы АэроСети и Вентиляции 2.0
  if (/кмюрг|к\.?мюрг|кмю\b|kmu|мюрг|murg/.test(h)) return "kmu";
  // Н·с²/м⁸ в разных написаниях — СИ
  if (/н\s*[·*.]?\s*с.?\s*\/\s*м|n\s*[·*.]?\s*s.?\s*\/\s*m|нс2|ns2/.test(h)) return "si";
  return null;
}

/**
 * Определяет, включает ли сопротивление выработки сопротивление её перемычек.
 *
 * Вентиляция 2.0 выгружает «суммарное сопротивление»: у выработки с перемычкой
 * R целиком состоит из вклада перемычек, а собственное трение — тысячные доли.
 * Признак: R выработки почти равно сумме R её перемычек (в пределах 10%).
 * Если так у большинства ветвей с перемычками — это суммарное сопротивление.
 */
export function detectResistanceIncludesBulkheads(
  branches: { id: string; resistance: number }[],
  bulkheads: { branchId: string; rKmu: number }[],
): boolean {
  if (bulkheads.length === 0) return false;
  const sumByBranch = new Map<string, number>();
  for (const bk of bulkheads) {
    sumByBranch.set(bk.branchId, (sumByBranch.get(bk.branchId) ?? 0) + bk.rKmu);
  }
  let matched = 0, total = 0;
  for (const b of branches) {
    const bkSum = sumByBranch.get(b.id);
    if (!bkSum || bkSum <= 0 || b.resistance <= 0) continue;
    total++;
    // R ветви ≈ сумма перемычек → перемычки уже внутри
    if (Math.abs(b.resistance - bkSum) / Math.max(b.resistance, bkSum) < 0.1) matched++;
  }
  return total > 0 && matched / total > 0.5;
}

export function detectResistanceUnit(resistances: number[]): "kmu" | "si" {
  const nonZero = resistances.filter(r => r > 0);
  if (nonZero.length === 0) return "kmu"; // нет данных — предполагаем кмю
  const sorted = [...nonZero].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const unit = median < 0.05 ? "si" : "kmu";
  return unit;
}