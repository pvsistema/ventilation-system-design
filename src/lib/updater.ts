// Единый механизм проверки и скачивания обновлений ПВ-Система.
// Используется и веб-баннером (AppUpdateBanner), и окном «О программе»
// (UpdateCheckButton), чтобы логика была в ОДНОМ месте.

// URL функции версий: отдаёт { version, notes, download_url } и по ?file=exe —
// 302-редирект на свежий установщик с именем PVS-Setup-{версия}.exe.
export const VERSION_URL =
  "https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16";

// Прямая ссылка на скачивание установщика (одинаковая для веба и десктопа).
export const INSTALLER_URL = `${VERSION_URL}?file=exe`;

export interface RemoteVersion {
  version: string;
  notes: string;
  downloadUrl: string;
  /** SHA-256 подлинного установщика — показывается на странице скачивания. */
  exeSha256: string;
  /**
   * Минимальная безопасная версия. Если текущая сборка ниже — обновление
   * обязательно: показываем блокирующее окно вместо закрываемого баннера.
   * Пустая строка — требования нет.
   */
  minSecureVersion: string;
  /** Короткое пояснение, почему обновление обязательно. */
  securityNotes: string;
}

/** Десктопная сборка (WebView2/C#) инжектирует window.__IS_DESKTOP__ = true. */
export function isDesktopApp(): boolean {
  const w = window as Window & { __IS_DESKTOP__?: boolean };
  return !!w.__IS_DESKTOP__ || window.location.protocol === "file:";
}

/** Сравнение версий вида "2.3.25" — true если remote новее local. */
export function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split(".").map((n) => parseInt(n, 10) || 0);
  const l = local.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const a = r[i] ?? 0;
    const b = l[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/**
 * Требуется ли ОБЯЗАТЕЛЬНОЕ обновление по безопасности.
 * true — текущая сборка ниже минимальной безопасной, в ней осталась
 * устранённая уязвимость, и работать на ней нельзя.
 */
export function isSecurityUpdateRequired(
  minSecure: string,
  local: string,
): boolean {
  if (!minSecure.trim()) return false;
  return isNewerVersion(minSecure, local);
}

// Кэш ответа о версии. Раньше её независимо спрашивали баннер обновления,
// окно «О программе», страница скачивания и админ-панель — при открытии
// нескольких экранов подряд это давало поток одинаковых обращений к серверу.
// Версия меняется редко, поэтому ответ живёт 5 минут, а параллельные вызовы
// разделяют один запрос (дедупликация) вместо того, чтобы дублировать его.
const VERSION_TTL_MS = 5 * 60 * 1000;
let versionCache: { at: number; data: RemoteVersion } | null = null;
let versionInFlight: Promise<RemoteVersion> | null = null;

/** Сбрасывает кэш версии — после публикации новой сборки из админ-панели. */
export function invalidateRemoteVersion(): void {
  versionCache = null;
  versionInFlight = null;
}

/**
 * Запрашивает у сервера актуальную версию. Бросает при ошибке сети/формата.
 * Ответ кэшируется на 5 минут; force = true запрашивает заново.
 */
export async function fetchRemoteVersion(force = false): Promise<RemoteVersion> {
  if (!force && versionCache && Date.now() - versionCache.at < VERSION_TTL_MS) {
    return versionCache.data;
  }
  // Запрос уже в пути — присоединяемся к нему, второй раз сервер не тревожим.
  if (!force && versionInFlight) return versionInFlight;

  const run = (async () => {
    const res = await fetch(VERSION_URL, { cache: "no-store" });
    const text = await res.text();
    if (!text.trim().startsWith("{")) throw new Error("bad response");
    const d = JSON.parse(text);
    const data: RemoteVersion = {
      version: String(d.version || ""),
      notes: String(d.notes || ""),
      downloadUrl: String(d.download_url || ""),
      exeSha256: String(d.exe_sha256 || ""),
      minSecureVersion: String(d.min_secure_version || ""),
      securityNotes: String(d.security_notes || ""),
    };
    versionCache = { at: Date.now(), data };
    return data;
  })();

  versionInFlight = run;
  try {
    return await run;
  } finally {
    if (versionInFlight === run) versionInFlight = null;
  }
}

interface DesktopApi {
  installUpdate?: () => void;
}

/**
 * Запускает скачивание/установку обновления. ЕДИНАЯ точка для веба и десктопа.
 * - Десктоп (C# WebView2): вызываем window.electronAPI.installUpdate() — этот
 *   мост уже реализован в C#-оболочке (MainWindow.xaml.cs → HandleInstallUpdate):
 *   она скачивает установщик, подменяет .exe через .bat и перезапускается.
 * - Браузер: скачиваем .exe по ?file=exe (сервер отдаёт корректное имя файла).
 */
/**
 * Подписка на прогресс скачивания обновления в десктопе, % (0–100).
 *
 * Оболочка (C#) во время загрузки установщика вызывает window.__pvsUpdateProgress.
 * Раньше этот обработчик ставил ТОЛЬКО верхний баннер обновления. Поэтому в окне
 * «О программе» кнопка «Скачать и обновить» выглядела мёртвой: нажатие ничего
 * видимо не меняло, установщик (~82 МБ) молча качался минуту, и пользователь
 * решал, что обновление не работает, — и жал кнопку снова.
 *
 * Теперь прогресс раздаётся ВСЕМ подписчикам, поэтому и баннер, и окно
 * «О программе» показывают одну и ту же полосу загрузки.
 */
type ProgressListener = (percent: number) => void;
const progressListeners = new Set<ProgressListener>();
let progressHookInstalled = false;

export function onUpdateProgress(fn: ProgressListener): () => void {
  progressListeners.add(fn);
  if (!progressHookInstalled) {
    progressHookInstalled = true;
    const w = window as Window & { __pvsUpdateProgress?: ProgressListener };
    w.__pvsUpdateProgress = (p: number) => {
      const raw = Number(p);
      // −1 — оболочка сообщает, что обновление отменено или сорвалось
      // (например, человек отклонил запрос прав администратора). Передаём
      // как есть, чтобы экран снял надпись «Установка…» и вернул кнопку.
      const value = raw < 0 ? -1 : Math.max(0, Math.min(100, raw || 0));
      progressListeners.forEach((l) => l(value));
    };
  }
  return () => { progressListeners.delete(fn); };
}

export function downloadAndInstall(): void {
  const api = (window as Window & { electronAPI?: DesktopApi }).electronAPI;
  if (isDesktopApp() && api?.installUpdate) {
    api.installUpdate();
    return;
  }

  // Браузер — обычное скачивание файла.
  const a = document.createElement("a");
  a.href = INSTALLER_URL;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Перезагружает браузерную вкладку на свежую версию веб-сборки, максимально
 * обходя кеш: чистит Cache Storage (если PWA когда-то кешировал) и добавляет
 * cache-busting параметр к URL. Для десктопа не применяется.
 */
export async function reloadBrowserToUpdate(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // игнорируем — не критично
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("_v", Date.now().toString());
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}