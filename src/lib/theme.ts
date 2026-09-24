// ─────────────────────────────────────────────────────────────────────────────
// Тема оформления программы: светлая / тёмная / по системе.
//
// Тёмная тема включается классом `dark` на <html>. Сама перекраска описана
// в src/index.css: там переопределены базовые серые классы Tailwind, поэтому
// новые экраны получают тёмную тему автоматически, без правки каждого файла.
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "pv-theme";

export function getStoredTheme(): ThemeMode {
  if (typeof localStorage === "undefined") return "light";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "dark" || v === "light" || v === "system" ? v : "light";
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia !== "undefined"
    && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Какая тема фактически показывается сейчас (system → light/dark). */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
}

/** Применяет тему к документу и запоминает выбор. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const dark = resolveTheme(mode) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  // Системные элементы (скроллбары, поля ввода) тоже должны потемнеть
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* приватный режим */ }
}

/**
 * Следит за системной темой, пока выбран режим «как в системе».
 * Возвращает функцию отписки.
 */
export function watchSystemTheme(mode: ThemeMode, onChange: () => void): () => void {
  if (mode !== "system" || typeof matchMedia === "undefined") return () => {};
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Цвета холста схемы — единственное место, где они заданы не через CSS. */
export interface CanvasTheme {
  bg2D: string;
  bg3D: string;
  /** Заливка выработок, когда раскраска отключена */
  branchFill: string;
  /** «Бумага» — сплошной цвет фона, которым холст заливается сам. */
  paper: string;
  /** Миллиметровка: мелкая клетка, клетка ×5 и крупная ×10. */
  gridFine: string;
  gridMid: string;
  gridMajor: string;
}

// Фирменная «бумага для чертежей»: тёплый почти-белый тон вместо стерильного
// белого и едва заметная миллиметровка. Схема читается как инженерный лист,
// а не как пустое окно офисной программы.
export const CANVAS_THEME: Record<"light" | "dark", CanvasTheme> = {
  light: {
    bg2D: "#fbfaf7",
    bg3D: "#fbfaf7",
    branchFill: "#ffffff",
    paper: "#fbfaf7",
    gridFine: "rgba(120, 110, 90, 0.07)",
    gridMid: "rgba(120, 110, 90, 0.13)",
    gridMajor: "rgba(120, 110, 90, 0.22)",
  },
  dark: {
    // Холст чуть темнее панелей (--c-s1 = #171d28): схема «утоплена», рамка
    // окна и панели читаются как передний план. Не чёрный — иначе тонкие
    // линии выработок дают ореол и глаза устают.
    bg2D: "#111722",
    bg3D: "#111722",
    branchFill: "#2a3242",
    paper: "#111722",
    gridFine: "rgba(160, 180, 210, 0.05)",
    gridMid: "rgba(160, 180, 210, 0.09)",
    gridMajor: "rgba(160, 180, 210, 0.16)",
  },
};