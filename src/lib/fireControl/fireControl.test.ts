import { describe, it, expect } from "vitest";
import { searchFireControl } from "@/lib/fireControl/search";
import { collectActions, conflicts } from "@/lib/fireControl/candidates";
import { applyActions } from "@/lib/fireControl/actions";
import { computeFireZones } from "@/lib/fireZones";
import { checkRdRules, hasRdProblem } from "@/lib/fireControl/rdRules";
import { calcEvacuationRisk } from "@/lib/evacuationRisk";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";

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

// Схема: поверхность → ствол → развилка на два штрека → сбойка → выход.
// Очаг в штреке b2, люди в узле n4. Дверь в b3 может отсечь дым.
const nodes: TopoNode[] = [
  node("n0", { atmosphereLink: true, peopleNodeType: "exit", z: 100 }),
  node("n1", { z: 0 }),
  node("n2", { z: 0 }),
  node("n3", { z: 0 }),
  node("n4", { z: 0, peopleNodeType: "workplace", peopleCount: 12, selfRescuerTime: 60, peopleDescription: "Забой 4" }),
];
const branches: TopoBranch[] = [
  branch("b0", "n0", "n1", { hasFan: true, fanType: "ГВУ", fanPressure: 2000, fanName: "ВГП-1", type: "Ствол" }),
  branch("b1", "n1", "n2"),
  branch("b2", "n2", "n3", { hasFire: true, fireHeatRelease: 5, fireCombustible: "уголь" }),
  branch("b3", "n2", "n4"),
  branch("b4", "n3", "n4"),
];
const symbols: SchemaSymbol[] = [
  { id: "s1", typeId: "auto_base", x: 0, y: 0, branchId: "b3", bkWindowArea: 9, label: "кв. 12" },
  { id: "s2", typeId: "win_base", x: 0, y: 0, branchId: "b4", bkWindowArea: 4 },
];

