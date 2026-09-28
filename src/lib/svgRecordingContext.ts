// ─────────────────────────────────────────────────────────────────────────────
// svgRecordingContext.ts — «записывающий» 2D-контекст: принимает ТЕ ЖЕ команды,
// что и CanvasRenderingContext2D (moveTo/lineTo/arc/fillText/…), но вместо
// пикселей собирает векторный SVG.
//
// ЗАЧЕМ. Раньше векторный PDF/SVG строился отдельным рендерером (удалён),
// который повторял логику схемы «по памяти»: свои формулы размеров позиций ПЛА,
// условных обозначений, подписей, стрелок. Он расходился и с рабочей областью,
// и с предпросмотром (например, позиции ПЛА выходили в разы крупнее).
// Теперь векторный экспорт рисуется ровно тем же кодом, что экран и растровая
// печать (renderCanvas + drawSymbolsToCanvas + позиции + текстовые блоки), —
// меняется только «холст», на который идут команды.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Шрифт, которым набирается текст в векторном файле. Это Golos Text — тот же,
 * что на экране, поэтому надписи и плашки в PDF/SVG совпадают со схемой.
 * Имя — внутреннее имя шрифта во встроенном PDF (см. vectorPdf.ts).
 */
export const VECTOR_FONT_FAMILY = "GolosText";
/** Имя, под которым тот же шрифт загружен в браузер — для measureText. */
const MEASURE_FONT_FAMILY = "PvGolosVectorMeasure";

/** Начертания векторного шрифта: 400 / 500 / 600 / 700. */
export type VectorFontWeight = 400 | 500 | 600 | 700;
export type VectorFontUrls = Record<VectorFontWeight, string>;

/**
 * Положение алфавитной базовой линии относительно точки привязки (доли кегля)
 * для textBaseline холста. Сняты с Chromium для Golos Text (ascent 0,98,
 * descent 0,22 → em-box 0,8167 / 0,1833), то есть ровно так, как экранный
 * холст ставит текст.
 */
const BASELINE_SHIFT: Record<string, number> = {
  top: 0.8167, hanging: 0.784, middle: 0.3167,
  bottom: -0.1833, ideographic: -0.22, alphabetic: 0,
};

/**
 * Реестр исходников векторных картинок: Image, созданный из SVG-разметки
 * (иконки УО), при записи вставляется как вложенный <svg>, а не растр.
 */
export const vectorImageSources = new WeakMap<object, { svg: string; viewBox: string }>();

type M = [number, number, number, number, number, number]; // a b c d e f

