// ─────────────────────────────────────────────────────────────────────────────
// mineArrows.ts — БЕГУЩИЕ СТРЕЛКИ НАПРАВЛЕНИЯ ВОЗДУХА В РЕЖИМЕ «МОДЕЛЬ».
//
// Направление движения воздуха — главное, что читают на вентиляционной схеме:
// по нему видно, куда пойдёт дым при пожаре и откуда придёт свежая струя.
//
// ЦВЕТ — ТОТ ЖЕ, ЧТО НА ЧЕРТЕЖЕ, и он не украшение, а смысл:
//   красный — свежая струя, идущая к рабочим местам;
//   синий   — исходящая, загазованная (доля загрязнённого воздуха выше порога).
// Признак загазованности приходит снаружи, из того же расчёта, что красит
// стрелки на чертеже: два режима обязаны показывать одно и то же.
//
// ПОЧЕМУ СТРЕЛКА ИДЁТ НАД ВЫРАБОТКОЙ, А НЕ ПО ЕЁ ОСИ.
// Выработка в объёме — сплошная непрозрачная труба. Стрелка, положенная по её
// оси, оказывается ВНУТРИ трубы: наружу торчит только кромка основания конуса,
// а хвостик не виден вовсе — ровно это и выглядело как «стрелки утоплены, их
// перекрывает выработка». Раньше здесь пытались обойтись тем, что конус делали
// шире сечения в 1,7 раза: наружу выступало кольцо у основания, но сама
// стрелка — направление, её остриё и хвост — всё равно оставалась в трубе.
//
// Обойти это отключением проверки глубины нельзя: тогда стрелки всплывут
// поверх всей схемы, и стрелки с дальнего горизонта будут висеть перед
// ближними выработками — направление станет читаться неверно, а это уже
// ошибка в документе.
//
// Поэтому стрелка вынесена ЗА пределы сечения: она идёт вдоль выработки, но
// отодвинута от её оси по нормали — над кровлей у горизонтальной выработки,
// сбоку у ствола. Стрелка целиком снаружи, видна полностью, честно
// перекрывается тем, что стоит ближе к человеку, и не закрывает саму
// выработку. Это же правило и на чертеже: там стрелка рисуется ПОВЕРХ линии
// выработки, а не сливается с ней.
//
// ─────────────────────────────────────────────────────────────────────────────
// КАК СДЕЛАНО ДВИЖЕНИЕ
//
// Стрелки не пересчитываются на процессоре: их положение вдоль выработки
// считает видеокарта прямо в вершинном шейдере по одному общему числу —
// текущему времени. На схеме в тысячи выработок это принципиально: пересборка
// десятков тысяч матриц шестьдесят раз в секунду съела бы весь выигрыш от
// пакетной отрисовки, ради которого движок и делался.
//
// Каждой стрелке заранее записаны три числа: длина пробега, скорость и
// начальный сдвиг. Дальше она бежит сама, а вся анимация схемы — это одна
// переменная времени, обновляемая раз в кадр.
//
// Стрелок на выработке несколько, с равным шагом: дойдя до конца, стрелка
// возвращается в начало, и на её место приходит следующая — получается
// непрерывный поток. Иначе на длинном стволе одинокая стрелка ползла бы минуту
// и движение было бы незаметно.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { toThree } from "./mineScene";
import { arrowSpeedMps } from "@/lib/flowAnim";

/**
 * Ниже этого расхода стрелку не ставим.
 *
 * Тот же порог, что на чертеже: около нуля знак расхода — это уже не
 * направление, а погрешность расчёта, и показывать по нему стрелку нельзя.
 */
const MIN_FLOW = 0.1;

/** Цвета струи — те же, что на чертеже. */
const COLOR_FRESH = 0xdc2626;     // свежая
const COLOR_POLLUTED = 0x2563eb;  // загазованная (исходящая)

/** Граней в конусе. Двенадцати хватает: стрелка мелкая, ребра на ней не видны. */
const CONE_FACETS = 12;

/** Сколько стрелок максимум на одной выработке. */
const MAX_PER_BRANCH = 5;

