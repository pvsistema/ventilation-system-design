// ─────────────────────────────────────────────────────────────────────────────
// Рамка листа слоя печати в «нормальных» координатах проекции.
//
// Экран = сдвиг + масштаб × норм. координата (так устроен project3D), поэтому
// рамка, сохранённая в этих координатах, остаётся ровным прямоугольником
// с точными пропорциями листа в любом виде (план, ИЗО, фронт) и ведёт себя
// при зуме/панораме ровно как схема. Действительна для того ракурса и тех
// масштабов XY/Z, при которых её задали; иначе рамка строится автоматически.
// ─────────────────────────────────────────────────────────────────────────────
import type { HorizonPrintLayer, ProjOptions } from "@/lib/topology";

export type FrameNorm = NonNullable<HorizonPrintLayer["frameNorm"]>;

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

/** Рамка задана для текущего ракурса и масштабов? */
export function frameNormValid(
  fn: FrameNorm | undefined, proj: Pick<ProjOptions, "azimuth" | "elevation">, xyScale = 1, zScale = 1,
): fn is FrameNorm {
  if (!fn || !(fn.w > 0) || !(fn.h > 0)) return false;
  return near(fn.az, proj.azimuth ?? 0, 0.01) && near(fn.el, proj.elevation ?? 90, 0.01)
    && near(fn.xy, xyScale, 1e-6) && near(fn.zs, zScale, 1e-6);
}

/** Норм. рамка → экранный прямоугольник. */
export function frameNormToScreen(fn: FrameNorm, proj: Pick<ProjOptions, "scale" | "offsetX" | "offsetY">) {
  return {
    rx: proj.offsetX + fn.x * proj.scale,
    ry: proj.offsetY + fn.y * proj.scale,
    rw: fn.w * proj.scale,
    rh: fn.h * proj.scale,
  };
}

/** Экранный прямоугольник → норм. рамка для текущего ракурса. */
export function screenToFrameNorm(
  r: { rx: number; ry: number; rw: number; rh: number },
  proj: Pick<ProjOptions, "scale" | "offsetX" | "offsetY" | "azimuth" | "elevation">,
  xyScale = 1, zScale = 1,
): FrameNorm {
  const s = proj.scale || 1;
  return {
    x: (r.rx - proj.offsetX) / s, y: (r.ry - proj.offsetY) / s,
    w: r.rw / s, h: r.rh / s,
    az: proj.azimuth ?? 0, el: proj.elevation ?? 90, xy: xyScale, zs: zScale,
  };
}

/**
 * Экранный прямоугольник РУЧНОЙ рамки (frameNorm или старые мировые bounds)
 * для заданной проекции. null — рамка автоматическая.
 */
export function manualFrameRect(
  pl: HorizonPrintLayer,
  proj: ProjOptions,
  xyScale = 1,
  zLevel = 0,
  project: (p: { x: number; y: number; z: number }, o: ProjOptions) => { sx: number; sy: number },
): { rx: number; ry: number; rw: number; rh: number } | null {
  const zs = proj.zScale ?? 1;
  if (frameNormValid(pl.frameNorm, proj, xyScale, zs)) return frameNormToScreen(pl.frameNorm, proj);
  if (!pl.bounds) return null;
  const z4 = zLevel * zs;
  const b = pl.bounds;
  const c = [
    project({ x: b.x1 * xyScale, y: b.y2 * xyScale, z: z4 }, proj),
    project({ x: b.x2 * xyScale, y: b.y2 * xyScale, z: z4 }, proj),
    project({ x: b.x1 * xyScale, y: b.y1 * xyScale, z: z4 }, proj),
    project({ x: b.x2 * xyScale, y: b.y1 * xyScale, z: z4 }, proj),
  ];
  const xs = c.map(p => p.sx), ys = c.map(p => p.sy);
  const rx = Math.min(...xs), ry = Math.min(...ys);
  return { rx, ry, rw: Math.max(...xs) - rx, rh: Math.max(...ys) - ry };
}
