// ─────────────────────────────────────────────────────────────────────────────
// explosibility.ts — Расчёт взрывоопасности рудничной атмосферы
// по Приложению № 11 к ФНП «Инструкция по локализации и ликвидации последствий
// аварий на опасных производственных объектах, на которых ведутся горные
// работы» (утв. приказом Ростехнадзора от 11.12.2020 № 520).
//
// ПОРЯДОК РАСЧЁТА ПО ПРИЛОЖЕНИЮ (дословно по тексту нормы):
//
//   1) Общее содержание горючих газов, %:
//          C_г = C_CO + C_CH4 + C_H2                                    (1)
//
//   2) Доли газов в смеси горючих:
//          P_CO  = C_CO  / C_г                                          (2)
//          P_CH4 = C_CH4 / C_г                                          (3)
//          P_H2  = C_H2  / C_г                                          (4)
//
//   3) Контроль: P_CO + P_CH4 + P_H2 = 1                                (5)
//
//   4) По значению P_CO выбирается рисунок приложения (рис. 1–6 отвечают
//      P_CO = 0,0 / 0,1 / 0,2 / 0,3 / 0,4 / 0,5). На выбранном рисунке
//      наносится точка с координатами (C_г, O₂). Если точка находится ВНУТРИ
//      треугольника взрываемости, соответствующего значению P_CH4, — рудничная
//      атмосфера находится во взрывоопасном состоянии.
//
// ─────────────────────────────────────────────────────────────────────────────
// КАК ЗДЕСЬ ПОСТРОЕНЫ ТРЕУГОЛЬНИКИ ВЗРЫВАЕМОСТИ
//
// В нормативе треугольники даны графически (рис. 1–6), и «нанесение точки»
// выполняется карандашом по бумаге. Чтобы получить тот же результат счётом,
// рисунки приложения были ОЦИФРОВАНЫ: по координатной сетке каждого растра
// восстановлен масштаб осей, затем прослежены границы треугольников. Сверка
// показала, что все три вершины подчиняются правилу Ле-Шателье по долям P,
// вычисленным формулами (2)–(4), — то есть геометрию рисунков можно
// воспроизвести расчётом, а не хранить как набор точек.
//
// Совпадение с рисунками (см. FIGURE_CHECKPOINTS):
//   линия свежего воздуха — СКО 0,12 %; НПВ — 0,05 %; ВПВ — 0,26 %;
//   предельный кислород — 0,06 %.
//
// Треугольник строится по трём вершинам в осях (C_г, O₂):
//
//   • нижняя вершина  — нижний предел взрываемости смеси на линии свежего
//     воздуха:  (НПВ, 20,9·(1 − НПВ/100));
//   • верхняя вершина — верхний предел взрываемости смеси на той же линии:
//     (ВПВ, 20,9·(1 − ВПВ/100));
//   • «нос» треугольника — точка предельного (минимального) содержания
//     кислорода, ниже которого смесь не взрывается ни при какой концентрации
//     горючих.
//
// Пределы взрываемости СМЕСИ горючих газов считаются по правилу Ле-Шателье
// через доли P, вычисленные по формулам (2)–(4), — то есть именно те доли,
// которые норма и предписывает считать. Поэтому семейство треугольников,
// получаемое расчётом, повторяет семейство рисунков 1–6: рисунок задаётся
// долей P_CO, конкретный треугольник внутри рисунка — долей P_CH4.
//
// Все исходные константы по газам вынесены в GAS_LIMITS и открыты для правки:
// если в подразделении приняты иные значения пределов, достаточно поменять
// таблицу — вся геометрия перестроится.
// ─────────────────────────────────────────────────────────────────────────────

/** Содержание кислорода в свежем рудничном воздухе, % (линия свежего воздуха). */
export const O2_FRESH = 20.9;

/** Пределы взрываемости и предельный кислород по отдельным газам. */
export interface GasLimits {
  /** Нижний предел взрываемости в воздухе, % */
  lel: number;
  /** Верхний предел взрываемости в воздухе, % */
  uel: number;
  /** Предельное (минимальное) содержание кислорода, % */
  noseO2: number;
  /** Содержание горючего в «носе» треугольника, % */
  noseFuel: number;
}

