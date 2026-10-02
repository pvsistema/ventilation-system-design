// ─────────────────────────────────────────────────────────────────────────────
// Экспорт схемы водоснабжения в файл ПО «Вентиляция 2.0» (.hdr)
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ НЕ ПУТАТЬ С .cdf3. Это ДРУГОЙ файл той же программы: модуль              │
// │ «Водоснабжение» (противопожарный водопровод). Контейнер похож (GUID +    │
// │ zlib), но метка формата, раскладка узлов и записей выработок — свои.     │
// │ Схему вентиляции пишет vent2Cdf3Export.ts; оттуда берём только           │
// │ кодировку cp1251 и растущий буфер — они общие для всей программы.        │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Формат закрытый. Раскладка восстановлена по файлу рудника «Джусинский»
// (05.2026): 1109 узлов, 1157 выработок, 576 с трубопроводом, 213 объектов
// на трубах. Разбор файла проходит последовательно от начала до последнего
// байта — значит, длины всех блоков определены верно.
//
// КОНТЕЙНЕР
//   [0..16)   метка формата (GUID HDR_GUID)
//   [16..20)  размер распакованных данных (i32)
//   [20..24)  размер сжатых данных (i32)
//   [24..]    поток zlib
//
// ВНУТРИ (после распаковки), всё little-endian, строки — [длина:i32][cp1251]
//   [217 байт]  служебный заголовок (ширины столбцов таблиц) — постоянный
//   [16 байт]   GUID проекта
//   строка      название проекта
//   [16 байт]   служебное
//   [i32]       число слоёв; слой = [видим:u8][название][R G B 0]
//   [i32]       число зон;   зона = [флаг:u8][название][R G B 0][4 нуля]
//   [i32]       число узлов; узел — 88 байт:
//                 +0 ID:i32  +4 X  +12 Y  +20 Z (double, м)
//                 +28 X  +32 Y экранные (float) — положение на листе
//                 +36 выход на поверхность (u8)
//                 +38… оформление подписи (постоянное)
//   [i32]       число выработок; выработка:
//                 +0 ID  +4 от узла  +8 к узлу  +12 номер слоя (-1 — нет)
//                 +16 расход воздуха (double, м³/с)
//                 +24 01 00, +26 и +36 — вектор подписи (80-битные числа)
//                 +50 01, +51 номер зоны (-1 — нет), +56 название
//               затем хвост 72 байта:
//                 +8 диаметр трубы, мм (i32)  +12/+20 участок трубы 0…1
//                 +28 3 — труба есть, 0 — нет
//               затем [число объектов:i32] и сами объекты,
//               затем [труба есть:u8] и 149 байт оформления.
//   [i32 0][номера выработок 0…N-1:i32][2 float — сдвиг вида]
//
// ОБЪЕКТЫ НА ТРУБЕ: [тип:u8][ID:i32][положение вдоль выработки 0…1:double]…
//   тип 2 (871 б) — редукционный клапан: марка «КР-3», таблица характеристики
//                   9×7, +795 давление настройки (double, кгс/см²);
//   тип 3 (71 б)  — задвижка: +70 — закрыта (u8);
//   тип 4 (149 б) — пожарный кран / потребитель: +70 — открыт (u8),
//                   +72 расход (i32) и +99 он же (double), л/с;
//   тип 5 (110 б) — резервуар/водоисточник в конце выработки (положение 1):
//                   +86 объём, м³, +94 напор, м.
//   Назначение типов установлено по расстановке: резервуары стоят только на
//   выходах на поверхность, закрытые задвижки отсекают тупиковые участки,
//   у клапанов есть уставка 5,5–8 кгс/см² и характеристика.
//
// ЧТО ПИШЕМ. Узлы, выработки, слои-горизонты, признак и диаметр трубы,
// задвижки, редукционные клапаны, потребители и резервуары. Расчётных
// давлений в формате нет — «Вентиляция 2.0» считает их сама.
// Блоки оформления пишем точной копией из исходного файла: менять в них
// нечего, а угадывать значения — значит рисковать, что файл не откроется.
// ─────────────────────────────────────────────────────────────────────────────

