// ─────────────────────────────────────────────────────────────────────────────
// msHistory.ts — ИСТОРИЯ ЗАМЕРОВ ЗАМЕРНОЙ СТАНЦИИ.
//
// Текущий замер станции (msFlow / msVelocity / msArea / msDate) — это то, с чем
// «Проверка схемы» сверяет модель. История — все замеры по датам: из журнала
// АэроСети (docs/Measurements.DataDocument) или записанные вручную. По ней
// видна динамика расхода, и она же целиком уходит обратно в АэроСеть.
// ─────────────────────────────────────────────────────────────────────────────

/** Один замер станции. */
export interface MsMeasure {
  /** Дата, ДД.ММ.ГГГГ. */
  date: string;
  /** Скорость воздуха, м/с. */
  velocity: number;
  /** Сечение в месте замера, м². */
  area: number;
  /** Расход = скорость × сечение, м³/с. */
  flow: number;
}

/** «ДД.ММ.ГГГГ» → число для сортировки (0, если дата не читается). */
export function msDateKey(d: string | undefined): number {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec((d ?? "").trim());
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : 0;
}

/** История по возрастанию даты (без изменения исходного массива). */
export function msSortHistory(list: MsMeasure[] | undefined): MsMeasure[] {
  return [...(list ?? [])].sort((a, b) => msDateKey(a.date) - msDateKey(b.date));
}

/** Сегодняшняя дата в виде ДД.ММ.ГГГГ. */
export function msToday(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/**
 * Замер из текущих полей станции. Недостающее досчитывается: скорость —
 * из расхода и сечения, расход — из скорости и сечения.
 */
export function msMeasureFromCurrent(sym: {
  msFlow?: number; msVelocity?: number; msArea?: number; msDate?: string;
}, fallbackArea = 0): MsMeasure | null {
  const area = (sym.msArea ?? 0) > 0 ? sym.msArea! : fallbackArea;
  const velocity = (sym.msVelocity ?? 0) > 0 ? sym.msVelocity!
    : (sym.msFlow ?? 0) > 0 && area > 0 ? sym.msFlow! / area : 0;
  if (!(velocity > 0) || !(area > 0)) return null;
  const flow = (sym.msFlow ?? 0) > 0 ? sym.msFlow! : velocity * area;
  return {
    date: (sym.msDate ?? "").trim() || msToday(),
    velocity: +velocity.toFixed(3),
    area: +area.toFixed(2),
    flow: +flow.toFixed(2),
  };
}

/**
 * Полная история для выгрузки: сохранённые замеры плюс текущий, если его
 * ещё нет в истории (та же дата и тот же расход).
 */
export function msFullHistory(sym: {
  msHistory?: MsMeasure[]; msFlow?: number; msVelocity?: number; msArea?: number; msDate?: string;
}, fallbackArea = 0): MsMeasure[] {
  const list = msSortHistory(sym.msHistory);
  const cur = msMeasureFromCurrent(sym, fallbackArea);
  if (cur && !list.some(m => m.date === cur.date && Math.abs(m.flow - cur.flow) < 0.01)) list.push(cur);
  return msSortHistory(list);
}
