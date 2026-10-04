// ─────────────────────────────────────────────────────────────────────────────
// Руководство пользователя → Word (.docx).
//
// Источник — те же разделы, что в окне «Помощь» (help/helpContent.ts), поэтому
// скачанный файл всегда совпадает со справкой в программе. Каждый раздел
// рендерится в статический HTML (react-dom/server), затем HTML-дерево
// переводится в абзацы, списки и таблицы docx.
// ─────────────────────────────────────────────────────────────────────────────
import { renderToStaticMarkup } from "react-dom/server";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  AlignmentType, HeadingLevel, PageBreak, BorderStyle, ShadingType,
} from "docx";
import { getHelpSections, helpGroupMap } from "@/components/cad/help/helpContent";
import { APP_VERSION, APP_BUILD_DATE } from "@/lib/appVersion";

const FONT = "Calibri";
const SIZE = 22;          // 11 pt
const ACCENT = "A66B0D";  // янтарь бренда

type RunOpts = { bold?: boolean; italics?: boolean; mono?: boolean; sub?: boolean; sup?: boolean };
type Inline = TextRun;
type Block = Paragraph | Table;

const BLOCK_TAGS = new Set(["DIV", "P", "UL", "OL", "LI", "TABLE", "H1", "H2", "H3", "H4", "DETAILS", "SUMMARY", "SECTION"]);

function run(text: string, o: RunOpts = {}): TextRun {
  return new TextRun({
    text, bold: o.bold, italics: o.italics, subScript: o.sub, superScript: o.sup,
    font: o.mono ? "Consolas" : FONT, size: o.mono ? SIZE - 2 : SIZE,
  });
}

function isBoldClass(el: Element): boolean {
  const c = el.getAttribute("class") ?? "";
  return /\bfont-(semibold|bold)\b/.test(c);
}

/** Строчные фрагменты элемента (без блочных потомков). */
function inlineRuns(node: Node, o: RunOpts, out: Inline[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent ?? "").replace(/\s+/g, " ");
    if (t) out.push(run(t, o));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (tag === "SVG" || tag === "svg" || el.namespaceURI === "http://www.w3.org/2000/svg") return;
  if (tag === "BR") { out.push(new TextRun({ break: 1 })); return; }
  const cls = el.getAttribute("class") ?? "";
  if (cls.includes("help-step-n")) { out.push(run(`${el.textContent?.trim()}. `, { bold: true })); return; }
  if (el.getAttribute("aria-hidden") === "true") return;
  const next: RunOpts = { ...o };
  if (tag === "B" || tag === "STRONG" || isBoldClass(el)) next.bold = true;
  if (tag === "I" || tag === "EM") next.italics = true;
  if (tag === "KBD" || tag === "CODE") { next.mono = true; next.bold = true; }
  if (tag === "SUB") next.sub = true;
  if (tag === "SUP") next.sup = true;
  el.childNodes.forEach(ch => inlineRuns(ch, next, out));
}

/** Убрать пробелы в начале и конце абзаца. */
function hasText(runs: Inline[], el: Element | null): boolean {
  return runs.length > 0 && !!el?.textContent?.trim();
}

function para(runs: Inline[], opts: { indent?: number; spacingAfter?: number; shade?: string } = {}): Paragraph {
  return new Paragraph({
    children: runs,
    alignment: AlignmentType.LEFT,
    indent: opts.indent ? { left: opts.indent } : undefined,
    spacing: { after: opts.spacingAfter ?? 80, line: 276 },
    shading: opts.shade ? { type: ShadingType.CLEAR, color: "auto", fill: opts.shade } : undefined,
  });
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "B9B4A9" };

function tableBlock(el: Element): Table | null {
  const rows = Array.from(el.querySelectorAll("tr"));
  if (!rows.length) return null;
  const maxCols = Math.max(...rows.map(r => Array.from(r.children).reduce((n, c) => n + (parseInt(c.getAttribute("colspan") ?? "1") || 1), 0)));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(tr => new TableRow({
      children: Array.from(tr.children).map(td => {
        const isHead = td.tagName.toUpperCase() === "TH";
        const span = parseInt(td.getAttribute("colspan") ?? "1") || 1;
        const runs: Inline[] = [];
        inlineRuns(td, { bold: isHead || span === maxCols }, runs);
        return new TableCell({
          columnSpan: span > 1 ? span : undefined,
          shading: isHead || span === maxCols ? { type: ShadingType.CLEAR, color: "auto", fill: "F1EEE6" } : undefined,
          borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          children: [new Paragraph({ children: runs.length ? runs : [run("")], spacing: { after: 0 } })],
        });
      }),
    })),
  });
}

