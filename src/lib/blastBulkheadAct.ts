// ─────────────────────────────────────────────────────────────────────────────
// blastBulkheadAct.ts — выгрузка «Акта расчёта толщины взрывоустойчивой
// изолирующей перемычки» в Excel по РБ № 343 от 08.11.2024, п. 25–27,
// формулы (6)–(7). Один акт — одна рассчитанная перемычка.
// ─────────────────────────────────────────────────────────────────────────────
import { BLAST_SAFETY_FACTOR, BLAST_THICKNESS_MIN, BLAST_THICKNESS_MAX, type BlastBulkheadResult } from "@/lib/blastBulkhead";

export interface BlastBulkheadActInput {
  projectName: string;
  /** Место установки: выработка, узлы. */
  place: string;
  /** Откуда давление: расчёт взрыва по схеме / ввод вручную. */
  pressureSource: string;
  /** Давление набегающей волны, кПа. */
  incident_kPa: number;
  /** Давление отражения, кПа. */
  reflected_kPa: number;
  height_m: number;
  width_m: number;
  dimsNote?: string;
  mixName: string;
  mixNote: string;
  ageLabel: string;
  rBend_MPa: number;
  duringEmergency: boolean;
  result: BlastBulkheadResult;
}

const LINE = { style: "thin" as const, color: { argb: "FF7F8FA6" } };
const BOX = { top: LINE, left: LINE, bottom: LINE, right: LINE };

