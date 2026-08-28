import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { fetchRemoteVersion, isNewerVersion, downloadAndInstall, onUpdateProgress, isDesktopApp } from "@/lib/updater";

interface Props {
  /** Текущая версия установленной программы (например "2.3.24") */
  currentVersion: string;
}

type Status = "idle" | "checking" | "latest" | "available" | "error";

/**
 * Кнопка «Проверить обновления» для окна «О программе».
 * Использует ЕДИНУЮ логику обновления (src/lib/updater.ts) — ту же, что и
 * верхний баннер: качает установщик по ?file=exe (браузер) или отдаёт команду
 * в C#-оболочку (десктоп).
 */
export default function UpdateCheckButton({ currentVersion }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [newVersion, setNewVersion] = useState("");
  const [notes, setNotes] = useState("");
  // Идёт скачивание установщика и на сколько процентов оно продвинулось.
  // Без этого кнопка выглядела мёртвой: установщик ~82 МБ качается около
  // минуты, никакой реакции не было, и пользователь считал, что обновление
  // не запускается (жал кнопку повторно).
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => onUpdateProgress((p) => {
    // −1: обновление отменено (отказ от прав администратора) или сорвалось —
    // возвращаем кнопку в исходное состояние, чтобы можно было повторить.
    if (p < 0) { setBusy(false); setProgress(null); return; }
    setProgress(p);
  }), []);

  const startDownload = () => {
    setBusy(true);
    // В браузере файл просто уходит в загрузки — прогресс показывает сам
    // браузер, поэтому «занятость» снимаем сразу и не морочим человека.
    if (!isDesktopApp()) {
      downloadAndInstall();
      window.setTimeout(() => setBusy(false), 1500);
      return;
    }
    setProgress(0);
    downloadAndInstall();
  };

  const check = async () => {
    setStatus("checking");
    try {
      const d = await fetchRemoteVersion();
      if (d.version && isNewerVersion(d.version, currentVersion)) {
        setNewVersion(d.version);
        setNotes(d.notes);
        setStatus("available");
      } else {
        setStatus("latest");
      }
    } catch {
      setStatus("error");
    }
  };

  if (status === "available") {
    return (
      <div className="w-full flex flex-col items-start gap-2 px-1">
        <div className="flex items-center gap-1.5 text-[12px] text-green-700">
          <Icon name="Sparkles" size={14} />
          Доступна новая версия <b>v{newVersion}</b>
        </div>
        {notes && !busy && <div className="text-[11px] text-gray-500">{notes}</div>}

        {/* Ход загрузки: полоса + подпись. Пока оболочка не прислала первый
            процент, показываем «Подготовка…» — человек сразу видит реакцию. */}
        {busy && (
          <div className="w-full max-w-[260px] flex flex-col gap-1">
            <div className="h-2 rounded-full overflow-hidden bg-gray-200">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${progress ?? 3}%`,
                  background: "var(--c-green-bg, #16a34a)",
                }} />
            </div>
            <div className="text-[11px] text-gray-600">
              {progress === null ? "Подготовка к загрузке…"
                : progress < 100 ? `Загрузка обновления… ${progress}%`
                : "Установка и перезапуск программы…"}
            </div>
          </div>
        )}

        <button
          onClick={startDownload}
          disabled={busy}
          className="h-7 px-3 text-[12px] rounded text-white font-medium flex items-center gap-1.5 disabled:opacity-60"
          style={{ background: "var(--c-green-bg, #16a34a)" }}>
          {busy ? (
            <><Icon name="Loader2" size={13} className="animate-spin" />
              {progress !== null && progress < 100 ? `${progress}%` : "Обновление…"}</>
          ) : (
            <><Icon name="Download" size={13} />Скачать и обновить</>
          )}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={check}
      disabled={status === "checking"}
      className="h-7 px-3 text-[12px] rounded font-medium flex items-center gap-1.5 border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
      title="Проверить наличие обновлений">
      {status === "checking" ? (
        <><Icon name="Loader" size={13} className="animate-spin" />Проверка…</>
      ) : status === "latest" ? (
        <><Icon name="CheckCircle" size={13} className="text-green-600" />Установлена последняя версия</>
      ) : status === "error" ? (
        <><Icon name="AlertCircle" size={13} className="text-amber-600" />Не удалось проверить</>
      ) : (
        <><Icon name="RefreshCw" size={13} />Проверить обновления</>
      )}
    </button>
  );
}