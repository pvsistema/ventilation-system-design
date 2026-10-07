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
//   • паспорта вентиляторов (VentilatorTemplateService) записаны в паскалях —
//     напор ВЦ-25 в них 200…490 Па, тогда как рабочая точка той же машины
//     в схеме = 108,4. После ×9,80665 получаем 1063 Па — правдоподобный
//     напор ГВУ, тогда как 108 Па для ВЦ-25 физически заниженно.
// Поэтому напор переводим в паскали умножением на 9,80665 — без этого он
// занижался ровно в 9,8 раза.
//
// А вот СОПРОТИВЛЕНИЕ пересчитывать НЕ надо: наше поле R тоже хранится в
// кМюрг (кгс·с²/м⁸) и умножается на 9,81 уже внутри расчёта (см.
// depression() в aerodynamics.ts). Единицы совпадают — переносим как есть.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from "jszip";
import { makeNode, makeBranch, type TopoNode, type TopoBranch, type Horizon } from "@/lib/topology";
import { ERP_BULKHEAD_CODES, ERP_FAN_LOCAL, erpBulkheadName } from "@/lib/erpItemCodes";
import { buildUserFanCurve } from "@/lib/userFanFit";
import { USER_FAN_PREFIX, type FanCurve } from "@/lib/fanCurves";

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

export interface ErpImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  positions: ErpPosition[];
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
  warnings: string[];
  stats: { nodes: number; branches: number; fans: number; bulkheads: number; horizons: number; positions: number };
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
function readItemFields(el: Element, modeId?: string): Record<string, string> {
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
  const modes = Array.from(el.children).find(c => isTag(c, "ventModesData"));
  const all = modes ? Array.from(modes.children).filter(c => isTag(c, "ventModeData")) : [];
  // Параметры ВЫБРАННОГО режима проветривания (ErpVentModes, isSelected);
  // если у объекта его нет — первый, как раньше.
  const chosen = (modeId ? all.find(m => m.getAttribute("id") === modeId) : undefined) ?? all[0];
  if (chosen) put(Array.from(chosen.children).find(c => isTag(c, "customFields")));
  return out;
}

/**
 * Множитель перевода сопротивления из СИ (Н·с²/м⁸) в кМюрг (кгс·с²/м⁸).
 * Наши поля R хранятся в кМюрг — см. depression() в aerodynamics.ts.
 */
