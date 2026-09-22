import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/icon";

// ─────────────────────────────────────────────────────────────────────────────
// Диалог «Группа организаций»: создать новую головную организацию и отметить
// галочками записи, которые в неё входят, либо изменить состав существующей.
//
// Раньше группу можно было задать только по одной записи за раз — при двух
// десятках филиалов это двадцать открытий карточки подряд, где легко разойтись
// в написании названия и получить две почти одинаковые группы.
//
// Диалог общий для вкладок «Лицензии» и «Аварийный ключ»: там одни и те же
// филиалы и одна и та же задача, поэтому вызывающая сторона приводит свои
// записи к единому виду GroupItem, а не копирует весь диалог второй раз.
// ─────────────────────────────────────────────────────────────────────────────

/** Строка списка: то общее, что нужно диалогу от лицензии или аварийного ключа. */
export interface GroupItem {
  id: number;
  /** Название организации — первая строка. */
  title: string;
  /** Ключ или другой опознавательный код — вторая строка. */
  code: string;
  /** Текущая группа записи (пусто — вне групп). */
  group: string | null;
  /** Помечать ли строку как неактивную (отозвана / просрочена). */
  inactive?: boolean;
  /** Подпись справа, обычно «занято/всего мест». */
  meta?: string;
  /** Дополнительные слова для поиска (email и т.п.). */
  search?: string;
}

interface Props {
  /** null — диалог закрыт; "" — создание новой группы; иначе — правка существующей. */
  groupName: string | null;
  items: GroupItem[];
  /** Все уже заведённые группы — для подсказки и проверки на дубликат имени. */
  orgGroups: string[];
  onClose: () => void;
  /** Сохранение: имя группы и полный список входящих в неё записей. */
  onSave: (name: string, ids: number[], prevName: string) => Promise<void>;
  inputCls: string;
  /** Пометка для неактивных строк: у лицензий «ОТОЗВАНА», у ключей «НЕ ДЕЙСТВУЕТ». */
  inactiveLabel?: string;
}

export default function GroupDialog({
  groupName, items, orgGroups, onClose, onSave, inputCls,
  inactiveLabel = "ОТОЗВАНА",
}: Props) {
  const isNew = groupName === "";
  const [name, setName]       = useState("");
  const [picked, setPicked]   = useState<Set<number>>(new Set());
  const [query, setQuery]     = useState("");
  const [err, setErr]         = useState("");
  const [saving, setSaving]   = useState(false);

  // Состав подставляем один раз — при открытии диалога. Завязываться на
  // items нельзя: список обновляется в фоне, и отметки сбрасывались бы
  // прямо под руками администратора.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Исходный состав группы — по нему задаётся порядок строк в списке. */
  const initial = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (groupName === null) return;
    const ids = new Set(groupName
      ? itemsRef.current.filter(i => (i.group ?? "").trim() === groupName).map(i => i.id)
      : []);
    initial.current = ids;
    setName(groupName);
    setPicked(new Set(ids));
    setQuery("");
    setErr("");
  }, [groupName]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? items.filter(i =>
          i.title.toLowerCase().includes(q) ||
          i.code.toLowerCase().includes(q) ||
          (i.search ?? "").toLowerCase().includes(q))
      : items;
    // Входящие в группу — наверх: состав виден сразу, не листая весь список.
    // Порядок берём по исходному составу, а не по текущим галочкам: иначе
    // строка уезжала бы из-под курсора в момент клика.
    const base = initial.current;
    return [...list].sort((a, b) => Number(base.has(b.id)) - Number(base.has(a.id)));
  }, [items, query]);

  if (groupName === null) return null;

  const toggle = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setErr("Укажите название группы"); return; }
    if (trimmed !== groupName && orgGroups.includes(trimmed)) {
      setErr("Группа с таким названием уже есть — выберите её в списке и измените состав");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      await onSave(trimmed, Array.from(picked), groupName);
      onClose();
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <form onSubmit={submit}
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ background: "var(--c-blue-bg, #1a3a6b)" }}>
          <div className="text-white font-bold text-[14px] flex items-center gap-2">
            <Icon name="Building2" size={16} />
            {isNew ? "Новая группа организаций" : "Состав группы"}
          </div>
          <button type="button" onClick={onClose} className="text-white/70 hover:text-white">
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="flex-shrink-0">
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">Название группы *</label>
            <input type="text" value={name} autoFocus
              onChange={e => setName(e.target.value)}
              placeholder='ФГУП «ВГСЧ»'
              className={inputCls} />
            <div className="text-[10px] text-gray-400 mt-1">
              Отмеченные записи соберутся в раскрывающийся раздел. Снятая галочка выводит
              запись из группы — сама она остаётся.
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative flex-1">
              <Icon name="Search" size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Поиск по организации или ключу"
                className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <span className="text-[11px] text-gray-500 flex-shrink-0">
              Выбрано: <b className="text-blue-600">{picked.size}</b>
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
            {visible.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-[12px]">Ничего не найдено</div>
            ) : visible.map(it => {
              const own = (it.group ?? "").trim();
              const foreign = own && own !== groupName && !picked.has(it.id);
              return (
                <label key={it.id}
                  className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-blue-50 transition-colors">
                  <input type="checkbox" checked={picked.has(it.id)} onChange={() => toggle(it.id)}
                    className="mt-1 w-4 h-4 accent-blue-600 flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[12px]" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
                        {it.title}
                      </span>
                      {it.inactive && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-red-100 text-red-600 font-medium">{inactiveLabel}</span>
                      )}
                      {foreign && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-100 text-amber-700 font-medium"
                          title="Запись уже входит в другую группу — отметка перенесёт её сюда">
                          в группе «{own}»
                        </span>
                      )}
                    </span>
                    <span className="block font-mono text-[10px] text-blue-600 mt-0.5 truncate">{it.code}</span>
                  </span>
                  {it.meta && (
                    <span className="text-[10px] text-gray-500 flex-shrink-0 mt-1">{it.meta}</span>
                  )}
                </label>
              );
            })}
          </div>

          {err && (
            <div className="text-[12px] text-red-600 flex items-center gap-1 flex-shrink-0">
              <Icon name="AlertCircle" size={13} />{err}
            </div>
          )}

          <div className="flex gap-2 flex-shrink-0">
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--c-green-bg, #16a34a)" }}>
              {saving ? "Сохранение…" : isNew ? "Создать группу" : "Сохранить состав"}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-[13px] font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
              Отмена
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}