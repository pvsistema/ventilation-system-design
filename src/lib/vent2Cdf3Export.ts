// ─────────────────────────────────────────────────────────────────────────────
// Экспорт схемы в файл ПО «Вентиляция 2.0» (.cdf3)
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ НЕ ПУТАТЬ С ДРУГИМИ ЭКСПОРТАМИ. Это ЗАПИСЬ двоичного формата              │
// │ «Вентиляции 2.0» — обратная операция к src/lib/import/vent2Cdf3Import.ts. │
// │ Рядом живут:                                                              │
// │   • erpExport.ts   — родной формат АэроСети (.erp), ZIP с XML;            │
// │   • csvExport.ts   — табличная выгрузка для обеих программ;               │
// │   • excelExport.ts — параметры выработок в Excel.                         │
// │ Общий код с ними НЕ заводить: там текст и таблицы, здесь — двоичный       │
// │ контейнер со своей раскладкой записей и своей кодировкой строк.           │
// └───────────────────────────────────────────────────────────────────────────┘
//
// ВАЖНО О ФОРМАТЕ. Он закрытый: раскладка восстановлена сверкой файлов схем с
// CSV-выгрузкой тех же моделей (см. шапку vent2Cdf3Import.ts). Поэтому пишем
// РОВНО те поля, в которых уверены, а всё остальное оставляем нулями.
// Записываются: узлы (координаты, отметка, выход на поверхность), выработки
// (связи, сечение, название, горизонт), перемычки (положение, сопротивление,
// название) и список горизонтов.
// НЕ записываются, потому что их в формате нет: сопротивление и расход
// выработок, напор вентиляторов, позиции ПЛА — для них служит экспорт в CSV.
//
// СТРОЕНИЕ ФАЙЛА (то же, что читает импорт)
//   [0..16)   метка формата (GUID)
//   [16..20)  размер распакованных данных
//   [20..24)  размер сжатых данных
//   [24..]    поток zlib
//
// ВНУТРИ (до сжатия)
//   [заголовок][список горизонтов][нули][таблица узлов][таблица выработок]
//
//   Запись узла — блок постоянной длины NODE_STEP:
//     +0  ID узла (i32)
//     +4  X, +12 Y, +20 Z (double)
//     +84 признак выхода на поверхность (байт)
//   Перед таблицей: [кол-во узлов:i32][44:i32][4 служебных байта]
//   Читатель схемы считает началом таблицы координаты первого узла, а его ID
//   лежит за 4 байта до них — поэтому блоки начинаются на 4 байта раньше.
//
//   Запись выработки — переменной длины:
//     +0   признак записи, всегда 1 (i32)
//     +8   ID начального узла, +12 ID конечного (i32)
//     +16  площадь сечения (double)
//     +193 номер горизонта (u16)
//     +377 длина названия (i32), далее текст в cp1251
//     далее — блоки перемычек этой выработки
//   Число выработок лежит за 8 байт до начала таблицы.
//
// ЕДИНИЦЫ. Сопротивление перемычки — в кМюрг, как и в нашей модели.
// Координаты — метры; начало сдвигаем в COORD_BASE, потому что в исходных
// файлах координаты государственные, а нулевые точки импорт считает признаком
// неверно подобранной раскладки.
// ─────────────────────────────────────────────────────────────────────────────

import { zlibSync } from "fflate";
import type { TopoNode, TopoBranch, Horizon } from "@/lib/topology";

/** Метка формата в первых 16 байтах — по ней файл опознают обе программы. */
const CDF3_GUID = "f8679fe41d73dc419553b2fc397b45cb";

/** Длина блока одного узла. Импорт подбирает её в диапазоне 200…900 байт. */
const NODE_STEP = 200;

/**
 * Сдвиг начала координат. Схема шахты в файлах «Вентиляции 2.0» лежит в
 * государственной системе координат, и точка (0, 0) там не встречается —
 * читатель схемы считает обилие нулей признаком испорченных данных.
 */
const COORD_BASE = 10000;

/** Сопротивление перемычки записываем только в разумных пределах, кМюрг. */
const BULKHEAD_R_MIN = 1e-6;
const BULKHEAD_R_MAX = 9e4;

/** Высота перемычки по умолчанию, м — служебное поле формата. */
const BULKHEAD_H = 2.5;

