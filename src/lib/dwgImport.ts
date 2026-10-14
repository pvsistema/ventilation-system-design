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
// Чертёж переводится в DXF на сервере (облачная функция dwg-convert;
// на резервном сервере — её копия, см. mirror-server/dwg_runner.cjs).
// В саму программу библиотека чтения DWG не входит: файл уходит на сервер
// в сжатом виде, обратно приходит сжатый текст DXF.
//
// ВАЖНО ПРО КОДИРОВКУ. Сервер отдаёт имена слоёв уже в UTF-8, поэтому
// собранный DXF передаётся в parseDxf как обычная строка. Русские названия
// слоёв («[Факт] Выработки -40») распознаются осевыми — на них держится
// определение ветвей.
// ─────────────────────────────────────────────────────────────────────────────

import { parseDxf, type DxfImportResult } from "@/lib/dxfImport";
import { DWG_CONVERT_URL } from "@/lib/api-urls";
import { backupServerUrl } from "@/lib/computeServer";

/** Резервный сервер на случай, если облако не справилось с большим чертежом */
const DEFAULT_BACKUP = "https://pvsistema.ru/";

function backupDwgUrl(): string {
  const base = (backupServerUrl() || DEFAULT_BACKUP).replace(/\/+$/, "");
  return `${base}/api/dwg-convert`;
}

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

async function gzipToBase64(buffer: ArrayBuffer): Promise<string> {
  const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function gunzipBase64(b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * Читает чертёж DWG и строит схему сети.
 * Сам DWG переводится в DXF на сервере, разбор схемы — здесь, как у DXF.
 */
export async function parseDwg(
  buffer: ArrayBuffer,
  epsilon?: number,
  onlyLayers?: string[],
  axisOverride?: string[],
): Promise<DwgImportResult> {
  if (!DWG_CONVERT_URL) throw new Error("Сервис чтения DWG недоступен. Сохраните чертёж в формате DXF.");

  const body = JSON.stringify({ fileGzip: await gzipToBase64(buffer) });
  const send = (url: string) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });

  // Сначала облако. Большие чертежи облаку не хватает памяти (ошибка 5xx) —
  // тогда переводим на своём резервном сервере, где памяти достаточно.
  let resp: Response | null = null;
  try {
    resp = await send(DWG_CONVERT_URL);
  } catch {
    resp = null;
  }
  const backup = backupDwgUrl();
  // 413 — облако не принимает запросы больше 3,5 МБ (чертёж 6 МБ после сжатия
  // занимает ~5 МБ). Раньше на этот ответ резерв не пробовали, и большой
  // чертёж сразу отклонялся, хотя резервный сервер его читает.
  if ((!resp || resp.status >= 500 || resp.status === 413) && backup !== DWG_CONVERT_URL) {
    try {
      resp = await send(backup);
    } catch {
      /* резерв тоже недоступен — сообщим ниже */
    }
  }
  if (!resp) {
    throw new Error(
      "Нет связи с сервером чтения DWG. Проверьте интернет или сохраните чертёж в формате DXF.",
    );
  }

  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean; error?: string; version?: string; total?: number; used?: number; dxfGzip?: string;
  };
  if (!resp.ok || !data.dxfGzip) {
    throw new Error(
      data.error ||
      (resp.status === 413
        ? "Файл DWG слишком большой для передачи. Сохраните чертёж в формате DXF."
        : resp.status >= 500
          ? "Чертёж слишком большой для сервера чтения DWG. Сохраните его в формате DXF и импортируйте."
          : "Не удалось прочитать файл DWG. Сохраните чертёж в формате DXF и импортируйте его."),
    );
  }

  const dxf = await gunzipBase64(data.dxfGzip);
  const version = data.version ?? "";
  const total = data.total ?? 0;
  const used = data.used ?? 0;
  const result = parseDxf(dxf, epsilon, onlyLayers, axisOverride);

  return {
    ...result,
    warnings: [
      `Файл DWG${version ? ` (${version})` : ""}: прочитано ${total} объектов, ` +
      `в расчёт взято ${used} (линии, полилинии, окружности, подписи).`,
      ...result.warnings,
    ],
    dwgVersion: version,
    entitiesTotal: total,
    entitiesUsed: used,
    dxfText: dxf,
  };
}