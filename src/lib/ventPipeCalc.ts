// ─────────────────────────────────────────────────────────────────────────────
// ventPipeCalc.ts — расчёт вентиляционного става при ВМП (нагнетательная схема).
//
// ЗАЧЕМ ЭТО НУЖНО.
// Вентилятор местного проветривания (ВМП) стоит в устье тупиковой выработки и
// гонит воздух в забой по гибкому рукаву (ставу). По дороге часть воздуха
// теряется — через стыки звеньев и через саму мембрану. Поэтому в забой
// приходит МЕНЬШЕ, чем даёт вентилятор:
//
//     Q_вент (у вентилятора)  →  утечки по длине  →  Q_забой (в забое)
//
// Отношение Q_забой / Q_вент называется КОЭФФИЦИЕНТОМ ДОСТАВКИ ВОЗДУХА (Kу.т).
// Именно он отвечает на главный вопрос: на какую длину хватит става, чтобы в
// забой пришло требуемое по газу/людям/ВВ количество воздуха.
//
// СХЕМА — ТОЛЬКО НАГНЕТАТЕЛЬНАЯ. Вентилятор нагнетает свежий воздух по ставу
// в забой, отработанный выходит по выработке. Всасывающая и комбинированная
// схемы считаются иначе (там утечки работают на подсос) и здесь не поддержаны.
//
// ЕДИНИЦЫ. Сопротивление R по всему проекту хранится в кМюрг (кгс·с²/м⁸),
// поэтому R·Q² даёт мм вод. ст., а не паскали — перевод делает depression().
// ─────────────────────────────────────────────────────────────────────────────
import { resistanceFromPipe, depression } from "@/lib/aerodynamics";
import { kolaVentLeak } from "@/lib/ventDuctLeakTables";
import type { TopoBranch } from "@/lib/topology";

/**
 * Методика расчёта утечек воздуха в ставе.
 *
 * • "passport" — по паспорту рукава. Изготовитель указывает удельные потери
 *   на 100 м става (для KolaVent Flex AS это 1,2 %). Утечки нарастают по длине
 *   геометрически: каждые следующие 100 м теряют свой процент от того, что до
 *   них дошло. Метод простой и точный для нового рукава известной марки.
 *
 * • "normative" — по нормативной формуле коэффициента доставки воздуха
 *   (Руководство по проектированию вентиляции угольных шахт). Утечки
 *   выражаются через удельный стыковой расход, длину звена, диаметр и
 *   сопротивление става. Метод учитывает, что утечка зависит от ДАВЛЕНИЯ в
 *   ставе: чем длиннее став, тем выше давление у вентилятора и тем сильнее
 *   «продавливает» воздух через стыки. Подходит, когда марка рукава неизвестна
 *   или став собран в шахте из разнородных звеньев.
 *
 * • "kolavent" — по таблицам изготовителя KolaVent Flex («О системе расчётов»).
 *   Ставы до 200 м считаются по формуле Kу.т = 1 + (L/100)·0,0085, длиннее —
 *   по таблицам 1.1–1.3, где коэффициент зависит сразу от трёх величин: длины
 *   става, диаметра рукава и количества воздуха, подаваемого в забой. Это
 *   самые точные данные для рукава этой марки, потому что они подтверждены
 *   изготовителем. Там, где в таблице стоит прочерк, сочетание «длина +
 *   диаметр + расход» изготовителем не подтверждается — расчёт не выдаёт
 *   число, а прямо говорит, какой диаметр взять.
 *
 * Какая методика строже — зависит от данных: у нового рукава с хорошим
 * паспортом строже обычно паспортная, у става с плохими стыками — нормативная.
 * Инженер выбирает ту, которой доверяет, и может сравнить обе.
 */
export type VpLeakMethod = "passport" | "normative" | "kolavent";

