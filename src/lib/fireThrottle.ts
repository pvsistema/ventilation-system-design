// ─────────────────────────────────────────────────────────────────────────────
// fireThrottle.ts — ТЕПЛОВОЕ ДРОССЕЛИРОВАНИЕ вентиляционной сети при пожаре.
//
// ЗАЧЕМ ЭТО НУЖНО.
// При пожаре воздух нагревается и расширяется. Через ту же выработку проходит
// тот же МАССОВЫЙ расход, но объёмный вырастает пропорционально абсолютной
// температуре. Потери давления считаются по объёмному расходу (ΔP = R·Q²),
// поэтому нагретая выработка ведёт себя как СУЖЕННАЯ — сопротивление растёт.
// В горной аэрологии это называют «тепловой дроссель» (throttling effect).
//
// ПОЧЕМУ ЭТО ВАЖНО НА ПРАКТИКЕ.
// Лабораторный опыт на модели рудника (алюминиевая гофра, деревянная крепь,
// всасывающее проветривание) дал такую картину:
//
//   до пожара                     2,71   (показание анемометра)
//   сразу после возгорания        2,18   −19,6 %   ← тепловой дроссель
//   через 3–5 мин                 2,71   возврат   ← депрессия компенсировала
//   после остановки вентилятора   0,59   опрокидывание, только тяга
//
// Первая фаза без дросселя не воспроизводится В ПРИНЦИПЕ: тепловая депрессия
// в восходящей ветви при всасывающем проветривании РАЗГОНЯЕТ струю, а замер
// показал падение на 19,6 %. Значит существует встречный механизм, и это
// именно рост сопротивления от нагрева.
//
// Обратный пересчёт эксперимента:
//   R_пожар / R_исх = (2,71/2,18)² = 1,546  →  T̄ = 293 · 1,546 ≈ 453 К ≈ 180 °C
// что для очага ≈10–15 кВт в гофре Ø160 полностью реалистично.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ СЧИТАЕТСЯ, А ЧТО НЕТ
//
// Здесь НЕ трогаются ни формулы Норматива 4.5 (4.5–4.13), ни Приложение 5
// (критическая депрессия), ни расчёт тепловой депрессии. Дросселирование —
// это поправка к СОПРОТИВЛЕНИЮ ветви, то есть к тому же полю, которое инженер
// правит руками в свойствах выработки. Депрессия считается как раньше и
// складывается с дросселем в решателе сети независимо.
//
// Поправка выключаемая. При выключении расчёт даёт в точности прежние числа —
// это проверяется тестом, чтобы нормативный режим нельзя было сломать случайно.
// ─────────────────────────────────────────────────────────────────────────────

/** Абсолютный ноль в шкале Цельсия — перевод °C → K. */
const T0_K = 273.15;

/**
 * Предел роста сопротивления от нагрева.
 *
 * Отношение температур ограничиваем сверху, потому что при подстановке
 * температуры ядра пламени (1200 °C) множитель достигал бы 5, а средняя по
 * сечению температура струи всегда заметно ниже температуры пламени.
 * Значение 4,0 отвечает средней температуре струи ≈900 °C при фоновых 20 °C —
 * это верх физически осмысленного диапазона для рудничного пожара.
 */
export const THROTTLE_MAX_RATIO = 4.0;

