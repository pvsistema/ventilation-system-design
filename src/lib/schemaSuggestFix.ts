// ─────────────────────────────────────────────────────────────────────────────
// ИСПРАВЛЕНИЯ С ПОДТВЕРЖДЕНИЕМ — программа предлагает значение, инженер
// утверждает каждое (или группу целиком).
//
//   • сечение — по соседним участкам той же выработки / типу выработки;
//   • α и шероховатость — по соседним участкам / типу крепи / типу выработки;
//   • перемычка без сопротивления — воздухопроницаемость из справочника
//     перемычек рудника по виду и материалу значка;
//   • давление разрушения и толщина перемычек — по справочнику / материалу;
//   • вентилятор без характеристики — модель из каталога по названию;
//   • пересечение без общего узла — вставить общий узел в обе выработки;
//   • близкие несоединённые узлы — слить;
//   • поверхностный узел с несколькими ветвями — разделить на отдельные.
//
// Предложения строятся по результату проверки схемы (её уже посчитала
// панель «Проверка»), применение — чистая функция applySuggestions.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch, makeNode, surveyXYZ } from "./topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import type { Position } from "./positions";
import { SURFACE_TYPES } from "./aerodynamics";
import { getFanById } from "./fanCurves";
import { findCatalogFanByName } from "./erpImport";
import { solidBulkheadRkMurg } from "./bulkheads";
import { symbolBulkheadR, bulkheadSymbolsOf, type BulkheadRef } from "./bulkheadResistance";
import { defaultFailureMPa } from "./blastBarriers";
import { BULKHEAD_SYMBOL_IDS, OPEN_DOOR_IDS, LEGEND_TYPES, guessBulkheadSymbolId } from "./schemaSymbols";
import { fmtNum, fmtKmu, type BranchNote, type NodeNote, type GroupNote } from "./schemaCheckTypes";
import type { NearPair } from "./schemaCheck";
import type { BranchBulkheadInfo } from "./branchBulkheadInfo";
import { splitBranchesAt } from "./schemaAutoFix";
import type { MineBulkheadExport, BranchType } from "@/components/cad/EquipmentRefDialog";

export type SuggestKind =
  | "area" | "alpha" | "bulkheadR" | "bulkheadFailure" | "bulkheadThickness"
  | "fanCurve" | "crossing" | "near" | "surfaceMulti";

export const SUGGEST_GROUPS: { kind: SuggestKind; title: string; hint: string }[] = [
  { kind: "area", title: "Сечение выработок", hint: "По соседним участкам той же выработки или по типу выработки из справочника рудника." },
  { kind: "alpha", title: "Коэффициент α и шероховатость", hint: "По соседним участкам той же выработки, типу крепи или типу выработки." },
  { kind: "bulkheadR", title: "Перемычки без сопротивления", hint: "Воздухопроницаемость из справочника перемычек рудника по виду и материалу сооружения. Расчёт R — «по проекту»." },
  { kind: "fanCurve", title: "Вентиляторы без характеристики", hint: "Модель из каталога вентиляторов, подобранная по названию." },
  { kind: "crossing", title: "Пересечения без общего узла", hint: "В обе выработки вставляется общий узел. Если выработки на разных уровнях (сбойка над штреком) — снимите галочку." },
  { kind: "near", title: "Близкие несоединённые узлы", hint: "Узлы сливаются в один. Если это разные выработки, случайно сблизившиеся, — снимите галочку." },
  { kind: "surfaceMulti", title: "Поверхностный узел с несколькими ветвями", hint: "Каждая ветвь получает свой узел выхода на поверхность. Воздухораспределение не меняется." },
  { kind: "bulkheadFailure", title: "Давление разрушения перемычек", hint: "Из справочника перемычек рудника, иначе — по материалу (прил. 28 ФНП № 494)." },
  { kind: "bulkheadThickness", title: "Толщина перемычек", hint: "Типовая толщина по материалу. Сверьте с проектом перемычки." },
];

type Payload =
  | { t: "branch"; branchId: string; patch: Partial<TopoBranch> }
  | { t: "symbol"; symbolId: string; patch: Partial<SchemaSymbol> }
  | { t: "merge"; keepId: string; dropId: string }
  | { t: "cross"; b1: string; t1: number; b2: string; t2: number; draw: XYZ; survey: XYZ }
  | { t: "splitSurface"; nodeId: string };