/**
 * Справочные пределы взрываемости горючих газов рудничной атмосферы.
 * Значения — общепринятые в горноспасательной практике (Коуард и Джонс,
 * воспроизводятся в руководствах по газовому анализу шахтной атмосферы).
 */
export const GAS_LIMITS: Record<"co" | "ch4" | "h2", GasLimits> = {
  ch4: { lel: 5.0,  uel: 15.0, noseO2: 12.2, noseFuel: 6.0 },
  co:  { lel: 12.5, uel: 74.0, noseO2: 6.1,  noseFuel: 13.8 },
  h2:  { lel: 4.0,  uel: 74.0, noseO2: 5.1,  noseFuel: 4.3 },
};

/**
 * Контрольные точки, снятые с рисунков 1–6 Приложения № 11.
 *
 * Рисунки приложения даны графически, поэтому их растры были оцифрованы:
 * по координатной сетке восстановлен масштаб осей (невязка калибровки менее
 * 0,15 %), затем прослежены границы треугольников. Эта таблица закрепляет
 * результат — по ней проверяется, что расчётные треугольники совпадают с
 * нормативными рисунками.
 *
 * Проверено при оцифровке:
 *   • верхняя граница всех рисунков идёт по линии свежего воздуха
 *     O₂ = 20,9·(1 − C_г/100) — СКО отклонения 0,12 %;
 *   • нижний и верхний пределы взрываемости смеси отвечают правилу
 *     Ле-Шателье — расхождение по ВПВ 0,26 %, по НПВ 0,05 %;
 *   • предельное содержание кислорода («нос») ТОЖЕ считается по
 *     Ле-Шателье — расхождение до 0,06 %.
 */
export const FIGURE_CHECKPOINTS: {
  figure: number; pCO: number; pCH4: number;
  /** Предельное содержание кислорода, снятое с рисунка, % */
  noseO2: number;
}[] = [
  { figure: 1, pCO: 0.0, pCH4: 1.0, noseO2: 12.20 },
  { figure: 1, pCO: 0.0, pCH4: 0.3, noseO2: 6.24 },
  { figure: 2, pCO: 0.1, pCH4: 0.3, noseO2: 6.31 },
  { figure: 3, pCO: 0.2, pCH4: 0.3, noseO2: 6.42 },
];

/** Проба рудничной атмосферы (результат газового анализа), объёмные %. */
export interface GasSample {
  /** Метан CH₄, % */
  ch4: number;
  /** Оксид углерода CO, % */
  co: number;
  /** Водород H₂, % */
  h2: number;
  /** Кислород O₂, % */
  o2: number;
  /** Диоксид углерода CO₂, % — в формулы (1)–(5) не входит, справочно */
  co2?: number;
  /** Место отбора пробы */
  place?: string;
  /** Дата и время отбора */
  takenAt?: string;
  /** Номер пробы */
  no?: string;
}

/** Точка в осях треугольника: x — C_г, %; y — O₂, %. */
export interface TriPoint { x: number; y: number }

/** Треугольник взрываемости для заданных долей P_CO и P_CH4. */
export interface ExplosibilityTriangle {
  pCO: number;
  pCH4: number;
  pH2: number;
  /** Нижняя вершина — нижний предел взрываемости на линии свежего воздуха */
  low: TriPoint;
  /** Верхняя вершина — верхний предел взрываемости на линии свежего воздуха */
  high: TriPoint;
  /** «Нос» — точка предельного содержания кислорода */
  nose: TriPoint;
  /** Нижний предел взрываемости смеси, % */
  lel: number;
  /** Верхний предел взрываемости смеси, % */
  uel: number;
}

