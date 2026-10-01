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
export type SignBlockKind = "approve" | "agree";

/** Ключи редактируемых полей блока (совпадают с полями HorizonPrintLayer) */
export type ApproverFieldKey =
  | "approverTitle"  // должность
  | "orgName"        // организация
  | "approverName"   // ФИО
  | "day" | "month" | "year"
  | "agreeTitle" | "agreeOrg" | "agreeName"
  | "agreeDay" | "agreeMonth" | "agreeYear";

/** Поля блока по его виду */
const FIELDS: Record<SignBlockKind, {
  title: ApproverFieldKey; org: ApproverFieldKey; name: ApproverFieldKey;
  day: ApproverFieldKey; month: ApproverFieldKey; year: ApproverFieldKey; caption: string;
}> = {
  approve: { title: "approverTitle", org: "orgName", name: "approverName", day: "day", month: "month", year: "year", caption: "УТВЕРЖДАЮ" },
  agree:   { title: "agreeTitle", org: "agreeOrg", name: "agreeName", day: "agreeDay", month: "agreeMonth", year: "agreeYear", caption: "СОГЛАСОВАНО" },
};

/** Ключи настроек блока (положение, размер, шрифт) в HorizonPrintLayer */
export function signBlockKeys(kind: SignBlockKind) {
  return kind === "approve"
    ? { show: "showApprover", offX: "approverOffsetX", offY: "approverOffsetY", scale: "approverScale", font: "approverFontScale" } as const
    : { show: "showAgree", offX: "agreeOffsetX", offY: "agreeOffsetY", scale: "agreeScale", font: "agreeFontScale" } as const;
}

/** Включённые блоки подписи слоя печати */
export function enabledSignBlocks(pl: HorizonPrintLayer): SignBlockKind[] {
  const out: SignBlockKind[] = [];
  if (pl.showAgree) out.push("agree");
  if (pl.showApprover) out.push("approve");
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
  const f = FIELDS[kind];
  return [
    { x: CX, y: 5,  label: f.caption, align: "center", fontScale: 1.1 },
    { x: CX, y: 12, field: f.title, placeholder: "Должность", align: "center", fontScale: 0.95, cellX: 4, cellW: APPROVER_W_MM - 8 },
    { x: CX, y: 18, field: f.org,   placeholder: "Организация", align: "center", fontScale: 0.95, cellX: 4, cellW: APPROVER_W_MM - 8 },
    // ФИО над линией подписи
    { x: APPROVER_W_MM - 4, y: 27, field: f.name, placeholder: "И.О. Фамилия", align: "right", fontScale: 0.95, color: "#1a44b8", cellX: 22, cellW: APPROVER_W_MM - 26 },
    // Дата: «день» месяц год г.
    { x: 3,  y: 36, label: "«", align: "left", fontScale: 0.95 },
    { x: 6,  y: 36, field: f.day,   placeholder: "__", align: "left", fontScale: 0.95, cellX: 5,  cellW: 8 },
    { x: 13, y: 36, label: "»",     align: "left", fontScale: 0.95 },
    { x: 16, y: 36, field: f.month, placeholder: "__________", align: "left", fontScale: 0.95, cellX: 16, cellW: 30 },
    { x: APPROVER_W_MM - 3, y: 36, field: f.year, placeholder: "", align: "right", fontScale: 0.95, cellX: APPROVER_W_MM - 22, cellW: 18 },
  ];
}

/** Линии-подчёркивания блока (в мм) */
export function buildApproverLines(): ApproverLine[] {
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
): SignBox {
  const k = signBlockKeys(kind);
  const rec = (pl ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const scale = Math.min(SIGN_SCALE_MAX, Math.max(SIGN_SCALE_MIN, num(rec[k.scale], 1)));
  const font = Math.min(SIGN_FONT_MAX, Math.max(SIGN_FONT_MIN, num(rec[k.font], 1)));
  const sheetPxPerMm = rw / paperWmm;
  const pxPerMm = sheetPxPerMm * scale;
  const w = APPROVER_W_MM * pxPerMm;
  const h = APPROVER_H_MM * pxPerMm;
  const offX = num(rec[k.offX], 0) * sheetPxPerMm;
  const offY = num(rec[k.offY], 0) * sheetPxPerMm;
  // Отступ от внутренней рамки, чтобы белая подложка блока не закрывала линию рамки
  const gap = Math.max(2, 3 * sheetPxPerMm);
  const innerL = rx + inset + gap, innerR = rx + rw - inset - gap, innerT = ry + inset + gap;
  let ax = (kind === "approve" ? innerR - w : innerL) + offX;
  let ay = innerT + offY;
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
  for (const ln of buildApproverLines()) {
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