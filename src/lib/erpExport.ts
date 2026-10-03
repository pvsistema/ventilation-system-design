// ─────────────────────────────────────────────────────────────────────────────
// Экспорт схемы в проект АэроСеть (.erp)
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ НЕ ПУТАТЬ С ДРУГИМИ ЭКСПОРТАМИ. Это ЗАПИСЬ родного формата АэроСети —    │
// │ обратная операция к erpImport.ts. Рядом живут:                           │
// │   • csvExport.ts   — табличная выгрузка (АэроСеть и Вентиляция 2.0);     │
// │   • excelExport.ts — параметры выработок в Excel;                        │
// │   • desktopPrint.ts — печать и PDF.                                      │
// │ Общий код с ними НЕ заводить: там таблицы, здесь бинарный контейнер со   │
// │ своей проекцией и своими единицами.                                      │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Формат контейнера (проверено на реальных проектах «Якутское» и «БГОК»):
//   .erp — это ZIP, внутри которого
//   • [Content_Types].xml — служебное описание, кодировка UTF-8 с BOM;
//   • schema.xml          — сама схема, кодировка UTF-16LE с BOM;
//   • documents.xml       — список вложений и справочников (type="2");
//   • docs/*.DataDocument — справочники, тоже UTF-16LE. Пишем два:
//     ErpVentModes (режим проветривания) и VentilatorTemplateService
//     (характеристики вентиляторов).
//
// СЛОИ = наши горизонты. ОБЪЕКТЫ НА ВЫРАБОТКАХ — по коду картинки из
// erpItemCodes.ts (ГВУ/ВМП, материал и вид перемычки), а их рабочие
// параметры — в <ventModesData>, как в проектах, созданных в АэроСети.
// Кодировка критична: АэроСеть читает эти части строго как UTF-16LE, и файл,
// записанный в UTF-8, она открыть не сможет.
//
// ЕДИНИЦЫ. Записываем ровно то, что ждёт АэроСеть, обращая пересчёт импорта:
//   • напор вентилятора — в кгс/м² (делим паскали на 9,80665);
//   • сопротивления     — в кМюрг, как у нас, без пересчёта.
//
// КООРДИНАТЫ. АэроСеть хранит не план, а уже спроецированные («экранные»)
// координаты косоугольной проекции. Поэтому здесь обращена формула из
// erpImport.ts: там из файла получали план, тут из плана получаем файл.
// Прямое преобразование (как в импорте):
//     Y_план = -(ey/s + OZ·z) / (sin(OYAngle)·OY)
//     X_план =  ex/s - cos(OYAngle)·OY·Y_план
// Отсюда обратное, которое и пишем:
//     ex = (X_план + cos(OYAngle)·OY·Y_план) · s
//     ey = (-Y_план · sin(OYAngle)·OY - OZ·z) · s
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from "jszip";
import type { TopoNode, TopoBranch, Horizon } from "@/lib/topology";
import type { Position } from "@/lib/positions";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { bulkheadSymbolsOf, symbolBulkheadR, branchOwnBulkheadR, type BulkheadRef } from "@/lib/bulkheadResistance";
import { fanWindowRkMurg } from "@/lib/bulkheads";
import { getFanById, fanCurveAtAngle, fanHAngle, fanEfficiencyAngle, type FanCurve } from "@/lib/fanCurves";
import { resistanceFromAlpha } from "@/lib/aerodynamics";
import { OVERVIEW_HORIZON_ID } from "@/lib/topology";
import { LEGEND_TYPES } from "@/lib/schemaSymbols";
import {
  ERP_FAN_MAIN, ERP_FAN_LOCAL, erpCodeForSymbol, erpCodeForName,
  isBlindKind, isWindowKind, type ErpBulkheadCode,
} from "@/lib/erpItemCodes";

/**
 * Режим проветривания, в который пишутся параметры вентиляторов и перемычек.
 *
 * ГЛАВНОЕ, ЧТО ВЫЯСНИЛОСЬ ПО ЭТАЛОНУ АэроСети: тип вентилятора, его
 * характеристика, обороты, а у перемычек — способ задания и величина R
 * хранятся НЕ в полях объекта, а в <ventModesData><ventModeData id="режим">.
 * Поля объекта (<customFields>) — это только результаты и оформление.
 * Раньше мы писали всё в customFields, и АэроСеть брала свои значения по
 * умолчанию: любой вентилятор — ГВУ без характеристики, любая перемычка —
 * расчётная по коду картинки. Сам режим объявляется в справочнике
 * docs/ErpVentModes.DataDocument.
 */
const VENT_MODE_ID = "b9c81745-fe27-4613-bb7a-c586893f561f";
const VENT_MODE_NAME = "Режим проветривания 1";

/** Перевод давления Па → кгс/м² (мм вод. ст.): формат АэроСети. */
const PA_PER_KGS_M2 = 9.80665;

/**
 * Параметры проекции, которые пишем в файл.
 *
 * Берём те же значения, что стоят в проектах АэроСети по умолчанию: вид
 * «в изометрии» с наклоном оси Y 150° и растяжением по вертикали. Масштаб
 * 0.26458333 — это «метров в единице» (единица = 1/96 дюйма), стандартное
 * значение свежих версий программы.
 */
const GEO_SCALE = 0.26458333;
const OY_ANGLE = 2.61799387799149;   // 150° в радианах
const OY_DIST = 1;
const OZ_DIST = 7.5;

/**
 * Экранирование текста для XML-атрибутов.
 *
 * Переводы строк экранируются числовой ссылкой намеренно: по правилам XML
 * разбор атрибута заменяет сырой перенос строки на пробел, и многострочный
 * текст (мероприятия позиции ПЛА) слипся бы в одну строку. &#10; переживает
 * разбор и возвращается настоящим переносом.
 */
