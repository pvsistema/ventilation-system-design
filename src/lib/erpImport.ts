// ─────────────────────────────────────────────────────────────────────────────
// Импорт проектов АэроСеть (.erp)
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ НЕ ПУТАТЬ С ДРУГИМИ ИМПОРТАМИ. В программе их несколько, и у каждого     │
// │ свой источник данных, свои единицы и свой файл-обработчик:               │
// │   • ЭТОТ файл  — .erp, родной ПРОЕКТ АэроСети (ZIP+XML). Полная схема.   │
// │   • aerosetCsvImport.ts — ТАБЛИЧНАЯ выгрузка АэроСети в CSV. Другой      │
// │     набор полей, другие единицы сопротивления, позиции ПЛА приходят      │
// │     отдельным файлом *-positions.csv.                                    │
// │   • vent2CsvImport.ts / vent2Cdf3Import.ts — Вентиляция 2.0.             │
// │   • ventsimCsvImport.ts / ventsimVsmImport.ts — Ventsim.                 │
// │   • dxfImport.ts, excelImport.ts, combinedImport.ts — чертежи и таблицы. │
// │ Общий код между ними НЕ заводить: одинаковые на вид поля («напор»,       │
// │ «сопротивление») в разных программах хранятся в РАЗНЫХ единицах, и       │
// │ переиспользование как раз и приводит к ошибкам в 9,8 раза.               │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Формат разобран по реальному файлу. .erp — это ZIP-контейнер (сигнатура PK),
// внутри которого лежат XML-документы в кодировке UTF-16 LE с BOM:
//
//   schema.xml                     — сама схема: слои, узлы, ветви, объекты
//   docs/RibTypeService...         — справочник типов выработок (сечение, v_max)
//   docs/*.DataDocument            — прочие справочники (вентрежимы, персонал…)
//   documents.xml, [Content_Types] — служебное описание контейнера
//
// Структура schema.xml:
//   <schema>
//     <layers>
//       <layer id name color orderIndex isVisible>   ← слой = горизонт
//         <levels><layerLevel><ribs>
//           <rib id thickness fromNode toNode>       ← ветвь
//             <customFields><fields>
//               <field name="Rib.Name" value="…"/>   ← все параметры плоским
//               <field name="Airflow.…" value="…"/>     списком «имя-значение»
//             </fields></customFields>
//             <ribItems><ribItem itemCode="8|16"/>   ← перемычка / вентилятор
//           </ribs></layerLevel></levels>
//       </layer>
//     </layers>
//     <ribEndNodes>
//       <ribEndNode id x y name number>              ← узел (x,y — план)
//         <field name="RibEndNode.Depth" …/>         ← отметка, м (абсолютная)
//     </ribEndNodes>
//     <settings><setting key="ProjectionType" …/>    ← параметры проекции
//     <options>
//       <option name="GeolocationScale">0.3528…</option>   ← единиц на метр
//       <option name="OYAngle">2.478…</option>             ← параметры
//       <option name="OYDistortion">1</option>                косоугольной
//       <option name="OZDistortion">5</option>                проекции
//   </schema>
//
// ВАЖНО про координаты — главная тонкость формата. x/y в файле НЕ являются
// планом: это готовая КАРТИНКА в косоугольной проекции, где высота уже
// «вмешана» в экранный Y. Прямое использование x/y даёт схему, растянутую по
// вертикали в разы (OZDistortion=5 — пятикратно), с неверными длинами и углами.
//
// АэроСеть рисует так (X,Y,Z — метры, ex/ey — единицы файла, s = 1/scale):
//   ex = s·( X + cos(OYAngle)·OYDistortion·Y )
//   ey = s·( −sin(OYAngle)·OYDistortion·Y − OZDistortion·Z )
// Обращаем и получаем настоящие метры:
//   Y = −( ey/s + OZDistortion·Z ) / ( sin(OYAngle)·OYDistortion )
//   X =    ex/s − cos(OYAngle)·OYDistortion·Y
// Проверено на реальном проекте («Якутское») сверкой с CSV-выгрузкой той же
// модели: расхождение по 246 общим узлам — 0,0 м (медиана), максимум 1,6 м.
//
// Высотная отметка: поле RibEndNode.Depth — это АБСОЛЮТНАЯ отметка в метрах
// (в образце 1090…1207 при глубинах ствола ~100 м), а не глубина вниз от
// поверхности. Берём её как z без смены знака.
//
// ЕДИНИЦЫ ДАВЛЕНИЯ — вторая тонкость формата. АэроСеть хранит напор
// вентилятора в РУДНИЧНЫХ единицах (кгс/м² = мм вод. ст.), а не в паскалях,
// хотя в самом файле это нигде не подписано. Признаки, по которым определено:
//   • AirControl.VentilatorMaxPressure = 10.1972 — это ровно 100 Па / 9,80665;
//   • сопротивления ветвей лежат как 0,010197 = 0,1/9,80665;
//   • паспорта вентиляторов (VentilatorTemplateService) — тоже в кгс/м²:
//     рабочая точка FanPressure лежит ровно на паспортной кривой (ВО-30/18АРС:
//     196,35 и там, и там), а КПД Q·p·g/N получается 0,68…0,9 только при p
//     в кгс/м² (в паскалях вышло бы 0,05…0,09).
// Поэтому напор переводим в паскали умножением на 9,80665 — без этого он
// занижался ровно в 9,8 раза.
//
// А вот СОПРОТИВЛЕНИЕ пересчитывать НЕ надо: наше поле R тоже хранится в
// кМюрг (кгс·с²/м⁸) и умножается на 9,81 уже внутри расчёта (см.
// depression() в aerodynamics.ts). Единицы совпадают — переносим как есть.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from "jszip";
import { makeNode, makeBranch, FAN_INSTALL_FREE, type TopoNode, type TopoBranch, type Horizon } from "@/lib/topology";
import { ERP_BULKHEAD_CODES, ERP_FAN_LOCAL, erpBulkheadName, erpSymbolForCode } from "@/lib/erpItemCodes";

/**
 * Значок по коду АэроСети. Коды, которых нет в таблице (в «Руссоли» —
 * 93, 94, 95, 97, 100), но с площадью вентиляционного окна — это
 * сооружения с окном: ставим «дверь с регулируемым окном», а не глухую.
 */
function erpSymbolForCodeOrWindow(code: string, windowArea: number): string {
  return erpSymbolForCode(code) || (windowArea > 0 ? "win_base" : "");
}
import { msSortHistory, type MsMeasure } from "@/lib/msHistory";

/** Замерная станция на выработке (<ribItem itemCode="20">). */
const ERP_ITEM_MEASURE_STATION = "20";
import { buildUserFanCurve } from "@/lib/userFanFit";
import { USER_FAN_PREFIX, FAN_CATALOG, fanHAngle, type FanCurve } from "@/lib/fanCurves";
import { ERP_PVS_PROJECT_ENTRY, hashText } from "@/lib/erpExport";
import {
  erpNodeWater, erpBranchWater, parsePipeTemplates, parsePumpTemplates,
  pumpHeadFromName, pumpParallelFromName, ERP_ITEM_PUMP, type ErpPumpOnBranch,
} from "@/lib/erpWater";

/**
 * Поиск вентилятора в НАШЕМ заводском каталоге по названию из АэроСети.
 * Нужен, когда в файле вентилятор «по характеристике», но самой кривой в
 * справочнике файла нет — тогда берём кривую из каталога, а не постоянный напор.
 * Латиница-двойник (A, B, M, …) приводится к кириллице, пробелы/дефисы/точки
 * убираются. При нескольких совпадениях берётся самое длинное название
 * (чтобы «ВОД-21М» не подменялся «ВОД-21»). Слишком короткие названия
 * (≤ 3 символов) не сопоставляются — иначе «ВМ» совпадёт с чем угодно.
 */
function findCatalogFanByName(...names: (string | undefined | null)[]): FanCurve | undefined {
  const LAT2CYR: Record<string, string> = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };
  const norm = (s: string) => s.toLowerCase().replace(/[abcehkmoptxy]/g, ch => LAT2CYR[ch] ?? ch).replace(/[\s\-_./,№#()«»"']/g, "");
  for (const raw of names) {
    if (!raw) continue;
    const q = norm(raw);
    if (q.length < 4) continue;
    const exact = FAN_CATALOG.find(f => norm(f.name) === q);
    if (exact) return exact;
    let best: FanCurve | undefined;
    let bestLen = 0;
    for (const f of FAN_CATALOG) {
      const fn = norm(f.name);
      if (fn.length >= 4 && q.includes(fn) && fn.length > bestLen) { best = f; bestLen = fn.length; }
    }
    if (best) return best;
  }
  return undefined;
}

/**
 * Единицы сопротивления выработок в файле .erp.
 *
 * Штатно АэроСеть пишет R в кМюрг (кгс·с²/м⁸) — те же единицы, что и у нас,
 * поэтому переносить можно как есть. Но пользователь может переключить
 * программу в СИ (Н·с²/м⁸), и тогда те же числа больше в 9,81 раза — без
 * пересчёта сопротивления всей схемы окажутся завышены.
 *
 * В самом файле единица НЕ подписана, поэтому «auto» определяет её по
 * величине значений (см. detectErpResistanceUnit), а пользователь может
 * задать вручную, если автоопределение ошиблось.
 */
export type ErpResistanceUnit = "auto" | "kmu" | "si";

/**
 * Позиция ПЛА, вычитанная из .erp.
 *
 * Намеренно СВОЙ тип, а не RawPosition из CSV-импорта: у CSV-выгрузки нет
 * ни привязки выноски к выработке, ни диаметра маркера, а поля называются
 * иначе. Общего кода у двух импортов нет — см. предупреждение о смешении
 * источников в шапке файла.
 */
export interface ErpPosition {
  /** Исходный GUID позиции в АэроСети — им же связаны выработки позиции. */
  id: string;
  number: number;
  name: string;
  /** Вид аварии в наших терминах («Пожар», «Взрыв», …). */
  accidentType: string;
  /** Реверсивная / безреверсивная позиция. */
  positionType: "normal" | "reverse";
  x: number;
  y: number;
  z: number;
  /** Цвет фона маркера, HEX. */
  color: string;
  /** Цвет границы маркера, HEX. */
  borderColor: string;
  /** Диаметр маркера, мм. */
  diameter: number;
  /** Шрифт подписи («GOST type A»). */
  font: string;
  /** Наши id выработок, на которые распространяется позиция. */
  branchIds: string[];
  /** Выноска: наш id выработки, к которой она привязана (или пусто). */
  leaderBranchId: string;
  /** Положение выноски вдоль выработки, 0…1. */
  leaderT: number;
  comment: string;
}

/** Перемычка/дверь/окно на выработке — отдельный объект АэроСети. */
export interface ErpBulkhead {
  /** Наш id выработки. */
  branchId: string;
  name: string;
  /** Код картинки АэроСети (вид и материал). */
  code: string;
  /**
   * Наш значок по коду АэроСети (bk_brick, door_wood, …). Пусто — код не
   * знаком таблице, значок подбирается по названию.
   */
  symbolId: string;
  /** Подпись объекта в АэроСети (обычно номер сооружения: «285», «124/1»). */
  number: string;
  /** Площадь вентиляционного окна, м² (0 — окна нет). */
  windowArea: number;
  /** Сопротивление, кМюрг. */
  r: number;
  /** Положение вдоль выработки, 0…1 (от начального узла нашей ветви). */
  t: number;
  surveyQ: number;
}

/**
 * Замерная станция АэроСети (объект выработки itemCode="20") вместе с
 * ПОСЛЕДНИМ замером из журнала docs/Measurements.DataDocument.
 */
export interface ErpMeasureStation {
  /** Наш id выработки. */
  branchId: string;
  /** Номер станции (VentJournal.StationNumber), как в АэроСети: «4», «38*». */
  number: string;
  /** Место установки (VentJournal.StationLocation). */
  location: string;
  /** Положение вдоль выработки, 0…1 (от начального узла нашей ветви). */
  t: number;
  /** Последний замер: скорость, м/с; сечение, м²; расход = v·S, м³/с. */
  velocity?: number;
  area?: number;
  flow?: number;
  /** Дата последнего замера, ДД.ММ.ГГГГ. */
  date?: string;
  /** Всего замеров этой станции в журнале. */
  measureCount: number;
  /** Все замеры станции по возрастанию даты. */
  history: MsMeasure[];
}

export interface ErpImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  positions: ErpPosition[];
  /**
   * ВСЕ перемычки по выработкам — каждая отдельным объектом. Раньше на ветвь
   * переносилась только первая, а на ветви с вентилятором — ни одной.
   */
  bulkheadItems: ErpBulkhead[];
  /** Насосы водопровода по выработкам — из них ставятся значки «Насос». */
  pumpItems: ErpPumpOnBranch[];
  /** Замерные станции с последним замером — из них ставятся значки ЗС. */
  measureStations: ErpMeasureStation[];
  /**
   * Вентиляторы из справочника АэроСети (VentilatorTemplateService), на
   * которые ссылаются выработки в режиме «по характеристике». Заводятся в
   * справочник вентиляторов рудника как пользовательские.
   */
  fanCurves: FanCurve[];
  /** Название режима проветривания, из которого взяты параметры объектов. */
  ventModeName: string;
  /** Единицы R, в которых прочитан файл (после автоопределения или выбора). */
  resistanceUnit: "kmu" | "si";
  /**
   * Полная копия проекта ПВ-Системы, вложенная нашим экспортом. Есть только
   * у файлов, выгруженных ПВ-Системой и НЕ пересохранённых в АэроСети
   * (иначе схема в файле уже другая, и копия устарела).
   */
  pvsProject?: Record<string, unknown>;
  warnings: string[];
  stats: { nodes: number; branches: number; fans: number; bulkheads: number; horizons: number; positions: number; waterPipes: number; hydrants: number; measureStations: number };
  debug: string;
}

