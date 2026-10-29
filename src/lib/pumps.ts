// ─────────────────────────────────────────────────────────────────────────────
// Каталог насосов с реальными Q–H характеристиками (напорными кривыми)
// Аппроксимация напорной характеристики: H(Q) = H0 + a·Q + b·Q²
//   Q — подача, м³/ч;  H — напор, м вод. ст.
// Источники: паспорта ЦНС (секционные), Д (Гном/двустороннего входа), К (консольные)
//
// Сам расчёт (рабочая точка, КПД, мощность, скоринг) живёт в общем ядре
// подбора — lib/selection/core.ts. Здесь остаётся каталог и тонкие обёртки,
// чтобы прежние вызовы из интерфейса продолжали работать без правок.
// ─────────────────────────────────────────────────────────────────────────────
import {
  curveHead, curveEfficiency, curvePower,
  findOperatingPoint as findPoint, scoreOperatingPoint, networkResistance,
  executionAllowed, vfdSpeedRatio, vfdPower,
  type OperatingPointBase, type EquipmentOptions, type Execution,
} from "@/lib/selection/core";

export type PumpType = "sectional" | "centrifugal" | "console" | "submersible" | "drainage";

// Поля vfd / execution / stages описаны в ядре подбора (EquipmentOptions):
// они общие для насосов и вентиляторов и участвуют в отборе моделей. Для
// секционного насоса stages — число рабочих колёс: именно им набирают напор.
export interface PumpModel extends EquipmentOptions {
  id: string;
  brand: string;
  model: string;
  type: PumpType;
  // Параметры характеристики H(Q) = H0 + a·Q + b·Q² (Q в м³/ч, H в м вод.ст.)
  H0: number;          // напор при нулевой подаче, м
  a: number;           // коэф. при Q
  b: number;           // коэф. при Q²
  // Рабочий диапазон
  Qmin: number;        // м³/ч
  Qmax: number;        // м³/ч
  Qopt: number;        // оптимальная подача, м³/ч
  // Эффективность в оптимальной точке
  etaMax: number;      // 0..1
  // Электрические/механические параметры
  power: number;       // кВт (мощность двигателя)
  rpm: number;         // об/мин
  // Габариты и масса
  weight: number;      // кг
  priceRub?: number;
  notes?: string;
  /** Точки паспортной характеристики (пользовательский насос): по ним
   *  подобраны H0, a, b. Хранятся, чтобы характеристику можно было править. */
  curvePoints?: PumpCurvePoint[];
  /** Насос добавлен пользователем (хранится в проекте). */
  isUser?: boolean;
}

// ─── Каталог моделей ────────────────────────────────────────────────────────

