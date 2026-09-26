// ─────────────────────────────────────────────────────────────────────────────
// explosionReport.ts — «Протокол расчёта последствий взрыва» в Excel (.xlsx).
//
// Книга собирается из того же результата, по которому окрашена схема
// (runExplosionMode): отдельного пересчёта здесь нет, чтобы протокол
// не мог разойтись со схемой.
//   • «Протокол»   — очаги, параметры источника и волны, зоны поражения, итог
//   • «Перемычки»  — путь и время прихода волны, давление, прочность, устояла ли, доля прошедшей волны
//   • «Выработки»  — давление волны по выработкам, куда она дошла
//
// Пишется через ExcelJS: бесплатная сборка xlsx не сохраняет стили, и
// таблицы в файле выходили без рамок, заливки и формата чисел.
//
// Для ГАЗА И ПЫЛИ по методике ВГСЧ тротиловый эквивалент в протокол не
// выводится: методика его не использует — расчёт ведётся от энергии взрыва Ен
// и объёма загазования V₀. Для ВВ, наоборот, главная величина — Q_тнт.
// ─────────────────────────────────────────────────────────────────────────────
import type ExcelJSNs from "exceljs";
import { type TopoBranch, type TopoNode } from "@/lib/topology";
import { type ExplosionResult, waveFrontSpeed, GAS_TYPES, EXPLOSIVE_TYPES, concUnitLabel } from "@/lib/explosionCalculator";
import { barrierDisplayName, barrierArrival, type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";
import { combustionMode } from "@/lib/vgschBlast";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";

export interface ExplosionReportInput {
  projectName: string;
  branches: TopoBranch[];
  nodes: TopoNode[];
  symbols: SchemaSymbol[];
  resultByBranch: Map<string, ExplosionResult>;
  barriers: Map<string, BlastBarrier[]>;
  barrierHits: Map<string, BarrierHit>;
  duringEmergency?: boolean;
}

type Ws = ExcelJSNs.Worksheet;
type Cell = string | number | null;
type Tone = "bad" | "ok" | "muted" | "warn" | undefined;

// ─── Оформление ──────────────────────────────────────────────────────────────
const LINE = { style: "thin" as const, color: { argb: "FF7F8FA6" } };
const BOX = { top: LINE, left: LINE, bottom: LINE, right: LINE };
const HEAD_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFD7E7EE" } };
const TONE_FILL: Record<string, string> = { bad: "FFFFC7CE", ok: "FFC6EFCE", warn: "FFFFEB9C", zebra: "FFF4F7FA" };
const TONE_FONT: Record<string, string> = { bad: "FF9C0006", ok: "FF006100", warn: "FF7F6000", muted: "FF7F7F7F" };

/** Таблица с рамками по всем ячейкам: шапка + строки. Возвращает номер следующей строки. */
function table(
  ws: Ws, startRow: number, headers: string[], rows: Cell[][],
  opts: { tones?: Tone[]; numFmt?: (string | undefined)[]; align?: ("left" | "center" | "right")[] } = {},
): number {
  const head = ws.getRow(startRow);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 10, color: { argb: "FF173D52" } };
    c.fill = HEAD_FILL;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BOX;
  });
  head.height = Math.max(30, 15 * Math.max(...headers.map(h => Math.ceil(h.length / 14))));
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    const tone = opts.tones?.[ri];
    r.forEach((v, ci) => {
      const c = row.getCell(ci + 1);
      c.value = v ?? "—";
      c.border = BOX;
      c.font = { size: 10, bold: tone === "bad", color: tone ? { argb: TONE_FONT[tone] ?? "FF000000" } : undefined };
      const fill = tone && TONE_FILL[tone] ? TONE_FILL[tone] : ri % 2 === 1 ? TONE_FILL.zebra : undefined;
      if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      const isNum = typeof v === "number";
      c.alignment = { vertical: "middle", wrapText: true, horizontal: opts.align?.[ci] ?? (isNum ? "right" : "left") };
      if (isNum && opts.numFmt?.[ci]) c.numFmt = opts.numFmt[ci]!;
    });
  });
  return startRow + 1 + rows.length + 1;
}

/** Заголовок раздела на всю ширину. */
function section(ws: Ws, row: number, text: string, cols: number): number {
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { bold: true, size: 11, color: { argb: "FF1F2328" } };
  c.border = { bottom: { style: "medium", color: { argb: "FFE8A317" } } };
  return row + 1;
}

function title(ws: Ws, row: number, text: string, cols: number, size = 13): number {
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { bold: true, size };
  c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  return row + 1;
}

