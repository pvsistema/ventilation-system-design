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
  /** Периметр выработки, м. Не задан — сечение считается круглым. */
  excavationPerimeter_m?: number;
  // Дополнительно
  ambientPressure_kPa: number; // кПа — атмосферное давление (высота)
  considerWalls: boolean;      // учёт отражения от стенок выработки
  /**
   * Канальная модель распространения по выработке.
   * true (по умолчанию) — ближняя зона по Садовскому, дальняя — затухание
   * в канале с трением. false — прежний сферический разлёт, как в открытом
   * воздухе (оставлен для сверки со старыми расчётами).
   */
  channelMode?: boolean;
  /** Коэффициент сопротивления λ для канальной модели (по умолчанию 0.05) */
  channelLambda?: number;
  /** Коэффициент участия Z по Методике №415: 0.1 — открытое пространство,
   *  0.5 — замкнутый объём (горная выработка). По умолчанию 0.5. */
  zParticipation?: number;
  /** Пороги зон поражения из справочника. Не заданы — берутся по умолчанию. */
  thresholds?: Partial<ExplosionThresholds>;
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
  /** Пороги, по которым построены зоны (нужны для окраски схемы) */
  thresholds?: ExplosionThresholds;
  /** Канальная модель включена (ближняя зона — сфера, дальняя — канал) */
  channelMode?: boolean;
  /** Расстояние сшивки сфера → канал, м */
  transitionRadius_m?: number;
  /** Погонный декремент затухания β, 1/м */
  channelDecay_per_m?: number;
  /** Параметры канала — нужны схеме, чтобы вести волну по графу */
  channel?: ChannelParams;
  /**
   * Взрыва нет: заряд нулевой либо смесь вне пределов взрываемости.
   * В этом случае все радиусы и давления равны нулю — зоны поражения
   * не строятся и на схему не выводятся.
   */
  noExplosion?: boolean;
  /** Причина отсутствия взрыва — показывается пользователю. */
  noExplosionReason?: string;
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
function sadovskyDeltaPRaw(r_m: number, q_tnt: number): number {
  if (q_tnt <= 0 || r_m <= 0) return 0;
  // ГРАНИЦА ПРИМЕНИМОСТИ соблюдается здесь, а не только при выводе ΔP_max.
  // Ближе r̄ = 1 формула расходится: на 1 м от заряда 95 кг она давала
  // 72 500 кПа, на 0.5 м — 555 700 кПа. Прежняя отсечка `rBar < 0.1 → 10000`
  // не спасала, а вносила разрыв: при r̄ = 0.1001 выходило 726 350 кПа,
  // при r̄ = 0.0999 — сразу 10 000, то есть ближе к заряду давление
  // оказывалось МЕНЬШЕ, чем дальше от него.
  // Внутри этой зоны методика параметры волны не определяет, поэтому
  // давление принимается равным значению на самой границе (плато).
  const rBar = Math.max(r_m / Math.pow(q_tnt, 1 / 3), R_BAR_MIN);
  const dP_kgf = 0.84 / rBar + 2.7 / (rBar * rBar) + 7.15 / (rBar * rBar * rBar);
  return dP_kgf * KGF_CM2_TO_KPA;
}

/** То же, округлённое до 0,1 кПа — для вывода пользователю */
function sadovskyDeltaP(r_m: number, q_tnt: number): number {
  return Math.round(sadovskyDeltaPRaw(r_m, q_tnt) * 10) / 10;
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
  // Та же граница применимости, что и у давления: 123·m^0.66/r при r → 0
  // растёт неограниченно. Внутри границы берём значение на ней (плато).
  const r = Math.max(r_m, minValidRadius(q_tnt));
  const i_Pa_s = 123 * Math.pow(q_tnt, 0.66) / r;
  return Math.round(i_Pa_s * 10) / 10;
}

/** Скорость фронта ударной волны (м/с) через давление: D = C0 * √(1 + 6/7 * ΔP/P0) */
function waveFrontSpeed(deltaP_kPa: number): number {
  return Math.round(C0 * Math.sqrt(1 + (6 / 7) * (deltaP_kPa / P0)) * 10) / 10;
}

