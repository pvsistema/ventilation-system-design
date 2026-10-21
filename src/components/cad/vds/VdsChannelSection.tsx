// ─────────────────────────────────────────────────────────────────────────────
// Расчёт вентиляционного канала ГВУ — сечение, при котором вентилятор работает
// в НОМИНАЛЬНОЙ (оптимальной) точке: максимальный КПД, без вибрации и
// перегрузки подшипников, без срыва потока; с экономичными потерями в канале.
//
// 1. Расчётный режим: Q_расч — введённый необходимый расход, а если поле
//    пустое — РАБОЧАЯ ТОЧКА вентилятора по расчёту сети (Q_раб, H_раб).
//    При вводе Q напор H_расч — по характеристике вентилятора при этом
//    расходе (текущий угол; если расход за его пределом — ближайший угол,
//    который его даёт). Отдельно проверяется, хватит ли напора на рудник
//    (H_треб = R_сети·Q², R_сети = H_раб/Q_раб²) и какой угол для этого нужен.
//    Режим максимальной производительности — пересечение характеристики при
//    угле наибольшего расхода с характеристикой рудника.
//    Установка из N вентиляторов в параллель: H_уст(Q) = H(Q/N).
// 2. Сопротивление: R ветвей + вентсооружения + окно/перемычка ГВУ, в Н·с²/м⁸
//    (R·Q² — сразу паскали, без ×9,81 — так же считает расчёт сети).
//    S_рек: R_пер·(S_i/S)^2,5 + R_пост = k·H_расч / Q_расч².
// 3. Q_рек при фактическом сечении — наибольший Q на характеристике при
//    наибольшем угле, при котором R_канала·Q² ≤ k·H(Q); не выше паспортного max.
// 4. Рабочая точка (расчёт сети) проверяется по паспортному номиналу
//    текущего угла: 0,8 ≤ Q/Q_ном ≤ 1,15, η ≥ 0,9·η_max, H ≤ 0,9·H_max.
// 5. Экономика — в рабочем режиме: N = h_к·Q/η, факт против S_рек.
//
// Канал — это МАРШРУТ: ветвь с вентилятором + последовательные ветви до
// сопряжения с вертикальным стволом (и до поверхности с другой стороны).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import { getFanById, fanQMax, fanCurveAtAngle, fanHAngle, fanEfficiencyAngle, type FanCurve } from "@/lib/fanCurves";
import { fanWindowRkMurg } from "@/lib/bulkheads";
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
  /** Название проекта — для заголовка и имени файла выгрузки. */
  projectName?: string;
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
  const v = parseFloat(String(s).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

// Настройки расчёта сохраняются между открытиями окна и сменой вкладок
const LS_KEY = "vds.channel.settings";
function loadSettings(): { lossPct?: string; tariff?: string; hours?: string } {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}

export default function VdsChannelSection({ fans, label, branches, nodes, onHighlight, bulkheads, branchPickRef, projectName }: Props) {
  const gvu = useMemo(() => fans.filter(f => f.fanType === "ГВУ"), [fans]);
  const list = gvu.length ? gvu : fans;
  const [fanId, setFanId] = useState<string>(list[0]?.id ?? "");
  const [qManual, setQManual] = useState("");
  const [lossPct, setLossPct] = useState(() => loadSettings().lossPct ?? "5");
  const [tariff, setTariff] = useState(() => loadSettings().tariff ?? "6");
  const [hours, setHours] = useState(() => loadSettings().hours ?? "8760");
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ lossPct, tariff, hours })); } catch { /* недоступно */ }
  }, [lossPct, tariff, hours]);
  const [exporting, setExporting] = useState(false);
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
  const kRpm = curve && rpm > 0 && curve.rpmNominal > 0 ? rpm / curve.rpmNominal : 1;

  // Углы лопаток вентилятора (если есть регулирование углом)
  const angleList = curve
    ? (curve.angleCurves && curve.angleCurves.length > 0 ? curve.angleCurves.map(x => x.angle) : (curve.bladeAngles ?? []))
    : [];
  const hasAngles = angleList.length >= 2;

  // Характеристика УСТАНОВКИ из N вентиляторов в параллель — так же, как в
  // расчёте сети: каждый пропускает Q/N, напор установки H(Q/N).
  const hInst = (q: number, a: number) => (curve ? fanHAngle(curve, q / N, a, rpm) : 0);
  const etaInst = (q: number, a: number) => (curve ? fanEfficiencyAngle(curve, q / N / kRpm, a) : 0);
  const qMaxAt = (a: number) => (curve ? fanQMax(curve, a, rpm) * N : 0);

  // Угол максимальной производительности — тот, у которого наибольший
  // паспортный расход (а не просто наибольший по номеру: у пользовательских
  // характеристик крайний угол может давать меньший расход).
  const angleBest = hasAngles
    ? angleList.reduce((best, a) => (qMaxAt(a) > qMaxAt(best) ? a : best), angleList[0])
    : angle;

  // Паспортная номинальная точка при ТЕКУЩЕМ угле (η = max)
  const nom = b && curve ? nominalPoint(curve, angle, rpm) : null;
  const qNom = nom ? nom.q * N : 0;
  const hNom = nom ? hInst(qNom, angle) : 0;
  const etaReliable = !!nom?.etaReliable;
  const etaFan = b?.fanEfficiency && b.fanEfficiency > 0 ? (b.fanEfficiency > 1 ? b.fanEfficiency / 100 : b.fanEfficiency) : 0;
  const etaMax = etaReliable ? nom!.eta : (etaFan >= 0.3 ? etaFan : 0.7);
  const qMaxNow = qMaxAt(angle);
  const hMaxInst = nom ? nom.hMax : 0;

  // ── Рабочая точка по расчёту сети ──
  const qNow = Math.abs(b?.flow ?? 0);
  const hNow = Math.abs(b?.fanPressure ?? 0);
  // Характеристика сети, на которую работает вентилятор: H = R_сети·Q².
  // По ней определяется напор при любом другом расходе (рудник требует
  // больше депрессии при большем расходе).
  const rNet = qNow > 0.01 && hNow > 0 ? hNow / (qNow * qNow) : 0;

  // ── Режим 1: расчётный расход ──
  // Пусто — рабочая точка по расчёту сети (Q_раб, H_раб). Введён вручную —
  // напор, который вентилятор развивает при этом расходе по своей
  // характеристике: при текущем угле, а если расход за его паспортным
  // пределом — при ближайшем угле, который этот расход обеспечивает.
  const qManualV = n(qManual);
  const qDesign = qManualV > 0 ? qManualV : qNow;
  const angleForQ = (() => {
    if (!curve || !(qDesign > 0)) return null;
    const cand = (hasAngles ? angleList : [angle]).filter(a => qDesign <= qMaxAt(a) * 1.001);
    if (cand.length === 0) return null;
    return cand.reduce((m, a) => (Math.abs(a - angle) < Math.abs(m - angle) ? a : m), cand[0]);
  })();
  const angleDesign = angleForQ ?? angle;
  const hDesign = qManualV > 0
    ? (curve ? hInst(qDesign, angleDesign) : hNow)
    : hNow;
  // Хватит ли напора на рудник: требуемая депрессия при Q_расч — R_сети·Q²
  const hNeedNet = rNet > 0 && qDesign > 0 ? rNet * qDesign * qDesign : 0;
  const angleForDesign = (() => {
    if (!curve || !(qDesign > 0 && hNeedNet > 0)) return angleForQ;
    const cand = (hasAngles ? angleList : [angle]).filter(a => qDesign <= qMaxAt(a) * 1.001 && hInst(qDesign, a) >= hNeedNet * 0.98);
    if (cand.length === 0) return null;
    return cand.reduce((m, a) => (Math.abs(a - angle) < Math.abs(m - angle) ? a : m), cand[0]);
  })();
  const designReachable = !curve || angleForDesign !== null;

  // ── Режим 2: максимальная производительность в этой сети ──
  // Пересечение характеристики вентилятора при угле максимальной
  // производительности с характеристикой сети R_сети·Q².
  const qMaxDesign = curve ? qMaxAt(angleBest) : 0;
  const qMaxNet = (() => {
    if (!curve) return 0;
    if (!(rNet > 0)) return qMaxDesign;
    const g = (q: number) => hInst(q, angleBest) - rNet * q * q;
    if (g(qMaxDesign) >= 0) return qMaxDesign;
    let lo = 0, hi = qMaxDesign;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (g(m) >= 0) lo = m; else hi = m; }
    return lo;
  })();
  const hMaxNet = curve ? hInst(qMaxNet, angleBest) : 0;

  const kLoss = n(lossPct) / 100;

  // ── Сопротивление канала ──
  // R ветвей хранится в Н·с²/м⁸ (как в расчёте сети): R·Q² — сразу паскали.
  // Переменная часть (выработки с известным сечением) пересчитывается при
  // смене сечения: R(S) = R·(S_i/S)^2,5. Постоянная — вентсооружения на
  // ветвях, окно ГВУ, перемычка ГВУ и выработки без сечения.
  const fanFixedR = (() => {
    if (!b || (b.fanInstall ?? "Внутри перемычки") !== "Внутри перемычки") return 0;
    const autoWin = curve && curve.diameter > 0 ? (Math.PI * curve.diameter * curve.diameter) / 4 : 0;
    const winA = (b.fanWindowArea ?? 0) > 0.001 ? (b.fanWindowArea ?? 0) : autoWin;
    return (winA > 0.001 ? fanWindowRkMurg(winA, b.area ?? 0) : 0) + (b.fanCrossingR ?? 0) / 1000;
  })();
  const bkR = (x: TopoBranch) => bulkheads?.get(x.id)?.rKmu ?? 0;
  const rFull = (x: TopoBranch) => (x.resistance || 0) + bkR(x) + (x.id === fanId ? fanFixedR : 0);

  const withArea = route.filter(x => x.area > 0);
  const narrow = withArea.reduce<TopoBranch | undefined>((m, x) => (!m || x.area < m.area ? x : m), undefined);
  const sFact = narrow?.area ?? b?.area ?? 0;
  const totalL = route.reduce((s, x) => s + (x.length || 0), 0);
  const totalR = route.reduce((s, x) => s + rFull(x), 0);
  const rFixed = route.reduce((s, x) => s + rFull(x) - (x.area > 0 ? x.resistance || 0 : 0), 0);
  const kRoute = withArea.reduce((s, x) => s + (x.resistance || 0) * Math.pow(x.area, 2.5), 0);
  const lossAt = (q: number) => totalR * q * q;
  const rAtS = (S: number) => (S > 0 ? kRoute / Math.pow(S, 2.5) : 0) + rFixed;
  const lossAtS = (S: number, q: number) => rAtS(S) * q * q;

  // Сечение, при котором потери в канале = k·H при расходе q
  type SecRes = { s: number; why: "" | "impossible" | "noQ" | "noH" | "noR" | "noK" };
  const sectionFor = (q: number, h: number): SecRes => {
    if (!(q > 0)) return { s: 0, why: "noQ" };
    if (!(h > 0)) return { s: 0, why: "noH" };
    if (!(kLoss > 0)) return { s: 0, why: "noK" };
    if (!(kRoute > 0)) return { s: 0, why: "noR" };
    const rAllowed = (kLoss * h) / (q * q) - rFixed;
    if (rAllowed <= 0) return { s: 0, why: "impossible" };
    return { s: Math.pow(kRoute / rAllowed, 1 / 2.5), why: "" };
  };
  const whyText: Record<SecRes["why"], string> = {
    "": "",
    impossible: "сооружения на канале сами дают потери больше допустимых",
    noQ: "нет расхода — выполните расчёт сети или введите Q",
    noH: "нет напора — выполните расчёт сети",
    noR: "у ветвей канала нет сопротивления или сечения",
    noK: "задайте допустимые потери, %",
  };
  const recMax = sectionFor(qDesign, hDesign);
  const sRec = recMax.s;
  const recTop = sectionFor(qMaxNet, hMaxNet);
  const sRecTop = recTop.s;
  const dEq = sRec > 0 ? Math.sqrt((4 * sRec) / Math.PI) : 0;
  const dEqTop = sRecTop > 0 ? Math.sqrt((4 * sRecTop) / Math.PI) : 0;
  const okTop = sFact > 0 && sRecTop > 0 ? sFact >= sRecTop * 0.98 : null;
  const okSection = sFact > 0 && sRec > 0 ? sFact >= sRec * 0.98 : null;

  // Рекомендуемая производительность при фактическом сечении: наибольший
  // расход на характеристике (наибольший угол), при котором потери в канале
  // не превышают k·H. Ограничена паспортным максимумом вентилятора.
  const qRecFact = (() => {
    if (!(totalR > 0 && kLoss > 0)) return { q: 0, by: "" as "" | "fan" | "channel" };
    if (!curve) {
      const h = Math.abs(b?.fanPressure ?? 0);
      return { q: h > 0 ? Math.sqrt((kLoss * h) / totalR) : 0, by: "channel" as const };
    }
    const g = (q: number) => kLoss * hInst(q, angleBest) - totalR * q * q;
    if (qMaxDesign <= 0) return { q: 0, by: "" as const };
    if (g(qMaxDesign) >= 0) return { q: qMaxDesign, by: "fan" as const };
    let lo = 0, hi = qMaxDesign;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (g(m) >= 0) lo = m; else hi = m; }
    return { q: lo, by: "channel" as const };
  })();

  // Проверки рабочей точки — против ПАСПОРТНОГО номинала текущего угла
  const ratio = qNom > 0 ? qNow / qNom : 0;
  const etaNow = curve && etaReliable && qNow > 0 ? etaInst(qNow, angle) : 0;
  const stallOk = nom && hNow > 0 ? hNow <= 0.9 * hMaxInst : null;
  const zoneOk = qNow > 0 && qNom > 0 ? ratio >= 0.8 && ratio <= 1.15 : null;
  const etaOk = etaNow > 0 ? etaNow >= 0.9 * etaMax : null;

  // Потери и скорости
  const qWork = qNow > 0 ? qNow : qDesign;
  const etaDesignRaw = curve && etaReliable && qDesign > 0 ? etaInst(qDesign, angleForDesign ?? angle) : 0;
  const etaDesign = etaDesignRaw > 0.05 ? etaDesignRaw : etaMax;
  const hFactWork = lossAt(qWork);
  const hFactDesign = lossAt(qDesign);
  const hRecDesign = lossAtS(sRec, qDesign);
  const vWork = sFact > 0 ? qWork / sFact : 0;
  const vDesign = sFact > 0 ? qDesign / sFact : 0;
  const hSk = (RHO * vWork * vWork) / 2;

  // Экономика — в фактическом режиме работы (Q_раб): мощность на потери в
  // канале при фактическом и рекомендуемом сечении.
  const etaWork = etaNow > 0.05 ? etaNow : etaMax;
  const T = n(hours), price = n(tariff);
  const sForEco = sRec > sFact ? sRec : 0;
  const pFact = etaWork > 0 ? (hFactWork * qWork) / etaWork / 1000 : 0;
  const pRec = etaWork > 0 && sForEco > 0 ? (lossAtS(sForEco, qWork) * qWork) / etaWork / 1000 : 0;
  const eFact = pFact * T, eRec = pRec * T;
  const saving = sForEco > 0 ? Math.max(0, eFact - eRec) : 0;
  const costFact = eFact * price;
  const costRec = eRec * price;
  const savingRub = saving * price;

  const f = (x: number, d = 2) => (x > 0 ? x.toFixed(d) : "—");
  const nodeNum = (id?: string) => (id ? nodeById.get(id)?.number || id : "?");
  const brName = (x: TopoBranch) => x.type || x.mineTypeName || `ветвь ${x.id}`;
  const endBadge = (k: RouteEndKind) => {
    const c = k === "shaft" || k === "surface" || k === "surfaceShaft" ? "#16a34a" : k === "manual" ? "#2563eb" : "#d97706";
    return <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: c, border: `1px solid ${c}55`, background: `${c}10` }}>{END_LABEL[k]}</span>;
  };

  const pctWork = hNow > 0 && hFactWork > 0 ? (hFactWork / hNow) * 100 : 0;
  const sectionTone = okSection === false ? "red" : okSection ? "green" : "neutral";
  const pointTone = [zoneOk, etaOk, stallOk].some(x => x === false) ? "red" : [zoneOk, etaOk, stallOk].every(x => x === true) ? "green" : "neutral";
  const angleTxt = (a: number) => `${a > 0 ? "+" : ""}${Number(a.toFixed(1))}°`;
  const fmtInt = (x: number) => Math.round(x).toLocaleString("ru-RU");

  async function doExport() {
    if (!b) return;
    setExporting(true);
    try {
      const warnings: string[] = [];
      if (!chain.chain && route.length > 1) warnings.push(chain.problem === "fork" ? "Выбранные ветви образуют развилку — канал должен быть одной линией." : "Выбранные ветви не образуют непрерывную линию (разрыв).");
      if (chain.chain && ends.start !== "shaft" && ends.end !== "shaft") warnings.push("Сопряжение канала с подземным стволом не найдено.");
      if (qDesign > 0 && curve && !designReachable) warnings.push(`Вентилятор не обеспечит Q расч = ${qDesign.toFixed(2)} м³/с в данной сети ни при одном угле лопаток (максимум ${qMaxNet.toFixed(2)} м³/с).`);
      if (!etaReliable && curve) warnings.push("Кривая КПД вентилятора недостоверна — КПД принят из свойств вентилятора или 0,7.");
      if (zoneOk === false) warnings.push(`Рабочая точка вне зоны экономичной работы: Q раб/Q ном = ${ratio.toFixed(2)}.`);
      if (recMax.why) warnings.push(`Рекомендуемое сечение при Q расч не определено: ${whyText[recMax.why]}.`);
      const { exportVentChannelXlsx } = await import("@/lib/ventChannelExcel");
      await exportVentChannelXlsx({
        projectName: projectName ?? "",
        fanLabel: label(b),
        fanModel: curve?.name || b.fanName || "—",
        parallel: N,
        angleNow: hasAngles ? angleTxt(angle) : "—",
        angleBest: hasAngles ? angleTxt(angleBest) : "—",
        rpm: curve ? (rpm || curve.rpmNominal) : 0,
        qManual: qManualV > 0,
        kLossPct: kLoss * 100,
        tariff: price,
        hours: T,
        qNom, hNom, etaMax,
        qMaxNow, qMaxPassportBest: qMaxDesign,
        qNow, hNow, etaNow, rNet,
        ratio, zoneOk, etaOk, stallOk, hStall: 0.9 * hMaxInst,
        qDesign, hDesign, etaDesign,
        sRec, dEq, sRecNote: whyText[recMax.why],
        qMaxNet, hMaxNet, sRecTop, dEqTop, sRecTopNote: curve ? whyText[recTop.why] : "нет характеристики вентилятора",
        sFact, narrowName: narrow ? brName(narrow) : "", okSection, okTop,
        qRecFact: qRecFact.q,
        qRecFactBy: qRecFact.q <= 0 ? "" : qRecFact.by === "fan" ? "канал не ограничивает вентилятор" : "ограничено потерями в канале",
        totalL, totalR, rFixed,
        hFactWork, pctWork, hFactDesign, hRecDesign,
        vWork, vDesign, hSk,
        pFact, pRec, eFact, eRec, costFact, costRec, saving, savingRub,
        route: route.map((x, i) => ({
          name: brName(x),
          nodes: chain.chain ? `${nodeNum(rNodes[i])}→${nodeNum(rNodes[i + 1])}` : `${nodeNum(x.fromId)}–${nodeNum(x.toId)}`,
          length: x.length || 0,
          area: x.area || 0,
          angle: Math.round(x.angle ?? 0),
          rWork: x.resistance || 0,
          rFull: rFull(x),
          vWork: x.area > 0 ? qWork / x.area : 0,
          vDesign: x.area > 0 ? qDesign / x.area : 0,
          hWork: rFull(x) * qWork * qWork,
          isFan: x.id === fanId,
          isNarrow: narrow?.id === x.id,
        })),
        routeChain: chain.chain,
        startNode: nodeNum(firstNode), endNode: nodeNum(lastNode),
        startKind: END_LABEL[ends.start], endKind: END_LABEL[ends.end],
        warnings,
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11.5px]">
        <span className="font-semibold" style={{ color: C.t1 }}>Вентиляционный канал ГВУ — сечение и производительность</span>
        <Info text="Сечение подбирается так, чтобы потери давления в канале были не более заданной доли напора вентилятора. Расчётный расход — рабочая точка по расчёту сети или введённый вручную; напор при нём — по характеристике вентилятора (при введённом Q — текущий угол или ближайший, дающий этот расход). Второй вариант — максимальная производительность: пересечение характеристики вентилятора при угле наибольшего расхода с характеристикой рудника. Рекомендуемая производительность — наибольший расход, который пропускает фактический канал при тех же потерях. Сопротивление ветвей учитывается вместе с вентсооружениями и окном ГВУ, как в расчёте сети (R·Q² — сразу в паскалях). Рабочая точка проверяется по паспортному номиналу текущего угла." />
        <button onClick={doExport} disabled={!b || exporting || route.length === 0}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded-md font-medium disabled:opacity-40 hover:brightness-95"
          style={{ background: "var(--c-tint-green, #f0fdf4)", border: "1px solid #86efac", color: "var(--c-green-ink, #166534)" }}
          title="Выгрузить расчёт вентканала и методику в Excel">
          <Icon name={exporting ? "Loader2" : "FileSpreadsheet"} size={13} className={exporting ? "animate-spin" : undefined} />
          Excel
        </button>
      </div>

      {/* Исходные данные */}
      <div className="grid gap-2 rounded-lg px-2.5 py-2" style={{ gridTemplateColumns: "minmax(0,2.2fr) 1fr 1fr 0.8fr 0.8fr", background: C.s1, border: `1px solid ${C.b1}` }}>
        <Field label="Вентилятор">
          <select className={INP} style={INP_STYLE} value={fanId} onChange={e => { setFanId(e.target.value); setQManual(""); }}>
            {list.length === 0 && <option value="">— нет в схеме —</option>}
            {list.map(x => <option key={x.id} value={x.id}>{label(x)}</option>)}
          </select>
        </Field>
        <Field label={<>Q<sub>расч</sub>, м³/с{!qManual && qNow > 0 ? " · раб. точка" : ""}</>} hint="Необходимый расход для подбора сечения. Пусто — расход в рабочей точке вентилятора по расчёту сети.">
          <input className={INP + " text-right"} style={INP_STYLE} inputMode="decimal" value={qManual} placeholder={qNow > 0 ? qNow.toFixed(2) : "ввести"}
            onChange={e => setQManual(e.target.value)} />
        </Field>
        <Field label="Потери в канале ≤, % H">
          <input className={INP + " text-right"} style={INP_STYLE} inputMode="decimal" value={lossPct} onChange={e => setLossPct(e.target.value)} />
        </Field>
        <Field label="Тариф, ₽/кВт·ч">
          <input className={INP + " text-right"} style={INP_STYLE} inputMode="decimal" value={tariff} onChange={e => setTariff(e.target.value)} />
        </Field>
        <Field label="Часов/год">
          <input className={INP + " text-right"} style={INP_STYLE} inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} />
        </Field>
      </div>

      {b && !curve && qNow <= 0 && !qManual && (
        <Note tone="amber">Нет рабочей точки вентилятора — выполните расчёт сети или введите необходимый расход.</Note>
      )}

      {/* Ключевые результаты */}
      <div className="grid grid-cols-4 gap-2">
        <Kpi label={<>S<sub>рек</sub> при {qManualV > 0 ? "Q расч" : "Q раб"}</>}
          value={sRec > 0 ? f(sRec) : recMax.why === "impossible" ? "нет" : "—"} unit={sRec > 0 ? "м²" : undefined}
          tone={recMax.why === "impossible" ? "red" : sRec > 0 ? (sFact >= sRec * 0.98 ? "green" : "red") : "neutral"}
          sub={sRec > 0 ? <>{f(qDesign)} м³/с · H {f(hDesign, 0)} Па · D<sub>экв</sub> {f(dEq)} м</> : whyText[recMax.why]} />
        <Kpi label={<>S<sub>рек</sub> при Q<sub>max</sub>{hasAngles ? ` (${angleTxt(angleBest)})` : ""}</>}
          value={sRecTop > 0 ? f(sRecTop) : recTop.why === "impossible" ? "нет" : "—"} unit={sRecTop > 0 ? "м²" : undefined}
          tone={recTop.why === "impossible" ? "red" : sRecTop > 0 ? (okTop ? "green" : "amber") : "neutral"}
          sub={sRecTop > 0 ? <>{f(qMaxNet)} м³/с · {f(hMaxNet, 0)} Па · D<sub>экв</sub> {f(dEqTop)} м</> : (curve ? whyText[recTop.why] : "нет характеристики вентилятора")} />
        <Kpi label="Фактическое (наименьшее)" value={f(sFact)} unit="м²" tone={sectionTone}
          sub={okSection === false ? `меньше рекомендуемого на ${f(sRec - sFact)} м²` : okSection ? (okTop === false ? "достаточно для Q расч, мало для Q max" : "достаточно") : narrow ? brName(narrow) : "—"} />
        <Kpi label={<>Q<sub>рек</sub> при факт. сечении</>} value={f(qRecFact.q)} unit={qRecFact.q > 0 ? "м³/с" : undefined}
          tone={qRecFact.q <= 0 ? "neutral" : qRecFact.by === "fan" ? "green" : qDesign > qRecFact.q * 1.001 ? "red" : "amber"}
          sub={qRecFact.q <= 0 ? "—" : qRecFact.by === "fan" ? "канал не ограничивает вентилятор" : `ограничено каналом · ${f(qRecFact.q * 60, 0)} м³/мин`} />
      </div>
      {qDesign > 0 && curve && !designReachable && (
        <Note tone="red">
          {angleForQ === null
            ? <>Q<sub>расч</sub> = {f(qDesign)} м³/с больше паспортного максимума вентилятора ({f(qMaxDesign)} м³/с) — точка вне характеристики, сечение рассчитано по напору на краю характеристики справочно.</>
            : <>Рудник при Q<sub>расч</sub> = {f(qDesign)} м³/с требует депрессии ≈ {f(hNeedNet, 0)} Па — вентилятор не разовьёт её ни при одном угле (максимум в этой сети {f(qMaxNet)} м³/с). Нужно снизить сопротивление сети или другой вентилятор.</>}
        </Note>
      )}
      {qManualV > 0 && curve && designReachable && angleForDesign !== null && hasAngles && angleForDesign !== angle && (
        <Note tone="amber">Для Q<sub>расч</sub> = {f(qDesign)} м³/с в этой сети нужен угол лопаток {angleTxt(angleForDesign)} (сейчас {angleTxt(angle)}).</Note>
      )}

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
                    <th className="font-normal text-right">R</th>
                    <th className="font-normal text-right">V<sub>раб</sub></th>
                    <th className="font-normal text-right">V<sub>расч</sub></th>
                    <th className="font-normal text-right">h<sub>раб</sub>, Па</th>
                    <th className="w-5"></th>
                  </tr>
                </thead>
                <tbody>
                  {route.map((x, i) => {
                    const v = x.area > 0 ? qDesign / x.area : 0;
                    const vn = x.area > 0 ? qWork / x.area : 0;
                    const rx = rFull(x);
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
                        <td className="text-right" style={{ color: C.t3 }} title={rx !== (x.resistance || 0) ? `выработка ${(x.resistance || 0).toFixed(5)} + сооружения/окно ${(rx - (x.resistance || 0)).toFixed(5)}` : undefined}>
                          {rx > 0 ? rx.toFixed(4) : "—"}{rx !== (x.resistance || 0) ? "*" : ""}
                        </td>
                        <td className="text-right">{f(vn)}</td>
                        <td className="text-right" style={{ color: C.t3 }}>{f(v)}</td>
                        <td className="text-right">{f(rx * qWork * qWork, 1)}</td>
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
        <Card title="Вентилятор" icon="Fan">
          <Row k="Модель" v={<span className="truncate inline-block max-w-[130px] align-bottom" title={curve?.name || b?.fanName || ""}>{curve?.name || b?.fanName || "—"}{N > 1 ? ` ×${N}` : ""}</span>} />
          {hasAngles && <Row k="Угол: текущий / max Q" v={`${angleTxt(angle)} / ${angleTxt(angleBest)}`} />}
          <Row k={<>Q<sub>ном</sub> / H<sub>ном</sub></>} v={<>{f(qNom)} / {f(hNom, 0)}</>} />
          <Row k={<>η<sub>max</sub></>} v={<>{f(etaMax * 100, 0)} %</>} color={!etaReliable && curve ? C.amber : undefined} />
          <Row k={<>Q<sub>max</sub> при текущем угле</>} v={<>{f(qMaxNow)} м³/с</>} />
          {hasAngles && <Row k={<>Q<sub>max</sub> паспорт {angleTxt(angleBest)}</>} v={<>{f(qMaxDesign)} м³/с</>} />}
          <Row k={<>Q<sub>max</sub> в этой сети</>} v={<>{f(qMaxNet)} м³/с</>} bold />
          <Row k={<>H / η при Q<sub>расч</sub></>} v={<>{f(hDesign, 0)} Па / {f(etaDesign * 100, 0)} %</>} />
          {!etaReliable && curve && <div className="text-[10.5px] mt-0.5" style={{ color: C.amber }}>Кривая КПД недостоверна — принято {etaFan >= 0.3 ? "из свойств" : "0,7"}, Q<sub>ном</sub> паспортный</div>}
        </Card>

        <Card title="Рабочая точка" icon="Activity" right={pointTone !== "neutral" ? <Icon name={pointTone === "green" ? "CheckCircle2" : "AlertTriangle"} size={13} style={{ color: pointTone === "green" ? C.green : C.red }} /> : undefined}>
          <Row k={<>Q<sub>раб</sub> / H<sub>раб</sub></>} v={<>{f(qNow)} / {f(hNow, 0)}</>} />
          <Row k={<span title="К паспортному номиналу текущего угла. Норма 0,8…1,15">Q<sub>раб</sub>/Q<sub>ном</sub></span>} v={<Check ok={zoneOk} text={ratio > 0 ? ratio.toFixed(2) : "—"} bad={ratio < 0.8 ? "левее номинала — вибрация, риск помпажа" : "правее номинала — перегрузка двигателя и подшипников"} />} />
          <Row k={<span title="Не менее 0,9·η max">η раб.</span>} v={<Check ok={etaOk} text={etaNow > 0 ? `${(etaNow * 100).toFixed(0)} %` : "—"} bad="неэкономичный режим" />} />
          <Row k={<span title="H раб ≤ 0,9·H max установки — без срыва">Запас до срыва</span>} v={<Check ok={stallOk} text={nom ? `≤ ${f(0.9 * hMaxInst, 0)} Па` : "—"} bad="зона срыва потока" />} />
          <Row k="V раб / V расч" v={<>{f(vWork)} / {f(vDesign)} м/с</>} />
        </Card>

        <Card title="Энергия и потери" icon="Zap">
          <Row k={<>Потери в канале при Q<sub>раб</sub></>} v={<>{f(hFactWork, 1)} Па{pctWork > 0 ? ` · ${pctWork.toFixed(1)} %` : ""}</>} color={pctWork > kLoss * 100 ? C.red : undefined} />
          <Row k="Скоростной напор (раб)" v={<>{f(hSk, 1)} Па</>} />
          <Row k={<span title="H = R·Q² — характеристика рудника по рабочей точке">R сети (рудника)</span>} v={rNet > 0 ? rNet.toFixed(5) : "—"} />
          <Row k={<>h при Q<sub>расч</sub>: факт / рек.</>} v={<>{f(hFactDesign, 0)} / {f(hRecDesign, 0)} Па</>} />
          <Row k="Мощность на потери: факт" v={<>{pFact > 0 ? pFact.toFixed(1) : "—"} кВт</>} />
          <Row k="Затраты на потери: факт" v={costFact > 0 ? <>{fmtInt(costFact)} ₽/год</> : "—"} />
          {sForEco > 0 && <Row k="Затраты при S рек" v={costRec > 0 ? <>{fmtInt(costRec)} ₽/год</> : "—"} />}
          <Row k="Экономия при S рек" bold color={saving > 0 ? C.green : undefined}
            v={saving > 0 ? <>{fmtInt(savingRub)} ₽/год</> : "— канал достаточен"} />
          <div className="text-[10.5px] text-right" style={{ color: C.t3 }}>
            {saving > 0 ? <>{fmtInt(saving)} кВт·ч/год · {fmtInt(eFact)} → {fmtInt(eRec)} · </> : <>{fmtInt(eFact)} кВт·ч/год · </>}
            тариф {price > 0 ? price.toLocaleString("ru-RU") : "—"} ₽/кВт·ч
          </div>
        </Card>
      </div>
      <div className="flex items-start gap-1 text-[10.5px] leading-snug" style={{ color: C.t4 }}>
        <Icon name="Info" size={11} className="mt-[1px] shrink-0" />
        Местные потери (повороты, вход/выход, диффузор) учитываются, только если заданы в свойствах ветвей. * — R ветви включает вентсооружения или окно ГВУ.
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
