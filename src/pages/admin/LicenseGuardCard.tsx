// ─────────────────────────────────────────────────────────────────────────────
// LicenseGuardCard.tsx — «Защита расчётов» в панели администратора.
//
// ЗАЧЕМ. Расчётные серверы больше не считают кому попало: к каждому расчёту
// программа прикладывает подписанную лицензию. Пока проверка работает в
// МЯГКОМ режиме — считает всем, но каждый случай без лицензии записывает.
//
// Этот блок отвечает на единственный практический вопрос: можно ли уже
// включать строгий режим. Включить его раньше времени — значит остановить
// работу у людей со старой версией программы, в том числе у честно
// оплативших. Поэтому ждём, пока расчёты без лицензии сойдут на нет.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { adminApi } from "@/pages/admin/adminTypes";

interface DayRow  { day: string; licensed: number; unlicensed: number }
interface FuncRow { func: string; licensed: number; unlicensed: number }
interface ReasonRow { reason: string; cnt: number }

interface Stats {
  total: number;
  licensed: number;
  unlicensed: number;
  unlicensed_pct: number;
  last7_unlicensed: number;
  ready_for_strict: boolean;
  by_day: DayRow[];
  by_func: FuncRow[];
  reasons: ReasonRow[];
}

// Понятные названия расчётов вместо служебных имён.
const FUNC_NAMES: Record<string, string> = {
  airflow:      "Воздухораспределение",
  aerodynamics: "Аэродинамика выработок",
  explosion:    "Взрывы",
  rescue:       "Маршруты ВГСЧ",
  water:        "Водоснабжение",
  compute:      "Прочие расчёты",
};

// Причины отказа человеческим языком.
const REASON_NAMES: Record<string, string> = {
  no_license:       "Программа не прислала лицензию (старая версия)",
  bad_signature:    "Поддельная или испорченная лицензия",
  not_licensed:     "Лицензия отмечена как недействующая",
  no_fingerprint:   "Лицензия без привязки к компьютеру",
  expired:          "Срок лицензии истёк",
  issued_in_future: "Лицензия из будущего (часы переведены)",
  ticket_too_old:   "Лицензия давно не обновлялась",
  bad_format:       "Неверный формат ключа",
  no_expiry:        "В ключе не указан срок",
};

function reasonLabel(r: string): string {
  if (r.startsWith("denied_")) {
    const base = r.slice("denied_".length);
    return `Отказано: ${REASON_NAMES[base] ?? base}`;
  }
  return REASON_NAMES[r] ?? r;
}