type XYZ = { x: number; y: number; z: number };

export interface Suggestion {
  id: string;
  kind: SuggestKind;
  /** Объект: «Штрек 5 (12→14)», «Узел 7». */
  title: string;
  /** Было → станет, понятным языком. */
  from: string;
  to: string;
  /** Откуда взято значение. */
  source: string;
  defaultOn: boolean;
  /** Для показа на схеме. */
  branchId?: string;
  nodeId?: string;
  payload: Payload;
}

export interface SuggestCheck {
  params: { noArea: BranchNote[]; badArea: BranchNote[]; badAlpha: BranchNote[]; fanNoCurve: BranchNote[]; zeroBulkhead: BranchNote[] };
  topo: { crossings: GroupNote[] };
  method: { surfaceMulti: NodeNote[]; bulkheadFailure: BranchNote[]; bulkheadThickness: BranchNote[] };
  nearPairs: NearPair[];
  bulkheads: Map<string, BranchBulkheadInfo>;
}

export interface SuggestInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  symbols: SchemaSymbol[];
  positions: Position[];
}

export interface SuggestOptions {
  areaMin: number;
  areaMax: number;
  alphaMin: number;
  alphaMax: number;
  /** Справочник перемычек рудника. */
  bulkheadRefs: MineBulkheadExport[];
  /** Типы выработок рудника. */
  mineTypes: BranchType[];
}

