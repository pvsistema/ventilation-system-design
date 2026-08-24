// ─────────────────────────────────────────────────────────────────────────────
// BranchTopologyTab.tsx — вкладка «Топология» панели свойств выработки:
// геометрия (длина, угол, сечение), сопротивление, вентиляционная труба,
// расчётные показатели потока.
//
// Вынесено из BranchPropsPanel.tsx БЕЗ изменений разметки, формул и подписей.
//
// Сама вкладка — только сборка четырёх разделов, каждый в своём файле:
//   • BranchGeometrySection      — «Геометрия»;
//   • BranchAerodynamicsSection  — «Аэродинамика»;
//   • BranchFlagsSection         — «Признаки ветви»;
//   • BranchComputedSection      — «Вычисленные параметры».
// Разметка, формулы и подписи при выносе не менялись.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { type VentSection } from "@/lib/ventSections";
import BranchGeometrySection from "./BranchGeometrySection";
import BranchAerodynamicsSection from "./BranchAerodynamicsSection";
import BranchFlagsSection from "./BranchFlagsSection";
import BranchComputedSection from "./BranchComputedSection";

interface BranchTopologyTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  shortNode: (id: string) => string;
  visible: Set<string>;
  toggle: (id: string) => void;
  angle: number;
  unitR: number;
  uRes: { fromBase: (v: number) => number; symbol: string; decimals: number };
  rToDisplay: (rKmurg: number) => number;
  numFmt: (v: number, d?: number) => string;
  fmtR: (rKmu: number, minDecimals?: number) => string;
  bulkheadRKmu: number;
  ventSections: VentSection[];
  onOpenSectionsLibrary?: () => void;
}

export default function BranchTopologyTab({
  branch, onUpdate, shortNode, visible, toggle, angle, unitR, uRes, rToDisplay,
  numFmt, fmtR, bulkheadRKmu, ventSections, onOpenSectionsLibrary,
}: BranchTopologyTabProps) {
  return (
  <div>
    <BranchGeometrySection
      branch={branch}
      onUpdate={onUpdate}
      shortNode={shortNode}
      angle={angle}
      numFmt={numFmt}
      ventSections={ventSections}
      onOpenSectionsLibrary={onOpenSectionsLibrary}
    />

    <BranchAerodynamicsSection
      branch={branch}
      onUpdate={onUpdate}
      uRes={uRes}
      numFmt={numFmt}
    />

    <BranchFlagsSection
      branch={branch}
      onUpdate={onUpdate}
    />

    <BranchComputedSection
      branch={branch}
      onUpdate={onUpdate}
      visible={visible}
      toggle={toggle}
      angle={angle}
      unitR={unitR}
      uRes={uRes}
      rToDisplay={rToDisplay}
      numFmt={numFmt}
      fmtR={fmtR}
      bulkheadRKmu={bulkheadRKmu}
    />
  </div>
  );
}
