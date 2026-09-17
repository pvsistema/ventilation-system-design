// ─────────────────────────────────────────────────────────────────────────────
// mineMeasureStations.ts — ЗАМЕРНАЯ СТАНЦИЯ В ОБЪЁМЕ (режим «Модель»).
//
// ЧТО БЫЛО НЕ ТАК. Замерная станция на чертеже — две красные линии ВДОЛЬ
// выработки: они размечают участок, на котором меряют скорость и считают
// расход. В объёме её рисовала та же плоская карточка, что перемычку, —
// значок натягивался на сечение и вставал ПОПЕРЁК выработки. Получалась
// красная заслонка: по схеме читается «выработка чем-то перекрыта», хотя
// замерная станция ничего не перекрывает. Направление линий у этого знака —
// не оформление, а его смысл: они показывают участок ЗАМЕРА, то есть отрезок
// выработки, а не её сечение.
//
// ЧТО ЗДЕСЬ. Знак собран ровно как на чертеже, только в объёме: ДВЕ красные
// линии ВДОЛЬ выработки, разведённые поперёк неё, и две короткие перекладины
// на концах — границы участка замера. Между линиями натянута лёгкая красная
// плёнка: она показывает сам участок и служит крупной мишенью для курсора.
//
// ЛИНИИ ИДУТ ВНУТРИ ВЫРАБОТКИ. Это не оформление: станция стоит внутри, и знак
// обязан стоять там же. В прошлой правке обойма выносилась ЗА стенки (полураз-
// меры брались с запасом 0.58 вместо 0.5) и обхватывала выработку снаружи —
// читалась как надетый на неё хомут, а рамки по всему сечению на концах опять
// смотрелись заслонками. Теперь снаружи ничего нет.
//
// СКОРОСТЬ. Все линии — прямоугольные бруски: одна пакетная отрисовка
// (InstancedMesh) на все станции схемы, плюс одна на полотна. Сколько бы
// станций ни стояло, это два вызова отрисовки.
//
// НАВЕДЕНИЕ. Станция ловит луч мыши сама (pick) и отдаёт наверх свои числа:
// номер, расход и сечение. Ради них к ней и подходят.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { toThree } from "./mineScene";

/** Идентификатор знака замерной станции в общей легенде. */
export const MEASURE_STATION_ID = "measure_station";

/**
 * Потолок числа станций в сцене. Замерных станций на руднике десятки, сотня —
 * это уже очень крупная схема; запас взят с избытком.
 */
const MAX_STATIONS = 600;

/**
 * Брусков в одном знаке: две линии вдоль выработки + две перекладины на концах
 * участка замера. Ровно тот же знак, что на чертеже, только в объёме.
 */
const BARS_PER_STATION = 4;

/** Цвет замерной станции — тот же красный, что у знака на чертеже (#dc2626). */
const COLOR = new THREE.Color(0xdc2626);
/** Под курсором обойма светлеет: видно, к какой станции относится подсказка. */
const COLOR_HOVER = new THREE.Color(0xff8a8a);

/** Габариты сечения выработки в метрах: ширина и высота. */
function sectionDims(b: TopoBranch): { w: number; h: number } {
  const shape = b.shape ?? "rect";
  if (shape === "round") {
    const d = Math.max(0.5, b.diameter ?? 0);
    return { w: d, h: d };
  }
  const w = Math.max(0.5, b.rectWidth ?? 0);
  let h = Math.max(0.5, b.rectHeight ?? 0);
  if (shape === "arch") h += Math.max(0, b.archHeight ?? 0);
  const wTop = shape === "trap" ? Math.max(0, b.trapTopWidth ?? 0) : 0;
  return { w: Math.max(w, wTop), h };
}

/**
 * Числа замерной станции — то, что показывается при наведении.
 *
 * Собственные значения знака (msNumber, msFlow, msArea) имеют приоритет над
 * расчётными: замерная станция — это ЗАМЕР, и если маркшейдер вписал туда
 * снятые с натуры числа, показывать вместо них результат расчёта нельзя.
 * Когда своих значений нет, берутся расчётные по выработке — так же, как это
 * делает подпись станции на чертеже (см. drawSymbolsToCanvas).
 */
