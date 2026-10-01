// ─────────────────────────────────────────────────────────────────────────────
// fanChartData.ts — точки характеристик вентилятора для графиков справочника,
// увеличенного просмотра и выгрузки рабочей точки в Excel.
//
// Напор считается ТОЙ ЖЕ функцией, что и расчёт сети (fanHAngle), чтобы
// картинка совпадала с рабочей точкой из расчёта.
// ─────────────────────────────────────────────────────────────────────────────

import { fanCurveAtAngle, fanEfficiencyAngle, fanHAngle, fanQMax, type FanCurve } from "@/lib/fanCurves";

export interface FanPt { q: number; h: number; p: number }
export interface FanIsoLine { level: number; label: string; pts: { q: number; h: number }[] }

const rpmK = (c: FanCurve, rpm?: number) =>
  rpm && rpm > 0 && c.rpmNominal > 0 ? rpm / c.rpmNominal : 1;

/** Кривая Q-H (и мощность) для угла лопаток и оборотов. */
export function fanCurvePoints(c: FanCurve, angle?: number, n = 40, rpm?: number): FanPt[] {
  const pts: FanPt[] = [];
  const k = rpmK(c, rpm);
  const qMaxA = fanQMax(c, angle, rpm);
  const ac = fanCurveAtAngle(c, angle);
  // Каталожная кривая начинается с общего qMin (как раньше), своя — со своего
  const qMinBase = c.angleCurves?.length ? ac.qMin : c.qMin;
  const qMinA = Math.min(qMinBase * k, qMaxA * 0.9);
  for (let i = 0; i <= n; i++) {
    const q = qMinA + (qMaxA - qMinA) * (i / n);
    const h = fanHAngle(c, q, angle, rpm);
    // Мощность — тем же КПД, что считает расчёт сети после решения
    const eta = fanEfficiencyAngle(c, q / k, angle);
    const p = eta > 0 ? (h * q) / eta / 1000 : 0;
    pts.push({ q: +q.toFixed(2), h: +h.toFixed(0), p: +Math.max(0, p).toFixed(1) });
  }
  return pts;
}

/** Реверсивная кривая Q-H (если есть в каталоге). */
export function reverseCurvePoints(c: FanCurve, n = 40, rpm?: number): FanPt[] {
  if (c.reverseH0 === undefined) return [];
  const pts: FanPt[] = [];
  const k = rpmK(c, rpm);
  const qMin = c.reverseQMin ?? c.qMin;
  const qMax = c.reverseQMax ?? c.qMax;
  for (let i = 0; i <= n; i++) {
    const qn = qMin + (qMax - qMin) * (i / n);
    const hn = Math.max(0, c.reverseH0! + (c.reverseH1 ?? 0) * qn + (c.reverseH2 ?? 0) * qn * qn);
    const eta = Math.min(0.85, Math.max(0.05, c.e0 + c.e1 * qn + c.e2 * qn * qn)) * (c.reverseEfficiencyFactor ?? 0.82);
    const q = qn * k, h = hn * k * k;
    const p = eta > 0 ? (h * q) / eta / 1000 : 0;
    pts.push({ q: +q.toFixed(2), h: +h.toFixed(0), p: +Math.max(0, p).toFixed(1) });
  }
  return pts;
}

/**
 * КПД на кривой угла. Каталожный — по закону подобия η(Q / (af·k)),
 * пользовательский — по кривой КПД своего угла η(Q / k).
 */
function etaAt(c: FanCurve, q: number, angle: number | undefined, rpm?: number): number {
  if (c.angleCurves?.length) return fanEfficiencyAngle(c, q / rpmK(c, rpm), angle);
  const ac = fanCurveAtAngle(c, angle);
  const af = c.qMax > 0 ? ac.qMax / c.qMax : 1;
  const x = q / (af * rpmK(c, rpm));
  return Math.min(0.85, Math.max(0.05, c.e0 + c.e1 * x + c.e2 * x * x));
}

/**
 * Линии равного КПД (как на паспортной характеристике): на каждой кривой угла
 * ищутся расходы, где η = уровень, и точки соединяются — слева по возрастанию
 * угла, справа по убыванию (получается «петля»). Нужны ≥ 2 кривых.
 */
