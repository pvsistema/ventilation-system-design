import { useState, useEffect, useCallback, useMemo } from "react";
import Icon from "@/components/ui/icon";
import MonitoringTab from "@/pages/admin/MonitoringTab";
// Вкладки панели вынесены в отдельные файлы (перенос 1:1, без правок логики)
import UpdateTab from "@/pages/admin/UpdateTab";
import ServerTab from "@/pages/admin/ServerTab";
import EmergencyTab from "@/pages/admin/EmergencyTab";
// Разделы, вынесенные из этого файла (перенос 1:1):
//   adminTypes      — типы данных, обращение к серверу, формат дат
//   AdminLogin      — экран входа по паролю
//   LicensesTab     — вкладка «Лицензии» со списком рабочих мест
//   LicenseDialogs  — диалоги создания и редактирования лицензии
import {
  type License, type OfflineKey, type OfflineSeat, type Seat, type LicenseForm,
  type MonitoringData, adminApi, toInputDate, emptyForm,
} from "@/pages/admin/adminTypes";
import { invalidateRemoteVersion } from "@/lib/updater";
import AdminLogin from "@/pages/admin/AdminLogin";
import LicensesTab from "@/pages/admin/LicensesTab";
import LicenseDialogs from "@/pages/admin/LicenseDialogs";

// MonitoringData используют вкладки мониторинга — реэкспортируем, чтобы
// внешние импорты «@/pages/Admin» продолжали работать без правок.
export type { MonitoringData } from "@/pages/admin/adminTypes";