const median = (arr: number[]) => {
  const s = arr.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const norm = (s: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

// ── Справочник перемычек: запись по виду и материалу значка ──────────────
type CatType = MineBulkheadExport["type"];
function catTypeOf(typeId: string): CatType {
  if (typeId === "sail") return "sail";
  if (/^water_dam/.test(typeId)) return "water";
  if (/^regulator/.test(typeId)) return "regulator";
  // Двери с окном, решётчатые, открытые — тоже двери (не глухие перемычки).
  if (/^(door|auto|fire_door|win_|lat_|open_|proem_)/.test(typeId)) return "door";
  return "solid";
}
const MAT_RE: [RegExp, RegExp][] = [
  [/(conc|concrete)$/, /бетон/i], [/wood$/, /дерев/i], [/brick$/, /кирпич/i], [/metal$/, /металл/i],
];
export function bulkheadRefFor(typeId: string, refs: MineBulkheadExport[]): MineBulkheadExport | undefined {
  const want = catTypeOf(typeId);
  const legendName = LEGEND_TYPES.find((l) => l.id === typeId)?.name ?? "";
  const canon = guessBulkheadSymbolId(legendName) || typeId;
  const ofType = refs.filter((r) => r.type === want && (r.airPermeability ?? 0) > 0);
  const bySym = ofType.find((r) => (r.symbolId || guessBulkheadSymbolId(r.name)) === canon || r.symbolId === typeId);
  if (bySym) return bySym;
  // Водоподпорные, регуляторы: материал по названию записи.
  const mat = MAT_RE.find(([re]) => re.test(typeId))?.[1];
  const auto = /^(auto|door_auto)/.test(typeId);
  const byMat = ofType.find((r) => (mat ? mat.test(r.name) : !MAT_RE.some(([, m]) => m.test(r.name)))
    && (want !== "door" || /автомат/i.test(r.name) === auto));
  return byMat ?? ofType[0];
}

/** Типовая толщина перемычки по материалу, м. */
function typicalThickness(typeId: string): number {
  if (typeId.startsWith("bk_blast")) return 1.0;
  if (/(conc|concrete)$/.test(typeId)) return 0.5;
  if (/brick$/.test(typeId)) return 0.5;
  if (/wood$/.test(typeId)) return 0.2;
  if (/metal$/.test(typeId)) return 0.05;
  return 0.3;
}

export function buildSuggestions(input: SuggestInput, check: SuggestCheck, opts: SuggestOptions): Suggestion[] {
  const { nodes, branches, symbols } = input;
  const out: Suggestion[] = [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const nodeNum = (id: string) => nodeById.get(id)?.number || id;
  const bName = (b: TopoBranch) => `${b.type || `Ветвь ${b.id}`} (${nodeNum(b.fromId)}→${nodeNum(b.toId)})`;
  const nName = (n: TopoNode) => n.name || `Узел ${n.number || n.id}`;
  const refMap = new Map<string, BulkheadRef>(opts.bulkheadRefs.map((r) => [r.id, r]));

  // Соседние ветви: через общий узел, без вспомогательных ниток.
  const byNode = new Map<string, TopoBranch[]>();
  for (const b of branches) {
    if (b.fromId === b.toId || b.isVentPipeBranch || b.isLeakage) continue;
    (byNode.get(b.fromId) ?? byNode.set(b.fromId, []).get(b.fromId)!).push(b);
    (byNode.get(b.toId) ?? byNode.set(b.toId, []).get(b.toId)!).push(b);
  }
  // Значение по соседям: сначала участки той же выработки (то же название)
  // до 3 шагов, затем любые соседи через промежуточный узел (2 ветви).
  const fromNeighbors = (b: TopoBranch, val: (x: TopoBranch) => number, ok: (v: number) => boolean) => {
    const same: number[] = [], near: number[] = [];
    const seen = new Set([b.id]);
    let front = [b];
    for (let step = 0; step < 3 && same.length === 0; step++) {
      const next: TopoBranch[] = [];
      for (const cur of front) for (const nid of [cur.fromId, cur.toId]) {
        const list = byNode.get(nid) ?? [];
        for (const o of list) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          const v = val(o);
          if (b.type && norm(o.type) === norm(b.type)) { if (ok(v)) same.push(v); next.push(o); }
          else if (step === 0 && list.length === 2 && ok(v)) near.push(v);
        }
      }
      front = next;
    }
    if (same.length) return { v: median(same), src: `по соседним участкам «${b.type}»` };
    if (near.length) return { v: median(near), src: "по соседней выработке" };
    return null;
  };
  const mineTypeOf = (b: TopoBranch) => opts.mineTypes.find((t) => norm(t.name) === norm(b.type));
  // Та же выработка (название) где угодно в сети — запасной вариант.
  const sameNameMedian = (b: TopoBranch, val: (x: TopoBranch) => number, ok: (v: number) => boolean) => {
    if (!b.type) return 0;
    return median(branches.filter((o) => o.id !== b.id && norm(o.type) === norm(b.type)).map(val).filter(ok));
  };

  // ── Сечение ────────────────────────────────────────────────────────────
  const areaOk = (v: number) => v >= opts.areaMin && v <= opts.areaMax;
  const areaList = [...check.params.noArea.map((x) => ({ ...x, none: true })), ...check.params.badArea.map((x) => ({ ...x, none: false }))];
  for (const { branch: b0, none } of areaList) {
    const b = branchById.get(b0.id) ?? b0;
    let pick = fromNeighbors(b, (x) => x.area, areaOk);
    if (!pick) { const t = mineTypeOf(b); if (t && areaOk(t.area)) pick = { v: t.area, src: `по типу выработки «${t.name}»` }; }
    if (!pick) { const v = sameNameMedian(b, (x) => x.area, areaOk); if (v > 0) pick = { v, src: `по другим участкам «${b.type}»` }; }
    if (!pick) continue;
    const S = +pick.v.toFixed(2);
    // Периметр — с тем же отношением P/√S, что было; иначе — как у арки (≈ 3,8·√S).
    const k = b.area > 0 && b.perimeter > 0 ? b.perimeter / Math.sqrt(b.area) : 3.8;
    out.push({
      id: `area:${b.id}`, kind: "area", title: bName(b), branchId: b.id,
      from: none ? "S не задано" : `S ${fmtNum(b.area, 2)} м²`, to: `S ${fmtNum(S, 2)} м²`, source: pick.src,
      // Сечение, заданное вне диапазона, могло быть намеренным (камера,
      // скважина) — его по умолчанию не трогаем; не заданное — исправляем.
      defaultOn: none,
      payload: { t: "branch", branchId: b.id, patch: { manualSection: true, area: S, perimeter: +(k * Math.sqrt(S)).toFixed(2) } },
    });
  }

  // ── α и шероховатость ──────────────────────────────────────────────────
  const alphaOk = (v: number) => v >= opts.alphaMin && v <= opts.alphaMax;
  for (const { branch: b0 } of check.params.badAlpha) {
    const b = branchById.get(b0.id) ?? b0;
    if (b.resistanceMode === "roughness") {
      const surf = SURFACE_TYPES.find((s) => s.id === b.surfaceId);
      const nb = fromNeighbors(b, (x) => (x.resistanceMode === "roughness" ? x.roughness : 0), (v) => v > 0);
      const v = nb?.v ?? surf?.roughness ?? 25;
      out.push({
        id: `rough:${b.id}`, kind: "alpha", title: bName(b), branchId: b.id,
        from: "Δ = 0 мм", to: `Δ = ${fmtNum(v, 0)} мм`,
        source: nb?.src ?? (surf ? `по типу крепи «${surf.name}»` : "незакреплённая ровная порода"),
        defaultOn: true, payload: { t: "branch", branchId: b.id, patch: { roughness: v } },
      });
      continue;
    }
    let pick = fromNeighbors(b, (x) => (x.resistanceMode === "alpha" || x.resistanceMode === "surface" ? x.alphaCoef : 0), alphaOk);
    if (!pick && b.resistanceMode === "surface") {
      const s = SURFACE_TYPES.find((x) => x.id === b.surfaceId);
      if (s && alphaOk(s.alpha)) pick = { v: s.alpha, src: `по типу крепи «${s.name}»` };
    }
    if (!pick) { const t = mineTypeOf(b); if (t && alphaOk(t.alphaCoef)) pick = { v: t.alphaCoef, src: `по типу выработки «${t.name}»` }; }
    if (!pick) continue;
    const a = +pick.v.toFixed(1);
    out.push({
      id: `alpha:${b.id}`, kind: "alpha", title: bName(b), branchId: b.id,
      from: `α = ${fmtNum(b.alphaCoef, 1)}·10⁻⁴`, to: `α = ${fmtNum(a, 1)}·10⁻⁴`, source: pick.src,
      defaultOn: !(b.alphaCoef > 0),
      // В режиме «по типу крепи» α берётся из справочника — переводим на «α вручную».
      payload: { t: "branch", branchId: b.id, patch: { alphaCoef: a, resistanceMode: "alpha" } },
    });
  }

  // ── Перемычки без сопротивления ────────────────────────────────────────
  for (const { branch: b0 } of check.params.zeroBulkhead) {
    const b = branchById.get(b0.id) ?? b0;
    const syms = bulkheadSymbolsOf(b, symbols);
    if (syms.length > 0) {
      for (const s of syms) {
        if (OPEN_DOOR_IDS.has(s.typeId) || (s.bkWindowArea ?? 0) > 0.001) continue;
        if (symbolBulkheadR(s, b, refMap) > 0) continue;
        const ref = bulkheadRefFor(s.typeId, opts.bulkheadRefs);
        if (!ref) continue;
        const r = solidBulkheadRkMurg(ref.airPermeability, b.area);
        out.push({
          id: `bkR:${s.id}`, kind: "bulkheadR", title: `${s.label ? `№ ${s.label} · ` : ""}${s.bkBulkheadName || LEGEND_TYPES.find((l) => l.id === s.typeId)?.name || "Перемычка"}`,
          branchId: b.id, from: `R 0${s.bkResMode === "manual" ? " (вручную)" : ""}`, to: `R ${fmtKmu(r)} кМюрг`,
          source: `справочник: «${ref.name}», A = ${ref.airPermeability}${s.bkResMode === "manual" ? " · R = 0 задано вручную (как в исходном файле)" : ""}`,
          // R = 0, заданное вручную, обычно пришло из исходной модели
          // (АэроСеть) — по умолчанию не меняем, чтобы расчёт совпадал с ней.
          defaultOn: s.bkResMode !== "manual",
          payload: { t: "symbol", symbolId: s.id, patch: { bkResMode: "project", bkBulkheadId: ref.id, bkAirPerm: ref.airPermeability, bkManualAirPerm: false } },
        });
      }
    } else if (b.hasBulkhead) {
      const ref = bulkheadRefFor(guessBulkheadSymbolId(b.bulkheadName || "Перемычка глухая"), opts.bulkheadRefs);
      if (!ref) continue;
      const r = solidBulkheadRkMurg(ref.airPermeability, b.area);
      out.push({
        id: `bkR:branch:${b.id}`, kind: "bulkheadR", title: `${b.bulkheadName || "Перемычка"} · ${bName(b)}`, branchId: b.id,
        from: "R 0", to: `R ${fmtKmu(r)} кМюрг`, source: `справочник: «${ref.name}»`, defaultOn: true,
        payload: { t: "branch", branchId: b.id, patch: { bulkheadResMode: "project", bulkheadId: ref.id, bulkheadAirPerm: ref.airPermeability, bulkheadManualAirPerm: false } },
      });
    }
  }

  // ── Давление разрушения и толщина перемычек ────────────────────────────
  const failIds = new Set(check.method.bulkheadFailure.map((x) => x.branch.id));
  const thickIds = new Set(check.method.bulkheadThickness.map((x) => x.branch.id));
  for (const s of symbols) {
    if (!s.branchId || !BULKHEAD_SYMBOL_IDS.has(s.typeId)) continue;
    const b = branchById.get(s.branchId);
    if (!b) continue;
    const name = `${s.label ? `№ ${s.label} · ` : ""}${s.bkBulkheadName || LEGEND_TYPES.find((l) => l.id === s.typeId)?.name || "Перемычка"}`;
    const open = OPEN_DOOR_IDS.has(s.typeId) && (s.bkWindowArea ?? 0) <= 0.001;
    const full = (s.bkWindowArea ?? 0) > 0.001 && (b.area ?? 0) > 0 && (s.bkWindowArea ?? 0) >= b.area * 0.999;
    if (open || full) continue;
    if (failIds.has(b.id) && !((s.bkFailurePressure ?? 0) > 0) && !((b.bulkheadFailurePressure ?? 0) > 0)) {
      const ref = bulkheadRefFor(s.typeId, opts.bulkheadRefs);
      const fp = ref?.failurePressure && ref.failurePressure > 0 ? ref.failurePressure : defaultFailureMPa(s.typeId);
      out.push({
        id: `fail:${s.id}`, kind: "bulkheadFailure", title: name, branchId: b.id,
        from: "не задано", to: `${fmtNum(fp, 3)} МПа`, source: ref ? `справочник: «${ref.name}»` : "по материалу",
        defaultOn: true, payload: { t: "symbol", symbolId: s.id, patch: { bkFailurePressure: fp } },
      });
    }
    if (thickIds.has(b.id) && s.typeId !== "sail" && !((s.bkThickness ?? 0) > 0)) {
      const t = typicalThickness(s.typeId);
      out.push({
        id: `thick:${s.id}`, kind: "bulkheadThickness", title: name, branchId: b.id,
        from: "не задана", to: `${fmtNum(t, 2)} м`, source: "типовая по материалу",
        defaultOn: true, payload: { t: "symbol", symbolId: s.id, patch: { bkThickness: t } },
      });
    }
  }

  // ── Вентиляторы без характеристики ─────────────────────────────────────
  for (const { branch: b0 } of check.params.fanNoCurve) {
    const b = branchById.get(b0.id) ?? b0;
    if (b.fanMode !== "curve" || getFanById(b.fanCurveId)) continue;
    const cat = findCatalogFanByName(b.fanName, b.fanCurveId, b.type);
    if (!cat) continue;
    const angle = cat.bladeAngles[Math.floor((cat.bladeAngles.length - 1) / 2)] ?? 0;
    out.push({
      id: `fan:${b.id}`, kind: "fanCurve", title: `${b.fanType} ${b.fanName || ""} · ${bName(b)}`.replace(/\s+/g, " "), branchId: b.id,
      from: b.fanCurveId ? `модель «${b.fanCurveId}» не найдена` : "модель не выбрана", to: `«${cat.name}»`,
      source: "каталог по названию", defaultOn: true,
      payload: { t: "branch", branchId: b.id, patch: {
        fanCurveId: cat.id, fanRpm: b.fanRpm > 0 ? b.fanRpm : cat.rpmNominal,
        fanBladeAngle: cat.bladeAngles.includes(b.fanBladeAngle) ? b.fanBladeAngle : angle,
      } },
    });
  }

  // ── Пересечения без общего узла ────────────────────────────────────────
  const S = (id: string) => surveyXYZ(nodeById.get(id)!);
  for (const g of check.topo.crossings) {
    const [id1, id2] = g.branchIds;
    const b1 = branchById.get(id1), b2 = branchById.get(id2);
    if (!b1 || !b2 || !nodeById.has(b1.fromId) || !nodeById.has(b1.toId) || !nodeById.has(b2.fromId) || !nodeById.has(b2.toId)) continue;
    const c = closestOnSegments(S(b1.fromId), S(b1.toId), S(b2.fromId), S(b2.toId));
    if (!c) continue;
    const P1 = nodeById.get(b1.fromId)!, P2 = nodeById.get(b1.toId)!;
    const draw = { x: P1.x + (P2.x - P1.x) * c.t, y: P1.y + (P2.y - P1.y) * c.t, z: P1.z + (P2.z - P1.z) * c.t };
    out.push({
      id: `cross:${b1.id}|${b2.id}`, kind: "crossing", title: g.title, branchId: b1.id,
      from: `оси сходятся на ${fmtNum(c.dist, 2)} м`, to: "общий узел", source: `отметка ${fmtNum(c.mid.z, 1)} м`,
      // Чем дальше оси, тем вероятнее, что выработки на разных уровнях.
      defaultOn: c.dist <= 0.3,
      payload: { t: "cross", b1: b1.id, t1: c.t, b2: b2.id, t2: c.u, draw, survey: c.mid },
    });
  }

  // ── Близкие несоединённые узлы ─────────────────────────────────────────
  const keepRank = (n: TopoNode) => (n.atmosphereLink ? 2 : 0) + (n.name ? 1 : 0);
  for (const { a, b, dist } of check.nearPairs) {
    const keepA = keepRank(a) !== keepRank(b) ? keepRank(a) > keepRank(b) : (parseInt(a.id, 10) || 0) <= (parseInt(b.id, 10) || 0);
    const keep = keepA ? a : b, drop = keepA ? b : a;
    out.push({
      id: `near:${a.id}|${b.id}`, kind: "near", title: `${nName(a)} ↔ ${nName(b)}`, nodeId: keep.id,
      from: `${fmtNum(dist, 2)} м друг от друга`, to: `один узел (${nName(keep)})`, source: "слияние",
      defaultOn: true, payload: { t: "merge", keepId: keep.id, dropId: drop.id },
    });
  }

  // ── Поверхностный узел с несколькими ветвями ───────────────────────────
  for (const { node: n } of check.method.surfaceMulti) {
    const deg = byNode.get(n.id)?.length ?? 0;
    out.push({
      id: `surf:${n.id}`, kind: "surfaceMulti", title: nName(n), nodeId: n.id,
      from: `${deg} ветви в одном узле`, to: `${deg} отдельных выхода`, source: "разделение узла",
      defaultOn: true, payload: { t: "splitSurface", nodeId: n.id },
    });
  }

  return out;
}

/** Ближайшие точки двух отрезков (в объёме); null — параллельны. */
function closestOnSegments(p1: XYZ, p2: XYZ, q1: XYZ, q2: XYZ) {
  const d1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  const d2 = { x: q2.x - q1.x, y: q2.y - q1.y, z: q2.z - q1.z };
  const r = { x: p1.x - q1.x, y: p1.y - q1.y, z: p1.z - q1.z };
  const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z;
  const e = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z;
  const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z;
  const c = d1.x * r.x + d1.y * r.y + d1.z * r.z;
  const f = d2.x * r.x + d2.y * r.y + d2.z * r.z;
  const den = a * e - b * b;
  if (a < 1e-9 || e < 1e-9 || den < 1e-9 * a * e) return null;
  const t = Math.min(0.98, Math.max(0.02, (b * f - c * e) / den));
  const u = Math.min(0.98, Math.max(0.02, (a * f - b * c) / den));
  const A = { x: p1.x + d1.x * t, y: p1.y + d1.y * t, z: p1.z + d1.z * t };
  const B = { x: q1.x + d2.x * u, y: q1.y + d2.y * u, z: q1.z + d2.z * u };
  return {
    t, u, dist: Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z),
    mid: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2 },
  };
}