/** Исходные данные для расчёта става */
export interface VentPipeInput {
  /** Методика расчёта утечек */
  method: VpLeakMethod;
  /** Внутренний диаметр рукава, мм */
  diameter: number;
  /** Длина става, м */
  length: number;
  /** Коэффициент α трубопровода, ×10⁻⁴ Н·с²/м⁴ */
  alpha: number;
  /** Паспортные потери на 100 м става, % (для метода "passport") */
  lossPer100m: number;
  /** Длина одного звена рукава, м (для метода "normative") */
  linkLength: number;
  /** Удельный стыковой расход k_ст, м³/(с·даПа^0,5) — качество сборки стыков.
   *  0 или не задан = 0,003 (рукав с внутренними кольцами, обычная сборка). */
  jointLeakK?: number;
  /** Количество стыков на ставе */
  jointCount: number;
  /** Сумма коэффициентов местных сопротивлений ξ (повороты, фасонины) */
  localXi: number;
  /** Расход воздуха, подаваемый вентилятором в став, м³/с */
  fanFlow: number;
  /** Плотность воздуха, кг/м³ (по умолчанию 1.2) */
  density?: number;
  /**
   * Плотность стыков — сколько стыков приходится на 1 м става.
   * Нужна при переборе длин: у става 3 км стыков не столько же, сколько
   * у става 300 м, их пропорционально больше. Если не задана, берётся
   * фиксированное jointCount независимо от длины.
   */
  jointsPerMeter?: number;
  /**
   * Характеристика вентилятора H(Q), Па — напор в зависимости от расхода.
   *
   * КЛЮЧЕВОЙ МОМЕНТ. Вентилятор — не насос с постоянной подачей: чем больше
   * сопротивление става, тем МЕНЬШЕ воздуха он прогоняет. При удлинении става
   * подача падает по паспортной кривой. Без этого расчёт предельной длины даёт
   * фантастические километры: программа считает, будто вентилятор и на 3 км
   * гонит те же 26 м³/с, что и на 300 м.
   *
   * Если функция не передана, подача считается постоянной (грубая оценка).
   */
  fanCurve?: (Q: number) => number;
  /**
   * Поправка сопротивления на фактический состав става. Став часто собран
   * из рукавов РАЗНОГО диаметра (у вентилятора Ø1200, дальше Ø800), а расчёт
   * ведётся по одному диаметру. rScale = R фактической цепочки / R по
   * формуле для заданного диаметра и длины; при переборе длин сохраняется.
   */
  rScale?: number;
  /**
   * Фактический состав става по участкам, от вентилятора к забою. Если
   * задан, сопротивление става длиной L считается по этим участкам: став
   * короче фактического обрезается, длиннее — наращивается рукавом
   * ПОСЛЕДНЕГО участка (так став и удлиняют при проходке). Это точнее
   * rScale: при Ø1200 + Ø800 удлинение идёт рукавом Ø800, и сопротивление
   * растёт быстрее, чем пропорционально длине.
   */
  rProfile?: DuctProfile;
}

/** Участки става: диаметр, мм, и длина, м — по ходу воздуха */
export interface DuctProfile {
  segments: { diameter: number; length: number }[];
  /** Выход струи в забой учитывать (ξ = 1 по диаметру последнего участка) */
  exitLoss: boolean;
}

/** Диаметр (мм) на расстоянии x от вентилятора; за концом — последний */
export function profileDiameterAt(profile: DuctProfile, x: number): number {
  let acc = 0;
  for (const sg of profile.segments) {
    acc += sg.length;
    if (x <= acc) return sg.diameter;
  }
  return profile.segments[profile.segments.length - 1]?.diameter ?? 0;
}

/**
 * Сопротивление става длиной L по фактическим участкам, кМюрг.
 * Местные ξ (повороты) — по диаметру первого участка.
 */