const SI_TO_KMU = 1 / 9.81;

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
  const ribTypes = new Map<string, { name: string; vMax: number; surfaceTypeId: string; crossSectionTypeId: string }>();
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
  // Напор в характеристиках — в ПАСКАЛЯХ (в отличие от напора в схеме), расход
  // — м³/с, мощность — кВт. По трём точкам каждого угла строим нашу кривую
  // H = h0 + h1·Q + h2·Q², как у пользовательского вентилятора.
  interface ErpFanChar { id: string; angle: number; speed: number; reversed: boolean; pts: { q: number; h: number; eta?: number }[] }
  interface ErpFanTpl { id: string; name: string; diameter: number; minSpeed: number; maxSpeed: number; chars: ErpFanChar[] }
  const fanTpls = new Map<string, ErpFanTpl>();
  const fanCharToTpl = new Map<string, string>();
  const vtEntry = zip.file(/VentilatorTemplateService\.DataDocument$/i)[0];
  if (vtEntry) {
    const vtDoc = new DOMParser().parseFromString(decodeXml(await vtEntry.async("uint8array")), "application/xml");
    vtDoc.querySelectorAll("ventilatorTemplate").forEach(t => {
      const id = t.getAttribute("id");
      if (!id) return;
      const chars: ErpFanChar[] = [];
      t.querySelectorAll("characteristic").forEach(c => {
        const cid = c.getAttribute("id") ?? "";
        const pts: { q: number; h: number; eta?: number }[] = [];
        for (let k = 1; k <= 9; k++) {
          const qa = c.getAttribute(`discharge${k}`), ha = c.getAttribute(`pressure${k}`);
          if (qa == null || ha == null) continue;
          const q = num(qa), h = num(ha), w = num(c.getAttribute(`wattage${k}`), 0);
          if (!(q > 0) || !(h >= 0)) continue;
          // КПД по мощности: η = H·Q / (N·1000)
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
  interface RawNode { id: string; x: number; y: number; z: number; name: string; number: string; atm: boolean; t: number; p: number }
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
    });
  });
  log.push(`узлов: ${rawNodes.size}`);
  if (rawNodes.size === 0) throw new Error("В файле не найдено ни одного узла");

  // ── Слои → горизонты ──────────────────────────────────────────────────────
  // Слой АэроСети — это группа выработок (Стволы, Слой 1). Отметку слоя файл
  // не хранит, поэтому z горизонта вычислим ниже как медиану отметок его узлов.
  interface RawItem { code: string; description: string; f: Record<string, string>; reversed: boolean }
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
          code: it.getAttribute("itemCode") ?? "",
          description: it.getAttribute("description") ?? "",
          f: readItemFields(it, ventModeId),
          // Направление действия объекта: isReversed="True" — вентилятор
          // работает против направления выработки (from → to).
          reversed: bool(it.getAttribute("isReversed")),
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

  if (geoScale <= 1e-9) {
    warnings.push("В файле нет масштаба (GeolocationScale) — координаты взяты как есть, длины выработок при этом верны");
  }
  log.push(`проекция: scale=${geoScale.toFixed(6)}, OYAngle=${oyAngle.toFixed(4)}, OYDist=${oyDist}, OZDist=${ozDist}`);

  /**
   * Экранные координаты + отметка → плановые X/Y в метрах.
   * Если ось Y вырождена (sin(OYAngle)·OYDistortion ≈ 0), схема нарисована
   * вертикальным разрезом: плановой Y в ней просто нет, ставим 0.
   */
  const toPlan = (ex: number, ey: number, z: number): { x: number; y: number } => {
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
    const area = hasArea ? num(f["Airflow.CrossSectionArea"], 0) : (defaulted ? ERP_DEFAULT_AREA : 0);

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
  const rUnit: "kmu" | "si" = requestedUnit === "auto"
    ? detectErpResistanceUnit(rawBranches.map(rb => {
        const g = geoms.get(rb)!;
        return {
          r: num(rb.f["Airflow.UserDefinedResistance"], 0),
          alpha: g.alphaSi,
          area: g.area,
          perimeter: g.perimeter,
          length: g.length,
        };
      }))
    : requestedUnit;
  // Наши поля R — в кМюрг. Значения из СИ делим на 9,81, кМюрг берём как есть.
  const rFactor = rUnit === "si" ? SI_TO_KMU : 1;
  log.push(requestedUnit === "auto"
    ? `Единицы R: автоопределение → ${rUnit === "si" ? "СИ (Н·с²/м⁸), делим на 9,81" : "кМюрг, без пересчёта"}`
    : `Единицы R: задано вручную → ${rUnit === "si" ? "СИ (Н·с²/м⁸), делим на 9,81" : "кМюрг, без пересчёта"}`);

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
  /** Ветви, развёрнутые при импорте (реверсный ВМП). */
  const flippedBranches = new Set<string>();
  const alphaStat = { surface: 0, ribType: 0, rib: 0, default: 0, none: 0 };
  let bendLengths = 0, notPassable = 0, longwalls = 0;

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
    // α: из СИ (файл) в наши рудничные единицы ×10⁻⁴ — см. константу G.
    const alphaCoef = g.alphaSi > 0 ? +(g.alphaSi / G * 1e4).toFixed(4) : 0;
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
    const rSurvey = rMode === "1" && surveyQ > 0 && surveyDP > 0
      ? +(surveyDP / (surveyQ * surveyQ) * rFactor).toFixed(6) : 0;
    const useManualR = (rMode === "2" && rUser > 0) || rSurvey > 0;
    const rManual = rSurvey > 0 ? rSurvey : rUser;

    // Объект на ветви опознаём по его собственным полям (надёжно на любом
    // проекте), а код itemCode — как запасной признак для известных картинок.
    const fanItem = rb.items.find(it =>
      ITEM_FAN.has(it.code) || FAN_FIELDS.some(k => it.f[k] != null && it.f[k] !== ""));
    const bulkItem = rb.items.find(it =>
      ITEM_BULKHEAD.has(it.code) || BULKHEAD_FIELDS.some(k => it.f[k] != null && it.f[k] !== ""));
    const hasFan = !!fanItem;
    const hasBulkhead = !!bulkItem && !hasFan;   // ВМП стоит «в» перемычке — это вентилятор
    if (hasFan) fans++;
    if (hasBulkhead) bulkheads++;

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
    const fanSumKgs = fanItems.reduce((s, it) =>
      s + (num(it.f["Airflow.FanPressure"], 0) || num(it.f["Airflow.IdealVentilatorPressure"], 0)), 0);
    const fanPressureKgs = fanSumKgs
      || num(f["Airflow.FanPressure"], 0)
      || num(f["Airflow.IdealVentilatorPressure"], 0);
    // ── Направление вентилятора ─────────────────────────────────────────
    // Реверс: атрибут isReversed="True" у объекта (так пишет и наш экспорт).
    // Отрицательный напор в файле — тоже работа против направления выработки:
    // наш расчёт берёт max(0, напор), поэтому знак переводим в реверс, а напор
    // делаем положительным. Иначе такой вентилятор просто «выключался».
    const fanReversedAttr = !!fanItem?.reversed;
    const fanPressureSigned = fanPressureKgs * PA_PER_KGS_M2;
    const fanReverse = hasFan && (fanReversedAttr !== (fanPressureSigned < 0));
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
        fanCurveMissing++;
      }
    } else if (hasFan && vType === "2") {
      const q = num(ff["Airflow.VentilatorFixedQ"], 0);
      if (q > 0) { fanMode = "fixed"; fanFixedQ = q; fansFixedQ++; }
    }
    if (hasFan && fanReverse) fansReversed++;

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
    const bulkR = +((num(bf["Airflow.BulkheadUserDefinedResistance"], 0)
      || num(bf["Airflow.BulkheadCalculatedResistance"], 0)
      || num(f["Airflow.BulkheadUserDefinedResistance"], 0)
      || num(f["Airflow.BulkheadCalculatedResistance"], 0)) * rFactor).toFixed(6);

    // Запоминаем соответствие «GUID выработки в файле → наш id»: по нему
    // позиции ПЛА ниже находят свои выработки и точку привязки выноски.
    const branchId = branchIdOf.get(rb)!;
    branchIdMap.set(rb.id, branchId);
    branches.push(makeBranch(branchId, bFrom, bTo, {
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
      // ── Перемычка ─────────────────────────────────────────────────────
      hasBulkhead,
      // Материал и вид перемычки в АэроСети задаёт КОД картинки — по нему и
      // называем, если у объекта нет своего описания.
      bulkheadName: hasBulkhead ? (bulkItem?.description || erpBulkheadName(bulkItem?.code ?? "") || "Перемычка") : "",
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

  log.push(`α: по крепи выработки ${alphaStat.surface}, по крепи типа ${alphaStat.ribType}, из поля выработки ${alphaStat.rib}, по умолчанию ${alphaStat.default}, нет ${alphaStat.none}`);
  log.push(`длина по трассе с изломами: ${bendLengths}; непроходимых: ${notPassable}; лав: ${longwalls}`);
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
  log.push(`вентиляторы: по характеристике ${fansByCurve}, постоянный расход ${fansFixedQ}, реверс ${fansReversed}`);
  if (fanCurveIds.size > 0) {
    warnings.push(`Вентиляторов по характеристике: ${fansByCurve}. В справочник рудника добавлено моделей: ${fanCurveIds.size}`);
  }
  if (fanCurveMissing > 0) {
    warnings.push(`У ${fanCurveMissing} вентиляторов «по характеристике» не найдена кривая в справочнике файла — взят постоянный напор из рабочей точки АэроСети`);
  }
  if (fansReversed > 0) warnings.push(`Вентиляторов в реверсе: ${fansReversed}`);
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

  log.push(`импортировано: узлов ${nodes.length}, ветвей ${branches.length}, вент. ${fans}, перемычек ${bulkheads}, позиций ${positions.length}`);

  return {
    nodes,
    branches,
    horizons,
    positions,
    fanCurves: [...fanCurveByTpl.values()].filter((c): c is FanCurve => !!c && fanCurveIds.has(c.id)),
    ventModeName,
    resistanceUnit: rUnit,
    warnings,
    stats: {
      nodes: nodes.length, branches: branches.length, fans, bulkheads,
      horizons: horizons.length, positions: positions.length,
    },
    debug: log.join("\n"),
  };
}