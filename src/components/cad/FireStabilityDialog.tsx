import { useState, useMemo, useEffect, useRef } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { Position } from "@/lib/positions";
import { calcFireStability, type StabilityCategory, type FireStabilityFact } from "@/lib/fireStability";
import {
  stabilityInputsKey, getStabilitySettings, setStabilitySettings,
  saveStabilityFacts, clearStabilityFacts, getValidStabilityFacts,
} from "@/lib/stabilitySession";
import { exportStabilityAct } from "@/lib/stabilityActExport";
import { loadActTitle, saveActTitle, loadLogoDataUrl, type ActTitleFields } from "@/lib/stabilityActTitle";

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  positions?: Position[];
  projectName?: string;
  solved: boolean;   // выполнен ли расчёт сети
  // Реальный итеративный расчёт опрокидывания (как в аварийном режиме).
  // Возвращает Map<branchId, reversed> по ветвям с пожарной нагрузкой.
  computeReversalFacts?: (
    ambientTemp: number,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<Map<string, FireStabilityFact>>;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<StabilityCategory, string> = {
  "descending-incline":  "Наклонные · нисходящее проветривание",
  "descending-vertical": "Вертикальные · нисходящее проветривание",
  "ascending-incline":   "Наклонные · восходящее проветривание",
  "ascending-vertical":  "Вертикальные · восходящее проветривание",
};

const CATEGORY_ORDER: StabilityCategory[] = [
  "descending-incline", "descending-vertical", "ascending-incline", "ascending-vertical",
];

export default function FireStabilityDialog({
  branches, nodes, positions = [], projectName = "Подземный рудник", solved,
  computeReversalFacts, onClose,
}: Props) {
  // Условия отбора общие с «Отчётом ВДС» (stabilitySession): оба документа
  // должны отбирать одни и те же выработки.
  const init = getStabilitySettings();
  const [angleFilter, setAngleFilter]   = useState(String(init.angleFilter));
  const [lengthFilter, setLengthFilter] = useState(String(init.lengthFilter));
  const [ambientTemp, setAmbientTemp]   = useState(String(init.ambientTemp));
  // Факты опрокидывания из реального расчёта сети (null = ещё не считали).
  // Если расчёт уже делали для этой же схемы — подхватываем его.
  const [reversalFacts, setReversalFacts] = useState<Map<string, FireStabilityFact> | null>(
    () => getValidStabilityFacts(branches, nodes, init.ambientTemp));
  const [computing, setComputing] = useState(false);
  // Прогресс проверки: сколько ветвей проверено из скольких
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Отпечаток данных, по которым посчитан факт. Факт показывается и уходит в акт
  // ТОЛЬКО пока отпечаток совпадает с текущими данными схемы.
  const inputsKey = useMemo(() => stabilityInputsKey(branches, nodes), [branches, nodes]);
  const [factsKey, setFactsKey] = useState<string | null>(() => (reversalFacts ? inputsKey : null));

  // Условия отбора сохраняем — их же применит «Отчёт ВДС».
  useEffect(() => {
    const num = (v: string, d: number) => { const x = parseFloat(v.replace(",", ".")); return Number.isFinite(x) ? x : d; };
    setStabilitySettings({
      angleFilter: num(angleFilter, 0),
      lengthFilter: num(lengthFilter, 0),
      ambientTemp: num(ambientTemp, 20),
    });
  }, [angleFilter, lengthFilter, ambientTemp]);
  const [factsStale, setFactsStale] = useState(false);
  // Реквизиты титульного листа акта
  const [title, setTitle] = useState<ActTitleFields>(() => loadActTitle());
  const [titleOpen, setTitleOpen] = useState(false);
  useEffect(() => { saveActTitle(title); }, [title]);
  const setT = <K extends keyof ActTitleFields>(k: K, v: ActTitleFields[K]) => setTitle(t => ({ ...t, [k]: v }));

  const result = useMemo(() => {
    const angle  = parseFloat(angleFilter.replace(",", ".")) || 0;
    const length = parseFloat(lengthFilter.replace(",", ".")) || 0;
    const amb    = parseFloat(ambientTemp.replace(",", ".")) || 20;
    return calcFireStability(branches, nodes, {
      angleFilter: angle,
      lengthFilter: length,
      ambientTemp: amb,
      positions: positions.map(p => ({ branchIds: p.branchIds, number: p.number, name: p.name })),
      reversalFacts: reversalFacts ?? undefined,
    });
  }, [branches, nodes, positions, angleFilter, lengthFilter, ambientTemp, reversalFacts]);

  const total = result.rows.length;
  const failedCount = result.totalFactFailed;

  async function handleComputeFacts() {
    if (!computeReversalFacts) return;
    setComputing(true);
    // Стартовое значение >0, чтобы шкала сразу показывала активность во время
    // первого (самого долгого) пересчёта сети, а не висела на 0%.
    setProgress({ done: 0, total: Math.max(1, total) });
    try {
      const amb = parseFloat(ambientTemp.replace(",", ".")) || 20;
      const keyAtStart = inputsKey;
      const facts = await computeReversalFacts(amb, (done, tot) =>
        setProgress(prev => ({ done: Math.max(prev?.done ?? 0, done), total: tot })));
      setReversalFacts(facts);
      setFactsKey(keyAtStart);
      saveStabilityFacts(facts, keyAtStart, amb);
      setFactsStale(false);
    } finally {
      setComputing(false);
    }
  }

  // Факт-расчёт запускается ТОЛЬКО вручную по кнопке — пользователь сначала
  // настраивает условия отбора (угол, длина, температура), затем считает.
  // При изменении температуры воздуха ранее посчитанный факт устаревает
  // (от неё зависит расход и депрессия), поэтому сбрасываем его.
  const firstRender = useRef(true);
  useEffect(() => {
    // На открытии окна не сбрасываем — там мог быть подхвачен прежний расчёт.
    if (firstRender.current) { firstRender.current = false; return; }
    setReversalFacts(null);
    setFactsKey(null);
    setProgress(null);
    clearStabilityFacts();
  }, [ambientTemp]);

  // Схема изменилась после расчёта (пересчёт сети, правка нагрузки, отметок,
  // сопротивлений) — факт устарел. Сбрасываем его и показываем предупреждение,
  // иначе в акт ушли бы цифры от прежнего состояния схемы.
  useEffect(() => {
    if (factsKey != null && factsKey !== inputsKey) {
      setReversalFacts(null);
      setFactsKey(null);
      setProgress(null);
      setFactsStale(true);
      clearStabilityFacts();
    }
  }, [inputsKey, factsKey]);

  async function handleExport() {
    try {
      const logoDataUrl = title.useLogo ? await loadLogoDataUrl() : undefined;
      await exportStabilityAct(result, {
        projectName: title.objectTitle || projectName,
        objectTitle: title.objectTitle || projectName,
        orgName: title.orgName,
        approverTitle: title.approverTitle,
        approverOrg: title.approverOrg,
        approverName: title.approverName,
        approveYear: title.approveYear,
        period: title.period,
        checkPeriod: title.checkPeriod || undefined,
        chairman: title.chairmanTitle || title.chairmanName ? { title: title.chairmanTitle, name: title.chairmanName } : undefined,
        members: title.members.filter(m => m.title || m.name),
        logoDataUrl,
      });
      onClose();
    } catch (e) {
      console.error("Ошибка выгрузки акта устойчивости", e);
      alert("Не удалось сформировать акт устойчивости. Подробности — в консоли.");
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-16"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 560, maxHeight: "82vh", border: "1px solid #b0b8cc" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "var(--c-tint-blue, #e8edf5)", borderBottom: "1px solid #c0cad8" }}>
          <span className="text-[13px] font-semibold text-gray-800">
            Устойчивость вентиляционных режимов при пожаре
          </span>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5">
            <Icon name="X" size={15} className="text-gray-600" />
          </button>
        </div>

        {!solved && (
          <div className="px-4 py-2 text-[11px] flex items-center gap-2"
            style={{ background: "var(--c-tint-amber, #fff4e5)", borderBottom: "1px solid #f0d9b5", color: "var(--c-amber, #8a5a00)" }}>
            <Icon name="TriangleAlert" size={14} />
            Сначала выполните «Расчёт сети» — иначе расходы и депрессии будут нулевыми.
          </div>
        )}

        {/* Параметры отбора */}
        <div className="px-4 pt-3 pb-2 space-y-2" style={{ borderBottom: "1px solid #e0e4ee" }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Условия отбора ветвей</div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 flex-1">Угол наклона не менее, град</span>
            <input value={angleFilter} onChange={e => setAngleFilter(e.target.value)}
              className="text-[12px] border border-gray-300 rounded px-2 py-1 w-24 text-right" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 flex-1">Длина выработки не менее, м</span>
            <input value={lengthFilter} onChange={e => setLengthFilter(e.target.value)}
              className="text-[12px] border border-gray-300 rounded px-2 py-1 w-24 text-right" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 flex-1">Температура воздуха, °C</span>
            <input value={ambientTemp} onChange={e => setAmbientTemp(e.target.value)}
              className="text-[12px] border border-gray-300 rounded px-2 py-1 w-24 text-right" />
          </div>
          <div className="text-[10px] text-gray-400 leading-snug pt-0.5">
            Отбираются ветви с заданной пожарной нагрузкой. Направление (нисходящее/восходящее)
            определяется по фактическому потоку воздуха после расчёта сети.
          </div>

          {/* Критерий устойчивости + расчёт факта опрокидывания */}
          {computeReversalFacts && (
            <div className="pt-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <button onClick={handleComputeFacts} disabled={computing || !solved}
                  className="text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5 disabled:opacity-50"
                  style={{ borderColor: "#c8d4e8", background: "#eef4ff", color: "var(--c-blue, #1d4ed8)" }}>
                  <Icon name={computing ? "Loader" : "Play"} size={12}
                    className={computing ? "animate-spin" : ""} />
                  {computing ? "Проверка..." : "Рассчитать факт опрокидывания"}
                </button>
                <span className="text-[10px]" style={{ color: reversalFacts && !computing ? "var(--c-green, #15803d)" : "var(--c-t4, #9ca3af)" }}>
                  {computing
                    ? (progress && progress.total > 0
                        ? `Расчёт устойчивости… ${Math.round((progress.done / progress.total) * 100)}%`
                        : "Подготовка расчёта...")
                    : reversalFacts
                      ? (failedCount > 0
                          ? "Расчёт по факту выполнен частично"
                          : "✓ Устойчивость — по факту разворота потока (как при очаге пожара)")
                      : "Предварительная оценка риска"}
                </span>
              </div>

              {/* Схема изменилась после расчёта — прежний факт сброшен */}
              {factsStale && !computing && !reversalFacts && (
                <div className="text-[11px] flex items-start gap-1.5 px-2 py-1.5 rounded"
                  style={{ background: "var(--c-tint-amber, #fff4e5)", color: "var(--c-amber, #8a5a00)", border: "1px solid #f0d9b5" }}>
                  <Icon name="RefreshCw" size={12} className="shrink-0 mt-[1px]" />
                  <span>Схема изменилась после расчёта по факту — результат сброшен. Нажмите «Рассчитать факт опрокидывания» ещё раз.</span>
                </div>
              )}

              {/* Расчёт сети не выполнен для части ветвей */}
              {reversalFacts && !computing && failedCount > 0 && (
                <div className="text-[11px] flex items-start gap-1.5 px-2 py-1.5 rounded"
                  style={{ background: "var(--c-tint-red, #fef2f2)", color: "var(--c-red, #b91c1c)", border: "1px solid #fecaca" }}>
                  <Icon name="TriangleAlert" size={12} className="shrink-0 mt-[1px]" />
                  <span>
                    Для {failedCount} ветв. расчёт сети при пожаре не выполнен (нет ответа расчётного сервера).
                    Их устойчивость в акте — по нормативной оценке, с пометкой «(оценка)». Повторите расчёт.
                  </span>
                </div>
              )}

              {/* Прогресс-бар проверки выработок */}
              {computing && progress && progress.total > 0 && (() => {
                const pct = Math.round((progress.done / progress.total) * 100);
                // Минимальная видимая ширина 8% + пульсация, пока прогресс мал —
                // чтобы шкала всегда показывала активность (первый пересчёт долгий).
                const barW = Math.max(8, pct);
                return (
                  <div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#e3e8f2" }}>
                      <div className={`h-full rounded-full transition-all duration-300 ${pct < 100 ? "animate-pulse" : ""}`}
                        style={{ width: `${barW}%`, background: "var(--c-blue-bg, #2563eb)" }} />
                    </div>
                    <div className="text-[10px] text-gray-400 text-right pt-0.5">{pct}%</div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Реквизиты титульного листа */}
        <div className="px-4 py-2" style={{ borderBottom: "1px solid #e0e4ee" }}>
          <button onClick={() => setTitleOpen(o => !o)}
            className="w-full flex items-center justify-between text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            <span>Титульный лист акта</span>
            <Icon name={titleOpen ? "ChevronUp" : "ChevronDown"} size={14} />
          </button>
          {titleOpen && (
            <div className="pt-2 space-y-1.5">
              {([
                ["approverTitle", "Утверждает: должность"],
                ["approverOrg", "Утверждает: организация"],
                ["approverName", "Утверждает: ФИО"],
                ["approveYear", "Год утверждения"],
                ["objectTitle", "Объект (в «»)"],
                ["orgName", "Организация"],
                ["period", "Период ПМЛЛПА"],
                ["checkPeriod", "Период проверки"],
                ["chairmanTitle", "Председатель: должность"],
                ["chairmanName", "Председатель: ФИО"],
              ] as [keyof ActTitleFields, string][]).map(([k, label]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-600 w-40 shrink-0">{label}</span>
                  <input value={title[k] as string} onChange={e => setT(k, e.target.value as never)}
                    className="text-[11px] border border-gray-300 rounded px-2 py-0.5 flex-1 min-w-0" />
                </div>
              ))}
              <div className="text-[11px] text-gray-600 pt-1">Члены комиссии:</div>
              {title.members.map((m, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input value={m.title} placeholder="Должность"
                    onChange={e => setT("members", title.members.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                    className="text-[11px] border border-gray-300 rounded px-2 py-0.5 flex-1 min-w-0" />
                  <input value={m.name} placeholder="ФИО"
                    onChange={e => setT("members", title.members.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    className="text-[11px] border border-gray-300 rounded px-2 py-0.5 w-28" />
                  <button onClick={() => setT("members", title.members.filter((_, j) => j !== i))}
                    className="p-0.5 rounded hover:bg-gray-100 text-gray-400"><Icon name="X" size={12} /></button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button onClick={() => setT("members", [...title.members, { title: "", name: "" }])}
                  className="text-[11px] text-blue-700 hover:underline">+ Добавить члена комиссии</button>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                  <input type="checkbox" checked={title.useLogo} onChange={e => setT("useLogo", e.target.checked)} />
                  Логотип «Башмедь»
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Сводка по категориям */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {CATEGORY_ORDER.map(cat => {
            const rows = result.byCategory[cat];
            const unstable = rows.filter(r => !r.stable).length;
            return (
              <div key={cat} className="border border-gray-200 rounded overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5"
                  style={{ background: "var(--c-s3, #f6f8fc)" }}>
                  <span className="text-[12px] font-medium text-gray-700">{CATEGORY_LABELS[cat]}</span>
                  <span className="text-[11px] text-gray-500">{rows.length} ветв.</span>
                </div>
                {rows.length > 0 && (
                  <div className="px-3 py-1.5 text-[11px] flex items-center gap-4">
                    <span className="text-green-700">Устойчиво: {rows.length - unstable}</span>
                    {unstable > 0
                      ? <span className="text-red-600 font-semibold">Неустойчиво: {unstable}</span>
                      : <span className="text-gray-400">Неустойчиво: 0</span>}
                    {(() => {
                      const isDescending = cat === "descending-incline" || cat === "descending-vertical";
                      // ЗАПАС ДО ОПРОКИДЫВАНИЯ — только для НИСХОДЯЩИХ выработок:
                      // опрокинуться может лишь нисходящая струя. У восходящих
                      // тепловая депрессия действует по потоку и разгоняет его.
                      if (isDescending) {
                        const margins = rows
                          .map(r => r.marginDep_Pa)
                          .filter((m): m is number => m != null);
                        if (margins.length === 0) return null;
                        const min = Math.min(...margins);
                        return (
                          <span
                            className={min < 0 ? "text-red-600" : "text-gray-500"}
                            title="Наименьший запас до опрокидывания в этой группе (h_кр − h_т). Отрицательное значение — критическая депрессия уже превышена.">
                            Мин. запас: {min.toFixed(1)} Па
                          </span>
                        );
                      }
                      // ВОСХОДЯЩИЕ: сама струя устойчива. Показываем, у скольких
                      // выработок тяга пожара создаёт риск опрокидывания струи
                      // в ПАРАЛЛЕЛЬНОЙ выработке (Прил. 7, условие 7.1).
                      const risk = rows.filter(r => r.exceedsCritical).length;
                      if (risk === 0) return null;
                      return (
                        <span className="text-amber-600"
                          title="Струя в самой восходящей выработке устойчива (тепловая депрессия разгоняет поток). Но по условию 7.1 Прил. 7 тяга пожара может опрокинуть струю в параллельной выработке — требуется проверка.">
                          Риск для параллельных: {risk}
                        </span>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}

          {total === 0 && (
            <div className="text-[12px] text-gray-500 text-center py-4">
              Нет ветвей, удовлетворяющих условиям отбора.
              Проверьте, что задана пожарная нагрузка и выполнен расчёт сети.
            </div>
          )}
        </div>

        {/* Итог + действия */}
        <div className="px-4 py-2.5 flex items-center justify-between"
          style={{ background: "var(--c-s3, #f2f5fb)", borderTop: "1px solid #d8e0ee" }}>
          <div className="text-[11px] text-gray-600">
            Всего в акте: <b>{total}</b> ветв.
            {result.totalUnstable > 0 && (
              <span className="text-red-600 font-semibold ml-2">
                Неустойчивых: {result.totalUnstable}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="text-[12px] px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100">
              Отмена
            </button>
            <button onClick={handleExport} disabled={total === 0}
              className="text-[12px] px-3 py-1.5 rounded text-white flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "var(--c-blue-bg, #2563eb)" }}>
              <Icon name="FileSpreadsheet" size={14} />
              Сформировать акт (Excel)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}