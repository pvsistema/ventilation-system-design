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
 * Коэффициент α по умолчанию (×10⁻⁴ кгс·с²/м⁴) — «другие виды крепи».
 * Берётся, если у выработки α не задан.
 */
export const VGSCH_ALPHA_DEFAULT = 15;

/**
 * Коэффициент затухания Кз по табл. 3 — по коэффициенту аэродинамического
 * сопротивления A, ×10⁻⁴ Н·с²/м⁴.
 *
 * В программе α хранится в РУДНИЧНЫХ единицах ×10⁻⁴ кгс·с²/м⁴ — тех же, что
 * дают сопротивление в кМюрг (R = α·P·L/S³, см. aerodynamics.ts). Поэтому
 * A = α·9,81. Границы таблицы 9,8…490 соответствуют ровно α = 1…50.
 * Раньше α подставлялся как есть — Кз занижался, волна гасла медленнее.
 */
export function kzFromAlpha(alpha: number | undefined): number {
  const a = (alpha && alpha > 0 ? alpha : VGSCH_ALPHA_DEFAULT) * 9.81;
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
  const m = combustionMode(p.mode);
  const dustFactor = p.dust || m.dust ? VGSCH_DUST_K : 1;
  const En = explosionEnergyJ(p.V0_m3, p.energyRel, dustFactor);
  const dPn_kPa = initialPressureMPa(En, p.V0_m3, m.mu) * 1000;
  // В точке отрыва ф. (4) даёт ≈ 296 кПа — это детонация. Для других видов
  // взрыва зоны 1–2 масштабируются так, чтобы давление было непрерывным
  // в месте отрыва и равнялось ΔPн по ф. (2).
  const refPn = zone2DetonationKPa(1, VGSCH_PV_FACTOR);
  const k = dPn_kPa > 0 ? dPn_kPa / refPn : 0;
  return {
    zoneLength_m: p.zoneLength_m,
    V0_m3: p.V0_m3,
    mode: m.id,
    mu: m.mu,
    En_MJ: En / 1e6,
    dustFactor,
    dPz_kPa: VGSCH_ZONE1_KPA * k,
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
/** п. 3 табл. 5 — затекание в ответвление сопряжения. */
const KZAT_BRANCH = [
  [0.690, 0.710, 0.740, 0.800], [0.620, 0.635, 0.670, 0.740], [0.543, 0.565, 0.590, 0.640],
  [0.473, 0.505, 0.520, 0.540], [0.400, 0.420, 0.450, 0.460], [0.350, 0.365, 0.400, 0.420],
  [0.280, 0.295, 0.350, 0.360], [0.207, 0.220, 0.230, 0.280], [0.120, 0.125, 0.140, 0.170],
];
/** п. 13 табл. 5 — угол поворота выработки. */
const KZAT_TURN = [
  [0.860, 0.910, 1.030, 1.100], [0.810, 0.860, 0.940, 1.020], [0.780, 0.810, 0.860, 0.910],
  [0.740, 0.760, 0.780, 0.820], [0.700, 0.710, 0.730, 0.750], [0.610, 0.620, 0.640, 0.680],
  [0.490, 0.497, 0.520, 0.590], [0.360, 0.370, 0.360, 0.450], [0.200, 0.210, 0.220, 0.270],
];

export type LocalResistance = "straight" | "branch" | "turn";

export const LOCAL_RESISTANCE_LABEL: Record<LocalResistance, string> = {
  straight: "проход прямо (табл. 5 п. 2)",
  branch: "ответвление сопряжения (табл. 5 п. 3)",
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

/** Коэффициент затекания Кзат (билинейная интерполяция по табл. 5). */
export function kzat(kind: LocalResistance, delta: number, dP_MPa: number): number {
  const tbl = kind === "branch" ? KZAT_BRANCH : kind === "turn" ? KZAT_TURN : KZAT_STRAIGHT;
  const [r0, r1, tr] = interpIdx(KZAT_DELTA, delta > 0 ? delta : 1);
  const [c0, c1, tc] = interpIdx(KZAT_DP, dP_MPa, true);
  const v0 = tbl[r0][c0] + (tbl[r0][c1] - tbl[r0][c0]) * tc;
  const v1 = tbl[r1][c0] + (tbl[r1][c1] - tbl[r1][c0]) * tc;
  return v0 + (v1 - v0) * tr;
}

/** Вид местного сопротивления по геометрии узла. */
export function localResistanceKind(deflection_deg: number, outCount: number): LocalResistance {
  if (deflection_deg <= TURN_ANGLE_DEG) return "straight";
  return outCount > 1 ? "branch" : "turn";
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}