/**
 * Текст → Windows-1251: в этой кодировке хранятся все названия внутри файла.
 * Готовой кодировки в браузере нет (TextEncoder умеет только UTF-8),
 * поэтому переводим сами: кириллица идёт сплошными диапазонами.
 */
function encodeCp1251(text: string): Uint8Array {
  const extra: Record<string, number> = {
    "Ё": 0xa8, "ё": 0xb8, "«": 0xab, "»": 0xbb, "№": 0xb9,
    "—": 0x97, "–": 0x96, "·": 0xb7, "…": 0x85, "’": 0x92, "°": 0xb0,
  };
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) out[i] = c;
    else if (c >= 0x410 && c <= 0x44f) out[i] = c - 0x410 + 0xc0;
    else out[i] = extra[text[i]] ?? 0x3f; // «?» — символ вне кодировки
  }
  return out;
}

/**
 * Название для записи в файл.
 *
 * Переносы строк убираем: «Вентиляция 2.0» хранит название одной строкой, а
 * управляющие символы внутри текста читатель схемы считает мусором и строку
 * пропускает. Длина ограничена полем формата (1 байт значащей длины).
 */
function cleanName(s: string, limit = 120): string {
  return String(s ?? "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, limit);
}

/** Простой растущий буфер: заранее размер записи посчитать нельзя. */
class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  private dv = new DataView(this.buf.buffer);
  private len = 0;

  private ensure(extra: number) {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.dv = new DataView(this.buf.buffer);
  }

  get length() { return this.len; }

  u8(v: number) { this.ensure(1); this.buf[this.len++] = v & 0xff; }
  u16(v: number) { this.ensure(2); this.dv.setUint16(this.len, v & 0xffff, true); this.len += 2; }
  i32(v: number) { this.ensure(4); this.dv.setInt32(this.len, v | 0, true); this.len += 4; }
  f64(v: number) { this.ensure(8); this.dv.setFloat64(this.len, Number(v) || 0, true); this.len += 8; }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.len); this.len += b.length; }
  zeros(count: number) { this.ensure(count); this.buf.fill(0, this.len, this.len + count); this.len += count; }

  /** Дописать нули до заданного смещения от начала буфера. */
  padTo(offset: number) {
    if (offset > this.len) this.zeros(offset - this.len);
  }

  /** Записать число в уже заполненное место — нужно для счётчиков. */
  patchI32(offset: number, v: number) { this.dv.setInt32(offset, v | 0, true); }

  result(): Uint8Array { return this.buf.slice(0, this.len); }
}

export interface Cdf3ExportOptions {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  /** Название проекта — попадает в заголовок файла. */
  projectName?: string;
}

export interface Cdf3ExportStats {
  nodes: number;
  branches: number;
  bulkheads: number;
  horizons: number;
  atmosphere: number;
  /** Выработки, пропущенные из-за отсутствия узлов или нулевого сечения. */
  skipped: number;
  /** Предупреждения для журнала: что именно не переносится. */
  warnings: string[];
}

/** Результат сборки: сам файл и сведения о том, что в него попало. */
export interface Cdf3ExportResult {
  blob: Blob;
  stats: Cdf3ExportStats;
}

/**
 * Собирает файл схемы .cdf3 и возвращает его вместе со сводкой.
 */
