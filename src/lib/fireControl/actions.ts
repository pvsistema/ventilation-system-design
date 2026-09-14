// ─────────────────────────────────────────────────────────────────────────────
// actions.ts — управляющие действия аварийного режима.
//
// ЗАЧЕМ. При пожаре диспетчер располагает считанными рычагами: реверсировать
// или остановить вентилятор, сменить его обороты, закрыть дверь, приоткрыть
// вентиляционное окно. Подбор варианта — это перебор комбинаций ровно этих
// рычагов с проверкой каждой через расчёт сети. Чтобы перебор был возможен,
// действие должно быть ДАННЫМИ, а не кодом: его нужно уметь породить,
// сравнить, показать человеку, применить к копии схемы для проверки и —
// отдельно — применить к настоящему проекту по кнопке.
//
// Здесь описана эта модель и функция применения. Физики нет: действие лишь
// меняет те же поля, которые пользователь правит руками в панели ветви, а
// считает всё существующий решатель.
//
// ВАЖНО про двери. Отдельного поля «дверь» в ветви нет и не нужно: дверь,
// ляда, перемычка с окном и регулятор — это ЗНАЧКИ схемы (SchemaSymbol) с
// привязкой branchId, а их проходное сечение задаётся полем bkWindowArea.
// Закрыть дверь = обнулить окно, открыть = раскрыть на полное сечение ветви.
// Поэтому действие умеет менять и ветви, и значки.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import { OPEN_DOOR_IDS, WINDOW_BULKHEAD_IDS } from "@/lib/schemaSymbols";

/**
 * Значки дверей, которые открывают и закрывают по команде.
 *
 * Обычная и автоматическая вентиляционные двери в расчёте сопротивления
 * выглядят как глухая перемычка (окна у них нет), и по этому признаку их
 * легко спутать с настоящей глухой перемычкой. Разница в том, что дверь —
 * это проход: её штатно открывают и закрывают, а перемычку возводят
 * насовсем. В аварийном плане фигурируют именно двери, поэтому их
 * приходится перечислить явно.
 */
const DOOR_SYMBOL_IDS = new Set([
  "door_closed", "door_closed_concrete", "door_closed_wood",
  "door_closed_brick", "door_closed_metal",
  "door_base", "door_conc", "door_wood", "door_brick", "door_metal",
  "door_auto", "door_auto_concrete", "door_auto_wood",
  "door_auto_brick", "door_auto_metal",
  "auto_base", "auto_conc", "auto_wood", "auto_brick", "auto_metal",
  "fire_door", "fire_door_pp",
]);

/** Что именно делает действие. */
export type FireActionKind =
  | "fan_reverse"    // реверсировать вентилятор
  | "fan_stop"       // остановить вентилятор
  | "fan_rpm"        // изменить обороты (ЧРП)
  | "door_close"     // закрыть дверь / ляду / перемычку с окном
  | "door_open"      // открыть её же на полное сечение
  | "window_set";    // выставить площадь вентиляционного окна

/**
 * Одно управляющее действие.
 *
 * Хранит и НОВОЕ значение, и ПРЕЖНЕЕ. Прежнее нужно дважды: чтобы не
 * предлагать действие, которое ничего не меняет (закрыть уже закрытую дверь),
 * и чтобы показать человеку, из чего во что переходим.
 */
export interface FireAction {
  kind: FireActionKind;
  /** Ветвь, к которой относится действие. */
  branchId: string;
  /** Значок двери/перемычки — для действий с сечением. */
  symbolId?: string;
  /** Новая площадь окна, м² (door_close → 0, door_open → сечение ветви). */
  windowArea?: number;
  /** Прежняя площадь окна, м². */
  prevWindowArea?: number;
  /** Новые обороты вентилятора, об/мин. */
  rpm?: number;
  /** Прежние обороты, об/мин. */
  prevRpm?: number;
  /** Читаемая формулировка: «Закрыть дверь в кв. 12». */
  label: string;
  /**
   * Оценка трудоёмкости в минутах — сколько займёт исполнение под землёй.
   * Реверс ВГП делается с пульта за минуту, а дверь в дальней выработке
   * кто-то должен дойти и закрыть. При равном результате вариант, который
   * успеют выполнить быстрее, для аварийного плана лучше.
   */
  effortMin: number;
}

/** Результат применения набора действий — копии схемы для расчёта. */
export interface AppliedScheme {
  branches: TopoBranch[];
  symbols: SchemaSymbol[];
}

