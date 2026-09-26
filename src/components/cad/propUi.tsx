// Общие элементы оформления панелей свойств (вкладки «Общие», «Топология»).
//
// Карточки с иконкой-маркером, подписи над полями, переключатели вместо
// «виндовых» галочек. Все цвета — из палитры темы (--c-accent / --c-signal,
// --c-s*, --c-b*, --c-t*), поэтому панели одинаково читаются в светлой и
// тёмной теме.
import { useState, type ReactNode } from "react";
import Icon from "@/components/ui/icon";

export const inputCls =
  "w-full h-7 px-2 text-xs rounded outline-none transition-colors focus:ring-2";

export const inputStyle: React.CSSProperties = {
  background: "var(--c-s1, #fff)",
  border: "1px solid var(--c-b2, #d5d1c8)",
  color: "var(--c-t1, #1f2328)",
  fontFamily: "var(--font-ui)",
  // цвет кольца фокуса для focus:ring
  ["--tw-ring-color" as string]: "color-mix(in srgb, var(--c-accent, #1e5a7a) 25%, transparent)",
};

export function Card({ icon, title, tone = "accent", aside, collapsible, defaultOpen = true, children }: {
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

/** Поле с подписью сверху. aside — элемент справа от подписи (переключатель режима и т. п.). */
export function Field({ label, hint, aside, children }: {
  label: string; hint?: ReactNode; aside?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="block min-w-0">
      <div className="flex items-center gap-1 mb-0.5 min-h-[14px]">
        <span className="flex-1 text-[10px] font-medium truncate" style={{ color: "var(--c-t3, #6b7280)" }}>{label}</span>
        {aside}
      </div>
      {children}
      {hint && <span className="block text-[10px] mt-0.5 leading-snug" style={{ color: "var(--c-t4, #767f8c)" }}>{hint}</span>}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, kbd }: {
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

/**
 * Числовое поле. Принимает запятую как десятичный разделитель и не мешает
 * набирать промежуточные значения («0,», «-»): пока поле в фокусе, в нём
 * стоит то, что набрано, а наружу уходят только целые числа.
 */
export function NumInput({ value, onChange, step, min, max, unit, placeholder }: {
  value: number | undefined; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; unit?: string; placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value !== undefined && Number.isFinite(value) ? String(value) : "");
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <div className="flex items-center rounded overflow-hidden h-7"
      style={{ border: "1px solid var(--c-b2, #d5d1c8)", background: "var(--c-s1, #fff)" }}>
      <input type="text" inputMode="decimal" value={shown} placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseFloat(e.target.value.replace(",", "."));
          if (Number.isFinite(v)) onChange(clamp(v));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (!step || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          const base = value ?? 0;
          const next = +(base + (e.key === "ArrowUp" ? step : -step)).toFixed(6);
          setDraft(null);
          onChange(clamp(next));
        }}
        className="flex-1 min-w-0 h-full px-2 text-xs text-right outline-none"
        style={{ background: "transparent", border: "none", color: "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)" }} />
      {unit && (
        <span className="pr-2 text-[10px] flex-shrink-0" style={{ color: "var(--c-t4, #767f8c)" }}>{unit}</span>
      )}
    </div>
  );
}

/** Значение, которое считается программой (не редактируется). */
export function ReadValue({ value, unit, danger, title }: {
  value: string; unit?: string; danger?: boolean; title?: string;
}) {
  return (
    <div className="flex items-center h-7 px-2 rounded text-xs"
      title={title ?? "Считается программой"}
      style={{
        background: "var(--c-s3, #f1efea)",
        color: danger ? "var(--c-red, #dc2626)" : "var(--c-t2, #3a3f45)",
        fontFamily: "var(--font-num)",
      }}>
      <span className="flex-1 text-right truncate">{value}</span>
      {unit && <span className="pl-1 text-[10px]" style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-ui)" }}>{unit}</span>}
    </div>
  );
}

/** Сегментный переключатель из 2–4 вариантов. */
export function Segmented<T extends string>({ value, options, onChange, size = "md" }: {
  value: T; options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void; size?: "sm" | "md";
}) {
  return (
    <div className="flex p-0.5 rounded" style={{ background: "var(--c-s3, #f1efea)" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} title={o.title}
            className={`flex-1 rounded transition-colors ${size === "sm" ? "h-4 px-1.5 text-[9px]" : "h-6 px-2 text-[11px]"}`}
            style={{
              border: "none", cursor: "pointer",
              background: on ? "var(--c-s1, #fff)" : "transparent",
              color: on ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)",
              fontWeight: on ? 600 : 400,
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none",
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Крупный показатель — плитка «подпись / число / единица». */
export function Stat({ label, value, unit, danger, hint }: {
  label: string; value: string; unit?: string; danger?: boolean; hint?: string;
}) {
  return (
    <div className="rounded-md px-2 py-1.5 min-w-0"
      title={hint}
      style={{
        background: danger ? "var(--c-tint-red, #fef2f2)" : "var(--c-s2, #f8f7f4)",
        border: `1px solid ${danger ? "color-mix(in srgb, var(--c-red, #dc2626) 35%, transparent)" : "var(--c-b1, #e7e4dd)"}`,
      }}>
      <div className="text-[10px] truncate" style={{ color: "var(--c-t3, #6b7280)" }}>{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-sm font-semibold truncate"
          style={{ color: danger ? "var(--c-red, #dc2626)" : "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)" }}>
          {value}
        </span>
        {unit && <span className="text-[10px]" style={{ color: "var(--c-t4, #767f8c)" }}>{unit}</span>}
      </div>
    </div>
  );
}

/** Строка «подпись … значение» для второстепенных расчётных величин. */
export function KV({ label, value, unit, danger, title }: {
  label: string; value: string; unit?: string; danger?: boolean; title?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5 text-[11px]" title={title}
      style={{ borderBottom: "1px dashed var(--c-b1, #e7e4dd)" }}>
      <span className="flex-1 min-w-0 truncate" style={{ color: "var(--c-t3, #6b7280)" }}>{label}</span>
      <span style={{ color: danger ? "var(--c-red, #dc2626)" : "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)" }}>{value}</span>
      {unit && <span className="text-[10px] w-14 text-left" style={{ color: "var(--c-t4, #767f8c)" }}>{unit}</span>}
    </div>
  );
}
