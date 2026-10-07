import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { adminApi } from "@/pages/admin/adminTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Кабинеты клиентов»: выдача организации (группе) ограниченного
// доступа к странице /client. Клиент видит только ключи своей группы и может
// лишь отвязывать ПК — создавать/удалять ключи и менять сроки он не может.
// ─────────────────────────────────────────────────────────────────────────────

interface ClientAccess {
  id: number;
  org_group: string;
  login: string;
  is_active: boolean;
  note: string | null;
  created_at: string;
  last_login_at: string | null;
  licenses_count: number;
  offline_keys_count: number;
}

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  return Array.from(arr, n => chars[n % chars.length]).join("");
}

function fmtDateTime(s: string | null) {
  if (!s || s === "None") return "никогда";
  return new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300";

export default function ClientAccessTab({ password }: { password: string }) {
  const [items, setItems] = useState<ClientAccess[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [group, setGroup] = useState("");
  const [login, setLogin] = useState("");
  const [pass, setPass] = useState(genPassword());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // Только что заданные данные для входа — показываем один раз, чтобы
  // администратор передал их клиенту. В базе пароль хранится только в виде хэша.
  const [issued, setIssued] = useState<{ group: string; login: string; pass: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const d = await adminApi(password, { action: "list_client_access" });
      setItems(d.items); setGroups(d.groups);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const freeGroups = groups.filter(g => !items.some(i => i.org_group === g));

  const create = async () => {
    setSaving(true); setErr("");
    try {
      await adminApi(password, { action: "create_client_access", org_group: group, login, client_password: pass, note });
      setIssued({ group, login: login.trim().toLowerCase(), pass });
      setGroup(""); setLogin(""); setNote(""); setPass(genPassword());
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  const resetPassword = async (it: ClientAccess) => {
    if (!confirm(`Сменить пароль для «${it.org_group}»? Старый пароль перестанет работать, клиент будет разлогинен.`)) return;
    const np = genPassword();
    try {
      await adminApi(password, { action: "set_client_password", client_access_id: it.id, client_password: np });
      setIssued({ group: it.org_group, login: it.login, pass: np });
    } catch (e) { setErr((e as Error).message); }
  };

  const toggle = async (it: ClientAccess) => {
    if (it.is_active && !confirm(`Отозвать доступ к кабинету для «${it.org_group}»?`)) return;
    try {
      await adminApi(password, { action: "toggle_client_access", client_access_id: it.id, is_active: !it.is_active });
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  const cabinetUrl = `${window.location.origin}/client`;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Icon name="Users" size={18} className="text-[#1a3a6b]" />
          <h2 className="text-[15px] font-bold text-[#1a3a6b]">Кабинеты клиентов</h2>
        </div>
        <p className="text-[12px] text-gray-500 mb-4">
          Отдельный вход для организации по адресу{" "}
          <a href="/client" target="_blank" className="text-blue-600 underline">{cabinetUrl}</a>.
          Клиент видит только ключи своей группы, может отвязать ПК и сбросить привязку аварийного ключа.
          Создавать, удалять ключи и менять сроки или число мест он не может. Все его действия попадают в журнал с пометкой «клиент».
        </p>

        {issued && (
          <div className="mb-4 rounded-lg border border-green-300 bg-green-50 p-4 text-[13px]">
            <div className="font-semibold text-green-800 mb-2">
              Данные для входа — «{issued.group}». Передайте их клиенту: пароль больше не будет показан.
            </div>
            <div className="font-mono text-[12px] bg-white rounded p-2 border select-all whitespace-pre">
{`Адрес:  ${cabinetUrl}
Логин:  ${issued.login}
Пароль: ${issued.pass}`}
            </div>
            <div className="flex gap-2 mt-2">
              <button className="text-[12px] px-3 py-1 rounded bg-green-600 text-white"
                onClick={() => navigator.clipboard.writeText(`Адрес: ${cabinetUrl}\nЛогин: ${issued.login}\nПароль: ${issued.pass}`)}>
                <Icon name="Copy" size={12} className="inline mr-1" />Скопировать
              </button>
              <button className="text-[12px] px-3 py-1 rounded border" onClick={() => setIssued(null)}>Скрыть</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-gray-600 mb-1">Группа организации</label>
            <select className={inputCls} value={group} onChange={e => {
              setGroup(e.target.value);
              if (!login) setLogin(e.target.value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-|-$/g, ""));
            }}>
              <option value="">— выберите группу —</option>
              {freeGroups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-600 mb-1">Логин</label>
            <input className={inputCls} value={login} onChange={e => setLogin(e.target.value)} placeholder="polymetal" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-600 mb-1">Пароль (не короче 8 символов)</label>
            <div className="flex gap-2">
              <input className={inputCls + " font-mono"} value={pass} onChange={e => setPass(e.target.value)} />
              <button className="px-2 rounded-lg border text-gray-600" title="Сгенерировать" onClick={() => setPass(genPassword())}>
                <Icon name="RefreshCw" size={14} />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-600 mb-1">Примечание</label>
            <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="Кому выдан доступ" />
          </div>
        </div>
        {err && <div className="mt-3 text-[12px] text-red-600">{err}</div>}
        <button disabled={saving || !group || !login.trim() || pass.length < 8} onClick={create}
          className="mt-4 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-40"
          style={{ background: "var(--c-green-bg, #16a34a)" }}>
          <Icon name="KeyRound" size={14} className="inline mr-1" />Выдать доступ
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-4 py-2">Группа</th>
              <th className="text-left px-4 py-2">Логин</th>
              <th className="text-left px-4 py-2">Ключи</th>
              <th className="text-left px-4 py-2">Последний вход</th>
              <th className="text-left px-4 py-2">Статус</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                {loading ? "Загрузка…" : "Доступ к кабинету пока никому не выдан"}
              </td></tr>
            )}
            {items.map(it => (
              <tr key={it.id} className="border-t">
                <td className="px-4 py-2">
                  <div className="font-semibold text-gray-800">{it.org_group}</div>
                  {it.note && <div className="text-gray-400">{it.note}</div>}
                </td>
                <td className="px-4 py-2 font-mono">{it.login}</td>
                <td className="px-4 py-2 text-gray-600">{it.licenses_count} онлайн · {it.offline_keys_count} аварийных</td>
                <td className="px-4 py-2 text-gray-600">{fmtDateTime(it.last_login_at)}</td>
                <td className="px-4 py-2">
                  {it.is_active
                    ? <span className="px-2 py-0.5 rounded bg-green-100 text-green-700">включён</span>
                    : <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-500">отозван</span>}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button className="px-2 py-1 rounded border mr-2" onClick={() => resetPassword(it)}>Сменить пароль</button>
                  <button className={`px-2 py-1 rounded border ${it.is_active ? "text-red-600 border-red-200" : "text-green-700 border-green-200"}`}
                    onClick={() => toggle(it)}>
                    {it.is_active ? "Отозвать" : "Включить"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
