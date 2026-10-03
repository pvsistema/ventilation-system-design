// ─────────────────────────────────────────────────────────────────────────────
// Коды объектов на выработках АэроСети (<ribItem itemCode>) — общая таблица
// для записи (erpExport.ts) и чтения (erpImport.ts) формата .erp.
//
// АэроСеть различает объекты по КОДУ КАРТИНКИ: материал и конструкция
// перемычки — это разные коды, а не поле. Поэтому, если писать всем
// перемычкам один код, в АэроСети они все становятся одинаковыми.
//
// Откуда коды (проверено на проекте «Якутское_Аэ-ПВ2», созданном в АэроСети):
//   • справочник воздухопроницаемости bulkheadPermeabilityService перечисляет
//     коды глухих сооружений вместе с их A. Сверка A² с нашим справочником
//     перемычек однозначно даёт материал:
//       29/90/89/91/92   — дверь закрытая: без материала/бет./дер./кирп./мет.
//       102…106          — та же серия значений → дверь автоматическая
//       8/67/68/66/114   — глухая: без материала/бет./дер./кирп./мет.
//       40               — A = 0,09 → парус
//   • пары «код в эталоне ↔ значок в нашем проекте той же шахты»:
//       89 ↔ door_wood, 92 ↔ door_metal (ГВУ-ВМ12), 68 ↔ bk_wood,
//       99 ↔ open_wood (окно 13,6 м²), 101 ↔ open_metal (устье штольни),
//       110 ↔ lat_metal (окно ГВУ), 16 — ВМП, 18 — ГВУ.
//   Пишем ТОЛЬКО подтверждённые коды (справочник или образец).
// ─────────────────────────────────────────────────────────────────────────────

export type ErpBulkheadKind = "solid" | "door" | "auto" | "open" | "lattice" | "sail";
export type ErpMaterial = "base" | "conc" | "wood" | "brick" | "metal";

/** Вентилятор главного (и вспомогательного) проветривания. */
export const ERP_FAN_MAIN = "18";
/** Вентилятор местного проветривания (ВМП). */
export const ERP_FAN_LOCAL = "16";

const CODES: Record<ErpBulkheadKind, Record<ErpMaterial, string>> = {
  // справочник проницаемости + образец (68 — «глухая деревянная»)
  solid:   { base: "8",   conc: "67",  wood: "68",  brick: "66",  metal: "114" },
  // справочник проницаемости + образец (89 — дерев., 92 — металл.)
  door:    { base: "29",  conc: "90",  wood: "89",  brick: "91",  metal: "92" },
  // справочник проницаемости (те же A, что у закрытых дверей 29/90/89/91/92)
  auto:    { base: "102", conc: "103", wood: "104", brick: "105", metal: "106" },
  // Открытая дверь и окно: в образце есть только 99 (дерево), 101 (металл)
  // и 110 (окно). Нумерация серий в АэроСети НЕ последовательна (дверь:
  // 89 дерево, 90 бетон; глухая: 66 кирпич, 67 бетон, 68 дерево), поэтому
  // остальные коды не угадываем: несуществующий код может не дать открыть
  // файл. Бетон/кирпич/без материала пишем ближайшим проверенным кодом —
  // расчёт от этого не зависит (R окна задаётся площадью и числом).
  open:    { base: "99",  conc: "101", wood: "99",  brick: "101", metal: "101" },
  lattice: { base: "110", conc: "110", wood: "110", brick: "110", metal: "110" },
  sail:    { base: "40",  conc: "40",  wood: "40",  brick: "40",  metal: "40" },
};

const KIND_NAME: Record<ErpBulkheadKind, string> = {
  solid: "Перемычка глухая",
  door: "Дверь вентиляционная закрытая",
  auto: "Дверь вентиляционная автоматическая",
  open: "Дверь вентиляционная открытая",
  lattice: "Перемычка с вентиляционным окном",
  sail: "Парус вентиляционный",
};
const MAT_NAME: Record<ErpMaterial, string> = {
  base: "", conc: "бетонная", wood: "деревянная", brick: "кирпичная", metal: "металлическая",
};
/** Наш значок для каждого вида и материала — для обратного чтения. */
const SYMBOL_PREFIX: Record<ErpBulkheadKind, string> = {
  solid: "bk_", door: "door_", auto: "auto_", open: "open_", lattice: "lat_", sail: "sail",
};

