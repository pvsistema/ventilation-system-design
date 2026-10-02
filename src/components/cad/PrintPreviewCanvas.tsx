// Рендер схемы в canvas для предпросмотра печати.
// Получает viewState из рабочей области и масштабирует его под размер превью.
// SVG слоя печати рисуется поверх — координаты вычисляются из projNodes текущего view.
import { useEffect, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from "react";
import { maxSidePx, maxAreaPx } from "@/lib/canvasLimits";
import {
  type TopoNode, type TopoBranch, type Horizon, type ProjOptions,
  project3D,
} from "@/lib/topology";
import { renderCanvas, computeObjSF, type ProjNode, type FlowDisplayMode } from "@/lib/canvasRenderer";
import { makeSymbolSizing } from "@/lib/symbolSizing";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type SchemaSymbol } from "@/pages/Cad";
import { type Position } from "@/lib/positions";
import { type TextBlock } from "@/pages/cad/cadTypes";
import SchemaSymbolsOverlay from "./SchemaSymbolsOverlay";
import { computeFrameRect } from "./printPreview/computeFrameRect";
import PrintPositionsOverlay from "./printPreview/PrintPositionsOverlay";
import PrintInspectionOverlay from "./printPreview/PrintInspectionOverlay";
import { type InspectionLabel, type RouteLegendItem } from "@/lib/inspectionRoutes";
import PrintTextBlocksOverlay from "./printPreview/PrintTextBlocksOverlay";
import PrintLayerOverlay from "./printPreview/PrintLayerOverlay";

export interface PrintPreviewCanvasHandle {
  getFitView(): { scale: number; offsetX: number; offsetY: number } | null;
  toDataURL(): string;
}

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  schemaSymbols?: SchemaSymbol[];
  // viewState из рабочей области — что сейчас видно на экране
  viewState: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  // Размер рабочего canvas в px (для пересчёта масштаба)
  canvasSize: { w: number; h: number };
  zScale?: number;
  is3D?: boolean;
  width: number;
  height: number;
  branchWidth?: number;
  branchBorder?: number;
  thinLines?: boolean;
  colorByHorizon?: boolean;
  showFlowArrows?: boolean;
  flowDisplay?: FlowDisplayMode;
  textBlocks?: TextBlock[];
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig?: UnitsConfig;
  colorMode?: "none" | "flowQ" | "velocityV" | "section" | "ventsection";
  sectionColors?: Map<string, string>;
  posInnerColors?: Map<string, string>;
  posOuterColors?: Map<string, string>;
  positions?: Position[];
  showPositions?: boolean;
  /** Таблички маршрутов МПО */
  inspectionLabels?: InspectionLabel[];
  /** Строки блока маршрутов МПО на листе */
  routeLegendItems?: RouteLegendItem[];
  fixedObjectScale?: boolean;
  /** Ширина ветви по площади сечения — предпросмотр должен совпадать с экраном. */
  widthBySection?: boolean;
  /** Диапазон масштаба позиций ПЛА в % при фиксированном масштабе */
  scalePositionMin?: number;
  scalePositionMax?: number;
  /** Глобальный ГОСТ-диаметр маркера позиции, мм (эталон 13) */
  positionGostMm?: number;
  xyScale?: number;
  /** Размер перемычек/замерных станций, % от ширины ветви (как в рабочей области). */
  bulkheadScale?: number;
  /** Размер вентиляторов/насосов/вентилей, % от ширины ветви. */
  fanScale?: number;
  /** Множитель супер-сэмплинга canvas (обычно = зум предпросмотра),
   *  чтобы схема оставалась чёткой при CSS transform: scale(). */
  superSample?: number;
  /** Готовая проекция конкретного тайла (листа) в координатах предпросмотра.
   *  Если передана — компонент использует её напрямую вместо своего fit-to-screen.
   *  Нужна для многолистовой печати БЕЗ слоя печати: каждый лист показывает
   *  свою часть единой схемы (offset смещён на col*pageW / row*pageH). */
  tileView?: { scale: number; offsetX: number; offsetY: number };
  /** Видимая на экране часть листа в его собственных координатах (px предпросмотра).
   *  При сильном приближении по ней рисуется «детальный» слой в полном разрешении. */
  visibleRect?: { x: number; y: number; w: number; h: number };
}

