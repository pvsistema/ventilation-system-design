// ─────────────────────────────────────────────────────────────────────────────
// explosibilityReport.ts — «Протокол расчёта взрывоопасности рудничной
// атмосферы» в Excel (.xlsx) по Приложению № 11 к ФНП, утв. приказом
// Ростехнадзора от 11.12.2020 № 520.
//
// Книга повторяет расчётный лист к оперативному плану:
//   • «Протокол»  — шапка, состав пробы, ход расчёта по формулам (1)–(5), вывод
//   • «Пробы»     — сводная таблица по всем пробам сеанса (если их несколько)
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";
import {
  ru, stateLabel,
  type ExplosibilityResult,
} from "./explosibility";

export interface ExplosibilityReportMeta {
  /** Наименование шахты / рудника */
  projectName: string;
  /** Организация */
  orgName: string;
  /** Должность утверждающего */
  approverTitle: string;
  /** ФИО утверждающего */
  approverName: string;
  /** Кто выполнил расчёт */
  performer: string;
  /** Номер аварии / оперативного плана */
  incidentNo: string;
  /** Дата протокола */
  date: string;
}

const DEFAULT_META: ExplosibilityReportMeta = {
  projectName: "Подземный рудник",
  orgName: "",
  approverTitle: "Руководитель горноспасательных работ",
  approverName: "",
  performer: "",
  incidentNo: "",
  date: new Date().toLocaleDateString("ru-RU"),
};

const COLS = 8;

// ─── Стили ───────────────────────────────────────────────────────────────────
function titleStyle(sz = 12): XLSX.CellStyle {
  return { font: { bold: true, sz }, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
}

function headerStyle(): XLSX.CellStyle {
  return {
    font: { bold: true, sz: 9, color: { rgb: "1F3864" } },
    fill: { fgColor: { rgb: "DCE6F1" }, patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: {
      top:    { style: "thin", color: { rgb: "8EA9C1" } },
      bottom: { style: "thin", color: { rgb: "8EA9C1" } },
      left:   { style: "thin", color: { rgb: "8EA9C1" } },
      right:  { style: "thin", color: { rgb: "8EA9C1" } },
    },
  };
}

function cellStyle(rowIdx: number, bad = false): XLSX.CellStyle {
  return {
    font: { sz: 9, color: { rgb: bad ? "9C0006" : "000000" }, bold: bad },
    fill: { fgColor: { rgb: bad ? "FFC7CE" : (rowIdx % 2 === 0 ? "FFFFFF" : "F2F5FB") }, patternType: "solid" },
    alignment: { vertical: "center", wrapText: true },
    border: {
      top:    { style: "thin", color: { rgb: "D0D8E8" } },
      bottom: { style: "thin", color: { rgb: "D0D8E8" } },
      left:   { style: "thin", color: { rgb: "D0D8E8" } },
      right:  { style: "thin", color: { rgb: "D0D8E8" } },
    },
  };
}

function applyStyle(ws: XLSX.WorkSheet, r: number, c: number, s: XLSX.CellStyle) {
  const ref = XLSX.utils.encode_cell({ r, c });
  if (ws[ref]) ws[ref].s = s;
}

// ─── Лист «Протокол» ─────────────────────────────────────────────────────────
function buildProtocolSheet(res: ExplosibilityResult, m: ExplosibilityReportMeta): XLSX.WorkSheet {
  const s = res.sample;
  const aoa: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];
  const titleRows: number[] = [];
  const headRows: number[] = [];

  const push = (...row: (string | number)[]) => { aoa.push(row); return aoa.length - 1; };
  const wide = (text: string, isTitle = false) => {
    const r = push(text);
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
    if (isTitle) titleRows.push(r);
    return r;
  };

  // Шапка «УТВЕРЖДАЮ»
  push("", "", "", "", "", "УТВЕРЖДАЮ:");
  push("", "", "", "", "", m.approverTitle);
  push("", "", "", "", "", m.orgName);
  push("");
  push("", "", "", "", "", `_______________ ${m.approverName}`);
  push("", "", "", "", "", `«____»___________ ${new Date().getFullYear()} г.`);
  push("");

  wide("ПРОТОКОЛ", true);
  wide("расчёта взрывоопасности рудничной атмосферы", true);
  wide(`«${m.projectName}»${m.orgName ? ` ${m.orgName}` : ""}`, true);
  wide(
    "Расчёт выполнен в соответствии с Приложением № 11 к Федеральным нормам и правилам в области " +
    "промышленной безопасности «Инструкция по локализации и ликвидации последствий аварий на опасных " +
    "производственных объектах, на которых ведутся горные работы» (утв. приказом Ростехнадзора " +
    "от 11.12.2020 № 520), формулы (1)–(5), треугольники взрываемости рисунков 1–6 приложения.",
  );
  push("");

  // Сведения о пробе
  wide("1. СВЕДЕНИЯ О ПРОБЕ РУДНИЧНОЙ АТМОСФЕРЫ");
  push("Номер пробы", s.no || "—");
  push("Место отбора", s.place || "—");
  push("Дата и время отбора", s.takenAt || "—");
  push("Авария / оперативный план", m.incidentNo || "—");
  push("");

  wide("2. РЕЗУЛЬТАТЫ ГАЗОВОГО АНАЛИЗА, объёмные %");
  const gasHead = push("Компонент", "CH₄", "CO", "H₂", "O₂", "CO₂");
  headRows.push(gasHead);
  push("Содержание, %", ru(s.ch4), ru(s.co), ru(s.h2), ru(s.o2), s.co2 != null ? ru(s.co2) : "—");
  push("");

  // Ход расчёта
  wide("3. ХОД РАСЧЁТА");
  const stepHead = push("№ формулы", "Действие", "Расчёт", "", "", "Результат");
  headRows.push(stepHead);
  merges.push({ s: { r: stepHead, c: 2 }, e: { r: stepHead, c: 4 } });
  res.steps.forEach(st => {
    const r = push(st.formula ?? "—", st.title, st.expression, "", "", st.value);
    merges.push({ s: { r, c: 2 }, e: { r, c: 4 } });
  });
  push("");

  // Треугольник
  wide("4. ТРЕУГОЛЬНИК ВЗРЫВАЕМОСТИ");
  push("Рисунок приложения", `№ ${res.figureNo} (P_CO = ${ru(res.figurePCO, 1)})`);
  push("Треугольник на рисунке", `P_CH₄ = ${ru(res.pCH4, 2)}`);
  push("Нижний предел взрываемости смеси, %", Number.isFinite(res.triangle.lel) ? ru(res.triangle.lel) : "—");
  push("Верхний предел взрываемости смеси, %", Number.isFinite(res.triangle.uel) ? ru(res.triangle.uel) : "—");
  push("Предельное содержание кислорода, %", ru(res.triangle.nose.y));
  push("Нанесённая точка (C_г; O₂)", `(${ru(res.cg)}; ${ru(s.o2)})`);
  push("Положение точки", res.inside ? "внутри треугольника взрываемости" : "вне треугольника взрываемости");
  push("Запас до нижнего предела взрываемости, %", Number.isFinite(res.marginToLel) ? ru(res.marginToLel) : "—");
  push("Запас по кислороду до предельного содержания, %", ru(res.marginToNoseO2));
  push("");

  // Вывод
  wide("5. ВЫВОД");
  wide(res.verdict);
  push("");

  if (res.warnings.length) {
    wide("ПРИМЕЧАНИЯ");
    res.warnings.forEach(w => wide(`• ${w}`));
    push("");
  }

  wide("Расчёт выполнен в программном комплексе «ПВ-Система».");
  push("");
  push("Расчёт выполнил", m.performer || "_______________________");
  push("Дата", m.date);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 34 }, { wch: 26 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 14 }];
  ws["!merges"] = merges;
  titleRows.forEach(r => applyStyle(ws, r, 0, titleStyle()));
  headRows.forEach(r => { for (let c = 0; c < COLS; c++) applyStyle(ws, r, c, headerStyle()); });
  return ws;
}