/**
 * Потолок общего числа стрелок.
 *
 * Отрисовка у них одна на всех, но каждая занимает место в памяти видеокарты.
 * На схеме, где стрелок больше этого числа, они всё равно сливаются, поэтому
 * лишние просто не ставим.
 */
const MAX_TOTAL = 20000;

export interface ArrowsInput {
  nodes: TopoNode[];
  branches: TopoBranch[];
  xyScale: number;
  zScale: number;
  /**
   * Выработки с загазованной (исходящей) струёй — красятся синим.
   * Считается снаружи, тем же расчётом, что и на чертеже.
   */
  pollutedBranchIds?: Set<string>;
  /** Множитель скорости анимации из настроек: 1 — обычная, 0.5 — вдвое медленнее. */
  animSpeed?: number;
}

/** Готовые стрелки: меш для сцены плюс управление временем и уборка. */
export interface FlowArrows {
  mesh: THREE.InstancedMesh;
  /** Двигает все стрелки разом. Время в секундах от начала показа. */
  setTime(seconds: number): void;
  /** Освобождает видеопамять: геометрия и материал здесь собственные. */
  dispose(): void;
  /** Сколько стрелок получилось — видно в счётчике внизу экрана. */
  arrowCount: number;
}

/**
 * Из чего складывается стрелка: наконечник и хвостик.
 *
 * Пропорции взяты с чертежа (canvasRenderer: наконечник 2.2 ширины линии,
 * хвостик 3.0, толщина хвостика 0.15 от полуширины наконечника). Два режима
 * обязаны показывать одну и ту же стрелку: человек, привыкший читать
 * направление на чертеже, не должен заново привыкать к объёму.
 */
const HEAD_FRAC = 2.2 / 5.2;        // доля длины, приходящаяся на наконечник
const TAIL_R_FRAC = 0.15;           // толщина хвостика от радиуса наконечника
/** Во сколько раз стрелка целиком длиннее своей толщины. */
const ARROW_LEN_K = 5.2;

/**
 * Единичная стрелка остриём вдоль +X: наконечник плюс хвостик.
 *
 * Длина всей стрелки — ровно 1, чтобы матрица экземпляра растягивала её по
 * длине выработки одним числом, а шейдер сдвигал по локальному X.
 *
 * ConeGeometry и CylinderGeometry в three смотрят вдоль оси Y, поэтому сразу
 * разворачиваем их: дальше матрица экземпляра работает так же, как у
 * выработок, — переводит +X в направление потока.
 *
 * Донышки (openEnded = false) оставляем: без них сквозь стрелку видно её
 * внутренность, и на светлой схеме она выглядит дырой.
 */
function makeArrowGeometry(): THREE.BufferGeometry {
  const headLen = HEAD_FRAC;
  const tailLen = 1 - headLen;

  const head = new THREE.ConeGeometry(1, headLen, CONE_FACETS, 1, false);
  // Остриё ConeGeometry в +Y, центр в середине высоты. Сдвигаем так, чтобы
  // основание наконечника пришлось на конец хвостика, а остриё — точно в 1.
  head.translate(0, 1 - headLen / 2, 0);
  head.rotateZ(-Math.PI / 2);

  // Хвостик заходит под наконечник на четверть его длины: иначе на стыке при
  // косом взгляде видна щель между тонкой трубкой и широким основанием.
  const stemLen = tailLen + headLen * 0.25;
  const tail = new THREE.CylinderGeometry(
    TAIL_R_FRAC, TAIL_R_FRAC, stemLen, Math.max(6, CONE_FACETS / 2), 1, false,
  );
  tail.translate(0, stemLen / 2, 0);
  tail.rotateZ(-Math.PI / 2);

  const merged = mergeGeometries([head, tail], false);
  head.dispose();
  tail.dispose();
  // mergeGeometries возвращает null, если наборы атрибутов разошлись. У обеих
  // заготовок они одинаковые, но подстраховаться дешевле, чем уронить режим:
  // без стрелок схема читается, с пустым экраном — нет.
  if (!merged) {
    const fallback = new THREE.ConeGeometry(1, 1, CONE_FACETS, 1, false);
    fallback.translate(0, 0.5, 0);
    fallback.rotateZ(-Math.PI / 2);
    return fallback;
  }
  return merged;
}