export default function Admin() {
  const [password, setPassword]         = useState("");
  const [authed, setAuthed]             = useState(false);
  const [authErr, setAuthErr]           = useState("");
  const [licenses, setLicenses]         = useState<License[]>([]);
  // Уже заведённые группы организаций — подсказка в диалогах, чтобы филиалы
  // не разъезжались по разным разделам из-за опечатки в названии.
  const orgGroups = useMemo(
    () => Array.from(new Set(licenses.map(l => (l.org_group ?? "").trim()).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b, "ru")),
    [licenses],
  );
  const [loading, setLoading]           = useState(false);
  const [seats, setSeats]               = useState<Seat[] | null>(null);
  const [seatsForId, setSeatsForId]     = useState<number | null>(null);
  // Когда данные о лицензиях последний раз пришли с сервера. Нужно, чтобы
  // администратор видел возраст цифр перед глазами: решения об освобождении
  // мест принимаются именно по этой таблице.
  const [licSyncAt, setLicSyncAt]       = useState<number | null>(null);
  // Тикающие часы — чтобы подпись «обновлено N сек назад» старела сама.
  // Без этого надпись замерла бы на «только что» до следующего обновления.
  const [nowTick, setNowTick]           = useState(Date.now());

  // Создание
  const [showCreate, setShowCreate]     = useState(false);
  const [generatedKey, setGeneratedKey] = useState("");
  const [form, setForm]                 = useState<LicenseForm>(emptyForm);
  const [createErr, setCreateErr]       = useState("");
  const [createOk, setCreateOk]         = useState(false);

  // Редактирование
  const [editingLic, setEditingLic]     = useState<License | null>(null);
  const [editForm, setEditForm]         = useState<LicenseForm>(emptyForm);
  const [editErr, setEditErr]           = useState("");
  const [editOk, setEditOk]             = useState(false);
  const [editSaving, setEditSaving]     = useState(false);

  // Вкладки
  const [activeTab, setActiveTab]       = useState<"licenses" | "monitoring" | "update" | "server" | "emergency">("licenses");

  // Аварийный оффлайн-ключ
  const [emgOrg, setEmgOrg]             = useState("");
  const [emgExpires, setEmgExpires]     = useState("");
  const [emgKey, setEmgKey]             = useState("");
  const [emgErr, setEmgErr]             = useState("");
  const [emgLoading, setEmgLoading]     = useState(false);
  // Сколько ПК разрешено ключу и привязка к конкретному компьютеру.
  const [emgSeats, setEmgSeats]         = useState("5");
  const [emgBindFp, setEmgBindFp]       = useState("");

  // Рабочие места, отметившиеся по аварийному ключу (раскрывающийся список)
  const [okSeatsForId, setOkSeatsForId] = useState<number | null>(null);
  const [okSeats, setOkSeats]           = useState<OfflineSeat[] | null>(null);

  // Реестр выпущенных аварийных ключей
  const [offlineKeys, setOfflineKeys]   = useState<OfflineKey[]>([]);
  const [okLoading, setOkLoading]       = useState(false);
  const [okEditId, setOkEditId]         = useState<number | null>(null);
  const [okEditOrg, setOkEditOrg]       = useState("");
  const [okEditExp, setOkEditExp]       = useState("");
  const [okEditSeats, setOkEditSeats]   = useState("999");
  const [okEditNotes, setOkEditNotes]   = useState("");
  const [okShowKeyId, setOkShowKeyId]   = useState<number | null>(null);

  // Расчётный сервер (основной / аварийный резерв)
  const [srvActive, setSrvActive]       = useState<"primary" | "backup">("primary");
  const [srvBackupUrl, setSrvBackupUrl] = useState("");
  const [srvAutofail, setSrvAutofail]   = useState(true);
  const [srvCfgLoading, setSrvCfgLoading] = useState(false);
  const [srvCfgSaving, setSrvCfgSaving] = useState(false);
  const [srvCfgOk, setSrvCfgOk]         = useState(false);
  const [srvCfgErr, setSrvCfgErr]       = useState("");

  // Мониторинг
  const [monitoring, setMonitoring]     = useState<MonitoringData | null>(null);
  const [monLoading, setMonLoading]     = useState(false);

  // Обновление PVS.exe (установщик)
  const [currentVersion, setCurrentVersion] = useState<{version: string; notes: string; server_version?: string; server_signed?: boolean; exe_signed?: boolean} | null>(null);
  const [updVersion, setUpdVersion]     = useState("");
  const [updNotes, setUpdNotes]         = useState("");
  const [updStatus, setUpdStatus]       = useState<"idle"|"uploading"|"ok"|"err">("idle");
  const [updErr, setUpdErr]             = useState("");
  const [updUrl, setUpdUrl]             = useState("");

  // Обновление server.exe (расчётное ядро)
  const [srvVersion, setSrvVersion]     = useState("");
  const [srvStatus, setSrvStatus]       = useState<"idle"|"uploading"|"ok"|"err">("idle");
  const [srvErr, setSrvErr]             = useState("");
  const [srvUrl, setSrvUrl]             = useState("");
  // Порог обязательного обновления по безопасности: версии ниже получают
  // блокирующее окно вместо закрываемого баннера.
  const [minSecure, setMinSecure]       = useState("");
  const [secNotes, setSecNotes]         = useState("");
  const [secStatus, setSecStatus]       = useState<"idle"|"uploading"|"ok"|"err">("idle");
  const [secErr, setSecErr]             = useState("");

  const VERSION_URL = "https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16";

  const loadLicenses = useCallback(async (pwd: string) => {
    setLoading(true);
    try {
      const data = await adminApi(pwd, { action: "list_licenses" });
      setLicenses(data.licenses);
      setLicSyncAt(Date.now());
      setAuthed(true);
    } catch (e: unknown) {
      setAuthErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMonitoring = useCallback(async (pwd: string) => {
    setMonLoading(true);
    try {
      const data = await adminApi(pwd, { action: "monitoring_overview" });
      setMonitoring(data);
    } catch { /* ignore */ }
    finally { setMonLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === "monitoring" && authed) loadMonitoring(password);
  }, [activeTab, authed, password, loadMonitoring]);

  const loadServerCfg = useCallback(async (pwd: string) => {
    setSrvCfgLoading(true);
    setSrvCfgErr("");
    try {
      const data = await adminApi(pwd, { action: "get_compute_config" });
      setSrvActive(data.active === "backup" ? "backup" : "primary");
      setSrvBackupUrl(data.backup_url || "");
      setSrvAutofail(data.autofailover !== false);
    } catch (e: unknown) {
      setSrvCfgErr(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setSrvCfgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "server" && authed) loadServerCfg(password);
  }, [activeTab, authed, password, loadServerCfg]);

  const saveServerCfg = async () => {
    setSrvCfgSaving(true);
    setSrvCfgErr("");
    setSrvCfgOk(false);
    try {
      await adminApi(password, {
        action: "set_compute_config",
        active: srvActive,
        backup_url: srvBackupUrl.trim(),
        autofailover: srvAutofail,
      });
      setSrvCfgOk(true);
      setTimeout(() => setSrvCfgOk(false), 2000);
    } catch (e: unknown) {
      setSrvCfgErr(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSrvCfgSaving(false);
    }
  };

  // Мгновенное ручное переключение расчётов между серверами: меняет активный
  // сервер и СРАЗУ сохраняет — без отдельного нажатия «Сохранить».
  const switchServer = async (target: "primary" | "backup") => {
    if (target === "backup" && !srvBackupUrl.trim()) {
      setSrvCfgErr("Сначала укажите адрес аварийного сервера");
      return;
    }
    setSrvActive(target);
    setSrvCfgSaving(true);
    setSrvCfgErr("");
    setSrvCfgOk(false);
    try {
      await adminApi(password, {
        action: "set_compute_config",
        active: target,
        backup_url: srvBackupUrl.trim(),
        autofailover: srvAutofail,
      });
      setSrvCfgOk(true);
      setTimeout(() => setSrvCfgOk(false), 2000);
    } catch (e: unknown) {
      setSrvCfgErr(e instanceof Error ? e.message : "Ошибка переключения");
    } finally {
      setSrvCfgSaving(false);
    }
  };

  const loadOfflineKeys = useCallback(async (pwd: string) => {
    setOkLoading(true);
    try {
      const data = await adminApi(pwd, { action: "list_offline_keys" });
      setOfflineKeys(data.keys || []);
    } catch { /* ignore */ }
    finally { setOkLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === "emergency" && authed) loadOfflineKeys(password);
  }, [activeTab, authed, password, loadOfflineKeys]);

  const generateEmergencyKey = async () => {
    if (!emgOrg.trim()) { setEmgErr("Укажите организацию"); return; }
    setEmgLoading(true);
    setEmgErr("");
    setEmgKey("");
    try {
      const data = await adminApi(password, {
        action: "create_offline_key",
        org: emgOrg.trim(),
        days: 365,
        expires_at: emgExpires || undefined,
        seats: parseInt(emgSeats) || 5,
        bound_fp: emgBindFp.trim() || undefined,
      });
      setEmgKey(data.key);
      loadOfflineKeys(password);
    } catch (e: unknown) {
      setEmgErr(e instanceof Error ? e.message : "Ошибка генерации");
    } finally {
      setEmgLoading(false);
    }
  };

  // Список ПК, отметившихся по аварийному ключу (наполняется квартальной сверкой)
  const loadOfflineSeats = async (k: OfflineKey) => {
    if (okSeatsForId === k.id) { setOkSeatsForId(null); setOkSeats(null); return; }
    const data = await adminApi(password, { action: "list_offline_seats", offline_key_id: k.id });
    setOkSeats(data.seats || []);
    setOkSeatsForId(k.id);
  };

  // Отключить/вернуть отдельный компьютер, не отзывая ключ целиком
  const blockOfflineSeat = async (s: OfflineSeat) => {
    await adminApi(password, {
      action: "block_offline_seat", seat_id: s.id, is_blocked: !s.is_blocked,
    });
    setOkSeats(list => list ? list.map(x => x.id === s.id ? { ...x, is_blocked: !x.is_blocked } : x) : null);
  };

  const startEditOffline = (k: OfflineKey) => {
    setOkEditId(k.id);
    setOkEditOrg(k.org);
    setOkEditExp(k.expires_at ? k.expires_at.slice(0, 10) : "");
    setOkEditSeats(String(k.seats));
    setOkEditNotes(k.notes || "");
  };

  const saveEditOffline = async () => {
    if (okEditId == null) return;
    if (!okEditOrg.trim()) return;
    try {
      await adminApi(password, {
        action: "update_offline_key",
        offline_key_id: okEditId,
        org: okEditOrg.trim(),
        seats: parseInt(okEditSeats) || 999,
        expires_at: okEditExp || undefined,
        notes: okEditNotes.trim(),
      });
      setOkEditId(null);
      loadOfflineKeys(password);
    } catch { /* ignore */ }
  };

  const toggleOffline = async (k: OfflineKey) => {
    await adminApi(password, { action: "toggle_offline_key", offline_key_id: k.id, is_active: !k.is_active });
    loadOfflineKeys(password);
  };

  const deleteOffline = async (k: OfflineKey) => {
    const warn = k.used_seats > 0
      ? `\n\nПо ключу отметилось компьютеров: ${k.used_seats}. Записи о них тоже будут удалены.`
      : "";
    if (!confirm(`Удалить аварийный ключ «${k.org}» из реестра?${warn}`)) return;
    try {
      await adminApi(password, { action: "delete_offline_key", offline_key_id: k.id });
      loadOfflineKeys(password);
    } catch (e: unknown) {
      // Раньше сбой удаления не показывался вовсе: кнопка «не работала» молча.
      alert(`Не удалось удалить ключ: ${e instanceof Error ? e.message : "ошибка запроса"}`);
    }
  };

  useEffect(() => {
    localStorage.removeItem("pvs_admin_pwd");
  }, []);

  /**
   * Тихое обновление списка лицензий — без индикатора загрузки.
   *
   * Отдельно от loadLicenses: тот показывает «загрузку» и уместен при входе и
   * при нажатии «Обновить». Для фонового обновления мигание неприемлемо —
   * человек в этот момент читает таблицу или ведёт мышь к кнопке.
   * Ошибки намеренно молчат: пропавшая на минуту связь не должна выкидывать
   * администратора на экран входа.
   */
  const refreshLicensesQuiet = useCallback(async (pwd: string, openSeatsFor?: number | null) => {
    try {
      const data = await adminApi(pwd, { action: "list_licenses" });
      setLicenses(data.licenses);
      setLicSyncAt(Date.now());
      // Если у лицензии раскрыт список рабочих мест — освежаем и его: иначе
      // счётчик показывал бы новое число, а список под ним — прежние машины.
      if (openSeatsFor) {
        const s = await adminApi(pwd, { action: "list_seats", license_id: openSeatsFor });
        setSeats(s.seats);
      }
    } catch { /* нет связи — покажем прежние данные, повторим на следующем круге */ }
  }, []);

  /**
   * Пока открыта вкладка «Лицензии», список сам обновляется раз в 20 секунд.
   *
   * ЗАЧЕМ. Число занятых мест меняется без участия администратора: люди
   * активируются и отключаются сами. Раньше таблица показывала снимок на
   * момент входа — администратор видел «5 из 5», хотя места уже освободились,
   * и делал вывод, что программа не работает.
   *
   * Обновление идёт ТОЛЬКО на своей вкладке и ТОЛЬКО когда окно на экране:
   * незачем дёргать сервер, пока панель свёрнута.
   */
  useEffect(() => {
    if (!authed || activeTab !== "licenses") return;
    const tick = () => {
      if (document.visibilityState === "visible") refreshLicensesQuiet(password, seatsForId);
    };
    const id = setInterval(tick, 20000);
    // Вернулись к свёрнутому окну — показываем свежие данные сразу, не ожидая
    // следующего круга: именно в этот момент на таблицу и смотрят.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [authed, activeTab, password, seatsForId, refreshLicensesQuiet]);

  /**
   * Часы для подписи «обновлено N назад» — тикают раз в 5 секунд.
   *
   * Считать возраст только в момент загрузки данных нельзя: надпись застыла бы
   * на «только что» и вводила бы в заблуждение ровно в том случае, ради
   * которого её и добавляли — когда связь пропала и цифры устарели.
   */
  useEffect(() => {
    if (!authed || activeTab !== "licenses") return;
    const id = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, [authed, activeTab]);

  /** Человеческая подпись возраста данных: «только что», «2 мин назад». */
  const licSyncLabel = useMemo(() => {
    if (!licSyncAt) return "";
    const sec = Math.max(0, Math.round((nowTick - licSyncAt) / 1000));
    if (sec < 10) return "только что";
    if (sec < 60) return `${sec} сек назад`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} мин назад`;
    const h = Math.round(min / 60);
    return `${h} ч назад`;
  }, [licSyncAt, nowTick]);

  /**
   * Данные заметно устарели — связи с сервером нет дольше минуты.
   *
   * Обновление идёт каждые 20 секунд, поэтому больше минуты молчания означает,
   * что запросы не проходят. Об этом честно предупреждаем: решение об
   * освобождении мест по устаревшей таблице — источник как раз тех обращений,
   * ради которых всё и затевалось.
   */
  const licSyncStale = !!licSyncAt && nowTick - licSyncAt > 60000;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr("");
    await loadLicenses(password);
  };

  const generateKey = async () => {
    const data = await adminApi(password, { action: "generate_key" });
    setGeneratedKey(data.key);
    setForm(f => ({ ...f, key: data.key }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateErr("");
    setCreateOk(false);
    try {
      await adminApi(password, {
        action: "create_license",
        owner_name: form.owner_name,
        org_group: form.org_group || undefined,
        owner_email: form.owner_email || undefined,
        max_seats: parseInt(form.max_seats),
        expires_at: form.expires_at || undefined,
        notes: form.notes || undefined,
        key: form.key || undefined,
      });
      setCreateOk(true);
      setForm(emptyForm);
      setGeneratedKey("");
      await loadLicenses(password);
      setTimeout(() => { setShowCreate(false); setCreateOk(false); }, 1500);
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : "Ошибка создания");
    }
  };

  const openEdit = (lic: License) => {
    setEditingLic(lic);
    setEditForm({
      owner_name: lic.owner_name,
      org_group: lic.org_group ?? "",
      owner_email: lic.owner_email ?? "",
      max_seats: String(lic.max_seats),
      expires_at: toInputDate(lic.expires_at),
      notes: lic.notes ?? "",
      key: lic.key,
    });
    setEditErr("");
    setEditOk(false);
  };

  const closeEdit = () => {
    setEditingLic(null);
    setEditErr("");
    setEditOk(false);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLic) return;
    setEditErr("");
    setEditOk(false);
    setEditSaving(true);
    try {
      await adminApi(password, {
        action: "update_license",
        license_id: editingLic.id,
        owner_name: editForm.owner_name,
        org_group: editForm.org_group || undefined,
        owner_email: editForm.owner_email || undefined,
        max_seats: parseInt(editForm.max_seats),
        expires_at: editForm.expires_at || undefined,
        notes: editForm.notes || undefined,
      });
      setEditOk(true);
      // Обновляем локальный список без перезагрузки
      setLicenses(ls => ls.map(l => l.id === editingLic.id ? {
        ...l,
        owner_name: editForm.owner_name,
        org_group: editForm.org_group || null,
        owner_email: editForm.owner_email || null,
        max_seats: parseInt(editForm.max_seats),
        expires_at: editForm.expires_at || null,
        notes: editForm.notes || null,
      } : l));
      setTimeout(() => closeEdit(), 1200);
    } catch (e: unknown) {
      setEditErr(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setEditSaving(false);
    }
  };

  const toggleLicense = async (id: number, is_active: boolean) => {
    await adminApi(password, { action: "toggle_license", license_id: id, is_active });
    setLicenses(ls => ls.map(l => l.id === id ? { ...l, is_active } : l));
  };

  const deleteLicense = async (id: number, name: string) => {
    if (!confirm(`Удалить лицензию "${name}"? Все рабочие места будут сброшены.`)) return;
    await adminApi(password, { action: "delete_license", license_id: id });
    setLicenses(ls => ls.filter(l => l.id !== id));
  };

  const loadSeats = async (id: number) => {
    if (seatsForId === id) { setSeatsForId(null); setSeats(null); return; }
    const data = await adminApi(password, { action: "list_seats", license_id: id });
    setSeats(data.seats);
    setSeatsForId(id);
  };

  /**
   * Освободить рабочее место.
   *
   * После удаления счётчик занятых мест берём С СЕРВЕРА, а не уменьшаем на
   * единицу «на глазок». Раньше показывалось предполагаемое число: если в этот
   * же момент кто-то активировался или места освобождали из двух вкладок,
   * цифра расходилась с действительностью. Человек видел «1 из 5», звонил и
   * говорил, что места не освобождаются, хотя на сервере всё было верно.
   */
  const revokeSeat = async (seatId: number) => {
    await adminApi(password, { action: "revoke_seat", seat_id: seatId });
    setSeats(s => s ? s.filter(x => x.id !== seatId) : null);
    await loadLicenses(password);
  };

  const loadCurrentVersion = async () => {
    try {
      const r = await fetch(VERSION_URL);
      const text = await r.text();
      if (!text.trim().startsWith("{")) { setCurrentVersion(null); return; }
      const d = JSON.parse(text);
      setCurrentVersion({
        version: d.version || "—",
        notes: d.notes || "",
        server_version: d.server_version || "—",
        // Ядро считается защищённым, если сервер выдал и контрольную сумму,
        // и подпись — программа сможет проверить целостность обновления.
        server_signed: !!(d.server_sha256 && d.server_sig),
        // То же для установщика — подпись подтверждает подлинность файла.
        exe_signed: !!(d.exe_sha256 && d.exe_sig),
      });
      // Подтягиваем текущий порог безопасности. Если он ещё не задан —
      // подставляем текущую версию как готовое предложение: администратору
      // остаётся нажать кнопку, а не вспоминать номер сборки вручную.
      const savedMin = d.min_secure_version || "";
      setMinSecure(savedMin || d.version || "");
      setSecNotes(d.security_notes || (savedMin ? "" : "Устранена уязвимость в защите программы"));
    } catch { setCurrentVersion(null); }
  };

  // ── Сохранить порог обязательного обновления ──
  const handleSaveMinSecure = async () => {
    setSecStatus("uploading");
    setSecErr("");
    try {
      const res = await fetch(VERSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Password": password },
        body: JSON.stringify({
          action: "set_min_secure",
          min_secure_version: minSecure.trim(),
          security_notes: secNotes.trim(),
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.startsWith("{") ? (JSON.parse(text).error || "Ошибка") : `HTTP ${res.status}`);
      setSecStatus("ok");
      // Порог изменился — сбрасываем кэш, чтобы программы узнали о требовании.
      invalidateRemoteVersion();
      setTimeout(() => setSecStatus("idle"), 2500);
    } catch (err: unknown) {
      setSecStatus("err");
      setSecErr(err instanceof Error ? err.message : "Ошибка сохранения");
    }
  };

  useEffect(() => { if (activeTab === "update") loadCurrentVersion(); }, [activeTab]);

  // ── Опубликовать установщик: сохранить публичную ссылку Я.Диска ──
  const handleUploadExeFromUrl = async () => {
    if (!updUrl.trim() || !updVersion) return;
    setUpdStatus("uploading");
    setUpdErr("");
    try {
      const res = await fetch(VERSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Password": password },
        body: JSON.stringify({ action: "set_url", file_type: "exe", url: updUrl.trim(), version: updVersion, notes: updNotes }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.startsWith("{") ? (JSON.parse(text).error || "Ошибка") : `HTTP ${res.status}`);
      setUpdStatus("ok");
      // Опубликовали новую сборку — сбрасываем кэш версии, чтобы страница
      // скачивания и баннер обновления сразу увидели свежие данные.
      invalidateRemoteVersion();
      // Ответ содержит info с актуальными полями (в т.ч. exe_sha256/exe_sig) —
      // берём признак подписи оттуда, чтобы отметка сразу была верной.
      let exeSigned = false;
      try {
        const info = JSON.parse(text).info;
        exeSigned = !!(info?.exe_sha256 && info?.exe_sig);
      } catch { /* оставим false */ }
      setCurrentVersion(prev => ({
        version: updVersion,
        notes: updNotes,
        server_version: prev?.server_version,
        server_signed: prev?.server_signed,
        exe_signed: exeSigned,
      }));
      setUpdVersion("");
      setUpdNotes("");
    } catch (err: unknown) {
      setUpdStatus("err");
      setUpdErr(err instanceof Error ? err.message : "Ошибка публикации");
    }
  };

  // ── Опубликовать расчётное ядро: сохранить публичную ссылку Я.Диска ──
  const handleUploadServerFromUrl = async () => {
    if (!srvUrl.trim() || !srvVersion) return;
    setSrvStatus("uploading");
    setSrvErr("");
    try {
      const res = await fetch(VERSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Password": password },
        body: JSON.stringify({ action: "set_url", file_type: "server", url: srvUrl.trim(), server_version: srvVersion }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.startsWith("{") ? (JSON.parse(text).error || "Ошибка") : `HTTP ${res.status}`);
      setSrvStatus("ok");
      // Успешная публикация ядра означает, что сервер посчитал сумму и подписал
      // её (иначе он вернул бы ошибку) — сразу отмечаем ядро защищённым.
      setCurrentVersion(prev => prev ? { ...prev, server_version: srvVersion, server_signed: true } : null);
      setSrvVersion("");
    } catch (err: unknown) {
      setSrvStatus("err");
      setSrvErr(err instanceof Error ? err.message : "Ошибка загрузки по ссылке");
    }
  };

  // Общие стили полей формы
  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-[12px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300";

  // ── Экран входа ──
  // ── Экран входа ──
  if (!authed) {
    return (
      <AdminLogin
        password={password} setPassword={setPassword}
        authErr={authErr} setAuthErr={setAuthErr}
        loading={loading} handleLogin={handleLogin}
      />
    );
  }

  // ── Основная панель ──
  return (
    // Прокрутка задана здесь, а не на всей странице: у приложения со схемой
    // прокрутка окна намеренно отключена (холст занимает весь экран). Поэтому
    // админка листается внутри себя — иначе длинные вкладки вроде мониторинга
    // не помещались на экран и нижняя часть была недоступна.
    <div className="h-screen overflow-y-auto" style={{ background: "var(--c-s3, #f1f5f9)" }}>
      {/* Шапка. sticky — остаётся на виду при прокрутке длинных вкладок,
          чтобы переключение разделов и кнопка «Обновить» были всегда под рукой. */}
      <div className="h-14 flex items-center justify-between px-6 shadow-sm sticky top-0 z-20"
        style={{ background: "var(--c-blue-bg, #1a3a6b)" }}>
        <div className="flex items-center gap-3">
          <Icon name="ShieldCheck" size={20} className="text-blue-300" />
          <span className="text-white font-bold text-[14px]">Панель администратора</span>
          <span className="text-blue-300 text-[12px]">ПВ-Система</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1">
            <button onClick={() => setActiveTab("licenses")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "licenses" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="Key" size={12} className="inline mr-1" />Лицензии
            </button>
            <button onClick={() => setActiveTab("monitoring")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "monitoring" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="Activity" size={12} className="inline mr-1" />Мониторинг
            </button>
            <button onClick={() => setActiveTab("update")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "update" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="Upload" size={12} className="inline mr-1" />Обновление
            </button>
            <button onClick={() => setActiveTab("server")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "server" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="Server" size={12} className="inline mr-1" />Сервер расчёта
            </button>
            <button onClick={() => setActiveTab("emergency")}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${activeTab === "emergency" ? "bg-white text-[#1a3a6b]" : "text-blue-200 hover:text-white"}`}>
              <Icon name="LifeBuoy" size={12} className="inline mr-1" />Аварийный ключ
            </button>
          </div>
          {activeTab === "licenses" && <>
            {/* Возраст данных. Таблица обновляется сама каждые 20 секунд, но
                увидеть это невозможно — цифры просто меняются. Подпись
                показывает, насколько свежее то, что перед глазами, и краснеет,
                если связь пропала и данные устарели. */}
            {licSyncAt && (
              <span
                className="flex items-center gap-1 text-[11px]"
                style={{ color: licSyncStale ? "var(--c-amber-lt, #fbbf24)" : "#93c5fd" }}
                title={licSyncStale
                  ? "Нет связи с сервером — данные могли устареть. Нажмите «Обновить»."
                  : `Обновляется автоматически каждые 20 секунд. Последний ответ сервера: ${new Date(licSyncAt).toLocaleTimeString("ru-RU")}`}>
                <Icon name={licSyncStale ? "CloudOff" : "RefreshCw"} size={11} />
                {licSyncStale ? `нет связи · ${licSyncLabel}` : `обновлено ${licSyncLabel}`}
              </span>
            )}
            <button onClick={() => loadLicenses(password)}
              className="flex items-center gap-1.5 text-[12px] text-blue-200 hover:text-white transition-colors">
              <Icon name="RefreshCw" size={14} className={loading ? "animate-spin" : ""} />Обновить
            </button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-colors"
              style={{ background: "var(--c-green-bg, #16a34a)" }}>
              <Icon name="Plus" size={14} />Создать ключ
            </button>
          </>}
          {activeTab === "monitoring" && (
            <button onClick={() => loadMonitoring(password)}
              className="flex items-center gap-1.5 text-[12px] text-blue-200 hover:text-white transition-colors">
              <Icon name="RefreshCw" size={14} className={monLoading ? "animate-spin" : ""} />Обновить
            </button>
          )}
          <a href="/"
            className="flex items-center gap-1.5 text-[12px] text-blue-300 hover:text-white transition-colors">
            <Icon name="ArrowLeft" size={14} />В приложение
          </a>
        </div>
      </div>

      {/* pb-10 — запас снизу, чтобы последний блок не упирался в край окна */}
      <div className="max-w-5xl mx-auto p-6 pb-10">

        {/* ── Вкладка: Мониторинг ── */}
        {activeTab === "monitoring" && (
          <MonitoringTab data={monitoring} loading={monLoading} />
        )}

        {/* ── Вкладка: Обновление версии ── */}
        {activeTab === "update" && (
          <UpdateTab
            currentVersion={currentVersion}
            updVersion={updVersion} setUpdVersion={setUpdVersion}
            updNotes={updNotes} setUpdNotes={setUpdNotes}
            updUrl={updUrl} setUpdUrl={setUpdUrl}
            updStatus={updStatus} setUpdStatus={setUpdStatus} updErr={updErr}
            srvVersion={srvVersion} setSrvVersion={setSrvVersion}
            srvUrl={srvUrl} setSrvUrl={setSrvUrl}
            srvStatus={srvStatus} setSrvStatus={setSrvStatus} srvErr={srvErr}
            handleUploadExeFromUrl={handleUploadExeFromUrl}
            handleUploadServerFromUrl={handleUploadServerFromUrl}
            inputCls={inputCls}
            minSecure={minSecure} setMinSecure={setMinSecure}
            secNotes={secNotes} setSecNotes={setSecNotes}
            secStatus={secStatus} setSecStatus={setSecStatus} secErr={secErr}
            handleSaveMinSecure={handleSaveMinSecure}
          />
        )}

        {/* ── Вкладка: Сервер расчёта ── */}
        {activeTab === "server" && (
          <ServerTab
            srvActive={srvActive} setSrvActive={setSrvActive}
            srvBackupUrl={srvBackupUrl} setSrvBackupUrl={setSrvBackupUrl}
            srvAutofail={srvAutofail} setSrvAutofail={setSrvAutofail}
            srvCfgLoading={srvCfgLoading} srvCfgSaving={srvCfgSaving}
            srvCfgOk={srvCfgOk} srvCfgErr={srvCfgErr}
            saveServerCfg={saveServerCfg}
            switchServer={switchServer}
            password={password}
          />
        )}

        {/* ── Вкладка: Аварийный оффлайн-ключ ── */}
        {activeTab === "emergency" && (
          <EmergencyTab
            emgOrg={emgOrg} setEmgOrg={setEmgOrg}
            emgExpires={emgExpires} setEmgExpires={setEmgExpires}
            emgKey={emgKey} emgErr={emgErr} setEmgErr={setEmgErr}
            emgLoading={emgLoading} generateEmergencyKey={generateEmergencyKey}
            emgSeats={emgSeats} setEmgSeats={setEmgSeats}
            emgBindFp={emgBindFp} setEmgBindFp={setEmgBindFp}
            okSeatsForId={okSeatsForId} okSeats={okSeats}
            loadOfflineSeats={loadOfflineSeats} blockOfflineSeat={blockOfflineSeat}
            offlineKeys={offlineKeys} okLoading={okLoading}
            okEditId={okEditId} setOkEditId={setOkEditId}
            okEditOrg={okEditOrg} setOkEditOrg={setOkEditOrg}
            okEditExp={okEditExp} setOkEditExp={setOkEditExp}
            okEditSeats={okEditSeats} setOkEditSeats={setOkEditSeats}
            okEditNotes={okEditNotes} setOkEditNotes={setOkEditNotes}
            okShowKeyId={okShowKeyId} setOkShowKeyId={setOkShowKeyId}
            saveEditOffline={saveEditOffline}
            toggleOffline={toggleOffline} deleteOffline={deleteOffline}
            startEditOffline={startEditOffline}
            loadOfflineKeys={loadOfflineKeys} password={password}
          />
        )}

        {/* ── Вкладка: Лицензии ── */}
        {activeTab === "licenses" && (
          <LicensesTab
            licenses={licenses} seats={seats} seatsForId={seatsForId}
            loadSeats={loadSeats} openEdit={openEdit}
            toggleLicense={toggleLicense} deleteLicense={deleteLicense}
            revokeSeat={revokeSeat}
          />
        )}

      </div>

      {/* Диалоги создания и редактирования лицензии */}
      <LicenseDialogs
        showCreate={showCreate} setShowCreate={setShowCreate}
        form={form} setForm={setForm}
        createErr={createErr} setCreateErr={setCreateErr} createOk={createOk}
        generatedKey={generatedKey} setGeneratedKey={setGeneratedKey}
        generateKey={generateKey} handleCreate={handleCreate}
        editingLic={editingLic} editForm={editForm} setEditForm={setEditForm}
        editErr={editErr} editOk={editOk} editSaving={editSaving}
        handleUpdate={handleUpdate} closeEdit={closeEdit}
        inputCls={inputCls}
        orgGroups={orgGroups}
      />
    </div>
  );
}