// ─────────────────────────────────────────────────────────────────────────────
// mineLabels.ts — ПОДПИСИ ВЫРАБОТОК В РЕЖИМЕ «МОДЕЛЬ».
//
// ПОЧЕМУ ПОДПИСИ РИСУЮТСЯ НЕ В САМОЙ СЦЕНЕ.
// Объёмный текст в three.js — это либо спрайт с картинкой на каждую подпись,
// либо готовая 3D-геометрия букв. И то и другое означает отдельный объект на
// каждую выработку: на схеме в тысячи выработок это тысячи текстур в
// видеопамяти и тысячи вызовов отрисовки — ровно то, от чего мы ушли, собирая
// геометрию пакетами. Вдобавок объёмный текст вместе со схемой поворачивается
// и на ребре превращается в нечитаемую полоску.
//
// Поэтому подписи живут на обычном холсте, положенном поверх картинки
// видеокарты. Текст всегда смотрит на человека и всегда одного кегля — как на
// чертеже, — а рисуется он теми же средствами, что и чертёжные подписи.
//
// Текст строк берётся из общего модуля branchLabelLines: в объёме показываются
// РОВНО те же величины и в тех же единицах, что и на чертеже. Расхождение здесь
// недопустимо — это один и тот же расчёт, показанный с двух сторон.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig } from "@/lib/unitsConfig";
import { type WaterBranchResult } from "@/lib/waterHydraulics";
import { branchLabelLines } from "@/lib/branchLabelLines";
import { toThree } from "./mineScene";

/**
 * Сколько подписей показываем за кадр.
 *
 * Ограничение не про скорость видеокарты, а про читаемость и про стоимость
 * вывода текста: каждая строка — это обводка и заливка на процессоре. На общем
 * плане рудника подписи всё равно сливаются в кашу, поэтому дальше этого числа
 * рисовать бессмысленно — человек приближает интересующий участок, и подписи
 * достаются тем выработкам, что попали в кадр.
 */
const MAX_LABELS = 350;

/** Подпись одной выработки, подготовленная заранее. */
export interface MineLabel {
  id: string;
  /** Середина выработки в координатах сцены — к ней привязана подпись. */
  pos: THREE.Vector3;
  lines: string[];
  showNum: boolean;
  overV: boolean;
  /**
   * Ручное смещение подписи от середины выработки, экранные пиксели.
   *
   * Берётся ровно то, что человек выставил на чертеже: если он оттащил подпись
   * в сторону, чтобы она не легла на соседнюю выработку, в объёме она должна
   * стоять там же. По умолчанию — над линией, как на чертеже.
   */
  offX: number;
  offY: number;
  /**
   * Вес подписи при нехватке места на экране.
   *
   * Чем крупнее выработка по расходу, тем важнее её подпись: при наложении
   * уступает мелкая сбойка, а не главный ствол. Порядок от расхода не зависит
   * от ракурса, поэтому при вращении подписи не меняются местами и не мигают.
   */
  weight: number;
}

export interface LabelBuildInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  xyScale: number;
  zScale: number;
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig: UnitsConfig;
  waterBranchResults?: Map<string, WaterBranchResult>;
}

/**
 * Готовит подписи один раз на схему.
 *
 * Собирать текст в цикле отрисовки нельзя: это десятки тысяч операций над
 * строками шестьдесят раз в секунду. Числа меняются только при пересчёте сети,
 * тогда подписи и пересобираются заново.
 */
export function buildMineLabels(input: LabelBuildInput): MineLabel[] {
  const { nodes, branches, xyScale, zScale } = input;
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const kx = xyScale > 0 ? xyScale : 1;
  const kz = zScale > 0 ? zScale : 1;

  const out: MineLabel[] = [];
  for (const b of branches) {
    if (b.isDead) continue;
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) continue;
    // Та же защита, что и в сборке геометрии: узел без координат уводит
    // подпись в бесконечность, а с ней и весь расчёт положения на экране.
    if (!isFinite(fn.x) || !isFinite(fn.y) || !isFinite(fn.z)) continue;
    if (!isFinite(tn.x) || !isFinite(tn.y) || !isFinite(tn.z)) continue;

    const { lines, showNum, overV } = branchLabelLines({
      b, fromNode: fn, toNode: tn,
      infoConfig: input.infoConfig,
      unitsConfig: input.unitsConfig,
      waterBranchResults: input.waterBranchResults,
    });
    if (lines.length === 0) continue;

    const a = toThree(fn.x * kx, fn.y * kx, fn.z * kz);
    const c = toThree(tn.x * kx, tn.y * kx, tn.z * kz);
    out.push({
      id: b.id,
      pos: new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5),
      lines, showNum, overV,
      // Смещение — то же, что на чертеже. Значение по умолчанию (−16 по Y)
      // повторяет чертёжное: подпись стоит над выработкой.
      offX: b.labelOffsetX ?? 0,
      offY: b.labelOffsetY ?? -16,
      weight: Math.abs(b.flow ?? 0),
    });
  }
  // Крупные выработки — первыми: при нехватке места на экране подпись
  // достаётся стволу, а не сбойке рядом с ним.
  out.sort((p, q) => q.weight - p.weight);
  return out;
}

export interface LabelDrawOptions {
  /** Выбранная выработка — её номер красится синим, как на чертеже. */
  selectedId?: string | null;
  /** Ширина и высота холста в логических пикселях. */
  width: number;
  height: number;
}

/**
 * Рисует подписи поверх объёмной картинки.
 *
 * Возвращает, сколько подписей поместилось — по этому числу видно, упёрлись ли
 * мы в ограничение и есть ли смысл приближать схему.
 */
