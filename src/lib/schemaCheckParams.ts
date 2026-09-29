// ─────────────────────────────────────────────────────────────────────────────
// Проверка схемы: НЕПРАВДОПОДОБНЫЕ ПАРАМЕТРЫ ВЫРАБОТОК.
//
// Расчёт по таким данным пройдёт, но цифры будут неверными: сечение 0,05 м²
// вместо 5, длина короче расстояния между узлами, вентилятор без
// характеристики, «открытая» перемычка. Чаще всего это следы импорта из
// CSV/Excel (сдвиг столбцов, запятая вместо точки, единицы в мм вместо м).
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch, calcBranchLength } from "./topology";
import { getFanById } from "./fanCurves";
import { branchBulkheadRkMurg } from "./bulkheads";
import { type BranchNote, type NodeNote, pushCapped, fmtNum } from "./schemaCheckTypes";
import type { BranchBulkheadInfo } from "./branchBulkheadInfo";

export interface ParamsCheckResult {
  /** Сечение не задано или неправдоподобно. */
  badArea: BranchNote[];
  /** Ручная длина короче расстояния между узлами. */
  shortManualLen: BranchNote[];
  /** Коэффициент α / шероховатость равны нулю или вне типичного диапазона. */
  badAlpha: BranchNote[];
  /** Вентилятор без характеристики или с нулевой депрессией. */
  fanNoCurve: BranchNote[];
  /** Перемычка с нулевым сопротивлением — по сути её нет. */
  zeroBulkhead: BranchNote[];
  /** Отрицательные / нечисловые значения (обычно после импорта). */
  invalidValues: BranchNote[];
  /** Узлы с Z = 0 среди глубокой сети — потерянные отметки. */
  lostZ: NodeNote[];
  /** Очень короткие ветви — узлы стоит слить. */
  tinyBranches: BranchNote[];
  truncated: boolean;
}

export interface ParamsCheckOptions {
  areaMin?: number;     // м²
  areaMax?: number;     // м²
  tinyLength?: number;  // м
  alphaMin?: number;    // ×10⁻⁴ Н·с²/м⁴
  alphaMax?: number;    // ×10⁻⁴ Н·с²/м⁴
  /** Вентсооружения ветвей с R, которое уходит в решатель (значки + вкладка). */
  bulkheads?: Map<string, BranchBulkheadInfo>;
}

// Диапазон α, ×10⁻⁴ кгс·с²/м⁴ (единицы поля alphaCoef). Методика ВГСЧ
// допускает 0,001…1,0 Н·с²/м⁴ — это ≈ 1…1000 в наших единицах.
const ALPHA_MIN_DEFAULT = 1;
const ALPHA_MAX_DEFAULT = 1000;

const bad = (v: unknown) => typeof v !== "number" || !Number.isFinite(v);

