// ─────────────────────────────────────────────────────────────────────────────
// stabilityActExport.ts — Формирование «Акта проверки устойчивости вентиляционных
// режимов при пожаре» в Excel (.xlsx) по образцу акта ЮПР (ориентир: «АэроСеть»).
//
// Книга (как в образце):
//   • Титул — «УТВЕРЖДАЮ», заголовок акта, состав комиссии, вводная часть
//   • «нисх накл.», «нисх верт.», «восх накл.», «восх верт.» — Таблицы №1–4
//   • «Мероприятия» — Таблица №5, меры по группам выработок
//   • «Выводы» — выводы комиссии и подписи
//
// Оформление печати (по ГОСТ Р 7.0.97 для документов):
//   поля: левое 3 см, правое 1 см, верхнее и нижнее 2 см; A4, альбомная;
//   масштаб «вписать по ширине», повтор шапки таблицы на каждой странице,
//   нумерация листов в нижнем колонтитуле. Шрифт Times New Roman, чёрные рамки.
//
// Используется ExcelJS: бесплатная сборка SheetJS (xlsx 0.18) стили и
// параметры страницы в файл не записывает.
// ─────────────────────────────────────────────────────────────────────────────

import type ExcelJSNS from "exceljs";
import type { StabilityResult, StabilityRow, StabilityCategory } from "./fireStability";

type Workbook = ExcelJSNS.Workbook;
type Worksheet = ExcelJSNS.Worksheet;
type Cell = ExcelJSNS.Cell;

export interface ActMeta {
  projectName: string;   // название проекта/рудника
  orgName: string;       // организация
  approverTitle: string; // должность утверждающего
  approverName: string;  // ФИО утверждающего
  period: string;        // период действия
  date: string;          // дата акта (строка)
  /** Председатель комиссии: должность и ФИО. */
  chairman?: { title: string; name: string };
  /** Члены комиссии. */
  members?: { title: string; name: string }[];
  /** Период проведения проверки, напр. «с "04" мая 2026 г. по "29" мая 2026 г.». */
  checkPeriod?: string;
  /** Организация в блоке «УТВЕРЖДАЮ» (напр. ЮПР ООО "Башкирская медь"). */
  approverOrg?: string;
  /** Год в строке даты утверждения. */
  approveYear?: string;
  /** Наименование объекта в заголовке акта (без кавычек «»). */
  objectTitle?: string;
  /** Логотип (data URL png/jpeg) в левом верхнем углу титула. */
  logoDataUrl?: string;
}

const DEFAULT_META: ActMeta = {
  projectName: "Подземный рудник",
  orgName: "",
  approverTitle: "Главный инженер",
  approverName: "",
  period: "II полугодие 2026 г.",
  date: new Date().toLocaleDateString("ru-RU"),
};

// ─── Параметры печати ────────────────────────────────────────────────────────
const CM = 1 / 2.54; // сантиметры → дюймы (ExcelJS задаёт поля в дюймах)
const PAGE_MARGINS = {
  left: 3 * CM,
  right: 1 * CM,
  top: 2 * CM,
  bottom: 2 * CM,
  header: 0.8 * CM,
  footer: 0.8 * CM,
};

const FONT = "Times New Roman";
const LINE = { style: "thin" as const, color: { argb: "FF000000" } };
const BOX = { top: LINE, left: LINE, bottom: LINE, right: LINE };
const HEAD_FILL: ExcelJSNS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
const NUM_FILL: ExcelJSNS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
const GROUP_FILL: ExcelJSNS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F7" } };
const BAD_FILL: ExcelJSNS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E2" } };

function addSheet(wb: Workbook, name: string, orientation: "landscape" | "portrait" = "landscape"): Worksheet {
  const ws = wb.addWorksheet(name, {
    pageSetup: {
      paperSize: 9, // A4
      orientation,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0, // по высоте — сколько потребуется
      horizontalCentered: true,
      margins: PAGE_MARGINS,
    },
    views: [{ showGridLines: false }],
  });
  ws.headerFooter.oddFooter = "&R&9Лист &P из &N";
  ws.properties.defaultRowHeight = 15;
  return ws;
}

