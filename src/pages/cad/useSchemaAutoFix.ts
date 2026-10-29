// ─────────────────────────────────────────────────────────────────────────────
// «Исправить автоматически» в панели «Проверка схемы»: предпросмотр (что и
// сколько будет исправлено) и применение одним шагом с отменой по Ctrl+Z.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import type { TopoNode, TopoBranch } from "@/lib/topology";
import type { Position } from "@/lib/positions";
import type { SchemaSymbol, SideTab } from "./cadTypes";
import type { SchemaCheckSettings } from "@/lib/schemaCheckSettings";
import { autoFixSchema, AUTO_FIX_LIST, type AutoFixKind } from "@/lib/schemaAutoFix";
import { buildSuggestions, applySuggestions, SUGGEST_GROUPS, type Suggestion, type SuggestCheck } from "@/lib/schemaSuggestFix";
import type { MineBulkheadExport, BranchType } from "@/components/cad/EquipmentRefDialog";

const DEFAULT_ON = Object.fromEntries(AUTO_FIX_LIST.map((f) => [f.kind, f.defaultOn])) as Record<AutoFixKind, boolean>;

export function useSchemaAutoFix(p: {
  activeSide: SideTab;
  nodes: TopoNode[];
  /** Ветви с пересчитанной длиной (как их видит проверка). */
  branches: TopoBranch[];
  symbols: SchemaSymbol[];
  positions: Position[];
  settings: SchemaCheckSettings;
  pushHistory: () => void;
  setNodes: (v: TopoNode[]) => void;
  setBranches: (v: TopoBranch[]) => void;
  setSymbols: (v: SchemaSymbol[]) => void;
  setPositions: (v: Position[]) => void;
  addLog: (level: "ok" | "info" | "warn" | "error", text: string) => void;
  /** Результат проверки схемы — из него строятся предложения. */
  check: SuggestCheck | null;
  bulkheadRefs: MineBulkheadExport[];
  mineTypes: BranchType[];
}) {
  const [enabled, setEnabled] = useState<Record<AutoFixKind, boolean>>(DEFAULT_ON);
  const opts = useMemo(() => ({
    tinyLength: p.settings.tinyLength,
    onAxisTolerance: p.settings.onAxisTolerance,
  }), [p.settings.tinyLength, p.settings.onAxisTolerance]);

  // Предпросмотр считаем со ВСЕМИ видами — чтобы показать число и у
  // выключенных галочек.
  const preview = useMemo(() => {
    if (p.activeSide !== "check" || p.branches.length === 0) return null;
    const all = Object.fromEntries(AUTO_FIX_LIST.map((f) => [f.kind, true])) as Record<AutoFixKind, boolean>;
    return autoFixSchema(
      { nodes: p.nodes, branches: p.branches, symbols: p.symbols, positions: p.positions },
      { ...opts, enabled: all },
    ).counts;
  }, [p.activeSide, p.nodes, p.branches, p.symbols, p.positions, opts]);

  const toggle = useCallback((kind: AutoFixKind, on: boolean) => {
    setEnabled((prev) => ({ ...prev, [kind]: on }));
  }, []);

  const apply = () => {
    const res = autoFixSchema(
      { nodes: p.nodes, branches: p.branches, symbols: p.symbols, positions: p.positions },
      { ...opts, enabled },
    );
    if (res.total === 0) { toast.info("Исправлять нечего"); return; }
    p.pushHistory();
    p.setNodes(res.nodes);
    p.setBranches(res.branches);
    p.setSymbols(res.symbols);
    p.setPositions(res.positions);
    const parts = AUTO_FIX_LIST.filter((f) => res.counts[f.kind] > 0)
      .map((f) => `${f.title.toLowerCase()} — ${res.counts[f.kind]}`);
    p.addLog("ok", `Автоисправление схемы: ${parts.join("; ")}`);
    toast.success(`Исправлено: ${res.total}`, {
      description: `${parts.slice(0, 3).join(" · ")}${parts.length > 3 ? ` · и ещё ${parts.length - 3}` : ""}. Отменить — Ctrl+Z.`,
      duration: 8000,
    });
  };

  // ── Исправления с подтверждением ────────────────────────────────────────
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestions = useMemo<Suggestion[]>(() => {
    if (p.activeSide !== "check" || !p.check || p.branches.length === 0) return [];
    return buildSuggestions(
      { nodes: p.nodes, branches: p.branches, symbols: p.symbols, positions: p.positions },
      p.check,
      {
        areaMin: p.settings.areaMin, areaMax: p.settings.areaMax,
        alphaMin: p.settings.alphaMin, alphaMax: p.settings.alphaMax,
        bulkheadRefs: p.bulkheadRefs, mineTypes: p.mineTypes,
      },
    );
  }, [p.activeSide, p.check, p.nodes, p.branches, p.symbols, p.positions, p.settings, p.bulkheadRefs, p.mineTypes]);

  const applySuggest = (chosen: Suggestion[]) => {
    if (chosen.length === 0) return;
    const res = applySuggestions({ nodes: p.nodes, branches: p.branches, symbols: p.symbols, positions: p.positions }, chosen);
    p.pushHistory();
    p.setNodes(res.nodes);
    p.setBranches(res.branches);
    p.setSymbols(res.symbols);
    p.setPositions(res.positions);
    setSuggestOpen(false);
    const parts = SUGGEST_GROUPS.map((g) => [g.title, chosen.filter((s) => s.kind === g.kind).length] as const)
      .filter(([, n]) => n > 0).map(([t, n]) => `${t.toLowerCase()} — ${n}`);
    p.addLog("ok", `Исправления с подтверждением: ${parts.join("; ")}`);
    toast.success(`Применено исправлений: ${chosen.length}`, {
      description: `${parts.slice(0, 3).join(" · ")}${parts.length > 3 ? ` · и ещё ${parts.length - 3}` : ""}. Отменить — Ctrl+Z.`,
      duration: 8000,
    });
  };

  return {
    autoFixPreview: preview, autoFixEnabled: enabled, onAutoFixToggle: toggle, onAutoFixApply: apply,
    suggestions, suggestOpen, setSuggestOpen, applySuggest,
  };
}