/**
 * Перевод давления из рудничных единиц АэроСети (кгс/м² = мм вод. ст.) в
 * паскали. Ровно этот множитель и «терялся»: напор вентилятора приходил
 * заниженным в 9,8 раза.
 */
const PA_PER_KGS_M2 = 9.80665;

/**
 * Код узла-маркера «Позиция ПЛА» в схеме АэроСети (<nodes><node itemCode>).
 * Позиции лежат ОТДЕЛЬНО от узлов сети (<ribEndNode>) — это самостоятельные
 * объекты плана ликвидации аварий, а не точки схемы проветривания.
 */
const NODE_PLAN_POSITION = "1001";

// Коды объектов на ветви (<ribItem itemCode>). Одного кода мало: АэроСеть
// нумерует объекты по КАРТИНКЕ (глухая перемычка, ляда, вентдверь, кроссинг —
// разные коды), и в разных проектах набор отличается. Поэтому опознаём по
// сопутствующим полям, а списки ниже — лишь быстрый путь для известных кодов.
// Собрано по реальным проектам: 8, 15, 92, 99, 101, 110 — перемычки/двери,
// 68, 89 — изолирующие перемычки (Seal*), 16, 18 — вентиляторы (ВМП и ГВУ).
const ITEM_BULKHEAD = new Set(["8", "15", "68", "89", "92", "99", "101", "110", ...ERP_BULKHEAD_CODES]);
const ITEM_FAN = new Set(["16", "18"]);

// Признаки в полях самого объекта — надёжнее кода, работают на любом проекте.
const FAN_FIELDS = ["Airflow.FanPressure", "Airflow.IdealVentilatorPressure", "Airflow.VentilatorType"];
const BULKHEAD_FIELDS = [
  "Airflow.BulkheadUserDefinedResistance", "Airflow.BulkheadCalculatedResistance",
  "Airflow.VentWindowArea", "SealType", "SealQ",
];

/** Число из атрибута XML. Поддерживает экспоненту («3.94E-05») и запятую. */
/** Сравнение имени тега без учёта регистра (движки разбора XML различаются). */
function isTag(el: Element, name: string): boolean {
  return el.tagName.toLowerCase() === name.toLowerCase();
}

function num(v: string | null | undefined, def = 0): number {
  if (v == null || v === "") return def;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : def;
}

/** Булево значение АэроСети: "True" / "False" (регистр может отличаться). */
function bool(v: string | null | undefined): boolean {
  return String(v ?? "").trim().toLowerCase() === "true";
}

/**
 * Декодирует XML-документ из контейнера. АэроСеть пишет UTF-16 LE с BOM, но
 * служебные файлы бывают в UTF-8 — определяем по BOM, иначе пробуем UTF-16 и
 * проверяем результат на «мусорность» (признак неверной кодировки).
 */
function decodeXml(buf: Uint8Array): string {
  const hasUtf16LE = buf.length > 1 && buf[0] === 0xff && buf[1] === 0xfe;
  const hasUtf16BE = buf.length > 1 && buf[0] === 0xfe && buf[1] === 0xff;
  if (hasUtf16LE) return new TextDecoder("utf-16le").decode(buf);
  if (hasUtf16BE) return new TextDecoder("utf-16be").decode(buf);
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (utf8.includes("<")) return utf8.replace(/^\uFEFF/, "");
  return new TextDecoder("utf-16le").decode(buf);
}

/**
 * Поля ТОЛЬКО самого элемента: <el><customFields><fields><field/>…
 *
 * ВАЖНО для выработок. readFields() собирает все <field> на любой глубине,
 * а внутри <rib> лежат ещё объекты (<ribItems>) и точки излома (<innerNodes>)
 * со своими полями. Раньше они перетирали поля выработки: у перемычки
 * «Airflow.AirResistanceCalculationType=2» выдавался за способ задания R
 * самой выработки (17 случаев в проекте ЮПР).
 */
function ownFields(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const cf = Array.from(el.children).find(c => isTag(c, "customFields"));
  const fs = cf ? Array.from(cf.children).find(c => isTag(c, "fields")) : undefined;
  if (!fs) return out;
  for (const f of Array.from(fs.children)) {
    const n = f.getAttribute("name");
    if (n) out[n] = f.getAttribute("value") ?? "";
  }
  return out;
}

/** Собирает <field name=… value=…> элемента в обычный словарь. */
function readFields(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  el.querySelectorAll("field").forEach(f => {
    const n = f.getAttribute("name");
    if (n) out[n] = f.getAttribute("value") ?? "";
  });
  return out;
}

/**
 * Поля объекта на выработке: собственные + параметры ВЫБРАННОГО режима
 * проветривания (<ventModesData><ventModeData id=режим>).
 *
 * В АэроСети тип вентилятора, характеристика, способ задания R перемычки и
 * площадь окна лежат в ventModeData — по одному набору на КАЖДЫЙ режим
 * проветривания. Сплошной обход всех <field> давал значения ПОСЛЕДНЕГО
 * режима (в эталоне их 104), а не основного.
 */
function readItemFields(el: Element, modeId?: string, ownOnly = false): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (scope: Element | null | undefined) => {
    if (!scope) return;
    const fields = Array.from(scope.children).find(c => isTag(c, "fields"));
    // Прямые дочерние <field> — через children, без селектора «:scope»
    // (поддерживается не всеми движками разбора XML).
    if (fields) for (const f of Array.from(fields.children)) {
      if (!isTag(f, "field")) continue;
      const n = f.getAttribute("name");
      if (n) out[n] = f.getAttribute("value") ?? "";
    }
  };
  put(Array.from(el.children).find(c => isTag(c, "customFields")));
  if (ownOnly) return out;
  const modes = Array.from(el.children).find(c => isTag(c, "ventModesData"));
  const all = modes ? Array.from(modes.children).filter(c => isTag(c, "ventModeData")) : [];
  // Параметры ВЫБРАННОГО режима проветривания (ErpVentModes, isSelected);
  // если у объекта его нет — первый, как раньше.
  const chosen = (modeId ? all.find(m => m.getAttribute("id") === modeId) : undefined) ?? all[0];
  if (chosen) put(Array.from(chosen.children).find(c => isTag(c, "customFields")));
  return out;
}

/**
 * КОЭФФИЦИЕНТ α В АэроСети — в СИ (кг/м³, Н·с²/м⁴), а у нас — в рудничных
 * единицах (кгс·с²/м⁴ ×10⁻⁴): resistanceFromAlpha() даёт R сразу в кМюрг.
 * Поэтому α из файла делим на g. Проверено на проекте ЮПР: сопротивление,
 * посчитанное по записанным в файле давлениям узлов (ΔP/Q²), совпало с
 * R = α/g·P·L/S³ у 442 выработок из 444. Без деления R выходило в 9,8 раза
 * больше.
 */
const G = 9.80665;

/**
 * Параметры, которые АэроСеть подставляет выработке без типа и сечения
 * (72 таких в проекте ЮПР). Подобраны по файлу: ΔP/(Q²·L) у всех этих
 * выработок одинаково 5,06·10⁻⁶ = 0,004426/g · 11,21 / 10³.
 */
const ERP_DEFAULT_AREA = 10;

/**
 * Сопротивление перемычки (вентсооружения) в единицах файла.
 *
 * Сверено с давлениями узлов файла «УГОК» (R = ΔP/Q², 81 выработка с
 * перемычками — совпадение у всех):
 *   • способ «задано» (AirResistanceCalculationType = 2 в данных режима) —
 *     BulkheadUserDefinedResistance;
 *   • иначе — BulkheadCalculatedResistance САМОГО объекта (итог расчёта
 *     АэроСети по окну). В данных режима это поле бывает устаревшим: у
 *     выработки 68 там 16,67 вместо 0,0172 — в 970 раз больше.
 * Раньше бралось «UserDefined || Calculated» из данных режима: перемычки с
 * окном получали чужое R, а нулевое заданное R подменялось расчётным.
 */
function erpItemR(it: { f: Record<string, string>; own: Record<string, string> }): number {
  if (String(it.f["Airflow.AirResistanceCalculationType"] ?? "").trim() === "2") {
    return num(it.f["Airflow.BulkheadUserDefinedResistance"], 0);
  }
  const own = it.own["Airflow.BulkheadCalculatedResistance"];
  return own != null && own !== "" ? num(own, 0) : num(it.f["Airflow.BulkheadCalculatedResistance"], 0);
}

/**
 * Напор вентилятора по направлению ВЫРАБОТКИ (from → to), кгс/м².
 *
 * FanPressure в полях САМОГО объекта — рабочая точка последнего расчёта
 * АэроСети, и знак в ней уже учитывает направление (isReversed повторно не
 * применяется): на «УГОК» у всех 45 вентиляторов этот напор совпал с
 * ΔP по давлениям узлов. FanPressure в данных режима — устаревший след
 * прошлых расчётов: у ГВУ на выработке 40 там 508,6 кгс/м² (≈ 4988 Па) при
 * фактическом нуле, у ВМП 2244 — 2,05 вместо 2,18.
 * Если собственного напора нет — берём настройку режима с учётом isReversed.
 */
function erpFanHeadKgs(it: { f: Record<string, string>; own: Record<string, string>; reversed: boolean }): number {
  const own = it.own["Airflow.FanPressure"];
  if (own != null && own !== "") return num(own, 0);
  const h = num(it.f["Airflow.FanPressure"], 0) || num(it.f["Airflow.IdealVentilatorPressure"], 0);
  return it.reversed ? -h : h;
}

/**
 * Сопротивление калорифера (объект «Калорифер», поля Heater.*), единицы файла.
 * Способ 2 — задано пользователем (Heater.UserDefinedR). На «УГОК» у
 * калориферных каналов 1958/1960 это 0,007 и 0,005 — в сотни раз больше R
 * самой выработки; без него расход через калориферы был завышен.
 */
function erpHeaterR(it: { f: Record<string, string> }): number {
  if (String(it.f["Heater.RCalculationType"] ?? "").trim() !== "2") return 0;
  return num(it.f["Heater.UserDefinedR"], 0);
}

/**
 * Единицы сопротивления по давлениям узлов из самого файла.
 *
 * АэроСеть сохраняет давления узлов (ModelAirPressure) последнего расчёта.
 * Для выработки без объектов R = ΔP/Q², а по геометрии R = α·P·L/S³ (α в
 * СИ). Если проект в рудничных единицах (кгс), ΔP/Q² меньше геометрического
 * ровно в g раз; в СИ — совпадает. Это прямая проверка, она не зависит от
 * вентиляторов и перемычек (их неверное чтение сбивало проверку по невязке:
 * на «УГОК» она выбрала СИ, и все заданные R ушли в 9,8 раза меньше).
 */
export function detectErpUnitByPressures(
  samples: { dp: number; q: number; rGeomSi: number }[],
): "kmu" | "si" | null {
  const ratios: number[] = [];
  for (const s of samples) {
    if (Math.abs(s.q) < 1 || !(s.rGeomSi > 0) || Math.abs(s.dp) < 1e-6) continue;
    const r = s.dp / (s.q * Math.abs(s.q));
    if (r > 0) ratios.push(r / s.rGeomSi);
  }
  if (ratios.length < 10) return null;
  ratios.sort((a, b) => a - b);
  const m = ratios[Math.floor(ratios.length / 2)];
  if (Math.abs(m * G - 1) < 0.1) return "kmu";
  if (Math.abs(m - 1) < 0.1) return "si";
  return null;
}
const ERP_DEFAULT_PERIMETER = 11.21;
const ERP_DEFAULT_ALPHA_SI = 0.004426;

/**
 * Определение единиц сопротивления в .erp по самим данным.
 *
 * Сравниваем записанное R с сопротивлением, посчитанным по ГЕОМЕТРИИ той же
 * выработки (R = α·P·L/S³ — формула в тех же рудничных единицах, что и α в
 * файле). Если в файле СИ, отношение будет около 9,81; если кМюрг — около 1.
 * Порог 3,13 = √9,81 — геометрическая середина между этими случаями.
 *
 * Такой способ надёжнее сравнения абсолютных величин: сопротивления реальных
 * выработок отличаются в тысячи раз (0,0007…10 в одном и том же проекте),
 * поэтому пороги «больше/меньше числа» на них не работают.
 *
 * Если сверить не с чем (нет α, сечения или длины) — считаем кМюрг: это
 * штатная настройка АэроСети.
 */
export function detectErpResistanceUnit(
  samples: { r: number; alpha: number; area: number; perimeter: number; length: number }[],
): "kmu" | "si" {
  const ratios: number[] = [];
  for (const s of samples) {
    if (s.r <= 0 || s.alpha <= 0 || s.area <= 0.5 || s.perimeter <= 0 || s.length <= 0) continue;
    // α в файле — в СИ, поэтому делим на g, чтобы геометрическое R было в кМюрг.
    const geom = (s.alpha / G * s.perimeter * s.length) / Math.pow(s.area, 3);
    if (geom > 0) ratios.push(s.r / geom);
  }
  if (ratios.length < 3) return "kmu";
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  return median > Math.sqrt(9.81) ? "si" : "kmu";
}