/**
 * Значок управляет проходным сечением (дверь, ляда, перемычка с окном)?
 *
 * Глухая перемычка сюда не попадает: её не «закрывают» по команде, она уже
 * закрыта, и в аварийном плане фигурировать не может.
 */
export function isControllableDoor(symbol: SchemaSymbol): boolean {
  return WINDOW_BULKHEAD_IDS.has(symbol.typeId)
    || OPEN_DOOR_IDS.has(symbol.typeId)
    || DOOR_SYMBOL_IDS.has(symbol.typeId);
}

/** Значок — дверь (а не регулятор с окном)? */
export function isDoorSymbol(typeId: string): boolean {
  return DOOR_SYMBOL_IDS.has(typeId);
}

/**
 * Площадь окна значка сейчас, м².
 *
 * У полностью открытой двери (OPEN_DOOR_IDS) поле окна не заполняют — там
 * ноль означает «проём во всё сечение», а не «закрыто». Эта развилка уже
 * зашита в расчёт сопротивления (см. bulkheadRByBranch в Cad.tsx), и здесь
 * её нужно повторить, иначе подбор решит, что открытая дверь закрыта.
 */
export function currentWindowArea(symbol: SchemaSymbol, branchArea: number): number {
  const raw = symbol.bkWindowArea ?? 0;
  if (raw > 0.001) return raw;
  return OPEN_DOOR_IDS.has(symbol.typeId) ? branchArea : 0;
}

/**
 * Применить действия к схеме, вернув КОПИИ массивов.
 *
 * Исходные ветви и значки не изменяются: подбор перебирает десятки вариантов
 * и обязан каждый считать от одного и того же исходного состояния. Ровно эта
 * же функция вызывается и по кнопке «Применить» — так проверенный вариант
 * и внесённое в проект изменение гарантированно совпадают.
 */
export function applyActions(
  branches: TopoBranch[],
  symbols: SchemaSymbol[],
  actions: FireAction[],
): AppliedScheme {
  if (actions.length === 0) return { branches, symbols };

  const branchPatch = new Map<string, Partial<TopoBranch>>();
  const symbolPatch = new Map<string, Partial<SchemaSymbol>>();

  for (const a of actions) {
    switch (a.kind) {
      case "fan_reverse":
        // Реверс и остановка исключают друг друга: остановленный вентилятор
        // не может дуть в обратную сторону. Снимаем стоп явно.
        branchPatch.set(a.branchId, {
          ...branchPatch.get(a.branchId),
          fanReverse: true, fanStopped: false,
        });
        break;

      case "fan_stop":
        branchPatch.set(a.branchId, {
          ...branchPatch.get(a.branchId),
          fanStopped: true,
        });
        break;

      case "fan_rpm":
        branchPatch.set(a.branchId, {
          ...branchPatch.get(a.branchId),
          fanRpm: a.rpm ?? 0,
          // Смена оборотов подразумевает работающий вентилятор.
          fanStopped: false,
        });
        break;

      case "door_close":
      case "door_open":
      case "window_set": {
        if (!a.symbolId) break;
        symbolPatch.set(a.symbolId, {
          ...symbolPatch.get(a.symbolId),
          bkWindowArea: a.windowArea ?? 0,
          // Режим «по проекту» — только он считает R из площади окна.
          // Если у значка стоял ручной R или данные съёмки, изменённое
          // сечение молча не повлияло бы на расчёт.
          bkResMode: "project",
        });
        break;
      }
    }
  }

  return {
    branches: branchPatch.size === 0 ? branches
      : branches.map(b => {
          const patch = branchPatch.get(b.id);
          return patch ? { ...b, ...patch } : b;
        }),
    symbols: symbolPatch.size === 0 ? symbols
      : symbols.map(s => {
          const patch = symbolPatch.get(s.id);
          return patch ? { ...s, ...patch } : s;
        }),
  };
}

/**
 * Подпись набора действий одной строкой — для заголовка варианта.
 *
 * Одно действие показывается как есть; несколько — через «+», иначе
 * заголовок варианта расползается на три строки.
 */
export function describeActions(actions: FireAction[]): string {
  if (actions.length === 0) return "Ничего не менять";
  return actions.map(a => a.label).join(" + ");
}

/** Суммарная трудоёмкость набора, мин. */
export function totalEffort(actions: FireAction[]): number {
  return actions.reduce((sum, a) => sum + a.effortMin, 0);
}