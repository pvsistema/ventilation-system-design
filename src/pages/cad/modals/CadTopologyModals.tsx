// ─────────────────────────────────────────────────────────────────────────────
// CadTopologyModals — модальные окна правки топологии: возврат схемы к
// маркшейдерским координатам (F5), подтверждение удаления ветвей, объединение
// ветвей при удалении промежуточного узла, число людей в отделении.
// Выделено из CadModals без изменений разметки и логики (1:1).
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";
import { type TopoBranch } from "@/lib/topology";
import { type DeleteBranchPlan } from "../deleteBranchPlan";

export type MergeNodeState = { nodeId: string; branchA: string; branchB: string };
// t — доля длины ветви (точка клика курсором), чтобы отделение встало
// в указанное место, а не в середину ветви.
export type SquadState = { typeId: string; x: number; y: number; branchId: string | null; t?: number };

export interface CadTopologyModalsProps {
  branchesRaw: TopoBranch[];

  // Возврат схемы к маркшейдерским координатам (F5)
  resetSurveyDialog: boolean;
  setResetSurveyDialog: (v: boolean) => void;
  resetAllNodesToSurvey: () => void;
  movedNodeCount: number;
  nodeCount: number;

  // Подтверждение удаления ветвей (УО и осиротевшие узлы)
  deleteBranchDialog: DeleteBranchPlan | null;
  setDeleteBranchDialog: (v: DeleteBranchPlan | null) => void;
  confirmDeleteBranches: (plan: DeleteBranchPlan, removeOrphanNodes: boolean) => void;

  // Объединение ветвей при удалении промежуточного узла
  mergeNodeDialog: MergeNodeState | null;
  setMergeNodeDialog: (v: MergeNodeState | null) => void;
  doDeleteNode: (nodeId: string) => void;
  mergeAdjacentBranches: (nodeId: string, branchAId: string, branchBId: string) => void;

  // Число людей в отделении
  squadDialog: SquadState | null;
  setSquadDialog: (v: SquadState | null) => void;
  squadCount: string;
  setSquadCount: (v: string) => void;
  addSymbol: (typeId: string, x: number, y: number, branchId?: string | null, label?: string, scale?: number, t?: number) => void;
  setTool: (v: "select") => void;
  setActiveSymbolTypeId: (v: string | null) => void;
}

