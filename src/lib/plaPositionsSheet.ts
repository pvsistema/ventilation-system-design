// ─────────────────────────────────────────────────────────────────────────────
// Лист «Перечень позиций плана ликвидации аварий» для печати и экспорта.
//
// Рисуется через API 2D-холста — поэтому один и тот же код даёт и растровый
// лист (печать, PNG, растровый PDF), и векторный (SvgRecordingContext →
// SVG / векторный PDF). Сначала общешахтные позиции, затем остальные по
// номеру. Для каждой позиции: маркер, номер, название, вид аварии, режим
// проветривания, тип (реверсивная/безреверсивная) и сценарий. Таблица
// переносится на следующие листы, если не помещается.
// ─────────────────────────────────────────────────────────────────────────────
import type { Position } from "./positions";

export interface PlaSheetOptions {
  /** Размер листа, мм. */
  paperW: number;
  paperH: number;
  /** Поля листа, мм. */
  margin: { top: number; right: number; bottom: number; left: number };
  /** Название проекта / рудника — в заголовке. */
  title: string;
}

type Ctx = CanvasRenderingContext2D;

interface Col { key: string; title: string; w: number; wrap?: boolean }
const COLS: Col[] = [
  { key: "no", title: "№", w: 13 },
  { key: "name", title: "Наименование позиции", w: 60, wrap: true },
  { key: "acc", title: "Вид аварии", w: 26, wrap: true },
  { key: "vent", title: "Режим проветривания", w: 34, wrap: true },
  { key: "type", title: "Тип", w: 24, wrap: true },
  { key: "scen", title: "Сценарий", w: 70, wrap: true },
];

/** Порядок в перечне: общешахтные первыми, внутри групп — по номеру. */
export function plaSheetRows(positions: Position[]): Position[] {
  return [...positions].sort((a, b) =>
    (a.isMineWide === b.isMineWide ? 0 : a.isMineWide ? -1 : 1) || a.number - b.number);
}

/** Разбивка текста по словам на строки заданной ширины (px). */
function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of (text || "").split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxW || !line) line = test;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

function cellText(p: Position, key: string): string {
  switch (key) {
    case "name": return p.name || `Позиция ${p.number}`;
    case "acc": return p.accidentType === "Нет" ? "—" : p.accidentType;
    case "vent": return p.ventMode || "—";
    case "type": return p.positionType === "reverse" ? "Реверсивная" : "Безреверсивная";
    case "scen": return p.scenario || "—";
    default: return "";
  }
}

/**
 * Разбивает позиции по листам и рисует лист pageIdx.
 * Возвращает общее число листов перечня (для номеров «лист N из M»).
 */
