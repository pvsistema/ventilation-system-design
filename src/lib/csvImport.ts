// ─────────────────────────────────────────────────────────────────────────────
// Импорт CSV из АэроСети (схема Aeroset, разделитель ;)
//
// АэроСеть экспортирует 5 файлов:
//   *-nodes.csv        — узлы: ID; X; Y; Z; Атмосфера
//   *-excavations.csv  — выработки: ID; НачВерш; КонВерш; Название; Длина; Тип; S; P; Q; R; Слой; ИдПоз
//   *-positions.csv    — позиции (X,Y,Z для отображения)
//   *-bulkheads.csv    — перемычки
//   *-fans.csv         — вентиляторы
//
// Также поддерживается один файл со всеми секциями.
// ─────────────────────────────────────────────────────────────────────────────

import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

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

// ── Утилиты ──────────────────────────────────────────────────────────────────

function parseNum(s: string | undefined): number {
  if (s === undefined || s === null) return 0;
  const n = parseFloat(s.replace(",", ".").trim());
  return isNaN(n) ? 0 : n;
}

function detectSep(line: string): ";" | "\t" | "," {
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
function splitRow(line: string, sep: string): string[] {
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

function normalizeLines(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

// ── Определение типа файла по имени ──────────────────────────────────────────

export type CsvFileType = "nodes" | "excavations" | "positions" | "bulkheads" | "fans" | "unknown";

export function detectFileType(filename: string, firstLines: string): CsvFileType {
  // Сначала по содержимому (надёжнее имени файла в АэроСети)
  const allHeaders = firstLines.split("\n")
    .filter(l => l.includes(";") || l.includes(","))
    .slice(0, 3).join(" ").toLowerCase();

  // Специфичные типы — проверяем ПЕРВЫМИ, чтобы не спутать с excavations
  // (файлы fans/bulkheads тоже содержат "выработки" в заголовке → иначе детект сбивается)
  if (/напор|депресс|fan.*id|вентилят|источник тяг|pressure.*fan|fan.*pressure/i.test(allHeaders)) return "fans";
  if (/перемычк|bulkhead|тип перемычк/i.test(allHeaders)) return "bulkheads";
  if (/тип позиции|position type/i.test(allHeaders)) return "positions";
  // nodes: содержит "вершина" + "атмосфера" или "высотная отметка"
  if (/атмосфера|atmosphere/i.test(allHeaders) || /высотн.*отметк/i.test(allHeaders)) return "nodes";
  if (/идентификатор вершин/i.test(allHeaders) && !/начальн|выработ/i.test(allHeaders)) return "nodes";
  if (/начальн|конечн|выработ|excavat|начал.*верш|ид.*выраб/i.test(allHeaders)) return "excavations";

  // Fallback по имени файла (приоритет: специфичные → общие)
  const fn = filename.toLowerCase();
  if (/fan|вентилят|source|тяг/.test(fn)) return "fans";
  if (/bulkhead|перемычк|jumper/.test(fn)) return "bulkheads";
  if (/position|позиц/.test(fn)) return "positions";
  if (/node|вершин|узл/.test(fn)) return "nodes";
  if (/excavat|выработ|tunnel/.test(fn)) return "excavations";

  return "unknown";
}

// ── Парсинг отдельных файлов ──────────────────────────────────────────────────

interface RawNode { id: string; x: number; y: number; z: number; isAtm: boolean }
interface RawBranch {
  id: string; fromId: string; toId: string; name: string;
  length: number; typeName: string; area: number; perimeter: number;
  flow: number; resistance: number; layer: string;
  /**
   * ID позиции ПЛА из столбца «Идентификатор позиции» файла выработок.
   * Вентиляция 2.0 хранит привязку именно ЗДЕСЬ, а не в файле позиций:
   * у позиции своего списка выработок нет. Раньше столбец не читался, и
   * позиции приходили без единой привязанной выработки.
   */
  positionId: string;
}

// UUID или число — валидный ID строки данных
function isDataId(s: string): boolean {
  const t = s.trim().replace(/"/g, "").replace(/^\{|\}$/g, "").trim();
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(t) || /^\d+$/.test(t);
}

function cleanId(s: string): string {
  return s.trim().replace(/"/g, "").replace(/^\{|\}$/g, "").trim();
}

function parseNodesFile(lines: string[], sep: string): RawNode[] {
  const result: RawNode[] = [];
  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, ""));
    if (cols.length < 3) continue;
    const id = cols[0].trim();
    if (!isDataId(id)) continue;  // пропускаем заголовки
    result.push({
      id: cleanId(id),
      x: parseNum(cols[1]),
      y: parseNum(cols[2]),
      z: parseNum(cols[3]),
      isAtm: /да|yes|true|1/i.test(cols[4] ?? ""),
    });
  }
  return result;
}

// Парсит число включая научную нотацию с запятой: "5,77E-05" → 0.0000577
function parseNumSci(s: string | undefined): number {
  if (!s) return 0;
  // Заменяем запятую на точку в мантиссе, но не в экспоненте
  const normalized = s.trim().replace(/"/g, "").replace(/,(?=\d|E|e)/g, ".");
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

function parseExcavationsFile(lines: string[], sep: string, headerOut?: { resHeader: string }): RawBranch[] {
  const result: RawBranch[] = [];
  let headerFound = false;
  const colIdx = { id:0, from:1, to:2, name:3, len:4, type:5, area:6, perim:7, flow:8, res:9, layer:10, position:-1 };

  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, "").trim());
    if (cols.length < 3) continue;

    const firstCell = cols[0];
    if (!isDataId(firstCell)) {
      // Это заголовок — определяем индексы колонок
      if (!headerFound) {
        const ci = (pat: RegExp) => cols.findIndex(c => pat.test(c.toLowerCase()));
        const idC    = ci(/идентификатор выработ|^ид выраб|^id/);
        const fromC  = ci(/начального|начальн|нач.*узл|from|start/);
        const toC    = ci(/конечного|конечн|кон.*узл|to\b|end/);
        const nameC  = ci(/название|назван|name/);
        const lenC   = ci(/длина|длин|length/);
        const typeC  = ci(/тип выраб|^тип|type/);
        const areaC  = ci(/площадь|сечени|area/);
        const perimC = ci(/периметр|perim/);
        const flowC  = ci(/расход|flow/);
        const resC   = ci(/сопротивл|resist/);
        const layerC = ci(/слой|layer/);
        // Привязка выработки к позиции ПЛА — «Идентификатор позиции».
        const posC   = ci(/идентификатор позиц|^ид позиц|position id|позиц/);
        if (posC >= 0) colIdx.position = posC;
        if (idC >= 0) colIdx.id = idC;
        if (fromC >= 0) colIdx.from = fromC;
        if (toC >= 0) colIdx.to = toC;
        if (nameC >= 0) colIdx.name = nameC;
        if (lenC >= 0) colIdx.len = lenC;
        if (typeC >= 0) colIdx.type = typeC;
        if (areaC >= 0) colIdx.area = areaC;
        if (perimC >= 0) colIdx.perim = perimC;
        if (flowC >= 0) colIdx.flow = flowC;
        if (resC >= 0) colIdx.res = resC;
        if (layerC >= 0) colIdx.layer = layerC;
        // Запоминаем подпись колонки R — по ней определяются единицы измерения
        if (headerOut && resC >= 0) headerOut.resHeader = cols[resC] ?? "";
        headerFound = true;
      }
      continue;
    }

    result.push({
      id:         cleanId(firstCell),
      fromId:     cleanId(cols[colIdx.from] ?? ""),
      toId:       cleanId(cols[colIdx.to] ?? ""),
      name:       cols[colIdx.name] ?? "",
      length:     parseNumSci(cols[colIdx.len]),
      typeName:   cols[colIdx.type] ?? "",
      area:       parseNumSci(cols[colIdx.area]),
      perimeter:  parseNumSci(cols[colIdx.perim]),
      flow:       parseNumSci(cols[colIdx.flow]),
      resistance: parseNumSci(cols[colIdx.res]),
      layer:      cols[colIdx.layer] || "Выработки",
      positionId: colIdx.position >= 0 ? cleanId(cols[colIdx.position] ?? "") : "",
    });
  }
  return result;
}

// ── Парсинг файла вентиляторов ────────────────────────────────────────────────

/**
 * Приводит тип источника тяги из файла к названию вентилятора.
 * Вентиляция 2.0 пишет служебные слова: main — главная вентиляторная
 * установка, simple/local — вспомогательный (местный) вентилятор.
 * Число (например «0.2») — это ошибочно считанное смещение, не имя.
 */
export function fanNameFromType(raw: string): string {
  const t = (raw ?? "").trim();
  if (!t) return "Вентилятор";
  // Чистое число — это не название (столбец смещения)
  if (/^-?[\d.,]+%?$/.test(t)) return "Вентилятор";
  const l = t.toLowerCase();
  if (/^main$|главн|гву/.test(l)) return "ГВУ";
  if (/^simple$|^local$|местн|вспомогат|впу/.test(l)) return "Вентилятор";
  return t;
}

/** Вид установки по типу источника тяги из файла. */
export function fanTypeFromRaw(raw: string): "ГВУ" | "ВВУ" | "ВМП" | undefined {
  const l = (raw ?? "").trim().toLowerCase();
  if (!l || /^-?[\d.,]+%?$/.test(l)) return undefined;
  if (/^main$|главн|гву/.test(l)) return "ГВУ";
  if (/^simple$|^local$|местн|вмп/.test(l)) return "ВМП";
  return undefined;
}

function parseFansFile(lines: string[], sep: string): RawFan[] {
  const result: RawFan[] = [];
  const colIdx = { branchId: 0, name: 1, pressure: 2, flow: 3 };
  let headerFound = false;

  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, "").trim());
    if (cols.length < 2) continue;

    if (!isDataId(cols[0])) {
      if (!headerFound) {
        const ci = (pat: RegExp) => cols.findIndex(c => pat.test(c.toLowerCase()));
        const brC  = ci(/выработ|branch|ид.*выраб|id.*excav/);
        // Название/тип источника тяги. Столбец «Смещение источника тяги, %»
        // исключаем явно: иначе именем вентилятора становилось число 0.2
        const nmC  = cols.findIndex(c => {
          const t = c.toLowerCase();
          if (/смещен|offset|%/.test(t)) return false;
          return /назван|имя|name|вентилят|тип.*тяг|тип.*источник/.test(t);
        });
        const prC  = ci(/напор|давлен|pressure|депрессия/);
        const flC  = ci(/расход|flow|подача/);
        if (brC >= 0) colIdx.branchId = brC;
        if (nmC >= 0) colIdx.name = nmC;
        if (prC >= 0) colIdx.pressure = prC;
        if (flC >= 0) colIdx.flow = flC;
        headerFound = true;
      }
      continue;
    }

    const branchId = cleanId(cols[colIdx.branchId] ?? "");
    if (!branchId) continue;
    const rawType = cols[colIdx.name] ?? "";
    result.push({
      branchId,
      name: fanNameFromType(rawType),
      pressure: parseNumSci(cols[colIdx.pressure]),
      flow: parseNumSci(cols[colIdx.flow]),
      fanType: fanTypeFromRaw(rawType),
    });
  }
  return result;
}

