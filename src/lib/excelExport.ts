// ─────────────────────────────────────────────────────────────────────────────
// excelExport.ts — выгрузка таблицы параметров выработок и узлов в Excel.
//
// ПРИНЦИПЫ (после ревизии столбцов):
//  • Каждый столбец берёт РЕАЛЬНОЕ поле схемы. Столбцов-заглушек, в которых
//    всегда стоял 0 (газы, замеры, «гарантированный расход» и т. п.), больше
//    нет: ноль в таблице читается как «измерено — ноль» и вводит в заблуждение.
//  • Если у конкретной выработки величины нет (нет вентилятора, замерной
//    станции, пожар не считался) — ячейка ПУСТАЯ, а не 0.
//  • Единицы — те же, что выбраны в «Параметрах → Единицы измерения», и
//    подпись столбца всегда содержит единицу: «Расход воздуха, м³/с».
//  • Сопротивление в схеме хранится в кМюрг (так же его показывает панель
//    свойств). Раньше здесь делили на 9,81·10⁻³ и подписывали «мюрг» —
//    значения выходили завышенными в ~102 раза.
//  • Депрессия ветви — результат последнего расчёта сети (H решателя, с учётом
//    перемычек). Раскладка на «выработку» и «вентсооружения» — по той же
//    формуле решателя H = R·Q·|Q| (R в кМюрг), поэтому их сумма сходится с H.
//
// Файл пишется через ExcelJS: библиотека xlsx (community) не сохраняет ни
// стили, ни закрепление строк, и шапка в Excel оставалась «голой».
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoBranch, TopoNode, Horizon } from "./topology";
import { surveyXYZ, sectionKind, SECTION_KIND_LABELS } from "./topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { BULKHEAD_SYMBOL_IDS, LEGEND_TYPES } from "./schemaSymbols";
import { getUnit, DEFAULT_UNITS_CONFIG, type UnitsConfig } from "./unitsConfig";
import { DEFAULT_VENT_NORMS, FACE_TYPE_LABEL, type VentNorms, type FaceType } from "./ventSections";

// ─── Типы ────────────────────────────────────────────────────────────────────

export type ExportAreaId = "all" | string; // "all" | horizonId
export type ExportType = "branches" | "nodes";

export type ExportPreset =
  | "all"
  | "main_vent"
  | "flows"
  | "depressions"
  | "speed_check"
  | "objects"
  | "fire"
  | "pipes"
  | "node_coords"
  | "node_air"
  | "custom";

/**
 * Единица столбца. Строки-ключи из unitsConfig (flow, pressure, …) берут
 * единицу, выбранную пользователем; остальные — фиксированная подпись.
 */
type ConfigUnit = "flow" | "pressure" | "velocity" | "resistance" | "length" | "area" | "temperature" | "power";
const CONFIG_UNITS = new Set<string>(["flow", "pressure", "velocity", "resistance", "length", "area", "temperature", "power"]);

export interface ExportColumn {
  key: string;
  /** Название без единицы — единица добавляется в columnLabel(). */
  title: string;
  group: string;
  /** Единица: ключ из unitsConfig или фиксированная подпись («°», «%», «мм»). */
  unit?: ConfigUnit | string;
  /** Минимум знаков после запятой (единица может задавать больше). */
  digits?: number;
  /** Пояснение: откуда берётся значение (показывается подсказкой в окне). */
  hint?: string;
}

// ─── Столбцы ВЫРАБОТОК ───────────────────────────────────────────────────────