/** Перевод HTML-узла в блоки docx. */
function blocks(node: Element, out: Block[], indent = 0) {
  let pending: Inline[] = [];
  let pendingHas = false;
  const flush = () => {
    if (pending.length && pendingHas) out.push(para(pending, { indent }));
    pending = []; pendingHas = false;
  };

  node.childNodes.forEach(ch => {
    if (ch.nodeType === Node.TEXT_NODE) {
      if ((ch.textContent ?? "").trim()) pendingHas = true;
      inlineRuns(ch, {}, pending);
      return;
    }
    if (ch.nodeType !== Node.ELEMENT_NODE) return;
    const el = ch as Element;
    const tag = el.tagName.toUpperCase();
    if (el.namespaceURI === "http://www.w3.org/2000/svg") return;
    if (!BLOCK_TAGS.has(tag)) {
      if (el.textContent?.trim()) pendingHas = true;
      inlineRuns(el, {}, pending);
      return;
    }
    flush();
    if (tag === "H3" || tag === "H2" || tag === "H4") {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) out.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text, bold: true, font: FONT, size: 26, color: ACCENT })],
      }));
    } else if (tag === "TABLE") {
      const t = tableBlock(el);
      if (t) { out.push(t); out.push(para([run("")], { spacingAfter: 40 })); }
    } else if (tag === "UL" || tag === "OL") {
      let n = 0;
      Array.from(el.children).forEach(li => {
        if (li.tagName.toUpperCase() !== "LI") return;
        n++;
        // У шагов (QStep) номер уже нарисован внутри пункта
        const ownNum = !!li.querySelector(".help-step-n");
        listItem(li, out, indent + 360, tag === "OL" && !ownNum ? `${n}. ` : "");
      });
    } else if (tag === "LI") {
      listItem(el, out, indent + 360, "");
    } else if (tag === "DETAILS") {
      const summary = el.querySelector("summary");
      if (summary) {
        const runs: Inline[] = [];
        inlineRuns(summary, { bold: true }, runs);
        out.push(para([run("❓ ", { bold: true }), ...runs], { indent, spacingAfter: 40 }));
      }
      Array.from(el.children).forEach(c => { if (c !== summary) blocks(c, out, indent + 360); });
    } else {
      // DIV / P: если внутри только строчные элементы — один абзац
      const hasBlockChild = Array.from(el.children).some(c => BLOCK_TAGS.has(c.tagName.toUpperCase()));
      if (!hasBlockChild) {
        const runs: Inline[] = [];
        inlineRuns(el, {}, runs);
        if (hasText(runs, el)) out.push(para(runs, { indent }));
      } else {
        blocks(el, out, indent);
      }
    }
  });
  flush();
}

/** Пункт списка: всё содержимое — одним абзацем (блочные части через перенос строки). */
function listItem(li: Element, out: Block[], indent: number, prefix: string) {
  const nested = Array.from(li.children).filter(c => ["UL", "OL", "TABLE"].includes(c.tagName.toUpperCase()));
  const runs: Inline[] = [];
  if (prefix) runs.push(run(prefix, { bold: true }));
  const walk = (n: Node, first: { v: boolean }) => {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element;
      const tag = el.tagName.toUpperCase();
      if (nested.includes(el)) return;
      if (BLOCK_TAGS.has(tag) && !(el.getAttribute("class") ?? "").includes("help-step-n")) {
        const hasBlockChild = Array.from(el.children).some(c => BLOCK_TAGS.has(c.tagName.toUpperCase()));
        if (hasBlockChild) { el.childNodes.forEach(c => walk(c, first)); return; }
        if (!el.textContent?.trim()) return;
        if (!first.v) runs.push(new TextRun({ break: 1 }));
        first.v = false;
        inlineRuns(el, {}, runs);
        return;
      }
    }
    if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim()) first.v = false;
    inlineRuns(n, {}, runs);
  };
  const first = { v: true };
  li.childNodes.forEach(c => walk(c, first));
  if (li.textContent?.trim()) out.push(para(runs, { indent, spacingAfter: 60 }));
  nested.forEach(n => blocks(wrap(n), out, indent));
}

function wrap(el: Element): Element {
  const d = el.ownerDocument.createElement("div");
  d.appendChild(el.cloneNode(true));
  return d;
}

/** Собрать руководство в .docx. */
export async function buildHelpDocx(): Promise<Blob> {
  const sections = getHelpSections();
  const groups = helpGroupMap();
  const parser = new DOMParser();
  const children: Block[] = [];

  // ── Титул ──
  children.push(new Paragraph({ spacing: { before: 2400 }, children: [] }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "ПВ-Система", bold: true, font: FONT, size: 56, color: ACCENT })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: "Программа расчёта вентиляции шахт и рудников", font: FONT, size: 28 })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 600 },
    children: [new TextRun({ text: "РУКОВОДСТВО ПОЛЬЗОВАТЕЛЯ", bold: true, font: FONT, size: 36 })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Версия ${APP_VERSION} · сборка ${APP_BUILD_DATE}`, font: FONT, size: 22, color: "555555" })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Документ сформирован ${new Date().toLocaleDateString("ru-RU")}`, font: FONT, size: 20, color: "777777" })],
  }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Содержание ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { after: 200 },
    children: [new TextRun({ text: "Содержание", bold: true, font: FONT, size: 32 })],
  }));
  let lastGroup = "";
  sections.forEach((s, i) => {
    const g = groups.get(s.id) ?? "Прочее";
    if (g !== lastGroup) {
      lastGroup = g;
      children.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: g.toUpperCase(), bold: true, font: FONT, size: 20, color: ACCENT })],
      }));
    }
    children.push(new Paragraph({
      indent: { left: 360 }, spacing: { after: 40 },
      children: [new TextRun({ text: `${i + 1}. ${s.title}`, font: FONT, size: SIZE })],
    }));
  });

  // ── Разделы ──
  sections.forEach((s, i) => {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: (groups.get(s.id) ?? "Руководство").toUpperCase(), font: FONT, size: 18, color: "888888" })],
    }));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1, spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 4 } },
      children: [new TextRun({ text: `${i + 1}. ${s.title}`, bold: true, font: FONT, size: 34, color: "1F2328" })],
    }));
    const html = renderToStaticMarkup(s.content as React.ReactElement);
    const doc = parser.parseFromString(`<div id="root">${html}</div>`, "text/html");
    const root = doc.getElementById("root");
    if (root) blocks(root, children);
  });

  const docx = new Document({
    creator: "ПВ-Система",
    title: "ПВ-Система — Руководство пользователя",
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1418, right: 850 } } },
      children,
    }],
  });
  return Packer.toBlob(docx);
}

export function helpDocxFileName(): string {
  return `ПВ-Система_Руководство_пользователя_v${APP_VERSION}.docx`;
}