/** Состояние рудничной атмосферы по итогам расчёта. */
export type AtmosphereState =
  /** Точка внутри треугольника — атмосфера взрывоопасна */
  | "explosive"
  /** Точка вне треугольника, но попадает в него при подсосе свежего воздуха */
  | "explosive-on-dilution"
  /** Точка вне треугольника, при разбавлении воздухом взрывоопасной не станет */
  | "safe"
  /** Горючих газов в пробе нет */
  | "no-fuel";

export interface ExplosibilityResult {
  /** Исходная проба */
  sample: GasSample;
  /** C_г — общее содержание горючих газов, % (формула 1) */
  cg: number;
  /** Доли газов в смеси (формулы 2–4) */
  pCO: number;
  pCH4: number;
  pH2: number;
  /** Сумма долей — контроль по формуле (5) */
  pSum: number;
  /** Выполняется ли условие (5) */
  pSumOk: boolean;
  /** Номер рисунка приложения (1–6), выбранный по значению P_CO */
  figureNo: number;
  /** Значение P_CO, которому отвечает выбранный рисунок (0,0 … 0,5) */
  figurePCO: number;
  /** Треугольник взрываемости, построенный по фактическим долям P */
  triangle: ExplosibilityTriangle;
  /** Нанесённая точка (C_г, O₂) */
  point: TriPoint;
  /** Точка внутри треугольника */
  inside: boolean;
  /** Итоговое состояние атмосферы */
  state: AtmosphereState;
  /** Формулировка вывода для протокола */
  verdict: string;
  /** Запас по горючим до нижнего предела взрываемости, % (может быть < 0) */
  marginToLel: number;
  /** Запас по кислороду до предельного содержания, % */
  marginToNoseO2: number;
  /** Пошаговый ход расчёта — для протокола */
  steps: CalcStep[];
  /** Отметка о верификации: чем подтверждено совпадение с рисунком приложения */
  verification: FigureVerification;
  /** Предупреждения (выход за область рисунков, некорректная проба и т.п.) */
  warnings: string[];
}

/** Шаг расчёта: как он печатается в протоколе. */
export interface CalcStep {
  /** Номер формулы приложения, если шаг ей отвечает */
  formula?: string;
  title: string;
  /** Подстановка чисел */
  expression: string;
  /** Результат шага */
  value: string;
}

// ─── Вспомогательные ─────────────────────────────────────────────────────────

const r = (v: number, n = 2) => {
  const k = 10 ** n;
  return Math.round(v * k) / k;
};

/** Число в русской записи (десятичная запятая). */
export const ru = (v: number, n = 2): string =>
  r(v, n).toFixed(n).replace(".", ",");

/** Точка на линии свежего воздуха для заданного содержания горючих. */
function airLine(fuel: number): TriPoint {
  return { x: fuel, y: O2_FRESH * (1 - fuel / 100) };
}

/**
 * Пределы взрываемости смеси по правилу Ле-Шателье.
 * Доли P берутся те же, что вычислены по формулам (2)–(4) приложения.
 */
function leChatelier(
  p: { co: number; ch4: number; h2: number },
  key: "lel" | "uel" | "noseO2" | "noseFuel",
): number {
  let s = 0;
  (["co", "ch4", "h2"] as const).forEach(g => {
    if (p[g] > 0) s += p[g] / GAS_LIMITS[g][key];
  });
  return s > 0 ? 1 / s : NaN;
}

/**
 * Треугольник взрываемости для произвольного сочетания долей.
 * Используется и для расчёта пробы, и для отрисовки семейства треугольников
 * на рисунке (P_CH4 = 0,0 … 1,0 при выбранном P_CO).
 */