// ─── Оценка высоты строки ────────────────────────────────────────────────────
// Excel не подбирает высоту объединённых ячеек и ячеек с переносом при открытии
// файла, созданного программно, — считаем её сами, иначе текст обрежется.
function linesFor(text: string, widthChars: number, fontSize: number): number {
  if (!text) return 1;
  // Ширина колонки задаётся в символах шрифта 11 pt; для другого кегля
  // вмещается пропорционально больше/меньше символов (с запасом ~10%).
  const perLine = Math.max(4, Math.floor(widthChars * (11 / fontSize) * 0.92));
  return String(text).split("\n").reduce((n, part) => {
    if (!part) return n + 1;
    // перенос по словам: считаем, сколько строк реально займёт абзац
    let lines = 1, cur = 0;
    for (const w of part.split(/\s+/)) {
      const len = w.length;
      if (cur === 0) cur = len;
      else if (cur + 1 + len <= perLine) cur += 1 + len;
      else { lines++; cur = len; }
      while (cur > perLine) { lines++; cur -= perLine; }
    }
    return n + lines;
  }, 0);
}
const heightFor = (lines: number, fontSize: number) => Math.max(15, Math.ceil(lines * fontSize * 1.32 + 4));

function colsWidth(ws: Worksheet, from: number, to: number): number {
  let s = 0;
  for (let c = from; c <= to; c++) s += ws.getColumn(c).width ?? 9;
  return s;
}

interface TextOpts {
  font?: string;
  bold?: boolean;
  italic?: boolean;
  size?: number;
  align?: "left" | "center" | "right" | "justify";
  indent?: boolean; // абзацный отступ
}

/** Абзац текста в объединённой строке с автоподбором высоты. */
function para(ws: Worksheet, row: number, c1: number, c2: number, text: string, o: TextOpts = {}): void {
  const size = o.size ?? 12;
  if (c2 > c1) ws.mergeCells(row, c1, row, c2);
  const cell = ws.getCell(row, c1);
  const value = o.indent ? `\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0${text}` : text;
  cell.value = value;
  cell.font = { name: o.font ?? FONT, size, bold: o.bold, italic: o.italic };
  cell.alignment = { horizontal: o.align ?? "left", vertical: "top", wrapText: true };
  const lines = linesFor(value, colsWidth(ws, c1, c2), size);
  const h = heightFor(lines, size);
  const r = ws.getRow(row);
  r.height = Math.max(r.height ?? 0, h);
}

function styleCell(cell: Cell, o: { size?: number; bold?: boolean; align?: "left" | "center" | "right" | "justify"; fill?: ExcelJSNS.Fill; numFmt?: string; color?: string }) {
  cell.font = { name: FONT, size: o.size ?? 10, bold: o.bold, color: o.color ? { argb: o.color } : undefined };
  cell.alignment = { horizontal: o.align ?? "center", vertical: "middle", wrapText: true };
  cell.border = BOX;
  if (o.fill) cell.fill = o.fill;
  if (o.numFmt) cell.numFmt = o.numFmt;
}

/** Шапка таблицы + строка нумерации граф (как в образце). Возвращает следующую строку. */
function tableHeader(ws: Worksheet, row: number, headers: string[], size = 9): number {
  const hr = ws.getRow(row);
  let maxLines = 1;
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    styleCell(c, { size, bold: true, fill: HEAD_FILL });
    maxLines = Math.max(maxLines, linesFor(h, ws.getColumn(i + 1).width ?? 9, size));
  });
  hr.height = heightFor(maxLines, size);
  const nr = ws.getRow(row + 1);
  headers.forEach((_, i) => {
    const c = nr.getCell(i + 1);
    c.value = i + 1;
    styleCell(c, { size: 8, bold: true, fill: NUM_FILL });
  });
  nr.height = 13;
  return row + 2;
}

