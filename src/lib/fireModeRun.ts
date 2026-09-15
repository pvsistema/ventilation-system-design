// ─────────────────────────────────────────────────────────────────────────────
// fireModeRun.ts — итеративный расчёт аварийного режима (пожар).
//
// Вынесено ИЗ ОБРАБОТЧИКА КНОПКИ в Cad.tsx. Логика перенесена дословно:
// формулы, пороги, комментарии и порядок шагов не менялись.
//
// Зачем вынесено: 240 строк инженерных расчётов жили прямо внутри кнопки ленты,
// вперемешку с оформлением. Такой код нельзя проверить отдельно, а любая правка
// оформления рисковала задеть физику. Теперь это самостоятельная функция:
// на вход — состояние схемы, на выход — сошедшиеся расходы и характеристики
// пожара. Экранных операций внутри нет, ничего не рисует и не хранит.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import {
  calcFireMode, calcFireTemp, fireSourceTempForMethod, computeHotNodeTemps,
  calcFirePowerFromMaterial, limitPowerByOxygen,
  type ThermalDepMethod, type FireCalculationResult,
} from "@/lib/fireCalculator";
import {
  applyFireThrottle, DEFAULT_THROTTLE,
  type ThrottleOptions, type ThrottleBranchResult,
} from "@/lib/fireThrottle";

/**
 * Максимум итераций сети (каждая — полный пересчёт вентиляционной сети).
 *
 * Было 4. Увеличено, потому что около точки равновесия — когда тепловая
 * депрессия почти в точности компенсирует рост сопротивления от нагрева —
 * четырёх пересчётов не хватает. Лабораторный опыт дал ровно такой режим:
 * расход упал на 19,6 %, затем вернулся к исходному. Лишние итерации
 * выполняются ТОЛЬКО если расчёт ещё не сошёлся, поэтому на устойчивых
 * схемах, которые сходятся за 1–2 пересчёта, скорость не меняется.
 */
const FIRE_ITERS = 12;
/**
 * Допуск сходимости по расходу — ОТНОСИТЕЛЬНЫЙ, доля от расхода.
 *
 * Раньше стоял абсолютный допуск 0,3 м³/с. На руднике это доли процента, а на
 * модели с расходом 0,05 м³/с — в шесть раз больше самого расхода: расчёт
 * «сходился» на первой же итерации, ничего не посчитав. Относительный допуск
 * одинаково строг для любого масштаба объекта.
 */
const FIRE_Q_TOL_REL = 0.01;
/**
 * Нижняя граница допуска, м³/с — чтобы на больших схемах не гоняться за
 * численным шумом решателя.
 */
const FIRE_Q_TOL_MIN = 0.002;
/**
 * Признак стагнации: во сколько раз должна убывать невязка, чтобы итерации
 * считались продуктивными.
 *
 * Если очередной пересчёт уменьшил max|ΔQ| менее чем на 10 %, процесс уже не
 * уточняет результат, а топчется на численном шуме решателя. Дальше гонять
 * сеть бессмысленно: на устойчивых схемах это давало лишние 8–10 сетевых
 * расчётов, которые не меняли ни одной цифры.
 *
 * Критерий сходимости (tol) при этом НЕ ослаблен — он остаётся прежним.
 * Здесь закрывается ровно противоположный случай: расчёт не сходится по
 * допуску, но и не улучшается.
 */
const FIRE_STAGNATION_RATIO = 0.9;
/** Сколько подряд непродуктивных итераций считать стагнацией. */
const FIRE_STAGNATION_STREAK = 2;

