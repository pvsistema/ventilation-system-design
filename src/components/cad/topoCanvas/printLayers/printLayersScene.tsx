import {
  type TopoNode, type TopoBranch, type ProjOptions, type WorkPlane,
  type PaperFormat,
  PAPER_SIZES_MM, OVERVIEW_HORIZON_ID,
  project3D, unproject2D, unprojectToPlane,
} from "@/lib/topology";
import { type Props, type ProjNodeEntry } from "@/components/cad/topoCanvas/topoCanvasTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Сцена и геометрия слоя печати. Вынесено из TopoCanvasPrintLayers 1:1.
//
// Здесь собрано всё, что НЕ рисует содержимое листа, а готовит почву:
//   renderGroundGrid        — сетка плоскости z=0 и тройка осей (только в 3D)
//   renderWorkPlane         — полупрозрачный квадрат активной рабочей плоскости
//   makeUnprojFrame         — фабрика единой распроекции экран→мир для рамки
//   computePrintFrameLayout — экранный bbox рамки листа и производные величины
//
// Формулы, пороги и ветвления перенесены без изменений.
// ─────────────────────────────────────────────────────────────────────────────

/** Горизонт со слоем печати — элемент массива Props["horizons"]. */
export type PrintHorizon = NonNullable<Props["horizons"]>[number];
/** Настройки слоя печати конкретного горизонта. */
export type PrintLayerCfg = NonNullable<PrintHorizon["printLayer"]>;

/** Распроекция экран→мир для рамки слоя печати. */
export type UnprojFrame = (sx: number, sy: number, zLevel: number) => { x: number; y: number } | null;

/** Мировой bbox рамки. */
export interface FrameWorldBounds { x1: number; y1: number; x2: number; y2: number }
/** Экранная точка угла рамки. */
export interface FrameCorner { sx: number; sy: number }

// ─── Сетка плоскости (план z=0) ──────────────────────────────────────────────
export function renderGroundGrid(is3D: boolean, proj: ProjOptions) {
  if (!is3D) return null;
  const step = 500;          // м
  const range = 3000;        // от -range до +range
  const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
  for (let x = -range; x <= range; x += step) {
    const a = project3D({ x, y: -range, z: 0 }, proj);
    const b = project3D({ x, y: range, z: 0 }, proj);
    lines.push({ x1: a.sx, y1: a.sy, x2: b.sx, y2: b.sy, key: `gx${x}` });
  }
  for (let y = -range; y <= range; y += step) {
    const a = project3D({ x: -range, y, z: 0 }, proj);
    const b = project3D({ x: range, y, z: 0 }, proj);
    lines.push({ x1: a.sx, y1: a.sy, x2: b.sx, y2: b.sy, key: `gy${y}` });
  }
  // Тройка осей в начале
  const O = project3D({ x: 0, y: 0, z: 0 }, proj);
  const Xa = project3D({ x: 500, y: 0, z: 0 }, proj);
  const Ya = project3D({ x: 0, y: 500, z: 0 }, proj);
  const Za = project3D({ x: 0, y: 0, z: 500 }, proj);
  return (
    <g>
      {lines.map((l) => (
        <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke="#d4d4d4" strokeWidth="0.6" opacity="0.7" />
      ))}
      <line x1={O.sx} y1={O.sy} x2={Xa.sx} y2={Xa.sy} stroke="#ef4444" strokeWidth="2" />
      <line x1={O.sx} y1={O.sy} x2={Ya.sx} y2={Ya.sy} stroke="#22c55e" strokeWidth="2" />
      <line x1={O.sx} y1={O.sy} x2={Za.sx} y2={Za.sy} stroke="#3b82f6" strokeWidth="2" />
      <text x={Xa.sx + 4} y={Xa.sy} fontSize="10" fill="#ef4444">X</text>
      <text x={Ya.sx + 4} y={Ya.sy} fontSize="10" fill="#22c55e">Y</text>
      <text x={Za.sx + 4} y={Za.sy} fontSize="10" fill="#3b82f6">Z</text>
    </g>
  );
}

