// ─────────────────────────────────────────────────────────────────────────────
// Проверка СКОРОСТИ расчёта пожарного режима.
//
// Каждая итерация runFireMode — это полный расчёт вентиляционной сети, то есть
// запрос на расчётный сервер и заметная пауза. Поэтому скорость здесь измеряется
// не секундами (они зависят от машины и сети), а ЧИСЛОМ ВЫЗОВОВ РЕШАТЕЛЯ —
// величиной детерминированной и воспроизводимой.
//
// Что закрепляют тесты:
//   • на устойчивой схеме расчёт останавливается, как только исходные данные
//     решателя перестали меняться, — лишних запросов нет;
//   • при незатухающих колебаниях срабатывает выход по стагнации, и цикл не
//     докручивается до предела в 12 итераций;
//   • ускорение не изменило результат: сошедшиеся расходы прежние.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { runFireMode, type FireModeRunParams } from "@/lib/fireModeRun";
import type { TopoBranch, TopoNode } from "@/lib/topology";

const node = (id: string, p: Partial<TopoNode> = {}): TopoNode => ({
  id, name: id, number: "", x: 0, y: 0, z: 0,
  airTemp: 20, atmosphereLink: false, wallTemp: 20,
  reducedPressure: 0, computedGasConc: 0, computedAirTemp: 20,
  computedWallTemp: 20, computedPressure: 0, computedFanPressure: 0,
  fireNodeType: "none", fireHydrantOpen: false, fireRequiredFlow: 0,
  fireInitPressure: 0, fireCapacity: 0, fireHydrantDiameter: 0,
  ...p,
} as TopoNode);

const branch = (id: string, fromId: string, toId: string, p: Partial<TopoBranch> = {}): TopoBranch => ({
  id, fromId, toId, type: "Штрек", shape: "rect",
  diameter: 0, rectWidth: 3, rectHeight: 3, trapTopWidth: 0, archHeight: 0,
  area: 9, perimeter: 12, dh: 3, length: 100, angle: 0,
  manualAngle: false, manualLength: false, manualSection: false,
  resistanceMode: "alpha", alphaCoef: 0.01, surfaceId: "", surface: "",
  roughness: 0, manualR: 0, pipeAlpha: 0, pipeDiameter: 0,
  localXi: 0, vMax: 8, hasFan: false, fanType: "ГВУ", fanMode: "constant",
  fanPressure: 0, fanName: "", fanCurveId: "", fanRpm: 0, fanBladeAngle: 0,
  fanParallel: 1, fanInstall: "Внутри перемычки", fanCrossingR: 0,
  fanWindowArea: 0, fanEfficiency: 0, fanShaftPower: 0,
  fanReverse: false, fanStopped: false,
  resistance: 0.01, rFriction: 0, rLocal: 0, lambda: 0,
  flow: 20, velocity: 2, dP: 10, isDead: false, isLeakage: false, leakageCoeff: 0,
  hasBulkhead: false, bulkheadId: "", bulkheadName: "", bulkheadR: 0,
  bulkheadAirPerm: 0, bulkheadResMode: "project", bulkheadManualAirPerm: false,
  bulkheadCustomAirPerm: 0, bulkheadSurveyQ: 0, bulkheadSurveyDP: 0,
  bulkheadManualR: 0, bulkheadWindowArea: 0, bulkheadFailurePressure: 0,
  bulkheadDestroyedByExplosion: false, power: 0, reynolds: 0,
  lineWidth: 2, lineBorder: 0.2, capital: false, designed: false,
  layer: "", horizonId: "", comment: "",
  hasWaterPipe: false, wpDiameter: 0, wpMaterial: "", wpLengthManual: false,
  wpLength: 0, wpRoughnessMode: "smooth", wpRoughness: 0, wpManualR: 0,
  wpLocalXi: 0, wpComputedR: 0, wpComputedFlow: 0, wpComputedVelocity: 0,
  wpComputedDeltaP: 0, wpHasReducer: false, wpReducerModel: "",
  wpReducerOutPressure: 0, wpReducerMaxFlow: 0,
  hasFire: false, fireT: 0.5, fireHeatRelease: 0, fireMode: "heat",
  fireTemperature: 0, fireCombustible: "", fireStartTime: 0,
  ...p,
} as TopoBranch);

