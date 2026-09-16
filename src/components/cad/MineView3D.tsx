// ─────────────────────────────────────────────────────────────────────────────
// MineView3D — режим «Модель»: объёмный вид рудника на three.js.
//
// Отдельный слой поверх рабочей области. Режим «Чертёж» при этом никуда не
// девается и остаётся основным: он векторный, печатается и выгружается в SVG.
// Здесь другая задача — посмотреть схему в объёме, облететь её, показать
// заказчику или комиссии.
//
// УПРАВЛЕНИЕ (как в привычных CAD):
//   • левая кнопка   — вращение вокруг точки интереса;
//   • правая/средняя — перенос (панорама);
//   • колесо         — приближение.
//
// Камера ОРТОГРАФИЧЕСКАЯ, а не перспективная. Для маркшейдерского дела это
// принципиально: при ортогональной проекции параллельные выработки остаются
// параллельными и расстояния на экране пропорциональны натурным. Перспектива
// красивее, но по ней нельзя судить о размерах.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { buildMineScene, disposeScene, recolorScene, type BuiltScene } from "@/lib/three/mineScene";
import Icon from "@/components/ui/icon";

export interface MineView3DProps {
  width: number;
  height: number;
  nodes: TopoNode[];
  branches: TopoBranch[];
  xyScale: number;
  zScale: number;
  /** Цвет выработки — берётся тот же, что и в режиме «Чертёж». */
  colorOf: (b: TopoBranch) => string;
  /** Выбранная выработка: подсвечивается и в 3D. */
  selectedBranchId?: string | null;
  onSelectBranch?: (id: string | null) => void;
}

/** Состояние камеры: сферические координаты вокруг точки интереса. */
interface CamState {
  /** Азимут, рад */
  az: number;
  /** Угол подъёма, рад */
  el: number;
  /** Половина высоты кадра в мировых единицах (аналог зума для орто-камеры) */
  zoom: number;
  /** Точка, вокруг которой вращаемся */
  target: THREE.Vector3;
}

