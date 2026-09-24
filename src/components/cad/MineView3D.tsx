// ─────────────────────────────────────────────────────────────────────────────
// MineView3D — режим «Модель»: объёмный вид рудника на three.js.
//
// Отдельный слой поверх рабочей области. Режим «Чертёж» при этом никуда не
// девается и остаётся основным: он векторный, печатается и выгружается в SVG.
// Здесь другая задача — посмотреть схему в объёме, облететь её, показать
// заказчику или комиссии.
//
// УПРАВЛЕНИЕ — ОДНО И ТО ЖЕ С РЕЖИМОМ «ЧЕРТЁЖ» (см. TopoCanvas):
//   • правая кнопка        — вращение вокруг точки интереса;
//   • средняя / Shift+ЛКМ  — перенос (панорама);
//   • левая кнопка         — выбор выработки, перетаскиванием — перенос;
//   • колесо               — приближение К КУРСОРУ;
//   • Shift/Ctrl + колесо  — панорама по горизонтали / вертикали.
//
// Раскладка намеренно повторена буква в букву: два режима одной программы не
// могут требовать от человека разных рук на одно и то же движение.
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
import { buildMineSymbols, type MineSymbols } from "@/lib/three/mineSymbols";
import { buildMineFans, type MineFans } from "@/lib/three/mineFans";
import {
  buildMineMeasureStations, MEASURE_STATION_ID,
  type MineMeasureStations,
} from "@/lib/three/mineMeasureStations";
import { buildMineBulkheads, type MineBulkheads } from "@/lib/three/mineBulkheads";
import { BULKHEAD_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type WaterBranchResult } from "@/lib/waterHydraulics";
import { flowTime } from "@/lib/flowAnim";
import Icon from "@/components/ui/icon";
import { onCanvasFontsReady } from "@/lib/canvasFont";

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
   * Условные обозначения схемы — те же, что на чертеже.
   *
   * В объёме это не украшение: перемычка, дверь, вентилятор и очаг пожара
   * несут половину содержания вентиляционного плана. Показываются ровно теми
   * же значками из общей легенды, чтобы человек читал модель так же, как
   * читает чертёж (см. mineSymbols.ts).
   */
  schemaSymbols?: SchemaSymbol[];
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

  // ── Условные обозначения ──────────────────────────────────────────────
  // Живут отдельным слоем, как и стрелки: значки переставляют куда чаще, чем
  // меняется геометрия выработок, и пересобирать ради одной перемычки всю
  // схему в видеопамяти незачем.
  const symbolsRef = useRef<MineSymbols | null>(null);
  const [showSymbols, setShowSymbols] = useState(true);
  const [symbolCount, setSymbolCount] = useState(0);
  // Размер знаков. На схеме, где рядом стоят ствол и сбойка, единого размера
  // не существует: перемычка вписана в сечение, а вентилятор при этом может
  // оказаться то с ноготь, то во весь экран. Три положения вместо ползунка —
  // промежуточные значения на глаз неразличимы.
  const SYM_SIZES: { key: "s" | "m" | "l"; label: string; value: number }[] = [
    { key: "s", label: "S", value: 0.7 },
    { key: "m", label: "M", value: 1 },
    { key: "l", label: "L", value: 1.5 },
  ];
  const [symSize, setSymSize] = useState<"s" | "m" | "l">("m");
  const symSizeK = SYM_SIZES.find(s => s.key === symSize)?.value ?? 1;

  // ── Объёмные вентиляторы ──────────────────────────────────────────────
  // Единственное обозначение, которому плоской карточки мало. Вентилятор —
  // источник движения воздуха на схеме: по нему читают, откуда идёт струя, в
  // какую сторону подана и работает ли машина. Кружок этого не показывает,
  // объёмная модель с вращающимся колесом — показывает (см. mineFans.ts).
  //
  // Выключатель нужен: на слабой видеокарте и на схеме с полусотней машин
  // вращение требует непрерывной перерисовки, и человек вправе её погасить —
  // вентиляторы тогда вернутся плоскими значками, как все прочие УО.
  const fansRef = useRef<MineFans | null>(null);
  const [showFans3D, setShowFans3D] = useState(true);
  const [fanCount, setFanCount] = useState(0);
  // Есть ли что крутить. В ref — цикл отрисовки не должен зависеть от React.
  const fansSpinRef = useRef(false);
  // Есть ли на схеме вентиляторы вообще: по этому показывается кнопка. Считаем
  // по составу знаков, а не по построенному слою, — иначе выключенный показ
  // прятал бы и собственный выключатель.
  const hasFanSymbols = (p.schemaSymbols ?? []).some(s => s.typeId === "fan" && !!s.branchId);

  // ── Объёмные замерные станции ─────────────────────────────────────────
  // Второе обозначение, которому плоской карточки мало, — и по той же
  // причине, что вентилятору: у знака есть НАПРАВЛЕНИЕ. На чертеже замерная
  // станция это две красные линии ВДОЛЬ выработки, размечающие участок
  // замера. Натянутая на сечение карточка вставала поперёк и читалась как
  // заслонка, хотя станция ничего не перекрывает (см. mineMeasureStations.ts).
  const msRef = useRef<MineMeasureStations | null>(null);
  const [showMs3D, setShowMs3D] = useState(true);
  const [msCount, setMsCount] = useState(0);
  const hasMsSymbols = (p.schemaSymbols ?? [])
    .some(s => s.typeId === MEASURE_STATION_ID && !!s.branchId);

  // ── Объёмные перемычки ────────────────────────────────────────────────
  // Третье обозначение, которому плоской карточки мало. Перемычка — это
  // СООРУЖЕНИЕ в выработке, а не пометка на линии: у неё есть форма сечения и
  // толщина. Прямоугольная карточка у арочной выработки торчала углами сквозь
  // свод, у круглого ствола вылезала за стенки, а при облёте поворачивалась
  // ребром и исчезала — заглушённый участок выглядел открытым. Объёмная плита
  // строится по ТОМУ ЖЕ контуру сечения, что и тело выработки, поэтому всегда
  // вписана в неё (см. mineBulkheads.ts).
  const bkRef = useRef<MineBulkheads | null>(null);
  /** Есть ли в слое паруса, которым надо двигать полотно каждый кадр. */
  const bkSailRef = useRef(false);
  const [showBk3D, setShowBk3D] = useState(true);
  const [bkCount, setBkCount] = useState(0);
  const hasBkSymbols = (p.schemaSymbols ?? [])
    .some(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && !!s.branchId);

  // ── Плотность тела выработки ──────────────────────────────────────────
  // Сплошная заливка хороша для показа, но на реальной схеме ближние выработки
  // наглухо закрывают дальние: видно внешнюю оболочку рудника и ничего внутри.
  // Полупрозрачный режим — то, чем в CAD смотрят такие модели: сквозь стенки
  // читается вся структура, а форма держится на контурных рёбрах.
  //
  // Три положения вместо ползунка: промежуточные значения на глаз почти
  // неразличимы, а лишняя ручка на панели требует объяснения.
  const SOLIDITY: { key: "solid" | "glass" | "ghost"; label: string; value: number; hint: string }[] = [
    { key: "solid", label: "Плотно", value: 1, hint: "Сплошные выработки — как на показе" },
    { key: "glass", label: "Стекло", value: 0.55, hint: "Полупрозрачно: сквозь ближние выработки видны дальние" },
    // «Каркас» ослаблен с 0.22 до 0.12: на плотной схеме даже при 0.22 десяток
    // выработок, наложившихся друг на друга по лучу зрения, складывались в
    // почти непрозрачное пятно — сквозь «каркас» дальние горизонты не
    // читались. Теперь тело — лёгкая подсказка об объёме, а форму держат
    // контурные рёбра.
    { key: "ghost", label: "Каркас", value: 0.12, hint: "Почти прозрачно: видна вся структура рудника" },
  ];
  const [solidity, setSolidity] = useState<"solid" | "glass" | "ghost">("glass");
  const opacity = SOLIDITY.find(s => s.key === solidity)?.value ?? 1;

  // Контурные рёбра сечения. Именно они показывают форму выработки: без них
  // соседние выработки одного цвета сливаются в одно тело.
  const [showEdges, setShowEdges] = useState(true);

  // ── Где вести стрелки воздуха ─────────────────────────────────────────
  // Внутри выработки — нагляднее всего: видно не просто направление, а то, что
  // воздух идёт ПО этой выработке, и стрелки не загромождают пространство
  // между ними. Но смысл в этом есть, только пока тело прозрачное: в сплошном
  // режиме стрелка внутри трубы не видна вовсе. Поэтому переключатель доступен
  // не всегда, а при возврате к «Плотно» стрелки сами выходят наружу.
  const [preferInside, setPreferInside] = useState(true);
  const canInside = opacity < 0.995;
  const arrowsInside = canInside && preferInside;
  // Стрелки бегут — значит кадры нужны непрерывно, а не по событию. Держим это
  // признаком в ref: цикл отрисовки не должен зависеть от перерисовок React.
  const animatingRef = useRef(false);

  const [stats, setStats] = useState({ branches: 0, drawCalls: 0, fps: 0 });
  // Выработка под курсором: её имя показываем в плашке, а саму — подсвечиваем.
  // Держим в состоянии только то, что видно на экране (id и подпись): сама
  // подсветка живёт в сцене и через React не проходит.
  const [hover, setHover] = useState<{
    id: string;
    title: string;
    note: string;
    /**
     * Дополнительные строки плашки. Нужны замерной станции: у неё не одно
     * число, а карточка замера — номер, расход, сечение, скорость.
     */
    lines?: string[];
    /** Замерная станция: плашка получает красную кромку своего знака. */
    accent?: boolean;
    x: number; y: number;
  } | null>(null);
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
  // Замерная станция под курсором — своим признаком: подсветка обоймы живёт в
  // сцене, а не в React, и сверять её нужно на каждое движение мыши.
  const msHoverRef = useRef<string | null>(null);

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
      opacity,
      edges: showEdges,
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
    // opacity и showEdges меняют материал и набор мешей, поэтому требуют
    // пересборки; ракурс при этом сохраняется (см. keep выше).
  }, [ready, p.nodes, p.branches, p.xyScale, p.zScale, opacity, showEdges]);

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
      // Показатели замерных станций — такие же подписи, как у выработок, и
      // включаются той же «Панелью информации». Без этого человек ставил
      // галочку и не находил чисел в объёме: приходилось идти на чертёж.
      symbols: p.schemaSymbols,
    });
    needsRenderRef.current = true;
  }, [p.nodes, p.branches, p.xyScale, p.zScale, p.infoConfig, p.unitsConfig,
      p.waterBranchResults, p.schemaSymbols]);

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
        // Стрелка идёт ВНУТРИ выработки, только когда тело прозрачное: сквозь
        // него её видно, и читается не просто направление, а то, что воздух
        // идёт именно по этой выработке. В сплошном режиме стрелка внутри
        // трубы не видна вообще, поэтому там она по-прежнему снаружи.
        inside: arrowsInside,
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
  }, [ready, showArrows, arrowsInside, p.nodes, p.branches, p.xyScale, p.zScale, p.pollutedBranchIds, p.animSpeed, p.animated]);

  // ── Условные обозначения ──────────────────────────────────────────────
  // Пересобираются при смене схемы, состава значков и их размера. Геометрию
  // выработок это не трогает: значки — свой слой в сцене.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const prev = symbolsRef.current;
    if (prev) {
      scene.remove(prev.group);
      prev.dispose();
      symbolsRef.current = null;
    }
    setSymbolCount(0);

    if (showSymbols && p.schemaSymbols && p.schemaSymbols.length > 0) {
      const built = buildMineSymbols({
        nodes: p.nodes, branches: p.branches,
        symbols: p.schemaSymbols,
        xyScale: p.xyScale, zScale: p.zScale,
        sizeK: symSizeK,
        // Вентилятор показан объёмной машиной — плоский двойник ему не нужен.
        skipFans: showFans3D,
        // Замерная станция показана обоймой вдоль выработки — то же самое.
        skipMeasureStations: showMs3D,
        // Перемычка показана объёмной плитой по сечению — двойник не нужен.
        skipBulkheads: showBk3D,
        // Картинки значков грузятся браузером асинхронно. Режим «Модель»
        // рисует по событию, и без этого сигнала знаки появлялись бы только
        // после первого поворота схемы.
        onReady: () => { needsRenderRef.current = true; },
      });
      if (built) {
        scene.add(built.group);
        symbolsRef.current = built;
        setSymbolCount(built.count);
      }
    }
    needsRenderRef.current = true;

    return () => {
      const s = symbolsRef.current;
      if (!s) return;
      scene.remove(s.group);
      s.dispose();
      symbolsRef.current = null;
    };
  }, [ready, showSymbols, showFans3D, showMs3D, showBk3D, symSizeK, p.schemaSymbols, p.nodes, p.branches, p.xyScale, p.zScale]);

  // ── Объёмные перемычки ────────────────────────────────────────────────
  // Свой слой, как вентиляторы и станции: перемычки переставляют и меняют им
  // материал куда чаще, чем правят геометрию выработок, и пересобирать ради
  // одной двери всю схему в видеопамяти незачем.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const prev = bkRef.current;
    if (prev) {
      scene.remove(prev.group);
      prev.dispose();
      bkRef.current = null;
    }
    setBkCount(0);
    bkSailRef.current = false;

    // Перемычки показываем только вместе с обозначениями: выключив УО, человек
    // просит чистую геометрию — перемычка такое же обозначение, как прочие.
    if (showSymbols && showBk3D && p.schemaSymbols && p.schemaSymbols.length > 0) {
      const built = buildMineBulkheads({
        nodes: p.nodes, branches: p.branches,
        symbols: p.schemaSymbols,
        xyScale: p.xyScale, zScale: p.zScale,
        sizeK: symSizeK,
        animSpeed: p.animSpeed,
      });
      if (built) {
        scene.add(built.group);
        bkRef.current = built;
        setBkCount(built.count);
        // Полотна парусов колышутся, только пока включена общая «Анимация»:
        // выключенная кнопка обязана останавливать всё движение на схеме.
        // Выдув при этом остаётся — он показывает расход, а не движение.
        bkSailRef.current = built.hasSail && p.animated !== false;
        if (!bkSailRef.current) built.setTime(0);
      }
    }
    needsRenderRef.current = true;

    return () => {
      const s = bkRef.current;
      if (!s) return;
      scene.remove(s.group);
      s.dispose();
      bkRef.current = null;
      bkSailRef.current = false;
    };
  }, [ready, showSymbols, showBk3D, symSizeK, p.schemaSymbols, p.nodes, p.branches,
      p.xyScale, p.zScale, p.animSpeed, p.animated]);

  // ── Объёмные замерные станции ─────────────────────────────────────────
  // Свой слой, как вентиляторы: числа станции (расход, сечение) меняются с
  // каждым расчётом, а геометрия выработок при этом та же.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const prev = msRef.current;
    if (prev) {
      scene.remove(prev.group);
      prev.dispose();
      msRef.current = null;
    }
    setMsCount(0);

    // Станции показываем только вместе с обозначениями: выключив УО, человек
    // просит чистую геометрию — замерная станция такое же обозначение.
    if (showSymbols && showMs3D && p.schemaSymbols && p.schemaSymbols.length > 0) {
      const built = buildMineMeasureStations({
        nodes: p.nodes, branches: p.branches,
        symbols: p.schemaSymbols,
        xyScale: p.xyScale, zScale: p.zScale,
        sizeK: symSizeK,
      });
      if (built) {
        scene.add(built.group);
        msRef.current = built;
        setMsCount(built.count);
      }
    }
    needsRenderRef.current = true;

    return () => {
      const s = msRef.current;
      if (!s) return;
      scene.remove(s.group);
      s.dispose();
      msRef.current = null;
    };
  }, [ready, showSymbols, showMs3D, symSizeK, p.schemaSymbols, p.nodes, p.branches,
      p.xyScale, p.zScale]);

  // ── Объёмные вентиляторы ──────────────────────────────────────────────
  // Свой слой, как стрелки и значки: обороты, реверс и остановка меняются в
  // карточке вентилятора куда чаще, чем геометрия выработок, и пересобирать
  // ради них всю схему в видеопамяти незачем.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const prev = fansRef.current;
    if (prev) {
      scene.remove(prev.group);
      prev.dispose();
      fansRef.current = null;
    }
    setFanCount(0);
    fansSpinRef.current = false;

    // Машины показываем только вместе с обозначениями: выключив УО, человек
    // просит чистую геометрию — вентилятор такое же обозначение, как прочие.
    if (showSymbols && showFans3D && p.schemaSymbols && p.schemaSymbols.length > 0) {
      const built = buildMineFans({
        nodes: p.nodes, branches: p.branches,
        symbols: p.schemaSymbols,
        xyScale: p.xyScale, zScale: p.zScale,
        sizeK: symSizeK,
        pollutedBranchIds: p.pollutedBranchIds,
        animSpeed: p.animSpeed,
      });
      if (built) {
        scene.add(built.group);
        fansRef.current = built;
        setFanCount(built.count);
        // Колёса крутим, только пока включена общая кнопка «Анимация»: она
        // одна на оба режима, и выключенная анимация обязана останавливать
        // всё движение на схеме, а не одни стрелки.
        fansSpinRef.current = built.hasSpinning && p.animated !== false;
        if (!fansSpinRef.current) built.setTime(0);
      }
    }
    needsRenderRef.current = true;

    return () => {
      const f = fansRef.current;
      if (!f) return;
      scene.remove(f.group);
      f.dispose();
      fansRef.current = null;
      fansSpinRef.current = false;
    };
  }, [ready, showSymbols, showFans3D, symSizeK, p.schemaSymbols, p.nodes, p.branches,
      p.xyScale, p.zScale, p.pollutedBranchIds, p.animSpeed, p.animated]);

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

      // Колёса вентиляторов. Время то же, что у стрелок, — общие часы схемы:
      // движение воздуха и вращение машины, которая его гонит, обязаны идти в
      // одном отсчёте. Поворот считает процессор, но это десяток объектов на
      // схему, а не десятки тысяч, как у стрелок.
      const fans = fansRef.current;
      if (fansSpinRef.current && fans) {
        fans.setTime(flowTime());
        needsRenderRef.current = true;
      }

      // Полотна парусов. Часы те же, что у стрелок и вентиляторов: ткань ходит
      // от той же струи, которая гонит стрелки, и жить по своему времени она не
      // может. Само колыхание считает видеокарта — здесь одно число на слой.
      const bk = bkRef.current;
      if (bkSailRef.current && bk) {
        bk.setTime(flowTime());
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

        // ПОЛОЖЕНИЕ КАМЕРЫ — ровно то, что даёт проекция чертежа.
        //
        // В чертеже (project3D в lib/topology.ts) поворот на азимут A и подъём E
        // задают экранные оси в мировых координатах:
        //   вправо = ( cosA,        sinA,       0    )
        //   вверх  = (−sinE·sinA,   sinE·cosA,  cosE )
        //   взгляд = ( cosE·sinA,  −cosE·cosA,  sinE ) — от сцены к камере.
        // Мир переводится в three как (x, z, −y) (см. mineScene.ts), поэтому
        // камера встаёт сюда, а «верх» считается ЯВНО по той же формуле.
        const ce = Math.cos(c.el), se = Math.sin(c.el);
        const ca = Math.cos(c.az), sa = Math.sin(c.az);
        cam.position.set(
          c.target.x + d * ce * sa,
          c.target.y + d * se,
          c.target.z + d * ce * ca,
        );
        // Свой «верх» вместо (0,1,0): на плане (подъём 90°) мировая вертикаль
        // совпадает с направлением взгляда, lookAt вырождается и картинка
        // скачком переворачивается. Отсюда же и брался «почти план» 89,98° —
        // он больше не нужен, план теперь ровно 90°, как в чертеже.
        cam.up.set(-se * sa, ce, -se * ca);
        cam.lookAt(c.target);

        // Размер холста видеокарты.
        //
        // ЗДЕСЬ БЫЛО ГЛАВНОЕ РАСХОЖДЕНИЕ ДВУХ СЛОЁВ. Раньше стояло
        // setSize(w, h, false): третий довод «не трогать стили» заставляет
        // three.js выставить холсту ТОЛЬКО атрибуты width/height — а они у
        // него равны w×dpr и h×dpr. Своей ширины в стилях у холста при этом
        // нет, и браузер показывает его в натуральную величину атрибутов,
        // то есть на экране с масштабом 125 % схема растягивалась на 1,25
        // рабочей области, а на 200 % — вдвое. Подписи же считаются от
        // ЛОГИЧЕСКИХ w и h и ложились туда, где выработки были бы без
        // растяжения. Чем дальше от левого верхнего угла, тем больше
        // расхождение, и при повороте схемы подписи уезжали от своих
        // выработок — ровно то, что видно как «индикаторы убегают».
        //
        // Третий довод должен быть true: тогда стили холста равны логическому
        // размеру, картинка видеокарты и слой подписей живут в одной системе
        // координат. Величина попиксельной чёткости (setPixelRatio) при этом
        // сохраняется — за неё отвечают атрибуты, а не стили.
        //
        // Плотность экрана сверяем каждый кадр. Она не постоянна: человек
        // перетаскивает окно на второй монитор или меняет масштаб системы — и
        // холст видеокарты остаётся с прежней плотностью, пока не пересоздашь
        // рендерер. Слой подписей берёт плотность заново (см. ниже), и без
        // этой сверки два слоя опять разъезжаются.
        const dpr = Math.min(window.devicePixelRatio, 2);
        if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);

        renderer.setSize(w, h, true);

        // Знаки, которые должны читаться с любого ракурса (вентиляторы,
        // пожарные и горноспасательные обозначения), разворачиваем лицом к
        // человеку. Только здесь: матрица камеры уже окончательная. Сама
        // функция ничего не делает, если ракурс с прошлого кадра не менялся.
        symbolsRef.current?.updateFacing(cam);

        renderer.render(scene, cam);

        // Подписи — вторым слоем, на обычном холсте поверх картинки
        // видеокарты. Только здесь: матрица камеры уже окончательная, и текст
        // сядет ровно на те места, где нарисованы выработки.
        const lc = labelCanvasRef.current;
        if (lc) {
          if (showLabelsRef.current && labelsRef.current.length > 0) {
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
  // Подписи в объёме рисуются тем же шрифтом, что и на чертеже (Golos Text):
  // когда он догрузится, просим новый кадр — иначе подписи остались бы
  // нарисованы запасным шрифтом.
  useEffect(() => onCanvasFontsReady(() => { needsRenderRef.current = true; }), []);

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
    // Азимут — БЕЗ смены знака. Раньше здесь стоял минус, и объём разворачивался
    // зеркально чертежу: «ИЗО ЮЗ» показывал то, что на чертеже было «ИЗО ЮВ».
    // Камера теперь строится по формулам самого чертежа (см. блок положения
    // камеры выше), а там азимут входит как есть.
    const az = (azDeg * Math.PI) / 180;
    // Угол подъёма: как в чертеже — от вида сбоку (0°) до плана сверху (90°).
    // Полюс больше не вырезаем: «верх» камеры задан явно и на 90° не вырождается.
    const el = Math.max(0, Math.min(Math.PI / 2, (elDeg * Math.PI) / 180));
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

    let mode: "orbit" | "pan" | "select" | null = null;
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
     * Обратный перевод к тому, что делает эффект приёма выше: просто радианы
     * в градусы, знак не трогаем. Благодаря этому оба режима держат один и тот
     * же угол, откуда бы его ни повернули.
     */
    const notifyAngles = () => {
      const c = camRef.current;
      onAnglesRef.current?.(
        (c.az * 180) / Math.PI,
        (c.el * 180) / Math.PI,
      );
    };

    /** Наводит луч на точку курсора. false — сцена ещё не собрана. */
    const aimRay = (e: MouseEvent): boolean => {
      const cam = cameraRef.current;
      if (!cam || !builtRef.current) return false;
      const rect = el.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return false;
      // Экранные координаты → нормализованные [-1..1], как ждёт Raycaster.
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      rayRef.current.setFromCamera(ndc, cam);
      return true;
    };

    /** Что находится под курсором. null — пусто или сцена ещё не собрана. */
    const pickAt = (e: MouseEvent) => {
      if (!aimRay(e)) return null;
      return pickBranch(builtRef.current, rayRef.current);
    };

    /**
     * Замерная станция под курсором.
     *
     * Ищется ОТДЕЛЬНО от выработки и имеет над ней приоритет: обойма станции
     * стоит на стенках своей выработки, и по лучу они всегда рядом. Человек,
     * подводящий курсор к красной обойме, спрашивает про замер, а не про
     * выработку, — иначе объёмную станцию нельзя было бы опросить вовсе.
     */
    const pickMsAt = (e: MouseEvent) => {
      const ms = msRef.current;
      if (!ms) return null;
      if (!aimRay(e)) return null;
      return ms.pick(rayRef.current);
    };

    const onDown = (e: MouseEvent) => {
      // РАСКЛАДКА КНОПОК — та же, что в режиме «Чертёж» (см. TopoCanvas,
      // onMouseDown). Раньше здесь было ровно наоборот: левая вращала, правая
      // переносила. Человек, привыкший крутить схему правой кнопкой на
      // чертеже, в объёме получал перенос — и наоборот. Два режима одной
      // программы не могут требовать разных рук.
      //
      //   ПКМ                  — вращение;
      //   СКМ или Shift+ЛКМ    — перенос (панорама);
      //   ЛКМ                  — выбор выработки (щелчок) и перенос при
      //                          перетаскивании: рамки выделения в объёме нет,
      //                          и оставлять левую кнопку без дела незачем.
      if (e.button === 2) mode = "orbit";
      else if (e.button === 1 || e.shiftKey) mode = "pan";
      else mode = "select";
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
            el.style.cursor = "default";
          }
          if (msHoverRef.current !== null) {
            msHoverRef.current = null;
            if (msRef.current?.setHover(null)) needsRenderRef.current = true;
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

        // ── Замерная станция впереди выработки ──────────────────────────
        // Её обойма стоит НА стенках своей выработки, и по лучу они всегда
        // рядом. Курсор, подведённый к красной обойме, спрашивает про замер:
        // номер станции, расход и сечение — ровно то, ради чего она на схеме.
        const msHit = pickMsAt(e);
        const msId = msHit?.info.id ?? null;
        if (msId !== msHoverRef.current) {
          msHoverRef.current = msId;
          if (msRef.current?.setHover(msId)) needsRenderRef.current = true;
        }
        if (msHit) {
          const info = msHit.info;
          // Подсвечиваем заодно и выработку под станцией: замер относится
          // именно к ней, и видеть её границы в этот момент полезно.
          if (info.branchId !== hoverIdRef.current) {
            hoverIdRef.current = info.branchId;
            if (setHighlight(builtRef.current, selectedRef.current, info.branchId)) {
              needsRenderRef.current = true;
            }
          }
          el.style.cursor = "pointer";
          const lines = [
            `Q = ${info.flow.toFixed(2)} м³/с — расход воздуха`,
            `S = ${info.area.toFixed(2)} м² — сечение`,
            `v = ${info.velocity.toFixed(2)} м/с`,
          ];
          const rect = el.getBoundingClientRect();
          setHover({
            id: info.id,
            title: info.number
              ? `Замерная станция № ${info.number}`
              : "Замерная станция",
            note: info.location || info.branchTitle,
            lines,
            accent: true,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
          return;
        }

        const hit = pickAt(e);
        const id = hit?.branch.id ?? null;
        if (id !== hoverIdRef.current) {
          hoverIdRef.current = id;
          if (setHighlight(builtRef.current, selectedRef.current, id)) needsRenderRef.current = true;
          el.style.cursor = id ? "pointer" : "default";
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
        // Чувствительность и направление — ровно как в «Чертеже»: там
        // 0,5° на пиксель, азимут растёт вправо, подъём УБЫВАЕТ при движении
        // мыши вниз. Здесь стояло 0,008 рад/px (≈0,46°) и подъём с обратным
        // знаком — схема в объёме кренилась не в ту сторону, что на чертеже,
        // и на одно и то же движение руки поворачивалась чуть иначе.
        const RAD_PER_PX = (0.5 * Math.PI) / 180;
        // Азимут РАСТЁТ вправо — как в чертеже (az = start.az + dx·0,5).
        // Здесь стоял минус, и на одно и то же движение руки два режима
        // крутили схему в разные стороны.
        c.az += dx * RAD_PER_PX;
        // Подъём держим в тех же пределах, что чертёж: от вида сбоку (0°) до
        // плана сверху (90°) включительно — на полюсе «верх» камеры задан явно
        // и не вырождается, поэтому обрезать до 89,98° больше не нужно.
        c.el = Math.max(0, Math.min(Math.PI / 2, c.el - dy * RAD_PER_PX));
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
      // Выбор выработки — только по левой кнопке, как на чертеже. Правая
      // (вращение) там открывает контекстное меню и выделение не трогает,
      // средняя переносит вид.
      const wasSelect = mode === "select";
      mode = null;
      if (!wasSelect) return;

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
      const cam = cameraRef.current;

      // Колесо ведёт себя так же, как в «Чертеже» (см. TopoCanvas, нативный
      // wheel-listener): обычное — зум К КУРСОРУ, Shift — панорама по
      // горизонтали, Ctrl — по вертикали. Раньше здесь был ступенчатый зум
      // ×1,12 в центр экрана: выработка, к которой человек тянулся колесом,
      // уползала из-под курсора, и приближаться приходилось в два приёма —
      // покрутил, потом дотащил правой кнопкой.

      // Нормализуем дельту: deltaMode 0=px, 1=строки, 2=страницы.
      const normY = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const normX = e.deltaMode === 1 ? e.deltaX * 18 : e.deltaMode === 2 ? e.deltaX * 400 : e.deltaX;

      // Перенос точки интереса вдоль осей камеры на заданное число ЭКРАННЫХ
      // пикселей — тот же пересчёт, что при переносе правой кнопкой.
      const panScreen = (px: number, py: number) => {
        if (!cam) return;
        const k = (c.zoom * 2) / Math.max(1, sizeRef.current.h);
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
        c.target.addScaledVector(right, px * k);
        c.target.addScaledVector(up, -py * k);
      };

      if (e.shiftKey) {
        // ── ПАНОРАМА ПО ГОРИЗОНТАЛИ ────────────────────────────────────
        panScreen(Math.max(-200, Math.min(200, normY + normX)), 0);
      } else if (e.ctrlKey || e.metaKey) {
        // ── ПАНОРАМА ПО ВЕРТИКАЛИ ──────────────────────────────────────
        panScreen(
          Math.max(-200, Math.min(200, normX)),
          Math.max(-200, Math.min(200, normY)),
        );
      } else {
        // ── ЗУМ К КУРСОРУ ──────────────────────────────────────────────
        // Шаг — тот же, что на чертеже: доля от текущего масштаба, поэтому
        // приближение ощущается одинаково и на общем плане, и вблизи забоя.
        const capped = Math.max(-150, Math.min(150, normY));
        const factor = Math.pow(0.998, capped);
        const prev = c.zoom;
        const next = Math.max(1, Math.min(200000, prev / factor));
        if (next === prev) return;
        c.zoom = next;

        // Держим точку под курсором на месте. У ортокамеры мир на экране
        // масштабируется от ЦЕНТРА кадра, значит центр надо отодвинуть к
        // курсору ровно на ту долю, на которую изменился масштаб.
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          // Смещение курсора от центра холста, в пикселях.
          const offX = e.clientX - rect.left - rect.width / 2;
          const offY = e.clientY - rect.top - rect.height / 2;
          // При зуме (prev → next) мировая точка под курсором уезжает; k —
          // насколько сдвинуть центр, чтобы она вернулась под курсор.
          const k = 1 - next / prev;
          const kw = (prev * 2) / Math.max(1, sizeRef.current.h);
          if (cam) {
            const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
            const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
            c.target.addScaledVector(right, offX * kw * k);
            c.target.addScaledVector(up, -offY * kw * k);
          }
        }
      }
      needsRenderRef.current = true;
    };

    const onCtx = (e: MouseEvent) => e.preventDefault();

    // Курсор ушёл с холста совсем (в панель, за окно) — гасим подсветку.
    // Движений мыши сюда больше не придёт, и без этого выработка осталась бы
    // подсвеченной, хотя курсор давно в другом месте.
    const onLeave = () => {
      if (msHoverRef.current !== null) {
        msHoverRef.current = null;
        if (msRef.current?.setHover(null)) needsRenderRef.current = true;
      }
      if (hoverIdRef.current === null) return;
      hoverIdRef.current = null;
      if (setHighlight(builtRef.current, selectedRef.current, null)) needsRenderRef.current = true;
      el.style.cursor = "default";
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
    p.onViewAngles?.((az * 180) / Math.PI, (el * 180) / Math.PI);
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
      <div ref={hostRef} style={{ width: p.width, height: p.height, cursor: "default" }} />

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

      {/* Панель управления видом. Два ряда в ОДНОЙ колонке, а не двумя
          абсолютными блоками: верхний ряд переносится по ширине, и при узкой
          рабочей области второй ряд, стоящий на фиксированном отступе, залез
          бы прямо на кнопки ракурсов. */}
      <div className="absolute top-2 left-2 flex flex-col gap-1" style={{ maxWidth: 320 }}>
      {/* Кнопки стандартных ракурсов — те же, что в режиме «Чертёж» */}
      <div className="flex gap-1 flex-wrap">
        {/* Углы взяты из VIEW_PRESETS (lib/topology.ts) — тех же, по которым
            работают кнопки ракурсов на чертеже, и в тех же градусах.
            «Профиль» там left = −90°, а не +90°: со знаком плюс объём
            показывал схему с противоположного борта. */}
        {([
          ["План", 0, 90],
          ["Фронт", 0, 0],
          ["Профиль", -90, 0],
          ["ИЗО ЮЗ", -45, 30],
          ["ИЗО ЮВ", 45, 30],
        ] as [string, number, number][]).map(([label, azDeg, elDeg]) => {
          const az = (azDeg * Math.PI) / 180;
          const el = (elDeg * Math.PI) / 180;
          // Подсветка текущего ракурса — как у кнопок вида на чертеже
          // (ViewBtn в cadComponents.tsx): допуск в градус, тот же лиловый.
          const active =
            p.viewAzimuth !== undefined && p.viewElevation !== undefined &&
            Math.abs(p.viewAzimuth - azDeg) < 1 && Math.abs(p.viewElevation - elDeg) < 1;
          return (
          <button key={label} onClick={() => setView(az, el)}
            className="text-[11px] px-2 py-1 rounded border hover:bg-white"
            style={{
              borderColor: active ? "#5b21b6" : "var(--c-b2, #d1d5db)",
              color: active ? "white" : "var(--c-t2, #374151)",
              background: active ? "var(--c-purple, #7c3aed)" : "rgba(255,255,255,0.9)",
            }}>
            {label}
          </button>
          );
        })}

        {/* Подписи нужны не всегда: при разборе геометрии текст мешает, при
            разговоре о расходах — наоборот, главное на экране. Поэтому
            выключатель стоит рядом с ракурсами, а не прячется в настройках. */}
        <button
          onClick={() => setShowLabels(v => !v)}
          title={showLabels ? "Скрыть подписи выработок" : "Показать подписи выработок"}
          className="text-[11px] px-2 py-1 rounded border hover:bg-white"
          style={{
            borderColor: showLabels ? "#1e5a7a" : "var(--c-b2, #d1d5db)",
            color: showLabels ? "#1e5a7a" : "var(--c-t2, #374151)",
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

        {/* Условные обозначения. Перемычки и двери стоят поперёк выработки,
            вентиляторы и пожарные знаки повёрнуты лицом к человеку — см.
            mineSymbols.ts. Выключатель нужен: при разборе геометрии знаки
            загораживают сечения, а при показе схемы они — главное.

            Кнопка показывается ТОЛЬКО когда знаков на схеме нет: иначе ими
            управляет группа «УО» во втором ряду, где рядом лежит и размер.
            Два переключателя одного и того же — верный способ получить
            «нажал, а не выключилось»: человек жмёт один, а погашено уже
            другим. */}
        {(p.schemaSymbols?.length ?? 0) === 0 && symbolCount === 0 && (
          <button
            onClick={() => setShowSymbols(v => !v)}
            title={showSymbols
              ? "Скрыть условные обозначения (перемычки, двери, вентиляторы, знаки)"
              : "Показать условные обозначения схемы"}
            className="text-[11px] px-2 py-1 rounded border hover:bg-white"
            style={{
              borderColor: showSymbols ? "#7c3aed" : "var(--c-b2, #d1d5db)",
              color: showSymbols ? "#7c3aed" : "var(--c-t2, #374151)",
              background: showSymbols ? "rgba(237,233,254,0.9)" : "rgba(255,255,255,0.9)",
            }}
          >
            Обозначения
          </button>
        )}
      </div>

      {/* Плотность и контур — вторым рядом, отдельно от ракурсов: это не
          «куда смотрим», а «как показана сама выработка». */}
      <div className="flex gap-1 items-center flex-wrap">
        <div className="flex rounded border overflow-hidden" style={{ borderColor: "var(--c-b2, #d1d5db)" }}>
          {SOLIDITY.map(s => (
            <button
              key={s.key}
              onClick={() => setSolidity(s.key)}
              title={s.hint}
              className="text-[11px] px-2 py-1 hover:bg-white"
              style={{
                background: solidity === s.key ? "rgba(219,234,254,0.95)" : "rgba(255,255,255,0.9)",
                color: solidity === s.key ? "#1e5a7a" : "var(--c-t2, #374151)",
                fontWeight: solidity === s.key ? 600 : 400,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowEdges(v => !v)}
          title={
            showEdges
              ? "Скрыть контур сечения выработок"
              : "Показать контур сечения: по нему видна форма выработки и её границы"
          }
          className="text-[11px] px-2 py-1 rounded border hover:bg-white"
          style={{
            borderColor: showEdges ? "#0f766e" : "var(--c-b2, #d1d5db)",
            color: showEdges ? "#0f766e" : "var(--c-t2, #374151)",
            background: showEdges ? "rgba(204,251,241,0.9)" : "rgba(255,255,255,0.9)",
          }}
        >
          Контур
        </button>

        {/* Стрелки внутри выработок. Доступно только на прозрачном теле:
            в сплошном режиме стрелка внутри трубы не видна, и кнопка,
            которая ничего не меняет, вводила бы в заблуждение. */}
        {showArrows && (
          <button
            onClick={() => canInside && setPreferInside(v => !v)}
            disabled={!canInside}
            title={
              !canInside
                ? "Стрелки внутри выработок видны только на прозрачном теле — выберите «Стекло» или «Каркас»"
                : arrowsInside
                  ? "Стрелки идут внутри выработок. Нажмите, чтобы вынести их наружу"
                  : "Вести стрелки внутри выработок, по их оси"
            }
            className="text-[11px] px-2 py-1 rounded border"
            style={{
              borderColor: arrowsInside ? "#b45309" : "var(--c-b2, #d1d5db)",
              color: !canInside
                ? "var(--c-t3, #9ca3af)"
                : arrowsInside ? "#b45309" : "var(--c-t2, #374151)",
              background: arrowsInside ? "rgba(254,243,199,0.9)" : "rgba(255,255,255,0.9)",
              cursor: canInside ? "pointer" : "not-allowed",
              opacity: canInside ? 1 : 0.55,
            }}
          >
            Поток внутри
          </button>
        )}

        {/* Условные обозначения: выключатель и размер знаков.

            Слово «УО» здесь — не подпись, а кнопка: знаки в объёме гасят и
            зажигают чаще всего именно отсюда, разбирая геометрию под ними, и
            искать ради этого другой конец панели незачем. Группа не исчезает,
            когда знаки погашены, — иначе выключатель пропадал бы вместе с тем,
            что выключил, и вернуть УО было бы нечем.

            Размер: перемычка всегда вписана в сечение своей выработки, а вот
            отдельно стоящие знаки на схеме со стволами и сбойками одного
            размера быть не могут — эта ручка и подгоняет их под схему. Пока
            знаки погашены, размер недоступен: менять нечего. */}
        {(symbolCount > 0 || (p.schemaSymbols?.length ?? 0) > 0) && (
          <div className="flex rounded border overflow-hidden items-center"
            style={{ borderColor: showSymbols ? "#7c3aed" : "var(--c-b2, #d1d5db)" }}>
            <button
              onClick={() => setShowSymbols(v => !v)}
              title={showSymbols
                ? "Скрыть условные обозначения в объёме"
                : "Показать условные обозначения в объёме"}
              className="text-[10px] px-1.5 py-1 hover:bg-white"
              style={{
                background: showSymbols ? "rgba(237,233,254,0.95)" : "rgba(255,255,255,0.9)",
                color: showSymbols ? "#7c3aed" : "var(--c-t3, #9ca3af)",
                fontWeight: showSymbols ? 600 : 400,
              }}
            >
              УО
            </button>
            {SYM_SIZES.map(s => (
              <button
                key={s.key}
                onClick={() => showSymbols && setSymSize(s.key)}
                disabled={!showSymbols}
                title={showSymbols ? `Размер условных обозначений: ${s.label}` : "Знаки погашены — включите УО"}
                className="text-[11px] px-2 py-1 hover:bg-white"
                style={{
                  background: showSymbols && symSize === s.key ? "rgba(237,233,254,0.95)" : "rgba(255,255,255,0.9)",
                  color: !showSymbols
                    ? "var(--c-t3, #9ca3af)"
                    : symSize === s.key ? "#7c3aed" : "var(--c-t2, #374151)",
                  fontWeight: showSymbols && symSize === s.key ? 600 : 400,
                  cursor: showSymbols ? "pointer" : "not-allowed",
                  opacity: showSymbols ? 1 : 0.55,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Объёмные перемычки.

            Кнопка появляется, только когда на схеме есть перемычка или дверь.

            Зачем выключатель. Плита по сечению — правильное чтение знака: она
            вписана в выработку и видна с любого ракурса. Но на схеме, где
            перемычек сотни и они стоят вплотную, сплошные плиты закрывают
            геометрию за собой. Погасив их, человек получает перемычки плоским
            значком, как на чертеже. */}
        {hasBkSymbols && (
          <button
            onClick={() => showSymbols && setShowBk3D(v => !v)}
            disabled={!showSymbols}
            title={!showSymbols
              ? "Знаки погашены — включите УО"
              : showBk3D
                ? "Перемычки объёмом: плита по контуру сечения выработки, цвет — материал, толщина — тип сооружения"
                : "Перемычки плоским значком, как на чертеже"}
            className="text-[10px] px-2 py-1 rounded border hover:bg-white"
            style={{
              borderColor: showSymbols && showBk3D ? "#16a34a" : "var(--c-b2, #d1d5db)",
              color: !showSymbols
                ? "var(--c-t3, #9ca3af)"
                : showBk3D ? "#16a34a" : "var(--c-t2, #374151)",
              background: showSymbols && showBk3D ? "rgba(220,252,231,0.95)" : "rgba(255,255,255,0.9)",
              fontWeight: showSymbols && showBk3D ? 600 : 400,
              cursor: showSymbols ? "pointer" : "not-allowed",
              opacity: showSymbols ? 1 : 0.55,
            }}
          >
            Перемычка 3D
          </button>
        )}

        {/* Объёмные вентиляторы.

            Кнопка появляется, только когда на схеме есть вентилятор: на схеме
            без машин она была бы выключателем в никуда.

            Зачем выключатель вообще. Вращение требует непрерывной
            перерисовки — на слабой видеокарте это заметно. Погасив её,
            человек получает вентиляторы обычными плоскими значками, как на
            чертеже, и схема снова рисуется только по событию. */}
        {hasFanSymbols && (
          <button
            onClick={() => showSymbols && setShowFans3D(v => !v)}
            disabled={!showSymbols}
            title={!showSymbols
              ? "Знаки погашены — включите УО"
              : showFans3D
                ? "Вентиляторы объёмной моделью: вращение показывает работу машины и направление подачи"
                : "Вентиляторы плоским значком, как на чертеже"}
            className="text-[10px] px-2 py-1 rounded border hover:bg-white"
            style={{
              borderColor: showSymbols && showFans3D ? "#0891b2" : "var(--c-b2, #d1d5db)",
              color: !showSymbols
                ? "var(--c-t3, #9ca3af)"
                : showFans3D ? "#0891b2" : "var(--c-t2, #374151)",
              background: showSymbols && showFans3D ? "rgba(207,250,254,0.95)" : "rgba(255,255,255,0.9)",
              fontWeight: showSymbols && showFans3D ? 600 : 400,
              cursor: showSymbols ? "pointer" : "not-allowed",
              opacity: showSymbols ? 1 : 0.55,
            }}
          >
            Вентилятор 3D
          </button>
        )}

        {/* Объёмные замерные станции.

            Кнопка появляется, только когда на схеме есть замерная станция.

            Зачем выключатель. Две линии внутри выработки — правильное чтение
            знака, но на схеме, где станции стоят вплотную, красные прогоны
            могут мешать разбирать геометрию. Погасив их, человек получает
            станции плоским значком, как на чертеже. */}
        {hasMsSymbols && (
          <button
            onClick={() => showSymbols && setShowMs3D(v => !v)}
            disabled={!showSymbols}
            title={!showSymbols
              ? "Знаки погашены — включите УО"
              : showMs3D
                ? "Замерная станция объёмом: две линии ВДОЛЬ выработки, внутри неё, размечают участок замера. Наведите курсор — номер, расход и сечение"
                : "Замерная станция плоским значком, как на чертеже"}
            className="text-[10px] px-2 py-1 rounded border hover:bg-white"
            style={{
              borderColor: showSymbols && showMs3D ? "#dc2626" : "var(--c-b2, #d1d5db)",
              color: !showSymbols
                ? "var(--c-t3, #9ca3af)"
                : showMs3D ? "#dc2626" : "var(--c-t2, #374151)",
              background: showSymbols && showMs3D ? "rgba(254,226,226,0.95)" : "rgba(255,255,255,0.9)",
              fontWeight: showSymbols && showMs3D ? 600 : 400,
              cursor: showSymbols ? "pointer" : "not-allowed",
              opacity: showSymbols ? 1 : 0.55,
            }}
          >
            Замерная станция 3D
          </button>
        )}
      </div>
      </div>

      {/* Подсказка под курсором: название выработки и её расход.
          pointerEvents отключены намеренно — иначе плашка попадала бы под
          курсор раньше схемы, и выработку стало бы невозможно выбрать. */}
      {hover && (
        <div
          className="absolute text-[11px] px-2 py-1 rounded shadow-sm"
          style={{
            left: Math.min(hover.x + 14, Math.max(0, p.width - 250)),
            top: Math.max(0, hover.y - (hover.lines ? 74 : 38)),
            pointerEvents: "none",
            background: "rgba(255,255,255,0.97)",
            // Карточка замерной станции получает красную кромку своего знака:
            // сразу видно, что подсказка про ЗАМЕР, а не про выработку.
            border: hover.accent
              ? "1px solid #dc2626"
              : "1px solid var(--c-b2, #d1d5db)",
            borderLeft: hover.accent ? "3px solid #dc2626" : undefined,
            color: "var(--c-t2, #374151)",
            maxWidth: 250,
          }}
        >
          <div
            className="font-semibold truncate"
            style={hover.accent ? { color: "#dc2626" } : undefined}
          >
            {hover.title}
          </div>
          <div className="text-[10px]" style={{ color: "var(--c-t3, #6b7280)" }}>{hover.note}</div>
          {hover.lines && hover.lines.length > 0 && (
            <div className="mt-1 pt-1 flex flex-col gap-0.5"
              style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)" }}>
              {hover.lines.map(l => (
                <div key={l} className="text-[10px] tabular-nums">{l}</div>
              ))}
            </div>
          )}
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
        {arrowCount > 0 && <> · стрелок: <b>{arrowCount}</b></>}
        {symbolCount > 0 && <> · обозначений: <b>{symbolCount}</b></>}
        {bkCount > 0 && <> · перемычек: <b>{bkCount}</b></>}
        {fanCount > 0 && <> · вентиляторов: <b>{fanCount}</b></>}
        {msCount > 0 && <> · замерных станций: <b>{msCount}</b></>} · {stats.fps} кадр/с
      </div>

      <div className="absolute bottom-2 right-2 text-[10px] px-2 py-1 rounded"
        style={{ background: "rgba(255,255,255,0.92)", border: "1px solid var(--c-b1, #e5e7eb)", color: "var(--c-t3, #6b7280)" }}>
        ЛКМ — выбор выработки · ПКМ — поворот · СКМ либо Shift+ЛКМ — перенос · колесо — приближение
      </div>
    </div>
  );
}