function mul(m: M, n: M): M {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function f(v: number): string {
  if (!isFinite(v)) return "0";
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface State {
  m: M;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  dash: number[];
  lineDashOffset: number;
  filter: string;
  /** Сколько <g clip-path> открыто в этом состоянии (закрываются в restore). */
  clipGroups: number;
}

// Вспомогательный настоящий canvas: нормализация цветов и измерение текста.
let helperCtx: CanvasRenderingContext2D | null = null;
function helper(): CanvasRenderingContext2D {
  if (!helperCtx) helperCtx = document.createElement("canvas").getContext("2d")!;
  return helperCtx;
}

const colorCache = new Map<string, { c: string; a: number }>();
/** Любой CSS-цвет → { #rrggbb, альфа } (svg2pdf надёжно понимает только их). */
function parseColor(v: unknown): { c: string; a: number } {
  if (typeof v !== "string") return { c: "#000000", a: 1 };
  const hit = colorCache.get(v);
  if (hit) return hit;
  const h = helper();
  h.fillStyle = "#000000";
  h.fillStyle = v;
  const norm = String(h.fillStyle);
  let res: { c: string; a: number };
  if (norm.startsWith("#")) res = { c: norm, a: 1 };
  else {
    const m = norm.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (m) {
      const hex = (x: string) => Math.round(+x).toString(16).padStart(2, "0");
      res = { c: `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`, a: m[4] != null ? +m[4] : 1 };
    } else res = { c: "#000000", a: 1 };
  }
  if (v === "transparent") res = { c: "#000000", a: 0 };
  colorCache.set(v, res);
  return res;
}

/** Разбор строки ctx.font: вес (ближайшее из 400/500/600/700), начертание, кегль (px). */
function parseFont(font: string): { size: number; weight: VectorFontWeight; italic: boolean } {
  const sizeM = font.match(/([\d.]+)px/);
  const size = sizeM ? parseFloat(sizeM[1]) : 10;
  const wM = font.match(/\b(bold|bolder|[1-9]00)\b/);
  let weight: VectorFontWeight = 400;
  if (wM) {
    const n = wM[1] === "bold" || wM[1] === "bolder" ? 700 : parseInt(wM[1], 10);
    weight = n >= 700 ? 700 : n >= 600 ? 600 : n >= 500 ? 500 : 400;
  }
  const italic = /\b(italic|oblique)\b/.test(font);
  return { size, weight, italic };
}

let measureFontPromise: Promise<void> | null = null;
/**
 * Загружает векторный шрифт (те же файлы, что встраиваются в PDF) в браузер
 * под служебным именем: measureText должен мерить ровно тем шрифтом, которым
 * текст будет набран в PDF, — иначе выравнивание и плашки подписей разойдутся.
 */
export function ensureVectorMeasureFont(urls: VectorFontUrls): Promise<void> {
  if (measureFontPromise) return measureFontPromise;
  if (typeof FontFace === "undefined" || !document.fonts) {
    measureFontPromise = Promise.resolve();
    return measureFontPromise;
  }
  const faces = ([400, 500, 600, 700] as const).map(w =>
    new FontFace(MEASURE_FONT_FAMILY, `url(${urls[w]})`, { weight: String(w) }));
  measureFontPromise = Promise.all(faces.map(ff => ff.load().then(l => { document.fonts.add(l); }).catch(() => {})))
    .then(() => {});
  return measureFontPromise;
}

export class SvgRecordingContext {
  readonly width: number;
  readonly height: number;
  /** Имитация ctx.canvas — некоторые рендеры читают размеры холста. */
  readonly canvas: { width: number; height: number };

  private parts: string[] = [];
  private defs: string[] = [];
  private idSeq = 0;
  private st: State;
  private stack: State[] = [];
  private path: string[] = [];
  private cur: { x: number; y: number } | null = null; // последняя точка (user space)
  private start: { x: number; y: number } | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = { width, height };
    this.st = {
      m: [1, 0, 0, 1, 0, 0],
      fillStyle: "#000000", strokeStyle: "#000000",
      lineWidth: 1, lineCap: "butt", lineJoin: "miter", miterLimit: 10,
      globalAlpha: 1,
      font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
      dash: [], lineDashOffset: 0, filter: "none",
      clipGroups: 0,
    };
  }

  // ── Свойства стиля ─────────────────────────────────────────────────────
  get fillStyle(): string { return this.st.fillStyle; }
  set fillStyle(v: string) { if (typeof v === "string") this.st.fillStyle = v; }
  get strokeStyle(): string { return this.st.strokeStyle; }
  set strokeStyle(v: string) { if (typeof v === "string") this.st.strokeStyle = v; }
  get lineWidth(): number { return this.st.lineWidth; }
  set lineWidth(v: number) { if (isFinite(v) && v > 0) this.st.lineWidth = v; }
  get lineCap(): CanvasLineCap { return this.st.lineCap; }
  set lineCap(v: CanvasLineCap) { this.st.lineCap = v; }
  get lineJoin(): CanvasLineJoin { return this.st.lineJoin; }
  set lineJoin(v: CanvasLineJoin) { this.st.lineJoin = v; }
  get miterLimit(): number { return this.st.miterLimit; }
  set miterLimit(v: number) { if (isFinite(v) && v > 0) this.st.miterLimit = v; }
  get globalAlpha(): number { return this.st.globalAlpha; }
  set globalAlpha(v: number) { if (isFinite(v) && v >= 0 && v <= 1) this.st.globalAlpha = v; }
  get font(): string { return this.st.font; }
  set font(v: string) { this.st.font = v; }
  get textAlign(): CanvasTextAlign { return this.st.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.st.textAlign = v; }
  get textBaseline(): CanvasTextBaseline { return this.st.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this.st.textBaseline = v; }
  get lineDashOffset(): number { return this.st.lineDashOffset; }
  set lineDashOffset(v: number) { this.st.lineDashOffset = v; }
  get filter(): string { return this.st.filter; }
  set filter(v: string) { this.st.filter = v; }
  // Не используются рендером схемы, но должны существовать.
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  imageSmoothingEnabled = true;
  shadowBlur = 0;
  shadowColor = "transparent";

  setLineDash(d: number[]): void { this.st.dash = (d ?? []).filter(x => isFinite(x) && x >= 0); }
  getLineDash(): number[] { return this.st.dash.slice(); }

  // ── Состояние и трансформации ──────────────────────────────────────────
  save(): void {
    this.stack.push(this.st);
    this.st = { ...this.st, m: [...this.st.m] as M, dash: this.st.dash.slice(), clipGroups: 0 };
  }
  restore(): void {
    const prev = this.stack.pop();
    if (!prev) return;
    for (let i = 0; i < this.st.clipGroups; i++) this.parts.push("</g>");
    this.st = prev;
  }
  translate(x: number, y: number): void { this.st.m = mul(this.st.m, [1, 0, 0, 1, x, y]); }
  scale(x: number, y: number): void { this.st.m = mul(this.st.m, [x, 0, 0, y, 0, 0]); }
  rotate(a: number): void {
    const c = Math.cos(a), s = Math.sin(a);
    this.st.m = mul(this.st.m, [c, s, -s, c, 0, 0]);
  }
  transform(a: number, b: number, c: number, d: number, e: number, f2: number): void {
    this.st.m = mul(this.st.m, [a, b, c, d, e, f2]);
  }
  setTransform(a?: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f2?: number): void {
    if (typeof a === "number") this.st.m = [a, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f2 ?? 0];
    else if (a && typeof a === "object") {
      this.st.m = [a.a ?? 1, a.b ?? 0, a.c ?? 0, a.d ?? 1, a.e ?? 0, a.f ?? 0];
    } else this.st.m = [1, 0, 0, 1, 0, 0];
  }
  resetTransform(): void { this.st.m = [1, 0, 0, 1, 0, 0]; }
  getTransform(): DOMMatrix {
    const [a, b, c, d, e, f2] = this.st.m;
    return new DOMMatrix([a, b, c, d, e, f2]);
  }

  private tp(x: number, y: number): [number, number] {
    const m = this.st.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  /** Средний масштаб текущей матрицы — для толщин линий и штрихов. */
  private scaleK(): number {
    const m = this.st.m;
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  }

  // ── Контур ─────────────────────────────────────────────────────────────
  beginPath(): void { this.path = []; this.cur = null; this.start = null; }
  moveTo(x: number, y: number): void {
    if (!isFinite(x) || !isFinite(y)) return;
    const [X, Y] = this.tp(x, y);
    this.path.push(`M${f(X)} ${f(Y)}`);
    this.cur = { x, y }; this.start = { x, y };
  }
  lineTo(x: number, y: number): void {
    if (!isFinite(x) || !isFinite(y)) return;
    if (!this.cur) { this.moveTo(x, y); return; }
    const [X, Y] = this.tp(x, y);
    this.path.push(`L${f(X)} ${f(Y)}`);
    this.cur = { x, y };
  }
  closePath(): void {
    if (this.path.length) this.path.push("Z");
    if (this.start) this.cur = { ...this.start };
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    if (!this.cur) this.moveTo(cx, cy);
    const [C1, C2] = this.tp(cx, cy);
    const [X, Y] = this.tp(x, y);
    this.path.push(`Q${f(C1)} ${f(C2)} ${f(X)} ${f(Y)}`);
    this.cur = { x, y };
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!this.cur) this.moveTo(c1x, c1y);
    const [A1, A2] = this.tp(c1x, c1y);
    const [B1, B2] = this.tp(c2x, c2y);
    const [X, Y] = this.tp(x, y);
    this.path.push(`C${f(A1)} ${f(A2)} ${f(B1)} ${f(B2)} ${f(X)} ${f(Y)}`);
    this.cur = { x, y };
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h);
    this.closePath();
  }
  roundRect(x: number, y: number, w: number, h: number, r?: number | number[]): void {
    const rr = Math.max(0, Math.min(Array.isArray(r) ? (r[0] ?? 0) : (r ?? 0), Math.abs(w) / 2, Math.abs(h) / 2));
    if (!rr) { this.rect(x, y, w, h); return; }
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
  }
  /** Дуга — кубическими Безье (≤ 90° на сегмент), точно при любой матрице. */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    if (!isFinite(cx) || !isFinite(cy) || !isFinite(r) || r < 0) return;
    const TAU = Math.PI * 2;
    let sweep = a1 - a0;
    if (!ccw) {
      if (sweep >= TAU) sweep = TAU;
      else { sweep = sweep % TAU; if (sweep < 0) sweep += TAU; if (sweep === 0 && a1 !== a0) sweep = TAU; }
    } else {
      if (-sweep >= TAU) sweep = -TAU;
      else { sweep = sweep % TAU; if (sweep > 0) sweep -= TAU; if (sweep === 0 && a1 !== a0) sweep = -TAU; }
    }
    const sx = cx + r * Math.cos(a0), sy = cy + r * Math.sin(a0);
    if (this.cur) this.lineTo(sx, sy); else this.moveTo(sx, sy);
    const segs = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const da = sweep / segs;
    const k = (4 / 3) * Math.tan(da / 4);
    let a = a0;
    for (let i = 0; i < segs; i++) {
      const b = a + da;
      const x0 = cx + r * Math.cos(a), y0 = cy + r * Math.sin(a);
      const x3 = cx + r * Math.cos(b), y3 = cy + r * Math.sin(b);
      const x1 = x0 - k * r * Math.sin(a), y1 = y0 + k * r * Math.cos(a);
      const x2 = x3 + k * r * Math.sin(b), y2 = y3 - k * r * Math.cos(b);
      this.bezierCurveTo(x1, y1, x2, y2, x3, y3);
      a = b;
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    const m0 = this.st.m;
    this.translate(cx, cy); this.rotate(rot); this.scale(rx || 1e-6, ry || 1e-6);
    this.arc(0, 0, 1, a0, a1, ccw);
    this.st.m = m0;
    // Конечная точка — обратно в исходное пространство координат.
    const ex = Math.cos(a1) * rx, ey = Math.sin(a1) * ry;
    const c = Math.cos(rot), s = Math.sin(rot);
    this.cur = { x: cx + ex * c - ey * s, y: cy + ex * s + ey * c };
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    if (!this.cur) { this.moveTo(x1, y1); return; }
    const x0 = this.cur.x, y0 = this.cur.y;
    const d1x = x0 - x1, d1y = y0 - y1, d2x = x2 - x1, d2y = y2 - y1;
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    if (r <= 0 || l1 < 1e-9 || l2 < 1e-9) { this.lineTo(x1, y1); return; }
    const cos = (d1x * d2x + d1y * d2y) / (l1 * l2);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (ang < 1e-6 || Math.abs(ang - Math.PI) < 1e-6) { this.lineTo(x1, y1); return; }
    const t = r / Math.tan(ang / 2);
    const u1x = d1x / l1, u1y = d1y / l1, u2x = d2x / l2, u2y = d2y / l2;
    const p1x = x1 + u1x * t, p1y = y1 + u1y * t;
    const p2x = x1 + u2x * t, p2y = y1 + u2y * t;
    const bx = u1x + u2x, by = u1y + u2y, bl = Math.hypot(bx, by) || 1;
    const dc = r / Math.sin(ang / 2);
    const ccx = x1 + (bx / bl) * dc, ccy = y1 + (by / bl) * dc;
    const s0 = Math.atan2(p1y - ccy, p1x - ccx), s1 = Math.atan2(p2y - ccy, p2x - ccx);
    const cross = d1x * d2y - d1y * d2x;
    this.lineTo(p1x, p1y);
    this.arc(ccx, ccy, r, s0, s1, cross < 0 ? false : true);
  }

  // ── Отрисовка ──────────────────────────────────────────────────────────
  private alphaAttr(name: "fill-opacity" | "stroke-opacity", colorA: number): string {
    const a = colorA * this.st.globalAlpha;
    return a < 0.999 ? ` ${name}="${Math.max(0, a).toFixed(3)}"` : "";
  }
  private strokeAttrs(): string {
    const col = parseColor(this.st.strokeStyle);
    const k = this.scaleK();
    let s = ` stroke="${col.c}" stroke-width="${f(this.st.lineWidth * k)}"`;
    if (this.st.lineCap !== "butt") s += ` stroke-linecap="${this.st.lineCap}"`;
    if (this.st.lineJoin !== "miter") s += ` stroke-linejoin="${this.st.lineJoin}"`;
    else s += ` stroke-miterlimit="${f(this.st.miterLimit)}"`;
    if (this.st.dash.length && this.st.dash.some(x => x > 0)) {
      const d = this.st.dash.length % 2 ? [...this.st.dash, ...this.st.dash] : this.st.dash;
      s += ` stroke-dasharray="${d.map(x => f(x * k)).join(" ")}"`;
      if (this.st.lineDashOffset) s += ` stroke-dashoffset="${f(this.st.lineDashOffset * k)}"`;
    }
    s += this.alphaAttr("stroke-opacity", col.a);
    return s;
  }
  private fillAttrs(rule?: CanvasFillRule): string {
    const col = parseColor(this.st.fillStyle);
    let s = ` fill="${col.c}"`;
    if (rule === "evenodd") s += ` fill-rule="evenodd"`;
    s += this.alphaAttr("fill-opacity", col.a);
    return s;
  }
  private pathD(): string { return this.path.filter(Boolean).join(""); }

  fill(a?: CanvasFillRule | Path2D, b?: CanvasFillRule): void {
    const rule = (typeof a === "string" ? a : b) as CanvasFillRule | undefined;
    const d = this.pathD();
    if (!d || parseColor(this.st.fillStyle).a * this.st.globalAlpha <= 0) return;
    this.parts.push(`<path d="${d}"${this.fillAttrs(rule)} stroke="none"/>`);
  }
  stroke(): void {
    const d = this.pathD();
    if (!d || parseColor(this.st.strokeStyle).a * this.st.globalAlpha <= 0) return;
    this.parts.push(`<path d="${d}" fill="none"${this.strokeAttrs()}/>`);
  }
  clip(a?: CanvasFillRule | Path2D, b?: CanvasFillRule): void {
    const rule = (typeof a === "string" ? a : b) as CanvasFillRule | undefined;
    const d = this.pathD();
    if (!d) return;
    const id = `cp${++this.idSeq}`;
    this.defs.push(`<clipPath id="${id}"><path d="${d}"${rule === "evenodd" ? ' clip-rule="evenodd"' : ""}/></clipPath>`);
    this.parts.push(`<g clip-path="url(#${id})">`);
    this.st.clipGroups++;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const saved = this.path, cur = this.cur, start = this.start;
    this.beginPath(); this.rect(x, y, w, h); this.fill();
    this.path = saved; this.cur = cur; this.start = start;
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    const saved = this.path, cur = this.cur, start = this.start;
    this.beginPath(); this.rect(x, y, w, h); this.stroke();
    this.path = saved; this.cur = cur; this.start = start;
  }
  /** Очистка = белая заливка (лист печати всегда белый). */
  clearRect(x: number, y: number, w: number, h: number): void {
    // Полная очистка в начале рендера — просто сбрасываем накопленное.
    if (x <= 0 && y <= 0 && w >= this.width && h >= this.height && this.stack.length === 0) {
      this.parts = [];
      return;
    }
    const fs = this.st.fillStyle, ga = this.st.globalAlpha;
    this.st.fillStyle = "#ffffff"; this.st.globalAlpha = 1;
    this.fillRect(x, y, w, h);
    this.st.fillStyle = fs; this.st.globalAlpha = ga;
  }

  // ── Текст ──────────────────────────────────────────────────────────────
  measureText(text: string): TextMetrics {
    const h = helper();
    const pf = parseFont(this.st.font);
    h.font = `${pf.italic ? "italic " : ""}${pf.weight} ${pf.size}px "${MEASURE_FONT_FAMILY}", sans-serif`;
    return h.measureText(text);
  }
  private putText(text: string, x: number, y: number, mode: "fill" | "stroke"): void {
    if (text == null || !isFinite(x) || !isFinite(y)) return;
    const str = String(text);
    if (!str.trim()) return;
    const pf = parseFont(this.st.font);
    if (pf.size <= 0) return;
    // Выравнивание делаем сами, по ширине, измеренной тем же шрифтом, что
    // попадёт в PDF: text-anchor конвертеры считают по своим метрикам.
    const al = this.st.textAlign;
    const tw = (al === "center" || al === "right" || al === "end") ? this.measureText(str).width : 0;
    if (al === "center") x -= tw / 2;
    else if (al === "right" || al === "end") x -= tw;
    const anchor = "start";
    // Базовая линия — явным сдвигом: dominant-baseline в PDF-конвертерах
    // поддерживается ненадёжно. Коэффициенты — по метрикам Golos Text.
    const dy = BASELINE_SHIFT[this.st.textBaseline] ?? 0;
    const [a, b, c, d, e, g] = this.st.m;
    const tr = (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && g === 0)
      ? "" : ` transform="matrix(${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(e)} ${f(g)})"`;
    let paint: string;
    if (mode === "fill") {
      const col = parseColor(this.st.fillStyle);
      if (col.a * this.st.globalAlpha <= 0) return;
      paint = ` fill="${col.c}"${this.alphaAttr("fill-opacity", col.a)}`;
    } else {
      const col = parseColor(this.st.strokeStyle);
      if (col.a * this.st.globalAlpha <= 0) return;
      paint = ` fill="none" stroke="${col.c}" stroke-width="${f(this.st.lineWidth)}" stroke-linejoin="round"${this.alphaAttr("stroke-opacity", col.a)}`;
    }
    this.parts.push(
      `<text x="${f(x)}" y="${f(y + dy * pf.size)}"${tr} font-family="${VECTOR_FONT_FAMILY}" font-size="${f(pf.size)}"`
      + `${pf.weight === 700 ? ' font-weight="bold"' : pf.weight !== 400 ? ` font-weight="${pf.weight}"` : ""}${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}`
      + ` xml:space="preserve"${paint}>${escXml(str)}</text>`,
    );
  }
  fillText(text: string, x: number, y: number): void { this.putText(text, x, y, "fill"); }
  strokeText(text: string, x: number, y: number): void { this.putText(text, x, y, "stroke"); }

  // ── Изображения ────────────────────────────────────────────────────────
  drawImage(img: CanvasImageSource, ...args: number[]): void {
    let dx: number, dy: number, dw: number, dh: number;
    const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLImageElement).width || 1;
    const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLImageElement).height || 1;
    if (args.length >= 8) { dx = args[4]; dy = args[5]; dw = args[6]; dh = args[7]; }
    else if (args.length >= 4) { [dx, dy, dw, dh] = args; }
    else { [dx, dy] = args; dw = iw; dh = ih; }
    if (![dx, dy, dw, dh].every(isFinite) || dw === 0 || dh === 0) return;
    const [a, b, c, d, e, g] = this.st.m;
    const tr = `matrix(${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(e)} ${f(g)})`;
    const op = this.st.globalAlpha < 0.999 ? ` opacity="${f(this.st.globalAlpha)}"` : "";

    // Иконка из SVG-разметки — вставляем вектором.
    const vec = vectorImageSources.get(img as object);
    if (vec) {
      this.parts.push(`<g transform="${tr}"${op}><svg x="${f(dx)}" y="${f(dy)}" width="${f(dw)}" height="${f(dh)}" viewBox="${vec.viewBox}" preserveAspectRatio="none" overflow="visible">${vec.svg}</svg></g>`);
      return;
    }
    // Прочие картинки (подложки-планы, иконки кранов) — растром, как есть.
    let href = "";
    const src = (img as HTMLImageElement).src;
    if (typeof src === "string" && src.startsWith("data:image/")) href = src;
    else {
      try {
        const k = Math.min(4, Math.max(1, 1024 / Math.max(iw, ih)));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(iw * k)); cv.height = Math.max(1, Math.round(ih * k));
        const cx = cv.getContext("2d");
        if (!cx) return;
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        href = cv.toDataURL("image/png");
      } catch { return; }
    }
    this.parts.push(`<image x="${f(dx)}" y="${f(dy)}" width="${f(dw)}" height="${f(dh)}" transform="${tr}"${op} preserveAspectRatio="none" href="${href}" xlink:href="${href}"/>`);
  }

  // ── Заглушки для неиспользуемых возможностей ──────────────────────────
  createLinearGradient(): CanvasGradient { return { addColorStop() {} } as unknown as CanvasGradient; }
  createRadialGradient(): CanvasGradient { return { addColorStop() {} } as unknown as CanvasGradient; }
  createPattern(): CanvasPattern | null { return null; }
  isPointInPath(): boolean { return false; }
  isPointInStroke(): boolean { return false; }
  getImageData(): ImageData { return new ImageData(1, 1); }
  putImageData(): void {}

  /** Вставка готовой SVG-разметки (рамка/штамп слоя печати) в координатах листа. */
  appendRawSvg(markup: string): void {
    const m = markup.match(/<svg[^>]*>([\s\S]*)<\/svg>\s*$/i);
    let body = m ? m[1] : markup;
    // Любой шрифт → встроенный Golos Text (иначе в PDF кириллица — «квадратики»).
    body = body.replace(/font-family="[^"]*"/g, `font-family="${VECTOR_FONT_FAMILY}"`);
    // Во встроенном шрифте есть только 400/500/600/700 — прочие веса приводим
    // к ближайшему, иначе svg2pdf не найдёт начертание и возьмёт Times.
    body = body.replace(/font-weight="([^"]*)"/g, (_m, v: string) => {
      const w = parseFont(`${v} 10px x`).weight;
      return w === 400 ? 'font-weight="normal"' : w === 700 ? 'font-weight="bold"' : `font-weight="${w}"`;
    });
    // dominant-baseline PDF-конвертер понимает не всегда — переводим в явный dy.
    body = body.replace(/<text\b[^>]*>/g, (tag) => {
      const bl = tag.match(/dominant-baseline="([^"]*)"/);
      if (!bl) return tag;
      // Сдвиги — как у Chromium для Golos Text: hanging 0,784; middle — середина
      // строчных (x-height 0,53 / 2); central — середина em-box (0,98−0,22)/2.
      const k = bl[1] === "hanging" ? 0.784 : bl[1] === "middle" ? 0.265
        : bl[1] === "central" ? 0.38 : (bl[1] === "text-before-edge" || bl[1] === "text-top") ? 0.98 : 0;
      const fs = parseFloat(tag.match(/font-size="([\d.]+)/)?.[1] ?? "12");
      let t = tag.replace(/\s*dominant-baseline="[^"]*"/, "");
      if (k && !/\sdy=/.test(t)) t = t.replace(/>$/, ` dy="${f(k * fs)}">`);
      return t;
    });
    this.parts.push(`<g>${body}</g>`);
  }

  /** Итоговый SVG-документ. */
  toSvg(title = "Схема"): string {
    // Закрываем незакрытые группы отсечения (на случай несбалансированных save/restore).
    const tail: string[] = [];
    let open = this.st.clipGroups;
    for (const s of this.stack) open += s.clipGroups;
    for (let i = 0; i < open; i++) tail.push("</g>");
    return `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
      + `width="${f(this.width)}" height="${f(this.height)}" viewBox="0 0 ${f(this.width)} ${f(this.height)}" font-family="${VECTOR_FONT_FAMILY}">`
      + `<title>${escXml(title)}</title>`
      + (this.defs.length ? `<defs>${this.defs.join("")}</defs>` : "")
      + `<rect x="0" y="0" width="${f(this.width)}" height="${f(this.height)}" fill="#ffffff"/>`
      + this.parts.join("") + tail.join("")
      + `</svg>`;
  }

  /** Приведение к типу контекста canvas для передачи в общие рендеры. */
  asContext(): CanvasRenderingContext2D { return this as unknown as CanvasRenderingContext2D; }
}

export function isSvgRecordingContext(ctx: unknown): ctx is SvgRecordingContext {
  return ctx instanceof SvgRecordingContext;
}