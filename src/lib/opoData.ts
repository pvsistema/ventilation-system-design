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
  /** Вентиляторы по типам установки: ГВУ, ВВУ, ВМП. */
  fans: OpoFanGroup[];
  /** Всего вентиляторов на схеме, шт (с учётом работающих в параллель). */
  fansTotal: number;
}

/** Тип вентиляторной установки. */
export type FanKind = "ГВУ" | "ВВУ" | "ВМП";

/** Порядок вывода — от главных установок к местным, как в документах. */
export const FAN_KIND_ORDER: FanKind[] = ["ГВУ", "ВВУ", "ВМП"];

export const FAN_KIND_LABELS: Record<FanKind, string> = {
  "ГВУ": "Главные вентиляторные установки (ГВУ)",
  "ВВУ": "Вспомогательные вентиляторные установки (ВВУ)",
  "ВМП": "Вентиляторы местного проветривания (ВМП)",
};

/** Вентиляторы одного типа установки со списком названий. */
export interface OpoFanGroup {
  kind: FanKind;
  label: string;
  /** Количество вентиляторов, шт (агрегаты в параллель посчитаны отдельно). */
  count: number;
  /** Названия установок с количеством одинаковых. */
  names: { name: string; count: number }[];
  /** Из них остановлено, шт. */
  stoppedCount: number;
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
  // Вентиляторы: по типу установки → названия → количество.
  const fanAgg = new Map<FanKind, { count: number; stopped: number; names: Map<string, number> }>();

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

    // ─── Вентиляторы ────────────────────────────────────────────────────
    // Один вентилятор = одна ветвь с hasFan. Если на установке работает
    // несколько агрегатов в параллель (fanParallel), считаем каждый: в
    // документах ОПО указывается число машин, а не число точек на схеме.
    if (b.hasFan) {
      const kind: FanKind = FAN_KIND_ORDER.includes(b.fanType as FanKind)
        ? (b.fanType as FanKind) : "ГВУ";
      const units = Math.max(1, Math.round(Number(b.fanParallel) || 1));
      let g = fanAgg.get(kind);
      if (!g) { g = { count: 0, stopped: 0, names: new Map() }; fanAgg.set(kind, g); }
      g.count += units;
      if (b.fanStopped) g.stopped += units;
      const nm = (b.fanName || "").trim() || "Без названия";
      g.names.set(nm, (g.names.get(nm) ?? 0) + units);
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

  // Группы вентиляторов в фиксированном порядке ГВУ → ВВУ → ВМП.
  const fans: OpoFanGroup[] = FAN_KIND_ORDER
    .filter((k) => fanAgg.has(k))
    .map((kind) => {
      const g = fanAgg.get(kind)!;
      return {
        kind,
        label: FAN_KIND_LABELS[kind],
        count: g.count,
        stoppedCount: g.stopped,
        names: Array.from(g.names.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru")),
      };
    });
  const fansTotal = fans.reduce((s, g) => s + g.count, 0);

  return {
    workingsLengthM,
    workingsCount,
    ventPipeLengthM,
    ventDevicesCount,
    solidBulkheadsCount,
    byType,
    fans,
    fansTotal,
  };
}

/** Форматирует длину: метры до километров, с разделением разрядов. */
export function formatLengthM(m: number): string {
  const meters = Math.round(m);
  const s = meters.toLocaleString("ru-RU");
  if (meters >= 1000) return `${s} м (${(meters / 1000).toFixed(2)} км)`;
  return `${s} м`;
}