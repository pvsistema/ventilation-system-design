import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { applyTheme, getStoredTheme, resolveTheme, watchSystemTheme, type ThemeMode } from "@/lib/theme";

interface Props {
  onClose: () => void;
}

const THEMES: { id: ThemeMode; label: string; hint: string; icon: string }[] = [
  { id: "light",  label: "Светлая", hint: "Для работы при ярком освещении и печати", icon: "Sun" },
  { id: "dark",   label: "Тёмная",  hint: "Меньше устают глаза в слабо освещённом помещении", icon: "Moon" },
  { id: "system", label: "Как в системе", hint: "Следовать настройке Windows", icon: "Monitor" },
];

/** Миниатюра окна программы — показывает, как будет выглядеть тема. */
function ThemePreview({ dark }: { dark: boolean }) {
  const c = dark
    ? { bg: "#10151d", panel: "#171d28", head: "#1e2632", line: "#38455a", text: "#c2ccdb", dim: "#6b7a90" }
    : { bg: "#ffffff", panel: "#f9f9f9", head: "#e8e8e8", line: "#d1d5db", text: "#374151", dim: "#9ca3af" };
  return (
    <svg viewBox="0 0 120 74" className="w-full rounded-sm" style={{ border: `1px solid ${c.line}` }}>
      <rect width="120" height="74" fill={c.bg} />
      {/* лента вкладок */}
      <rect width="120" height="9" fill={c.head} />
      <rect x="3" y="2.5" width="13" height="4" rx="1" fill="#2563eb" />
      <rect x="19" y="2.5" width="11" height="4" rx="1" fill={c.dim} opacity="0.55" />
      <rect x="33" y="2.5" width="11" height="4" rx="1" fill={c.dim} opacity="0.55" />
      {/* боковая панель */}
      <rect x="0" y="9" width="27" height="65" fill={c.panel} />
      <rect x="3" y="13" width="20" height="3" rx="1" fill={c.text} opacity="0.65" />
      <rect x="3" y="19" width="16" height="3" rx="1" fill={c.dim} opacity="0.5" />
      <rect x="3" y="25" width="18" height="3" rx="1" fill={c.dim} opacity="0.5" />
      {/* схема на холсте */}
      <line x1="38" y1="55" x2="62" y2="34" stroke="#3b82f6" strokeWidth="1.6" />
      <line x1="62" y1="34" x2="88" y2="42" stroke="#3b82f6" strokeWidth="1.6" />
      <line x1="62" y1="34" x2="79" y2="18" stroke="#22c55e" strokeWidth="1.6" />
      <line x1="88" y1="42" x2="106" y2="30" stroke="#f59e0b" strokeWidth="1.6" />
      <circle cx="38" cy="55" r="2.6" fill="#3b82f6" />
      <circle cx="62" cy="34" r="2.6" fill="#3b82f6" />
      <circle cx="88" cy="42" r="2.6" fill="#f59e0b" />
      <circle cx="79" cy="18" r="2.6" fill="#22c55e" />
      <circle cx="106" cy="30" r="2.6" fill="#ef4444" />
      {/* строка состояния */}
      <rect x="27" y="68" width="93" height="6" fill={c.head} />
      <rect x="30" y="70" width="16" height="2" rx="1" fill={c.dim} opacity="0.7" />
    </svg>
  );
}

export default function SettingsDialog({ onClose }: Props) {
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme);

  // Пока выбран режим «как в системе» — реагируем на смену темы Windows
  useEffect(() => watchSystemTheme(mode, () => applyTheme(mode)), [mode]);

  const choose = (m: ThemeMode) => {
    setMode(m);
    // Плавный переход вместо резкого скачка цветов
    document.body.classList.add("theme-switching");
    applyTheme(m);
    setTimeout(() => document.body.classList.remove("theme-switching"), 250);
  };

  const effective = resolveTheme(mode);

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="bg-white border border-gray-300 shadow-2xl flex flex-col"
        style={{ width: 560, maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <Icon name="Settings" size={15} className="text-gray-600" />
            <span className="text-[13px] font-semibold text-gray-800">Настройки программы</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-0.5">
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-[12px] font-semibold text-gray-800 mb-1">Тема оформления</div>
          <div className="text-[11px] text-gray-500 mb-3">
            Выбор запоминается и применяется при следующем запуске программы.
          </div>

          <div className="grid grid-cols-3 gap-2.5 mb-4">
            {THEMES.map((t) => {
              const active = mode === t.id;
              const previewDark = t.id === "system" ? resolveTheme("system") === "dark" : t.id === "dark";
              return (
                <button key={t.id} onClick={() => choose(t.id)}
                  className="text-left rounded border p-2 transition-colors"
                  style={{
                    borderColor: active ? "#2563eb" : undefined,
                    boxShadow: active ? "0 0 0 2px rgba(37,99,235,0.18)" : undefined,
                  }}
                  {...(!active ? { "data-inactive": true } : {})}>
                  <div className={!active ? "border-gray-300" : ""}>
                    <ThemePreview dark={previewDark} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <Icon name={t.icon} size={13} className={active ? "text-blue-600" : "text-gray-500"} />
                    <span className={`text-[12px] ${active ? "font-semibold text-blue-700" : "text-gray-700"}`}>
                      {t.label}
                    </span>
                    {active && <Icon name="Check" size={13} className="text-blue-600 ml-auto" />}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1 leading-snug">{t.hint}</div>
                </button>
              );
            })}
          </div>

          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded px-3 py-2">
            <Icon name="Info" size={13} className="text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-[11px] text-blue-800 leading-snug">
              Сейчас включена <b>{effective === "dark" ? "тёмная" : "светлая"}</b> тема.
              На печать и в экспортируемые документы схема всегда выводится на белом фоне —
              тема оформления на них не влияет.
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose}
            className="px-4 py-1.5 text-[12px] bg-blue-600 text-white rounded hover:bg-blue-700">
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
