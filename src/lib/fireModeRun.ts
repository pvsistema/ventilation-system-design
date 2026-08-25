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
  calcFirePowerFromMaterial,
  type ThermalDepMethod, type FireCalculationResult,
} from "@/lib/fireCalculator";

/** Максимум итераций сети (каждая — полный пересчёт вентиляционной сети). */
const FIRE_ITERS = 4;
/** Допуск сходимости по расходу, м³/с — на уровне шума сети. */
const FIRE_Q_TOL = 0.3;

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
}

export interface FireModeRunResult {
  /** Сошедшиеся расходы по ветвям. */
  flows: Map<string, number>;
  /** Расходы ДО пожара — по ним определяется опрокидывание струи. */
  originalFlows: Map<string, number>;
  /** Итоговые характеристики пожара. */
  result: FireCalculationResult;
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
  } = p;

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
      // Расход для T_пр — ФАКТИЧЕСКИЙ (как в Аэросети), но не ниже
      // половины штатного: верхняя защита от разгона обратной
      // связи «расход↓→T↑→h_t↑→расход↓». Раньше брался только
      // штатный, и при выросшем расходе (10.5→56.1) температура
      // завышалась вчетверо (663.8 вместо 140.8°C).
      const qOrigA   = Math.abs(originalFlows.get(b.id) ?? b.flow ?? 0);
      const qActualA = Math.abs(currentFlows.get(b.id) ?? b.flow ?? 0);
      const airQ  = qOrigA > 0 ? Math.max(qActualA, 0.5 * qOrigA) : qActualA;
      const T_pr  = b.fireMode === "temp"
        ? (Number.isFinite(Number(b.fireTemperature)) && Number(b.fireTemperature) > AMBIENT_TEMP
            ? Math.min(1200, Number(b.fireTemperature))
            : AMBIENT_TEMP + 500)
        : calcFireTemp(Number.isFinite(b.fireHeatRelease) ? b.fireHeatRelease : 0, airQ, AMBIENT_TEMP);
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

    // Шаг D: пересчитать сеть с горячими узлами
    const newFlows = await solveIteration(branchesWithHt, AMBIENT_TEMP, hotNodeTemps);
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
    const nextFlows = new Map<string, number>();
    newFlows.forEach((q, id) => {
      const prev = currentFlows.get(id) ?? 0;
      const val = relax >= 1 ? q : prev + relax * (q - prev);
      nextFlows.set(id, val);
      maxDQ = Math.max(maxDQ, Math.abs(val - prev));
    });
    log(`  Итерация ${iter + 1}: max|ΔQ|=${maxDQ.toFixed(3)} м³/с${relax < 1 ? " (демпфирование)" : ""}`);

    currentFlows = nextFlows;
    if (maxDQ < FIRE_Q_TOL) break;
  }

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
    return autoP != null && autoP > 0
      ? { ...bUpdated, fireHeatRelease: autoP, fireMode: "heat" as const }
      : bUpdated;
  });

  const result = calcFireMode(branchesForFire, nodes, AMBIENT_TEMP, smokeVisThreshold);
  return { flows: currentFlows, originalFlows, result };
}
