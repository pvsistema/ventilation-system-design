// ─────────────────────────────────────────────────────────────────────────────
// SymbolPicker.tsx — кнопка «Условные обозначения» в ленте «Главная» и
// выпадающая панель со всеми УО.
//
// Вынесено из Cad.tsx. Что изменилось по сравнению с прежней панелью:
//   • поиск по названию — ~150 значков без подписей найти глазами трудно;
//   • «Недавние» — последние 8 выбранных УО сверху (хранятся в браузере);
//   • название значка показывается строкой внизу панели, а не плавающей
//     подсказкой: подсказка жила в состоянии Cad.tsx и перерисовывала всю
//     страницу на каждое движение мыши по значкам;
//   • Esc закрывает панель, при выбранном УО — ещё и отменяет установку;
//   • цвета — из палитры темы, панель читается и в тёмной теме.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import { LEGEND_TYPES, HIDDEN_LEGEND_IDS, legendViewBox, type LegendType } from "@/lib/schemaSymbols";

const RECENT_KEY = "pv_recent_symbols";
const RECENT_MAX = 8;
const PANEL_W = 380;

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

interface Props {
  /** id выбранного УО (ждёт клика по ветви), null — не выбрано. */
  activeSymbolTypeId: string | null;
  /** Инструмент «символ» активен. */
  symbolToolActive: boolean;
  onPick: (id: string) => void;
  /** Отменить установку выбранного УО. */
  onCancel: () => void;
}

function SymbolIcon({ lt, w, h }: { lt: LegendType; w: number; h: number }) {
  return (
    <svg width={w} height={h} viewBox={legendViewBox(lt.id)} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <g dangerouslySetInnerHTML={{ __html: lt.svgContent }} />
    </svg>
  );
}