/** Строка-разделитель группы внутри таблицы (на всю ширину). */
function groupRow(ws: Worksheet, row: number, ncols: number, text: string, opts: { bold?: boolean; fill?: ExcelJSNS.Fill } = {}) {
  ws.mergeCells(row, 1, row, ncols);
  const c = ws.getCell(row, 1);
  c.value = text;
  for (let i = 1; i <= ncols; i++) styleCell(ws.getCell(row, i), { size: 10, bold: opts.bold ?? true, fill: opts.fill ?? GROUP_FILL });
  ws.getRow(row).height = heightFor(linesFor(text, colsWidth(ws, 1, ncols), 10), 10);
}

// ─── Таблицы устойчивости ────────────────────────────────────────────────────
interface ColDef { header: string; width: number; numFmt?: string; align?: "left" | "center" | "justify" }

// Графы 1–13 совпадают с образцом; 14–18 — расчётные показатели по нормативу
// (тепловая/критическая депрессия, запас, p_у), которых в образце нет, но
// которые обосновывают вывод об устойчивости. «Пожарная нагрузка» — последняя.
const TABLE_COLS: ColDef[] = [
  { header: "№ п/п", width: 4.5 },
  { header: "№ ветви", width: 6.5 },
  { header: "Пози-ция", width: 6 },
  { header: "Наименование ветви", width: 24, align: "left" },
  { header: "Угол наклона, град", width: 7, numFmt: "0.00" },
  { header: "Длина, м", width: 8, numFmt: "0.00" },
  { header: "Сечение, м²", width: 7, numFmt: "0.0" },
  { header: "Скорость движения воздуха, м/с", width: 8.5, numFmt: "0.000" },
  { header: "Расход воздуха в выработке, м³/с", width: 9, numFmt: "0.000" },
  { header: "Скорость движения воздуха при пожаре, м/с", width: 8.5, numFmt: "0.000" },
  { header: "Расход воздуха в выработке при пожаре, м³/с", width: 9, numFmt: "0.000" },
  { header: "Расчётная мощность пожара, МВт", width: 8.5, numFmt: "0.00" },
  { header: "Расчётная темпера-тура пожара, °С", width: 9, numFmt: "0" },
  { header: "Тепловая депрессия hт, Па", width: 9, numFmt: "0.0" },
  { header: "Критическая депрессия hкр, Па", width: 9.5, numFmt: "0.0" },
  { header: "Запас до опрокиды-вания, Па", width: 9.5, numFmt: "0.0" },
  { header: "Показатель устойчи-вости pу", width: 9, numFmt: "0.00" },
  { header: "Степень устойчивости", width: 12 },
  { header: "Пожарная нагрузка", width: 34, align: "justify" },
];

const CATEGORY_META: Record<StabilityCategory, { sheet: string; title: string; table: number; group: string }> = {
  "descending-incline":  { sheet: "нисх накл.", table: 1, group: "Наклонные выработки с нисходящим проветриванием", title: "а) для наклонных выработок (с углом наклона 5° и более и длиной 30 м и более) с нисходящим проветриванием;" },
  "descending-vertical": { sheet: "нисх верт.", table: 2, group: "Вертикальные выработки с нисходящим проветриванием", title: "б) для вертикальных выработок с нисходящим проветриванием;" },
  "ascending-incline":   { sheet: "восх накл.", table: 3, group: "Наклонные выработки с восходящим проветриванием", title: "в) для наклонных выработок (с углом наклона 5° и более и длиной 30 м и более) с восходящим проветриванием;" },
  "ascending-vertical":  { sheet: "восх верт.", table: 4, group: "Вертикальные выработки с восходящим проветриванием", title: "г) для вертикальных выработок с восходящим проветриванием;" },
};

const CATEGORY_ORDER: StabilityCategory[] = [
  "descending-incline", "descending-vertical", "ascending-incline", "ascending-vertical",
];

const r2 = (v: number | null | undefined) => (v == null || !isFinite(v) ? null : v);

