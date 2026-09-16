// ─────────────────────────────────────────────────────────────────────────────
// CadCompareModal — диалог сравнения схем: выбор второго .vproj, расчёт
// диффа по ветвям/узлам и переключение левой панели в режим сравнения.
// Выделено из CadModals без изменений разметки и логики (1:1).
// ─────────────────────────────────────────────────────────────────────────────
import type React from "react";
import Icon from "@/components/ui/icon";
import { compareBranches, compareNodes } from "../cadUtils";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type CompareResult } from "../cadTypes";

export interface CadCompareModalProps {
  nodes: TopoNode[];
  branches: TopoBranch[];
  branchesRaw: TopoBranch[];
  projectFileName: string;

  compareShowDialog: boolean;
  setCompareShowDialog: (v: boolean) => void;
  compareLoading: boolean;
  setCompareLoading: (v: boolean) => void;
  setCompareResult: (v: CompareResult | null) => void;
  setCompareFilter: (v: "all" | "changed" | "added" | "removed") => void;
  setCompareSelectedId: (v: string | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setActiveSide: React.Dispatch<React.SetStateAction<any>>;
  setLeftPanelOpen: (v: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setActiveRibbon: React.Dispatch<React.SetStateAction<any>>;
}

export default function CadCompareModal(p: CadCompareModalProps) {
  return (
    <>
      {/* ── Диалог сравнения схем ──────────────────────────────────────── */}
      {p.compareShowDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={() => p.setCompareShowDialog(false)}>
          <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-[480px]"
            style={{ fontFamily: "Segoe UI, Arial, sans-serif" }}
            onClick={e => e.stopPropagation()}>
            {/* Шапка */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200"
              style={{ background: "linear-gradient(180deg,var(--c-grad-a, #e8e8e8),var(--c-grad-b, #d6d6d6))" }}>
              <span className="text-[12px] font-semibold text-gray-800">↔ Сравнение схем</span>
              <button onClick={() => p.setCompareShowDialog(false)}
                className="w-6 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs rounded-sm">✕</button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Текущая схема */}
              <div>
                <div className="text-[11px] text-gray-500 mb-1 font-medium">Исходный файл:</div>
                <div className="flex items-center gap-2 px-3 py-2 rounded border border-gray-200"
                  style={{ background: "var(--c-s2, #f9fafb)" }}>
                  <Icon name="FileText" size={18} style={{ color: "var(--c-blue, #2563eb)" }} />
                  <span className="text-[12px] font-medium text-gray-800">{p.projectFileName}</span>
                  <span className="ml-auto text-[10px] text-gray-400">{p.nodes.length} уз. / {p.branches.length} вет.</span>
                </div>
              </div>

              {/* Выбор файла для сравнения */}
              <div>
                <div className="text-[11px] text-gray-500 mb-1 font-medium">Изменённая схема:</div>
                <button
                  disabled={p.compareLoading}
                  onClick={() => {
                    const inp = document.createElement("input");
                    inp.type = "file";
                    inp.accept = ".vproj,.json,application/json,text/plain";
                    inp.onchange = () => {
                      const file = inp.files?.[0];
                      if (!file) return;
                      p.setCompareLoading(true);
                      const reader = new FileReader();
                      reader.onload = () => {
                        try {
                          const data = JSON.parse(reader.result as string) as Record<string, unknown>;
                          if (!data.nodes || !Array.isArray(data.nodes)) {
                            alert("Файл не является проектом ПВ-Система.");
                            p.setCompareLoading(false);
                            return;
                          }
                          const oldBranches = p.branchesRaw;
                          const oldNodes    = p.nodes;
                          const newBranches = (data.branches as typeof p.branchesRaw) ?? [];
                          const newNodes    = (data.nodes    as typeof p.nodes) ?? [];
                          const branchDiffs = compareBranches(oldBranches, newBranches);
                          const nodeDiffs   = compareNodes(oldNodes, newNodes);
                          p.setCompareResult({
                            branches: branchDiffs,
                            nodes:    nodeDiffs,
                            fileName: file.name,
                          });
                          p.setCompareFilter("all");
                          p.setCompareSelectedId(null);
                          p.setActiveSide("compare");
                          p.setLeftPanelOpen(true);
                          p.setCompareShowDialog(false);
                          p.setActiveRibbon("vent");
                        } catch {
                          alert("Ошибка чтения файла.");
                        } finally {
                          p.setCompareLoading(false);
                        }
                      };
                      reader.readAsText(file);
                    };
                    inp.click();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded border-2 border-dashed transition-colors"
                  style={{
                    borderColor: p.compareLoading ? "#93c5fd" : "var(--c-b2, #d1d5db)",
                    background: p.compareLoading ? "var(--c-tint-blue, #eff6ff)" : "var(--c-s2, #f9fafb)",
                    cursor: p.compareLoading ? "wait" : "pointer",
                  }}>
                  <Icon name={p.compareLoading ? "Loader" : "FolderOpen"} size={22}
                    style={{ color: "var(--c-blue, #2563eb)" }} className={p.compareLoading ? "animate-spin" : ""} />
                  <div className="text-left">
                    <div className="text-[12px] font-medium text-gray-800">
                      {p.compareLoading ? "Загрузка..." : "Выбрать файл для сравнения"}
                    </div>
                    <div className="text-[10px] text-gray-400">Формат .vproj</div>
                  </div>
                </button>
              </div>

              <div className="text-[10px] text-gray-400 leading-relaxed">
                Сравнение покажет: добавленные, удалённые и изменённые выработки.
                Жёлтым выделяются изменённые, зелёным — добавленные, красным — удалённые.
              </div>
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
              <button onClick={() => p.setCompareShowDialog(false)}
                className="h-7 px-4 text-[12px] rounded border border-gray-300 text-gray-700 hover:bg-gray-100">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
