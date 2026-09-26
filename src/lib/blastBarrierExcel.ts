// ─────────────────────────────────────────────────────────────────────────────
// blastBarrierExcel.ts — выгрузка диаграммы «Как ударная волна доходит до
// перемычек» в Excel с НАСТОЯЩИМИ диаграммами Excel (не картинкой).
//
//   Лист «Сводка»              — таблица всех перемычек по порядку прихода
//                                волны + гистограмма нагрузки (% от прочности,
//                                логарифмическая шкала) с линией 100 %.
//   Лист «Нагрузка во времени» — параметры выбранной перемычки + график
//                                нагрузки во времени (треугольный импульс),
//                                линия прочности и давление отражения.
//
// Библиотеки xlsx/exceljs диаграммы не создают, поэтому пакет собирается
// вручную из XML-частей (как в hqDiagramExcel.ts).
// ─────────────────────────────────────────────────────────────────────────────
import JSZip from "jszip";
import { reflectedPressure } from "@/lib/blastBulkhead";

export interface BarrierExportRow {
  name: string;
  d_m: number;
  t0_ms: number;
  theta_ms: number;
  incident_kPa: number;
  failure_kPa: number;
  destroyed: boolean;
  transmit: number;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const colL = (n: number): string => {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
};

const r2 = (v: number, d = 2) => { const k = 10 ** d; return Math.round(v * k) / k; };

// ── Сетка ячеек ──────────────────────────────────────────────────────────────
interface Cell { v: string | number; s?: number }
class Grid {
  rows = new Map<number, Map<number, Cell>>();
  set(r: number, c: number, v: string | number | null | undefined, s?: number) {
    if (v === null || v === undefined || v === "") { if (s === undefined) return; }
    if (!this.rows.has(r)) this.rows.set(r, new Map());
    this.rows.get(r)!.set(c, { v: v ?? "", s });
  }
  xml(colsXml: string, extra = ""): string {
    const body = [...this.rows.keys()].sort((a, b) => a - b).map(r => {
      const cells = this.rows.get(r)!;
      const cs = [...cells.keys()].sort((a, b) => a - b).map(c => {
        const cell = cells.get(c)!;
        const ref = `${colL(c)}${r}`;
        const st = cell.s ? ` s="${cell.s}"` : "";
        if (cell.v === "") return `<c r="${ref}"${st}/>`;
        return typeof cell.v === "number"
          ? `<c r="${ref}"${st}><v>${cell.v}</v></c>`
          : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
      }).join("");
      return `<row r="${r}">${cs}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${colsXml}<sheetData>${body}</sheetData>${extra}</worksheet>`;
  }
}

const colsXml = (widths: number[]) =>
  `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;

// ── Статические части пакета ─────────────────────────────────────────────────
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
<Override PartName="/xl/drawings/drawing2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
<Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const SHEET1 = "Сводка";
const SHEET2 = "Нагрузка во времени";

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="${SHEET1}" sheetId="1" r:id="rId1"/>
<sheet name="${SHEET2}" sheetId="2" r:id="rId2"/>
</sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// Стили: 0 обычный · 1 заголовок таблицы · 2 заголовок листа · 3 ячейка с рамкой
//        4 «разрушена» · 5 «устояла» · 6 примечание · 7 число 0.0 с рамкой · 8 жирный с рамкой
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF991B1B"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFDC2626"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF16A34A"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const sheetRels = (n: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/>
</Relationships>`;

const drawingRels = (n: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${n}.xml"/>
</Relationships>`;

const drawing = (name: string, c0: number, r0: number, c1: number, r1: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor>
<xdr:from><xdr:col>${c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro="">
<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="${esc(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>
</a:graphicData></a:graphic>
</xdr:graphicFrame>
<xdr:clientData/>
</xdr:twoCellAnchor>
</xdr:wsDr>`;

const ref = (sheet: string, c: number, r0: number, r1: number) => `'${sheet}'!$${colL(c)}$${r0}:$${colL(c)}$${r1}`;

const titleXml = (text: string) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="ru-RU" sz="1200" b="1"><a:solidFill><a:srgbClr val="991B1B"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

const axTitle = (text: string, vertical = false) =>
  `<c:title><c:tx><c:rich><a:bodyPr${vertical ? ' rot="-5400000" vert="horz"' : ""}/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU" sz="1000"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

const scaling = (log: boolean, min?: number, max?: number) =>
  `<c:scaling>${log ? '<c:logBase val="10"/>' : ""}<c:orientation val="minMax"/>${max !== undefined ? `<c:max val="${max}"/>` : ""}${min !== undefined ? `<c:min val="${min}"/>` : ""}</c:scaling>`;

const LEGEND = `<c:legend><c:legendPos val="b"/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr></c:legend>`;
const PLOT_BG = `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="D0D0D0"/></a:solidFill></a:ln></c:spPr>`;
const GRID = `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>`;

// ── Диаграмма 1: пиковая нагрузка всех перемычек ─────────────────────────────
function summaryChart(rows: BarrierExportRow[], r0: number, r1: number, yMin: number, yMax: number): string {
  const dPts = rows.map((r, i) =>
    `<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${r.destroyed ? "DC2626" : "16A34A"}"/></a:solidFill></c:spPr></c:dPt>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart>
${titleXml("Пиковая нагрузка на перемычки, % от прочности (красные — разрушены)")}
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:barChart>
<c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
<c:ser><c:idx val="0"/><c:order val="0"/>
<c:tx><c:v>Нагрузка, % от прочности</c:v></c:tx>
<c:spPr><a:solidFill><a:srgbClr val="16A34A"/></a:solidFill></c:spPr>
<c:invertIfNegative val="0"/>
${dPts}
<c:dLbls><c:numFmt formatCode="0" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800" b="1"/></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr><c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>
<c:cat><c:strRef><c:f>${ref(SHEET1, 2, r0, r1)}</c:f></c:strRef></c:cat>
<c:val><c:numRef><c:f>${ref(SHEET1, 10, r0, r1)}</c:f></c:numRef></c:val>
</c:ser>
<c:gapWidth val="60"/>
<c:axId val="100001"/><c:axId val="100002"/>
</c:barChart>
<c:lineChart>
<c:grouping val="standard"/><c:varyColors val="0"/>
<c:ser><c:idx val="1"/><c:order val="1"/>
<c:tx><c:v>Прочность = 100 %</c:v></c:tx>
<c:spPr><a:ln w="22225"><a:solidFill><a:srgbClr val="991B1B"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
<c:cat><c:strRef><c:f>${ref(SHEET1, 2, r0, r1)}</c:f></c:strRef></c:cat>
<c:val><c:numRef><c:f>${ref(SHEET1, 13, r0, r1)}</c:f></c:numRef></c:val>
<c:smooth val="0"/>
</c:ser>
<c:marker val="1"/>
<c:axId val="100001"/><c:axId val="100002"/>
</c:lineChart>
<c:catAx>
<c:axId val="100001"/><c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/><c:axPos val="b"/>
<c:numFmt formatCode="General" sourceLinked="0"/>
<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>
<c:txPr><a:bodyPr rot="-2700000"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr>
<c:crossAx val="100002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>
</c:catAx>
<c:valAx>
<c:axId val="100002"/>${scaling(true, yMin, yMax)}
<c:delete val="0"/><c:axPos val="l"/>
${GRID}
${axTitle("Нагрузка, % от прочности (лог. шкала)", true)}
<c:numFmt formatCode="General" sourceLinked="0"/>
<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>
<c:crossAx val="100001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>
</c:valAx>
${PLOT_BG}
</c:plotArea>
${LEGEND}
<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
</c:chart>
</c:chartSpace>`;
}

// ── Диаграмма 2: нагрузка выбранной перемычки во времени ─────────────────────
function scatterSer(idx: number, name: string, color: string, dash: boolean, w: number, xRef: string, yRef: string) {
  return `<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/>
<c:tx><c:v>${esc(name)}</c:v></c:tx>
<c:spPr><a:ln w="${w}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dash ? '<a:prstDash val="dash"/>' : ""}</a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
<c:xVal><c:numRef><c:f>${xRef}</c:f></c:numRef></c:xVal>
<c:yVal><c:numRef><c:f>${yRef}</c:f></c:numRef></c:yVal>
<c:smooth val="0"/></c:ser>`;
}

function timeChart(title: string, r0: number, r1: number, tMin: number, tMax: number, log: boolean, yMin: number, yMax: number, color: string): string {
  const x = ref(SHEET2, 12, r0, r1);
  const series = [
    scatterSer(0, "Нагрузка от давления во фронте, % прочности", color, false, 28575, x, ref(SHEET2, 14, r0, r1)),
    scatterSer(1, "Прочность перемычки = 100 %", "991B1B", true, 19050, x, ref(SHEET2, 15, r0, r1)),
    scatterSer(2, "Давление отражения на полотне, % (справочно)", "7C3AED", true, 12700, x, ref(SHEET2, 16, r0, r1)),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart>
${titleXml(title)}
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>
${series.join("\n")}
<c:axId val="200001"/><c:axId val="200002"/>
</c:scatterChart>
<c:valAx>
<c:axId val="200001"/>${scaling(false, tMin, tMax)}
<c:delete val="0"/><c:axPos val="b"/>
${GRID}
${axTitle("Время от взрыва, мс")}
<c:numFmt formatCode="0" sourceLinked="0"/>
<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>
<c:crossAx val="200002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/>
</c:valAx>
<c:valAx>
<c:axId val="200002"/>${scaling(log, yMin, yMax)}
<c:delete val="0"/><c:axPos val="l"/>
${GRID}
${axTitle(`Нагрузка, % от прочности${log ? " (лог. шкала)" : ""}`, true)}
<c:numFmt formatCode="General" sourceLinked="0"/>
<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>
<c:crossAx val="200001"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/>
</c:valAx>
${PLOT_BG}
</c:plotArea>
${LEGEND}
<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
</c:chart>
</c:chartSpace>`;
}

/** Давление во фронте в момент t, кПа (треугольный импульс). */
export function barrierPressureAt(t: number, r: { t0_ms: number; theta_ms: number; incident_kPa: number }): number {
  if (t < r.t0_ms) return 0;
  const k = 1 - (t - r.t0_ms) / r.theta_ms;
  return k > 0 ? r.incident_kPa * k : 0;
}

/** Границы логарифмической шкалы для пика нагрузки, %. */
export function logBounds(peaks: number[]): { min: number; max: number } {
  const lo = Math.min(...peaks, 100);
  const hi = Math.max(...peaks, 100);
  return {
    min: 10 ** Math.floor(Math.log10(Math.max(lo / 20, 1e-3))),
    max: 10 ** Math.ceil(Math.log10(hi * 1.5)),
  };
}

export async function exportBlastBarriersExcel(rows: BarrierExportRow[], selectedIdx: number, schemeName?: string): Promise<void> {
  const pctOf = (r: BarrierExportRow) => r.failure_kPa > 0 ? (r.incident_kPa / r.failure_kPa) * 100 : 0;

  // ── Лист 1: сводка ────────────────────────────────────────────────────────
  const g1 = new Grid();
  g1.set(1, 1, "Как ударная волна доходит до перемычек — сводка", 2);
  g1.set(2, 1, `${schemeName ? `Схема: ${schemeName} · ` : ""}Разрушение — по давлению во фронте УВВ (табл. 8 методики ВГСЧ). Нагрузка = ΔP фронта ÷ прочность перемычки.`, 6);
  const head = ["№", "Перемычка", "Путь волны, м", "Приход фронта, мс", "Действие волны θ, мс",
    "ΔP во фронте, кПа", "ΔP отражения, кПа", "Прочность, кПа", "Прочность, МПа", "Нагрузка, % прочности",
    "Итог", "Прошло за перемычку, %", "Линия 100 %"];
  const H = 4;
  head.forEach((h, i) => g1.set(H, i + 1, h, 1));
  rows.forEach((r, i) => {
    const R = H + 1 + i;
    g1.set(R, 1, i + 1, 3);
    g1.set(R, 2, r.name, 3);
    g1.set(R, 3, r2(r.d_m, 0), 3);
    g1.set(R, 4, r2(r.t0_ms, 1), 7);
    g1.set(R, 5, r2(r.theta_ms, 1), 7);
    g1.set(R, 6, r2(r.incident_kPa, 1), 7);
    g1.set(R, 7, r2(reflectedPressure(r.incident_kPa), 1), 7);
    g1.set(R, 8, r2(r.failure_kPa, 1), 7);
    g1.set(R, 9, r2(r.failure_kPa / 1000, 3), 3);
    g1.set(R, 10, r2(pctOf(r), 1), 7);
    g1.set(R, 11, r.destroyed ? "РАЗРУШЕНА" : "устояла", r.destroyed ? 4 : 5);
    g1.set(R, 12, r2(r.transmit * 100, 0), 3);
    g1.set(R, 13, 100, 3);
  });
  const last = H + rows.length;
  const destroyed = rows.filter(r => r.destroyed).length;
  g1.set(last + 2, 1, `Итого перемычек: ${rows.length} · разрушено: ${destroyed} · устояло: ${rows.length - destroyed}`, 8);
  const lb1 = logBounds(rows.map(pctOf));
  const chartTop = last + 3;

  // ── Лист 2: выбранная перемычка во времени ────────────────────────────────
  const sel = rows[Math.max(0, Math.min(selectedIdx, rows.length - 1))];
  const g2 = new Grid();
  const peak = pctOf(sel);
  const log = peak > 300 || peak < 20;
  const reflPeak = sel.failure_kPa > 0 ? (reflectedPressure(sel.incident_kPa) / sel.failure_kPa) * 100 : 0;
  const lb2 = logBounds([peak, reflPeak]);
  const tMin = Math.max(0, Math.floor(sel.t0_ms - sel.theta_ms * 0.5));
  const tMax = Math.ceil(sel.t0_ms + sel.theta_ms * 1.4);
  const linMax = Math.max(130, Math.ceil((Math.max(peak, reflPeak) * 1.1) / 10) * 10);

  g2.set(1, 1, "Нагрузка на перемычку во времени", 2);
  g2.set(2, 1, sel.name, 8);
  const params: [string, string | number, string][] = [
    ["Путь волны от очага", r2(sel.d_m, 0), "м"],
    ["Приход фронта t₀", r2(sel.t0_ms, 1), "мс"],
    ["Время действия волны θ", r2(sel.theta_ms, 1), "мс"],
    ["Давление во фронте ΔP", r2(sel.incident_kPa, 1), "кПа"],
    ["Давление отражения", r2(reflectedPressure(sel.incident_kPa), 1), "кПа"],
    ["Прочность перемычки", r2(sel.failure_kPa, 1), "кПа"],
    ["Пиковая нагрузка", r2(peak, 1), "% прочности"],
    ["Итог", sel.destroyed ? "РАЗРУШЕНА в момент прихода фронта" : "устояла", ""],
  ];
  params.forEach(([k, v, u], i) => {
    g2.set(3 + i, 1, k, 3); g2.set(3 + i, 2, v, i === 7 ? (sel.destroyed ? 4 : 5) : 3); g2.set(3 + i, 3, u, 3);
  });
  g2.set(12, 1, "Форма импульса — треугольная (i = ΔP·θ/2): скачок до ΔP в момент t₀ и линейный спад до нуля к t₀ + θ.", 6);
  g2.set(13, 1, log ? "Нагрузка сильно отличается от прочности — ось нагрузки логарифмическая, чтобы линия 100 % была видна." : "", 6);

  // Данные кривой — столбцы L..P
  ["t, мс", "ΔP во фронте, кПа", "Нагрузка, %", "Прочность, %", "Отражение, %"].forEach((h, i) => g2.set(1, 12 + i, h, 1));
  const ts: number[] = [];
  const N = 160;
  for (let i = 0; i <= N; i++) ts.push(tMin + ((tMax - tMin) * i) / N);
  ts.push(sel.t0_ms, sel.t0_ms, sel.t0_ms + sel.theta_ms);
  ts.sort((a, b) => a - b);
  let seenT0 = false;
  let rr = 2;
  for (const t of ts) {
    // В момент t₀ две точки: 0 (до фронта) и пик — вертикальный скачок
    let p = barrierPressureAt(t, sel);
    if (Math.abs(t - sel.t0_ms) < 1e-9 && !seenT0) { p = 0; seenT0 = true; }
    const pct = sel.failure_kPa > 0 ? (p / sel.failure_kPa) * 100 : 0;
    const refl = sel.failure_kPa > 0 ? (reflectedPressure(p) / sel.failure_kPa) * 100 : 0;
    const chartVal = (v: number) => log ? (v >= lb2.min ? r2(v, 3) : (Math.abs(t - sel.t0_ms) < 1e-9 ? lb2.min : null)) : r2(v, 3);
    g2.set(rr, 12, r2(t, 2));
    g2.set(rr, 13, r2(p, 2));
    g2.set(rr, 14, chartVal(pct));
    g2.set(rr, 15, 100);
    g2.set(rr, 16, chartVal(refl));
    rr++;
  }
  const lastData = rr - 1;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.folder("_rels")!.file(".rels", ROOT_RELS);
  const xl = zip.folder("xl")!;
  xl.file("workbook.xml", WORKBOOK);
  xl.folder("_rels")!.file("workbook.xml.rels", WORKBOOK_RELS);
  xl.file("styles.xml", STYLES);
  const ws = xl.folder("worksheets")!;
  const drawTag = `<drawing r:id="rId1"/>`;
  ws.file("sheet1.xml", g1.xml(colsXml([5, 46, 10, 11, 11, 11, 11, 11, 10, 12, 13, 12, 8]), drawTag));
  ws.file("sheet2.xml", g2.xml(colsXml([30, 34, 12, 4, 4, 4, 4, 4, 4, 4, 4, 9, 12, 11, 11, 12]), drawTag));
  ws.folder("_rels")!.file("sheet1.xml.rels", sheetRels(1));
  ws.folder("_rels")!.file("sheet2.xml.rels", sheetRels(2));
  const dr = xl.folder("drawings")!;
  dr.file("drawing1.xml", drawing("Нагрузка на перемычки", 0, chartTop, 13, chartTop + 26));
  dr.file("drawing2.xml", drawing("Нагрузка во времени", 0, 14, 11, 40));
  dr.folder("_rels")!.file("drawing1.xml.rels", drawingRels(1));
  dr.folder("_rels")!.file("drawing2.xml.rels", drawingRels(2));
  const ch = xl.folder("charts")!;
  ch.file("chart1.xml", summaryChart(rows, H + 1, last, lb1.min, lb1.max));
  ch.file("chart2.xml", timeChart(
    `${sel.name}: пик ${r2(peak, 0)} % прочности — ${sel.destroyed ? "разрушена" : "устояла"}`,
    2, lastData, tMin, tMax, log, log ? lb2.min : 0, log ? lb2.max : linMax, sel.destroyed ? "DC2626" : "D97706"));

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Ударная волна — перемычки${schemeName ? ` ${schemeName}` : ""}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}