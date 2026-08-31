// ─────────────────────────────────────────────────────────────────────────────
// ScrollArrows — обёртка, добавляющая кнопки-стрелки по краям горизонтально
// прокручиваемой панели.
//
// ЗАЧЕМ. Полосу прокрутки под рядами инструментов трудно поймать курсором:
// даже утолщённая, она требует целиться в узкую линию. Стрелки дают крупную
// мишень у самого края панели — листать можно не глядя.
//
// ПОВЕДЕНИЕ. Стрелка появляется только с той стороны, куда ещё есть что
// прокручивать: докрутили до конца — стрелка исчезла. Так видно, что дальше
// ничего нет, и кнопки не занимают место в панелях, которые целиком помещаются
// на экран (на широком мониторе стрелок не будет вовсе).
//
// Кнопки намеренно НЕ попадают в обход клавиатуры (tabIndex={-1}): это
// вспомогательное действие, и переход по Tab должен вести к самим
// инструментам, а не к стрелкам.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "@/components/ui/icon";

interface Props {
  children: ReactNode;
  /** Классы прокручиваемого контейнера (overflow-x задаётся здесь же). */
  className?: string;
  style?: React.CSSProperties;
  /** На сколько пикселей листать за одно нажатие. */
  step?: number;
  onMouseLeave?: () => void;
  /**
   * Стили внешней обёртки. Нужны, когда панель лежит в вертикальной колонке:
   * по умолчанию обёртка растягивается (flex: 1 1 auto), и без этого она
   * заняла бы всю высоту, сжав рабочую область со схемой.
   */
  wrapperStyle?: React.CSSProperties;
}

export default function ScrollArrows({
  children, className = "", style, step = 140, onMouseLeave, wrapperStyle,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Запас в 1px: браузер округляет дробную ширину, и без допуска стрелка
    // «доехали до конца» иногда не гасла.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Панель может менять ширину: свернули боковую панель, изменили окно,
    // добавились кнопки. ResizeObserver отслеживает это без опроса по таймеру.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const scrollBy = (dir: -1 | 1) => {
    ref.current?.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  const arrowStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    cursor: "pointer",
    padding: 0,
    zIndex: 2,
    color: "var(--c-t2, #475569)",
  };

  return (
    <div style={{ position: "relative", display: "flex", minWidth: 0, flex: "1 1 auto", ...wrapperStyle }}>
      {!atStart && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Прокрутить влево"
          onClick={() => scrollBy(-1)}
          className="cad-scroll-arrow"
          data-side="left"
          style={{ ...arrowStyle, left: 0 }}>
          <Icon name="ChevronLeft" size={15} />
        </button>
      )}

      <div ref={ref} className={className} style={style} onMouseLeave={onMouseLeave}>
        {children}
      </div>

      {!atEnd && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Прокрутить вправо"
          onClick={() => scrollBy(1)}
          className="cad-scroll-arrow"
          data-side="right"
          style={{ ...arrowStyle, right: 0 }}>
          <Icon name="ChevronRight" size={15} />
        </button>
      )}
    </div>
  );
}