/** Потолок масштаба базового холста (весь лист целиком). */
const BASE_MAX_SCALE = 4;
/** Задержка перерисовки детального слоя после остановки зума/прокрутки, мс. */
const DETAIL_DEBOUNCE_MS = 140;
/** Запас детального слоя вокруг видимой области (доля её размера с каждой стороны). */
const DETAIL_MARGIN = 0.35;

const PrintPreviewCanvas = forwardRef<PrintPreviewCanvasHandle, Props>(function PrintPreviewCanvas({
  nodes, branches, horizons,
  schemaSymbols = [],
  viewState,
  canvasSize,
  zScale = 1, is3D = false,
  width, height,
  branchWidth = 2, branchBorder = 0.4,
  thinLines = false, colorByHorizon = false,
  showFlowArrows = false,
  flowDisplay = "off",
  textBlocks = [],
  infoConfig = null,
  unitsConfig = DEFAULT_UNITS_CONFIG,
  colorMode = "none",
  sectionColors,
  posInnerColors,
  posOuterColors,
  positions = [],
  showPositions = true,
  inspectionLabels = [],
  routeLegendItems,
  fixedObjectScale = false,
  widthBySection = false,
  scalePositionMin = 80,
  scalePositionMax = 150,
  positionGostMm = 13,
  xyScale,
  bulkheadScale = 150,
  fanScale = 450,
  superSample = 1,
  tileView,
  visibleRect,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null);
  /** Масштаб, с которым нарисован базовый холст. */
  const baseScaleRef = useRef(1);
  /** Версия содержимого: растёт при каждой перерисовке базового холста. */
  const contentVerRef = useRef(0);
  /** Что сейчас нарисовано в детальном слое. */
  const detailStateRef = useRef<{ ver: number; scale: number; x: number; y: number; w: number; h: number } | null>(null);

  const { azimuth, elevation } = viewState;

  const horizonMap = useMemo(() => {
    const m = new Map<string, Horizon>();
    horizons.forEach(h => m.set(h.id, h));
    return m;
  }, [horizons]);

  const visibleBranches = useMemo(
    () => branches.filter(b => {
      if (!b.horizonId) return true;
      const h = horizonMap.get(b.horizonId);
      return !h || h.visible;
    }),
    [branches, horizonMap],
  );

  // Активные слои печати (все горизонты с включённым слоем)
  const activePrintLayers = useMemo(
    () => horizons.filter(h => h.printLayer?.visible),
    [horizons],
  );
  const hasPrintLayer = activePrintLayers.length > 0;

  // Пересчитываем viewState рабочей области под размер превью.
  // Всегда делаем fit-to-screen по узлам — так схема всегда отображается по центру превью
  // в том же ракурсе (azimuth/elevation) что и рабочая область.
  const activeView = useMemo((): ProjOptions & { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number } => {
    if (width <= 0 || height <= 0) {
      return { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    }

    // Готовая проекция тайла (многолистовая печать без слоя печати): используем
    // напрямую, чтобы каждый лист показывал СВОЮ часть единой схемы, а не всю схему.
    if (tileView) {
      return {
        scale: tileView.scale,
        offsetX: tileView.offsetX,
        offsetY: tileView.offsetY,
        azimuth, elevation, zScale,
      };
    }

    const _xySF0 = xyScale ?? 1;

    // ── Если есть слой печати: вписываем рамку ────────────────────────────
    if (hasPrintLayer) {
      // Шаг 1: масштабируем viewState под размер превью
      const cw = canvasSize.w > 0 ? canvasSize.w : width;
      const ch = canvasSize.h > 0 ? canvasSize.h : height;
      const k = Math.min(width / cw, height / ch);
      const sc0 = viewState.scale * k;
      const ox0 = viewState.offsetX * k + (width - cw * k) / 2;
      const oy0 = viewState.offsetY * k + (height - ch * k) / 2;

      const proj0: ProjOptions = { scale: sc0, offsetX: ox0, offsetY: oy0, azimuth, elevation, zScale };
      const pNodes0: ProjNode[] = nodes.map(n => ({
        node: n,
        ...project3D({ x: n.x * _xySF0, y: n.y * _xySF0, z: n.z * zScale }, proj0),
        depth: 0,
      }));
      const plHorizon = activePrintLayers[0];
      const pl = plHorizon.printLayer!;
      const rect = computeFrameRect(pl, pNodes0, visibleBranches, proj0, _xySF0, plHorizon.z ?? 0);

      if (!rect || rect.rw <= 0 || rect.rh <= 0) {
        return { scale: sc0, offsetX: ox0, offsetY: oy0, azimuth, elevation, zScale };
      }
      const fitS = Math.min(width / rect.rw, height / rect.rh);
      return {
        scale: sc0 * fitS,
        offsetX: (ox0 - rect.rx) * fitS,
        offsetY: (oy0 - rect.ry) * fitS,
        azimuth, elevation, zScale,
      };
    }

    // ── Без слоя печати: fit-to-screen по bbox узлов ──────────────────────
    // Проецируем с scale=1, offset=0 чтобы получить bbox в нормальных координатах
    if (nodes.length === 0) {
      return { scale: 1, offsetX: width / 2, offsetY: height / 2, azimuth, elevation, zScale };
    }
    const proj1: ProjOptions = { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
    for (const n of nodes) {
      const p = project3D({ x: n.x * _xySF0, y: n.y * _xySF0, z: n.z * zScale }, proj1);
      if (p.sx < minSx) minSx = p.sx; if (p.sx > maxSx) maxSx = p.sx;
      if (p.sy < minSy) minSy = p.sy; if (p.sy > maxSy) maxSy = p.sy;
    }
    const bw = Math.max(1, maxSx - minSx);
    const bh = Math.max(1, maxSy - minSy);
    const pad = 0.08;
    const fitSc = Math.min((width * (1 - pad * 2)) / bw, (height * (1 - pad * 2)) / bh);
    const cx = (minSx + maxSx) / 2;
    const cy = (minSy + maxSy) / 2;
    return {
      scale: fitSc,
      offsetX: width / 2 - cx * fitSc,
      offsetY: height / 2 - cy * fitSc,
      azimuth, elevation, zScale,
    };
  }, [viewState, canvasSize, width, height, azimuth, elevation, zScale,
      hasPrintLayer, activePrintLayers, nodes, visibleBranches, xyScale, tileView]);

  const proj = useMemo<ProjOptions>(() => activeView, [activeView]);

  // ── Проекция узлов ─────────────────────────────────────────────────────────
  // Проецирование — самая тяжёлая операция предпросмотра: синусы, косинусы и
  // повороты для каждого узла схемы. На большом руднике это тысячи узлов, а
  // листов больше сотни, и раньше всё пересчитывалось заново для КАЖДОГО листа
  // и при каждом сдвиге схемы мышью.
  //
  // Ключевое наблюдение: повороты зависят ТОЛЬКО от ракурса (азимут, наклон,
  // вертикальный масштаб), а масштаб и смещение листа входят в результат
  // линейно. Поэтому «повёрнутые» координаты считаем ОДИН раз и потом дёшево
  // пересчитываем под каждый лист обычным умножением и сложением.
  const baseProjected = useMemo(() => {
    const _xySFN = xyScale ?? 1;
    const unit: ProjOptions = { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    return nodes.map(n => project3D({ x: n.x * _xySFN, y: n.y * _xySFN, z: n.z * zScale }, unit));
  }, [nodes, azimuth, elevation, zScale, xyScale]);

  const projNodes = useMemo<ProjNode[]>(() => {
    const { scale, offsetX, offsetY } = proj;
    return nodes.map((n, i) => {
      const b = baseProjected[i];
      return {
        node: n,
        sx: offsetX + b.sx * scale,
        sy: offsetY + b.sy * scale,
        // depth здесь всегда 0 — ровно как было раньше: порядок отрисовки в
        // печати задаётся сортировкой по горизонтам, а не по глубине.
        depth: 0,
      } as ProjNode;
    });
  }, [nodes, baseProjected, proj]);

  const projNodesMap = useMemo(() => {
    const m = new Map<string, ProjNode>();
    projNodes.forEach(p => m.set(p.node.id, p));
    return m;
  }, [projNodes]);

  // Отрисовка схемы листа в уже подготовленный контекст (трансформация задана
  // вызывающим). Общая для базового холста и детального слоя.
  const drawSchema = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    try {
      renderCanvas({
        ctx, width, height,
        nodes, branches, horizons, horizonMap,
        visibleBranches, hiddenBranchIds: new Set(),
        projNodes, projNodesMap, proj,
        view: activeView,
        is3D, zScale, zLevel: 0,
        selectedBranchId: null, selectedBranchIds: new Set(),
        selectedNodeId: null, selectedNodeIds: new Set(),
        hoverBranchId: null,
        branchWidth, branchBorder,
        thinLines, colorByHorizon,
        showFlowArrows, flowDisplay,
        animOffset: 0, infoConfig, unitsConfig,
        colorMode, sectionColors, posInnerColors, posOuterColors,
        printMode: true,
        fixedObjectScale,
        widthBySection,
        xyScale,
      });
    } catch (err) {
      console.error("PrintPreviewCanvas renderCanvas error:", err);
    }
  }, [nodes, branches, horizons, horizonMap, visibleBranches,
      projNodes, projNodesMap, proj, activeView,
      is3D, zScale, width, height,
      branchWidth, branchBorder, thinLines, colorByHorizon,
      showFlowArrows, flowDisplay, infoConfig, unitsConfig,
      colorMode, sectionColors, posInnerColors, posOuterColors,
      fixedObjectScale, widthBySection, xyScale]);

  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
  // Нужный масштаб растра = зум предпросмотра × плотность пикселей экрана.
  // Квантуем по степеням √2: мелкие шаги колеса не пересоздают холст.
  const wantScale = (() => {
    const raw = Math.max(1, dpr * Math.max(1, superSample));
    return Math.pow(Math.SQRT2, Math.ceil(Math.log(raw) / Math.log(Math.SQRT2) - 1e-6));
  })();
  const baseScale = Math.min(wantScale, BASE_MAX_SCALE);

  // ── Базовый холст: весь лист, масштаб не выше BASE_MAX_SCALE ──────────────
  // Он всегда покрывает лист целиком, поэтому при прокрутке нет пустот.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = Math.round(width  * baseScale);
    canvas.height = Math.round(height * baseScale);
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(baseScale, 0, 0, baseScale, 0, 0);
    drawSchema(ctx);
    baseScaleRef.current = baseScale;
    contentVerRef.current++;
  }, [drawSchema, width, height, baseScale]);

  // ── Детальный слой: только видимая часть листа в полном разрешении ────────
  // Когда зум больше, чем может дать базовый холст (иначе растр растягивается
  // браузером и «мылится»), дорисовываем поверх видимый фрагмент с масштабом
  // dpr × зум. Размер фрагмента ограничен экраном, поэтому память не растёт
  // с увеличением зума и пределы браузера не нарушаются.
  const needDetail = wantScale > baseScale + 1e-6 && !!visibleRect
    && visibleRect.w > 0 && visibleRect.h > 0;
  const vrX = visibleRect?.x ?? 0, vrY = visibleRect?.y ?? 0;
  const vrW = visibleRect?.w ?? 0, vrH = visibleRect?.h ?? 0;

  useEffect(() => {
    const dc = detailRef.current;
    if (!dc) return;
    if (!needDetail) {
      if (detailStateRef.current) {
        dc.width = 0; dc.height = 0; dc.style.display = "none";
        detailStateRef.current = null;
      }
      return;
    }
    const cur = detailStateRef.current;
    // Схема изменилась — старый фрагмент показывает устаревшее содержимое,
    // прячем его сразу (базовый холст уже перерисован).
    if (cur && cur.ver !== contentVerRef.current) {
      dc.style.display = "none";
    }
    // Уже нарисованный фрагмент с тем же масштабом целиком покрывает видимую
    // область — перерисовка не нужна (обычная прокрутка внутри запаса).
    if (cur && cur.ver === contentVerRef.current && cur.scale === wantScale
      && vrX >= cur.x - 0.5 && vrY >= cur.y - 0.5
      && vrX + vrW <= cur.x + cur.w + 0.5 && vrY + vrH <= cur.y + cur.h + 0.5) {
      return;
    }
    // Если масштаб изменился — старый фрагмент больше не совпадает с экраном
    // по чёткости, но по геометрии он верен (CSS), так что оставляем его до
    // перерисовки: так не мелькает.
    const timer = window.setTimeout(() => {
      const mx = vrW * DETAIL_MARGIN, my = vrH * DETAIL_MARGIN;
      let x = Math.max(0, vrX - mx), y = Math.max(0, vrY - my);
      let w = Math.min(width, vrX + vrW + mx) - x;
      let h = Math.min(height, vrY + vrH + my) - y;
      if (w <= 0 || h <= 0) return;
      // Ограничиваем фрагмент пределами браузера (сторона и площадь) и
      // разумным бюджетом памяти (~48 Мпикс ≈ 190 МБ) — масштаб при этом
      // сохраняем, а при превышении урезаем фрагмент до видимой области.
      const maxSide = maxSidePx();
      const maxArea = Math.min(maxAreaPx(), 48 * 1024 * 1024);
      let scale = wantScale;
      const fits = () => w * scale <= maxSide && h * scale <= maxSide && w * h * scale * scale <= maxArea;
      if (!fits()) {
        x = Math.max(0, vrX); y = Math.max(0, vrY);
        w = Math.min(width, vrX + vrW) - x;
        h = Math.min(height, vrY + vrH) - y;
        if (w <= 0 || h <= 0) return;
        if (!fits()) {
          const k = Math.min(maxSide / (w * scale), maxSide / (h * scale),
            Math.sqrt(maxArea / (w * h * scale * scale)));
          scale = scale * k;
        }
      }
      const pw = Math.max(1, Math.round(w * scale));
      const ph = Math.max(1, Math.round(h * scale));
      dc.width = pw; dc.height = ph;
      dc.style.left = `${x}px`; dc.style.top = `${y}px`;
      dc.style.width = `${w}px`; dc.style.height = `${h}px`;
      dc.style.display = "block";
      const ctx = dc.getContext("2d");
      if (!ctx) return;
      // Сдвиг на (-x,-y) в координатах листа: renderCanvas рисует весь лист,
      // а на холст попадает только наш фрагмент.
      ctx.setTransform(pw / w, 0, 0, ph / h, -x * pw / w, -y * ph / h);
      drawSchema(ctx);
      detailStateRef.current = { ver: contentVerRef.current, scale: wantScale, x, y, w, h };
    }, DETAIL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [needDetail, wantScale, vrX, vrY, vrW, vrH, width, height, drawSchema, baseScale]);

  useImperativeHandle(ref, () => ({
    getFitView: () => ({ scale: activeView.scale, offsetX: activeView.offsetX, offsetY: activeView.offsetY }),
    toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
  }), [activeView]);

  // Рамки слоя печати: bbox из projNodes текущего view
  const printLayerRects = useMemo(() =>
    activePrintLayers
      .map(h => {
        const pl = h.printLayer!;
        // С проекцией — чтобы ручная рамка (frameNorm/bounds) совпала с рабочей областью
        const rect = computeFrameRect(pl, projNodes, visibleBranches, proj, xyScale ?? 1, h.z ?? 0);
        return rect ? { h, pl, ...rect } : null;
      })
      .filter(Boolean) as Array<{ h: Horizon; pl: NonNullable<Horizon["printLayer"]>; rx: number; ry: number; rw: number; rh: number }>,
    [activePrintLayers, projNodes, visibleBranches, proj, xyScale],
  );

  return (
    <div style={{ position: "relative", width, height, flexShrink: 0 }}>
      <canvas ref={canvasRef} style={{ display: "block", width, height }} />
      {/* Детальный слой: видимый фрагмент в полном разрешении при сильном зуме */}
      <canvas ref={detailRef} style={{ position: "absolute", display: "none", pointerEvents: "none" }} />

      {schemaSymbols.length > 0 && (
        <SchemaSymbolsOverlay
          symbols={schemaSymbols}
          branches={branches}
          projNodesMap={projNodesMap}
          viewScale={activeView.scale}
          unitsConfig={unitsConfig}
          width={width}
          height={height}
          defaultBranchWidth={branchWidth}
          // Общие галочки показа величин: показатели замерных станций
          // включаются на всю схему разом, и лист обязан совпасть с экраном.
          infoConfig={infoConfig}
          // Тот же objSF, с которым renderCanvas рисует сами ветви, — иначе
          // значки и подписи на листе живут отдельной жизнью от выработок.
          sizing={makeSymbolSizing({
            objSF: computeObjSF(activeView.scale, xyScale, true, fixedObjectScale, undefined),
            viewScale: activeView.scale,
            xyScale, bulkheadScale, fanScale, thinLines,
          })}
        />
      )}

      {/* Таблички маршрутов МПО */}
      {inspectionLabels.length > 0 && (
        <PrintInspectionOverlay
          labels={inspectionLabels}
          proj={proj}
          viewState={viewState}
          activeView={activeView}
          zScale={zScale}
          xyScale={xyScale}
          fixedObjectScale={fixedObjectScale}
          scalePositionMin={scalePositionMin}
          scalePositionMax={scalePositionMax}
        />
      )}

      {/* Позиции ПЛА */}
      {showPositions && positions.length > 0 && (
        <PrintPositionsOverlay
          positions={positions}
          branches={branches}
          projNodesMap={projNodesMap}
          proj={proj}
          viewState={viewState}
          activeView={activeView}
          zScale={zScale}
          xyScale={xyScale}
          fixedObjectScale={fixedObjectScale}
          scalePositionMin={scalePositionMin}
          scalePositionMax={scalePositionMax}
          positionGostMm={positionGostMm}
        />
      )}

      {/* Текстовые блоки — как в рабочей области */}
      {textBlocks.length > 0 && (
        <PrintTextBlocksOverlay
          textBlocks={textBlocks}
          proj={proj}
          viewState={viewState}
          activeView={activeView}
          xyScale={xyScale}
          width={width}
          height={height}
        />
      )}

      {/* SVG слоя печати поверх canvas */}
      {printLayerRects.length > 0 && (
        <PrintLayerOverlay
          printLayerRects={printLayerRects}
          schemaSymbols={schemaSymbols}
          branches={branches}
          routeLegendItems={routeLegendItems}
          width={width}
          height={height}
        />
      )}
    </div>
  );
});

export default PrintPreviewCanvas;