// ─────────────────────────────────────────────────────────────────────────────
// Проверка труб ППЗ по нормам: минимальный диаметр линии и скорость воды.
//
//  • Диаметр: магистральные — не менее DN 100 (рудник) / DN 150 (уголь),
//    участковые — не менее DN 50 / DN 100 (см. waterPipes.ts → MIN_DN).
//    Назначение линии задаётся у ветви (wpLine); если не задано — диаметр
//    не проверяется: программа не может сама знать, магистраль это или нет.
//  • Скорость: до 2 м/с при обычном (технологическом) расходе — по текущему
//    состоянию сети, и до 4 м/с при пожаротушении — по худшему из пожарных
//    сценариев проверки ППЗ (WaterCheckResult.fireVelocityByBranch).
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoBranch, TopoNode } from "./topology";
import { calcWaterNetwork } from "./waterHydraulics";
import { pipeInnerDiameterMm } from "./waterSolver";
import { findPipe, MIN_DN, V_TECH, V_FIRE, type PipeLine } from "./waterPipes";

export type PipeIssueKind = "small-diameter" | "tech-velocity" | "fire-velocity";

export const PIPE_ISSUE_LABEL: Record<PipeIssueKind, string> = {
  "small-diameter": "Диаметр меньше нормы",
  "tech-velocity": `Скорость выше ${V_TECH} м/с`,
  "fire-velocity": `Скорость при пожаре выше ${V_FIRE} м/с`,
};

export interface PipeIssue {
  branchId: string;
  /** Подпись ветви: «Узел 3 → Узел 7» */
  title: string;
  line?: PipeLine;
  /** Наружный × стенка, мм */
  size: string;
  /** DN трубы (по справочнику или по внутреннему диаметру) */
  dn: number;
  minDn?: number;
  techVelocity?: number;
  fireVelocity?: number;
  kinds: PipeIssueKind[];
  recommendation: string;
}

export interface PipeNormsResult {
  issues: PipeIssue[];
  /** Сколько труб ППЗ проверено */
  total: number;
  /** Сколько труб без назначения линии (диаметр не проверялся) */
  noLine: number;
}

/** DN трубы ветви: из справочника, иначе — округлённый внутренний диаметр. */
export function branchPipeDn(b: TopoBranch): number {
  const m = findPipe(b.wpDiameter ?? 100, b.wpWallThickness ?? 0, b.wpMaterial || "Сталь");
  if (m) return m.dn;
  return Math.round(pipeInnerDiameterMm(b));
}

const fmt = (v: number) => String(+v.toFixed(1)).replace(".", ",");

export function checkPipeNorms(
  nodes: TopoNode[],
  branches: TopoBranch[],
  kind: "ore" | "coal",
  fireVelocityByBranch: Map<string, number>,
): PipeNormsResult {
  const pipes = branches.filter((b) => b.hasWaterPipe);
  const { branchResults } = calcWaterNetwork(nodes, branches);
  const nodeLabel = new Map(nodes.map((n) => [n.id, n.number || n.name || n.id.slice(-4)]));
  const min = MIN_DN[kind];
  const issues: PipeIssue[] = [];

  for (const b of pipes) {
    const dn = branchPipeDn(b);
    const line = b.wpLine;
    const minDn = line === "main" ? min.main : line === "section" ? min.section : undefined;
    const r = branchResults.get(b.id);
    const tech = r && (r.flow ?? 0) > 0.01 ? r.velocity ?? 0 : 0;
    const fire = fireVelocityByBranch.get(b.id) ?? 0;

    const kinds: PipeIssueKind[] = [];
    if (minDn !== undefined && dn < minDn) kinds.push("small-diameter");
    if (tech > V_TECH) kinds.push("tech-velocity");
    if (fire > V_FIRE) kinds.push("fire-velocity");
    if (!kinds.length) continue;

    // Какой диаметр нужен, чтобы уложиться в скорость: d ∝ √(Q/v) → d₂ = d₁·√(v₁/vₙ)
    const din = pipeInnerDiameterMm(b);
    const needByV = Math.max(
      tech > V_TECH ? din * Math.sqrt(tech / V_TECH) : 0,
      fire > V_FIRE ? din * Math.sqrt(fire / V_FIRE) : 0,
    );
    const parts: string[] = [];
    if (kinds.includes("small-diameter") && minDn) {
      parts.push(`${line === "main" ? "магистральная" : "участковая"} линия — не менее DN ${minDn}`);
    }
    if (needByV > 0) parts.push(`по скорости нужен внутренний Ø не менее ${Math.ceil(needByV)} мм`);

    issues.push({
      branchId: b.id,
      title: `${nodeLabel.get(b.fromId) ?? "?"} → ${nodeLabel.get(b.toId) ?? "?"}`,
      line, size: `${fmt(b.wpDiameter ?? 100)}×${fmt(b.wpWallThickness ?? 0)}`,
      dn, minDn,
      techVelocity: tech > 0 ? +tech.toFixed(2) : undefined,
      fireVelocity: fire > 0 ? +fire.toFixed(2) : undefined,
      kinds,
      recommendation: `Заменить трубу: ${parts.join("; ")}`,
    });
  }

  issues.sort((a, b) =>
    (b.kinds.includes("small-diameter") ? 1 : 0) - (a.kinds.includes("small-diameter") ? 1 : 0)
    || (b.fireVelocity ?? 0) - (a.fireVelocity ?? 0));

  return { issues, total: pipes.length, noLine: pipes.filter((b) => !b.wpLine).length };
}
