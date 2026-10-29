// Справочник «Потребители» (Трубопровод): пожарные стволы, распылители и
// установки пенного тушения. Поиск, фильтр по группам, свои модели —
// добавление, правка, удаление и «взять за основу» каталожную.
import { useState } from "react";
import Icon from "@/components/ui/icon";
import UserConsumerEditor from "@/components/cad/UserConsumerEditor";
import {
  CONSUMER_CATALOG, CONSUMER_GROUP_NAMES, makeUserConsumer,
  type WaterConsumerModel, type ConsumerGroup,
} from "@/lib/waterConsumers";

const BTN_PRIMARY =
  "h-7 px-3 inline-flex items-center justify-center gap-1 text-[11px] font-medium rounded-md text-white bg-[var(--c-accent)] hover:bg-[var(--c-accent-ink)] disabled:opacity-40 transition-colors";
const TH = "px-3 h-8 text-[10px] font-semibold uppercase tracking-wider text-[var(--c-t3)] border-b border-[var(--c-b2)] whitespace-nowrap";
const TD = "px-3 py-2 text-[12px] text-[var(--c-t1)] border-b border-[var(--c-b1)] align-middle";
const ICON_BTN = "w-6 h-6 inline-flex items-center justify-center rounded text-[var(--c-t3)] hover:bg-[var(--c-s3)]";

const GROUP_ICON: Record<ConsumerGroup, string> = { barrel: "Droplet", sprayer: "CloudDrizzle", foam: "Waves" };

// «Ствол пожарный РС-50 (выходное отверстие 16 мм)» → крупно «РС-50»,
// мелко — вид и подробности. Длинные названия больше не растягивают строку.
function splitName(name: string): { title: string; sub: string } {
  const m = name.match(/^(Ствол пожарный|Напорная пеногенераторная установка|УКТП)\s+(.+?)(?:\s*\((.+)\))?$/);
  if (m) return { title: m[2].replace(/[«»]/g, ""), sub: [m[1], m[3]].filter(Boolean).join(" · ") };
  const p = name.match(/^(.+?)\s*\((.+)\)$/);
  if (p) return { title: p[1], sub: p[2] };
  return { title: name, sub: "" };
}
const nf = (v: number, d = 1) => (v > 0 ? (+v.toFixed(d)).toLocaleString("ru") : "—");
const NUM = { fontFamily: "var(--font-num)" } as const;

