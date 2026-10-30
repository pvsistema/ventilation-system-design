// Общие реквизиты актов: вводятся один раз и подставляются во все акты
// программы (проверка ППЗ, устойчивость, отчёт ВДС, протокол взрывоопасности).
// Хранятся на этом компьютере (localStorage). Каждый акт по-прежнему может
// иметь свои поля — общие лишь заполняют пустые и обновляются при правке.

export interface ActRequisites {
  /** Организация (предприятие) */
  orgName: string;
  /** Утверждающий от предприятия: должность, подразделение, ФИО */
  approverTitle: string;
  approverOrg: string;
  approverName: string;
  /** Период ПМЛЛПА */
  period: string;
}

const KEY = "pvs_act_requisites";
const LEGACY_WATER = "pv_water_act_meta";

export const EMPTY_REQUISITES: ActRequisites = {
  orgName: "", approverTitle: "", approverOrg: "", approverName: "", period: "",
};

export function loadRequisites(): ActRequisites {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return { ...EMPTY_REQUISITES, ...JSON.parse(s) };
    // Перенос из реквизитов акта ППЗ (раньше хранились отдельно)
    const w = localStorage.getItem(LEGACY_WATER);
    if (w) {
      const o = JSON.parse(w);
      const r = { ...EMPTY_REQUISITES };
      (Object.keys(r) as (keyof ActRequisites)[]).forEach((k) => { if (typeof o[k] === "string") r[k] = o[k]; });
      return r;
    }
  } catch { /* ignore */ }
  return { ...EMPTY_REQUISITES };
}

/** Обновить общие реквизиты (только переданные поля). */
export function saveRequisites(patch: Partial<ActRequisites>): void {
  const next = { ...loadRequisites() };
  (Object.keys(patch) as (keyof ActRequisites)[]).forEach((k) => {
    const v = patch[k];
    if (typeof v === "string") next[k] = v;
  });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

/** Пустые поля объекта заполнить из общих реквизитов. */
export function fillFromRequisites<T extends object>(obj: T, map: Partial<Record<keyof T, keyof ActRequisites>>): T {
  const r = loadRequisites();
  const out = { ...obj } as Record<string, unknown>;
  for (const [k, rk] of Object.entries(map) as [string, keyof ActRequisites][]) {
    const cur = out[k];
    if ((cur === undefined || (typeof cur === "string" && cur.trim() === "")) && r[rk]) out[k] = r[rk];
  }
  return out as T;
}