/**
 * Опорные точки коэффициента отражения от стенок выработки.
 * Чем уже выработка, тем сильнее волна канализируется и тем выше давление.
 * Значения эмпирические, согласованы с прежними ступенями.
 */
const WALL_FACTOR_POINTS: Array<{ area: number; k: number }> = [
  { area:  5, k: 2.0 },
  { area: 15, k: 1.8 },
  { area: 30, k: 1.5 },
  { area: 50, k: 1.3 },
];

/**
 * Коэффициент отражения от стенок горной выработки — ПЛАВНЫЙ.
 *
 * Раньше коэффициент был ступенчатым (<10 → 2.0, <20 → 1.8, <40 → 1.5,
 * иначе 1.3). Из-за этого две почти одинаковые выработки попадали в разные
 * ступени: 19.9 м² давало 1.8, а 20.0 м² — уже 1.5, то есть изменение
 * сечения на 0.1 м² роняло расчётное давление на 17 % и заметно двигало
 * границы зон поражения. Теперь между опорными точками идёт линейная
 * интерполяция, за их пределами — плато.
 */
export function wallReflectionFactor(area_m2: number): number {
  const pts = WALL_FACTOR_POINTS;
  if (area_m2 <= 0) return 1.5;               // сечение не задано
  if (area_m2 <= pts[0].area) return pts[0].k; // очень узкие — плато 2.0
  const last = pts[pts.length - 1];
  if (area_m2 >= last.area) return last.k;     // широкие — плато 1.3
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (area_m2 <= b.area) {
      const t = (area_m2 - a.area) / (b.area - a.area);
      return Math.round((a.k + (b.k - a.k) * t) * 1000) / 1000;
    }
  }
  return last.k;
}

// ─── КАНАЛЬНАЯ МОДЕЛЬ РАСПРОСТРАНЕНИЯ ────────────────────────────────────────
/**
 * ПОЧЕМУ ОНА НУЖНА.
 *
 * Формула Садовского описывает СФЕРИЧЕСКИЙ разлёт в открытом воздухе: энергия
 * размазывается по поверхности шара, давление падает почти как 1/r³. В горной
 * выработке волна уже через несколько метров упирается в стенки и дальше идёт
 * по КАНАЛУ постоянного сечения: энергия в объём не рассеивается, давление
 * падает только на трении о стенки, местных сопротивлениях и делении потока
 * на сопряжениях.
 *
 * Разница не в процентах, а в порядках. Для 95 кг ТНТ в выработке 12 м²
 * сферическая модель давала границу 6 кПа на 127 м, тогда как «Аэросеть»
 * на той же сети красит ветви на километры. Прежний коэффициент
 * wallReflectionFactor этого не лечил: он умножал давление на постоянное
 * число (1.3…2.0) и не менял сам ЗАКОН затухания — на 10 м это почти
 * незаметно, а на 500 м кривая всё равно уже в нуле.
 *
 * КАК СЧИТАЕМ.
 *   1) Ближняя зона (r ≤ r_tr) — сферическая, по Садовскому. Пока фронт не
 *      заполнил сечение, волна действительно расходится шаром.
 *   2) Переход r_tr ≈ k_tr·√S — момент, когда фронт упёрся в стенки.
 *   3) Дальняя зона — канальная: ΔP(L) = ΔP(r_tr)·exp(−β·(L−r_tr)),
 *      где β = λ/(2·d_г) — погонный декремент затухания, d_г = 4S/P.
 *
 * Экспонента — это решение уравнения затухания плоской волны в трубе с
 * трением: dΔP/dx = −(λ/2d)·ΔP. Именно такой закон даёт характерную для
 * шахт дальнобойность в сотни метров и километры вместо десятков метров.
 */

/** Коэффициент перехода сфера → канал: r_tr = K_TRANSITION · √S */
const K_TRANSITION = 2.0;

/**
 * Коэффициент аэродинамического сопротивления выработки λ (безразмерный).
 * Для ударной волны он заметно выше, чем для установившегося потока:
 * шероховатость крепи, затяжка, оборудование, повороты.
 *   0.02…0.03 — гладкие бетонные стволы;
 *   0.04…0.06 — типовые выработки с арочной крепью (значение по умолчанию);
 *   0.08…0.12 — сильно загромождённые, с большой шероховатостью.
 */
