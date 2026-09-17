// ─────────────────────────────────────────────────────────────────────────────
// msIndicatorLines.ts — ЧТО ПОДПИСАНО У ЗАМЕРНОЙ СТАНЦИИ.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ. Подпись замерной станции собиралась в ПЯТИ местах
// независимо: рабочая область (TopoCanvas и его узел-значок), предпросмотр
// печати, вывод на холст для печати и выгрузка в SVG. Пять одинаковых кусков —
// пять мест, где правка забывается: стоило добавить показатель, и на печати он
// не появлялся. Теперь строки собираются здесь, а рисуют их каждый по-своему.
//
// ГЛАВНОЕ — ОТКУДА БЕРУТСЯ ГАЛОЧКИ. Раньше показатели включались только в
// карточке КОНКРЕТНОЙ станции. На схеме их десятки: чтобы показать расход на
// всех, приходилось обойти каждую. Это ровно та работа, от которой у выработок
// избавляет «Панель информации»: там галочка включает величину СРАЗУ ВЕЗДЕ.
// Теперь так же и у замерных станций — общие галочки живут в InfoDisplayConfig
// (раздел «Замерные станции»), а личная галочка станции ДОБАВЛЯЕТ показатель
// именно ей. Общее включает всех, личное — одну: выключить общую галочку у
// отдельной станции нельзя, для этого её показатель просто не отмечают.
// ─────────────────────────────────────────────────────────────────────────────
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type TopoBranch } from "@/lib/topology";

/** Знак замерной станции в общей легенде. */
export const MEASURE_STATION_TYPE_ID = "measure_station";

/** Какие показатели станции показывать. */
export interface MsIndicatorFlags {
  number: boolean;
  location: boolean;
  flow: boolean;
  area: boolean;
  velocity: boolean;
}

/** Всё погашено — быстрая проверка «подписывать нечего». */
export function msIndicatorsEmpty(f: MsIndicatorFlags): boolean {
  return !f.number && !f.location && !f.flow && !f.area && !f.velocity;
}

/** Поля знака, которые читает этот модуль. Берём минимум — не тянем SchemaSymbol. */
export interface MsSymbolLike {
  msNumber?: string;
  msLocation?: string;
  msArea?: number;
  msFlow?: number;
  msVelocity?: number;
  msIndNumber?: boolean;
  msIndLocation?: boolean;
  msIndFlow?: boolean;
  msIndArea?: boolean;
  msIndVelocity?: boolean;
}

/**
 * Итоговые галочки станции: общая по схеме ИЛИ личная у этой станции.
 *
 * infoConfig может не прийти (предпросмотр, старый проект) — тогда работают
 * только личные галочки, как было раньше.
 */
export function msIndicatorFlags(
  sym: MsSymbolLike,
  infoConfig?: Partial<InfoDisplayConfig> | null,
): MsIndicatorFlags {
  const g = infoConfig ?? {};
  return {
    number:   !!sym.msIndNumber   || !!g.msIndNumber,
    location: !!sym.msIndLocation || !!g.msIndLocation,
    flow:     !!sym.msIndFlow     || !!g.msIndFlow,
    area:     !!sym.msIndArea     || !!g.msIndArea,
    velocity: !!sym.msIndVelocity || !!g.msIndVelocity,
  };
}

/**
 * Строки подписи замерной станции.
 *
 * Собственные числа знака (msFlow, msArea, msVelocity) имеют приоритет над
 * расчётными: замерная станция — это ЗАМЕР, и если в неё вписаны снятые с
 * натуры значения, подменять их результатом расчёта нельзя.
 */
export function msIndicatorLines(
  sym: MsSymbolLike,
  branch: TopoBranch | null | undefined,
  flags: MsIndicatorFlags,
): string[] {
  const lines: string[] = [];
  if (flags.number && sym.msNumber) lines.push(`№${sym.msNumber}`);
  if (flags.location && sym.msLocation) lines.push(sym.msLocation);
  if (flags.flow) {
    const q = sym.msFlow ?? (branch ? Math.abs(branch.flow ?? 0) : 0);
    lines.push(`Q=${q.toFixed(2)} м³/с`);
  }
  if (flags.area) {
    const a = sym.msArea ?? (branch?.area ?? 0);
    lines.push(`S=${a.toFixed(2)} м²`);
  }
  if (flags.velocity) {
    const v = sym.msVelocity ?? (branch ? Math.abs(branch.velocity ?? 0) : 0);
    lines.push(`v=${v.toFixed(2)} м/с`);
  }
  return lines;
}

/** Короткий путь: галочки и строки за один вызов. */
export function msLinesFor(
  sym: MsSymbolLike,
  branch: TopoBranch | null | undefined,
  infoConfig?: Partial<InfoDisplayConfig> | null,
): string[] {
  return msIndicatorLines(sym, branch, msIndicatorFlags(sym, infoConfig));
}