const r1 = (v: number | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

// ─── Подписи ─────────────────────────────────────────────────────────────────
function makeLabel(nodes: TopoNode[]) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const clean = (s?: string) => String(s ?? "").trim().replace(/^"(.*)"$/, "$1").trim();
  return (b: TopoBranch | undefined, id?: string) => {
    if (!b) return id ? `Ветвь ${id}` : "—";
    const fn = byId.get(b.fromId);
    const tn = byId.get(b.toId);
    const nm = clean(b.type) || `Ветвь ${b.id}`;
    return `${nm} (${fn?.number || fn?.id || "?"}→${tn?.number || tn?.id || "?"})`;
  };
}

function isGasSource(b: TopoBranch): boolean {
  return (b.explosionSourceType ?? "mass") === "gas";
}

function sourceText(b: TopoBranch): string {
  if (isGasSource(b)) {
    const g = GAS_TYPES.find(x => x.id === (b.explosionGasId ?? "methane")) ?? GAS_TYPES[0];
    const conc = b.explosionGasConcentration ?? g.stoichConc;
    return `${g.name}, ${conc} ${concUnitLabel(g.unit)}`;
  }
  const e = EXPLOSIVE_TYPES.find(x => x.id === (b.explosionExplosiveId ?? "ammonit")) ?? EXPLOSIVE_TYPES[0];
  return `${e.name}, ${b.explosionExplosiveMass ?? 100} кг`;
}

function methodText(b: TopoBranch, r?: ExplosionResult): string {
  if (!isGasSource(b)) return "Садовский (ВВ)";
  if (r?.vgsch) return "ВГСЧ (Прил. 12 к Уставу ВГСЧ)";
  return "Прямолинейная";
}

