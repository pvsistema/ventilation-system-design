// ─────────────────────────────────────────────────────────────────────────────
// Расчёт вентиляционного канала ГВУ на максимальную производительность
// вентилятора (по паспортной характеристике с учётом угла лопаток и оборотов).
//
//   Q_max (м³/с)   = Q_max,пасп(угол) · (n / n_ном) · N_парал
//   Q_max (м³/мин) = 60 · Q_max (м³/с)
//   S_min          = Q_max / V_доп          — минимальное сечение канала, м²
//   D_экв          = √(4·S_min / π)         — эквивалентный диаметр, м
//   V_факт         = Q_max / S_канала        — скорость в существующем канале
//   h_ск           = ρ·V² / 2                — скоростной напор, Па
//   V_доп = 15 м/с — макс. допустимая скорость в вентиляционных каналах (ПБ).
//
// Канал — это МАРШРУТ: ветвь с вентилятором + последовательные ветви до
// сопряжения с вертикальным стволом (и до поверхности с другой стороны).
// Проверка скорости выполняется по каждой ветви маршрута, расчётное сечение
// канала — минимальное (узкое место). Потери в канале: h = ΣR · Q_max².
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import { getFanById, fanQMax } from "@/lib/fanCurves";
import {
  traceChannelRoute, routeNodes, buildAdjacency, END_LABEL, isVertical,
  type RouteEndKind,
} from "@/lib/ventChannelRoute";

interface Props {
  fans: TopoBranch[];
  label: (b: TopoBranch) => string;
  branches: TopoBranch[];
  nodes: TopoNode[];
}

const RHO = 1.2;

