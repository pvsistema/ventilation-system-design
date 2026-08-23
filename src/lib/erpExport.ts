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
//   • documents.xml       — список вложений (нам достаточно пустого);
//   • docs/*.DataDocument — справочники, тоже UTF-16LE.
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

/** Экранирование текста для XML-атрибутов. */
function esc(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Число в вид, понятный АэроСети (точка-разделитель, без экспоненты). */
function n(v: number | undefined, digits = 6): string {
  const x = Number(v);
  if (!isFinite(x)) return "0";
  return String(+x.toFixed(digits));
}

/** Булево в вид «True»/«False», как в файлах АэроСети. */
function b(v: boolean | undefined): string {
  return v ? "True" : "False";
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
}

/**
 * Собирает .erp и возвращает его как Blob — готовый к сохранению файл.
 */
export async function buildErp(opts: ErpExportOptions): Promise<Blob> {
  const { nodes, branches, positions = [], projectName = "ПВ-Система" } = opts;

  const s = 1 / GEO_SCALE;                    // единиц на метр
  const sinOY = Math.sin(OY_ANGLE) * OY_DIST;
  const cosOY = Math.cos(OY_ANGLE) * OY_DIST;

  /** План (метры) + отметка → экранные координаты файла. Обратно к импорту. */
  const toScreen = (x: number, y: number, z: number) => ({
    ex: (x + cosOY * y) * s,
    ey: (-y * sinOY - OZ_DIST * z) * s,
  });

  const nodeGuid = new Map(nodes.map(nd => [nd.id, guidFrom("node:" + nd.id)]));

  // ── Узлы ────────────────────────────────────────────────────────────────
  // В АэроСети отметка узла лежит в поле RibEndNode.Depth, а сами x/y уже
  // спроецированы. Пишем оба вида координат согласованно, иначе программа
  // нарисует схему «винтом».
  const nodeXml = nodes.map((nd, i) => {
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
  }).join("");

  // ── Выработки ───────────────────────────────────────────────────────────
  // Пишем геометрию, сопротивление и объекты на ветви (вентилятор, перемычка).
  // Способ задания R: 2 = «задано пользователем», иначе АэроСеть пересчитает
  // его сама по α и сечению — так ведёт себя и наш импорт в обратную сторону.
  const branchXml = branches.map((br, i) => {
    const from = nodeGuid.get(br.fromId);
    const to = nodeGuid.get(br.toId);
    if (!from || !to) return "";

    const manualR = br.resistanceMode === "manual" && br.manualR > 0;
    const items: string[] = [];

    if (br.hasFan) {
      // Напор переводим в кгс/м² — единицы АэроСети (см. шапку файла).
      items.push(
        `<ribItem id="${guidFrom("fan:" + br.id)}" itemCode="18" description="${esc(br.fanName || "Вентилятор")}">`
        + `<customFields><fields>`
        + `<field name="Airflow.FanPressure" value="${n((br.fanPressure ?? 0) / PA_PER_KGS_M2)}" />`
        + `<field name="Airflow.IdealVentilatorEfficiency" value="${n(br.fanEfficiency ?? 0, 3)}" />`
        + `<field name="Airflow.VentilatorSpeed" value="${n(br.fanRpm ?? 0, 1)}" />`
        + `<field name="Airflow.VentilatorsInParallel" value="${Math.max(1, Math.round(br.fanParallel ?? 1))}" />`
        + `<field name="Airflow.VentilatorType" value="1" />`
        + `</fields></customFields></ribItem>`,
      );
    }
    if (br.hasBulkhead) {
      items.push(
        `<ribItem id="${guidFrom("bulk:" + br.id)}" itemCode="8" description="${esc(br.bulkheadName || "Перемычка")}">`
        + `<customFields><fields>`
        + `<field name="Airflow.BulkheadUserDefinedResistance" value="${n(br.bulkheadManualR ?? 0)}" />`
        + `<field name="Airflow.BulkheadDepressionSurveyDischarge" value="${n(br.bulkheadSurveyQ ?? 0, 3)}" />`
        + `</fields></customFields></ribItem>`,
      );
    }

    return `<rib id="${guidFrom("rib:" + br.id)}" thickness="7.55905511811024" fromNode="${from}" toNode="${to}">`
      + `<customFields><fields>`
      // Название выработки у нас хранится в поле type («Ствол ЮВС») — именно
      // оттуда его читает и импорт .erp, поэтому пишем обратно туда же.
      + `<field name="Rib.Name" value="${esc(br.type ?? "")}" />`
      + `<field name="Rib.Number" value="${i + 1}" />`
      + `<field name="Airflow.CrossSectionArea" value="${n(br.area, 3)}" />`
      + `<field name="Airflow.CrossSectionAreaIsUserDefined" value="${b(br.manualSection)}" />`
      + `<field name="Airflow.Perimeter" value="${n(br.perimeter, 3)}" />`
      + `<field name="Airflow.UserDefinedRibLength" value="${n(br.length, 2)}" />`
      + `<field name="Airflow.RibLengthIsUserDefined" value="True" />`
      + `<field name="Airflow.Alpha" value="${n((br.alphaCoef ?? 0) * 1e-4)}" />`
      + `<field name="Airflow.UserDefinedResistance" value="${n(manualR ? br.manualR : 0)}" />`
      + `<field name="Airflow.AirResistanceCalculationType" value="${manualR ? 2 : 0}" />`
      + `<field name="Airflow.Discharge" value="${n(br.flow ?? 0, 4)}" />`
      + `<field name="Airflow.MaxAirVelocity" value="${n(br.vMax ?? 0, 2)}" />`
      + `<field name="Airflow.MaxAirVelocityIsUserDefined" value="True" />`
      + `</fields></customFields>`
      + (items.length > 0 ? `<ribItems>${items.join("")}</ribItems>` : "")
      + `</rib>`;
  }).join("");

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
      + `<field name="PlanPosition.Description" value="${esc(p.name ?? "")}" />`
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

  // ── Слой ────────────────────────────────────────────────────────────────
  // Кладём всю схему в ОДИН слой. Наши горизонты — это отметки, а слои
  // АэроСети — способ группировки чертежа; раскладывать выработки по слоям
  // без исходной разбивки значило бы выдумывать структуру за пользователя.
  const layerXml =
    `<layer id="${guidFrom("layer:main")}" name="${esc(projectName)}" color="#FF000000" orderIndex="0" isVisible="True" isEditable="True" isMovable="True">`
    + `<customFields><fields><field name="Elevation" value="0" /></fields></customFields>`
    + `<levels><layerLevel orderIndex="0">`
    + `<ribs>${branchXml}</ribs>`
    + `<ribEndNodes>${nodeXml}</ribEndNodes>`
    + (posXml ? `<nodes>${posXml}</nodes>` : "")
    + `</layerLevel></levels></layer>`;

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

  const zip = new JSZip();
  // Content_Types — единственная часть в UTF-8, остальные строго UTF-16LE.
  zip.file("[Content_Types].xml",
    '\ufeff<?xml version="1.0" encoding="utf-8"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="xml" ContentType="text/xml" />'
    + '<Default Extension="DataDocument" ContentType="application/octet-stream" />'
    + "</Types>");
  zip.file("schema.xml", toUtf16le(schema));
  zip.file("documents.xml", toUtf16le("<documents />"));

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