// ─────────────────────────────────────────────────────────────────────────────
// Справочник труб пожарно-оросительного трубопровода (ППЗ) рудников и шахт.
//
// Нормы, по которым подобраны трубы и их назначение:
//  • ФНиП «Правила безопасности при ведении горных работ и переработке твёрдых
//    полезных ископаемых» (приказ Ростехнадзора № 505 от 08.12.2020):
//    сеть — из магистральных и участковых линий; диаметр магистральных
//    не менее 100 мм, участковых — не менее 50 мм (рудники).
//  • РД 05-366-00 «Инструкция по проектированию пожарно-оросительного
//    трубопровода угольных шахт»: магистральные не менее 150 мм,
//    участковые — не менее 100 мм; от резервуаров к стволу — не менее 150 мм.
//  • Скорость воды: до 2 м/с при технологическом расходе и до 4 м/с при
//    расходе на пожаротушение (указания по проектированию трубопроводов
//    в подземных выработках).
//  • Сортамент: ГОСТ 8732-78 (бесшовные горячедеформированные),
//    ГОСТ 10704-91 (электросварные прямошовные), ГОСТ 3262-75
//    (водогазопроводные). Наружный диаметр × толщина стенки, мм.
// ─────────────────────────────────────────────────────────────────────────────

export type PipeLine = "main" | "section" | "face";

export interface WaterPipeModel {
  id: string;
  name: string;           // обозначение: «108×4»
  gost: string;           // ГОСТ сортамента
  material: string;       // материал — как в свойствах ветви (Сталь, Полиэтилен…)
  dn: number;             // условный проход DN, мм
  outerDiameter: number;  // наружный диаметр, мм
  wall: number;           // толщина стенки, мм
  notes?: string;
  isUser?: boolean;
}

export const PIPE_LINE_NAMES: Record<PipeLine, string> = {
  main: "Магистральные",
  section: "Участковые",
  face: "Забойные",
};

export const PIPE_LINE_HINT: Record<PipeLine, string> = {
  main: "По стволам, околоствольным дворам, главным и групповым выработкам",
  section: "По участковым штрекам, уклонам, бремсбергам — до забоев",
  face: "Временные забойные водопроводы — диаметр не ограничивается",
};

/** Минимальный DN по нормам: рудники (ФНиП № 505) и угольные шахты (РД 05-366-00). */
export const MIN_DN = {
  ore:  { main: 100, section: 50 },
  coal: { main: 150, section: 100 },
} as const;

/** Допустимая скорость воды, м/с. */
export const V_TECH = 2;
export const V_FIRE = 4;

const p = (gost: string, dn: number, od: number, wall: number, notes?: string): WaterPipeModel => ({
  id: `${gost.replace(/\D+/g, "_")}_${od}x${String(wall).replace(".", "_")}`,
  name: `${String(od).replace(".", ",")}×${String(wall).replace(".", ",")}`,
  gost, material: "Сталь", dn, outerDiameter: od, wall, notes,
});

const G8732 = "ГОСТ 8732-78";
const G10704 = "ГОСТ 10704-91";
const G3262 = "ГОСТ 3262-75";

export const PIPE_CATALOG: WaterPipeModel[] = [
  // Бесшовные горячедеформированные — стволы, магистрали, высокое давление
  p(G8732, 50, 57, 3.5), p(G8732, 65, 76, 4), p(G8732, 80, 89, 4),
  p(G8732, 100, 108, 4), p(G8732, 100, 114, 4.5), p(G8732, 125, 133, 5),
  p(G8732, 150, 159, 5), p(G8732, 150, 168, 6), p(G8732, 200, 219, 7),
  p(G8732, 250, 273, 8), p(G8732, 300, 325, 8),
  // Электросварные прямошовные — горизонтальные выработки
  p(G10704, 50, 57, 3), p(G10704, 65, 76, 3), p(G10704, 80, 89, 3.5),
  p(G10704, 100, 108, 3.5), p(G10704, 100, 114, 4), p(G10704, 125, 133, 4),
  p(G10704, 150, 159, 4.5), p(G10704, 200, 219, 6), p(G10704, 250, 273, 7),
  p(G10704, 300, 325, 8),
  // Водогазопроводные — участковые и забойные отводы
  p(G3262, 25, 33.5, 3.2, "обыкновенная"), p(G3262, 32, 42.3, 3.2, "обыкновенная"),
  p(G3262, 40, 48, 3.5, "обыкновенная"), p(G3262, 50, 60, 3.5, "обыкновенная"),
  p(G3262, 65, 75.5, 4, "обыкновенная"), p(G3262, 80, 88.5, 4, "обыкновенная"),
  p(G3262, 100, 114, 4.5, "обыкновенная"),
  p(G3262, 50, 60, 4.5, "усиленная"), p(G3262, 80, 88.5, 4.5, "усиленная"),
  p(G3262, 100, 114, 5, "усиленная"),
];

/** Внутренний диаметр, мм. */
export const innerDiameter = (m: Pick<WaterPipeModel, "outerDiameter" | "wall">) =>
  Math.max(0, m.outerDiameter - 2 * m.wall);

