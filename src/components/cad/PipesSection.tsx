// Справочник «Трубы» (Трубопровод): стальные трубы ППЗ по ГОСТ, разложенные
// на магистральные / участковые / забойные по нормам минимального диаметра —
// для рудников (ФНиП № 505) или угольных шахт (РД 05-366-00).
// Свои трубы: добавление, правка, удаление, «взять за основу».
import { useState } from "react";
import Icon from "@/components/ui/icon";
import UserPipeEditor from "@/components/cad/UserPipeEditor";
import { MATERIAL_ROUGHNESS_MM } from "@/lib/waterSolver";
import {
  PIPE_CATALOG, PIPE_LINE_NAMES, PIPE_LINE_HINT, MIN_DN, V_TECH, V_FIRE,
  innerDiameter, capacityM3h, pipeLineFor, makeUserPipe,
  type WaterPipeModel, type PipeLine,
} from "@/lib/waterPipes";

const BTN_PRIMARY =
  "h-7 px-3 inline-flex items-center justify-center gap-1 text-[11px] font-medium rounded-md text-white bg-[var(--c-accent)] hover:bg-[var(--c-accent-ink)] transition-colors";
const TH = "px-3 h-8 text-[10px] font-semibold uppercase tracking-wider text-[var(--c-t3)] border-b border-[var(--c-b2)] whitespace-nowrap";
const TD = "px-3 py-1.5 text-[12px] text-[var(--c-t1)] border-b border-[var(--c-b1)] align-middle";
const ICON_BTN = "w-6 h-6 inline-flex items-center justify-center rounded text-[var(--c-t3)] hover:bg-[var(--c-s3)]";
const NUM = { fontFamily: "var(--font-num)" } as const;
const LINE_ICON: Record<PipeLine, string> = { main: "GitCommitHorizontal", section: "GitBranch", face: "GitFork" };
const KIND_KEY = "pv_pipes_kind";

const f1 = (v: number) => (+v.toFixed(1)).toLocaleString("ru");

