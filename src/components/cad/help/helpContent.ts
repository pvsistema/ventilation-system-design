// Состав и порядок разделов руководства — общий для окна «Помощь»
// и для выгрузки руководства в Word (helpDocx.ts).
import type { Section } from "./HelpPrimitives";
import { HELP_SECTIONS_BASICS } from "./helpSectionsBasics";
import { HELP_SECTIONS_SCHEMA } from "./helpSectionsSchema";
import { HELP_SECTIONS_VENTPIPE } from "./helpSectionsVentPipe";
import { HELP_SECTIONS_ADVANCED } from "./helpSectionsAdvanced";
import { HELP_SECTIONS_GUIDES } from "./helpSectionsGuides";
import { HELP_SECTIONS_WHATSNEW } from "./helpSectionsWhatsNew";

// Порядок разделов — от простого к сложному. Группы нужны, чтобы длинный
// список (20+ разделов) читался как оглавление, а не как сплошная колонка.
export const HELP_GROUPS: { title: string; ids: string[] }[] = [
  { title: "Начало работы", ids: ["overview", "whatsnew", "quickstart", "interface", "file", "import"] },
  { title: "Схема сети",    ids: ["topology", "branch-props", "symbols", "survey"] },
  { title: "Расчёты",       ids: ["ventilation", "ventpipe", "analysis"] },
  { title: "Аварии и ПЛА",  ids: ["accidents", "waterpipes", "rescue"] },
  { title: "Оформление",    ids: ["view", "refs", "print"] },
  { title: "Справка",       ids: ["scenarios", "shortcuts", "tips", "faq"] },
];

/** Все разделы в порядке оглавления. Раздел вне групп не теряется — идёт в конец. */
export function getHelpSections(): Section[] {
  const all = [
    ...HELP_SECTIONS_BASICS,
    ...HELP_SECTIONS_WHATSNEW,
    ...HELP_SECTIONS_SCHEMA,
    ...HELP_SECTIONS_VENTPIPE,
    ...HELP_SECTIONS_ADVANCED,
    ...HELP_SECTIONS_GUIDES,
  ];
  const byId = new Map(all.map(s => [s.id, s]));
  const ordered = HELP_GROUPS.flatMap(g => g.ids.map(id => byId.get(id)).filter(Boolean) as Section[]);
  all.forEach(s => { if (!ordered.includes(s)) ordered.push(s); });
  return ordered;
}

/** Группа, к которой относится раздел. */
export function helpGroupMap(): Map<string, string> {
  const m = new Map<string, string>();
  HELP_GROUPS.forEach(g => g.ids.forEach(id => m.set(id, g.title)));
  return m;
}