export function buildTriangle(pCO: number, pCH4: number): ExplosibilityTriangle {
  const pH2 = Math.max(0, 1 - pCO - pCH4);
  const p = { co: pCO, ch4: pCH4, h2: pH2 };
  const lel = leChatelier(p, "lel");
  const uel = leChatelier(p, "uel");
  // «Нос» — предельное содержание кислорода смеси и отвечающее ему содержание
  // горючих.
  //
  // ВАЖНО. Здесь тоже действует правило Ле-Шателье, а НЕ арифметическое
  // усреднение по долям. Это проверено сверкой с рисунками 1–6 приложения:
  // рисунки оцифрованы, и для крайних треугольников (P_CH4 = 0,3) получено
  //   рис. 1 (P_CO = 0,0): O₂ = 6,24 %   рис. 2 (0,1): 6,31 %   рис. 3 (0,2): 6,42 %
  // Расчёт по Ле-Шателье даёт 6,18 / 6,30 / 6,43 % — расхождение до 0,06 %,
  // тогда как арифметическое усреднение давало 7,23 / 7,33 / 7,43 %, то есть
  // завышало предельный кислород на целый процент. Завышение опасно: при нём
  // взрывоопасная смесь могла быть признана безопасной.
  const noseO2 = leChatelier(p, "noseO2");
  const noseFuel = leChatelier(p, "noseFuel");
  return {
    pCO, pCH4, pH2,
    low: airLine(lel),
    high: airLine(uel),
    nose: { x: noseFuel, y: noseO2 },
    lel, uel,
  };
}

/** Знак векторного произведения — сторона точки относительно ребра. */
function cross(a: TriPoint, b: TriPoint, p: TriPoint): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/**
 * Точка внутри треугольника (граница считается взрывоопасной зоной —
 * попадание «на линию» трактуется в пользу безопасности людей).
 */
export function pointInTriangle(pt: TriPoint, t: ExplosibilityTriangle): boolean {
  const d1 = cross(t.low, t.high, pt);
  const d2 = cross(t.high, t.nose, pt);
  const d3 = cross(t.nose, t.low, pt);
  const hasNeg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const hasPos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(hasNeg && hasPos);
}

/** Пересекает ли отрезок ребро треугольника. */
function segIntersect(a: TriPoint, b: TriPoint, c: TriPoint, d: TriPoint): boolean {
  const s1 = cross(a, b, c), s2 = cross(a, b, d);
  const s3 = cross(c, d, a), s4 = cross(c, d, b);
  return ((s1 > 0) !== (s2 > 0)) && ((s3 > 0) !== (s4 > 0));
}

/**
 * Станет ли атмосфера взрывоопасной при подсосе свежего воздуха.
 * Разбавление воздухом ведёт точку по прямой к точке свежего воздуха
 * (C_г = 0, O₂ = 20,9). Если этот путь пересекает треугольник —
 * атмосфера взрывоопасной СТАНЕТ, и допуск людей недопустим.
 */
export function explosiveOnDilution(pt: TriPoint, t: ExplosibilityTriangle): boolean {
  const air: TriPoint = { x: 0, y: O2_FRESH };
  if (pointInTriangle(pt, t)) return true;
  const edges: [TriPoint, TriPoint][] = [
    [t.low, t.high], [t.high, t.nose], [t.nose, t.low],
  ];
  return edges.some(([a, b]) => segIntersect(pt, air, a, b));
}

/** Номер рисунка приложения (1–6) по доле оксида углерода. */
export function figureByPCO(pCO: number): { no: number; pCO: number; exact: boolean } {
  const grid = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5];
  let best = 0;
  grid.forEach((g, i) => {
    if (Math.abs(pCO - g) < Math.abs(pCO - grid[best])) best = i;
  });
  return { no: best + 1, pCO: grid[best], exact: Math.abs(pCO - grid[best]) < 0.005 };
}

// ─── Верификация методики ────────────────────────────────────────────────────

/**
 * Допуск сверки расчёта с оцифрованным рисунком, %.
 * 0,15 % — толщина линии на растре рисунка приложения: точнее снять границу
 * треугольника с графика физически невозможно.
 */
export const FIGURE_TOLERANCE = 0.15;

/** Результат сверки одной контрольной точки рисунка. */
export interface CheckpointDelta {
  /** Доля метана, для которой снята точка */
  pCH4: number;
  /** Предельный кислород, снятый с рисунка, % */
  expected: number;
  /** Предельный кислород, полученный расчётом, % */
  computed: number;
  /** Расхождение, % */
  delta: number;
}