/**
 * Поперечный размер выработки, м — по нему подбирается размер стрелки.
 *
 * Берём ПОЛОВИНУ ДИАГОНАЛИ сечения, а не половину большей стороны: у
 * прямоугольного сечения угол отстоит от оси дальше, чем середина стенки, и
 * при повороте схемы наружу выходит именно он. Считай по стенке — стрелка,
 * отведённая на эту величину, временами пряталась бы за углом выработки.
 */
function sectionRadius(b: TopoBranch): number {
  if ((b.shape ?? "rect") === "round") return Math.max(0.5, (b.diameter ?? 0) / 2);
  const w = Math.max(0.5, b.rectWidth ?? 0);
  const h = Math.max(0.5, b.rectHeight ?? 0) + Math.max(0, b.archHeight ?? 0);
  return Math.hypot(w, h) / 2;
}

/**
 * Куда отодвинуть стрелку от оси выработки.
 *
 * Ищем нормаль к выработке, максимально близкую к «вверх»: у горизонтальной
 * выработки стрелка идёт над кровлей — там её не закрывает ни сама выработка,
 * ни соседние, лежащие в том же горизонте. У вертикального ствола «вверх»
 * совпадает с осью и нормали не даёт; там берём горизонтальное направление —
 * стрелка идёт рядом со стволом сбоку.
 *
 * В координатах сцены вверх — ось Y (см. toThree).
 */
function offsetNormal(dir: THREE.Vector3): THREE.Vector3 {
  const up = new THREE.Vector3(0, 1, 0);
  // Составляющая «вверх», перпендикулярная выработке.
  const n = up.clone().sub(dir.clone().multiplyScalar(dir.dot(up)));
  if (n.lengthSq() > 1e-6) return n.normalize();
  // Выработка вертикальна — вверх не годится, отводим стрелку по оси X сцены.
  const side = new THREE.Vector3(1, 0, 0);
  const n2 = side.clone().sub(dir.clone().multiplyScalar(dir.dot(side)));
  if (n2.lengthSq() > 1e-6) return n2.normalize();
  return new THREE.Vector3(0, 0, 1);
}

/** Геометрия одной выработки, посчитанная до раскладки стрелок. */
interface Placement {
  branch: TopoBranch;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  /** Длина выработки в координатах сцены. */
  len: number;
  /** Радиус наконечника и полная длина стрелки (хвостик + наконечник). */
  rad: number;
  aLen: number;
  /**
   * Смещение стрелки от оси выработки, координаты сцены.
   *
   * Уже готовый вектор: нормаль, умноженная на величину отвода. Складывается с
   * начальной точкой — так стрелка идёт ВДОЛЬ выработки, но снаружи неё.
   */
  offset: THREE.Vector3;
  /** Отступ от узлов: на него стрелка отодвинута от начала выработки. */
  margin: number;
  /** Сколько стрелок ставим и с каким шагом. */
  count: number;
  step: number;
  /** Скорость бега в координатах сцены, единиц в секунду. */
  speed: number;
}

/**
 * Считает раскладку стрелок по выработкам.
 *
 * Вынесено отдельно, потому что число экземпляров в пакетной отрисовке
 * задаётся заранее и потом не меняется: сначала надо узнать, сколько всего
 * стрелок получится, и только потом создавать меш.
 */
