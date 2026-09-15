// ─────────────────────────────────────────────────────────────────────────────
// candidates.ts — какие элементы схемы вообще стоит трогать при пожаре.
//
// ЗАЧЕМ. Полный перебор невозможен: на реальной схеме сотни ветвей, а
// каждая проверка варианта — это полный расчёт вентиляционной сети,
// то есть запрос к решателю. Перебирать всё — часы ожидания ради вариантов,
// которые заведомо ни на что не влияют: дверь в другом крыле шахты не меняет
// путь дыма к людям.
//
// Поэтому сначала отбираются КАНДИДАТЫ — элементы, способные повлиять на
// исход, и только их комбинации считаются. Критерий отбора здесь один и
// инженерный: элемент должен стоять на пути между очагом пожара и людьми
// либо управлять главной струёй. Всё остальное отбрасывается до расчёта.
//
// Физики в этом файле нет — только обход графа сети и правила отбора.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import {
  type FireAction, isControllableDoor, currentWindowArea, isDoorSymbol,
} from "./actions";

/** Трудоёмкость действий, мин — см. FireAction.effortMin. */
const EFFORT = {
  /** Реверс ВГП — команда с пульта. */
  fanReverse: 2,
  /** Остановка вентилятора — тоже с пульта. */
  fanStop: 1,
  /** Смена оборотов через частотник. */
  fanRpm: 3,
  /** Автоматическая дверь — закрывается дистанционно. */
  doorAuto: 2,
  /** Обычная дверь/ляда — нужно дойти и закрыть вручную. */
  doorManual: 15,
} as const;

/** Ступени оборотов для ЧРП — доли от номинала. */
const RPM_STEPS = [0.5, 0.75] as const;

/** Автоматические двери закрываются дистанционно, остальные — ногами. */
const AUTO_DOOR_PREFIX = ["auto_", "door_auto"];

function isAutoDoor(typeId: string): boolean {
  return AUTO_DOOR_PREFIX.some(p => typeId.startsWith(p));
}

/** Исходные данные для отбора кандидатов. */
export interface CandidateInput {
  branches: TopoBranch[];
  nodes: TopoNode[];
  symbols: SchemaSymbol[];
  /**
   * Глубина влияния — сколько ветвей от очага и от людей считается «рядом».
   * Меньше — быстрее, но можно пропустить дальний рычаг. 4 покрывает
   * типовое крыло шахты.
   */
  reach?: number;
}

/**
 * Ветви, до которых от заданных узлов не более `reach` переходов.
 *
 * Обычный обход в ширину по неориентированному графу сети: направление
 * потока здесь не важно, потому что при пожаре оно как раз и меняется.
 */
