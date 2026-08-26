import { useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import { type License, type Seat, fmtDate } from "@/pages/admin/adminTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «ЛИЦЕНЗИИ»: сводка, список лицензий и раскрываемые рабочие места.
//
// Лицензии, у которых задана головная организация (org_group), собираются в
// сворачиваемые разделы — например ФГУП «ВГСЧ» с его филиалами. Иначе крупные
// структуры на два десятка филиалов растягивают список так, что отдельные
// организации в нём теряются. Лицензии без группы идут отдельными строками
// верхнего уровня, как раньше.
// ─────────────────────────────────────────────────────────────────────────────

/** Раздел списка: либо группа с филиалами, либо одиночная лицензия. */
type LicenseGroup = { name: string; items: License[] };

/**
 * Раскладывает лицензии по группам, сохраняя исходный порядок сортировки
 * (с сервера — новые сверху): группа встаёт на позицию первой своей лицензии.
 */
function groupLicenses(licenses: License[]): { groups: LicenseGroup[]; loose: License[] } {
  const map = new Map<string, License[]>();
  const loose: License[] = [];
  for (const l of licenses) {
    const g = (l.org_group ?? "").trim();
    if (!g) { loose.push(l); continue; }
    const arr = map.get(g);
    if (arr) arr.push(l); else map.set(g, [l]);
  }
  return {
    groups: Array.from(map.entries()).map(([name, items]) => ({ name, items })),
    loose,
  };
}

interface Props {
  licenses: License[];
  seats: Seat[] | null;
  seatsForId: number | null;
  loadSeats: (id: number) => void;
  openEdit: (lic: License) => void;
  toggleLicense: (id: number, is_active: boolean) => void;
  deleteLicense: (id: number, name: string) => void;
  revokeSeat: (seatId: number) => void;
}


/** Одна лицензия: карточка со сводкой, действиями и списком рабочих мест. */
function LicenseRow({
  lic, seats, seatsForId, loadSeats, openEdit, toggleLicense, deleteLicense, revokeSeat,
}: {
  lic: License;
  seats: Seat[] | null;
  seatsForId: number | null;
  loadSeats: (id: number) => void;
  openEdit: (lic: License) => void;
  toggleLicense: (id: number, is_active: boolean) => void;
  deleteLicense: (id: number, name: string) => void;
  revokeSeat: (seatId: number) => void;
}) {
  return (
            <div key={lic.id}>
              <div className="px-5 py-4 flex items-start gap-4">
                {/* Статус */}
                <div className="mt-0.5">
                  <div className={`w-2.5 h-2.5 rounded-full mt-1 ${lic.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                </div>

                {/* Основная инфо */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[13px]" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>{lic.owner_name}</span>
                    {lic.owner_email && <span className="text-[11px] text-gray-400">{lic.owner_email}</span>}
                    {!lic.is_active && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-600 font-medium">ОТОЗВАНА</span>
                    )}
                    {lic.expires_at && new Date(lic.expires_at) < new Date() && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-600 font-medium">ИСТЕКЛА</span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-blue-600 mt-0.5">{lic.key}</div>
                  <div className="mt-1 flex items-center gap-4 text-[11px] text-gray-500 flex-wrap">
                    <span>Мест: <b className={lic.used_seats >= lic.max_seats ? "text-red-600" : "text-green-600"}>{lic.used_seats}/{lic.max_seats}</b></span>
                    {(lic.stale_duplicates ?? 0) > 0 && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium inline-flex items-center gap-1"
                        title="Один и тот же компьютер занимает несколько мест. Откройте список мест — задвоенные помечены и их можно освободить.">
                        <Icon name="Copy" size={11} />
                        задвоено мест: {lic.stale_duplicates}
                      </span>
                    )}
                    <span>Создана: {fmtDate(lic.created_at)}</span>
                    {lic.expires_at && <span>Действует до: {fmtDate(lic.expires_at)}</span>}
                    {lic.last_activity && <span>Активность: {fmtDate(lic.last_activity)}</span>}
                    {lic.notes && <span className="text-gray-400 italic">{lic.notes}</span>}
                  </div>
                </div>

                {/* Действия */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => loadSeats(lic.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-blue-50"
                    style={{ borderColor: "#93c5fd", color: "var(--c-blue, #2563eb)" }}>
                    <Icon name="Monitor" size={12} />
                    {seatsForId === lic.id ? "Скрыть" : `Места (${lic.used_seats})`}
                  </button>
                  <button onClick={() => openEdit(lic)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-amber-50"
                    style={{ borderColor: "#fcd34d", color: "var(--c-amber, #b45309)" }}>
                    <Icon name="Pencil" size={12} />
                    Изменить
                  </button>
                  <button
                    onClick={() => toggleLicense(lic.id, !lic.is_active)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors"
                    style={lic.is_active
                      ? { borderColor: "#fca5a5", color: "var(--c-red, #dc2626)", background: "var(--c-tint-red, #fff5f5)" }
                      : { borderColor: "#86efac", color: "var(--c-green, #16a34a)", background: "var(--c-tint-green, #f0fdf4)" }}>
                    <Icon name={lic.is_active ? "PauseCircle" : "PlayCircle"} size={12} />
                    {lic.is_active ? "Отозвать" : "Активировать"}
                  </button>
                  <button onClick={() => deleteLicense(lic.id, lic.owner_name)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors">
                    <Icon name="Trash2" size={12} />
                  </button>
                </div>
              </div>

              {/* Раскрытые рабочие места */}
              {seatsForId === lic.id && seats && (
                <div className="px-5 pb-4 bg-blue-50 border-t border-blue-100">
                  <div className="text-[11px] font-semibold text-blue-700 mb-2 pt-3 flex items-center justify-between">
                    <span>Активированные рабочие места</span>
                    <span className="font-normal text-blue-500">{seats.length} / {lic.max_seats}</span>
                  </div>
                  {seats.length === 0 ? (
                    <div className="text-[11px] text-gray-400">Нет активированных мест</div>
                  ) : (
                    <div className="space-y-2">
                      {seats.map((seat, idx) => {
                        // Определяем ОС и браузер — сначала из новых полей, иначе из user_agent
                        const plat = seat.platform || seat.hostname || seat.user_agent || "";
                        const ua   = seat.user_agent || "";

                        const os = seat.platform
                          ? seat.platform
                          : ua.includes("Windows") ? "Windows"
                          : ua.includes("Mac") ? "macOS"
                          : ua.includes("Linux") ? "Linux"
                          : ua.includes("Android") ? "Android"
                          : ua.includes("iPhone") || ua.includes("iPad") ? "iOS" : "—";

                        const browser = ua.includes("Chrome") && !ua.includes("Edg") ? "Chrome"
                          : ua.includes("Firefox") ? "Firefox"
                          : ua.includes("Safari") && !ua.includes("Chrome") ? "Safari"
                          : ua.includes("Edg") ? "Edge" : "—";

                        const osIcon = plat.includes("Win") ? "🖥️"
                          : plat.includes("mac") || plat.includes("Mac") ? "🍎"
                          : plat.includes("Linux") ? "🐧"
                          : plat.includes("Android") ? "📱"
                          : plat.includes("iOS") ? "📱" : "💻";

                        // Отображаемое имя рабочего места
                        const displayName = seat.hostname
                          ? seat.hostname
                          : `${os} / ${browser}`;

                        return (
                          <div key={seat.id} className="flex items-start gap-3 p-3 bg-white rounded-lg border border-blue-100">
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ background: "var(--c-tint-blue, #eff6ff)" }}>
                              <span className="text-[17px]">{osIcon}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              {/* Заголовок места */}
                              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                <span className="text-[12px] font-semibold text-gray-800">
                                  Место #{idx + 1}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 ${seat.online ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${seat.online ? "bg-green-500" : "bg-gray-400"}`} />
                                  {seat.online ? "онлайн" : "офлайн"}
                                </span>
                                {(seat.ip_count ?? 0) > 1 && (
                                  <span
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium inline-flex items-center gap-1"
                                    title="Под этим местом работали с разных адресов в интернете — возможно, им пользуются несколько компьютеров">
                                    <Icon name="TriangleAlert" size={11} />
                                    замечено с {seat.ip_count} адресов
                                  </span>
                                )}
                                {seat.stale_duplicate && (
                                  <span
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium inline-flex items-center gap-1"
                                    title="Тот же компьютер занимает ещё одно, более свежее место. Обычно это следствие обновления программы со старой версии: место можно освободить — работа идёт на новом.">
                                    <Icon name="Copy" size={11} />
                                    задвоено — можно освободить
                                  </span>
                                )}
                                {seat.app_version && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium font-mono">
                                    v{seat.app_version}
                                  </span>
                                )}
                                {seat.core_version && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium font-mono"
                                    title="Версия расчётного ядра (server.exe)">
                                    ядро {seat.core_version}
                                  </span>
                                )}
                                {seat.platform && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                                    {seat.platform}
                                  </span>
                                )}
                                {!seat.platform && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{os}</span>
                                )}
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{browser}</span>
                              </div>
                              {/* Название рабочего места */}
                              <div className="text-[12px] text-gray-700 font-medium truncate">
                                {displayName}
                              </div>
                              {/* Разрешение экрана */}
                              {seat.screen_info && (
                                <div className="text-[10px] text-gray-400 mt-0.5">
                                  🖥 {seat.screen_info}
                                </div>
                              )}
                              {/* Fingerprint и даты */}
                              <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                                ID: {seat.fingerprint}
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5 flex gap-3 flex-wrap">
                                <span>Активировано: {fmtDate(seat.activated_at)}</span>
                                <span>Последняя активность: {fmtDate(seat.last_seen_at)}</span>
                                {seat.last_ip && <span>IP: {seat.last_ip}</span>}
                              </div>
                            </div>
                            <button onClick={() => revokeSeat(seat.id)}
                              title="Освободить место — пользователь сможет активировать ключ заново"
                              className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors mt-0.5">
                              <Icon name="Trash2" size={11} />Сбросить
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
  );
}