export function profileResistance(
  profile: DuctProfile, alpha: number, L: number, localXi: number, rho = RHO_DEFAULT,
): number {
  const segs = profile.segments.filter(x => x.diameter > 0 && x.length > 0);
  if (segs.length === 0 || L <= 0) return 0;
  let left = L, r = 0, lastD = segs[0].diameter;
  for (const sg of segs) {
    if (left <= 0) break;
    const take = Math.min(left, sg.length);
    r += resistanceFromPipe(alpha, take, sg.diameter / 1000);
    left -= take; lastD = sg.diameter;
  }
  if (left > 0) {
    lastD = segs[segs.length - 1].diameter;
    r += resistanceFromPipe(alpha, left, lastD / 1000);
  }
  const local = (d: number, xi: number) => {
    const S = ductArea(d);
    return S > 0 && xi > 0 ? (xi * rho) / (2 * S * S) / 9.81 : 0;
  };
  r += local(segs[0].diameter, localXi);
  if (profile.exitLoss) r += local(lastD, 1);
  return isFinite(r) ? Math.min(r, 1e6) : 0;
}

/** Результат расчёта става */
export interface VentPipeResult {
  /** Аэродинамическое сопротивление става, кМюрг (Н·с²/м⁸ ×10⁻⁴) */
  R: number;
  /** Площадь сечения рукава, м² */
  area: number;
  /** Коэффициент доставки воздуха Kу.т = Q_забой / Q_вент (0..1) */
  delivery: number;
  /** Расход воздуха у вентилятора (вход в став), м³/с */
  flowFan: number;
  /** Расход воздуха в забое (выход из става), м³/с */
  flowFace: number;
  /** Утечки воздуха по длине става, м³/с */
  leakage: number;
  /** Утечки в процентах от подачи вентилятора, % */
  leakagePercent: number;
  /** Средняя скорость воздуха в ставе, м/с */
  velocity: number;
  /** Потери давления в ставе (депрессия става), Па */
  deltaP: number;
  /** Скорость воздуха на выходе в забой, м/с */
  velocityFace: number;
  /**
   * Заполняется только для методики "kolavent": пояснение, откуда взят
   * коэффициент утечек (формула или конкретная таблица изготовителя).
   */
  leakNote?: string;
  /**
   * Заполняется только для методики "kolavent": причина, по которой
   * изготовитель не подтверждает это сочетание длины, диаметра и расхода.
   * Если поле заполнено, числам расчёта доверять нельзя — нужно менять диаметр.
   */
  leakUnsupported?: string;
  /** Диаметры (мм), при которых у изготовителя данные есть */
  leakSuggest?: number[];
}

/** Плотность воздуха по умолчанию, кг/м³ */
const RHO_DEFAULT = 1.2;

/**
 * Площадь сечения круглого рукава по внутреннему диаметру в мм.
 */
export function ductArea(diameterMm: number): number {
  const d = diameterMm / 1000;
  return d > 0 ? (Math.PI * d * d) / 4 : 0;
}

/**
 * Коэффициенты местного сопротивления ξ для поворотов гибкого става.
 *
 * Значения справочные (горная аэродинамика, плавный отвод круглого сечения
 * R/D ≈ 1,5 — так рукав и укладывается по выработке):
 *   • поворот 90° — ξ ≈ 0,30
 *   • поворот 45° — ξ ≈ 0,15
 *
 * Повороты — самая частая причина расхождения расчёта с фактом: на ставе с
 * несколькими коленами они дают заметную добавку к сопротивлению, а вручную
 * сумму ξ почти никто не набирает. Поэтому их считаем по количеству.
 */
export const BEND_XI_90 = 0.30;
export const BEND_XI_45 = 0.15;

/**
 * Суммарный ξ става: повороты по количеству + прочие фасонные части вручную.
 * Отдельное поле «прочие» оставлено, чтобы можно было учесть переходы,
 * тройники и нестандартные элементы, которых нет в списке поворотов.
 */