function buildTableSheet(wb: Workbook, cat: StabilityCategory, rows: StabilityRow[]): void {
  const meta = CATEGORY_META[cat];
  const ws = addSheet(wb, meta.sheet);
  const N = TABLE_COLS.length;
  TABLE_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  para(ws, 1, 1, N, meta.title, { bold: true, size: 11 });
  const t = ws.getCell(2, N);
  t.value = `Таблица №${meta.table}`;
  t.font = { name: FONT, size: 10, italic: true };
  t.alignment = { horizontal: "right" };

  let row = tableHeader(ws, 3, TABLE_COLS.map(c => c.header));
  // Шапка и нумерация граф повторяются на каждой печатной странице
  ws.pageSetup.printTitlesRow = "3:4";
  ws.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];

  if (rows.length === 0) {
    groupRow(ws, row++, N, "Выработки, удовлетворяющие условиям отбора, отсутствуют", { bold: false, fill: { type: "pattern", pattern: "none" } });
  }

  rows.forEach(r => {
    const values: (string | number | null)[] = [
      r.index, r.branchNumber, r.position || "—", r.name,
      r2(r.angleDeg), r2(r.length), r2(r.area),
      r2(r.velocityNormal), r2(r.flowNormal), r2(r.velocity), r2(r.flow),
      r2(r.firePower_MW), r2(r.fireTemp_C), r2(r.thermalDep_Pa),
      // «не опр.» — коротко в узкой графе; полная причина под таблицей
      r.hKr_Pa != null ? r.hKr_Pa : "не опр.",
      r.marginDep_Pa != null ? r.marginDep_Pa : "не опр.",
      r.p_u != null ? r.p_u : "не опр.",
      r.stability,
      r.fireLoadDesc || "Пожарная нагрузка отсутствует",
    ];
    const xr = ws.getRow(row);
    let maxLines = 1;
    values.forEach((v, i) => {
      const def = TABLE_COLS[i];
      const c = xr.getCell(i + 1);
      c.value = v ?? "—";
      styleCell(c, {
        size: 9,
        align: def.align ?? "center",
        numFmt: typeof v === "number" ? def.numFmt : undefined,
        fill: !r.stable && i === 17 ? BAD_FILL : undefined,
        bold: !r.stable && i === 17,
        color: !r.stable && i === 17 ? "FF9C0006" : undefined,
      });
      if (typeof v === "string") maxLines = Math.max(maxLines, linesFor(v, def.width, 9));
    });
    xr.height = heightFor(maxLines, 9);
    row++;
  });

  // ── Пояснения к графам «не опр.» ───────────────────────────────────────────
  const noted = rows.filter(r => r.critNote);
  if (noted.length > 0) {
    row++;
    para(ws, row++, 1, N, "Пояснения к графам «Критическая депрессия», «Запас до опрокидывания», «Показатель устойчивости»:", { bold: true, size: 10 });
    const byNote = new Map<string, string[]>();
    noted.forEach(r => {
      if (!byNote.has(r.critNote)) byNote.set(r.critNote, []);
      byNote.get(r.critNote)!.push(String(r.branchNumber));
    });
    byNote.forEach((ids, note) => para(ws, row++, 1, N, `Ветви № ${ids.join(", ")}: ${note}.`, { size: 10, align: "justify" }));
    para(ws, row++, 1, N, "Степень устойчивости для этих выработок определена по располагаемой депрессии участка.", { size: 10, italic: true });
  }

  // ── Приложение 7: критический расход Q₀ (восходящие) ───────────────────────
  const isAscending = cat === "ascending-incline" || cat === "ascending-vertical";
  const withQ0 = rows.filter(r => r.Q0_m3s != null);
  if (isAscending && withQ0.length > 0) {
    row++;
    para(ws, row++, 1, N, "Приложение 7. Критический расход воздуха Q₀ и условие устойчивости (7.1): hт < R·Q₀²", { bold: true, size: 11 });
    // Таблица Прил. 7 размещается в тех же колонках: «Наименование» — в графе 4
    const q0Headers: (string | null)[] = [
      null, "№ ветви", null, "Наименование выработки",
      "Q₁ (до пожара), м³/с", "h₁, Па", "R, Н·с²/м⁸", "a (табл. 7.1)",
      "Q₀ по (7.3), м³/с", "Q₀ по (7.4), м³/с", "Q₀ принят, м³/с", "Формула",
      "Удерж. депрессия R·Q₀², Па", "hт, Па", "Rр по (7.5)", "Rдоп по (7.6)",
    ];
    const q0Cols = q0Headers.map((h, i) => ({ h, c: i + 1 })).filter(x => x.h != null) as { h: string; c: number }[];
    const hr = ws.getRow(row);
    let ml = 1;
    q0Cols.forEach(({ h, c }) => {
      const cell = hr.getCell(c);
      cell.value = h;
      styleCell(cell, { size: 9, bold: true, fill: HEAD_FILL });
      ml = Math.max(ml, linesFor(h, ws.getColumn(c).width ?? 9, 9));
    });
    // «№ ветви» занимает графы 1–3, чтобы таблица не имела дыр
    ws.mergeCells(row, 1, row, 3);
    styleCell(ws.getCell(row, 1), { size: 9, bold: true, fill: HEAD_FILL });
    ws.getCell(row, 1).value = "№ ветви";
    hr.height = heightFor(ml, 9);
    row++;
    withQ0.forEach(r => {
      const vals: Record<number, string | number | null> = {
        4: r.name, 5: r2(r.flowNormal), 6: r2(r.branchDep_Pa), 7: r.R_fact,
        8: r.Q0_a, 9: r.Q0_73, 10: r.Q0_74, 11: r.Q0_m3s, 12: r.Q0_source,
        13: r.hKr_Pa, 14: r2(r.thermalDep_Pa), 15: r.R_calc, 16: r.R_dop ?? "не требуется",
      };
      ws.mergeCells(row, 1, row, 3);
      const first = ws.getCell(row, 1);
      first.value = r.branchNumber;
      styleCell(first, { size: 9 });
      for (let c = 4; c <= 16; c++) {
        const v = vals[c];
        const cell = ws.getCell(row, c);
        cell.value = v ?? "—";
        styleCell(cell, { size: 9, align: c === 4 ? "left" : "center", numFmt: typeof v === "number" ? (c === 7 || c === 15 || c === 16 ? "0.0000" : "0.000") : undefined });
      }
      ws.getRow(row).height = heightFor(linesFor(r.name, ws.getColumn(4).width ?? 24, 9), 9);
      row++;
    });
    row++;
    para(ws, row++, 1, N,
      "Примечание: Q₀ определён двумя ориентировочными способами норматива; принято меньшее значение как более строгая оценка (Q₀ входит в условие 7.1 в квадрате). Основная формула (7.2) требует данных натурных замеров депрессии и расхода до и после изменения сопротивления выработки.",
      { size: 10, italic: true, align: "justify" });
  }

  ws.pageSetup.printArea = `A1:${ws.getColumn(N).letter}${Math.max(row - 1, 5)}`;
}

