// ─────────────────────────────────────────────────────────────────────────────
// printUi.tsx — элементы оформления окна печати в стиле темы программы
// (те же приёмы, что в окне «Параметры расчёта»: переменные --c-*, тёмная
// шапка с янтарной полосой, сегментные переключатели, поля с единицами).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, type ReactNode } from "react";
import Icon from "@/components/ui/icon";

/** Сворачиваемый блок настроек с иконкой. */
export function PSection({ icon, title, summary, defaultOpen = true, children }: {
  icon: string; title: string; summary?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: "1px solid var(--c-b1)" }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-[var(--c-s3)] transition-colors">
        <Icon name={icon} size={13} style={{ color: "var(--c-t3)" }} />
        <span className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: "var(--c-t2)" }}>{title}</span>
        {!open && summary && (
          <span className="flex-1 text-right text-[10px] truncate" style={{ color: "var(--c-t4)" }}>{summary}</span>
        )}
        <Icon name="ChevronDown" size={12} className="shrink-0 transition-transform"
          style={{ color: "var(--c-t4)", marginLeft: open || !summary ? "auto" : 4, transform: open ? "none" : "rotate(-90deg)" }} />
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

/** Сегментный переключатель (2–5 вариантов). */
export function PSegmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string; icon?: string; title?: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-0.5 p-0.5" style={{
      gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      background: "var(--c-s3)", border: "1px solid var(--c-b2)", borderRadius: 6,
    }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} title={o.title}
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

/** Числовое поле с подписью сверху и единицами справа. */
export function PField({ label, unit, value, onChange, step, min, max, hint }: {
  label?: string; unit?: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; hint?: string;
}) {
  return (
    <label className="block min-w-0" title={hint}>
      {label && <span className="block text-[10px] mb-0.5 truncate" style={{ color: "var(--c-t3)" }}>{label}</span>}
      <span className="flex items-stretch overflow-hidden"
        style={{ border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)" }}>
        <input type="number" value={value} step={step} min={min} max={max}
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="font-num w-full min-w-0 text-[12px] px-2 py-1 text-right outline-none bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          style={{ color: "var(--c-t1)" }} />
        {unit && (
          <span className="flex items-center px-1.5 text-[10px] shrink-0 whitespace-nowrap"
            style={{ color: "var(--c-t3)", background: "var(--c-s3)", borderLeft: "1px solid var(--c-b1)" }}>
            {unit}
          </span>
        )}
      </span>
    </label>
  );
}

/** Выпадающий список в стиле темы. */
export function PSelect({ value, onChange, children, title }: {
  value: string; onChange: (v: string) => void; children: ReactNode; title?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} title={title}
      className="w-full text-[11.5px] px-1.5 py-1 outline-none cursor-pointer"
      style={{ border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)", color: "var(--c-t1)" }}>
      {children}
    </select>
  );
}

/** Переключатель-галочка в виде строки. */
export function PCheck({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 cursor-pointer" style={{ accentColor: "var(--c-accent)" }} />
      <span className="text-[11.5px]" style={{ color: "var(--c-t2)" }}>{label}</span>
    </label>
  );
}

/** Второстепенная кнопка. */
export function PButton({ icon, children, onClick, disabled, danger, title, className = "" }: {
  icon?: string; children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; title?: string; className?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`flex items-center justify-center gap-1 text-[11px] font-medium px-2 py-1 transition-colors hover:bg-[var(--c-s3)] disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      style={{
        border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)",
        color: danger ? "var(--c-red)" : "var(--c-t2)",
      }}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </button>
  );
}

/** Подсказка. */
export function PNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" }) {
  const ok = tone === "ok";
  return (
    <div className="text-[10px] leading-snug px-2 py-1.5 flex gap-1.5" style={{
      borderRadius: 4,
      color: ok ? "var(--c-green)" : "var(--c-t3)",
      background: ok ? "var(--c-tint-green)" : "var(--c-s2)",
      border: `1px solid ${ok ? "var(--c-tint-green2)" : "var(--c-b1)"}`,
    }}>
      <Icon name={ok ? "CircleCheck" : "Info"} size={11} className="shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}

/** Шапка окна: антрацит + янтарная полоса. Возвращает props для перетаскивания снаружи. */
export function PHeader({ icon, title, subtitle, onClose, right, dragProps }: {
  icon: string; title: string; subtitle?: string; onClose: () => void; right?: ReactNode;
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div {...dragProps}
      className="flex items-center gap-2 px-3 py-2 shrink-0 select-none"
      style={{
        background: "var(--c-anthracite)", borderBottom: "2px solid var(--c-signal)",
        cursor: dragProps ? "move" : undefined, ...(dragProps?.style ?? {}),
      }}>
      <Icon name={icon} size={15} style={{ color: "var(--c-signal-lt)" }} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-bold text-white leading-tight truncate">{title}</div>
        {subtitle && <div className="text-[9.5px] leading-tight truncate" style={{ color: "#aab1ba" }}>{subtitle}</div>}
      </div>
      {right}
      <button type="button" onClick={onClose} title="Закрыть (Esc)"
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10" style={{ color: "#c8cdd3" }}>
        <Icon name="X" size={14} />
      </button>
    </div>
  );
}
