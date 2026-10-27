// ─────────────────────────────────────────────────────────────────────────────
// Отметка лицензии в выпускаемых документах (отчёты, акты, таблицы, чертежи).
//
// ЗАЧЕМ. Расчётное ядро проверяет лицензию и подписано, но программа для
// компьютера в принципе не может быть защищена полностью: достаточно упорного
// человека, чтобы обойти любую проверку. Поэтому к защите добавляется след:
// каждый документ, выпущенный программой, несёт отметку о том, кому выдана
// лицензия и на каком рабочем месте он сделан. Документ почти всегда уходит
// дальше — заказчику, в надзор, в проект, — и по отметке видно, из какой копии
// он вышел. Это не мешает честному пользователю (в отметке только его же
// организация) и делает распространение взломанной копии прослеживаемым.
//
// Отметка НЕ является защитой и ничего не блокирует: документ выпускается
// в любом случае, даже без лицензии — тогда в отметке стоит «без лицензии».
// ─────────────────────────────────────────────────────────────────────────────
import { loadCachedLicense, checkOfflineEmergency } from "@/lib/license";
import { getSeatCode } from "@/lib/offlineKey";
import { APP_VERSION } from "@/lib/appVersion";

export interface DocMark {
  /** Организация из лицензии (или «без лицензии»). */
  owner: string;
  /** Код рабочего места — 8 знаков отпечатка, как в окне «Лицензия». */
  seat: string;
  /** Ключ лицензии в усечённом виде: по нему она находится в реестре. */
  keyShort: string;
  /** Дата выпуска документа, ДД.ММ.ГГГГ. */
  date: string;
  /** true — лицензии нет; документ помечается как демонстрационный. */
  unlicensed: boolean;
}

/** Ключ — только начало и конец: достаточно для поиска, не раскрывает ключ. */
function shortenKey(key?: string): string {
  const k = (key ?? "").trim();
  if (!k) return "";
  // Аварийный ключ PVSO.<payload>.<sig> — берём начало подписи: она уникальна.
  if (k.startsWith("PVSO.")) {
    const sig = k.split(".")[2] ?? "";
    return sig ? `PVSO-${sig.slice(0, 8).toUpperCase()}` : "PVSO";
  }
  return k.length <= 12 ? k.toUpperCase()
    : `${k.slice(0, 6)}…${k.slice(-4)}`.toUpperCase();
}

/**
 * Данные отметки на момент выпуска документа.
 *
 * Читается из того же кэша лицензии, что и окно «Лицензия», поэтому работает
 * синхронно и без сети: выпуск документа на руднике не должен ждать сервер.
 */
export function getDocMark(): DocMark {
  let info = null as ReturnType<typeof loadCachedLicense>;
  try { info = loadCachedLicense(); } catch { /* ignore */ }
  if (!info?.licensed) {
    try {
      const em = checkOfflineEmergency();
      if (em?.licensed) info = em;
    } catch { /* ignore */ }
  }
  const licensed = !!info?.licensed;
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  return {
    owner: licensed ? (info?.owner || "лицензия без указания организации") : "без лицензии",
    seat: getSeatCode() ?? "",
    keyShort: licensed ? shortenKey(info?.key) : "",
    date,
    unlicensed: !licensed,
  };
}

/**
 * Строка отметки для колонтитула документа.
 * Пример: «ПВ-Система 2.1.0 · ООО «Рудник» · место A1B2C3D4 · ключ PVS-…-7F2A · 27.10.2026»
 */
export function docMarkLine(m: DocMark = getDocMark()): string {
  const parts = [`ПВ-Система ${APP_VERSION}`, m.owner];
  if (m.seat) parts.push(`место ${m.seat}`);
  if (m.keyShort) parts.push(`ключ ${m.keyShort}`);
  parts.push(m.date);
  return parts.join(" · ");
}

/** Короткая отметка для тесных мест (чертёж, угол листа). */
export function docMarkShort(m: DocMark = getDocMark()): string {
  const parts = [m.owner];
  if (m.seat) parts.push(m.seat);
  return parts.join(" · ");
}

/** Свойства файла (автор/примечание), которые остаются в метаданных документа. */
export function docMarkProps(m: DocMark = getDocMark()): {
  creator: string; lastModifiedBy: string; description: string; keywords: string;
} {
  return {
    creator: "ПВ-Система",
    lastModifiedBy: m.owner,
    description: docMarkLine(m),
    keywords: [m.owner, m.seat, m.keyShort].filter(Boolean).join("; "),
  };
}

// ─── Книга Excel ─────────────────────────────────────────────────────────────

/** Минимальная часть книги exceljs, которая нужна для простановки отметки. */
interface MarkableWorkbook {
  creator: string;
  lastModifiedBy: string;
  company: string;
  description: string;
  keywords: string;
  worksheets: { headerFooter: { oddFooter?: string } }[];
}

/**
 * Проставляет отметку лицензии в книге Excel: в свойства файла и в нижний
 * колонтитул каждого листа (виден при печати и в разметке страницы).
 *
 * Вызывать ПОСЛЕ создания всех листов, прямо перед wb.xlsx.writeBuffer().
 */
export function markWorkbook(wb: MarkableWorkbook, m: DocMark = getDocMark()): void {
  const props = docMarkProps(m);
  wb.creator = props.creator;
  wb.lastModifiedBy = props.lastModifiedBy;
  wb.company = m.owner;
  wb.description = props.description;
  wb.keywords = props.keywords;

  // &L — слева, &9 — кегль 9. Амперсанд в названии организации экранируем:
  // в колонтитулах Excel «&» — служебный символ.
  const left = `&L&9${docMarkLine(m).replace(/&/g, "&&")}`;
  for (const ws of wb.worksheets ?? []) {
    const prev = ws.headerFooter?.oddFooter ?? "";
    // Нумерация страниц, если она уже задана листом, сохраняется справа.
    ws.headerFooter.oddFooter = prev ? `${left}${prev}` : left;
  }
}
