// ─────────────────────────────────────────────────────────────────────────────
// explosionModeRun.ts — расчёт последствий взрыва по схеме.
//
// Вынесено ИЗ ОБРАБОТЧИКА КНОПКИ в Cad.tsx. Логика перенесена дословно:
// формула Садовского, коэффициенты, пороги и порядок шагов совпадают
// с explosionCalculator.ts.
//
// Зачем вынесено: 200 строк расчёта жили прямо внутри кнопки ленты, вперемешку
// с оформлением. Теперь это самостоятельная функция: на вход — схема и очаги,
// на выход — обновлённые выработки и параметры волны. Ничего не рисует.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import {
  calcExplosion, GAS_TYPES, wallReflectionFactor, type ExplosionThresholds,
  type ExplosionResult, type ExplosionSourceType,
  channelPressureAt, channelImpulseAt, channelDecay, LAMBDA_DEFAULT,
  gasChannelPressureAt, gasChannelImpulseAt, junctionTransmission,
} from "@/lib/explosionCalculator";

/**
 * Концентрация по умолчанию — стехиометрическая для ВЫБРАННОГО вещества.
 * Единая константа 9.5 здесь не годится: у газов это проценты объёма,
 * у угольной пыли — г/м³, и 9.5 г/м³ лежит ниже НПВ (30 г/м³), то есть
 * расчёт молча вернул бы ноль.
 */
