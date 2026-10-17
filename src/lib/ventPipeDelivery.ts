// ─────────────────────────────────────────────────────────────────────────────
// ventPipeDelivery.ts — доставка воздуха по ставу ВМП одной функцией.
//
// Та же цепочка, что во вкладке «Вентстав» (BranchVentPipeTab): методика
// утечек, марка рукава, характеристика вентилятора H(Q), фактические участки
// става, требуемый расход в забое и предельная длина. Вынесено, чтобы режим
// «Модель» показывал РОВНО те же числа, что и вкладка, а не свою оценку.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { type VentSection, type VentNorms } from "@/lib/ventSections";
import { calcFaceDemand } from "@/lib/airDemand";
import { getDuctBrand, getDuctSize } from "@/lib/ventDucts";
import { getFanById, fanHAngle } from "@/lib/fanCurves";
import {
  calcVentPipe, calcVentPipeMaxLength, totalLocalXi, ventPipeChainFrom, type VpLeakMethod,
} from "@/lib/ventPipeCalc";

export interface VentPipeDelivery {
  /** Коэффициент доставки Kу.т = Q_забой / Q_вент. */
  delivery: number;
  flowFan: number;
  flowFace: number;
  leakage: number;
  leakagePercent: number;
  velocityFace: number;
  deltaP: number;
  /** Требуемый расход в забое, м³/с (0 — не задан). */
  required: number;
  /** Предельная длина и запас; null — требуемый расход не задан. */
  maxLength: number | null;
  reserve: number | null;
  limitedBy: "flow" | "pressure" | "none" | null;
  /** Фактическая длина става, м. */
  length: number;
  flowShort: boolean;
  overPressure: boolean;
}

export function calcVentPipeDelivery(
  branch: TopoBranch,
  allBranches: TopoBranch[],
  norms: VentNorms,
  sections: VentSection[],
): VentPipeDelivery | null {
  if (!branch.hasVentPipe) return null;
  const method: VpLeakMethod = branch.vpLeakMethod ?? "passport";
  const brand = getDuctBrand(branch.vpBrandId);
  const size = getDuctSize(brand, branch.vpDiameter);
  const lossPer100m = size?.lossPer100m ?? branch.vpLeakageCoeff ?? 0;
  const workPressure = size?.workPressure ?? branch.vpWorkPressure ?? 0;
  const fanFlow = Math.abs(branch.flow ?? 0);
  const fanPressure = Math.abs(branch.fanPressure ?? 0);

  const chain = ventPipeChainFrom(branch, allBranches);
  const length = (branch.vpLength ?? 0) > 0 ? branch.vpLength : (chain?.length ?? 0);
  if (!(length > 0) || !(fanFlow > 0.01)) return null;

  const fanCurveObj = branch.hasFan ? getFanById(branch.fanCurveId) : undefined;
  const fanCurve = fanCurveObj
    ? (Q: number) => fanHAngle(
        fanCurveObj, Q, branch.fanBladeAngle,
        branch.fanRpm > 0 ? branch.fanRpm : fanCurveObj.rpmNominal,
      )
    : undefined;

  const jointsPerMeter = (branch.vpJointCount ?? 0) > 0
    ? (branch.vpJointCount ?? 0) / length
    : (branch.vpLinkLength ?? 20) > 0 ? 1 / (branch.vpLinkLength ?? 20) : 0;

  const baseRaw = {
    method,
    diameter: branch.vpDiameter ?? 0,
    alpha: brand?.alpha ?? branch.vpPipeAlpha ?? 0,
    lossPer100m,
    linkLength: branch.vpLinkLength ?? 20,
    jointCount: branch.vpJointCount ?? 0,
    localXi: totalLocalXi(branch.vpBends90 ?? 0, branch.vpBends45 ?? 0, branch.vpLocalXi ?? 0),
    jointLeakK: branch.vpJointLeakK ?? 0,
    jointsPerMeter,
    fanFlow,
  };
  const base = chain && chain.profile.segments.length > 0
    ? { ...baseRaw, rProfile: chain.profile }
    : baseRaw;
  const input = { ...base, fanCurve };
  const res = calcVentPipe({ ...input, length });

  const section = sections.find(s => s.id === (branch.ventSectionId ?? "")) ?? null;
  const autoRequired = calcFaceDemand(branch, norms, section).total ?? 0;
  const required = (branch.vpRequiredFlow ?? 0) > 0 ? branch.vpRequiredFlow! : autoRequired;

  const limits = fanCurve
    ? [workPressure].filter(v => v > 0)
    : [fanPressure, workPressure].filter(v => v > 0);
  const pressureLimit = limits.length ? Math.min(...limits) : 0;
  const limit = required > 0 ? calcVentPipeMaxLength(input, required, pressureLimit, length) : null;

  return {
    delivery: res.delivery,
    flowFan: res.flowFan,
    flowFace: res.flowFace,
    leakage: res.leakage,
    leakagePercent: res.leakagePercent,
    velocityFace: res.velocityFace,
    deltaP: res.deltaP,
    required,
    maxLength: limit ? limit.maxLength : null,
    reserve: limit ? limit.reserve : null,
    limitedBy: limit ? limit.limitedBy : null,
    length,
    flowShort: required > 0 && res.flowFace < required,
    overPressure: workPressure > 0 && res.deltaP > workPressure,
  };
}
