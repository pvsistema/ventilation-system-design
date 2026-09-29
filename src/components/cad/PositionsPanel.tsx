// ─────────────────────────────────────────────────────────────────────────────
// PositionsPanel.tsx — вкладка «Позиции ПЛА» левой панели.
//
// Оформление — как у вкладки «Горизонты»: список карточек, клик по строке
// раскрывает свойства позиции, настройки сгруппированы в раскрываемые блоки.
// Все цвета — из палитры темы (--c-*).
//
// Режимы работы со схемой (размещение маркера, привязка ветвей F3, выноска)
// общие с кнопкой «Позиция ПЛА» главной ленты: состояние хранится в странице
// и лишь отображается здесь.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type Position, makePosition, VENT_MODES, ACCIDENT_TYPES, FONT_OPTIONS, POSITION_COLORS,
} from "@/lib/positions";
import { type TopoBranch, type TopoNode } from "@/lib/topology";
import Icon from "@/components/ui/icon";

interface Props {
  positions: Position[];
  branches: TopoBranch[];
  nodes: TopoNode[];
  selectedPositionId: string | null;
  onSelect: (id: string | null) => void;
  /** Центрировать схему на позиции */
  onFocus?: (pos: Position) => void;
  onAdd: (pos: Position) => void;
  onUpdate: (id: string, patch: Partial<Position>) => void;
  onDelete: (id: string) => void;
  onPlaceMode: () => void;
  placeModeActive: boolean;
  branchBindMode?: boolean;
  onToggleBranchBind?: () => void;
  /** ID позиции в режиме рисования выноски (null = не активен) */
  leaderDrawMode?: string | null;
  onStartLeaderDraw?: (posId: string) => void;
  onRemoveLeader?: (posId: string) => void;
  onStartExtraLeaderDraw?: (posId: string) => void;
  onRemoveExtraLeader?: (posId: string, leaderId: string) => void;
}

// ─── Примитивы (как во вкладке «Горизонты») ────────────────────────────
function IconBtn({ icon, title, onClick, danger, active }: {
  icon: string; title: string; onClick: () => void; danger?: boolean; active?: boolean;
}) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} title={title}
      className="w-6 h-6 flex items-center justify-center rounded flex-shrink-0 transition-colors hover:bg-[var(--c-s4)]"
      style={{ color: danger ? "var(--c-red)" : active ? "var(--c-accent)" : "var(--c-t3)" }}>
      <Icon name={icon} size={13} />
    </button>
  );
}

function Btn({ icon, children, onClick, active, danger, title, grow, disabled }: {
  icon?: string; children: ReactNode; onClick: () => void; active?: boolean; danger?: boolean;
  title?: string; grow?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={title} disabled={disabled}
      className={`${grow ? "flex-1" : ""} h-7 px-2 flex items-center justify-center gap-1 text-[11px] font-medium rounded transition-colors disabled:opacity-40 ${active ? "" : "hover:bg-[var(--c-s3)]"}`}
      style={{
        border: `1px solid ${active ? "var(--c-accent)" : "var(--c-b2)"}`,
        background: active ? "var(--c-accent)" : "var(--c-s1)",
        color: active ? "#fff" : danger ? "var(--c-red)" : "var(--c-t2)",
      }}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </button>
  );
}

function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
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
            className="text-[11px] py-0.5 transition-colors"
            style={{
              borderRadius: 4, fontWeight: on ? 700 : 500,
              background: on ? "var(--c-s1)" : "transparent",
              color: on ? "var(--c-t1)" : "var(--c-t3)",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.12), inset 0 -2px 0 var(--c-signal)" : "none",
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px]" style={{ color: "var(--c-t2)" }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 cursor-pointer" style={{ accentColor: "var(--c-accent)" }} />
      {label}
    </label>
  );
}

