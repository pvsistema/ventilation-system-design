// ─────────────────────────────────────────────────────────────────────────────
// projectMigrations.ts — перенос сохранённых проектов на текущее соглашение
// о единицах сопротивления (см. lib/resistanceUnits.ts).
//
// ЗАЧЕМ. До версии 3 в проекте уживались две единицы сопротивления, и часть
// полей хранилась не в той, в которой их читал расчёт. Сама правка расчёта
// уже сделана, но числа в старых файлах остались прежними — если открыть такой
// файл как есть, перемычки станут в 9,8 раза жёстче, чем их задал человек.
// Поэтому при открытии файла версии < 3 эти поля пересчитываются один раз.
//
// ЧТО ИМЕННО ПЕРЕСЧИТЫВАЕТСЯ — только поля, у которых ИЗМЕНИЛАСЬ трактовка:
//
//   • bulkheadManualR / bkManualR — поле ручного R перемычки. Оно было
//     подписано «R (Н·с²/м⁸)», и люди вводили туда СИ; расчёт складывал это
//     число с R ветви напрямую, то есть трактовал как СИ — и результат был
//     верным. Теперь поле рудничное (кМюрг), как у всех прочих R перемычек,
//     поэтому сохранённое значение делим на g: физика остаётся прежней,
//     меняется только единица записи.
//
// ЧТО НЕ ТРОГАЕМ:
//
//   • manualR ветви — это поле ВСЕГДА было подписано в кМюрг (в панели стоит
//     `uRes.symbol`), человек вводил туда кМюрг, а расчёт ошибочно читал их
//     как СИ. Значение в файле корректно, ошибочным было чтение — и оно уже
//     исправлено. Пересчитывать здесь нечего.
//   • resistance / rFriction / dP — производные величины: recalcAll()
//     пересчитывает их при каждом открытии проекта из первичных данных.
//   • bulkheadR / bkBulkheadR / fanCrossingR — хранились и хранятся в Мюрг,
//     трактовка не менялась.
// ─────────────────────────────────────────────────────────────────────────────
import { G_ACCEL } from "./resistanceUnits";

/** Версия формата, соответствующая текущему соглашению о единицах. */
export const PROJECT_VERSION = 3;

/** Минимальная форма проекта, которая нужна миграции. */
interface MigratableProject {
  version?: number;
  branches?: Array<Record<string, unknown>>;
  schemaSymbols?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** Делит значение на g, если оно вообще задано и положительно. */
function siFieldToKmurg(v: unknown): number | undefined {
  return typeof v === "number" && v > 0 ? v / G_ACCEL : undefined;
}

/**
 * Приводит загруженный проект к текущей версии формата.
 *
 * Возвращает НОВЫЙ объект, исходный не меняется. Для файлов версии 3 и выше
 * работа не делается — повторный прогон не должен делить значения второй раз.
 */
export function migrateProject<T extends MigratableProject>(data: T): T {
  const version = typeof data.version === "number" ? data.version : 1;
  if (version >= PROJECT_VERSION) return data;

  const branches = (data.branches ?? []).map(b => {
    const migrated = siFieldToKmurg(b.bulkheadManualR);
    return migrated === undefined ? b : { ...b, bulkheadManualR: migrated };
  });

  const schemaSymbols = (data.schemaSymbols ?? []).map(s => {
    const migrated = siFieldToKmurg(s.bkManualR);
    return migrated === undefined ? s : { ...s, bkManualR: migrated };
  });

  return {
    ...data,
    version: PROJECT_VERSION,
    ...(data.branches ? { branches } : {}),
    ...(data.schemaSymbols ? { schemaSymbols } : {}),
  };
}