describe("ядро подбора аварийного режима", () => {
  it("отбирает управляемые элементы", () => {
    const acts = collectActions({ branches, nodes, symbols });
    console.log("кандидатов:", acts.length);
    acts.forEach(a => console.log(`  [${a.kind}] ${a.label} (${a.effortMin} мин)`));
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.some(a => a.kind === "fan_reverse")).toBe(true);
    expect(acts.some(a => a.kind === "door_close")).toBe(true);
  });

  it("не предлагает бессмысленных действий", () => {
    const acts = collectActions({ branches, nodes, symbols });
    // Дверь s1 открыта на всё сечение (9 из 9) — "открыть" не предлагаем
    const openS1 = acts.filter(a => a.symbolId === "s1" && a.kind === "door_open");
    expect(openS1.length).toBe(0);
    // Вентилятор не реверсирован — "реверс" предлагаем, дублей нет
    expect(acts.filter(a => a.kind === "fan_reverse").length).toBe(1);
  });

  it("конфликты: два действия над одной дверью несовместимы", () => {
    const acts = collectActions({ branches, nodes, symbols });
    const s2acts = acts.filter(a => a.symbolId === "s2");
    expect(s2acts.length).toBeGreaterThan(1);
    expect(conflicts(s2acts[0], s2acts[1])).toBe(true);
  });

  it("применение действий не портит исходные массивы", () => {
    const acts = collectActions({ branches, nodes, symbols });
    const close = acts.find(a => a.kind === "door_close")!;
    const rev = acts.find(a => a.kind === "fan_reverse")!;
    const out = applyActions(branches, symbols, [close, rev]);
    expect(out.symbols.find(s => s.id === close.symbolId)!.bkWindowArea).toBe(0);
    expect(out.branches.find(b => b.id === rev.branchId)!.fanReverse).toBe(true);
    // Оригиналы нетронуты
    expect(symbols.find(s => s.id === close.symbolId)!.bkWindowArea).toBe(9);
    expect(branches.find(b => b.id === rev.branchId)!.fanReverse).toBe(false);
  });

  it("поиск: прогресс, отмена и честный вывод", async () => {
    // Решатель подменён: расход зависит от того, закрыта ли дверь b3.
    const solveIteration = async (brs: TopoBranch[]) => {
      const m = new Map<string, number>();
      for (const b of brs) m.set(b.id, b.fanStopped ? 0 : (b.flow ?? 20));
      return m;
    };
    const steps: string[] = [];
    const report = await searchFireControl(
      {
        branches, nodes, symbols,
        fireParams: {
          ambientTemp: 15, thermalDepMethod: "normative",
          smokeVisThreshold: 50, baseNodeTemps: {},
          totalDepByBranch: new Map(branches.map(b => [b.id, 10])),
          solveIteration, log: () => {}, yieldToUI: async () => {},
        },
      },
      { branches, nodes, symbols },
      { maxActions: 2, onProgress: (d, t, l) => steps.push(`${d}/${t} ${l}`) },
    );
    console.log("расчётов:", report.evaluations, "кандидатов:", report.candidatesCount);
    console.log("исходно в зоне риска:", report.base.peopleAtRisk, "нарушений V:", report.base.velocityViolations);
    console.log("вариантов лучше исходного:", report.variants.length);
    report.variants.forEach(v => console.log(`  ${v.title} → риск=${v.peopleAtRisk} V=${v.velocityViolations} ${v.effortMin}мин`));
    console.log("все спасены:", report.allSaved, "| примечание:", report.note);
    expect(steps.length).toBeGreaterThan(1);
    expect(report.evaluations).toBeGreaterThan(1);
    expect(report.note).not.toBe(undefined);
  }, 60000);

  it("отмена прерывает поиск", async () => {
    const solveIteration = async (brs: TopoBranch[]) => new Map(brs.map(b => [b.id, b.flow ?? 20]));
    let n = 0;
    const report = await searchFireControl(
      {
        branches, nodes, symbols,
        fireParams: {
          ambientTemp: 15, thermalDepMethod: "normative", smokeVisThreshold: 50,
          baseNodeTemps: {}, totalDepByBranch: new Map(),
          solveIteration, log: () => {}, yieldToUI: async () => {},
        },
      },
      { branches, nodes, symbols },
      { maxActions: 3, isCancelled: () => ++n > 3 },
    );
    console.log("после отмены расчётов:", report.evaluations, "| прервано:", report.cancelled);
    expect(report.cancelled).toBe(true);
    expect(report.evaluations).toBeLessThan(10);
  }, 60000);

  it("людей не вывести — говорит об этом прямо", async () => {
    // Самоспасателя хватает на 2 минуты: выйти не успевает никто,
    // и ни один рычаг этого не меняет.
    const doomed = nodes.map(n =>
      n.id === "n4" ? { ...n, selfRescuerTime: 2 } : n);
    const solveIteration = async (brs: TopoBranch[]) =>
      new Map(brs.map(b => [b.id, b.fanStopped ? 0 : (b.flow ?? 20)]));
    const report = await searchFireControl(
      {
        branches, nodes: doomed, symbols,
        fireParams: {
          ambientTemp: 15, thermalDepMethod: "normative", smokeVisThreshold: 50,
          baseNodeTemps: {}, totalDepByBranch: new Map(branches.map(b => [b.id, 10])),
          solveIteration, log: () => {}, yieldToUI: async () => {},
        },
      },
      { branches, nodes: doomed, symbols },
      { maxActions: 2 },
    );
    console.log("исходно в зоне риска:", report.base.peopleAtRisk);
    console.log("лучший результат:", report.bestPeopleAtRisk, "| все спасены:", report.allSaved);
    console.log("примечание:", report.note);
    expect(report.base.peopleAtRisk).toBeGreaterThan(0);
    expect(report.allSaved).toBe(false);
    // Молчать об этом нельзя: число оставшихся обязано быть в тексте
    expect(report.note).toContain(String(report.bestPeopleAtRisk));
  }, 60000);

  it("нарушения по скорости считаются по vMax ветви", async () => {
    // Расход 200 м³/с на сечении 9 м² => V=22 м/с при пределе 8.
    const fast = async (brs: TopoBranch[]) =>
      new Map(brs.map(b => [b.id, 200]));
    const report = await searchFireControl(
      {
        branches, nodes, symbols,
        fireParams: {
          ambientTemp: 15, thermalDepMethod: "normative", smokeVisThreshold: 50,
          baseNodeTemps: {}, totalDepByBranch: new Map(),
          solveIteration: fast, log: () => {}, yieldToUI: async () => {},
        },
      },
      { branches, nodes, symbols },
      { maxActions: 1 },
    );
    console.log("нарушений V в исходном режиме:", report.base.velocityViolations,
                "из", branches.length, "ветвей");
    expect(report.base.velocityViolations).toBe(branches.length);
  }, 60000);

  // ── Регрессия: главный баг, из-за которого подбор «ничего не находил» ──
  // На схеме без рабочих мест и выходов calcEvacuationRisk возвращает ошибку,
  // а подбор молча превращал её в «0 человек в зоне риска». В итоге любой
  // режим выглядел идеальным, варианты не отбирались, и окно бодро писало
  // «все успевают выйти» — на схеме, где про людей не сказано ни слова.
  it("нет рабочих мест — честно сообщает, а не рапортует об успехе", async () => {
    const noPeople = nodes.map(n => ({ ...n, peopleNodeType: "none" as const, peopleCount: 0 }));
    const solveIteration = async (brs: TopoBranch[]) =>
      new Map(brs.map(b => [b.id, b.flow ?? 20]));
    const report = await searchFireControl(
      {
        branches, nodes: noPeople, symbols,
        fireParams: {
          ambientTemp: 15, thermalDepMethod: "normative", smokeVisThreshold: 50,
          baseNodeTemps: {}, totalDepByBranch: new Map(branches.map(b => [b.id, 10])),
          solveIteration, log: () => {}, yieldToUI: async () => {},
        },
      },
      { branches, nodes: noPeople, symbols },
      { maxActions: 2 },
    );
    console.log("dataError:", report.dataError);
    console.log("все спасены:", report.allSaved, "| расчётов:", report.evaluations);
    // Нехватка данных обязана дойти до окна отдельным признаком…
    expect(report.dataError).toBeTruthy();
    // …и НИ В КОЕМ случае не выглядеть успехом.
    expect(report.allSaved).toBe(false);
    // Перебирать десятки режимов без критерия сравнения бессмысленно:
    // останавливаемся сразу после исходного расчёта.
    expect(report.evaluations).toBe(1);
  }, 60000);

  // Сводка отбора: по ней видно, почему рычагов мало — их нет на схеме
  // или они просто далеко от очага.
  it("сводка отбора считает вентиляторы и двери", async () => {
    const solveIteration = async (brs: TopoBranch[]) =>
      new Map(brs.map(b => [b.id, b.flow ?? 20]));
    const report = await searchFireControl(
      {
        branches, nodes, symbols,
        fireParams: {
          ambientTemp: 15, thermalDepMethod: "normative", smokeVisThreshold: 50,
          baseNodeTemps: {}, totalDepByBranch: new Map(branches.map(b => [b.id, 10])),
          solveIteration, log: () => {}, yieldToUI: async () => {},
        },
      },
      { branches, nodes, symbols },
      { maxActions: 1 },
    );
    console.log("сводка:", JSON.stringify(report.stats));
    expect(report.stats.fansTotal).toBe(1);
    expect(report.stats.fansUsed).toBe(1);
    expect(report.stats.doorsTotal).toBe(2);
    expect(report.stats.hasFireSeat).toBe(true);
  }, 60000);

  // ── РД-15-11-2007, п.25: «до очага» и «за очагом» ──────────────────────
  // Струя идёт n0→n1→n2→n3→n4 (все расходы положительные, from→to).
  // Очаг в b2 (n2→n3). Значит n3 и n4 — ЗА очагом, n1 и n2 — ДО очага.
  it("п.25: зоны до/за очагом определяются по ходу струи", () => {
    const z = computeFireZones(branches);
    expect(z.hasFire).toBe(true);
    expect(z.nodeZone.get("n2")).toBe("before");
    expect(z.nodeZone.get("n1")).toBe("before");
    expect(z.nodeZone.get("n3")).toBe("after");
    expect(z.nodeZone.get("n4")).toBe("after");
    // Сама ветвь очага всегда задымлена
    expect(z.branchZone.get("b2")).toBe("after");
  });

  // Ключевое свойство: зона зависит от РЕЖИМА. Развернём струю — и люди,
  // бывшие за очагом, окажутся до очага.
  it("п.25: реверс струи переносит людей из-за очага в зону до очага", () => {
    const reversed = new Map(branches.map(b => [b.id, -(b.flow ?? 20)]));
    const z = computeFireZones(branches, reversed);
    expect(z.nodeZone.get("n4")).toBe("before");
    expect(z.nodeZone.get("n1")).toBe("after");
  });

  // Люди за очагом выводятся в самоспасателях — расчёт обязан это отражать.
  it("п.25: расчёт эвакуации помечает людей за очагом", () => {
    const r = calcEvacuationRisk(nodes, branches);
    expect(r.error).toBeNull();
    console.log("за очагом:", r.peopleAfterFire, "| до очага:", r.peopleBeforeFire);
    expect(r.peopleAfterFire).toBe(12);
    const row = r.rows.find(x => x.nodeId === "n4");
    expect(row?.zone).toBe("after");
    // Мероприятие по РД: именно «в изолирующих самоспасателях»
    expect(row?.recommendation).toContain("изолирующих самоспасателях");
  });

  // ── РД п.46: скорости в самоспасателях ────────────────────────────────
  // Наклонная выработка на подъём: без защиты человек идёт быстрее, чем
  // в самоспасателе. Раньше время выхода за очагом считалось по скоростям
  // «без ИДА» — и получалось заниженным.
  it("п.46: за очагом время выхода считается по скоростям в самоспасателе", () => {
    const steepNodes: TopoNode[] = [
      node("s0", { atmosphereLink: true, peopleNodeType: "exit", z: 300 }),
      node("s1", { z: 0 }),
      node("s2", { z: 0, peopleNodeType: "workplace", peopleCount: 5, selfRescuerTime: 60 }),
    ];
    // b_up — крутой подъём 30°: по п.46 скорость 20 м/мин, без ИДА — 27 м/мин
    const steepBranches: TopoBranch[] = [
      branch("bf", "s1", "s2", { hasFire: true, fireHeatRelease: 5 }),
      branch("bup", "s2", "s0", { angle: 30, length: 600 }),
    ];
    const r = calcEvacuationRisk(steepNodes, steepBranches);
    const row = r.rows.find(x => x.nodeId === "s2");
    expect(row?.zone).toBe("after");
    // 600 м на подъём 30°: 600/20 = 30 мин (п.46), а не 600/27 ≈ 22 мин
    console.log("время выхода за очагом:", row?.evacTime, "мин");
    expect(row!.evacTime).toBeGreaterThan(25);
  });

  // ── РД п.30: правила выбора режима ────────────────────────────────────
  it("п.30: пожар в стволе без реверса помечается как расхождение с РД", () => {
    // Очаг переносим на ствол b0 — по РД здесь предписан реверс
    const shaftFire = branches.map(b =>
      b.id === "b0" ? { ...b, hasFire: true } : { ...b, hasFire: false });
    const notes = checkRdRules({
      branches: shaftFire, nodes, actions: [], reversedBranchCount: 0,
    });
    console.log("замечания РД:", notes.map(n => `[${n.clause}] ${n.text}`));
    expect(hasRdProblem(notes)).toBe(true);
    expect(notes.some(n => n.kind === "required")).toBe(true);
  });

  it("п.30: с реверсом расхождения нет", () => {
    const shaftFire = branches.map(b =>
      b.id === "b0" ? { ...b, hasFire: true } : { ...b, hasFire: false });
    const notes = checkRdRules({
      branches: shaftFire, nodes,
      actions: [{ kind: "fan_reverse", branchId: "b0", label: "Реверсировать ВГП-1", effortMin: 2 }],
      reversedBranchCount: 3,
    });
    expect(hasRdProblem(notes)).toBe(false);
  });

  // ── Вместимость убежища (РД п.25) ─────────────────────────────────────
  // Раньше поле заполнялось в панели узла, но в расчёт не шло: «спасёнными»
  // числились люди, которым в убежище не хватит места.
  it("вместимость ПВП меньше числа людей — это не спасение", () => {
    // Свежая струя только в t1 — ЗА очагом (ветвь tf), и путь туда долгий:
    // 3000 м на подъём 30° = 150 мин по п.46. Самоспасателя на 10 мин мало,
    // значит спасти может только ПВП — вот его вместимость и проверяется.
    const tightNodes: TopoNode[] = [
      node("t0", { atmosphereLink: true, peopleNodeType: "exit", z: 500 }),
      node("t1", { z: 0 }),
      node("t2", { z: 0, peopleNodeType: "workplace", peopleCount: 20, selfRescuerTime: 10 }),
      node("t3", { z: 0, peopleNodeType: "switchpoint", refugeCapacity: 5 }),
    ];
    const tightBranches: TopoBranch[] = [
      branch("tf", "t1", "t2", { hasFire: true, fireHeatRelease: 5, angle: -30, length: 3000 }),
      branch("tlong", "t2", "t0", { angle: 20, length: 2000 }),
      branch("tsp", "t2", "t3", { length: 50 }),
    ];
    const r = calcEvacuationRisk(tightNodes, tightBranches);
    const row = r.rows.find(x => x.nodeId === "t2");
    console.log("вердикт:", row?.level, "|", row?.recommendation);
    // 20 человек в ПВП на 5 мест — не «нужен ПВП», а критично
    expect(row?.level).toBe("critical");
    expect(row?.recommendation).toContain("Мест не хватает");
  });
});