export interface MeasureStationInfo {
  /** id знака на схеме. */
  id: string;
  /** Номер станции («№ 12»). Пусто, если не заполнен. */
  number: string;
  /** Место установки — вписывается в карточке знака. */
  location: string;
  /** Расход воздуха, м³/с. */
  flow: number;
  /** Сечение (площадь замера), м². */
  area: number;
  /** Скорость, м/с. */
  velocity: number;
  /** Выработка, на которой стоит станция, — её название для заголовка. */
  branchTitle: string;
  /** id выработки: по нему наверху подсвечивается сама выработка. */
  branchId: string;
}

export interface MeasureStationsInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  /** Условные обозначения схемы: берём из них только замерные станции. */
  symbols: SchemaSymbol[];
  xyScale: number;
  zScale: number;
  /** Общий размер знаков — та же ручка S/M/L, что у плоских обозначений. */
  sizeK?: number;
}

/** Что нашлось под лучом. */
export interface MeasureStationHit {
  info: MeasureStationInfo;
  /** Расстояние до попадания — по нему наверху решают, что ближе к камере. */
  distance: number;
}

/** Готовый слой замерных станций. */
export interface MineMeasureStations {
  group: THREE.Group;
  /** Ищет станцию под лучом. Луч должен быть настроен снаружи. */
  pick(ray: THREE.Raycaster): MeasureStationHit | null;
  /**
   * Подсвечивает станцию под курсором. Возвращает true, если картинка
   * изменилась и нужен новый кадр.
   */
  setHover(id: string | null): boolean;
  dispose(): void;
  /** Сколько станций попало в сцену. */
  count: number;
  /** Сколько вызовов отрисовки они добавили. */
  drawCalls: number;
}

/**
 * Строит слой объёмных замерных станций.
 *
 * Возвращает null, если на схеме нет ни одной станции, привязанной к выработке
 * с координатами: пустой слой в сцене только мешает освобождать память.
 */