function esc(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "")
    .replace(/\n/g, "&#10;");
}

/** Число в вид, понятный АэроСети (точка-разделитель, без экспоненты). */
function n(v: number | undefined, digits = 6): string {
  const x = Number(v);
  if (!isFinite(x)) return "0";
  return String(+x.toFixed(digits));
}

/**
 * Сопротивление — без потери значащих цифр.
 *
 * Сопротивления выработок бывают порядка 10⁻⁵ кМюрг: при toFixed(6) от
 * «2,1·10⁻⁵» оставалось «0,000021» — 2 значащие цифры, ошибка до 2 %, а у
 * совсем коротких выработок R округлялось до нуля. Пишем 8 значащих цифр,
 * но без экспоненты (обычная десятичная запись читается любой программой).
 */
function nr(v: number | undefined): string {
  const x = Number(v);
  if (!isFinite(x) || x <= 0) return "0";
  const digits = Math.min(20, Math.max(6, Math.ceil(-Math.log10(x)) + 8));
  return String(+x.toFixed(digits)).includes("e")
    ? x.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")
    : String(+x.toFixed(digits));
}

/** Булево в вид «True»/«False», как в файлах АэроСети. */
function b(v: boolean | undefined): string {
  return v ? "True" : "False";
}

/**
 * Дата, с которой объект существует в модели. АэроСеть ведёт схему во
 * времени («вехи»), и у каждого объекта дата ввода обязательна. Ставим
 * заведомо раннюю — тогда объект виден в любой веху проекта.
 */
const START_DATE = "2000-01-01";

/**
 * Обязательные атрибуты размещения объекта на выработке (<ribItem>).
 *
 * Без них АэроСеть отказывается открывать файл с ошибкой вида
 * «Не найден обязательный атрибут (узел = ribItem, атрибут = segmentIndex)»:
 * её читатель требует эти атрибуты, даже если объект один и стоит посередине.
 *   • segmentIndex  — номер звена ломаной выработки; у нас выработка всегда
 *     прямая, поэтому единственное звено с номером 0;
 *   • segmentOffset — смещение от начала звена В ЕДИНИЦАХ ЭКРАНА вдоль
 *     СПРОЕЦИРОВАННОЙ линии (сверено с эталоном: смещение всегда в пределах
 *     экранной длины выработки). Раньше писали «метры / масштаб» — из-за
 *     растяжения по вертикали значок наклонных выработок уезжал за её конец;
 *   • scale         — размер значка (в образцах 0,125…0,5);
 *   • startDate     — дата ввода объекта.
 */
function itemAttrs(offsetScreen: number, scale: number, reversed = false): string {
  return (reversed ? ` isReversed="True"` : "")
    + ` segmentIndex="0" segmentOffset="${n(Math.max(0, offsetScreen), 6)}" scale="${n(scale, 3)}" startDate="${START_DATE}"`;
}

/** Значки вентиляторов на схеме — по ним берём положение и направление. */
const FAN_SYMBOL_TYPES = new Set(["fan", "fan_local", "fan_axial", "fan_recirculate", "fan_stationary"]);

/** Обёртка параметров объекта для режима проветривания. */
function ventModeXml(type: "Fans" | "Bulkheads", fields: string): string {
  return `<ventModesData><ventModeData id="${VENT_MODE_ID}" type="${type}">`
    + `<customFields><fields>${fields}</fields></customFields>`
    + `</ventModeData></ventModesData>`;
}

/**
 * Вентилятор на выработке.
 *
 * ТИП. АэроСеть различает ГВУ и ВМП КОДОМ КАРТИНКИ: 18 — главный,
 * 16 — местного проветривания (у ВМП в эталоне ещё поля ForceFan… и
 * ExhaustFan… для расчёта тупика). Раньше всем писали 18 — поэтому ВМП становились ГВУ.
 *
 * РЕЖИМ РАБОТЫ (Airflow.VentilatorType в ventModeData, сверено с эталоном):
 *   0 — постоянная депрессия: напор в IdealVentilatorPressure, кгс/м²;
 *   1 — по характеристике: VentilatorTemplateId + VentilatorCharacteristicId
 *       (ссылки в справочник docs/VentilatorTemplateService);
 *   2 — постоянный расход (VentilatorFixedQ).
 * Остановленный вентилятор пишем как «постоянная депрессия 0».
 */
