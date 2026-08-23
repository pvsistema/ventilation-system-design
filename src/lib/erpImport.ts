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
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from "jszip";
import { makeNode, makeBranch, type TopoNode, type TopoBranch, type Horizon } from "@/lib/topology";

export interface ErpImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  warnings: string[];
  stats: { nodes: number; branches: number; fans: number; bulkheads: number; horizons: number };
  debug: string;
}

// Коды объектов на ветви (<ribItem itemCode>). Одного кода мало: АэроСеть
// нумерует объекты по КАРТИНКЕ (глухая перемычка, ляда, вентдверь, кроссинг —
// разные коды), и в разных проектах набор отличается. Поэтому опознаём по
// сопутствующим полям, а списки ниже — лишь быстрый путь для известных кодов.
// Собрано по реальным проектам: 8, 15, 92, 99, 101, 110 — перемычки/двери,
// 68, 89 — изолирующие перемычки (Seal*), 16, 18 — вентиляторы (ВМП и ГВУ).
const ITEM_BULKHEAD = new Set(["8", "15", "68", "89", "92", "99", "101", "110"]);
const ITEM_FAN = new Set(["16", "18"]);

// Признаки в полях самого объекта — надёжнее кода, работают на любом проекте.
const FAN_FIELDS = ["Airflow.FanPressure", "Airflow.IdealVentilatorPressure", "Airflow.VentilatorType"];
const BULKHEAD_FIELDS = [
  "Airflow.BulkheadUserDefinedResistance", "Airflow.BulkheadCalculatedResistance",
  "Airflow.VentWindowArea", "SealType", "SealQ",
];

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