export default function LicenseGuardCard({ password }: { password: string }) {
  const [stats, setStats]     = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await adminApi(password, { action: "compute_license_stats", days: 14 });
      setStats(data as Stats);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Не удалось загрузить статистику");
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const maxDay = stats
    ? Math.max(1, ...stats.by_day.map(d => d.licensed + d.unlicensed))
    : 1;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icon name="ShieldCheck" size={16} className="text-green-600" />
          <span className="font-semibold text-[13px]" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
            Защита расчётов
          </span>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 disabled:opacity-50">
          <Icon name="RefreshCw" size={12} />
          Обновить
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mb-4">
        Расчёт выполняется только по действительной лицензии — её проверяет сам
        расчётный сервер, а не программа на компьютере. Сейчас проверка работает
        мягко: считает всем, но ведёт учёт. Строгий режим включайте, когда
        расчёты без лицензии сойдут на нет.
      </p>

      {err && (
        <div className="mb-3 p-2 rounded border border-red-200 bg-red-50 text-[12px] text-red-600">
          {err}
        </div>
      )}

      {loading && !stats && (
        <div className="py-6 text-center text-[12px] text-gray-400">Загрузка…</div>
      )}

      {stats && (
        <>
          {/* Главный вывод: можно включать строгий режим или ещё рано */}
          <div className={`mb-4 p-3 rounded-lg border ${
            stats.total === 0
              ? "border-gray-200 bg-gray-50"
              : stats.ready_for_strict
                ? "border-green-200 bg-green-50"
                : "border-amber-200 bg-amber-50"
          }`}>
            <div className={`flex items-center gap-2 font-semibold text-[13px] ${
              stats.total === 0 ? "text-gray-600"
                : stats.ready_for_strict ? "text-green-800" : "text-amber-800"
            }`}>
              <Icon
                name={stats.total === 0 ? "Clock"
                  : stats.ready_for_strict ? "CircleCheck" : "TriangleAlert"}
                size={16}
              />
              {stats.total === 0
                ? "Данных пока нет"
                : stats.ready_for_strict
                  ? "Можно включать строгий режим"
                  : "Строгий режим включать рано"}
            </div>
            <div className={`mt-1.5 text-[12px] ${
              stats.total === 0 ? "text-gray-500"
                : stats.ready_for_strict ? "text-green-700" : "text-amber-700"
            }`}>
              {stats.total === 0
                ? "Расчётов пока не было. Статистика появится, когда люди начнут считать."
                : stats.ready_for_strict
                  ? "За последнюю неделю все расчёты шли с действительной лицензией. "
                    + "Переход никого не заденет."
                  : `За последнюю неделю расчётов без лицензии: ${stats.last7_unlicensed}. `
                    + "Если включить строгий режим сейчас, у этих людей работа остановится. "
                    + "Дождитесь, пока они обновят программу."}
            </div>
          </div>

          {/* Итог за две недели */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
              <div className="text-[10px] text-gray-400 uppercase font-semibold">Всего расчётов</div>
              <div className="text-[18px] font-semibold text-gray-800">{stats.total}</div>
              <div className="text-[10px] text-gray-400">за 14 дней</div>
            </div>
            <div className="p-2.5 rounded-lg bg-green-50 border border-green-200">
              <div className="text-[10px] text-green-600 uppercase font-semibold">С лицензией</div>
              <div className="text-[18px] font-semibold text-green-700">{stats.licensed}</div>
              <div className="text-[10px] text-green-600">
                {stats.total ? (100 - stats.unlicensed_pct).toFixed(1) : "0"}%
              </div>
            </div>
            <div className={`p-2.5 rounded-lg border ${
              stats.unlicensed > 0
                ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"
            }`}>
              <div className={`text-[10px] uppercase font-semibold ${
                stats.unlicensed > 0 ? "text-amber-600" : "text-gray-400"
              }`}>Без лицензии</div>
              <div className={`text-[18px] font-semibold ${
                stats.unlicensed > 0 ? "text-amber-700" : "text-gray-700"
              }`}>{stats.unlicensed}</div>
              <div className={`text-[10px] ${
                stats.unlicensed > 0 ? "text-amber-600" : "text-gray-400"
              }`}>{stats.unlicensed_pct}%</div>
            </div>
          </div>

          {/* По дням — видно, как доля без лицензии убывает */}
          {stats.by_day.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] font-semibold text-gray-400 uppercase mb-2">По дням</div>
              <div className="space-y-1">
                {stats.by_day.map(d => {
                  const sum = d.licensed + d.unlicensed;
                  const okPct  = (d.licensed / maxDay) * 100;
                  const badPct = (d.unlicensed / maxDay) * 100;
                  return (
                    <div key={d.day} className="flex items-center gap-2">
                      <div className="w-[74px] shrink-0 text-[11px] text-gray-500 tabular-nums">
                        {d.day.slice(5)}
                      </div>
                      <div className="flex-1 h-4 rounded bg-gray-100 overflow-hidden flex">
                        <div className="h-full bg-green-400" style={{ width: `${okPct}%` }} />
                        <div className="h-full bg-amber-400" style={{ width: `${badPct}%` }} />
                      </div>
                      <div className="w-[92px] shrink-0 text-right text-[11px] tabular-nums">
                        <span className="text-green-700">{d.licensed}</span>
                        <span className="text-gray-300"> / </span>
                        <span className={d.unlicensed > 0 ? "text-amber-700" : "text-gray-400"}>
                          {d.unlicensed}
                        </span>
                        <span className="text-gray-300"> из {sum}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-green-400 inline-block" /> с лицензией
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> без лицензии
                </span>
              </div>
            </div>
          )}

          {/* По видам расчёта */}
          {stats.by_func.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] font-semibold text-gray-400 uppercase mb-2">
                По видам расчёта
              </div>
              <div className="space-y-1">
                {stats.by_func.map(f => (
                  <div key={f.func}
                    className="flex items-center justify-between p-2 rounded bg-gray-50 border border-gray-200">
                    <span className="text-[12px] text-gray-700">
                      {FUNC_NAMES[f.func] ?? f.func}
                    </span>
                    <span className="text-[11px] tabular-nums">
                      <span className="text-green-700">{f.licensed}</span>
                      <span className="text-gray-300"> / </span>
                      <span className={f.unlicensed > 0 ? "text-amber-700 font-semibold" : "text-gray-400"}>
                        {f.unlicensed}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Почему расчёты не проходят проверку */}
          {stats.reasons.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] font-semibold text-gray-400 uppercase mb-2">
                Причины
              </div>
              <div className="space-y-1">
                {stats.reasons.map(r => (
                  <div key={r.reason}
                    className="flex items-center justify-between p-2 rounded bg-amber-50 border border-amber-200">
                    <span className="text-[12px] text-amber-800">{reasonLabel(r.reason)}</span>
                    <span className="text-[11px] font-semibold text-amber-700 tabular-nums">
                      {r.cnt}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Как переключить режим */}
          <div className="p-3 rounded-lg border border-gray-200 bg-gray-50">
            <div className="text-[11px] font-semibold text-gray-600 mb-1.5">
              Как включить строгий режим
            </div>
            <div className="text-[11px] text-gray-500 leading-relaxed">
              Откройте <b>Ядро → Функции</b>, выберите расчётную функцию и в её
              настройках задайте переменную{" "}
              <code className="px-1 py-0.5 rounded bg-white border border-gray-200 text-[10px]">
                COMPUTE_LICENSE_MODE
              </code>{" "}
              со значением{" "}
              <code className="px-1 py-0.5 rounded bg-white border border-gray-200 text-[10px]">
                strict
              </code>. Повторите для всех пяти расчётов: воздухораспределение,
              аэродинамика, взрывы, маршруты ВГСЧ, водоснабжение. Чтобы вернуть
              мягкий режим, поставьте значение{" "}
              <code className="px-1 py-0.5 rounded bg-white border border-gray-200 text-[10px]">
                soft
              </code>.
            </div>
          </div>
        </>
      )}
    </div>
  );
}