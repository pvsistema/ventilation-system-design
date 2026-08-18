import { useEffect, useState } from "react";
import { CANVAS_THEME, type CanvasTheme } from "@/lib/theme";

/**
 * Возвращает текущую тему ("light" | "dark") и следит за её сменой.
 * Нужен там, где цвета задаются не классами, а прямо в стилях — например
 * на холсте схемы (фон, заливка выработок).
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    setDark(el.classList.contains("dark"));
    return () => obs.disconnect();
  }, []);

  return dark;
}

/** Цвета холста схемы под текущую тему. */
export function useCanvasTheme(): CanvasTheme {
  const dark = useIsDark();
  return CANVAS_THEME[dark ? "dark" : "light"];
}
