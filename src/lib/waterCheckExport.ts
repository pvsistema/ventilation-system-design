// ─────────────────────────────────────────────────────────────────────────────
// waterCheckExport.ts — «Акт проверки пожарно-оросительного трубопровода»
// в Excel (.xlsx). Структура по образцу Акта устойчивости (stabilityActExport):
//   • Титул — шапка акта
//   • «Проверка точек» — таблица по всем пожарным кранам
//   • «Мероприятия» — что сделать по несоответствующим точкам
//   • «Трубы» — замечания по трубам: диаметр линии, скорость, давление
//   • «Выводы» — итог проверки
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import type { WaterCheckResult, WaterCheckRow } from "./waterFireCheck";
import { PIPE_ISSUE_LABEL, type PipeNormsResult } from "./waterPipeNorms";
import { MIN_DN, V_TECH, V_FIRE, CORROSION_MM } from "./waterPipes";

/** Проверка труб по нормам — для листа «Трубы» и выводов акта. */
export interface PipeActData {
  result: PipeNormsResult;
  kind: "ore" | "coal";
}

/** «1 участок», «3 участка», «5 участков» (род. падеж для «Проверено/Выявлено»). */
function uch(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? "участок" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "участка" : "участков";
  return `${n} ${w}`;
}
const uchGen = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "участке" : "участках"}`;

const LINE_ONE = { main: "Магистральная", section: "Участковая", face: "Забойная" } as const;
const KIND_TEXT = {
  ore: "рудник — ФНиП «Правила безопасности при ведении горных работ…» (приказ Ростехнадзора № 505)",
  coal: "угольная шахта — РД 05-366-00",
} as const;

export interface WaterActMeta {
  projectName: string;
  orgName: string;
  approverTitle: string;
  approverName: string;
  period: string;
  date: string;
}

const DEFAULT_META: WaterActMeta = {
  projectName: "Подземный рудник",
  orgName: "",
  approverTitle: "Главный инженер",
  approverName: "",
  period: "II полугодие 2026 г.",
  date: new Date().toLocaleDateString("ru-RU"),
};

const TABLE_HEADERS = [
  "№ п/п",
  "№ узла",
  "Наименование точки",
  "Тип ствола",
  "Диаметр насадка, мм",
  "Отметка, м",
  "Напор у крана, МПа",
  "Потери напора, МПа",
  "Расход, м³/ч",
  "Требуемый расход, м³/ч",
  "Дефицит напора, МПа",
  "Дефицит расхода, м³/ч",
  "Время работы, мин",
  "Макс. скорость воды, м/с",
  "Результат проверки",
  "Рекомендация",
];

// ─── Стили ───────────────────────────────────────────────────────────────────
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

function titleStyle(): XLSX.CellStyle {
  return { font: { bold: true, sz: 11 }, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
}

// ─── Титульный лист ──────────────────────────────────────────────────────────
function buildTitleSheet(meta: WaterActMeta, result: WaterCheckResult, pipes?: PipeActData): XLSX.WorkSheet {
  const n = result.norms;
  const rows: string[][] = [
    ["", "", "", "", "", "", "", "", "", "", "", "УТВЕРЖДАЮ:"],
    ["", "", "", "", "", "", "", "", "", "", "", meta.approverTitle],
    ["", "", "", "", "", "", "", "", "", "", "", meta.orgName],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", `_______________ ${meta.approverName}`],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", `«____»___________ ${new Date().getFullYear()} г.`],
    [""],
    ["АКТ"],
    ["проверки пожарно-оросительного трубопровода на обеспеченность пожаротушения"],
    [`«${meta.projectName}» ${meta.orgName}`],
    ["с определением напора и расхода воды в точках водоразбора"],
    [`(к ПМЛЛПА на ${meta.period})`],
    [""],
    ["Проверка выполнена гидравлическим расчётом сети противопожарного водоснабжения"],
    [`рудника «${meta.projectName}» с использованием программного обеспечения «ПВ-Система».`],
    [""],
    ["Нормативные требования, принятые в расчёте:"],
    [`   • минимальный свободный напор у пожарного крана — ${n.minPressure} МПа;`],
    [`   • максимальный допустимый напор у пожарного крана — ${n.maxPressure} МПа;`],
    [`   • минимальный расход воды через ствол — ${n.minFlow} м³/ч;`],
    [`   • минимальное время работы от запаса воды — ${n.minDuration} мин;`],
    [`   • количество одновременно работающих стволов — ${n.simultaneous};`],
    [`   • максимальная скорость воды в трубопроводе — ${n.maxVelocity} м/с.`],
    [""],
    ...(pipes
      ? [
          [`Требования к трубам (${KIND_TEXT[pipes.kind]}):`],
          [`   • диаметр магистральных линий — не менее DN ${MIN_DN[pipes.kind].main}, участковых — не менее DN ${MIN_DN[pipes.kind].section};`],
          [`   • скорость воды — не более ${V_TECH} м/с при технологическом расходе и ${V_FIRE} м/с при пожаротушении;`],
          [`   • давление в трубе — не выше допустимого для толщины стенки (запас на коррозию ${CORROSION_MM} мм).`],
          [""],
        ]
      : []),
    ...(result.pumpCount > 0
      ? [
          ["В расчёте учтена работа насосных станций противопожарного водопровода:"],
          [`   • количество насосных станций — ${result.pumpCount};`],
          [`   • суммарный напор — ${result.pumpHeadTotal} м вод. ст. (${result.pumpBoostMPa} МПа).`],
          [""],
        ]
      : []),
    [`Дата: ${meta.date}`],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = Array.from({ length: TABLE_HEADERS.length }, () => ({ wch: 11 }));
  ws["!merges"] = [8, 9, 10, 11, 12, 14, 15].map(r => ({
    s: { r, c: 0 }, e: { r, c: TABLE_HEADERS.length - 1 },
  }));
  [8, 9, 10, 11, 12].forEach(r => {
    const ref = XLSX.utils.encode_cell({ r, c: 0 });
    if (ws[ref]) ws[ref].s = titleStyle();
  });
  return ws;
}

// ─── Лист с таблицей проверки ────────────────────────────────────────────────
function buildTableSheet(result: WaterCheckResult): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [];
  aoa.push(["Результаты проверки точек водоразбора пожарно-оросительного трубопровода"]);
  aoa.push([]);
  aoa.push([...TABLE_HEADERS]);

  result.rows.forEach(r => {
    aoa.push([
      r.index,
      r.nodeNumber,
      r.nodeName || r.description || "—",
      r.consumerName || "—",
      r.outletDiameter > 0 ? r.outletDiameter : "—",
      r.elevation,
      r.pressure,
      r.pressureLoss,
      r.flow,
      r.requiredFlow,
      r.pressureDeficit > 0 ? r.pressureDeficit : "—",
      r.flowDeficit > 0 ? r.flowDeficit : "—",
      r.duration > 0 ? r.duration : "—",
      r.maxVelocity,
      r.verdict,
      r.recommendation || "—",
    ]);
  });

  if (result.rows.length === 0) {
    aoa.push(TABLE_HEADERS.map((_, i) => (i === 2 ? "Точек водоразбора в схеме не найдено" : "")));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 6 }, { wch: 9 }, { wch: 26 }, { wch: 26 }, { wch: 11 }, { wch: 9 },
    { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 13 }, { wch: 12 }, { wch: 13 },
    { wch: 12 }, { wch: 13 }, { wch: 22 }, { wch: 46 },
  ];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: TABLE_HEADERS.length - 1 } }];
  ws["!rows"] = [{ hpx: 28 }, { hpx: 8 }, { hpx: 46 }];

  const titleRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[titleRef]) ws[titleRef].s = { font: { bold: true, sz: 10 }, alignment: { wrapText: true, vertical: "center" } };

  TABLE_HEADERS.forEach((_, ci) => {
    const ref = XLSX.utils.encode_cell({ r: 2, c: ci });
    if (ws[ref]) ws[ref].s = headerStyle();
  });

  result.rows.forEach((r, ri) => {
    for (let ci = 0; ci < TABLE_HEADERS.length; ci++) {
      const ref = XLSX.utils.encode_cell({ r: ri + 3, c: ci });
      if (ws[ref]) ws[ref].s = cellStyle(ri, !r.ok);
    }
  });

  ws["!freeze"] = { xSplit: 0, ySplit: 3 };
  return ws;
}

// ─── Лист «Мероприятия» ──────────────────────────────────────────────────────
function buildMeasuresSheet(result: WaterCheckResult, pipes?: PipeActData): XLSX.WorkSheet {
  const bad: WaterCheckRow[] = result.rows.filter(r => !r.ok);
  const pipeIssues = pipes?.result.issues ?? [];
  const aoa: (string | number)[][] = [];
  aoa.push(["Мероприятия по обеспечению нормативных параметров пожаротушения"]);
  aoa.push([]);

  if (bad.length === 0) {
    aoa.push(["По результатам проверки все точки водоразбора обеспечены нормативным напором,"]);
    aoa.push(["расходом воды и запасом на нормативное время тушения."]);
    aoa.push(["Дополнительные мероприятия не требуются."]);
  } else {
    aoa.push(["Для точек водоразбора, не отвечающих нормативным требованиям, предусмотреть:"]);
    aoa.push([]);
    aoa.push(["№", "№ узла", "Наименование точки", "Выявленное несоответствие", "Мероприятие"]);
    bad.forEach((r, i) => {
      aoa.push([i + 1, r.nodeNumber, r.nodeName || r.description || "—", r.verdict, r.recommendation || "—"]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 28 }, { wch: 30 }, { wch: 62 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  const t = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[t]) ws[t].s = { font: { bold: true, sz: 11 } };
  if (bad.length > 0) {
    ["A5", "B5", "C5", "D5", "E5"].forEach(ref => { if (ws[ref]) ws[ref].s = headerStyle(); });
    bad.forEach((_, i) => {
      for (let c = 0; c < 5; c++) {
        const ref = XLSX.utils.encode_cell({ r: i + 5, c });
        if (ws[ref]) ws[ref].s = cellStyle(i);
      }
    });
  }

  // Мероприятия по трубам — отдельным блоком ниже
  if (pipeIssues.length > 0) {
    const start = aoa.length + 1;
    const add: (string | number)[][] = [
      [],
      ["Для участков трубопровода, не отвечающих нормативным требованиям, предусмотреть:"],
      [],
      ["№", "Участок", "Труба, мм", "Выявленное несоответствие", "Мероприятие"],
      ...pipeIssues.map((it, i) => [
        i + 1, it.title, it.size,
        it.kinds.map(k => PIPE_ISSUE_LABEL[k]).join(", "),
        it.recommendation,
      ]),
    ];
    XLSX.utils.sheet_add_aoa(ws, add, { origin: { r: start - 1, c: 0 } });
    const head = start - 1 + 3;
    for (let c = 0; c < 5; c++) {
      const ref = XLSX.utils.encode_cell({ r: head, c });
      if (ws[ref]) ws[ref].s = headerStyle();
    }
    pipeIssues.forEach((_, i) => {
      for (let c = 0; c < 5; c++) {
        const ref = XLSX.utils.encode_cell({ r: head + 1 + i, c });
        if (ws[ref]) ws[ref].s = cellStyle(i);
      }
    });
    const sub = XLSX.utils.encode_cell({ r: start, c: 0 });
    if (ws[sub]) ws[sub].s = { font: { bold: true, sz: 10 } };
  }
  return ws;
}

// ─── Лист «Трубы» ─────────────────────────────────────────────────────────────
const PIPE_HEADERS = [
  "№ п/п", "Участок (узлы)", "Линия", "Труба, мм", "DN", "Норма DN",
  "Давление, МПа", "Допустимое, МПа", "Скорость, м/с", `Скорость при пожаре, м/с`,
  "Несоответствие", "Мероприятие",
];

function buildPipesSheet(pipes: PipeActData): XLSX.WorkSheet {
  const { result, kind } = pipes;
  const aoa: (string | number)[][] = [];
  aoa.push(["Проверка трубопровода по нормам: диаметр линии, скорость воды, давление на стенку трубы"]);
  aoa.push([`Проверено участков: ${result.total}. С замечаниями: ${result.issues.length}.` +
    (result.noLine > 0 ? ` Без назначения линии (диаметр не проверялся): ${result.noLine}.` : "")]);
  aoa.push([`Нормы: ${KIND_TEXT[kind]}; магистральные — не менее DN ${MIN_DN[kind].main}, участковые — не менее DN ${MIN_DN[kind].section}; ` +
    `скорость — до ${V_TECH} м/с (технологический расход) и до ${V_FIRE} м/с (пожаротушение).`]);
  aoa.push([]);
  aoa.push([...PIPE_HEADERS]);

  if (result.issues.length === 0) {
    aoa.push(PIPE_HEADERS.map((_, i) => (i === 1 ? "Замечаний по трубам нет" : "")));
  }
  result.issues.forEach((it, i) => {
    aoa.push([
      i + 1, it.title, it.line ? LINE_ONE[it.line] : "не указана", it.size, it.dn, it.minDn ?? "—",
      it.pressure ?? "—", it.allowedPressure ?? "—", it.techVelocity ?? "—", it.fireVelocity ?? "—",
      it.kinds.map(k => PIPE_ISSUE_LABEL[k]).join(", "), it.recommendation,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 6 }, { wch: 16 }, { wch: 15 }, { wch: 11 }, { wch: 7 }, { wch: 9 },
    { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 13 }, { wch: 30 }, { wch: 60 },
  ];
  ws["!merges"] = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: PIPE_HEADERS.length - 1 } }));
  ws["!rows"] = [{ hpx: 22 }, { hpx: 16 }, { hpx: 28 }, { hpx: 6 }, { hpx: 40 }];
  const t = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[t]) ws[t].s = { font: { bold: true, sz: 10 } };
  const nr = XLSX.utils.encode_cell({ r: 2, c: 0 });
  if (ws[nr]) ws[nr].s = { font: { sz: 9, color: { rgb: "555555" } }, alignment: { wrapText: true, vertical: "top" } };
  PIPE_HEADERS.forEach((_, ci) => {
    const ref = XLSX.utils.encode_cell({ r: 4, c: ci });
    if (ws[ref]) ws[ref].s = headerStyle();
  });
  result.issues.forEach((it, ri) => {
    // Красным — те ячейки, где нарушение
    const badCols = new Set<number>([10]);
    if (it.kinds.includes("small-diameter")) { badCols.add(4); badCols.add(5); }
    if (it.kinds.includes("over-pressure")) { badCols.add(6); badCols.add(7); }
    if (it.kinds.includes("tech-velocity")) badCols.add(8);
    if (it.kinds.includes("fire-velocity")) badCols.add(9);
    for (let ci = 0; ci < PIPE_HEADERS.length; ci++) {
      const ref = XLSX.utils.encode_cell({ r: ri + 5, c: ci });
      if (ws[ref]) ws[ref].s = cellStyle(ri, badCols.has(ci));
    }
  });
  ws["!freeze"] = { xSplit: 0, ySplit: 5 };
  return ws;
}

// ─── Лист «Выводы» ────────────────────────────────────────────────────────────
function buildConclusionsSheet(result: WaterCheckResult, pipes?: PipeActData): XLSX.WorkSheet {
  const total = result.total;
  const failed = result.failed;
  const ok = total - failed;
  const n = result.norms;

  const aoa: string[][] = [];
  aoa.push(["ВЫВОДЫ"]);
  aoa.push([]);
  aoa.push([`1. Проверке подлежало ${total} точек водоразбора пожарно-оросительного трубопровода.`]);
  aoa.push([`   Расчётный сценарий: одновременная работа ${n.simultaneous} ствол(ов).`]);
  aoa.push([]);
  aoa.push([`2. Нормативные параметры пожаротушения обеспечены в ${ok} из ${total} точек.`]);

  if (result.worst) {
    const w = result.worst;
    aoa.push([]);
    aoa.push([`3. Наиболее тяжёлая точка сети — узел № ${w.nodeNumber}${w.nodeName ? ` (${w.nodeName})` : ""}:`]);
    aoa.push([`   напор ${w.pressure} МПа при норме не менее ${n.minPressure} МПа,`]);
    aoa.push([`   расход ${w.flow} м³/ч при требуемом ${w.requiredFlow} м³/ч.`]);
    aoa.push([`   Именно эта точка определяет требуемые параметры насосного оборудования.`]);
  }

  aoa.push([]);
  if (failed > 0) {
    aoa.push([`4. Выявлено ${failed} точек, не отвечающих нормативным требованиям.`]);
    aoa.push([`   Для них разработаны мероприятия (см. лист «Мероприятия»).`]);
  } else {
    aoa.push([`4. Точек, не отвечающих нормативным требованиям, не выявлено.`]);
    aoa.push([`   Пожарно-оросительный трубопровод обеспечивает тушение пожара во всех точках сети.`]);
  }

  if (pipes) {
    const iss = pipes.result.issues;
    const cnt = (k: keyof typeof PIPE_ISSUE_LABEL) => iss.filter(i => i.kinds.includes(k)).length;
    aoa.push([]);
    aoa.push([`5. Проверено ${uch(pipes.result.total)} трубопровода на соответствие нормам по диаметру, скорости воды и давлению.`]);
    if (iss.length === 0) {
      aoa.push([`   Несоответствий не выявлено.`]);
    } else {
      aoa.push([`   Замечания выявлены на ${uchGen(iss.length)} (см. лист «Трубы»):`]);
      const lines: [keyof typeof PIPE_ISSUE_LABEL, string][] = [
        ["small-diameter", "диаметр меньше нормы для линии"],
        ["over-pressure", "давление выше допустимого для стенки трубы"],
        ["tech-velocity", `скорость воды выше ${V_TECH} м/с при технологическом расходе`],
        ["fire-velocity", `скорость воды выше ${V_FIRE} м/с при пожаротушении`],
      ];
      lines.forEach(([k, txt]) => { const c = cnt(k); if (c > 0) aoa.push([`   • ${txt} — ${c};`]); });
      aoa.push([`   Мероприятия по ним приведены на листе «Мероприятия».`]);
    }
    if (pipes.result.noLine > 0) {
      aoa.push([`   На ${uchGen(pipes.result.noLine)} не указано назначение линии — диаметр по норме для них не проверялся.`]);
    }
  }

  aoa.push([]);
  aoa.push([`Расчёт выполнен в программном обеспечении «ПВ-Система».`]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 100 }];
  const t = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[t]) ws[t].s = { font: { bold: true, sz: 12 } };
  return ws;
}

// ─── Главная функция экспорта ────────────────────────────────────────────────
export function exportWaterCheckAct(result: WaterCheckResult, meta?: Partial<WaterActMeta>, pipes?: PipeActData): void {
  const m = { ...DEFAULT_META, ...meta };
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildTitleSheet(m, result, pipes), "Титул");
  XLSX.utils.book_append_sheet(wb, buildTableSheet(result), "Проверка точек");
  if (pipes && pipes.result.total > 0) XLSX.utils.book_append_sheet(wb, buildPipesSheet(pipes), "Трубы");
  XLSX.utils.book_append_sheet(wb, buildMeasuresSheet(result, pipes), "Мероприятия");
  XLSX.utils.book_append_sheet(wb, buildConclusionsSheet(result, pipes), "Выводы");

  const date = new Date().toISOString().slice(0, 10);
  const filename = `Акт_проверки_ППЗ_${m.projectName || "рудник"}_${date}.xlsx`;
  XLSX.writeFile(wb, filename);
}