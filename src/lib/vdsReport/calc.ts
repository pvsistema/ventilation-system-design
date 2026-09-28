// ─────────────────────────────────────────────────────────────────────────────
// Отчёт ВДС — расчётные разделы 2–4 по рассчитанной модели вентиляционной сети.
//
// Формулы — по отчёту-образцу (Методические рекомендации по проведению ВДС):
//   (1) h_ст = h_изм ± h_е              статическая депрессия вентилятора
//   (2) h_ск = γ·V²/2g                  скоростной напор в канале
//   (3) h_п  = h_ст + h_ск              полное давление вентилятора
//   (4) η    = h_ш / h_п                аэродинамический КПД ГВУ
//   (5) η_об = Q_ш / Q_в                объёмный КПД ГВУ
//   (6) К_об = Q_в / Q_р                коэффициент обеспеченности рудника воздухом
//   (7) К_п  = (Q_в − Q_ут.внеш − Q_ут.внутр) / Q_в
//   (8) ΔQ   = (Q_max/Q_в − 1)·100%     резерв подачи вентилятора
//   (9) Q_ут.н = Q_р·(К_в − 1)          нормативные внешние утечки
//   (15) Q_ш = К_н·ΣQ                  требуемое количество воздуха
//   (16)–(20) R_в, R_ш, Z_в, К_в, К    показатели эффективности ШВС
//   (21) N_уд = ΣQ_в·H_в / (100·Q_пол) трудность проветривания
//   (22) А = 0,38·Q_ш/√h_ш              эквивалентное отверстие
// Депрессия в отчёте — в даПа; в модели давление хранится в Па (÷10).
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch, TopoNode } from "@/lib/topology";
import { getFanById, fanQMax } from "@/lib/fanCurves";
import type { BranchBulkheadInfo } from "@/lib/branchBulkheadInfo";
import { calcFireStability, type StabilityRow } from "@/lib/fireStability";
import type { VdsReportForm } from "./types";

const G = 9.81;
const R_AIR = 287.05;

