// ─────────────────────────────────────────────────────────────────────────────
// fireReversalDetection.test.ts — сторожит обнаружение опрокидывания струи
// В ВЫРАБОТКЕ, КУДА НЕ ИДЁТ ДЫМ (Приложение 7).
//
// ЧТО ЛОВИМ. Разворот струи фиксировался только там, где прошёл фронт
// задымления: в самой ветви-очаге и в ветвях, до которых дошёл дым в обходе
// Dijkstra. Ветвь без дыма в результат не попадала вовсе, и её разворот
// терялся молча — ни синей подсветки, ни счётчика «Опрокид.», ни строки в
// журнале.
//
// Именно так выглядит пожар в стволе, идущем на поверхность. По Прил. 7 при
// ВОСХОДЯЩЕМ проветривании сам горящий ствол опрокинуться не может: тепловая
// депрессия направлена по потоку и только разгоняет его. Опрокидывается
// СОСЕДНЯЯ выработка того же контура — условие (7.1) h_т < R·Q₀² написано про
// неё. А соседний ствол при этом ЧИСТЫЙ: пожар высасывает через него воздух,
// струя разворачивается вниз и тянет в шахту свежий наружный воздух.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { calcFireMode } from "@/lib/fireCalculator";
import type { TopoNode, TopoBranch } from "@/lib/topology";

// Сеть: воздухоподающий ствол → штрек → узел сопряжения D2, из которого на
// поверхность идут ДВА ствола (главный с ГВУ и вспомогательный).
const nodes = [
  { id: "ATM",  z: 600, x: 0,   y: 0   },
  { id: "D1",   z: 0,   x: 0,   y: 100 },
  { id: "D2",   z: 0,   x: 100, y: 100 },
  { id: "ATM2", z: 600, x: 100, y: 0   },
  { id: "ATM3", z: 600, x: 200, y: 0   },
] as unknown as TopoNode[];

const br = (
  id: string, fromId: string, toId: string,
  flow: number, originalFlow: number, angle: number,
  extra: Record<string, unknown> = {},
) => ({
  id, fromId, toId, flow, originalFlow, angle,
  length: 600, area: 20, perimeter: 18, resistance: 0.03,
  dP: 200, dPTotal: 200, ...extra,
}) as unknown as TopoBranch;

// Очаг во вспомогательном стволе: восходящее проветривание, выход на поверхность.
const fireSeat = (flow: number, originalFlow: number) =>
  br("SH_AUX", "D2", "ATM3", flow, originalFlow, 90,
     { hasFire: true, fireHeatRelease: 8.5, fireMode: "heat", fireT: 0.5 });

describe("Опрокидывание вне фронта задымления (Прил. 7)", () => {
  it("развёрнутый чистый ствол на поверхность попадает в reversedBranches", () => {
    const branches = [
      br("SH_IN", "ATM", "D1", 100, 103, -90),
      br("W1", "D1", "D2", 100, 103, 0, { length: 1000 }),
      // Был исходящим (+158), стал входящим (−40) — струя развернулась.
      // Дым сюда не идёт: воздух в ствол втягивается с поверхности.
      br("SH_OUT", "D2", "ATM2", -40, 158, 90),
      fireSeat(140, 55),
    ];
    const r = calcFireMode(branches, nodes, 15, 50);
    expect(r.reversedBranches.has("SH_OUT")).toBe(true);
  });

  it("сам горящий восходящий ствол опрокинутым не считается", () => {
    // Прил. 7: тепловая депрессия при восходящем проветривании идёт ПО потоку
    // и разгоняет его. Опрокинуть горящую восходящую выработку пожар не может.
    const branches = [
      br("SH_IN", "ATM", "D1", 100, 103, -90),
      br("W1", "D1", "D2", 100, 103, 0, { length: 1000 }),
      br("SH_OUT", "D2", "ATM2", -40, 158, 90),
      fireSeat(140, 55),
    ];
    const r = calcFireMode(branches, nodes, 15, 50);
    expect(r.reversedBranches.has("SH_AUX")).toBe(false);
    expect(r.branches.get("SH_AUX")!.ascending).toBe(true);
  });

  it("развёрнутая чистая ветвь не засчитывается как задымлённая", () => {
    // Иначе счётчик «Задымлено» в панели врёт, а на схеме чистый ствол
    // закрашивается дымом. Факт разворота показывает синяя аура.
    const branches = [
      br("SH_IN", "ATM", "D1", 100, 103, -90),
      br("W1", "D1", "D2", 100, 103, 0, { length: 1000 }),
      br("SH_OUT", "D2", "ATM2", -40, 158, 90),
      fireSeat(140, 55),
    ];
    const r = calcFireMode(branches, nodes, 15, 50);
    expect(r.branches.get("SH_OUT")!.smokeDensity).toBe(0);
    expect(r.smokedCount).toBeLessThan(r.branches.size);
  });

  it("без смены знака расхода опрокидывания нет", () => {
    const branches = [
      br("SH_IN", "ATM", "D1", 105, 100, -90),
      br("W1", "D1", "D2", 105, 100, 0, { length: 1000 }),
      br("SH_OUT", "D2", "ATM2", 105, 100, 90,
         { hasFire: true, fireHeatRelease: 8.5, fireMode: "heat", fireT: 0.5 }),
    ];
    const r = calcFireMode(branches, nodes, 15, 50);
    expect(r.reversedBranches.size).toBe(0);
  });

  it("численный шум на почти стоящей струе не считается разворотом", () => {
    // Знак расхода в тупиковой/уравновешенной ветви «дрожит» у нуля. Принимать
    // это за опрокидывание нельзя — иначе счётчик наполняется мусором.
    const branches = [
      br("SH_IN", "ATM", "D1", 105, 100, -90),
      br("W1", "D1", "D2", 105, 100, 0, { length: 1000 }),
      br("DEAD", "D1", "D2", -0.02, 0.01, 0, { length: 300 }),
      br("SH_OUT", "D2", "ATM2", 105, 100, 90,
         { hasFire: true, fireHeatRelease: 8.5, fireMode: "heat", fireT: 0.5 }),
    ];
    const r = calcFireMode(branches, nodes, 15, 50);
    expect(r.reversedBranches.has("DEAD")).toBe(false);
  });
});
