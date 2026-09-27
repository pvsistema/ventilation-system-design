import { useEffect, type ReactNode } from "react";
import Icon from "@/components/ui/icon";

export type CalcMode = "cross" | "mkr";
export type Season = "winter" | "summer";

export interface SolverParams {
  calcMode: CalcMode;
  solverTolerance: number;
  solverMaxIter: number;
  solverAlpha: number;
  useNaturalDraft: boolean;
  surfaceTemp: number;
  mineAirTemp: number;
  geoGradient: number;
  useHumidity: boolean;
  surfaceHumidity: number;
  mineHumidity: number;
  surfacePressure: number;
  heatingSeason: Season;
}

export const SOLVER_DEFAULTS = {
  calcMode: "cross" as CalcMode,
  solverTolerance: 0.001,
  solverMaxIter: 5000,
  solverAlpha: 0.5,
};

interface Props {
  values: SolverParams;
  onChange: <K extends keyof SolverParams>(key: K, value: SolverParams[K]) => void;
  onResetSolver: () => void;
  onClose: () => void;
}

/* ── Мелкие строительные блоки ─────────────────────────────────────────── */

function Section({ icon, title, right, children }: { icon: string; title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-3 py-2.5" style={{ borderTop: "1px solid var(--c-b1)" }}>
      <div className="flex items-center gap-1.5" style={{ marginBottom: children ? 8 : 0 }}>
        <Icon name={icon} size={13} style={{ color: "var(--c-t3)" }} />
        <span className="text-[10.5px] font-bold uppercase tracking-wide flex-1" style={{ color: "var(--c-t2)" }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-0.5 p-0.5" style={{
      gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      background: "var(--c-s3)", border: "1px solid var(--c-b2)", borderRadius: 6,
    }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className="flex items-center justify-center gap-1 text-[11px] py-1 transition-colors"
            style={{
              borderRadius: 4,
              fontWeight: on ? 700 : 500,
              background: on ? "var(--c-s1)" : "transparent",
              color: on ? "var(--c-t1)" : "var(--c-t3)",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.12), inset 0 -2px 0 var(--c-signal)" : "none",
            }}>
            {o.icon && <Icon name={o.icon} size={12} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 transition-colors"
      style={{
        width: 30, height: 16, borderRadius: 8,
        background: checked ? "var(--c-accent)" : "var(--c-b3)",
      }}>
      <span className="absolute top-0.5 transition-all" style={{
        left: checked ? 16 : 2, width: 12, height: 12, borderRadius: 6, background: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,.3)",
      }} />
    </button>
  );
}

