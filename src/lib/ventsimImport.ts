// ─────────────────────────────────────────────────────────────────────────────
// Импорт CSV из Ventsim Design 5/6
//
// Ventsim экспортирует данные в двух вариантах:
//
// Вариант A — с текстовым заголовком (Branch Report):
//   Branch,From,To,Name,Length,Area,Perimeter,Resistance,Airflow,...
//   1,2,3,Tunnel A,150.5,14.2,15.3,0.05,45.2,...
//
// Вариант B — числовой формат (прямой экспорт .csv):
//   Первая строка — настройки модели (одинаковые числа, много нулей)
//   Следующие строки — данные ветвей:
//   From,To,Xfrom,Yfrom,Zfrom,Xto,Yto,Zto,Length,FrictionFactor,Area,Perimeter,...
//   Признак строки данных: первые два числа разные (From≠To) и нет большого кол-ва нулей подряд
//
// Вариант C — числовой формат в ЕВРОПЕЙСКОЙ локали (Ventsim на русской Windows):
//   Запятая служит ОДНОВРЕМЕННО разделителем полей и десятичным знаком, из-за
//   чего одно число "2313320,649" разрывается на два токена: "2313320" и "649".
//   Позиции колонок при этом "плывут": целое число занимает 1 токен, дробное — 2.
//   Номеров узлов в таком файле нет вовсе — первые три токена это порядковый
//   номер ветви (id,id,id), поэтому связность восстанавливается ТОЛЬКО
//   по координатам концов выработок.
//
//   Раскладка чисел строки (после склейки токенов):
//     [0..2] номер ветви  [3] признак
//     [4] Xfrom [5] Xto [6] Yfrom [7] Yto [8] Zfrom [9] Zto [10] Length
//   Разбор однозначно восстанавливается перебором: верна та склейка, при которой
//   расстояние между концами совпадает с записанной длиной выработки.
// ─────────────────────────────────────────────────────────────────────────────

import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface VentsimImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: {
    nodes: number; branches: number; fans: number;
    /** число несвязанных частей сети (1 — схема цельная) */
    parts?: number;
    /** размер (в ветвях) самой крупной части */
    biggestPart?: number;
  };
  debug: string;
}

/**
 * Считает, на сколько несвязанных частей распадается схема.
 * Разрыв обычно означает, что концы выработок не сошлись по координатам
 * и их не удалось объединить в общий узел.
 */
export function countNetworkParts(
  nodes: TopoNode[], branches: TopoBranch[],
): { parts: number; biggest: number } {
  if (branches.length === 0) return { parts: 0, biggest: 0 };

  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const arr = adj.get(a);
    if (arr) arr.push(b); else adj.set(a, [b]);
  };
  for (const b of branches) { link(b.fromId, b.toId); link(b.toId, b.fromId); }

  const seen = new Set<string>();
  let parts = 0, biggest = 0;
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    parts++;
    let size = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      size++;
      for (const nb of adj.get(cur) ?? []) {
        if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
    }
    if (size > biggest) biggest = size;
  }
  // Узлы вовсе без выработок тоже считаем отдельными частями
  const isolated = nodes.filter(n => !adj.has(n.id)).length;
  return { parts: parts + isolated, biggest };
}