export const num = (s: string | number | undefined | null, def = 0): number => {
  if (typeof s === "number") return Number.isFinite(s) ? s : def;
  const v = parseFloat(String(s ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : def;
};

/** Плотность воздуха, кг/м³, по температуре (°C) и давлению (мм рт. ст.) */
export function airDensity(tC: number, pMmHg: number): number {
  return (pMmHg * 133.322) / (R_AIR * (tC + 273.15));
}

export interface GvuCalc {
  branchId: string;
  name: string;
  place: string;
  fanModel: string;
  mode: string;
  rpm: number;
  bladeAngle: number;
  Qv: number;          // подача вентилятора, м³/с
  Hv: number;          // депрессия вентилятора, даПа
  Hsh: number;         // депрессия рудника (ШВС), даПа
  Qsh: number;         // поступает в рудник, м³/с
  extLeakNorm: number; // нормативные внешние утечки, м³/с
  extLeakFact: number; // фактические внешние утечки, м³/с
  extLeakMeasured: boolean;
  extLeakPct: number;  // % от Q вентилятора
  he: number;          // естественная тяга, даПа
  hSt: number;         // статическая депрессия, даПа
  hSk: number;         // скоростной напор, даПа
  hP: number;          // полное давление, даПа
  etaAero: number;     // аэродинамический КПД
  etaVol: number;      // объёмный КПД
  kOb: number;         // коэффициент обеспеченности
  kP: number;          // коэффициент полезного использования воздуха
  qMax: number;        // максимальная подача по характеристике, м³/с
  reservePct: number | null;
  Rv: number;          // сопротивление, преодолеваемое ВГП, даПа·с²/м⁶
  Rsh: number;         // сопротивление ШВС
  Zv: number;          // загруженность воздухом
  Kvi: number;         // КПИ воздуха
  Ki: number;          // КПД ШВС
  etaSt: number;       // статический КПД ВГП
  A: number;           // эквивалентное отверстие по ВГП, м²
}

export interface WorkingRow {
  no: string;
  name: string;
  purpose: string;
  area: number;
  support: string;
  flow: number;
}

export interface DeadEndRow {
  no: string;
  name: string;
  fan: string;
  diameter: string;
  pipeLength: number;
  area: number;
  qBefore: number;
  qVent: number;
  qFace: number;
  qRequired: number;
  ok: boolean;
}

export interface ChamberRow {
  no: string;
  name: string;
  required: number;
  fact: number;
  pct: number;
  ok: boolean;
}

export interface StructureRow {
  no: string;
  name: string;
  type: string;
  dP: number;           // Па
  norm: number;         // м³/с
  fact: number;         // м³/с
  over: number;         // м³/с
  overPct: number;      // %
  R: number;            // даПа·с²/м⁶
  violation: boolean;
}

export interface NaturalDraftRow {
  name: string;
  zTop: number;
  zBottom: number;
  heSummer: number;
  heWinter: number;
  heSurvey: number;
}

export interface VdsCalcResult {
  solved: boolean;
  gvu: GvuCalc[];
  intake: WorkingRow[];
  exhaust: WorkingRow[];
  steepestDrops: { no: string; name: string; dP: number; spec: number }[];
  deadEnds: DeadEndRow[];
  faces: ChamberRow[];
  chambers: ChamberRow[];
  structures: StructureRow[];
  naturalDraft: NaturalDraftRow[];
  heSurvey: number;
  QvTotal: number;
  QshTotal: number;
  extLeakTotal: number;
  extLeakNormTotal: number;
  intLeakTotal: number;
  intLeakNormTotal: number;
  intLeakPct: number;
  intakeTotal: number;
  exhaustTotal: number;
  requiredSum: number;        // Σ по забоям (без kн)
  requiredAir: number;        // требуемое по руднику
  requiredFromSchema: boolean;
  supplyPct: number;          // обеспеченность, %
  Hmine: number;              // депрессия рудника, даПа
  Nud: number;
  Aeq: number;
  ventDifficulty: string;
  openingClass: string;
  stabilityDown: StabilityRow[];
  stabilityUp: StabilityRow[];
  unstableCount: number;
}

function branchNo(b: TopoBranch, nodeById: Map<string, TopoNode>): string {
  const f = nodeById.get(b.fromId)?.number;
  const t = nodeById.get(b.toId)?.number;
  if (f && t) return `${f}–${t}`;
  return b.id.slice(-4);
}

function branchName(b: TopoBranch): string {
  return String(b.type ?? "").replace(/^"(.*)"$/, "$1").trim() || `Ветвь ${b.id.slice(-4)}`;
}

export function calcVdsReport(
  branches: TopoBranch[],
  nodes: TopoNode[],
  solved: boolean,
  form: VdsReportForm,
  bulkheads: Map<string, BranchBulkheadInfo>,
): VdsCalcResult {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const atm = new Set(nodes.filter(n => n.atmosphereLink).map(n => n.id));

  // ── Естественная тяга (Прил. 7 Метод. рекомендаций) ─────────────────────
  const tEx = num(form.tExhaust, 8);
  const zAll = nodes.map(n => n.z ?? 0);
  const zBottom = zAll.length ? Math.min(...zAll) : 0;
  const pMine = num(form.pSurvey, 745);
  const rhoMine = airDensity(tEx, pMine);
  const heOf = (zTop: number, t: number, p: number) =>
    (G * (zTop - zBottom) * (airDensity(t, p) - rhoMine)) / 10; // даПа
  const naturalDraft: NaturalDraftRow[] = nodes
    .filter(n => n.atmosphereLink)
    .map(n => {
      const adj = branches.find(b => b.fromId === n.id || b.toId === n.id);
      return {
        name: adj ? branchName(adj) : (n.name || `Узел ${n.number}`),
        zTop: n.z ?? 0,
        zBottom,
        heSummer: heOf(n.z ?? 0, num(form.tSummer, 40), num(form.pSummer, 730)),
        heWinter: heOf(n.z ?? 0, num(form.tWinter, -40), num(form.pWinter, 770)),
        heSurvey: heOf(n.z ?? 0, num(form.tSurvey, 5), num(form.pSurvey, 745)),
      };
    });

  // ── Воздухоподающие / выдающие выработки ─────────────────────────────────
  const intake: WorkingRow[] = [];
  const exhaust: WorkingRow[] = [];
  for (const b of branches) {
    if (b.isVentPipeBranch) continue;
    const q = b.flow ?? 0;
    const fromAtm = atm.has(b.fromId), toAtm = atm.has(b.toId);
    if (!fromAtm && !toAtm) continue;
    const inflow = (fromAtm && q > 0) || (toAtm && q < 0);
    const row: WorkingRow = {
      no: branchNo(b, nodeById),
      name: branchName(b),
      purpose: b.hasFan ? "Выдача исходящей струи (ГВУ)" : inflow ? "Подача свежего воздуха" : "Выдача исходящей струи воздуха",
      area: b.area ?? 0,
      support: b.surface || "",
      flow: Math.abs(q),
    };
    if (Math.abs(q) < 1e-6) continue;
    (inflow ? intake : exhaust).push(row);
  }
  const intakeTotal = intake.reduce((s, r) => s + r.flow, 0);
  const exhaustTotal = exhaust.reduce((s, r) => s + r.flow, 0);

  // Наибольшее удельное падение давления (для анализа депрессиограммы)
  const steepestDrops = branches
    .filter(b => !b.isVentPipeBranch && !b.hasFan && (b.length ?? 0) > 1 && Math.abs(b.dP ?? 0) > 0)
    .map(b => ({
      no: branchNo(b, nodeById),
      name: branchName(b),
      dP: Math.abs(b.dP ?? 0) / 10,
      spec: Math.abs(b.dP ?? 0) / 10 / Math.max(1, b.length ?? 1) * 100,
    }))
    .sort((a, b) => b.spec - a.spec)
    .slice(0, 6);

  // ── Внутренние утечки: расход через вентсооружения и ветви-утечки ─────────
  const structures: StructureRow[] = [];
  let intLeakTotal = 0;
  let intLeakNormTotal = 0;
  for (const b of branches) {
    const info = bulkheads.get(b.id);
    const q = Math.abs(b.flow ?? 0);
    if (b.isLeakage && !info) { intLeakTotal += q; continue; }
    if (!info || info.allOpen) continue;
    const dP = Math.abs(b.dPTotal ?? b.dP ?? 0);
    const leakNormM3s = info.leakNorm > 0 ? (info.leakNorm / 60) * Math.sqrt(Math.max(dP, 0) / 50) : 0;
    const over = leakNormM3s > 0 ? q - leakNormM3s : 0;
    const row: StructureRow = {
      no: branchNo(b, nodeById),
      name: branchName(b),
      type: info.name,
      dP,
      norm: leakNormM3s,
      fact: q,
      over,
      overPct: leakNormM3s > 0 ? (q / leakNormM3s) * 100 : 0,
      R: q > 1e-6 ? dP / 10 / (q * q) : 0,
      violation: leakNormM3s > 0 && over > 0.05,
    };
    structures.push(row);
    if (!b.hasFan) { intLeakTotal += q; intLeakNormTotal += leakNormM3s; }
  }

  // ── Тупиковые выработки (ВМП + вентстав) ──────────────────────────────────
  const deadEnds: DeadEndRow[] = [];
  const vmpByHost = new Map<string, TopoBranch>();
  for (const b of branches) if (b.hasFan && b.fanType === "ВМП") vmpByHost.set(b.vpHostBranchId || b.id, b);
  for (const b of branches) {
    if (!b.hasVentPipe || b.isVentPipeBranch) continue;
    const vmp = vmpByHost.get(b.id);
    const qVent = Math.abs(b.vpComputedFlow ?? 0) || Math.abs(vmp?.flow ?? 0);
    const qFace = Math.max(0, qVent - Math.abs(b.vpComputedLeakage ?? 0));
    const req = b.ventComputedTotal ?? 0;
    deadEnds.push({
      no: branchNo(b, nodeById),
      name: branchName(b),
      fan: vmp?.fanName || "ВМП",
      diameter: b.vpDiameter ? `${(b.vpDiameter / 1000).toFixed(2)}` : "—",
      pipeLength: b.vpLength ?? b.length ?? 0,
      area: b.area ?? 0,
      qBefore: Math.abs(b.flow ?? 0),
      qVent,
      qFace,
      qRequired: req,
      ok: req <= 0 || qFace >= req * 0.999,
    });
  }

  // ── Забои и камеры: расчётный / фактический расход ───────────────────────
  const faces: ChamberRow[] = [];
  const chambers: ChamberRow[] = [];
  let requiredSum = 0;
  for (const b of branches) {
    const ft = b.ventFaceType;
    if (!ft || ft === "none") continue;
    const req = b.ventComputedTotal ?? 0;
    requiredSum += req;
    if (b.hasVentPipe) continue; // уже в тупиковых
    const fact = Math.abs(b.flow ?? 0);
    const row: ChamberRow = {
      no: branchNo(b, nodeById),
      name: b.ventDescription || branchName(b),
      required: req,
      fact,
      pct: req > 0 ? (fact / req) * 100 : 0,
      ok: req <= 0 || fact >= req * 0.999,
    };
    (ft === "chamber" ? chambers : faces).push(row);
  }
  const kn = num(form.kn, 1.1) || 1;
  const requiredFromSchema = !(num(form.requiredAir) > 0);
  const requiredAir = requiredFromSchema ? requiredSum * kn : num(form.requiredAir);

  // ── ГВУ ────────────────────────────────────────────────────────────────────
  const heSurvey = naturalDraft.length
    ? Math.max(...naturalDraft.map(r => r.heSurvey)) - Math.min(...naturalDraft.map(r => r.heSurvey))
    : 0;
  const gvuBranches = branches.filter(b => b.hasFan && b.fanType === "ГВУ" && !b.fanStopped);
  const inputs = new Map(form.gvu.map(g => [g.branchId, g]));
  const gvuPre = gvuBranches.map(b => {
    const inp = inputs.get(b.id);
    const Qv = Math.abs(b.flow ?? 0);
    const Hv = Math.abs(b.fanPressure ?? 0) / 10;
    const kv = inp?.kv ?? 1.05;
    const extLeakNorm = Qv * (kv - 1);
    const measured = !!inp && inp.extLeakFact.trim() !== "";
    const extLeakFact = measured ? num(inp!.extLeakFact) : 0;
    const Qsh = Math.max(0, Qv - extLeakFact);
    // Депрессия рудника: напор ГВУ за вычетом потерь в самой ветви ГВУ (канал).
    const Hsh = Math.max(0, Hv - Math.abs(b.dP ?? 0) / 10);
    return { b, inp, Qv, Hv, kv, extLeakNorm, extLeakFact, measured, Qsh, Hsh };
  });
  const QshTotal = gvuPre.reduce((s, g) => s + g.Qsh, 0);

  const gvu: GvuCalc[] = gvuPre.map(g => {
    const { b, inp, Qv, Hv, Qsh, Hsh } = g;
    const he = heSurvey * (QshTotal > 0 ? Qsh / QshTotal : 1) * -1;
    const hSt = Hsh + he;
    const S = num(inp?.channelArea);
    const V = S > 0 ? Qv / S : 0;
    const rho = airDensity(num(form.tExhaust, 8), num(form.pSurvey, 745));
    const hSk = (rho * V * V) / 2 / 10;
    const hP = Hv + hSk;
    const curve = b.fanCurveId ? getFanById(b.fanCurveId) : undefined;
    const qMax = curve ? fanQMax(curve, b.fanBladeAngle, b.fanRpm) * Math.max(1, b.fanParallel || 1) : 0;
    const intShare = QshTotal > 0 ? intLeakTotal * (Qsh / QshTotal) : 0;
    const etaSt = b.fanEfficiency && b.fanEfficiency > 0 ? (b.fanEfficiency > 1 ? b.fanEfficiency / 100 : b.fanEfficiency) : 0.7;
    const reqShare = QshTotal > 0 ? requiredAir * (Qsh / QshTotal) : requiredAir;
    return {
      branchId: b.id,
      name: b.fanName || `ГВУ (${branchNo(b, nodeById)})`,
      place: inp?.place || branchName(b),
      fanModel: curve?.name || b.fanName || "—",
      mode: inp?.mode || "Всасывающий",
      rpm: b.fanRpm || curve?.rpmNominal || 0,
      bladeAngle: b.fanBladeAngle || 0,
      Qv, Hv, Hsh, Qsh,
      extLeakNorm: g.extLeakNorm,
      extLeakFact: g.extLeakFact,
      extLeakMeasured: g.measured,
      extLeakPct: Qv > 0 ? (g.extLeakFact / Qv) * 100 : 0,
      he, hSt, hSk, hP,
      etaAero: hP > 0 ? Hsh / hP : 0,
      etaVol: Qv > 0 ? Qsh / Qv : 0,
      kOb: reqShare > 0 ? Qv / reqShare : 0,
      kP: Qv > 0 ? (Qv - g.extLeakFact - intShare) / Qv : 0,
      qMax,
      reservePct: qMax > 0 && Qv > 0 ? (qMax / Qv - 1) * 100 : null,
      Rv: Qv > 0 ? Hv / (Qv * Qv) : 0,
      Rsh: Qsh > 0 ? Hsh / (Qsh * Qsh) : 0,
      Zv: Qv > 0 ? Hv / Qv : 0,
      Kvi: Qv > 0 && Qsh > 0 ? (1 - (Qv - Qsh) / Qv) * (1 - intShare / Qsh) : 0,
      Ki: Qv > 0 && Hv > 0 ? ((Qsh * Hsh) / (Qv * Hv)) * etaSt : 0,
      etaSt,
      A: Hsh > 0 ? (0.38 * Qsh) / Math.sqrt(Hsh) : 0,
    };
  });

  const QvTotal = gvu.reduce((s, g) => s + g.Qv, 0);
  const extLeakTotal = gvu.reduce((s, g) => s + g.extLeakFact, 0);
  const extLeakNormTotal = gvu.reduce((s, g) => s + g.extLeakNorm, 0);
  const sumHQ = gvu.reduce((s, g) => s + g.Hsh * g.Qsh, 0);
  const Hmine = QshTotal > 0 ? sumHQ / QshTotal : 0;
  const Aeq = gvu.length === 1 ? gvu[0].A : (Hmine > 0 ? (0.38 * QshTotal) / Math.sqrt(Hmine) : 0);
  const usefulQ = requiredAir > 0 ? requiredAir : Math.max(1e-6, QshTotal - intLeakTotal);
  const Nud = gvu.reduce((s, g) => s + g.Qv * g.Hv, 0) / (100 * usefulQ);
  const ventDifficulty = Nud <= 0 ? "—" : Nud < 2.5 ? "легко проветриваемый" : Nud <= 5 ? "средней трудности проветривания" : "трудно проветриваемый";
  const openingClass = Aeq <= 0 ? "—" : Aeq < 1 ? "труднопроветриваемый" : Aeq <= 2 ? "средней трудности проветривания" : "легкопроветриваемый";

  // ── Устойчивость проветривания наклонных выработок при пожаре ────────────
  let stabilityDown: StabilityRow[] = [];
  let stabilityUp: StabilityRow[] = [];
  let unstableCount = 0;
  if (solved) {
    try {
      const st = calcFireStability(branches, nodes, { angleFilter: 5, lengthFilter: 30, ambientTemp: num(form.tSurvey, 20) });
      stabilityDown = [...st.byCategory["descending-incline"], ...st.byCategory["descending-vertical"]];
      stabilityUp = [...st.byCategory["ascending-incline"], ...st.byCategory["ascending-vertical"]];
      unstableCount = st.totalUnstable;
    } catch (e) {
      console.warn("[vds] fire stability failed", e);
    }
  }

  const QinMine = QshTotal > 0 ? QshTotal : intakeTotal;
  return {
    solved,
    gvu,
    intake, exhaust, steepestDrops,
    deadEnds, faces, chambers, structures, naturalDraft,
    heSurvey,
    QvTotal, QshTotal: QinMine,
    extLeakTotal, extLeakNormTotal,
    intLeakTotal, intLeakNormTotal,
    intLeakPct: QinMine > 0 ? (intLeakTotal / QinMine) * 100 : 0,
    intakeTotal, exhaustTotal,
    requiredSum, requiredAir, requiredFromSchema,
    supplyPct: requiredAir > 0 ? (QinMine / requiredAir) * 100 : 0,
    Hmine, Nud, Aeq, ventDifficulty, openingClass,
    stabilityDown, stabilityUp, unstableCount,
  };
}

/** Форматирование числа в русской нотации */
export function f(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(d).replace(".", ",");
}