function parseBulkheadsFile(lines: string[], sep: string): RawBulkhead[] {
  const result: RawBulkhead[] = [];
  let headerFound = false;
  const colIdx = { branchId: 0, typeName: 1, rKmu: 2, airPerm: 3 };

  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, "").trim());
    if (cols.length < 2) continue;

    if (!isDataId(cols[0])) {
      if (!headerFound) {
        const ci = (pat: RegExp) => cols.findIndex(c => pat.test(c.toLowerCase()));
        const brC  = ci(/выработ|branch|ид.*выраб|id.*excav/);
        const tyC  = ci(/тип.*перем|назван|name|тип/);
        const rC   = ci(/сопротивл|resist|кмюрг|кмю/);
        const apC  = ci(/воздухо|air.*perm|утечк/);
        if (brC >= 0) colIdx.branchId = brC;
        if (tyC >= 0) colIdx.typeName = tyC;
        if (rC  >= 0) colIdx.rKmu = rC;
        if (apC >= 0) colIdx.airPerm = apC;
        headerFound = true;
      }
      continue;
    }

    const branchId = cleanId(cols[colIdx.branchId] ?? "");
    if (!branchId) continue;
    result.push({
      branchId,
      typeName: cols[colIdx.typeName] ?? "",
      rKmu: parseNumSci(cols[colIdx.rKmu]),
      airPerm: parseNumSci(cols[colIdx.airPerm]),
    });
  }
  return result;
}

/**
 * Приводит цвет из CSV к виду «#rrggbb».
 *
 * В файлах встречаются разные записи цвета, поэтому понимаем все ходовые:
 *   «#c53030», «c53030», «#C53» (короткая форма), «197,48,48» и «rgb(197,48,48)».
 * Всё, что распознать не удалось, отдаём пустой строкой — вызывающий код
 * подберёт цвет сам.
 */
