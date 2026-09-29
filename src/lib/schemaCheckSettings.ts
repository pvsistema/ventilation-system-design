// ─────────────────────────────────────────────────────────────────────────────
// Настройки проверки схемы — пороги, которые можно подстроить под свой рудник.
// Хранятся в localStorage и переживают перезагрузку страницы.
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaCheckSettings {
  /** м — узлы ближе этого расстояния без общей ветви считаются «несостыкованными» */
  nearThreshold: number;
  /** кМюрг — сопротивление ветви выше порога подозрительно */
  highRThreshold: number;
  /** кМюрг — норматив сопротивления перемычки */
  bulkRThreshold: number;
  /** м — насколько близко к оси ветви узел считается «лежащим на ней» */
  onAxisTolerance: number;
  /** м — разница отметок, при которой пересечение считается «на одном уровне» */
  crossingZTolerance: number;
  /** м² — допустимый диапазон сечения выработки */
  areaMin: number;
  areaMax: number;
  /** ×10⁻⁴ Н·с²/м⁴ — типичный диапазон коэффициента α */
  alphaMin: number;
  alphaMax: number;
  /** м — ветви короче считаются «очень короткими» */
  tinyLength: number;
  /** % — доля подачи ВМП от расхода в выработке, выше которой рециркуляция */
  recircPercent: number;
  /** % — доля утечек через перемычки от подачи ГВУ, выше которой предупреждение */
  leakPercent: number;
  /** м³/с — в список утечек попадают перемычки с утечкой от этого значения */
  leakBulkMin: number;
  /** м³/с — и до этого значения (0 — без ограничения сверху) */
  leakBulkMax: number;
  /** % — допуск «замер / модель» на замерных станциях, капитальные выработки */
  measureTolCapital: number;
  /** % — то же для остальных выработок */
  measureTolOther: number;
  /** Н·с²/м⁴ — допустимый диапазон контрольного α = R·S³/(P·L) */
  controlAlphaMin: number;
  controlAlphaMax: number;
  /** % — разница сечений соседних ветвей одной выработки */
  areaJumpPercent: number;
  /** кМюрг — максимум сопротивления изолирующей перемычки (без герметизации) */
  isolMaxR: number;
}

export const DEFAULT_SCHEMA_CHECK_SETTINGS: SchemaCheckSettings = {
  nearThreshold: 0.5,
  highRThreshold: 100,
  bulkRThreshold: 686,
  onAxisTolerance: 0.5,
  crossingZTolerance: 1,
  areaMin: 0.5,
  areaMax: 60,
  // Методика ВГСЧ: контрольный α действующих выработок 0,001…1,0 Н·с²/м⁴.
  // В наших единицах (×10⁻⁴ кгс·с²/м⁴, см. resistanceFromAlpha) это ≈ 1…1000.
  alphaMin: 1,
  alphaMax: 1000,
  tinyLength: 0.5,
  recircPercent: 70,
  leakPercent: 30,
  leakBulkMin: 5,
  leakBulkMax: 0,
  measureTolCapital: 10,
  measureTolOther: 20,
  controlAlphaMin: 0.001,
  controlAlphaMax: 1,
  areaJumpPercent: 10,
  isolMaxR: 305,
};

export interface SchemaCheckSettingField {
  key: keyof SchemaCheckSettings;
  label: string;
  unit: string;
  min: number;
  max?: number;
  step: number;
}