import { zlibSync } from "fflate";
import type { TopoNode, TopoBranch, Horizon } from "@/lib/topology";
import { encodeCp1251, cleanName, ByteWriter } from "@/lib/vent2Cdf3Export";

/** Метка формата .hdr в первых 16 байтах. */
const HDR_GUID = "24e6d3dac1386040bb101afcef5deea4";

/** Длина записи узла. */
const NODE_SIZE = 88;
/** Длина вектора подписи выработки — такая у всех выработок в исходных файлах. */
const LABEL_VEC_LEN = 6.705;
/** Диаметр трубы по умолчанию у выработок без трубопровода, мм (как в программе). */
const NO_PIPE_DIAMETER = 150;
/** 1 МПа ≈ 10,197 кгс/см² и ≈ 101,97 м вод. ст. */
const MPA_TO_KGF = 10.197;
const MPA_TO_M = 101.97;

// ─── Шаблоны блоков (байты из исходного файла) ──────────────────────────────
const HDR_T_HEAD =
  "003500000001013500000001023500000001033500000001003500000001013500000001023500000001033500000001" +
  "0435000000010596000000010635000000010735000000010835000000010935000000010a35000000010b3500000001" +
  "0c35000000010d3500000001003500000001013500000001023500000001033500000001043500000001053500000001" +
  "0635000000010735000000010835000000010935000000010a35000000010b35000000010c35000000010d3500000001" +
  "0e35000000010f960000000110350000000100000000000100";
const HDR_T_AFTER_NAME =
  "00000000c90be103c90be10300000000";
const HDR_T_TAIL_PIPE =
  "0300000000000000640000000000000000000000000000000000f03f03000000ff000000000000000000000000000000" +
  "000000000000000000000000010000000000000000000000";
const HDR_T_TRAIL =
  "cdccccccccccf03f01000000960000000000000000000000000000000000f03f00000000ff0000000000000000000000" +
  "0000000000000000cdccccccccccf03f02000000960000000000000000000000000000000000f03f00000000ff000000" +
  "00000000000000000000000000000000cdccccccccccf03f040000000000000000000000000000000000f03f00000000" +
  "0000000000";
const HDR_T_TAIL_NONE =
  "0300000000000000960000000000000000000000000000000000f03f00000000ff000000000000000000000000000000" +
  "000000000000000000000000010000000000000000000000";
const HDR_T_NODE_TAIL =
  "000000e49b7480edf9b1a30240e69b7480edf9b1a302400000000039b4c876be9f1a8f00400000000000000000008000" +
  "00000001";
const HDR_T_O3 =
  "03be0900006bbadd090136e83f0000000000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000100";
const HDR_T_O4 =
  "04c309000061b9a711967bba3f0000000000000000000000000000000000000000000000000000000000000000000000" +
  "000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000" +
  "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000";
const HDR_T_O5 =
  "0504000000000000000000f03f000000000000000000000000000000f0024000000000000000f002c0000000008dfadf" +
  "d2988afa8b04c01bc94ef6bca15f9cfebf0000000001000000000000000000000000000000000000000000c082400000" +
  "0000000044400000000000000000";
