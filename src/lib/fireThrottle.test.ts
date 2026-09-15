// ─────────────────────────────────────────────────────────────────────────────
// Проверка теплового дросселирования и ограничения мощности по кислороду.
//
// Главный ориентир — ЛАБОРАТОРНЫЙ ОПЫТ на модели рудника (алюминиевая гофра
// Ø160 мм, деревянная крепь на участке, всасывающее проветривание):
//
//   фаза 0  до пожара                    2,71   (показание анемометра, м/с)
//   фаза 1  сразу после возгорания       2,18   −19,6 %
//   фаза 2  через 3–5 мин                2,71   возврат к исходному
//   фаза 3  вентилятор остановлен        0,59 → 0,608  опрокидывание
//
// Тесты закрепляют два требования:
//   • поправки воспроизводят замеры;
//   • при выключенной поправке расчёт совпадает с прежним до последней цифры
//     (нормативную методику нельзя сломать случайной правкой).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  throttleFactor, applyFireThrottle, meanTempFromFlowDrop, firePowerFromFlowDrop,
  THROTTLE_MAX_RATIO,
} from "@/lib/fireThrottle";
import {
  limitPowerByOxygen, oxygenLimitedPower_MW, oxygenDeficitCoFactor,
  calcFireTemp, calcThermalDepression, calcThermalDepressionNormative,
  calcFirePowerFromMaterial, getFirePreset,
  HEAT_PER_KG_AIR_MJ,
} from "@/lib/fireCalculator";
import { checkApplicability, buoyancyFroude, compareSimilarity } from "@/lib/fireApplicability";

/** Замеры лабораторной модели (м/с по анемометру). */
const LAB = { before: 2.71, during: 2.18, recovered: 2.71, reversed: 0.59, grown: 0.608 };
/** Сечение гофры Ø160 мм, м². */
const LAB_AREA = Math.PI * 0.16 * 0.16 / 4;
const AMBIENT = 20;

describe("тепловой дроссель", () => {

  it("выключенная поправка не меняет сопротивление", () => {
    // Ключевая гарантия: нормативный расчёт остаётся прежним.
    expect(throttleFactor(600, 20, { enabled: false })).toBe(1);
    const branches = [{ id: "b1", fromId: "n1", toId: "n2", resistance: 0.5 }];
    const res = applyFireThrottle(branches, { n1: 600, n2: 400 }, 20, { enabled: false });
    expect(res.branches).toBe(branches);      // тот же массив, без копий
    expect(res.applied).toHaveLength(0);
  });

  it("множитель равен отношению абсолютных температур", () => {
    // T = 180 °C при фоне 20 °C → (180+273,15)/(20+273,15) = 1,546
    const k = throttleFactor(180, 20);
    expect(k).toBeCloseTo(453.15 / 293.15, 6);
  });

  it("холодный газ сопротивление не снижает", () => {
    expect(throttleFactor(10, 20)).toBe(1);
    expect(throttleFactor(20, 20)).toBe(1);
  });

  it("множитель ограничен сверху", () => {
    expect(throttleFactor(5000, 20)).toBe(THROTTLE_MAX_RATIO);
  });

  it("частично прогретая ветвь дросселируется слабее", () => {
    const full = throttleFactor(180, 20, { enabled: true, hotFraction: 1 });
    const half = throttleFactor(180, 20, { enabled: true, hotFraction: 0.5 });
    expect(half).toBeLessThan(full);
    expect(half).toBeCloseTo(1 + (full - 1) * 0.5, 6);
  });

  it("непрогретые ветви остаются без изменений", () => {
    const branches = [
      { id: "hot",  fromId: "n1", toId: "n2", resistance: 1 },
      { id: "cold", fromId: "n3", toId: "n4", resistance: 1 },
    ];
    const res = applyFireThrottle(branches, { n1: 300, n2: 300 }, 20);
    expect(res.applied.map(a => a.branchId)).toEqual(["hot"]);
    expect(res.branches[1].resistance).toBe(1);
  });

  // ── Сверка с лабораторным опытом ────────────────────────────────────────
  it("фаза 1: падение расхода 2,71 → 2,18 даёт ≈180 °C", () => {
    const T = meanTempFromFlowDrop(LAB.before, LAB.during, AMBIENT);
    expect(T).not.toBeNull();
    // (2,71/2,18)² = 1,546 → 293,15·1,546 − 273,15 ≈ 180 °C
    expect(T!).toBeGreaterThan(170);
    expect(T!).toBeLessThan(190);
  });

  it("фаза 1: обратный расчёт даёт мощность очага порядка 10 кВт", () => {
    // Расход при пожаре: 2,18 м/с × сечение гофры
    const qDuring = LAB.during * LAB_AREA;
    const P = firePowerFromFlowDrop(LAB.before, LAB.during, AMBIENT, qDuring);
    expect(P).not.toBeNull();
    // Деревянная крепь на малом участке: единицы–десятки киловатт
    expect(P!).toBeGreaterThan(3);
    expect(P!).toBeLessThan(30);
  });

  it("фаза 1: дроссель объясняет падение расхода при постоянном напоре", () => {
    // Q ∝ 1/√R. Рост сопротивления в 1,546 раза даёт падение расхода
    // в √1,546 = 1,243 раза: 2,71 / 1,243 = 2,18 — ровно замер.
    const k = throttleFactor(180, AMBIENT);
    const qAfter = LAB.before / Math.sqrt(k);
    expect(qAfter).toBeCloseTo(LAB.during, 1);
  });

  it("прямая и обратная задачи согласованы", () => {
    const T = meanTempFromFlowDrop(LAB.before, LAB.during, AMBIENT)!;
    const k = throttleFactor(T, AMBIENT);
    expect(LAB.before / Math.sqrt(k)).toBeCloseTo(LAB.during, 6);
  });
});