export function totalLocalXi(
  bends90: number,
  bends45: number,
  otherXi: number,
): number {
  const n90 = Math.max(0, Math.floor(bends90 || 0));
  const n45 = Math.max(0, Math.floor(bends45 || 0));
  const other = Math.max(0, otherXi || 0);
  return n90 * BEND_XI_90 + n45 * BEND_XI_45 + other;
}


/**
 * Аэродинамическое сопротивление става, кМюрг.
 *
 * Формула горной аэродинамики: R = 6.48 · α · L / D⁵
 *   α — коэффициент аэродинамического сопротивления, ×10⁻⁴ Н·с²/м⁴
 *   L — длина става, м
 *   D — внутренний диаметр, м
 *
 * ПРО СТЫКИ. Отдельной надбавки за стыки здесь НЕТ, и это принципиально.
 * Коэффициент α = 0,00024 изготовитель даёт для РЕАЛЬНОГО става, собранного из
 * звеньев со стыками, — сопротивление стыков в нём уже сидит. Таблица 2
 * («аэродинамическое сопротивление гибкого вентиляционного трубопровода»)
 * посчитана по этому α без каких-либо добавок.
 *
 * Раньше здесь к α добавлялось по 2 % за каждый стык. На ставе 1000 м со
 * звеньями по 20 м это 50 стыков, то есть УДВОЕНИЕ сопротивления, а на 2000 м —
 * утроение. Стыки при этом учитывались дважды: один раз внутри паспортного α,
 * второй раз надбавкой. Из-за этого рабочая точка вентилятора уезжала влево и
 * подача занижалась в разы.
 *
 * Качество сборки стыков влияет на УТЕЧКИ — это учитывается отдельно, в
 * коэффициенте доставки воздуха (нормативная методика, параметр k_ст).
 *
 * Местные сопротивления (повороты, переходы) добавляются отдельным слагаемым
 * R_мест = ξ · ρ / (2 · S²) — это уже не стыки, а фасонные части.
 */
export function ductResistance(
  alpha: number,
  length: number,
  diameterMm: number,
  localXi: number,
  density: number = RHO_DEFAULT,
): number {
  const D = diameterMm / 1000;
  if (D <= 0 || length <= 0) return 0;

  // Сопротивление по длине, кМюрг — общая формула проекта R = 6.48·α·L/D⁵.
  // α берётся как есть: сопротивление стыков уже входит в паспортное значение.
  const rFriction = resistanceFromPipe(alpha, length, D);

  // Местные сопротивления: R = ξ·ρ/(2·S²) даёт Н·с²/м⁸, а R по проекту
  // хранится в кМюрг (кгс·с²/м⁸) — делим на 9,81, чтобы единицы совпали.
  const S = ductArea(diameterMm);
  const rLocal = S > 0 ? (localXi * density) / (2 * S * S) / 9.81 : 0;

  const total = rFriction + rLocal;
  return isFinite(total) ? Math.min(total, 1e6) : 0;
}

/**
 * Коэффициент доставки воздуха ПО ПАСПОРТУ рукава.
 *
 * Изготовитель даёт потери p % на каждые 100 м става. Утечки нарастают
 * геометрически: на первых 100 м теряется p % от подачи вентилятора, на
 * вторых — p % от ОСТАВШЕГОСЯ, и так далее. Отсюда:
 *
 *     Kу.т = (1 − p/100) ^ (L/100)
 *
 * Например, при p = 1,2 % и L = 500 м: Kу.т = 0.988⁵ ≈ 0.941 → в забой
 * приходит 94 % воздуха.
 */
export function deliveryByPassport(lossPer100m: number, length: number): number {
  if (length <= 0) return 1;
  const p = Math.max(0, Math.min(99, lossPer100m)) / 100;
  const k = Math.pow(1 - p, length / 100);
  return Math.max(0.01, Math.min(1, k));
}

