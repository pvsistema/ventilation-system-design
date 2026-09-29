// ─────────────────────────────────────────────────────────────────────────────
// uiScale — масштаб интерфейса и компактный режим.
//
//   • Масштаб (80…120 %, «Настройки программы»). В настольной версии с новой
//     оболочкой — через ZoomFactor WebView2 (чётко, масштабирует всё сразу).
//     В браузере и на старых оболочках — через CSS zoom на корне документа.
//   • Компактный режим: на окнах уже ~1400 px (с учётом масштаба) на <html>
//     ставится класс ui-compact — лента и панели чуть плотнее (index.css).
// ─────────────────────────────────────────────────────────────────────────────

const LS_KEY = "pvs_ui_scale";
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.2;
export const UI_SCALE_STEPS = [0.8, 0.9, 1, 1.1, 1.2];
/** Ширина окна (в CSS-пикселях), ниже которой включается компактный режим. */
const COMPACT_BELOW = 1400;

type W = Window & {
  __IS_DESKTOP__?: boolean;
  __PVS_ZOOM_API__?: number;
  __pvsSendCs?: (cmd: string, params?: Record<string, unknown>) => void;
};

export function getUiScale(): number {
  try {
    const v = Number(localStorage.getItem(LS_KEY));
    if (Number.isFinite(v) && v > 0) return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v));
  } catch { /* ignore */ }
  return 1;
}

function nativeZoom(): boolean {
  const w = window as W;
  return !!w.__IS_DESKTOP__ && (w.__PVS_ZOOM_API__ ?? 0) >= 1 && typeof w.__pvsSendCs === "function";
}

export function applyUiScale(scale = getUiScale()) {
  const root = document.documentElement;
  if (nativeZoom()) {
    root.style.removeProperty("zoom");
    (window as W).__pvsSendCs!("set-zoom", { zoom: scale });
  } else {
    // CSS zoom поддерживают Chromium/WebView2 и современные Firefox/Safari.
    if (Math.abs(scale - 1) < 1e-3) root.style.removeProperty("zoom");
    else root.style.setProperty("zoom", String(scale));
  }
  // Высота окна программы задаётся в 100dvh; при CSS-масштабе её надо
  // поделить на коэффициент, иначе интерфейс не дотянется до низа окна.
  root.style.setProperty("--ui-zoom", String(cssZoomOf(root)));
  updateCompact();
}

export function setUiScale(scale: number) {
  const v = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(scale * 100) / 100));
  try { localStorage.setItem(LS_KEY, String(v)); } catch { /* ignore */ }
  applyUiScale(v);
  window.dispatchEvent(new Event("resize"));
}

function cssZoomOf(root: HTMLElement): number {
  return Number(root.style.getPropertyValue("zoom")) || 1;
}

/** Ширина окна в пикселях макета (с учётом CSS-масштаба). */
export function layoutWidth(): number {
  return window.innerWidth / cssZoomOf(document.documentElement);
}

/** Компактный режим — по фактической ширине окна в CSS-пикселях. */
function updateCompact() {
  const w = layoutWidth();
  document.documentElement.classList.toggle("ui-compact", w < COMPACT_BELOW);
}

let installed = false;
export function installUiScale() {
  if (installed) return;
  installed = true;
  applyUiScale();
  window.addEventListener("resize", updateCompact);
}
