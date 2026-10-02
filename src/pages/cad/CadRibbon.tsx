import Icon from "@/components/ui/icon";
import SolverParamsPanel, { SOLVER_DEFAULTS, type SolverParams } from "@/components/cad/SolverParamsPanel";
import { BULKHEAD_SYMBOL_IDS, FIRE_SYMBOL_IDS, EXPLOSION_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { type ThermalDepMethod } from "@/lib/fireCalculator";
import { loadRecentData, hasRecentData, loadHandleFromIDB } from "@/lib/useRecentFiles";
import { INSTALLER_URL } from "@/lib/updater";
import RibbonSymbolGrid from "@/components/cad/RibbonSymbolGrid";
import SymbolPicker from "@/components/cad/SymbolPicker";
import RibbonReferences from "@/components/cad/RibbonReferences";
import { runFireMode } from "@/lib/fireModeRun";
import { runExplosionMode } from "@/lib/explosionModeRun";
import { exportExplosionReport } from "@/lib/explosionReport";
import { RibbonTabBtn, RibbonGroup, RibbonBigBtn } from "./cadComponents";
import { EXPLOSION_URL, safeFixed } from "./cadCompute";
import CadTitleBar from "./CadTitleBar";
import type { CadPageState } from "./useCadPage";
import { makePosition } from "@/lib/positions";

// ─────────────────────────────────────────────────────────────────────────────
// CAD-интерфейс шахтной/вентиляционной сети в стиле инженерного ПО
// (АэроСеть / Вентиляция-CAD): ribbon-меню + вертикальные вкладки + свойства
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Импорт из сторонних программ, закрытый в демо-режиме.
 *
 * Это основная ценность программы — перенос готовой схемы рудника из АэроСети,
 * Вентиляции 2.0 и Ventsim. Плюс через импорт в демо можно было загрузить
 * схему на сотни выработок в обход ограничения «не более 20 узлов».
 *
 * Открытыми остаются СВОИ форматы (.vproj/.json, .xml, .txt) — ими человек
 * переносит собственные наработки между рабочими местами.
 */
const DEMO_LOCKED_IMPORTS = new Set([
  "erp",          // проект .erp (АэроСеть)
  "csv-aero",     // CSV из АэроСети
  "csv-vent2",    // CSV из Вентиляции 2.0
  "cdf3",         // схема .cdf3 (Вентиляция 2.0)
  "csv-ventsim",  // CSV из Ventsim
  "vsm",          // модель .vsm (Ventsim)
  "dxf",          // чертёж DXF
  "combined",     // DXF + Excel вместе
  "excel",        // Excel-таблица параметров
]);

// Заголовок окна, демо-баннер, вкладки ленты, меню «Файл» и содержимое ленты.
export default function CadRibbon({ c }: { c: CadPageState }) {
  const {
    license,
    isDemo,
    setShowLicenseDialog,
    setShowSettingsDialog,
    filePathRef,
    activeRibbon,
    setActiveRibbon,
    ribbonCollapsed,
    selectRibbon,
    toggleRibbonCollapsed,
    activeSide,
    setActiveSide,
    showOpoDialog,
    setShowOpoDialog,
    nodes,
    setNodes,
    branchesRaw,
    setBranches,
    historyRef,
    symbolsRef,
    handleUndo,
    selectedBranchId,
    tool,
    setTool,
    branches,
    selectedBranch,
    updateBranch,
    horizons,
    handleSplitBranchAt,
    setShowMoveSchema,
    setShowRampDialog,
    fireResult,
    setFireResult,
    fireCalcDone,
    setFireCalcDone,
    fireCalcProgress,
    setRescuePickMode,
    setRescueStartNodeId,
    setRescueTargetNodeId,
    setRescuePathBranchIds,
    setRescuePathBranchDirs,
    setRescuePathNodeIds,
    setWorkerPickMode,
    setWorkerStartNodeId,
    setWorkerTargetNodeId,
    setWorkerPathBranchIds,
    setWorkerPathBranchDirs,
    setWorkerPathNodeIds,
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
    blastWaveRadius,
    setBlastWaveRadius,
    setBlastMaxRadius,
    setBlastRadiusStep,
    showSmoke,
    setShowSmoke,
    setSmokeTimeMinutes,
    setSmokeMaxTime,
    smokeVisThreshold,
    thermalDepMethod,
    changeThermalDepMethod,
    solveResult,
    vcSolving,
    solveProgress,
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
    setShowFireStability,
    setShowWaterCheck,
    setShowEvacRisk,
    setShowFireControl,
    setShowVds,
    setShowExplosibility,
    setShowLogPanel,
    addLog,
    compareResult,
    setCompareResult,
    setCompareSelectedId,
    setCompareShowDialog,
    selectedPositionId,
    setSelectedPositionId,
    positions,
    setPositions,
    positionPlaceMode,
    setPositionPlaceMode,
    showPositions,
    setShowPositions,
    posColorInner,
    setPosColorInner,
    posColorOuter,
    setPosColorOuter,
    showPlaPanel,
    setShowPlaPanel,
    schemaSymbols,
    totalRByBranch,
    totalDepByBranch,
    baseNodeTemps,
    blastThresholds,
    setShowBlastBulkheadCalc,
    setShowBlastBarrierChart,
    blastDuringEmergency,
    blastGasTimeFactual,
    setShowAirDemand,
    activeSymbolTypeId,
    removeSymbol,
    resetNodeFireState,
    handlePickSymbol,
    pickSymbolStable,
    cancelSymbolStable,
    leftPanelOpen,
    setLeftPanelOpen,
    setInspectionBindMode,
    selectedInspectionRouteId,
    setShowPrintDialog,
    setPrintDialogOpenExport,
    handlePrintVentPipeReport,
    openPrintDialog,
    fileSectionState,
    setFileSectionState,
    desktopLatestVer,
    setShowDxfImport,
    setShowExcelExport,
    setShowCsvExport,
    setShowCsvImport,
    setShowVentsimCsvImport,
    setShowVent2CsvImport,
    setShowVent2Cdf3Import,
    setShowVentsimVsmImport,
    setShowErpImport,
    openEquipRef,
    openLegend,
    recentFiles,
    removeRecentFile,
    clearRecentFiles,
    projectFileName,
    setProjectFileName,
    isDirty,
    setShowCloseConfirm,
    setShowAbout,
    setShowHelpDialog,
    setShowDepressogram,
    fileHandleRef,
    isEmptyProject,
    DEFAULT_PROJECT_NAME,
    suggestedFileName,
    openSchemeExport,
    handleSave,
    handleSaveAs,
    handleOpen,
    applyProjectData,
    handleNewProject,
    solveFireIteration,
    startFireProgress,
    finishFireProgress,
    handleSolve,
  } = c;

  return (
    <>
      {/* ═══ TITLE BAR ════════════════════════════════════════════════════ */}
      <CadTitleBar
        projectFileName={projectFileName}
        isDirty={isDirty}
        isEmptyProject={isEmptyProject}
        setShowAbout={setShowAbout}
        setShowCloseConfirm={setShowCloseConfirm}
      />

      {/* ── Демо-баннер ────────────────────────────────────────────────── */}
      {isDemo && (
        <div className="flex items-center justify-between px-3 py-1 text-[11px] font-medium select-none"
          style={{ background: "var(--c-tint-amber2, #fef3c7)", borderBottom: "1px solid #fcd34d", color: "var(--c-amber-ink, #92400e)" }}>
          <span>⚠ Демо-режим: ограничено 20 узлов, нет импорта схем, сохранения, печати и расчётов аварий</span>
          <button onClick={() => setShowLicenseDialog(true)}
            className="ml-3 px-2 py-0.5 rounded text-[10px] font-semibold text-white flex-shrink-0"
            style={{ background: "var(--c-amber-bg, #d97706)" }}>
            Активировать лицензию
          </button>
        </div>
      )}

      {/* ═══ RIBBON TABS ══════════════════════════════════════════════════ */}
      <div className="tab-bar flex items-stretch h-8 pr-1">
        <RibbonTabBtn label="Файл" active={activeRibbon === "file"} onClick={() => setActiveRibbon("file")} fileStyle />
        <RibbonTabBtn label="Главная" active={activeRibbon === "home"} onClick={() => selectRibbon("home")} />
        <RibbonTabBtn label="Схема" active={activeRibbon === "vent"} onClick={() => selectRibbon("vent")} />
        <RibbonTabBtn label="Вентиляция" active={activeRibbon === "thermo"} onClick={() => selectRibbon("thermo")} />
        <RibbonTabBtn label="Аварии" active={activeRibbon === "involve"}
          onClick={() => { if (isDemo) { setShowLicenseDialog(true); return; } selectRibbon("involve"); }}
          title={isDemo ? "Аварийные расчёты — только в полной версии" : undefined} />
        <RibbonTabBtn label="Справочники" active={activeRibbon === "general"} onClick={() => selectRibbon("general")} />
        <RibbonTabBtn label="Печать" active={false} onClick={() => setShowPrintDialog(true)} />
        <RibbonTabBtn label="Помощь" active={false} onClick={() => setShowHelpDialog(true)} />
        <div className="ml-auto pr-1 flex items-center">
          {/* Сворачивание ленты. Стрелка смотрит вниз, когда лента развёрнута
              (клик — убрать), и вверх, когда свёрнута (клик — показать). */}
          <button className="tab-icon-btn w-6 h-6 flex items-center justify-center"
            onClick={toggleRibbonCollapsed}
            title={ribbonCollapsed ? "Развернуть ленту (Ctrl+F1)" : "Свернуть ленту (Ctrl+F1)"}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d={ribbonCollapsed ? "M1 7 L5 3 L9 7" : "M1 3 L5 7 L9 3"}
                stroke="currentColor" fill="none" strokeWidth="1.3" />
            </svg>
          </button>
        </div>
      </div>

      {/* ═══ МЕНЮ ФАЙЛ (выпадающее, как в Аэросеть) ═══════════════════════ */}
      {activeRibbon === "file" && (() => {
        const sections: { id: string; label: string; separator?: boolean }[] = [
          { id: "new",       label: "Создать" },
          { id: "open",      label: "Открыть" },
          { id: "recent",    label: "Последние" },
          { id: "add",       label: "Добавить" },
          { id: "saveas",    label: "Сохранить как" },
          { id: "save",      label: "Сохранить" },
          { id: "print",     label: "Печать" },
          { id: "export",    label: "Экспорт" },
          { id: "install",   label: "Установить" },
          { id: "license",   label: isDemo ? "🔑 Лицензия" : "✓ Лицензия", separator: true },
        ];
        return (
          <div className="fixed inset-0 z-50" onClick={() => setActiveRibbon("home")}>
            <div className="absolute top-14 left-0 flex shadow-xl border border-gray-300"
              onClick={(e) => e.stopPropagation()}
              style={{ background: "var(--c-s2, #f9f9f9)", minHeight: 420, width: 580 }}>
              {/* Левая боковая панель */}
              <div className="w-36 flex flex-col text-xs border-r border-gray-300" style={{ background: "var(--c-s4, #e8e8e8)" }}>
                {sections.map((item) => (
                  <button key={item.id}
                    onClick={() => setFileSectionState(item.id)}
                    className="px-4 py-2.5 text-left hover:bg-blue-100 text-[12px]"
                    style={{
                      background: fileSectionState === item.id ? "var(--c-blue, #2563eb)" : "transparent",
                      color: fileSectionState === item.id ? "white" : "var(--c-t1, #1f1f1f)",
                      fontWeight: fileSectionState === item.id ? 600 : 400,
                    }}>
                    {item.label}
                  </button>
                ))}
                <div className="mt-auto flex flex-col border-t border-gray-400">
                  <button className="px-4 py-2 text-left text-[12px] hover:bg-gray-200 flex items-center gap-2"
                    onClick={() => { setShowSettingsDialog(true); setActiveRibbon("home"); }}>
                    <Icon name="Settings" size={13} /> Настройки
                  </button>
                  <button className="px-4 py-2 text-left text-[12px] hover:bg-red-100 text-red-600 flex items-center gap-2"
                    onClick={() => setActiveRibbon("home")}>
                    <Icon name="X" size={13} /> Закрыть
                  </button>
                </div>
              </div>

              {/* Правая область */}
              <div className="flex-1 p-4 overflow-y-auto">

                {/* ── Создать ── */}
                {fileSectionState === "new" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Создать новый проект</div>
                    <button
                      onClick={handleNewProject}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-gray-200 group">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-gray-300 group-hover:border-blue-400" style={{ background: "var(--c-s1, #fff)" }}>
                        <Icon name="FilePlus" size={22} />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Новый пустой проект</div>
                        <div className="text-[11px] text-gray-400">Очистить схему и начать с нуля</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Добавить ── */}
                {fileSectionState === "add" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Добавить схему из файла</div>
                    {[
                      { icon: "Boxes" as const,       label: "Модель АэроСеть",                 ext: ".erp — файл проекта", action: "erp" },
                      { icon: "FileText" as const,    label: "CSV из АэроСети",                 ext: "рекомендуется",  action: "csv-aero" },
                      { icon: "FileSpreadsheet" as const, label: "CSV из Вентиляция 2.0",      ext: "Вентиляция 2.0", action: "csv-vent2" },
                      { icon: "Boxes" as const,       label: "Схема Вентиляция 2.0",            ext: ".cdf3 — файл схемы", action: "cdf3" },
                      { icon: "Boxes" as const,       label: "Модель Ventsim",                  ext: ".vsm — с сопротивлениями", action: "vsm" },
                      { icon: "FileText" as const,    label: "CSV из Ventsim",                  ext: "Ventsim 5/6",    action: "csv-ventsim" },
                      { icon: "FileJson" as const,    label: "Добавить схему из файла",        ext: ".vproj / .json", action: "json" },
                      { icon: "Code" as const,        label: "Добавить схему из XML",           ext: ".xml",           action: "xml"  },
                      { icon: "Pencil" as const,      label: "Добавить схему из DXF / DWG",     ext: ".dxf, .dwg",     action: "dxf"  },
                      { icon: "FileText" as const,    label: "Добавить схему из TXT",           ext: ".txt",           action: "txt"  },
                    ].map((item) => (
                      <button key={item.label}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-blue-50 group"
                        onClick={() => {
                          // Импорт из сторонних программ — только в полной версии.
                          // В демо ведём на окно лицензии: иначе через импорт
                          // можно было обойти и лимит в 20 узлов.
                          if (isDemo && DEMO_LOCKED_IMPORTS.has(item.action)) {
                            setShowLicenseDialog(true);
                            setActiveRibbon("home");
                            return;
                          }
                          if (item.action === "erp") {
                            setShowErpImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "csv-aero") {
                            setShowCsvImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "csv-vent2") {
                            setShowVent2CsvImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "csv-ventsim") {
                            setShowVentsimCsvImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "cdf3") {
                            setShowVent2Cdf3Import(true);
                            setActiveRibbon("home");
                          } else if (item.action === "vsm") {
                            setShowVentsimVsmImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "dxf") {
                            setShowDxfImport(true);
                            setActiveRibbon("home");
                          } else {
                            const inp = document.createElement("input");
                            inp.type = "file"; inp.accept = item.ext;
                            inp.click();
                            setActiveRibbon("home");
                          }
                        }}>
                        <div className="w-8 h-8 flex items-center justify-center rounded border group-hover:border-green-400"
                          style={{
                            background: item.action === "erp" ? "var(--c-tint-green2, #dcfce7)" : item.action === "csv-aero" ? "var(--c-tint-green2, #dcfce7)" : item.action === "cdf3" ? "var(--c-tint-green2, #dcfce7)" : item.action === "vsm" ? "var(--c-tint-amber, #fef9c3)" : item.action === "csv-vent2" ? "var(--c-tint-blue2, #dbeafe)" : item.action === "csv-ventsim" ? "var(--c-tint-amber, #fef9c3)" : item.action === "combined" ? "var(--c-tint-purple, #ede9fe)" : item.action === "dxf" ? "var(--c-tint-blue2, #dbeafe)" : "var(--c-s1, #fff)",
                            borderColor: item.action === "erp" ? "#86efac" : item.action === "csv-aero" ? "#86efac" : item.action === "cdf3" ? "#86efac" : item.action === "vsm" ? "#fde047" : item.action === "csv-vent2" ? "#81b0c4" : item.action === "csv-ventsim" ? "#fde047" : item.action === "combined" ? "#a78bfa" : item.action === "dxf" ? "#81b0c4" : "var(--c-b2, #d1d5db)",
                          }}>
                          <Icon name={item.icon} size={18} />
                        </div>
                        <div>
                          <div className="text-[12px] font-medium flex items-center gap-1" style={{ color: item.action === "erp" ? "var(--c-green, #15803d)" : item.action === "csv-aero" ? "var(--c-green, #15803d)" : item.action === "csv-vent2" ? "var(--c-blue-ink, #1e40af)" : item.action === "csv-ventsim" ? "#854d0e" : item.action === "combined" ? "#5b21b6" : "var(--c-t1, #1f2937)" }}>
                            {item.label}
                            {isDemo && DEMO_LOCKED_IMPORTS.has(item.action) && (
                              <span className="px-1 rounded text-[9px] font-semibold flex-shrink-0"
                                style={{ background: "var(--c-tint-amber2, #fef3c7)", color: "var(--c-amber-ink, #92400e)", border: "1px solid #fcd34d" }}>
                                🔒 Полная версия
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {item.action === "erp" ? "✓ Схема целиком: слои, вентиляторы, перемычки, позиции ПЛА"
                            : item.action === "csv-aero" ? "✓ X,Y,Z координаты + все параметры в одном файле"
                            : item.action === "csv-vent2" ? "✓ Файл → Экспорт в CSV, настраиваемые столбцы"
                            : item.action === "csv-ventsim" ? "✓ Branch Report → Export to CSV"
                            : item.action === "combined" ? "✓ DXF координаты + Excel параметры и глубины"
                            : item.action === "dxf" ? "✓ НаноКАД, АэроСеть, AutoCAD"
                            : item.ext}
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}

                {/* ── Открыть ── */}
                {fileSectionState === "open" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Открыть проект</div>
                    <button onClick={handleOpen}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-gray-200 group">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-gray-300 group-hover:border-blue-400" style={{ background: "var(--c-s1, #fff)" }}>
                        <Icon name="FolderOpen" size={22} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Открыть файл проекта</div>
                        <div className="text-[11px] text-gray-400">Формат .vproj или .json</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Сохранить ── */}
                {fileSectionState === "save" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Сохранить проект</div>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-[11px] text-gray-600">Файл:</span>
                      {/* У нового проекта имени ещё нет — показываем его как
                          подсказку в пустом поле, а не как готовое значение. */}
                      <input type="text" value={projectFileName}
                        placeholder={DEFAULT_PROJECT_NAME}
                        onChange={(e) => setProjectFileName(e.target.value)}
                        className="flex-1 text-[12px] px-2 py-1 border border-gray-300 rounded"
                        style={{ fontFamily: "inherit" }} />
                    </div>
                    <button onClick={() => { handleSave(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-blue-200 group mb-2">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-blue-300 group-hover:border-blue-500" style={{ background: "var(--c-tint-blue2, #dbeafe)" }}>
                        <Icon name="Save" size={22} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-blue-700">Сохранить</div>
                        <div className="text-[11px] text-gray-400">Ctrl+S — скачать файл {suggestedFileName()}</div>
                      </div>
                    </button>
                    <div className="text-[11px] text-gray-500 mt-2 px-1">
                      Узлов: <b>{nodes.length}</b> · Ветвей: <b>{branchesRaw.length}</b> · Горизонтов: <b>{horizons.length}</b>
                    </div>
                  </>
                )}

                {/* ── Сохранить как ── */}
                {fileSectionState === "saveas" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Сохранить как</div>
                    <button onClick={() => { handleSaveAs(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-green-50 border border-gray-200 group mb-2">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-gray-300 group-hover:border-green-400" style={{ background: "var(--c-tint-green, #f0fdf4)" }}>
                        <Icon name="SaveAll" size={22} className="text-green-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Сохранить как новый файл</div>
                        <div className="text-[11px] text-gray-400">Выбрать имя и скачать</div>
                      </div>
                    </button>
                    <button onClick={() => { handleSave(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-blue-50 border border-gray-200 group">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300" style={{ background: "var(--c-s1, #fff)" }}>
                        <Icon name="FileJson" size={16} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Сохранить как JSON (.vproj)</div>
                        <div className="text-[10px] text-gray-400">Вся схема, горизонты, параметры</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Печать ── */}
                {fileSectionState === "print" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Печать схемы</div>
                    <button onClick={() => { openPrintDialog(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-blue-200 group mb-2">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-blue-300 group-hover:border-blue-500" style={{ background: "var(--c-tint-blue, #eff6ff)" }}>
                        <Icon name="Printer" size={22} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Просмотр и печать</div>
                        <div className="text-[11px] text-gray-400">Настройка формата, масштаба, экспорт</div>
                      </div>
                    </button>

                    <div className="text-[13px] font-semibold mb-2 mt-4 pb-1 border-b border-gray-300">Отчёты</div>
                    <button onClick={() => { handlePrintVentPipeReport(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-blue-200 group mb-2">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-blue-300 group-hover:border-blue-500" style={{ background: "var(--c-tint-blue, #eff6ff)" }}>
                        <Icon name="Wind" size={22} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Отчёт по вентставам</div>
                        <div className="text-[11px] text-gray-400">Доставка воздуха и предельная длина по забоям</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Экспорт ── */}
                {fileSectionState === "export" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Экспорт</div>
                    <button onClick={() => { handleSave(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-blue-50 border border-gray-200 group mb-1">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300">
                        <Icon name="FileJson" size={16} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Экспорт в JSON (.vproj)</div>
                        <div className="text-[10px] text-gray-400">Полный формат проекта</div>
                      </div>
                    </button>
                    <button onClick={() => { setActiveRibbon("home"); openPrintDialog(); setPrintDialogOpenExport(true); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-red-50 border border-gray-200 group mb-1">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300" style={{ background: "#fff0f0" }}>
                        <Icon name="FileText" size={16} className="text-red-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Экспорт в PDF</div>
                        <div className="text-[10px] text-gray-400">Графический план — слой печати, высокое качество</div>
                      </div>
                    </button>
                    <button onClick={() => { setActiveRibbon("home"); openSchemeExport("erp"); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-green-50 border border-gray-200 group mb-1">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300" style={{ background: "var(--c-tint-green2, #dcfce7)" }}>
                        <Icon name="Boxes" size={16} className="text-green-700" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Экспорт в АэроСеть (.erp)</div>
                        <div className="text-[10px] text-gray-400">Схема, вентиляторы, перемычки и позиции ПЛА — с выбором</div>
                      </div>
                    </button>
                    <button onClick={() => { setActiveRibbon("home"); openSchemeExport("cdf3"); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-blue-50 border border-gray-200 group mb-1">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300" style={{ background: "var(--c-tint-blue, #eaf4fc)" }}>
                        <Icon name="Network" size={16} className="text-blue-700" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Экспорт в Вентиляцию 2.0 (.cdf3)</div>
                        <div className="text-[10px] text-gray-400">Схема, сечения, горизонты и перемычки — с выбором</div>
                      </div>
                    </button>
                    <button onClick={() => { setActiveRibbon("home"); openSchemeExport("hdr"); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-blue-50 border border-gray-200 group mb-1">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300" style={{ background: "var(--c-tint-blue, #eaf4fc)" }}>
                        <Icon name="Droplets" size={16} className="text-sky-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Экспорт водоснабжения в Вентиляцию 2.0 (.hdr)</div>
                        <div className="text-[10px] text-gray-400">Трубопроводы ППЗ, задвижки, клапаны, краны и резервуары</div>
                      </div>
                    </button>
                    <button onClick={() => { setActiveRibbon("home"); setShowCsvExport(true); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-green-50 border border-gray-200 group mb-1">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300" style={{ background: "var(--c-tint-green, #f0fdf4)" }}>
                        <Icon name="Table" size={16} className="text-green-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Экспорт в CSV</div>
                        <div className="text-[10px] text-gray-400">Для ПО «АэроСеть» и «Вентиляция 2.0»</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Установить приложение (десктоп) ── */}
                {fileSectionState === "install" && (() => {
                  return (
                    <>
                      <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Установить приложение для Windows</div>
                      <div className="text-[12px] text-gray-600 mb-3 leading-relaxed">
                        Скачайте настольную версию ПВ-Система — она работает без браузера и без интернета,
                        со встроенным расчётным ядром. Ссылка всегда ведёт на самую свежую версию.
                      </div>
                      <div className="mb-3">
                        <a
                          href={INSTALLER_URL}
                          rel="noopener"
                          className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-blue-200 group no-underline">
                          <div className="w-10 h-10 flex items-center justify-center rounded border border-blue-300 group-hover:border-blue-500" style={{ background: "var(--c-tint-blue, #eff6ff)" }}>
                            <Icon name="Download" size={22} className="text-blue-600" />
                          </div>
                          <div>
                            <div className="text-[13px] font-medium text-blue-700">
                              Скачать ПВ-Система для ПК{desktopLatestVer ? ` (v${desktopLatestVer})` : ""}
                            </div>
                            <div className="text-[11px] text-gray-400">Windows 10/11 · установщик PVS-Setup.exe</div>
                          </div>
                        </a>
                      </div>
                      <div className="text-[11px] text-gray-400 leading-relaxed px-1 mb-3">
                        После загрузки запустите установщик <b>PVS-Setup.exe</b> — программа установится в
                        <b> C:\Program Files\PVS</b> (потребуется подтверждение прав администратора) и свяжет файлы
                        схем <b>.vproj</b> с приложением.
                      </div>

                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon name="ShieldAlert" size={15} className="text-amber-600 flex-shrink-0" />
                          <span className="text-[12px] font-semibold text-amber-800">Браузер или Windows блокирует загрузку?</span>
                        </div>
                        <div className="text-[11px] text-amber-700 leading-relaxed">
                          Это защита <b>SmartScreen</b>: она предупреждает о новых файлах без цифровой подписи. Установщик безопасен. Чтобы продолжить:
                          <div className="mt-1.5 space-y-1">
                            <div>• <b>При скачивании</b> (значок «Загрузки»): нажмите <b>«···» → «Сохранить»</b>, затем «Подробнее» → <b>«Всё равно сохранить»</b>.</div>
                            <div>• <b>При запуске</b> установщика: в окне «Windows защитила ваш компьютер» нажмите <b>«Подробнее» → «Выполнить в любом случае»</b>.</div>
                            <div>• Если сработал антивирус — добавьте <b>PVS-Setup.exe</b> в исключения.</div>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* ── Лицензия ── */}
                {fileSectionState === "license" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Лицензия</div>
                    {isDemo ? (
                      <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 mb-3">
                        <div className="text-[12px] font-semibold text-amber-800 mb-1">Демо-режим</div>
                        <div className="text-[11px] text-amber-700 space-y-0.5">
                          <div>• Максимум 20 узлов</div>
                          <div>• Нет сохранения файлов</div>
                          <div>• Нет расчётов аварий</div>
                          <div>• Нет печати</div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg border border-green-200 bg-green-50 mb-3">
                        <div className="text-[12px] font-semibold text-green-800 mb-1">✓ Лицензия активна</div>
                        <div className="text-[11px] text-green-700">{license.info?.owner}</div>
                        <div className="text-[11px] font-mono text-green-600">{license.info?.key}</div>
                        {license.info?.seats && (
                          <div className="text-[11px] text-green-600 mt-0.5">
                            Мест: {license.info.seats.used} / {license.info.seats.max}
                          </div>
                        )}
                      </div>
                    )}
                    <button onClick={() => { setShowLicenseDialog(true); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded hover:bg-blue-50 border border-blue-200 group">
                      <div className="w-9 h-9 flex items-center justify-center rounded border border-blue-300" style={{ background: "var(--c-tint-blue2, #dbeafe)" }}>
                        <Icon name="KeyRound" size={18} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-blue-700">{isDemo ? "Активировать лицензию" : "Управление лицензией"}</div>
                        <div className="text-[10px] text-gray-400">Ввести лицензионный ключ</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Последние файлы ── */}
                {fileSectionState === "recent" && (() => {
                  const handleOpenRecent = async (rf: typeof recentFiles[0]) => {
                    const confirmReplace = () =>
                      (nodes.length > 0 || branchesRaw.length > 0)
                        ? window.confirm("Открыть проект? Текущие данные будут заменены.")
                        : true;

                    // 1. ДЕСКТОП: читаем файл напрямую по сохранённому пути.
                    // Это главный путь для десктопной версии: ядро программы
                    // читает файл само, поэтому окно «Разрешить этому сайту
                    // просматривать и копировать…» не появляется вовсе. Раньше
                    // здесь всегда шёл файловый доступ браузера, и WebView2
                    // спрашивал разрешение при каждом открытии из списка.
                    if (rf.path) {
                      type EAPI = { readFile?: (p: string) => Promise<{ content?: string; error?: string }> };
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const eAPI = (window as any).electronAPI as EAPI | undefined;
                      if (eAPI?.readFile) {
                        try {
                          const res = await eAPI.readFile(rf.path);
                          if (res?.content) {
                            const data = JSON.parse(res.content) as Record<string, unknown>;
                            if (!confirmReplace()) return;
                            // Запоминаем путь: «Сохранить» перезапишет этот же
                            // файл, без диалога «Сохранить как».
                            filePathRef.current = rf.path;
                            fileHandleRef.current = null;
                            applyProjectData(data, rf.name, true);
                            setActiveRibbon("home");
                            return;
                          }
                        } catch {
                          // Файл переместили или удалили — пробуем прежние способы ниже.
                        }
                      }
                    }

                    // 2. Пробуем FileSystemFileHandle из IndexedDB (файл с диска).
                    // Здесь браузер и может показать окно запроса разрешения —
                    // но подменять этот путь локальной копией НЕЛЬЗЯ: копия
                    // обновляется только при открытии и после правок в другой
                    // программе окажется устаревшей. Лучше запрос разрешения,
                    // чем молча открытая старая версия схемы.
                    const handle = await loadHandleFromIDB(rf.name);
                    if (handle) {
                      try {
                        // Запрашиваем разрешение на чтение (браузер покажет системный диалог один раз)
                        const perm = await (handle as FileSystemFileHandle & {
                          queryPermission: (o: { mode: string }) => Promise<string>;
                          requestPermission: (o: { mode: string }) => Promise<string>;
                        }).queryPermission({ mode: "read" });
                        const granted = perm === "granted" ||
                          (await (handle as FileSystemFileHandle & {
                            requestPermission: (o: { mode: string }) => Promise<string>;
                          }).requestPermission({ mode: "read" })) === "granted";
                        if (granted) {
                          const file = await handle.getFile();
                          const data = JSON.parse(await file.text()) as Record<string, unknown>;
                          if (!confirmReplace()) return;
                          fileHandleRef.current = handle;
                          filePathRef.current = null;
                          applyProjectData(data, file.name, true);
                          setActiveRibbon("home");
                          return;
                        }
                      } catch (_e) {
                        // handle устарел или доступ отклонён — fallback
                      }
                    }

                    // 3. Fallback — данные из localStorage
                    const data = loadRecentData(rf.name);
                    if (data) {
                      if (!confirmReplace()) return;
                      applyProjectData(data, rf.name);
                      setActiveRibbon("home");
                      return;
                    }

                    // 4. Ничего нет — предлагаем открыть вручную
                    alert(`Файл «${rf.name}» недоступен.\nОткройте его через «Файл → Открыть» — он снова появится в списке.`);
                  };

                  // Пометка «недоступен» — только когда открыть действительно
                  // нечем. Флаг hasHandle сверяется с IndexedDB при открытии
                  // вкладки (syncHandles), поэтому здесь он уже достоверен.
                  // Файл с известным путём (десктоп) открывается всегда —
                  // его читает ядро программы, разрешение браузера не нужно.
                  // hasRecentData вместо loadRecentData: нужен лишь факт
                  // наличия копии, а не её содержимое. Прежний вариант ради
                  // одной галочки разбирал JSON всей схемы — и делал это для
                  // КАЖДОЙ строки списка при каждой перерисовке.
                  const canOpen = (rf: typeof recentFiles[0]) =>
                    !!rf.path || rf.hasHandle || hasRecentData(rf.name);

                  return (
                    <>
                      <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300 flex items-center justify-between">
                        <span>Последние файлы</span>
                        {recentFiles.length > 0 && (
                          <button onClick={clearRecentFiles}
                            className="text-[11px] text-gray-400 hover:text-red-500 transition-colors">
                            Очистить список
                          </button>
                        )}
                      </div>
                      {recentFiles.length === 0 ? (
                        <div className="text-[12px] text-gray-400 pt-6 flex flex-col items-center gap-2">
                          <Icon name="Clock" size={32} className="text-gray-300" />
                          <span>Нет недавно открытых файлов</span>
                          <span className="text-[11px] text-center text-gray-300">Откройте проект через «Открыть»,<br/>и он появится здесь</span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {recentFiles.map((rf) => {
                            const d = new Date(rf.openedAt);
                            const dateStr = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
                            const timeStr = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
                            const available = canOpen(rf);
                            return (
                              <div key={rf.name + rf.openedAt}
                                className="group flex items-center gap-2 px-2 py-2 rounded border border-transparent hover:border-blue-200 hover:bg-blue-50 transition-colors cursor-pointer"
                                onClick={() => void handleOpenRecent(rf)}>
                                <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded border"
                                  style={{ background: available ? "var(--c-tint-blue2, #dbeafe)" : "var(--c-s3, #f3f4f6)", borderColor: available ? "#81b0c4" : "var(--c-b2, #d1d5db)" }}>
                                  <Icon name="FileText" size={16} className={available ? "text-blue-500" : "text-gray-400"} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[12px] font-medium truncate group-hover:text-blue-700"
                                    style={{ color: available ? "var(--c-t1, #1e293b)" : "var(--c-t4, #9ca3af)" }}>{rf.name}</div>
                                  <div className="text-[10px] text-gray-400">
                                    {dateStr} {timeStr}
                                    {rf.nodeCount !== undefined && (
                                      <span className="ml-2">· Узлов: {rf.nodeCount} · Ветвей: {rf.branchCount ?? 0}</span>
                                    )}
                                    {(rf.path || rf.hasHandle) && <span className="ml-2 text-green-500">· с диска</span>}
                                    {!available && <span className="ml-2 text-amber-400">· недоступен</span>}
                                  </div>
                                </div>
                                {available && (
                                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                                    <span className="text-[10px] text-blue-400">Открыть</span>
                                    <Icon name="FolderOpen" size={13} className="text-blue-400" />
                                  </div>
                                )}
                                <button
                                  title="Убрать из списка"
                                  onClick={(e) => { e.stopPropagation(); removeRecentFile(rf.name); }}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 transition-all ml-1">
                                  <Icon name="X" size={12} className="text-gray-400 hover:text-red-500" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="mt-4 pt-3 border-t border-gray-200 text-[11px] text-gray-400 flex items-center gap-1.5">
                        <Icon name="Info" size={12} className="text-gray-300 flex-shrink-0" />
                        <span>Также можно перетащить .vproj файл прямо на холст схемы</span>
                      </div>
                    </>
                  );
                })()}

                {/* ── Остальные секции — заглушки ── */}
                {!["new", "add", "open", "save", "saveas", "print", "export", "install", "license", "recent"].includes(fileSectionState) && (
                  <div className="text-[12px] text-gray-400 pt-4">
                    Функция «{sections.find((s) => s.id === fileSectionState)?.label}» будет реализована.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Вкладка Вентиляция использует общий ribbon-блок с условием activeRibbon === "thermo" */}

      {/* ═══ RIBBON CONTENT: СПРАВОЧНИКИ ══════════════════════════════════ */}
      {activeRibbon === "general" && !ribbonCollapsed && (
        <RibbonReferences onOpenRef={openEquipRef} onOpenLegend={openLegend} />
      )}

      {/* ═══ RIBBON CONTENT: АВАРИИ ════════════════════════════════════════ */}
      {activeRibbon === "involve" && !ribbonCollapsed && (
      <div className="ribbon-body h-[80px] flex items-stretch px-2 py-1.5 gap-0 overflow-x-auto"
        style={{ background: "linear-gradient(180deg,var(--c-tint-red, #fff5f5),#fce8e8)", borderBottom: "1px solid #fca5a5" }}>

        {/* ── Группа: Пожар ── */}
        <RibbonGroup label="Пожар">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn
              icon="Flame"
              iconImg="icons/fire-source.png"
              label="Установить"
              sublabel="очаг пожара"
              onClick={() => { handlePickSymbol("fire_source"); setActiveRibbon("involve"); }}
              active={schemaSymbols.some(s => s.typeId === "fire_source")}
              style={{ background: schemaSymbols.some(s => s.typeId === "fire_source") ? "var(--c-tint-red2, #fee2e2)" : undefined,
                       borderColor: schemaSymbols.some(s => s.typeId === "fire_source") ? "#fca5a5" : undefined }}
            />
            <RibbonBigBtn
              icon="Trash2"
              label="Убрать"
              sublabel="очаги"
              disabled={!schemaSymbols.some(s => FIRE_SYMBOL_IDS.has(s.typeId))}
              onClick={() => {
                schemaSymbols.filter(s => FIRE_SYMBOL_IDS.has(s.typeId)).forEach(s => {
                  if (s.branchId) updateBranch(s.branchId, { hasFire: false, fireVehicleSymbolOff: false, fireComputedTemp: 0, fireComputedNatDep: 0, fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0, originalFlow: undefined });
                  removeSymbol(s.id);
                });
                setFireResult(null);
                setFireCalcDone(false);
                resetNodeFireState();
              }}
            />
          </div>
        </RibbonGroup>

        {/* ── Группа: Расчёт пожара ── */}
        <RibbonGroup label="Расчёт пожара">
          <div className="flex items-stretch gap-1">
            <button
              onClick={async () => {
                if (!solveResult) {
                  alert("Сначала выполните расчёт вентиляционной сети (F9)");
                  return;
                }

                try {
                const AMBIENT_TEMP = surfaceTemp;

                addLog("info", "🔥 Итеративный расчёт аварийного режима (учёт тепловой депрессии)...");

                // Индикатор на кнопке: плавная шкала (таймер) ползёт к ~95%
                // во время расчёта, как в воздухораспределении.
                startFireProgress();

                // Сам расчёт живёт в отдельном модуле (см. lib/fireModeRun.ts):
                // формулы и пороги перенесены дословно, здесь остаётся только
                // применение результата к схеме.
                const { flows: currentFlows, originalFlows, result } = await runFireMode({
                  branches, nodes,
                  ambientTemp: AMBIENT_TEMP,
                  thermalDepMethod,
                  smokeVisThreshold,
                  baseNodeTemps,
                  totalDepByBranch,
                  totalRByBranch,
                  solveIteration: solveFireIteration,
                  log: (m) => addLog("info", m),
                  yieldToUI: () => new Promise(r => setTimeout(r, 0)),
                });

                // Обновляем flow в state из итеративного расчёта.
                // Сохраняем originalFlow (расход до пожара) — панель «Пож.нагрузка»
                // считает по нему t продуктов (как в Аэросети).
                setBranches(prev => prev.map(b => {
                  const q = currentFlows.get(b.id);
                  return q !== undefined
                    ? { ...b, flow: q, originalFlow: originalFlows.get(b.id) ?? b.flow }
                    : b;
                }));

                // Записываем вычисленные параметры обратно в ветви
                setBranches(prev => prev.map(b => {
                  const fr = result.branches.get(b.id);
                  if (!fr) return b;
                  return { ...b,
                    fireComputedTemp: fr.airTempOut,
                    fireComputedNatDep: fr.thermalDepression,
                    fireComputedSmokeDens: fr.smokeDensity,
                    fireComputedCO: fr.coConc,
                    fireComputedCO2: fr.co2Conc,
                  };
                }));
                // Записываем расчётные концентрации CO/CO₂ и температуры в узлы
                // (распространение по сети). Для незадымлённых узлов — фоновые
                // значения: температура воздуха и стенок = температура на поверхности.
                setNodes(prev => prev.map(n => {
                  const g = result.nodeGas.get(n.id);
                  return { ...n,
                    computedCO:  g?.co ?? 0,
                    computedCO2: g?.co2 ?? 0,
                    computedAirTemp:  g?.airTemp  ?? AMBIENT_TEMP,
                    computedWallTemp: g?.wallTemp ?? AMBIENT_TEMP,
                  };
                }));
                setFireResult(result);
                setFireCalcDone(true);
                setShowSmoke(true);
                // Устанавливаем максимум шкалы: не менее 60 и не более 600 мин
                const initMax = Math.min(600, Math.max(60, Math.ceil(result.maxSmokeTime)));
                setSmokeMaxTime(initMax);
                // Ставим ползунок на максимум — сразу видно всё задымление
                setSmokeTimeMinutes(initMax);
                addLog("info", `🔥 Расчёт пожара завершён. Задымлено ветвей: ${result.branches.size}`);
                result.log.forEach(l => addLog(l.includes("⚠️") ? "warn" : "info", l));
                } catch (err) {
                  // Любая ошибка расчёта пожара НЕ должна ронять интерфейс
                  // («чёрный экран»). Логируем и показываем сообщение.
                  console.error("Ошибка расчёта пожара:", err);
                  addLog("error", `Ошибка расчёта пожара: ${err instanceof Error ? err.message : String(err)}`);
                  alert("Не удалось выполнить расчёт пожара. Проверьте параметры очага (температура/мощность) и повторите.");
                } finally {
                  finishFireProgress();
                }
              }}
              disabled={fireCalcProgress !== null || !schemaSymbols.some(s => FIRE_SYMBOL_IDS.has(s.typeId))}
              data-tone="" data-solid=""
              className="rb-btn flex flex-col items-center justify-start gap-1 disabled:opacity-40"
              style={{ minWidth: 54, height: 62, paddingTop: 3, flexShrink: 0,
                ["--rb-tone" as string]: "var(--c-red, #dc2626)",
                cursor: fireCalcProgress !== null ? "wait" : "pointer" }}
              title="Расчёт распространения задымления и тепловой депрессии">
              <span className="rb-tile">
                {fireCalcProgress !== null && <span className="rb-progress" style={{ height: `${fireCalcProgress}%` }} />}
                <img src="icons/fire-source.png" alt="Расчёт пожара" style={{ width: 20, height: 20, objectFit: "contain", position: "relative" }} />
              </span>
              <span className="rb-label" style={{ fontSize: 9.5, lineHeight: "1.15", textAlign: "center", fontWeight: 600 }}>
                {fireCalcProgress !== null
                  ? <span className="block">{fireCalcProgress}%</span>
                  : <><span className="block">Расчёт</span><span className="block">пожара</span></>}
              </span>
            </button>
            <RibbonBigBtn
              icon={showSmoke ? "EyeOff" : "Eye"}
              label={showSmoke ? "Скрыть" : "Показать"}
              sublabel="задымление"
              disabled={!fireCalcDone}
              active={showSmoke}
              onClick={() => setShowSmoke(v => !v)}
            />
            <RibbonBigBtn
              icon="RotateCcw"
              label="Сбросить"
              sublabel="пожар"
              disabled={!fireCalcDone}
              onClick={() => { setFireResult(null); setFireCalcDone(false); setBranches(prev => prev.map(b => ({ ...b, fireComputedTemp: 0, fireComputedNatDep: 0, fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0 }))); resetNodeFireState(); }}
            />
          </div>
        </RibbonGroup>

        {/* ── Группа: Метод тепловой депрессии пожара ── */}
        <RibbonGroup label="Тепловая депрессия">
          <div className="flex flex-col justify-center gap-1" style={{ minWidth: 110 }}>
            <div className="text-[10px] text-gray-600 leading-tight">Метод расчёта:</div>
            {([
              { id: "normative" as ThermalDepMethod, label: "Норматив (4.5)" },
              { id: "aerosети" as ThermalDepMethod, label: "Методика" },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => changeThermalDepMethod(opt.id)}
                className="text-[11px] px-2 py-1 rounded text-left transition-colors"
                style={{
                  background: thermalDepMethod === opt.id ? "var(--c-red-ink, #991b1b)" : "var(--c-s3, #f3f4f6)",
                  color: thermalDepMethod === opt.id ? "#fff" : "var(--c-t2, #374151)",
                  border: `1px solid ${thermalDepMethod === opt.id ? "var(--c-red-ink, #991b1b)" : "var(--c-b2, #d1d5db)"}`,
                }}
                title="Применится при следующем «Расчёте пожара»"
              >
                {thermalDepMethod === opt.id ? "● " : "○ "}{opt.label}
              </button>
            ))}
          </div>
        </RibbonGroup>

        {/* ── Группа: Взрыв ── */}
        <RibbonGroup label="Взрыв">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn
              icon="Zap"
              iconImg="icons/blast-source.png"
              label="Установить"
              sublabel="место взрыва"
              onClick={() => { handlePickSymbol("explosion_source"); setActiveRibbon("involve"); }}
              active={schemaSymbols.some(s => s.typeId === "explosion_source")}
              style={{ background: schemaSymbols.some(s => s.typeId === "explosion_source") ? "var(--c-tint-amber2, #fef3c7)" : undefined,
                       borderColor: schemaSymbols.some(s => s.typeId === "explosion_source") ? "#fcd34d" : undefined }}
            />
            <RibbonBigBtn
              icon="Trash2"
              label="Убрать"
              sublabel="очаги"
              disabled={!schemaSymbols.some(s => EXPLOSION_SYMBOL_IDS.has(s.typeId))}
              onClick={() => {
                schemaSymbols.filter(s => EXPLOSION_SYMBOL_IDS.has(s.typeId)).forEach(s => {
                  if (s.branchId) updateBranch(s.branchId, { hasExplosion: false, explosionComputedQtnt: 0, explosionComputedMaxP: 0, explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0, explosionComputedR_heavy: 0, explosionComputedR_medium: 0, explosionComputedR_light: 0, explosionComputedDeltaP: 0 });
                  removeSymbol(s.id);
                });
                setExplosionResult(null); setExplosionResultByBranch(new Map()); setExplosionBarriers(null);
                setExplosionCalcDone(false);
              }}
            />
          </div>
        </RibbonGroup>

        {/* ── Группа: Расчёт взрыва ── */}
        <RibbonGroup label="Расчёт взрыва">
          <div className="flex items-stretch gap-1">
            <button
              onClick={async () => {
                if (!branches.some(b => b.hasExplosion)) {
                  alert("Сначала установите место взрыва на ветви (кнопка «Установить место взрыва»)");
                  return;
                }
                // Сам расчёт живёт в отдельном модуле (см. lib/explosionModeRun.ts):
                // формулы и коэффициенты перенесены дословно, здесь остаётся
                // только применение результата к схеме.
                const run = await runExplosionMode({
                  branches, nodes,
                  symbols: symbolsRef.current,
                  bulkheadSymbolIds: BULKHEAD_SYMBOL_IDS,
                  explosionUrl: EXPLOSION_URL,
                  thresholds: blastThresholds,
                  // Время загазирования: 60 мин при ПЛА, ≥150 мин при
                  // ликвидации аварии (РБ №343, п. 11–12). Тот же признак,
                  // что и у прочности смеси для перемычек, — условия расчёта
                  // общие для всего документа.
                  duringEmergency: blastDuringEmergency,
                  gasZoneTimeFactual: blastGasTimeFactual,
                });
                if (!run) return;
                const { branches: finalBranches, results, resultByBranch } = run;
                setExplosionBarriers({ byBranch: run.barriers, hits: run.barrierHits });

                setBranches(finalBranches);
                if (results.length > 0) {
                  // Ни один очаг не взорвался: нулевой заряд либо смесь вне
                  // пределов взрываемости. Зоны не показываем — иначе на схеме
                  // остаётся пустая легенда с прочерками, которую легко
                  // принять за «расчёт не удался».
                  const anyExplosion = results.some(r => !r.noExplosion);
                  if (!anyExplosion) {
                    setExplosionResult(results[results.length - 1]);
                    setExplosionResultByBranch(resultByBranch);
                    setExplosionCalcDone(true);
                    setShowExplosionZones(false);
                    results.forEach(r => r.log.forEach(l => addLog("info", l)));
                    results.forEach(r => r.warnings.forEach(w => addLog("warn", w)));
                    const reason = results.find(r => r.noExplosionReason)?.noExplosionReason
                      ?? "заряд нулевой или смесь не взрывоопасна";
                    addLog("warn", `Взрыв не происходит: ${reason}. Зоны поражения не построены.`);
                    alert(`Взрыв не происходит.\n\n${reason}\n\nЗоны поражения не рассчитаны.`);
                    return;
                  }
                  const lastRes = results[results.length - 1];
                  setExplosionResult(lastRes);
                  setExplosionResultByBranch(resultByBranch);
                  setExplosionCalcDone(true);
                  setShowExplosionZones(true);
                  // Шкала волны — по САМОМУ ДАЛЬНОБОЙНОМУ очагу, иначе при
                  // нескольких взрывах зоны крупного заряда обрезались бы
                  // радиусом последнего в списке.
                  // Радиус зоны считается для ОДИНОЧНОЙ прямой выработки. По
                  // сети волна идёт дальше: ветвится, огибает, и путь до
                  // дальних выработок в разы длиннее. Раньше шкала ставилась
                  // ровно по этому радиусу и обрезала окраску на полпути —
                  // поэтому берём фактическую длину пути волны по графу.
                  const reachByGraph = Math.max(
                    0, ...Array.from(run.netWave.values(), w => w.d),
                  );
                  const safeRadius = Math.max(
                    ...results.map(r => r.zones[r.zones.length - 1]?.radius_m ?? 0),
                    reachByGraph,
                    0,
                  ) || 500;
                  const maxR = Math.max(100, Math.ceil(safeRadius / 50) * 50);
                  setBlastMaxRadius(maxR);
                  setBlastRadiusStep(maxR <= 200 ? 5 : maxR <= 500 ? 10 : 25);
                  setBlastWaveRadius(maxR);
                  const destroyed = finalBranches.filter(b => b.bulkheadDestroyedByExplosion);
                  addLog("info", `💥 Расчёт взрыва завершён. ${lastRes.vgsch ? `Eн = ${Math.round(lastRes.vgsch.En_MJ)} МДж, ΔPн = ${Math.round(lastRes.vgsch.dPn_kPa)} кПа` : `Q_тнт = ${lastRes.q_tnt_kg} кг ТНТ`}, ΔP_max = ${lastRes.maxDeltaP_kPa} кПа`);
                  if (destroyed.length > 0) {
                    addLog("warn", `⚠ Разрушено перемычек: ${destroyed.length} (${destroyed.map(b => b.id).join(", ")})`);
                  }
                  results.forEach(r => r.log.forEach(l => addLog("info", l)));
                  results.forEach(r => r.warnings.forEach(w => addLog("warn", w)));
                }
              }}
              disabled={!schemaSymbols.some(s => EXPLOSION_SYMBOL_IDS.has(s.typeId))}
              data-tone="" data-solid=""
              className="rb-btn flex flex-col items-center justify-start gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ minWidth: 54, height: 62, paddingTop: 3, flexShrink: 0, ["--rb-tone" as string]: "var(--c-amber-lt, #e8a317)" }}
              title="Расчёт параметров воздушной ударной волны">
              <span className="rb-tile">
                <img src="icons/blast-source.png" alt="Расчёт взрыва" style={{ width: 20, height: 20, objectFit: "contain" }} />
              </span>
              <span className="rb-label" style={{ fontSize: 9.5, lineHeight: "1.15", textAlign: "center", fontWeight: 600 }}>
                <span className="block">Расчёт</span><span className="block">взрыва</span>
              </span>
            </button>
            <RibbonBigBtn
              icon={showExplosionZones ? "EyeOff" : "Eye"}
              label={showExplosionZones ? "Скрыть" : "Показать"}
              sublabel="зоны взрыва"
              // Доступна и до полного расчёта: зоны строятся по предварительной
              // оценке очага, как только заданы его параметры.
              disabled={!explosionCalcDone && !explosionPreview}
              active={showExplosionZones}
              onClick={() => {
                const next = !showExplosionZones;
                setShowExplosionZones(next);
                // Шкала волны стоит на нуле, пока не было полного расчёта, —
                // без неё окраска не появится вовсе. Ставим на безопасный
                // радиус: видна вся картина поражения целиком.
                if (next && blastWaveRadius <= 0 && explosionPreview) {
                  const rMax = Math.max(
                    explosionPreview.zones.light,
                    explosionPreview.zones.medium, 1,
                  );
                  setBlastMaxRadius(Math.ceil(rMax * 1.2));
                  setBlastWaveRadius(Math.ceil(rMax * 1.2));
                }
              }}
            />
            <RibbonBigBtn
              icon="RefreshCw"
              label="Снять"
              sublabel="разрушения"
              disabled={!branches.some(b => b.bulkheadDestroyedByExplosion)}
              onClick={() => setBranches(prev => prev.map(b => ({ ...b, bulkheadDestroyedByExplosion: false })))}
            />
            <RibbonBigBtn
              icon="FileSpreadsheet"
              label="Протокол"
              sublabel="в Excel"
              disabled={!explosionCalcDone || !explosionBarriers}
              onClick={() => {
                if (!explosionBarriers) return;
                void exportExplosionReport({
                  projectName: projectFileName.replace(/\.vproj$/, "") || "Подземный рудник",
                  branches, nodes,
                  symbols: schemaSymbols,
                  resultByBranch: explosionResultByBranch,
                  barriers: explosionBarriers.byBranch,
                  barrierHits: explosionBarriers.hits,
                  duringEmergency: blastDuringEmergency,
                });
              }}
            />
            <RibbonBigBtn
              icon="Activity"
              label="Диаграмма"
              sublabel="перемычек"
              disabled={!explosionCalcDone || !explosionBarriers}
              title="Нагружение перемычек ударной волной во времени: когда приходит волна, в какой момент перемычка разрушается"
              onClick={() => setShowBlastBarrierChart(true)}
            />
            <RibbonBigBtn
              icon="BrickWall"
              label="Толщина"
              sublabel="перемычки"
              title="Калькулятор толщины взрывоустойчивой перемычки (РБ № 343, п. 25–27) с актом в Excel"
              onClick={() => setShowBlastBulkheadCalc(true)}
            />
            <RibbonBigBtn
              icon="RotateCcw"
              label="Сбросить"
              sublabel="взрыв"
              disabled={!explosionCalcDone}
              onClick={() => {
                setExplosionResult(null); setExplosionResultByBranch(new Map()); setExplosionBarriers(null);
                setExplosionCalcDone(false);
                setShowExplosionZones(false);
                setBranches(prev => prev.map(b => ({ ...b, explosionComputedQtnt: 0, explosionComputedMaxP: 0, explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0, explosionComputedR_heavy: 0, explosionComputedR_medium: 0, explosionComputedR_light: 0, explosionComputedDeltaP: 0, bulkheadDestroyedByExplosion: false })));
              }}
            />
          </div>
        </RibbonGroup>

        {/* ── Группа: Пути движения ── */}
        <RibbonGroup label="Пути движения">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn
              icon="PersonStanding"
              label="Время"
              sublabel="горнорабочего"
              style={{ width: 64 }}
              active={activeSide === "workerPath"}
              onClick={() => {
                if (activeSide === "workerPath") {
                  setActiveSide("general");
                  setWorkerPickMode(null);
                  setWorkerPathBranchIds(new Set());
                  setWorkerPathBranchDirs(new Map());
                  setWorkerPathNodeIds(new Set());
                  setWorkerStartNodeId("");
                  setWorkerTargetNodeId("");
                } else {
                  setActiveSide("workerPath");
                }
              }}
            />
            <RibbonBigBtn
              icon="ShieldCheck"
              label="Горноспа-"
              sublabel="сатели"
              active={activeSide === "rescue"}
              onClick={() => {
                if (activeSide === "rescue") {
                  setActiveSide("general");
                  setRescuePickMode(null);
                  setRescuePathBranchIds(new Set());
                  setRescuePathBranchDirs(new Map());
                  setRescuePathNodeIds(new Set());
                  setRescueStartNodeId("");
                  setRescueTargetNodeId("");
                } else {
                  setActiveSide("rescue");
                }
              }}
            />
          </div>
        </RibbonGroup>

        {/* ── Результат пожара ── */}
        {fireCalcDone && fireResult && (
          <RibbonGroup label="Результат: пожар">
            <div className="flex flex-col justify-center px-2 gap-0.5" style={{ fontSize: 10, minWidth: 148 }}>
              <div className="font-semibold" style={{ color: "var(--c-red, #b91c1c)" }}>T очага: {safeFixed(fireResult.fireTemp, 1)} °C</div>
              <div style={{ color: "var(--c-amber, #c2410c)" }}>h_t = {safeFixed(fireResult.fireThermalDep, 1)} Па</div>
              <div style={{ color: "var(--c-t2, #374151)" }}>Задымлено: {fireResult.branches.size} вет.</div>
              {fireResult.reversedBranches.size > 0
                ? <div className="font-semibold px-1 rounded" style={{ background: "var(--c-tint-red, #fef2f2)", color: "var(--c-red, #dc2626)", border: "1px solid #fca5a5" }}>⚠ Опрокид.: {fireResult.reversedBranches.size}</div>
                : <div style={{ color: "var(--c-green, #15803d)" }}>✓ Струя устойчива</div>
              }
            </div>
          </RibbonGroup>
        )}

        {/* ── Результат взрыва ── */}
        {explosionCalcDone && explosionResult && (
          <RibbonGroup label="Результат: взрыв">
            <div className="flex flex-col justify-center px-2 gap-0.5" style={{ fontSize: 10, minWidth: 148 }}>
              {explosionResult.noExplosion ? (
                // Взрыва нет — показываем причину, а не столбик нулей:
                // «Q_тнт: 0 кг, R_лет. = 0 м» читается как сбой расчёта.
                <>
                  <div className="font-semibold" style={{ color: "var(--c-t2, #374151)" }}>Взрыв не происходит</div>
                  <div style={{ color: "var(--c-amber, #c2410c)", whiteSpace: "normal", lineHeight: 1.25 }}>
                    {explosionResult.noExplosionReason ?? "заряд нулевой или смесь не взрывоопасна"}
                  </div>
                </>
              ) : (
                <>
                  {explosionResult.vgsch ? (
                    <div className="font-semibold" style={{ color: "var(--c-amber-ink, #92400e)" }}>Eн: {Math.round(explosionResult.vgsch.En_MJ)} МДж · ΔPн = {Math.round(explosionResult.vgsch.dPn_kPa)} кПа</div>
                  ) : (
                    <div className="font-semibold" style={{ color: "var(--c-amber-ink, #92400e)" }}>Q_тнт: {explosionResult.q_tnt_kg} кг</div>
                  )}
                  <div style={{ color: "var(--c-amber, #c2410c)" }}>ΔP_max = {explosionResult.maxDeltaP_kPa} кПа</div>
                  <div style={{ color: "var(--c-t2, #374151)" }}>D = {explosionResult.waveFrontSpeed_ms} м/с</div>
                  <div style={{ color: "var(--c-red, #b91c1c)" }}>R_лет. = {explosionResult.zones[0]?.radius_m ?? 0} м</div>
                </>
              )}
            </div>
          </RibbonGroup>
        )}
      </div>
      )}

      {/* ═══ RIBBON CONTENT ═══════════════════════════════════════════════ */}
      {activeRibbon !== "general" && activeRibbon !== "involve" && !ribbonCollapsed && (
      <div className="ribbon-body h-[80px] flex items-stretch px-2 py-1.5 gap-0 overflow-x-auto"
        style={{ background: "linear-gradient(180deg,var(--c-s2, #f5f5f5),var(--c-s4, #e8e8e8))", borderBottom: "1px solid #b0b0b0" }}>

        {/* ── Группа: Объекты ── */}
        <RibbonGroup label="Объекты">
          <RibbonBigBtn icon="Plus" label="Добавить" sublabel="выработку"
            onClick={() => setTool("branch")} />
          <RibbonBigBtn icon="Scissors" label="Разделить" sublabel="выработку"
            disabled={!selectedBranchId}
            onClick={() => {
              if (!selectedBranchId) return;
              const b = branches.find(br => br.id === selectedBranchId);
              if (!b) return;
              const fromN = nodes.find(n => n.id === b.fromId);
              const toN = nodes.find(n => n.id === b.toId);
              if (!fromN || !toN) return;
              const mx = (fromN.x + toN.x) / 2;
              const my = (fromN.y + toN.y) / 2;
              const mz = (fromN.z + toN.z) / 2;
              handleSplitBranchAt(selectedBranchId, mx, my, mz);
            }} />
          {/* УО Позиции ПЛА */}
          <RibbonBigBtn
            icon="MapPin"
            label="Позиция"
            sublabel="ПЛА"
            active={positionPlaceMode}
            title={selectedPositionId
              ? "Разместить маркер выбранной позиции ПЛА на схеме"
              : "Открыть позиции ПЛА: выберите или добавьте позицию"}
            onClick={() => {
              // Вкладка «Позиции» открывается всегда: там видно, какая позиция
              // выбрана и включён ли режим размещения.
              setLeftPanelOpen(true);
              setActiveSide("positions");
              if (!selectedPositionId) {
                setPositionPlaceMode(false);
                if (positions.length === 0) {
                  const pos = makePosition({ number: 1 });
                  setPositions(prev => [...prev, pos]);
                  setSelectedPositionId(pos.id);
                  setPositionPlaceMode(true);
                }
                return;
              }
              setPositionPlaceMode(v => !v);
            }} />
          {/* Текстовый блок */}
          <RibbonBigBtn
            icon="Type"
            label="Текст"
            sublabel="блок"
            active={tool === "textblock"}
            title="Добавить текстовый блок (кликните на схеме)"
            onClick={() => setTool(tool === "textblock" ? "select" : "textblock")} />
        </RibbonGroup>

        {/* ── УО: кнопка с выпадающей панелью + сетка значков прямо в ленте ── */}
        <div className="relative flex-shrink-0 h-full flex items-stretch gap-1 px-1.5 pt-1"
          style={{ borderRight: "1px solid var(--c-b2, #d0d0d0)" }}>
          <SymbolPicker
            activeSymbolTypeId={activeSymbolTypeId}
            symbolToolActive={tool === "symbol"}
            onPick={pickSymbolStable}
            onCancel={cancelSymbolStable}
          />
          {/* Сетка значков в ленте — под memo, перерисовывается только при
              смене выбранного значка. */}
          <RibbonSymbolGrid
            activeSymbolTypeId={activeSymbolTypeId}
            symbolToolActive={tool === "symbol"}
            onPick={pickSymbolStable}
          />
        </div>

        {/* ── Группа: Действия с объектами ── */}
        <RibbonGroup label="Действия">
          <RibbonBigBtn icon="Undo2" label="Отменить" sublabel="действие"
            onClick={handleUndo}
            disabled={historyRef.current.length === 0} />
        </RibbonGroup>

        {/* ── Группа: Команды вентилятора (реверс / стоп / отчёт) ── */}
        {selectedBranch?.hasFan && (
          <RibbonGroup label="Вентилятор">
              {/* Кнопки «Расчёт» здесь нет: она дублировала «Расчёт сети» в
                  соседней группе (тот же handleSolve). Пересчёт — там или по F9. */}
              {/* reverse — переключить реверс */}
              <button
                disabled={selectedBranch.fanStopped}
                onClick={() => updateBranch(selectedBranch.id, { fanReverse: !selectedBranch.fanReverse })}
                data-tone=""
                className="rb-btn flex flex-col items-center justify-start gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ minWidth: 54, height: 62, paddingTop: 3, flexShrink: 0,
                  ["--rb-tone" as string]: selectedBranch.fanReverse ? "var(--c-red, #dc2626)" : "var(--c-green, #15803d)" }}
                title="Переключить прямой / реверс">
                <span className="rb-tile"><Icon name={selectedBranch.fanReverse ? "ArrowLeft" : "ArrowRight"} size={18} /></span>
                <span className="rb-label" style={{ fontSize: 9.5, lineHeight: "1.15", textAlign: "center", fontWeight: 500 }}>
                  {selectedBranch.fanReverse ? "Реверс" : "Прямой"}
                </span>
              </button>
              {/* off — остановить/запустить */}
              <button
                onClick={() => updateBranch(selectedBranch.id, { fanStopped: !selectedBranch.fanStopped })}
                data-active={selectedBranch.fanStopped ? "1" : undefined}
                className="rb-btn flex flex-col items-center justify-start gap-1"
                style={{ minWidth: 54, height: 62, paddingTop: 3, flexShrink: 0, cursor: "pointer" }}
                title={selectedBranch.fanStopped ? "Запустить вентилятор" : "Остановить вентилятор"}>
                <span className="rb-tile"><Icon name={selectedBranch.fanStopped ? "Play" : "Square"} size={18} /></span>
                <span className="rb-label" style={{ fontSize: 9.5, lineHeight: "1.15", textAlign: "center", fontWeight: 500 }}>
                  {selectedBranch.fanStopped ? "Запуск" : "Стоп"}
                </span>
              </button>
              {/* report — диагностика */}
              <button
                onClick={() => setShowLogPanel(true)}
                disabled={!solveResult}
                className="rb-btn flex flex-col items-center justify-start gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ minWidth: 54, height: 62, paddingTop: 3, flexShrink: 0 }}
                title="Отчёт и диагностика">
                <span className="rb-tile"><Icon name="FileText" size={18} /></span>
                <span className="rb-label" style={{ fontSize: 9.5, lineHeight: "1.15", textAlign: "center", fontWeight: 500 }}>Отчёт</span>
              </button>
          </RibbonGroup>
        )}

        {/* ── Группа: ПЛА ── */}
        <RibbonGroup label="ПЛА">
          <div className="relative">
            <button
              onClick={() => setShowPlaPanel(v => !v)}
              title="План ликвидации аварии — настройки отображения позиций"
              data-active={showPlaPanel ? "1" : undefined}
              data-tone={!showPlaPanel && (showPositions || posColorInner || posColorOuter) ? "" : undefined}
              className="rb-btn flex flex-col items-center justify-start gap-1"
              style={{ minWidth: 54, height: 62, paddingTop: 3, flexShrink: 0, cursor: "pointer",
                ["--rb-tone" as string]: "var(--c-purple, #7c3aed)" }}>
              <span className="rb-tile"><Icon name="MapPin" size={18} /></span>
              <span className="rb-label flex items-center gap-0.5" style={{ fontSize: 9.5, lineHeight: "1.15", fontWeight: 500 }}>
                ПЛА<Icon name="ChevronDown" size={9} style={{ opacity: 0.6 }} />
              </span>
            </button>

            {showPlaPanel && (
              <div
                style={{
                  position: "fixed", zIndex: 9999,
                  top: 160, left: "auto",
                  background: "white", border: "1px solid var(--c-b2, #d1d5db)",
                  borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                  minWidth: 220, padding: "8px 0",
                  fontSize: 12, color: "var(--c-t1, #1a1a1a)",
                }}
                onMouseDown={e => e.stopPropagation()}
              >
                <div style={{ padding: "3px 12px 5px", fontSize: 10, fontWeight: 700, color: "var(--c-t3, #6b7280)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Отображение
                </div>

                {/* Позиции */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", cursor: "pointer" }}
                  className="hover:bg-blue-50">
                  <input type="checkbox" checked={showPositions} onChange={e => setShowPositions(e.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "#7c3aed", cursor: "pointer" }} />
                  <span>Позиции</span>
                </label>

                <div style={{ margin: "4px 12px", borderTop: "1px solid var(--c-b1, #f0f0f0)" }} />
                <div style={{ padding: "3px 12px 5px", fontSize: 10, fontWeight: 700, color: "var(--c-t3, #6b7280)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Окраска ветвей
                </div>

                {/* Цвет позиции внутри */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", cursor: "pointer" }}
                  className="hover:bg-blue-50">
                  <input type="checkbox" checked={posColorInner} onChange={e => setPosColorInner(e.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "#7c3aed", cursor: "pointer" }} />
                  <span>Цвет позиции внутри</span>
                </label>

                {/* Цвет позиции снаружи */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", cursor: "pointer" }}
                  className="hover:bg-blue-50">
                  <input type="checkbox" checked={posColorOuter} onChange={e => setPosColorOuter(e.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "#7c3aed", cursor: "pointer" }} />
                  <span>Цвет позиции снаружи</span>
                </label>

                <div style={{ margin: "4px 12px", borderTop: "1px solid var(--c-b1, #f0f0f0)" }} />
                <button onClick={() => setShowPlaPanel(false)}
                  style={{ display: "block", width: "calc(100% - 24px)", margin: "2px 12px 4px", padding: "3px 0",
                    fontSize: 11, color: "var(--c-t3, #6b7280)", background: "none", border: "none", cursor: "pointer", textAlign: "center" }}>
                  Закрыть
                </button>
              </div>
            )}
          </div>
        </RibbonGroup>

        {/* ── Группа: Расчёт сети ── */}
        <RibbonGroup label="Расчёт сети">
            {/* Кнопка запуска */}
            <button onClick={handleSolve} disabled={vcSolving}
              data-brand=""
              className="rb-btn flex flex-col items-center justify-start gap-1 disabled:opacity-100"
              style={{ minWidth: 54, height: 62, paddingTop: 3, flexShrink: 0, cursor: vcSolving ? "wait" : "pointer" }}
              title="Запустить расчёт воздухораспределения (F9)">
              <span className="rb-tile">
                {solveProgress !== null && <span className="rb-progress" style={{ height: `${solveProgress}%` }} />}
                <Icon name={vcSolving ? "Loader" : "Play"} size={18} className={`relative ${vcSolving ? "animate-spin" : ""}`} />
              </span>
              <span className="rb-label" style={{ fontSize: 9.5, lineHeight: "1.15", textAlign: "center", fontWeight: 600 }}>
                {solveProgress !== null
                  ? <span className="block">{solveProgress}%</span>
                  : <><span className="block">Расчёт</span><span className="block">сети</span></>}
              </span>
            </button>

            {/* Кнопка параметров */}
            <div className="relative">
              <button onClick={() => setShowSolverParams(v => !v)}
                data-active={showSolverParams ? "1" : undefined}
                className="rb-btn flex flex-col items-center justify-start gap-1"
                style={{ minWidth: 54, height: 62, paddingTop: 3, flexShrink: 0, cursor: "pointer" }}
                title="Параметры расчёта">
                <span className="rb-tile"><Icon name="Settings" size={18} /></span>
                <span className="rb-label" style={{ fontSize: 9.5, lineHeight: "1.15", textAlign: "center", fontWeight: 500 }}>Параметры</span>
              </button>
              {showSolverParams && (
                <SolverParamsPanel
                  values={{
                    calcMode, solverTolerance, solverMaxIter, solverAlpha,
                    useNaturalDraft, surfaceTemp, mineAirTemp, geoGradient,
                    useHumidity, surfaceHumidity, mineHumidity, surfacePressure,
                    heatingSeason,
                  }}
                  onChange={(key, val) => {
                    const setters: Record<keyof SolverParams, (x: never) => void> = {
                      calcMode: setCalcMode, solverTolerance: setSolverTolerance,
                      solverMaxIter: setSolverMaxIter, solverAlpha: setSolverAlpha,
                      useNaturalDraft: setUseNaturalDraft, surfaceTemp: setSurfaceTemp,
                      mineAirTemp: setMineAirTemp, geoGradient: setGeoGradient,
                      useHumidity: setUseHumidity, surfaceHumidity: setSurfaceHumidity,
                      mineHumidity: setMineHumidity, surfacePressure: setSurfacePressure,
                      heatingSeason: setHeatingSeason,
                    };
                    setters[key](val as never);
                  }}
                  onResetSolver={() => {
                    setSolverTolerance(SOLVER_DEFAULTS.solverTolerance);
                    setSolverMaxIter(SOLVER_DEFAULTS.solverMaxIter);
                    setSolverAlpha(SOLVER_DEFAULTS.solverAlpha);
                  }}
                  onClose={closeSolverParams}
                />
              )}
            </div>

            {/* Результат */}
            {/* Статус расчёта — главный результат работы программы, поэтому
                делаем его цветным блоком, а не мелкой серой строкой. */}
            {solveResult && (
              <div className="flex flex-col justify-center px-2 py-1 ml-1 rounded text-[9.5px]"
                style={{
                  minWidth: 92,
                  background: solveResult.ok ? "var(--c-tint-green, #f0fdf4)" : "var(--c-tint-red, #fef2f2)",
                  border: `1px solid ${solveResult.ok ? "#86efac" : "#fca5a5"}`,
                  borderLeft: `3px solid ${solveResult.ok ? "var(--c-green, #16a34a)" : "var(--c-red, #dc2626)"}`,
                }}
                title={solveResult.ok
                  ? `Расчёт сошёлся за ${solveResult.iterations} итераций`
                  : "Расчёт не сошёлся — проверьте схему на разрывы и некорректные сопротивления"}>
                <div className="flex items-center gap-1 font-bold text-[10.5px]"
                  style={{ color: solveResult.ok ? "var(--c-green, #15803d)" : "var(--c-red, #b91c1c)" }}>
                  <Icon name={solveResult.ok ? "CircleCheck" : "CircleAlert"} size={12} />
                  {solveResult.ok ? "Сошлось" : "Не сошлось"}
                </div>
                <div style={{ color: "var(--c-t3, #64748b)" }}>Ит: {solveResult.iterations}</div>
                <div style={{ color: "var(--c-t3, #64748b)" }}>|ΔH|: {solveResult.maxDeltaH?.toExponential(2)}</div>
              </div>
            )}

            {/* Данные ОПО — паспорт объекта + сводка, посчитанная по схеме */}
            <RibbonBigBtn icon="ShieldAlert" label="Данные" sublabel="ОПО"
              active={showOpoDialog}
              onClick={() => setShowOpoDialog(true)}
              title="Данные опасного производственного объекта" />
        </RibbonGroup>

        {/* ── Группа: Депрессиограмма (только во вкладке Вентиляция) ── */}
        {activeRibbon === "thermo" && (
          <RibbonGroup label="Анализ">
            <RibbonBigBtn
              icon="TrendingDown"
              label="Депрессио-"
              sublabel="грамма"
              /* Перенос слова оставлен: подпись в две строки держит высоту
                 кнопки одинаковой с соседними «Устойчивость / при пожаре». */
              title="Построить депрессиограмму главного маршрута"
              disabled={!solveResult}
              onClick={() => setShowDepressogram(true)}
            />
            <RibbonBigBtn
              icon="Calculator"
              label="Расход"
              sublabel="воздуха"
              title="Сводный расчёт количества воздуха по забоям и участкам (ФНиП № 505, п. 155) с выгрузкой в Excel"
              onClick={() => setShowAirDemand(true)}
            />
            <RibbonBigBtn
              icon="ShieldCheck"
              label="Устойчивость"
              sublabel="при пожаре"
              title="Проверка устойчивости вентиляционных режимов при пожаре и формирование Акта устойчивости"
              onClick={() => setShowFireStability(true)}
            />
            <RibbonBigBtn
              icon="Droplets"
              label="Проверка"
              sublabel="ППЗ"
              title="Пакетная проверка пожарно-оросительного трубопровода: напор и расход воды в каждой точке водоразбора, поиск худших точек сети"
              onClick={() => setShowWaterCheck(true)}
            />
            <RibbonBigBtn
              icon="Users"
              label="Зона"
              sublabel="поражения"
              title="Вывод людей при пожаре: кто попадает в зону задымления, успевают ли выйти по самоспасателю, кому нужен пункт переключения"
              onClick={() => setShowEvacRisk(true)}
            />
            <RibbonBigBtn
              icon="Lightbulb"
              label="Подбор"
              sublabel="режима"
              title="Подбор управляющих действий при пожаре: реверс и остановка вентиляторов, закрытие дверей — перебор с проверкой каждого варианта полным расчётом пожарного режима"
              onClick={() => setShowFireControl(true)}
            />
            <RibbonBigBtn
              icon="Gauge"
              label="ВДС"
              sublabel=""
              title="Воздушно-депрессионная съёмка: эквивалентное отверстие шахты и Отчёт ВДС (по коду доступа)"
              onClick={() => setShowVds(true)}
            />
            <RibbonBigBtn
              icon="TriangleAlert"
              label="Взрыво-"
              sublabel="опасность"
              /* Перенос слова оставлен намеренно: подпись в две строки держит
                 высоту кнопки вровень с соседними. */
              title="Взрывоопасность рудничной атмосферы по составу пробы: Приложение № 11 к ФНП (приказ Ростехнадзора от 11.12.2020 № 520) — формулы (1)–(5), треугольники взрываемости рис. 1–6, протокол расчёта"
              onClick={() => setShowExplosibility(true)}
            />
          </RibbonGroup>
        )}

        {/* ── Группа: Маршруты профилактического обследования (МПО) ── */}
        {activeRibbon === "thermo" && (
          <RibbonGroup label="Обследование">
            <RibbonBigBtn
              icon="Route"
              label="Маршрут"
              sublabel="МПО"
              active={activeSide === "inspection"}
              title="Маршруты профилактического обследования: выбор выработок на схеме, длина и время обхода, время на обследование пожарных кранов"
              onClick={() => {
                setLeftPanelOpen(true);
                if (activeSide === "inspection") {
                  setInspectionBindMode(v => !v && !!selectedInspectionRouteId);
                  return;
                }
                setActiveSide("inspection");
              }}
            />
          </RibbonGroup>
        )}

        {/* ── Группа: Сравнение схем (только во вкладке Схема) ── */}
        {activeRibbon === "vent" && (<>
          <RibbonGroup label="Преобразования координат">
            <RibbonBigBtn
              icon="Move"
              label="Перемещение"
              sublabel="схемы"
              title="Сдвинуть схему по осям X, Y, Z. Форма схемы и длины выработок не меняются"
              onClick={() => setShowMoveSchema(true)}
            />
            <RibbonBigBtn
              icon="TrendingDown"
              label="Наклонный"
              sublabel="съезд"
              title={
                "Разложить высотные отметки по нарисованной трассе съезда.\n"
                + "Обведите съезд по подложке, выделите выработки (Ctrl+клик),\n"
                + "задайте отметки начала и конца — уклон проверяется по нормам\n"
                + "подземного транспорта. Здесь же строится спиральный съезд."
              }
              onClick={() => setShowRampDialog(true)}
            />
          </RibbonGroup>
          <RibbonGroup label="Сравнение">
            <RibbonBigBtn
              icon="GitCompare"
              label="Сравнение"
              sublabel="схем"
              title="Сравнить текущую схему с другим файлом проекта"
              active={activeSide === "compare" && leftPanelOpen}
              onClick={() => setCompareShowDialog(true)}
            />
          </RibbonGroup>
          {compareResult && (
            <RibbonGroup label="Результат сравнения">
              <div className="flex flex-col justify-center px-2 text-[10px] gap-0.5 min-w-[140px]">
                <div className="font-semibold text-blue-700 truncate max-w-[130px]" title={compareResult.fileName}>↔ {compareResult.fileName}</div>
                <div className="flex gap-2">
                  <span style={{ color: "var(--c-amber-lt, #f59e0b)" }}>● {compareResult.branches.filter(b => b.status === "changed").length} изм.</span>
                  <span style={{ color: "var(--c-green-lt, #22c55e)" }}>● {compareResult.branches.filter(b => b.status === "added").length} доб.</span>
                  <span style={{ color: "var(--c-red-lt, #ef4444)" }}>● {compareResult.branches.filter(b => b.status === "removed").length} уд.</span>
                </div>
                <div className="flex gap-1 mt-0.5">
                  <button
                    onClick={() => { setActiveSide("compare"); setLeftPanelOpen(true); }}
                    className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                    style={{ background: activeSide === "compare" ? "var(--c-blue, #2563eb)" : "var(--c-s4, #e5e7eb)", color: activeSide === "compare" ? "white" : "var(--c-t2, #374151)" }}>
                    Показать панель
                  </button>
                  <button
                    onClick={() => { setCompareResult(null); setCompareSelectedId(null); }}
                    className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                    style={{ background: "var(--c-tint-red2, #fee2e2)", color: "var(--c-red, #dc2626)" }}>
                    Сбросить
                  </button>
                </div>
              </div>
            </RibbonGroup>
          )}
        </>)}

        {/* ── Группа: Анализ ── */}
        <RibbonGroup label="Анализ">
            <button
              onClick={() => setShowExcelExport(true)}
              data-tone=""
              className="rb-btn flex flex-col items-center justify-start gap-1"
              style={{ minWidth: 54, height: 62, paddingTop: 3, flexShrink: 0, cursor: "pointer", ["--rb-tone" as string]: "var(--c-green, #15803d)" }}
              title="Экспорт параметров выработок в Excel">
              <span className="rb-tile"><Icon name="FileSpreadsheet" size={18} /></span>
              <span className="rb-label" style={{ fontSize: 9.5, lineHeight: "1.15", textAlign: "center", fontWeight: 500 }}>
                <span className="block">Экспорт</span><span className="block">в Excel</span>
              </span>
            </button>
        </RibbonGroup>

      </div>
      )}
    </>
  );
}