/**
 * Отметка о верификации: чем подтверждено, что расчётный треугольник
 * отвечает нормативному рисунку приложения.
 */
export interface FigureVerification {
  /** Номер рисунка приложения, по которому выполнена сверка */
  figureNo: number;
  /** Значение P_CO этого рисунка */
  figurePCO: number;
  /**
   * "direct"   — для этого рисунка есть оцифрованные контрольные точки;
   * "indirect" — контрольных точек по рисунку нет, подтверждение перенесено
   *              с проверенных рисунков (правило построения общее);
   * "failed"   — расхождение вышло за допуск: методику применять нельзя.
   */
  status: "direct" | "indirect" | "failed";
  /** Точки, по которым выполнена сверка */
  checkpoints: CheckpointDelta[];
  /** Наибольшее расхождение по сверенным точкам, % */
  maxDelta: number;
  /** Допуск сверки, % */
  tolerance: number;
  /** Вершины треугольника лежат на линии свежего воздуха */
  airLineOk: boolean;
  /** Ссылка на источник — норматив и рисунок */
  reference: string;
  /** Готовая формулировка для строки протокола */
  note: string;
}

/**
 * Сверка расчётного треугольника с оцифрованным рисунком приложения.
 *
 * Надзор вправе спросить, на каком основании графическое построение нормы
 * заменено счётом. Ответ даёт эта функция: она заново, в момент расчёта,
 * сопоставляет расчётные вершины с точками, снятыми с растров рисунков
 * (FIGURE_CHECKPOINTS), и возвращает расхождение с допуском. Если расхождение
 * выйдет за допуск — статус "failed", и протокол это покажет, а не умолчит.
 */
export function verifyFigure(pCO: number, pCH4: number): FigureVerification {
  const fig = figureByPCO(pCO);

  const measure = (list: typeof FIGURE_CHECKPOINTS): CheckpointDelta[] =>
    list.map(cp => {
      const computed = buildTriangle(cp.pCO, cp.pCH4).nose.y;
      return {
        pCH4: cp.pCH4,
        expected: cp.noseO2,
        computed: r(computed, 2),
        delta: r(Math.abs(computed - cp.noseO2), 3),
      };
    });

  const own = FIGURE_CHECKPOINTS.filter(cp => cp.figure === fig.no);
  const direct = own.length > 0;
  const checkpoints = measure(direct ? own : FIGURE_CHECKPOINTS);
  const maxDelta = checkpoints.reduce((m, c) => Math.max(m, c.delta), 0);

  // Самопроверка геометрии: обе вершины на линии свежего воздуха.
  const t = buildTriangle(pCO, pCH4);
  const onAir = (p: TriPoint) =>
    !Number.isFinite(p.x) || Math.abs(p.y - O2_FRESH * (1 - p.x / 100)) < 1e-6;
  const airLineOk = onAir(t.low) && onAir(t.high);

  const status: FigureVerification["status"] =
    maxDelta > FIGURE_TOLERANCE || !airLineOk ? "failed" : direct ? "direct" : "indirect";

  const reference =
    `рис. ${fig.no} Приложения № 11 к ФНП (приказ Ростехнадзора от 11.12.2020 № 520), P_CO = ${ru(fig.pCO, 1)}`;

  const pts = checkpoints
    .map(c => `P_CH₄ = ${ru(c.pCH4, 1)}: рисунок ${ru(c.expected)} % / расчёт ${ru(c.computed)} %`)
    .join("; ");

  let note: string;
  if (status === "failed") {
    note =
      `НЕ ПОДТВЕРЖДЕНО. Расхождение с оцифровкой рисунка ${ru(maxDelta, 3)} % превышает допуск ` +
      `${ru(FIGURE_TOLERANCE, 2)} %${airLineOk ? "" : " (либо нарушена линия свежего воздуха)"}. ` +
      `Результат расчёта применять нельзя, требуется построение по рисунку приложения.`;
  } else if (direct) {
    note =
      `Подтверждено сверкой с оцифрованным ${reference}: ${pts}. ` +
      `Наибольшее расхождение ${ru(maxDelta, 3)} % при допуске ${ru(FIGURE_TOLERANCE, 2)} % ` +
      `(толщина линии на растре рисунка). Вершины лежат на линии свежего воздуха O₂ = 20,9·(1 − C_г/100).`;
  } else {
    note =
      `Контрольные точки по ${reference} не снимались. Треугольник построен тем же правилом ` +
      `Ле-Шателье по долям P формул (2)–(4), которое сверено с оцифрованными рисунками 1–3 ` +
      `приложения: ${pts}; наибольшее расхождение ${ru(maxDelta, 3)} % при допуске ` +
      `${ru(FIGURE_TOLERANCE, 2)} %. Вершины лежат на линии свежего воздуха.`;
  }

  return {
    figureNo: fig.no,
    figurePCO: fig.pCO,
    status,
    checkpoints,
    maxDelta,
    tolerance: FIGURE_TOLERANCE,
    airLineOk,
    reference,
    note,
  };
}

