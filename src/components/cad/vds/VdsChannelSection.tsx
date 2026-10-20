// ─────────────────────────────────────────────────────────────────────────────
// Расчёт вентиляционного канала ГВУ — сечение, при котором вентилятор работает
// в НОМИНАЛЬНОЙ (оптимальной) точке: максимальный КПД, без вибрации и
// перегрузки подшипников, без срыва потока; с экономичными потерями в канале.
//
// 1. Номинальная точка вентилятора (по паспортной характеристике, с учётом
//    угла лопаток, оборотов n и числа в параллель N):
//      Q_ном — расход при η = η_max;  H_ном = H(Q_ном)
//      Q = Q_ном,1·(n/n_ном)·N,  H = H_ном,1·(n/n_ном)²
// 2. Сечение канала — по потерям давления (скорость воздуха в вентиляционном
//    канале ГВУ НЕ регламентируется, поэтому ограничений по скорости нет):
//      S_рек : h_к(S) = Σ R_i(S)·Q_ном² ≤ k·H_ном — потери в канале ≤ k (5 %)
//              R_i(S) = R_i·(S_i/S)^2,5  (R ∝ P·L/S³, P ∝ √S — подобие сечения)
//    Скорость и скоростной напор выводятся только для справки.
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
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import { getFanById, fanQMax, fanCurveAtAngle, fanHAngle, fanEfficiencyAngle, type FanCurve } from "@/lib/fanCurves";
import { PA_PER_MM_H2O } from "@/lib/aerodynamics";
import type { BranchBulkheadInfo } from "@/lib/branchBulkheadInfo";
import { C, Card, Field, Info, INP, INP_STYLE, Kpi, MiniBtn, Note, Row } from "@/components/cad/vds/vdsUi";
import {
  traceChannelRoute, buildAdjacency, END_LABEL, isVertical, classifyEnd, orderBranchChain,
  type RouteEndKind,
} from "@/lib/ventChannelRoute";

interface Props {
  fans: TopoBranch[];
  label: (b: TopoBranch) => string;
  branches: TopoBranch[];
  nodes: TopoNode[];
  /** Подсветка ветвей маршрута на схеме. */
  onHighlight?: (ids: string[]) => void;
  /** Вентсооружения по ветвям — чтобы маршрут не шёл через закрытые перемычки. */
  bulkheads?: Map<string, BranchBulkheadInfo>;
  /** Расчёт сети выполнен — маршрут строится по расходу и ходу струи. */
  solved?: boolean;
  /** Перехват клика по ветви на схеме — для ручного выбора ветвей канала. */
  branchPickRef?: MutableRefObject<((branchId: string) => void) | null>;
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
  // Кривая КПД недостоверна (плоская или нереально низкая, например при
  // импорте мощности в других единицах) — номинальную точку по максимуму η
  // искать нельзя: берём паспортный номинал (середину рабочей зоны).
  const etaReliable = etaBest >= 0.3;
  if (!etaReliable) qBest = c.qNominal > 0 ? Math.min(hi, Math.max(lo, c.qNominal * fanCurveAtAngle(c, angle).qMax / Math.max(1e-6, c.qMax))) : (lo + hi) / 2;
  const q = qBest * k;
  return { q, h: fanHAngle(c, q, angle, rpm), eta: etaReliable ? etaBest : 0, etaReliable, hMax, k };
}

/** КПД одного вентилятора при расходе q (фактические обороты). */
function etaAt(c: FanCurve, q: number, angle: number, k: number) {
  return fanEfficiencyAngle(c, q / k, angle);
}

