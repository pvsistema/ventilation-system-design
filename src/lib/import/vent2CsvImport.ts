// ─────────────────────────────────────────────────────────────────────────────
// vent2CsvImport.ts — CSV-ВЫГРУЗКА ИЗ ПО «ВЕНТИЛЯЦИЯ 2.0» (Файл → Экспорт в CSV).
//
// ЭТО НЕ ФАЙЛ СХЕМЫ. Файл схемы .cdf3 разбирает cdf3Import.ts — не путать.
//
// Вентиляция 2.0 выгружает 5 отдельных файлов:
//   *_nodes.csv     — вершины: Ид; X; Y; Z; Связь с атмосферой
//   *_links.csv     — выработки: … ; Слой; ИДЕНТИФИКАТОР ПОЗИЦИИ
//   *_positions.csv — позиции ПЛА: Ид; X; Y; Z; Номер; Название; Тип; Цвет
//   *_jumpers.csv   — перемычки
//   *_fans.csv      — источники тяги
//
// ОСОБЕННОСТИ ФОРМАТА, на которых уже обжигались:
//   1. Позиции выгружаются с координатами 0,0,0 — своего места они не хранят.
//      Оно вычисляется по серединам привязанных выработок.
//   2. Привязка позиции к выработкам лежит в файле ВЫРАБОТОК (столбец
//      «Идентификатор позиции»), а не в файле позиций — там списка нет вовсе.
//   3. Вида аварии в выгрузке нет совсем.
//   4. Цвет записан восемью знаками (#00FFFF00) — впереди прозрачность.
//   5. Сопротивление в столбце 10 уже СУММАРНОЕ, с перемычками: добавлять
//      сопротивление перемычек второй раз нельзя.
//
// Номера столбцов настраиваются пользователем в диалоге импорта, поэтому
// раскладка по умолчанию (VENT2_DEFAULT_COLS) — это лишь заготовка.
// ─────────────────────────────────────────────────────────────────────────────

import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";
import {
  type CsvImportResult, type RawFan, type RawBulkhead, type RawPosition,
  parseNum, splitRow, buildHorizonsFromLayers,
  detectResistanceUnit, detectResistanceIncludesBulkheads,
} from "@/lib/import/importCommon";
import { cleanId, parseCsvColor, fanNameFromType, fanTypeFromRaw } from "@/lib/import/csvFieldUtils";

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