function n(s: string): number {
  const v = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

export default function VdsChannelSection({ fans, label, branches, nodes }: Props) {
  const gvu = useMemo(() => fans.filter(f => f.fanType === "ГВУ"), [fans]);
  const list = gvu.length ? gvu : fans;
  const [fanId, setFanId] = useState<string>(list[0]?.id ?? "");
  const [vDop, setVDop] = useState("15");
  const [qManual, setQManual] = useState("");
  const [vertThr, setVertThr] = useState("60");
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [ends, setEnds] = useState<{ start: RouteEndKind; end: RouteEndKind }>({ start: "dead", end: "dead" });
  const [showRoute, setShowRoute] = useState(true);

  const byId = useMemo(() => new Map(branches.map(x => [x.id, x] as const)), [branches]);
  const nodeById = useMemo(() => new Map(nodes.map(x => [x.id, x] as const)), [nodes]);
  const adj = useMemo(() => buildAdjacency(branches), [branches]);

  const b = list.find(x => x.id === fanId);
  const thr = n(vertThr) || 60;

  // Автотрассировка при смене вентилятора / порога вертикальности
  function autoTrace() {
    if (!b) { setRouteIds([]); return; }
    const r = traceChannelRoute(b, branches, nodes, thr);
    setRouteIds(r.branchIds);
    setEnds({ start: r.start.kind, end: r.end.kind });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(autoTrace, [fanId, thr]);

  const route = useMemo(() => routeIds.map(id => byId.get(id)).filter(Boolean) as TopoBranch[], [routeIds, byId]);
  const rNodes = useMemo(() => routeNodes(routeIds, byId), [routeIds, byId]);
  const firstNode = rNodes[0];
  const lastNode = rNodes[rNodes.length - 1];

  // Кандидаты для продления маршрута на концах
  const candidates = (nodeId: string | undefined) =>
    nodeId ? (adj.get(nodeId) ?? []).filter(x => !routeIds.includes(x.id) && !x.isLeakage) : [];
  const startCand = candidates(firstNode);
  const endCand = candidates(lastNode);

  function extend(side: "start" | "end", id: string) {
    setRouteIds(ids => (side === "start" ? [id, ...ids] : [...ids, id]));
    setEnds(e => ({ ...e, [side]: "manual" }));
  }
  function trim(side: "start" | "end") {
    setRouteIds(ids => {
      if (ids.length <= 1) return ids;
      const cut = side === "start" ? ids[0] : ids[ids.length - 1];
      if (cut === fanId) return ids; // ветвь вентилятора не удаляем
      return side === "start" ? ids.slice(1) : ids.slice(0, -1);
    });
    setEnds(e => ({ ...e, [side]: "manual" }));
  }

  const curve = b?.fanCurveId ? getFanById(b.fanCurveId) : undefined;
  const qCurve = b && curve ? fanQMax(curve, b.fanBladeAngle, b.fanRpm) * Math.max(1, b.fanParallel || 1) : 0;
  const qMax = qManual.trim() ? n(qManual) : qCurve;
  const V = n(vDop);
  const sMin = qMax > 0 && V > 0 ? qMax / V : 0;
  const dEq = sMin > 0 ? Math.sqrt((4 * sMin) / Math.PI) : 0;

  // По маршруту: узкое место — минимальное сечение
  const withArea = route.filter(x => x.area > 0);
  const narrow = withArea.reduce<TopoBranch | undefined>((m, x) => (!m || x.area < m.area ? x : m), undefined);
  const sFact = narrow?.area ?? b?.area ?? 0;
  const vFact = sFact > 0 ? qMax / sFact : 0;
  const hSk = (RHO * vFact * vFact) / 2;
  const ok = vFact > 0 && V > 0 ? vFact <= V : null;
  const qNow = Math.abs(b?.flow ?? 0);
  const totalL = route.reduce((s, x) => s + (x.length || 0), 0);
  const totalR = route.reduce((s, x) => s + (x.resistance || 0), 0);
  const hRoute = totalR * qMax * qMax; // Па
  const badCount = route.filter(x => x.area > 0 && V > 0 && qMax / x.area > V).length;

  const inputCls = "w-full px-2 py-1 text-[12px] border border-gray-300 rounded outline-none focus:border-blue-500";
  const f = (x: number, d = 2) => (x > 0 ? x.toFixed(d) : "—");
  const nodeNum = (id?: string) => (id ? nodeById.get(id)?.number || id : "?");
  const brName = (x: TopoBranch) => x.type || x.mineTypeName || `ветвь ${x.id}`;
  const endBadge = (k: RouteEndKind) => {
    const c = k === "shaft" || k === "surface" ? "#16a34a" : k === "manual" ? "#2563eb" : "#d97706";
    return <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: c, border: `1px solid ${c}55`, background: `${c}10` }}>{END_LABEL[k]}</span>;
  };

  return (
    <div className="mt-4 pt-3" style={{ borderTop: "1px solid #dde3ec" }}>
      <div className="text-[13px] font-semibold text-gray-800">Вентиляционный канал ГВУ на макс. производительность</div>
      <div className="text-[11px] text-gray-500 leading-snug mb-2">
        Q<sub>max</sub> — по паспортной характеристике выбранного вентилятора (угол лопаток, обороты, число в параллель).
        S<sub>min</sub> = Q<sub>max</sub> / V<sub>доп</sub>; V<sub>доп</sub> = 15 м/с для вентиляционных каналов.
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2 text-[12px]">
        <label className="col-span-3 sm:col-span-1">
          <span className="text-gray-600">Вентилятор</span>
          <select className={inputCls + " bg-white"} value={fanId} onChange={e => { setFanId(e.target.value); setQManual(""); }}>
            {list.length === 0 && <option value="">— нет в схеме —</option>}
            {list.map(x => <option key={x.id} value={x.id}>{label(x)}</option>)}
          </select>
        </label>
        <label>
          <span className="text-gray-600">Q<sub>max</sub>, м³/с {qCurve > 0 && !qManual ? "(паспорт)" : ""}</span>
          <input className={inputCls} inputMode="decimal" value={qManual} placeholder={qCurve ? qCurve.toFixed(2) : "ввести"}
            onChange={e => setQManual(e.target.value)} />
        </label>
        <label>
          <span className="text-gray-600">V<sub>доп</sub>, м/с</span>
          <input className={inputCls} inputMode="decimal" value={vDop} onChange={e => setVDop(e.target.value)} />
        </label>
      </div>

      {b && !curve && !qManual && (
        <div className="mb-2 text-[11px] px-2 py-1.5 rounded" style={{ background: "#fff7e6", border: "1px solid #ffe0a3", color: "#9a6700" }}>
          У вентилятора не задана модель из справочника — введите Q<sub>max</sub> вручную.
        </div>
      )}

      {/* ─── Маршрут вентканала ─── */}
      {b && (
        <div className="mb-2 rounded" style={{ border: "1px solid #dde3ec" }}>
          <div className="flex items-center gap-2 px-2 py-1.5 text-[12px]" style={{ background: "#f1f4f9", borderBottom: showRoute ? "1px solid #dde3ec" : undefined }}>
            <button onClick={() => setShowRoute(s => !s)} className="flex items-center gap-1 font-semibold text-gray-700">
              <Icon name={showRoute ? "ChevronDown" : "ChevronRight"} size={14} />
              <Icon name="Route" size={14} />
              Маршрут вентканала
            </button>
            <span className="text-gray-500">
              {route.length} ветв. · {f(totalL, 1)} м · уз. {nodeNum(firstNode)} → {nodeNum(lastNode)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px] text-gray-600" title="Ветвь считается вертикальным стволом, если |угол наклона| не меньше порога">
                ствол ≥
                <input className="w-10 px-1 py-0.5 text-[11px] border border-gray-300 rounded" value={vertThr} onChange={e => setVertThr(e.target.value)} />°
              </label>
              <button onClick={autoTrace} className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-gray-300 bg-white hover:bg-gray-50">
                <Icon name="Wand2" size={12} /> Авто
              </button>
            </div>
          </div>

          {showRoute && (
            <div className="p-2">
              {/* Начало маршрута */}
              <RouteEndRow
                title="Начало" node={nodeNum(firstNode)} badge={endBadge(ends.start)}
                cand={startCand} brName={brName} nodeNum={nodeNum} canTrim={route.length > 1 && routeIds[0] !== fanId}
                onAdd={id => extend("start", id)} onTrim={() => trim("start")} thr={thr}
              />

              <table className="w-full text-[11px] my-1.5">
                <thead>
                  <tr className="text-gray-500 text-left">
                    <th className="font-normal py-0.5">#</th>
                    <th className="font-normal">Выработка</th>
                    <th className="font-normal">Узлы</th>
                    <th className="font-normal text-right">L, м</th>
                    <th className="font-normal text-right">S, м²</th>
                    <th className="font-normal text-right">∠, °</th>
                    <th className="font-normal text-right">V при Q<sub>max</sub></th>
                    <th className="font-normal text-right">h, Па</th>
                  </tr>
                </thead>
                <tbody>
                  {route.map((x, i) => {
                    const v = x.area > 0 ? qMax / x.area : 0;
                    const bad = V > 0 && v > V;
                    const isFan = x.id === fanId;
                    const isNarrow = narrow?.id === x.id;
                    return (
                      <tr key={x.id} style={{ borderTop: "1px solid #eef1f5", background: isFan ? "#eff6ff" : undefined }}>
                        <td className="py-0.5 text-gray-400">{i + 1}</td>
                        <td className="font-medium">
                          {isFan && <Icon name="Fan" size={11} className="inline mr-1 text-blue-600" />}
                          {brName(x)}
                          {isNarrow && <span className="ml-1 text-[10px] text-amber-600">узкое место</span>}
                        </td>
                        <td className="text-gray-500">{nodeNum(rNodes[i])}→{nodeNum(rNodes[i + 1])}</td>
                        <td className="text-right">{f(x.length, 1)}</td>
                        <td className="text-right">{f(x.area)}</td>
                        <td className="text-right text-gray-500">{(x.angle ?? 0).toFixed(0)}</td>
                        <td className="text-right font-medium" style={{ color: v > 0 ? (bad ? "#dc2626" : "#16a34a") : undefined }}>{f(v)}</td>
                        <td className="text-right">{f((x.resistance || 0) * qMax * qMax, 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Конец маршрута */}
              <RouteEndRow
                title="Конец" node={nodeNum(lastNode)} badge={endBadge(ends.end)}
                cand={endCand} brName={brName} nodeNum={nodeNum} canTrim={route.length > 1 && routeIds[routeIds.length - 1] !== fanId}
                onAdd={id => extend("end", id)} onTrim={() => trim("end")} thr={thr}
              />

              {ends.start !== "shaft" && ends.end !== "shaft" && (
                <div className="mt-1.5 text-[11px] px-2 py-1 rounded" style={{ background: "#fff7e6", border: "1px solid #ffe0a3", color: "#9a6700" }}>
                  Сопряжение с вертикальным стволом не найдено — продлите маршрут вручную или измените порог угла ствола.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="rounded p-3 grid grid-cols-2 gap-y-1.5 text-[12px]" style={{ background: "#f7f9fc", border: "1px solid #dde3ec" }}>
        <span className="text-gray-600">Модель:</span>
        <span className="font-medium">{curve?.name || b?.fanName || "—"}</span>
        <span className="text-gray-600">Макс. производительность Q<sub>max</sub>:</span>
        <span className="font-medium">{f(qMax)} м³/с = {f(qMax * 60, 0)} м³/мин</span>
        <span className="text-gray-600">Текущая подача Q:</span>
        <span className="font-medium">{f(qNow)} м³/с = {f(qNow * 60, 0)} м³/мин</span>
        <span className="text-gray-600">Мин. сечение канала S<sub>min</sub> = Q<sub>max</sub>/V<sub>доп</sub>:</span>
        <span className="font-bold text-blue-700">{f(sMin)} м²</span>
        <span className="text-gray-600">Эквивалентный диаметр D = √(4S/π):</span>
        <span className="font-medium">{f(dEq)} м</span>
        <span className="text-gray-600">Длина канала по маршруту:</span>
        <span className="font-medium">{f(totalL, 1)} м ({route.length} ветв.)</span>
        <span className="text-gray-600">Наименьшее сечение по маршруту:</span>
        <span className="font-medium">{f(sFact)} м²{narrow ? ` — ${brName(narrow)}` : ""}</span>
        <span className="text-gray-600">Скорость при Q<sub>max</sub> V = Q<sub>max</sub>/S:</span>
        <span className="font-medium" style={{ color: ok === false ? "#dc2626" : ok ? "#16a34a" : undefined }}>
          {f(vFact)} м/с {ok === false ? `— превышает V доп (${badCount} ветв.), канал мал` : ok ? "— в норме" : ""}
        </span>
        <span className="text-gray-600">Скоростной напор h<sub>ск</sub> = ρV²/2:</span>
        <span className="font-medium">{f(hSk, 1)} Па ({f(hSk / 10)} даПа)</span>
        <span className="text-gray-600">Сопротивление канала ΣR:</span>
        <span className="font-medium">{totalR > 0 ? totalR.toFixed(5) : "—"} Н·с²/м⁸</span>
        <span className="text-gray-600">Потери в канале h = ΣR·Q<sub>max</sub>²:</span>
        <span className="font-medium">{f(hRoute, 1)} Па ({f(hRoute / 10)} даПа)</span>
      </div>
    </div>
  );
}

function RouteEndRow(props: {
  title: string; node: string; badge: React.ReactNode; cand: TopoBranch[]; thr: number;
  brName: (b: TopoBranch) => string; nodeNum: (id?: string) => string; canTrim: boolean;
  onAdd: (id: string) => void; onTrim: () => void;
}) {
  const { title, node, badge, cand, brName, canTrim, onAdd, onTrim, thr } = props;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-gray-500 w-12">{title}:</span>
      <span className="font-medium">узел {node}</span>
      {badge}
      <div className="ml-auto flex items-center gap-1">
        {cand.length > 0 && (
          <select className="px-1 py-0.5 text-[11px] border border-gray-300 rounded bg-white" value=""
            onChange={e => e.target.value && onAdd(e.target.value)}>
            <option value="">+ продлить…</option>
            {cand.map(c => (
              <option key={c.id} value={c.id}>
                {brName(c)} ({c.area ? c.area.toFixed(2) : "—"} м²{isVertical(c, thr) ? ", ствол" : ""})
              </option>
            ))}
          </select>
        )}
        {canTrim && (
          <button onClick={onTrim} title="Убрать крайнюю ветвь" className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-50">
            <Icon name="Minus" size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
