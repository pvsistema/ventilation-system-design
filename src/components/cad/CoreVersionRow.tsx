import { useEffect, useState } from "react";

/**
 * Строка «Версия ядра» в окне «О программе».
 * Версия ядра (server.exe) доступна только в десктопе — там интерфейс
 * раздаёт локальный сервер, который отдаёт свою версию через /api/status.
 * В браузере ядра нет, поэтому строка не показывается.
 */
export default function CoreVersionRow() {
  const [coreVersion, setCoreVersion] = useState<string | null>(null);

  useEffect(() => {
    const isDesktop = !!(window as Window & { __IS_DESKTOP__?: boolean }).__IS_DESKTOP__;
    if (!isDesktop) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && data?.version) setCoreVersion(String(data.version));
      } catch {
        /* сервер ядра недоступен — строку просто не показываем */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!coreVersion) return null;

  return (
    <div className="about-row">
      <span className="about-k">Версия ядра</span>
      <span className="about-v font-num">{coreVersion}</span>
    </div>
  );
}
