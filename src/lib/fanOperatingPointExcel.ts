// ─────────────────────────────────────────────────────────────────────────────
// fanOperatingPointExcel.ts — выгрузка рабочей точки вентилятора в Excel.
//
// Структура файла повторяет образец «рабочая точка ГВУ-ВЦ-25.xlsx»:
//   «Графики»                    — нативная точечная диаграмма Excel;
//   «Табличные данные»           — напорные характеристики по углам (Q/H),
//                                  рабочая точка, значения КПД (изолинии);
//   «Графики (реверс)» +
//   «Табличные данные (реверс)»  — то же для реверсивных характеристик.
//
// Диаграмма — настоящая (chartN.xml), её можно править в Excel. Готовые
// библиотеки диаграмм не создают, поэтому пакет собирается из XML вручную.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from "jszip";
import type { FanPt, FanIsoLine } from "@/lib/fanChartData";

export interface FanXlsCurve { label: string; color: string; pts: FanPt[] }
export interface FanXlsPoint { label: string; q: number; h: number }

/** Характеристика сети H = R·Q² (как пунктир на графике в программе) */
export interface FanXlsNetwork { label: string; r: number; color: string }

export interface FanXlsBlock {
  curves: FanXlsCurve[];
  points: FanXlsPoint[];
  isolines: FanIsoLine[];
  networks?: FanXlsNetwork[];
}

