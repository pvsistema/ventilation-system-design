// ─────────────────────────────────────────────────────────────────────────────
// desktopPrint.ts — печать через десктопную оболочку (C# / WebView2).
//
// ЗАЧЕМ. В браузере печать возможна только через window.print(), который
// открывает СВОЁ системное окно: инженер второй раз выбирает принтер, поля и
// формат, уже настроенные в нашем диалоге предпросмотра. Убрать это окно из
// веб-части нельзя — страница принципиально не имеет доступа к принтерам
// операционной системы, браузеры это запрещают.
//
// В десктопной сборке (WebView2) ограничения нет: оболочка может получить
// список принтеров Windows и напечатать документ напрямую, без второго окна.
// Здесь — веб-половина этого моста. C#-половину нужно дописать в
// desktop/csharp/PvsApp/MainWindow.xaml.cs (см. DESKTOP_PRINT_CONTRACT ниже).
//
// ВАЖНО: пока C#-часть не собрана, isDesktopPrintAvailable() возвращает false
// и диалог печати работает по-старому — через системное окно браузера.
// ─────────────────────────────────────────────────────────────────────────────

/** Принтер, как его отдаёт Windows. */
export interface DesktopPrinter {
  name: string;
  isDefault: boolean;
}

/** Итог печати: удалась ли и почему нет. */
export interface PrintResult {
  ok: boolean;
  /** Причина отказа для показа пользователю. Пустая строка — причина неизвестна. */
  error: string;
}

/** Параметры задания печати, которые задаются в нашем диалоге. */
export interface DesktopPrintJob {
  /** Готовый HTML документа (те же листы, что уходят в системную печать). */
  html: string;
  /** Имя принтера из списка Windows. Пустая строка — принтер по умолчанию. */
  printerName: string;
  /** Число копий (1..99). */
  copies: number;
  /** Ширина листа, мм. */
  paperWidthMm: number;
  /** Высота листа, мм. */
  paperHeightMm: number;
  /** Альбомная ориентация. */
  landscape: boolean;
}

type PvsWindow = Window & {
  __IS_DESKTOP__?: boolean;
  /** Версия контракта печати в C#-оболочке. Появляется только там, где мост собран. */
  __PVS_PRINT_API__?: number;
  chrome?: { webview?: { postMessage: (s: string) => void } };
  __pvsCsReply?: (reqId: string, payload: unknown) => void;
};

/**
 * Контракт с C#-оболочкой (что нужно дописать в MainWindow.xaml.cs):
 *
 * 1. В BuildJsBootstrap() добавить:  window.__PVS_PRINT_API__ = 1;
 *    Только по этому признаку веб-часть понимает, что печать без второго окна
 *    доступна. Без него всё работает по-старому — программа не сломается на
 *    старой версии оболочки.
 *
 * 2. В OnWebMessage() добавить две команды:
 *
 *    case "list-printers":
 *        // new PrintServer().GetPrintQueues() либо
 *        // System.Drawing.Printing.PrinterSettings.InstalledPrinters
 *        // Ответ: ReplyToJs(reqId, new { printers = new[] {
 *        //     new { name = "HP LaserJet", isDefault = true }, ... } });
 *
 *    case "print-html":
 *        // Параметры: html, printerName, copies, paperWidthMm,
 *        //            paperHeightMm, landscape.
 *        // Печать: создать скрытый WebView2, NavigateToString(html), затем
 *        // CoreWebView2.PrintAsync(printSettings) — в WebView2 1.0.2739.15
 *        // этот метод есть и печатает БЕЗ показа системного окна.
 *        // В printSettings проставить PrinterName, Copies, PageWidth/PageHeight
 *        // (в дюймах: мм / 25.4), Orientation, ShouldPrintBackgrounds = true.
 *        // Ответ: ReplyToJs(reqId, new { ok = true }) либо
 *        //        ReplyToJs(reqId, new { ok = false, error = "текст" });
 */
export const DESKTOP_PRINT_CONTRACT = 1;