export const BRANCH_COLUMNS: ExportColumn[] = [
  // Общее
  { key: "number",      title: "Номер выработки",       group: "Общее", hint: "Номер ветви на схеме" },
  { key: "name",        title: "Название выработки",    group: "Общее" },
  { key: "mineType",    title: "Тип выработки",         group: "Общее", hint: "Из справочника «Типы выработок»" },
  { key: "horizonName", title: "Горизонт",              group: "Общее" },
  { key: "layer",       title: "Группа (слой)",         group: "Общее", hint: "Поле «Слой» в свойствах ветви" },
  { key: "fromNumber",  title: "Начальный узел",        group: "Общее", hint: "Номер узла" },
  { key: "toNumber",    title: "Конечный узел",         group: "Общее", hint: "Номер узла" },
  { key: "status",      title: "Признаки",              group: "Общее", hint: "Капитальная / проектируемая / тупиковая / утечка" },
  { key: "comment",     title: "Примечание",            group: "Общее" },

  // Геометрия
  { key: "length",      title: "Длина",                 group: "Геометрия", unit: "length", digits: 1 },
  { key: "angle",       title: "Угол наклона",          group: "Геометрия", unit: "°", digits: 1, hint: "+ — подъём от начального узла к конечному" },
  { key: "shape",       title: "Форма сечения",         group: "Геометрия" },
  { key: "area",        title: "Площадь сечения",       group: "Геометрия", unit: "area", digits: 2 },
  { key: "perimeter",   title: "Периметр",              group: "Геометрия", unit: "length", digits: 2 },

  // Аэродинамика
  { key: "alphaCoef",   title: "Коэффициент α",         group: "Аэродинамика", unit: "·10⁻⁴ кг/м³", digits: 2, hint: "Только при расчёте R по α" },
  { key: "resistance",  title: "Сопротивление выработки", group: "Аэродинамика", unit: "resistance", hint: "Без перемычек и окон" },
  { key: "rBulkhead",   title: "Сопротивление вентсооружений", group: "Аэродинамика", unit: "resistance", hint: "Перемычки, двери, окна на ветви" },
  { key: "rTotal",      title: "Общее сопротивление",   group: "Аэродинамика", unit: "resistance", hint: "Выработка + вентсооружения — то, что уходит в расчёт сети" },

  // Расход и скорость
  { key: "flow",        title: "Расход воздуха",        group: "Расход и скорость", unit: "flow", digits: 2, hint: "Минус — воздух идёт от конечного узла к начальному" },
  { key: "velocity",    title: "Скорость воздуха",      group: "Расход и скорость", unit: "velocity", digits: 2 },
  { key: "vMin",        title: "Мин. допустимая скорость", group: "Расход и скорость", unit: "velocity", digits: 2, hint: "Нормы ФНиП: забои / прочие выработки" },
  { key: "vMax",        title: "Макс. допустимая скорость", group: "Расход и скорость", unit: "velocity", digits: 2, hint: "Задаётся в свойствах ветви" },
  { key: "speedCheck",  title: "Проверка скорости",     group: "Расход и скорость" },
  { key: "airTemp",     title: "Температура воздуха",   group: "Расход и скорость", unit: "temperature", digits: 1, hint: "Среднее расчётной температуры концевых узлов" },

  // Депрессия
  { key: "dP",          title: "Депрессия ветви",       group: "Депрессия", unit: "pressure", digits: 2, hint: "Результат расчёта сети, вместе с перемычками" },
  { key: "dPWork",      title: "Депрессия выработки",   group: "Депрессия", unit: "pressure", digits: 2, hint: "R выработки · Q·|Q|" },
  { key: "dPBulkhead",  title: "Депрессия вентсооружений", group: "Депрессия", unit: "pressure", digits: 2, hint: "R вентсооружений · Q·|Q|" },
  { key: "power",       title: "Энергозатраты",         group: "Депрессия", unit: "power" },

  // Оборудование на выработке
  { key: "bulkheads",   title: "Вентсооружения",        group: "Оборудование", hint: "Перемычки, двери, окна на ветви" },
  { key: "fanName",     title: "Вентилятор",            group: "Оборудование" },
  { key: "fanType",     title: "Тип вентилятора",       group: "Оборудование", hint: "ГВУ / ВВУ / ВМП" },
  { key: "fanPressure", title: "Напор вентилятора",     group: "Оборудование", unit: "pressure", digits: 1 },
  { key: "fanState",    title: "Режим вентилятора",     group: "Оборудование", hint: "Работает / реверс / остановлен" },
  { key: "measNumber",  title: "Замерная станция №",    group: "Оборудование" },
  { key: "measFlow",    title: "Расход по замеру",      group: "Оборудование", unit: "flow", digits: 2, hint: "Значение, вписанное в карточку станции" },
  { key: "measArea",    title: "Сечение по замеру",     group: "Оборудование", unit: "area", digits: 2 },
  { key: "measVelocity",title: "Скорость по замеру",    group: "Оборудование", unit: "velocity", digits: 2 },

  // Пожар
  { key: "fireLoad",    title: "Пожарная нагрузка",     group: "Пожар" },
  { key: "fireNatDep",  title: "Тепловая депрессия пожара", group: "Пожар", unit: "pressure", digits: 1, hint: "Заполняется расчётом пожара" },
  { key: "fireTemp",    title: "Температура продуктов горения", group: "Пожар", unit: "temperature", digits: 0 },
  { key: "fireCO",      title: "Концентрация CO на выходе", group: "Пожар", unit: "%", digits: 4 },

  // Трубопроводы
  { key: "vpDiameter",  title: "Вентстав: диаметр",     group: "Трубопроводы", unit: "мм", digits: 0 },
  { key: "vpLength",    title: "Вентстав: длина",       group: "Трубопроводы", unit: "length", digits: 1 },
  { key: "vpR",         title: "Вентстав: сопротивление", group: "Трубопроводы", unit: "resistance" },
  { key: "vpFlowFace",  title: "Вентстав: расход в забое", group: "Трубопроводы", unit: "flow", digits: 2 },
  { key: "wpDiameter",  title: "Водопровод: диаметр",   group: "Трубопроводы", unit: "мм", digits: 0 },
  { key: "wpLength",    title: "Водопровод: длина",     group: "Трубопроводы", unit: "length", digits: 1 },
  { key: "wpFlow",      title: "Водопровод: расход",    group: "Трубопроводы", unit: "м³/ч", digits: 2 },
  { key: "wpDeltaP",    title: "Водопровод: потери давления", group: "Трубопроводы", unit: "МПа", digits: 4 },
];

