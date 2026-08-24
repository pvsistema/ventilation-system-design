// ─────────────────────────────────────────────────────────────────────────────
// BranchFlagsSection.tsx — раздел «Признаки ветви» вкладки «Топология».
// Утечка с коэффициентом и тупиковая выработка с пояснением о Q=0.
//
// Вынесено из BranchTopologyTab.tsx БЕЗ изменений разметки, формул и подписей.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { SectionHeader, InlineLabel } from "@/components/cad/BranchPropsPrimitives";

interface BranchFlagsSectionProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
}

export default function BranchFlagsSection({ branch, onUpdate }: BranchFlagsSectionProps) {
  return (
  <>
    <SectionHeader title="Признаки ветви" />

    <InlineLabel label="Утечка">
      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", height: 18 }}>
        <input
          type="checkbox"
          checked={branch.isLeakage ?? false}
          onChange={(e) => onUpdate({ isLeakage: e.target.checked })}
          style={{ accentColor: "#f97316", width: 13, height: 13 }}
        />
        <span style={{
          fontSize: 11,
          color: branch.isLeakage ? "var(--c-amber, #c2410c)" : "var(--c-t3, #6b7280)",
          fontWeight: branch.isLeakage ? 600 : 400,
        }}>
          {branch.isLeakage ? "Утечка (перемычка/целик)" : "Не утечка"}
        </span>
      </label>
    </InlineLabel>

    {branch.isLeakage && (
      <InlineLabel label="Коэф. утечки">
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="number"
            min={0} max={1} step={0.01}
            value={branch.leakageCoeff ?? 0}
            onChange={(e) => onUpdate({ leakageCoeff: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) })}
            style={{ width: 52, height: 18, fontSize: 11, border: "1px solid #fca5a5",
              background: "white", outline: "none", textAlign: "right", paddingRight: 2 }}
          />
          <span style={{ fontSize: 10, color: "var(--c-t4, #9ca3af)" }}>
            {branch.leakageCoeff > 0
              ? `${(branch.leakageCoeff * 100).toFixed(0)}% от Q`
              : "не задан"}
          </span>
        </div>
      </InlineLabel>
    )}

    <InlineLabel label="Тупик">
      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", height: 18 }}>
        <input
          type="checkbox"
          checked={branch.isDead ?? false}
          onChange={(e) => onUpdate({ isDead: e.target.checked })}
          style={{ accentColor: "#6b7280", width: 13, height: 13 }}
        />
        <span style={{
          fontSize: 11,
          color: branch.isDead ? "var(--c-t2, #374151)" : "var(--c-t3, #6b7280)",
          fontWeight: branch.isDead ? 600 : 400,
        }}>
          {branch.isDead ? "Тупиковая (Q→0)" : "Сквозная"}
        </span>
      </label>
    </InlineLabel>
    {branch.isDead && (
      <div className="mx-1 mb-1 px-2 py-1 text-[10px] rounded"
        style={{ background: "var(--c-s2, #f9fafb)", border: "1px solid var(--c-b2, #d1d5db)", color: "var(--c-t3, #6b7280)" }}>
        Расчёт задаст Q=0. Контролируется MIN_DEAD_END_FLOW = 0.5 м³/с
      </div>
    )}
  </>
  );
}
