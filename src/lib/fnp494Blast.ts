// ─────────────────────────────────────────────────────────────────────────────
// fnp494Blast.ts — ударная воздушная волна (УВВ) при взрыве ЗАРЯДА ВВ в
// подземных горных выработках по ФНП «Правила безопасности при производстве,
// хранении и применении взрывчатых материалов промышленного назначения»
// (приказ Ростехнадзора от 03.12.2020 № 494), пп. 816–822, прил. 28–30.
//
//   ΔP = (3410·Qэ/(R·ΣS) + 794·√(Qэ/(R·ΣS))) · e^(−β·R/d),  кПа   (ф. 22)
//   d  = 1,12·√S                                                   (ф. 23)
//   d  = (d1 + d2 + … + dn)/n — выработки разного сечения          (ф. 24)
//   βср = (β1·R1 + β2·R2 + … + βn·Rn)/R — разная крепь           (прил. 29)
//
// На местных сопротивлениях давление ДЕЛИТСЯ на коэффициент из прил. 30
// (п. 818). Тупик короче ¼ пройденного волной пути и плавные закругления
// не учитываются. Для пород IX группы и выше (f = 12…20) давление ×1,5.
// Допустимое давление для людей — 10 кПа.
//
// ВНИМАНИЕ: приказ № 494 действует до 01.01.2027 — при выходе новой редакции
// коэффициенты нужно сверить заново.
// ─────────────────────────────────────────────────────────────────────────────

/** Ссылка на норматив — для протокола и подсказок. */
export const FNP494_REF = "ФНП № 494 (приказ Ростехнадзора от 03.12.2020), пп. 816–822, прил. 28–30";

/** Предельно допустимое давление на фронте УВВ для людей, кПа (п. 817). */
export const FNP494_PEOPLE_KPA = 10;

/** Множитель для пород IX группы и выше (f = 12…20), п. 817. */
export const FNP494_HARD_ROCK_K = 1.5;

// ─── Прил. 29 — коэффициент шероховатости β ─────────────────────────────────
export type Fnp494SupportId =
  | "unsupported_strike" | "unsupported_cross_up" | "unsupported_cross_down" | "uneven_hatches"
  | "concrete" | "partial_frames" | "arch" | "shotcrete" | "arch_hatches";

export const FNP494_SUPPORTS: { id: Fnp494SupportId; name: string; min: number; max: number }[] = [
  // В тексте приказа для этой строки напечатано «0.25» — очевидная опечатка
  // (на порядок выше соседних строк); принято 0,025.
  { id: "unsupported_strike",     name: "Без крепи, пройдена по простиранию",                     min: 0.02,  max: 0.025 },
  { id: "unsupported_cross_up",   name: "Без крепи, вкрест простирания, волна против падения",   min: 0.04,  max: 0.045 },
  { id: "unsupported_cross_down", name: "Без крепи, вкрест простирания, волна по падению",       min: 0.022, max: 0.028 },
  { id: "uneven_hatches",         name: "Неровная почва и люки",                                 min: 0.045, max: 0.063 },
  { id: "concrete",               name: "Крепь бетоном",                                         min: 0.010, max: 0.015 },
  { id: "partial_frames",         name: "Неполные крепёжные рамы",                               min: 0.025, max: 0.034 },
  { id: "arch",                   name: "Арочная крепь",                                         min: 0.04,  max: 0.06 },
  { id: "shotcrete",              name: "Торкретбетон",                                          min: 0.02,  max: 0.025 },
  { id: "arch_hatches",           name: "Арочная крепь с люками для выпуска руды",               min: 0.05,  max: 0.07 },
];

/** Какая граница диапазона β берётся: нижняя — давление выше (с запасом для людей). */
export type BetaBound = "min" | "max";

/**
 * Вид крепи по прил. 29 — по типу поверхности выработки из справочника
 * сопротивлений. Задан явно (blastSupport) — берётся он.
 */
export function supportOf(b: { blastSupport?: string; surfaceId?: string; alphaCoef?: number }): Fnp494SupportId {
  if (b.blastSupport && FNP494_SUPPORTS.some(s => s.id === b.blastSupport)) return b.blastSupport as Fnp494SupportId;
  switch (b.surfaceId) {
    case "smooth":
    case "concrete":
    case "shaft_smooth":   return "concrete";
    case "concrete_rough": return "shotcrete";
    case "anchor":
    case "uncoupled":      return "unsupported_strike";
    case "wood":           return "partial_frames";
    case "metal_arch":     return "arch";
    case "uncoupled_r":
    case "shaft_skip":     return "uneven_hatches";
    case "lava":           return "arch_hatches";
  }
  // Тип поверхности не задан — по коэффициенту α (×10⁻⁴ Н·с²/м⁴)
  const a = b.alphaCoef ?? 0;
  if (a > 0 && a <= 20) return "concrete";
  if (a > 0 && a <= 40) return "shotcrete";
  if (a > 0 && a <= 60) return "unsupported_strike";
  if (a > 0 && a <= 90) return "arch";
  if (a > 90) return "uneven_hatches";
  return "arch";
}