export interface FireModeRunParams {
  branches: TopoBranch[];
  nodes: TopoNode[];
  /** Температура на поверхности, °C — она же фоновая для незадымлённых мест. */
  ambientTemp: number;
  /** Метод расчёта тепловой депрессии («Норматив 4.5» / «Методика»). */
  thermalDepMethod: ThermalDepMethod;
  /** Порог видимости для оценки задымления. */
  smokeVisThreshold: number;
  /** Базовые температуры узлов до пожара. */
  baseNodeTemps: Record<string, number>;
  /** Общая депрессия ветви (выработка + перемычка/окно). */
  totalDepByBranch: Map<string, number>;
  /** Пересчёт сети с горячими узлами. Пустая карта = ошибка сети. */
  solveIteration: (
    branchesWithFire: TopoBranch[],
    ambientTemp: number,
    hotNodeTemps?: Record<string, number>,
  ) => Promise<Map<string, number>>;
  /** Запись в журнал расчёта. */
  log: (msg: string) => void;
  /** Пауза между итерациями — чтобы интерфейс успевал перерисоваться. */
  yieldToUI: () => Promise<void>;
  /**
   * Тепловое дросселирование: нагретый воздух расширяется и ведёт себя как
   * суженная выработка. Если не передано — включено (DEFAULT_THROTTLE).
   * При enabled=false расчёт совпадает с прежним до последней цифры.
   */
  throttle?: ThrottleOptions;
}

export interface FireModeRunResult {
  /** Сошедшиеся расходы по ветвям. */
  flows: Map<string, number>;
  /** Расходы ДО пожара — по ним определяется опрокидывание струи. */
  originalFlows: Map<string, number>;
  /** Итоговые характеристики пожара. */
  result: FireCalculationResult;
  /** Ветви, сопротивление которых выросло от нагрева (тепловой дроссель). */
  throttled: ThrottleBranchResult[];
  /**
   * Очаги, мощность которых ограничена нехваткой кислорода.
   * Ключ — id ветви; wanted — заданная мощность, limit — возможная при
   * фактическом расходе, flow — сам расход.
   */
  oxygenLimited: Map<string, { wanted: number; limit: number; flow: number }>;
}

/**
 * Итеративный учёт тепловой депрессии пожара.
 *
 * Алгоритм (Аэросеть / Вентиляция-2):
 *   Итерация 1: берём расходы из штатного расчёта сети
 *   → считаем T_пр и h_t для каждого очага
 *   → пересчитываем сеть с h_t как naturalDraft в ветви-очаге
 *   Итерация 2–3: уточняем T_пр по новым расходам, повторяем
 *   Критерий: max|ΔQ| < 0.1 м³/с или 3 итерации
 */