export const PUMP_CATALOG: PumpModel[] = [
  // ═══ ЦНС — секционные центробежные (шахтный водоотлив) ════════════════════
  {
    id: "cns_38_44",
    brand: "ЦНС", model: "ЦНС 38-44",
    type: "sectional",
    vfd: true, stages: 1, execution: "corrosion_resistant",
    H0: 52, a: 0.05, b: -0.0065,
    Qmin: 19, Qmax: 57, Qopt: 38,
    etaMax: 0.63,
    power: 11, rpm: 1450, weight: 260,
    notes: "Секционный, 1 колесо",
  },
  {
    id: "cns_38_176",
    brand: "ЦНС", model: "ЦНС 38-176",
    type: "sectional",
    vfd: true, stages: 4, execution: "corrosion_resistant",
    H0: 205, a: 0.1, b: -0.026,
    Qmin: 19, Qmax: 57, Qopt: 38,
    etaMax: 0.64,
    power: 37, rpm: 1450, weight: 480,
    notes: "Секционный, 4 колеса",
  },
  {
    id: "cns_60_165",
    brand: "ЦНС", model: "ЦНС 60-165",
    type: "sectional",
    vfd: true, stages: 3, execution: "corrosion_resistant",
    H0: 195, a: 0.05, b: -0.011,
    Qmin: 30, Qmax: 90, Qopt: 60,
    etaMax: 0.66,
    power: 55, rpm: 1450, weight: 620,
    notes: "Секционный, 3 колеса",
  },
  {
    id: "cns_105_294",
    brand: "ЦНС", model: "ЦНС 105-294",
    type: "sectional",
    vfd: true, stages: 6, execution: "corrosion_resistant",
    H0: 345, a: 0.06, b: -0.0075,
    Qmin: 52, Qmax: 160, Qopt: 105,
    etaMax: 0.7,
    power: 160, rpm: 1480, weight: 1250,
    notes: "Секционный, 6 колёс, шахтный водоотлив",
  },
  {
    id: "cns_180_425",
    brand: "ЦНС", model: "ЦНС 180-425",
    type: "sectional",
    vfd: true, stages: 5, execution: "corrosion_resistant",
    H0: 500, a: 0.05, b: -0.0038,
    Qmin: 90, Qmax: 270, Qopt: 180,
    etaMax: 0.73,
    power: 400, rpm: 1480, weight: 2400,
    notes: "Секционный, 5 колёс, главный водоотлив",
  },
  {
    id: "cns_300_360",
    brand: "ЦНС", model: "ЦНС 300-360",
    type: "sectional",
    vfd: true, execution: "corrosion_resistant",
    H0: 425, a: 0.03, b: -0.0016,
    Qmin: 150, Qmax: 450, Qopt: 300,
    etaMax: 0.75,
    power: 500, rpm: 1480, weight: 3100,
    notes: "Секционный, главный водоотлив",
  },

  // ═══ Д — центробежные двустороннего входа ════════════════════════════════
  {
    id: "d_320_50",
    brand: "Д", model: "Д 320-50",
    type: "centrifugal",
    vfd: true, stages: 1, execution: "general",
    H0: 58, a: 0.008, b: -0.00012,
    Qmin: 160, Qmax: 500, Qopt: 320,
    etaMax: 0.83,
    power: 75, rpm: 1450, weight: 560,
    notes: "Двустороннего входа",
  },
  {
    id: "d_630_90",
    brand: "Д", model: "Д 630-90",
    type: "centrifugal",
    vfd: true, stages: 1, execution: "general",
    H0: 104, a: 0.006, b: -0.00006,
    Qmin: 315, Qmax: 950, Qopt: 630,
    etaMax: 0.85,
    power: 250, rpm: 1450, weight: 1150,
    notes: "Двустороннего входа",
  },
  {
    id: "d_1250_125",
    brand: "Д", model: "Д 1250-125",
    type: "centrifugal",
    vfd: true, stages: 1, execution: "general",
    H0: 145, a: 0.004, b: -0.00002,
    Qmin: 625, Qmax: 1800, Qopt: 1250,
    etaMax: 0.87,
    power: 630, rpm: 985, weight: 2200,
    notes: "Двустороннего входа, крупный",
  },

  // ═══ К — консольные ═══════════════════════════════════════════════════════
  {
    id: "k_45_30",
    brand: "К", model: "К 45/30",
    type: "console",
    vfd: true, stages: 1, execution: "general",
    H0: 34, a: 0.02, b: -0.0028,
    Qmin: 22, Qmax: 68, Qopt: 45,
    etaMax: 0.7,
    power: 7.5, rpm: 2900, weight: 82,
    notes: "Консольный",
  },
  {
    id: "k_90_55",
    brand: "К", model: "К 90/55",
    type: "console",
    vfd: true, stages: 1, execution: "general",
    H0: 62, a: 0.015, b: -0.0014,
    Qmin: 45, Qmax: 135, Qopt: 90,
    etaMax: 0.72,
    power: 30, rpm: 2900, weight: 155,
    notes: "Консольный",
  },

  // ═══ Дренажные / погружные ════════════════════════════════════════════════
  {
    id: "gnom_100_25",
    brand: "Гном", model: "ГНОМ 100-25",
    type: "drainage",
    vfd: false, stages: 1, execution: "corrosion_resistant",
    H0: 30, a: 0.005, b: -0.0018,
    Qmin: 40, Qmax: 130, Qopt: 100,
    etaMax: 0.55,
    power: 11, rpm: 2900, weight: 62,
    notes: "Дренажный погружной, загрязнённая вода",
  },
  {
    id: "gnom_53_10",
    brand: "Гном", model: "ГНОМ 53-10",
    type: "drainage",
    vfd: false, stages: 1, execution: "corrosion_resistant",
    H0: 13, a: 0.004, b: -0.0011,
    Qmin: 25, Qmax: 75, Qopt: 53,
    etaMax: 0.5,
    power: 3, rpm: 2900, weight: 34,
    notes: "Дренажный погружной",
  },
];

