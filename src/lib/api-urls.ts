/**
 * Централизованный реестр URL backend-функций.
 * В desktop-режиме все запросы идут на локальный Python-сервер.
 * В web-режиме — на облачные функции из func2url.json.
 */

declare const __DESKTOP_SERVER__: string | undefined;
declare const __IS_DESKTOP__: boolean | undefined;

const isDesktop = typeof __IS_DESKTOP__ !== "undefined" && __IS_DESKTOP__;
const localBase = typeof __DESKTOP_SERVER__ !== "undefined"
  ? __DESKTOP_SERVER__
  : "http://127.0.0.1:5173";

// Импортируем cloud URLs (в desktop-билде они будут переопределены)
import FUNC2URL from "../../backend/func2url.json";

// РЕЗЕРВНОЕ ЗЕРКАЛО (Beget и любой свой сервер).
// Если сборка сделана с переменной VITE_API_BASE, все функции берутся не из
// облака, а с сервера-зеркала: `${VITE_API_BASE}/api/<функция>`.
// Пустое значение (VITE_API_BASE=) — тот же домен, откуда открыт сайт.
// Без переменной — обычное поведение (облачные функции из func2url.json).
const mirrorBase: string | undefined = import.meta.env.VITE_API_BASE;
const isMirror = !isDesktop && typeof mirrorBase === "string";

function url(name: string, localPath: string): string {
  // В desktop-режиме локальный Flask-сервер раздаёт API под префиксом /api
  // (http://127.0.0.1:5173/api/license и т.д.)
  if (isDesktop) return `${localBase}/api${localPath}`;
  if (isMirror) return `${(mirrorBase as string).replace(/\/+$/, "")}/api/${name}`;
  return (FUNC2URL as Record<string, string>)[name] ?? "";
}

/** URL функции версий (на зеркале — своя, в остальных случаях — облачная). */
export const APP_VERSION_URL: string = isMirror
  ? url("app-version", "/app-version")
  : ((FUNC2URL as Record<string, string>)["app-version"] ?? "");

export const API_URLS = {
  aerodynamics:       url("aerodynamics",        "/aerodynamics"),
  airflow:            url("airflow",             "/airflow"),
  rescueCalculator:   url("rescue-calculator",   "/rescue-calculator"),
  waterHydraulics:    url("water-hydraulics",    "/water-hydraulics"),
  explosionCalculator:url("explosion-calculator","/explosion-calculator"),
  license:            url("license",             "/license"),
  adminLicenses:      url("admin-licenses",      "/admin-licenses"),
  computeConfig:      url("compute-config",      "/compute-config"),
  clientLicenses:     url("client-licenses",     "/client-licenses"),
} as const;

export { isDesktop, isMirror };