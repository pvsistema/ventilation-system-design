// Проверка доступности основного сайта пв-система.рф и его серверов расчёта.
// Если основной адрес перестал отвечать, а резервный pvsistema.ru доступен —
// программа предлагает перейти на резерв (баннер MirrorFailoverBanner).
//
// Проверка работает только на основном домене: на резерве и в десктопной
// версии (там свой локальный сервер) она не нужна.

import { APP_VERSION_URL } from "@/lib/api-urls";
import { isDesktopApp } from "@/lib/updater";

export const MIRROR_ORIGIN = "https://pvsistema.ru";
export const MIRROR_TITLE = "pvsistema.ru";

const MAIN_HOSTS = ["xn----8sbenozqsbk.xn--p1ai", "пв-система.рф", "www.xn----8sbenozqsbk.xn--p1ai"];

/** Открыт ли сейчас основной сайт (а не резерв, не десктоп, не предпросмотр). */
export function isOnMainSite(): boolean {
  if (isDesktopApp()) return false;
  return MAIN_HOSTS.includes(window.location.hostname.toLowerCase());
}

async function ping(url: string, opts: RequestInit = {}, timeoutMs = 8000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const sep = url.includes("?") ? "&" : "?";
    const r = await fetch(`${url}${sep}_ping=${Date.now()}`, { cache: "no-store", signal: ctrl.signal, ...opts });
    // no-cors отдаёт «непрозрачный» ответ — значит, сервер ответил
    return r.type === "opaque" || r.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Отвечает ли основной сайт (статические файлы на том же адресе). */
export function pingMainSite(): Promise<boolean> {
  return ping(`${window.location.origin}/robots.txt`);
}

/** Отвечают ли облачные функции (лицензии, расчёты). */
export function pingCloudFunctions(): Promise<boolean> {
  if (!APP_VERSION_URL) return Promise.resolve(true);
  return ping(APP_VERSION_URL);
}

/** Доступен ли резервный сайт. */
export function pingMirror(): Promise<boolean> {
  return ping(`${MIRROR_ORIGIN}/favicon.svg`, { mode: "no-cors" });
}

/** Тот же экран на резерве: путь, параметры и якорь сохраняются. */
export function mirrorUrlForCurrentPage(): string {
  const { pathname, search, hash } = window.location;
  return `${MIRROR_ORIGIN}${pathname}${search}${hash}`;
}
