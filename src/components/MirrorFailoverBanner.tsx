// Баннер «Основной сервер недоступен — перейти на резервный pvsistema.ru».
//
// Как проверяем:
//   • сайт — раз в 2 минуты и сразу при возврате сети / на вкладку;
//   • облачные функции — при запуске и раз в 15 минут (каждый вызов платный);
//   • сбой засчитывается после ДВУХ неудачных проверок подряд — одиночный
//     обрыв связи на пульте не должен пугать пользователя;
//   • перед показом убеждаемся, что резерв сам отвечает, — иначе предлагать
//     нечего (значит, нет интернета у пользователя).
// Когда основной сервер снова в строю — баннер исчезает сам.
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import {
  isOnMainSite, pingMainSite, pingCloudFunctions, pingMirror,
  mirrorUrlForCurrentPage, MIRROR_TITLE,
} from "@/lib/mirrorFailover";

const SITE_EVERY = 2 * 60 * 1000;
const FUNCS_EVERY = 15 * 60 * 1000;
const RETRY_AFTER = 20 * 1000;

type Problem = null | "site" | "functions";

export default function MirrorFailoverBanner() {
  const [problem, setProblem] = useState<Problem>(null);
  const [dismissed, setDismissed] = useState(false);
  const busy = useRef(false);
  const lastFuncs = useRef(0);

  useEffect(() => {
    if (!isOnMainSite()) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async (): Promise<Problem> => {
      if (!(await pingMainSite())) return "site";
      const needFuncs = Date.now() - lastFuncs.current >= FUNCS_EVERY;
      if (needFuncs) {
        lastFuncs.current = Date.now();
        if (!(await pingCloudFunctions())) return "functions";
      }
      return null;
    };

    const run = async () => {
      if (busy.current || !navigator.onLine) { schedule(SITE_EVERY); return; }
      busy.current = true;
      let p = await check();
      if (p) {
        // Перепроверка через 20 с, чтобы не реагировать на разовый обрыв
        await new Promise((r) => setTimeout(r, RETRY_AFTER));
        if (p === "functions") lastFuncs.current = 0;
        p = await check();
      }
      if (p && !(await pingMirror())) p = null;
      busy.current = false;
      if (!alive) return;
      setProblem(p);
      if (!p) setDismissed(false);
      schedule(p ? RETRY_AFTER * 3 : SITE_EVERY);
    };

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(run, ms);
    };

    const onWake = () => { if (document.visibilityState === "visible") schedule(1000); };
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    schedule(5000);

    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  if (!problem || dismissed) return null;

  const text = problem === "site"
    ? "Сайт пв-система.рф не отвечает."
    : "Серверы расчёта и лицензий пв-система.рф не отвечают.";

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-[99999] flex items-center gap-3 px-4 py-2.5 text-white"
      style={{ background: "linear-gradient(90deg,#b45309,#92400e)", fontFamily: "var(--font-ui)",
               boxShadow: "0 -2px 10px rgba(0,0,0,0.2)" }}>
      <Icon name="ServerCrash" size={18} className="flex-shrink-0" fallback="TriangleAlert" />
      <div className="flex-1 min-w-0 leading-tight">
        <div className="font-semibold text-[13px]">{text} Работает резервный сервер {MIRROR_TITLE}</div>
        <div className="text-[12px] opacity-90">
          Перед переходом сохраните проект в файл — на резервном сайте откройте его через «Файл → Открыть».
        </div>
      </div>
      <a href={mirrorUrlForCurrentPage()}
        className="h-8 px-3 rounded-md text-[12.5px] font-semibold flex-shrink-0 flex items-center gap-1.5 bg-white hover:bg-amber-50"
        style={{ color: "#92400e" }}>
        <Icon name="ArrowRightLeft" size={14} />
        Перейти на {MIRROR_TITLE}
      </a>
      <button onClick={() => setDismissed(true)} title="Скрыть до следующей проверки"
        className="h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-white/20">
        <Icon name="X" size={16} />
      </button>
    </div>
  );
}
