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
import { LEGEND_TYPES, HIDDEN_LEGEND_IDS, legendViewBox } from "@/lib/schemaSymbols";
import ScrollArrows from "@/components/cad/ScrollArrows";

interface Props {
  /** id активного УО (подсвечивается рамкой), null — ничего не выбрано. */
  activeSymbolTypeId: string | null;
  /** Инструмент «символ» активен — только тогда подсветка имеет смысл. */
  symbolToolActive: boolean;
  onPick: (id: string) => void;
}

function RibbonSymbolGridInner({ activeSymbolTypeId, symbolToolActive, onPick }: Props) {
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
      }}>
      {items.map(lt => {
        const isActive = activeSymbolTypeId === lt.id && symbolToolActive;
        return (
          <button key={lt.id}
            onClick={() => onPick(lt.id)}
            // Название — обычной подсказкой браузера. Раньше подсказка жила в
            // состоянии главной страницы и перерисовывала её на каждое
            // движение мыши по значкам, а показывалась только при открытой
            // выпадающей панели — у значков в ленте её фактически не было.
            title={lt.name}
            aria-label={lt.name}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--c-s3, #f1efea)"; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            style={{
              width: 18, height: 18,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: "var(--radius-ui)",
              border: isActive ? "1.5px solid var(--c-accent, #1e5a7a)" : "1px solid transparent",
              background: isActive ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)" : "transparent",
              cursor: "pointer", padding: 0,
              transition: "border-color .1s, background .1s",
              outline: "none",
            }}>
            <svg width={15} height={13} viewBox={legendViewBox(lt.id)} preserveAspectRatio="xMidYMid meet">
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