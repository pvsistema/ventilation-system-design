import Icon from "@/components/ui/icon";
import TopoCanvas from "@/components/cad/TopoCanvas";
import { type TopoNode, type TopoBranch, project3D, unprojectToPlane } from "@/lib/topology";
import InfoPanel from "@/components/cad/InfoPanel";
import { Card, Field, Switch, PresetSlider } from "@/components/cad/propUi";
import { type Position } from "@/lib/positions";
import { BULKHEAD_SYMBOL_IDS, HEATER_SYMBOL_IDS, WINDOW_BULKHEAD_IDS, REDUCER_SYMBOL_IDS, FIRE_SYMBOL_IDS, EXPLOSION_SYMBOL_IDS, FAN_SYMBOL_IDS, SHAFT_MOUTH_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { PRESSURE_REDUCING_VALVES } from "@/lib/pressureReducingValves";
import { EXPLOSION_HAZARD_COLORS, explosionZoneColor, channelDecay, LAMBDA_DEFAULT, junctionTransmission } from "@/lib/explosionCalculator";
import { collectBarriers, crossBarriers, type BlastBarrier, type BarrierHit } from "@/lib/blastBarriers";
import { makeTextBlock } from "./cadTypes";
import type { SchemaSymbol } from "./cadTypes";
import ScrollArrows from "@/components/cad/ScrollArrows";
import { propagateVgsch } from "@/lib/vgschNetwork";
import { type VgschSource } from "@/lib/vgschBlast";
import { ToolBtn, ViewBtn } from "./cadComponents";
import type { CadPageState } from "./useCadPage";

// Рабочая область (canvas + инструменты) и правая «Панель информации».
export default function CadWorkspace({ c }: { c: CadPageState }) {
  const {
    isDemo,
    filePathRef,
    setActiveRibbon,
    activeSide,
    setActiveSide,
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
    pushHistory,
    selectedNodeId,
    setSelectedNodeId,
    selectedBranchId,
    setSelectedBranchId,
    tool,
    setTool,
    zLevel,
    surveyEditMode,
    branches,
    nodesById,
    selectedBranch,
    waterNetwork,
    lastBranchTab,
    updateNode,
    updateBranch,
    horizons,
    setHorizons,
    editingHorizonImageId,
    editingPrintLayerId,
    hoveredHorizonId,
    setHorizonImageBounds,
    setPrintLayerBounds,
    handleNodeAdd,
    handleBranchAdd,
    handleSplitBranchAt,
    handleNodeMove,
    showRampDialog,
    fireResult,
    setFireResult,
    fireCalcDone,
    setFireCalcDone,
    rescuePickMode,
    rescuePickHandlerRef,
    rescuePathBranchIds,
    rescuePathBranchDirs,
    rescuePathNodeIds,
    rescueAltRouteColors,
    rescueBranchPickHandlerRef,
    rescueNodeLetters,
    workerPickMode,
    workerPickHandlerRef,
    workerPathBranchIds,
    workerPathBranchDirs,
    workerPathNodeIds,
    workerNodeLetters,
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
    smokeTimeMinutes,
    setSmokeTimeMinutes,
    smokeMaxTime,
    setSmokeMaxTime,
    smokeTimeStep,
    setSmokeTimeStep,
    smokeVisThreshold,
    setSmokeVisThreshold,
    smokeAnimating,
    setSmokeAnimating,
    smokeAnimRef,
    vcSolving,
    solveProgress,
    vcError,
    setShowFireControl,
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
    flowColorMax,
    flowColorHue,
    velColorMin,
    velColorMax,
    velColorHue,
    workPlane,
    viewScale,
    setViewScale,
    fitToScreenNonce,
    setFitToScreenNonce,
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
    scaleTextMax,
    scaleBranchMin,
    scaleBranchMax,
    widthBySectionOn,
    tube3dOn,
    scalePositionMin,
    scalePositionMax,
    positionGostMm,
    bulkheadScale,
    fanScale,
    compareResult,
    focusNonce,
    setFocusNonce,
    focusNodeId,
    setFocusNodeId,
    focusBranchId,
    focusPos,
    setFocusPos,
    focusScreenReq,
    blastHighlightPos,
    checkHighlightPos,
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
    showPositions,
    posColorInner,
    posColorOuter,
    branchWidth,
    branchBorder,
    thinLines,
    setThinLines,
    showFlowArrows,
    setShowFlowArrows,
    pollutionThreshold,
    infoConfig,
    zScale,
    setZScale,
    xyScale,
    setXyScale,
    unitsConfig,
    schemaSymbols,
    setSchemaSymbols,
    updateInfoConfigSynced,
    infoPanelConfig,
    blastThresholds,
    showBlastBarrierChart,
    ventSectionColors,
    selectedSymbolId,
    setSelectedSymbolId,
    selectedSymbolIds,
    setSelectedSymbolIds,
    pendingSymbol,
    setPendingSymbol,
    activeSymbolTypeId,
    setActiveSymbolTypeId,
    setFanSymbolBranchId,
    setSquadDialog,
    setSquadCount,
    SQUAD_TYPES,
    addSymbol,
    removeSymbol,
    rightPanelWidth,
    setLeftPanelOpen,
    rightPanelOpen,
    setRightPanelOpen,
    rightAutoCollapsed,
    startRightDrag,
    resetRightWidth,
    liveCanvasRef,
    setCanvasSize,
    selectedBranchIds,
    setSelectedBranchIds,
    rampSlopeColors,
    handleBranchMultiSelect,
    selectedNodeIds,
    setSelectedNodeIds,
    alignRoles,
    handleNodeMultiSelect,
    depressogramHighlight,
    setDepressogramHighlight,
    depressogramPickMode,
    depressogramManualBranches,
    setDepressogramManualBranches,
    fireControlPreview,
    fireControlPreviewMode,
    setFireControlPreviewMode,
    previewBranches,
    previewSmokeColors,
    closeFireControlPreview,
    fileHandleRef,
    applyProjectData,
    setCtxMenu,
    applyFireControlActions,
    handleSolve,
    handleDeleteSelected,
  } = c;

  return (
    <>
        {/* ── РАБОЧАЯ ОБЛАСТЬ (CANVAS + ИНСТРУМЕНТЫ) ────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--c-s1, #ffffff)" }}>

          {/* Локальная панель инструментов рисования.
              ScrollArrows добавляет стрелки по краям, когда панель не влезает
              по ширине — листать можно не целясь в полосу прокрутки. */}
          <ScrollArrows
            className="h-8 flex items-center gap-1 px-2 overflow-x-auto overflow-y-hidden [&>*]:shrink-0 cad-toolbar-scroll w-full"
            step={180}
            wrapperStyle={{ flex: "0 0 auto" }}
            style={{ background: "var(--c-s2, #f5f5f5)", borderBottom: "1px solid var(--c-b2, #d0d0d0)" }}>
            <ToolBtn icon="MousePointer2" label="Выбрать" active={tool === "select"} onClick={() => setTool("select")} />
            <ToolBtn icon="Plus" label="Узел" active={tool === "node"} onClick={() => setTool("node")} />
            <ToolBtn icon="GitBranch" label="Ветвь" active={tool === "branch"} onClick={() => setTool("branch")} />
            <ToolBtn icon="Move" label="Панорама" active={tool === "pan"} onClick={() => setTool("pan")} />
            <ToolBtn icon="RotateCw" label="Вращать" active={tool === "rotate"} onClick={() => setTool("rotate")} />
            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />
            <ToolBtn icon="Trash2" label="Удалить" disabled={!selectedNodeId && !selectedBranchId}
              onClick={handleDeleteSelected} />
            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Ракурсы ── */}
            <span className="text-[11px] text-gray-700">Вид:</span>
            <ViewBtn label="План" preset="plan" current={viewInfo} onClick={setPreset} hint="XY сверху" />
            <ViewBtn label="Фронт" preset="front" current={viewInfo} onClick={setPreset} hint="XZ спереди" />
            <ViewBtn label="Профиль" preset="left" current={viewInfo} onClick={setPreset} hint="YZ сбоку" />
            <ViewBtn label="ИЗО⤴" preset="isoSE" current={viewInfo} onClick={setPreset} hint="Изометрия Ю-В" />
            <ViewBtn label="ИЗО⤵" preset="isoSW" current={viewInfo} onClick={setPreset} hint="Изометрия Ю-З" />

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Чертёж / Модель ──
                Стоит сразу за ракурсами: это продолжение той же мысли «как
                смотрим на схему». Кнопка одна, с переключением состояния —
                два отдельных режима в тулбаре занимали бы место и создавали
                ложное впечатление, что их можно включить одновременно. */}
            <button
              onClick={() => setViewMode(m => m === "draft" ? "model" : "draft")}
              className="h-6 px-2 flex items-center gap-1 rounded text-[11px]"
              style={{
                background: viewMode === "model" ? "var(--c-blue, #2563eb)" : "white",
                color: viewMode === "model" ? "white" : "var(--c-t1, #1f1f1f)",
                border: "1px solid " + (viewMode === "model" ? "var(--c-blue, #1d4ed8)" : "var(--c-b2, #d0d0d0)"),
              }}
              title={viewMode === "model"
                ? "Вернуться к чертежу: редактирование, подписи, печать"
                : "Объёмный просмотр схемы. Только просмотр — правка и печать в чертеже"}>
              <Icon name={viewMode === "model" ? "PenLine" : "Box"} size={11} />
              {viewMode === "model" ? "Чертёж" : "Модель"}
            </button>

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Режим цветовой заливки ── */}
            <select
              value={colorMode}
              onChange={e => setColorMode(e.target.value as "none" | "flowQ" | "velocityV" | "section" | "ventsection" | "horizon")}
              className="h-6 text-[11px] px-1 rounded"
              style={{ border: "1px solid var(--c-b2, #d0d0d0)", background: colorMode !== "none" ? "var(--c-tint-blue, #eff6ff)" : "white", color: colorMode !== "none" ? "var(--c-blue, #1d4ed8)" : "var(--c-t1, #1f1f1f)", fontWeight: colorMode !== "none" ? 600 : 400, outline: "none" }}
              title="Режим цветовой заливки ветвей">
              <option value="none">— Заливка выкл</option>
              <option value="flowQ">Расход воздуха</option>
              <option value="velocityV">Скорость воздуха</option>
              <option value="section">Форма сечения</option>
              <option value="ventsection">Участки рудника</option>
              <option value="horizon">Цвет горизонта</option>
            </select>

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Анимация потока (toggle) ── */}
            <button
              onClick={() => setFlowDisplay(d => d === "off" ? "flow" : "off")}
              className="h-6 px-2 flex items-center gap-1 rounded text-[11px]"
              style={{
                background: flowDisplay !== "off" ? "var(--c-blue, #2563eb)" : "white",
                color: flowDisplay !== "off" ? "white" : "var(--c-t1, #1f1f1f)",
                border: "1px solid " + (flowDisplay !== "off" ? "var(--c-blue, #1d4ed8)" : "var(--c-b2, #d0d0d0)"),
              }}
              title="Движение воздуха — стрелки направления вдоль ветвей, вкл/откл">
              <Icon name="Wind" size={11} /> Анимация
            </button>

            {/* Скорость анимации — появляется только когда анимация включена.
                На больших схемах быстрый бег стрелок мешает читать чертёж. */}
            {flowDisplay !== "off" && (
              <select
                value={animSpeed}
                onChange={e => setAnimSpeed(Number(e.target.value))}
                className="h-6 px-1 rounded text-[11px] bg-white"
                style={{ border: "1px solid var(--c-b2, #d0d0d0)", color: "var(--c-t1, #1f1f1f)" }}
                title="Скорость движения стрелок">
                <option value={0.25}>Очень медленно</option>
                <option value={0.5}>Медленно</option>
                <option value={1}>Обычно</option>
                <option value={2}>Быстро</option>
              </select>
            )}

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Пределы масштабов (фиксированный размер объектов) ── */}
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none h-6 px-2 rounded text-[11px]"
              style={{
                background: scaleLimitsEnabled ? "var(--c-tint-blue, #eff6ff)" : "white",
                color: scaleLimitsEnabled ? "var(--c-blue, #1d4ed8)" : "var(--c-t2, #374151)",
                border: "1px solid " + (scaleLimitsEnabled ? "#81b0c4" : "var(--c-b2, #d0d0d0)"),
                fontWeight: scaleLimitsEnabled ? 600 : 400,
              }}
              title={scaleLimitsEnabled
                ? "Фиксированный размер объектов ВКЛ — ветви и символы не увеличиваются при зуме. Нажмите для отключения"
                : "Фиксированный размер объектов ВЫКЛ — при зуме всё масштабируется. Нажмите для включения"}>
              <input
                type="checkbox"
                checked={scaleLimitsEnabled}
                onChange={e => setScaleLimitsEnabled(e.target.checked)}
                style={{ width: 12, height: 12, accentColor: "#1e5a7a", cursor: "pointer" }}
              />
              <Icon name="ZoomIn" size={11} /> Масштаб
            </label>
            <button
              onClick={() => setScaleSettingsOpen(true)}
              className="h-6 px-2 flex items-center rounded text-[11px]"
              style={{
                background: "white",
                color: "var(--c-t2, #374151)",
                border: "1px solid var(--c-b2, #d0d0d0)",
              }}
              title="Настройки пределов масштабирования">
              <Icon name="Settings2" size={11} />
            </button>

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {vcError && (
              <span className="text-[10px] text-red-600 max-w-[160px] truncate" title={vcError}>
                ⚠ {vcError}
              </span>
            )}

            {/* ── Реверс вентилятора (только если выбрана ветвь с вентилятором) ── */}
            {selectedBranch?.hasFan && (
              <>
                <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />
                <button
                  onClick={() => updateBranch(selectedBranch.id, { fanReverse: !selectedBranch.fanReverse })}
                  className="h-6 px-2 flex items-center gap-1 rounded text-[11px] font-semibold"
                  style={{
                    background: selectedBranch.fanReverse ? "var(--c-red, #dc2626)" : "var(--c-tint-green, #f0fdf4)",
                    color: selectedBranch.fanReverse ? "white" : "var(--c-green, #15803d)",
                    border: `1px solid ${selectedBranch.fanReverse ? "var(--c-red, #b91c1c)" : "#86efac"}`,
                  }}
                  title={selectedBranch.fanReverse
                    ? `Вент. «${selectedBranch.fanName || selectedBranch.id}» — РЕВЕРС. Нажмите для прямого направления`
                    : `Вент. «${selectedBranch.fanName || selectedBranch.id}» — прямой. Нажмите для реверса`}>
                  {selectedBranch.fanReverse
                    ? <><Icon name="ArrowLeft" size={11} /> Реверс</>
                    : <><Icon name="ArrowRight" size={11} /> Прямой</>}
                </button>
              </>
            )}

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Масштаб 1:N ── */}
            <span className="text-[11px] text-gray-700" title="Масштаб как в АэроСеть: 1:N">М 1:</span>
            <input type="number" value={Math.round(1 / Math.max(0.0001, (savedViewStateRef.current?.scale ?? viewScale) * 0.001))}
              onChange={(e) => {
                const n = Math.max(50, Math.min(500000, Number(e.target.value)));
                // viewScale (px/м) = 1 / (N · 0.001), считаем что 1 px ≈ 1 мм на экране
                setViewScale(1 / (n * 0.001));
              }}
              className="cad-input text-[11px] py-0 w-20 text-right"
              title="Знаменатель масштаба (например 5000 = 1:5000)" />
            <button onClick={() => setFitToScreenNonce(Date.now())}
              className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-blue-50"
              title="Подогнать под экран — показать всю сеть">
              По экрану
            </button>
            <button onClick={() => setViewScale(1)}
              className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-blue-50"
              title="Масштаб 1:1000 (1 px = 1 м)">
              1:1000
            </button>

            <div className="ml-auto flex items-center gap-2 text-[11px] text-gray-600">
              <span className={viewInfo.is3D ? "text-purple-700 font-semibold" : ""}>
                {viewInfo.is3D ? "3D" : "2D"}
              </span>
              <span>·</span>
              <span>Узлов: <b>{nodes.length}</b></span>
              <span>·</span>
              <span>Ветвей: <b>{branches.length}</b></span>
            </div>
          </ScrollArrows>

          {/* Стартовый экран — только когда схема пустая */}
          {nodes.length === 0 && branches.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10"
              style={{ background: "rgba(255,255,255,0.0)" }}>
              <div className="flex flex-col items-center gap-4 opacity-40">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <rect x="8" y="8" width="48" height="48" rx="8" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 3"/>
                  <line x1="32" y1="20" x2="32" y2="44" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
                  <line x1="20" y1="32" x2="44" y2="32" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
                <div className="text-center">
                  <p className="text-[15px] font-semibold text-slate-500">Рабочая область пуста</p>
                  <p className="text-[12px] text-slate-400 mt-1">Нажмите <b>+ Узел</b> на панели инструментов,</p>
                  <p className="text-[12px] text-slate-400">или откройте файл проекта через <b>Файл → Открыть</b></p>
                </div>
              </div>
            </div>
          )}

          {/* Холст топологии */}
          <div className="flex-1 relative"
            style={{
              cursor: leaderDrawMode || tool === "textblock" ? "crosshair" : undefined,
              // Мягкая внутренняя тень по краям: схема визуально «лежит» в окне,
              // а не сливается с панелями. На печать не влияет — это только рамка
              // контейнера, сам холст остаётся белым.
              // В режиме правки координат (F2) рамка становится красной: в нём
              // перетаскивание меняет длины выработок и результат расчёта,
              // поэтому режим должно быть невозможно не заметить.
              boxShadow: surveyEditMode
                ? "inset 0 0 0 3px #dc2626, inset 0 1px 6px rgba(15,23,42,0.06)"
                : "inset 0 0 0 1px rgba(15,23,42,0.08), inset 0 1px 6px rgba(15,23,42,0.06)",
            }}
            onMouseMove={(e) => {
              const vs = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
              const rect = e.currentTarget.getBoundingClientRect();
              const sx = e.clientX - rect.left;
              const sy = e.clientY - rect.top;
              // Режим рисования выноски — snap к ближайшей ветви
              if (leaderDrawMode) {
                setLeaderCursorScreen({ sx, sy });
                // Ищем ближайшую ветвь в радиусе 14px (как hitBranchR в TopoCanvas)
                const SNAP_R = 14;
                let bestBranchId: string | null = null;
                let bestT = 0.5;
                let bestSx = sx, bestSy = sy;
                const _xyS = xyScale ?? 1;
                const _zS = zScale ?? 1;
                // Узел обычно принадлежит нескольким выработкам, и его экранное
                // положение пересчитывалось заново для каждой из них. Считаем
                // один раз за движение мыши и переиспользуем.
                const projCache = new Map<string, { sx: number; sy: number }>();
                const projOpts = {
                  scale: vs.scale ?? 1, offsetX: vs.offsetX ?? 0, offsetY: vs.offsetY ?? 0,
                  azimuth: vs.azimuth ?? 0, elevation: vs.elevation ?? 90,
                };
                const projOf = (n: TopoNode) => {
                  let p = projCache.get(n.id);
                  if (!p) {
                    const q = project3D({ x: n.x * _xyS, y: n.y * _xyS, z: n.z * _zS }, projOpts);
                    p = { sx: q.sx, sy: q.sy };
                    projCache.set(n.id, p);
                  }
                  return p;
                };
                // Сравниваем КВАДРАТЫ расстояний — извлекать корень для каждой
                // выработки незачем, порядок он не меняет.
                let bestDist2 = SNAP_R * SNAP_R;
                for (const b of branches) {
                  const fromN = nodesById.get(b.fromId);
                  const toN   = nodesById.get(b.toId);
                  if (!fromN || !toN) continue;
                  const f = projOf(fromN);
                  const t2 = projOf(toN);
                  // Быстрый отсев: выработка целиком дальше радиуса привязки по
                  // одной из осей — считать проекцию точки на неё не нужно.
                  if (Math.min(f.sx, t2.sx) - SNAP_R > sx || Math.max(f.sx, t2.sx) + SNAP_R < sx
                   || Math.min(f.sy, t2.sy) - SNAP_R > sy || Math.max(f.sy, t2.sy) + SNAP_R < sy) continue;
                  const C = t2.sx - f.sx, D = t2.sy - f.sy;
                  const A = sx - f.sx,   B = sy - f.sy;
                  const lenSq = C * C + D * D;
                  if (lenSq < 1) continue;
                  const tt = Math.max(0.02, Math.min(0.98, (A * C + B * D) / lenSq));
                  const px = f.sx + C * tt, py = f.sy + D * tt;
                  const ddx = sx - px, ddy = sy - py;
                  const dist2 = ddx * ddx + ddy * ddy;
                  if (dist2 < bestDist2) {
                    bestDist2 = dist2; bestBranchId = b.id; bestT = tt;
                    bestSx = px; bestSy = py;
                  }
                }
                // Курсор не у выработки — самый частый случай. Если привязки не
                // было и нет, состояние не трогаем: иначе каждое движение мыши
                // впустую перерисовывало бы экран.
                if (bestBranchId === null) {
                  if (leaderSnapBranchRef.current !== null) setLeaderSnapBranch(null);
                  return;
                }
                setLeaderSnapBranch({ branchId: bestBranchId, t: bestT, sx: bestSx, sy: bestSy });
                return;
              }
              // Drag конца выноски — проецируем на плоскость z=pos.z
              if (leaderDragRef.current) {
                const dragPos = positions.find(p => p.id === leaderDragRef.current!.posId);
                const pz = (dragPos?.z ?? 0) * (zScale ?? 1);
                const xy = xyScale ?? 1;
                // Маркер и выноска теперь живут в мировых координатах (масштабируются
                // как ветвь), поэтому конец выноски следует прямо за курсором без
                // компенсации зажатого масштаба.
                const w = unprojectToPlane(sx, sy, vs, { axis: "z", value: pz });
                if (!w) return;
                setPositions(prev => prev.map(p =>
                  p.id === leaderDragRef.current!.posId
                    ? { ...p, leaderEndX: xy !== 1 ? w.x / xy : w.x, leaderEndY: xy !== 1 ? w.y / xy : w.y }
                    : p
                ));
                return;
              }
              // Drag текстового блока
              if (textDragRef.current) {
                const { id, startSx, startSy, startWx, startWy } = textDragRef.current;
                if (Math.hypot(sx - startSx, sy - startSy) < 4) return;
                const wStart = unprojectToPlane(startSx, startSy, vs, { axis: "z", value: 0 });
                const wCur   = unprojectToPlane(sx, sy, vs, { axis: "z", value: 0 });
                if (!wStart || !wCur) return;
                const xy = xyScale ?? 1;
                const dx = xy !== 1 ? (wCur.x - wStart.x) / xy : wCur.x - wStart.x;
                const dy = xy !== 1 ? (wCur.y - wStart.y) / xy : wCur.y - wStart.y;
                setTextBlocks(prev => prev.map(t => t.id === id ? { ...t, x: startWx + dx, y: startWy + dy } : t));
                return;
              }
              // Drag маркера позиции — только если мышь реально сдвинулась (порог 4px)
              if (!posDragRef.current) return;
              const { id, startSx, startSy, startWx, startWy } = posDragRef.current;
              if (Math.hypot(sx - startSx, sy - startSy) < 4) return;
              const dragPos = positions.find(p => p.id === id);
              const pz = (dragPos?.z ?? 0) * (zScale ?? 1);
              const wStart = unprojectToPlane(startSx, startSy, vs, { axis: "z", value: pz });
              const wCur   = unprojectToPlane(sx, sy, vs, { axis: "z", value: pz });
              if (!wStart || !wCur) return;
              const xy = xyScale ?? 1;
              const dx = xy !== 1 ? (wCur.x - wStart.x) / xy : wCur.x - wStart.x;
              const dy = xy !== 1 ? (wCur.y - wStart.y) / xy : wCur.y - wStart.y;
              setPositions(prev => prev.map(p => p.id === id ? { ...p, x: startWx + dx, y: startWy + dy, placed: true } : p));
            }}
            onClick={(e) => {
              // Режим текстового блока — создаём блок в точке клика
              if (tool === "textblock") {
                const vs2 = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
                const rect = e.currentTarget.getBoundingClientRect();
                const sx2 = e.clientX - rect.left;
                const sy2 = e.clientY - rect.top;
                const w = unprojectToPlane(sx2, sy2, vs2, { axis: "z", value: 0 });
                if (w) {
                  const xy = xyScale ?? 1;
                  const nb = makeTextBlock({ x: xy !== 1 ? w.x / xy : w.x, y: xy !== 1 ? w.y / xy : w.y });
                  pushHistory();
                  setTextBlocks(prev => [...prev, nb]);
                  setSelectedTextBlockId(nb.id);
                  setEditingTextBlockId(nb.id);
                  setTool("select");
                }
                return;
              }
              // Клик на пустое место — снять выбор позиции и текстового блока
              if (!leaderDrawMode) {
                if (posBranchBindMode) return;
                setSelectedPositionId(null);
                setSelectedTextBlockId(null);
                return;
              }
              const _extraId = () => Math.random().toString(36).slice(2, 10);
              if (leaderSnapBranch) {
                // Привязываем выноску к ветви
                const { branchId, t } = leaderSnapBranch;
                if (leaderExtraMode) {
                  // Дополнительная выноска — добавляем в extraLeaders, координаты маркера НЕ трогаем
                  setPositions(prev => prev.map(p =>
                    p.id === leaderDrawMode
                      ? { ...p, extraLeaders: [...(p.extraLeaders ?? []), { id: _extraId(), branchId, t }] }
                      : p
                  ));
                } else {
                  // Находим опорный узел ветви (верхний по z)
                  const br = branches.find(b => b.id === branchId);
                  const fromN = br ? nodes.find(n => n.id === br.fromId) : null;
                  const toN   = br ? nodes.find(n => n.id === br.toId)   : null;
                  const refN = fromN && toN
                    ? (fromN.z >= toN.z ? fromN : toN)
                    : (fromN ?? toN);
                  setPositions(prev => prev.map(p => {
                    if (p.id !== leaderDrawMode) return p;
                    const base = { ...p, leaderBranchId: branchId, leaderT: t, leaderEndX: null, leaderEndY: null };
                    // Авто-координаты: если не размещена, z=0 (не соответствует сети)
                    // ИЛИ выноска привязывается к другой ветви (в т.ч. после удаления
                    // прежней выноски — тогда leaderBranchId был очищен). Это позволяет
                    // переставить позицию к новой ветви при повторной привязке.
                    if (refN && (!p.placed || p.z === 0 || p.leaderBranchId !== branchId)) {
                      const OFFSET = 50;
                      return { ...base, x: refN.x + OFFSET, y: refN.y + OFFSET, z: refN.z, placed: true };
                    }
                    return { ...base, placed: true };
                  }));
                }
              } else {
                // Свободная точка
                const vs2 = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
                const rect = e.currentTarget.getBoundingClientRect();
                const sx2 = e.clientX - rect.left;
                const sy2 = e.clientY - rect.top;
                const drawPos = positions.find(p => p.id === leaderDrawMode);
                // Если z позиции = 0 и есть узлы — берём z ближайшего узла чтобы не улететь при больших координатах
                let pz = drawPos?.z ?? 0;
                if (pz === 0 && nodes.length > 0) {
                  pz = nodes[0].z;
                }
                const w = unprojectToPlane(sx2, sy2, vs2, { axis: "z", value: pz });
                if (w) {
                  if (leaderExtraMode) {
                    setPositions(prev => prev.map(p =>
                      p.id === leaderDrawMode
                        ? { ...p, extraLeaders: [...(p.extraLeaders ?? []), { id: _extraId(), endX: w.x, endY: w.y }] }
                        : p
                    ));
                  } else {
                    setPositions(prev => prev.map(p =>
                      p.id === leaderDrawMode
                        ? { ...p, leaderEndX: w.x, leaderEndY: w.y, leaderBranchId: null, leaderT: null }
                        : p
                    ));
                  }
                }
              }
              setLeaderDrawMode(null);
              setLeaderExtraMode(false);
              setLeaderCursorScreen(null);
              setLeaderSnapBranch(null);
            }}
            onMouseUp={() => {
              posDragRef.current = null; setDraggingPosId(null);
              leaderDragRef.current = null; setDraggingLeaderPosId(null);
              textDragRef.current = null; setDraggingTextId(null);
            }}
            onMouseLeave={() => {
              posDragRef.current = null; setDraggingPosId(null);
              leaderDragRef.current = null; setDraggingLeaderPosId(null);
              textDragRef.current = null; setDraggingTextId(null);
              setLeaderCursorScreen(null);
              setLeaderSnapBranch(null);
            }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              if (!file.name.endsWith(".vproj") && !file.name.endsWith(".json")) {
                alert("Поддерживаются только файлы .vproj");
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const data = JSON.parse(reader.result as string);
                  if (!data.nodes || !Array.isArray(data.nodes)) {
                    alert("Файл не является проектом Вентиляция-CAD.");
                    return;
                  }
                  if ((nodes.length > 0 || branchesRaw.length > 0) &&
                      !window.confirm("Открыть проект? Текущие данные будут заменены.")) return;
                  fileHandleRef.current = null;
                  filePathRef.current = null;
                  applyProjectData(data, file.name, true);
                } catch {
                  alert("Ошибка чтения файла.");
                }
              };
              reader.readAsText(file);
            }}>
            {/* На время предпросмотра подобранного варианта холст получает
                ветви с ЕГО расходами (previewBranches). Сам проект при этом
                не меняется — панели и сохранение видят настоящие данные. */}
            <TopoCanvas
              nodes={nodes}
              branches={previewBranches}
              selectedNodeId={selectedNodeId}
              selectedBranchId={selectedBranchId}
              tool={tool}
              zLevel={zLevel}
              viewPreset={viewPreset}
              onViewChange={setViewInfo}
              flowDisplay={flowDisplay}
              animSpeed={animSpeed}
              colorMode={colorMode === "horizon" ? "none" : colorMode}
              sectionColors={ventSectionColors}
              flowColorMin={flowColorMin}
              flowColorMax={flowColorMax}
              flowColorHue={flowColorHue}
              velColorMin={velColorMin}
              velColorMax={velColorMax}
              velColorHue={velColorHue}
              workPlane={workPlane}
              horizons={horizons}
              highlightHorizonId={hoveredHorizonId}
              branchWidth={branchWidth}
              branchBorder={branchBorder}
              thinLines={thinLines}
              fixedObjectScale={scaleLimitsEnabled}
              canvasThreshold={canvasThreshold}
              nodeLodThresholds={nodeLodThresholds}
              scaleLimits={(scaleLimitsEnabled || widthBySectionOn) ? {
                textMin: scaleTextMin, textMax: scaleTextMax,
                branchMin: scaleBranchMin, branchMax: scaleBranchMax,
              } : undefined}
              widthBySection={widthBySectionOn}
              tube3d={tube3dOn}
              viewMode={viewMode}
              bulkheadScale={bulkheadScale}
              fanScale={fanScale}
              colorByHorizon={colorMode === "horizon"}
              showFlowArrows={showFlowArrows}
              pollutionThreshold={pollutionThreshold}
              scaleOverride={viewScale}
              onScaleChange={setViewScale}
              fitToScreenNonce={fitToScreenNonce}
              focusNonce={focusNonce}
              focusNodeId={focusNodeId}
              focusBranchId={focusBranchId}
              focusPos={focusPos}
              focusScreen={focusScreenReq && focusScreenReq.nonce === focusNonce ? focusScreenReq : null}
              highlightPos={(showBlastBarrierChart ? blastHighlightPos : null) ?? checkHighlightPos}
              onRegisterCanvasEl={(el) => {
                liveCanvasRef.current = el;
                if (el) {
                  const w = el.clientWidth || el.width, h = el.clientHeight || el.height;
                  // Тот же размер — не создаём новый объект, иначе лишний перерендер страницы
                  setCanvasSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
                }
              }}
              restoreView={savedViewToRestore}
              onRestoreViewDone={() => setSavedViewToRestore(null)}
              onViewStateChange={handleViewStateChange}
              editingHorizonImageId={editingHorizonImageId}
              onHorizonImageBoundsChange={setHorizonImageBounds}
              editingPrintLayerId={editingPrintLayerId}
              onPrintLayerBoundsChange={setPrintLayerBounds}
              onPrintLayerChange={(horizonId, patch) =>
                setHorizons(prev => prev.map(h => h.id !== horizonId || !h.printLayer ? h : {
                  ...h, printLayer: { ...h.printLayer, ...patch },
                }))
              }
              onNodeAdd={handleNodeAdd}
              onNodeMove={handleNodeMove}
              onNodeDragStart={() => pushHistory()}
              onBranchAdd={handleBranchAdd}
              onSplitBranchAt={handleSplitBranchAt}
              onSelectNode={(id) => {
                if (id && rescuePickMode) {
                  rescuePickHandlerRef.current?.(id);
                  setSelectedNodeId(id);
                  return;
                }
                if (id && workerPickMode) {
                  workerPickHandlerRef.current?.(id);
                  setSelectedNodeId(id);
                  return;
                }
                setSelectedNodeId(id); setSelectedNodeIds(new Set()); setSelectedSymbolId(null); setSelectedSymbolIds(new Set()); if (id) { setSelectedBranchId(null); setActiveSide("params"); }
              }}
              onSelectBranch={(id) => {
                if (posBranchBindMode && selectedPositionId && id) {
                  // Режим F3: привязываем/отвязываем ветвь к позиции
                  // Вычисляем авто-координаты ДО setPositions (избегаем stale closure)
                  const br = branches.find(b => b.id === id);
                  const fromN = br ? nodes.find(n => n.id === br.fromId) : null;
                  const toN   = br ? nodes.find(n => n.id === br.toId)   : null;
                  // Берём узел с наибольшей Z (меньше по глубине = ближе к поверхности)
                  const refN = fromN && toN
                    ? (fromN.z >= toN.z ? fromN : toN)
                    : (fromN ?? toN);

                  setPositions(prev => prev.map(p => {
                    if (p.id !== selectedPositionId) return p;
                    const has = p.branchIds.includes(id);
                    if (has) {
                      return { ...p, branchIds: p.branchIds.filter(x => x !== id) };
                    }
                    const newBranchIds = [...p.branchIds, id];
                    // Авто-размещение если не размещена ИЛИ z=0 (не на сети)
                    if (refN && (!p.placed || p.z === 0)) {
                      const OFFSET = 50;
                      return { ...p, branchIds: newBranchIds, x: refN.x + OFFSET, y: refN.y + OFFSET, z: refN.z, placed: true };
                    }
                    return { ...p, branchIds: newBranchIds };
                  }));
                  return;
                }
                // Одиночный клик: устанавливаем как основную выделенную ветвь
                // и делаем её единственной в мультиселекте (не сбрасываем весь Set,
                // а заменяем на Set из одной ветви — это позволяет Ctrl+клик накапливать дальше)
                setSelectedBranchId(id);
                setSelectedBranchIds(id ? new Set([id]) : new Set());
                setSelectedSymbolId(null); setSelectedSymbolIds(new Set());
                if (id) { setSelectedNodeId(null); setFanSymbolBranchId(null); setActiveSide("general"); }
              }}
              onNodeContextMenu={(id, x, y) => { setSelectedNodeId(id); setSelectedBranchId(null); setCtxMenu({ kind: "node", id, x, y }); }}
              onBranchContextMenu={(id, x, y) => {
                // Правый клик: если ветвь уже в мультиселекте — не трогаем Set,
                // иначе начинаем новый мультиселект с этой ветви
                setSelectedBranchId(id);
                setSelectedNodeId(null);
                setSelectedBranchIds(prev => prev.has(id) ? prev : new Set([id]));
                setCtxMenu({ kind: "branch", id, x, y });
              }}
              selectedBranchIds={selectedBranchIds}
              onBranchMultiSelect={handleBranchMultiSelect}
              selectedNodeIds={selectedNodeIds}
              onNodeMultiSelect={handleNodeMultiSelect}
              alignRoles={alignRoles}
              infoConfig={infoConfig}
              unitsConfig={unitsConfig}
              waterNodeResults={waterNetwork.nodeResults}
              waterBranchResults={waterNetwork.branchResults}
              zScale={zScale}
              xyScale={xyScale}
              schemaSymbols={schemaSymbols}
              selectedSymbolId={selectedSymbolId}
              selectedSymbolIds={selectedSymbolIds}
              onSelectSymbol={(id) => { setSelectedSymbolId(id); setSelectedSymbolIds(new Set()); if (id) setActiveSide("params"); }}
              onSymbolMultiSelect={(id) => {
                setSelectedSymbolIds(prev => {
                  const next = new Set(prev);
                  // Если Set пуст и есть одиночно выбранный символ — включаем его тоже
                  if (next.size === 0 && selectedSymbolId && selectedSymbolId !== id) {
                    next.add(selectedSymbolId);
                  }
                  if (next.has(id)) { next.delete(id); } else { next.add(id); }
                  return next;
                });
                setSelectedSymbolId(id);
              }}
              onSymbolDragStart={() => pushHistory()}
              onSymbolMove={(id, x, y) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, x, y } : s))}
              onSymbolMoveAlongBranch={(id, t) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, t } : s))}
              onSymbolOffset={(id, ox, oy) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, offsetX: ox, offsetY: oy } : s))}
              onSymbolIndOffset={(id, ox, oy) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, indOffsetX: ox, indOffsetY: oy } : s))}
              onSymbolMsIndOffset={(id, ox, oy) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, msIndOffsetX: ox, msIndOffsetY: oy } : s))}
              onSymbolFanIndOffset={(id, ox, oy) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, fanIndOffsetX: ox, fanIndOffsetY: oy } : s))}
              onSymbolScale={(id, delta) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, scale: Math.max(0.4, Math.min(4, (s.scale ?? 1) + delta)) } : s))}
              onSymbolDelete={(id) => {
                pushHistory();
                const sym = schemaSymbols.find(s => s.id === id);
                // Сброс вентилятора при удалении его значка.
                // РАНЬШЕ проверялся только тип "fan", а значков вентилятора
                // пять («вентилятор», «местного проветривания», «осевой»,
                // «рециркуляционный», «стационарный»). Из-за этого при удалении
                // клавишей Del исчезала только картинка, а характеристики
                // (модель, обороты, напор) оставались на выработке и продолжали
                // участвовать в расчёте. Теперь сбрасываем для ЛЮБОГО значка
                // вентилятора и очищаем ВСЕ его поля, включая площадь окна.
                if (sym && FAN_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  updateBranch(sym.branchId, {
                    hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0,
                    fanStopped: false, fanReverse: false, fanRpm: 0,
                    fanBladeAngle: 0, fanParallel: 1, fanEfficiency: 0,
                    fanShaftPower: 0, fanInstall: "Без перемычки", fanCrossingR: 0,
                    fanWindowArea: 0, fanMode: "constant",
                  }, false);
                }
                // Сброс перемычки при удалении символа
                if (sym && BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  const otherBulkheads = schemaSymbols.filter(
                    s => s.id !== id && BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === sym.branchId
                  );
                  if (otherBulkheads.length === 0) {
                    updateBranch(sym.branchId, {
                      hasBulkhead: false,
                      bulkheadR: 0, bulkheadAirPerm: 0,
                      bulkheadManualR: 0, bulkheadSurveyQ: 0, bulkheadSurveyDP: 0,
                    }, false);
                  }
                }
                // Удалили значок техники под очагом — больше не подставлять
                if (sym?.id.startsWith("SYM_FIREVEH_") && sym.branchId) {
                  updateBranch(sym.branchId, { fireVehicleSymbolOff: true }, false);
                }
                // Сброс очага пожара при удалении символа
                if (sym && FIRE_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  updateBranch(sym.branchId, {
                    hasFire: false, fireVehicleSymbolOff: false,
                    fireComputedTemp: 0, fireComputedNatDep: 0,
                    fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0,
                  }, false);
                  setFireResult(null); setFireCalcDone(false);
                }
                // Сброс взрыва при удалении символа
                if (sym && EXPLOSION_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  updateBranch(sym.branchId, {
                    hasExplosion: false,
                    explosionComputedQtnt: 0, explosionComputedMaxP: 0,
                    explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0,
                    explosionComputedR_heavy: 0, explosionComputedR_medium: 0,
                    explosionComputedR_light: 0, explosionComputedDeltaP: 0,
                  }, false);
                  setExplosionResult(null); setExplosionResultByBranch(new Map()); setExplosionBarriers(null); setExplosionCalcDone(false);
                }
                // Сброс редуктора при удалении символа клапана
                if (sym && REDUCER_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  updateBranch(sym.branchId, {
                    wpHasReducer: false,
                    wpReducerModel: "kppr_50",
                    wpReducerOutPressure: 0.5,
                    wpReducerMaxFlow: 25,
                  }, false);
                }
                // Сброс запорного вентиля при удалении символа
                if (sym?.typeId === "valve_water" && sym.branchId) {
                  updateBranch(sym.branchId, { wpHasGate: false, wpGateClosed: false }, false);
                }
                removeSymbol(id);
                setSelectedSymbolId(null);
                setSelectedSymbolIds(new Set());
              }}
              onSymbolClick={(symId) => {
                // Одиночный клик: выбрать УО и показать свойства (панель params)
                const sym = schemaSymbols.find(s => s.id === symId);
                setSelectedSymbolId(symId);
                // Одиночный клик по вентилятору — сразу открываем вкладку настроек
                // вентилятора в левой панели (а не свойства ветви).
                if (sym && FAN_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(sym.branchId);
                  setActiveSide("fan");
                  return;
                }
                // Одиночный клик по запорному вентилю (водопровод) —
                // открываем вкладку "Трубы: вода" с его настройками.
                if ((sym?.typeId === "valve_water" || (sym && REDUCER_SYMBOL_IDS.has(sym.typeId))) && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("waterpipes");
                  return;
                }
                // Для перемычек, замерных станций, насосов, калориферов и
                // устьев стволов — НЕ выбираем ветвь, чтобы открылась панель
                // символа с его параметрами, а не свойства выработки.
                if (sym?.branchId && sym.typeId !== "pump" && !BULKHEAD_SYMBOL_IDS.has(sym.typeId)
                    && !HEATER_SYMBOL_IDS.has(sym.typeId) && sym.typeId !== "measure_station"
                    && !SHAFT_MOUTH_SYMBOL_IDS.has(sym.typeId)) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                } else {
                  setSelectedBranchId(null);
                  setSelectedNodeId(null);
                }
                setFanSymbolBranchId(null);
                setActiveSide("params");
              }}
              onSymbolDblClick={(symId) => {
                // Двойной клик: открыть настройки вентилятора / перемычки / аварии
                const sym = schemaSymbols.find(s => s.id === symId);
                setSelectedSymbolId(symId);
                if (sym?.typeId === "fan" && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(sym.branchId);
                  setActiveSide("fan");
                } else if (sym && FIRE_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("accidents");
                  setActiveRibbon("involve");
                } else if (sym && EXPLOSION_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("blast");
                  setActiveRibbon("involve");
                } else if ((sym?.typeId === "valve_water" || (sym && REDUCER_SYMBOL_IDS.has(sym.typeId))) && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("waterpipes");
                } else if (sym && HEATER_SYMBOL_IDS.has(sym.typeId)) {
                  // Двойной клик по калориферу — его собственные параметры
                  // (мощность, температура, сезон), а не свойства выработки.
                  setSelectedBranchId(null);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("params");
                } else if (sym && BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  // Двойной клик на перемычку — открываем ветвь и переходим на вкладку Топология
                  // (там находится блок настроек перемычки)
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setSelectedSymbolId(symId);
                  setFanSymbolBranchId(null);
                  setActiveSide("topology");
                } else {
                  setSelectedBranchId(null);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("params");
                }
              }}
              onBranchLabelOffset={(id, ox, oy) => setBranches(prev => prev.map(b => b.id === id ? { ...b, labelOffsetX: ox, labelOffsetY: oy } : b))}
              activeSymbolTypeId={activeSymbolTypeId}
              pendingSymbolTypeId={pendingSymbol?.typeId ?? null}
              onPendingSymbolPlace={(branchId, t, x, y) => {
                if (!pendingSymbol) return;
                const newSym: SchemaSymbol = {
                  ...pendingSymbol,
                  branchId,
                  t,
                  x,
                  y,
                  offsetX: 0,
                  offsetY: 0,
                };
                // ── Вставка ВЕНТИЛЯТОРА вместе с характеристиками ──────────
                // Вентилятор — это свойства ВЕТВИ (модель, обороты, угол
                // лопаток, установка), значок лишь показывает его на схеме.
                // Раньше вставлялась «пустая» картинка без настроек — теперь
                // скопированные параметры применяются к новой ветви.
                if (FAN_SYMBOL_IDS.has(newSym.typeId) && newSym.fanPreset) {
                  updateBranch(branchId, { hasFan: true, ...(newSym.fanPreset as Partial<TopoBranch>) });
                }
                setSchemaSymbols(prev => [...prev, newSym]);
                setSelectedSymbolId(newSym.id);
                setSelectedBranchId(null);
                setSelectedNodeId(null);
                setActiveSide("params");
                setPendingSymbol(null);
              }}
              positionPlaceMode={positionPlaceMode}
              onPositionPlace={(wx, wy, wz) => {
                const sel = selectedPositionId ? positions.find(p => p.id === selectedPositionId) : null;
                // Режим выключаем в любом случае: без выбранной позиции он
                // иначе «зависал» — курсор-прицел оставался, а клик ничего не делал.
                setPositionPlaceMode(false);
                if (!sel) return;
                setPositions(prev => prev.map(p => p.id === sel.id ? { ...p, x: wx, y: wy, z: wz, placed: true } : p));
              }}
              fire3d={fireCalcDone && fireResult && !fireControlPreview
                ? { timeMin: showSmoke && smokeTimeMinutes > 0 ? smokeTimeMinutes : null }
                : null}
              branchFireColors={(() => {
                // Предпросмотр варианта главнее обычной картины задымления:
                // человек явно попросил показать ДРУГОЙ режим, и смешивать
                // его с дымом текущего расчёта нельзя.
                if (fireControlPreview) return previewSmokeColors;
                if (!showSmoke || !fireCalcDone || !fireResult) return undefined;
                const map = new Map<string, { color: string; fromT: number; toT: number }>();

                // Вспомогательная функция: цвет дыма по уровню опасности (оттенки серого — цвет дыма)
                const hazardCol = (level: string) =>
                  level === "lethal"  ? "#1f2937"
                : level === "danger"  ? "#374151"
                : level === "warning" ? "#4b5563"
                : "#6b7280"; // safe — светло-серый, задымление слабое но видимое

                fireResult.branches.forEach((fr, bid) => {
                  const branch = branches.find(b => b.id === bid);
                  if (!branch) return;
                  // В результат попадают и ЧИСТЫЕ ветви, развёрнутые тягой пожара
                  // (Прил. 7): дым в них не идёт, красить их задымлением нельзя —
                  // факт разворота показывает синяя аура (reversedBranchIds).
                  if (!branch.hasFire && fr.smokeDensity <= 0) return;
                  const col = hazardCol(fr.hazardLevel);

                  if (branch.hasFire) {
                    if (smokeTimeMinutes <= 0) return;
                    const ft = branch.fireT ?? 0.5;
                    const flowSpeed = fr.airSpeed > 0 ? fr.airSpeed : 0.3;
                    const len = branch.length > 0 ? branch.length : 1;
                    const elapsedSec = smokeTimeMinutes * 60;
                    // Используем flowSign из результата расчёта (не branch.flow из state — он может быть устаревшим)
                    const flowDir = (fr.flowSign ?? 1) >= 0; // true = from→to

                    // Дым от очага распространяется ТОЛЬКО ВНИЗ по потоку (по направлению
                    // струи воздуха). Против потока (к входному узлу очага, откуда идёт
                    // свежий воздух) дым не идёт.
                    const downLen = Math.min(
                      flowDir ? (1 - ft) * len : ft * len,
                      elapsedSec * flowSpeed
                    );
                    const downFrac = downLen / len;

                    const fromT = flowDir ? ft : Math.max(0, ft - downFrac);
                    const toT   = flowDir ? Math.min(1, ft + downFrac) : ft;

                    map.set(bid, { color: col, fromT, toT });
                    return;
                  }

                  // Обычная ветвь: дым входит начиная с smokeArrivalTime
                  if (smokeTimeMinutes <= 0 || fr.smokeArrivalTime > smokeTimeMinutes) return;

                  const elapsedInBranch = smokeTimeMinutes - fr.smokeArrivalTime;
                  const speed = fr.airSpeed > 0 ? fr.airSpeed : 0.3;
                  const smokedLen = elapsedInBranch * 60 * speed;
                  const smokedFrac = branch.length > 0
                    ? Math.min(1, smokedLen / branch.length)
                    : 1;

                  // ВХОДНОЙ узел ветви — тот, куда дым пришёл раньше (по времени
                  // задымления узлов). Заливка ВСЕГДА растёт ОТ входного узла по
                  // направлению струи — это гарантирует НЕПРЕРЫВНОСТЬ фронта, в т.ч.
                  // на опрокинутых ветвях (дым не «перескакивает» на другой конец).
                  const nat = fireResult.nodeArrivalTime;
                  const tFrom = nat?.get(branch.fromId);
                  const tTo = nat?.get(branch.toId);
                  let inputIsFrom: boolean;
                  if (tFrom !== undefined && tTo !== undefined) {
                    // Вход — узел, задымлённый раньше
                    inputIsFrom = tFrom <= tTo;
                  } else if (tFrom !== undefined) {
                    inputIsFrom = true;
                  } else if (tTo !== undefined) {
                    inputIsFrom = false;
                  } else {
                    // fallback на знак потока из расчёта
                    inputIsFrom = (fr.flowSign ?? (((branch.flow ?? 0) >= 0) ? 1 : -1)) >= 0;
                  }

                  if (inputIsFrom) {
                    map.set(bid, { color: col, fromT: 0, toT: smokedFrac });
                  } else {
                    map.set(bid, { color: col, fromT: 1 - smokedFrac, toT: 1 });
                  }
                });


                return map.size > 0 ? map : undefined;
              })()}
              branchExplosionColors={(() => {
                // Подсветка работает и ДО полного расчёта — по предварительной
                // оценке очага. Иначе, чтобы увидеть зоны на схеме, приходилось
                // каждый раз запускать расчёт сети, хотя параметры очага уже
                // введены и давление по ним считается мгновенно.
                const previewRes = !explosionCalcDone ? explosionPreview?.res : null;
                const baseRes = explosionCalcDone ? explosionResult : previewRes;
                if (!showExplosionZones || !baseRes) return undefined;
                // Взрыва не было — окрашивать выработки не по чему.
                if (baseRes.noExplosion) return undefined;
                if (blastWaveRadius <= 0) return undefined;
                const map = new Map<string, {
                  color: string; hazardLevel: string;
                  segments?: Array<{ color: string; fromT: number; toT: number }>;
                }>();

                // Цвета зон — из explosionCalculator (единый источник правды).
                // ВАЖНО: только hex. Здесь раньше стояли строки вида
                // "var(--c-red, #dc2626)"; canvas их не понимает и молча
                // рисовал ветвь цветом, оставшимся от предыдущей линии.
                // Пороги — из справочника, иначе окраска разошлась бы с радиусами зон
                const zoneColor = (deltaP: number) => explosionZoneColor(deltaP, blastThresholds);

                // Очаги взрыва. У каждого — СВОЙ результат расчёта: при
                // нескольких очагах давление нельзя считать по чужому заряду.
                // До полного расчёта поле explosionComputedMaxP ещё нулевое —
                // очаг берётся по самой отметке взрыва на ветви.
                const sources = branches.filter(b => b.hasExplosion
                  && (explosionCalcDone ? b.explosionComputedMaxP > 0 : true));
                if (sources.length === 0) return undefined;
                const resFor = (branchId: string) =>
                  explosionResultByBranch.get(branchId) ?? baseRes;

                // Очаги газа по Методике ВГСЧ ведутся ОТДЕЛЬНЫМ обходом — тем
                // же, что и в полном расчёте: зоны загазования и продуктов
                // взрыва, Кз каждой выработки, Кзат в узлах (табл. 5).
                const vgschSrc = new Map<string, VgschSource>();
                sources.forEach(sb => { const v = resFor(sb.id)?.vgsch; if (v) vgschSrc.set(sb.id, v); });
                const vgschNetC = vgschSrc.size > 0
                  ? propagateVgsch({
                      branches, nodes, sources: vgschSrc,
                      barriers: explosionCalcDone && explosionBarriers
                        ? explosionBarriers.byBranch
                        : collectBarriers(branches, schemaSymbols, BULKHEAD_SYMBOL_IDS),
                      decided: explosionCalcDone && explosionBarriers ? explosionBarriers.hits : undefined,
                    })
                  : null;

                // Длина ветви по координатам узлов (3D)
                const nodeByIdMap = new Map(nodes.map(n => [n.id, n]));
                const branchLen = (b: typeof branches[0]): number => {
                  const fN = nodeByIdMap.get(b.fromId);
                  const tN = nodeByIdMap.get(b.toId);
                  if (!fN || !tN) return b.length > 0 ? b.length : 0;
                  return Math.sqrt((tN.x-fN.x)**2+(tN.y-fN.y)**2+(tN.z-fN.z)**2) || (b.length > 0 ? b.length : 1);
                };

                // РАСПРОСТРАНЕНИЕ ВОЛНЫ ПО ГРАФУ — та же модель, что в
                // explosionModeRun: вместе с длиной пути копится множитель
                // ослабления (трение в канале + деление на сопряжениях).
                // Раньше здесь была Дейкстра только по расстоянию, и давление
                // затем бралось из сферической формулы — волна «не знала»
                // ни сечения выработок, ни развилок.
                const branchArea = (b: typeof branches[0]) => (b.area && b.area > 0 ? b.area : 12);
                type NodeReach = { d: number; srcId: string; att: number; fromNode?: string };
                const distNode = new Map<string, NodeReach>();
                const pq: Array<{ id: string } & NodeReach> = [];

                const upd = (nid: string, st: NodeReach) => {
                  const cur = distNode.get(nid);
                  // Сильнее = больше накопленное ослабление
                  if (!cur || st.att > cur.att * 1.000001) {
                    distNode.set(nid, st);
                    pq.push({ id: nid, ...st });
                  }
                };

                // Давление в точке по состоянию волны — та же формула, что и
                // при окрашивании участков ниже.
                const pressureOfC = (d: number, att: number, srcId: string): number => {
                  const resR = resFor(srcId);
                  if (!resR) return 0;
                  const rTrR = resR.transitionRadius_m ?? 0;
                  return (resR.channelMode && d > rTrR)
                    ? Math.round(resR.pressureAtDistance(rTrR) * att * 10) / 10
                    : Math.round(resR.pressureAtDistance(d) * att * 10) / 10;
                };

                // ПЕРЕМЫЧКИ НА ПУТИ ВОЛНЫ. После полного расчёта решения по ним
                // берутся из расчёта (схема показывает то же, что он решил); до
                // него — считаются здесь же по предварительной оценке очага.
                const barrierMap = explosionCalcDone && explosionBarriers
                  ? explosionBarriers.byBranch
                  : collectBarriers(branches, schemaSymbols, BULKHEAD_SYMBOL_IDS);
                const barrierHitsC = new Map<string, BarrierHit>(
                  explosionCalcDone && explosionBarriers ? explosionBarriers.hits : [],
                );
                const fixedHits = explosionCalcDone && explosionBarriers ? explosionBarriers.hits : null;
                const recordHitC = (bar: BlastBarrier, hit: BarrierHit) => {
                  if (fixedHits) return;
                  const prev = barrierHitsC.get(bar.key);
                  if (!prev || hit.incident_kPa > prev.incident_kPa) barrierHitsC.set(bar.key, hit);
                };

                // Начальные состояния у концов ветви-очага
                // (символ взрыва стоит на позиции t вдоль ветви)
                sources.forEach(src => {
                  // Очаг по методике ВГСЧ уже проведён своим обходом (vgschNetC).
                  // Старую модель для него не запускаем: иначе там, куда волна
                  // ВГСЧ не дошла (устоявшая перемычка, угасание), подмешивалась
                  // бы волна другой модели — отсюда «хаотичная» окраска.
                  if (vgschSrc.has(src.id)) return;
                  const len = branchLen(src);
                  const t = src.explosionT ?? 0.5;
                  const res = resFor(src.id);
                  const rTr = res?.transitionRadius_m ?? 0;
                  const beta = channelDecay({ area_m2: branchArea(src), lambda: LAMBDA_DEFAULT });
                  const attTo = (d: number) => d <= rTr ? 1 : Math.exp(-beta * (d - rTr));
                  const dF = len * t, dT = len * (1 - t);
                  const list = barrierMap.get(src.id);
                  const common = {
                    list, len, d0: 0, attAt: attTo, srcId: src.id,
                    pressureOf: pressureOfC, onHit: recordHitC,
                    decided: fixedHits ? (bar: BlastBarrier) => fixedHits.get(bar.key) : undefined,
                  };
                  const kF = crossBarriers({ ...common, tFrom: t, tTo: 0 });
                  const kT = crossBarriers({ ...common, tFrom: t, tTo: 1 });
                  if (kF > 0) upd(src.fromId, { d: dF, srcId: src.id, att: attTo(dF) * kF });
                  if (kT > 0) upd(src.toId,   { d: dT, srcId: src.id, att: attTo(dT) * kT });
                });

                // Граф смежности: nodeId → [{nodeId, длина, сечение, ветвь, откуда вход}]
                type Edge = { to: string; len: number; area: number; branchId: string; tStart: 0 | 1 };
                const adj = new Map<string, Edge[]>();
                branches.forEach(b => {
                  const len = branchLen(b), area = branchArea(b);
                  if (!adj.has(b.fromId)) adj.set(b.fromId, []);
                  if (!adj.has(b.toId))   adj.set(b.toId,   []);
                  adj.get(b.fromId)!.push({ to: b.toId,   len, area, branchId: b.id, tStart: 0 });
                  adj.get(b.toId)!.push  ({ to: b.fromId, len, area, branchId: b.id, tStart: 1 });
                });

                // Обход по убыванию силы волны
                const visited = new Set<string>();
                let guardC = 0;
                while (pq.length > 0 && guardC++ < 200000) {
                  pq.sort((a, b) => b.att - a.att);
                  const { id: cur, d: curD, srcId, att: curAtt, fromNode } = pq.shift()!;
                  if (visited.has(cur)) continue;
                  visited.add(cur);
                  const edges = adj.get(cur) ?? [];
                  // Ветвь, по которой волна пришла, в деление не входит:
                  // в прямом штреке волна идёт насквозь, а не теряет половину.
                  const out = edges.filter(e => e.to !== fromNode);
                  const outArea = out.reduce((s, e) => s + e.area, 0);
                  // Сечение выработки, по которой волна пришла в узел
                  const inArea = edges.find(e => e.to === fromNode)?.area ?? outArea;
                  for (const e of out) {
                    const nd = curD + e.len;
                    // Волна останавливается на атмосферных узлах (выход на поверхность)
                    if (nodeByIdMap.get(e.to)?.atmosphereLink) continue;
                    // Прохождение через сопряжение — акустическая модель (см. ядро).
                    const split = junctionTransmission(inArea, outArea);
                    const beta = channelDecay({ area_m2: e.area, lambda: LAMBDA_DEFAULT });
                    const attIn = curAtt * split;
                    // Перемычки ветви по ходу волны: устоявшая волну гасит,
                    // разрушенная пропускает ослабленную.
                    const kBar = crossBarriers({
                      list: barrierMap.get(e.branchId),
                      tFrom: e.tStart, tTo: e.tStart === 0 ? 1 : 0, len: e.len, d0: curD,
                      attAt: dist => attIn * Math.exp(-beta * dist),
                      srcId, pressureOf: pressureOfC, onHit: recordHitC,
                      decided: fixedHits ? bar => fixedHits.get(bar.key) : undefined,
                    });
                    const att = attIn * Math.exp(-beta * e.len) * kBar;
                    if (att < 1e-4) continue;
                    upd(e.to, { d: nd, srcId, att, fromNode: cur });
                  }
                }

                // ── Окрашивание ПО УЧАСТКАМ вдоль ветви ───────────────────
                // Давление падает с расстоянием. Раньше вся ветвь красилась
                // по её ближнему к очагу концу: выработка 300 м, ближний конец
                // которой в 50 м от очага, целиком показывалась летальной.
                // Теперь ветвь делится на участки, и у каждого своё давление.
                const SEG_N = 12; // участков на ветвь — хватает для глаза

                branches.forEach(b => {
                  const len = branchLen(b);
                  const isSource = b.hasExplosion && b.explosionComputedMaxP > 0;
                  const rFrom = distNode.get(b.fromId);
                  const rTo   = distNode.get(b.toId);
                  const vgHere = vgschNetC ? (vgschNetC.pressureAt(b.id, 0.5)?.p ?? 0) > 0 : false;
                  if (!isSource && !rFrom && !rTo && !vgHere) return; // волна не дошла

                  // Затухание вдоль САМОЙ этой ветви — по её сечению
                  const betaB = channelDecay({ area_m2: branchArea(b), lambda: LAMBDA_DEFAULT });

                  // Множитель от перемычек этой ветви, пройденных по дороге от
                  // точки входа tIn до точки t. Решения берутся уже принятые
                  // при обходе — перемычка не «пересчитывается» на каждом
                  // участке и не может быть одновременно целой и разрушенной.
                  const barList = barrierMap.get(b.id);
                  const barK = (tIn: number, t: number): number => {
                    if (!barList || barList.length === 0) return 1;
                    const lo = Math.min(tIn, t), hi = Math.max(tIn, t);
                    let k = 1;
                    for (const bar of barList) {
                      if (bar.t <= lo || bar.t >= hi) continue;
                      const hit = barrierHitsC.get(bar.key);
                      // Волна до перемычки не доходила — решения нет. Считаем
                      // её прозрачной только если прочность не задана.
                      k *= hit ? hit.transmit : (bar.failure_MPa > 0 ? 0 : 1);
                      if (k <= 0) return 0;
                    }
                    return k;
                  };

                  /** Состояние волны в точке t вдоль ветви (0 = fromId, 1 = toId) */
                  const reachAt = (t: number): NodeReach | null => {
                    let best: NodeReach | null = null;
                    // Берём тот вариант прихода, где волна СИЛЬНЕЕ, а не где
                    // путь короче: через узкую сбойку путь может быть короче,
                    // а давление — заметно ниже.
                    const take = (d: number, srcId: string, att: number) => {
                      if (att <= 0) return;
                      if (d <= blastWaveRadius && (!best || att > best.att)) best = { d, srcId, att };
                    };
                    const decay = (dd: number) => Math.exp(-betaB * dd);
                    // Путь через fromId / через toId — с дозатуханием внутри ветви
                    // и с учётом перемычек между узлом и точкой t.
                    if (rFrom) take(rFrom.d + len * t,       rFrom.srcId, rFrom.att * decay(len * t) * barK(0, t));
                    if (rTo)   take(rTo.d   + len * (1 - t), rTo.srcId,   rTo.att   * decay(len * (1 - t)) * barK(1, t));
                    // Если очаг стоит на самой этой ветви — идём по ней напрямую,
                    // не огибая через узлы
                    if (isSource && !vgschSrc.has(b.id)) {
                      const tSrc = b.explosionT ?? 0.5;
                      const dSrc = Math.abs(t - tSrc) * len;
                      const rTrS = resFor(b.id)?.transitionRadius_m ?? 0;
                      take(dSrc, b.id, (dSrc <= rTrS ? 1 : decay(dSrc - rTrS)) * barK(tSrc, t));
                    }
                    return best;
                  };

                  const RANK = ["safe", "light", "medium", "heavy", "lethal"];
                  const segments: Array<{ color: string; fromT: number; toT: number }> = [];
                  let curColor: string | null = null;
                  let curStart = 0;
                  let worst = "safe";
                  for (let i = 0; i < SEG_N; i++) {
                    const tMid = (i + 0.5) / SEG_N;
                    const vg = vgschNetC?.pressureAt(b.id, tMid);
                    // Ниже границы безопасной зоны волна на схеме не показывается:
                    // иначе «безопасная» зелёная окраска тянется далеко за её радиус.
                    if (vg && vg.p > 0 && vg.p < blastThresholds.safeLimit) {
                      if (curColor !== null) { segments.push({ color: curColor, fromT: curStart, toT: i / SEG_N }); curColor = null; }
                      continue;
                    }
                    if (vg && vg.p > 0 && vg.d <= blastWaveRadius) {
                      const { color, hazardLevel: lvlV } = zoneColor(vg.p);
                      if (RANK.indexOf(lvlV) > RANK.indexOf(worst)) worst = lvlV;
                      if (color !== curColor) {
                        if (curColor !== null) segments.push({ color: curColor, fromT: curStart, toT: i / SEG_N });
                        curColor = color;
                        curStart = i / SEG_N;
                      }
                      continue;
                    }
                    const reach = reachAt(tMid);
                    // Волна от очага ВГСЧ сюда не дошла — старая модель тоже не красит
                    if (reach && vgschSrc.has(reach.srcId)) {
                      if (curColor !== null) { segments.push({ color: curColor, fromT: curStart, toT: i / SEG_N }); curColor = null; }
                      continue;
                    }
                    // Участок вне досягаемости волны — обрываем текущий отрезок
                    if (!reach) {
                      if (curColor !== null) {
                        segments.push({ color: curColor, fromT: curStart, toT: i / SEG_N });
                        curColor = null;
                      }
                      continue;
                    }
                    // Давление: ближняя зона — сферическая часть, дальше —
                    // значение на сшивке × накопленное по графу ослабление.
                    // Трение здесь повторно НЕ применяется: оно уже в att.
                    const resR = resFor(reach.srcId);
                    const rTrR = resR?.transitionRadius_m ?? 0;
                    const dp = (resR?.channelMode && reach.d > rTrR)
                      ? Math.round(resR.pressureAtDistance(rTrR) * reach.att * 10) / 10
                      : Math.round((resR?.pressureAtDistance(reach.d) ?? 0) * reach.att * 10) / 10;
                    const { color, hazardLevel: lvl } = zoneColor(dp);
                    if (RANK.indexOf(lvl) > RANK.indexOf(worst)) worst = lvl;
                    if (color !== curColor) {
                      if (curColor !== null) segments.push({ color: curColor, fromT: curStart, toT: i / SEG_N });
                      curColor = color;
                      curStart = i / SEG_N;
                    }
                  }
                  if (curColor !== null) segments.push({ color: curColor, fromT: curStart, toT: 1 });
                  if (segments.length === 0) return;

                  // Общий цвет ветви — по самому опасному из её участков
                  map.set(b.id, {
                    color: EXPLOSION_HAZARD_COLORS[worst as keyof typeof EXPLOSION_HAZARD_COLORS],
                    hazardLevel: worst,
                    segments,
                  });
                });

                return map.size > 0 ? map : undefined;
              })()}
              reversedBranchIds={
                // Опрокинутые струи — из последнего расчёта пожара. В
                // предпросмотре другого варианта они не к месту: направление
                // потоков там своё.
                fireControlPreview ? undefined
                : fireCalcDone && fireResult && showSmoke ? fireResult.reversedBranches
                : undefined
              }
              branchBindMode={posBranchBindMode}
              branchPositionColors={(() => {
                if (!posBranchBindMode || !selectedPositionId) return undefined;
                const pos = positions.find(p => p.id === selectedPositionId);
                if (!pos) return undefined;
                const map = new Map<string, { color: string; bound: boolean }>();
                branches.forEach(b => {
                  map.set(b.id, { color: pos.color, bound: pos.branchIds.includes(b.id) });
                });
                return map;
              })()}
              posInnerColors={(() => {
                if (!posColorInner || positions.length === 0) return undefined;
                const map = new Map<string, string>();
                positions.forEach(pos => {
                  if (pos.branchesVisible === false) return;
                  pos.branchIds.forEach(bid => { if (!map.has(bid)) map.set(bid, pos.color); });
                });
                return map.size > 0 ? map : undefined;
              })()}
              posOuterColors={(() => {
                if (!posColorOuter || positions.length === 0) return undefined;
                const map = new Map<string, string>();
                positions.forEach(pos => {
                  if (pos.branchesVisible === false) return;
                  pos.branchIds.forEach(bid => { if (!map.has(bid)) map.set(bid, pos.color); });
                });
                return map.size > 0 ? map : undefined;
              })()}
              compareBranchColors={(() => {
                // ПОДСВЕТКА УКЛОНА. Пока открыт диалог наклонного съезда,
                // выделенная трасса окрашивается по углу наклона: зелёный —
                // в пределах рабочего, жёлтый — до предельного, красный —
                // выше предела. Иначе проверить съезд можно только по числам
                // в окне, а на схеме не видно, КАКОЙ участок вышел за норму.
                if (showRampDialog && rampSlopeColors) return rampSlopeColors;

                if (!compareResult || compareResult.branches.length === 0) return undefined;
                const map = new Map<string, string>();
                compareResult.branches.forEach(diff => {
                  if (diff.status === "added")   map.set(diff.id, "#22c55e"); // зелёный
                  if (diff.status === "removed")  map.set(diff.id, "#ef4444"); // красный
                  if (diff.status === "changed")  map.set(diff.id, "#f59e0b"); // жёлтый
                });
                return map.size > 0 ? map : undefined;
              })()}
              rescuePathBranchIds={
                depressogramPickMode && depressogramManualBranches.size > 0 ? depressogramManualBranches
                : depressogramHighlight.length > 0 ? new Set(depressogramHighlight)
                : workerPathBranchIds.size > 0 ? workerPathBranchIds
                : rescuePathBranchIds.size > 0 ? rescuePathBranchIds
                : undefined
              }
              rescuePathBranchDirs={
                depressogramHighlight.length > 0 ? undefined
                : workerPathBranchDirs.size > 0 ? workerPathBranchDirs
                : rescuePathBranchDirs.size > 0 ? rescuePathBranchDirs
                : undefined
              }
              altRouteBranchColors={
                activeSide === "rescue" && rescueAltRouteColors.size > 0
                  ? rescueAltRouteColors : undefined
              }
              rescuePathNodeIds={
                workerPathNodeIds.size > 0 ? workerPathNodeIds
                : rescuePathNodeIds.size > 0 ? rescuePathNodeIds
                : undefined
              }
              rescueNodeLetters={
                workerNodeLetters.size > 0 ? workerNodeLetters
                : rescueNodeLetters.size > 0 ? rescueNodeLetters
                : undefined
              }
              rescuePickMode={depressogramPickMode ? "depress" : (rescuePickMode ?? workerPickMode)}
              onRescueNodePick={(nodeId) => {
                if (rescuePickMode) rescuePickHandlerRef.current?.(nodeId);
                else if (workerPickMode) workerPickHandlerRef.current?.(nodeId);
              }}
              onRescueBranchPick={(branchId) => {
                // Клик по линии варианта маршрута ВГСЧ выбирает этот вариант
                if (rescuePickMode === "route") {
                  rescueBranchPickHandlerRef.current?.(branchId);
                  return;
                }
                if (depressogramPickMode) setDepressogramManualBranches(prev => {
                  const next = new Set(prev);
                  if (next.has(branchId)) { next.delete(branchId); } else { next.add(branchId); }
                  return next;
                });
              }}
              onSymbolPlace={(typeId, x, y, branchId, t) => {
                if (SQUAD_TYPES.includes(typeId)) {
                  setSquadDialog({ typeId, x, y, branchId, t });
                  setSquadCount("5");
                } else {
                  if (typeId === "fan" && branchId) {
                    const alreadyHasFan = schemaSymbols.some(s => s.typeId === "fan" && s.branchId === branchId);
                    if (!alreadyHasFan) {
                      addSymbol(typeId, x, y, branchId, undefined, undefined, t);
                      updateBranch(branchId, { hasFan: true, fanMode: "curve", fanType: "ВМП", fanInstall: "Без перемычки" });
                      setSelectedBranchId(branchId);
                      setSelectedNodeId(null);
                      setActiveSide("fan");
                      setFanSymbolBranchId(branchId);
                    }
                  } else if (FIRE_SYMBOL_IDS.has(typeId) && branchId) {
                    // Очаг пожара — одна ветвь = один очаг
                    const alreadyHasFire = schemaSymbols.some(s => FIRE_SYMBOL_IDS.has(s.typeId) && s.branchId === branchId);
                    if (!alreadyHasFire) {
                      const fireT = t ?? 0.5;
                      const newSym: SchemaSymbol = {
                        id: `SYM_FIRE_${Date.now()}`,
                        typeId, x, y, branchId, t: fireT,
                      };
                      setSchemaSymbols(prev => [...prev, newSym]);
                      updateBranch(branchId, {
                        hasFire: true,
                        fireT: fireT,
                        fireHeatRelease: 5,
                        fireMode: "heat",
                        fireTemperature: 300,
                        fireCombustible: "vehicle",
                        fireVehicleSymbolOff: false,
                      });
                      setSelectedSymbolId(newSym.id);
                      lastBranchTab.current = "accidents"; // чтобы useEffect не перебил вкладку
                      setSelectedBranchId(branchId);
                      setSelectedNodeId(null);
                      setFanSymbolBranchId(null);
                      setFireResult(null);
                      setFireCalcDone(false);
                      setActiveSide("accidents");
                      setActiveRibbon("involve");
                    }
                  } else if (EXPLOSION_SYMBOL_IDS.has(typeId) && branchId) {
                    // Источник взрыва — одна ветвь = один источник
                    const alreadyHasExplosion = schemaSymbols.some(s => EXPLOSION_SYMBOL_IDS.has(s.typeId) && s.branchId === branchId);
                    if (!alreadyHasExplosion) {
                      const expT = t ?? 0.5;
                      const newSym: SchemaSymbol = {
                        id: `SYM_EXPL_${Date.now()}`,
                        typeId, x, y, branchId, t: expT,
                      };
                      setSchemaSymbols(prev => [...prev, newSym]);
                      updateBranch(branchId, {
                        hasExplosion: true,
                        explosionT: expT,
                        explosionMethod: "gas_dynamics",
                        explosionSourceType: "mass",
                        explosionGasId: "methane",
                        explosionGasVolume: 100,
                        explosionGasZoneLength: 100,
                        explosionGasP0: 0,
                        explosionGasConcentration: 9.5,
                        explosionExplosiveId: "ammonit",
                        explosionExplosiveMass: 100,
                        explosionConsiderWalls: true,
                      });
                      setSelectedSymbolId(newSym.id);
                      lastBranchTab.current = "blast";
                      setSelectedBranchId(branchId);
                      setSelectedNodeId(null);
                      setFanSymbolBranchId(null);
                      setExplosionResult(null); setExplosionResultByBranch(new Map()); setExplosionBarriers(null);
                      setExplosionCalcDone(false);
                      setActiveSide("blast");
                      setActiveRibbon("involve");
                    }
                  } else if (REDUCER_SYMBOL_IDS.has(typeId) && branchId) {
                    // Редукционный клапан — привязываем к ветви водопровода
                    const br = branches.find(b => b.id === branchId);
                    const defaultValve = PRESSURE_REDUCING_VALVES[0];
                    const newSym: SchemaSymbol = {
                      // t — доля длины ветви от её начала. Берём из точки клика,
                      // а не 0.5: раньше редуктор всегда «прыгал» на середину.
                      id: `SYM_RD_${Date.now()}`,
                      typeId, x, y, branchId, t: t ?? 0.5,
                    };
                    setSchemaSymbols(prev => [...prev, newSym]);
                    // Ветвь: ставим флаг редуктора и дефолтные параметры
                    if (br && !br.wpHasReducer) {
                      updateBranch(branchId, {
                        wpHasReducer: true,
                        wpReducerModel: defaultValve.id,
                        wpReducerOutPressure: 0.5,
                        wpReducerMaxFlow: defaultValve.flowMax,
                      });
                    }
                    setSelectedSymbolId(newSym.id);
                    setSelectedBranchId(branchId);
                    setSelectedNodeId(null);
                    setFanSymbolBranchId(null);
                    setActiveSide("waterpipes");
                  } else if (typeId === "valve_water" && branchId) {
                    // Запорный вентиль на водопроводе — перекрывает/открывает
                    // течение воды в ветви. По умолчанию установлен открытым.
                    const br = branches.find(b => b.id === branchId);
                    const newSym: SchemaSymbol = {
                      // t из точки клика, а не 0.5 — вентиль ставится там,
                      // куда указал курсор.
                      id: `SYM_VW_${Date.now()}`,
                      typeId, x, y, branchId, t: t ?? 0.5,
                    };
                    setSchemaSymbols(prev => [...prev, newSym]);
                    if (br) {
                      updateBranch(branchId, { wpHasGate: true, wpGateClosed: false });
                    }
                    setSelectedSymbolId(newSym.id);
                    setSelectedBranchId(branchId);
                    setSelectedNodeId(null);
                    setActiveSide("waterpipes");
                  } else if (HEATER_SYMBOL_IDS.has(typeId)) {
                    // Калорифер ставится ТОЛЬКО на ветвь: он масштабируется от
                    // ширины выработки и разворачивается поперёк неё, поэтому
                    // без привязки к ветви отображался бы некорректно.
                    if (!branchId) {
                      window.alert("Калорифер устанавливается на выработку.\n\nУкажите ветвь, в которую он встроен.");
                      setTool("select");
                      setActiveSymbolTypeId(null);
                      return;
                    }
                    const newSym: SchemaSymbol = {
                      id: `SYM_HT_${Date.now()}`,
                      typeId, x, y, branchId, t: t ?? 0.5,
                    };
                    setSchemaSymbols(prev => [...prev, newSym]);
                    setSelectedSymbolId(newSym.id);
                    setSelectedBranchId(null);
                    setSelectedNodeId(null);
                    setActiveSide("params");
                  } else if (BULKHEAD_SYMBOL_IDS.has(typeId) && branchId) {
                    // Каждый символ перемычки хранит свои параметры независимо (bk* поля)
                    const br = branches.find(b => b.id === branchId);
                    const isWindow = WINDOW_BULKHEAD_IDS.has(typeId);
                    const newSym: SchemaSymbol = {
                      // t из точки клика, а не 0.5 — перемычка встаёт туда,
                      // куда указал курсор.
                      id: `SYM_BK_${Date.now()}`,
                      typeId, x, y, branchId, t: t ?? 0.5,
                      bkResMode: "project",
                      bkWindowArea: isWindow ? (br?.area ?? 0) : 0,
                      bkManualR: 0,
                      bkManualAirPerm: false,
                      bkCustomAirPerm: 0,
                      bkAirPerm: br?.bulkheadAirPerm ?? 0,
                      bkBulkheadR: br?.bulkheadR ?? 0,
                      bkSurveyQ: 0,
                      bkSurveyDP: 0,
                    };
                    setSchemaSymbols(prev => [...prev, newSym]);
                    // Ветвь помечаем hasBulkhead=true (для расчёта), но не перезаписываем параметры
                    if (br && !br.hasBulkhead) {
                      updateBranch(branchId, { hasBulkhead: true });
                    }
                    setSelectedSymbolId(newSym.id);
                    setSelectedBranchId(null);
                    setSelectedNodeId(null);
                    setActiveSide("params");
                  } else {
                    // t — доля длины ветви от начала, вычисленная по точке клика.
                    // Раньше не передавалась, и addSymbol подставлял 0.5: любое
                    // условное обозначение вставало ровно посередине ветви,
                    // а не туда, куда указал курсор.
                    addSymbol(typeId, x, y, branchId, undefined, undefined, t);
                  }
                  setTool("select");
                  setActiveSymbolTypeId(null);
                }
              }}
            />

            {/* ── Предпросмотр подобранного варианта ─────────────────────
                Пока плашка видна, на схеме показан НЕ проект, а вариант.
                Сказать об этом обязательно и крупно: иначе человек примет
                чужие расходы за свои и будет принимать по ним решения. */}
            {fireControlPreview && (
              <div style={{
                position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
                zIndex: 30, background: "rgba(17,24,39,0.92)", borderRadius: "var(--radius-ui)",
                padding: "9px 13px", color: "white", fontSize: 11,
                border: "1px solid rgba(96,165,250,0.5)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.45)", maxWidth: 560,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Icon name="Eye" size={14} style={{ color: "#81b0c4", flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, color: "#81b0c4" }}>Предпросмотр варианта</span>
                  <span style={{ color: "var(--c-t4, #d1d5db)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={fireControlPreview.title}>
                    {fireControlPreview.title}
                  </span>
                </div>
                <div style={{ color: "#9ca3af", fontSize: 10, paddingTop: 3 }}>
                  Схема показывает расходы этого варианта. Проект не изменён.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: 6, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--c-t4, #d1d5db)" }}>
                    не успевают выйти:{" "}
                    <b style={{ color: fireControlPreview.peopleAtRisk > 0 ? "#fca5a5" : "#86efac" }}>
                      {fireControlPreview.peopleAtRisk}
                    </b>
                  </span>
                  <span style={{ color: "var(--c-t4, #d1d5db)" }}>
                    в зоне задымления: <b style={{ color: "#fcd34d" }}>{fireControlPreview.peopleInSmoke}</b>
                  </span>
                  <span style={{ color: "var(--c-t4, #d1d5db)" }}>
                    превышений скорости: <b style={{ color: fireControlPreview.violations.length > 0 ? "#fcd34d" : "#86efac" }}>
                      {fireControlPreview.violations.length}
                    </b>
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 8, flexWrap: "wrap" }}>
                  {/* Расходы и задымление — две разные картины одного варианта,
                      и показывать их одновременно нельзя: заливка дымом
                      перекрывает цвет по скорости воздуха. */}
                  {(["flow", "smoke"] as const).map(m => (
                    <button key={m}
                      onClick={() => setFireControlPreviewMode(m)}
                      style={{
                        fontSize: 10, padding: "2px 8px", borderRadius: "var(--radius-ui)", cursor: "pointer",
                        border: "1px solid " + (fireControlPreviewMode === m ? "#4f8ca6" : "rgba(255,255,255,0.2)"),
                        background: fireControlPreviewMode === m ? "rgba(96,165,250,0.25)" : "transparent",
                        color: fireControlPreviewMode === m ? "#b0cfdc" : "var(--c-t4, #d1d5db)",
                      }}>
                      {m === "flow" ? "Расходы" : "Задымление"}
                    </button>
                  ))}
                  {fireControlPreview.violations.length > 0 && (
                    <button
                      onClick={() => setDepressogramHighlight(fireControlPreview.violations)}
                      style={{
                        fontSize: 10, padding: "2px 8px", borderRadius: "var(--radius-ui)", cursor: "pointer",
                        border: "1px solid rgba(252,211,77,0.5)", background: "transparent", color: "#fcd34d",
                      }}>
                      Подсветить превышения
                    </button>
                  )}
                  <button
                    onClick={() => {
                      applyFireControlActions(fireControlPreview.actions);
                      closeFireControlPreview();
                      setShowFireControl(false);
                    }}
                    style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: "var(--radius-ui)", cursor: "pointer",
                      border: "1px solid rgba(134,239,172,0.5)", background: "rgba(34,197,94,0.18)", color: "#bbf7d0",
                    }}>
                    Применить к схеме
                  </button>
                  <button onClick={closeFireControlPreview}
                    style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: "var(--radius-ui)", cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "var(--c-t4, #d1d5db)",
                    }}>
                    Вернуться к списку
                  </button>
                </div>
              </div>
            )}

            {/* ── Легенда зон взрыва с радиусами ────────────────────── */}
            {showExplosionZones && activeExplosionRes && !activeExplosionRes.noExplosion && (
              <div style={{
                position: "absolute", bottom: 12, left: 12, zIndex: 20,
                background: "rgba(10,6,0,0.88)", borderRadius: "var(--radius-ui)",
                padding: "10px 14px", color: "white", fontSize: 11,
                minWidth: 220, pointerEvents: "none",
                border: "1px solid rgba(245,158,11,0.45)",
                backdropFilter: "blur(6px)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
              }}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: "#fbbf24", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  💥 Зоны поражения взрывом
                </div>
                {(() => {
                  const zoneDefs = [
                    // Границы — из справочника, а не зашитые числа
                    { color: EXPLOSION_HAZARD_COLORS.lethal, label: "Летальная",      dp: `ΔP > ${blastThresholds.lethal} кПа`, hazard: "lethal" },
                    { color: EXPLOSION_HAZARD_COLORS.heavy,  label: "Тяжёлые травмы", dp: `ΔP ${blastThresholds.heavy}–${blastThresholds.lethal} кПа`, hazard: "heavy" },
                    { color: EXPLOSION_HAZARD_COLORS.medium, label: "Средние травмы", dp: `ΔP ${blastThresholds.medium}–${blastThresholds.heavy} кПа`, hazard: "medium" },
                    { color: EXPLOSION_HAZARD_COLORS.light,  label: "Лёгкие травмы",  dp: `ΔP ${blastThresholds.light}–${blastThresholds.medium} кПа`, hazard: "light" },
                    { color: EXPLOSION_HAZARD_COLORS.safe,   label: "Безопасно",      dp: `ΔP < ${blastThresholds.safeLimit} кПа`, hazard: "safe" },
                  ];
                  return zoneDefs.map(({ color, label, dp, hazard }) => {
                    const zone = activeExplosionRes.zones.find(z => z.hazardLevel === hazard);
                    const r = zone?.radius_m ?? 0;
                    const isActive = blastWaveRadius > 0 && r > 0 && blastWaveRadius >= r;
                    return (
                      <div key={hazard} style={{
                        display: "flex", alignItems: "center", gap: 8, marginBottom: 5,
                        opacity: r === 0 ? 0.4 : 1,
                      }}>
                        {/* Цветная полоска */}
                        <div style={{
                          width: 6, height: 28, background: color, borderRadius: "var(--radius-ui)",
                          flexShrink: 0,
                          boxShadow: isActive ? `0 0 6px ${color}` : "none",
                        }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: isActive ? "#fff" : "var(--c-t4, #d1d5db)", fontSize: 11 }}>{label}</div>
                          <div style={{ color: "var(--c-t4, #9ca3af)", fontSize: 10 }}>{dp}</div>
                        </div>
                        {/* Радиус */}
                        <div style={{
                          fontSize: 11, fontWeight: 700, textAlign: "right", flexShrink: 0,
                          color: r > 0 ? color: "var(--c-t2, #4b5563)",
                          background: r > 0 ? `${color}20` : "transparent",
                          border: `1px solid ${r > 0 ? color + "60" : "transparent"}`,
                          borderRadius: "var(--radius-ui)", padding: "1px 6px", minWidth: 54,
                        }}>
                          {r > 0 ? `${r} м` : "—"}
                        </div>
                      </div>
                    );
                  });
                })()}
                <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.12)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {/* Берём ТОТ ЖЕ результат, что и радиусы зон выше. Здесь
                      стоял explosionResult, который до полного расчёта равен
                      null: обращение к его полям роняло рендер — экран белел
                      сразу при включении зон по предварительной оценке. */}
                  {activeExplosionRes.vgsch
                    ? <span style={{ color: "#fde68a", fontSize: 10 }}>Eн = <b>{Math.round(activeExplosionRes.vgsch.En_MJ)} МДж</b></span>
                    : <span style={{ color: "#fde68a", fontSize: 10 }}>Q_тнт = <b>{activeExplosionRes.q_tnt_kg} кг</b></span>}
                  <span style={{ color: "#fde68a", fontSize: 10 }}>D = <b>{activeExplosionRes.waveFrontSpeed_ms} м/с</b></span>
                  <span style={{ color: "#fde68a", fontSize: 10 }}>ΔP_max = <b>{activeExplosionRes.maxDeltaP_kPa} кПа</b></span>
                </div>
              </div>
            )}

            {/* ── Маркеры позиций (SVG-оверлей) ──────────────────────── */}
            {positions.length > 0 && showPositions && (() => {
              void viewStateTick; // подписка на обновления камеры через rAF-throttled state
              const vs = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
              const projOpts = { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation };
              // xyScale и zScale применяем к осям, как это делает TopoCanvas
              const proj = (wx: number, wy: number, wz = 0) => {
                const p = project3D({ x: wx * (xyScale ?? 1), y: wy * (xyScale ?? 1), z: wz * (zScale ?? 1) }, projOpts);
                return { sx: p.sx, sy: p.sy };
              };
              // Проекция узла с xyScale и zScale
              const projNode = (n: { x: number; y: number; z: number }) =>
                project3D({ x: n.x * (xyScale ?? 1), y: n.y * (xyScale ?? 1), z: n.z * (zScale ?? 1) }, projOpts);
              // Масштаб маркеров позиций ПЛА — В ТОЧНОСТИ как у перемычек/ветвей.
              // «Сырой» коэффициент объекта = view.scale / (xyScale * 0.4) — тот же, что _objSF ветвей.
              // Нормируем на xyScale: при реальных координатах «нормальный» vs.scale меньше в xyScale раз.
              // Режим «Пределы масштаба ВКЛ» (fixedObjectScale): размер зажат между posMin% и posMax%.
              // Режим ВЫКЛ: свободно масштабируется с зумом (мин. 0.25, макс. 8), как ветвь.
              const _xySFPos = Math.max(1, xyScale ?? 1);
              // При фиксированном масштабе (scaleLimitsEnabled) размер позиции ПЛА
              // НЕ должен зависеть от зума — базовый коэффициент = 1 (как у узлов/ветвей),
              // затем зажимается в диапазон posMin%..posMax%. Иначе — свободно масштабируется.
              const _rawPosSF = scaleLimitsEnabled ? 1 : (vs.scale / (_xySFPos * 0.4));
              const posSF = scaleLimitsEnabled
                ? Math.min(scalePositionMax / 100, Math.max(scalePositionMin / 100, _rawPosSF))
                : Math.min(8, Math.max(0.25, _rawPosSF));
              const PX_PER_MM = 3.78 * posSF;
              // ГОСТ-диаметр маркера позиции (мм). Действует ГЛОБАЛЬНО как множитель
              // относительно эталона 13 мм: эффективный диаметр = pos.diameter · (ГОСТ / 13).
              // Так поле «Размер по ГОСТ» всегда влияет на схему, сохраняя индивидуальные
              // размеры отдельных позиций.
              const _posGostMm = positionGostMm > 0 ? positionGostMm : 13;
              const _gostFactor = _posGostMm / 13;

              // Вспомогательная: экранные координаты конца выноски по привязке к ветви
              const leaderBranchEnd = (branchId: string, t: number): { sx: number; sy: number } | null => {
                const br = branches.find(b => b.id === branchId);
                const fromN = br ? nodes.find(n => n.id === br.fromId) : null;
                const toN   = br ? nodes.find(n => n.id === br.toId)   : null;
                if (!fromN || !toN) return null;
                const fP = projNode(fromN);
                const tP = projNode(toN);
                return { sx: fP.sx + (tP.sx - fP.sx) * t, sy: fP.sy + (tP.sy - fP.sy) * t };
              };


              // Экранная позиция самого маркера (кружка).
              // Маркер, выноска и точка-якорь ведут себя КАК ВЕТВИ: их геометрия
              // (положение кружка, конец выноски на ветви) живёт в МИРОВЫХ координатах
              // и масштабируется вместе со схемой при зуме — в т.ч. в режиме
              // фиксированного масштаба. Зажимается (posSF) только РАЗМЕР элементов
              // (радиус кружка, толщина выноски), а не их положение. Поэтому кружок
              // всегда проецируется из своей мировой точки, без экранного притягивания.
              const markerScreenPos = (pos: Position): { sx: number; sy: number } => {
                return proj(pos.x, pos.y, pos.z ?? 0);
              };

              return (
                <svg
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden", pointerEvents: "none", cursor: leaderDrawMode ? "crosshair" : "inherit", zIndex: 2 }}
                >
                  {/* ── Подсветка ветви под snap (режим рисования) ── */}
                  {leaderDrawMode && leaderSnapBranch && (() => {
                    const br = branches.find(b => b.id === leaderSnapBranch.branchId);
                    const fromN = br ? nodes.find(n => n.id === br.fromId) : null;
                    const toN   = br ? nodes.find(n => n.id === br.toId)   : null;
                    if (!fromN || !toN) return null;
                    const fP = projNode(fromN), tP = projNode(toN);
                    const pos = positions.find(p => p.id === leaderDrawMode);
                    return (
                      <g style={{ pointerEvents: "none" }}>
                        <line x1={fP.sx} y1={fP.sy} x2={tP.sx} y2={tP.sy}
                          stroke={pos?.color ?? "#1e5a7a"} strokeWidth={4} opacity={0.35}
                          strokeLinecap="round" />
                        <circle cx={leaderSnapBranch.sx} cy={leaderSnapBranch.sy} r={7}
                          fill={pos?.color ?? "#1e5a7a"} opacity={0.85} />
                      </g>
                    );
                  })()}

                  {/* ── Выноски ── */}
                  {positions.map((pos) => {
                    if (pos.visible === false) return null;
                    const pz = pos.z ?? 0;
                    const isDrawing = leaderDrawMode === pos.id;
                    // В режиме рисования маркер остаётся на мировой точке (конец следует
                    // за курсором); иначе — притянут к концу выноски при фикс. масштабе.
                    const pm = isDrawing ? proj(pos.x, pos.y, pz) : markerScreenPos(pos);
                    const r = (pos.diameter ?? 13) * _gostFactor * PX_PER_MM / 2;
                    const lw = Math.max(0.3, (pos.leaderThickness ?? 0.02) * PX_PER_MM);

                    // Вычисляем конец выноски
                    let endSx: number | null = null, endSy: number | null = null;
                    let isBranchAttached = false;

                    if (isDrawing) {
                      // В режиме рисования — snap к ветви или курсор
                      if (leaderSnapBranch) {
                        endSx = leaderSnapBranch.sx; endSy = leaderSnapBranch.sy;
                        isBranchAttached = true;
                      } else if (leaderCursorScreen) {
                        endSx = leaderCursorScreen.sx; endSy = leaderCursorScreen.sy;
                      }
                    } else if (pos.leaderBranchId && pos.leaderT != null) {
                      // Привязан к ветви — вычисляем через проекцию
                      const ep = leaderBranchEnd(pos.leaderBranchId, pos.leaderT);
                      if (ep) { endSx = ep.sx; endSy = ep.sy; isBranchAttached = true; }
                    } else if (pos.leaderEndX != null && pos.leaderEndY != null) {
                      // Свободная точка
                      const pe = proj(pos.leaderEndX, pos.leaderEndY, pz);
                      endSx = pe.sx; endSy = pe.sy;
                    }

                    if (endSx == null || endSy == null) return null;

                    // Фиксированный масштаб: конец выноски остаётся точно на ветви
                    // (мировая точка), а САМ МАРКЕР (pm) уже притянут к нему функцией
                    // markerScreenPos на зажатое экранное расстояние — поэтому выноска
                    // маркер↔привязка не «уезжает» при зуме. Дополнительно корректировать
                    // конец не нужно.
                    void isBranchAttached;

                    const dx = endSx - pm.sx, dy = endSy - pm.sy;
                    const dist = Math.hypot(dx, dy);
                    if (dist < 2) return null;
                    const ux = dx / dist, uy = dy / dist;
                    const x1 = pm.sx + ux * (r + 2), y1 = pm.sy + uy * (r + 2);
                    const isDragging = draggingLeaderPosId === pos.id;

                    return (
                      <g key={`leader-${pos.id}`}>
                        {/* Пунктирная линия-выноска — красная (единый стиль SVG/Canvas) */}
                        <line
                          x1={x1} y1={y1} x2={endSx} y2={endSy}
                          stroke="#e11d48" strokeWidth={lw}
                          strokeDasharray="6,3" strokeLinecap="round"
                          opacity={isDrawing ? 0.6 : 0.95}
                          style={{ pointerEvents: "none" }}
                        />
                        {/* Точка привязки к ветви — фиксированный размер в px, прозрачная,
                            подсвечивается только при наведении/выборе позиции */}
                        {isBranchAttached && !isDrawing && (() => {
                          const active = hoveredLeaderAnchor === pos.id || pos.id === selectedPositionId;
                          return (
                            <circle cx={endSx} cy={endSy} r={5}
                              fill={active ? "#e11d48" : "transparent"}
                              stroke={active ? "#fff" : "none"}
                              strokeWidth={active ? 1.5 : 0}
                              style={{ pointerEvents: "all", cursor: "pointer" }}
                              onMouseEnter={() => setHoveredLeaderAnchor(pos.id)}
                              onMouseLeave={() => setHoveredLeaderAnchor((h) => h === pos.id ? null : h)}
                              onMouseDown={(e) => { e.stopPropagation(); setSelectedPositionId(pos.id); }} />
                          );
                        })()}
                        {/* Ручка для перемещения (только когда не привязана к ветви) */}
                        {!isBranchAttached && !isDrawing && (
                          <circle
                            cx={endSx} cy={endSy} r={isDragging ? 7 : 5}
                            fill={isDragging ? "#fff" : pos.color}
                            stroke={pos.color} strokeWidth={1.5}
                            style={{ pointerEvents: "all", cursor: "crosshair" }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              leaderDragRef.current = { posId: pos.id };
                              setDraggingLeaderPosId(pos.id);
                            }}
                          />
                        )}
                        {/* Курсор при предпросмотре */}
                        {isDrawing && (
                          <circle cx={endSx} cy={endSy} r={isBranchAttached ? 8 : 5}
                            fill={isBranchAttached ? pos.color : "none"}
                            stroke={pos.color} strokeWidth={1.5}
                            opacity={isBranchAttached ? 0.9 : 0.7}
                            strokeDasharray={isBranchAttached ? undefined : "3,2"}
                            style={{ pointerEvents: "none" }} />
                        )}
                        {/* Кнопка переместить для привязанных к ветви */}
                        {isBranchAttached && !isDrawing && pos.id === selectedPositionId && (
                          <circle cx={endSx} cy={endSy} r={8}
                            fill="none" stroke={pos.color} strokeWidth={1.5}
                            strokeDasharray="4,2"
                            style={{ pointerEvents: "all", cursor: "crosshair" }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              // Запускаем режим перерисовки выноски
                              setLeaderDrawMode(pos.id);
                              setLeaderCursorScreen(null);
                              setLeaderSnapBranch(null);
                            }}
                          />
                        )}

                        {/* Дополнительные (дублирующие) выноски — от того же маркера pm.
                            Не влияют на положение маркера (он привязан к основной). */}
                        {(pos.extraLeaders ?? []).map((el) => {
                          let eSx: number | null = null, eSy: number | null = null;
                          let attached = false;
                          if (el.branchId && el.t != null) {
                            const ep = leaderBranchEnd(el.branchId, el.t);
                            if (ep) { eSx = ep.sx; eSy = ep.sy; attached = true; }
                          } else if (el.endX != null && el.endY != null) {
                            const ep = proj(el.endX, el.endY, pz);
                            eSx = ep.sx; eSy = ep.sy;
                          }
                          if (eSx == null || eSy == null) return null;
                          const ddx = eSx - pm.sx, ddy = eSy - pm.sy;
                          const ddist = Math.hypot(ddx, ddy);
                          if (ddist < 2) return null;
                          const uux = ddx / ddist, uuy = ddy / ddist;
                          const ex1 = pm.sx + uux * (r + 2), ey1 = pm.sy + uuy * (r + 2);
                          return (
                            <g key={`extra-${pos.id}-${el.id}`}>
                              <line x1={ex1} y1={ey1} x2={eSx} y2={eSy}
                                stroke="#e11d48" strokeWidth={lw}
                                strokeDasharray="6,3" strokeLinecap="round"
                                opacity={0.95} style={{ pointerEvents: "none" }} />
                              {attached && (() => {
                                const key = `${pos.id}:${el.id}`;
                                const active = hoveredLeaderAnchor === key || pos.id === selectedPositionId;
                                return (
                                  <circle cx={eSx} cy={eSy} r={5}
                                    fill={active ? "#e11d48" : "transparent"}
                                    stroke={active ? "#fff" : "none"}
                                    strokeWidth={active ? 1.5 : 0}
                                    style={{ pointerEvents: "all", cursor: "pointer" }}
                                    onMouseEnter={() => setHoveredLeaderAnchor(key)}
                                    onMouseLeave={() => setHoveredLeaderAnchor((h) => h === key ? null : h)}
                                    onMouseDown={(e) => { e.stopPropagation(); setSelectedPositionId(pos.id); }} />
                                );
                              })()}
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}

                  {/* ── Маркеры позиций ── */}
                  {positions.map((pos) => {
                    if (pos.visible === false) return null;
                    const { sx, sy } = markerScreenPos(pos);
                    const r = (pos.diameter ?? 13) * _gostFactor * PX_PER_MM / 2;
                    const isSelected = pos.id === selectedPositionId;
                    const isReverse = pos.positionType === "reverse";
                    const fontSize = pos.number >= 100 ? r * 0.55 : pos.number >= 10 ? r * 0.7 : r * 0.85;
                    return (
                      <g
                        key={pos.id}
                        transform={`translate(${sx}, ${sy})`}
                        style={{ pointerEvents: "all", cursor: draggingPosId === pos.id ? "grabbing" : isSelected ? "grab" : "pointer" }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          if (leaderDrawMode) { setLeaderDrawMode(null); setLeaderCursorScreen(null); setLeaderSnapBranch(null); }
                          const containerRect = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
                          if (!containerRect) return;

                          const startSx = e.clientX - containerRect.left;
                          const startSy = e.clientY - containerRect.top;

                          // Детектируем двойной клик вручную (надёжнее браузерного dblclick)
                          const now = Date.now();
                          const lastClick = (e.currentTarget as SVGGElement & { _lastClick?: number })._lastClick ?? 0;
                          const isDouble = now - lastClick < 350;
                          (e.currentTarget as SVGGElement & { _lastClick?: number })._lastClick = now;

                          if (isDouble) {
                            // Двойной клик — открываем настройки позиции в левой панели
                            setSelectedPositionId(pos.id);
                            setActiveSide("positions");
                            setLeftPanelOpen(true);
                            setSelectedNodeId(null);
                            setSelectedBranchId(null);
                            return;
                          }

                          // Одиночный клик — выбор + готовность к перетаскиванию
                          setSelectedPositionId(pos.id);
                          setDraggingPosId(pos.id);
                          posDragRef.current = {
                            id: pos.id,
                            startSx,
                            startSy,
                            startWx: pos.x,
                            startWy: pos.y,
                          };
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isReverse && (
                          <>
                            <circle r={r + r * 0.14} fill="none" stroke="#e53e3e" strokeWidth={Math.max(1.5, r * 0.06)} />
                            <circle r={r + r * 0.08} fill="none" stroke="#fff" strokeWidth={Math.max(1.5, r * 0.07)} />
                          </>
                        )}
                        {isSelected && <circle r={r + r * 0.08} fill="none" stroke="#1e5a7a" strokeWidth={Math.max(1.5, r * 0.05)} strokeDasharray="5,2.5" />}
                        <circle r={r} fill={pos.color} stroke={pos.borderColor} strokeWidth={Math.max(1, r * 0.05)} />
                        <text
                          textAnchor="middle" dominantBaseline="central"
                          fill="#000" fontSize={fontSize}
                          fontWeight="bold" fontFamily="sans-serif"
                          style={{ userSelect: "none" }}
                        >
                          {pos.number}
                        </text>
                      </g>
                    );
                  })}

                  {/* ── Текстовые блоки ── */}
                  {(() => {
                    const vs = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
                    const _xySF = xyScale ?? 1;
                    const pxPerMm = 3.78 * Math.min(8, Math.max(0.25, vs.scale / (_xySF * 0.5)));
                    return textBlocks.map((tb) => {
                      const { sx, sy } = project3D(
                        { x: tb.x * _xySF, y: tb.y * _xySF, z: 0 },
                        { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation }
                      );
                      const fsPx = tb.fontSize * pxPerMm;
                      const isSel = tb.id === selectedTextBlockId;
                      const lines = tb.text.split("\n");
                      const lineH = fsPx * 1.35;
                      const maxLen = Math.max(...lines.map(l => l.length), 4);
                      const estW = Math.max(60, maxLen * fsPx * 0.58 + 16);
                      const estH = lines.length * lineH + 12;
                      return (
                        <g key={tb.id}
                          transform={`translate(${sx},${sy})`}
                          style={{ cursor: draggingTextId === tb.id ? "grabbing" : isSel ? "grab" : "pointer", pointerEvents: "all" }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            const cr = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
                            if (!cr) return;
                            const startSx = e.clientX - cr.left;
                            const startSy = e.clientY - cr.top;
                            const now = Date.now();
                            const el = e.currentTarget as SVGGElement & { _lastClick?: number };
                            const isDbl = now - (el._lastClick ?? 0) < 350;
                            el._lastClick = now;
                            if (isDbl) { setEditingTextBlockId(tb.id); setSelectedTextBlockId(tb.id); return; }
                            setSelectedTextBlockId(tb.id);
                            setEditingTextBlockId(null);
                            setDraggingTextId(tb.id);
                            textDragRef.current = { id: tb.id, startSx, startSy, startWx: tb.x, startWy: tb.y };
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {tb.background !== "none" && (
                            <rect x={-estW/2} y={-estH/2} width={estW} height={estH} fill={tb.background} rx={3} />
                          )}
                          {isSel && (
                            <rect x={-estW/2-3} y={-estH/2-3} width={estW+6} height={estH+6}
                              fill="none" stroke="#1e5a7a" strokeWidth={1.5} strokeDasharray="5,2.5" rx={4} />
                          )}
                          {tb.borderColor !== "none" && (
                            <rect x={-estW/2} y={-estH/2} width={estW} height={estH}
                              fill="none" stroke={tb.borderColor} strokeWidth={1} rx={3} />
                          )}
                          {lines.map((line, li) => (
                            <text key={li}
                              x={0} y={(-estH/2 + 8) + li * lineH + fsPx * 0.8}
                              textAnchor="middle" fill={tb.color} fontSize={fsPx}
                              fontWeight={tb.bold ? "bold" : "normal"}
                              fontStyle={tb.italic ? "italic" : "normal"}
                              fontFamily="sans-serif"
                              style={{ userSelect: "none" }}
                            >{line}</text>
                          ))}
                        </g>
                      );
                    });
                  })()}
                </svg>
              );
            })()}

            {/* ── Inline-редактор текстового блока ── */}
            {editingTextBlockId && (() => {
              const tb = textBlocks.find(t => t.id === editingTextBlockId);
              if (!tb) return null;
              const vs = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
              const _xySF = xyScale ?? 1;
              const { sx, sy } = project3D(
                { x: tb.x * _xySF, y: tb.y * _xySF, z: 0 },
                { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation }
              );
              const pxPerMm = 3.78 * Math.min(8, Math.max(0.25, vs.scale / (_xySF * 0.5)));
              const fsPx = tb.fontSize * pxPerMm;
              return (
                <textarea
                  autoFocus
                  defaultValue={tb.text}
                  onBlur={(e) => {
                    setTextBlocks(prev => prev.map(t => t.id === editingTextBlockId ? { ...t, text: e.target.value } : t));
                    setEditingTextBlockId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setEditingTextBlockId(null); }
                    e.stopPropagation();
                  }}
                  style={{
                    position: "absolute",
                    left: sx - 80, top: sy - fsPx * 1.2,
                    minWidth: 160, minHeight: fsPx * 2.5,
                    fontSize: fsPx,
                    fontWeight: tb.bold ? "bold" : "normal",
                    fontStyle: tb.italic ? "italic" : "normal",
                    fontFamily: "sans-serif",
                    color: tb.color,
                    background: tb.background !== "none" ? tb.background : "rgba(255,255,255,0.97)",
                    border: "2px solid var(--c-blue, #2563eb)",
                    borderRadius: "var(--radius-ui)", padding: "4px 8px",
                    outline: "none", resize: "both",
                    zIndex: 200,
                    boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
                    lineHeight: 1.4,
                  }}
                />
              );
            })()}

            {/* Подсказка в режиме текстового блока */}
            {tool === "textblock" && (
              <div style={{
                position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
                background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 12, fontWeight: 500,
                padding: "5px 14px", borderRadius: 6, pointerEvents: "none", zIndex: 100,
                letterSpacing: 0.2, boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              }}>
                T Кликните на схеме для добавления текста  [Esc — отмена]
              </div>
            )}

            {/* Легенда сравнения схем */}
            {compareResult && compareResult.branches.some(b => b.status !== "unchanged") && (
              <div style={{
                position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
                background: "rgba(15,23,42,0.88)", color: "#fff", fontSize: 11,
                padding: "5px 14px", borderRadius: 6, pointerEvents: "none", zIndex: 50,
                display: "flex", alignItems: "center", gap: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                backdropFilter: "blur(4px)",
              }}>
                <span style={{ color: "#a5b4fc", fontWeight: 600, marginRight: 4 }}>↔ Сравнение:</span>
                <span><span style={{ color: "var(--c-amber-lt, #f59e0b)" }}>●</span> есть изменения</span>
                <span><span style={{ color: "var(--c-green-lt, #22c55e)" }}>●</span> добавленный объект</span>
                <span><span style={{ color: "var(--c-red-lt, #ef4444)" }}>●</span> удалённый объект</span>
              </div>
            )}

            {/* Подсказка при drag/draw выноски */}
            {(draggingLeaderPosId || leaderDrawMode) && (
              <div style={{
                position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
                background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 12, fontWeight: 500,
                padding: "5px 14px", borderRadius: 6, pointerEvents: "none", zIndex: 100,
                letterSpacing: 0.2, boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              }}>
                {leaderDrawMode
                  ? (leaderExtraMode
                      ? "✛ Кликните на ветви для дополнительной выноски  [Esc — отмена]"
                      : "✛ Кликните на схеме для размещения конца выноски  [Esc — отмена]")
                  : "✛ Отпустите для фиксации выноски"}
              </div>
            )}

            {/* ─── Шкала распространения взрывной волны ────────────── */}
            {showExplosionZones && activeExplosionRes && !activeExplosionRes.noExplosion && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                background: "rgba(10,8,0,0.93)", borderTop: "2px solid var(--c-amber, #b45309)",
                padding: "22px 12px 6px", display: "flex", alignItems: "center",
                gap: 8, zIndex: 60, backdropFilter: "blur(4px)", overflow: "visible",
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fde68a", whiteSpace: "nowrap" }}>
                  💥 Волна взрыва
                </span>

                {/* Кнопка Воспроизведение / Пауза */}
                <button
                  onClick={() => {
                    if (blastAnimating) {
                      if (blastAnimRef.current) clearInterval(blastAnimRef.current);
                      blastAnimRef.current = null;
                      setBlastAnimating(false);
                    } else {
                      setBlastWaveRadius(prev => prev >= blastMaxRadius ? 0 : prev);
                      setBlastAnimating(true);
                      blastAnimRef.current = setInterval(() => {
                        setBlastWaveRadius(prev => {
                          const next = prev + blastRadiusStep;
                          if (next >= blastMaxRadius) {
                            if (blastAnimRef.current) clearInterval(blastAnimRef.current);
                            blastAnimRef.current = null;
                            setBlastAnimating(false);
                            return blastMaxRadius;
                          }
                          return next;
                        });
                      }, 120);
                    }
                  }}
                  title={blastAnimating ? "Пауза" : "Воспроизведение"}
                  style={{
                    background: blastAnimating ? "var(--c-amber-ink, #92400e)" : "var(--c-amber-lt, #f59e0b)",
                    border: "1px solid var(--c-amber, #b45309)", borderRadius: "var(--radius-ui)", color: "#fff",
                    fontSize: 11, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
                    whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4,
                  }}>
                  {blastAnimating ? "⏸ Пауза" : "▶ Воспроизведение"}
                </button>

                {/* Сброс */}
                <button
                  onClick={() => {
                    if (blastAnimRef.current) clearInterval(blastAnimRef.current);
                    blastAnimRef.current = null;
                    setBlastAnimating(false);
                    setBlastWaveRadius(0);
                  }}
                  style={{
                    background: "#1c1202", border: "1px solid var(--c-amber, #b45309)", borderRadius: "var(--radius-ui)",
                    color: "#fde68a", fontSize: 11, padding: "2px 7px", cursor: "pointer",
                  }}>
                  ⏮
                </button>

                {/* Ползунок с маркерами зон */}
                <div style={{ position: "relative", flex: 1, minWidth: 120 }}>
                  {/* Градиент фона */}
                  <div style={{
                    position: "absolute", top: "50%", left: 0, right: 0, height: 8,
                    transform: "translateY(-50%)", borderRadius: "var(--radius-ui)",
                    background: "linear-gradient(to right, #7c1010, var(--c-red-bg, #dc2626) 15%, #f97316 30%, #fbbf24 50%, var(--c-green-lt, #22c55e))",
                    opacity: 0.45, pointerEvents: "none",
                  }} />

                  {/* Маркеры радиусов зон */}
                  {activeExplosionRes && blastMaxRadius > 0 && [
                    { hazard: "lethal",  color: EXPLOSION_HAZARD_COLORS.lethal, label: "Л" },
                    { hazard: "heavy",   color: EXPLOSION_HAZARD_COLORS.heavy, label: "Т" },
                    { hazard: "medium",  color: EXPLOSION_HAZARD_COLORS.medium, label: "С" },
                    { hazard: "light",   color: EXPLOSION_HAZARD_COLORS.light, label: "Л" },
                    { hazard: "safe",    color: EXPLOSION_HAZARD_COLORS.safe, label: "Б" },
                  ].map(({ hazard, color }) => {
                    const zone = activeExplosionRes.zones.find(z => z.hazardLevel === hazard);
                    const r = zone?.radius_m ?? 0;
                    if (r <= 0 || r > blastMaxRadius) return null;
                    const pct = Math.min(100, (r / blastMaxRadius) * 100);
                    return (
                      <div key={hazard} style={{
                        position: "absolute", top: -18, left: `${pct}%`,
                        transform: "translateX(-50%)",
                        pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center",
                      }}>
                        <span style={{ fontSize: 9, color, fontWeight: 700, whiteSpace: "nowrap", lineHeight: 1 }}>
                          {r}м
                        </span>
                        <div style={{ width: 1, height: 6, background: color, opacity: 0.8 }} />
                      </div>
                    );
                  })}

                  <input
                    type="range" min={0} max={blastMaxRadius} step={blastRadiusStep}
                    value={blastWaveRadius}
                    onChange={e => {
                      if (blastAnimRef.current) clearInterval(blastAnimRef.current);
                      blastAnimRef.current = null;
                      setBlastAnimating(false);
                      setBlastWaveRadius(Number(e.target.value));
                    }}
                    style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer", position: "relative", zIndex: 1, background: "transparent" }}
                  />
                </div>

                {/* Текущий радиус + давление */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--c-amber-bg, #92400e)",
                    borderRadius: "var(--radius-ui)", padding: "1px 9px", whiteSpace: "nowrap", minWidth: 72, textAlign: "center",
                  }}>
                    R = {blastWaveRadius} м
                  </span>
                  {blastWaveRadius > 0 && (
                    <span style={{
                      fontSize: 10, color: "#fde68a", whiteSpace: "nowrap",
                    }}>
                      ΔP = {activeExplosionRes.pressureAtDistance(blastWaveRadius).toFixed(1)} кПа
                    </span>
                  )}
                </div>

                <div style={{ width: 1, background: "var(--c-amber-bg, #b45309)", alignSelf: "stretch", margin: "0 2px" }} />

                {/* Настройки */}
                <span style={{ fontSize: 10, color: "#fde68a", whiteSpace: "nowrap" }}>Макс:</span>
                {/* Предел 50 км, а не 5 км: при канальной модели волна идёт
                    по выработкам на километры, и прежний потолок 5000 м
                    обрезал окраску — дальше него ветви оставались неокрашенными. */}
                <input
                  type="number" min={10} max={50000} step={10}
                  value={blastMaxRadius}
                  onChange={e => {
                    const v = Math.max(10, Math.min(50000, Number(e.target.value)));
                    setBlastMaxRadius(v);
                    if (blastWaveRadius > v) setBlastWaveRadius(v);
                  }}
                  style={{
                    width: 52, fontSize: 11, background: "#1c1202", color: "#fde68a",
                    border: "1px solid var(--c-amber, #b45309)", borderRadius: "var(--radius-ui)", padding: "1px 4px", textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 10, color: "#fde68a" }}>м</span>

                <span style={{ fontSize: 10, color: "#fde68a", whiteSpace: "nowrap" }}>Шаг:</span>
                <select
                  value={blastRadiusStep}
                  onChange={e => setBlastRadiusStep(Number(e.target.value))}
                  style={{
                    fontSize: 11, background: "#1c1202", color: "#fde68a",
                    border: "1px solid var(--c-amber, #b45309)", borderRadius: "var(--radius-ui)", padding: "1px 2px",
                  }}>
                  {[1, 2, 5, 10, 25, 50, 100].map(s => (
                    <option key={s} value={s}>{s} м</option>
                  ))}
                </select>
              </div>
            )}

            {/* ─── Временная шкала задымления ─────────────────────── */}
            {showSmoke && fireCalcDone && fireResult && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                background: "rgba(20,5,5,0.93)", borderTop: "2px solid #7f1d1d",
                padding: "5px 12px 6px", display: "flex", alignItems: "center",
                gap: 8, zIndex: 60, backdropFilter: "blur(4px)",
              }}>
                {/* Иконка + подпись */}
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fca5a5", whiteSpace: "nowrap" }}>
                  🔥 Задымление
                </span>

                {/* Кнопка Воспроизведение / Пауза */}
                <button
                  onClick={() => {
                    if (smokeAnimating) {
                      // Пауза
                      if (smokeAnimRef.current) clearInterval(smokeAnimRef.current);
                      smokeAnimRef.current = null;
                      setSmokeAnimating(false);
                    } else {
                      // Если дошли до конца — сбрасываем на начало
                      setSmokeTimeMinutes(prev => prev >= smokeMaxTime ? 0 : prev);
                      setSmokeAnimating(true);
                      smokeAnimRef.current = setInterval(() => {
                        setSmokeTimeMinutes(prev => {
                          const next = Math.round((prev + smokeTimeStep) * 1000) / 1000;
                          if (next >= smokeMaxTime) {
                            if (smokeAnimRef.current) clearInterval(smokeAnimRef.current);
                            smokeAnimRef.current = null;
                            setSmokeAnimating(false);
                            return smokeMaxTime;
                          }
                          return next;
                        });
                      }, 800);
                    }
                  }}
                  title={smokeAnimating ? "Пауза" : "Воспроизведение"}
                  style={{
                    background: smokeAnimating ? "#7f1d1d" : "var(--c-red, #dc2626)",
                    border: "1px solid var(--c-red-ink, #991b1b)", borderRadius: "var(--radius-ui)", color: "#fff",
                    fontSize: 11, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
                    whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4,
                  }}>
                  {smokeAnimating ? "⏸ Пауза" : "▶ Воспроизведение"}
                </button>

                {/* Кнопка сброс */}
                <button
                  onClick={() => {
                    if (smokeAnimRef.current) clearInterval(smokeAnimRef.current);
                    smokeAnimRef.current = null;
                    setSmokeAnimating(false);
                    setSmokeTimeMinutes(0);
                  }}
                  title="Сначала"
                  style={{
                    background: "#3b0000", border: "1px solid #7f1d1d", borderRadius: "var(--radius-ui)",
                    color: "#fca5a5", fontSize: 11, padding: "2px 7px", cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}>
                  ⏮
                </button>

                {/* Метка начала */}
                <span style={{ fontSize: 11, color: "#f87171", whiteSpace: "nowrap" }}>0 мин</span>

                {/* Слайдер времени */}
                <input
                  type="range"
                  min={0}
                  max={smokeMaxTime}
                  step={smokeTimeStep}
                  value={smokeTimeMinutes}
                  onChange={e => {
                    if (smokeAnimRef.current) clearInterval(smokeAnimRef.current);
                    smokeAnimRef.current = null;
                    setSmokeAnimating(false);
                    setSmokeTimeMinutes(Number(e.target.value));
                  }}
                  style={{ flex: 1, accentColor: "#ef4444", cursor: "pointer", minWidth: 80 }}
                />

                {/* Метка конца */}
                <span style={{ fontSize: 11, color: "#f87171", whiteSpace: "nowrap" }}>{smokeMaxTime} мин</span>

                {/* Текущее время — крупно */}
                <span style={{
                  fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--c-red-bg, #b91c1c)",
                  borderRadius: "var(--radius-ui)", padding: "1px 9px", whiteSpace: "nowrap", minWidth: 72, textAlign: "center",
                }}>
                  {smokeTimeMinutes > 0 && smokeTimeMinutes < 1
                    ? `T = ${Math.round(smokeTimeMinutes * 60)} сек`
                    : `T = ${Number(smokeTimeMinutes.toFixed(2))} мин`}
                </span>

                <div style={{ width: 1, background: "#7f1d1d", alignSelf: "stretch", margin: "0 2px" }} />

                {/* Настройка максимума */}
                <span style={{ fontSize: 10, color: "#fca5a5", whiteSpace: "nowrap" }}>Макс:</span>
                <input
                  type="number" min={1} max={600} step={1}
                  value={smokeMaxTime}
                  onChange={e => {
                    const v = Math.max(1, Math.min(600, Number(e.target.value)));
                    setSmokeMaxTime(v);
                    if (smokeTimeMinutes > v) setSmokeTimeMinutes(v);
                  }}
                  style={{
                    width: 48, fontSize: 11, background: "#3b0000", color: "#fca5a5",
                    border: "1px solid #7f1d1d", borderRadius: "var(--radius-ui)", padding: "1px 4px", textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 10, color: "#fca5a5" }}>мин</span>

                {/* Настройка шага */}
                <span style={{ fontSize: 10, color: "#fca5a5", whiteSpace: "nowrap" }}>Шаг:</span>
                <select
                  value={smokeTimeStep}
                  onChange={e => setSmokeTimeStep(Number(e.target.value))}
                  style={{
                    fontSize: 11, background: "#3b0000", color: "#fca5a5",
                    border: "1px solid #7f1d1d", borderRadius: "var(--radius-ui)", padding: "1px 2px",
                  }}>
                  {[
                    { v: 1 / 60, label: "1 сек" },
                    { v: 30 / 60, label: "30 сек" },
                    { v: 1, label: "1 мин" },
                    { v: 2, label: "2 мин" },
                    { v: 5, label: "5 мин" },
                    { v: 10, label: "10 мин" },
                    { v: 15, label: "15 мин" },
                    { v: 30, label: "30 мин" },
                    { v: 60, label: "60 мин" },
                  ].map(s => (
                    <option key={s.label} value={s.v}>{s.label}</option>
                  ))}
                </select>

                <div style={{ width: 1, background: "#7f1d1d", alignSelf: "stretch", margin: "0 2px" }} />

                {/* Порог видимости задымления — применяется при следующем расчёте пожара */}
                <span style={{ fontSize: 10, color: "#fca5a5", whiteSpace: "nowrap" }}
                  title="Дым распространяется, пока видимость в дыму ниже этого порога. Применяется при следующем расчёте пожара.">
                  Порог видимости:
                </span>
                <input
                  type="number" min={1} max={1000} step={5}
                  value={smokeVisThreshold}
                  onChange={e => setSmokeVisThreshold(Math.max(1, Math.min(1000, Number(e.target.value))))}
                  title="Дым распространяется, пока видимость в дыму ниже этого порога. Применяется при следующем расчёте пожара."
                  style={{
                    width: 48, fontSize: 11, background: "#3b0000", color: "#fca5a5",
                    border: "1px solid #7f1d1d", borderRadius: "var(--radius-ui)", padding: "1px 4px", textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 10, color: "#fca5a5" }}>м</span>
              </div>
            )}

            {/* ── Водяной знак ДЕМО ─────────────────────────────── */}
            {isDemo && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center"
                style={{ zIndex: 10 }}>
                {/* Водяной знак демо — фирменной надписью «ПВ-Система» в янтаре
                    кнопки «Расчёт сети»: полупрозрачно, под углом, не мешает работе. */}
                <div className="select-none flex flex-col items-center"
                  style={{ transform: "rotate(-30deg)", opacity: 0.16, userSelect: "none", whiteSpace: "nowrap" }}>
                  <div style={{
                    fontSize: "clamp(44px, 7vw, 108px)", fontWeight: 800, letterSpacing: "0.02em", lineHeight: 1,
                    fontFamily: "var(--font-ui)", color: "#e8a317",
                    WebkitTextStroke: "1.5px #c98a0c",
                  }}>
                    ПВ-Система
                  </div>
                  <div style={{
                    marginTop: "0.6em", fontSize: "clamp(14px, 1.6vw, 22px)", fontWeight: 700,
                    letterSpacing: "0.5em", color: "#c98a0c", fontFamily: "var(--font-ui)",
                  }}>
                    ДЕМО-ВЕРСИЯ
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── ПРАВАЯ ПАНЕЛЬ — «Панель информации» ─────────────── */}
        {!rightPanelOpen && (
          <button onClick={() => setRightPanelOpen(true)}
            className="flex-shrink-0 flex flex-col items-center justify-start gap-2 pt-2 w-6 h-full border-l"
            style={{ background: "var(--c-s2, #f5f5f5)", borderColor: "var(--c-b3, #b8b8b8)", color: "var(--c-t2, #374151)", cursor: "pointer" }}
            title={rightAutoCollapsed
              ? "Панель «Отображение» свёрнута, чтобы схеме хватило места на этом экране. Нажмите, чтобы показать"
              : "Показать панель «Отображение»"}>
            <Icon name="PanelRightOpen" size={14} />
            <span className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ writingMode: "vertical-rl", color: "var(--c-t3, #6b7280)" }}>Отображение</span>
          </button>
        )}
        {rightPanelOpen && (
          <div onMouseDown={startRightDrag} onDoubleClick={resetRightWidth}
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-blue-400 active:bg-blue-500 transition-colors"
            style={{ background: "#d0d0d0" }}
            title="Перетащите, чтобы изменить ширину панели. Двойной клик — ширина по размеру окна" />
        )}
        {rightPanelOpen && (
          <div className="flex-shrink-0 flex flex-col"
            style={{ width: rightPanelWidth, background: "var(--c-s2, #f8f7f4)", borderLeft: "1px solid var(--c-b2, #d5d1c8)" }}>
            {/* Заголовок */}
            <div className="flex items-center gap-2 px-2.5 h-9 flex-shrink-0"
              style={{ background: "var(--c-s1, #fff)", borderBottom: "1px solid var(--c-b1, #e7e4dd)" }}>
              <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ background: "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)", color: "var(--c-accent, #1e5a7a)" }}>
                <Icon name="LayoutList" size={13} />
              </span>
              <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-t1, #1f2328)" }}>
                Отображение
              </span>
              <button onClick={() => setRightPanelOpen(false)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--c-s3,#f1efea)]"
                style={{ background: "transparent", border: "none", color: "var(--c-t3, #6b7280)", cursor: "pointer" }}
                title="Свернуть панель">
                <Icon name="PanelRightClose" size={14} />
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 overflow-hidden">
                <InfoPanel
                  config={infoPanelConfig}
                  onChange={updateInfoConfigSynced}
                  nodes={nodes}
                  selectedNodeId={selectedNodeId}
                  onNodeVisibilityChange={(id, visible) => updateNode(id, { visible })}
                  onAllNodesVisibility={(visible) => setNodes((p) => p.map((n) => ({ ...n, visible })))}
                  onSelectNode={(id) => {
                    setSelectedNodeId(id);
                    setSelectedBranchId(null);
                    setFocusPos(null);
                    setFocusNodeId(id);
                    setFocusNonce(Date.now());
                  }}
                  positions={positions}
                  onPositionVisibilityChange={(id, visible) =>
                    setPositions((p) => p.map((pos) => pos.id === id ? { ...pos, visible } : pos))
                  }
                  onPositionBranchesVisibilityChange={(id, branchesVisible) =>
                    setPositions((p) => p.map((pos) => pos.id === id ? { ...pos, branchesVisible } : pos))
                  }
                  onAllPositionsVisibility={(visible, branchesVisible) =>
                    setPositions((p) => p.map((pos) => ({ ...pos, visible, branchesVisible })))
                  }
                />
              </div>

              {/* Масштаб и скрытие узлов */}
              <div className="px-2 py-2 flex-shrink-0 space-y-2 overflow-y-auto overscroll-contain"
                style={{ maxHeight: "45%", background: "var(--c-s2, #f8f7f4)", borderTop: "1px solid var(--c-b1, #e7e4dd)" }}>
                <Card icon="Maximize2" title="Масштаб" collapsible defaultOpen={false}
                  aside={<span className="text-[10px]" style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-num)" }}>
                    XY ×{xyScale.toFixed(1)} · Z ×{zScale.toFixed(1)}
                  </span>}>
                  <Field label="По плану (XY)">
                    <PresetSlider value={xyScale} onChange={setXyScale} onReset={() => setXyScale(1)}
                      min={0.1} max={10} step={0.1} presets={[0.5, 1, 2, 5, 10]} fmt={(v) => `×${v.toFixed(1)}`} />
                  </Field>
                  <Field label="По высоте (Z)">
                    <PresetSlider value={zScale} onChange={setZScale} onReset={() => setZScale(1)}
                      min={0.1} max={20} step={0.1} presets={[1, 2, 5, 10, 20]} fmt={(v) => `×${v.toFixed(1)}`} />
                  </Field>
                </Card>
                {/* Настройка «Порог SVG→Canvas» убрана: схема всегда рисуется
                    быстрым способом (см. CANVAS_THRESHOLD в canvasRenderer.ts). */}
                <Card icon="EyeOff" title="Скрытие узлов" collapsible defaultOpen={false}
                  aside={<span className="text-[10px]" style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-num)" }}>
                    {nodeLodAuto ? "авто" : `${nodeLodCircle}% / ${nodeLodLabel}%`}
                  </span>}>
                  <div className="text-[10px] leading-snug" style={{ color: "var(--c-t3, #6b7280)" }}>
                    При сильном отдалении кружки и номера узлов скрываются, чтобы схема не тормозила.
                  </div>
                  <Switch checked={nodeLodAuto} onChange={setNodeLodAuto} label="Авто (по размеру схемы)" />
                  {!nodeLodAuto && (
                    <>
                      <Field label="Кружки узлов, % масштаба">
                        <PresetSlider value={nodeLodCircle} onChange={(v) => setNodeLodCircle(Math.round(v))}
                          onReset={() => { setNodeLodCircle(12); setNodeLodLabel(32); }}
                          min={0} max={100} step={1} presets={[0, 12, 25, 50]} fmt={(v) => `${v}%`} />
                      </Field>
                      <Field label="Номера узлов, % масштаба">
                        <PresetSlider value={nodeLodLabel} onChange={(v) => setNodeLodLabel(Math.round(v))}
                          onReset={() => { setNodeLodCircle(12); setNodeLodLabel(32); }}
                          min={0} max={100} step={1} presets={[0, 32, 50, 75]} fmt={(v) => `${v}%`} />
                      </Field>
                    </>
                  )}
                  <div className="text-[10px]" style={{ color: "var(--c-t4, #767f8c)" }}>
                    Узлов: {nodes.length} · текущий масштаб ×{viewScale.toFixed(2)}
                  </div>
                </Card>
              </div>
            </div>

            {/* ── Подвал панели: быстрые действия ── */}
            <div className="p-2 flex gap-1 flex-shrink-0"
              style={{ background: "var(--c-s1, #fff)", borderTop: "1px solid var(--c-b1, #e7e4dd)" }}>
              {/* Фирменная кнопка главного действия: янтарь + антрацит. */}
              <button onClick={handleSolve} disabled={vcSolving}
                className="btn-brand flex-1 h-7 text-xs flex items-center justify-center gap-1.5"
                title="Расчёт воздухораспределения (F9)">
                <Icon name={vcSolving ? "Loader" : "Play"} size={12} className={vcSolving ? "animate-spin" : ""} />
                {vcSolving && solveProgress !== null ? `Расчёт… ${solveProgress}%` : "Расчёт"}
                <kbd className="btn-brand-kbd">F9</kbd>
              </button>
              {([
                { on: thinLines, toggle: () => setThinLines((v) => !v), icon: "Minus", title: "Тонкие линии (F6)" },
                { on: showFlowArrows, toggle: () => setShowFlowArrows((v) => !v), icon: "ArrowRight", title: "Стрелки направления свежей струи" },
              ]).map((b) => (
                <button key={b.icon} onClick={b.toggle} title={b.title} aria-pressed={b.on}
                  className="w-7 h-7 flex items-center justify-center rounded transition-colors"
                  style={{
                    cursor: "pointer",
                    background: b.on ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)" : "var(--c-s1, #fff)",
                    border: `1px solid ${b.on ? "var(--c-accent, #1e5a7a)" : "var(--c-b2, #d5d1c8)"}`,
                    color: b.on ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)",
                  }}>
                  <Icon name={b.icon} size={12} />
                </button>
              ))}
            </div>
          </div>
        )}
    </>
  );
}
