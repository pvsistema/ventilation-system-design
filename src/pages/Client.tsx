import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { API_URLS } from "@/lib/api-urls";
import {
  clientApi, AuthError, TOKEN_KEY, type ClientLicense, type ClientSeat,
  type ClientOfflineKey, type ClientOfflineSeat, type ClientEvent,
  fmtDate, fmtDateTime, daysLeft, EVENT_LABELS,
} from "@/pages/client/clientApi";

// ─────────────────────────────────────────────────────────────────────────────
// Кабинет клиента (/client). Организация видит только ключи своей группы,
// может отвязать ПК от онлайн-ключа, отключить ПК на аварийном ключе и
// сбросить привязку аварийного ключа при замене компьютера. Всё остальное
// (создание, удаление ключей, сроки, места) — только в панели администратора.
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "keys" | "seats" | "log";

interface Confirm {
  title: string;
  text: string;
  action: string;
  danger?: boolean;
  run: () => Promise<void>;
}

const BLUE = "var(--c-blue-bg, #1a3a6b)";

function ExpiryBadge({ expires }: { expires: string | null }) {
  const d = daysLeft(expires);
  if (d === null) return <span className="text-gray-500">бессрочно</span>;
  const cls = d < 0 ? "bg-red-100 text-red-700" : d <= 30 ? "bg-amber-100 text-amber-800" : "bg-green-50 text-green-700";
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] ${cls}`}>
      до {fmtDate(expires)}{d < 0 ? " · истёк" : d <= 30 ? ` · ${d} дн.` : ""}
    </span>
  );
}

function SeatsBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const full = used >= total;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded bg-gray-200 overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, background: full ? "#dc2626" : "#16a34a" }} />
      </div>
      <span className={`text-[12px] ${full ? "text-red-600 font-semibold" : "text-gray-700"}`}>{used} из {total}</span>
    </div>
  );
}

// ── Экран входа ─────────────────────────────────────────────────────────────
function Login({ onDone }: { onDone: (group: string, login: string) => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      const res = await fetch(API_URLS.clientLicenses, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", login, password }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(res.status === 401 ? "Неверный логин или пароль" : "Не удалось войти"); return; }
      sessionStorage.setItem(TOKEN_KEY, d.token);
      onDone(d.org_group, d.login);
    } catch { setErr("Нет связи с сервером"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: "linear-gradient(135deg,#0f172a,var(--c-blue-bg, #1e3a5f))" }}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: BLUE }}>
            <Icon name="Building2" size={22} className="text-white" />
          </div>
          <div>
            <div className="text-[16px] font-bold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>Кабинет организации</div>
            <div className="text-[11px] text-gray-400">ПВ-Система — лицензии и рабочие места</div>
          </div>
        </div>
        <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Логин</label>
        <input value={login} onChange={e => { setLogin(e.target.value); setErr(""); }} autoFocus
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300 mb-3" />
        <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Пароль</label>
        <input type="password" value={password} onChange={e => { setPassword(e.target.value); setErr(""); }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
        {err && <div className="mt-2 text-[12px] text-red-600">{err}</div>}
        <button type="submit" disabled={loading || !login || !password}
          className="mt-4 w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
          style={{ background: BLUE }}>
          {loading ? "Вход…" : "Войти"}
        </button>
      </form>
    </div>
  );
}

// ── Основная страница ───────────────────────────────────────────────────────
export default function Client() {
  const [authed, setAuthed] = useState<{ group: string; login: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("keys");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [licenses, setLicenses] = useState<ClientLicense[]>([]);
  const [offKeys, setOffKeys] = useState<ClientOfflineKey[]>([]);
  const [seats, setSeats] = useState<Record<number, ClientSeat[]>>({});
  const [offSeats, setOffSeats] = useState<Record<number, ClientOfflineSeat[]>>({});
  const [events, setEvents] = useState<ClientEvent[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setAuthed(null);
  }, []);

  const handleErr = useCallback((e: unknown) => {
    if (e instanceof AuthError) { logout(); return; }
    setErr((e as Error).message);
  }, [logout]);

  // Восстановление входа при обновлении страницы
  useEffect(() => {
    if (!sessionStorage.getItem(TOKEN_KEY)) { setChecking(false); return; }
    clientApi({ action: "whoami" })
      .then(d => setAuthed({ group: d.org_group, login: d.login }))
      .catch(() => sessionStorage.removeItem(TOKEN_KEY))
      .finally(() => setChecking(false));
  }, []);

  const loadKeys = useCallback(async () => {
    const [a, b] = await Promise.all([
      clientApi({ action: "list_licenses" }),
      clientApi({ action: "list_offline_keys" }),
    ]);
    setLicenses(a.licenses); setOffKeys(b.keys);
    return { lic: a.licenses as ClientLicense[], off: b.keys as ClientOfflineKey[] };
  }, []);

  const loadSeats = useCallback(async () => {
    const { lic, off } = await loadKeys();
    const [s1, s2] = await Promise.all([
      Promise.all(lic.map(l => clientApi({ action: "list_seats", license_id: l.id }).then(d => [l.id, d.seats] as const))),
      Promise.all(off.map(k => clientApi({ action: "list_offline_seats", offline_key_id: k.id }).then(d => [k.id, d.seats] as const))),
    ]);
    setSeats(Object.fromEntries(s1)); setOffSeats(Object.fromEntries(s2));
  }, [loadKeys]);

  const loadLog = useCallback(async () => {
    const d = await clientApi({ action: "list_events", limit: 300 });
    setEvents(d.events);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      if (tab === "keys") await loadKeys();
      else if (tab === "seats") await loadSeats();
      else await loadLog();
    } catch (e) { handleErr(e); }
    finally { setLoading(false); }
  }, [tab, loadKeys, loadSeats, loadLog, handleErr]);

  useEffect(() => { if (authed) reload(); }, [authed, reload]);

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try { await confirm.run(); await reload(); }
    catch (e) { handleErr(e); }
    finally { setBusy(false); setConfirm(null); }
  };

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(""), 4000); };

  const askRevoke = (lic: ClientLicense, s: ClientSeat) => setConfirm({
    title: "Отвязать компьютер?",
    text: `Компьютер «${s.hostname || "без имени"}» будет отвязан от ключа «${lic.owner_name}», место освободится. Если программа на этом ПК ещё используется, при следующем запуске она попробует занять место заново.`,
    action: "Отвязать", danger: true,
    run: async () => { await clientApi({ action: "revoke_seat", seat_id: s.id }); flash("Компьютер отвязан, место освобождено"); },
  });

  const askBlock = (k: ClientOfflineKey, s: ClientOfflineSeat) => setConfirm({
    title: s.is_blocked ? "Вернуть компьютер?" : "Отключить компьютер?",
    text: s.is_blocked
      ? `Компьютер «${s.hostname || "без имени"}» снова сможет работать по аварийному ключу «${k.org}».`
      : `Компьютер «${s.hostname || "без имени"}» перестанет работать по аварийному ключу «${k.org}» при следующей проверке (если есть связь). Место освободится.`,
    action: s.is_blocked ? "Вернуть" : "Отключить", danger: !s.is_blocked,
    run: async () => {
      await clientApi({ action: "block_offline_seat", seat_id: s.id, is_blocked: !s.is_blocked });
      flash(s.is_blocked ? "Компьютер возвращён" : "Компьютер отключён");
    },
  });

  const askReset = (k: ClientOfflineKey) => setConfirm({
    title: "Сбросить привязку аварийного ключа?",
    text: `Используйте при замене компьютера. Ключ «${k.org}» открепится от текущих ПК и закрепится за тем компьютером, который первым выйдет на связь. Сам ключ менять не нужно.`,
    action: "Сбросить привязку", danger: true,
    run: async () => { await clientApi({ action: "reset_offline_binding", offline_key_id: k.id }); flash("Привязка сброшена"); },
  });

  if (checking) return <div className="h-screen flex items-center justify-center text-gray-400 text-[14px]">Загрузка…</div>;
  if (!authed) return <Login onDone={(group, login) => setAuthed({ group, login })} />;

  const totalSeats = licenses.reduce((a, l) => a + l.max_seats, 0);
  const usedSeats = licenses.reduce((a, l) => a + l.used_seats, 0);
  const onlineSeats = licenses.reduce((a, l) => a + l.online_seats, 0);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "keys", label: "Ключи", icon: "Key" },
    { id: "seats", label: "Рабочие места", icon: "Monitor" },
    { id: "log", label: "Журнал", icon: "ScrollText" },
  ];

  return (
    <div className="h-screen overflow-y-auto" style={{ background: "var(--c-s3, #f1f5f9)" }}>
      <div className="h-14 flex items-center justify-between px-6 shadow-sm sticky top-0 z-20" style={{ background: BLUE }}>
        <div className="flex items-center gap-3">
          <Icon name="Building2" size={20} className="text-blue-300" />
          <span className="text-white font-bold text-[14px]">{authed.group}</span>
          <span className="text-blue-300 text-[12px]">Кабинет ПВ-Системы</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${tab === t.id ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
                <Icon name={t.icon} size={12} className="inline mr-1" />{t.label}
              </button>
            ))}
          </div>
          <button onClick={reload} className="flex items-center gap-1.5 text-[12px] text-blue-200 hover:text-white">
            <Icon name="RefreshCw" size={14} className={loading ? "animate-spin" : ""} />Обновить
          </button>
          <button onClick={logout} className="flex items-center gap-1.5 text-[12px] text-blue-200 hover:text-white">
            <Icon name="LogOut" size={14} />Выйти
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 pb-10 space-y-5">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-2">{err}</div>}
        {toast && <div className="rounded-lg bg-green-50 border border-green-200 text-green-700 text-[13px] px-4 py-2">{toast}</div>}

        {/* ── Ключи ── */}
        {tab === "keys" && <>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Онлайн-ключей", value: licenses.length },
              { label: "Мест занято", value: `${usedSeats} / ${totalSeats}` },
              { label: "Сейчас в работе", value: onlineSeats },
              { label: "Аварийных ключей", value: offKeys.length },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-xl shadow-sm p-4">
                <div className="text-[11px] text-gray-500 mb-1">{c.label}</div>
                <div className="text-[22px] font-bold text-[#1a3a6b]">{c.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b font-semibold text-[13px] text-[#1a3a6b] flex items-center gap-2">
              <Icon name="Wifi" size={15} />Онлайн-лицензии
            </div>
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-5 py-2">Площадка</th>
                  <th className="text-left px-3 py-2">Ключ</th>
                  <th className="text-left px-3 py-2">Срок</th>
                  <th className="text-left px-3 py-2">Места</th>
                  <th className="text-left px-3 py-2">Последняя активность</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map(l => (
                  <tr key={l.id} className="border-t">
                    <td className="px-5 py-2 font-semibold text-gray-800">
                      {l.owner_name}
                      {!l.is_active && <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">отключён</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-600">{l.key}</td>
                    <td className="px-3 py-2"><ExpiryBadge expires={l.expires_at} /></td>
                    <td className="px-3 py-2"><SeatsBar used={l.used_seats} total={l.max_seats} /></td>
                    <td className="px-3 py-2 text-gray-600">{fmtDateTime(l.last_activity)}</td>
                  </tr>
                ))}
                {licenses.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-gray-400">{loading ? "Загрузка…" : "Нет ключей"}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b font-semibold text-[13px] text-[#1a3a6b] flex items-center gap-2">
              <Icon name="LifeBuoy" size={15} />Аварийные офлайн-ключи
            </div>
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-5 py-2">Площадка</th>
                  <th className="text-left px-3 py-2">Срок</th>
                  <th className="text-left px-3 py-2">Места</th>
                  <th className="text-left px-3 py-2">Закреплён за ПК</th>
                  <th className="text-left px-3 py-2">Последняя проверка</th>
                </tr>
              </thead>
              <tbody>
                {offKeys.map(k => (
                  <tr key={k.id} className="border-t">
                    <td className="px-5 py-2 font-semibold text-gray-800">
                      {k.org}
                      {(!k.is_active || k.revoked_at) && <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">отозван</span>}
                    </td>
                    <td className="px-3 py-2"><ExpiryBadge expires={k.expires_at} /></td>
                    <td className="px-3 py-2"><SeatsBar used={k.used_seats} total={k.seats} /></td>
                    <td className="px-3 py-2 text-gray-600">
                      {k.bound_host || (k.bound ? "привязан" : k.autobind ? <span className="text-gray-400">ждёт первого ПК</span> : "—")}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{fmtDateTime(k.last_seen_at)}</td>
                  </tr>
                ))}
                {offKeys.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-gray-400">{loading ? "Загрузка…" : "Нет аварийных ключей"}</td></tr>}
              </tbody>
            </table>
          </div>
        </>}

        {/* ── Рабочие места ── */}
        {tab === "seats" && <>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b font-semibold text-[13px] text-[#1a3a6b] flex items-center gap-2">
              <Icon name="Wifi" size={15} />Компьютеры на онлайн-ключах
            </div>
            {licenses.map(l => (
              <div key={l.id} className="border-t first:border-t-0">
                <div className="px-5 py-2 bg-gray-50 flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-gray-800">{l.owner_name}</span>
                  <SeatsBar used={l.used_seats} total={l.max_seats} />
                </div>
                {(seats[l.id] || []).length === 0
                  ? <div className="px-5 py-2 text-[12px] text-gray-400">{loading ? "Загрузка…" : "Нет активированных ПК"}</div>
                  : (seats[l.id] || []).map(s => (
                    <div key={s.id} className="px-5 py-2 flex items-center gap-4 text-[12px] border-t border-gray-100">
                      <span className={`w-2 h-2 rounded-full ${s.online ? "bg-green-500" : "bg-gray-300"}`} title={s.online ? "На связи" : "Не на связи"} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-800 truncate">{s.hostname || "Без имени"}</div>
                        <div className="text-gray-400 truncate">{s.platform || ""}</div>
                      </div>
                      <div className="w-24 text-gray-600">{s.app_version ? `v${s.app_version}` : "—"}</div>
                      <div className="w-36 text-gray-600" title={`Активирован ${fmtDateTime(s.activated_at)}`}>
                        {s.online ? <span className="text-green-700">на связи</span> : fmtDateTime(s.last_seen_at)}
                      </div>
                      <button onClick={() => askRevoke(l, s)}
                        className="px-2.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50">
                        Отвязать
                      </button>
                    </div>
                  ))}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b font-semibold text-[13px] text-[#1a3a6b] flex items-center gap-2">
              <Icon name="LifeBuoy" size={15} />Компьютеры на аварийных ключах
            </div>
            {offKeys.map(k => (
              <div key={k.id} className="border-t first:border-t-0">
                <div className="px-5 py-2 bg-gray-50 flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-gray-800">{k.org}</span>
                  <div className="flex items-center gap-4">
                    <SeatsBar used={k.used_seats} total={k.seats} />
                    <button onClick={() => askReset(k)}
                      className="px-2.5 py-1 rounded border border-amber-300 text-amber-800 hover:bg-amber-50"
                      title="При замене компьютера">
                      <Icon name="RotateCcw" size={12} className="inline mr-1" />Сбросить привязку
                    </button>
                  </div>
                </div>
                {(offSeats[k.id] || []).length === 0
                  ? <div className="px-5 py-2 text-[12px] text-gray-400">{loading ? "Загрузка…" : "Ключ ещё не отмечался ни на одном ПК"}</div>
                  : (offSeats[k.id] || []).map(s => (
                    <div key={s.id} className={`px-5 py-2 flex items-center gap-4 text-[12px] border-t border-gray-100 ${s.is_blocked ? "opacity-60" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-800 truncate">
                          {s.hostname || "Без имени"}
                          {s.is_blocked && <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px]">отключён</span>}
                        </div>
                        <div className="text-gray-400 truncate">{s.platform || ""}</div>
                      </div>
                      <div className="w-24 text-gray-600">{s.app_version ? `v${s.app_version}` : "—"}</div>
                      <div className="w-36 text-gray-600">{fmtDateTime(s.last_seen_at)}</div>
                      <button onClick={() => askBlock(k, s)}
                        className={`px-2.5 py-1 rounded border ${s.is_blocked ? "border-green-200 text-green-700 hover:bg-green-50" : "border-red-200 text-red-600 hover:bg-red-50"}`}>
                        {s.is_blocked ? "Вернуть" : "Отключить"}
                      </button>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </>}

        {/* ── Журнал ── */}
        {tab === "log" && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-5 py-2 w-36">Время</th>
                  <th className="text-left px-3 py-2">Событие</th>
                  <th className="text-left px-3 py-2">Ключ</th>
                  <th className="text-left px-3 py-2">Компьютер</th>
                  <th className="text-left px-3 py-2">Подробности</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => {
                  const byClient = (e.detail || "").startsWith("клиент (");
                  const byAdmin = (e.detail || "").includes("by admin");
                  return (
                    <tr key={e.id} className="border-t align-top">
                      <td className="px-5 py-2 text-gray-600 whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
                      <td className="px-3 py-2 text-gray-800">
                        {EVENT_LABELS[e.event_type] || e.event_type}
                        {byClient && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px]">клиент</span>}
                        {byAdmin && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">поставщик</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{e.license || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{e.hostname || "—"}{e.app_version ? ` · v${e.app_version}` : ""}</td>
                      <td className="px-3 py-2 text-gray-500 break-words max-w-xs">{byAdmin ? "" : e.detail}</td>
                    </tr>
                  );
                })}
                {events.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-gray-400">{loading ? "Загрузка…" : "Событий пока нет"}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={o => { if (!o && !busy) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={busy}
              onClick={e => { e.preventDefault(); runConfirm(); }}
              className={confirm?.danger ? "bg-red-600 hover:bg-red-700" : ""}>
              {busy ? "Выполняю…" : confirm?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