/** Описание полей для формы настроек, сгруппированное как в панели проверки. */
export const SCHEMA_CHECK_SETTING_GROUPS: { title: string; fields: SchemaCheckSettingField[] }[] = [
  {
    title: "Связность сети",
    fields: [
      { key: "onAxisTolerance", label: "Узел на оси ветви — допуск", unit: "м", min: 0.01, step: 0.1 },
      { key: "crossingZTolerance", label: "Пересечение без узла — сближение осей до", unit: "м", min: 0, step: 0.5 },
    ],
  },
  {
    title: "Ветви",
    fields: [
      { key: "highRThreshold", label: "Большое сопротивление ветви", unit: "кМюрг", min: 0, step: 10 },
      { key: "bulkRThreshold", label: "Норматив сопротивления перемычки", unit: "кМюрг", min: 0, step: 1 },
      { key: "isolMaxR", label: "Изолирующая перемычка — максимум (×2,25 с герметизацией)", unit: "кМюрг", min: 1, step: 5 },
    ],
  },
  {
    title: "Параметры ветвей",
    fields: [
      { key: "areaMin", label: "Сечение, минимум", unit: "м²", min: 0, step: 0.1 },
      { key: "areaMax", label: "Сечение, максимум", unit: "м²", min: 0, step: 1 },
      { key: "alphaMin", label: "Коэффициент α, минимум", unit: "×10⁻⁴", min: 0, step: 1 },
      { key: "alphaMax", label: "Коэффициент α, максимум", unit: "×10⁻⁴", min: 0, step: 10 },
      { key: "tinyLength", label: "Очень короткая ветвь — короче", unit: "м", min: 0, step: 0.1 },
      { key: "controlAlphaMin", label: "Контрольный α, минимум", unit: "Н·с²/м⁴", min: 0, step: 0.001 },
      { key: "controlAlphaMax", label: "Контрольный α, максимум", unit: "Н·с²/м⁴", min: 0, step: 0.1 },
      { key: "areaJumpPercent", label: "Соседние ветви — разница сечений более", unit: "%", min: 1, max: 100, step: 1 },
    ],
  },
  {
    title: "Узлы",
    fields: [
      { key: "nearThreshold", label: "Близкие узлы — расстояние до", unit: "м", min: 0.01, step: 0.1 },
    ],
  },
  {
    title: "Результаты расчёта",
    fields: [
      { key: "recircPercent", label: "Рециркуляция ВМП — доля выше", unit: "%", min: 1, max: 100, step: 5 },
      { key: "leakPercent", label: "Утечки через перемычки — доля выше", unit: "%", min: 1, max: 100, step: 5 },
      { key: "leakBulkMin", label: "Утечка через перемычку — от", unit: "м³/с", min: 0, step: 0.5 },
      { key: "leakBulkMax", label: "Утечка через перемычку — до (0 — без предела)", unit: "м³/с", min: 0, step: 0.5 },
      { key: "measureTolCapital", label: "Замер / модель — допуск, капитальные", unit: "%", min: 1, max: 100, step: 1 },
      { key: "measureTolOther", label: "Замер / модель — допуск, прочие", unit: "%", min: 1, max: 100, step: 1 },
    ],
  },
];

const STORAGE_KEY = "pvs.schemaCheckSettings.v1";

export function loadSchemaCheckSettings(): SchemaCheckSettings {
  const s = { ...DEFAULT_SCHEMA_CHECK_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return s;
    const parsed = JSON.parse(raw) as Partial<Record<keyof SchemaCheckSettings, unknown>>;
    (Object.keys(s) as (keyof SchemaCheckSettings)[]).forEach((k) => {
      const v = parsed[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) s[k] = v;
    });
    // Прежние значения по умолчанию заменены на методические. Если человек
    // их не менял, подставляем новые — иначе старый порог «застрял» бы навсегда.
    if (parsed.nearThreshold === 0.01) s.nearThreshold = DEFAULT_SCHEMA_CHECK_SETTINGS.nearThreshold;
    if (parsed.alphaMin === 2) s.alphaMin = DEFAULT_SCHEMA_CHECK_SETTINGS.alphaMin;
    if (parsed.alphaMax === 400) s.alphaMax = DEFAULT_SCHEMA_CHECK_SETTINGS.alphaMax;
  } catch { /* повреждённые настройки — берём по умолчанию */ }
  return s;
}

export function saveSchemaCheckSettings(s: SchemaCheckSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* квота/приватный режим */ }
}

/** Сколько порогов отличается от значений по умолчанию. */
export function countChangedSettings(s: SchemaCheckSettings): number {
  return (Object.keys(DEFAULT_SCHEMA_CHECK_SETTINGS) as (keyof SchemaCheckSettings)[])
    .filter((k) => s[k] !== DEFAULT_SCHEMA_CHECK_SETTINGS[k]).length;
}
