// ─────────────────────────────────────────────────────────────────────────────
// explosionReport.ts — «Протокол расчёта последствий взрыва» в Excel (.xlsx).
//
// Книга собирается из того же результата, по которому окрашена схема
// (runExplosionMode): отдельного пересчёта здесь нет, чтобы протокол
// не мог разойтись со схемой.
//   • «Протокол»   — очаги, параметры волны, радиусы зон поражения, вывод
//   • «Перемычки»  — давление волны и отражения, устояла ли, доля прошедшей волны
//   • «Выработки»  — давление волны по выработкам, куда она дошла
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";
import { type TopoBranch, type TopoNode } from "@/lib/topology";
import { type ExplosionResult } from "@/lib/explosionCalculator";
import { type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";
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

const COLS = 8;
const num = (v: number | undefined, d = 1): string =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: 0 });

// ─── Стили (как в протоколе взрывоопасности) ─────────────────────────────────
const border = (rgb: string) => ({
  top: { style: "thin", color: { rgb } }, bottom: { style: "thin", color: { rgb } },
  left: { style: "thin", color: { rgb } }, right: { style: "thin", color: { rgb } },
});
const titleStyle = (): XLSX.CellStyle => ({
  font: { bold: true, sz: 12 }, alignment: { horizontal: "center", vertical: "center", wrapText: true },
});
const sectionStyle = (): XLSX.CellStyle => ({ font: { bold: true, sz: 10 } });
const headerStyle = (): XLSX.CellStyle => ({
  font: { bold: true, sz: 9, color: { rgb: "1F3864" } },
  fill: { fgColor: { rgb: "DCE6F1" }, patternType: "solid" },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: border("8EA9C1"),
} as XLSX.CellStyle);
type Tone = "bad" | "ok" | "muted" | undefined;
const cellStyle = (i: number, tone?: Tone): XLSX.CellStyle => {
  const fill = tone === "bad" ? "FFC7CE" : tone === "ok" ? "C6EFCE" : i % 2 === 0 ? "FFFFFF" : "F2F5FB";
  const color = tone === "bad" ? "9C0006" : tone === "ok" ? "006100" : tone === "muted" ? "7F7F7F" : "000000";
  return {
    font: { sz: 9, color: { rgb: color }, bold: tone === "bad" },
    fill: { fgColor: { rgb: fill }, patternType: "solid" },
    alignment: { vertical: "center", wrapText: true },
    border: border("D0D8E8"),
  } as XLSX.CellStyle;
};
function style(ws: XLSX.WorkSheet, r: number, c: number, s: XLSX.CellStyle) {
  const ref = XLSX.utils.encode_cell({ r, c });
  if (!ws[ref]) ws[ref] = { t: "s", v: "" };
  ws[ref].s = s;
}

// ─── Подписи ─────────────────────────────────────────────────────────────────
function makeLabel(nodes: TopoNode[]) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  return (b: TopoBranch | undefined, id?: string) => {
    if (!b) return id ? `Ветвь ${id}` : "—";
    const fn = byId.get(b.fromId);
    const tn = byId.get(b.toId);
    const nm = b.type || `Ветвь ${b.id}`;
    return `${nm} (${fn?.number || fn?.id || "?"}→${tn?.number || tn?.id || "?"})`;
  };
}

function sourceLabel(b: TopoBranch): string {
  const t = b.explosionSourceType ?? "mass";
  if (t === "gas") return `Газ: ${b.explosionGasId ?? "methane"}`;
  return `ВВ: ${b.explosionExplosiveId ?? "ammonit"}, ${num(b.explosionExplosiveMass ?? 100)} кг`;
}