function parseCsvColor(raw: string): string {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "";
  const hex = s.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  // Вентиляция 2.0 пишет цвет восемью знаками — впереди прозрачность
  // (#00FFFF00). РАНЬШЕ такой цвет не распознавался, и всем позициям
  // доставался случайный из палитры вместо цвета из файла.
  if (/^[0-9a-f]{8}$/.test(hex)) return `#${hex.slice(2)}`;
  // Короткая форма #abc → #aabbcc
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  // Формат «197,48,48» или «rgb(197, 48, 48)»
  const nums = s.match(/\d{1,3}/g);
  if (nums && nums.length >= 3) {
    const [r, g, b] = nums.slice(0, 3).map(n => Math.max(0, Math.min(255, parseInt(n, 10))));
    const h = (v: number) => v.toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  return "";
}

function parsePositionsFile(lines: string[], sep: string): RawPosition[] {
  const result: RawPosition[] = [];
  let headerFound = false;
  const colIdx = { id: 0, number: 1, name: 2, posType: 3, accType: 4, x: 5, y: 6, z: 7, branches: 8, color: -1 };

  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, "").trim());
    if (cols.length < 2) continue;

    if (!isDataId(cols[0])) {
      if (!headerFound) {
        const ci = (pat: RegExp) => cols.findIndex(c => pat.test(c.toLowerCase()));
        const idC  = ci(/^ид|^id/);
        const nmC  = ci(/номер|number|num|№/);
        const naC  = ci(/назван|name/);
        const ptC  = ci(/тип позиц|position type|тип/);
        const atC  = ci(/авари|accident/);
        const xC   = ci(/^x$|коорд.*x|x.*коорд/);
        const yC   = ci(/^y$|коорд.*y|y.*коорд/);
        // «Координата Z, м» раньше не распознавалась (шаблон требовал Z ПЕРЕД
        // словом «коорд»), из-за чего высотная отметка позиций при импорте
        // терялась и все позиции ложились на Z=0.
        const zC   = ci(/^z$|высот|отметк|z.*коорд|коорд.*z/);
        const brC  = ci(/выработ|branch|список/);
        // «Цвет границы» / «Цвет» / «color» — цвет маркера позиции.
        const clC  = ci(/цвет|color/);
        if (idC  >= 0) colIdx.id = idC;
        if (nmC  >= 0) colIdx.number = nmC;
        if (naC  >= 0) colIdx.name = naC;
        if (ptC  >= 0) colIdx.posType = ptC;
        if (atC  >= 0) colIdx.accType = atC;
        if (xC   >= 0) colIdx.x = xC;
        if (yC   >= 0) colIdx.y = yC;
        if (zC   >= 0) colIdx.z = zC;
        if (brC  >= 0) colIdx.branches = brC;
        if (clC  >= 0) colIdx.color = clC;
        headerFound = true;
      }
      continue;
    }

    const id = cleanId(cols[colIdx.id] ?? "");
    if (!id) continue;
    // Список выработок может быть через запятую или пробел в одной ячейке
    const branchRaw = cols[colIdx.branches] ?? "";
    const branchIds = branchRaw
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    result.push({
      id,
      number: Math.round(parseNum(cols[colIdx.number])) || 0,
      name: cols[colIdx.name] ?? "",
      positionType: cols[colIdx.posType] ?? "",
      accidentType: cols[colIdx.accType] ?? "",
      x: parseNum(cols[colIdx.x]),
      y: parseNum(cols[colIdx.y]),
      z: parseNum(cols[colIdx.z]),
      branchIds,
      borderColor: colIdx.color >= 0 ? parseCsvColor(cols[colIdx.color] ?? "") : "",
    });
  }
  return result;
}

