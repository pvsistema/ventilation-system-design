// Реквизиты титульного листа «Акта проверки устойчивости» — хранятся в
// localStorage, по умолчанию пустые.

export interface ActTitleFields {
  approverTitle: string;
  approverOrg: string;
  approverName: string;
  approveYear: string;
  objectTitle: string;
  orgName: string;
  period: string;
  chairmanTitle: string;
  chairmanName: string;
  members: { title: string; name: string }[];
  checkPeriod: string;
  useLogo: boolean;
}

// По умолчанию все реквизиты пустые — пользователь заполняет их при оформлении
// акта (пустые поля в акте печатаются строками «______» для заполнения от руки).
export const DEFAULT_ACT_TITLE: ActTitleFields = {
  approverTitle: "",
  approverOrg: "",
  approverName: "",
  approveYear: "",
  objectTitle: "",
  orgName: "",
  period: "",
  chairmanTitle: "",
  chairmanName: "",
  members: [{ title: "", name: "" }, { title: "", name: "" }],
  checkPeriod: "",
  useLogo: false,
};

/** Подсказки (placeholder) — пример заполнения по образцу акта. */
export const ACT_TITLE_HINTS: Partial<Record<keyof ActTitleFields, string>> = {
  approverTitle: "Главный инженер",
  approverOrg: 'ЮПР ООО "Башкирская медь"',
  approverName: "Д.Н. Демченко",
  approveYear: "2026",
  objectTitle: "Подземного рудника Юбилейного месторождения…",
  orgName: "ООО «Башкирская медь»",
  period: 'II полугодие 2026г. с "01" июля 2026г. по 31 декабря 2026г.',
  checkPeriod: 'с "04" мая 2026 года по "29" мая 2026 года',
  chairmanTitle: 'главного инженера ЮПР ООО "Башкирская медь"',
  chairmanName: "Д.Н. Демченко",
};

const LS_KEY = "pvs_stability_act_title_v2";

export function loadActTitle(): ActTitleFields {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) return { ...DEFAULT_ACT_TITLE, ...JSON.parse(s) };
  } catch { /* ignore */ }
  return { ...DEFAULT_ACT_TITLE, members: DEFAULT_ACT_TITLE.members.map(m => ({ ...m })) };
}

/** Заполнен ли титул хотя бы частично. */
export function isActTitleFilled(f: ActTitleFields): boolean {
  return [f.approverTitle, f.approverName, f.objectTitle, f.orgName, f.period, f.chairmanName]
    .some(v => v.trim() !== "");
}

export function saveActTitle(f: ActTitleFields): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

export const ACT_LOGO_URL = "/files/bashmed-logo.png";

export async function loadLogoDataUrl(url = ACT_LOGO_URL): Promise<string | undefined> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  } catch { return undefined; }
}
