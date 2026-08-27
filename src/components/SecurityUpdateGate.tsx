// ─────────────────────────────────────────────────────────────────────────────
// Блокирующее окно обязательного обновления по безопасности.
//
// Обычный баннер обновления (AppUpdateBanner) можно закрыть и продолжить
// работу — это правильно для обычных выпусков. Но если в старой сборке
// устранена уязвимость, работать на ней нельзя: такое окно закрыть нельзя,
// в нём только кнопка «Обновить».
//
// Порог задаёт администратор в панели (min_secure_version). Пока порог пуст,
// окно не показывается никогда.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { APP_VERSION } from "@/lib/appVersion";
import {
  fetchRemoteVersion,
  isSecurityUpdateRequired,
  downloadAndInstall,
  reloadBrowserToUpdate,
  isDesktopApp,
} from "@/lib/updater";

export default function SecurityUpdateGate() {
  const [required, setRequired] = useState(false);
  const [latest, setLatest] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  const desktop = isDesktopApp();

  // Десктопная оболочка (C#) сообщает сюда прогресс скачивания обновления.
  useEffect(() => {
    const w = window as Window & { __pvsSecurityProgress?: (p: number) => void };
    w.__pvsSecurityProgress = (p: number) =>
      setProgress(Math.max(0, Math.min(100, p)));
    return () => { w.__pvsSecurityProgress = undefined; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const d = await fetchRemoteVersion();
        if (cancelled) return;
        if (isSecurityUpdateRequired(d.minSecureVersion, APP_VERSION)) {
          setRequired(true);
          setLatest(d.version);
          setWhy(d.securityNotes);
        }
      } catch { /* нет сети — не блокируем работу на объекте */ }
    };
    // Небольшая задержка, чтобы не соперничать с загрузкой интерфейса.
    const t = window.setTimeout(check, 3000);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, []);

  if (!required) return null;

  const hasUnsaved = (): boolean => {
    try {
      const fn = (window as Window & { __pvsIsDirty?: () => boolean }).__pvsIsDirty;
      return typeof fn === "function" ? !!fn() : false;
    } catch { return false; }
  };

  // Сохранить проект перед обновлением — чтобы обязательное обновление
  // не стоило пользователю несохранённой работы.
  const handleSave = async () => {
    try {
      const save = (window as Window & { __pvsSaveProject?: () => Promise<void> | void })
        .__pvsSaveProject;
      if (typeof save === "function") await save();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* пользователь сохранит вручную */ }
  };

  const handleUpdate = () => {
    if (busy) return;
    setBusy(true);
    if (desktop) {
      setProgress(0);
      downloadAndInstall();
      return;
    }
    void reloadBrowserToUpdate();
  };

  return (
    <div
      className="fixed inset-0 z-[100002] flex items-center justify-center p-4"
      style={{
        background: "rgba(15,23,42,0.75)",
        backdropFilter: "blur(3px)",
        fontFamily: "Segoe UI, Arial, sans-serif",
      }}>
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-w-[94vw] overflow-hidden">
        {/* Шапка */}
        <div className="px-6 pt-6 pb-5 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center"
            style={{ background: "var(--c-tint-red2, #fee2e2)" }}>
            <Icon name="ShieldAlert" size={28} style={{ color: "var(--c-red, #dc2626)" }} />
          </div>
          <h2 className="text-[18px] font-bold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
            Требуется обновление безопасности
          </h2>
          <p className="text-[13px] text-gray-500 mt-2 leading-relaxed">
            В вашей версии программы обнаружена и устранена уязвимость.
            Чтобы продолжить работу, установите защищённую версию.
          </p>
        </div>

        {/* Версии */}
        <div className="px-6">
          <div className="flex items-center justify-center gap-3 py-3 bg-gray-50 rounded-xl">
            <div className="text-center">
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">Установлена</div>
              <div className="text-[14px] font-bold text-red-600 mt-0.5">{APP_VERSION}</div>
            </div>
            <Icon name="ArrowRight" size={16} className="text-gray-300" />
            <div className="text-center">
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">Безопасная</div>
              <div className="text-[14px] font-bold text-green-600 mt-0.5">{latest || "—"}</div>
            </div>
          </div>

          {why && (
            <div className="mt-3 text-[12px] text-gray-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 leading-relaxed">
              <Icon name="Info" size={13} className="inline mr-1 text-amber-600 align-[-2px]" />
              {why}
            </div>
          )}

          {/* Несохранённый проект — предложим сохранить, не теряя работу */}
          {hasUnsaved() && !saved && (
            <button onClick={handleSave} disabled={busy}
              className="mt-3 w-full flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-medium border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-50">
              <Icon name="Save" size={14} />
              Сохранить проект перед обновлением
            </button>
          )}
          {saved && (
            <div className="mt-3 flex items-center justify-center gap-1.5 h-9 text-[12px] font-medium text-green-700">
              <Icon name="Check" size={14} />Проект сохранён
            </div>
          )}
        </div>

        {/* Прогресс скачивания (десктоп) */}
        {busy && progress !== null && (
          <div className="px-6 mt-4">
            <div className="h-2 rounded-full overflow-hidden bg-gray-200">
              <div className="h-full rounded-full transition-all duration-200"
                style={{ width: `${progress}%`, background: "var(--c-blue-bg, #2563eb)" }} />
            </div>
            <div className="text-[11px] text-gray-500 text-center mt-1.5">
              {progress < 100 ? `Загрузка обновления… ${progress}%` : "Установка и перезапуск…"}
            </div>
          </div>
        )}

        {/* Кнопка. Закрыть окно нельзя — обновление обязательно. */}
        <div className="px-6 py-5 mt-2">
          <button onClick={handleUpdate} disabled={busy}
            className="w-full h-11 rounded-xl text-[14px] font-semibold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: "var(--c-blue-ink, #1a3a6b)" }}>
            {busy ? (
              <><Icon name="Loader2" size={16} className="animate-spin" />
                {progress !== null && progress < 100 ? `${progress}%` : "Обновление…"}</>
            ) : (
              <><Icon name={desktop ? "Download" : "RefreshCw"} size={16} />
                {desktop ? "Обновить программу" : "Обновить страницу"}</>
            )}
          </button>
          <p className="text-[11px] text-gray-400 text-center mt-3 leading-relaxed">
            {desktop
              ? "Программа скачает обновление и перезапустится автоматически."
              : "Страница перезагрузится на защищённую версию."}
          </p>
        </div>
      </div>
    </div>
  );
}
