// ─────────────────────────────────────────────────────────────────────────────
// vgschBlast.ts — расчёт ударной воздушной волны (УВВ) при взрыве газа и пыли
// в горных выработках по «Методике определения параметров ударных воздушных
// волн при взрывах газов и пыли в горных выработках» (Приложение 12 к Уставу
// ВГСЧ, утв. Минтопэнерго РФ и Госгортехнадзором РФ 27.06.1997 № 175/107).
//
// СХЕМА МЕТОДИКИ — ТРИ ЗОНЫ ДЕЙСТВИЯ ВЗРЫВА:
//   1) зона загазования (объём V₀): давление постоянно, ΔP = 1,6 МПа;
//   2) зона разлёта продуктов взрыва (V₀ < V₂ ≤ 5V₀): волна подпирается
//      продуктами, ΔP = (12,3·V₀/V₂ + 0,5)·10⁵ Па (ф. 4 табл. 1). Потери на
//      трении и в сопряжениях здесь НЕ учитываются (раздел 4);
//   3) зона действия УВВ, оторвавшейся от продуктов взрыва: начальное давление
//      ΔPн по формуле (2) через коэффициент перехода μ (табл. 2), затухание
//      ΔPх = ΔPн·exp(−П·x·Кз/F) (ф. 3), Кз по табл. 3, местные сопротивления —
//      коэффициент затекания Кзат по табл. 5 (ф. 8).
//
// Безопасное для человека давление — 0,009 МПа (9 кПа), импульс — 40 000 Н·с/м².
// При участии угольной пыли энергия взрыва увеличивается в 1,3 раза.
// ─────────────────────────────────────────────────────────────────────────────

/** Плотность стехиометрической метановоздушной смеси, кг/м³. */
export const VGSCH_RHO0 = 1.13;
/** Удельная теплота взрыва стехиометрической метановоздушной смеси, Дж/кг. */
export const VGSCH_GV = 2.763e6;
/** Атмосферное давление в формуле (2), Па. */
export const VGSCH_P0 = 1e5;
/** Давление в зоне загазования (детонация), кПа. */
export const VGSCH_ZONE1_KPA = 1600;
/** Множитель энергии при участии угольной пыли. */
export const VGSCH_DUST_K = 1.3;
/** Объём продуктов взрыва — пять объёмов загазования. */
export const VGSCH_PV_FACTOR = 5;
/** Безопасное для человека давление во фронте УВВ, кПа. */
export const VGSCH_SAFE_KPA = 9;
/** Безопасный для человека импульс УВВ, Н·с/м². */
export const VGSCH_SAFE_IMPULSE = 40000;
/** Длина тупика, начиная с которой учитываются потери давления, м. */
export const VGSCH_DEADEND_M = 130;

/** Вид взрыва ГВС в шахте (табл. 2). */
export type CombustionMode = "detonation" | "deflagration" | "deflagration_dust" | "layered_dust";

export const COMBUSTION_MODES: { id: CombustionMode; label: string; mu: number; dust: boolean; tablePn: number }[] = [
  { id: "detonation",        label: "Детонация (экстремальный режим)",        mu: 0.50, dust: false, tablePn: 0.30 },
  { id: "deflagration",      label: "Дефлаграция без участия пыли",           mu: 0.15, dust: false, tablePn: 0.15 },
  { id: "deflagration_dust", label: "Дефлаграция с участием пыли",            mu: 0.25, dust: true,  tablePn: 0.21 },
  { id: "layered_dust",      label: "Слоевое скопление ГВС с участием пыли",  mu: 0.08, dust: true,  tablePn: 0.08 },
];

export function combustionMode(id: string | undefined) {
  // Если вид взрыва достоверно установить нельзя, методика требует считать
  // по максимальному начальному давлению — то есть по детонации.
  return COMBUSTION_MODES.find(m => m.id === id) ?? COMBUSTION_MODES[0];
}

/**
 * Коэффициент α по умолчанию (×10⁻⁴ Н·с²/м⁴) — «другие виды крепи»
 * (середина диапазона 78,4…196 табл. 3). Берётся, если у выработки α не задан.
 */
export const VGSCH_ALPHA_DEFAULT = 100;

/**
 * Коэффициент затухания Кз по табл. 3 — по коэффициенту аэродинамического
 * сопротивления A, ×10⁻⁴ Н·с²/м⁴.
 *
 * В программе α выработки хранится в тех же единицах ×10⁻⁴ Н·с²/м⁴
 * (см. topology.ts, aerodynamics.ts), поэтому A = α БЕЗ пересчёта.
 * Прежний множитель 9,81 переводил α в «ещё раз Ньютоны» — Кз завышался,
 * и волна гасла быстрее, чем по методике.
 */