export function supportName(id: Fnp494SupportId): string {
  return FNP494_SUPPORTS.find(s => s.id === id)?.name ?? id;
}

export function betaOf(b: { blastSupport?: string; surfaceId?: string; alphaCoef?: number }, bound: BetaBound = "min"): number {
  const s = FNP494_SUPPORTS.find(x => x.id === supportOf(b)) ?? FNP494_SUPPORTS[6];
  return bound === "max" ? s.max : s.min;
}

/** Приведённый диаметр выработки d = 1,12·√S, м (ф. 23). */
export function reducedDiameter(area_m2: number): number {
  return area_m2 > 0 ? 1.12 * Math.sqrt(area_m2) : 0;
}

// ─── Прил. 28 — давление разрушения объектов, кПа ───────────────────────────
export const FNP494_OBJECTS: { name: string; kPa: number | [number, number] }[] = [
  { name: "Остекление", kPa: 2 },
  { name: "Деревянные перемычки", kPa: 10 },
  { name: "Вентиляционные трубопроводы", kPa: 15 },
  { name: "Электрооборудование", kPa: 20 },
  { name: "Электросети", kPa: 30 },
  { name: "Вентиляторы местного проветривания", kPa: 40 },
  { name: "Лебёдки (массой до 1 т)", kPa: 40 },
  { name: "Кирпичные перемычки (толщиной 0,2…0,4 м)", kPa: 50 },
  { name: "Люки, воздушные трубы", kPa: 60 },
  { name: "Контактный провод", kPa: 80 },
  { name: "Вагонетки торцом / боком к взрыву", kPa: [140, 50] },
  { name: "Проходческие машины", kPa: 140 },
  { name: "Деревянная крепь", kPa: 80 },
  { name: "Арочная крепь", kPa: 150 },
  { name: "Бетонная перемычка", kPa: [200, 400] },
  { name: "Железобетонная стена (толщиной 0,25 м)", kPa: [280, 350] },
  { name: "Рельсовый путь", kPa: 700 },
];

/**
 * Давление разрушения перемычки по прил. 28, МПа — по материалу значка.
 * Для бетонной взята нижняя граница диапазона (200 кПа) — с запасом.
 * null — материал в прил. 28 не указан (металл, парус, без материала).
 */
export function fnpFailureMPa(typeId: string | undefined): number | null {
  if (!typeId) return null;
  if (/_(conc|concrete)$/.test(typeId)) return 0.2;
  if (/_brick$/.test(typeId)) return 0.05;
  if (/_wood$/.test(typeId)) return 0.01;
  return null;
}

// ─── Источник и давление в одиночной выработке ──────────────────────────────
export interface Fnp494Source {
  /** Масса эквивалентного заряда Qэ, кг. */
  Q_kg: number;
  /** Суммарное сечение выработок, примыкающих к заряду, м². */
  sumS_m2: number;
  /** Сечение выработки-очага, м². */
  area_m2: number;
  /** Приведённый диаметр выработки-очага, м. */
  d_m: number;
  /** β выработки-очага (прил. 29). */
  beta: number;
  support: Fnp494SupportId;
  betaBound: BetaBound;
  /** Множитель для крепких пород (1 или 1,5). */
  kRock: number;
  /** Ближе этого расстояния формула не применяется (r̄ = Q^⅓), м. */
  rMin_m: number;
  /** Тротиловый эквивалент — для импульса (справочно), кг. */
  qTnt_kg: number;
}

/** Начальная часть формулы (22) без затухания, кПа. */
export function fnpBase(R_m: number, src: Fnp494Source): number {
  if (!(src.Q_kg > 0) || !(src.sumS_m2 > 0)) return 0;
  const R = Math.max(R_m, src.rMin_m, 0.1);
  const x = src.Q_kg / (R * src.sumS_m2);
  return (3410 * x + 794 * Math.sqrt(x)) * src.kRock;
}

