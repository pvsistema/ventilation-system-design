// ─────────────────────────────────────────────────────────────────────────────
// evaluate.ts — оценка одного варианта управления.
//
// ЗАЧЕМ. Вариант нужно уметь сравнить с другим, а значит — свести его исход
// к нескольким числам. Главных здесь два, и они видны в окне результата:
// сколько людей НЕ УСПЕВАЮТ выйти и сколько выработок вышло за допустимую
// скорость воздуха. Первое — жизни, второе — нарушение правил безопасности,
// из-за которого режим нельзя утвердить в плане ликвидации аварий.
//
// НОВОЙ ФИЗИКИ ЗДЕСЬ НЕТ. Вариант прогоняется через тот же runFireMode и тот
// же calcEvacuationRisk, которыми считается обычный пожарный режим по кнопке.
// Это принципиально: подбор обязан обещать ровно то, что пользователь увидит,
// нажав «Применить» и пересчитав вручную. Любая «быстрая упрощённая оценка»
// внутри подбора рано или поздно разошлась бы с настоящим расчётом, и
// рекомендация оказалась бы враньём.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { runFireMode, type FireModeRunParams } from "@/lib/fireModeRun";
import { calcEvacuationRisk, type EvacRiskOptions, type EvacRiskRow } from "@/lib/evacuationRisk";
import { applyActions, totalEffort, describeActions, type FireAction } from "./actions";
import { checkRdRules, hasRdProblem, type RdNote } from "./rdRules";

/** Что подставить в расчёт помимо самих действий. */
export interface EvaluateContext {
  branches: TopoBranch[];
  nodes: TopoNode[];
  symbols: SchemaSymbol[];
  /** Параметры пожарного режима — те же, что у кнопки расчёта пожара. */
  fireParams: Omit<FireModeRunParams, "branches" | "nodes">;
  /** Параметры оценки вывода людей. */
  evacOptions?: Partial<EvacRiskOptions>;
  /**
   * Пересчёт сопротивлений и депрессий после изменения дверей.
   *
   * Сопротивление перемычки считается не в ветви, а по значку схемы
   * (см. bulkheadRByBranch в Cad.tsx), и та же логика лежит в payload для
   * решателя. Поэтому изменение площади окна обязано пройти через тот же
   * код, что и ручная правка, — иначе закрытая дверь не повлияла бы на
   * расчёт вовсе. Функцию передаёт вызывающая сторона.
   */
  rebuild?: (branches: TopoBranch[], symbols: SchemaSymbol[]) => {
    branches: TopoBranch[];
    totalDepByBranch: Map<string, number>;
  };
}

/**
 * Строка «Пути и время выхода людей» для оперативной части ПЛА
 * (РД-15-11-2007, Приложение 1, графа 3).
 *
 * Собирается из расчёта, а не пишется вручную: переписывание маршрутов
 * в план — источник ошибок, а время выхода там обязано совпадать с расчётным.
 */
export interface EvacActionLine {
  /** Рабочее место. */
  place: string;
  /** Людей, чел. */
  people: number;
  /** До очага / за очагом / вне струи. */
  zone: "before" | "after" | "aside";
  /** Текст мероприятия по п.25 — как его записывают в план. */
  text: string;
  /** Время выхода, мин. */
  timeMin: number;
}

/** Итог одного варианта — то, что показывается строкой в окне. */
export interface VariantResult {
  /** Набор действий варианта. Пустой — это исходное состояние. */
  actions: FireAction[];
  /** Заголовок: «Закрыть дверь в кв. 12 + Реверсировать ВГП». */
  title: string;
  /** Людей, не успевающих выйти до истечения самоспасателя. */
  peopleAtRisk: number;
  /** Людей в зоне задымления. */
  peopleInSmoke: number;
  /** Людей, спасаемых пунктом переключения. */
  peopleNeedSwitch: number;
  /**
   * Людей ЗА очагом пожара (РД п.25) — их выводят только в изолирующих
   * самоспасателях через дым. Зависит от режима: реверс переворачивает струю
   * и может перевести людей в зону «до очага», где выход идёт по свежему
   * воздуху. Поэтому показатель участвует и в сравнении вариантов.
   */
  peopleAfterFire: number;
  /** Людей ДО очага — выходят навстречу свежей струе. */
  peopleBeforeFire: number;
  /** Замечания по соответствию РД-15-11-2007 (п.29, п.30). */
  rdNotes: RdNote[];
  /** Мероприятия по выводу людей — готовый текст для оперативной части ПЛА. */
  evacActions: EvacActionLine[];
  /** Выработок с превышением допустимой скорости воздуха. */
  velocityViolations: number;
  /** Ветви с превышением — для подсветки на схеме. */
  violationBranchIds: string[];
  /** Опрокинутых струй — реверс потока относительно штатного режима. */
  reversedBranches: number;
  /** Суммарная трудоёмкость, мин. */
  effortMin: number;
  /** Расходы по ветвям в этом варианте — для предпросмотра на схеме. */
  flows: Map<string, number>;
  /** Задымление по ветвям — для предпросмотра. */
  smokeByBranch: Map<string, number>;
  /** Расчёт сети не сошёлся: числа ориентировочные. */
  failed: boolean;
  /**
   * Оценка вывода людей невозможна: на схеме не заданы рабочие места или
   * выходы на поверхность. В этом случае peopleAtRisk и соседние поля равны
   * нулю НЕ потому, что все спасены, а потому, что считать не по чему.
   *
   * Поле обязано дойти до окна: без него подбор рапортовал «все успевают
   * выйти» на схеме, где про людей вообще ничего не сказано.
   */
  dataError?: string;
}

