// ─────────────────────────────────────────────────────────────────────────────
// VdsDialog — «ВДС» (воздушно-депрессионная съёмка).
// Пока содержит один расчёт: эквивалентное отверстие шахты в зависимости от
// количества ГВУ (главных вентиляторных установок) — формулы (24) и (25).
//
//   Для одного ГВУ (24):   A_ш = 0.38 * Q / sqrt(H)
//   Для нескольких ГВУ (25):
//                          A_общ = 0.38 * Σ Q_i / sqrt( Σ (h_i * Q_i) / Σ Q_i )
//
//   Q — подача воздуха ГВУ, м³/с;  H (h) — депрессия ГВУ, даПа (= мм вод. ст.).
//   Коэффициент 0.38 в формуле рассчитан на депрессию в даПа/мм вод.ст.
//   Давление вентилятора в схеме хранится в Па, поэтому при автоподстановке
//   переводим Па → даПа делением на 10.
//
// Список ГВУ синхронизирован со схемой: в строке можно выбрать вентилятор,
// установленный в открытой схеме, и Q с депрессией подставятся автоматически
// из результата расчёта сети.
//
// Диалог спроектирован как контейнер с секциями расчётов — позже сюда можно
// добавлять другие расчёты по схеме (каждый в свой блок).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { BranchBulkheadInfo } from "@/lib/branchBulkheadInfo";
import VdsReportPanel from "@/components/cad/vds/VdsReportPanel";
import VdsChannelSection from "@/components/cad/vds/VdsChannelSection";
import { useDraggableWindow } from "@/hooks/useDraggableWindow";
import { C, INP, INP_STYLE, Info, Kpi, Row } from "@/components/cad/vds/vdsUi";

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  solved: boolean; // выполнен ли расчёт сети (тогда flow/fanPressure заполнены)
  onClose: () => void;
  /** Вентсооружения по ветвям — для раздела «Отчёт ВДС» */
  bulkheads?: Map<string, BranchBulkheadInfo>;
  projectName?: string;
  /** Состояние лицензии (ключ нужен для проверки кода доступа к отчёту) */
  license?: { status?: string; info?: { key?: string; licensed?: boolean } | null; fingerprint?: string } | null;
  /** Ветви с полной депрессией (dPTotal/rTotal) — для раздела устойчивости. */
  stabilityBranches?: TopoBranch[];
  /** Подсветить ветви на схеме (маршрут вентканала); [] — снять подсветку. */
  onHighlightBranches?: (ids: string[]) => void;
  /** Вкладка, открытая при показе окна. */
  initialTab?: "opening" | "channel" | "report";
  /** Перехват клика по ветви на схеме (ручной выбор ветвей вентканала). */
  branchPickRef?: MutableRefObject<((branchId: string) => void) | null>;
}

interface GvuRow {
  id: number;
  branchId: string; // "" = ручной ввод, иначе id ветви-вентилятора со схемы
  name: string;
  q: string; // подача воздуха, м³/с
  h: string; // депрессия, даПа (= мм вод. ст.)
}

let nextId = 1;
function newRow(name = ""): GvuRow {
  return { id: nextId++, branchId: "", name, q: "", h: "" };
}

