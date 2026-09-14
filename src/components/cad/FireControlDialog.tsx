// ─────────────────────────────────────────────────────────────────────────────
// FireControlDialog — подбор управляющих действий при пожаре.
//
// ЗАЧЕМ ОКНО, А НЕ ПРОСТО КНОПКА. Подбор — это десятки полных расчётов сети,
// то есть десятки секунд, а иногда и минуты. Без живой шкалы и кнопки отмены
// программа в это время выглядит зависшей, и человек её убивает — ровно тогда,
// когда до результата оставалось несколько вариантов.
//
// ЧЕСТНОСТЬ РЕЗУЛЬТАТА — главное здесь. Окно обязано одинаково внятно показать
// оба исхода: и найденный спасительный режим, и то, что вывести всех людей
// имеющимися рычагами НЕВОЗМОЖНО. Второе не менее ценно: это основание
// требовать пункт переключения или менять схему проветривания, и молчать
// о нём нельзя. Поэтому итог поиска (search.ts) всегда содержит число
// оставшихся в зоне риска, и оно выводится крупно.
//
// Считать здесь нечего: весь перебор и вся физика живут в lib/fireControl.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { searchFireControl, type SearchReport } from "@/lib/fireControl/search";
import type { EvaluateContext } from "@/lib/fireControl/evaluate";
import type { VariantResult } from "@/lib/fireControl/evaluate";
import type { FireAction } from "@/lib/fireControl/actions";

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  symbols: SchemaSymbol[];
  /** Контекст расчёта пожара — собирается в Cad.tsx. */
  buildContext: () => EvaluateContext;
  /** Выполнен ли расчёт сети: без него расходы нулевые. */
  solved: boolean;
  /** Есть ли на схеме очаг пожара. */
  hasFire: boolean;
  /** Внести действия варианта в проект. */
  onApply: (actions: FireAction[]) => void;
  /** Подсветить ветви с превышением скорости. */
  onHighlightBranches?: (ids: string[]) => void;
  onClose: () => void;
}

/** Ход поиска для шкалы. */
interface Progress {
  done: number;
  total: number;
  label: string;
}

