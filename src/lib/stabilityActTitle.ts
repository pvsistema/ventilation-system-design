// Реквизиты титульного листа «Акта проверки устойчивости» — хранятся в
// localStorage, по умолчанию заполнены по образцу акта ЮПР ООО «Башкирская медь».

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

export const DEFAULT_ACT_TITLE: ActTitleFields = {
  approverTitle: "Главный инженер",
  approverOrg: 'ЮПР ООО "Башкирская медь"',
  approverName: "Д.Н. Демченко",
  approveYear: "2026",
  objectTitle: "Подземного рудника Юбилейного месторождения медно-цинково-колчеданных и бурожелезняковых золотосодержащих руд",
  orgName: "ООО «Башкирская медь»",
  period: 'II полугодие 2026г. с "01" июля 2026г. по 31 декабря 2026г.',
  chairmanTitle: 'главного инженера ЮПР ООО "Башкирская медь"',
  chairmanName: "Д.Н. Демченко",
  members: [
    { title: "Начальник ПВС ЮПР ООО «Башкирская медь»", name: "Р.Р. Ибатуллин" },
    { title: 'Командир взвода СДС филиала "Копейского ВГСО" ФГУП "ВГСЧ"', name: "С.Г. Ипатов" },
  ],
  checkPeriod: 'с "04" мая 2026 года по "29" мая 2026 года',
  useLogo: true,
};

const LS_KEY = "pvs_stability_act_title";

export function loadActTitle(): ActTitleFields {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) return { ...DEFAULT_ACT_TITLE, ...JSON.parse(s) };
  } catch { /* ignore */ }
  return { ...DEFAULT_ACT_TITLE, members: DEFAULT_ACT_TITLE.members.map(m => ({ ...m })) };
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