function SymbolPickerInner({ activeSymbolTypeId, symbolToolActive, onPick, onCancel }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<LegendType | null>(null);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Список УО неизменен на всё время работы — группируем один раз.
  const all = useMemo(() => LEGEND_TYPES.filter((lt) => !HIDDEN_LEGEND_IDS.has(lt.id)), []);
  const byId = useMemo(() => new Map(all.map((lt) => [lt.id, lt])), [all]);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const m = new Map<string, LegendType[]>();
    for (const lt of all) {
      if (q && !lt.name.toLowerCase().includes(q) && !(lt.subgroup ?? lt.group).toLowerCase().includes(q)) continue;
      const key = lt.subgroup ?? lt.group;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(lt);
    }
    return [...m.entries()];
  }, [all, q]);
  const recentItems = recent.map((id) => byId.get(id)).filter(Boolean) as LegendType[];
  const found = groups.reduce((n, [, items]) => n + items.length, 0);

  const activeLt = activeSymbolTypeId ? byId.get(activeSymbolTypeId) : undefined;
  const hasActive = symbolToolActive && !!activeLt;

  const close = () => { setOpen(false); setQuery(""); setHovered(null); };

  const toggle = () => {
    if (open) { close(); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - PANEL_W - 8)), top: r.bottom + 4 });
    setOpen(true);
  };

  const pick = (id: string) => {
    onPick(id);
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* нет места — не страшно */ }
    close();
  };

  // Esc: закрыть панель; если панель закрыта — отменить выбранный УО
  useEffect(() => {
    if (!open && !hasActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (open) close(); else onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasActive]);

  useEffect(() => { if (open) setTimeout(() => searchRef.current?.focus(), 0); }, [open]);

  const tile = (lt: LegendType, size = 32) => {
    const isActive = hasActive && activeSymbolTypeId === lt.id;
    return (
      <button key={lt.id} type="button"
        onClick={() => pick(lt.id)}
        onMouseEnter={() => setHovered(lt)}
        aria-label={lt.name}
        className="flex items-center justify-center rounded-md transition-colors"
        style={{
          width: size, height: size, padding: 0, cursor: "pointer",
          border: isActive ? "1.5px solid var(--c-accent, #1e5a7a)" : "1px solid transparent",
          background: isActive ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)" : "transparent",
        }}
        onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = "var(--c-s3, #f1efea)"; }}
        onMouseOut={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
        <SymbolIcon lt={lt} w={size - 8} h={size - 12} />
      </button>
    );
  };

  const sectionTitle = (text: string, extra?: React.ReactNode) => (
    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--c-t4, #767f8c)" }}>
      <span className="flex-1">{text}</span>{extra}
    </div>
  );

  return (
    <>
      {/* ── Кнопка в ленте ── */}
      <button ref={btnRef} type="button" onClick={toggle}
        title="Условные обозначения — выбрать значок для установки на выработку"
        className="flex flex-col items-center justify-center gap-0.5 rounded-md transition-colors flex-shrink-0 self-center"
        style={{
          width: 44, height: 50, padding: 0, cursor: "pointer",
          border: `1px solid ${open || hasActive ? "var(--c-accent, #1e5a7a)" : "var(--c-b2, #d5d1c8)"}`,
          background: open || hasActive ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 12%, var(--c-s1, #fff))" : "var(--c-s1, #fff)",
          color: "var(--c-t2, #3a3f45)",
        }}>
        {hasActive ? <SymbolIcon lt={activeLt!} w={30} h={24} /> : <Icon name="Shapes" size={20} />}
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={11} style={{ color: "var(--c-t4, #767f8c)" }} />
      </button>

      {/* ── Выбранный УО: что делать дальше ── */}
      {hasActive && (
        <div className="flex flex-col justify-center flex-shrink-0 gap-0.5" style={{ maxWidth: 96 }}>
          <div className="text-[9px] font-semibold leading-tight"
            style={{ color: "var(--c-accent, #1e5a7a)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {activeLt!.name}
          </div>
          <div className="text-[8px] leading-tight" style={{ color: "var(--c-t3, #6b7280)" }}>Кликните по выработке</div>
          <button type="button" onClick={onCancel}
            className="self-start flex items-center gap-0.5 text-[9px] rounded px-1"
            style={{ color: "var(--c-red, #dc2626)", background: "transparent", border: "none", cursor: "pointer" }}
            title="Отменить установку (Esc)">
            <Icon name="X" size={9} /> Отмена
          </button>
        </div>
      )}

      {/* ── Выпадающая панель ── */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={close} />
          <div className="rounded-xl overflow-hidden flex flex-col"
            style={{
              position: "fixed", left: pos.left, top: pos.top, zIndex: 9999, width: PANEL_W, maxHeight: "72vh",
              background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d5d1c8)",
              boxShadow: "0 12px 36px rgba(0,0,0,.22)", fontFamily: "var(--font-ui)",
            }}
            onMouseLeave={() => setHovered(null)}>

            {/* Шапка + поиск */}
            <div className="px-3 pt-2.5 pb-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--c-b1, #e7e4dd)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ color: "var(--c-accent, #1e5a7a)", background: "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)" }}>
                  <Icon name="Shapes" size={13} />
                </span>
                <span className="flex-1 text-[12px] font-semibold" style={{ color: "var(--c-t1, #1f2328)" }}>Условные обозначения</span>
                <button type="button" onClick={close} title="Закрыть (Esc)"
                  className="w-6 h-6 flex items-center justify-center rounded-md"
                  style={{ color: "var(--c-t3, #6b7280)", background: "transparent", border: "none", cursor: "pointer" }}>
                  <Icon name="X" size={14} />
                </button>
              </div>
              <div className="flex items-center gap-1.5 h-8 px-2 rounded-md"
                style={{ background: "var(--c-s2, #f8f7f4)", border: "1px solid var(--c-b2, #d5d1c8)" }}>
                <Icon name="Search" size={13} style={{ color: "var(--c-t4, #767f8c)" }} />
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Найти: перемычка, датчик, вентилятор…"
                  className="flex-1 min-w-0 text-[12px] outline-none bg-transparent"
                  style={{ color: "var(--c-t1, #1f2328)", border: "none" }} />
                {query && (
                  <button type="button" onClick={() => setQuery("")} title="Очистить"
                    style={{ color: "var(--c-t4, #767f8c)", background: "transparent", border: "none", cursor: "pointer" }}>
                    <Icon name="X" size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Список */}
            <div className="flex-1 overflow-y-auto pb-2">
              {!q && recentItems.length > 0 && (
                <>
                  {sectionTitle("Недавние", (
                    <button type="button" onClick={() => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch { /* */ } }}
                      className="normal-case tracking-normal font-normal"
                      style={{ color: "var(--c-t4, #767f8c)", background: "transparent", border: "none", cursor: "pointer" }}>
                      очистить
                    </button>
                  ))}
                  <div className="flex flex-wrap gap-0.5 px-2">{recentItems.map((lt) => tile(lt))}</div>
                </>
              )}
              {groups.map(([label, items]) => (
                <div key={label}>
                  {sectionTitle(label, <span className="font-normal tracking-normal" style={{ fontFamily: "var(--font-num)" }}>{items.length}</span>)}
                  <div className="flex flex-wrap gap-0.5 px-2">{items.map((lt) => tile(lt))}</div>
                </div>
              ))}
              {found === 0 && (
                <div className="px-3 py-8 text-center text-[11px]" style={{ color: "var(--c-t4, #767f8c)" }}>
                  Ничего не найдено по запросу «{query}»
                </div>
              )}
            </div>

            {/* Строка названия — что под курсором */}
            <div className="flex items-center gap-2 px-3 h-9 flex-shrink-0"
              style={{ borderTop: "1px solid var(--c-b1, #e7e4dd)", background: "var(--c-s2, #f8f7f4)" }}>
              {hovered ? (
                <>
                  <SymbolIcon lt={hovered} w={22} h={18} />
                  <span className="flex-1 min-w-0 text-[11px] truncate" style={{ color: "var(--c-t1, #1f2328)" }}>{hovered.name}</span>
                </>
              ) : (
                <span className="text-[10px]" style={{ color: "var(--c-t4, #767f8c)" }}>
                  Наведите на значок — здесь появится название. Клик — выбрать, затем клик по выработке.
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** Обработчики приходят из Cad.tsx стабильными (useCallback) — memo работает. */
const SymbolPicker = React.memo(SymbolPickerInner);
export default SymbolPicker;