// ─── Визуализация активной рабочей плоскости (полупрозрачный квадрат) ────────
export function renderWorkPlane(is3D: boolean, effPlane: WorkPlane, proj: ProjOptions) {
  if (!is3D) return null;
  const r = 1500;     // полу-сторона плоскости (м)
  let corners: Array<{ x: number; y: number; z: number }>;
  let color: string;
  if (effPlane.axis === "z") {
    const z = effPlane.value;
    corners = [{ x: -r, y: -r, z }, { x: r, y: -r, z }, { x: r, y: r, z }, { x: -r, y: r, z }];
    color = "#fbbf24";
  } else if (effPlane.axis === "y") {
    const y = effPlane.value;
    corners = [{ x: -r, y, z: -r }, { x: r, y, z: -r }, { x: r, y, z: r }, { x: -r, y, z: r }];
    color = "#a78bfa";
  } else {
    const x = effPlane.value;
    corners = [{ x, y: -r, z: -r }, { x, y: r, z: -r }, { x, y: r, z: r }, { x, y: -r, z: r }];
    color = "#60a5fa";
  }
  const pts = corners.map((c) => project3D(c, proj));
  const polyPts = pts.map((p) => `${p.sx},${p.sy}`).join(" ");
  return (
    <g>
      <polygon points={polyPts} fill={color} fillOpacity="0.08" stroke={color} strokeOpacity="0.5" strokeWidth="1" strokeDasharray="6 4" />
    </g>
  );
}

// Вертикальные направляющие — убраны (создавали сотни пунктирных линий при 3D-виде CSV-схем)

// ─── Единая распроекция экран→мир для рамки слоя печати ──────────────────────
// Рамка живёт в плоскости z=zLevel. КРИТИЧНО: точка клика и углы рамки должны
// распроецироваться ОДНИМ И ТЕМ ЖЕ способом, иначе в наклонных видах (ИЗО и др.)
// возникает рассинхрон и рамка резко увеличивается/прыгает.
// Для видов, где z-плоскость вырождена (Фронт/Профиль, elevation≈0),
// unprojectToPlane вернёт null → откатываемся на плоскую unproject2D для ОБЕИХ
// сторон, сохраняя консистентность.
export function makeUnprojFrame(is3D: boolean, proj: ProjOptions): UnprojFrame {
  return (sx: number, sy: number, zLevel: number) => {
    if (is3D) {
      const wp = unprojectToPlane(sx, sy, proj, { axis: "z", value: zLevel });
      if (wp) return { x: wp.x, y: wp.y };
      // z-плоскость вырождена (elevation≈0) — плоский фолбэк
      const flat = unproject2D(sx, sy, proj, zLevel);
      return { x: flat.x, y: flat.y };
    }
    const flat = unproject2D(sx, sy, proj, zLevel);
    return { x: flat.x, y: flat.y };
  };
}

/** Экранная геометрия рамки листа + производные масштабы. */
export interface PrintFrameLayout {
  rx: number; ry: number; rw: number; rh: number;
  wb: FrameWorldBounds;
  pTL: FrameCorner; pTR: FrameCorner; pBL: FrameCorner; pBR: FrameCorner;
  pxPerMm: number;
  inset: number;
  titleFontSize: number;
}

export interface FrameLayoutArgs {
  h: PrintHorizon;
  pl: PrintLayerCfg;
  aspect: number;
  ori: "landscape" | "portrait";
  mm: { w: number; h: number };
  nodes: TopoNode[];
  branches: TopoBranch[];
  visibleBranches: TopoBranch[];
  projNodes: ProjNodeEntry[];
  proj: ProjOptions;
  xyScale: number;
  zScale: number;
}

