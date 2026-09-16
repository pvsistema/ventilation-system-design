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
    });
  }
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

  // Занятые места на экране.
  //
  // В объёме выработки уходят вдаль и их середины то и дело проецируются в одну
  // точку: без этой проверки подписи ложились бы штабелем и не читалась бы ни
  // одна. Сетка грубая — по высоте строки: точного разбора наложений тут не
  // нужно, важно лишь не печатать текст поверх текста.
  const cellW = 74, cellH = 13;
  const cols = Math.max(1, Math.ceil(w / cellW));
  const taken = new Set<number>();

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  const v = new THREE.Vector3();
  let drawn = 0;

  for (const L of labels) {
    if (drawn >= MAX_LABELS) break;

    v.copy(L.pos).project(cam);
    // z вне [-1..1] — выработка за спиной камеры или за границей отсечения.
    if (v.z < -1 || v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * w;
    const sy = (-v.y * 0.5 + 0.5) * h;
    // Подписи за краем кадра не рисуем: их не видно, а место в сетке они бы
    // заняли и вытеснили бы видимые.
    if (sx < -40 || sx > w + 40 || sy < -20 || sy > h + 20) continue;

    const key = Math.floor(sy / cellH) * cols + Math.floor(sx / cellW);
    if (taken.has(key)) continue;
    taken.add(key);

    const lh = 11;
    // Подпись ставится НАД серединой выработки, как на чертеже: под линией её
    // перекрывала бы сама выработка.
    const top = sy - L.lines.length * lh - 4;

    for (let i = 0; i < L.lines.length; i++) {
      const isNum = i === 0 && L.showNum;
      ctx.font = isNum
        ? `600 ${L.lines[i].length > 2 ? 9.5 : 11}px "Segoe UI",sans-serif`
        : `600 10px "Segoe UI",sans-serif`;
      const ty = top + lh * (i + 0.6);
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
