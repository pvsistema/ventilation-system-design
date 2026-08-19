// ─────────────────────────────────────────────────────────────────────────────
// opoData.ts — «Данные ОПО»: паспортные сведения об опасном производственном
// объекте (тип объекта, класс опасности, виды опасности) и сводка по сети
// выработок, которая считается ПО СХЕМЕ.
//
// Почему часть данных не хранится, а считается: протяжённость выработок,
// длина вентрубопровода и количество вентиляционных устройств уже заданы в
// схеме. Если дублировать их отдельными полями, они разойдутся с фактом при
// первом же изменении схемы — в документах ОПО это недопустимо. Поэтому такие
// показатели считаются на лету и всегда соответствуют текущей схеме.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch } from "@/lib/topology";
import type { BulkheadType } from "@/lib/bulkheads";
import { BULKHEAD_CATALOG } from "@/lib/bulkheads";
import type { MineBulkheadExport } from "@/components/cad/EquipmentRefDialog";

/** Тип объекта: рудник или шахта. */
export type MineKind = "рудник" | "шахта";

/** Класс опасности ОПО по 116-ФЗ. */
export type OpoHazardClass = "I" | "II" | "III" | "IV";

export const OPO_CLASS_LABELS: Record<OpoHazardClass, string> = {
  I:   "I класс — чрезвычайно высокая опасность",
  II:  "II класс — высокая опасность",
  III: "III класс — средняя опасность",
  IV:  "IV класс — низкая опасность",
};

/** Виды опасности объекта. */
export type OpoHazardKind =
  | "rockburst"      // горные удары (указывается горизонт)
  | "dust"           // пыль
  | "gas"            // газ
  | "outburst"       // внезапные выбросы
  | "selfIgnition"   // самовозгорание
  | "flooding";      // затопление

export const OPO_HAZARD_LABELS: Record<OpoHazardKind, string> = {
  rockburst:    "Горным ударам",
  dust:         "Пыли",
  gas:          "Газу",
  outburst:     "Внезапным выбросам",
  selfIgnition: "Самовозгоранию",
  flooding:     "Затоплению",
};

/** Порядок вывода видов опасности — фиксированный, как в документах. */
export const OPO_HAZARD_ORDER: OpoHazardKind[] = [
  "rockburst", "dust", "gas", "outburst", "selfIgnition", "flooding",
];

/** Паспортные данные ОПО. Хранятся в файле проекта. */
export interface OpoData {
  /** Рудник или шахта. */
  kind: MineKind;
  /** Класс опасности по 116-ФЗ. */
  hazardClass: OpoHazardClass;
  /** Отмеченные виды опасности. */
  hazards: OpoHazardKind[];
  /**
   * Горизонты, опасные по горным ударам (ID из списка горизонтов проекта).
   * Учитываются только если в hazards отмечено "rockburst".
   */
  rockburstHorizonIds: string[];
}

export function makeDefaultOpoData(): OpoData {
  return {
    kind: "шахта",
    hazardClass: "III",
    hazards: [],
    rockburstHorizonIds: [],
  };
}

/**
 * Восстановление данных ОПО из файла проекта.
 * Файлы, сохранённые до появления этой вкладки, поля не содержат — тогда
 * берутся значения по умолчанию, и старый проект открывается без ошибок.
 */
export function normalizeOpoData(raw: unknown): OpoData {
  const def = makeDefaultOpoData();
  if (!raw || typeof raw !== "object") return def;
  const o = raw as Partial<OpoData>;
  return {
    kind: o.kind === "рудник" || o.kind === "шахта" ? o.kind : def.kind,
    hazardClass: (["I", "II", "III", "IV"] as const).includes(o.hazardClass as OpoHazardClass)
      ? (o.hazardClass as OpoHazardClass) : def.hazardClass,
    hazards: Array.isArray(o.hazards)
      ? o.hazards.filter((h): h is OpoHazardKind => OPO_HAZARD_ORDER.includes(h as OpoHazardKind))
      : def.hazards,
    rockburstHorizonIds: Array.isArray(o.rockburstHorizonIds)
      ? o.rockburstHorizonIds.filter((s): s is string => typeof s === "string")
      : def.rockburstHorizonIds,
  };
}