// ─── Столбцы УЗЛОВ ──────────────────────────────────────────────────────────

export const NODE_COLUMNS: ExportColumn[] = [
  { key: "number",       title: "Номер узла",            group: "Общее" },
  { key: "name",         title: "Название узла",         group: "Общее" },
  { key: "atmosphere",   title: "Связь с атмосферой",    group: "Общее" },
  { key: "x",            title: "Координата X",          group: "Координаты", unit: "length", digits: 2, hint: "Маркшейдерская (по ней считаются длины)" },
  { key: "y",            title: "Координата Y",          group: "Координаты", unit: "length", digits: 2, hint: "Маркшейдерская" },
  { key: "z",            title: "Высотная отметка Z",    group: "Координаты", unit: "length", digits: 2, hint: "Маркшейдерская" },
  { key: "pressure",     title: "Абсолютное давление",   group: "Воздух", unit: "pressure", digits: 1 },
  { key: "fanPressure",  title: "Давление от вентиляторов", group: "Воздух", unit: "pressure", digits: 1, hint: "Избыточное над атмосферой" },
  { key: "airTemp",      title: "Температура воздуха",   group: "Воздух", unit: "temperature", digits: 1, hint: "Расчётная" },
  { key: "wallTemp",     title: "Температура стенок",    group: "Воздух", unit: "temperature", digits: 1, hint: "Расчётная" },
  { key: "humidity",     title: "Относительная влажность", group: "Воздух", unit: "%", digits: 0, hint: "Пусто — берётся значение по умолчанию проекта" },
  { key: "gasConc",      title: "Концентрация газа",     group: "Газы", unit: "%", digits: 3 },
  { key: "co",           title: "Концентрация CO",       group: "Газы", unit: "%", digits: 4, hint: "Из расчёта пожара" },
  { key: "co2",          title: "Концентрация CO₂",      group: "Газы", unit: "%", digits: 3, hint: "Из расчёта пожара" },
  { key: "explosionP",   title: "Давление взрыва",       group: "Газы", unit: "кПа", digits: 2 },
  { key: "waterStaticP", title: "Водопровод: статическое давление", group: "Водопровод", unit: "МПа", digits: 3 },
  { key: "waterDynamicP",title: "Водопровод: динамическое давление", group: "Водопровод", unit: "МПа", digits: 3 },
  { key: "peopleRole",   title: "Роль узла (люди)",      group: "Люди" },
  { key: "peopleCount",  title: "Людей в смену",         group: "Люди", unit: "чел", digits: 0 },
];

// ─── Шаблоны ─────────────────────────────────────────────────────────────────