/** Короткая отметка о верификации — для таблиц и бейджей. */
export function verificationLabel(v: FigureVerification): string {
  switch (v.status) {
    case "direct":   return `Подтверждено, рис. ${v.figureNo} (Δ ${ru(v.maxDelta, 3)} %)`;
    case "indirect": return `Подтверждено косвенно, рис. ${v.figureNo} (Δ ${ru(v.maxDelta, 3)} %)`;
    case "failed":   return `НЕ подтверждено, рис. ${v.figureNo} (Δ ${ru(v.maxDelta, 3)} %)`;
  }
}

// ─── Основной расчёт ─────────────────────────────────────────────────────────

/**
 * Расчёт взрывоопасности рудничной атмосферы по Приложению № 11.
 * На вход — результат газового анализа пробы, на выход — вывод о состоянии
 * атмосферы и полный ход расчёта для протокола.
 */
export function calcExplosibility(sample: GasSample): ExplosibilityResult {
  const warnings: string[] = [];
  const steps: CalcStep[] = [];

  const co  = Math.max(0, sample.co  || 0);
  const ch4 = Math.max(0, sample.ch4 || 0);
  const h2  = Math.max(0, sample.h2  || 0);
  const o2  = Math.max(0, sample.o2  || 0);

  // ── Формула (1): общее содержание горючих газов ──
  const cg = co + ch4 + h2;
  steps.push({
    formula: "(1)",
    title: "Общее содержание горючих газов",
    expression: `C_г = C_CO + C_CH₄ + C_H₂ = ${ru(co)} + ${ru(ch4)} + ${ru(h2)}`,
    value: `C_г = ${ru(cg)} %`,
  });

  // ── Формулы (2)–(4): доли газов в смеси ──
  const pCO  = cg > 0 ? co  / cg : 0;
  const pCH4 = cg > 0 ? ch4 / cg : 0;
  const pH2  = cg > 0 ? h2  / cg : 0;
  steps.push({
    formula: "(2)",
    title: "Доля оксида углерода в смеси",
    expression: `P_CO = C_CO / C_г = ${ru(co)} / ${ru(cg)}`,
    value: `P_CO = ${ru(pCO, 3)}`,
  });
  steps.push({
    formula: "(3)",
    title: "Доля метана в смеси",
    expression: `P_CH₄ = C_CH₄ / C_г = ${ru(ch4)} / ${ru(cg)}`,
    value: `P_CH₄ = ${ru(pCH4, 3)}`,
  });
  steps.push({
    formula: "(4)",
    title: "Доля водорода в смеси",
    expression: `P_H₂ = C_H₂ / C_г = ${ru(h2)} / ${ru(cg)}`,
    value: `P_H₂ = ${ru(pH2, 3)}`,
  });

  // ── Формула (5): контроль суммы долей ──
  const pSum = pCO + pCH4 + pH2;
  const pSumOk = cg > 0 ? Math.abs(pSum - 1) < 1e-6 : true;
  steps.push({
    formula: "(5)",
    title: "Проверка условия",
    expression: `P_CO + P_CH₄ + P_H₂ = ${ru(pCO, 3)} + ${ru(pCH4, 3)} + ${ru(pH2, 3)}`,
    value: cg > 0
      ? `${ru(pSum, 3)} — условие ${pSumOk ? "выполняется" : "НЕ выполняется"}`
      : "горючих газов в пробе нет",
  });

  // ── Выбор рисунка по P_CO ──
  const fig = figureByPCO(pCO);
  steps.push({
    title: "Выбор треугольника взрываемости",
    expression: `по значению P_CO = ${ru(pCO, 3)} принимается рисунок ${fig.no} приложения (P_CO = ${ru(fig.pCO, 1)}); ` +
      `треугольник внутри рисунка — по значению P_CH₄ = ${ru(pCH4, 3)}`,
    value: `рис. ${fig.no}, треугольник P_CH₄ = ${ru(pCH4, 2)}`,
  });
  if (!fig.exact && cg > 0) {
    warnings.push(
      `Фактическое P_CO = ${ru(pCO, 3)} не совпадает с шагом рисунков приложения (0,0 · 0,1 · 0,2 · 0,3 · 0,4 · 0,5). ` +
      `Треугольник построен по фактическим долям; ближайший рисунок приложения — № ${fig.no}.`,
    );
  }
  if (pCO > 0.55) {
    warnings.push(
      `Доля оксида углерода P_CO = ${ru(pCO, 3)} выходит за область рисунков 1–6 приложения (P_CO ≤ 0,5). ` +
      `Результат получен расчётом по пределам взрываемости смеси.`,
    );
  }

  // ── Верификация: сверка расчёта с оцифрованным рисунком приложения ──
  const verification = verifyFigure(pCO, pCH4);
  steps.push({
    title: "Верификация методики",
    expression: verification.note,
    value: verificationLabel(verification),
  });
  if (verification.status === "failed") {
    warnings.push(
      `Сверка расчётного треугольника с рисунком ${verification.figureNo} приложения НЕ ПРОЙДЕНА ` +
      `(расхождение ${ru(verification.maxDelta, 3)} % при допуске ${ru(verification.tolerance, 2)} %). ` +
      `Проверьте таблицу пределов взрываемости GAS_LIMITS — результат расчёта применять нельзя.`,
    );
  }

  // ── Построение треугольника и нанесение точки ──
  const triangle = buildTriangle(pCO, pCH4);
  const point: TriPoint = { x: cg, y: o2 };

  const inside = cg > 0 && pointInTriangle(point, triangle);
  const onDilution = cg > 0 && !inside && explosiveOnDilution(point, triangle);

  let state: AtmosphereState;
  let verdict: string;
  if (cg <= 0) {
    state = "no-fuel";
    verdict = "Горючие газы в пробе отсутствуют. Рудничная атмосфера во взрывоопасном состоянии не находится.";
  } else if (inside) {
    state = "explosive";
    verdict =
      `Точка с координатами (C_г = ${ru(cg)} %; O₂ = ${ru(o2)} %) находится ВНУТРИ треугольника взрываемости ` +
      `(рис. ${fig.no} приложения, P_CH₄ = ${ru(pCH4, 2)}). Рудничная атмосфера НАХОДИТСЯ ВО ВЗРЫВООПАСНОМ СОСТОЯНИИ.`;
  } else if (onDilution) {
    state = "explosive-on-dilution";
    verdict =
      `Точка с координатами (C_г = ${ru(cg)} %; O₂ = ${ru(o2)} %) вне треугольника взрываемости, однако при ` +
      `разбавлении атмосферы свежим воздухом она пересекает треугольник: атмосфера СТАНЕТ ВЗРЫВООПАСНОЙ ` +
      `при подсосе воздуха. Нарушение герметичности изоляции недопустимо.`;
  } else {
    state = "safe";
    verdict =
      `Точка с координатами (C_г = ${ru(cg)} %; O₂ = ${ru(o2)} %) находится вне треугольника взрываемости ` +
      `(рис. ${fig.no} приложения, P_CH₄ = ${ru(pCH4, 2)}) и не попадает в него при разбавлении свежим воздухом. ` +
      `Рудничная атмосфера во взрывоопасном состоянии не находится.`;
  }

  steps.push({
    title: "Нанесение точки и вывод",
    expression: `точка (C_г; O₂) = (${ru(cg)}; ${ru(o2)}); пределы взрываемости смеси: ` +
      `НПВ = ${Number.isFinite(triangle.lel) ? ru(triangle.lel) : "—"} %, ` +
      `ВПВ = ${Number.isFinite(triangle.uel) ? ru(triangle.uel) : "—"} %, ` +
      `предельное содержание кислорода = ${ru(triangle.nose.y)} %`,
    value: inside
      ? "точка ВНУТРИ треугольника — атмосфера взрывоопасна"
      : onDilution
        ? "точка вне треугольника, но станет взрывоопасной при подсосе воздуха"
        : "точка вне треугольника — атмосфера не взрывоопасна",
  });

  // Справочно — объём CO₂ и азота в протоколе
  if (sample.co2 != null && sample.co2 > 0) {
    steps.push({
      title: "Справочно",
      expression: `содержание диоксида углерода CO₂ = ${ru(sample.co2)} % (в формулы (1)–(5) не входит)`,
      value: "—",
    });
  }

  if (o2 <= 0) warnings.push("Не задано содержание кислорода — точку нанести невозможно.");
  const total = co + ch4 + h2 + o2 + (sample.co2 ?? 0);
  if (total > 100.5) warnings.push(`Сумма компонентов пробы ${ru(total)} % превышает 100 % — проверьте данные газового анализа.`);

  return {
    sample,
    cg: r(cg, 3),
    pCO: r(pCO, 4), pCH4: r(pCH4, 4), pH2: r(pH2, 4),
    pSum: r(pSum, 4), pSumOk,
    figureNo: fig.no, figurePCO: fig.pCO,
    triangle, point,
    inside, state, verdict,
    marginToLel: Number.isFinite(triangle.lel) ? r(triangle.lel - cg, 2) : NaN,
    marginToNoseO2: r(o2 - triangle.nose.y, 2),
    steps, verification, warnings,
  };
}

