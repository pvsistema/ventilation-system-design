// ─────────────────────────────────────────────────────────────────────────────
// explosionCalculator.ts — Расчёт параметров воздушных ударных волн при взрывах
//
// Методика: «Методика газодинамического расчёта параметров воздушных ударных
// волн при взрывах газа и пыли» — формула Садовского, тротиловый эквивалент
// по Методике №415 (Приказ Ростехнадзора от 28.11.2022) с коэффициентом
// участия Z.
//
// РАНЕЕ здесь был второй режим «ФНиП №494» с формулой
// ΔP = 1.5·(Q/r³)^(1/3)·P₀. Он удалён: в самих ФНиП №494 (правила обращения
// с взрывчатыми материалами) расчётных формул ударной волны нет, а сама
// зависимость сводилась к затуханию 1/r и на дальних расстояниях завышала
// давление втрое против №415. Вдобавок коэффициент 1.5 уже учитывал
// канализирование волны в выработке, и поверх него домножался коэффициент
// отражения от стенок — эффект учитывался дважды.
// Старые проекты с method="fnip_494" открываются: поле сохранено в типе
// ветви, но на расчёт не влияет — он всегда газодинамический.
//
// Способы задания источника:
//   • По газу    — объём горючего газа (CH₄ или H₂) в м³, концентрация
//   • По массе   — масса взрывчатого вещества (ВВ) в кг
//
// Выходные параметры:
//   • Избыточное давление ΔP_ф (кПа) во фронте ударной волны
//   • Импульс i (Па·с)
//   • Скорость фронта D (м/с)
//   • Зоны поражения (безопасная, лёгкая, средняя, тяжёлая)
//   • Тротиловый эквивалент Q_tnt (кг ТНТ) — для единообразия методик
//
// Ориентир: Аэросеть / ВНИМИ / методика Садовского–Ефремова
// ─────────────────────────────────────────────────────────────────────────────

// ─── Константы ────────────────────────────────────────────────────────────────
const Q_TNT   = 4520;   // кДж/кг — теплота взрыва ТНТ
const P0      = 101.3;  // кПа    — атмосферное давление
const C0      = 340;    // м/с    — скорость звука

// ─── Типы взрывчатых веществ (метод «по массе») ───────────────────────────────
/**
 * ВВ задаётся ОДНИМ параметром — удельной теплотой взрыва.
 *
 * Тротиловый эквивалент из неё вычисляется: k = q_ВВ / q_ТНТ (Методика №415).
 * Раньше qSpec и tntEq хранились как два независимых числа, причём qSpec
 * в расчёте не участвовал вообще, а tntEq был с ним не согласован: у
 * аммонита 6ЖВ стояло q = 3700 кДж/кг и k = 0.97, хотя из этой теплоты
 * следует k = 0.82. Теперь источник правды один — теплота.
 */
export interface ExplosiveType {
  id: string;
  name: string;
  qSpec: number;   // кДж/кг — удельная теплота взрыва (единственный исходный параметр)
}

// Справочные теплоты взрыва промышленных ВВ, кДж/кг.
export const EXPLOSIVE_TYPES: ExplosiveType[] = [
  { id: "tnt",       name: "ТНТ",              qSpec: 4520 },
  { id: "ammonit",   name: "Аммонит 6ЖВ",      qSpec: 4312 },
  { id: "granulite", name: "Гранулит АС-8",    qSpec: 4290 },
  { id: "igdanit",   name: "Игданит",          qSpec: 3810 },
  { id: "anfo",      name: "ANFO",             qSpec: 3700 },
  { id: "emulsion",  name: "Эмульсионное ВВ",  qSpec: 3000 },
  { id: "custom",    name: "Произвольное ВВ",  qSpec: 4520 },
];

/**
 * Тротиловый эквивалент ВВ: k = q_ВВ / q_ТНТ.
 * Округление до сотых — как в справочных таблицах.
 */
export function tntEquivalent(expl: ExplosiveType): number {
  return Math.round((expl.qSpec / Q_TNT) * 100) / 100;
}

