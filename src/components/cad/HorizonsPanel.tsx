// ─────────────────────────────────────────────────────────────────────────────
// HorizonsPanel.tsx — вкладка «Горизонты» левой панели.
//
// Каждый горизонт — карточка в стиле панели информации: видимость, цвет,
// название, отметка и число выработок в одной строке; план, сдвиг и слой
// печати — в раскрываемых блоках под ней. Порядок в списке = порядок слоёв
// на схеме (сверху — поверх остальных), меняется перетаскиванием за ручку.
// Все цвета — из палитры темы (--c-*).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "@/components/ui/icon";
import {
  type Horizon, type HorizonPrintLayer, type PaperFormat, OVERVIEW_HORIZON_ID,
} from "@/lib/topology";
import HorizonShiftBlock, { type HorizonAlign } from "@/components/cad/HorizonShiftBlock";
import {
  signBlockKeys, SIGN_SCALE_MIN, SIGN_SCALE_MAX, SIGN_FONT_MIN, SIGN_FONT_MAX, type SignBlockKind,
} from "@/lib/approverTemplate";
import {
  TITLE_FONT_MIN, TITLE_FONT_MAX, TITLE_WIDTH_MIN, TITLE_WIDTH_MAX, TITLE_WIDTH_DEFAULT,
} from "@/lib/printTitle";

type Bounds = { x1: number; y1: number; x2: number; y2: number };

interface Props {
  horizons: Horizon[];
  setHorizons: (fn: (prev: Horizon[]) => Horizon[]) => void;
  /** Число выработок на каждом горизонте */
  branchCountByHorizon: Map<string, number>;
  activeHorizonId: string;
  setActiveHorizonId: (id: string) => void;
  hoveredHorizonId: string | null;
  setHoveredHorizonId: (fn: (prev: string | null) => string | null) => void;
  editingHorizonImageId: string | null;
  setEditingHorizonImageId: (id: string | null) => void;
  editingPrintLayerId: string | null;
  setEditingPrintLayerId: (id: string | null) => void;
  updateHorizon: (id: string, patch: Partial<Horizon>) => void;
  addHorizon: () => void;
  removeHorizon: (id: string) => void;
  uploadHorizonImage: (id: string, file: File) => void;
  removeHorizonImage: (id: string) => void;
  setHorizonImageBounds: (id: string, b: Bounds) => void;
  /** Габарит схемы в мировых координатах — для «план по центру схемы» */
  getSchemaBounds: () => Bounds | null;
  moveHorizon: (id: string, dx: number, dy: number, dz: number) => void;
  horizonAlignFor: (id: string) => HorizonAlign | null;
}

// ─── Примитивы ─────────────────────────────────────────────────────────
function IconBtn({ icon, title, onClick, disabled, danger, active }: {
  icon: string; title: string; onClick: () => void; disabled?: boolean; danger?: boolean; active?: boolean;
}) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={disabled} title={title}
      className="w-6 h-6 flex items-center justify-center rounded flex-shrink-0 transition-colors hover:bg-[var(--c-s4)] disabled:opacity-30 disabled:hover:bg-transparent"
      style={{ color: danger ? "var(--c-red)" : active ? "var(--c-accent)" : "var(--c-t3)" }}>
      <Icon name={icon} size={13} />
    </button>
  );
}

function Btn({ icon, children, onClick, active, danger, title, grow }: {
  icon?: string; children: ReactNode; onClick: () => void; active?: boolean; danger?: boolean; title?: string; grow?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`${grow ? "flex-1" : ""} h-7 px-2 flex items-center justify-center gap-1 text-[11px] font-medium rounded transition-colors ${active ? "" : "hover:bg-[var(--c-s3)]"}`}
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
            className="flex items-center justify-center gap-1 text-[11px] py-0.5 transition-colors"
            style={{
              borderRadius: 4, fontWeight: on ? 700 : 500,
              background: on ? "var(--c-s1)" : "transparent",
              color: on ? "var(--c-t1)" : "var(--c-t3)",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.12), inset 0 -2px 0 var(--c-signal)" : "none",
            }}>
            {o.icon && <Icon name={o.icon} size={11} />}{o.label}
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

