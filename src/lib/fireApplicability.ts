// ─────────────────────────────────────────────────────────────────────────────
// fireApplicability.ts — проверка ОБЛАСТИ ПРИМЕНИМОСТИ расчёта пожара.
//
// ЗАЧЕМ ЭТО НУЖНО.
// Нормативные формулы (4.5)–(4.13) откалиброваны на реальные горные выработки:
// сечения единицы–десятки м², скорости воздуха ниже 8 м/с, время до 150 мин.
// Подставить в них что угодно программа не мешает — и молча считает. На модели
// рудника (гофра Ø160, S = 0,02 м²) формула (4.8) выдала длину зоны горения
// 48 м при полной длине установки 6 м, то есть заведомую чушь, и никакого
// предупреждения при этом не было.
//
// Здесь собраны проверки, которые НЕ меняют расчёт, а только предупреждают:
// расчёт как считался, так и считается, но инженер видит, что вышел за границы,
// на которых методика проверялась.
//
// ─────────────────────────────────────────────────────────────────────────────
// ОТДЕЛЬНО ПРО ЛАБОРАТОРНЫЕ МОДЕЛИ
//
// Модель рудника — законный объект расчёта, но подобие в ней НЕПОЛНОЕ, и это
// нужно проговаривать. Критерий Фруда для плавучести:
//
//     Fr = V² / (g·D·Δρ/ρ)
//
//   модель (V=2,71 м/с, D=0,16 м):   Fr ≈ 7,8
//   рудник (V=2,0 м/с,  D=3,5 м):    Fr ≈ 0,19
//
// В модели инерция потока доминирует над плавучестью примерно в 40 раз
// сильнее, чем в натуре. Значит модель СИСТЕМАТИЧЕСКИ НЕДООЦЕНИВАЕТ роль
// тепловой депрессии: если на модели струя всё же опрокинулась, в натуре при
// той же геометрии она опрокинется тем более уверенно.
// ─────────────────────────────────────────────────────────────────────────────

/** Границы, на которых проверялись нормативные формулы. */
export const APPLICABILITY_LIMITS = {
  /** Скорость воздуха, при которой замер почти наверняка перепутан с расходом, м/с */
  velocitySuspicious: 15,
  /** Минимальное сечение реальной горной выработки, м² */
  areaMin: 1.0,
  /** Предельное время в формуле (4.8), мин */
  fireTimeMax: 150,
  /** Разумный верх отношения Q/S для формулы (4.8), м/с */
  qOverSMax: 20,
};

/** Уровень замечания. */
export type ApplicabilityLevel = "error" | "warning" | "info";

export interface ApplicabilityNote {
  level: ApplicabilityLevel;
  /** Короткий заголовок для панели */
  title: string;
  /** Пояснение: что не так и что с этим делать */
  text: string;
  /** Чего касается замечание */
  subject: "velocity" | "area" | "time" | "scale" | "power";
}

export interface ApplicabilityInput {
  /** Сечение выработки, м² */
  area_m2?: number;
  /** Расход воздуха, м³/с */
  flow_m3s?: number;
  /** Длина выработки, м */
  length_m?: number;
  /** Время с начала пожара, мин */
  fireTime_min?: number;
  /** Мощность очага, МВт */
  power_MW?: number;
  /** Расчёт ведётся для лабораторной модели — часть проверок неуместна */
  labModel?: boolean;
}

/**
 * Проверка исходных данных очага на применимость методики.
 *
 * Возвращает список замечаний. Пустой список — данные в области, на которой
 * методика проверялась.
 */
