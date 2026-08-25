// ─────────────────────────────────────────────────────────────────────────────
// explosionModeRun.ts — расчёт последствий взрыва по схеме.
//
// Вынесено ИЗ ОБРАБОТЧИКА КНОПКИ в Cad.tsx. Логика перенесена дословно:
// формулы Садовского и ФНиП 494, коэффициенты, пороги и порядок шагов
// не менялись.
//
// Зачем вынесено: 200 строк расчёта жили прямо внутри кнопки ленты, вперемешку
// с оформлением. Теперь это самостоятельная функция: на вход — схема и очаги,
// на выход — обновлённые выработки и параметры волны. Ничего не рисует.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import {
  calcExplosion,
  type ExplosionResult, type ExplosionMethod, type ExplosionSourceType,
} from "@/lib/explosionCalculator";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";

export interface ExplosionRunParams {
  branches: TopoBranch[];
  nodes: TopoNode[];
  /** Значки схемы — из них берётся давление разрушения перемычки. */
  symbols: SchemaSymbol[];
  /** id значков перемычек. */
  bulkheadSymbolIds: Set<string>;
  /** Адрес серверного расчёта взрыва. */
  explosionUrl: string;
}

export interface ExplosionRunResult {
  /** Выработки с параметрами взрыва и отметкой разрушенных перемычек. */
  branches: TopoBranch[];
  /** Результаты по каждому очагу взрыва. */
  results: ExplosionResult[];
}

/**
 * Расчёт воздушной ударной волны и разрушенных перемычек.
 *
 * Сначала все очаги уходят ОДНИМ запросом на сервер; если связи нет — каждый
 * взрыв считается на месте. Затем расстояние от очага по выработкам ищется
 * алгоритмом Дейкстры, и перемычки, где давление превысило прочность,
 * помечаются разрушенными.
 */
