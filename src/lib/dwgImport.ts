// ─────────────────────────────────────────────────────────────────────────────
// dwgImport.ts — импорт чертежей DWG (nanoCAD, AutoCAD).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ.
// DXF — текстовый формат, его разбирает dxfImport.ts построчно. DWG —
// проприетарный ДВОИЧНЫЙ формат, читать его тем же кодом невозможно.
// Чтобы не смешивать два разных мира, здесь решается ровно одна задача:
//
//     двоичный DWG  →  текст DXF  →  parseDxf() (существующий разбор)
//
// Вся геометрия, кластеризация узлов, распознавание осевых слоёв, сечения и
// масштаб остаются в dxfImport.ts. Этот модуль их НЕ дублирует: если завтра
// поправить логику разбора, исправление автоматически подхватит и DWG.
//
// КАК ЧИТАЕТСЯ DWG.
// Библиотека LibreDWG (сборка WebAssembly) открывает файл и отдаёт объекты
// чертежа как JavaScript-структуры. Мы перекладываем их в текст DXF —
// только те типы, которые нужны для топологии сети.
//
// ВАЖНО ПРО ВЕС. Библиотека весит около 10 МБ и грузится ТОЛЬКО когда
// пользователь реально открывает DWG (динамический import ниже). Пользователи,
// которые импортируют DXF или вовсе не пользуются импортом, её не скачивают.
//
// ВАЖНО ПРО КОДИРОВКУ. LibreDWG отдаёт имена слоёв уже в UTF-8, поэтому
// собранный DXF передаётся в parseDxf как обычная строка. Русские названия
// слоёв («[Факт] Выработки -40») распознаются осевыми — на них держится
// определение ветвей.
// ─────────────────────────────────────────────────────────────────────────────

import { parseDxf, type DxfImportResult } from "@/lib/dxfImport";

/** Результат импорта DWG — тот же, что у DXF, плюс сведения о самом файле */
export interface DwgImportResult extends DxfImportResult {
  /** Версия формата DWG (например, AC1032 — AutoCAD 2018) */
  dwgVersion: string;
  /** Сколько объектов чертежа прочитано всего */
  entitiesTotal: number;
  /** Сколько объектов перенесено в разбор (остальные — оформление) */
  entitiesUsed: number;
  /**
   * Текст DXF, полученный из чертежа. Нужен диалогу импорта: когда пользователь
   * двигает точность склейки узлов, схему пересобирают из этого текста, не
   * перечитывая двоичный файл заново (чтение занимает несколько секунд).
   */
  dxfText: string;
}

/** Типы объектов чертежа, которые несут геометрию сети */
const USED_TYPES = new Set([
  "LINE", "LWPOLYLINE", "POLYLINE", "POLYLINE2D", "POLYLINE3D",
  "CIRCLE", "TEXT", "MTEXT",
]);

/**
 * Сборщик текста DXF.
 * DXF устроен как пары строк: код группы, затем значение. Например
 * код 8 — имя слоя, 10/20/30 — координаты X/Y/Z. Пишем ровно этот формат.
 */
class DxfWriter {
  private out: string[] = [];

  pair(code: number, value: string | number): void {
    this.out.push(String(code));
    this.out.push(typeof value === "number" ? fmt(value) : value);
  }

  text(): string {
    return this.out.join("\n");
  }
}

/** Число в текст без экспоненциальной записи — её DXF не понимает */
function fmt(v: number): string {
  if (!isFinite(v)) return "0";
  return Math.abs(v) < 1e-9 ? "0" : v.toFixed(6).replace(/\.?0+$/, "") || "0";
}

/** Точка чертежа: у разных объектов координаты лежат в разных полях */
interface DwgPoint { x?: number; y?: number; z?: number }

/** Объект чертежа в том виде, в каком его отдаёт библиотека */
interface DwgEntity {
  type?: string;
  layer?: string;
  startPoint?: DwgPoint;
  endPoint?: DwgPoint;
  center?: DwgPoint;
  insertionPoint?: DwgPoint;
  position?: DwgPoint;
  radius?: number;
  elevation?: number;
  flag?: number;
  closed?: boolean;
  text?: string;
  vertices?: DwgPoint[];
}

const num = (v: number | undefined): number => (typeof v === "number" && isFinite(v) ? v : 0);

/**
 * Перекладывает объекты чертежа в текст DXF.
 *
 * Переносим только то, что нужно топологии: отрезки и полилинии (оси
 * выработок и контуры сечений), окружности (узлы) и подписи (номера, имена).
 * Штриховки, размеры, таблицы и рамки пропускаем — на схему сети они не влияют,
 * а разбор только замедляют.
 */