export function buildVent2Cdf3(opts: Cdf3ExportOptions): Cdf3ExportResult {
  const { nodes, branches, horizons, projectName = "ПВ-Система" } = opts;
  const warnings: string[] = [];

  if (nodes.length === 0 || branches.length === 0) {
    throw new Error("Схема пуста — выгружать нечего.");
  }

  // ── Номера узлов ──────────────────────────────────────────────────────────
  // В формате узел опознаётся целым номером, а у нас идентификаторы строковые.
  // Нумеруем подряд с единицы: нумерация с пропусками формату не мешает,
  // но сплошная проще для сверки со схемой в самой «Вентиляции 2.0».
  const nodeNum = new Map<string, number>();
  nodes.forEach((nd, i) => nodeNum.set(nd.id, i + 1));

  // ── Начало координат ──────────────────────────────────────────────────────
  const minX = Math.min(...nodes.map(nd => nd.x));
  const minY = Math.min(...nodes.map(nd => nd.y));

  // ── Список горизонтов ─────────────────────────────────────────────────────
  // Номер горизонта в записи выработки — это положение названия в списке.
  // Названия короче трёх символов читатель схемы принимает за служебные
  // строки и пропускает, поэтому дополняем их до нужной длины.
  const layerNames: string[] = [];
  const layerIndex = new Map<string, number>();
  for (const h of horizons) {
    const nm = cleanName(h.name, 60) || "Горизонт";
    const safe = nm.length >= 3 ? nm : `Гор. ${nm}`;
    if (layerIndex.has(safe)) continue;
    layerIndex.set(safe, layerNames.length);
    layerNames.push(safe);
  }
  // Горизонты, которые есть у выработок, но отсутствуют в списке слоёв.
  for (const br of branches) {
    const nm = cleanName(br.layer ?? "", 60);
    if (!nm || nm === "Без горизонта") continue;
    const safe = nm.length >= 3 ? nm : `Гор. ${nm}`;
    if (!layerIndex.has(safe)) {
      layerIndex.set(safe, layerNames.length);
      layerNames.push(safe);
    }
  }

  const w = new ByteWriter();

  // ── Заголовок ─────────────────────────────────────────────────────────────
  // Строка версии в UTF-16LE — по ней обе программы опознают, чем создан файл.
  const head = `pv:2.0.0.0 ${cleanName(projectName, 40)}`;
  for (let i = 0; i < head.length; i++) w.u16(head.charCodeAt(i));
  w.zeros(64);

  // ── Список горизонтов ─────────────────────────────────────────────────────
  // Каждая строка: длина (i32) и текст в cp1251, подряд, без разделителей.
  for (const nm of layerNames) {
    const b = encodeCp1251(nm);
    w.i32(b.length);
    w.bytes(b);
  }
  // Разделительные нули: за ними начинается таблица узлов, и по ним читатель
  // понимает, что список названий закончился.
  w.zeros(256);

  // ── Таблица узлов ─────────────────────────────────────────────────────────
  // Заголовок таблицы читатель схемы ищет по выравненным на 4 байта позициям,
  // поэтому выравниваем буфер перед записью счётчика.
  w.padTo(Math.ceil(w.length / 4) * 4);
  w.i32(nodes.length);
  w.i32(44);            // признак таблицы узлов — постоянная величина формата
  w.zeros(4);

  let atmosphere = 0;
  // Блок узла отсчитывается от его КООРДИНАТ, а номер лежит за 4 байта до них.
  const coordStart = w.length + 4;
  nodes.forEach((nd, k) => {
    const base = coordStart + k * NODE_STEP;
    w.padTo(base - 4);
    w.i32(nodeNum.get(nd.id) ?? k + 1);
    w.f64(nd.x - minX + COORD_BASE);
    w.f64(nd.y - minY + COORD_BASE);
    w.f64(nd.z ?? 0);
    // Признак выхода на поверхность лежит на постоянном смещении в блоке.
    w.padTo(base + 80);
    w.u8(nd.atmosphereLink ? 1 : 0);
    if (nd.atmosphereLink) atmosphere++;
  });
  // Хвост последнего блока: за 8 байт до таблицы выработок лежит их число.
  const tail = coordStart + nodes.length * NODE_STEP;
  w.padTo(tail);

  // ── Число выработок ───────────────────────────────────────────────────────
  // Пишем в хвост последнего блока узла — именно там его ищет читатель схемы.
  const countPos = tail - 8;

  // ── Таблица выработок ─────────────────────────────────────────────────────
  let written = 0;
  let skipped = 0;
  let bulkheadCount = 0;
  let noSection = 0;

  for (const br of branches) {
    const a = nodeNum.get(br.fromId);
    const b = nodeNum.get(br.toId);
    if (!a || !b || a === b) { skipped++; continue; }

    // Сечение — обязательное поле: без него запись не опознаётся как выработка.
    // Если у выработки его нет, ставим типовое, чтобы не потерять топологию.
    let area = Number(br.area) || 0;
    if (!(area > 0.05 && area < 500)) { area = 9; noSection++; }

    const rec = w.length;
    w.i32(1);                       // признак записи выработки
    w.i32(0);
    w.i32(a);
    w.i32(b);
    w.f64(area);

    // Номер горизонта
    const lay = cleanName(br.layer ?? "", 60);
    const safeLay = lay.length >= 3 ? lay : lay ? `Гор. ${lay}` : "";
    const li = safeLay ? layerIndex.get(safeLay) : undefined;
    w.padTo(rec + 193);
    w.u16(li ?? 0);

    // Название выработки
    const nameBytes = encodeCp1251(cleanName(br.type ?? ""));
    w.padTo(rec + 377);
    w.i32(nameBytes.length);
    w.bytes(nameBytes);

    // ── Перемычка на выработке ──────────────────────────────────────────────
    // Раскладка блока (см. readBulkheads в импорте):
    //   [длина названия:i32][текст cp1251][0x15][вид][флаг]
    //   [смещение f64][высота f64][16 байт][сопротивление f64]
    if (br.hasBulkhead) {
      const rKmu = br.bulkheadResMode === "manual"
        ? Number(br.bulkheadManualR) || 0
        : (Number(br.bulkheadR) || 0) / 1000;   // хранится в Мюрг, пишем кМюрг
      if (rKmu > BULKHEAD_R_MIN && rKmu < BULKHEAD_R_MAX) {
        const bn = encodeCp1251(cleanName(br.bulkheadName || "Перемычка", 60));
        w.i32(bn.length);
        w.bytes(bn);
        w.u8(0x15);       // разделитель названия и данных перемычки
        w.u8(4);          // вид перемычки: 4 — с дверью, самый общий случай
        w.u8(0);
        w.f64(0.5);       // положение вдоль выработки — середина
        w.f64(BULKHEAD_H);
        w.zeros(16);
        w.f64(rKmu);
        bulkheadCount++;
      }
    }

    // Хвост записи: нули, чтобы следующая запись начиналась чисто.
    w.zeros(16);
    written++;
  }

  if (written === 0) throw new Error("Не удалось выгрузить ни одной выработки.");
  w.patchI32(countPos, written);

  // ── Сжатие и контейнер ────────────────────────────────────────────────────
  const raw = w.result();
  const packed = zlibSync(raw, { level: 6 });

  const out = new Uint8Array(24 + packed.length);
  for (let i = 0; i < 16; i++) out[i] = parseInt(CDF3_GUID.substr(i * 2, 2), 16);
  const dv = new DataView(out.buffer);
  dv.setInt32(16, raw.length, true);
  dv.setInt32(20, packed.length, true);
  out.set(packed, 24);

  // ── Предупреждения ────────────────────────────────────────────────────────
  warnings.push(
    "В формат .cdf3 переносятся узлы, выработки, сечения, горизонты и перемычки. " +
    "Сопротивление и расход выработок, напор вентиляторов и позиции ПЛА этот " +
    "формат не хранит — для них используйте экспорт в CSV.",
  );
  if (skipped > 0) warnings.push(`Пропущено выработок с неверными узлами: ${skipped}.`);
  // Ограничения формата: «Вентиляция 2.0» не открывает схемы шире 50 км и с
  // отметками вне диапазона -2000…+5000 м — предупреждаем заранее.
  const spanX = Math.max(...nodes.map(nd => nd.x)) - minX;
  const spanY = Math.max(...nodes.map(nd => nd.y)) - minY;
  if (spanX > 45000 || spanY > 45000) {
    warnings.push("Схема шире 45 км — «Вентиляция 2.0» может не открыть такой файл.");
  }
  const minZ = Math.min(...nodes.map(nd => nd.z ?? 0));
  const maxZ = Math.max(...nodes.map(nd => nd.z ?? 0));
  if (minZ < -1900 || maxZ > 4900) {
    warnings.push(`Отметки узлов (${minZ.toFixed(0)}…${maxZ.toFixed(0)} м) выходят за диапазон формата -2000…+5000 м.`);
  }
  if (noSection > 0) warnings.push(`Выработок без сечения: ${noSection} — записаны с типовым 9 м².`);
  if (atmosphere === 0) warnings.push("Нет узлов с выходом на поверхность — расчёт в «Вентиляции 2.0» будет невозможен.");

  return {
    blob: new Blob([out], { type: "application/octet-stream" }),
    stats: {
      nodes: nodes.length,
      branches: written,
      bulkheads: bulkheadCount,
      horizons: layerNames.length,
      atmosphere,
      skipped,
      warnings,
    },
  };
}

/** Собирает .cdf3 и сохраняет его на диск пользователя. */
export function exportVent2Cdf3(
  opts: Cdf3ExportOptions & { fileName?: string },
): Cdf3ExportStats {
  const { blob, stats } = buildVent2Cdf3(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (opts.fileName || opts.projectName || "Схема").replace(/\.[^.]+$/, "") + ".cdf3";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return stats;
}