// ─── Лист «Протокол» ─────────────────────────────────────────────────────────
function buildProtocolSheet(inp: ExplosionReportInput, label: ReturnType<typeof makeLabel>): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];
  const titles: number[] = [], sections: number[] = [], heads: number[] = [];
  const rowTone = new Map<number, Tone>();
  const push = (...row: (string | number)[]) => { aoa.push(row); return aoa.length - 1; };
  const wide = (text: string) => {
    const r = push(text);
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
    return r;
  };

  push("", "", "", "", "", "УТВЕРЖДАЮ:");
  push("", "", "", "", "", "Руководитель горноспасательных работ");
  push("");
  push("", "", "", "", "", "_______________");
  push("", "", "", "", "", `«____»___________ ${new Date().getFullYear()} г.`);
  push("");
  titles.push(wide("ПРОТОКОЛ"));
  titles.push(wide("расчёта параметров воздушной ударной волны и последствий взрыва"));
  titles.push(wide(`«${inp.projectName}»`));
  wide(
    "Условия расчёта: " +
    (inp.duringEmergency ? "в ходе ликвидации аварии (время загазирования — фактическое, не менее 150 мин)"
      : "при разработке ПЛА (время загазирования 60 мин)") + ".",
  );
  push("");

  // 1. Очаги
  const srcBranches = inp.branches.filter(b => b.hasExplosion);
  sections.push(wide("1. ОЧАГИ ВЗРЫВА И ПАРАМЕТРЫ ВОЛНЫ"));
  heads.push(push("№", "Выработка-очаг", "Источник", "Q_тнт, кг", "ΔP_max, кПа", "I_max, Па·с", "D, м/с", "Примечание"));
  srcBranches.forEach((b, i) => {
    const r = inp.resultByBranch.get(b.id);
    const row = push(
      i + 1, label(b), sourceLabel(b),
      r && !r.noExplosion ? num(r.q_tnt_kg, 2) : "—",
      r && !r.noExplosion ? num(r.maxDeltaP_kPa) : "—",
      r && !r.noExplosion ? num(r.maxImpulse_Pas) : "—",
      r && !r.noExplosion ? num(r.waveFrontSpeed_ms, 0) : "—",
      !r ? "нет результата" : r.noExplosion ? `Взрыв не происходит: ${r.noExplosionReason ?? "смесь не взрывоопасна"}` : "",
    );
    rowTone.set(row, r?.noExplosion ? "muted" : undefined);
  });
  push("");

  // 2. Зоны поражения
  sections.push(wide("2. РАДИУСЫ ЗОН ПОРАЖЕНИЯ (для одиночной прямой выработки)"));
  heads.push(push("Выработка-очаг", "Зона", "", "Радиус, м", "ΔP, кПа", "I, Па·с", "Характеристика", ""));
  merges.push({ s: { r: aoa.length - 1, c: 1 }, e: { r: aoa.length - 1, c: 2 } });
  srcBranches.forEach(b => {
    const r = inp.resultByBranch.get(b.id);
    if (!r || r.noExplosion) return;
    r.zones.forEach(z => {
      const row = push(label(b), z.name, "", num(z.radius_m, 0), num(z.deltaP_kPa), num(z.impulse_Pas), z.description, "");
      merges.push({ s: { r: row, c: 1 }, e: { r: row, c: 2 } });
      merges.push({ s: { r: row, c: 6 }, e: { r: row, c: 7 } });
      rowTone.set(row, z.hazardLevel === "lethal" || z.hazardLevel === "heavy" ? "bad" : undefined);
    });
  });
  push("");

  // 3. Сводка по перемычкам
  const hits = [...inp.barrierHits.values()];
  const destroyed = hits.filter(h => h.destroyed).length;
  const held = hits.filter(h => !h.destroyed && h.transmit === 0 && h.incident_kPa > 0).length;
  const total = [...inp.barriers.values()].reduce((s, l) => s + l.length, 0);
  sections.push(wide("3. ПЕРЕМЫЧКИ (подробно — лист «Перемычки»)"));
  push("Всего перемычек на схеме", total);
  push("Волна дошла", hits.length);
  push("Разрушено", destroyed);
  push("Устояли", held);
  push("Волна не дошла", Math.max(0, total - hits.length));
  push("");

  // 4. Предупреждения
  const warns = [...new Set([...inp.resultByBranch.values()].flatMap(r => r.warnings))];
  if (warns.length) {
    sections.push(wide("ПРИМЕЧАНИЯ"));
    warns.forEach(w => wide(`• ${w}`));
    push("");
  }

  wide("Расчёт выполнен в программном комплексе «ПВ-Система».");
  push("");
  push("Расчёт выполнил", "_______________________");
  push("Дата", new Date().toLocaleDateString("ru-RU"));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 36 }, { wch: 30 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 26 }, { wch: 30 }];
  ws["!merges"] = merges;
  titles.forEach(r => style(ws, r, 0, titleStyle()));
  sections.forEach(r => style(ws, r, 0, sectionStyle()));
  heads.forEach(r => { for (let c = 0; c < COLS; c++) style(ws, r, c, headerStyle()); });
  let i = 0;
  rowTone.forEach((tone, r) => { for (let c = 0; c < COLS; c++) style(ws, r, c, cellStyle(i, tone)); i++; });
  return ws;
}

// ─── Лист «Перемычки» ────────────────────────────────────────────────────────
const BAR_HEADERS = [
  "№ п/п", "Перемычка", "Выработка", "Положение на ветви, %",
  "Прочность (давление разрушения), кПа", "ΔP набегающей волны, кПа",
  "ΔP отражения, кПа", "Запас прочности", "Состояние",
  "Доля волны за перемычкой, %", "ΔP за перемычкой, кПа",
];

