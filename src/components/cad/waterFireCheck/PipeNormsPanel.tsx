// Блок «Трубы по нормам» в проверке ППЗ: трубы меньше нормы для своей линии
// и трубы, где скорость воды выше 2 м/с (обычный расход) или 4 м/с (пожар).
import { useState } from "react";
import Icon from "@/components/ui/icon";
import { MIN_DN, V_TECH, V_FIRE } from "@/lib/waterPipes";

const LINE_ONE = { main: "Магистральная", section: "Участковая", face: "Забойная" } as const;
import { PIPE_ISSUE_LABEL, type PipeNormsResult } from "@/lib/waterPipeNorms";

const fmt = (v?: number) => (v !== undefined ? String(v).replace(".", ",") : "—");

export default function PipeNormsPanel({ result, kind, onKind, onHighlightBranch }: {
  result: PipeNormsResult;
  kind: "ore" | "coal";
  onKind: (k: "ore" | "coal") => void;
  onHighlightBranch?: (branchId: string) => void;
}) {
  const [open, setOpen] = useState(result.issues.length > 0);
  const n = result.issues.length;
  const min = MIN_DN[kind];
  const ok = n === 0;
  const tone = ok ? "var(--c-green, #15803d)" : "var(--c-amber-ink, #865412)";

  return (
    <div style={{ borderBottom: "1px solid #e0e4ee" }}>
      <div className="px-4 py-2 flex items-center gap-3 text-[11px] cursor-pointer select-none"
        style={{ background: ok ? "transparent" : "var(--c-tint-amber, #fff4e5)" }}
        onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={13} className="text-gray-500" />
        <Icon name={ok ? "CircleCheck" : "TriangleAlert"} size={14} style={{ color: tone }} />
        <span className="font-semibold" style={{ color: tone }}>
          Трубы по нормам: {ok ? "нарушений нет" : `${n} ${n === 1 ? "замечание" : n < 5 ? "замечания" : "замечаний"}`}
        </span>
        <span className="text-gray-500">
          проверено труб: {result.total}
          {result.noLine > 0 && <> · без назначения линии: {result.noLine} (диаметр не проверялся)</>}
        </span>
        <span className="ml-auto inline-flex p-0.5 rounded" style={{ background: "var(--c-s3, #eef1f6)" }}
          onClick={(e) => e.stopPropagation()}>
          {(["ore", "coal"] as const).map((k) => (
            <button key={k} onClick={() => onKind(k)}
              className="px-2 h-5 rounded text-[10px]"
              style={{
                background: kind === k ? "var(--c-s1, #fff)" : "transparent",
                color: kind === k ? "var(--c-blue, #1d4ed8)" : "var(--c-t3, #6b7280)",
                fontWeight: kind === k ? 600 : 400,
              }}>
              {k === "ore" ? "Рудник" : "Угольная шахта"}
            </button>
          ))}
        </span>
      </div>

      {open && (
        <div className="px-4 pb-2">
          <div className="text-[10px] text-gray-500 py-1">
            Норма: магистральные — не менее DN {min.main}, участковые — не менее DN {min.section};
            скорость воды — до {V_TECH} м/с при обычном расходе и до {V_FIRE} м/с при пожаротушении
            (худший из пожарных сценариев проверки); давление в трубе (при закрытых кранах) — не выше
            допустимого для её стенки с запасом на коррозию. Назначение линии задаётся в свойствах ветви («Трубы» → «Линия»).
          </div>
          {ok ? null : (
            <div className="overflow-auto" style={{ maxHeight: 180 }}>
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0" style={{ background: "var(--c-s3, #f6f8fc)" }}>
                  <tr className="text-gray-500">
                    <th className="text-left font-semibold px-2 py-1">Ветвь</th>
                    <th className="text-left font-semibold px-2 py-1">Линия</th>
                    <th className="text-right font-semibold px-2 py-1">Труба, мм</th>
                    <th className="text-right font-semibold px-2 py-1">DN / норма</th>
                    <th className="text-right font-semibold px-2 py-1" title="Наибольшее давление в трубе / допустимое для её стенки">P / P доп., МПа</th>
                    <th className="text-right font-semibold px-2 py-1">v, м/с</th>
                    <th className="text-right font-semibold px-2 py-1">v пожар, м/с</th>
                    <th className="text-left font-semibold px-2 py-1">Замечание и что сделать</th>
                  </tr>
                </thead>
                <tbody>
                  {result.issues.map((it) => (
                    <tr key={it.branchId} className="border-t border-gray-100 hover:bg-blue-50"
                      style={{ cursor: onHighlightBranch ? "pointer" : "default" }}
                      onClick={() => onHighlightBranch?.(it.branchId)}>
                      <td className="px-2 py-1 font-medium">{it.title}</td>
                      <td className="px-2 py-1 text-gray-600">{it.line ? LINE_ONE[it.line] : "—"}</td>
                      <td className="px-2 py-1 text-right">{it.size}</td>
                      <td className="px-2 py-1 text-right"
                        style={{ color: it.kinds.includes("small-diameter") ? "var(--c-red, #dc2626)" : undefined, fontWeight: it.kinds.includes("small-diameter") ? 600 : 400 }}>
                        {it.dn}{it.minDn ? ` / ${it.minDn}` : ""}
                      </td>
                      <td className="px-2 py-1 text-right whitespace-nowrap"
                        style={{ color: it.kinds.includes("over-pressure") ? "var(--c-red, #dc2626)" : undefined, fontWeight: it.kinds.includes("over-pressure") ? 600 : 400 }}>
                        {fmt(it.pressure)} / {fmt(it.allowedPressure)}
                      </td>
                      <td className="px-2 py-1 text-right"
                        style={{ color: it.kinds.includes("tech-velocity") ? "var(--c-red, #dc2626)" : undefined, fontWeight: it.kinds.includes("tech-velocity") ? 600 : 400 }}>
                        {fmt(it.techVelocity)}
                      </td>
                      <td className="px-2 py-1 text-right"
                        style={{ color: it.kinds.includes("fire-velocity") ? "var(--c-red, #dc2626)" : undefined, fontWeight: it.kinds.includes("fire-velocity") ? 600 : 400 }}>
                        {fmt(it.fireVelocity)}
                      </td>
                      <td className="px-2 py-1">
                        <div style={{ color: "var(--c-red, #dc2626)" }}>{it.kinds.map((k) => PIPE_ISSUE_LABEL[k]).join(", ")}</div>
                        <div className="text-gray-500">{it.recommendation}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
