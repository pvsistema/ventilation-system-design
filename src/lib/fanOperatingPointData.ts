// ─────────────────────────────────────────────────────────────────────────────
// fanOperatingPointData.ts — единые данные «рабочей точки» вентилятора для:
//   • справочника вентиляторов (все ветви с этой моделью),
//   • левой панели свойств ветви (вкладка «Вентилятор»),
//   • окна увеличенного просмотра и выгрузки в Excel.
//
// И миниатюра в панели, и окно, и справочник строятся из ОДНИХ данных и одной
// функции рабочей точки — поэтому показывают одно и то же и обновляются вместе
// после расчёта сети или смены угла / оборотов.
// ─────────────────────────────────────────────────────────────────────────────

import type { FanCurve } from "@/lib/fanCurves";
import type { TopoBranch } from "@/lib/topology";
import {
  branchFanOperatingPoint, fanAngleColor, FAN_NETWORK_COLOR, FAN_OP_COLOR, FAN_REVERSE_COLOR,
} from "@/lib/fanChartData";

export interface FanOpAngle { angle: number; reverse: boolean; rpm: number; color: string }
export interface FanOpPoint {
  label: string; q: number; h: number; reverse: boolean;
  source: "manual" | "calc"; color: string;
  /** Сопротивление сети для этой точки (H = R·Q²), только для расчётных */
  r?: number;
}

export interface FanOperatingPointData {
  fanName: string;
  catalog: FanCurve;
  angles: FanOpAngle[];
  points: FanOpPoint[];
  /** Режим ветви — его кривая выделяется (угол лопаток + прямой/реверс) */
  selected?: { angle: number; reverse: boolean };
  /** Подпись под заголовком окна (ветвь, обороты) */
  subtitle?: string;
}

/** Подпись расчётной точки ветви — одинаковая везде. */
export function branchOpLabel(b: TopoBranch, withAngle: boolean): string {
  const name = b.fanName ? ` ${b.fanName}` : "";
  const angle = withAngle && b.fanBladeAngle !== undefined ? `, ${b.fanBladeAngle}°` : "";
  return `Рабочая точка${name} (ветвь ${b.id}${angle}${b.fanReverse ? ", реверс" : ""})`;
}

/** Расчётные рабочие точки всех ветвей с данной моделью вентилятора. */
export function branchesOpPoints(branches: TopoBranch[], catalogId: string, withAngle: boolean): FanOpPoint[] {
  return branches
    .filter(b => b.hasFan && b.fanMode === "curve" && b.fanCurveId === catalogId)
    .map(b => {
      const op = branchFanOperatingPoint(b);
      if (!op) return null;
      return {
        label: branchOpLabel(b, withAngle), q: op.q, h: op.h, reverse: op.reverse,
        source: "calc" as const, color: FAN_OP_COLOR, r: op.r,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}

/**
 * Данные для одной ветви (левая панель): все паспортные углы на оборотах
 * ветви, реверс (если есть в каталоге), рабочая точка из расчёта сети.
 */
export function branchFanOpData(b: TopoBranch, c: FanCurve): FanOperatingPointData {
  const rpm = b.fanRpm || c.rpmNominal;
  const angleList = c.bladeAngles.length > 0 ? c.bladeAngles : [b.fanBladeAngle ?? 0];
  const angles: FanOpAngle[] = angleList.map(a => ({ angle: a, reverse: false, rpm, color: fanAngleColor(c, a) }));
  const isVmp = b.fanType === "ВМП";
  if (c.reverseH0 !== undefined && !isVmp) {
    const sel = b.fanBladeAngle ?? angleList[0];
    angles.push({ angle: sel, reverse: true, rpm, color: FAN_REVERSE_COLOR });
  }
  const op = branchFanOperatingPoint(b);
  const points: FanOpPoint[] = op ? [{
    label: branchOpLabel(b, angleList.length > 1), q: op.q, h: op.h, reverse: op.reverse,
    source: "calc", color: FAN_OP_COLOR, r: op.r,
  }] : [];
  const par = Math.max(1, b.fanParallel ?? 1);
  return {
    fanName: b.fanName || c.name,
    catalog: c,
    angles,
    points,
    selected: { angle: b.fanBladeAngle ?? angleList[0], reverse: !!b.fanReverse && !isVmp },
    subtitle: `Ветвь ${b.id} · ${rpm} об/мин${par > 1 ? ` · ${par} в параллели (точка на один вентилятор)` : ""}`,
  };
}

export { FAN_NETWORK_COLOR };
