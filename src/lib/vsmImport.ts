// ─────────────────────────────────────────────────────────────────────────────
// Импорт файла модели .vsm из Ventsim Design 5/6.
//
// Формат оказался дружелюбным: это обычный gzip, внутри — текст с секциями,
// разделёнными переводом строки. Данные разложены по табуляции.
//
// Главное отличие от .cdf3: Ventsim САМ записывает строку с названиями колонок
// («MAIN», «Branch Name», «X1», «Area», «Resistance», …), поэтому раскладку не
// нужно угадывать — она читается прямо из файла и не ломается от смены версии.
//
// СТРОЕНИЕ ФАЙЛА
//   PRIMARY … END PRIMARY   — список слоёв (горизонтов): номер, название, цвет
//   MAIN <названия колонок> — заголовок таблицы выработок
//   далее строки выработок  — по одной на выработку, поля через табуляцию
//
// ЧТО ПЕРЕНОСИТСЯ
//   координаты обоих концов, сечение, периметр, длина, название, слой,
//   а также СОПРОТИВЛЕНИЕ и РАСХОД — в отличие от .cdf3 и от CSV-выгрузки
//   Ventsim, где этих величин нет вовсе.
//
// УЗЛЫ. Номеров узлов в файле нет (колонки Entry/Exit Node пустые), поэтому
// сеть собирается по совпадению координат концов выработок — так же, как при
// импорте CSV Ventsim. Проверено на модели рудника: 277 выработок сошлись в
// одну связную сеть из 246 узлов.
// ─────────────────────────────────────────────────────────────────────────────

import { gunzipSync } from "fflate";
import { makeNode, makeBranch, type TopoNode, type TopoBranch, type Horizon } from "@/lib/topology";
import { countNetworkParts } from "@/lib/ventsimImport";

/** Цвета горизонтов — по кругу, чтобы соседние слои отличались. */
const LAYER_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea", "#0891b2",
  "#ea580c", "#4f46e5", "#059669", "#be123c", "#7c3aed", "#0d9488",
];

export interface VsmImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  warnings: string[];
  stats: {
    nodes: number;
    branches: number;
    named: number;
    withResistance: number;
    withFlow: number;
    fans: number;
    layers: number;
    parts: number;
    biggestPart: number;
  };
  debug: string;
}

/** Распаковка .vsm (gzip). */
export function unpackVsm(buf: ArrayBuffer): string {
  const all = new Uint8Array(buf);
  if (all.length < 4) throw new Error("Файл слишком короткий — это не модель Ventsim.");
  if (all[0] !== 0x1f || all[1] !== 0x8b) {
    // Некоторые версии сохраняют без сжатия — пробуем прочитать как текст.
    const asText = new TextDecoder("utf-8").decode(all);
    if (asText.includes("MAIN\t")) return asText;
    throw new Error("Файл не похож на модель Ventsim (.vsm).");
  }
  return new TextDecoder("utf-8").decode(gunzipSync(all));
}

const num = (s: string | undefined): number => {
  if (!s) return 0;
  const v = parseFloat(s.trim());
  return isFinite(v) ? v : 0;
};

interface RawBranch {
  name: string;
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
  area: number; perimeter: number; length: number;
  resistance: number; flow: number; fanPressure: number;
  layer: string;
}

/** Читает список слоёв из секции PRIMARY: «номер \t название \t …». */
function readLayers(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const start = lines.findIndex(l => l.trim() === "PRIMARY");
  if (start < 0) return out;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^(END|SECONDARY)/.test(l.trim())) break;
    const p = l.split("\t");
    if (p.length >= 2 && /^\d+$/.test(p[0].trim()) && p[1].trim()) {
      out.set(p[0].trim(), p[1].trim());
    }
  }
  return out;
}