/**
 * Коэффициент доставки воздуха ПО НОРМАТИВНОЙ ФОРМУЛЕ.
 *
 * Нормативная методика (Руководство по проектированию вентиляции шахт)
 * рассчитывает утечки через стыки звеньев с учётом ДАВЛЕНИЯ в ставе:
 *
 *     Kу.т = 1 / (1 + (k_ст · √(R_ст) · L) / (3 · l_зв · √D) )²
 *
 * где
 *   k_ст   — удельный стыковой расход (для рукавов с внутренними кольцами
 *            принимается 0,003 м³/(с·даПа^0,5) на один стык);
 *   R_ст   — аэродинамическое сопротивление става, кМюрг;
 *   L      — длина става, м;
 *   l_зв   — длина одного звена рукава, м;
 *   D      — диаметр става, м.
 *
 * Физический смысл: утечка через стык пропорциональна корню из давления, а
 * давление в ставе растёт вместе с его сопротивлением и длиной. Поэтому с
 * ростом длины доставка падает быстрее, чем по паспортной методике — это
 * запасной (осторожный) вариант расчёта.
 */
export function deliveryByNormative(
  R: number,
  length: number,
  diameterMm: number,
  linkLength: number,
  jointLeakK?: number,
): number {
  const D = diameterMm / 1000;
  const l = linkLength > 0 ? linkLength : 20;
  if (length <= 0 || D <= 0 || R <= 0) return 1;

  // Удельный стыковой расход. По умолчанию 0,003 — гибкий рукав с внутренними
  // кольцами при обычной сборке. Плохо затянутые стыки, изношенный или
  // латаный рукав — больше (до 0,01); тщательная сборка нового — меньше.
  const kSt = (jointLeakK ?? 0) > 0 ? jointLeakK! : 0.003;

  const denom = 3 * l * Math.sqrt(D);
  if (denom <= 0) return 1;

  const x = (kSt * Math.sqrt(R) * length) / denom;
  const k = 1 / Math.pow(1 + x, 2);
  return Math.max(0.01, Math.min(1, k));
}

/**
 * Рабочая точка вентилятора на став сопротивлением R.
 *
 * Ищем расход Q, при котором напор вентилятора равен потерям в ставе:
 *
 *     H(Q) = R · Q² · 9.81
 *
 * Слева напор падает с ростом расхода, справа потери растут — значит,
 * пересечение единственное и его находит половинное деление.
 *
 * Это ответ на вопрос «сколько воздуха вентилятор реально прогонит через
 * став такой длины»: с удлинением става подача падает по паспортной кривой.
 */
export function solveFanFlow(fanCurve: (Q: number) => number, R: number): number {
  if (R <= 0) return 0;
  const f = (Q: number) => fanCurve(Q) - depression(R, Q);

  // Если даже при нулевом расходе напора нет — вентилятор не работает.
  if (f(0.001) <= 0) return 0;

  // Расширяем верхнюю границу, пока потери не перевесят напор.
  let hi = 1;
  for (let i = 0; i < 40 && f(hi) > 0; i++) hi *= 1.6;
  if (f(hi) > 0) return hi;

  let lo = 0.001;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
    if (hi - lo < 1e-4) break;
  }
  return (lo + hi) / 2;
}

/**
 * Полный расчёт вентиляционного става (нагнетательная схема).
 *
 * Возвращает сопротивление, коэффициент доставки, расход в забое, утечки,
 * скорость и депрессию става.
 */