// ─── Титульный лист ──────────────────────────────────────────────────────────
// Сетка из 10 колонок; подпись «УТВЕРЖДАЮ» — в правых колонках 7–10.
const TITLE_COLS = [14, 14, 14, 14, 14, 14, 14, 14, 14, 18];

const BODY_FONT = "Arial";

function buildTitleSheet(wb: Workbook, m: ActMeta, result: StabilityResult): void {
  const ws = addSheet(wb, "Титул");
  const N = TITLE_COLS.length;
  TITLE_COLS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Логотип организации — левый верхний угол (как в образце)
  if (m.logoDataUrl) {
    try {
      const ext = m.logoDataUrl.startsWith("data:image/jpeg") || m.logoDataUrl.startsWith("data:image/jpg") ? "jpeg" : "png";
      const id = wb.addImage({ base64: m.logoDataUrl, extension: ext });
      ws.addImage(id, { tl: { col: 0.1, row: 0.1 }, ext: { width: 120, height: 76 }, editAs: "oneCell" });
    } catch { /* логотип необязателен */ }
  }

  // Блок «УТВЕРЖДАЮ» — справа, жирный Times
  const right = (row: number, text: string) => para(ws, row, 7, N, text, { bold: true, align: "right" });
  const year = m.approveYear || String(new Date().getFullYear());
  right(1, "У Т В Е Р Ж Д А Ю:");
  right(2, m.approverTitle);
  const apOrg = m.approverOrg ?? m.orgName;
  if (apOrg) right(3, apOrg);
  right(5, `_________________ ${m.approverName || "_______________"}`);
  right(7, `«_____»____________________${year} г.`);

  // Заголовок акта
  let row = 9;
  const objectTitle = m.objectTitle || m.projectName;
  const head = (t: string, size = 14) => para(ws, row++, 1, N, t, { bold: true, size, align: "center" });
  head("АКТ", 16);
  head("проверки устойчивости вентиляционных режимов в горных выработках");
  head(`«${objectTitle}»${m.orgName ? " " + m.orgName : ""}  при воздействии тепловой депрессии`);
  head("и оценка эффективности принятых мер по предотвращению самопроизвольного опрокидывания");
  head("вентиляционной струи при пожаре");
  head(`(к ПМЛЛПА на ${m.period})`);
  row++;

  // Состав комиссии: должность слева, ФИО справа
  const body: TextOpts = { font: BODY_FONT, size: 11 };
  para(ws, row++, 1, N, "Комиссия в составе:", body);
  para(ws, row++, 1, N, "председателя комиссии:", { ...body, italic: true });
  const person = (p?: { title: string; name: string }) => {
    para(ws, row, 1, 8, p?.title || "_____________________________________________", body);
    para(ws, row, 9, N, p?.name || "______________________", body);
    row++;
  };
  person(m.chairman ?? (m.approverName ? { title: `${m.approverTitle.toLowerCase()}${apOrg ? " " + apOrg : ""}`, name: m.approverName } : undefined));
  para(ws, row++, 1, N, "члены комиссии:", { ...body, italic: true });
  const members = m.members && m.members.length > 0 ? m.members : [undefined, undefined, undefined];
  members.forEach(p => person(p));
  row++;

  para(ws, row++, 1, N,
    `${m.checkPeriod ? "в период " + m.checkPeriod : "в период с \"___\" __________ 20__ года по \"___\" __________ 20__ года"} провела проверку устойчивости проветривания горных выработок, эффективности принятых мер по предотвращению самопроизвольного опрокидывания вентиляционной струи при пожаре и определение критической депрессии и установила:`,
    { ...body, align: "justify" });

  // П. 1 — номер жирным, текст обычным (rich text)
  {
    const r = row++;
    ws.mergeCells(r, 1, r, N);
    const c = ws.getCell(r, 1);
    const t = "  На руднике определена устойчивость проветривания при пожаре в наклонных и вертикальных горных выработках, в том числе:";
    c.value = { richText: [
      { text: "1.", font: { name: BODY_FONT, size: 11, bold: true } },
      { text: t, font: { name: BODY_FONT, size: 11 } },
    ] };
    c.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    ws.getRow(r).height = heightFor(linesFor("1." + t, colsWidth(ws, 1, N), 11), 11);
  }
  para(ws, row++, 1, N,
    `Определение устойчивости проветривания горных выработок производилось на основе топологии горных выработок рудника с подземным способом разработки «${objectTitle}»${m.orgName ? " " + m.orgName : ""}, с использованием программного обеспечения «ПВ-Система». Мощность пожара рассчитывалась с использованием справочника пожарной нагрузки (Документ СИТИС-СПН-1, редакция 2 от 15.05.2014г.).`,
    { ...body, align: "justify" });

  const cnt = (c: StabilityCategory) => result.byCategory[c].length;
  CATEGORY_ORDER.forEach(c => {
    const cm = CATEGORY_META[c];
    para(ws, row++, 1, N, `${cm.title.replace(/;$/, "")} — ${cnt(c)} (Таблица №${cm.table});`, { ...body, indent: true, align: "justify" });
  });
  para(ws, row++, 1, N,
    `Отбор выработок: угол наклона ${result.angleFilter}° и более, длина ${result.lengthFilter} м и более. Температура наружного воздуха, принятая в расчёте, ${result.ambientTemp} °С.`,
    { ...body, align: "justify" });

  ws.pageSetup.printArea = `A1:${ws.getColumn(N).letter}${row - 1}`;
}

