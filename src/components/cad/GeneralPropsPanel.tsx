// Вкладка «Общие» левой панели: паспорт выбранной ветви или узла.
//
// Оформление — карточки с иконкой-маркером и переключателями вместо
// рамок-fieldset и «виндовых» галочек: панель строится на палитре темы
// (--c-accent / --c-signal, --c-s*, --c-b*, --c-t*) и одинаково читается
// в светлой и тёмной теме.
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { Card, Field, Switch, inputCls, inputStyle } from "@/components/cad/propUi";
import type { TopoBranch, TopoNode, Horizon } from "@/lib/topology";

// ─── Примитивы ──────────────────────────────────────────────────────────────

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

/** Флажок-плашка: компактная альтернатива Switch для пары взаимосвязанных признаков. */
function ToggleChip({ checked, onChange, icon, label, title }: {
  checked: boolean; onChange: (v: boolean) => void; icon: string; label: string; title?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)} title={title}
      role="switch" aria-checked={checked}
      className="flex-1 min-w-0 h-8 px-2 rounded-md flex items-center gap-1.5 text-[11px] transition-colors"
      style={{
        cursor: "pointer",
        background: checked ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 12%, transparent)" : "var(--c-s1, #fff)",
        border: `1px solid ${checked ? "var(--c-accent, #1e5a7a)" : "var(--c-b2, #d5d1c8)"}`,
        color: checked ? "var(--c-accent, #1e5a7a)" : "var(--c-t2, #3a3f45)",
        fontWeight: checked ? 600 : 400,
      }}>
      <Icon name={checked ? "SquareCheck" : "Square"} size={13} className="flex-shrink-0" />
      <Icon name={icon} size={12} className="flex-shrink-0 opacity-70" />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Живой образец линии ветви: толщина + тёмный контур, пунктир для проектируемой. */
function LinePreview({ width, border, dashed }: { width: number; border: number; dashed: boolean }) {
  const w = Math.max(0.5, Math.min(width, 20));
  const b = Math.max(0, Math.min(border, 8));
  const dash = dashed ? `${w * 2.5} ${w * 1.5}` : undefined;
  return (
    <div className="rounded-md flex items-center justify-center"
      style={{ height: 36, background: "var(--c-s3, #f1efea)" }} title="Так ветвь выглядит на схеме">
      <svg width="100%" height="36" viewBox="0 0 200 36" preserveAspectRatio="none">
        {b > 0 && (
          <line x1="14" y1="18" x2="186" y2="18" stroke="#1f2328" strokeWidth={w + b * 2}
            strokeLinecap="round" strokeDasharray={dash} />
        )}
        <line x1="14" y1="18" x2="186" y2="18" stroke="var(--c-signal, #e8a317)" strokeWidth={w}
          strokeLinecap="round" strokeDasharray={dash} />
      </svg>
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

      {branch && <MultiNote count={p.editCount} verb="Правки применятся" />}

      {/* ── Идентификация ── */}
      {hasSel && (
        <Card icon="Tag" title="Идентификация">
          <Field label="Название">
            <input type="text" className={inputCls} style={inputStyle}
              value={branch ? branch.type : node!.name}
              placeholder={branch ? "Например, Штрек вент. гор. +30" : "Имя узла"}
              onChange={(e) => branch ? p.onBranchPatch({ type: e.target.value }) : p.onNodePatch({ name: e.target.value })} />
          </Field>
          <div className={branch ? "grid gap-2" : undefined}
            style={branch ? { gridTemplateColumns: "84px minmax(0,1fr)" } : undefined}>
            <Field label="Номер">
              <input type="text" className={inputCls}
                title="Применяется по Enter или при уходе с поля; Esc — отмена"
                style={{ ...inputStyle, fontFamily: "var(--font-num)", borderColor: numError ? "var(--c-red, #dc2626)" : inputStyle.border as string }}
                value={numDraft}
                onChange={(e) => { setNumDraft(e.target.value); setNumError(null); }}
                onBlur={commitNumber}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setNumDraft(branch ? branch.id : node!.number || node!.id); (e.target as HTMLInputElement).blur(); } }} />
            </Field>
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
          </div>
          {numError && (
            <div className="text-[10px] -mt-1" style={{ color: "var(--c-red, #dc2626)" }}>{numError}</div>
          )}
          {branch && (
            <Field label="Статус">
              <div className="flex gap-1.5">
                <ToggleChip checked={branch.capital ?? false} onChange={(v) => p.onBranchPatch({ capital: v })}
                  icon="HardHat" label="Капитальная" title="Капитальная выработка" />
                <ToggleChip checked={branch.designed ?? false} onChange={(v) => p.onBranchPatch({ designed: v })}
                  icon="PencilRuler" label="Проектная" title="Проектируемая: контур выработки рисуется пунктиром" />
              </div>
            </Field>
          )}
        </Card>
      )}

      {/* ── Линия на схеме ── */}
      {branch && (() => {
        const w = branch.lineWidth ?? p.defaultWidth;
        const b = branch.lineBorder ?? p.defaultBorder;
        const custom = w !== p.defaultWidth || b !== p.defaultBorder;
        return (
          <Card icon="PenLine" title="Линия на схеме"
            aside={custom ? (
              <button type="button"
                onClick={() => p.onBranchPatch({ lineWidth: p.defaultWidth, lineBorder: p.defaultBorder })}
                className="flex items-center gap-1 px-1.5 h-5 rounded text-[10px]"
                title="Вернуть толщину и контур по умолчанию"
                style={{ background: "var(--c-s3, #f1efea)", border: "none", color: "var(--c-t3, #6b7280)", cursor: "pointer" }}>
                <Icon name="RotateCcw" size={10} /> Сброс
              </button>
            ) : undefined}>
            <LinePreview width={w} border={b} dashed={branch.designed ?? false} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Толщина">
                <Stepper value={w} min={0.5} max={20} step={0.5} unit="px"
                  onChange={(v) => p.onBranchPatch({ lineWidth: v })} />
              </Field>
              <Field label="Контур" aside={
                <span title="Тёмная окантовка линии, 0 — без неё" style={{ color: "var(--c-t4, #767f8c)", display: "inline-flex" }}>
                  <Icon name="Info" size={10} />
                </span>
              }>
                <Stepper value={b} min={0} max={8} step={0.2} unit="px"
                  onChange={(v) => p.onBranchPatch({ lineBorder: v })} />
              </Field>
            </div>
          </Card>
        );
      })()}

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