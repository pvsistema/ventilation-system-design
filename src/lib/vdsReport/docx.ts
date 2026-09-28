// ─────────────────────────────────────────────────────────────────────────────
// Отчёт ВДС → Word (.docx). Структура повторяет отчёт-образец:
//   Титул · Аннотация · Цель ВДС
//   1. Техническое задание (сведения о руднике — заполняет пользователь)
//   2. Полевые работы ВДС (расчёт по модели)
//   3. Состояние проветривания рудника (расчёт)
//   4. Результаты расчёта вентиляционной сети (устойчивость при пожаре)
//   Выводы и рекомендации · Список литературы
// ─────────────────────────────────────────────────────────────────────────────
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  AlignmentType, HeadingLevel, PageBreak, BorderStyle, VerticalAlign,
} from "docx";
import type { VdsReportForm } from "./types";
import { f, type VdsCalcResult } from "./calc";
import { buildConclusions, buildRecommendations } from "./conclusions";

const FONT = "Times New Roman";

function p(text: string, opts: { bold?: boolean; center?: boolean; right?: boolean; size?: number; indent?: boolean; italic?: boolean } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : opts.right ? AlignmentType.RIGHT : AlignmentType.JUSTIFIED,
    indent: opts.indent === false ? undefined : { firstLine: 709 },
    spacing: { after: 60, line: 300 },
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italic, font: FONT, size: opts.size ?? 26 })],
  });
}
const plain = (text: string, o: Parameters<typeof p>[1] = {}) => p(text, { indent: false, ...o });

function lines(text: string): Paragraph[] {
  return text.split(/\n+/).map(s => s.trim()).filter(Boolean).map(s => p(s));
}

function h(text: string, level: 1 | 2 = 1): Paragraph {
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    alignment: level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, font: FONT, size: level === 1 ? 28 : 26, color: "000000" })],
  });
}

function caption(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 120, after: 60 },
    children: [new TextRun({ text, font: FONT, size: 24, italics: true })],
  });
}

const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
function cell(text: string, o: { bold?: boolean; span?: number; shade?: boolean; left?: boolean } = {}): TableCell {
  return new TableCell({
    columnSpan: o.span,
    verticalAlign: VerticalAlign.CENTER,
    shading: o.shade ? { fill: "E7ECF4" } : undefined,
    borders: { top: border, bottom: border, left: border, right: border },
    children: [new Paragraph({
      alignment: o.left ? AlignmentType.LEFT : AlignmentType.CENTER,
      children: [new TextRun({ text, bold: o.bold, font: FONT, size: 20 })],
    })],
  });
}

function table(head: string[], rows: string[][], leftCols: number[] = [1]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: head.map(t => cell(t, { bold: true, shade: true })) }),
      ...rows.map(r => new TableRow({
        children: r.map((t, i) => cell(t, { left: leftCols.includes(i) })),
      })),
    ],
  });
}

function spanRow(text: string, n: number): TableRow {
  return new TableRow({ children: [cell(text, { bold: true, span: n, shade: true })] });
}

