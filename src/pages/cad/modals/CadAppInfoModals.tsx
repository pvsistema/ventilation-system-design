// ─────────────────────────────────────────────────────────────────────────────
// CadAppInfoModals — окна уровня приложения: подтверждение закрытия с
// несохранёнными изменениями и «О программе».
// Выделено из CadModals без изменений разметки и логики (1:1).
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";
import AppLogo from "@/components/AppLogo";
import UpdateCheckButton from "@/components/cad/UpdateCheckButton";
import CoreVersionRow from "@/components/cad/CoreVersionRow";
import { APP_VERSION, APP_BUILD_DATE } from "@/lib/appVersion";

export interface CadAppInfoModalsProps {
  projectFileName: string;

  // Подтверждение закрытия
  showCloseConfirm: boolean;
  setShowCloseConfirm: (v: boolean) => void;
  handleSave: () => Promise<void>;

  // О программе
  showAbout: boolean;
  setShowAbout: (v: boolean) => void;
}

export default function CadAppInfoModals(p: CadAppInfoModalsProps) {
  return (
    <>
      {/* ── Диалог подтверждения закрытия ───────────────────────────────── */}
      {p.showCloseConfirm && (() => {
        type W = Window & { __IS_DESKTOP__?: boolean; chrome?: { webview?: { postMessage: (s: string) => void } } };
        const w = window as W;
        const isDesktop = !!w.__IS_DESKTOP__;
        const doClose = () => {
          p.setShowCloseConfirm(false);
          if (isDesktop) {
            w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-close-confirmed" }));
          } else {
            window.close();
          }
        };
        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.45)" }}>
            <div className="bg-white rounded shadow-xl border border-gray-300 w-[340px]"
              style={{ fontFamily: "Segoe UI, Arial, sans-serif" }}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200"
                style={{ background: "var(--c-s2, #f5f5f5)", borderRadius: "8px 8px 0 0" }}>
                <Icon name="FileQuestion" size={16} className="text-yellow-600" />
                <span className="text-[13px] font-semibold text-gray-800">Несохранённые изменения</span>
              </div>
              <div className="px-4 py-4">
                <p className="text-[13px] text-gray-700 mb-1">
                  Проект <strong>«{p.projectFileName}»</strong> содержит несохранённые изменения.
                </p>
                <p className="text-[12px] text-gray-500">Сохранить перед закрытием?</p>
              </div>
              <div className="flex gap-2 justify-end px-4 pb-4">
                <button
                  onClick={() => p.setShowCloseConfirm(false)}
                  className="h-7 px-3 text-[12px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700">
                  Отмена
                </button>
                <button
                  onClick={doClose}
                  className="h-7 px-3 text-[12px] border border-gray-300 rounded hover:bg-red-50 text-red-600">
                  Не сохранять
                </button>
                <button
                  onClick={async () => { await p.handleSave(); doClose(); }}
                  className="h-7 px-3 text-[12px] rounded text-white"
                  style={{ background: "var(--c-blue-bg, #2563eb)" }}>
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Окно «О программе» ──────────────────────────────────────────── */}
      {p.showAbout && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={() => p.setShowAbout(false)}>
          <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-[460px] overflow-hidden"
            style={{ fontFamily: "Segoe UI, Arial, sans-serif" }}
            onClick={(e) => e.stopPropagation()}>
            {/* Шапка диалога */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200"
              style={{ background: "linear-gradient(180deg,var(--c-grad-a, #e8e8e8),var(--c-grad-b, #d6d6d6))" }}>
              <span className="text-[12px] font-semibold text-gray-800">О программе</span>
              <button
                onClick={() => p.setShowAbout(false)}
                className="w-6 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs rounded-sm">✕</button>
            </div>

            {/* Контент */}
            <div className="px-6 py-6 flex flex-col items-center text-center"
              style={{ background: "linear-gradient(160deg, var(--c-s1, #ffffff) 0%, var(--c-tint-blue, #eaf4fc) 100%)" }}>
              <AppLogo
                className="w-48 object-contain mb-2"
                style={{ filter: "drop-shadow(0 4px 12px rgba(14,99,176,0.15))" }}
              />

              <div className="w-full mt-5 border-t border-gray-200 pt-4 text-left text-[12px] text-gray-700 space-y-1.5">
                <div className="flex justify-between"><span className="text-gray-500">Версия:</span><span className="font-medium">{APP_VERSION}</span></div>
                <CoreVersionRow />
                <div className="flex justify-between"><span className="text-gray-500">Сборка:</span><span className="font-medium">{APP_BUILD_DATE}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Назначение:</span><span className="font-medium">Проектирование систем вентиляции и водоснабжения</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Платформа:</span><span className="font-medium">Web / Desktop</span></div>
                {(() => {
                  const isOnline = navigator.onLine;
                  return (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Сеть:</span>
                      <span className="font-medium flex items-center gap-1.5">
                        <span style={{
                          width: 8, height: 8, borderRadius: 999,
                          background: isOnline ? "var(--c-green-lt, #22c55e)" : "var(--c-amber-lt, #f59e0b)",
                          display: "inline-block",
                        }} />
                        {isOnline ? "Онлайн" : "Офлайн-режим"}
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div className="w-full mt-4 pt-3 border-t border-gray-200 text-[11px] text-gray-500 leading-relaxed">
                © 2026 ПВ-Система. Все права защищены.<br/>
                Программа предназначена для проектирования систем<br/>
                вентиляции и водоснабжения рудников и шахт.
              </div>
            </div>

            {/* Футер */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
              <UpdateCheckButton currentVersion={APP_VERSION} />
              <button
                onClick={() => p.setShowAbout(false)}
                className="h-7 px-4 text-[12px] rounded text-white font-medium flex-shrink-0"
                style={{ background: "var(--c-blue-bg, #2563eb)" }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