export default function LicensesTab({
  licenses, seats, seatsForId, loadSeats, openEdit, toggleLicense, deleteLicense, revokeSeat,
}: Props) {
  const { groups, loose } = useMemo(() => groupLicenses(licenses), [licenses]);
  // Свёрнутые группы. По умолчанию все развёрнуты: админ чаще ищет конкретный
  // филиал, чем обозревает структуру целиком.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (name: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  return (
    <>
        {/* Статистика */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Всего лицензий", value: licenses.length, icon: "Key", color: "var(--c-blue, #2563eb)" },
            { label: "Активных", value: licenses.filter(l => l.is_active).length, icon: "CheckCircle", color: "var(--c-green, #16a34a)" },
            { label: "Рабочих мест занято", value: licenses.reduce((s, l) => s + l.used_seats, 0), icon: "Monitor", color: "var(--c-amber, #d97706)" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <Icon name={s.icon as "Key"} size={16} style={{ color: s.color }} />
                <span className="text-[11px] text-gray-500">{s.label}</span>
              </div>
              <div className="text-[28px] font-bold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Таблица лицензий */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-[13px]" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>Лицензии</span>
          </div>

          {licenses.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-[13px]">
              <Icon name="Key" size={32} className="mx-auto mb-3 text-gray-300" />
              Нет созданных лицензий. Нажмите «Создать ключ».
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[calc(100vh-360px)] overflow-y-auto">
              {/* Группы организаций: заголовок сворачивает список филиалов */}
              {groups.map(g => {
                const isOpen = !collapsed.has(g.name);
                const activeCnt = g.items.filter(l => l.is_active).length;
                const seatsUsed = g.items.reduce((s, l) => s + l.used_seats, 0);
                const seatsMax  = g.items.reduce((s, l) => s + l.max_seats, 0);
                return (
                  <div key={g.name}>
                    <button onClick={() => toggleGroup(g.name)}
                      className="w-full px-5 py-3 flex items-center gap-3 text-left transition-colors hover:bg-blue-50"
                      style={{ background: "var(--c-tint-blue, #f5f8ff)" }}>
                      <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} size={16}
                        className="flex-shrink-0" style={{ color: "var(--c-blue, #2563eb)" }} />
                      <Icon name="Building2" size={15} className="flex-shrink-0"
                        style={{ color: "var(--c-blue, #2563eb)" }} />
                      <span className="font-bold text-[13px] flex-1 min-w-0 truncate"
                        style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
                        {g.name}
                      </span>
                      <span className="text-[11px] text-gray-500 flex items-center gap-3 flex-shrink-0">
                        <span>Филиалов: <b className="text-gray-700">{g.items.length}</b></span>
                        <span>Активных: <b className="text-green-600">{activeCnt}</b></span>
                        <span>Мест: <b className={seatsUsed >= seatsMax ? "text-red-600" : "text-green-600"}>{seatsUsed}/{seatsMax}</b></span>
                      </span>
                    </button>
                    {isOpen && (
                      <div className="divide-y divide-gray-100 border-l-2"
                        style={{ borderColor: "var(--c-blue, #2563eb)" }}>
                        {g.items.map(lic => (
                          <LicenseRow key={lic.id} lic={lic} seats={seats} seatsForId={seatsForId}
                            loadSeats={loadSeats} openEdit={openEdit} toggleLicense={toggleLicense}
                            deleteLicense={deleteLicense} revokeSeat={revokeSeat} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Лицензии вне групп — как обычный плоский список */}
              {loose.map(lic => (
                <LicenseRow key={lic.id} lic={lic} seats={seats} seatsForId={seatsForId}
                  loadSeats={loadSeats} openEdit={openEdit} toggleLicense={toggleLicense}
                  deleteLicense={deleteLicense} revokeSeat={revokeSeat} />
              ))}
            </div>
          )}
        </div>
    </>
  );
}