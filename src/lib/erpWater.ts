// ─────────────────────────────────────────────────────────────────────────────
// Водопровод ППЗ в формате АэроСети (.erp): чтение и запись.
//
// Отдельный модуль, чтобы импорт и экспорт пользовались ОДНОЙ таблицей полей
// и одними переводами единиц. Формат разобран по реальному проекту
// («на 1 октября»: 791 выработка с трубой, 331 кран, 1 резервуар, 21 задвижка,
// 3 редукционных клапана, 18 насосов).
//
// ЕДИНИЦЫ АэроСети → наши:
//   диаметр, стенка трубы   м       → мм          (×1000)
//   давление                Па      → МПа         (÷10⁶)
//   расход                  м³/с    → м³/ч        (×3600)
//   сопротивление крана     Па·с²/м⁶ → МН·с²/м⁸   (÷10⁶; та же формула ρ/(2·(μA)²),
//                                    проверено: кран 66 мм — μ = 0,69, 19 мм — 0,62)
//
// ВЫРАБОТКА (поля самой выработки):
//   HasPlumbing=True        — есть водопровод
//   PipeD, PipeWallThickness — наружный диаметр и стенка, м
//   PipeTemplateId          — труба из справочника PipeTemplateService
//   UserDefinedPipeLength + PipeLengthIsUserDefined — своя длина трубы
//   WaterFlow, DifferentialPressure — результат расчёта (м³/с, Па)
//   HasDuctwork=True        — воздухопровод, диаметр в том же PipeD
//
// УЗЕЛ (поля ribEndNode):
//   Pipe.NodeType           0 — соединение, 1 — резервуар, 2 — потребитель (кран)
//   Pipe.Description        номер крана («ПК 74-5»)
//   Pipe.OutletHoleDiameter диаметр выхода крана, м
//   Pipe.ResistanceCommon   сопротивление крана, Па·с²/м⁶
//   Pipe.FlowDemand         требуемый расход, м³/с
//   Pipe.IsTurnedOn         кран открыт
//   Pipe.WaterVolume, Pipe.WaterTankInitialPressure — объём (м³) и давление (Па) резервуара
//   Pipe.WaterP, Pipe.WaterDynamicP — результат расчёта, Па
//
// ОБЪЕКТЫ НА ВЫРАБОТКЕ (ribItem itemCode):
//   46  — задвижка, ValveIsOpen
//   210 — редукционный клапан, Pipe.WaterReducerOutputPressure (Па)
//   69  — насос (описание — марка, «ЦНСК 300-600 (3 шт)»)
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoBranch, TopoNode } from "@/lib/topology";

export const ERP_ITEM_GATE = "46";
export const ERP_ITEM_REDUCER = "210";
export const ERP_ITEM_PUMP = "69";

const M_TO_MM = 1000;
const PA_TO_MPA = 1e-6;
const M3S_TO_M3H = 3600;
const R_TO_OURS = 1e-6;

const num = (v: string | undefined, def = 0): number => {
  if (v == null || v === "") return def;
  const x = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : def;
};
const bool = (v: string | undefined) => String(v ?? "").trim().toLowerCase() === "true";
const has = (f: Record<string, string>, k: string) => f[k] != null && f[k] !== "";

/** Справочник труб АэроСети (docs/PipeTemplateService). */
export interface ErpPipeTemplate { id: string; name: string; diameter: number; wall: number }

export function parsePipeTemplates(xml: string): Map<string, ErpPipeTemplate> {
  const out = new Map<string, ErpPipeTemplate>();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  doc.querySelectorAll("pipeTemplate").forEach(t => {
    const id = t.getAttribute("id");
    if (!id) return;
    out.set(id, {
      id, name: t.getAttribute("name") ?? "",
      diameter: num(t.getAttribute("diameter") ?? undefined),
      wall: num(t.getAttribute("wallThickness") ?? undefined),
    });
  });
  return out;
}

