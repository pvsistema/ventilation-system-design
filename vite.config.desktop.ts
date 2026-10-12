import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Vite-конфиг для desktop (Tauri) сборки.
// Защита кода:
//  1. minify (esbuild) — минификация и переименование переменных
//  2. Anti-DevTools — модуль src/lib/antiDebug.ts, подключается из main.tsx
//     под флагом __IS_DESKTOP__ (блокирует контекстное меню, горячие клавиши
//     инспекции и замечает открытые DevTools)
//  3. define — подменяет URL backend на localhost:5173

const LOCAL_SERVER = "http://127.0.0.1:5173";

export default defineConfig({
  plugins: [
    react(),
    // Anti-DevTools реализован отдельным модулем src/lib/antiDebug.ts,
    // подключаемым из main.tsx под флагом __IS_DESKTOP__.
    //
    // Строковый обфускатор СОЗНАТЕЛЬНО отключён: надёжно разобрать уже
    // минифицированный код регулярными выражениями нельзя — на границах
    // JSX/объектов он рвал соседние токены и ломал сборку. Основную защиту кода
    // дают минификация (esbuild), обфускация C#-слоя (Obfuscar) и компиляция
    // Python-ядра в .pyc; строковый обфускатор давал незначительный выигрыш при
    // большом риске поломки рабочей программы на руднике.
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Заглушка для «node:module».
      //
      // Библиотека чтения чертежей DWG (libredwg-web) собрана сразу для двух
      // сред — браузера и Node. Ветка для Node запрашивает «node:module»,
      // и сборщик писал предупреждение «Module node:module has been
      // externalized for browser compatibility».
      //
      // В программе эта ветка никогда не выполняется: и десктоп, и сайт
      // работают в браузерном движке, где библиотека сама выбирает
      // браузерный путь. Подставляем пустую заглушку — предупреждение
      // уходит, поведение не меняется.
      "node:module": path.resolve(__dirname, "./src/lib/emptyNodeModule.ts"),
    },
  },
  base: "./",
  define: {
    __DESKTOP_SERVER__: JSON.stringify(LOCAL_SERVER),
    __IS_DESKTOP__: JSON.stringify(true),
  },
  build: {
    outDir: "dist-desktop",
    emptyOutDir: true,
    minify: "esbuild",
    // ── Разделение сборки на части (ускоряет открытие окна) ─────────────────
    // Раньше весь интерфейс лежал в одном файле ~3,4 МБ и читался с диска
    // целиком при каждом запуске. Теперь тяжёлые библиотеки вынесены в
    // отдельные части и подгружаются только когда действительно нужны:
    // выгрузка в Excel — в момент экспорта, PDF — при печати, графики — при
    // открытии депрессиограммы, админ-панель — только при заходе в неё.
    //
    // Рабочий экран со схемой вентиляции намеренно НЕ дробится: он нужен сразу
    // при запуске, дробление лишь добавило бы задержку на главном сценарии.
    // ВАЖНО: manualChunks задаётся ФУНКЦИЕЙ, а не объектом.
    // Сборка идёт на rolldown-vite, а rolldown (в отличие от rollup) объектную
    // форму { "имя-части": [пакеты] } не поддерживает: сборка десктопа падала с
    // «TypeError: manualChunks is not a function» уже после трансформации
    // модулей. Функция получает путь модуля и возвращает имя части — этот
    // вариант понимают оба сборщика.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-[^\\/]+)[\\/]/.test(id)) {
            return "vendor-charts";
          }
          if (/[\\/]node_modules[\\/](jspdf|canvg|dompurify|html2canvas)[\\/]/.test(id)) {
            return "vendor-pdf";
          }
        },
      },
    },
    // Не генерировать sourcemap — исключает возможность восстановления кода
    sourcemap: false,
    // Предупреждения о размере чанков (10MB для большого приложения)
    chunkSizeWarningLimit: 10000,
  },
});