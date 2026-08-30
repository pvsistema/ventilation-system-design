// ─────────────────────────────────────────────────────────────────────────────
// Предупреждение об окончании лицензии.
//
// ЗАЧЕМ. Раньше человек узнавал об истечении ключа только по факту блокировки:
// открыл программу, построил схему, нажал «Сохранить» — и вместо сохранения
// увидел окно активации. Для горноспасательных отрядов и ГОКов, где расчёты
// вентиляции делают не каждый день, это могло совпасть со срочной задачей.
//
// Теперь за две недели до окончания срока показывается баннер с обратным
// отсчётом. Чем ближе срок, тем настойчивее напоминание:
//   • 14–8 дней — синий баннер, закрывается на сутки;
//   • 7–4 дня   — жёлтый, закрывается на сутки;
//   • 3–0 дней  — красный, закрыть можно только до конца сеанса.
//
// Баннер живёт рядом с баннером обновления и намеренно повторяет его вид:
// человек уже знает эту полосу сверху и понимает, что от него хотят.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { useLicenseContext } from "@/context/LicenseContext";
import { daysUntilExpiry, pluralDays, LICENSE_WARN_DAYS } from "@/lib/license";

/** Ключ отметки «закрыто до завтра». Хранится по дате окончания ключа. */
const SNOOZE_KEY = "pvs_license_expiry_snooze";

type Severity = "info" | "warn" | "urgent";

function severityOf(days: number): Severity {
  if (days <= 3) return "urgent";
  if (days <= 7) return "warn";
  return "info";
}

const STYLES: Record<Severity, { bg: string; icon: string }> = {
  info:   { bg: "linear-gradient(90deg,#2563eb,#1d4ed8)", icon: "CalendarClock" },
  warn:   { bg: "linear-gradient(90deg,#d97706,#b45309)", icon: "TriangleAlert" },
  urgent: { bg: "linear-gradient(90deg,#dc2626,#b91c1c)", icon: "TriangleAlert" },
};

/** Читает дату, до которой баннер скрыт для этого срока лицензии. */
function readSnooze(expiresAt: string): number {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return 0;
    const v = JSON.parse(raw) as { exp?: string; until?: number };
    // Отметка привязана к конкретной дате окончания: продлили лицензию —
    // старое «закрыто» перестаёт действовать само собой.
    return v.exp === expiresAt ? Number(v.until) || 0 : 0;
  } catch { return 0; }
}

export default function LicenseExpiryBanner() {
  const license = useLicenseContext();
  const [dismissed, setDismissed] = useState(false);
  // Пересчёт раз в час: программу на пультах ВГСЧ держат открытой сутками,
  // и без этого баннер завис бы на вчерашнем числе.
  const [, setTick] = useState(0);
  // Сверху может уже висеть баннер обновления — тогда съезжаем под него,
  // иначе два сообщения наложились бы друг на друга.
  const [topOffset, setTopOffset] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector("[data-pvs-react-update-banner]");
      setTopOffset(el ? (el as HTMLElement).offsetHeight : 0);
    };
    measure();
    const t = setInterval(measure, 1000);
    return () => clearInterval(t);
  }, []);

  const expiresAt = license.info?.expiresAt;
  const days = daysUntilExpiry(expiresAt);

  // Показываем только при действующей лицензии. В демо-режиме и при уже
  // истёкшем ключе своё окно активации — второе сообщение там лишнее.
  if (license.status !== "licensed") return null;
  if (days === null || days > LICENSE_WARN_DAYS || days < 0) return null;
  if (dismissed) return null;
  if (expiresAt && Date.now() < readSnooze(expiresAt)) return null;

  const sev = severityOf(days);
  const st = STYLES[sev];

  const dateStr = expiresAt
    ? new Date(expiresAt).toLocaleDateString("ru-RU",
        { day: "numeric", month: "long", year: "numeric" })
    : "";

  const headline =
    days === 0 ? "Лицензия заканчивается сегодня"
    : days === 1 ? "Лицензия заканчивается завтра"
    : `До окончания лицензии ${days} ${pluralDays(days)}`;

  const detail =
    days === 0
      ? "После окончания срока сохранение и экспорт проектов станут недоступны. Сохраните текущую работу."
      : `Срок действия ключа истекает ${dateStr}. После этого сохранение, экспорт и печать проектов будут недоступны до продления.`;

  const snoozeForDay = () => {
    try {
      if (expiresAt) {
        const tomorrow = new Date();
        tomorrow.setHours(24, 0, 0, 0);
        localStorage.setItem(SNOOZE_KEY,
          JSON.stringify({ exp: expiresAt, until: tomorrow.getTime() }));
      }
    } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div
      className="fixed left-0 right-0 z-[99999] flex items-center gap-3 px-4 py-2 text-white"
      style={{ top: topOffset, background: st.bg, fontFamily: "Segoe UI, Arial, sans-serif",
               boxShadow: "0 2px 10px rgba(0,0,0,0.18)" }}>
      <Icon name={st.icon} size={17} className="flex-shrink-0" />

      <div className="flex-1 min-w-0 leading-tight">
        <div className="font-semibold text-[13px]">{headline}</div>
        <div className="text-[12px] opacity-90 truncate">{detail}</div>
      </div>

      {license.info?.owner && (
        <div className="hidden md:block text-[11.5px] opacity-80 flex-shrink-0 max-w-[240px] truncate">
          {license.info.owner}
        </div>
      )}

      {/* Срочный режим закрывается только на сеанс — чтобы завтра напомнить снова. */}
      {sev !== "urgent" && (
        <button
          onClick={snoozeForDay}
          className="h-7 px-3 rounded-md text-[12px] font-medium flex-shrink-0
                     hover:bg-white/20 border border-white/40">
          Напомнить завтра
        </button>
      )}

      <button
        onClick={() => setDismissed(true)}
        title="Скрыть до перезапуска"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/20 flex-shrink-0">
        <Icon name="X" size={15} />
      </button>
    </div>
  );
}