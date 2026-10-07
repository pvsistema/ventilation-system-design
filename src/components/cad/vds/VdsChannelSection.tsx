// ─────────────────────────────────────────────────────────────────────────────
// Расчёт вентиляционного канала ГВУ — сечение, при котором вентилятор работает
// в НОМИНАЛЬНОЙ (оптимальной) точке: максимальный КПД, без вибрации и
// перегрузки подшипников, без срыва потока; с экономичными потерями в канале.
//
// 1. Номинальная точка вентилятора (по паспортной характеристике, с учётом
//    угла лопаток, оборотов n и числа в параллель N):
//      Q_ном — расход при η = η_max;  H_ном = H(Q_ном)
//      Q = Q_ном,1·(n/n_ном)·N,  H = H_ном,1·(n/n_ном)²
// 2. Сечение канала — наибольшее из трёх условий:
//      S_эк  = Q_ном / V_эк                  — экономичная скорость (6–8 м/с)
//      S_пот : h_к(S) = Σ R_i(S)·Q_ном² ≤ k·H_ном — потери в канале ≤ k (5 %)
//              R_i(S) = R_i·(S_i/S)^2,5  (R ∝ P·L/S³, P ∝ √S — подобие сечения)
//      S_max = Q_max / V_доп                 — проверка на макс. подаче (15 м/с)
// 3. Проверка рабочей точки (по расчёту сети):
//      устойчивость (без срыва): H_раб ≤ 0,9·H_max;
//      зона экономичной работы, без вибрации: 0,8 ≤ Q_раб/Q_ном ≤ 1,15 и
//      η_раб ≥ 0,9·η_max.
// 4. Экономика: N_пот = h_к·Q/η,  Э = N_пот·T,  разница между фактическим
//    и рекомендуемым сечением — годовая экономия электроэнергии.
//
// Канал — это МАРШРУТ: ветвь с вентилятором + последовательные ветви до
// сопряжения с вертикальным стволом (и до поверхности с другой стороны).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import { getFanById, fanQMax, fanCurveAtAngle, fanHAngle, fanEfficiencyAngle, type FanCurve } from "@/lib/fanCurves";
import { PA_PER_MM_H2O } from "@/lib/aerodynamics";
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

/** Номинальная (оптимальная) точка одного вентилятора: максимум КПД на паспортной зоне. */
function nominalPoint(c: FanCurve, angle: number, rpm: number) {
  const e = fanCurveAtAngle(c, angle);
  const k = rpm > 0 && c.rpmNominal > 0 ? rpm / c.rpmNominal : 1;
  const lo = Math.max(0.01, e.qMin), hi = Math.max(lo + 0.01, e.qMax);
  let qBest = lo, etaBest = -1, hMax = 0;
  for (let i = 0; i <= 200; i++) {
    const qn = lo + ((hi - lo) * i) / 200;
    const eta = fanEfficiencyAngle(c, qn, angle);
    if (eta > etaBest) { etaBest = eta; qBest = qn; }
    hMax = Math.max(hMax, fanHAngle(c, qn * k, angle, rpm));
  }
  // Каталожные кривые без своего КПД (плоский η) — берём паспортную номинальную точку
  if (etaBest <= 0.051 && c.qNominal > 0) qBest = c.qNominal;
  const q = qBest * k;
  return { q, h: fanHAngle(c, q, angle, rpm), eta: Math.max(0.05, etaBest), hMax, k };
}

