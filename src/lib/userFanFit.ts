// ─────────────────────────────────────────────────────────────────────────────
// userFanFit.ts — построение характеристики пользовательского вентилятора
// по паспортным точкам.
//
// Пользователь вводит для каждого угла лопаток несколько точек (Q, H и, по
// желанию, КПД) — как снимает их с паспортного графика. Программа считает
// параболу методом наименьших квадратов:
//     H(Q) = h0 + h1·Q + h2·Q²,   η(Q) = e0 + e1·Q + e2·Q²
// Именно в таком виде характеристика понятна расчёту сети (сервер решает сеть
// по коэффициентам h0/h1/h2 и паспортной зоне qMin…qMax).
// ─────────────────────────────────────────────────────────────────────────────

import {
  USER_FAN_PREFIX, type FanAngleCurve, type FanCurve, type UserFanPoint, type UserFanSource,
} from "@/lib/fanCurves";

/** Парабола y = a + b·x + c·x² по точкам (МНК). Для 2 точек — прямая. */
export function fitQuadratic(pts: { x: number; y: number }[]): { a: number; b: number; c: number } | null {
  const p = pts.filter(t => Number.isFinite(t.x) && Number.isFinite(t.y));
  if (p.length === 0) return null;
  if (p.length === 1) return { a: p[0].y, b: 0, c: 0 };
  if (p.length === 2) {
    const [u, v] = p;
    if (u.x === v.x) return { a: (u.y + v.y) / 2, b: 0, c: 0 };
    const b = (v.y - u.y) / (v.x - u.x);
    return { a: u.y - b * u.x, b, c: 0 };
  }
  // Центрируем x — иначе при Q ~ сотни м³/с система плохо обусловлена
  const mx = p.reduce((s, t) => s + t.x, 0) / p.length;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (const t of p) {
    const x = t.x - mx, x2 = x * x;
    s0 += 1; s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
    t0 += t.y; t1 += t.y * x; t2 += t.y * x2;
  }
  const M = [[s0, s1, s2, t0], [s1, s2, s3, t1], [s2, s3, s4, t2]];
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    [M[i], M[piv]] = [M[piv], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return fitQuadratic([p[0], p[p.length - 1]]);
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let k = i; k < 4; k++) M[r][k] -= f * M[i][k];
    }
  }
  const A = M[0][3] / M[0][0], B = M[1][3] / M[1][1], C = M[2][3] / M[2][2];
  // Обратно к нецентрированному x: y = A + B(x−m) + C(x−m)²
  return { a: A - B * mx + C * mx * mx, b: B - 2 * C * mx, c: C };
}

/** Подходящая η(Q), если КПД не введён: пик ~0,8 в середине зоны. */
function defaultEta(qMin: number, qMax: number) {
  const qm = (qMin + qMax) / 2, w = Math.max(1e-6, (qMax - qMin) / 2);
  // η = 0.8 − 0.35·((Q−qm)/w)²
  const c = -0.35 / (w * w);
  return { e0: 0.8 + c * qm * qm, e1: -2 * c * qm, e2: c };
}

export interface FitResult {
  curve: FanAngleCurve;
  /** Наибольшее отклонение кривой от введённых точек, % */
  maxErrPct: number;
}

/** Характеристика одного угла по введённым точкам. */
export function fitAngleCurve(angle: number, points: UserFanPoint[]): FitResult | null {
  const pts = points.filter(p => p.q >= 0 && p.h >= 0 && Number.isFinite(p.q) && Number.isFinite(p.h));
  if (pts.length < 2) return null;
  const h = fitQuadratic(pts.map(p => ({ x: p.q, y: p.h })));
  if (!h) return null;
  const qMin = Math.min(...pts.map(p => p.q));
  const qMax = Math.max(...pts.map(p => p.q));
  const etaPts = pts.filter(p => p.eta !== undefined && p.eta > 0).map(p => ({ x: p.q, y: p.eta! > 1 ? p.eta! / 100 : p.eta! }));
  const e = etaPts.length >= 2 ? fitQuadratic(etaPts) : null;
  const eta = e ? { e0: e.a, e1: e.b, e2: e.c } : etaPts.length === 1
    ? { e0: etaPts[0].y, e1: 0, e2: 0 } : defaultEta(qMin, qMax);
  let maxErrPct = 0;
  for (const p of pts) {
    const hf = h.a + h.b * p.q + h.c * p.q * p.q;
    if (p.h > 1) maxErrPct = Math.max(maxErrPct, Math.abs(hf - p.h) / p.h * 100);
  }
  return {
    curve: { angle, h0: h.a, h1: h.b, h2: h.c, ...eta, qMin, qMax },
    maxErrPct,
  };
}