// ─── Лист «Протокол» ─────────────────────────────────────────────────────────
function buildProtocolSheet(wb: ExcelJSNs.Workbook, inp: ExplosionReportInput, label: ReturnType<typeof makeLabel>) {
  const COLS = 8;
  const ws = wb.addWorksheet("Протокол", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [34, 30, 18, 14, 14, 14, 14, 36].map(width => ({ width }));

  // Гриф утверждения
  ws.getCell(1, 7).value = "УТВЕРЖДАЮ:";
  ws.getCell(1, 7).font = { bold: true };
  ws.getCell(2, 7).value = "Руководитель горноспасательных работ";
  ws.getCell(4, 7).value = "_______________";
  ws.getCell(5, 7).value = `«____»___________ ${new Date().getFullYear()} г.`;

  let row = 7;
  row = title(ws, row, "ПРОТОКОЛ", COLS, 14);
  row = title(ws, row, "расчёта параметров воздушной ударной волны и последствий взрыва", COLS, 12);
  row = title(ws, row, `«${inp.projectName}»`, COLS, 12);
  ws.mergeCells(row, 1, row, COLS);
  ws.getCell(row, 1).value = "Условия расчёта: " + (inp.duringEmergency
    ? "в ходе ликвидации аварии (время загазирования — фактическое, не менее 150 мин)."
    : "при разработке ПЛА (время загазирования 60 мин).");
  row += 2;

  const srcBranches = inp.branches.filter(b => b.hasExplosion);
  const gasSrc = srcBranches.filter(isGasSource);
  const massSrc = srcBranches.filter(b => !isGasSource(b));

  // 1. Очаги
  row = section(ws, row, "1. ОЧАГИ ВЗРЫВА", COLS);
  row = table(ws, row,
    ["№", "Выработка-очаг", "Источник", "Методика расчёта", "Сечение, м²", "Периметр, м", "α, ×10⁻⁴", "Примечание"],
    srcBranches.map((b, i) => {
      const r = inp.resultByBranch.get(b.id);
      return [
        i + 1, label(b), sourceText(b), methodText(b, r),
        r1(b.area, 1), r1(b.perimeter, 2), r1(b.alphaCoef, 1),
        !r ? "нет результата" : r.noExplosion ? `Взрыв не происходит: ${r.noExplosionReason ?? "смесь не взрывоопасна"}` : "",
      ];
    }),
    {
      tones: srcBranches.map(b => inp.resultByBranch.get(b.id)?.noExplosion ? "muted" : undefined),
      numFmt: [undefined, undefined, undefined, undefined, "0.0", "0.00", "0.0"], align: ["center"],
    });

  // 2а. Газ и пыль — параметры источника по методике ВГСЧ
  if (gasSrc.length) {
    row = section(ws, row, "2. ПАРАМЕТРЫ ВЗРЫВА ГАЗА И ПЫЛИ (методика ВГСЧ)", COLS);
    row = table(ws, row,
      ["Выработка-очаг", "Вид взрыва (табл. 2)", "Длина загазования, м", "V₀, м³", "Ен, МДж",
        "ΔP в зоне загазования, кПа", "ΔPн в месте отрыва УВВ, кПа", "Кз (табл. 3) / импульс i, Н·с/м²"],
      gasSrc.map(b => {
        const r = inp.resultByBranch.get(b.id);
        const v = r?.vgsch;
        if (!r || r.noExplosion) return [label(b), "—", null, null, null, null, null, "взрыв не происходит"];
        if (!v) return [label(b), "прямолинейная модель", r1(b.explosionGasZoneLength, 0), null, null,
          r1(r.maxDeltaP_kPa, 1), null, `i = ${r1(r.maxImpulse_Pas, 0)} Па·с`];
        return [label(b), combustionMode(v.mode).label + (v.dustFactor > 1 ? " (Ен × 1,3)" : ""),
          r1(v.zoneLength_m, 1), r1(v.V0_m3, 0), r1(v.En_MJ, 0), r1(v.dPz_kPa, 0), r1(v.dPn_kPa, 0),
          `Кз = ${v.kz}; i = ${r1(r.maxImpulse_Pas, 0)}`];
      }),
      { numFmt: [undefined, undefined, "0.0", "#,##0", "#,##0", "#,##0", "#,##0"] });

    // Зона продуктов взрыва и параметры волны на выходе из неё
    const vg = gasSrc.filter(b => { const r = inp.resultByBranch.get(b.id); return r && !r.noExplosion && r.vgsch; });
    if (vg.length) {
      row = table(ws, row,
        ["Выработка-очаг", "μ (табл. 2)", "Объём ПВ всего (5V₀), м³", "ПВ на направление (2V₀), м³",
          "Длина зоны ПВ в каждую сторону, м", "Скорость фронта D, м/с", "Время действия θ, мс", "Сечение / периметр / Кз"],
        vg.map(b => {
          const r = inp.resultByBranch.get(b.id)!;
          const v = r.vgsch!;
          const pvLen = v.area_m2 > 0 ? v.pvVolumePerSide_m3 / v.area_m2 : undefined;
          return [label(b), v.mu, r1(v.V0_m3 * 5, 0), r1(v.pvVolumePerSide_m3, 0), r1(pvLen, 0),
            r1(r.waveFrontSpeed_ms, 0), r1(r.phaseDuration_ms, 1),
            `S = ${r1(v.area_m2, 1)} м², П = ${r1(v.perimeter_m, 2)} м, Кз = ${v.kz}`];
        }),
        { numFmt: [undefined, "0.00", "#,##0", "#,##0", "#,##0", "#,##0", "0.0"] });
    }
  }

  // 2б. ВВ — тротиловый эквивалент и параметры волны
  if (massSrc.length) {
    row = section(ws, row, `${gasSrc.length ? "3" : "2"}. ПАРАМЕТРЫ ВЗРЫВА ВВ`, COLS);
    row = table(ws, row,
      ["Выработка-очаг", "ВВ, масса", "Q_тнт, кг ТНТ", "ΔP_max, кПа", "I_max, Па·с", "D, м/с", "Фаза сжатия, мс", "Примечание"],
      massSrc.map(b => {
        const r = inp.resultByBranch.get(b.id);
        if (!r || r.noExplosion) return [label(b), sourceText(b), null, null, null, null, null, "взрыв не происходит"];
        return [label(b), sourceText(b), r1(r.q_tnt_kg, 2), r1(r.maxDeltaP_kPa, 1), r1(r.maxImpulse_Pas, 1),
          r1(r.waveFrontSpeed_ms, 0), r1(r.phaseDuration_ms, 1), `на границе применимости r = ${r1(r.minValidRadius_m, 2)} м`];
      }),
      { numFmt: [undefined, undefined, "0.00", "#,##0.0", "#,##0.0", "#,##0", "0.0"] });
  }

  // Зоны поражения
  let n = 2 + (gasSrc.length ? 1 : 0) + (massSrc.length ? 1 : 0);
  row = section(ws, row, `${n}. ЗОНЫ ПОРАЖЕНИЯ (расстояние от центра очага по одиночной прямой выработке)`, COLS);
  const zRows: Cell[][] = [];
  const zTones: Tone[] = [];
  srcBranches.forEach(b => {
    const r = inp.resultByBranch.get(b.id);
    if (!r || r.noExplosion) return;
    const impUnit = r.vgsch ? "Н·с/м²" : "Па·с";
    r.zones.forEach(z => {
      zRows.push([label(b), z.name, r1(z.radius_m, 0), r1(z.deltaP_kPa, 2), r1(z.impulse_Pas, 1), impUnit, z.description, ""]);
      zTones.push(z.hazardLevel === "lethal" || z.hazardLevel === "heavy" ? "bad"
        : z.hazardLevel === "medium" || z.hazardLevel === "light" ? "warn" : "ok");
    });
  });
  row = table(ws, row, ["Выработка-очаг", "Зона", "Расстояние, м", "ΔP, кПа", "Импульс", "Ед. импульса", "Характеристика", ""],
    zRows, { tones: zTones, numFmt: [undefined, undefined, "#,##0", "0.##", "#,##0.0"] });
  ws.getCell(row - 1, 1).value = "По схеме волна ведётся с учётом сопряжений, поворотов и перемычек — фактические расстояния зон по сети короче.";
  ws.getCell(row - 1, 1).font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
  row += 1;

  // Перемычки
  n += 1;
  const hits = [...inp.barrierHits.values()];
  const destroyed = hits.filter(h => h.destroyed).length;
  const held = hits.filter(h => !h.destroyed && h.incident_kPa > 0).length;
  const total = [...inp.barriers.values()].reduce((s, l) => s + l.length, 0);
  row = section(ws, row, `${n}. ПЕРЕМЫЧКИ (подробно — лист «Перемычки»)`, COLS);
  row = table(ws, row, ["Показатель", "Количество"], [
    ["Всего перемычек на схеме", total],
    ["Волна дошла", hits.length],
    ["Разрушено", destroyed],
    ["Устояли", held],
    ["Волна не дошла", Math.max(0, total - hits.length)],
  ], { tones: [undefined, undefined, destroyed ? "bad" : undefined, held ? "ok" : undefined, "muted"], numFmt: [undefined, "0"] });

  // Примечания
  const warns = [...new Set([...inp.resultByBranch.values()].flatMap(r => r.warnings))];
  if (warns.length) {
    row = section(ws, row, "ПРИМЕЧАНИЯ", COLS);
    for (const w of warns) {
      ws.mergeCells(row, 1, row, COLS);
      ws.getCell(row, 1).value = `• ${w.replace(/^⚠\s*/, "")}`;
      ws.getCell(row, 1).alignment = { wrapText: true };
      row++;
    }
    row++;
  }

  ws.mergeCells(row, 1, row, COLS);
  ws.getCell(row, 1).value = "Расчёт выполнен в программном комплексе «ПВ-Система».";
  row += 2;
  ws.getCell(row, 1).value = "Расчёт выполнил";
  ws.getCell(row, 2).value = "_______________________";
  row++;
  ws.getCell(row, 1).value = "Дата";
  ws.getCell(row, 2).value = new Date().toLocaleDateString("ru-RU");
}

// ─── Лист «Перемычки» ────────────────────────────────────────────────────────
function buildBarriersSheet(wb: ExcelJSNs.Workbook, inp: ExplosionReportInput, label: ReturnType<typeof makeLabel>) {
  const headers = [
    "№ п/п", "Перемычка", "Выработка", "Положение на ветви, %",
    "Путь волны от очага, м", "Время прихода волны, мс", "Время действия волны θ, мс",
    "Давление разрушения, кПа", "ΔP во фронте волны, кПа", "Запас прочности",
    "Состояние", "Доля волны за перемычкой, %", "ΔP за перемычкой, кПа", "ΔP отражения (справочно), кПа",
  ];
  const ws = wb.addWorksheet("Перемычки", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [7, 34, 36, 11, 12, 12, 12, 13, 13, 11, 22, 13, 13, 14].map(width => ({ width }));
  title(ws, 1, "Действие ударной волны на перемычки", headers.length);
  ws.mergeCells(2, 1, 2, headers.length);
  ws.getCell(2, 1).value = "Разрушение — при ΔP во фронте ≥ давления разрушения (табл. 8 методики ВГСЧ). Устоявшая перемычка волну останавливает. Перемычки — по порядку прихода волны; время — от момента взрыва, t = d / D (D — средняя скорость фронта на пути).";
  ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: "FF6B7280" } };

  const brById = new Map(inp.branches.map(b => [b.id, b]));
  const symById = new Map(inp.symbols.map(s => [s.id, s]));
  const list = [...inp.barriers.values()].flat();
  const firstRes = [...inp.resultByBranch.values()][0];
  const arrival = (key: string) => {
    const h = inp.barrierHits.get(key);
    if (!h || !(h.incident_kPa > 0)) return null;
    return barrierArrival(h, h.srcId ? inp.resultByBranch.get(h.srcId) : firstRes, waveFrontSpeed);
  };
  const arr = new Map(list.map(b => [b.key, arrival(b.key)]));
  // По порядку прихода волны; перемычки, до которых волна не дошла, — в конце
  list.sort((a, b) => (arr.get(a.key)?.t0_ms ?? Infinity) - (arr.get(b.key)?.t0_ms ?? Infinity));

  const tones: Tone[] = [];
  const rows: Cell[][] = list.map((bar, i) => {
    const h = inp.barrierHits.get(bar.key);
    const fp = bar.failure_MPa * 1000;
    const a = arr.get(bar.key);
    let state: string, tone: Tone;
    if (!h || !(h.incident_kPa > 0)) { state = "волна не дошла"; tone = "muted"; }
    else if (h.destroyed) { state = "РАЗРУШЕНА"; tone = "bad"; }
    else { state = "устояла"; tone = "ok"; }
    tones.push(tone);
    return [
      i + 1, barrierDisplayName(symById.get(bar.key), brById.get(bar.branchId), bar.branchId),
      label(brById.get(bar.branchId), bar.branchId), r1(bar.t * 100, 0),
      a ? r1(a.d_m, 0) : null, a ? r1(a.t0_ms, 1) : null, a ? r1(a.theta_ms, 1) : null,
      r1(fp, 1),
      h ? r1(h.incident_kPa, 1) : null,
      h && fp > 0 && h.incident_kPa > 0 ? r1(fp / h.incident_kPa, 2) : null,
      state,
      h ? r1(h.transmit * 100, 0) : null,
      h ? r1(h.incident_kPa * h.transmit, 1) : null,
      h ? r1(h.reflected_kPa, 1) : null,
    ];
  });
  if (rows.length === 0) rows.push(["", "Перемычек на схеме нет", "", null, null, null, null, null, null, null, "", null, null, null]);
  table(ws, 3, headers, rows, {
    tones, align: ["center", "left", "left", "right", "right", "right", "right", "right", "right", "right", "center"],
    numFmt: [undefined, undefined, undefined, "0", "#,##0", "#,##0.0", "0.0", "#,##0.0", "#,##0.0", "0.00", undefined, "0", "#,##0.0", "#,##0.0"],
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };
}

// ─── Лист «Выработки» ────────────────────────────────────────────────────────
function buildBranchesSheet(wb: ExcelJSNs.Workbook, inp: ExplosionReportInput, label: ReturnType<typeof makeLabel>) {
  const headers = ["№ п/п", "Выработка", "Длина, м", "Сечение, м²", "ΔP волны, кПа", "Перемычка разрушена"];
  const ws = wb.addWorksheet("Выработки", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [7, 50, 11, 12, 14, 14].map(width => ({ width }));
  title(ws, 1, "Давление ударной волны по выработкам", headers.length);
  const list = inp.branches
    .filter(b => (b.explosionComputedDeltaP ?? 0) > 0 || b.hasExplosion)
    .sort((a, b) => (b.explosionComputedDeltaP ?? 0) - (a.explosionComputedDeltaP ?? 0));
  const rows: Cell[][] = list.map((b, i) => [
    i + 1, label(b) + (b.hasExplosion ? " — очаг" : ""), r1(b.length, 0), r1(b.area, 1),
    r1(b.explosionComputedDeltaP, 1), b.bulkheadDestroyedByExplosion ? "да" : "",
  ]);
  if (rows.length === 0) rows.push(["", "Нет данных", null, null, null, ""]);
  table(ws, 3, headers, rows, {
    tones: list.map(b => b.bulkheadDestroyedByExplosion ? "bad" : undefined),
    align: ["center", "left", "right", "right", "right", "center"],
    numFmt: [undefined, undefined, "#,##0", "0.0", "#,##0.0"],
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };
}

// ─── Экспорт ─────────────────────────────────────────────────────────────────
export async function exportExplosionReport(inp: ExplosionReportInput): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ПВ-Система";
  wb.created = new Date();
  const label = makeLabel(inp.nodes);
  buildProtocolSheet(wb, inp, label);
  buildBarriersSheet(wb, inp, label);
  buildBranchesSheet(wb, inp, label);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const date = new Date().toISOString().slice(0, 10);
  const safe = (inp.projectName || "рудник").replace(/[\\/:*?"<>|]+/g, "_");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Протокол_расчёта_взрыва_${safe}_${date}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
