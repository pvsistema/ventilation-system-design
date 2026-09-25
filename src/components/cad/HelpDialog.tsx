// ─────────────────────────────────────────────────────────────────────────────
// Окно «Руководство» (вкладка «Помощь»).
//
// Оформлено в фирменном стиле программы, как окно «О программе» и заставка:
// антрацитовая боковая колонка с миллиметровкой, янтарная метка активного
// раздела, светлое тело с текстом. Слева — поиск и разделы, сгруппированные
// по темам; справа — текст раздела, внизу — переход «Назад / Вперёд».
// Стили — классы .help-* в src/index.css, содержимое — в папке help/.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import AppLogo from "@/components/AppLogo";
import { type Section, nodeText } from "@/components/cad/help/HelpPrimitives";
import { HELP_SECTIONS_BASICS } from "@/components/cad/help/helpSectionsBasics";
import { HELP_SECTIONS_SCHEMA } from "@/components/cad/help/helpSectionsSchema";
import { HELP_SECTIONS_VENTPIPE } from "@/components/cad/help/helpSectionsVentPipe";
import { HELP_SECTIONS_ADVANCED } from "@/components/cad/help/helpSectionsAdvanced";
import { HELP_SECTIONS_GUIDES } from "@/components/cad/help/helpSectionsGuides";

interface Props {
  onClose: () => void;
}

type IconName = Parameters<typeof Icon>[0]["name"];

// Порядок разделов — от простого к сложному. Группы нужны, чтобы длинный
// список (20+ разделов) читался как оглавление, а не как сплошная колонка.
const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Начало работы", ids: ["overview", "quickstart", "interface", "file", "import"] },
  { title: "Схема сети",    ids: ["topology", "branch-props", "symbols", "survey"] },
  { title: "Расчёты",       ids: ["ventilation", "ventpipe", "analysis"] },
  { title: "Аварии и ПЛА",  ids: ["accidents", "waterpipes", "rescue"] },
  { title: "Оформление",    ids: ["view", "refs", "print"] },
  { title: "Справка",       ids: ["scenarios", "shortcuts", "tips", "faq"] },
];