/** Сводка по сети выработок — считается по схеме. */
export interface OpoNetworkSummary {
  /** Суммарная протяжённость выработок, м (БЕЗ ниток вентрубопровода). */
  workingsLengthM: number;
  /** Количество выработок, вошедших в протяжённость. */
  workingsCount: number;
  /** Суммарная длина вентиляционного трубопровода, м. */
  ventPipeLengthM: number;
  /** Вентиляционные перемычки (двери, паруса, регуляторы, водоподпорные), шт. */
  ventDevicesCount: number;
  /** Глухие перемычки, шт. */
  solidBulkheadsCount: number;
  /** Разбивка вентиляционных устройств по видам — для расшифровки. */
  byType: { type: BulkheadType; label: string; count: number }[];
}

const TYPE_LABELS: Record<BulkheadType, string> = {
  solid: "Глухая",
  door: "Дверь вентиляционная",
  sail: "Парус",
  water: "Водоподпорная",
  regulator: "Регулятор/шибер",
  custom: "Пользовательская",
};

/**
 * Определяет вид перемычки на ветви. Сначала ищем в справочнике рудника
 * (пользовательские перемычки), затем в базовом каталоге — иначе перемычки,
 * добавленные инженером вручную, не попали бы в подсчёт.
 */
function resolveBulkheadType(
  b: TopoBranch,
  mineBulkheads: MineBulkheadExport[],
): BulkheadType | null {
  if (!b.hasBulkhead) return null;
  const id = b.bulkheadId || "";
  if (id) {
    const mine = mineBulkheads.find((m) => m.id === id);
    if (mine) return mine.type;
    const cat = BULKHEAD_CATALOG.find((c) => c.id === id);
    if (cat) return cat.type;
  }
  // Перемычка задана вручную, без выбора из справочника: по названию понять
  // вид нельзя, поэтому считаем её вентиляционной (не глухой) — так безопаснее,
  // чем занизить число глухих перемычек.
  return "custom";
}

/**
 * Считает сводку по сети выработок.
 *
 * ВАЖНО про протяжённость: нитки вентрубопровода (isVentPipeBranch) — это
 * отдельные служебные ветви схемы, а не горные выработки. Их длина в
 * протяжённость сети НЕ входит, как и требует формулировка «за исключением
 * вентрубопровода», иначе сеть оказалась бы длиннее реальной.
 */
export function computeOpoNetwork(
  branches: TopoBranch[],
  mineBulkheads: MineBulkheadExport[] = [],
): OpoNetworkSummary {
  let workingsLengthM = 0;
  let workingsCount = 0;
  let ventPipeLengthM = 0;
  let ventDevicesCount = 0;
  let solidBulkheadsCount = 0;
  const counts = new Map<BulkheadType, number>();

  for (const b of branches) {
    if (b.isVentPipeBranch) {
      // Сама нить става — это трубопровод, а не выработка.
      ventPipeLengthM += Number(b.length) || 0;
    } else {
      workingsLengthM += Number(b.length) || 0;
      workingsCount++;
      // Трубопровод, проложенный ПО выработке: длина берётся заданная вручную,
      // иначе — длина самой выработки, по которой он идёт.
      if (b.hasVentPipe) {
        ventPipeLengthM += (b.vpLengthManual ? Number(b.vpLength) : Number(b.length)) || 0;
      }
    }

    const t = resolveBulkheadType(b, mineBulkheads);
    if (t) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      if (t === "solid") solidBulkheadsCount++;
      else ventDevicesCount++;
    }
  }

  const byType = Array.from(counts.entries())
    .map(([type, count]) => ({ type, label: TYPE_LABELS[type], count }))
    .sort((a, b) => b.count - a.count);

  return {
    workingsLengthM,
    workingsCount,
    ventPipeLengthM,
    ventDevicesCount,
    solidBulkheadsCount,
    byType,
  };
}

/** Форматирует длину: метры до километров, с разделением разрядов. */
export function formatLengthM(m: number): string {
  const meters = Math.round(m);
  const s = meters.toLocaleString("ru-RU");
  if (meters >= 1000) return `${s} м (${(meters / 1000).toFixed(2)} км)`;
  return `${s} м`;
}
