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
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import {
  MEASURE_STATION_TYPE_ID, msIndicatorFlags, msIndicatorLines,
} from "@/lib/msIndicatorLines";
import { msIndBg, msIndTextColor } from "@/lib/msIndicatorStyle";
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
  /**
   * Конец выработки в координатах сцены.
   *
   * Вместе с серединой даёт направление выработки НА ЭКРАНЕ — по нему подпись
   * отводится поперёк выработки, а не вдоль. Без этого подпись при наклонной
   * выработке съезжала к соседнему узлу.
   */
  end: THREE.Vector3;
  lines: string[];
  showNum: boolean;
  overV: boolean;
  /**
   * Смещение задано человеком вручную (он оттащил подпись на чертеже).
   *
   * Такое смещение переносится в объём как есть, экранными пикселями: если
   * подпись отведена в сторону, чтобы не легла на соседнюю выработку, в объёме
   * она должна стоять там же. А вот СТАНДАРТНОЕ смещение «на 16 пикселей
   * вверх» переносить нельзя: на чертеже оно уводит подпись от линии, а в
   * объёме выработки идут в любую сторону, и «вверх по экрану» для наклонной
   * выработки означает «вдоль неё» — подпись ложилась на трубу и выглядела
   * оторванной от своей выработки. Поэтому по умолчанию отводим подпись
   * ПОПЕРЁК выработки, см. drawMineLabels.
   */
  manualOffset: boolean;
  /** Ручное смещение подписи от середины выработки, экранные пиксели. */
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
  /**
   * Цвет плашки под подписью. Нужен замерным станциям: их показатели и на
   * чертеже стоят на цветной подложке, иначе теряются среди подписей расходов.
   * Не задан (обычная подпись выработки) — текст с белой обводкой, как раньше.
   */
  bg?: string | null;
  /** Цвет текста на плашке. Имеет смысл только вместе с bg. */
  fg?: string;
}