function tableWithGroups(head: string[], groups: { title: string; rows: string[][] }[]): Table {
  const rows: TableRow[] = [new TableRow({ tableHeader: true, children: head.map(t => cell(t, { bold: true, shade: true })) })];
  for (const g of groups) {
    rows.push(spanRow(g.title, head.length));
    if (!g.rows.length) rows.push(new TableRow({ children: [cell("— нет —", { span: head.length })] }));
    for (const r of g.rows) rows.push(new TableRow({ children: r.map((t, i) => cell(t, { left: i === 1 })) }));
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

export async function buildVdsDocx(form: VdsReportForm, r: VdsCalcResult): Promise<Blob> {
  const mine = form.mineName || "рудника";
  const company = form.companyName;
  const children: (Paragraph | Table)[] = [];
  let tn = 0;
  const T = (t: string) => caption(`Таблица ${++tn} – ${t}`);

  // ── Титул ──────────────────────────────────────────────────────────────────
  form.surveyOrgParent.split("\n").filter(Boolean).forEach(s => children.push(plain(s, { center: true, bold: true })));
  if (form.surveyOrg) children.push(plain(form.surveyOrg, { center: true, bold: true }));
  children.push(plain(""));
  children.push(plain("УТВЕРЖДАЮ", { right: true, bold: true }));
  form.approverTitle.split("\n").filter(Boolean).forEach(s => children.push(plain(s, { right: true })));
  children.push(plain(`________________ ${form.approverName}`, { right: true }));
  children.push(plain(`«_____»_______________ ${form.approveYear} г.`, { right: true }));
  for (let i = 0; i < 6; i++) children.push(plain(""));
  children.push(plain("ОТЧЁТ", { center: true, bold: true, size: 36 }));
  children.push(plain("по результатам воздушно-депрессионной съёмки", { center: true, bold: true, size: 30 }));
  children.push(plain(mine, { center: true, bold: true, size: 30 }));
  if (company) children.push(plain(company, { center: true, bold: true, size: 30 }));
  for (let i = 0; i < 8; i++) children.push(plain(""));
  children.push(plain(`${form.performerTitle}    ____________    ${form.performerName}`, { center: true }));
  children.push(plain(""));
  children.push(plain(`${form.city ? `г. ${form.city}, ` : ""}${form.approveYear}`, { center: true }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Аннотация ─────────────────────────────────────────────────────────────
  children.push(h("Аннотация"));
  children.push(p(`В настоящем отчёте приведены результаты аэродинамических измерений и обследований, проведённых в горных выработках и на главных вентиляторных установках ${mine}${company ? ` ${company}` : ""}, дан анализ вентиляционной сети и сделаны соответствующие выводы.`));
  children.push(p("Произведены расчёты по определению величины и направления депрессии естественной тяги, расчёты устойчивости проветривания наклонных выработок при пожаре, а также расчёты распределения воздуха и депрессии в вентиляционной сети."));
  children.push(p("На основании проделанной работы предложены рекомендации по улучшению проветривания горных выработок и работе главных вентиляторных установок рудника."));
  children.push(...lines(form.annotation));
  if (form.surveyTeam) children.push(p(`Воздушно-депрессионная съёмка выполнена в составе: ${form.surveyTeam}.`));

  children.push(h("Цель проведения воздушно-депрессионной съёмки"));
  children.push(p(`Воздушно-депрессионная съёмка ${mine}${company ? ` ${company}` : ""} выполнена${form.surveyOrg ? ` службой депрессионных съёмок ${form.surveyOrg}` : ""}${form.surveyPeriod ? ` в ${form.surveyPeriod}` : ""}, в соответствии с техническим заданием, разработанным администрацией рудника.${form.previousSurvey ? ` Предыдущая съёмка проводилась ${form.previousSurvey}.` : ""}`));
  children.push(p("Цель воздушно-депрессионной съёмки — определение основных параметров вентиляционной сети, характеризующих состояние проветривания рудника в целом и отдельных объектов проветривания. ВДС дала возможность определить режимы работы вентиляторных установок, фактический расход воздуха и депрессии в горных выработках, величины внешних и внутренних утечек и получить исходные данные для создания базовой математической модели вентиляционной сети."));

  // ── 1. Техническое задание ────────────────────────────────────────────────
  children.push(h("1. Техническое задание на проведение воздушно-депрессионной съёмки"));
  children.push(h("1.1 Сведения о руднике", 2));
  [company && form.companyAddress ? `${company}, ${form.companyAddress}.` : company || form.companyAddress,
    form.inn && `ИНН ${form.inn}`, form.phone && `Тел.: ${form.phone}`, form.email && `E-mail: ${form.email}`,
    form.director && `Руководитель — ${form.director}.`].filter(Boolean).forEach(s => children.push(p(s as string)));
  children.push(...lines(form.location));
  children.push(...lines(form.subsoilLicense));

  children.push(h("1.2 Общие сведения о руднике", 2));
  children.push(...lines(form.opoRegistration));
  if (form.staffTotal) {
    children.push(p(`Численность персонала всего: ${form.staffTotal} чел., из них подземных рабочих: ${form.staffUnderground || "—"} чел., ИТР и служащих: ${form.staffItr || "—"} чел.`));
  }
  if (form.maxPerShift) children.push(p(`Максимальное количество людей в одну смену — ${form.maxPerShift} чел.`));
  if (form.activeFaces) children.push(p(`Количество действующих забоев: ${form.activeFaces}.`));
  if (form.equipment.trim()) {
    children.push(p("Основное горное оборудование, применяемое на руднике:"));
    form.equipment.split("\n").filter(s => s.trim()).forEach(s => children.push(p(`— ${s.trim()}`)));
  }
  if (form.horizons) children.push(p(`Количество действующих горизонтов: ${form.horizons}.`));
  if (form.supportType) children.push(p(`Преобладающий вид крепления: ${form.supportType}.`));
  const hz = form.hazards.filter(x => x.name.trim());
  if (hz.length) {
    children.push(T("Характер опасности рудника"));
    children.push(table(["Характер опасности", "Оценка"], hz.map(x => [x.name, x.value]), [0, 1]));
  }
  const mw = form.mainWorkings.filter(x => x.name.trim());
  if (mw.length) {
    children.push(T("Сечение и протяжённость действующих главных выработок"));
    children.push(table(["Выработка", "Параметры"], mw.map(x => [x.name, x.value]), [0, 1]));
  }
  if (form.reserves.trim()) { children.push(h("Сведения о запасах и полезном ископаемом", 2)); children.push(...lines(form.reserves)); }
  if (form.hydrogeology.trim()) { children.push(h("Гидрогеология", 2)); children.push(...lines(form.hydrogeology)); }
  if (form.drainage.trim()) { children.push(h("Водоотлив и противопожарный водопровод", 2)); children.push(...lines(form.drainage)); }
  if (form.openingScheme.trim()) { children.push(h("Схема вскрытия месторождения", 2)); children.push(...lines(form.openingScheme)); }
  if (form.miningSystems.trim()) { children.push(h("Схема подготовки и системы разработки", 2)); children.push(...lines(form.miningSystems)); }
  if (form.ventilationScheme.trim()) { children.push(h("Проветривание рудника", 2)); children.push(...lines(form.ventilationScheme)); }

  // Объём работ по ТЗ — из той же модели, что и расчётные разделы 2–4,
  // поэтому перечень объектов ТЗ всегда совпадает с результатами обследования.
  children.push(h("Объём работ по воздушно-депрессионной съёмке", 2));
  children.push(p("Техническим заданием предусмотрено выполнение следующих работ:"));
  [
    `обследование главных вентиляторных установок — ${r.gvu.length} шт.${r.gvu.length ? ` (${r.gvu.map(g => `${g.fanModel}, ${g.place}`).join("; ")})` : ""};`,
    `замеры расхода воздуха и депрессии в воздухоподающих (${r.intake.length}) и выдающих исходящую струю (${r.exhaust.length}) выработках;`,
    `обследование тупиковых выработок, проветриваемых ВМП, — ${r.deadEnds.length} шт.;`,
    `обследование выемочных участков (забоев) — ${r.faces.length} шт., камер служебного назначения — ${r.chambers.length} шт.;`,
    `обследование вентиляционных сооружений — ${r.structures.length} шт.;`,
    "определение естественной тяги расчётным способом на летний и зимний периоды;",
    "создание (корректировка) математической модели вентиляционной сети и расчёт устойчивости проветривания наклонных выработок при пожаре.",
  ].forEach(s => children.push(p(`— ${s}`)));

  // ── 2. Полевые работы (идёт сразу за разделом 1, без разрыва страницы) ─────
  children.push(h("2. Полевые работы воздушно-депрессионной съёмки"));
  children.push(h("2.1 Способ проведения воздушно-депрессионной съёмки", 2));
  children.push(p(`Воздушно-депрессионная съёмка${form.surveyDate ? ` (${new Date(form.surveyDate).toLocaleDateString("ru-RU")})` : ""} проводилась способом непосредственных замеров аэродинамических параметров горных выработок, вентиляционных сооружений и параметров режима работы вентиляторных установок. При замерах использовались средства измерений, приведённые в таблице.`));
  children.push(T("Используемые в процессе ВДС средства измерения"));
  children.push(table(["№ п/п", "Наименование", "Кол-во, шт.", "Измеряемый параметр", "Погрешность"],
    form.instruments.map((x, i) => [String(i + 1), x.name, x.count, x.parameter, x.accuracy])));

  children.push(h("2.2 Характеристики горных выработок", 2));
  children.push(p("Одновременно с замерами депрессии и скорости движения воздуха производилась регистрация состояния выработок, типа крепи, размеров поперечного сечения и соответствия их требованиям ФНиП."));
  children.push(T("Воздухоподающие и выдающие выработки"));
  children.push(tableWithGroups(["№ ветви", "Наименование выработки", "Назначение", "S, м²", "Крепь / поверхность", "Q факт, м³/с"], [
    { title: "Выработки для подачи свежего воздуха в рудник", rows: r.intake.map(x => [x.no, x.name, x.purpose, f(x.area), x.support, f(x.flow)]) },
    { title: "Выработки для выдачи исходящей струи воздуха", rows: r.exhaust.map(x => [x.no, x.name, x.purpose, f(x.area), x.support, f(x.flow)]) },
  ]));
  if (r.Hmine > 0) children.push(p(`Аэродинамическое сопротивление (депрессия) вентиляционной сети рудника составляет ${f(r.Hmine)} даПа.`));
  if (r.steepestDrops.length) {
    children.push(p(`Наибольшее удельное падение давления происходит в выработках: ${r.steepestDrops.map(s => `${s.name} (${f(s.dP)} даПа)`).join(", ")}.`));
  }

  children.push(h("2.3 Результаты обследования главных вентиляторных установок", 2));
  if (!r.gvu.length) children.push(p("В модели не заданы работающие главные вентиляторные установки (ГВУ)."));
  else {
    children.push(T("Параметры ГВУ"));
    children.push(table(["Место установки", "Тип", "n, об/мин", "θ, град", "Qвент, м³/с", "hвент, даПа", "Qруд, м³/с", "hруд, даПа", "he, даПа", "Qут, м³/с", "Qут, %"],
      r.gvu.map(g => [g.place, g.fanModel, g.rpm ? String(g.rpm) : "—", g.bladeAngle ? String(g.bladeAngle) : "—", f(g.Qv), f(g.Hv), f(g.Qsh), f(g.Hsh), f(g.he), f(g.extLeakFact), f(g.extLeakPct)]), [0]));
    children.push(T("Параметры ГВУ (депрессия, КПД)"));
    const params: [string, string, (g: typeof r.gvu[number]) => string][] = [
      ["Депрессия естественной тяги", "даПа", g => f(g.he)],
      ["Статическая депрессия, развиваемая вентилятором (1)", "даПа", g => f(g.hSt)],
      ["Скоростной напор в канале вентилятора (2)", "даПа", g => f(g.hSk)],
      ["Полное давление, развиваемое вентилятором (3)", "даПа", g => f(g.hP)],
      ["Аэродинамический КПД ГВУ (4)", "", g => f(g.etaAero, 2)],
      ["Объёмный КПД ГВУ (5)", "", g => f(g.etaVol, 2)],
      ["Коэффициент обеспеченности рудника воздухом (6)", "", g => f(g.kOb, 2)],
      ["Коэффициент полезного использования воздуха (7)", "", g => f(g.kP, 2)],
      ["Резерв подачи вентилятора (8)", "%", g => f(g.reservePct)],
      ["Нормативные внешние утечки (9)", "м³/с", g => f(g.extLeakNorm)],
    ];
    children.push(table(["№", "Параметр", "Ед. изм.", ...r.gvu.map(g => g.place)],
      params.map(([n, u, fn], i) => [String(i + 1), n, u, ...r.gvu.map(fn)])));
    r.gvu.forEach(g => {
      if (g.reservePct != null) children.push(p(`Резерв подачи вентилятора ${g.fanModel}: ΔQ = (${f(g.qMax)} / ${f(g.Qv)} − 1)·100% = ${f(g.reservePct)}%.`));
      children.push(p(`Нормативные внешние утечки: Qут.н = ${f(g.Qv)} × (${f(g.Qv > 0 ? 1 + g.extLeakNorm / g.Qv : 1.05, 2)} − 1) = ${f(g.extLeakNorm)} м³/с; фактические — ${g.extLeakMeasured ? `${f(g.extLeakFact)} м³/с` : "не замерены"}.`));
    });
  }

  children.push(h("2.4 Результаты обследования тупиковых выработок", 2));
  if (!r.deadEnds.length) children.push(p("В модели отсутствуют тупиковые выработки с вентиляционным ставом."));
  else {
    children.push(T("Результаты фактического состояния подготовительных и нарезных выработок"));
    children.push(table(["№", "Наименование выработки", "Тип ВМП", "Ø труб, м", "Длина рукава, м", "S, м²", "Q перед ВМП", "Q вент.", "Q забоя", "Q расч.", "Вывод"],
      r.deadEnds.map((d, i) => [String(i + 1), d.name, d.fan, d.diameter, f(d.pipeLength, 0), f(d.area), f(d.qBefore), f(d.qVent), f(d.qFace), f(d.qRequired), d.ok ? "Обеспечен" : "Не обеспечен"])));
  }

  children.push(h("2.5 Результаты обследования выемочных участков (рабочих блоков)", 2));
  if (!r.faces.length) children.push(p("Очистные и иные забои, проветриваемые за счёт общерудничной депрессии, в модели не заданы."));
  else {
    children.push(T("Фактическая обеспеченность забоев воздухом"));
    children.push(table(["№", "Наименование", "Q расч., м³/с", "Q факт., м³/с", "% обеспеченности"],
      r.faces.map((c, i) => [String(i + 1), c.name, f(c.required), f(c.fact), f(c.pct)])));
  }

  children.push(h("2.6 Результаты обследования камер служебного назначения", 2));
  if (!r.chambers.length) children.push(p("Камеры служебного назначения в модели не заданы."));
  else {
    children.push(T("Фактическая обеспеченность камер служебного назначения воздухом"));
    children.push(table(["№", "Камера", "Q расч., м³/с", "Q факт., м³/с", "Примечание"],
      r.chambers.map((c, i) => [String(i + 1), c.name, f(c.required), f(c.fact), c.ok ? "Обеспечен Qрасч." : "Не обеспечен"])));
  }

  children.push(h("2.7 Результаты обследования вентиляционных сооружений", 2));
  children.push(p(`Обследовано вентиляционных устройств: ${r.structures.length}. Нормативные утечки определены по норме утечек сооружения при перепаде 50 Па с приведением к фактическому перепаду давления: Qут.н = q50·√(ΔP/50).`));
  if (r.structures.length) {
    children.push(T("Аэродинамические параметры вентиляционных устройств"));
    children.push(table(["№", "Объект проветривания", "№ ветви", "Тип сооружения", "ΔP, Па", "Норма утечек, м³/с", "Факт, м³/с", "Факт, м³/мин", "Сверх нормы, м³/с", "R, даПа·с²/м⁶"],
      r.structures.map((s, i) => [String(i + 1), s.name, s.no, s.type, f(s.dP, 0), s.norm > 0 ? f(s.norm, 2) : "—", f(s.fact, 2), f(s.fact * 60), s.norm > 0 ? f(s.over, 2) : "—", f(s.R, 4)])));
  }

  children.push(h("2.8 Результаты определения естественной тяги", 2));
  children.push(p(`Естественная тяга определена расчётным способом для маршрутов, включающих ГВУ и воздухоподающие выработки, связанные с поверхностью: he = g·ΔZ·(ρн − ρш). Условия: летний период t = ${form.tSummer} °С, P = ${form.pSummer} мм рт. ст.; зимний период t = ${form.tWinter} °С, P = ${form.pWinter} мм рт. ст.; температура исходящей струи ${form.tExhaust || "8"} °С.`));
  if (r.naturalDraft.length) {
    children.push(T("Расчёт естественной тяги на летний и зимний периоды"));
    children.push(table(["№", "Выработка (устье)", "Zн, м", "Zш, м", "he лето, даПа", "he зима, даПа", "he при ВДС, даПа"],
      r.naturalDraft.map((n, i) => [String(i + 1), n.name, f(n.zTop), f(n.zBottom), f(n.heSummer), f(n.heWinter), f(n.heSurvey)])));
  }

  children.push(h("2.9 Распределение воздуха по руднику", 2));
  children.push(T("Распределение воздуха по руднику в период проведения ВДС"));
  const qin = r.QshTotal || 1;
  children.push(table(["№", "Наименование параметров", "м³/с", "% к поступающему в рудник"], [
    ["1", "Производительность вентиляторов", f(r.QvTotal), ""],
    ["2", "Внешние утечки (на ГВУ)", f(r.extLeakTotal), f(r.extLeakTotal / qin * 100)],
    ["3", "Количество воздуха, поступающего в рудник", f(r.QshTotal), "100,0"],
    ["4", "Внутренние утечки", f(r.intLeakTotal), f(r.intLeakPct)],
    ["5", "Полезно используемый воздух", f(Math.max(0, r.QshTotal - r.intLeakTotal)), f(Math.max(0, r.QshTotal - r.intLeakTotal) / qin * 100)],
  ]));
  children.push(T("Баланс воздуха по руднику в нормальном режиме"));
  const n = Math.max(r.intake.length, r.exhaust.length);
  const bal: string[][] = [];
  for (let i = 0; i < n; i++) bal.push([r.intake[i]?.name ?? "", r.intake[i] ? f(r.intake[i].flow) : "", r.exhaust[i]?.name ?? "", r.exhaust[i] ? f(r.exhaust[i].flow) : ""]);
  bal.push(["ВСЕГО ПОСТУПАЕТ:", f(r.intakeTotal), "ВСЕГО ВЫДАЁТСЯ:", f(r.exhaustTotal)]);
  children.push(table(["Входящая струя", "м³/с", "Исходящая струя", "м³/с"], bal, [0, 2]));

  // ── 3. Состояние проветривания ────────────────────────────────────────────
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h("3. Состояние проветривания рудника"));
  children.push(h("3.1 Расчёт количества воздуха для проветривания рудника", 2));
  children.push(p(`Количество воздуха, необходимое для проветривания рудника, определяется по формуле (15): Qш = Кн·(ΣQв.бл + ΣQп.ш + ΣQп.в + ΣQк), где Кн = ${form.kn} — коэффициент неравномерности распределения воздуха.`));
  if (r.requiredFromSchema) children.push(p(`По расчёту потребности воздуха для забоев и камер, заданных в модели: Σ = ${f(r.requiredSum)} м³/с; Qш = ${form.kn} × ${f(r.requiredSum)} = ${f(r.requiredAir)} м³/с (${f(r.requiredAir * 60)} м³/мин).`));
  else children.push(p(`Требуемое количество воздуха по руднику (по данным проекта/расчёта рудника): Qш = ${f(r.requiredAir)} м³/с (${f(r.requiredAir * 60)} м³/мин).`));
  children.push(T("Сопоставление расчётного количества воздуха с фактическим воздухораспределением"));
  const extNormPct = r.extLeakNormTotal > 0 ? r.extLeakTotal / r.extLeakNormTotal * 100 : 0;
  children.push(table(["№", "Наименование параметров", "Qрасч., м³/с", "Qфакт., м³/с", "% от Qрасч."], [
    ["1", "Производительность ГВУ", f(r.requiredAir + r.extLeakNormTotal), f(r.QvTotal), r.requiredAir > 0 ? f(r.QvTotal / (r.requiredAir + r.extLeakNormTotal) * 100) : "—"],
    ["2", "Внешние утечки на ГВУ", f(r.extLeakNormTotal), f(r.extLeakTotal), extNormPct ? f(extNormPct) : "—"],
    ["3", "Количество воздуха, поступающего в рудник", f(r.requiredAir), f(r.QshTotal), r.requiredAir > 0 ? f(r.supplyPct) : "—"],
    ["4", "Внутренние утечки", r.intLeakNormTotal > 0 ? f(r.intLeakNormTotal) : "—", f(r.intLeakTotal), f(r.intLeakPct)],
  ]));

  children.push(h("3.2 Анализ состояния проветривания рудника", 2));
  if (r.requiredAir > 0) children.push(p(`В рудник требуется подавать ${f(r.requiredAir)} м³/с воздуха, фактически поступает ${f(r.QshTotal)} м³/с, т.е. обеспеченность по подаваемому расходу воздуха составляет ${f(r.supplyPct)}%.`));
  children.push(p(`Внутрирудничные утечки воздуха составили ${f(r.intLeakTotal)} м³/с (${f(r.intLeakPct)}% от Qрудника).`));

  children.push(h("3.3 Анализ эффективности функционирования системы вентиляции рудника", 2));
  children.push(p("Состояние рудничной вентиляционной системы характеризуется показателями: сопротивлением, преодолеваемым ВГП Rв = Hв/Qв² (16), сопротивлением ШВС Rш = Hш/Qш² (17), загруженностью воздухом Zв = Hв/Qв (18), коэффициентом полезного использования воздуха Кв (19), КПД ШВС К = Qш·Hш/(Qв·Hв)·ηст (20), трудностью проветривания Nуд (21) и эквивалентным отверстием А = 0,38·Qш/√hш (22)."));
  children.push(p("Рудник относится к легко проветриваемым при Nуд < 2,5; к средней трудности — при Nуд от 2,5 до 5; к трудно проветриваемым — при Nуд > 5. По эквивалентному отверстию: до 1 м² — труднопроветриваемые, 1–2 м² — средние, свыше 2 м² — легкопроветриваемые."));
  children.push(T("Сводная таблица показателей эффективности проветривания рудника"));
  children.push(table(["Показатель", "Q вент., м³/с", "Q руд., м³/с", "H вент., даПа", "H руд., даПа", "Rв", "Rш", "Zв", "Кв", "К", "Nуд", "А, м²"], [
    ["Нормы", "—", "—", "< 400", "—", "< 0,07", "—", "0,4÷1,5", "> 0,6", "> 0,325", "< 5", "> 1"],
    ...r.gvu.map(g => [g.fanModel, f(g.Qv), f(g.Qsh), f(g.Hv), f(g.Hsh), f(g.Rv, 5), f(g.Rsh, 5), f(g.Zv, 2), f(g.Kvi, 2), f(g.Ki, 3), f(r.Nud, 2), f(g.A, 2)]),
  ], [0]));
  children.push(p(`Трудность проветривания рудника Nуд = ${f(r.Nud, 2)} кВт·с/м³ — рудник ${r.ventDifficulty}; эквивалентное отверстие А = ${f(r.Aeq, 2)} м² — ${r.openingClass}.`));

  // ── 4. Устойчивость при пожаре ────────────────────────────────────────────
  children.push(h("4. Результаты расчёта вентиляционной сети с применением модели топологии"));
  children.push(h("4.1 Общие положения", 2));
  children.push(p("Воздушно-депрессионная съёмка позволила определить аэродинамические параметры вентиляционной сети рудника и скорректировать математическую модель. На базе модели выполнены расчёты воздухораспределения и устойчивости проветривания наклонных выработок под действием тепловой депрессии при пожаре."));
  children.push(h("4.2 Расчёты, предусмотренные ПМЛА: устойчивость проветривания наклонных выработок при пожаре", 2));
  children.push(p("Устойчивость проветривания наклонных выработок с нисходящим проветриванием при пожаре сохраняется при соблюдении неравенства Ht.max < Hкр, где Ht.max — максимальная тепловая депрессия в выработке, Hкр — критическая депрессия выработки. Для выработок с восходящим проветриванием проверяется условие hт < R·Q₀²."));
  const stabHead = ["№", "№ ветви", "Наименование", "Угол, град", "L, м", "S, м²", "V, м/с", "Q, м³/с", "Мощность пожара, МВт", "T пожара, °С", "Степень устойчивости", "Пожарная нагрузка"];
  const stabRow = (x: typeof r.stabilityDown[number], i: number) => [String(i + 1), x.branchNumber, x.name, f(x.angleDeg), f(x.length, 0), f(x.area), f(x.velocityNormal), f(x.flowNormal), f(x.firePower_MW), f(x.fireTemp_C), x.stability, x.fireLoadDesc];
  if (!r.solved) children.push(p("Расчёт сети не выполнен — устойчивость при пожаре не определялась."));
  else {
    children.push(T("Результаты расчёта максимальной тепловой депрессии для выработок с углом наклона 5° и более и длиной 30 м и более с нисходящим проветриванием"));
    children.push(table(stabHead, r.stabilityDown.map(stabRow), [2, 11]));
    children.push(T("Результаты расчёта максимальной тепловой депрессии для выработок с углом наклона 5° и более и длиной 30 м и более с восходящим проветриванием"));
    children.push(table(stabHead, r.stabilityUp.map(stabRow), [2, 11]));
  }

  // ── Выводы и рекомендации ─────────────────────────────────────────────────
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(h("Выводы и рекомендации по результатам проведения воздушно-депрессионной съёмки"));
  children.push(h("Выводы", 2));
  children.push(p("На основании проведённой воздушно-депрессионной съёмки можно сделать следующие выводы:"));
  buildConclusions(r, form.mineName).forEach((s, i) => children.push(p(s.startsWith("—") ? s : `${i + 1}. ${s}`)));
  children.push(...lines(form.extraConclusions));
  children.push(h("Рекомендации", 2));
  const recs = [...buildRecommendations(r), ...form.recommendations.split("\n").map(s => s.trim()).filter(Boolean)];
  recs.forEach((s, i) => children.push(p(`${i + 1}. ${s}`)));

  children.push(h("Список использованной литературы", 2));
  [
    "Федеральные нормы и правила в области промышленной безопасности «Правила безопасности при ведении горных работ и переработке твёрдых полезных ископаемых» (приказ Ростехнадзора № 505 от 08.12.2020).",
    "Методические рекомендации по проведению воздушно-депрессионных съёмок на объектах ведения горных работ.",
    "Руководство по ревизии и наладке главных вентиляторных установок шахт. — М.: Недра, 1981.",
    "Клебанов Ф.С. и др. Воздух в шахте. — М.: ИД Имидж, 1995.",
    "Ушаков К.З. Справочник по рудничной вентиляции. — М.: Недра, 1977.",
  ].forEach((s, i) => children.push(p(`${i + 1}. ${s}`)));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 26 } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } },
      children,
    }],
  });
  return Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}