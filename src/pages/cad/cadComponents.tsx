import React from "react";
import Icon from "@/components/ui/icon";
import type { TopoNode, TopoBranch } from "@/lib/topology";
import type { ContextMenuItem } from "@/components/cad/CadContextMenu";
import type { CadTool } from "@/components/cad/TopoCanvas";
import type { ViewPresetName } from "./cadTypes";

// ─── Пункты контекстного меню ───────────────────────────────────────────────

export function nodeContextItems(node: TopoNode | null, multiNodeCount: number): ContextMenuItem[] {
  const canAlign = multiNodeCount >= 2;
  return [
    { id: "open_props", label: "Свойства узла...", icon: "Settings", shortcut: "Ctrl+J" },
    { id: "div1", label: "", divider: true },
    { id: "toggle_atmosphere", label: node?.atmosphereLink ? "Снять связь с атмосферой" : "Поверхностный узел (атмосфера)", icon: "Wind" },
    { id: "split_connections", label: "Разорвать связь в узле", icon: "Scissors" },
    { id: "merge_nodes", label: multiNodeCount >= 2 ? `Соединить узлы (${multiNodeCount})` : "Соединить узлы", icon: "GitMerge", disabled: multiNodeCount < 2 },
    { id: "div2", label: "", divider: true },
    { id: "align_left",     label: "Выровнить по левому краю",    icon: "AlignStartHorizontal", disabled: !canAlign },
    { id: "align_right",    label: "Выровнить по правому краю",   icon: "AlignEndHorizontal",   disabled: !canAlign },
    { id: "align_center_x", label: "Выровнить по центру (гориз.)",icon: "AlignCenterHorizontal", disabled: !canAlign },
    { id: "align_top",      label: "Выровнить по верхнему краю",  icon: "AlignStartVertical",   disabled: !canAlign },
    { id: "align_bottom",   label: "Выровнить по нижнему краю",   icon: "AlignEndVertical",     disabled: !canAlign },
    { id: "align_center_y", label: "Выровнить по центру (верт.)", icon: "AlignCenterVertical",  disabled: !canAlign },
    { id: "div3", label: "", divider: true },
    { id: "delete_node", label: "Удалить", icon: "Trash2", shortcut: "Del", danger: true },
  ];
}

export function branchContextItems(branch: TopoBranch | null, hasBuffer: boolean, multiCount: number): ContextMenuItem[] {
  const multi = multiCount > 1;
  return [
    {
      id: "open_props",
      label: multi ? `Свойства выделенных (${multiCount} ветв.)...` : "Свойства ветви...",
      icon: "Settings", shortcut: "Ctrl+J",
    },
    { id: "div1", label: "", divider: true },
    { id: "copy_branch_params", label: "Копировать параметры ветви", icon: "Copy", shortcut: "Alt+C", disabled: multi },
    { id: "paste_branch_params", label: multi
        ? `Применить к выделенным (${multiCount} ветв.)`
        : "Применить параметры...", icon: "ClipboardPaste", disabled: !hasBuffer },
    { id: "div2", label: "", divider: true },
    {
      id: "toggle_capital",
      label: multi
        ? "Капитальная ветвь (всем выбранным)"
        : (branch?.capital ? "Снять Капитальная" : "Капитальная ветвь"),
      icon: "Star",
    },
    {
      id: "toggle_designed",
      label: multi
        ? "Проектируемая ветвь (всем выбранным)"
        : (branch?.designed ? "Снять Проектируемая" : "Проектируемая ветвь"),
      icon: "Pencil",
    },
    { id: "reverse_branch", label: "Развернуть ветвь", icon: "ArrowLeftRight", shortcut: "Ctrl+R", disabled: multi },
    { id: "div3", label: "", divider: true },
    {
      id: "add_vent_pipe",
      label: multi
        ? `+ Вентрубопровод (${multiCount} ветв.)`
        : (branch?.hasVentPipe ? "✎ Вентрубопровод (изменить)" : "+ Вентрубопровод"),
      icon: "Wind",
    },
    // Операции над ВСЕМ ставом: показываем только когда клик пришёлся на его
    // ветвь. Иначе пришлось бы выделять сегменты по одному, как было раньше.
    ...(branch?.isVentPipeBranch ? [
      {
        id: "edit_vent_pipe_line",
        label: "✎ Изменить весь став (диаметр, марка, стыки)",
        icon: "Settings2",
      },
      {
        id: "delete_vent_pipe_line",
        label: "Удалить весь став",
        icon: "Trash2",
        danger: true,
      },
    ] : []),
    { id: "align_distribute", label: "Выровнять и распределить ▶", icon: "AlignCenter", disabled: true },
    { id: "div4", label: "", divider: true },
    {
      id: "delete_branch",
      label: multi ? `Удалить (${multiCount} ветв.)` : "Удалить",
      icon: "Trash2", shortcut: "Del", danger: true,
    },
  ];
}

export function canvasContextItems(): ContextMenuItem[] {
  return [
    { id: "add_node", label: "Добавить узел", icon: "PlusCircle" },
  ];
}

// ─── Ribbon-компоненты ──────────────────────────────────────────────────────

/**
 * Единая ширина главных вкладок ленты (Файл … Помощь) — по самой длинной
 * («Справочники», в том числе в полужирном начертании активной вкладки),
 * чтобы вкладки не «прыгали» при переключении и стояли ровной линейкой.
 */
const RIBBON_TAB_W = 96;