const HEAD = ["number", "name", "horizonName"];

export const BRANCH_PRESETS: Partial<Record<ExportPreset, string[]>> = {
  main_vent:   [...HEAD, "fromNumber", "toNumber", "length", "angle", "shape", "area", "perimeter", "alphaCoef",
                "resistance", "rBulkhead", "rTotal", "flow", "velocity", "dP"],
  flows:       [...HEAD, "fromNumber", "toNumber", "area", "flow", "velocity"],
  depressions: [...HEAD, "flow", "resistance", "rBulkhead", "rTotal", "dP", "dPWork", "dPBulkhead", "fanPressure"],
  speed_check: [...HEAD, "area", "flow", "velocity", "vMin", "vMax", "speedCheck"],
  objects:     [...HEAD, "flow", "bulkheads", "rBulkhead", "dPBulkhead", "fanName", "fanType", "fanPressure", "fanState",
                "measNumber", "measFlow", "measArea", "measVelocity"],
  fire:        [...HEAD, "flow", "velocity", "airTemp", "dP", "fireLoad", "fireNatDep", "fireTemp", "fireCO"],
  pipes:       [...HEAD, "length", "vpDiameter", "vpLength", "vpR", "vpFlowFace", "wpDiameter", "wpLength", "wpFlow", "wpDeltaP"],
};

export const NODE_PRESETS: Partial<Record<ExportPreset, string[]>> = {
  node_coords: ["number", "name", "atmosphere", "x", "y", "z"],
  node_air:    ["number", "name", "z", "pressure", "fanPressure", "airTemp", "wallTemp", "humidity", "gasConc", "co", "co2"],
};

/** Какие строки оставить для шаблона (у трубопроводов/оборудования — только «свои»). */
export const PRESET_ROW_FILTER: Partial<Record<ExportPreset, (b: TopoBranch, ctx: ExportContext) => boolean>> = {
  pipes:   b => !!b.hasVentPipe || !!b.hasWaterPipe,
  objects: (b, ctx) => !!b.hasFan || ctx.bulkheadR.has(b.id) || ctx.measByBranch.has(b.id),
};

// ─── Подписи и единицы ───────────────────────────────────────────────────────

/** Символ единицы столбца с учётом настроек проекта. */
export function columnUnit(col: ExportColumn, units: UnitsConfig = DEFAULT_UNITS_CONFIG): string {
  if (!col.unit) return "";
  if (CONFIG_UNITS.has(col.unit)) return getUnit(units, col.unit).symbol;
  return col.unit;
}

/** Полная подпись столбца: «Расход воздуха, м³/с». */
export function columnLabel(col: ExportColumn, units: UnitsConfig = DEFAULT_UNITS_CONFIG): string {
  const u = columnUnit(col, units);
  return u ? `${col.title}, ${u}` : col.title;
}

/** Перевод из внутренних единиц схемы в выбранные. */
function convert(col: ExportColumn, v: number, units: UnitsConfig): number {
  if (!col.unit || !CONFIG_UNITS.has(col.unit)) return v;
  const u = getUnit(units, col.unit);
  // Сопротивление в схеме — кМюрг, базовая единица справочника — Мюрг.
  return col.unit === "resistance" ? u.fromBase(v * 1000) : u.fromBase(v);
}

/** Знаков после запятой для столбца. */
function columnDigits(col: ExportColumn, units: UnitsConfig): number {
  const own = col.digits ?? 2;
  if (!col.unit || !CONFIG_UNITS.has(col.unit)) return own;
  const u = getUnit(units, col.unit);
  // Сопротивления малы по величине — берём точность единицы целиком.
  if (col.unit === "resistance") return Math.max(u.decimals, 4);
  // При смене единицы (Па → кПа) точность единицы важнее «своей».
  return Math.max(own, u.decimals);
}

// ─── Контекст выгрузки ───────────────────────────────────────────────────────

export interface ExportContext {
  nodeMap: Map<string, TopoNode>;
  horizonMap: Map<string, Horizon>;
  /** Сопротивление вентсооружений по ветвям, кМюрг. */
  bulkheadR: Map<string, number>;
  /** Названия вентсооружений по ветвям. */
  bulkheadNames: Map<string, string[]>;
  /** Замерные станции по ветвям. */
  measByBranch: Map<string, SchemaSymbol[]>;
  norms: VentNorms;
}