export function kzFromAlpha(alpha: number | undefined): number {
  const a = alpha && alpha > 0 ? alpha : VGSCH_ALPHA_DEFAULT;
  if (a <= 39.2) return 0.5e-3;   // гладкая поверхность, металлические трубы
  if (a <= 78.4) return 1e-3;     // бетонная или кирпичная крепь
  if (a <= 196)  return 2e-3;     // другие виды крепи
  if (a <= 343)  return 3e-3;
  return 4e-3;                    // повышенная шероховатость, стволы с армировкой
}

/** Периметр выработки: заданный либо оценка для типового сечения (P ≈ 4√S). */
export function perimeterOf(area_m2: number, perimeter_m?: number): number {
  if (perimeter_m && perimeter_m > 0) return perimeter_m;
  return area_m2 > 0 ? 4 * Math.sqrt(area_m2) : 0;
}

/** Энергия взрыва Ен = ρ₀·gv·V₀ (ф. 1), Дж. */
export function explosionEnergyJ(V0_m3: number, energyRel = 1, dustFactor = 1): number {
  return VGSCH_RHO0 * VGSCH_GV * V0_m3 * energyRel * dustFactor;
}

/**
 * Начальное давление во фронте УВВ в месте отрыва от продуктов взрыва,
 * МПа — формула (2): ΔPн = 0,7 / (3·(√(1 + 7,12·P₀·V₂/(μ·Ен)) − 1)), V₂ = 5V₀.
 */
export function initialPressureMPa(En_J: number, V0_m3: number, mu: number): number {
  if (!(En_J > 0) || !(V0_m3 > 0) || !(mu > 0)) return 0;
  const V2 = VGSCH_PV_FACTOR * V0_m3;
  const root = Math.sqrt(1 + (7.12 * VGSCH_P0 * V2) / (mu * En_J));
  return 0.7 / (3 * (root - 1));
}

/** Давление по ф. (4) табл. 1 при детонации, кПа: (12,3·V₀/V₂ + 0,5)·10⁵ Па. */
function zone2DetonationKPa(V0: number, V2: number): number {
  return (12.3 * V0 / V2 + 0.5) * 100;
}

/** Параметры источника по методике ВГСЧ — всё, что нужно для расчёта волны. */
export interface VgschSource {
  /** Длина загазованного участка, м. */
  zoneLength_m: number;
  /** Объём загазования V₀, м³. */
  V0_m3: number;
  /** Вид взрыва (табл. 2) и коэффициент перехода μ. */
  mode: CombustionMode;
  mu: number;
  /** Энергия взрыва Ен, МДж. */
  En_MJ: number;
  /** Множитель на пыль (1 или 1,3). */
  dustFactor: number;
  /** Давление в зоне загазования, кПа. */
  dPz_kPa: number;
  /** Начальное давление УВВ в месте отрыва от продуктов взрыва ΔPн, кПа. */
  dPn_kPa: number;
  /** Масштаб зон 1–2 под вид взрыва: ΔPн / ΔP(ф.4 при V₂=5V₀). */
  k: number;
  /** Объём продуктов взрыва, приходящийся на одно направление (2V₀), м³. */
  pvVolumePerSide_m3: number;
  /** Эффективное время действия УВВ θ, с (оценка, см. vgschPhaseDuration). */
  phase_s: number;
  /** Геометрия выработки-очага — для расчёта по прямой выработке. */
  area_m2: number;
  perimeter_m: number;
  kz: number;
}

/**
 * Эффективное время действия УВВ, с.
 *
 * Формулы (3) и (6) табл. 1 содержат функцию φ(V₀/V₂), которая в доступной
 * редакции методики не приводится. Поэтому время действия оценивается как
 * время разгрузки загазованного участка: полудлина участка, делённая на
 * скорость звука в продуктах взрыва (~680 м/с). Импульс затем считается
 * по правилу методики: i = ΔP·θ/2.
 */
export function vgschPhaseDuration(zoneLength_m: number): number {
  return Math.max(zoneLength_m / 2, 0.5) / 680;
}