/** Пропускная способность при скорости v, м³/ч. */
export function capacityM3h(m: Pick<WaterPipeModel, "outerDiameter" | "wall">, v: number): number {
  const d = innerDiameter(m) / 1000;
  return (Math.PI * d * d) / 4 * v * 3600;
}

/** Для каких линий годится труба по нормам: рудник / угольная шахта. */
export function pipeLineFor(dn: number, kind: "ore" | "coal"): PipeLine {
  const n = MIN_DN[kind];
  return dn >= n.main ? "main" : dn >= n.section ? "section" : "face";
}

// ─── Свои трубы (хранятся в проекте) ─────────────────────────────────────────
let userPipes: WaterPipeModel[] = [];

export function registerUserPipes(list: WaterPipeModel[]) {
  userPipes = list.filter((x) => x && x.id).map((x) => ({ ...x, isUser: true }));
}

export function allPipes(): WaterPipeModel[] {
  return [...userPipes, ...PIPE_CATALOG];
}

export function getPipeById(id: string | undefined): WaterPipeModel | undefined {
  if (!id) return undefined;
  return userPipes.find((x) => x.id === id) ?? PIPE_CATALOG.find((x) => x.id === id);
}

/** Труба каталога/своя с теми же размерами и материалом, что у ветви. */
export function findPipe(od: number, wall: number, material: string): WaterPipeModel | undefined {
  return allPipes().find((x) => x.outerDiameter === od && x.wall === wall && x.material === material);
}

// ─── Толщина стенки: сверка с сортаментом ГОСТ и прочность ───────────────────
//
// ГОСТ 3262-75 — стенка жёстко задана для каждого DN и исполнения
//   (лёгкая / обыкновенная / усиленная). Испытательное давление:
//   2,5 МПа — лёгкие и обыкновенные, 3,2 МПа — усиленные.
// ГОСТ 8732-78 и ГОСТ 10704-91 — для каждого наружного Ø задан диапазон
//   стенок и ряд стандартных толщин; ниже — минимальная стенка сортамента.
//
// Допустимое рабочее давление — по формуле тонкостенной трубы с запасом:
//   P = 2·φ·[σ]·(s − c) / (D − (s − c)),
// где [σ] = 140 МПа (сталь 20 / Ст3 при 20 °C), φ — коэффициент прочности
// шва (1,0 бесшовные, 0,8 сварные), c = 1 мм — прибавка на коррозию
// (шахтная вода агрессивна). Для ГОСТ 3262 дополнительно не выше
// испытательного давления / 1,25.

/** ГОСТ 3262-75: наружный Ø и стенки (лёгкая, обыкновенная, усиленная) по DN. */
export const GOST_3262: Record<number, { od: number; light: number; ordinary: number; reinforced: number }> = {
  15: { od: 21.3, light: 2.5, ordinary: 2.8, reinforced: 3.2 },
  20: { od: 26.8, light: 2.5, ordinary: 2.8, reinforced: 3.2 },
  25: { od: 33.5, light: 2.8, ordinary: 3.2, reinforced: 4.0 },
  32: { od: 42.3, light: 2.8, ordinary: 3.2, reinforced: 4.0 },
  40: { od: 48.0, light: 3.0, ordinary: 3.5, reinforced: 4.0 },
  50: { od: 60.0, light: 3.0, ordinary: 3.5, reinforced: 4.5 },
  65: { od: 75.5, light: 3.2, ordinary: 4.0, reinforced: 4.5 },
  80: { od: 88.5, light: 3.5, ordinary: 4.0, reinforced: 4.5 },
  90: { od: 101.3, light: 3.5, ordinary: 4.0, reinforced: 4.5 },
  100: { od: 114.0, light: 4.0, ordinary: 4.5, reinforced: 5.0 },
  125: { od: 140.0, light: 4.0, ordinary: 4.5, reinforced: 5.5 },
  150: { od: 165.0, light: 4.0, ordinary: 4.5, reinforced: 5.5 },
};

/** ГОСТ 8732-78: минимальная стенка сортамента по наружному Ø. */
export const GOST_8732_MIN_WALL: Record<number, number> = {
  57: 3.0, 76: 3.0, 89: 3.5, 108: 4.0, 114: 4.0, 133: 4.0, 159: 4.5,
  168: 5.0, 219: 6.0, 273: 7.0, 325: 8.0,
};
/** ГОСТ 10704-91: минимальная стенка сортамента по наружному Ø. */
export const GOST_10704_MIN_WALL: Record<number, number> = {
  57: 1.0, 76: 1.4, 89: 1.4, 108: 1.6, 114: 1.6, 133: 1.8, 159: 1.8,
  168: 1.8, 219: 2.0, 273: 2.5, 325: 2.5,
};
/** Стандартный ряд толщин стенок (ГОСТ 8732-78, ГОСТ 10704-91), мм. */
export const WALL_SERIES = [
  1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3, 3.2, 3.5, 3.8, 4, 4.5, 5, 5.5,
  6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20,
];