const LEGEND_NAME = new Map(LEGEND_TYPES.map(l => [l.id, l.name]));

/** Текст из импорта часто приходит в кавычках: «"Гор.+210"». Снимаем их. */
export function cleanText(s: string | undefined | null): string {
  const t = String(s ?? "").trim();
  const m = /^"(.*)"$/.exec(t);
  return (m ? m[1] : t).trim();
}

function buildContext(
  branches: TopoBranch[], nodes: TopoNode[], horizons: Horizon[],
  symbols: SchemaSymbol[], bulkheadR: Map<string, number> | undefined, norms: VentNorms,
): ExportContext {
  const bulkheadNames = new Map<string, string[]>();
  const measByBranch = new Map<string, SchemaSymbol[]>();
  for (const s of symbols) {
    if (!s.branchId) continue;
    if (BULKHEAD_SYMBOL_IDS.has(s.typeId)) {
      // В bkBulkheadName после импорта бывают служебные коды «seal»/«vent» —
      // их заменяем названием условного обозначения.
      const own = cleanText(s.bkBulkheadName);
      const name = (own && !/^(seal|vent)$/i.test(own) ? own : "") || LEGEND_NAME.get(s.typeId) || "Перемычка";
      const list = bulkheadNames.get(s.branchId) ?? [];
      list.push(name);
      bulkheadNames.set(s.branchId, list);
    } else if (s.typeId === "measure_station") {
      const list = measByBranch.get(s.branchId) ?? [];
      list.push(s);
      measByBranch.set(s.branchId, list);
    }
  }
  // Перемычка, заданная во вкладке ветви (без значка на схеме).
  for (const b of branches) {
    if (b.hasBulkhead && !bulkheadNames.has(b.id)) {
      const own = cleanText(b.bulkheadName);
      bulkheadNames.set(b.id, [own && !/^(seal|vent)$/i.test(own) ? own : "Перемычка"]);
    }
  }
  return {
    nodeMap: new Map(nodes.map(n => [n.id, n])),
    horizonMap: new Map(horizons.map(h => [h.id, h])),
    bulkheadR: bulkheadR ?? new Map(),
    bulkheadNames,
    measByBranch,
    norms,
  };
}

// ─── Значения ячеек ──────────────────────────────────────────────────────────

type Cell = string | number | null;

const nodeLabel = (n: TopoNode | undefined) => (n ? cleanText(n.number) || cleanText(n.name) || n.id : "");