export function calcVentPipe(input: VentPipeInput): VentPipeResult {
  const rho = input.density ?? RHO_DEFAULT;
  const area = ductArea(input.diameter);

  // Стыки на сопротивление отдельно не влияют: они уже учтены в паспортном α
  // изготовителя (см. пояснение в ductResistance). На утечки они влияют — это
  // считается ниже, в коэффициенте доставки.
  const R = input.rProfile && input.rProfile.segments.length > 0
    ? profileResistance(input.rProfile, input.alpha, input.length, input.localXi, rho)
    : ductResistance(
        input.alpha,
        input.length,
        input.diameter,
        input.localXi,
        rho,
      ) * (input.rScale && input.rScale > 0 ? input.rScale : 1);

  // Подача вентилятора нужна заранее: таблицы изготовителя привязаны к
  // расходу В ЗАБОЕ, а он сам зависит от утечек. Разрываем эту зависимость
  // ниже — несколькими уточняющими проходами.
  const fanFlowPre = input.fanCurve ? solveFanFlow(input.fanCurve, R) : Math.max(0, input.fanFlow);

  let leakNote: string | undefined;
  let leakUnsupported: string | undefined;
  let leakSuggest: number[] | undefined;

  let delivery: number;
  if (input.method === "normative") {
    delivery = deliveryByNormative(R, input.length, input.diameter, input.linkLength, input.jointLeakK);
  } else if (input.method === "kolavent") {
    // Таблица выбирается по расходу в забое, а он равен подаче × доставку.
    // Считаем итерациями: начинаем с подачи вентилятора и три раза уточняем.
    // Сходится быстро, потому что доставка близка к единице.
    let q = fanFlowPre;
    let res = kolaVentLeak(input.length, input.diameter, q);
    for (let i = 0; i < 3 && res.k != null; i++) {
      const next = fanFlowPre / res.k;
      const r2 = kolaVentLeak(input.length, input.diameter, next);
      if (r2.k == null) { res = r2; break; }
      if (Math.abs(next - q) < 0.01) { res = r2; q = next; break; }
      q = next;
      res = r2;
    }
    if (res.k == null) {
      // Сочетание не подтверждено изготовителем. Чтобы интерфейс не показывал
      // пустые поля, считаем по паспорту, но помечаем результат как
      // неподтверждённый — инженер увидит предупреждение, а не молчаливое число.
      delivery = deliveryByPassport(input.lossPer100m, input.length);
      leakUnsupported = res.reason;
      leakSuggest = res.suggest;
    } else {
      delivery = res.delivery;
      leakNote = res.note;
    }
  } else {
    delivery = deliveryByPassport(input.lossPer100m, input.length);
  }

  // Подача вентилятора на ЭТОЙ длине става. Рабочая точка — пересечение
  // характеристики вентилятора H(Q) с характеристикой става ΔP = R·Q².
  // Чем длиннее став, тем выше его сопротивление и тем меньше подача.
  const flowFan = fanFlowPre;
  const flowFace = flowFan * delivery;
  const leakage = flowFan - flowFace;

  // Депрессия става считается по СРЕДНЕМУ расходу: у вентилятора расход
  // максимальный, у забоя — минимальный, воздух утекает постепенно.
  // Использовать полную подачу вентилятора было бы завышением, а расход
  // забоя — занижением потерь.
  const qAvg = (flowFan + flowFace) / 2;
  // Депрессия ΔP = R·Q². Сопротивление хранится в кМюрг (кгс·с²/м⁸), поэтому
  // произведение R·Q² выходит в мм вод. ст. — умножаем на 9,81, чтобы
  // получить паскали. Те же единицы, что у напора вентилятора.
  const deltaP = depression(R, qAvg);

  const velocity = area > 0 ? qAvg / area : 0;
  const velocityFace = area > 0 ? flowFace / area : 0;

  return {
    R,
    area,
    delivery,
    flowFan,
    flowFace,
    leakage,
    leakagePercent: flowFan > 0 ? (leakage / flowFan) * 100 : 0,
    velocity,
    deltaP,
    velocityFace,
    leakNote,
    leakUnsupported,
    leakSuggest,
  };
}

