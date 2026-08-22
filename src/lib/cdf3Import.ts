// ─────────────────────────────────────────────────────────────────────────────
// Импорт файла схемы .cdf3 из ПО «Вентиляция 2.0».
//
// Формат закрытый, двоичный. Раскладка восстановлена сверкой с CSV-выгрузкой
// той же самой модели (рудник Весенний): координаты узлов, признак выхода на
// поверхность, связи выработок и сечения совпали до последней записи.
//
// СТРОЕНИЕ ФАЙЛА
//   [0..16)   метка формата (GUID)
//   [16..20)  размер распакованных данных
//   [20..24)  размер сжатых данных
//   [24..]    поток zlib
//
// ВНУТРИ (после распаковки)
//   Таблица узлов:  [кол-во:i32][44:i32][...8 байт...] далее записи одинаковой
//                   длины (шаг зависит от версии программы):
//                     -4  ID узла (i32)  ← нумерация с пропусками
//                     +0  X, +8 Y, +16 Z (double)
//                     +80 признак выхода на поверхность (байт)
//   Таблица выработок идёт сразу за узлами:
//                     -8  общее число выработок (i32)
//                     +0  признак записи, всегда 1 (i32)
//                     +8  ID начального узла, +12 ID конечного (i32)
//                     +16 площадь сечения (double)
//                     +377 (от площади) длина названия, затем текст (cp1251)
//                   Записи ПЕРЕМЕННОЙ длины — следующая ищется сканированием.
//
// ЧЕГО В ФАЙЛЕ НЕТ: периметра, расхода, сопротивления и напора вентиляторов —
// проверено поиском по всему файлу. Длина выработки не хранится, потому что
// равна расстоянию между узлами (сверено: совпало для всех 679 выработок),
// периметр программа считает из сечения по форме, а расход и сопротивление —
// это результаты расчёта. Поэтому из .cdf3 переносится геометрия и топология,
// а сопротивления ПВ-Система рассчитывает сама.
// ─────────────────────────────────────────────────────────────────────────────

import { unzlibSync } from "fflate";
import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface Cdf3ImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: {
    nodes: number;
    branches: number;
    named: number;
    atmosphere: number;
    parts: number;
    biggestPart: number;
  };
  debug: string;
}

/** Признак файла .cdf3 — метка формата в первых 16 байтах. */
const CDF3_GUID = "f8679fe41d73dc419553b2fc397b45cb";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Текст в кодировке Windows-1251 (в ней хранятся названия выработок). */
function decodeCp1251(bytes: Uint8Array): string {
  try {
    return new TextDecoder("windows-1251").decode(bytes);
  } catch {
    return Array.from(bytes).map(b => String.fromCharCode(b)).join("");
  }
}

interface RawNode { id: number; x: number; y: number; z: number; atm: boolean }
interface RawBranch { from: number; to: number; area: number; name: string }

/** Распаковка контейнера .cdf3 */
export function unpackCdf3(buf: ArrayBuffer): Uint8Array {
  const all = new Uint8Array(buf);
  if (all.length < 32) throw new Error("Файл слишком короткий — это не схема .cdf3.");
  const guid = hex(all.slice(0, 16));
  if (guid !== CDF3_GUID) {
    // Метку не узнали, но попробуем распаковать: вдруг другая версия программы.
    try {
      return unzlibSync(all.slice(24));
    } catch {
      throw new Error("Файл не похож на схему Вентиляции 2.0 (.cdf3).");
    }
  }
  return unzlibSync(all.slice(24));
}