// ─── Виды горючих газов и пыли (метод «по газу») ─────────────────────────────
/**
 * Единица концентрации. У газов и у пыли она РАЗНАЯ, и это не косметика:
 *   • "vol%" — объёмные проценты (газы). Объём горючего = V · c/100.
 *   • "g/m3" — граммы на кубометр (аэровзвесь пыли). Масса пыли = V · c/1000.
 * Раньше пыль хранилась с пределами 60…400 и считалась как проценты — при
 * «концентрации» 200 выходило 200 м³ горючего в 100 м³ смеси, то есть
 * горючего вдвое больше, чем всей смеси, и Q_тнт завышался в сотни раз.
 */
export type ConcUnit = "vol%" | "g/m3";

export interface GasType {
  id: string;
  name: string;
  /**
   * Теплота сгорания. Единица зависит от unit:
   *   "vol%" → МДж/м³ (на кубометр горючего газа при н.у.)
   *   "g/m3" → МДж/кг (на килограмм пыли)
   */
  qCombust: number;
  unit: ConcUnit;     // в чём задаётся концентрация
  lowerLimit: number; // нижний концентрационный предел взрываемости
  upperLimit: number; // верхний концентрационный предел взрываемости
  stoichConc: number; // стехиометрическая (оптимальная) концентрация
}

export const GAS_TYPES: GasType[] = [
  { id: "methane",   name: "Метан (CH₄)",    unit: "vol%", qCombust: 33.8, lowerLimit: 5.0, upperLimit: 15.0, stoichConc: 9.5  },
  { id: "hydrogen",  name: "Водород (H₂)",    unit: "vol%", qCombust: 10.8, lowerLimit: 4.0, upperLimit: 75.0, stoichConc: 29.5 },
  { id: "propane",   name: "Пропан (C₃H₈)",   unit: "vol%", qCombust: 93.2, lowerLimit: 2.1, upperLimit: 9.5,  stoichConc: 4.0  },
  { id: "acetylene", name: "Ацетилен (C₂H₂)", unit: "vol%", qCombust: 56.0, lowerLimit: 2.5, upperLimit: 80.0, stoichConc: 7.7  },
  // Угольная пыль: НПВ ≈ 30 г/м³, ВПВ ≈ 2000 г/м³, максимум давления
  // при 300–500 г/м³. Теплота сгорания каменного угля ≈ 22 МДж/кг.
  { id: "coal_dust", name: "Угольная пыль",   unit: "g/m3", qCombust: 22.0, lowerLimit: 30,  upperLimit: 2000, stoichConc: 400  },
];

/** Подпись единицы концентрации для интерфейса */
export function concUnitLabel(unit: ConcUnit): string {
  return unit === "g/m3" ? "г/м³" : "%";
}

// ─── Коэффициент участия Z (Методика №415, прил. по ТВС) ─────────────────────
// Z — доля горючего вещества, участвующая во взрывном превращении.
//   0.1 — дефлаграция в открытом пространстве;
//   0.5 — взрыв в замкнутом/загромождённом объёме (горная выработка).
export const Z_OPEN     = 0.1;
export const Z_CONFINED = 0.5;
export const Z_DEFAULT  = Z_CONFINED; // выработка — замкнутый объём

// ─── Параметры расчёта ────────────────────────────────────────────────────────
/** Методика расчёта. Осталась одна — газодинамическая (Садовский + №415). */
export type ExplosionMethod = "gas_dynamics";
export type ExplosionSourceType = "gas" | "mass";

export interface ExplosionParams {
  method?: ExplosionMethod;
  sourceType: ExplosionSourceType;
  // По газу
  gasId: string;
  gasVolume_m3: number;        // м³ — объём взрывоопасной смеси
  gasConcentration: number;    // % — концентрация газа в смеси
  // По массе
  explosiveId: string;
  explosiveMass_kg: number;    // кг — масса ВВ
  // Геометрия выработки
  excavationArea_m2: number;   // м² — сечение выработки
  excavationLength_m: number;  // м — длина зоны взрыва
  // Дополнительно
  ambientPressure_kPa: number; // кПа — атмосферное давление (высота)
  considerWalls: boolean;      // учёт отражения от стенок выработки
  /** Коэффициент участия Z по Методике №415: 0.1 — открытое пространство,
   *  0.5 — замкнутый объём (горная выработка). По умолчанию 0.5. */
  zParticipation?: number;
}

