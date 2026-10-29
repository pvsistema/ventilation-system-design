// Окно «Исправления с подтверждением»: программа предлагает значения,
// инженер отмечает, какие принять. Группы — по видам исправлений; у каждой
// строки «было → станет» и откуда взято значение. Клик по строке — показать
// объект на схеме (окно не закрывается).
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SUGGEST_GROUPS, type Suggestion, type SuggestKind } from "@/lib/schemaSuggestFix";

const SHOW_PER_GROUP = 300;

export default function SuggestFixDialog({ open, suggestions, onClose, onApply, onFocusBranch, onFocusNode }: {
  open: boolean;
  suggestions: Suggestion[];
  onClose: () => void;
  onApply: (chosen: Suggestion[]) => void;
  onFocusBranch: (id: string) => void;
  onFocusNode: (id: string) => void;
}) {
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [openGroup, setOpenGroup] = useState<SuggestKind | null>(null);

  // При открытии — отметки по умолчанию.
  useEffect(() => {
    if (!open) return;
    setOn(Object.fromEntries(suggestions.map((s) => [s.id, s.defaultOn])));
    setOpenGroup(SUGGEST_GROUPS.find((g) => suggestions.some((s) => s.kind === g.kind))?.kind ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const groups = useMemo(() => SUGGEST_GROUPS
    .map((g) => ({ ...g, items: suggestions.filter((s) => s.kind === g.kind) }))
    .filter((g) => g.items.length > 0), [suggestions]);
  const chosen = suggestions.filter((s) => on[s.id]);
  const setGroup = (kind: SuggestKind, v: boolean) =>
    setOn((p) => ({ ...p, ...Object.fromEntries(suggestions.filter((s) => s.kind === kind).map((s) => [s.id, v])) }));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[760px] p-0 gap-0 max-h-[85vh] flex flex-col" style={{ background: "var(--c-s1, #fff)" }}>
        <div className="px-4 pt-3 pb-2" style={{ borderBottom: "1px solid var(--c-b1, #e7e4dd)" }}>
          <DialogTitle className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "var(--c-t1, #1f2328)" }}>
            <Icon name="ListChecks" size={16} style={{ color: "var(--c-accent, #1e5a7a)" }} />
            Исправления с подтверждением
          </DialogTitle>
          <DialogDescription className="text-[11px] mt-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>
            Программа предлагает значения по соседним выработкам и справочникам рудника. Отметьте, что принять.
            Всё применяется одним шагом — отменить можно Ctrl+Z. Клик по строке — показать на схеме.
          </DialogDescription>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {groups.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-[12px]" style={{ color: "var(--c-t3, #6b7280)" }}>
              <Icon name="ShieldCheck" size={28} style={{ color: "var(--c-green, #15803d)" }} />
              Предложить нечего: для найденных замечаний нет подходящих значений в соседних выработках и справочниках.
            </div>
          )}
          {groups.map((g) => {
            const n = g.items.filter((s) => on[s.id]).length;
            const all = n === g.items.length, none = n === 0;
            const isOpen = openGroup === g.kind;
            return (
              <section key={g.kind} className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-b1, #e7e4dd)" }}>
                <div className="flex items-center gap-2 px-2 h-8" style={{ background: "var(--c-s2, #f8f7f4)" }}>
                  <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = !all && !none; }}
                    onChange={(e) => setGroup(g.kind, e.target.checked)} title="Отметить все в группе" />
                  <button type="button" onClick={() => setOpenGroup(isOpen ? null : g.kind)}
                    className="flex-1 flex items-center gap-1.5 text-left h-full"
                    style={{ background: "transparent", border: "none", cursor: "pointer" }}>
                    <span className="text-[12px] font-medium" style={{ color: "var(--c-t1, #1f2328)" }}>{g.title}</span>
                    <span className="text-[10px] px-1.5 rounded-full font-semibold"
                      style={{ fontFamily: "var(--font-num)", background: "var(--c-s3, #f1efea)", color: "var(--c-t2, #3d434b)" }}>
                      {n} из {g.items.length}
                    </span>
                    <span className="flex-1" />
                    <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={13} style={{ color: "var(--c-t4, #767f8c)" }} />
                  </button>
                </div>
                {isOpen && (
                  <div className="px-1 pb-1">
                    <div className="px-2 py-1 text-[10px] leading-snug" style={{ color: "var(--c-t3, #6b7280)" }}>{g.hint}</div>
                    {g.items.slice(0, SHOW_PER_GROUP).map((s) => (
                      <div key={s.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--c-s3,#f1efea)] cursor-pointer"
                        onClick={() => (s.branchId ? onFocusBranch(s.branchId) : s.nodeId && onFocusNode(s.nodeId))}
                        title="Показать на схеме">
                        <input type="checkbox" checked={!!on[s.id]} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setOn((p) => ({ ...p, [s.id]: e.target.checked }))} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] truncate" style={{ color: "var(--c-t1, #1f2328)" }}>{s.title}</div>
                          <div className="text-[10px] truncate" style={{ color: "var(--c-t4, #767f8c)" }}>{s.source}</div>
                        </div>
                        <div className="text-[11px] flex items-center gap-1 flex-shrink-0" style={{ fontFamily: "var(--font-num)" }}>
                          <span style={{ color: "var(--c-t3, #6b7280)" }}>{s.from}</span>
                          <Icon name="ArrowRight" size={11} style={{ color: "var(--c-t4, #767f8c)" }} />
                          <span className="font-semibold" style={{ color: "var(--c-accent, #1e5a7a)" }}>{s.to}</span>
                        </div>
                      </div>
                    ))}
                    {g.items.length > SHOW_PER_GROUP && (
                      <div className="px-2 py-1 text-[10px]" style={{ color: "var(--c-t3, #6b7280)" }}>
                        Показаны первые {SHOW_PER_GROUP} из {g.items.length}; отметка группы действует на все.
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderTop: "1px solid var(--c-b1, #e7e4dd)" }}>
          <span className="flex-1 text-[11px]" style={{ color: "var(--c-t3, #6b7280)" }}>
            Отмечено: {chosen.length} из {suggestions.length}
          </span>
          <button type="button" onClick={onClose}
            className="h-8 px-3 rounded text-[12px]"
            style={{ background: "transparent", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3d434b)", cursor: "pointer" }}>
            Отмена
          </button>
          <button type="button" disabled={chosen.length === 0} onClick={() => onApply(chosen)}
            className="h-8 px-3 rounded text-[12px] font-semibold flex items-center gap-1.5"
            style={{
              border: "none", cursor: chosen.length === 0 ? "default" : "pointer",
              background: chosen.length === 0 ? "var(--c-s3, #f1efea)" : "var(--c-accent, #1e5a7a)",
              color: chosen.length === 0 ? "var(--c-t4, #767f8c)" : "#fff",
            }}>
            <Icon name="Check" size={13} />
            Применить ({chosen.length})
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
