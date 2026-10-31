// Блок «Давление в стволах» в проверке ППЗ: крутые ветви водопровода, где
// внизу при закрытых кранах давление выше допустимого, — с подсказкой, где
// поставить бак разрыва струи (или каскад баков).
import { useState } from "react";
import Icon from "@/components/ui/icon";
import type { ShaftPressureResult } from "@/lib/waterShaftPressure";

const fmt = (v: number) => String(v).replace(".", ",");

export default function ShaftPressurePanel({ result, maxPressure, onHighlightBranch }: {
  result: ShaftPressureResult;
  maxPressure: number;
  onHighlightBranch?: (branchId: string) => void;
}) {
  const n = result.issues.length;
  const [open, setOpen] = useState(n > 0);
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
          Давление в стволах: {ok ? "в норме" : `${n} ${n === 1 ? "ствол" : n < 5 ? "ствола" : "стволов"} с превышением`}
        </span>
        <span className="text-gray-500">проверено крутых участков: {result.total}</span>
      </div>

      {open && (
        <div className="px-4 pb-2">
          <div className="text-[10px] text-gray-500 py-1">
            В стволе вода набирает около 0,1 МПа на каждые 10 м высоты. Проверяется давление внизу ствола
            при закрытых кранах; допустимое — {fmt(maxPressure)} МПа (норма «P макс» выше). Бак разрыва
            струи сбрасывает давление до атмосферного, поэтому шаг каскада — не более {Math.floor(result.stepM)} м
            высоты. Значок «Бак разрыва струи» — в условных обозначениях, группа «Водопровод».
          </div>
          {ok ? null : (
            <div className="overflow-auto" style={{ maxHeight: 180 }}>
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0" style={{ background: "var(--c-s3, #f6f8fc)" }}>
                  <tr className="text-gray-500">
                    <th className="text-left font-semibold px-2 py-1">Ствол (сверху вниз)</th>
                    <th className="text-right font-semibold px-2 py-1">Перепад, м</th>
                    <th className="text-right font-semibold px-2 py-1" title="Давление вверху и внизу ветви при закрытых кранах">P верх / низ, МПа</th>
                    <th className="text-right font-semibold px-2 py-1">Баков нужно</th>
                    <th className="text-left font-semibold px-2 py-1">Что сделать</th>
                  </tr>
                </thead>
                <tbody>
                  {result.issues.map((it) => (
                    <tr key={it.branchId} className="border-t border-gray-100 hover:bg-blue-50"
                      style={{ cursor: onHighlightBranch ? "pointer" : "default" }}
                      onClick={() => onHighlightBranch?.(it.branchId)}>
                      <td className="px-2 py-1 font-medium">
                        {it.title}
                        {(it.hasTank || it.hasReducer) && (
                          <div className="text-[10px] text-gray-500 font-normal">
                            {[it.hasTank && "есть бак", it.hasReducer && "есть редуктор"].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">{it.drop}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        {fmt(it.pTop)} / <b style={{ color: "var(--c-red, #dc2626)" }}>{fmt(it.pBottom)}</b>
                      </td>
                      <td className="px-2 py-1 text-right font-semibold">{it.tanksNeeded}</td>
                      <td className="px-2 py-1 text-gray-600">{it.recommendation}</td>
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