function fanItemXml(br: TopoBranch, offset: number, reversed: boolean): string {
  const isVmp = br.fanType === "ВМП";
  const code = isVmp ? ERP_FAN_LOCAL : ERP_FAN_MAIN;
  const curve = br.fanMode === "curve" ? getFanById(br.fanCurveId) : undefined;
  const tpl = curve ? fanTemplateFor(curve, br) : undefined;
  const stopped = !!br.fanStopped;
  const vType = stopped ? 0 : br.fanMode === "fixed" ? 2 : tpl ? 1 : 0;
  const hKgs = (stopped ? 0 : (br.fanPressure ?? 0)) / PA_PER_KGS_M2;
  const name = br.fanName || curve?.name || (isVmp ? "ВМП" : "Вентилятор");
  const diam = curve?.diameter ?? 0;

  const own = `<field name="AirControl.IsUnderControl" value="False" />`
    + `<field name="AirControl.VentilatorMaxPressure" value="10.1971621297793" />`
    + `<field name="Notes" value="${esc(br.fanType ?? "")}" />`
    + `<field name="Airflow.FanPressure" value="${n(hKgs)}" />`
    + (isVmp
      // Параметры расчёта тупика у ВМП: в эталоне есть всегда, без них
      // АэроСеть открывает свойства ВМП с пустыми полями.
      ? `<field name="StopeVentMethod" value="0" />`
        + `<field name="ForceFanDuctL" value="${n(br.length ?? 50, 2)}" />`
        + `<field name="ForceFanDuctSectionL" value="10" />`
        + `<field name="ForceFanDuctD" value="${n(br.pipeDiameter || 0.5, 3)}" />`
        + `<field name="ForceFanDuct90Turns" value="0" />`
        + `<field name="ForceFanDuct45Turns" value="0" />`
        + `<field name="ForceFanDuctType" value="0" />`
        + `<field name="ForceFanDuctDeterioration" value="1" />`
        + `<field name="ConsumerLocation" value="0" />`
        + `<field name="ForceFanSpeed" value="0" />`
        + `<field name="ExhaustFanSpeed" value="0" />`
        + `<field name="ForceFanCount" value="1" />`
        + `<field name="ExhaustFanCount" value="1" />`
        + `<field name="ForceFanInstallation" value="0" />`
        + `<field name="ExhaustFanInstallation" value="0" />`
      : "");

  const mode = `<field name="Airflow.VentilatorType" value="${vType}" />`
    + `<field name="Airflow.VentilatorFixedQ" value="${n(vType === 2 ? (br.fanFixedQ ?? 0) : 0, 4)}" />`
    + `<field name="Airflow.IdealVentilatorPressure" value="${n(vType === 0 ? hKgs : 0)}" />`
    + `<field name="Airflow.IdealVentilatorEfficiency" value="${n(br.fanEfficiency || 0.65, 4)}" />`
    + `<field name="Airflow.FixedQFanEfficiency" value="${n(br.fanEfficiency || 0.65, 4)}" />`
    + `<field name="Airflow.MixingChamberDiameter" value="${n(diam > 0 ? diam * 1.25 : 1.5, 3)}" />`
    // Значения по умолчанию АэроСети (как в эталоне). Окно ГВУ «внутри
    // перемычки» у нас уже входит в R выработки (fanInstallR), поэтому
    // способ установки здесь не меняем — иначе окно учлось бы дважды.
    + `<field name="Airflow.VentilatorBulkheadResistance" value="1000" />`
    + `<field name="Airflow.VentilatorQIsUserDefined" value="False" />`
    + `<field name="Airflow.VentilatorUserDefinedQ" value="5" />`
    + `<field name="Airflow.HasConfusor" value="False" />`
    + `<field name="Airflow.ConfusorLength" value="1" />`
    + `<field name="Airflow.ConfusorDiameter" value="${n(diam > 0 ? diam : 1.2, 3)}" />`
    + `<field name="Airflow.VentilatorSpeed" value="${n(br.fanRpm || curve?.rpmNominal || 0, 1)}" />`
    + `<field name="Airflow.VentilatorsInParallel" value="${Math.max(1, Math.round(br.fanParallel ?? 1))}" />`
    + `<field name="Airflow.VentilatorInstallationType" value="0" />`
    + (tpl ? `<field name="Airflow.VentilatorTemplateId" value="${tpl.templateId}" />`
      + `<field name="Airflow.VentilatorCharacteristicId" value="${tpl.characteristicId}" />` : "");

  return `<ribItem id="${guidFrom("fan:" + br.id)}" itemCode="${code}" description="${esc(name)}"${itemAttrs(offset, 0.25, reversed)}>`
    + `<customFields><fields>${own}</fields></customFields>`
    + ventModeXml("Fans", mode)
    + `</ribItem>`;
}

/**
 * Перемычка / дверь / окно на выработке.
 *
 * Код картинки задаёт и вид, и МАТЕРИАЛ (см. erpItemCodes.ts). Способ
 * задания R и само число — в ventModeData (как в эталоне):
 *   AirResistanceCalculationType = 2 → BulkheadUserDefinedResistance (кМюрг);
 * для окон дополнительно пишется площадь VentWindowArea, для глухих —
 * воздухопроницаемость. R пишем всегда «заданным»: так АэроСеть посчитает
 * ровно ту сеть, что и мы, независимо от своих формул окна.
 */
function bulkheadItemXml(p: {
  id: string; code: ErpBulkheadCode; r: number; windowArea: number;
  branchArea: number; name: string; offset: number;
}): string {
  const blind = isBlindKind(p.code.kind);
  const windowed = isWindowKind(p.code.kind);
  // Площадь окна: у открытой двери без площади — проём во всё сечение.
  const winA = windowed ? (p.windowArea > 0.001 ? p.windowArea : p.branchArea) : 0;
  // Воздухопроницаемость A = 1/(S·√(R·1000)) — обратная к solidBulkheadRkMurg.
  const perm = blind && p.r > 0 && p.branchArea > 0
    ? 1 / (p.branchArea * Math.sqrt(p.r * 1000)) : 0;

  const own = `<field name="AirControl.IsUnderControl" value="False" />`
    + `<field name="AirControl.BulkheadMinQ" value="0" />`
    + `<field name="Notes" value="${esc(p.name)}" />`
    + `<field name="Airflow.BulkheadCalculatedResistance" value="${nr(p.r)}" />`
    + (blind ? `<field name="Position.BulkheadIsNotPassable" value="${p.code.kind === "solid" ? "True" : "False"}" />`
      + `<field name="SealDefinitionType" value="0" /><field name="SealQ" value="0" />`
      + `<field name="SealDeltaP" value="0.509858106488964" /><field name="SealType" value="0" />`
      + `<field name="MineSectionQ" value="100" />` : "");

  const mode = `<field name="Airflow.AirResistanceCalculationType" value="2" />`
    + (windowed ? `<field name="Airflow.VentWindowArea" value="${n(winA, 4)}" />` : "")
    + (blind ? `<field name="Airflow.BlindBulkheadPermeabilityIsUserDefined" value="${perm > 0 ? "True" : "False"}" />`
      + `<field name="Airflow.BlindBulkheadUserDefinedPermeability" value="${nr(perm)}" />` : "")
    + `<field name="Airflow.BulkheadUserDefinedResistance" value="${nr(p.r)}" />`
    + `<field name="Airflow.BulkheadDepressionSurveyDischarge" value="0" />`
    + `<field name="Airflow.BulkheadDepressionDelta" value="0" />`;

  return `<ribItem id="${p.id}" itemCode="${p.code.code}"${p.name ? ` description="${esc(p.name)}"` : ""}${itemAttrs(p.offset, 0.15)}>`
    + `<customFields><fields>${own}</fields></customFields>`
    + ventModeXml("Bulkheads", mode)
    + `</ribItem>`;
}

