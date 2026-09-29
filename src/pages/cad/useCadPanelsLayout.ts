// ─────────────────────────────────────────────────────────────────────────────
// useCadPanelsLayout — ширина боковых панелей в зависимости от размера окна.
//
// ПРОБЛЕМА. Левая панель была 420 px, правая — жёстко 280 px, независимо от
// экрана. На ноутбуке 1366×768 с масштабом Windows 125 % ширина страницы
// ~1093 px, и под схему оставалось ~365 px — треть окна.
//
// РЕШЕНИЕ:
//   1. Ширина по умолчанию — доля окна: левая ≈ 24 % (240…420 px),
//      правая ≈ 18 % (200…280 px). Окно сузили — панели сужаются сами.
//   2. Защита схемы: если под неё остаётся меньше 55 % окна, правая панель
//      автоматически сворачивается в полоску (открывается кнопкой).
//   3. Обе панели тянутся мышью; выбранная вручную ширина запоминается и
//      дальше ограничивается только пределами, а не долей окна.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from "react";
import { layoutWidth } from "@/lib/uiScale";

const LS_LEFT = "pvs_left_panel_w";
const LS_RIGHT = "pvs_right_panel_w";
const LS_RIGHT_OPEN = "pvs_right_panel_open";

export const LEFT_MIN = 220, LEFT_MAX = 640;
export const RIGHT_MIN = 190, RIGHT_MAX = 420;
/** Вертикальные вкладки + разделитель слева, полоска свёрнутой панели. */
const LEFT_EXTRA = 28;
const STRIP = 24;
/** Доля окна, которая всегда остаётся под схему. */
const CANVAS_MIN_SHARE = 0.55;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const readNum = (k: string): number | null => {
  try { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
};
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const autoLeft = (w: number) => Math.round(clamp(w * 0.24, 240, 420));
const autoRight = (w: number) => Math.round(clamp(w * 0.18, 200, 280));

export function useCadPanelsLayout() {
  const [winW, setWinW] = useState(() => layoutWidth());
  // Ширина, заданная пользователем вручную (null — авто по окну).
  const [userLeft, setUserLeft] = useState<number | null>(() => readNum(LS_LEFT));
  const [userRight, setUserRight] = useState<number | null>(() => readNum(LS_RIGHT));
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  // Явный выбор пользователя по правой панели: true/false, null — решает авто.
  const [rightUserOpen, setRightUserOpen] = useState<boolean | null>(() => {
    try { const v = localStorage.getItem(LS_RIGHT_OPEN); return v === "1" ? true : v === "0" ? false : null; } catch { return null; }
  });

  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setWinW(layoutWidth())); };
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);

  // Итоговые ширины: вручную заданная — в своих пределах, но не больше трети окна.
  const leftPanelWidth = Math.round(clamp(userLeft ?? autoLeft(winW), LEFT_MIN, Math.min(LEFT_MAX, Math.max(LEFT_MIN, winW * 0.35))));
  const rightPanelWidth = Math.round(clamp(userRight ?? autoRight(winW), RIGHT_MIN, Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, winW * 0.3))));

  // Помещается ли правая панель, не отнимая у схемы её долю.
  const leftUsed = leftPanelOpen ? leftPanelWidth + LEFT_EXTRA : STRIP;
  const rightFits = winW - leftUsed - rightPanelWidth >= winW * CANVAS_MIN_SHARE;
  const rightPanelOpen = rightUserOpen ?? rightFits;
  /** Правая панель свёрнута автоматически из-за нехватки места. */
  const rightAutoCollapsed = rightUserOpen === null && !rightFits;

  // Если окно расширили настолько, что места снова хватает, ручное «свернуть»,
  // сделанное из-за тесноты, не держим — возвращаем решение автомату.
  const prevFits = useRef(rightFits);
  useEffect(() => {
    if (!prevFits.current && rightFits && rightUserOpen === false) {
      setRightUserOpen(null);
      write(LS_RIGHT_OPEN, "");
    }
    prevFits.current = rightFits;
  }, [rightFits, rightUserOpen]);

  const setRightPanelOpen = useCallback((v: boolean) => {
    setRightUserOpen(v);
    write(LS_RIGHT_OPEN, v ? "1" : "0");
  }, []);

  // ── Перетаскивание границ ─────────────────────────────────────────────
  const drag = useRef<{ side: "left" | "right"; startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      if (d.side === "left") setUserLeft(clamp(d.startW + dx, LEFT_MIN, LEFT_MAX));
      else setUserRight(clamp(d.startW - dx, RIGHT_MIN, RIGHT_MAX));
    };
    const onUp = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Запоминаем выбранную ширину
      if (d.side === "left") setUserLeft(w => { if (w) write(LS_LEFT, String(Math.round(w))); return w; });
      else setUserRight(w => { if (w) write(LS_RIGHT, String(Math.round(w))); return w; });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const startDrag = (side: "left" | "right", startW: number) => (e: React.MouseEvent) => {
    drag.current = { side, startX: e.clientX, startW };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  };
  const startLeftDrag = startDrag("left", leftPanelWidth);
  const startRightDrag = startDrag("right", rightPanelWidth);

  /** Двойной клик по разделителю — вернуть автоширину. */
  const resetLeftWidth = () => { setUserLeft(null); write(LS_LEFT, ""); };
  const resetRightWidth = () => { setUserRight(null); write(LS_RIGHT, ""); };

  return {
    leftPanelWidth, rightPanelWidth,
    leftPanelOpen, setLeftPanelOpen,
    rightPanelOpen, setRightPanelOpen, rightAutoCollapsed,
    startLeftDrag, startRightDrag, resetLeftWidth, resetRightWidth,
  };
}