export function checkParams(
  nodes: TopoNode[],
  branches: TopoBranch[],
  opts: ParamsCheckOptions = {},
): ParamsCheckResult {
  const areaMin = opts.areaMin ?? 0.5;
  const areaMax = opts.areaMax ?? 60;
  const tiny = opts.tinyLength ?? 0.5;
  const ALPHA_MIN = opts.alphaMin ?? ALPHA_MIN_DEFAULT;
  const ALPHA_MAX = opts.alphaMax ?? ALPHA_MAX_DEFAULT;
  let truncated = false;
  const push = <T,>(arr: T[], item: T) => { if (!pushCapped(arr, item)) truncated = true; };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const badArea: BranchNote[] = [];
  const shortManualLen: BranchNote[] = [];
  const badAlpha: BranchNote[] = [];
  const fanNoCurve: BranchNote[] = [];
  const zeroBulkhead: BranchNote[] = [];
  const invalidValues: BranchNote[] = [];
  const tinyBranches: BranchNote[] = [];

  for (const b of branches) {
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    // Трубы вентстава и утечки моделируются особо — сечение и α у них свои.
    const isAux = !!b.isVentPipeBranch || b.isLeakage;

    // Нечисловые и отрицательные значения
    const broken: string[] = [];
    if (bad(b.area) || b.area < 0) broken.push("сечение");
    if (bad(b.length) || b.length < 0) broken.push("длина");
    if (bad(b.resistance) || b.resistance < 0) broken.push("сопротивление");
    if (b.resistanceMode === "manual" && (bad(b.manualR) || b.manualR < 0)) broken.push("R вручную");
    if (broken.length > 0) {
      push(invalidValues, { branch: b, note: `Некорректное значение: ${broken.join(", ")}` });
      continue;
    }

    // Сечение
    if (!isAux && b.resistanceMode !== "manual") {
      if (b.area <= 0) push(badArea, { branch: b, note: "Сечение не задано" });
      else if (b.area < areaMin) push(badArea, { branch: b, note: `S = ${fmtNum(b.area, 2)} м² — слишком мало (ввод в мм² или см?)` });
      else if (b.area > areaMax) push(badArea, { branch: b, note: `S = ${fmtNum(b.area, 1)} м² — слишком много для выработки` });
    }

    // Ручная длина короче прямой между узлами — физически невозможно
    if (b.manualLength && fn && tn && b.length > 0) {
      const geo = calcBranchLength(fn, tn);
      if (geo - b.length > Math.max(1, geo * 0.05)) {
        push(shortManualLen, { branch: b, note: `Вручную ${fmtNum(b.length, 0)} м, а между узлами ${fmtNum(geo, 0)} м` });
      }
    }

    // Коэффициент сопротивления
    if (!isAux) {
      if (b.resistanceMode === "alpha" || b.resistanceMode === "surface") {
        const a = b.alphaCoef;
        if (!(a > 0)) push(badAlpha, { branch: b, note: "α = 0 — у выработки нет сопротивления трению" });
        else if (a < ALPHA_MIN || a > ALPHA_MAX) push(badAlpha, { branch: b, note: `α = ${fmtNum(a, 1)}·10⁻⁴ — вне типичного диапазона ${ALPHA_MIN}…${ALPHA_MAX}` });
      } else if (b.resistanceMode === "roughness" && !(b.roughness > 0)) {
        push(badAlpha, { branch: b, note: "Шероховатость = 0" });
      }
    }

    // Вентилятор
    if (b.hasFan && !b.fanStopped) {
      if (b.fanMode === "curve" && !getFanById(b.fanCurveId)) {
        push(fanNoCurve, { branch: b, note: `Режим «по характеристике», но модель ${b.fanCurveId ? `«${b.fanCurveId}» не найдена` : "не выбрана"}` });
      } else if (b.fanMode === "constant" && !(b.fanPressure > 0)) {
        push(fanNoCurve, { branch: b, note: "Постоянная депрессия = 0 Па — вентилятор ничего не создаёт" });
      } else if (b.fanMode === "fixed" && !((b.fanFixedQ ?? 0) > 0)) {
        push(fanNoCurve, { branch: b, note: "Заданный расход = 0 м³/с" });
      }
    }

    // Перемычка с нулевым R
    // Значки на ветви главнее поля вкладки: R, заданное вручную в значке,
    // учитывается так же, как в решателе. Открытая дверь с R = 0 — норма.
    const bk = opts.bulkheads?.get(b.id);
    if (bk) {
      if (bk.present && !bk.allOpen && bk.rKmu <= 0) {
        push(zeroBulkhead, { branch: b, note: `${bk.name} — сопротивление 0 (${bk.modeLabel}), воздух проходит свободно` });
      }
    } else if (b.hasBulkhead && branchBulkheadRkMurg(b) <= 0) {
      push(zeroBulkhead, { branch: b, note: `${b.bulkheadName || "Перемычка"} — сопротивление 0, воздух проходит свободно` });
    }

    // Очень короткая ветвь
    if (fn && tn && b.fromId !== b.toId && !b.manualLength) {
      const geo = calcBranchLength(fn, tn);
      if (geo > 0 && geo < tiny) push(tinyBranches, { branch: b, note: `Длина ${fmtNum(geo, 2)} м — узлы стоит объединить` });
    }
  }

  // Потерянные отметки: сеть лежит глубоко, а отдельные узлы — ровно на 0.
  // Такой узел даёт ложный перепад высот, а значит ложную естественную тягу.
  const lostZ: NodeNote[] = [];
  const zs = nodes.map((n) => n.z).filter((z) => Number.isFinite(z) && Math.abs(z) > 1e-6).sort((a, b) => a - b);
  if (zs.length >= 5) {
    const median = zs[Math.floor(zs.length / 2)];
    if (Math.abs(median) >= 50) {
      const nb = new Map<string, number[]>();
      for (const b of branches) {
        const fz = nodeById.get(b.fromId)?.z, tz = nodeById.get(b.toId)?.z;
        if (fz !== undefined && tz !== undefined) {
          (nb.get(b.fromId) ?? nb.set(b.fromId, []).get(b.fromId)!).push(tz);
          (nb.get(b.toId) ?? nb.set(b.toId, []).get(b.toId)!).push(fz);
        }
      }
      for (const n of nodes) {
        if (Math.abs(n.z) > 1e-6 || n.atmosphereLink) continue;
        const neigh = nb.get(n.id) ?? [];
        // Отметка 0 подозрительна, только если все соседи глубоко
        if (neigh.length > 0 && neigh.every((z) => Math.abs(z) >= 30)) {
          push(lostZ, { node: n, note: `Z = 0, а у соседних узлов ${fmtNum(Math.min(...neigh), 0)}…${fmtNum(Math.max(...neigh), 0)} м` });
        }
      }
    }
  }

  return { badArea, shortManualLen, badAlpha, fanNoCurve, zeroBulkhead, invalidValues, lostZ, tinyBranches, truncated };
}