/** Выработка для проверки единиц по закону депрессий. */
export interface ErpBalanceBranch {
  from: string;
  to: string;
  /** Расход из файла (последний расчёт АэроСети), м³/с. */
  q: number;
  /** Сопротивление, вычисленное по α и геометрии, кМюрг (от единиц R не зависит). */
  rGeom: number;
  /** Сопротивление, записанное числом (выработка + перемычки), в единицах файла. */
  rFile: number;
  /** Напор вентиляторов по направлению выработки, кгс/м². */
  h: number;
}

/**
 * Среднеквадратичная невязка второго закона сети, кгс/м².
 *
 * Для каждой выработки p_from − p_to = R·Q·|Q| − H. Давления узлов подбираются
 * методом наименьших квадратов (атмосферные узлы закреплены на нуле), и
 * остаток показывает, насколько сопротивления согласованы с расходами и
 * напорами из того же файла. Система — лапласиан графа, решаем сопряжёнными
 * градиентами: на схемах в тысячи выработок это доли секунды.
 */
function balanceResidual(
  list: ErpBalanceBranch[], atm: Set<string>, rFileFactor: number,
): number {
  const idx = new Map<string, number>();
  const id = (k: string) => {
    if (atm.has(k)) return -1;
    let i = idx.get(k);
    if (i == null) { i = idx.size; idx.set(k, i); }
    return i;
  };
  const edges = list.map(b => ({
    a: id(b.from), c: id(b.to),
    d: (b.rGeom + b.rFile * rFileFactor) * b.q * Math.abs(b.q) - b.h,
  }));
  const n = idx.size;
  const p = new Float64Array(n);
  if (n > 0) {
    const mul = (x: Float64Array, out: Float64Array) => {
      out.fill(0);
      for (const e of edges) {
        const xa = e.a >= 0 ? x[e.a] : 0, xc = e.c >= 0 ? x[e.c] : 0;
        const t = xa - xc;
        if (e.a >= 0) out[e.a] += t;
        if (e.c >= 0) out[e.c] -= t;
      }
      for (let i = 0; i < n; i++) out[i] += 1e-9 * x[i];
    };
    const rhs = new Float64Array(n);
    for (const e of edges) {
      if (e.a >= 0) rhs[e.a] += e.d;
      if (e.c >= 0) rhs[e.c] -= e.d;
    }
    const r = rhs.slice(), dir = rhs.slice(), ad = new Float64Array(n);
    let rr = r.reduce((s, v) => s + v * v, 0);
    const stop = rr * 1e-20;
    for (let it = 0; it < 4 * n + 50 && rr > stop; it++) {
      mul(dir, ad);
      const dAd = dir.reduce((s, v, i) => s + v * ad[i], 0);
      if (!(dAd > 0)) break;
      const alpha = rr / dAd;
      for (let i = 0; i < n; i++) { p[i] += alpha * dir[i]; r[i] -= alpha * ad[i]; }
      const rr2 = r.reduce((s, v) => s + v * v, 0);
      const beta = rr2 / rr;
      rr = rr2;
      for (let i = 0; i < n; i++) dir[i] = r[i] + beta * dir[i];
    }
  }
  let sum = 0;
  for (const e of edges) {
    const pa = e.a >= 0 ? p[e.a] : 0, pc = e.c >= 0 ? p[e.c] : 0;
    const res = pa - pc - e.d;
    sum += res * res;
  }
  return Math.sqrt(sum / Math.max(1, edges.length));
}

/**
 * Единицы сопротивления по согласованности сети (второй закон).
 *
 * Сравнение заданного R с геометрическим (detectErpResistanceUnit) ошибается,
 * когда заданные R по природе не равны геометрическим — вентрубопроводы,
 * местные сопротивления. На «Якутском» 59 нитей става сбивали медиану, и
 * файл в СИ читался как кМюрг: все R выходили в 9,8 раза больше.
 *
 * Здесь проверяем другое: при каких единицах потери давления в сети
 * сходятся с напором вентиляторов и расходами из того же файла. На
 * «Якутском»: СИ — невязка 0,96 кгс/м², кМюрг — 47,9 кгс/м².
 * Возвращает null, если расходов в файле нет или разница неубедительна —
 * тогда работает прежний способ.
 */
export function detectErpUnitByBalance(
  list: ErpBalanceBranch[], atm: Set<string>,
): { unit: "kmu" | "si" | null; kmu: number; si: number } | null {
  const withQ = list.filter(b => Math.abs(b.q) > 1e-6);
  const withR = list.filter(b => b.rFile > 0 && Math.abs(b.q) > 1e-3);
  if (atm.size === 0 || withQ.length < 10 || withR.length < 3) return null;
  if (!list.some(b => b.h !== 0)) return null;
  const kmu = balanceResidual(list, atm, 1);
  const si = balanceResidual(list, atm, 1 / G);
  if (!isFinite(kmu) || !isFinite(si)) return null;
  // Порог 0,75: в выгрузках, где почти все R заданы через α, невязки при
  // обоих вариантах малы (Джусинский: 0,99 против 1,73), но различимы.
  if (si < kmu * 0.75) return { unit: "si", kmu, si };
  if (kmu < si * 0.75) return { unit: "kmu", kmu, si };
  return { unit: null, kmu, si };
}

/**
 * Вид аварии позиции ПЛА (Position.AccidentType) → наше название.
 *
 * Значения подобраны по образцам: у позиций с кодом 1 в описании стоят
 * пожары («Пожар ГВУ на устье ствола»), код 2 — затопление, код 0 —
 * прочие происшествия (обрушение, отключение энергии, травма). Отдельного
 * типа «затопление» у нас нет, поэтому такие позиции получают «Нет», а
 * текст события сохраняется в названии и комментарии позиции.
 */
function accidentTypeName(code: string | undefined): string {
  switch (String(code ?? "").trim()) {
    case "1": return "Пожар";
    case "2": return "Нет";
    default:  return "Нет";
  }
}

/**
 * Цвет .NET (знаковое целое ARGB, «-65536») → HEX («#FF0000»).
 * Именно так АэроСеть пишет цвета маркеров позиций — в отличие от слоёв,
 * где цвет записан строкой «#FF808000».
 */
function winColorToHex(v: string | undefined): string {
  const n = parseInt(String(v ?? "").trim(), 10);
  if (!Number.isFinite(n)) return "";
  const rgb = (n >>> 0) & 0xffffff;
  return "#" + rgb.toString(16).padStart(6, "0").toUpperCase();
}

/** ARGB-цвет АэроСети («#FF808000») → HEX без альфы («#808000»). */
function argbToHex(c: string | null): string {
  const s = String(c ?? "").replace("#", "").trim();
  if (s.length === 8) return "#" + s.slice(2).toUpperCase();
  if (s.length === 6) return "#" + s.toUpperCase();
  return "#3B82F6";
}

/**
 * Номера объектов АэроСети → уникальные id нашей схемы.
 * Номер берём как есть; повтор получает суффикс «_2», «_3»…; пустой номер —
 * первое свободное целое. Порядок результата совпадает с порядком входа.
 */
function uniqueIds(numbers: string[]): { ids: string[]; duplicates: number; empty: number } {
  const used = new Set<string>();
  const ids: string[] = new Array(numbers.length);
  let duplicates = 0, empty = 0;
  // Сначала занимаем все непустые номера (первое вхождение), чтобы свободный
  // номер для пустых не совпал с номером, который встретится позже.
  numbers.forEach((n, i) => {
    if (n && !used.has(n)) { used.add(n); ids[i] = n; }
  });
  numbers.forEach((n, i) => {
    if (ids[i]) return;
    if (n) {
      duplicates++;
      let k = 2;
      while (used.has(`${n}_${k}`)) k++;
      ids[i] = `${n}_${k}`;
    } else {
      empty++;
      let k = 1;
      while (used.has(String(k))) k++;
      ids[i] = String(k);
    }
    used.add(ids[i]);
  });
  return { ids, duplicates, empty };
}

/**
 * Для режима «Добавить к текущей»: id импорта — это номера АэроСети, и они
 * легко совпадают с номерами уже открытой схемы. Совпавшим даём суффикс
 * «_2», «_3»… и переписываем все ссылки (концы ветвей, позиции ПЛА).
 */
export function remapErpIdsForAppend(
  result: ErpImportResult,
  usedNodeIds: Iterable<string>,
  usedBranchIds: Iterable<string>,
): ErpImportResult {
  const mk = (used: Set<string>) => (id: string): string => {
    if (!used.has(id)) { used.add(id); return id; }
    let k = 2;
    while (used.has(`${id}_${k}`)) k++;
    const nid = `${id}_${k}`;
    used.add(nid);
    return nid;
  };
  const nUsed = new Set(usedNodeIds), bUsed = new Set(usedBranchIds);
  const nMap = new Map<string, string>(), bMap = new Map<string, string>();
  const nNext = mk(nUsed), bNext = mk(bUsed);
  // Сначала резервируем собственные id импорта, не конфликтующие с схемой.
  result.nodes.forEach(n => nMap.set(n.id, nNext(n.id)));
  result.branches.forEach(b => bMap.set(b.id, bNext(b.id)));
  return {
    ...result,
    nodes: result.nodes.map(n => {
      const id = nMap.get(n.id)!;
      return id === n.id ? n : { ...n, id, number: id };
    }),
    branches: result.branches.map(b => ({
      ...b,
      id: bMap.get(b.id)!,
      fromId: nMap.get(b.fromId) ?? b.fromId,
      toId: nMap.get(b.toId) ?? b.toId,
    })),
    positions: result.positions.map(p => ({
      ...p,
      branchIds: p.branchIds.map(id => bMap.get(id) ?? id),
      leaderBranchId: p.leaderBranchId ? (bMap.get(p.leaderBranchId) ?? p.leaderBranchId) : "",
    })),
    bulkheadItems: result.bulkheadItems.map(it => ({ ...it, branchId: bMap.get(it.branchId) ?? it.branchId })),
    pumpItems: (result.pumpItems ?? []).map(it => ({ ...it, branchId: bMap.get(it.branchId) ?? it.branchId })),
    measureStations: (result.measureStations ?? []).map(it => ({ ...it, branchId: bMap.get(it.branchId) ?? it.branchId })),
  };
}