// ─── Лист «Пробы» — сводка по всем расчётам сеанса ───────────────────────────
const TABLE_HEADERS = [
  "№ п/п",
  "№ пробы",
  "Место отбора",
  "Дата отбора",
  "CH₄, %",
  "CO, %",
  "H₂, %",
  "O₂, %",
  "CO₂, %",
  "C_г, %",
  "P_CO",
  "P_CH₄",
  "P_H₂",
  "Рис.",
  "НПВ смеси, %",
  "ВПВ смеси, %",
  "O₂ предельн., %",
  "Состояние атмосферы",
];

function buildSamplesSheet(list: ExplosibilityResult[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [];
  aoa.push(["Сводная таблица расчётов взрывоопасности рудничной атмосферы"]);
  aoa.push([]);
  aoa.push([...TABLE_HEADERS]);

  list.forEach((res, i) => {
    const s = res.sample;
    aoa.push([
      i + 1,
      s.no || "",
      s.place || "",
      s.takenAt || "",
      ru(s.ch4), ru(s.co), ru(s.h2), ru(s.o2), s.co2 != null ? ru(s.co2) : "",
      ru(res.cg),
      ru(res.pCO, 3), ru(res.pCH4, 3), ru(res.pH2, 3),
      res.figureNo,
      Number.isFinite(res.triangle.lel) ? ru(res.triangle.lel) : "",
      Number.isFinite(res.triangle.uel) ? ru(res.triangle.uel) : "",
      ru(res.triangle.nose.y),
      stateLabel(res.state),
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = TABLE_HEADERS.map((h, i) => ({ wch: i === 2 ? 26 : i === 17 ? 32 : Math.max(8, h.length + 1) }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: TABLE_HEADERS.length - 1 } }];
  applyStyle(ws, 0, 0, titleStyle());
  for (let c = 0; c < TABLE_HEADERS.length; c++) applyStyle(ws, 2, c, headerStyle());
  list.forEach((res, i) => {
    const bad = res.state === "explosive" || res.state === "explosive-on-dilution";
    for (let c = 0; c < TABLE_HEADERS.length; c++) applyStyle(ws, 3 + i, c, cellStyle(i, bad));
  });
  return ws;
}

// ─── Главная функция экспорта ────────────────────────────────────────────────
/**
 * Формирует протокол расчёта взрывоопасности.
 * @param current — расчёт по текущей пробе (идёт на лист «Протокол»)
 * @param all     — все пробы сеанса (сводная таблица); если одна — лист не создаётся
 */
export function exportExplosibilityReport(
  current: ExplosibilityResult,
  all: ExplosibilityResult[] = [],
  meta?: Partial<ExplosibilityReportMeta>,
): void {
  const m = { ...DEFAULT_META, ...meta };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildProtocolSheet(current, m), "Протокол");
  if (all.length > 1) {
    XLSX.utils.book_append_sheet(wb, buildSamplesSheet(all), "Пробы");
  }
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Протокол_взрывоопасности_${m.projectName || "рудник"}_${date}.xlsx`);
}