export function checkApplicability(inp: ApplicabilityInput): ApplicabilityNote[] {
  const notes: ApplicabilityNote[] = [];
  const L = APPLICABILITY_LIMITS;

  const S = Number(inp.area_m2);
  const Q = Math.abs(Number(inp.flow_m3s));
  const hasS = Number.isFinite(S) && S > 0;
  const hasQ = Number.isFinite(Q) && Q > 0;

  // ── Скорость воздуха ───────────────────────────────────────────────────
  // Самая частая ошибка ввода: в поле расхода записывают показание
  // анемометра (м/с). При S = 0,02 м² и «2,71 м³/с» скорость выходит
  // 150 м/с — быстрее урагана, а расчёт идёт молча.
  if (hasS && hasQ) {
    const v = Q / S;
    if (v > L.velocitySuspicious) {
      notes.push({
        level: "error",
        subject: "velocity",
        title: `Скорость воздуха ${v.toFixed(1)} м/с`,
        text:
          `При сечении ${S.toFixed(3)} м² и расходе ${Q.toFixed(2)} м³/с скорость выходит ` +
          `${v.toFixed(1)} м/с — выше физически возможной для горной выработки. ` +
          `Обычная причина: в поле расхода записано показание анемометра в м/с. ` +
          `Расход равен скорости, умноженной на сечение: ${Q.toFixed(2)} × ${S.toFixed(3)} = ` +
          `${(Q * S).toFixed(4)} м³/с.`,
      });
    }
  }

  // ── Сечение выработки ──────────────────────────────────────────────────
  if (hasS && S < L.areaMin && !inp.labModel) {
    notes.push({
      level: "warning",
      subject: "area",
      title: `Сечение ${S.toFixed(3)} м² меньше ${L.areaMin} м²`,
      text:
        `Нормативные формулы (4.8)–(4.12) откалиброваны на сечения реальных выработок. ` +
        `Если это лабораторная модель, включите режим «Лабораторная модель» — ` +
        `тогда предупреждение снимется, а к результату добавится оценка подобия.`,
    });
  }

  // ── Отношение Q/S в формуле (4.8) ──────────────────────────────────────
  if (hasS && hasQ) {
    const qs = Q / S;
    if (qs > L.qOverSMax) {
      const t = Number.isFinite(Number(inp.fireTime_min)) ? Number(inp.fireTime_min) : 150;
      const l = t * (0.28 + 0.07 * qs);
      const lenTxt = Number.isFinite(Number(inp.length_m)) && Number(inp.length_m) > 0
        ? ` при длине выработки ${Number(inp.length_m).toFixed(1)} м`
        : "";
      notes.push({
        level: "warning",
        subject: "scale",
        title: "Формула (4.8) вне области применимости",
        text:
          `Отношение Q/S = ${qs.toFixed(1)} м/с. Длина зоны горения по (4.8) получается ` +
          `${l.toFixed(1)} м${lenTxt}. Проверьте сечение и расход: скорее всего, ` +
          `перепутаны единицы либо задана модель, а не выработка.`,
      });
    }
  }

  // ── Время с начала пожара ──────────────────────────────────────────────
  const t = Number(inp.fireTime_min);
  if (Number.isFinite(t) && t > L.fireTimeMax) {
    notes.push({
      level: "info",
      subject: "time",
      title: `Время пожара ${t.toFixed(0)} мин ограничено ${L.fireTimeMax} мин`,
      text:
        `Формула (4.8) применима при t ≤ ${L.fireTimeMax} мин, поэтому в расчёте ` +
        `используется ${L.fireTimeMax} мин. Это заложено в самой методике и ошибкой не является.`,
    });
  }

  // ── Мощность очага против масштаба объекта ─────────────────────────────
  // На модели с сечением сотых долей м² мощность в мегаваттах означает,
  // что в свойствах очага остался пресет реальной техники.
  const P = Number(inp.power_MW);
  if (hasS && Number.isFinite(P) && P > 0.1 && S < 0.5) {
    notes.push({
      level: "warning",
      subject: "power",
      title: `Мощность ${P.toFixed(2)} МВт при сечении ${S.toFixed(3)} м²`,
      text:
        `Для модели такого сечения мощность в мегаваттах нереальна — вероятно, ` +
        `в составе горючего осталась техника (резина, дизель, масло) из типового пресета. ` +
        `Лабораторный очаг измеряется киловаттами: используйте пресет «Лабораторная модель».`,
    });
  }

  return notes;
}

/**
 * Число Фруда по плавучести — мера подобия модели натуре.
 *
 *     Fr = V² / (g·D·Δρ/ρ),   Δρ/ρ = 1 − T₀/T_гор
 *
 * Чем МЕНЬШЕ Fr, тем сильнее плавучесть (а значит и тепловая депрессия)
 * относительно инерции потока.
 */
export function buoyancyFroude(
  velocity_ms: number,
  hydraulicDiameter_m: number,
  gasTemp_C: number,
  ambientTemp_C: number,
): number | null {
  const V = Math.abs(Number(velocity_ms));
  const D = Number(hydraulicDiameter_m);
  const Tg = Number(gasTemp_C) + 273.15;
  const Ta = Number(ambientTemp_C) + 273.15;
  if (!(V > 0) || !(D > 0) || !(Tg > 0) || !(Ta > 0)) return null;
  const dRho = 1 - Ta / Tg;
  if (!(dRho > 0)) return null;
  const fr = (V * V) / (9.81 * D * dRho);
  return Number.isFinite(fr) ? fr : null;
}

/**
 * Сравнение подобия модели и натуры.
 *
 * Нужно, чтобы результат лабораторного опыта можно было честно перенести на
 * рудник: само по себе совпадение расходов ничего не доказывает, если числа
 * подобия расходятся на порядок.
 */
export function compareSimilarity(
  model: { velocity_ms: number; hydraulicDiameter_m: number; gasTemp_C: number; ambientTemp_C: number },
  mine: { velocity_ms: number; hydraulicDiameter_m: number; gasTemp_C: number; ambientTemp_C: number },
): { frModel: number | null; frMine: number | null; ratio: number | null; note: string } {
  const frModel = buoyancyFroude(model.velocity_ms, model.hydraulicDiameter_m, model.gasTemp_C, model.ambientTemp_C);
  const frMine = buoyancyFroude(mine.velocity_ms, mine.hydraulicDiameter_m, mine.gasTemp_C, mine.ambientTemp_C);
  if (frModel == null || frMine == null || !(frMine > 0)) {
    return { frModel, frMine, ratio: null, note: "Недостаточно данных для оценки подобия." };
  }
  const ratio = frModel / frMine;
  const note = ratio > 2
    ? `Fr модели больше натурного в ${ratio.toFixed(0)} раз: в модели инерция потока ` +
      `подавляет плавучесть сильнее, чем в руднике. Модель НЕДООЦЕНИВАЕТ тепловую депрессию — ` +
      `если на ней струя опрокинулась, в натуре опрокинется тем более.`
    : ratio < 0.5
      ? `Fr модели меньше натурного в ${(1 / ratio).toFixed(0)} раз: модель ПЕРЕОЦЕНИВАЕТ ` +
        `тепловую депрессию, переносить результат на рудник напрямую нельзя.`
      : `Fr модели и натуры близки (отношение ${ratio.toFixed(2)}) — подобие по плавучести ` +
        `выдержано, результат переносится на рудник.`;
  return { frModel, frMine, ratio, note };
}