/** Давление на расстоянии R по выработке-очагу (без местных сопротивлений), кПа. */
export function fnpPressureAt(R_m: number, src: Fnp494Source): number {
  const R = Math.max(R_m, src.rMin_m);
  const att = src.d_m > 0 ? Math.exp(-src.beta * R / src.d_m) : 1;
  return Math.round(fnpBase(R, src) * att * 10) / 10;
}

/**
 * Импульс, Па·с — СПРАВОЧНО. ФНП № 494 импульс не нормирует; берётся
 * формула Садовского для заряда (i = 200·Q^⅔/R) с тем же затуханием e^(−βR/d).
 */
export function fnpImpulseAt(R_m: number, src: Fnp494Source): number {
  if (!(src.qTnt_kg > 0)) return 0;
  const R = Math.max(R_m, src.rMin_m);
  const att = src.d_m > 0 ? Math.exp(-src.beta * R / src.d_m) : 1;
  return Math.round(200 * Math.pow(src.qTnt_kg, 2 / 3) / R * att * src.kRock * 10) / 10;
}

/** Расстояние по выработке-очагу, на котором давление падает до p, м. */
export function fnpDistanceAtPressure(p_kPa: number, src: Fnp494Source): number {
  if (!(p_kPa > 0)) return 0;
  if (fnpPressureAt(src.rMin_m, src) <= p_kPa) return Math.round(src.rMin_m);
  let lo = src.rMin_m, hi = 20000;
  if (fnpPressureAt(hi, src) > p_kPa) return hi;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (fnpPressureAt(m, src) > p_kPa) lo = m; else hi = m;
  }
  return Math.round((lo + hi) / 2);
}

export function makeFnp494Source(p: {
  Q_kg: number; qTnt_kg: number; area_m2: number; sumS_m2?: number;
  support: Fnp494SupportId; betaBound?: BetaBound; hardRock?: boolean;
}): Fnp494Source {
  const area = p.area_m2 > 0 ? p.area_m2 : 12;
  const bound = p.betaBound ?? "min";
  const s = FNP494_SUPPORTS.find(x => x.id === p.support) ?? FNP494_SUPPORTS[6];
  return {
    Q_kg: p.Q_kg,
    sumS_m2: p.sumS_m2 && p.sumS_m2 > 0 ? p.sumS_m2 : 2 * area,
    area_m2: area,
    d_m: reducedDiameter(area),
    beta: bound === "max" ? s.max : s.min,
    support: s.id,
    betaBound: bound,
    kRock: p.hardRock ? FNP494_HARD_ROCK_K : 1,
    rMin_m: Math.max(1, Math.cbrt(Math.max(p.Q_kg, 0))),
    qTnt_kg: p.qTnt_kg,
  };
}

// ─── Прил. 30 — местные сопротивления ───────────────────────────────────────
const E_PTS = [1, 0.8, 0.6, 0.4, 0.2];
const ANG_PTS = [45, 90, 135, 175];

/** а) ответвление под углом α, одинаковые сечения: Z (в ответвление), δ (прямо). */
const A_Z = [2.3, 2.7, 3.1, 3.4];
const A_D = [1.5, 1.25, 1.2, 1.1];
/** б) тройник 90°, разные сечения, E = f/F (f — ответвление, F — основная). */
const B_Z = [2.7, 2.4, 2.2, 1.9, 1.75];
const B_D = [1.25, 1.2, 1.15, 1.1, 1.05];
/** в) внезапное расширение, E = f/F (f — откуда, F — куда). */
const V_Z = [1, 1.13, 1.35, 1.9, 3.0];
/** г) волна из примыкающей узкой f в основную широкую F (расходится в обе стороны). */
const G_T = [1.9, 2.1, 2.5, 3.3, 6.0];
/** д) волна из примыкающей широкой F в основную узкую f. */
const D_T = [1.9, 1.4, 1.25, 1.0, 0.75];
/** ж) поворот с сужением F → f. */
const ZH_T = [1.2, 1.0, 0.9, 0.77, 0.7];
/** з) крестовина: Z — в боковые, δ — прямо. */
const Z_Z = [4, 3.3, 2.9, 2.5, 2.0];
const Z_D = [1.65, 1.5, 1.3, 1.2, 1.1];
/** и) внезапное сужение F → f (давление растёт). */
const I_O = [1, 0.92, 0.85, 0.8, 0.75];
/** к) поворот с расширением f → F. */
const K_T = [1.2, 1.3, 1.65, 2.0, 3.0];