export default function ConsumersSection({ userConsumers, onUserConsumersChange }: {
  userConsumers?: WaterConsumerModel[];
  onUserConsumersChange?: (list: WaterConsumerModel[]) => void;
}) {
  const own = userConsumers ?? [];
  const canEdit = !!onUserConsumersChange;
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ConsumerGroup | "all">("all");
  const [editing, setEditing] = useState<WaterConsumerModel | null>(null);

  const save = (c: WaterConsumerModel) => {
    const exists = own.some((x) => x.id === c.id);
    onUserConsumersChange?.(exists ? own.map((x) => (x.id === c.id ? c : x)) : [...own, c]);
    setEditing(null);
  };
  const remove = (c: WaterConsumerModel) => {
    if (!window.confirm(`Удалить «${c.name}» из справочника? У узлов, где он выбран, останутся введённые расход и диаметр.`)) return;
    onUserConsumersChange?.(own.filter((x) => x.id !== c.id));
  };
  const copyOf = (c: WaterConsumerModel): WaterConsumerModel =>
    ({ ...c, id: `user_cons_${Date.now()}`, name: `${c.name} (копия)`, isUser: true });

  const q = query.trim().toLowerCase();
  const all = [...own.map((c) => ({ ...c, isUser: true })), ...CONSUMER_CATALOG];
  const groups = (Object.keys(CONSUMER_GROUP_NAMES) as ConsumerGroup[])
    .map((g) => ({ g, items: all.filter((c) => c.group === g && (group === "all" || group === g) && (!q || c.name.toLowerCase().includes(q))) }))
    .filter((x) => x.items.length > 0);
  const countOf = (g: ConsumerGroup | "all") => all.filter((c) => g === "all" || c.group === g).length;

  return (
    <div className="flex flex-col h-full">
      {/* Описание, поиск, группы, добавление */}
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-[var(--c-b1)] flex-shrink-0">
        <div className="text-[11px] text-[var(--c-t3)] leading-snug">
          Потребители противопожарного водопровода. Модель выбирается в свойствах узла-потребителя
          («Трубы» → «Модель из библиотеки») — расход и диаметр отверстия подставятся сами.
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative" style={{ width: 230 }}>
            <Icon name="Search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--c-t4)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти: РС-50, ПУРГА…"
              className="w-full h-7 pl-7 pr-2 text-[12px] rounded-md outline-none border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t1)] focus:border-[var(--c-accent)]" />
          </div>
          <div className="flex p-0.5 rounded-md" style={{ background: "var(--c-s3, #f1efea)" }}>
            {(["all", ...Object.keys(CONSUMER_GROUP_NAMES)] as (ConsumerGroup | "all")[]).map((g) => {
              const on = group === g;
              return (
                <button key={g} type="button" onClick={() => setGroup(g)}
                  className="h-6 px-2.5 rounded text-[11px] transition-colors inline-flex items-center gap-1"
                  style={{
                    background: on ? "var(--c-s1, #fff)" : "transparent",
                    color: on ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)",
                    fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none",
                  }}>
                  {g === "all" ? "Все" : CONSUMER_GROUP_NAMES[g]}
                  <span className="text-[10px] opacity-70" style={NUM}>{countOf(g)}</span>
                </button>
              );
            })}
          </div>
          <span className="flex-1" />
          {canEdit && (
            <button className={BTN_PRIMARY} onClick={() => setEditing(makeUserConsumer(group === "all" ? "barrel" : group))}>
              <Icon name="Plus" size={12} /> Свой потребитель
            </button>
          )}
        </div>
      </div>

      {/* Таблица */}
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
                <th className={TH + " text-left"} style={{ width: "34%" }}>Наименование</th>
                <th className={TH + " text-right"} title="Диаметр выходного отверстия">Ø отв., мм</th>
                <th className={TH + " text-right"}>Расход, л/с</th>
                <th className={TH + " text-right"} title="Тот же расход в других единицах">м³/ч · л/мин</th>
                <th className={TH + " text-right"} title="Площадь тушения">Площадь, м²</th>
                <th className={TH + " text-right"} title="Дальность водяной струи">Струя</th>
                <th className={TH + " text-right"} title="Рабочее давление">Давление, МПа</th>
                <th className={TH} style={{ width: 64 }} />
              </tr>
            </thead>
            {groups.map(({ g, items }) => (
              <tbody key={g}>
                <tr>
                  <td colSpan={8} className="px-3 pt-3 pb-1.5 border-b border-[var(--c-b1)]">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--c-t2)]">
                      <Icon name={GROUP_ICON[g]} size={12} style={{ color: "var(--c-accent, #1e5a7a)" }} />
                      {CONSUMER_GROUP_NAMES[g]}
                      <span className="font-normal text-[var(--c-t4)]">· {items.length}</span>
                    </span>
                  </td>
                </tr>
                {items.map((c) => {
                  const { title, sub } = splitName(c.name);
                  const detail = [sub, c.notes].filter(Boolean).join(" · ");
                  return (
                    <tr key={c.id} className="group hover:bg-[var(--c-tint-blue)]">
                      <td className={TD}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium truncate" title={c.name}>{title}</span>
                          {c.isUser && (
                            <span className="text-[9px] px-1 rounded font-semibold flex-shrink-0"
                              style={{ background: "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)", color: "var(--c-accent, #1e5a7a)" }}>
                              СВОЙ
                            </span>
                          )}
                        </div>
                        {detail && <div className="text-[10px] text-[var(--c-t4)] truncate" title={detail}>{detail}</div>}
                      </td>
                      <td className={TD + " text-right"} style={NUM}>{c.outletDiameter > 0 ? c.outletDiameter : "—"}</td>
                      <td className={TD + " text-right font-semibold"} style={NUM}>{nf(c.flowLps)}</td>
                      <td className={TD + " text-right text-[var(--c-t3)] whitespace-nowrap"} style={NUM}>
                        {nf(c.flowM3h)} · {c.flowLmin > 0 ? c.flowLmin.toLocaleString("ru") : "—"}
                      </td>
                      <td className={TD + " text-right"} style={NUM}>{nf(c.extinguishArea)}</td>
                      <td className={TD + " text-right whitespace-nowrap"} style={NUM}>{c.jetRange}</td>
                      <td className={TD + " text-right whitespace-nowrap"} style={NUM}>
                        {c.workPressureMPa}
                        <div className="text-[10px] text-[var(--c-t4)]">{c.workPressureAtm} кгс/см²</div>
                      </td>
                      <td className={TD + " text-right"}>
                        {canEdit && (
                          <span className="inline-flex gap-0.5 opacity-0 group-hover:opacity-100">
                            {c.isUser ? (
                              <>
                                <button title="Изменить" onClick={() => setEditing(c)} className={ICON_BTN}>
                                  <Icon name="Pencil" size={12} />
                                </button>
                                <button title="Удалить" onClick={() => remove(c)} className={ICON_BTN + " hover:text-[var(--c-red)]"}>
                                  <Icon name="Trash2" size={12} />
                                </button>
                              </>
                            ) : (
                              <button title="Создать свой на основе этого" onClick={() => setEditing(copyOf(c))} className={ICON_BTN}>
                                <Icon name="Copy" size={12} />
                              </button>
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

      {editing && <UserConsumerEditor initial={editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}
