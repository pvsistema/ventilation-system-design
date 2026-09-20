// ─────────────────────────────────────────────────────────────────────────────
// Тесты соглашения о единицах сопротивления.
//
// Проверяют не арифметику переводов (она тривиальна), а ГРАНИЦЫ, на которых
// проект раньше разъезжался: результат формулы Аткинсона, сложение R выработки
// с R перемычки, депрессию и миграцию старых файлов. Именно эти стыки дали
// расхождение по ветви 432 — там депрессия выработки была завышена в g раз,
// а вклад перемычки во столько же занижен.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  G_ACCEL, kmurgToSi, siToKmurg, murgToSi, siToBaseUnit,
  depressionPa, resistanceFromSurvey, fanCrossingRsi,
} from "./resistanceUnits";
import { calcResistance, resistanceFromAlpha } from "./aerodynamics";
import { migrateProject, PROJECT_VERSION } from "./projectMigrations";

describe("единицы сопротивления: переводы", () => {
  it("кМюрг ↔ СИ обратимы, множитель — стандартное g", () => {
    expect(G_ACCEL).toBeCloseTo(9.80665, 6);
    expect(kmurgToSi(1)).toBeCloseTo(9.80665, 6);
    expect(siToKmurg(kmurgToSi(65.2))).toBeCloseTo(65.2, 9);
  });

  it("Мюрг в тысячу раз мельче кМюрг", () => {
    expect(murgToSi(1000)).toBeCloseTo(kmurgToSi(1), 9);
  });

  it("siToBaseUnit даёт базовую единицу справочника (Мюрг)", () => {
    // 1 кМюрг = 1000 Мюрг; siToBaseUnit ждут все fromBase() из unitsConfig.
    expect(siToBaseUnit(kmurgToSi(1))).toBeCloseTo(1000, 6);
  });
});

describe("депрессия ΔP = R·Q²", () => {
  it("R в Н·с²/м⁸ даёт паскали без множителя g", () => {
    // Ветвь R=2 Н·с²/м⁸ при Q=10 м³/с: ΔP = 2·100 = 200 Па.
    expect(depressionPa(2, 10)).toBeCloseTo(200, 9);
  });

  it("знак сохраняется: обратный поток — отрицательная депрессия", () => {
    expect(depressionPa(2, -10)).toBeCloseTo(-200, 9);
  });

  it("сопротивление по съёмке замыкается на депрессию", () => {
    // Замерили ΔP=200 Па при Q=10 → R должно вернуть ту же депрессию.
    const r = resistanceFromSurvey(200, 10);
    expect(depressionPa(r, 10)).toBeCloseTo(200, 6);
  });

  it("нулевой расход при съёмке не даёт бесконечность", () => {
    expect(resistanceFromSurvey(200, 0)).toBe(0);
  });
});

describe("формула Аткинсона R = α·P·L/S³", () => {
  // α справочный (×10⁻⁴ Н·с²/м⁴) — формула сразу в СИ, домножать на g нельзя.
  // Выработка: α=35, P=12 м, L=500 м, S=10 м².
  const R = resistanceFromAlpha(35, 12, 500, 10);

  it("даёт Н·с²/м⁸ напрямую", () => {
    expect(R).toBeCloseTo((35e-4 * 12 * 500) / 1000, 9);
  });

  it("депрессия такой выработки — паскали, а не мм вод. ст.", () => {
    // При Q=20 м³/с: ΔP = R·400. Если бы где-то остался множитель 9,81,
    // значение было бы почти на порядок больше.
    expect(depressionPa(R, 20)).toBeCloseTo(R * 400, 9);
  });
});

describe("ручное сопротивление вводится в кМюрг", () => {
  const base = {
    alpha: 0, roughness: 0, localXi: 0,
    S: 10, P: 12, L: 500,
  } as const;

  it("manualR=1 кМюрг превращается в g Н·с²/м⁸", () => {
    const r = calcResistance({ ...base, mode: "manual", manualR: 1 });
    expect(r.R).toBeCloseTo(G_ACCEL, 6);
  });

  it("ручное и расчётное R складываются в одних единицах", () => {
    // Задаём вручную ровно то R, что даёт Аткинсон, и ждём совпадения.
    const auto = calcResistance({ ...base, mode: "alpha", alpha: 35, manualR: 0 });
    const manual = calcResistance({
      ...base, mode: "manual", manualR: siToKmurg(auto.R),
    });
    expect(manual.R).toBeCloseTo(auto.R, 9);
  });
});

describe("перемычка ГВУ «внутри перемычки»", () => {
  it("fanCrossingR читается как Мюрг и переводится в СИ", () => {
    const r = fanCrossingRsi({ hasFan: true, fanInstall: "Внутри перемычки", fanCrossingR: 1000 });
    expect(r).toBeCloseTo(kmurgToSi(1), 9);
  });

  it("без вентилятора и при установке «без перемычки» вклад нулевой", () => {
    expect(fanCrossingRsi({ hasFan: false, fanCrossingR: 1000 })).toBe(0);
    expect(fanCrossingRsi({ hasFan: true, fanInstall: "Без перемычки", fanCrossingR: 1000 })).toBe(0);
  });
});

describe("миграция проектов на версию 3", () => {
  it("ручное R перемычки переводится из Н·с²/м⁸ в кМюрг", () => {
    const old = {
      version: 2,
      branches: [{ id: "b1", bulkheadManualR: 9.80665 }],
      schemaSymbols: [{ id: "s1", bkManualR: 19.6133 }],
    };
    const next = migrateProject(old);
    expect(next.version).toBe(PROJECT_VERSION);
    expect(next.branches[0].bulkheadManualR).toBeCloseTo(1, 6);
    expect(next.schemaSymbols[0].bkManualR).toBeCloseTo(2, 4);
  });

  it("физика перемычки от миграции не меняется", () => {
    // До правки значение 9,80665 складывалось с R ветви как СИ. После правки
    // оно хранится как 1 кМюрг и переводится обратно в те же 9,80665.
    const next = migrateProject({ version: 2, branches: [{ bulkheadManualR: 9.80665 }] });
    expect(kmurgToSi(next.branches[0].bulkheadManualR as number)).toBeCloseTo(9.80665, 6);
  });

  it("повторный прогон ничего не делит второй раз", () => {
    const once = migrateProject({ version: 2, branches: [{ bulkheadManualR: 9.80665 }] });
    const twice = migrateProject(once);
    expect(twice.branches[0].bulkheadManualR).toBeCloseTo(1, 6);
  });

  it("файл текущей версии не трогается", () => {
    const cur = { version: PROJECT_VERSION, branches: [{ bulkheadManualR: 65 }] };
    expect(migrateProject(cur).branches[0].bulkheadManualR).toBe(65);
  });

  it("проект без перемычек и без полей переживает миграцию", () => {
    expect(() => migrateProject({ version: 1 })).not.toThrow();
    expect(migrateProject({ version: 1, branches: [{ id: "b" }] }).branches[0]).toEqual({ id: "b" });
  });
});