function interp(xs: number[], ys: number[], x: number): number {
  const desc = xs[0] > xs[xs.length - 1];
  const a = desc ? xs.map(v => -v) : xs;
  const v = desc ? -x : x;
  if (v <= a[0]) return ys[0];
  if (v >= a[a.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < a.length - 1; i++) {
    if (v <= a[i + 1]) return ys[i] + (ys[i + 1] - ys[i]) * (v - a[i]) / (a[i + 1] - a[i]);
  }
  return ys[ys.length - 1];
}
const byE = (tbl: number[], E: number) => interp(E_PTS, tbl, Math.max(0.2, Math.min(1, E)));
const byAngle = (tbl: number[], a: number) => interp(ANG_PTS, tbl, Math.max(45, Math.min(175, a)));

/** Отклонение направления, начиная с которого выработка считается поворотом/ответвлением, °. */
export const FNP_STRAIGHT_DEG = 45;

export interface LocalK {
  /** Делитель давления (прил. 30). < 1 — давление растёт. */
  K: number;
  /** Пункт прил. 30 и пояснение — для протокола. */
  label: string;
}

const NONE: LocalK = { K: 1, label: "" };
const near = (a: number, b: number) => Math.abs(a - b) <= 0.05 * Math.max(a, b);
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Коэффициент местного сопротивления для исходящего направления idx.
 * inArea — сечение выработки, по которой волна пришла; outs — исходящие
 * направления (сечение и отклонение от направления прихода, °).
 */
export function localResistance(inArea: number, outs: { area: number; defl: number }[], idx: number): LocalK {
  const o = outs[idx];
  if (!o || !(inArea > 0) || !(o.area > 0)) return NONE;
  const n = outs.length;

  if (n === 1) {
    if (o.defl < FNP_STRAIGHT_DEG) {
      if (near(o.area, inArea)) return NONE;
      if (o.area > inArea) { const E = inArea / o.area; return { K: byE(V_Z, E), label: `внезапное расширение, E=${r2(E)} (прил. 30 «в»)` }; }
      const E = o.area / inArea; return { K: byE(I_O, E), label: `внезапное сужение, E=${r2(E)} (прил. 30 «и»)` };
    }
    if (o.area > inArea * 1.05) { const E = inArea / o.area; return { K: byE(K_T, E), label: `поворот ${Math.round(o.defl)}° с расширением, E=${r2(E)} (прил. 30 «к»)` }; }
    const E = Math.min(1, o.area / inArea);
    return { K: byE(ZH_T, E), label: `поворот ${Math.round(o.defl)}°${E < 0.95 ? ` с сужением, E=${r2(E)}` : ""} (прил. 30 «ж»)` };
  }

  // Прямое продолжение — направление с наименьшим отклонением, не больше 45°
  let straight = -1;
  outs.forEach((x, i) => { if (x.defl < FNP_STRAIGHT_DEG && (straight < 0 || x.defl < outs[straight].defl)) straight = i; });

  if (straight < 0) {
    // Волна выходит из примыкающей выработки в основную (Т-образно)
    if (o.area >= inArea) { const E = inArea / o.area; return { K: byE(G_T, E), label: `выход в основную выработку, E=${r2(E)} (прил. 30 «г»)` }; }
    const E = o.area / inArea; return { K: byE(D_T, E), label: `выход в основную выработку меньшего сечения, E=${r2(E)} (прил. 30 «д»)` };
  }

  const sides = outs.filter((_, i) => i !== straight);
  if (n >= 3) {
    // Крестовина (з): E — сечение боковых к сечению основной
    const sideArea = sides.reduce((s, x) => s + x.area, 0) / sides.length;
    const E = Math.min(1, sideArea / inArea);
    if (idx === straight) return { K: byE(Z_D, E), label: `крестовина, проход прямо, E=${r2(E)} (прил. 30 «з»)` };
    const Es = Math.min(1, o.area / inArea);
    return { K: byE(Z_Z, Es), label: `крестовина, в боковую, E=${r2(Es)} (прил. 30 «з»)` };
  }

  // Тройник: а) по углу ответвления, б) по отношению сечений.
  // При E = 1 остаётся таблица «а», при угле 90° — таблица «б».
  const side = sides[0];
  const alpha = side.defl;
  const E = Math.min(1, side.area / inArea);
  if (idx === straight) {
    const K = byAngle(A_D, alpha) * byE(B_D, E) / B_D[0];
    return { K, label: `сопряжение, проход прямо, ответвление ${Math.round(alpha)}°, E=${r2(E)} (прил. 30 «а», «б»)` };
  }
  const K = byAngle(A_Z, alpha) * byE(B_Z, E) / B_Z[0];
  return { K, label: `ответвление ${Math.round(alpha)}°, E=${r2(E)} (прил. 30 «а», «б»)` };
}
