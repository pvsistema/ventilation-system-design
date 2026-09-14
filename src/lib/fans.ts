// ─────────────────────────────────────────────────────────────────────────────
// Каталог вентиляторов с реальными Q–H характеристиками
// Аппроксимация: H(Q) = H0 + a·Q + b·Q²
// Источники: VEZA, Systemair, Korf, Ровен
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

export type FanType = "axial" | "centrifugal_forward" | "centrifugal_backward" | "roof" | "duct";

// Поля vfd / execution / stages описаны в ядре подбора (EquipmentOptions):
// они общие для вентиляторов и насосов и участвуют в отборе моделей.
export interface FanModel extends EquipmentOptions {
  id: string;
  brand: string;
  model: string;
  type: FanType;
  // Параметры характеристики H(Q) = H0 + a·Q + b·Q² (Q в м³/ч, H в Па)
  H0: number;          // напор при нулевом расходе, Па
  a: number;           // коэф. при Q
  b: number;           // коэф. при Q²
  // Рабочий диапазон
  Qmin: number;        // м³/ч
  Qmax: number;        // м³/ч
  Qopt: number;        // оптимальный расход, м³/ч
  // Эффективность в оптимальной точке
  etaMax: number;      // 0..1
  // Электрические параметры
  power: number;       // кВт
  voltage: number;     // В
  current: number;     // А
  rpm: number;         // об/мин
  // Габариты
  dimensions: { length: number; width: number; height: number }; // мм
  weight: number;      // кг
  // Шум
  noise: number;       // дБА на 1м
  // Цена и связи
  priceRub?: number;
  notes?: string;
}

// ─── Каталог моделей ────────────────────────────────────────────────────────

