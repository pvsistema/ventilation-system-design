// ─────────────────────────────────────────────────────────────────────────────
// Защита от изучения программы через инструменты разработчика.
//
// Применяется ТОЛЬКО в десктопной сборке (см. вызов из main.tsx под флагом
// __IS_DESKTOP__). В обычной браузерной версии не подключается — иначе мы
// мешали бы веб-пользователям, а на публичном сайте скрывать нечего.
//
// Что делает:
//   • блокирует контекстное меню и горячие клавиши открытия DevTools/исходника
//     (F12, Ctrl/Cmd+Shift+I/J/C, Ctrl+U);
//   • замечает открытые DevTools по резкому «отрыву» внешних границ окна от
//     внутренних (панель разработчика занимает место) и закрывает интерфейс
//     нейтральным сообщением.
//
// Чего здесь СОЗНАТЕЛЬНО НЕТ: цикла с `debugger` и ловушек-геттеров. `debugger`
// в интервале нагружает процессор и подвешивает окно даже без открытых
// DevTools, а ложное срабатывание на слабой машине на руднике «убило» бы
// рабочую программу. Здесь только пассивные проверки — они не мешают обычной
// работе, но снимают лёгкие способы залезть в код. В десктопе DevTools к тому
// же отключены в самой оболочке WebView2 (AreDevToolsEnabled=false); этот модуль
// — второй рубеж на случай запуска сборки в обычном браузере.
// ─────────────────────────────────────────────────────────────────────────────

function lockDown(): void {
  try {
    document.documentElement.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;' +
      'height:100vh;font-family:sans-serif;color:#666;font-size:15px">' +
      "Окно закрыто в целях защиты. Перезапустите программу.</div>";
  } catch { /* ignore */ }
}

export function installAntiDebug(): void {
  if (typeof window === "undefined") return;

  // Запрет контекстного меню (пункт «Просмотреть код»).
  window.addEventListener(
    "contextmenu",
    (e) => { e.preventDefault(); },
    { capture: true },
  );

  // Горячие клавиши инспекции и просмотра исходника.
  window.addEventListener(
    "keydown",
    (e) => {
      const k = (e.key || "").toLowerCase();
      const inspect =
        e.key === "F12" ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c")) ||
        ((e.ctrlKey || e.metaKey) && k === "u");
      if (inspect) { e.preventDefault(); e.stopPropagation(); }
    },
    { capture: true },
  );

  // Детект открытой панели разработчика по разнице внешних и внутренних
  // размеров окна. Требуем два срабатывания подряд — чтобы случайный кадр
  // при перетаскивании окна не давал ложную блокировку.
  let hit = 0;
  setInterval(() => {
    const dw = window.outerWidth - window.innerWidth;
    const dh = window.outerHeight - window.innerHeight;
    if (dw > 220 || dh > 220) {
      if (++hit >= 2) lockDown();
    } else {
      hit = 0;
    }
  }, 1500);
}