export function fanEfficiencyIsolines(c: FanCurve, angles: number[], rpm?: number, count = 5): FanIsoLine[] {
  const sorted = [...new Set(angles)].sort((a, b) => a - b);
  if (sorted.length < 2) return [];

  // Пик КПД по всем кривым
  let etaMax = 0;
  for (const a of sorted) {
    for (const p of fanCurvePoints(c, a, 60, rpm)) etaMax = Math.max(etaMax, etaAt(c, p.q, a, rpm));
  }
  let top = Math.floor(etaMax * 100 / 5) * 5;
  if (top >= etaMax * 100 - 0.5) top -= 5;
  const levels: number[] = [];
  for (let l = top; l >= 10 && levels.length < count; l -= 5) levels.push(l);

  const lines: FanIsoLine[] = [];
  for (const lvl of levels.reverse()) {
    const target = lvl / 100;
    const left: { q: number; h: number }[] = [];
    const right: { q: number; h: number }[] = [];
    for (const a of sorted) {
      const pts = fanCurvePoints(c, a, 120, rpm);
      const crossings: number[] = [];
      for (let i = 1; i < pts.length; i++) {
        const e1 = etaAt(c, pts[i - 1].q, a, rpm) - target;
        const e2 = etaAt(c, pts[i].q, a, rpm) - target;
        if (e1 === 0 || e1 * e2 < 0) {
          const t = e1 === e2 ? 0 : e1 / (e1 - e2);
          crossings.push(pts[i - 1].q + (pts[i].q - pts[i - 1].q) * t);
        }
      }
      if (crossings.length === 0) continue;
      const qL = crossings[0];
      left.push({ q: +qL.toFixed(2), h: +fanHAngle(c, qL, a, rpm).toFixed(1) });
      if (crossings.length > 1) {
        const qR = crossings[crossings.length - 1];
        right.push({ q: +qR.toFixed(2), h: +fanHAngle(c, qR, a, rpm).toFixed(1) });
      }
    }
    const pts = [...left, ...right.reverse()];
    if (pts.length >= 2) lines.push({ level: lvl, label: `${lvl}%`, pts });
  }
  return lines;
}

export const angleLabel = (a: number) => `${a > 0 ? "+" : ""}${a}°`;

// ─── Общие правила для графиков справочника и панели свойств ветви ─────────
// Один источник цветов и рабочей точки — иначе график в справочнике и график
// в левой панели показывали бы одну и ту же точку по-разному.

export const FAN_CURVE_COLORS = ["#e91e63", "#ff5722", "#ff9800", "#4caf50", "#2196f3", "#9c27b0", "#00bcd4"];
export const FAN_REVERSE_COLOR = "#9c27b0";
export const FAN_OP_COLOR = "#e11d48";
export const FAN_NETWORK_COLOR = "#e8a317";

/** Цвет кривой угла лопаток — по его месту в паспортном списке углов. */
export function fanAngleColor(c: FanCurve, angle: number): string {
  const i = c.bladeAngles.indexOf(angle);
  return FAN_CURVE_COLORS[(i < 0 ? 0 : i) % FAN_CURVE_COLORS.length];
}

/** Рабочая точка вентилятора ветви по результату расчёта сети. */
export interface BranchFanOp {
  /** Расход через ОДИН вентилятор (при параллельной работе делится), м³/с */
  q: number;
  /** Напор, Па */
  h: number;
  reverse: boolean;
  /** Сопротивление сети, приведённое к одному вентилятору: H = R·Q² */
  r: number;
}

export function branchFanOperatingPoint(b: {
  flow?: number; fanPressure?: number; fanParallel?: number; fanReverse?: boolean;
  fanStopped?: boolean; fanType?: string;
}): BranchFanOp | null {
  const flow = Math.abs(b.flow ?? 0);
  if (b.fanStopped || flow <= 0.01) return null;
  const q = flow / Math.max(1, b.fanParallel ?? 1);
  const h = Math.abs(b.fanPressure ?? 0);
  return { q, h, reverse: !!b.fanReverse && b.fanType !== "ВМП", r: q > 0 ? h / (q * q) : 0 };
}