function planArrows(input: ArrowsInput): { plan: Placement[]; total: number } {
  const { nodes, branches, xyScale, zScale } = input;
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const kx = xyScale > 0 ? xyScale : 1;
  const kz = zScale > 0 ? zScale : 1;
  const animK = Math.max(0.1, input.animSpeed ?? 1);

  const plan: Placement[] = [];
  let total = 0;

  for (const b of branches) {
    if (b.isDead) continue;
    if (Math.abs(b.flow ?? 0) < MIN_FLOW) continue;
    const fn = nodeById.get(b.fromId), tn = nodeById.get(b.toId);
    if (!fn || !tn) continue;
    if (!isFinite(fn.x) || !isFinite(fn.y) || !isFinite(fn.z)) continue;
    if (!isFinite(tn.x) || !isFinite(tn.y) || !isFinite(tn.z)) continue;

    // Направление стрелки — по воздуху, а не по тому, как выработку начертили.
    // Отрицательный расход означает движение против направления выработки; у
    // вентилятора в реверсе знак может не смениться, поэтому он учитывается
    // отдельно — ровно так же, как на чертеже.
    const fanReverseOverride = b.hasFan && (b.fanReverse ?? false) && (b.flow ?? 0) >= 0;
    const reversed = (b.flow ?? 0) < 0 || fanReverseOverride;
    const a = reversed ? tn : fn;
    const c = reversed ? fn : tn;

    const from = toThree(a.x * kx, a.y * kx, a.z * kz);
    const to = toThree(c.x * kx, c.y * kx, c.z * kz);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (!(len > 1e-6)) continue;
    dir.divideScalar(len);

    // ── Размер стрелки и её вынос за пределы выработки ────────────────
    //
    // Сечение в сцене масштабируется тем же множителем плана, что и выработки
    // (см. branchMatrix в mineScene), поэтому «радиус» выработки здесь —
    // полудиагональ сечения, умноженная на этот множитель.
    const secR = sectionRadius(b) * kx;
    // Наконечник соразмерен выработке, но заметно тоньше её: стрелка должна
    // читаться как указатель направления, а не спорить с самой выработкой за
    // место на экране.
    const rad = secR * 0.65;
    // Отвод от оси: радиус выработки плюс весь радиус стрелки плюс небольшой
    // зазор. Меньше — стрелка врезается в трубу и её снова начинает
    // перекрывать поверхность выработки, ради чего вся эта правка и делалась.
    const offDist = secR + rad + secR * 0.08;
    const offset = offsetNormal(dir).multiplyScalar(offDist);

    // ── Отступ от узлов ───────────────────────────────────────────────
    // В узле сходится несколько выработок, и там они врезаются друг в друга.
    // Стрелка, доходящая вплотную до узла, попадает в этот стык и выглядит
    // приклеенной к соседней выработке. Отступ равен радиусу выработки:
    // ровно столько занимает место сопряжения.
    const margin = Math.min(secR, len * 0.12);

    // Длина стрелки соразмерна её толщине, но не длиннее трети свободной
    // части выработки: на короткой сбойке стрелка иначе заняла бы её целиком.
    const free = len - margin * 2;
    if (!(free > 1e-6)) continue;
    const aLen = Math.min(rad * ARROW_LEN_K, free * 0.6);
    if (!(aLen > 1e-6)) continue;

    // Шаг между стрелками: примерно полторы длины самой стрелки — стрелка
    // теперь с хвостиком и сама по себе длиннее прежнего конуса. Реже — поток
    // распадается на отдельные редкие метки, чаще — стрелки наезжают друг на
    // друга и сливаются в сплошную колбасу.
    const step = aLen * 1.6;
    const count = Math.max(1, Math.min(MAX_PER_BRANCH, Math.floor(free / step)));
    if (total + count > MAX_TOTAL) break;

    // Скорость бега — по общему закону (flowAnim), одному на чертёж и на
    // модель: метры рудника в секунду, приведённые к масштабу плана.
    const speed = arrowSpeedMps(b.velocity, animK) * kx;

    plan.push({ branch: b, from, dir, len, rad, aLen, offset, margin, count, step, speed });
    total += count;
  }

  return { plan, total };
}

/**
 * Строит бегущие стрелки потока.
 *
 * Возвращает null, если ставить нечего: схема не рассчитана или воздух никуда
 * не идёт. Вызывающая сторона в этом случае просто ничего не добавляет в сцену.
 */