export default function HelpDialog({ onClose }: Props) {
  const sections: Section[] = useMemo(() => {
    const all = [
      ...HELP_SECTIONS_BASICS,
      ...HELP_SECTIONS_SCHEMA,
      ...HELP_SECTIONS_VENTPIPE,
      ...HELP_SECTIONS_ADVANCED,
      ...HELP_SECTIONS_GUIDES,
    ];
    const byId = new Map(all.map(s => [s.id, s]));
    const ordered = GROUPS.flatMap(g => g.ids.map(id => byId.get(id)).filter(Boolean) as Section[]);
    // Раздел, не попавший ни в одну группу, не теряется — идёт в конец.
    all.forEach(s => { if (!ordered.includes(s)) ordered.push(s); });
    return ordered;
  }, []);

  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    GROUPS.forEach(g => g.ids.forEach(id => m.set(id, g.title)));
    return m;
  }, []);

  // Полный текст разделов для поиска — собирается один раз.
  const texts = useMemo(
    () => new Map(sections.map(s => [s.id, (s.title + " " + nodeText(s.content)).toLowerCase()])),
    [sections],
  );

  const [activeSection, setActiveSection] = useState("overview");
  const [query, setQuery] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const visible = q ? sections.filter(s => texts.get(s.id)!.includes(q)) : sections;

  const idx = sections.findIndex(s => s.id === activeSection);
  const active = sections[idx] ?? sections[0];

  // Новый раздел читается с начала
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [activeSection]);

  // Esc — закрыть, ←/→ с Alt — листать разделы
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.altKey && e.key === "ArrowLeft" && idx > 0) setActiveSection(sections[idx - 1].id);
      if (e.altKey && e.key === "ArrowRight" && idx < sections.length - 1) setActiveSection(sections[idx + 1].id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [idx, sections, onClose]);

  const numOf = (id: string) => sections.findIndex(s => s.id === id) + 1;

  const NavBtn = ({ s }: { s: Section }) => (
    <button onClick={() => setActiveSection(s.id)} className="help-nav" data-active={activeSection === s.id ? "1" : undefined}>
      <Icon name={s.icon as IconName} size={14} className="help-nav-ico" />
      <span className="min-w-0">{s.title}</span>
      <span className="help-nav-num">{String(numOf(s.id)).padStart(2, "0")}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(15,17,20,0.55)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="help-card flex overflow-hidden"
        style={{ width: "min(1120px, 96vw)", height: "min(820px, 92vh)" }}>

        {/* ── Боковая колонка: бренд, поиск, оглавление ── */}
        <aside className="help-side flex flex-col flex-shrink-0" style={{ width: 236 }}>
          <div className="px-4 pt-4 pb-3 flex items-center gap-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <AppLogo className="w-9 h-9 object-contain flex-shrink-0" />
            <div className="min-w-0">
              <div className="help-brand-title">ПВ<span>-</span>Система</div>
              <div className="help-brand-sub mt-1">Руководство</div>
            </div>
          </div>

          <div className="px-3 pt-3 pb-1">
            <div className="relative">
              <Icon name="Search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "#7d858e" }} />
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Поиск по руководству…" className="help-search" autoFocus />
              {query && (
                <button onClick={() => setQuery("")} title="Очистить"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded" style={{ color: "#9aa3ad" }}>
                  <Icon name="X" size={12} />
                </button>
              )}
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto pb-2">
            {q ? (
              <>
                <div className="help-group">Найдено: {visible.length}</div>
                {visible.map(s => <NavBtn key={s.id} s={s} />)}
                {visible.length === 0 && (
                  <div className="px-4 py-3 text-[11.5px]" style={{ color: "#9aa3ad" }}>
                    Ничего не найдено. Попробуйте другое слово — например, «F9», «перемычка», «импорт».
                  </div>
                )}
              </>
            ) : (
              GROUPS.map(g => (
                <div key={g.title}>
                  <div className="help-group">{g.title}</div>
                  {sections.filter(s => groupOf.get(s.id) === g.title).map(s => <NavBtn key={s.id} s={s} />)}
                </div>
              ))
            )}
          </nav>

          <div className="px-4 py-2.5 text-[10px]" style={{ color: "#6b737c", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            © 2026 ПВ-Система · <span className="font-num">Esc</span> — закрыть
          </div>
        </aside>

        {/* ── Текст раздела ── */}
        <div className="flex flex-col flex-1 min-w-0">
          <header className="help-head flex items-center gap-3 px-6 py-3.5 flex-shrink-0">
            <div className="help-head-ico"><Icon name={active.icon as IconName} size={18} /></div>
            <div className="flex-1 min-w-0">
              <div className="help-crumb">{groupOf.get(active.id) ?? "Руководство"} · раздел {idx + 1} из {sections.length}</div>
              <h2 className="help-title truncate">{active.title}</h2>
            </div>
            <button onClick={onClose} className="help-close" title="Закрыть (Esc)">
              <Icon name="X" size={16} />
            </button>
          </header>

          <div ref={bodyRef} className="help-body flex-1 overflow-y-auto px-6 py-5">
            {active.content}
          </div>

          <footer className="help-foot flex items-center gap-3 px-6 py-3 flex-shrink-0">
            <button className="help-btn" disabled={idx <= 0}
              onClick={() => idx > 0 && setActiveSection(sections[idx - 1].id)}
              title={idx > 0 ? `${sections[idx - 1].title} (Alt+←)` : undefined}>
              <Icon name="ChevronLeft" size={14} /> Назад
            </button>
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="help-progress"><span style={{ width: `${((idx + 1) / sections.length) * 100}%` }} /></div>
              {idx < sections.length - 1 && (
                <div className="text-[10.5px] truncate" style={{ color: "var(--c-t3, #6b7280)" }}>
                  Далее: {sections[idx + 1].title}
                </div>
              )}
            </div>
            <button className="help-btn" disabled={idx >= sections.length - 1}
              onClick={() => idx < sections.length - 1 && setActiveSection(sections[idx + 1].id)}
              title={idx < sections.length - 1 ? `${sections[idx + 1].title} (Alt+→)` : undefined}>
              Вперёд <Icon name="ChevronRight" size={14} />
            </button>
            <button onClick={onClose} className="btn-brand h-7 px-5 text-[12px] flex-shrink-0">
              Закрыть
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