const HDR_T_O2 =
  "02b8090000000000000000e03f04000000cad02d33000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000010104000000cad02d3309000000070000000000000000" +
  "00294000000000000036400000000000003b400000000000004040000000000080424000000000008045400000000000" +
  "0048400000000000004b400000000000004e40000000000000164000000000000026400000000000002c400000000000" +
  "0030400000000000003240000000000000364000000000000038400000000000003c4000000000000040400000000000" +
  "00244000000000000034400000000000003e400000000000004440000000000000494000000000000054400000000000" +
  "0059403333333333331d403333333333331940666666666666164000000000000012403333333333330b400000000000" +
  "00000000000000000000009a999999999924409a99999999992240cdcccccccccc20403333333333331d40cdcccccccc" +
  "cc184000000000000000400000000000000000cdcccccccccc29406666666666662740cdcccccccccc24403333333333" +
  "3322400000000000002040000000000000084000000000000000000000000000002d400000000000002a400000000000" +
  "002740000000000000244000000000000021406666666666660e4000000000000000003333333333b33040cdcccccccc" +
  "cc2e400000000000002c40000000000000294000000000000026400000000000001640cdccccccccccfc3f0000000000" +
  "003440333333333333324066666666666630400000000000002d4066666666666629406666666666661e400000000000" +
  "00084000000000000036400000000000003440000000000000324000000000000030400000000000002c400000000000" +
  "0020406666666666660e400000000000003940cdcccccccc4c36403333333333b33340cdcccccccc4c31400000000000" +
  "002e400000000000002040cdcccccccccc10409a99999999993c40cdcccccccccc3940cdcccccccccc36400000000000" +
  "003440000000000080314000000000000024400000000000002040000000000000164000010000000000000000000000" +
  "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000";


function hexBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

const B_HEAD = hexBytes(HDR_T_HEAD);
const B_AFTER_NAME = hexBytes(HDR_T_AFTER_NAME);
const B_TAIL_PIPE = hexBytes(HDR_T_TAIL_PIPE);
const B_TAIL_NONE = hexBytes(HDR_T_TAIL_NONE);
const B_TRAIL = hexBytes(HDR_T_TRAIL);
const B_NODE_TAIL = hexBytes(HDR_T_NODE_TAIL);
const B_O2 = hexBytes(HDR_T_O2);
const B_O3 = hexBytes(HDR_T_O3);
const B_O4 = hexBytes(HDR_T_O4);
const B_O5 = hexBytes(HDR_T_O5);

/** 80-битное число x87 (extended): 64 бита мантиссы с явной единицей + 16 бит знака и порядка. */
function ext80(v: number): Uint8Array {
  const out = new Uint8Array(10);
  if (!Number.isFinite(v) || v === 0) return out;
  const sign = v < 0 ? 1 : 0;
  const a = Math.abs(v);
  let e = Math.floor(Math.log2(a));
  let m = a / Math.pow(2, e);
  if (m >= 2) { m /= 2; e++; }
  if (m < 1) { m *= 2; e--; }
  const mant = BigInt(Math.round(m * 2 ** 52)) << 11n;
  for (let i = 0; i < 8; i++) out[i] = Number((mant >> BigInt(8 * i)) & 0xffn);
  const se = ((e + 16383) & 0x7fff) | (sign << 15);
  out[8] = se & 0xff;
  out[9] = (se >> 8) & 0xff;
  return out;
}

/** Копия шаблона с подставленными ID и положением вдоль выработки. */
function objectBlock(tpl: Uint8Array, id: number, offset: number): { b: Uint8Array; dv: DataView } {
  const b = tpl.slice();
  const dv = new DataView(b.buffer);
  dv.setInt32(1, id, true);
  dv.setFloat64(5, Math.min(1, Math.max(0, offset)), true);
  return { b, dv };
}

/** "#RRGGBB" → [R, G, B, 0] */
function colorBytes(hex: string): Uint8Array {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || "");
  const v = m ? parseInt(m[1], 16) : 0x808080;
  return new Uint8Array([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff, 0]);
}

function randomGuid(): Uint8Array {
  const g = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(g);
  else for (let i = 0; i < 16; i++) g[i] = Math.floor(Math.random() * 256);
  return g;
}

function str(w: ByteWriter, s: string) {
  const b = encodeCp1251(s);
  w.i32(b.length);
  w.bytes(b);
}

export interface HdrExportOptions {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  projectName?: string;
  /** Переносить горизонты как слои. По умолчанию да. */
  withHorizons?: boolean;
  /** Переносить задвижки, клапаны, потребители и резервуары. По умолчанию да. */
  withEquipment?: boolean;
  /**
   * Только выработки с трубопроводом. По умолчанию нет: в исходных файлах
   * лежит вся схема шахты, а труба — признак выработки.
   */
  onlyWaterPipes?: boolean;
  /** Писать расход воздуха выработок. По умолчанию да. */
  withAirFlow?: boolean;
}

