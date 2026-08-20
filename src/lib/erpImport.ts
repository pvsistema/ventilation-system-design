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
import { PA_PER_MM_H2O } from "@/lib/aerodynamics";

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

/** Дополнительная выноска позиции (в АэроСети — «тень» позиции). */
export interface ErpLeader {
  branchId: string | null;
  t: number | null;
  endX: number | null;
  endY: number | null;
}

/** Позиция ПЛА из проекта АэроСеть. */
export interface ErpPosition {
  number: number;
  name: string;
  x: number; y: number; z: number;
  color: string;
  borderColor: string;
  diameter: number;               // мм
  font: string;
  accidentType: string;           // «Пожар» / «Взрыв» / …
  positionType: "normal" | "reverse";
  ventMode: string;
  isMineWide: boolean;
  branchIds: string[];            // привязанные выработки
  leaderBranchId: string | null;  // основная выноска: ветвь
  leaderT: number | null;         // и положение вдоль неё
  extraLeaders: ErpLeader[];      // дублирующие выноски
}

export interface ErpImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  bulkheads: ErpBulkhead[];
  fans: ErpFan[];
  positions: ErpPosition[];
  warnings: string[];
  stats: { nodes: number; branches: number; fans: number; bulkheads: number; horizons: number; positions: number };
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

/**
 * Цвет позиции хранится ЧИСЛОМ .NET (Int32 ARGB со знаком): −65536 = красный,
 * −256 = жёлтый. Переводим в обычный HEX.
 */
