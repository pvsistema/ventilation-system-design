// ─────────────────────────────────────────────────────────────────────────────
// Типовая толщина перемычек по материалу — справочник рудника
// («Справочники → Перемычки → Типовая толщина»). Используется, когда у
// сооружения толщина не задана: в предложениях «Исправления с подтверждением».
// Хранится в проекте; в проектах без справочника берутся значения по умолчанию.
// ─────────────────────────────────────────────────────────────────────────────

export type BulkheadMaterial = "concrete" | "brick" | "wood" | "metal" | "blast" | "other";

/** Толщина, м, по материалу. */
export type BulkheadThicknessTable = Record<BulkheadMaterial, number>;

export const DEFAULT_BULKHEAD_THICKNESS: BulkheadThicknessTable = {
  concrete: 0.5,
  brick: 0.5,
  wood: 0.2,
  metal: 0.05,
  blast: 1.0,
  other: 0.3,
};

export const BULKHEAD_MATERIALS: { id: BulkheadMaterial; label: string; hint: string }[] = [
  { id: "concrete", label: "Бетонная", hint: "Глухие, двери, водоподпорные из бетона" },
  { id: "brick", label: "Кирпичная", hint: "Кладка из кирпича или блоков" },
  { id: "wood", label: "Деревянная", hint: "Брус, доска" },
  { id: "metal", label: "Металлическая", hint: "Листовые двери и щиты" },
  { id: "blast", label: "Взрывоустойчивая", hint: "Рассчитанные на удар взрывной волны" },
  { id: "other", label: "Прочие", hint: "Материал не указан в обозначении" },
];

/** Материал сооружения по id условного обозначения. */
export function bulkheadMaterialOf(typeId: string): BulkheadMaterial {
  if (typeId.startsWith("bk_blast")) return "blast";
  if (/(conc|concrete)$/.test(typeId)) return "concrete";
  if (/brick$/.test(typeId)) return "brick";
  if (/wood$/.test(typeId)) return "wood";
  if (/metal$/.test(typeId)) return "metal";
  return "other";
}

/** Приводит сохранённую таблицу к полной (новые материалы — по умолчанию). */
export function normalizeThicknessTable(v: unknown): BulkheadThicknessTable {
  const out = { ...DEFAULT_BULKHEAD_THICKNESS };
  if (v && typeof v === "object") {
    for (const m of BULKHEAD_MATERIALS) {
      const x = (v as Record<string, unknown>)[m.id];
      if (typeof x === "number" && Number.isFinite(x) && x > 0) out[m.id] = x;
    }
  }
  return out;
}