function entitiesToDxf(entities: DwgEntity[]): { dxf: string; used: number } {
  const w = new DxfWriter();
  w.pair(0, "SECTION");
  w.pair(2, "ENTITIES");

  let used = 0;

  for (const e of entities) {
    const type = e.type ?? "";
    if (!USED_TYPES.has(type)) continue;
    const layer = e.layer || "0";

    // ── Отрезок ──────────────────────────────────────────────────────────
    if (type === "LINE" && e.startPoint && e.endPoint) {
      w.pair(0, "LINE");
      w.pair(8, layer);
      w.pair(10, num(e.startPoint.x));
      w.pair(20, num(e.startPoint.y));
      w.pair(30, num(e.startPoint.z));
      w.pair(11, num(e.endPoint.x));
      w.pair(21, num(e.endPoint.y));
      w.pair(31, num(e.endPoint.z));
      used++;
      continue;
    }

    // ── Полилиния (все разновидности пишем как LWPOLYLINE) ───────────────
    // У плоской полилинии высота хранится отдельным полем elevation,
    // у пространственной — своя Z у каждой вершины. Учитываем оба случая,
    // иначе плоские выработки «схлопнутся» на нулевую отметку.
    if (type.startsWith("POLYLINE") || type === "LWPOLYLINE") {
      const pts = e.vertices ?? [];
      if (pts.length < 2) continue;
      const closed = e.closed === true || ((e.flag ?? 0) & 1) === 1;
      w.pair(0, "LWPOLYLINE");
      w.pair(8, layer);
      w.pair(90, pts.length);
      w.pair(70, closed ? 1 : 0);
      for (const p of pts) {
        w.pair(10, num(p.x));
        w.pair(20, num(p.y));
        w.pair(30, p.z !== undefined ? num(p.z) : num(e.elevation));
      }
      used++;
      continue;
    }

    // ── Окружность (узел сети) ───────────────────────────────────────────
    if (type === "CIRCLE" && e.center) {
      w.pair(0, "CIRCLE");
      w.pair(8, layer);
      w.pair(10, num(e.center.x));
      w.pair(20, num(e.center.y));
      w.pair(30, num(e.center.z));
      w.pair(40, num(e.radius));
      used++;
      continue;
    }

    // ── Подпись (номер узла, имя выработки) ──────────────────────────────
    if ((type === "TEXT" || type === "MTEXT") && e.text) {
      const p = e.startPoint ?? e.insertionPoint ?? e.position;
      if (!p) continue;
      w.pair(0, type);
      w.pair(8, layer);
      w.pair(10, num(p.x));
      w.pair(20, num(p.y));
      w.pair(30, num(p.z));
      w.pair(1, e.text);
      used++;
    }
  }

  w.pair(0, "ENDSEC");
  w.pair(0, "EOF");
  return { dxf: w.text(), used };
}

/**
 * Читает чертёж DWG и строит схему сети.
 *
 * @param buffer   содержимое файла .dwg
 * @param epsilon  радиус склейки близких точек в узел (как у DXF-импорта)
 */
export async function parseDwg(
  buffer: ArrayBuffer,
  epsilon?: number,
): Promise<DwgImportResult> {
  // Библиотека тяжёлая (~10 МБ), поэтому грузим её только сейчас — в момент,
  // когда пользователь действительно открыл файл DWG.
  const { LibreDwg, Dwg_File_Type } = await import("@mlightcad/libredwg-web");

  const lib = await LibreDwg.create();

  // Указатель на прочитанный чертёж в памяти WebAssembly
  let dwg: number | undefined;
  try {
    dwg = lib.dwg_read_data(buffer, Dwg_File_Type.DWG);
  } catch {
    throw new Error(
      "Не удалось прочитать файл DWG. Возможно, файл повреждён или сохранён " +
      "в неподдерживаемой версии. Сохраните чертёж в формате DXF и импортируйте его.",
    );
  }
  if (!dwg) {
    throw new Error(
      "Файл DWG не распознан. Сохраните чертёж в формате DXF и импортируйте его.",
    );
  }

  // Версия формата: библиотека отдаёт объект, из которого нам нужно
  // человекочитаемое описание вида «AutoCAD 2018» — его и показываем.
  let version = "";
  try {
    const v = lib.dwg_get_version_type(dwg) as
      { description?: string; hdr?: string; type?: string } | undefined;
    version = v?.description || v?.hdr || v?.type || "";
  } catch {
    version = "";
  }

  const db = lib.convert(dwg) as { entities?: DwgEntity[] } | null;
  // Память WebAssembly не освобождается сама — чертежи большие, утечка
  // при нескольких импортах подряд заметна.
  try {
    lib.dwg_free(dwg);
  } catch {
    /* освобождение не критично */
  }

  const entities = db?.entities ?? [];
  if (entities.length === 0) {
    throw new Error(
      "В чертеже DWG не найдено ни одного объекта. Проверьте, что схема " +
      "находится в пространстве модели, а не в листе.",
    );
  }

  const { dxf, used } = entitiesToDxf(entities);
  if (used === 0) {
    throw new Error(
      `В чертеже прочитано ${entities.length} объектов, но среди них нет линий ` +
      "и полилиний — строить схему не из чего. Проверьте, что выработки " +
      "начерчены линиями, а не блоками или штриховкой.",
    );
  }

  const result = parseDxf(dxf, epsilon);

  return {
    ...result,
    warnings: [
      `Файл DWG${version ? ` (${version})` : ""}: прочитано ${entities.length} объектов, ` +
      `в расчёт взято ${used} (линии, полилинии, окружности, подписи).`,
      ...result.warnings,
    ],
    dwgVersion: version,
    entitiesTotal: entities.length,
    entitiesUsed: used,
    dxfText: dxf,
  };
}