export function makeVgschSource(p: {
  zoneLength_m: number;
  V0_m3: number;
  mode: CombustionMode;
  energyRel: number;
  dust: boolean;
  area_m2: number;
  perimeter_m?: number;
  alpha?: number;
}): VgschSource {
  // Пыль у детонации НЕ учитывается: детонация — предельный режим, её ΔPн
  // (0,30 МПа) в табл. 2 от пыли не зависит. У дефлаграции участие пыли —
  // это отдельная строка табл. 2 («с участием пыли», μ = 0,25).
  let m = combustionMode(p.mode);
  if (p.dust && m.id === "deflagration") m = combustionMode("deflagration_dust");
  const dustFactor = m.dust ? VGSCH_DUST_K : 1;
  const En = explosionEnergyJ(p.V0_m3, p.energyRel, dustFactor);
  // ΔPн — ПО ТАБЛ. 2 (как в примере методики). Формула (2) при V₂ = 5V₀ даёт
  // для дефлаграции 0,121 вместо табличных 0,15 МПа, поэтому берётся таблица.
  // Для смеси, отличной от стехиометрической метановоздушной, табличное
  // значение пересчитывается по ф. (2) пропорционально энергии.
  const enRef = explosionEnergyJ(p.V0_m3, 1, dustFactor);
  const byFormula = initialPressureMPa(En, p.V0_m3, m.mu);
  const byFormulaRef = initialPressureMPa(enRef, p.V0_m3, m.mu);
  const rel = byFormulaRef > 0 ? byFormula / byFormulaRef : 1;
  const dPn_kPa = m.tablePn * 1000 * rel;
  // Зона загазования: 1,6 МПа при детонации (табл. 1). Для других видов
  // взрыва методика давления не даёт — пересчёт пропорционально ΔPн.
  const dPz_kPa = VGSCH_ZONE1_KPA * dPn_kPa / (COMBUSTION_MODES[0].tablePn * 1000);
  // Зона продуктов взрыва: ф. (4) масштабируется так, чтобы в точке отрыва
  // (V₂ = 5V₀) давление равнялось ΔPн — без скачка на границе зон.
  const refPn = zone2DetonationKPa(1, VGSCH_PV_FACTOR);
  const k = dPn_kPa > 0 ? dPn_kPa / refPn : 0;
  return {
    zoneLength_m: p.zoneLength_m,
    V0_m3: p.V0_m3,
    mode: m.id,
    mu: m.mu,
    En_MJ: En / 1e6,
    dustFactor,
    dPz_kPa,
    dPn_kPa,
    k,
    pvVolumePerSide_m3: ((VGSCH_PV_FACTOR - 1) / 2) * p.V0_m3,
    phase_s: vgschPhaseDuration(p.zoneLength_m),
    area_m2: p.area_m2,
    perimeter_m: perimeterOf(p.area_m2, p.perimeter_m),
    kz: kzFromAlpha(p.alpha),
  };
}

/**
 * Давление в зоне продуктов взрыва, кПа, по объёму выработок vs, который
 * продукты уже заполнили в данном направлении (после зоны загазования).
 * Полный объём продуктов V₂ = V₀ + 2·vs (продукты расходятся в обе стороны).
 */
export function vgschZone2KPa(src: VgschSource, vs: number): number {
  const V2 = src.V0_m3 + 2 * Math.max(vs, 0);
  return zone2DetonationKPa(src.V0_m3, V2) * src.k;
}

/**
 * Давление в зоне продуктов взрыва по ОБЩЕМУ объёму продуктов V₂, м³ (ф. 4).
 * V₂ — суммарный объём, занятый продуктами во всех направлениях, поэтому
 * деление потока на развилках на давление не влияет.
 */
export function vgschZone2KPaByV2(src: VgschSource, V2: number): number {
  return zone2DetonationKPa(src.V0_m3, Math.max(V2, src.V0_m3)) * src.k;
}

/** Давление на расстоянии L от центра очага по ПРЯМОЙ выработке-очагу, кПа. */
export function vgschPressureAt(L_m: number, src: VgschSource): number {
  const half = src.zoneLength_m / 2;
  const L = Math.max(L_m, 0);
  if (L <= half) return round1(src.dPz_kPa);
  const S = src.area_m2 > 0 ? src.area_m2 : 1;
  const vs = (L - half) * S;
  if (vs < src.pvVolumePerSide_m3) return round1(vgschZone2KPa(src, vs));
  const x = (vs - src.pvVolumePerSide_m3) / S;
  return round1(src.dPn_kPa * Math.exp(-src.kz * src.perimeter_m * x / S));
}

/** Импульс УВВ по правилу методики i = ΔP·θ/2, Н·с/м² (= Па·с). */
export function vgschImpulseAt(L_m: number, src: VgschSource): number {
  return round1(vgschPressureAt(L_m, src) * 1000 * src.phase_s / 2);
}