export interface LabelBuildInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  xyScale: number;
  zScale: number;
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig: UnitsConfig;
  waterBranchResults?: Map<string, WaterBranchResult>;
  /**
   * Условные обозначения схемы. Нужны ради замерных станций: их показатели —
   * такие же подписи, как у выработок, и включаются той же «Панелью
   * информации». В объёме их не было вовсе: человек ставил галочку и не
   * находил чисел — приходилось возвращаться на чертёж.
   */
  symbols?: SchemaSymbol[];
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
    // Человек оттащил подпись руками, если задано ХОТЬ ОДНО из смещений.
    // Чертёжное значение по умолчанию (0, −16) ручным не считается.
    const manual = b.labelOffsetX !== undefined || b.labelOffsetY !== undefined;
    out.push({
      id: b.id,
      pos: new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5),
      end: c,
      lines, showNum, overV,
      manualOffset: manual,
      offX: b.labelOffsetX ?? 0,
      offY: b.labelOffsetY ?? 0,
      weight: Math.abs(b.flow ?? 0),
    });
  }
  // ── Показатели замерных станций ─────────────────────────────────────
  //
  // Станция — не выработка, но подпись у неё той же природы: набор величин,
  // включённый галочками. Поэтому она идёт тем же потоком — так она участвует
  // в общем разборе наложений и не ложится поверх подписи своей же выработки.
  //
  // Вес станций выше любого расхода: замер — то, ради чего к станции подходят,
  // и уступать место подписи соседней выработки он не должен.
  const branchById = new Map(branches.map(b => [b.id, b]));
  for (const sym of input.symbols ?? []) {
    if (sym.typeId !== MEASURE_STATION_TYPE_ID) continue;
    if (!sym.branchId) continue;
    const b = branchById.get(sym.branchId);
    if (!b || b.isDead) continue;
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) continue;
    if (!isFinite(fn.x) || !isFinite(fn.y) || !isFinite(fn.z)) continue;
    if (!isFinite(tn.x) || !isFinite(tn.y) || !isFinite(tn.z)) continue;

    const flags = msIndicatorFlags(sym, input.infoConfig);
    const lines = msIndicatorLines(sym, b, flags);
    if (lines.length === 0) continue;

    const a = toThree(fn.x * kx, fn.y * kx, fn.z * kz);
    const c = toThree(tn.x * kx, tn.y * kx, tn.z * kz);
    // Станция стоит не в середине выработки, а в своей точке t — там же, где
    // на чертеже. Подпись обязана быть при ней, а не при выработке.
    const t = Math.max(0, Math.min(1, sym.t ?? 0.5));
    const bg = msIndBg(sym.msIndBgColor);
    out.push({
      id: `ms:${sym.id}`,
      pos: new THREE.Vector3().lerpVectors(a, c, t),
      end: c,
      lines,
      showNum: flags.number,
      overV: false,
      manualOffset: false,
      offX: 0, offY: 0,
      weight: Number.MAX_SAFE_INTEGER,
      bg,
      fg: msIndTextColor(bg),
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
  const vEnd = new THREE.Vector3();
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
    // Середина выработки на экране — точка привязки подписи.
    const mx = (v.x * 0.5 + 0.5) * w;
    const my = (-v.y * 0.5 + 0.5) * h;

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

    // ── Куда отвести подпись от выработки ─────────────────────────────
    //
    // Раньше подпись сдвигалась на чертёжные (0, −16) — то есть всегда «вверх
    // по экрану». В объёме выработки идут в любую сторону, и для наклонной или
    // вертикальной выработки «вверх» означает «вдоль неё»: подпись съезжала к
    // соседнему узлу и выглядела принадлежащей другой выработке — ровно то,
    // что читалось как «индикаторы убегают».
    //
    // Теперь подпись отводится ПОПЕРЁК выработки: считаем её направление на
    // экране и откладываем нормаль. Такое смещение поворачивается вместе со
    // схемой, поэтому подпись при любом ракурсе стоит рядом со своей
    // выработкой, а не поперёк неё.
    vEnd.copy(L.end).project(cam);
    const ex = (vEnd.x * 0.5 + 0.5) * w;
    const ey = (-vEnd.y * 0.5 + 0.5) * h;
    let dx = ex - mx, dy = ey - my;
    const dl = Math.hypot(dx, dy);
    // Выработка смотрит «в камеру» и вырождается в точку — отводить некуда,
    // берём привычное «вверх».
    if (dl < 0.5) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }
    // Нормаль к выработке. Знак выбираем так, чтобы подпись уходила ВВЕРХ по
    // экрану — как на чертеже; для почти горизонтальной на экране выработки
    // это привычное «над линией».
    let nx = -dy, ny = dx;
    if (ny > 0) { nx = -nx; ny = -ny; }

    // Насколько далеко отвести.
    //
    // Ручное смещение с чертежа задано в пикселях ЧЕРТЕЖА и там ещё умножается
    // на масштаб показа. В объёме такого масштаба нет, и сырое число уносило
    // подпись за сотни пикселей от выработки — на общем плане рудника подписи
    // повисали в пустоте отдельно от схемы. Поэтому от ручного смещения берём
    // только ДЛИНУ, и ту ограничиваем: направление в объёме всё равно своё —
    // поперёк выработки, а не то, что было на плоском чертеже.
    const base = bh / 2 + 6;
    const gap = L.manualOffset
      ? Math.min(Math.max(base, Math.hypot(L.offX, L.offY)), base + 26)
      : base;

    const sx = mx + nx * gap;
    const sy = my + ny * gap;
    const offX = nx * gap, offY = ny * gap;

    // Подписи за краем кадра не рисуем: их не видно, а место они бы заняли и
    // вытеснили бы видимые.
    if (sx < -60 || sx > w + 60 || sy < -40 || sy > h + 40) continue;

    const box: Box = {
      x0: sx - maxW / 2 - 2, x1: sx + maxW / 2 + 2,
      y0: sy - bh / 2 - 1, y1: sy + bh / 2 + 1,
    };
    if (hit(box)) continue;
    put(box);

    // Выноска от выработки к отведённой подписи. На чертеже она рисуется по
    // тому же правилу: без неё при плотной схеме не видно, какой именно
    // выработке принадлежит подпись.
    const offLen = Math.hypot(offX, offY);
    if (offLen > 10) {
      ctx.save();
      ctx.strokeStyle = "rgba(148,163,184,0.9)";
      ctx.lineWidth = 0.7;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(mx, my);
      // Ведём не до центра блока, а до его края — иначе линия перечёркивает текст.
      ctx.lineTo(sx - (offX / offLen) * (bh / 2), sy - (offY / offLen) * (bh / 2));
      ctx.stroke();
      ctx.restore();
    }

    // Цветная плашка — у замерных станций. На чертеже их показатели стоят на
    // подложке, иначе теряются среди подписей расходов; в объёме схема ещё
    // пестрее, и без плашки станция не читается вовсе.
    if (L.bg) {
      const bw = maxW + 10, x0 = sx - bw / 2, y0 = sy - bh / 2;
      const rx = Math.min(4, bh / 3);
      ctx.beginPath();
      ctx.moveTo(x0 + rx, y0);
      ctx.arcTo(x0 + bw, y0, x0 + bw, y0 + bh, rx);
      ctx.arcTo(x0 + bw, y0 + bh, x0, y0 + bh, rx);
      ctx.arcTo(x0, y0 + bh, x0, y0, rx);
      ctx.arcTo(x0, y0, x0 + bw, y0, rx);
      ctx.closePath();
      ctx.fillStyle = L.bg;
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    for (let i = 0; i < L.lines.length; i++) {
      const isNum = i === 0 && L.showNum;
      ctx.font = isNum ? numFont(L.lines[i]) : dataFont;
      const ty = sy - bh / 2 + LH * (i + 0.6);
      // Белая обводка под текстом — единственный способ прочитать подпись на
      // пёстрой схеме, где под ней может оказаться и светлая, и тёмная
      // выработка. На чертеже сделано так же. На плашке обводка не нужна: она
      // размывает буквы, а фон и без неё отделяет текст от схемы.
      if (!L.bg) {
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.lineWidth = 3;
        ctx.strokeText(L.lines[i], sx, ty);
      }
      ctx.fillStyle = L.bg
        ? (L.fg ?? "#ffffff")
        : isNum
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