/** Минимальная стенка для шахтной трубы ППЗ: 3 мм, чтобы после коррозии
 *  (прибавка 1 мм) и ударов при доставке по выработкам труба держала давление. */
export const MINE_MIN_WALL = 3;
export const CORROSION_MM = 1;
const SIGMA_MPA = 140;

export type WallStatus = "ok" | "thin" | "off-series" | "unknown";

export interface WallCheck {
  status: WallStatus;
  /** Что предписывает ГОСТ: «обыкновенная 4,5», «от 4,0» и т. п. */
  gostText: string;
  /** Пояснение для подсказки */
  note: string;
}

const g = (gost: string) => (gost.includes("3262") ? "3262" : gost.includes("8732") ? "8732" : gost.includes("10704") ? "10704" : "");
const ru = (v: number) => String(v).replace(".", ",");

/** Сверка толщины стенки с ГОСТ и шахтным минимумом. */
export function checkWall(m: Pick<WaterPipeModel, "gost" | "dn" | "outerDiameter" | "wall">): WallCheck {
  const std = g(m.gost);
  if (std === "3262") {
    const row = GOST_3262[m.dn];
    if (!row) return { status: "unknown", gostText: "—", note: `DN ${m.dn} нет в ГОСТ 3262-75` };
    const kinds = [["лёгкая", row.light], ["обыкновенная", row.ordinary], ["усиленная", row.reinforced]] as const;
    const hit = kinds.find(([, w]) => Math.abs(w - m.wall) < 0.01);
    const gostText = `${ru(row.light)} / ${ru(row.ordinary)} / ${ru(row.reinforced)}`;
    if (Math.abs(row.od - m.outerDiameter) > 0.1)
      return { status: "off-series", gostText, note: `По ГОСТ 3262-75 у DN ${m.dn} наружный Ø ${ru(row.od)} мм` };
    if (!hit) return { status: "off-series", gostText, note: "Такой стенки нет в ГОСТ 3262-75 (лёгкая / обыкновенная / усиленная)" };
    if (hit[0] === "лёгкая") return { status: "thin", gostText, note: "Лёгкие трубы не применяются для ППЗ в выработках — нужна обыкновенная или усиленная" };
    return { status: m.wall < MINE_MIN_WALL ? "thin" : "ok", gostText, note: `ГОСТ 3262-75, ${hit[0]}` };
  }
  if (std === "8732" || std === "10704") {
    const table = std === "8732" ? GOST_8732_MIN_WALL : GOST_10704_MIN_WALL;
    const minG = table[m.outerDiameter];
    const gostText = minG !== undefined ? `от ${ru(minG)}` : "—";
    if (minG === undefined) return { status: "unknown", gostText, note: `Наружного Ø ${ru(m.outerDiameter)} мм нет в таблице сортамента` };
    if (m.wall < minG) return { status: "off-series", gostText, note: `По ГОСТ ${std === "8732" ? "8732-78" : "10704-91"} стенка для Ø${ru(m.outerDiameter)} — от ${ru(minG)} мм` };
    if (!WALL_SERIES.some((w) => Math.abs(w - m.wall) < 0.01)) return { status: "off-series", gostText, note: "Толщины нет в стандартном ряду сортамента" };
    if (m.wall < MINE_MIN_WALL) return { status: "thin", gostText, note: `Тоньше ${MINE_MIN_WALL} мм — мало для шахты с учётом коррозии` };
    return { status: "ok", gostText, note: `Соответствует ГОСТ ${std === "8732" ? "8732-78" : "10704-91"}` };
  }
  if (m.wall < MINE_MIN_WALL) return { status: "thin", gostText: "—", note: `Тоньше ${MINE_MIN_WALL} мм — мало для шахты с учётом коррозии` };
  return { status: "unknown", gostText: "—", note: "ГОСТ не указан — сортамент не сверялся" };
}

/** Допустимое рабочее давление, МПа (с прибавкой на коррозию). */
export function allowedPressureMPa(m: Pick<WaterPipeModel, "gost" | "dn" | "outerDiameter" | "wall" | "material">): number {
  if (m.material !== "Сталь" && m.material !== "Чугун") return 0;
  const s = m.wall - CORROSION_MM;
  if (s <= 0 || m.outerDiameter <= s) return 0;
  const std = g(m.gost);
  const phi = std === "8732" ? 1 : 0.8;
  let p = (2 * phi * SIGMA_MPA * s) / (m.outerDiameter - s);
  if (std === "3262") {
    const row = GOST_3262[m.dn];
    const test = row && Math.abs(row.reinforced - m.wall) < 0.01 ? 3.2 : 2.5;
    p = Math.min(p, test / 1.25);
  }
  return Math.round(p * 10) / 10;
}

export function makeUserPipe(): WaterPipeModel {
  return {
    id: `user_pipe_${Date.now()}`, name: "", gost: "", material: "Сталь",
    dn: 100, outerDiameter: 108, wall: 4, isUser: true,
  };
}
