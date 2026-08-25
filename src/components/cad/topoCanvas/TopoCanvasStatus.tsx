// ─────────────────────────────────────────────────────────────────────────────
// TopoCanvasStatus.tsx — строка состояния и подсказки инструментов холста:
//   • левый индикатор: режим Canvas, ракурс 3D, координаты курсора, плоскость;
//   • правый индикатор: числовой масштаб схемы;
//   • подсказки активного инструмента (узел / ветвь / вращение / привязка УО).
//
// Вынесено из TopoCanvas.tsx БЕЗ изменений разметки, стилей и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import { type WorkPlane } from "@/lib/topology";
import { type CadTool } from "./topoCanvasTypes";

interface StatusProps {
  useCanvas: boolean;
  visibleBranchCount: number;
  is3D: boolean;
  azimuth: number;
  elevation: number;
  /** Ref на <span> с координатами — текст пишется напрямую, без перерисовки. */
  hoverPosRef?: React.Ref<HTMLSpanElement>;
  effPlane: WorkPlane;
  scale: number;
}

/**
 * Индикаторы внизу холста (координаты, плоскость, масштаб).
 *
 * Координаты курсора НЕ хранятся в состоянии React: мышь шлёт до 120 событий в
 * секунду, и каждое перерисовывало бы весь холст со схемой ради двух чисел в
 * углу экрана. Вместо этого текст пишется прямо в DOM через ref — строка
 * состояния обновляется мгновенно, а схема не трогается вовсе.
 */
export function TopoCanvasIndicators({
  useCanvas, visibleBranchCount, is3D, azimuth, elevation,
  hoverPosRef, effPlane, scale,
}: StatusProps) {
  return (
    <>
      {/* Индикаторы */}
      <div className="absolute bottom-1 left-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "var(--c-t2, #444)", marginLeft: "0px", paddingBottom: "0px" }}>
        {useCanvas && (
          <span className="mr-2 px-1 rounded" style={{ background: "var(--c-tint-green2, #d1fae5)", color: "#065f46" }}>
            Canvas · {visibleBranchCount} вет.
          </span>
        )}
        {is3D && <span className="mr-2">3D · Az: {azimuth.toFixed(0)}° · El: {elevation.toFixed(0)}°</span>}
        {/* Текст координат пишет TopoCanvas напрямую в этот span (см. коммент
            выше). Пустой, пока курсор не над схемой — как и было раньше. */}
        <span ref={hoverPosRef} />
        {/* Значения фиксированных осей и zLevel учитывает та же функция в
            TopoCanvas — они меняются редко и не зависят от движения мыши. */}
        <span className="ml-3 px-1.5 py-0.5 rounded"
          style={{ background: "var(--c-tint-amber2, #fef3c7)", color: "var(--c-amber-ink, #92400e)" }}>
          Плоск: {effPlane.axis.toUpperCase()}={effPlane.value} м
        </span>
      </div>
      <div className="absolute bottom-1 right-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "var(--c-t2, #444)" }}>
        М 1:{(1 / Math.max(0.00001, scale * 0.001)).toFixed(0)}
      </div>
    </>
  );
}

interface HintsProps {
  pendingSymbolTypeId: string | null | undefined;
  tool: CadTool;
  effPlane: WorkPlane;
  branchFrom: string | null;
}

/** Подсказки активного инструмента в левом верхнем углу холста. */
export function TopoCanvasHints({ pendingSymbolTypeId, tool, effPlane, branchFrom }: HintsProps) {
  return (
    <>
      {/* Подсказка — режим ожидания привязки */}
      {pendingSymbolTypeId && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "var(--c-green-bg, #059669)", color: "white" }}>
          Кликните на ветвь чтобы разместить УО · Esc — отмена
        </div>
      )}

      {/* Подсказка */}
      {tool === "node" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "var(--c-blue-bg, #2563eb)", color: "white" }}>
          ✚ Клик на холсте — создать узел на плоскости{" "}
          {effPlane.axis === "z" ? `Z = ${effPlane.value} м (XY)` :
           effPlane.axis === "y" ? `Y = ${effPlane.value} м (XZ)` :
           `X = ${effPlane.value} м (YZ)`}
        </div>
      )}
      {tool === "branch" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "var(--c-blue-bg, #2563eb)", color: "white" }}>
          {branchFrom ? "Выберите второй узел" : "Выберите начальный узел ветви"}
        </div>
      )}
      {tool === "rotate" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "var(--c-purple-bg, #7c3aed)", color: "white" }}>
          🔄 Драг — вращение камеры (Az/El)
        </div>
      )}
    </>
  );
}