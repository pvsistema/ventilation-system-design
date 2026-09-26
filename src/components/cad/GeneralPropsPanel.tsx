// Вкладка «Общие» левой панели: паспорт выбранной ветви или узла.
//
// Оформление — карточки с иконкой-маркером и переключателями вместо
// рамок-fieldset и «виндовых» галочек: панель строится на палитре темы
// (--c-accent / --c-signal, --c-s*, --c-b*, --c-t*) и одинаково читается
// в светлой и тёмной теме.
import { useEffect, useState, type ReactNode } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode, Horizon } from "@/lib/topology";

// ─── Примитивы ──────────────────────────────────────────────────────────────

const inputCls =
  "w-full h-7 px-2 text-xs rounded outline-none transition-colors focus:ring-2";
const inputStyle: React.CSSProperties = {
  background: "var(--c-s1, #fff)",
  border: "1px solid var(--c-b2, #d5d1c8)",
  color: "var(--c-t1, #1f2328)",
  fontFamily: "var(--font-ui)",
  // цвет кольца фокуса для focus:ring
  ["--tw-ring-color" as string]: "color-mix(in srgb, var(--c-accent, #1e5a7a) 25%, transparent)",
};

function Card({ icon, title, tone = "accent", aside, collapsible, defaultOpen = true, children }: {
  icon: string; title: string; tone?: "accent" | "signal" | "muted";
  aside?: ReactNode; collapsible?: boolean; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const color = tone === "signal" ? "var(--c-signal, #e8a317)"
    : tone === "muted" ? "var(--c-t3, #6b7280)" : "var(--c-accent, #1e5a7a)";
  const Head = collapsible ? "button" : "div";
  return (
    <section className="rounded-lg overflow-hidden"
      style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b1, #e7e4dd)" }}>
      <Head
        {...(collapsible ? { onClick: () => setOpen((v) => !v), type: "button" as const } : {})}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left select-none"
        style={{ background: "transparent", border: "none", cursor: collapsible ? "pointer" : "default" }}>
        <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <Icon name={icon} size={13} />
        </span>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--c-t2, #3a3f45)" }}>{title}</span>
        {aside}
        {collapsible && (
          <Icon name="ChevronDown" size={14}
            style={{ color: "var(--c-t4, #767f8c)", transform: open ? "none" : "rotate(-90deg)", transition: "transform .15s" }} />
        )}
      </Head>
      {open && <div className="px-2.5 pb-2.5 pt-0.5 space-y-2">{children}</div>}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium mb-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>{label}</span>
      {children}
      {hint && <span className="block text-[10px] mt-0.5" style={{ color: "var(--c-t4, #767f8c)" }}>{hint}</span>}
    </label>
  );
}

function Switch({ checked, onChange, label, hint, kbd }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; kbd?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-2 px-1.5 py-1 rounded text-left transition-colors"
      style={{ background: "transparent", border: "none", cursor: "pointer" }}
      role="switch" aria-checked={checked}>
      <span className="relative flex-shrink-0 mt-0.5 rounded-full transition-colors"
        style={{
          width: 26, height: 14,
          background: checked ? "var(--c-accent, #1e5a7a)" : "var(--c-b2, #d5d1c8)",
        }}>
        <span className="absolute top-[2px] rounded-full transition-all"
          style={{ width: 10, height: 10, left: checked ? 14 : 2, background: "var(--c-s1, #fff)" }} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--c-t2, #3a3f45)" }}>
          {label}
          {kbd && (
            <kbd className="px-1 rounded text-[9px]"
              style={{ border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t3, #6b7280)", fontFamily: "var(--font-num)" }}>
              {kbd}
            </kbd>
          )}
        </span>
        {hint && <span className="block text-[10px] leading-snug" style={{ color: "var(--c-t4, #767f8c)" }}>{hint}</span>}
      </span>
    </button>
  );
}

/** Число со степпером −/+ (шаг и границы задаются). */
function Stepper({ value, onChange, min, max, step, unit }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step: number; unit: string;
}) {
  const clamp = (v: number) => Math.round(Math.max(min, Math.min(max, v)) * 100) / 100;
  const btn: React.CSSProperties = {
    width: 24, height: 26, background: "var(--c-s3, #f1efea)", border: "none",
    color: "var(--c-t2, #3a3f45)", cursor: "pointer",
  };
  return (
    <div className="flex items-center rounded overflow-hidden"
      style={{ border: "1px solid var(--c-b2, #d5d1c8)" }}>
      <button type="button" style={btn} onClick={() => onChange(clamp(value - step))} title="Меньше">
        <Icon name="Minus" size={11} />
      </button>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        className="flex-1 min-w-0 h-[26px] text-center text-xs outline-none"
        style={{ background: "var(--c-s1, #fff)", color: "var(--c-t1, #1f2328)", border: "none", fontFamily: "var(--font-num)" }} />
      <span className="px-1 text-[10px]" style={{ color: "var(--c-t4, #767f8c)", background: "var(--c-s1, #fff)", lineHeight: "26px" }}>{unit}</span>
      <button type="button" style={btn} onClick={() => onChange(clamp(value + step))} title="Больше">
        <Icon name="Plus" size={11} />
      </button>
    </div>
  );
}

/** Ползунок + сегментные пресеты + сброс. */
function PresetSlider({ value, onChange, onReset, min, max, step, presets, fmt }: {
  value: number; onChange: (v: number) => void; onReset: () => void;
  min: number; max: number; step: number; presets: number[]; fmt: (v: number) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1" style={{ accentColor: "var(--c-accent, #1e5a7a)" }} />
        <span className="w-12 text-right text-xs tabular-nums"
          style={{ color: "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)" }}>{fmt(value)}</span>
        <button type="button" onClick={onReset} title="Сбросить"
          className="w-6 h-6 flex items-center justify-center rounded"
          style={{ background: "var(--c-s3, #f1efea)", border: "none", color: "var(--c-t3, #6b7280)", cursor: "pointer" }}>
          <Icon name="RotateCcw" size={11} />
        </button>
      </div>
      <div className="flex p-0.5 rounded" style={{ background: "var(--c-s3, #f1efea)" }}>
        {presets.map((p) => {
          const on = Math.abs(value - p) < 1e-6;
          return (
            <button key={p} type="button" onClick={() => onChange(p)}
              className="flex-1 h-5 text-[10px] rounded transition-colors"
              style={{
                border: "none", cursor: "pointer", fontFamily: "var(--font-num)",
                background: on ? "var(--c-s1, #fff)" : "transparent",
                color: on ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)",
                fontWeight: on ? 600 : 400,
                boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none",
              }}>
              {fmt(p)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MultiNote({ count, verb }: { count: number; verb: string }) {
  if (count <= 1) return null;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px]"
      style={{ background: "var(--c-tint-amber, #fffbeb)", color: "var(--c-amber-ink, #865412)" }}>
      <Icon name="Layers" size={11} />
      {verb} сразу к {count} выбранным выработкам
    </div>
  );
}

// ─── Панель ─────────────────────────────────────────────────────────────────

export interface GeneralPropsPanelProps {
  branch: TopoBranch | null;
  node: TopoNode | null;
  /** Сколько ветвей затронет правка (Ctrl-выделение). */
  editCount: number;
  horizons: Horizon[];
  multiHorizonMixed: boolean;
  defaultWidth: number;
  defaultBorder: number;
  /** Правка всех выбранных ветвей. */
  onBranchPatch: (patch: Partial<TopoBranch>) => void;
  onNodePatch: (patch: Partial<TopoNode>) => void;
  /** Смена номера ветви. Возвращает текст ошибки или null. */
  onRenameBranch: (newId: string) => string | null;

  thinLines: boolean; setThinLines: (v: boolean) => void;
  colorByHorizon: boolean; setColorByHorizon: (v: boolean) => void;
  surveyEditMode: boolean; setSurveyEditMode: (v: boolean) => void;
  movedNodeCount: number; totalNodes: number;
  onResetSurvey: () => void; onFixSurvey: () => void;
}

export default function GeneralPropsPanel(p: GeneralPropsPanelProps) {
  const { branch, node } = p;

  // Номер ветви меняется по Enter/уходу с поля: при посимвольной правке id
  // ветви переименовывался на каждое нажатие и мог совпасть с чужим.
  const [numDraft, setNumDraft] = useState("");
  const [numError, setNumError] = useState<string | null>(null);
  useEffect(() => {
    setNumDraft(branch ? branch.id : node ? (node.number || node.id) : "");
    setNumError(null);
  }, [branch?.id, node?.id, node?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitNumber = () => {
    const v = numDraft.trim();
    if (branch) {
      if (!v || v === branch.id) { setNumDraft(branch.id); setNumError(null); return; }
      const err = p.onRenameBranch(v);
      setNumError(err);
      if (err) setNumDraft(branch.id);
    } else if (node && v !== (node.number || node.id)) {
      p.onNodePatch({ number: v });
    }
  };

  const horizon = branch?.horizonId ? p.horizons.find((h) => h.id === branch.horizonId) : undefined;
  const hasSel = !!(branch || node);

  return (
    <div className="p-2 space-y-2" style={{ fontFamily: "var(--font-ui)" }}>
      {/* ── Паспорт объекта ── */}
      {hasSel && (
        <div className="rounded-lg px-3 py-2.5 relative overflow-hidden"
          style={{ background: "var(--c-anthracite, #2b2f33)", color: "#f4f3ef" }}>
          <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: "var(--c-signal, #e8a317)" }} />
          <div className="flex items-center gap-2">
            <Icon name={branch ? "Spline" : "CircleDot"} size={14} style={{ color: "var(--c-signal, #e8a317)" }} />
            <span className="text-[10px] uppercase tracking-widest opacity-70">{branch ? "Выработка" : "Узел"}</span>
            <span className="ml-auto text-sm font-semibold" style={{ fontFamily: "var(--font-num)" }}>
              №{branch ? branch.id : (node!.number || node!.id)}
            </span>
          </div>
          {branch && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] opacity-90"
              style={{ fontFamily: "var(--font-num)" }}>
              <span className="flex items-center gap-1">{branch.fromId}<Icon name="ArrowRight" size={10} />{branch.toId}</span>
              <span>L {Math.round(branch.length * 10) / 10} м</span>
              {horizon && (
                <span className="flex items-center gap-1" style={{ fontFamily: "var(--font-ui)" }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: horizon.color }} />{horizon.name}
                </span>
              )}
            </div>
          )}
          {node && !branch && (
            <div className="mt-1.5 text-[11px] opacity-90" style={{ fontFamily: "var(--font-num)" }}>
              X {Math.round(node.x)} · Y {Math.round(node.y)} · Z {Math.round(node.z)} м
            </div>
          )}
        </div>
      )}

      {/* ── Идентификация ── */}
      {hasSel && (
        <Card icon="Tag" title="Идентификация">
          <Field label="Название">
            <input type="text" className={inputCls} style={inputStyle}
              value={branch ? branch.type : node!.name}
              placeholder={branch ? "Например, Штрек вент. гор. +30" : "Имя узла"}
              onChange={(e) => branch ? p.onBranchPatch({ type: e.target.value }) : p.onNodePatch({ name: e.target.value })} />
          </Field>
          <Field label="Номер" hint={branch ? "Применяется по Enter или при уходе с поля" : undefined}>
            <input type="text" className={inputCls}
              style={{ ...inputStyle, fontFamily: "var(--font-num)", borderColor: numError ? "var(--c-red, #dc2626)" : inputStyle.border as string }}
              value={numDraft}
              onChange={(e) => { setNumDraft(e.target.value); setNumError(null); }}
              onBlur={commitNumber}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setNumDraft(branch ? branch.id : node!.number || node!.id); (e.target as HTMLInputElement).blur(); } }} />
          </Field>
          {numError && (
            <div className="text-[10px] -mt-1" style={{ color: "var(--c-red, #dc2626)" }}>{numError}</div>
          )}
          {branch && (
            <Field label="Горизонт">
              <select className={inputCls} style={{ ...inputStyle, cursor: "pointer" }}
                value={p.multiHorizonMixed ? "__mixed__" : branch.horizonId}
                onChange={(e) => p.onBranchPatch({ horizonId: e.target.value })}>
                {p.multiHorizonMixed && <option value="__mixed__" disabled>— разные горизонты —</option>}
                <option value="">— без привязки —</option>
                {p.horizons.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.z} м)</option>)}
              </select>
            </Field>
          )}
          {branch && <MultiNote count={p.editCount} verb="Применится" />}
        </Card>
      )}

      {/* ── Статус выработки ── */}
      {branch && (
        <Card icon="HardHat" title="Статус" tone="signal">
          <Switch checked={branch.capital ?? false} onChange={(v) => p.onBranchPatch({ capital: v })}
            label="Капитальная выработка" />
          <Switch checked={branch.designed ?? false} onChange={(v) => p.onBranchPatch({ designed: v })}
            label="Проектируемая" hint="Контур выработки рисуется пунктиром" />
        </Card>
      )}

      {/* ── Линия на схеме ── */}
      {branch && (
        <Card icon="PenLine" title="Линия на схеме">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Толщина">
              <Stepper value={branch.lineWidth ?? p.defaultWidth} min={0.5} max={20} step={0.5} unit="px"
                onChange={(v) => p.onBranchPatch({ lineWidth: v })} />
            </Field>
            <Field label="Контур">
              <Stepper value={branch.lineBorder ?? p.defaultBorder} min={0} max={8} step={0.2} unit="px"
                onChange={(v) => p.onBranchPatch({ lineBorder: v })} />
            </Field>
          </div>
          <div className="text-[10px]" style={{ color: "var(--c-t4, #767f8c)" }}>
            Контур — тёмная окантовка линии, 0 — без неё.
          </div>
          <MultiNote count={p.editCount} verb="Применится" />
        </Card>
      )}

      {/* ── Подписи (индикаторы) ── */}
      {branch && (
        <Card icon="Type" title="Подписи на схеме" collapsible>
          <Field label="Поворот блока меток">
            <PresetSlider value={branch.labelAngle ?? 0} min={-180} max={180} step={5}
              presets={[-90, -45, 0, 45, 90]} fmt={(v) => `${v}°`}
              onChange={(v) => p.onBranchPatch({ labelAngle: v })}
              onReset={() => p.onBranchPatch({ labelAngle: 0 })} />
          </Field>
          <Field label="Размер текста">
            <PresetSlider value={branch.labelSize ?? 1} min={0.3} max={4} step={0.1}
              presets={[0.5, 0.75, 1, 1.5, 2]} fmt={(v) => `×${v}`}
              onChange={(v) => p.onBranchPatch({ labelSize: v === 1 ? undefined : v })}
              onReset={() => p.onBranchPatch({ labelSize: undefined })} />
          </Field>
          <MultiNote count={p.editCount} verb="Применится" />
        </Card>
      )}

      {/* ── Примечание ── */}
      {branch && (
        <Card icon="StickyNote" title="Примечание" tone="muted" collapsible defaultOpen={!!branch.comment}
          aside={branch.comment ? <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--c-signal, #e8a317)" }} /> : undefined}>
          <textarea rows={3} value={branch.comment ?? ""}
            onChange={(e) => p.onBranchPatch({ comment: e.target.value })}
            placeholder="Например: «ремонт крепи до 15.10»"
            className="w-full px-2 py-1.5 text-xs rounded outline-none"
            style={{ ...inputStyle, resize: "vertical" }} />
          <MultiNote count={p.editCount} verb="Запишется" />
        </Card>
      )}

      {/* ── Настройки всей схемы ── */}
      <Card icon="Map" title="Вся схема" tone="muted" collapsible defaultOpen={false}
        aside={p.movedNodeCount > 0 ? (
          <span className="px-1.5 rounded-full text-[10px] font-semibold"
            style={{ background: "var(--c-tint-amber2, #fef3c7)", color: "var(--c-amber-ink, #865412)", fontFamily: "var(--font-num)" }}
            title="Узлы, сдвинутые с маркшейдерских мест">
            {p.movedNodeCount}
          </span>
        ) : undefined}>
        <Switch checked={p.thinLines} onChange={p.setThinLines} label="Тонкие линии 1 px" kbd="F6" />
        <Switch checked={p.colorByHorizon} onChange={p.setColorByHorizon} label="Цвет ветвей по горизонту" />

        <div className="pt-1 mt-1" style={{ borderTop: "1px dashed var(--c-b1, #e7e4dd)" }}>
          <div className="text-[10px] leading-snug px-1.5 pb-1" style={{ color: "var(--c-t4, #767f8c)" }}>
            Расчёт и длины идут по маркшейдерским координатам. Перетаскивание узла
            мышью двигает только изображение.
          </div>
          <Switch checked={p.surveyEditMode} onChange={p.setSurveyEditMode}
            label="Править настоящие координаты" kbd="F2" />
          {p.surveyEditMode && (
            <div className="flex gap-1.5 px-2 py-1.5 rounded text-[10px] leading-snug"
              style={{ background: "var(--c-tint-red, #fef2f2)", color: "var(--c-red-ink, #991b1b)" }}>
              <Icon name="TriangleAlert" size={12} className="flex-shrink-0 mt-px" />
              Перетаскивание узла меняет длины выработок, сопротивление и результат расчёта.
            </div>
          )}
          <div className="flex items-center justify-between px-1.5 py-1 text-[11px]" style={{ color: "var(--c-t2, #3a3f45)" }}>
            <span>Сдвинуто узлов</span>
            <span style={{ fontFamily: "var(--font-num)" }}>
              <b>{p.movedNodeCount}</b> / {p.totalNodes}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={p.onResetSurvey} disabled={p.movedNodeCount === 0}
              className="h-7 px-1.5 rounded text-[11px] flex items-center justify-center gap-1"
              title="Вернуть все узлы на маркшейдерские места"
              style={{
                background: "var(--c-s3, #f1efea)", border: "1px solid var(--c-b2, #d5d1c8)",
                color: p.movedNodeCount ? "var(--c-t2, #3a3f45)" : "var(--c-t4, #767f8c)",
                cursor: p.movedNodeCount ? "pointer" : "default", opacity: p.movedNodeCount ? 1 : 0.6,
              }}>
              <Icon name="Undo2" size={11} /> Вернуть
            </button>
            <button type="button" onClick={p.onFixSurvey}
              className="h-7 px-1.5 rounded text-[11px] flex items-center justify-center gap-1"
              title="Считать нынешнее положение узлов выверенным и записать его как маркшейдерское"
              style={{ background: "var(--c-accent, #1e5a7a)", border: "none", color: "#fff", cursor: "pointer" }}>
              <Icon name="Pin" size={11} /> Эталон
            </button>
          </div>
        </div>
      </Card>

      {!hasSel && (
        <div className="px-3 py-6 text-center text-xs" style={{ color: "var(--c-t4, #767f8c)" }}>
          <Icon name="MousePointerClick" size={20} className="mx-auto mb-1.5 opacity-60" />
          Выделите ветвь или узел на схеме
        </div>
      )}
    </div>
  );
}
