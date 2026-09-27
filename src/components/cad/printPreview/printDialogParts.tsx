// ─────────────────────────────────────────────────────────────────────────────
// printDialogParts.tsx — общие части диалога печати: печать (прямая из
// десктопа или через скрытый iframe) и форматы бумаги.
// Элементы оформления окна — в printUi.tsx.
// ─────────────────────────────────────────────────────────────────────────────
import { isDesktopPrintAvailable, printViaDesktop } from "@/lib/desktopPrint";

/**
 * Параметры листа для прямой печати из десктопной оболочки.
 * В браузере не используются — там их задаёт системное окно.
 */
export interface DirectPrintOpts {
  printerName: string;
  copies: number;
  paperWidthMm: number;
  paperHeightMm: number;
  landscape: boolean;
}

/**
 * ЕДИНАЯ точка печати документа.
 *
 * В десктопной сборке (C#/WebView2 с собранным мостом печати) документ уходит
 * на принтер напрямую — без второго системного окна: принтер, копии и формат
 * уже выбраны в нашем диалоге предпросмотра.
 *
 * Везде остальное — обычная печать браузера через скрытый iframe. Тот же путь
 * используется как запасной, если прямая печать почему-то не удалась: инженер
 * в любом случае должен получить распечатку, а не молчаливый отказ.
 */
export interface PrintOutcome {
  /** Печать ушла напрямую на принтер (без системного окна). */
  direct: boolean;
  /** Причина, по которой прямая печать не удалась и пришлось откатиться. */
  fallbackReason: string;
}

export async function printDocument(html: string, opts?: DirectPrintOpts): Promise<PrintOutcome> {
  if (opts && isDesktopPrintAvailable()) {
    const res = await printViaDesktop({ html, ...opts });
    if (res.ok) return { direct: true, fallbackReason: "" };
    // Прямая печать не удалась — печатаем обычным способом, но причину
    // возвращаем наверх: раньше она терялась, и человек не понимал, почему
    // вдруг открылось системное окно (или почему нет распечатки).
    printViaIframe(html);
    return { direct: false, fallbackReason: res.error };
  }
  printViaIframe(html);
  return { direct: false, fallbackReason: "" };
}

export function printViaIframe(html: string) {
  const existing = document.getElementById("__pvs_print_frame__");
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "__pvs_print_frame__";
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow?.focus();

  // Ждём, пока браузер РЕАЛЬНО декодирует картинки листов, и только потом
  // вызываем печать. Раньше здесь стояла слепая пауза 500 мс: лист A3 при
  // 300 dpi весит десятки мегабайт и декодируется дольше — print() уходил
  // на неготовый документ, и окно печати зависало с пустой страницей.
  let done = false;
  const start = () => {
    if (done) return;
    done = true;
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  };

  const imgs = Array.from(doc.images);
  const waitAll = imgs.length === 0
    ? Promise.resolve()
    : Promise.all(imgs.map((img) => (
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.addEventListener("load",  () => res(), { once: true });
              img.addEventListener("error", () => res(), { once: true });
            })
      )));

  // Страховка: даже если какая-то картинка не отдала событие, печать всё
  // равно запустится — программа не должна «зависать» насовсем.
  const guard = setTimeout(start, 60000);
  void waitAll.then(() => {
    clearTimeout(guard);
    // Даём кадр на раскладку страниц, затем печатаем.
    requestAnimationFrame(() => setTimeout(start, 50));
  });
}

export type PaperFormat = "A4" | "A3" | "A2" | "A1" | "A0" | "custom";
export type Orientation = "portrait" | "landscape";

export const PAPER_SIZES: Record<Exclude<PaperFormat, "custom">, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
};