function intColorToHex(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return "";
  const u = n < 0 ? n + 0x100000000 : n;
  const hex = (u & 0xffffff).toString(16).padStart(6, "0");
  return "#" + hex.toUpperCase();
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

  // ── Справочники: типы выработок, формы сечения, типы крепи ────────────────
  // Формы сечения нужны, чтобы восстановить ПЕРИМЕТР: в проектах он часто не
  // задан явно, а считается из площади по коэффициенту формы (P = k·√S).
  // Без периметра сопротивление по α не считается вовсе — ветви приходили с
  // нулевым R, как на схеме проверки.
  const ribTypes = new Map<string, { name: string; vMax: number; sectionId: string; surfaceId: string; area: number }>();
  const sectionRatio = new Map<string, { name: string; k: number }>();
  const surfaceAlpha = new Map<string, { name: string; alpha: number }>();
  const rtEntry = zip.file(/RibTypeService\.DataDocument$/i)[0];
  if (rtEntry) {
    const rtDoc = new DOMParser().parseFromString(decodeXml(await rtEntry.async("uint8array")), "application/xml");
    rtDoc.querySelectorAll("ribType").forEach(t => {
      const id = t.getAttribute("id");
      if (id) ribTypes.set(id, {
        name: t.getAttribute("name") ?? "",
        vMax: num(t.getAttribute("defaultMaxAirVelocity"), 0),
        sectionId: t.getAttribute("crossSectionTypeId") ?? "",
        surfaceId: t.getAttribute("surfaceTypeId") ?? "",
        area: num(t.getAttribute("defaultCrossSectionArea"), 0),
      });
    });
    rtDoc.querySelectorAll("crossSectionType").forEach(t => {
      const id = t.getAttribute("id");
      if (id) sectionRatio.set(id, { name: t.getAttribute("name") ?? "", k: num(t.getAttribute("perimeterToAreaRatio"), 0) });
    });
    rtDoc.querySelectorAll("surfaceType").forEach(t => {
      const id = t.getAttribute("id");
      if (id) surfaceAlpha.set(id, { name: t.getAttribute("name") ?? "", alpha: num(t.getAttribute("alpha"), 0) });
    });
    log.push(`справочники: типов выработок ${ribTypes.size}, форм сечения ${sectionRatio.size}, типов крепи ${surfaceAlpha.size}`);
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

  // ── Обратная косоугольная проекция ────────────────────────────────────────
  // АэроСеть хранит НЕ метры, а экранные координаты своей косоугольной
  // проекции. Параметры лежат в <settings>:
  //   OYAngle        — угол, под которым рисуется плановая ось Y;
  //   OYDistortion   — её сжатие;
  //   OZDistortion   — растяжение высот (в разрезах бывает 7,5 — вертикаль
  //                    намеренно вытянута, чтобы горизонты не сливались);
  //   GroundRotationAngle — поворот плана.
  // Прямое преобразование (единицы экрана, ось Y вниз):
  //   sx =  u·(X' + Y'·cos(OY)·kY)
  //   sy = −u·(Y'·sin(OY)·kY + Z·kZ)
  // где (X',Y') — план после поворота, u — единиц экрана на метр.
  //
  // Раньше формат считался «плоским» (kZ = 1, поворота нет), и большая схема
  // с OZDistortion = 7,5 растягивалась по высоте в 7,5 раза, а план ещё и
  // оказывался повёрнутым. Теперь проекцию разворачиваем честно.
  const settings = new Map<string, number>();
  doc.querySelectorAll("settings > setting").forEach(s => {
    const k = s.getAttribute("key");
    if (k) settings.set(k, num(s.getAttribute("value")));
  });
  const oyAngle = settings.get("OYAngle") ?? Math.PI / 2;
  const oyDist  = settings.get("OYDistortion") ?? 1;
  const ozDist  = settings.get("OZDistortion") ?? 1;
  const ground  = settings.get("GroundRotationAngle") ?? 0;
  const sinOY = Math.sin(oyAngle) * oyDist;
  const cosOY = Math.cos(oyAngle) * oyDist;

  /** Экранные координаты узла/позиции → метры плана (X, Y) при данном u. */
  const unproject = (sx: number, sy: number, z: number, u: number): { x: number; y: number } => {
    if (Math.abs(sinOY) < 1e-9 || u < 1e-9) return { x: sx, y: 0 };
    const yp = (-sy / u - z * ozDist) / sinOY;
    const xp = sx / u - yp * cosOY;
    return {
      x: Math.cos(ground) * xp - Math.sin(ground) * yp,
      y: Math.sin(ground) * xp + Math.cos(ground) * yp,
    };
  };

  // Единиц экрана на метр (u) подбираем по данным: перебираем и берём то
  // значение, при котором длины ветвей из файла лучше всего сходятся с
  // геометрией. Так импорт не зависит от настроек экспорта конкретного ПК.
  const lenSamples = rawBranches
    .map(rb => ({ a: rawNodes.get(rb.fromId), b: rawNodes.get(rb.toId), L: num(rb.f["Airflow.UserDefinedRibLength"]) }))
    .filter(s => s.a && s.b && s.L > 1);
  const medianErr = (u: number): number => {
    const errs: number[] = [];
    for (const s of lenSamples) {
      const p = unproject(s.a!.x, s.a!.y, s.a!.z, u);
      const q = unproject(s.b!.x, s.b!.y, s.b!.z, u);
      const d = Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (s.b!.z - s.a!.z) ** 2);
      errs.push(Math.abs(d - s.L) / s.L);
    }
    if (errs.length === 0) return Infinity;
    errs.sort((m, n) => m - n);
    return errs[Math.floor(errs.length / 2)];
  };
  let unit = 1 / 0.2646;              // по умолчанию 96 dpi (единиц экрана на метр)
  if (lenSamples.length > 0) {
    let best = Infinity;
    for (let i = 1; i <= 400; i++) {          // грубый проход 0,02…8
      const u = i * 0.02;
      const e = medianErr(u);
      if (e < best) { best = e; unit = u; }
    }
    for (let i = -20; i <= 20; i++) {         // уточнение вокруг найденного
      const u = unit + i * 0.002;
      if (u <= 0) continue;
      const e = medianErr(u);
      if (e < best) { best = e; unit = u; }
    }
    log.push(`проекция: OY=${(oyAngle * 180 / Math.PI).toFixed(1)}°, kZ=${ozDist}, поворот=${(ground * 180 / Math.PI).toFixed(1)}°`);
    log.push(`масштаб: ${unit.toFixed(3)} ед/м (расхождение длин ${(best * 100).toFixed(1)}%)`);
    if (best > 0.25) warnings.push("Геометрия схемы расходится с заданными длинами выработок — расчёт ведётся по длинам из файла");
  } else {
    warnings.push("В файле нет заданных длин выработок — масштаб плана принят приблизительным");
  }

  // ── Сборка узлов ──────────────────────────────────────────────────────────
  const idMap = new Map<string, string>();
  const nodes: TopoNode[] = [];
  let nodeNum = 1;
  rawNodes.forEach(rn => {
    const newId = `n_erp_${nodeNum}`;
    idMap.set(rn.id, newId);
    const p = unproject(rn.x, rn.y, rn.z, unit);
    nodes.push(makeNode(newId, {
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
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
  // Соответствие «id выработки в файле → наш id ветви» и её длина на экране:
  // нужны, чтобы привязать позиции ПЛА к выработкам и найти место выноски.
  const ribIdMap = new Map<string, { branchId: string; screenLen: number }>();
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

    const rt = ribTypes.get(f["Airflow.RibTypeId"] ?? "");

    // ── Сечение ───────────────────────────────────────────────────────────
    // Площадь берём из ветви, иначе — из типа выработки (у 343 ветвей
    // образца площадь есть, а периметр отсутствует).
    const area = num(f["Airflow.CrossSectionArea"], 0) || (rt?.area ?? 0);
    // Периметр: если не задан — восстанавливаем по ФОРМЕ сечения из
    // справочника: P = k·√S, где k — perimeterToAreaRatio (круг 3,545;
    // арочное 3,77). Без периметра сопротивление по α не считается и ветвь
    // приходила с R = 0 — именно это показывала проверка схемы.
    const sectionId = f["Airflow.CrossSectionTypeId"] || rt?.sectionId || "";
    const kShape = sectionRatio.get(sectionId)?.k ?? 0;
    let perimeter = num(f["Airflow.Perimeter"], 0);
    if (perimeter <= 0 && area > 0 && kShape > 0) perimeter = +(kShape * Math.sqrt(area)).toFixed(2);

    // ── Длина ─────────────────────────────────────────────────────────────
    // UserDefinedRibLength заполнено только там, где длина задана вручную
    // (RibLengthIsUserDefined). У остальных ветвей АэроСеть берёт длину из
    // геометрии — считаем её сами по координатам узлов, иначе L = 0 и
    // сопротивление снова обнуляется.
    const lengthManual = bool(f["Airflow.RibLengthIsUserDefined"]);
    const nA = rawNodes.get(rb.fromId), nB = rawNodes.get(rb.toId);
    const geomLen = nA && nB
      ? (() => {
          const p = unproject(nA.x, nA.y, nA.z, unit);
          const q = unproject(nB.x, nB.y, nB.z, unit);
          return Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (nB.z - nA.z) ** 2);
        })()
      : 0;
    const length = +(num(f["Airflow.UserDefinedRibLength"], 0) || geomLen).toFixed(2);

    // ── Сопротивление: перевод единиц ─────────────────────────────────────
    // ГЛАВНОЕ отличие форматов. АэроСеть хранит R в СИ (Н·с²/м⁸), а наша
    // программа — в рудничных кМюрг (кгс·с²/м⁸): 1 кМюрг = 9,81 Н·с²/м⁸.
    // Проверено на образце: R = 1,971·10⁻⁴ при Q = 56,4 м³/с даёт
    // ΔP = 0,63, и сумма депрессий контура в точности равна напору
    // вентилятора 65,55 Па — значит числа в файле паскалевые, то есть СИ.
    // Раньше значение переносилось «как есть» и сопротивления оказывались
    // занижены в 9,81 раза.
    const rUser = num(f["Airflow.UserDefinedResistance"], 0) / PA_PER_MM_H2O;
    // Коэффициент α в АэроСети — тоже СИ (Н·с²/м⁴, напр. 0,004426), а у нас
    // он вводится в привычных ×10⁻⁴ кгс·с²/м⁴. Переводим: /9,81 и ×10⁴.
    const alphaSi = num(f["Airflow.Alpha"], 0) || (surfaceAlpha.get(f["Airflow.SurfaceTypeId"] || rt?.surfaceId || "")?.alpha ?? 0);
    const alpha = alphaSi > 0 ? +(alphaSi / PA_PER_MM_H2O * 1e4).toFixed(4) : 0;

    // Способ задания сопротивления (Airflow.AirResistanceCalculationType):
    // 2 — задано пользователем, остальное — расчёт по α (его и переносим).
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
    // R перемычки в файле — в СИ (Н·с²/м⁸), наше поле — в кМюрг.
    const bkR = +((num(bf["Airflow.BulkheadUserDefinedResistance"], 0)
                || num(bf["Airflow.BulkheadCalculatedResistance"], 0)) / PA_PER_MM_H2O).toFixed(6);

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

    ribIdMap.set(rb.id, { branchId, screenLen });

    for (const it of fanItems) {
      outFans.push({ branchId, t: posOf(it.offset), fanType, name: f["Rib.Name"] || "Вентилятор" });
    }
    for (const it of bkItems) {
      // Перевод СИ → кМюрг (файл хранит Н·с²/м⁸, наше поле — кгс·с²/м⁸).
      const r = +((num(it.f["Airflow.BulkheadUserDefinedResistance"], 0)
                || num(it.f["Airflow.BulkheadCalculatedResistance"], 0)) / PA_PER_MM_H2O).toFixed(6);
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
      manualLength: lengthManual,
      resistanceMode: useManualR ? "manual" : "alpha",
      manualR: useManualR ? +rUser.toFixed(6) : 0,
      alphaCoef: alpha,
      resistance: +rUser.toFixed(6),
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
      fanCrossingR: hasFan ? +(num(ff["Airflow.VentilatorBulkheadResistance"], 0) / PA_PER_MM_H2O).toFixed(4) : 0,
      // ── Перемычка ─────────────────────────────────────────────────────
      hasBulkhead,
      bulkheadName: hasBulkhead ? "Перемычка" : "",
      // Сопротивление перемычки в файле — тоже в СИ, переводим в кМюрг.
      bulkheadR: hasBulkhead ? bkR : 0,
      bulkheadResMode: hasBulkhead ? "manual" : "project",
      bulkheadManualR: hasBulkhead ? bkR : 0,
      bulkheadAirPerm: hasBulkhead ? num(bf["Airflow.BlindBulkheadUserDefinedPermeability"], 0) : 0,
      bulkheadSurveyQ: hasBulkhead ? num(bf["Airflow.BulkheadDepressionSurveyDischarge"], 0) : 0,
      comment: f["Rib.Comment"] ?? "",
    }));
    branchNum++;
  }

  // ── Позиции ПЛА ───────────────────────────────────────────────────────────
  // Позиции лежат ОТДЕЛЬНО от вентиляционной сети — в <nodes><node itemCode>:
  //   1001 — сама позиция (номер, цвет, вид аварии, привязанные выработки),
  //   1006 — «тень» позиции: дублирующая выноска той же позиции на другом
  //          участке схемы (ссылается на основную через MainPositionId),
  //   1003/1004/1101 — легенда, текстовая заметка, таблица (не позиции).
  // Выноска задаётся <refMark ribId segmentOffset> — как и объекты на ветви.
  const ventModeNames = new Map<string, string>();
  const vmEntry = zip.file(/ErpVentModes\.DataDocument$/i)[0];
  if (vmEntry) {
    const vmDoc = new DOMParser().parseFromString(decodeXml(await vmEntry.async("uint8array")), "application/xml");
    vmDoc.querySelectorAll("ventMode").forEach(v => {
      const id = v.getAttribute("id");
      if (id) ventModeNames.set(id, v.getAttribute("name") ?? "");
    });
  }

  const ACCIDENTS: Record<string, string> = {
    "0": "Нет", "1": "Пожар", "2": "Взрыв", "3": "Внезапный выброс", "4": "Загазирование",
  };

  const positions: ErpPosition[] = [];
  const shadowsByMain = new Map<string, ErpLeader[]>();
  const posElems: Element[] = [];

  const leaderOf = (n: Element): ErpLeader | null => {
    const rm = n.querySelector("refMarks > refMark");
    if (!rm) return null;
    const ribId = rm.getAttribute("ribId") ?? "";
    const link = ribIdMap.get(ribId);
    if (link) {
      const off = num(rm.getAttribute("segmentOffset"), -1);
      const t = link.screenLen > 1e-6 && off >= 0
        ? Math.min(1, Math.max(0, off / link.screenLen)) : 0.5;
      return { branchId: link.branchId, t: +t.toFixed(4), endX: null, endY: null };
    }
    return null;
  };

  doc.querySelectorAll("nodes > node").forEach(n => {
    const code = n.getAttribute("itemCode") ?? "";
    if (code === "1001") { posElems.push(n); return; }
    if (code === "1006") {
      const f = readFields(n);
      const main = f["PlanPositionShadow.MainPositionId"] ?? "";
      const l = leaderOf(n);
      if (main && l) {
        if (!shadowsByMain.has(main)) shadowsByMain.set(main, []);
        shadowsByMain.get(main)!.push(l);
      }
    }
  });

  let skippedPos = 0;
  for (const n of posElems) {
    const f = readFields(n);
    const rawNumber = (f["PlanPosition.Name"] ?? "").trim();
    const numParsed = parseInt(rawNumber.replace(/\D+/g, ""), 10);

    // Привязанные выработки: «ribId#True;ribId#True…»
    const branchIds: string[] = [];
    for (const part of (f["PlanPosition.PositionRibs"] ?? "").split(";")) {
      const rid = part.split("#")[0].trim();
      const link = rid ? ribIdMap.get(rid) : undefined;
      if (link) branchIds.push(link.branchId);
    }

    const main = leaderOf(n);
    // Если явной выноски нет — цепляем к первой привязанной выработке,
    // иначе маркер повиснет в стороне от схемы.
    const leaderBranchId = main?.branchId ?? branchIds[0] ?? null;
    const leaderT = main?.t ?? (branchIds[0] ? 0.5 : null);
    if (!leaderBranchId) skippedPos++;

    // Радиус в файле — в экранных единицах; диаметр маркера у нас в мм.
    const radius = num(f["PlanPosition.Radius"], 0);
    const diameter = radius > 0 ? +(radius * 2 * 0.2646).toFixed(1) : 13;

    // Координаты маркера разворачиваем той же обратной проекцией, что и узлы,
    // иначе позиции лягут в стороне от схемы.
    const posZ = num(n.getAttribute("z"));
    const posXY = unproject(num(n.getAttribute("x")), num(n.getAttribute("y")), posZ, unit);

    positions.push({
      number: Number.isFinite(numParsed) ? numParsed : positions.length + 1,
      name: rawNumber,
      x: +posXY.x.toFixed(2),
      y: +posXY.y.toFixed(2),
      z: posZ,
      color: intColorToHex(f["PlanPosition.BackgroundColor"]),
      borderColor: intColorToHex(f["PlanPosition.BorderColor"]),
      diameter,
      font: f["PlanPosition.FontFamily"] || "GOST type A",
      accidentType: ACCIDENTS[String(f["Position.AccidentType"] ?? "")] ?? "Пожар",
      positionType: bool(f["Position.IsReverse"]) ? "reverse" : "normal",
      ventMode: ventModeNames.get(f["Position.VentMode"] ?? "") ?? "",
      isMineWide: bool(f["Position.IsAppliedToAllRibs"]),
      branchIds,
      leaderBranchId,
      leaderT,
      extraLeaders: shadowsByMain.get(n.getAttribute("id") ?? "") ?? [],
    });
  }
  positions.sort((a, b) => a.number - b.number);
  log.push(`позиций ПЛА: ${positions.length}` + (skippedPos > 0 ? ` (без привязки к выработке: ${skippedPos})` : ""));

  if (skipped > 0) warnings.push(`Пропущено выработок без узлов: ${skipped}`);
  if (nodes.every(n => n.z === 0)) warnings.push("У всех узлов нулевая отметка — в проекте не заданы глубины");

  // Контроль качества переноса: ветви без сечения или без длины считаться не
  // будут — предупреждаем сразу, а не после расчёта.
  const noArea = branches.filter(b => b.area <= 0).length;
  const noLen  = branches.filter(b => b.length <= 0).length;
  const noPer  = branches.filter(b => b.perimeter <= 0).length;
  if (noArea > 0) warnings.push(`Выработок без сечения: ${noArea} — задайте площадь, иначе сопротивление не рассчитается`);
  if (noLen > 0)  warnings.push(`Выработок с нулевой длиной: ${noLen}`);
  if (noPer > 0)  warnings.push(`Выработок без периметра: ${noPer}`);
  log.push(`сопротивление: перевод СИ → кМюрг (÷${PA_PER_MM_H2O}); ветвей без S: ${noArea}, без P: ${noPer}, без L: ${noLen}`);

  const byType = outFans.reduce<Record<string, number>>((a, x) => { a[x.fanType] = (a[x.fanType] ?? 0) + 1; return a; }, {});
  log.push(`импортировано: узлов ${nodes.length}, ветвей ${branches.length}, вент. ${fans} (${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}), перемычек ${bulkheads}`);

  return {
    nodes,
    branches,
    horizons,
    bulkheads: outBulkheads,
    fans: outFans,
    positions,
    warnings,
    stats: { nodes: nodes.length, branches: branches.length, fans, bulkheads, horizons: horizons.length, positions: positions.length },
    debug: log.join("\n"),
  };
}