// ─── Мероприятия (Таблица №5) ────────────────────────────────────────────────
const MEASURE_COLS: ColDef[] = [
  { header: "№ п/п", width: 6 },
  { header: "№ ветви", width: 9 },
  { header: "Позиция", width: 9 },
  { header: "Наименование ветви", width: 32, align: "left" },
  { header: "Меры по предотвращению опрокидывания вентиляционной струи воздуха", width: 95, align: "justify" },
];

function measureText(r: StabilityRow): string {
  // Для восходящих выработок норматив (Прил. 7, ф. 7.6) даёт конкретную меру:
  // перемычка ниже очага с сопротивлением не менее R_доп.
  return r.R_dop != null
    ? `Установить в 10–15 м ниже очага пожара перемычку с аэродинамическим сопротивлением не менее ${r.R_dop} Н·с²/м⁸ (расчётное Rр = ${r.R_calc}, фактическое R = ${r.R_fact} Н·с²/м⁸).`
    : "Установка автоматических пожарных дверей / реверсирование ВГП / секционирование вентиляции для предотвращения опрокидывания струи.";
}

function writeMeasuresTable(ws: Worksheet, startRow: number, result: StabilityResult, size: number): number {
  const N = MEASURE_COLS.length;
  let row = tableHeader(ws, startRow, MEASURE_COLS.map(c => c.header), size === 10 ? 9 : size);
  let n = 0;
  CATEGORY_ORDER.forEach(cat => {
    groupRow(ws, row++, N, CATEGORY_META[cat].group);
    const bad = result.byCategory[cat].filter(r => !r.stable);
    if (bad.length === 0) {
      ws.mergeCells(row, 1, row, N);
      const c = ws.getCell(row, 1);
      c.value = "Устойчиво";
      for (let i = 1; i <= N; i++) styleCell(ws.getCell(row, i), { size });
      ws.getRow(row).height = 18;
      row++;
      return;
    }
    bad.forEach(r => {
      const vals = [++n, r.branchNumber, r.position || "—", r.name, measureText(r)];
      let ml = 1;
      vals.forEach((v, i) => {
        const c = ws.getCell(row, i + 1);
        c.value = v;
        styleCell(c, { size, align: MEASURE_COLS[i].align ?? "center" });
        if (typeof v === "string") ml = Math.max(ml, linesFor(v, ws.getColumn(i + 1).width ?? 9, size));
      });
      ws.getRow(row).height = heightFor(ml, size);
      row++;
    });
  });
  return row;
}

