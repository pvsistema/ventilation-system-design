import Icon from "@/components/ui/icon";
import { msSortHistory, msMeasureFromCurrent, msFullHistory, type MsMeasure } from "@/lib/msHistory";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";

interface Props {
  sym: SchemaSymbol;
  /** Сечение выработки — если у станции своё не задано. */
  branchArea: number;
  onChange: (patch: Partial<SchemaSymbol>) => void;
}

/**
 * История замеров замерной станции: таблица по датам, изменение расхода
 * к предыдущему замеру и столбики динамики. Текущий замер можно записать
 * в историю; щелчок по строке делает её текущим замером станции.
 */
export default function MsHistoryBlock({ sym, branchArea, onChange }: Props) {
  const list = msSortHistory(sym.msHistory);
  const cur = msMeasureFromCurrent(sym, branchArea);
  const curInList = !!cur && list.some(m => m.date === cur.date && Math.abs(m.flow - cur.flow) < 0.01);
  const shown = msFullHistory(sym, branchArea);
  const maxQ = Math.max(1e-9, ...shown.map(m => m.flow));

  const save = (next: MsMeasure[]) => onChange({ msHistory: msSortHistory(next) });
  const remove = (m: MsMeasure) => save(list.filter(x => x !== m));
  const makeCurrent = (m: MsMeasure) =>
    onChange({ msFlow: m.flow, msVelocity: m.velocity, msArea: m.area, msDate: m.date });

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between pb-1 border-b border-gray-200 mb-1.5 mt-2">
        <span className="font-semibold text-[11px] text-gray-600 uppercase tracking-wide">История замеров</span>
        <span className="text-[10px] text-gray-400">{shown.length}</span>
      </div>

      {shown.length === 0 ? (
        <div className="text-[10px] text-gray-400 mb-1.5">Замеров пока нет — заполните расход или скорость выше.</div>
      ) : (
        <>
          {shown.length > 1 && (
            <div className="flex items-end gap-[3px] h-10 mb-1.5 px-0.5" title="Расход по датам замеров">
              {shown.map((m, i) => (
                <div key={i} className="flex-1 min-w-[4px] rounded-t-sm"
                  style={{ height: `${Math.max(6, (m.flow / maxQ) * 100)}%`, background: i === shown.length - 1 ? "var(--c-accent, #2563eb)" : "#93c5fd" }}
                  title={`${m.date}: ${m.flow.toFixed(2)} м³/с`} />
              ))}
            </div>
          )}
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left font-normal">Дата</th>
                <th className="text-right font-normal">v, м/с</th>
                <th className="text-right font-normal">S, м²</th>
                <th className="text-right font-normal">Q, м³/с</th>
                <th className="text-right font-normal">Δ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...shown].reverse().map((m, i, arr) => {
                const prev = arr[i + 1];
                const d = prev && prev.flow > 0 ? (m.flow - prev.flow) / prev.flow * 100 : null;
                const saved = list.includes(m);
                const isCur = !!cur && m.date === cur.date && Math.abs(m.flow - cur.flow) < 0.01;
                return (
                  <tr key={i} className={`cursor-pointer hover:bg-blue-50 ${isCur ? "font-semibold text-gray-800" : "text-gray-600"}`}
                    onClick={() => makeCurrent(m)} title="Сделать текущим замером станции">
                    <td className="py-0.5">{m.date}</td>
                    <td className="text-right">{m.velocity.toFixed(2)}</td>
                    <td className="text-right">{m.area.toFixed(2)}</td>
                    <td className="text-right">{m.flow.toFixed(2)}</td>
                    <td className={`text-right ${d == null ? "text-gray-300" : d >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {d == null ? "—" : `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`}
                    </td>
                    <td className="text-right w-4">
                      {saved && (
                        <button onClick={(e) => { e.stopPropagation(); remove(m); }}
                          className="text-gray-300 hover:text-red-500" title="Удалить замер из истории">
                          <Icon name="X" size={10} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {cur && !curInList && (
        <button onClick={() => save([...list, cur])}
          className="mt-1.5 w-full flex items-center justify-center gap-1 text-[10px] py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">
          <Icon name="Plus" size={10} />Записать текущий замер в историю
        </button>
      )}
    </div>
  );
}