export function parseCdf3(buf: ArrayBuffer): Cdf3ImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];

  const raw = unpackCdf3(buf);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  debug.push(`Распаковано: ${raw.length} байт`);

  // Версия программы записана в служебной строке заголовка (UTF-16).
  const head = new TextDecoder("utf-16le").decode(raw.slice(0, 400));
  const ver = /pv:([\d.]+)/.exec(head);
  if (ver) debug.push(`Файл создан в Вентиляции 2.0 версии ${ver[1]}`);

  const found = findTables(raw, dv, debug);
  if (!found) {
    throw new Error("Не удалось прочитать схему: расположение данных в файле не распознано.");
  }
  const { nodes: rawNodes, branches: rawBranches } = found;

  // ── Переводим во внутренние объекты ───────────────────────────────────────
  const ts = Date.now();
  const byId = new Map<number, TopoNode>();
  const coord = new Map<number, RawNode>();
  let atmCount = 0;

  // Начало координат сдвигаем в угол модели: координаты в файле
  // государственные (десятки тысяч метров) и уводят схему от рабочей области.
  const minX = Math.min(...rawNodes.map(n => n.x));
  const minY = Math.min(...rawNodes.map(n => n.y));

  for (const rn of rawNodes) {
    if (rn.atm) atmCount++;
    coord.set(rn.id, rn);
    byId.set(rn.id, makeNode(`NC${ts}_${rn.id}`, {
      x: Math.round((rn.x - minX) * 10) / 10,
      y: Math.round((rn.y - minY) * 10) / 10,
      z: Math.round(rn.z * 10) / 10,
      number: String(rn.id),
      name: "",
      atmosphereLink: rn.atm,
    }));
  }
  debug.push(`Смещение начала координат: X-${minX.toFixed(0)}, Y-${minY.toFixed(0)}`);

  const branches: TopoBranch[] = [];
  let named = 0;
  let skipped = 0;
  rawBranches.forEach((rb, i) => {
    const fn = byId.get(rb.from);
    const tn = byId.get(rb.to);
    const cf = coord.get(rb.from);
    const ct = coord.get(rb.to);
    if (!fn || !tn || !cf || !ct) { skipped++; return; }
    // Длина в файле не хранится — она равна расстоянию между узлами.
    const len = Math.sqrt((ct.x - cf.x) ** 2 + (ct.y - cf.y) ** 2 + (ct.z - cf.z) ** 2);
    const dz = Math.abs(ct.z - cf.z);
    const angle = len > 0 ? Math.round((Math.asin(Math.min(1, dz / len)) * 180) / Math.PI * 10) / 10 : 0;
    if (rb.name.trim()) named++;
    branches.push(makeBranch(`BC${ts}_${i}`, fn.id, tn.id, {
      type: rb.name.trim() || "Выработка",
      length: Math.round(len * 10) / 10,
      manualLength: true,
      angle,
      manualAngle: false,
      area: rb.area,
      manualSection: rb.area > 0,
      // Периметр в файле отсутствует — оцениваем по сечению как для арочной
      // выработки (P ≈ 3.84·√S, отношение сверено по выгрузке рудника).
      perimeter: rb.area > 0 ? Math.round(3.84 * Math.sqrt(rb.area) * 100) / 100 : 0,
      shape: "arch",
      // Сопротивление в файле не хранится — его считает сама ПВ-Система.
      resistanceMode: "alpha",
      alphaCoef: 12,
    }));
  });
  if (skipped > 0) warnings.push(`Пропущено выработок с неизвестными узлами: ${skipped}.`);

  const allNodes = [...byId.values()];
  const { parts, biggest } = countParts(allNodes, branches);

  debug.push(`Узлов: ${allNodes.length}, выработок: ${branches.length}, с названием: ${named}`);
  debug.push(`Выходов на поверхность: ${atmCount}`);
  debug.push(`Несвязанных частей: ${parts}, крупнейшая: ${biggest} узлов`);

  warnings.push(
    "Из схемы перенесены геометрия, топология и названия. Сопротивление, расход " +
    "и напор вентиляторов в файле не хранятся — выполните «Расчёт сети» в ПВ-Системе."
  );
  if (atmCount === 0) {
    warnings.push("Не найдено узлов с выходом на поверхность — расчёт сети без них невозможен.");
  }
  if (parts > 1) {
    warnings.push(`Схема состоит из ${parts} несвязанных частей — проверьте полноту модели.`);
  }

  return {
    nodes: allNodes,
    branches,
    warnings,
    stats: {
      nodes: allNodes.length,
      branches: branches.length,
      named,
      atmosphere: atmCount,
      parts,
      biggestPart: biggest,
    },
    debug: debug.join("\n"),
  };
}

/**
 * Ищет таблицы узлов и выработок.
 * Длина записи узла зависит от версии программы, поэтому подбирается: верный
 * шаг тот, при котором координаты компактны и выработки ссылаются на
 * существующие узлы с правдоподобной длиной.
 */
