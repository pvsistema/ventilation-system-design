// ─────────────────────────────────────────────────────────────────────────────
// Публичная страница скачивания ПВ-Системы (/download).
//
// Показывает актуальную версию установщика, кнопку скачивания и контрольную
// сумму SHA-256 подлинного файла — чтобы пользователь мог сам сверить, что
// скачанный установщик не подменён. Сумму считает и подписывает сервер при
// публикации (backend/app-version), здесь мы её только показываем.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { VERSION_URL, INSTALLER_URL } from "@/lib/updater";

interface VersionData {
  version: string;
  notes: string;
  exe_sha256: string;
}

export default function Download() {
  const [data, setData] = useState<VersionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(VERSION_URL, { cache: "no-store" });
        const t = await r.text();
        if (!t.trim().startsWith("{")) throw new Error("bad");
        const d = JSON.parse(t);
        if (!cancelled) {
          setData({
            version: d.version || "—",
            notes: d.notes || "",
            exe_sha256: d.exe_sha256 || "",
          });
        }
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const copyHash = async () => {
    if (!data?.exe_sha256) return;
    try {
      await navigator.clipboard.writeText(data.exe_sha256);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard недоступен — не критично */ }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(160deg, #ffffff 0%, #eaf4fc 55%, #d2e8f7 100%)" }}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        {/* Шапка */}
        <div className="px-8 pt-8 pb-6 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center"
            style={{ background: "var(--c-blue-ink, #1a3a6b)" }}>
            <Icon name="Wind" size={28} className="text-white" />
          </div>
          <h1 className="text-[22px] font-bold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
            ПВ-Система
          </h1>
          <p className="text-[13px] text-gray-500 mt-1">
            Проектирование вентиляции и водоснабжения рудников
          </p>
        </div>

        {/* Версия и кнопка */}
        <div className="px-8 pb-8">
          {loading ? (
            <div className="py-10 text-center text-gray-400 text-[13px]">
              <Icon name="Loader" size={26} className="mx-auto mb-3 animate-spin text-gray-300" />
              Загрузка сведений о версии...
            </div>
          ) : !data ? (
            <div className="py-8 text-center text-gray-500 text-[13px]">
              <Icon name="TriangleAlert" size={26} className="mx-auto mb-3 text-amber-400" />
              Не удалось получить сведения о версии.
              <br />Попробуйте обновить страницу.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 mb-5">
                <span className="text-[12px] text-gray-400">Актуальная версия</span>
                <span className="px-2.5 py-0.5 rounded-full text-[12px] font-bold text-white"
                  style={{ background: "var(--c-blue, #2563eb)" }}>
                  {data.version}
                </span>
              </div>

              <a href={INSTALLER_URL}
                className="w-full py-3.5 rounded-xl text-[15px] font-semibold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                style={{ background: "var(--c-blue-ink, #1a3a6b)" }}>
                <Icon name="Download" size={18} />
                Скачать установщик для Windows
              </a>

              {data.notes && (
                <div className="mt-4 text-[12px] text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
                  <span className="font-semibold text-gray-600">Что нового: </span>
                  {data.notes}
                </div>
              )}

              {/* Контрольная сумма */}
              {data.exe_sha256 ? (
                <div className="mt-6">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon name="ShieldCheck" size={14} className="text-green-600" />
                    <span className="text-[12px] font-semibold text-gray-600">
                      Контрольная сумма (SHA-256)
                    </span>
                  </div>
                  <button onClick={copyHash}
                    title="Нажмите, чтобы скопировать"
                    className="w-full group flex items-center gap-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg px-3 py-2.5 text-left transition-colors">
                    <code className="flex-1 text-[11px] font-mono text-gray-700 break-all leading-relaxed">
                      {data.exe_sha256}
                    </code>
                    <Icon name={copied ? "Check" : "Copy"} size={15}
                      className={copied ? "text-green-600 shrink-0" : "text-gray-400 group-hover:text-gray-600 shrink-0"} />
                  </button>
                  <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                    После скачивания сверьте сумму файла с этой строкой — так вы убедитесь,
                    что установщик не подменён. В PowerShell:
                    <code className="block mt-1 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[10px] text-gray-600 break-all">
                      Get-FileHash имя_файла.exe -Algorithm SHA256
                    </code>
                  </p>
                </div>
              ) : (
                <p className="mt-6 text-[11px] text-gray-400 text-center">
                  Контрольная сумма для этой версии не опубликована.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
