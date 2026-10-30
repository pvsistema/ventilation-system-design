// ─────────────────────────────────────────────────────────────────────────────
// Проверка труб ППЗ по нормам: минимальный диаметр линии и скорость воды.
//
//  • Диаметр: магистральные — не менее DN 100 (рудник) / DN 150 (уголь),
//    участковые — не менее DN 50 / DN 100 (см. waterPipes.ts → MIN_DN).
//    Назначение линии задаётся у ветви (wpLine); если не задано — диаметр
//    не проверяется: программа не может сама знать, магистраль это или нет.
//  • Давление: наибольшее давление в трубе (при закрытых кранах и в текущем
//    режиме) не выше допустимого для её стенки (waterPipes → allowedPressureMPa).
//  • Скорость: до 2 м/с при обычном (технологическом) расходе — по текущему
//    состоянию сети, и до 4 м/с при пожаротушении — по худшему из пожарных
//    сценариев проверки ППЗ (WaterCheckResult.fireVelocityByBranch).
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoBranch, TopoNode } from "./topology";
import { calcWaterNetwork } from "./waterHydraulics";
import { pipeInnerDiameterMm } from "./waterSolver";
import { findPipe, getPipeById, allPipes, allowedPressureMPa, MIN_DN, V_TECH, V_FIRE, type PipeLine } from "./waterPipes";

export type PipeIssueKind = "small-diameter" | "tech-velocity" | "fire-velocity" | "over-pressure";

export const PIPE_ISSUE_LABEL: Record<PipeIssueKind, string> = {
  "small-diameter": "Диаметр меньше нормы",
  "tech-velocity": `Скорость выше ${V_TECH} м/с`,
  "fire-velocity": `Скорость при пожаре выше ${V_FIRE} м/с`,
  "over-pressure": "Давление выше допустимого для стенки",
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
  /** Наибольшее давление в трубе, МПа (краны закрыты — статика, или текущий режим) */
  pressure?: number;
  /** Допустимое давление для стенки трубы, МПа */
  allowedPressure?: number;
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
  const m = findPipe(b.wpDiameter ?? 100, b.wpWallThickness ?? 0, b.wpMaterial || "Сталь", b.wpPipeModelId);
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
  const { branchResults, nodeResults } = calcWaterNetwork(nodes, branches);
  // Наибольшее давление в трубах — при закрытых кранах (статический напор):
  // так труба стоит большую часть времени, и стенка обязана это держать.
  const closedNodes = nodes.map((n) =>
    (n.fireNodeType ?? "none") === "consumer" && n.fireHydrantOpen ? { ...n, fireHydrantOpen: false } : n);
  const { nodeResults: closedRes } = calcWaterNetwork(closedNodes, branches);
  const nodeP = (id: string) => Math.max(nodeResults.get(id)?.staticP ?? 0, closedRes.get(id)?.staticP ?? 0);
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

    const od = b.wpDiameter ?? 100;
    const wallMm = b.wpWallThickness ?? 0;
    const material = b.wpMaterial || "Сталь";
    // Модель не выбрана, а размер есть в нескольких ГОСТ — берём самую слабую
    // (в запас): без паспорта трубы прочность ГОСТ 8732 не гарантирована.
    const model = getPipeById(b.wpPipeModelId);
    const candidates = model && model.outerDiameter === od && model.wall === wallMm && model.material === material
      ? [model]
      : allPipes().filter((x) => x.outerDiameter === od && x.wall === wallMm && x.material === material);
    const pAllow = wallMm > 0
      ? (candidates.length
        ? Math.min(...candidates.map((x) => allowedPressureMPa(x)))
        : allowedPressureMPa({ gost: "", dn, outerDiameter: od, wall: wallMm, material }))
      : 0;
    const pMax = Math.max(nodeP(b.fromId), nodeP(b.toId));

    const kinds: PipeIssueKind[] = [];
    if (minDn !== undefined && dn < minDn) kinds.push("small-diameter");
    if (pAllow > 0 && pMax > pAllow) kinds.push("over-pressure");
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
    if (kinds.includes("over-pressure")) {
      parts.push(`стенку толще или труба ГОСТ 8732-78 — давление ${fmt(pMax)} МПа при допустимом ${fmt(pAllow)} МПа, либо поставить редукционный клапан выше по сети`);
    }

    issues.push({
      branchId: b.id,
      title: `${nodeLabel.get(b.fromId) ?? "?"} → ${nodeLabel.get(b.toId) ?? "?"}`,
      line, size: `${fmt(b.wpDiameter ?? 100)}×${fmt(b.wpWallThickness ?? 0)}`,
      dn, minDn,
      techVelocity: tech > 0 ? +tech.toFixed(2) : undefined,
      fireVelocity: fire > 0 ? +fire.toFixed(2) : undefined,
      pressure: pMax > 0 ? +pMax.toFixed(2) : undefined,
      allowedPressure: pAllow > 0 ? pAllow : undefined,
      kinds,
      recommendation: `Заменить трубу: ${parts.join("; ")}`,
    });
  }

  issues.sort((a, b) =>
    (b.kinds.includes("over-pressure") ? 1 : 0) - (a.kinds.includes("over-pressure") ? 1 : 0)
    || (b.kinds.includes("small-diameter") ? 1 : 0) - (a.kinds.includes("small-diameter") ? 1 : 0)
    || (b.fireVelocity ?? 0) - (a.fireVelocity ?? 0));

  return { issues, total: pipes.length, noLine: pipes.filter((b) => !b.wpLine).length };
}
