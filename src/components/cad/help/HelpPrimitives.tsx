import { isValidElement, type ReactNode } from "react";
import Icon from "@/components/ui/icon";

// ── Вспомогательные мини-компоненты руководства ─────────────────────────────
// Оформлены в фирменной гамме программы (антрацит + сигнальный янтарь),
// стили — классы .help-* в src/index.css.

export interface Section {
  id: string;
  icon: string;
  title: string;
  content: React.ReactNode;
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="help-h3">{children}</h3>;
}

export function Li({ children, icon, color }: { children: React.ReactNode; icon: string; color: string }) {
  return (
    <li className="flex items-start gap-2 text-[12px] text-gray-700">
      <Icon name={icon as Parameters<typeof Icon>[0]["name"]} size={14}
        style={{ color, flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </li>
  );
}

// Старые пастельные цвета блоков → подложка и акцент из переменных темы:
// так блоки одинаково читаются и в светлой, и в тёмной теме.
const BLOCK_TONES: Record<string, { bg: string; accent: string }> = {
  "#d7e7ee": { bg: "var(--c-tint-blue, #eef5f8)",   accent: "var(--c-blue, #1e5a7a)" },
  "#dcfce7": { bg: "var(--c-tint-green, #f0fdf4)",  accent: "var(--c-green, #15803d)" },
  "#fef9c3": { bg: "var(--c-tint-amber, #fffbeb)",  accent: "#e8a317" },
  "#fce7f3": { bg: "var(--c-tint-red, #fef2f2)",    accent: "var(--c-red, #dc2626)" },
  "#f3e8ff": { bg: "var(--c-tint-purple, #f3e8ff)", accent: "var(--c-purple, #7c3aed)" },
};

export function Block({ title, children, color }: { title: string; children: React.ReactNode; color: string }) {
  const tone = BLOCK_TONES[color.toLowerCase()] ?? { bg: "var(--c-s2, #f8f7f4)", accent: "var(--c-b3, #b9b4a9)" };
  return (
    <div className="p-3 rounded-lg text-[12px] text-gray-700 leading-relaxed"
      style={{ background: tone.bg, border: "1px solid var(--c-b1, #e7e4dd)", borderTop: `2px solid ${tone.accent}` }}>
      <div className="font-semibold text-gray-800 mb-1">{title}</div>
      {children}
    </div>
  );
}

export function KBD({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold"
      style={{ background: "var(--c-s3, #f3f4f6)", border: "1px solid var(--c-b2, #d1d5db)", color: "var(--c-t2, #374151)", boxShadow: "0 1px 0 var(--c-b3, #9ca3af)" }}>
      {children}
    </kbd>
  );
}

export function QStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <div className="help-step-n">{n}</div>
      <div className="text-[12px] text-gray-700 leading-relaxed pt-0.5">
        <div className="font-semibold text-gray-800">{title}</div>
        <div>{children}</div>
      </div>
    </li>
  );
}

type NoteTone = "info" | "tip" | "warn" | "danger";
const NOTE_ICON: Record<NoteTone, string> = {
  info: "Info", tip: "Lightbulb", warn: "TriangleAlert", danger: "OctagonAlert",
};

/** Выделенная заметка: пояснение, совет, предупреждение или опасность. */
export function Note({ tone = "info", children }: { tone?: NoteTone; children: React.ReactNode }) {
  return (
    <div className="help-note" data-tone={tone}>
      <Icon name={NOTE_ICON[tone] as Parameters<typeof Icon>[0]["name"]} size={14} className="help-note-ico" />
      <div>{children}</div>
    </div>
  );
}

/** Весь текст узла JSX — для поиска по руководству. */
export function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; title?: unknown };
    const own = typeof props.title === "string" ? props.title + " " : "";
    return own + nodeText(props.children);
  }
  return "";
}