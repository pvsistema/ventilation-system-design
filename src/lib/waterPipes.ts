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

export function makeUserPipe(): WaterPipeModel {
  return {
    id: `user_pipe_${Date.now()}`, name: "", gost: "", material: "Сталь",
    dn: 100, outerDiameter: 108, wall: 4, isUser: true,
  };
}