export function drawPlaSheet(
  ctx: Ctx, pxPerMm: number, positions: Position[], o: PlaSheetOptions, pageIdx: number,
): number {
  const pages = paginate(ctx, pxPerMm, positions, o);
  const rows = pages[pageIdx] ?? [];
  const mm = (v: number) => v * pxPerMm;
  const W = mm(o.paperW), H = mm(o.paperH);
  const x0 = mm(o.margin.left), y0 = mm(o.margin.top);
  const innerW = W - mm(o.margin.left + o.margin.right);
  const k = innerW / COLS.reduce((s, c) => s + mm(c.w), 0);
  const colW = COLS.map(c => mm(c.w) * k);

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Заголовок
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `700 ${mm(5)}px Arial, sans-serif`;
  ctx.fillText("ПЕРЕЧЕНЬ ПОЗИЦИЙ ПЛАНА ЛИКВИДАЦИИ АВАРИЙ", x0 + innerW / 2, y0);
  ctx.font = `400 ${mm(3.5)}px Arial, sans-serif`;
  const sub = [o.title, pages.length > 1 ? `лист ${pageIdx + 1} из ${pages.length}` : ""].filter(Boolean).join(" · ");
  if (sub) ctx.fillText(sub, x0 + innerW / 2, y0 + mm(7));

  let y = y0 + mm(14);
  const pad = mm(1.5);
  const fs = mm(3.2);
  const lh = fs * 1.3;

  // Шапка таблицы
  const headH = mm(8);
  ctx.fillStyle = "#eeeeee";
  ctx.fillRect(x0, y, innerW, headH);
  ctx.fillStyle = "#111111";
  ctx.font = `700 ${fs}px Arial, sans-serif`;
  ctx.textBaseline = "middle";
  let cx = x0;
  COLS.forEach((c, i) => {
    ctx.textAlign = "center";
    ctx.fillText(c.title, cx + colW[i] / 2, y + headH / 2);
    cx += colW[i];
  });
  const gridTop = y;
  y += headH;

  // Строки
  ctx.font = `400 ${fs}px Arial, sans-serif`;
  ctx.textBaseline = "top";
  const rowYs: number[] = [gridTop, y];
  // Участки с вертикальными линиями (шапка и строки), без подзаголовков групп.
  const colSpans: [number, number][] = [[gridTop, y]];
  let groupShown: boolean | null = null;
  for (const p of rows) {
    // Подзаголовок группы
    if (groupShown !== p.isMineWide) {
      groupShown = p.isMineWide;
      const gh = mm(6);
      ctx.fillStyle = "#f6f6f6";
      ctx.fillRect(x0, y, innerW, gh);
      ctx.fillStyle = "#333333";
      ctx.font = `700 ${fs}px Arial, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(p.isMineWide ? "Общешахтные позиции" : "Позиции по участкам", x0 + pad, y + gh / 2);
      ctx.font = `400 ${fs}px Arial, sans-serif`;
      ctx.textBaseline = "top";
      y += gh;
      rowYs.push(y);
    }
    const rowTop = y;
    const cells = COLS.map((c, i) => c.key === "no" ? [] : wrap(ctx, cellText(p, c.key), colW[i] - pad * 2));
    const rh = Math.max(mm(8), Math.max(...cells.map(l => l.length)) * lh + pad * 2);
    cx = x0;
    COLS.forEach((c, i) => {
      if (c.key === "no") {
        // Маркер позиции как на схеме
        const r = Math.min(colW[i], mm(8)) / 2 - mm(0.5);
        const mx = cx + colW[i] / 2, my = y + Math.min(rh, mm(8)) / 2;
        if (p.positionType === "reverse") {
          ctx.beginPath(); ctx.arc(mx, my, r + mm(0.6), 0, Math.PI * 2);
          ctx.strokeStyle = "#e53e3e"; ctx.lineWidth = mm(0.35); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color || "#ffffff"; ctx.fill();
        ctx.strokeStyle = p.borderColor || "#000000"; ctx.lineWidth = mm(0.35); ctx.stroke();
        ctx.fillStyle = "#000000";
        ctx.font = `700 ${fs}px Arial, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(p.number), mx, my);
        ctx.font = `400 ${fs}px Arial, sans-serif`;
        ctx.textBaseline = "top";
      } else {
        ctx.fillStyle = "#111111";
        ctx.textAlign = "left";
        cells[i].forEach((line, li) => ctx.fillText(line, cx + pad, y + pad + li * lh));
      }
      cx += colW[i];
    });
    y += rh;
    rowYs.push(y);
    colSpans.push([rowTop, y]);
  }

  // Сетка
  ctx.strokeStyle = "#555555";
  ctx.lineWidth = mm(0.2);
  ctx.beginPath();
  for (const ry of rowYs) { ctx.moveTo(x0, ry); ctx.lineTo(x0 + innerW, ry); }
  // Внешняя рамка — по всей высоте, внутренние линии — только в строках.
  ctx.moveTo(x0, gridTop); ctx.lineTo(x0, y);
  ctx.moveTo(x0 + innerW, gridTop); ctx.lineTo(x0 + innerW, y);
  for (const [a, b] of colSpans) {
    cx = x0;
    for (let i = 0; i < colW.length - 1; i++) { cx += colW[i]; ctx.moveTo(cx, a); ctx.lineTo(cx, b); }
  }
  ctx.stroke();

  if (rows.length === 0) {
    ctx.fillStyle = "#666666"; ctx.textAlign = "center";
    ctx.fillText("Позиций нет", x0 + innerW / 2, y + mm(4));
  }
  ctx.restore();
  return pages.length;
}

/** Число листов перечня. */
export function plaSheetPageCount(ctx: Ctx, pxPerMm: number, positions: Position[], o: PlaSheetOptions): number {
  return paginate(ctx, pxPerMm, positions, o).length;
}

function paginate(ctx: Ctx, pxPerMm: number, positions: Position[], o: PlaSheetOptions): Position[][] {
  const mm = (v: number) => v * pxPerMm;
  const innerW = mm(o.paperW - o.margin.left - o.margin.right);
  const k = innerW / COLS.reduce((s, c) => s + mm(c.w), 0);
  const colW = COLS.map(c => mm(c.w) * k);
  const pad = mm(1.5), fs = mm(3.2), lh = fs * 1.3;
  const usable = mm(o.paperH - o.margin.top - o.margin.bottom) - mm(14) - mm(8) - mm(8);
  ctx.save();
  ctx.font = `400 ${fs}px Arial, sans-serif`;
  const pages: Position[][] = [[]];
  let h = 0;
  let group: boolean | null = null;
  for (const p of plaSheetRows(positions)) {
    const cells = COLS.map((c, i) => c.key === "no" ? [""] : wrap(ctx, cellText(p, c.key), colW[i] - pad * 2));
    let rh = Math.max(mm(8), Math.max(...cells.map(l => l.length)) * lh + pad * 2);
    const newGroup = group !== p.isMineWide;
    if (newGroup) rh += mm(6);
    if (h + rh > usable && pages[pages.length - 1].length > 0) {
      pages.push([]);
      h = mm(6); // подзаголовок группы повторяется на новом листе
      group = null;
      rh = rh + (newGroup ? 0 : mm(6));
    }
    group = p.isMineWide;
    pages[pages.length - 1].push(p);
    h += rh;
  }
  ctx.restore();
  return pages;
}