// ── Восстановление горизонтов из столбца «Слой выработки» ────────────────────
//
// В CSV слой хранится ПРОСТЫМ ТЕКСТОМ («КТВР +390/+130»), без отметки и цвета.
// Поэтому: собираем уникальные названия → создаём по горизонту на каждое →
// проставляем ветвям horizonId. Отметку z считаем как среднюю по узлам
// выработок слоя (у «КТВР +390/+130» получится реальная глубина, а не 0).
//
// ВАЖНО: функция МЕНЯЕТ переданные ветви (проставляет horizonId) — это
// осознанно, ветви только что созданы импортом и никому ещё не отданы.
//
// Служебные значения («Выработки» — заглушка парсера, пустая строка) слоями
// не считаем, иначе на схеме появился бы мусорный горизонт.
function buildHorizonsFromLayers(
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

// ── Сборка результата ─────────────────────────────────────────────────────────

function buildResult(
  rawNodes: RawNode[],
  rawBranches: RawBranch[],
  rawFans: RawFan[],
  rawBulkheads: RawBulkhead[],
  rawPositions: RawPosition[],
  warnings: string[],
  debug: string[],
  resistanceUnit: "kmu" | "si" = "kmu"
): CsvImportResult {
  const branchOriginalIdMap: Record<string, string> = {};
  const ts = Date.now();
  const nodeMap = new Map<string, TopoNode>();
  let nodesWithZ = 0;

  for (const rn of rawNodes) {
    if (rn.z !== 0) nodesWithZ++;
    // Сохраняем исходный числовой номер узла из АэроСети без изменений
    // Если ID — число, используем его напрямую; если UUID — берём последние цифры
    const origNum = rn.id.includes("-")
      ? rn.id.replace(/[^0-9]/g, "").slice(-4) || rn.id.slice(-4)
      : rn.id.replace(/^0+/, "") || "0"; // убираем ведущие нули
    nodeMap.set(rn.id, makeNode(`N${ts}_${rn.id}`, {
      x: Math.round(rn.x * 10) / 10,
      y: Math.round(rn.y * 10) / 10,
      z: Math.round(rn.z * 10) / 10,
      number: origNum,
      name: "",
      atmosphereLink: rn.isAtm,
    }));
  }

  // Определяем «нулевые» узлы — те у кого x=0 и y=0, но есть хотя бы один узел с ненулевыми координатами
  // Такие узлы — скорее всего не загружены из positions-файла и дают длинные линии к нулю
  const hasRealCoords = [...nodeMap.values()].some(n => n.x !== 0 || n.y !== 0);
  const isZeroNode = (n: TopoNode) => hasRealCoords && n.x === 0 && n.y === 0;

  // Вычисляем медианную длину ветви (для фильтрации «призрачных» ветвей)
  // Ветви у которых длина в 20+ раз больше медианы — скорее всего идут в нулевую точку
  const allRawLengths: number[] = rawBranches
    .map(rb => {
      const fn = nodeMap.get(rb.fromId);
      const tn = nodeMap.get(rb.toId);
      if (!fn || !tn) return 0;
      return Math.sqrt((tn.x-fn.x)**2 + (tn.y-fn.y)**2);
    })
    .filter(l => l > 0)
    .sort((a, b) => a - b);
  const medianLen = allRawLengths.length > 0
    ? allRawLengths[Math.floor(allRawLengths.length / 2)]
    : Infinity;
  const maxAllowedScreenLen = Math.max(medianLen * 30, 5000); // порог: 30× медиана

  const branches: TopoBranch[] = [];
  const seen = new Set<string>();
  let bi = 0;

  for (const rb of rawBranches) {
    if (!rb.fromId || !rb.toId) continue;
    const fromNode = nodeMap.get(rb.fromId);
    const toNode   = nodeMap.get(rb.toId);
    if (!fromNode || !toNode) continue;
    // Пропускаем ветви у которых один из узлов не имеет реальных координат
    if (isZeroNode(fromNode) || isZeroNode(toNode)) continue;
    // Пропускаем «призрачные» ветви — экстремально длинные относительно медианы
    const screenDist = Math.sqrt((toNode.x-fromNode.x)**2 + (toNode.y-fromNode.y)**2);
    if (screenDist > maxAllowedScreenLen) continue;

    const key = `${[rb.fromId, rb.toId].sort().join("_")}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let shape: "round" | "rect" | "arch" = "rect";
    if (/круг|round|цилиндр/i.test(rb.typeName)) shape = "round";
    else if (/арк|arch/i.test(rb.typeName)) shape = "arch";

    const dh = rb.perimeter > 0 ? Math.round(4 * rb.area / rb.perimeter * 1000) / 1000 : 0;
    const dz = Math.abs(toNode.z - fromNode.z);
    const dist3d = Math.sqrt((toNode.x-fromNode.x)**2+(toNode.y-fromNode.y)**2+(toNode.z-fromNode.z)**2);
    const realLen = rb.length > 0 ? rb.length : Math.round(dist3d * 10) / 10;
    const realAngle = realLen > 0 ? Math.round(Math.asin(Math.min(1, dz/realLen)) * 180/Math.PI * 10)/10 : 0;

    const newBranchId = `B${ts}_${bi++}`;
    branchOriginalIdMap[rb.id] = newBranchId;
    // Перевод R из единиц CSV в кМюрг (для manualR):
    // "kmu" (кмю, АэроСеть): уже в кМюрг → берём как есть
    // "si": в Н·с²/м⁸ → делим на 9.81 чтобы перевести в кМюрг
    const importedR = rb.resistance > 0
      ? rb.resistance * (resistanceUnit === "kmu" ? 1 : 1 / 9.81)
      : 0;

    // Определяем тип выработки из CSV
    const branchType = rb.name || rb.typeName || "Выработка";
    // Если R не задан — используем alpha с типовым коэффициентом по форме сечения (вместо нуля)
    // Прямоугольник/свод ≈ 9–20 ×10⁻⁴ Нс²/м⁴, круглый ≈ 6–15
    const defaultAlpha = shape === "round" ? 9 : shape === "arch" ? 15 : 12;

    branches.push(makeBranch(newBranchId, fromNode.id, toNode.id, {
      type: branchType,
      // Поля name у ветви НЕТ — название выработки хранится в type
      // (branchType выше уже собран как «название → тип → Выработка»).
      layer: rb.layer,
      length: realLen, manualLength: rb.length > 0,
      angle: realAngle, manualAngle: false,
      area: rb.area > 0 ? rb.area : 0,
      perimeter: rb.perimeter > 0 ? rb.perimeter : 0,
      dh: dh > 0 ? dh : 0,
      flow: rb.flow,
      // Режим сопротивления:
      //   R задан → manual (берём из CSV)
      //   R = 0, S задана → alpha с дефолтным коэффициентом (пересчитается из геометрии)
      //   R = 0, S не задана → alpha (R будет 0 пока не задана геометрия)
      resistanceMode: importedR > 0 ? "manual" : "alpha",
      manualR: importedR,
      resistance: importedR,
      alphaCoef: importedR > 0 ? 9 : defaultAlpha,
      manualSection: rb.area > 0, shape,
    }));
  }

  // Горизонты (слои схемы) — восстанавливаем из столбца «Слой выработки»
  // и сразу привязываем к ним ветви (см. buildHorizonsFromLayers).
  const horizons = buildHorizonsFromLayers(branches, nodeMap.values(), ts, debug);

  // Убираем из результата узлы без реальных координат (они дают точки в нуле)
  const resultNodes = [...nodeMap.values()].filter(n => !isZeroNode(n));

  debug.push(`Итого: узлов=${resultNodes.length} (отфильтровано нулевых: ${nodeMap.size - resultNodes.length}), ветвей=${branches.length}, с Z≠0=${nodesWithZ}`);

  if (rawNodes.length > 0 && resultNodes.length === 0) warnings.push("⚠ Узлы не распознаны.");
  if (rawBranches.length > 0 && branches.length === 0)
    warnings.push("⚠ Ветви не созданы — возможно ID узлов не совпадают.");

  // Транслируем исходные ID выработок → сгенерированные ID ветвей для всех типов
  // Используем нормализованный lookup (lowercase + trim) для устойчивости к регистру/пробелам
  const normalizedMap: Record<string, string> = {};
  for (const [origId, newId] of Object.entries(branchOriginalIdMap)) {
    normalizedMap[origId.toLowerCase().trim()] = newId;
  }
  const lookupBranchId = (id: string) =>
    branchOriginalIdMap[id]
    ?? normalizedMap[id.toLowerCase().trim()]
    ?? id;

  const fans: RawFan[] = rawFans.map(f => ({
    ...f,
    branchId: lookupBranchId(f.branchId),
  }));
  const bulkheads: RawBulkhead[] = rawBulkheads.map(bk => ({
    ...bk,
    branchId: lookupBranchId(bk.branchId),
  }));
  // ── Привязка позиций ПЛА к выработкам ──────────────────────────────────────
  // Вентиляция 2.0 хранит связь в файле ВЫРАБОТОК (столбец «Идентификатор
  // позиции»), а не в файле позиций — там списка выработок нет вовсе.
  // Собираем обратный указатель: позиция → её выработки.
  const byPosition = new Map<string, string[]>();
  for (const rb of rawBranches) {
    const pid = (rb.positionId ?? "").trim();
    if (!pid || pid === "0") continue;
    const newId = branchOriginalIdMap[rb.id];
    if (!newId) continue;               // выработка отсеяна (нулевые координаты)
    const arr = byPosition.get(pid);
    if (arr) arr.push(newId); else byPosition.set(pid, [newId]);
  }

  // Координаты выработок — чтобы поставить позицию рядом с её выработками.
  const branchCenter = new Map<string, { x: number; y: number; z: number }>();
  const nodeById = new Map(resultNodes.map(n => [n.id, n]));
  for (const b of branches) {
    const a = nodeById.get(b.fromId), c = nodeById.get(b.toId);
    if (!a || !c) continue;
    branchCenter.set(b.id, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 });
  }

  let posLinked = 0, posPlaced = 0;
  const positions: RawPosition[] = rawPositions.map(p => {
    // Список выработок: из файла позиций (если он там есть) либо собранный
    // из файла выработок.
    const own = p.branchIds.map(bid => lookupBranchId(bid)).filter(Boolean);
    const linked = own.length > 0 ? own : (byPosition.get(p.id) ?? []);
    if (linked.length > 0) posLinked++;

    // Координаты. Вентиляция 2.0 выгружает позиции с X=Y=Z=0 — привязка к
    // месту хранится только через выработки. Раньше такие позиции ложились
    // в начало координат и оказывались далеко в стороне от схемы; теперь
    // ставим позицию в середину её выработок.
    let { x, y, z } = p;
    if (x === 0 && y === 0 && linked.length > 0) {
      const pts = linked.map(id => branchCenter.get(id)).filter(Boolean) as { x: number; y: number; z: number }[];
      if (pts.length > 0) {
        x = Math.round((pts.reduce((s, q) => s + q.x, 0) / pts.length) * 10) / 10;
        y = Math.round((pts.reduce((s, q) => s + q.y, 0) / pts.length) * 10) / 10;
        if (z === 0) z = Math.round((pts.reduce((s, q) => s + q.z, 0) / pts.length) * 10) / 10;
        posPlaced++;
      }
    }
    return { ...p, branchIds: linked, x, y, z };
  });

  if (positions.length > 0) {
    debug.push(`Позиций ПЛА: ${positions.length}, с привязанными выработками: ${posLinked}, размещено по выработкам: ${posPlaced}`);
    const noLink = positions.length - posLinked;
    if (noLink > 0) {
      warnings.push(`Позиций без привязанных выработок: ${noLink} — расставьте их на схеме вручную.`);
    }
  }

  if (bulkheads.length > 0) {
    const mapped = bulkheads.filter(bk => bk.branchId.startsWith("B"));
    debug.push(`Перемычек: ${bulkheads.length}, смаппировано на ветви: ${mapped.length}`);
    if (mapped.length === 0) debug.push(`! Маппинг не сработал. Пример branchId: "${rawBulkheads[0]?.branchId}", ключи map: "${Object.keys(branchOriginalIdMap).slice(0,2).join('", "')}"`);
  }
  if (positions.length > 0) debug.push(`Позиций после маппинга: ${positions.length}`);

  // Включает ли R выработки вклад её перемычек (сравниваем по исходным ID).
  const rIncludesBk = detectResistanceIncludesBulkheads(
    rawBranches.map(rb => ({ id: rb.id, resistance: rb.resistance })),
    rawBulkheads,
  );
  if (rIncludesBk) {
    debug.push("Сопротивление выработок уже включает перемычки (суммарное) — вклад перемычек повторно не добавляется");
    warnings.push(
      "Сопротивление выработок в файле указано суммарное — вместе с перемычками. " +
      "Перемычки нанесены на схему как обозначения, но их сопротивление не прибавляется повторно."
    );
  }

  return {
    nodes: resultNodes, branches, fans, bulkheads, positions, horizons, branchOriginalIdMap, warnings,
    resistanceIncludesBulkheads: rIncludesBk,
    stats: { nodes: resultNodes.length, branches: branches.length, nodesWithZ, fans: fans.length, bulkheads: bulkheads.length, positions: positions.length, horizons: horizons.length },
    debug: debug.join("\n"),
  };
}

// ── Главная функция: один или несколько файлов ────────────────────────────────

export interface CsvFileInput { name: string; content: string }

export interface CsvImportOptions {
  /**
   * Единицы R в CSV:
   * "kmu"  = кмю (×10⁻³ Нс²/м⁸, формат АэроСети)
   * "si"   = Нс²/м⁸ (SI)
   * "auto" = автодетект по медианному значению (по умолчанию)
   */
  resistanceUnit?: "kmu" | "si" | "auto";
}

/**
 * Автоопределение единиц R по ненулевым значениям:
 * — Медиана < 0.5  → скорее всего кмю (типичные выработки: 0.001–0.5 кмю)
 * — Медиана ≥ 0.5  → уже Нс²/м⁸ (или аномально крупные кмю, но маловероятно)
 *
 * Логика: в АэроСети R типичной выработки 0.01–100 кмю.
 * В SI: 0.00001–0.1 Нс²/м⁸. Граница медианы 0.5 разделяет эти диапазоны надёжно.
 */
/**
 * Единицы R по подписи колонки — самый надёжный признак, ведь программа
 * сама пишет их в шапке: «Сопротивление выработки, кМюрг».
 * Возвращает null, если в заголовке единиц нет (тогда решаем по числам).
 *
 * Важно: в Вентиляции 2.0 сопротивления в кМюрг очень мелкие (медиана ~5e-5),
 * поэтому определять единицы по величине чисел нельзя — см. detectResistanceUnit.
 */
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

export function parseCsvMulti(files: CsvFileInput[], opts: CsvImportOptions = {}): CsvImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];
  const allRawNodes: RawNode[] = [];
  const allRawBranches: RawBranch[] = [];
  const allRawFans: RawFan[] = [];
  const allRawBulkheads: RawBulkhead[] = [];
  const allRawPositions: RawPosition[] = [];
  // Подпись колонки сопротивления — по ней надёжно определяются единицы
  const resHeaderOut = { resHeader: "" };

  for (const file of files) {
    const lines = normalizeLines(file.content);
    if (lines.length === 0) continue;
    const sep = detectSep(lines.find(l => l.includes(";") || l.includes(",")) ?? "");
    const header5 = lines.slice(0, 2).join(" | ").slice(0, 120);
    const fileType = detectFileType(file.name, lines.slice(0, 5).join("\n"));
    debug.push(`Файл: ${file.name} → тип: ${fileType}, строк: ${lines.length}, sep: "${sep}"`);
    debug.push(`  заголовок: ${header5}`);

    if (fileType === "nodes") {
      const nodes = parseNodesFile(lines, sep);
      debug.push(`  Узлов: ${nodes.length}`);
      allRawNodes.push(...nodes);
    } else if (fileType === "excavations") {
      const branches = parseExcavationsFile(lines, sep, resHeaderOut);
      debug.push(`  Выработок: ${branches.length}`);
      allRawBranches.push(...branches);
    } else if (fileType === "unknown") {
      const nodes = parseNodesFile(lines, sep);
      const branches = parseExcavationsFile(lines, sep, resHeaderOut);
      if (nodes.length > branches.length) {
        debug.push(`  Авто→узлы: ${nodes.length}`);
        allRawNodes.push(...nodes);
      } else if (branches.length > 0) {
        debug.push(`  Авто→ветви: ${branches.length}`);
        allRawBranches.push(...branches);
      } else {
        warnings.push(`Файл "${file.name}" не распознан.`);
      }
    } else if (fileType === "fans") {
      const fans = parseFansFile(lines, sep);
      debug.push(`  Вентиляторов: ${fans.length}`);
      allRawFans.push(...fans);
    } else if (fileType === "bulkheads") {
      const bulkheads = parseBulkheadsFile(lines, sep);
      debug.push(`  Перемычек: ${bulkheads.length}`);
      allRawBulkheads.push(...bulkheads);
    } else if (fileType === "positions") {
      const positions = parsePositionsFile(lines, sep);
      debug.push(`  Позиций: ${positions.length}`);
      allRawPositions.push(...positions);
    }
  }

  if (allRawNodes.length === 0 && allRawBranches.length === 0) {
    return {
      nodes: [], branches: [], fans: allRawFans,
      bulkheads: allRawBulkheads, positions: allRawPositions, horizons: [],
      branchOriginalIdMap: {},
      resistanceIncludesBulkheads: false,
      warnings: ["Файлы не содержат данных. Убедитесь что выбраны *-nodes.csv и *-excavations.csv из АэроСети."],
      stats: { nodes: 0, branches: 0, nodesWithZ: 0, fans: allRawFans.length, bulkheads: allRawBulkheads.length, positions: allRawPositions.length, horizons: 0 },
      debug: debug.join("\n"),
    };
  }

  // Определяем единицы R
  let rUnit: "kmu" | "si";
  const requestedUnit = opts.resistanceUnit ?? "auto";
  if (requestedUnit === "auto") {
    // 1) Сначала верим подписи колонки: программа сама пишет единицы в шапке.
    //    Это важнее величины чисел — в Вентиляции 2.0 сопротивления в кМюрг
    //    очень мелкие (медиана ~5e-5) и по ним файл ошибочно принимался за СИ,
    //    из-за чего все сопротивления занижались в 9.81 раза.
    const byHeader = resistanceUnitFromHeader(resHeaderOut.resHeader);
    if (byHeader) {
      rUnit = byHeader;
      debug.push(`Единицы R по заголовку "${resHeaderOut.resHeader}" → ${rUnit === "kmu" ? "кМюрг" : "СИ"}`);
    } else {
      // 2) Заголовок молчит — решаем по величине значений.
      const allR = allRawBranches.map(b => b.resistance).filter(r => r > 0);
      rUnit = detectResistanceUnit(allR);
      debug.push(`Автодетект единиц R: медиана=${allR.length > 0 ? [...allR].sort((a,b)=>a-b)[Math.floor(allR.length/2)].toFixed(6) : "н/д"} → ${rUnit === "kmu" ? "кМюрг" : "СИ"}`);
    }
  } else {
    rUnit = requestedUnit;
  }

  return buildResult(allRawNodes, allRawBranches, allRawFans, allRawBulkheads, allRawPositions, warnings, debug, rUnit);
}

// ── Импорт CSV из ПО Вентиляция 2.0 с настраиваемым маппингом столбцов ─────
// Столбцы нумеруются с 1 (как в интерфейсе ПО).
// Если столбец = 0 — поле не импортируется (не задано).

export interface Vent2ColMap {
  // Вершины (узлы)
  node_id: number;   // Ид вершины
  node_x: number;   // Координата X
  node_y: number;   // Координата Y
  node_z: number;   // Координата Z
  node_atm: number; // Атмосфера (столбец-флаг, 0 = нет)
  // Выработки
  id: number;        // Ид выработки
  from: number;      // Начальная вершина
  to: number;        // Конечная вершина
  name: number;      // Название (0 = не задано)
  length: number;    // Длина
  type: number;      // Тип
  area: number;      // Сечение
  perimeter: number; // Периметр
  flow: number;      // Расход
  resistance: number;// Сопротивление выработки
  sumR: number;      // Суммарное сопротивление (0 = не задано)
  layer: number;     // Слой
  /**
   * «Идентификатор позиции» в файле ВЫРАБОТОК. Именно здесь Вентиляция 2.0
   * хранит привязку выработки к позиции ПЛА — в файле позиций своего списка
   * выработок нет. 0 = столбца нет.
   */
  br_position: number;
  // Перемычки
  bk_branchId: number;  // Ид выработки перемычки
  bk_offset: number;    // Смещение
  bk_type: number;      // Тип перемычки
  bk_resistance: number;// Сопротивление
  // Источники тяги (вентиляторы)
  fan_branchId: number; // Ид выработки вентилятора
  fan_offset: number;   // Смещение
  fan_type: number;     // Тип источника тяги (main / simple)
  fan_pressure: number; // Напор
  // Позиции ПЛА
  pos_id: number;       // Ид позиции
  pos_x: number;        // Координата X
  pos_y: number;        // Координата Y
  pos_z: number;        // Координата Z
  pos_number: number;   // Номер позиции
  pos_name: number;     // Название позиции
  pos_type: number;     // Тип позиции (безреверсивная / реверсивная)
  pos_accident: number; // Вид аварии
  pos_color: number;    // Цвет границы маркера
  pos_branches: number; // Список привязанных выработок
}

export const VENT2_DEFAULT_COLS: Vent2ColMap = {
  node_id: 1, node_x: 2, node_y: 3, node_z: 4, node_atm: 5,
  id: 1, from: 2, to: 3, name: 4, length: 5, type: 6,
  // В выгрузке Вентиляции 2.0 столбец 10 — «Сопротивление выработки, кМюрг»,
  // и оно уже суммарное (включает перемычки). Поэтому по умолчанию читаем его
  // как суммарное, а отдельный столбец собственного R не задан.
  area: 7, perimeter: 8, flow: 9, resistance: 0, sumR: 10, layer: 11,
  // Столбец 12 — «Идентификатор позиции»: связь выработки с позицией ПЛА.
  br_position: 12,
  bk_branchId: 1, bk_offset: 2, bk_type: 3, bk_resistance: 4,
  fan_branchId: 1, fan_offset: 2, fan_type: 3, fan_pressure: 4,
  // Порядок по умолчанию — как в выгрузке Вентиляции 2.0:
  // Ид; X; Y; Z; Номер; Название; Тип позиции; Цвет границы.
  // Вида аварии и списка выработок в её файле НЕТ: привязка берётся из
  // столбца «Идентификатор позиции» файла выработок (br_position).
  pos_id: 1, pos_x: 2, pos_y: 3, pos_z: 4, pos_number: 5,
  pos_name: 6, pos_type: 7, pos_accident: 0, pos_color: 8, pos_branches: 0,
};

export interface Vent2ParseOptions {
  cols: Vent2ColMap;
  sep: ";" | "," | "\t";
  resistanceUnit: "kmu" | "si" | "auto";
  hasNodes: boolean;
  nodeContent?: string;
  hasBulkheads: boolean;
  bulkheadContent?: string;
  hasFans: boolean;
  fanContent?: string;
  hasPositions: boolean;
  positionContent?: string;
}

function col(row: string[], idx: number): string {
  if (idx <= 0) return "";
  // Значения в CSV часто взяты в кавычки («"main"», «"Да"») — снимаем их,
  // иначе сравнения с текстом и названия приходят вместе с кавычками.
  return (row[idx - 1] ?? "").trim().replace(/^"|"$/g, "").trim();
}

export function parseVent2Csv(
  branchContent: string,
  opts: Vent2ParseOptions
): CsvImportResult {
  const { cols, sep, resistanceUnit } = opts;
  const warnings: string[] = [];
  const debug: string[] = [];
  const ts = Date.now();

  // ── Парсинг вершин (узлов) из отдельного файла ───────────────────────────
  // Карта: ID вершины → { x, y, z, atmosphereLink }
  const nodeCoordMap = new Map<string, { x: number; y: number; z: number; atm: boolean }>();

  if (opts.hasNodes && opts.nodeContent) {
    const ndLines = opts.nodeContent
      .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      .split("\n").map(l => l.trim()).filter(l => l.length > 0);
    // Пропускаем заголовок
    let ndStart = 0;
    if (ndLines.length > 0) {
      const first = ndLines[0].split(sep)[0].trim();
      if (isNaN(parseFloat(first.replace(",", ".")))) ndStart = 1;
    }
    for (let i = ndStart; i < ndLines.length; i++) {
      const row = ndLines[i].split(sep);
      const nid = col(row, cols.node_id);
      if (!nid) continue;
      const x   = cols.node_x > 0 ? parseNum(col(row, cols.node_x)) : 0;
      const y   = cols.node_y > 0 ? parseNum(col(row, cols.node_y)) : 0;
      const z   = cols.node_z > 0 ? parseNum(col(row, cols.node_z)) : 0;
      const atmRaw = cols.node_atm > 0 ? col(row, cols.node_atm).toLowerCase() : "";
      const atm = atmRaw === "да" || atmRaw === "yes" || atmRaw === "true" || atmRaw === "1";
      nodeCoordMap.set(nid, { x, y, z, atm });
    }
    debug.push(`Вершин из файла: ${nodeCoordMap.size}`);
  }

  // ── Парсинг строк выработок ──────────────────────────────────────────────
  const brLines = branchContent
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // Пропускаем строку заголовка (если первый символ не число)
  let brStart = 0;
  if (brLines.length > 0) {
    const first = brLines[0].split(sep)[0].trim();
    if (isNaN(parseFloat(first.replace(",", ".")))) brStart = 1;
  }

  // Какой столбец сопротивления использовать.
  // Как в АэроСети: либо «Сопротивление выработки» (собственное, без перемычек),
  // либо «Суммарное сопротивление» (уже с перемычками). Если задано суммарное —
  // сопротивление перемычек нельзя прибавлять к ветви второй раз.
  const useSumR = cols.sumR > 0 && cols.resistance <= 0;
  const rColIdx = useSumR ? cols.sumR : cols.resistance;
  debug.push(useSumR
    ? `Сопротивление: столбец ${rColIdx} — суммарное (перемычки уже учтены)`
    : `Сопротивление: столбец ${rColIdx} — собственное сопротивление выработки`);

  // Собираем ID вершин из ветвей (для автораскладки если нет файла вершин)
  const nodeIdsFromBranches = new Set<string>();
  const rawBranches: Array<{
    id: string; from: string; to: string; name: string; length: number;
    type: string; area: number; perimeter: number; flow: number;
    resistance: number; layer: string; positionId: string;
  }> = [];

  for (let i = brStart; i < brLines.length; i++) {
    const row = brLines[i].split(sep);
    const id  = col(row, cols.id);
    const frm = col(row, cols.from);
    const to  = col(row, cols.to);
    if (!id || !frm || !to) continue;
    nodeIdsFromBranches.add(frm);
    nodeIdsFromBranches.add(to);
    rawBranches.push({
      id, from: frm, to,
      name:       cols.name      > 0 ? col(row, cols.name)      : "",
      length:     parseNum(col(row, cols.length)),
      type:       cols.type      > 0 ? col(row, cols.type)       : "",
      area:       parseNum(col(row, cols.area)),
      perimeter:  parseNum(col(row, cols.perimeter)),
      flow:       parseNum(col(row, cols.flow)),
      // Сопротивление берём из того столбца, который указан пользователем:
      // «Сопротивление выработки» (без перемычек) либо «Суммарное» (с ними).
      resistance: rColIdx > 0 ? parseNum(col(row, rColIdx)) : 0,
      layer:      cols.layer     > 0 ? col(row, cols.layer)      : "",
      positionId: cols.br_position > 0 ? cleanId(col(row, cols.br_position)) : "",
    });
  }
  debug.push(`Выработок: ${rawBranches.length}, вершин в ветвях: ${nodeIdsFromBranches.size}`);

  // ── Перевод R ────────────────────────────────────────────────────────────
  let rUnit: "kmu" | "si" = "si";
  if (resistanceUnit === "auto") {
    const allR = rawBranches.map(b => b.resistance).filter(r => r > 0);
    rUnit = detectResistanceUnit(allR);
  } else {
    rUnit = resistanceUnit;
  }

  // ── Создаём узлы ────────────────────────────────────────────────────────
  // Если есть файл вершин — используем реальные координаты.
  // Иначе — автораскладка по ID из ветвей.
  const nodeMap = new Map<string, TopoNode>();
  const hasCoords = nodeCoordMap.size > 0;

  // Объединяем ID: из файла вершин + из ветвей (на случай если какой-то узел не в файле)
  const allNodeIds = new Set([...nodeCoordMap.keys(), ...nodeIdsFromBranches]);
  const allNodeArr = [...allNodeIds];
  const gridCols   = Math.ceil(Math.sqrt(allNodeArr.length));

  allNodeArr.forEach((nid, i) => {
    const coord = nodeCoordMap.get(nid);
    let x: number, y: number, z: number, atm: boolean;
    if (coord) {
      x = coord.x; y = coord.y; z = coord.z; atm = coord.atm;
    } else {
      // Автораскладка для узлов без координат
      x = (i % gridCols) * 200;
      y = -Math.floor(i / gridCols) * 200;
      z = 0; atm = false;
    }
    nodeMap.set(nid, makeNode(`NV2_${ts}_${nid}`, {
      number: nid, name: nid, x, y, z,
      atmosphereLink: atm,
    }));
  });

  if (!hasCoords) {
    warnings.push("Файл вершин не загружен — координаты расставлены автоматически. Для получения реальной схемы загрузите файл вершин.");
  }
  debug.push(`Узлов создано: ${nodeMap.size} (${hasCoords ? "с координатами из файла" : "автораскладка"}`);

  // ── Создаём ветви ────────────────────────────────────────────────────────
  const branchOriginalIdMap: Record<string, string> = {};
  const branches: TopoBranch[] = [];
  let bi = 0;
  for (const rb of rawBranches) {
    const fn = nodeMap.get(rb.from);
    const tn = nodeMap.get(rb.to);
    if (!fn || !tn) { warnings.push(`Ветвь ${rb.id}: узлы не найдены`); continue; }
    const rNsm8 = rUnit === "kmu" ? rb.resistance * 9.81e-3 : rb.resistance;
    const brId = `BV2_${ts}_${bi++}`;
    branchOriginalIdMap[rb.id] = brId;
    branches.push(makeBranch(brId, fn.id, tn.id, {
      type:         rb.name || rb.type || rb.id,
      length:       rb.length,
      manualLength: rb.length > 0,
      area:         rb.area,
      perimeter:    rb.perimeter,
      manualSection: rb.area > 0,
      flow:         rb.flow,
      resistanceMode: rNsm8 > 0 ? "manual" : "surface",
      manualR:      rNsm8 > 0 ? rNsm8 / 9.81 : 0,
      resistance:   rNsm8,
      layer:        rb.layer,
    }));
  }

  // ── Перемычки ────────────────────────────────────────────────────────────
  const bulkheads: RawBulkhead[] = [];
  if (opts.hasBulkheads && opts.bulkheadContent) {
    const bkLines = opts.bulkheadContent
      .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      .split("\n").map(l => l.trim()).filter(l => l.length > 0);
    let bkStart = 0;
    if (bkLines.length > 0) {
      const f = bkLines[0].split(sep)[0].trim();
      if (isNaN(parseFloat(f.replace(",", ".")))) bkStart = 1;
    }
    for (let i = bkStart; i < bkLines.length; i++) {
      const row = bkLines[i].split(sep);
      const origId = col(row, cols.bk_branchId);
      const brId = branchOriginalIdMap[origId];
      if (!brId) continue;
      bulkheads.push({
        branchId: brId,
        typeName: cols.bk_type > 0 ? col(row, cols.bk_type) : "",
        rKmu: cols.bk_resistance > 0 ? parseNum(col(row, cols.bk_resistance)) : 0,
        airPerm: 0,
      });
    }
    debug.push(`Перемычек: ${bulkheads.length}`);
  }

  // ── Вентиляторы ──────────────────────────────────────────────────────────
  const fans: RawFan[] = [];
  if (opts.hasFans && opts.fanContent) {
    const fanLines = opts.fanContent
      .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      .split("\n").map(l => l.trim()).filter(l => l.length > 0);
    let fStart = 0;
    if (fanLines.length > 0) {
      const f = fanLines[0].split(sep)[0].trim();
      if (isNaN(parseFloat(f.replace(",", ".")))) fStart = 1;
    }
    for (let i = fStart; i < fanLines.length; i++) {
      const row = fanLines[i].split(sep);
      const origId = col(row, cols.fan_branchId);
      const brId = branchOriginalIdMap[origId];
      if (!brId) continue;
      // Тип источника тяги (main/simple) — столбец рядом со смещением
      const fanRawType = cols.fan_type > 0 ? col(row, cols.fan_type) : "";
      fans.push({
        branchId: brId,
        name: fanNameFromType(fanRawType),
        pressure: cols.fan_pressure > 0 ? parseNum(col(row, cols.fan_pressure)) : 0,
        flow: 0,
        fanType: fanTypeFromRaw(fanRawType),
      });
    }
    debug.push(`Вентиляторов: ${fans.length}`);
  }

  // ── Позиции ПЛА ──────────────────────────────────────────────────────────
  const positions: RawPosition[] = [];
  if (opts.hasPositions && opts.positionContent) {
    const posLines = opts.positionContent
      .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      .split("\n").map(l => l.trim()).filter(l => l.length > 0);
    let pStart = 0;
    if (posLines.length > 0) {
      // Заголовок определяем так же, как у перемычек/вентиляторов: если первая
      // ячейка не число — это шапка таблицы.
      const f = posLines[0].split(sep)[0].trim();
      if (isNaN(parseFloat(f.replace(",", ".")))) pStart = 1;
    }
    for (let i = pStart; i < posLines.length; i++) {
      const row = splitRow(posLines[i], sep).map(c => c.replace(/"/g, "").trim());
      const id = cleanId(col(row, cols.pos_id));
      if (!id) continue;
      // Список выработок в одной ячейке — через запятую или пробел.
      const brRaw = cols.pos_branches > 0 ? col(row, cols.pos_branches) : "";
      const branchIds = brRaw
        .split(/[,\s]+/)
        .map(x => x.trim())
        .filter(x => x.length > 0)
        // Переводим исходные ID выработок в сгенерированные — иначе привязка
        // позиции к ветви не найдётся (так же делается для перемычек/вент-ров).
        .map(x => branchOriginalIdMap[x] ?? x);
      positions.push({
        id,
        number: cols.pos_number > 0 ? Math.round(parseNum(col(row, cols.pos_number))) || 0 : 0,
        name: cols.pos_name > 0 ? col(row, cols.pos_name) : "",
        positionType: cols.pos_type > 0 ? col(row, cols.pos_type) : "",
        accidentType: cols.pos_accident > 0 ? col(row, cols.pos_accident) : "",
        x: cols.pos_x > 0 ? parseNum(col(row, cols.pos_x)) : 0,
        y: cols.pos_y > 0 ? parseNum(col(row, cols.pos_y)) : 0,
        z: cols.pos_z > 0 ? parseNum(col(row, cols.pos_z)) : 0,
        branchIds,
        borderColor: cols.pos_color > 0 ? parseCsvColor(col(row, cols.pos_color)) : "",
      });
    }

    // ── Привязка и размещение позиций ────────────────────────────────────
    // Вентиляция 2.0 хранит связь позиции с выработками в файле ВЫРАБОТОК
    // (столбец «Идентификатор позиции»), а сами позиции выгружает с
    // координатами 0,0,0. РАНЬШЕ этот столбец не читался: позиции приходили
    // без выработок и ложились в начало координат — далеко от схемы.
    const byPosition = new Map<string, string[]>();
    for (const rb of rawBranches) {
      const pid = (rb.positionId ?? "").trim();
      if (!pid || pid === "0") continue;
      const newId = branchOriginalIdMap[rb.id];
      if (!newId) continue;
      const arr = byPosition.get(pid);
      if (arr) arr.push(newId); else byPosition.set(pid, [newId]);
    }

    // Середина каждой выработки — чтобы поставить позицию на её место.
    // nodeMap хранит узлы по ИСХОДНОМУ id из файла, а ветвь ссылается уже на
    // сгенерированный — поэтому ищем по нему.
    const nodeById = new Map([...nodeMap.values()].map(n => [n.id, n]));
    const branchCenter = new Map<string, { x: number; y: number; z: number }>();
    for (const b of branches) {
      const a = nodeById.get(b.fromId), c = nodeById.get(b.toId);
      if (!a || !c) continue;
      branchCenter.set(b.id, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 });
    }

    let placedCnt = 0;
    for (const p of positions) {
      if (p.branchIds.length === 0) p.branchIds = byPosition.get(p.id) ?? [];
      if ((p.x !== 0 || p.y !== 0) || p.branchIds.length === 0) continue;
      const pts = p.branchIds
        .map(id => branchCenter.get(id))
        .filter(Boolean) as { x: number; y: number; z: number }[];
      if (pts.length === 0) continue;
      p.x = Math.round((pts.reduce((s, q) => s + q.x, 0) / pts.length) * 10) / 10;
      p.y = Math.round((pts.reduce((s, q) => s + q.y, 0) / pts.length) * 10) / 10;
      if (p.z === 0) p.z = Math.round((pts.reduce((s, q) => s + q.z, 0) / pts.length) * 10) / 10;
      placedCnt++;
    }

    const linked = positions.filter(p => p.branchIds.length > 0).length;
    debug.push(`Позиций: ${positions.length} (с привязкой к выработкам: ${linked}, размещено по выработкам: ${placedCnt})`);
    const noLink = positions.length - linked;
    if (noLink > 0) {
      warnings.push(`Позиций без привязанных выработок: ${noLink} — расставьте их на схеме вручную.`);
    }
  }

  // Горизонты (слои схемы) — восстанавливаем из столбца «Слой» и сразу
  // привязываем к ним ветви (та же логика, что и при импорте из АэроСети).
  const horizons = buildHorizonsFromLayers(branches, nodeMap.values(), ts, debug);

  return {
    nodes: [...nodeMap.values()],
    branches,
    fans,
    bulkheads,
    positions,
    horizons,
    branchOriginalIdMap,
    // Либо пользователь прямо указал столбец «Суммарное сопротивление»,
    // либо это видно по числам: R выработки ≈ сумма R её перемычек.
    resistanceIncludesBulkheads: useSumR || detectResistanceIncludesBulkheads(
      rawBranches.map(rb => ({ id: branchOriginalIdMap[rb.id] ?? rb.id, resistance: rb.resistance })),
      bulkheads,
    ),
    warnings,
    stats: {
      nodes: nodeMap.size,
      branches: branches.length,
      nodesWithZ: 0,
      fans: fans.length,
      bulkheads: bulkheads.length,
      positions: positions.length,
      horizons: horizons.length,
    },
    debug: debug.join("\n"),
  };
}