export default function FireControlDialog({
  branches, nodes, symbols, buildContext, solved, hasFire,
  onApply, onHighlightBranches, onClose,
}: Props) {
  const [maxActions, setMaxActions] = useState(2);
  const [reach, setReach] = useState(4);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<SearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(0);

  // Флаг отмены живёт в ref, а не в state: поиск читает его синхронно между
  // расчётами, и перерисовка для этого не нужна.
  const cancelRef = useRef(false);
  // Окно закрыли во время поиска — не трогаем state размонтированного окна.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; cancelRef.current = true; }, []);

  async function handleSearch() {
    cancelRef.current = false;
    setSearching(true);
    setError(null);
    setReport(null);
    // Стартовое значение, чтобы шкала показывала активность уже во время
    // первого (самого долгого) расчёта, а не висела пустой.
    setProgress({ done: 0, total: 1, label: "Подготовка" });
    try {
      const result = await searchFireControl(
        buildContext(),
        { branches, nodes, symbols },
        {
          maxActions, reach,
          onProgress: (done, total, label) => {
            if (!aliveRef.current) return;
            // Шкала не едет назад: оценка объёма работы приблизительная,
            // и скачок стрелки влево читается как сбой программы.
            setProgress(prev => ({
              done: Math.max(prev?.done ?? 0, done),
              total, label,
            }));
          },
          isCancelled: () => cancelRef.current,
        },
      );
      if (!aliveRef.current) return;
      setReport(result);
      setExpanded(0);
    } catch (e) {
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) {
        setSearching(false);
        setProgress(null);
      }
    }
  }

  const pct = progress && progress.total > 0
    ? Math.min(99, Math.round((progress.done / progress.total) * 100))
    : 0;

  const canSearch = solved && hasFire && !searching;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-12"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => {
        // Во время поиска клик по фону не закрывает окно: расчёт идёт минуты,
        // и случайно потерять его обиднее, чем лишний раз нажать «Закрыть».
        if (e.target === e.currentTarget && !searching) onClose();
      }}>

      <div className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 760, maxHeight: "86vh", border: "1px solid #b0b8cc" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "var(--c-tint-blue, #e8edf5)", borderBottom: "1px solid #c0cad8" }}>
          <span className="text-[13px] font-semibold text-gray-800">
            Подбор режима проветривания при пожаре
          </span>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5" title="Закрыть">
            <Icon name="X" size={15} className="text-gray-600" />
          </button>
        </div>

        {/* Предупреждения о неготовности исходных данных */}
        {(!solved || !hasFire) && (
          <div className="px-4 py-2 text-[11px] flex items-start gap-2"
            style={{ background: "var(--c-tint-amber, #fff4e5)", borderBottom: "1px solid #f0d9b5", color: "var(--c-amber, #8a5a00)" }}>
            <Icon name="TriangleAlert" size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              {!hasFire
                ? "На схеме нет очага пожара. Установите очаг — подбирать режим не от чего."
                : "Сначала выполните «Расчёт сети» (F9) — иначе расходы и депрессии нулевые."}
            </div>
          </div>
        )}

        {/* Параметры подбора */}
        <div className="px-4 pt-3 pb-2.5 space-y-2" style={{ borderBottom: "1px solid #e0e4ee" }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            Условия подбора
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 flex-1">Действий в варианте, не более</span>
            <select value={maxActions} disabled={searching}
              onChange={e => setMaxActions(Number(e.target.value))}
              className="text-[12px] border border-gray-300 rounded px-2 py-1 disabled:opacity-50">
              <option value={1}>1 — одиночные действия</option>
              <option value={2}>2 — пары</option>
              <option value={3}>3 — тройки (долго)</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 flex-1">Глубина отбора рычагов, ветвей</span>
            <input type="number" min={1} max={12} value={reach} disabled={searching}
              onChange={e => setReach(Math.max(1, Math.min(12, Number(e.target.value) || 4)))}
              className="text-[12px] border border-gray-300 rounded px-2 py-1 w-24 text-right disabled:opacity-50" />
          </div>
          <div className="text-[10px] text-gray-400 leading-snug pt-0.5">
            Рассматриваются вентиляторы и двери рядом с очагом и людьми: реверс, остановка,
            смена оборотов, закрытие и открытие дверей. Каждый вариант считается ПОЛНЫМ
            расчётом пожарного режима — тем же, что и кнопка «Расчёт пожара», поэтому подбор
            занимает от десятков секунд до нескольких минут.
          </div>

          {/* Запуск и отмена */}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleSearch} disabled={!canSearch}
              className="text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5 disabled:opacity-50"
              style={{ borderColor: "#c8d4e8", background: "#eef4ff", color: "var(--c-blue, #1d4ed8)" }}>
              <Icon name={searching ? "Loader" : "Play"} size={12}
                className={searching ? "animate-spin" : ""} />
              {searching ? "Подбор..." : "Подобрать режим"}
            </button>
            {searching && (
              <button onClick={() => { cancelRef.current = true; }}
                className="text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5"
                style={{ borderColor: "#e0c0c0", background: "#fff1f1", color: "var(--c-red, #b91c1c)" }}
                title="Остановить подбор и показать варианты, посчитанные до остановки">
                <Icon name="Square" size={11} />
                Отменить
              </button>
            )}
            {searching && progress && (
              <span className="text-[10px] text-gray-500 truncate" style={{ maxWidth: 320 }}>
                {progress.label} · рассчитано {progress.done} из ~{progress.total}
              </span>
            )}
          </div>

          {/* Шкала хода подбора */}
          {searching && (
            <div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#e3e8f2" }}>
                {/* Минимальная видимая ширина + пульсация, пока прогресс мал:
                    первый расчёт самый долгий, и пустая шкала выглядит зависанием. */}
                <div className={`h-full rounded-full transition-all duration-300 ${pct < 99 ? "animate-pulse" : ""}`}
                  style={{ width: `${Math.max(6, pct)}%`, background: "var(--c-blue, #2563eb)" }} />
              </div>
              <div className="text-[10px] text-gray-400 pt-1">
                {cancelRef.current ? "Останавливаем подбор…" : `${pct}%`}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="px-4 py-2.5 text-[11px] flex items-start gap-2"
            style={{ background: "#fff1f1", borderBottom: "1px solid #f0c0c0", color: "var(--c-red, #b91c1c)" }}>
            <Icon name="CircleAlert" size={14} className="mt-0.5 flex-shrink-0" />
            <div>Не удалось выполнить подбор: {error}</div>
          </div>
        )}

        {/* Результат */}
        <div className="flex-1 overflow-auto">
          {report
            ? <ReportView
                report={report}
                expanded={expanded}
                onToggle={i => setExpanded(prev => prev === i ? null : i)}
                onApply={onApply}
                onHighlightBranches={onHighlightBranches}
              />
            : !searching && (
              <div className="px-4 py-8 text-center text-[11px] text-gray-400">
                Нажмите «Подобрать режим», чтобы программа перебрала управляющие действия
                и нашла те, при которых людей в зоне риска меньше всего.
              </div>
            )}
        </div>

        {/* Низ окна */}
        <div className="px-4 py-2 flex items-center justify-between"
          style={{ background: "var(--c-s3, #f6f8fc)", borderTop: "1px solid #e0e4ee" }}>
          <span className="text-[10px] text-gray-400">
            {report
              ? `Рассмотрено действий: ${report.candidatesCount} · расчётов сети: ${report.evaluations}`
              : "Подбор не гарантирует наилучшего из всех мыслимых режимов"}
          </span>
          <button onClick={onClose}
            className="text-[11px] px-3 py-1 rounded border"
            style={{ borderColor: "#c8d0e0", background: "#fff" }}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Итог подбора