function branchesWithinReach(
  branches: TopoBranch[],
  startNodes: Set<string>,
  reach: number,
): Set<string> {
  const adj = new Map<string, { to: string; id: string }[]>();
  for (const b of branches) {
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    adj.get(b.fromId)!.push({ to: b.toId, id: b.id });
    adj.get(b.toId)!.push({ to: b.fromId, id: b.id });
  }

  const out = new Set<string>();
  const seen = new Set<string>(startNodes);
  let frontier = [...startNodes];

  for (let depth = 0; depth < reach && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const edge of adj.get(node) ?? []) {
        out.add(edge.id);
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          next.push(edge.to);
        }
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Действия, которые имеет смысл рассматривать на этой схеме.
 *
 * Возвращает плоский список: каждый элемент — одно элементарное действие.
 * Комбинации из них собираются на следующем шаге (см. search.ts).
 *
 * Действие не попадает в список, если оно ничего не меняет: закрыть уже
 * закрытую дверь, реверсировать остановленный вентилятор, выставить те же
 * обороты. Такие «варианты» только раздували бы перебор и путали человека
 * в списке рекомендаций.
 */
/**
 * Почему кандидатов получилось столько, сколько получилось.
 *
 * Без этой сводки пустой или короткий список выглядит сбоем программы:
 * «подбор ничего не нашёл» одинаково читается и когда на схеме нет ни одного
 * вентилятора, и когда все они далеко от очага. Разница важна — в первом
 * случае чинить нечего, во втором достаточно увеличить глубину отбора.
 */
export interface CandidateStats {
  /** Вентиляторов на схеме всего. */
  fansTotal: number;
  /** Из них попало в отбор (ГВУ/ВВУ — всегда, ВМП — только рядом). */
  fansUsed: number;
  /** Управляемых дверей и регуляторов на схеме всего. */
  doorsTotal: number;
  /** Из них попало в отбор (только в зоне влияния). */
  doorsUsed: number;
  /** Ветвей в зоне влияния очага и людей. */
  branchesInZone: number;
  /** Задан ли на схеме очаг пожара. */
  hasFireSeat: boolean;
}

export function collectActions(input: CandidateInput, stats?: CandidateStats): FireAction[] {
  const { branches, nodes, symbols, reach = 4 } = input;
  const actions: FireAction[] = [];

  const branchById = new Map(branches.map(b => [b.id, b]));
  const nodeLabel = (id: string): string => {
    const n = nodes.find(x => x.id === id);
    return n?.name || (n?.number ? `№ ${n.number}` : "");
  };
  // У ветви нет собственного имени — только тип выработки и её узлы.
  // Поэтому подпись собирается из узлов («ств. Южный–кв. 12»), а тип
  // используется запасным вариантом, когда узлы безымянные.
  const branchLabel = (b: TopoBranch): string => {
    const ends = [nodeLabel(b.fromId), nodeLabel(b.toId)].filter(Boolean);
    if (ends.length > 0) return ends.join("–");
    return b.mineTypeName || b.type || b.id.slice(-4);
  };

  // ── Зона влияния: очаги пожара и рабочие места с людьми ──────────────────
  const hotNodes = new Set<string>();
  for (const b of branches) {
    if (b.hasFire) { hotNodes.add(b.fromId); hotNodes.add(b.toId); }
  }
  for (const n of nodes) {
    const t = n.peopleNodeType ?? "none";
    if ((t === "workplace" && (n.peopleCount ?? 0) > 0) || t === "exit") {
      hotNodes.add(n.id);
    }
  }

  // Ни очага, ни людей — отбирать не по чему, берём всю сеть: пусть лучше
  // перебор будет долгим, чем молча пустым.
  const inZone = hotNodes.size > 0
    ? branchesWithinReach(branches, hotNodes, reach)
    : new Set(branches.map(b => b.id));

  if (stats) {
    stats.branchesInZone = inZone.size;
    stats.hasFireSeat = branches.some(b => b.hasFire);
    stats.fansTotal = branches.filter(b => b.hasFan).length;
    stats.doorsTotal = symbols.filter(s => s.branchId && isControllableDoor(s)).length;
  }

  // ── Вентиляторы ──────────────────────────────────────────────────────────
  for (const b of branches) {
    if (!b.hasFan) continue;
    // Главные и вспомогательные установки рассматриваем всегда, даже вдали
    // от очага: реверс ВГП разворачивает струю по всей шахте. ВМП — только
    // в зоне влияния, он проветривает один тупик.
    const isMain = b.fanType === "ГВУ" || b.fanType === "ВВУ";
    if (!isMain && !inZone.has(b.id)) continue;
    if (b.fanStopped) continue; // остановленным управлять нечем
    if (stats) stats.fansUsed++;

    const where = b.fanName || branchLabel(b);

    if (!b.fanReverse) {
      actions.push({
        kind: "fan_reverse", branchId: b.id,
        label: `Реверсировать вентилятор ${where}`,
        objectName: where, isMainFan: isMain,
        effortMin: EFFORT.fanReverse,
      });
    }
    actions.push({
      kind: "fan_stop", branchId: b.id,
      label: `Остановить вентилятор ${where}`,
      objectName: where, isMainFan: isMain,
      effortMin: EFFORT.fanStop,
    });

    // Обороты — только для вентиляторов с характеристикой: при постоянной
    // депрессии обороты в расчёт не входят и менять их бессмысленно.
    if (b.fanMode === "curve" && (b.fanRpm ?? 0) > 0) {
      for (const step of RPM_STEPS) {
        const rpm = Math.round(b.fanRpm * step);
        if (rpm <= 0 || rpm === b.fanRpm) continue;
        actions.push({
          kind: "fan_rpm", branchId: b.id, rpm, prevRpm: b.fanRpm,
          label: `Снизить обороты ${where} до ${rpm} об/мин`,
          objectName: where, isMainFan: isMain,
          effortMin: EFFORT.fanRpm,
        });
      }
    }
  }

  // ── Двери, ляды, перемычки с регулируемым окном ──────────────────────────
  for (const s of symbols) {
    if (!s.branchId || !isControllableDoor(s)) continue;
    if (!inZone.has(s.branchId)) continue;

    const b = branchById.get(s.branchId);
    if (!b) continue;
    if (stats) stats.doorsUsed++;

    const area = b.area ?? 0;
    const now = currentWindowArea(s, area);
    const where = s.label || branchLabel(b);
    const effort = isAutoDoor(s.typeId) ? EFFORT.doorAuto : EFFORT.doorManual;

    // Закрыть — если сейчас есть хоть какой-то проход.
    if (now > 0.001) {
      actions.push({
        kind: "door_close", branchId: b.id, symbolId: s.id,
        windowArea: 0, prevWindowArea: now,
        label: `Закрыть дверь ${where}`,
        objectName: where,
        effortMin: effort,
      });
    }

    // Открыть на полное сечение — если сейчас перекрыто хотя бы частично.
    if (area > 0 && now < area * 0.999) {
      actions.push({
        kind: "door_open", branchId: b.id, symbolId: s.id,
        windowArea: area, prevWindowArea: now,
        label: `Открыть дверь ${where}`,
        objectName: where,
        effortMin: effort,
      });
      // Промежуточное положение окна: половина сечения. Регулятор редко
      // нужен «настежь» — чаще им как раз поджимают струю. У обычной двери
      // промежуточного положения нет: она либо открыта, либо закрыта.
      const half = Math.round(area * 0.5 * 100) / 100;
      if (!isDoorSymbol(s.typeId) && Math.abs(half - now) > 0.05 && half > 0.05) {
        actions.push({
          kind: "window_set", branchId: b.id, symbolId: s.id,
          windowArea: half, prevWindowArea: now,
          label: `Открыть окно ${where} на ${half} м²`,
          objectName: where,
          effortMin: effort,
        });
      }
    }
  }

  return actions;
}

/**
 * Два действия конфликтуют — их нельзя ставить в один вариант.
 *
 * Конфликт всегда об одном физическом объекте: нельзя одновременно закрыть
 * и открыть ту же дверь, остановить и реверсировать тот же вентилятор.
 * Без этой проверки перебор породил бы взаимоисключающие рекомендации,
 * а применение такого варианта зависело бы от порядка действий.
 */
export function conflicts(a: FireAction, b: FireAction): boolean {
  if (a.symbolId && a.symbolId === b.symbolId) return true;
  const fanKinds = new Set(["fan_reverse", "fan_stop", "fan_rpm"]);
  return a.branchId === b.branchId && fanKinds.has(a.kind) && fanKinds.has(b.kind);
}