// ─────────────────────────────────────────────────────────────────────────────
// RibbonReferences.tsx — вкладка ленты «Справочники».
//
// Вынесено из Cad.tsx РАДИ СКОРОСТИ, разметка и подписи 1:1.
//
// Вкладка полностью самостоятельна: она лишь открывает нужный справочник и со
// схемой никак не связана. Раньше её 12 кнопок лежали в теле главной страницы и
// пересобирались при любом действии — правке узла, расчёте, выделении ветви.
//
// Под React.memo вкладка перерисовывается только при смене вкладки ленты.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { RibbonGroup, RibbonBigBtn } from "@/pages/cad/cadComponents";
import type EquipmentRefDialog from "@/components/cad/EquipmentRefDialog";

/**
 * Разделы справочника оборудования.
 *
 * Тип берётся из САМОГО справочника, а не переписывается вручную: раньше он был
 * продублирован в Cad.tsx и отстал — в нём не хватало раздела «Нормы расхода
 * воздуха», хотя кнопка на него уже ссылалась. Теперь новый раздел в справочнике
 * автоматически становится допустимым и здесь.
 */
export type EquipRefTab = React.ComponentProps<typeof EquipmentRefDialog>["activeTab"];

interface Props {
  /** Открыть справочник оборудования на нужном разделе. */
  onOpenRef: (tab: EquipRefTab) => void;
  /** Открыть окно условных обозначений. */
  onOpenLegend: () => void;
}

function RibbonReferencesInner({ onOpenRef, onOpenLegend }: Props) {
  return (
    <div className="h-[92px] flex items-stretch px-1 py-1 gap-0.5"
      style={{ background: "linear-gradient(180deg,var(--c-s2, #fafafa),var(--c-s3, #ececec))", borderBottom: "1px solid var(--c-b3, #b8b8b8)" }}>
      <RibbonGroup label="Вентиляция">
        <div className="flex items-stretch gap-1">
          <RibbonBigBtn icon="Wind" label="Вентиляторы" sublabel="" onClick={() => onOpenRef("fans")} />
          <RibbonBigBtn icon="Layers" label="Типы выработок" sublabel="" onClick={() => onOpenRef("types")} />
          <RibbonBigBtn icon="Square" label="Перемычки" sublabel="" onClick={() => onOpenRef("bulkheads")} />
          <RibbonBigBtn icon="Calculator" label="Нормы" sublabel="расхода воздуха" onClick={() => onOpenRef("airnorms")} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Аварии">
        <div className="flex items-stretch gap-1">

          <RibbonBigBtn icon="Radio" label="Датчики" sublabel="" onClick={() => onOpenRef("sensors")} />
          <RibbonBigBtn icon="FileText" label="Типовые мероприятия" sublabel="" onClick={() => onOpenRef("typical")} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Трубопровод">
        <div className="flex items-stretch gap-1">
          <RibbonBigBtn icon="Gauge" label="Насосы" sublabel="" onClick={() => onOpenRef("pumps")} />
          <RibbonBigBtn icon="Flame" label="Потребители" sublabel="" onClick={() => onOpenRef("consumers")} />
          <RibbonBigBtn icon="GitBranch" label="Трубы" sublabel="" onClick={() => onOpenRef("pipes")} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Общее">
        <div className="flex items-stretch gap-1">
          <RibbonBigBtn icon="Truck" label="Транспорт" sublabel="" onClick={() => onOpenRef("transport")} />
          <RibbonBigBtn icon="Ruler" label="Единицы" sublabel="измерения" onClick={() => onOpenRef("units")} />
          <RibbonBigBtn icon="BookMarked" label="Условные" sublabel="обозначения" onClick={onOpenLegend} />
        </div>
      </RibbonGroup>
    </div>
  );
}

/**
 * Обработчики приходят из Cad.tsx стабильными (useCallback) — иначе memo
 * снимался бы на каждой перерисовке страницы и смысла в выносе не было бы.
 */
const RibbonReferences = React.memo(RibbonReferencesInner);
export default RibbonReferences;