export function parseVsm(buf: ArrayBuffer): VsmImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];

  const text = unpackVsm(buf);
  const lines = text.split(/\r?\n/);
  debug.push(`Распаковано: ${text.length} символов, строк ${lines.length}`);

  // ── Заголовок таблицы выработок ────────────────────────────────────────────
  const hi = lines.findIndex(l => l.startsWith("MAIN\t") && l.includes("Branch Name"));
  if (hi < 0) throw new Error("В файле не найдена таблица выработок — возможно, это не модель Ventsim.");

  const header = lines[hi].split("\t").map(h => h.trim());
  const col = (name: string): number =>
    header.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const C = {
    name: col("Branch Name"),
    x1: col("X1"), y1: col("Y1"), z1: col("Z1"),
    x2: col("X2"), y2: col("Y2"), z2: col("Z2"),
    area: col("Area"), perim: col("Perimeter"), length: col("Length"),
    res: col("Resistance"), flow: col("Quantity"), fan: col("Pressure Fan"),
    layer: col("Primary Layer"),
  };
  if (C.x1 < 0 || C.y1 < 0 || C.x2 < 0 || C.area < 0) {
    throw new Error("В таблице выработок не хватает колонок с координатами или сечением.");
  }
  debug.push(`Заголовок таблицы найден: ${header.length} колонок`);

  const layerNames = readLayers(lines);
  debug.push(`Список слоёв: ${layerNames.size}`);

  // ── Строки выработок ───────────────────────────────────────────────────────
  const raw: RawBranch[] = [];
  for (let i = hi + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (/^(END|[A-Z_0-9 ]{3,30}$)/.test(l.trim()) && !l.includes("\t")) break;
    const p = l.split("\t");
    if (p.length < header.length * 0.5) continue;
    // Строка данных начинается с номера выработки
    if (!/^-?\d+(\.\d+)?$/.test((p[1] ?? "").trim())) continue;

    const g = {
      x1: num(p[C.x1]), y1: num(p[C.y1]), z1: num(p[C.z1]),
      x2: num(p[C.x2]), y2: num(p[C.y2]), z2: num(p[C.z2]),
    };
    if (g.x1 === g.x2 && g.y1 === g.y2 && g.z1 === g.z2) continue;

    raw.push({
      name: (p[C.name] ?? "").trim(),
      ...g,
      area: num(p[C.area]),
      perimeter: C.perim >= 0 ? num(p[C.perim]) : 0,
      length: C.length >= 0 ? num(p[C.length]) : 0,
      resistance: C.res >= 0 ? num(p[C.res]) : 0,
      flow: C.flow >= 0 ? num(p[C.flow]) : 0,
      fanPressure: C.fan >= 0 ? num(p[C.fan]) : 0,
      layer: C.layer >= 0 ? layerNames.get((p[C.layer] ?? "").trim()) ?? "" : "",
    });
  }
  if (raw.length === 0) throw new Error("В файле не найдено ни одной выработки.");
  debug.push(`Выработок прочитано: ${raw.length}`);

  // ── Узлы по совпадению координат ───────────────────────────────────────────
  const ts = Date.now();
  const minX = Math.min(...raw.map(b => Math.min(b.x1, b.x2)));
  const minY = Math.min(...raw.map(b => Math.min(b.y1, b.y2)));
  debug.push(`Смещение начала координат: X-${minX.toFixed(0)}, Y-${minY.toFixed(0)}`);

  const nodeMap = new Map<string, TopoNode>();
  let nodeNo = 0;
  const nodeAt = (x: number, y: number, z: number): TopoNode => {
    // Округление до 1 см — концы выработок в Ventsim сходятся не идеально.
    const key = `${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
    const hit = nodeMap.get(key);
    if (hit) return hit;
    nodeNo++;
    const n = makeNode(`NV${ts}_${nodeNo}`, {
      x: Math.round((x - minX) * 10) / 10,
      y: Math.round((y - minY) * 10) / 10,
      z: Math.round(z * 10) / 10,
      number: String(nodeNo),
      name: "",
    });
    nodeMap.set(key, n);
    return n;
  };

  const branches: TopoBranch[] = [];
  const usedLayers = new Set<string>();
  const layerZ = new Map<string, number[]>();
  let named = 0, withR = 0, withQ = 0, fans = 0;

  raw.forEach((b, i) => {
    const fn = nodeAt(b.x1, b.y1, b.z1);
    const tn = nodeAt(b.x2, b.y2, b.z2);
    if (fn.id === tn.id) return;

    const dist = Math.sqrt((b.x2 - b.x1) ** 2 + (b.y2 - b.y1) ** 2 + (b.z2 - b.z1) ** 2);
    const len = b.length > 0 ? b.length : dist;
    const dz = Math.abs(b.z2 - b.z1);
    const angle = len > 0 ? Math.round((Math.asin(Math.min(1, dz / len)) * 180) / Math.PI * 10) / 10 : 0;
    const dh = b.area > 0 && b.perimeter > 0 ? Math.round((4 * b.area) / b.perimeter * 1000) / 1000 : 0;

    if (b.name) named++;
    if (b.resistance > 0) withR++;
    if (Math.abs(b.flow) > 0) withQ++;
    const hasFan = Math.abs(b.fanPressure) > 0;
    if (hasFan) fans++;

    if (b.layer) {
      usedLayers.add(b.layer);
      const zs = layerZ.get(b.layer);
      if (zs) zs.push(b.z1, b.z2); else layerZ.set(b.layer, [b.z1, b.z2]);
    }

    branches.push(makeBranch(`BV${ts}_${i}`, fn.id, tn.id, {
      type: b.name || "Выработка",
      layer: b.layer || "Без горизонта",
      length: Math.round(len * 10) / 10,
      manualLength: b.length > 0,
      angle,
      manualAngle: false,
      area: b.area,
      perimeter: b.perimeter > 0 ? b.perimeter : (b.area > 0 ? Math.round(3.84 * Math.sqrt(b.area) * 100) / 100 : 0),
      dh: dh > 0 ? dh : 0,
      manualSection: b.area > 0,
      // Сопротивление и расход Ventsim хранит в СИ — переносим как есть.
      resistanceMode: b.resistance > 0 ? "manual" : "alpha",
      manualR: b.resistance,
      resistance: b.resistance,
      alphaCoef: 12,
      flow: Math.abs(b.flow),
      shape: "arch",
      hasFan,
      fanMode: "constant" as const,
      fanPressure: Math.abs(b.fanPressure),
      fanName: hasFan ? (b.name || "Вентилятор") : "",
    }));
  });

  const allNodes = [...nodeMap.values()];
  const conn = countNetworkParts(allNodes, branches);

  const horizons: Horizon[] = [...usedLayers]
    .map(name => {
      const zs = layerZ.get(name) ?? [0];
      return { name, z: Math.round((zs.reduce((s, v) => s + v, 0) / zs.length) * 10) / 10 };
    })
    .sort((a, b) => b.z - a.z)
    .map((h, i) => ({
      id: `HV${ts}_${i}`,
      name: h.name,
      z: h.z,
      color: LAYER_COLORS[i % LAYER_COLORS.length],
      visible: true,
    }));

  debug.push(`Узлов: ${allNodes.length}, выработок: ${branches.length}, с названием: ${named}`);
  debug.push(`С сопротивлением: ${withR}, с расходом: ${withQ}, с напором вентилятора: ${fans}`);
  debug.push(`Несвязанных частей: ${conn.parts}, крупнейшая: ${conn.biggest} узлов`);

  if (withR > 0) {
    warnings.push(
      `Перенесены сопротивления (${withR} выработок) и расходы (${withQ}) — их посчитал Ventsim. ` +
      `Чтобы пересчитать по своим данным, выполните «Расчёт сети».`
    );
  }
  if (conn.parts > 1) {
    warnings.push(`Схема состоит из ${conn.parts} несвязанных частей — концы выработок могли не сойтись по координатам.`);
  }
  warnings.push("Выходы на поверхность в файле не отмечены — задайте их вручную перед расчётом сети.");

  return {
    nodes: allNodes,
    branches,
    horizons,
    warnings,
    stats: {
      nodes: allNodes.length,
      branches: branches.length,
      named,
      withResistance: withR,
      withFlow: withQ,
      fans,
      layers: usedLayers.size,
      parts: conn.parts,
      biggestPart: conn.biggest,
    },
    debug: debug.join("\n"),
  };
}