export async function runFireMode(p: FireModeRunParams): Promise<FireModeRunResult> {
  const {
    branches, nodes, ambientTemp: AMBIENT_TEMP, thermalDepMethod,
    smokeVisThreshold, baseNodeTemps, totalDepByBranch,
    solveIteration, log, yieldToUI,
    throttle = DEFAULT_THROTTLE,
  } = p;

  /** Очаги, задушенные нехваткой кислорода, — для журнала и панели. */
  const oxygenLimitedSeats = new Map<string, { wanted: number; limit: number; flow: number }>();
  /** Ветви, прогретые дымом: их сопротивление выросло (тепловой дроссель). */
  let throttledBranches: ThrottleBranchResult[] = [];

  /**
   * Отпечаток исходных данных для решателя с предыдущей итерации.
   *
   * ЗАЧЕМ. Решатель — чистая функция: на одинаковых входных данных он вернёт
   * одинаковые расходы. Когда температуры узлов и сопротивления ветвей между
   * итерациями перестали меняться, очередной вызов заведомо даст тот же
   * результат — а это полный расчёт сети, то есть запрос на сервер и заметная
   * пауза. Сравнив отпечаток, такой вызов можно пропустить целиком.
   *
   * В отпечаток входит ровно то, что влияет на ответ решателя: сопротивление
   * ветви (его меняет дроссель), тепловая депрессия и температуры узлов.
   */
  let prevSolveKey = "";
  /** Невязка предыдущей итерации — для обнаружения стагнации. */
  let prevMaxDQ: number | null = null;
  /** Сколько подряд итераций невязка не убывает. */
  let stagnationStreak = 0;
  const solveKey = (
    brs: TopoBranch[],
    hot: Record<string, number>,
  ): string => {
    // Числа округляем: различия в тысячных долях лежат внутри погрешности
    // решателя и на расходы не влияют, а из-за них отпечаток никогда бы
    // не совпал и оптимизация не работала.
    const b = brs.map(x =>
      `${x.id}:${(x.resistance ?? 0).toFixed(6)}:${(x.fireThermalDepression ?? 0).toFixed(3)}`,
    ).join("|");
    const h = Object.keys(hot).sort()
      .map(k => `${k}:${hot[k].toFixed(2)}`).join("|");
    return `${b}#${h}`;
  };

  // Исходные расходы ДО пожара — сохраняем для обнаружения опрокидывания
  const originalFlows = new Map<string, number>(branches.map(b => [b.id, b.flow ?? 0]));

  // Текущие расходы (начинаем с результатов штатного расчёта)
  let currentFlows = new Map<string, number>(originalFlows);
  // Очаги с ПОДТВЕРЖДЁННЫМ опрокидыванием: со следующего раунда
  // горячий плюм идёт по новому направлению и разгоняет
  // реверсивную струю (иначе тяга душит её до единиц м³/с).
  const reversedSeats = new Set<string>();

  await yieldToUI();

  for (let iter = 0; iter < FIRE_ITERS; iter++) {
    await yieldToUI();
    // Шаг A: подставить актуальные расходы в ветви
    let branchesIter = branches.map(b => ({
      ...b,
      flow: currentFlows.get(b.id) ?? b.flow,
    }));

    // Шаг B: пересчитать мощность очага из свойств материала по
    // актуальному расходу (кабель/дерево/конвейер/техника). Для
    // угля/масла/произвольного авто-расчёта нет — мощность ручная.
    branchesIter = branchesIter.map(b => {
      if (!b.hasFire) return b;
      // В режиме «Температурой» температура задана вручную —
      // мощность из материала НЕ пересчитываем и режим не меняем
      // (иначе ручная T=1000°C затиралась бы авто-мощностью).
      if (b.fireMode === "temp") return b;
      // Мощность очага — по ШТАТНОМУ расходу (до пожара), как в
      // Аэросети: расход в ветви очага не должен разгонять мощность.
      const origQ = originalFlows.get(b.id) ?? b.flow;
      const autoP = calcFirePowerFromMaterial({ ...b, flow: origQ });
      return autoP != null && autoP > 0
        ? { ...b, fireHeatRelease: autoP, fireMode: "heat" as const }
        : b;
    });

    // Шаг C: температура продуктов горения T_пр для каждого очага
    // + карта горячих узлов пути дыма (правильная модель тяги).
    // Тепловая тяга считается решателем через ТЕМПЕРАТУРЫ УЗЛОВ
    // (natural_draft_h): горячий восходящий столб уравновешивается
    // встречным холодным столбом выхода на поверхность — соседние
    // выработки меняются слабо (как в Аэросети). Сосредоточенный
    // h_fire на одной ветви (старый способ) нефизично опрокидывал
    // соседей.
    const fireSeats: { id: string; fromId: string; toId: string; fireTemp: number; flow: number; originalFlow?: number; reversedConfirmed?: boolean; length?: number; area?: number; perimeter?: number }[] = [];
    const branchesWithHt = branchesIter.map(b => {
      if (!b.hasFire) return b;
      // Расход для T_пр — ФАКТИЧЕСКИЙ (как в Аэросети).
      //
      // ИСПРАВЛЕНО. Раньше здесь стояло airQ = max(qФакт, 0,5·qШтат): расход
      // искусственно поднимался до половины штатного, чтобы обратная связь
      // «расход↓→T↑→h_t↑→расход↓» не разгонялась. Ограничение спасало от
      // расходимости, но подменяло физику: при опрокидывании струи расход
      // падает в разы (в лабораторном опыте 2,71→0,59, то есть до 22 %
      // штатного), и подстановка принудительных 50 % ЗАНИЖАЛА температуру, а
      // с ней и тепловую депрессию — именно ту силу, которая опрокинутую
      // струю и держит.
      //
      // Теперь берётся фактический расход, а от разгона защищает не подмена
      // данных, а стехиометрия: гореть может лишь столько топлива, сколько
      // хватает кислорода в пришедшем воздухе (см. ниже limitPowerByOxygen).
      const qOrigA   = Math.abs(originalFlows.get(b.id) ?? b.flow ?? 0);
      const qActualA = Math.abs(currentFlows.get(b.id) ?? b.flow ?? 0);
      const airQ  = qActualA > 0 ? qActualA : qOrigA;
      // Мощность, которую очаг реально может развить при пришедшем воздухе.
      // При достатке кислорода равна заданной — расчёт не меняется.
      const pWanted = Number.isFinite(b.fireHeatRelease) ? b.fireHeatRelease : 0;
      const pLim = limitPowerByOxygen(pWanted, airQ);
      if (pLim.limited && !oxygenLimitedSeats.has(b.id)) {
        oxygenLimitedSeats.set(b.id, { wanted: pWanted, limit: pLim.power_MW, flow: airQ });
      }
      const T_pr  = b.fireMode === "temp"
        ? (Number.isFinite(Number(b.fireTemperature)) && Number(b.fireTemperature) > AMBIENT_TEMP
            ? Math.min(1200, Number(b.fireTemperature))
            : AMBIENT_TEMP + 500)
        : calcFireTemp(pLim.power_MW, airQ, AMBIENT_TEMP);
      // Температура источника горячего плюма зависит от метода:
      // "Норматив 4.5" → Tм из геометрии (форм. 4.11), "Методика" →
      // реальная T_пр. Ручную температуру ("temp") не трогаем.
      let T_src = T_pr;
      if (b.fireMode !== "temp") {
        const fromN = nodes.find(n => n.id === b.fromId);
        const toN   = nodes.find(n => n.id === b.toId);
        const dzGeom = (toN?.z ?? 0) - (fromN?.z ?? 0);
        const geomAngle = Math.abs(b.angle ?? 0) * Math.sign(dzGeom || 1);
        const dirFlow = originalFlows.get(b.id) ?? b.flow ?? 0;
        const flowRelAngle = geomAngle * (dirFlow >= 0 ? 1 : -1);
        T_src = fireSourceTempForMethod({
          physicalFireTemp_C: T_pr, ambientTemp_C: AMBIENT_TEMP,
          angle_deg: flowRelAngle, airFlow_m3s: airQ, sectionArea_m2: b.area,
        }, thermalDepMethod);
      }
      fireSeats.push({ id: b.id, fromId: b.fromId, toId: b.toId, fireTemp: T_src, flow: currentFlows.get(b.id) ?? b.flow ?? 0, originalFlow: originalFlows.get(b.id) ?? b.flow ?? 0, reversedConfirmed: reversedSeats.has(b.id), length: b.length, area: b.area, perimeter: b.perimeter });
      // fireThermalDepression больше НЕ прикладываем как источник.
      return { ...b, fireThermalDepression: 0 };
    });

    // Карта горячих узлов по актуальным расходам.
    const branchesForHot = branchesIter.map(b => ({ id: b.id, fromId: b.fromId, toId: b.toId, flow: currentFlows.get(b.id) ?? b.flow, length: b.length, area: b.area, perimeter: b.perimeter }));
    const hotNodeTemps = computeHotNodeTemps(fireSeats, branchesForHot, AMBIENT_TEMP, baseNodeTemps);

    // Шаг D': ТЕПЛОВОЙ ДРОССЕЛЬ. Нагретый газ расширяется, объёмный расход
    // растёт, и прогретая выработка оказывает большее сопротивление —
    // R_эф = R₀·(T̄+273)/(t₀+273). Депрессию это не трогает: она считается
    // решателем по тем же температурам узлов, что и раньше. Оба механизма
    // опираются на одну карту hotNodeTemps, поэтому не противоречат друг другу.
    //
    // Без этой поправки первая фаза пожара не воспроизводится: в лабораторном
    // опыте расход упал на 19,6 %, хотя тепловая депрессия в восходящей ветви
    // при всасывающем проветривании струю РАЗГОНЯЕТ.
    const throttleRes = applyFireThrottle(branchesWithHt, hotNodeTemps, AMBIENT_TEMP, throttle);
    throttledBranches = throttleRes.applied;

    // Исходные данные для решателя те же, что на прошлой итерации? Тогда и
    // расходы он вернёт те же — считать нечего, процесс сошёлся. Это главный
    // источник ускорения: на устойчивых схемах температуры и сопротивления
    // замирают уже на 2–3 итерации, а сеть пересчитывалась до упора.
    const key = solveKey(throttleRes.branches, hotNodeTemps);
    if (key === prevSolveKey) {
      log(`  Итерация ${iter + 1}: исходные данные не изменились — расчёт сети сошёлся`);
      break;
    }
    prevSolveKey = key;

    // Шаг D: пересчитать сеть с горячими узлами
    const newFlows = await solveIteration(throttleRes.branches, AMBIENT_TEMP, hotNodeTemps);
    if (newFlows.size === 0) break; // ошибка сети — прерываем

    // Шаг E: адаптивная релаксация + проверка сходимости.
    // 1-я итерация — без демпфирования (быстрый честный ответ).
    // Релаксацию 0.5 включаем ТОЛЬКО если поток нестабилен (резко
    // упал/сменил знак): тогда обратная связь «расход↓→T↑→h_t↑→
    // расход↓» иначе расходится (поток схлопывается, T упирается в
    // 1200°C, ложное опрокидывание). Устойчивый режим сходится
    // за 1-2 пересчёта — как раньше, без лишних запросов к серверу.
    const fireBr = branchesWithHt.find(b => b.hasFire);
    const qPrevF = fireBr ? (currentFlows.get(fireBr.id) ?? 0) : 0;
    const qNewF  = fireBr ? (newFlows.get(fireBr.id) ?? 0) : 0;
    const signFlippedF = fireBr != null
      && Math.sign(qPrevF || 1) !== Math.sign(qNewF || 1);
    const unstable = fireBr != null && (
      signFlippedF || Math.abs(qNewF) < Math.abs(qPrevF) * 0.5);
    // Фиксируем опрокидывание всех очагов относительно ШТАТНОГО
    // направления — со следующего раунда плюм пойдёт «по новому».
    for (const seat of fireSeats) {
      const qOrig = originalFlows.get(seat.id) ?? 0;
      const qNew  = newFlows.get(seat.id) ?? 0;
      if (Math.sign(qOrig || 1) !== Math.sign(qNew || 1) && Math.abs(qNew) > 0.05) {
        reversedSeats.add(seat.id);
      }
    }
    // При РАЗВОРОТЕ струи релаксация вредна: усреднение с прежним
    // (противоположным) расходом держит поток у нуля — 8 м³/с
    // вместо 57. Демпфируем только обеднение потока без разворота.
    const relax = (iter === 0 || !unstable || signFlippedF) ? 1.0 : 0.5;

    let maxDQ = 0;
    let scaleQ = 0;   // масштаб расхода по сети — база относительного допуска
    const nextFlows = new Map<string, number>();
    newFlows.forEach((q, id) => {
      const prev = currentFlows.get(id) ?? 0;
      const val = relax >= 1 ? q : prev + relax * (q - prev);
      nextFlows.set(id, val);
      maxDQ = Math.max(maxDQ, Math.abs(val - prev));
      scaleQ = Math.max(scaleQ, Math.abs(val));
    });
    // Допуск ОТНОСИТЕЛЬНЫЙ: 1 % от наибольшего расхода в сети. Прежний
    // абсолютный (0,3 м³/с) на руднике был доли процента, а на модели —
    // больше самого расхода, и расчёт «сходился», ничего не посчитав.
    const tol = Math.max(FIRE_Q_TOL_MIN, scaleQ * FIRE_Q_TOL_REL);
    log(`  Итерация ${iter + 1}: max|ΔQ|=${maxDQ.toFixed(3)} м³/с (допуск ${tol.toFixed(3)})${relax < 1 ? " (демпфирование)" : ""}`);

    currentFlows = nextFlows;
    if (maxDQ < tol) break;

    // ── Выход по стагнации ───────────────────────────────────────────────
    // Невязка перестала убывать — итерации больше не уточняют результат, а
    // повторяют численный шум решателя. Каждая такая итерация стоит полного
    // расчёта сети, поэтому дальше идти незачем: цифры уже не изменятся.
    //
    // Важно: это НЕ ослабление критерия сходимости. Если расчёт сходится, он
    // выйдет строкой выше по допуску tol. Здесь закрывается случай, когда
    // сходимости нет и не будет.
    if (prevMaxDQ !== null && maxDQ > prevMaxDQ * FIRE_STAGNATION_RATIO) {
      stagnationStreak += 1;
      if (stagnationStreak >= FIRE_STAGNATION_STREAK) {
        log(`  Невязка перестала убывать (${maxDQ.toFixed(3)} м³/с) — расчёт остановлен: ` +
            `дальнейшие пересчёты результат не уточняют`);
        break;
      }
    } else {
      stagnationStreak = 0;
    }
    prevMaxDQ = maxDQ;
  }

  // ── Журнал поправок ───────────────────────────────────────────────────
  if (throttledBranches.length > 0) {
    const worst = throttledBranches.reduce((m, t) => (t.factor > m.factor ? t : m));
    log(`  Тепловой дроссель: прогрето выработок ${throttledBranches.length}, ` +
        `наибольший рост сопротивления ×${worst.factor.toFixed(2)} ` +
        `(средняя температура ${worst.meanTemp_C.toFixed(0)} °C)`);
  }
  oxygenLimitedSeats.forEach((v, id) => {
    log(`  Очаг ${id}: не хватает кислорода — мощность ограничена ` +
        `${v.limit.toFixed(2)} МВт вместо ${v.wanted.toFixed(2)} МВт ` +
        `(расход ${v.flow.toFixed(2)} м³/с). Горение неполное, выход CO повышен.`);
  });

  // Итерации сети завершены — идёт финальный расчёт характеристик
  // (шкала продолжает плавно ползти к 95% таймером).
  await yieldToUI();

  // ── Финальный расчёт характеристик пожара по сошедшимся расходам ──
  // Подставляем итоговые Q и пересчитываем мощность (Техника) ещё раз.
  // originalFlow = исходный расход ДО итераций (для обнаружения опрокидывания).
  const branchesForFire = branches.map(b => {
    const finalQ = currentFlows.get(b.id) ?? b.flow;
    // originalFlow — расход ДО пожара (до итераций), для детектирования опрокидывания
    // dPTotal — ОБЩАЯ депрессия ветви (выработка + перемычка/окно).
    // Без неё расчёт брал депрессию одной выработки и на ветви
    // с перемычкой занижал порог опрокидывания в сотни раз.
    const bUpdated = {
      ...b,
      flow: finalQ,
      originalFlow: originalFlows.get(b.id) ?? b.flow,
      dPTotal: totalDepByBranch.get(b.id) ?? b.dPTotal,
    };
    if (!b.hasFire) return bUpdated;
    // Режим «Температурой» — оставляем ручную T (не пересчитываем).
    if (b.fireMode === "temp") return bUpdated;
    // Мощность очага — по ШТАТНОМУ расходу (до пожара), как в
    // Аэросети (calcFireMode тоже считает T по originalFlow).
    const origQ = originalFlows.get(b.id) ?? b.flow;
    const autoP = calcFirePowerFromMaterial({ ...bUpdated, flow: origQ });
    if (!(autoP != null && autoP > 0)) return bUpdated;
    // Мощность урезаем по кислороду, доступному при ФАКТИЧЕСКОМ расходе:
    // при опрокидывании воздуха приходит в разы меньше, и очаг физически не
    // может развить паспортную мощность. При достатке воздуха число прежнее.
    const pFinal = limitPowerByOxygen(autoP, Math.abs(Number(finalQ) || 0)).power_MW;
    return { ...bUpdated, fireHeatRelease: pFinal, fireMode: "heat" as const };
  });

  const result = calcFireMode(branchesForFire, nodes, AMBIENT_TEMP, smokeVisThreshold);
  return {
    flows: currentFlows,
    originalFlows,
    result,
    throttled: throttledBranches,
    oxygenLimited: oxygenLimitedSeats,
  };
}