/** Результат расчёта предельной длины става */
export interface VentPipeLimitResult {
  /** Предельная длина става, м (0 = требуемый расход недостижим даже вблизи) */
  maxLength: number;
  /** Ограничение, которое сработало первым */
  limitedBy: "flow" | "pressure" | "none";
  /** Расход в забое на предельной длине, м³/с */
  flowAtLimit: number;
  /** Депрессия става на предельной длине, Па */
  deltaPAtLimit: number;
  /** Запас длины относительно текущей, м (отрицательный = став уже длиннее) */
  reserve: number;
}

/**
 * ОБРАТНАЯ ЗАДАЧА: на какую максимальную длину хватит става?
 *
 * Задаём требуемый расход в забое (по газу, людям, взрывным работам) и ищем
 * длину, при которой воздуха ещё хватает. С ростом длины одновременно:
 *   • растут утечки → в забой приходит меньше воздуха;
 *   • растёт сопротивление → нужен больший напор вентилятора.
 *
 * Поэтому проверяются ДВА ограничения, и берётся то, что наступит раньше:
 *   1. по расходу   — в забое должно быть не меньше требуемого;
 *   2. по давлению  — депрессия става не должна превышать напор вентилятора
 *                     (и паспортное рабочее давление рукава).
 *
 * Ищем методом половинного деления: обе величины монотонно ухудшаются с
 * длиной, поэтому решение единственное.
 */
export function calcVentPipeMaxLength(
  input: Omit<VentPipeInput, "length">,
  requiredFaceFlow: number,
  maxPressure: number,
  currentLength: number,
  searchLimit: number = 3000,
): VentPipeLimitResult {
  /** Проверяет, годится ли став длиной L: хватает и воздуха, и давления */
  const check = (L: number): { okFlow: boolean; okPressure: boolean; res: VentPipeResult } => {
    const res = calcVentPipe({ ...input, length: L });
    return {
      okFlow: res.flowFace >= requiredFaceFlow,
      okPressure: maxPressure <= 0 || res.deltaP <= maxPressure,
      res,
    };
  };

  // Проверяем минимальную длину: если даже 1 м не проходит — задача нерешаема
  // (вентилятор слаб или требование завышено).
  const atMin = check(1);
  if (!atMin.okFlow || !atMin.okPressure) {
    return {
      maxLength: 0,
      limitedBy: !atMin.okFlow ? "flow" : "pressure",
      flowAtLimit: atMin.res.flowFace,
      deltaPAtLimit: atMin.res.deltaP,
      reserve: -currentLength,
    };
  }

  // Проверяем верхнюю границу поиска: если и там всё хорошо — ограничения нет.
  const atMax = check(searchLimit);
  if (atMax.okFlow && atMax.okPressure) {
    return {
      maxLength: searchLimit,
      limitedBy: "none",
      flowAtLimit: atMax.res.flowFace,
      deltaPAtLimit: atMax.res.deltaP,
      reserve: searchLimit - currentLength,
    };
  }

  // Половинное деление: lo — заведомо годная длина, hi — заведомо негодная.
  let lo = 1;
  let hi = searchLimit;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const c = check(mid);
    if (c.okFlow && c.okPressure) lo = mid; else hi = mid;
    if (hi - lo < 0.5) break;
  }

  const final = check(lo);
  // Определяем, какое ограничение сработало: смотрим чуть дальше предела.
  const beyond = check(lo + 1);
  const limitedBy: "flow" | "pressure" = !beyond.okFlow ? "flow" : "pressure";

  return {
    maxLength: lo,
    limitedBy,
    flowAtLimit: final.res.flowFace,
    deltaPAtLimit: final.res.deltaP,
    reserve: lo - currentLength,
  };
}

/**
 * Строит кривую «расход в забое от длины става» для графика.
 * Показывает пользователю, где начинается провал по воздуху.
 */