/** Сооружение «глухого» типа: у АэроСети есть для него воздухопроницаемость. */
export function isBlindKind(k: ErpBulkheadKind): boolean {
  return k === "solid" || k === "door" || k === "auto" || k === "sail";
}

/** Конструкция с окном: в АэроСети задаётся площадью VentWindowArea. */
export function isWindowKind(k: ErpBulkheadKind): boolean {
  return k === "open" || k === "lattice";
}

/** Материал по id значка или по названию перемычки. */
function materialOf(s: string): ErpMaterial {
  const t = s.toLowerCase();
  if (/conc|бетон|blast/.test(t)) return "conc";
  if (/wood|дерев/.test(t)) return "wood";
  if (/brick|кирпич/.test(t)) return "brick";
  if (/metal|металл/.test(t)) return "metal";
  return "base";
}

/**
 * Вид сооружения по id нашего значка (bk_wood, door_metal, …). Старые и
 * дублирующие id (bulkhead_*, door_closed_*, door_auto_*, water_dam_*, win_*,
 * proem_*, регуляторы) сводятся к тем же видам.
 */
function kindOfSymbol(typeId: string): ErpBulkheadKind {
  const t = typeId.toLowerCase();
  if (t === "sail") return "sail";
  if (/^(open_)|regulator_open/.test(t)) return "open";
  if (/^(lat_|win_|proem_)|regulator|bulkhead_window/.test(t)) return "lattice";
  if (/^(auto_|door_auto)/.test(t)) return "auto";
  if (/^door|fire_door/.test(t)) return "door";
  return "solid";
}

/** Вид сооружения по названию (перемычка, заданная во вкладке ветви). */
function kindOfName(name: string): ErpBulkheadKind {
  const t = name.toLowerCase();
  if (/парус/.test(t)) return "sail";
  if (/откр/.test(t)) return "open";
  if (/решёт|решет|окн|проём|проем|регулятор|шибер/.test(t)) return "lattice";
  if (/автомат/.test(t)) return "auto";
  if (/двер/.test(t)) return "door";
  return "solid";
}

export interface ErpBulkheadCode {
  code: string;
  kind: ErpBulkheadKind;
  material: ErpMaterial;
}

/** Код АэроСети для нашего значка перемычки. */
export function erpCodeForSymbol(typeId: string): ErpBulkheadCode {
  const kind = kindOfSymbol(typeId);
  const material = materialOf(typeId);
  return { code: CODES[kind][material], kind, material };
}

/** Код АэроСети для перемычки, заданной названием (вкладка ветви). */
export function erpCodeForName(name: string): ErpBulkheadCode {
  const kind = kindOfName(name);
  const material = materialOf(name);
  return { code: CODES[kind][material], kind, material };
}

/** Обратный поиск: код → вид и материал (для импорта). */
const BY_CODE = new Map<string, { kind: ErpBulkheadKind; material: ErpMaterial }>();
// Порядок материалов важен для общих кодов: 99 → дерево, 101 и 110 → металл
// (так они стоят в образце).
const MAT_ORDER: ErpMaterial[] = ["metal", "wood", "conc", "brick", "base"];
for (const kind of Object.keys(CODES) as ErpBulkheadKind[]) {
  for (const material of MAT_ORDER) {
    const c = CODES[kind][material];
    if (!BY_CODE.has(c)) BY_CODE.set(c, { kind, material });
  }
}

/** Все коды перемычек, известные таблице. */
export const ERP_BULKHEAD_CODES: ReadonlySet<string> = new Set(BY_CODE.keys());

/** Название сооружения по коду АэроСети («Дверь вентиляционная закрытая (деревянная)»). */
export function erpBulkheadName(code: string): string {
  const e = BY_CODE.get(code);
  if (!e) return "";
  const mat = MAT_NAME[e.material];
  return mat && e.kind !== "sail" ? `${KIND_NAME[e.kind]} (${mat})` : KIND_NAME[e.kind];
}

/** Наш значок по коду АэроСети (bk_wood, door_metal, …). */
export function erpSymbolForCode(code: string): string {
  const e = BY_CODE.get(code);
  if (!e) return "";
  if (e.kind === "sail") return "sail";
  const p = SYMBOL_PREFIX[e.kind];
  if (e.kind === "solid") return e.material === "conc" ? "bk_concrete" : `${p}${e.material}`;
  return `${p}${e.material}`;
}