// ─────────────────────────────────────────────────────────────────────────────
// Импорт проектов АэроСеть (.erp)
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
//         <field name="RibEndNode.Depth" …/>         ← ОТМЕТКА, м (вверх > 0)
//     </ribEndNodes>
//     <settings><setting key="ProjectionType" …/>    ← параметры проекции
//   </schema>
//
// ВАЖНО про координаты: x/y в файле — экранные единицы косоугольной проекции
// АэроСети, а не метры. Отношение «длина ветви / расстояние между узлами»
// стабильно равно ≈1,0583 (это 96/90,71 — пересчёт дюймовой сетки). Мы
// определяем масштаб по самим данным (медиана отношений), а не константой:
// у другого проекта настройки экспорта могут отличаться.
//
// Высотная отметка Z = Depth БЕЗ смены знака. Название поля вводит в
// заблуждение: несмотря на «Depth», значение растёт ВВЕРХ и совпадает с нашей
// отметкой (устье ствола на поверхности = +500, забой ниже = 0). Трактовка
// «глубина вниз» переворачивала импортированную схему вверх ногами.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from "jszip";
import { makeNode, makeBranch, type TopoNode, type TopoBranch, type Horizon } from "@/lib/topology";

/** Перемычка на ветви: где стоит, каким УО рисовать, какое сопротивление. */
export interface ErpBulkhead {
  branchId: string;
  t: number;            // положение вдоль ветви 0..1
  typeId: string;       // id условного обозначения (см. schemaSymbols)
  name: string;
  rKmu: number;         // кМюрг
  airPerm: number;      // м²/(с·√Па)
  surveyQ: number;      // расход воздушной съёмки, м³/с
  reversed: boolean;
}

/** Вентилятор на ветви: положение и назначение (ГВУ / ВВУ / ВМП). */
export interface ErpFan {
  branchId: string;
  t: number;
  fanType: "ГВУ" | "ВВУ" | "ВМП";
  name: string;
}

export interface ErpImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  bulkheads: ErpBulkhead[];
  fans: ErpFan[];
  warnings: string[];
  stats: { nodes: number; branches: number; fans: number; bulkheads: number; horizons: number };
  debug: string;
}

// Коды объектов на ветви (<ribItem itemCode>). В образце 8 — перемычка,
// 16 — вентилятор, НО в реальных проектах коды другие (у каждого вида
// перемычки и вентилятора свой). Поэтому коды — лишь подсказка: главный
// признак объекта — набор полей самой ветви (Airflow.Bulkhead* /
// Airflow.Ventilator*), он есть только там, где объект реально стоит.
// Именно из-за жёсткой привязки к 8/16 в большом проекте не импортировались
// ни перемычки, ни часть вентиляторов.
const ITEM_BULKHEAD = "8";
const ITEM_FAN = "16";

/**
 * УО перемычки по коду объекта АэроСети. Коды соответствуют видам вентсооружений
 * из справочника воздухопроницаемости (blindBulkheadAirPermeability itemCode).
 * Неизвестный код → глухая перемычка (самый частый вид).
 */
function bulkheadTypeIdByCode(code: string): string {
  switch (code) {
    case "8":  return "bk_base";      // глухая перемычка
    case "9":  return "door_base";    // вентиляционная дверь
    case "10": return "auto_base";    // дверь автоматическая
    case "11": return "win_base";     // дверь с регулируемым окном
    case "12": return "lat_base";     // решётчатая дверь
    case "13": return "open_base";    // дверь открытая
    case "14": return "sail";         // парус
    case "15": return "barrier";      // барьер
    default:   return "bk_base";
  }
}

/** Число из атрибута XML. Поддерживает экспоненту («3.94E-05») и запятую. */
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
 * Собирает <field name=… value=…> элемента в обычный словарь.
 *
 * ВАЖНО: поля СОБСТВЕННЫЕ. Раньше брались все вложенные field, включая поля
 * объектов на ветви (<ribItem> — перемычки и вентиляторы), из-за чего параметры
 * перемычки приписывались самой выработке, а объекты дублировались.
 * Отсекаем всё, что лежит внутри ribItem.
 */