export async function runExplosionMode(p: ExplosionRunParams): Promise<ExplosionRunResult | null> {
  const { branches, nodes, symbols, bulkheadSymbolIds, explosionUrl } = p;

  const expBranches = branches.filter(b => b.hasExplosion);
  if (expBranches.length === 0) return null;

  const results: ExplosionResult[] = [];

  // Узлы по id — расстояния и координаты ниже запрашиваются в циклах,
  // а перебор всего списка на каждый запрос заметно тормозил расчёт
  // на больших схемах.
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // ЭКОНОМИЯ ОБРАЩЕНИЙ. Раньше на КАЖДОЕ место взрыва уходил
  // отдельный запрос: пять очагов на схеме — пять обращений к
  // серверу при каждом нажатии «Рассчитать». Теперь все очаги
  // уходят ОДНИМ запросом и возвращаются одним ответом.
  const expPayload = expBranches.map(b => ({
    method: b.explosionMethod ?? "fnip_494",
    sourceType: b.explosionSourceType ?? "mass",
    gasId: b.explosionGasId ?? "methane",
    gasVolume_m3: b.explosionGasVolume ?? 100,
    gasConcentration: b.explosionGasConcentration ?? 9.5,
    explosiveId: b.explosionExplosiveId ?? "ammonit",
    explosiveMass_kg: b.explosionExplosiveMass ?? 100,
    excavationArea_m2: b.area ?? 12,
    excavationLength_m: b.length ?? 100,
    ambientPressure_kPa: 101.3,
    considerWalls: b.explosionConsiderWalls ?? true,
  }));
  // Ответы сервера по номеру ветви. Если связи нет — карта пустая,
  // и каждый взрыв считается на месте (резервный расчёт ниже).
  const expServerData = new Map<string, ExplosionResult>();
  try {
    const respAll = await fetch(explosionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: expPayload }),
    });
    const dataAll = await respAll.json();
    const arr = Array.isArray(dataAll?.results) ? dataAll.results : [];
    expBranches.forEach((b, i) => {
      if (arr[i]) expServerData.set(b.id, arr[i]);
    });
  } catch { /* нет связи — посчитаем на месте */ }

  const updatedBranchesPromises = branches.map(async b => {
    if (!b.hasExplosion) return b;
    const area = b.area ?? 12;
    const length = b.length ?? 100;
    let res: ExplosionResult;
    try {
      const data = expServerData.get(b.id);
      if (!data) throw new Error("no server data");
      // Восстанавливаем pressureAtDistance / impulseAtDistance по формуле Садовского
      // напрямую из q_tnt_kg и wall_factor (не зависит от таблицы точек)
      const _qTnt = data.q_tnt_kg ?? 0.001;
      const _considerWalls = b.explosionConsiderWalls ?? true;
      const _wfRaw = area <= 0 ? 1.5 : area < 10 ? 2.0 : area < 20 ? 1.8 : area < 40 ? 1.5 : 1.3;
      const _wf   = _considerWalls ? _wfRaw : 1.0;
      const _meth = b.explosionMethod ?? "gas_dynamics";
      // Формулы согласованы с explosionCalculator.ts
      const sadovsky = (r: number): number => {
        if (_qTnt <= 0 || r <= 0) return 0;
        const rBar = r / Math.pow(_qTnt, 1 / 3);
        if (rBar < 0.1) return 10000;
        // P0 НЕ умножаем — коэффициенты уже в кПа (Садовский)
        return Math.round((0.84 / rBar + 2.7 / (rBar * rBar) + 7.15 / (rBar * rBar * rBar)) * 10) / 10;
      };
      const fnip494 = (r: number): number => {
        if (_qTnt <= 0 || r <= 0) return 0;
        // Коэф. 1.5 согласован с Аэросетью (ВНИМИ) для горных выработок
        return Math.round(1.5 * Math.pow(_qTnt / (r * r * r), 1 / 3) * 101.3 * 10) / 10;
      };
      res = {
        ...data,
        pressureAtDistance: (r: number) => {
          const dp = _meth === "gas_dynamics" ? sadovsky(r) : fnip494(r);
          return Math.round(dp * _wf * 10) / 10;
        },
        impulseAtDistance: (r: number) => {
          if (_qTnt <= 0 || r <= 0) return 0;
          return Math.round(200 * Math.pow(_qTnt, 1 / 3) / r * _wf * 10) / 10;
        },
      };
    } catch {
      res = calcExplosion({
        method: (b.explosionMethod ?? "fnip_494") as ExplosionMethod,
        sourceType: (b.explosionSourceType ?? "mass") as ExplosionSourceType,
        gasId: b.explosionGasId ?? "methane",
        gasVolume_m3: b.explosionGasVolume ?? 100,
        gasConcentration: b.explosionGasConcentration ?? 9.5,
        explosiveId: b.explosionExplosiveId ?? "ammonit",
        explosiveMass_kg: b.explosionExplosiveMass ?? 100,
        excavationArea_m2: area,
        excavationLength_m: length,
        ambientPressure_kPa: 101.3,
        considerWalls: b.explosionConsiderWalls ?? true,
      });
    }
    results.push(res);
    return {
      ...b,
      explosionComputedQtnt: res.q_tnt_kg,
      explosionComputedMaxP: res.maxDeltaP_kPa,
      explosionComputedWaveSpeed: res.waveFrontSpeed_ms,
      explosionComputedR_lethal: res.zones[0]?.radius_m ?? 0,
      explosionComputedR_heavy: res.zones[1]?.radius_m ?? 0,
      explosionComputedR_medium: res.zones[2]?.radius_m ?? 0,
      explosionComputedR_light: res.zones[3]?.radius_m ?? 0,
    };
  });
  const updatedBranches = await Promise.all(updatedBranchesPromises);

  // ── Определяем разрушенные перемычки по зонам поражения ──────────
  // Дейкстра по сети для расчёта расстояния по выработкам от источника
  const bLen = (b: TopoBranch) => {
    const fN = nodeById.get(b.fromId);
    const tN = nodeById.get(b.toId);
    if (!fN || !tN) return b.length > 0 ? b.length : 1;
    return Math.sqrt((tN.x-fN.x)**2+(tN.y-fN.y)**2+(tN.z-fN.z)**2) || (b.length > 0 ? b.length : 1);
  };
  const netDist = new Map<string, number>();
  const pq2: Array<{id: string; d: number}> = [];
  updatedBranches.forEach(src => {
    if (!src.hasExplosion || src.explosionComputedMaxP <= 0) return;
    const len = bLen(src); const t = src.explosionT ?? 0.5;
    ([[src.fromId, len*t],[src.toId, len*(1-t)]] as Array<[string, number]>).forEach(([nid, d]) => {
      const cur = netDist.get(nid) ?? Infinity;
      if (d < cur) { netDist.set(nid, d); pq2.push({id: nid, d}); }
    });
  });
  const adjMap = new Map<string, Array<{to: string; len: number}>>();
  updatedBranches.forEach(b => {
    const len = bLen(b);
    if (!adjMap.has(b.fromId)) adjMap.set(b.fromId, []);
    if (!adjMap.has(b.toId))   adjMap.set(b.toId, []);
    adjMap.get(b.fromId)!.push({to: b.toId, len});
    adjMap.get(b.toId)!.push({to: b.fromId, len});
  });
  const vis2 = new Set<string>();
  while (pq2.length > 0) {
    pq2.sort((a,b) => a.d - b.d);
    const {id: cur, d: curD} = pq2.shift()!;
    if (vis2.has(cur)) continue; vis2.add(cur);
    for (const e of (adjMap.get(cur) ?? [])) {
      const nd = curD + e.len;
      // Волна останавливается на атмосферных узлах (выход на поверхность)
      const toNode = nodeById.get(e.to);
      if (toNode?.atmosphereLink) continue;
      if (nd < (netDist.get(e.to) ?? Infinity)) { netDist.set(e.to, nd); pq2.push({id: e.to, d: nd}); }
    }
  }

  // Помечаем перемычки разрушенными если ΔP > failurePressure
  // fp берём из символа (bkFailurePressure) или из ветви как fallback
  const finalBranches = updatedBranches.map(b => {
    if (!b.hasBulkhead) return {...b, bulkheadDestroyedByExplosion: false};
    const bkSym = symbols.find(s =>
      bulkheadSymbolIds.has(s.typeId) && s.branchId === b.id
    );
    // давление разрушения: из символа (если задано > 0) или из ветви (из справочника)
    const fp = (bkSym?.bkFailurePressure && bkSym.bkFailurePressure > 0
      ? bkSym.bkFailurePressure
      : b.bulkheadFailurePressure) || 0; // МПа
    if (!fp || fp <= 0) return {...b, bulkheadDestroyedByExplosion: false};
    const dFrom = netDist.get(b.fromId) ?? Infinity;
    const dTo   = netDist.get(b.toId) ?? Infinity;
    const minD  = Math.min(dFrom, dTo);
    if (minD === Infinity || results.length === 0) return {...b, bulkheadDestroyedByExplosion: false};
    const dp_kPa = results[0].pressureAtDistance(minD);
    const dp_MPa = dp_kPa / 1000;
    const destroyed = dp_MPa >= fp;
    return {...b, bulkheadDestroyedByExplosion: destroyed};
  });

  return { branches: finalBranches, results };
}