function n(s: string): number {
  const v = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

export default function VdsChannelSection({ fans, label, branches, nodes, onHighlight, bulkheads, branchPickRef }: Props) {
  const gvu = useMemo(() => fans.filter(f => f.fanType === "ГВУ"), [fans]);
  const list = gvu.length ? gvu : fans;
  const [fanId, setFanId] = useState<string>(list[0]?.id ?? "");
  const [qManual, setQManual] = useState("");
  const [lossPct, setLossPct] = useState("5");
  const [tariff, setTariff] = useState("6");
  const [hours, setHours] = useState("8760");
  const [vertThr, setVertThr] = useState("60");
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [showRoute, setShowRoute] = useState(true);
  const [highlight, setHighlight] = useState(true);
  // Ручной выбор ветвей кликом по схеме (окно остаётся открытым)
  const [picking, setPicking] = useState(false);
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
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(autoTrace, [fanId, thr]);

  // Состав канала: ветвь в списке — убрать, нет — добавить.
  // Ветвь вентилятора из канала не убирается.
  function toggleBranch(id: string) {
    if (id === fanId) return;
    setRouteIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }
  const toggleRef = useRef(toggleBranch);
  toggleRef.current = toggleBranch;
  useEffect(() => {
    if (!branchPickRef) return;
    branchPickRef.current = picking ? (id: string) => toggleRef.current(id) : null;
    return () => { branchPickRef.current = null; };
  }, [picking, branchPickRef]);

  const routeOrdered = useMemo(() => orderBranchChain(routeIds, byId, nodeById).branchIds, [routeIds, byId, nodeById]);
  const route = useMemo(() => routeOrdered.map(id => byId.get(id)).filter(Boolean) as TopoBranch[], [routeOrdered, byId]);

  // Подсветка маршрута на схеме — синхронно с составом маршрута.
  // При размонтировании блока (закрытие окна / смена вкладки) снимаем.
  const routeKey = routeIds.join("|");
  useEffect(() => {
    onHighlight?.(highlight ? routeIds : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, highlight]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onHighlight?.([]), []);
  const chain = useMemo(() => orderBranchChain(routeIds, byId, nodeById), [routeIds, byId, nodeById]);
  const rNodes = chain.nodeIds;
  const firstNode = chain.chain ? rNodes[0] : undefined;
  const lastNode = chain.chain ? rNodes[rNodes.length - 1] : undefined;
  const ends = useMemo(() => ({
    start: firstNode ? classifyEnd(firstNode, route[0]?.id, branches, nodes, thr) : ("dead" as RouteEndKind),
    end: lastNode ? classifyEnd(lastNode, route[route.length - 1]?.id, branches, nodes, thr) : ("dead" as RouteEndKind),
  }), [firstNode, lastNode, route, branches, nodes, thr]);

  // Кандидаты для продления маршрута на концах
  const candidates = (nodeId: string | undefined) =>
    nodeId ? (adj.get(nodeId) ?? []).filter(x => !routeIds.includes(x.id) && !x.isLeakage) : [];
  const startCand = candidates(firstNode);
  const endCand = candidates(lastNode);

  function extend(_side: "start" | "end", id: string) {
    setRouteIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  }
  function trim(side: "start" | "end") {
    if (route.length <= 1) return;
    const cut = side === "start" ? route[0].id : route[route.length - 1].id;
    if (cut === fanId) return;
    setRouteIds(prev => prev.filter(x => x !== cut));
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
  // КПД: по кривой, если она достоверна; иначе — из свойств вентилятора, иначе 0,7
  const etaReliable = !!nom?.etaReliable;
  const etaFan = b?.fanEfficiency && b.fanEfficiency > 0 ? (b.fanEfficiency > 1 ? b.fanEfficiency / 100 : b.fanEfficiency) : 0;
  const etaMax = etaReliable ? nom!.eta : (etaFan >= 0.3 ? etaFan : 0.7);
  const qNomOverMax = qMax > 0 && qNom > qMax * 1.001;

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

  // Рекомендуемое сечение — только по потерям давления в канале
  let sRec = 0;
  if (qNom > 0 && hNom > 0 && kLoss > 0 && kRoute > 0) {
    const target = kLoss * hNom;
    sRec = Math.pow((kRoute * qNom * qNom * PA_PER_MM_H2O) / target, 1 / 2.5);
  }
  const dEq = sRec > 0 ? Math.sqrt((4 * sRec) / Math.PI) : 0;

  // Скорости и потери при номинальной подаче
  const vNomFact = sFact > 0 ? qNom / sFact : 0;
  const vMaxFact = sFact > 0 ? qMax / sFact : 0;
  const hFact = lossAt(qNom);
  const hRec = lossAtS(sRec, qNom);
  const hSk = (RHO * vNomFact * vNomFact) / 2;
  const okSection = sFact > 0 && sRec > 0 ? sFact >= sRec * 0.98 : null;

  // Рабочая точка по расчёту сети
  const qNow = Math.abs(b?.flow ?? 0);
  const hNow = Math.abs(b?.fanPressure ?? 0);
  const ratio = qNom > 0 ? qNow / qNom : 0;
  const etaNow = curve && nom && etaReliable && qNow > 0 ? etaAt(curve, qNow / N, angle, nom.k) : 0;
  const stallOk = nom && hNow > 0 ? hNow <= 0.9 * nom.hMax : null;
  const zoneOk = qNow > 0 && qNom > 0 ? ratio >= 0.8 && ratio <= 1.15 : null;
  const etaOk = etaNow > 0 ? etaNow >= 0.9 * etaMax : null;

  // Экономика: мощность на преодоление сопротивления канала
  const T = n(hours), price = n(tariff);
  const pFact = etaMax > 0 ? (hFact * qNom) / etaMax / 1000 : 0; // кВт
  const pRec = etaMax > 0 ? (hRec * qNom) / etaMax / 1000 : 0;
  const eFact = pFact * T, eRec = pRec * T;
  const saving = Math.max(0, eFact - eRec);

  const f = (x: number, d = 2) => (x > 0 ? x.toFixed(d) : "—");
  const nodeNum = (id?: string) => (id ? nodeById.get(id)?.number || id : "?");
  const brName = (x: TopoBranch) => x.type || x.mineTypeName || `ветвь ${x.id}`;
  const endBadge = (k: RouteEndKind) => {
    const c = k === "shaft" || k === "surface" || k === "surfaceShaft" ? "#16a34a" : k === "manual" ? "#2563eb" : "#d97706";
    return <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: c, border: `1px solid ${c}55`, background: `${c}10` }}>{END_LABEL[k]}</span>;
  };

  const pctLoss = hNom > 0 && hFact > 0 ? (hFact / hNom) * 100 : 0;
  const sectionTone = okSection === false ? "red" : okSection ? "green" : "neutral";
  const pointTone = [zoneOk, etaOk, stallOk].some(x => x === false) ? "red" : [zoneOk, etaOk, stallOk].every(x => x === true) ? "green" : "neutral";
  const fmtInt = (x: number) => Math.round(x).toLocaleString("ru-RU");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11.5px]">
        <span className="font-semibold" style={{ color: C.t1 }}>Вентиляционный канал ГВУ — работа в номинальной точке</span>
        <Info text="Сечение подбирается под номинальную точку вентилятора (η = max) по потерям давления в канале — не более заданной доли напора. Скорость воздуха в канале не регламентируется и приводится для справки. Рабочая точка проверяется на устойчивость (без срыва) и на зону экономичной работы (без вибрации и перегрузки подшипников)." />
      </div>

      {/* Исходные данные */}
      <div className="grid gap-2 rounded-lg px-2.5 py-2" style={{ gridTemplateColumns: "minmax(0,2.2fr) 1fr 1fr 0.8fr 0.8fr", background: C.s1, border: `1px solid ${C.b1}` }}>
        <Field label="Вентилятор">
          <select className={INP} style={INP_STYLE} value={fanId} onChange={e => { setFanId(e.target.value); setQManual(""); }}>
            {list.length === 0 && <option value="">— нет в схеме —</option>}
            {list.map(x => <option key={x.id} value={x.id}>{label(x)}</option>)}
          </select>
        </Field>
        <Field label={<>Q<sub>ном</sub>, м³/с{qNomCurve > 0 && !qManual ? " · η max" : ""}</>}>
          <input className={INP + " text-right"} style={INP_STYLE} inputMode="decimal" value={qManual} placeholder={qNomCurve ? qNomCurve.toFixed(2) : "ввести"}
            onChange={e => setQManual(e.target.value)} />
        </Field>
        <Field label={<>Потери ≤, % H<sub>ном</sub></>}>
          <input className={INP + " text-right"} style={INP_STYLE} inputMode="decimal" value={lossPct} onChange={e => setLossPct(e.target.value)} />
        </Field>
        <Field label="Тариф, ₽/кВт·ч">
          <input className={INP + " text-right"} style={INP_STYLE} inputMode="decimal" value={tariff} onChange={e => setTariff(e.target.value)} />
        </Field>
        <Field label="Часов/год">
          <input className={INP + " text-right"} style={INP_STYLE} inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} />
        </Field>
      </div>

      {b && !curve && !qManual && (
        <Note tone="amber">У вентилятора не задана модель из справочника — введите Q<sub>ном</sub> вручную (напор берётся из расчёта сети).</Note>
      )}

      {/* Ключевые результаты */}
      <div className="grid grid-cols-4 gap-2">
        <Kpi label={<>Рекомендуемое S<sub>рек</sub></>} value={sRec > 0 ? f(sRec) : "—"} unit="м²"
          sub={sRec > 0 ? <>D<sub>экв</sub> = {f(dEq)} м · h<sub>к</sub> ≤ {f(kLoss * 100, 0)} %</> : "нет сопротивления по маршруту"} />
        <Kpi label="Наименьшее по маршруту" value={f(sFact)} unit="м²" tone={sectionTone}
          sub={okSection === false ? "меньше рекомендуемого" : okSection ? "достаточно" : narrow ? brName(narrow) : "—"} />
        <Kpi label="Потери в канале" value={f(hFact, 1)} unit="Па" tone={pctLoss > kLoss * 100 ? "red" : pctLoss > 0 ? "green" : "neutral"}
          sub={<>{pctLoss > 0 ? `${pctLoss.toFixed(1)} % H` : "—"}<sub>ном</sub> · рек. {f(hRec, 1)} Па</>} />
        <Kpi label="Экономия при S рек" value={saving > 0 ? fmtInt(saving * price) : "—"} unit={saving > 0 ? "₽/год" : undefined} tone={saving > 0 ? "green" : "neutral"}
          sub={saving > 0 ? `${fmtInt(saving)} кВт·ч/год` : "канал не хуже рекомендуемого"} />
      </div>

      {/* ─── Маршрут вентканала ─── */}
      {b && (
        <Card title="Маршрут вентканала" icon="Route"
          right={
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] mr-1" style={{ color: C.t3 }}>{route.length} ветв. · {f(totalL, 1)} м</span>
              <label className="flex items-center gap-1 text-[11px]" style={{ color: C.t3 }} title="Ветвь считается вертикальным стволом, если |угол наклона| не меньше порога">
                ствол ≥
                <input className="w-9 px-1 py-0.5 text-[11px] rounded-md text-right" style={INP_STYLE} value={vertThr} onChange={e => setVertThr(e.target.value)} />°
              </label>
              <MiniBtn onClick={() => setHighlight(h => !h)} active={highlight} title={highlight ? "Снять подсветку маршрута на схеме" : "Подсветить маршрут на схеме"}>
                <Icon name={highlight ? "Eye" : "EyeOff"} size={12} /> На схеме
              </MiniBtn>
              <MiniBtn onClick={autoTrace} title="Автотрассировка от вентилятора"><Icon name="Wand2" size={12} /> Авто</MiniBtn>
              <MiniBtn onClick={() => setShowRoute(v => !v)} title={showRoute ? "Свернуть" : "Развернуть"}>
                <Icon name={showRoute ? "ChevronUp" : "ChevronDown"} size={12} />
              </MiniBtn>
            </div>
          }>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <button onClick={() => setPicking(v => !v)} disabled={!branchPickRef}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md font-medium disabled:opacity-40"
              style={picking
                ? { background: C.accent, color: "#fff", border: `1px solid ${C.accent}` }
                : { background: C.tintBlue, color: C.accent, border: `1px solid ${C.accent}` }}
              title="Включите и щёлкайте по ветвям на схеме: щелчок добавляет ветвь в канал, повторный — убирает">
              <Icon name={picking ? "MousePointerClick" : "MousePointer2"} size={13} />
              {picking ? "Выбор на схеме: вкл — щёлкайте по ветвям" : "Выбрать ветви на схеме"}
            </button>
            {picking && (
              <MiniBtn onClick={() => setPicking(false)} title="Завершить выбор"><Icon name="Check" size={12} /> Готово</MiniBtn>
            )}
            <MiniBtn onClick={() => setRouteIds(b ? [b.id] : [])} title="Оставить в канале только ветвь вентилятора">
              <Icon name="Eraser" size={12} /> Очистить
            </MiniBtn>
            <Info text="Состав канала задаётся вручную: включите выбор и щёлкайте по ветвям на схеме, окно расчёта остаётся открытым. Ветви выстраиваются в линию автоматически. «Авто» — трассировка от вентилятора до развилки/ствола." />
          </div>
          {picking && (
            <div className="mt-1.5"><Note tone="green">Режим выбора включён: щелчок по ветви на схеме добавляет её в канал, повторный щелчок — убирает. Сейчас в канале: {route.length} ветв.</Note></div>
          )}
          {!chain.chain && route.length > 1 && (
            <div className="mt-1.5">
              <Note tone="amber">
                {chain.problem === "fork"
                  ? "Выбранные ветви образуют развилку — канал должен быть одной линией. Уберите лишние ветви."
                  : "Выбранные ветви не образуют непрерывную линию — между ними разрыв. Добавьте недостающие ветви."}
              </Note>
            </div>
          )}

          {showRoute && (
            <>
              <div className="mt-1.5">
                <RouteEndRow title="Начало" node={nodeNum(firstNode)} badge={endBadge(ends.start)}
                  cand={startCand} brName={brName} nodeNum={nodeNum} canTrim={route.length > 1 && route[0]?.id !== fanId}
                  onAdd={id => extend("start", id)} onTrim={() => trim("start")} thr={thr} />
              </div>
              <table className="w-full text-[11px] my-1">
                <thead>
                  <tr className="text-left" style={{ color: C.t4 }}>
                    <th className="font-normal py-0.5 w-5">#</th>
                    <th className="font-normal">Выработка</th>
                    <th className="font-normal">Узлы</th>
                    <th className="font-normal text-right">L, м</th>
                    <th className="font-normal text-right">S, м²</th>
                    <th className="font-normal text-right">∠°</th>
                    <th className="font-normal text-right">V<sub>ном</sub></th>
                    <th className="font-normal text-right">V<sub>max</sub></th>
                    <th className="font-normal text-right">h, Па</th>
                    <th className="w-5"></th>
                  </tr>
                </thead>
                <tbody>
                  {route.map((x, i) => {
                    const v = x.area > 0 ? qMax / x.area : 0;
                    const vn = x.area > 0 ? qNom / x.area : 0;
                    const isFan = x.id === fanId;
                    const isNarrow = narrow?.id === x.id;
                    return (
                      <tr key={x.id} className="tabular-nums" style={{ borderTop: `1px solid ${C.b1}`, background: isFan ? C.tintBlue : undefined, color: C.t1 }}>
                        <td className="py-[3px]" style={{ color: C.t4 }}>{i + 1}</td>
                        <td className="font-medium">
                          {isFan && <Icon name="Fan" size={11} className="inline mr-1" style={{ color: C.accent }} />}
                          {brName(x)}
                          {isNarrow && <span className="ml-1 text-[10px] px-1 rounded" style={{ color: C.amber, border: `1px solid ${C.amber}` }}>узкое</span>}
                        </td>
                        <td style={{ color: C.t3 }}>{chain.chain ? `${nodeNum(rNodes[i])}→${nodeNum(rNodes[i + 1])}` : `${nodeNum(x.fromId)}–${nodeNum(x.toId)}`}</td>
                        <td className="text-right">{f(x.length, 1)}</td>
                        <td className="text-right">{f(x.area)}</td>
                        <td className="text-right" style={{ color: C.t3 }}>{(x.angle ?? 0).toFixed(0)}</td>
                        <td className="text-right">{f(vn)}</td>
                        <td className="text-right" style={{ color: C.t3 }}>{f(v)}</td>
                        <td className="text-right">{f((x.resistance || 0) * qNom * qNom * PA_PER_MM_H2O, 1)}</td>
                        <td className="text-right w-5">
                          {!isFan && (
                            <button onClick={() => toggleBranch(x.id)} title="Убрать из канала" className="rounded p-0.5 hover:bg-black/5" style={{ color: C.t4 }}>
                              <Icon name="X" size={11} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <RouteEndRow title="Конец" node={nodeNum(lastNode)} badge={endBadge(ends.end)}
                cand={endCand} brName={brName} nodeNum={nodeNum} canTrim={route.length > 1 && route[route.length - 1]?.id !== fanId}
                onAdd={id => extend("end", id)} onTrim={() => trim("end")} thr={thr} />
              {chain.chain && ends.start !== "shaft" && ends.end !== "shaft" && (
                <div className="mt-1.5"><Note tone="amber">Сопряжение с подземным стволом не найдено — добавьте ветви канала до ствола (кнопка «Выбрать ветви на схеме»).</Note></div>
              )}
            </>
          )}
        </Card>
      )}

      {/* Подробности — три колонки */}
      <div className="grid grid-cols-3 gap-2">
        <Card title="Номинальная точка" icon="Target">
          <Row k="Модель" v={<span className="truncate inline-block max-w-[130px] align-bottom" title={curve?.name || b?.fanName || ""}>{curve?.name || b?.fanName || "—"}{N > 1 ? ` ×${N}` : ""}</span>} />
          <Row k={<>Q<sub>ном</sub></>} v={<>{f(qNom)} м³/с</>} />
          <Row k={<>H<sub>ном</sub></>} v={<>{f(hNom, 0)} Па</>} />
          <Row k={<>η<sub>max</sub></>} v={<>{f(etaMax * 100, 0)} %</>} color={!etaReliable && curve ? C.amber : undefined} />
          <Row k={<>Q<sub>max</sub> паспорт</>} v={<>{f(qMax)} м³/с</>} />
          {!etaReliable && curve && <div className="text-[10.5px] mt-0.5" style={{ color: C.amber }}>Кривая КПД недостоверна — принято {etaFan >= 0.3 ? "из свойств" : "0,7"}, Q<sub>ном</sub> паспортный</div>}
          {qNomOverMax && <div className="text-[10.5px] mt-0.5" style={{ color: C.red }}>Q<sub>ном</sub> больше паспортной макс. (рек. {f(qNomCurve)})</div>}
        </Card>

        <Card title="Рабочая точка" icon="Activity" right={pointTone !== "neutral" ? <Icon name={pointTone === "green" ? "CheckCircle2" : "AlertTriangle"} size={13} style={{ color: pointTone === "green" ? C.green : C.red }} /> : undefined}>
          <Row k={<>Q<sub>раб</sub> / H<sub>раб</sub></>} v={<>{f(qNow)} / {f(hNow, 0)}</>} />
          <Row k={<span title="Норма 0,8…1,15">Q<sub>раб</sub>/Q<sub>ном</sub></span>} v={<Check ok={zoneOk} text={ratio > 0 ? ratio.toFixed(2) : "—"} bad={ratio < 0.8 ? "левее номинала — вибрация, риск помпажа" : "правее номинала — перегрузка двигателя и подшипников"} />} />
          <Row k={<span title="Не менее 0,9·η max">η раб.</span>} v={<Check ok={etaOk} text={etaNow > 0 ? `${(etaNow * 100).toFixed(0)} %` : "—"} bad="неэкономичный режим" />} />
          <Row k={<span title="H раб ≤ 0,9·H max — без срыва">Запас до срыва</span>} v={<Check ok={stallOk} text={nom ? `≤ ${f(0.9 * nom.hMax, 0)} Па` : "—"} bad="зона срыва потока" />} />
          <Row k="V ном / V max" v={<>{f(vNomFact)} / {f(vMaxFact)} м/с</>} />
        </Card>

        <Card title="Энергия и потери" icon="Zap">
          <Row k="Скоростной напор" v={<>{f(hSk, 1)} Па</>} />
          <Row k="Мощность: факт" v={<>{pFact > 0 ? pFact.toFixed(1) : "—"} кВт</>} />
          <Row k="Мощность: рек." v={<>{pRec > 0 ? pRec.toFixed(1) : "—"} кВт</>} />
          <Row k="кВт·ч/год: факт" v={eFact > 0 ? fmtInt(eFact) : "—"} />
          <Row k="кВт·ч/год: рек." v={eRec > 0 ? fmtInt(eRec) : "—"} />
        </Card>
      </div>
    </div>
  );
}

function Check({ ok, text, bad }: { ok: boolean | null; text: string; bad: string }) {
  const c = ok === null ? undefined : ok ? C.green : C.red;
  return (
    <span className="inline-flex items-center gap-1" style={{ color: c }} title={ok === false ? bad : ok ? "в норме" : undefined}>
      {text}
      {ok !== null && <Icon name={ok ? "Check" : "AlertTriangle"} size={11} />}
    </span>
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
      <span className="w-12" style={{ color: C.t3 }}>{title}:</span>
      <span className="font-medium" style={{ color: C.t1 }}>узел {node}</span>
      {badge}
      <div className="ml-auto flex items-center gap-1">
        {cand.length > 0 && (
          <select className="px-1 py-0.5 text-[11px] rounded-md" style={INP_STYLE} value=""
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
          <button onClick={onTrim} title="Убрать крайнюю ветвь" className="px-1.5 py-0.5 rounded-md hover:bg-black/5" style={INP_STYLE}>
            <Icon name="Minus" size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