// ─── Расчёт характеристик ───────────────────────────────────────────────────
//
// Формулы вынесены в общее ядро подбора (lib/selection/core.ts): тот же
// алгоритм применялся здесь и в fans.ts двумя почти дословными копиями.
// Функции ниже — тонкие обёртки, прежние вызовы работают без изменений.

// Напор насоса при заданной подаче: H(Q), м вод. ст.
export function pumpHead(pump: PumpModel, Q: number): number {
  return curveHead(pump, Q);
}

// КПД при подаче (упрощённо — парабола вокруг Qopt)
export function pumpEfficiency(pump: PumpModel, Q: number): number {
  return curveEfficiency(pump, Q);
}

// Мощность на валу при подаче Q, кВт
// P = ρ·g·Q·H / (η·3600·1000), ρ=1000 кг/м³, g=9.81
export function pumpPower(pump: PumpModel, Q: number): number {
  return curvePower(pump, Q, "pump");
}

// ─── Поиск рабочей точки: пересечение кривых насоса и сети ──────────────────
// Сеть: H_сети(Q) = Hst + S·Q²  (Hst — геометрическая высота подъёма)

/** Рабочая точка насоса. Совпадает с OperatingPointBase из ядра. */
export type PumpOperatingPoint = OperatingPointBase;

export function findPumpOperatingPoint(pump: PumpModel, networkS: number, staticHead: number, requiredQ: number, requiredH: number): PumpOperatingPoint {
  // Напор в метрах округляется до десятых, мощность — до сотых кВт:
  // шахтные насосы — это десятки и сотни киловатт.
  return findPoint(pump, "pump", {
    networkS, requiredQ, requiredH, staticHead,
    headDecimals: 1,
    powerDecimals: 2,
  });
}

// ─── Подбор подходящих насосов под систему ─────────────────────────────────

export interface PumpSelection {
  pump: PumpModel;
  point: PumpOperatingPoint;
  score: number;     // 0..100
  warnings: string[];
  /** Работа на пониженных частотником оборотах — см. FanSelection.vfd. */
  vfd?: {
    /** Доля от номинальных оборотов, 0..1. */
    speedRatio: number;
    /** Мощность на пониженных оборотах, кВт (P ~ n³). */
    power: number;
  };
}

/** Дополнительные условия отбора. Все необязательны. */
export interface PumpSelectOptions {
  /** Требуемое исполнение: модели другого исполнения отсеиваются. */
  execution?: Execution;
  /** Оставить только модели с частотным регулированием. */
  vfdOnly?: boolean;
}

/**
 * Подбор насосов под требуемые подачу и напор.
 *
 * Появился вместе с общим ядром: раньше для насосов был только расчёт рабочей
 * точки, а самого подбора не было — список моделей приходилось перебирать
 * глазами. Теперь логика ранжирования общая с вентиляторами.
 *
 * staticHead — геометрическая высота подъёма, м. Её насос обязан преодолеть
 * даже при нулевой подаче, поэтому она вычитается при расчёте сопротивления
 * сети и учитывается в кривой Hst + S·Q².
 */
