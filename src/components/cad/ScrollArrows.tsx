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

  // ── Прокрутка колёсиком мыши ───────────────────────────────────────────
  // У обычной мыши колесо даёт вертикальное движение (deltaY), а панель
  // прокручивается вбок — поэтому вертикальное движение превращаем в
  // горизонтальное. У трекпадов и мышей с горизонтальным колесом есть deltaX,
  // его берём как есть.
  //
  // Обработчик вешаем вручную с passive: false: React вешает onWheel как
  // пассивный, а в пассивном обработчике браузер запрещает preventDefault —
  // без него страница дёргалась бы вместе с панелью.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Панель влезает целиком — прокручивать нечего, отдаём событие странице.
      if (el.scrollWidth <= el.clientWidth) return;

      // Горизонтальное движение (трекпад) имеет приоритет: пользователь уже
      // задал направление явно, подменять его не нужно.
      let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;

      // deltaMode: 0 — пиксели, 1 — строки, 2 — страницы. Мыши часто шлют
      // строки; без пересчёта один щелчок колеса сдвигал бы панель на 3px.
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= el.clientWidth;

      // Уже упёрлись в край — не перехватываем: пусть прокрутится страница
      // или родительская панель, иначе колесо «залипало» бы на краю.
      const atLeftEdge = delta < 0 && el.scrollLeft <= 0;
      const atRightEdge = delta > 0 && el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if (atLeftEdge || atRightEdge) return;

      e.preventDefault();
      el.scrollLeft += delta;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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