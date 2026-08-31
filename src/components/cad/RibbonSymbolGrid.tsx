// ─────────────────────────────────────────────────────────────────────────────
// RibbonSymbolGrid.tsx — сетка условных обозначений в ленте «Главная».
//
// Вынесено из Cad.tsx РАДИ СКОРОСТИ, разметка и поведение 1:1.
//
// Это ~150 кнопок, в каждой — векторный значок, который браузер разбирает из
// строки. Раньше вся сетка лежала прямо в теле главной страницы и пересобиралась
// при ЛЮБОМ изменении: выделили ветвь, сдвинули узел, прошёл расчёт — браузер
// заново строил полторы сотни значков, хотя сама сетка при этом не менялась.
//
// Теперь это отдельный компонент под React.memo: он перерисовывается только
// когда реально меняется подсветка активного значка. Всё остальное время
// браузер переиспользует уже готовую разметку.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { LEGEND_TYPES, HIDDEN_LEGEND_IDS } from "@/lib/schemaSymbols";
import ScrollArrows from "@/components/cad/ScrollArrows";

interface Props {
  /** id активного УО (подсвечивается рамкой), null — ничего не выбрано. */
  activeSymbolTypeId: string | null;
  /** Инструмент «символ» активен — только тогда подсветка имеет смысл. */
  symbolToolActive: boolean;
  onPick: (id: string) => void;
  onTooltip: (t: { name: string; x: number; y: number } | null) => void;
}

function RibbonSymbolGridInner({ activeSymbolTypeId, symbolToolActive, onPick, onTooltip }: Props) {
  // Список УО неизменен на всё время работы программы — фильтруем один раз.
  const items = useMemo(() => LEGEND_TYPES.filter(lt => !HIDDEN_LEGEND_IDS.has(lt.id)), []);
  return (
    <ScrollArrows
      className="cad-symbol-scroll"
      step={120}
      style={{
        display: "grid",
        gridAutoFlow: "column",
        gridTemplateRows: "repeat(3, 18px)",
        gridAutoColumns: "18px",
        gap: 1,
        alignContent: "center",
        overflowX: "auto",
        overflowY: "hidden",
        maxWidth: 330,
      }}
      onMouseLeave={() => onTooltip(null)}>
      {items.map(lt => {
        const isActive = activeSymbolTypeId === lt.id && symbolToolActive;
        return (
          <button key={lt.id}
            onClick={() => onPick(lt.id)}
            onMouseEnter={e => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onTooltip({ name: lt.name, x: r.left, y: r.top });
              if (!isActive) (e.currentTarget as HTMLElement).style.background = "#e8f0fe";
            }}
            onMouseLeave={e => {
              onTooltip(null);
              if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
            style={{
              width: 18, height: 18,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 3,
              border: isActive ? "1.5px solid var(--c-blue, #2563eb)" : "1px solid transparent",
              background: isActive ? "var(--c-tint-blue2, #dbeafe)" : "transparent",
              cursor: "pointer", padding: 0,
              transition: "border-color .1s, background .1s",
              outline: "none",
            }}>
            <svg width={15} height={13} viewBox="0 0 48 40">
              <g dangerouslySetInnerHTML={{ __html: lt.svgContent }} />
            </svg>
          </button>
        );
      })}
    </ScrollArrows>
  );
}

/**
 * Сетка перерисовывается ТОЛЬКО при смене активного значка. Обработчики
 * приходят из Cad.tsx стабильными (useCallback), поэтому сравнения по ссылке
 * достаточно — иначе memo снимался бы на каждой перерисовке страницы.
 */
const RibbonSymbolGrid = React.memo(RibbonSymbolGridInner);
export default RibbonSymbolGrid;