function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: { id: T; label: string; count?: number }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex p-0.5 rounded-md" style={{ background: "var(--c-s3, #f1efea)" }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            className="h-6 px-2.5 rounded text-[11px] transition-colors inline-flex items-center gap-1"
            style={{
              background: on ? "var(--c-s1, #fff)" : "transparent",
              color: on ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)",
              fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none",
            }}>
            {o.label}
            {o.count !== undefined && <span className="text-[10px] opacity-70" style={NUM}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default function PipesSection({ userPipes, onUserPipesChange }: {
  userPipes?: WaterPipeModel[];
  onUserPipesChange?: (list: WaterPipeModel[]) => void;
}) {
  const own = userPipes ?? [];
  const canEdit = !!onUserPipesChange;
  const [kind, setKindState] = useState<"ore" | "coal">(() => {
    try { return localStorage.getItem(KIND_KEY) === "coal" ? "coal" : "ore"; } catch { return "ore"; }
  });
  const setKind = (k: "ore" | "coal") => {
    setKindState(k);
    try { localStorage.setItem(KIND_KEY, k); } catch { /* ignore */ }
  };
  const [line, setLine] = useState<PipeLine | "all">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<WaterPipeModel | null>(null);

  const save = (m: WaterPipeModel) => {
    const exists = own.some((x) => x.id === m.id);
    onUserPipesChange?.(exists ? own.map((x) => (x.id === m.id ? m : x)) : [...own, m]);
    setEditing(null);
  };
  const remove = (m: WaterPipeModel) => {
    if (!window.confirm(`Удалить трубу «${m.name}» из справочника? У ветвей останутся введённые диаметр и стенка.`)) return;
    onUserPipesChange?.(own.filter((x) => x.id !== m.id));
  };
  const copyOf = (m: WaterPipeModel): WaterPipeModel =>
    ({ ...m, id: `user_pipe_${Date.now()}`, name: `${m.name} (своя)`, isUser: true });

  const q = query.trim().toLowerCase().replace(/[xх*]/g, "×");
  const all = [...own.map((x) => ({ ...x, isUser: true })), ...PIPE_CATALOG]
    .sort((a, b) => a.dn - b.dn || a.outerDiameter - b.outerDiameter || a.wall - b.wall);
  const lineOf = (m: WaterPipeModel) => pipeLineFor(m.dn, kind);
  const hit = (m: WaterPipeModel) => !q || `${m.name} ${m.gost} dn${m.dn} ${m.material} ${m.notes ?? ""}`.toLowerCase().includes(q);
  const lines: PipeLine[] = ["main", "section", "face"];
  const groups = lines
    .map((l) => ({ l, items: all.filter((m) => lineOf(m) === l && (line === "all" || line === l) && hit(m)) }))
    .filter((g) => g.items.length > 0);
  const min = MIN_DN[kind];

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-[var(--c-b1)] flex-shrink-0">
        <div className="flex items-start gap-2 rounded-md px-2.5 py-2 text-[11px] leading-snug"
          style={{ background: "color-mix(in srgb, var(--c-accent, #1e5a7a) 8%, transparent)", color: "var(--c-t2)" }}>
          <Icon name="BookOpen" size={13} className="mt-px flex-shrink-0" style={{ color: "var(--c-accent, #1e5a7a)" }} />
          <span>
            {kind === "ore"
              ? <>Рудники (ФНиП, приказ Ростехнадзора № 505): магистральные линии — <b>не менее DN {min.main}</b>, участковые — <b>не менее DN {min.section}</b>, независимо от расчёта.</>
              : <>Угольные шахты (РД 05-366-00): магистральные линии — <b>не менее DN {min.main}</b>, участковые — <b>не менее DN {min.section}</b>; от резервуаров к стволу — не менее 150 мм.</>}
            {" "}Скорость воды — до {V_TECH} м/с при технологическом расходе и до {V_FIRE} м/с при пожаротушении.
            Трубу ветви выбирают в её свойствах («Трубы» → «Труба из справочника»).
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Seg value={kind} onChange={setKind}
            options={[{ id: "ore", label: "Рудник" }, { id: "coal", label: "Угольная шахта" }]} />
          <Seg value={line} onChange={setLine}
            options={[
              { id: "all", label: "Все", count: all.length },
              ...lines.map((l) => ({ id: l, label: PIPE_LINE_NAMES[l], count: all.filter((m) => lineOf(m) === l).length })),
            ]} />
          <div className="relative" style={{ width: 190 }}>
            <Icon name="Search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--c-t4)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="159×5, 8732, DN100…"
              className="w-full h-7 pl-7 pr-2 text-[12px] rounded-md outline-none border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t1)] focus:border-[var(--c-accent)]" />
          </div>
          <span className="flex-1" />
          {canEdit && (
            <button className={BTN_PRIMARY} onClick={() => setEditing(makeUserPipe())}>
              <Icon name="Plus" size={12} /> Своя труба
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-[12px] text-[var(--c-t4)]">
            <Icon name="SearchX" size={28} className="text-[var(--c-b3)]" />
            Ничего не найдено
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-[1]" style={{ background: "var(--c-s3, #f1efea)" }}>
              <tr>
                <th className={TH + " text-left"}>Труба, мм</th>
                <th className={TH + " text-left"}>Сортамент</th>
                <th className={TH + " text-right"}>DN</th>
                <th className={TH + " text-right"} title="Наружный диаметр − 2 × стенка">Внутр. Ø, мм</th>
                <th className={TH + " text-right"} title="Эквивалентная шероховатость для расчёта (трубы в эксплуатации)">Шерох., мм</th>
                <th className={TH + " text-right"} title={`Пропускная способность при ${V_TECH} м/с (технологический расход)`}>Q при {V_TECH} м/с</th>
                <th className={TH + " text-right"} title={`Пропускная способность при ${V_FIRE} м/с (пожаротушение)`}>Q при {V_FIRE} м/с</th>
                <th className={TH} style={{ width: 64 }} />
              </tr>
            </thead>
            {groups.map(({ l, items }) => (
              <tbody key={l}>
                <tr>
                  <td colSpan={8} className="px-3 pt-3 pb-1.5 border-b border-[var(--c-b1)]">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--c-t2)]">
                      <Icon name={LINE_ICON[l]} size={12} fallback="GitBranch" style={{ color: "var(--c-accent, #1e5a7a)" }} />
                      {PIPE_LINE_NAMES[l]}
                      <span className="font-normal text-[var(--c-t4)]">
                        · {l === "main" ? `DN ${min.main} и более` : l === "section" ? `DN ${min.section}–${min.main - 1}` : `меньше DN ${min.section}`}
                        {" · "}{PIPE_LINE_HINT[l]}
                      </span>
                    </span>
                  </td>
                </tr>
                {items.map((m) => {
                  const din = innerDiameter(m);
                  const e = MATERIAL_ROUGHNESS_MM[m.material] ?? 0.5;
                  return (
                    <tr key={m.id} className="group hover:bg-[var(--c-tint-blue)]">
                      <td className={TD}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold" style={NUM}>{m.name}</span>
                          {m.isUser && (
                            <span className="text-[9px] px-1 rounded font-semibold"
                              style={{ background: "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)", color: "var(--c-accent, #1e5a7a)" }}>
                              СВОЯ
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={TD}>
                        <div className="text-[11px]">{m.gost || "—"}</div>
                        <div className="text-[10px] text-[var(--c-t4)]">{[m.material, m.notes].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className={TD + " text-right"} style={NUM}>{m.dn}</td>
                      <td className={TD + " text-right font-semibold"} style={NUM}>{f1(din)}</td>
                      <td className={TD + " text-right text-[var(--c-t3)]"} style={NUM}>{String(e).replace(".", ",")}</td>
                      <td className={TD + " text-right"} style={NUM}>{Math.round(capacityM3h(m, V_TECH))} <span className="text-[10px] text-[var(--c-t4)]">м³/ч</span></td>
                      <td className={TD + " text-right"} style={NUM}>{Math.round(capacityM3h(m, V_FIRE))} <span className="text-[10px] text-[var(--c-t4)]">м³/ч</span></td>
                      <td className={TD + " text-right"}>
                        {canEdit && (
                          <span className="inline-flex gap-0.5 opacity-0 group-hover:opacity-100">
                            {m.isUser ? (
                              <>
                                <button title="Изменить" onClick={() => setEditing(m)} className={ICON_BTN}><Icon name="Pencil" size={12} /></button>
                                <button title="Удалить" onClick={() => remove(m)} className={ICON_BTN + " hover:text-[var(--c-red)]"}><Icon name="Trash2" size={12} /></button>
                              </>
                            ) : (
                              <button title="Создать свою на основе этой" onClick={() => setEditing(copyOf(m))} className={ICON_BTN}><Icon name="Copy" size={12} /></button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        )}
      </div>

      {editing && <UserPipeEditor initial={editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}