export interface FanOperatingPointXls {
  fanName: string;
  forward: FanXlsBlock;
  reverse?: FanXlsBlock;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const col = (n: number): string => {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
};

/** Прореживание кривой до n точек (как в образце — 10 точек на угол) */
function thin<T>(pts: T[], n: number): T[] {
  if (pts.length <= n) return pts;
  return Array.from({ length: n }, (_, i) => pts[Math.round(i * (pts.length - 1) / (n - 1))]);
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

// ── Лист с данными ──────────────────────────────────────────────────────────

type CellV = string | number;
interface Cell { v: CellV; s?: number }

class Grid {
  rows = new Map<number, Map<number, Cell>>();
  merges: string[] = [];
  set(r: number, c: number, v: CellV, s?: number) {
    if (!this.rows.has(r)) this.rows.set(r, new Map());
    this.rows.get(r)!.set(c, { v, s });
  }
  merge(r1: number, c1: number, r2: number, c2: number) {
    this.merges.push(`${col(c1)}${r1}:${col(c2)}${r2}`);
  }
  xml(cols: number, drawing = false): string {
    const rows = [...this.rows.keys()].sort((a, b) => a - b).map(r => {
      const cells = [...this.rows.get(r)!.entries()].sort((a, b) => a[0] - b[0]).map(([c, cell]) => {
        const ref = `${col(c)}${r}`;
        const st = cell.s ? ` s="${cell.s}"` : "";
        return typeof cell.v === "number"
          ? `<c r="${ref}"${st}><v>${cell.v}</v></c>`
          : `<c r="${ref}"${st} t="inlineStr"><is><t>${esc(cell.v)}</t></is></c>`;
      }).join("");
      return `<row r="${r}">${cells}</row>`;
    }).join("");
    const colsXml = cols > 0 ? `<cols><col min="1" max="${cols}" width="10.5" customWidth="1"/></cols>` : "";
    const merges = this.merges.length
      ? `<mergeCells count="${this.merges.length}">${this.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${colsXml}<sheetData>${rows}</sheetData>${merges}${drawing ? `<drawing r:id="rId1"/>` : ""}</worksheet>`;
  }
}

/** Ссылки диапазонов рядов для диаграммы */
interface SeriesRef { name: string; nameRef: string; x: string; y: string; color: string; kind: "curve" | "iso" | "point" | "net" }

const S_TITLE = 1, S_HEAD = 2, S_CELL = 3, S_NUM = 4;

function buildDataSheet(sheetName: string, b: FanXlsBlock): { xml: string; series: SeriesRef[]; cols: number } {
  const g = new Grid();
  const series: SeriesRef[] = [];
  const sh = `'${sheetName.replace(/'/g, "''")}'`;
  const ref = (c: number, r: number) => `${sh}!$${col(c)}$${r}`;
  const rng = (c: number, r1: number, r2: number) => `${sh}!$${col(c)}$${r1}:$${col(c)}$${r2}`;

  // ── Напорные характеристики ────────────────────────────────────────────
  const N = 10;
  const curves = b.curves.map(c => ({ ...c, pts: thin(c.pts, N) }));
  const nCurveCols = Math.max(2, curves.length * 2);
  g.set(1, 1, "Напорные характеристики", S_TITLE);
  g.merge(1, 1, 1, nCurveCols);
  curves.forEach((c, i) => {
    const c0 = i * 2 + 1;
    g.set(2, c0, c.label, S_HEAD); g.set(2, c0 + 1, "", S_HEAD); g.merge(2, c0, 2, c0 + 1);
    g.set(3, c0, "Q", S_HEAD); g.set(3, c0 + 1, "H", S_HEAD);
    c.pts.forEach((p, k) => { g.set(4 + k, c0, r2(p.q), S_NUM); g.set(4 + k, c0 + 1, r1(p.h), S_NUM); });
    series.push({ name: c.label, nameRef: ref(c0, 2), x: rng(c0, 4, 3 + c.pts.length), y: rng(c0 + 1, 4, 3 + c.pts.length), color: c.color, kind: "curve" });
  });
  const maxRows = Math.max(N, ...curves.map(c => c.pts.length));

  // ── Рабочая точка ──────────────────────────────────────────────────────
  let row = 4 + maxRows + 1;               // 15 при 10 точках — как в образце
  const opRow = row;
  g.set(row, 1, "Рабочая точка", S_TITLE);
  g.merge(row, 1, row, Math.max(2, b.points.length * 2));
  b.points.forEach((p, i) => {
    const c0 = i * 2 + 1;
    g.set(opRow + 1, c0, "Q", S_HEAD); g.set(opRow + 1, c0 + 1, "H", S_HEAD);
    g.set(opRow + 2, c0, r2(p.q), S_NUM); g.set(opRow + 2, c0 + 1, r1(p.h), S_NUM);
    g.set(opRow + 3, c0, p.label, S_CELL); g.merge(opRow + 3, c0, opRow + 3, c0 + 1);
    series.push({ name: p.label, nameRef: ref(c0, opRow + 3), x: ref(c0, opRow + 2), y: ref(c0 + 1, opRow + 2), color: "E11D48", kind: "point" });
  });
  if (b.points.length === 0) {
    g.set(opRow + 1, 1, "Q", S_HEAD); g.set(opRow + 1, 2, "H", S_HEAD);
    g.set(opRow + 2, 1, "нет данных — выполните расчёт сети (F9)", S_CELL);
  }
  row = opRow + 5;

  // ── Значения КПД ───────────────────────────────────────────────────────
  const isoRow = row;
  g.set(isoRow, 1, "Значения КПД", S_TITLE);
  g.merge(isoRow, 1, isoRow, Math.max(2, b.isolines.length * 2));
  b.isolines.forEach((l, i) => {
    const c0 = i * 2 + 1;
    g.set(isoRow + 1, c0, l.label, S_HEAD); g.set(isoRow + 1, c0 + 1, "", S_HEAD); g.merge(isoRow + 1, c0, isoRow + 1, c0 + 1);
    g.set(isoRow + 2, c0, "Q", S_HEAD); g.set(isoRow + 2, c0 + 1, "H", S_HEAD);
    l.pts.forEach((p, k) => { g.set(isoRow + 3 + k, c0, r2(p.q), S_NUM); g.set(isoRow + 3 + k, c0 + 1, r1(p.h), S_NUM); });
    series.push({ name: l.label, nameRef: ref(c0, isoRow + 1), x: rng(c0, isoRow + 3, isoRow + 2 + l.pts.length), y: rng(c0 + 1, isoRow + 3, isoRow + 2 + l.pts.length), color: "6B7280", kind: "iso" });
  });

  // ── Характеристики сети R·Q² ──────────────────────────────────────────
  // Диапазон — как на графике в программе: Q от 0 до края оси, линия
  // обрезается по верхней границе напора, чтобы не растягивать шкалу Excel.
  const nets = (b.networks ?? []).filter(n => n.r > 0);
  if (nets.length > 0) {
    const isoLen = Math.max(0, ...b.isolines.map(l => l.pts.length));
    const netRow = b.isolines.length > 0 ? isoRow + 3 + isoLen + 1 : isoRow + 3;
    const allQ = [...b.curves.flatMap(c => c.pts.map(p => p.q)), ...b.points.map(p => p.q)];
    const allH = [...b.curves.flatMap(c => c.pts.map(p => p.h)), ...b.points.map(p => p.h)];
    const maxQ = (Math.max(0, ...allQ) || 100) * 1.05;
    const maxH = (Math.max(0, ...allH) || 1000) * 1.1;
    const NP = 21;
    g.set(netRow, 1, "Характеристика сети H = R·Q²", S_TITLE);
    g.merge(netRow, 1, netRow, Math.max(2, nets.length * 2));
    nets.forEach((n, i) => {
      const c0 = i * 2 + 1;
      const qEnd = Math.min(maxQ, Math.sqrt(maxH / n.r));
      g.set(netRow + 1, c0, n.label, S_HEAD); g.set(netRow + 1, c0 + 1, "", S_HEAD); g.merge(netRow + 1, c0, netRow + 1, c0 + 1);
      g.set(netRow + 2, c0, `R = ${+n.r.toPrecision(4)} Н·с²/м⁸`, S_CELL); g.merge(netRow + 2, c0, netRow + 2, c0 + 1);
      g.set(netRow + 3, c0, "Q", S_HEAD); g.set(netRow + 3, c0 + 1, "H", S_HEAD);
      for (let k = 0; k < NP; k++) {
        const q = qEnd * k / (NP - 1);
        g.set(netRow + 4 + k, c0, r2(q), S_NUM);
        g.set(netRow + 4 + k, c0 + 1, r1(n.r * q * q), S_NUM);
      }
      series.push({ name: n.label, nameRef: ref(c0, netRow + 1), x: rng(c0, netRow + 4, netRow + 3 + NP), y: rng(c0 + 1, netRow + 4, netRow + 3 + NP), color: n.color, kind: "net" });
    });
  }

  const cols = Math.max(nCurveCols, b.points.length * 2, b.isolines.length * 2, nets.length * 2, 2);
  return { xml: g.xml(cols), series, cols };
}

// ── Диаграмма ───────────────────────────────────────────────────────────────

function serXml(i: number, s: SeriesRef): string {
  const hex = s.color.replace("#", "").toUpperCase();
  const line = s.kind === "point"
    ? `<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>`
    : s.kind === "net"
    ? `<c:spPr><a:ln w="19050" cap="rnd"><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:prstDash val="dash"/><a:round/></a:ln></c:spPr>`
    : `<c:spPr><a:ln w="${s.kind === "iso" ? 12700 : 25400}" cap="rnd"><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>${s.kind === "iso" ? '<a:prstDash val="dash"/>' : ""}<a:round/></a:ln></c:spPr>`;
  const marker = s.kind === "point"
    ? `<c:marker><c:symbol val="circle"/><c:size val="9"/><c:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>`
    : `<c:marker><c:symbol val="none"/></c:marker>`;
  const lbl = s.kind === "point"
    ? `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"/></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr><c:dLblPos val="r"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/><c:separator>; </c:separator></c:dLbls>`
    : s.kind === "iso"
      ? `<c:dLbls><c:dLbl><c:idx val="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"><a:solidFill><a:srgbClr val="6B7280"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr><c:dLblPos val="l"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="1"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
      : "";
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>
<c:tx><c:strRef><c:f>${esc(s.nameRef)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>
${line}${marker}${lbl}
<c:xVal><c:numRef><c:f>${esc(s.x)}</c:f></c:numRef></c:xVal>
<c:yVal><c:numRef><c:f>${esc(s.y)}</c:f></c:numRef></c:yVal>
<c:smooth val="1"/></c:ser>`;
}

function chartXml(title: string, series: SeriesRef[]): string {
  // Порядок как в программе: изолинии КПД, сеть R·Q², кривые, рабочие точки
  const ordered = (["iso", "net", "curve", "point"] as const).flatMap(k => series.filter(s => s.kind === k));
  const axTitle = (t: string, rot = false) =>
    `<c:title><c:tx><c:rich><a:bodyPr${rot ? ' rot="-5400000" vert="horz"' : ""}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000" b="0"/></a:pPr><a:r><a:rPr lang="ru-RU" sz="1000" b="0"/><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="ru-RU" sz="1400" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:scatterChart><c:scatterStyle val="smoothMarker"/><c:varyColors val="0"/>
${ordered.map((s, i) => serXml(i, s)).join("\n")}
<c:axId val="500000001"/><c:axId val="500000002"/>
</c:scatterChart>
<c:valAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>
<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>
${axTitle("Расход Q, м³/с")}
<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>
<c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>
<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>
<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>
${axTitle("Напор H, Па", true)}
<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>
<c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>
<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
</c:plotArea>
<c:legend><c:legendPos val="r"/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr></c:legend>
<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
</c:chart>
<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr>
</c:chartSpace>`;
}

const drawingXml = (name: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor>
<xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>17</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>34</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
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

const rels = (items: { id: string; type: string; target: string }[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${items.map(i => `<Relationship Id="${i.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${i.type}" Target="${i.target}"/>`).join("\n")}
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs>
</styleSheet>`;

/** Сборка книги (Blob) — отдельно от скачивания, чтобы можно было проверить. */
export async function buildFanOperatingPointXlsx(d: FanOperatingPointXls): Promise<Blob> {
  const parts: { chartName: string; dataName: string; block: FanXlsBlock }[] = [
    { chartName: "Графики", dataName: "Табличные данные", block: d.forward },
  ];
  if (d.reverse && d.reverse.curves.length > 0) {
    parts.push({ chartName: "Графики (реверс)", dataName: "Табличные данные (реверс)", block: d.reverse });
  }

  const zip = new JSZip();
  const xl = zip.folder("xl")!;
  const ws = xl.folder("worksheets")!;
  const wsRels = ws.folder("_rels")!;
  const dr = xl.folder("drawings")!;
  const drRels = dr.folder("_rels")!;
  const ch = xl.folder("charts")!;

  const sheets: { name: string; file: string }[] = [];
  const overrides: string[] = [];
  let sheetNo = 0;
  parts.forEach((p, i) => {
    const n = i + 1;
    const data = buildDataSheet(p.dataName, p.block);
    // Лист с графиком
    sheetNo++;
    const chartSheet = `sheet${sheetNo}.xml`;
    sheets.push({ name: p.chartName, file: chartSheet });
    ws.file(chartSheet, new Grid().xml(0, true));
    wsRels.file(`${chartSheet}.rels`, rels([{ id: "rId1", type: "drawing", target: `../drawings/drawing${n}.xml` }]));
    dr.file(`drawing${n}.xml`, drawingXml(p.chartName));
    drRels.file(`drawing${n}.xml.rels`, rels([{ id: "rId1", type: "chart", target: `../charts/chart${n}.xml` }]));
    ch.file(`chart${n}.xml`, chartXml(i === 0 ? d.fanName : `${d.fanName} (реверс)`, data.series));
    overrides.push(
      `<Override PartName="/xl/worksheets/${chartSheet}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      `<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
    );
    // Лист с таблицей
    sheetNo++;
    const dataSheet = `sheet${sheetNo}.xml`;
    sheets.push({ name: p.dataName, file: dataSheet });
    ws.file(dataSheet, data.xml);
    overrides.push(`<Override PartName="/xl/worksheets/${dataSheet}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  });

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides.join("\n")}
</Types>`);
  zip.folder("_rels")!.file(".rels", rels([{ id: "rId1", type: "officeDocument", target: "xl/workbook.xml" }]));
  xl.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`);
  xl.folder("_rels")!.file("workbook.xml.rels", rels([
    ...sheets.map((s, i) => ({ id: `rId${i + 1}`, type: "worksheet", target: `worksheets/${s.file}` })),
    { id: `rId${sheets.length + 1}`, type: "styles", target: "styles.xml" },
  ]));
  xl.file("styles.xml", STYLES);

  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Выгрузка рабочей точки вентилятора в Excel (скачивание файла). */
export async function exportFanOperatingPointToExcel(d: FanOperatingPointXls): Promise<void> {
  const blob = await buildFanOperatingPointXlsx(d);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Рабочая точка ${d.fanName.replace(/[\\/:*?"<>|]/g, "_")}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