function readFields(el: Element, opts?: { includeItems?: boolean }): Record<string, string> {
  const out: Record<string, string> = {};
  el.querySelectorAll("field").forEach(f => {
    if (!opts?.includeItems) {
      // поле принадлежит объекту на ветви, а не самой ветви
      let p: Element | null = f.parentElement;
      let inItem = false;
      while (p && p !== el) {
        if (p.tagName === "ribItem") { inItem = true; break; }
        p = p.parentElement;
      }
      if (inItem) return;
    }
    const n = f.getAttribute("name");
    if (n) out[n] = f.getAttribute("value") ?? "";
  });
  return out;
}

/**
 * Разбирает объект на ветви (<ribItem>): его собственные поля и поля активного
 * режима проветривания (<ventModeData type="Fans"|"Bulkheads">).
 *
 * Тип объекта определяем НЕ по itemCode (коды у разных видов перемычек и
 * вентиляторов разные и в справочнике проекта могут быть любыми), а по типу
 * блока ventModeData с непустым набором полей — это надёжный признак,
 * одинаковый во всех версиях АэроСети.
 */
function readRibItem(item: Element): { kind: "fan" | "bulkhead" | "other"; f: Record<string, string>; code: string } {
  const f: Record<string, string> = {};
  let kind: "fan" | "bulkhead" | "other" = "other";
  // собственные поля объекта
  item.querySelectorAll(":scope > customFields field").forEach(x => {
    const n = x.getAttribute("name");
    if (n) f[n] = x.getAttribute("value") ?? "";
  });
  item.querySelectorAll(":scope > ventModesData > ventModeData").forEach(vm => {
    const type = vm.getAttribute("type") ?? "";
    const fields = vm.querySelectorAll("field");
    if (fields.length === 0) return;
    fields.forEach(x => {
      const n = x.getAttribute("name");
      if (n) f[n] = x.getAttribute("value") ?? "";
    });
    if (type === "Fans") kind = "fan";
    else if (type === "Bulkheads" && kind !== "fan") kind = "bulkhead";
  });
  const code = item.getAttribute("itemCode") ?? "";
  // Резерв: если блоков режима нет вовсе — опираемся на набор полей и код.
  if (kind === "other") {
    const keys = Object.keys(f).join(" ");
    if (/Ventilator|FanPressure/.test(keys) || code === ITEM_FAN) kind = "fan";
    else if (/Bulkhead/.test(keys) || code === ITEM_BULKHEAD) kind = "bulkhead";
  }
  return { kind, f, code };
}

/** ARGB-цвет АэроСети («#FF808000») → HEX без альфы («#808000»). */
function argbToHex(c: string | null): string {
  const s = String(c ?? "").replace("#", "").trim();
  if (s.length === 8) return "#" + s.slice(2).toUpperCase();
  if (s.length === 6) return "#" + s.toUpperCase();
  return "#3B82F6";
}