export function selectPumps(
  requiredQ: number,
  requiredH: number,
  staticHead = 0,
  pumpType?: PumpType,
  options: PumpSelectOptions = {},
): PumpSelection[] {
  const S = networkResistance(requiredQ, requiredH, staticHead);

  // Исполнение — жёсткий фильтр: шахтная вода бывает кислой, и насос
  // общепромышленного исполнения на ней просто не выходит срок службы.
  const candidates = PUMP_CATALOG.filter((p) =>
    (!pumpType || p.type === pumpType) &&
    executionAllowed(p, options.execution) &&
    (!options.vfdOnly || p.vfd === true)
  );

  return candidates.map((pump) => {
    const point = findPumpOperatingPoint(pump, S, staticHead, requiredQ, requiredH);
    const { score, warnings } = scoreOperatingPoint(pump, point, "Подача");

    const selection: PumpSelection = { pump, point, score, warnings };
    if (pump.vfd && point.found && point.Q > requiredQ) {
      const speedRatio = vfdSpeedRatio(point.Q, requiredQ);
      selection.vfd = {
        speedRatio: Math.round(speedRatio * 100) / 100,
        power: Math.round(vfdPower(point.power, speedRatio) * 100) / 100,
      };
    }
    return selection;
  }).sort((a, b) => b.score - a.score);
}


export const PUMP_TYPE_NAMES: Record<PumpType, string> = {
  sectional: "Секционные (ЦНС)",
  centrifugal: "Двустороннего входа (Д)",
  console: "Консольные (К)",
  submersible: "Погружные",
  drainage: "Дренажные (Гном)",
};

export function getPumpById(id: string | undefined): PumpModel | undefined {
  if (!id) return undefined;
  return PUMP_CATALOG.find((p) => p.id === id);
}
// ─── Пользовательский насос: характеристика по точкам паспорта ─────────────

/** Точка паспортной характеристики: подача, м³/ч, и напор, м. */
export interface PumpCurvePoint { Q: number; H: number }

/**
 * Кривая H(Q) = H0 + a·Q + b·Q² по точкам паспорта (метод наименьших
 * квадратов). Нужны минимум 3 точки с разной подачей. Две точки — прямая
 * (b = 0). null — точек мало или они вырождены.
 */
export function fitPumpCurve(points: PumpCurvePoint[]): { H0: number; a: number; b: number; maxErr: number } | null {
  const pts = points.filter((p) => Number.isFinite(p.Q) && Number.isFinite(p.H) && p.Q >= 0 && p.H > 0);
  const distinct = new Set(pts.map((p) => p.Q)).size;
  if (distinct < 2) return null;
  let H0: number, a: number, b: number;
  if (distinct === 2) {
    const [p1, p2] = [...pts].sort((x, y) => x.Q - y.Q);
    a = (p2.H - p1.H) / (p2.Q - p1.Q);
    H0 = p1.H - a * p1.Q;
    b = 0;
  } else {
    // Нормальные уравнения для базиса (1, Q, Q²)
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (const { Q, H } of pts) {
      const q2 = Q * Q;
      s0 += 1; s1 += Q; s2 += q2; s3 += q2 * Q; s4 += q2 * q2;
      t0 += H; t1 += H * Q; t2 += H * q2;
    }
    const det = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const M = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]];
    const D = det(M);
    if (Math.abs(D) < 1e-12) return null;
    const col = (i: number) => M.map((row, r) => row.map((v, c) => (c === i ? [t0, t1, t2][r] : v)));
    H0 = det(col(0)) / D; a = det(col(1)) / D; b = det(col(2)) / D;
  }
  const maxErr = Math.max(...pts.map((p) => Math.abs(H0 + a * p.Q + b * p.Q * p.Q - p.H)));
  return { H0, a, b, maxErr };
}

/** Новый пользовательский насос с типовыми значениями. */
export function makeUserPump(): PumpModel {
  return {
    id: `user_pump_${Date.now()}`,
    brand: "", model: "Новый насос", type: "sectional",
    H0: 220, a: 0, b: -0.0088,
    Qmin: 50, Qmax: 150, Qopt: 100,
    etaMax: 0.7, power: 110, rpm: 1480, weight: 0,
    curvePoints: [{ Q: 0, H: 220 }, { Q: 50, H: 198 }, { Q: 100, H: 132 }, { Q: 150, H: 22 }],
    notes: "",
    isUser: true,
  };
}