export default function MineView3D(p: MineView3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const builtRef = useRef<BuiltScene | null>(null);
  const rafRef = useRef<number | null>(null);
  const needsRenderRef = useRef(true);

  // Камера в сферических координатах. Стартовый ракурс — изометрия с юго-запада,
  // тот же, что предлагает режим «Чертёж» по умолчанию.
  const camRef = useRef<CamState>({
    az: -Math.PI / 4,
    el: Math.PI / 6,
    zoom: 200,
    target: new THREE.Vector3(),
  });

  const [stats, setStats] = useState({ branches: 0, drawCalls: 0, fps: 0 });
  const [webglFailed, setWebglFailed] = useState(false);
  // Признак «холст создан». Нужен, чтобы эффект управления мышью перезапустился
  // ПОСЛЕ появления canvas: сам по себе rendererRef.current в списке
  // зависимостей не отслеживается, и обработчики вешались в пустоту —
  // схема не вращалась вообще.
  const [ready, setReady] = useState(false);

  // Функция цвета живёт в ref, а не в зависимостях сборки.
  //
  // Она приходит новой почти на каждую перерисовку страницы (в CadPage часть
  // цветовых карт собирается прямо в разметке), и если держать её в списке
  // зависимостей, сцена пересобирается снова и снова — именно это сбрасывало
  // ракурс и выглядело как «схема триггерит и не вращается».
  const colorOfRef = useRef(p.colorOf);
  colorOfRef.current = p.colorOf;

  // Признак «камеру уже ставили». Вписываем схему в экран только при первом
  // показе: иначе любая пересборка (изменили расход, подвинули узел) возвращала
  // бы вид к общему плану, вырывая человека из места, куда он приблизился.
  const camInitedRef = useRef(false);

  // Размеры холста — тоже в ref.
  //
  // Это не микрооптимизация, а причина, по которой схема не вращалась. Панели
  // по краям рабочей области меняют её ширину и высоту на доли пикселя при
  // каждой перерисовке. Если размеры стоят в зависимостях эффекта мыши, он
  // пересоздаётся прямо во время перетаскивания, а вместе с ним обнуляется
  // признак «кнопка зажата» — схема замирала на первом же движении.
  const sizeRef = useRef({ w: p.width, h: p.height });
  sizeRef.current = { w: p.width, h: p.height };

  // ── Инициализация рендерера (один раз) ────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      // Видеокарта или драйвер не дают WebGL — честно сообщаем и остаёмся
      // в режиме «Чертёж», вместо чёрного экрана.
      setWebglFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf2f5fa, 1);
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    cameraRef.current = cam;
    setReady(true);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      disposeScene(builtRef.current);
      builtRef.current = null;
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      setReady(false);
    };
  }, []);

  // ── Сборка сцены при изменении схемы ──────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    void ready;   // сцену собираем только после появления холста

    // Старую сцену обязательно освобождаем — иначе видеопамять течёт при
    // каждом изменении схемы.
    if (builtRef.current) {
      scene.remove(builtRef.current.root);
      disposeScene(builtRef.current);
    }

    // Ракурс запоминаем ДО пересборки и возвращаем после: сборка не должна
    // трогать вид, даже если схема изменилась.
    const keep = { az: camRef.current.az, el: camRef.current.el, zoom: camRef.current.zoom };

    const t0 = performance.now();
    const built = buildMineScene({
      nodes: p.nodes,
      branches: p.branches,
      xyScale: p.xyScale,
      zScale: p.zScale,
      colorOf: colorOfRef.current,
    });
    const buildMs = performance.now() - t0;

    scene.add(built.root);
    builtRef.current = built;

    // Вписываем схему в экран ТОЛЬКО при первом показе. Дальше ракурс —
    // собственность человека: он мог приблизиться к конкретному стволу, и
    // возвращать его к общему плану из-за пересчёта расхода нельзя.
    const c = camRef.current;
    if (!camInitedRef.current) {
      c.target.copy(built.bounds.center);
      c.zoom = Math.max(10, built.bounds.radius * 1.15);
      camInitedRef.current = true;
    } else {
      c.az = keep.az; c.el = keep.el; c.zoom = keep.zoom;
    }

    setStats(s => ({ ...s, branches: built.branchCount, drawCalls: built.drawCalls }));
    needsRenderRef.current = true;

    // Сборка — разовая операция, полезно видеть её цену на реальной схеме.
    console.info(
      `[Модель 3D] выработок: ${built.branchCount}, вызовов отрисовки: ${built.drawCalls}, ` +
      `сборка: ${buildMs.toFixed(1)} мс`,
    );
    // p.colorOf намеренно НЕ в зависимостях — см. colorOfRef выше.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.nodes, p.branches, p.xyScale, p.zScale]);

  // ── Смена окраски без пересборки ──────────────────────────────────────
  // Переключили заливку (расход / скорость / участки / горизонты) — меняется
  // только цвет. Геометрия та же, поэтому переписываем буфер цветов и сразу
  // просим кадр. Ракурс при этом не трогается вообще.
  useEffect(() => {
    if (!builtRef.current) return;
    // Кадр просим только если цвет реально изменился.
    if (recolorScene(builtRef.current, p.colorOf)) needsRenderRef.current = true;
  }, [p.colorOf]);

  // ── Цикл отрисовки ────────────────────────────────────────────────────
  // Рисуем не постоянно, а только когда есть что показать: после поворота,
  // зума или смены схемы. На статичной картинке видеокарта простаивает —
  // это важно для ноутбуков, иначе кулер работает впустую.
  useEffect(() => {
    let last = performance.now();
    let frames = 0;
    let fpsAcc = performance.now();

    const loop = () => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const cam = cameraRef.current;
      if (renderer && scene && cam && needsRenderRef.current) {
        const c = camRef.current;
        const { w, h } = sizeRef.current;
        const aspect = w / Math.max(1, h);

        cam.left = -c.zoom * aspect;
        cam.right = c.zoom * aspect;
        cam.top = c.zoom;
        cam.bottom = -c.zoom;
        cam.updateProjectionMatrix();

        // Позиция камеры по сферическим координатам вокруг точки интереса.
        // Расстояние берём заведомо большим радиуса сцены: для орто-камеры
        // оно не влияет на размер, только на порядок отсечения.
        const d = Math.max(1000, c.zoom * 50);
        cam.position.set(
          c.target.x + d * Math.cos(c.el) * Math.sin(c.az),
          c.target.y + d * Math.sin(c.el),
          c.target.z + d * Math.cos(c.el) * Math.cos(c.az),
        );
        cam.up.set(0, 1, 0);
        cam.lookAt(c.target);

        renderer.setSize(w, h, false);
        renderer.render(scene, cam);
        needsRenderRef.current = false;
        frames++;
        last = performance.now();
      }

      // Счётчик кадров считаем ВНЕ условия отрисовки. Раньше он стоял внутри:
      // пока схему не двигают, кадров нет, ветка не выполняется, и значение
      // навсегда застревало. А в самый первый заход frames и интервал были
      // нулевыми — отсюда «NaN кадр/с» в углу.
      const now = performance.now();
      const dt = now - fpsAcc;
      if (dt >= 500) {
        const fps = dt > 0 ? Math.round((frames * 1000) / dt) : 0;
        setStats(s => (s.fps === fps ? s : { ...s, fps }));
        frames = 0;
        fpsAcc = now;
      }
      void last;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // Зависимостей нет: размеры цикл берёт из sizeRef. Перезапускать цикл
    // отрисовки при каждом изменении ширины на пиксель — верный способ
    // потерять кадр ровно в момент, когда человек тянет схему мышью.
  }, []);

  // Размер изменился — нужен новый кадр.
  useEffect(() => { needsRenderRef.current = true; }, [p.width, p.height]);

  // ── Мышь: вращение, панорама, зум ─────────────────────────────────────
  useEffect(() => {
    const el = rendererRef.current?.domElement;
    if (!el) return;

    let mode: "orbit" | "pan" | null = null;
    let lastX = 0, lastY = 0;

    const onDown = (e: MouseEvent) => {
      // Левая — вращение, правая и средняя — перенос (как в CAD-программах).
      mode = e.button === 0 ? "orbit" : "pan";
      lastX = e.clientX; lastY = e.clientY;
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      if (!mode) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      const c = camRef.current;

      if (mode === "orbit") {
        c.az -= dx * 0.008;
        // Подъём ограничиваем чуть-чуть не доходя до полюса: ровно на полюсе
        // направление «вверх» вырождается и картинка скачком переворачивается.
        const lim = Math.PI / 2 - 0.02;
        c.el = Math.max(-lim, Math.min(lim, c.el + dy * 0.008));
      } else {
        // Перенос в плоскости экрана: сдвигаем точку интереса вдоль осей
        // камеры, тогда схема движется ровно за курсором.
        const cam = cameraRef.current;
        if (cam) {
          const k = (c.zoom * 2) / Math.max(1, sizeRef.current.h);
          const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
          c.target.addScaledVector(right, -dx * k);
          c.target.addScaledVector(up, dy * k);
        }
      }
      needsRenderRef.current = true;
    };

    const onUp = () => { mode = null; };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camRef.current;
      // Шаг зума — доля от текущего масштаба, поэтому приближение ощущается
      // одинаково и на общем плане, и вблизи забоя.
      c.zoom *= e.deltaY > 0 ? 1.12 : 1 / 1.12;
      c.zoom = Math.max(1, Math.min(200000, c.zoom));
      needsRenderRef.current = true;
    };

    const onCtx = (e: MouseEvent) => e.preventDefault();

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onCtx);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onCtx);
    };
    // ready — ЕДИНСТВЕННАЯ зависимость. Без неё эффект отрабатывал ДО создания
    // холста и мышь ни к чему не привязывалась; а с размерами в списке он
    // пересоздавался посреди перетаскивания и терял зажатую кнопку.
  }, [ready]);

  /** Ставит камеру в заданный ракурс и показывает схему целиком. */
  const setView = (az: number, el: number) => {
    const c = camRef.current;
    c.az = az; c.el = el;
    const b = builtRef.current;
    if (b) { c.target.copy(b.bounds.center); c.zoom = Math.max(10, b.bounds.radius * 1.15); }
    needsRenderRef.current = true;
  };

  if (webglFailed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ background: "#f2f5fa" }}>
        <div className="text-center px-6">
          <Icon name="TriangleAlert" size={28} className="mx-auto mb-2 text-amber-500" />
          <div className="text-[13px] font-semibold text-gray-800 mb-1">Объёмный режим недоступен</div>
          <div className="text-[11px] text-gray-600 leading-relaxed max-w-[320px]">
            Видеокарта или драйвер не поддерживают WebGL. Схема по-прежнему
            доступна в режиме «Чертёж» — переключитесь обратно.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0" style={{ overflow: "hidden" }}>
      <div ref={hostRef} style={{ width: p.width, height: p.height, cursor: "grab" }} />

      {/* Кнопки стандартных ракурсов — те же, что в режиме «Чертёж» */}
      <div className="absolute top-2 left-2 flex gap-1 flex-wrap" style={{ maxWidth: 320 }}>
        {([
          ["План", 0, Math.PI / 2 - 0.02],
          ["Фронт", 0, 0],
          ["Профиль", Math.PI / 2, 0],
          ["ИЗО ЮЗ", -Math.PI / 4, Math.PI / 6],
          ["ИЗО ЮВ", Math.PI / 4, Math.PI / 6],
        ] as [string, number, number][]).map(([label, az, el]) => (
          <button key={label} onClick={() => setView(az, el)}
            className="text-[11px] px-2 py-1 rounded border bg-white/90 hover:bg-white"
            style={{ borderColor: "var(--c-b2, #d1d5db)", color: "var(--c-t2, #374151)" }}>
            {label}
          </button>
        ))}
      </div>

      {/* Счётчик скорости: ради него прототип и делался — видно цену объёма */}
      <div className="absolute bottom-2 left-2 text-[10px] px-2 py-1 rounded"
        style={{ background: "rgba(255,255,255,0.92)", border: "1px solid var(--c-b1, #e5e7eb)", color: "var(--c-t3, #6b7280)" }}>
        выработок: <b>{stats.branches}</b> · вызовов отрисовки: <b>{stats.drawCalls}</b> · {stats.fps} кадр/с
      </div>

      <div className="absolute bottom-2 right-2 text-[10px] px-2 py-1 rounded"
        style={{ background: "rgba(255,255,255,0.92)", border: "1px solid var(--c-b1, #e5e7eb)", color: "var(--c-t3, #6b7280)" }}>
        ЛКМ — поворот · ПКМ — перенос · колесо — приближение
      </div>
    </div>
  );
}