export async function parseErp(buffer: ArrayBuffer): Promise<ErpImportResult> {
  const warnings: string[] = [];
  const log: string[] = [];

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

  // ── Справочник типов выработок: имя и максимальная скорость ────────────────
  const ribTypes = new Map<string, { name: string; vMax: number }>();
  const rtEntry = zip.file(/RibTypeService\.DataDocument$/i)[0];
  if (rtEntry) {
    const rtDoc = new DOMParser().parseFromString(decodeXml(await rtEntry.async("uint8array")), "application/xml");
    rtDoc.querySelectorAll("ribType").forEach(t => {
      const id = t.getAttribute("id");
      if (id) ribTypes.set(id, { name: t.getAttribute("name") ?? "", vMax: num(t.getAttribute("defaultMaxAirVelocity"), 0) });
    });
    log.push(`типов выработок: ${ribTypes.size}`);
  }

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
      // ИСПРАВЛЕНО. Вопреки названию, RibEndNode.Depth хранит не глубину, а
      // ВЫСОТНУЮ ОТМЕТКУ узла — то же, что наша z. Знак менять не нужно.
      // Проверено на образце (3 независимых признака):
      //   • узлы с HasAtmosphereConnection=True (устья стволов, выход на
      //     поверхность) имеют Depth=500 — при трактовке «глубина» устье
      //     оказалось бы на 500 м под землёй, что и переворачивало схему;
      //   • Depth = −y_экр·масштаб, а экранная ось Y направлена вниз, то есть
      //     Depth растёт ВВЕРХ по экрану — признак отметки, а не глубины;
      //   • |ΔDepth| совпадает с явно заданной длиной вертикальных ветвей
      //     (500 и 100 м), что подтверждает: это координата одной оси.
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
  interface RawItem {
    kind: "fan" | "bulkhead" | "other";
    code: string;
    f: Record<string, string>;
    offset: number;      // segmentOffset — расстояние от начала ветви в единицах экрана
    reversed: boolean;
  }
  interface RawBranch {
    id: string; fromId: string; toId: string; horizonId: string;
    f: Record<string, string>; items: RawItem[]; thickness: number;
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
        const parsed = readRibItem(it);
        items.push({
          kind: parsed.kind,
          code: parsed.code,
          f: parsed.f,
          offset: num(it.getAttribute("segmentOffset"), -1),
          reversed: bool(it.getAttribute("isReversed")),
        });
      });
      rawBranches.push({ id, fromId, toId, horizonId: lid, f: readFields(rib), items, thickness: num(rib.getAttribute("thickness"), 3) });
    });
  });
  log.push(`слоёв: ${horizonMeta.length}, ветвей: ${rawBranches.length}`);
  if (rawBranches.length === 0) throw new Error("В файле не найдено ни одной выработки");

  // ── Масштаб координат ─────────────────────────────────────────────────────
  // Отношение «заданная длина ветви / расстояние между её узлами в плане».
  // Берём МЕДИАНУ по горизонтальным ветвям: у наклонных часть длины приходится
  // на перепад высот, и они исказили бы оценку. Если таких ветвей нет —
  // оставляем 1 и предупреждаем: геометрия может не совпасть с длинами.
  const ratios: number[] = [];
  for (const rb of rawBranches) {
    const a = rawNodes.get(rb.fromId), b = rawNodes.get(rb.toId);
    if (!a || !b) continue;
    if (Math.abs(a.z - b.z) > 0.5) continue;           // только горизонтальные
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const L = num(rb.f["Airflow.UserDefinedRibLength"]);
    if (d > 1e-6 && L > 1e-6) ratios.push(L / d);
  }
  let scale = 1;
  if (ratios.length > 0) {
    ratios.sort((p, q) => p - q);
    scale = ratios[Math.floor(ratios.length / 2)];
    log.push(`масштаб координат: ${scale.toFixed(4)} (по ${ratios.length} горизонт. ветвям)`);
  } else {
    warnings.push("Не удалось определить масштаб координат — план может не совпасть с длинами выработок");
  }

  // ── Разделение экранной оси Y на «план» и «глубину» ───────────────────────
  // КЛЮЧЕВОЙ момент формата. АэроСеть рисует схему в косоугольной проекции
  // (ProjectionType=1, OverheadAngle=90°), поэтому экранная координата Y — не
  // плановая координата, а СМЕСЬ плановой Y и высотной отметки Z.
  //
  // Проверено на образце: у всех узлов −y_экр·масштаб в точности равен отметке
  // z (−472,44·1,0583 = −500, а отметка узла +500). Экранная ось Y направлена
  // ВНИЗ, поэтому вклад высоты входит в неё со знаком минус. Если взять y_экр
  // как план, перепад высот учтётся ДВАЖДЫ: ствол длиной 500 м получит
  // геометрическую длину 707 м, и все длины, углы наклона и сопротивления
  // «поедут».
  //
  // Поэтому вычитаем вклад высоты: остаток и есть плановая координата. Для
  // вертикального разреза он равен нулю (схема плоская), для схемы с планом —
  // даёт настоящую Y.
  const residuals: number[] = [];
  rawNodes.forEach(rn => residuals.push(rn.y * scale + rn.z));
  const maxResidual = residuals.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const planarView = maxResidual < 0.5;
  log.push(planarView
    ? "проекция: вертикальный разрез (плановая Y отсутствует)"
    : `проекция: с плановой Y (макс. остаток ${maxResidual.toFixed(1)} м)`);

  // ── Сборка узлов ──────────────────────────────────────────────────────────
  const idMap = new Map<string, string>();
  const nodes: TopoNode[] = [];
  let nodeNum = 1;
  rawNodes.forEach(rn => {
    const newId = `n_erp_${nodeNum}`;
    idMap.set(rn.id, newId);
    nodes.push(makeNode(newId, {
      x: +(rn.x * scale).toFixed(2),
      y: planarView ? 0 : +(-(rn.y * scale + rn.z)).toFixed(2),
      z: +rn.z.toFixed(2),
      name: rn.name,
      number: rn.number || String(nodeNum),
      atmosphereLink: rn.atm,
      airTemp: rn.t,
      reducedPressure: rn.p,
    }));
    nodeNum++;
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

  // ── Сборка ветвей ─────────────────────────────────────────────────────────
  const branches: TopoBranch[] = [];
  const outBulkheads: ErpBulkhead[] = [];
  const outFans: ErpFan[] = [];
  let fans = 0, bulkheads = 0, skipped = 0, branchNum = 1;

  // Степень узла нужна для распознавания ВМП: вентилятор местного
  // проветривания стоит в тупиковой ветви (у забоя), ГВУ — на выходе на
  // поверхность, ВВУ — в подземной сети.
  const degree = new Map<string, number>();
  for (const rb of rawBranches) {
    degree.set(rb.fromId, (degree.get(rb.fromId) ?? 0) + 1);
    degree.set(rb.toId, (degree.get(rb.toId) ?? 0) + 1);
  }

  for (const rb of rawBranches) {
    const fromId = idMap.get(rb.fromId);
    const toId = idMap.get(rb.toId);
    if (!fromId || !toId) { skipped++; continue; }
    const f = rb.f;

    const area = num(f["Airflow.CrossSectionArea"], 0);
    const perimeter = num(f["Airflow.Perimeter"], 0);
    const length = num(f["Airflow.UserDefinedRibLength"], 0);
    const rUser = num(f["Airflow.UserDefinedResistance"], 0);
    const alpha = num(f["Airflow.Alpha"], 0);
    const rt = ribTypes.get(f["Airflow.RibTypeId"] ?? "");

    // Способ задания сопротивления (Airflow.AirResistanceCalculationType).
    // По образцу: 2 = задано пользователем (UserDefinedResistance). Прочие
    // значения означают расчёт по α — тогда переносим α, а R пересчитает солвер.
    const rMode = String(f["Airflow.AirResistanceCalculationType"] ?? "");
    const useManualR = rMode === "2" && rUser > 0;

    // ── Объекты на ветви ──────────────────────────────────────────────────
    // Раньше искали строго itemCode 8/16 — в реальном проекте коды другие,
    // поэтому перемычки терялись, а вентиляторы распознавались частично.
    const fanItems = rb.items.filter(it => it.kind === "fan");
    const bkItems  = rb.items.filter(it => it.kind === "bulkhead");
    const hasFan = fanItems.length > 0;
    const hasBulkhead = bkItems.length > 0;
    if (hasFan) fans += fanItems.length;
    if (hasBulkhead) bulkheads += bkItems.length;

    // Поля вентилятора берём из самого объекта (в ветви их нет).
    const ff = fanItems[0]?.f ?? {};
    const bf = bkItems[0]?.f ?? {};

    // Депрессия вентилятора: в АэроСети Па, у нас тоже Па.
    const fanPressure = num(ff["Airflow.FanPressure"], 0) || num(ff["Airflow.IdealVentilatorPressure"], 0);

    // ── Назначение вентилятора: ГВУ / ВВУ / ВМП ───────────────────────────
    // Раньше всем ставился тип по умолчанию «ГВУ», из-за чего ВМП на схеме
    // рисовались значком вентиляторной установки.
    // Правила (по смыслу вентиляционной сети):
    //   ВМП — ветвь тупиковая (один из узлов больше никуда не ведёт) либо
    //         вентилятор установлен в трубопроводе (InstallationType=1);
    //   ГВУ — ветвь связана с поверхностью (узел с выходом в атмосферу);
    //   ВВУ — всё остальное (подземная вспомогательная установка).
    const aRaw = rawNodes.get(rb.fromId), bRaw = rawNodes.get(rb.toId);
    const isDeadEnd = (degree.get(rb.fromId) ?? 0) === 1 || (degree.get(rb.toId) ?? 0) === 1;
    const touchesSurface = !!aRaw?.atm || !!bRaw?.atm;
    const installType = String(ff["Airflow.VentilatorInstallationType"] ?? "");
    const fanType: "ГВУ" | "ВВУ" | "ВМП" =
      (isDeadEnd || installType === "1") ? "ВМП"
      : touchesSurface ? "ГВУ"
      : "ВВУ";

    const branchId = `b_erp_${branchNum}`;

    // Длина ветви в единицах экрана — чтобы перевести segmentOffset объекта
    // в относительную позицию 0..1 вдоль ветви.
    const screenLen = aRaw && bRaw ? Math.hypot(bRaw.x - aRaw.x, bRaw.y - aRaw.y) : 0;
    const posOf = (offset: number) =>
      screenLen > 1e-6 && offset >= 0 ? Math.min(0.95, Math.max(0.05, offset / screenLen)) : 0.5;

    for (const it of fanItems) {
      outFans.push({ branchId, t: posOf(it.offset), fanType, name: f["Rib.Name"] || "Вентилятор" });
    }
    for (const it of bkItems) {
      const r = num(it.f["Airflow.BulkheadUserDefinedResistance"], 0)
             || num(it.f["Airflow.BulkheadCalculatedResistance"], 0);
      outBulkheads.push({
        branchId,
        t: posOf(it.offset),
        typeId: bulkheadTypeIdByCode(it.code),
        name: "Перемычка",
        rKmu: r,
        airPerm: num(it.f["Airflow.BlindBulkheadUserDefinedPermeability"], 0),
        surveyQ: num(it.f["Airflow.BulkheadDepressionSurveyDischarge"], 0),
        reversed: it.reversed,
      });
    }

    branches.push(makeBranch(branchId, fromId, toId, {
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
      manualLength: bool(f["Airflow.RibLengthIsUserDefined"]) || length > 0,
      resistanceMode: useManualR ? "manual" : "alpha",
      manualR: useManualR ? rUser : 0,
      alphaCoef: alpha > 0 ? alpha * 1e4 : 0,
      resistance: rUser,
      flow: num(f["Airflow.Discharge"], 0),
      vMax: num(f["Airflow.MaxAirVelocity"], 0) || rt?.vMax || 0,
      horizonId: horizonIdMap.get(rb.horizonId) ?? "",
      lineWidth: Math.max(1, Math.round(rb.thickness / 1.5)),
      // ── Вентилятор ────────────────────────────────────────────────────
      hasFan,
      fanType,
      fanMode: "constant",
      fanPressure: hasFan ? fanPressure : 0,
      fanName: hasFan ? (f["Rib.Name"] || "Вентилятор") : "",
      fanEfficiency: hasFan ? num(ff["Airflow.IdealVentilatorEfficiency"], 0) : 0,
      fanParallel: hasFan ? Math.max(1, Math.round(num(ff["Airflow.VentilatorsInParallel"], 1))) : 1,
      fanRpm: hasFan ? num(ff["Airflow.VentilatorSpeed"], 0) : 0,
      fanCrossingR: hasFan ? num(ff["Airflow.VentilatorBulkheadResistance"], 0) : 0,
      // ── Перемычка ─────────────────────────────────────────────────────
      hasBulkhead,
      bulkheadName: hasBulkhead ? "Перемычка" : "",
      // АэроСеть хранит сопротивление перемычки в кМюрг — как и наше поле.
      bulkheadR: hasBulkhead
        ? (num(bf["Airflow.BulkheadUserDefinedResistance"], 0) || num(bf["Airflow.BulkheadCalculatedResistance"], 0))
        : 0,
      bulkheadResMode: hasBulkhead ? "manual" : "project",
      bulkheadManualR: hasBulkhead
        ? (num(bf["Airflow.BulkheadUserDefinedResistance"], 0) || num(bf["Airflow.BulkheadCalculatedResistance"], 0))
        : 0,
      bulkheadAirPerm: hasBulkhead ? num(bf["Airflow.BlindBulkheadUserDefinedPermeability"], 0) : 0,
      bulkheadSurveyQ: hasBulkhead ? num(bf["Airflow.BulkheadDepressionSurveyDischarge"], 0) : 0,
      comment: f["Rib.Comment"] ?? "",
    }));
    branchNum++;
  }

  if (skipped > 0) warnings.push(`Пропущено выработок без узлов: ${skipped}`);
  if (nodes.every(n => n.z === 0)) warnings.push("У всех узлов нулевая отметка — в проекте не заданы глубины");

  const byType = outFans.reduce<Record<string, number>>((a, x) => { a[x.fanType] = (a[x.fanType] ?? 0) + 1; return a; }, {});
  log.push(`импортировано: узлов ${nodes.length}, ветвей ${branches.length}, вент. ${fans} (${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}), перемычек ${bulkheads}`);

  return {
    nodes,
    branches,
    horizons,
    bulkheads: outBulkheads,
    fans: outFans,
    warnings,
    stats: { nodes: nodes.length, branches: branches.length, fans, bulkheads, horizons: horizons.length },
    debug: log.join("\n"),
  };
}