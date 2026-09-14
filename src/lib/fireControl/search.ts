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
import { collectActions, conflicts, type CandidateInput } from "./candidates";
import {
  evaluateVariant, compareVariants,
  type EvaluateContext, type VariantResult,
} from "./evaluate";
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

  const candidates = collectActions({ ...candidateInput, reach });

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
      allSaved: bestRisk === 0,
      bestPeopleAtRisk: Number.isFinite(bestRisk) ? bestRisk : base.peopleAtRisk,
      cancelled,
      note,
    };
  };

  if (candidates.length === 0) {
    return finish(
      "На схеме нет управляемых элементов рядом с очагом и людьми: "
      + "ни вентиляторов, ни дверей с регулируемым сечением.",
    );
  }
  if (base.failed) {
    return finish("Не удалось рассчитать исходный режим — проверьте параметры очага и сети.");
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

    // Все успевают выйти — углубляться незачем: добавление действий
    // только удлинит команду, не улучшив исход.
    layerResults.sort(compareVariants);
    if (layerResults[0] && layerResults[0].peopleAtRisk === 0
        && layerResults[0].velocityViolations === 0) {
      break;
    }

    frontier = layerResults.slice(0, BEAM).map(r => r.actions);
  }

  onProgress?.(estimated, estimated, "Готово");

  if (cancelled) return finish("Поиск прерван — показаны варианты, рассчитанные до остановки.");

  const finished = finish("");
  if (finished.variants.length === 0) {
    return {
      ...finished,
      note: base.peopleAtRisk > 0
        ? `Ни один вариант не улучшает исходный режим. Людей в зоне риска остаётся ${base.peopleAtRisk} — `
          + "требуется пункт переключения или изменение схемы проветривания."
        : "В исходном режиме все успевают выйти — менять режим не требуется.",
    };
  }
  if (!finished.allSaved) {
    return {
      ...finished,
      note: `Полностью вывести людей не удаётся ни одним вариантом: в зоне риска остаётся `
        + `${finished.bestPeopleAtRisk}. Требуется пункт переключения.`,
    };
  }
  return finished;
}