export function buildMineMeasureStations(
  input: MeasureStationsInput,
): MineMeasureStations | null {
  const { nodes, branches, symbols, xyScale, zScale } = input;
  if (!symbols || symbols.length === 0) return null;

  const kx = xyScale > 0 ? xyScale : 1;
  const kz = zScale > 0 ? zScale : 1;
  const sizeK = Math.max(0.2, Math.min(4, input.sizeK ?? 1));

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const branchById = new Map(branches.map(b => [b.id, b]));
  const nodeName = new Map(
    nodes.map(n => [n.id, (n.name || n.number || "").trim() || n.id]),
  );

  /** Заготовка одной обоймы: положение и размер каждого её бруска. */
  interface Bar {
    /** Смещение центра бруска в местных осях участка (x — вбок, y — вверх, z — вдоль). */
    ox: number; oy: number; oz: number;
    sx: number; sy: number; sz: number;
  }

  interface Station {
    info: MeasureStationInfo;
    /** Центр участка замера. */
    pos: THREE.Vector3;
    xAxis: THREE.Vector3;
    yAxis: THREE.Vector3;
    zAxis: THREE.Vector3;
    bars: Bar[];
    /** Полуразнос линий поперёк выработки и половина длины участка замера. */
    gap: number; hl: number;
  }

  const stations: Station[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  for (const sym of symbols) {
    if (stations.length >= MAX_STATIONS) break;
    if (sym.typeId !== MEASURE_STATION_ID) continue;
    // Знак без привязки к выработке в объёме поставить некуда: его экранные
    // координаты к трёхмерной схеме отношения не имеют.
    if (!sym.branchId) continue;
    const b = branchById.get(sym.branchId);
    if (!b || b.isDead) continue;
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) continue;
    if (!isFinite(fn.x) || !isFinite(fn.y) || !isFinite(fn.z)) continue;
    if (!isFinite(tn.x) || !isFinite(tn.y) || !isFinite(tn.z)) continue;

    const a = toThree(fn.x * kx, fn.y * kx, fn.z * kz);
    const c = toThree(tn.x * kx, tn.y * kx, tn.z * kz);
    const dir = new THREE.Vector3().subVectors(c, a);
    const len = dir.length();
    if (!(len > 1e-6)) continue;
    dir.divideScalar(len);

    const t = Math.max(0, Math.min(1, sym.t ?? 0.5));
    const pos = new THREE.Vector3().lerpVectors(a, c, t);

    const dims = sectionDims(b);
    const sc = Math.max(0.1, Math.min(8, sym.scale ?? 1));

    // Полуразмеры СЕЧЕНИЯ выработки. Раньше они брались с запасом (0.58 вместо
    // 0.5) — обойма выносилась наружу, за стенки. Станция стоит ВНУТРИ
    // выработки, и знак обязан стоять там же.
    const hw = dims.w * kx * 0.5;
    const hh = dims.h * kx * 0.5;
    // Длина участка замера. На чертеже это отрезок вдоль выработки, и в
    // объёме он обязан быть заметно длиннее своего сечения — иначе знак
    // выглядит кубиком и читается как перегородка. Ограничиваем третью длины
    // самой выработки: участок замера не может занять её целиком.
    const want = Math.max(dims.w, dims.h) * kx * 2.6 * sc * sizeK;
    const hl = Math.max(0.3, Math.min(want, len * 0.34)) / 2;

    // Толщина линии — от меньшего размера сечения: на сбойке 2×2 пруток в те
    // же сантиметры, что на стволе, был бы не виден.
    const th = Math.max(0.06, Math.min(hw, hh) * 0.18);
    // Разнос линий поперёк выработки. На чертеже полосы разведены примерно на
    // треть её ширины — держим ту же пропорцию, чтобы объём и чертёж читались
    // одинаково, и не прижимаем линии к стенкам: они внутри.
    const gap = Math.max(th, hw * 0.5);

    const bars: Bar[] = [];
    // ── Две линии ВДОЛЬ выработки, внутри неё ───────────────────────────
    // Это ровно тот же знак, что на чертеже: две красные полосы, идущие по
    // направлению ветви и размечающие участок замера. Разведены поперёк
    // выработки — как на чертеже, только разнос горизонтальный, потому что в
    // объёме «поперёк» без ракурса не определить.
    for (const sx of [-1, 1]) {
      bars.push({ ox: sx * gap, oy: 0, oz: 0, sx: th, sy: th, sz: hl * 2 });
    }
    // ── Две перекладины на концах — границы участка замера ──────────────
    // Короткие, только между самими линиями: они показывают, ГДЕ участок
    // начинается и кончается, и при этом ничего не перекрывают. Рамка по
    // всему сечению, стоявшая здесь раньше, снова читалась как заслонка.
    for (const sz of [-1, 1]) {
      bars.push({ ox: 0, oy: 0, oz: sz * hl, sx: gap * 2, sy: th, sz: th });
    }

    // Местные оси участка: +Z вдоль выработки, X — горизонталь поперёк неё.
    // У вертикального ствола «вверх» совпадает с осью, там за горизонталь
    // берём ось X сцены — иначе тройка вырождается и обойма схлопывается.
    const zAxis = dir.clone();
    const xAxis = new THREE.Vector3().crossVectors(up, zAxis);
    if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    // ── Числа станции ───────────────────────────────────────────────────
    const flow = sym.msFlow ?? Math.abs(b.flow ?? 0);
    const area = sym.msArea ?? (b.area ?? 0);
    const velocity = sym.msVelocity
      ?? (area > 1e-6 ? Math.abs(flow) / area : Math.abs(b.velocity ?? 0));
    const branchTitle = (b.type || "").trim()
      || `${nodeName.get(b.fromId) ?? "?"} → ${nodeName.get(b.toId) ?? "?"}`;

    stations.push({
      info: {
        id: sym.id,
        number: (sym.msNumber ?? "").trim(),
        location: (sym.msLocation ?? "").trim(),
        flow: Math.abs(flow),
        area,
        velocity: Math.abs(velocity),
        branchTitle,
        branchId: b.id,
      },
      pos, xAxis, yAxis, zAxis, bars, gap, hl,
    });
  }

  if (stations.length === 0) return null;

  const group = new THREE.Group();

  // ── Обойма: все бруски всех станций одной пакетной отрисовкой ──────────
  const barGeom = new THREE.BoxGeometry(1, 1, 1);
  const barMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,          // цвет задаётся на экземпляр (instanceColor)
    metalness: 0.15, roughness: 0.55,
    // Свечение: обойма обязана читаться и в тёмной глубине схемы, и на
    // просвет в «стеклянном» режиме.
    emissive: COLOR, emissiveIntensity: 0.35,
  });
  const barMesh = new THREE.InstancedMesh(
    barGeom, barMat, stations.length * BARS_PER_STATION,
  );
  barMesh.frustumCulled = false;
  // Поверх тела выработки: обойма стоит на её стенках, и в сплошном режиме
  // грань трубы то и дело оказывается на волос ближе к камере.
  barMesh.renderOrder = 3;

  // ── Полотно участка замера ────────────────────────────────────────────
  // Лёгкая плёнка между двумя линиями, ВДОЛЬ выработки. Она показывает сам
  // участок как площадку, а не как сечение: раньше здесь стояли два окна
  // ПОПЕРЁК выработки, и они-то и делали станцию похожей на заслонку.
  // Заодно это крупная мишень для курсора — попасть издали в тонкий пруток,
  // ради которого к станции и подходят (её числа), почти нельзя.
  const panelGeom = new THREE.PlaneGeometry(1, 1);
  const panelMat = new THREE.MeshBasicMaterial({
    color: COLOR, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
  const panelMesh = new THREE.InstancedMesh(panelGeom, panelMat, stations.length);
  panelMesh.frustumCulled = false;
  panelMesh.renderOrder = 3;

  const m = new THREE.Matrix4();
  const center = new THREE.Vector3();

  stations.forEach((st, si) => {
    st.bars.forEach((bar, bi) => {
      center.copy(st.pos)
        .addScaledVector(st.xAxis, bar.ox)
        .addScaledVector(st.yAxis, bar.oy)
        .addScaledVector(st.zAxis, bar.oz);
      m.makeBasis(st.xAxis, st.yAxis, st.zAxis);
      m.scale(new THREE.Vector3(bar.sx, bar.sy, bar.sz));
      m.setPosition(center);
      const idx = si * BARS_PER_STATION + bi;
      barMesh.setMatrixAt(idx, m);
      barMesh.setColorAt(idx, COLOR);
    });

    // Полотно лежит В ПЛОСКОСТИ двух линий: местная X — поперёк выработки
    // (разнос линий), местная Y — вдоль неё (длина участка). Плоскость
    // PlaneGeometry по умолчанию в XY, поэтому третьей осью ставим нормаль.
    m.makeBasis(st.xAxis, st.zAxis, st.yAxis);
    m.scale(new THREE.Vector3(st.gap * 2, st.hl * 2, 1));
    m.setPosition(st.pos);
    panelMesh.setMatrixAt(si, m);
  });
  barMesh.instanceMatrix.needsUpdate = true;
  if (barMesh.instanceColor) barMesh.instanceColor.needsUpdate = true;
  panelMesh.instanceMatrix.needsUpdate = true;

  group.add(barMesh);
  group.add(panelMesh);

  let hoverId: string | null = null;

  const setHover = (id: string | null): boolean => {
    if (id === hoverId) return false;
    const paint = (stId: string | null, color: THREE.Color) => {
      if (!stId) return;
      const si = stations.findIndex(s => s.info.id === stId);
      if (si < 0) return;
      for (let i = 0; i < BARS_PER_STATION; i++) {
        barMesh.setColorAt(si * BARS_PER_STATION + i, color);
      }
    };
    paint(hoverId, COLOR);
    paint(id, COLOR_HOVER);
    hoverId = id;
    if (barMesh.instanceColor) barMesh.instanceColor.needsUpdate = true;
    return true;
  };

  const pick = (ray: THREE.Raycaster): MeasureStationHit | null => {
    // Ловим и по обойме, и по торцевым окнам: окно — самая крупная часть
    // станции, и попасть курсором в тонкий пруток издали почти нельзя.
    const hits = ray.intersectObjects([barMesh, panelMesh], false);
    for (const h of hits) {
      const i = h.instanceId;
      if (i === undefined || i === null) continue;
      const si = h.object === barMesh ? Math.floor(i / BARS_PER_STATION) : i;
      const st = stations[si];
      if (!st) continue;
      return { info: st.info, distance: h.distance };
    }
    return null;
  };

  const dispose = () => {
    group.clear();
    barGeom.dispose();
    panelGeom.dispose();
    barMat.dispose();
    panelMat.dispose();
    barMesh.dispose();
    panelMesh.dispose();
  };

  return { group, pick, setHover, dispose, count: stations.length, drawCalls: 2 };
}