describe("ограничение мощности по кислороду", () => {

  it("предел растёт пропорционально расходу", () => {
    // P = 3,0 МДж/кг · 1,25 кг/м³ · Q
    expect(oxygenLimitedPower_MW(1)).toBeCloseTo(HEAT_PER_KG_AIR_MJ * 1.25, 6);
    expect(oxygenLimitedPower_MW(10)!).toBeCloseTo(oxygenLimitedPower_MW(1)! * 10, 6);
  });

  it("при достатке воздуха мощность не меняется", () => {
    // 5 МВт при 30 м³/с: предел 112 МВт — ограничение не работает
    const r = limitPowerByOxygen(5, 30);
    expect(r.limited).toBe(false);
    expect(r.power_MW).toBe(5);
  });

  it("при нехватке воздуха мощность урезается", () => {
    // 8,52 МВт при 0,5 м³/с: предел 1,875 МВт
    const r = limitPowerByOxygen(8.52, 0.5);
    expect(r.limited).toBe(true);
    expect(r.power_MW).toBeCloseTo(1.875, 3);
  });

  it("выход CO растёт при нехватке кислорода", () => {
    expect(oxygenDeficitCoFactor(5, 30)).toBe(1);        // воздуха хватает
    expect(oxygenDeficitCoFactor(8.52, 0.5)).toBeGreaterThan(2);
    expect(oxygenDeficitCoFactor(1000, 0.1)).toBe(4);    // ограничено сверху
  });

  it("при падении расхода ограничивается МОЩНОСТЬ, а не температура", () => {
    // Сценарий, ради которого снят клип 0,5·Q_штат: расход рухнул в 5 раз.
    //
    // Физика здесь такая. Предел 3,0 МДж на килограмм воздуха отвечает полному
    // расходованию кислорода, и температура при этом — адиабатическая
    // (тысячи градусов), то есть заведомо выше потолка 1200 °C в calcFireTemp.
    // Поэтому ограничение по кислороду режет не температуру, а МОЩНОСТЬ: очаг,
    // задохнувшийся в опрокинутой струе, физически не может отдать сети 8,5 МВт.
    const q = 0.2;
    const pWanted = 8.52;
    const lim = limitPowerByOxygen(pWanted, q);
    expect(lim.limited).toBe(true);
    // Мощность урезана более чем в 10 раз — именно это и уходит в сеть.
    expect(lim.power_MW).toBeLessThan(pWanted / 10);
    // Температура в таком режиме держится у потолка — горение идёт горячо,
    // но уносит мало тепла, потому что мал массовый расход.
    expect(calcFireTemp(lim.power_MW, q, AMBIENT)).toBeGreaterThan(1000);
  });

  it("ограниченная мощность падает вместе с расходом", () => {
    // Это и даёт наблюдавшееся в опыте НАСЫЩЕНИЕ: опрокинутая струя не может
    // разогнаться, потому что вместе с расходом падает и мощность очага.
    const p1 = limitPowerByOxygen(8.52, 0.2).power_MW;
    const p2 = limitPowerByOxygen(8.52, 0.4).power_MW;
    expect(p2).toBeCloseTo(p1 * 2, 6);
  });
});

