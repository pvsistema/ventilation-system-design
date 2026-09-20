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
  calcFirePowerFromMaterial, calcFireSeatDepression, isSignificantReversal,
  type ThermalDepMethod, type FireCalculationResult,
} from "@/lib/fireCalculator";

/** Максимум итераций сети (каждая — полный пересчёт вентиляционной сети). */
const FIRE_ITERS = 4;
/** Допуск сходимости по расходу, м³/с — на уровне шума сети. */
const FIRE_Q_TOL = 0.3;

/**
 * Сколько итераций подряд должен держаться обратный знак расхода, чтобы
 * считать струю действительно опрокинутой.
 *
 * Одной итерации мало: решатель на промежуточном шаге может «перелететь»
 * через ноль и вернуться. Раньше разворот фиксировался с первого раза,
 * тут же снималось демпфирование — и ложный переворот закреплялся навсегда.
 */
const REVERSAL_CONFIRM_ITERS = 2;



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
  /** Общая депрессия ветви (выработка + перемычка/окно), Па. */
  totalDepByBranch: Map<string, number>;
  /**
   * Общее сопротивление ветви (выработка + перемычка/окно + окно ГВУ), кМюрг.
   *
   * Нужно формулам Приложения 5: по голому b.resistance ветвь с закрытой
   * дверью считалась пустой выработкой, и критическая депрессия h_кр выходила
   * заниженной. Карта необязательна — без неё расчёт откатывается на
   * b.resistance, как было раньше.
   */
  totalRByBranch?: Map<string, number>;
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
    smokeVisThreshold, baseNodeTemps, totalDepByBranch, totalRByBranch,
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
  // Сколько итераций подряд у очага держится обратный знак расхода.
  // Подтверждаем разворот только при REVERSAL_CONFIRM_ITERS подряд —
  // одиночный «перелёт» через ноль опрокидыванием не считается.
  const reversalStreak = new Map<string, number>();

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
    // + модель тепловой тяги. Моделей ДВЕ, выбор за пользователем:
    //
    //  • «Методика» — РАСПРЕДЕЛЁННАЯ: горячий газ разносится по пути
    //    дыма и нагревает УЗЛЫ, а решатель считает тягу как замкнутый
    //    интеграл плотности по высоте контура (natural_draft_h).
    //    Горячий восходящий столб уравновешивается встречным холодным
    //    столбом выхода на поверхность — соседние выработки меняются
    //    слабо (как в Аэросети).
    //
    //  • «Норматив (4.5)» — СОСРЕДОТОЧЕННАЯ: тяга очага выражается
    //    одним числом h_т (ф. 4.5) и прикладывается к ветви очага как
    //    источник напора (fireThermalDepression). Так считает ПО
    //    «Вентиляция»: Δz в ф. 4.6 — высота столба ОТ ОЧАГА ДО УСТЬЯ,
    //    поэтому положение очага в ветви реально меняет результат
    //    (очаг у входа → опрокидывание, у выхода → почти нет влияния).
    //
    // Модели ВЗАИМОИСКЛЮЧАЮЩИЕ: применять обе сразу нельзя, иначе одна
    // и та же тепловая тяга учитывается дважды.
    const useNormativeSeat = thermalDepMethod === "normative";
    const fireSeats: { id: string; fromId: string; toId: string; fireTemp: number; flow: number; originalFlow?: number; reversedConfirmed?: boolean; length?: number; area?: number; perimeter?: number }[] = [];
    const branchesWithHt = branchesIter.map(b => {
      if (!b.hasFire) return b;
      // Расход для T_пр — ШТАТНЫЙ (до пожара), как в ПО «Вентиляция».
      //
      // ПОЧЕМУ НЕ ФАКТИЧЕСКИЙ. Раньше сюда шёл текущий расход итерации (с полом
      // в половину штатного), и получалась замкнутая петля: расход падает →
      // T считается по упавшему расходу → T растёт → растёт h_т → расход падает
      // ещё сильнее. Пол 0.5·Q_шт её тормозил, но не разрывал: h_т успевала
      // вырасти примерно вдвое. На ветви 432 (кабель, 0.88 МВт) это давало
      // 38 Па → ~76 Па против депрессии 53.9 Па, и струя переворачивалась,
      // хотя норматив (Прил. 5) давал «устойчиво»: h_кр=57.1 Па, p_у=1.50.
      // Эталон ПО «Вентиляция» на той же ветви — снижение 33→17 м³/с БЕЗ
      // опрокидывания.
      //
      // Физически мощность очага (горящий кабель, лента, крепь) от вентиляции
      // не зависит — значит и температура продуктов не должна пересчитываться
      // по расходу, который сама же тяга и уменьшила. Штатный расход убирает
      // первопричину: h_т считается один раз и по итерациям не разгоняется.
      const qOrigA   = Math.abs(originalFlows.get(b.id) ?? b.flow ?? 0);
      const qActualA = Math.abs(currentFlows.get(b.id) ?? b.flow ?? 0);
      const airQ  = qOrigA > 0 ? qOrigA : qActualA;
      const T_pr  = b.fireMode === "temp"
        // «≥», а не «>»: температура очага, равная температуре воздуха, — это
        // корректное значение (очаг не греет струю), а не «битое». Раньше оно
        // подменялось на T₀+500 °C и создавало тепловую тягу из ничего.
        ? (Number.isFinite(Number(b.fireTemperature)) && Number(b.fireTemperature) >= AMBIENT_TEMP
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

      // При «Норативе 4.5» тяга очага идёт в решатель СОСРЕДОТОЧЕННЫМ
      // источником на ветви очага — как в ПО «Вентиляция». При «Методике»
      // поле обнуляем: там тяга уже заложена в температуры узлов.
      if (!useNormativeSeat) return { ...b, fireThermalDepression: 0 };

      const fromN = nodes.find(n => n.id === b.fromId);
      const toN   = nodes.find(n => n.id === b.toId);
      const { h_t } = calcFireSeatDepression({
        fireTemp_C: T_pr, ambientTemp_C: AMBIENT_TEMP,
        airFlow_m3s: airQ, sectionArea_m2: b.area,
        length_m: b.length, angle_deg: b.angle,
        fromZ: fromN?.z, toZ: toN?.z,
        fireT: b.fireT,
        // Направление струи — по ШТАТНОМУ расходу: уже опрокинутый на
        // итерации поток не должен сам себя подтверждать.
        dirFlow: originalFlows.get(b.id) ?? b.flow ?? 0,
      }, thermalDepMethod);
      return { ...b, fireThermalDepression: Number.isFinite(h_t) ? h_t : 0 };
    });

    // Карта горячих узлов. При «Норативе 4.5» узлы всё равно греем — дым,
    // задымление и температуры в выработках показываются одинаково в обоих
    // методах, — но на ТЯГУ они там не работают: в solveIteration карта
    // передаётся только для «Методики». Иначе тепловая тяга учлась бы дважды
    // (и узлами, и сосредоточенным h_т) и снова опрокидывала бы ветвь.
    const branchesForHot = branchesIter.map(b => ({ id: b.id, fromId: b.fromId, toId: b.toId, flow: currentFlows.get(b.id) ?? b.flow, length: b.length, area: b.area, perimeter: b.perimeter }));
    const hotNodeTemps = computeHotNodeTemps(fireSeats, branchesForHot, AMBIENT_TEMP, baseNodeTemps);

    // Шаг D: пересчитать сеть.
    const newFlows = await solveIteration(
      branchesWithHt, AMBIENT_TEMP,
      useNormativeSeat ? undefined : hotNodeTemps,
    );
    if (newFlows.size === 0) break; // ошибка сети — прерываем

    // Шаг E: адаптивная релаксация + проверка сходимости.
    // 1-я итерация — без демпфирования (быстрый честный ответ).
    // Релаксацию 0.5 включаем, если поток нестабилен (резко упал или сменил
    // знак): тогда остаточная обратная связь через сеть иначе расходится.
    const fireBr = branchesWithHt.find(b => b.hasFire);
    const qPrevF = fireBr ? (currentFlows.get(fireBr.id) ?? 0) : 0;
    const qNewF  = fireBr ? (newFlows.get(fireBr.id) ?? 0) : 0;
    const signFlippedF = fireBr != null
      && Math.sign(qPrevF || 1) !== Math.sign(qNewF || 1);
    const unstable = fireBr != null && (
      signFlippedF || Math.abs(qNewF) < Math.abs(qPrevF) * 0.5);

    // Фиксируем опрокидывание очагов относительно ШТАТНОГО направления —
    // со следующего раунда плюм пойдёт «по новому».
    //
    // РАЗВОРОТ ПОДТВЕРЖДАЕТСЯ НЕ С ПЕРВОГО РАЗА. Смена знака на одной итерации
    // — ещё не опрокидывание: решатель может «перелететь» через ноль на
    // промежуточном шаге и вернуться обратно. Требуем, чтобы знак держался
    // REVERSAL_CONFIRM_ITERS итераций подряд и чтобы обратный расход был
    // ЗНАЧИМЫМ (см. isSignificantReversal) — иначе в reversedSeats попадал
    // численный шум, а он разворачивал плюм и закреплял ложный переворот.
    for (const seat of fireSeats) {
      const qOrig = originalFlows.get(seat.id) ?? 0;
      const qNew  = newFlows.get(seat.id) ?? 0;
      if (isSignificantReversal(qOrig, qNew)) {
        const streak = (reversalStreak.get(seat.id) ?? 0) + 1;
        reversalStreak.set(seat.id, streak);
        if (streak >= REVERSAL_CONFIRM_ITERS) reversedSeats.add(seat.id);
      } else {
        // Знак вернулся к штатному — счётчик обнуляем, чтобы «мигание»
        // через ноль не накапливалось до подтверждения.
        reversalStreak.set(seat.id, 0);
        reversedSeats.delete(seat.id);
      }
    }

    // Демпфирование. Раньше при signFlippedF релаксация СНИМАЛАСЬ (relax=1):
    // логика писалась под реальное опрокидывание, чтобы струя успела
    // разогнаться в обратную сторону. Но при ложном срабатывании то же
    // условие мгновенно закрепляло переворот — гасить его было нечем.
    // Теперь снимаем демпфирование только когда разворот уже ПОДТВЕРЖДЁН
    // (устойчив несколько итераций): до этого момента переход через ноль
    // сглаживается, и ветвь, устойчивая по Прил. 5, к нулю не схлопывается.
    const seatConfirmed = fireBr != null && reversedSeats.has(fireBr.id);
    const relax = (iter === 0 || !unstable || seatConfirmed) ? 1.0 : 0.5;

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
    // rTotal — ОБЩЕЕ сопротивление ветви, по той же причине: формулы
    // Приложения 5 (h_кр) без него считают перемычку пустой выработкой.
    const bUpdated = {
      ...b,
      flow: finalQ,
      originalFlow: originalFlows.get(b.id) ?? b.flow,
      dPTotal: totalDepByBranch.get(b.id) ?? b.dPTotal,
      rTotal: totalRByBranch?.get(b.id) ?? b.rTotal,
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