// ── Справочник вентиляторов (docs/VentilatorTemplateService) ──────────────
// Характеристика в АэроСети задаётся ТРЕМЯ точками (Q, H в Па, N в кВт) на
// каждый угол лопаток. Строим их по нашей кривой при номинальных оборотах:
// начало, середина и конец паспортной зоны.
interface FanTemplateRef { templateId: string; characteristicId: string }
const fanTemplates = new Map<string, { curve: FanCurve; angles: Set<number> }>();

function fanTemplateFor(curve: FanCurve, br: TopoBranch): FanTemplateRef {
  const angle = curve.bladeAngles.length > 0
    ? (curve.bladeAngles.includes(br.fanBladeAngle) ? br.fanBladeAngle
      : curve.bladeAngles.reduce((a, c) => Math.abs(c - br.fanBladeAngle) < Math.abs(a - br.fanBladeAngle) ? c : a))
    : 0;
  const entry = fanTemplates.get(curve.id) ?? { curve, angles: new Set<number>() };
  entry.angles.add(angle);
  fanTemplates.set(curve.id, entry);
  return {
    templateId: guidFrom("fantpl:" + curve.id),
    characteristicId: guidFrom(`fanchr:${curve.id}:${angle}`),
  };
}

function ventilatorTemplatesXml(): string {
  const items = [...fanTemplates.values()].map(({ curve, angles }) => {
    const chars = [...angles].sort((a, b) => a - b).map(angle => {
      const e = fanCurveAtAngle(curve, curve.bladeAngles.length ? angle : undefined);
      const a = curve.bladeAngles.length ? angle : undefined;
      // Правый край берём там, где напор ещё ощутим (≥ 10 % от левого):
      // у некоторых аппроксимаций на qMax напор уже нулевой, и АэроСеть
      // получила бы вырожденную характеристику.
      const h0 = Math.max(1, fanHAngle(curve, e.qMin, a));
      let qEnd = e.qMax;
      while (qEnd > e.qMin * 1.2 && fanHAngle(curve, qEnd, a) < h0 * 0.1) qEnd -= (e.qMax - e.qMin) / 50;
      const qs = [e.qMin, (e.qMin + qEnd) / 2, qEnd];
      const pts = qs.map((q, i) => {
        const h = Math.max(0, fanHAngle(curve, q, a));
        const eta = Math.max(0.05, fanEfficiencyAngle(curve, q, a));
        const kw = h * q / eta / 1000;
        return `discharge${i + 1}="${n(q, 4)}" pressure${i + 1}="${n(h, 4)}" wattage${i + 1}="${n(kw, 3)}"`;
      }).join(" ");
      return `<characteristic id="${guidFrom(`fanchr:${curve.id}:${angle}`)}" bladeAngle="${n(angle, 2)}" speed="${n(curve.rpmNominal || curve.rpmMax, 0)}" ${pts} isReversed="False" />`;
    }).join("");
    return `<ventilatorTemplate id="${guidFrom("fantpl:" + curve.id)}" name="${esc(curve.name)}" diameter="${n(curve.diameter, 3)}" minSpeed="${n(curve.rpmMin, 0)}" maxSpeed="${n(curve.rpmMax || curve.rpmNominal, 0)}">`
      + `<characteristics>${chars}</characteristics></ventilatorTemplate>`;
  }).join("");
  return `<ventilatorsCatalog><ventilators>${items}</ventilators></ventilatorsCatalog>`;
}


/** HEX-цвет («#e53e3e») → знаковое целое ARGB, как хранит АэроСеть. */
function hexToWinColor(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return -65536; // красный по умолчанию
  const rgb = parseInt(m[1], 16);
  // 0xFF000000 | rgb, приведённое к знаковому 32-битному
  return (0xff000000 | rgb) | 0;
}

/** HEX-цвет → строка «#FFRRGGBB», в таком виде записаны цвета слоёв. */
function hexToArgbString(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  return "#FF" + (m ? m[1].toUpperCase() : "000000");
}

/**
 * Детерминированный GUID из нашего id.
 *
 * АэроСеть опознаёт объекты по GUID, а у нас id вида «n_erp_12» или «b3».
 * Генерируем из строки устойчивый (не случайный) GUID: при повторном
 * экспорте того же проекта идентификаторы не «поедут», и файл останется
 * сравнимым с предыдущей выгрузкой.
 */