describe("нормативные формулы не изменились", () => {

  it("тепловая депрессия считается как прежде", () => {
    // h = g·Δz·(ρ₀ − ρ_гор), ρ = 353/(273+T)
    const h = calcThermalDepression(600, 20, 100, 30);
    const dz = 100 * Math.sin(30 * Math.PI / 180);
    const expected = 9.81 * dz * (353 / 293 - 353 / 873);
    expect(h).toBeCloseTo(expected, 6);
  });

  it("температура продуктов горения считается как прежде", () => {
    // Δt = Q·10⁶ / (L·1,25·1005)
    const t = calcFireTemp(8.52, 31.8, 20);
    const expected = 20 + (8.52e6) / (1.25 * 31.8 * 1005);
    expect(t).toBeCloseTo(expected, 6);
  });

  it("Норматив 4.5 даёт прежний результат", () => {
    const r = calcThermalDepressionNormative({
      airFlow_m3s: 30, sectionArea_m2: 12, angle_deg: 20,
      fireTime_min: 150, ambientTemp_C: 15,
    });
    // Контрольные значения формул (4.8)–(4.12)
    const l = 150 * (0.28 + 0.07 * (30 / 12));
    expect(r.l).toBeCloseTo(l, 6);
    expect(r.a).toBeCloseTo(Math.sqrt(12) / l, 6);
    expect(r.A).toBeCloseTo((100 * r.a) / (1.21 + 1.51 * (12 / 30)), 6);
    expect(r.dz).toBeCloseTo(l * Math.sin(20 * Math.PI / 180), 6);
  });
});

describe("область применимости", () => {

  it("ловит расход, перепутанный со скоростью", () => {
    // Ровно случай со схемы: S = 0,02 м², «Q» = 2,71 → V = 135 м/с
    const notes = checkApplicability({ area_m2: 0.02, flow_m3s: 2.71 });
    const v = notes.find(n => n.subject === "velocity");
    expect(v).toBeDefined();
    expect(v!.level).toBe("error");
    expect(v!.text).toContain("анемометра");
  });

  it("правильно введённые данные замечаний не вызывают", () => {
    const notes = checkApplicability({ area_m2: 12, flow_m3s: 30, fireTime_min: 150, power_MW: 8.52 });
    expect(notes).toHaveLength(0);
  });

  it("предупреждает о мегаваттах на лабораторной модели", () => {
    const notes = checkApplicability({ area_m2: LAB_AREA, flow_m3s: 0.054, power_MW: 8.52 });
    expect(notes.some(n => n.subject === "power")).toBe(true);
  });

  it("в режиме лабораторной модели малое сечение не считается ошибкой", () => {
    const plain = checkApplicability({ area_m2: LAB_AREA, flow_m3s: 0.054 });
    const lab = checkApplicability({ area_m2: LAB_AREA, flow_m3s: 0.054, labModel: true });
    expect(plain.some(n => n.subject === "area")).toBe(true);
    expect(lab.some(n => n.subject === "area")).toBe(false);
  });

  it("сообщает об ограничении времени 150 мин", () => {
    const notes = checkApplicability({ area_m2: 12, flow_m3s: 30, fireTime_min: 300 });
    expect(notes.some(n => n.subject === "time")).toBe(true);
  });
});

describe("пресеты очага", () => {

  it("лабораторный пресет даёт мощность порядка замеренной", () => {
    const preset = getFirePreset("lab_timber")!;
    expect(preset.labModel).toBe(true);
    const qDuring = LAB.during * LAB_AREA;
    const P = calcFirePowerFromMaterial({ ...preset.fields, flow: qDuring, length: 0.3 });
    expect(P).not.toBeNull();
    const kW = P! * 1000;
    // Обратный расчёт по падению расхода дал 3–30 кВт — пресет должен попадать
    // в тот же диапазон, иначе он не описывает опыт.
    expect(kW).toBeGreaterThan(3);
    expect(kW).toBeLessThan(30);
  });

  it("пресет техники не изменился", () => {
    // Эталон прежнего расчёта: 1200/400/200 кг при 31,8 м³/с → 8,52 МВт
    const preset = getFirePreset("vehicle_std")!;
    const P = calcFirePowerFromMaterial({ ...preset.fields, flow: 31.8 });
    expect(P!).toBeCloseTo(8.52, 1);
  });

  it("лабораторный очаг на порядки слабее натурного", () => {
    const lab = calcFirePowerFromMaterial({
      ...getFirePreset("lab_timber")!.fields, flow: 0.044, length: 0.3,
    })!;
    const mine = calcFirePowerFromMaterial({
      ...getFirePreset("vehicle_std")!.fields, flow: 31.8,
    })!;
    expect(mine / lab).toBeGreaterThan(100);
  });
});

describe("подобие модели и рудника", () => {

  it("модель недооценивает тепловую депрессию", () => {
    const cmp = compareSimilarity(
      { velocity_ms: 2.71, hydraulicDiameter_m: 0.16, gasTemp_C: 180, ambientTemp_C: 20 },
      { velocity_ms: 2.0,  hydraulicDiameter_m: 3.5,  gasTemp_C: 180, ambientTemp_C: 20 },
    );
    expect(cmp.ratio).not.toBeNull();
    expect(cmp.ratio!).toBeGreaterThan(2);
    expect(cmp.note).toContain("НЕДООЦЕНИВАЕТ");
  });

  it("число Фруда падает с ростом диаметра", () => {
    const small = buoyancyFroude(2.71, 0.16, 180, 20)!;
    const big = buoyancyFroude(2.71, 3.5, 180, 20)!;
    expect(small).toBeGreaterThan(big);
  });
});