function num(s: string): number {
  const v = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function classify(a: number): { label: string; color: string } {
  if (a <= 0) return { label: "—", color: "var(--c-t3, #6b7280)" };
  if (a < 1) return { label: "Труднопроветриваемая", color: "var(--c-red, #dc2626)" };
  if (a <= 2) return { label: "Средней трудности проветривания", color: "var(--c-amber, #d97706)" };
  return { label: "Легкопроветриваемая", color: "var(--c-green, #16a34a)" };
}

export default function VdsDialog({ branches, nodes, solved, onClose, bulkheads, projectName = "", license, stabilityBranches, onHighlightBranches, initialTab = "opening", branchPickRef }: Props) {
  const [tab, setTab] = useState<"opening" | "channel" | "report">(initialTab);
  // Окно перетаскивается за шапку, положение запоминается между открытиями.
  // Ограничение по краю экрана считаем по большей ширине (вкладка «Отчёт ВДС»).
  const winWidth = tab === "report" ? 920 : tab === "channel" ? 780 : 640;
  const { pos, dragHandleProps } = useDraggableWindow({ width: 920, height: 700, storageKey: "pvs_vds_dialog_pos" });
  // Вентиляторы (ГВУ/ВВУ), установленные в открытой схеме. ГВУ идут первыми.
  const fanBranches = useMemo(
    () =>
      branches
        .filter(b => b.hasFan && !b.fanStopped)
        .sort((a, b) => (a.fanType === "ГВУ" ? -1 : 1) - (b.fanType === "ГВУ" ? -1 : 1)),
    [branches],
  );

  function fanLabel(b: TopoBranch): string {
    const from = nodes.find(n => n.id === b.fromId);
    const to = nodes.find(n => n.id === b.toId);
    const seg = from && to ? ` (${from.number ?? "?"}→${to.number ?? "?"})` : "";
    const nm = b.fanName ? b.fanName : `ветвь ${b.id}`;
    return `${b.fanType} · ${nm}${seg}`;
  }

  const [rows, setRows] = useState<GvuRow[]>(() => [newRow("ГВУ-1")]);

  function updateRow(id: number, patch: Partial<GvuRow>) {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows(rs => [...rs, newRow(`ГВУ-${rs.length + 1}`)]);
  }
  function removeRow(id: number) {
    setRows(rs => (rs.length > 1 ? rs.filter(r => r.id !== id) : rs));
  }

  // Выбор вентилятора из схемы: подставляем Q (flow) и депрессию.
  // Давление вентилятора в схеме — в Па, а расчёт требует даПа → делим на 10.
  function pickFan(rowId: number, branchId: string) {
    if (!branchId) {
      updateRow(rowId, { branchId: "" });
      return;
    }
    const b = fanBranches.find(x => x.id === branchId);
    if (!b) return;
    const q = Math.abs(b.flow ?? 0);
    const hDaPa = Math.abs(b.fanPressure ?? 0) / 10;
    updateRow(rowId, {
      branchId,
      name: b.fanName || fanLabel(b),
      q: q ? q.toFixed(2) : "",
      h: hDaPa ? hDaPa.toFixed(2) : "",
    });
  }

  const calc = useMemo(() => {
    // Учитываем только строки с положительными Q и H. Депрессия — в даПа (мм вод. ст.).
    const valid = rows
      .map(r => ({ q: num(r.q), h: num(r.h) }))
      .filter(r => r.q > 0 && r.h > 0);

    const sumQ = valid.reduce((s, r) => s + r.q, 0);
    const sumHQ = valid.reduce((s, r) => s + r.h * r.q, 0);

    let A = 0;
    let HavgDaPa = 0; // эквивалентная депрессия шахты, даПа
    if (valid.length === 1) {
      // формула (24): A = 0.38 * Q / sqrt(H), H в даПа
      A = (0.38 * valid[0].q) / Math.sqrt(valid[0].h);
      HavgDaPa = valid[0].h;
    } else if (valid.length > 1 && sumQ > 0) {
      // формула (25)
      HavgDaPa = sumHQ / sumQ;
      A = (0.38 * sumQ) / Math.sqrt(HavgDaPa);
    }
    return {
      count: valid.length,
      sumQ,
      HavgDaPa,
      A,
      formula: valid.length <= 1 ? "(24)" : "(25)",
    };
  }, [rows]);

  const cls = classify(calc.A);

  return (
    <div
      className="fixed inset-0 z-[200] pointer-events-none"
    >
      <div
        className="rounded-xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
        onKeyDown={e => { if (e.key === "Escape") onClose(); }}
        style={{
          position: "fixed",
          left: Math.min(pos.x, Math.max(0, window.innerWidth - winWidth)),
          top: pos.y,
          width: winWidth, maxWidth: "96vw",
          maxHeight: `calc(100vh - ${pos.y + 12}px)`,
          background: C.s1,
          border: `1.5px solid ${C.b2}`,
        }}
      >
        {/* Шапка — за неё окно перетаскивается */}
        <div
          className="flex items-center gap-2.5 px-4 pt-3 pb-2 select-none"
          {...dragHandleProps}
          style={{ ...dragHandleProps.style }}
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: C.tintBlue, border: `1px solid ${C.tintBlue2}` }}>
            <Icon name="Gauge" size={17} style={{ color: C.accent }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold leading-tight" style={{ color: C.t1 }}>Воздушно-депрессионная съёмка</div>
            <div className="text-[11px]" style={{ color: C.t3 }}>
              {solved ? "по результатам расчёта сети" : "сеть не рассчитана — данные вентиляторов могут быть нулевыми"}
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-black/5" style={{ color: C.t4 }} title="Закрыть (Esc)">
            <Icon name="X" size={17} />
          </button>
        </div>

        {/* Вкладки — сегментный переключатель */}
        <div className="px-4 pb-2" style={{ borderBottom: `1px solid ${C.b1}` }}>
          <div className="inline-flex p-0.5 rounded-lg gap-0.5" style={{ background: C.s2, border: `1px solid ${C.b1}` }}>
            {([
              ["opening", "Эквивалентное отверстие", "Gauge"],
              ["channel", "Вентканал ГВУ", "Fan"],
              ["report", "Отчёт ВДС", "FileLock2"],
            ] as const).map(([id, label, icon]) => {
              const on = tab === id;
              return (
                <button key={id} onClick={() => { setTab(id); if (id !== "channel") onHighlightBranches?.([]); }}
                  className="px-2.5 py-1 text-[12px] rounded-md flex items-center gap-1.5 transition-colors"
                  style={on
                    ? { background: C.s1, color: C.accent, fontWeight: 600, boxShadow: "0 1px 2px rgba(0,0,0,0.08)", border: `1px solid ${C.b1}` }
                    : { color: C.t3, border: "1px solid transparent" }}>
                  <Icon name={icon} size={13} />{label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-y-auto px-4 py-3" style={{ flex: 1, background: C.s2 }}>
          {tab === "report" ? (
            <VdsReportPanel
              branches={branches}
              nodes={nodes}
              solved={solved}
              bulkheads={bulkheads ?? new Map()}
              projectName={projectName}
              license={license}
              stabilityBranches={stabilityBranches}
            />
          ) : tab === "channel" ? (
            <VdsChannelSection fans={fanBranches} label={fanLabel} branches={branches} nodes={nodes} onHighlight={onHighlightBranches} bulkheads={bulkheads} solved={solved} branchPickRef={branchPickRef} />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: C.t2 }}>
                <span className="font-semibold" style={{ color: C.t1 }}>Эквивалентное отверстие шахты</span>
                <span style={{ color: C.t4 }}>· ф. {calc.formula}</span>
                <Info text="Одна ГВУ — формула (24): A = 0,38·Q/√H. Несколько ГВУ — формула (25): A = 0,38·ΣQ/√(Σh·Q/ΣQ). Q — подача ГВУ, м³/с; H — депрессия, даПа (= мм вод. ст.). При выборе вентилятора из схемы Q и H подставляются из расчёта сети (Па → даПа)." />
              </div>

              <div className="grid gap-2" style={{ gridTemplateColumns: "minmax(0,1fr) 210px" }}>
                {/* Таблица ГВУ */}
                <div className="rounded-lg overflow-hidden" style={{ background: C.s1, border: `1px solid ${C.b1}` }}>
                  <table className="w-full text-[12px] border-collapse">
                    <thead>
                      <tr style={{ background: C.s2, color: C.t3 }}>
                        <th className="text-left font-medium px-2 py-1 w-6 text-[10.5px]">№</th>
                        <th className="text-left font-medium px-1 py-1 text-[10.5px]">ГВУ со схемы</th>
                        <th className="text-left font-medium px-1 py-1 w-[72px] text-[10.5px]">Q, м³/с</th>
                        <th className="text-left font-medium px-1 py-1 w-[72px] text-[10.5px]">H, даПа</th>
                        <th className="w-7"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.id} style={{ borderTop: `1px solid ${C.b1}` }}>
                          <td className="px-2 py-1 text-center text-[11px]" style={{ color: C.t4 }}>{i + 1}</td>
                          <td className="px-1 py-1">
                            {fanBranches.length > 0 ? (
                              <select className={INP} style={INP_STYLE} value={r.branchId} onChange={e => pickFan(r.id, e.target.value)}>
                                <option value="">— ручной ввод —</option>
                                {fanBranches.map(b => <option key={b.id} value={b.id}>{fanLabel(b)}</option>)}
                              </select>
                            ) : (
                              <input className={INP} style={INP_STYLE} value={r.name} placeholder={`ГВУ-${i + 1}`}
                                onChange={e => updateRow(r.id, { name: e.target.value })} />
                            )}
                          </td>
                          <td className="px-1 py-1">
                            <input className={INP + " text-right"} style={INP_STYLE} value={r.q} inputMode="decimal" placeholder="0"
                              onChange={e => updateRow(r.id, { q: e.target.value, branchId: "" })} />
                          </td>
                          <td className="px-1 py-1">
                            <input className={INP + " text-right"} style={INP_STYLE} value={r.h} inputMode="decimal" placeholder="0"
                              onChange={e => updateRow(r.id, { h: e.target.value, branchId: "" })} />
                          </td>
                          <td className="px-1 py-1 text-center">
                            <button onClick={() => removeRow(r.id)} disabled={rows.length <= 1}
                              className="rounded p-0.5 hover:bg-black/5 disabled:opacity-30" style={{ color: C.t4 }} title="Удалить ГВУ">
                              <Icon name="Trash2" size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={addRow} className="w-full flex items-center justify-center gap-1 py-1 text-[11.5px] hover:bg-black/[0.03]"
                    style={{ color: C.accent, borderTop: `1px solid ${C.b1}` }}>
                    <Icon name="Plus" size={13} /> Добавить ГВУ
                  </button>
                </div>

                {/* Результат */}
                <div className="flex flex-col gap-2">
                  <Kpi label="Эквивалентное отверстие A" value={calc.A ? calc.A.toFixed(3) : "—"} unit="м²"
                    tone={calc.A <= 0 ? "neutral" : calc.A < 1 ? "red" : calc.A <= 2 ? "amber" : "green"}
                    sub={<span style={{ color: cls.color, fontWeight: 600 }}>{cls.label}</span>} />
                  <div className="rounded-lg px-2.5 py-1" style={{ background: C.s1, border: `1px solid ${C.b1}` }}>
                    <Row k="Учтено ГВУ" v={calc.count} />
                    <Row k="ΣQ, м³/с" v={calc.sumQ ? calc.sumQ.toFixed(2) : "—"} />
                    <Row k="H экв., даПа" v={calc.HavgDaPa ? calc.HavgDaPa.toFixed(2) : "—"} />
                  </div>
                </div>
              </div>

              {/* Шкала категорий */}
              <div className="grid grid-cols-3 gap-1 text-[10.5px]">
                {[
                  ["до 1 м²", "трудная", C.red, calc.A > 0 && calc.A < 1],
                  ["1–2 м²", "средняя", C.amber, calc.A >= 1 && calc.A <= 2],
                  ["свыше 2 м²", "лёгкая", C.green, calc.A > 2],
                ].map(([r, t, c, on]) => (
                  <div key={String(r)} className="rounded-md px-2 py-1 flex items-center gap-1.5"
                    style={{ background: on ? C.s1 : "transparent", border: `1px solid ${on ? String(c) : C.b1}` }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: String(c) }} />
                    <span style={{ color: on ? C.t1 : C.t3, fontWeight: on ? 600 : 400 }}><b className="font-semibold">{String(r)}</b> {String(t)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-start gap-1 text-[10.5px] leading-snug" style={{ color: C.t4 }}>
                <Icon name="Info" size={11} className="mt-[1px] shrink-0" />
                Классификация применима только без активной аэродинамической связи выработок с выработанным пространством (зоной обрушения).
              </div>
            </div>
          )}
        </div>

        {/* Футер */}
        <div className="flex items-center justify-end gap-2 px-4 py-2" style={{ borderTop: `1px solid ${C.b1}` }}>
          <button onClick={onClose} className="px-3 py-1 text-[12px] rounded-md hover:brightness-95"
            style={{ background: C.s1, border: `1px solid ${C.b2}`, color: C.t2 }}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