export function buildDeliveryCurve(
  input: Omit<VentPipeInput, "length">,
  maxLength: number,
  points: number = 40,
): { length: number; flowFace: number; deltaP: number }[] {
  const out: { length: number; flowFace: number; deltaP: number }[] = [];
  const step = Math.max(1, maxLength / points);
  for (let L = 0; L <= maxLength + 0.01; L += step) {
    const r = calcVentPipe({ ...input, length: Math.max(1, L) });
    out.push({ length: L, flowFace: r.flowFace, deltaP: r.deltaP });
  }
  return out;
}

/** Фактический став от данной ветви по ходу воздуха: участки по диаметрам. */
export interface VentPipeChain {
  /** Сопротивление цепочки, кМюрг (как уходит в расчёт сети, ÷g) */
  rKgf: number;
  length: number;
  links: number;
  profile: DuctProfile;
}

/**
 * Собирает став, начиная с ветви branch, по звеньям isVentPipeBranch до
 * следующего вентилятора или развилки. Подряд идущие звенья одного диаметра
 * объединяются в участок. Общая функция для вкладки «Вентстав» и отчёта.
 */
export function ventPipeChainFrom(branch: TopoBranch, allBranches: TopoBranch[]): VentPipeChain | null {
  if (!branch.isVentPipeBranch) return null;
  const next = new Map<string, TopoBranch[]>();
  for (const x of allBranches) {
    if (!x.isVentPipeBranch) continue;
    const arr = next.get(x.fromId) ?? [];
    arr.push(x); next.set(x.fromId, arr);
  }
  const diaOf = (x: TopoBranch) =>
    Math.round((x.pipeDiameter ?? 0) * 1000) || x.vpDiameter || 0;
  let rSi = branch.resistance ?? 0, len = branch.length ?? 0, links = 1;
  const seen = new Set([branch.id]);
  const segs: { diameter: number; length: number }[] = [
    { diameter: diaOf(branch), length: branch.length ?? 0 },
  ];
  let cur = branch;
  for (;;) {
    const cand = (next.get(cur.toId) ?? []).filter(x => !seen.has(x.id));
    if (cand.length !== 1) break;
    if (cand[0].hasFan) break;
    cur = cand[0]; seen.add(cur.id);
    rSi += cur.resistance ?? 0; len += cur.length ?? 0; links++;
    const d = diaOf(cur), last = segs[segs.length - 1];
    if (last.diameter === d) last.length += cur.length ?? 0;
    else segs.push({ diameter: d, length: cur.length ?? 0 });
  }
  const exitLoss = /\(выход\)/.test(cur.type ?? "");
  return links > 1 && rSi > 0
    ? { rKgf: rSi / 9.80665, length: len, links, profile: { segments: segs.filter(x => x.length > 0 && x.diameter > 0), exitLoss } }
    : null;
}

/**
 * Диаметр для сравнения «наращивать другим рукавом»: заданный
 * пользователем, иначе самый большой из уже стоящих в ставе, иначе
 * ближайший больший из списка типоразмеров.
 */
export function pickAltDiameter(
  chain: VentPipeChain, sizes: number[], userChoice?: number,
): { lastDia: number; altDia: number; options: number[] } {
  const segs = chain.profile.segments;
  const lastDia = segs[segs.length - 1]?.diameter ?? 0;
  const options = Array.from(new Set([...sizes, ...segs.map(z => z.diameter)]))
    .filter(d => d !== lastDia).sort((a, b) => a - b);
  const autoAlt = Math.max(...segs.map(z => z.diameter));
  const altDia = (userChoice ?? 0) > 0 && userChoice !== lastDia
    ? userChoice!
    : (autoAlt !== lastDia ? autoAlt : (options.find(d => d > lastDia) ?? 0));
  return { lastDia, altDia, options };
}

/** Профиль става, который после нынешних участков наращивается рукавом altDia */
export function profileWithExtension(profile: DuctProfile, altDia: number): DuctProfile {
  return { ...profile, segments: [...profile.segments, { diameter: altDia, length: 1e6 }] };
}