export interface UserFanDraft {
  id?: string;
  name: string;
  type: FanCurve["type"];
  diameter: number;
  rpmMin: number;
  rpmMax: number;
  rpmNominal: number;
  source: UserFanSource;
  reverseEfficiencyFactor?: number;
}

/**
 * Готовая модель вентилятора (FanCurve) по черновику из формы.
 * Общие h0…qMax заполняются по среднему углу — их используют места
 * программы, не знающие про угол (подбор, сводки).
 */
export function buildUserFanCurve(d: UserFanDraft): { curve: FanCurve | null; errors: string[] } {
  const errors: string[] = [];
  if (!d.name.trim()) errors.push("Укажите название вентилятора");
  if (!(d.rpmNominal > 0)) errors.push("Укажите номинальные обороты");
  const fits = d.source.angles.map(a => ({ a, f: fitAngleCurve(a.angle, a.points) }));
  fits.forEach(({ a, f }) => { if (!f) errors.push(`Угол ${a.angle}°: нужно минимум 2 точки (Q, H)`); });
  const angleSet = new Set(d.source.angles.map(a => a.angle));
  if (angleSet.size !== d.source.angles.length) errors.push("Углы лопаток не должны повторяться");
  if (d.source.angles.length === 0) errors.push("Добавьте хотя бы одну характеристику");
  if (errors.length) return { curve: null, errors };

  const angleCurves = fits.map(x => x.f!.curve).sort((a, b) => a.angle - b.angle);
  const mid = angleCurves[Math.floor((angleCurves.length - 1) / 2)];
  const hasAngles = angleCurves.length > 1;
  const qNominal = (mid.qMin + mid.qMax) / 2;

  const curve: FanCurve = {
    id: d.id || `${USER_FAN_PREFIX}${Date.now().toString(36)}`,
    name: d.name.trim(),
    type: d.type,
    diameter: d.diameter,
    h0: mid.h0, h1: mid.h1, h2: mid.h2,
    e0: mid.e0, e1: mid.e1, e2: mid.e2,
    qMin: mid.qMin, qMax: mid.qMax,
    qNominal: Math.round(qNominal * 10) / 10,
    hNominal: Math.round(mid.h0 + mid.h1 * qNominal + mid.h2 * qNominal * qNominal),
    rpmMin: d.rpmMin, rpmMax: Math.max(d.rpmMax, d.rpmNominal), rpmNominal: d.rpmNominal,
    bladeAngles: hasAngles ? angleCurves.map(a => a.angle) : [],
    angleCurves,
    isUser: true,
    source: d.source,
  };

  const rev = d.source.reverse?.points ?? [];
  if (rev.length >= 2) {
    const rf = fitAngleCurve(0, rev);
    if (rf) {
      curve.reverseH0 = rf.curve.h0;
      curve.reverseH1 = rf.curve.h1;
      curve.reverseH2 = rf.curve.h2;
      curve.reverseQMin = rf.curve.qMin;
      curve.reverseQMax = rf.curve.qMax;
      curve.reverseEfficiencyFactor = d.reverseEfficiencyFactor ?? 0.82;
    }
  } else if (rev.length === 1) {
    errors.push("Реверс: нужно минимум 2 точки или ни одной");
    return { curve: null, errors };
  }
  return { curve, errors };
}