// ─── Результаты расчёта ───────────────────────────────────────────────────────
export interface ExplosionZone {
  name: string;
  description: string;
  radius_m: number;
  deltaP_kPa: number;
  impulse_Pas: number;
  hazardLevel: "safe" | "light" | "medium" | "heavy" | "lethal";
}

export interface ExplosionResult {
  // Тротиловый эквивалент
  q_tnt_kg: number;
  /**
   * Максимальные параметры волны — НЕ в эпицентре, а на границе
   * применимости формулы (r̄ = 1). Ближе к заряду методика не работает.
   */
  maxDeltaP_kPa: number;
  maxImpulse_Pas: number;
  waveFrontSpeed_ms: number;
  /** Расстояние, к которому относятся max-параметры, м (r̄ = 1) */
  minValidRadius_m?: number;
  // Распределение по расстоянию
  zones: ExplosionZone[];
  // Зоны поражения на конкретных расстояниях
  pressureAtDistance: (r_m: number) => number;
  impulseAtDistance: (r_m: number) => number;
  // Лог расчёта
  log: string[];
  // Предупреждения (газ вне зоны взрываемости и т.п.)
  warnings: string[];
}

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/**
 * Тротиловый эквивалент облака (Методика №415, прил. по ТВС):
 *   m_пр = (q_г / q_ТНТ) · m · Z
 * где Z — коэффициент участия горючего во взрывном превращении
 * (0.1 — дефлаграция в открытом пространстве, 0.5 — замкнутый объём).
 *
 * Газ и пыль считаются по-разному — у них разная единица концентрации:
 *   газ  (vol%): объём горючего = V·c/100,  энергия = объём · qCombust [МДж/м³]
 *   пыль (g/m3): масса пыли     = V·c/1000, энергия = масса · qCombust [МДж/кг]
 */
function gasToTnt(gas: GasType, volume_m3: number, concentration: number, z: number): number {
  // Химическая энергия облака, МДж
  const E_chem = gas.unit === "g/m3"
    ? (volume_m3 * concentration / 1000) * gas.qCombust  // кг пыли × МДж/кг
    : (volume_m3 * concentration / 100)  * gas.qCombust; // м³ газа × МДж/м³
  // Энергия, участвующая во взрывном превращении (коэффициент Z по №415)
  const E_mech = E_chem * z * 1000; // → кДж
  // Тротиловый эквивалент
  return E_mech / Q_TNT;
}

/** Тротиловый эквивалент из массы ВВ */
function massToTnt(expl: ExplosiveType, mass_kg: number): number {
  return mass_kg * tntEquivalent(expl);
}

/** Перевод кгс/см² → кПа (коэффициенты Садовского даны в кгс/см²) */
const KGF_CM2_TO_KPA = 98.07;

/**
 * Нижняя граница применимости формулы Садовского — приведённое расстояние
 * r̄ = r / Q^(1/3) = 1, то есть r = Q^(1/3) метров. Ближе к заряду формула
 * расходится: члены 1/r̄² и 1/r̄³ растут неограниченно и дают величины,
 * не имеющие физического смысла (для 97 кг при r = 1 м получалось
 * 74 000 кПа и скорость фронта 8 500 м/с — быстрее детонации любого ВВ).
 */
const R_BAR_MIN = 1.0;

/** Наименьшее расстояние, на котором формула ещё применима, м */
export function minValidRadius(q_tnt: number): number {
  if (q_tnt <= 0) return 0;
  return Math.round(R_BAR_MIN * Math.pow(q_tnt, 1 / 3) * 100) / 100;
}

/**
 * Давление во фронте ударной волны по формуле Садовского (Методика ГД):
 * ΔP = 0.84/r̄ + 2.7/r̄² + 7.15/r̄³  [кгс/см²]
 * где r̄ = r / Q_tnt^(1/3) — приведённое расстояние.
 * ВАЖНО: исходные коэффициенты дают результат в кгс/см², поэтому
 * результат переводится в кПа умножением на 98.07.
 * Источник: Садовский М.А. «Механическое действие взрыва».
 * Согласуется с Методикой №415 (ТВС) при Z = 0.1.
 */
