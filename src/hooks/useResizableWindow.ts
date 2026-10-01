import { useEffect, useRef, useState, type PointerEvent } from "react";

/**
 * Изменение размера плавающего окна: тянуть за правый/нижний край или угол.
 *
 * • размер не меньше minWidth × minHeight и не больше экрана;
 * • если передан storageKey, размер запоминается между открытиями;
 * • maximized — развернуть окно на весь экран (и вернуть обратно).
 */
export function useResizableWindow(opts: {
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  storageKey?: string;
}) {
  const { defaultWidth, defaultHeight, minWidth = 640, minHeight = 420, storageKey } = opts;

  const clamp = (w: number, h: number) => ({
    w: Math.round(Math.min(window.innerWidth - 8, Math.max(Math.min(minWidth, window.innerWidth - 8), w))),
    h: Math.round(Math.min(window.innerHeight - 8, Math.max(Math.min(minHeight, window.innerHeight - 8), h))),
  });

  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    if (storageKey) {
      try {
        const s = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) return clamp(s.w, s.h);
      } catch { /* нет сохранённого размера */ }
    }
    return clamp(defaultWidth, defaultHeight);
  });
  const [maximized, setMaximized] = useState<boolean>(() => {
    try { return !!storageKey && localStorage.getItem(`${storageKey}.max`) === "1"; } catch { return false; }
  });

  const sizeRef = useRef(size);
  sizeRef.current = size;

  // Окно браузера уменьшили — окно не должно вылезать за экран
  useEffect(() => {
    const onResize = () => setSize(s => clamp(s.w, s.h));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(sizeRef.current)); } catch { /* ignore */ }
  };

  const toggleMaximized = () => {
    setMaximized(m => {
      const next = !m;
      if (storageKey) { try { localStorage.setItem(`${storageKey}.max`, next ? "1" : "0"); } catch { /* ignore */ } }
      return next;
    });
  };

  const resetSize = () => {
    setMaximized(false);
    const s = clamp(defaultWidth, defaultHeight);
    setSize(s);
    sizeRef.current = s;
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(s)); localStorage.setItem(`${storageKey}.max`, "0"); } catch { /* ignore */ }
    }
  };

  const drag = useRef<{ x: number; y: number; w: number; h: number; dir: "e" | "s" | "se" } | null>(null);

  const handle = (dir: "e" | "s" | "se") => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || maximized) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = { x: e.clientX, y: e.clientY, w: sizeRef.current.w, h: sizeRef.current.h, dir };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const w = d.dir === "s" ? d.w : d.w + (e.clientX - d.x);
      const h = d.dir === "e" ? d.h : d.h + (e.clientY - d.y);
      setSize(clamp(w, h));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      if (!drag.current) return;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      save();
    },
    onDoubleClick: resetSize,
    title: "Потяните, чтобы изменить размер окна (двойной щелчок — исходный размер)",
    style: {
      position: "absolute",
      touchAction: "none",
      zIndex: 5,
      cursor: dir === "e" ? "ew-resize" : dir === "s" ? "ns-resize" : "nwse-resize",
      ...(dir === "e" ? { top: 0, right: -3, width: 8, bottom: 14 }
        : dir === "s" ? { left: 0, bottom: -3, height: 8, right: 14 }
        : { right: 0, bottom: 0, width: 16, height: 16 }),
    } as React.CSSProperties,
  });

  return { size, maximized, toggleMaximized, resetSize, handle };
}