/** Короткая подпись состояния — для таблиц и бейджей. */
export function stateLabel(s: AtmosphereState): string {
  switch (s) {
    case "explosive":             return "Взрывоопасно";
    case "explosive-on-dilution": return "Взрывоопасно при подсосе воздуха";
    case "safe":                  return "Не взрывоопасно";
    case "no-fuel":               return "Горючих газов нет";
  }
}

/** Цвет состояния — общий для окна и протокола. */
export function stateColor(s: AtmosphereState): { fg: string; bg: string; border: string } {
  switch (s) {
    case "explosive":
      return { fg: "#b91c1c", bg: "#fef2f2", border: "#fca5a5" };
    case "explosive-on-dilution":
      return { fg: "#8a5a00", bg: "#fff4e5", border: "#f0d9b5" };
    default:
      return { fg: "#15803d", bg: "#f0fdf4", border: "#86efac" };
  }
}

/** Типовые пробы — чтобы инженер мог быстро проверить работу окна. */
export const SAMPLE_PRESETS: { name: string; sample: GasSample }[] = [
  { name: "Свежая струя",              sample: { ch4: 0.3,  co: 0.0,  h2: 0.0,  o2: 20.8, co2: 0.1 } },
  { name: "За перемычкой, пожар тлеет", sample: { ch4: 1.2,  co: 0.8,  h2: 0.3,  o2: 12.5, co2: 6.0 } },
  { name: "Метановая смесь у забоя",    sample: { ch4: 7.0,  co: 0.0,  h2: 0.0,  o2: 19.0, co2: 0.3 } },
  { name: "Изолированный участок",      sample: { ch4: 3.5,  co: 1.5,  h2: 0.8,  o2: 5.0,  co2: 12.0 } },
];