function guidFrom(seed: string): string {
  // Простая хеш-функция FNV-1a, четыре независимых прохода дают 128 бит.
  const hash = (str: string, salt: number): number => {
    let h = 0x811c9dc5 ^ salt;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  const p = [hash(seed, 1), hash(seed, 2), hash(seed, 3), hash(seed, 4)]
    .map(x => x.toString(16).padStart(8, "0"));
  const hex = p.join("");
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join("-");
}

/** Текст → UTF-16LE с BOM: в этой кодировке АэроСеть хранит части архива. */
function toUtf16le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff; out[1] = 0xfe;                 // BOM
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(2 + i * 2, text.charCodeAt(i), true);
  }
  return out;
}

export interface ErpExportOptions {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  positions?: Position[];
  /** Название проекта (попадёт в имя слоя по умолчанию). */
  projectName?: string;
  /** Переносить вентиляторы на выработках. По умолчанию да. */
  withFans?: boolean;
  /** Переносить перемычки. По умолчанию да. */
  withBulkheads?: boolean;
  /** Переносить позиции ПЛА. По умолчанию да. */
  withPositions?: boolean;
  /**
   * Переносить результаты расчёта — расходы воздуха. Сопротивления сюда НЕ
   * относятся: это исходные данные сети, и они пишутся всегда (иначе АэроСеть
   * пересчитала бы вентрубы и выработки с местными сопротивлениями по α и
   * получила бы другую сеть).
   */
  withResults?: boolean;
  /**
   * Значки схемы. Перемычки и двери у нас почти всегда заданы ЗНАЧКОМ, и их
   * сопротивление живёт в SchemaSymbol.bk*, а не в ветви. Без значков в файл
   * уходило только поле ветви — устаревшее или нулевое.
   */
  schemaSymbols?: SchemaSymbol[];
  /** Справочник перемычек рудника — нужен для R значков «по проекту». */
  mineBulkheads?: BulkheadRef[];
}

/**
 * Сопротивление окна ГВУ «внутри перемычки» + перемычки вентилятора, кМюрг.
 * Дословно та же логика, что в buildBranchPayload (useCadPage) и get_R
 * решателя — иначе выработка с ГВУ в АэроСети окажется без сопротивления окна.
 */
function fanInstallR(b: TopoBranch): number {
  if (!b.hasFan || (b.fanInstall ?? "Внутри перемычки") !== "Внутри перемычки") return 0;
  const curve = b.fanMode === "curve" ? getFanById(b.fanCurveId) : undefined;
  const autoWin = curve && curve.diameter > 0 ? Math.PI * curve.diameter * curve.diameter / 4 : 0;
  const winA = (b.fanWindowArea ?? 0) > 0.001 ? (b.fanWindowArea ?? 0) : autoWin;
  const rWin = winA > 0.001 ? fanWindowRkMurg(winA, b.area ?? 0) : 0;
  const rCross = (b.fanCrossingR ?? 0) / 1000;   // Мюрг → кМюрг, как в get_R
  return rWin + rCross;
}

/**
 * Собирает .erp и возвращает его как Blob — готовый к сохранению файл.
 */