function sadovskyDeltaP(r_m: number, q_tnt: number): number {
  if (q_tnt <= 0 || r_m <= 0) return 0;
  const rBar = r_m / Math.pow(q_tnt, 1 / 3);
  if (rBar < 0.1) return 10000; // очень близко к эпицентру
  const dP_kgf = 0.84 / rBar + 2.7 / (rBar * rBar) + 7.15 / (rBar * rBar * rBar);
  return Math.round(dP_kgf * KGF_CM2_TO_KPA * 10) / 10;
}

/**
 * Импульс положительной фазы, Па·с — по Методике №415 (прил. по ТВС):
 *   i = 123 · m_пр^0.66 / r
 *
 * Коэффициент 123 взят из той же методики, что и формула давления, — иначе
 * импульс и давление считались бы по разным источникам. Прежний коэффициент
 * 200 (из другой редакции формулы Садовского, в иных единицах) завышал
 * импульс ровно на 68 % на всех расстояниях.
 */
function sadovskyImpulse(r_m: number, q_tnt: number): number {
  if (q_tnt <= 0 || r_m <= 0) return 0;
  const i_Pa_s = 123 * Math.pow(q_tnt, 0.66) / r_m;
  return Math.round(i_Pa_s * 10) / 10;
}

/** Скорость фронта ударной волны (м/с) через давление: D = C0 * √(1 + 6/7 * ΔP/P0) */
function waveFrontSpeed(deltaP_kPa: number): number {
  return Math.round(C0 * Math.sqrt(1 + (6 / 7) * (deltaP_kPa / P0)) * 10) / 10;
}

/** Коэффициент отражения от стенок горной выработки */
function wallReflectionFactor(area_m2: number): number {
  // Эмпирический коэффициент: чем уже выработка, тем сильнее эффект канализирования волны
  // Типичные выработки 15–40 м² → коэффициент 1.5–2.0
  if (area_m2 <= 0) return 1.5;
  if (area_m2 < 10) return 2.0;
  if (area_m2 < 20) return 1.8;
  if (area_m2 < 40) return 1.5;
  return 1.3;
}

// ─── Пороги поражения (кПа) ───────────────────────────────────────────────────
const HAZARD_THRESHOLDS = {
  lethal:  100,   // > 100 кПа — летальный исход
  heavy:    50,   // 50–100 кПа — тяжёлые повреждения
  medium:   30,   // 30–50 кПа — средние повреждения
  light:    10,   // 10–30 кПа — лёгкие повреждения
  safe:      0,   // < 10 кПа — безопасно (для классификации точки)
};

/**
 * Граница безопасной зоны, кПа — как в ПО «Аэросеть».
 * Это НЕ порог классификации (им остаётся 10 кПа), а расстояние, дальше
 * которого воздействие считается пренебрежимо малым: до него доезжает
 * шкала волны и по нему строится внешний контур зон.
 */
const SAFE_ZONE_LIMIT_KPA = 5.99;

function hazardLevel(dP: number): ExplosionZone["hazardLevel"] {
  if (dP >= HAZARD_THRESHOLDS.lethal)  return "lethal";
  if (dP >= HAZARD_THRESHOLDS.heavy)   return "heavy";
  if (dP >= HAZARD_THRESHOLDS.medium)  return "medium";
  if (dP >= HAZARD_THRESHOLDS.light)   return "light";
  return "safe";
}

