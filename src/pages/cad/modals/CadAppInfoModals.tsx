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
              style={{ fontFamily: "var(--font-ui)" }}>
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
      {/* Фирменный стиль, как у заставки: антрацитовая шапка с логотипом,
          янтарная сигнальная полоса, светлое тело с данными. */}
      {p.showAbout && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(15,17,20,0.55)" }}
          onClick={() => p.setShowAbout(false)}>
          <div className="about-card w-[460px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            {/* Шапка — антрацит с миллиметровкой и янтарным свечением */}
            <div className="about-hero">
              <button onClick={() => p.setShowAbout(false)} className="about-close" title="Закрыть">
                <Icon name="X" size={14} />
              </button>
              <div className="about-logo">
                <AppLogo className="w-[76px] h-[76px] object-contain" />
              </div>
              <div className="about-title">ПВ<span>-</span>Система</div>
              <div className="about-sub">Проектирование вентиляции и водоснабжения</div>
              <div className="about-ver">
                <span className="about-tag">v</span>
                <span className="font-num">{APP_VERSION}</span>
                <span className="about-dot" />
                <span className="font-num">{APP_BUILD_DATE}</span>
              </div>
            </div>

            {/* Данные */}
            <div className="px-6 pt-4 pb-3" style={{ background: "var(--c-s1, #fff)" }}>
              <div className="about-rows">
                <div className="about-row"><span className="about-k">Версия</span><span className="about-v font-num">{APP_VERSION}</span></div>
                <CoreVersionRow />
                <div className="about-row"><span className="about-k">Сборка</span><span className="about-v font-num">{APP_BUILD_DATE}</span></div>
                <div className="about-row"><span className="about-k">Назначение</span><span className="about-v">Вентиляция и водоснабжение</span></div>
                <div className="about-row"><span className="about-k">Платформа</span><span className="about-v">Web / Desktop</span></div>
                {(() => {
                  const isOnline = navigator.onLine;
                  return (
                    <div className="about-row">
                      <span className="about-k">Сеть</span>
                      <span className="about-v flex items-center gap-1.5">
                        <span className={`about-led ${isOnline ? "on" : "off"}`} />
                        {isOnline ? "Онлайн" : "Офлайн-режим"}
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div className="mt-4 text-center text-[11px] leading-relaxed" style={{ color: "var(--c-t3, #6b7280)" }}>
                Программа для проектирования систем вентиляции<br/>
                и водоснабжения рудников и шахт.<br/>
                <span style={{ color: "var(--c-t4, #8b929a)" }}>© 2026 ПВ-Система. Все права защищены.</span>
              </div>
            </div>

            {/* Футер */}
            <div className="flex items-center justify-between gap-2 px-4 py-3"
              style={{ background: "var(--c-s2, #f8f7f4)", borderTop: "1px solid var(--c-b1, #e7e4dd)" }}>
              <UpdateCheckButton currentVersion={APP_VERSION} />
              <button
                onClick={() => p.setShowAbout(false)}
                className="btn-brand h-7 px-5 text-[12px] flex-shrink-0">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
