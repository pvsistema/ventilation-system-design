// ─────────────────────────────────────────────────────────────────────────────
// search.ts — поиск лучшего варианта управления при пожаре.
//
// ЗАЧЕМ. Даже после отбора кандидатов полный перебор комбинаций невозможен:
// 20 рычагов дают 190 пар и 1140 троек, а каждая проверка — это полный
// расчёт вентиляционной сети через решатель, то есть секунды. Ждать час
// никто не будет.
//
// Поэтому поиск жадный и послойный:
//   слой 0 — исходное состояние («ничего не менять») как точка отсчёта;
//   слой 1 — все одиночные действия;
//   слой 2 — к лучшим одиночным добавляется второе действие;
//   слой 3 — к лучшим парам добавляется третье.
// Между слоями остаются только BEAM лучших веток. Это не гарантирует
// глобального оптимума, но находит то же, что находит опытный человек,
// и за обозримое время.
//
// ЧЕСТНОСТЬ ВЫВОДА. Поиск не обязан найти спасительный вариант, и когда
// его нет — это главный результат, а не неудача. Отчёт прямо содержит
// поле allSaved и число оставшихся в зоне риска: молчать о том, что людей
// не вывести имеющимися рычагами, нельзя.
// ─────────────────────────────────────────────────────────────────────────────
import { collectActions, conflicts, type CandidateInput, type CandidateStats } from "./candidates";
import {
  evaluateVariant, compareVariants,
  type EvaluateContext, type VariantResult,
} from "./evaluate";
import { hasRdProblem } from "./rdRules";
import type { FireAction } from "./actions";

/** Сколько лучших веток проносим в следующий слой. */
const BEAM = 3;
/** Предохранитель: больше расчётов за один поиск не делаем. */
const MAX_EVALUATIONS = 120;

export interface SearchOptions {
  /** Максимум действий в варианте (1..3). По умолчанию 2. */
  maxActions?: number;
  /** Сколько вариантов вернуть в отчёте. По умолчанию 5. */
  topN?: number;
  /** Глубина отбора кандидатов — см. CandidateInput.reach. */
  reach?: number;
  /** Ход поиска: доля 0..1 и подпись текущего шага. */
  onProgress?: (done: number, total: number, label: string) => void;
  /** Прервать поиск (пользователь закрыл окно). */
  isCancelled?: () => boolean;
}

export interface SearchReport {
  /** Исходное состояние — с чем сравнивать варианты. */
  base: VariantResult;
  /** Лучшие варианты, от лучшего к худшему. */
  variants: VariantResult[];
  /** Всего рассмотрено действий-кандидатов. */
  candidatesCount: number;
  /** Сколько раз считалась сеть. */
  evaluations: number;
  /** Найден вариант, при котором все успевают выйти. */
  allSaved: boolean;
  /**
   * Людей в зоне риска в ЛУЧШЕМ найденном варианте.
   * Больше нуля при allSaved=false — это и есть то, о чём нельзя молчать.
   */
  bestPeopleAtRisk: number;
  /** Поиск прерван пользователем — показаны неполные результаты. */
  cancelled: boolean;
  /** Пояснение для показа в окне. */
  note: string;
  /**
   * Подбор не мог оценить вывод людей: на схеме нет рабочих мест с людьми
   * или выходов на поверхность. Главный показатель (сколько людей не успевает
   * выйти) при этом не считается, и сравнивать варианты не по чему —
   * поэтому окно обязано показать это как ошибку, а не как «все спасены».
   */
  dataError?: string;
  /** Что нашлось на схеме и что попало в отбор — для пояснения в окне. */
  stats: CandidateStats;
}

/** Ключ набора действий — чтобы не считать одну комбинацию дважды. */
function keyOf(actions: FireAction[]): string {
  return actions
    .map(a => `${a.kind}:${a.branchId}:${a.symbolId ?? ""}:${a.rpm ?? ""}:${a.windowArea ?? ""}`)
    .sort()
    .join("|");
}

/**
 * Подобрать управляющие действия, снижающие риск для людей при пожаре.
 *
 * Каждый вариант считается ТЕМ ЖЕ пожарным режимом, что и кнопка расчёта,
 * поэтому поиск небыстрый: десятки полных расчётов сети. Прогресс и отмена
 * обязательны — без них окно выглядит зависшим.
 */