export const FAN_CATALOG: FanModel[] = [
  // ═══ Канальные центробежные ═══════════════════════════════════════════
  {
    id: "vents_vkmsq_100",
    brand: "VENTS", model: "ВКМС 100",
    type: "duct",
    vfd: false, execution: "general",
    H0: 280, a: 0.15, b: -0.0008,
    Qmin: 50, Qmax: 350, Qopt: 200,
    etaMax: 0.62,
    power: 0.082, voltage: 230, current: 0.36, rpm: 2700,
    dimensions: { length: 250, width: 250, height: 250 }, weight: 4.2,
    noise: 38, priceRub: 8500,
  },
  {
    id: "vents_vkmsq_125",
    brand: "VENTS", model: "ВКМС 125",
    type: "duct",
    vfd: false, execution: "general",
    H0: 350, a: 0.12, b: -0.0005,
    Qmin: 80, Qmax: 480, Qopt: 280,
    etaMax: 0.65,
    power: 0.105, voltage: 230, current: 0.46, rpm: 2650,
    dimensions: { length: 280, width: 280, height: 280 }, weight: 4.8,
    noise: 41, priceRub: 9800,
  },
  {
    id: "vents_vkmsq_160",
    brand: "VENTS", model: "ВКМС 160",
    type: "duct",
    vfd: false, execution: "general",
    H0: 420, a: 0.08, b: -0.00025,
    Qmin: 150, Qmax: 750, Qopt: 450,
    etaMax: 0.68,
    power: 0.165, voltage: 230, current: 0.74, rpm: 2550,
    dimensions: { length: 320, width: 320, height: 320 }, weight: 6.5,
    noise: 44, priceRub: 13200,
  },
  {
    id: "vents_vkmsq_200",
    brand: "VENTS", model: "ВКМС 200",
    type: "duct",
    vfd: false, execution: "general",
    H0: 510, a: 0.05, b: -0.00012,
    Qmin: 250, Qmax: 1200, Qopt: 700,
    etaMax: 0.71,
    power: 0.250, voltage: 230, current: 1.10, rpm: 2480,
    dimensions: { length: 380, width: 380, height: 380 }, weight: 9.2,
    noise: 47, priceRub: 17500,
  },
  {
    id: "vents_vkmsq_250",
    brand: "VENTS", model: "ВКМС 250",
    type: "duct",
    vfd: false, execution: "general",
    H0: 640, a: 0.04, b: -0.00006,
    Qmin: 400, Qmax: 1900, Qopt: 1100,
    etaMax: 0.73,
    power: 0.380, voltage: 230, current: 1.65, rpm: 2400,
    dimensions: { length: 440, width: 440, height: 440 }, weight: 13,
    noise: 51, priceRub: 24800,
  },
  {
    id: "vents_vkmsq_315",
    brand: "VENTS", model: "ВКМС 315",
    type: "duct",
    vfd: false, execution: "general",
    H0: 780, a: 0.025, b: -0.00003,
    Qmin: 600, Qmax: 2800, Qopt: 1700,
    etaMax: 0.75,
    power: 0.620, voltage: 230, current: 2.70, rpm: 2380,
    dimensions: { length: 520, width: 520, height: 520 }, weight: 18,
    noise: 54, priceRub: 36500,
  },

  // ═══ Центробежные с лопатками назад (более тихие, эффективные) ═══════
  {
    id: "veza_vrn_4",
    brand: "VEZA", model: "ВРН №4 (лопатки назад)",
    type: "centrifugal_backward",
    vfd: true, execution: "general",
    H0: 850, a: 0.06, b: -0.00008,
    Qmin: 800, Qmax: 4500, Qopt: 2700,
    etaMax: 0.78,
    power: 1.5, voltage: 380, current: 3.2, rpm: 1450,
    dimensions: { length: 720, width: 580, height: 620 }, weight: 65,
    noise: 62, priceRub: 78000,
  },
  {
    id: "veza_vrn_5",
    brand: "VEZA", model: "ВРН №5 (лопатки назад)",
    type: "centrifugal_backward",
    vfd: true, execution: "general",
    H0: 1100, a: 0.04, b: -0.000035,
    Qmin: 1500, Qmax: 7500, Qopt: 4500,
    etaMax: 0.80,
    power: 3.0, voltage: 380, current: 6.4, rpm: 1450,
    dimensions: { length: 850, width: 700, height: 760 }, weight: 105,
    noise: 66, priceRub: 124000,
  },
  {
    id: "veza_vrn_6_3",
    brand: "VEZA", model: "ВРН №6.3 (лопатки назад)",
    type: "centrifugal_backward",
    vfd: true, execution: "general",
    H0: 1450, a: 0.025, b: -0.000015,
    Qmin: 2500, Qmax: 12000, Qopt: 7200,
    etaMax: 0.82,
    power: 5.5, voltage: 380, current: 11.5, rpm: 1460,
    dimensions: { length: 980, width: 850, height: 920 }, weight: 165,
    noise: 70, priceRub: 198000,
  },

  // ═══ Центробежные вперёд-загнутые (компактные) ═══════════════════════
  {
    id: "korf_radial_2",
    brand: "Korf", model: "VR-280-127 №2",
    type: "centrifugal_forward",
    vfd: false, execution: "general",
    H0: 380, a: 0.18, b: -0.0006,
    Qmin: 200, Qmax: 1400, Qopt: 800,
    etaMax: 0.58,
    power: 0.55, voltage: 230, current: 2.5, rpm: 1380,
    dimensions: { length: 480, width: 420, height: 410 }, weight: 22,
    noise: 56, priceRub: 31500,
  },
  {
    id: "korf_radial_3",
    brand: "Korf", model: "VR-280-127 №3",
    type: "centrifugal_forward",
    vfd: true, execution: "general",
    H0: 580, a: 0.10, b: -0.00018,
    Qmin: 400, Qmax: 2400, Qopt: 1400,
    etaMax: 0.62,
    power: 1.1, voltage: 380, current: 2.5, rpm: 1420,
    dimensions: { length: 600, width: 520, height: 510 }, weight: 38,
    noise: 60, priceRub: 48000,
  },

  // ═══ Осевые (большие расходы, низкие давления) ════════════════════════
  {
    id: "vents_om_300",
    brand: "VENTS", model: "ОВ 300",
    type: "axial",
    vfd: false, execution: "general",
    H0: 180, a: 0.04, b: -0.00004,
    Qmin: 800, Qmax: 3500, Qopt: 2200,
    etaMax: 0.55,
    power: 0.180, voltage: 230, current: 0.82, rpm: 1380,
    dimensions: { length: 350, width: 350, height: 200 }, weight: 8.5,
    noise: 58, priceRub: 14500,
  },
  {
    id: "vents_om_400",
    brand: "VENTS", model: "ОВ 400",
    type: "axial",
    vfd: false, execution: "general",
    H0: 240, a: 0.025, b: -0.000018,
    Qmin: 1500, Qmax: 6500, Qopt: 4000,
    etaMax: 0.58,
    power: 0.380, voltage: 230, current: 1.65, rpm: 1380,
    dimensions: { length: 450, width: 450, height: 240 }, weight: 14,
    noise: 64, priceRub: 22000,
  },

  // ═══ Крышные (вытяжка из помещений) ═══════════════════════════════════
  {
    id: "rovin_kvm_3",
    brand: "Ровен", model: "КРОМ-3",
    type: "roof",
    vfd: false, execution: "general",
    H0: 320, a: 0.05, b: -0.00007,
    Qmin: 600, Qmax: 3200, Qopt: 1900,
    etaMax: 0.62,
    power: 0.55, voltage: 230, current: 2.5, rpm: 1420,
    dimensions: { length: 700, width: 700, height: 580 }, weight: 38,
    noise: 55, priceRub: 42000,
  },
  {
    id: "rovin_kvm_5",
    brand: "Ровен", model: "КРОМ-5",
    type: "roof",
    vfd: true, execution: "heat_resistant",
    H0: 480, a: 0.025, b: -0.000018,
    Qmin: 1500, Qmax: 7500, Qopt: 4500,
    etaMax: 0.68,
    power: 1.5, voltage: 380, current: 3.2, rpm: 1450,
    dimensions: { length: 900, width: 900, height: 760 }, weight: 78,
    noise: 64, priceRub: 87000,
  },
];

