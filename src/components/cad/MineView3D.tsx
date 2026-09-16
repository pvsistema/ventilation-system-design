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
import { buildMineScene, disposeScene, recolorScene, pickBranch, setHighlight, type BuiltScene } from "@/lib/three/mineScene";
import { buildMineLabels, drawMineLabels, type MineLabel } from "@/lib/three/mineLabels";
import { buildFlowArrows, type FlowArrows } from "@/lib/three/mineArrows";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type WaterBranchResult } from "@/lib/waterHydraulics";
import { flowTime } from "@/lib/flowAnim";
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
  // ── Подписи выработок ────────────────────────────────────────────────
  // Набор величин и единицы — те же, что у чертежа: «Панель информации»
  // управляет обоими режимами сразу, иначе человек, настроив подписи, не нашёл
  // бы их в объёме.
  /** Какие величины показывать в подписи. */
  infoConfig?: InfoDisplayConfig | null;
  /** Единицы измерения для подписей. */
  unitsConfig?: UnitsConfig;
  /** Результаты расчёта водопровода — для показаний редуктора в подписи. */
  waterBranchResults?: Map<string, WaterBranchResult>;
  /**
   * Выработки с загазованной (исходящей) струёй. Стрелки в них синие, в
   * остальных красные — ровно как на чертеже. Считается снаружи тем же
   * расчётом, чтобы два режима не разошлись в главном.
   */
  pollutedBranchIds?: Set<string>;
  /** Множитель скорости анимации: 1 — обычная, 0.5 — вдвое медленнее. */
  animSpeed?: number;
  /**
   * Включена ли кнопка «Анимация» на ленте.
   *
   * Она одна на оба режима: выключив движение на чертеже и перейдя в объём,
   * человек вправе ожидать, что стрелки и здесь стоят. Сами стрелки при этом
   * никуда не деваются — замирают на местах: направление струи читается по
   * ним и в неподвижном виде, а на слабой видеокарте непрерывная перерисовка
   * съедает всё, что осталось.
   */
  animated?: boolean;
  // ── Общий ракурс с режимом «Чертёж» ──────────────────────────────────
  // Азимут и угол подъёма — одни на оба режима. Человек, повернувший схему
  // на чертеже и перешедший в объём, вправе увидеть её с того же угла, а не
  // с чужого; и наоборот. Углы в ГРАДУСАХ — как в чертеже (см. ProjOptions),
  // перевод в радианы делается здесь, чтобы наружу торчала одна система.
  /** Азимут чертежа, ° — поворот вокруг вертикали. */
  viewAzimuth?: number;
  /** Угол подъёма чертежа, ° (90 — план сверху, 0 — фронт). */
  viewElevation?: number;
  /** Сообщить чертежу новый ракурс после вращения в объёме. */
  onViewAngles?: (azimuthDeg: number, elevationDeg: number) => void;
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

  // Холст подписей — отдельный слой поверх картинки видеокарты. Почему не
  // объёмный текст в самой сцене, см. комментарий в mineLabels.ts.
  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelsRef = useRef<MineLabel[]>([]);
  // Выключатель подписей. Держим в состоянии (нужна кнопка) и в ref (цикл
  // отрисовки не должен зависеть от перерисовок React).
  const [showLabels, setShowLabels] = useState(true);
  const showLabelsRef = useRef(showLabels);
  showLabelsRef.current = showLabels;

  // Стрелки направления воздуха — пакетный меш, живёт отдельно от схемы:
  // расход пересчитывается чаще, чем меняется геометрия, и пересобирать ради
  // стрелок всю схему незачем.
  const arrowsRef = useRef<FlowArrows | null>(null);
  const [showArrows, setShowArrows] = useState(true);
  const [arrowCount, setArrowCount] = useState(0);
  // Стрелки бегут — значит кадры нужны непрерывно, а не по событию. Держим это
  // признаком в ref: цикл отрисовки не должен зависеть от перерисовок React.
  const animatingRef = useRef(false);

  const [stats, setStats] = useState({ branches: 0, drawCalls: 0, fps: 0 });
  // Выработка под курсором: её имя показываем в плашке, а саму — подсвечиваем.
  // Держим в состоянии только то, что видно на экране (id и подпись): сама
  // подсветка живёт в сцене и через React не проходит.
  const [hover, setHover] = useState<{ id: string; title: string; note: string; x: number; y: number } | null>(null);
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

  // Выделение и обработчик выбора — тоже в ref, и по той же причине, что
  // размеры: эффект мыши должен пережить любую перерисовку страницы. Если
  // держать их в зависимостях, обработчики пересоздавались бы на каждый клик
  // (выбор меняет состояние в CadPage), и первое же движение теряло бы кнопку.
  const selectedRef = useRef(p.selectedBranchId ?? null);
  selectedRef.current = p.selectedBranchId ?? null;
  const onSelectRef = useRef(p.onSelectBranch);
  onSelectRef.current = p.onSelectBranch;

  // Обработчик «ракурс изменился» — в ref по той же причине: эффект мыши
  // пересоздавать нельзя, а вызывать обработчик нужно на каждое движение.
  const onAnglesRef = useRef(p.onViewAngles);
  onAnglesRef.current = p.onViewAngles;

  // Луч для выбора мышью — один на весь компонент, чтобы не создавать объект
  // на каждое движение курсора.
  const rayRef = useRef(new THREE.Raycaster());
  const hoverIdRef = useRef<string | null>(null);

  // Имена узлов для подсказки. Без них в плашке у безымянной выработки стояли
  // бы служебные идентификаторы вида «n17f3» — человеку они ничего не говорят.
  const nodeNameRef = useRef(new Map<string, string>());
  nodeNameRef.current = new Map(p.nodes.map(n => [n.id, (n.name || n.number || "").trim() || n.id]));

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

    // Потеря контекста видеокарты. Случается на больших сценах, при спящем
    // режиме ноутбука и при обновлении драйвера. Внешне — ровно тот же белый
    // экран: холст жив, но рисовать в нём больше нечем. Без этого обработчика
    // человек видел бы пустоту и не понимал, что произошло.
    const onLost = (e: Event) => {
      e.preventDefault();          // без этого контекст не восстановится
      setWebglFailed(true);
    };
    const onRestored = () => {
      setWebglFailed(false);
      needsRenderRef.current = true;
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    renderer.domElement.addEventListener("webglcontextrestored", onRestored);

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Границы отсечения (near/far) выставляются в цикле отрисовки по реальному
    // размеру схемы. Жёстко заданные числа здесь — лишь заглушка до первого
    // кадра: на большом руднике любая константа рано или поздно оказывается
    // меньше схемы, и та целиком уходит за дальнюю границу.
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    cameraRef.current = cam;
    setReady(true);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onRestored);
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
    // Габарит выводим тоже: если схема не показалась, по нему сразу видно,
    // дошла ли геометрия до сцены или отсеялась на входе.
    console.info(
      `[Модель 3D] выработок: ${built.branchCount}, вызовов отрисовки: ${built.drawCalls}, ` +
      `сборка: ${buildMs.toFixed(1)} мс, радиус схемы: ${built.bounds.radius.toFixed(0)}`,
    );

    // Выработки есть, а габарит нулевой — геометрия до сцены не дошла.
    // Чаще всего это значит, что у узлов нет координат.
    if (built.branchCount > 0 && !(built.bounds.radius > 0)) {
      console.warn("[Модель 3D] схема собрана, но габарит пустой — проверьте координаты узлов");
    }
    // Ни одной выработки при непустом списке — все отсеялись на входе.
    if (built.branchCount === 0 && p.branches.length > 0) {
      console.warn(
        `[Модель 3D] ни одна из ${p.branches.length} выработок не попала в сцену: ` +
        `нет узлов или координаты не числовые`,
      );
    }
    // p.colorOf намеренно НЕ в зависимостях — см. colorOfRef выше.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.nodes, p.branches, p.xyScale, p.zScale]);

  // ── Подписи выработок ─────────────────────────────────────────────────
  // Текст собирается заранее и отдельно от геометрии: он меняется чаще (галочка
  // в «Панели информации», смена единиц), но пересобирать ради него сцену в
  // видеопамяти незачем — положение выработок от этого не меняется.
  useEffect(() => {
    labelsRef.current = buildMineLabels({
      nodes: p.nodes,
      branches: p.branches,
      xyScale: p.xyScale,
      zScale: p.zScale,
      infoConfig: p.infoConfig,
      unitsConfig: p.unitsConfig ?? DEFAULT_UNITS_CONFIG,
      waterBranchResults: p.waterBranchResults,
    });
    needsRenderRef.current = true;
  }, [p.nodes, p.branches, p.xyScale, p.zScale, p.infoConfig, p.unitsConfig, p.waterBranchResults]);

  // Подписи включили или выключили — нужен новый кадр, иначе слой так и остался
  // бы в прежнем состоянии до первого поворота схемы.
  useEffect(() => { needsRenderRef.current = true; }, [showLabels, p.selectedBranchId]);

  // ── Стрелки направления воздуха ───────────────────────────────────────
  // Пересобираются при изменении схемы и при выключении: меш небольшой (один
  // конус на выработку), а вот держать в сцене невидимые стрелки незачем —
  // видеокарта всё равно прогоняет их через отсечение.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Старые стрелки освобождаем: и геометрия, и материал у них собственные,
    // со схемой не делятся — без dispose видеопамять течёт при каждом расчёте.
    const prev = arrowsRef.current;
    if (prev) {
      scene.remove(prev.mesh);
      prev.dispose();
      arrowsRef.current = null;
    }
    animatingRef.current = false;
    setArrowCount(0);

    if (showArrows) {
      const arrows = buildFlowArrows({
        nodes: p.nodes, branches: p.branches,
        xyScale: p.xyScale, zScale: p.zScale,
        pollutedBranchIds: p.pollutedBranchIds,
        animSpeed: p.animSpeed,
      });
      if (arrows) {
        scene.add(arrows.mesh);
        arrowsRef.current = arrows;
        setArrowCount(arrows.arrowCount);
        // Кадр за кадром схема перерисовывается только пока стрелки ДВИЖУТСЯ.
        // Раньше здесь стояло безусловное true: стрелки бежали даже с
        // выключенной кнопкой «Анимация», и отключить их было нечем, а
        // видеокарта грелась на статичной картинке. Теперь выключенная
        // анимация возвращает отрисовку по событию: стрелки остаются на
        // схеме, но стоят.
        animatingRef.current = p.animated !== false;
        // Замершие стрелки ставим в начало пробега, иначе они остались бы там,
        // где их застало выключение, — вразнобой по всей выработке.
        if (!animatingRef.current) arrows.setTime(0);
      }
    }
    needsRenderRef.current = true;

    return () => {
      const a = arrowsRef.current;
      if (!a) return;
      scene.remove(a.mesh);
      a.dispose();
      arrowsRef.current = null;
      animatingRef.current = false;
    };
  }, [ready, showArrows, p.nodes, p.branches, p.xyScale, p.zScale, p.pollutedBranchIds, p.animSpeed, p.animated]);

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

    // Время для бегущих стрелок берём из ОБЩИХ часов (flowAnim.flowTime):
    // те же самые, по которым движется анимация на чертеже. Раньше отсчёт шёл
    // от момента открытия режима «Модель», и при переключении «Чертёж ↔
    // Модель» стрелки начинали путь заново — движение выглядело рассогласованным.

    const loop = () => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const cam = cameraRef.current;

      // Стрелки бегут — двигаем их и просим кадр. Само движение считает
      // видеокарта, здесь только одно число на всю схему.
      const arrows = arrowsRef.current;
      if (animatingRef.current && arrows) {
        arrows.setTime(flowTime());
        needsRenderRef.current = true;
      }

      if (renderer && scene && cam && needsRenderRef.current) {
        const c = camRef.current;
        const { w, h } = sizeRef.current;
        const aspect = w / Math.max(1, h);

        // Последний рубеж обороны камеры. Если zoom или точка интереса каким-то
        // образом стали нечислом, матрица проекции вырождается и видеокарта
        // перестаёт рисовать вообще всё — рабочая область белеет, хотя схема на
        // месте. Молча возвращаем камеру к общему плану: лучше показать схему
        // целиком, чем пустой экран.
        if (!isFinite(c.zoom) || c.zoom <= 0 ||
            !isFinite(c.az) || !isFinite(c.el) ||
            !isFinite(c.target.x) || !isFinite(c.target.y) || !isFinite(c.target.z)) {
          const b = builtRef.current;
          c.az = -Math.PI / 4;
          c.el = Math.PI / 6;
          c.target.copy(b ? b.bounds.center : new THREE.Vector3());
          c.zoom = b ? Math.max(10, b.bounds.radius * 1.15) : 200;
        }

        cam.left = -c.zoom * aspect;
        cam.right = c.zoom * aspect;
        cam.top = c.zoom;
        cam.bottom = -c.zoom;

        // Позиция камеры по сферическим координатам вокруг точки интереса.
        // Для орто-камеры расстояние не влияет на размер картинки, только на
        // то, куда попадают границы отсечения.
        //
        // Отступ раньше считался как zoom×50 при жёстких границах ±100 000.
        // На схеме в пару километров (да ещё с масштабом плана ×2,7) отступ
        // переваливал за двести тысяч — вся схема оказывалась ДАЛЬШЕ дальней
        // границы и просто не рисовалась: рабочая область оставалась пустой.
        // Теперь отступ скромный, а границы считаются от габарита схемы, и
        // размер рудника перестал что-либо решать.
        const radius = builtRef.current?.bounds.radius ?? c.zoom;
        const span = Math.max(radius, c.zoom) * 4 + 1000;
        const d = span;

        cam.near = -span * 2;
        cam.far = span * 2;
        cam.updateProjectionMatrix();

        cam.position.set(
          c.target.x + d * Math.cos(c.el) * Math.sin(c.az),
          c.target.y + d * Math.sin(c.el),
          c.target.z + d * Math.cos(c.el) * Math.cos(c.az),
        );
        cam.up.set(0, 1, 0);
        cam.lookAt(c.target);

        renderer.setSize(w, h, false);
        renderer.render(scene, cam);

        // Подписи — вторым слоем, на обычном холсте поверх картинки
        // видеокарты. Только здесь: матрица камеры уже окончательная, и текст
        // сядет ровно на те места, где нарисованы выработки.
        const lc = labelCanvasRef.current;
        if (lc) {
          if (showLabelsRef.current && labelsRef.current.length > 0) {
            const dpr = Math.min(window.devicePixelRatio, 2);
            // Холст держим в пикселях устройства, а рисуем в логических:
            // иначе текст на экранах с высокой плотностью выходит мыльным.
            if (lc.width !== Math.round(w * dpr) || lc.height !== Math.round(h * dpr)) {
              lc.width = Math.round(w * dpr);
              lc.height = Math.round(h * dpr);
            }
            const lctx = lc.getContext("2d");
            if (lctx) {
              lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              drawMineLabels(lctx, labelsRef.current, cam, {
                selectedId: selectedRef.current, width: w, height: h,
              });
            }
          } else if (lc.width > 0) {
            // Подписи выключили — холст гасим, иначе на схеме остался бы
            // отпечаток последнего кадра с текстом.
            const lctx = lc.getContext("2d");
            lctx?.setTransform(1, 0, 0, 1, 0, 0);
            lctx?.clearRect(0, 0, lc.width, lc.height);
          }
        }

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

  // ── Ракурс, пришедший из режима «Чертёж» ──────────────────────────────
  //
  // Углы общие на оба режима. Здесь принимаем изменение, сделанное на чертеже
  // (кнопки «План/Фронт/ИЗО», вращение мышью) — и поворачиваем объём так же.
  //
  // Своё собственное вращение в объёме тоже проходит через эти пропсы: оно
  // уходит наверх, возвращается и попадает сюда. Чтобы схема при этом не
  // дёргалась, сравниваем с уже установленным углом и с точностью до сотой
  // градуса ничего не трогаем — иначе округление при переводе градусы↔радианы
  // на каждом кадре давало бы микроскачок.
  useEffect(() => {
    const azDeg = p.viewAzimuth, elDeg = p.viewElevation;
    if (azDeg === undefined || elDeg === undefined) return;
    const c = camRef.current;
    // Азимут в чертеже отсчитывается в ту же сторону, что и здесь, но у
    // объёма ноль смотрит вдоль −Z, а у чертежа — вдоль −Y. Совмещаем знаком:
    // при вращении чертежа вправо объём тоже поворачивается вправо.
    const az = (-azDeg * Math.PI) / 180;
    // Угол подъёма: 90° в чертеже — план сверху, у нас это предельный подъём.
    const lim = Math.PI / 2 - 0.02;
    const el = Math.max(-lim, Math.min(lim, (elDeg * Math.PI) / 180));
    if (Math.abs(c.az - az) < 1e-4 && Math.abs(c.el - el) < 1e-4) return;
    c.az = az; c.el = el;
    needsRenderRef.current = true;
  }, [p.viewAzimuth, p.viewElevation]);

  // ── Подсветка выбранной выработки ─────────────────────────────────────
  // Выбор мог прийти и снаружи — из режима «Чертёж», из таблицы, из поиска.
  // Модель обязана показать ту же выработку: человек щёлкнул строку в списке и
  // ждёт, что в объёме она загорится.
  useEffect(() => {
    if (setHighlight(builtRef.current, p.selectedBranchId ?? null, hoverIdRef.current)) {
      needsRenderRef.current = true;
    }
  }, [p.selectedBranchId, ready, p.nodes, p.branches]);

  // ── Мышь: вращение, панорама, зум, выбор выработки ────────────────────
  useEffect(() => {
    const el = rendererRef.current?.domElement;
    if (!el) return;

    let mode: "orbit" | "pan" | null = null;
    let lastX = 0, lastY = 0;
    // Сколько пикселей прошла мышь с нажатия. Нужно, чтобы отличить щелчок от
    // вращения: обе операции — левая кнопка, и без этого порога любой облёт
    // схемы заканчивался бы случайным выбором выработки под курсором.
    let dragDist = 0;
    /** Когда последний раз искали выработку под курсором (мс). */
    let lastPick = 0;

    /**
     * Сообщает наверх текущий ракурс — в градусах чертежа.
     *
     * Обратный перевод к тому, что делает эффект приёма выше: знак азимута
     * меняется, подъём переводится в градусы. Благодаря этому оба режима
     * держат один и тот же угол, откуда бы его ни повернули.
     */
    const notifyAngles = () => {
      const c = camRef.current;
      onAnglesRef.current?.(
        (-c.az * 180) / Math.PI,
        (c.el * 180) / Math.PI,
      );
    };

    /** Что находится под курсором. null — пусто или сцена ещё не собрана. */
    const pickAt = (e: MouseEvent) => {
      const cam = cameraRef.current;
      const built = builtRef.current;
      if (!cam || !built) return null;
      const rect = el.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return null;
      // Экранные координаты → нормализованные [-1..1], как ждёт Raycaster.
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rayRef.current.setFromCamera(ndc, cam);
      return pickBranch(built, rayRef.current);
    };

    const onDown = (e: MouseEvent) => {
      // Левая — вращение, правая и средняя — перенос (как в CAD-программах).
      mode = e.button === 0 ? "orbit" : "pan";
      lastX = e.clientX; lastY = e.clientY;
      dragDist = 0;
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      if (!mode) {
        // Слежение за мышью висит на окне (иначе теряется вращение, когда
        // курсор ушёл за край холста). Значит, сюда приходят и движения над
        // кнопками ракурсов и над панелями — искать там выработку не нужно.
        if (e.target !== el) {
          if (hoverIdRef.current !== null) {
            hoverIdRef.current = null;
            if (setHighlight(builtRef.current, selectedRef.current, null)) needsRenderRef.current = true;
            el.style.cursor = "grab";
          }
          setHover(prev => (prev ? null : prev));
          return;
        }
        // Кнопка не зажата — ищем выработку под курсором.
        //
        // Луч проверяется по каждому экземпляру, и на схеме в тысячи выработок
        // это единицы миллисекунд. Мышь присылает события чаще, чем монитор
        // успевает показать кадр, поэтому чаще 60 раз в секунду не ищем: на
        // глаз разницы нет, а процессор освобождается заметно.
        const now = performance.now();
        if (now - lastPick < 16) return;
        lastPick = now;

        const hit = pickAt(e);
        const id = hit?.branch.id ?? null;
        if (id !== hoverIdRef.current) {
          hoverIdRef.current = id;
          if (setHighlight(builtRef.current, selectedRef.current, id)) needsRenderRef.current = true;
          el.style.cursor = id ? "pointer" : "grab";
        }
        if (hit) {
          // Название — то же, что в чертеже: название выработки, а если оно не
          // заполнено, подставляем узлы, чтобы плашка не оказалась пустой.
          const b = hit.branch;
          const nm = nodeNameRef.current;
          const title = (b.type || "").trim()
            || `${nm.get(b.fromId) ?? "?"} → ${nm.get(b.toId) ?? "?"}`;
          // Расход и скорость прямо в подсказке: это те два числа, ради
          // которых выработку и ищут в модели.
          const q = Math.abs(b.flow ?? 0);
          const note = q > 0.005
            ? `Q = ${q.toFixed(1)} м³/с · v = ${Math.abs(b.velocity ?? 0).toFixed(1)} м/с`
            : "воздух не рассчитан";
          const rect = el.getBoundingClientRect();
          setHover({ id: b.id, title, note, x: e.clientX - rect.left, y: e.clientY - rect.top });
        } else if (hoverIdRef.current === null) {
          setHover(prev => (prev ? null : prev));
        }
        return;
      }
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      dragDist += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX; lastY = e.clientY;
      const c = camRef.current;

      if (mode === "orbit") {
        c.az -= dx * 0.008;
        // Подъём ограничиваем чуть-чуть не доходя до полюса: ровно на полюсе
        // направление «вверх» вырождается и картинка скачком переворачивается.
        const lim = Math.PI / 2 - 0.02;
        c.el = Math.max(-lim, Math.min(lim, c.el + dy * 0.008));
        // Сообщаем чертежу: ракурс общий, и повернув схему в объёме, человек
        // ожидает найти её под тем же углом, вернувшись к чертежу.
        notifyAngles();
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

    const onUp = (e: MouseEvent) => {
      const wasOrbit = mode === "orbit";
      mode = null;
      if (!wasOrbit) return;

      // Щелчок, а не облёт. Порог в 4 пикселя: рука на мыши всегда чуть дрожит,
      // и требовать идеально неподвижного клика — значит не дать выбрать
      // выработку вовсе.
      if (dragDist > 4) return;
      // Отпустили кнопку за пределами холста — это конец перетаскивания,
      // выбирать здесь нечего.
      if (e.target !== el) return;

      const hit = pickAt(e);
      const id = hit?.branch.id ?? null;
      // Щелчок по пустому месту снимает выделение — так же ведёт себя чертёж.
      onSelectRef.current?.(id);
      // Подсветку ставим сразу, не дожидаясь, пока выбор вернётся сверху:
      // на большой схеме пересчёт занимает кадр-другой, и без этого выделение
      // заметно «догоняло» щелчок.
      selectedRef.current = id;
      if (setHighlight(builtRef.current, id, hoverIdRef.current)) needsRenderRef.current = true;
    };

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

    // Курсор ушёл с холста совсем (в панель, за окно) — гасим подсветку.
    // Движений мыши сюда больше не придёт, и без этого выработка осталась бы
    // подсвеченной, хотя курсор давно в другом месте.
    const onLeave = () => {
      if (hoverIdRef.current === null) return;
      hoverIdRef.current = null;
      if (setHighlight(builtRef.current, selectedRef.current, null)) needsRenderRef.current = true;
      el.style.cursor = "grab";
      setHover(null);
    };

    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onCtx);
    return () => {
      el.removeEventListener("mouseleave", onLeave);
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
    // Ракурс общий с чертежом — сообщаем и отсюда, иначе кнопки «План/Фронт»
    // в объёме разворачивали бы только его, а чертёж оставался под старым углом.
    p.onViewAngles?.((-az * 180) / Math.PI, (el * 180) / Math.PI);
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

      {/* Слой подписей. pointerEvents отключены: холст лежит поверх схемы во
          всю рабочую область, и без этого он перехватывал бы и вращение, и
          выбор выработки — модель перестала бы отзываться на мышь вообще. */}
      <canvas
        ref={labelCanvasRef}
        style={{
          position: "absolute", left: 0, top: 0,
          width: p.width, height: p.height,
          pointerEvents: "none",
        }}
      />

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

        {/* Подписи нужны не всегда: при разборе геометрии текст мешает, при
            разговоре о расходах — наоборот, главное на экране. Поэтому
            выключатель стоит рядом с ракурсами, а не прячется в настройках. */}
        <button
          onClick={() => setShowLabels(v => !v)}
          title={showLabels ? "Скрыть подписи выработок" : "Показать подписи выработок"}
          className="text-[11px] px-2 py-1 rounded border hover:bg-white"
          style={{
            borderColor: showLabels ? "#2563eb" : "var(--c-b2, #d1d5db)",
            color: showLabels ? "#2563eb" : "var(--c-t2, #374151)",
            background: showLabels ? "rgba(219,234,254,0.9)" : "rgba(255,255,255,0.9)",
          }}
        >
          Подписи
        </button>

        {/* Стрелки направления воздуха. Выключаются отдельно от подписей: при
            разговоре о направлении струи текст обычно мешает, и наоборот. */}
        <button
          onClick={() => setShowArrows(v => !v)}
          title={showArrows ? "Скрыть стрелки направления воздуха" : "Показать стрелки направления воздуха"}
          className="text-[11px] px-2 py-1 rounded border hover:bg-white"
          style={{
            borderColor: showArrows ? "#dc2626" : "var(--c-b2, #d1d5db)",
            color: showArrows ? "#dc2626" : "var(--c-t2, #374151)",
            background: showArrows ? "rgba(254,226,226,0.9)" : "rgba(255,255,255,0.9)",
          }}
        >
          Направление
        </button>
      </div>

      {/* Подсказка под курсором: название выработки и её расход.
          pointerEvents отключены намеренно — иначе плашка попадала бы под
          курсор раньше схемы, и выработку стало бы невозможно выбрать. */}
      {hover && (
        <div
          className="absolute text-[11px] px-2 py-1 rounded shadow-sm"
          style={{
            left: Math.min(hover.x + 14, Math.max(0, p.width - 220)),
            top: Math.max(0, hover.y - 38),
            pointerEvents: "none",
            background: "rgba(255,255,255,0.96)",
            border: "1px solid var(--c-b2, #d1d5db)",
            color: "var(--c-t2, #374151)",
            maxWidth: 220,
          }}
        >
          <div className="font-semibold truncate">{hover.title}</div>
          <div className="text-[10px]" style={{ color: "var(--c-t3, #6b7280)" }}>{hover.note}</div>
        </div>
      )}

      {/* Легенда струй. Цвет стрелки — не оформление, а смысл: по нему на
          схеме отличают свежую струю от исходящей. Без подписи его пришлось бы
          угадывать, поэтому легенда показывается всегда, пока стрелки на
          схеме. */}
      {showArrows && arrowCount > 0 && (
        <div className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded flex flex-col gap-1"
          style={{ background: "rgba(255,255,255,0.92)", border: "1px solid var(--c-b1, #e5e7eb)", color: "var(--c-t3, #6b7280)" }}>
          <div className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#dc2626", display: "inline-block" }} />
            свежая струя
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#2563eb", display: "inline-block" }} />
            исходящая (загазованная)
          </div>
        </div>
      )}

      {/* Счётчик скорости: ради него прототип и делался — видно цену объёма */}
      <div className="absolute bottom-2 left-2 text-[10px] px-2 py-1 rounded"
        style={{ background: "rgba(255,255,255,0.92)", border: "1px solid var(--c-b1, #e5e7eb)", color: "var(--c-t3, #6b7280)" }}>
        выработок: <b>{stats.branches}</b> · вызовов отрисовки: <b>{stats.drawCalls}</b>
        {arrowCount > 0 && <> · стрелок: <b>{arrowCount}</b></>} · {stats.fps} кадр/с
      </div>

      <div className="absolute bottom-2 right-2 text-[10px] px-2 py-1 rounded"
        style={{ background: "rgba(255,255,255,0.92)", border: "1px solid var(--c-b1, #e5e7eb)", color: "var(--c-t3, #6b7280)" }}>
        ЛКМ — поворот, щелчок — выбор выработки · ПКМ — перенос · колесо — приближение
      </div>
    </div>
  );
}