/**
 * Применить выбранные предложения. Порядок важен: сначала значения
 * (они ссылаются на текущие номера ветвей и значков), затем вставка узлов
 * в пересечения, слияние близких узлов и разделение поверхностных.
 */
export function applySuggestions(input: SuggestInput, chosen: Suggestion[]): SuggestInput {
  let nodes = input.nodes.slice();
  let branches = input.branches.slice();
  let symbols = input.symbols.slice();
  let positions = input.positions;

  // 1. Значения ветвей и значков
  const bp = new Map<string, Partial<TopoBranch>>();
  const sp = new Map<string, Partial<SchemaSymbol>>();
  for (const s of chosen) {
    if (s.payload.t === "branch") bp.set(s.payload.branchId, { ...bp.get(s.payload.branchId), ...s.payload.patch });
    if (s.payload.t === "symbol") sp.set(s.payload.symbolId, { ...sp.get(s.payload.symbolId), ...s.payload.patch });
  }
  if (bp.size) branches = branches.map((b) => (bp.has(b.id) ? { ...b, ...bp.get(b.id) } : b));
  if (sp.size) symbols = symbols.map((s) => (sp.has(s.id) ? { ...s, ...sp.get(s.id) } : s));

  // Свободные номера для новых узлов
  const usedIds = new Set(nodes.map((n) => n.id));
  const usedNums = new Set(nodes.map((n) => parseInt(n.number, 10)).filter((v) => !isNaN(v)));
  let nid = 1, nnum = 1;
  const newNode = (p: Partial<TopoNode>) => {
    while (usedIds.has(String(nid))) nid++;
    while (usedNums.has(nnum)) nnum++;
    const id = String(nid); usedIds.add(id); usedNums.add(nnum);
    return makeNode(id, { ...p, number: String(nnum) });
  };

  // 2. Пересечения: общий узел в обе выработки
  const cuts = new Map<string, { nodeId: string; t: number }[]>();
  for (const s of chosen) {
    if (s.payload.t !== "cross") continue;
    const { b1, t1, b2, t2, draw, survey } = s.payload;
    if (!branches.some((b) => b.id === b1) || !branches.some((b) => b.id === b2)) continue;
    const n = newNode({ x: draw.x, y: draw.y, z: draw.z, surveyX: survey.x, surveyY: survey.y, surveyZ: survey.z });
    nodes.push(n);
    (cuts.get(b1) ?? cuts.set(b1, []).get(b1)!).push({ nodeId: n.id, t: t1 });
    (cuts.get(b2) ?? cuts.set(b2, []).get(b2)!).push({ nodeId: n.id, t: t2 });
  }
  if (cuts.size) {
    const r = splitBranchesAt(branches, symbols, cuts);
    branches = r.branches; symbols = r.symbols;
  }

  // 3. Слияние близких узлов
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.has(r)) r = parent.get(r)!; return r; };
  for (const s of chosen) {
    if (s.payload.t !== "merge") continue;
    const k = find(s.payload.keepId), d = find(s.payload.dropId);
    if (k !== d) parent.set(d, k);
  }
  if (parent.size) {
    branches = branches.map((b) => {
      const f = find(b.fromId), t = find(b.toId);
      return f === b.fromId && t === b.toId ? b : { ...b, fromId: f, toId: t };
    });
    nodes = nodes.filter((n) => !parent.has(n.id));
    const loops = new Set(branches.filter((b) => b.fromId === b.toId).map((b) => b.id));
    if (loops.size) {
      branches = branches.filter((b) => !loops.has(b.id));
      symbols = symbols.filter((s) => !s.branchId || !loops.has(s.branchId));
      positions = positions.map((p) => ({
        ...p, branchIds: p.branchIds.filter((id) => !loops.has(id)),
        leaderBranchId: p.leaderBranchId && loops.has(p.leaderBranchId) ? null : p.leaderBranchId,
      }));
    }
  }

  // 4. Поверхностные узлы: каждой ветви — свой выход на поверхность
  for (const s of chosen) {
    if (s.payload.t !== "splitSurface") continue;
    const id = s.payload.nodeId;
    const src = nodes.find((n) => n.id === id);
    if (!src) continue;
    const own = branches.filter((b) => (b.fromId === id || b.toId === id) && !b.isVentPipeBranch);
    const remap = new Map<string, string>();
    own.slice(1).forEach((b) => {
      const n = newNode({
        x: src.x, y: src.y, z: src.z, surveyX: src.surveyX, surveyY: src.surveyY, surveyZ: src.surveyZ,
        name: src.name, atmosphereLink: true, airTemp: src.airTemp,
      });
      nodes.push(n);
      remap.set(b.id, n.id);
    });
    branches = branches.map((b) => {
      const n = remap.get(b.id);
      return n ? { ...b, fromId: b.fromId === id ? n : b.fromId, toId: b.toId === id ? n : b.toId } : b;
    });
  }

  return { nodes, branches, symbols, positions };
}