export default function CadTopologyModals(p: CadTopologyModalsProps) {
  return (
    <>
      {/* ═══ ДИАЛОГ: ВЕРНУТЬ СХЕМУ К МАРКШЕЙДЕРСКИМ КООРДИНАТАМ (F5) ════════ */}
      {p.resetSurveyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="flex flex-col shadow-2xl border border-gray-400"
            style={{ width: 400, background: "var(--c-s1, #fff)", fontFamily: "var(--font-ui)" }}>
            <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300"
              style={{ background: "linear-gradient(180deg,var(--c-grad-a, #e8e8e8),var(--c-grad-b, #d4d4d4))" }}>
              <span className="text-[12px] font-semibold text-gray-800">
                Вернуть схему к маркшейдерским координатам
              </span>
              <button onClick={() => p.setResetSurveyDialog(false)}
                className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
                <Icon name="X" size={12} />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="rounded text-[11px] px-3 py-2"
                style={{ background: "var(--c-tint-blue, #eff6ff)", border: "1px solid #81b0c4" }}>
                <div className="font-semibold text-blue-800 mb-1 flex items-center gap-1">
                  <Icon name="MapPin" size={12} />
                  Будет возвращено на место: {p.movedNodeCount} узл. из {p.nodeCount}
                </div>
                <div className="text-[11px] text-blue-900 leading-relaxed">
                  Узлы встанут туда, где выработки находятся на самом деле.
                  Сдвиги, сделанные для читаемости схемы, будут отменены.
                </div>
              </div>
              <div className="text-[11px] text-gray-600 leading-relaxed">
                На расчёт это не влияет: длины выработок и воздухораспределение
                и так считались по маркшейдерским координатам. Меняется только
                вид схемы. Действие отменяется через Ctrl+Z.
              </div>
            </div>

            <div className="flex gap-2 justify-end px-4 py-3 border-t border-gray-200"
              style={{ background: "var(--c-s2, #f8f8f8)" }}>
              <button onClick={() => p.setResetSurveyDialog(false)}
                className="text-[11px] px-3 py-1 rounded"
                style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d1d5db)", color: "var(--c-t2, #374151)", cursor: "pointer" }}>
                Отмена
              </button>
              <button
                onClick={() => { p.resetAllNodesToSurvey(); p.setResetSurveyDialog(false); }}
                className="text-[11px] px-3 py-1 rounded font-semibold"
                style={{ background: "var(--c-blue-bg, #1d4ed8)", border: "1px solid var(--c-blue, #1d4ed8)", color: "white", cursor: "pointer" }}>
                Вернуть на место
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ ДИАЛОГ: ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ ВЕТВЕЙ ══════════════════════════ */}
      {p.deleteBranchDialog && (() => {
        const plan = p.deleteBranchDialog;
        const hasSymbols = plan.symbols.length > 0;
        const hasOrphans = plan.orphanNodeIds.length > 0;
        const listCls = "text-[11px] text-gray-700 leading-relaxed";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <div className="flex flex-col shadow-2xl border border-gray-400"
              style={{ width: 420, maxHeight: "85vh", background: "var(--c-s1, #fff)", fontFamily: "var(--font-ui)" }}>
              <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300 flex-shrink-0"
                style={{ background: "linear-gradient(180deg,var(--c-grad-a, #e8e8e8),var(--c-grad-b, #d4d4d4))" }}>
                <span className="text-[12px] font-semibold text-gray-800">
                  {plan.branchIds.length > 1
                    ? `Удаление выработок (${plan.branchIds.length})`
                    : "Удаление выработки"}
                </span>
                <button onClick={() => p.setDeleteBranchDialog(null)}
                  className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
                  <Icon name="X" size={12} />
                </button>
              </div>

              <div className="p-4 flex flex-col gap-3 overflow-y-auto">
                <div className="rounded text-[11px] px-3 py-2"
                  style={{ background: "var(--c-tint-red, #fef2f2)", border: "1px solid #fca5a5" }}>
                  <div className="font-semibold text-red-800 mb-1">
                    Будет удалено: {plan.branchIds.length} выраб.
                  </div>
                  <div className={listCls} style={{ maxHeight: 90, overflowY: "auto" }}>
                    {plan.branchLabels.slice(0, 12).map((n, i) => (
                      <div key={i}>· {n}</div>
                    ))}
                    {plan.branchLabels.length > 12 && (
                      <div className="text-gray-500">…и ещё {plan.branchLabels.length - 12}</div>
                    )}
                  </div>
                </div>

                {/* УО на удаляемых ветвях — вентиляторы, перемычки и т.п. */}
                {hasSymbols && (
                  <div className="rounded text-[11px] px-3 py-2"
                    style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fcd34d" }}>
                    <div className="font-semibold text-amber-800 mb-1 flex items-center gap-1">
                      <Icon name="TriangleAlert" size={12} />
                      Вместе с ними исчезнут УО ({plan.symbols.length})
                    </div>
                    <div className={listCls} style={{ maxHeight: 90, overflowY: "auto" }}>
                      {plan.symbols.slice(0, 12).map(s => (
                        <div key={s.id}>· {s.label}</div>
                      ))}
                      {plan.symbols.length > 12 && (
                        <div className="text-gray-500">…и ещё {plan.symbols.length - 12}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Изолированные узлы: главная причина, по которой расчёт сети
                    переставал сходиться после молчаливого удаления ветви. */}
                {hasOrphans && (
                  <div className="rounded text-[11px] px-3 py-2"
                    style={{ background: "var(--c-tint-blue, #eff6ff)", border: "1px solid #81b0c4" }}>
                    <div className="font-semibold text-blue-800 mb-1 flex items-center gap-1">
                      <Icon name="Unlink" size={12} />
                      Останутся без выработок ({plan.orphanNodeIds.length} узл.)
                    </div>
                    <div className={listCls} style={{ maxHeight: 70, overflowY: "auto" }}>
                      {plan.orphanNodeLabels.slice(0, 12).map((n, i) => (
                        <div key={i}>· {n}</div>
                      ))}
                      {plan.orphanNodeLabels.length > 12 && (
                        <div className="text-gray-500">…и ещё {plan.orphanNodeLabels.length - 12}</div>
                      )}
                    </div>
                    <div className="text-[10px] text-blue-700 mt-1">
                      Такие узлы ни к чему не подключены и мешают расчёту
                      воздухораспределения. Рекомендуется удалить их вместе с выработками.
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end px-4 py-3 border-t border-gray-200 flex-shrink-0"
                style={{ background: "var(--c-s2, #f8f8f8)" }}>
                <button onClick={() => p.setDeleteBranchDialog(null)}
                  className="text-[11px] px-3 py-1 rounded"
                  style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d1d5db)", color: "var(--c-t2, #374151)", cursor: "pointer" }}>
                  Отмена
                </button>
                {hasOrphans && (
                  <button onClick={() => p.confirmDeleteBranches(plan, false)}
                    className="text-[11px] px-3 py-1 rounded"
                    style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d1d5db)", color: "var(--c-t2, #374151)", cursor: "pointer" }}>
                    Оставить узлы
                  </button>
                )}
                <button onClick={() => p.confirmDeleteBranches(plan, true)}
                  className="text-[11px] px-3 py-1 rounded font-semibold"
                  style={{ background: "var(--c-red-bg, #dc2626)", border: "1px solid var(--c-red, #dc2626)", color: "white", cursor: "pointer" }}>
                  {hasOrphans ? "Удалить с узлами" : "Удалить"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ ДИАЛОГ: ОБЪЕДИНИТЬ ВЕТВИ ПРИ УДАЛЕНИИ ПРОМЕЖУТОЧНОГО УЗЛА ══════ */}
      {p.mergeNodeDialog && (() => {
        const brA = p.branchesRaw.find(b => b.id === p.mergeNodeDialog!.branchA) as (TopoBranch & { name?: string }) | undefined;
        const brB = p.branchesRaw.find(b => b.id === p.mergeNodeDialog!.branchB) as (TopoBranch & { name?: string }) | undefined;
        const nameA = brA?.name || p.mergeNodeDialog!.branchA.substring(0, 12);
        const nameB = brB?.name || p.mergeNodeDialog!.branchB.substring(0, 12);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <div className="flex flex-col shadow-2xl border border-gray-400"
              style={{ width: 360, background: "var(--c-s1, #fff)", fontFamily: "var(--font-ui)" }}>
              {/* Заголовок */}
              <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300"
                style={{ background: "linear-gradient(180deg,var(--c-grad-a, #e8e8e8),var(--c-grad-b, #d4d4d4))" }}>
                <span className="text-[12px] font-semibold text-gray-800">Удаление узла</span>
                <button onClick={() => p.setMergeNodeDialog(null)}
                  className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
                  <Icon name="X" size={12} />
                </button>
              </div>
              {/* Тело */}
              <div className="p-4 flex flex-col gap-3">
                <p className="text-[12px] text-gray-700">
                  Узел соединяет две выработки. Объединить их в одну?
                </p>
                <div className="rounded text-[11px] text-gray-600 px-3 py-2" style={{ background: "var(--c-tint-blue, #f0f4ff)", border: "1px solid #c8d4e8" }}>
                  <div className="font-semibold text-gray-700 mb-1">Будут объединены:</div>
                  <div>· {nameA || "Выработка 1"}</div>
                  <div>· {nameB || "Выработка 2"}</div>
                  <div className="mt-1 text-[10px] text-gray-500">Длина = сумма длин. Параметры берутся от первой выработки.</div>
                </div>
              </div>
              {/* Кнопки */}
              <div className="flex gap-2 justify-end px-4 py-3 border-t border-gray-200"
                style={{ background: "var(--c-s2, #f8f8f8)" }}>
                <button
                  onClick={() => { p.doDeleteNode(p.mergeNodeDialog!.nodeId); p.setMergeNodeDialog(null); }}
                  className="text-[11px] px-3 py-1 rounded"
                  style={{ background: "var(--c-tint-red2, #fee2e2)", border: "1px solid #fca5a5", color: "var(--c-red-ink, #991b1b)", cursor: "pointer" }}>
                  Удалить без объединения
                </button>
                <button
                  onClick={() => {
                    p.mergeAdjacentBranches(p.mergeNodeDialog!.nodeId, p.mergeNodeDialog!.branchA, p.mergeNodeDialog!.branchB);
                    p.setMergeNodeDialog(null);
                  }}
                  className="text-[11px] px-3 py-1 rounded font-semibold"
                  style={{ background: "var(--c-blue-bg, #1d4ed8)", border: "1px solid var(--c-blue, #1d4ed8)", color: "white", cursor: "pointer" }}>
                  Объединить выработки
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ ДИАЛОГ: ЧИСЛО ЛЮДЕЙ В ОТДЕЛЕНИИ ════════════════════════════════ */}
      {p.squadDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => p.setSquadDialog(null)}>
          <div className="flex flex-col shadow-2xl border border-gray-400"
            style={{ width: 320, background: "var(--c-s1, #fff)", fontFamily: "var(--font-ui)" }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300"
              style={{ background: "linear-gradient(180deg,var(--c-grad-a, #e8e8e8),var(--c-grad-b, #d4d4d4))" }}>
              <span className="text-[12px] font-semibold text-gray-800">Число людей в отделении</span>
              <button onClick={() => p.setSquadDialog(null)} className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
                <Icon name="X" size={12} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <label className="text-[11px] text-gray-600">Количество человек:</label>
              <input
                autoFocus
                type="number" min={1} max={99}
                value={p.squadCount}
                onChange={e => p.setSquadCount(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const n = parseInt(p.squadCount) || 5;
                    p.addSymbol(p.squadDialog!.typeId, p.squadDialog!.x, p.squadDialog!.y, p.squadDialog!.branchId, `${n} чел.`, undefined, p.squadDialog!.t);
                    p.setTool("select"); p.setActiveSymbolTypeId(null); p.setSquadDialog(null);
                  }
                  if (e.key === "Escape") p.setSquadDialog(null);
                }}
                className="border border-gray-300 rounded px-2 py-1 text-[13px] text-center w-full outline-none focus:border-blue-500" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => p.setSquadDialog(null)}
                  className="h-7 px-3 text-[11px] border border-gray-300 rounded hover:bg-gray-100">Отмена</button>
                <button onClick={() => {
                  const n = parseInt(p.squadCount) || 5;
                  p.addSymbol(p.squadDialog!.typeId, p.squadDialog!.x, p.squadDialog!.y, p.squadDialog!.branchId, `${n} чел.`, undefined, p.squadDialog!.t);
                  p.setTool("select"); p.setActiveSymbolTypeId(null); p.setSquadDialog(null);
                }}
                  className="h-7 px-3 text-[11px] rounded text-white" style={{ background: "var(--c-blue-bg, #2563eb)" }}>
                  Разместить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