/** Поле ввода с подписью для блока подписи. */
function TxtField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[9.5px] mb-0.5" style={{ color: "var(--c-t4)" }}>{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        className="w-full h-6 px-1.5 text-[11px] outline-none rounded"
        style={{ color: "var(--c-t1)", border: "1px solid var(--c-b2)", background: "var(--c-s1)" }} />
    </label>
  );
}

/** Ползунок «размер / шрифт» в процентах с кнопками −/+. */
function PctSlider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 100) / 100);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] w-12 flex-shrink-0" style={{ color: "var(--c-t3)" }}>{label}</span>
      <button type="button" className="w-5 h-5 rounded text-[11px] hover:bg-[var(--c-s3)]" style={{ color: "var(--c-t2)", border: "1px solid var(--c-b2)" }}
        onClick={() => set(value - 0.1)}>−</button>
      <input type="range" min={min} max={max} step={0.05} value={value} onChange={e => set(Number(e.target.value))}
        className="flex-1 min-w-0" style={{ accentColor: "var(--c-purple)" }} />
      <button type="button" className="w-5 h-5 rounded text-[11px] hover:bg-[var(--c-s3)]" style={{ color: "var(--c-t2)", border: "1px solid var(--c-b2)" }}
        onClick={() => set(value + 0.1)}>+</button>
      <span className="font-num text-[10px] w-9 text-right" style={{ color: "var(--c-t2)" }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

/**
 * Настройки блока подписи «УТВЕРЖДАЮ» / «СОГЛАСОВАНО»: текст полей, размер
 * блока, размер шрифта и возврат на место. Перемещается блок мышью на схеме.
 */
function SignBlockSettings({ kind, pl, updatePl }: {
  kind: SignBlockKind; pl: HorizonPrintLayer; updatePl: (patch: Partial<HorizonPrintLayer>) => void;
}) {
  const k = signBlockKeys(kind);
  const rec = pl as unknown as Record<string, string | number | undefined>;
  const str = (key: string) => (typeof rec[key] === "string" ? (rec[key] as string) : "");
  const num = (key: string) => (typeof rec[key] === "number" ? (rec[key] as number) : undefined);
  const isDev = kind === "develop";
  const f = kind === "approve"
    ? { title: "approverTitle", org: "orgName", name: "approverName", day: "day", month: "month", year: "year" }
    : kind === "develop"
      ? { title: "developTitle", org: "", name: "developName", day: "", month: "", year: "" }
      : { title: "agreeTitle", org: "agreeOrg", name: "agreeName", day: "agreeDay", month: "agreeMonth", year: "agreeYear" };
  const set = (key: string, v: string | number | undefined) => updatePl({ [key]: v } as Partial<HorizonPrintLayer>);
  const moved = !!(num(k.offX) || num(k.offY));
  return (
    <div className="rounded p-1.5 space-y-1.5" style={{ border: "1px solid var(--c-b1)", background: "var(--c-s2)" }}>
      <div className="flex items-center gap-1">
        <Icon name={kind === "approve" ? "Stamp" : kind === "develop" ? "PenLine" : "Handshake"} size={12} fallback="FileSignature" style={{ color: "var(--c-purple)" }} />
        <span className="flex-1 text-[10.5px] font-semibold" style={{ color: "var(--c-t2)" }}>
          {kind === "approve" ? "«УТВЕРЖДАЮ» — справа" : kind === "develop" ? "«Разработал» — под маршрутами" : "«СОГЛАСОВАНО» — слева"}
        </span>
        {moved && (
          <button type="button" className="text-[10px] hover:underline" style={{ color: "var(--c-accent)" }}
            title={isDev ? "Вернуть блок под таблицу маршрутов" : "Вернуть блок в угол рамки"} onClick={() => updatePl({ [k.offX]: 0, [k.offY]: 0 } as Partial<HorizonPrintLayer>)}>
            ↺ на место
          </button>
        )}
      </div>
      <TxtField label="Должность" value={str(f.title)} onChange={v => set(f.title, v)} placeholder={isDev ? "Инженер ВТБ" : "Главный инженер"} />
      {!isDev && <TxtField label="Организация" value={str(f.org)} onChange={v => set(f.org, v)} />}
      <TxtField label="И.О. Фамилия" value={str(f.name)} onChange={v => set(f.name, v)} />
      {!isDev && (
        <div className="grid gap-1" style={{ gridTemplateColumns: "44px 1fr 56px" }}>
          <TxtField label="Число" value={str(f.day)} onChange={v => set(f.day, v)} />
          <TxtField label="Месяц" value={str(f.month)} onChange={v => set(f.month, v)} />
          <TxtField label="Год" value={str(f.year)} onChange={v => set(f.year, v)} placeholder={String(new Date().getFullYear())} />
        </div>
      )}
      <PctSlider label="Размер" value={num(k.scale) ?? 1} min={SIGN_SCALE_MIN} max={SIGN_SCALE_MAX}
        onChange={v => set(k.scale, v)} />
      <PctSlider label="Шрифт" value={num(k.font) ?? 1} min={SIGN_FONT_MIN} max={SIGN_FONT_MAX}
        onChange={v => set(k.font, v)} />
      <Hint>Блок перетаскивается мышью прямо на схеме, размер — за уголок справа снизу. Двойной щелчок по строке — правка текста.</Hint>
    </div>
  );
}

/** Заголовок листа: текст (с ручным переносом), размер шрифта и ширина строки. */
function TitleSettings({ pl, updatePl }: {
  pl: HorizonPrintLayer; updatePl: (patch: Partial<HorizonPrintLayer>) => void;
}) {
  const moved = !!(pl.titleOffsetX || pl.titleOffsetY);
  return (
    <div className="rounded p-1.5 space-y-1.5" style={{ border: "1px solid var(--c-b1)", background: "var(--c-s2)" }}>
      <div className="flex items-center gap-1">
        <Icon name="Heading" size={12} fallback="Type" style={{ color: "var(--c-purple)" }} />
        <span className="flex-1 text-[10.5px] font-semibold" style={{ color: "var(--c-t2)" }}>Заголовок листа</span>
        {moved && (
          <button type="button" className="text-[10px] hover:underline" style={{ color: "var(--c-accent)" }}
            title="Вернуть заголовок по центру сверху" onClick={() => updatePl({ titleOffsetX: 0, titleOffsetY: 0 })}>
            ↺ на место
          </button>
        )}
      </div>
      <textarea value={pl.title ?? ""} rows={2} placeholder="Текст заголовка"
        onChange={e => updatePl({ title: e.target.value })}
        className="w-full px-1.5 py-1 text-[11px] outline-none rounded resize-y leading-snug"
        style={{ color: "var(--c-t1)", border: "1px solid var(--c-b2)", background: "var(--c-s1)" }} />
      <PctSlider label="Шрифт" value={pl.titleFontScale ?? 1} min={TITLE_FONT_MIN} max={TITLE_FONT_MAX}
        onChange={v => updatePl({ titleFontScale: v })} />
      <PctSlider label="Ширина" value={pl.titleWidth ?? TITLE_WIDTH_DEFAULT} min={TITLE_WIDTH_MIN} max={TITLE_WIDTH_MAX}
        onChange={v => updatePl({ titleWidth: v })} />
      <Hint>Длинный текст переносится по словам в пределах ширины. Enter в поле — новая строка. На схеме: перетаскивание, двойной щелчок — правка, уголок справа снизу — размер.</Hint>
    </div>
  );
}

/** Раскрываемый блок внутри карточки горизонта. */
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

function Pill({ children, tone }: { children: ReactNode; tone: "accent" | "purple" | "muted" }) {
  const c = tone === "accent" ? "var(--c-accent)" : tone === "purple" ? "var(--c-purple)" : "var(--c-t4)";
  return (
    <span className="text-[9.5px] font-semibold px-1.5 rounded-full"
      style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{children}</span>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="text-[10px] leading-snug" style={{ color: "var(--c-t3)" }}>{children}</div>;
}

const defaultPrintLayer = (h: Horizon): HorizonPrintLayer => ({
  visible: true, title: `Вентиляционный план горизонта ${h.z}м.`,
  scale: "1:2000", orgName: "", approverTitle: "Главный инженер ЮПР",
  approverName: "", day: "", month: "", year: String(new Date().getFullYear()),
  period: "", developer: "", checker: "",
  sheetNum: "1", sheetTotal: "1", showLegend: false, showStamp: false, showApprover: false,
  paperFormat: "A3", orientation: "landscape",
});

/** Отметка без лишних нулей: 261.1 → «261,1», −290 → «−290». */
const fmtZ = (z: number) => (Math.round(z * 10) / 10).toString().replace(".", ",").replace("-", "−");

// ─── Панель ────────────────────────────────────────────────────────────
export default function HorizonsPanel(p: Props) {
  const {
    horizons, setHorizons, branchCountByHorizon, activeHorizonId, setActiveHorizonId,
    hoveredHorizonId, setHoveredHorizonId, editingHorizonImageId, setEditingHorizonImageId,
    editingPrintLayerId, setEditingPrintLayerId, updateHorizon,
  } = p;

  // Раскрытый горизонт — один за раз: список остаётся коротким,
  // а настройки открываются кликом по строке.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Раскрытые блоки внутри карточки: ключ `${horizonId}:${block}`
  const [open, setOpen] = useState<Set<string>>(new Set());
  const isOpen = (id: string, block: string) => open.has(`${id}:${block}`);
  const toggle = (id: string, block: string) => setOpen(prev => {
    const n = new Set(prev); const k = `${id}:${block}`;
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  // Перетаскивание для порядка слоёв
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const drop = (idx: number) => {
    if (dragIdx !== null && dragIdx !== idx) {
      setHorizons(prev => {
        const next = [...prev];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(idx, 0, moved);
        return next;
      });
    }
    setDragIdx(null); setOverIdx(null);
  };

  // После «Добавить горизонт» сразу раскрываем новый — чтобы задать название и отметку.
  const pendingOpenNew = useRef<number | null>(null);
  useEffect(() => {
    if (pendingOpenNew.current !== null && horizons.length > pendingOpenNew.current) {
      setExpandedId(horizons[horizons.length - 1].id);
      pendingOpenNew.current = null;
    }
  }, [horizons]);

  const active = horizons.find(h => h.id === activeHorizonId) ?? null;
  const allVisible = horizons.every(h => h.visible);

  const centerImage = (h: Horizon) => {
    if (!h.image) return;
    const bw = Math.abs(h.image.bounds.x2 - h.image.bounds.x1);
    const bh = Math.abs(h.image.bounds.y2 - h.image.bounds.y1);
    const aspect = bw > 0 && bh > 0 ? bw / bh : 1;
    const sb = p.getSchemaBounds();
    let cx = 0, cy = 0, halfH = 1000;
    if (sb) {
      cx = (sb.x1 + sb.x2) / 2; cy = (sb.y1 + sb.y2) / 2;
      halfH = Math.max(Math.max(sb.x2 - sb.x1, 1000), Math.max(sb.y2 - sb.y1, 1000)) * 0.75;
    }
    const halfW = halfH * aspect;
    p.setHorizonImageBounds(h.id, { x1: cx - halfW, y1: cy - halfH, x2: cx + halfW, y2: cy + halfH });
    setEditingHorizonImageId(h.id);
  };

  const rotateImage = (h: Horizon, delta: number | null) => {
    if (!h.image) return;
    let v = delta === null ? 0 : (h.image.rotation ?? 0) + delta;
    while (v > 180) v -= 360;
    while (v < -180) v += 360;
    updateHorizon(h.id, { image: { ...h.image, rotation: +v.toFixed(1) } });
  };

  const confirmRemove = (h: Horizon) => {
    const n = branchCountByHorizon.get(h.id) ?? 0;
    const msg = n > 0
      ? `Удалить горизонт «${h.name}»?\n\nВыработки (${n}) останутся на схеме, но потеряют привязку к горизонту.`
      : `Удалить горизонт «${h.name}»?`;
    if (window.confirm(msg)) p.removeHorizon(h.id);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--c-s2)" }}>
      {/* ── Верх: активный горизонт + действия со списком ── */}
      <div className="px-2 pt-2 pb-2 space-y-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-b1)" }}>
        <div>
          <div className="text-[10px] font-medium mb-1 flex items-center gap-1" style={{ color: "var(--c-t3)" }}
            title="Новые узлы получают отметку Z этого горизонта и привязку к нему. Существующие объекты не меняются.">
            <Icon name="PenLine" size={11} />
            Строить новые узлы на горизонте
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ background: active?.color ?? "transparent", border: `1px solid ${active ? "rgba(0,0,0,.25)" : "var(--c-b3)"}` }} />
            <select value={activeHorizonId} onChange={(e) => setActiveHorizonId(e.target.value)}
              className="flex-1 min-w-0 h-7 px-1.5 text-[11.5px] outline-none cursor-pointer"
              style={{ border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)", color: "var(--c-t1)" }}>
              <option value="">Не выбран — отметка текущей плоскости</option>
              {horizons.filter(h => h.id !== OVERVIEW_HORIZON_ID).map((h) => (
                <option key={h.id} value={h.id}>{h.name} · Z {h.z} м</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-1">
          <Btn icon="Plus" grow onClick={() => { pendingOpenNew.current = horizons.length; p.addHorizon(); }}>Добавить горизонт</Btn>
          <Btn icon={allVisible ? "EyeOff" : "Eye"}
            title={allVisible ? "Скрыть все горизонты" : "Показать все горизонты"}
            onClick={() => setHorizons(prev => prev.map(h => ({ ...h, visible: !allVisible })))}>
            {allVisible ? "Скрыть все" : "Показать все"}
          </Btn>
        </div>
      </div>

      {/* ── Список ── */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-1 pb-0.5 flex items-center gap-1 text-[10px]" style={{ color: "var(--c-t4)" }}
          title="Верхний в списке рисуется поверх остальных. Порядок меняется перетаскиванием за ручку слева.">
          <Icon name="Layers" size={11} />
          <span className="flex-1">Горизонты · {horizons.length}</span>
          <span>отметка · выработок</span>
        </div>

        {horizons.map((h, idx) => {
          const count = branchCountByHorizon.get(h.id) ?? 0;
          const isOverview = h.id === OVERVIEW_HORIZON_ID;
          const isActive = activeHorizonId === h.id;
          const isHovered = hoveredHorizonId === h.id;
          const expanded = expandedId === h.id;
          const pl = h.printLayer;
          const plOn = !!pl?.visible;
          const updatePl = (patch: Partial<HorizonPrintLayer>) =>
            updateHorizon(h.id, { printLayer: pl ? { ...pl, ...patch } : { ...defaultPrintLayer(h), ...patch } });

          return (
            <section key={h.id}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(idx); }}
              onDrop={() => drop(idx)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              onMouseEnter={() => setHoveredHorizonId(() => h.id)}
              onMouseLeave={() => setHoveredHorizonId(prev => prev === h.id ? null : prev)}
              className="rounded-md overflow-hidden transition-colors"
              style={{
                background: "var(--c-s1)",
                border: `1px solid ${overIdx === idx && dragIdx !== idx ? "var(--c-accent)" : expanded ? "var(--c-b3)" : isHovered ? "var(--c-b2)" : "var(--c-b1)"}`,
                boxShadow: expanded ? "0 2px 6px -2px rgba(0,0,0,.15)" : undefined,
                opacity: dragIdx === idx ? 0.45 : 1,
              }}>

              {/* ── Компактная строка: клик открывает настройки ── */}
              <div role="button" tabIndex={0}
                onClick={() => setExpandedId(expanded ? null : h.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedId(expanded ? null : h.id); } }}
                title={expanded ? "Свернуть настройки" : "Открыть настройки горизонта"}
                className="flex items-center gap-1.5 pl-0.5 pr-1 h-8 cursor-pointer select-none transition-colors hover:bg-[var(--c-s3)]"
                style={{ background: expanded ? "var(--c-s3)" : undefined }}>
                <span title="Перетащите, чтобы изменить порядок слоёв" onClick={e => e.stopPropagation()}
                  className="cursor-grab flex-shrink-0 flex items-center" style={{ color: "var(--c-t4)" }}>
                  <Icon name="GripVertical" size={12} />
                </span>
                <Icon name="ChevronRight" size={12} className="flex-shrink-0"
                  style={{ color: "var(--c-t4)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                <span className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ background: h.color, border: "1px solid rgba(0,0,0,.25)", opacity: h.visible ? 1 : 0.4 }} />
                <span className="flex-1 min-w-0 truncate text-[11.5px] font-medium"
                  style={{ color: h.visible ? "var(--c-t1)" : "var(--c-t4)" }}>
                  {h.name || "Без названия"}
                </span>
                {isActive && (
                  <span title="Новые узлы строятся на этом горизонте" className="flex-shrink-0 flex items-center"
                    style={{ color: "var(--c-accent)" }}><Icon name="PenLine" size={11} /></span>
                )}
                {h.image?.visible && h.visible && (
                  <span title="Показан план-подложка" className="flex-shrink-0 flex items-center" style={{ color: "var(--c-t3)" }}>
                    <Icon name="Image" size={11} /></span>
                )}
                {plOn && (
                  <span title={`Слой печати ${pl?.paperFormat ?? ""}`} className="flex-shrink-0 flex items-center" style={{ color: "var(--c-purple)" }}>
                    <Icon name="Printer" size={11} /></span>
                )}
                <span className="font-num text-[10.5px] w-12 text-right flex-shrink-0" style={{ color: "var(--c-t3)" }}
                  title={isOverview ? "Общий вид охватывает всю схему" : "Высотная отметка"}>
                  {isOverview ? "—" : `${fmtZ(h.z)} м`}
                </span>
                <span className="font-num text-[10px] px-1.5 rounded-full flex-shrink-0 min-w-[26px] text-center"
                  title={`Выработок на горизонте: ${count}`}
                  style={{
                    background: count > 0 ? "color-mix(in srgb, var(--c-accent) 14%, transparent)" : "var(--c-s3)",
                    color: count > 0 ? "var(--c-accent)" : "var(--c-t4)",
                  }}>{count}</span>
                <IconBtn icon={h.visible ? "Eye" : "EyeOff"} active={h.visible}
                  title={h.visible ? "Скрыть горизонт на схеме" : "Показать горизонт на схеме"}
                  onClick={() => updateHorizon(h.id, { visible: !h.visible })} />
              </div>

              {expanded && (<>
              {/* ── Основное: название, цвет, отметка, построение, удаление ── */}
              <div className="px-2 py-2 space-y-1.5" style={{ borderTop: "1px solid var(--c-b1)" }}>
                <div className="flex items-center gap-1.5">
                  <label className="w-7 h-7 rounded flex-shrink-0 cursor-pointer relative overflow-hidden"
                    title="Цвет горизонта" style={{ background: h.color, border: "1px solid rgba(0,0,0,.25)" }}>
                    <input type="color" value={h.color} onChange={(e) => updateHorizon(h.id, { color: e.target.value })}
                      className="absolute inset-0 opacity-0 cursor-pointer" />
                  </label>
                  <input type="text" value={h.name} onChange={(e) => updateHorizon(h.id, { name: e.target.value })}
                    placeholder="Название горизонта" autoFocus={!h.name}
                    className="flex-1 min-w-0 h-7 px-2 text-[11.5px] outline-none"
                    style={{ color: "var(--c-t1)", border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)" }} />
                  {!isOverview && (
                    <label className="flex items-stretch flex-shrink-0 overflow-hidden" title="Высотная отметка горизонта"
                      style={{ border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)" }}>
                      <span className="px-1.5 flex items-center text-[10px]" style={{ color: "var(--c-t4)", background: "var(--c-s3)" }}>Z</span>
                      <input type="number" value={h.z}
                        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateHorizon(h.id, { z: v }); }}
                        className="font-num w-16 h-7 px-1.5 text-[11.5px] text-right outline-none bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                        style={{ color: "var(--c-t1)" }} />
                      <span className="px-1.5 flex items-center text-[10px]" style={{ color: "var(--c-t4)", background: "var(--c-s3)" }}>м</span>
                    </label>
                  )}
                </div>
                {isOverview ? (
                  <Hint>Общий вид охватывает всю схему. Здесь настраивается только его слой печати.</Hint>
                ) : (
                  <div className="flex gap-1">
                    <Btn grow icon={isActive ? "PenLine" : "PenOff"} active={isActive}
                      title="Новые узлы получают отметку и привязку этого горизонта"
                      onClick={() => setActiveHorizonId(isActive ? "" : h.id)}>
                      {isActive ? "Строим на этом горизонте" : "Строить на этом горизонте"}
                    </Btn>
                    <Btn icon="Trash2" danger title="Удалить горизонт" onClick={() => confirmRemove(h)}>Удалить</Btn>
                  </div>
                )}
              </div>

              {/* Сдвиг горизонта — стыковка импортированного горизонта со схемой */}
              {!isOverview && (
                <SubBlock icon="Move" title="Сдвиг горизонта" open={isOpen(h.id, "shift")} onToggle={() => toggle(h.id, "shift")}>
                  <HorizonShiftBlock horizonId={h.id} branchCount={count} onMove={p.moveHorizon} align={p.horizonAlignFor(h.id)} />
                </SubBlock>
              )}

              {/* Подложка-план */}
              {!isOverview && (
                <SubBlock icon="Image" title="План-подложка" open={isOpen(h.id, "plan")} onToggle={() => toggle(h.id, "plan")}
                  badge={h.image && <Pill tone={h.image.visible ? "accent" : "muted"}>{h.image.visible ? "есть" : "скрыт"}</Pill>}>
                  {h.image ? (
                    <>
                      <div className="flex items-center gap-2">
                        <img src={h.image.dataUrl} alt="" className="w-10 h-10 object-cover rounded flex-shrink-0"
                          style={{ border: "1px solid var(--c-b2)" }} />
                        <div className="flex-1 min-w-0">
                          <Check checked={h.image.visible} label="Показывать на схеме"
                            onChange={(v) => updateHorizon(h.id, { image: h.image ? { ...h.image, visible: v } : undefined })} />
                          <div className="font-num text-[9.5px] mt-0.5 truncate" style={{ color: "var(--c-t4)" }}>
                            X {Math.round(h.image.bounds.x1)}…{Math.round(h.image.bounds.x2)} · Y {Math.round(h.image.bounds.y1)}…{Math.round(h.image.bounds.y2)} м
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[10.5px]" style={{ color: "var(--c-t3)" }}>
                        <span className="w-20 flex-shrink-0">Прозрачность</span>
                        <input type="range" min={0} max={100} value={Math.round(h.image.opacity * 100)}
                          onChange={(e) => updateHorizon(h.id, { image: h.image ? { ...h.image, opacity: Number(e.target.value) / 100 } : undefined })}
                          className="flex-1" style={{ accentColor: "var(--c-accent)" }} />
                        <span className="font-num w-9 text-right" style={{ color: "var(--c-t2)" }}>{Math.round(h.image.opacity * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10.5px]" style={{ color: "var(--c-t3)" }}>
                        <span className="w-20 flex-shrink-0">Поворот</span>
                        <input type="range" min={-180} max={180} step={0.5} value={h.image.rotation ?? 0}
                          onChange={(e) => updateHorizon(h.id, { image: h.image ? { ...h.image, rotation: Number(e.target.value) } : undefined })}
                          className="flex-1" style={{ accentColor: "var(--c-accent)" }} />
                        <span className="font-num w-9 text-right" style={{ color: "var(--c-t2)" }}>{(h.image.rotation ?? 0).toFixed(1)}°</span>
                      </div>
                      <div className="flex gap-1">
                        {[-90, -1, 1, 90].map(d => (
                          <Btn key={d} grow onClick={() => rotateImage(h, d)}
                            title={Math.abs(d) === 90 ? `Повернуть на ${d}°` : `Подстроить на ${d}°`}>
                            {d > 0 ? `+${d}°` : `${d}°`}
                          </Btn>
                        ))}
                        <Btn icon="RotateCcw" onClick={() => rotateImage(h, null)} title="Сбросить поворот">0°</Btn>
                      </div>
                      <div className="flex gap-1">
                        <Btn grow icon={editingHorizonImageId === h.id ? "Check" : "Scan"} active={editingHorizonImageId === h.id}
                          title="Тянуть углы плана прямо на схеме"
                          onClick={() => setEditingHorizonImageId(editingHorizonImageId === h.id ? null : h.id)}>
                          {editingHorizonImageId === h.id ? "Готово" : "Подогнать на схеме"}
                        </Btn>
                        <Btn icon="Crosshair" onClick={() => centerImage(h)} title="Разместить план по центру схемы">По центру</Btn>
                        <Btn icon="Trash2" danger onClick={() => p.removeHorizonImage(h.id)} title="Удалить план">{""}</Btn>
                      </div>
                    </>
                  ) : (
                    <label className="flex items-center justify-center gap-1.5 h-8 text-[11px] rounded cursor-pointer transition-colors hover:bg-[var(--c-s3)]"
                      style={{ border: "1px dashed var(--c-b3)", color: "var(--c-t3)" }}>
                      <input type="file" accept="image/png,image/jpeg" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) p.uploadHorizonImage(h.id, f); e.target.value = ""; }} />
                      <Icon name="Upload" size={12} />
                      Загрузить план (PNG, JPG)
                    </label>
                  )}
                </SubBlock>
              )}

              {/* Слой печати */}
              <SubBlock icon="Printer" title="Слой печати" open={isOpen(h.id, "print")} onToggle={() => toggle(h.id, "print")}
                badge={pl && <Pill tone={plOn ? "purple" : "muted"}>{plOn ? `${pl.paperFormat ?? "A3"} · вкл` : "выкл"}</Pill>}>
                <div className="flex items-center justify-between gap-2">
                  <Hint>Рамка листа, штамп и условные обозначения поверх схемы.</Hint>
                  <button type="button" role="switch" aria-checked={plOn}
                    onClick={() => updatePl({ visible: !plOn })}
                    className="relative flex-shrink-0 rounded-full transition-colors"
                    style={{ width: 28, height: 15, background: plOn ? "var(--c-purple)" : "var(--c-b3)" }}
                    title={plOn ? "Выключить слой печати" : "Включить слой печати"}>
                    <span className="absolute top-[2px] rounded-full transition-all"
                      style={{ width: 11, height: 11, left: plOn ? 15 : 2, background: "#fff" }} />
                  </button>
                </div>
                {pl && plOn && (
                  <>
                    <Seg value={(pl.paperFormat ?? "A3") as PaperFormat}
                      onChange={(f) => updatePl({ paperFormat: f, bounds: undefined, frameNorm: undefined })}
                      options={(["A4", "A3", "A2", "A1", "A0"] as PaperFormat[]).map(f => ({ value: f, label: f }))} />
                    <Seg value={(pl.orientation ?? "landscape") as "landscape" | "portrait"}
                      onChange={(o) => updatePl({ orientation: o, bounds: undefined, frameNorm: undefined })}
                      options={[
                        { value: "landscape" as const, label: "Альбомная", icon: "RectangleHorizontal" },
                        { value: "portrait" as const, label: "Книжная", icon: "RectangleVertical" },
                      ]} />
                    <div className="flex items-center gap-3 flex-wrap pt-0.5">
                      <Check checked={pl.showLegend} onChange={(v) => updatePl({ showLegend: v })} label="Условные обозн." />
                      <Check checked={pl.showRoutes ?? false} onChange={(v) => updatePl({ showRoutes: v })} label="Маршрут" />
                      <Check checked={pl.showStamp} onChange={(v) => updatePl({ showStamp: v })} label="Штамп" />
                      <Check checked={pl.showAgree ?? false} onChange={(v) => updatePl({ showAgree: v })} label="«Согласовано»" />
                      <Check checked={pl.showApprover ?? false} onChange={(v) => updatePl({ showApprover: v })} label="«Утверждаю»" />
                      <Check checked={pl.showDeveloper ?? false} onChange={(v) => updatePl({ showDeveloper: v })} label="«Разработал»" />
                    </div>
                    <TitleSettings pl={pl} updatePl={updatePl} />
                    {pl.showAgree && <SignBlockSettings kind="agree" pl={pl} updatePl={updatePl} />}
                    {pl.showApprover && <SignBlockSettings kind="approve" pl={pl} updatePl={updatePl} />}
                    {pl.showDeveloper && <SignBlockSettings kind="develop" pl={pl} updatePl={updatePl} />}
                    <div className="flex gap-1">
                      <Btn grow icon={editingPrintLayerId === h.id ? "Check" : "Scan"} active={editingPrintLayerId === h.id}
                        title="Двигать и растягивать рамку прямо на схеме"
                        onClick={() => setEditingPrintLayerId(editingPrintLayerId === h.id ? null : h.id)}>
                        {editingPrintLayerId === h.id ? "Готово" : "Изменить рамку"}
                      </Btn>
                      {(pl.bounds || pl.frameNorm) && (
                        <Btn icon="RotateCcw" onClick={() => updatePl({ bounds: undefined, frameNorm: undefined })} title="Рамка по габариту горизонта">Авто</Btn>
                      )}
                      <Btn icon="Trash2" danger title="Удалить слой печати со всеми настройками штампа"
                        onClick={() => { updateHorizon(h.id, { printLayer: undefined }); setEditingPrintLayerId(null); }}>{""}</Btn>
                    </div>
                  </>
                )}
              </SubBlock>
              </>)}
            </section>
          );
        })}
      </div>
    </div>
  );
}