/**
 * Нарушения по скорости воздуха.
 *
 * Скорость сравнивается с vMax самой ветви — тем же пределом, который
 * программа показывает красным в таблице расходов (см. canvasRenderer:
 * overV = V > b.vMax). Ветви без заданного предела пропускаются: нулевой
 * vMax означает «не нормируется», а не «запрещено любое движение».
 */
function countVelocityViolations(
  branches: TopoBranch[],
  flows: Map<string, number>,
): { count: number; ids: string[] } {
  const ids: string[] = [];
  for (const b of branches) {
    const vMax = b.vMax ?? 0;
    const area = b.area ?? 0;
    if (vMax <= 0 || area <= 0) continue;
    const Q = Math.abs(flows.get(b.id) ?? b.flow ?? 0);
    if (Q / area > vMax) ids.push(b.id);
  }
  return { count: ids.length, ids };
}

/**
 * Мероприятия по выводу людей — дословно по РД-15-11-2007, п.25.
 *
 * Формулировки разные по сторонам от очага, и это не стилистика:
 *   • до очага — «навстречу свежей струе к выходу на поверхность»;
 *   • за очагом — «в изолирующих самоспасателях кратчайшим путём в выработки
 *     со свежей струёй и далее на поверхность».
 * Именно такой текст ждут в оперативной части плана.
 */
function buildEvacActions(rows: EvacRiskRow[]): EvacActionLine[] {
  return rows.map(r => {
    const place = r.description || r.nodeName || `узел № ${r.nodeNumber}`;
    let text: string;
    if (r.zone === "after") {
      const via = r.freshAirNodeName !== "—"
        ? `в «${r.freshAirNodeName}» (${r.freshAirTime.toFixed(0)} мин)`
        : "в ближайшие выработки со свежей струёй";
      text = `Включиться в изолирующие самоспасатели, выходить кратчайшим путём ${via}, `
        + `далее на поверхность через «${r.exitName}».`;
    } else {
      text = `Выходить навстречу свежей струе к выходу на поверхность через «${r.exitName}».`;
    }
    if (r.level === "needs-switch" && r.switchPointName !== "—") {
      text += ` Переключение в новый самоспасатель в «${r.switchPointName}» `
        + `(${r.switchPointTime.toFixed(0)} мин).`;
    }
    return { place, people: r.peopleCount, zone: r.zone, text, timeMin: r.evacTime };
  });
}

/**
 * Посчитать один вариант: применить действия, прогнать пожар, оценить вывод.
 *
 * Возвращает failed=true, если сеть не сошлась. Такой вариант не отбрасывается
 * молча: человеку важно видеть, что рычаг был рассмотрен и почему не подошёл.
 */
