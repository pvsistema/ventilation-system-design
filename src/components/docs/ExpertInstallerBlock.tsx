import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { APP_VERSION } from "@/lib/appVersion";
import { INSTALLER_URL, fetchRemoteVersion } from "@/lib/updater";

const YANDEX_DISK_URL = "https://disk.yandex.ru/d/ztBLZ8rKXphJEw";

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* ignore */ });
  };
  return (
    <div>
      <div className="text-[11.5px] text-slate-500 mb-1">{label}</div>
      <div className="flex items-stretch gap-2">
        <div className={`flex-1 min-w-0 px-3 py-2 rounded border border-slate-200 bg-slate-50 text-[12.5px] text-slate-800 break-all select-all ${mono ? "font-mono" : ""}`}>
          {value}
        </div>
        <button
          type="button"
          onClick={copy}
          title="Скопировать"
          className="flex-shrink-0 px-2.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-600">
          <Icon name={copied ? "Check" : "Copy"} size={15} className={copied ? "text-green-600" : ""} />
        </button>
      </div>
    </div>
  );
}

export default function ExpertInstallerBlock() {
  const [version, setVersion] = useState(APP_VERSION);
  const [sha, setSha] = useState("");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    fetchRemoteVersion(true)
      .then((v) => {
        if (v.version) setVersion(v.version);
        setSha(v.exeSha256);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, []);

  const fileName = `PVS-Setup-${version}.exe`;

  return (
    <section className="mb-8 rounded-lg border-2 border-blue-200 bg-white p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Icon name="ShieldCheck" size={18} className="text-blue-600" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">Для эксперта реестра</h2>
          <p className="text-[13px] text-slate-600 mt-0.5">
            Экземпляр программы для экспертной проверки: установщик для Windows. Скачивание
            начинается сразу, регистрация не нужна. Лицензионный ключ эксперта указан
            в инструкции, приложенной к заявлению.
          </p>
        </div>
      </div>

      <a
        href={INSTALLER_URL}
        rel="noopener"
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-medium mb-4">
        <Icon name="Download" size={17} />
        Скачать {fileName}
      </a>
      <a
        href={YANDEX_DISK_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2.5 ml-2 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[14px] font-medium mb-4">
        <Icon name="Cloud" size={17} />
        Резервная копия на Яндекс Диске
      </a>

      <div className="space-y-3">
        <CopyRow label="Прямая ссылка на установщик" value={INSTALLER_URL} />
        <CopyRow label="Резервная ссылка (Яндекс Диск, тот же файл)" value={YANDEX_DISK_URL} />
        {state === "loading" && (
          <div className="text-[12.5px] text-slate-500">Получаю контрольную сумму…</div>
        )}
        {state === "ok" && sha && <CopyRow label="Контрольная сумма SHA-256" value={sha} />}
        {(state === "error" || (state === "ok" && !sha)) && (
          <div className="text-[12.5px] text-slate-500">
            Контрольная сумма указана в инструкции для эксперта.
          </div>
        )}
        <CopyRow label="Проверка файла (командная строка Windows)"
          value={`certutil -hashfile ${fileName} SHA256`} />
      </div>

      <div className="mt-4 text-[12px] text-slate-500 leading-relaxed">
        Windows 10 (1809+) или 11, 64-разрядная · 4 ГБ ОЗУ · 500 МБ на диске.
        Расчёты выполняются на компьютере, Интернет для проверки не нужен.
      </div>
    </section>
  );
}
