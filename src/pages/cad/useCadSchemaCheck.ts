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
import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { checkSchema } from "@/lib/schemaCheck";
import { checkTopology } from "@/lib/schemaCheckTopology";
import { checkParams } from "@/lib/schemaCheckParams";
import { checkSolve } from "@/lib/schemaCheckSolve";
import { checkMethod } from "@/lib/schemaCheckMethod";
import { loadSchemaCheckSettings, saveSchemaCheckSettings, type SchemaCheckSettings } from "@/lib/schemaCheckSettings";
import type { TopoNode, TopoBranch } from "@/lib/topology";
import type { VentNorms, VentSection } from "@/lib/ventSections";
import type { SchemaSymbol } from "./cadTypes";
import type { BulkheadRef } from "@/lib/bulkheadResistance";
import type { Position } from "@/lib/positions";
import { buildBulkheadInfoMap } from "@/lib/branchBulkheadInfo";
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
  | "highV" | "lowV" | "fanAgainst" | "fanRange" | "recirc" | "faceDeficit" | "leakage" | "leakNorm"
  // По методике проверки моделей ВГСЧ
  | "measureMismatch" | "controlAlpha" | "alphaJump" | "areaJump" | "surfaceMulti" | "bulkheadNorm"
  | "bulkheadFailure" | "bulkheadThickness" | "positionDupes" | "branchNoPosition"
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
  /** Значки на схеме — перемычки/двери с их собственным (в т.ч. ручным) R. */
  symbols: SchemaSymbol[] = [],
  /** Справочник перемычек рудника — для R «по проекту». */
  bulkheadRefs: BulkheadRef[] = [],
  /** Позиции ПЛА — для проверки нумерации и охвата выработок. */
  positions: Position[] = [],
) {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  // Выбранная категория УО в группе «Объекты» (пустая строка — ничего не выбрано).
  // В этой группе поиск идёт не по вводу текста, а выбором из списка.
  const [searchObjCat, setSearchObjCat] = useState<string>("");
  const [checkTab, setCheckTab] = useState<CheckTab | null>(null);
  // Пороги проверки — настраиваются под рудник и сохраняются в localStorage.
  const [checkSettings, setCheckSettingsState] = useState<SchemaCheckSettings>(loadSchemaCheckSettings);
  const setCheckSettings = useCallback((patch: Partial<SchemaCheckSettings> | SchemaCheckSettings) => {
    setCheckSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveSchemaCheckSettings(next);
      return next;
    });
  }, []);
  const checkThreshold = checkSettings.nearThreshold;
  const checkHighRThreshold = checkSettings.highRThreshold;
  const checkBulkRThreshold = checkSettings.bulkRThreshold;
  const setCheckThreshold = useCallback((v: number) => setCheckSettings({ nearThreshold: v }), [setCheckSettings]);
  const setCheckHighRThreshold = useCallback((v: number) => setCheckSettings({ highRThreshold: v }), [setCheckSettings]);
  const setCheckBulkRThreshold = useCallback((v: number) => setCheckSettings({ bulkRThreshold: v }), [setCheckSettings]);
  // Результат проверки схемы — считается только когда открыта панель «Проверка».
  // Мемоизация исключает тяжёлый O(n) пересчёт на каждый ререндер (ховеры и т.п.).
  const schemaCheckResult = useMemo(() => {
    if (activeSide !== "check") return null;
    const s = checkSettings;
    // Сопротивление перемычек — тем же расчётом, что уходит в решатель.
    const bulkheads = buildBulkheadInfoMap(branches, symbols, bulkheadRefs);
    return {
      bulkheads,
      ...checkSchema(nodes, branches, {
        nearThreshold: s.nearThreshold,
        highRThreshold: s.highRThreshold,
        bulkRThreshold: s.bulkRThreshold,
        bulkheads,
      }),
      topo: checkTopology(nodes, branches, {
        onAxisTolerance: s.onAxisTolerance,
        crossingZTolerance: s.crossingZTolerance,
      }),
      params: checkParams(nodes, branches, {
        areaMin: s.areaMin, areaMax: s.areaMax,
        alphaMin: s.alphaMin, alphaMax: s.alphaMax,
        tinyLength: s.tinyLength,
        bulkheads,
      }),
      solve: checkSolve(branches, solved, norms, sections, {
        recircShare: s.recircPercent / 100,
        leakShare: s.leakPercent / 100,
        leakBulkMin: s.leakBulkMin,
        leakBulkMax: s.leakBulkMax,
        bulkheads,
      }),
      method: checkMethod(nodes, branches, solved, {
        measureTolCapital: s.measureTolCapital,
        measureTolOther: s.measureTolOther,
        controlAlphaMin: s.controlAlphaMin,
        controlAlphaMax: s.controlAlphaMax,
        areaJumpPercent: s.areaJumpPercent,
        isolMaxR: s.isolMaxR,
        bulkheads,
        symbols,
        positions,
      }),
    };
  }, [activeSide, nodes, branches, checkSettings, solved, norms, sections, symbols, bulkheadRefs, positions]);

  return {
    searchQuery, setSearchQuery,
    searchScope, setSearchScope,
    searchObjCat, setSearchObjCat,
    checkThreshold, setCheckThreshold,
    checkTab, setCheckTab,
    checkHighRThreshold, setCheckHighRThreshold,
    checkBulkRThreshold, setCheckBulkRThreshold,
    checkSettings, setCheckSettings,
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