export async function evaluateVariant(
  ctx: EvaluateContext,
  actions: FireAction[],
): Promise<VariantResult> {
  const applied = applyActions(ctx.branches, ctx.symbols, actions);

  // Пересчёт сопротивлений после изменения дверей.
  const rebuilt = ctx.rebuild?.(applied.branches, applied.symbols);
  const branches = rebuilt?.branches ?? applied.branches;
  const totalDep = rebuilt?.totalDepByBranch ?? ctx.fireParams.totalDepByBranch;

  const base = {
    actions,
    title: describeActions(actions),
    effortMin: totalEffort(actions),
  };

  const fire = await runFireMode({
    ...ctx.fireParams,
    totalDepByBranch: totalDep,
    branches,
    nodes: ctx.nodes,
  });

  // Пустая карта расходов — решатель вернул ошибку.
  if (fire.flows.size === 0) {
    return {
      ...base,
      peopleAtRisk: Number.POSITIVE_INFINITY,
      peopleInSmoke: 0, peopleNeedSwitch: 0,
      peopleAfterFire: 0, peopleBeforeFire: 0,
      rdNotes: [], evacActions: [],
      velocityViolations: 0, violationBranchIds: [],
      reversedBranches: 0,
      flows: new Map(), smokeByBranch: new Map(),
      failed: true,
    };
  }

  // Ветви с результатами пожара — ровно так же, как их применяет кнопка
  // расчёта: без этого оценка вывода людей не увидит задымления.
  const branchesAfter = branches.map(b => {
    const fr = fire.result.branches.get(b.id);
    const q = fire.flows.get(b.id);
    return {
      ...b,
      flow: q ?? b.flow,
      fireComputedTemp:      fr?.airTempOut      ?? 0,
      fireComputedNatDep:    fr?.thermalDepression ?? 0,
      fireComputedSmokeDens: fr?.smokeDensity    ?? 0,
      fireComputedCO:        fr?.coConc          ?? 0,
      fireComputedCO2:       fr?.co2Conc         ?? 0,
    };
  });

  const evac = calcEvacuationRisk(ctx.nodes, branchesAfter, ctx.evacOptions);
  const velocity = countVelocityViolations(branchesAfter, fire.flows);
  const rdNotes = checkRdRules({
    branches: branchesAfter,
    nodes: ctx.nodes,
    actions,
    reversedBranchCount: fire.result.reversedBranches.size,
  });

  const smokeByBranch = new Map<string, number>();
  for (const [id, fr] of fire.result.branches) {
    smokeByBranch.set(id, fr.smokeDensity ?? 0);
  }

  return {
    ...base,
    // Нет рабочих мест или выходов — сравнивать варианты по людям нельзя.
    // Нули здесь означают «не посчитано», и об этом прямо говорит dataError:
    // иначе подбор показал бы «все успевают выйти» там, где про людей на
    // схеме не сказано ни слова.
    dataError: evac.error ?? undefined,
    peopleAtRisk:     evac.error ? 0 : evac.peopleAtRisk,
    peopleInSmoke:    evac.error ? 0 : evac.peopleInSmoke,
    peopleNeedSwitch: evac.error ? 0 : evac.peopleNeedSwitch,
    peopleAfterFire:  evac.error ? 0 : evac.peopleAfterFire,
    peopleBeforeFire: evac.error ? 0 : evac.peopleBeforeFire,
    rdNotes,
    evacActions: evac.error ? [] : buildEvacActions(evac.rows),
    velocityViolations: velocity.count,
    violationBranchIds: velocity.ids,
    reversedBranches: fire.result.reversedBranches.size,
    flows: fire.flows,
    smokeByBranch,
    failed: false,
  };
}

/**
 * Сравнение вариантов: чем меньше — тем лучше.
 *
 * Порядок приоритетов задан не вкусом, а смыслом аварийного плана:
 *   1. люди, не успевающие выйти — это жизни, здесь компромиссов нет;
 *   2. люди ЗА ОЧАГОМ (РД п.25) — их выводят через дым в самоспасателях,
 *      и режим, уводящий их на свежую струю, объективно лучше даже при
 *      одинаковом числе «не успевающих»;
 *   3. расхождение с предписаниями РД п.30 — такой режим не утвердят;
 *   4. нарушения допустимой скорости — тоже основание не утвердить;
 *   5. люди в зоне задымления — отравление даже при успешном выходе;
 *   6. трудоёмкость — при прочих равных берём то, что успеют сделать;
 *   7. число действий — короткая команда исполняется без ошибок.
 *
 * Несошедшийся вариант всегда хуже любого сошедшегося.
 */
export function compareVariants(a: VariantResult, b: VariantResult): number {
  if (a.failed !== b.failed) return a.failed ? 1 : -1;
  if (a.peopleAtRisk !== b.peopleAtRisk) return a.peopleAtRisk - b.peopleAtRisk;
  if (a.peopleAfterFire !== b.peopleAfterFire) {
    return a.peopleAfterFire - b.peopleAfterFire;
  }
  const aRd = hasRdProblem(a.rdNotes) ? 1 : 0;
  const bRd = hasRdProblem(b.rdNotes) ? 1 : 0;
  if (aRd !== bRd) return aRd - bRd;
  if (a.velocityViolations !== b.velocityViolations) {
    return a.velocityViolations - b.velocityViolations;
  }
  if (a.peopleInSmoke !== b.peopleInSmoke) return a.peopleInSmoke - b.peopleInSmoke;
  if (a.effortMin !== b.effortMin) return a.effortMin - b.effortMin;
  return a.actions.length - b.actions.length;
}