/** Радиус, при котором давление падает до порогового значения */
function radiusAtPressure(targetP_kPa: number, q_tnt: number, wallFactor: number): number {
  if (targetP_kPa <= 0 || q_tnt <= 0) return 0;
  // Бинарный поиск радиуса
  let lo = 0.1, hi = 5000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const dP = sadovskyDeltaP(mid, q_tnt) * wallFactor;
    if (dP > targetP_kPa) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

// ─── Главная функция расчёта ──────────────────────────────────────────────────
export function calcExplosion(params: ExplosionParams): ExplosionResult {
  const log: string[] = [];
  const warnings: string[] = [];

  // 1. Тротиловый эквивалент
  let q_tnt = 0;

  if (params.sourceType === "gas") {
    const gas = GAS_TYPES.find(g => g.id === params.gasId) ?? GAS_TYPES[0];
    const conc = params.gasConcentration;
    const u = concUnitLabel(gas.unit);
    // Проверка взрываемости
    if (conc < gas.lowerLimit) {
      warnings.push(`⚠ Концентрация ${conc} ${u} ниже НПВ (${gas.lowerLimit} ${u}) — смесь не взрывоопасна`);
    } else if (conc > gas.upperLimit) {
      warnings.push(`⚠ Концентрация ${conc} ${u} выше ВПВ (${gas.upperLimit} ${u}) — смесь не взрывоопасна`);
    }
    // Обогащённая смесь: горючего больше стехиометрии — не хватает кислорода.
    // Энергия ограничена окислителем, поэтому сверх стехиометрии в расчёт
    // идёт стехиометрическая концентрация, а не заданная.
    const effectiveConc = Math.min(conc, gas.stoichConc);
    const z = params.zParticipation && params.zParticipation > 0 ? params.zParticipation : Z_DEFAULT;
    q_tnt = gasToTnt(gas, params.gasVolume_m3, effectiveConc, z);
    log.push(`${gas.unit === "g/m3" ? "Пыль" : "Газ"}: ${gas.name}, объём смеси: ${params.gasVolume_m3} м³, концентрация: ${conc} ${u}`);
    if (effectiveConc < conc) {
      log.push(`Смесь обогащённая: в расчёт принята стехиометрическая концентрация ${effectiveConc} ${u} (энергия ограничена кислородом)`);
    }
    log.push(`Коэффициент участия Z (Методика №415): ${z}`);
    log.push(`Тротиловый эквивалент: Q_tnt = ${Math.round(q_tnt * 100) / 100} кг ТНТ`);
  } else {
    const expl = EXPLOSIVE_TYPES.find(e => e.id === params.explosiveId) ?? EXPLOSIVE_TYPES[0];
    q_tnt = massToTnt(expl, params.explosiveMass_kg);
    log.push(`ВВ: ${expl.name}, масса: ${params.explosiveMass_kg} кг, Q_уд = ${expl.qSpec} кДж/кг`);
    log.push(`Тротиловый эквивалент: k = Q_уд / Q_ТНТ = ${expl.qSpec} / ${Q_TNT} = ${tntEquivalent(expl)}`);
    log.push(`Тротиловый эквивалент: Q_tnt = ${Math.round(q_tnt * 100) / 100} кг ТНТ`);
  }

  if (q_tnt <= 0) {
    warnings.push("⚠ Тротиловый эквивалент = 0 — расчёт невозможен");
    q_tnt = 0.001;
  }

  // 2. Коэффициент эффекта выработки (канализирование волны)
  const wallFactor = params.considerWalls
    ? wallReflectionFactor(params.excavationArea_m2)
    : 1.0;
  if (params.considerWalls) {
    log.push(`Коэффициент отражения от стенок выработки: k = ${wallFactor}`);
  }

  // 3. Функции давления и импульса
  const pressureAtDistance = (r: number) => {
    const dP = sadovskyDeltaP(r, q_tnt);
    return Math.round(dP * wallFactor * 10) / 10;
  };

  const impulseAtDistance = (r: number) => {
    const i = sadovskyImpulse(r, q_tnt);
    return Math.round(i * wallFactor * 10) / 10;
  };

  // 4. Максимальные параметры — на ГРАНИЦЕ ПРИМЕНИМОСТИ формулы (r̄ = 1).
  // Раньше здесь стояло r = 1 м независимо от массы заряда. Для 97 кг ТНТ
  // это r̄ = 0.22, то есть глубоко внутри зоны, где формула Садовского уже
  // не работает: получалось 74 000 кПа и скорость фронта 8 500 м/с.
  // Ближе к заряду параметры волны этой методикой не определяются.
  const rMin = minValidRadius(q_tnt);
  const maxDeltaP = pressureAtDistance(rMin);
  const maxImpulse = impulseAtDistance(rMin);
  const waveFrontSpeed_ms = waveFrontSpeed(maxDeltaP);

  log.push("Методика: газодинамическая (Садовский), Q_тнт по Методике №415");
  log.push(`Граница применимости формулы: r̄ = 1, то есть r = ${rMin} м`);
  log.push(`Максимальное давление во фронте (r = ${rMin} м): ΔP = ${maxDeltaP} кПа`);
  log.push(`Скорость фронта: D = ${waveFrontSpeed_ms} м/с`);

  // 5. Зоны поражения
  const zones: ExplosionZone[] = [
    {
      name: "Летальная",
      description: "ΔP > 100 кПа — летальный исход, полное разрушение",
      radius_m: radiusAtPressure(HAZARD_THRESHOLDS.lethal, q_tnt, wallFactor),
      deltaP_kPa: HAZARD_THRESHOLDS.lethal,
      impulse_Pas: impulseAtDistance(radiusAtPressure(HAZARD_THRESHOLDS.lethal, q_tnt, wallFactor)),
      hazardLevel: "lethal",
    },
    {
      name: "Тяжёлые поражения",
      description: "ΔP 50–100 кПа — тяжёлые травмы, обрушение конструкций",
      radius_m: radiusAtPressure(HAZARD_THRESHOLDS.heavy, q_tnt, wallFactor),
      deltaP_kPa: HAZARD_THRESHOLDS.heavy,
      impulse_Pas: impulseAtDistance(radiusAtPressure(HAZARD_THRESHOLDS.heavy, q_tnt, wallFactor)),
      hazardLevel: "heavy",
    },
    {
      name: "Средние поражения",
      description: "ΔP 30–50 кПа — средние травмы, повреждение оборудования",
      radius_m: radiusAtPressure(HAZARD_THRESHOLDS.medium, q_tnt, wallFactor),
      deltaP_kPa: HAZARD_THRESHOLDS.medium,
      impulse_Pas: impulseAtDistance(radiusAtPressure(HAZARD_THRESHOLDS.medium, q_tnt, wallFactor)),
      hazardLevel: "medium",
    },
    {
      name: "Лёгкие поражения",
      description: "ΔP 10–30 кПа — контузии, звуковая травма, лёгкие повреждения",
      radius_m: radiusAtPressure(HAZARD_THRESHOLDS.light, q_tnt, wallFactor),
      deltaP_kPa: HAZARD_THRESHOLDS.light,
      impulse_Pas: impulseAtDistance(radiusAtPressure(HAZARD_THRESHOLDS.light, q_tnt, wallFactor)),
      hazardLevel: "light",
    },
    {
      name: "Безопасная зона",
      description: "ΔP < 5.99 кПа — незначительное воздействие",
      radius_m: radiusAtPressure(SAFE_ZONE_LIMIT_KPA, q_tnt, wallFactor),
      deltaP_kPa: SAFE_ZONE_LIMIT_KPA,
      impulse_Pas: impulseAtDistance(radiusAtPressure(SAFE_ZONE_LIMIT_KPA, q_tnt, wallFactor)),
      hazardLevel: "safe",
    },
  ];

  zones.forEach(z => {
    log.push(`${z.name}: r = ${z.radius_m} м, ΔP = ${z.deltaP_kPa} кПа`);
  });

  return {
    q_tnt_kg: Math.round(q_tnt * 100) / 100,
    maxDeltaP_kPa: maxDeltaP,
    maxImpulse_Pas: maxImpulse,
    waveFrontSpeed_ms,
    minValidRadius_m: rMin,
    zones,
    pressureAtDistance,
    impulseAtDistance,
    log,
    warnings,
  };
}

/** Уровень опасности по давлению (для окраски ветвей) */
export function explosionHazardLevel(deltaP_kPa: number): ExplosionZone["hazardLevel"] {
  return hazardLevel(deltaP_kPa);
}

/**
 * Цвет ветви по уровню поражения — ЕДИНСТВЕННЫЙ источник правды.
 * ВАЖНО: только hex. Эти цвета уходят в ctx.strokeStyle холста, а canvas
 * не понимает запись var(--...) — при невалидном цвете присваивание молча
 * игнорируется и линия рисуется предыдущим цветом контекста.
 */
export const EXPLOSION_HAZARD_COLORS: Record<ExplosionZone["hazardLevel"], string> = {
  lethal:  "#7c1010",
  heavy:   "#dc2626",
  medium:  "#f97316",
  light:   "#fbbf24",
  safe:    "#22c55e",
};

/** Зона поражения (цвет + уровень) по избыточному давлению */
export function explosionZoneColor(deltaP_kPa: number): { color: string; hazardLevel: ExplosionZone["hazardLevel"] } {
  const level = hazardLevel(deltaP_kPa);
  return { color: EXPLOSION_HAZARD_COLORS[level], hazardLevel: level };
}