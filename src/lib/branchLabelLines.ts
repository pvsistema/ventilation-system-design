// ─────────────────────────────────────────────────────────────────────────────
// branchLabelLines.ts — СТРОКИ ПОДПИСИ ВЫРАБОТКИ. Один источник текста для всех
// режимов показа схемы.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Подпись у выработки — это не оформление, а результат
// расчёта: длина, сечение, сопротивление, расход, скорость, депрессия. Раньше
// этот набор собирался прямо в рисовальщике чертежа, и стоило появиться второму
// способу показать схему — объёмной «Модели», — как текст пришлось бы писать
// заново. Две копии одних и тех же формул неизбежно разъезжаются: в панели
// свойств одно число, на чертеже другое, в модели третье. Для маркшейдерского
// документа это недопустимо.
//
// Здесь только ТЕКСТ: какие величины показывать, в каких единицах и с какой
// точностью. Где поставить подпись, каким шрифтом и рисовать ли её вообще —
// решает тот, кто рисует: у чертежа свои правила, у объёма свои.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch, type TopoNode, calcBranchLength } from "./topology";
import { type InfoDisplayConfig } from "./infoConfig";
import { type UnitsConfig, getUnit } from "./unitsConfig";
import { type WaterBranchResult } from "./waterHydraulics";
import { branchTotalR, branchExtraPressure, branchSectionHeight, branchPeopleCount } from "./branchLabelExtras";

/**
 * Сопротивление с автоподбором знаков.
 *
 * У сопротивления огромный разброс: у ствола это тысячные доли, у сбойки —
 * единицы. Фиксированная точность единицы измерения превращала бы половину
 * подписей в «0.000», поэтому знаки добавляются, пока не покажутся хотя бы две
 * значащие цифры.
 */
export function fmtResistance(
  rMkyurg: number,
  unit: { fromBase: (v: number) => number; symbol: string; decimals: number },
): string {
  const v = unit.fromBase(rMkyurg);
  if (v === 0) return `0 ${unit.symbol}`;
  const mag = Math.floor(Math.log10(Math.abs(v)));
  const decimals = Math.max(unit.decimals, -mag + 1);
  return `${v.toFixed(decimals)}${unit.symbol}`;
}

export interface BranchLabelInput {
  b: TopoBranch;
  /** Узлы нужны только для длины, когда она не задана вручную. */
  fromNode: TopoNode;
  toNode: TopoNode;
  /**
   * Что показывать. null или undefined — «Панель информации» не настроена:
   * в этом случае показывается сокращённый набор (номер, расход, скорость).
   */
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig: UnitsConfig;
  /** Результаты расчёта водопровода — для показаний редуктора. */
  waterBranchResults?: Map<string, WaterBranchResult>;
}

export interface BranchLabelText {
  /** Строки подписи сверху вниз; первой идёт номер, если он включён. */
  lines: string[];
  /** Номер выработки показан отдельной (первой) строкой. */
  showNum: boolean;
  /** Скорость выше допустимой — строки с расчётом красятся тревожным цветом. */
  overV: boolean;
}

/**
 * Собирает подпись выработки.
 *
 * Индивидуальные галочки выработки (b.indicators) перекрывают общие настройки
 * панели: на схеме часто нужно раскрыть подробности у одной-двух выработок, не
 * засоряя числами всю остальную схему.
 */
