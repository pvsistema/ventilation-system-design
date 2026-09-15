// ─────────────────────────────────────────────────────────────────────────────
// Проверка расчёта взрывоопасности рудничной атмосферы на соответствие
// Приложению № 11 к ФНП (приказ Ростехнадзора от 11.12.2020 № 520).
//
// Главная задача тестов — закрепить совпадение расчётных треугольников с
// рисунками 1–6 приложения. Рисунки оцифрованы (см. FIGURE_CHECKPOINTS), и
// если кто-то поправит константы или формулу построения, расхождение с
// нормативом всплывёт здесь, а не на разборе аварии.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  calcExplosibility, buildTriangle, figureByPCO, pointInTriangle,
  explosiveOnDilution, FIGURE_CHECKPOINTS, GAS_LIMITS, O2_FRESH,
  verifyFigure, verificationLabel, FIGURE_TOLERANCE,
} from "@/lib/explosibility";

describe("взрывоопасность рудничной атмосферы (Приложение № 11)", () => {

  // ── Формулы (1)–(5) ───────────────────────────────────────────────────
  it("формула (1): C_г — сумма трёх горючих газов", () => {
    const r = calcExplosibility({ ch4: 1.2, co: 0.8, h2: 0.3, o2: 12.5, co2: 6 });
    // CO₂ в сумму НЕ входит — это ключевое требование нормы
    expect(r.cg).toBeCloseTo(2.3, 6);
  });

  it("формулы (2)–(4): доли газов в смеси", () => {
    const r = calcExplosibility({ ch4: 1.2, co: 0.8, h2: 0.3, o2: 12.5 });
    expect(r.pCO).toBeCloseTo(0.8 / 2.3, 4);
    expect(r.pCH4).toBeCloseTo(1.2 / 2.3, 4);
    expect(r.pH2).toBeCloseTo(0.3 / 2.3, 4);
  });

  it("формула (5): сумма долей равна единице", () => {
    const r = calcExplosibility({ ch4: 3.5, co: 1.5, h2: 0.8, o2: 5 });
    expect(r.pSum).toBeCloseTo(1, 6);
    expect(r.pSumOk).toBe(true);
  });

  it("горючих газов нет — деления на ноль не происходит", () => {
    const r = calcExplosibility({ ch4: 0, co: 0, h2: 0, o2: 20.9 });
    expect(r.cg).toBe(0);
    expect(r.state).toBe("no-fuel");
    expect(Number.isFinite(r.pCO)).toBe(true);
  });

  // ── Выбор рисунка по P_CO ─────────────────────────────────────────────
  it("рисунок приложения выбирается по доле оксида углерода", () => {
    // Рис. 1–6 отвечают P_CO = 0,0 / 0,1 / 0,2 / 0,3 / 0,4 / 0,5
    expect(figureByPCO(0.0).no).toBe(1);
    expect(figureByPCO(0.1).no).toBe(2);
    expect(figureByPCO(0.2).no).toBe(3);
    expect(figureByPCO(0.3).no).toBe(4);
    expect(figureByPCO(0.4).no).toBe(5);
    expect(figureByPCO(0.5).no).toBe(6);
    // промежуточное значение — ближайший рисунок, с отметкой о неточности
    const f = figureByPCO(0.348);
    expect(f.no).toBe(4);
    expect(f.exact).toBe(false);
  });

  // ── Сверка с оцифрованными рисунками ──────────────────────────────────
  it("предельный кислород совпадает с рисунками приложения", () => {
    // Допуск 0,15 % — это толщина линии на растре рисунка
    FIGURE_CHECKPOINTS.forEach(cp => {
      const t = buildTriangle(cp.pCO, cp.pCH4);
      const err = Math.abs(t.nose.y - cp.noseO2);
      expect(err, `рис. ${cp.figure}, P_CH₄=${cp.pCH4}: расчёт ${t.nose.y.toFixed(2)} против ${cp.noseO2}`)
        .toBeLessThan(0.15);
    });
  });

  it("чистый метан даёт классические пределы 5–15 % и предельный O₂ 12,2 %", () => {
    const t = buildTriangle(0, 1);
    expect(t.lel).toBeCloseTo(GAS_LIMITS.ch4.lel, 6);
    expect(t.uel).toBeCloseTo(GAS_LIMITS.ch4.uel, 6);
    expect(t.nose.y).toBeCloseTo(GAS_LIMITS.ch4.noseO2, 6);
  });

  it("крайний треугольник рис. 1 совпадает с оцифровкой по ВПВ", () => {
    // Оцифровка дала крайнюю правую вершину C_г ≈ 34,2 при P_CH₄ = 0,3
    const t = buildTriangle(0, 0.3);
    expect(Math.abs(t.uel - 34.2)).toBeLessThan(0.4);
    // вершины лежат на линии свежего воздуха
    expect(t.high.y).toBeCloseTo(O2_FRESH * (1 - t.uel / 100), 6);
    expect(t.low.y).toBeCloseTo(O2_FRESH * (1 - t.lel / 100), 6);
  });

  it("предельный кислород считается по Ле-Шателье, а не усреднением", () => {
    // Арифметическое усреднение завышало бы предельный O₂ примерно на 1 %,
    // из-за чего взрывоопасная смесь могла быть признана безопасной.
    const t = buildTriangle(0, 0.3);
    const arithmetic = 0.3 * GAS_LIMITS.ch4.noseO2 + 0.7 * GAS_LIMITS.h2.noseO2;
    expect(t.nose.y).toBeLessThan(arithmetic - 0.8);
    expect(t.nose.y).toBeCloseTo(6.18, 1);
  });

  // ── Вывод о состоянии атмосферы ───────────────────────────────────────
  it("метановая смесь 7 % при O₂ 19 % — взрывоопасна", () => {
    const r = calcExplosibility({ ch4: 7, co: 0, h2: 0, o2: 19 });
    expect(r.inside).toBe(true);
    expect(r.state).toBe("explosive");
    expect(r.verdict).toContain("ВЗРЫВООПАСНОМ");
  });

  it("свежая струя — не взрывоопасна", () => {
    const r = calcExplosibility({ ch4: 0.3, co: 0, h2: 0, o2: 20.8, co2: 0.1 });
    expect(r.inside).toBe(false);
    expect(r.state).toBe("safe");
  });

  it("бедная кислородом смесь за перемычкой — вне треугольника", () => {
    const r = calcExplosibility({ ch4: 1.2, co: 0.8, h2: 0.3, o2: 12.5, co2: 6 });
    expect(r.inside).toBe(false);
  });

  it("богатая смесь без кислорода становится опасной при подсосе воздуха", () => {
    // Много горючих, кислорода мало: сама по себе не взрывается, но при
    // разбавлении свежим воздухом путь точки пересекает треугольник.
    const r = calcExplosibility({ ch4: 30, co: 0, h2: 0, o2: 2 });
    expect(r.inside).toBe(false);
    expect(r.state).toBe("explosive-on-dilution");
    expect(r.verdict).toContain("подсосе");
  });

  it("точка внутри треугольника определяется строго", () => {
    const t = buildTriangle(0, 1);          // чистый метан
    expect(pointInTriangle({ x: 9.5, y: 18 }, t)).toBe(true);   // стехиометрия
    expect(pointInTriangle({ x: 2, y: 20 }, t)).toBe(false);    // ниже НПВ
    expect(pointInTriangle({ x: 9.5, y: 5 }, t)).toBe(false);   // мало кислорода
  });

  it("разбавление воздухом ведёт точку к свежей струе", () => {
    const t = buildTriangle(0, 1);
    // Точка правее ВПВ на линии воздуха — при разбавлении пройдёт через треугольник
    expect(explosiveOnDilution({ x: 40, y: 12 }, t)).toBe(true);
    // Бедная смесь ниже НПВ — не станет опасной
    expect(explosiveOnDilution({ x: 1, y: 20.5 }, t)).toBe(false);
  });

  // ── Протокол ──────────────────────────────────────────────────────────
  it("в ход расчёта попадают все формулы приложения", () => {
    const r = calcExplosibility({ ch4: 1.2, co: 0.8, h2: 0.3, o2: 12.5 });
    const formulas = r.steps.map(s => s.formula).filter(Boolean);
    expect(formulas).toEqual(["(1)", "(2)", "(3)", "(4)", "(5)"]);
  });

  // ── Отметка о верификации ─────────────────────────────────────────────
  it("для рисунка с контрольными точками верификация прямая", () => {
    // P_CO = 0 → рис. 1, по нему точки оцифрованы
    const v = verifyFigure(0, 1);
    expect(v.status).toBe("direct");
    expect(v.figureNo).toBe(1);
    expect(v.checkpoints.length).toBeGreaterThan(0);
    expect(v.maxDelta).toBeLessThan(FIGURE_TOLERANCE);
    expect(v.airLineOk).toBe(true);
  });

  it("для рисунка без контрольных точек верификация косвенная", () => {
    // P_CO = 0,5 → рис. 6, точек по нему в FIGURE_CHECKPOINTS нет
    const v = verifyFigure(0.5, 0.3);
    expect(v.status).toBe("indirect");
    expect(v.figureNo).toBe(6);
    expect(v.note).toContain("не снимались");
  });

  it("отметка о верификации ссылается на норматив и номер рисунка", () => {
    const r = calcExplosibility({ ch4: 1.2, co: 0.8, h2: 0.3, o2: 12.5 });
    expect(r.verification.reference).toContain(`рис. ${r.figureNo}`);
    expect(r.verification.reference).toContain("Приложения № 11");
    expect(r.verification.reference).toContain("520");
  });

  it("верификация попадает отдельным шагом в ход расчёта", () => {
    const r = calcExplosibility({ ch4: 7, co: 0, h2: 0, o2: 19 });
    const step = r.steps.find(s => s.title === "Верификация методики");
    expect(step).toBeDefined();
    expect(step!.expression).toContain("Подтверждено");
    expect(verificationLabel(r.verification)).toContain(`рис. ${r.figureNo}`);
  });

  it("исправная методика не даёт предупреждения о непройденной сверке", () => {
    const r = calcExplosibility({ ch4: 7, co: 0, h2: 0, o2: 19 });
    expect(r.verification.status).not.toBe("failed");
    expect(r.warnings.some(w => w.includes("НЕ ПРОЙДЕНА"))).toBe(false);
  });

  it("несовпадение P_CO с шагом рисунков отмечается предупреждением", () => {
    const r = calcExplosibility({ ch4: 1.2, co: 0.8, h2: 0.3, o2: 12.5 });
    expect(r.warnings.some(w => w.includes("не совпадает с шагом рисунков"))).toBe(true);
  });

  it("сумма компонентов свыше 100 % — предупреждение о данных анализа", () => {
    const r = calcExplosibility({ ch4: 50, co: 30, h2: 20, o2: 15, co2: 10 });
    expect(r.warnings.some(w => w.includes("превышает 100"))).toBe(true);
  });
});