export interface HdrExportStats {
  nodes: number;
  branches: number;
  pipes: number;
  gates: number;
  reducers: number;
  consumers: number;
  reservoirs: number;
  horizons: number;
  skipped: number;
  warnings: string[];
}

export interface HdrExportResult {
  blob: Blob;
  stats: HdrExportStats;
}

/** Собирает файл .hdr и возвращает его вместе со сводкой. */
export function buildVent2Hdr(opts: HdrExportOptions): HdrExportResult {
  const {
    horizons, projectName = "ПВ-Система",
    withHorizons = true, withEquipment = true, onlyWaterPipes = false, withAirFlow = true,
  } = opts;
  const warnings: string[] = [];

  // ── Состав схемы ──────────────────────────────────────────────────────────
  const branchesAll = onlyWaterPipes ? opts.branches.filter(b => b.hasWaterPipe) : opts.branches;
  const usedNodeIds = new Set<string>();
  for (const b of branchesAll) { usedNodeIds.add(b.fromId); usedNodeIds.add(b.toId); }
  const nodes = onlyWaterPipes ? opts.nodes.filter(n => usedNodeIds.has(n.id)) : opts.nodes;
  if (nodes.length === 0 || branchesAll.length === 0) {
    throw new Error(onlyWaterPipes ? "В схеме нет выработок с трубопроводом." : "Схема пуста — выгружать нечего.");
  }

  // ── Сквозная нумерация: узлы, выработки, объекты — без повторов ───────────
  let nextId = 1;
  const nodeNum = new Map<string, number>();
  for (const n of nodes) nodeNum.set(n.id, nextId++);
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  let skipped = 0;
  const branches = branchesAll.filter(b => {
    const ok = nodeNum.has(b.fromId) && nodeNum.has(b.toId) && b.fromId !== b.toId;
    if (!ok) skipped++;
    return ok;
  });
  const branchNum = new Map<string, number>();
  for (const b of branches) branchNum.set(b.id, nextId++);

  // ── Экранные координаты: план, Y вниз ─────────────────────────────────────
  const minX = Math.min(...nodes.map(n => n.x));
  const maxY = Math.max(...nodes.map(n => n.y));
  const scr = (n: TopoNode) => ({ x: n.x - minX, y: maxY - n.y });

  // ── Слои ──────────────────────────────────────────────────────────────────
  const layerNames: string[] = [];
  const layerColors: string[] = [];
  const layerIndex = new Map<string, number>();
  const addLayer = (raw: string, color: string) => {
    const nm = cleanName(raw, 60);
    if (!nm || nm === "Без горизонта" || layerIndex.has(nm)) return;
    layerIndex.set(nm, layerNames.length);
    layerNames.push(nm);
    layerColors.push(color);
  };
  if (withHorizons) {
    for (const h of horizons) addLayer(h.name, h.color);
    for (const b of branches) addLayer(b.layer ?? "", "#808080");
  }

  // ── Объекты на трубах ─────────────────────────────────────────────────────
  // Узловые объекты нашей модели (потребитель, резервуар) в формате стоят на
  // выработке — ставим их на ближайший к узлу конец трубы.
  type Obj = { tpl: "gate" | "reducer" | "consumer" | "reservoir"; offset: number; node?: TopoNode; br?: TopoBranch };
  const objs = new Map<string, Obj[]>();
  const push = (brId: string, o: Obj) => {
    const l = objs.get(brId);
    if (l) l.push(o); else objs.set(brId, [o]);
  };
  let gates = 0, reducers = 0, consumers = 0, reservoirs = 0;
  if (withEquipment) {
    for (const b of branches) {
      if (!b.hasWaterPipe) continue;
      if (b.wpHasGate) { push(b.id, { tpl: "gate", offset: 0.5, br: b }); gates++; }
      if (b.wpHasReducer) { push(b.id, { tpl: "reducer", offset: b.wpHasGate ? 0.6 : 0.5, br: b }); reducers++; }
    }
    // Узлы ППЗ: привязка к трубе, сходящейся в узле.
    const pipeAt = new Map<string, TopoBranch>();
    for (const b of branches) {
      if (!b.hasWaterPipe) continue;
      if (!pipeAt.has(b.fromId)) pipeAt.set(b.fromId, b);
      if (!pipeAt.has(b.toId)) pipeAt.set(b.toId, b);
    }
    let lost = 0;
    for (const n of nodes) {
      const t = n.fireNodeType ?? "none";
      if (t !== "consumer" && t !== "reservoir") continue;
      const b = pipeAt.get(n.id);
      if (!b) { lost++; continue; }
      const offset = b.toId === n.id ? 1 : 0;
      if (t === "consumer") { push(b.id, { tpl: "consumer", offset, node: n }); consumers++; }
      else { push(b.id, { tpl: "reservoir", offset, node: n }); reservoirs++; }
    }
    if (lost > 0) warnings.push(`Узлов ППЗ без примыкающего трубопровода: ${lost} — в файл не попали.`);
  }

  const w = new ByteWriter();

  // ── Заголовок ─────────────────────────────────────────────────────────────
  w.bytes(B_HEAD);
  w.bytes(randomGuid());
  str(w, cleanName(projectName, 100) || "Схема");
  w.bytes(B_AFTER_NAME);

  // ── Слои ──────────────────────────────────────────────────────────────────
  w.i32(layerNames.length);
  layerNames.forEach((nm, i) => {
    w.u8(1);
    str(w, nm);
    w.bytes(colorBytes(layerColors[i]));
  });

  // ── Зоны — не используем ─────────────────────────────────────────────────
  w.i32(0);

  // ── Узлы ──────────────────────────────────────────────────────────────────
  w.i32(nodes.length);
  let atmosphere = 0;
  for (const n of nodes) {
    const start = w.length;
    const s = scr(n);
    w.i32(nodeNum.get(n.id)!);
    w.f64(n.x);
    w.f64(n.y);
    w.f64(n.z ?? 0);
    const f = new DataView(new ArrayBuffer(8));
    f.setFloat32(0, s.x, true);
    f.setFloat32(4, s.y, true);
    w.bytes(new Uint8Array(f.buffer));
    w.u8(n.atmosphereLink ? 1 : 0);
    w.u8(0);
    w.bytes(B_NODE_TAIL.subarray(2));
    if (n.atmosphereLink) atmosphere++;
    if (w.length - start !== NODE_SIZE) throw new Error("Внутренняя ошибка: неверная длина записи узла.");
  }

  // ── Выработки ─────────────────────────────────────────────────────────────
  w.i32(branches.length);
  let pipes = 0;
  for (const b of branches) {
    const a = nodeById.get(b.fromId)!;
    const c = nodeById.get(b.toId)!;
    const hasPipe = !!b.hasWaterPipe;
    if (hasPipe) pipes++;

    w.i32(branchNum.get(b.id)!);
    w.i32(nodeNum.get(b.fromId)!);
    w.i32(nodeNum.get(b.toId)!);
    const li = withHorizons ? layerIndex.get(cleanName(b.layer ?? "", 60)) : undefined;
    w.i32(li ?? -1);
    w.f64(withAirFlow ? Number(b.flow) || 0 : 0);
    w.u8(1); w.u8(0);
    // Вектор подписи — вдоль выработки на листе, как в исходных файлах.
    const sa = scr(a), sc = scr(c);
    const dx = sc.x - sa.x, dy = sc.y - sa.y;
    const L = Math.hypot(dx, dy) || 1;
    w.bytes(ext80(-dx / L * LABEL_VEC_LEN));
    w.bytes(ext80(-dy / L * LABEL_VEC_LEN));
    w.zeros(4);
    w.u8(1);
    w.i32(-1);         // зона
    w.u8(0);
    str(w, cleanName(b.type ?? "") || "Выработка");

    // Хвост: диаметр и признак трубы.
    const tail = (hasPipe ? B_TAIL_PIPE : B_TAIL_NONE).slice();
    const tdv = new DataView(tail.buffer);
    const dia = hasPipe ? Math.round(Number(b.wpDiameter) || 100) : NO_PIPE_DIAMETER;
    tdv.setInt32(8, Math.max(10, Math.min(2000, dia)), true);
    w.bytes(tail);

    // Объекты на трубе — по возрастанию положения, как в программе.
    const list = (objs.get(b.id) ?? []).sort((x, y) => x.offset - y.offset);
    w.i32(list.length);
    for (const o of list) {
      const id = nextId++;
      if (o.tpl === "gate") {
        const { b: blk } = objectBlock(B_O3, id, o.offset);
        blk[70] = o.br?.wpGateClosed ? 1 : 0;
        w.bytes(blk);
      } else if (o.tpl === "reducer") {
        const { b: blk, dv } = objectBlock(B_O2, id, o.offset);
        const p = Number(o.br?.wpReducerOutPressure) || 0.6;
        dv.setFloat64(795, Math.round(p * MPA_TO_KGF * 100) / 100, true);
        w.bytes(blk);
      } else if (o.tpl === "consumer") {
        const { b: blk, dv } = objectBlock(B_O4, id, o.offset);
        const lps = Math.round((Number(o.node?.fireRequiredFlow) || 0) / 3.6);
        blk[70] = o.node?.fireHydrantOpen ? 1 : 0;
        dv.setInt32(72, lps, true);
        dv.setFloat64(99, lps, true);
        w.bytes(blk);
      } else {
        const { b: blk, dv } = objectBlock(B_O5, id, o.offset);
        const vol = Number(o.node?.fireCapacity) || 0;
        const head = (Number(o.node?.fireInitPressure) || 0) * MPA_TO_M;
        dv.setFloat64(86, vol > 0 ? vol : 400, true);
        dv.setFloat64(94, head > 0 ? Math.round(head * 10) / 10 : 40, true);
        w.bytes(blk);
      }
    }

    w.u8(hasPipe ? 1 : 0);
    w.bytes(B_TRAIL);
  }

  // ── Порядок выработок и сдвиг вида ────────────────────────────────────────
  w.i32(0);
  for (let i = 0; i < branches.length; i++) w.i32(i);
  w.zeros(8);

  // ── Контейнер ─────────────────────────────────────────────────────────────
  const raw = w.result();
  const packed = zlibSync(raw, { level: 6 });
  const out = new Uint8Array(24 + packed.length);
  out.set(hexBytes(HDR_GUID), 0);
  const dv = new DataView(out.buffer);
  dv.setInt32(16, raw.length, true);
  dv.setInt32(20, packed.length, true);
  out.set(packed, 24);

  // ── Предупреждения ────────────────────────────────────────────────────────
  if (pipes === 0) warnings.push("В схеме нет выработок с трубопроводом ППЗ — файл будет без водопровода.");
  if (skipped > 0) warnings.push(`Пропущено выработок с неверными узлами: ${skipped}.`);
  if (withEquipment && reservoirs === 0 && pipes > 0) {
    warnings.push("Не задан ни один резервуар (узел ППЗ «резервуар») — в «Вентиляции 2.0» водопровод останется без источника.");
  }
  if (atmosphere === 0) warnings.push("Нет узлов с выходом на поверхность.");
  if (reducers > 0) warnings.push("Редукционные клапаны выгружены с характеристикой «КР-3»; давление настройки — из схемы.");

  return {
    blob: new Blob([out], { type: "application/octet-stream" }),
    stats: {
      nodes: nodes.length, branches: branches.length, pipes,
      gates, reducers, consumers, reservoirs,
      horizons: layerNames.length, skipped, warnings,
    },
  };
}

/** Собирает .hdr и сохраняет его на диск пользователя. */
export function exportVent2Hdr(opts: HdrExportOptions & { fileName?: string }): HdrExportStats {
  const { blob, stats } = buildVent2Hdr(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (opts.fileName || opts.projectName || "Водоснабжение").replace(/\.[^.]+$/, "") + ".hdr";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return stats;
}