function Field({ label, unit, value, onChange, step, min, max, hint }: {
  label: string; unit?: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; hint?: string;
}) {
  return (
    <label className="block" title={hint}>
      <span className="block text-[10px] mb-0.5 truncate" style={{ color: "var(--c-t3)" }}>{label}</span>
      <span className="flex items-stretch overflow-hidden focus-within:ring-1"
        style={{ border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)" }}>
        <input type="number" value={value} step={step} min={min} max={max}
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="font-num w-full min-w-0 text-[11.5px] px-1.5 py-1 text-right outline-none bg-transparent"
          style={{ color: "var(--c-t1)" }} />
        {unit && (
          <span className="flex items-center px-1.5 text-[10px] shrink-0"
            style={{ color: "var(--c-t3)", background: "var(--c-s3)", borderLeft: "1px solid var(--c-b1)" }}>
            {unit}
          </span>
        )}
      </span>
    </label>
  );
}

function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" }) {
  const warn = tone === "warn";
  return (
    <div className="text-[10px] leading-snug mt-2 px-2 py-1.5 flex gap-1.5" style={{
      borderRadius: 4,
      color: warn ? "var(--c-amber-ink)" : "var(--c-t3)",
      background: warn ? "var(--c-tint-amber)" : "var(--c-s2)",
      border: `1px solid ${warn ? "var(--c-tint-amber2)" : "var(--c-b1)"}`,
    }}>
      <Icon name={warn ? "TriangleAlert" : "Info"} size={11} className="shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}

/* ── Окно ──────────────────────────────────────────────────────────────── */

export default function SolverParamsPanel({ values: v, onChange, onResetSolver, onClose }: Props) {
  // Esc закрывает окно
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const draftDelta = v.surfaceTemp - v.mineAirTemp;

  return (
    <div className="fixed top-[160px] right-4 z-50 flex flex-col animate-scale-in"
      style={{
        width: 320, maxHeight: "calc(100vh - 200px)",
        background: "var(--c-s1)", border: "1px solid var(--c-b3)", borderRadius: 8,
        boxShadow: "0 12px 32px -8px rgba(0,0,0,.35)",
      }}>
      {/* Шапка */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ background: "var(--c-anthracite)", borderRadius: "7px 7px 0 0", borderBottom: "2px solid var(--c-signal)" }}>
        <Icon name="Settings" size={15} style={{ color: "var(--c-signal-lt)" }} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-white leading-tight">Параметры расчёта</div>
          <div className="text-[9.5px] leading-tight" style={{ color: "#aab1ba" }}>Применяются сразу к следующему расчёту</div>
        </div>
        <button onClick={onClose} title="Закрыть (Esc)"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10" style={{ color: "#c8cdd3" }}>
          <Icon name="X" size={14} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {/* 1. Метод */}
        <Section icon="GitFork" title="Метод расчёта">
          <Segmented value={v.calcMode} onChange={m => onChange("calcMode", m)}
            options={[{ value: "cross" as CalcMode, label: "Кросс" }, { value: "mkr" as CalcMode, label: "МКР" }]} />
          <div className="text-[10px] mt-1.5" style={{ color: "var(--c-t3)" }}>
            {v.calcMode === "cross"
              ? "Андрияшева–Кросса: надёжен, подходит для большинства схем."
              : "Метод контурных расходов: быстрее на больших сетях."}
          </div>
        </Section>

        {/* 2. Сходимость */}
        <Section icon="Target" title="Точность"
          right={
            <button type="button" onClick={onResetSolver}
              className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded hover:underline"
              style={{ color: "var(--c-accent)" }} title="Вернуть значения по умолчанию">
              <Icon name="RotateCcw" size={10} /> По умолчанию
            </button>
          }>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Допуск Q" unit="м³/с" value={v.solverTolerance} step={0.001} min={0}
              onChange={x => onChange("solverTolerance", x)}
              hint="Допустимая невязка расхода. Решатель не делает её строже 0,05% от расхода сети — меньшие значения не ускоряют и не уточняют расчёт." />
            <Field label="Итераций" value={v.solverMaxIter} step={1000} min={100}
              onChange={x => onChange("solverMaxIter", Math.max(1, Math.round(x)))}
              hint="Предельное число итераций. Обычно расчёт сходится намного раньше." />
            <Field label={v.calcMode === "mkr" ? "Шаг" : "Фактор α"} value={v.solverAlpha} step={0.05} min={0.05} max={1}
              onChange={x => onChange("solverAlpha", Math.min(1, Math.max(0.05, x)))}
              hint="Демпфирование итераций, 0,5–0,8. Больше — быстрее, но возможны колебания." />
          </div>
        </Section>

        {/* 3. Естественная тяга */}
        <Section icon="Wind" title="Естественная тяга"
          right={<Toggle checked={v.useNaturalDraft} onChange={x => onChange("useNaturalDraft", x)} label="Учитывать естественную тягу" />}>
          {v.useNaturalDraft ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Field label="t поверхн." unit="°C" value={v.surfaceTemp} step={1} min={-60} max={50}
                  onChange={x => onChange("surfaceTemp", x)} hint="Температура наружного воздуха t_н" />
                <Field label="t шахты" unit="°C" value={v.mineAirTemp} step={1} min={-20} max={60}
                  onChange={x => onChange("mineAirTemp", x)} hint="Средняя температура рудничного воздуха t_ср (по ГОСТ 15 °C)" />
                <Field label="Градиент" unit="°/100м" value={v.geoGradient} step={0.5} min={0} max={10}
                  onChange={x => onChange("geoGradient", x)} hint="Геотермический градиент. 0 — изотермия, температуры узлов берутся только из заданных вручную." />
              </div>
              <Note>
                Δt = {draftDelta > 0 ? "+" : ""}{draftDelta.toFixed(1)} °C —{" "}
                {Math.abs(draftDelta) < 0.5 ? "тяга почти отсутствует" : draftDelta < 0 ? "поверхность холоднее шахты (зимний режим)" : "поверхность теплее шахты (летний режим)"}.
                {" "}h<sub>e</sub> = γ·H·(t<sub>н</sub> − t<sub>ср</sub>)/(273 + t<sub>ср</sub>)
              </Note>
            </>
          ) : (
            <Note tone="warn">Всем узлам присваивается t поверхности — тяга равна 0 Па.</Note>
          )}
        </Section>

        {/* 4. Влажность — влияет на плотность только при включённой тяге */}
        {v.useNaturalDraft && (
          <Section icon="Droplets" title="Влажность воздуха"
            right={<Toggle checked={v.useHumidity} onChange={x => onChange("useHumidity", x)} label="Учитывать влажность воздуха" />}>
            {v.useHumidity ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="φ поверхн." unit="%" value={v.surfaceHumidity} step={5} min={0} max={100}
                    onChange={x => onChange("surfaceHumidity", Math.min(100, Math.max(0, x)))} />
                  <Field label="φ шахты" unit="%" value={v.mineHumidity} step={5} min={0} max={100}
                    onChange={x => onChange("mineHumidity", Math.min(100, Math.max(0, x)))} />
                  <Field label="Давление" unit="кПа" value={v.surfacePressure} step={0.5} min={60} max={120}
                    onChange={x => onChange("surfacePressure", x)} hint="Барометрическое давление на поверхности" />
                </div>
                <Note>Плотность по форм. 9.2. Требуется при перепаде отметок &gt; 100 м (пп. 69, 72). Влажность отдельных узлов — в их свойствах.</Note>
              </>
            ) : (
              <div className="text-[10px]" style={{ color: "var(--c-t3)" }}>Сухой воздух: ρ = 353/(273 + t).</div>
            )}
          </Section>
        )}

        {/* 5. Сезон */}
        <Section icon="Heater" title="Калориферы">
          <Segmented value={v.heatingSeason} onChange={s => onChange("heatingSeason", s)}
            options={[
              { value: "winter" as Season, label: "Зима — вкл.", icon: "Snowflake" },
              { value: "summer" as Season, label: "Лето — выкл.", icon: "Sun" },
            ]} />
          <div className="text-[10px] mt-1.5" style={{ color: "var(--c-t3)" }}>
            Летом подогрев снимается, температуры узлов возвращаются к фоновым.
          </div>
        </Section>
      </div>

      {/* Подвал */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ background: "var(--c-s2)", borderTop: "1px solid var(--c-b2)", borderRadius: "0 0 7px 7px" }}>
        <span className="text-[10px] flex-1" style={{ color: "var(--c-t4)" }}>Сохраняются в проекте</span>
        <button onClick={onClose} className="btn-brand text-[11px] px-4 py-1">Готово</button>
      </div>
    </div>
  );
}