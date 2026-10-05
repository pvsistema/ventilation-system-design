// Единое описание блока «УТВЕРЖДАЮ» (правый верхний угол чертежа).
// Фиксированный размер 75×40 мм. Координаты в мм от левого-верхнего угла блока.
// Используется и для отрисовки на схеме (TopoCanvas), и при печати/экспорте.
import type { HorizonPrintLayer } from "@/lib/topology";

/** Размер блока УТВЕРЖДАЮ в мм */
export const APPROVER_W_MM = 75;
export const APPROVER_H_MM = 40;

/**
 * Два одинаковых по устройству блока подписи:
 *   «УТВЕРЖДАЮ»   — по умолчанию в правом верхнем углу рамки;
 *   «СОГЛАСОВАНО» — по умолчанию в левом верхнем углу.
 * У каждого свои поля, положение (смещение в мм листа), размер и шрифт.
 */
export type SignBlockKind = "approve" | "agree" | "develop";

/** Блок «Разработал» (строка: должность — ФИО — подпись), по умолчанию под таблицей маршрутов */
export const DEVELOP_W_MM = 130;
export const DEVELOP_H_MM = 15;

/** Размер блока подписи в мм (без масштаба) */
export function signBlockSizeMm(kind: SignBlockKind): { w: number; h: number } {
  return kind === "develop" ? { w: DEVELOP_W_MM, h: DEVELOP_H_MM } : { w: APPROVER_W_MM, h: APPROVER_H_MM };
}

/** Ключи редактируемых полей блока (совпадают с полями HorizonPrintLayer) */
export type ApproverFieldKey =
  | "approverTitle"  // должность
  | "orgName"        // организация
  | "approverName"   // ФИО
  | "day" | "month" | "year"
  | "agreeTitle" | "agreeOrg" | "agreeName"
  | "agreeDay" | "agreeMonth" | "agreeYear"
  | "developTitle" | "developName";

/** Поля блока по его виду */
const FIELDS: Record<"approve" | "agree", {
  title: ApproverFieldKey; org: ApproverFieldKey; name: ApproverFieldKey;
  day: ApproverFieldKey; month: ApproverFieldKey; year: ApproverFieldKey; caption: string;
}> = {
  approve: { title: "approverTitle", org: "orgName", name: "approverName", day: "day", month: "month", year: "year", caption: "УТВЕРЖДАЮ" },
  agree:   { title: "agreeTitle", org: "agreeOrg", name: "agreeName", day: "agreeDay", month: "agreeMonth", year: "agreeYear", caption: "СОГЛАСОВАНО" },
};

/** Ключи настроек блока (положение, размер, шрифт) в HorizonPrintLayer */
export function signBlockKeys(kind: SignBlockKind) {
  if (kind === "approve")
    return { show: "showApprover", offX: "approverOffsetX", offY: "approverOffsetY", scale: "approverScale", font: "approverFontScale" } as const;
  if (kind === "develop")
    return { show: "showDeveloper", offX: "developOffsetX", offY: "developOffsetY", scale: "developScale", font: "developFontScale" } as const;
  return { show: "showAgree", offX: "agreeOffsetX", offY: "agreeOffsetY", scale: "agreeScale", font: "agreeFontScale" } as const;
}

/** Включённые блоки подписи слоя печати */
export function enabledSignBlocks(pl: HorizonPrintLayer): SignBlockKind[] {
  const out: SignBlockKind[] = [];
  if (pl.showAgree) out.push("agree");
  if (pl.showApprover) out.push("approve");
  if (pl.showDeveloper) out.push("develop");
  return out;
}

/** Год по умолчанию — текущий (только для блоков без заполненного года) */
export function isYearField(f: ApproverFieldKey) { return f === "year" || f === "agreeYear"; }

export interface ApproverElement {
  /** Позиция текста в мм */
  x: number; y: number;
  /** Статичная надпись (нередактируемая) */
  label?: string;
  /** Ключ редактируемого поля */
  field?: ApproverFieldKey;
  /** Плейсхолдер */
  placeholder?: string;
  /** Выравнивание */
  align?: "left" | "center" | "right";
  /** Множитель шрифта относительно базового */
  fontScale?: number;
  /** Цвет текста */
  color?: string;
  /** Ширина области ячейки для редактирования (мм). По умолчанию до края блока. */
  cellW?: number;
  /** X-начало ячейки для редактирования (мм). По умолчанию 0. */
  cellX?: number;
}