/** Настройки дросселирования. */
export interface ThrottleOptions {
  /**
   * Учитывать тепловое дросселирование.
   * false — расчёт полностью совпадает с прежним (до введения поправки).
   */
  enabled: boolean;
  /**
   * Доля пути ветви, занятая горячими газами, 0…1.
   *
   * Ветвь очага прогрета целиком (1,0), а выработки ниже по дымовой струе —
   * настолько, насколько дым успел их заполнить. Если доля не известна,
   * берётся 1,0 для ветви очага и рассчитывается по температурам узлов для
   * остальных.
   */
  hotFraction?: number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = { enabled: true };

/**
 * Множитель сопротивления ветви от нагрева.
 *
 *     k = (T̄ + 273,15) / (t₀ + 273,15)
 *
 * где T̄ — средняя температура газа в ветви, t₀ — температура до пожара.
 *
 * ФИЗИКА. Массовый расход через выработку сохраняется, объёмный растёт как
 * V = V₀·T/T₀. Потери ΔP = R·Q² при том же массовом расходе растут в T/T₀ раз,
 * что эквивалентно росту сопротивления во столько же раз. Именно так тепловой
 * дроссель и вводится в инженерных расчётах рудничной вентиляции.
 *
 * Возвращает 1,0 (нет поправки), если данных не хватает или газ не горячее
 * фона — тогда расчёт идёт ровно как прежде.
 */
export function throttleFactor(
  meanGasTemp_C: number,
  ambientTemp_C: number,
  opts: ThrottleOptions = DEFAULT_THROTTLE,
): number {
  if (!opts.enabled) return 1;

  const tHot = Number(meanGasTemp_C);
  const t0 = Number(ambientTemp_C);
  if (!Number.isFinite(tHot) || !Number.isFinite(t0)) return 1;

  const Thot = tHot + T0_K;
  const Tamb = t0 + T0_K;
  if (!(Thot > 0) || !(Tamb > 0)) return 1;
  // Газ холоднее фона нагрузку не создаёт — сопротивление не снижаем.
  if (Thot <= Tamb) return 1;

  const ratio = Math.min(THROTTLE_MAX_RATIO, Thot / Tamb);

  // Ветвь прогрета частично: дроссель работает только на горячем участке,
  // остальная длина сохраняет исходное сопротивление.
  const f = opts.hotFraction;
  if (Number.isFinite(f as number)) {
    const frac = Math.min(1, Math.max(0, Number(f)));
    return 1 + (ratio - 1) * frac;
  }
  return ratio;
}

/** Ветвь в том виде, в каком дросселирование её видит. */
export interface ThrottleBranchLite {
  id: string;
  fromId: string;
  toId: string;
  /** Сопротивление выработки (кМюрг) — то же поле, что правится вручную. */
  resistance?: number;
  /** Признак очага пожара. */
  hasFire?: boolean;
}

/** Результат по одной ветви — для журнала расчёта и панели. */
export interface ThrottleBranchResult {
  branchId: string;
  /** Средняя температура газа в ветви, °C */
  meanTemp_C: number;
  /** Множитель сопротивления */
  factor: number;
  /** Сопротивление до поправки */
  resistanceBefore: number;
  /** Сопротивление после поправки */
  resistanceAfter: number;
}

/**
 * Применяет тепловое дросселирование к сети.
 *
 * Средняя температура ветви берётся как ПОЛУСУММА температур её узлов —
 * та же карта горячих узлов, по которой решатель считает естественную тягу.
 * Это согласует дроссель с депрессией: оба механизма опираются на одно и то же
 * температурное поле, а не на два независимых допущения.
 *
 * @param branches       ветви сети
 * @param hotNodeTemps   карта перегретых узлов (nodeId → °C) из computeHotNodeTemps
 * @param ambientTemp_C  фоновая температура
 * @param opts           настройки; при enabled=false возвращает ветви как есть
 */
export function applyFireThrottle<T extends ThrottleBranchLite>(
  branches: T[],
  hotNodeTemps: Record<string, number>,
  ambientTemp_C: number,
  opts: ThrottleOptions = DEFAULT_THROTTLE,
): { branches: T[]; applied: ThrottleBranchResult[] } {
  if (!opts.enabled) return { branches, applied: [] };

  const applied: ThrottleBranchResult[] = [];

  const out = branches.map(b => {
    const tFrom = hotNodeTemps[b.fromId];
    const tTo = hotNodeTemps[b.toId];
    // Ветвь считается прогретой, если хотя бы один её узел перегрет.
    if (!Number.isFinite(tFrom) && !Number.isFinite(tTo)) return b;

    const a = Number.isFinite(tFrom) ? Number(tFrom) : ambientTemp_C;
    const c = Number.isFinite(tTo) ? Number(tTo) : ambientTemp_C;
    const meanTemp = (a + c) / 2;

    // Прогрет только один конец — горячая примерно половина длины.
    const bothHot = Number.isFinite(tFrom) && Number.isFinite(tTo);
    const k = throttleFactor(meanTemp, ambientTemp_C, {
      ...opts,
      hotFraction: opts.hotFraction ?? (bothHot ? 1 : 0.5),
    });
    if (!(k > 1)) return b;

    const rBefore = Number(b.resistance) || 0;
    if (!(rBefore > 0)) return b;

    const rAfter = rBefore * k;
    applied.push({
      branchId: b.id,
      meanTemp_C: meanTemp,
      factor: k,
      resistanceBefore: rBefore,
      resistanceAfter: rAfter,
    });
    return { ...b, resistance: rAfter };
  });

  return { branches: out, applied };
}

/**
 * Оценка средней температуры струи по замеренному падению расхода.
 *
 * Обратная задача к дросселю — нужна для сверки расчёта с экспериментом:
 * по двум замерам расхода (до пожара и при пожаре) даёт температуру, которая
 * объясняет наблюдаемое падение.
 *
 *     R_пожар/R_исх = (Q_исх/Q_пожар)²  →  T̄ = T₀·(Q_исх/Q_пожар)² − 273,15
 *
 * Именно так из лабораторных 2,71 → 2,18 получены 180 °C.
 */
export function meanTempFromFlowDrop(
  flowBefore: number,
  flowDuring: number,
  ambientTemp_C: number,
): number | null {
  const q0 = Math.abs(Number(flowBefore));
  const q1 = Math.abs(Number(flowDuring));
  if (!(q0 > 0) || !(q1 > 0)) return null;
  const ratio = (q0 / q1) ** 2;
  const T = (ambientTemp_C + T0_K) * ratio - T0_K;
  return Number.isFinite(T) ? T : null;
}

/**
 * Оценка мощности очага по падению расхода (для сверки с замерами).
 *
 *     P = ṁ·cp·ΔT = ρ·Q·cp·(T̄ − t₀)
 *
 * Возвращает мощность в кВт: лабораторные очаги измеряются киловаттами, и
 * округление до МВт съело бы весь результат.
 */
export function firePowerFromFlowDrop(
  flowBefore: number,
  flowDuring: number,
  ambientTemp_C: number,
  /** Фактический объёмный расход при пожаре, м³/с */
  actualFlow_m3s: number,
): number | null {
  const T = meanTempFromFlowDrop(flowBefore, flowDuring, ambientTemp_C);
  if (T == null) return null;
  const dT = T - ambientTemp_C;
  if (!(dT > 0) || !(actualFlow_m3s > 0)) return null;
  // ρ = 1,25 кг/м³ и cp = 1005 Дж/(кг·К) — те же, что в calcFireTemp,
  // иначе прямая и обратная задачи разошлись бы между собой.
  const massFlow = 1.25 * actualFlow_m3s;
  return (massFlow * 1005 * dT) / 1000;
}