/** Доступна ли прямая печать (десктоп + собранный C#-мост нужной версии). */
export function isDesktopPrintAvailable(): boolean {
  const w = window as PvsWindow;
  return !!w.__IS_DESKTOP__ && (w.__PVS_PRINT_API__ ?? 0) >= DESKTOP_PRINT_CONTRACT;
}

// Счётчик запросов: у каждого обращения к оболочке свой идентификатор, иначе
// ответы на параллельные запросы (список принтеров + печать) перепутались бы.
let _reqSeq = 0;

/**
 * Отправляет команду в C#-оболочку и ждёт ответ.
 * Таймаут обязателен: если оболочка старая и команду не знает, ответа не будет
 * никогда — без таймаута диалог печати завис бы навсегда.
 */
function callDesktop<T>(cmd: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const w = window as PvsWindow;
    const post = w.chrome?.webview?.postMessage;
    if (!post) { reject(new Error("Десктопный мост недоступен")); return; }

    const reqId = `print-${++_reqSeq}-${Date.now()}`;
    const prev = w.__pvsCsReply;
    let finished = false;

    const cleanup = () => {
      finished = true;
      clearTimeout(timer);
      w.__pvsCsReply = prev;
    };

    const timer = setTimeout(() => {
      if (finished) return;
      cleanup();
      reject(new Error("Оболочка не ответила"));
    }, timeoutMs);

    // Перехватываем ответ только со своим reqId, остальные передаём дальше —
    // иначе мы бы «съели» ответы на чужие запросы (сохранение файлов и т.п.).
    w.__pvsCsReply = (id: string, payload: unknown) => {
      if (id !== reqId) { prev?.(id, payload); return; }
      if (finished) return;
      cleanup();
      resolve(payload as T);
    };

    w.chrome!.webview!.postMessage(JSON.stringify({ cmd, reqId, ...params }));
  });
}

/**
 * Список принтеров Windows. При любой ошибке — пустой список: диалог печати
 * тогда просто покажет «принтер по умолчанию», а не сломается.
 */
export async function listPrinters(): Promise<DesktopPrinter[]> {
  if (!isDesktopPrintAvailable()) return [];
  try {
    const res = await callDesktop<{ printers?: DesktopPrinter[] }>("list-printers", {}, 5000);
    return Array.isArray(res?.printers) ? res.printers : [];
  } catch {
    return [];
  }
}

/**
 * Печатает документ напрямую, минуя системное окно.
 * Возвращает true при успехе; false означает «не получилось» — вызывающий код
 * обязан в этом случае откатиться на обычную печать через браузер, чтобы
 * инженер в любом случае получил распечатку.
 *
 * Таймаут большой (5 минут): лист A3 при 300 dpi весит десятки мегабайт, его
 * растеризация и отправка на принтер занимают заметное время.
 */
export async function printViaDesktop(job: DesktopPrintJob): Promise<PrintResult> {
  if (!isDesktopPrintAvailable()) return { ok: false, error: "" };
  try {
    const res = await callDesktop<{ ok?: boolean; error?: string }>("print-html", {
      html: job.html,
      printerName: job.printerName,
      copies: job.copies,
      paperWidthMm: job.paperWidthMm,
      paperHeightMm: job.paperHeightMm,
      landscape: job.landscape,
    }, 300000);
    if (res?.ok === true) return { ok: true, error: "" };
    // Текст ошибки от Windows («принтер недоступен», «нет бумаги») раньше
    // отбрасывался — человек видел лишь то, что распечатки нет. Теперь
    // причина доходит до интерфейса.
    return { ok: false, error: humanizePrintError(res?.error ?? "") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "" };
  }
}

/** Переводит коды состояния WebView2 в понятный текст. */
function humanizePrintError(raw: string): string {
  const map: Record<string, string> = {
    PrinterUnavailable: "Принтер недоступен — проверьте, включён ли он и подключён ли кабель",
    PrinterError: "Принтер сообщил об ошибке — проверьте бумагу, тонер и очередь печати",
    OtherError: "Windows не смогла напечатать документ",
  };
  return map[raw] ?? raw;
}