/**
 * Считает экранный bbox рамки листа.
 *
 * Возвращает null там, где исходный код прерывал отрисовку горизонта
 * (нет спроецированных узлов / нет узлов горизонта).
 */
export function computePrintFrameLayout(args: FrameLayoutArgs): PrintFrameLayout | null {
  const {
    h, pl, aspect, ori, mm,
    nodes, branches, visibleBranches, projNodes, proj, xyScale, zScale,
  } = args;

  // ── Вычисляем экранный bbox рамки ──────────────────────────────────────
  let rx = 0, ry = 0, rw = 0, rh = 0;
  const wb: FrameWorldBounds = { x1: 0, y1: 0, x2: 0, y2: 0 };
  const pTL = { sx: 0, sy: 0 }, pTR = { sx: 0, sy: 0 }, pBL = { sx: 0, sy: 0 }, pBR = { sx: 0, sy: 0 };
  let skipWorldProject = false; // флаг: экранные coords уже вычислены, пропустить общий блок

  if (h.id === OVERVIEW_HORIZON_ID && !pl.bounds) {
    // Авто-bbox OVERVIEW: проецируем ВИДИМЫЕ ветви с реальными X/Y/Z в экранные координаты.
    // Используем проецированные узлы (projNodes) — они уже готовы с текущей проекцией.
    // Это корректно работает при ЛЮБОЙ проекции (план, ИЗО, фронт, профиль).
    if (projNodes.length === 0) return null;
    // Берём только узлы реально используемых (видимых) ветвей
    const visibleNodeIds = new Set<string>();
    visibleBranches.forEach(b => { visibleNodeIds.add(b.fromId); visibleNodeIds.add(b.toId); });
    const relevantProj = projNodes.filter(pn => visibleNodeIds.has(pn.node.id));
    if (relevantProj.length === 0) return null;
    let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
    relevantProj.forEach(pn => {
      if (pn.sx < minSx) minSx = pn.sx; if (pn.sx > maxSx) maxSx = pn.sx;
      if (pn.sy < minSy) minSy = pn.sy; if (pn.sy > maxSy) maxSy = pn.sy;
    });
    const sw = maxSx - minSx, sh = maxSy - minSy;
    // Отступ: 8% от размера схемы + фиксированный минимум
    const pad = Math.max(sw, sh) * 0.08 + 15;
    const scx = (minSx + maxSx) / 2;
    const scy_schema = (minSy + maxSy) / 2;
    // Размер рамки охватывает схему с отступами, соблюдая пропорции бумаги
    const fitSw = sw + pad * 2, fitSh = sh + pad * 2;
    let rsw = fitSw, rsh = fitSw / aspect;
    if (rsh < fitSh) { rsh = fitSh; rsw = fitSh * aspect; }
    // Рамка всегда охватывает схему со всех сторон (и в плане, и в 3D)
    const scy = scy_schema;
    rsw = Math.max(rsw, sw + pad * 2);
    rsh = rsw / aspect;
    if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }
    // Заполняем экранные координаты углов напрямую (без проекции через wb)
    Object.assign(pTL, { sx: scx - rsw / 2, sy: scy - rsh / 2 });
    Object.assign(pTR, { sx: scx + rsw / 2, sy: scy - rsh / 2 });
    Object.assign(pBL, { sx: scx - rsw / 2, sy: scy + rsh / 2 });
    Object.assign(pBR, { sx: scx + rsw / 2, sy: scy + rsh / 2 });
    rx = scx - rsw / 2;
    ry = scy - rsh / 2;
    rw = Math.max(rsw, 40);
    rh = Math.max(rsh, 40);
    skipWorldProject = true;
  } else if (pl.bounds) {
    // Ручные bounds (в т.ч. OVERVIEW) хранятся в мировых X/Y и проецируются
    // тем же общим путём, что и запись при drag/resize (через project3D/unproject2D).
    // Это устраняет рассинхрон «сохранили абсолют — прочитали как смещение»,
    // из-за которого рамка убегала из координат схемы.
    Object.assign(wb, pl.bounds);
  } else {
    // Авто-bbox обычного горизонта — по узлам этого горизонта
    const hNodeIds = new Set<string>();
    branches.forEach(b => { if (b.horizonId === h.id) { hNodeIds.add(b.fromId); hNodeIds.add(b.toId); } });
    const hNodes = nodes.filter(n => hNodeIds.has(n.id));
    if (hNodes.length === 0) return null;
    const wxs = hNodes.map(n => n.x);
    const wys = hNodes.map(n => n.y);
    const wmx = Math.min(...wxs), wMx = Math.max(...wxs);
    const wmy = Math.min(...wys), wMy = Math.max(...wys);
    const ww = wMx - wmx, wh = wMy - wmy;
    const pad = Math.max(ww, wh) * 0.12 + 10;
    const cx = (wmx + wMx) / 2, cy = (wmy + wMy) / 2;
    const fitW = ww + pad * 2, fitH = wh + pad * 2;
    let rw2 = fitW, rh2 = fitW / aspect;
    if (rh2 < fitH) { rh2 = fitH; rw2 = fitH * aspect; }
    Object.assign(wb, { x1: cx - rw2 / 2, y1: cy - rh2 / 2, x2: cx + rw2 / 2, y2: cy + rh2 / 2 });
  }
  // ── Общий путь: проецируем wb (мировые) → экранные координаты ──────────
  // Пропускается для OVERVIEW без ручных bounds (skipWorldProject = true)
  if (!skipWorldProject) {
    const xy = xyScale ?? 1;
    const z4proj = h.z * (zScale ?? 1);
    const _pTL = project3D({ x: wb.x1 * xy, y: wb.y2 * xy, z: z4proj }, proj);
    const _pTR = project3D({ x: wb.x2 * xy, y: wb.y2 * xy, z: z4proj }, proj);
    const _pBL = project3D({ x: wb.x1 * xy, y: wb.y1 * xy, z: z4proj }, proj);
    const _pBR = project3D({ x: wb.x2 * xy, y: wb.y1 * xy, z: z4proj }, proj);
    Object.assign(pTL, _pTL); Object.assign(pTR, _pTR);
    Object.assign(pBL, _pBL); Object.assign(pBR, _pBR);
    rx = Math.min(pTL.sx, pBL.sx);
    ry = Math.min(pTL.sy, pTR.sy);
    rw = Math.max(pTR.sx, pBR.sx) - rx;
    rh = Math.max(pBL.sy, pBR.sy) - ry;
    rw = Math.max(rw, 40); rh = Math.max(rh, 40);
  }
  // Единый масштаб «пикселей на 1 мм листа» — фиксирует размеры текста
  // пропорционально формату листа (A3/A4…), а не экранной высоте рамки rh.
  // rw соответствует ширине листа в мм → шрифт N*pxPerMm мм стабилен как на печати.
  const mmW = ori === "landscape" ? Math.max(mm.w, mm.h) : Math.min(mm.w, mm.h);
  const pxPerMm = rw / mmW;
  const inset = Math.max(4, Math.min(rw, rh) * 0.015);
  // Заголовок: фиксированные ~5.5 мм листа (пропорционально формату)
  const titleFontSize = Math.max(6, pxPerMm * 5.5);

  return { rx, ry, rw, rh, wb, pTL, pTR, pBL, pBR, pxPerMm, inset, titleFontSize };
}

/** Формат листа и производные пропорции — общая шапка отрисовки горизонта. */
export function readPaperSpec(pl: PrintLayerCfg) {
  const fmt = (pl.paperFormat ?? "A3") as PaperFormat;
  const ori = pl.orientation ?? "landscape";
  const mm = PAPER_SIZES_MM[fmt];
  const aspect = ori === "landscape" ? mm.w / mm.h : mm.h / mm.w;
  return { fmt, ori, mm, aspect };
}