// ─── Расчёт характеристик ───────────────────────────────────────────────────
//
// Формулы вынесены в общее ядро подбора (lib/selection/core.ts): тот же
// алгоритм применялся здесь и в pumps.ts двумя почти дословными копиями.
// Функции ниже сохранены как тонкие обёртки — внешний код (FanSelector,
// Index, схема) продолжает работать без изменений.

// Напор вентилятора при заданном расходе: H(Q)
export function fanPressure(fan: FanModel, Q: number): number {
  return curveHead(fan, Q);
}

// КПД при расходе (упрощённо — парабола вокруг Qopt)
export function fanEfficiency(fan: FanModel, Q: number): number {
  return curveEfficiency(fan, Q);
}

// Потребляемая мощность на валу при работе в точке Q
export function fanPower(fan: FanModel, Q: number): number {
  return curvePower(fan, Q, "fan");
}

// ─── Поиск рабочей точки: пересечение кривых вентилятора и сети ─────────────
// Сеть: H_сети(Q) = S·Q²,  где S — приведённое сопротивление сети
// Решаем: H_fan(Q) = S·Q²

/** Рабочая точка вентилятора. Совпадает с OperatingPointBase из ядра. */
export type OperatingPoint = OperatingPointBase;

export function findOperatingPoint(fan: FanModel, networkS: number, requiredQ: number, requiredH: number): OperatingPoint {
  // Напор в Па округляется до целых, мощность — до тысячных кВт:
  // канальные вентиляторы потребляют десятые доли киловатта.
  return findPoint(fan, "fan", {
    networkS, requiredQ, requiredH,
    headDecimals: 0,
    powerDecimals: 3,
  });
}

// ─── Подбор подходящих вентиляторов под систему ─────────────────────────────

export interface FanSelection {
  fan: FanModel;
  point: OperatingPoint;
  score: number;     // 0..100, чем выше — тем лучше
  warnings: string[];
  /**
   * Работа с пониженными частотником оборотами — только у моделей с ЧРП,
   * и только когда подача избыточна и её есть смысл убирать.
   */
  vfd?: {
    /** Доля от номинальных оборотов, 0..1. */
    speedRatio: number;
    /** Мощность на пониженных оборотах, кВт (P ~ n³). */
    power: number;
  };
}

/** Дополнительные условия отбора. Все необязательны. */
export interface FanSelectOptions {
  /** Требуемое исполнение: модели другого исполнения отсеиваются. */
  execution?: Execution;
  /** Оставить только модели с частотным регулированием. */
  vfdOnly?: boolean;
}

export function selectFans(
  requiredQ: number,
  requiredH: number,
  fanType?: FanType,
  options: FanSelectOptions = {},
): FanSelection[] {
  // S системы: H = S·Q²  →  S = H / Q²
  const S = networkResistance(requiredQ, requiredH);

  // Исполнение — жёсткий фильтр, а не штраф: вентилятор общепромышленного
  // исполнения в газовой шахте не поставить ни при какой рабочей точке.
  const candidates = FAN_CATALOG.filter((f) =>
    (!fanType || f.type === fanType) &&
    executionAllowed(f, options.execution) &&
    (!options.vfdOnly || f.vfd === true)
  );

  return candidates.map((fan) => {
    const point = findOperatingPoint(fan, S, requiredQ, requiredH);
    const { score, warnings } = scoreOperatingPoint(fan, point, "Расход");

    // Избыток подачи у машины с ЧРП: показываем, на каких оборотах она сядет
    // на требуемый расход и сколько при этом будет потреблять.
    const selection: FanSelection = { fan, point, score, warnings };
    if (fan.vfd && point.found && point.Q > requiredQ) {
      const speedRatio = vfdSpeedRatio(point.Q, requiredQ);
      selection.vfd = {
        speedRatio: Math.round(speedRatio * 100) / 100,
        power: Math.round(vfdPower(point.power, speedRatio) * 1000) / 1000,
      };
    }
    return selection;
  }).sort((a, b) => b.score - a.score);
}

export const FAN_TYPE_NAMES: Record<FanType, string> = {
  axial: "Осевые",
  centrifugal_forward: "Радиальные (вперёд)",
  centrifugal_backward: "Радиальные (назад)",
  roof: "Крышные",
  duct: "Канальные",
};