export async function parseErp(
  buffer: ArrayBuffer,
  opts: { resistanceUnit?: ErpResistanceUnit } = {},
): Promise<ErpImportResult> {
  const warnings: string[] = [];
  const log: string[] = [];
  const requestedUnit: ErpResistanceUnit = opts.resistanceUnit ?? "auto";

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("Файл не является контейнером АэроСети (.erp): не удалось прочитать архив");
  }

  const schemaEntry = zip.file("schema.xml") ?? zip.file(/schema\.xml$/i)[0];
  if (!schemaEntry) throw new Error("В контейнере нет schema.xml — это не проект АэроСети");

  const xmlText = decodeXml(await schemaEntry.async("uint8array"));
  log.push(`schema.xml: ${xmlText.length} симв.`);

  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("schema.xml повреждён: ошибка разбора XML");

  // ── Справочник типов выработок: имя, скорость, форма сечения, крепь ───────
  // АэроСеть считает сопротивление по α ТИПА ПОВЕРХНОСТИ (крепи) и периметру
  // по ФОРМЕ СЕЧЕНИЯ (P = k·√S). Поля Airflow.Alpha / Airflow.Perimeter в
  // самой выработке — лишь устаревший след ручного ввода: у 344 выработок
  // проекта ЮПР там стояло 0,004426 при крепи с α = 0,01, и расчёт АэроСети
  // шёл именно по 0,01. Поэтому справочник поверхностей главнее.
  const ribTypes = new Map<string, { name: string; vMax: number; surfaceTypeId: string; crossSectionTypeId: string; defaultArea: number }>();
  const surfaceTypes = new Map<string, { name: string; alpha: number }>();
  // Формы сечения: хранят отношение периметра к корню из площади (P = k·√S).
  // Нужны потому, что периметр записан лишь у части выработок, а без него
  // нельзя посчитать сопротивление по коэффициенту α.
  const crossTypes = new Map<string, { name: string; k: number }>();
  const rtEntry = zip.file(/RibTypeService\.DataDocument$/i)[0];
  if (rtEntry) {
    const rtDoc = new DOMParser().parseFromString(decodeXml(await rtEntry.async("uint8array")), "application/xml");
    rtDoc.querySelectorAll("ribType").forEach(t => {
      const id = t.getAttribute("id");
      if (id) ribTypes.set(id, {
        name: t.getAttribute("name") ?? "",
        vMax: num(t.getAttribute("defaultMaxAirVelocity"), 0),
        surfaceTypeId: t.getAttribute("surfaceTypeId") ?? "",
        crossSectionTypeId: t.getAttribute("crossSectionTypeId") ?? "",
        // Сечение по умолчанию: выработка, у которой своё сечение не
        // записано, считается АэроСетью именно с ним.
        defaultArea: num(t.getAttribute("defaultCrossSectionArea"), 0),
      });
    });
    rtDoc.querySelectorAll("surfaceType").forEach(t => {
      const id = t.getAttribute("id");
      if (id) surfaceTypes.set(id, { name: t.getAttribute("name") ?? "", alpha: num(t.getAttribute("alpha"), 0) });
    });
    rtDoc.querySelectorAll("crossSectionType").forEach(t => {
      const id = t.getAttribute("id");
      if (id) crossTypes.set(id, { name: t.getAttribute("name") ?? "", k: num(t.getAttribute("perimeterToAreaRatio"), 0) });
    });
    log.push(`типов выработок: ${ribTypes.size}, форм сечения: ${crossTypes.size}, типов крепи: ${surfaceTypes.size}`);
  }

  // ── Режим проветривания (docs/ErpVentModes) ──────────────────────────────
  // Параметры вентиляторов и перемычек хранятся ОТДЕЛЬНО для каждого режима
  // (нормальный, реверсивный, аварийные). Берём режим, выбранный в АэроСети
  // (isSelected="True"); раньше брался первый в списке объекта — и при
  // выбранном реверсивном режиме вентиляторы читались из нормального.
  let ventModeId = "";
  let ventModeName = "";
  let ventModeCount = 0;
  const vmEntry = zip.file(/ErpVentModes\.DataDocument$/i)[0];
  if (vmEntry) {
    const vmDoc = new DOMParser().parseFromString(decodeXml(await vmEntry.async("uint8array")), "application/xml");
    const modes = Array.from(vmDoc.querySelectorAll("ventMode"));
    ventModeCount = modes.length;
    const sel = modes.find(m => bool(m.getAttribute("isSelected"))) ?? modes[0];
    if (sel) {
      ventModeId = sel.getAttribute("id") ?? "";
      ventModeName = sel.getAttribute("name") ?? "";
    }
  }
  log.push(ventModeCount
    ? `режимов проветривания: ${ventModeCount}, выбран «${ventModeName}»`
    : "режимов проветривания в файле нет — берём параметры по умолчанию");

  // ── Справочник вентиляторов (docs/VentilatorTemplateService) ─────────────
  // <ventilatorTemplate id name diameter minSpeed maxSpeed>
  //   <characteristic id bladeAngle speed discharge1..3 pressure1..3 wattage1..3 isReversed/>
  // Напор в характеристиках — в кгс/м² (как и напор в схеме), расход
  // — м³/с, мощность — кВт. По трём точкам каждого угла строим нашу кривую
  // H = h0 + h1·Q + h2·Q², как у пользовательского вентилятора.
  interface ErpFanChar { id: string; angle: number; speed: number; reversed: boolean; pts: { q: number; h: number; eta?: number }[] }
  interface ErpFanTpl { id: string; name: string; diameter: number; minSpeed: number; maxSpeed: number; chars: ErpFanChar[] }
  const fanTpls = new Map<string, ErpFanTpl>();
  const fanCharToTpl = new Map<string, string>();
  // Справочники водопровода: трубы (диаметр, стенка) и насосы (Q–p).
  const ptEntry = zip.file(/PipeTemplateService\.DataDocument$/i)[0];
  const pipeTemplates = ptEntry ? parsePipeTemplates(decodeXml(await ptEntry.async("uint8array"))) : new Map();
  const pmEntry = zip.file(/PumpTemplateService\.DataDocument$/i)[0];
  const pumpTemplates = pmEntry ? parsePumpTemplates(decodeXml(await pmEntry.async("uint8array"))) : [];
  // ── Журнал замеров (docs/Measurements.DataDocument) ─────────────────────
  // <m id d="ММ/ДД/ГГГГ чч:мм:сс" o="GUID объекта"> с полями Air.AirVelocity
  // и Air.CrossSectionArea. Объект — замерная станция на выработке. Берём
  // ПОСЛЕДНИЙ по дате замер каждой станции: им и сверяют модель.
  const lastMeasure = new Map<string, { time: number; date: string; v: number; s: number }>();
  const measureCount = new Map<string, number>();
  /** Все замеры каждой станции — для истории в карточке. */
  const measureHistory = new Map<string, MsMeasure[]>();
  const msEntry = zip.file(/Measurements\.DataDocument$/i)[0];
  if (msEntry) {
    const msDoc = new DOMParser().parseFromString(decodeXml(await msEntry.async("uint8array")), "application/xml");
    msDoc.querySelectorAll("m").forEach(m => {
      const o = m.getAttribute("o");
      if (!o) return;
      const fl: Record<string, string> = {};
      m.querySelectorAll("field").forEach(x => { const n = x.getAttribute("name"); if (n) fl[n] = x.getAttribute("value") ?? ""; });
      const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(m.getAttribute("d") ?? "");
      const time = dm ? Date.UTC(+dm[3], +dm[1] - 1, +dm[2]) : 0;
      const date = dm ? `${dm[2].padStart(2, "0")}.${dm[1].padStart(2, "0")}.${dm[3]}` : "";
      measureCount.set(o, (measureCount.get(o) ?? 0) + 1);
      const hv = num(fl["Air.AirVelocity"], 0), hs = num(fl["Air.CrossSectionArea"], 0);
      if (hv > 0 && hs > 0) {
        const list = measureHistory.get(o) ?? [];
        list.push({ date, velocity: +hv.toFixed(3), area: +hs.toFixed(2), flow: +(hv * hs).toFixed(2) });
        measureHistory.set(o, list);
      }
      const prev = lastMeasure.get(o);
      if (prev && prev.time > time) return;
      lastMeasure.set(o, { time, date, v: num(fl["Air.AirVelocity"], 0), s: num(fl["Air.CrossSectionArea"], 0) });
    });
  }

  const vtEntry = zip.file(/VentilatorTemplateService\.DataDocument$/i)[0];
  if (vtEntry) {
    const vtDoc = new DOMParser().parseFromString(decodeXml(await vtEntry.async("uint8array")), "application/xml");
    vtDoc.querySelectorAll("ventilatorTemplate").forEach(t => {
      const id = t.getAttribute("id");
      if (!id) return;
      const chars: ErpFanChar[] = [];
      // Единицы напора паспорта определяем по КПД η = Q·p/N: в кгс/м² (как
      // пишет АэроСеть) η = Q·p·g/N выходит 0,3…0,9; если же паспорт записан
      // в паскалях (так писали прежние версии нашего экспорта), то с g η
      // получается больше единицы — тогда напор не переводим.
      const etaKgf: number[] = [];
      t.querySelectorAll("characteristic").forEach(c => {
        for (let k = 1; k <= 9; k++) {
          const q = num(c.getAttribute(`discharge${k}`) ?? undefined), p = num(c.getAttribute(`pressure${k}`) ?? undefined);
          const w = num(c.getAttribute(`wattage${k}`) ?? undefined, 0);
          if (q > 0 && p > 0 && w > 0) etaKgf.push(q * p * PA_PER_KGS_M2 / (w * 1000));
        }
      });
      etaKgf.sort((a, b) => a - b);
      const pScale = etaKgf.length > 0 && etaKgf[Math.floor(etaKgf.length / 2)] > 1.2 ? 1 : PA_PER_KGS_M2;
      if (pScale === 1) log.push(`вентилятор «${t.getAttribute("name") ?? ""}»: паспорт записан в Па (старый экспорт ПВ-Системы) — без пересчёта`);
      t.querySelectorAll("characteristic").forEach(c => {
        const cid = c.getAttribute("id") ?? "";
        const pts: { q: number; h: number; eta?: number }[] = [];
        for (let k = 1; k <= 9; k++) {
          const qa = c.getAttribute(`discharge${k}`), ha = c.getAttribute(`pressure${k}`);
          if (qa == null || ha == null) continue;
          // Напор в паспорте — в кгс/м² (как рабочая точка FanPressure),
          // переводим в паскали. Раньше читали как паскали, и характеристика
          // вентилятора из файла АэроСети выходила заниженной в 9,8 раза.
          const q = num(qa), h = num(ha) * pScale, w = num(c.getAttribute(`wattage${k}`), 0);
          if (!(q > 0) || !(h >= 0)) continue;
          // КПД по мощности: η = H·Q / (N·1000), H в Па, N в кВт
          const eta = w > 0 ? Math.min(0.9, Math.max(0.05, (h * q) / (w * 1000))) : undefined;
          pts.push({ q, h, eta });
        }
        if (pts.length < 2) return;
        chars.push({
          id: cid, angle: num(c.getAttribute("bladeAngle"), 0), speed: num(c.getAttribute("speed"), 0),
          reversed: bool(c.getAttribute("isReversed")), pts: pts.sort((a, b) => a.q - b.q),
        });
        if (cid) fanCharToTpl.set(cid, id);
      });
      fanTpls.set(id, {
        id, name: t.getAttribute("name") ?? "Вентилятор",
        diameter: num(t.getAttribute("diameter"), 0),
        minSpeed: num(t.getAttribute("minSpeed"), 0), maxSpeed: num(t.getAttribute("maxSpeed"), 0),
        chars,
      });
    });
  }
  log.push(`вентиляторов в справочнике файла: ${fanTpls.size}`);

  /** Наш вентилятор (FanCurve) по шаблону АэроСети — создаётся по требованию. */
  const fanCurveByTpl = new Map<string, FanCurve | null>();
  const curveForTemplate = (tplId: string): FanCurve | null => {
    if (fanCurveByTpl.has(tplId)) return fanCurveByTpl.get(tplId)!;
    const t = fanTpls.get(tplId);
    let curve: FanCurve | null = null;
    if (t) {
      const direct = t.chars.filter(c => !c.reversed);
      const rev = t.chars.find(c => c.reversed);
      // Один угол на значение — при повторах оставляем первую характеристику.
      const byAngle = new Map<number, ErpFanChar>();
      (direct.length ? direct : t.chars).forEach(c => { if (!byAngle.has(c.angle)) byAngle.set(c.angle, c); });
      const angles = [...byAngle.values()];
      const rpm = angles.find(c => c.speed > 0)?.speed || t.maxSpeed || t.minSpeed || 1000;
      const built = buildUserFanCurve({
        id: `${USER_FAN_PREFIX}erp_${tplId.replace(/[^0-9a-z]/gi, "").slice(0, 16)}`,
        name: t.name || "Вентилятор (АэроСеть)",
        type: "axial",
        diameter: t.diameter,
        rpmMin: t.minSpeed || rpm,
        rpmMax: Math.max(t.maxSpeed || rpm, rpm),
        rpmNominal: rpm,
        source: {
          angles: angles.map(c => ({ angle: c.angle, points: c.pts })),
          ...(rev ? { reverse: { points: rev.pts } } : {}),
        },
      });
      curve = built.curve;
      if (!curve) warnings.push(`Вентилятор «${t.name}» из справочника АэроСети не перенесён: ${built.errors.join("; ")}`);
    }
    fanCurveByTpl.set(tplId, curve);
    return curve;
  };

  // ── Узлы ──────────────────────────────────────────────────────────────────
  // Читаем в «сырых» единицах проекции; масштаб применим ниже, когда узнаем
  // коэффициент по длинам ветвей.
  interface RawNode { id: string; x: number; y: number; z: number; name: string; number: string; atm: boolean; t: number; p: number; f: Record<string, string> }
  const rawNodes = new Map<string, RawNode>();
  doc.querySelectorAll("ribEndNode").forEach(n => {
    const id = n.getAttribute("id");
    if (!id) return;
    const f = readFields(n);
    rawNodes.set(id, {
      id,
      x: num(n.getAttribute("x")),
      y: num(n.getAttribute("y")),
      // RibEndNode.Depth, вопреки названию, хранит АБСОЛЮТНУЮ отметку в метрах
      // (в образце 1090…1207 м при глубине ствола ~100 м) — это ровно наша z.
      z: num(f["RibEndNode.Depth"]),
      name: n.getAttribute("name") ?? "",
      number: n.getAttribute("number") ?? "",
      atm: bool(f["HasAtmosphereConnection"]),
      t: num(f["RibTemperatureField"], 20),
      p: num(f["ModelAirPressure"]),
      f,
    });
  });
  log.push(`узлов: ${rawNodes.size}`);
  if (rawNodes.size === 0) throw new Error("В файле не найдено ни одного узла");

  // ── Слои → горизонты ──────────────────────────────────────────────────────
  // Слой АэроСети — это группа выработок (Стволы, Слой 1). Отметку слоя файл
  // не хранит, поэтому z горизонта вычислим ниже как медиану отметок его узлов.
  interface RawItem {
    id: string; code: string; description: string; f: Record<string, string>; reversed: boolean;
    /**
     * Поля САМОГО объекта, без данных режима проветривания. В них АэроСеть
     * пишет результат последнего расчёта (рабочий напор вентилятора,
     * расчётное R перемычки), а в данных режима — исходные настройки, где
     * эти же поля бывают устаревшими (см. erpItemR / erpFanHeadKgs).
     */
    own: Record<string, string>;
    /** Звено ломаной и смещение от его начала (единицы экрана файла). */
    segIndex: number; segOffset: number;
  }
  /** Точка излома выработки: экранные x/y файла и отметка z, м. */
  interface RawBend { x: number; y: number; z: number }
  interface RawBranch {
    id: string; fromId: string; toId: string; horizonId: string;
    f: Record<string, string>; items: RawItem[]; thickness: number;
    bends: RawBend[];
  }
  const rawBranches: RawBranch[] = [];
  const horizonMeta: { id: string; name: string; color: string; visible: boolean; order: number }[] = [];

  doc.querySelectorAll("layers > layer").forEach(layer => {
    const lid = layer.getAttribute("id");
    if (!lid) return;
    // Второй список <layer id isVisible/> в настройках вентрежима — без name.
    const lname = layer.getAttribute("name");
    if (lname == null) return;
    horizonMeta.push({
      id: lid,
      name: lname || "Без названия",
      color: argbToHex(layer.getAttribute("color")),
      visible: layer.getAttribute("isVisible") == null ? true : bool(layer.getAttribute("isVisible")),
      order: num(layer.getAttribute("orderIndex")),
    });
    layer.querySelectorAll("rib").forEach(rib => {
      const id = rib.getAttribute("id");
      const fromId = rib.getAttribute("fromNode");
      const toId = rib.getAttribute("toNode");
      if (!id || !fromId || !toId) return;
      const items: RawItem[] = [];
      rib.querySelectorAll("ribItem").forEach(it => {
        items.push({
          id: it.getAttribute("id") ?? "",
          code: it.getAttribute("itemCode") ?? "",
          description: it.getAttribute("description") ?? "",
          f: readItemFields(it, ventModeId),
          own: readItemFields(it, ventModeId, true),
          // Направление действия объекта: isReversed="True" — вентилятор
          // работает против направления выработки (from → to).
          reversed: bool(it.getAttribute("isReversed")),
          segIndex: num(it.getAttribute("segmentIndex"), 0),
          segOffset: num(it.getAttribute("segmentOffset"), -1),
        });
      });
      // Точки излома: <innerNodes><ribNode index x y><…field name="z"/>.
      // Они задают настоящую трассу выработки — длину считаем по ломаной.
      const bends: RawBend[] = [];
      const inner = Array.from(rib.children).find(c => isTag(c, "innerNodes"));
      if (inner) {
        Array.from(inner.children)
          .filter(c => isTag(c, "ribNode"))
          .map(c => ({ el: c, i: num(c.getAttribute("index")) }))
          .sort((a, b) => a.i - b.i)
          .forEach(({ el }) => {
            bends.push({
              x: num(el.getAttribute("x")),
              y: num(el.getAttribute("y")),
              z: num(readFields(el)["z"]),
            });
          });
      }
      rawBranches.push({
        id, fromId, toId, horizonId: lid,
        f: ownFields(rib), items, thickness: num(rib.getAttribute("thickness"), 3), bends,
      });
    });
  });
  log.push(`слоёв: ${horizonMeta.length}, ветвей: ${rawBranches.length}`);
  if (rawBranches.length === 0) throw new Error("В файле не найдено ни одной выработки");

  // ── Обратное преобразование координат из проекции в метры ─────────────────
  // КЛЮЧЕВОЙ момент формата. x/y в файле — это НЕ план, а готовая картинка в
  // косоугольной проекции: высота уже подмешана в экранный Y и умножена на
  // OZDistortion (в образце — впятеро). Взять x/y напрямую нельзя — схема
  // получится растянутой по вертикали, с неверными длинами и углами наклона.
  //
  // Параметры проекции лежат в <options> самой схемы, поэтому ничего не
  // угадываем — читаем и обращаем формулу отрисовки (вывод см. в шапке файла).
  const opt = (name: string, def: number): number => {
    const el = Array.from(doc.querySelectorAll("options > option"))
      .find(o => o.getAttribute("name") === name);
    return el ? num(el.textContent, def) : def;
  };
  // GeolocationScale — «метров в единице»: единиц на метр = 1/scale.
  const geoScale = opt("GeolocationScale", 0);
  const s = geoScale > 1e-9 ? 1 / geoScale : 1;
  const oyAngle = opt("OYAngle", Math.PI / 2);
  const oyDist = opt("OYDistortion", 1);
  const ozDist = opt("OZDistortion", 1);
  const sinOY = Math.sin(oyAngle) * oyDist;
  // ProjectionType: 1 — косоугольная (OYAngle/OYDistortion, как у УГОК,
  // БГОК, Якутского); 0 — аксонометрия «взгляд сверху под углом»
  // OverheadAngle (как у «Руссоли»). Во второй план сжат по вертикали экрана
  // в sin(OverheadAngle) раз, а высота входит с весом OZDistortion·cos(…):
  //   ex = s·X,  ey = −s·( sin(θ)·Y + OZDistortion·cos(θ)·Z ).
  // Сверено на «Руссоль 2027.I»: стволы на экране строго вертикальны с шагом
  // 9,271 = 10,5·cos(28°) ед/м, а длины выработок лучше всего сходятся при
  // сжатии 0,47 = sin(28°). Раньше такой файл читался косоугольной формулой:
  // план сжимался, а высота «протекала» в него — стволы ложились в план
  // наклонными линиями длиной в сотни метров.
  const projType = Math.round(opt("ProjectionType", 1));
  const overhead = opt("OverheadAngle", Math.PI / 2);
  const axon = projType === 0 && Math.abs(Math.sin(overhead)) > 1e-6;
  const sinTh = Math.sin(overhead), ozCos = ozDist * Math.cos(overhead);

  if (geoScale <= 1e-9) {
    warnings.push("В файле нет масштаба (GeolocationScale) — координаты взяты как есть, длины выработок при этом верны");
  }
  log.push(axon
    ? `проекция: аксонометрия, scale=${geoScale.toFixed(6)}, OverheadAngle=${(overhead * 180 / Math.PI).toFixed(1)}°, OZDist=${ozDist}`
    : `проекция: косоугольная, scale=${geoScale.toFixed(6)}, OYAngle=${oyAngle.toFixed(4)}, OYDist=${oyDist}, OZDist=${ozDist}`);

  /**
   * Экранные координаты + отметка → плановые X/Y в метрах.
   * Если ось Y вырождена (sin(OYAngle)·OYDistortion ≈ 0), схема нарисована
   * вертикальным разрезом: плановой Y в ней просто нет, ставим 0.
   */
  const toPlan = (ex: number, ey: number, z: number): { x: number; y: number } => {
    if (axon) return { x: ex / s, y: -(ey / s + ozCos * z) / sinTh };
    if (Math.abs(sinOY) < 1e-9) return { x: ex / s, y: 0 };
    const Y = -(ey / s + ozDist * z) / sinOY;
    const X = ex / s - Math.cos(oyAngle) * oyDist * Y;
    return { x: X, y: Y };
  };

  // ── Сборка узлов ──────────────────────────────────────────────────────────
  // id узла = его НОМЕР из АэроСети (атрибут number), а не служебное
  // «n_erp_N»: номер выводится в подписях, свойствах и строке состояния, и
  // пользователь должен видеть те же номера, что и в АэроСети. Номера в
  // файле бывают повторены (в БГОК — 13 повторов) или пусты — такие делаем
  // уникальными суффиксом «_2», «_3», пустым даём первый свободный номер.
  const nodeIds = uniqueIds(Array.from(rawNodes.values()).map(rn => rn.number.trim()));
  if (nodeIds.duplicates > 0) warnings.push(`Повторяющихся номеров узлов в файле: ${nodeIds.duplicates} — к повторам добавлен суффикс «_2», «_3»…`);
  if (nodeIds.empty > 0) warnings.push(`Узлов без номера: ${nodeIds.empty} — им присвоены свободные номера`);
  const idMap = new Map<string, string>();
  const nodes: TopoNode[] = [];
  let nodeIdx = 0;
  rawNodes.forEach(rn => {
    const newId = nodeIds.ids[nodeIdx++];
    idMap.set(rn.id, newId);
    const p = toPlan(rn.x, rn.y, rn.z);
    nodes.push(makeNode(newId, {
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +rn.z.toFixed(2),
      name: rn.name,
      number: newId,
      atmosphereLink: rn.atm,
      airTemp: rn.t,
      reducedPressure: rn.p,
      ...(erpNodeWater(rn.f) ?? {}),
    }));
  });

  // ── Горизонты: отметка = медиана Z узлов слоя ─────────────────────────────
  const zByLayer = new Map<string, number[]>();
  for (const rb of rawBranches) {
    const a = rawNodes.get(rb.fromId), b = rawNodes.get(rb.toId);
    if (!zByLayer.has(rb.horizonId)) zByLayer.set(rb.horizonId, []);
    const arr = zByLayer.get(rb.horizonId)!;
    if (a) arr.push(a.z);
    if (b) arr.push(b.z);
  }
  const horizons: Horizon[] = horizonMeta
    .sort((a, b) => a.order - b.order)
    .map(h => {
      const zs = (zByLayer.get(h.id) ?? []).slice().sort((p, q) => p - q);
      const z = zs.length > 0 ? zs[Math.floor(zs.length / 2)] : 0;
      return { id: `h_erp_${h.id.slice(0, 8)}`, name: h.name, z: +z.toFixed(2), color: h.color, visible: h.visible };
    });
  const horizonIdMap = new Map(horizonMeta.map(h => [h.id, `h_erp_${h.id.slice(0, 8)}`]));

  // ── Геометрия и крепь выработки — так же, как их берёт сама АэроСеть ──────
  // Правила выверены по проекту ЮПР сверкой с давлениями узлов из файла
  // (R = ΔP/Q²): совпадение у 442 выработок из 444 против 1 из 444 раньше.
  //
  // ДЛИНА. Airflow.UserDefinedRibLength действует ТОЛЬКО при флаге
  // RibLengthIsUserDefined=True. Без флага это устаревшее число, а АэроСеть
  // считает длину по трассе — через все точки излома (раньше мы брали это
  // устаревшее число или прямую между концами: 46,8 м вместо 91,9 м).
  //
  // α. Сначала крепь выработки (Airflow.SurfaceTypeId), затем крепь её типа,
  // и только затем Airflow.Alpha. P — по форме сечения (P = k·√S), иначе
  // записанный периметр.
  //
  // БЕЗ ПАРАМЕТРОВ. Выработка без сечения и типа считается АэроСетью с
  // параметрами по умолчанию (S = 10, P = 11,21, α = 0,004426), а не как
  // соединение без сопротивления.
  interface ErpGeom {
    area: number; perimeter: number; length: number;
    /** α в единицах файла (СИ, кг/м³). */
    alphaSi: number;
    alphaSource: "surface" | "ribType" | "rib" | "default" | "none";
    surfaceName: string;
    defaulted: boolean;
    lengthFromBends: boolean;
  }
  const geomOf = (rb: RawBranch): ErpGeom => {
    const f = rb.f;
    const rt = ribTypes.get(f["Airflow.RibTypeId"] ?? "");
    const hasArea = f["Airflow.CrossSectionArea"] != null && f["Airflow.CrossSectionArea"] !== "";
    const defaulted = !hasArea && !rt;
    // Нет своего сечения — берём сечение ТИПА выработки (defaultCrossSectionArea).
    // Раньше такие выработки получали S = 0 и R = 0: на «УГОК» это 234
    // выработки, а сверка с давлениями узлов файла показала, что АэроСеть
    // считает их ровно по сечению типа (19,2 м² у «Упырёвской БВР торкрет»).
    const area = hasArea ? num(f["Airflow.CrossSectionArea"], 0)
      : defaulted ? ERP_DEFAULT_AREA : (rt?.defaultArea ?? 0);

    const surfOwn = surfaceTypes.get(f["Airflow.SurfaceTypeId"] ?? "");
    const surfType = rt ? surfaceTypes.get(rt.surfaceTypeId) : undefined;
    const alphaRib = num(f["Airflow.Alpha"], 0);
    let alphaSi = 0;
    let alphaSource: ErpGeom["alphaSource"] = "none";
    let surfaceName = "";
    if (surfOwn && surfOwn.alpha > 0) { alphaSi = surfOwn.alpha; alphaSource = "surface"; surfaceName = surfOwn.name; }
    else if (surfType && surfType.alpha > 0) { alphaSi = surfType.alpha; alphaSource = "ribType"; surfaceName = surfType.name; }
    else if (alphaRib > 0) { alphaSi = alphaRib; alphaSource = "rib"; }
    else if (defaulted) { alphaSi = ERP_DEFAULT_ALPHA_SI; alphaSource = "default"; }

    const ct = crossTypes.get(f["Airflow.CrossSectionTypeId"] ?? "")
      ?? (rt ? crossTypes.get(rt.crossSectionTypeId) : undefined);
    const perimeter = defaulted
      ? ERP_DEFAULT_PERIMETER
      : (ct && ct.k > 0 && area > 0 ? +(ct.k * Math.sqrt(area)).toFixed(3) : num(f["Airflow.Perimeter"], 0));

    const na = rawNodes.get(rb.fromId), nb = rawNodes.get(rb.toId);
    let polyLength = 0;
    if (na && nb) {
      const pts = [na, ...rb.bends, nb].map(p => {
        const q = toPlan(p.x, p.y, p.z);
        return { x: q.x, y: q.y, z: p.z };
      });
      for (let i = 1; i < pts.length; i++) {
        polyLength += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
      }
    }
    const userFlag = bool(f["Airflow.RibLengthIsUserDefined"]);
    const userLength = num(f["Airflow.UserDefinedRibLength"], 0);
    const useUser = userFlag && userLength > 0;
    return {
      area, perimeter,
      length: +(useUser ? userLength : polyLength).toFixed(2),
      alphaSi, alphaSource, surfaceName, defaulted,
      lengthFromBends: !useUser && rb.bends.length > 0,
    };
  };
  const geoms = new Map(rawBranches.map(rb => [rb, geomOf(rb)] as const));

  // ── Сборка ветвей ─────────────────────────────────────────────────────────
  // Единицы сопротивления: либо заданы пользователем, либо определяются по
  // данным. Считаем ДО сборки ветвей — коэффициент нужен каждой из них.
  // Сначала — по согласованности сети (надёжно, если в файле есть расходы
  // последнего расчёта), иначе — прежним сравнением с геометрией.
  const balanceUnit = requestedUnit === "auto"
    ? detectErpUnitByBalance(rawBranches.map(rb => {
        const g = geoms.get(rb)!;
        const f = rb.f;
        const mode = String(f["Airflow.AirResistanceCalculationType"] ?? "");
        const sq = num(f["Airflow.DepressionSurveyDischarge"], 0);
        const sdp = num(f["Airflow.UserDefinedDepressionDelta"], 0);
        const userR = mode === "2" || (mode === "1" && sq > 0);
        const rUserFile = mode === "2" ? num(f["Airflow.UserDefinedResistance"], 0)
          : mode === "1" && sq > 0 ? sdp / (sq * sq) : 0;
        const rGeom = userR || !(g.area > 0)
          ? 0 : (g.alphaSi / G) * g.perimeter * g.length / Math.pow(g.area, 3);
        let rBulk = 0, h = 0;
        for (const it of rb.items) {
          const isFan = ITEM_FAN.has(it.code) || FAN_FIELDS.some(k => it.f[k] != null && it.f[k] !== "");
          if (isFan) {
            h += erpFanHeadKgs(it);
          } else {
            rBulk += erpItemR(it) + erpHeaterR(it);
          }
        }
        return {
          from: rb.fromId, to: rb.toId, q: num(f["Airflow.Discharge"], 0),
          rGeom, rFile: rUserFile + rBulk, h,
        };
      }), new Set([...rawNodes.values()].filter(nd => nd.atm).map(nd => nd.id)))
    : null;
  // Прямая проверка по давлениям узлов: выработки БЕЗ объектов, R по α.
  const pressureUnit = requestedUnit === "auto"
    ? detectErpUnitByPressures(rawBranches.filter(rb => rb.items.length === 0).map(rb => {
        const g = geoms.get(rb)!;
        const mode = String(rb.f["Airflow.AirResistanceCalculationType"] ?? "");
        const a = rawNodes.get(rb.fromId), b = rawNodes.get(rb.toId);
        return {
          dp: a && b ? a.p - b.p : 0,
          q: num(rb.f["Airflow.Discharge"], 0),
          rGeomSi: mode === "1" || mode === "2" || !(g.area > 0) ? 0
            : g.alphaSi * g.perimeter * g.length / Math.pow(g.area, 3),
        };
      }))
    : null;
  const rUnit: "kmu" | "si" = requestedUnit !== "auto" ? requestedUnit
    : pressureUnit ? pressureUnit
    : balanceUnit?.unit ? balanceUnit.unit
    : detectErpResistanceUnit(rawBranches.map(rb => {
        const g = geoms.get(rb)!;
        return {
          r: num(rb.f["Airflow.UserDefinedResistance"], 0),
          alpha: g.alphaSi,
          area: g.area,
          perimeter: g.perimeter,
          length: g.length,
        };
      }));
  // Наш расчёт применяет R как Н·с²/м⁸ (R·Q² сразу в паскалях, как и напор
  // вентилятора). АэроСеть штатно хранит кгс·с²/м⁸ — умножаем на g; если
  // проект АэроСети переведён в СИ — берём как есть. Раньше было наоборот
  // (кгс — как есть, СИ — делить на 9,81): все сопротивления выходили в 9,8
  // раза меньше, и расходы после импорта завышались примерно в 3 раза.
  const rFactor = rUnit === "si" ? 1 : G;
  const unitText = rUnit === "si" ? "СИ (Н·с²/м⁸), без пересчёта" : "кгс·с²/м⁸, умножаем на 9,81";
  log.push(requestedUnit !== "auto"
    ? `Единицы R: задано вручную → ${unitText}`
    : pressureUnit
      ? `Единицы R: по давлениям узлов файла → ${unitText}`
    : balanceUnit?.unit
      ? `Единицы R: по сходимости давлений в сети → ${unitText} (невязка: СИ ${balanceUnit.si.toFixed(2)}, кгс ${balanceUnit.kmu.toFixed(2)} кгс/м²)`
      : `Единицы R: по сравнению с геометрией → ${unitText}${balanceUnit ? ` (сходимость не различила: СИ ${balanceUnit.si.toFixed(2)}, кгс ${balanceUnit.kmu.toFixed(2)})` : ""}`);

  const branches: TopoBranch[] = [];
  /** GUID выработки в файле → её id на нашей схеме (нужно позициям ПЛА). */
  const branchIdMap = new Map<string, string>();
  // id ветви = номер выработки в АэроСети (поле Rib.Number), как и у узлов.
  const branchIds = uniqueIds(rawBranches.map(rb => (rb.f["Rib.Number"] ?? "").trim()));
  if (branchIds.duplicates > 0) warnings.push(`Повторяющихся номеров выработок в файле: ${branchIds.duplicates} — к повторам добавлен суффикс «_2», «_3»…`);
  if (branchIds.empty > 0) warnings.push(`Выработок без номера: ${branchIds.empty} — им присвоены свободные номера`);
  const branchIdOf = new Map(rawBranches.map((rb, i) => [rb, branchIds.ids[i]] as const));
  let fans = 0, bulkheads = 0, skipped = 0;
  let fansByCurve = 0, fansFixedQ = 0, fansReversed = 0, fanCurveMissing = 0;
  const fanCurveIds = new Set<string>();
  /** Вентиляторы, для которых кривая взята из нашего каталога по названию. */
  let fansByCatalog = 0;
  const catalogFanNames = new Set<string>();
  const missingFanNames = new Set<string>();
  const bulkheadItems: ErpBulkhead[] = [];
  const pumpItems: ErpPumpOnBranch[] = [];
  const measureStations: ErpMeasureStation[] = [];
  const waterStat = { pipes: 0, gates: 0, gatesClosed: 0, reducers: 0, air: 0 };
  let fansInBulkhead = 0;
  const fanBulkheadNotes: string[] = [];
  let bulkMulti = 0, bulkWithFan = 0;
  /** Ветви, развёрнутые при импорте (реверсный ВМП). */
  const flippedBranches = new Set<string>();
  const alphaStat = { surface: 0, ribType: 0, rib: 0, default: 0, none: 0 };
  let bendLengths = 0, notPassable = 0, longwalls = 0;
  let heatersWithR = 0;

  for (const rb of rawBranches) {
    const fromId = idMap.get(rb.fromId);
    const toId = idMap.get(rb.toId);
    if (!fromId || !toId) { skipped++; continue; }
    const f = rb.f;

    const g = geoms.get(rb)!;
    const { area, perimeter, length } = g;
    alphaStat[g.alphaSource]++;
    if (g.lengthFromBends) bendLengths++;
    const isNotPassable = bool(f["Position.RibIsNotPassable"]);
    if (isNotPassable) notPassable++;
    const isLongwall = bool(f["Rib.IsLongwall"]);
    if (isLongwall) longwalls++;
    // α: в файле кг/м³, у нас ×10⁻⁴ кг/м³ — без деления на g (наш расчёт
    // применяет R = α·P·L/S³ сразу как Н·с²/м⁸, см. rFactor).
    const alphaCoef = g.alphaSi > 0 ? +(g.alphaSi * 1e4).toFixed(4) : 0;
    // Сопротивление приводим к нашим единицам (кМюрг) — см. rFactor выше.
    const rUser = +(num(f["Airflow.UserDefinedResistance"], 0) * rFactor).toFixed(6);
    const rt = ribTypes.get(f["Airflow.RibTypeId"] ?? "");

    // Способ задания сопротивления (Airflow.AirResistanceCalculationType).
    // По образцу: 2 = задано пользователем (UserDefinedResistance). Прочие
    // значения означают расчёт по α — тогда переносим α, а R пересчитает солвер.
    const rMode = String(f["Airflow.AirResistanceCalculationType"] ?? "");
    // 1 = по депрессионной съёмке: R = ΔP / Q² (ΔP — UserDefinedDepressionDelta,
    // Q — DepressionSurveyDischarge, обе в единицах файла). Сверено с БГОК:
    // R по съёмке совпало с ΔP/Q² по давлениям узлов до 10⁻¹⁵. Раньше такая
    // выработка шла «по α» и получала R в 8 раз меньше.
    const surveyQ = num(f["Airflow.DepressionSurveyDischarge"], 0);
    const surveyDP = num(f["Airflow.UserDefinedDepressionDelta"], 0);
    // Способ «задано» / «по съёмке» действует и при НУЛЕВОМ значении: так
    // АэроСеть и считает (на «УГОК» выработки 1676 и 1754 — R = 0 по давлениям
    // узлов). Раньше ноль игнорировался, и выработка шла по α с R в тысячи
    // раз больше оригинала.
    const bySurvey = rMode === "1" && surveyQ > 0;
    const rSurvey = bySurvey ? +(surveyDP / (surveyQ * surveyQ) * rFactor).toFixed(6) : 0;
    // Калорифер — местное сопротивление в канале. Переносим его в ξ
    // выработки (R_мест = ξ·ρ/(2·S²) → ξ = 2·S²·R/ρ), чтобы R по α и
    // геометрии осталось редактируемым. Без сечения или при заданном R —
    // прибавляем к заданному R.
    const heaterRSi = rb.items.reduce((acc, it) => acc + erpHeaterR(it), 0) * rFactor;
    if (heaterRSi > 0) heatersWithR++;
    const useManualRBase = rMode === "2" || bySurvey;
    const heaterAsXi = heaterRSi > 0 && !useManualRBase && area > 0;
    const localXi = heaterAsXi ? +(2 * area * area * heaterRSi / 1.2).toFixed(4) : 0;
    const useManualR = useManualRBase;
    const rManual = +((bySurvey ? rSurvey : rUser) + (heaterRSi > 0 && !heaterAsXi ? heaterRSi : 0)).toFixed(6);

    // Объект на ветви опознаём по его собственным полям (надёжно на любом
    // проекте), а код itemCode — как запасной признак для известных картинок.
    const fanItem = rb.items.find(it =>
      ITEM_FAN.has(it.code) || FAN_FIELDS.some(k => it.f[k] != null && it.f[k] !== ""));
    // ВСЕ перемычки выработки (объект-вентилятор перемычкой не считаем, даже
    // если у него есть поле сопротивления «своей» перемычки).
    const bulkItemsAll = rb.items.filter(it => it !== fanItem && !ITEM_FAN.has(it.code)
      && !FAN_FIELDS.some(k => it.f[k] != null && it.f[k] !== "")
      && (ITEM_BULKHEAD.has(it.code) || BULKHEAD_FIELDS.some(k => it.f[k] != null && it.f[k] !== "")));
    const bulkItem = bulkItemsAll[0];
    const hasFan = !!fanItem;
    // Перемычка на ветви с вентилятором больше НЕ теряется: в АэроСети
    // ГВУ часто стоит рядом с ляда/дверью, и их сопротивление последовательно.
    const hasBulkhead = bulkItemsAll.length > 0;
    if (hasFan) fans++;
    if (hasBulkhead) bulkheads += bulkItemsAll.length;
    if (bulkItemsAll.length > 1) bulkMulti++;
    if (hasBulkhead && hasFan) bulkWithFan++;

    // Депрессия вентилятора. АэроСеть пишет её в кгс/м² (мм вод. ст.), а наше
    // поле fanPressure — в паскалях, поэтому переводим (обоснование в шапке
    // файла). Без этого напор занижался ровно в 9,8 раза. Значения лежат в
    // полях самого объекта, а не ветви (на ветви они есть не всегда).
    const ff = fanItem?.f ?? {};
    const bf = bulkItem?.f ?? {};
    // Несколько вентиляторов на одной выработке (в БГОК — №309: −396,8 и
    // +425,8) работают последовательно: напоры складываются. Раньше брался
    // только первый, и выработка получала −3891 Па вместо +284 Па.
    const fanItems = rb.items.filter(it =>
      ITEM_FAN.has(it.code) || FAN_FIELDS.some(k => it.f[k] != null && it.f[k] !== ""));
    const fanSumKgs = fanItems.reduce((s, it) => s + erpFanHeadKgs(it), 0);
    const fanPressureKgs = fanSumKgs
      || num(f["Airflow.FanPressure"], 0)
      || num(f["Airflow.IdealVentilatorPressure"], 0);
    // ── Направление вентилятора ─────────────────────────────────────────
    // Реверс: атрибут isReversed="True" у объекта (так пишет и наш экспорт).
    // Отрицательный напор в файле — тоже работа против направления выработки:
    // наш расчёт берёт max(0, напор), поэтому знак переводим в реверс, а напор
    // делаем положительным. Иначе такой вентилятор просто «выключался».
    // Напор уже со знаком по направлению выработки (erpFanHeadKgs). Для
    // постоянной депрессии направление задаёт этот знак. Для работы по
    // характеристике и постоянного расхода — атрибут isReversed: рабочая
    // точка может лежать в зоне отрицательного напора, и по знаку нельзя
    // судить, куда вентилятор установлен.
    const fanReversedAttr = !!fanItem?.reversed;
    const fanPressureSigned = fanPressureKgs * PA_PER_KGS_M2;
    const vTypeEarly = String(ff["Airflow.VentilatorType"] ?? "0").trim();
    const fanReverse = hasFan && (vTypeEarly === "1" || vTypeEarly === "2"
      ? fanReversedAttr
      : fanPressureSigned < 0);
    const fanPressure = +Math.abs(fanPressureSigned).toFixed(2);

    // ── Режим работы вентилятора (Airflow.VentilatorType) ────────────────
    //   0 — постоянная депрессия; 1 — по характеристике (ссылка на
    //   справочник); 2 — постоянный расход (VentilatorFixedQ, м³/с).
    // Раньше всё читалось как «постоянная депрессия» с напором FanPressure —
    // а это лишь рабочая точка последнего расчёта АэроСети (часто 0 или
    // устаревшая), и вентилятор переставал искать точку на своей кривой.
    const vType = String(ff["Airflow.VentilatorType"] ?? "0").trim();
    let fanMode: "constant" | "curve" | "fixed" = "constant";
    let fanCurveId = "";
    let fanBladeAngle = 0;
    let fanFixedQ = 0;
    // Остановленный вентилятор в АэроСети — явно нулевые обороты в
    // ВЫБРАННОМ режиме проветривания (в «Руссоли»: ГВУ №2 — 0 об/мин в
    // «Режиме 1», ВМП — 0 в «Реверсе»). Раньше это учитывалось только у
    // свободно стоящих вентиляторов, а нулевые обороты заменялись
    // номинальными из характеристики — и остановленный вентилятор работал.
    const fanStoppedInFile = hasFan && String(ff["Airflow.VentilatorSpeed"] ?? "").trim() !== ""
      && num(ff["Airflow.VentilatorSpeed"], 1) === 0;
    let fanRpm = hasFan ? num(ff["Airflow.VentilatorSpeed"], 0) : 0;
    if (hasFan && vType === "1") {
      const chrId = ff["Airflow.VentilatorCharacteristicId"] ?? "";
      const tplId = ff["Airflow.VentilatorTemplateId"] || fanCharToTpl.get(chrId) || "";
      const curve = tplId ? curveForTemplate(tplId) : null;
      if (curve) {
        fanMode = "curve";
        fanCurveId = curve.id;
        const chr = fanTpls.get(tplId)?.chars.find(c => c.id === chrId);
        fanBladeAngle = chr ? chr.angle : (curve.bladeAngles[Math.floor((curve.bladeAngles.length - 1) / 2)] ?? 0);
        // Обороты характеристики — номинальные; если в объекте свои, берём их.
        if (!(fanRpm > 0)) fanRpm = chr?.speed || curve.rpmNominal;
        fanCurveIds.add(curve.id);
        fansByCurve++;
      } else {
        // Кривой в справочнике файла нет — ищем модель по названию в нашем
        // каталоге (ВМЭ-12А, ВМ-8М, ВМ-6М …), чтобы вентилятор работал по
        // характеристике, а не с постоянным напором из старой рабочей точки.
        const tplName = tplId ? fanTpls.get(tplId)?.name : "";
        const cat = findCatalogFanByName(tplName, fanItem?.description, f["Rib.Name"]);
        if (cat) {
          fanMode = "curve";
          fanCurveId = cat.id;
          if (!(fanRpm > 0)) fanRpm = cat.rpmNominal;
          // Угол лопаток — тот, чья кривая ближе всего проходит через рабочую
          // точку АэроСети (Q, H). Без рабочей точки — средний угол каталога.
          const qOp = Math.abs(num(f["Airflow.Discharge"], 0)) / Math.max(1, Math.round(num(ff["Airflow.VentilatorsInParallel"], 1)));
          if (cat.bladeAngles.length === 0) {
            fanBladeAngle = 0;
          } else if (qOp > 0 && fanPressure > 0) {
            let bestA = cat.bladeAngles[0], bestD = Infinity;
            for (const a of cat.bladeAngles) {
              const d = Math.abs(fanHAngle(cat, qOp, a, fanRpm) - fanPressure);
              if (d < bestD) { bestD = d; bestA = a; }
            }
            fanBladeAngle = bestA;
          } else {
            fanBladeAngle = cat.bladeAngles[Math.floor((cat.bladeAngles.length - 1) / 2)];
          }
          fansByCatalog++;
          catalogFanNames.add(cat.name);
        } else {
          fanCurveMissing++;
          if (fanItem?.description || tplName) missingFanNames.add(tplName || fanItem?.description || "");
        }
      }
    } else if (hasFan && vType === "2") {
      const q = num(ff["Airflow.VentilatorFixedQ"], 0);
      if (q > 0) { fanMode = "fixed"; fanFixedQ = q; fansFixedQ++; }
    }
    if (hasFan && fanReverse) fansReversed++;

    // ── Способ установки вентилятора (Airflow.VentilatorInstallationType) ─
    // Наш экспорт пишет 0 и при этом кладёт сопротивление окна ГВУ прямо в R
    // выработки (fanInstallR) — и АэроСеть считает такую сеть так же, как мы.
    // Значит, при 0 (и когда поля нет вовсе — как в проектах без режимов)
    // АэроСеть никакого добавочного сопротивления окна НЕ вводит.
    //
    // Раньше импорт всегда ставил «Внутри перемычки». После переноса
    // характеристик у вентилятора появился диаметр колеса, и программа
    // сама добавляла R окна π·D²/4 — сверх R выработки из файла. Сопротивление
    // ветви ГВУ завышалось, а при повторном импорте нашего же файла окно
    // учитывалось дважды.
    //
    // Ненулевой способ — вентилятор в перемычке. Сопротивление этой
    // перемычки (VentilatorBulkheadResistance) в АэроСети по умолчанию 1000
    // кМюрг — это путь УТЕЧЕК в обход вентилятора (параллельно ему), а не
    // последовательное сопротивление: подставлять его в fanCrossingR
    // (последовательное) нельзя — расход через ГВУ упал бы почти до нуля.
    //
    // ИСПРАВЛЕНО: способ «1» в АэроСети — вентилятор, стоящий СВОБОДНО в
    // выработке (без перемычки): воздух идёт мимо него, а сам он лишь
    // подталкивает поток струёй (15–30 Па у ВМЭ-12А). Раньше такой
    // вентилятор читался как «в перемычке» и перекрывал выработку: в ней
    // оставался только его расход (УГОК: ПДШ 5 гор. 850 м — 21 м³/с вместо
    // 115). Теперь это отдельный способ установки — FAN_INSTALL_FREE.
    const installRaw = String(ff["Airflow.VentilatorInstallationType"] ?? "").trim();
    const fanFree = hasFan && installRaw !== "" && installRaw !== "0";
    const fanInBulkhead = false;
    if (fanFree) fansInBulkhead++;

    // ВМП в нашем расчёте нагнетает ВСЕГДА от начального узла к конечному,
    // флаг реверса для него не действует (реверс главного вентилятора не
    // разворачивает местные). Поэтому ВМП, работающий против направления
    // выработки, переносим перестановкой её концов — ровно так же, как
    // кнопка «Сменить направление вентилятора». Расход меняет знак.
    const fanTypeV: "ВМП" | "ГВУ" = hasFan && fanItem?.code === ERP_FAN_LOCAL ? "ВМП" : "ГВУ";
    const flipVmp = hasFan && fanTypeV === "ВМП" && fanReverse;
    const bFrom = flipVmp ? toId : fromId;
    const bTo = flipVmp ? fromId : toId;
    const flow0 = num(f["Airflow.Discharge"], 0);
    if (flipVmp) flippedBranches.add(branchIdOf.get(rb)!);
    // Сопротивление перемычки: заданное пользователем, иначе расчётное.
    // Единица та же, что и у выработок, — приводим тем же коэффициентом.
    const itemR = (it: RawItem) => erpItemR(it) * rFactor;
    // Несколько сооружений на одной выработке стоят последовательно: R
    // складываются. Поле самой выработки — запасной вариант, если у
    // объектов сопротивление не записано.
    const sumItemsR = bulkItemsAll.reduce((acc, it) => acc + itemR(it), 0);
    const bulkR = +(sumItemsR
      || (num(f["Airflow.BulkheadUserDefinedResistance"], 0)
        || num(f["Airflow.BulkheadCalculatedResistance"], 0)) * rFactor).toFixed(6);

    // Положение объекта вдоль выработки (0…1) — по звену ломаной и смещению
    // в экранных единицах файла (так же пишет наш экспорт).
    const tOfItem = (it: RawItem): number => {
      const na = rawNodes.get(rb.fromId), nb = rawNodes.get(rb.toId);
      if (!na || !nb || it.segOffset < 0) return 0.5;
      const pts = [na, ...rb.bends, nb];
      const segLen = (i: number) => Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) total += segLen(i);
      if (total <= 0) return 0.5;
      const si = Math.min(Math.max(0, Math.round(it.segIndex)), pts.length - 2);
      let before = 0;
      for (let i = 0; i < si; i++) before += segLen(i);
      const t = Math.min(1, Math.max(0, (before + Math.min(it.segOffset, segLen(si))) / total));
      return t;
    };

    // Запоминаем соответствие «GUID выработки в файле → наш id»: по нему
    // позиции ПЛА ниже находят свои выработки и точку привязки выноски.
    const branchId = branchIdOf.get(rb)!;
    bulkItemsAll.forEach(it => {
      const t0 = tOfItem(it);
      // Без собственного R у объекта берём поле выработки (делим поровну).
      const r = itemR(it) || (sumItemsR > 0 ? 0 : bulkR / bulkItemsAll.length);
      bulkheadItems.push({
        branchId,
        // Вид и материал задаёт КОД картинки АэроСети, а не подпись: в
        // подписи у сооружений обычно номер («285», «124/1»). Раньше значок
        // подбирался по подписи — по номеру ни вид, ни материал не угадать,
        // и почти все сооружения становились глухими белыми перемычками.
        name: erpBulkheadName(it.code) || it.description || "Перемычка",
        code: it.code,
        symbolId: erpSymbolForCodeOrWindow(it.code, num(it.f["Airflow.VentWindowArea"], 0)),
        number: (it.description ?? "").trim(),
        windowArea: num(it.f["Airflow.VentWindowArea"], 0),
        r: +r.toFixed(6),
        t: +(flipVmp ? 1 - t0 : t0).toFixed(4),
        surveyQ: num(it.f["Airflow.BulkheadDepressionSurveyDischarge"], 0),
      });
    });
    branchIdMap.set(rb.id, branchId);
    // ── Водопровод и воздухопровод ──────────────────────────────────────
    const water = erpBranchWater(f, rb.items, pipeTemplates);
    if (water.hasWaterPipe) waterStat.pipes++;
    if (water.wpHasGate) { waterStat.gates++; if (water.wpGateClosed) waterStat.gatesClosed++; }
    if (water.wpHasReducer) waterStat.reducers++;
    if (water.hasAirPipe) waterStat.air++;
    // Если ВМП развернули, «прямо/обратно» у объектов тоже меняется местами.
    if (flipVmp && water.wpComputedFlow) water.wpComputedFlow = -water.wpComputedFlow;
    // ── Замерные станции ────────────────────────────────────────────────
    rb.items.filter(it => it.code === ERP_ITEM_MEASURE_STATION).forEach(it => {
      const t0 = tOfItem(it);
      const descNo = /№\s*([\w*]+)/.exec(it.description || "")?.[1] ?? "";
      const lm = lastMeasure.get(it.id);
      const v = lm && lm.v > 0 ? +lm.v.toFixed(3) : undefined;
      const s = lm && lm.s > 0 ? +lm.s.toFixed(2) : undefined;
      measureStations.push({
        branchId,
        number: (it.f["VentJournal.StationNumber"] ?? "").trim() || descNo,
        location: (it.f["VentJournal.StationLocation"] ?? "").trim(),
        t: +(flipVmp ? 1 - t0 : t0).toFixed(4),
        velocity: v,
        area: s,
        flow: v != null && s != null ? +(v * s).toFixed(2) : undefined,
        date: lm?.date || undefined,
        measureCount: measureCount.get(it.id) ?? 0,
        history: msSortHistory(measureHistory.get(it.id)),
      });
    });
    rb.items.filter(it => it.code === ERP_ITEM_PUMP).forEach(it => {
      const name = (it.description || "").replace(/\s*\(?\d+\s*шт\.?\)?\s*$/i, "").trim() || "Насос";
      const tpl = pumpTemplates.find(p => p.name && name.toUpperCase().startsWith(p.name.toUpperCase()));
      const tplHead = tpl && tpl.pts.length ? Math.max(...tpl.pts.map(p => p.p)) / (1000 * 9.81) : 0;
      const t0 = tOfItem(it);
      pumpItems.push({
        branchId, name,
        parallel: pumpParallelFromName(it.description || ""),
        reversed: it.reversed !== flipVmp,
        head: +(pumpHeadFromName(name) || tplHead).toFixed(1),
        t: +(flipVmp ? 1 - t0 : t0).toFixed(4),
      });
    });
    branches.push(makeBranch(branchId, bFrom, bTo, {
      ...water,
      type: f["Rib.Name"] || rt?.name || "",
      // Сечение и периметр берём как есть — в АэроСети они уже в м² и м.
      // Форму «custom» ставим потому, что файл хранит готовые S и P, а не
      // габариты: любая иная форма заставила бы программу пересчитать S по
      // ширине/высоте и исказить сопротивление.
      shape: "custom",
      area,
      perimeter,
      manualSection: area > 0 && perimeter > 0,
      dh: area > 0 && perimeter > 0 ? +(4 * area / perimeter).toFixed(3) : 0,
      length,
      manualLength: true,   // длина уже известна (задана в файле или по трассе с изломами)
      resistanceMode: useManualR ? "manual" : "alpha",
      manualR: useManualR ? rManual : 0,
      alphaCoef,
      localXi,
      // Название крепи из справочника АэроСети — для подписи в свойствах.
      surface: g.surfaceName || "",
      resistance: rUser,
      flow: flipVmp ? -flow0 : flow0,
      vMax: num(f["Airflow.MaxAirVelocity"], 0) || rt?.vMax || 0,
      horizonId: horizonIdMap.get(rb.horizonId) ?? "",
      lineWidth: Math.max(1, Math.round(rb.thickness / 1.5)),
      // ── Вентилятор ────────────────────────────────────────────────────
      hasFan,
      fanMode,
      fanCurveId,
      fanBladeAngle,
      fanFixedQ,
      fanReverse: fanReverse && !flipVmp,
      fanPressure: hasFan ? fanPressure : 0,
      fanName: hasFan ? (fanItem?.description || f["Rib.Name"] || "Вентилятор") : "",
      // Код картинки 16 — вентилятор местного проветривания, 18 — главный.
      fanType: fanTypeV,
      fanEfficiency: hasFan ? num(ff["Airflow.IdealVentilatorEfficiency"], 0) : 0,
      fanParallel: hasFan ? Math.max(1, Math.round(num(ff["Airflow.VentilatorsInParallel"], 1))) : 1,
      fanRpm,
      fanInstall: fanFree ? FAN_INSTALL_FREE : fanInBulkhead ? "Внутри перемычки" : "Без перемычки",
      // Явно нулевые обороты — вентилятор остановлен (при любой установке).
      ...(fanStoppedInFile ? { fanStopped: true } : {}),
      fanCrossingR: 0,
      fanWindowArea: 0,
      // ── Перемычка ─────────────────────────────────────────────────────
      hasBulkhead,
      // Материал и вид перемычки в АэроСети задаёт КОД картинки — по нему и
      // называем, если у объекта нет своего описания.
      bulkheadName: hasBulkhead
        ? (bulkItemsAll.length > 1
          ? `${bulkItem?.description || erpBulkheadName(bulkItem?.code ?? "") || "Перемычка"} и ещё ${bulkItemsAll.length - 1}`
          : (bulkItem?.description || erpBulkheadName(bulkItem?.code ?? "") || "Перемычка"))
        : "",
      // АэроСеть хранит сопротивление перемычки в кМюрг, а поле bulkheadR —
      // в базовых Мюрг (как при импорте CSV/.cdf3), поэтому умножаем на 1000.
      bulkheadR: hasBulkhead ? bulkR * 1000 : 0,
      bulkheadResMode: hasBulkhead ? "manual" : "project",
      bulkheadManualR: hasBulkhead ? bulkR : 0,
      bulkheadSurveyQ: hasBulkhead ? num(bf["Airflow.BulkheadDepressionSurveyDischarge"], 0) : 0,
      comment: [
        f["Rib.Comment"] ?? "",
        isNotPassable ? "Непроходимая для людей (АэроСеть)" : "",
        g.defaulted ? "Параметры по умолчанию АэроСети: S=10 м², P=11,21 м" : "",
      ].filter(Boolean).join("\n"),
    }));
  }

  log.push(`водопровод: труб ${waterStat.pipes}, задвижек ${waterStat.gates} (закрыто ${waterStat.gatesClosed}), редукционных клапанов ${waterStat.reducers}, насосов ${pumpItems.length}; воздухопровод: ${waterStat.air}`);
  {
    const ns = nodes.filter(nd => nd.fireNodeType && nd.fireNodeType !== "none");
    const cons = ns.filter(nd => nd.fireNodeType === "consumer").length;
    const res = ns.filter(nd => nd.fireNodeType === "reservoir").length;
    log.push(`водопровод, узлы: кранов ${cons}, резервуаров ${res}, соединений ${ns.length - cons - res}`);
    const noHead = pumpItems.filter(p => !(p.head > 0));
    if (noHead.length > 0) warnings.push(`Насосов без известного напора: ${noHead.length} — задайте модель насоса в свойствах значка, иначе расчёт водопровода их не учтёт`);
  }
  log.push(`α: по крепи выработки ${alphaStat.surface}, по крепи типа ${alphaStat.ribType}, из поля выработки ${alphaStat.rib}, по умолчанию ${alphaStat.default}, нет ${alphaStat.none}`);
  log.push(`длина по трассе с изломами: ${bendLengths}; непроходимых: ${notPassable}; лав: ${longwalls}`);
  if (heatersWithR > 0) log.push(`калориферов с заданным сопротивлением: ${heatersWithR} — учтены как местное сопротивление выработки`);
  if (alphaStat.default > 0) {
    warnings.push(`Выработок без сечения и типа: ${alphaStat.default}. Им подставлены параметры АэроСети по умолчанию (S = 10 м², P = 11,21 м, α = 0,004426) — так их считает и сама АэроСеть`);
  }
  if (alphaStat.none > 0) {
    warnings.push(`У ${alphaStat.none} выработок не найден коэффициент α — их сопротивление будет нулевым, проверьте крепь`);
  }
  if (notPassable > 0) {
    warnings.push(`Выработок, отмеченных в АэроСети как непроходимые: ${notPassable} — отметка перенесена в комментарий выработки`);
  }

  if (skipped > 0) warnings.push(`Пропущено выработок без узлов: ${skipped}`);
  log.push(`вентиляторы: по характеристике ${fansByCurve}, из каталога по названию ${fansByCatalog}, постоянный расход ${fansFixedQ}, реверс ${fansReversed}`);
  if (fanCurveIds.size > 0) {
    warnings.push(`Вентиляторов по характеристике: ${fansByCurve}. В справочник рудника добавлено моделей: ${fanCurveIds.size}`);
  }
  if (fansByCatalog > 0) {
    warnings.push(`У ${fansByCatalog} вентиляторов «по характеристике» кривой нет в справочнике файла — характеристика взята из каталога программы по названию (${[...catalogFanNames].join(", ")}); угол лопаток подобран по рабочей точке АэроСети, проверьте его`);
  }
  if (fanCurveMissing > 0) {
    const names = [...missingFanNames].filter(Boolean);
    warnings.push(`У ${fanCurveMissing} вентиляторов «по характеристике» не найдена кривая ни в справочнике файла, ни в каталоге программы — взят постоянный напор из рабочей точки АэроСети${names.length ? ` (${names.slice(0, 5).join(", ")}${names.length > 5 ? " …" : ""})` : ""}`);
  }
  if (fansReversed > 0) warnings.push(`Вентиляторов в реверсе: ${fansReversed}`);
  if (fans > 0) {
    warnings.push(fansInBulkhead > 0
      ? `Вентиляторов, стоящих свободно в выработке (без перемычки): ${fansInBulkhead} — считаются как струйные: подталкивают поток, воздух проходит мимо; остальные — «без перемычки», окно уже входит в сопротивление выработки`
      : "Вентиляторы перенесены с установкой «без перемычки»: сопротивление окна в АэроСети уже входит в сопротивление выработки");
  }
  if (fanBulkheadNotes.length > 0) { // (не заполняется — способ «1» теперь свободная установка)
    warnings.push(`Сопротивление перемычки вентилятора из АэроСети (путь утечек в обход вентилятора) не перенесено — в программе такого параметра нет: ${fanBulkheadNotes.slice(0, 5).join("; ")}${fanBulkheadNotes.length > 5 ? " …" : ""}`);
  }
  if (bulkMulti > 0) warnings.push(`Выработок с несколькими перемычками: ${bulkMulti} — перенесены все, сопротивления складываются`);
  if (bulkWithFan > 0) warnings.push(`Выработок с вентилятором и перемычкой: ${bulkWithFan} — перемычки сохранены`);
  if (ventModeCount > 1) warnings.push(`В проекте ${ventModeCount} режимов проветривания — вентиляторы и перемычки взяты из выбранного «${ventModeName}»`);
  if (nodes.every(n => n.z === 0)) warnings.push("У всех узлов нулевая отметка — в проекте не заданы глубины");

  // ── Позиции ПЛА ───────────────────────────────────────────────────────────
  // Позиции хранятся ОТДЕЛЬНО от сети: это <node itemCode="1001"> внутри
  // <nodes>, тогда как узлы схемы — <ribEndNode>. Путать их нельзя: у позиции
  // нет ни расхода, ни связей, это маркер плана ликвидации аварий.
  //
  // Координаты позиции записаны в той же косоугольной проекции, что и узлы,
  // поэтому прогоняем их через то же обратное преобразование toPlan. Сверено
  // с выгрузкой «ян-positions.csv» той же модели: по всем 12 позициям
  // расхождение 0,00 м, отметки совпадают точно.
  const positions: ErpPosition[] = [];
  let posLinked = 0;
  doc.querySelectorAll("nodes > node").forEach(n => {
    if (n.getAttribute("itemCode") !== NODE_PLAN_POSITION) return;
    const f = readFields(n);
    const ez = num(n.getAttribute("z"));
    const p = toPlan(num(n.getAttribute("x")), num(n.getAttribute("y")), ez);

    // Выработки позиции: список «GUID#True;GUID#True…» в одном поле.
    const ribIds = (f["PlanPosition.PositionRibs"] ?? "")
      .split(";")
      .map(s => s.split("#")[0].trim())
      .filter(Boolean);
    const branchIds = ribIds.map(g => branchIdMap.get(g)).filter((v): v is string => !!v);
    if (branchIds.length > 0) posLinked++;

    // Выноска: <refMark> с привязкой к выработке и смещением ОТ ЕЁ НАЧАЛА
    // в единицах файла. Переводим смещение в долю длины (0…1), как у нас.
    const rm = n.querySelector("refMarks > refMark");
    const leaderGuid = rm?.getAttribute("ribId") ?? "";
    const leaderBranchId = branchIdMap.get(leaderGuid) ?? "";
    let leaderT = 0.5;
    if (leaderBranchId) {
      const br = branches.find(b => b.id === leaderBranchId);
      const offset = num(rm?.getAttribute("segmentOffset"), 0) / s;
      if (br && br.length > 0) leaderT = Math.min(1, Math.max(0, offset / br.length));
      // Ветвь реверсного ВМП развёрнута при импорте — отсчёт от другого конца.
      if (flippedBranches.has(leaderBranchId)) leaderT = 1 - leaderT;
    }

    // В поле Name у АэроСети лежит НОМЕР позиции, а весь текст — в Description.
    // Наша выгрузка пишет туда название и мероприятия, разделённые пустой
    // строкой (см. erpExport). Разбираем обратно: первый абзац — название,
    // остальное — мероприятия. Чужой файл с одним абзацем от этого не страдает:
    // мероприятия просто окажутся пустыми.
    const descr = (f["PlanPosition.Description"] ?? "").replace(/\r/g, "");
    const split = descr.indexOf("\n\n");
    const posName = split >= 0 ? descr.slice(0, split).trim() : descr;
    const posComment = split >= 0 ? descr.slice(split + 2).trim() : "";

    positions.push({
      id: n.getAttribute("id") ?? "",
      number: Math.round(num(f["PlanPosition.Name"], positions.length + 1)),
      name: posName,
      accidentType: accidentTypeName(f["Position.AccidentType"]),
      // Реверсивность закодирована ЧИСЛОМ ГРАНИЦ маркера: у реверсивной
      // позиции граница двойная (BorderCount=2). Отдельного признака в
      // формате нет — проверено на всех позициях эталонной выгрузки.
      positionType: String(f["PlanPosition.BorderCount"] ?? "1").trim() === "2" ? "reverse" : "normal",
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +ez.toFixed(2),
      color: winColorToHex(f["PlanPosition.BackgroundColor"]),
      borderColor: winColorToHex(f["PlanPosition.BorderColor"]),
      // Radius задан в пикселях экрана (96 dpi): диаметр в мм = 2·R·25,4/96.
      // В образцах 24,567 → ровно 13 мм, 5,669 → 3 мм.
      diameter: +(num(f["PlanPosition.Radius"], 0) * 2 * 25.4 / 96).toFixed(1) || 13,
      font: f["PlanPosition.FontFamily"] || "GOST type A",
      branchIds,
      leaderBranchId,
      leaderT: +leaderT.toFixed(3),
      comment: posComment,
    });
  });
  if (positions.length > 0) {
    log.push(`позиций ПЛА: ${positions.length}, с привязанными выработками: ${posLinked}`);
  }

  if (measureStations.length > 0) {
    const withM = measureStations.filter(m => m.flow != null).length;
    log.push(`замерных станций: ${measureStations.length}, с замерами: ${withM}`);
    if (withM < measureStations.length) {
      warnings.push(`Замерных станций без замеров в журнале АэроСети: ${measureStations.length - withM} — перенесены номер и место, расход не заполнен`);
    }
  }
  log.push(`импортировано: узлов ${nodes.length}, ветвей ${branches.length}, вент. ${fans}, перемычек ${bulkheads}, позиций ${positions.length}, замерных станций ${measureStations.length}`);

  // ── Вложенная копия проекта ПВ-Системы ────────────────────────────────────
  // Её кладёт наш экспорт. Берём, только если схема в файле та же, что была
  // при выгрузке: если проект пересохранили в АэроСети и что-то поменяли,
  // копия устарела, и верна уже схема из файла.
  let pvsProject: Record<string, unknown> | undefined;
  const embedEntry = zip.file(ERP_PVS_PROJECT_ENTRY);
  if (embedEntry) {
    try {
      const emb = JSON.parse(await embedEntry.async("string")) as { schemaHash?: string; project?: Record<string, unknown> };
      if (emb.project && emb.schemaHash === hashText(xmlText)) {
        pvsProject = emb.project;
        log.push("найдена полная копия проекта ПВ-Системы — схема восстанавливается без потерь");
      } else if (emb.project) {
        warnings.push("Файл выгружен из ПВ-Системы, но после этого изменён в АэроСети — данные, которых нет в формате АэроСети (водопровод, пожар, подписи), восстановить нельзя.");
      }
    } catch {
      log.push("вложенная копия проекта повреждена — пропущена");
    }
  }

  return {
    pvsProject,
    nodes,
    branches,
    horizons,
    positions,
    bulkheadItems,
    pumpItems,
    measureStations,
    fanCurves: [...fanCurveByTpl.values()].filter((c): c is FanCurve => !!c && fanCurveIds.has(c.id)),
    ventModeName,
    resistanceUnit: rUnit,
    warnings,
    stats: {
      nodes: nodes.length, branches: branches.length, fans, bulkheads,
      horizons: horizons.length, positions: positions.length,
      waterPipes: waterStat.pipes,
      hydrants: nodes.filter(nd => nd.fireNodeType === "consumer").length,
      measureStations: measureStations.length,
    },
    debug: log.join("\n"),
  };
}