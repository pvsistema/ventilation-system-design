import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLicenseContext } from "@/context/LicenseContext";
import { withLicense } from "@/lib/license";
import { type CadTool } from "@/components/cad/TopoCanvas";
import { type TopoNode, type TopoBranch, type Horizon, OVERVIEW_HORIZON_ID, recalcAll, recalcBranchAero, makeNode, makeBranch, surveyXYZ, isNodeMoved } from "@/lib/topology";
import { RAMP_WORK_ANGLE, RAMP_LIMIT_ANGLE } from "@/lib/rampBuilder";
import { CANVAS_THRESHOLD } from "@/lib/canvasRenderer";
import { SURFACE_TYPES, calcSection } from "@/lib/aerodynamics";
import { type SolveResult } from "@/lib/networkSolver";
import { getFanById, findFanByName, fanEfficiency, fanShaftPower, bladeAngleFactor } from "@/lib/fanCurves";
import type { HQDiagramData } from "@/lib/hqDiagramExcel";
import type { WaterNodeResult, WaterBranchResult } from "@/lib/waterHydraulics";
import { withWaterPumps, waterInputsFingerprint } from "@/lib/waterHydraulics";
import { type VentSection, type VentNorms, DEFAULT_VENT_NORMS } from "@/lib/ventSections";
import { type InfoDisplayConfig, DEFAULT_INFO_CONFIG } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type DxfImportResult } from "@/lib/dxfImport";
import { type Position, type AccidentType, makePosition, matchPositionColor, ACCIDENT_TYPES } from "@/lib/positions";
import { type ExcelImportResult } from "@/lib/excelImport";
import { type CombinedImportResult } from "@/lib/combinedImport";
import { type CsvImportResult } from "@/lib/import/importCommon";
import { guessBulkheadTypeId } from "@/lib/import/csvFieldUtils";
import { type VentsimCsvResult } from "@/lib/import/ventsimCsvImport";
import { type Vent2Cdf3Result } from "@/lib/import/vent2Cdf3Import";
import { type ErpImportResult } from "@/lib/erpImport";
import { exportErp } from "@/lib/erpExport";
import { exportVent2Cdf3 } from "@/lib/vent2Cdf3Export";
import { type VentsimVsmResult } from "@/lib/import/ventsimVsmImport";
import { type MineFanExport, type MineBulkheadExport, type BranchType } from "@/components/cad/EquipmentRefDialog";
import { BULKHEAD_CATALOG, airPermToR, fanWindowRkMurg, G_ACCEL } from "@/lib/bulkheads";
import { bulkheadROfBranch, buildBulkheadRMap } from "@/lib/bulkheadResistance";
import { type EvaluateContext, type VariantResult } from "@/lib/fireControl/evaluate";
import { applyActions, describeActions, toRdCommand, type FireAction } from "@/lib/fireControl/actions";
import { checkSchema } from "@/lib/schemaCheck";
import { checkTopology } from "@/lib/schemaCheckTopology";
import { checkParams } from "@/lib/schemaCheckParams";
import { buildBulkheadInfoMap } from "@/lib/branchBulkheadInfo";
import { toast } from "sonner";
import { makeDefaultOpoData, normalizeOpoData, computeOpoNetwork, type OpoData } from "@/lib/opoData";
import { type RenumberOptions } from "@/components/cad/RenumberDialog";
import { type MoveSchemaOptions, type MoveArea } from "@/components/cad/MoveSchemaDialog";
import { type HorizonAlign } from "@/components/cad/HorizonShiftBlock";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, FIRE_SYMBOL_IDS, EXPLOSION_SYMBOL_IDS, FAN_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { type PumpModel } from "@/lib/pumps";
import { calcFireTemp, calcThermalDepressionUnified, fireSourceTempForMethod, computeHotNodeTemps, calcFirePowerFromMaterial, isSignificantReversal, getThermalDepMethod, setThermalDepMethod, getNormativeFireTime, setNormativeFireTime, NORMATIVE_TIME_MAX_MIN, type ThermalDepMethod, type FireCalculationResult } from "@/lib/fireCalculator";
import { GAS_TYPES, DEFAULT_EXPLOSION_THRESHOLDS, calcExplosion, type ExplosionThresholds, type ExplosionResult } from "@/lib/explosionCalculator";
import { calcGasZone, gasZoneTime, DEFAULT_I_NEPOGASH } from "@/lib/gasZone";
import { type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";
import { type LogEntry } from "@/components/cad/LogPanel";
import { type WorkerPickMode } from "@/components/cad/WorkerPathPanel";
import { useRecentFiles, saveRecentData, saveHandleToIDB } from "@/lib/useRecentFiles";
import { fetchRemoteVersion } from "@/lib/updater";
import { calcBranchFirePower, type FireStabilityFact } from "@/lib/fireStability";
import { refreshComputeConfig, isOnBackup } from "@/lib/computeServer";
import { type RibbonTab, type SideTab, type CompareResult, type TextBlock, type HeatingSeason } from "./cadTypes";
import { MIN_SHAFT_TEMP_C } from "@/lib/heaterCalculator";
import { DEFAULT_MINE_HUMIDITY, DEFAULT_SURFACE_HUMIDITY, P_STD_KPA } from "@/lib/airHumidity";
import { VENT_DUCT_BRANDS } from "@/lib/ventDucts";
import { calcVentPipe, totalLocalXi, type VpLeakMethod } from "@/lib/ventPipeCalc";
import { buildVentPipeReport, buildVentPipeReportHtml } from "@/lib/ventPipeReport";
import { printViaIframe } from "@/components/cad/printPreview/printDialogParts";
import { computePollutionFractions, DEFAULT_POLLUTION_THRESHOLD } from "@/lib/airPollution";
import type { SchemaSymbol } from "./cadTypes";
import { type SchemeExportFormat, type SchemeExportOptions } from "@/components/cad/SchemeExportDialog";
import { type EquipRefTab } from "@/components/cad/RibbonReferences";
import { vgschParamsOf } from "@/lib/explosionModeRun";
import { resolveBulkheadSolid } from "@/lib/rescueCalculator";
import { WATER_URL, clearAirflowCache, wasAirflowCached, postAirflow } from "./cadCompute";
import { useCadHotkeys } from "./useCadHotkeys";
import { useCadSchemaCheck, type CheckTab } from "./useCadSchemaCheck";
import { useCadPanelsLayout } from "./useCadPanelsLayout";
import { useCadHeaters } from "./useCadHeaters";
import { buildVentPipeLine as buildVentPipeLineImpl } from "./buildVentPipeLine";
import { collectVentPipeLine, removeVentPipeLine } from "./ventPipeLineOps";
import { planBranchDeletion, type DeleteBranchPlan } from "./deleteBranchPlan";

// ─────────────────────────────────────────────────────────────────────────────
// Состояние и логика страницы CAD (вынесено из src/pages/Cad.tsx без изменений).
// Хук возвращает всё, что используется в разметке страницы и её частях.
// ─────────────────────────────────────────────────────────────────────────────

export function useCadPage() {
  const license = useLicenseContext();
  // Демо-ограничения действуют не только при status="demo", но и когда
  // лицензию нельзя подтвердить: просрочен оффлайн-кэш или переведены назад
  // системные часы. Иначе такая блокировка, наоборот, СНИМАЛА бы ограничения.
  const isDemo = license.status === "demo"
    || license.status === "offline_expired"
    || license.status === "clock_rollback";
  const [showLicenseDialog, setShowLicenseDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);

  // При первом запуске без лицензии показываем диалог активации.
  // То же при блокировке — человек должен увидеть причину и способ исправить.
  useEffect(() => {
    if (license.status === "demo"
      || license.status === "offline_expired"
      || license.status === "clock_rollback") setShowLicenseDialog(true);
  }, [license.status]);

  // ПОЛНЫЙ путь файла на диске — заполняется, когда проект открыт двойным
  // кликом в проводнике (десктоп). В этом сценарии FileSystemFileHandle не
  // существует, и без пути «Сохранить» уходило в «Сохранить как».
  // Наличие пути позволяет перезаписать исходный файл напрямую через C#-мост.
  const filePathRef = useRef<string | null>(null);
  // Ссылка на applyProjectData — обработчик открытия файла из ОС регистрируется
  // раньше, чем объявлена сама функция.
  const applyProjectDataRef = useRef<((data: Record<string, unknown>, fileName: string, fromDisk?: boolean) => void) | null>(null);

  // Открытие .vproj файла из десктопа (двойной клик по файлу в проводнике).
  // Новые сборки оболочки просят файл у себя ещё до запуска скриптов страницы
  // и оставляют обещание в window.__pvsPendingFilePromise — забираем готовое.
  // Для старых сборок остаётся прежний путь: window.electronAPI инжектируется
  // C# (WebView2) и может появиться ПОЗЖЕ, чем смонтируется React, поэтому его
  // появления приходится дожидаться опросом.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type EAPI = { onOpenFile?: (h: (f: { path: string; content: string }) => void) => void; offOpenFile?: () => void };
    let cancelled = false;
    let registered: EAPI | null = null;

    const handler = ({ path, content }: { path: string; content: string }) => {
      try {
        const data = JSON.parse(content);
        if (data && data.nodes && Array.isArray(data.nodes)) {
          // Имя берём из ИМЕНИ ФАЙЛА на диске, а не из data.name внутри JSON.
          // Иначе схема, сохранённая когда-то под другим именем, открывалась
          // со «старым» названием, не совпадающим с файлом в проводнике.
          const fileName = (path || "").split(/[\\/]/).pop() || "project.vproj";
          // Запоминаем путь — «Сохранить» перезапишет именно этот файл,
          // без диалога «Сохранить как».
          filePathRef.current = path || null;
          fileHandleRef.current = null;
          applyProjectDataRef.current?.(data, fileName, true);
        }
      } catch { /* повреждённый файл — тихо игнорируем */ }
    };

    // БЫСТРЫЙ ПУТЬ. Оболочка запрашивает файл у себя же ещё до загрузки
    // страницы и кладёт обещание в window.__pvsPendingFilePromise. Если оно
    // есть — схема уже читается (а чаще прочитана) и ждать моста незачем:
    // раньше поллинг с шагом 200 мс мог сам по себе задержать открытие на
    // пятую долю секунды, а на медленном старте — заметно дольше.
    const early = (window as unknown as {
      __pvsPendingFilePromise?: Promise<{ path?: string; content?: string; error?: string } | null> | null;
    }).__pvsPendingFilePromise;

    if (early) {
      (window as unknown as { __pvsPendingFilePromise?: unknown }).__pvsPendingFilePromise = null;
      early.then((r) => {
        if (cancelled || !r) return;
        if (r.content) { handler({ path: r.path || "", content: r.content }); return; }
        if (r.error) {
          // Файл не прочитался (нет доступа, сетевой диск отвалился). Молчать
          // здесь нельзя: открылся бы пустой новый проект, и человек не понял
          // бы, почему схема не появилась.
          try { console.error("[PVS] Не удалось открыть файл: " + r.error); } catch { /* ignore */ }
          alert("Не удалось открыть файл.\n\n" + r.error);
        }
      });
      return () => { cancelled = true; };
    }

    const tryRegister = () => {
      if (cancelled) return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eAPI = (window as any).electronAPI as EAPI | undefined;
      if (eAPI?.onOpenFile) {
        registered = eAPI;
        eAPI.onOpenFile(handler);
        return true;
      }
      return false;
    };

    if (!tryRegister()) {
      // Запасной путь для СТАРЫХ сборок оболочки, где раннего обещания нет.
      // Шаг опроса 30 мс вместо 200: мост появляется почти сразу, и крупный
      // шаг тут был чистым простоем.
      let tries = 0;
      const iv = window.setInterval(() => {
        if (tryRegister() || ++tries >= 160) window.clearInterval(iv);
      }, 30);
      return () => { cancelled = true; window.clearInterval(iv); registered?.offOpenFile?.(); };
    }
    return () => { cancelled = true; registered?.offOpenFile?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [activeRibbon, setActiveRibbon] = useState<RibbonTab>("home");
  // Лента свёрнута — видны только корешки вкладок, панель инструментов скрыта.
  // Освобождает ~80 px по высоте под схему на небольших экранах.
  // Выбор запоминается между запусками (как в Аэросети и офисных программах).
  const [ribbonCollapsed, setRibbonCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("pvs_ribbon_collapsed") === "1"; } catch { return false; }
  });
  // Выбор вкладки. Если лента свёрнута — разворачиваем: иначе клик по корешку
  // не давал бы никакого видимого отклика и выглядел бы как неработающая кнопка.
  const selectRibbon = (tab: RibbonTab) => {
    setActiveRibbon(tab);
    if (ribbonCollapsed) {
      setRibbonCollapsed(false);
      try { localStorage.setItem("pvs_ribbon_collapsed", "0"); } catch { /* ignore */ }
    }
  };
  const toggleRibbonCollapsed = () => {
    setRibbonCollapsed(v => {
      const next = !v;
      try { localStorage.setItem("pvs_ribbon_collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const [activeSide, setActiveSide] = useState<SideTab>("params");
  const [mineFans, setMineFans] = useState<MineFanExport[]>([
    { catalogId: "VOD-18", name: "ВО-18/12АВР", diameter: 1.8, rpmMin: 600, rpmMax: 1500 },
  ]);
  // Данные ОПО (паспорт объекта). Сводка по сети считается отдельно, по схеме.
  const [showOpoDialog, setShowOpoDialog] = useState(false);
  const [opoData, setOpoData] = useState<OpoData>(() => makeDefaultOpoData());
  const [mineBulkheads, setMineBulkheads] = useState<MineBulkheadExport[]>(() =>
    BULKHEAD_CATALOG.map(item => ({
      id: `mb_${item.id}`,
      name: item.name,
      type: item.type,
      airPermeability: item.airPermeability,
      rMkyurg: airPermToR(item.airPermeability) / 1000, // Мюрг → кМюрг
      failurePressure: item.failurePressure,
      note: item.note,
      color: item.color,
    }))
  );
  const [mineTypes, setMineTypes] = useState<BranchType[]>([]);

  // ─── Топология ─────────────────────────────────────────────────────────
  const [nodes, setNodes] = useState<TopoNode[]>([]);
  const [branchesRaw, setBranches] = useState<TopoBranch[]>([]);

  // ─── Текстовые блоки ────────────────────────────────────────────────────
  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);
  const [selectedTextBlockId, setSelectedTextBlockId] = useState<string | null>(null);
  const [editingTextBlockId, setEditingTextBlockId] = useState<string | null>(null);
  const textDragRef = useRef<{ id: string; startSx: number; startSy: number; startWx: number; startWy: number } | null>(null);
  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);

  // ─── История изменений (undo) ───────────────────────────────────────────
  const historyRef = useRef<Array<{ nodes: TopoNode[]; branches: TopoBranch[]; symbols: SchemaSymbol[]; textBlocks: TextBlock[] }>>([]);
  const nodesRef      = useRef(nodes);
  const branchesRef   = useRef(branchesRaw);
  const symbolsRef    = useRef<SchemaSymbol[]>([]);
  const textBlocksRef = useRef<TextBlock[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { branchesRef.current = branchesRaw; }, [branchesRaw]);
  // Очистка таймера индикатора расчёта сети при размонтировании.
  useEffect(() => () => {
    if (solveProgressTimer.current) window.clearInterval(solveProgressTimer.current);
    if (fireProgressTimer.current) window.clearInterval(fireProgressTimer.current);
  }, []);
  useEffect(() => { textBlocksRef.current = textBlocks; }, [textBlocks]);

  const pushHistory = () => {
    historyRef.current = [...historyRef.current.slice(-49),
      { nodes: nodesRef.current, branches: branchesRef.current, symbols: symbolsRef.current, textBlocks: textBlocksRef.current }];
  };
  const handleUndo = () => {
    const snap = historyRef.current.pop();
    if (!snap) return;
    setNodes(snap.nodes);
    setBranches(snap.branches);
    setSchemaSymbols(snap.symbols);
    setTextBlocks(snap.textBlocks ?? []);
  };

  // Keydown: Esc сбрасывает режим textblock/редактирование, Delete удаляет выбранный блок
  const selectedTextBlockIdRef = useRef<string | null>(null);
  const editingTextBlockIdRef  = useRef<string | null>(null);
  useEffect(() => { selectedTextBlockIdRef.current = selectedTextBlockId; }, [selectedTextBlockId]);
  useEffect(() => { editingTextBlockIdRef.current  = editingTextBlockId;  }, [editingTextBlockId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        if (editingTextBlockIdRef.current) { setEditingTextBlockId(null); return; }
        setTool(t => t === "textblock" ? "select" : t);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedTextBlockIdRef.current && !editingTextBlockIdRef.current) {
        e.preventDefault();
        const id = selectedTextBlockIdRef.current;
        pushHistory();
        setTextBlocks(prev => prev.filter(t => t.id !== id));
        setSelectedTextBlockId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
   
  }, []);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [tool, setTool] = useState<CadTool>("select");
  const [zLevel, setZLevel] = useState(0);

  // Режим правки маркшейдерских координат (F2). Выключен — перетаскивание
  // узлов меняет только отрисовку, расчёт остаётся привязан к эталону.
  const [surveyEditMode, setSurveyEditMode] = useState(false);
  // Сколько узлов сдвинуто с маркшейдерских мест — счётчик в статусной строке.
  const movedNodeCount = useMemo(() => nodes.filter(isNodeMoved).length, [nodes]);
  // Окно подтверждения возврата схемы к маркшейдерским координатам (F5).
  const [resetSurveyDialog, setResetSurveyDialog] = useState(false);

  // Авто-пересчёт длин и аэродинамики по координатам/параметрам
  const branches = useMemo(() => recalcAll(nodes, branchesRaw), [nodes, branchesRaw]);
  // Узлы по id. Поиск узла перебором всего списка — самая частая мелкая
  // операция в программе, а в режиме выноски он делался внутри цикла по всем
  // выработкам на КАЖДОЕ движение мыши: на схеме в 300 ветвей это 78 тысяч
  // лишних сравнений за кадр. С индексом узел находится сразу.
  const nodesById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  // Сводка для «Данных ОПО»: длины и количество вентустройств берутся из схемы,
  // поэтому цифры не могут разойтись с фактическим состоянием сети.
  const opoSummary = useMemo(
    () => computeOpoNetwork(branches, mineBulkheads),
    [branches, mineBulkheads],
  );
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedBranch = branches.find((b) => b.id === selectedBranchId) ?? null;

  // Гидравлический расчёт водопроводной сети ППЗ (backend).
  // Сам useEffect вынесен ниже — после объявления schemaSymbols, т.к. он его использует.
  const [waterNetwork, setWaterNetwork] = useState<{ nodeResults: Map<string, WaterNodeResult>; branchResults: Map<string, WaterBranchResult> }>({ nodeResults: new Map(), branchResults: new Map() });

  // Запоминаем последнюю вкладку отдельно для узлов и ветвей
  const lastNodeTab = useRef<SideTab>("params");
  const lastBranchTab = useRef<SideTab>("general");

  // Переключаем вкладку при смене выбранного узла/ветви — восстанавливаем последнюю
  useEffect(() => {
    if (selectedNodeId) {
      setActiveSide(lastNodeTab.current);
    } else if (selectedBranchId) {
      setActiveSide(lastBranchTab.current);
    } else {
      setActiveSide("general");
    }
  }, [selectedNodeId, selectedBranchId]);

  // Запоминаем вкладку при каждом изменении activeSide
  useEffect(() => {
    if (selectedNodeId) {
      lastNodeTab.current = activeSide;
    } else if (selectedBranchId) {
      lastBranchTab.current = activeSide;
    }
  }, [activeSide]);



  // Синхронизация расчётной мощности пожара из свойств горючего материала →
  // fireHeatRelease. Мощность считается из физических свойств материала (кабель,
  // дерево, конвейер, техника) — так же, как во вкладке «Пожарная нагрузка»,
  // чтобы температура продуктов совпадала. Для угля/масла/произвольного авто-
  // расчёта нет — там мощность вводится вручную.
  useEffect(() => {
    const b = selectedBranch;
    if (!b?.hasFire) return;
    const autoPower = calcFirePowerFromMaterial({
      fireCombustible: b.fireCombustible,
      flow: b.flow,
      length: b.length,
      fireVehicleMassRubber: b.fireVehicleMassRubber,
      fireVehicleMassDiesel: b.fireVehicleMassDiesel,
      fireVehicleMassOil: b.fireVehicleMassOil,
      fireCableHeatValue: b.fireCableHeatValue, fireCableBurnRate: b.fireCableBurnRate,
      fireCableDensity: b.fireCableDensity, fireCableLength: b.fireCableLength,
      fireCableWidth: b.fireCableWidth, fireCableThick: b.fireCableThick,
      fireCableDiameter: b.fireCableDiameter, fireCableInsulThick: b.fireCableInsulThick,
      fireCableCount: b.fireCableCount, fireCableFlameSpeed: b.fireCableFlameSpeed,
      fireCableCalcTime: b.fireCableCalcTime,
      fireWoodHeatValue: b.fireWoodHeatValue, fireWoodBurnRate: b.fireWoodBurnRate,
      fireWoodDensity: b.fireWoodDensity, fireWoodLength: b.fireWoodLength,
      fireWoodWidth: b.fireWoodWidth, fireWoodThick: b.fireWoodThick,
      fireWoodFlameSpeed: b.fireWoodFlameSpeed, fireWoodCalcTime: b.fireWoodCalcTime,
      fireBeltBurnRate: b.fireBeltBurnRate, fireBeltDensity: b.fireBeltDensity,
      fireBeltWidth: b.fireBeltWidth, fireBeltLength: b.fireBeltLength,
      fireBeltThickness: b.fireBeltThickness, fireBeltFlameSpeed: b.fireBeltFlameSpeed,
      fireSourceArea: b.fireSourceArea, fireSourceBurnRate: b.fireSourceBurnRate,
    });
    if (autoPower == null || !Number.isFinite(autoPower) || autoPower <= 0) return;
    const roundedPower = Math.round(autoPower * 100) / 100;
    const patch: Partial<TopoBranch> = {};
    if (Number.isFinite(roundedPower) && Math.abs((b.fireHeatRelease ?? 5) - roundedPower) > 0.01) {
      patch.fireHeatRelease = roundedPower;
    }
    // В режиме «Температурой» температуру задаёт пользователь ВРУЧНУЮ —
    // авто-подстановку из мощности материала НЕ делаем (иначе введённое
    // значение, напр. 1000°C, постоянно затиралось бы расчётным).
    // Авто-мощность fireHeatRelease продолжаем обновлять для справки.
    // Одним обновлением (без спама истории) — чтобы не крутить лишние ре-рендеры
    // при переключении режима «Температурой»/«Мощностью».
    if (Object.keys(patch).length > 0) {
      updateBranch(b.id, patch, false);
    }
  }, [
    selectedBranchId,
    selectedBranch?.fireCombustible,
    selectedBranch?.fireVehicleMassRubber,
    selectedBranch?.fireVehicleMassDiesel,
    selectedBranch?.fireVehicleMassOil,
    selectedBranch?.fireCableHeatValue, selectedBranch?.fireCableBurnRate,
    selectedBranch?.fireCableDensity, selectedBranch?.fireCableLength,
    selectedBranch?.fireCableWidth, selectedBranch?.fireCableThick,
    selectedBranch?.fireCableDiameter, selectedBranch?.fireCableInsulThick,
    selectedBranch?.fireCableCount, selectedBranch?.fireCableFlameSpeed,
    selectedBranch?.fireCableCalcTime,
    selectedBranch?.fireWoodHeatValue, selectedBranch?.fireWoodBurnRate,
    selectedBranch?.fireWoodDensity, selectedBranch?.fireWoodLength,
    selectedBranch?.fireWoodWidth, selectedBranch?.fireWoodThick,
    selectedBranch?.fireBeltBurnRate, selectedBranch?.fireBeltDensity,
    selectedBranch?.fireBeltWidth, selectedBranch?.fireBeltLength,
    selectedBranch?.fireBeltThickness,
    selectedBranch?.fireSourceArea, selectedBranch?.fireSourceBurnRate,
    selectedBranch?.fireMode,
    selectedBranch?.flow,
    selectedBranch?.length,
  ]);

  const updateNode = (id: string, patch: Partial<TopoNode>, saveHistory = true) => {
    if (saveHistory) pushHistory();
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n));
  };

  // Ref для вызова расчёта из updateBranch (handleSolveLocal объявлен позже)
  const handleSolveRef = useRef<(() => void) | null>(null);

  const updateBranch = (id: string, patch: Partial<TopoBranch>, saveHistory = true) => {
    if (saveHistory) pushHistory();
    setBranches((prev) => prev.map((b) => b.id === id ? { ...b, ...patch } : b));

    // Синхронизируем УО перемычки при изменении hasBulkhead
    if ("hasBulkhead" in patch) {
      if (!patch.hasBulkhead) {
        // При снятии флага — удаляем ВСЕ символы перемычки с этой ветви
        setSchemaSymbols(prev => prev.filter(s => !(BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === id)));
      }
      // При установке hasBulkhead=true символ уже добавляется через onSymbolPlace — не дублируем
    }

    // Синхронизируем airDirection на символе вентилятора при изменении fanReverse
    if ("fanReverse" in patch) {
      setSchemaSymbols((prev) => prev.map((s) =>
        s.typeId === "fan" && s.branchId === id
          ? { ...s, airDirection: patch.fanReverse ? "reverse" : "forward" }
          : s
      ));
      // При переключении реверса — всегда перезапускаем расчёт сети,
      // чтобы стрелки на схеме корректно отобразили новое направление потока.
      setTimeout(() => handleSolveRef.current?.(), 100);
    }

    // Аналог disable_fan(): при остановке/запуске вентилятора — автопересчёт сети.
    // Это позволяет сразу увидеть критическую ситуацию (сеть не проветривается).
    if ("fanStopped" in patch) {
      setTimeout(() => handleSolveRef.current?.(), 100);
    }
  };

  // ─── ГОРИЗОНТЫ + АКТИВНЫЙ ГОРИЗОНТ (для построения новых узлов) ────
  // Каждый горизонт = слой ветвей с цветом и Z-отметкой; можно скрывать.
  // При выборе горизонта новые узлы создаются с его Z и привязкой horizonId.
  // Существующие объекты НЕ трогаются.
  // Стартовое состояние горизонтов: всегда один «Общий вид». Остальные
  // горизонты приходят вместе со схемой при открытии файла проекта.
  const [horizons, setHorizons] = useState<Horizon[]>(() => {
    const DEFAULT_OVERVIEW: Horizon = {
      id: OVERVIEW_HORIZON_ID, name: "Общий вид", z: 0, color: "var(--c-t3, #6b7280)", visible: true,
      printLayer: { visible: true, title: "Общий вид вентиляционной схемы", scale: "авто",
        orgName: "", approverTitle: "", approverName: "", year: new Date().getFullYear().toString(),
        period: "", developer: "", checker: "", sheetNum: "1", sheetTotal: "1",
        showLegend: false, showStamp: false, showApprover: false,
        paperFormat: "A1", orientation: "landscape" },
    } as Horizon;

    // Горизонты принадлежат ПРОЕКТУ, а не программе: они приходят вместе со
    // схемой из файла .vproj. Раньше список горизонтов запоминался отдельно и
    // переживал закрытие программы — при пустой рабочей области показывались
    // горизонты предыдущего проекта («Гор. 1100 м», «ГВУ» и прочие), хотя
    // выработок к ним не было. Пустой проект начинается с одного «Общего вида».
    if (typeof window === "undefined") return [DEFAULT_OVERVIEW];

    // Подчищаем список от прежних версий программы, где он сохранялся.
    try {
      localStorage.removeItem("vent-cad/horizons-v4");
      localStorage.removeItem("vent-cad/data-version");
    } catch { /* хранилище недоступно — не важно */ }

    return [DEFAULT_OVERVIEW];
  });
  const [activeHorizonId, setActiveHorizonId] = useState<string>("");
  // ID горизонта, у которого пользователь редактирует подложку (тащит углы).
  const [editingHorizonImageId, setEditingHorizonImageId] = useState<string | null>(null);
  // ID горизонта, у которого пользователь редактирует bounds слоя печати (тащит рамку).
  const [editingPrintLayerId, setEditingPrintLayerId] = useState<string | null>(null);
  const activeHorizon = horizons.find((h) => h.id === activeHorizonId) ?? null;
  const updateHorizon = (id: string, patch: Partial<Horizon>) =>
    setHorizons((p) => p.map((h) => h.id === id ? { ...h, ...patch } : h));
  // Палитра для новых горизонтов: контрастные, хорошо различимые на белом фоне
  // цвета. Берём первый ещё не занятый — так соседние горизонты не сливаются;
  // когда палитра исчерпана, выбираем случайный.
  const HORIZON_PALETTE = [
    "#dc2626", "#2563eb", "#16a34a", "#9333ea", "#ea580c",
    "#0891b2", "#c026d3", "#65a30d", "#e11d48", "#4f46e5",
    "#0d9488", "#b45309",
  ];
  const addHorizon = () => {
    const id = `H_${Date.now()}`;
    setHorizons((p) => {
      const used = new Set(p.map((h) => (h.color ?? "").toLowerCase()));
      const free = HORIZON_PALETTE.filter((c) => !used.has(c.toLowerCase()));
      const color = free.length > 0
        ? free[Math.floor(Math.random() * free.length)]
        : HORIZON_PALETTE[Math.floor(Math.random() * HORIZON_PALETTE.length)];
      return [...p, { id, name: `Горизонт ${p.length + 1}`, z: 0, color, visible: true }];
    });
  };
  const removeHorizon = (id: string) => {
    if (id === OVERVIEW_HORIZON_ID) return; // "Общий вид" нельзя удалить
    setHorizons((p) => p.filter((h) => h.id !== id));
    setBranches((p) => p.map((b) => b.horizonId === id ? { ...b, horizonId: "" } : b));
    if (activeHorizonId === id) setActiveHorizonId("");
    if (editingHorizonImageId === id) setEditingHorizonImageId(null);
  };

  // Число выработок на каждом горизонте — для списка горизонтов.
  // Один проход по ветвям вместо полного перебора на каждую строку списка.
  const branchCountByHorizon = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of branchesRaw) if (b.horizonId) m.set(b.horizonId, (m.get(b.horizonId) ?? 0) + 1);
    return m;
  }, [branchesRaw]);

  // Наведение на горизонт в списке слева → подсветка его ветвей на схеме
  const [hoveredHorizonId, setHoveredHorizonId] = useState<string | null>(null);

  // Bounds "Общего вида" теперь вычисляются динамически в TopoCanvas
  // из проекций всех узлов — это корректно при любой проекции (план/фронт/профиль/ИЗО).

  const setHorizonImageBounds = (
    id: string, bounds: { x1: number; y1: number; x2: number; y2: number },
  ) => {
    setHorizons((p) => p.map((h) => {
      if (h.id !== id || !h.image) return h;
      return { ...h, image: { ...h.image, bounds } };
    }));
  };

  const setPrintLayerBounds = (
    id: string, bounds: { x1: number; y1: number; x2: number; y2: number },
  ) => {
    setHorizons((p) => p.map((h) => {
      if (h.id !== id || !h.printLayer) return h;
      return { ...h, printLayer: { ...h.printLayer, bounds } };
    }));
  };

  // Загрузка картинки в подложку: читаем файл, сжимаем до 2000 px по большей стороне,
  // сохраняем как dataURL в state. По умолчанию ставим bounds = ±1000 м вокруг 0.
  const uploadHorizonImage = async (horizonId: string, file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Поддерживаются только изображения PNG/JPG.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        // Сжимаем до 2000 px по большей стороне, чтобы dataURL не раздувал state.
        const MAX = 2000;
        let w = img.width, h = img.height;
        if (Math.max(w, h) > MAX) {
          const k = MAX / Math.max(w, h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = cv.toDataURL("image/jpeg", 0.85);
        const aspect = w / h;
        // Вычисляем центр схемы из координат узлов (самый надёжный способ)
        const curNodes = nodesRef.current;
        let worldCx = 0, worldCy = 0, halfH = 1000, halfW = halfH * aspect;
        if (curNodes.length > 0) {
          const xs = curNodes.map(n => n.x);
          const ys = curNodes.map(n => n.y);
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          worldCx = (minX + maxX) / 2;
          worldCy = (minY + maxY) / 2;
          // Размер подложки: покрываем всю схему с запасом
          const spanX = Math.max(maxX - minX, 1000);
          const spanY = Math.max(maxY - minY, 1000);
          // Подбираем halfW и halfH чтобы схема вписалась с соотношением сторон картинки
          halfW = Math.max(spanX, spanY * aspect) * 0.75;
          halfH = halfW / aspect;
        } else {
          // Нет узлов — берём центр видимой области через savedViewState
          const vs = savedViewStateRef.current;
          const sc = vs?.scale ?? 1;
          const ox = vs?.offsetX ?? 0;
          const oy = vs?.offsetY ?? 0;
          const xy = xyScale ?? 1;
          const screenCx = window.innerWidth / 2;
          const screenCy = window.innerHeight / 2;
          worldCx = ((screenCx - ox) / sc) / (xy || 1);
          worldCy = -((screenCy - oy) / sc) / (xy || 1);
          halfH = Math.abs((window.innerHeight * 0.35) / sc) / (xy || 1);
          halfW = halfH * aspect;
        }
        setHorizons((p) => p.map((hz) => hz.id === horizonId ? {
          ...hz,
          image: {
            dataUrl: compressed,
            bounds: {
              x1: worldCx - halfW, y1: worldCy - halfH,
              x2: worldCx + halfW, y2: worldCy + halfH,
            },
            opacity: 0.6,
            visible: true,
          },
        } : hz));
        setEditingHorizonImageId(horizonId);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const removeHorizonImage = (id: string) => {
    setHorizons((p) => p.map((h) => h.id === id ? { ...h, image: undefined } : h));
    if (editingHorizonImageId === id) setEditingHorizonImageId(null);
  };

  // Возвращает следующий уникальный числовой ID для узла (учитывает удаления).
  const nextNodeId = (existing: TopoNode[] = nodes): string => {
    const used = new Set(existing.map((n) => n.id));
    let i = 1;
    while (used.has(String(i))) i++;
    return String(i);
  };
  const nextBranchId = (existing: TopoBranch[] = branchesRaw): string => {
    const used = new Set(existing.map((b) => b.id));
    let i = 1;
    while (used.has(String(i))) i++;
    return String(i);
  };

  // Перенумеровать узлы и/или ветви с расширенными настройками.
  const renumberAll = (opts: RenumberOptions | "asc" | "desc" = "asc") => {
    // Обратная совместимость со старым вызовом (строка)
    const options: RenumberOptions = (typeof opts === "string") ? {
      area: "all", horizonId: "", mode: "restart", objects: "both",
      startFrom: 1, direction: opts,
    } : opts;

    const { area, horizonId, mode, objects, startFrom, direction } = options;

    // Фильтрация по горизонту
    const targetNodes = area === "horizon"
      ? nodes.filter((n) => {
          const nb = branchesRaw.filter((b) => b.fromId === n.id || b.toId === n.id);
          return nb.some((b) => b.horizonId === horizonId);
        })
      : nodes;

    const targetBranches = area === "horizon"
      ? branchesRaw.filter((b) => b.horizonId === horizonId)
      : branchesRaw;

    // Определяем стартовый номер
    const getStart = (existingIds: string[]) => {
      if (mode === "continue") {
        const max = existingIds.reduce((m, id) => {
          const n = parseInt(id);
          return isNaN(n) ? m : Math.max(m, n);
        }, 0);
        return max + 1;
      }
      return startFrom;
    };

    const nodeStart = getStart(nodes.map((n) => n.id));
    const branchStart = getStart(branchesRaw.map((b) => b.id));

    const nodeMap = new Map<string, string>();
    if (objects === "nodes" || objects === "both") {
      const order = direction === "asc" ? targetNodes : [...targetNodes].reverse();
      order.forEach((n, i) => nodeMap.set(n.id, String(nodeStart + i)));
    }

    const branchMap = new Map<string, string>();
    if (objects === "branches" || objects === "both") {
      const order = direction === "asc" ? targetBranches : [...targetBranches].reverse();
      order.forEach((b, i) => branchMap.set(b.id, String(branchStart + i)));
    }

    if (nodeMap.size > 0) {
      setNodes((prev) => prev.map((n) => {
        const newId = nodeMap.get(n.id) ?? n.id;
        const oldId = n.id;
        // Автонумерация задаёт только НОМЕР узла. Название оставляем пустым,
        // если оно было автоматическим ("Узел N" / совпадает с id). Осмысленное
        // пользовательское название сохраняем.
        const isAutoName = !n.name || n.name.startsWith("Узел ") || n.name === oldId;
        return { ...n, id: newId, number: newId, name: isAutoName ? "" : n.name };
      }));
    }

    if (branchMap.size > 0) {
      setBranches((prev) => prev.map((b) => ({
        ...b,
        id: branchMap.get(b.id) ?? b.id,
        fromId: nodeMap.get(b.fromId) ?? b.fromId,
        toId: nodeMap.get(b.toId) ?? b.toId,
      })));
      setSchemaSymbols((prev) => prev.map((s) => ({
        ...s,
        branchId: s.branchId ? (branchMap.get(s.branchId) ?? s.branchId) : s.branchId,
      })));
    } else if (nodeMap.size > 0) {
      // Обновляем fromId/toId ветвей если переименовали только узлы
      setBranches((prev) => prev.map((b) => ({
        ...b,
        fromId: nodeMap.get(b.fromId) ?? b.fromId,
        toId: nodeMap.get(b.toId) ?? b.toId,
      })));
    }

    // Сбросим выделение, чтобы не ссылаться на старые id.
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    setSelectedSymbolId(null);
    setSelectedSymbolIds(new Set());
    setIsDirty(true);
  };

  // Создаёт узел в указанной мировой точке. Если активен горизонт —
  // навязывает его Z и horizonId. Возвращает ID созданного узла.
  const handleNodeAdd = (x: number, y: number, z: number): string => {
    if (isDemo && nodes.length >= 20) {
      setShowLicenseDialog(true);
      return "";
    }
    pushHistory();
    const newId = nextNodeId();
    const finalZ = activeHorizon ? activeHorizon.z : z;
    const node = makeNode(newId, {
      x, y, z: finalZ,
      name: "",
      number: newId,
    });
    setNodes((p) => [...p, node]);
    setSelectedNodeId(newId);
    setSelectedBranchId(null);
    // ИНСТРУМЕНТ НЕ СБРАСЫВАЕТСЯ — каждый клик добавляет следующий узел.
    return newId;
  };

  const handleBranchAdd = (fromId: string, toId: string): string => {
    pushHistory();
    const id = nextBranchId();
    // Если активен горизонт — навешиваем привязку на ветвь
    const horizonId = activeHorizon ? activeHorizon.id : "";
    const b = makeBranch(id, fromId, toId, { horizonId });
    setBranches((p) => [...p, b]);
    setSelectedBranchId(id);
    setSelectedNodeId(null);
    // ИНСТРУМЕНТ НЕ СБРАСЫВАЕТСЯ — продолжаем строить цепочку ветвей.
    return id;
  };

  // ─── ПОСТРОЕНИЕ ВЕНТ. ТРУБОПРОВОДА КАК ПАРАЛЛЕЛЬНОЙ НИТИ ─────────────
  // Логика вынесена в buildVentPipeLine без изменений: тот же порядок шагов и
  // те же формулы. Состояние передаётся параметрами.
  const buildVentPipeLine = (branchIds: string[], vpPatchRaw: Partial<TopoBranch>): void => {
    buildVentPipeLineImpl(branchIds, vpPatchRaw, {
      nodes, branchesRaw, branchWidth, nextNodeId, nextBranchId, pushHistory,
      setNodes, setBranches, setSelectedBranchIds, setSelectedBranchId, setSelectedNodeId,
    });
  };

  // ─── ОПЕРАЦИИ НАД ВСЕМ ВЕНТСТАВОМ ЦЕЛИКОМ ────────────────────────────
  // Став состоит из десятков ветвей, и раньше его правка сводилась к тому,
  // чтобы удалить их по одной и построить став заново. Эти две операции
  // работают со ставом как с единым объектом.

  /** Выделяет став целиком и открывает диалог его параметров. */
  const editVentPipeLine = (branchId: string): void => {
    const line = collectVentPipeLine(branchId, branchesRaw);
    if (line.length === 0) return;
    setSelectedBranchIds(new Set(line));
    setSelectedBranchId(line[0]);
    setVentPipeBranchIds(line);
    setShowVentPipeDialog(true);
  };

  /** Удаляет став целиком вместе с его узлами-дубликатами. */
  const deleteVentPipeLine = (branchId: string): void => {
    const line = collectVentPipeLine(branchId, branchesRaw);
    if (line.length === 0) return;
    pushHistory();
    const res = removeVentPipeLine(line, nodes, branchesRaw);
    setNodes(res.nodes);
    setBranches(res.branches);
    setSelectedBranchId(null);
    setSelectedBranchIds(new Set());
    setSelectedNodeId(null);
  };

  // ─── РАЗДЕЛЕНИЕ ВЕТВИ НОВЫМ УЗЛОМ ───────────────────────────────────
  // Используется когда инструмент «Узел» кликает прямо на существующую ветвь
  // (snap к ветви) или из меню «Разделить выработку».
  // Логика: A→B превращается в A→N (id ветви сохраняется) и N→B (новая ветвь).
  // Параметры старой ветви (тип, сечение, поверхность, горизонт, флаг вентилятора)
  // переносятся на оба сегмента.
  const handleSplitBranchAt = (branchId: string, x: number, y: number, z: number): string => {
    pushHistory();
    const old = branchesRaw.find((b) => b.id === branchId);
    if (!old) return "";
    const fromN = nodes.find((n) => n.id === old.fromId);
    const toN = nodes.find((n) => n.id === old.toId);
    if (!fromN || !toN) return "";

    // Создаём новый узел в точке разреза
    const newNodeId = nextNodeId();
    // Номер узла — только цифра, без буквенных префиксов
    const usedNumsSplit = new Set(nodes.map((n) => parseInt(n.number, 10)).filter((n) => !isNaN(n)));
    let nextNumSplit = 1;
    while (usedNumsSplit.has(nextNumSplit)) nextNumSplit++;
    const num = String(nextNumSplit);
    // ── Высотная отметка нового узла ────────────────────────────────────────
    // Узел ставится НА СУЩЕСТВУЮЩУЮ ветвь, поэтому его отметка обязана лежать
    // на этой ветви: интерполируем z между её концами по положению точки реза.
    // Доля t — проекция точки клика на отрезок A→B в плане (XY).
    //
    // ИСПРАВЛЕНО. Раньше при отсутствии активного горизонта подставлялся z из
    // клика, а холст в 2D-режиме передаёт туда zLevel — по умолчанию 0. В итоге
    // на схеме с горизонтами (например, ствол с отметками 0 и −500) новый узел
    // прыгал на отметку 0, ломая геометрию: угол наклона и длина сегментов
    // пересчитывались по ложной высоте, а вместе с ними тепловая депрессия.
    const dxAB = (toN.x ?? 0) - (fromN.x ?? 0);
    const dyAB = (toN.y ?? 0) - (fromN.y ?? 0);
    const lenSq = dxAB * dxAB + dyAB * dyAB;
    // Вертикальная выработка (ствол, гезенк): в плане её концы совпадают, доля
    // по XY не определяется — берём её по отметке, иначе ствол всегда резался
    // ровно посередине, куда бы ни кликнул пользователь.
    const dzAB = (toN.z ?? 0) - (fromN.z ?? 0);
    const tRaw = lenSq > 1e-9
      ? (((x - (fromN.x ?? 0)) * dxAB + (y - (fromN.y ?? 0)) * dyAB) / lenSq)
      : (Math.abs(dzAB) > 1e-9 ? ((z - (fromN.z ?? 0)) / dzAB) : 0.5);
    const t = Math.min(1, Math.max(0, tRaw));
    const zOnBranch = (fromN.z ?? 0) + ((toN.z ?? 0) - (fromN.z ?? 0)) * t;

    // Горизонт задаёт отметку только если ветвь действительно на нём лежит
    // (оба конца на этой высоте) — иначе горизонт относится к другому уровню,
    // и навязывать его отметку узлу наклонной выработки нельзя.
    const onHorizon = activeHorizon != null
      && Math.abs((fromN.z ?? 0) - activeHorizon.z) < 0.5
      && Math.abs((toN.z ?? 0) - activeHorizon.z) < 0.5;
    const finalZ = onHorizon ? activeHorizon!.z : zOnBranch;
    // Привязку к горизонту оба сегмента наследуют от родительской ветви через
    // `...b` ниже — переназначать её по активному горизонту нельзя: разрезая
    // ветвь чужого горизонта, мы бы молча перевесили её на текущий.
    // ── Координаты X,Y нового узла ──────────────────────────────────────────
    // ИСПРАВЛЕНО. Раньше сюда подставлялась СЫРАЯ точка клика (x, y). Но курсор
    // почти никогда не попадает точно на ось выработки — попадание засчитывается
    // с допуском в несколько пикселей, — и узел садился рядом с ветвью, а не на
    // неё: выработка изламывалась «уголком» в месте разреза. В изометрии и 3D
    // было хуже: обратная проекция клика идёт на рабочую плоскость, и если ветвь
    // на ней не лежит, узел уезжал далеко от схемы, растягивая обе половины.
    //
    // Узел ставится НА ветвь, поэтому X,Y обязаны лежать на отрезке A→B:
    // берём ту же долю t, что и для отметки z (проекция клика на отрезок).
    // Ветвь остаётся прямой, суммарная длина половин равна исходной длине.
    const splitX = Math.round((fromN.x ?? 0) + dxAB * t);
    const splitY = Math.round((fromN.y ?? 0) + dyAB * t);
    void x; void y;
    const newNode = makeNode(newNodeId, {
      x: splitX, y: splitY, z: finalZ,
      name: "",
      number: num,
    });

    // Создаём вторую половину A→N + N→B; сохраняем все параметры.
    // Расход распределяем 50/50 (солвер пересчитает).
    const newBranchId = nextBranchId([...branchesRaw, { ...old, id: "@tmp" }]);
    const halfFlow = old.flow / 2;

    setNodes((p) => [...p, newNode]);
    setBranches((p) => p.flatMap((b) => {
      if (b.id !== branchId) return [b];
      const segA: TopoBranch = { ...b, toId: newNodeId, manualLength: false, flow: halfFlow };
      const segB: TopoBranch = makeBranch(newBranchId, newNodeId, old.toId, {
        ...b,
        id: newBranchId,
        fromId: newNodeId,
        toId: old.toId,
        manualLength: false,
        flow: halfFlow,
        // Вентилятор оставляем только на первой половине, чтобы не задвоить напор.
        hasFan: false, fanMode: "constant", fanPressure: 0, fanName: "",
        fanCurveId: "", fanEfficiency: 0, fanShaftPower: 0,
      });
      // Подавим неиспользуемые переменные
      void fromN; void toN;
      return [segA, segB];
    }));
    setSelectedNodeId(newNodeId);
    setSelectedBranchId(null);
    return newNodeId;
  };

  // Перемещение узла мышью. saveHistory=false: снимок для undo уже сделан
  // ОДИН раз в момент захвата узла (onNodeDragStart). Раньше история писалась
  // на КАЖДОЕ движение мыши — копирование всех узлов/ветвей/символов десятки
  // раз в секунду тормозило большие схемы, а стек отмены (50 шагов) целиком
  // забивался одним перетаскиванием, и откатить прошлые действия было нельзя.
  //
  // РЕЖИМ ПРАВКИ КООРДИНАТ (F2). По умолчанию перетаскивание меняет только
  // ОТРИСОВКУ: схему нужно раздвигать, чтобы подписи не наезжали, и это не
  // должно искажать расчёт. Маркшейдерские координаты при этом стоят на месте,
  // длины ветвей и сопротивления не меняются.
  //
  // В режиме F2 перетаскивание правит НАСТОЯЩИЕ координаты: узел переносится
  // вместе с эталоном, длины ветвей пересчитываются. Это осознанное действие
  // маркшейдера, поэтому режим включается явно и заметен на экране.
  const handleNodeMove = (id: string, x: number, y: number, z?: number) => {
    const patch: Partial<TopoNode> = z !== undefined ? { x, y, z } : { x, y };
    if (surveyEditMode) {
      patch.surveyX = x;
      patch.surveyY = y;
      if (z !== undefined) patch.surveyZ = z;
    }
    updateNode(id, patch, false);
  };

  /** Возвращает узел на его маркшейдерское место. */
  const resetNodeToSurvey = (id: string) => {
    const n = nodes.find(v => v.id === id);
    if (!n) return;
    const s = surveyXYZ(n);
    pushHistory();
    updateNode(id, { x: s.x, y: s.y, z: s.z }, false);
  };

  /** Возвращает на маркшейдерские места всю схему. */
  const resetAllNodesToSurvey = () => {
    pushHistory();
    setNodes(prev => prev.map(n => {
      const s = surveyXYZ(n);
      return { ...n, x: s.x, y: s.y, z: s.z };
    }));
  };

  /**
   * Запрос возврата схемы к маркшейдерским координатам (клавиша F5).
   * Показывает окно подтверждения — операция затрагивает всю схему сразу.
   * Если ничего не сдвинуто, возвращать нечего: окно не открываем.
   */
  const requestResetToSurvey = () => {
    if (movedNodeCount === 0) return;
    setResetSurveyDialog(true);
  };

  /**
   * Фиксирует текущее положение узлов как маркшейдерский эталон. Нужно, когда
   * схему выверили и хотят считать её новое состояние правильным.
   */
  const fixCurrentAsSurvey = () => {
    pushHistory();
    setNodes(prev => prev.map(n => ({ ...n, surveyX: n.x, surveyY: n.y, surveyZ: n.z })));
  };

  // ─── Перемещение схемы (вкладка «Схема») ───────────────────────────
  const [showMoveSchema, setShowMoveSchema] = useState(false);

  /**
   * Узлы, попадающие под выбранную область перемещения.
   * «Видимые» — те, что реально отрисованы: не скрытые вручную и не лежащие
   * целиком на скрытых горизонтах.
   */
  const moveTargetIds = (area: MoveArea): Set<string> => {
    if (area === "selected") return new Set(selectedNodeIds);
    if (area === "all") return new Set(nodes.map(n => n.id));
    const hiddenHorizons = new Set(horizons.filter(h => !h.visible).map(h => h.id));
    const visibleIds = new Set<string>();
    for (const n of nodes) {
      if (n.visible === false) continue;
      // Узел виден, если хотя бы одна его ветвь на видимом горизонте
      // (или у него вообще нет ветвей — тогда он просто виден).
      const adj = branchesRaw.filter(b => b.fromId === n.id || b.toId === n.id);
      const allHidden = adj.length > 0 && adj.every(b =>
        b.horizonId ? hiddenHorizons.has(b.horizonId) : false);
      if (!allHidden) visibleIds.add(n.id);
    }
    return visibleIds;
  };

  /**
   * Сдвигает указанные узлы по осям.
   *
   * Двигаем не только координаты отрисовки, но и маркшейдерские: иначе
   * программа посчитает, что узлы «отодвинули от их настоящего положения»,
   * пометит их как смещённые, а длины выработок (они считаются по
   * маркшейдерским координатам) разъедутся со схемой. Параллельный перенос
   * расстояний не меняет, поэтому сопротивление сети и результаты расчёта
   * остаются прежними.
   */
  const shiftNodes = (ids: Set<string>, dx: number, dy: number, dz: number) => {
    setNodes(prev => prev.map(n => {
      if (!ids.has(n.id)) return n;
      const s = surveyXYZ(n);
      return {
        ...n,
        x: n.x + dx, y: n.y + dy, z: n.z + dz,
        surveyX: s.x + dx, surveyY: s.y + dy, surveyZ: s.z + dz,
      };
    }));
  };

  /**
   * Перемещение ОДНОГО горизонта — вкладка «Горизонты», строка горизонта.
   *
   * Нужно, когда горизонт импортировали отдельным файлом и его надо
   * состыковать с уже построенной сетью: чертежи разных горизонтов часто
   * ведутся в своих координатах и не совпадают друг с другом.
   *
   * Узел к горизонту напрямую не привязан — привязаны ветви. Поэтому берём
   * узлы ветвей этого горизонта, но ПРОПУСКАЕМ те, что связаны и с другими
   * горизонтами: это точки стыковки (стволы, сбойки). Если их сдвинуть,
   * соединение с остальной схемой порвётся, а длины стволов изменятся.
   */
  const moveHorizon = (horizonId: string, dx: number, dy: number, dz: number) => {
    if (dx === 0 && dy === 0 && dz === 0) return;

    const own = new Set<string>();
    const foreign = new Set<string>();
    for (const b of branchesRaw) {
      const target = b.horizonId === horizonId ? own : foreign;
      target.add(b.fromId);
      target.add(b.toId);
    }
    const ids = new Set([...own].filter(id => !foreign.has(id)));
    const shared = [...own].filter(id => foreign.has(id)).length;

    if (ids.size === 0) {
      addLog("warn", shared > 0
        ? `Горизонт не перемещён: все его узлы связаны с другими горизонтами`
        : `Горизонт не перемещён: на нём нет выработок`);
      return;
    }

    pushHistory();
    shiftNodes(ids, dx, dy, dz);

    const parts = [
      dx !== 0 ? `X ${dx > 0 ? "+" : ""}${dx}` : "",
      dy !== 0 ? `Y ${dy > 0 ? "+" : ""}${dy}` : "",
      dz !== 0 ? `Z ${dz > 0 ? "+" : ""}${dz}` : "",
    ].filter(Boolean).join(", ");
    const name = horizons.find(h => h.id === horizonId)?.name ?? "Горизонт";
    addLog("ok", `«${name}» перемещён: ${parts} м · узлов: ${ids.size}` +
      (shared > 0 ? ` · узлов стыковки сохранено: ${shared}` : ""));
  };

  /** Перемещение всей схемы — вкладка «Схема» */
  const handleMoveSchema = ({ area, dx, dy, dz }: MoveSchemaOptions) => {
    const ids = moveTargetIds(area);
    if (ids.size === 0 || (dx === 0 && dy === 0 && dz === 0)) {
      setShowMoveSchema(false);
      return;
    }
    pushHistory();
    shiftNodes(ids, dx, dy, dz);

    // Подписи и обозначения двигаем только при переносе всей схемы: они не
    // привязаны к узлам, и при частичном сдвиге непонятно, какие из них
    // относятся к перемещаемому участку — лучше оставить на месте.
    if (area === "all") {
      setTextBlocks(prev => prev.map(t => ({ ...t, x: t.x + dx, y: t.y + dy })));
      // У символов, привязанных к ветви, координаты пересчитываются от неё
      // самой — трогаем только «свободные», стоящие сами по себе.
      setSchemaSymbols(prev => prev.map(s =>
        s.branchId ? s : { ...s, x: s.x + dx, y: s.y + dy }));
    }

    const parts = [
      dx !== 0 ? `X ${dx > 0 ? "+" : ""}${dx}` : "",
      dy !== 0 ? `Y ${dy > 0 ? "+" : ""}${dy}` : "",
      dz !== 0 ? `Z ${dz > 0 ? "+" : ""}${dz}` : "",
    ].filter(Boolean).join(", ");
    addLog("ok", `Схема перемещена: ${parts} м · узлов: ${ids.size}`);
    setShowMoveSchema(false);
  };

  // ─── Наклонный съезд ────────────────────────────────────────────────
  // Трасса рисуется по подложке на плане (X и Y), а высотные отметки узлов
  // раздаёт расчёт: вручную по десяткам узлов их не проставить, и главное —
  // на глаз не проверить, что уклон нигде не вышел за предел для транспорта.
  const [showRampDialog, setShowRampDialog] = useState(false);

  // Цвета трассы по уклону считаются НИЖЕ — там, где уже объявлено выделение
  // ветвей (selectedBranchIds). См. rampSlopeColors.

  /**
   * Записать рассчитанные отметки в узлы трассы.
   *
   * Пишем И в отображаемые координаты (z), И в маркшейдерские (surveyZ):
   * длина выработки и угол считаются по маркшейдерским, и если обновить
   * только картинку, сопротивление сети осталось бы от плоской трассы.
   */
  const applyRampZ = (nodeZ: { id: string; z: number }[]) => {
    if (nodeZ.length === 0) return;
    pushHistory();
    const zById = new Map(nodeZ.map((n) => [n.id, n.z]));
    setNodes((prev) => prev.map((n) => {
      const z = zById.get(n.id);
      return z === undefined ? n : { ...n, z, surveyZ: z };
    }));
    const zs = nodeZ.map((n) => n.z);
    addLog("ok",
      `Наклонный съезд построен: узлов ${nodeZ.length}, `
      + `отметки от ${Math.max(...zs).toFixed(1)} до ${Math.min(...zs).toFixed(1)} м`);
  };

  /**
   * Создать спиральный съезд из готовых точек: узлы + соединяющие их выработки.
   *
   * Точки приходят уже рассчитанными (lib/rampBuilder), здесь только строится
   * геометрия схемы. Новые выработки наследуют сечение по умолчанию, как при
   * обычном построении инструментом «Ветвь».
   */
  const buildSpiralRamp = (points: { x: number; y: number; z: number }[]) => {
    if (points.length < 2) return;
    pushHistory();
    const newNodes: TopoNode[] = [];
    const newBranches: TopoBranch[] = [];
    const allNodes = [...nodes];
    const allBranches = [...branchesRaw];

    for (const p of points) {
      const id = nextNodeId(allNodes);
      const n = makeNode(id, {
        x: p.x, y: p.y, z: p.z,
        surveyX: p.x, surveyY: p.y, surveyZ: p.z,
        name: "", number: id,
      });
      allNodes.push(n);
      newNodes.push(n);
    }
    for (let k = 0; k < newNodes.length - 1; k++) {
      const id = nextBranchId(allBranches);
      const b = makeBranch(id, newNodes[k].id, newNodes[k + 1].id, {
        type: "Наклонный съезд",
        horizonId: "",
      });
      allBranches.push(b);
      newBranches.push(b);
    }

    setNodes((prev) => [...prev, ...newNodes]);
    setBranches((prev) => [...prev, ...newBranches]);
    setIsDirty(true);
    addLog("ok",
      `Спиральный съезд построен: узлов ${newNodes.length}, `
      + `выработок ${newBranches.length}, отметки `
      + `${points[0].z.toFixed(1)} → ${points[points.length - 1].z.toFixed(1)} м`);
  };

  // ─── Результат расчёта пожара ───────────────────────────────────────
  const [fireResult, setFireResult] = useState<FireCalculationResult | null>(null);
  const [fireCalcDone, setFireCalcDone] = useState(false);
  // Прогресс расчёта пожара (0..100) для индикатора на кнопке; null — не идёт.
  const [fireCalcProgress, setFireCalcProgress] = useState<number | null>(null);
  // ─── Горноспасатели ────────────────────────────────────────────────
  const [rescuePickMode, setRescuePickMode] = useState<import("@/components/cad/RescuePanel").RescuePickMode>(null);
  const [rescueStartNodeId, setRescueStartNodeId] = useState("");
  const [rescueTargetNodeId, setRescueTargetNodeId] = useState("");
  const rescuePickHandlerRef = React.useRef<((nodeId: string) => void) | null>(null);
  const [rescuePathBranchIds, setRescuePathBranchIds] = useState<Set<string>>(new Set());
  const [rescuePathBranchDirs, setRescuePathBranchDirs] = useState<Map<string, boolean>>(new Map());
  const [rescuePathNodeIds, setRescuePathNodeIds] = useState<Set<string>>(new Set());
  const [rescueWaypointIds, setRescueWaypointIds] = useState<string[]>([]);
  // Альтернативные варианты маршрута ВГСЧ: branchId → цвет варианта.
  // Рисуются бледными линиями-объездами рядом с выбранным маршрутом.
  const [rescueAltRouteColors, setRescueAltRouteColors] = useState<Map<string, string>>(new Map());
  // Клик по линии варианта на схеме — выбирает этот вариант
  const rescueBranchPickHandlerRef = React.useRef<((branchId: string) => void) | null>(null);
  // Буквенные метки узлов маршрута горноспасателей: А — начальный (база ВГСЧ),
  // Б — целевой (место аварии), В — промежуточные узлы. Рисуются на схеме поверх узлов.
  const rescueNodeLetters = React.useMemo(() => {
    const m = new Map<string, string>();
    if (activeSide !== "rescue") return m;
    rescueWaypointIds.forEach(id => { if (id) m.set(id, "В"); });
    if (rescueStartNodeId)  m.set(rescueStartNodeId, "А");
    if (rescueTargetNodeId) m.set(rescueTargetNodeId, "Б");
    return m;
  }, [activeSide, rescueStartNodeId, rescueTargetNodeId, rescueWaypointIds]);
  // ─── Горнорабочий ──────────────────────────────────────────────────
  const [workerPickMode, setWorkerPickMode] = useState<WorkerPickMode>(null);
  const [workerStartNodeId, setWorkerStartNodeId] = useState("");
  const [workerTargetNodeId, setWorkerTargetNodeId] = useState("");
  const workerPickHandlerRef = React.useRef<((nodeId: string) => void) | null>(null);
  const [workerPathBranchIds, setWorkerPathBranchIds] = useState<Set<string>>(new Set());
  const [workerPathBranchDirs, setWorkerPathBranchDirs] = useState<Map<string, boolean>>(new Map());
  const [workerPathNodeIds, setWorkerPathNodeIds] = useState<Set<string>>(new Set());
  const [workerWaypointIds, setWorkerWaypointIds] = useState<string[]>([]);
  // Буквенные метки узлов горнорабочего: А — начальный, Б — целевой, В — промежуточные
  const workerNodeLetters = React.useMemo(() => {
    const m = new Map<string, string>();
    if (activeSide !== "workerPath") return m;
    workerWaypointIds.forEach(id => { if (id) m.set(id, "В"); });
    if (workerStartNodeId)  m.set(workerStartNodeId, "А");
    if (workerTargetNodeId) m.set(workerTargetNodeId, "Б");
    return m;
  }, [activeSide, workerStartNodeId, workerTargetNodeId, workerWaypointIds]);
  // ─── Вентрубопровод ────────────────────────────────────────────────
  const [showVentPipeDialog, setShowVentPipeDialog] = useState(false);
  const [ventPipeBranchIds, setVentPipeBranchIds] = useState<string[]>([]);
  // ─── Групповое редактирование ветвей ───────────────────────────────
  const [showMultiBranchProps, setShowMultiBranchProps] = useState(false);
  // ─── Результат расчёта взрыва ──────────────────────────────────────
  const [explosionResult, setExplosionResult] = useState<ExplosionResult | null>(null);
  /**
   * Результат по КАЖДОМУ очагу (id ветви-очага → расчёт). При нескольких
   * очагах давление в точке считается по тому очагу, от которого волна
   * пришла первой, а не по одному произвольному.
   */
  const [explosionResultByBranch, setExplosionResultByBranch] = useState<Map<string, ExplosionResult>>(new Map());
  const [explosionCalcDone, setExplosionCalcDone] = useState(false);
  /**
   * Перемычки из последнего полного расчёта взрыва и что с ними стало.
   * Окраска схемы берёт решения ОТСЮДА, а не пересчитывает их по-своему:
   * иначе схема могла бы красить выработку за перемычкой, которую расчёт
   * признал устоявшей.
   */
  const [explosionBarriers, setExplosionBarriers] = useState<{
    byBranch: Map<string, BlastBarrier[]>;
    hits: Map<string, BarrierHit>;
  } | null>(null);
  // Предварительный расчёт очага — считается на месте, как только на ветви
  // выставлены параметры взрыва. Наполняется ниже (см. explosionPreview).
  const [explosionPreview, setExplosionPreview] = useState<{
    /** Давление набегающей волны в данной ветви, кПа. */
    pressureAt: (b: TopoBranch) => number;
    /** Полный результат — им же подсвечиваются зоны на схеме до полного расчёта. */
    res: ExplosionResult;
    /** Ветвь-очаг. */
    srcId: string;
    /** Радиусы зон поражения от очага. */
    zones: { lethal: number; heavy: number; medium: number; light: number };
  } | null>(null);
  const [showExplosionZones, setShowExplosionZones] = useState(false);
  /**
   * Результат взрыва, по которому сейчас строится картинка.
   *
   * После полного расчёта — он; до него — предварительная оценка очага. Одна
   * переменная на всё: легенда, шкала волны и окраска схемы обязаны показывать
   * ОДНО И ТО ЖЕ, иначе на шкале будут одни радиусы, а на схеме другие.
   */
  const activeExplosionRes = explosionCalcDone
    ? explosionResult
    : (explosionPreview?.res ?? null);
  // Текущее расстояние фронта волны на шкале (метры)
  const [blastWaveRadius, setBlastWaveRadius] = useState(0);
  // Максимум шкалы (м) — радиус безопасной зоны
  const [blastMaxRadius, setBlastMaxRadius] = useState(500);
  const [blastRadiusStep, setBlastRadiusStep] = useState(10);
  // Анимация распространения волны
  const [blastAnimating, setBlastAnimating] = useState(false);
  const blastAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showSmoke, setShowSmoke] = useState(false);
  // Текущий момент времени на шкале задымления (минуты)
  const [smokeTimeMinutes, setSmokeTimeMinutes] = useState(0);
  // Максимум шкалы (мин) и шаг — задаётся пользователем
  const [smokeMaxTime, setSmokeMaxTime] = useState(60);
  const [smokeTimeStep, setSmokeTimeStep] = useState(1);
  // Порог видимости задымления (м): дым распространяется, пока видимость в дыму
  // ниже порога; дальше — чистый воздух. Настраивается под нормативы.
  const [smokeVisThreshold, setSmokeVisThreshold] = useState(50);
  // Метод расчёта тепловой депрессии пожара: "aerosети" (физика теплового
  // столба) или "normative" (нормативная методика, формулы 4.5–4.13).
  const [thermalDepMethod, setThermalDepMethodState] = useState<ThermalDepMethod>(getThermalDepMethod());
  const changeThermalDepMethod = (m: ThermalDepMethod) => {
    setThermalDepMethod(m);
    setThermalDepMethodState(m);
  };
  // Данные для увеличенного просмотра h–Q диаграммы (null — окно закрыто)
  const [hqDialogData, setHqDialogData] = useState<(HQDiagramData & { branchName?: string }) | null>(null);
  // Параметры нормативной методики: t — время с начала пожара (мин, ф. 4.8).
  //
  // x (расстояние очаг→устье, ф. 4.13) здесь БОЛЬШЕ НЕ ХРАНИТСЯ: одно число на
  // всю схему не может описывать положение очага в конкретной ветви. Теперь оно
  // считается из fireT (ползунок «Очаг в ветви») и длины выработки.
  const [normFireTime, setNormFireTimeState] = useState<number>(getNormativeFireTime());
  const changeNormFireTime = (v: number) => {
    const t = Math.min(NORMATIVE_TIME_MAX_MIN, Math.max(1, v || 1));
    setNormativeFireTime(t); setNormFireTimeState(t);
  };
  // Анимация воспроизведения шкалы
  const [smokeAnimating, setSmokeAnimating] = useState(false);
  const smokeAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Результат расчёта сети ─────────────────────────────────────────
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  // Расходы прямого режима для проверки норматива реверса (k_rev >= 0.6)
  const [normalFlows, setNormalFlows] = useState<Record<string, number>>({});
  const [vcSolving, setVcSolving] = useState(false);
  // Индикатор хода расчёта сети (0..100). Расчёт — один запрос к серверу, точный
  // процент недоступен, поэтому шкала «ползёт» к ~90% пока ждём ответ, затем 100%.
  const [solveProgress, setSolveProgress] = useState<number | null>(null);
  const solveProgressTimer = useRef<number | null>(null);
  const fireProgressTimer = useRef<number | null>(null);
  const [vcError, setVcError] = useState<string | null>(null);
  // Метод расчёта: cross = Кросс, mkr = МКР
  const [calcMode, setCalcMode] = useState<"cross" | "mkr">("cross");
  // Параметры расчёта
  const [solverTolerance, setSolverTolerance] = useState(0.001);
  const [solverMaxIter, setSolverMaxIter] = useState(5000);
  const [solverAlpha, setSolverAlpha] = useState(0.5);
  // Температура воздуха на поверхности (для расчёта естественной тяги)
  const [surfaceTemp, setSurfaceTemp] = useState(20);
  // Сезон работы шахты. От него зависит, включены ли калориферы: в режиме
  // «зимой» калорифер греет только при heatingSeason="winter", а при переходе
  // на «лето» отключается, и подогрев из температур узлов убирается.
  const [heatingSeason, setHeatingSeason] = useState<HeatingSeason>("winter");
  // Учитывать естественную тягу (галочка как в Аэросети)
  const [useNaturalDraft, setUseNaturalDraft] = useState(true);
  // Геотермический градиент °C / 100 м глубины. По умолчанию 0 (ИЗОТЕРМИЯ) — как в
  // АэроСети: температуры узлов НЕ достраиваются автоматически, естественная тяга
  // возникает только от РЕАЛЬНО заданных разностей температур (замеры, пожар).
  // Ненулевой градиент пользователь задаёт явно, если нужен геотермический столб.
  const [geoGradient, setGeoGradient] = useState(0);
  // Средняя температура рудничного воздуха t_ср, °C (термодинамический способ
  // Комарова, норматив 7.11/9.2). ГОСТ 15°C по умолчанию. Разность surfaceTemp − t_ср
  // задаёт естественную тягу.
  const [mineAirTemp, setMineAirTemp] = useState(15);
  // ── Влажность воздуха (норматив, прил. 9, форм. 9.2) ────────────────────
  // Влияет на плотность воздуха: влажный воздух ЛЕГЧЕ сухого при той же
  // температуре. Норматив требует учитывать влажность при разности отметок
  // замерных станций более 100 м (пп. 69, 72, 99) — то есть в стволах, где
  // вес столба воздуха и формирует естественную тягу.
  const [useHumidity, setUseHumidity] = useState(false);
  const [surfaceHumidity, setSurfaceHumidity] = useState(DEFAULT_SURFACE_HUMIDITY);
  const [mineHumidity, setMineHumidity] = useState(DEFAULT_MINE_HUMIDITY);
  // Барометрическое давление на поверхности, кПа — входит в формулу 9.2.
  const [surfacePressure, setSurfacePressure] = useState(P_STD_KPA);
  const [showSolverParams, setShowSolverParams] = useState(false);
  const closeSolverParams = useCallback(() => setShowSolverParams(false), []);
  // Диалог «Устойчивость при пожаре» (Акт устойчивости)
  const [showFireStability, setShowFireStability] = useState(false);
  // Диалог «Проверка ППЗ» (пожарно-оросительный трубопровод)
  const [showWaterCheck, setShowWaterCheck] = useState(false);
  // Диалог «Зона поражения» (вывод людей при пожаре)
  const [showEvacRisk, setShowEvacRisk] = useState(false);
  // Диалог «Подбор режима» (управляющие действия при пожаре)
  const [showFireControl, setShowFireControl] = useState(false);
  // Диалог «ВДС» (воздушно-депрессионная съёмка)
  const [showVds, setShowVds] = useState(false);
  // Диалог «Взрывоопасность» (рудничная атмосфера по Приложению № 11)
  const [showExplosibility, setShowExplosibility] = useState(false);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const addLog = (level: LogEntry["level"], text: string) => {
    const ts = new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogEntries(prev => [...prev, { id: ++logIdRef.current, ts, level, text }]);
  };
  // ─── Ракурс / 3D ────────────────────────────────────────────────────
  const [viewPreset, setViewPreset] = useState<{ name: "plan" | "front" | "back" | "left" | "right" | "isoSW" | "isoSE" | "isoNW" | "isoNE"; nonce: number } | null>(null);
  const [viewInfo, setViewInfo] = useState<{ is3D: boolean; azimuth: number; elevation: number }>({ is3D: true, azimuth: 0, elevation: 0 });
  const setPreset = (name: "plan" | "front" | "back" | "left" | "right" | "isoSW" | "isoSE" | "isoNW" | "isoNE") => {
    // Вписывание в экран теперь происходит внутри TopoCanvas через fitAfterPresetRef
    setViewPreset({ name, nonce: Date.now() });
  };

  // Режим рабочей области: «Чертёж» или «Модель».
  //
  // «Чертёж» — основной и единственный режим для работы: только он векторный,
  // печатается, выгружается в SVG и допускает правку схемы. «Модель» — это
  // просмотр: объёмный облёт на WebGL, чтобы оценить взаимное положение
  // горизонтов и показать схему на защите. Редактировать в нём нельзя, поэтому
  // режим по умолчанию — «Чертёж», и переключение ничего в схеме не меняет.
  const [viewMode, setViewMode] = useState<"draft" | "model">("draft");

  // Режим отображения направления воздушного потока (по умолчанию ВЫКЛ).
  const [flowDisplay, setFlowDisplay] = useState<"off" | "flow" | "chevrons" | "both">("off");
  // Скорость анимации движения воздуха: 1 — обычная, 0.5 — вдвое медленнее.
  // На больших схемах быстрый бег стрелок мешает читать чертёж.
  const [animSpeed, setAnimSpeed] = useState<number>(1);
  // Режим цветовой заливки ветвей: none = выкл, flowQ = по расходу воздуха, horizon = по цвету горизонта
  const [colorMode, setColorMode] = useState<"none" | "flowQ" | "velocityV" | "section" | "ventsection" | "horizon">("none");
  // Настройки шкалы расхода (мин/макс, цвет)
  const [flowColorMin, setFlowColorMin] = useState(0);
  const [flowColorMax, setFlowColorMax] = useState(75);
  const [flowColorHue, setFlowColorHue] = useState<"red" | "blue" | "green">("red");
  // Шкала заливки по скорости воздуха (м/с). 15 м/с — типовой предел для выработок.
  const [velColorMin, setVelColorMin] = useState(0);
  const [velColorMax, setVelColorMax] = useState(15);
  const [velColorHue, setVelColorHue] = useState<"red" | "blue" | "green">("blue");

  // Активная рабочая плоскость для построения в 3D
  // null = автоматически по ракурсу; иначе фиксированная пользователем
  const [workPlane] = useState<{ axis: "x" | "y" | "z"; value: number } | null>(null);

  // ─── МАСШТАБ И ВПИСЫВАНИЕ ───────────────────────────────────────────
  const [viewScale, setViewScale] = useState<number>(0.4);
  const [fitToScreenNonce, setFitToScreenNonce] = useState<number>(0);
  // Пределы масштабов (как в АэроСеть)
  const [scaleSettingsOpen, setScaleSettingsOpen] = useState(false);
  const [scaleLimitsEnabled, setScaleLimitsEnabled] = useState(false);
  // Режим отрисовки схемы: ВСЕГДА Canvas (см. CANVAS_THRESHOLD = 0).
  //
  // Прежде здесь жил настраиваемый порог: до N ветвей схема рисовалась в SVG,
  // свыше — на холсте. От переключения отказались ради быстродействия: SVG
  // держит отдельный DOM-элемент на каждую выработку и подпись, и на средних
  // схемах браузер заметно проседал при панорамировании.
  //
  // Значение больше не хранится и не настраивается, а сохранённый на устройстве
  // старый порог удаляем: иначе у тех, кто уже пользовался программой, схема
  // так и осталась бы на медленном SVG.
  const canvasThreshold = CANVAS_THRESHOLD;
  useEffect(() => {
    try {
      localStorage.removeItem("vent-cad/canvas-threshold");
      localStorage.removeItem("vent-cad/canvas-threshold-migrated");
    } catch { /* ignore */ }
  }, []);

  // ─── Пороги авто-скрытия узлов при отдалении (режим Canvas) ────────────────
  // На крупных схемах отрисовка кружков и номеров для тысяч узлов тормозит
  // холст, поэтому при сильном отдалении они скрываются. Значения задаются
  // в процентах масштаба; 0 = «не скрывать никогда».
  // -1 в хранилище означает «авто» — пороги подбираются по числу узлов.
  const [nodeLodAuto, setNodeLodAuto] = useState<boolean>(() => {
    return localStorage.getItem("vent-cad/node-lod-auto") !== "0";
  });
  const [nodeLodCircle, setNodeLodCircle] = useState<number>(() => {
    const n = parseInt(localStorage.getItem("vent-cad/node-lod-circle") ?? "", 10);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 12;
  });
  const [nodeLodLabel, setNodeLodLabel] = useState<number>(() => {
    const n = parseInt(localStorage.getItem("vent-cad/node-lod-label") ?? "", 10);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 32;
  });
  useEffect(() => {
    try {
      localStorage.setItem("vent-cad/node-lod-auto", nodeLodAuto ? "1" : "0");
      localStorage.setItem("vent-cad/node-lod-circle", String(nodeLodCircle));
      localStorage.setItem("vent-cad/node-lod-label", String(nodeLodLabel));
    } catch { /* ignore */ }
  }, [nodeLodAuto, nodeLodCircle, nodeLodLabel]);
  // В режиме «авто» порогов не передаём — рендерер подбирает их по числу узлов.
  const nodeLodThresholds = useMemo(
    () => (nodeLodAuto ? undefined : { circle: nodeLodCircle / 100, label: nodeLodLabel / 100 }),
    [nodeLodAuto, nodeLodCircle, nodeLodLabel],
  );
  const [scaleTextMin, setScaleTextMin] = useState(80);
  const [scaleTextMax, setScaleTextMax] = useState(150);
  const [scaleBranchMin, setScaleBranchMin] = useState(80);
  const [scaleBranchMax, setScaleBranchMax] = useState(150);
  // Толщина ветвей по площади сечения.
  //
  // ЗАЧЕМ. Обычно все выработки на схеме одной толщины: ствол 30 м² и
  // вентсбойка 2 м² неотличимы. Из-за этого не видно фактической модели, а
  // ошибка ввода сечения (2.0 вместо 20) всплывает только на расчёте.
  // С включённой настройкой ширина линии идёт от сечения — схема сразу
  // читается как план горных работ, а промахи видно глазом.
  const [widthBySectionOn, setWidthBySectionOn] = useState(false);
  // Объёмный вид выработок: вместо линии — «труба» по реальному сечению.
  // Работает только в 3D-ракурсах и только вблизи (см. tube3d.ts): объём
  // дороже линии примерно вчетверо, поэтому на полной схеме он не включается.
  const [tube3dOn, setTube3dOn] = useState(false);
  // Пределы масштаба маркеров «Позиции ПЛА» (в % от нормального размера), как у ветвей/текста.
  const [scalePositionMin, setScalePositionMin] = useState(80);
  const [scalePositionMax, setScalePositionMax] = useState(150);
  // ГОСТ-диаметр маркера позиции ПЛА на чертеже, мм (по умолчанию 13 мм).
  const [positionGostMm, setPositionGostMm] = useState(13);
  // Масштаб перемычек в % от ширины ветви (150% = перемычка в 1.5 раза шире ветви).
  // Синхронизируется с реальной толщиной ветви на экране (учитывает масштаб XY).
  const [bulkheadScale, setBulkheadScale] = useState(150);
  // Масштаб вентиляторов в % от ширины ветви (450% по умолчанию). Как у перемычек.
  const [fanScale, setFanScale] = useState(450);

  // ─── Сравнение схем ─────────────────────────────────────────────────
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareFilter, setCompareFilter] = useState<"all" | "changed" | "added" | "removed">("all");
  const [compareSelectedId, setCompareSelectedId] = useState<string | null>(null);
  const [compareShowDialog, setCompareShowDialog] = useState(false);

  // Сигнал «центрировать камеру на узле/ветви»
  const [focusNonce, setFocusNonce] = useState<number>(0);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [focusBranchId, setFocusBranchId] = useState<string | null>(null);
  const [focusPos, setFocusPos] = useState<{ x: number; y: number; z: number } | null>(null);
  // Экранная точка фокуса — действует только для своего nonce (иначе центр холста)
  const [focusScreenReq, setFocusScreenReq] = useState<{ nonce: number; x: number; y: number } | null>(null);
  // Точка перемычки/двери на ветви (по доле t значка) — чтобы при переходе из
  // проверки схемы камера вставала ровно на сооружение, а не на середину
  // длинной выработки. Заполняется ниже, когда известны значки схемы.
  const bulkheadFocusPosRef = useRef<(branchId: string) => { x: number; y: number; z: number } | null>(() => null);
  // Подсветка перемычки, выбранной в диаграмме волны
  const [blastHighlightPos, setBlastHighlightPos] = useState<{ x: number; y: number; z: number } | null>(null);
  // Маркер «вот здесь» после перехода из панели проверки. Нужен прежде всего
  // для ветвей нулевой длины: начало и конец у них совпадают, ветвь рисуется
  // точкой, и без маркера казалось, что схема никуда не перешла.
  const [checkHighlightPos, setCheckHighlightPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const checkHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashCheckHighlight = (pos: { x: number; y: number; z: number } | null) => {
    if (checkHighlightTimer.current) clearTimeout(checkHighlightTimer.current);
    setCheckHighlightPos(pos);
    if (pos) checkHighlightTimer.current = setTimeout(() => setCheckHighlightPos(null), 3500);
  };
  // Флаг: файл был загружен — не сбрасываем вид начальным пресетом
  const initialFileLoadedRef = useRef(false);
  // При первом рендере — дефолтный вид только если файл не открывался
  useEffect(() => {
    // 600ms — достаточно для любой асинхронной загрузки файла при старте
    const t = window.setTimeout(() => {
      if (!initialFileLoadedRef.current) {
        setViewPreset({ name: "isoSW", nonce: Date.now() });
        setTimeout(() => setFitToScreenNonce(Date.now()), 200);
      }
    }, 600);
    return () => window.clearTimeout(t);
   
  }, []);

  // Восстановление сохранённого вида (azimuth + scale + offset) при открытии файла
  // Вид из файла проекта: старые файлы могут хранить не все поля.
  type SavedView = { scale?: number; offsetX?: number; offsetY?: number; azimuth?: number; elevation?: number };
  // Текущий вид холста: TopoCanvas всегда сообщает все пять полей.
  type LiveView = { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  const [savedViewToRestore, setSavedViewToRestore] = useState<SavedView | null>(null);
  // Текущий вид TopoCanvas: ref для мгновенного доступа + state для перерисовки оверлея позиций
  const savedViewStateRef = useRef<LiveView | null>(null);
  const [viewStateTick, setViewStateTick] = useState(0);
  const handleViewStateChange = useCallback((v: LiveView) => {
    savedViewStateRef.current = v;
    // Обновляем оверлей позиций ПЛА В ТОТ ЖЕ кадр, что и схему (TopoCanvas).
    // rAF-троттлинг убран: он сдвигал перерисовку выносок/маркеров на кадр
    // назад, из-за чего в SVG-режиме позиции «отставали» от схемы при зуме.
    // onViewStateChange вызывается лишь при реальном изменении вида (не чаще),
    // поэтому прямой setState здесь безопасен по производительности.
    setViewStateTick(t => t + 1);
  }, []);
  // ─── Позиции ────────────────────────────────────────────────────────────
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [positionPlaceMode, setPositionPlaceMode] = useState(false);
  // Drag маркера позиции
  const posDragRef = useRef<{ id: string; startSx: number; startSy: number; startWx: number; startWy: number } | null>(null);
  const [draggingPosId, setDraggingPosId] = useState<string | null>(null);
  // Drag конца выноски позиции
  const leaderDragRef = useRef<{ posId: string } | null>(null);
  const [draggingLeaderPosId, setDraggingLeaderPosId] = useState<string | null>(null);
  // Якорь выноски, над которым сейчас курсор (для подсветки). Ключ: posId (основная) или `${posId}:${extraId}`
  const [hoveredLeaderAnchor, setHoveredLeaderAnchor] = useState<string | null>(null);
  // Режим рисования выноски: клик на схему = установить конец выноски
  const [leaderDrawMode, setLeaderDrawMode] = useState<string | null>(null); // posId или null
  // Флаг: рисуем ДОПОЛНИТЕЛЬНУЮ (дублирующую) выноску, а не основную.
  // Основная фиксирует координаты маркера, доп. — нет.
  const [leaderExtraMode, setLeaderExtraMode] = useState(false);
  // Snap к ветви в режиме рисования выноски
  const [leaderSnapBranch, setLeaderSnapBranch] = useState<{ branchId: string; t: number; sx: number; sy: number } | null>(null);
  // Зеркало leaderSnapBranch для обработчика мыши: позволяет понять, изменилось
  // ли что-то, не читая состояние и не перерисовывая экран впустую.
  // Синхронизируется автоматически — привязку сбрасывают из десятка мест
  // (выход из режима, удаление позиции, Esc), и каждое помнить не нужно.
  const leaderSnapBranchRef = useRef<{ branchId: string; t: number; sx: number; sy: number } | null>(null);
  leaderSnapBranchRef.current = leaderSnapBranch;
  // Курсор мыши в экранных координатах для предпросмотра выноски
  const [leaderCursorScreen, setLeaderCursorScreen] = useState<{ sx: number; sy: number } | null>(null);
  // Режим привязки ветвей к позиции (F3)
  const [posBranchBindMode, setPosBranchBindMode] = useState(false);
  // ПЛА: видимость позиций на схеме
  const [showPositions, setShowPositions] = useState(true);
  // ПЛА: окраска ветвей цветом позиции (внутри/снаружи)
  const [posColorInner, setPosColorInner] = useState(false);
  const [posColorOuter, setPosColorOuter] = useState(false);
  // Dropdown ПЛА открыт/закрыт
  const [showPlaPanel, setShowPlaPanel] = useState(false);

  // Nonce для импорта DXF — когда меняется, переключаем вид + fitToScreen
  const [importNonce, setImportNonce] = useState(0);
  useEffect(() => {
    if (importNonce === 0) return;
    setViewPreset({ name: "plan", nonce: Date.now() });
    const t = window.setTimeout(() => setFitToScreenNonce(Date.now()), 150);
    return () => window.clearTimeout(t);
  }, [importNonce]);

  // ─── Синхронизация данных перемычек при изменении справочника ────────
  useEffect(() => {
    if (!mineBulkheads.length) return;
    // Обновляем ветви из справочника и сразу синхронизируем символы
    setBranches(prev => {
      const updated = prev.map(br => {
        if (!br.hasBulkhead || !br.bulkheadId) return br;
        const ref = mineBulkheads.find(b => b.id === br.bulkheadId);
        if (!ref) return br;
        return {
          ...br,
          bulkheadName: ref.name,
          bulkheadR: ref.rMkyurg,
          bulkheadAirPerm: ref.airPermeability,
          bulkheadFailurePressure: ref.failurePressure,
        };
      });
      // Синхронизируем символы сразу по актуальным (updated) ветвям
      setSchemaSymbols(prev2 => prev2.map(s => {
        if (!BULKHEAD_SYMBOL_IDS.has(s.typeId) || s.bkManualAirPerm) return s;
        // Приоритет 1: собственный bkBulkheadId символа
        if (s.bkBulkheadId) {
          const ref = mineBulkheads.find(b => b.id === s.bkBulkheadId);
          if (ref) return { ...s, bkAirPerm: ref.airPermeability ?? 0, bkBulkheadR: ref.rMkyurg ?? 0, bkFailurePressure: ref.failurePressure ?? 0 };
        }
        // Приоритет 2: bulkheadId ветви
        if (!s.branchId) return s;
        const br = updated.find(b => b.id === s.branchId);
        if (!br || !br.bulkheadId) return s;
        const ref = mineBulkheads.find(b => b.id === br.bulkheadId);
        if (!ref) return s;
        return { ...s, bkAirPerm: ref.airPermeability ?? 0, bkBulkheadR: ref.rMkyurg ?? 0, bkFailurePressure: ref.failurePressure ?? 0 };
      }));
      return updated;
    });
  }, [mineBulkheads]);

  // Синхронизация bkAirPerm/bkFailurePressure в символах при изменении данных ветвей
  useEffect(() => {
    setSchemaSymbols(prev => prev.map(s => {
      if (!BULKHEAD_SYMBOL_IDS.has(s.typeId) || !s.branchId || s.bkManualAirPerm) return s;
      const br = branches.find(b => b.id === s.branchId);
      if (!br || !br.bulkheadId) return s;
      if (s.bkAirPerm === br.bulkheadAirPerm && s.bkBulkheadR === br.bulkheadR && s.bkFailurePressure === br.bulkheadFailurePressure) return s;
      return { ...s, bkAirPerm: br.bulkheadAirPerm ?? 0, bkBulkheadR: br.bulkheadR ?? 0, bkFailurePressure: br.bulkheadFailurePressure ?? 0 };
    }));
  }, [branches]);

  // ─── ОБЩИЕ НАСТРОЙКИ ОТОБРАЖЕНИЯ ВЕТВЕЙ ─────────────────────────────
  const [branchWidth, setBranchWidth] = useState<number>(7);    // px
  const [branchBorder, setBranchBorder] = useState<number>(0.6); // px
  const [thinLines, setThinLines] = useState<boolean>(false);    // F6: всё в 1px
  const [colorByHorizon, setColorByHorizon] = useState<boolean>(false);
  const [showFlowArrows, setShowFlowArrows] = useState<boolean>(false); // включается F9
  // Доля загрязнения, с которой струя считается грязной (12 % по умолчанию).
  const [pollutionThreshold, setPollutionThreshold] = useState<number>(DEFAULT_POLLUTION_THRESHOLD);
  // Доля загрязнённого воздуха в каждой выработке — считается один раз на всю
  // схему по смешению струй в узлах, панель свойств берёт готовое значение.
  const pollutionFractions = useMemo(
    () => computePollutionFractions(branches),
    [branches],
  );

  // ─── ПАНЕЛЬ ИНФОРМАЦИИ + Z-МАСШТАБ ─────────────────────────────────
  const [infoConfig, setInfoConfig] = useState<InfoDisplayConfig>(DEFAULT_INFO_CONFIG);
  const updateInfoConfig = (patch: Partial<InfoDisplayConfig>) =>
    setInfoConfig((prev) => ({ ...prev, ...patch }));
  const [zScale, setZScale] = useState<number>(1);
  const [xyScale, setXyScale] = useState<number>(1);

  // ─── ЕДИНИЦЫ ИЗМЕРЕНИЯ ───────────────────────────────────────────
  const [unitsConfig, setUnitsConfig] = useState<UnitsConfig>(DEFAULT_UNITS_CONFIG);

  // ─── УСЛОВНЫЕ ОБОЗНАЧЕНИЯ НА СХЕМЕ ─────────────────────────────────
  // Каждый символ: тип (из справочника), мировые координаты, привязка к ветви
  const [schemaSymbols, setSchemaSymbols] = useState<SchemaSymbol[]>([]);
  useEffect(() => { symbolsRef.current = schemaSymbols; }, [schemaSymbols]);

  // ─── Синхронизация «Панели информации» → замерные станции на схеме ──
  // Как у водопровода: галочка в панели — главная. Включили — показатель
  // виден у всех станций, выключили — гаснет у всех, включая личные галочки
  // станций (иначе личная галочка держала бы подпись и выключение из панели
  // «не работало»).
  const MS_IND_KEYS = ["msIndNumber", "msIndLocation", "msIndFlow", "msIndArea", "msIndVelocity"] as const;
  const updateInfoConfigSynced = (patch: Partial<InfoDisplayConfig>) => {
    updateInfoConfig(patch);
    const msPatch: Partial<Record<(typeof MS_IND_KEYS)[number], boolean>> = {};
    let has = false;
    for (const k of MS_IND_KEYS) {
      if (k in patch) { msPatch[k] = !!patch[k]; has = true; }
    }
    if (!has) return;
    setSchemaSymbols((prev) => prev.map((s) =>
      s.typeId === "measure_station" ? { ...s, ...msPatch } : s));
  };
  // Панель показывает показатель включённым, если он включён общей галочкой
  // ИЛИ отмечен у всех станций схемы — так состояние в панели совпадает с тем,
  // что видно на схеме.
  const infoPanelConfig = useMemo<InfoDisplayConfig>(() => {
    const ms = schemaSymbols.filter((s) => s.typeId === "measure_station");
    if (ms.length === 0) return infoConfig;
    const out = { ...infoConfig };
    for (const k of MS_IND_KEYS) {
      if (!out[k] && ms.every((s) => !!s[k])) out[k] = true;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoConfig, schemaSymbols]);

  /**
   * Ветви для расчёта маршрутов горноспасателей и горнорабочего.
   *
   * Глухота перемычки определяется здесь, по справочнику рудника и значкам на
   * схеме: в bulkheadId ветви лежит id справочника («mb_…»), кода типа в нём
   * нет, и расчёт сам по нему судить не может. Непроходимы только глухие.
   */
  const routeBranches = useMemo(() => {
    const symsByBranch = new Map<string, SchemaSymbol[]>();
    for (const s of schemaSymbols) {
      if (!s.branchId || !BULKHEAD_SYMBOL_IDS.has(s.typeId)) continue;
      const arr = symsByBranch.get(s.branchId);
      if (arr) arr.push(s); else symsByBranch.set(s.branchId, [s]);
    }
    return branches.map(b => {
      if (!b.hasBulkhead) return b;
      const syms = symsByBranch.get(b.id) ?? [];
      return { ...b, bulkheadSolid: resolveBulkheadSolid(b, syms, mineBulkheads) };
    });
  }, [branches, schemaSymbols, mineBulkheads]);

  // Сопротивление перемычек по ветвям (кМюрг) — для экспорта в CSV.
  // Перемычка чаще задаётся символом на схеме (bk*) и её R сворачивается
  // в общий R ветви, а не в b.bulkheadR. Здесь считаем R перемычки отдельно
  // (та же логика, что в buildBranchPayload), чтобы выгрузить в jumpers/bulkheads.
  // Сама логика живёт в lib/bulkheadResistance.ts — той же функцией считает
  // payload для решателя и подбор режима при пожаре, поэтому панель свойств,
  // расчёт и рекомендация не могут разойтись в числах.
  const bulkheadRByBranch = useMemo(
    () => buildBulkheadRMap(branches, schemaSymbols, mineBulkheads),
    [branches, schemaSymbols, mineBulkheads],
  );

  // ОБЩЕЕ сопротивление ветви (кМюрг) = выработка + перемычка/окно + окно ГВУ.
  // Ровно та сумма, которая уходит в решатель (buildBranchPayload) и стоит в
  // строке «Общее сопротивление» свойств ветви.
  //
  // ЗАЧЕМ ОТДЕЛЬНОЙ КАРТОЙ. Поле b.resistance содержит сопротивление ТОЛЬКО
  // выработки: перемычка почти всегда задана значком на схеме, и её R живёт в
  // SchemaSymbol.bk*, а не в ветви. Воздухораспределение это учитывает, а
  // пожарные расчёты брали голое b.resistance — то есть считали ветвь с
  // закрытой дверью как пустую выработку. На порядки заниженное R искажало
  // и критическую депрессию h_кр (Прил. 5), и условия Прил. 7.
  const totalRByBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of branches) {
      const bkR = bulkheadRByBranch.get(b.id) ?? 0;
      const fanCrossingKmu = (b.hasFan && (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
        ? (b.fanCrossingR ?? 0) / 1000 : 0;
      map.set(b.id, b.resistance + bkR + fanCrossingKmu);
    }
    return map;
  }, [branches, bulkheadRByBranch]);

  // ОБЩАЯ депрессия ветви (Па) = R_общее·Q²·9,81 − H вентилятора.
  // Поле b.dP содержит депрессию ТОЛЬКО выработки (локальный пересчёт
  // recalcBranchAero не знает о перемычках-символах), поэтому для пожара и
  // устойчивости берём эту карту. Считаем по той же сумме R, что выше, —
  // иначе панель и расчёт показывали бы разные числа после правки перемычки
  // (значение сервера устаревало бы до следующего F9).
  const totalDepByBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of branches) {
      const totalR = totalRByBranch.get(b.id) ?? b.resistance;
      const Q = b.flow ?? 0;
      const fanH = b.hasFan ? (b.fanPressure ?? 0) : 0;
      map.set(b.id, totalR * Math.abs(Q) * Q * G_ACCEL - fanH);
    }
    return map;
  }, [branches, totalRByBranch]);

  // БАЗОВАЯ (дожаровая) температура узлов, °C — ровно та, которую решатель
  // присваивает непрогретым узлам (см. backend/airflow/index.py, патч узлов):
  //   • атмосферный узел      → температура поверхности;
  //   • узел с ручной T       → заданная пользователем;
  //   • обычный подземный узел→ t_ср рудника + геоградиент × глубина / 100.
  // Нужна модели распространения тепла: дым должен остывать к температуре
  // вмещающего массива, а не к температуре поверхности. Иначе весь путь дыма
  // оказывается теплее сети из-за разной точки отсчёта, и возникает фантомная
  // тяга, душащая расход в смежных выработках.
  const baseNodeTemps = useMemo(() => {
    const map: Record<string, number> = {};
    const zVals = nodes.map(n => n.z ?? 0);
    const zSurface = zVals.length > 0 ? Math.max(...zVals) : 0;
    for (const n of nodes) {
      if (n.atmosphereLink) { map[n.id] = surfaceTemp; continue; }
      // Ручная температура узла (в решателе это признак userTemp).
      if ((n.airTemp ?? 20) !== 20) { map[n.id] = n.airTemp as number; continue; }
      if (!useNaturalDraft) { map[n.id] = surfaceTemp; continue; }
      const depth = Math.max(0, zSurface - (n.z ?? 0));
      map[n.id] = mineAirTemp + geoGradient * depth / 100;
    }
    return map;
  }, [nodes, surfaceTemp, mineAirTemp, geoGradient, useNaturalDraft]);

  // ── Влажность узлов, % (норматив, прил. 9, форм. 9.2) ────────────────────
  // Устроена ТАК ЖЕ, как карта температур выше:
  //   • атмосферный узел → влажность на поверхности;
  //   • узел с заданной вручную влажностью → его значение;
  //   • обычный подземный узел → влажность рудничного воздуха.
  // Отдельной методики «распространения влажности по сети» норматив не даёт:
  // влажность там — измеряемый параметр съёмки, а не рассчитываемая величина.
  // Поэтому по выработке она линейно усредняется между её узлами (см. решатель).
  const baseNodeHumidity = useMemo(() => {
    const map: Record<string, number> = {};
    // Учёт выключен — везде 0: формула 9.2 вырождается в 9.1 (сухой воздух),
    // и результат совпадает с прежним расчётом до единой цифры.
    if (!useHumidity) {
      for (const n of nodes) map[n.id] = 0;
      return map;
    }
    for (const n of nodes) {
      if (Number.isFinite(n.airHumidity)) { map[n.id] = n.airHumidity as number; continue; }
      map[n.id] = n.atmosphereLink ? surfaceHumidity : mineHumidity;
    }
    return map;
  }, [nodes, useHumidity, surfaceHumidity, mineHumidity]);

  // Ветви с проставленными ОБЩИМИ величинами — передаются в аварийные расчёты
  // (Акт устойчивости, расчёт пожара), где и порог опрокидывания, и формулы
  // Прил. 5 / Прил. 7 должны работать с ПОЛНОЙ ветвью (вместе с перемычкой),
  // а не с одной выработкой:
  //   • dPTotal — полная депрессия, Па;
  //   • rTotal  — полное сопротивление, кМюрг.
  const branchesWithTotalDep = useMemo(
    () => branches.map(b => ({
      ...b,
      dPTotal: totalDepByBranch.get(b.id) ?? b.dPTotal,
      rTotal: totalRByBranch.get(b.id) ?? b.rTotal,
    })),
    [branches, totalDepByBranch, totalRByBranch],
  );
  // Вентсооружения по ветвям для «Отчёта ВДС» — считаем только при открытом окне.
  const vdsBulkheads = useMemo(
    () => (showVds ? buildBulkheadInfoMap(branches, schemaSymbols, mineBulkheads) : undefined),
    [showVds, branches, schemaSymbols, mineBulkheads],
  );
  // Пользовательские модели насосов (сохраняются в проекте)
  const [userPumps, setUserPumps] = useState<PumpModel[]>([]);
  // Участки рудника и нормы расхода воздуха (ФНиП № 505 п.155) — в проекте
  const [ventSections, setVentSections] = useState<VentSection[]>([]);
  const [ventNorms, setVentNorms] = useState<VentNorms>(DEFAULT_VENT_NORMS);
  // Пороги зон поражения взрывом — справочник «Аварии → Зоны поражения взрывом».
  // Ряд различается в разных документах, поэтому хранится в проекте.
  const [blastThresholds, setBlastThresholds] = useState<ExplosionThresholds>(DEFAULT_EXPLOSION_THRESHOLDS);
  // Расчёт толщины взрывоустойчивой перемычки (РБ №343, п. 26–27).
  // Смесь и условия расчёта — свойство проекта, а не отдельной перемычки:
  // на объекте применяют одну смесь, и задавать её у каждой — лишняя работа.
  const [blastMixId, setBlastMixId] = useState<string>("gypsum_fast");
  const [showBlastBulkheadCalc, setShowBlastBulkheadCalc] = useState(false);
  const [showBlastBarrierChart, setShowBlastBarrierChart] = useState(false);
  // Прочность своей смеси из паспорта, МПа. 0 — берётся справочное значение.
  const [blastMixCustomR, setBlastMixCustomR] = useState(0);
  // true — расчёт в ходе ликвидации аварии. Влияет сразу на два расчёта:
  // прочность смеси берётся суточная (п. 27), а время загазирования — не менее
  // 150 мин вместо плановых 60 (п. 11–12). Признак общий: документ либо
  // проектный (ПЛА), либо составляется по факту аварии.
  const [blastDuringEmergency, setBlastDuringEmergency] = useState(false);
  // Фактическое время загазирования, мин (п. 12). 0 — берётся минимум 150.
  const [blastGasTimeFactual, setBlastGasTimeFactual] = useState(0);
  const [showVentSections, setShowVentSections] = useState(false);
  const [showAirDemand, setShowAirDemand] = useState(false);

  // Цвета участков для заливки схемы: id ветви → цвет участка.
  // Цвет хранится в справочнике участков, поэтому карту готовим здесь.
  const ventSectionColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of ventSections) {
      for (const bid of s.branchIds) m.set(bid, s.color);
    }
    return m;
  }, [ventSections]);

  // Гидравлический расчёт водопроводной сети ППЗ (backend).
  // Объявлен здесь (а не выше вместе с waterNetwork state), т.к. использует schemaSymbols.
  //
  // ОПТИМИЗАЦИЯ ВЫЗОВОВ. Раньше эффект зависел от [nodes, branches, schemaSymbols]
  // целиком, поэтому расчёт улетал на сервер при любом действии на схеме:
  // перетащили узел, переименовали выработку, поменяли сечение под воздух.
  // Гидравлике эти правки безразличны — набегали десятки лишних вызовов в минуту.
  //
  // Теперь считаем «отпечаток» только водопроводных данных (waterInputsFingerprint)
  // и уходим на сервер, лишь когда он изменился. Плюс дебаунс увеличен до 900 мс,
  // чтобы во время ввода числа в поле не слать запрос на каждое нажатие клавиши.
  const waterFp = useMemo(
    () => waterInputsFingerprint(nodes, branches, schemaSymbols),
    [nodes, branches, schemaSymbols],
  );
  const lastWaterFpRef = useRef<string | null>(null);

  useEffect(() => {
    const hasWater = branches.some(b => b.hasWaterPipe);
    if (!hasWater) {
      lastWaterFpRef.current = null;
      setWaterNetwork({ nodeResults: new Map(), branchResults: new Map() });
      return;
    }
    // Данные водопровода не изменились → результат прежний, сервер не тревожим.
    if (lastWaterFpRef.current === waterFp) return;
    // Дебаунс 900мс — при вводе значений и перетаскивании не спамим запросами
    const tid = setTimeout(() => {
      // Отправляем только водопроводные ветви и связанные узлы — уменьшаем payload.
      // Параметры насосных станций со схемы «впечатываем» в поля ветвей общей
      // функцией withWaterPumps — той же, что использует проверка ППЗ, чтобы
      // напор насоса учитывался одинаково во всех расчётах.
      const waterBranches = withWaterPumps(branches.filter(b => b.hasWaterPipe), schemaSymbols);
      const waterNodeIds = new Set<string>();
      waterBranches.forEach(b => { waterNodeIds.add(b.fromId); waterNodeIds.add(b.toId); });
      // Также добавляем узлы с fireNodeType (резервуары и потребители)
      nodes.forEach(n => { if ((n.fireNodeType ?? "none") !== "none") waterNodeIds.add(n.id); });
      const waterNodes = nodes.filter(n => waterNodeIds.has(n.id));
      // Запоминаем отпечаток ДО запроса: пока ответ в пути, повторные правки
      // с тем же составом данных не должны порождать второй такой же запрос.
      lastWaterFpRef.current = waterFp;
      fetch(WATER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withLicense({ nodes: waterNodes, branches: waterBranches })),
      }).then(r => r.json()).then(data => {
        const nr = new Map<string, WaterNodeResult>();
        const br = new Map<string, WaterBranchResult>();
        (data.nodeResults ?? []).forEach((n: WaterNodeResult) => nr.set(n.nodeId, n));
        (data.branchResults ?? []).forEach((b: WaterBranchResult) => br.set(b.branchId, b));
        setWaterNetwork({ nodeResults: nr, branchResults: br });
      }).catch((err) => {
        // Запрос не прошёл — сбрасываем отпечаток, чтобы следующая правка
        // (или повторный вход в панель) снова попыталась посчитать.
        lastWaterFpRef.current = null;
        console.error("[water-hydraulics] fetch error:", err);
      });
    }, 900);
    return () => clearTimeout(tid);
    // Намеренно зависим ТОЛЬКО от отпечатка водопровода: nodes/branches/schemaSymbols
    // читаются внутри и всегда актуальны, но сами по себе перезапуск не вызывают.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waterFp]);

  const [symbolClipboard, setSymbolClipboard] = useState<SchemaSymbol | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [selectedSymbolIds, setSelectedSymbolIds] = useState<Set<string>>(new Set());
  // Режим «ожидания привязки»: символ из буфера ждёт клика на ветвь
  const [pendingSymbol, setPendingSymbol] = useState<SchemaSymbol | null>(null);

  const [activeSymbolTypeId, setActiveSymbolTypeId] = useState<string | null>(null);
  // ID ветви, для которой открыли панель через клик на fan-символ
  const [fanSymbolBranchId, setFanSymbolBranchId] = useState<string | null>(null);

  /**
   * ПРЕДВАРИТЕЛЬНЫЙ РАСЧЁТ ОЧАГА — сразу по введённым параметрам.
   *
   * ЗАЧЕМ. Толщину перемычки и зоны поражения подбирают перебором: меняют
   * смесь, время загазирования, массу ВВ — и хотят видеть результат сразу.
   * Раньше для этого требовалось нажать «Расчёт взрыва»: обращение к серверу,
   * обход всей сети. Для подбора это неприемлемо долго.
   *
   * Здесь тот же расчёт идёт НА МЕСТЕ и только для очага: давление в точке по
   * канальной модели от расстояния. Полный сетевой расчёт остаётся за кнопкой —
   * он ведёт волну по графу с потерями на сопряжениях и даёт более низкие,
   * более точные значения. Поэтому предварительная оценка всегда КОНСЕРВАТИВНА
   * ((завышает), и перемычка по ней не окажется тоньше потребной.
   */
  useEffect(() => {
    const src = branches.find(b => b.hasExplosion);
    if (!src) { setExplosionPreview(null); return; }

    const zoneLen = src.explosionGasZoneAuto
      ? (calcGasZone({
          kind: src.explosionGasZoneKind ?? "heading",
          time_min: gasZoneTime(blastDuringEmergency, blastGasTimeFactual),
          emission_m3min: src.explosionGasEmission
            ?? ((src.explosionGasZoneKind ?? "heading") === "preserved" ? DEFAULT_I_NEPOGASH : 0),
          area_m2: src.area ?? 0,
          seamThickness_m: src.explosionSeamThickness,
          caveStep_m: src.explosionCaveStep,
          branchLength_m: src.length,
        })?.length_m ?? (src.explosionGasZoneLength ?? 100))
      : (src.explosionGasZoneLength ?? 100);

    const res = calcExplosion({
      sourceType: src.explosionSourceType ?? "mass",
      gasId: src.explosionGasId ?? "methane",
      gasVolume_m3: src.explosionGasVolume ?? 100,
      gasZoneLength_m: zoneLen,
      gasInitialPressure_kPa: src.explosionGasP0 ?? 0,
      gasConcentration: src.explosionGasConcentration
        ?? (GAS_TYPES.find(g => g.id === (src.explosionGasId ?? "methane"))?.stoichConc ?? 9.5),
      explosiveId: src.explosionExplosiveId ?? "ammonit",
      explosiveMass_kg: src.explosionExplosiveMass ?? 100,
      excavationArea_m2: src.area ?? 12,
      excavationLength_m: src.length ?? 100,
      ambientPressure_kPa: 101.3,
      considerWalls: src.explosionConsiderWalls ?? true,
      zParticipation: src.explosionZ ?? 0.5,
      ...vgschParamsOf(src),
      thresholds: blastThresholds,
    });
    if (res.noExplosion) { setExplosionPreview(null); return; }

    // Расстояние от очага до середины ветви — по координатам узлов. Это прямая
    // линия, а не путь по выработкам: для предварительной оценки её достаточно,
    // и она заведомо не длиннее реального пути, то есть давление не занижает.
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const midOf = (b: TopoBranch) => {
      const f = nodeById.get(b.fromId), t = nodeById.get(b.toId);
      if (!f || !t) return null;
      return { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2, z: (f.z + t.z) / 2 };
    };
    const srcMid = midOf(src);

    const zoneOf = (level: "lethal" | "heavy" | "medium" | "light") =>
      res.zones.find(z => z.hazardLevel === level)?.radius_m ?? 0;

    setExplosionPreview({
      pressureAt: (b: TopoBranch) => {
        const m = midOf(b), s = srcMid;
        if (!m || !s) return 0;
        const d = Math.sqrt((m.x - s.x) ** 2 + (m.y - s.y) ** 2 + (m.z - s.z) ** 2);
        return res.pressureAtDistance(d);
      },
      res,
      srcId: src.id,
      zones: {
        lethal: zoneOf("lethal"), heavy: zoneOf("heavy"),
        medium: zoneOf("medium"), light: zoneOf("light"),
      },
    });
  }, [branches, nodes, blastThresholds, blastDuringEmergency, blastGasTimeFactual]);

  // Если активна вкладка "fan", но у ветви нет вентилятора — сбросить на "topology".
  // Исключение: вкладку открыли кликом по УО вентилятора на этой же ветви —
  // тогда оставляем параметры вентилятора открытыми.
  useEffect(() => {
    if (fanSymbolBranchId && selectedBranch && fanSymbolBranchId === selectedBranch.id) return;
    if (activeSide === "fan" && selectedBranch && !selectedBranch.hasFan) {
      setActiveSide("topology");
    }
  }, [selectedBranchId, selectedBranch?.hasFan, fanSymbolBranchId]);

  // Диалог ввода числа людей при размещении отделения
  // t — доля длины ветви (точка клика). Храним в диалоге, чтобы отделение
  // встало туда, куда указали курсором, а не в середину ветви.
  const [squadDialog, setSquadDialog] = useState<{ typeId: string; x: number; y: number; branchId: string | null; t?: number } | null>(null);
  const [squadCount, setSquadCount] = useState<string>("5");

  const SQUAD_TYPES = ["squad_moving", "squad_moving_left", "squad_working"];

  const addSymbol = (typeId: string, x: number, y: number, branchId?: string | null, label?: string, scale?: number, t?: number) => {
    const id = `SYM_${Date.now()}`;
    setSchemaSymbols(prev => [...prev, { id, typeId, x, y, branchId: branchId ?? null, label, scale, t: branchId ? (t ?? 0.5) : undefined }]);
  };
  const removeSymbol = (id: string) => setSchemaSymbols(prev => prev.filter(s => s.id !== id));

  // Создать fan-символы для всех ветвей с hasFan у которых ещё нет УО
  // ИНДЕКС ВМЕСТО ПЕРЕБОРА. Раньше на каждую ветвь с вентилятором шёл полный
  // проход по всем существующим символам и по всем уже созданным — то есть
  // квадрат от размера схемы. При открытии большого проекта это были миллионы
  // лишних сравнений в главном потоке, прямо перед первой отрисовкой.
  const ensureFanSymbols = (branches: typeof branchesRaw, existingSymbols: SchemaSymbol[]) => {
    const branchesWithFanSymbol = new Set<string>();
    for (const s of existingSymbols) {
      if (s.typeId === "fan" && s.branchId) branchesWithFanSymbol.add(s.branchId);
    }
    const newSymbols: SchemaSymbol[] = [];
    branches.forEach(b => {
      if (!b.hasFan) return;
      if (branchesWithFanSymbol.has(b.id)) return;
      branchesWithFanSymbol.add(b.id);   // и от дублей внутри одного прохода
      newSymbols.push({ id: `SYM_FAN_${b.id}`, typeId: "fan", x: 0, y: 0, branchId: b.id, t: 0.5 });
    });
    return newSymbols;
  };

  // ── Значок техники под очагом пожара ─────────────────────────────────────
  // Если в выработке очаг пожара и горит «Техника», под очагом ставится УО
  // «Самоходное двигательное оборудование» (heat_selfprop): на схеме видно,
  // ЧТО горит. Значок обычный — его можно двигать вдоль ветви и удалить.
  // Удалённый значок больше не возвращается (fireVehicleSymbolOff), пока
  // очаг не убран; сменили горючее на другое — значок техники убирается.
  //
  // Эффект, а не код в местах установки: горючее меняется в свойствах очага,
  // очаг ставится с ленты, из панели, открывается из файла — одно место вместо
  // пяти.
  useEffect(() => {
    const vehBranches = new Map<string, TopoBranch>();
    for (const b of branchesRaw) {
      if (b.hasFire && (b.fireCombustible ?? "coal") === "vehicle" && !b.fireVehicleSymbolOff) vehBranches.set(b.id, b);
    }
    const autoIds = new Set(schemaSymbols
      .filter(s => s.typeId === "heat_selfprop" && s.id.startsWith("SYM_FIREVEH_"))
      .map(s => s.id));
    const want = new Set([...vehBranches.keys()].map(id => `SYM_FIREVEH_${id}`));
    const toAdd = [...vehBranches.values()].filter(b => !autoIds.has(`SYM_FIREVEH_${b.id}`));
    const toRemove = [...autoIds].filter(id => !want.has(id));
    if (toAdd.length === 0 && toRemove.length === 0) return;
    setSchemaSymbols(prev => {
      const drop = new Set(toRemove);
      const next = prev.filter(s => !drop.has(s.id));
      for (const b of toAdd) {
        if (next.some(s => s.id === `SYM_FIREVEH_${b.id}`)) continue;
        const fireIdx = next.findIndex(s => FIRE_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
        const fireSym = fireIdx >= 0 ? next[fireIdx] : undefined;
        const veh: SchemaSymbol = {
          id: `SYM_FIREVEH_${b.id}`, typeId: "heat_selfprop",
          x: fireSym?.x ?? 0, y: fireSym?.y ?? 0,
          branchId: b.id, t: fireSym?.t ?? b.fireT ?? 0.5,
        };
        // Вставляем ПЕРЕД очагом: значки рисуются по порядку, и очаг пожара
        // должен лежать поверх техники, а не под ней.
        if (fireIdx >= 0) next.splice(fireIdx, 0, veh); else next.push(veh);
      }
      return next;
    });
  }, [branchesRaw, schemaSymbols]);

  // ── Фиксация маркшейдерского эталона ──────────────────────────────────────
  // У узлов, пришедших из старых проектов и из импорта, эталона ещё нет. При
  // первом появлении такого узла его нынешние координаты записываются как
  // маркшейдерские: именно они считаются выверенными, а всё, что пользователь
  // подвинет мышью позже, будет отклонением от них.
  //
  // Делается эффектом, а не в каждом месте загрузки: путей появления узлов
  // много (открытие файла, импорт CSV/DXF/Excel/Ventsim, вставка, построение
  // вентстава), и любой пропущенный оставил бы узел без эталона.
  useEffect(() => {
    const needsBaseline = nodes.some(n => n.surveyX === undefined);
    if (!needsBaseline) return;
    setNodes(prev => prev.map(n => n.surveyX === undefined
      ? { ...n, surveyX: n.x, surveyY: n.y, surveyZ: n.z }
      : n));
  }, [nodes]);

  // Сброс «пожарного» состояния УЗЛОВ: расчётные температуры воздуха и стенок
  // возвращаются к фоновой (температура поверхности), концентрации CO/CO₂ — к
  // нулю. БАГ: раньше при «Сбросить пожар» / «Убрать очаги» чистились только
  // ветви, а в узлах оставались 596°C от прошлого расчёта — они попадали в
  // расчёт естественной тяги и искажали воздухораспределение.
  const resetNodeFireState = () => {
    setNodes(prev => prev.map(n => ({
      ...n,
      computedCO: 0,
      computedCO2: 0,
      computedAirTemp:  surfaceTemp,
      computedWallTemp: surfaceTemp,
    })));
  };

  // ── Калориферы: подогрев воздуха и разнос температур по сети ──────────────
  // Логика вынесена в useCadHeaters без изменений: тот же алгоритм обхода вниз
  // по потоку и тот же автосброс подогрева при отключении калориферов.
  const { calcHeaterTemps, heaterInfo } = useCadHeaters({
    nodes, branches, schemaSymbols, heatingSeason,
    baseNodeTemps, surfaceTemp, setNodes, addLog,
  });

  // Активировать инструмент размещения символа
  const handlePickSymbol = (typeId: string) => {
    // Ограничение: на схеме может быть только ОДИН очаг пожара и ОДНО место взрыва.
    // Иначе повторная установка приведёт к некорректному расчёту.
    if (typeId === "fire_source") {
      const existing = schemaSymbols.filter(s => FIRE_SYMBOL_IDS.has(s.typeId));
      if (existing.length > 0) {
        const ok = window.confirm(
          "На схеме уже установлен очаг пожара.\n\nМожно установить только один очаг пожара — иначе расчёт будет некорректным.\n\nУбрать установленный очаг пожара и установить новый?"
        );
        if (!ok) return;
        existing.forEach(s => {
          if (s.branchId) updateBranch(s.branchId, { hasFire: false, fireVehicleSymbolOff: false, fireComputedTemp: 0, fireComputedNatDep: 0, fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0, originalFlow: undefined });
          removeSymbol(s.id);
        });
        setFireResult(null);
        setFireCalcDone(false);
        resetNodeFireState();
      }
    } else if (typeId === "explosion_source") {
      const existing = schemaSymbols.filter(s => EXPLOSION_SYMBOL_IDS.has(s.typeId));
      if (existing.length > 0) {
        const ok = window.confirm(
          "На схеме уже установлено место взрыва.\n\nМожно установить только одно место взрыва — иначе расчёт будет некорректным.\n\nУбрать установленное место взрыва и установить новое?"
        );
        if (!ok) return;
        existing.forEach(s => {
          if (s.branchId) updateBranch(s.branchId, { hasExplosion: false, explosionComputedQtnt: 0, explosionComputedMaxP: 0, explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0, explosionComputedR_heavy: 0, explosionComputedR_medium: 0, explosionComputedR_light: 0, explosionComputedDeltaP: 0 });
          removeSymbol(s.id);
        });
        setExplosionResult(null); setExplosionResultByBranch(new Map()); setExplosionBarriers(null);
        setExplosionCalcDone(false);
      }
    }
    setActiveSymbolTypeId(typeId);
    setTool("symbol");
  };

  // Стабильные обёртки для сетки УО в ленте. Сама handlePickSymbol создаётся
  // заново на каждой перерисовке страницы — если передать её напрямую, сетка из
  // 150 значков будет пересобираться постоянно, и вынос в memo не даст ничего.
  const handlePickSymbolRef = useRef(handlePickSymbol);
  handlePickSymbolRef.current = handlePickSymbol;
  const pickSymbolStable = useCallback((id: string) => handlePickSymbolRef.current(id), []);
  const cancelSymbolStable = useCallback(() => { setTool("select"); setActiveSymbolTypeId(null); }, []);

  // ─── ПРАВАЯ ВЫДВИЖНАЯ ПАНЕЛЬ ────────────────────────────────────────
  // Ширины и открытость боковых панелей подстраиваются под размер окна
  // (см. useCadPanelsLayout): на маленьких экранах схема не сжимается в полосу.
  const {
    leftPanelWidth, rightPanelWidth,
    leftPanelOpen, setLeftPanelOpen,
    rightPanelOpen, setRightPanelOpen, rightAutoCollapsed,
    startLeftDrag, startRightDrag, resetLeftWidth, resetRightWidth,
  } = useCadPanelsLayout();
  // ─── ДИАЛОГ ПЕЧАТИ ──────────────────────────────────────────────────
  const [showPrintDialog, setShowPrintDialog] = useState<boolean>(false);
  const [printDialogOpenExport, setPrintDialogOpenExport] = useState<boolean>(false);

  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  // Захватывает схему и открывает диалог печати
  /**
   * Печать отчёта по вентиляционным ставам: доставка воздуха в забой и
   * предельная длина става по каждому тупиковому забою.
   */
  const handlePrintVentPipeReport = () => {
    if (isDemo) { setShowLicenseDialog(true); return; }
    const rows = buildVentPipeReport(branches, ventSections, ventNorms);
    if (rows.length === 0) {
      addLog("warn", "Отчёт по вентставам: в проекте нет выработок с вентиляционным ставом");
      return;
    }
    const name = suggestedFileName().replace(/\.vproj$/, "");
    printViaIframe(buildVentPipeReportHtml(rows, name));
    addLog("info", `Отчёт по вентставам сформирован: ${rows.length} шт.`);
  };

  // Окно печати строит чертёж само по данным схемы и текущему виду, снимок
  // холста ему не нужен. Раньше перед открытием делался снимок всей схемы
  // (toDataURL / сериализация SVG) — он нигде не использовался и только
  // задерживал открытие окна на больших схемах.
  const openPrintDialog = () => {
    if (isDemo) { setShowLicenseDialog(true); return; }
    setShowPrintDialog(true);
  };
  // ─── ПОИСК ПО СХЕМЕ ─────────────────────────────────────────────────
  // Состояние поиска и проверки схемы вынесено в useCadSchemaCheck без
  // изменений: те же начальные значения и та же мемоизация результата.
  const {
    searchQuery, setSearchQuery,
    searchScope, setSearchScope,
    searchObjCat, setSearchObjCat,
    checkThreshold, setCheckThreshold,
    checkTab, setCheckTab,
    checkHighRThreshold, setCheckHighRThreshold,
    checkBulkRThreshold, setCheckBulkRThreshold,
    checkSettings, setCheckSettings,
    schemaCheckResult,
  } = useCadSchemaCheck(activeSide, nodes, branches, solveResult != null, ventNorms, ventSections, schemaSymbols, mineBulkheads);

  // ─── ПРОВЕРКА СХЕМЫ ПОСЛЕ ИМПОРТА ───────────────────────────────────
  // Импорт из АэроСети, Вентиляции 2.0, Ventsim, DXF и Excel чаще всего и
  // приносит ошибки: несостыкованные примыкания, потерянные отметки, пустые
  // сечения. Сразу после импорта проверяем схему и, если что-то нашлось,
  // показываем сообщение с кнопкой перехода к проверке — иначе человек
  // узнает о проблеме только по странному результату расчёта.
  const postImportCheckRef = useRef(false);
  useEffect(() => {
    if (!postImportCheckRef.current) return;
    postImportCheckRef.current = false;
    if (branches.length === 0) return;
    // Перемычки — с сопротивлением из значков (в т.ч. ручным), как в расчёте.
    const bulkheads = buildBulkheadInfoMap(branches, schemaSymbols, mineBulkheads);
    const base = checkSchema(nodes, branches, { bulkheads });
    const topo = checkTopology(nodes, branches);
    const params = checkParams(nodes, branches, { bulkheads });
    // [вкладка, текст, число, ошибка(true) / замечание(false)] — по важности
    const found: [CheckTab, string, number, boolean][] = ([
      ["brokenBranch", "ветви на удалённых узлах", base.brokenBranches.length, true],
      ["invalidValues", "некорректные числа", params.invalidValues.length, true],
      ["components", "отдельные части сети", topo.components.length, true],
      ["tJunction", "примыкания без общего узла", topo.tJunctions.length, true],
      ["isolatedBranch", "ветви без связи с поверхностью", base.isolatedBranches.length, true],
      ["noFan", "нет работающего вентилятора", topo.noActiveFan ? 1 : 0, true],
      ["fanNoCurve", "вентиляторы без характеристики", params.fanNoCurve.length, true],
      ["zeroLen", "ветви нулевой длины", base.zeroLenBranches.length, true],
      ["zeroR", "ветви с R = 0", base.zeroRBranches.length, true],
      ["selfLoop", "замкнутые сами на себя ветви", topo.selfLoops.length, true],
      ["crossing", "пересечения без узла", topo.crossings.length, false],
      ["badArea", "неправдоподобные сечения", params.badArea.length, false],
      ["lostZ", "потерянные отметки Z", params.lostZ.length, false],
      ["zeroBulkhead", "перемычки без сопротивления", params.zeroBulkhead.length, false],
      ["dupes", "узлы в одной точке", base.dupes.length, false],
      ["dupbranch", "повторяющиеся ветви", base.dupBranches.length, false],
    ] as [CheckTab, string, number, boolean][]).filter(([, , n]) => n > 0);
    if (found.length === 0) {
      addLog("ok", "Проверка после импорта: ошибок в схеме не найдено");
      return;
    }
    const errors = found.filter(([, , , e]) => e);
    const first = (errors[0] ?? found[0])[0];
    const summary = found.slice(0, 4).map(([, t, n]) => `${t}: ${n}`).join(" · ")
      + (found.length > 4 ? ` · и ещё ${found.length - 4}` : "");
    addLog(errors.length > 0 ? "warn" : "info", `Проверка после импорта: ${found.map(([, t, n]) => `${t} — ${n}`).join("; ")}`);
    const open = () => { setActiveSide("check"); setCheckTab(first); };
    const opts = {
      description: summary,
      duration: 12000,
      action: { label: "Открыть проверку", onClick: open },
    };
    if (errors.length > 0) toast.error("После импорта в схеме есть ошибки — расчёт может быть неверным", opts);
    else toast.warning("После импорта есть замечания к схеме", opts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, branches]);
  // ─── ДИАЛОГ «АВТОНУМЕРАЦИЯ» ─────────────────────────────────────────
  const [showRenumberMenu, setShowRenumberMenu] = useState<boolean>(false);
  const [showRenumberDialog, setShowRenumberDialog] = useState<boolean>(false);
  const renumberMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showRenumberMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (renumberMenuRef.current && !renumberMenuRef.current.contains(e.target as Node)) {
        setShowRenumberMenu(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showRenumberMenu]);

  // ─── ДИАЛОГ «ВЫДЕЛЕНИЕ ПОДОБНОГО» (S+S) ─────────────────────────────
  const [showSelectSimilar, setShowSelectSimilar] = useState(false);
  const lastSPressRef = useRef<number>(0);


  // Участки, из-за которых расчёт не прошёл — приходят от расчёта сети в
  // диагностике (nodeIds/branchIds). Раньше в журнале был только номер узла,
  // и на схеме в тысячи ветвей найти его вручную было практически невозможно.
  // Теперь эти узлы и ветви попадают в проверку схемы во вкладку «Расчёт»,
  // выделяются на схеме, а вид центрируется на первом из них.
  const [solveBlockers, setSolveBlockers] = useState<{
    nodeIds: string[];
    branchIds: string[];
    message: string;
  } | null>(null);

  // ─── ДИАЛОГ ПОДТВЕРЖДЕНИЯ УДАЛЕНИЯ ВЕТВЕЙ ───────────────────────────
  // Показывает, какие УО исчезнут вместе с ветвями и какие узлы останутся
  // изолированными (они ломают расчёт воздухораспределения).
  const [deleteBranchDialog, setDeleteBranchDialog] = useState<DeleteBranchPlan | null>(null);

  // ─── ДИАЛОГ ОБЪЕДИНЕНИЯ ВЕТВЕЙ ПРИ УДАЛЕНИИ УЗЛА ────────────────────

  const [mergeNodeDialog, setMergeNodeDialog] = useState<{
    nodeId: string;
    branchA: string; // id первой ветви
    branchB: string; // id второй ветви
  } | null>(null);

  // ─── МУЛЬТИВЫБОР ВЕТВЕЙ (Ctrl+клик) ────────────────────────────────
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set());

  /**
   * Цвета выделенной трассы по фактическому уклону — подсветка на схеме, пока
   * открыт диалог наклонного съезда.
   *
   * Считается по УЖЕ построенной геометрии (плановая длина и перепад отметок),
   * поэтому показывает реальное положение дел: и до построения съезда, и после
   * него видно, какие именно участки вышли за норму. Зелёный — в пределах
   * рабочего угла, жёлтый — до предельного, красный — выше предела.
   */
  const rampSlopeColors = useMemo(() => {
    if (!showRampDialog || selectedBranchIds.size === 0) return undefined;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const map = new Map<string, string>();
    for (const id of selectedBranchIds) {
      const b = branchesRaw.find((x) => x.id === id);
      if (!b) continue;
      const a = nodeById.get(b.fromId);
      const c = nodeById.get(b.toId);
      if (!a || !c) continue;
      const p = surveyXYZ(a);
      const q = surveyXYZ(c);
      // Уклон считается по ГОРИЗОНТАЛЬНОЙ длине — она и нормируется.
      const planLen = Math.hypot(q.x - p.x, q.y - p.y);
      const dz = q.z - p.z;
      const ang = planLen < 0.001
        ? (Math.abs(dz) > 0.001 ? 90 : 0)
        : Math.abs(Math.atan(dz / planLen) * (180 / Math.PI));
      map.set(id, ang > RAMP_LIMIT_ANGLE ? "#ef4444"
        : ang > RAMP_WORK_ANGLE ? "#f59e0b" : "#22c55e");
    }
    return map.size > 0 ? map : undefined;
  }, [showRampDialog, selectedBranchIds, nodes, branchesRaw]);

  const handleBranchMultiSelect = (id: string) => {
    setSelectedBranchIds((prev) => {
      const next = new Set(prev);
      // Если Set пуст и есть одиночно выбранная ветвь — включаем её тоже (как в узлах)
      if (next.size === 0 && selectedBranchId && selectedBranchId !== id) {
        next.add(selectedBranchId);
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectedBranchId(id);
    setSelectedNodeId(null);
  };

  /**
   * Ветви, к которым относится правка в панели свойств.
   *
   * При выборе нескольких ветвей через Ctrl это ВСЕ выбранные, иначе — текущая.
   * Раньше поля панели правили только последнюю ветвь: человек выделял десяток
   * выработок, менял горизонт — и привязывалась одна. Остальные молча
   * оставались на прежнем горизонте, а расхождение обнаруживалось уже при
   * расчёте.
   */
  const branchEditTargets = (): string[] =>
    selectedBranchIds.size > 1
      ? [...selectedBranchIds]
      : selectedBranchId ? [selectedBranchId] : [];

  /** Сколько ветвей затронет правка в панели свойств (для подписи «выбрано N»). */
  const branchEditCount = selectedBranchIds.size > 1
    ? selectedBranchIds.size
    : selectedBranchId ? 1 : 0;

  /**
   * У выбранных ветвей РАЗНЫЕ горизонты?
   *
   * Тогда в списке нельзя показывать горизонт последней нажатой ветви: человек
   * решил бы, что все выбранные лежат на нём. Показываем «разные горизонты».
   */
  const multiHorizonMixed = useMemo(() => {
    if (selectedBranchIds.size <= 1) return false;
    const ids = [...selectedBranchIds];
    const first = branchesRaw.find((b) => b.id === ids[0])?.horizonId ?? "";
    return ids.some((id) => (branchesRaw.find((b) => b.id === id)?.horizonId ?? "") !== first);
  }, [selectedBranchIds, branchesRaw]);

  /** Правка поля сразу у всех выбранных ветвей (см. branchEditTargets). */
  const updateSelectedBranches = (patch: Partial<TopoBranch>) => {
    const targets = branchEditTargets();
    if (targets.length === 0) return;
    if (targets.length === 1) { updateBranch(targets[0], patch); return; }
    pushHistory();
    setBranches((prev) =>
      prev.map((b) => (targets.includes(b.id) ? { ...b, ...patch } : b)),
    );
    setIsDirty(true);
  };

  /**
   * Поля, которые ОСМЫСЛЕННО задавать сразу нескольким выработкам.
   *
   * Это характеристики, общие для группы: сечение и его форма, крепь и
   * шероховатость, режим расчёта сопротивления, тип выработки, горизонт,
   * примечание, признаки утечки и тупика.
   *
   * Всё остальное — за пределами списка и правится ПОШТУЧНО, и это намеренно:
   *   • длина, угол, координаты — у каждой выработки свои; общая правка молча
   *     исказила бы сеть, а ошибку заметили бы только на расчёте;
   *   • вентилятор (напор, характеристика, реверс, останов) — оборудование
   *     стоит в конкретной выработке, размножать его по десятку ветвей нельзя;
   *   • подписи на схеме (угол, размер), показатели, перемычка, трубы —
   *     оформление и оснащение отдельного места.
   */
  const BULK_EDITABLE_BRANCH_FIELDS = new Set<keyof TopoBranch>([
    "shape", "diameter", "rectWidth", "rectHeight", "trapTopWidth", "archHeight",
    "area", "perimeter", "manualSection",
    "resistanceMode", "alphaCoef", "surfaceId", "surface", "roughness",
    "manualR", "localXi", "vMax",
    "type", "mineTypeName", "horizonId", "comment",
    "isLeakage", "leakageCoeff", "isDead",
  ]);

  /**
   * Правка из панели свойств ветви.
   *
   * Общие характеристики уходят на ВСЕ выбранные выработки (Ctrl-выделение),
   * а индивидуальные — только на текущую. Без этого разделения человек либо
   * правит по одной сотню ветвей вручную, либо случайно затирает у них длины.
   */
  const updateBranchFromPanel = (patch: Partial<TopoBranch>) => {
    if (!selectedBranchId) return;
    const keys = Object.keys(patch) as (keyof TopoBranch)[];
    const bulk = keys.every((k) => BULK_EDITABLE_BRANCH_FIELDS.has(k));
    if (bulk && branchEditCount > 1) { updateSelectedBranches(patch); return; }
    updateBranch(selectedBranchId, patch);
  };

  // ─── Применение типа выработки к выбранным ветвям ────────────────────
  // Тип из справочника «Типы выработок» задаёт характеристики сечения и
  // аэродинамики: форму, поверхность/крепь, площадь, максимальную скорость
  // и коэффициент α. Название выработки (b.type) при этом НЕ меняется.
  // Площадь берётся из справочника как есть (manualSection=true), поэтому
  // периметр считаем по той же форме, приведя её к нужной площади — иначе
  // сопротивление считалось бы по периметру от прежнего сечения.
  const applyBranchType = (typeName: string) => {
    const t = mineTypes.find((m) => m.name === typeName);
    if (!t) return;

    // Периметр для площади S при заданной форме: у подобных фигур P ~ √S,
    // поэтому берём эталонное сечение формы и масштабируем его периметр.
    const ref = calcSection(
      t.shape === "round"
        ? { shape: "round", diameter: 1 }
        : t.shape === "rect"
          ? { shape: "rect", width: 1, height: 1 }
          : t.shape === "trap"
            ? { shape: "trap", width: 1, height: 1, topWidth: 0.8 }
            : { shape: "arch", width: 1, height: 0.5, archHeight: 0.5 },
    );
    const area = t.area > 0 ? t.area : 0;
    const perimeter = ref.area > 0 && area > 0
      ? Math.round(ref.perimeter * Math.sqrt(area / ref.area) * 100) / 100
      : 0;

    // Габариты (ширина/высота/стрела/диаметр) подгоняем под площадь типа тем
    // же коэффициентом подобия k = √(S / S_эталона). Иначе в полях остались бы
    // значения по умолчанию (7 × 5.5, h 3.5), противоречащие площади типа.
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const k = ref.area > 0 && area > 0 ? Math.sqrt(area / ref.area) : 0;
    const dims: Partial<TopoBranch> = k > 0
      ? t.shape === "round"
        ? { diameter: r2(k) }
        : t.shape === "rect"
          ? { rectWidth: r2(k), rectHeight: r2(k) }
          : t.shape === "trap"
            ? { rectWidth: r2(k), rectHeight: r2(k), trapTopWidth: r2(0.8 * k) }
            : { rectWidth: r2(k), rectHeight: r2(0.5 * k), archHeight: r2(0.5 * k) }
      : {};

    // Поверхность/крепь: в справочнике хранится названием — находим её id,
    // чтобы расчёт сопротивления получил корректный тип крепи.
    const surf = SURFACE_TYPES.find((s) => s.name === t.surface);

    const patch: Partial<TopoBranch> = {
      // Тип пишем в ОТДЕЛЬНОЕ поле: название выработки (type) остаётся
      // тем, что ввёл пользователь на вкладке «Общие».
      mineTypeName: t.name,
      shape: t.shape,
      ...dims,
      area,
      perimeter,
      manualSection: true,
      alphaCoef: t.alphaCoef,
      vMax: t.vMax,
      surface: t.surface,
      ...(surf ? { surfaceId: surf.id } : {}),
      resistanceMode: "alpha",
    };

    // Применяем ко всем выбранным ветвям, а при одиночном выборе — к текущей.
    const targets = selectedBranchIds.size > 1
      ? [...selectedBranchIds]
      : selectedBranchId ? [selectedBranchId] : [];
    if (targets.length === 0) return;

    pushHistory();
    setBranches((prev) =>
      prev.map((b) => (targets.includes(b.id) ? { ...b, ...patch } : b)),
    );
  };

  // ─── МУЛЬТИВЫБОР УЗЛОВ (Ctrl+клик) ─────────────────────────────────
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());

  /**
   * Сколько узлов затронет каждая область в диалоге «Перемещение схемы».
   * Считаем только при открытом диалоге — на большой схеме обход всех ветвей
   * заметен, а вне диалога эти числа никому не нужны.
   */
  const moveSchemaCounts = useMemo(() => (
    showMoveSchema
      ? { all: nodes.length, visible: moveTargetIds("visible").size, selected: selectedNodeIds.size }
      : { all: 0, visible: 0, selected: 0 }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [showMoveSchema, nodes, branchesRaw, horizons, selectedNodeIds]);

  /**
   * Роли двух выделенных узлов для подсветки на схеме.
   *
   * Горизонт здесь не указан: пользователь ещё не нажал кнопку и не выбрал,
   * какой горизонт двигать. Поэтому определяем роли по самому выделению —
   * узел, у которого есть ветви ровно одного горизонта, считаем
   * перемещаемым, второй — целевым. Если так решить нельзя (оба узла
   * одинаковы по смыслу), подсветку не показываем.
   */
  const alignRoles = useMemo(() => {
    if (selectedNodeIds.size !== 2) return undefined;
    const [a, b] = [...selectedNodeIds];
    // Набор горизонтов, к которым принадлежит узел
    const horizonsOf = (nodeId: string) => {
      const set = new Set<string>();
      for (const br of branchesRaw) {
        if (br.fromId === nodeId || br.toId === nodeId) set.add(br.horizonId || "");
      }
      return set;
    };
    const ha = horizonsOf(a);
    const hb = horizonsOf(b);
    // Узлы на одном и том же горизонте — совмещать нечего
    if (ha.size === 1 && hb.size === 1 && [...ha][0] === [...hb][0]) return undefined;
    // Поедет тот, кто «сидит» на одном горизонте: он и есть импортированный
    const moveId = ha.size === 1 && hb.size !== 1 ? a
      : hb.size === 1 && ha.size !== 1 ? b
      : null;
    if (!moveId) return undefined;
    const stayId = moveId === a ? b : a;
    return new Map<string, "move" | "stay">([[moveId, "move"], [stayId, "stay"]]);
  }, [selectedNodeIds, branchesRaw]);

  /**
   * Совмещение горизонта по паре выделенных узлов.
   *
   * Пользователь выделяет два узла (Ctrl+клик): один на горизонте, который
   * двигаем, второй — на основной схеме, куда его надо посадить. Возвращаем
   * готовое смещение, чтобы горизонт встал точно по этим узлам, без ручного
   * подбора цифр.
   *
   * Возвращает null, если выделение не подходит: узлов не два, оба на одном
   * горизонте или ни один к нему не относится — тогда непонятно, что и куда
   * двигать, и кнопка остаётся выключенной.
   */
  const horizonAlignFor = (horizonId: string): HorizonAlign | null => {
    if (selectedNodeIds.size !== 2) return null;
    const [a, b] = [...selectedNodeIds].map(id => nodes.find(n => n.id === id));
    if (!a || !b) return null;

    // Узел «принадлежит» горизонту, если у него есть ветвь этого горизонта
    const onHorizon = (nodeId: string) =>
      branchesRaw.some(br => br.horizonId === horizonId &&
        (br.fromId === nodeId || br.toId === nodeId));

    const aOn = onHorizon(a.id);
    const bOn = onHorizon(b.id);
    // Нужен ровно один узел на горизонте и ровно один вне его
    if (aOn === bOn) return null;

    const from = aOn ? a : b;   // узел горизонта — он поедет
    const to = aOn ? b : a;     // узел основной схемы — он останется
    const s1 = surveyXYZ(from);
    const s2 = surveyXYZ(to);
    return {
      dx: s2.x - s1.x,
      dy: s2.y - s1.y,
      dz: s2.z - s1.z,
      label: `${from.number || from.name || "узел"} → ${to.number || to.name || "узел"}`,
    };
  };
  const handleNodeMultiSelect = (id: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      // Если Set пуст и есть одиночный выбранный узел — включаем его тоже
      if (next.size === 0 && selectedNodeId && selectedNodeId !== id) {
        next.add(selectedNodeId);
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectedNodeId(id);
    setSelectedBranchId(null);
  };

  // ─── БУФЕР КОПИРОВАНИЯ ПАРАМЕТРОВ ВЕТВИ ─────────────────────────────
  const [branchParamBuffer, setBranchParamBuffer] = useState<Partial<TopoBranch> | null>(null);

  /**
   * Что именно переносит «Копировать параметры ветви» → «Применить».
   *
   * ТОЛЬКО СЕЧЕНИЕ: форма, её габариты, площадь и периметр (плюс dh — он есть
   * 4S/P, то есть то же сечение, и manualSection — признак того, что S и P
   * заданы вручную, без него применённые S и P тут же затёрлись бы пересчётом
   * по габаритам, см. recalcBranch в topology.ts).
   *
   * Раньше здесь был ОБРАТНЫЙ список: копировалось всё поле за полем, кроме
   * результатов расчёта. На чужую выработку уезжал вентилятор (hasFan,
   * fanPressure, fanReverse, fanStopped, характеристика) — а это сразу и
   * НАПРАВЛЕНИЕ движения воздуха в ветви, и ДОПОЛНИТЕЛЬНАЯ ДЕПРЕССИЯ на ней;
   * следом — перемычка, очаг пожара, водопровод и воздухопровод, карточка
   * забоя, подписи индикаторов. Человек хотел размножить сечение по десятку
   * штреков, а получал десяток вентиляторов и перемычек, каждый из которых
   * молча менял расчёт всей сети: опрокидывались потоки, ломались результаты.
   *
   * Поэтому список БЕЛЫЙ, а не чёрный: новое поле в TopoBranch по умолчанию НЕ
   * копируется, и его надо добавить сюда осознанно. С чёрным списком любое
   * новое оснащение ветви начинало бы размножаться само собой.
   */
  const BRANCH_COPY_SECTION_FIELDS = [
    "shape",                                                     // форма сечения
    "diameter", "rectWidth", "rectHeight", "trapTopWidth", "archHeight", // габариты формы
    "area", "perimeter", "dh", "manualSection",                  // площадь, периметр, 4S/P
  ] as const satisfies readonly (keyof TopoBranch)[];

  // ─── МЕНЮ ФАЙЛ ──────────────────────────────────────────────────────
  const [fileSectionState, setFileSectionState] = useState("add");

  // Актуальная версия десктопа (для вкладки Файл → Установить)
  const [desktopLatestVer, setDesktopLatestVer] = useState<string>("");

  // При старте узнаём активный расчётный сервер (основной/резерв) из админ-настроек
  useEffect(() => { refreshComputeConfig(); }, []);

  // При открытии вкладки «Установить» подтягиваем актуальную версию десктопа
  useEffect(() => {
    if (fileSectionState !== "install" || desktopLatestVer) return;
    fetchRemoteVersion()
      .then(v => { if (v.version) setDesktopLatestVer(v.version); })
      .catch(() => { /* нет сети — просто не показываем номер версии */ });
  }, [fileSectionState, desktopLatestVer]);

  // ─── DXF ИМПОРТ ─────────────────────────────────────────────────────
  const [showDxfImport, setShowDxfImport] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [showExcelExport, setShowExcelExport] = useState(false);
  const [showCsvExport, setShowCsvExport] = useState(false);
  /** Открытое окно параметров выгрузки схемы (.erp или .cdf3), null — закрыто. */
  const [schemeExportFormat, setSchemeExportFormat] = useState<SchemeExportFormat | null>(null);
  const [showCombinedImport, setShowCombinedImport] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showVentsimCsvImport, setShowVentsimCsvImport] = useState(false);
  const [showVent2CsvImport, setShowVent2CsvImport] = useState(false);
  const [showVent2Cdf3Import, setShowVent2Cdf3Import] = useState(false);
  const [showVentsimVsmImport, setShowVentsimVsmImport] = useState(false);
  // Импорт проекта АэроСети (.erp). Держим ОТДЕЛЬНО от импорта «CSV из
  // АэроСети»: это разные источники — здесь читается сам файл программы
  // (ZIP + schema.xml), а там текстовая выгрузка. Путать их нельзя.
  const [showErpImport, setShowErpImport] = useState(false);

  // Импорт модели .vsm (файл Ventsim напрямую, без выгрузки в CSV)
  const handleVentsimVsmImport = (result: VentsimVsmResult, mode: "replace" | "append") => {
    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols(ensureFanSymbols(result.branches, []));
      setSelectedNodeId(null); setSelectedBranchId(null);
    } else {
      setNodes(prev => [...prev, ...result.nodes]);
      setBranches(prev => [...prev, ...result.branches]);
      setSchemaSymbols(prev => [...prev, ...ensureFanSymbols(result.branches, prev)]);
    }
    if (result.horizons.length > 0) {
      setHorizons(prev => {
        const keep = mode === "replace"
          ? prev.filter(h => h.id === OVERVIEW_HORIZON_ID)
          : prev;
        const have = new Set(keep.map(h => h.name));
        return [...keep, ...result.horizons.filter(h => !have.has(h.name))];
      });
    }
    setImportNonce(n => n + 1);
    postImportCheckRef.current = true;
    setShowVentsimVsmImport(false);
    setActiveRibbon("home");
  };

  // Импорт схемы .cdf3 (файл Вентиляции 2.0 напрямую, без выгрузки в CSV)
  const handleVent2Cdf3Import = (result: Vent2Cdf3Result, mode: "replace" | "append") => {
    // Условные обозначения перемычек. РАНЬШЕ импорт .cdf3 переносил только
    // сопротивление перемычки внутрь ветви: в расчёте оно участвовало, а
    // значка на плане не появлялось. Теперь на каждую перемычку из файла
    // ставим УО — вид подбираем по её названию.
    const cdf3BulkheadSymbols = () => {
      const stamp = Date.now();
      return (result.bulkheads ?? []).map((bk, i) => ({
        id: `SYM_BK_C3_${stamp}_${i}`,
        typeId: guessBulkheadTypeId(bk.typeName),
        x: 0, y: 0,
        branchId: bk.branchId,
        // Положение вдоль выработки берём из файла — перемычка встаёт туда,
        // где она стоит в Вентиляции 2.0, а не всегда в середину.
        t: bk.offset > 0 && bk.offset < 1 ? bk.offset : 0.5,
        bkResMode: "manual" as const,
        // Сопротивление кладём В САМ ЗНАЧОК. Расчёт сети суммирует R перемычек
        // по значкам, а поле ветви (bulkheadManualR) берёт в счёт ТОЛЬКО когда
        // значков на ветви нет. Раньше здесь стоял ноль — из-за этого
        // сопротивление перемычки и показывалось нулевым, и выпадало из расчёта.
        bkManualR: bk.rKmu,
        bkBulkheadR: bk.rKmu * 1000,
        bkBulkheadName: bk.typeName,
      }));
    };

    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols([...ensureFanSymbols(result.branches, []), ...cdf3BulkheadSymbols()]);
      setSelectedNodeId(null); setSelectedBranchId(null);
    } else {
      setNodes(prev => [...prev, ...result.nodes]);
      setBranches(prev => [...prev, ...result.branches]);
      setSchemaSymbols(prev => [...prev, ...ensureFanSymbols(result.branches, prev), ...cdf3BulkheadSymbols()]);
    }
    // Горизонты из схемы добавляем к существующим, не трогая «Общий вид».
    if (result.horizons.length > 0) {
      setHorizons(prev => {
        const keep = mode === "replace"
          ? prev.filter(h => h.id === OVERVIEW_HORIZON_ID)
          : prev;
        const have = new Set(keep.map(h => h.name));
        return [...keep, ...result.horizons.filter(h => !have.has(h.name))];
      });
    }
    setImportNonce(n => n + 1);
    postImportCheckRef.current = true;
    setShowVent2Cdf3Import(false);
    setActiveRibbon("home");
  };

  /**
   * Импорт проекта АэроСети (.erp) — файла программы напрямую.
   *
   * НЕ ПУТАТЬ с «CSV из АэроСети» (handleCsvImport): тот читает текстовую
   * выгрузку и требует отдельных файлов на узлы/выработки, а этот берёт
   * исходный проект целиком — со слоями, вентиляторами и перемычками.
   */
  const handleErpImport = (result: ErpImportResult, mode: "replace" | "append") => {
    // Условные обозначения перемычек. РАНЬШЕ импорт .erp переносил перемычку
    // только в свойства выработки: в списке она была, а значка на плане не
    // появлялось. Теперь на каждую выработку с перемычкой ставим УО — вид
    // подбираем по её названию, как при импорте .cdf3 и CSV.
    const erpBulkheadSymbols = (existing: SchemaSymbol[]) => {
      const stamp = Date.now();
      const syms: SchemaSymbol[] = [];
      result.branches.forEach((b, i) => {
        if (!b.hasBulkhead) return;
        if (existing.some(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id)) return;
        syms.push({
          id: `SYM_BK_ERP_${stamp}_${i}`,
          typeId: guessBulkheadTypeId(b.bulkheadName || "Перемычка"),
          x: 0, y: 0,
          branchId: b.id,
          t: 0.5,
          bkResMode: "manual" as const,
          // Сопротивление кладём в сам значок: расчёт сети суммирует R перемычек
          // по значкам, а поле ветви учитывает только когда значков нет.
          bkManualR: b.bulkheadManualR ?? 0,
          bkBulkheadR: b.bulkheadR ?? 0,
          bkBulkheadName: b.bulkheadName || "Перемычка",
        });
      });
      return syms;
    };

    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols([...ensureFanSymbols(result.branches, []), ...erpBulkheadSymbols([])]);
      setSelectedNodeId(null); setSelectedBranchId(null);
    } else {
      setNodes(prev => [...prev, ...result.nodes]);
      setBranches(prev => [...prev, ...result.branches]);
      setSchemaSymbols(prev => [...prev, ...ensureFanSymbols(result.branches, prev), ...erpBulkheadSymbols(prev)]);
    }
    // Слои АэроСети становятся горизонтами, «Общий вид» при этом сохраняем.
    if (result.horizons.length > 0) {
      setHorizons(prev => {
        const keep = mode === "replace"
          ? prev.filter(h => h.id === OVERVIEW_HORIZON_ID)
          : prev;
        const have = new Set(keep.map(h => h.name));
        return [...keep, ...result.horizons.filter(h => !have.has(h.name))];
      });
    }
    // ── Позиции ПЛА ────────────────────────────────────────────────────────
    // Приходят отдельным списком: в .erp это самостоятельные объекты плана
    // ликвидации аварий, а не узлы схемы. Цвета, диаметр и привязку выноски
    // берём прямо из файла — подбирать палитру, как для CSV, не требуется.
    const erpPositions: Position[] = (result.positions ?? []).map(rp => {
      const acc = ACCIDENT_TYPES.find(a => a.toLowerCase() === rp.accidentType.toLowerCase());
      return makePosition({
        id: `POS_ERP_${rp.id}`,
        number: rp.number,
        name: rp.name,
        x: rp.x, y: rp.y, z: rp.z,
        placed: true,
        branchIds: rp.branchIds,
        color: rp.color || "#e53e3e",
        borderColor: rp.borderColor || "#c53030",
        diameter: rp.diameter,
        font: rp.font,
        positionType: rp.positionType,
        leaderBranchId: rp.leaderBranchId || null,
        leaderT: rp.leaderBranchId ? rp.leaderT : null,
        comment: rp.comment,
        ...(acc ? { accidentType: acc as AccidentType } : {}),
      });
    });
    if (erpPositions.length > 0) {
      if (mode === "replace") setPositions(erpPositions);
      else setPositions(prev => [...prev, ...erpPositions]);
    } else if (mode === "replace") {
      setPositions([]);
    }

    result.warnings.forEach(w => addLog("warn", `Импорт АэроСеть: ${w}`));
    addLog("info", `Импорт АэроСеть (.erp): узлов ${result.stats.nodes}, выработок ${result.stats.branches}, вентиляторов ${result.stats.fans}, перемычек ${result.stats.bulkheads}, позиций ПЛА ${result.stats.positions}`);
    setImportNonce(n => n + 1);
    postImportCheckRef.current = true;
    setShowErpImport(false);
    setActiveRibbon("home");
  };

  const handleVentsimCsvImport = (result: VentsimCsvResult, mode: "replace" | "append") => {
    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols(ensureFanSymbols(result.branches, []));
      setSelectedNodeId(null); setSelectedBranchId(null);
    } else {
      setNodes(prev => [...prev, ...result.nodes]);
      setBranches(prev => [...prev, ...result.branches]);
      setSchemaSymbols(prev => [...prev, ...ensureFanSymbols(result.branches, prev)]);
    }
    setImportNonce(n => n + 1);
    postImportCheckRef.current = true;
    setShowVentsimCsvImport(false);
    setActiveRibbon("home");
  };

  const handleCsvImport = (result: CsvImportResult, mode: "replace" | "append") => {
    // ── Применяем вентиляторы к ветвям ──
    const applyFans = (branches: typeof result.branches) => {
      if (!result.fans || result.fans.length === 0) return branches;
      return branches.map(b => {
        const fan = result.fans.find(f => f.branchId === b.id);
        if (!fan) return b;
        // Привязываем модель из каталога по имени, чтобы её qMax ограничивал расход
        // в режиме постоянного напора (иначе H "продавливает" сеть до нефизичного Q).
        const matched = findFanByName(fan.name);
        return { ...b, hasFan: true, fanMode: "constant" as const, fanName: fan.name,
                 fanType: fan.fanType ?? b.fanType,
                 fanPressure: fan.pressure, fanCurveId: matched?.id ?? b.fanCurveId ?? "" };
      });
    };

    // Если сопротивление выработок в файле уже суммарное (включает перемычки),
    // то вклад перемычек обнуляем: иначе он попадёт в расчёт дважды — один раз
    // внутри R ветви, второй раз как отдельная перемычка.
    const bkAlreadyInR = result.resistanceIncludesBulkheads === true;

    // ── Применяем перемычки к ветвям (hasBulkhead + bulkheadR) ──
    //
    // Когда R выработки в файле СУММАРНОЕ (уже включает перемычки), вклад
    // перемычки нужно из него вычесть — иначе он попадёт в расчёт дважды:
    // один раз внутри R ветви, второй раз как отдельная перемычка.
    //
    // РАНЬШЕ вместо вычитания сопротивление перемычки просто обнулялось. Сумма
    // получалась верной, но в свойствах перемычки стоял ноль: реальное
    // значение из файла пропадало, и пользователь не мог его ни увидеть, ни
    // проверить. Теперь настоящее R сохраняется у перемычки, а из ветви
    // вычитается ровно столько же.
    const applyBulkheads = (branches: typeof result.branches) => {
      if (!result.bulkheads || result.bulkheads.length === 0) return branches;
      // На одной выработке может быть несколько перемычек (шлюз) — суммируем.
      const sumByBranch = new Map<string, number>();
      for (const bk of result.bulkheads) {
        sumByBranch.set(bk.branchId, (sumByBranch.get(bk.branchId) ?? 0) + bk.rKmu);
      }
      return branches.map(b => {
        const bk = result.bulkheads.find(bk => bk.branchId === b.id);
        if (!bk) return b;
        const own = { ...b } as typeof b;
        if (bkAlreadyInR) {
          // Вычитаем перемычки из R выработки; ниже нуля не опускаемся —
          // остаётся собственное трение выработки.
          const sumBk = sumByBranch.get(b.id) ?? 0;
          const rest = Math.max(0, (b.resistance ?? 0) - sumBk);
          own.resistance = rest;
          own.manualR = rest;
        }
        return {
          ...own,
          hasBulkhead: true,
          bulkheadName: bk.typeName,
          bulkheadR: bk.rKmu * 1000,    // кМюрг → Мюрг (базовая единица)
          bulkheadManualR: bk.rKmu,
          bulkheadResMode: "manual" as const,
          bulkheadAirPerm: bk.airPerm,
        };
      });
    };

    // ── Создаём SchemaSymbol для перемычек ──
    // Вид УО подбирает общая guessBulkheadTypeId — та же, что и при импорте
    // схемы .cdf3, чтобы одинаковые названия давали одинаковые обозначения.
    const makeBulkheadSymbols = (branches: typeof result.branches, existing: typeof schemaSymbols) => {
      const syms: typeof schemaSymbols = [];
      let notFound = 0;
      let bkSeq = 0;
      for (const bk of result.bulkheads ?? []) {
        const br = branches.find(b => b.id === bk.branchId);
        if (!br) { notFound++; continue; }
        if (existing.some(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === bk.branchId)) continue;
        const typeId = guessBulkheadTypeId(bk.typeName);
        syms.push({
          // Гарантированно уникальный id: Date.now() одинаков для всех перемычек
          // одного импорта, а на одной ветви может быть несколько перемычек —
          // раньше это давало дубли id и React-коллизию ключей, из-за чего
          // удаление перемычки не обновляло схему до переоткрытия файла.
          id: `SYM_BK_${Date.now()}_${bkSeq++}_${bk.branchId}`,
          typeId,
          x: 0, y: 0,
          branchId: bk.branchId,
          t: 0.5,
          bkResMode: "manual" as const,
          // Настоящее R из файла — и в расчёт, и на показ. При суммарном R
          // столько же вычтено из сопротивления самой выработки (applyBulkheads),
          // поэтому дважды оно не посчитается.
          bkManualR: bk.rKmu,
          bkAirPerm: bk.airPerm,
          bkBulkheadR: bk.rKmu * 1000,
          bkBulkheadName: bk.typeName,
        });
      }
      if (notFound > 0) console.warn(`[BulkheadImport] ${notFound} перемычек не нашли ветвь. Пример bk.branchId="${result.bulkheads?.[0]?.branchId}", ветвь[0].id="${branches[0]?.id}"`);
      return syms;
    };

    // ── Создаём объекты Position из импорта ──
    const makeImportedPositions = (existingPositions: Position[]) => {
      const newPositions: Position[] = [];
      let nextNum = (existingPositions.length > 0
        ? Math.max(...existingPositions.map(p => p.number)) + 1
        : 1);
      for (const rp of result.positions ?? []) {
        // Цвет маркера: подбираем пару «фон + граница» по цвету из файла.
        // Если цвет не задан или не распознан — matchPositionColor вернёт
        // случайный из палитры, чтобы позиции не были все одинаково красными.
        const pal = matchPositionColor(rp.borderColor ?? "");
        // Вид аварии из файла: принимаем только известные значения,
        // иначе оставляем принятый по умолчанию «Пожар».
        const accRaw = (rp.accidentType ?? "").trim().toLowerCase();
        const acc = ACCIDENT_TYPES.find(a => a.toLowerCase() === accRaw);
        newPositions.push(makePosition({
          id: `POS_CSV_${rp.id}_${Date.now()}`,
          number: rp.number || nextNum++,
          name: rp.name,
          x: rp.x,
          y: rp.y,
          z: rp.z,
          // Позиция считается расставленной, если у неё есть координаты ЛИБО
          // привязанные выработки: импорт из Вентиляции 2.0 приходит с
          // нулевыми координатами и вычисляет место по выработкам позиции.
          placed: rp.x !== 0 || rp.y !== 0 || (rp.branchIds?.length ?? 0) > 0,
          branchIds: rp.branchIds,
          color: pal.color,
          borderColor: pal.border,
          ...(acc ? { accidentType: acc as AccidentType } : {}),
          positionType: (rp.positionType?.toLowerCase().includes("реверс") ? "reverse" : "normal") as "normal" | "reverse",
        }));
      }
      return newPositions;
    };

    // ── Горизонты (слои схемы) из столбца «Слой выработки» ──
    // Импорт вернул список слоёв и уже проставил ветвям horizonId. Здесь
    // создаём сами горизонты в списке слева и раздаём им цвета из палитры.
    //
    // При ДОБАВЛЕНии к существующей схеме слой с таким же названием не
    // дублируем: переиспользуем уже имеющийся горизонт, а ветвям импорта
    // переписываем horizonId на его id.
    const applyImportedHorizons = (
      branches: typeof result.branches,
      existing: Horizon[],
    ): { horizons: Horizon[]; branches: typeof result.branches } => {
      const raw = result.horizons ?? [];
      if (raw.length === 0) return { horizons: existing, branches };

      const byName = new Map(existing.map(h => [h.name.trim().toLowerCase(), h]));
      const used = new Set(existing.map(h => (h.color ?? "").toLowerCase()));
      // Соответствие: id горизонта из импорта → id горизонта на схеме.
      const idRemap = new Map<string, string>();
      const added: Horizon[] = [];

      for (const rh of raw) {
        const key = rh.name.trim().toLowerCase();
        const same = byName.get(key);
        if (same) { idRemap.set(rh.id, same.id); continue; }
        const free = HORIZON_PALETTE.filter(c => !used.has(c.toLowerCase()));
        const color = free.length > 0
          ? free[Math.floor(Math.random() * free.length)]
          : HORIZON_PALETTE[Math.floor(Math.random() * HORIZON_PALETTE.length)];
        used.add(color.toLowerCase());
        const hz: Horizon = { id: rh.id, name: rh.name, z: rh.z, color, visible: true };
        added.push(hz);
        byName.set(key, hz);
        idRemap.set(rh.id, rh.id);
      }

      const remapped = branches.map(b => {
        const to = b.horizonId ? idRemap.get(b.horizonId) : undefined;
        return to && to !== b.horizonId ? { ...b, horizonId: to } : b;
      });
      return { horizons: [...existing, ...added], branches: remapped };
    };

    if (mode === "replace") {
      const withBulkheads = applyBulkheads(result.branches);
      const withFans = applyFans(withBulkheads);
      // При замене оставляем только «Общий вид» — остальные слои приходят из файла.
      const baseHorizons = horizons.filter(h => h.id === OVERVIEW_HORIZON_ID);
      const hzRes = applyImportedHorizons(withFans, baseHorizons);
      const finalBranches = hzRes.branches;
      setHorizons(hzRes.horizons);
      setNodes(result.nodes);
      setBranches(finalBranches);
      const fanSyms = ensureFanSymbols(finalBranches, []);
      const bkSyms  = makeBulkheadSymbols(finalBranches, fanSyms);
      setSchemaSymbols([...fanSyms, ...bkSyms]);
      setPositions(makeImportedPositions([]));
      setSelectedNodeId(null); setSelectedBranchId(null);
    } else {
      // Горизонты считаем ОДИН раз до обновления состояния: и ветви, и список
      // слоёв должны получить одни и те же id (иначе привязка разъедется).
      const appendBranches = applyFans(applyBulkheads(result.branches));
      const hzRes = applyImportedHorizons(appendBranches, horizons);
      const finalBranches = hzRes.branches;
      setHorizons(hzRes.horizons);
      setNodes(prev => [...prev, ...result.nodes]);
      setBranches(prev => [...prev, ...finalBranches]);
      setSchemaSymbols(prev => {
        const fanSyms = ensureFanSymbols(finalBranches, prev);
        const bkSyms  = makeBulkheadSymbols(finalBranches, [...prev, ...fanSyms]);
        return [...prev, ...fanSyms, ...bkSyms];
      });
      setPositions(prev => [...prev, ...makeImportedPositions(prev)]);
    }
    setImportNonce(n => n + 1);
    postImportCheckRef.current = true;
    setShowCsvImport(false);
    setActiveRibbon("home");
  };

  const handleVent2CsvImport = (result: CsvImportResult, mode: "replace" | "append") => {
    handleCsvImport(result, mode);
    setShowVent2CsvImport(false);
  };

  const handleCombinedImport = (result: CombinedImportResult, mode: "replace" | "append") => {
    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols([]);
      setSelectedNodeId(null);
      setSelectedBranchId(null);
    } else {
      setNodes((prev) => [...prev, ...result.nodes]);
      setBranches((prev) => [...prev, ...result.branches]);
    }
    setImportNonce((n) => n + 1);
    postImportCheckRef.current = true;
    setShowCombinedImport(false);
    setActiveRibbon("home");
  };

  const handleExcelImport = (result: ExcelImportResult, mode: "replace" | "append") => {
    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols([]);
      setSelectedNodeId(null);
      setSelectedBranchId(null);
    } else {
      setNodes((prev) => [...prev, ...result.nodes]);
      setBranches((prev) => [...prev, ...result.branches]);
    }
    setImportNonce((n) => n + 1);
    postImportCheckRef.current = true;
    setShowExcelImport(false);
    setActiveRibbon("home");
  };
  const handleDxfImport = (result: DxfImportResult, mode: "replace" | "append") => {
    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols([]);
      setSelectedNodeId(null);
      setSelectedBranchId(null);
    } else {
      setNodes((prev) => [...prev, ...result.nodes]);
      setBranches((prev) => [...prev, ...result.branches]);
    }
    // Переключаем вид на план (сверху) и вписываем схему в экран через useEffect
    setImportNonce((n) => n + 1);
    postImportCheckRef.current = true;
    setShowDxfImport(false);
    setActiveRibbon("home");
  };

  // ─── СПРАВОЧНИК ОБОРУДОВАНИЯ ─────────────────────────────────────────
  const [showEquipRef, setShowEquipRef] = useState(false);
  // Тип разделов справочника один на всю программу (см. RibbonReferences).
  // Раньше он дублировался здесь и НЕ содержал раздел «Нормы расхода воздуха»,
  // хотя кнопка на него ссылалась — тип и код разошлись.
  const [equipRefTab, setEquipRefTab] = useState<EquipRefTab>("fans");
  const [showLegend, setShowLegend] = useState(false);
  // Стабильные обработчики для вкладки «Справочники»: без них memo на вкладке
  // снимался бы при каждой перерисовке страницы и вынос не дал бы ничего.
  const openEquipRef = useCallback((tab: EquipRefTab) => {
    setEquipRefTab(tab);
    setShowEquipRef(true);
  }, []);
  const openLegend = useCallback(() => setShowLegend(true), []);

  // ─── СОХРАНЕНИЕ / ЗАГРУЗКА ПРОЕКТА ───────────────────────────────────
  const { recentFiles, addRecentFile, updateHasHandle, syncHandles, removeRecentFile, clearRecentFiles } = useRecentFiles();
  // При открытии вкладки «Последние» сверяем пометки с реальным хранилищем:
  // иначе файл показывался «недоступен», хотя открывался с диска нормально.
  useEffect(() => {
    if (fileSectionState === "recent") void syncHandles();
  }, [fileSectionState, syncHandles]);
  // Имя файла проекта. При старте — ПУСТО: имя появляется только когда проект
  // открыт из файла или сохранён. Раньше здесь стояло «Проект1.vproj», и свежий
  // пустой запуск выглядел как уже существующий проект — а при закрытии
  // программа спрашивала о сохранении, хотя пользователь ничего не создавал.
  const [projectFileName, setProjectFileName] = useState<string>("");
  // Флаг несохранённых изменений
  const [isDirty, setIsDirty] = useState<boolean>(false);
  // Диалог подтверждения закрытия
  const [showCloseConfirm, setShowCloseConfirm] = useState<boolean>(false);
  // Окно "О программе"
  const [showAbout, setShowAbout] = useState<boolean>(false);
  // Диалог руководства пользователя
  const [showHelpDialog, setShowHelpDialog] = useState<boolean>(false);
  const [showDepressogram, setShowDepressogram] = useState<boolean>(false);
  const [depressogramHighlight, setDepressogramHighlight] = useState<string[]>([]);
  const [depressogramPickMode, setDepressogramPickMode] = useState<boolean>(false);
  const [depressogramManualBranches, setDepressogramManualBranches] = useState<Set<string>>(new Set());

  // ─── Предпросмотр подобранного варианта на схеме ──────────────────────────
  // Вариант уже посчитан при подборе: расходы и задымление лежат в VariantResult.
  // Показываем их НЕ трогая проект — пользователь видит режим до того, как
  // согласился его внести, и может вернуться к списку одной кнопкой.
  const [fireControlPreview, setFireControlPreview] = useState<{
    title: string;
    actions: FireAction[];
    /** branchId → расход варианта, м³/с */
    flows: Map<string, number>;
    /** branchId → плотность дыма, м⁻¹ */
    smoke: Map<string, number>;
    /** Ветви с превышением допустимой скорости */
    violations: string[];
    peopleAtRisk: number;
    peopleInSmoke: number;
  } | null>(null);
  // Что показывать в предпросмотре: расходы или задымление.
  const [fireControlPreviewMode, setFireControlPreviewMode] =
    useState<"flow" | "smoke">("flow");

  // Ветви схемы с расходами варианта. Схема сама по себе не меняется: подмена
  // живёт только в том, что уходит на холст, поэтому панели свойств, расчёты
  // и сохранение проекта продолжают видеть настоящие данные.
  //
  // recalcBranchAero пересчитывает по расходу скорость и депрессию — тем же
  // кодом, что и обычная правка. Иначе на схеме стоял бы новый расход рядом со
  // старой скоростью, и подписи противоречили бы друг другу.
  const previewBranches = useMemo(() => {
    if (!fireControlPreview) return branches;
    const { flows, smoke } = fireControlPreview;
    return branches.map(b => {
      const q = flows.get(b.id);
      if (q === undefined) return b;
      return recalcBranchAero({
        ...b,
        flow: q,
        fireComputedSmokeDens: smoke.get(b.id) ?? 0,
      });
    });
  }, [branches, fireControlPreview]);

  // Задымление варианта: ветвь заливается целиком — расчёт варианта даёт
  // установившуюся плотность дыма, а не фронт на конкретной минуте.
  const previewSmokeColors = useMemo(() => {
    if (!fireControlPreview || fireControlPreviewMode !== "smoke") return undefined;
    const map = new Map<string, { color: string; fromT: number; toT: number }>();
    for (const [id, dens] of fireControlPreview.smoke) {
      if (!(dens > 0.01)) continue;
      // Пороги — те же, по которым расчёт пожара присваивает уровень
      // опасности (см. calcHazardLevel в fireCalculator).
      const color = dens > 2 ? "#1f2937" : dens > 0.5 ? "#4b5563" : "#9ca3af";
      map.set(id, { color, fromT: 0, toT: 1 });
    }
    return map.size > 0 ? map : undefined;
  }, [fireControlPreview, fireControlPreviewMode]);

  /** Закрыть предпросмотр и вернуться к списку вариантов. */
  const closeFireControlPreview = () => {
    setFireControlPreview(null);
    setDepressogramHighlight([]);
  };

  // Ссылка на FileSystemFileHandle для перезаписи (File System Access API)
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  // Ссылка на актуальную функцию сохранения — для вызова из window (баннер обновления)
  const handleSaveRef = useRef<(() => Promise<void> | void) | null>(null);
  // Ссылка на «Сохранить как» — нужна, чтобы «Сохранить» для нового безымянного
  // проекта открыл диалог выбора файла (handleSaveAs объявлен ниже по коду).
  const handleSaveAsRef = useRef<(() => Promise<void> | void) | null>(null);
  // Текущие параметры вида для сохранения в файл

  const buildProjectData = () => ({
    version: 2,
    name: projectFileName,
    savedAt: new Date().toISOString(),
    nodes,
    branches: branchesRaw,
    horizons,
    schemaSymbols,
    mineFans,
    userPumps,
    mineBulkheads,
    mineTypes,
    opoData,
    ventSections,
    ventNorms,
    blastThresholds,
    blastMixId,
    blastMixCustomR,
    blastDuringEmergency,
    blastGasTimeFactual,
    calcMode,
    solverTolerance,
    solverMaxIter,
    solverAlpha,
    surfaceTemp,
    heatingSeason,
    useNaturalDraft,
    geoGradient,
    mineAirTemp,
    // Влажность воздуха (норматив, прил. 9, форм. 9.2)
    useHumidity,
    surfaceHumidity,
    mineHumidity,
    surfacePressure,
    infoConfig,
    unitsConfig,
    branchWidth,
    branchBorder,
    colorByHorizon,
    colorMode,
    posColorInner,
    posColorOuter,
    showPositions,
    showFlowArrows,
    pollutionThreshold,
    flowDisplay,
    animSpeed,
    zScale,
    xyScale,
    view: savedViewStateRef.current ?? undefined,
    positions,
    textBlocks,
    scaleLimitsEnabled,
    widthBySectionOn,
    tube3dOn,
    scaleBranchMin,
    scaleBranchMax,
    scalePositionMin,
    scalePositionMax,
    positionGostMm,
    bulkheadScale,
    fanScale,
    smokeVisThreshold,
  });

  // Проект считается ПУСТЫМ, пока на схеме ничего нет и файл не открыт/не
  // сохранён. Такой проект нечего терять: спрашивать о сохранении при выходе
  // не нужно. Раньше этой проверки не было — любое служебное изменение
  // состояния сразу после запуска (подгрузка каталога перемычек, настроек
  // отображения, единиц измерения) взводило флаг «есть изменения», и программа
  // требовала сохранения у пользователя, который ничего не делал.
  const isEmptyProject =
    nodes.length === 0 &&
    branchesRaw.length === 0 &&
    schemaSymbols.length === 0 &&
    !projectFileName;

  // Отслеживаем изменения проекта — помечаем как «несохранённый»
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    // Пустой безымянный проект не помечаем изменённым.
    if (nodes.length === 0 && branchesRaw.length === 0 && schemaSymbols.length === 0 && !projectFileName) {
      setIsDirty(false);
      return;
    }
    setIsDirty(true);
  }, [nodes, branchesRaw, schemaSymbols, mineFans, userPumps, mineBulkheads, mineTypes,
      calcMode, solverTolerance, solverMaxIter, solverAlpha, surfaceTemp,
      infoConfig, unitsConfig, branchWidth, branchBorder, colorByHorizon,
      showFlowArrows, pollutionThreshold, flowDisplay, zScale, xyScale, projectFileName]);

  // Предупреждение при закрытии/обновлении вкладки
  // В десктопном режиме (WebView2) beforeunload отключён — закрытие обрабатывается через C#
  useEffect(() => {
    type W = Window & { __IS_DESKTOP__?: boolean };
    const isDesktop = !!(window as W).__IS_DESKTOP__;
    if (isDesktop) return; // в десктопе браузерный диалог не нужен

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Пустой безымянный проект терять нечего — не мешаем закрытию.
      if (!isDirty || isEmptyProject) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty, isEmptyProject]);

  // В десктопном режиме — регистрируем callbacks для C# перед закрытием окна
  useEffect(() => {
    type W = Window & {
      __IS_DESKTOP__?: boolean;
      __pvsCanClose?: () => boolean;
      __pvsShowCloseDialog?: () => void;
      chrome?: { webview?: { postMessage: (s: string) => void } };
    };
    const w = window as W;
    if (!w.__IS_DESKTOP__) return;

    // C# вызывает __pvsCanClose() — если true, закрываем без диалога
    w.__pvsCanClose = () => !isDirty || isEmptyProject;

    // C# вызывает __pvsShowCloseDialog() когда нажата системная кнопка X
    // Показываем наш React-диалог вместо браузерного "Покинуть сайт?"
    w.__pvsShowCloseDialog = () => {
      if (!isDirty || isEmptyProject) {
        // Несохранённых данных нет — сразу подтверждаем закрытие
        w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-close-confirmed" }));
        return;
      }
      // Показываем кастомный диалог
      setShowCloseConfirm(true);
    };
  }, [isDirty, isEmptyProject]);

  // Пробрасываем состояние «есть несохранённые изменения» и функцию сохранения
  // в window — чтобы глобальный баннер обновления (AppUpdateBanner) мог перед
  // перезагрузкой браузера предложить сохранить проект.
  useEffect(() => {
    type W = Window & {
      __pvsIsDirty?: () => boolean;
      __pvsSaveProject?: () => Promise<void> | void;
    };
    const w = window as W;
    w.__pvsIsDirty = () => isDirty;
    w.__pvsSaveProject = () => handleSaveRef.current?.();
    return () => { w.__pvsIsDirty = undefined; w.__pvsSaveProject = undefined; };
  }, [isDirty]);

  // Записать содержимое в уже открытый FileHandle (перезапись)
  const writeToHandle = async (handle: FileSystemFileHandle, data: object) => {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  };

  // Имя для сохранения. Пока проект безымянный (новый, ещё не сохранённый),
  // предлагаем «Проект1.vproj» — но только в момент сохранения, а не в
  // заголовке окна при запуске.
  const DEFAULT_PROJECT_NAME = "Проект1.vproj";
  const suggestedFileName = () => projectFileName || DEFAULT_PROJECT_NAME;

  /**
   * Открывает окно параметров выгрузки схемы в чужой формат (.erp или .cdf3).
   * Сама запись файла — в handleSchemeExport, после подтверждения набора.
   */
  const openSchemeExport = (fmt: SchemeExportFormat) => {
    if (isDemo) { setShowLicenseDialog(true); return; }
    if (branches.length === 0) {
      addLog("warn", "Экспорт схемы: схема пуста — нечего выгружать");
      return;
    }
    setSchemeExportFormat(fmt);
  };

  /**
   * Выгрузка схемы в родной формат АэроСети (.erp) или в файл «Вентиляции 2.0»
   * (.cdf3) с отмеченным пользователем набором объектов. Обратная операция к
   * импорту этих же форматов.
   */
  const handleSchemeExport = async (fmt: SchemeExportFormat, o: SchemeExportOptions) => {
    setSchemeExportFormat(null);
    const name = suggestedFileName().replace(/\.vproj$/, "");
    try {
      if (fmt === "erp") {
        await exportErp({
          nodes, branches, horizons, positions,
          projectName: name, fileName: name,
          withFans: o.fans, withBulkheads: o.bulkheads,
          withPositions: o.positions, withResults: o.results,
        });
        const fans = o.fans ? branches.filter(b => b.hasFan).length : 0;
        const bulks = o.bulkheads ? branches.filter(b => b.hasBulkhead).length : 0;
        addLog("info", `Экспорт в АэроСеть (.erp): узлов ${nodes.length}, выработок ${branches.length}, вентиляторов ${fans}, перемычек ${bulks}, позиций ПЛА ${o.positions ? positions.length : 0}`);
      } else {
        const st = exportVent2Cdf3({
          nodes, branches, horizons,
          projectName: name, fileName: name,
          withBulkheads: o.bulkheads, withHorizons: o.horizons,
        });
        addLog("info", `Экспорт в Вентиляцию 2.0 (.cdf3): узлов ${st.nodes}, выработок ${st.branches}, перемычек ${st.bulkheads}, горизонтов ${st.horizons}`);
        for (const wmsg of st.warnings) addLog("warn", wmsg);
      }
    } catch (e) {
      const where = fmt === "erp" ? "АэроСеть" : "Вентиляцию 2.0";
      addLog("error", `Экспорт в ${where} не удался: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSave = async () => {
    if (isDemo) { setShowLicenseDialog(true); return; }
    // Новый проект ещё не привязан к файлу — сразу спрашиваем, куда сохранить.
    if (!projectFileName && !fileHandleRef.current && !filePathRef.current) {
      await handleSaveAsRef.current?.(); return;
    }
    const data = buildProjectData();

    // Проект открыт двойным кликом из проводника: перезаписываем ИСХОДНЫЙ файл
    // по его пути через десктопный мост — без диалога «Сохранить как».
    if (filePathRef.current) {
      type EAPI = { writeFile?: (path: string, content: string) => Promise<{ ok?: boolean; error?: string }> };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eAPI = (window as any).electronAPI as EAPI | undefined;
      if (eAPI?.writeFile) {
        try {
          const res = await eAPI.writeFile(
            filePathRef.current,
            JSON.stringify({ ...data, name: projectFileName || suggestedFileName() }, null, 2),
          );
          if (!res?.error) { setIsDirty(false); return; }
        } catch { /* файл недоступен — уходим в обычные пути сохранения */ }
      }
      // Записать по пути не удалось — больше не пытаемся, идём обычным путём
      filePathRef.current = null;
    }

    // Если есть открытый handle — перезаписываем без диалога
    if (fileHandleRef.current) {
      try {
        await writeToHandle(fileHandleRef.current, data);
        setIsDirty(false);
        return;
      } catch {
        // handle стал недоступен — fallback на скачивание
        fileHandleRef.current = null;
      }
    }
    // Fallback: скачивание (если File System Access API недоступен)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedFileName();
    a.click();
    URL.revokeObjectURL(url);
    setIsDirty(false);
  };
  handleSaveRef.current = handleSave;

  const handleSaveAs = async () => {
    if (isDemo) { setShowLicenseDialog(true); return; }
    const data = buildProjectData();
    // File System Access API — показываем диалог выбора файла
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as Window & { showSaveFilePicker: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
          suggestedName: suggestedFileName(),
          types: [{ description: "Проект вентиляции", accept: { "application/json": [".vproj", ".json"] } }],
        });
        fileHandleRef.current = handle;
        filePathRef.current = null;
        const fname = handle.name;
        setProjectFileName(fname);
        await writeToHandle(handle, { ...data, name: fname });
        setIsDirty(false);
        // Сохраняем handle в IndexedDB — чтобы файл появился в «Последние» с возможностью открыть
        void saveHandleToIDB(fname, handle).then(() => updateHasHandle(fname, true));
        return;
      } catch {
        // Пользователь отменил — ничего не делаем
        return;
      }
    }
    // Fallback: prompt + скачивание
    const name = window.prompt("Имя файла:", suggestedFileName());
    if (!name) return;
    const fname = name.endsWith(".vproj") ? name : `${name}.vproj`;
    setProjectFileName(fname);
    const blob = new Blob([JSON.stringify({ ...data, name: fname }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
    setIsDirty(false);
  };
  handleSaveAsRef.current = handleSaveAs;

  const handleOpen = async () => {
    if (isDemo) { setShowLicenseDialog(true); return; }
    // File System Access API — открываем с handle для последующей перезаписи
    if ("showOpenFilePicker" in window) {
      try {
        const [handle] = await (window as Window & { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
          types: [{ description: "Проект вентиляции", accept: {
            "application/json": [".vproj", ".json"],
            "text/plain": [".vproj", ".json"],
            "*/*": [".vproj", ".json"],
          }}],
          excludeAcceptAllOption: false,
        });
        const file = await handle.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.nodes && Array.isArray(data.nodes)) {
          if (nodes.length > 0 || branchesRaw.length > 0) {
            if (!window.confirm("Открыть проект? Текущие данные будут заменены.")) return;
          }
          fileHandleRef.current = handle;
          filePathRef.current = null;
          applyProjectData(data, file.name, true);
          // Сохраняем handle в IndexedDB — чтобы открывать из «Последние» без диалога
          void saveHandleToIDB(file.name, handle).then(() => updateHasHandle(file.name, true));
        } else {
          alert("Файл не является проектом Вентиляция-CAD.");
        }
        return;
      } catch {
        // Пользователь отменил или API недоступен — fallback
      }
    }
    // Fallback: <input type=file>
    // На Android accept=".vproj" делает файлы неактивными — используем широкий список типов
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".vproj,.json,application/json,text/plain,*/*";
    inp.onchange = () => {
      const file = inp.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (data.nodes && Array.isArray(data.nodes)) {
            if (nodes.length > 0 || branchesRaw.length > 0) {
              if (!window.confirm("Открыть проект? Текущие данные будут заменены.")) return;
            }
            fileHandleRef.current = null;
            filePathRef.current = null;
            applyProjectData(data, file.name, true);
          } else {
            alert("Файл не является проектом Вентиляция-CAD.");
          }
        } catch {
          alert("Ошибка чтения файла.");
        }
      };
      reader.readAsText(file);
    };
    inp.click();
  };

  // Применить данные из JSON — с слиянием дефолтов для ветвей
  // fromDisk=true — проект открыт из РЕАЛЬНОГО файла на диске (проводник,
  // диалог «Открыть», «Последние»). Тогда название берём строго из имени файла,
  // иначе схема показывалась бы под старым именем, записанным внутри JSON.
  const applyProjectData = (data: Record<string, unknown>, fileName: string, fromDisk?: boolean) => {
    // Блокируем начальный пресет вида — файл загружен
    initialFileLoadedRef.current = true;
    // Режим заливки, выбранный до открытия файла. Нужен для схем, сохранённых
    // старыми версиями: в них режим заливки не записан, и раньше он молча
    // сбрасывался в «выкл» — большая схема открывалась полностью белой.
    // Теперь для таких файлов сохраняем текущий выбор пользователя.
    const prevColorMode = colorMode;
    const prevColorByHorizon = colorByHorizon;
    // Загружается другая схема — результаты прошлого проекта неактуальны.
    clearAirflowCache();

    // ── ПОЛНЫЙ СБРОС СОСТОЯНИЯ ДО ДЕФОЛТОВ ПЕРЕД ЗАГРУЗКОЙ ─────────────
    // Чтобы данные предыдущего проекта не «просачивались» в новый
    // (особенно важно при открытии второго файла без перезагрузки страницы)

    // Выделение и инструмент
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    setSelectedNodeIds(new Set());
    setSelectedBranchIds(new Set());
    setSelectedSymbolId(null);
    setSelectedSymbolIds(new Set());
    setFanSymbolBranchId(null);
    setTool("select");

    // Результаты расчётов
    setSolveResult(null);
    setNormalFlows({});
    setFireResult(null);
    setFireCalcDone(false);
    setExplosionResult(null); setExplosionResultByBranch(new Map()); setExplosionBarriers(null);
    setExplosionCalcDone(false);
    setWaterNetwork({ nodeResults: new Map(), branchResults: new Map() });
    setVcSolving(false);
    setVcError(null);
    // Предпросмотр варианта относится к прежней схеме — см. сброс проекта.
    setFireControlPreview(null);

    // Временные буферы и состояния
    setBranchParamBuffer(null);
    setSymbolClipboard(null);
    setPendingSymbol(null);
    setCtxMenu(null);

    // Состояния интерфейса (сбрасываем к дефолтам)
    setActiveSide("general");
    setActiveHorizonId("");
    setEditingHorizonImageId(null);
    setEditingPrintLayerId(null);
    setZLevel(0);
    setShowMultiBranchProps(false);
    setShowVentPipeDialog(false);
    setVentPipeBranchIds([]);

    // Настройки отображения — сбрасываем до дефолтов;
    // ниже переопределятся значениями из файла если они там есть
    setFlowColorMin(0);
    setFlowColorMax(75);
    setFlowColorHue("red");
    setThinLines(false);
    setShowFlowArrows(false);
    setFlowDisplay("off");
    // Режим заливки здесь НАМЕРЕННО не сбрасываем: он восстанавливается ниже из
    // файла, а для файлов старых версий (где его нет) сохраняется выбор
    // пользователя — иначе схема каждый раз открывалась бы белой.
    setBranchWidth(7);
    setBranchBorder(0.6);
    setZScale(1);
    setXyScale(1);
    setScaleLimitsEnabled(false);
    setScalePositionMin(80);
    setScalePositionMax(150);
    setPositionGostMm(13);
    setBulkheadScale(150);
    setFanScale(450);
    setPosColorInner(false);
    setPosColorOuter(false);
    setShowPositions(true);
    setInfoConfig(DEFAULT_INFO_CONFIG);
    setUnitsConfig(DEFAULT_UNITS_CONFIG);
    setCalcMode("cross");
    setSolverTolerance(0.001);
    setSolverMaxIter(5000);
    setSolverAlpha(0.5);
    setSurfaceTemp(20);
    setMineAirTemp(15);
    setHeatingSeason("winter");
    // Данные ОПО — паспорт прежнего объекта не должен перейти в новый проект.
    setOpoData(makeDefaultOpoData());
    setUseNaturalDraft(true);
    setGeoGradient(3.0);
    // ── конец сброса ────────────────────────────────────────────────────

    // Каждый узел прогоняем через makeNode чтобы гарантировать все поля (как makeBranch для ветвей)
    // Строим ОДИН раз и переиспользуем: ниже этот же массив нужен для recalcAll,
    // и раньше там строился второй, точно такой же — на схеме в десятки тысяч
    // узлов лишний проход стоил заметного времени на ровном месте.
    const rawNodes = (data.nodes as TopoNode[]) ?? [];
    const builtNodes = rawNodes.map((n) => makeNode(n.id, n));
    setNodes(builtNodes);
    // Каждую ветвь прогоняем через makeBranch чтобы гарантировать все поля (fanRpm и т.д.)
    const rawBranches = (data.branches as TopoBranch[]) ?? [];
    // Совместимость со старыми файлами: раньше выбранный тип выработки
    // записывался в поле названия (type) и затирал его. Если отдельное поле
    // ещё не заполнено, а название совпадает с типом из справочника —
    // переносим его в mineTypeName, чтобы выбор в списке не потерялся.
    const loadedTypeNames = new Set(
      ((data.mineTypes as BranchType[]) ?? []).map((t) => t.name),
    );
    const mergedBranches = rawBranches.map((b) =>
      makeBranch(b.id, b.fromId, b.toId, {
        ...b,
        ...(!b.mineTypeName && b.type && loadedTypeNames.has(b.type)
          ? { mineTypeName: b.type }
          : {}),
      })
    );
    // Пересчитываем R всех ветвей при загрузке — чтобы не использовать устаревшие кешированные значения
    const recalcedBranches = recalcAll(builtNodes, mergedBranches);
    if (data.horizons) {
      const loaded = data.horizons as Horizon[];
      // Гарантируем наличие "Общего вида" при открытии любого проекта
      const withOverview = loaded.some(h => h.id === OVERVIEW_HORIZON_ID)
        ? loaded
        : [{ id: OVERVIEW_HORIZON_ID, name: "Общий вид", z: 0, color: "var(--c-t3, #6b7280)", visible: true,
            printLayer: { visible: true, title: "Общий вид вентиляционной схемы", scale: "авто",
              orgName: "", approverTitle: "", approverName: "", year: new Date().getFullYear().toString(),
              period: "", developer: "", checker: "", sheetNum: "1", sheetTotal: "1",
              showLegend: false, showStamp: false, showApprover: false, paperFormat: "A1", orientation: "landscape" } } as Horizon,
          ...loaded];
      // Миграция: сбрасываем showLegend/showStamp/showApprover в false для всех горизонтов
      // (старые файлы могли сохранить эти значения как true)
      const migratedHorizons = withOverview.map(h => {
        if (!h.printLayer) return h;
        return {
          ...h,
          printLayer: {
            ...h.printLayer,
            showLegend: false,
            showStamp: false,
            showApprover: false,
          },
        };
      });
      setHorizons(migratedHorizons);
    }
    const loadedSymbolsRaw = (data.schemaSymbols as SchemaSymbol[]) ?? [];
    // Самолечение старых файлов: раньше импорт мог создать несколько символов
    // с ОДИНАКОВЫМ id (Date.now() совпадал для перемычек на одной ветви).
    // Дубли id ломали React-ключи и удаление символов. Переприсваиваем
    // уникальные id всем повторам.
    const seenIds = new Set<string>();
    const loadedSymbols = loadedSymbolsRaw.map((s, i) => {
      if (!s.id || seenIds.has(s.id)) {
        const uniq = `${s.id || "SYM"}_${i}_${Math.random().toString(36).slice(2, 7)}`;
        seenIds.add(uniq);
        return { ...s, id: uniq };
      }
      seenIds.add(s.id);
      return s;
    });
    // Добавляем fan-символы для ветвей у которых нет УО (старые проекты)
    const autoFanSymbols = ensureFanSymbols(mergedBranches, loadedSymbols);
    setSchemaSymbols([...loadedSymbols, ...autoFanSymbols]);

    // Миграция: если на ветви hasBulkhead=true, но нет ни одного настоящего символа перемычки
    // (только measure_station — которая раньше ошибочно входила в BULKHEAD_SYMBOL_IDS), сбрасываем флаг.
    //
    // ПЕРЕПИСАНО С КВАДРАТА НА ИНДЕКС. Раньше для КАЖДОЙ ветви делалось два
    // прохода по ВСЕМУ списку символов (.some). На схеме в 10 000 ветвей и
    // 10 000 символов это до двухсот миллионов сравнений — секунды намертво
    // занятого главного потока ровно в момент открытия. Теперь один проход по
    // символам собирает два набора id ветвей, а дальше — простая проверка.
    const branchesWithRealBulkhead = new Set<string>();
    const branchesWithMeasureStation = new Set<string>();
    for (const s of loadedSymbols) {
      if (!s.branchId) continue;
      if (BULKHEAD_SYMBOL_IDS.has(s.typeId)) branchesWithRealBulkhead.add(s.branchId);
      else if (s.typeId === "measure_station") branchesWithMeasureStation.add(s.branchId);
    }
    // Ставим ветви ОДИН раз, уже с применённой миграцией. Прежде было два
    // setBranches подряд: первый заставлял перерисовать всю схему со старыми
    // флагами, второй — тут же перерисовать её заново.
    setBranches(recalcedBranches.map(br => {
      if (!br.hasBulkhead) return br;
      if (branchesWithRealBulkhead.has(br.id)) return br;
      if (!branchesWithMeasureStation.has(br.id)) return br;
      return { ...br, hasBulkhead: false };
    }));
    if (data.mineFans) setMineFans(data.mineFans as MineFanExport[]);
    setUserPumps(Array.isArray(data.userPumps) ? (data.userPumps as PumpModel[]) : []);
    {
      const loaded = data.mineBulkheads as MineBulkheadExport[] | undefined;
      if (loaded && loaded.length > 0) {
        // Миграция: обновляем воздухопроницаемость и R из актуального каталога
        // BULKHEAD_CATALOG (по id вида "mb_<catalogId>"), чтобы исправленные
        // значения (напр. глухая деревянная A=0,01065 → R≈8,8 кМюрг) применялись
        // и к ранее сохранённым проектам. Ручные пользовательские записи (id без
        // префикса "mb_" или не найденные в каталоге) не трогаем.
        setMineBulkheads(loaded.map(mb => {
          const catId = mb.id.startsWith("mb_") ? mb.id.slice(3) : mb.id;
          const cat = BULKHEAD_CATALOG.find(c => c.id === catId);
          if (!cat) return mb;
          return {
            ...mb,
            airPermeability: cat.airPermeability,
            rMkyurg: airPermToR(cat.airPermeability) / 1000,
            failurePressure: cat.failurePressure,
          };
        }));
      } else {
        setMineBulkheads(BULKHEAD_CATALOG.map(item => ({
          id: `mb_${item.id}`,
          name: item.name,
          type: item.type,
          airPermeability: item.airPermeability,
          rMkyurg: airPermToR(item.airPermeability) / 1000, // Мюрг → кМюрг
          failurePressure: item.failurePressure,
          note: item.note,
          color: item.color,
        })));
      }
    }
    if (data.mineTypes) setMineTypes(data.mineTypes as BranchType[]);
    // Участки рудника и нормы расхода воздуха. Нормы сливаем с дефолтом —
    // в старых проектах их нет, а в новых версиях могут появиться поля.
    setVentSections(Array.isArray(data.ventSections) ? (data.ventSections as VentSection[]) : []);
    setVentNorms(data.ventNorms
      ? { ...DEFAULT_VENT_NORMS, ...(data.ventNorms as Partial<VentNorms>) }
      : DEFAULT_VENT_NORMS);
    // Пороги зон взрыва: в проектах, сохранённых до появления справочника,
    // поля нет — берётся прежний ряд, расчёт не меняется.
    // Прежнее значение по умолчанию 5,99 кПа («Аэросеть») заменяется на
    // 9 кПа — безопасное давление по Методике ВГСЧ. Заданные вручную не трогаем.
    setBlastThresholds(data.blastThresholds
      ? (() => {
          const t = { ...DEFAULT_EXPLOSION_THRESHOLDS, ...(data.blastThresholds as Partial<ExplosionThresholds>) };
          if (t.safeLimit === 5.99) t.safeLimit = DEFAULT_EXPLOSION_THRESHOLDS.safeLimit;
          return t;
        })()
      : DEFAULT_EXPLOSION_THRESHOLDS);
    // Смесь для взрывоустойчивых перемычек. В проектах, сохранённых до появления
    // расчёта толщины, полей нет — берутся значения по умолчанию.
    if (typeof data.blastMixId === "string") setBlastMixId(data.blastMixId);
    if (typeof data.blastMixCustomR === "number") setBlastMixCustomR(data.blastMixCustomR);
    setBlastDuringEmergency(data.blastDuringEmergency === true);
    if (typeof data.blastGasTimeFactual === "number") setBlastGasTimeFactual(data.blastGasTimeFactual);
    if (data.calcMode) setCalcMode(data.calcMode as "cross" | "mkr");
    // Данные ОПО. В файлах, сохранённых до появления этой вкладки, поля нет —
    // normalizeOpoData вернёт значения по умолчанию, старый проект откроется.
    setOpoData(normalizeOpoData(data.opoData));
    if (data.solverTolerance !== undefined) setSolverTolerance(data.solverTolerance as number);
    if (data.solverMaxIter !== undefined) setSolverMaxIter(data.solverMaxIter as number);
    if (data.solverAlpha !== undefined) setSolverAlpha(data.solverAlpha as number);
    if (data.surfaceTemp !== undefined) setSurfaceTemp(data.surfaceTemp as number);
    if (data.heatingSeason !== undefined) setHeatingSeason(data.heatingSeason as HeatingSeason);
    if (data.useNaturalDraft !== undefined) setUseNaturalDraft(data.useNaturalDraft as boolean);
    if (data.geoGradient !== undefined) setGeoGradient(data.geoGradient as number);
    if (data.mineAirTemp !== undefined) setMineAirTemp(data.mineAirTemp as number);
    // Влажность воздуха. В файлах старых версий этих полей нет — тогда
    // остаются значения по умолчанию (учёт влажности выключен), и расчёт
    // ведёт себя ровно как раньше.
    if (data.useHumidity !== undefined) setUseHumidity(data.useHumidity as boolean);
    else setUseHumidity(false);
    if (data.surfaceHumidity !== undefined) setSurfaceHumidity(data.surfaceHumidity as number);
    else setSurfaceHumidity(DEFAULT_SURFACE_HUMIDITY);
    if (data.mineHumidity !== undefined) setMineHumidity(data.mineHumidity as number);
    else setMineHumidity(DEFAULT_MINE_HUMIDITY);
    if (data.surfacePressure !== undefined) setSurfacePressure(data.surfacePressure as number);
    else setSurfacePressure(P_STD_KPA);
    if (data.infoConfig) setInfoConfig(data.infoConfig as InfoDisplayConfig);
    if (data.unitsConfig) setUnitsConfig(data.unitsConfig as UnitsConfig);
    if (data.branchWidth !== undefined) setBranchWidth(data.branchWidth as number);
    if (data.branchBorder !== undefined) setBranchBorder(data.branchBorder as number);
    if (data.colorByHorizon !== undefined) setColorByHorizon(data.colorByHorizon as boolean);
    else setColorByHorizon(prevColorByHorizon);
    // Режим заливки восстанавливаем из файла. Если файл сохранён СТАРОЙ версией
    // и режима в нём нет — оставляем тот, что был выбран до открытия, вместо
    // сброса в «выкл»: иначе схема открывается белой и цвета приходится
    // включать вручную при каждом открытии.
    if (data.colorMode) setColorMode(data.colorMode as "none" | "flowQ" | "velocityV" | "section" | "ventsection" | "horizon");
    else if (data.colorByHorizon) setColorMode("horizon");
    else setColorMode(prevColorMode);
    if (data.pollutionThreshold !== undefined) setPollutionThreshold(data.pollutionThreshold as number);
    else setPollutionThreshold(DEFAULT_POLLUTION_THRESHOLD);
    if (data.posColorInner !== undefined) setPosColorInner(data.posColorInner as boolean);
    else setPosColorInner(false);
    if (data.posColorOuter !== undefined) setPosColorOuter(data.posColorOuter as boolean);
    else setPosColorOuter(false);
    if (data.showPositions !== undefined) setShowPositions(data.showPositions as boolean);
    if (data.showFlowArrows !== undefined) setShowFlowArrows(data.showFlowArrows as boolean);
    if (data.flowDisplay) setFlowDisplay(data.flowDisplay as "off" | "flow" | "chevrons" | "both");
    if (data.animSpeed !== undefined) setAnimSpeed(data.animSpeed as number);
    if (data.zScale !== undefined) setZScale(data.zScale as number);
    if (data.xyScale !== undefined) setXyScale(data.xyScale as number);
    if (data.scaleLimitsEnabled !== undefined) setScaleLimitsEnabled(data.scaleLimitsEnabled as boolean);
    if (data.widthBySectionOn !== undefined) setWidthBySectionOn(data.widthBySectionOn as boolean);
    if (data.tube3dOn !== undefined) setTube3dOn(data.tube3dOn as boolean);
    if (data.scaleBranchMin !== undefined) setScaleBranchMin(data.scaleBranchMin as number);
    if (data.scaleBranchMax !== undefined) setScaleBranchMax(data.scaleBranchMax as number);
    if (data.scalePositionMin !== undefined) setScalePositionMin(data.scalePositionMin as number);
    if (data.scalePositionMax !== undefined) setScalePositionMax(data.scalePositionMax as number);
    if (data.positionGostMm !== undefined) setPositionGostMm(data.positionGostMm as number);
    if (data.bulkheadScale !== undefined) setBulkheadScale(data.bulkheadScale as number);
    if (data.fanScale !== undefined) setFanScale(data.fanScale as number);
    if (data.smokeVisThreshold !== undefined) setSmokeVisThreshold(data.smokeVisThreshold as number);
    if (data.positions) setPositions(data.positions as Position[]);
    else setPositions([]);
    if (data.textBlocks) setTextBlocks(data.textBlocks as TextBlock[]);
    else setTextBlocks([]);
    const resolvedName = fromDisk
      ? fileName
      : ((data.name as string) ?? fileName);
    setProjectFileName(resolvedName);
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    // Восстанавливаем вид ПОСЛЕ zScale/xyScale — иначе их useEffect перекроет offset
    if (data.view) {
      const v = data.view as { scale?: number; offsetX?: number; offsetY?: number; azimuth?: number; elevation?: number };
      setSavedViewToRestore(v);
    }
    // Если вида нет в файле — авто-fit по импортируемым данным
    if (!data.view) {
      setImportNonce((n) => n + 1);
    }
    // Сохраняем в список последних файлов + JSON данные для открытия по клику
    const loadedNodes = Array.isArray(data.nodes) ? (data.nodes as unknown[]).length : 0;
    const loadedBranches = Array.isArray(data.branches) ? (data.branches as unknown[]).length : 0;
    // Путь запоминаем, если он известен (десктоп: открытие из проводника,
    // «Открыть», «Сохранить как»). По нему файл откроется из списка напрямую —
    // без запроса разрешения у браузера.
    addRecentFile({
      name: resolvedName, openedAt: Date.now(),
      nodeCount: loadedNodes, branchCount: loadedBranches,
      path: filePathRef.current ?? undefined,
    });
    saveRecentData(resolvedName, data);
    setActiveRibbon("home");
  };
  applyProjectDataRef.current = applyProjectData;

  // ─── СОЗДАТЬ НОВЫЙ ПРОЕКТ ────────────────────────────────────────────
  const handleNewProject = () => {
    if (nodes.length > 0 || branches.length > 0) {
      if (!window.confirm("Создать новый проект? Все несохранённые данные будут потеряны.")) return;
    }

    // ── Топология ──
    clearAirflowCache();
    setNodes([]);
    setBranches([]);
    setSchemaSymbols([]);
    setPositions([]);
    setTextBlocks([]);

    // ── Горизонты — сброс к одному «Общий вид» ──
    setHorizons([{ id: OVERVIEW_HORIZON_ID, name: "Общий вид", z: 0, color: "var(--c-t3, #6b7280)", visible: true,
      printLayer: { visible: true, title: "Общий вид вентиляционной схемы", scale: "авто",
        orgName: "", approverTitle: "", approverName: "", year: new Date().getFullYear().toString(),
        period: "", developer: "", checker: "", sheetNum: "1", sheetTotal: "1",
        showLegend: false, showStamp: false, showApprover: false, paperFormat: "A1", orientation: "landscape" } } as Horizon]);
    setActiveHorizonId("");

    // ── Выделение и инструмент ──
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    setSelectedNodeIds(new Set());
    setSelectedBranchIds(new Set());
    setSelectedSymbolId(null);
    setSelectedSymbolIds(new Set());
    setFanSymbolBranchId(null);
    setTool("select");

    // ── Результаты расчётов ──
    setSolveResult(null);
    setNormalFlows({});
    setFireResult(null);
    setFireCalcDone(false);
    setExplosionResult(null); setExplosionResultByBranch(new Map()); setExplosionBarriers(null);
    setExplosionCalcDone(false);
    setWaterNetwork({ nodeResults: new Map(), branchResults: new Map() });
    setVcSolving(false);
    setVcError(null);
    // Предпросмотр подобранного варианта — расходы ИСЧЕЗНУВШЕЙ схемы. Оставить
    // его включённым значило бы показать новый проект чужими цифрами.
    setFireControlPreview(null);

    // ── Временные буферы ──
    setBranchParamBuffer(null);
    setSymbolClipboard(null);
    setPendingSymbol(null);
    setCtxMenu(null);

    // ── Интерфейс ──
    setActiveSide("general");
    setEditingHorizonImageId(null);
    setEditingPrintLayerId(null);
    setZLevel(0);
    setShowMultiBranchProps(false);
    setShowVentPipeDialog(false);
    setVentPipeBranchIds([]);

    // ── Настройки отображения — сброс к дефолтам ──
    setFlowColorMin(0);
    setFlowColorMax(75);
    setFlowColorHue("red");
    setThinLines(false);
    setShowFlowArrows(false);
    setFlowDisplay("off");
    setColorMode("none");
    setColorByHorizon(false);
    setBranchWidth(7);
    setBranchBorder(0.6);
    setZScale(1);
    setXyScale(1);
    setScaleLimitsEnabled(false);
    setScalePositionMin(80);
    setScalePositionMax(150);
    setPositionGostMm(13);
    setBulkheadScale(150);
    setFanScale(450);
    setPosColorInner(false);
    setPosColorOuter(false);
    setShowPositions(true);
    setInfoConfig(DEFAULT_INFO_CONFIG);
    setUnitsConfig(DEFAULT_UNITS_CONFIG);

    // ── Параметры расчёта — сброс к дефолтам ──
    setCalcMode("cross");
    setSolverTolerance(0.001);
    setSolverMaxIter(5000);
    setSolverAlpha(0.5);
    setSurfaceTemp(20);
    setUseNaturalDraft(true);
    setMineAirTemp(15);
    setGeoGradient(0);
    setHeatingSeason("winter");
    setUseHumidity(false);
    setSurfaceHumidity(DEFAULT_SURFACE_HUMIDITY);
    setMineHumidity(DEFAULT_MINE_HUMIDITY);
    setSurfacePressure(P_STD_KPA);
    // Данные ОПО — паспорт прежнего объекта не должен перейти в новый проект.
    setOpoData(makeDefaultOpoData());

    // ── Справочники — сброс к заводским значениям ──
    setMineFans([
      { catalogId: "VOD-18", name: "ВО-18/12АВР", diameter: 1.8, rpmMin: 600, rpmMax: 1500 },
    ]);
    setMineBulkheads(BULKHEAD_CATALOG.map(item => ({
      id: `mb_${item.id}`,
      name: item.name,
      type: item.type,
      airPermeability: item.airPermeability,
      rMkyurg: airPermToR(item.airPermeability) / 1000, // Мюрг → кМюрг
      failurePressure: item.failurePressure,
      note: item.note,
      color: item.color,
    })));
    setMineTypes([]);

    // ── Имя файла и вид ──
    // Новый проект — БЕЗ имени: файла ещё нет. Имя появится при первом
    // сохранении (или при открытии .vproj). Заодно снимаем флаг изменений,
    // иначе сброс состояния сам себя пометил бы как «несохранённые данные».
    setProjectFileName("");
    setIsDirty(false);
    fileHandleRef.current = null;
    filePathRef.current = null;
    setImportNonce(n => n + 1);
    setActiveRibbon("home");
  };


  // ─── КОНТЕКСТНОЕ МЕНЮ ───────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    kind: "node" | "branch" | "canvas";
    id?: string;
    x: number;
    y: number;
  } | null>(null);
  // (автопереключение правого таба при выборе объекта убрано — пользователь выбирает вкладку вручную)

  // ─── РЕСАЙЗ ЛЕВОЙ ПАНЕЛИ ────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // Формирует payload ветвей для запроса к backend/airflow.
  // Единая точка подготовки данных — используется в расчёте вентиляции и пожара.
  // ─────────────────────────────────────────────────────────────────────────
  // symbolsList — значки схемы, по которым считается сопротивление перемычек
  // и дверей. Обычно это текущие значки проекта, но подбор режима при пожаре
  // передаёт сюда ИЗМЕНЁННУЮ копию (с закрытой дверью), не трогая проект:
  // без этого параметра закрытая в варианте дверь не повлияла бы на расчёт.
  const buildBranchPayload = (
    branchesList: typeof branches,
    symbolsList: SchemaSymbol[] = schemaSymbols,
  ) => {
    const bulkheadsMap = new Map(mineBulkheads.map(mb => [mb.id, mb]));
    const curve_map = new Map(branchesList.map(b => {
      const curve = (b.hasFan && b.fanMode === "curve") ? getFanById(b.fanCurveId) : undefined;
      const k = (curve && curve.rpmNominal > 0 && b.fanRpm > 0) ? b.fanRpm / curve.rpmNominal : 1;
      // Коэффициент угла лопаток берём общей функцией — той же, что использует
      // расчёт в программе. Раньше здесь была своя копия формулы.
      const af = curve ? bladeAngleFactor(curve, b.fanBladeAngle) : 1.0;
      return [b.id, { curve, k, af }];
    }));

    return branchesList.map(b => {
      const { curve, k, af } = curve_map.get(b.id) ?? { curve: undefined, k: 1, af: 1 };
      // Сопротивление вентсооружений ветви — общей функцией (см.
      // lib/bulkheadResistance.ts), той же, что считает карту для панели
      // свойств и аварийных расчётов.
      const { total: rBulkheadsTotal } = bulkheadROfBranch(b, symbolsList, bulkheadsMap);

      // R вентиляционного окна ГВУ «Внутри перемычки»: диафрагма (окно вентсооружения).
      // R = ρ/(2·μ²·ΔS²) [Па·с²/м⁶ = кМюрг в системе расчёта], μ=0.8 — коэф. расхода окна.
      // ВАЖНО: раньше площадь окна вообще НЕ уходила в решатель (backend), поэтому окно
      // не создавало сопротивления → завышенный расход. Сверено с «АэроСеть»: ΔS=1.8 →
      // R≈0.29 кМюрг → Q≈53.6 м³/с (как в АэроСети).
      // ΔS по умолчанию = площадь рабочего колеса вентилятора (π·D²/4), если не задана.
      const fanCurveForWin = (b.hasFan && b.fanMode === "curve") ? getFanById(b.fanCurveId) : undefined;
      const autoWinA = fanCurveForWin && fanCurveForWin.diameter > 0
        ? Math.PI * fanCurveForWin.diameter * fanCurveForWin.diameter / 4 : 0;
      const winA = (b.fanWindowArea ?? 0) > 0.001 ? (b.fanWindowArea ?? 0) : autoWinA;
      const fanWindowR = (b.hasFan && (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки" && winA > 0.001)
        ? fanWindowRkMurg(winA, b.area ?? 0) : 0;

      return {
        id: b.id,
        fromId: b.fromId,
        toId: b.toId,
        R: b.resistance + rBulkheadsTotal + fanWindowR, // fanCrossingR Python добавляет сам в get_R
        area: b.area,
        angle: b.angle ?? 0,
        hasFan: b.hasFan,
        // Признак «это нить вентрубопровода (става)». Нужен расчёту, чтобы
        // отличить трубу от самой горной выработки: при нескольких ВМП на
        // одном ставе расход должен быть общим по ТРУБЕ, а обратная струя
        // по выработке в эту цепочку входить не должна.
        isVentPipe: b.isVentPipeBranch ?? false,
        fanType: b.fanType ?? "ГВУ",
        fanMode: b.fanMode,
        fanPressure: b.fanPressure,
        fanFixedQ: b.fanMode === "fixed" ? Math.max(0, b.fanFixedQ ?? 0) : 0,
        fanInstall:  b.fanInstall ?? "Внутри перемычки",
        fanCrossingR: (b.fanCrossingR ?? 0) / 1000, // Мюрг → кМюрг (для get_R в Python)
        fanReverse:  b.fanReverse ?? false,
        fanStopped:  b.fanStopped ?? false,
        fanParallel: Math.max(1, b.fanParallel ?? 1),
        fireThermalDepression: b.fireThermalDepression ?? 0,
        ...(curve ? {
          // Угол лопаток масштабирует характеристику по ОБЕИМ осям (закон
          // подобия): H(Q) = af·H_ном(Q/af). Раскрыв скобки, получаем
          // коэффициенты, которые понимает расчётный сервер:
          //   h0' = af·h0,  h1' = h1,  h2' = h2/af
          // Раньше на af умножался только h0, а h2 уходил номинальным — кривая
          // выходила слишком пологой, и вентилятор при 26 м³/с всё ещё выдавал
          // 2049 Па вместо почти нуля. Именно поэтому расчёт возвращал расход
          // выше паспортного предела.
          h0: curve.h0 * af * k * k,
          h1: curve.h1 * k,
          h2: curve.h2 / af,
          qMax: curve.qMax * af * k,
          qMin: curve.qMin * af * k,
          ...(curve.reverseH0 !== undefined ? {
            reverseH0:  curve.reverseH0 * k * k,
            reverseH1:  curve.reverseH1! * k,
            reverseH2:  curve.reverseH2!,
            reverseQMax: (curve.reverseQMax ?? curve.qMax) * k,
            reverseEfficiencyFactor: curve.reverseEfficiencyFactor,
          } : {}),
        } : {}),
      };
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Вспомогательный расчёт сети для итеративного учёта тепловой депрессии
  // пожара. Принимает branches с заполненным полем fireThermalDepression (Па)
  // и возвращает Map<branchId, Q> — расходы после пересчёта.
  // Используется исключительно внутри обработчика кнопки «Расчёт пожара».
  // ─────────────────────────────────────────────────────────────────────────
  // symbolsOverride — значки схемы для расчёта варианта подбора (с закрытой
  // дверью). Без него дверь, закрытая «на бумаге», не меняла бы сеть.
  const solveFireIteration = async (
    branchesWithFire: typeof branches,
    surfaceTempVal: number,
    hotNodeTemps?: Record<string, number>,
    symbolsOverride?: SchemaSymbol[],
  ): Promise<Map<string, number>> => {
    const reqBody = {
      method: calcMode,
      nodes: nodes.map(n => {
        // Горячие узлы пути дыма пожара: T перегрета → решатель считает
        // тепловую тягу через natural_draft_h (сбалансированный контур).
        const hotT = hotNodeTemps?.[n.id];
        // Устье, через которое ВЫХОДЯТ продукты горения, тоже считается
        // горячим. Раньше атмосферные узлы исключались (|| !n.atmosphereLink),
        // и в стволе, идущем одной ветвью прямо на поверхность, нагрев некуда
        // было записать: низ и верх ствола получали одинаковые 15°C, тяги не
        // возникало и расход при пожаре не менялся. По нормативу (прил. 2,
        // п. 2.2, форм. 2.3) горячая исходящая струя, наоборот, работает как
        // дымовая труба и увеличивает расход при восходящем проветривании.
        const isHot = hotT !== undefined;
        return {
          id: n.id,
          isAtm: n.atmosphereLink,
          // Высотная отметка для естественной тяги — МАРКШЕЙДЕРСКАЯ:
          // сдвиг узла на схеме не должен менять тягу.
          z: surveyXYZ(n).z,
          airTemp: isHot ? hotT : (n.atmosphereLink ? surfaceTempVal : (n.airTemp ?? surfaceTempVal)),
          userTemp: isHot ? true : (!n.atmosphereLink && (n.airTemp ?? 20) !== 20),
          // hotNode — признак узла пути дыма пожара. Бэкенд НЕ перетирает его
          // температуру геотермическим градиентом при включённой ест.тяге.
          hotNode: isHot,
          airHumidity: baseNodeHumidity[n.id] ?? 0,
        };
      }),
      surfaceTemp: surfaceTempVal,
      useNaturalDraft,
      geoGradient,
      useHumidity,
      surfacePressure,
      mineAirTemp,
      branches: buildBranchPayload(branchesWithFire, symbolsOverride ?? schemaSymbols),
      options: { tolerance: solverTolerance, maxIter: solverMaxIter, alpha: solverAlpha },
      // Тёплый старт: текущие расходы ветвей — стартовое приближение решателя.
      // При пожаре сеть меняется локально, поэтому расчёт сходится за единицы
      // итераций вместо тысяч (особенно важно для больших схем на МКР).
      normalFlows: Object.fromEntries(
        branchesWithFire.filter(b => Number.isFinite(b.flow)).map(b => [b.id, b.flow as number]),
      ),
    };

    const resp = await postAirflow(reqBody);
    if (!resp.ok) return new Map();
    const data = await resp.json();
    if (data.error) return new Map();
    const flowMap = new Map<string, number>();
    (data.branches as { id: string; Q: number }[]).forEach(rb => flowMap.set(rb.id, rb.Q));
    return flowMap;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ПОДБОР РЕЖИМА ПРИ ПОЖАРЕ: контекст расчёта для перебора вариантов.
  //
  // Собирает ровно те же параметры, что уходят в кнопку «Расчёт пожара», —
  // это принципиально: рекомендация обязана обещать то, что пользователь
  // увидит, применив вариант и пересчитав вручную.
  //
  // rebuild пересчитывает сопротивления после изменения дверей. Без него
  // закрытая в варианте дверь не дошла бы ни до решателя, ни до карты общей
  // депрессии, и подбор считал бы её открытой.
  // ─────────────────────────────────────────────────────────────────────────
  // Значки схемы текущего проверяемого варианта (см. rebuild ниже).
  const fireControlSymbolsRef = useRef<SchemaSymbol[]>([]);

  const buildFireControlContext = (): EvaluateContext => ({
    branches,
    nodes,
    symbols: schemaSymbols,
    fireParams: {
      ambientTemp: surfaceTemp,
      thermalDepMethod,
      smokeVisThreshold,
      baseNodeTemps,
      totalDepByBranch,
      totalRByBranch,
      // Значки варианта прокидываются в решатель — иначе изменение двери
      // не повлияет на расчёт сети.
      solveIteration: (brs, temp, hotTemps) => solveFireIteration(brs, temp, hotTemps, fireControlSymbolsRef.current),
      // Журнал при подборе молчит: это десятки расчётов, и каждый писал бы
      // в него свои итерации, погребая под собой всё остальное.
      log: () => {},
      yieldToUI: () => new Promise(r => setTimeout(r, 0)),
    },
    rebuild: (brs, syms) => {
      // Запоминаем значки варианта для solveIteration выше: runFireMode
      // прокинуть их не может — он о значках схемы ничего не знает.
      fireControlSymbolsRef.current = syms;
      const bulkheadsMap = new Map(mineBulkheads.map(mb => [mb.id, mb]));
      const totalDep = new Map<string, number>();
      // Ветви варианта получают ПОЛНОЕ сопротивление (rTotal) — при подборе
      // режима вариант как раз и меняет перемычки/двери, поэтому пожарные
      // формулы обязаны видеть их сопротивление, а не голую выработку.
      const brsWithR = brs.map(b => {
        const { total: bkR } = bulkheadROfBranch(b, syms, bulkheadsMap);
        const fanCrossingKmu = (b.hasFan && (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
          ? (b.fanCrossingR ?? 0) / 1000 : 0;
        const totalR = b.resistance + bkR + fanCrossingKmu;
        const Q = b.flow ?? 0;
        const fanH = b.hasFan ? (b.fanPressure ?? 0) : 0;
        totalDep.set(b.id, totalR * Math.abs(Q) * Q * G_ACCEL - fanH);
        return { ...b, rTotal: totalR };
      });
      return { branches: brsWithR, totalDepByBranch: totalDep };
    },
  });

  // Внести действия выбранного варианта в проект.
  // Применяются ТОЙ ЖЕ функцией, которой они проверялись при подборе, —
  // так внесённое изменение гарантированно совпадает с проверенным.
  const applyFireControlActions = (actions: FireAction[]) => {
    if (actions.length === 0) return;
    pushHistory();
    const applied = applyActions(branches, schemaSymbols, actions);
    const patchById = new Map(applied.branches.map(b => [b.id, b]));
    setBranches(prev => prev.map(b => {
      const next = patchById.get(b.id);
      return next
        ? { ...b, fanReverse: next.fanReverse, fanStopped: next.fanStopped, fanRpm: next.fanRpm }
        : b;
    }));
    setSchemaSymbols(applied.symbols);
    addLog("info", `🔥 Применён подобранный режим: ${describeActions(actions)}`);
    addLog("warn", "Выполните «Расчёт сети» (F9), затем «Расчёт пожара» — чтобы увидеть новый режим на схеме.");
  };

  // Показать вариант на схеме, ничего не меняя в проекте.
  // Расходы и задымление берутся ИЗ САМОГО ВАРИАНТА: они уже посчитаны при
  // подборе тем же расчётом пожара, и пересчитывать их заново незачем.
  const previewFireControlVariant = (v: VariantResult) => {
    setFireControlPreview({
      title: v.title,
      actions: v.actions,
      flows: v.flows,
      smoke: v.smokeByBranch,
      violations: v.violationBranchIds,
      peopleAtRisk: v.peopleAtRisk,
      peopleInSmoke: v.peopleInSmoke,
    });
    setFireControlPreviewMode("flow");
    setDepressogramHighlight([]);
    addLog("info", `👁 Предпросмотр варианта: ${v.title}. Проект не изменён.`);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ВЫГРУЗКА РЕКОМЕНДАЦИЙ В ПОЗИЦИЮ ПЛА.
  //
  // Подобранный вариант — это готовый текст мероприятий позиции плана
  // ликвидации аварий: пронумерованные действия с исполнимыми формулировками
  // и временем на каждое. Переписывать их в план руками — лишний шанс
  // ошибиться в номере вентилятора или перепутать «закрыть» с «открыть».
  //
  // Позиция создаётся НОВАЯ и привязывается к очагу пожара: так она встаёт на
  // схеме там, где авария, а не в случайном месте. Всё, что ушло в позицию,
  // берётся из варианта — здесь ничего не досчитывается.
  // ─────────────────────────────────────────────────────────────────────────
  const exportFireControlToPla = (v: VariantResult) => {
    const fireBranch = branches.find(b => b.hasFire) ?? null;
    const branchTitle = (b: TopoBranch) =>
      b.type?.trim() || `выработка ${b.id.replace(/^B/, "")}`;

    // Текст мероприятий. Заголовок отвечает на вопрос «зачем это делать»,
    // дальше — шаги по порядку, в конце — чем режим подтверждён.
    const lines: string[] = [];
    lines.push(`Режим проветривания подобран расчётом${fireBranch ? ` при пожаре в: ${branchTitle(fireBranch)}` : ""}.`);
    lines.push("");
    lines.push("Мероприятия по установлению вентиляционного режима (РД-15-11-2007, п.40):");
    v.actions.forEach((a, i) => {
      const cmd = toRdCommand(a, a.objectName ?? "", a.isMainFan ?? false);
      lines.push(`${i + 1}. «${cmd.text}»${cmd.underlineRed ? " [подчеркнуть красной чертой]" : ""}`);
      lines.push(`   Ответственные: ${cmd.responsible}. Исполнители: ${cmd.executor}. (~${a.effortMin} мин)`);
    });

    // ── Вывод людей: главная графа оперативной части (Приложение 1, гр.3) ──
    // Формулировки разные по сторонам от очага — это требование п.25, а не
    // оформление: «до очага» выводят навстречу свежей струе, «за очагом» —
    // только в изолирующих самоспасателях.
    if (v.evacActions.length > 0) {
      lines.push("");
      lines.push("Пути и время выхода людей (РД-15-11-2007, п.25):");
      v.evacActions.forEach((ea, i) => {
        const zoneTag = ea.zone === "after" ? "ЗА ОЧАГОМ" : "до очага";
        lines.push(`${i + 1}. ${ea.place} — ${ea.people} чел. [${zoneTag}], ${ea.timeMin.toFixed(0)} мин.`);
        lines.push(`   ${ea.text}`);
      });
    }

    lines.push("");
    lines.push(`Итог расчёта: не успевают выйти — ${v.peopleAtRisk}, за очагом — ${v.peopleAfterFire}, в зоне задымления — ${v.peopleInSmoke}, требуется пункт переключения — ${v.peopleNeedSwitch}.`);
    lines.push(`Опрокинутых струй: ${v.reversedBranches}. Общее время на исполнение: ~${v.effortMin} мин.`);
    if (v.velocityViolations > 0) {
      lines.push(`ВНИМАНИЕ: в ${v.velocityViolations} выработках скорость воздуха выше допустимой — режим требует обоснования.`);
    }
    // Замечания по соответствию РД — основание утвердить режим или нет.
    if (v.rdNotes.length > 0) {
      lines.push("");
      lines.push("Соответствие РД-15-11-2007:");
      v.rdNotes.forEach(n => {
        const mark = (n.kind === "required" || n.kind === "violation") ? "ВНИМАНИЕ" : "Справочно";
        lines.push(`— ${mark} (${n.clause}): ${n.text}`);
      });
    }
    const text = lines.join("\n");

    // Выработки позиции: те, где выполняются действия, плюс сама аварийная.
    const branchIds = Array.from(new Set([
      ...(fireBranch ? [fireBranch.id] : []),
      ...v.actions.map(a => a.branchId).filter(Boolean),
    ]));

    // Место маркера: рядом с узлом очага. Без координат позиция легла бы
    // в начало координат, и её пришлось бы искать по всей схеме.
    const anchorNode = fireBranch
      ? (nodes.find(n => n.id === fireBranch.fromId) ?? nodes.find(n => n.id === fireBranch.toId) ?? null)
      : null;
    const OFFSET = 50;

    const nextNumber = positions.reduce((m, p) => Math.max(m, p.number), 0) + 1;
    const pos = makePosition({
      number: nextNumber,
      name: v.actions.length > 0 ? v.title : "Режим без изменений",
      scenario: fireBranch ? `Пожар: ${branchTitle(fireBranch)}` : "Пожар",
      accidentType: "Пожар",
      // Реверс вентилятора в мероприятиях — это реверсивная позиция плана.
      positionType: v.actions.some(a => a.kind === "fan_reverse") ? "reverse" : "normal",
      ventMode: "Аварийный режим",
      comment: text,
      branchIds,
      leaderBranchId: fireBranch?.id ?? null,
      leaderT: fireBranch?.fireT ?? 0.5,
      x: anchorNode ? anchorNode.x + OFFSET : 0,
      y: anchorNode ? anchorNode.y + OFFSET : 0,
      z: anchorNode ? anchorNode.z : 0,
      placed: !!anchorNode,
      // Тот же текст — отдельным файлом позиции: его можно выгрузить и
      // вставить в документ плана, не переписывая с экрана.
      attachedFile: `Мероприятия поз. ${nextNumber}.txt`,
      attachedFileMime: "text/plain",
      attachedFileData: "data:text/plain;charset=utf-8;base64,"
        + btoa(String.fromCharCode(...new TextEncoder().encode(text))),
    });

    pushHistory();
    setPositions(prev => [...prev, pos]);
    setSelectedPositionId(pos.id);
    setActiveSide("positions");
    setShowPositions(true);
    setShowFireControl(false);
    closeFireControlPreview();
    addLog("info", `📍 Создана позиция ПЛА №${nextNumber}: ${pos.name}`);
    if (!anchorNode) {
      addLog("warn", "Очаг пожара не найден — позиция создана без привязки к месту. Разместите её на схеме вручную.");
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // БАТЧ-расчёт пожара: все сценарии одного раунда — ОДНИМ запросом.
  // scenarios = [{ id: targetBranchId, thermalDepression: Па }].
  // Базовая сеть (branches с актуальными расходами) отправляется один раз,
  // сервер накладывает депрессию пожара на целевую ветвь каждого сценария и
  // пересчитывает. Возвращает Map<targetId, Map<branchId, Q>>.
  // Это заменяет сотни последовательных запросов одним.
  // ─────────────────────────────────────────────────────────────────────────
  // Сценарий батч-расчёта пожара. hotNodeTemps — температуры узлов пути дыма:
  // по ним решатель считает тепловую тягу замкнутым контуром (natural_draft_h).
  type FireScenario = {
    id: string;
    thermalDepression: number;
    hotNodeTemps?: Record<string, number>;
  };

  const solveFireBatch = async (
    baseBranches: typeof branches,
    scenarios: FireScenario[],
    surfaceTempVal: number,
  ): Promise<Map<string, Map<string, number>>> => {
    const out = new Map<string, Map<string, number>>();
    if (scenarios.length === 0) return out;
    const reqBody = {
      method: calcMode,
      nodes: nodes.map(n => ({
        id: n.id,
        isAtm: n.atmosphereLink,
        // Маркшейдерская отметка (см. выше)
        z: surveyXYZ(n).z,
        airTemp: n.atmosphereLink ? surfaceTempVal : (n.airTemp ?? surfaceTempVal),
        userTemp: !n.atmosphereLink && (n.airTemp ?? 20) !== 20,
        airHumidity: baseNodeHumidity[n.id] ?? 0,
      })),
      surfaceTemp: surfaceTempVal,
      useNaturalDraft,
      geoGradient,
      useHumidity,
      surfacePressure,
      mineAirTemp,
      branches: buildBranchPayload(baseBranches),
      options: { tolerance: solverTolerance, maxIter: solverMaxIter, alpha: solverAlpha },
      // Тёплый старт для каждого сценария: расходы базовой сети как приближение.
      normalFlows: Object.fromEntries(
        baseBranches.filter(b => Number.isFinite(b.flow)).map(b => [b.id, b.flow as number]),
      ),
      scenarios,
    };
    const resp = await postAirflow(reqBody);
    if (!resp.ok) return out;
    const data = await resp.json();
    if (data.error || !data.scenarios) return out;
    (data.scenarios as { id: string; branches: { id: string; Q: number }[] }[]).forEach(sc => {
      const m = new Map<string, number>();
      sc.branches.forEach(rb => m.set(rb.id, rb.Q));
      out.set(sc.id, m);
    });
    return out;
  };

  // ── Факт опрокидывания для Акта устойчивости ──────────────────────────────
  // Ставит очаг пожара на КАЖДУЮ ветвь с пожарной нагрузкой (мощность из
  // пожарной нагрузки), задаёт тепловую депрессию и пересчитывает сеть.
  // Сравнивает знак расхода до/после — это и есть фактическое опрокидывание,
  // тот же принцип, что в аварийном режиме (actuallyReversed).
  const computeFireStabilityFacts = async (
    ambientTemp: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, FireStabilityFact>> => {
    const facts = new Map<string, FireStabilityFact>();
    const loaded = branches.filter(b =>
      b.fireLoadTech || b.fireLoadConveyor || b.fireLoadCable || b.fireLoadWoodSupport);
    if (loaded.length === 0) return facts;
    onProgress?.(0, loaded.length);

    const originalFlows = new Map<string, number>(branches.map(b => [b.id, b.flow ?? 0]));

    // Для КАЖДОЙ нагруженной ветви моделируем ОТДЕЛЬНЫЙ сценарий пожара —
    // ровно так же, как при ручной установке очага (аварийный режим):
    //   • очаг ставится ТОЛЬКО на эту ветвь;
    //   • сеть пересчитывается ИТЕРАТИВНО (до сходимости расхода), при этом
    //     на каждой итерации T_пр и h_t уточняются по актуальному расходу
    //     (расход при пожаре падает → температура растёт).
    //
    // БАТЧ: раньше каждая ветвь слала свой запрос (N×4 запросов подряд —
    // минуты ожидания). Теперь все сценарии одного раунда считаются ОДНИМ
    // запросом (solveFireBatch), поэтому весь расчёт — максимум 4 запроса
    // независимо от числа ветвей. Математика (T→h_t, релаксация, критерий
    // сходимости) — та же, что была.
    const FIRE_ITERS = 4;
    const FIRE_Q_TOL = 0.3;

    // Состояние каждого сценария ведём параллельно.
    type ScState = {
      target: typeof loaded[number];
      flows: Map<string, number>;
      firePower: number; fireTemp: number; thermalDep: number;
      // Опрокидывание подтверждено на предыдущем раунде: знак расхода очага
      // устойчиво сменился. Нужно, чтобы горячий плюм пошёл по НОВОМУ
      // направлению и разогнал реверсивную струю, а не душил её.
      reversedConfirmed: boolean;
      done: boolean;
    };
    const states: ScState[] = loaded.map(target => ({
      target,
      flows: new Map(originalFlows),
      firePower: 0, fireTemp: ambientTemp, thermalDep: 0,
      reversedConfirmed: false,
      done: false,
    }));

    // Прогресс отражает РАУНДЫ итераций (каждый раунд = один пересчёт сети —
    // это и есть основная работа). Раньше прогресс считал только сошедшиеся
    // ветви, а они сходятся все разом на последнем раунде → шкала «0 из N»
    // висела до самого конца. Теперь шкала честно растёт по мере расчёта.
    for (let iter = 0; iter < FIRE_ITERS; iter++) {
      const active = states.filter(s => !s.done);
      if (active.length === 0) break;
      // Начало раунда: показываем прогресс по пройденным раундам (0..1),
      // масштабируя на общее число ветвей, чтобы шкала двигалась плавно.
      onProgress?.(Math.round((iter / FIRE_ITERS) * loaded.length), loaded.length);
      await new Promise(r => setTimeout(r, 0));

      // 1) Пересчитываем T_пр и h_t по актуальному расходу каждого сценария.
      const scenarios: FireScenario[] = [];
      for (const s of active) {
        const target = s.target;
        // Расходы: мощность очага — по ШТАТНОМУ (тепловыделение техники не
        // должно разгоняться вентиляцией), температура — по ФАКТИЧЕСКОМУ, но не
        // ниже половины штатного (та же логика, что в аварийном расчёте).
        // Раньше и мощность, и T считались по текущему расходу без нижней
        // границы — на схлопнувшейся ветви T взлетала и давала ложное
        // опрокидывание, а на выросшей — расходилась с аварийным расчётом.
        const qOrig0   = Math.abs(originalFlows.get(target.id) ?? target.flow ?? 0);
        const qActual0 = Math.abs(s.flows.get(target.id) ?? target.flow ?? 0);
        const airQ0 = qOrig0 > 0 ? Math.max(qActual0, 0.5 * qOrig0) : qActual0;
        s.firePower = calcBranchFirePower(target, qOrig0 > 0 ? qOrig0 : airQ0);
        s.fireTemp  = calcFireTemp(s.firePower, airQ0, ambientTemp);
        const fromN = nodes.find(n => n.id === target.fromId);
        const toN   = nodes.find(n => n.id === target.toId);
        const dz = (toN?.z ?? 0) - (fromN?.z ?? 0);
        const geomAngle = Math.abs(target.angle ?? 0) * Math.sign(dz || 1);
        // Знак угла относительно направления потока: восходящее проветривание
        // (воздух идёт вверх) устойчиво — тепловая тяга помогает потоку.
        // Направление берём по ШТАТНОМУ (дожаровому) расходу, а не по текущему
        // итерационному: иначе уже опрокинутый поток «подтверждал» бы сам себя.
        const dirFlow = originalFlows.get(target.id) ?? target.flow ?? 0;
        const flowSignA = dirFlow >= 0 ? 1 : -1;
        const flowRelAngle = geomAngle * flowSignA;
        // x — расстояние от очага до устья ПО ХОДУ струи: задаёт высоту столба
        // горячих газов, поэтому очаг у входа и у выхода дают разную депрессию.
        const fireTpos = target.fireT ?? 0.5;
        const mouthDist = (target.length ?? 0) * (flowSignA >= 0 ? (1 - fireTpos) : fireTpos);
        s.thermalDep = calcThermalDepressionUnified({
          fireTemp_C: s.fireTemp, ambientTemp_C: ambientTemp,
          length_m: target.length, angle_deg: flowRelAngle,
          airFlow_m3s: airQ0, sectionArea_m2: target.area,
          distanceToMouth_m: mouthDist,
          // Высота теплового столба не может превышать перепад отметок концов
          // выработки — иначе нормативная зона горения (до 260 м) даёт столб
          // выше самой ветви и завышает депрессию в разы.
          elevationDrop_m: Math.abs(dz),
        }, thermalDepMethod);
        // Температура источника плюма по выбранному методу («Норматив 4.5» → Tм
        // из геометрии, «Методика» → реальная T_пр) — чтобы факты устойчивости
        // совпадали с аварийным расчётом.
        const T_src = fireSourceTempForMethod({
          physicalFireTemp_C: s.fireTemp, ambientTemp_C: ambientTemp,
          angle_deg: flowRelAngle, airFlow_m3s: airQ0, sectionArea_m2: target.area,
        }, thermalDepMethod);
        // Модель тяги — та же, что в аварийном режиме (см. fireModeRun.ts):
        //  • «Норматив (4.5)» — СОСРЕДОТОЧЕННЫЙ источник h_т на ветви очага
        //    (как в ПО «Вентиляция»): зависит от положения очага в ветви;
        //  • «Методика» — РАСПРЕДЕЛЁННАЯ через температуры узлов пути дыма.
        // Одновременно применять нельзя — тяга учлась бы дважды. Бэкенд берёт
        // thermalDepression только когда hotNodeTemps пуст, поэтому при
        // нормативном методе карту узлов не передаём вовсе.
        const useNormativeSeat = thermalDepMethod === "normative";
        const branchesForHot = branches.map(b => ({ id: b.id, fromId: b.fromId, toId: b.toId, flow: s.flows.get(b.id) ?? b.flow, length: b.length, area: b.area, perimeter: b.perimeter }));
        const hotNodeTemps = useNormativeSeat ? undefined : computeHotNodeTemps(
          [{ id: target.id, fromId: target.fromId, toId: target.toId, fireTemp: T_src, flow: s.flows.get(target.id) ?? target.flow ?? 0, originalFlow: originalFlows.get(target.id) ?? target.flow ?? 0, reversedConfirmed: s.reversedConfirmed, length: target.length, area: target.area, perimeter: target.perimeter }],
          branchesForHot, ambientTemp, baseNodeTemps,
        );
        // Знак: s.thermalDep посчитан ОТНОСИТЕЛЬНО ПОТОКА, а решателю источник
        // нужен в ориентации ветви from→to.
        const seatDep = useNormativeSeat ? s.thermalDep * flowSignA : s.thermalDep;
        scenarios.push({ id: target.id, thermalDepression: seatDep, hotNodeTemps });
      }

      // 2) Один запрос на весь раунд. Базовая сеть — с расходами первого
      //    сценария (расходы влияют только на стартовое приближение решателя,
      //    результат от него не зависит — важна лишь топология и R).
      const baseBranches = branches.map(b => ({ ...b, flow: active[0].flows.get(b.id) ?? b.flow }));
      const results = await solveFireBatch(baseBranches, scenarios, ambientTemp);
      if (results.size === 0) break;

      // 3) Обновляем расходы каждого сценария + проверяем сходимость.
      for (const s of active) {
        const newFlows = results.get(s.target.id);
        if (!newFlows || newFlows.size === 0) { s.done = true; continue; }
        const qPrevTgt = s.flows.get(s.target.id) ?? 0;
        const qNewTgt  = newFlows.get(s.target.id) ?? 0;
        const signFlipped = Math.sign(qPrevTgt || 1) !== Math.sign(qNewTgt || 1);
        const unstable = signFlipped || Math.abs(qNewTgt) < Math.abs(qPrevTgt) * 0.5;
        // Фиксируем опрокидывание относительно ШТАТНОГО направления: со второго
        // раунда плюм пойдёт по новому направлению и разгонит реверсивную струю.
        const qOrigTgt = originalFlows.get(s.target.id) ?? 0;
        if (Math.sign(qOrigTgt || 1) !== Math.sign(qNewTgt || 1) && Math.abs(qNewTgt) > 0.05) {
          s.reversedConfirmed = true;
        }
        // При смене знака НЕ релаксируем: усреднение «прежний + половина нового»
        // держит расход у нуля (8 м³/с вместо 57) и мешает струе развернуться.
        // Гасим только обеднение потока без разворота.
        const relax = (iter === 0 || !unstable || signFlipped) ? 1.0 : 0.5;

        let maxDQ = 0;
        const nextFlows = new Map<string, number>();
        newFlows.forEach((q, id) => {
          const prev = s.flows.get(id) ?? 0;
          const val = relax >= 1 ? q : prev + relax * (q - prev);
          nextFlows.set(id, val);
          maxDQ = Math.max(maxDQ, Math.abs(val - prev));
        });
        s.flows = nextFlows;
        if (maxDQ < FIRE_Q_TOL) s.done = true;
      }
      // Конец раунда: берём максимум из «пройдено раундов» и «сошлось ветвей»,
      // чтобы шкала двигалась плавно и никогда не откатывалась назад.
      const byRounds  = Math.round(((iter + 1) / FIRE_ITERS) * loaded.length);
      const byBranches = states.filter(s => s.done).length;
      onProgress?.(Math.min(loaded.length, Math.max(byRounds, byBranches)), loaded.length);
      await new Promise(r => setTimeout(r, 0));
    }

    for (const s of states) {
      const orig = originalFlows.get(s.target.id) ?? 0;
      const now  = s.flows.get(s.target.id) ?? orig;
      // Восходящее (по штатному потоку) проветривание устойчиво: пожар не может
      // его опрокинуть (как в Аэросети). Численный переворот знака на обеднённой
      // ветви — артефакт, гасим его для восходящих выработок.
      const fromN = nodes.find(n => n.id === s.target.fromId);
      const toN   = nodes.find(n => n.id === s.target.toId);
      const dz2 = (toN?.z ?? 0) - (fromN?.z ?? 0);
      const geomAngle2 = Math.abs(s.target.angle ?? 0) * Math.sign(dz2 || 1);
      const flowRelAngle2 = geomAngle2 * (orig >= 0 ? 1 : -1);
      // Порог значимости — общий с аварийным режимом (isSignificantReversal):
      // встречный поток в сотые доли м³/с это шум увязки, а не опрокидывание.
      const rawReversed = isSignificantReversal(orig, now);
      const reversed = flowRelAngle2 > 1 ? false : rawReversed;
      facts.set(s.target.id, {
        reversed,
        fireFlow: Math.abs(now),
        firePower: s.firePower,
        fireTemp: s.fireTemp,
        thermalDep: Math.abs(s.thermalDep),
      });
    }
    onProgress?.(loaded.length, loaded.length);
    return facts;
  };

  // Запуск «ползущего» индикатора: быстро до 60%, затем всё медленнее к 90%,
  // чтобы пользователь видел активность, пока ждём ответ сервера.
  const startSolveProgress = () => {
    if (solveProgressTimer.current) window.clearInterval(solveProgressTimer.current);
    setSolveProgress(8);
    solveProgressTimer.current = window.setInterval(() => {
      setSolveProgress(p => {
        const cur = p ?? 8;
        if (cur >= 90) return 90;              // упираемся в 90% до ответа
        const step = cur < 60 ? 7 : cur < 80 ? 3 : 1; // замедляемся к концу
        return Math.min(90, cur + step);
      });
    }, 200);
  };
  const finishSolveProgress = () => {
    if (solveProgressTimer.current) { window.clearInterval(solveProgressTimer.current); solveProgressTimer.current = null; }
    setSolveProgress(100);
    window.setTimeout(() => setSolveProgress(null), 400);
  };

  // Плавная шкала «Расчёт пожара» — как в воздухораспределении. Расчёт состоит
  // из нескольких пересчётов сети (блокирующих), точный процент недоступен,
  // поэтому шкала непрерывно «ползёт» к ~95% таймером, а по завершении — 100%.
  const startFireProgress = () => {
    if (fireProgressTimer.current) window.clearInterval(fireProgressTimer.current);
    setFireCalcProgress(5);
    fireProgressTimer.current = window.setInterval(() => {
      setFireCalcProgress(p => {
        const cur = p ?? 5;
        if (cur >= 95) return 95;                         // упираемся в 95% до конца
        const step = cur < 50 ? 4 : cur < 80 ? 2 : 1;     // замедляемся к концу
        return Math.min(95, cur + step);
      });
    }, 200);
  };
  const finishFireProgress = () => {
    if (fireProgressTimer.current) { window.clearInterval(fireProgressTimer.current); fireProgressTimer.current = null; }
    setFireCalcProgress(100);
    window.setTimeout(() => setFireCalcProgress(null), 400);
  };

  /**
   * Выделяет проблемный участок и центрирует на нём схему.
   * Приоритет — узел: именно он «оторван» от сети, а ветвь лишь примыкает.
   * Если узла в списке нет (например, изолированы только ветви), центрируем
   * по первой ветви.
   */
  /** Показать горизонты, на которых лежат ветви (иначе камера смотрит в пустоту). */
  const revealBranchHorizons = (branchIds: string[]) => {
    const ids = new Set(branchIds);
    const need = new Set<string>();
    for (const b of branches) if (ids.has(b.id) && b.horizonId) need.add(b.horizonId);
    if (need.size === 0) return;
    setHorizons(prev => prev.some(h => need.has(h.id) && !h.visible)
      ? prev.map(h => (need.has(h.id) && !h.visible) ? { ...h, visible: true } : h)
      : prev);
  };

  // Точка вентсооружения на ветви: по значку перемычки (доля t вдоль ветви),
  // иначе null — тогда центрируется середина выработки.
  bulkheadFocusPosRef.current = (branchId: string) => {
    const sym = schemaSymbols.find(sm => sm.branchId === branchId && BULKHEAD_SYMBOL_IDS.has(sm.typeId));
    if (!sym) return null;
    const br = branches.find(b => b.id === branchId);
    const fN = br ? nodesById.get(br.fromId) : undefined;
    const tN = br ? nodesById.get(br.toId) : undefined;
    if (!fN || !tN) return null;
    const t = sym.t ?? 0.5;
    return { x: fN.x + (tN.x - fN.x) * t, y: fN.y + (tN.y - fN.y) * t, z: fN.z + (tN.z - fN.z) * t };
  };

  const focusSolveBlocker = (nodeIds: string[], branchIds: string[], focus?: { x: number; y: number; z: number }) => {
    // Участок может лежать на скрытом горизонте — тогда центрировать вид
    // бессмысленно, пользователь увидит пустое место. Включаем видимость
    // горизонтов, к которым относятся проблемные ветви.
    const nodeIdSet = new Set(nodeIds);
    const needHorizons = new Set<string>();
    for (const b of branches) {
      if (!b.horizonId) continue;
      if (branchIds.includes(b.id) || nodeIdSet.has(b.fromId) || nodeIdSet.has(b.toId)) {
        needHorizons.add(b.horizonId);
      }
    }
    if (needHorizons.size > 0) {
      setHorizons(prev => prev.map(h =>
        (needHorizons.has(h.id) && !h.visible) ? { ...h, visible: true } : h));
    }

    setSelectedNodeIds(new Set(nodeIds));
    setSelectedBranchIds(new Set(branchIds));
    const firstNode = nodeIds.length > 0 ? nodes.find(n => n.id === nodeIds[0]) : undefined;
    if (firstNode) {
      setSelectedNodeId(firstNode.id);
      setSelectedBranchId(branchIds[0] ?? null);
      setFocusBranchId(null);
      setFocusNodeId(null);
      setFocusPos({ x: firstNode.x, y: firstNode.y, z: firstNode.z });
    } else if (branchIds.length > 0) {
      setSelectedNodeId(null);
      setSelectedBranchId(branchIds[0]);
      setFocusNodeId(null);
      // Точка проблемы (например, место пересечения) — центрируем именно её
      setFocusPos(focus ?? null);
      setFocusBranchId(branchIds[0]);
    } else {
      return;
    }
    setFocusNonce(Date.now());
  };

  // Расчёт воздухораспределения (Кросс или МКР)
  const handleSolveLocal = async () => {
    setVcSolving(true);
    startSolveProgress();
    setVcError(null);
    // Штатный расчёт сети = НЕаварийный режим. Чистим «пожарные» температуры и
    // концентрации в узлах, оставшиеся от прошлого расчёта пожара, — иначе в
    // свойствах узлов после обычного расчёта висят 596°C и CO от аварии.
    resetNodeFireState();
    const methodName = calcMode === "cross" ? "Кросс" : "МКР";
    addLog("info", `Запуск расчёта: метод ${methodName}, узлов ${nodes.length}, ветвей ${branches.length}`);
    const zeroR = branches.filter(b => b.resistance <= 0);
    if (zeroR.length > 0) addLog("warn", `R=0 у ${zeroR.length} ветвей: ${zeroR.slice(0, 5).map(b => `${b.id}(L=${b.length.toFixed(0)},S=${b.area.toFixed(1)},P=${b.perimeter.toFixed(1)})`).join(", ")}${zeroR.length > 5 ? "..." : ""}`);
    const atmNodes = nodes.filter(n => n.atmosphereLink);
    addLog("info", `Атм. узлов=${atmNodes.length}: ${atmNodes.map(n => n.id).join(", ")}`);
    // Подогрев воздуха работающими калориферами. Температуры считаются по
    // расходам ПРОШЛОГО расчёта и уходят в решатель как заданные: подогретый
    // воздух легче, поэтому калорифер влияет на естественную тягу.
    // Если калориферы выключены (или лето) — подогрева нет, температуры
    // возвращаются к базовым автоматически.
    const htRes = calcHeaterTemps();
    const htTemps = htRes.temps;
    const htActive = htRes.info.filter(h => h.dt > 0);
    if (htActive.length > 0) {
      addLog("info", `Калориферы (${heatingSeason === "winter" ? "зима" : "лето"}): работают ${htActive.length} шт.`);
      htActive.forEach(h => {
        addLog("info", `  Калорифер на ветви ${h.branchId}: N=${h.power.toFixed(1)} кВт, Δt=+${h.dt.toFixed(1)}°C, t за калорифером ${h.outTemp.toFixed(1)}°C`);
        if (!h.meetsNorm) {
          addLog("warn", `  ⚠ Ветвь ${h.branchId}: температура за калорифером ${h.outTemp.toFixed(1)}°C ниже нормативных +${MIN_SHAFT_TEMP_C}°C`);
        }
      });
    }
    try {
      const requestBody = {
          method: calcMode,
          nodes: nodes.map(n => {
            const baseT = n.atmosphereLink ? surfaceTemp : (n.airTemp ?? surfaceTemp);
            const heatedT = htTemps.get(n.id);
            // Подогрев применяем только если он реально есть (иначе базовая T)
            const useT = (heatedT !== undefined && heatedT > baseT + 0.05) ? heatedT : baseT;
            return {
              id: n.id,
              isAtm: n.atmosphereLink,
              // Высотная отметка для естественной тяги — МАРКШЕЙДЕРСКАЯ:
          // сдвиг узла на схеме не должен менять тягу.
          z: surveyXYZ(n).z,
              // userTemp=true — температура задана (вручную или калорифером)
              airTemp: useT,
              userTemp: (!n.atmosphereLink && (n.airTemp ?? 20) !== 20) || useT !== baseT,
              // Влажность узла, % — для плотности по форм. 9.2. При выключенном
              // учёте здесь 0, и формула вырождается в сухой воздух (9.1).
              airHumidity: baseNodeHumidity[n.id] ?? 0,
            };
          }),
          surfaceTemp,
          useNaturalDraft,
          geoGradient,
          mineAirTemp,
          useHumidity,
          surfacePressure,
          branches: buildBranchPayload(branches),
          options: {
            tolerance: solverTolerance,
            maxIter: solverMaxIter,
            alpha: solverAlpha,
          },
          ...(branches.some(b => b.fanReverse) && Object.keys(normalFlows).length > 0
            ? { normalFlows }
            : {}),
      };
      // Схема и настройки расчёта не изменились с прошлого раза → postAirflow
      // отдаст сохранённый результат мгновенно, не обращаясь к серверу
      // (общая память расчётов, см. airflowCache в начале файла).
      const fromCache = wasAirflowCached(requestBody);
      if (fromCache) addLog("info", "Схема не изменилась — показан результат прошлого расчёта");

      const resp = await postAirflow(requestBody);
      const data = await resp.json();

      if (!resp.ok || data.error) {
        // Сервер отказал из-за лицензии — показываем понятную причину и
        // открываем окно активации, а не сухой код ошибки.
        if (resp.status === 403 && data.error === "license_required") {
          const msg = data.message || "Расчёт доступен только в полной версии";
          setVcError(msg);
          addLog("error", msg);
          setShowLicenseDialog(true);
          return;
        }
        const msg = data.error || "Ошибка расчёта";
        setVcError(msg);
        addLog("error", msg);
        return;
      }

      // Пишем лог из бэкенда
      if (data.log?.length) {
        (data.log as string[]).forEach(line => addLog("info", line));
      }

      // Отметка, что расчёт выполнен на аварийном резервном сервере.
      // При показе из памяти запроса к серверу не было — сообщение не пишем.
      if (!fromCache && isOnBackup()) {
        addLog("warn", "Расчёт выполнен на аварийном резервном сервере");
      }

      // Применяем результат
      const resultBranches = data.branches as { id: string; Q: number; velocity: number; H: number; Hfan?: number; isDead?: boolean }[];
      // Результаты индексируем по id ОДИН раз. Раньше здесь для каждой выработки
      // заново перебирался весь список результатов — на схеме в 14 тысяч ветвей
      // это давало почти секунду задержки после каждого расчёта.
      const rbById = new Map(resultBranches.map(r => [r.id, r]));
      setBranches(prev => prev.map(b => {
        const rb = rbById.get(b.id);
        if (!rb) return b;

        let newFanPressure = b.fanPressure;
        let newFanEfficiency = b.fanEfficiency;
        let newFanShaftPower = b.fanShaftPower;
        let newPower = b.power;

        if (b.hasFan && rb.Hfan !== undefined) {
          newFanPressure = rb.Hfan;

          if (b.fanMode === "curve") {
            const curve = getFanById(b.fanCurveId);
            if (curve) {
              const N = Math.max(1, b.fanParallel ?? 1);
              // k — масштаб оборотов (Q-ось кривой η линейна по n)
              const k = (b.fanRpm > 0 && curve.rpmNominal > 0) ? b.fanRpm / curve.rpmNominal : 1;
              // Q через один вентилятор, в координатах номинальных оборотов
              const Q_one_nominal = Math.abs(rb.Q) / N / k;
              const etaBase = fanEfficiency(curve, Q_one_nominal);
              const effFactor = b.fanReverse ? (curve.reverseEfficiencyFactor ?? 0.82) : 1;
              newFanEfficiency = Math.max(0.05, etaBase * effFactor);
              // Мощность установки: Hfan суммарный (N·H(Q/N)) → мощность = H(Q/N)·Q_total/η
              // = (Hfan/N)·Q_total/η. Делим на N, т.к. Hfan уже умножен на N.
              newFanShaftPower = fanShaftPower(Math.abs(rb.Hfan) / N, Math.abs(rb.Q), newFanEfficiency);
              newPower = newFanShaftPower;
            }
          } else {
            // constant mode: КПД задаётся вручную, мощность = H * Q_total / η
            const eta = b.fanEfficiency > 0 ? b.fanEfficiency : 0.65;
            newFanShaftPower = fanShaftPower(Math.abs(rb.Hfan), Math.abs(rb.Q), eta);
            newPower = newFanShaftPower;
          }
        }

        return {
          ...b,
          flow: rb.Q,
          velocity: rb.velocity,
          dP: rb.H,
          // H сервера посчитан по ПОЛНОМУ R ребра (выработка + перемычка/окно +
          // окно ГВУ) — это и есть общая депрессия ветви. Сохраняем отдельно,
          // т.к. локальный пересчёт (recalcBranchAero) знает только R выработки.
          dPTotal: rb.H,
          isDead: rb.isDead ?? false,
          fanPressure: newFanPressure,
          fanEfficiency: newFanEfficiency,
          fanShaftPower: newFanShaftPower,
          power: newPower,
        };
      }));

      // Применяем давления в узлах из результата расчёта
      if (data.nodes && Array.isArray(data.nodes) && data.nodes.length > 0) {
        const nodePressures = new Map<string, { computedPressure: number; computedFanPressure: number }>(
          (data.nodes as { id: string; computedPressure: number; computedFanPressure: number }[])
            .map(n => [n.id, { computedPressure: n.computedPressure, computedFanPressure: n.computedFanPressure }])
        );
        setNodes(prev => prev.map(n => {
          const p = nodePressures.get(n.id);
          return p !== undefined ? { ...n, computedPressure: p.computedPressure, computedFanPressure: p.computedFanPressure } : n;
        }));
      }

      // Расчётные температуры узлов с учётом подогрева калориферами.
      // Калориферы выключены / лето → htTemps = базовые температуры, поэтому
      // подогрев прошлого расчёта СБРАСЫВАЕТСЯ сам, без отдельной кнопки.
      setNodes(prev => prev.map(n => {
        const t = htTemps.get(n.id) ?? surfaceTemp;
        return { ...n, computedAirTemp: t, computedWallTemp: t };
      }));

      // ── Проверка вентставов по паспортному рабочему давлению рукава ──
      // Депрессия нити не должна превышать предел марки, иначе рукав раздувает
      // и рвёт по сварному шву. Считаем по всей нити между её концами.
      (() => {
        const dpById = new Map(resultBranches.map(rb => [rb.id, Math.abs(rb.H ?? 0)]));
        const byBrand = new Map<string, { limit: number; dp: number; count: number }>();
        for (const b of branches) {
          if (!b.hasVentPipe || !b.vpBrandId || !(b.vpWorkPressure ?? 0)) continue;
          const key = `${b.vpBrandId}__${b.vpDiameter}`;
          const cur = byBrand.get(key) ?? { limit: b.vpWorkPressure ?? 0, dp: 0, count: 0 };
          cur.dp += dpById.get(b.id) ?? 0;
          cur.count += 1;
          byBrand.set(key, cur);
        }
        byBrand.forEach((v, key) => {
          const [bid, dia] = key.split("__");
          const brandName = VENT_DUCT_BRANDS.find(x => x.id === bid)?.name ?? bid;
          if (v.dp > v.limit) {
            addLog("warn", `⚠ Вентстав ${brandName} Ø${dia} мм: давление ${v.dp.toFixed(0)} Па превышает паспортный предел ${v.limit} Па`);
          }
        });
      })();

      // ── Проверка доставки воздуха в забой по вентставу (нагнетание) ──
      // Вентилятор подаёт в став один расход, а до забоя доходит меньше:
      // часть воздуха теряется через стыки и мембрану рукава. Проверяем,
      // хватает ли того, что реально дошло, и не длиннее ли став предела.
      (() => {
        const qById = new Map(resultBranches.map(rb => [rb.id, Math.abs(rb.Q ?? 0)]));
        for (const b of branches) {
          if (!b.hasVentPipe || !(b.vpLength ?? 0)) continue;
          const brand = VENT_DUCT_BRANDS.find(x => x.id === b.vpBrandId);
          const size = brand?.sizes.find(sz => sz.diameter === b.vpDiameter);
          const fanFlow = qById.get(b.id) ?? 0;
          if (fanFlow < 0.01) continue;

          const inp = {
            method: (b.vpLeakMethod ?? "passport") as VpLeakMethod,
            diameter: b.vpDiameter ?? 0,
            alpha: brand?.alpha ?? b.vpPipeAlpha ?? 0,
            lossPer100m: size?.lossPer100m ?? b.vpLeakageCoeff ?? 0,
            linkLength: b.vpLinkLength ?? 20,
            jointCount: b.vpJointCount ?? 0,
            // Полный ξ: повороты става + прочие фасонные части. Без поворотов
            // сопротивление занижалось, и проверка доставки воздуха в забой
            // давала слишком оптимистичный результат.
            localXi: totalLocalXi(b.vpBends90 ?? 0, b.vpBends45 ?? 0, b.vpLocalXi ?? 0),
            fanFlow,
          };
          const r = calcVentPipe({ ...inp, length: b.vpLength ?? 0 });

          const required = (b.vpRequiredFlow ?? 0) > 0
            ? b.vpRequiredFlow!
            : (b.ventComputedTotal ?? 0);
          if (required > 0 && r.flowFace < required) {
            addLog("warn",
              `⚠ Вентстав ${b.id}: в забой приходит ${r.flowFace.toFixed(2)} м³/с ` +
              `при требуемых ${required.toFixed(2)} м³/с (утечки ${r.leakagePercent.toFixed(0)}%)`);
          }
        }
      })();

      // Сохраняем расходы прямого режима (без реверса) для последующей проверки k_rev >= 0.6
      if (!branches.some(b => b.fanReverse) && data.converged) {
        const flows: Record<string, number> = {};
        resultBranches.forEach(rb => { flows[rb.id] = Math.abs(rb.Q); });
        setNormalFlows(flows);
      }

      setSolveResult({
        ok: data.converged,
        iterations: data.iterations,
        maxDeltaQ: data.maxResidual,
        maxDeltaH: data.maxResidual,
        branches: [],
        nodes: [],
        log: data.log ?? [],
        cyclesCount: data.cyclesCount ?? 0,
        diagnostics: data.diagnostics ?? [],
      });

      // Итоговая строка результата
      if (data.converged) {
        addLog("ok", `Сошлось за ${data.iterations} итераций, невязка ${(data.maxResidual as number)?.toFixed(4) ?? "—"}`);
      } else {
        addLog("warn", `Не сошлось за ${data.iterations} итераций, невязка ${(data.maxResidual as number)?.toFixed(4) ?? "—"}`);
      }

      // Диагностика в лог
      if (data.diagnostics?.length) {
        (data.diagnostics as { level: string; message: string }[]).forEach(d => {
          addLog(d.level === "error" ? "error" : d.level === "warning" ? "warn" : "info", d.message);
        });
      }

      if (data.branches?.some((b: { Q: number }) => Math.abs(b.Q) > 0.1)) {
        setShowFlowArrows(true);
      }

      // ── Участки, из-за которых расчёт не прошёл ────────────────────────
      // Расчёт присылает адрес проблемы (узлы/ветви). Показываем их в проверке
      // схемы, выделяем на схеме и центрируем вид — иначе пользователь видит
      // в журнале только номер узла и ищет его вручную по всей схеме.
      const errDiags = ((data.diagnostics ?? []) as {
        level: string; message: string; nodeIds?: string[]; branchIds?: string[];
      }[]).filter(d => d.level === "error" && ((d.nodeIds?.length ?? 0) > 0 || (d.branchIds?.length ?? 0) > 0));

      if (errDiags.length > 0) {
        const nodeIdSet = new Set(nodes.map(n => n.id));
        const branchIdSet = new Set(branches.map(b => b.id));
        // Берём только те id, что реально есть в схеме: расчёт заменяет
        // атмосферные узлы служебным GND, его на схеме не выделить.
        const badNodes = [...new Set(errDiags.flatMap(d => d.nodeIds ?? []))].filter(id => nodeIdSet.has(id));
        const badBranches = [...new Set(errDiags.flatMap(d => d.branchIds ?? []))].filter(id => branchIdSet.has(id));

        if (badNodes.length > 0 || badBranches.length > 0) {
          setSolveBlockers({
            nodeIds: badNodes,
            branchIds: badBranches,
            message: errDiags[0].message,
          });
          setActiveSide("check");
          setCheckTab("solveBlock");
          focusSolveBlocker(badNodes, badBranches);
          addLog("warn", `Проблемные участки показаны в «Проверка → Участки, остановившие расчёт»: узлов ${badNodes.length}, ветвей ${badBranches.length}.`);
        }
      } else if (!data.diagnostics?.some((d: { level: string }) => d.level === "error")) {
        // Расчёт прошёл без топологических ошибок — снимаем прежние отметки.
        setSolveBlockers(null);
      }
    } catch (e) {
      const msg = `Ошибка соединения: ${e instanceof Error ? e.message : String(e)}`;
      setVcError(msg);
      addLog("error", msg);
    } finally {
      setVcSolving(false);
      finishSolveProgress();
    }
  };

  const handleSolve = () => {
    // Идёт предпросмотр подобранного варианта — на схеме показан НЕ проект.
    // Расчёт лёг бы поверх чужих цифр, и понять, где чьи расходы, стало бы
    // невозможно. Поэтому сначала выходим из предпросмотра.
    if (fireControlPreview) {
      closeFireControlPreview();
      addLog("info", "Предпросмотр варианта закрыт: расчёт выполняется по данным проекта.");
    }
    // Перед расчётом проверяем сеть на изолированные ветви: подсети без выхода
    // на поверхность (нет пути к атмосферному узлу) не дают корректно рассчитать
    // воздухораспределение. Предупреждаем и открываем проверку «Нет связи с поверхностью».
    const check = checkSchema(nodes, branches);
    // Обрыв связи проверяем ПЕРВЫМ: ветвь, привязанная к удалённому узлу, —
    // причина, а «сеть распадается на несвязные части» и обнулённый расчёт —
    // лишь следствие. Раньше такой обрыв нигде не показывался, и пользователю
    // приходилось искать причину вручную по всей схеме.
    if (check.brokenBranches.length > 0) {
      setActiveSide("check");
      setCheckTab("brokenBranch");
      const brokenIds = check.brokenBranches.map(x => x.branch.id);
      setSelectedBranchIds(new Set(brokenIds));
      setSelectedNodeId(null);
      setSelectedBranchId(brokenIds[0]);
      setFocusNodeId(null);
      setFocusPos(null);
      setFocusBranchId(brokenIds[0]);
      setFocusNonce(Date.now());

      // Показываем первые несколько ветвей с номерами отсутствующих узлов —
      // так пользователь сразу видит, где именно порвана связь.
      const sample = check.brokenBranches.slice(0, 5)
        .map(x => `  • ветвь ${x.branch.id} → нет узла ${x.missingIds.join(", ")}`)
        .join("\n");
      const more = check.brokenBranches.length > 5
        ? `\n  … и ещё ${check.brokenBranches.length - 5}`
        : "";
      addLog("error", `Обрыв связи: ветвей с ссылкой на несуществующий узел — ${check.brokenBranches.length}. `
        + `Расчёт воздухораспределения обнулится, пока связь не восстановлена.`);
      check.brokenBranches.forEach(x => {
        addLog("error", `  Ветвь ${x.branch.id}: не найден узел ${x.missingIds.join(", ")}`);
      });
      if (!window.confirm(
        `Найдено ветвей с оборванной связью: ${check.brokenBranches.length}.\n\n`
        + `Эти ветви привязаны к узлам, которых в схеме больше нет (узлы удалены или перенумерованы):\n${sample}${more}\n\n`
        + `Из-за этого сеть распадается на несвязные части и расчёт воздухораспределения обнуляется.\n`
        + `Ветви отмечены на схеме и открыты в «Проверке» (Ветвь ссылается на удалённый узел) — восстановите привязку к существующим узлам.\n\n`
        + `Запустить расчёт всё равно?`
      )) return;
    }
    if (check.noAtmosphere || check.isolatedBranches.length > 0) {
      setActiveSide("check");
      setCheckTab("isolatedBranch");
      const ids = check.isolatedBranches.map(b => b.id);
      if (ids.length > 0) {
        setSelectedBranchIds(new Set(ids));
        setSelectedNodeId(null);
        setSelectedBranchId(ids[0]);
        setFocusNodeId(null);
        setFocusPos(null);
        setFocusBranchId(ids[0]);
        setFocusNonce(Date.now());
      }
      const msg = check.noAtmosphere
        ? "В схеме нет ни одного выхода на поверхность (атмосферного узла).\n\nРасчёт воздухораспределения невозможен: воздуху некуда входить и выходить.\nОтметьте хотя бы один узел как связанный с атмосферой.\n\nЗапустить расчёт всё равно?"
        : `Найдено изолированных ветвей: ${check.isolatedBranches.length}.\n\nЭти ветви не связаны с поверхностью (нет пути к выходу на поверхность) и мешают расчёту воздухораспределения. Они отмечены на схеме и открыты в «Проверке» (Нет связи с поверхностью).\n\nЗапустить расчёт всё равно?`;
      addLog("warn", check.noAtmosphere
        ? "Расчёт остановлен: в схеме нет выхода на поверхность (атмосферного узла)."
        : `Расчёт остановлен: изолированных ветвей ${check.isolatedBranches.length} (нет связи с поверхностью).`);
      if (!window.confirm(msg)) return;
    }
    void handleSolveLocal();
  };
  // Подключаем ref чтобы updateBranch мог вызвать расчёт (нужен прямой режим перед реверсом)
  handleSolveRef.current = handleSolve;


  // Проверяет, является ли узел промежуточным (ровно 2 смежных ветви)
  const getNodeAdjacentBranches = (nodeId: string) => {
    return branchesRaw.filter(b => b.fromId === nodeId || b.toId === nodeId);
  };

  // Объединяет две ветви, смежные с промежуточным узлом, в одну
  const mergeAdjacentBranches = (nodeId: string, branchAId: string, branchBId: string) => {
    const brA = branchesRaw.find(b => b.id === branchAId);
    const brB = branchesRaw.find(b => b.id === branchBId);
    if (!brA || !brB) return;

    // Определяем конечные узлы объединённой ветви (исключая промежуточный)
    const fromId = brA.fromId === nodeId ? brA.toId : brA.fromId;
    const toId   = brB.fromId === nodeId ? brB.toId : brB.fromId;

    // Новая ветвь: длина = сумма длин, остальные параметры от первой ветви
    const mergedBranch: typeof brA = {
      ...brA,
      id: brA.id,
      fromId,
      toId,
      length: (brA.length ?? 0) + (brB.length ?? 0),
      // Название выработки хранится в поле type. Раньше здесь писалось
      // несуществующее поле name — оно молча терялось, и объединённая
      // выработка могла остаться без названия.
      type: brA.type || brB.type,
    };

    // Перепривязываем символы со второй ветви на объединённую
    setSchemaSymbols(prev => prev.map(s =>
      s.branchId === branchBId ? { ...s, branchId: brA.id } : s
    ));

    setBranches(prev => [
      ...prev.filter(b => b.id !== branchAId && b.id !== branchBId),
      mergedBranch,
    ]);
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    if (selectedBranchId === branchBId) setSelectedBranchId(brA.id);
  };

  // Удаляет узел без объединения
  const doDeleteNode = (nodeId: string) => {
    pushHistory();
    setBranches(p => p.filter(b => b.fromId !== nodeId && b.toId !== nodeId));
    setNodes(p => p.filter(n => n.id !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };

  // Запрашивает удаление узла: если промежуточный — предлагает объединить ветви
  const requestDeleteNode = (nodeId: string) => {
    const adj = getNodeAdjacentBranches(nodeId);
    if (adj.length === 2) {
      setMergeNodeDialog({ nodeId, branchA: adj[0].id, branchB: adj[1].id });
    } else {
      doDeleteNode(nodeId);
    }
  };

  // ─── УДАЛЕНИЕ ВЕТВЕЙ С ПОДТВЕРЖДЕНИЕМ ────────────────────────────────
  // Молчаливое удаление ветви уносило со схемы вентиляторы и перемычки, а узлы
  // на её концах оставались висеть ни к чему не привязанными и ломали расчёт
  // воздухораспределения. Теперь последствия сначала показываются.

  /** Готовит план удаления и открывает окно подтверждения. */
  const requestDeleteBranches = (branchIds: string[]) => {
    if (branchIds.length === 0) return;
    const plan = planBranchDeletion(
      branchIds, nodes, branchesRaw, schemaSymbols,
      (typeId) => LEGEND_TYPES.find(t => t.id === typeId)?.name ?? typeId,
    );
    setDeleteBranchDialog(plan);
  };

  /** Выполняет удаление: ветви, их УО и осиротевшие узлы. */
  const confirmDeleteBranches = (plan: DeleteBranchPlan, removeOrphanNodes: boolean) => {
    pushHistory();
    const killBranches = new Set(plan.branchIds);
    const killSymbols = new Set(plan.symbols.map(s => s.id));
    setSchemaSymbols(prev => prev.filter(s => !killSymbols.has(s.id)));
    setBranches(prev => prev.filter(b => !killBranches.has(b.id)));
    if (removeOrphanNodes && plan.orphanNodeIds.length > 0) {
      const killNodes = new Set(plan.orphanNodeIds);
      setNodes(prev => prev.filter(n => !killNodes.has(n.id)));
    }
    setSelectedBranchId(null);
    setSelectedBranchIds(new Set());
    setSelectedSymbolId(null);
    setSelectedSymbolIds(new Set());
    setSelectedNodeId(null);
    setDeleteBranchDialog(null);
  };

  const handleDeleteSelected = () => {
    if (selectedSymbolIds.size > 1) {
      // Мульти-удаление символов (перемычки, вентиляторы и др.)
      pushHistory();
      const toDelete = schemaSymbols.filter(s => selectedSymbolIds.has(s.id));
      for (const sym of toDelete) {
        // Значков вентилятора пять видов — проверяем весь набор, иначе
        // при удалении оставались бы характеристики на выработке.
        if (FAN_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
          updateBranch(sym.branchId, {
            hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0,
            fanStopped: false, fanReverse: false, fanRpm: 0,
            fanBladeAngle: 0, fanParallel: 1, fanEfficiency: 0,
            fanShaftPower: 0, fanInstall: "Без перемычки", fanCrossingR: 0,
            fanWindowArea: 0, fanMode: "constant",
          }, false);
        }
        if (BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
          const otherBulkheadsOnBranch = schemaSymbols.filter(
            s => !selectedSymbolIds.has(s.id) && BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === sym.branchId
          );
          if (otherBulkheadsOnBranch.length === 0) {
            updateBranch(sym.branchId, {
              hasBulkhead: false, bulkheadR: 0, bulkheadAirPerm: 0,
              bulkheadManualR: 0, bulkheadSurveyQ: 0, bulkheadSurveyDP: 0,
            }, false);
          }
        }
        if (sym.typeId === "valve_water" && sym.branchId) {
          updateBranch(sym.branchId, { wpHasGate: false, wpGateClosed: false }, false);
        }
        // Значок техники под очагом удалён — больше не подставлять
        if (sym.id.startsWith("SYM_FIREVEH_") && sym.branchId) {
          updateBranch(sym.branchId, { fireVehicleSymbolOff: true }, false);
        }
        // Удалён очаг пожара клавишей Del — снимаем пожар с ветви, как при
        // удалении из контекстного меню; иначе ветвь считалась горящей, а
        // значок техники под очагом оставался.
        if (FIRE_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
          updateBranch(sym.branchId, {
            hasFire: false, fireVehicleSymbolOff: false,
            fireComputedTemp: 0, fireComputedNatDep: 0,
            fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0,
          }, false);
          setFireResult(null); setFireCalcDone(false);
        }
      }
      setSchemaSymbols(prev => prev.filter(s => !selectedSymbolIds.has(s.id)));
      setSelectedSymbolId(null);
      setSelectedSymbolIds(new Set());
    } else if (selectedSymbolId) {
      pushHistory();
      const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
      // Значков вентилятора пять видов — проверяем весь набор, иначе при
      // удалении клавишей Del исчезала бы только картинка, а модель, обороты
      // и напор оставались на выработке и участвовали в расчёте.
      if (sym && FAN_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
        updateBranch(sym.branchId, {
          hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0,
          fanStopped: false, fanReverse: false, fanRpm: 0,
          fanBladeAngle: 0, fanParallel: 1, fanEfficiency: 0,
          fanShaftPower: 0, fanInstall: "Без перемычки", fanCrossingR: 0,
          fanWindowArea: 0, fanMode: "constant",
        }, false);
      }
      // При удалении перемычки — сбрасываем флаг hasBulkhead и параметры ветви,
      // чтобы расчёт учёл отсутствие сопротивления (воздух пойдёт свободно)
      if (sym && BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
        // Проверяем: нет ли других символов перемычки на той же ветви
        const otherBulkheadsOnBranch = schemaSymbols.filter(
          s => s.id !== sym.id && BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === sym.branchId
        );
        if (otherBulkheadsOnBranch.length === 0) {
          updateBranch(sym.branchId, {
            hasBulkhead: false,
            bulkheadR: 0,
            bulkheadAirPerm: 0,
            bulkheadManualR: 0,
            bulkheadSurveyQ: 0,
            bulkheadSurveyDP: 0,
          }, false);
        }
      }
      // При удалении запорного вентиля — сбрасываем флаг и открываем ветвь
      if (sym?.typeId === "valve_water" && sym.branchId) {
        updateBranch(sym.branchId, { wpHasGate: false, wpGateClosed: false }, false);
      }
      // Значок техники под очагом удалён — больше не подставлять
      if (sym?.id.startsWith("SYM_FIREVEH_") && sym.branchId) {
        updateBranch(sym.branchId, { fireVehicleSymbolOff: true }, false);
      }
      // Удалён очаг пожара клавишей Del — снимаем пожар с ветви
      if (sym && FIRE_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
        updateBranch(sym.branchId, {
          hasFire: false, fireVehicleSymbolOff: false,
          fireComputedTemp: 0, fireComputedNatDep: 0,
          fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0,
        }, false);
        setFireResult(null); setFireCalcDone(false);
      }
      removeSymbol(selectedSymbolId);
      setSelectedSymbolId(null);
      setSelectedSymbolIds(new Set());
    } else if (selectedBranchIds.size > 1) {
      requestDeleteBranches([...selectedBranchIds]);
    } else if (selectedBranchId) {
      requestDeleteBranches([selectedBranchId]);
    } else if (selectedNodeId) {
      requestDeleteNode(selectedNodeId);
    }
  };

  const handleDeleteNode = (id: string) => {
    requestDeleteNode(id);
  };

  // Разорвать связь в узле — как в АэроСети:
  // каждая ветвь получает свой клон-узел на том же месте, исходный узел удаляется.
  // Ветви при этом НЕ удаляются — они перепривязываются к новым узлам.
  const handleSplitNodeConnections = (id: string) => {
    pushHistory();
    const srcNode = nodes.find((n) => n.id === id);
    if (!srcNode) return;
    const connected = branchesRaw.filter((b) => b.fromId === id || b.toId === id);
    if (connected.length === 0) return;

    // Для каждой ветви создаём отдельный узел-клон в той же позиции
    const newNodes: typeof nodes = [];
    const idMap = new Map<string, string>(); // branchId → новый nodeId

    connected.forEach((b) => {
      const newId = `N${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      newNodes.push(makeNode(newId, {
        x: srcNode.x, y: srcNode.y, z: srcNode.z,
        number: srcNode.number,
        name: srcNode.name,
        atmosphereLink: srcNode.atmosphereLink,
      }));
      idMap.set(b.id, newId);
    });

    // Перепривязываем ветви к новым узлам
    setBranches((prev) => prev.map((b) => {
      const newNodeId = idMap.get(b.id);
      if (!newNodeId) return b;
      return {
        ...b,
        fromId: b.fromId === id ? newNodeId : b.fromId,
        toId:   b.toId   === id ? newNodeId : b.toId,
      };
    }));

    // Удаляем исходный узел, добавляем клоны
    setNodes((prev) => [
      ...prev.filter((n) => n.id !== id),
      ...newNodes,
    ]);
    setSelectedNodeId(null);
  };

  // Соединить выбранные узлы в один — обратная операция к «Разорвать связь».
  // Все ветви выбранных узлов перепривязываются к первому (главному) узлу,
  // остальные узлы удаляются.
  const handleMergeNodes = (nodeIds: string[]) => {
    if (nodeIds.length < 2) return;
    pushHistory();
    const [mainId, ...rest] = nodeIds;
    const restSet = new Set(rest);
    setBranches((prev) => prev.map((b) => ({
      ...b,
      fromId: restSet.has(b.fromId) ? mainId : b.fromId,
      toId:   restSet.has(b.toId)   ? mainId : b.toId,
    })));
    setNodes((prev) => prev.filter((n) => !restSet.has(n.id)));
    setSelectedNodeIds(new Set());
    setSelectedNodeId(mainId);
  };

  // Выровнить выбранные узлы по оси
  const handleAlignNodes = (axis: "x" | "y", mode: "min" | "max" | "avg") => {
    const ids = selectedNodeIds.size >= 2 ? [...selectedNodeIds] : [];
    if (ids.length < 2) return;
    pushHistory();
    const selNodes = nodes.filter((n) => ids.includes(n.id));
    const vals = selNodes.map((n) => axis === "x" ? n.x : n.y);
    const target = mode === "min" ? Math.min(...vals) : mode === "max" ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
    setNodes((prev) => prev.map((n) => ids.includes(n.id) ? { ...n, [axis]: target } : n));
  };

  const handleToggleAtmosphere = (id: string) => {
    setNodes((p) => p.map((n) => n.id === id ? { ...n, atmosphereLink: !n.atmosphereLink } : n));
  };

  const handleReverseBranch = (id: string) => {
    pushHistory();
    const reversed = branches.find((b) => b.id === id);
    setBranches((p) => p.map((b) => {
      if (b.id !== id) return b;
      const isVmp = b.fanType === "ВМП";
      return {
        ...b,
        fromId: b.toId,
        toId: b.fromId,
        // Для ГВУ/ВВУ разворот ветви инвертирует fanReverse (направление нагнетания сохраняется физически).
        // Для ВМП fanReverse не используется — ВМП нагнетает всегда по fromId→toId,
        // поэтому разворот ветви = разворот направления нагнетания, fanReverse не трогаем.
        ...(!isVmp && b.hasFan ? { fanReverse: !(b.fanReverse ?? false) } : {}),
      };
    }));
    // При развороте ветви с вентилятором (в т.ч. ВМП) — сразу пересчитываем сеть,
    // чтобы новое направление нагнетания и расходы отобразились немедленно.
    if (reversed?.hasFan) {
      setTimeout(() => handleSolveRef.current?.(), 100);
    }
  };

  /**
   * Сменить направление вентилятора — куда он гонит воздух по выработке,
   * НЕ меняя режим работы (прямой/реверс).
   *
   * Вентилятор в расчёте нагнетает от начального узла ветви к конечному,
   * поэтому направление меняется перестановкой узлов ветви. В отличие от
   * «Развернуть ветвь» (Ctrl+R), признак реверса НЕ переключается: у ГВУ/ВВУ
   * разворот ветви инвертировал fanReverse, и вентилятор физически продолжал
   * дуть туда же, только в «реверсе». Здесь он дует в другую сторону на
   * прямой характеристике — как если бы его переставили.
   *
   * Значки на ветви остаются на своих местах (t → 1 − t), расход до
   * пересчёта меняет знак, затем сеть пересчитывается.
   */
  const handleFlipFanDirection = (id: string) => {
    pushHistory();
    setBranches((p) => p.map((b) => b.id !== id ? b : {
      ...b,
      fromId: b.toId,
      toId: b.fromId,
      flow: -(b.flow ?? 0),
      // Ручной угол задан от начального узла — при перестановке меняет знак
      ...(b.manualAngle ? { angle: -(b.angle ?? 0) } : {}),
    }));
    setSchemaSymbols((prev) => prev.map((s) =>
      s.branchId === id && typeof s.t === "number" ? { ...s, t: 1 - s.t } : s,
    ));
    setIsDirty(true);
    addLog("info", `Вентилятор на ветви ${id}: направление изменено`);
    setTimeout(() => handleSolveRef.current?.(), 100);
  };

  /**
   * Ctrl+R — развернуть выбранные условные обозначения (не ветвь).
   *
   * Что значит «развернуть» зависит от значка:
   *  • вентилятор — меняет направление, куда он дует (как кнопка «Сменить
   *    направление вентилятора»): стрелка на значке без смены расчёта
   *    показывала бы неправду;
   *  • насос и вентиляционные струи — переключают своё направление
   *    (airDirection), как выбор «Направление» в их свойствах;
   *  • остальные (перемычки, двери, калориферы, выходы…) — поворот значка
   *    на 180°, только вид, расчёт не меняется.
   */
  const handleFlipSymbols = (ids: string[]) => {
    const set = new Set(ids);
    const targets = schemaSymbols.filter(s => set.has(s.id));
    if (targets.length === 0) return;
    const fanBranches = new Set(targets
      .filter(s => FAN_SYMBOL_IDS.has(s.typeId) && s.branchId)
      .map(s => s.branchId as string));
    const DIR_TYPES = new Set(["pump", "fresh_inlet", "exhaust_outlet", "leak_inlet", "leak_outlet"]);
    const others = targets.filter(s => !(FAN_SYMBOL_IDS.has(s.typeId) && s.branchId));
    if (others.length > 0) {
      pushHistory();
      const otherIds = new Set(others.map(s => s.id));
      setSchemaSymbols(prev => prev.map(s => {
        if (!otherIds.has(s.id)) return s;
        return DIR_TYPES.has(s.typeId)
          ? { ...s, airDirection: s.airDirection === "reverse" ? "forward" : "reverse" }
          : { ...s, flipped: !s.flipped };
      }));
      setIsDirty(true);
    }
    // Вентилятор — через смену направления (там свой пересчёт сети)
    fanBranches.forEach(id => handleFlipFanDirection(id));
    addLog("info", `Развёрнуто условных обозначений: ${targets.length}`);
  };

  // ─── ГОРЯЧИЕ КЛАВИШИ ────────────────────────────────────────────────
  // Логика вынесена в useCadHotkeys без изменений: тот же обработчик и тот же
  // порядок проверок клавиш.
  useCadHotkeys({
    nodes, branchesRaw, schemaSymbols, positions,
    selectedNodeId, selectedBranchId, selectedBranchIds,
    selectedSymbolId, selectedSymbolIds, selectedPositionId,
    symbolClipboard, pendingSymbol, leaderDrawMode, lastSPressRef,
    handleUndo, handleSave, handleSolve, handleDeleteSelected,
    handleFlipSymbols, toggleRibbonCollapsed,
    setLeftPanelOpen, setActiveSide, setShowPrintDialog,
    setPendingSymbol, setSymbolClipboard, setPosBranchBindMode,
    setThinLines, setSurveyEditMode, requestResetToSurvey,
    setPositions, setLeaderDrawMode, setLeaderExtraMode,
    setLeaderCursorScreen, setLeaderSnapBranch, setShowSelectSimilar,
    setSelectedNodeId, setSelectedBranchId, setTool,
  });

  const handleCtxAction = (action: string) => {
    const nodeId = ctxMenu?.kind === "node" ? ctxMenu.id : undefined;
    const branchId = ctxMenu?.kind === "branch" ? ctxMenu.id : undefined;
    switch (action) {
      case "delete_node": if (nodeId) handleDeleteNode(nodeId); break;
      case "delete_branch": {
        // Удаляем все выделенные ветви (или одну из контекстного меню)
        // Идём через окно подтверждения — оно покажет, какие УО исчезнут
        // вместе с ветвями и какие узлы останутся изолированными.
        const targets = selectedBranchIds.size > 1
          ? [...selectedBranchIds]
          : branchId ? [branchId] : [];
        requestDeleteBranches(targets);
        break;
      }
      case "split_connections": if (nodeId) handleSplitNodeConnections(nodeId); break;
      case "merge_nodes": {
        const ids = selectedNodeIds.size >= 2
          ? [...selectedNodeIds]
          : nodeId ? [nodeId] : [];
        if (ids.length >= 2) handleMergeNodes(ids);
        break;
      }
      case "align_left":   handleAlignNodes("x", "min"); break;
      case "align_right":  handleAlignNodes("x", "max"); break;
      case "align_top":    handleAlignNodes("y", "min"); break;
      case "align_bottom": handleAlignNodes("y", "max"); break;
      case "align_center_x": handleAlignNodes("x", "avg"); break;
      case "align_center_y": handleAlignNodes("y", "avg"); break;
      case "toggle_atmosphere": if (nodeId) handleToggleAtmosphere(nodeId); break;
      case "toggle_capital": {
        const targets = selectedBranchIds.size > 1 ? [...selectedBranchIds] : branchId ? [branchId] : [];
        if (targets.length > 0) {
          // Если хотя бы одна не капитальная — ставим всем; если все капитальные — снимаем
          const allCapital = targets.every(tid => branches.find(b => b.id === tid)?.capital);
          setBranches(p => p.map(b => targets.includes(b.id) ? { ...b, capital: !allCapital } : b));
        }
        break;
      }
      case "toggle_designed": {
        const targets = selectedBranchIds.size > 1 ? [...selectedBranchIds] : branchId ? [branchId] : [];
        if (targets.length > 0) {
          const allDesigned = targets.every(tid => branches.find(b => b.id === tid)?.designed);
          setBranches(p => p.map(b => targets.includes(b.id) ? { ...b, designed: !allDesigned } : b));
        }
        break;
      }
      case "reverse_branch": if (branchId) handleReverseBranch(branchId); break;
      case "add_vent_pipe": {
        // Собираем все выделенные ветви (или одну из контекстного меню)
        const ids = selectedBranchIds.size > 0
          ? [...selectedBranchIds]
          : branchId ? [branchId] : [];
        if (ids.length > 0) {
          setVentPipeBranchIds(ids);
          setShowVentPipeDialog(true);
        }
        break;
      }
      // Правка и удаление ВСЕГО става одним действием: сегменты собираются
      // обходом по связи, вручную выделять их больше не нужно.
      case "edit_vent_pipe_line": if (branchId) editVentPipeLine(branchId); break;
      case "delete_vent_pipe_line": if (branchId) deleteVentPipeLine(branchId); break;
      case "copy_branch_params": {
        const src = branchId ? branches.find((b) => b.id === branchId) : null;
        if (src) {
          // Берём ровно поля сечения (см. BRANCH_COPY_SECTION_FIELDS) и ничего
          // сверх них: ни вентилятора с его направлением и доп. депрессией, ни
          // перемычки, ни труб, ни длины с углом — всё это своё у каждой ветви.
          const params: Partial<TopoBranch> = {};
          for (const k of BRANCH_COPY_SECTION_FIELDS) {
            if (src[k] !== undefined) (params as Record<string, unknown>)[k] = src[k];
          }
          setBranchParamBuffer(params);
        }
        break;
      }
      case "paste_branch_params": {
        if (!branchParamBuffer) break;
        const targets = selectedBranchIds.size > 0
          ? [...selectedBranchIds]
          : branchId ? [branchId] : [];
        targets.forEach((tid) => updateBranch(tid, branchParamBuffer));
        break;
      }
      case "add_node":
        setTool("node");
        break;
      case "open_props":
        setRightPanelOpen(true);
        if (nodeId) setSelectedNodeId(nodeId);
        if (branchId) {
          setSelectedBranchId(branchId);
          // При мультиселекте > 1 открываем диалог группового редактирования параметров
          if (selectedBranchIds.size > 1) {
            setVentPipeBranchIds([]); // сбрасываем вентруба если был открыт
            setShowMultiBranchProps(true);
          }
        }
        break;
    }
    setCtxMenu(null);
  };
  return {
    license,
    isDemo,
    showLicenseDialog,
    setShowLicenseDialog,
    showSettingsDialog,
    setShowSettingsDialog,
    filePathRef,
    activeRibbon,
    setActiveRibbon,
    ribbonCollapsed,
    selectRibbon,
    toggleRibbonCollapsed,
    activeSide,
    setActiveSide,
    mineFans,
    setMineFans,
    showOpoDialog,
    setShowOpoDialog,
    opoData,
    setOpoData,
    mineBulkheads,
    setMineBulkheads,
    mineTypes,
    setMineTypes,
    nodes,
    setNodes,
    branchesRaw,
    setBranches,
    textBlocks,
    setTextBlocks,
    selectedTextBlockId,
    setSelectedTextBlockId,
    editingTextBlockId,
    setEditingTextBlockId,
    textDragRef,
    draggingTextId,
    setDraggingTextId,
    historyRef,
    nodesRef,
    symbolsRef,
    pushHistory,
    handleUndo,
    selectedNodeId,
    setSelectedNodeId,
    selectedBranchId,
    setSelectedBranchId,
    tool,
    setTool,
    zLevel,
    surveyEditMode,
    setSurveyEditMode,
    movedNodeCount,
    resetSurveyDialog,
    setResetSurveyDialog,
    branches,
    nodesById,
    opoSummary,
    selectedNode,
    selectedBranch,
    waterNetwork,
    lastBranchTab,
    updateNode,
    updateBranch,
    horizons,
    setHorizons,
    activeHorizonId,
    setActiveHorizonId,
    editingHorizonImageId,
    setEditingHorizonImageId,
    editingPrintLayerId,
    setEditingPrintLayerId,
    updateHorizon,
    addHorizon,
    removeHorizon,
    branchCountByHorizon,
    hoveredHorizonId,
    setHoveredHorizonId,
    setHorizonImageBounds,
    setPrintLayerBounds,
    uploadHorizonImage,
    removeHorizonImage,
    renumberAll,
    handleNodeAdd,
    handleBranchAdd,
    buildVentPipeLine,
    deleteVentPipeLine,
    handleSplitBranchAt,
    handleNodeMove,
    resetNodeToSurvey,
    resetAllNodesToSurvey,
    requestResetToSurvey,
    fixCurrentAsSurvey,
    showMoveSchema,
    setShowMoveSchema,
    moveHorizon,
    handleMoveSchema,
    showRampDialog,
    setShowRampDialog,
    applyRampZ,
    buildSpiralRamp,
    fireResult,
    setFireResult,
    fireCalcDone,
    setFireCalcDone,
    fireCalcProgress,
    rescuePickMode,
    setRescuePickMode,
    rescueStartNodeId,
    setRescueStartNodeId,
    rescueTargetNodeId,
    setRescueTargetNodeId,
    rescuePickHandlerRef,
    rescuePathBranchIds,
    setRescuePathBranchIds,
    rescuePathBranchDirs,
    setRescuePathBranchDirs,
    rescuePathNodeIds,
    setRescuePathNodeIds,
    setRescueWaypointIds,
    rescueAltRouteColors,
    setRescueAltRouteColors,
    rescueBranchPickHandlerRef,
    rescueNodeLetters,
    workerPickMode,
    setWorkerPickMode,
    workerStartNodeId,
    setWorkerStartNodeId,
    workerTargetNodeId,
    setWorkerTargetNodeId,
    workerPickHandlerRef,
    workerPathBranchIds,
    setWorkerPathBranchIds,
    workerPathBranchDirs,
    setWorkerPathBranchDirs,
    workerPathNodeIds,
    setWorkerPathNodeIds,
    setWorkerWaypointIds,
    workerNodeLetters,
    showVentPipeDialog,
    setShowVentPipeDialog,
    ventPipeBranchIds,
    showMultiBranchProps,
    setShowMultiBranchProps,
    explosionResult,
    setExplosionResult,
    explosionResultByBranch,
    setExplosionResultByBranch,
    explosionCalcDone,
    setExplosionCalcDone,
    explosionBarriers,
    setExplosionBarriers,
    explosionPreview,
    showExplosionZones,
    setShowExplosionZones,
    activeExplosionRes,
    blastWaveRadius,
    setBlastWaveRadius,
    blastMaxRadius,
    setBlastMaxRadius,
    blastRadiusStep,
    setBlastRadiusStep,
    blastAnimating,
    setBlastAnimating,
    blastAnimRef,
    showSmoke,
    setShowSmoke,
    smokeTimeMinutes,
    setSmokeTimeMinutes,
    smokeMaxTime,
    setSmokeMaxTime,
    smokeTimeStep,
    setSmokeTimeStep,
    smokeVisThreshold,
    setSmokeVisThreshold,
    thermalDepMethod,
    changeThermalDepMethod,
    hqDialogData,
    setHqDialogData,
    normFireTime,
    changeNormFireTime,
    smokeAnimating,
    setSmokeAnimating,
    smokeAnimRef,
    solveResult,
    normalFlows,
    vcSolving,
    solveProgress,
    vcError,
    calcMode,
    setCalcMode,
    solverTolerance,
    setSolverTolerance,
    solverMaxIter,
    setSolverMaxIter,
    solverAlpha,
    setSolverAlpha,
    surfaceTemp,
    setSurfaceTemp,
    heatingSeason,
    setHeatingSeason,
    useNaturalDraft,
    setUseNaturalDraft,
    geoGradient,
    setGeoGradient,
    mineAirTemp,
    setMineAirTemp,
    useHumidity,
    setUseHumidity,
    surfaceHumidity,
    setSurfaceHumidity,
    mineHumidity,
    setMineHumidity,
    surfacePressure,
    setSurfacePressure,
    showSolverParams,
    setShowSolverParams,
    closeSolverParams,
    showFireStability,
    setShowFireStability,
    showWaterCheck,
    setShowWaterCheck,
    showEvacRisk,
    setShowEvacRisk,
    showFireControl,
    setShowFireControl,
    showVds,
    setShowVds,
    showExplosibility,
    setShowExplosibility,
    showLogPanel,
    setShowLogPanel,
    logEntries,
    setLogEntries,
    addLog,
    viewPreset,
    viewInfo,
    setViewInfo,
    setPreset,
    viewMode,
    setViewMode,
    flowDisplay,
    setFlowDisplay,
    animSpeed,
    setAnimSpeed,
    colorMode,
    setColorMode,
    flowColorMin,
    setFlowColorMin,
    flowColorMax,
    setFlowColorMax,
    flowColorHue,
    setFlowColorHue,
    velColorMin,
    setVelColorMin,
    velColorMax,
    setVelColorMax,
    velColorHue,
    setVelColorHue,
    workPlane,
    viewScale,
    setViewScale,
    fitToScreenNonce,
    setFitToScreenNonce,
    scaleSettingsOpen,
    setScaleSettingsOpen,
    scaleLimitsEnabled,
    setScaleLimitsEnabled,
    canvasThreshold,
    nodeLodAuto,
    setNodeLodAuto,
    nodeLodCircle,
    setNodeLodCircle,
    nodeLodLabel,
    setNodeLodLabel,
    nodeLodThresholds,
    scaleTextMin,
    setScaleTextMin,
    scaleTextMax,
    setScaleTextMax,
    scaleBranchMin,
    setScaleBranchMin,
    scaleBranchMax,
    setScaleBranchMax,
    widthBySectionOn,
    setWidthBySectionOn,
    tube3dOn,
    setTube3dOn,
    scalePositionMin,
    setScalePositionMin,
    scalePositionMax,
    setScalePositionMax,
    positionGostMm,
    setPositionGostMm,
    bulkheadScale,
    setBulkheadScale,
    fanScale,
    setFanScale,
    compareResult,
    setCompareResult,
    compareLoading,
    setCompareLoading,
    compareFilter,
    setCompareFilter,
    compareSelectedId,
    setCompareSelectedId,
    compareShowDialog,
    setCompareShowDialog,
    focusNonce,
    setFocusNonce,
    focusNodeId,
    setFocusNodeId,
    focusBranchId,
    setFocusBranchId,
    focusPos,
    setFocusPos,
    focusScreenReq,
    setFocusScreenReq,
    bulkheadFocusPosRef,
    blastHighlightPos,
    setBlastHighlightPos,
    checkHighlightPos,
    flashCheckHighlight,
    savedViewToRestore,
    setSavedViewToRestore,
    savedViewStateRef,
    viewStateTick,
    handleViewStateChange,
    positions,
    setPositions,
    selectedPositionId,
    setSelectedPositionId,
    positionPlaceMode,
    setPositionPlaceMode,
    posDragRef,
    draggingPosId,
    setDraggingPosId,
    leaderDragRef,
    draggingLeaderPosId,
    setDraggingLeaderPosId,
    hoveredLeaderAnchor,
    setHoveredLeaderAnchor,
    leaderDrawMode,
    setLeaderDrawMode,
    leaderExtraMode,
    setLeaderExtraMode,
    leaderSnapBranch,
    setLeaderSnapBranch,
    leaderSnapBranchRef,
    leaderCursorScreen,
    setLeaderCursorScreen,
    posBranchBindMode,
    setPosBranchBindMode,
    showPositions,
    setShowPositions,
    posColorInner,
    setPosColorInner,
    posColorOuter,
    setPosColorOuter,
    showPlaPanel,
    setShowPlaPanel,
    branchWidth,
    branchBorder,
    thinLines,
    setThinLines,
    colorByHorizon,
    setColorByHorizon,
    showFlowArrows,
    setShowFlowArrows,
    pollutionThreshold,
    setPollutionThreshold,
    pollutionFractions,
    infoConfig,
    zScale,
    setZScale,
    xyScale,
    setXyScale,
    unitsConfig,
    setUnitsConfig,
    schemaSymbols,
    setSchemaSymbols,
    updateInfoConfigSynced,
    infoPanelConfig,
    routeBranches,
    bulkheadRByBranch,
    totalRByBranch,
    totalDepByBranch,
    baseNodeTemps,
    branchesWithTotalDep,
    vdsBulkheads,
    userPumps,
    setUserPumps,
    ventSections,
    setVentSections,
    ventNorms,
    setVentNorms,
    blastThresholds,
    setBlastThresholds,
    blastMixId,
    setBlastMixId,
    showBlastBulkheadCalc,
    setShowBlastBulkheadCalc,
    showBlastBarrierChart,
    setShowBlastBarrierChart,
    blastMixCustomR,
    setBlastMixCustomR,
    blastDuringEmergency,
    setBlastDuringEmergency,
    blastGasTimeFactual,
    setBlastGasTimeFactual,
    showVentSections,
    setShowVentSections,
    showAirDemand,
    setShowAirDemand,
    ventSectionColors,
    selectedSymbolId,
    setSelectedSymbolId,
    selectedSymbolIds,
    setSelectedSymbolIds,
    pendingSymbol,
    setPendingSymbol,
    activeSymbolTypeId,
    setActiveSymbolTypeId,
    fanSymbolBranchId,
    setFanSymbolBranchId,
    squadDialog,
    setSquadDialog,
    squadCount,
    setSquadCount,
    SQUAD_TYPES,
    addSymbol,
    removeSymbol,
    resetNodeFireState,
    heaterInfo,
    handlePickSymbol,
    pickSymbolStable,
    cancelSymbolStable,
    leftPanelWidth,
    rightPanelWidth,
    leftPanelOpen,
    setLeftPanelOpen,
    rightPanelOpen,
    setRightPanelOpen,
    rightAutoCollapsed,
    startLeftDrag,
    startRightDrag,
    resetLeftWidth,
    resetRightWidth,
    showPrintDialog,
    setShowPrintDialog,
    printDialogOpenExport,
    setPrintDialogOpenExport,
    liveCanvasRef,
    canvasSize,
    setCanvasSize,
    handlePrintVentPipeReport,
    openPrintDialog,
    searchQuery,
    setSearchQuery,
    searchScope,
    setSearchScope,
    searchObjCat,
    setSearchObjCat,
    checkThreshold,
    setCheckThreshold,
    checkTab,
    setCheckTab,
    checkHighRThreshold,
    setCheckHighRThreshold,
    checkBulkRThreshold,
    setCheckBulkRThreshold,
    checkSettings,
    setCheckSettings,
    schemaCheckResult,
    showRenumberDialog,
    setShowRenumberDialog,
    showSelectSimilar,
    setShowSelectSimilar,
    solveBlockers,
    deleteBranchDialog,
    setDeleteBranchDialog,
    mergeNodeDialog,
    setMergeNodeDialog,
    selectedBranchIds,
    setSelectedBranchIds,
    rampSlopeColors,
    handleBranchMultiSelect,
    branchEditCount,
    multiHorizonMixed,
    updateSelectedBranches,
    updateBranchFromPanel,
    applyBranchType,
    selectedNodeIds,
    setSelectedNodeIds,
    moveSchemaCounts,
    alignRoles,
    horizonAlignFor,
    handleNodeMultiSelect,
    branchParamBuffer,
    fileSectionState,
    setFileSectionState,
    desktopLatestVer,
    showDxfImport,
    setShowDxfImport,
    showExcelImport,
    setShowExcelImport,
    showExcelExport,
    setShowExcelExport,
    showCsvExport,
    setShowCsvExport,
    schemeExportFormat,
    setSchemeExportFormat,
    showCombinedImport,
    setShowCombinedImport,
    showCsvImport,
    setShowCsvImport,
    showVentsimCsvImport,
    setShowVentsimCsvImport,
    showVent2CsvImport,
    setShowVent2CsvImport,
    showVent2Cdf3Import,
    setShowVent2Cdf3Import,
    showVentsimVsmImport,
    setShowVentsimVsmImport,
    showErpImport,
    setShowErpImport,
    handleVentsimVsmImport,
    handleVent2Cdf3Import,
    handleErpImport,
    handleVentsimCsvImport,
    handleCsvImport,
    handleVent2CsvImport,
    handleCombinedImport,
    handleExcelImport,
    handleDxfImport,
    showEquipRef,
    setShowEquipRef,
    equipRefTab,
    setEquipRefTab,
    showLegend,
    setShowLegend,
    openEquipRef,
    openLegend,
    recentFiles,
    removeRecentFile,
    clearRecentFiles,
    projectFileName,
    setProjectFileName,
    isDirty,
    setIsDirty,
    showCloseConfirm,
    setShowCloseConfirm,
    showAbout,
    setShowAbout,
    showHelpDialog,
    setShowHelpDialog,
    showDepressogram,
    setShowDepressogram,
    depressogramHighlight,
    setDepressogramHighlight,
    depressogramPickMode,
    setDepressogramPickMode,
    depressogramManualBranches,
    setDepressogramManualBranches,
    fireControlPreview,
    fireControlPreviewMode,
    setFireControlPreviewMode,
    previewBranches,
    previewSmokeColors,
    closeFireControlPreview,
    fileHandleRef,
    isEmptyProject,
    DEFAULT_PROJECT_NAME,
    suggestedFileName,
    openSchemeExport,
    handleSchemeExport,
    handleSave,
    handleSaveAs,
    handleOpen,
    applyProjectData,
    handleNewProject,
    ctxMenu,
    setCtxMenu,
    solveFireIteration,
    buildFireControlContext,
    applyFireControlActions,
    previewFireControlVariant,
    exportFireControlToPla,
    computeFireStabilityFacts,
    startFireProgress,
    finishFireProgress,
    revealBranchHorizons,
    focusSolveBlocker,
    handleSolve,
    mergeAdjacentBranches,
    doDeleteNode,
    confirmDeleteBranches,
    handleDeleteSelected,
    handleFlipFanDirection,
    handleCtxAction,
  };
}

export type CadPageState = ReturnType<typeof useCadPage>;