export async function searchFireControl(
  ctx: EvaluateContext,
  candidateInput: Omit<CandidateInput, "reach">,
  options: SearchOptions = {},
): Promise<SearchReport> {
  const {
    maxActions = 2, topN = 5, reach = 4,
    onProgress, isCancelled,
  } = options;

  const stats: CandidateStats = {
    fansTotal: 0, fansUsed: 0, doorsTotal: 0, doorsUsed: 0,
    branchesInZone: 0, hasFireSeat: false,
  };
  const candidates = collectActions({ ...candidateInput, reach }, stats);

  // Оценка объёма работы — для шкалы прогресса. Точное число заранее
  // неизвестно (слои обрываются по BEAM и по лимиту), поэтому берём
  // верхнюю границу и не даём шкале скакать назад.
  const perLayer = candidates.length;
  const estimated = Math.min(
    MAX_EVALUATIONS,
    1 + perLayer + (maxActions > 1 ? BEAM * perLayer : 0)
       + (maxActions > 2 ? BEAM * perLayer : 0),
  );

  let evaluations = 0;
  let cancelled = false;

  const report = (label: string) => onProgress?.(evaluations, estimated, label);

  // ── Слой 0: исходное состояние ───────────────────────────────────────────
  report("Исходный режим");
  const base = await evaluateVariant(ctx, []);
  evaluations++;

  const seen = new Set<string>([""]);
  const all: VariantResult[] = [];

  const finish = (note: string): SearchReport => {
    all.sort(compareVariants);
    const best = all[0];
    // Вариант засчитывается, только если он ЛУЧШЕ исходного режима.
    // Иначе «рекомендация» сводилась бы к бессмысленным действиям.
    const better = all.filter(v => !v.failed && compareVariants(v, base) < 0);
    const bestRisk = best && !best.failed
      ? Math.min(best.peopleAtRisk, base.peopleAtRisk)
      : base.peopleAtRisk;

    return {
      base,
      variants: better.slice(0, topN),
      candidatesCount: candidates.length,
      evaluations,
      // «Все спасены» — только когда людей вообще было по кому считать.
      // Нет рабочих мест или выходов — это не успех, а нехватка данных.
      allSaved: !base.dataError && bestRisk === 0,
      bestPeopleAtRisk: Number.isFinite(bestRisk) ? bestRisk : base.peopleAtRisk,
      cancelled,
      note,
      dataError: base.dataError,
      stats,
    };
  };

  if (candidates.length === 0) {
    // Причины у пустого списка разные, и лечатся они по-разному. Поэтому
    // говорим не «ничего не найдено», а что именно есть на схеме и что
    // отсеялось — иначе пользователю остаётся только гадать.
    const parts: string[] = [];
    if (stats.fansTotal === 0 && stats.doorsTotal === 0) {
      parts.push("на схеме нет ни вентиляторов, ни управляемых дверей и регуляторов");
    } else {
      parts.push(
        `на схеме есть вентиляторов: ${stats.fansTotal} (в отбор попало ${stats.fansUsed}), `
        + `дверей и регуляторов: ${stats.doorsTotal} (в отбор попало ${stats.doorsUsed})`,
      );
      if (stats.fansUsed === 0 && stats.doorsUsed === 0) {
        parts.push(
          `все они дальше ${reach} ветвей от очага и рабочих мест `
          + `(в зоне влияния ${stats.branchesInZone} выработок) — увеличьте «Глубину отбора рычагов»`,
        );
      } else {
        // Элементы рядом есть, но переключать в них нечего: двери уже
        // закрыты, вентиляторы остановлены и т. п.
        parts.push("но менять в них нечего: двери уже в нужном положении, вентиляторы остановлены");
      }
    }
    if (!stats.hasFireSeat) parts.push("очаг пожара на схеме не задан");
    return finish(`Подбирать нечего: ${parts.join("; ")}.`);
  }
  if (base.failed) {
    return finish("Не удалось рассчитать исходный режим — проверьте параметры очага и сети.");
  }
  // Оценивать вывод людей не по чему: главный критерий отбора не работает,
  // и все варианты оказались бы неотличимы друг от друга. Перебирать десятки
  // режимов ради заведомо одинакового результата — только тратить время
  // пользователя, поэтому останавливаемся сразу и говорим, чего не хватает.
  if (base.dataError) {
    return finish(
      `${base.dataError} Без этих данных подбор не может сравнить варианты: `
      + "главный показатель — сколько людей не успевает выйти — не считается.",
    );
  }

  // ── Слои 1..maxActions ───────────────────────────────────────────────────
  // frontier — лучшие наборы предыдущего слоя, к ним добавляется действие.
  let frontier: FireAction[][] = [[]];

  for (let layer = 1; layer <= maxActions; layer++) {
    const layerResults: VariantResult[] = [];

    for (const prefix of frontier) {
      for (const action of candidates) {
        if (isCancelled?.()) { cancelled = true; break; }
        if (evaluations >= MAX_EVALUATIONS) break;
        if (prefix.some(p => conflicts(p, action))) continue;

        const combo = [...prefix, action];
        const key = keyOf(combo);
        if (seen.has(key)) continue;
        seen.add(key);

        report(action.label);
        const result = await evaluateVariant(ctx, combo);
        evaluations++;

        layerResults.push(result);
        all.push(result);
      }
      if (cancelled || evaluations >= MAX_EVALUATIONS) break;
    }

    if (cancelled) break;
    if (layerResults.length === 0) break;
    if (evaluations >= MAX_EVALUATIONS) break;

    // Идеальный исход — углубляться незачем: добавление действий только
    // удлинит команду, не улучшив результат. «Идеальный» теперь включает и
    // требование РД п.25: никого не осталось за очагом, то есть никому не
    // придётся выходить через дым в самоспасателе.
    layerResults.sort(compareVariants);
    const top = layerResults[0];
    if (top && top.peopleAtRisk === 0 && top.velocityViolations === 0
        && top.peopleAfterFire === 0 && !hasRdProblem(top.rdNotes)) {
      break;
    }

    frontier = layerResults.slice(0, BEAM).map(r => r.actions);
  }

  onProgress?.(estimated, estimated, "Готово");

  if (cancelled) return finish("Поиск прерван — показаны варианты, рассчитанные до остановки.");

  const finished = finish("");
  if (finished.variants.length === 0) {
    // Исходный режим уже безупречен — трогать нечего.
    if (base.peopleAtRisk === 0 && base.velocityViolations === 0
        && base.peopleAfterFire === 0 && !hasRdProblem(base.rdNotes)) {
      return {
        ...finished,
        note: "В исходном режиме все успевают выйти навстречу свежей струе, "
          + "превышений скорости нет — менять режим не требуется.",
      };
    }
    // Иначе недостатки есть, но рычаги их не устраняют. Сказать об этом
    // прямо: «менять не требуется» здесь было бы неправдой, а именно на
    // такой вывод человек и опирается, утверждая план ликвидации аварий.
    const problems: string[] = [];
    if (base.peopleAtRisk > 0) problems.push(`людей в зоне риска — ${base.peopleAtRisk}`);
    if (base.peopleAfterFire > 0) {
      problems.push(`людей за очагом (выход только в самоспасателях) — ${base.peopleAfterFire}`);
    }
    if (base.velocityViolations > 0) {
      problems.push(`выработок с превышением скорости — ${base.velocityViolations}`);
    }
    if (hasRdProblem(base.rdNotes)) {
      problems.push("есть расхождение с предписаниями РД-15-11-2007 п.30");
    }
    return {
      ...finished,
      note: `Ни один из рассмотренных вариантов (${candidates.length} действий) не улучшает `
        + `исходный режим: ${problems.join(", ")}. `
        + "Требуется пункт переключения или изменение схемы проветривания.",
    };
  }
  if (!finished.allSaved) {
    return {
      ...finished,
      note: `Полностью вывести людей не удаётся ни одним вариантом: в зоне риска остаётся `
        + `${finished.bestPeopleAtRisk}. Требуется пункт переключения.`,
    };
  }
  // Все успевают выйти, но часть людей идёт через дым в самоспасателях.
  // По РД это допустимо, однако умолчать нельзя: такой режим тяжелее
  // и требует исправных самоспасателей и пунктов переключения на маршруте.
  const best = finished.variants[0];
  if (best && best.peopleAfterFire > 0) {
    return {
      ...finished,
      note: `Все успевают выйти, но ${best.peopleAfterFire} чел. остаются ЗА ОЧАГОМ — `
        + "их выводят в изолирующих самоспасателях кратчайшим путём на свежую струю (РД п.25).",
    };
  }
  return finished;
}