export async function exportBlastBulkheadAct(a: BlastBulkheadActInput): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ПВ-Система";
  const ws = wb.addWorksheet("Акт", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 6 }, { width: 52 }, { width: 14 }, { width: 18 }, { width: 30 }];
  const COLS = 5;

  const merge = (r: number, text: string, opts: { bold?: boolean; size?: number; center?: boolean; italic?: boolean } = {}) => {
    ws.mergeCells(r, 1, r, COLS);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { bold: opts.bold, size: opts.size ?? 11, italic: opts.italic };
    c.alignment = { horizontal: opts.center ? "center" : "left", vertical: "middle", wrapText: true };
  };

  ws.getCell(1, 4).value = "УТВЕРЖДАЮ:";
  ws.getCell(1, 4).font = { bold: true };
  ws.getCell(2, 4).value = "Главный инженер";
  ws.getCell(4, 4).value = "_______________";
  ws.getCell(5, 4).value = `«____»___________ ${new Date().getFullYear()} г.`;

  let r = 7;
  merge(r++, "АКТ", { bold: true, size: 14, center: true });
  merge(r++, "расчёта толщины взрывоустойчивой изолирующей перемычки", { bold: true, size: 12, center: true });
  merge(r++, `«${a.projectName}»`, { center: true });
  r++;
  merge(r++, `Место установки: ${a.place}`);
  merge(r++, "Основание: Руководство по безопасности, утв. приказом Ростехнадзора от 08.11.2024 № 343, п. 25–27, формулы (6)–(7).");
  merge(r++, `Условия расчёта: ${a.duringEmergency
    ? "в ходе работ по локализации и ликвидации аварии (прочность раствора через 24 ч, п. 27)."
    : "при плановом проектировании (прочность раствора в проектном возрасте, п. 27)."}`);
  r++;

  const head = (row: number, cells: string[]) => {
    cells.forEach((t, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = t;
      c.font = { bold: true, color: { argb: "FF173D52" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD7E7EE" } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = BOX;
    });
    ws.getRow(row).height = 22;
  };
  const line = (row: number, cells: (string | number)[], opts: { bold?: boolean; fill?: string; fmt?: string } = {}) => {
    cells.forEach((v, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = v;
      c.border = BOX;
      c.font = { bold: opts.bold };
      c.alignment = { vertical: "middle", wrapText: true, horizontal: typeof v === "number" ? "right" : i === 0 ? "center" : "left" };
      if (typeof v === "number" && opts.fmt) c.numFmt = opts.fmt;
      if (opts.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
    });
  };

  merge(r++, "1. ИСХОДНЫЕ ДАННЫЕ", { bold: true });
  head(r++, ["№", "Параметр", "Обозначение", "Значение", "Источник"]);
  const res = a.result;
  const data: (string | number)[][] = [
    [1, "Давление во фронте ударной волны у перемычки, МПа", "ΔP", +(a.incident_kPa / 1000).toFixed(4), a.pressureSource],
    [2, "Избыточное давление отражения, МПа", "ΔPотр", +(a.reflected_kPa / 1000).toFixed(4), "ΔPотр = 2ΔP + 6ΔP²/(ΔP + 7P₀), п. 25"],
    [3, "Высота перемычки (выработки), м", "h", a.height_m, a.dimsNote || "по сечению выработки, п. 26"],
    [4, "Ширина перемычки (выработки), м", "w", a.width_m, a.dimsNote || "по сечению выработки, п. 26"],
    [5, "Материал перемычки", "—", a.mixName, a.mixNote],
    [6, "Возраст раствора", "—", a.ageLabel, "п. 27"],
    [7, "Предел прочности на растяжение при изгибе, МПа", "Rраст", a.rBend_MPa, "по паспорту изделия, п. 27"],
    [8, "Коэффициент запаса прочности", "kз", BLAST_SAFETY_FACTOR, "п. 26"],
  ];
  data.forEach(d => line(r++, d));
  r++;

  merge(r++, "2. РАСЧЁТ", { bold: true });
  const small = res.formula === 6 ? "h" : "w";
  const big = res.formula === 6 ? "w" : "h";
  merge(r++, `Расчётная схема — шарнирно опёртая прямоугольная плита. Так как ${res.formula === 6 ? "h ≤ w" : "h > w"}, применяется формула (${res.formula}):`);
  merge(r++, `m = ${small}·√( ΔPотр·(3 − 2·${small}/${big}) / (24·Rраст·kз) )`, { bold: true, center: true });
  const under = (a.reflected_kPa / 1000) * (3 - 2 * res.ratio) / (24 * a.rBend_MPa * BLAST_SAFETY_FACTOR);
  merge(r++, `m = ${res.span_m}·√( ${(a.reflected_kPa / 1000).toFixed(4)}·(3 − 2·${res.ratio}) / (24·${a.rBend_MPa}·${BLAST_SAFETY_FACTOR}) ) = ${res.span_m}·√${under.toFixed(5)} = ${res.thicknessRaw_m} м`, { center: true });
  r++;

  merge(r++, "3. РЕЗУЛЬТАТ", { bold: true });
  head(r++, ["№", "Показатель", "Обозначение", "Значение", "Примечание"]);
  line(r++, [1, "Толщина по расчёту, м", "m", res.thicknessRaw_m, `формула (${res.formula})`], { fmt: "0.00" });
  line(r++, [2, "Принятая толщина перемычки, м", "m", res.thickness_m, res.note], {
    bold: true, fill: res.clampedMax ? "FFFFC7CE" : "FFC6EFCE", fmt: "0.00",
  });
  r++;
  merge(r++, `Примечание: по п. 26 толщина менее ${BLAST_THICKNESS_MIN} м не принимается; при расчётной толщине более ${BLAST_THICKNESS_MAX} м схема шарнирно опёртой плиты неприменима — требуются дополнительные решения.`, { italic: true, size: 9 });
  if (res.clampedMax) merge(r++, "ВНИМАНИЕ: расчётная толщина превышает 5 м.", { bold: true });
  ws.getRow(r - 1).height = 30;
  r++;

  merge(r++, "Расчёт выполнен в программном комплексе «ПВ-Система».", { size: 9, italic: true });
  r++;
  ws.getCell(r, 2).value = "Расчёт выполнил: ____________________ / ______________ /";
  r += 2;
  ws.getCell(r, 2).value = "Проверил: ____________________ / ______________ /";
  r += 2;
  ws.getCell(r, 2).value = `Дата: ${new Date().toLocaleDateString("ru-RU")}`;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const safe = (a.projectName || "рудник").replace(/[\\/:*?"<>|]+/g, "_");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Акт_взрывоустойчивой_перемычки_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