function buildBarriersSheet(inp: ExplosionReportInput, label: ReturnType<typeof makeLabel>): XLSX.WorkSheet {
  const brById = new Map(inp.branches.map(b => [b.id, b]));
  const symById = new Map(inp.symbols.map(s => [s.id, s]));
  const list = [...inp.barriers.values()].flat();
  // Сначала те, куда дошла волна, — по убыванию давления отражения.
  list.sort((a, b) => (inp.barrierHits.get(b.key)?.reflected_kPa ?? -1) - (inp.barrierHits.get(a.key)?.reflected_kPa ?? -1));

  const aoa: (string | number)[][] = [["Действие ударной волны на перемычки"], [], [...BAR_HEADERS]];
  const tones: Tone[] = [];
  list.forEach((bar, i) => {
    const h = inp.barrierHits.get(bar.key);
    const sym = symById.get(bar.key);
    const name = sym?.label || sym?.description || (sym ? `Перемычка ${i + 1}` : "Перемычка (без значка)");
    const fp = bar.failure_MPa > 0 ? bar.failure_MPa * 1000 : 0;
    let state: string, tone: Tone;
    if (!h || !(h.incident_kPa > 0)) { state = "волна не дошла"; tone = "muted"; }
    else if (!(fp > 0)) { state = "прочность не задана — волну не задерживает"; tone = "muted"; }
    else if (h.destroyed) { state = "РАЗРУШЕНА"; tone = "bad"; }
    else { state = "устояла"; tone = "ok"; }
    tones.push(tone);
    aoa.push([
      i + 1, name, label(brById.get(bar.branchId), bar.branchId), num(bar.t * 100, 0),
      fp > 0 ? num(fp) : "не задана",
      h ? num(h.incident_kPa) : "—",
      h ? num(h.reflected_kPa) : "—",
      h && fp > 0 && h.reflected_kPa > 0 ? num(fp / h.reflected_kPa, 2) : "—",
      state,
      h ? num(h.transmit * 100, 0) : "—",
      h ? num(h.incident_kPa * h.transmit) : "—",
    ]);
  });
  if (list.length === 0) aoa.push(["", "Перемычек на схеме нет"]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [8, 26, 34, 12, 16, 14, 14, 12, 30, 14, 14].map(wch => ({ wch }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: BAR_HEADERS.length - 1 } }];
  style(ws, 0, 0, titleStyle());
  for (let c = 0; c < BAR_HEADERS.length; c++) style(ws, 2, c, headerStyle());
  tones.forEach((t, i) => { for (let c = 0; c < BAR_HEADERS.length; c++) style(ws, 3 + i, c, cellStyle(i, t)); });
  return ws;
}

// ─── Лист «Выработки» ────────────────────────────────────────────────────────
function buildBranchesSheet(inp: ExplosionReportInput, label: ReturnType<typeof makeLabel>): XLSX.WorkSheet {
  const headers = ["№ п/п", "Выработка", "Длина, м", "Сечение, м²", "ΔP волны, кПа", "Перемычка разрушена"];
  const list = inp.branches
    .filter(b => (b.explosionComputedDeltaP ?? 0) > 0 || b.hasExplosion)
    .sort((a, b) => (b.explosionComputedDeltaP ?? 0) - (a.explosionComputedDeltaP ?? 0));
  const aoa: (string | number)[][] = [["Давление ударной волны по выработкам"], [], headers];
  list.forEach((b, i) => aoa.push([
    i + 1, label(b) + (b.hasExplosion ? " — очаг" : ""), num(b.length, 0), num(b.area, 1),
    num(b.explosionComputedDeltaP), b.bulkheadDestroyedByExplosion ? "да" : "",
  ]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [8, 44, 10, 12, 14, 16].map(wch => ({ wch }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  style(ws, 0, 0, titleStyle());
  for (let c = 0; c < headers.length; c++) style(ws, 2, c, headerStyle());
  list.forEach((b, i) => {
    for (let c = 0; c < headers.length; c++) style(ws, 3 + i, c, cellStyle(i, b.bulkheadDestroyedByExplosion ? "bad" : undefined));
  });
  return ws;
}

// ─── Экспорт ─────────────────────────────────────────────────────────────────
export function exportExplosionReport(inp: ExplosionReportInput): void {
  const label = makeLabel(inp.nodes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildProtocolSheet(inp, label), "Протокол");
  XLSX.utils.book_append_sheet(wb, buildBarriersSheet(inp, label), "Перемычки");
  XLSX.utils.book_append_sheet(wb, buildBranchesSheet(inp, label), "Выработки");
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Протокол_расчёта_взрыва_${inp.projectName || "рудник"}_${date}.xlsx`);
}