const nodes: TopoNode[] = [
  node("n0", { atmosphereLink: true, z: 100 }),
  node("n1", { z: 0 }),
  node("n2", { z: 0 }),
];
const branches: TopoBranch[] = [
  branch("b0", "n0", "n1", { type: "Ствол", angle: -90, length: 100 }),
  branch("b1", "n1", "n2", { hasFire: true, fireHeatRelease: 5, fireMode: "temp", fireTemperature: 600 }),
];

/** Базовые параметры прогона; решатель подменяется в каждом тесте. */
function makeParams(
  solveIteration: FireModeRunParams["solveIteration"],
  extra: Partial<FireModeRunParams> = {},
): FireModeRunParams {
  return {
    branches, nodes,
    ambientTemp: 20,
    thermalDepMethod: "normative",
    smokeVisThreshold: 50,
    baseNodeTemps: {},
    totalDepByBranch: new Map(branches.map(b => [b.id, 10])),
    solveIteration,
    log: () => {},
    yieldToUI: async () => {},
    ...extra,
  };
}

describe("скорость расчёта пожарного режима", () => {

  it("устойчивая сеть: лишних расчётов сети нет", async () => {
    // Решатель возвращает одно и то же — значит после первого пересчёта
    // исходные данные замирают и продолжать незачем.
    let calls = 0;
    const solveIteration = async (brs: TopoBranch[]) => {
      calls += 1;
      return new Map(brs.map(b => [b.id, b.flow ?? 20]));
    };

    const res = await runFireMode(makeParams(solveIteration));
    // До правок здесь выполнялось до 12 обращений к решателю.
    expect(calls).toBeLessThanOrEqual(3);
    expect(res.flows.size).toBeGreaterThan(0);
  });

  it("колебания без сходимости: срабатывает выход по стагнации", async () => {
    // Расход скачет между двумя значениями ОДНОГО ЗНАКА и не сходится.
    // Знак не меняется — это не разворот струи, а численный шум, поэтому
    // выход по стагнации обязан сработать.
    let calls = 0;
    const solveIteration = async (brs: TopoBranch[]) => {
      calls += 1;
      const m = new Map<string, number>();
      for (const b of brs) {
        m.set(b.id, b.id === "b1" ? (calls % 2 === 0 ? 18 : 22) : 20);
      }
      return m;
    };

    await runFireMode(makeParams(solveIteration));
    expect(calls).toBeLessThan(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ОПРОКИДЫВАНИЕ СТРУИ.
//
// Здесь закреплена ошибка, которую внесло первое ускорение: расчёт обрывался
// посреди разворота струи, и температура очага получалась заниженной
// (211 °C вместо 237 °C на восходящем проветривании).
//
// Причин было две, и обе проверяются ниже:
//   1) отпечаток исходных данных не учитывал РАСХОДЫ, хотя они уходят в
//      решатель тёплым стартом. При развороте температуры замирают, а расходы
//      ещё меняются — отпечаток ложно совпадал;
//   2) выход по стагнации срабатывал на переходном процессе: пока струя
//      разворачивается, невязка закономерно большая.
// ─────────────────────────────────────────────────────────────────────────────
describe("опрокидывание струи не обрывается досрочно", () => {

  /**
   * Решатель, имитирующий разворот струи: расход в ветви очага плавно
   * переходит от +20 к −20 за несколько итераций, как при реальном
   * опрокидывании на восходящем проветривании.
   *
   * ВАЖНО: первый шаг уже ОТЛИЧАЕТСЯ от исходных +20. Так и происходит в
   * действительности — первый же пересчёт с горячими узлами меняет расход.
   * Если бы решатель вернул исходное значение, невязка была бы нулевой и
   * расчёт корректно завершился бы сразу, ничего не проверив.
   */
  function makeReversingSolver(steps: number[]) {
    let call = 0;
    const calls = { count: 0 };
    const solveIteration = async (brs: TopoBranch[]) => {
      const q = steps[Math.min(call, steps.length - 1)];
      call += 1;
      calls.count = call;
      const m = new Map<string, number>();
      for (const b of brs) m.set(b.id, b.id === "b1" ? q : 20);
      return m;
    };
    return { solveIteration, calls };
  }

  it("расчёт доходит до конца разворота, а не обрывается в середине", async () => {
    // Струя разворачивается: +20 → +8 → −5 → −16 → −20 → −20 (устоялась).
    const steps = [8, -5, -16, -20, -20, -20];
    const { solveIteration, calls } = makeReversingSolver(steps);

    const res = await runFireMode(makeParams(solveIteration));

    // Расчёт обязан дойти до устоявшегося значения −20, а не замереть
    // на промежуточном. Именно это и ломалось: обрыв на −5 или −16.
    expect(res.flows.get("b1")).toBeCloseTo(-20, 3);
    // Значит, решатель вызывался достаточно раз, чтобы разворот завершился.
    expect(calls.count).toBeGreaterThanOrEqual(5);
  });

  it("смена знака расхода не считается стагнацией", async () => {
    // Невязка при развороте велика и почти не убывает: 12 → 13 → 11 → 4 → 0.
    // Старый критерий стагнации обрывал расчёт на второй такой итерации.
    const steps = [8, -5, -16, -20, -20, -20];
    const { solveIteration, calls } = makeReversingSolver(steps);

    await runFireMode(makeParams(solveIteration));
    // Если бы стагнация сработала, вызовов было бы 2–3.
    expect(calls.count).toBeGreaterThan(3);
  });

  it("опрокидывание фиксируется в результате", async () => {
    const steps = [-18, -20, -20];
    const { solveIteration } = makeReversingSolver(steps);

    const res = await runFireMode(makeParams(solveIteration));
    // Расход в ветви очага сменил знак относительно исходного (+20).
    const q = res.flows.get("b1")!;
    const q0 = res.originalFlows.get("b1")!;
    expect(Math.sign(q)).not.toBe(Math.sign(q0));
  });

  it("расходы входят в отпечаток исходных данных", async () => {
    // Температуры и сопротивления здесь заведомо замирают (режим "temp"),
    // а расход на каждой итерации новый. Если бы отпечаток не учитывал
    // расходы, расчёт оборвался бы после первого же вызова.
    let calls = 0;
    const solveIteration = async (brs: TopoBranch[]) => {
      calls += 1;
      const m = new Map<string, number>();
      for (const b of brs) m.set(b.id, b.id === "b1" ? 20 - calls * 3 : 20);
      return m;
    };

    await runFireMode(makeParams(solveIteration));
    expect(calls).toBeGreaterThan(2);
  });

  it("ускорение не изменило результат", async () => {
    // Сеть сходится за два шага. Сошедшиеся расходы должны быть ровно теми,
    // что вернул решатель, — оптимизация не имеет права их подменять.
    const target = new Map([["b0", 18], ["b1", 18]]);
    const solveIteration = async () => new Map(target);

    const res = await runFireMode(makeParams(solveIteration));
    expect(res.flows.get("b0")).toBeCloseTo(18, 6);
    expect(res.flows.get("b1")).toBeCloseTo(18, 6);
  });

  it("отключённый дроссель не мешает ранней остановке", async () => {
    // При enabled=false сопротивления вообще не меняются, поэтому отпечаток
    // совпадает сразу — расчёт обязан остановиться ещё раньше.
    let calls = 0;
    const solveIteration = async (brs: TopoBranch[]) => {
      calls += 1;
      return new Map(brs.map(b => [b.id, b.flow ?? 20]));
    };

    await runFireMode(makeParams(solveIteration, { throttle: { enabled: false } }));
    expect(calls).toBeLessThanOrEqual(3);
  });

  it("ошибка решателя прерывает расчёт сразу", async () => {
    let calls = 0;
    const solveIteration = async () => {
      calls += 1;
      return new Map<string, number>();   // пустая карта = ошибка сети
    };

    await runFireMode(makeParams(solveIteration));
    expect(calls).toBe(1);
  });
});