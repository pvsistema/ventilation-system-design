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
// треугольник строится по своему классическому определению — по трём вершинам
// в осях (C_г, O₂):
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
function leChatelier(p: { co: number; ch4: number; h2: number }, key: "lel" | "uel"): number {
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
  // «Нос» — предельный кислород смеси и отвечающее ему содержание горючих.
  // Складываются по долям компонентов: смесь беднее кислородом ровно в той
  // мере, в какой в ней присутствует каждый горючий газ.
  const noseO2 =
    p.co * GAS_LIMITS.co.noseO2 + p.ch4 * GAS_LIMITS.ch4.noseO2 + p.h2 * GAS_LIMITS.h2.noseO2;
  const noseFuel =
    p.co * GAS_LIMITS.co.noseFuel + p.ch4 * GAS_LIMITS.ch4.noseFuel + p.h2 * GAS_LIMITS.h2.noseFuel;
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
    steps, warnings,
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