function buildMeasuresSheet(wb: Workbook, result: StabilityResult): void {
  const ws = addSheet(wb, "Мероприятия");
  const N = MEASURE_COLS.length;
  MEASURE_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
  para(ws, 1, 1, N, "2. По результатам расчётов определены категории устойчивости и разработаны меры по устойчивому проветриванию выработок.", { bold: true, size: 11 });
  const t = ws.getCell(2, N);
  t.value = "Таблица №5";
  t.font = { name: FONT, size: 10, italic: true };
  t.alignment = { horizontal: "right" };
  const end = writeMeasuresTable(ws, 3, result, 10);
  ws.pageSetup.printTitlesRow = "3:4";
  ws.pageSetup.printArea = `A1:E${end - 1}`;
}

// ─── Выводы ──────────────────────────────────────────────────────────────────
function buildConclusionsSheet(wb: Workbook, result: StabilityResult, m: ActMeta): void {
  const ws = addSheet(wb, "Выводы");
  const N = MEASURE_COLS.length;
  MEASURE_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const total = result.rows.length;
  const unstable = result.totalUnstable;
  const stable = total - unstable;
  let row = 1;

  para(ws, row++, 1, N,
    unstable > 0
      ? "Выводы и предложения комиссии: проверка устойчивости вентиляционной струи при пожаре в наклонных и вертикальных выработках с нисходящим и восходящим проветриванием показала, что на руднике имеются выработки с неустойчивым проветриванием."
      : "Выводы и предложения комиссии: проверка устойчивости вентиляционной струи при пожаре в наклонных и вертикальных выработках с нисходящим и восходящим проветриванием показала, что все проверенные выработки сохраняют устойчивое проветривание.",
    { bold: true, align: "justify" });
  row++;

  const lines: string[] = [
    `1. Проверке подлежало ${total} горных выработок с углом наклона ${result.angleFilter}° и более и длиной ${result.lengthFilter} м и более, имеющих пожарную нагрузку, в том числе: наклонные с нисходящим проветриванием — ${result.byCategory["descending-incline"].length}; вертикальные с нисходящим проветриванием — ${result.byCategory["descending-vertical"].length}; наклонные с восходящим проветриванием — ${result.byCategory["ascending-incline"].length}; вертикальные с восходящим проветриванием — ${result.byCategory["ascending-vertical"].length}.`,
    `2. Устойчивое проветривание при пожаре сохраняют ${stable} из ${total} выработок.`,
  ];
  if (unstable > 0) {
    let s = `3. Выявлено ${unstable} выработок с риском самопроизвольного опрокидывания вентиляционной струи.`;
    if (result.totalVeryUnstable > 0) s += ` Из них ${result.totalVeryUnstable} отнесены к весьма неустойчивым по направлению вентиляционных струй (показатель устойчивости pу < 0,3).`;
    lines.push(s);
  } else {
    lines.push("3. Выработок с риском опрокидывания вентиляционной струи не выявлено. Принятые проектные решения обеспечивают устойчивость проветривания при пожаре.");
  }
  const byFact = result.rows.filter(r => r.basis === "fact").length;
  if (byFact === total && total > 0) lines.push(`4. Устойчивость определена по итеративному расчёту вентиляционной сети при пожаре для всех ${total} выработок.`);
  else if (byFact > 0) lines.push(`4. Устойчивость определена по итеративному расчёту сети при пожаре для ${byFact} из ${total} выработок; для остальных — по нормативной оценке (в графе «Степень устойчивости» отмечены «(оценка)»).`);
  else lines.push("4. Устойчивость определена по нормативной оценке (Прил. 5, 7) без итеративного расчёта сети при пожаре.");
  lines.forEach(l => para(ws, row++, 1, N, l, { align: "justify", indent: true }));

  if (unstable > 0) {
    row++;
    para(ws, row++, 1, N, "Для предотвращения самопроизвольного опрокидывания вентиляционной струи воздуха в этих выработках необходимо:", { indent: true });
    row = writeMeasuresTable(ws, row, result, 11);
  }

  // ── Подписи ────────────────────────────────────────────────────────────────
  row += 2;
  const sign = (label: string, p?: { title: string; name: string }) => {
    para(ws, row, 1, 3, label, { bold: true });
    para(ws, row, 4, 4, "____________________", { align: "center" });
    const who = ws.getCell(row, 5);
    who.value = `${p?.name || "______________________"}          «_____» _____________ ${new Date().getFullYear()} г.`;
    who.font = { name: FONT, size: 12 };
    who.alignment = { horizontal: "left", vertical: "top" };
    row++;
    ws.getCell(row, 4).value = "(подпись)";
    ws.getCell(row, 4).font = { name: FONT, size: 8, italic: true };
    ws.getCell(row, 4).alignment = { horizontal: "center", vertical: "top" };
    row += 2;
  };
  sign("Председатель комиссии:", m.chairman ?? (m.approverName ? { title: m.approverTitle, name: m.approverName } : undefined));
  const members = m.members && m.members.length > 0 ? m.members : [undefined, undefined, undefined];
  members.forEach((p, i) => sign(i === 0 ? "Члены комиссии:" : "", p));

  para(ws, row++, 1, N, `Расчёт выполнен в программном комплексе «ПВ-Система». Дата составления: ${m.date}.`, { size: 9, italic: true });
  ws.pageSetup.printArea = `A1:E${row - 1}`;
}

// ─── Главная функция экспорта ────────────────────────────────────────────────
export async function exportStabilityAct(result: StabilityResult, meta?: Partial<ActMeta>): Promise<void> {
  const m: ActMeta = { ...DEFAULT_META, ...meta };
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ПВ-Система";
  wb.created = new Date();

  buildTitleSheet(wb, m, result);
  CATEGORY_ORDER.forEach(cat => buildTableSheet(wb, cat, result.byCategory[cat]));
  buildMeasuresSheet(wb, result);
  buildConclusionsSheet(wb, result, m);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const safe = (m.projectName || "рудник").replace(/[\\/:*?"<>|]+/g, "_");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Акт_устойчивости_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}