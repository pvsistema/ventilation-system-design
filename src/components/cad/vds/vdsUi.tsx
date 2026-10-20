import type { ReactNode } from "react";
import Icon from "@/components/ui/icon";

export const C = {
  s1: "var(--c-s1, #fff)",
  s2: "var(--c-s2, #f9fafb)",
  b1: "var(--c-b1, #e5e7eb)",
  b2: "var(--c-b2, #d1d5db)",
  t1: "var(--c-t1, #111827)",
  t2: "var(--c-t2, #374151)",
  t3: "var(--c-t3, #6b7280)",
  t4: "var(--c-t4, #9ca3af)",
  accent: "var(--c-accent, #1e5a7a)",
  tintBlue: "var(--c-tint-blue, #eef5f8)",
  tintBlue2: "var(--c-tint-blue2, #d7e7ee)",
  green: "var(--c-green, #16a34a)",
  red: "var(--c-red, #dc2626)",
  amber: "var(--c-amber, #d97706)",
};

export const INP = "w-full min-w-0 text-[12px] px-2 py-1 rounded-md outline-none tabular-nums";
export const INP_STYLE = { background: C.s1, border: `1px solid ${C.b2}`, color: C.t1 };

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-0.5 min-w-0" title={hint}>
      <span className="text-[10.5px] truncate" style={{ color: C.t3 }}>{label}</span>
      {children}
    </label>
  );
}

export function Info({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex cursor-help align-middle" style={{ color: C.t4 }}>
      <Icon name="Info" size={13} />
    </span>
  );
}

export function Card({ title, icon, children, right }: { title: string; icon?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded-lg" style={{ background: C.s1, border: `1px solid ${C.b1}` }}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5" style={{ borderBottom: `1px solid ${C.b1}` }}>
        {icon && <Icon name={icon} size={12} style={{ color: C.accent }} />}
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: C.t3 }}>{title}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="px-2.5 py-1.5">{children}</div>
    </div>
  );
}

export function Row({ k, v, color, bold }: { k: ReactNode; v: ReactNode; color?: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 py-[2px] text-[11.5px]">
      <span className="truncate" style={{ color: C.t3 }}>{k}</span>
      <span className="ml-auto text-right tabular-nums whitespace-nowrap" style={{ color: color ?? C.t1, fontWeight: bold ? 700 : 500 }}>{v}</span>
    </div>
  );
}

export function Kpi({ label, value, unit, sub, tone = "accent" }: {
  label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode; tone?: "accent" | "green" | "red" | "amber" | "neutral";
}) {
  const col = tone === "green" ? C.green : tone === "red" ? C.red : tone === "amber" ? C.amber : tone === "neutral" ? C.t1 : C.accent;
  return (
    <div className="rounded-lg px-2.5 py-1.5 min-w-0" style={{ background: C.s1, border: `1px solid ${C.b1}`, borderTop: `2.5px solid ${col}` }}>
      <div className="text-[10.5px] truncate" style={{ color: C.t3 }}>{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-[18px] font-bold leading-tight tabular-nums" style={{ color: col }}>{value}</span>
        {unit && <span className="text-[11px]" style={{ color: C.t3 }}>{unit}</span>}
      </div>
      {sub && <div className="text-[10.5px] truncate" style={{ color: C.t3 }}>{sub}</div>}
    </div>
  );
}

export function Note({ tone, children }: { tone: "amber" | "red" | "green"; children: ReactNode }) {
  const s = tone === "amber"
    ? { background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fde68a", color: "var(--c-amber-ink, #92400e)" }
    : tone === "red"
      ? { background: "var(--c-tint-red, #fef2f2)", border: "1px solid #fecaca", color: "var(--c-red-ink, #b91c1c)" }
      : { background: "var(--c-tint-green, #f0fdf4)", border: "1px solid #bbf7d0", color: "var(--c-green-ink, #166534)" };
  const icon = tone === "green" ? "CheckCircle2" : tone === "red" ? "XCircle" : "AlertTriangle";
  return (
    <div className="flex items-start gap-1.5 text-[11px] px-2 py-1 rounded-md leading-snug" style={s}>
      <Icon name={icon} size={12} className="mt-[1px] shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function MiniBtn({ onClick, title, active, children }: { onClick: () => void; title?: string; active?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded-md hover:brightness-95"
      style={active
        ? { background: C.tintBlue, border: `1px solid ${C.accent}`, color: C.accent }
        : { background: C.s1, border: `1px solid ${C.b2}`, color: C.t2 }}>
      {children}
    </button>
  );
}