function defaultConc(gasId: string | undefined): number {
  return GAS_TYPES.find(g => g.id === (gasId ?? "methane"))?.stoichConc ?? 9.5;
}
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { withLicense } from "@/lib/license";
import { calcGasZone, gasZoneTime, DEFAULT_I_NEPOGASH } from "@/lib/gasZone";
import { collectBarriers, crossBarriers, type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";

export interface ExplosionRunParams {
  branches: TopoBranch[];
  nodes: TopoNode[];
  /** Значки схемы — из них берётся давление разрушения перемычки. */
  symbols: SchemaSymbol[];
  /** id значков перемычек. */
  bulkheadSymbolIds: Set<string>;
  /** Адрес серверного расчёта взрыва. */
  explosionUrl: string;
  /** Пороги зон поражения из справочника. */
  thresholds?: ExplosionThresholds;
  /**
   * Расчёт ведётся в ходе ликвидации аварии (РБ №343, п. 12).
   *
   * Влияет на время загазирования: при ПЛА это 60 мин, при ликвидации аварии —
   * фактическое, но не менее 150 мин. Разница в зоне выходит в 2,5 раза, а
   * значит и в энергии взрыва.
   */
  duringEmergency?: boolean;
  /** Фактическое время загазирования, мин (п. 12); учитывается при аварии. */
  gasZoneTimeFactual?: number;
  /**
   * Считать ТОЛЬКО на месте, не обращаясь к серверу.
   *
   * ЗАЧЕМ. Толщину перемычки подбирают перебором: меняют смесь, время
   * загазирования, массу ВВ — и сразу смотрят результат. Ходить на сервер на
   * каждое нажатие клавиши нельзя, да и незачем: формулы на клиенте те же
   * самые. Поэтому предварительный расчёт идёт локально, а полный (с записью
   * в схему и протокол) — как раньше, через сервер.
   *
   * Физика в обоих случаях ОДНА И ТА ЖЕ — это один и тот же код, а не вторая
   * его копия «для предпросмотра». Разойтись они не могут.
   */
  localOnly?: boolean;
}

export interface ExplosionRunResult {
  /** Выработки с параметрами взрыва и отметкой разрушенных перемычек. */
  branches: TopoBranch[];
  /** Результаты по каждому очагу взрыва. */
  results: ExplosionResult[];
  /**
   * Результат по id ветви-очага. Нужен, когда очагов несколько: раньше
   * давление на схеме и разрушение перемычек считались по ОДНОМУ
   * произвольному очагу (последнему и первому соответственно), то есть по
   * чужому заряду. Теперь у каждого очага своя функция давления.
   */
  resultByBranch: Map<string, ExplosionResult>;
  /**
   * Состояние волны в каждом узле: длина пути по выработкам, накопленный
   * множитель ослабления (трение + деление на сопряжениях) и очаг-источник.
   * Нужно схеме, чтобы окрашивать ветви по РЕАЛЬНОМУ давлению в них, а не
   * по расстоянию до очага.
   */
  netWave: Map<string, { d: number; att: number; srcId: string }>;
  /** Давление в узле по состоянию волны, кПа */
  pressureAtNode: (st: { d: number; att: number; srcId: string }) => number;
  /**
   * Что произошло с каждой перемычкой (ключ — BlastBarrier.key). Нужно схеме:
   * за устоявшей перемычкой ветвь не красится, за разрушенной — красится
   * ослабленной волной.
   */
  barrierHits: Map<string, BarrierHit>;
  /** Перемычки по ветвям — те же, по которым шёл расчёт. */
  barriers: Map<string, BlastBarrier[]>;
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
  const { branches, nodes, symbols, bulkheadSymbolIds, explosionUrl, thresholds } = p;

  const expBranches = branches.filter(b => b.hasExplosion);
  if (expBranches.length === 0) return null;

  const results: ExplosionResult[] = [];
  const resultByBranch = new Map<string, ExplosionResult>();

  /**
   * Расчёты зон загазирования по очагам — чтобы показать их в протоколе.
   *
   * Без этого длина участка попадала бы в отчёт готовым числом, и проверить,
   * откуда оно взялось, было бы нельзя. Для документа, который подписывают,
   * это принципиально: видны и формула, и время, и ограничение по п. 13.
   */
  const gasZoneNotes = new Map<string, NonNullable<ReturnType<typeof calcGasZone>>>();

  /**
   * Длина загазованного участка очага, м.
   *
   * Либо расчёт по метановыделению (РБ №343, ф. 1/3/5), либо введённое руками
   * значение. Нужна в двух местах — в запросе на сервер и в резервном расчёте
   * на месте, — и оба обязаны брать ОДНО И ТО ЖЕ число: иначе схема считалась бы
   * по-разному в зависимости от того, была ли связь.
   */
  const zoneLengthOf = (b: TopoBranch): number => {
    const manual = b.explosionGasZoneLength ?? 100;
    if (!b.explosionGasZoneAuto) return manual;
    const kind = b.explosionGasZoneKind ?? "heading";
    const z = calcGasZone({
      kind,
      time_min: gasZoneTime(p.duringEmergency === true, p.gasZoneTimeFactual),
      // У непогашенной выработки методика прямо разрешает 0,5 м³/мин при
      // отсутствии фактических данных (сноска к ф. 3) — замерить дебит в
      // частично сохраняемой выработке обычно нечем.
      emission_m3min: b.explosionGasEmission
        ?? (kind === "preserved" ? DEFAULT_I_NEPOGASH : 0),
      area_m2: b.area ?? 0,
      seamThickness_m: b.explosionSeamThickness,
      caveStep_m: b.explosionCaveStep,
      // п. 13: зона не длиннее самой выработки.
      branchLength_m: b.length,
    });
    // Данных для расчёта не хватило (нет дебита метана) — остаётся ручное
    // значение. Молча подставлять ноль нельзя: очаг исчез бы вовсе.
    if (!z) return manual;
    gasZoneNotes.set(b.id, z);
    return z.length_m;
  };

  // Узлы по id — расстояния и координаты ниже запрашиваются в циклах,
  // а перебор всего списка на каждый запрос заметно тормозил расчёт
  // на больших схемах.
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // ЭКОНОМИЯ ОБРАЩЕНИЙ. Раньше на КАЖДОЕ место взрыва уходил
  // отдельный запрос: пять очагов на схеме — пять обращений к
  // серверу при каждом нажатии «Рассчитать». Теперь все очаги
  // уходят ОДНИМ запросом и возвращаются одним ответом.
  const expPayload = expBranches.map(b => ({
    // Методика одна — газодинамическая. Значение из ветви игнорируем:
    // в старых проектах там может стоять удалённый режим "fnip_494".
    method: "gas_dynamics",
    sourceType: b.explosionSourceType ?? "mass",
    gasId: b.explosionGasId ?? "methane",
    gasVolume_m3: b.explosionGasVolume ?? 100,
    // Длина загазованного участка — основной способ задания источника по газу.
    // Объём смеси считается как длина × сечение ветви (как в «Аэросети»).
    gasZoneLength_m: zoneLengthOf(b),
    gasInitialPressure_kPa: b.explosionGasP0 ?? 0,  // 0 = авторасчёт ΔP₀ по длине участка
    gasConcentration: b.explosionGasConcentration ?? defaultConc(b.explosionGasId),
    explosiveId: b.explosionExplosiveId ?? "ammonit",
    explosiveMass_kg: b.explosionExplosiveMass ?? 100,
    excavationArea_m2: b.area ?? 12,
    excavationLength_m: b.length ?? 100,
    ambientPressure_kPa: 101.3,
    considerWalls: b.explosionConsiderWalls ?? true,
    // Коэффициент участия Z по Методике №415 (0.1 открыто / 0.5 замкнуто)
    zParticipation: b.explosionZ ?? 0.5,
    thresholds,
  }));
  // Ответы сервера по номеру ветви. Если связи нет — карта пустая,
  // и каждый взрыв считается на месте (резервный расчёт ниже).
  const expServerData = new Map<string, ExplosionResult>();
  // Предварительный расчёт на сервер не ходит — см. localOnly.
  if (!p.localOnly) try {
    const respAll = await fetch(explosionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withLicense({ items: expPayload })),
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
      // Сервер сообщил, что взрыва нет (нулевой заряд или смесь вне пределов
      // взрываемости) — берём результат как есть, с нулевыми функциями.
      if (data.noExplosion) {
        res = { ...data, pressureAtDistance: () => 0, impulseAtDistance: () => 0 };
        results.push(res);
        resultByBranch.set(b.id, res);
        return {
          ...b,
          explosionComputedQtnt: 0,
          explosionComputedMaxP: 0,
          explosionComputedWaveSpeed: 0,
          explosionComputedR_lethal: 0,
          explosionComputedR_heavy: 0,
          explosionComputedR_medium: 0,
          explosionComputedR_light: 0,
        };
      }
      // Восстанавливаем pressureAtDistance / impulseAtDistance по формуле Садовского
      // напрямую из q_tnt_kg и wall_factor (не зависит от таблицы точек)
      const _qTnt = data.q_tnt_kg ?? 0;
      const _considerWalls = b.explosionConsiderWalls ?? true;
      // Коэффициент берём из ядра, а не повторяем формулу здесь: раньше это
      // была отдельная копия ступенчатого выражения, и любая правка в ядре
      // расходилась с расчётом по схеме.
      const _wf   = _considerWalls ? wallReflectionFactor(area) : 1.0;
      // Канал восстанавливаем из ответа сервера; если сервер старый и поля
      // нет — берём сечение ветви и λ по умолчанию.
      const _ch = data.channel ?? { area_m2: area, lambda: LAMBDA_DEFAULT };
      const _channelMode = data.channelMode !== false;
      // Газовый источник — протяжённый загазованный участок: волна плоская
      // с самого начала, сферическая формула Садовского не применяется.
      const _gas = data.gasSource;
      // Граница применимости формулы (r̄ = 1) — та же, что в ядре.
      const _rMin = Math.pow(_qTnt, 1 / 3);
      const sadovsky = (r: number): number => {
        if (_qTnt <= 0) return 0;
        // Ближе границы формула расходится (на 1 м от 95 кг — 72 500 кПа),
        // а прежняя отсечка `rBar < 0.1 → 10000` вносила разрыв в 73 раза.
        // Внутри границы берём значение на ней. r = 0 — тоже максимум:
        // иначе эпицентр взрыва попадал в зону «безопасно».
        const rBar = Math.max(r, _rMin) / Math.pow(_qTnt, 1 / 3);
        // Коэффициенты Садовского дают кгс/см² — переводим в кПа (×98.07)
        const dpKgf = 0.84 / rBar + 2.7 / (rBar * rBar) + 7.15 / (rBar * rBar * rBar);
        return Math.round(dpKgf * 98.07 * 10) / 10;
      };
      res = {
        ...data,
        channel: _ch,
        pressureAtDistance: (r: number) => {
          // Газ — плоская волна от загазованного участка (см. ядро)
          if (_gas) return gasChannelPressureAt(r, _gas, _ch);
          // Канальная модель — та же функция, что в ядре (единый источник правды)
          if (_channelMode && _qTnt > 0) return channelPressureAt(r, _qTnt, _ch);
          return Math.round(sadovsky(r) * _wf * 10) / 10;
        },
        impulseAtDistance: (r: number) => {
          if (_gas) return gasChannelImpulseAt(r, _gas, _ch);
          if (_qTnt <= 0) return 0;
          if (_channelMode) return channelImpulseAt(r, _qTnt, _ch);
          // Импульс по Методике №415: i = 123·m^0.66/r (Па·с).
          // Ограничен той же границей применимости — при r → 0 растёт
          // неограниченно.
          return Math.round(123 * Math.pow(_qTnt, 0.66) / Math.max(r, _rMin) * _wf * 10) / 10;
        },
      };
    } catch {
      res = calcExplosion({
        method: "gas_dynamics",
        sourceType: (b.explosionSourceType ?? "mass") as ExplosionSourceType,
        gasId: b.explosionGasId ?? "methane",
        gasVolume_m3: b.explosionGasVolume ?? 100,
        gasZoneLength_m: zoneLengthOf(b),
        gasInitialPressure_kPa: b.explosionGasP0 ?? 0,  // 0 = авторасчёт ΔP₀ по длине участка
        gasConcentration: b.explosionGasConcentration ?? defaultConc(b.explosionGasId),
        explosiveId: b.explosionExplosiveId ?? "ammonit",
        explosiveMass_kg: b.explosionExplosiveMass ?? 100,
        excavationArea_m2: area,
        excavationLength_m: length,
        ambientPressure_kPa: 101.3,
        considerWalls: b.explosionConsiderWalls ?? true,
        zParticipation: b.explosionZ ?? 0.5,
        thresholds,
      });
    }
    // Расчёт зоны загазирования — в протокол, перед остальными строками:
    // это исходная величина, от которой пляшет вся остальная цепочка.
    const gz = gasZoneNotes.get(b.id);
    if (gz && Array.isArray(res.log)) {
      res.log.unshift(
        `Зона загазирования по РБ №343, формула (${gz.formula}): ${gz.length_m} м, `
        + `${gz.volume_m3} м³ (сечение в расчёте ${gz.areaTotal_m2} м²`
        + (gz.areaCaved_m2 > 0 ? `, в т.ч. закрепное пространство ${gz.areaCaved_m2} м²` : "")
        + ")",
      );
      if (gz.clampedByLength) res.log.unshift(gz.note);
    }
    results.push(res);
    resultByBranch.set(b.id, res);
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

  // ── РАСПРОСТРАНЕНИЕ ВОЛНЫ ПО ГРАФУ ВЫРАБОТОК ──────────────────────
  //
  // Раньше здесь была Дейкстра ТОЛЬКО по расстоянию: находился кратчайший
  // путь, а давление затем бралось из сферической формулы. Получался гибрид —
  // путь мерился по выработкам, а затухание считалось как в открытом поле.
  //
  // Теперь волна ведётся по графу с НАКОПЛЕНИЕМ ЗАТУХАНИЯ на каждом ребре:
  //   • на участке длиной l давление падает как exp(−β·l), β = λ/(2·d_г),
  //     то есть узкая выработка гасит волну быстрее широкой;
  //   • на сопряжении поток делится между исходящими ветвями пропорционально
  //     их сечениям — это отдельный множитель ослабления;
  //   • на атмосферном узле волна выходит на поверхность и дальше не идёт.
  //
  // Вместо расстояния минимизируется «стоимость» = сумма затухания, поэтому
  // до точки доходит та волна, которая пришла САМОЙ СИЛЬНОЙ, а не та, что
  // прошла геометрически короткий путь через узкую сбойку.
  const bLen = (b: TopoBranch) => {
    const fN = nodeById.get(b.fromId);
    const tN = nodeById.get(b.toId);
    if (!fN || !tN) return b.length > 0 ? b.length : 1;
    return Math.sqrt((tN.x-fN.x)**2+(tN.y-fN.y)**2+(tN.z-fN.z)**2) || (b.length > 0 ? b.length : 1);
  };
  const bArea = (b: TopoBranch) => (b.area && b.area > 0 ? b.area : 12);

  /**
   * Состояние волны в узле: путь, множитель ослабления, очаг-источник и
   * узел, ИЗ которого волна пришла. Последнее нужно для деления потока:
   * назад волна не уносит энергию, поэтому входящая ветвь из деления
   * исключается — иначе в прямом штреке (два ребра в узле) волна теряла
   * бы половину энергии на каждом промежуточном узле, хотя там она просто
   * идёт насквозь.
   */
  type WaveState = { d: number; att: number; srcId: string; fromNode?: string };

  /**
   * Давление в точке, кПа: функция давления СВОЕГО очага от длины пути, к
   * которой применяется накопленный по графу множитель ослабления (трение,
   * сопряжения, пройденные перемычки). Объявлена ДО обхода: перемычки
   * проверяются прямо во время распространения волны и нуждаются в давлении.
   */
  const pressureAtNode = (st: { d: number; att: number; srcId: string }): number => {
    const res = resultByBranch.get(st.srcId) ?? results[0];
    if (!res) return 0;
    const q = res.q_tnt_kg ?? 0;
    const ch = res.channel;
    // ГАЗ: внутри загазованного участка — плато ΔP₀, снаружи затухание уже
    // накоплено в st.att при обходе графа, поэтому здесь берётся ΔP₀ × att.
    if (res.gasSource && ch) {
      const half = res.gasSource.zoneLength_m / 2;
      if (st.d <= half) return gasChannelPressureAt(st.d, res.gasSource, ch, st.att);
      return Math.round(res.gasSource.initialPressure_kPa * st.att * 10) / 10;
    }
    if (res.channelMode && ch && q > 0) {
      // Трение уже накоплено в st.att по фактическим сечениям пути, поэтому
      // берётся только ближняя (сферическая) часть — иначе трение учлось бы
      // дважды.
      const rTr = res.transitionRadius_m ?? 0;
      if (st.d <= rTr) return channelPressureAt(st.d, q, ch, st.att);
      const dpAtTr = channelPressureAt(rTr, q, ch, 1);
      return Math.round(dpAtTr * st.att * 10) / 10;
    }
    return Math.round(res.pressureAtDistance(st.d) * st.att * 10) / 10;
  };
  const pressureOf = (d: number, att: number, srcId: string) => pressureAtNode({ d, att, srcId });

  // ── ПЕРЕМЫЧКИ НА ПУТИ ВОЛНЫ ────────────────────────────────────────────
  // Раньше перемычки проверялись после расчёта и волну не останавливали.
  // Теперь при переходе волны по ветви она проходит через каждую перемычку
  // этой ветви по очереди (см. blastBarriers.ts): устоявшая волну гасит,
  // разрушенная пропускает ослабленную.
  const barriers = collectBarriers(updatedBranches, symbols, bulkheadSymbolIds);
  const barrierHits = new Map<string, BarrierHit>();
  /** Запоминаем самый сильный удар по перемычке — с какой бы стороны он ни пришёл. */
  const recordHit = (bar: BlastBarrier, hit: BarrierHit) => {
    const prev = barrierHits.get(bar.key);
    if (!prev || hit.incident_kPa > prev.incident_kPa) barrierHits.set(bar.key, hit);
  };

  const netWave = new Map<string, WaveState>();
  const pq2: Array<{ id: string } & WaveState> = [];
  // Сильнее = больше att при сопоставимом пути. Сравниваем по ослаблению.
  const pushWave = (nid: string, st: WaveState) => {
    const cur = netWave.get(nid);
    if (!cur || st.att > cur.att * 1.000001) {
      netWave.set(nid, st);
      pq2.push({ id: nid, ...st });
    }
  };

  // Старт: от точки очага до обоих концов его ветви
  updatedBranches.forEach(src => {
    if (!src.hasExplosion || src.explosionComputedMaxP <= 0) return;
    const len = bLen(src); const t = src.explosionT ?? 0.5;
    const res = resultByBranch.get(src.id);
    const rTr = res?.transitionRadius_m ?? 0;
    const betaSrc = channelDecay({ area_m2: bArea(src), lambda: LAMBDA_DEFAULT });
    // Для газа затухание начинается не от точки сшивки сферы, а от ГРАНИЦЫ
    // загазованного участка: внутри него давление постоянно и равно ΔP₀.
    const gasHalf = res?.gasSource ? res.gasSource.zoneLength_m / 2 : 0;
    const freeSpan = res?.gasSource ? gasHalf : rTr;
    // Ослабление до конца ветви-очага: за этой границей волна уже канальная,
    // поэтому от неё и считается экспоненциальное затухание.
    const attTo = (d: number) => d <= freeSpan ? 1 : Math.exp(-betaSrc * (d - freeSpan));
    const dFrom = len * t, dTo = len * (1 - t);
    // Перемычка может стоять на самой ветви очага — между очагом и узлом.
    const list = barriers.get(src.id);
    const kFrom = crossBarriers({
      list, tFrom: t, tTo: 0, len, d0: 0, attAt: attTo,
      srcId: src.id, pressureOf, onHit: recordHit,
    });
    const kTo = crossBarriers({
      list, tFrom: t, tTo: 1, len, d0: 0, attAt: attTo,
      srcId: src.id, pressureOf, onHit: recordHit,
    });
    if (kFrom > 0) pushWave(src.fromId, { d: dFrom, att: attTo(dFrom) * kFrom, srcId: src.id });
    if (kTo > 0)   pushWave(src.toId,   { d: dTo,   att: attTo(dTo) * kTo,     srcId: src.id });
  });

  // Смежность с геометрией ребра. Для каждого направления помним, откуда
  // волна входит в ветвь (0 — со стороны fromId, 1 — со стороны toId): по
  // этому порядку она и проходит перемычки ветви.
  type AdjEdge = { to: string; len: number; area: number; branchId: string; tStart: 0 | 1 };
  const adjMap = new Map<string, AdjEdge[]>();
  updatedBranches.forEach(b => {
    const len = bLen(b), area = bArea(b);
    if (!adjMap.has(b.fromId)) adjMap.set(b.fromId, []);
    if (!adjMap.has(b.toId))   adjMap.set(b.toId, []);
    adjMap.get(b.fromId)!.push({ to: b.toId,   len, area, branchId: b.id, tStart: 0 });
    adjMap.get(b.toId)!.push  ({ to: b.fromId, len, area, branchId: b.id, tStart: 1 });
  });

  const vis2 = new Set<string>();
  let guard = 0;
  while (pq2.length > 0 && guard++ < 200000) {
    // Разбираем по убыванию силы волны
    pq2.sort((a, b) => b.att - a.att);
    const { id: cur, d: curD, att: curAtt, srcId, fromNode } = pq2.shift()!;
    if (vis2.has(cur)) continue;
    vis2.add(cur);
    const edges = adjMap.get(cur) ?? [];
    // ДЕЛЕНИЕ ПОТОКА НА СОПРЯЖЕНИИ. Энергия расходится по ИСХОДЯЩИМ ветвям
    // пропорционально их сечениям. Ветвь, по которой волна пришла, в деление
    // не входит: назад энергия не уносится. Поэтому в прямом штреке (узел с
    // двумя рёбрами) волна идёт насквозь без потерь на «деление», а делится
    // только там, где выработки реально расходятся.
    const out = edges.filter(e => e.to !== fromNode);
    const outArea = out.reduce((s, e) => s + e.area, 0);
    // Сечение выработки, по которой волна пришла в этот узел
    const inArea = edges.find(e => e.to === fromNode)?.area ?? outArea;
    for (const e of out) {
      const toNode = nodeById.get(e.to);
      // Волна выходит на поверхность — дальше не идёт
      if (toNode?.atmosphereLink) continue;
      // Прохождение через сопряжение по акустической модели (см. ядро):
      // давление не делится по сечениям, а проходит с коэффициентом
      // τ = 2·S_вх/(S_вх+ΣS_исх). Прежнее линейное деление гасило волну
      // за 5-6 узлов, и окраска обрывалась в середине схемы.
      const split = junctionTransmission(inArea, outArea);
      // Затухание на трении вдоль ребра
      const beta = channelDecay({ area_m2: e.area, lambda: LAMBDA_DEFAULT });
      const attIn = curAtt * split;
      // Перемычки этой ветви — по ходу волны. Устоявшая обнуляет волну,
      // разрушенная пропускает ослабленную (см. blastBarriers.ts).
      const kBar = crossBarriers({
        list: barriers.get(e.branchId),
        tFrom: e.tStart, tTo: e.tStart === 0 ? 1 : 0, len: e.len, d0: curD,
        attAt: dist => attIn * Math.exp(-beta * dist),
        srcId, pressureOf, onHit: recordHit,
      });
      const att = attIn * Math.exp(-beta * e.len) * kBar;
      // Волна угасла (или остановлена перемычкой) — ветвь не продолжаем
      if (att < 1e-4) continue;
      pushWave(e.to, { d: curD + e.len, att, srcId, fromNode: cur });
    }
  }

  // ── ИТОГ ПО ПЕРЕМЫЧКАМ ─────────────────────────────────────────────────
  // Разрушение определено прямо на пути волны — по давлению ОТРАЖЕНИЯ, а не
  // набегающей волны: перемычка стоит поперёк хода и тормозит волну до нуля.
  // В ветвь пишется давление набегающей волны: от него считается толщина
  // взрывоустойчивой перемычки (там отражение применяется отдельно).
  const finalBranches = updatedBranches.map(b => {
    const list = barriers.get(b.id);
    if (!list || list.length === 0) {
      return b.hasBulkhead ? { ...b, bulkheadDestroyedByExplosion: false } : b;
    }
    let destroyed = false;
    let maxIncident = 0;
    for (const bar of list) {
      const hit = barrierHits.get(bar.key);
      if (!hit) continue;
      if (hit.destroyed) destroyed = true;
      if (hit.incident_kPa > maxIncident) maxIncident = hit.incident_kPa;
    }
    return {
      ...b,
      explosionComputedDeltaP: Math.round(maxIncident * 10) / 10,
      bulkheadDestroyedByExplosion: destroyed,
    };
  });

  return {
    branches: finalBranches, results, resultByBranch, netWave, pressureAtNode,
    barrierHits, barriers,
  };
}