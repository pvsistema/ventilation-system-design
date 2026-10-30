import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { fetchRemoteVersion, isNewerVersion, downloadAndInstall } from "@/lib/updater";

// Версия ядра, в которое упакован этот интерфейс. Задаётся только в
// десктопной сборке (vite.config.desktop.ts); в браузере её нет.
declare const __UI_CORE_VERSION__: string | undefined;
const UI_CORE_VERSION = typeof __UI_CORE_VERSION__ !== "undefined" ? __UI_CORE_VERSION__ : "";

/**
 * Предупреждение десктопа: интерфейс собран раньше последней опубликованной
 * версии. Так бывает, если программа собрана из старого ядра (сборка
 * «resume») — тогда в ней нет новых моделей вентиляторов и исправлений.
 */
export default function StaleUiBanner() {
  const [latest, setLatest] = useState("");
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!UI_CORE_VERSION) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const d = await fetchRemoteVersion();
        if (cancelled || !d.serverVersion) return;
        if (!isNewerVersion(d.serverVersion, UI_CORE_VERSION)) return;
        if (sessionStorage.getItem("pvsStaleUiSnooze") === d.serverVersion) return;
        setLatest(d.serverVersion);
      } catch {
        /* нет связи — предупреждать не о чем */
      }
    }, 5000);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, []);

  if (!latest || hidden) return null;

  const close = () => {
    try { sessionStorage.setItem("pvsStaleUiSnooze", latest); } catch { /* ignore */ }
    setHidden(true);
  };

  return (
    <div
      className="fixed bottom-10 right-4 z-[100000] w-[360px] rounded-lg p-3 flex gap-2.5"
      style={{
        background: "var(--c-s1, #fff)",
        color: "var(--c-t1, #1f2328)",
        border: "1px solid #f59e0b",
        boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
        fontFamily: "var(--font-ui)",
        fontSize: 12,
      }}>
      <Icon name="TriangleAlert" size={18} className="flex-shrink-0 mt-0.5" style={{ color: "#d97706" }} />
      <div className="flex-1 min-w-0">
        <div className="font-bold text-[13px] mb-1">Интерфейс программы устарел</div>
        <div className="opacity-80 leading-snug">
          Интерфейс собран с версией {UI_CORE_VERSION}, а последняя — {latest}.
          Новые модели оборудования и исправления в этой копии недоступны.
          Обновите программу или выполните полную сборку.
        </div>
        <div className="flex gap-2 mt-2.5">
          <button type="button" onClick={() => downloadAndInstall()}
            className="px-3 h-7 rounded font-semibold"
            style={{ background: "#d97706", color: "#fff", cursor: "pointer" }}>
            Обновить
          </button>
          <button type="button" onClick={close}
            className="px-3 h-7 rounded"
            style={{ background: "var(--c-s3, #f1efea)", color: "var(--c-t2, #3a3f45)", border: "1px solid var(--c-b2, #d5d1c8)", cursor: "pointer" }}>
            Позже
          </button>
        </div>
      </div>
      <button type="button" onClick={close} title="Закрыть"
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded"
        style={{ color: "var(--c-t2, #3a3f45)", cursor: "pointer" }}>
        <Icon name="X" size={13} />
      </button>
    </div>
  );
}