// ── Утилиты ──────────────────────────────────────────────────────────────────

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  // Поддержка как "0,05" (европейский) так и "0.05" (английский)
  // Но только если запятая разделяет дробную часть (одна запятая в числе)
  const t = s.replace(/\s/g, "").replace(/"/g, "").trim();
  const n = parseFloat(t.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function cleanStr(s: string | undefined): string {
  return (s ?? "").replace(/"/g, "").trim();
}

function detectSep(lines: string[]): "," | ";" | "\t" {
  // Берём несколько строк для анализа
  const sample = lines.slice(0, 5).join("\n");
  let commas = 0, semis = 0, tabs = 0;
  for (const ch of sample) {
    if (ch === ",") commas++;
    else if (ch === ";") semis++;
    else if (ch === "\t") tabs++;
  }
  if (semis > commas * 0.5 && semis > tabs) return ";";
  if (tabs > commas * 0.5) return "\t";
  return ",";
}

/** Авто-раскладка узлов в сетку (если нет координат) */
function autoLayout(nodeIds: string[]): Map<string, { x: number; y: number }> {
  const layout = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(nodeIds.length));
  nodeIds.forEach((id, i) => {
    layout.set(id, {
      x: Math.round((i % cols) * 150),
      y: Math.round(Math.floor(i / cols) * 150),
    });
  });
  return layout;
}

// ── Ventsim в европейской локали (запятая = и разделитель, и дробный знак) ────

/** Геометрия ветви, восстановленная из "рваной" строки */
interface EuGeom {
  xFrom: number; yFrom: number; zFrom: number;
  xTo: number; yTo: number; zTo: number;
  length: number;
  /** индекс токена сразу после длины — отсюда идут физические параметры */
  next: number;
}

const isDigits = (s: string) => s.length > 0 && /^\d+$/.test(s);

/**
 * Восстанавливает 7 чисел (X1,X2,Y1,Y2,Z1,Z2,L) из токенов, разорванных запятой.
 * Каждое число занимает 1 токен (целое) или 2 (целая + дробная часть).
 * Правильный вариант определяется проверкой: длина выработки должна совпасть
 * с расстоянием между её концами.
 */
function parseEuGeometry(t: string[], start = 4): EuGeom | null {
  let best: { err: number; g: EuGeom } | null = null;

  // 2^7 = 128 комбинаций — перебор дешёвый
  for (let mask = 0; mask < 128; mask++) {
    const vals: number[] = [];
    let p = start;
    let ok = true;
    for (let k = 0; k < 7; k++) {
      const wide = (mask >> k) & 1; // 1 = число из двух токенов
      if (p >= t.length) { ok = false; break; }
      if (wide) {
        if (p + 1 >= t.length || !isDigits(t[p]) || !isDigits(t[p + 1])) { ok = false; break; }
        vals.push(parseFloat(`${t[p]}.${t[p + 1]}`));
        p += 2;
      } else {
        const v = parseFloat(t[p]);
        if (!isFinite(v)) { ok = false; break; }
        vals.push(v);
        p += 1;
      }
    }
    if (!ok || vals.length < 7) continue;

    const [x1, x2, y1, y2, z1, z2, len] = vals;
    if (!(len > 0) || len > 20000) continue;

    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const err = Math.abs(dist - len);

    const g: EuGeom = {
      xFrom: x1, yFrom: y1, zFrom: z1,
      xTo: x2, yTo: y2, zTo: z2,
      length: len, next: p,
    };
    // Точное совпадение — сразу принимаем
    if (err < Math.max(0.05, len * 0.002)) return g;
    if (!best || err < best.err) best = { err, g };
  }

  // Ventsim иногда округляет длину (35 при факт. 35,94) — принимаем близкий вариант
  if (best && best.err < Math.max(1.5, best.g.length * 0.08)) return best.g;
  return null;
}

/**
 * Признак европейского формата: запятая — единственный разделитель, точек в
 * файле нет, а первые токены строки повторяются (id,id,id) вместо From/To.
 */
function isEuropeanNumeric(rawLines: string[]): boolean {
  if (rawLines.length < 3) return false;
  const body = rawLines.slice(0, 40).join("\n");
  if (body.includes(".") || body.includes(";") || body.includes("\t")) return false;

  let hit = 0, tried = 0;
  for (let i = 1; i < Math.min(rawLines.length, 25); i++) {
    const t = rawLines[i].split(",");
    if (t.length < 20) continue;
    tried++;
    if (parseEuGeometry(t)) hit++;
  }
  return tried > 0 && hit >= Math.max(2, Math.floor(tried * 0.6));
}

/**
 * Ищет сечение выработки (площадь и периметр) среди токенов после длины.
 * Ventsim записывает пару «площадь, периметр» ДВАЖДЫ — для начала и конца
 * выработки. Этот повтор и служит опознавательным признаком: работаем прямо
 * на токенах, поэтому короткая дробная часть ("17,2") не мешает разбору.
 */
function parseEuSection(t: string[], from: number): { area: number; perimeter: number } | null {
  const lim = Math.min(t.length, from + 16);
  // Число = 1 токен (целое) либо 2 (целая + дробная часть)
  const readAt = (i: number): { v: number; next: number } | null => {
    if (i >= t.length) return null;
    const a = t[i];
    if (!isDigits(a)) {
      const v = parseFloat(a);
      return isFinite(v) ? { v, next: i + 1 } : null;
    }
    if (i + 1 < t.length && isDigits(t[i + 1])) {
      return { v: parseFloat(`${a}.${t[i + 1]}`), next: i + 2 };
    }
    return { v: parseFloat(a), next: i + 1 };
  };

  for (let i = from; i < lim; i++) {
    // Пробуем оба варианта ширины для каждого из четырёх чисел блока
    for (let mask = 0; mask < 16; mask++) {
      const vals: number[] = [];
      let p = i, ok = true;
      for (let k = 0; k < 4; k++) {
        const wide = (mask >> k) & 1;
        if (p >= t.length) { ok = false; break; }
        if (wide) {
          if (p + 1 >= t.length || !isDigits(t[p]) || !isDigits(t[p + 1])) { ok = false; break; }
          vals.push(parseFloat(`${t[p]}.${t[p + 1]}`));
          p += 2;
        } else {
          const r = readAt(p);
          if (!r || !isDigits(t[p])) { ok = false; break; }
          vals.push(parseFloat(t[p]));
          p += 1;
        }
      }
      if (!ok || vals.length < 4) continue;

      const [s, per, s2, per2] = vals;
      if (Math.abs(s - s2) > 1e-6 || Math.abs(per - per2) > 1e-6) continue;
      if (!(s > 0.5 && s < 200 && per > 1 && per < 200)) continue;
      const dEq = (4 * s) / per;
      // Площадь всегда меньше квадрата периметра; эквивалентный диаметр
      // реальной горной выработки лежит в пределах 0,5…12 м
      if (dEq > 0.5 && dEq < 12) return { area: s, perimeter: per };
    }
  }
  return null;
}

/**
 * Разбор Ventsim-экспорта из русской локали.
 * Номеров узлов в файле нет — сеть сшивается по координатам концов выработок.
 */
function parseVentsimEuropean(rawLines: string[], mergeTol: number): VentsimImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];
  debug.push(`Формат: Ventsim (русская локаль), строк: ${rawLines.length}`);

  interface EuBranch extends EuGeom { id: string; area: number; perimeter: number }
  const list: EuBranch[] = [];
  let skipped = 0;

  for (let i = 1; i < rawLines.length; i++) {
    const t = rawLines[i].split(",");
    if (t.length < 20) { skipped++; continue; }

    const g = parseEuGeometry(t);
    if (!g) { skipped++; continue; }

    // После длины идёт признак типа, затем пара «площадь, периметр» сечения
    // (Ventsim пишет её дважды — для начала и конца выработки).
    // Проверка: эквивалентный диаметр 4S/P должен быть в пределах 0,5–12 м,
    // иначе пара распознана неверно и сечение не переносим.
    const sec = parseEuSection(t, g.next);
    const area = sec?.area ?? 0;
    const perimeter = sec?.perimeter ?? 0;

    list.push({ ...g, id: t[0] || String(i), area, perimeter });
  }

  debug.push(`Ветвей распознано: ${list.length}, пропущено строк: ${skipped}`);

  if (list.length === 0) {
    return {
      nodes: [], branches: [],
      warnings: ["Не удалось разобрать файл Ventsim. Проверьте, что выгружен полный экспорт модели."],
      stats: { nodes: 0, branches: 0, fans: 0 },
      debug: debug.join("\n"),
    };
  }

  // ── Сшивка узлов по координатам ───────────────────────────────────────────
  // Концы выработок объединяются в один узел, если расстояние между ними
  // не больше заданного допуска (как «дистанция объединения узлов» в АэроСети).
  // Ventsim обычно пишет стыки точно, но у моделей, собранных из разных
  // источников, концы могут расходиться на считанные сантиметры.
  const ts = Date.now();
  const nodeMap = new Map<string, TopoNode>();
  const cell = Math.max(mergeTol, 0.001);
  // Пространственная сетка: в ячейке со стороной = допуску достаточно
  // проверить только соседние ячейки, поэтому сшивка идёт быстро.
  const grid = new Map<string, string[]>();
  const cellKey = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
  const coords = new Map<string, { x: number; y: number; z: number }>();

  // Начало координат — в левый нижний угол модели, иначе схема уезжает
  // на миллионы метров от рабочей области (координаты государственные).
  const minX = Math.min(...list.flatMap(b => [b.xFrom, b.xTo]));
  const minY = Math.min(...list.flatMap(b => [b.yFrom, b.yTo]));
  debug.push(`Смещение начала координат: X-${minX.toFixed(0)}, Y-${minY.toFixed(0)}`);
  debug.push(`Допуск объединения узлов: ${mergeTol} м`);

  let nodeNo = 0;
  let merged = 0;
  const nodeIdAt = (x: number, y: number, z: number): string => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${gx + dx}|${gy + dy}|${gz + dz}`);
          if (!bucket) continue;
          for (const id of bucket) {
            const c = coords.get(id)!;
            const dist = Math.sqrt((c.x - x) ** 2 + (c.y - y) ** 2 + (c.z - z) ** 2);
            if (dist <= mergeTol) {
              if (dist > 0) merged++;
              return id;
            }
          }
        }
      }
    }
    nodeNo++;
    const node = makeNode(`NV${ts}_${nodeNo}`, {
      x: Math.round((x - minX) * 10) / 10,
      y: Math.round((y - minY) * 10) / 10,
      z: Math.round(z * 10) / 10,
      number: String(nodeNo),
      name: String(nodeNo),
    });
    nodeMap.set(node.id, node);
    coords.set(node.id, { x, y, z });
    const k = cellKey(x, y, z);
    const arr = grid.get(k);
    if (arr) arr.push(node.id); else grid.set(k, [node.id]);
    return node.id;
  };

  const branches: TopoBranch[] = [];
  let bi = 0;
  for (const b of list) {
    const fromId = nodeIdAt(b.xFrom, b.yFrom, b.zFrom);
    const toId   = nodeIdAt(b.xTo,   b.yTo,   b.zTo);
    if (fromId === toId) continue; // выработка нулевой длины

    const dz = Math.abs(b.zTo - b.zFrom);
    const angle = b.length > 0
      ? Math.round(Math.asin(Math.min(1, dz / Math.max(b.length, 0.01))) * 180 / Math.PI * 10) / 10
      : 0;

    branches.push(makeBranch(`BV${ts}_${bi++}`, fromId, toId, {
      type: "Выработка",
      length: Math.round(b.length * 10) / 10,
      manualLength: true,
      angle,
      manualAngle: false,
      area: b.area,
      perimeter: b.perimeter,
      dh: b.area > 0 && b.perimeter > 0
        ? Math.round((4 * b.area / b.perimeter) * 1000) / 1000
        : 0,
      manualSection: b.area > 0,
      resistanceMode: "alpha",
      alphaCoef: 12,
    }));
  }

  debug.push(`Узлов: ${nodeMap.size}, ветвей: ${branches.length}, состыковано концов с расхождением: ${merged}`);
  if (merged > 0) {
    warnings.push(`Совмещено ${merged} концов выработок, расходившихся в пределах ${mergeTol} м.`);
  }
  warnings.push(
    `Файл выгружен из Ventsim в русской локали: номеров узлов в нём нет, сеть собрана по координатам выработок (${nodeMap.size} узлов, ${branches.length} ветвей).`
  );
  warnings.push("Расход и сопротивление Ventsim не переносятся — выполните «Расчёт сети» в ПВ-Системе.");
  if (skipped > 0) warnings.push(`Пропущено строк, не похожих на выработку: ${skipped}.`);

  const allNodes = [...nodeMap.values()];
  const { parts, biggest } = countNetworkParts(allNodes, branches);
  debug.push(`Несвязанных частей: ${parts}, крупнейшая: ${biggest} узлов`);
  if (parts > 1) {
    warnings.push(
      `Схема распалась на ${parts} несвязанных частей — концы выработок не сошлись по координатам. ` +
      `Увеличьте «дистанцию объединения узлов» (сейчас ${mergeTol} м) и загрузите файл снова.`
    );
  }

  return {
    nodes: allNodes,
    branches,
    warnings,
    stats: { nodes: nodeMap.size, branches: branches.length, fans: 0, parts, biggestPart: biggest },
    debug: debug.join("\n"),
  };
}

// ── Определение формата ───────────────────────────────────────────────────────

interface ColMap {
  id: number; from: number; to: number; name: number;
  length: number; area: number; perimeter: number; resistance: number;
  flow: number; fanPressure: number; fanName: number;
  xFrom: number; yFrom: number; zFrom: number;
  xTo: number; yTo: number; zTo: number;
  headerRow: number;
  format: "text-header" | "numeric";
}

/**
 * Ventsim числовой формат ветви:
 * [0]From  [1]To  [2]Xfrom  [3]Yfrom  [4]Zfrom  [5]Xto  [6]Yto  [7]Zto
 * [8]Length  [9]FrictionFactor(μ)  [10]Area  [11]Perimeter
 * [12]HydDiam  [13]Roughness  [14]Resistance(kmu)  [15]Airflow(m3/s)
 * [16]Velocity  [17]Pressure(Pa)  [18]FanPressure(Pa)  [19]FanName  ...
 */
const VENTSIM_NUMERIC: Omit<ColMap, "headerRow" | "format"> = {
  id: -1, from: 0, to: 1,
  xFrom: 2, yFrom: 3, zFrom: 4,
  xTo: 5, yTo: 6, zTo: 7,
  length: 8,
  area: 10, perimeter: 11,
  resistance: 14,
  flow: 15,
  fanPressure: 18, fanName: 19,
  name: -1,
};

function detectFormat(rows: string[][]): ColMap {
  // Ищем строку-заголовок (до 15 строк)
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i].map(c => c.toLowerCase().trim());
    const ci = (pat: RegExp) => row.findIndex(c => pat.test(c));

    const fromC = ci(/^from$|^from\s*node|^node\s*from|^from_node|^начал|^нач\s*верш/);
    const toC   = ci(/^to$|^to\s*node|^node\s*to|^to_node|^конеч|^кон\s*верш/);
    if (fromC >= 0 && toC >= 0) {
      return {
        headerRow: i,
        format: "text-header",
        id:         ci(/^branch$|^branch\s*id|^id$|^#$|^no\.$|^номер|^branch\s*no/),
        from: fromC, to: toC,
        name:       ci(/^name$|^branch\s*name|^description|^назван/),
        length:     ci(/^length|длина|^len\b/),
        area:       ci(/^area|^cross.?sect|сечен|площадь/),
        perimeter:  ci(/^perim|периметр/),
        resistance: ci(/^resist|сопрот|^r\b/),
        flow:       ci(/^airflow|^flow|расход|^q\b/),
        fanPressure:ci(/fan.*press|fan.*dep|^fan\s*p\b|^pressure\b.*fan|^fan\s*pressure/),
        fanName:    ci(/fan.*name|fan\s*id|^fan$/),
        xFrom:      ci(/x.*from|from.*x|^x1$|xstart/),
        yFrom:      ci(/y.*from|from.*y|^y1$|ystart/),
        zFrom:      ci(/z.*from|from.*z|^z1$|zstart|elev.*from|from.*elev/),
        xTo:        ci(/x.*to\b|to.*x|^x2$|xend/),
        yTo:        ci(/y.*to\b|to.*y|^y2$|yend/),
        zTo:        ci(/z.*to\b|to.*z|^z2$|zend|elev.*to|to.*elev/),
      };
    }
  }

  // Текстового заголовка нет — ищем первую строку с данными ветви (числовой формат)
  // Признак строки данных Ventsim: cols[0] ≠ cols[1] (From ≠ To) и оба — небольшие целые числа
  let dataStart = 0;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const cols = rows[i];
    if (cols.length < 10) continue;
    const from = parseFloat(cols[0]);
    const to   = parseFloat(cols[1]);
    if (!isNaN(from) && !isNaN(to) && from !== to && Number.isInteger(from) && Number.isInteger(to) && from > 0 && to > 0) {
      dataStart = i;
      break;
    }
  }

  return { ...VENTSIM_NUMERIC, headerRow: dataStart - 1, format: "numeric" };
}

// ── Главная функция ───────────────────────────────────────────────────────────

/** Допуск объединения узлов по умолчанию, м (как в АэроСети) */
export const DEFAULT_MERGE_TOL = 0.1;

export function parseVentsimCsv(content: string, mergeTol = DEFAULT_MERGE_TOL): VentsimImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];

  const rawLines = content
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (rawLines.length === 0) {
    return { nodes: [], branches: [], warnings: ["Файл пустой."], stats: { nodes: 0, branches: 0, fans: 0 }, debug: "" };
  }

  // ── Ventsim из русской локали: запятая и разделяет поля, и стоит в дробях ──
  if (isEuropeanNumeric(rawLines)) {
    return parseVentsimEuropean(rawLines, mergeTol);
  }

  const sep = detectSep(rawLines);
  debug.push(`Строк: ${rawLines.length}, разделитель: "${sep}"`);

  const rows = rawLines.map(l => l.split(sep).map(c => cleanStr(c)));

  const colMap = detectFormat(rows);
  debug.push(`Формат: ${colMap.format}, данные с строки: ${colMap.headerRow + 1}`);
  debug.push(`Колонки: from=${colMap.from} to=${colMap.to} len=${colMap.length} area=${colMap.area} R=${colMap.resistance} Q=${colMap.flow}`);

  if (colMap.format === "text-header") {
    debug.push(`Текстовый заголовок: ${rows[colMap.headerRow].join(" | ").slice(0, 120)}`);
  }

  // ── Собираем ветви ────────────────────────────────────────────────────────
  interface RawBr {
    id: string; from: string; to: string; name: string;
    length: number; area: number; perimeter: number;
    resistance: number; flow: number;
    fanPressure: number; fanName: string;
    xFrom: number; yFrom: number; zFrom: number;
    xTo: number; yTo: number; zTo: number;
  }

  const rawBranches: RawBr[] = [];
  const nodeCoords = new Map<string, { x: number; y: number; z: number }>();

  for (let i = colMap.headerRow + 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.length < 2) continue;

    const fromRaw = cols[colMap.from] ?? "";
    const toRaw   = cols[colMap.to]   ?? "";

    const fromId = cleanStr(fromRaw);
    const toId   = cleanStr(toRaw);

    if (!fromId || !toId) continue;

    // В числовом формате From и To — числа, пропускаем строки где они одинаковые
    // (конфигурационные строки)
    if (fromId === toId) continue;

    // Пропускаем строки-заголовки (содержат слова вместо чисел)
    if (/^[a-zA-Zа-яА-Я_\s]{3,}$/.test(fromId) && isNaN(Number(fromId))) continue;

    const xFrom = colMap.xFrom >= 0 ? parseNum(cols[colMap.xFrom]) : 0;
    const yFrom = colMap.yFrom >= 0 ? parseNum(cols[colMap.yFrom]) : 0;
    const zFrom = colMap.zFrom >= 0 ? parseNum(cols[colMap.zFrom]) : 0;
    const xTo   = colMap.xTo   >= 0 ? parseNum(cols[colMap.xTo])   : 0;
    const yTo   = colMap.yTo   >= 0 ? parseNum(cols[colMap.yTo])   : 0;
    const zTo   = colMap.zTo   >= 0 ? parseNum(cols[colMap.zTo])   : 0;

    if (!nodeCoords.has(fromId)) nodeCoords.set(fromId, { x: xFrom, y: yFrom, z: zFrom });
    if (!nodeCoords.has(toId))   nodeCoords.set(toId,   { x: xTo,   y: yTo,   z: zTo   });

    const brId = colMap.id >= 0 ? cleanStr(cols[colMap.id]) : String(rawBranches.length + 1);

    // Сопротивление: Ventsim числовой формат хранит в кМюрг (×10⁻³ Нс²/м⁸)
    // Текстовый формат может быть в разных единицах — определяем по величине
    const rRaw = colMap.resistance >= 0 ? parseNum(cols[colMap.resistance]) : 0;
    // Если значение очень маленькое (< 0.0001) — скорее всего в Нс²/м⁸ (SI), делим на 9.81
    // Если в диапазоне 0.001–1000 — уже кМюрг
    const rKmu = rRaw;

    rawBranches.push({
      id: brId,
      from: fromId,
      to: toId,
      name: colMap.name >= 0 ? cleanStr(cols[colMap.name]) : "",
      length:     colMap.length     >= 0 ? parseNum(cols[colMap.length])     : 0,
      area:       colMap.area       >= 0 ? parseNum(cols[colMap.area])       : 0,
      perimeter:  colMap.perimeter  >= 0 ? parseNum(cols[colMap.perimeter])  : 0,
      resistance: rKmu,
      flow:       colMap.flow       >= 0 ? parseNum(cols[colMap.flow])       : 0,
      fanPressure:colMap.fanPressure >= 0 ? parseNum(cols[colMap.fanPressure]): 0,
      fanName:    colMap.fanName    >= 0 ? cleanStr(cols[colMap.fanName])    : "",
      xFrom, yFrom, zFrom, xTo, yTo, zTo,
    });
  }

  debug.push(`Строк данных ветвей: ${rawBranches.length}`);

  if (rawBranches.length === 0) {
    // Дополнительная диагностика
    debug.push(`Первые 3 строки:`);
    rows.slice(0, 3).forEach((r, i) => debug.push(`  [${i}]: ${r.slice(0, 8).join(" | ")}`));
    return {
      nodes: [], branches: [],
      warnings: [...warnings, "Не найдено ветвей. Возможно файл не является экспортом Ventsim или имеет нестандартный формат. Включите лог парсера для диагностики."],
      stats: { nodes: 0, branches: 0, fans: 0 },
      debug: debug.join("\n"),
    };
  }

  // ── Строим узлы ────────────────────────────────────────────────────────────
  const allNodeIds = [...new Set(rawBranches.flatMap(b => [b.from, b.to]))];
  debug.push(`Уникальных узлов: ${allNodeIds.length}`);

  // Масштабирование координат: Ventsim может хранить в мм
  const allCoords = [...nodeCoords.values()];
  // Единицы определяем по РАЗМАХУ (габаритам) схемы, а не по абсолютным
  // координатам: в госсистеме координат X ≈ 2 313 000 — это метры, а не
  // миллиметры. Иначе схема сжимается в 1000 раз и все узлы слипаются.
  const maxCoord = Math.max(...allCoords.flatMap(c => [Math.abs(c.x), Math.abs(c.y)]));
  const spanX = allCoords.length ? Math.max(...allCoords.map(c => c.x)) - Math.min(...allCoords.map(c => c.x)) : 0;
  const spanY = allCoords.length ? Math.max(...allCoords.map(c => c.y)) - Math.min(...allCoords.map(c => c.y)) : 0;
  const span = Math.max(spanX, spanY);
  let coordScale = 1;
  if (span > 200000) { coordScale = 0.001; warnings.push("Координаты в мм → переведены в м."); }
  else if (span > 20000) { coordScale = 0.01; warnings.push("Координаты в см → переведены в м."); }
  debug.push(`Размах: X=${spanX.toFixed(1)}, Y=${spanY.toFixed(1)}, maxCoord=${maxCoord.toFixed(0)}, coordScale=${coordScale}`);

  const hasRealCoords = allCoords.some(c => c.x !== 0 || c.y !== 0);
  const coordLayout: Map<string, { x: number; y: number }> = hasRealCoords
    ? new Map(allNodeIds.map(id => {
        const c = nodeCoords.get(id) ?? { x: 0, y: 0, z: 0 };
        return [id, { x: c.x * coordScale, y: c.y * coordScale }];
      }))
    : autoLayout(allNodeIds);

  if (!hasRealCoords) {
    warnings.push("Координаты X/Y узлов не найдены — узлы расставлены автоматически.");
  }

  const ts = Date.now();
  const nodeMap = new Map<string, TopoNode>();
  for (const nid of allNodeIds) {
    const coord = coordLayout.get(nid) ?? { x: 0, y: 0 };
    const z = (nodeCoords.get(nid)?.z ?? 0) * coordScale;
    nodeMap.set(nid, makeNode(`NV${ts}_${nid}`, {
      x: Math.round(coord.x * 10) / 10,
      y: Math.round(coord.y * 10) / 10,
      z: Math.round(z * 10) / 10,
      number: nid,
      name: nid,
    }));
  }

  // ── Строим ветви ───────────────────────────────────────────────────────────
  const branches: TopoBranch[] = [];
  let fanCount = 0;
  let bi = 0;

  for (const rb of rawBranches) {
    const fromNode = nodeMap.get(rb.from);
    const toNode   = nodeMap.get(rb.to);
    if (!fromNode || !toNode) continue;

    const area   = rb.area;
    const perim  = rb.perimeter;
    const dh     = area > 0 && perim > 0 ? Math.round(4 * area / perim * 1000) / 1000 : 0;

    // Длина: из данных или из координат
    let length = rb.length;
    if (length <= 0 && hasRealCoords) {
      const dx = (rb.xTo - rb.xFrom) * coordScale;
      const dy = (rb.yTo - rb.yFrom) * coordScale;
      const dz = (rb.zTo - rb.zFrom) * coordScale;
      length = Math.round(Math.sqrt(dx*dx + dy*dy + dz*dz) * 10) / 10;
    }

    // Угол наклона из координат
    let angle = 0;
    if (length > 0 && hasRealCoords) {
      const dz = Math.abs((rb.zTo - rb.zFrom) * coordScale);
      angle = Math.round(Math.asin(Math.min(1, dz / Math.max(length, 0.01))) * 180 / Math.PI * 10) / 10;
    }

    // Сопротивление в кМюрг → Н·с²/м⁸ (manualR хранится в кМюрг, resistance в Н·с²/м⁸)
    // Но в makeBranch manualR принимает Н·с²/м⁸, а потом resistance = manualR
    // Ventsim: R в кМюрг (×10⁻³ Нс²/м⁸) → ×1000 = Нс²/м⁸... нет, это не так.
    // Вентсим хранит R в нс²/м⁸ (SI). 1 кМюрг = 9.81 × 10⁻³ кН·с²/м⁸ = 9.81 Нс²/м⁸
    // Но при экспорте Ventsim пишет сопротивление в своих единицах (обычно Н/м³·с²)
    // Из строки: колонка 14 = 1E-11 и т.д. — очень маленькие числа, значит в СИ (Нс²/м⁸)
    const rSi = rb.resistance; // Нс²/м⁸
    const importedR = rSi > 0 ? rSi : 0;

    const hasFan = rb.fanPressure > 0 || rb.fanName.length > 0;
    if (hasFan) fanCount++;

    branches.push(makeBranch(`BV${ts}_${bi++}`, fromNode.id, toNode.id, {
      type: "Выработка",
      length: length > 0 ? length : 0,
      manualLength: rb.length > 0,
      angle,
      manualAngle: false,
      area: area > 0 ? area : 0,
      perimeter: perim > 0 ? perim : 0,
      dh: dh > 0 ? dh : 0,
      manualSection: area > 0,
      flow: rb.flow,
      resistanceMode: importedR > 0 ? "manual" : "alpha",
      manualR: importedR,
      resistance: importedR,
      alphaCoef: 12,
      hasFan,
      fanMode: "constant" as const,
      fanPressure: rb.fanPressure,
      fanName: rb.fanName,
    }));
  }

  debug.push(`Ветвей создано: ${branches.length}, с вентилятором: ${fanCount}`);

  const allNodes2 = [...nodeMap.values()];
  const conn = countNetworkParts(allNodes2, branches);
  debug.push(`Несвязанных частей: ${conn.parts}, крупнейшая: ${conn.biggest} узлов`);
  if (conn.parts > 1) {
    warnings.push(
      `Схема распалась на ${conn.parts} несвязанных частей — проверьте, что в файле выгружены все выработки ` +
      `и колонки «откуда/куда» указаны верно.`
    );
  }

  return {
    nodes: allNodes2,
    branches,
    warnings,
    stats: {
      nodes: nodeMap.size, branches: branches.length, fans: fanCount,
      parts: conn.parts, biggestPart: conn.biggest,
    },
    debug: debug.join("\n"),
  };
}