export function branchLabelLines(input: BranchLabelInput): BranchLabelText {
  const { b, fromNode, toNode, unitsConfig, waterBranchResults } = input;

  const ic = (b.indicators && Object.keys(b.indicators).length > 0)
    ? { ...(input.infoConfig ?? {}), ...b.indicators } as InfoDisplayConfig
    : input.infoConfig;

  const isDead = b.isDead ?? false;
  const Q = Math.abs(b.flow ?? 0);
  const V = b.velocity ?? 0;
  const overV = V > b.vMax;
  // Расчётные величины показываем, только если расчёт был: у свежепостроенной
  // выработки нули — это не «ноль кубов», а «ещё не считали».
  const hasCalc = (Q > 0 || V > 0) && !isDead;
  const showNum = !ic || ic.branchNumber;
  const branchNum = b.id.replace(/^B/, "");

  const dataLines: string[] = [];

  if (!isDead && ic) {
    const uFlow = getUnit(unitsConfig, "flow");
    const uVel  = getUnit(unitsConfig, "velocity");
    const uPres = getUnit(unitsConfig, "pressure");
    const uLen  = getUnit(unitsConfig, "length");
    const uArea = getUnit(unitsConfig, "area");
    const uRes  = getUnit(unitsConfig, "resistance");
    // Реверс вентилятора — это отрицательный расход относительно ветви;
    // минус в подписи показывает, что воздух идёт против её направления.
    const Qsign = (b.fanReverse && b.hasFan) ? "−" : "";
    const lenReal = b.length || Math.round(calcBranchLength(fromNode, toNode));

    if (ic.branchName && b.type) dataLines.push(b.type);
    if (ic.branchLength) dataLines.push(`L=${uLen.fromBase(lenReal).toFixed(uLen.decimals)}${uLen.symbol}`);
    if (ic.branchAngle) dataLines.push(`A=${(b.angle ?? 0).toFixed(1)}°`);
    if (ic.branchSection) dataLines.push(`S=${uArea.fromBase(b.area).toFixed(uArea.decimals)}${uArea.symbol}`);
    if (ic.branchResistance) dataLines.push(`R=${fmtResistance(b.resistance * 1000, uRes)}`);
    if (ic.branchResistanceSum) dataLines.push(`Rсум=${fmtResistance(branchTotalR(b) * 1000, uRes)}`);
    if (ic.branchAlpha) dataLines.push(`α=${(b.alphaCoef ?? 0).toFixed(0)}·10⁻⁴`);
    if (ic.branchVMax) dataLines.push(`Vmax=${uVel.fromBase(b.vMax ?? 0).toFixed(uVel.decimals)}${uVel.symbol}`);
    if (ic.branchVelocity && hasCalc) dataLines.push(`V=${uVel.fromBase(V).toFixed(uVel.decimals)}${uVel.symbol}${overV ? "⚠" : ""}`);
    if ((ic.branchFlow || ic.branchFlowCalc) && hasCalc) dataLines.push(`Q=${Qsign}${uFlow.fromBase(Q).toFixed(uFlow.decimals)}${uFlow.symbol}`);
    if (ic.branchDepression && hasCalc) dataLines.push(`Н=${uPres.fromBase(b.dP).toFixed(uPres.decimals)}${uPres.symbol}`);
    if (ic.branchExtraFan && b.hasFan) dataLines.push(`ДопН=${uPres.fromBase(branchExtraPressure(b)).toFixed(uPres.decimals)}${uPres.symbol}`);
    if (ic.branchHeight && branchSectionHeight(b) > 0) dataLines.push(`Высота=${uLen.fromBase(branchSectionHeight(b)).toFixed(2)}${uLen.symbol}`);
    if (ic.branchPeople && branchPeopleCount(b) > 0) dataLines.push(`Людей=${branchPeopleCount(b)}`);
    // Показатели вентилятора (расход, напор, мощность, КПД) сюда НЕ попадают:
    // они рисуются подписью у самого значка вентилятора. В общем блоке с длиной
    // и сечением они оказывались далеко от оборудования, к которому относятся.

    // ─── Водопроводные показатели трубы (вкладка «Водопровод») ───
    if (b.hasWaterPipe) {
      if (ic.waterVelocity && (b.wpComputedVelocity ?? 0) > 0)
        dataLines.push(`Vв=${(b.wpComputedVelocity ?? 0).toFixed(2)} м/с`);
      if (ic.waterFlow && (b.wpComputedFlow ?? 0) > 0)
        dataLines.push(`Qв=${(b.wpComputedFlow ?? 0).toFixed(1)} м³/ч`);
      if (ic.waterReducerPressure && b.wpHasReducer) {
        const wbr = waterBranchResults?.get(b.id);
        const pIn  = wbr && wbr.reducerInP > 0 ? wbr.reducerInP : null;
        const pOut = wbr && wbr.reducerOutP > 0 ? wbr.reducerOutP : (b.wpReducerOutPressure ?? 0);
        dataLines.push(pIn != null
          ? `Ред: ${pIn.toFixed(2)}→${pOut.toFixed(2)} МПа`
          : `Ред: →${pOut.toFixed(2)} МПа`);
      }
    }
  } else if (!isDead && !ic && hasCalc) {
    // Панель информации не настроена — показываем самое нужное без единиц:
    // расход и скорость, как в старых схемах.
    const Qsign = (b.fanReverse && b.hasFan) ? "−" : "";
    dataLines.push(`Q=${Qsign}${Q.toFixed(1)}`);
    if (V > 0) dataLines.push(`V=${V.toFixed(1)}`);
  }

  return {
    lines: showNum ? [branchNum, ...dataLines] : dataLines,
    showNum,
    overV,
  };
}
