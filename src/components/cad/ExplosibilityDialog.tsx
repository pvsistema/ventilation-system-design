// ─────────────────────────────────────────────────────────────────────────────
// ExplosibilityDialog — окно «Взрывоопасность рудничной атмосферы».
// Прямая реализация Приложения № 11 к ФНП, утв. приказом Ростехнадзора
// от 11.12.2020 № 520: формулы (1)–(5), треугольники взрываемости рис. 1–6.
//
// Рабочий цикл на командном пункте: инженер вводит состав пробы из газового
// анализа → программа считает C_г и доли P, выбирает рисунок, наносит точку →
// вывод о состоянии атмосферы → протокол расчёта в Excel.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import TrianglePlot from "@/components/cad/explosibility/TrianglePlot";
import {
  calcExplosibility, stateLabel, stateColor, ru,
  SAMPLE_PRESETS,
  type GasSample, type ExplosibilityResult,
} from "@/lib/explosibility";
import { exportExplosibilityReport } from "@/lib/explosibilityReport";

interface Props {
  projectName?: string;
  onClose: () => void;
}

/** Строка журнала проб текущего сеанса. */
interface JournalRow {
  id: string;
  sample: GasSample;
}

const num = (s: string): number => {
  const v = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

export default function ExplosibilityDialog({ projectName = "Подземный рудник", onClose }: Props) {
  // Поля пробы храним строками — иначе при вводе «0,» поле схлопывается в 0
  const [ch4, setCh4] = useState("1,2");
  const [co,  setCo]  = useState("0,8");
  const [h2,  setH2]  = useState("0,3");
  const [o2,  setO2]  = useState("12,5");
  const [co2, setCo2] = useState("6,0");
  const [no, setNo]         = useState("");
  const [place, setPlace]   = useState("");
  const [takenAt, setTakenAt] = useState("");

  // Журнал проб сеанса — попадает в сводный лист протокола
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [showSteps, setShowSteps] = useState(true);

  const sample: GasSample = useMemo(() => ({
    ch4: num(ch4), co: num(co), h2: num(h2), o2: num(o2), co2: num(co2),
    no, place, takenAt,
  }), [ch4, co, h2, o2, co2, no, place, takenAt]);

  const result = useMemo(() => calcExplosibility(sample), [sample]);
  const journalResults: ExplosibilityResult[] = useMemo(
    () => journal.map(j => calcExplosibility(j.sample)),
    [journal],
  );

  const c = stateColor(result.state);

  function applyPreset(s: GasSample) {
    setCh4(ru(s.ch4)); setCo(ru(s.co)); setH2(ru(s.h2));
    setO2(ru(s.o2)); setCo2(ru(s.co2 ?? 0));
  }

  function addToJournal() {
    setJournal(j => [...j, { id: `${Date.now()}`, sample: { ...sample, no: sample.no || `${j.length + 1}` } }]);
  }

  function handleExport() {
    const all = journalResults.length ? [...journalResults, result] : [result];
    exportExplosibilityReport(result, all, { projectName });
  }

  const field = (
    label: string, value: string, set: (v: string) => void, hint?: string,
  ) => (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] text-gray-500" title={hint}>{label}</label>
      <input value={value} onChange={e => set(e.target.value)}
        className="text-[12px] border border-gray-300 rounded px-2 py-1 w-[84px] text-right" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-10"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 1120, maxHeight: "90vh", border: "1px solid #b0b8cc" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "var(--c-tint-blue, #e8edf5)", borderBottom: "1px solid #c0cad8" }}>
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-gray-800">
              Взрывоопасность рудничной атмосферы
            </span>
            <span className="text-[10px] text-gray-500">
              Приложение № 11 к ФНП (приказ Ростехнадзора от 11.12.2020 № 520), формулы (1)–(5), рис. 1–6
            </span>
          </div>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5">
            <Icon name="X" size={15} className="text-gray-600" />
          </button>
        </div>

        {/* Вердикт */}
        <div className="px-4 py-2.5 flex items-center gap-3"
          style={{ background: c.bg, borderBottom: `1px solid ${c.border}`, borderLeft: `4px solid ${c.fg}` }}>
          <Icon name={result.state === "explosive" ? "TriangleAlert" : result.state === "explosive-on-dilution" ? "CircleAlert" : "CircleCheck"}
            size={20} style={{ color: c.fg }} />
          <div className="flex flex-col">
            <span className="text-[13px] font-bold" style={{ color: c.fg }}>
              {stateLabel(result.state)}
            </span>
            <span className="text-[11px] leading-snug" style={{ color: c.fg }}>
              {result.verdict}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="flex gap-4 p-4">

            {/* ── Левая колонка: ввод и ход расчёта ── */}
            <div className="flex flex-col gap-3" style={{ width: 500 }}>

              {/* Состав пробы */}
              <div className="rounded border border-gray-200">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700"
                  style={{ background: "var(--c-s3, #f6f8fc)", borderBottom: "1px solid #e0e4ee" }}>
                  Результаты газового анализа пробы, объёмные %
                </div>
                <div className="p-3 flex flex-wrap gap-3">
                  {field("CH₄, метан", ch4, setCh4, "Концентрация метана в рудничном воздухе")}
                  {field("CO, оксид углерода", co, setCo, "Концентрация оксида углерода")}
                  {field("H₂, водород", h2, setH2, "Концентрация водорода")}
                  {field("O₂, кислород", o2, setO2, "Концентрация кислорода — вторая координата точки")}
                  {field("CO₂ (справочно)", co2, setCo2, "В формулы (1)–(5) не входит, печатается в протоколе")}
                </div>
                <div className="px-3 pb-3 flex gap-3">
                  <div className="flex flex-col gap-0.5 flex-1">
                    <label className="text-[10px] text-gray-500">№ пробы</label>
                    <input value={no} onChange={e => setNo(e.target.value)}
                      className="text-[12px] border border-gray-300 rounded px-2 py-1" />
                  </div>
                  <div className="flex flex-col gap-0.5 flex-[2]">
                    <label className="text-[10px] text-gray-500">Место отбора</label>
                    <input value={place} onChange={e => setPlace(e.target.value)}
                      placeholder="за перемычкой № 3, вент. штрек"
                      className="text-[12px] border border-gray-300 rounded px-2 py-1" />
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1">
                    <label className="text-[10px] text-gray-500">Дата и время</label>
                    <input value={takenAt} onChange={e => setTakenAt(e.target.value)}
                      placeholder="14.03, 08:40"
                      className="text-[12px] border border-gray-300 rounded px-2 py-1" />
                  </div>
                </div>
                <div className="px-3 pb-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 mr-1">Типовые пробы:</span>
                  {SAMPLE_PRESETS.map(p => (
                    <button key={p.name} onClick={() => applyPreset(p.sample)}
                      className="text-[10.5px] px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-600">
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ход расчёта */}
              <div className="rounded border border-gray-200">
                <button onClick={() => setShowSteps(v => !v)}
                  className="w-full px-3 py-1.5 text-[11px] font-semibold text-gray-700 flex items-center justify-between"
                  style={{ background: "var(--c-s3, #f6f8fc)", borderBottom: showSteps ? "1px solid #e0e4ee" : "none" }}>
                  <span>Ход расчёта по формулам приложения</span>
                  <Icon name={showSteps ? "ChevronUp" : "ChevronDown"} size={13} />
                </button>
                {showSteps && (
                  <table className="w-full text-[11px]">
                    <tbody>
                      {/* Подстановка чисел печатается отдельной строкой во всю
                          ширину: в узкой колонке формула ломалась на четыре
                          части и читать её было невозможно. */}
                      {result.steps.map((st, i) => (
                        <tr key={i} style={{ background: i % 2 ? "#fafbfe" : "#fff" }}>
                          <td className="px-2 py-1.5 align-top text-gray-400" style={{ width: 42 }}>
                            {st.formula ?? ""}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="text-gray-700 font-medium">{st.title}</span>
                              <span className="text-gray-800 font-semibold text-right shrink-0">{st.value}</span>
                            </div>
                            <div className="text-gray-500 font-mono text-[10.5px] leading-snug mt-0.5">
                              {st.expression}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Предупреждения */}
              {result.warnings.map((w, i) => (
                <div key={i} className="px-3 py-2 text-[11px] flex items-start gap-2 rounded"
                  style={{ background: "var(--c-tint-amber, #fff4e5)", border: "1px solid #f0d9b5", color: "var(--c-amber, #8a5a00)" }}>
                  <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>

            {/* ── Правая колонка: треугольник и показатели ── */}
            <div className="flex flex-col gap-3 flex-1">
              <div className="rounded border border-gray-200 overflow-hidden">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700"
                  style={{ background: "var(--c-s3, #f6f8fc)", borderBottom: "1px solid #e0e4ee" }}>
                  Треугольник взрываемости — рис. {result.figureNo} приложения
                </div>
                <TrianglePlot result={result} width={560} height={400} />
              </div>

              {/* Ключевые показатели */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "C_г, %",        value: ru(result.cg),       hint: "Общее содержание горючих газов, формула (1)" },
                  { label: "P_CO",          value: ru(result.pCO, 3),   hint: "Доля оксида углерода, формула (2) — выбор рисунка" },
                  { label: "P_CH₄",         value: ru(result.pCH4, 3),  hint: "Доля метана, формула (3) — выбор треугольника" },
                  { label: "P_H₂",          value: ru(result.pH2, 3),   hint: "Доля водорода, формула (4)" },
                  { label: "НПВ смеси, %",  value: Number.isFinite(result.triangle.lel) ? ru(result.triangle.lel) : "—", hint: "Нижний предел взрываемости смеси" },
                  { label: "ВПВ смеси, %",  value: Number.isFinite(result.triangle.uel) ? ru(result.triangle.uel) : "—", hint: "Верхний предел взрываемости смеси" },
                  { label: "O₂ предельн., %", value: ru(result.triangle.nose.y), hint: "Предельное содержание кислорода — «нос» треугольника" },
                  { label: "Σ P (усл. 5)",  value: ru(result.pSum, 3),  hint: "Контроль по формуле (5): сумма долей равна единице" },
                ].map(k => (
                  <div key={k.label} title={k.hint}
                    className="rounded border border-gray-200 px-2 py-1.5 flex flex-col">
                    <span className="text-[9.5px] text-gray-500">{k.label}</span>
                    <span className="text-[13px] font-semibold text-gray-800">{k.value}</span>
                  </div>
                ))}
              </div>

              {/* Журнал проб сеанса */}
              {journal.length > 0 && (
                <div className="rounded border border-gray-200">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700 flex items-center justify-between"
                    style={{ background: "var(--c-s3, #f6f8fc)", borderBottom: "1px solid #e0e4ee" }}>
                    <span>Пробы сеанса — попадут в сводный лист протокола</span>
                    <button onClick={() => setJournal([])}
                      className="text-[10px] text-gray-500 hover:text-red-600">очистить</button>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-gray-500" style={{ background: "#fbfcfe" }}>
                        <th className="px-2 py-1 text-left font-medium">№</th>
                        <th className="px-2 py-1 text-left font-medium">Место</th>
                        <th className="px-2 py-1 text-right font-medium">C_г</th>
                        <th className="px-2 py-1 text-right font-medium">O₂</th>
                        <th className="px-2 py-1 text-left font-medium">Состояние</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journalResults.map((jr, i) => {
                        const jc = stateColor(jr.state);
                        return (
                          <tr key={journal[i].id} style={{ background: i % 2 ? "#fafbfe" : "#fff" }}>
                            <td className="px-2 py-1">{jr.sample.no}</td>
                            <td className="px-2 py-1 text-gray-600">{jr.sample.place || "—"}</td>
                            <td className="px-2 py-1 text-right">{ru(jr.cg)}</td>
                            <td className="px-2 py-1 text-right">{ru(jr.sample.o2)}</td>
                            <td className="px-2 py-1 font-medium" style={{ color: jc.fg }}>{stateLabel(jr.state)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Нижняя панель */}
        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "var(--c-s3, #f6f8fc)", borderTop: "1px solid #e0e4ee" }}>
          <span className="text-[10px] text-gray-500">
            Пределы взрываемости смеси рассчитаны по долям P формул (2)–(4); рисунок приложения выбран
            по P_CO, треугольник — по P_CH₄.
          </span>
          <div className="flex items-center gap-2">
            <button onClick={addToJournal}
              className="text-[12px] px-3 py-1.5 rounded border border-gray-300 hover:bg-white text-gray-700 flex items-center gap-1.5">
              <Icon name="Plus" size={13} />
              Добавить пробу в журнал
            </button>
            <button onClick={handleExport}
              className="text-[12px] px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5">
              <Icon name="FileSpreadsheet" size={13} />
              Протокол расчёта
            </button>
            <button onClick={onClose}
              className="text-[12px] px-3 py-1.5 rounded border border-gray-300 hover:bg-white text-gray-700">
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}