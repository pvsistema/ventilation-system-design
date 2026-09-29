import Icon from "@/components/ui/icon";
import { type TopoBranch, calcBranchLength, type SectionKind, sectionKind, SECTION_KIND_COLORS, SECTION_KIND_LABELS } from "@/lib/topology";
import { MS_IND_BG_DEFAULT, FAN_IND_BG_DEFAULT } from "@/lib/msIndicatorStyle";
import IndicatorBgPicker from "@/components/cad/IndicatorBgPicker";
import HQFireDiagram from "@/components/cad/HQFireDiagram";
import NodePropsPanel from "@/components/cad/NodePropsPanel";
import NodeFirePanel from "@/components/cad/NodeFirePanel";
import NodePeoplePanel from "@/components/cad/NodePeoplePanel";
import BranchPropsPanel from "@/components/cad/BranchPropsPanel";
import VentSectionsPanel from "@/components/cad/VentSectionsPanel";
import SchemaCheckPanel from "@/components/cad/SchemaCheckPanel";
import PositionsPanel from "@/components/cad/PositionsPanel";
import { solidBulkheadRkMurg, windowBulkheadRkMurg, G_ACCEL } from "@/lib/bulkheads";
import { toast } from "sonner";
import GeneralPropsPanel from "@/components/cad/GeneralPropsPanel";
import BranchVentPanel from "@/components/cad/BranchVentPanel";
import BranchIndicatorsPanel from "@/components/cad/BranchIndicatorsPanel";
import FanIndicatorsPanel from "@/components/cad/FanIndicatorsPanel";
import HorizonsPanel from "@/components/cad/HorizonsPanel";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, HEATER_SYMBOL_IDS, VENT_JET_SYMBOL_IDS, WINDOW_BULKHEAD_IDS, OPEN_DOOR_IDS, REDUCER_SYMBOL_IDS, FIRE_SYMBOL_IDS, EXPLOSION_SYMBOL_IDS, FAN_SYMBOL_IDS, WATER_SYMBOL_IDS } from "@/lib/schemaSymbols";
import PumpPanel from "@/components/cad/PumpPanel";
import { COMBUSTIBLES, VEHICLE_MATERIALS, calcVehicleFire, calcFirePowerFromMaterial, calcFireMaterialSummary, NORMATIVE_TIME_MAX_MIN, type ThermalDepMethod, type VehicleFireResult } from "@/lib/fireCalculator";
import { GAS_TYPES, EXPLOSIVE_TYPES, EXPLOSION_HAZARD_COLORS, concUnitLabel, tntEquivalent, gasInitialPressure, gasEnergyDensity, type ExplosionSourceType } from "@/lib/explosionCalculator";
import { calcGasZone, gasZoneTime, EXPLOSIVE_CH4_CONC, DEFAULT_I_NEPOGASH, GAS_TIME_PLA, GAS_TIME_EMERGENCY_MIN } from "@/lib/gasZone";
import { barrierDisplayName, type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";
import RescuePanel from "@/components/cad/RescuePanel";
import WorkerPathPanel from "@/components/cad/WorkerPathPanel";
import PanelErrorBoundary from "@/components/cad/PanelErrorBoundary";
import { type SideTab, type CompareStatus } from "./cadTypes";
import { isHeaterActive, DEFAULT_HEATER_EFFICIENCY, MIN_SHAFT_TEMP_C } from "@/lib/heaterCalculator";
import type { SchemaSymbol } from "./cadTypes";
import { type CombustionMode, COMBUSTION_MODES, combustionMode } from "@/lib/vgschBlast";
import { safeFixed } from "./cadCompute";
import type { CadPageState } from "./useCadPage";

// Левая часть: вертикальные вкладки, панель свойств и разделитель ширины.
export default function CadLeftPanel({ c }: { c: CadPageState }) {
  const {
    activeSide,
    setActiveSide,
    mineFans,
    mineBulkheads,
    mineTypes,
    nodes,
    branchesRaw,
    setBranches,
    nodesRef,
    pushHistory,
    selectedNodeId,
    setSelectedNodeId,
    selectedBranchId,
    setSelectedBranchId,
    surveyEditMode,
    setSurveyEditMode,
    movedNodeCount,
    branches,
    nodesById,
    selectedNode,
    selectedBranch,
    waterNetwork,
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
    uploadHorizonImage,
    removeHorizonImage,
    resetNodeToSurvey,
    requestResetToSurvey,
    fixCurrentAsSurvey,
    moveHorizon,
    fireResult,
    setFireResult,
    fireCalcDone,
    setFireCalcDone,
    rescuePickMode,
    setRescuePickMode,
    rescueStartNodeId,
    setRescueStartNodeId,
    rescueTargetNodeId,
    setRescueTargetNodeId,
    rescuePickHandlerRef,
    setRescuePathBranchIds,
    setRescuePathBranchDirs,
    setRescuePathNodeIds,
    setRescueWaypointIds,
    setRescueAltRouteColors,
    rescueBranchPickHandlerRef,
    workerPickMode,
    setWorkerPickMode,
    workerStartNodeId,
    setWorkerStartNodeId,
    workerTargetNodeId,
    setWorkerTargetNodeId,
    workerPickHandlerRef,
    setWorkerPathBranchIds,
    setWorkerPathBranchDirs,
    setWorkerPathNodeIds,
    setWorkerWaypointIds,
    explosionResult,
    setExplosionResult,
    explosionResultByBranch,
    setExplosionResultByBranch,
    explosionCalcDone,
    setExplosionCalcDone,
    explosionBarriers,
    setExplosionBarriers,
    smokeVisThreshold,
    setSmokeVisThreshold,
    thermalDepMethod,
    changeThermalDepMethod,
    setHqDialogData,
    normFireTime,
    changeNormFireTime,
    normalFlows,
    heatingSeason,
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
    compareResult,
    setCompareResult,
    compareFilter,
    setCompareFilter,
    compareSelectedId,
    setCompareSelectedId,
    setCompareShowDialog,
    setFocusNonce,
    setFocusNodeId,
    setFocusBranchId,
    setFocusPos,
    bulkheadFocusPosRef,
    flashCheckHighlight,
    positions,
    setPositions,
    selectedPositionId,
    setSelectedPositionId,
    positionPlaceMode,
    setPositionPlaceMode,
    leaderDrawMode,
    setLeaderDrawMode,
    setLeaderExtraMode,
    setLeaderSnapBranch,
    setLeaderCursorScreen,
    posBranchBindMode,
    setPosBranchBindMode,
    branchWidth,
    branchBorder,
    thinLines,
    setThinLines,
    colorByHorizon,
    setColorByHorizon,
    pollutionThreshold,
    pollutionFractions,
    infoConfig,
    unitsConfig,
    schemaSymbols,
    setSchemaSymbols,
    routeBranches,
    bulkheadRByBranch,
    totalDepByBranch,
    userPumps,
    setUserPumps,
    ventSections,
    setVentSections,
    ventNorms,
    blastThresholds,
    setShowBlastBulkheadCalc,
    setShowBlastBarrierChart,
    blastDuringEmergency,
    setBlastDuringEmergency,
    blastGasTimeFactual,
    setBlastGasTimeFactual,
    setShowVentSections,
    setShowAirDemand,
    selectedSymbolId,
    setSelectedSymbolId,
    fanSymbolBranchId,
    setFanSymbolBranchId,
    removeSymbol,
    resetNodeFireState,
    heaterInfo,
    leftPanelWidth,
    leftPanelOpen,
    setLeftPanelOpen,
    startLeftDrag,
    resetLeftWidth,
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
    setShowRenumberDialog,
    solveBlockers,
    selectedBranchIds,
    setSelectedBranchIds,
    branchEditCount,
    multiHorizonMixed,
    updateSelectedBranches,
    updateBranchFromPanel,
    applyBranchType,
    setSelectedNodeIds,
    horizonAlignFor,
    setShowEquipRef,
    setEquipRefTab,
    setIsDirty,
    revealBranchHorizons,
    focusSolveBlocker,
    handleFlipFanDirection,
  } = c;

  return (
    <>
        {/* ── КНОПКА-ПОЛОСКА «РАЗВЕРНУТЬ ЛЕВУЮ ПАНЕЛЬ» ─────────────── */}
        {!leftPanelOpen && (
          <button onClick={() => setLeftPanelOpen(true)}
            className="flex-shrink-0 flex items-center justify-center w-6 h-full border-r"
            style={{ background: "var(--c-s2, #f5f5f5)", borderColor: "var(--c-b3, #b8b8b8)", color: "var(--c-t2, #374151)", cursor: "pointer" }}
            title="Показать панель свойств">
            <Icon name="PanelLeftOpen" size={14} />
          </button>
        )}

        {/* ── ВЕРТИКАЛЬНЫЕ ВКЛАДКИ СЛЕВА ────────────────────────────── */}
        {leftPanelOpen && (<>
        <div className="flex flex-col flex-shrink-0"
          style={{ width: 24, background: "var(--c-s4, #e8e8e8)", borderRight: "1px solid var(--c-b3, #b8b8b8)", overflow: "hidden" }}>
          {(selectedNodeId || selectedBranchId || fanSymbolBranchId) && (selectedNodeId
            ? ([
                { id: "params", label: "Параметры" },
                { id: "measure", label: "Замеры" },
                { id: "waterpipes", label: "Трубы" },
                { id: "indicators", label: "Индикаторы" },
                // Люди и средства защиты: рабочие места с численностью, выходы
                // на поверхность, камеры-убежища и пункты переключения.
                // Вкладка показывается ВСЕГДА (в отличие от ветви, где «Пожар»
                // появляется только при очаге): назначение узла задают ДО
                // расчёта, и если прятать вкладку, задать его будет негде —
                // именно поэтому подбор режима при пожаре раньше сообщал
                // «не заданы рабочие места», а исправить это было нельзя.
                { id: "accidents", label: "👷 Аварии" },
              ] as { id: SideTab; label: string }[])
            : fanSymbolBranchId
            ? ([
                { id: "fan", label: "Вентилятор" },
                { id: "fan-indicators", label: "Индикаторы" },
              ] as { id: SideTab; label: string }[])
            : ([
                { id: "general", label: "Общие" },
                { id: "vent", label: "Вентиляция" },
                { id: "topology", label: "Топология" },
                { id: "waterpipes", label: "Трубы:" },
                { id: "conveyor", label: "Конвейер" },
                { id: "fireload", label: "Пож.нагрузка" },
                { id: "airdemand", label: "Расход воздуха" },
                { id: "indicators", label: "Индикаторы" },
                // Пункт появляется только когда на выработке построен став —
                // иначе он был бы пустым и путал бы пользователя.
                ...(selectedBranch?.hasVentPipe ? [{ id: "ventpipe" as SideTab, label: "Вентстав" }] : []),

                // Вентилятор. РАНЬШЕ вкладку открывал только клик по значку УО
                // на схеме: у выработки с напором из импорта значка могло не
                // быть, и напор оставался нередактируемым — виден в «Доп.
                // депрессии», а поменять негде. Теперь вкладка есть у любой
                // выработки с вентилятором, независимо от способа появления.
                ...(selectedBranch?.hasFan ? [{ id: "fan" as SideTab, label: "Вентилятор" }] : []),

                ...(selectedBranch?.hasFire ? [{ id: "accidents" as SideTab, label: "🔥 Пожар" }] : []),
                ...(selectedBranch?.hasExplosion ? [{ id: "blast" as SideTab, label: "💥 Взрыв" }] : []),
              ] as { id: SideTab; label: string }[])
          ).map((t) => (
            <button key={t.id}
              onClick={() => setActiveSide(t.id)}
              className="flex items-center justify-center transition-colors flex-shrink-0 py-3"
              style={{
                /* Высота подстраивается под подпись: длинные названия
                   («Расход воздуха») остаются в одну строку, короткие
                   сохраняют прежний размер кнопки. */
                minHeight: 80,
                background: activeSide === t.id ? "var(--c-s1, #ffffff)" : "transparent",
                borderRight: activeSide === t.id ? "1px solid #ffffff" : "1px solid transparent",
                marginRight: activeSide === t.id ? "-1px" : "0",
                borderTop: activeSide === t.id ? "1px solid var(--c-b3, #b8b8b8)" : "none",
                borderBottom: activeSide === t.id ? "1px solid var(--c-b3, #b8b8b8)" : "none",
              }}>
              <span className="text-[11px] tracking-wide"
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  whiteSpace: "nowrap",
                  color: activeSide === t.id ? "var(--c-blue, #2563eb)" : "var(--c-t2, #444)",
                  fontWeight: activeSide === t.id ? 600 : 400,
                }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>

        {/* ── ПАНЕЛЬ СВОЙСТВ ─────────────────────────────────────────── */}
        <div className="flex flex-col flex-shrink-0"
          style={{ width: leftPanelWidth, background: "var(--c-s1, #ffffff)", borderRight: "1px solid var(--c-b3, #b8b8b8)" }}>

          {/* Селектор объекта */}
          <div className="px-1 py-1" style={{ borderBottom: "1px solid var(--c-b2, #d0d0d0)" }}>
            <div className="flex items-center gap-1">
              <button className="w-4 h-4 hover:bg-black/10 flex items-center justify-center">
                <svg width="8" height="8" viewBox="0 0 8 8"><path d="M5 1 L1 4 L5 7" stroke="#444" fill="none" strokeWidth="1.2" /></svg>
              </button>
              <select
                className="flex-1 text-xs px-1 py-0.5 border border-gray-400 bg-white"
                value={activeSide === "horizons" ? "horizons" : activeSide === "search" ? "search" : activeSide === "positions" ? "positions" : activeSide === "flowQ" ? "flowQ" : activeSide === "velocityV" ? "velocityV" : activeSide === "section" ? "section" : activeSide === "ventsections" ? "ventsections" : activeSide === "check" ? "check" : "props"}
                onChange={(e) => {
                  if (e.target.value === "horizons") setActiveSide("horizons");
                  else if (e.target.value === "search") setActiveSide("search");
                  else if (e.target.value === "positions") setActiveSide("positions");
                  else if (e.target.value === "flowQ") { setActiveSide("flowQ"); setColorMode("flowQ"); }
                  else if (e.target.value === "velocityV") { setActiveSide("velocityV"); setColorMode("velocityV"); }
                  else if (e.target.value === "section") { setActiveSide("section"); setColorMode("section"); }
                  else if (e.target.value === "check") setActiveSide("check");
                  else if (e.target.value === "ventsections") setActiveSide("ventsections");
                  else { setActiveSide("general"); }
                }}>
                <option value="props">Свойства</option>
                <option value="positions">Позиции</option>
                <option value="search">Поиск</option>
                <option value="horizons">Горизонты</option>
                <option value="flowQ">Расход воздуха</option>
                <option value="velocityV">Скорость воздуха</option>
                <option value="section">Форма сечения</option>
                <option value="ventsections">Участки</option>
                {/* Разделитель: «Проверка» — отдельный по смыслу раздел (аудит схемы),
                    поэтому визуально отделяем его от разделов отображения. */}
                <option disabled style={{ color: "var(--c-t4, #d1d5db)" }}>──────────</option>
                <option value="check">Проверка</option>
              </select>
            </div>
          </div>

          {/* Заголовок секции */}
          <div className="px-2 py-1.5 border-b border-gray-300 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-800">
              {activeSide === "params" && (selectedNode ? `Узел: ${selectedNode.number || selectedNode.id}` : selectedBranch ? `Ветвь: ${selectedBranch.id}` : "Параметры")}
              {activeSide === "general" && "Свойства объекта"}
              {activeSide === "search" && "Поиск"}
              {activeSide === "horizons" && "Горизонты"}
              {activeSide === "vent" && "Вентиляция"}
              {activeSide === "thermo" && "Теплофизические параметры"}
              {/* У узла на этой вкладке задают людей и средства защиты,
                  у ветви — параметры очага пожара. Заголовок должен
                  называть то, что человек видит под ним. */}
              {activeSide === "accidents" && (selectedNode ? "Люди и средства защиты" : "Аварийные режимы")}
              {activeSide === "blast" && "Место взрыва"}
              {activeSide === "indicators" && "Индикаторы"}
              {activeSide === "measure" && "Замеры"}
              {activeSide === "pipes" && "Трубопроводы"}
              {activeSide === "positions" && "Позиции"}
              {activeSide === "flowQ" && "Расход воздуха"}
              {activeSide === "rescue" && "Расчёт горноспасателей"}
              {activeSide === "check" && "Проверка схемы"}
              {activeSide === "ventsections" && "Участки рудника"}
            </span>
            <div className="flex items-center gap-1">
              {activeSide === "params" && selectedNode && (
                <span className="text-[10px] text-gray-500 font-mono">{selectedNode.id}</span>
              )}
              {(activeSide === "topology" || activeSide === "general") && (
                <button onClick={() => setShowRenumberDialog(true)}
                  className="h-6 px-1.5 flex items-center gap-1 rounded text-[10px]"
                  style={{ background: "none", border: "1px solid var(--c-b2, #c8c8c8)", color: "var(--c-t2, #374151)", cursor: "pointer" }}
                  title="Автонумерация объектов">
                  <Icon name="Hash" size={12} />
                  Перенумеровать
                </button>
              )}
              <button onClick={() => setLeftPanelOpen(false)}
                className="h-6 px-1.5 flex items-center gap-1 rounded text-[10px]"
                style={{ background: "none", border: "1px solid var(--c-b2, #c8c8c8)", color: "var(--c-t2, #374151)", cursor: "pointer" }}
                title="Скрыть панель свойств">
                <Icon name="PanelLeftClose" size={12} />
                Свернуть
              </button>
            </div>
          </div>

          {/* Свойства */}
          <div className="flex-1 overflow-y-auto overflow-x-auto">

            {/* ═══ ВКЛАДКА: ПОИСК ═════════════════════════════════════ */}
            {activeSide === "search" && (() => {
              const q = searchQuery.trim().toLowerCase();
              // "symbol" — объект схемы (УО): вентилятор, перемычка, оборудование
              // водопровода, очаг пожара, место взрыва. У него нет узла/ветви для
              // фокуса, поэтому храним координаты и наводим камеру по ним.
              type Hit = {
                kind: "node" | "branch" | "symbol";
                id: string; title: string; subtitle: string;
                icon?: string; color?: string;
                pos?: { x: number; y: number; z: number };
                branchId?: string | null;
              };
              // Виды УО для выпадающего списка группы «Объекты».
              // Порядок — как в запросе: вентиляторы, перемычки, водопровод,
              // очаг пожара, взрыв.
              const OBJ_CATS: { key: string; label: string; icon: string; color: string; ids: Set<string> }[] = [
                { key: "fan",   label: "УО ГВУ / ВВУ / ВМП",      icon: "Fan",      color: "text-sky-700",     ids: FAN_SYMBOL_IDS },
                { key: "bulk",  label: "Все перемычки",           icon: "Blocks",   color: "text-stone-700",   ids: BULKHEAD_SYMBOL_IDS },
                { key: "water", label: "УО водопровода",          icon: "Droplets", color: "text-blue-700",    ids: WATER_SYMBOL_IDS },
                { key: "fire",  label: "Очаг пожара",             icon: "Flame",    color: "text-red-600",     ids: FIRE_SYMBOL_IDS },
                { key: "expl",  label: "Взрыв",                   icon: "Zap",      color: "text-orange-600",  ids: EXPLOSION_SYMBOL_IDS },
              ];
              const nodeById = new Map(nodes.map(n => [n.id, n]));
              const brById   = new Map(branches.map(b => [b.id, b]));

              /**
               * Собирает объекты схемы (УО).
               * catKey — вид УО из списка выше (null = любой);
               * text   — текстовый фильтр (пустой = без фильтра).
               */
              const findObjects = (catKey: string | null, text: string): Hit[] => {
                const out: Hit[] = [];
                for (const s of schemaSymbols) {
                  const c = OBJ_CATS.find(k => k.ids.has(s.typeId));
                  if (!c) continue;
                  if (catKey && c.key !== catKey) continue;
                  const lt = LEGEND_TYPES.find(l => l.id === s.typeId);
                  const br = s.branchId ? brById.get(s.branchId) : undefined;
                  const fN = br ? nodeById.get(br.fromId) : undefined;
                  const tN = br ? nodeById.get(br.toId)   : undefined;
                  // Для вентилятора показываем его тип (ГВУ/ВВУ/ВМП) и марку.
                  const fanInfo = br?.hasFan ? `${br.fanType}${br.fanName ? ` · ${br.fanName}` : ""}` : "";
                  const where = br
                    ? `${fN?.number || br.fromId} → ${tN?.number || br.toId}`
                    : `X=${s.x.toFixed(1)} Y=${s.y.toFixed(1)}`;
                  if (text) {
                    const fields = [
                      c.label, lt?.name, s.label, s.description,
                      br?.id, br?.type, br?.fanType, br?.fanName,
                      fN?.number, tN?.number,
                    ].filter(Boolean).map(String);
                    if (!fields.some(f => f.toLowerCase().includes(text))) continue;
                  }
                  // Точка для центрирования камеры. УО стоит НЕ в середине
                  // выработки, а в доле t вдоль неё — считаем именно эту точку,
                  // чтобы объект оказался ровно в центре экрана.
                  let pos = { x: s.x, y: s.y, z: 0 };
                  if (br && fN && tN) {
                    const t = s.t ?? 0.5;
                    pos = {
                      x: fN.x + (tN.x - fN.x) * t,
                      y: fN.y + (tN.y - fN.y) * t,
                      z: fN.z + (tN.z - fN.z) * t,
                    };
                  }
                  out.push({
                    kind: "symbol",
                    id: s.id,
                    title: lt?.name || c.label,
                    subtitle: [s.label, fanInfo, where].filter(Boolean).join(" · "),
                    icon: c.icon,
                    color: c.color,
                    pos,
                    branchId: s.branchId,
                  });
                }
                return out;
              };

              const hits: Hit[] = [];
              if (q.length > 0) {
                if (searchScope === "all" || searchScope === "nodes") {
                  for (const n of nodes) {
                    // Поиск узла ТОЛЬКО по номеру узла
                    const num = String(n.number ?? "").toLowerCase();
                    if (num && num.includes(q)) {
                      hits.push({
                        kind: "node",
                        id: n.id,
                        title: `Узел ${n.number || n.id}`,
                        subtitle: `№ ${n.number || "—"} · X=${n.x.toFixed(1)} Y=${n.y.toFixed(1)} Z=${n.z.toFixed(1)}`,
                      });
                    }
                  }
                }
                if (searchScope === "all" || searchScope === "branches") {
                  for (const b of branches) {
                    const fromN = nodes.find(n => n.id === b.fromId);
                    const toN = nodes.find(n => n.id === b.toId);
                    // Поиск ветви по номерам узлов (и типу/имени вентилятора)
                    const fields = [b.id, b.type, b.fanName, fromN?.number, toN?.number]
                      .filter(Boolean).map(String);
                    if (fields.some(f => f.toLowerCase().includes(q))) {
                      hits.push({
                        kind: "branch",
                        id: b.id,
                        title: `Ветвь ${b.id}${b.type ? ` (${b.type})` : ""}`,
                        subtitle: `${fromN?.number || b.fromId} → ${toN?.number || b.toId}${b.hasFan ? " · вентилятор" : ""}`,
                      });
                    }
                  }
                }
                // В группе «Всё» объекты ищем по введённому тексту.
                if (searchScope === "all") {
                  hits.push(...findObjects(null, q));
                }
              }
              // ─── ГРУППА «ОБЪЕКТЫ»: выбор категории из списка ───────────
              // Здесь текст не вводится: пользователь выбирает вид УО, и сразу
              // показываются все такие объекты, установленные на схеме.
              if (searchScope === "objects" && searchObjCat) {
                hits.push(...findObjects(searchObjCat, ""));
              }
              const maxShow = 200;
              const shown = hits.slice(0, maxShow);
              return (
                <div className="p-2 text-[11px]">
                  {/* В группе «Объекты» — выбор вида УО из списка,
                      в остальных группах — обычный ввод текста. */}
                  {searchScope === "objects" ? (
                    <div className="mb-2">
                      <select
                        value={searchObjCat}
                        onChange={(e) => setSearchObjCat(e.target.value)}
                        className="w-full px-1.5 border border-gray-400 rounded text-[12px] outline-none focus:border-blue-500 bg-white"
                        style={{ height: 26 }}>
                        <option value="">— выберите объект —</option>
                        {OBJ_CATS.map(c => {
                          // Показываем, сколько таких объектов есть на схеме.
                          const cnt = schemaSymbols.reduce((s, sy) => s + (c.ids.has(sy.typeId) ? 1 : 0), 0);
                          return (
                            <option key={c.key} value={c.key} disabled={cnt === 0}>
                              {c.label}{cnt > 0 ? ` (${cnt})` : " — нет на схеме"}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  ) : (
                    <div className="relative mb-2">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                        placeholder="Введите номер, наименование, ID…"
                        className="w-full pl-6 pr-6 py-1 border border-gray-400 rounded text-[12px] outline-none focus:border-blue-500"
                        style={{ height: 26 }}
                      />
                      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                        <Icon name="Search" size={12} />
                      </span>
                      {searchQuery && (
                        <button onClick={() => setSearchQuery("")}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                          title="Очистить">
                          <Icon name="X" size={12} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Фильтр по типу */}
                  <div className="flex gap-1 mb-2">
                    {([
                      { v: "all" as const, l: "Всё" },
                      { v: "nodes" as const, l: "Узлы" },
                      { v: "branches" as const, l: "Ветви" },
                      { v: "objects" as const, l: "Объекты" },
                    ]).map(opt => (
                      <button key={opt.v}
                        onClick={() => setSearchScope(opt.v)}
                        className="flex-1 px-1 py-0.5 rounded text-[11px] border"
                        style={{
                          background: searchScope === opt.v ? "var(--c-blue, #2563eb)" : "white",
                          color: searchScope === opt.v ? "white" : "var(--c-t2, #374151)",
                          borderColor: searchScope === opt.v ? "var(--c-blue, #2563eb)" : "var(--c-b2, #c8c8c8)",
                        }}>
                        {opt.l}
                      </button>
                    ))}
                  </div>

                  {/* Статус */}
                  <div className="text-[10px] text-gray-500 mb-1.5 flex items-center justify-between">
                    <span>
                      {searchScope === "objects"
                        ? (!searchObjCat
                            ? "Выберите вид объекта из списка"
                            : `Найдено: ${hits.length}${hits.length > maxShow ? ` (показано ${maxShow})` : ""}`)
                        : q.length === 0
                          ? "Начните вводить запрос"
                          : `Найдено: ${hits.length}${hits.length > maxShow ? ` (показано ${maxShow})` : ""}`}
                    </span>
                  </div>

                  {/* Результаты */}
                  <div className="flex flex-col gap-0.5">
                    {shown.map((h) => {
                      const isActive = (h.kind === "node" && selectedNodeId === h.id)
                        || (h.kind === "branch" && selectedBranchId === h.id)
                        || (h.kind === "symbol" && selectedSymbolId === h.id);
                      return (
                        <button key={`${h.kind}-${h.id}`}
                          onClick={() => {
                            setFocusPos(null);
                            if (h.kind === "node") {
                              setSelectedNodeId(h.id);
                              setSelectedBranchId(null);
                              setSelectedSymbolId(null);
                              setFocusNodeId(h.id);
                              setFocusBranchId(null);
                            } else if (h.kind === "branch") {
                              setSelectedBranchId(h.id);
                              setSelectedNodeId(null);
                              setSelectedSymbolId(null);
                              setFocusBranchId(h.id);
                              setFocusNodeId(null);
                            } else {
                              // Объект схемы: выделяем сам УО и ставим его РОВНО
                              // в центр экрана — по его собственной точке, а не
                              // по середине выработки, на которой он стоит.
                              setSelectedSymbolId(h.id);
                              setSelectedNodeId(null);
                              setSelectedBranchId(h.branchId ?? null);
                              setFocusNodeId(null);
                              setFocusBranchId(null);
                              if (h.pos) setFocusPos(h.pos);
                            }
                            setFocusNonce(Date.now());
                          }}
                          className="flex items-start gap-2 px-2 py-1.5 rounded text-left transition-colors"
                          style={{
                            background: isActive ? "var(--c-tint-blue2, #dbeafe)" : "transparent",
                            border: isActive ? "1px solid var(--c-blue, #2563eb)" : "1px solid transparent",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#f3f4f6"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
                          <Icon
                            name={h.kind === "symbol" ? (h.icon ?? "Shapes")
                              : h.kind === "node" ? "CircleDot" : "GitBranch"}
                            size={14}
                            className={`mt-0.5 ${h.kind === "symbol" ? (h.color ?? "text-gray-700")
                              : h.kind === "node" ? "text-amber-700" : "text-blue-700"}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-800 truncate">{h.title}</div>
                            <div className="text-[10px] text-gray-500 truncate">{h.subtitle}</div>
                          </div>
                        </button>
                      );
                    })}
                    {(searchScope === "objects" ? !!searchObjCat : q.length > 0) && hits.length === 0 && (
                      <div className="text-center text-gray-400 text-[11px] py-3">
                        Ничего не найдено
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}


            {/* ═══ ВКЛАДКА: ПРОВЕРКА СХЕМЫ ═══════════════════════════════ */}
            {activeSide === "check" && schemaCheckResult && (
              <SchemaCheckPanel
                result={schemaCheckResult}
                nodes={nodes}
                branches={branches}
                horizons={horizons}
                selectedNodeId={selectedNodeId}
                selectedBranchId={selectedBranchId}
                openCheck={checkTab}
                onOpenCheck={setCheckTab}
                nearThreshold={checkThreshold}
                onNearThreshold={setCheckThreshold}
                highRThreshold={checkHighRThreshold}
                onHighRThreshold={setCheckHighRThreshold}
                bulkRThreshold={checkBulkRThreshold}
                onBulkRThreshold={setCheckBulkRThreshold}
                settings={checkSettings}
                onSettings={setCheckSettings}
                solveBlockers={solveBlockers}
                onFocusNode={(id) => {
                  setSelectedNodeId(id);
                  setSelectedBranchId(null);
                  setFocusPos(null);
                  setFocusNodeId(id);
                  setFocusNonce(Date.now());
                  const n = nodesById.get(id);
                  flashCheckHighlight(n ? { x: n.x, y: n.y, z: n.z } : null);
                }}
                onFocusBranch={(id) => {
                  revealBranchHorizons([id]);
                  setSelectedBranchId(id);
                  setSelectedBranchIds(new Set([id]));
                  setSelectedNodeId(null);
                  // Фокус на узел от прошлого клика сбрасываем: эффект
                  // центрирования проверяет узел раньше ветви, и камера
                  // уезжала к старому узлу вместо выбранной ветви.
                  setFocusNodeId(null);
                  const bPos = bulkheadFocusPosRef.current(id);
                  setFocusPos(bPos);
                  setFocusBranchId(id);
                  setFocusNonce(Date.now());
                  const br = branches.find(b => b.id === id);
                  const fN = br ? nodesById.get(br.fromId) : undefined;
                  const tN = br ? nodesById.get(br.toId) : undefined;
                  if (!bPos && (!fN || !tN)) {
                    toast.error("У ветви нет начального или конечного узла — показать её на схеме нельзя");
                    flashCheckHighlight(null);
                    return;
                  }
                  flashCheckHighlight(bPos ?? {
                    x: (fN!.x + tN!.x) / 2, y: (fN!.y + tN!.y) / 2, z: (fN!.z + tN!.z) / 2,
                  });
                }}
                onSelectBranches={(ids) => {
                  if (ids.length === 0) return;
                  revealBranchHorizons(ids);
                  setSelectedBranchIds(new Set(ids));
                  setSelectedNodeId(null);
                  setSelectedBranchId(ids[0]);
                  setFocusNodeId(null);
                  setFocusPos(bulkheadFocusPosRef.current(ids[0]));
                  setFocusBranchId(ids[0]);
                  setFocusNonce(Date.now());
                }}
                onFocusSolveBlocker={focusSolveBlocker}
                onFocusGroup={focusSolveBlocker}
                onUpdateBranch={(id, patch) => updateBranch(id, patch)}
                onAllManualToAuto={() => {
                  pushHistory();
                  setBranches(prev => prev.map(b => {
                    if (!b.manualLength) return b;
                    const fn = nodesById.get(b.fromId);
                    const tn = nodesById.get(b.toId);
                    const len = fn && tn ? Math.round(calcBranchLength(fn, tn)) : b.length;
                    return { ...b, manualLength: false, length: len };
                  }));
                }}
                onFixZeroLen={(fallbackLen) => {
                  const fixes = new Map<string, Partial<TopoBranch>>();
                  let byCoords = 0, byValue = 0;
                  for (const b of branches) {
                    if ((b.length ?? 0) > 0) continue;
                    const fn = nodesById.get(b.fromId);
                    const tn = nodesById.get(b.toId);
                    const auto = fn && tn ? Math.round(calcBranchLength(fn, tn)) : 0;
                    if (auto > 0) { byCoords++; fixes.set(b.id, { manualLength: false, length: auto }); }
                    else { byValue++; fixes.set(b.id, { manualLength: true, length: fallbackLen }); }
                  }
                  if (fixes.size === 0) return;
                  pushHistory();
                  setBranches(prev => prev.map(b => { const f = fixes.get(b.id); return f ? { ...b, ...f } : b; }));
                  const parts = [
                    byCoords ? `по координатам: ${byCoords}` : "",
                    byValue ? `вручную ${fallbackLen} м: ${byValue}` : "",
                  ].filter(Boolean).join(", ");
                  if (parts) toast.success(`Длина задана (${parts})`);
                }}
              />
            )}

            {/* ═══ ВКЛАДКА: ПАРАМЕТРЫ (узел) ════════════════════════════ */}
            {activeSide === "params" && selectedNode && (
              <NodePropsPanel
                node={selectedNode}
                onUpdate={(patch) => updateNode(selectedNode.id, patch)}
                onResetToSurvey={() => resetNodeToSurvey(selectedNode.id)}
              />
            )}

            {/* ═══ ВКЛАДКА: ТРУБЫ — узел (ППЗ) ══════════════════════════ */}
            {activeSide === "waterpipes" && selectedNode && (
              <NodeFirePanel
                node={selectedNode}
                onUpdate={(patch) => updateNode(selectedNode.id, patch)}
                waterResult={waterNetwork.nodeResults.get(selectedNode.id)}
                allNodes={nodes}
                allBranches={branches}
                allNodeResults={waterNetwork.nodeResults}
              />
            )}

            {/* ═══ ВКЛАДКА: АВАРИИ — узел (люди и средства защиты) ═══════ */}
            {activeSide === "accidents" && selectedNode && (
              <NodePeoplePanel
                node={selectedNode}
                onUpdate={(patch) => updateNode(selectedNode.id, patch)}
                allNodes={nodes}
              />
            )}

            {/* ═══ ВКЛАДКА: ПОЖАР (аварийный режим) ══════════════════════ */}
            {activeSide === "accidents" && !selectedNode && selectedBranch && (() => {
              const b = selectedBranch;
              const fr = fireResult?.branches.get(b.id);
              const fireSymId = schemaSymbols.find(s => FIRE_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
              const SH = "#fef2f2"; const SB = "1px solid #fecaca";
              const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
                <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                  <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>{label}</span>
                  <span className={`text-[11px] text-right flex-1 ${bold ? "font-bold text-red-700" : "text-gray-800"}`}>{value}</span>
                </div>
              );
              return (
                <div className="flex flex-col h-full overflow-y-auto" style={{ fontSize: 11 }}>
                  {/* Заголовок */}
                  <div className="flex items-center justify-between px-2 py-1" style={{ background: "var(--c-red-bg, #dc2626)", color: "white" }}>
                    <span className="font-semibold text-[12px]">🔥 Очаг пожара — ветвь {b.id}</span>
                    {fireSymId && (
                      <button onClick={() => {
                        removeSymbol(fireSymId.id);
                        updateBranch(b.id, { hasFire: false, fireVehicleSymbolOff: false, fireComputedTemp: 0, fireComputedNatDep: 0, fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0, originalFlow: undefined });
                        setFireResult(null); setFireCalcDone(false); resetNodeFireState();
                      }} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)" }}>
                        Убрать
                      </button>
                    )}
                  </div>

                  {/* Параметры очага */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "var(--c-red-ink, #991b1b)" }}>Параметры очага пожара</div>

                  {/* ── Положение очага в ветви (как в ПО «Вентиляция») ──
                      Ползунок двигает очаг от начала к концу выработки. Именно
                      он задаёт x (ф. 4.13) = расстояние от очага до устья по
                      ходу струи, а значит высоту столба горячих газов Δz (4.6)
                      и тепловую депрессию h_т (4.5). Очаг у входа нисходящей
                      выработки — максимальная тяга и опрокидывание, у выхода —
                      тяги практически нет. */}
                  {(() => {
                    const ft = b.fireT ?? 0.5;
                    const L = b.length ?? 0;
                    const pct = Math.round(ft * 100);
                    // Двигаем и символ на схеме, и расчётное поле ветви разом,
                    // иначе картинка разъедется с расчётом.
                    const moveFire = (v: number) => {
                      const t = Math.min(1, Math.max(0, v / 100));
                      updateBranch(b.id, { fireT: t });
                      if (fireSymId) {
                        setSchemaSymbols(prev => prev.map(s =>
                          s.id === fireSymId.id ? { ...s, t } : s));
                      }
                    };
                    const outFrac = (b.flow ?? 0) >= 0 ? (1 - ft) : ft;
                    return (
                      <>
                        <div className="flex items-center gap-1 px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}
                          title="Положение очага вдоль выработки: 0 % — у начального узла, 100 % — у конечного. Задаёт расстояние «очаг→устье» в формуле 4.13.">
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Очаг в ветви:</span>
                          <input type="range" min={0} max={100} step={1}
                            value={pct}
                            onChange={e => moveFire(Number(e.target.value))}
                            className="flex-1" style={{ accentColor: "#dc2626" }} />
                          <input type="number" min={0} max={100} step={1}
                            value={pct}
                            onChange={e => moveFire(Number(e.target.value) || 0)}
                            className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
                            style={{ fontSize: 11, height: 18 }} />
                          <span className="text-[11px] text-gray-500 flex-shrink-0">%</span>
                        </div>
                        <div className="px-1 py-0.5 text-[10px]" style={{ color: "var(--c-t3, #6b7280)", borderBottom: "1px solid #ebebeb" }}>
                          От начала ветви: {(L * ft).toFixed(1)} м · до устья по потоку: {(L * outFrac).toFixed(1)} м
                        </div>
                      </>
                    );
                  })()}

                  {/* ── Масштаб УО ── */}
                  {fireSymId && (() => {
                    const fireSym = schemaSymbols.find(s => s.id === fireSymId.id);
                    const updFireSym = (patch: Record<string, unknown>) =>
                      setSchemaSymbols(prev => prev.map(s => s.id === fireSymId.id ? { ...s, ...patch } : s));
                    const scaleVal = Math.round((fireSym?.scale ?? 1) * 100);
                    return (
                      <div className="flex items-center gap-1 px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Масштаб УО:</span>
                        <input type="range" min={5} max={400} step={5}
                          value={scaleVal}
                          onChange={e => updFireSym({ scale: Number(e.target.value) / 100 })}
                          className="flex-1" style={{ accentColor: "#dc2626" }} />
                        <input type="number" min={5} max={400} step={5}
                          value={scaleVal}
                          onChange={e => { const v = Math.min(400, Math.max(5, Number(e.target.value) || 100)); updFireSym({ scale: v / 100 }); }}
                          className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
                          style={{ fontSize: 11, height: 18 }} />
                        <span className="text-[11px] text-gray-500 flex-shrink-0">%</span>
                      </div>
                    );
                  })()}

                  <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                    <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Задаётся:</span>
                    <select value={b.fireMode ?? "heat"} onChange={e => updateBranch(b.id, { fireMode: e.target.value as "heat" | "temp" })}
                      className="flex-1 text-[11px] px-1" style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }}>
                      <option value="heat">Мощностью (МВт)</option>
                      <option value="temp">Температурой (°C)</option>
                    </select>
                  </div>

                  {(b.fireMode ?? "heat") === "heat" && (() => {
                    // Для материалов с авто-расчётом (кабель/дерево/конвейер/техника)
                    // мощность считается из свойств — поле только для чтения.
                    const autoP = calcFirePowerFromMaterial(b);
                    const isAuto = autoP != null && autoP > 0;
                    return (
                      <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Мощность пожара, МВт:</span>
                        <input type="number" step="0.5" min="0.1" max="100"
                          value={isAuto ? (Math.round(autoP! * 100) / 100) : (b.fireHeatRelease ?? 5)}
                          readOnly={isAuto}
                          onChange={e => { if (!isAuto) updateBranch(b.id, { fireHeatRelease: parseFloat(e.target.value) || 5 }); }}
                          className="flex-1 text-[11px] text-right px-1"
                          style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: isAuto ? "var(--c-s3, #f3f4f6)" : "white", color: isAuto ? "var(--c-t3, #6b7280)" : "inherit" }} />
                        {isAuto && <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">авто</span>}
                      </div>
                    );
                  })()}
                  {(b.fireMode ?? "heat") === "temp" && (
                    <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Температура очага, °C:</span>
                      <input type="number" step="10" min="50" max="1200"
                        value={b.fireTemperature ?? 300}
                        onChange={e => updateBranch(b.id, { fireTemperature: parseFloat(e.target.value) || 300 })}
                        className="flex-1 text-[11px] text-right px-1"
                        style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                    </div>
                  )}

                  <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                    <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Горючий материал:</span>
                    <select value={b.fireCombustible ?? "coal"} onChange={e => updateBranch(b.id, { fireCombustible: e.target.value })}
                      className="flex-1 text-[11px] px-1" style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }}>
                      {COMBUSTIBLES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  {/* ── Уголь / масло / произвольный: площадь очага и скорость выгорания ── */}
                  {["coal", "oil", "custom"].includes(b.fireCombustible ?? "coal") && (() => {
                    const comb = COMBUSTIBLES.find(c => c.id === (b.fireCombustible ?? "coal"));
                    const psiDefault = comb?.burnRate ?? 0.013;
                    const psi = (b.fireSourceBurnRate ?? 0) > 0 ? b.fireSourceBurnRate! : psiDefault;
                    const area = (b.fireSourceArea ?? 0) > 0 ? b.fireSourceArea! : (comb?.defaultArea ?? 5);
                    return (
                      <>
                        <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Площадь очага, м²:</span>
                          <input type="number" step="0.5" min="0.1" max="1000"
                            value={area}
                            onChange={e => updateBranch(b.id, { fireSourceArea: parseFloat(e.target.value) || 0 })}
                            className="flex-1 text-[11px] text-right px-1"
                            style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                        </div>
                        <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Скорость выгор. ψ, кг/(м²·с):</span>
                          <input type="number" step="0.001" min="0" max="1"
                            value={psi}
                            onChange={e => updateBranch(b.id, { fireSourceBurnRate: parseFloat(e.target.value) || 0 })}
                            className="flex-1 text-[11px] text-right px-1"
                            style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                        </div>
                      </>
                    );
                  })()}

                  {/* ── Техника: ввод масс материалов ── */}
                  {(b.fireCombustible ?? "coal") === "vehicle" && (() => {
                    const masses: [number, number, number] = [
                      b.fireVehicleMassRubber ?? 1200,
                      b.fireVehicleMassDiesel ?? 400,
                      b.fireVehicleMassOil    ?? 200,
                    ];
                    const airQ = Math.abs(b.flow ?? 0);
                    const vfr: VehicleFireResult = calcVehicleFire(masses, airQ);
                    return (
                      <>
                        {/* Заголовок блока ввода */}
                        <div className="px-1 py-0.5 text-[10px] font-semibold mt-0.5" style={{ background: "var(--c-tint-amber, #fff7ed)", borderBottom: "1px solid #fed7aa", color: "var(--c-amber, #c2410c)" }}>
                          Исходные данные — состав техники
                        </div>

                        {/* Таблица ввода масс */}
                        <div className="px-1 pt-1 pb-0.5">
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                            <thead>
                              <tr style={{ background: "var(--c-s2, #f5f5f5)" }}>
                                <th style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "left", fontWeight: 600 }}>Материал</th>
                                <th style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 600 }}>Масса, кг</th>
                              </tr>
                            </thead>
                            <tbody>
                              {VEHICLE_MATERIALS.map((mat, i) => {
                                const fieldKey = (["fireVehicleMassRubber", "fireVehicleMassDiesel", "fireVehicleMassOil"] as const)[i];
                                const val = masses[i];
                                return (
                                  <tr key={mat.name} style={{ background: i % 2 === 0 ? "var(--c-s1, #fff)" : "var(--c-s2, #fafafa)" }}>
                                    <td style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px" }}>{mat.name}</td>
                                    <td style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "1px 2px" }}>
                                      <input
                                        type="number" min="0" step="50"
                                        value={val}
                                        onChange={e => updateBranch(b.id, { [fieldKey]: parseFloat(e.target.value) || 0 })}
                                        style={{ width: "100%", border: "none", outline: "none", textAlign: "right", fontSize: 10, background: val > 0 ? "var(--c-tint-green2, #d1fae5)" : "var(--c-s1, #fff)", padding: "1px 3px" }}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Результаты расчёта мощности */}
                        {vfr.power_MW > 0 && (
                          <>
                            {/* Итоговые результаты */}
                            <div className="px-1 pb-0.5">
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                                <thead>
                                  <tr style={{ background: "var(--c-tint-amber2, #fef3c7)" }}>
                                    <th style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>Мощность, МВт</th>
                                    <th style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>Расход, м³/с</th>
                                    <th style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>t прод., °C</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700, color: "var(--c-red, #b91c1c)" }}>{safeFixed(vfr.power_MW, 2)}</td>
                                    <td style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", color: "var(--c-green, #15803d)" }}>{airQ > 0 ? safeFixed(airQ, 1) : "—"}</td>
                                    <td style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>{airQ > 0 ? safeFixed(vfr.deltaT_C + 20, 1) : "—"}</td>
                                  </tr>
                                </tbody>
                              </table>
                              <div className="flex items-center gap-3 mt-0.5 px-0.5">
                                <span style={{ fontSize: 10, color: "var(--c-t3, #6b7280)" }}>Время горения:</span>
                                <span style={{ fontSize: 10, fontWeight: 700 }}>{safeFixed(vfr.burnTime_h, 2)} ч</span>
                                <span style={{ fontSize: 10, color: "var(--c-t3, #6b7280)" }}>или</span>
                                <span style={{ fontSize: 10, fontWeight: 700 }}>{safeFixed(vfr.burnTime_min, 1)} мин</span>
                              </div>
                            </div>
                            {/* Мощность автоматически подставляется в расчёт пожара при нажатии кнопки «Расчёт» */}
                          </>
                        )}
                      </>
                    );
                  })()}

                  {/* ── Итог по горючему материалу (кроме техники — у неё своя
                      таблица выше). Кабель, лента, крепь, масло и произвольный
                      материал раньше показывали только поля ввода, и цифры
                      «Мощность / Расход / t прод.» приходилось угадывать до
                      нажатия «Расчёт пожара». Показываем их сразу — тем же
                      форматом, что и у техники. */}
                  {(b.fireCombustible ?? "coal") !== "vehicle" && (() => {
                    const sum = calcFireMaterialSummary(b);
                    if (!sum) return null;
                    const airQ = sum.airFlow_m3s;
                    return (
                      <div className="px-1 pt-1 pb-0.5">
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                          <thead>
                            <tr style={{ background: "var(--c-tint-amber2, #fef3c7)" }}>
                              <th style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>Мощность, МВт</th>
                              <th style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>Расход, м³/с</th>
                              <th style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>t прод., °C</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700, color: "var(--c-red, #b91c1c)" }}>{safeFixed(sum.power_MW, 2)}</td>
                              <td style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", color: "var(--c-green, #15803d)" }}>{airQ > 0 ? safeFixed(airQ, 1) : "—"}</td>
                              <td style={{ border: "1px solid var(--c-b2, #d1d5db)", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>{airQ > 0 ? safeFixed(sum.temp_C, 1) : "—"}</td>
                            </tr>
                          </tbody>
                        </table>
                        {sum.hasBurnTime && (
                          <div className="flex items-center gap-3 mt-0.5 px-0.5">
                            <span style={{ fontSize: 10, color: "var(--c-t3, #6b7280)" }}>Время горения:</span>
                            <span style={{ fontSize: 10, fontWeight: 700 }}>{safeFixed(sum.burnTime_h, 2)} ч</span>
                            <span style={{ fontSize: 10, color: "var(--c-t3, #6b7280)" }}>или</span>
                            <span style={{ fontSize: 10, fontWeight: 700 }}>{safeFixed(sum.burnTime_min, 1)} мин</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Исходные данные расчёта (задаются ДО «Расчёта пожара») ──
                      Время пожара, расстояние «очаг→устье» и порог видимости
                      задымления раньше были разбросаны: первые два появлялись
                      только в блоке РЕЗУЛЬТАТОВ (то есть уже после расчёта), а
                      порог видимости жил в нижней панели задымления. Пользователь
                      не видел исходных данных, пока считал, и узнавал о них по
                      факту — со значениями по умолчанию. Собираем их здесь, до
                      кнопки расчёта, чтобы ситуация была понятна сразу. */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "var(--c-red-ink, #991b1b)" }}>Исходные данные расчёта</div>
                  {/* Выбор метода тоже перенесён сюда: от него зависит, нужны ли
                      время пожара и расстояние «очаг→устье». Оставь он в блоке
                      результатов — до первого расчёта переключить метод было бы
                      нельзя, и поля норматива просто не показались бы. */}
                  <div className="px-1 py-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                    <div className="text-[10px] text-gray-600 mb-0.5">Метод тепловой депрессии:</div>
                    <div className="flex gap-1">
                      {([
                        { id: "aerosети" as ThermalDepMethod, label: "Методика" },
                        { id: "normative" as ThermalDepMethod, label: "Норматив (4.5)" },
                      ]).map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => changeThermalDepMethod(opt.id)}
                          className="text-[10px] px-1.5 py-0.5 rounded flex-1"
                          style={{
                            background: thermalDepMethod === opt.id ? "var(--c-red-ink, #991b1b)" : "var(--c-s3, #f3f4f6)",
                            color: thermalDepMethod === opt.id ? "#fff" : "var(--c-t2, #374151)",
                            border: `1px solid ${thermalDepMethod === opt.id ? "var(--c-red-ink, #991b1b)" : "var(--c-b2, #d1d5db)"}`,
                          }}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  {thermalDepMethod === "normative" && (
                    <>
                      <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}
                        title="t — время с момента возникновения пожара (ф. 4.8), не более 150 мин">
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Время пожара t, мин:</span>
                        <input type="number" min={1} max={NORMATIVE_TIME_MAX_MIN} step={5}
                          value={normFireTime}
                          onChange={e => changeNormFireTime(parseFloat(e.target.value))}
                          className="flex-1 text-[11px] text-right px-1"
                          style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                      </div>
                      {/* x (ф. 4.13) больше НЕ вводится вручную: он однозначно
                          следует из положения очага в ветви (ползунок «Очаг в
                          ветви» выше) и направления струи. Ручное поле давало
                          противоречие — очаг двигают, а x стоит на месте. */}
                      {(() => {
                        const ft = b.fireT ?? 0.5;
                        const outFrac = (b.flow ?? 0) >= 0 ? (1 - ft) : ft;
                        const xAuto = (b.length ?? 0) * outFrac;
                        return (
                          <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}
                            title="x — расстояние от очага до устья выработки по ходу струи (ф. 4.13). Считается автоматически по положению очага в ветви.">
                            <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Очаг→устье x, м:</span>
                            <span className="flex-1 text-[11px] text-right px-1 text-gray-700">{xAuto.toFixed(1)}</span>
                            <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">авто</span>
                          </div>
                        );
                      })()}
                    </>
                  )}
                  <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}
                    title="Дым распространяется, пока видимость в дыму ниже этого порога; дальше считается чистый воздух.">
                    <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Порог видимости, м:</span>
                    <input type="number" min={1} max={1000} step={5}
                      value={smokeVisThreshold}
                      onChange={e => setSmokeVisThreshold(Math.max(1, Math.min(1000, Number(e.target.value))))}
                      className="flex-1 text-[11px] text-right px-1"
                      style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                  </div>

                  {/* Контекст из сетевого расчёта */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "var(--c-red-ink, #991b1b)" }}>Вентиляционный режим (из расчёта сети)</div>
                  <Row label="Расход воздуха Q, м³/с:" value={Math.abs(b.flow) > 0.001 ? `${Math.abs(b.flow).toFixed(2)}` : "— (не рассчитан)"} />
                  <Row label="Скорость воздуха, м/с:" value={b.velocity > 0 ? `${b.velocity.toFixed(2)}` : "—"} />
                  {/* ОБЩАЯ депрессия: выработка + вентсооружение. Именно она
                      участвует в проверке опрокидывания при пожаре. */}
                  <Row label="Общая депрессия ΔP, Па:" value={(() => {
                    const dpT = totalDepByBranch.get(b.id);
                    return dpT !== undefined && Math.abs(dpT) > 0.001 ? `${Math.abs(dpT).toFixed(1)}` : (b.dP ? `${Math.abs(b.dP).toFixed(1)}` : "—");
                  })()} />
                  <Row label="в т.ч. выработка, Па:" value={b.dP ? `${Math.abs(b.dP).toFixed(1)}` : "—"} />
                  <Row label="Угол наклона, °:" value={`${(b.angle ?? 0).toFixed(1)}`} />
                  <Row label="Длина ветви, м:" value={`${b.length.toFixed(1)}`} />
                  {Math.abs(b.flow) < 0.001 && (
                    <div className="px-2 py-1 mx-1 my-1 text-[10px] rounded" style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fcd34d", color: "var(--c-amber-ink, #92400e)" }}>
                      Сначала выполните расчёт вентиляционной сети (F9), затем запустите расчёт пожара
                    </div>
                  )}

                  {/* Результаты расчёта пожара */}
                  {fr && (
                    <>
                      <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "var(--c-red-ink, #991b1b)" }}>Результаты расчёта пожара</div>
                      {/* Ввод исходных данных (метод, время пожара, очаг→устье,
                          порог видимости) перенесён выше — в блок «Исходные данные
                          расчёта», видимый ДО нажатия «Расчёт пожара». В
                          результатах ввода больше нет: правка полей после расчёта
                          выглядела бы так, будто она уже учтена в показанных
                          цифрах, хотя применяется только при следующем расчёте.
                          Здесь лишь напоминаем, каким методом получен результат. */}
                      <Row label="Метод тепловой депрессии:"
                        value={thermalDepMethod === "normative" ? "Норматив (4.5)" : "Методика"} />
                      <Row label="Температура продуктов, °C:" value={safeFixed(fr.airTempOut, 1)} bold />
                      <Row label="Тепловая депрессия h_t, Па:" value={safeFixed(fr.thermalDepression, 1)} bold={Math.abs(fr.thermalDepression) > 10} />
                      {fr.normative && (
                        <>
                          <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "var(--c-t2, #374151)" }}>Норматив (формулы 4.5–4.13)</div>
                          <Row label="Длина зоны горения l, м:" value={safeFixed(fr.normative.l, 1)} />
                          <Row label="Очаг→устье x, м:" value={safeFixed(fr.normative.x, 1)} />
                          <Row label="Столб горячих газов, м:" value={safeFixed(fr.normative.lCol, 1)} />
                          <Row label="Δz = l_ст·sinβ, м:" value={safeFixed(fr.normative.dz, 1)} />
                          {fr.normative.clampedByGeometry && (
                            <>
                              <Row label="по ф. 4.8 без огранич. l, м:" value={safeFixed(fr.normative.lNorm, 1)} />
                              <Row label="по ф. 4.6 без огранич. Δz, м:" value={safeFixed(fr.normative.dzNorm, 1)} />
                              <div className="px-1 py-0.5 text-[9px]" style={{ color: "var(--c-t3, #6b7280)", borderBottom: "1px solid #ebebeb" }}>
                                Зона горения по ф. 4.8 не помещается в выработку — l и Δz ограничены её длиной и перепадом отметок узлов.
                              </div>
                            </>
                          )}
                          <Row label="Коэффициент A:" value={safeFixed(fr.normative.A, 3)} />
                          <Row label="Коэффициент a:" value={safeFixed(fr.normative.a, 3)} />
                          <Row label="Tм в очаге, K:" value={`${fr.normative.Tm} (${safeFixed(fr.normative.Tm - 273, 0)} °C)`} />
                          <Row label="Tк на устье, K:" value={`${fr.normative.Tk} (${safeFixed(fr.normative.Tk - 273, 0)} °C)`} />
                        </>
                      )}
                      {fr.critical && (
                        <>
                          {(() => {
                            const fm = fr.critical.formula;
                            const title = fm === "field" ? "Критическая депрессия (уклонное поле)" : `Критическая депрессия (${fm})`;
                            const note = fm === "5.3" ? "h_кр = 0.9·r_п·(Q+Q_п)²"
                              : fm === "5.4" ? "с учётом сбоек с перемычками: h_кр = 0.85·(Q+Q_п)²·[…]"
                              : fm === "5.5" ? `приведение ${fr.critical!.parallelCount} параллельных выработок (r_п по 5.5)`
                              : "≈ депрессии всего уклонного поля (одна воздухоподающая выработка)";
                            return (
                              <>
                                <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "var(--c-t2, #374151)" }}>{title}</div>
                                <div className="px-1 py-0.5 text-[9px]" style={{ color: "var(--c-t3, #6b7280)", borderBottom: "1px solid #ebebeb" }}>{note}</div>
                              </>
                            );
                          })()}
                          <Row label="Крит. депрессия h_кр, Па:" value={safeFixed(fr.critical.h_kr, 1)} bold />
                          {fr.critical.formula !== "field" && <Row label="Сопр. параллельной r_п:" value={safeFixed(fr.critical.r_p, 4)} />}
                          {fr.critical.formula !== "field" && <Row label="Расход паралл. Q_п, м³/с:" value={safeFixed(fr.critical.Q_p, 2)} />}
                          {fr.critical.parallelCount > 1 && <Row label="Параллельных выработок:" value={String(fr.critical.parallelCount)} />}
                          <div className="flex items-center px-1 py-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                            <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Запас устойчивости, Па:</span>
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{
                              background: fr.critical.exceedsCritical ? "var(--c-tint-red, #fef2f2)" : "var(--c-tint-green, #f0fdf4)",
                              color: fr.critical.exceedsCritical ? "var(--c-red, #dc2626)" : "var(--c-green, #16a34a)",
                              border: `1px solid ${fr.critical.exceedsCritical ? "#fca5a5" : "#86efac"}`,
                            }}>
                              {fr.critical.margin > 0 ? "+" : ""}{safeFixed(fr.critical.margin, 1)} ({fr.critical.exceedsCritical ? "|h_t| ≥ h_кр" : "|h_t| < h_кр"})
                            </span>
                          </div>
                          {/* Показатель устойчивости p_у = h_кр/h_т (Прил. 3, ф. 3.1) */}
                          <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "var(--c-t2, #374151)" }}>Устойчивость проветривания (3.1)</div>
                          <Row label="Показатель p_у = h_кр/h_т:" value={safeFixed(fr.critical.p_u, 2)} bold />
                          <div className="flex items-center px-1 py-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                            <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Класс выработки:</span>
                            {(() => {
                              const st = fr.critical.stability;
                              const cfg = st === "stable"
                                ? { bg: "#f0fdf4", fg: "#15803d", bd: "#86efac", txt: "✓ Устойчивая (p_у > 1)" }
                                : st === "very-unstable"
                                  ? { bg: "#450a0a", fg: "#fecaca", bd: "#7f1d1d", txt: "⚠ Весьма неустойчивая (p_у < 0.3)" }
                                  : { bg: "#fffbeb", fg: "#b45309", bd: "#fcd34d", txt: "△ Неустойчивая (p_у < 1)" };
                              return (
                                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.bd}` }}>
                                  {cfg.txt}
                                </span>
                              );
                            })()}
                          </div>
                        </>
                      )}
                      {(fr.flowDelta ?? 0) !== 0 && (
                        <Row label="Изм. расхода ΔQ, м³/с:" value={`${fr.flowDelta! > 0 ? "+" : ""}${safeFixed(fr.flowDelta, 2)}`} bold={Math.abs(fr.flowDelta!) > 1} />
                      )}
                      {/* h–Q диаграмма уклонного поля (Прил. 2): нисходящее — рис. 2.1,б, восходящее — рис. 2.2 */}
                      {(() => {
                        const Ry = b.resistance ?? 0;
                        const Qa = Math.abs(b.originalFlow ?? b.flow ?? 0);
                        const Qb = fr.actuallyReversed ? -Math.abs(b.flow ?? 0) : Math.abs(b.flow ?? 0);
                        if (Ry <= 0 || (Qa < 0.01 && Math.abs(Qb) < 0.01)) return null;
                        // Восходящее/нисходящее берём ИЗ ЯДРА (fr.ascending) — единый
                        // источник истины с расчётом опрокидывания, чтобы диаграмма и
                        // расчёт всегда показывали одно направление.
                        const ascending = fr.ascending;
                        return (
                          <div className="px-1 py-1 mt-1">
                            <div className="flex items-center justify-between mb-1">
                              <div className="text-[10px] font-semibold" style={{ color: "var(--c-red-ink, #991b1b)" }}>
                                Режим проветривания уклонного поля (h–Q, {ascending ? "восходящее, рис. 2.2" : "нисходящее, рис. 2.1,б"})
                              </div>
                              <button
                                onClick={() => setHqDialogData({
                                  Ry, Qa, Qb,
                                  hT: Math.abs(fr.thermalDepression),
                                  hKr: fr.critical?.h_kr,
                                  pU: fr.critical?.p_u,
                                  reversed: fr.actuallyReversed,
                                  ascending,
                                  branchName: `Ветвь ${b.id}${b.type ? ` — ${b.type}` : ""}`,
                                })}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded border bg-white hover:bg-gray-50 shrink-0"
                                style={{ borderColor: "var(--c-b2, #d1d5db)", color: "var(--c-t2, #374151)" }}
                                title="Увеличить диаграмму и экспортировать в Excel"
                              >
                                <Icon name="Maximize2" size={10} /> Увеличить
                              </button>
                            </div>
                            <div
                              onClick={() => setHqDialogData({
                                Ry, Qa, Qb,
                                hT: Math.abs(fr.thermalDepression),
                                hKr: fr.critical?.h_kr,
                                pU: fr.critical?.p_u,
                                reversed: fr.actuallyReversed,
                                ascending,
                                branchName: `Ветвь ${b.id}${b.type ? ` — ${b.type}` : ""}`,
                              })}
                              style={{ cursor: "zoom-in" }}
                              title="Нажмите, чтобы открыть диаграмму в увеличенном виде"
                            >
                              <HQFireDiagram
                                Ry={Ry}
                                Qa={Qa}
                                Qb={Qb}
                                hT={Math.abs(fr.thermalDepression)}
                                hKr={fr.critical?.h_kr}
                                pU={fr.critical?.p_u}
                                reversed={fr.actuallyReversed}
                                ascending={ascending}
                              />
                            </div>
                            {ascending ? (
                              <>
                                <div className="mt-1 text-[9px] leading-relaxed" style={{ color: "var(--c-t3, #6b7280)" }}>
                                  <span style={{ color: "var(--c-blue, #0369a1)", fontWeight: 700 }}>A</span> — режим до пожара (Q={safeFixed(Qa, 1)} м³/с) ·{" "}
                                  <span style={{ color: "var(--c-red, #dc2626)", fontWeight: 700 }}>E</span> — при пожаре (Q={safeFixed(Math.abs(Qb), 1)} м³/с, расход растёт) ·{" "}
                                  <span style={{ color: "var(--c-purple, #7c3aed)", fontWeight: 700 }}>F</span> — критическая: h_т=R·Q₀² (депрессия ВГП=0) ·{" "}
                                  <span style={{ color: "#450a0a", fontWeight: 700 }}>K</span> — ВГП как сопротивление
                                </div>
                                <div className="mt-0.5 text-[9px]" style={{ color: "var(--c-green, #16a34a)" }}>
                                  Восходящее проветривание: тепловая депрессия сонаправлена с депрессией ВГП, расход воздуха увеличивается — струя устойчива (2.3).
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="mt-1 text-[9px] leading-relaxed" style={{ color: "var(--c-t3, #6b7280)" }}>
                                  <span style={{ color: "var(--c-blue, #0369a1)", fontWeight: 700 }}>A</span> — режим до пожара (Q={safeFixed(Qa, 1)} м³/с) ·{" "}
                                  <span style={{ color: "var(--c-red, #dc2626)", fontWeight: 700 }}>B</span> — при пожаре (Q={safeFixed(Math.abs(Qb), 1)} м³/с) ·{" "}
                                  <span style={{ color: "var(--c-purple, #7c3aed)", fontWeight: 700 }}>C</span> — критическая (Q=0){fr.actuallyReversed ? " · " : ""}
                                  {fr.actuallyReversed && <><span style={{ color: "#450a0a", fontWeight: 700 }}>D</span> — опрокидывание струи</>}
                                </div>
                                <div className="mt-0.5 text-[9px]" style={{ color: fr.actuallyReversed ? "var(--c-red, #dc2626)" : (fr.critical?.exceedsCritical ? "var(--c-amber, #c2410c)" : "var(--c-green, #16a34a)") }}>
                                  {fr.actuallyReversed
                                    ? "Режим D: струя опрокинута, рециркуляция продуктов горения в контуре «уклон + верхняя сбойка»."
                                    : fr.critical?.exceedsCritical
                                      ? "Режим C: |h_т| ≥ h_кр — воздух в уклонное поле практически не поступает (неустойчиво)."
                                      : "Режим B: нормальное направление струи сохраняется (устойчиво)."}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}
                      <Row label="Концентрация CO, %:" value={safeFixed(fr.coConc, 3)} bold={fr.coConc > 0.02} />
                      <Row label="Концентрация CO₂, %:" value={safeFixed(fr.co2Conc, 2)} bold={fr.co2Conc > 1} />
                      <Row label="Опт. плотность дыма, м⁻¹:" value={safeFixed(fr.smokeDensity, 2)} />
                      <Row label="Видимость в дыму, м:" value={safeFixed(fr.visibility, 1)} bold={fr.visibility < 5} />
                      {/* Время задымления */}
                      {(() => {
                        if (b.hasFire) {
                          return <Row label="Время задымления:" value="Очаг пожара (0 мин)" bold />;
                        }
                        const speed = fr.airSpeed ?? 0;
                        const arrT = fr.smokeArrivalTime;
                        const transitMin = speed > 0 && b.length > 0 ? b.length / speed / 60 : 0;
                        const fillT = Math.min(600, arrT + transitMin);
                        return (
                          <>
                            <Row
                              label="Дым входит через:"
                              value={arrT === 0 ? "сразу" : `${safeFixed(arrT, 1)} мин`}
                              bold={arrT < 5}
                            />
                            <Row
                              label="Ветвь заполнится через:"
                              value={speed > 0 ? `${safeFixed(fillT, 1)} мин` : "—"}
                              bold={fillT < 10}
                            />
                            <Row
                              label="Скорость воздуха, м/с:"
                              value={speed > 0 ? safeFixed(speed, 2) : "—"}
                            />
                          </>
                        );
                      })()}
                      <div className="flex items-center px-1 py-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Устойчивость струи:</span>
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{
                          background: fr.actuallyReversed ? "#450a0a" : fr.willReverse ? "var(--c-tint-red, #fef2f2)" : "var(--c-tint-green, #f0fdf4)",
                          color: fr.actuallyReversed ? "#fef2f2" : fr.willReverse ? "var(--c-red, #dc2626)" : "var(--c-green, #16a34a)",
                          border: `1px solid ${fr.actuallyReversed ? "#7f1d1d" : fr.willReverse ? "#fca5a5" : "#86efac"}`,
                        }}>
                          {fr.actuallyReversed ? "🔄 Опрокинута" : fr.willReverse ? "⚠️ Риск опрокидывания" : "✓ Устойчива"}
                        </span>
                      </div>
                      <div className="flex items-center px-1 py-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Опасность для людей:</span>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{
                          background: fr.hazardLevel === "lethal" ? "#7f1d1d" : fr.hazardLevel === "danger" ? "var(--c-red, #dc2626)" : fr.hazardLevel === "warning" ? "var(--c-amber-lt, #f59e0b)" : "var(--c-green, #16a34a)",
                          color: "white",
                        }}>
                          {fr.hazardLevel === "lethal" ? "💀 Смертельная" : fr.hazardLevel === "danger" ? "🔴 Опасная" : fr.hazardLevel === "warning" ? "⚠️ Предупреждение" : "✅ Безопасно"}
                        </span>
                      </div>
                      {fr.actuallyReversed && (
                        <div className="px-2 py-2 mx-1 my-1 text-[11px] rounded" style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fecaca" }}>
                          <div className="font-bold mb-1" style={{ color: "#fca5a5", fontSize: 12 }}>🔄 Опрокидывание подтверждено расчётом</div>
                          <div style={{ lineHeight: 1.6 }}>
                            Поток изменил направление: Q = <strong>{(b.flow ?? 0).toFixed(2)} м³/с</strong><br/>
                            Тепловая депрессия пожара: <strong>{Math.abs(fr.thermalDepression).toFixed(0)} Па</strong><br/>
                            Нисходящее проветривание опрокинуто — продукты горения распространяются в обратном направлении.
                          </div>
                        </div>
                      )}
                      {!fr.actuallyReversed && fr.willReverse && (
                        <div className="px-2 py-2 mx-1 my-1 text-[10px] rounded" style={{ background: "var(--c-tint-red, #fef2f2)", border: "1px solid #fca5a5", color: "var(--c-red, #dc2626)" }}>
                          <strong>Риск опрокидывания!</strong> Тепловая депрессия пожара ({Math.abs(fr.thermalDepression).toFixed(0)} Па) близка к аэродинамической депрессии ветви. При увеличении мощности пожара возможна смена направления потока.
                        </div>
                      )}
                    </>
                  )}
                  {!fr && fireCalcDone && (() => {
                    // Показываем потенциальное время задымления для незатронутых ветвей
                    const airQ = Math.abs(b.flow ?? 0);
                    const speed = airQ > 0 && b.area > 0 ? airQ / b.area : 0;
                    return (
                      <div style={{ margin: 4 }}>
                        <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: "var(--c-tint-green, #f0fdf4)", border: "1px solid #86efac", borderRadius: "var(--radius-ui)", color: "var(--c-green, #15803d)" }}>
                          ✅ Ветвь не затронута задымлением
                        </div>
                        {speed > 0 && b.length > 0 && (
                          <div className="mt-1 px-2 py-1.5 text-[10px]" style={{ background: "var(--c-s2, #f8fafc)", border: "1px solid var(--c-b1, #e2e8f0)", borderRadius: "var(--radius-ui)", color: "var(--c-t3, #475569)" }}>
                            <div className="font-semibold mb-0.5 text-[11px]">Справочно (если дым войдёт):</div>
                            <div className="flex justify-between">
                              <span>Скорость воздуха:</span>
                              <span className="font-medium">{speed.toFixed(2)} м/с</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Время заполнения:</span>
                              <span className="font-medium">{(b.length / speed / 60).toFixed(1)} мин</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {!fireCalcDone && (
                    <div className="px-2 py-2 text-[11px] text-orange-700" style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fcd34d", margin: 4, borderRadius: "var(--radius-ui)" }}>
                      Нажмите «Расчёт пожара» на вкладке Аварии для получения результатов
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ═══ ВКЛАДКА: ВЗРЫВ (аварийный режим) ════════════════════════ */}
            {activeSide === "blast" && !selectedNode && selectedBranch && (() => {
              const b = selectedBranch;
              const expSymId = schemaSymbols.find(s => EXPLOSION_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
              const SH = "#fffbeb"; const SB = "1px solid #fde68a";
              const Row = ({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) => (
                <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <span className="text-[11px] text-gray-500 flex-shrink-0" style={{ width: 148 }}>{label}</span>
                  <span className={`text-[11px] text-right flex-1 ${bold ? "font-bold" : ""}`} style={{ color: color ?? (bold ? "var(--c-amber, #b45309)" : "var(--c-t1, #1f2937)") }}>{value}</span>
                </div>
              );
              return (
                <div className="flex flex-col h-full overflow-y-auto" style={{ fontSize: 11 }}>

                  {/* Заголовок */}
                  <div className="flex items-center justify-between px-2 py-1.5" style={{ background: "var(--c-amber-bg, #f59e0b)", color: "white" }}>
                    <span className="font-semibold text-[12px]">💥 Источник взрыва — ветвь {b.id}</span>
                    {expSymId && (
                      <button onClick={() => {
                        removeSymbol(expSymId.id);
                        updateBranch(b.id, { hasExplosion: false, explosionComputedQtnt: 0, explosionComputedMaxP: 0, explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0, explosionComputedR_heavy: 0, explosionComputedR_medium: 0, explosionComputedR_light: 0, explosionComputedDeltaP: 0 });
                        setExplosionResult(null); setExplosionResultByBranch(new Map()); setExplosionBarriers(null); setExplosionCalcDone(false);
                      }} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)" }}>
                        Убрать
                      </button>
                    )}
                  </div>

                  {/* ── Положение места взрыва и масштаб УО ── */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "var(--c-amber-ink, #92400e)" }}>Параметры места взрыва</div>
                  {(() => {
                    const et = b.explosionT ?? 0.5;
                    const L = b.length ?? 0;
                    const pct = Math.round(et * 100);
                    // Двигаем и символ на схеме, и расчётное поле ветви разом.
                    const moveExp = (v: number) => {
                      const t = Math.min(1, Math.max(0, v / 100));
                      updateBranch(b.id, { explosionT: t });
                      if (expSymId) {
                        setSchemaSymbols(prev => prev.map(s =>
                          s.id === expSymId.id ? { ...s, t } : s));
                      }
                    };
                    return (
                      <>
                        <div className="flex items-center gap-1 px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}
                          title="Положение места взрыва вдоль выработки: 0 % — у начального узла, 100 % — у конечного.">
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Взрыв в ветви:</span>
                          <input type="range" min={0} max={100} step={1}
                            value={pct}
                            onChange={e => moveExp(Number(e.target.value))}
                            className="flex-1" style={{ accentColor: "#d97706" }} />
                          <input type="number" min={0} max={100} step={1}
                            value={pct}
                            onChange={e => moveExp(Number(e.target.value) || 0)}
                            className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
                            style={{ fontSize: 11, height: 18 }} />
                          <span className="text-[11px] text-gray-500 flex-shrink-0">%</span>
                        </div>
                        <div className="px-1 py-0.5 text-[10px]" style={{ color: "var(--c-t3, #6b7280)", borderBottom: "1px solid #ebebeb" }}>
                          От начала ветви: {(L * et).toFixed(1)} м · до конца ветви: {(L * (1 - et)).toFixed(1)} м
                        </div>
                      </>
                    );
                  })()}
                  {expSymId && (() => {
                    const expSym = schemaSymbols.find(s => s.id === expSymId.id);
                    const updExpSym = (patch: Record<string, unknown>) =>
                      setSchemaSymbols(prev => prev.map(s => s.id === expSymId.id ? { ...s, ...patch } : s));
                    const scaleVal = Math.round((expSym?.scale ?? 1) * 100);
                    return (
                      <div className="flex items-center gap-1 px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Масштаб УО:</span>
                        <input type="range" min={5} max={400} step={5}
                          value={scaleVal}
                          onChange={e => updExpSym({ scale: Number(e.target.value) / 100 })}
                          className="flex-1" style={{ accentColor: "#d97706" }} />
                        <input type="number" min={5} max={400} step={5}
                          value={scaleVal}
                          onChange={e => { const v = Math.min(400, Math.max(5, Number(e.target.value) || 100)); updExpSym({ scale: v / 100 }); }}
                          className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
                          style={{ fontSize: 11, height: 18 }} />
                        <span className="text-[11px] text-gray-500 flex-shrink-0">%</span>
                      </div>
                    );
                  })()}

                  {/* Методика */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "var(--c-amber-ink, #92400e)" }}>Алгоритм расчёта</div>
                  <div className="flex flex-col gap-1 px-2 py-1.5" style={{ borderBottom: SB }}>
                    <span className="text-[10px] text-gray-700 leading-tight">
                      {(b.explosionSourceType ?? "gas") === "gas" && (b.explosionGasMethod ?? "vgsch") === "vgsch"
                        ? <>Методика определения параметров УВВ при взрывах газов и пыли в горных
                          выработках (Прил. 12 к Уставу ВГСЧ). Перемычки разрушаются при давлении
                          во фронте не ниже давления разрушения (табл. 8); устоявшие волну задерживают.</>
                        : <>Методика газодинамического расчёта параметров воздушных ударных волн
                          (формула Садовского), тротиловый эквивалент — по Методике №415.</>}
                    </span>
                    {b.explosionMethod === "fnip_494" && (
                      <span className="text-[10px] leading-tight px-1.5 py-1 rounded"
                        style={{ background: "var(--c-tint-amber, #fef9c3)", border: "1px solid #fde047", color: "#713f12" }}>
                        В проекте была выбрана методика «ФНиП №494». Этот режим убран:
                        в ФНиП №494 расчётных формул ударной волны нет, а прежняя формула
                        завышала давление на дальних расстояниях. Расчёт выполнен
                        газодинамическим методом.
                      </span>
                    )}
                  </div>

                  {/* Настройки */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "var(--c-amber-ink, #92400e)" }}>Настройки</div>
                  <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <input type="checkbox" id={`exp_walls_${b.id}`}
                      checked={b.explosionConsiderWalls ?? true}
                      onChange={e => updateBranch(b.id, { explosionConsiderWalls: e.target.checked })} />
                    <label htmlFor={`exp_walls_${b.id}`} className="text-[11px] text-gray-700 cursor-pointer">Учитывать отражение от стенок выработки</label>
                  </div>

                  {/* Способ задания */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "var(--c-amber-ink, #92400e)" }}>Задание энергии взрыва</div>
                  <div className="flex items-center px-2 py-1" style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Способ:</span>
                    <select value={b.explosionSourceType ?? "gas"}
                      onChange={e => updateBranch(b.id, { explosionSourceType: e.target.value as ExplosionSourceType })}
                      className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }}>
                      <option value="gas">По газу</option>
                      <option value="mass">По массе вещества</option>
                    </select>
                  </div>

                  {/* По газу */}
                  {(b.explosionSourceType ?? "gas") === "gas" && (<>
                    <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Горючее вещество:</span>
                      <select value={b.explosionGasId ?? "methane"}
                        onChange={e => {
                          // У газов концентрация в % объёма, у пыли — в г/м³.
                          // При смене вещества переносим значение из другой
                          // единицы измерения на стехиометрию нового: 9.5 г/м³
                          // пыли — это ниже НПВ, расчёт молча дал бы ноль.
                          const next = GAS_TYPES.find(g => g.id === e.target.value);
                          const prev = GAS_TYPES.find(g => g.id === (b.explosionGasId ?? "methane"));
                          const patch: Partial<TopoBranch> = { explosionGasId: e.target.value };
                          if (next && prev && next.unit !== prev.unit) patch.explosionGasConcentration = next.stoichConc;
                          updateBranch(b.id, patch);
                        }}
                        className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }}>
                        {GAS_TYPES.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>
                    {/* Методика расчёта газа и пыли. По умолчанию — Методика ВГСЧ
                        (Прил. 12 к Уставу ВГСЧ); прежняя модель «как в Аэросети»
                        оставлена для сверки со старыми расчётами. */}
                    <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Методика:</span>
                      <select value={b.explosionGasMethod ?? "vgsch"}
                        onChange={e => updateBranch(b.id, { explosionGasMethod: e.target.value as "vgsch" | "aeroset" })}
                        className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }}>
                        <option value="vgsch">ВГСЧ (Прил. 12 к Уставу ВГСЧ)</option>
                        <option value="aeroset">Прямолинейная</option>
                      </select>
                    </div>
                    {(b.explosionGasMethod ?? "vgsch") === "vgsch" && (<>
                      <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Вид взрыва (табл. 2):</span>
                        <select value={b.explosionCombustionMode ?? "detonation"}
                          onChange={e => updateBranch(b.id, { explosionCombustionMode: e.target.value as CombustionMode })}
                          className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }}>
                          {COMBUSTION_MODES.map(m => <option key={m.id} value={m.id}>{m.label} — μ {m.mu}</option>)}
                        </select>
                      </div>
                      <label className="flex items-center gap-1.5 px-2 py-1 cursor-pointer" style={{ borderBottom: "1px solid #f3f4f6" }}>
                        {(() => {
                          const cm = combustionMode(b.explosionCombustionMode);
                          // У детонации пыль не меняет ΔPн (предельный режим, 0,30 МПа),
                          // у видов «с участием пыли» она уже учтена в табл. 2.
                          const locked = cm.id !== "deflagration";
                          return (<>
                            <input type="checkbox" disabled={locked}
                              checked={cm.dust || (cm.id === "deflagration" && b.explosionDust === true)}
                              onChange={e => updateBranch(b.id, { explosionDust: e.target.checked })} />
                            <span className={`text-[11px] ${locked ? "text-gray-400" : "text-gray-700"}`}>
                              Участие угольной пыли
                              <span className="block text-[9px] text-gray-400">
                                {cm.id === "detonation"
                                  ? "не влияет: детонация — предельный режим (0,30 МПа)"
                                  : cm.dust
                                    ? "уже учтено видом взрыва (табл. 2), энергия × 1,3"
                                    : "переводит в «дефлаграцию с участием пыли» (табл. 2), энергия × 1,3"}
                              </span>
                            </span>
                          </>);
                        })()}
                      </label>
                      <div className="mx-2 my-1 px-2 py-1 rounded text-[10px]"
                        style={{ background: "var(--c-tint-blue, #eff6ff)", border: "1px solid #b0cfdc", color: "var(--c-blue-ink, #1e3a8a)" }}>
                        Если вид взрыва установить достоверно нельзя — методика требует считать детонацию.
                        Кз берётся по α выработок (табл. 3), в узлах — коэффициент затекания (табл. 5).
                      </div>
                    </>)}
                    {/* Источник задаётся ДЛИНОЙ загазованного участка (как в
                        «Аэросети»), а объём смеси считается как длина × сечение.
                        Раньше вводился объём и трактовался буквально: 100 м³
                        при сечении 12 м² — это лишь 8 м выработки, отчего
                        энергия занижалась в разы. */}
                    {/* Длина зоны: руками либо расчётом по метановыделению
                        (РБ №343, ф. 1/3/5). Расчёт выключен по умолчанию —
                        исходные данные (дебит метана, мощность пласта) есть не
                        всегда, а старые проекты должны считаться как прежде. */}
                    <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <input type="checkbox" id={`gz_auto_${b.id}`}
                        checked={b.explosionGasZoneAuto === true}
                        onChange={e => updateBranch(b.id, { explosionGasZoneAuto: e.target.checked })} />
                      <label htmlFor={`gz_auto_${b.id}`} className="text-[11px] text-gray-700 cursor-pointer">
                        Считать зону по метановыделению
                        <span className="block text-[9px] text-gray-400">РБ №343, п. 7–13, формулы (1)–(5)</span>
                      </label>
                    </div>

                    {b.explosionGasZoneAuto !== true ? (
                      <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Длина загазов. участка, м:</span>
                        <input type="number" step="10" min="1"
                          value={b.explosionGasZoneLength ?? 100}
                          onChange={e => updateBranch(b.id, { explosionGasZoneLength: parseFloat(e.target.value) || 100 })}
                          className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }} />
                      </div>
                    ) : (<>
                      {/* Время загазирования — общее условие расчёта, а не
                          свойство очага: документ либо проектный (ПЛА, 60 мин),
                          либо составляется по факту аварии (≥150 мин). Тот же
                          признак управляет прочностью смеси для перемычек,
                          поэтому здесь он продублирован, а не заведён второй. */}
                      <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <input type="checkbox" id={`gz_emg_${b.id}`}
                          checked={blastDuringEmergency}
                          onChange={e => setBlastDuringEmergency(e.target.checked)} />
                        <label htmlFor={`gz_emg_${b.id}`} className="text-[11px] text-gray-700 cursor-pointer">
                          В ходе ликвидации аварии
                          <span className="block text-[9px] text-gray-400">
                            t<sub>з</sub> ≥ {GAS_TIME_EMERGENCY_MIN} мин вместо {GAS_TIME_PLA} мин (п. 11–12)
                          </span>
                        </label>
                      </div>
                      {blastDuringEmergency && (
                        <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Факт. время t, мин:</span>
                          <input type="number" step="10" min="0"
                            value={blastGasTimeFactual || ""}
                            placeholder={`мин. ${GAS_TIME_EMERGENCY_MIN}`}
                            onChange={e => setBlastGasTimeFactual(parseFloat(e.target.value) || 0)}
                            className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }} />
                        </div>
                      )}
                      <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Где зона:</span>
                        <select value={b.explosionGasZoneKind ?? "heading"}
                          onChange={e => updateBranch(b.id, { explosionGasZoneKind: e.target.value as "longwall" | "preserved" | "heading" })}
                          className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }}>
                          <option value="heading">Подготовительная выработка (ф. 5)</option>
                          <option value="longwall">Очистной забой (ф. 1)</option>
                          <option value="preserved">Непогашенная выработка (ф. 3)</option>
                        </select>
                      </div>
                      <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Метановыделение I, м³/мин:</span>
                        <input type="number" step="0.1" min="0"
                          value={b.explosionGasEmission ?? ""}
                          placeholder={(b.explosionGasZoneKind ?? "heading") === "preserved" ? "0,5 по умолч." : "задайте"}
                          onChange={e => updateBranch(b.id, { explosionGasEmission: parseFloat(e.target.value) || 0 })}
                          className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }} />
                      </div>
                      {/* Закрепное пространство — только для очистного забоя (ф. 2).
                          Метан заполняет и забой, и пространство за крепью, и зона
                          считается по их СУММАРНОМУ сечению. */}
                      {(b.explosionGasZoneKind ?? "heading") === "longwall" && (<>
                        <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Мощность пласта m, м:</span>
                          <input type="number" step="0.1" min="0"
                            value={b.explosionSeamThickness ?? ""}
                            onChange={e => updateBranch(b.id, { explosionSeamThickness: parseFloat(e.target.value) || 0 })}
                            className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }} />
                        </div>
                        <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Шаг обрушения l, м:</span>
                          <input type="number" step="0.5" min="0"
                            value={b.explosionCaveStep ?? ""}
                            onChange={e => updateBranch(b.id, { explosionCaveStep: parseFloat(e.target.value) || 0 })}
                            className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }} />
                        </div>
                      </>)}

                      {/* Результат расчёта зоны */}
                      {(() => {
                        const kind = b.explosionGasZoneKind ?? "heading";
                        const emis = b.explosionGasEmission
                          ?? (kind === "preserved" ? DEFAULT_I_NEPOGASH : 0);
                        const t = gasZoneTime(blastDuringEmergency, blastGasTimeFactual);
                        const z = calcGasZone({
                          kind, time_min: t, emission_m3min: emis,
                          area_m2: b.area ?? 0,
                          seamThickness_m: b.explosionSeamThickness,
                          caveStep_m: b.explosionCaveStep,
                          branchLength_m: b.length,
                        });
                        if (!z) {
                          return (
                            <div className="mx-2 my-1 px-2 py-1.5 rounded text-[10px]" style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fde68a", color: "var(--c-amber-ink, #92400e)" }}>
                              Задайте метановыделение — без него зона не считается.
                              Пока в расчёт идёт длина {b.explosionGasZoneLength ?? 100} м, введённая руками.
                            </div>
                          );
                        }
                        return (
                          <div className="mx-2 my-1 px-2 py-1.5 rounded text-[10px]" style={{ background: "var(--c-tint-blue, #eff6ff)", border: "1px solid #b0cfdc", color: "#1e3a8a" }}>
                            <div className="font-semibold text-[11px]">
                              Зона загазирования: {z.length_m} м · {z.volume_m3} м³
                            </div>
                            <div style={{ marginTop: 2 }}>
                              t<sub>з</sub> = {t} мин · I = {emis} м³/мин · c<sub>в</sub> = {EXPLOSIVE_CH4_CONC} %
                            </div>
                            <div>
                              Сечение в расчёте: {z.areaTotal_m2} м²
                              {z.areaCaved_m2 > 0 && ` (забой ${b.area ?? 0} + закрепное ${z.areaCaved_m2})`}
                            </div>
                            {z.clampedByLength && (
                              <div style={{ marginTop: 2, color: "#a16207" }}>
                                Расчёт дал {z.lengthRaw_m} м — принята длина выработки {b.length} м (п. 13)
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>)}
                    {/* ΔP₀ по умолчанию считается ПО ДЛИНЕ участка (как в
                        «Аэросети»): 50 м → 209 кПа, 100 м → 282 кПа.
                        Ручной ввод нужен только для сверки с чужим расчётом,
                        поэтому включается галочкой. */}
                    {(b.explosionGasMethod ?? "vgsch") === "aeroset" && (() => {
                      const zoneLen = b.explosionGasZoneLength ?? 100;
                      // ΔP₀ зависит не только от длины, но и от ЭНЕРГИИ смеси:
                      // вид газа, концентрация и Z входят через E_v.
                      const gg = GAS_TYPES.find(x => x.id === (b.explosionGasId ?? "methane")) ?? GAS_TYPES[0];
                      const ev = gasEnergyDensity(gg, b.explosionGasConcentration ?? gg.stoichConc, b.explosionZ ?? 0.5);
                      const autoP0 = gasInitialPressure(zoneLen, ev);
                      const manual = (b.explosionGasP0 ?? 0) > 0;
                      return (
                        <div className="px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <div className="flex items-center">
                            <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Нач. давление ΔP₀, кПа:</span>
                            <input type="number" step="10" min="1"
                              disabled={!manual}
                              value={manual ? b.explosionGasP0 : autoP0}
                              onChange={e => updateBranch(b.id, { explosionGasP0: parseFloat(e.target.value) || autoP0 })}
                              className="flex-1 text-[11px] text-right px-1 rounded"
                              style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20,
                                background: manual ? "white" : "var(--c-s3, #f3f4f6)",
                                color: manual ? undefined : "var(--c-t3, #6b7280)" }} />
                          </div>
                          <label className="flex items-center gap-1 mt-0.5 cursor-pointer">
                            <input type="checkbox" checked={manual}
                              onChange={e => updateBranch(b.id, { explosionGasP0: e.target.checked ? autoP0 : 0 })} />
                            <span className="text-[10px] text-gray-500">
                              {manual ? "Задано вручную" : `Авторасчёт: ${zoneLen} м, E=${Math.round(ev * 100) / 100} МДж/м³ → ${autoP0} кПа`}
                            </span>
                          </label>
                        </div>
                      );
                    })()}
                    {(() => {
                      // Единица зависит от вещества: газ — % объёма, пыль — г/м³
                      const g = GAS_TYPES.find(x => x.id === (b.explosionGasId ?? "methane")) ?? GAS_TYPES[0];
                      const isDust = g.unit === "g/m3";
                      return (
                        <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>
                            Концентрация, {concUnitLabel(g.unit)}:
                          </span>
                          <input type="number"
                            step={isDust ? 10 : 0.5} min="0" max={isDust ? 5000 : 100}
                            value={b.explosionGasConcentration ?? g.stoichConc}
                            onChange={e => updateBranch(b.id, { explosionGasConcentration: parseFloat(e.target.value) || g.stoichConc })}
                            className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }} />
                        </div>
                      );
                    })()}
                    {(b.explosionGasMethod ?? "vgsch") === "aeroset" && <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Коэф. участия Z:</span>
                      <select value={String(b.explosionZ ?? 0.5)}
                        onChange={e => updateBranch(b.id, { explosionZ: parseFloat(e.target.value) || 0.5 })}
                        className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }}>
                        <option value="0.5">0.5 — замкнутый объём (выработка)</option>
                        <option value="0.1">0.1 — открытое пространство</option>
                      </select>
                    </div>}
                    {(() => {
                      const gas = GAS_TYPES.find(g => g.id === (b.explosionGasId ?? "methane"));
                      if (!gas) return null;
                      const conc = b.explosionGasConcentration ?? gas.stoichConc;
                      const u = concUnitLabel(gas.unit);
                      const inRange = conc >= gas.lowerLimit && conc <= gas.upperLimit;
                      const rich = conc > gas.stoichConc && inRange;
                      // Объём смеси = длина участка × сечение выработки
                      const zoneLen = b.explosionGasZoneLength ?? 100;
                      const volume = zoneLen * (b.area ?? 12);
                      return (
                        <div className="mx-2 my-1 px-2 py-1 rounded text-[10px]" style={{ background: inRange ? "var(--c-tint-green, #f0fdf4)" : "var(--c-tint-amber, #fef9c3)", border: `1px solid ${inRange ? "#bbf7d0" : "#fde047"}`, color: inRange ? "var(--c-green-ink, #166534)" : "#713f12" }}>
                          НПВ: {gas.lowerLimit} {u} · ВПВ: {gas.upperLimit} {u} · Стехиом.: {gas.stoichConc} {u}
                          <div style={{ marginTop: 2 }}>
                            Объём смеси: {zoneLen} м × {b.area ?? 12} м² = {Math.round(volume)} м³
                          </div>
                          {gas.unit === "g/m3" && (
                            <div style={{ marginTop: 2 }}>
                              Масса пыли в облаке: {Math.round(volume * conc / 1000 * 10) / 10} кг
                            </div>
                          )}
                          {!inRange && " ⚠ Концентрация вне диапазона взрываемости"}
                          {rich && (
                            <div style={{ marginTop: 2 }}>
                              Смесь обогащённая — не хватает кислорода. В расчёт пойдёт
                              стехиометрическая концентрация {gas.stoichConc} {u}.
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>)}

                  {/* По массе */}
                  {(b.explosionSourceType ?? "gas") === "mass" && (<>
                    <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Взрывчатое вещество:</span>
                      <select value={b.explosionExplosiveId ?? "ammonit"}
                        onChange={e => updateBranch(b.id, { explosionExplosiveId: e.target.value })}
                        className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }}>
                        {EXPLOSIVE_TYPES.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Масса ВВ, кг:</span>
                      <input type="number" step="1" min="0.1"
                        value={b.explosionExplosiveMass ?? 10}
                        onChange={e => updateBranch(b.id, { explosionExplosiveMass: parseFloat(e.target.value) || 10 })}
                        className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid var(--c-b2, #d1d5db)", height: 20, background: "white" }} />
                    </div>
                    {(() => {
                      const expl = EXPLOSIVE_TYPES.find(ex => ex.id === (b.explosionExplosiveId ?? "ammonit"));
                      if (!expl) return null;
                      const k = tntEquivalent(expl);
                      const mass = b.explosionExplosiveMass ?? 10;
                      return (
                        <div className="mx-2 my-1 px-2 py-1 rounded text-[10px]" style={{ background: "var(--c-tint-amber, #fef9c3)", border: "1px solid #fde047", color: "#713f12" }}>
                          Q_уд = {expl.qSpec} кДж/кг · k_тнт = {expl.qSpec} / 4520 = {k}
                          <div style={{ marginTop: 2 }}>
                            Тротиловый эквивалент: {mass} × {k} = {Math.round(mass * k * 100) / 100} кг ТНТ
                          </div>
                        </div>
                      );
                    })()}
                  </>)}

                  {/* Результаты */}
                  {explosionCalcDone && b.explosionComputedQtnt > 0 && (<>
                    <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "var(--c-amber-ink, #92400e)" }}>Результаты расчёта</div>
                    {!explosionResultByBranch.get(b.id)?.vgsch && (
                      <Row label="Тротиловый эквивалент:" value={`${b.explosionComputedQtnt} кг ТНТ`} bold />
                    )}
                    <Row label="Максимальное давление:" value={`${b.explosionComputedMaxP} кПа`} bold color="#dc2626" />
                    <Row label="Скорость фронта волны:" value={`${b.explosionComputedWaveSpeed} м/с`} />
                    {(() => {
                      // Импульс показываем ВМЕСТЕ с длительностью фазы сжатия.
                      // Без неё две ветки выглядят несопоставимо: у заряда ВВ
                      // импульс — сотни Па·с, у газовой дефлаграции — тысячи.
                      // Разница не в формулах, а в длительности нагружения:
                      // короткий удар против длинного поршня.
                      const res = explosionResultByBranch.get(b.id);
                      if (!res || !res.maxImpulse_Pas) return null;
                      const isGas = !!res.gasSource;
                      if (res.vgsch) {
                        const v = res.vgsch;
                        const pvLen = Math.round(v.pvVolumePerSide_m3 / (v.area_m2 || 1));
                        return (<>
                          <Row label="Энергия взрыва Ен:" value={`${Math.round(v.En_MJ)} МДж`} />
                          <Row label="ΔP в зоне загазования:" value={`${Math.round(v.dPz_kPa)} кПа`} />
                          <Row label="ΔPн в месте отрыва УВВ:" value={`${Math.round(v.dPn_kPa)} кПа`} />
                          <Row label="Зона продуктов взрыва:" value={`по ${pvLen} м в обе стороны`} />
                          <Row label="Кз (табл. 3):" value={`${v.kz}`} />
                          <Row label="Импульс (i = ΔP·θ/2):" value={`${res.maxImpulse_Pas} Н·с/м²`} />
                          <div className="px-2 py-1 text-[10px] leading-tight" style={{ color: "var(--c-t2, #4b5563)", borderBottom: "1px solid #f3f4f6" }}>
                            Методика ВГСЧ: в зоне загазования давление постоянно, в зоне продуктов
                            взрыва (5V₀) — по ф. (4), после отрыва УВВ — затухание по ф. (3)
                            с Кзат в сопряжениях и поворотах. Безопасно для человека — ΔP ≤ 9 кПа.
                          </div>
                        </>);
                      }
                      return (<>
                        <Row label="Импульс (i = ΔP·τ):" value={`${res.maxImpulse_Pas} Па·с`} />
                        <Row label="Длительность фазы τ:" value={`${res.phaseDuration_ms ?? "—"} мс`} />
                        <div className="px-2 py-1 text-[10px] leading-tight" style={{ color: "var(--c-t2, #4b5563)", borderBottom: "1px solid #f3f4f6" }}>
                          {isGas ? (<>
                            Максимум — внутри загазованного участка.
                            Длительность фазы τ = (L/2)/c<sub>прод</sub> — время разгрузки
                            очага. У газовой дефлаграции она в десятки раз больше, чем
                            у заряда ВВ, поэтому и импульс выше на порядки.
                          </>) : (<>
                            Максимум приведён на границе применимости формулы
                            (r = Q<sup>1/3</sup> ≈ {Math.round(Math.cbrt(b.explosionComputedQtnt) * 100) / 100} м).
                            Ближе к заряду методика параметры волны не определяет.
                          </>)}
                        </div>
                      </>);
                    })()}
                    <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "var(--c-amber-ink, #92400e)", marginTop: 4 }}>Зоны поражения</div>
                    {[
                      { label: `💀 Летальная (>${blastThresholds.lethal} кПа):`, r: b.explosionComputedR_lethal, color: EXPLOSION_HAZARD_COLORS.lethal },
                      { label: `🔴 Тяжёлые (>${blastThresholds.heavy} кПа):`,  r: b.explosionComputedR_heavy,  color: EXPLOSION_HAZARD_COLORS.heavy },
                      { label: `🟠 Средние (>${blastThresholds.medium} кПа):`, r: b.explosionComputedR_medium, color: EXPLOSION_HAZARD_COLORS.medium },
                      { label: `🟡 Лёгкие (>${blastThresholds.light} кПа):`,   r: b.explosionComputedR_light,  color: "#ca8a04" },
                    ].map(({ label, r, color }) => (
                      <div key={label} className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>{label}</span>
                        <span className="text-[11px] font-bold text-right flex-1" style={{ color }}>{r > 0 ? `${r} м` : "—"}</span>
                      </div>
                    ))}
                    {explosionResult?.warnings && explosionResult.warnings.length > 0 && (
                      <div className="mx-2 my-1 px-2 py-1.5 rounded text-[10px]" style={{ background: "var(--c-tint-amber, #fef9c3)", border: "1px solid #fde047", color: "#713f12" }}>
                        {explosionResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                      </div>
                    )}
                  </>)}

                  {/* Разрушенные перемычки */}
                  {explosionCalcDone && (() => {
                    const destroyedBranches = branches.filter(br =>
                      br.bulkheadDestroyedByExplosion && br.hasBulkhead
                    );
                    if (destroyedBranches.length === 0) return null;
                    return (<>
                      <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: "var(--c-tint-red2, #fee2e2)", borderBottom: "1px solid #fca5a5", color: "var(--c-red-ink, #991b1b)" }}>
                        ⚡ Разрушенные перемычки ({destroyedBranches.length})
                      </div>
                      {destroyedBranches.map(br => {
                        const bkSym = schemaSymbols.find(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === br.id);
                        const fp = bkSym?.bkFailurePressure ?? br.bulkheadFailurePressure;
                        const name = barrierDisplayName(bkSym, br, br.id);
                        return (
                          <div key={br.id} className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6", background: "var(--c-tint-red, #fff5f5)" }}>
                            <span className="text-[10px] mr-1">🔴</span>
                            <span className="text-[11px] text-gray-700 flex-1 truncate">{name}</span>
                            {fp > 0 && (
                              <span className="text-[10px] text-red-600 ml-1 flex-shrink-0">{fp} МПа</span>
                            )}
                          </div>
                        );
                      })}
                      <div className="mx-2 my-1 px-2 py-1.5 rounded text-[10px]" style={{ background: "var(--c-tint-red2, #fee2e2)", border: "1px solid #fca5a5", color: "var(--c-red-ink, #991b1b)" }}>
                        Разрушенные перемычки окрашены красным и отмечены «РАЗР.» на схеме. Пересчитайте сеть (F9).
                      </div>
                    </>);
                  })()}

                  {/* Перемычки на пути волны: что с каждой произошло. Решения
                      приняты прямо при распространении волны — устоявшая волну
                      гасит, разрушенная пропускает ослабленную. */}
                  {explosionCalcDone && explosionBarriers && explosionBarriers.hits.size > 0 && (() => {
                    const rows: Array<{ bar: BlastBarrier; hit: BarrierHit }> = [];
                    for (const list of explosionBarriers.byBranch.values()) {
                      for (const bar of list) {
                        const hit = explosionBarriers.hits.get(bar.key);
                        if (hit && hit.incident_kPa > 0) rows.push({ bar, hit });
                      }
                    }
                    if (rows.length === 0) return null;
                    rows.sort((a, b) => b.hit.incident_kPa - a.hit.incident_kPa);
                    return (<>
                      <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "var(--c-amber-ink, #92400e)" }}>
                        Перемычки на пути волны ({rows.length})
                                              <button onClick={() => setShowBlastBarrierChart(true)}
                          className="float-right px-1.5 rounded text-[9.5px] font-semibold"
                          style={{ background: "var(--c-amber-bg, #c98a0c)", color: "#fff" }}>
                          Диаграмма
                        </button>
                      </div>
                      <div className="px-2 py-1 text-[10px] leading-tight" style={{ color: "var(--c-t2, #4b5563)", borderBottom: "1px solid #f3f4f6" }}>
                        Разрушение — по давлению во фронте ΔP (табл. 8 методики ВГСЧ).
                        Устоявшая перемычка волну останавливает (с окном — пропускает
                        долю площади окна); за разрушенной идёт ΔP·(1 − P<sub>разр</sub>/ΔP).
                        ΔP<sub>отр</sub> — справочно, для расчёта толщины перемычки.
                      </div>
                      {rows.map(({ bar, hit }) => {
                        const sym = schemaSymbols.find(s => s.id === bar.key);
                        const br = branches.find(x => x.id === bar.branchId);
                        const name = barrierDisplayName(sym, br, bar.branchId);
                        const status = hit.destroyed
                            ? { text: `разрушена, прошло ${Math.round(hit.transmit * 100)} %`, color: "#dc2626" }
                            : { text: "устояла, волна остановлена", color: "#16a34a" };
                        return (
                          <div key={bar.key} className="px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-gray-700 flex-1 truncate" title={name}>{name}</span>
                              <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: status.color }}>{status.text}</span>
                            </div>
                            <div className="text-[9px] text-gray-500">
                              ΔP = {(hit.incident_kPa / 1000).toFixed(3)} МПа · P<sub>разр</sub> = {bar.failure_MPa} МПа
                              {" · "}ΔP<sub>отр</sub> = {(hit.reflected_kPa / 1000).toFixed(3)} МПа
                            </div>
                          </div>
                        );
                      })}
                    </>);
                  })()}

                  {/* Легенда обозначений перемычек */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold mt-2" style={{ background: "var(--c-s2, #f5f5f5)", borderBottom: "1px solid var(--c-b1, #e0e0e0)", color: "var(--c-t2, #374151)" }}>
                    Обозначения на схеме
                  </div>
                  <div className="px-2 py-1.5 text-[10px] space-y-1" style={{ borderBottom: "1px solid var(--c-b1, #f0f0f0)" }}>
                    <div className="flex items-center gap-2">
                      <svg width="22" height="18" viewBox="-11 -9 22 18">
                        <rect x="-3" y="-7" width="6" height="14" fill="white" stroke="#1a1a1a" strokeWidth="1" />
                      </svg>
                      <span style={{ color: "var(--c-t2, #374151)" }}>Перемычка — цела</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="22" height="18" viewBox="-11 -9 22 18">
                        <rect x="-3" y="-7" width="6" height="14" fill="#ff4444" stroke="#8b0000" strokeWidth="1" />
                      </svg>
                      <span style={{ color: "var(--c-red, #dc2626)", fontWeight: 600 }}>Перемычка — разрушена</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="22" height="18" viewBox="-11 -9 22 18">
                        <circle cx="0" cy="0" r="7" fill="#fef08a" stroke="#dc2626" strokeWidth="1.5" />
                        <polyline points="-6,0 -3,-2.5 0,2.5 3,-2.5 6,0" fill="none" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span style={{ color: "#7f1d1d" }}>Маркер разрушения + давление разрушения (МПа)</span>
                    </div>
                  </div>

                  {/* ═══ Толщина взрывоустойчивой перемычки (РБ №343, п. 26–27) ═══
                      Отдельный калькулятор: расчёт для одной выбранной перемычки
                      с выгрузкой акта, а не для всех перемычек схемы подряд. */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold mt-2" style={{ background: "var(--c-tint-blue, #dbeafe)", borderBottom: "1px solid #81b0c4", color: "var(--c-blue-ink, #1e40af)" }}>
                    🧱 Взрывоустойчивая перемычка
                  </div>
                  <div className="px-2 py-1.5" style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <div className="text-[10px] mb-1.5" style={{ color: "var(--c-t2, #4b5563)" }}>
                      Расчёт толщины по РБ № 343, п. 25–27, формулы (6)–(7) для выбранной
                      перемычки — с актом в Excel.
                    </div>
                    <button onClick={() => setShowBlastBulkheadCalc(true)}
                      className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-semibold text-white"
                      style={{ background: "var(--c-blue-bg, #1e5a7a)" }}>
                      <Icon name="Calculator" size={13} /> Калькулятор толщины перемычки
                    </button>
                  </div>

                  {!explosionCalcDone && (
                    <div className="mx-2 my-2 px-2 py-2 text-[11px] rounded" style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid #fde68a", color: "var(--c-amber-ink, #92400e)" }}>
                      Нажмите «Расчёт взрыва» на вкладке Аварии для получения результатов
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ═══ ВКЛАДКИ ВЕТВИ (Топология / Вентилятор / Трубы: вода / Конвейер) ══ */}
            {(["topology","fan","waterpipes","conveyor","fireload","params","bulkhead","airdemand","ventpipe"].includes(activeSide)) && !selectedNode && selectedBranch && (
              <BranchPropsPanel
                branch={selectedBranch}
                horizons={horizons}
                pollutionFraction={pollutionFractions.get(selectedBranch.id) ?? 0}
                pollutionThreshold={pollutionThreshold}
                // Общие характеристики (сечение, крепь, тип, горизонт,
                // примечание) уходят на ВСЕ выбранные выработки; длина, угол и
                // оборудование остаются поштучными. См. updateBranchFromPanel.
                onUpdate={updateBranchFromPanel}
                selectedCount={branchEditCount}
                activeTab={activeSide}
                defaultInnerTab={fanSymbolBranchId === selectedBranch.id ? "Вентилятор" : undefined}
                onRemoveFan={selectedBranch.hasFan ? () => {
                  const sym = schemaSymbols.find(s => s.typeId === "fan" && s.branchId === selectedBranch.id);
                  if (sym) removeSymbol(sym.id);
                  updateBranch(selectedBranch.id, { hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0 });
                  setFanSymbolBranchId(null);
                } : undefined}
                fanSymbolScale={(() => {
                  const sym = schemaSymbols.find(s => s.typeId === "fan" && s.branchId === selectedBranch.id);
                  return sym?.scale ?? 1;
                })()}
                onFanSymbolScale={selectedBranch.hasFan ? (scale) => {
                  setSchemaSymbols(prev => prev.map(s =>
                    s.typeId === "fan" && s.branchId === selectedBranch.id ? { ...s, scale } : s
                  ));
                } : undefined}
                onFanSymbolDelete={schemaSymbols.some(s => FAN_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id) ? () => {
                  const sym = schemaSymbols.find(s => FAN_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id);
                  if (sym) removeSymbol(sym.id);
                } : undefined}
                fanIndFontSize={(() => {
                  const sym = schemaSymbols.find(s => FAN_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id);
                  return sym?.fanIndFontSize ?? 9;
                })()}
                onFanIndFontSize={schemaSymbols.some(s => FAN_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id) ? (size) => {
                  setSchemaSymbols(prev => prev.map(s =>
                    FAN_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id ? { ...s, fanIndFontSize: size } : s
                  ));
                } : undefined}
                onFanIndResetOffset={schemaSymbols.some(s => FAN_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id) ? () => {
                  setSchemaSymbols(prev => prev.map(s =>
                    FAN_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id ? { ...s, fanIndOffsetX: 0, fanIndOffsetY: 0 } : s
                  ));
                } : undefined}
                onReverse={selectedBranch.hasFan ? () => handleFlipFanDirection(selectedBranch.id) : undefined}
                normalFlows={normalFlows}
                mineFans={mineFans}
                mineBulkheads={mineBulkheads}
                onOpenFanLibrary={() => { setShowEquipRef(true); setEquipRefTab("fans"); }}
                mineTypes={mineTypes}
                onOpenTypesLibrary={() => { setShowEquipRef(true); setEquipRefTab("types"); }}
                ventSections={ventSections}
                onOpenSectionsLibrary={() => setShowVentSections(true)}
                ventNorms={ventNorms}
                bulkheadSymTypeId={(() => {
                  const bkSym = schemaSymbols.find(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id);
                  return bkSym?.typeId;
                })()}
                bulkheadSymbol={schemaSymbols.find(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id)}
                onUpdateBulkheadSym={(patch) => {
                  setSchemaSymbols(prev => prev.map(s =>
                    BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id
                      ? { ...s, ...patch }
                      : s
                  ));
                }}
                unitsConfig={unitsConfig}
                bulkheadRKmu={bulkheadRByBranch.get(selectedBranch.id) ?? 0}
                nodes={nodes}
                waterBranchResult={waterNetwork.branchResults.get(selectedBranch.id)}
                reducerSymbolScale={(() => {
                  const sym = schemaSymbols.find(s => REDUCER_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id);
                  return sym?.scale ?? 1;
                })()}
                onReducerSymbolScale={schemaSymbols.some(s => REDUCER_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id) ? (scale) => {
                  setSchemaSymbols(prev => prev.map(s =>
                    REDUCER_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id ? { ...s, scale } : s
                  ));
                } : undefined}
                onRemoveReducer={selectedBranch.wpHasReducer ? () => {
                  const sym = schemaSymbols.find(s => REDUCER_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id);
                  if (sym) removeSymbol(sym.id);
                  updateBranch(selectedBranch.id, {
                    wpHasReducer: false,
                    wpReducerModel: "kppr_50",
                    wpReducerOutPressure: 0.5,
                    wpReducerMaxFlow: 25,
                  });
                } : undefined}
                onRemoveGate={selectedBranch.wpHasGate ? () => {
                  const sym = schemaSymbols.find(s => s.typeId === "valve_water" && s.branchId === selectedBranch.id);
                  if (sym) removeSymbol(sym.id);
                  updateBranch(selectedBranch.id, { wpHasGate: false, wpGateClosed: false });
                } : undefined}
              />
            )}



            {/* ═══ Панель выделенного условного обозначения ══════════════ */}
            {activeSide === "params" && !selectedNode && !selectedBranch && selectedSymbolId && (() => {
              const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
              if (!sym) return null;
              const isMeasureStationSym = sym.typeId === "measure_station";
              const isHeaterSym = HEATER_SYMBOL_IDS.has(sym.typeId);
              const isBulkheadSym = BULKHEAD_SYMBOL_IDS.has(sym.typeId) && !isMeasureStationSym;
              const isWindowBulkhead = WINDOW_BULKHEAD_IDS.has(sym.typeId);
              const isFanSym = FAN_SYMBOL_IDS.has(sym.typeId);
              const brForSym = sym.branchId ? branches.find(b => b.id === sym.branchId) : null;
              // ΔP перемычки = R_sym × Q × |Q| (не dP всей ветви, а только вклад этого символа)
              const symDeltaP = (() => {
                if (!brForSym) return null;
                const q = brForSym.flow ?? 0;
                const mode = sym.bkResMode ?? "project";
                if (mode === "manual") {
                  // кМюрг (кгс·с²/м⁸) → ΔP в Па: ×g (как в АэроСети).
                  const r = (sym.bkManualR ?? 0);
                  return r * q * Math.abs(q) * G_ACCEL;
                }
                if (mode === "survey") {
                  const sq = sym.bkSurveyQ ?? 0; const dp = sym.bkSurveyDP ?? 0;
                  // R = ΔP/(Q²·9.81) кМюрг (как в АэроСети). Дальше ΔP=R·q²·g в Па.
                  const r = sq > 0 ? dp / (sq * sq * 9.81) : 0;
                  return r * q * Math.abs(q) * G_ACCEL;
                }
                // project
                const sw = sym.bkWindowArea ?? 0;
                const branchArea = brForSym.area ?? 0;
                const isFullyOpen = (OPEN_DOOR_IDS.has(sym.typeId) && sw <= 0.001)
                  || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
                if (isFullyOpen) return 0;
                let r = 0;
                if (sw > 0.001) {
                  // Регулируемое окно: формула диафрагмы с учётом сечения (АэроСеть).
                  r = windowBulkheadRkMurg(sw, branchArea, sym.typeId);
                } else {
                  const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0)
                    : (sym.bkAirPerm
                      ?? (sym.bkBulkheadId ? mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.airPermeability : undefined)
                      ?? brForSym.bulkheadAirPerm ?? 0);
                  const rRefSym = sym.bkBulkheadId ? (mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.rMkyurg ?? 0) : 0;
                  // Глухая: R=1/A²/1000; парус — калиброванная формула.
                  if (kAir > 0) {
                    r = solidBulkheadRkMurg(kAir, branchArea);
                  } else {
                    r = sym.bkBulkheadR ?? rRefSym ?? brForSym.bulkheadR ?? 0;
                  }
                }
                // R в кМюрг (кгс·с²/м⁸) → ΔP в Па: ×g (как в АэроСети).
                return r * q * Math.abs(q) * G_ACCEL;
              })();
              const updSym = (patch: Partial<SchemaSymbol>) =>
                setSchemaSymbols(prev => prev.map(s => s.id === sym.id ? { ...s, ...patch } : s));

              return (
                <div className="p-2 text-[11px]">
                  {/* ── Общие свойства ── */}
                  <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 uppercase tracking-wide">
                    Общие свойства
                  </div>

                  {/* Масштаб */}
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="text-gray-500 w-20 flex-shrink-0">Масштаб</span>
                    <input type="range" min={5} max={400} step={5}
                      value={Math.round((sym.scale ?? 1) * 100)}
                      onChange={(e) => updSym({ scale: Number(e.target.value) / 100 })}
                      className="flex-1" style={{ accentColor: "#1e5a7a" }} />
                    <input type="number" min={5} max={400} step={5}
                      value={Math.round((sym.scale ?? 1) * 100)}
                      onChange={(e) => { const v = Math.min(400, Math.max(5, Number(e.target.value) || 100)); updSym({ scale: v / 100 }); }}
                      className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
                      style={{ fontSize: 11 }} />
                    <span className="text-gray-500 flex-shrink-0">%</span>
                  </div>

                  {/* Описание */}
                  <div className="flex items-start gap-1 mb-1.5">
                    <span className="text-gray-500 w-20 flex-shrink-0 pt-0.5">Описание</span>
                    <textarea
                      value={sym.description ?? ""}
                      onChange={(e) => updSym({ description: e.target.value })}
                      rows={2}
                      className="flex-1 px-1 py-0.5 text-[11px] resize-none"
                      placeholder="Введите описание объекта..."
                      style={{ border: "1px solid var(--c-b2, #c8c8c8)", outline: "none", background: "white", borderRadius: "var(--radius-ui)" }} />
                  </div>

                  {/* ── Калорифер ── */}
                  {isHeaterSym && (() => {
                    const hRes = heaterInfo.info.find(h => h.symId === sym.id);
                    const active = isHeaterActive(sym.htMode, heatingSeason);
                    const method = sym.htMethod ?? "power";
                    return (
                    <>
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-2 uppercase tracking-wide">
                        Калорифер
                      </div>

                      {/* Режим работы по сезону */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">Режим</span>
                        <select
                          value={sym.htMode ?? "winter"}
                          onChange={e => updSym({ htMode: e.target.value as "winter" | "always" | "off" })}
                          className="flex-1 text-[11px] px-1"
                          style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 20, outline: "none", borderRadius: "var(--radius-ui)" }}>
                          <option value="winter">Только зимой</option>
                          <option value="always">Круглый год</option>
                          <option value="off">Выключен</option>
                        </select>
                      </div>

                      {/* Текущее состояние */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">Состояние</span>
                        <span className="flex-1 text-[11px] font-semibold"
                          style={{ color: active ? "var(--c-green, #15803d)" : "var(--c-t4, #9ca3af)" }}>
                          {active ? "Работает" : "Отключён"}
                          <span className="font-normal text-gray-400">
                            {" "}({heatingSeason === "winter" ? "зима" : "лето"})
                          </span>
                        </span>
                      </div>

                      {/* Способ задания */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">Задание</span>
                        <select
                          value={method}
                          onChange={e => updSym({ htMethod: e.target.value as "power" | "temp" })}
                          className="flex-1 text-[11px] px-1"
                          style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 20, outline: "none", borderRadius: "var(--radius-ui)" }}>
                          <option value="power">По тепловой мощности</option>
                          <option value="temp">По температуре за калорифером</option>
                        </select>
                      </div>

                      {method === "power" ? (
                        <div className="flex items-center gap-1 mb-1.5">
                          <span className="text-gray-500 w-24 flex-shrink-0">Мощность</span>
                          <input type="number" min={0} step={10}
                            value={sym.htPower ?? ""}
                            onChange={e => updSym({ htPower: e.target.value === "" ? undefined : Number(e.target.value) })}
                            placeholder="0"
                            className="flex-1 px-1 py-0.5 text-[11px] text-right"
                            style={{ border: "1px solid var(--c-b2, #c8c8c8)", outline: "none", background: "white", borderRadius: "var(--radius-ui)" }} />
                          <span className="text-gray-400 flex-shrink-0">кВт</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 mb-1.5">
                          <span className="text-gray-500 w-24 flex-shrink-0">t за калор.</span>
                          <input type="number" min={-20} max={60} step={1}
                            value={sym.htOutTemp ?? ""}
                            onChange={e => updSym({ htOutTemp: e.target.value === "" ? undefined : Number(e.target.value) })}
                            placeholder={String(MIN_SHAFT_TEMP_C)}
                            className="flex-1 px-1 py-0.5 text-[11px] text-right"
                            style={{ border: "1px solid var(--c-b2, #c8c8c8)", outline: "none", background: "white", borderRadius: "var(--radius-ui)" }} />
                          <span className="text-gray-400 flex-shrink-0">°C</span>
                        </div>
                      )}

                      {/* КПД установки */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">КПД</span>
                        <input type="number" min={1} max={100} step={1}
                          value={Math.round((sym.htEfficiency ?? DEFAULT_HEATER_EFFICIENCY) * 100)}
                          onChange={e => {
                            const v = Math.min(100, Math.max(1, Number(e.target.value) || 85));
                            updSym({ htEfficiency: v / 100 });
                          }}
                          className="flex-1 px-1 py-0.5 text-[11px] text-right"
                          style={{ border: "1px solid var(--c-b2, #c8c8c8)", outline: "none", background: "white", borderRadius: "var(--radius-ui)" }} />
                        <span className="text-gray-400 flex-shrink-0">%</span>
                      </div>

                      {/* Результат расчёта */}
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-2 uppercase tracking-wide">
                        Расчёт подогрева
                      </div>
                      {!active ? (
                        <div className="text-[11px] text-gray-400 mb-1.5">
                          Калорифер отключён — подогрева нет
                        </div>
                      ) : !brForSym || Math.abs(brForSym.flow ?? 0) < 0.001 ? (
                        <div className="text-[11px] text-gray-400 mb-1.5">
                          Нет расхода воздуха — выполните расчёт сети (F9)
                        </div>
                      ) : hRes ? (
                        <>
                          <div className="flex items-center gap-1 mb-1">
                            <span className="text-gray-500 w-24 flex-shrink-0">Подогрев Δt</span>
                            <span className="flex-1 text-right text-[11px] font-semibold text-orange-700">
                              +{hRes.dt.toFixed(1)}
                            </span>
                            <span className="text-gray-400 flex-shrink-0">°C</span>
                          </div>
                          <div className="flex items-center gap-1 mb-1">
                            <span className="text-gray-500 w-24 flex-shrink-0">t за калор.</span>
                            <span className="flex-1 text-right text-[11px] font-semibold"
                              style={{ color: hRes.meetsNorm ? "var(--c-green, #15803d)" : "var(--c-red, #dc2626)" }}>
                              {hRes.outTemp.toFixed(1)}
                            </span>
                            <span className="text-gray-400 flex-shrink-0">°C</span>
                          </div>
                          <div className="flex items-center gap-1 mb-1">
                            <span className="text-gray-500 w-24 flex-shrink-0">
                              {method === "temp" ? "Потр. мощность" : "Мощность"}
                            </span>
                            <span className="flex-1 text-right text-[11px] font-semibold text-gray-700">
                              {hRes.power.toFixed(1)}
                            </span>
                            <span className="text-gray-400 flex-shrink-0">кВт</span>
                          </div>
                          {!hRes.meetsNorm && (
                            <div className="text-[10px] text-red-600 mt-1 leading-snug">
                              Температура за калорифером ниже нормативных +{MIN_SHAFT_TEMP_C} °C
                            </div>
                          )}
                        </>
                      ) : null}
                    </>
                    );
                  })()}

                  {/* ── Замерная станция ── */}
                  {isMeasureStationSym && (
                    <>
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-2 uppercase tracking-wide">
                        Замерная станция
                      </div>

                      {/* Номер */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">Номер</span>
                        <input type="text"
                          value={sym.msNumber ?? ""}
                          onChange={(e) => updSym({ msNumber: e.target.value })}
                          placeholder="№"
                          className="flex-1 px-1 py-0.5 text-[11px]"
                          style={{ border: "1px solid var(--c-b2, #c8c8c8)", outline: "none", background: "white", borderRadius: "var(--radius-ui)" }} />
                      </div>

                      {/* Местоположение */}
                      <div className="flex items-start gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0 pt-0.5">Местоположение</span>
                        <textarea
                          value={sym.msLocation ?? ""}
                          onChange={(e) => updSym({ msLocation: e.target.value })}
                          rows={2}
                          placeholder="Введите местоположение..."
                          className="flex-1 px-1 py-0.5 text-[11px] resize-none"
                          style={{ border: "1px solid var(--c-b2, #c8c8c8)", outline: "none", background: "white", borderRadius: "var(--radius-ui)" }} />
                      </div>

                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-2 uppercase tracking-wide">
                        Параметры воздуха
                      </div>

                      {/* Площадь сечения */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">Сечение</span>
                        <input type="number" min={0} step={0.1}
                          value={sym.msArea ?? ""}
                          onChange={(e) => updSym({ msArea: e.target.value === "" ? undefined : Number(e.target.value) })}
                          placeholder="0.0"
                          className="flex-1 px-1 py-0.5 text-[11px] text-right"
                          style={{ border: "1px solid var(--c-b2, #c8c8c8)", outline: "none", background: "white", borderRadius: "var(--radius-ui)" }} />
                        <span className="text-gray-400 flex-shrink-0">м²</span>
                      </div>

                      {/* Расход воздуха */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">Расход</span>
                        <input type="number" min={0} step={0.1}
                          value={sym.msFlow ?? ""}
                          onChange={(e) => updSym({ msFlow: e.target.value === "" ? undefined : Number(e.target.value) })}
                          placeholder="0.0"
                          className="flex-1 px-1 py-0.5 text-[11px] text-right"
                          style={{ border: "1px solid var(--c-b2, #c8c8c8)", outline: "none", background: "white", borderRadius: "var(--radius-ui)" }} />
                        <span className="text-gray-400 flex-shrink-0">м³/с</span>
                      </div>

                      {/* Скорость воздуха */}
                      <div className="flex items-center gap-1 mb-2">
                        <span className="text-gray-500 w-24 flex-shrink-0">Скорость</span>
                        <input type="number" min={0} step={0.1}
                          value={sym.msVelocity ?? ""}
                          onChange={(e) => updSym({ msVelocity: e.target.value === "" ? undefined : Number(e.target.value) })}
                          placeholder="0.0"
                          className="flex-1 px-1 py-0.5 text-[11px] text-right"
                          style={{ border: "1px solid var(--c-b2, #c8c8c8)", outline: "none", background: "white", borderRadius: "var(--radius-ui)" }} />
                        <span className="text-gray-400 flex-shrink-0">м/с</span>
                      </div>

                      {/* Вычисленные значения из расчёта сети */}
                      {brForSym && (brForSym.flow != null || brForSym.velocity != null) && (
                        <div className="text-[10px] text-gray-400 bg-gray-50 rounded p-1.5 mt-1">
                          <div className="font-semibold text-gray-500 mb-0.5">Из расчёта сети:</div>
                          {brForSym.flow != null && (
                            <div>Расход: <span className="text-gray-600">{Math.abs(brForSym.flow).toFixed(2)} м³/с</span></div>
                          )}
                          {brForSym.velocity != null && (
                            <div>Скорость: <span className="text-gray-600">{Math.abs(brForSym.velocity).toFixed(2)} м/с</span></div>
                          )}
                          {brForSym.area != null && brForSym.area > 0 && (
                            <div>Сечение ветви: <span className="text-gray-600">{brForSym.area.toFixed(2)} м²</span></div>
                          )}
                        </div>
                      )}

                      {/* Отображаемые индикаторы ТОЛЬКО У ЭТОЙ станции.
                          Те же показатели можно включить сразу у всех станций
                          схемы — в «Панели информации», раздел «Замерные
                          станции». Здесь остаётся добавка для одной: включённое
                          общей галочкой отсюда не выключить, иначе две ручки
                          спорили бы за один показатель. */}
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-3 uppercase tracking-wide">
                        Отображаемые индикаторы
                      </div>
                      <div className="text-[10px] text-gray-500 mb-1.5 leading-snug">
                        Сразу у всех станций — в «Панели информации», раздел «Замерные станции».
                      </div>
                      {[
                        { key: "msIndNumber"   as const, label: "Номер замерной станции" },
                        { key: "msIndLocation" as const, label: "Местоположение" },
                        { key: "msIndFlow"     as const, label: "Расход воздуха" },
                        { key: "msIndArea"     as const, label: "Площадь сечения" },
                        { key: "msIndVelocity" as const, label: "Скорость воздуха" },
                      ].map(({ key, label }) => {
                        // Показатель уже включён общей галочкой — он виден на
                        // всех станциях, и личная галочка ничего не изменит.
                        const byAll = !!infoConfig[key];
                        return (
                          <label key={key}
                            title={byAll
                              ? "Включено для всех станций в «Панели информации»"
                              : undefined}
                            className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                            <input type="checkbox"
                              checked={byAll || !!sym[key]}
                              disabled={byAll}
                              onChange={(e) => updSym({ [key]: e.target.checked })}
                              style={{ width: 13, height: 13, accentColor: "#1e5a7a" }} />
                            <span className={byAll ? "text-gray-400" : "text-gray-700"}>{label}</span>
                          </label>
                        );
                      })}

                      {/* Настройки индикаторов (если хоть один включён —
                          личной галочкой или общей) */}
                      {(sym.msIndNumber || sym.msIndLocation || sym.msIndFlow || sym.msIndArea || sym.msIndVelocity
                        || infoConfig.msIndNumber || infoConfig.msIndLocation || infoConfig.msIndFlow
                        || infoConfig.msIndArea || infoConfig.msIndVelocity) && (
                        <div className="mt-2">
                          <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 uppercase tracking-wide">
                            Настройки
                          </div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <span className="text-gray-500 w-20 flex-shrink-0">Размер</span>
                            <input type="number" min={1} max={50} step={0.5}
                              value={sym.msIndFontSize ?? 9}
                              onChange={(e) => updSym({ msIndFontSize: Math.max(1, Math.min(50, Number(e.target.value) || 9)) })}
                              className="w-16 border border-gray-300 rounded px-1 text-right"
                              style={{ fontSize: 11 }} />
                            <span className="text-gray-400">м</span>
                          </div>

                          {/* Фон под индикаторами: на крупных схемах подписи ЗС
                              теряются среди выработок, поэтому по умолчанию
                              подкладывается зелёная плашка. */}
                          <IndicatorBgPicker
                            value={sym.msIndBgColor}
                            defaultColor={MS_IND_BG_DEFAULT}
                            onChange={(c) => updSym({ msIndBgColor: c })} />
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Подпись вентилятора: размер и положение ─────────────
                      Показатели вентилятора рисуются отдельной подписью у его
                      значка (какие именно — задаётся на вкладке «Индикаторы
                      вентилятора»). Здесь настраивается их размер, а положение
                      меняется перетаскиванием подписи мышью. */}
                  {isFanSym && brForSym?.hasFan && (
                    <>
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-3 uppercase tracking-wide">
                        Подпись вентилятора
                      </div>
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-20 flex-shrink-0">Размер</span>
                        <input type="number" min={1} max={50} step={0.5}
                          value={sym.fanIndFontSize ?? 9}
                          onChange={(e) => updSym({ fanIndFontSize: Math.max(1, Math.min(50, Number(e.target.value) || 9)) })}
                          className="w-16 border border-gray-300 rounded px-1 text-right"
                          style={{ fontSize: 11 }} />
                      </div>

                      {/* Фон под подписью вентилятора. По умолчанию синий —
                          чтобы оборудование отличалось от зелёных замерных
                          станций и не терялось на крупной схеме. */}
                      <IndicatorBgPicker
                        value={sym.fanIndBgColor}
                        defaultColor={FAN_IND_BG_DEFAULT}
                        onChange={(c) => updSym({ fanIndBgColor: c })} />
                      <div className="flex items-center gap-2 mb-1.5">
                        <button
                          onClick={() => updSym({ fanIndOffsetX: 0, fanIndOffsetY: 0 })}
                          className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 text-[11px] text-gray-700">
                          Вернуть на место
                        </button>
                        <span className="text-[10px] text-gray-400">подпись двигается мышью</span>
                      </div>
                    </>
                  )}

                  {/* ── Аэродинамическое сопротивление (только для перемычек с привязкой к ветви) ── */}
                  {isBulkheadSym && brForSym && (
                    <>
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-2 uppercase tracking-wide">
                        Аэродинамическое сопротивление
                      </div>

                      {/* R = ... кМюрг — вычисленное сопротивление этой перемычки */}
                      <div className="flex items-center justify-center py-1 mb-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[13px] font-semibold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
                          R = {(() => {
                            const mode = sym.bkResMode ?? "project";
                            // Все R в кМюрг = Па·с²/м⁶ (коэффициент = 1)
                            let rKmu = 0;
                            if (mode === "manual") {
                              rKmu = sym.bkManualR ?? 0; // кМюрг
                            } else if (mode === "survey") {
                              // R = ΔP/(Q²·9.81) кМюрг (ΔP в Па → кгс/м²), как в АэроСети
                              const q = sym.bkSurveyQ ?? 0;
                              const dp = sym.bkSurveyDP ?? 0;
                              rKmu = q > 0 ? dp / (q * q * 9.81) : 0;
                            } else {
                              const sw = sym.bkWindowArea ?? 0;
                              const branchArea = brForSym?.area ?? 0;
                              const isFullyOpen = (OPEN_DOOR_IDS.has(sym.typeId) && sw <= 0.001)
                                || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
                              if (isFullyOpen) {
                                rKmu = 0;
                              } else if (sw > 0.001) {
                                // Регулируемое окно: формула диафрагмы с учётом сечения (АэроСеть).
                                rKmu = windowBulkheadRkMurg(sw, branchArea, sym.typeId);
                              } else {
                                const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0)
                                  : (sym.bkAirPerm
                                    ?? (sym.bkBulkheadId ? mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.airPermeability : undefined)
                                    ?? brForSym?.bulkheadAirPerm ?? 0);
                                const rRefKmu = sym.bkBulkheadId ? (mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.rMkyurg ?? 0) : 0;
                                // Глухая: R=1/A²/1000; парус — калиброванная формула.
                                rKmu = kAir > 0
                                  ? solidBulkheadRkMurg(kAir, branchArea)
                                  : (sym.bkBulkheadR ?? rRefKmu ?? brForSym?.bulkheadR ?? 0);
                              }
                            }
                            if (rKmu === 0) return "0 кМюрг";
                            const fmt = (v: number) => {
                              const mag = Math.floor(Math.log10(Math.abs(v)));
                              return v.toFixed(Math.max(4, -mag + 2));
                            };
                            // rKmu уже в кМюрг (рудничные, кгс·с²/м⁸) — как в АэроСети
                            // (кирпичная перемычка = 65 кМюрг). Рядом показываем
                            // эквивалент в Н·с²/м⁸ = кМюрг × g (ΔP=R·Q² в Па).
                            const rNsm8 = rKmu * 9.80665;
                            return `${fmt(rKmu)} кМюрг  (${fmt(rNsm8)} Н·с²/м⁸)`;
                          })()}
                        </span>
                      </div>

                      {/* Задается */}
                      <div className="flex items-center gap-1 mb-1.5" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                        <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Задается:</span>
                        <select
                          value={sym.bkResMode ?? "project"}
                          onChange={e => updSym({ bkResMode: e.target.value as "project" | "survey" | "manual" })}
                          className="flex-1 text-[11px] px-1"
                          style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
                          <option value="project">Проектными данными</option>
                          <option value="survey">Воздушной съемкой</option>
                          <option value="manual">Вручную</option>
                        </select>
                      </div>

                      {/* Режим: Проектными данными */}
                      {(sym.bkResMode ?? "project") === "project" && (
                        <>
                          {isWindowBulkhead ? (
                            <div className="flex items-center gap-1 mb-1.5" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                              <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>S вентокна:</span>
                              <input type="number" step="0.1" min="0"
                                value={sym.bkWindowArea ?? 0}
                                onChange={e => updSym({ bkWindowArea: parseFloat(e.target.value) || 0 })}
                                className="flex-1 text-[11px] px-1 text-right"
                                style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                              <span className="text-[11px] text-gray-400 flex-shrink-0">м²</span>
                            </div>
                          ) : (
                            <>
                              {/* Тип перемычки из справочника */}
                              {mineBulkheads.length > 0 && (
                                <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                                  <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Тип:</span>
                                  <select
                                    value={sym.bkBulkheadId ?? brForSym?.bulkheadId ?? ""}
                                    onChange={e => {
                                      const sel = mineBulkheads.find(b => b.id === e.target.value);
                                      updSym({
                                        bkBulkheadId: e.target.value || undefined,
                                        bkBulkheadName: sel?.name ?? undefined,
                                        bkAirPerm: sel?.airPermeability ?? 0,
                                        bkBulkheadR: sel?.rMkyurg ?? 0,
                                        bkFailurePressure: sel?.failurePressure ?? 0,
                                      });
                                      // Синхронизируем failurePressure и name в ветвь
                                      if (sym.branchId) {
                                        updateBranch(sym.branchId, {
                                          bulkheadFailurePressure: sel?.failurePressure ?? 0,
                                          bulkheadName: sel?.name ?? "",
                                        });
                                      }
                                    }}
                                    className="flex-1 text-[11px] px-1"
                                    style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }}>
                                    <option value="">— не выбрано —</option>
                                    {mineBulkheads.map(b => (
                                      <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              <div className="font-semibold text-[10px] text-gray-500 mb-1 mt-0.5" style={{ letterSpacing: "0.03em" }}>
                                Воздухопроницаемость
                              </div>
                              <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                                <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Тип:</span>
                                <input type="checkbox"
                                  checked={sym.bkManualAirPerm ?? false}
                                  onChange={e => updSym({ bkManualAirPerm: e.target.checked })}
                                  style={{ width: 11, height: 11, cursor: "pointer", accentColor: "#1e5a7a" }} />
                                <span className="text-[11px] text-gray-600">Задается вручную</span>
                              </div>
                              <div className="flex items-center gap-1 mb-1.5" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                                <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Значение:</span>
                                {sym.bkManualAirPerm ? (
                                  <input type="number" step="0.0001"
                                    value={sym.bkCustomAirPerm ?? 0}
                                    onChange={e => updSym({ bkCustomAirPerm: parseFloat(e.target.value) || 0 })}
                                    className="flex-1 text-[11px] px-1 text-right"
                                    style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                                ) : (
                                  <span className="flex-1 text-right text-gray-700 text-[11px]">
                                    {(() => {
                                      const ap = sym.bkAirPerm
                                        ?? (sym.bkBulkheadId ? mineBulkheads.find(b => b.id === sym.bkBulkheadId)?.airPermeability : undefined)
                                        ?? brForSym?.bulkheadAirPerm;
                                      return ap ? `${ap.toFixed(4)} м²/(с·√Па)` : "—";
                                    })()}
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0 font-semibold" style={{ width: 72 }}>ΔP:</span>
                            <span className="flex-1 text-right font-semibold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
                              {symDeltaP != null ? `${Math.round(symDeltaP)} Па` : "— Па"}
                            </span>
                          </div>
                        </>
                      )}

                      {/* Режим: Воздушной съемкой */}
                      {(sym.bkResMode ?? "project") === "survey" && (
                        <>
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Расход:</span>
                            <input type="number" step="0.1"
                              value={sym.bkSurveyQ ?? 0}
                              onChange={e => updSym({ bkSurveyQ: parseFloat(e.target.value) || 0 })}
                              className="flex-1 text-[11px] px-1 text-right"
                              style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                          </div>
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Падение Р:</span>
                            <input type="number" step="1"
                              value={sym.bkSurveyDP ?? 0}
                              onChange={e => updSym({ bkSurveyDP: parseFloat(e.target.value) || 0 })}
                              className="flex-1 text-[11px] px-1 text-right"
                              style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-gray-500 flex-shrink-0 font-semibold" style={{ width: 72 }}>ΔP:</span>
                            <span className="flex-1 text-right font-semibold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
                              {symDeltaP != null ? `${Math.round(symDeltaP)} Па` : "— Па"}
                            </span>
                          </div>
                        </>
                      )}

                      {/* Режим: Вручную */}
                      {(sym.bkResMode ?? "project") === "manual" && (
                        <>
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>R (кМюрг):</span>
                            <input type="number" step="0.0001"
                              value={sym.bkManualR ?? 0}
                              onChange={e => updSym({ bkManualR: parseFloat(e.target.value) || 0 })}
                              className="flex-1 text-[11px] px-1 text-right"
                              style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white" }} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-gray-500 flex-shrink-0 font-semibold" style={{ width: 72 }}>ΔP:</span>
                            <span className="flex-1 text-right font-semibold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
                              {symDeltaP != null ? `${Math.round(symDeltaP)} Па` : "— Па"}
                            </span>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {/* ── Давление разрушения (только для перемычек с ветвью) ── */}
                  {isBulkheadSym && brForSym && !isWindowBulkhead && (() => {
                    const fp = sym.bkFailurePressure
                      ?? (sym.bkBulkheadId ? mineBulkheads.find(b => b.id === sym.bkBulkheadId)?.failurePressure : undefined)
                      ?? brForSym?.bulkheadFailurePressure;
                    return fp != null && fp > 0 ? (
                      <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                        <span className="text-gray-500 flex-shrink-0" style={{ width: 120 }}>Р разр.:</span>
                        <span className="flex-1 text-right text-[11px]" style={{ color: "var(--c-red, #b91c1c)" }}>
                          {fp} МПа
                        </span>
                      </div>
                    ) : null;
                  })()}

                  {/* ── Норма утечек через перемычку (для проверки схемы) ── */}
                  {isBulkheadSym && brForSym && !isWindowBulkhead && (() => {
                    const refNorm = mineBulkheads.find(b => b.id === (sym.bkBulkheadId ?? brForSym.bulkheadId))?.leakNorm ?? 0;
                    const norm50 = (sym.bkLeakNorm ?? 0) > 0 ? (sym.bkLeakNorm as number) : refNorm;
                    const dp = Math.abs(totalDepByBranch.get(brForSym.id) ?? 0);
                    const normQ = norm50 > 0 ? norm50 * Math.sqrt(dp / 50) : 0;
                    const factQ = Math.abs(brForSym.flow ?? 0) * 60;
                    const over = norm50 > 0 && factQ > normQ + 0.05;
                    return (
                      <>
                        <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                          <span className="text-gray-500 flex-shrink-0" style={{ width: 120 }} title="Норма утечек при перепаде 50 Па. Пусто — из справочника перемычек">Норма утечек:</span>
                          <input type="number" step="1" min="0"
                            value={sym.bkLeakNorm ?? ""}
                            placeholder={refNorm > 0 ? String(refNorm) : "—"}
                            onChange={e => { const v = parseFloat(e.target.value); updSym({ bkLeakNorm: v > 0 ? v : undefined }); }}
                            className="flex-1 text-[11px] px-1 text-right"
                            style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white", minWidth: 0 }} />
                          <span className="text-[11px] text-gray-400 flex-shrink-0" style={{ width: 38 }}>м³/мин</span>
                        </div>
                        <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                          <span className="flex-shrink-0" style={{ width: 120 }} />
                          <input type="number" step="0.01" min="0"
                            value={sym.bkLeakNorm != null ? +(sym.bkLeakNorm / 60).toFixed(4) : ""}
                            placeholder={refNorm > 0 ? String(+(refNorm / 60).toFixed(4)) : "—"}
                            onChange={e => { const v = parseFloat(e.target.value); updSym({ bkLeakNorm: v > 0 ? v * 60 : undefined }); }}
                            className="flex-1 text-[11px] px-1 text-right"
                            style={{ border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none", background: "white", minWidth: 0 }} />
                          <span className="text-[11px] text-gray-400 flex-shrink-0" style={{ width: 38 }}>м³/с</span>
                        </div>
                        {norm50 > 0 && factQ > 0 && (
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0" style={{ width: 120 }}>Утечки факт/норма:</span>
                            <span className="flex-1 text-right text-[11px] font-semibold"
                              style={{ color: over ? "var(--c-red, #b91c1c)" : "var(--c-green, #2e7d32)" }}>
                              {Math.round(factQ)} / {Math.round(normQ)} м³/мин{over ? ` (+${Math.round(factQ - normQ)})` : ""}
                              <span className="block">{(factQ / 60).toFixed(2)} / {(normQ / 60).toFixed(2)} м³/с</span>
                            </span>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* Направление (вентилятор) */}
                  {sym.typeId === "fan" && (
                    <>
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-20 flex-shrink-0">Направление</span>
                        <select value={sym.airDirection ?? "forward"}
                          onChange={(e) => updSym({ airDirection: e.target.value as "forward" | "reverse" })}
                          className="flex-1 text-[11px] px-1"
                          style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
                          <option value="forward">По ветви (→)</option>
                          <option value="reverse">Против ветви (←)</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                        <input type="checkbox"
                          checked={sym.showFanArrow ?? true}
                          onChange={(e) => updSym({ showFanArrow: e.target.checked })}
                          style={{ width: 13, height: 13, accentColor: "#1e5a7a" }} />
                        <span className="text-gray-700">Показывать стрелку направления</span>
                      </label>
                    </>
                  )}

                  {/* Направление (вентиляционная струя) */}
                  {VENT_JET_SYMBOL_IDS.has(sym.typeId) && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <span className="text-gray-500 w-20 flex-shrink-0">Направление</span>
                      <select value={sym.airDirection ?? "forward"}
                        onChange={(e) => updSym({ airDirection: e.target.value as "forward" | "reverse" })}
                        className="flex-1 text-[11px] px-1"
                        style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
                        <option value="forward">По ветви (→)</option>
                        <option value="reverse">Развернуть (←)</option>
                      </select>
                    </div>
                  )}



                  {/* ── Индикаторы (только для перемычек) ── */}
                  {isBulkheadSym && (
                    <>
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 uppercase tracking-wide">
                        Отображаемые индикаторы
                      </div>
                      {[
                        { key: "indDescription" as const, label: "Описание объекта" },
                        { key: "indResistance"  as const, label: "Аэродинамическое сопротивление" },
                        { key: "indDeltaP"      as const, label: "Модельное падение давления" },
                        { key: "indLeakage"     as const, label: "Утечки на перемычке" },
                      ].map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                          <input type="checkbox"
                            checked={!!sym[key]}
                            onChange={(e) => updSym({ [key]: e.target.checked })}
                            style={{ width: 13, height: 13, accentColor: "#1e5a7a" }} />
                          <span className="text-gray-700">{label}</span>
                        </label>
                      ))}

                      {/* Настройки текста индикаторов */}
                      {(sym.indDescription || sym.indResistance || sym.indDeltaP || sym.indLeakage) && (
                        <div className="mt-2">
                          <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 uppercase tracking-wide">
                            Настройки
                          </div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <span className="text-gray-500 w-20 flex-shrink-0">Размер</span>
                            <input type="number" min={1} max={50} step={0.5}
                              value={sym.indFontSize ?? 9}
                              onChange={(e) => updSym({ indFontSize: Math.max(1, Math.min(50, Number(e.target.value) || 9)) })}
                              className="w-16 border border-gray-300 rounded px-1 text-right"
                              style={{ fontSize: 11 }} />
                            <span className="text-gray-400">м</span>
                          </div>
                        </div>
                      )}

                      {/* Значения для справки */}
                      {brForSym && (sym.indResistance || sym.indDeltaP || sym.indLeakage) && (() => {
                        // Вычисляем R в кМюрг из sym.bk* (те же данные что в панели настройки)
                        // Соглашение: 1 кМюрг = 9.81 Н·с²/м⁸, 1 Мюрг = 9.81e-3 Н·с²/м⁸
                        const mode = sym.bkResMode ?? "project";
                        let rMkyurg = 0;
                        if (mode === "manual") {
                          rMkyurg = sym.bkManualR ?? 0; // уже в кМюрг
                        } else if (mode === "survey") {
                          const sq = sym.bkSurveyQ ?? 0; const dp = sym.bkSurveyDP ?? 0;
                          // R = ΔP/(Q²·9.81) кМюрг (ΔP в Па → кгс/м²), как в АэроСети
                          rMkyurg = sq > 0 ? dp / (sq * sq * 9.81) : 0;
                        } else {
                          const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0) : (sym.bkAirPerm ?? 0);
                          if (kAir > 0) {
                            // Глухая: R=1/A²/1000; парус — калиброванная формула.
                            rMkyurg = solidBulkheadRkMurg(kAir, brForSym.area ?? 0);
                          } else {
                            rMkyurg = (sym.bkBulkheadR ?? brForSym.bulkheadR ?? 0) / 1000; // Мюрг → кМюрг
                          }
                        }
                        if (rMkyurg === 0 && brForSym.bulkheadR > 0) rMkyurg = brForSym.bulkheadR / 1000;
                        return (
                          <div className="mt-2 p-1.5 rounded text-[10px] space-y-0.5"
                            style={{ background: "var(--c-tint-blue, #f0f4ff)", border: "1px solid #c8d8f0" }}>
                            {sym.indResistance && (
                              <div className="text-gray-600">
                                <span className="text-gray-400">R перемычки: </span>
                                {rMkyurg > 0 ? `${rMkyurg.toFixed(4)} кМюрг` : "—"}
                              </div>
                            )}
                            {sym.indDeltaP && (
                              <div className="text-gray-600">
                                <span className="text-gray-400">ΔP: </span>
                                {brForSym.dP !== 0 ? `${Math.abs(brForSym.dP).toFixed(1)} Па` : "—"}
                              </div>
                            )}
                            {sym.indLeakage && (
                              <div className="text-gray-600">
                                <span className="text-gray-400">Q через перемычку: </span>
                                {brForSym.flow !== 0 ? `${Math.abs(brForSym.flow).toFixed(2)} м³/с` : "—"}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {/* ── Насос ── */}
                  {sym.typeId === "pump" && (
                    <PumpPanel
                      sym={sym}
                      userPumps={userPumps}
                      onUpdate={updSym}
                      onAddUserPump={(pump) => setUserPumps((prev) => [...prev, pump])}
                      waterBranchResult={sym.branchId ? waterNetwork.branchResults.get(sym.branchId) : undefined}
                    />
                  )}
                </div>
              );
            })()}

            {/* Пусто — нет выбора */}
            {activeSide === "params" && !selectedNode && !selectedBranch && !selectedSymbolId && (
              <div className="p-4 text-center text-gray-400 text-xs">
                Выделите узел или ветвь на схеме, чтобы редактировать параметры
              </div>
            )}

            {/* ═══ ВКЛАДКА: ОБЩИЕ ════════════════════════════════════════ */}
            {activeSide === "general" && (
              <GeneralPropsPanel
                branch={selectedBranch}
                node={selectedBranch ? null : selectedNode}
                editCount={branchEditCount}
                horizons={horizons}
                multiHorizonMixed={multiHorizonMixed}
                defaultWidth={branchWidth}
                defaultBorder={branchBorder}
                onBranchPatch={updateSelectedBranches}
                onNodePatch={(patch) => { if (selectedNode) updateNode(selectedNode.id, patch); }}
                onRenameBranch={(newId) => {
                  if (!selectedBranch) return null;
                  // Номер ветви — её id: дубль сломал бы связи УО и выделение.
                  if (branchesRaw.some((b) => b.id === newId)) return `Номер ${newId} уже занят другой ветвью`;
                  pushHistory();
                  const oldId = selectedBranch.id;
                  setBranches((prev) => prev.map((b) => b.id === oldId ? { ...b, id: newId } : b));
                  setSchemaSymbols((prev) => prev.map((s) => s.branchId === oldId ? { ...s, branchId: newId } : s));
                  setSelectedBranchId(newId);
                  setIsDirty(true);
                  return null;
                }}
                thinLines={thinLines} setThinLines={setThinLines}
                colorByHorizon={colorByHorizon} setColorByHorizon={setColorByHorizon}
                surveyEditMode={surveyEditMode} setSurveyEditMode={setSurveyEditMode}
                movedNodeCount={movedNodeCount} totalNodes={nodes.length}
                onResetSurvey={requestResetToSurvey}
                onFixSurvey={fixCurrentAsSurvey}
              />
            )}

            {/* ═══ ВКЛАДКА: ГОРИЗОНТЫ ═══════════════════════════════════ */}
            {activeSide === "horizons" && (
              <HorizonsPanel
                horizons={horizons}
                setHorizons={setHorizons}
                branchCountByHorizon={branchCountByHorizon}
                activeHorizonId={activeHorizonId}
                setActiveHorizonId={setActiveHorizonId}
                hoveredHorizonId={hoveredHorizonId}
                setHoveredHorizonId={setHoveredHorizonId}
                editingHorizonImageId={editingHorizonImageId}
                setEditingHorizonImageId={setEditingHorizonImageId}
                editingPrintLayerId={editingPrintLayerId}
                setEditingPrintLayerId={setEditingPrintLayerId}
                updateHorizon={updateHorizon}
                addHorizon={addHorizon}
                removeHorizon={removeHorizon}
                uploadHorizonImage={uploadHorizonImage}
                removeHorizonImage={removeHorizonImage}
                setHorizonImageBounds={setHorizonImageBounds}
                getSchemaBounds={() => {
                  const ns = nodesRef.current;
                  if (ns.length === 0) return null;
                  const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
                  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
                }}
                moveHorizon={moveHorizon}
                horizonAlignFor={horizonAlignFor}
              />
            )}

            {/* ═══ ВКЛАДКА: ВЕНТИЛЯЦИЯ ═════════════════════════════════ */}
            {activeSide === "vent" && (
              <BranchVentPanel
                branch={selectedBranch}
                mineTypes={mineTypes}
                editCount={branchEditCount}
                unitsConfig={unitsConfig}
                bulkheadRKmu={selectedBranch ? (bulkheadRByBranch.get(selectedBranch.id) ?? 0) : 0}
                onApplyType={applyBranchType}
                onOpenTypesLibrary={() => { setShowEquipRef(true); setEquipRefTab("types"); }}
                onOpenTopology={() => setActiveSide("topology")}
              />
            )}

            {/* ═══ ВКЛАДКА: ИНДИКАТОРЫ ══════════════════════════════════ */}
            {activeSide === "indicators" && (
              <BranchIndicatorsPanel
                branch={selectedBranch}
                infoConfig={infoConfig}
                onChange={(indicators) => { if (selectedBranch) updateBranch(selectedBranch.id, { indicators }); }}
                onBranchPatch={updateSelectedBranches}
                editCount={branchEditCount}
              />
            )}

            {/* ═══ ВКЛАДКА: ИНДИКАТОРЫ ВЕНТИЛЯТОРА ══════════════════════ */}
            {activeSide === "fan-indicators" && (() => {
              const fanSym = selectedBranch
                ? schemaSymbols.find(s => FAN_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id)
                : undefined;
              return (
                <FanIndicatorsPanel
                  branch={selectedBranch}
                  onChange={(indicators) => { if (selectedBranch) updateBranch(selectedBranch.id, { indicators }); }}
                  fontSize={fanSym?.fanIndFontSize ?? 9}
                  onFontSize={fanSym ? (size) => setSchemaSymbols(prev => prev.map(s =>
                    s.id === fanSym.id ? { ...s, fanIndFontSize: size } : s)) : undefined}
                  onResetOffset={fanSym ? () => setSchemaSymbols(prev => prev.map(s =>
                    s.id === fanSym.id ? { ...s, fanIndOffsetX: 0, fanIndOffsetY: 0 } : s)) : undefined}
                />
              );
            })()}

            {/* ═══ ОСТАЛЬНЫЕ ВКЛАДКИ ═════════════════════════════════════ */}
            {(activeSide === "thermo"
              || activeSide === "measure" || activeSide === "pipes") && (
              <div className="p-4 text-center text-gray-400 text-xs">
                Вкладка «{activeSide}» в разработке
              </div>
            )}

            {/* ═══ ПОЗИЦИИ ══════════════════════════════════════════════ */}
            {activeSide === "positions" && (
              <PositionsPanel
                positions={positions}
                branches={branches}
                nodes={nodes}
                selectedPositionId={selectedPositionId}
                onSelect={(id) => {
                  // Смена позиции прерывает режимы, начатые для предыдущей:
                  // иначе маркер или выноска ушли бы не той позиции.
                  if (id !== selectedPositionId) { setPositionPlaceMode(false); setLeaderDrawMode(null); }
                  setSelectedPositionId(id);
                  if (!id) setPosBranchBindMode(false);
                }}
                onFocus={(pos) => {
                  setFocusPos({ x: pos.x, y: pos.y, z: pos.z ?? 0 });
                  setFocusNodeId(null); setFocusBranchId(null);
                  setFocusNonce(Date.now());
                }}
                onAdd={(pos) => setPositions((prev) => [...prev, pos])}
                onUpdate={(id, patch) => setPositions((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p))}
                onDelete={(id) => { setPositions((prev) => prev.filter((p) => p.id !== id)); setPosBranchBindMode(false); setLeaderDrawMode(null); setPositionPlaceMode(false); }}
                onPlaceMode={() => { if (selectedPositionId || positionPlaceMode) setPositionPlaceMode((v) => !v); }}
                placeModeActive={positionPlaceMode}
                branchBindMode={posBranchBindMode}
                onToggleBranchBind={() => { if (selectedPositionId) setPosBranchBindMode((v) => !v); }}
                leaderDrawMode={leaderDrawMode}
                onStartLeaderDraw={(posId) => { setLeaderDrawMode(posId); setLeaderExtraMode(false); setLeaderCursorScreen(null); setLeaderSnapBranch(null); }}
                onRemoveLeader={(posId) => setPositions(prev => prev.map(p => p.id === posId ? { ...p, leaderEndX: null, leaderEndY: null, leaderBranchId: null, leaderT: null } : p))}
                onStartExtraLeaderDraw={(posId) => { setLeaderDrawMode(posId); setLeaderExtraMode(true); setLeaderCursorScreen(null); setLeaderSnapBranch(null); }}
                onRemoveExtraLeader={(posId, leaderId) => setPositions(prev => prev.map(p => p.id === posId ? { ...p, extraLeaders: (p.extraLeaders ?? []).filter(el => el.id !== leaderId) } : p))}
              />
            )}

            {/* ═══ СРАВНЕНИЕ СХЕМ ══════════════════════════════════════ */}
            {activeSide === "compare" && (() => {
              const allDiffs = [
                ...((compareResult?.branches ?? []).filter(b => b.status !== "unchanged")),
              ];
              const filtered = compareFilter === "all" ? allDiffs : allDiffs.filter(b => b.status === compareFilter);
              const added   = compareResult?.branches.filter(b => b.status === "added").length ?? 0;
              const removed = compareResult?.branches.filter(b => b.status === "removed").length ?? 0;
              const changed = compareResult?.branches.filter(b => b.status === "changed").length ?? 0;
              const statusColor = (s: CompareStatus) => s === "added" ? "#16a34a" : s === "removed" ? "#dc2626" : "#d97706";
              const statusLabel = (s: CompareStatus) => s === "added" ? "Добавлена" : s === "removed" ? "Удалена" : "Изменена";
              const statusBg   = (s: CompareStatus) => s === "added" ? "#f0fdf4" : s === "removed" ? "#fef2f2" : "#fffbeb";
              return (
                <div className="flex flex-col h-full">
                  {/* Шапка */}
                  <div className="px-2 py-1.5 border-b border-gray-200 flex-shrink-0"
                    style={{ background: "linear-gradient(180deg,var(--c-tint-blue, #eff6ff),var(--c-tint-blue2, #dbeafe))" }}>
                    <div className="text-[11px] font-semibold text-blue-800">↔ Сравнение схем</div>
                    {compareResult ? (
                      <div className="text-[10px] text-blue-600 mt-0.5 truncate" title={compareResult.fileName}>
                        с: {compareResult.fileName}
                      </div>
                    ) : (
                      <div className="text-[10px] text-gray-400 mt-0.5">Файл не выбран</div>
                    )}
                  </div>

                  {!compareResult ? (
                    <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4">
                      <Icon name="GitCompare" size={32} style={{ color: "#81b0c4" }} />
                      <div className="text-[11px] text-center text-gray-500">
                        Загрузите предыдущую версию схемы для сравнения
                      </div>
                      <button
                        onClick={() => setCompareShowDialog(true)}
                        className="px-3 py-1.5 rounded text-[11px] font-medium text-white"
                        style={{ background: "var(--c-blue-bg, #2563eb)" }}>
                        Выбрать файл...
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Счётчики */}
                      <div className="flex gap-1 px-2 py-1.5 flex-shrink-0 border-b border-gray-100">
                        {[
                          { key: "all",     label: `Все (${allDiffs.length})`,     color: "var(--c-t2, #374151)", bg: "#f3f4f6" },
                          { key: "changed", label: `Изм. (${changed})`,            color: "var(--c-amber, #d97706)", bg: "#fffbeb" },
                          { key: "added",   label: `Доб. (${added})`,              color: "var(--c-green, #16a34a)", bg: "#f0fdf4" },
                          { key: "removed", label: `Уд. (${removed})`,             color: "var(--c-red, #dc2626)", bg: "#fef2f2" },
                        ].map(f => (
                          <button key={f.key}
                            onClick={() => setCompareFilter(f.key as typeof compareFilter)}
                            className="flex-1 px-1 py-0.5 rounded text-[9px] font-medium border transition-all"
                            style={{
                              background: compareFilter === f.key ? f.bg : "white",
                              color: f.color,
                              borderColor: compareFilter === f.key ? f.color : "var(--c-b1, #e5e7eb)",
                              fontWeight: compareFilter === f.key ? 700 : 500,
                            }}>
                            {f.label}
                          </button>
                        ))}
                      </div>

                      {/* Список */}
                      <div className="flex-1 overflow-y-auto">
                        {filtered.length === 0 ? (
                          <div className="p-4 text-center text-[11px] text-gray-400">Нет объектов</div>
                        ) : (
                          filtered.map(diff => (
                            <div key={diff.id}
                              className="border-b border-gray-100 cursor-pointer"
                              style={{ background: compareSelectedId === diff.id ? statusBg(diff.status) : "white" }}
                              onClick={() => {
                                setCompareSelectedId(diff.id === compareSelectedId ? null : diff.id);
                                // Центрируем камеру на ветви если она есть в текущей схеме
                                const br = branches.find(b => b.id === diff.id);
                                if (br) { setFocusPos(null); setFocusNodeId(null); setFocusBranchId(diff.id); setFocusNonce(n => n + 1); setSelectedBranchId(diff.id); }
                              }}>
                              {/* Строка ветви */}
                              <div className="flex items-center gap-1.5 px-2 py-1.5">
                                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                  style={{ background: statusColor(diff.status) }} />
                                <span className="text-[10px] font-medium flex-1 truncate" style={{ color: "var(--c-t1, #1f2937)" }}>
                                  {diff.name || diff.id}
                                </span>
                                <span className="text-[9px] px-1 rounded flex-shrink-0"
                                  style={{ background: statusBg(diff.status), color: statusColor(diff.status), border: `1px solid ${statusColor(diff.status)}40` }}>
                                  {statusLabel(diff.status)}
                                </span>
                              </div>
                              {/* Изменения — раскрываются при выборе */}
                              {compareSelectedId === diff.id && diff.changes && diff.changes.length > 0 && (
                                <div className="mx-2 mb-1.5 rounded overflow-hidden border border-amber-200"
                                  style={{ background: "var(--c-tint-amber, #fffbeb)" }}>
                                  <div className="px-2 py-0.5 text-[9px] font-semibold text-amber-700"
                                    style={{ background: "var(--c-tint-amber2, #fef3c7)", borderBottom: "1px solid #fde68a" }}>
                                    Изменённые поля
                                  </div>
                                  {diff.changes.map(ch => (
                                    <div key={ch.field} className="px-2 py-0.5 border-b border-amber-100 last:border-0">
                                      <div className="text-[9px] text-gray-500 font-medium">{ch.label}</div>
                                      <div className="flex items-center gap-1 text-[9px]">
                                        <span className="line-through text-red-500">{ch.oldVal}</span>
                                        <span className="text-gray-400">→</span>
                                        <span className="font-semibold text-green-700">{ch.newVal}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                      {/* Нижняя кнопка сброса */}
                      <div className="px-2 py-1.5 border-t border-gray-200 flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => setCompareShowDialog(true)}
                          className="flex-1 py-1 rounded text-[10px] font-medium border"
                          style={{ background: "white", color: "var(--c-t2, #374151)", borderColor: "var(--c-b2, #d1d5db)" }}>
                          Сменить файл
                        </button>
                        <button
                          onClick={() => { setCompareResult(null); setCompareSelectedId(null); }}
                          className="flex-1 py-1 rounded text-[10px] font-medium"
                          style={{ background: "var(--c-tint-red2, #fee2e2)", color: "var(--c-red, #dc2626)" }}>
                          Сбросить
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* ═══ РАСЧЁТ ГОРНОСПАСАТЕЛЕЙ ══════════════════════════════ */}
            {activeSide === "rescue" && (
              <PanelErrorBoundary title="горноспасатели">
              <RescuePanel
                nodes={nodes}
                branches={routeBranches}
                fireCalcDone={fireCalcDone}
                pickMode={rescuePickMode}
                onPickModeChange={setRescuePickMode}
                onRegisterPickHandler={(fn) => { rescuePickHandlerRef.current = fn; }}
                pickedStartId={rescueStartNodeId}
                pickedTargetId={rescueTargetNodeId}
                onPickedStartChange={setRescueStartNodeId}
                onPickedTargetChange={setRescueTargetNodeId}
                onRouteChange={(bIds, nIds, bDirs) => {
                  setRescuePathBranchIds(bIds);
                  setRescuePathNodeIds(nIds);
                  setRescuePathBranchDirs(bDirs);
                }}
                onWaypointsChange={setRescueWaypointIds}
                onAltRoutesChange={setRescueAltRouteColors}
                onRegisterBranchPickHandler={(fn) => { rescueBranchPickHandlerRef.current = fn; }}
              />
              </PanelErrorBoundary>
            )}

            {/* ═══ ВРЕМЯ ХОДА ГОРНОРАБОЧЕГО ════════════════════════════ */}
            {activeSide === "workerPath" && (
              <PanelErrorBoundary title="время хода горнорабочего">
              <WorkerPathPanel
                nodes={nodes}
                branches={routeBranches}
                fireCalcDone={fireCalcDone}
                pickMode={workerPickMode}
                onPickModeChange={setWorkerPickMode}
                onRegisterPickHandler={(fn) => { workerPickHandlerRef.current = fn; }}
                pickedStartId={workerStartNodeId}
                pickedTargetId={workerTargetNodeId}
                onPickedStartChange={setWorkerStartNodeId}
                onPickedTargetChange={setWorkerTargetNodeId}
                onRouteChange={(bIds, nIds, bDirs) => {
                  setWorkerPathBranchIds(bIds);
                  setWorkerPathNodeIds(nIds);
                  setWorkerPathBranchDirs(bDirs);
                }}
                onWaypointsChange={setWorkerWaypointIds}
              />
              </PanelErrorBoundary>
            )}

            {/* ═══ ВКЛАДКА: РАСХОД ВОЗДУХА ════════════════════════════ */}
            {/* ═══ ВКЛАДКА: ФОРМА СЕЧЕНИЯ ═════════════════════════════ */}
            {/* ═══ УЧАСТКИ РУДНИКА (расчёт количества воздуха) ═════════ */}
            {activeSide === "ventsections" && (
              <VentSectionsPanel
                sections={ventSections}
                onChange={setVentSections}
                branches={branches}
                selectedBranchIds={Array.from(selectedBranchIds)}
                onSelectBranches={(ids) => {
                  setSelectedNodeId(null);
                  setSelectedNodeIds(new Set());
                  setSelectedBranchId(ids[0] ?? null);
                  setSelectedBranchIds(new Set(ids));
                }}
                onOpenNorms={() => { setShowEquipRef(true); setEquipRefTab("airnorms"); }}
                onOpenSummary={() => setShowAirDemand(true)}
                colorFill={colorMode === "ventsection"}
                onToggleColorFill={() =>
                  setColorMode(colorMode === "ventsection" ? "none" : "ventsection")}
              />
            )}

            {activeSide === "section" && (() => {
              // Считаем ветви каждой формы по ВИДИМЫМ горизонтам — легенда должна
              // отражать то, что реально видно на схеме.
              const counts = new Map<SectionKind, number>();
              let total = 0;
              for (const b of branches) {
                if (b.isVentPipeBranch) continue;
                if (b.horizonId) {
                  const hz = horizons.find(x => x.id === b.horizonId);
                  if (hz && !hz.visible) continue;
                }
                const k = sectionKind(b);
                counts.set(k, (counts.get(k) ?? 0) + 1);
                total++;
              }
              const order: SectionKind[] = ["round", "square", "rect", "arch", "trap", "custom"];
              // Выделить на схеме все видимые ветви выбранной формы.
              const selectKind = (k: SectionKind) => {
                const ids: string[] = [];
                for (const b of branches) {
                  if (b.isVentPipeBranch) continue;
                  if (b.horizonId) {
                    const hz = horizons.find(x => x.id === b.horizonId);
                    if (hz && !hz.visible) continue;
                  }
                  if (sectionKind(b) === k) ids.push(b.id);
                }
                if (ids.length === 0) return;
                setSelectedNodeId(null);
                setSelectedNodeIds(new Set());
                setSelectedBranchIds(new Set(ids));
                setSelectedBranchId(ids[0]);
              };
              return (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)" }}>
                    <button
                      onClick={() => setColorMode(colorMode === "section" ? "none" : "section")}
                      className="h-6 px-3 rounded text-[11px] font-semibold"
                      style={{
                        background: colorMode === "section" ? "var(--c-red, #dc2626)" : "var(--c-s3, #f3f4f6)",
                        color: colorMode === "section" ? "white" : "var(--c-t2, #374151)",
                        border: "1px solid " + (colorMode === "section" ? "var(--c-red, #b91c1c)" : "var(--c-b2, #d1d5db)"),
                      }}>
                      {colorMode === "section" ? "Заливка ВКЛ" : "Заливка ВЫКЛ"}
                    </button>
                    <span className="text-[10px] text-gray-400">Расчёт не требуется</span>
                  </div>

                  <div className="flex-1 overflow-y-auto px-3 py-3">
                    <div className="text-[10px] font-semibold text-gray-500 mb-2 uppercase tracking-wide">Легенда</div>
                    {order.map(k => {
                      const n = counts.get(k) ?? 0;
                      const pct = total > 0 ? (n / total) * 100 : 0;
                      return (
                        <div key={k}
                          onClick={() => selectKind(k)}
                          title={n === 0 ? "Нет таких ветвей" : `Выделить на схеме (${n} шт.)`}
                          className={n === 0 ? "flex items-center gap-2 py-1 px-1" : "flex items-center gap-2 py-1 px-1 rounded cursor-pointer hover:bg-blue-50"}
                          style={{ opacity: n === 0 ? 0.35 : 1 }}>
                          <div style={{
                            width: 18, height: 12, borderRadius: "var(--radius-ui)", flexShrink: 0,
                            background: SECTION_KIND_COLORS[k],
                            border: "1px solid rgba(0,0,0,0.15)",
                          }} />
                          <span className="text-[11px] text-gray-700 flex-1">{SECTION_KIND_LABELS[k]}</span>
                          <span className="text-[10px] text-gray-500 tabular-nums">
                            {n} · {pct.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                    <div className="mt-3 pt-2 text-[10px] text-gray-400" style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)" }}>
                      Всего ветвей: {total}
                    </div>
                    <div className="mt-2 text-[10px] text-gray-400 leading-snug">
                      Клик по строке — выделить все ветви этой формы на схеме.
                      Квадратным считается прямоугольное сечение с равными сторонами.
                    </div>
                  </div>
                </div>
              );
            })()}

            {(activeSide === "flowQ" || activeSide === "velocityV") && (() => {
              // Одна панель обслуживает обе заливки: по расходу (Q, м³/с) и по
              // скорости (V, м/с). Отличаются только величина, единицы и свои
              // настройки шкалы — логика отрисовки общая.
              const isVel = activeSide === "velocityV";
              const mode: "flowQ" | "velocityV" = isVel ? "velocityV" : "flowQ";
              const unit = isVel ? "м/с" : "м³/с";
              const scaleMin = isVel ? velColorMin : flowColorMin;
              const scaleMax = isVel ? velColorMax : flowColorMax;
              const scaleHue = isVel ? velColorHue : flowColorHue;
              const setScaleMin = isVel ? setVelColorMin : setFlowColorMin;
              const setScaleMax = isVel ? setVelColorMax : setFlowColorMax;
              const setScaleHue = isVel ? setVelColorHue : setFlowColorHue;
              // Фактический диапазон величины по видимым ветвям (после расчёта).
              // Скрытые горизонты и вентиляционные трубы не учитываем — иначе
              // шкала растянулась бы по объектам, которых на схеме не видно.
              const autoRange = (): { lo: number; hi: number; n: number } => {
                let lo = Infinity, hi = -Infinity, n = 0;
                for (const b of branches) {
                  if (b.isVentPipeBranch) continue;
                  if (b.horizonId) {
                    const h = horizons.find(x => x.id === b.horizonId);
                    if (h && !h.visible) continue;
                  }
                  const v = isVel ? (b.velocity ?? 0) : Math.abs(b.flow ?? 0);
                  if (!isFinite(v) || v <= 0) continue;
                  if (v < lo) lo = v;
                  if (v > hi) hi = v;
                  n++;
                }
                return n > 0 ? { lo, hi, n } : { lo: 0, hi: 0, n: 0 };
              };
              const applyAuto = () => {
                const { lo, hi, n } = autoRange();
                if (n === 0) return;
                // Округляем «наружу» до круглого шага, чтобы подписи были читаемыми.
                const step = isVel ? 1 : 5;
                const rLo = Math.max(0, Math.floor(lo / step) * step);
                let rHi = Math.ceil(hi / step) * step;
                if (rHi <= rLo) rHi = rLo + step;
                setScaleMin(rLo);
                setScaleMax(rHi);
              };
              const rangeInfo = autoRange();
              const BAR_H = 320;
              const hueStops: Record<string, [string, string]> = {
                red:   ["#ffffff", "#dc2626"],
                blue:  ["#ffffff", "#1e5a7a"],
                green: ["#ffffff", "#16a34a"],
              };
              const [stopLo, stopHi] = hueStops[scaleHue];
              const tickCount = 6;
              const ticks = Array.from({ length: tickCount }, (_, i) => {
                const frac = i / (tickCount - 1);
                const val = scaleMin + frac * (scaleMax - scaleMin);
                return { val, frac };
              });
              return (
                <div className="flex flex-col h-full">
                  {/* Переключатель вкл/выкл */}
                  <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)" }}>
                    <button
                      onClick={() => setColorMode(colorMode === mode ? "none" : mode)}
                      className="h-6 px-3 rounded text-[11px] font-semibold"
                      style={{
                        background: colorMode === mode ? "var(--c-red, #dc2626)" : "var(--c-s3, #f3f4f6)",
                        color: colorMode === mode ? "white" : "var(--c-t2, #374151)",
                        border: "1px solid " + (colorMode === mode ? "var(--c-red, #b91c1c)" : "var(--c-b2, #d1d5db)"),
                      }}>
                      {colorMode === mode ? "Заливка ВКЛ" : "Заливка ВЫКЛ"}
                    </button>
                    <span className="text-[10px] text-gray-400">После расчёта F9</span>
                  </div>

                  {/* Шкала — по центру панели */}
                  <div className="flex-1 flex items-center justify-center">
                    <div className="flex gap-3">
                      {/* Вертикальная полоса */}
                      <div style={{
                        width: 22, height: BAR_H,
                        background: `linear-gradient(to bottom, ${stopHi}, ${stopLo})`,
                        border: "1px solid var(--c-b2, #d1d5db)", borderRadius: "var(--radius-ui)", flexShrink: 0,
                      }} />
                      {/* Подписи делений */}
                      <div style={{ position: "relative", height: BAR_H, width: 72, flexShrink: 0 }}>
                        {ticks.slice().reverse().map(({ val, frac }) => (
                          <div key={val} style={{
                            position: "absolute",
                            top: (1 - frac) * BAR_H - 7,
                            left: 0, display: "flex", alignItems: "center", gap: 4,
                          }}>
                            <div style={{ width: 5, height: 1, background: "#9ca3af" }} />
                            <span style={{ fontSize: 10, color: "var(--c-t2, #374151)", whiteSpace: "nowrap" }}>
                              {val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)} {unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Настройки шкалы */}
                  <div className="px-3 py-3" style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Настройки шкалы</span>
                      <button
                        onClick={applyAuto}
                        disabled={rangeInfo.n === 0}
                        title={rangeInfo.n === 0
                          ? "Нет данных — выполните расчёт (F9)"
                          : `Подставить фактический диапазон: ${rangeInfo.lo.toFixed(isVel ? 1 : 1)}…${rangeInfo.hi.toFixed(1)} ${unit}`}
                        className="h-5 px-2 rounded text-[10px] font-semibold"
                        style={{
                          background: rangeInfo.n === 0 ? "var(--c-s3, #f3f4f6)" : "var(--c-tint-blue, #eff6ff)",
                          color: rangeInfo.n === 0 ? "var(--c-t4, #9ca3af)" : "var(--c-blue, #1d4ed8)",
                          border: "1px solid " + (rangeInfo.n === 0 ? "var(--c-b1, #e5e7eb)" : "#b0cfdc"),
                          cursor: rangeInfo.n === 0 ? "not-allowed" : "pointer",
                        }}>
                        Авто
                      </button>
                    </div>
                    {rangeInfo.n > 0 && (
                      <div className="text-[10px] text-gray-400 mb-2">
                        Факт: {rangeInfo.lo.toFixed(1)}…{rangeInfo.hi.toFixed(1)} {unit}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] text-gray-600" style={{ width: 60 }}>Мин, {unit}</span>
                      <input type="number" min="0" step={isVel ? 1 : 5} value={scaleMin}
                        onChange={e => setScaleMin(Number(e.target.value))}
                        className="flex-1 text-[11px] text-right px-1"
                        style={{ border: "1px solid var(--c-b2, #d1d5db)", borderRadius: "var(--radius-ui)", height: 22, outline: "none" }} />
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[11px] text-gray-600" style={{ width: 60 }}>Макс, {unit}</span>
                      <input type="number" min="1" step={isVel ? 1 : 5} value={scaleMax}
                        onChange={e => setScaleMax(Number(e.target.value))}
                        className="flex-1 text-[11px] text-right px-1"
                        style={{ border: "1px solid var(--c-b2, #d1d5db)", borderRadius: "var(--radius-ui)", height: 22, outline: "none" }} />
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600" style={{ width: 60 }}>Цвет</span>
                      <div className="flex gap-1">
                        {(["red", "blue", "green"] as const).map(h => (
                          <button key={h} onClick={() => setScaleHue(h)}
                            title={h === "red" ? "Красный" : h === "blue" ? "Синий" : "Зелёный"}
                            style={{
                              width: 22, height: 22, borderRadius: "var(--radius-ui)",
                              border: scaleHue === h ? "2px solid #111" : "1px solid var(--c-b2, #d1d5db)",
                              background: h === "red" ? "var(--c-red, #dc2626)" : h === "blue" ? "var(--c-blue, #2563eb)" : "var(--c-green, #16a34a)",
                              cursor: "pointer",
                            }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── РАЗДЕЛИТЕЛЬ ШИРИНЫ ЛЕВОЙ ПАНЕЛИ (drag) ───────────────── */}
        <div onMouseDown={startLeftDrag} onDoubleClick={resetLeftWidth}
          className="w-1 flex-shrink-0 cursor-col-resize hover:bg-blue-400 active:bg-blue-500 transition-colors"
          style={{ background: "#d0d0d0" }}
          title="Перетащите, чтобы изменить ширину панели. Двойной клик — ширина по размеру окна" />
        </>)}
    </>
  );
}