export const LAMBDA_DEFAULT = 0.05;

/** Гидравлический диаметр выработки d_г = 4S/P, м */
export function hydraulicDiameter(area_m2: number, perimeter_m?: number): number {
  if (area_m2 <= 0) return 0;
  // Периметр не задан — принимаем круглое сечение: P = 2√(πS), d = 2√(S/π)
  const P = perimeter_m && perimeter_m > 0 ? perimeter_m : 2 * Math.sqrt(Math.PI * area_m2);
  return (4 * area_m2) / P;
}

/** Параметры канала для затухания волны вдоль одной выработки */
export interface ChannelParams {
  /** Сечение выработки, м² */
  area_m2: number;
  /** Периметр, м (не задан — считается как для круга) */
  perimeter_m?: number;
  /** Коэффициент сопротивления λ (не задан — LAMBDA_DEFAULT) */
  lambda?: number;
}

/**
 * Погонный декремент затухания β, 1/м: ΔP(x) = ΔP₀·exp(−β·x).
 *
 * β = λ / (2·d_г). Чем уже выработка, тем быстрее гаснет волна — это
 * ПРОТИВОПОЛОЖНО прежней логике wallReflectionFactor, где узкая выработка
 * просто усиливала давление постоянным множителем. Физически верно именно
 * так: в узком канале выше отношение периметра к площади, значит больше
 * потери на трении о стенки на каждом метре пути.
 */
export function channelDecay(ch: ChannelParams): number {
  const d = hydraulicDiameter(ch.area_m2, ch.perimeter_m);
  if (d <= 0) return 0;
  const lambda = ch.lambda && ch.lambda > 0 ? ch.lambda : LAMBDA_DEFAULT;
  return lambda / (2 * d);
}

/** Расстояние перехода от сферического разлёта к канальному, м */
export function transitionRadius(area_m2: number): number {
  if (area_m2 <= 0) return 0;
  return K_TRANSITION * Math.sqrt(area_m2);
}

/**
 * Давление во фронте на расстоянии L по ВЫРАБОТКЕ, кПа.
 *
 * Ближняя зона — Садовский (сфера), дальняя — экспоненциальное затухание
 * в канале. В точке сшивки r_tr обе ветви дают одно значение, поэтому
 * функция непрерывна и монотонно убывает.
 *
 * @param pathLoss_dB — накопленные потери на ПРЕДЫДУЩИХ участках пути
 *        (деление потока на сопряжениях, местные сопротивления), в виде
 *        безразмерного множителя ≤ 1. Для одиночной выработки равен 1.
 */
export function channelPressureAt(
  L_m: number,
  q_tnt: number,
  ch: ChannelParams,
  pathFactor = 1,
): number {
  if (q_tnt <= 0) return 0;
  const rMin = R_BAR_MIN * Math.pow(q_tnt, 1 / 3);
  const rTr  = Math.max(transitionRadius(ch.area_m2), rMin);
  const L    = Math.max(L_m, rMin);

  // Ближняя зона — чистая сфера по Садовскому
  if (L <= rTr) {
    return Math.round(sadovskyDeltaPRaw(L, q_tnt) * pathFactor * 10) / 10;
  }
  // Дальняя зона — канал: сшивка в r_tr и экспоненциальное затухание
  const dpTr = sadovskyDeltaPRaw(rTr, q_tnt);
  const beta = channelDecay(ch);
  const dp   = dpTr * Math.exp(-beta * (L - rTr));
  return Math.round(dp * pathFactor * 10) / 10;
}

/**
 * Импульс на расстоянии L по выработке, Па·с.
 * В канале импульс затухает медленнее давления (фаза сжатия растягивается),
 * поэтому берётся половинный декремент.
 */
export function channelImpulseAt(
  L_m: number,
  q_tnt: number,
  ch: ChannelParams,
  pathFactor = 1,
): number {
  if (q_tnt <= 0) return 0;
  const rMin = R_BAR_MIN * Math.pow(q_tnt, 1 / 3);
  const rTr  = Math.max(transitionRadius(ch.area_m2), rMin);
  const L    = Math.max(L_m, rMin);
  const base = 123 * Math.pow(q_tnt, 0.66);
  if (L <= rTr) {
    return Math.round((base / L) * pathFactor * 10) / 10;
  }
  const iTr  = base / rTr;
  const beta = channelDecay(ch) * 0.5;
  return Math.round(iTr * Math.exp(-beta * (L - rTr)) * pathFactor * 10) / 10;
}