export function buildFlowArrows(input: ArrowsInput): FlowArrows | null {
  const { plan, total } = planArrows(input);
  if (total === 0) return null;

  const geom = makeArrowGeometry();

  // ── Данные для шейдера, по одному числу на стрелку ────────────────────
  // Всё в ЛОКАЛЬНЫХ единицах стрелки: матрица экземпляра уже растягивает её по
  // длине выработки, поэтому смещение вдоль локальной оси X автоматически
  // превращается в движение вдоль выработки в нужную сторону. Это избавляет от
  // хранения направления отдельным вектором.
  const aSpan = new Float32Array(total);   // длина пробега
  const aSpeed = new Float32Array(total);  // единиц в секунду
  const aPhase = new Float32Array(total);  // начальный сдвиг

  const mat = new THREE.MeshLambertMaterial({
    // Стрелка надета на выработку, и изнутри её стенка тоже попадает в кадр —
    // без DoubleSide стрелка при взгляде «в хвост» выглядит рассечённой.
    side: THREE.DoubleSide,
  });

  // Ссылку на переменную времени держим снаружи: она появляется только в
  // момент компиляции шейдера, а двигать стрелки нужно каждый кадр.
  const timeUniform = { value: 0 };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float aSpan;
         attribute float aSpeed;
         attribute float aPhase;
         uniform float uTime;`,
      )
      // Вмешиваемся ДО project_vertex: там вершина ещё в локальных координатах
      // стрелки и матрица экземпляра к ней не применена. Сдвиг по локальному X
      // как раз и станет движением вдоль выработки.
      .replace(
        "#include <project_vertex>",
        `transformed.x += mod(uTime * aSpeed + aPhase, aSpan);
         #include <project_vertex>`,
      );
  };

  const mesh = new THREE.InstancedMesh(geom, mat, total);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  // Выработки тянутся через всю сцену, отсечение по габаритам здесь только
  // мешает: стрелка привязана к выработке, а не к точке.
  mesh.frustumCulled = false;
  // Рисуем после выработок: при равной глубине (стрелка вплотную к трубе)
  // побеждает то, что нарисовано позже, иначе стрелка местами исчезала бы
  // в поверхности выработки.
  mesh.renderOrder = 5;

  const axisX = new THREE.Vector3(1, 0, 0);
  const q = new THREE.Quaternion();
  const base = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const polluted = input.pollutedBranchIds;

  let idx = 0;
  for (const pl of plan) {
    q.setFromUnitVectors(axisX, pl.dir);
    scale.set(pl.aLen, pl.rad, pl.rad);
    // Все стрелки выработки стартуют от одной точки — на отступ от начального
    // узла; расходятся они за счёт начального сдвига в шейдере, а не за счёт
    // разных матриц. Плюс вынос по нормали: стрелка идёт вдоль выработки, но
    // снаружи её поверхности, иначе труба перекрывает стрелку целиком.
    base.copy(pl.dir).multiplyScalar(pl.margin).add(pl.from).add(pl.offset);
    m.compose(base, q, scale);

    // ── Пробег ───────────────────────────────────────────────────────
    // Считается по ХВОСТУ стрелки: он стоит в нуле локальных координат, а
    // остриё — в единице, то есть на aLen дальше. Чтобы остриё не вышло за
    // отступ у конечного узла, из свободной длины вычитается вся стрелка
    // целиком. Раньше отступов не было и вычиталась длина одного конуса —
    // стрелка доходила ровно до узла, где выработки врезаются друг в друга, и
    // выглядела торчащей наружу.
    const free = pl.len - pl.margin * 2;
    const spanWorld = Math.max(pl.aLen * 0.25, free - pl.aLen);
    // Перевод в локальные единицы стрелки: матрица растянула её в aLen раз.
    const spanLocal = spanWorld / pl.aLen;
    const speedLocal = pl.speed / pl.aLen;

    col.set(polluted?.has(pl.branch.id) ? COLOR_POLLUTED : COLOR_FRESH);

    for (let i = 0; i < pl.count; i++) {
      mesh.setMatrixAt(idx, m);
      mesh.setColorAt(idx, col);
      aSpan[idx] = spanLocal;
      aSpeed[idx] = speedLocal;
      // Равномерно разносим стрелки по всему пробегу — так поток выглядит
      // сплошным, а не пачкой, вышедшей одновременно.
      aPhase[idx] = (spanLocal * i) / pl.count;
      idx++;
    }
  }

  geom.setAttribute("aSpan", new THREE.InstancedBufferAttribute(aSpan, 1));
  geom.setAttribute("aSpeed", new THREE.InstancedBufferAttribute(aSpeed, 1));
  geom.setAttribute("aPhase", new THREE.InstancedBufferAttribute(aPhase, 1));

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return {
    mesh,
    arrowCount: total,
    setTime(seconds: number) { timeUniform.value = seconds; },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}