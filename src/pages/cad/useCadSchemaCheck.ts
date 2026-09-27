// ─────────────────────────────────────────────────────────────────────────────
// useCadSchemaCheck / useCadLeftPanelResize — два самодостаточных блока,
// вынесенных из Cad.tsx БЕЗ изменений логики.
//
//   • useCadSchemaCheck        — поиск по схеме + пороги и результат проверки;
//   • useCadLeftPanelResize    — перетаскивание границы левой панели.
//
// Оба блока хранят собственное состояние и не зависят от остального тела
// компонента (проверка схемы получает данные параметрами), поэтому вынесены
// целиком: те же начальные значения, те же зависимости useMemo/useEffect.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useMemo, useRef, useEffect } from "react";
import { checkSchema } from "@/lib/schemaCheck";
import { checkTopology } from "@/lib/schemaCheckTopology";
import { checkParams } from "@/lib/schemaCheckParams";
import { checkSolve } from "@/lib/schemaCheckSolve";
import type { TopoNode, TopoBranch } from "@/lib/topology";
import type { VentNorms, VentSection } from "@/lib/ventSections";
import type { SideTab } from "./cadTypes";

export type CheckTab =
  | "near" | "isolated" | "dupes" | "dupbranch" | "zeroR"
  | "zeroLen" | "highR" | "bulkR" | "manualLen" | "isolatedBranch"
  | "brokenBranch"
  // Связность и стыковка
  | "selfLoop" | "components" | "noFan" | "deadFan" | "deadEnd" | "tJunction" | "crossing"
  // Параметры
  | "badArea" | "shortManualLen" | "badAlpha" | "fanNoCurve" | "zeroBulkhead"
  | "invalidValues" | "lostZ" | "tinyBranch"
  // По результатам расчёта
  | "highV" | "lowV" | "fanAgainst" | "fanRange" | "recirc" | "faceDeficit" | "leakage"
  // "solveBlock" — участки, о которые споткнулся расчёт сети. В отличие от
  // остальных вкладок, они не находятся статической проверкой схемы, а
  // приходят в диагностике от самого расчёта.
  | "solveBlock";

// "objects" — поиск по объектам схемы: вентиляторы (ГВУ/ВВУ/ВМП), перемычки,
// оборудование водопровода, очаги пожара и места взрыва.
export type SearchScope = "all" | "nodes" | "branches" | "objects";

/**
 * Поиск по схеме и проверка схемы.
 * Результат проверки считается только когда открыта панель «Проверка» —
 * мемоизация исключает тяжёлый O(n) пересчёт на каждый ререндер (ховеры и т.п.).
 */
export function useCadSchemaCheck(
  activeSide: SideTab,
  nodes: TopoNode[],
  branches: TopoBranch[],
  /** Расчёт сети выполнен — в ветвях лежат актуальные расходы. */
  solved: boolean,
  norms: VentNorms,
  sections: VentSection[],
) {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  // Выбранная категория УО в группе «Объекты» (пустая строка — ничего не выбрано).
  // В этой группе поиск идёт не по вводу текста, а выбором из списка.
  const [searchObjCat, setSearchObjCat] = useState<string>("");
  const [checkThreshold, setCheckThreshold] = useState<number>(0.01);
  const [checkTab, setCheckTab] = useState<CheckTab | null>(null);
  // Порог «большого» сопротивления ветви, Н·с²/м⁸ (кМюрг). По умолчанию 100.
  const [checkHighRThreshold, setCheckHighRThreshold] = useState<number>(100);
  // Порог сопротивления перемычки, кМюрг (норматив — 686 кМюрг)
  const [checkBulkRThreshold, setCheckBulkRThreshold] = useState<number>(686);
  // Результат проверки схемы — считается только когда открыта панель «Проверка».
  // Мемоизация исключает тяжёлый O(n) пересчёт на каждый ререндер (ховеры и т.п.).
  const schemaCheckResult = useMemo(() => {
    if (activeSide !== "check") return null;
    return {
      ...checkSchema(nodes, branches, {
        nearThreshold: checkThreshold,
        highRThreshold: checkHighRThreshold,
        bulkRThreshold: checkBulkRThreshold,
      }),
      topo: checkTopology(nodes, branches),
      params: checkParams(nodes, branches),
      solve: checkSolve(branches, solved, norms, sections),
    };
  }, [activeSide, nodes, branches, checkThreshold, checkHighRThreshold, checkBulkRThreshold, solved, norms, sections]);

  return {
    searchQuery, setSearchQuery,
    searchScope, setSearchScope,
    searchObjCat, setSearchObjCat,
    checkThreshold, setCheckThreshold,
    checkTab, setCheckTab,
    checkHighRThreshold, setCheckHighRThreshold,
    checkBulkRThreshold, setCheckBulkRThreshold,
    schemaCheckResult,
  };
}

/**
 * Ресайз левой панели: тянем границу мышью, ширина ограничена 220…640 px.
 */
export function useCadLeftPanelResize() {
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(420);
  const leftDragRef = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!leftDragRef.current) return;
      const dx = e.clientX - leftDragRef.current.startX;
      const next = Math.min(640, Math.max(220, leftDragRef.current.startW + dx));
      setLeftPanelWidth(next);
    };
    const onUp = () => { leftDragRef.current = null; document.body.style.cursor = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);
  const startLeftDrag = (e: React.MouseEvent) => {
    leftDragRef.current = { startX: e.clientX, startW: leftPanelWidth };
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  };

  return { leftPanelWidth, setLeftPanelWidth, startLeftDrag };
}
/** Полный результат проверки: базовые проверки + связность + параметры + расчёт. */
export type FullCheckResult = NonNullable<ReturnType<typeof useCadSchemaCheck>["schemaCheckResult"]>;