/** Длина пути от центра очага, на которой давление падает до p, м. */
export function vgschDistanceAtPressure(p_kPa: number, src: VgschSource): number {
  if (!(p_kPa > 0) || !(src.dPz_kPa > 0)) return 0;
  const half = src.zoneLength_m / 2;
  const S = src.area_m2 > 0 ? src.area_m2 : 1;
  if (p_kPa > src.dPz_kPa) return 0;
  // Зона продуктов взрыва: решаем ф. (4) относительно V₂
  const pStart = vgschZone2KPa(src, 0);
  if (p_kPa >= pStart) return Math.round(half);
  if (p_kPa >= src.dPn_kPa) {
    const r = p_kPa / (100 * src.k) - 0.5;
    const V2 = r > 0 ? 12.3 * src.V0_m3 / r : VGSCH_PV_FACTOR * src.V0_m3;
    const vs = Math.min((V2 - src.V0_m3) / 2, src.pvVolumePerSide_m3);
    return Math.round(half + vs / S);
  }
  // Зона затухания УВВ по ф. (3)
  const n = src.kz * src.perimeter_m / S;
  const x = n > 0 ? Math.log(src.dPn_kPa / p_kPa) / n : 0;
  return Math.round(half + src.pvVolumePerSide_m3 / S + x);
}

// ─── Местные сопротивления: коэффициент затекания Кзат (табл. 5) ─────────────
// Строки — δ = S/F (сечение выработки, куда затекает волна, к сечению, откуда
// вытекает); столбцы — давление ΔPн перед сопротивлением, МПа.
const KZAT_DELTA = [0.2, 0.4, 0.6, 0.8, 1.0, 1.25, 1.67, 2.5, 5.0];
const KZAT_DP = [0.3, 0.2, 0.1, 0.05];

/** п. 2 табл. 5 — проход прямо с изменением сечения. */
const KZAT_STRAIGHT = [
  [1.24, 1.30, 1.42, 1.51], [1.17, 1.22, 1.30, 1.42], [1.12, 1.14, 1.18, 1.22],
  [1.06, 1.07, 1.08, 1.10], [1.00, 1.00, 1.00, 1.00], [0.88, 0.88, 0.88, 0.91],
  [0.70, 0.70, 0.71, 0.79], [0.52, 0.52, 0.52, 0.60], [0.30, 0.30, 0.30, 0.37],
];
/** п. 3 табл. 5 — затекание в ответвление, угол ответвления 0° < γ ≤ 60°. */
const KZAT_BRANCH_60 = [
  [0.690, 0.710, 0.740, 0.800], [0.620, 0.635, 0.670, 0.740], [0.543, 0.565, 0.590, 0.640],
  [0.473, 0.505, 0.520, 0.540], [0.400, 0.420, 0.450, 0.460], [0.350, 0.365, 0.400, 0.420],
  [0.280, 0.295, 0.350, 0.360], [0.207, 0.220, 0.230, 0.280], [0.120, 0.125, 0.140, 0.170],
];
/** п. 4 табл. 5 — затекание в ответвление, 60° < γ < 120°. */
const KZAT_BRANCH_120 = [
  [0.460, 0.520, 0.610, 0.720], [0.430, 0.470, 0.560, 0.670], [0.400, 0.430, 0.510, 0.590],
  [0.340, 0.380, 0.450, 0.520], [0.300, 0.330, 0.400, 0.450], [0.263, 0.290, 0.350, 0.410],
  [0.210, 0.230, 0.280, 0.360], [0.157, 0.172, 0.210, 0.270], [0.090, 0.100, 0.120, 0.170],
];
/** п. 5 табл. 5 — затекание в ответвление, 120° ≤ γ < 180°. */
const KZAT_BRANCH_180 = [
  [0.367, 0.445, 0.550, 0.640], [0.340, 0.410, 0.500, 0.580], [0.310, 0.375, 0.460, 0.540],
  [0.280, 0.335, 0.420, 0.480], [0.250, 0.300, 0.370, 0.420], [0.220, 0.215, 0.280, 0.340],
  [0.177, 0.185, 0.220, 0.260], [0.130, 0.155, 0.150, 0.220], [0.077, 0.110, 0.140, 0.160],
];
/** п. 6–8 табл. 5 — проход прямо через сопряжение; γ — угол ответвления.
 *  От давления не зависят, поэтому хранятся одним столбцом по δ. */
