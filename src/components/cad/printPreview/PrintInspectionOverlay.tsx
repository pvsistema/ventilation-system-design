// Слой табличек маршрутов МПО для предпросмотра печати.
// Размер таблички — как у маркеров позиций ПЛА (фиксированный масштаб или
// пропорционально зуму), пересчитанный на масштаб листа.
import { project3D, type ProjOptions } from "@/lib/topology";
import { type InspectionLabel, inspectionLabelScale } from "@/lib/inspectionRoutes";

interface Props {
  labels: InspectionLabel[];
  proj: ProjOptions;
  viewState: { scale: number };
  activeView: { scale: number };
  zScale: number;
  xyScale?: number;
  fixedObjectScale: boolean;
  scalePositionMin: number;
  scalePositionMax: number;
}

export default function PrintInspectionOverlay({
  labels, proj, viewState, activeView, zScale, xyScale,
  fixedObjectScale, scalePositionMin, scalePositionMax,
}: Props) {
  const xy = xyScale ?? 1;
  const sf = inspectionLabelScale(viewState.scale, xyScale, fixedObjectScale, scalePositionMin, scalePositionMax);
  const previewK = viewState.scale > 0 ? activeView.scale / viewState.scale : 1;
  const k = sf * previewK;
  const items = labels.map(l => ({
    l,
    p: project3D({ x: l.x * xy, y: l.y * xy, z: l.z * zScale }, proj),
    a: project3D({ x: l.ax * xy, y: l.ay * xy, z: l.az * zScale }, proj),
  }));
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {items.filter(it => it.l.moved).map(({ l, p, a }) => (
          <g key={l.id}>
            <line x1={a.sx} y1={a.sy} x2={p.sx} y2={p.sy}
              stroke={l.color} strokeWidth={Math.max(0.5, 1.5 * k)} strokeDasharray={`${4 * k} ${3 * k}`} />
            <circle cx={a.sx} cy={a.sy} r={Math.max(1, 3 * k)} fill={l.color} />
          </g>
        ))}
      </svg>
      {items.map(({ l, p }) => (
        <div key={l.id} style={{
          position: "absolute", left: p.sx, top: p.sy,
          transform: l.moved
            ? `translate(-50%, -50%) scale(${k})`
            : `translate(-50%, -100%) scale(${k}) translateY(-10px)`,
          transformOrigin: l.moved ? "center center" : "center bottom",
          background: "rgba(255,255,255,0.95)", border: `2px solid ${l.color}`, borderRadius: 6,
          padding: "2px 7px", fontSize: 11, lineHeight: 1.25, whiteSpace: "nowrap",
          color: "#111827", fontFamily: "Arial, sans-serif",
        }}>
          <div style={{ fontWeight: 700, color: l.color, fontSize: 10 }}>{l.title}</div>
          <div style={{ fontWeight: 600 }}>{l.text}</div>
        </div>
      ))}
    </div>
  );
}
