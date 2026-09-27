import { useEffect, useRef, useState, type PointerEvent } from "react";

/**
 * Перетаскивание плавающего окна за шапку.
 *
 * • окно нельзя увести за край экрана — шапка всегда остаётся доступной;
 * • если передан storageKey, положение запоминается между открытиями;
 * • клик по кнопкам в шапке (закрыть и т.п.) не начинает перетаскивание.
 *
 * Использование:
 *   const { pos, dragHandleProps } = useDraggableWindow({ width: 620, storageKey: "..." });
 *   <div style={{ position: "fixed", left: pos.x, top: pos.y, width: 620 }}>
 *     <div {...dragHandleProps}>Шапка</div>
 */
export function useDraggableWindow(opts: {
  width: number;
  /** Высота окна для центрирования по умолчанию (если нет сохранённой позиции). */
  height?: number;
  /** Начальная позиция; по умолчанию — по центру экрана. */
  initial?: { x: number; y: number };
  storageKey?: string;
}) {
  const { width, height = 500, initial, storageKey } = opts;

  const clamp = (x: number, y: number) => {
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - 60);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  };

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (storageKey) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clamp(saved.x, saved.y);
      } catch { /* нет сохранённой позиции */ }
    }
    if (initial) return clamp(initial.x, initial.y);
    return clamp((window.innerWidth - width) / 2, Math.max(40, (window.innerHeight - height) / 2));
  });

  // При изменении размера окна браузера — вернуть окно в видимую область.
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
    drag.current = { dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(posRef.current)); } catch { /* ignore */ }
    }
  };

  return {
    pos,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      title: "Перетащите, чтобы переместить окно",
      style: { cursor: "move", touchAction: "none", userSelect: "none" } as const,
    },
  };
}