/**
 * Длина пути по выработке, на которой давление падает до заданного, м.
 * Аналог radiusAtPressure, но для канальной модели.
 */
export function channelDistanceAtPressure(
  targetP_kPa: number,
  q_tnt: number,
  ch: ChannelParams,
  pathFactor = 1,
): number {
  if (targetP_kPa <= 0 || q_tnt <= 0) return 0;
  const rMin = R_BAR_MIN * Math.pow(q_tnt, 1 / 3);
  const rTr  = Math.max(transitionRadius(ch.area_m2), rMin);
  const dpTr = sadovskyDeltaPRaw(rTr, q_tnt) * pathFactor;

  // Порог достигается ещё в сферической зоне — ищем там (бинарный поиск)
  if (targetP_kPa >= dpTr) {
    let lo = rMin, hi = rTr;
    if (sadovskyDeltaPRaw(rMin, q_tnt) * pathFactor <= targetP_kPa) return Math.round(rMin);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (sadovskyDeltaPRaw(mid, q_tnt) * pathFactor > targetP_kPa) lo = mid; else hi = mid;
    }
    return Math.round((lo + hi) / 2);
  }
  // Дальняя зона — решаем экспоненту аналитически
  const beta = channelDecay(ch);
  if (beta <= 0) return Math.round(rTr);
  const L = rTr + Math.log(dpTr / targetP_kPa) / beta;
  return Math.round(L);
}

// ─── Пороги поражения (кПа) ───────────────────────────────────────────────────
/**
 * Пороги зон поражения по избыточному давлению, кПа.
 *
 * Вынесены в справочник: ряд порогов в разных документах различается.
 * По умолчанию 100 / 50 / 30 / 10 — как было исторически. В большинстве
 * отечественных таблиц поражения человека используется ряд
 * 100 / 60 / 40 / 20, поэтому предприятие может выставить свой.
 */
export interface ExplosionThresholds {
  lethal: number;   // ≥ — летальный исход
  heavy: number;    // ≥ — тяжёлые поражения
  medium: number;   // ≥ — средние поражения
  light: number;    // ≥ — лёгкие поражения
  /**
   * Граница безопасной зоны — НЕ порог классификации, а расстояние,
   * дальше которого воздействие пренебрежимо мало. По нему строится
   * внешний контур зон и предел шкалы волны. 5.99 кПа — как в «Аэросети».
   */
  safeLimit: number;
}

/** Ряд по умолчанию — исторический для этой программы */
export const DEFAULT_EXPLOSION_THRESHOLDS: ExplosionThresholds = {
  lethal: 100, heavy: 50, medium: 30, light: 10, safeLimit: 5.99,
};

/** Типовой ряд отечественных таблиц поражения человека */
export const TYPICAL_EXPLOSION_THRESHOLDS: ExplosionThresholds = {
  lethal: 100, heavy: 60, medium: 40, light: 20, safeLimit: 5.99,
};

/**
 * Приведение порогов к корректному виду: ряд должен строго убывать,
 * иначе бинарный поиск радиуса даст вложенные зоны в неверном порядке.
 */
export function normalizeThresholds(t?: Partial<ExplosionThresholds>): ExplosionThresholds {
  const d = DEFAULT_EXPLOSION_THRESHOLDS;
  const lethal = t?.lethal && t.lethal > 0 ? t.lethal : d.lethal;
  const heavy  = Math.min(t?.heavy  && t.heavy  > 0 ? t.heavy  : d.heavy,  lethal);
  const medium = Math.min(t?.medium && t.medium > 0 ? t.medium : d.medium, heavy);
  const light  = Math.min(t?.light  && t.light  > 0 ? t.light  : d.light,  medium);
  const safeLimit = Math.min(t?.safeLimit && t.safeLimit > 0 ? t.safeLimit : d.safeLimit, light);
  return { lethal, heavy, medium, light, safeLimit };
}