/** КПД одного вентилятора при расходе q (фактические обороты). */
function etaAt(c: FanCurve, q: number, angle: number, k: number) {
  return fanEfficiencyAngle(c, q / k, angle);
}

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
  const [vEco, setVEco] = useState("8");
  const [lossPct, setLossPct] = useState("5");
  const [tariff, setTariff] = useState("6");
  const [hours, setHours] = useState("8760");
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
  const N = Math.max(1, b?.fanParallel || 1);
  const angle = b?.fanBladeAngle ?? 0;
  const rpm = b?.fanRpm ?? 0;
  const qMax = b && curve ? fanQMax(curve, angle, rpm) * N : 0;
  const nom = b && curve ? nominalPoint(curve, angle, rpm) : null;
  // Номинальная точка установки (N в параллель: расход ×N, напор тот же)
  const qNomCurve = nom ? nom.q * N : 0;
  const qNom = qManual.trim() ? n(qManual) : qNomCurve;
  const hNom = nom ? nom.h : Math.abs(b?.fanPressure ?? 0);
  const etaMax = nom?.eta ?? (b?.fanEfficiency && b.fanEfficiency > 0 ? (b.fanEfficiency > 1 ? b.fanEfficiency / 100 : b.fanEfficiency) : 0.7);

  const V = n(vDop);
  const vE = n(vEco);
  const kLoss = n(lossPct) / 100;

  // По маршруту: узкое место — минимальное сечение
  const withArea = route.filter(x => x.area > 0);
  const narrow = withArea.reduce<TopoBranch | undefined>((m, x) => (!m || x.area < m.area ? x : m), undefined);
  const sFact = narrow?.area ?? b?.area ?? 0;
  const totalL = route.reduce((s, x) => s + (x.length || 0), 0);
  const totalR = route.reduce((s, x) => s + (x.resistance || 0), 0);
  // Потери в канале, Па (R в кМюрг → ×9,81)
  const lossAt = (q: number) => totalR * q * q * PA_PER_MM_H2O;
  // Потери при едином сечении S: R_i(S) = R_i·(S_i/S)^2,5
  const kRoute = withArea.reduce((s, x) => s + (x.resistance || 0) * Math.pow(x.area, 2.5), 0);
  const lossAtS = (S: number, q: number) => (S > 0 ? (kRoute / Math.pow(S, 2.5)) * q * q * PA_PER_MM_H2O : 0);

  // Требуемые сечения
  const sEco = qNom > 0 && vE > 0 ? qNom / vE : 0;
  let sLoss = 0;
  if (qNom > 0 && hNom > 0 && kLoss > 0 && kRoute > 0) {
    const target = kLoss * hNom;
    sLoss = Math.pow((kRoute * qNom * qNom * PA_PER_MM_H2O) / target, 1 / 2.5);
  }
  const sMaxQ = qMax > 0 && V > 0 ? qMax / V : 0;
  const sRec = Math.max(sEco, sLoss, sMaxQ);
  const governing = sRec <= 0 ? "" : sRec === sLoss ? "по потерям в канале" : sRec === sEco ? "по экономичной скорости" : "по макс. подаче";
  const dEq = sRec > 0 ? Math.sqrt((4 * sRec) / Math.PI) : 0;

  // Скорости и потери при номинальной подаче
  const vNomFact = sFact > 0 ? qNom / sFact : 0;
  const vMaxFact = sFact > 0 ? qMax / sFact : 0;
  const hFact = lossAt(qNom);
  const hRec = lossAtS(sRec, qNom);
  const hSk = (RHO * vNomFact * vNomFact) / 2;
  const okSection = sFact > 0 && sRec > 0 ? sFact >= sRec * 0.98 : null;
  const badCount = route.filter(x => x.area > 0 && V > 0 && qMax / x.area > V).length;

  // Рабочая точка по расчёту сети
  const qNow = Math.abs(b?.flow ?? 0);
  const hNow = Math.abs(b?.fanPressure ?? 0);
  const ratio = qNom > 0 ? qNow / qNom : 0;
  const etaNow = curve && nom && qNow > 0 ? etaAt(curve, qNow / N, angle, nom.k) : 0;
  const stallOk = nom && hNow > 0 ? hNow <= 0.9 * nom.hMax : null;
  const zoneOk = qNow > 0 && qNom > 0 ? ratio >= 0.8 && ratio <= 1.15 : null;
  const etaOk = etaNow > 0 ? etaNow >= 0.9 * etaMax : null;

  // Экономика: мощность на преодоление сопротивления канала
  const T = n(hours), price = n(tariff);
  const pFact = etaMax > 0 ? (hFact * qNom) / etaMax / 1000 : 0; // кВт
  const pRec = etaMax > 0 ? (hRec * qNom) / etaMax / 1000 : 0;
  const eFact = pFact * T, eRec = pRec * T;
  const saving = Math.max(0, eFact - eRec);

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
      <div className="text-[13px] font-semibold text-gray-800">Вентиляционный канал ГВУ — работа в номинальной точке</div>
      <div className="text-[11px] text-gray-500 leading-snug mb-2">
        Сечение подбирается под номинальную точку вентилятора (η = max): экономичная скорость V<sub>эк</sub>, потери в канале
        не более заданной доли напора, проверка на максимальной подаче по V<sub>доп</sub>. Рабочая точка проверяется на
        устойчивость (без срыва) и на зону экономичной работы (без вибрации и перегрузки подшипников).
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
          <span className="text-gray-600">Q<sub>ном</sub>, м³/с {qNomCurve > 0 && !qManual ? "(η max)" : ""}</span>
          <input className={inputCls} inputMode="decimal" value={qManual} placeholder={qNomCurve ? qNomCurve.toFixed(2) : "ввести"}
            onChange={e => setQManual(e.target.value)} />
        </label>
        <label>
          <span className="text-gray-600">V<sub>эк</sub>, м/с (6–8)</span>
          <input className={inputCls} inputMode="decimal" value={vEco} onChange={e => setVEco(e.target.value)} />
        </label>
        <label>
          <span className="text-gray-600">Потери в канале ≤, % H<sub>ном</sub></span>
          <input className={inputCls} inputMode="decimal" value={lossPct} onChange={e => setLossPct(e.target.value)} />
        </label>
        <label>
          <span className="text-gray-600">V<sub>доп</sub> при Q<sub>max</sub>, м/с</span>
          <input className={inputCls} inputMode="decimal" value={vDop} onChange={e => setVDop(e.target.value)} />
        </label>
        <label>
          <span className="text-gray-600">Тариф, руб/кВт·ч · часов/год</span>
          <div className="flex gap-1">
            <input className={inputCls} inputMode="decimal" value={tariff} onChange={e => setTariff(e.target.value)} />
            <input className={inputCls} inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} />
          </div>
        </label>
      </div>

      {b && !curve && !qManual && (
        <div className="mb-2 text-[11px] px-2 py-1.5 rounded" style={{ background: "#fff7e6", border: "1px solid #ffe0a3", color: "#9a6700" }}>
          У вентилятора не задана модель из справочника — номинальную точку определить нельзя. Введите Q<sub>ном</sub> вручную (напор берётся из расчёта сети).
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
                    <th className="font-normal text-right">V при Q<sub>ном</sub></th>
                    <th className="font-normal text-right">V при Q<sub>max</sub></th>
                    <th className="font-normal text-right">h, Па</th>
                  </tr>
                </thead>
                <tbody>
                  {route.map((x, i) => {
                    const v = x.area > 0 ? qMax / x.area : 0;
                    const bad = V > 0 && v > V;
                    const vn = x.area > 0 ? qNom / x.area : 0;
                    const badN = vE > 0 && vn > vE;
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
                        <td className="text-right font-medium" style={{ color: vn > 0 ? (badN ? "#d97706" : "#16a34a") : undefined }}>{f(vn)}</td>
                        <td className="text-right" style={{ color: v > 0 ? (bad ? "#dc2626" : "#6b7280") : undefined }}>{f(v)}</td>
                        <td className="text-right">{f((x.resistance || 0) * qNom * qNom * PA_PER_MM_H2O, 1)}</td>
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
        <Hdr>Номинальная точка вентилятора</Hdr>
        <span className="text-gray-600">Модель:</span>
        <span className="font-medium">{curve?.name || b?.fanName || "—"}{N > 1 ? ` × ${N} в параллель` : ""}</span>
        <span className="text-gray-600">Номинальная подача Q<sub>ном</sub> (η max):</span>
        <span className="font-medium">{f(qNom)} м³/с = {f(qNom * 60, 0)} м³/мин</span>
        <span className="text-gray-600">Напор в номинальной точке H<sub>ном</sub>:</span>
        <span className="font-medium">{f(hNom, 0)} Па ({f(hNom / 10, 1)} даПа)</span>
        <span className="text-gray-600">КПД η<sub>max</sub>:</span>
        <span className="font-medium">{f(etaMax * 100, 0)} %</span>
        <span className="text-gray-600">Макс. подача Q<sub>max</sub> (край паспорта):</span>
        <span className="font-medium">{f(qMax)} м³/с = {f(qMax * 60, 0)} м³/мин</span>

        <Hdr>Сечение канала</Hdr>
        <span className="text-gray-600">По экономичной скорости S = Q<sub>ном</sub>/V<sub>эк</sub>:</span>
        <span className="font-medium">{f(sEco)} м²</span>
        <span className="text-gray-600">По потерям h<sub>к</sub> ≤ {f(kLoss * 100, 0)} % H<sub>ном</sub>:</span>
        <span className="font-medium">{sLoss > 0 ? `${f(sLoss)} м²` : "— (нет R маршрута)"}</span>
        <span className="text-gray-600">По макс. подаче S = Q<sub>max</sub>/V<sub>доп</sub>:</span>
        <span className="font-medium">{f(sMaxQ)} м²</span>
        <span className="text-gray-600 font-semibold">Рекомендуемое сечение S<sub>рек</sub>:</span>
        <span className="font-bold text-blue-700">{f(sRec)} м² <span className="font-normal text-gray-500">({governing}), D<sub>экв</sub> = {f(dEq)} м</span></span>
        <span className="text-gray-600">Наименьшее сечение по маршруту:</span>
        <span className="font-medium" style={{ color: okSection === false ? "#dc2626" : okSection ? "#16a34a" : undefined }}>
          {f(sFact)} м²{narrow ? ` — ${brName(narrow)}` : ""}{okSection === false ? " — меньше рекомендуемого" : okSection ? " — достаточно" : ""}
        </span>
        <span className="text-gray-600">Длина канала по маршруту:</span>
        <span className="font-medium">{f(totalL, 1)} м ({route.length} ветв.)</span>
        <span className="text-gray-600">Скорость при Q<sub>ном</sub> / при Q<sub>max</sub>:</span>
        <span className="font-medium">
          <span style={{ color: vE > 0 && vNomFact > vE ? "#d97706" : "#16a34a" }}>{f(vNomFact)}</span> /{" "}
          <span style={{ color: V > 0 && vMaxFact > V ? "#dc2626" : "#16a34a" }}>{f(vMaxFact)}</span> м/с
          {badCount > 0 ? <span className="text-red-600"> — превышение V доп в {badCount} ветв.</span> : null}
        </span>
        <span className="text-gray-600">Скоростной напор при Q<sub>ном</sub> h<sub>ск</sub> = ρV²/2:</span>
        <span className="font-medium">{f(hSk, 1)} Па</span>
        <span className="text-gray-600">Потери в канале при Q<sub>ном</sub>: факт / рек.:</span>
        <span className="font-medium">
          {f(hFact, 1)} Па ({hNom > 0 ? f((hFact / hNom) * 100, 1) : "—"} %) / {f(hRec, 1)} Па
        </span>

        <Hdr>Рабочая точка по расчёту сети</Hdr>
        <span className="text-gray-600">Q<sub>раб</sub> / H<sub>раб</sub>:</span>
        <span className="font-medium">{f(qNow)} м³/с ({f(qNow * 60, 0)} м³/мин) / {f(hNow, 0)} Па</span>
        <span className="text-gray-600">Отношение Q<sub>раб</sub>/Q<sub>ном</sub> (норма 0,8…1,15):</span>
        <Check ok={zoneOk} text={ratio > 0 ? ratio.toFixed(2) : "—"} bad={ratio < 0.8 ? "левее номинала — рост вибрации, риск помпажа" : "правее номинала — перегрузка двигателя и подшипников"} />
        <span className="text-gray-600">КПД в рабочей точке (≥ 0,9·η<sub>max</sub>):</span>
        <Check ok={etaOk} text={etaNow > 0 ? `${(etaNow * 100).toFixed(0)} %` : "—"} bad="неэкономичный режим" />
        <span className="text-gray-600">Устойчивость H<sub>раб</sub> ≤ 0,9·H<sub>max</sub> (без срыва):</span>
        <Check ok={stallOk} text={nom ? `${f(hNow, 0)} ≤ ${f(0.9 * nom.hMax, 0)} Па` : "—"} bad="зона срыва потока" />

        <Hdr>Экономический эффект</Hdr>
        <span className="text-gray-600">Мощность на потери в канале: факт / рек.:</span>
        <span className="font-medium">{pFact > 0 ? pFact.toFixed(1) : "—"} / {pRec > 0 ? pRec.toFixed(1) : "—"} кВт</span>
        <span className="text-gray-600">Электроэнергия в год: факт / рек.:</span>
        <span className="font-medium">{eFact > 0 ? Math.round(eFact).toLocaleString("ru-RU") : "—"} / {eRec > 0 ? Math.round(eRec).toLocaleString("ru-RU") : "—"} кВт·ч</span>
        <span className="text-gray-600">Экономия при сечении S<sub>рек</sub>:</span>
        <span className="font-bold" style={{ color: saving > 0 ? "#16a34a" : undefined }}>
          {saving > 0 ? `${Math.round(saving).toLocaleString("ru-RU")} кВт·ч/год ≈ ${Math.round(saving * price).toLocaleString("ru-RU")} руб/год` : "— (канал уже не хуже рекомендуемого)"}
        </span>
      </div>
    </div>
  );
}

function Hdr({ children }: { children: React.ReactNode }) {
  return <div className="col-span-2 mt-1.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500" style={{ borderTop: "1px solid #e3e8f0" }}>{children}</div>;
}

function Check({ ok, text, bad }: { ok: boolean | null; text: string; bad: string }) {
  const c = ok === null ? undefined : ok ? "#16a34a" : "#dc2626";
  return <span className="font-medium" style={{ color: c }}>{text}{ok === true ? " — в норме" : ok === false ? ` — ${bad}` : ""}</span>;
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