export interface ApproverLine {
  x1: number; y1: number; x2: number; y2: number;
}

const CX = APPROVER_W_MM / 2;

/** Собрать элементы блока (УТВЕРЖДАЮ / СОГЛАСОВАНО) */
export function buildApproverElements(kind: SignBlockKind = "approve"): ApproverElement[] {
  if (kind === "develop") {
    // «Разработал:»  Должность ____  И.О. Фамилия ____  ____ (подпись)
    const cap = "#777";
    return [
      { x: 2, y: 3.5, label: "Разработал:", align: "left", fontScale: 1.05 },
      { x: 2,  y: 8.5, field: "developTitle", placeholder: "Должность", align: "left", fontScale: 0.95, cellX: 1, cellW: 50 },
      { x: 56, y: 8.5, field: "developName", placeholder: "И.О. Фамилия", align: "left", fontScale: 0.95, color: "#111", cellX: 55, cellW: 40 },
      { x: 27, y: 13.2, label: "должность", align: "center", fontScale: 0.65, color: cap },
      { x: 75, y: 13.2, label: "И.О. Фамилия", align: "center", fontScale: 0.65, color: cap },
      { x: 113, y: 13.2, label: "подпись", align: "center", fontScale: 0.65, color: cap },
    ];
  }
  const f = FIELDS[kind];
  return [
    { x: CX, y: 5,  label: f.caption, align: "center", fontScale: 1.1 },
    { x: CX, y: 12, field: f.title, placeholder: "Должность", align: "center", fontScale: 0.95, cellX: 4, cellW: APPROVER_W_MM - 8 },
    { x: CX, y: 18, field: f.org,   placeholder: "Организация", align: "center", fontScale: 0.95, cellX: 4, cellW: APPROVER_W_MM - 8 },
    // ФИО над линией подписи
    { x: APPROVER_W_MM - 4, y: 27, field: f.name, placeholder: "И.О. Фамилия", align: "right", fontScale: 0.95, color: "#111", cellX: 22, cellW: APPROVER_W_MM - 26 },
    // Дата: «день» месяц год г.
    { x: 3,  y: 36, label: "«", align: "left", fontScale: 0.95 },
    { x: 6,  y: 36, field: f.day,   placeholder: "__", align: "left", fontScale: 0.95, cellX: 5,  cellW: 8 },
    { x: 13, y: 36, label: "»",     align: "left", fontScale: 0.95 },
    { x: 16, y: 36, field: f.month, placeholder: "__________", align: "left", fontScale: 0.95, cellX: 16, cellW: 30 },
    { x: APPROVER_W_MM - 3, y: 36, field: f.year, placeholder: "", align: "right", fontScale: 0.95, cellX: APPROVER_W_MM - 22, cellW: 18 },
  ];
}

/** Линии-подчёркивания блока (в мм) */
export function buildApproverLines(kind: SignBlockKind = "approve"): ApproverLine[] {
  if (kind === "develop") {
    return [
      { x1: 2,  y1: 11, x2: 52,  y2: 11 },  // должность
      { x1: 55, y1: 11, x2: 95,  y2: 11 },  // ФИО
      { x1: 98, y1: 11, x2: 128, y2: 11 },  // подпись
    ];
  }
  return [
    { x1: 8, y1: 22, x2: APPROVER_W_MM - 8, y2: 22 }, // под должностью/организацией
    { x1: 0, y1: 30, x2: APPROVER_W_MM, y2: 30 },     // под ФИО (линия подписи)
  ];
}

/** Значение поля */
export function getApproverFieldValue(pl: HorizonPrintLayer, field: ApproverFieldKey): string {
  const v = (pl as unknown as Record<string, unknown>)[field];
  return typeof v === "string" ? v : "";
}

export const SIGN_SCALE_MIN = 0.5, SIGN_SCALE_MAX = 2.5;
export const SIGN_FONT_MIN = 0.6, SIGN_FONT_MAX = 2;

export interface SignBox {
  /** px на мм ВНУТРИ блока (с учётом размера блока) */
  pxPerMm: number;
  /** px на мм листа (без масштаба блока) — для перевода перетаскивания в мм */
  sheetPxPerMm: number;
  w: number; h: number; ax: number; ay: number;
  /** Базовый размер шрифта, px */
  baseFs: number;
  /** Толщина линий, px */
  lw: number;
}

