// ─────────────────────────────────────────────────────────────────────────────
// Отчёт ВДС — исходные данные, которые заполняет пользователь рудника
// (раздел 1 «Техническое задание на проведение ВДС» и титульная часть),
// и параметры, нужные для расчётных разделов 2–4.
// Структура повторяет отчёт по результатам воздушно-депрессионной съёмки
// (образец: рудник Вишневского месторождения, филиал «Копейский ВГСО»).
// ─────────────────────────────────────────────────────────────────────────────

export interface KeyValueRow { name: string; value: string }

export interface InstrumentRow {
  name: string;
  count: string;
  parameter: string;
  accuracy: string;
}

export interface VdsGvuInput {
  /** id ветви-вентилятора в схеме */
  branchId: string;
  /** Место установки (подпись в отчёте) */
  place: string;
  /** Kв — коэффициент внешних утечек по месту установки (1.2/1.15/1.1/1.05) */
  kv: number;
  /** Сечение вентиляционного канала, м² (для скоростного напора) */
  channelArea: string;
  /** Фактические внешние утечки по замеру, м³/с (пусто — по модели) */
  extLeakFact: string;
  /** Способ проветривания */
  mode: string;
}

export interface VdsReportForm {
  // ── Титульный лист ──
  surveyOrgParent: string;   // МЧС РОССИИ / ФГУП «ВГСЧ»
  surveyOrg: string;         // Филиал «… ВГСО»
  approverTitle: string;
  approverName: string;
  approveYear: string;
  mineName: string;          // рудник …
  companyName: string;       // ООО «…»
  performerTitle: string;
  performerName: string;
  city: string;

  // ── Аннотация / цель ──
  annotation: string;
  surveyTeam: string;
  surveyPeriod: string;      // «ноябрь 2025 года»
  previousSurvey: string;    // «в феврале 2024 года …»

  // ── 1.1 Сведения о руднике ──
  companyAddress: string;
  inn: string;
  phone: string;
  email: string;
  director: string;
  location: string;
  subsoilLicense: string;

  // ── 1.2 Общие сведения ──
  opoRegistration: string;
  staffTotal: string;
  staffUnderground: string;
  staffItr: string;
  maxPerShift: string;
  activeFaces: string;
  equipment: string;         // построчно
  horizons: string;
  supportType: string;
  hazards: KeyValueRow[];    // характер опасности
  mainWorkings: KeyValueRow[]; // Таблица 1
  reserves: string;          // сведения о запасах, характеристика полезного ископаемого
  hydrogeology: string;
  drainage: string;
  openingScheme: string;     // схема вскрытия, вскрывающие выработки
  miningSystems: string;     // системы разработки
  ventilationScheme: string; // «Проветривание рудника»

  // ── Параметры для расчётных разделов ──
  surveyDate: string;
  instruments: InstrumentRow[];
  gvu: VdsGvuInput[];
  /** Требуемое количество воздуха по руднику, м³/с (пусто — сумма по забоям схемы × kн) */
  requiredAir: string;
  /** kн — коэффициент неравномерности распределения воздуха */
  kn: string;
  /** Температура поверхности при ВДС, °C */
  tSurvey: string;
  pSurvey: string;           // мм рт. ст.
  tSummer: string;
  pSummer: string;
  tWinter: string;
  pWinter: string;
  /** Минимальная температура поступающего воздуха зимой (калориферы), °C */
  tHeated: string;
  /** Температура исходящей струи, °C */
  tExhaust: string;
  /** Стоимость электроэнергии, руб/кВт·ч */
  electricityCost: string;

  // ── Выводы и рекомендации (дополнение пользователя к автоматическим) ──
  extraConclusions: string;
  recommendations: string;
}

export const DEFAULT_INSTRUMENTS: InstrumentRow[] = [
  { name: "Анемометр АПР-2, АПР-2м", count: "1", parameter: "Средняя скорость", accuracy: "±0,05 м/с" },
  { name: "Измеритель абсолютного и дифференциального давления МБГО-2", count: "1", parameter: "Депрессия", accuracy: "±0,30%" },
  { name: "Измеритель абсолютного и дифференциального давления МБГО-2", count: "1", parameter: "Атмосферное давление", accuracy: "±0,25%" },
  { name: "Термометр электронный ТГО-2МП", count: "1", parameter: "Температура воздуха", accuracy: "±0,5 °С" },
  { name: "Термометр электронный ТГО-2МП", count: "1", parameter: "Влажность воздуха", accuracy: "±0,3%" },
];

export const DEFAULT_HAZARDS: KeyValueRow[] = [
  { name: "по силикозу", value: "опасное" },
  { name: "по самовозгоранию руд (вмещающих пород)", value: "склонные к самовозгоранию" },
  { name: "по взрывам сульфидной пыли", value: "не опасное" },
  { name: "по горным ударам", value: "не склонны к горным ударам" },
  { name: "по внезапным выбросам газа", value: "не опасное" },
];

export const KV_OPTIONS: { value: number; label: string }[] = [
  { value: 1.2, label: "1,20 — на скиповых стволах" },
  { value: 1.15, label: "1,15 — на клетевых стволах и штольнях" },
  { value: 1.1, label: "1,10 — на стволах/штольнях без подъёма и откатки" },
  { value: 1.05, label: "1,05 — на вентиляционных шурфах и восстающих" },
];

export function emptyVdsForm(): VdsReportForm {
  return {
    surveyOrgParent: "МЧС РОССИИ\nФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ УНИТАРНОЕ ПРЕДПРИЯТИЕ\n«ВОЕНИЗИРОВАННАЯ ГОРНОСПАСАТЕЛЬНАЯ ЧАСТЬ»",
    surveyOrg: "",
    approverTitle: "Командир отряда",
    approverName: "",
    approveYear: String(new Date().getFullYear()),
    mineName: "",
    companyName: "",
    performerTitle: "Командир взвода СДС",
    performerName: "",
    city: "",
    annotation: "",
    surveyTeam: "",
    surveyPeriod: "",
    previousSurvey: "",
    companyAddress: "",
    inn: "",
    phone: "",
    email: "",
    director: "",
    location: "",
    subsoilLicense: "",
    opoRegistration: "",
    staffTotal: "",
    staffUnderground: "",
    staffItr: "",
    maxPerShift: "",
    activeFaces: "",
    equipment: "",
    horizons: "",
    supportType: "",
    hazards: DEFAULT_HAZARDS.map(h => ({ ...h })),
    mainWorkings: [{ name: "", value: "" }],
    reserves: "",
    hydrogeology: "",
    drainage: "",
    openingScheme: "",
    miningSystems: "",
    ventilationScheme: "",
    surveyDate: new Date().toISOString().slice(0, 10),
    instruments: DEFAULT_INSTRUMENTS.map(i => ({ ...i })),
    gvu: [],
    requiredAir: "",
    kn: "1.1",
    tSurvey: "5",
    pSurvey: "745",
    tSummer: "40",
    pSummer: "730",
    tWinter: "-40",
    pWinter: "770",
    tHeated: "2",
    tExhaust: "8",
    electricityCost: "3.6",
    extraConclusions: "",
    recommendations: "",
  };
}