export function RibbonTabBtn({ label, active, onClick, fileStyle, highlight, title }: {
  label: string; active: boolean; onClick: () => void; fileStyle?: boolean; highlight?: boolean; title?: string;
}) {
  // Вкладки — светлый текст на антрацитовой шапке. Активная отмечается
  // янтарной полосой снизу (3 px), а не «ушком» с рамкой, как в Office.
  // «Файл» — янтарная кнопка-меню. Стили — классы .tab-* в index.css.
  return (
    <button onClick={onClick} title={title}
      data-active={active ? "1" : undefined}
      className={`${fileStyle ? "tab-file" : "tab-btn"} ${highlight ? "tab-hl" : ""} h-full text-xs text-center shrink-0 whitespace-nowrap`}
      style={{ width: RIBBON_TAB_W }}>
      {label}
    </button>
  );
}

export function RibbonGroup({ children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 h-full pr-2 mr-1"
      style={{ borderRight: "1px solid #c4c4c4" }}>
      {children}
    </div>
  );
}

export function RibbonBigBtn({ icon, iconImg, label, sublabel, disabled, onClick, active, title, style }: {
  icon: string; iconImg?: string; label: string; sublabel: string; disabled?: boolean; onClick?: () => void; active?: boolean; title?: string; style?: React.CSSProperties;
}) {
  // Единый стиль крупных кнопок ленты: иконка в скруглённом квадрате-подложке.
  // В покое подложка едва заметна, при наведении — янтарная (фирменный
  // акцент), у активной кнопки — заполненная. Подсветка задаётся классами
  // .rb-* в index.css, а не ручными onMouseEnter: так она работает и в тёмной
  // теме и не «залипает», если мышь ушла с кнопки во время перерисовки.
  return (
    <button disabled={disabled} onClick={onClick} title={title ?? `${label}${sublabel ? " " + sublabel : ""}`}
      data-active={active ? "1" : undefined}
      className="rb-btn flex flex-col items-center justify-start gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        // Ширина растёт под длинную подпись («Устойчивость», «Типы выработок»):
        // при жёстких 52px текст вылезал за границы и налезал на соседнюю кнопку.
        minWidth: 54, height: 62,
        paddingLeft: 3, paddingRight: 3, paddingTop: 3,
        flexShrink: 0,
        ...style,
      }}>
      <span className="rb-tile">
        {iconImg
          ? <img src={iconImg} alt={label} style={{ width: 20, height: 20, objectFit: "contain" }} />
          : <Icon name={icon} size={18} fallback="Square" />}
      </span>
      <span className="rb-label" style={{ fontSize: 9.5, lineHeight: "1.15", textAlign: "center", fontWeight: 500 }}>
        <span className="block" style={{ whiteSpace: "nowrap" }}>{label}</span>
        {sublabel && <span className="rb-sub block" style={{ whiteSpace: "nowrap" }}>{sublabel}</span>}
      </span>
    </button>
  );
}

export function FrameGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="relative pt-2 pb-2 px-2"
      style={{ border: "1px solid var(--c-b3, #b8b8b8)", borderRadius: "0" }}>
      <legend className="px-1 text-xs text-gray-700"
        style={{ marginLeft: "4px", fontWeight: 400 }}>
        {title}
      </legend>
      <div className="space-y-1">
        {children}
      </div>
    </fieldset>
  );
}

export function LabeledRow({ label, children, labelWidth = 140 }: {
  label: string; children: React.ReactNode; labelWidth?: number;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-xs text-gray-700 flex-shrink-0 text-right whitespace-normal break-words leading-tight pt-1"
        style={{ width: labelWidth }}>{label}</span>
      {children}
    </div>
  );
}

export function CadCheckbox({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-[13px] h-[13px] cursor-pointer" />
      <span className="text-xs text-gray-800">{label}</span>
    </label>
  );
}

export function ToolBtn({ icon, label, active, onClick, disabled }: {
  icon: string; label: string; active?: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      className="tool-btn h-6 px-2 flex items-center gap-1 rounded text-[11px] disabled:opacity-40"
      data-active={active ? "1" : undefined}>
      <Icon name={icon} size={13} fallback="Square" />
      <span>{label}</span>
    </button>
  );
}

export function toolLabel(t: CadTool): string {
  switch (t) {
    case "select": return "Выбор";
    case "node": return "Добавить узел";
    case "branch": return "Соединить ветвью";
    case "pan": return "Панорама";
    case "rotate": return "Вращение 3D";
    case "textblock": return "Текстовый блок";
    default: return "—";
  }
}

export function ViewBtn({ label, preset, current, onClick, hint }: {
  label: string;
  preset: ViewPresetName;
  current: { is3D: boolean; azimuth: number; elevation: number };
  onClick: (p: ViewPresetName) => void;
  hint?: string;
}) {
  const PRESETS: Record<ViewPresetName, { az: number; el: number }> = {
    plan:  { az: 0,    el: 90 },
    front: { az: 0,    el: 0 },
    back:  { az: 180,  el: 0 },
    left:  { az: -90,  el: 0 },
    right: { az: 90,   el: 0 },
    isoSW: { az: -45,  el: 30 },
    isoSE: { az: 45,   el: 30 },
    isoNW: { az: -135, el: 30 },
    isoNE: { az: 135,  el: 30 },
  };
  const target = PRESETS[preset];
  const active = Math.abs(current.azimuth - target.az) < 1 && Math.abs(current.elevation - target.el) < 1;
  return (
    <button onClick={() => onClick(preset)} title={hint ?? label}
      className="h-6 px-2 flex items-center rounded text-[11px]"
      style={{
        background: active ? "var(--c-purple, #7c3aed)" : "transparent",
        color: active ? "white" : "var(--c-t1, #1f1f1f)",
        border: active ? "1px solid #5b21b6" : "1px solid var(--c-b2, #d0d0d0)",
      }}>
      {label}
    </button>
  );
}