// ─────────────────────────────────────────────────────────────────────────────

function ReportView({
  report, expanded, onToggle, onApply, onHighlightBranches,
}: {
  report: SearchReport;
  expanded: number | null;
  onToggle: (i: number) => void;
  onApply: (actions: FireAction[]) => void;
  onHighlightBranches?: (ids: string[]) => void;
}) {
  const { base, variants, allSaved, bestPeopleAtRisk, cancelled, note } = report;

  return (
    <div>
      {/* ── Главный вывод ──────────────────────────────────────────────────
          Здесь принципиально: невозможность вывести людей показывается так же
          заметно, как успех. Это вывод расчёта, а не отсутствие результата. */}
      <div className="px-4 py-3 flex items-start gap-2.5"
        style={{
          background: allSaved ? "#f0fdf4" : "#fff1f1",
          borderBottom: `1px solid ${allSaved ? "#bbf7d0" : "#f0c0c0"}`,
        }}>
        <Icon name={allSaved ? "ShieldCheck" : "TriangleAlert"} size={18}
          className="mt-0.5 flex-shrink-0"
          style={{ color: allSaved ? "var(--c-green, #15803d)" : "var(--c-red, #b91c1c)" }} />
        <div className="flex-1">
          <div className="text-[12px] font-semibold"
            style={{ color: allSaved ? "var(--c-green, #15803d)" : "var(--c-red, #b91c1c)" }}>
            {allSaved
              ? "Найден режим, при котором все успевают выйти"
              : `Людей в зоне риска остаётся: ${bestPeopleAtRisk}`}
          </div>
          {note && <div className="text-[11px] text-gray-600 pt-1 leading-snug">{note}</div>}
          {cancelled && (
            <div className="text-[10px] pt-1" style={{ color: "var(--c-amber, #8a5a00)" }}>
              Подбор остановлен — часть вариантов не проверена.
            </div>
          )}
        </div>
      </div>

      {/* Исходный режим — точка отсчёта */}
      <div className="px-4 py-2 flex items-center gap-5 text-[11px] flex-wrap"
        style={{ background: "var(--c-s3, #f6f8fc)", borderBottom: "1px solid #e0e4ee" }}>
        <span className="text-gray-500 font-medium">Без изменений режима:</span>
        <Metric label="не успевают выйти" value={base.peopleAtRisk} danger={base.peopleAtRisk > 0} />
        <Metric label="в зоне задымления" value={base.peopleInSmoke} warn={base.peopleInSmoke > 0} />
        <Metric label="превышений скорости" value={base.velocityViolations} warn={base.velocityViolations > 0} />
      </div>

      {/* Варианты */}
      {variants.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] text-gray-400">
          Вариантов, улучшающих исходный режим, не найдено.
        </div>
      ) : (
        <div>
          {variants.map((v, i) => (
            <VariantRow
              key={i}
              variant={v}
              base={base}
              index={i}
              open={expanded === i}
              onToggle={() => onToggle(i)}
              onApply={() => onApply(v.actions)}
              onHighlight={() => onHighlightBranches?.(v.violationBranchIds)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, danger, warn }: {
  label: string; value: number; danger?: boolean; warn?: boolean;
}) {
  const color = danger ? "var(--c-red, #b91c1c)"
    : warn ? "var(--c-amber, #c2410c)"
    : "var(--c-green, #15803d)";
  return (
    <span className="text-gray-600">
      {label}: <b style={{ color }}>{value}</b>
    </span>
  );
}

function VariantRow({
  variant, base, index, open, onToggle, onApply, onHighlight,
}: {
  variant: VariantResult;
  base: VariantResult;
  index: number;
  open: boolean;
  onToggle: () => void;
  onApply: () => void;
  onHighlight: () => void;
}) {
  const saved = base.peopleAtRisk - variant.peopleAtRisk;

  return (
    <div style={{ borderBottom: "1px solid #eef1f6" }}>
      <div className="px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-blue-50"
        onClick={onToggle}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={13} className="text-gray-400 flex-shrink-0" />
        <span className="text-[11px] text-gray-400 tabular-nums w-4 flex-shrink-0">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium truncate">{variant.title}</div>
          <div className="text-[10px] text-gray-400">
            {variant.actions.length === 1 ? "1 действие" : `${variant.actions.length} действия`}
            {" · "}примерно {variant.effortMin} мин на исполнение
          </div>
        </div>
        {/* Главный показатель варианта — скольких людей он выводит. */}
        <div className="text-right flex-shrink-0">
          <div className="text-[12px] font-semibold tabular-nums"
            style={{ color: variant.peopleAtRisk === 0 ? "var(--c-green, #15803d)" : "var(--c-red, #b91c1c)" }}>
            {variant.peopleAtRisk === 0 ? "все выходят" : `в риске ${variant.peopleAtRisk}`}
          </div>
          {saved > 0 && (
            <div className="text-[10px]" style={{ color: "var(--c-green, #15803d)" }}>
              выводит ещё {saved}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-3" style={{ background: "#fbfcfe" }}>
          {/* Действия по шагам — это и есть команда для аварийного плана. */}
          <div className="pl-7 pt-1 space-y-1">
            {variant.actions.map((a, i) => (
              <div key={i} className="text-[11px] text-gray-700 flex items-start gap-2">
                <span className="text-gray-400 tabular-nums">{i + 1}.</span>
                <span className="flex-1">{a.label}</span>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">~{a.effortMin} мин</span>
              </div>
            ))}
          </div>

          <div className="pl-7 pt-2 flex items-center gap-5 text-[11px] flex-wrap">
            <Metric label="в зоне задымления" value={variant.peopleInSmoke} warn={variant.peopleInSmoke > 0} />
            <Metric label="нужен ПВП" value={variant.peopleNeedSwitch} warn={variant.peopleNeedSwitch > 0} />
            <Metric label="превышений скорости" value={variant.velocityViolations} warn={variant.velocityViolations > 0} />
            <span className="text-gray-600">опрокинутых струй: <b>{variant.reversedBranches}</b></span>
          </div>

          {/* Превышение допустимой скорости — причина, по которой режим могут
              не утвердить в плане ликвидации аварий. Молчать об этом нельзя. */}
          {variant.velocityViolations > 0 && (
            <div className="pl-7 pt-2 text-[10px] flex items-start gap-1.5"
              style={{ color: "var(--c-amber, #8a5a00)" }}>
              <Icon name="TriangleAlert" size={12} className="mt-0.5 flex-shrink-0" />
              <span>
                В {variant.velocityViolations} выработках скорость воздуха выше допустимой —
                режим потребует обоснования.{" "}
                <button onClick={onHighlight} className="underline">Показать на схеме</button>
              </span>
            </div>
          )}

          <div className="pl-7 pt-2.5">
            <button onClick={onApply}
              className="text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5"
              style={{ borderColor: "#c8d4e8", background: "#eef4ff", color: "var(--c-blue, #1d4ed8)" }}
              title="Внести действия варианта в проект: изменить вентиляторы и двери на схеме">
              <Icon name="Check" size={12} />
              Применить к схеме
            </button>
          </div>
        </div>
      )}
    </div>
  );
}