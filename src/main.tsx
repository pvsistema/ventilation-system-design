import * as React from 'react';
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import '@fontsource/ibm-plex-sans/300.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import { applyTheme, getStoredTheme } from './lib/theme'
import { installAntiDebug } from './lib/antiDebug'

// __IS_DESKTOP__ инжектируется Vite только в десктопной сборке
// (vite.config.desktop.ts). В браузере флаг отсутствует.
declare const __IS_DESKTOP__: boolean | undefined;

// Тему применяем ДО первой отрисовки, иначе при тёмной теме на миг
// мелькнёт белый интерфейс.
applyTheme(getStoredTheme());

// Защита от инспекции кода — только в десктопной версии.
if (typeof __IS_DESKTOP__ !== 'undefined' && __IS_DESKTOP__) {
  installAntiDebug();
}

createRoot(document.getElementById("root")!).render(<App />);

// ─── Отключение PWA: снимаем ранее установленный Service Worker и его кэш ──
// (у пользователей, кто уже открывал сайт, SW закэширован — удаляем его)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
    .catch(() => {});
}
if (typeof caches !== 'undefined' && caches.keys) {
  caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
}

const splash = document.getElementById('app-splash');
if (splash) {
  const hideSplash = () => {
    if (!document.getElementById('app-splash')) return;
    const el = document.getElementById('app-splash')!;
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
    setTimeout(() => el.remove(), 600);
  };
  // Убираем через 1.5 сек — гарантированно, независимо от React
  setTimeout(hideSplash, 1500);
}