export function hazardLevelWith(dP: number, t: ExplosionThresholds): ExplosionZone["hazardLevel"] {
  if (dP >= t.lethal) return "lethal";
  if (dP >= t.heavy)  return "heavy";
  if (dP >= t.medium) return "medium";
  if (dP >= t.light)  return "light";
  return "safe";
}

function hazardLevel(dP: number): ExplosionZone["hazardLevel"] {
  return hazardLevelWith(dP, DEFAULT_EXPLOSION_THRESHOLDS);
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

/**
 * Результат «взрыва не было»: все параметры нулевые, зоны отсутствуют.
 *
 * Возвращается, когда заряд нулевой или смесь вне пределов взрываемости.
 * Массив zones намеренно ПУСТОЙ, а не с нулевыми радиусами: потребители
 * рисуют окружность по zones[i].radius_m, и зона радиусом 0 всё равно даёт
 * точку и строку в легенде, будто поражение есть.
 */
function emptyExplosionResult(
  th: ExplosionThresholds,
  reason: string,
  log: string[],
  warnings: string[],
): ExplosionResult {
  return {
    q_tnt_kg: 0,
    maxDeltaP_kPa: 0,
    maxImpulse_Pas: 0,
    waveFrontSpeed_ms: 0,
    minValidRadius_m: 0,
    thresholds: th,
    noExplosion: true,
    noExplosionReason: reason,
    zones: [],
    pressureAtDistance: () => 0,
    impulseAtDistance: () => 0,
    log,
    warnings,
  };
}

// ─── Главная функция расчёта ──────────────────────────────────────────────────
export function calcExplosion(params: ExplosionParams): ExplosionResult {
  const log: string[] = [];
  const warnings: string[] = [];
  // Пороги зон — из справочника; при их отсутствии берутся значения
  // по умолчанию. normalizeThresholds следит за убыванием ряда.
  const th = normalizeThresholds(params.thresholds);

  // 1. Тротиловый эквивалент
  let q_tnt = 0;
  // Причина, по которой взрыва не происходит. Заполняется ниже; если она
  // задана — расчёт прекращается и возвращается нулевой результат.
  let noExplosionReason = "";

  if (params.sourceType === "gas") {
    const gas = GAS_TYPES.find(g => g.id === params.gasId) ?? GAS_TYPES[0];
    const conc = params.gasConcentration;
    const u = concUnitLabel(gas.unit);
    // ПРОВЕРКА ВЗРЫВАЕМОСТИ — она прекращает расчёт, а не просто
    // предупреждает. Вне пределов НПВ/ВПВ смесь физически не детонирует:
    // раньше предупреждение выводилось, но энергия всё равно считалась,
    // и для 1 % метана (вдвое ниже НПВ) программа рисовала зоны поражения.
    if (conc <= 0) {
      noExplosionReason = `Концентрация ${gas.name.toLowerCase()} равна нулю — горючего нет, взрыв невозможен`;
    } else if (conc < gas.lowerLimit) {
      noExplosionReason = `Концентрация ${conc} ${u} ниже НПВ (${gas.lowerLimit} ${u}) — смесь не взрывоопасна, зоны поражения не образуются`;
    } else if (conc > gas.upperLimit) {
      noExplosionReason = `Концентрация ${conc} ${u} выше ВПВ (${gas.upperLimit} ${u}) — смесь не взрывоопасна, зоны поражения не образуются`;
    } else if (params.gasVolume_m3 <= 0) {
      noExplosionReason = "Объём взрывоопасной смеси равен нулю — взрыв невозможен";
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
    const mass = params.explosiveMass_kg;
    // Нулевая (или не заданная) масса заряда — взрывать нечего.
    if (!Number.isFinite(mass) || mass <= 0) {
      noExplosionReason = "Масса взрывчатого вещества равна нулю — взрыв невозможен";
    }
    q_tnt = massToTnt(expl, mass);
    log.push(`ВВ: ${expl.name}, масса: ${params.explosiveMass_kg} кг, Q_уд = ${expl.qSpec} кДж/кг`);
    log.push(`Тротиловый эквивалент: k = Q_уд / Q_ТНТ = ${expl.qSpec} / ${Q_TNT} = ${tntEquivalent(expl)}`);
    log.push(`Тротиловый эквивалент: Q_tnt = ${Math.round(q_tnt * 100) / 100} кг ТНТ`);
  }

  // Заряда нет ни по массе, ни по энергии — дальше считать нечего.
  // Раньше здесь подставлялось q_tnt = 0.001 кг «чтобы формулы не делились
  // на ноль», и из этой выдуманной сотой грамма вырастали настоящие зоны
  // поражения с ненулевыми радиусами. Теперь расчёт честно возвращает нули.
  if (!noExplosionReason && (!Number.isFinite(q_tnt) || q_tnt <= 0)) {
    noExplosionReason = "Тротиловый эквивалент равен нулю — взрыв невозможен";
  }

  if (noExplosionReason) {
    warnings.push(`⚠ ${noExplosionReason}`);
    log.push(`Взрыв не происходит: ${noExplosionReason.toLowerCase()}`);
    log.push("Зоны поражения не рассчитываются, радиусы приняты равными нулю");
    return emptyExplosionResult(th, noExplosionReason, log, warnings);
  }

  // Граница применимости формулы для этого заряда, м (r̄ = 1).
  // Ниже её параметры волны методикой не определяются.
  const rMinValid = minValidRadius(q_tnt);

  // 2. Модель распространения.
  // По умолчанию — КАНАЛЬНАЯ: ближняя зона сферическая (Садовский), дальняя
  // идёт по выработке с затуханием на трении. Прежний wallFactor при этом
  // НЕ применяется: он был грубой заменой канализирования постоянным
  // множителем, и вместе с канальной моделью эффект учитывался бы дважды —
  // ровно та же ошибка, из-за которой был удалён режим «ФНиП №494».
  const channelMode = params.channelMode !== false;
  const channel: ChannelParams = {
    area_m2: params.excavationArea_m2,
    perimeter_m: params.excavationPerimeter_m,
    lambda: params.channelLambda,
  };
  const wallFactor = (!channelMode && params.considerWalls)
    ? wallReflectionFactor(params.excavationArea_m2)
    : 1.0;

  const rTr  = channelMode ? Math.max(transitionRadius(channel.area_m2), rMinValid) : 0;
  const beta = channelMode ? channelDecay(channel) : 0;

  if (channelMode) {
    const dg = hydraulicDiameter(channel.area_m2, channel.perimeter_m);
    log.push(`Модель распространения: канальная (ближняя зона — Садовский, дальняя — выработка)`);
    log.push(`Сечение S = ${channel.area_m2} м², гидравлический диаметр d = ${Math.round(dg * 100) / 100} м`);
    log.push(`Коэффициент сопротивления λ = ${channel.lambda ?? LAMBDA_DEFAULT}`);
    log.push(`Переход сфера → канал: r = ${Math.round(rTr * 10) / 10} м`);
    log.push(`Погонное затухание β = λ/(2d) = ${beta.toExponential(3)} 1/м`);
  } else if (params.considerWalls) {
    log.push(`Модель распространения: сферическая, коэффициент стенок k = ${wallFactor}`);
  }

  // 3. Функции давления и импульса.
  // Обе ограничены снизу границей применимости (см. sadovskyDeltaP):
  // внутри r̄ = 1 возвращается значение на границе, а не расходящееся.
  // r = 0 (точка установки очага) — тоже максимум, а не ноль: раньше
  // ветка `r_m <= 0` давала 0 кПа, и эпицентр взрыва попадал в «безопасно».
  const pressureAtDistance = (r: number) => {
    if (channelMode) return channelPressureAt(r, q_tnt, channel);
    const dP = sadovskyDeltaP(Math.max(r, rMinValid), q_tnt);
    return Math.round(dP * wallFactor * 10) / 10;
  };

  const impulseAtDistance = (r: number) => {
    if (channelMode) return channelImpulseAt(r, q_tnt, channel);
    const i = sadovskyImpulse(Math.max(r, rMinValid), q_tnt);
    return Math.round(i * wallFactor * 10) / 10;
  };

  // 4. Максимальные параметры — на ГРАНИЦЕ ПРИМЕНИМОСТИ формулы (r̄ = 1).
  // Раньше здесь стояло r = 1 м независимо от массы заряда. Для 97 кг ТНТ
  // это r̄ = 0.22, то есть глубоко внутри зоны, где формула Садовского уже
  // не работает: получалось 74 000 кПа и скорость фронта 8 500 м/с.
  // Ближе к заряду параметры волны этой методикой не определяются.
  const rMin = rMinValid;
  const maxDeltaP = pressureAtDistance(rMin);
  const maxImpulse = impulseAtDistance(rMin);
  const waveFrontSpeed_ms = waveFrontSpeed(maxDeltaP);

  log.push("Методика: газодинамическая (Садовский), Q_тнт по Методике №415");
  log.push(`Граница применимости формулы: r̄ = 1, то есть r = ${rMin} м`);
  log.push(`Максимальное давление во фронте (r = ${rMin} м): ΔP = ${maxDeltaP} кПа`);
  log.push(`Скорость фронта: D = ${waveFrontSpeed_ms} м/с`);

  // 5. Зоны поражения — строятся из порогов справочника, а не из
  // зашитых чисел: ряд порогов в разных документах различается.
  const zoneDefs: Array<{
    name: string; level: ExplosionZone["hazardLevel"]; from: number; to: number | null; what: string;
  }> = [
    { name: "Летальная",         level: "lethal", from: th.lethal, to: null,      what: "летальный исход, полное разрушение" },
    { name: "Тяжёлые поражения", level: "heavy",  from: th.heavy,  to: th.lethal, what: "тяжёлые травмы, обрушение конструкций" },
    { name: "Средние поражения", level: "medium", from: th.medium, to: th.heavy,  what: "средние травмы, повреждение оборудования" },
    { name: "Лёгкие поражения",  level: "light",  from: th.light,  to: th.medium, what: "контузии, звуковая травма, лёгкие повреждения" },
  ];

  // Радиус зоны: в канальном режиме это ДЛИНА ПУТИ ПО ВЫРАБОТКЕ, а не
  // радиус сферы. Именно поэтому значения получаются в сотни метров —
  // волна не рассеивается в объём, а идёт по каналу.
  const zoneReach = (p: number) => channelMode
    ? channelDistanceAtPressure(p, q_tnt, channel)
    : radiusAtPressure(p, q_tnt, wallFactor);

  const zones: ExplosionZone[] = zoneDefs.map(d => {
    const r = zoneReach(d.from);
    return {
      name: d.name,
      description: `ΔP ${d.to === null ? `> ${d.from}` : `${d.from}–${d.to}`} кПа — ${d.what}`,
      radius_m: r,
      deltaP_kPa: d.from,
      impulse_Pas: impulseAtDistance(r),
      hazardLevel: d.level,
    };
  });

  const rSafe = zoneReach(th.safeLimit);
  zones.push({
    name: "Безопасная зона",
    description: `ΔP < ${th.safeLimit} кПа — незначительное воздействие`,
    radius_m: rSafe,
    deltaP_kPa: th.safeLimit,
    impulse_Pas: impulseAtDistance(rSafe),
    hazardLevel: "safe",
  });

  zones.forEach(z => {
    log.push(`${z.name}: r = ${z.radius_m} м, ΔP = ${z.deltaP_kPa} кПа`);
  });

  return {
    q_tnt_kg: Math.round(q_tnt * 100) / 100,
    maxDeltaP_kPa: maxDeltaP,
    maxImpulse_Pas: maxImpulse,
    waveFrontSpeed_ms,
    minValidRadius_m: rMin,
    thresholds: th,
    channelMode,
    transitionRadius_m: channelMode ? Math.round(rTr * 10) / 10 : undefined,
    channelDecay_per_m: channelMode ? beta : undefined,
    channel: channelMode ? channel : undefined,
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

/**
 * Зона поражения (цвет + уровень) по избыточному давлению.
 * Пороги передаются из справочника — иначе окраска схемы разошлась бы
 * с радиусами зон, посчитанными по пользовательскому ряду.
 */
export function explosionZoneColor(
  deltaP_kPa: number,
  thresholds?: ExplosionThresholds,
): { color: string; hazardLevel: ExplosionZone["hazardLevel"] } {
  const level = hazardLevelWith(deltaP_kPa, thresholds ?? DEFAULT_EXPLOSION_THRESHOLDS);
  return { color: EXPLOSION_HAZARD_COLORS[level], hazardLevel: level };
}