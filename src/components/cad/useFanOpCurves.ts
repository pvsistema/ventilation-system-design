// Кривые, линии КПД и характеристики сети для графика рабочей точки.
// Общий расчёт для миниатюры (панель свойств, справочник) и окна просмотра —
// чтобы все графики рисовались одинаково.
import { useMemo } from "react";
import type { FanCurve } from "@/lib/fanCurves";
import {
  fanCurvePoints, reverseCurvePoints, fanEfficiencyIsolines, angleLabel, FAN_NETWORK_COLOR,
  type FanIsoLine,
} from "@/lib/fanChartData";
import type { FanChartCurve } from "@/components/cad/FanChart";
import type { FanOpAngle, FanOperatingPointData } from "@/lib/fanOperatingPointData";

export interface BuiltCurve extends FanChartCurve { label: string; angle: number; reverse: boolean }

function buildBlock(c: FanCurve, angles: FanOpAngle[], reverse: boolean, sel?: FanOperatingPointData["selected"]): BuiltCurve[] {
  return angles.filter(a => a.reverse === reverse).map(a => ({
    key: `${reverse ? "r" : "f"}${a.angle}`,
    pts: reverse ? reverseCurvePoints(c, 40, a.rpm) : fanCurvePoints(c, a.angle, 40, a.rpm),
    color: a.color,
    dash: reverse,
    label: reverse ? (angles.filter(x => x.reverse).length > 1 ? `${angleLabel(a.angle)} рев.` : "Реверс") : angleLabel(a.angle),
    title: reverse ? "Реверсивная характеристика" : `Угол ${angleLabel(a.angle)} — нажмите, чтобы выбрать`,
    angle: a.angle,
    reverse,
    highlight: !!sel && sel.reverse === reverse && (reverse || sel.angle === a.angle),
  })).filter(x => x.pts.length > 0);
}

export function useFanOpCurves(data: FanOperatingPointData) {
  const { catalog, angles, points, selected } = data;

  // Реверсные кривые: если углы с реверсом не заданы, а точки в реверсе есть —
  // показываем реверсную характеристику каталога на номинальных оборотах.
  const reverseAngles = useMemo<FanOpAngle[]>(() => {
    const r = angles.filter(a => a.reverse);
    if (r.length > 0 || !points.some(p => p.reverse)) return r;
    return [{ angle: 0, reverse: true, rpm: catalog.rpmNominal, color: "#9c27b0" }];
  }, [angles, points, catalog]);

  const fwdCurves = useMemo(() => buildBlock(catalog, angles, false, selected), [catalog, angles, selected]);
  const revCurves = useMemo(() => buildBlock(catalog, reverseAngles, true, selected), [catalog, reverseAngles, selected]);
  const fwdIso = useMemo<FanIsoLine[]>(() => {
    const fa = angles.filter(a => !a.reverse);
    return fanEfficiencyIsolines(catalog, fa.map(a => a.angle), fa[0]?.rpm);
  }, [catalog, angles]);

  const networks = (rev: boolean) => points
    .filter(p => p.reverse === rev && p.r !== undefined && p.r > 0)
    .map(p => ({ r: p.r!, color: FAN_NETWORK_COLOR }));

  return { fwdCurves, revCurves, fwdIso, networks };
}