export async function buildErp(opts: ErpExportOptions): Promise<Blob> {
  const {
    nodes, branches, projectName = "ПВ-Система",
    withFans = true, withBulkheads = true, withPositions = true, withResults = true,
  } = opts;
  const positions = withPositions ? (opts.positions ?? []) : [];

  const s = 1 / GEO_SCALE;                    // единиц на метр
  const sinOY = Math.sin(OY_ANGLE) * OY_DIST;
  const cosOY = Math.cos(OY_ANGLE) * OY_DIST;

  /** План (метры) + отметка → экранные координаты файла. Обратно к импорту. */
  const toScreen = (x: number, y: number, z: number) => ({
    ex: (x + cosOY * y) * s,
    ey: (-y * sinOY - OZ_DIST * z) * s,
  });

  const nodeGuid = new Map(nodes.map(nd => [nd.id, guidFrom("node:" + nd.id)]));
  const nodeById = new Map(nodes.map(nd => [nd.id, nd]));
  fanTemplates.clear();
  let stationNo = 0;

  // ── Узлы ────────────────────────────────────────────────────────────────
  // В АэроСети отметка узла лежит в поле RibEndNode.Depth, а сами x/y уже
  // спроецированы. Пишем оба вида координат согласованно, иначе программа
  // нарисует схему «винтом».
  const nodeIndex = new Map(nodes.map((nd, i) => [nd.id, i]));
  const nodeXmlOf = (nd: TopoNode) => {
    const i = nodeIndex.get(nd.id) ?? 0;
    const p = toScreen(nd.x, nd.y, nd.z);
    return `<ribEndNode id="${nodeGuid.get(nd.id)}" x="${n(p.ex)}" y="${n(p.ey)}" name="${esc(nd.name ?? "")}" number="${esc(nd.number || String(i + 1))}">`
      + `<customFields><fields>`
      + `<field name="RibEndNode.Depth" value="${n(nd.z, 3)}" />`
      + `<field name="HasAtmosphereConnection" value="${b(nd.atmosphereLink)}" />`
      + `<field name="Heat.AirTemparature" value="${n(nd.airTemp ?? 20, 2)}" />`
      + `<field name="Heat.WallTemperature" value="${n(nd.airTemp ?? 20, 2)}" />`
      + `<field name="ReducedAirPressure" value="${n(nd.reducedPressure ?? 0, 3)}" />`
      + `<field name="Accident.ExplosionPressure" value="0" />`
      + `</fields></customFields></ribEndNode>`;
  };

  // ── Выработки ───────────────────────────────────────────────────────────
  // Пишем геометрию, сопротивление и объекты на ветви (вентилятор, перемычка).
  // Способ задания R: 2 = «задано пользователем», иначе АэроСеть пересчитает
  // его сама по α и сечению — так ведёт себя и наш импорт в обратную сторону.
  const symbols = opts.schemaSymbols ?? [];
  const bulkheadsMap = new Map((opts.mineBulkheads ?? []).map(mb => [mb.id, mb]));

  const branchXmlList = branches.map((br, i) => {
    const from = nodeGuid.get(br.fromId);
    const to = nodeGuid.get(br.toId);
    if (!from || !to) return "";

    // ── СОПРОТИВЛЕНИЕ ВЫРАБОТКИ ─────────────────────────────────────────────
    // Пишем РОВНО то R, с которым считает наш решатель (b.resistance + окно ГВУ
    // «внутри перемычки»). Раньше при способе ≠ «вручную» в файл уходил только
    // α, и АэроСеть сама пересчитывала R = α·P·L/S³. Для большинства выработок
    // это совпадает, но НЕ для:
    //   • вентиляционных труб (способ «pipe»: R = 6,48·α·L/D⁵ по α ТРУБЫ) —
    //     АэроСеть считала их как горную выработку с α крепи, R ошибалось в
    //     5…25 раз (66 нитей става на «Якутском»);
    //   • выработок с местными сопротивлениями ξ (R_мест терялось);
    //   • ветвей ГВУ, установленных в перемычке (R окна терялось целиком);
    //   • способа «по шероховатости».
    // Поэтому α-путь оставляем только когда он даёт то же число, а иначе
    // пишем R как «заданное пользователем» (AirResistanceCalculationType=2).
    const extraR = fanInstallR(br);
    const ribR = (br.resistance ?? 0) + extraR;
    const alphaR = resistanceFromAlpha(br.alphaCoef ?? 0, br.perimeter ?? 0, br.length ?? 0, br.area ?? 0);
    const alphaMatches = (br.resistanceMode === "alpha" || br.resistanceMode === "surface")
      && extraR === 0 && ribR > 0 && Math.abs(alphaR - ribR) <= ribR * 1e-3;
    const manualR = !alphaMatches && ribR > 0;
    const items: string[] = [];

    // Объект на выработке АэроСеть ТРЕБУЕТ с атрибутами размещения и
    // отказывается открывать файл без них — см. itemAttrs.
    // Длина выработки на ЭКРАНЕ АэроСети (в единицах схемы): segmentOffset
    // отсчитывается по спроецированной линии, а не по метрам выработки.
    const nf = nodeById.get(br.fromId), nt = nodeById.get(br.toId);
    const screenLen = nf && nt
      ? Math.hypot(...((): [number, number] => {
          const a = toScreen(nf.x, nf.y, nf.z), c = toScreen(nt.x, nt.y, nt.z);
          return [c.ex - a.ex, c.ey - a.ey];
        })())
      : (br.length ?? 0) * s;
    const offsetAt = (t: number | undefined) =>
      (t != null && isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5) * screenLen;

    if (withFans && br.hasFan) {
      const fanSym = symbols.find(sy => sy.branchId === br.id && FAN_SYMBOL_TYPES.has(sy.typeId));
      items.push(fanItemXml(br, offsetAt(fanSym?.t), fanSym?.airDirection === "reverse" || !!br.fanReverse));
    }
    // ── ПЕРЕМЫЧКИ ──────────────────────────────────────────────────────────
    // КАЖДЫЙ значок — отдельный объект АэроСети со своим кодом картинки
    // (материал + конструкция) и своим R. Раньше все сооружения ветви
    // сливались в один объект с кодом 8, и в АэроСети любая перемычка
    // становилась «глухой без материала».
    // Сопротивление — та же функция, что у решателя (symbolBulkheadR).
    const bkSyms = bulkheadSymbolsOf(br, symbols);
    if (withBulkheads) {
      bkSyms.forEach((sy, k) => {
        const code = erpCodeForSymbol(sy.typeId);
        const r = symbolBulkheadR(sy, br, bulkheadsMap);
        items.push(bulkheadItemXml({
          id: guidFrom(`bulk:${br.id}:${sy.id}`), code, r,
          windowArea: sy.bkWindowArea ?? 0, branchArea: br.area ?? 0,
          name: sy.bkBulkheadName || sy.description || sy.label
            || LEGEND_TYPES.find(l => l.id === sy.typeId)?.name || "",
          offset: offsetAt(sy.t ?? (k + 1) / (bkSyms.length + 1)),
        }));
      });
      if (br.hasBulkhead && bkSyms.length === 0) {
        const code = erpCodeForName(br.bulkheadName ?? "");
        items.push(bulkheadItemXml({
          id: guidFrom("bulk:" + br.id), code, r: branchOwnBulkheadR(br),
          windowArea: br.bulkheadWindowArea ?? 0, branchArea: br.area ?? 0,
          name: br.bulkheadName ?? "", offset: offsetAt(0.5),
        }));
      }
    }
    // ── ЗАМЕРНЫЕ СТАНЦИИ ────────────────────────────────────────────────────
    symbols
      .filter(sy => sy.branchId === br.id && sy.typeId === "measure_station")
      .forEach(sy => {
        stationNo++;
        items.push(
          `<ribItem id="${guidFrom(`ms:${br.id}:${sy.id}`)}" itemCode="20" description="${esc(sy.label || sy.description || `№${stationNo}`)}"${itemAttrs(offsetAt(sy.t), 0.5)}>`
          + `<customFields><fields>`
          + `<field name="Position.StationIsUsed" value="True" />`
          + `<field name="Notes" value="" />`
          + `<field name="Airflow.StationDischargeIsPrecise" value="False" />`
          + `<field name="Airflow.StationIsUsedInCalculation" value="False" />`
          + `</fields></customFields>`
          + `<ventModesData><ventModeData id="${VENT_MODE_ID}" type="Bulkheads"><customFields><fields /></customFields></ventModeData></ventModesData>`
          + `</ribItem>`,
        );
      });

    return `<rib id="${guidFrom("rib:" + br.id)}" thickness="7.55905511811024" startDate="${START_DATE}" fromNode="${from}" toNode="${to}">`
      + `<customFields><fields>`
      // Название выработки у нас хранится в поле type («Ствол ЮВС») — именно
      // оттуда его читает и импорт .erp, поэтому пишем обратно туда же.
      + `<field name="Rib.Name" value="${esc(br.type ?? "")}" />`
      + `<field name="Rib.Number" value="${i + 1}" />`
      // Сечение и периметр у нас всегда ГОТОВЫЕ числа (S, P уже посчитаны по
      // форме). Флаг «задано пользователем» ставим всегда: при False АэроСеть
      // берёт сечение из своего справочника типа выработки, а у нас тип не
      // выгружается — и S «уезжало» к значению по умолчанию (10 м²), что меняет
      // R в кубе. Раньше флаг повторял наш manualSection (у 190 из 318
      // выработок «Якутского» он был False).
      + `<field name="Airflow.CrossSectionArea" value="${n(br.area, 4)}" />`
      + `<field name="Airflow.CrossSectionAreaIsUserDefined" value="True" />`
      + `<field name="Airflow.Perimeter" value="${n(br.perimeter, 4)}" />`
      + `<field name="Airflow.PerimeterIsUserDefined" value="True" />`
      + `<field name="Airflow.UserDefinedRibLength" value="${n(br.length, 2)}" />`
      + `<field name="Airflow.RibLengthIsUserDefined" value="True" />`
      // α у нас в рудничных единицах (кгс·с²/м⁴), а АэроСеть хранит его в СИ
      // (кг/м³) — домножаем на g. Парно с делением в erpImport.ts.
      + `<field name="Airflow.Alpha" value="${n((br.alphaCoef ?? 0) * 1e-4 * 9.80665)}" />`
      + `<field name="Airflow.UserDefinedResistance" value="${manualR ? nr(ribR) : "0"}" />`
      + `<field name="Airflow.AirResistanceCalculationType" value="${manualR ? 2 : 0}" />`
      + `<field name="Airflow.Discharge" value="${n(withResults ? (br.flow ?? 0) : 0, 4)}" />`
      + `<field name="Airflow.MaxAirVelocity" value="${n(br.vMax ?? 0, 2)}" />`
      + `<field name="Airflow.MaxAirVelocityIsUserDefined" value="True" />`
      + `</fields></customFields>`
      + (items.length > 0 ? `<ribItems>${items.join("")}</ribItems>` : "")
      + `</rib>`;
  });

  // ── Позиции ПЛА ─────────────────────────────────────────────────────────
  // Позиция — это <node itemCode="1001">, отдельный объект плана ликвидации
  // аварий (не узел сети). Реверсивность кодируем числом границ маркера:
  // 2 = реверсивная. Радиус задаётся в пикселях: R = D(мм)·96/25,4/2.
  const posXml = positions.map(p => {
    const sc = toScreen(p.x, p.y, p.z);
    const radiusPx = ((p.diameter || 13) * 96) / 25.4 / 2;
    const ribs = (p.branchIds ?? [])
      .map(id => guidFrom("rib:" + id) + "#True")
      .join(";");
    return `<node id="${guidFrom("pos:" + p.id)}" itemCode="1001" x="${n(sc.ex)}" y="${n(sc.ey)}" z="${n(p.z, 2)}" scale="1" rotationAngle="0" document="">`
      + `<customFields><fields>`
      + `<field name="PlanPosition.Name" value="${esc(String(p.number))}" />`
      // Описание — единственное текстовое поле позиции в формате АэроСети,
      // поэтому мероприятия уходят туда же, следом за названием. Иначе
      // подобранный режим терялся бы при передаче плана в чужую программу.
      + `<field name="PlanPosition.Description" value="${esc(
          [p.name ?? "", p.comment ?? ""].filter(s => s.trim()).join("\n\n"),
        )}" />`
      + `<field name="PlanPosition.Radius" value="${n(radiusPx)}" />`
      + `<field name="PlanPosition.BackgroundColor" value="${hexToWinColor(p.color)}" />`
      + `<field name="PlanPosition.BorderColor" value="${hexToWinColor(p.borderColor)}" />`
      + `<field name="PlanPosition.BorderCount" value="${p.positionType === "reverse" ? 2 : 1}" />`
      + `<field name="PlanPosition.SameBackground" value="True" />`
      + `<field name="PlanPosition.FontFamily" value="${esc(p.font || "GOST type A")}" />`
      + `<field name="PlanPosition.PositionRibs" value="${esc(ribs)}" />`
      + `<field name="Position.AccidentType" value="${p.accidentType === "Пожар" ? 1 : 0}" />`
      + `<field name="Position.IsAppliedToAllRibs" value="False" />`
      + `</fields></customFields><routes /><precautions /></node>`;
  }).join("");

  // ── Слои ────────────────────────────────────────────────────────────────
  // Слой АэроСети = наш горизонт (так же их читает импорт: слой → горизонт).
  // Раньше вся схема ложилась в ОДИН слой с именем проекта, и в АэроСети
  // пропадала разбивка по горизонтам. Выработка идёт в слой своего горизонта;
  // узел — в слой первой выработки, которая его использует (в эталоне узлы
  // тоже лежат в слое «своих» выработок, а ветвь может ссылаться на узел
  // соседнего слоя). Выработки без горизонта — в отдельный слой.
  const horizonById = new Map(opts.horizons
    .filter(h => h.id !== OVERVIEW_HORIZON_ID)
    .map(h => [h.id, h]));
  const NO_LAYER = "__none__";
  const layerOfBranch = (br: TopoBranch) => horizonById.has(br.horizonId) ? br.horizonId : NO_LAYER;
  const layerRibs = new Map<string, string[]>();
  const layerNodes = new Map<string, TopoNode[]>();
  const nodeLayer = new Map<string, string>();
  branches.forEach((br, i) => {
    const xml = branchXmlList[i];
    if (!xml) return;
    const lid = layerOfBranch(br);
    if (!layerRibs.has(lid)) layerRibs.set(lid, []);
    layerRibs.get(lid)!.push(xml);
    for (const nid of [br.fromId, br.toId]) {
      if (!nodeLayer.has(nid)) nodeLayer.set(nid, lid);
    }
  });
  for (const nd of nodes) {
    const lid = nodeLayer.get(nd.id) ?? NO_LAYER;
    if (!layerNodes.has(lid)) layerNodes.set(lid, []);
    layerNodes.get(lid)!.push(nd);
  }
  const layerIds = [
    ...opts.horizons.filter(h => horizonById.has(h.id)).map(h => h.id),
    NO_LAYER,
  ].filter(lid => (layerRibs.get(lid)?.length ?? 0) > 0 || (layerNodes.get(lid)?.length ?? 0) > 0);
  // Позиции ПЛА — в первый слой (в эталоне они лежат в одном из слоёв схемы).
  const posLayer = layerIds[0] ?? NO_LAYER;
  if (layerIds.length === 0) layerIds.push(NO_LAYER);

  const layerXml = layerIds.map((lid, k) => {
    const h = horizonById.get(lid);
    const name = h ? h.name : (layerIds.length === 1 ? projectName : "Выработки без горизонта");
    const color = h ? hexToArgbString(h.color) : "#FF000000";
    const visible = h ? h.visible !== false : true;
    const ribsXml = (layerRibs.get(lid) ?? []).join("");
    const nodesXml = (layerNodes.get(lid) ?? []).map(nodeXmlOf).join("");
    const pos = lid === posLayer && posXml ? `<nodes>${posXml}</nodes>` : "";
    // orderIndex: верхний горизонт — сверху списка, как в эталоне.
    return `<layer id="${guidFrom("layer:" + lid)}" name="${esc(name)}" color="${color}" orderIndex="${layerIds.length - k}" isVisible="${b(visible)}" isEditable="True" isMovable="True">`
      + `<customFields><fields><field name="Elevation" value="${n(h?.z ?? 0, 2)}" /></fields></customFields>`
      + `<levels><layerLevel orderIndex="0">`
      + (ribsXml ? `<ribs>${ribsXml}</ribs>` : "")
      + (nodesXml ? `<ribEndNodes>${nodesXml}</ribEndNodes>` : "")
      + pos
      + `</layerLevel></levels></layer>`;
  }).join("");

  const optionsXml =
    `<options>`
    + `<option name="GeolocationScale">${GEO_SCALE}</option>`
    + `<option name="AngleBetweenNorthAndVertical">1.5707963267949</option>`
    + `<option name="OverheadAngle">1.5707963267949</option>`
    + `<option name="ProjectionType">1</option>`
    + `<option name="OYAngle">${OY_ANGLE}</option>`
    + `<option name="OYDistortion">${OY_DIST}</option>`
    + `<option name="OZDistortion">${OZ_DIST}</option>`
    + `</options>`;

  const schema = `<schema><layers>${layerXml}</layers>${optionsXml}</schema>`;

  // ── Справочники ─────────────────────────────────────────────────────────
  // Без ErpVentModes параметры в <ventModeData> не к чему привязать, а без
  // VentilatorTemplateService — характеристики вентиляторов. Каждый
  // справочник объявляется в documents.xml с type="2", как в эталоне.
  const dataDocs: [string, string][] = [
    ["ErpVentModes.DataDocument",
      `<erpVentModes><ventMode id="${VENT_MODE_ID}" name="${VENT_MODE_NAME}" color="-8531740" isReversed="False" isNewFormat="True" isSelected="True" /></erpVentModes>`],
    ["VentilatorTemplateService.DataDocument", ventilatorTemplatesXml()],
  ];
  const documentsXml = `<documents>`
    + dataDocs.map(([f], k) =>
      `<document internalFileName="${f}" fileName="tmp${(0x4a00 + k).toString(16).toUpperCase()}.tmp" type="2"><customFields><fields /></customFields></document>`).join("")
    + `</documents>`;

  const zip = new JSZip();
  // Content_Types — единственная часть в UTF-8, остальные строго UTF-16LE.
  zip.file("[Content_Types].xml",
    '\ufeff<?xml version="1.0" encoding="utf-8"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="xml" ContentType="text/xml" />'
    + '<Default Extension="DataDocument" ContentType="application/octet-stream" />'
    + "</Types>");
  zip.file("schema.xml", toUtf16le(schema));
  zip.file("documents.xml", toUtf16le(documentsXml));
  for (const [f, xml] of dataDocs) zip.file("docs/" + f, toUtf16le(xml));

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/** Собирает .erp и сохраняет его на диск пользователя. */
export async function exportErp(opts: ErpExportOptions & { fileName?: string }): Promise<void> {
  const blob = await buildErp(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (opts.fileName || opts.projectName || "Схема").replace(/\.[^.]+$/, "") + ".erp";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}