/**
 * Геометрия блока подписи. Размер блока — 75×40 мм листа × масштаб блока;
 * «УТВЕРЖДАЮ» у правого верхнего угла рамки, «СОГЛАСОВАНО» — у левого;
 * смещение хранится в мм листа, поэтому блок не «уплывает» при зуме.
 */
export function computeApproverBox(
  rx: number, ry: number, rw: number, inset: number, paperWmm: number,
  pl?: Partial<HorizonPrintLayer>, kind: SignBlockKind = "approve",
  /** Высота рамки (px) — нужна блоку «Разработал», он стоит у нижнего края */
  rh?: number,
): SignBox {
  const k = signBlockKeys(kind);
  const rec = (pl ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const scale = Math.min(SIGN_SCALE_MAX, Math.max(SIGN_SCALE_MIN, num(rec[k.scale], 1)));
  const font = Math.min(SIGN_FONT_MAX, Math.max(SIGN_FONT_MIN, num(rec[k.font], 1)));
  const sheetPxPerMm = rw / paperWmm;
  const pxPerMm = sheetPxPerMm * scale;
  const size = signBlockSizeMm(kind);
  const w = size.w * pxPerMm;
  const h = size.h * pxPerMm;
  const offX = num(rec[k.offX], 0) * sheetPxPerMm;
  const offY = num(rec[k.offY], 0) * sheetPxPerMm;
  // Отступ от внутренней рамки, чтобы белая подложка блока не закрывала линию рамки
  const gap = Math.max(2, 3 * sheetPxPerMm);
  const innerL = rx + inset + gap, innerR = rx + rw - inset - gap, innerT = ry + inset + gap;
  let ax: number, ay: number;
  if (kind === "develop") {
    // Внизу слева — под таблицей маршрутов (правее УО, как и сама таблица)
    const innerB = ry + (rh ?? 0) - inset - gap;
    const pad = 4 * sheetPxPerMm;
    ax = rx + inset + pad + (rec.showLegend ? 66 * sheetPxPerMm : 0) + offX;
    ay = (rh != null ? innerB - h : innerT) + offY;
    if (rh != null) ay = Math.min(innerB - h, ay);
  } else {
    ax = (kind === "approve" ? innerR - w : innerL) + offX;
    ay = innerT + offY;
  }
  // Блок не выходит за левую/правую/верхнюю границу внутренней рамки
  if (innerR - innerL >= w) ax = Math.min(innerR - w, Math.max(innerL, ax));
  ay = Math.max(innerT, ay);
  return {
    pxPerMm, sheetPxPerMm, w, h, ax, ay,
    baseFs: Math.max(6 * scale, pxPerMm * 2.6) * font,
    lw: Math.max(0.4, pxPerMm * 0.15),
  };
}

/** SVG-строка блока УТВЕРЖДАЮ (для печати/экспорта) */
export function buildApproverSvgString(
  pl: HorizonPrintLayer,
  box: SignBox,
  kind: SignBlockKind = "approve",
): string {
  const esc = (s: string) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const nf = (v: number) => v.toFixed(2);
  const { pxPerMm, w, h, ax, ay } = box;
  const mx = (m: number) => ax + m * pxPerMm;
  const my = (m: number) => ay + m * pxPerMm;
  const baseFs = box.baseFs;
  const lw = box.lw;
  const yearNow = String(new Date().getFullYear());

  let out = `<rect x="${nf(ax)}" y="${nf(ay)}" width="${nf(w)}" height="${nf(h)}" fill="white"/>`;
  for (const ln of buildApproverLines(kind)) {
    out += `<line x1="${nf(mx(ln.x1))}" y1="${nf(my(ln.y1))}" x2="${nf(mx(ln.x2))}" y2="${nf(my(ln.y2))}" stroke="#111" stroke-width="${nf(lw)}"/>`;
  }
  for (const el of buildApproverElements(kind)) {
    const fs = baseFs * (el.fontScale ?? 1);
    const anchor = el.align === "left" ? "start" : el.align === "right" ? "end" : "middle";
    const color = el.color ?? "#111";
    let txt = el.label ?? "";
    if (el.field) {
      const v = getApproverFieldValue(pl, el.field);
      txt = v || (isYearField(el.field) ? yearNow : "");
      if (isYearField(el.field) && txt) txt += " г.";
    }
    if (!txt) continue;
    out += `<text x="${nf(mx(el.x))}" y="${nf(my(el.y))}" text-anchor="${anchor}" dominant-baseline="central" font-size="${nf(fs)}" font-family="Arial, sans-serif" fill="${color}">${esc(txt)}</text>`;
  }
  return out;
}