export function drawMineLabels(
  ctx: CanvasRenderingContext2D,
  labels: MineLabel[],
  cam: THREE.Camera,
  opts: LabelDrawOptions,
): number {
  const { width: w, height: h } = opts;
  ctx.clearRect(0, 0, w, h);
  if (labels.length === 0) return 0;

  // ── Занятые места на экране ───────────────────────────────────────────
  //
  // В объёме выработки уходят вдаль и их середины то и дело проецируются в одну
  // точку: без разбора наложений подписи ложились бы штабелем и не читалась бы
  // ни одна.
  //
  // Раньше здесь была грубая сетка 74×13: подпись занимала ОДНУ ячейку
  // независимо от того, сколько места на экране она на самом деле съедала.
  // Из-за этого при малейшем повороте схемы середина выработки переезжала в
  // соседнюю ячейку, и подпись то пропадала, то возвращалась — со стороны это
  // и выглядело как «надписи убегают». Теперь считается настоящий
  // прямоугольник текста, а сетка осталась только как способ быстро найти
  // соседей: решение зависит от того, где текст, а не от того, в какую клетку
  // попала точка привязки.
  const CELL = 48;
  const gridCols = Math.max(1, Math.ceil(w / CELL) + 2);
  const placed = new Map<number, Box[]>();

  const hit = (bx: Box): boolean => {
    const c0 = Math.floor(bx.x0 / CELL), c1 = Math.floor(bx.x1 / CELL);
    const r0 = Math.floor(bx.y0 / CELL), r1 = Math.floor(bx.y1 / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = placed.get(r * gridCols + c);
        if (!cell) continue;
        for (const o of cell) {
          if (bx.x0 < o.x1 && bx.x1 > o.x0 && bx.y0 < o.y1 && bx.y1 > o.y0) return true;
        }
      }
    }
    return false;
  };

  const put = (bx: Box) => {
    const c0 = Math.floor(bx.x0 / CELL), c1 = Math.floor(bx.x1 / CELL);
    const r0 = Math.floor(bx.y0 / CELL), r1 = Math.floor(bx.y1 / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * gridCols + c;
        const cell = placed.get(k);
        if (cell) cell.push(bx); else placed.set(k, [bx]);
      }
    }
  };

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  const v = new THREE.Vector3();
  let drawn = 0;

  // Размеры текста — ровно чертёжные (см. canvasRenderer: lh = 11, номер
  // 9/7.5 пт, данные 8.5 пт). В объёме масштаб подписи постоянный: текст
  // всегда смотрит на человека и всегда одного кегля, иначе дальние подписи
  // превратились бы в нечитаемую пыль.
  const LH = 11;
  const dataFont = `600 8.5px "Segoe UI",sans-serif`;

  for (const L of labels) {
    if (drawn >= MAX_LABELS) break;

    v.copy(L.pos).project(cam);
    // z вне [-1..1] — выработка за спиной камеры или за границей отсечения.
    if (v.z < -1 || v.z > 1) continue;
    // Точка привязки: середина выработки плюс то самое смещение, которое
    // человек задал на чертеже. Смещение экранное и не масштабируется — иначе
    // при отдалении подпись уезжала бы от своей выработки.
    const sx = (v.x * 0.5 + 0.5) * w + L.offX;
    const sy = (-v.y * 0.5 + 0.5) * h + L.offY;
    // Подписи за краем кадра не рисуем: их не видно, а место они бы заняли и
    // вытеснили бы видимые.
    if (sx < -60 || sx > w + 60 || sy < -40 || sy > h + 40) continue;

    // Высота блока и вертикальная раскладка — как на чертеже: строки
    // центрированы относительно точки привязки.
    const bh = L.lines.length * LH + 4;

    // Ширину меряем заранее, до рисования: по ней проверяется наложение, и
    // отвергнутая подпись не должна оставить на холсте ни пикселя.
    let maxW = 0;
    for (let i = 0; i < L.lines.length; i++) {
      const isNum = i === 0 && L.showNum;
      ctx.font = isNum ? numFont(L.lines[i]) : dataFont;
      const lw = ctx.measureText(L.lines[i]).width;
      if (lw > maxW) maxW = lw;
    }

    const box: Box = {
      x0: sx - maxW / 2 - 2, x1: sx + maxW / 2 + 2,
      y0: sy - bh / 2 - 1, y1: sy + bh / 2 + 1,
    };
    if (hit(box)) continue;
    put(box);

    for (let i = 0; i < L.lines.length; i++) {
      const isNum = i === 0 && L.showNum;
      ctx.font = isNum ? numFont(L.lines[i]) : dataFont;
      const ty = sy - bh / 2 + LH * (i + 0.6);
      // Белая обводка под текстом — единственный способ прочитать подпись на
      // пёстрой схеме, где под ней может оказаться и светлая, и тёмная
      // выработка. На чертеже сделано так же.
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = 3;
      ctx.strokeText(L.lines[i], sx, ty);
      ctx.fillStyle = isNum
        ? (L.id === opts.selectedId ? "#2563eb" : "#374151")
        : (L.overV ? "#dc2626" : "#1e3a5f");
      ctx.fillText(L.lines[i], sx, ty);
    }
    drawn++;
  }

  ctx.restore();
  return drawn;
}

/** Прямоугольник подписи на экране, логические пиксели. */
interface Box { x0: number; y0: number; x1: number; y1: number }

/** Шрифт строки с номером: длинный номер набирается мельче — как на чертеже. */
function numFont(text: string): string {
  return `600 ${text.length > 2 ? 7.5 : 9}px "Segoe UI",sans-serif`;
}