/** Насос из справочника АэроСети (docs/PumpTemplateService): Q м³/с, p Па. */
export interface ErpPumpTemplate { id: string; name: string; maxSpeed: number; pts: { q: number; p: number }[] }

export function parsePumpTemplates(xml: string): ErpPumpTemplate[] {
  const out: ErpPumpTemplate[] = [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  doc.querySelectorAll("pumpTemplate").forEach(t => {
    const pts: { q: number; p: number }[] = [];
    for (let k = 1; k <= 3; k++) {
      const q = num(t.getAttribute(`q${k}`) ?? undefined), p = num(t.getAttribute(`p${k}`) ?? undefined);
      if (p > 0) pts.push({ q, p });
    }
    out.push({ id: t.getAttribute("id") ?? "", name: (t.getAttribute("name") ?? "").trim(), maxSpeed: num(t.getAttribute("maxSpeed") ?? undefined), pts });
  });
  return out;
}

// ── Чтение ──────────────────────────────────────────────────────────────────

/** Параметры водопровода узла в наших единицах (то, что кладём в makeNode). */
export function erpNodeWater(f: Record<string, string>): Partial<TopoNode> | null {
  if (!has(f, "Pipe.NodeType")) return null;
  const type = String(f["Pipe.NodeType"]).trim();
  const descr = (f["Pipe.Description"] ?? "").trim();
  const description = descr === "..." ? "" : descr;
  const computed = {
    fireComputedStaticP: +(num(f["Pipe.WaterP"]) * PA_TO_MPA).toFixed(4),
    fireComputedDynamicP: +(num(f["Pipe.WaterDynamicP"]) * PA_TO_MPA).toFixed(6),
  };
  if (type === "1") {
    const p0 = num(f["Pipe.WaterTankInitialPressure"]) || num(f["Pipe.WaterP"]);
    return {
      fireNodeType: "reservoir",
      fireInitPressure: +(p0 * PA_TO_MPA).toFixed(4),
      fireCapacity: num(f["Pipe.WaterVolume"]),
      fireDescription: description,
      ...computed,
    };
  }
  if (type === "2") {
    const dMm = +(num(f["Pipe.OutletHoleDiameter"]) * M_TO_MM).toFixed(1);
    const rFile = num(f["Pipe.ResistanceCommon"]);
    // Кран с выходом задан диаметром — сопротивление посчитает расчёт. Если
    // диаметра нет, а R есть, переносим R как заданное.
    const manual = !(dMm > 0) && rFile > 0;
    return {
      fireNodeType: "consumer",
      fireConsumerType: "fire_hydrant",
      fireHydrantOpen: bool(f["Pipe.IsTurnedOn"]),
      fireHydrantDiameter: dMm,
      fireResistanceMode: manual ? "manual" : "project",
      fireManualR: +(rFile * R_TO_OURS).toFixed(4),
      fireRequiredFlow: +(num(f["Pipe.FlowDemand"]) * M3S_TO_M3H).toFixed(3),
      fireDescription: description,
      ...computed,
    };
  }
  return { fireNodeType: "junction", fireDescription: description, ...computed };
}

export interface ErpWaterItem {
  code: string;
  description: string;
  f: Record<string, string>;
  reversed: boolean;
}

/** Насос на выработке: марка и число параллельных из описания. */
export interface ErpPumpOnBranch {
  name: string;
  parallel: number;
  reversed: boolean;
  /** Номинальный напор одного насоса, м вод. ст. (по справочнику файла или марке). */
  head: number;
  t: number;
}

/** Напор насоса по марке ЦНС(К) Q-H («ЦНСК 300-600» → 600 м), иначе 0. */
export function pumpHeadFromName(name: string): number {
  const m = name.match(/ЦНС\S*\s*(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/i);
  return m ? num(m[2]) : 0;
}

export function pumpParallelFromName(name: string): number {
  const m = name.match(/(\d+)\s*шт/i);
  const k = m ? parseInt(m[1], 10) : 1;
  return k > 0 && k < 50 ? k : 1;
}

/** Параметры водопровода выработки в наших единицах. */
export function erpBranchWater(
  f: Record<string, string>,
  items: ErpWaterItem[],
  pipes: Map<string, ErpPipeTemplate>,
): Partial<TopoBranch> {
  const out: Partial<TopoBranch> = {};
  const gates = items.filter(it => it.code === ERP_ITEM_GATE);
  const reducers = items.filter(it => it.code === ERP_ITEM_REDUCER);
  const plumbing = bool(f["HasPlumbing"]) || gates.length > 0 || reducers.length > 0;
  if (plumbing) {
    const tpl = pipes.get(f["PipeTemplateId"] ?? "");
    const dM = num(f["PipeD"]) || tpl?.diameter || 0;
    const wallM = has(f, "PipeWallThickness") ? num(f["PipeWallThickness"]) : (tpl?.wall ?? 0);
    const userLen = bool(f["PipeLengthIsUserDefined"]) && num(f["UserDefinedPipeLength"]) > 0;
    Object.assign(out, {
      hasWaterPipe: true,
      wpDiameter: dM > 0 ? +(dM * M_TO_MM).toFixed(1) : 100,
      wpWallThickness: +(wallM * M_TO_MM).toFixed(2),
      wpMaterial: "Сталь",
      wpLengthManual: userLen,
      wpLength: userLen ? +num(f["UserDefinedPipeLength"]).toFixed(2) : 0,
      wpComputedFlow: +(num(f["WaterFlow"]) * M3S_TO_M3H).toFixed(3),
      wpComputedDeltaP: +(num(f["DifferentialPressure"]) * PA_TO_MPA).toFixed(6),
    });
  }
  if (gates.length > 0) {
    // Несколько задвижек последовательно: ветвь перекрыта, если закрыта любая.
    out.wpHasGate = true;
    out.wpGateClosed = gates.some(g => has(g.f, "ValveIsOpen") && !bool(g.f["ValveIsOpen"]));
  }
  if (reducers.length > 0) {
    const pOut = Math.min(...reducers.map(r => num(r.f["Pipe.WaterReducerOutputPressure"]) || Infinity));
    out.wpHasReducer = true;
    if (Number.isFinite(pOut) && pOut > 0) out.wpReducerOutPressure = +(pOut * PA_TO_MPA).toFixed(3);
  }
  if (bool(f["HasDuctwork"])) {
    const dM = num(f["PipeD"]);
    Object.assign(out, { hasAirPipe: true, apDiameter: dM > 0 ? +(dM * M_TO_MM).toFixed(1) : 150, apMaterial: "Сталь" });
  }
  return out;
}

// ── Запись ──────────────────────────────────────────────────────────────────

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fld = (name: string, value: string | number | boolean) =>
  `<field name="${name}" value="${esc(typeof value === "boolean" ? (value ? "True" : "False") : String(value))}" />`;
const nn = (v: number | undefined, d = 6) => { const x = Number(v); return Number.isFinite(x) ? String(+x.toFixed(d)) : "0"; };

/** Поля водопровода узла для <ribEndNode>. Пусто — узел вне водопровода. */
export function erpNodeWaterXml(nd: TopoNode): string {
  // Узел без типа пишем без полей водопровода — как и в файлах АэроСети
  // (там тип есть не у всех узлов на трубах). Иначе при обратном чтении
  // обычные узлы превращались бы в «соединения» водопровода.
  const t = nd.fireNodeType ?? "none";
  if (t === "none") return "";
  const descr = fld("Pipe.Description", nd.fireDescription || "");
  const res = fld("Pipe.WaterP", nn((nd.fireComputedStaticP ?? 0) / PA_TO_MPA, 3))
    + fld("Pipe.WaterDynamicP", nn((nd.fireComputedDynamicP ?? 0) / PA_TO_MPA, 3));
  if (t === "reservoir") {
    return fld("Pipe.NodeType", 1) + descr
      + fld("Pipe.WaterVolume", nn(nd.fireCapacity, 3))
      + fld("Pipe.WaterTankInitialPressure", nn((nd.fireInitPressure ?? 0) / PA_TO_MPA, 1)) + res;
  }
  if (t === "consumer") {
    const dM = (nd.fireHydrantDiameter ?? 0) / M_TO_MM;
    const r = (nd.fireResistanceMode ?? "project") === "manual" ? (nd.fireManualR ?? 0) / R_TO_OURS : 0;
    return fld("Pipe.NodeType", 2) + descr
      + fld("Pipe.OutletHoleDiameter", nn(dM, 4))
      + (r > 0 ? fld("Pipe.ResistanceCommon", nn(r, 3)) : "")
      + fld("Pipe.FlowDemand", nn((nd.fireRequiredFlow ?? 0) / M3S_TO_M3H, 9))
      + fld("Pipe.IsTurnedOn", !!nd.fireHydrantOpen) + res;
  }
  return fld("Pipe.NodeType", 0) + descr + res;
}

/** Поля водопровода и воздухопровода для полей выработки. */
export function erpBranchWaterXml(br: TopoBranch): string {
  let s = "";
  if (br.hasWaterPipe) {
    s += fld("HasPlumbing", true)
      + fld("PipeD", nn((br.wpDiameter ?? 0) / M_TO_MM, 4))
      + fld("PipeWallThickness", nn((br.wpWallThickness ?? 0) / M_TO_MM, 5))
      + fld("PipeLengthIsUserDefined", !!br.wpLengthManual)
      + (br.wpLengthManual ? fld("UserDefinedPipeLength", nn(br.wpLength, 2)) : "")
      + fld("WaterFlow", nn((br.wpComputedFlow ?? 0) / M3S_TO_M3H, 9))
      + fld("DifferentialPressure", nn((br.wpComputedDeltaP ?? 0) / PA_TO_MPA, 3));
  }
  if (br.hasAirPipe) {
    s += fld("HasDuctwork", true);
    if (!br.hasWaterPipe) s += fld("PipeD", nn((br.apDiameter ?? 0) / M_TO_MM, 4));
  }
  return s;
}

/** Задвижка, редукционный клапан, насос — объектами на выработке. */
export function erpBranchWaterItemsXml(
  br: TopoBranch,
  pumps: { name: string; parallel: number; reverse: boolean; seed: string }[],
  attrs: (scale: number, reversed?: boolean) => string,
  guid: (seed: string) => string,
  ventModes: string,
): string[] {
  const out: string[] = [];
  const wrap = (code: string, seed: string, descr: string, fields: string, reversed = false) =>
    `<ribItem id="${guid(seed)}" itemCode="${code}"${descr ? ` description="${esc(descr)}"` : ""}${attrs(0.5, reversed)}>`
    + `<customFields><fields>${fields}</fields></customFields>${ventModes}</ribItem>`;
  if (br.hasWaterPipe && br.wpHasGate) {
    out.push(wrap(ERP_ITEM_GATE, "gate:" + br.id, "", fld("ValveIsOpen", !br.wpGateClosed)));
  }
  if (br.hasWaterPipe && br.wpHasReducer) {
    const pOut = (br.wpReducerOutPressure ?? 0) / PA_TO_MPA;
    out.push(wrap(ERP_ITEM_REDUCER, "red:" + br.id, "",
      fld("Pipe.WaterReducerResistance", 0) + fld("Pipe.WaterReducerOutputPressure", nn(pOut, 1))));
  }
  for (const pump of pumps) {
    const name = pump.parallel > 1 ? `${pump.name} (${pump.parallel} шт)` : pump.name;
    out.push(wrap(ERP_ITEM_PUMP, "pump:" + br.id + ":" + pump.seed, name, "", pump.reverse));
  }
  return out;
}