function SubBlock({ icon, title, badge, open, onToggle, children }: {
  icon: string; title: string; badge?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--c-b1)" }}>
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-[var(--c-s3)] transition-colors">
        <Icon name="ChevronRight" size={11}
          style={{ color: "var(--c-t4)", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
        <Icon name={icon} size={12} style={{ color: "var(--c-t3)" }} />
        <span className="flex-1 text-[11px] font-medium" style={{ color: "var(--c-t2)" }}>{title}</span>
        {badge}
      </button>
      {open && <div className="px-2 pb-2 space-y-1.5">{children}</div>}
    </div>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone: "accent" | "purple" | "muted" | "red" | "green" }) {
  const c = tone === "accent" ? "var(--c-accent)" : tone === "purple" ? "var(--c-purple)"
    : tone === "red" ? "var(--c-red)" : tone === "green" ? "var(--c-green, #15803d)" : "var(--c-t4)";
  return (
    <span className="text-[9.5px] font-semibold px-1.5 rounded-full flex-shrink-0"
      style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{children}</span>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="text-[10px] leading-snug" style={{ color: "var(--c-t3)" }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium mb-0.5" style={{ color: "var(--c-t3)" }}>{label}</div>
      {children}
    </div>
  );
}

const inputCls = "w-full h-7 px-2 text-[11.5px] outline-none";
const inputStyle: React.CSSProperties = {
  color: "var(--c-t1)", border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)",
};

/** Числовое поле с подписью-единицей, как отметка Z во вкладке «Горизонты». */
function NumBox({ prefix, unit, value, step, min, onChange, width = "w-16" }: {
  prefix?: string; unit: string; value: number; step: number; min?: number; onChange: (v: number) => void; width?: string;
}) {
  return (
    <label className="flex items-stretch flex-shrink-0 overflow-hidden"
      style={{ border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)" }}>
      {prefix && <span className="px-1.5 flex items-center text-[10px]" style={{ color: "var(--c-t4)", background: "var(--c-s3)" }}>{prefix}</span>}
      <input type="number" value={value} step={step} min={min}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }}
        className={`font-num ${width} h-7 px-1.5 text-[11.5px] text-right outline-none bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
        style={{ color: "var(--c-t1)" }} />
      <span className="px-1.5 flex items-center text-[10px]" style={{ color: "var(--c-t4)", background: "var(--c-s3)" }}>{unit}</span>
    </label>
  );
}

function Marker({ pos, size = 20 }: { pos: Position; size?: number }) {
  return (
    <span className="flex-shrink-0 flex items-center justify-center rounded-full font-bold font-num relative"
      style={{
        width: size, height: size, background: pos.color, border: `2px solid ${pos.borderColor}`,
        color: "#000", fontSize: size * 0.45,
        boxShadow: pos.positionType === "reverse" ? "0 0 0 1.5px #fff, 0 0 0 3px #e53e3e" : undefined,
        opacity: pos.visible === false ? 0.4 : 1,
      }}>
      {pos.number}
    </span>
  );
}

// ─── Панель ────────────────────────────────────────────────────────────
export default function PositionsPanel(p: Props) {
  const {
    positions, branches, nodes, selectedPositionId, onSelect, onFocus, onAdd, onUpdate, onDelete,
    onPlaceMode, placeModeActive, branchBindMode, onToggleBranchBind, leaderDrawMode,
  } = p;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(["main"]));
  const isOpen = (block: string) => open.has(block);
  const toggle = (block: string) => setOpen(prev => {
    const n = new Set(prev);
    if (n.has(block)) n.delete(block); else n.add(block);
    return n;
  });

  const branchById = useMemo(() => new Map(branches.map(b => [b.id, b])), [branches]);
  const branchLabel = (id: string) => {
    const b = branchById.get(id);
    return b ? `${b.id}. ${b.type || "Ветвь"}` : `Ветвь ${id} (удалена)`;
  };

  // Номера, которые встречаются у нескольких позиций, — подсвечиваем в списке.
  const dupNumbers = useMemo(() => {
    const cnt = new Map<number, number>();
    for (const x of positions) cnt.set(x.number, (cnt.get(x.number) ?? 0) + 1);
    return new Set([...cnt].filter(([, n]) => n > 1).map(([k]) => k));
  }, [positions]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...positions]
      .filter(x => !q || String(x.number) === q || (x.name || "").toLowerCase().includes(q))
      .sort((a, b) => a.number - b.number);
  }, [positions, query]);

  const allVisible = positions.length > 0 && positions.every(x => x.visible !== false);

  // Выбранную позицию прокручиваем в видимую область (выбор с кнопки ленты или со схемы).
  const rowRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (selectedPositionId) rowRefs.current.get(selectedPositionId)?.scrollIntoView({ block: "nearest" });
  }, [selectedPositionId]);

  function addPosition() {
    const maxNum = positions.reduce((m, x) => Math.max(m, x.number), 0);
    const palette = POSITION_COLORS[positions.length % POSITION_COLORS.length];
    const pos = makePosition({ number: maxNum + 1, color: palette.color, borderColor: palette.border });
    onAdd(pos);
    onSelect(pos.id);
  }

  const confirmRemove = (pos: Position) => {
    if (window.confirm(`Удалить позицию № ${pos.number}${pos.name ? ` «${pos.name}»` : ""}?`)) {
      onDelete(pos.id);
      onSelect(null);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--c-s2)" }}>
      {/* ── Верх: действия со списком ── */}
      <div className="px-2 pt-2 pb-2 space-y-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-b1)" }}>
        <div className="flex gap-1">
          <Btn icon="Plus" grow onClick={addPosition}>Добавить позицию</Btn>
          <Btn icon={allVisible ? "EyeOff" : "Eye"} disabled={positions.length === 0}
            title={allVisible ? "Скрыть все маркеры позиций" : "Показать все маркеры позиций"}
            onClick={() => positions.forEach(x => onUpdate(x.id, { visible: !allVisible }))}>
            {allVisible ? "Скрыть все" : "Показать все"}
          </Btn>
        </div>
        {positions.length > 5 && (
          <div className="flex items-center gap-1.5 h-7 px-2" style={inputStyle}>
            <Icon name="Search" size={12} style={{ color: "var(--c-t4)" }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Номер или название позиции"
              className="flex-1 min-w-0 text-[11.5px] outline-none bg-transparent" style={{ color: "var(--c-t1)" }} />
            {query && <IconBtn icon="X" title="Очистить" onClick={() => setQuery("")} />}
          </div>
        )}

        {/* Активные режимы работы со схемой — общие с кнопкой «Позиция ПЛА» ленты */}
        {placeModeActive && (
          <ModeBanner icon="MapPin" tone="var(--c-accent)"
            text={selectedPositionId ? "Кликните на схеме, чтобы поставить маркер позиции" : "Выберите позицию в списке"}
            action="Отмена" onAction={onPlaceMode} />
        )}
        {branchBindMode && selectedPositionId && (
          <ModeBanner icon="Link" tone="var(--c-green, #15803d)"
            text="Привязка ветвей: кликайте по выработкам на схеме" action="Готово (F3)" onAction={() => onToggleBranchBind?.()} />
        )}
        {leaderDrawMode && (
          <ModeBanner icon="Spline" tone="var(--c-purple)"
            text="Выноска: кликните на ветви или на схеме · Esc — отмена" />
        )}
      </div>

      {/* ── Список ── */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-1 pb-0.5 flex items-center gap-1 text-[10px]" style={{ color: "var(--c-t4)" }}>
          <Icon name="MapPin" size={11} />
          <span className="flex-1">Позиции ПЛА · {positions.length}</span>
          <span>выработок</span>
        </div>

        {positions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Icon name="MapPinOff" size={24} style={{ color: "var(--c-t4)" }} />
            <span className="text-[11px]" style={{ color: "var(--c-t3)" }}>
              Позиций нет. Нажмите «Добавить позицию» или кнопку «Позиция ПЛА» на ленте.
            </span>
          </div>
        )}
        {positions.length > 0 && sorted.length === 0 && (
          <div className="px-1 py-2 text-[11px]" style={{ color: "var(--c-t3)" }}>Ничего не найдено</div>
        )}

        {sorted.map((pos) => {
          const expanded = pos.id === selectedPositionId;
          const visible = pos.visible !== false;
          const count = pos.branchIds.length;
          const isDup = dupNumbers.has(pos.number);
          const upd = (patch: Partial<Position>) => onUpdate(pos.id, patch);
          const hasLeader = pos.leaderBranchId != null || pos.leaderEndX != null;

          return (
            <section key={pos.id} ref={(el) => { if (el) rowRefs.current.set(pos.id, el); else rowRefs.current.delete(pos.id); }}
              className="rounded-md overflow-hidden transition-colors"
              style={{
                background: "var(--c-s1)",
                border: `1px solid ${expanded ? "var(--c-b3)" : "var(--c-b1)"}`,
                boxShadow: expanded ? "0 2px 6px -2px rgba(0,0,0,.15)" : undefined,
              }}>
              {/* ── Компактная строка ── */}
              <div role="button" tabIndex={0}
                onClick={() => onSelect(expanded ? null : pos.id)}
                onDoubleClick={() => { onSelect(pos.id); onFocus?.(pos); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(expanded ? null : pos.id); } }}
                title="Клик — свойства позиции · двойной клик — показать на схеме"
                className="flex items-center gap-1.5 pl-1 pr-1 h-8 cursor-pointer select-none transition-colors hover:bg-[var(--c-s3)]"
                style={{ background: expanded ? "var(--c-s3)" : undefined }}>
                <Icon name="ChevronRight" size={12} className="flex-shrink-0"
                  style={{ color: "var(--c-t4)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                <Marker pos={pos} />
                <span className="flex-1 min-w-0 truncate text-[11.5px] font-medium"
                  style={{ color: visible ? "var(--c-t1)" : "var(--c-t4)" }}>
                  {pos.name || <span style={{ color: "var(--c-t4)", fontWeight: 400 }}>Позиция {pos.number}</span>}
                </span>
                {isDup && <span title="Этот номер есть у нескольких позиций"><Pill tone="red">№ повтор</Pill></span>}
                {pos.isMineWide && <span title="Общешахтная позиция"><Pill tone="purple">общ.</Pill></span>}
                {!pos.placed && <span title="Маркер не поставлен на схему" className="flex items-center" style={{ color: "var(--c-amber, #a66b0d)" }}>
                  <Icon name="MapPinOff" size={11} /></span>}
                <span className="font-num text-[10px] px-1.5 rounded-full flex-shrink-0 min-w-[26px] text-center"
                  title={`Привязано выработок: ${count}`}
                  style={{
                    background: count > 0 ? "color-mix(in srgb, var(--c-accent) 14%, transparent)" : "var(--c-s3)",
                    color: count > 0 ? "var(--c-accent)" : "var(--c-t4)",
                  }}>{count}</span>
                <IconBtn icon="Crosshair" title="Показать на схеме" onClick={() => { onSelect(pos.id); onFocus?.(pos); }} />
                <IconBtn icon={visible ? "Eye" : "EyeOff"} active={visible}
                  title={visible ? "Скрыть маркер на схеме" : "Показать маркер на схеме"}
                  onClick={() => upd({ visible: !visible })} />
              </div>

              {expanded && (<>
                {/* ── Основное ── */}
                <div className="px-2 py-2 space-y-1.5" style={{ borderTop: "1px solid var(--c-b1)" }}>
                  <div className="flex items-center gap-1.5">
                    <NumBox prefix="№" unit="" value={pos.number} step={1} min={1} width="w-12"
                      onChange={(v) => upd({ number: Math.max(1, Math.round(v)) })} />
                    <input type="text" value={pos.name} onChange={(e) => upd({ name: e.target.value })}
                      placeholder="Название позиции" autoFocus={!pos.name}
                      className={`flex-1 min-w-0 ${inputCls}`} style={inputStyle} />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label="Вид аварии">
                      <select value={pos.accidentType}
                        onChange={(e) => upd({ accidentType: e.target.value as Position["accidentType"] })}
                        className={`${inputCls} cursor-pointer`} style={inputStyle}>
                        {ACCIDENT_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </Field>
                    <Field label="Режим проветривания">
                      <select value={pos.ventMode} onChange={(e) => upd({ ventMode: e.target.value })}
                        className={`${inputCls} cursor-pointer`} style={inputStyle}>
                        {VENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        {!VENT_MODES.includes(pos.ventMode) && <option value={pos.ventMode}>{pos.ventMode}</option>}
                      </select>
                    </Field>
                  </div>
                  <Seg value={pos.positionType} onChange={(v) => upd({ positionType: v })}
                    options={[{ value: "normal", label: "Безреверсивная" }, { value: "reverse", label: "Реверсивная" }]} />
                  <Field label="Сценарий">
                    <input type="text" value={pos.scenario} onChange={(e) => upd({ scenario: e.target.value })}
                      placeholder="Например: пожар в конвейерном штреке" className={inputCls} style={inputStyle} />
                  </Field>
                  <Check checked={pos.isMineWide} onChange={(v) => upd({ isMineWide: v })} label="Общешахтная позиция" />
                  <div className="flex gap-1">
                    <Btn grow icon="MapPin" active={placeModeActive}
                      title="Кликните на схеме, чтобы поставить маркер позиции"
                      onClick={onPlaceMode}>
                      {placeModeActive ? "Кликните на схеме…" : pos.placed ? "Переставить маркер" : "Поставить на схему"}
                    </Btn>
                    <Btn icon="Trash2" danger title="Удалить позицию" onClick={() => confirmRemove(pos)}>Удалить</Btn>
                  </div>
                </div>

                {/* ── Выработки позиции ── */}
                <SubBlock icon="Route" title="Выработки позиции" open={isOpen("branches")} onToggle={() => toggle("branches")}
                  badge={<Pill tone={count > 0 ? "accent" : "muted"}>{count}</Pill>}>
                  <Btn grow icon="Link" active={!!branchBindMode}
                    title="F3 — режим привязки: клик по выработке на схеме добавляет или убирает её"
                    onClick={() => onToggleBranchBind?.()}>
                    {branchBindMode ? "Привязка включена — кликайте по схеме (F3)" : "Привязать на схеме (F3)"}
                  </Btn>
                  {count === 0 ? <Hint>Выработки не привязаны — позиция не определяет, где действует.</Hint> : (
                    <div className="max-h-40 overflow-y-auto rounded" style={{ border: "1px solid var(--c-b1)" }}>
                      {pos.branchIds.map((bid) => (
                        <div key={bid} className="flex items-center gap-1 pl-2 pr-0.5 h-6" style={{ borderBottom: "1px solid var(--c-b1)" }}>
                          <span className="flex-1 truncate text-[11px]"
                            style={{ color: branchById.has(bid) ? "var(--c-t2)" : "var(--c-red)" }}>{branchLabel(bid)}</span>
                          <IconBtn icon="X" title="Отвязать выработку"
                            onClick={() => upd({ branchIds: pos.branchIds.filter((x) => x !== bid) })} />
                        </div>
                      ))}
                    </div>
                  )}
                  {pos.branchIds.some(id => !branchById.has(id)) && (
                    <Btn grow icon="Eraser" danger onClick={() => upd({ branchIds: pos.branchIds.filter(id => branchById.has(id)) })}>
                      Убрать удалённые выработки
                    </Btn>
                  )}
                  <select className={`${inputCls} cursor-pointer`} style={inputStyle} value=""
                    onChange={(e) => {
                      const branchId = e.target.value;
                      if (!branchId || pos.branchIds.includes(branchId)) return;
                      const newBranchIds = [...pos.branchIds, branchId];
                      // Позицию, ещё не поставленную на схему, ставим у выработки.
                      const br = branchById.get(branchId);
                      const fromN = br ? nodes.find(n => n.id === br.fromId) : undefined;
                      const toN = br ? nodes.find(n => n.id === br.toId) : undefined;
                      const refN = fromN && toN ? (fromN.z >= toN.z ? fromN : toN) : (fromN ?? toN);
                      if (refN && (!pos.placed || pos.z === 0)) {
                        upd({ branchIds: newBranchIds, x: refN.x + 50, y: refN.y + 50, z: refN.z, placed: true });
                      } else {
                        upd({ branchIds: newBranchIds });
                      }
                    }}>
                    <option value="">+ Добавить выработку из списка…</option>
                    {branches.filter((b) => !pos.branchIds.includes(b.id)).map((b) => (
                      <option key={b.id} value={b.id}>{b.id}. {b.type || "Ветвь"}</option>
                    ))}
                  </select>
                </SubBlock>

                {/* ── Мероприятия ── */}
                <SubBlock icon="ListChecks" title="Мероприятия" open={isOpen("actions")} onToggle={() => toggle("actions")}
                  badge={pos.comment ? <Pill tone="accent">есть</Pill> : undefined}>
                  <textarea value={pos.comment ?? ""} onChange={(e) => upd({ comment: e.target.value })}
                    placeholder="Действия по позиции: что и в каком порядке выполнить"
                    rows={pos.comment ? 8 : 3}
                    className="w-full px-2 py-1 text-[11.5px] outline-none resize-y leading-snug" style={inputStyle} />
                  <Hint>Этот текст уходит в оперативную часть ПЛА. Подбор режима при пожаре заполняет его сам — дополните местными особенностями.</Hint>
                </SubBlock>

                {/* ── Маркер ── */}
                <SubBlock icon="Palette" title="Маркер на схеме" open={isOpen("marker")} onToggle={() => toggle("marker")}
                  badge={<Marker pos={pos} size={14} />}>
                  <div className="flex flex-wrap gap-1">
                    {POSITION_COLORS.map(c => {
                      const on = c.color.toLowerCase() === pos.color.toLowerCase();
                      return (
                        <button key={c.color} type="button" title={c.label}
                          onClick={() => upd({ color: c.color, borderColor: c.border })}
                          className="w-5 h-5 rounded-full"
                          style={{ background: c.color, border: `2px solid ${c.border}`, outline: on ? "2px solid var(--c-accent)" : "none", outlineOffset: 1 }} />
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label="Фон">
                      <ColorBox value={pos.color} onChange={(v) => upd({ color: v })} />
                    </Field>
                    <Field label="Граница">
                      <ColorBox value={pos.borderColor} onChange={(v) => upd({ borderColor: v })} />
                    </Field>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <NumBox prefix="⌀" unit="мм" value={pos.diameter} step={0.5} min={0.1}
                      onChange={(v) => upd({ diameter: v > 0 ? v : 13 })} />
                    <NumBox prefix="Выноска" unit="мм" value={pos.leaderThickness} step={0.01} min={0.02}
                      onChange={(v) => upd({ leaderThickness: v > 0 ? v : 0.02 })} />
                  </div>
                  <Field label="Шрифт номера (экспорт в АэроСеть)">
                    <select value={pos.font} onChange={(e) => upd({ font: e.target.value })}
                      className={`${inputCls} cursor-pointer`} style={inputStyle}>
                      {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                      {!FONT_OPTIONS.includes(pos.font) && <option value={pos.font}>{pos.font}</option>}
                    </select>
                  </Field>
                </SubBlock>

                {/* ── Выноска ── */}
                <SubBlock icon="Spline" title="Выноска" open={isOpen("leader")} onToggle={() => toggle("leader")}
                  badge={<Pill tone={hasLeader ? "accent" : "muted"}>{hasLeader ? `${1 + (pos.extraLeaders?.length ?? 0)}` : "нет"}</Pill>}>
                  {leaderDrawMode === pos.id ? (
                    <Hint>Кликните на ветви или на схеме. Привязка к ветви — автоматически. Esc — отмена.</Hint>
                  ) : hasLeader ? (
                    <LeaderRow
                      title={pos.leaderBranchId ? "Основная — к выработке" : "Основная — свободная точка"}
                      value={pos.leaderBranchId ? branchLabel(pos.leaderBranchId)
                        : `X ${Math.round(pos.leaderEndX ?? 0)} · Y ${Math.round(pos.leaderEndY ?? 0)} м`}
                      onMove={() => p.onStartLeaderDraw?.(pos.id)}
                      onRemove={() => p.onRemoveLeader?.(pos.id)} />
                  ) : (
                    <Btn grow icon="CirclePlus" onClick={() => p.onStartLeaderDraw?.(pos.id)}>Добавить выноску</Btn>
                  )}
                  {hasLeader && leaderDrawMode !== pos.id && (<>
                    {(pos.extraLeaders ?? []).map((el, i) => (
                      <LeaderRow key={el.id} title={`Дублирующая ${i + 1}`}
                        value={el.branchId ? branchLabel(el.branchId) : `X ${Math.round(el.endX ?? 0)} · Y ${Math.round(el.endY ?? 0)} м`}
                        onRemove={() => p.onRemoveExtraLeader?.(pos.id, el.id)} />
                    ))}
                    <Btn grow icon="Plus" onClick={() => p.onStartExtraLeaderDraw?.(pos.id)}>Дублирующая выноска</Btn>
                  </>)}
                </SubBlock>

                {/* ── Координаты ── */}
                <SubBlock icon="Crosshair" title="Координаты маркера" open={isOpen("coords")} onToggle={() => toggle("coords")}
                  badge={pos.placed ? undefined : <Pill tone="muted">не на схеме</Pill>}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <NumBox prefix="X" unit="м" value={Math.round(pos.x)} step={1} onChange={(v) => upd({ x: v, placed: true })} />
                    <NumBox prefix="Y" unit="м" value={Math.round(pos.y)} step={1} onChange={(v) => upd({ y: v, placed: true })} />
                    <NumBox prefix="Z" unit="м" value={Math.round(pos.z ?? 0)} step={1} onChange={(v) => upd({ z: v })} />
                  </div>
                  <Hint>Отметка Z нужна, чтобы маркер стоял на своём горизонте в изометрии и при печати по горизонтам.</Hint>
                </SubBlock>

                {/* ── Файл ── */}
                <SubBlock icon="Paperclip" title="Документ оперативной части" open={isOpen("file")} onToggle={() => toggle("file")}
                  badge={pos.attachedFile ? <Pill tone="accent">есть</Pill> : undefined}>
                  <AttachedFile pos={pos} upd={upd} />
                </SubBlock>
              </>)}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ModeBanner({ icon, tone, text, action, onAction }: {
  icon: string; tone: string; text: string; action?: string; onAction?: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10.5px]"
      style={{ background: `color-mix(in srgb, ${tone} 12%, transparent)`, color: tone, border: `1px solid color-mix(in srgb, ${tone} 35%, transparent)` }}>
      <Icon name={icon} size={12} className="flex-shrink-0" />
      <span className="flex-1 leading-snug">{text}</span>
      {action && (
        <button type="button" onClick={onAction} className="font-semibold underline flex-shrink-0" style={{ color: tone }}>{action}</button>
      )}
    </div>
  );
}

function ColorBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 h-7 px-1 cursor-pointer" style={inputStyle}>
      <span className="w-5 h-5 rounded flex-shrink-0 relative overflow-hidden" style={{ background: value, border: "1px solid rgba(0,0,0,.25)" }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
      </span>
      <span className="font-num text-[10.5px] uppercase" style={{ color: "var(--c-t3)" }}>{value}</span>
    </label>
  );
}

function LeaderRow({ title, value, onMove, onRemove }: {
  title: string; value: string; onMove?: () => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1 pl-2 pr-0.5 py-1 rounded" style={{ border: "1px solid var(--c-b1)", background: "var(--c-s2)" }}>
      <div className="flex-1 min-w-0">
        <div className="text-[10px]" style={{ color: "var(--c-t4)" }}>{title}</div>
        <div className="text-[11px] truncate" style={{ color: "var(--c-t2)" }}>{value}</div>
      </div>
      {onMove && <IconBtn icon="Move" title="Переместить конец выноски" onClick={onMove} />}
      <IconBtn icon="X" danger title="Удалить выноску" onClick={onRemove} />
    </div>
  );
}

/** Документ оперативной части: прикрепить, скачать, открыть. */
function AttachedFile({ pos, upd }: { pos: Position; upd: (patch: Partial<Position>) => void }) {
  if (!pos.attachedFile) {
    return (
      <label className="h-7 px-2 flex items-center justify-center gap-1 text-[11px] font-medium rounded cursor-pointer hover:bg-[var(--c-s3)]"
        style={{ border: "1px dashed var(--c-b2)", color: "var(--c-t2)" }}>
        <Icon name="Upload" size={12} />
        Прикрепить файл
        <input type="file" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = (ev) => upd({ attachedFile: f.name, attachedFileData: (ev.target?.result as string) ?? "", attachedFileMime: f.type });
          reader.readAsDataURL(f);
          e.target.value = "";
        }} />
      </label>
    );
  }
  const canView = pos.attachedFileMime.startsWith("image/") || pos.attachedFileMime === "application/pdf"
    || pos.attachedFileMime.startsWith("text/");
  const open = () => {
    if (!pos.attachedFileData) return;
    // Открываем через Blob — прямой переход на data: URL браузеры блокируют,
    // а document.write в пустое окно ломался на больших PDF.
    fetch(pos.attachedFileData).then(r => r.blob()).then(blob => {
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }).catch(() => { /* повреждённые данные файла */ });
  };
  const download = () => {
    if (!pos.attachedFileData) return;
    const a = document.createElement("a");
    a.href = pos.attachedFileData;
    a.download = pos.attachedFile;
    a.click();
  };
  return (
    <>
      <div className="flex items-center gap-1.5 pl-2 pr-0.5 h-7 rounded" style={{ border: "1px solid var(--c-b1)", background: "var(--c-s2)" }}>
        <Icon name="FileText" size={12} style={{ color: "var(--c-t3)" }} />
        <span className="flex-1 min-w-0 truncate text-[11px]" style={{ color: "var(--c-t2)" }} title={pos.attachedFile}>{pos.attachedFile}</span>
        <IconBtn icon="X" danger title="Открепить файл" onClick={() => upd({ attachedFile: "", attachedFileData: "", attachedFileMime: "" })} />
      </div>
      <div className="flex gap-1">
        <Btn grow icon="Download" onClick={download}>Скачать</Btn>
        {canView && <Btn grow icon="Eye" onClick={open}>Открыть</Btn>}
      </div>
    </>
  );
}