const KZAT_THROUGH_60  = [0.940, 0.880, 0.820, 0.760, 0.730, 0.620, 0.510, 0.380, 0.210];
const KZAT_THROUGH_120 = [0.960, 0.920, 0.870, 0.830, 0.800, 0.700, 0.560, 0.420, 0.240];
const KZAT_THROUGH_180 = [0.970, 0.940, 0.910, 0.870, 0.835, 0.730, 0.590, 0.430, 0.250];
const col4 = (v: number[]) => v.map(x => [x, x, x, x]);
/** п. 13 табл. 5 — угол поворота выработки. */
const KZAT_TURN = [
  [0.860, 0.910, 1.030, 1.100], [0.810, 0.860, 0.940, 1.020], [0.780, 0.810, 0.860, 0.910],
  [0.740, 0.760, 0.780, 0.820], [0.700, 0.710, 0.730, 0.750], [0.610, 0.620, 0.640, 0.680],
  [0.490, 0.497, 0.520, 0.590], [0.360, 0.370, 0.360, 0.450], [0.200, 0.210, 0.220, 0.270],
];

/**
 * Вид местного сопротивления:
 *   straight — проход прямо без сопряжения, изменение сечения (п. 2);
 *   through  — проход прямо через сопряжение (п. 6–8, по углу ответвления);
 *   branch   — затекание в ответвление (п. 3–5, по углу ответвления);
 *   turn     — поворот выработки без сопряжения (п. 13).
 */
export type LocalResistance = "straight" | "through" | "branch" | "turn";

export const LOCAL_RESISTANCE_LABEL: Record<LocalResistance, string> = {
  straight: "проход прямо (табл. 5 п. 2)",
  through: "проход прямо через сопряжение (табл. 5 п. 6–8)",
  branch: "ответвление сопряжения (табл. 5 п. 3–5)",
  turn: "поворот выработки (табл. 5 п. 13)",
};

/** Угол, начиная с которого направление считается поворотом, °. */
export const TURN_ANGLE_DEG = 30;

function interpIdx(arr: number[], v: number, descending = false): [number, number, number] {
  const a = descending ? arr.map(x => -x) : arr;
  const x = descending ? -v : v;
  if (x <= a[0]) return [0, 0, 0];
  if (x >= a[a.length - 1]) return [a.length - 1, a.length - 1, 0];
  for (let i = 0; i < a.length - 1; i++) {
    if (x <= a[i + 1]) return [i, i + 1, (x - a[i]) / (a[i + 1] - a[i])];
  }
  return [a.length - 1, a.length - 1, 0];
}

function kzatTable(kind: LocalResistance, gamma_deg: number): number[][] {
  const g = gamma_deg;
  switch (kind) {
    case "branch":  return g <= 60 ? KZAT_BRANCH_60 : g < 120 ? KZAT_BRANCH_120 : KZAT_BRANCH_180;
    case "through": return col4(g <= 60 ? KZAT_THROUGH_60 : g < 120 ? KZAT_THROUGH_120 : KZAT_THROUGH_180);
    case "turn":    return KZAT_TURN;
    default:        return KZAT_STRAIGHT;
  }
}

/**
 * Коэффициент затекания Кзат (билинейная интерполяция по табл. 5).
 * gamma_deg — угол ответвления (отклонение от направления прихода волны):
 * для «branch» — угол самого ответвления, для «through» — угол боковой ветви.
 */
export function kzat(kind: LocalResistance, delta: number, dP_MPa: number, gamma_deg = 90): number {
  const tbl = kzatTable(kind, gamma_deg);
  const [r0, r1, tr] = interpIdx(KZAT_DELTA, delta > 0 ? delta : 1);
  const [c0, c1, tc] = interpIdx(KZAT_DP, dP_MPa, true);
  const v0 = tbl[r0][c0] + (tbl[r0][c1] - tbl[r0][c0]) * tc;
  const v1 = tbl[r1][c0] + (tbl[r1][c1] - tbl[r1][c0]) * tc;
  return v0 + (v1 - v0) * tr;
}

/**
 * Вид местного сопротивления для одного исходящего направления узла.
 * isStraight — это направление является продолжением входящей выработки
 * (наименьшее отклонение и не больше TURN_ANGLE_DEG).
 */
export function localResistanceKind(deflection_deg: number, outCount: number, isStraight = deflection_deg <= TURN_ANGLE_DEG): LocalResistance {
  if (outCount <= 1) return deflection_deg <= TURN_ANGLE_DEG ? "straight" : "turn";
  return isStraight ? "through" : "branch";
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}