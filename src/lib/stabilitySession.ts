// ─────────────────────────────────────────────────────────────────────────────
// stabilitySession.ts — общие для «Акта устойчивости» и «Отчёта ВДС» условия
// расчёта устойчивости при пожаре и последний результат расчёта ПО ФАКТУ.
//
// ЗАЧЕМ. Раньше отчёт ВДС считал устойчивость сам: с жёсткими фильтрами
// (5°, 30 м), своей температурой и только по нормативной оценке. Акт, выгруженный
// из вкладки «Вентиляция», мог говорить «неустойчиво», а отчёт ВДС по той же
// схеме — «устойчиво». Теперь оба документа берут условия отбора и результат
// итеративного расчёта сети при пожаре из одного места.
//
// Хранится в памяти сеанса (результат расчёта привязан к текущему состоянию
// схемы и после перезагрузки всё равно устарел бы), условия отбора — ещё и в
// localStorage, чтобы не вводить их заново.
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoBranch, TopoNode } from "./topology";
import { hasFireLoad, type FireStabilityFact } from "./fireStability";
import { getThermalDepMethod } from "./fireCalculator";

export interface StabilitySettings {
  angleFilter: number;   // мин. угол наклона, град
  lengthFilter: number;  // мин. длина, м
  ambientTemp: number;   // температура воздуха, °C
}

export const DEFAULT_STABILITY_SETTINGS: StabilitySettings = {
  angleFilter: 5,
  lengthFilter: 30,
  ambientTemp: 20,
};

const LS_KEY = "pvs_stability_settings";

/**
 * Отпечаток входных данных расчёта по факту: расходы и сопротивления сети,
 * пожарная нагрузка, геометрия, отметки узлов и метод тепловой депрессии.
 * Факт действителен, только пока отпечаток совпадает с текущей схемой.
 */
export function stabilityInputsKey(branches: TopoBranch[], nodes: TopoNode[]): string {
  const parts: string[] = [getThermalDepMethod()];
  for (const b of branches) {
    parts.push(`${b.id}|${b.fromId}|${b.toId}|${(b.flow ?? 0).toFixed(4)}|${b.rTotal ?? b.resistance ?? 0}|${b.dPTotal ?? b.dP ?? 0}|${b.length}|${b.area}|${b.angle}`);
    if (hasFireLoad(b)) {
      const fl = Object.entries(b)
        // fireComputed*/fireThermalDepression — результаты аварийного расчёта,
        // а не исходные данные: их перезапись не делает факт устаревшим.
        .filter(([k]) => k.startsWith("fire") && !k.startsWith("fireComputed") && k !== "fireThermalDepression")
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .sort()
        .join(",");
      parts.push(fl);
    }
  }
  for (const n of nodes) parts.push(`${n.id}:${n.z ?? 0}:${n.surveyZ ?? ""}:${n.atmosphereLink ? 1 : 0}`);
  return parts.join(";");
}

function loadSettings(): StabilitySettings {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) {
      const v = JSON.parse(s) as Partial<StabilitySettings>;
      const ok = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
      return {
        angleFilter: ok(v.angleFilter, DEFAULT_STABILITY_SETTINGS.angleFilter),
        lengthFilter: ok(v.lengthFilter, DEFAULT_STABILITY_SETTINGS.lengthFilter),
        ambientTemp: ok(v.ambientTemp, DEFAULT_STABILITY_SETTINGS.ambientTemp),
      };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_STABILITY_SETTINGS };
}

let settings: StabilitySettings = loadSettings();
/** Последний расчёт по факту + отпечаток схемы и температура, при которых он сделан. */
let factsState: { facts: Map<string, FireStabilityFact>; key: string; ambientTemp: number } | null = null;

export function getStabilitySettings(): StabilitySettings {
  return settings;
}

export function setStabilitySettings(next: Partial<StabilitySettings>): void {
  settings = { ...settings, ...next };
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export function saveStabilityFacts(facts: Map<string, FireStabilityFact>, key: string, ambientTemp: number): void {
  factsState = { facts, key, ambientTemp };
}

export function clearStabilityFacts(): void {
  factsState = null;
}

/**
 * Факты расчёта, если они действительны для ТЕКУЩЕЙ схемы и температуры.
 * Иначе null — тогда документ строится по нормативной оценке.
 */
export function getValidStabilityFacts(
  branches: TopoBranch[],
  nodes: TopoNode[],
  ambientTemp: number,
): Map<string, FireStabilityFact> | null {
  if (!factsState) return null;
  if (factsState.ambientTemp !== ambientTemp) return null;
  if (factsState.key !== stabilityInputsKey(branches, nodes)) return null;
  return factsState.facts;
}