/** R вентсооружений + перемычки вентилятора, кМюрг (как в панели свойств). */
function extraR(b: TopoBranch, ctx: ExportContext): number {
  const fanCrossing = (b.hasFan && (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
    ? (b.fanCrossingR ?? 0) / 1000 : 0;
  return (ctx.bulkheadR.get(b.id) ?? 0) + fanCrossing;
}

const isFaceType = (t?: string) => t === "stoping" || t === "development" || t === "deadend";

function branchValue(b: TopoBranch, key: string, ctx: ExportContext): Cell {
  const Q = b.flow ?? 0;
  switch (key) {
    case "number":      return b.id.replace(/^B/, "");
    case "name":        return cleanText(b.type);
    case "mineType": {
      const face = b.ventFaceType && b.ventFaceType !== "none" ? FACE_TYPE_LABEL[b.ventFaceType as FaceType] : "";
      return cleanText(b.mineTypeName) || face || "";
    }
    case "horizonName": return cleanText(ctx.horizonMap.get(b.horizonId)?.name);
    case "layer":       return cleanText(b.layer);
    case "fromNumber":  return nodeLabel(ctx.nodeMap.get(b.fromId));
    case "toNumber":    return nodeLabel(ctx.nodeMap.get(b.toId));
    case "status": {
      const f: string[] = [];
      if (b.capital) f.push("капитальная");
      if (b.designed) f.push("проектируемая");
      if (b.isDead) f.push("тупиковая");
      if (b.isLeakage) f.push("утечка");
      return f.join(", ");
    }
    case "comment":     return cleanText(b.comment);

    case "length":      return b.length;
    case "angle":       return b.angle ?? 0;
    case "shape":       return SECTION_KIND_LABELS[sectionKind(b)] ?? "";
    case "area":        return b.area;
    case "perimeter":   return b.perimeter;

    case "alphaCoef":   return b.resistanceMode === "alpha" ? b.alphaCoef : null;
    case "resistance":  return b.resistance;
    case "rBulkhead":   { const r = extraR(b, ctx); return r > 0 ? r : null; }
    case "rTotal":      return b.resistance + extraR(b, ctx);

    case "flow":        return Q;
    case "velocity":    return Math.abs(b.velocity ?? 0);
    case "vMin":        return isFaceType(b.ventFaceType) ? ctx.norms.vMinFace : ctx.norms.vMinOther;
    case "vMax":        return b.vMax;
    case "speedCheck": {
      const v = Math.abs(b.velocity ?? 0);
      if (b.isDead || Math.abs(Q) < 1e-6) return "Нет движения воздуха";
      const vMin = isFaceType(b.ventFaceType) ? ctx.norms.vMinFace : ctx.norms.vMinOther;
      if (b.vMax > 0 && v > b.vMax) return "Выше максимальной";
      if (v < vMin) return "Ниже минимальной";
      return "В норме";
    }
    case "airTemp": {
      const a = ctx.nodeMap.get(b.fromId), c = ctx.nodeMap.get(b.toId);
      if (!a || !c) return null;
      return (a.computedAirTemp + c.computedAirTemp) / 2;
    }

    // dPTotal — H решателя (полная ветвь); dP может быть перезаписан
    // локальным пересчётом только выработки, поэтому он — запасной вариант.
    case "dP":          return b.dPTotal ?? b.dP;
    case "dPWork":      return b.resistance * Math.abs(Q) * Q;
    case "dPBulkhead":  { const r = extraR(b, ctx); return r > 0 ? r * Math.abs(Q) * Q : null; }
    case "power":       return b.power || null;

    case "bulkheads":   return (ctx.bulkheadNames.get(b.id) ?? []).join("; ");
    case "fanName":     return b.hasFan ? (cleanText(b.fanName) || "Вентилятор") : "";
    case "fanType":     return b.hasFan ? b.fanType : "";
    case "fanPressure": return b.hasFan ? b.fanPressure : null;
    case "fanState":    return !b.hasFan ? "" : b.fanStopped ? "Остановлен" : b.fanReverse ? "Реверс" : "Работает";
    case "measNumber":  return (ctx.measByBranch.get(b.id) ?? []).map(s => cleanText(s.msNumber) || "б/н").join("; ");
    case "measFlow":    return ctx.measByBranch.get(b.id)?.find(s => s.msFlow != null)?.msFlow ?? null;
    case "measArea":    return ctx.measByBranch.get(b.id)?.find(s => s.msArea != null)?.msArea ?? null;
    case "measVelocity":return ctx.measByBranch.get(b.id)?.find(s => s.msVelocity != null)?.msVelocity ?? null;

    case "fireLoad": {
      const parts: string[] = [];
      if (b.fireLoadTech)        parts.push(cleanText(b.fireVehicleName) || "Техника");
      if (b.fireLoadConveyor)    parts.push(cleanText(b.fireBeltName) || "Конвейерная лента");
      if (b.fireLoadCable)       parts.push(cleanText(b.fireCableName) || "Электрокабель");
      if (b.fireLoadWoodSupport) parts.push(cleanText(b.fireWoodName) || "Деревянная крепь");
      return parts.join("; ");
    }
    case "fireNatDep":  return b.fireComputedNatDep ? b.fireComputedNatDep : null;
    case "fireTemp":    return b.fireComputedTemp ? b.fireComputedTemp : null;
    case "fireCO":      return b.fireComputedCO ? b.fireComputedCO : null;

    case "vpDiameter":  return b.hasVentPipe ? b.vpDiameter : null;
    case "vpLength":    return b.hasVentPipe ? (b.vpLengthManual ? b.vpLength : b.vpLength || b.length) : null;
    case "vpR":         return b.hasVentPipe ? b.vpComputedR : null;
    case "vpFlowFace":  return b.hasVentPipe && b.vpComputedFlowFace ? b.vpComputedFlowFace : null;
    case "wpDiameter":  return b.hasWaterPipe ? b.wpDiameter : null;
    case "wpLength":    return b.hasWaterPipe ? (b.wpLength || b.length) : null;
    case "wpFlow":      return b.hasWaterPipe ? b.wpComputedFlow : null;
    case "wpDeltaP":    return b.hasWaterPipe ? b.wpComputedDeltaP : null;
    default:            return null;
  }
}

const PEOPLE_ROLE: Record<string, string> = {
  workplace: "Рабочее место", refuge: "Камера-убежище", switchpoint: "ПВП", exit: "Выход на поверхность",
};

function nodeValue(n: TopoNode, key: string): Cell {
  const s = surveyXYZ(n);
  const hasWater = n.fireNodeType && n.fireNodeType !== "none";
  switch (key) {
    case "number":       return cleanText(n.number) || n.id;
    case "name":         return cleanText(n.name);
    case "atmosphere":   return n.atmosphereLink ? "Да" : "Нет";
    case "x":            return s.x;
    case "y":            return s.y;
    case "z":            return s.z;
    case "pressure":     return n.computedPressure;
    case "fanPressure":  return n.computedFanPressure ?? null;
    case "airTemp":      return n.computedAirTemp;
    case "wallTemp":     return n.computedWallTemp;
    case "humidity":     return n.airHumidity ?? null;
    case "gasConc":      return n.computedGasConc || null;
    case "co":           return n.computedCO || null;
    case "co2":          return n.computedCO2 || null;
    case "explosionP":   return n.computedExplosivePressure || null;
    case "waterStaticP": return hasWater || n.fireComputedStaticP ? n.fireComputedStaticP : null;
    case "waterDynamicP":return hasWater || n.fireComputedDynamicP ? n.fireComputedDynamicP : null;
    case "peopleRole":   return PEOPLE_ROLE[n.peopleNodeType ?? ""] ?? "";
    case "peopleCount":  return n.peopleCount || null;
    default:             return null;
  }
}

// ─── Отбор строк ─────────────────────────────────────────────────────────────

/** Выработки выбранного горизонта. */
export function filterBranches(branches: TopoBranch[], areaId: ExportAreaId): TopoBranch[] {
  return areaId === "all" ? branches : branches.filter(b => b.horizonId === areaId);
}

/** Узлы выбранного горизонта — концы его выработок (у узла своего горизонта нет). */
export function filterNodes(nodes: TopoNode[], branches: TopoBranch[], areaId: ExportAreaId): TopoNode[] {
  if (areaId === "all") return nodes;
  const ids = new Set<string>();
  for (const b of branches) if (b.horizonId === areaId) { ids.add(b.fromId); ids.add(b.toId); }
  return nodes.filter(n => ids.has(n.id));
}

// ─── Основная функция ────────────────────────────────────────────────────────

export interface ExportParams {
  areaId: ExportAreaId;
  type: ExportType;
  selectedKeys: string[];
  branches: TopoBranch[];
  nodes: TopoNode[];
  horizons: Horizon[];
  projectName: string;
  units?: UnitsConfig;
  norms?: VentNorms;
  symbols?: SchemaSymbol[];
  bulkheadRByBranch?: Map<string, number>;
  /** Оставить только строки, относящиеся к шаблону (трубопроводы, оборудование). */
  rowFilter?: ExportPreset;
}

/** Сколько строк попадёт в файл — для подписи в окне. */
export function countRows(p: Omit<ExportParams, "selectedKeys" | "projectName">): number {
  if (p.type === "nodes") return filterNodes(p.nodes, p.branches, p.areaId).length;
  let rows = filterBranches(p.branches, p.areaId);
  const f = p.rowFilter ? PRESET_ROW_FILTER[p.rowFilter] : undefined;
  if (f) {
    const ctx = buildContext(p.branches, p.nodes, p.horizons, p.symbols ?? [], p.bulkheadRByBranch, p.norms ?? DEFAULT_VENT_NORMS);
    rows = rows.filter(b => f(b, ctx));
  }
  return rows.length;
}

export async function exportToExcel(p: ExportParams): Promise<void> {
  const units = p.units ?? DEFAULT_UNITS_CONFIG;
  const norms = p.norms ?? DEFAULT_VENT_NORMS;
  const ctx = buildContext(p.branches, p.nodes, p.horizons, p.symbols ?? [], p.bulkheadRByBranch, norms);

  const all = p.type === "branches" ? BRANCH_COLUMNS : NODE_COLUMNS;
  const cols = all.filter(c => p.selectedKeys.includes(c.key));

  let raw: Cell[][];
  if (p.type === "branches") {
    let rows = filterBranches(p.branches, p.areaId);
    const f = p.rowFilter ? PRESET_ROW_FILTER[p.rowFilter] : undefined;
    if (f) rows = rows.filter(b => f(b, ctx));
    raw = rows.map(b => cols.map(c => branchValue(b, c.key, ctx)));
  } else {
    raw = filterNodes(p.nodes, p.branches, p.areaId).map(n => cols.map(c => nodeValue(n, c.key)));
  }

  // Перевод единиц и округление
  const digits = cols.map(c => columnDigits(c, units));
  const data = raw.map(r => r.map((v, i) => {
    if (typeof v !== "number") return v ?? null;
    if (!Number.isFinite(v)) return null;
    const k = Math.pow(10, digits[i]);
    const out = Math.round(convert(cols[i], v, units) * k) / k;
    return Object.is(out, -0) ? 0 : out;
  }));

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ПВ-Система";
  wb.created = new Date();

  const sheetName = p.type === "branches" ? "Выработки" : "Узлы";
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  const headers = cols.map(c => columnLabel(c, units));
  ws.addRow(headers);
  data.forEach(r => ws.addRow(r));

  // Ширины: по самому длинному значению, в разумных пределах
  cols.forEach((c, i) => {
    let w = Math.min(28, Math.max(10, headers[i].length * 0.55));
    for (let r = 0; r < Math.min(data.length, 2000); r++) {
      const v = data[r][i];
      if (v != null) w = Math.max(w, String(v).length + 2);
    }
    const col = ws.getColumn(i + 1);
    col.width = Math.min(w, 48);
    if (c.unit) col.numFmt = digits[i] > 0 ? `0.${"0".repeat(digits[i])}` : "0";
  });

  const head = ws.getRow(1);
  head.height = 34;
  head.eachCell(cell => {
    cell.font = { bold: true, size: 10, color: { argb: "FF173D52" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD7E7EE" } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF1E5A7A" } } };
  });
  if (cols.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  // Лист «Сведения» — чтобы таблицу можно было проверить без программы
  const info = wb.addWorksheet("Сведения");
  const hz = p.areaId === "all" ? "Вся схема" : cleanText(ctx.horizonMap.get(p.areaId)?.name) || p.areaId;
  const infoRows: [string, string][] = [
    ["Проект", p.projectName || "ПВ-Система"],
    ["Дата выгрузки", new Date().toLocaleString("ru-RU")],
    ["Таблица", sheetName],
    ["Горизонт", hz],
    ["Строк", String(data.length)],
    ["Столбцов", String(cols.length)],
    ["Единицы", "как в «Параметры → Единицы измерения» проекта; указаны в заголовке каждого столбца"],
    ["Пустая ячейка", "величины у этой строки нет (нет оборудования, расчёт не выполнялся)"],
  ];
  if (p.type === "branches") {
    infoRows.push(["Знак расхода", "минус — воздух движется от конечного узла к начальному"]);
    infoRows.push(["Депрессия ветви", "результат последнего расчёта сети (с перемычками); выработка и вентсооружения — по формуле решателя H = R·Q·|Q|, R в кМюрг"]);
    infoRows.push(["Сопротивление", "общее = выработка + вентсооружения (перемычки, двери, окна) — ровно то, что уходит в расчёт сети"]);
    infoRows.push(["Допустимые скорости", `мин.: забои ${norms.vMinFace} м/с, прочие ${norms.vMinOther} м/с; макс. — из свойств ветви`]);
  } else {
    infoRows.push(["Координаты", "маркшейдерские (по ним считаются длины выработок)"]);
  }
  infoRows.forEach(r => info.addRow(r));
  info.getColumn(1).width = 22;
  info.getColumn(2).width = 90;
  info.getColumn(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const date = new Date().toISOString().slice(0, 10);
  const safe = (p.projectName || "ПВ-Система").replace(/[\\/:*?"<>|]+/g, "_");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}_${sheetName}_${date}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