function findTables(raw: Uint8Array, dv: DataView, debug: string[]) {
  for (let off = 0; off + 40 < raw.length; off += 4) {
    const cnt = dv.getInt32(off, true);
    if (cnt <= 10 || cnt >= 200000) continue;
    if (dv.getInt32(off + 4, true) !== 44) continue;
    const S = off + 16;

    for (let step = 200; step < 900; step += 2) {
      if (S + (cnt - 1) * step + 24 > raw.length) break;
      const nodes = readNodes(raw, dv, S, cnt, step);
      if (!nodes) continue;

      const br = readBranches(raw, dv, nodes, S + cnt * step);
      if (br.length >= Math.max(5, cnt * 0.2)) {
        debug.push(`Таблица узлов: смещение ${S}, записей ${cnt}, шаг ${step} байт`);
        return { nodes, branches: br };
      }
    }
  }
  return null;
}

function readNodes(raw: Uint8Array, dv: DataView, S: number, cnt: number, step: number): RawNode[] | null {
  const out: RawNode[] = [];
  let zeroXY = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < cnt; k++) {
    const o = S + k * step;
    if (o - 4 < 0 || o + 88 > raw.length) return null;
    const x = dv.getFloat64(o, true);
    const y = dv.getFloat64(o + 8, true);
    const z = dv.getFloat64(o + 16, true);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
    if (Math.abs(x) > 1e7 || Math.abs(y) > 1e7 || z < -2000 || z > 5000) return null;
    if (x === 0 && y === 0) zeroXY++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    out.push({
      id: dv.getInt32(o - 4, true),
      x, y, z,
      atm: raw[o + 80] === 1,
    });
  }
  // Узлы шахты компактны; много нулевых точек означает, что шаг подобран неверно
  if (zeroXY > cnt * 0.05) return null;
  if (maxX - minX > 50000 || maxY - minY > 50000) return null;
  const ids = new Set(out.map(n => n.id));
  if (ids.size < cnt * 0.9) return null;
  return out;
}

function readBranches(raw: Uint8Array, dv: DataView, nodes: RawNode[], tail: number): RawBranch[] {
  const pos = new Map<number, RawNode>();
  for (const n of nodes) pos.set(n.id, n);

  let expected = 0;
  if (tail - 8 >= 0) {
    const c = dv.getInt32(tail - 8, true);
    if (c >= 1 && c < 200000) expected = c;
  }

  const rec = (off: number): RawBranch | null => {
    if (off + 24 > raw.length) return null;
    if (dv.getInt32(off, true) !== 1) return null;
    const a = dv.getInt32(off + 8, true);
    const b = dv.getInt32(off + 12, true);
    if (a === b) return null;
    const na = pos.get(a), nb = pos.get(b);
    if (!na || !nb) return null;
    const area = dv.getFloat64(off + 16, true);
    if (!isFinite(area) || area <= 0.05 || area >= 500) return null;
    const d = Math.sqrt((nb.x - na.x) ** 2 + (nb.y - na.y) ** 2 + (nb.z - na.z) ** 2);
    if (d <= 0.1 || d >= 5000) return null;
    // Название лежит на постоянном смещении от площади сечения
    const ao = off + 16;
    let name = "";
    if (ao + 365 < raw.length) {
      const ln = dv.getInt32(ao + 361, true);
      if (ln >= 0 && ln <= 200 && ao + 365 + ln <= raw.length) {
        name = decodeCp1251(raw.slice(ao + 365, ao + 365 + ln));
      }
    }
    return { from: a, to: b, area, name };
  };

  const out: RawBranch[] = [];
  let off = tail;
  while (off + 24 < raw.length) {
    const r = rec(off);
    if (r) {
      out.push(r);
      if (expected && out.length >= expected) break;
    }
    // Записи переменной длины (внутри лежат перемычки и вентиляторы),
    // поэтому следующую ищем ближайшим сканированием.
    let p = off + (r ? 24 : 1);
    while (p + 24 < raw.length && !rec(p)) p++;
    if (p + 24 >= raw.length) break;
    off = p;
  }
  return out;
}

/** Число несвязанных частей сети — признак полноты модели. */
function countParts(nodes: TopoNode[], branches: TopoBranch[]) {
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
  const isolated = nodes.filter(n => !adj.has(n.id)).length;
  return { parts: parts + isolated, biggest };
}