/** Собирает <field name=… value=…> элемента в обычный словарь. */
function readFields(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  el.querySelectorAll("field").forEach(f => {
    const n = f.getAttribute("name");
    if (n) out[n] = f.getAttribute("value") ?? "";
  });
  return out;
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
  // Формы сечения: хранят отношение периметра к корню из площади (P = k·√S).
  // Нужны потому, что периметр записан лишь у части выработок, а без него
  // нельзя посчитать сопротивление по коэффициенту α.
  const crossTypes = new Map<string, { name: string; k: number }>();
  const rtEntry = zip.file(/RibTypeService\.DataDocument$/i)[0];
  if (rtEntry) {
    const rtDoc = new DOMParser().parseFromString(decodeXml(await rtEntry.async("uint8array")), "application/xml");
    rtDoc.querySelectorAll("ribType").forEach(t => {
      const id = t.getAttribute("id");
      if (id) ribTypes.set(id, { name: t.getAttribute("name") ?? "", vMax: num(t.getAttribute("defaultMaxAirVelocity"), 0) });
    });
    rtDoc.querySelectorAll("crossSectionType").forEach(t => {
      const id = t.getAttribute("id");
      if (id) crossTypes.set(id, { name: t.getAttribute("name") ?? "", k: num(t.getAttribute("perimeterToAreaRatio"), 0) });
    });
    log.push(`типов выработок: ${ribTypes.size}, форм сечения: ${crossTypes.size}`);
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
  interface RawItem { code: string; description: string; f: Record<string, string> }
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
        items.push({
          code: it.getAttribute("itemCode") ?? "",
          description: it.getAttribute("description") ?? "",
          f: readFields(it),
        });
      });
      rawBranches.push({ id, fromId, toId, horizonId: lid, f: readFields(rib), items, thickness: num(rib.getAttribute("thickness"), 3) });
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
  const idMap = new Map<string, string>();
  const nodes: TopoNode[] = [];
  let nodeNum = 1;
  rawNodes.forEach(rn => {
    const newId = `n_erp_${nodeNum}`;
    idMap.set(rn.id, newId);
    const p = toPlan(rn.x, rn.y, rn.z);
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
  let fans = 0, bulkheads = 0, skipped = 0, branchNum = 1;

  for (const rb of rawBranches) {
    const fromId = idMap.get(rb.fromId);
    const toId = idMap.get(rb.toId);
    if (!fromId || !toId) { skipped++; continue; }
    const f = rb.f;

    const area = num(f["Airflow.CrossSectionArea"], 0);
    // Периметр записан не у всех выработок. Если его нет — восстанавливаем по
    // форме сечения (P = k·√S): без периметра не считается сопротивление по α.
    const ct = crossTypes.get(f["Airflow.CrossSectionTypeId"] ?? "");
    const perimeter = num(f["Airflow.Perimeter"], 0)
      || (ct && ct.k > 0 && area > 0 ? +(ct.k * Math.sqrt(area)).toFixed(3) : 0);

    // Длину АэроСеть хранит только когда её задали вручную; в остальных случаях
    // она берётся из чертежа. Считаем её сами по координатам — с учётом
    // перепада отметок, иначе наклонные выработки и стволы окажутся короче.
    const na = rawNodes.get(rb.fromId)!, nb = rawNodes.get(rb.toId)!;
    const pa = toPlan(na.x, na.y, na.z), pb = toPlan(nb.x, nb.y, nb.z);
    const geomLength = Math.hypot(pb.x - pa.x, pb.y - pa.y, nb.z - na.z);
    const userLength = num(f["Airflow.UserDefinedRibLength"], 0);
    const length = +(userLength > 0 ? userLength : geomLength).toFixed(2);
    const rUser = num(f["Airflow.UserDefinedResistance"], 0);
    const alpha = num(f["Airflow.Alpha"], 0);
    const rt = ribTypes.get(f["Airflow.RibTypeId"] ?? "");

    // Способ задания сопротивления (Airflow.AirResistanceCalculationType).
    // По образцу: 2 = задано пользователем (UserDefinedResistance). Прочие
    // значения означают расчёт по α — тогда переносим α, а R пересчитает солвер.
    const rMode = String(f["Airflow.AirResistanceCalculationType"] ?? "");
    const useManualR = rMode === "2" && rUser > 0;

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

    // Депрессия вентилятора: в АэроСети Па, у нас тоже Па. Значения лежат в
    // полях самого объекта, а не ветви (на ветви они есть не всегда).
    const ff = fanItem?.f ?? {};
    const bf = bulkItem?.f ?? {};
    const fanPressure = num(ff["Airflow.FanPressure"], 0)
      || num(ff["Airflow.IdealVentilatorPressure"], 0)
      || num(f["Airflow.FanPressure"], 0)
      || num(f["Airflow.IdealVentilatorPressure"], 0);
    // Сопротивление перемычки: заданное пользователем, иначе расчётное.
    const bulkR = num(bf["Airflow.BulkheadUserDefinedResistance"], 0)
      || num(bf["Airflow.BulkheadCalculatedResistance"], 0)
      || num(f["Airflow.BulkheadUserDefinedResistance"], 0)
      || num(f["Airflow.BulkheadCalculatedResistance"], 0);

    branches.push(makeBranch(`b_erp_${branchNum}`, fromId, toId, {
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
      manualLength: true,   // длина уже известна (задана в файле или по чертежу)
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
      fanMode: "constant",
      fanPressure: hasFan ? fanPressure : 0,
      fanName: hasFan ? (fanItem?.description || f["Rib.Name"] || "Вентилятор") : "",
      fanEfficiency: hasFan ? num(ff["Airflow.IdealVentilatorEfficiency"], 0) : 0,
      fanParallel: hasFan ? Math.max(1, Math.round(num(ff["Airflow.VentilatorsInParallel"], 1))) : 1,
      fanRpm: hasFan ? num(ff["Airflow.VentilatorSpeed"], 0) : 0,
      // ── Перемычка ─────────────────────────────────────────────────────
      hasBulkhead,
      bulkheadName: hasBulkhead ? (bulkItem?.description || "Перемычка") : "",
      // АэроСеть хранит сопротивление перемычки в кМюрг — как и наше поле.
      bulkheadR: hasBulkhead ? bulkR : 0,
      bulkheadResMode: hasBulkhead ? "manual" : "project",
      bulkheadManualR: hasBulkhead ? bulkR : 0,
      bulkheadSurveyQ: hasBulkhead ? num(bf["Airflow.BulkheadDepressionSurveyDischarge"], 0) : 0,
      comment: f["Rib.Comment"] ?? "",
    }));
    branchNum++;
  }

  if (skipped > 0) warnings.push(`Пропущено выработок без узлов: ${skipped}`);
  if (nodes.every(n => n.z === 0)) warnings.push("У всех узлов нулевая отметка — в проекте не заданы глубины");

  log.push(`импортировано: узлов ${nodes.length}, ветвей ${branches.length}, вент. ${fans}, перемычек ${bulkheads}`);

  return {
    nodes,
    branches,
    horizons,
    warnings,
    stats: { nodes: nodes.length, branches: branches.length, fans, bulkheads, horizons: horizons.length },
    debug: log.join("\n"),
  };
}