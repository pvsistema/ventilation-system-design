import HQFireDiagramDialog from "@/components/cad/HQFireDiagramDialog";
import AirDemandDialog from "@/components/cad/AirDemandDialog";
import OpoDataDialog from "@/components/cad/OpoDataDialog";
import CadImportDialogs from "./CadImportDialogs";
import CsvExportDialog from "@/components/cad/CsvExportDialog";
import SchemeExportDialog from "@/components/cad/SchemeExportDialog";
import CadToolDialogs from "./CadToolDialogs";
import CadModals from "./CadModals";
import BlastBulkheadCalcDialog from "@/components/cad/BlastBulkheadCalcDialog";
import BlastBarrierChartDialog from "@/components/cad/BlastBarrierChartDialog";
import type { CadPageState } from "./useCadPage";

// Диалоги и модальные окна страницы CAD.
export default function CadDialogs({ c }: { c: CadPageState }) {
  const {
    license,
    isDemo,
    showLicenseDialog,
    setShowLicenseDialog,
    showSettingsDialog,
    setShowSettingsDialog,
    setActiveRibbon,
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
    branchesRaw,
    textBlocks,
    pushHistory,
    setSelectedNodeId,
    selectedBranchId,
    setSelectedBranchId,
    setTool,
    movedNodeCount,
    resetSurveyDialog,
    setResetSurveyDialog,
    branches,
    opoSummary,
    selectedBranch,
    updateBranch,
    horizons,
    renumberAll,
    buildVentPipeLine,
    deleteVentPipeLine,
    resetAllNodesToSurvey,
    showMoveSchema,
    setShowMoveSchema,
    handleMoveSchema,
    showRampDialog,
    setShowRampDialog,
    applyRampZ,
    buildSpiralRamp,
    showVentPipeDialog,
    setShowVentPipeDialog,
    ventPipeBranchIds,
    showMultiBranchProps,
    setShowMultiBranchProps,
    explosionResultByBranch,
    explosionCalcDone,
    explosionBarriers,
    explosionPreview,
    hqDialogData,
    setHqDialogData,
    solveResult,
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
    flowDisplay,
    colorMode,
    scaleSettingsOpen,
    setScaleSettingsOpen,
    scaleLimitsEnabled,
    setScaleLimitsEnabled,
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
    setCompareResult,
    compareLoading,
    setCompareLoading,
    setCompareFilter,
    setCompareSelectedId,
    compareShowDialog,
    setCompareShowDialog,
    setFocusNonce,
    setFocusNodeId,
    setFocusBranchId,
    setFocusPos,
    setFocusScreenReq,
    setBlastHighlightPos,
    savedViewStateRef,
    positions,
    inspectionRoutes,
    inspectionIsolate,
    showPositions,
    posColorInner,
    posColorOuter,
    branchWidth,
    branchBorder,
    thinLines,
    colorByHorizon,
    showFlowArrows,
    pollutionThreshold,
    setPollutionThreshold,
    infoConfig,
    zScale,
    xyScale,
    unitsConfig,
    setUnitsConfig,
    schemaSymbols,
    bulkheadRByBranch,
    branchesWithTotalDep,
    vdsBulkheads,
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
    showVentSections,
    setShowVentSections,
    showAirDemand,
    setShowAirDemand,
    ventSectionColors,
    selectedSymbolId,
    setSelectedSymbolId,
    setSelectedSymbolIds,
    setActiveSymbolTypeId,
    squadDialog,
    setSquadDialog,
    squadCount,
    setSquadCount,
    addSymbol,
    setLeftPanelOpen,
    showPrintDialog,
    setShowPrintDialog,
    printDialogOpenExport,
    setPrintDialogOpenExport,
    liveCanvasRef,
    canvasSize,
    showRenumberDialog,
    setShowRenumberDialog,
    showSelectSimilar,
    setShowSelectSimilar,
    deleteBranchDialog,
    setDeleteBranchDialog,
    mergeNodeDialog,
    setMergeNodeDialog,
    selectedBranchIds,
    setSelectedBranchIds,
    selectedNodeIds,
    setSelectedNodeIds,
    moveSchemaCounts,
    branchParamBuffer,
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
    projectFileName,
    showCloseConfirm,
    setShowCloseConfirm,
    showAbout,
    setShowAbout,
    showHelpDialog,
    setShowHelpDialog,
    showDepressogram,
    setShowDepressogram,
    setDepressogramHighlight,
    depressogramPickMode,
    setDepressogramPickMode,
    depressogramManualBranches,
    setDepressogramManualBranches,
    fireControlPreview,
    suggestedFileName,
    handleSchemeExport,
    handleSave,
    ctxMenu,
    setCtxMenu,
    buildFireControlContext,
    applyFireControlActions,
    previewFireControlVariant,
    exportFireControlToPla,
    computeFireStabilityFacts,
    mergeAdjacentBranches,
    doDeleteNode,
    confirmDeleteBranches,
    handleCtxAction,
  } = c;

  return (
    <>
    {/* Сводный расчёт количества воздуха (ФНиП № 505, п. 155) */}
    {showAirDemand && (
      <AirDemandDialog
        branches={branches}
        sections={ventSections}
        norms={ventNorms}
        projectName={suggestedFileName()}
        onSelectBranch={(id) => {
          setSelectedNodeId(null);
          setSelectedNodeIds(new Set());
          setSelectedBranchId(id);
          setSelectedBranchIds(new Set([id]));
          setActiveSide("airdemand");
          setShowAirDemand(false);
        }}
        onClose={() => setShowAirDemand(false)}
      />
    )}

    {showBlastBarrierChart && explosionBarriers && (
      <BlastBarrierChartDialog
        branches={branches}
        symbols={schemaSymbols}
        barriers={explosionBarriers.byBranch}
        hits={explosionBarriers.hits}
        resultByBranch={explosionResultByBranch}
        onFocusBarrier={(bar, dialogRect) => {
          // Точка перемычки: доля t вдоль выработки (как у значка на схеме)
          const br = branches.find(b => b.id === bar.branchId);
          const fN = br ? nodes.find(n => n.id === br.fromId) : undefined;
          const tN = br ? nodes.find(n => n.id === br.toId) : undefined;
          if (!fN || !tN) return;
          const t = bar.t;
          const pos = { x: fN.x + (tN.x - fN.x) * t, y: fN.y + (tN.y - fN.y) * t, z: fN.z + (tN.z - fN.z) * t };
          const isSym = schemaSymbols.some(s => s.id === bar.key);
          setSelectedNodeId(null);
          setSelectedBranchId(bar.branchId);
          setSelectedBranchIds(new Set([bar.branchId]));
          setSelectedSymbolId(isSym ? bar.key : null);
          setSelectedSymbolIds(new Set());
          setBlastHighlightPos(pos);
          // Ставим перемычку в центр ВИДИМОЙ части схемы — той, что не закрыта окном диаграммы
          const nonce = Date.now();
          const cv = liveCanvasRef.current?.getBoundingClientRect();
          if (cv && cv.width > 0 && dialogRect) {
            const leftFree = Math.max(0, Math.min(dialogRect.left, cv.right) - cv.left);
            const rightFree = Math.max(0, cv.right - Math.max(dialogRect.right, cv.left));
            const overlapsX = dialogRect.left < cv.right && dialogRect.right > cv.left;
            let x = cv.width / 2;
            if (overlapsX && Math.max(leftFree, rightFree) >= 150) {
              x = leftFree >= rightFree ? leftFree / 2 : cv.width - rightFree / 2;
            }
            setFocusScreenReq({ nonce, x, y: cv.height / 2 });
          } else {
            setFocusScreenReq(null);
          }
          setFocusNodeId(null);
          setFocusBranchId(null);
          setFocusPos(pos);
          setFocusNonce(nonce);
        }}
        onClose={() => { setShowBlastBarrierChart(false); setBlastHighlightPos(null); }}
      />
    )}

    {showBlastBulkheadCalc && (
      <BlastBulkheadCalcDialog
        projectName={projectFileName.replace(/\.vproj$/, "") || "Подземный рудник"}
        branches={branches}
        nodes={nodes}
        symbols={schemaSymbols}
        barriers={explosionCalcDone && explosionBarriers ? explosionBarriers.byBranch : null}
        hits={explosionCalcDone && explosionBarriers ? explosionBarriers.hits : null}
        previewPressureAt={explosionPreview?.pressureAt}
        initialBranchId={selectedBranchId}
        mixId={blastMixId}
        onMixId={setBlastMixId}
        mixCustomR={blastMixCustomR}
        onMixCustomR={setBlastMixCustomR}
        duringEmergency={blastDuringEmergency}
        onDuringEmergency={setBlastDuringEmergency}
        onClose={() => setShowBlastBulkheadCalc(false)}
      />
    )}

    <CadImportDialogs
      nodes={nodes}
      branches={branches}
      horizons={horizons}
      schemaSymbols={schemaSymbols}
      bulkheadRByBranch={bulkheadRByBranch}
      projectFileName={suggestedFileName()}
      unitsConfig={unitsConfig}
      ventNorms={ventNorms}
      setVentNorms={setVentNorms}
      blastThresholds={blastThresholds}
      setBlastThresholds={setBlastThresholds}
      ventSections={ventSections}
      setVentSections={setVentSections}
      showVentSections={showVentSections}
      setShowVentSections={setShowVentSections}
      showDxfImport={showDxfImport}
      setShowDxfImport={setShowDxfImport}
      handleDxfImport={handleDxfImport}
      showExcelImport={showExcelImport}
      setShowExcelImport={setShowExcelImport}
      handleExcelImport={handleExcelImport}
      showExcelExport={showExcelExport}
      setShowExcelExport={setShowExcelExport}
      showCombinedImport={showCombinedImport}
      setShowCombinedImport={setShowCombinedImport}
      handleCombinedImport={handleCombinedImport}
      showCsvImport={showCsvImport}
      setShowCsvImport={setShowCsvImport}
      handleCsvImport={handleCsvImport}
      showVent2CsvImport={showVent2CsvImport}
      setShowVent2CsvImport={setShowVent2CsvImport}
      handleVent2CsvImport={handleVent2CsvImport}
      showVentsimCsvImport={showVentsimCsvImport}
      setShowVentsimCsvImport={setShowVentsimCsvImport}
      handleVentsimCsvImport={handleVentsimCsvImport}
      showErpImport={showErpImport}
      setShowErpImport={setShowErpImport}
      handleErpImport={handleErpImport}
      showVent2Cdf3Import={showVent2Cdf3Import}
      setShowVent2Cdf3Import={setShowVent2Cdf3Import}
      handleVent2Cdf3Import={handleVent2Cdf3Import}
      showVentsimVsmImport={showVentsimVsmImport}
      setShowVentsimVsmImport={setShowVentsimVsmImport}
      handleVentsimVsmImport={handleVentsimVsmImport}
      showEquipRef={showEquipRef}
      setShowEquipRef={setShowEquipRef}
      equipRefTab={equipRefTab}
      setEquipRefTab={setEquipRefTab}
      mineFans={mineFans}
      setMineFans={setMineFans}
      mineBulkheads={mineBulkheads}
      setMineBulkheads={setMineBulkheads}
      mineTypes={mineTypes}
      setMineTypes={setMineTypes}
      setUnitsConfig={setUnitsConfig}
      showLogPanel={showLogPanel}
      setShowLogPanel={setShowLogPanel}
      logEntries={logEntries}
      setLogEntries={setLogEntries}
      ctxMenu={ctxMenu}
      setCtxMenu={setCtxMenu}
      handleCtxAction={handleCtxAction}
      branchParamBuffer={branchParamBuffer}
      selectedNodeIds={selectedNodeIds}
      selectedBranchIds={selectedBranchIds}
    />

    {/* Увеличенный просмотр h–Q диаграммы пожара + экспорт в Excel */}
    {hqDialogData && (
      <HQFireDiagramDialog
        open
        onClose={() => setHqDialogData(null)}
        data={hqDialogData}
        branchName={hqDialogData.branchName}
      />
    )}

    {schemeExportFormat && (
      <SchemeExportDialog
        format={schemeExportFormat}
        nodes={nodes}
        branches={branches}
        horizons={horizons}
        positions={positions}
        onExport={o => handleSchemeExport(schemeExportFormat, o)}
        onClose={() => setSchemeExportFormat(null)}
      />
    )}

    {showCsvExport && (
      <CsvExportDialog
        nodes={nodes}
        branches={branches}
        positions={positions}
        horizons={horizons}
        bulkheadRByBranch={bulkheadRByBranch}
        projectName={suggestedFileName().replace(/\.vproj$/, "")}
        coordOrigin={c.coordOrigin}
        onClose={() => setShowCsvExport(false)}
      />
    )}

    <CadToolDialogs
      nodes={nodes}
      branches={branches}
      branchesRaw={branchesRaw}
      branchesWithTotalDep={branchesWithTotalDep}
      horizons={horizons}
      projectFileName={suggestedFileName()}
      unitsConfig={unitsConfig}
      showLegend={showLegend}
      setShowLegend={setShowLegend}
      showPrintDialog={showPrintDialog}
      setShowPrintDialog={setShowPrintDialog}
      schemaSymbols={schemaSymbols}
      savedViewStateRef={savedViewStateRef}
      canvasSize={canvasSize}
      branchWidth={branchWidth}
      branchBorder={branchBorder}
      thinLines={thinLines}
      colorByHorizon={colorByHorizon}
      showFlowArrows={showFlowArrows}
      flowDisplay={flowDisplay}
      textBlocks={textBlocks}
      infoConfig={infoConfig}
      zScale={zScale}
      colorMode={colorMode === "horizon" ? "none" : colorMode}
      sectionColors={ventSectionColors}
      posColorInner={posColorInner}
      posColorOuter={posColorOuter}
      positions={positions}
      showPositions={showPositions}
      inspectionRoutes={inspectionRoutes}
      inspectionIsolate={inspectionIsolate}
      scaleLimitsEnabled={scaleLimitsEnabled}
      widthBySectionOn={widthBySectionOn}
      scaleBranchMin={scaleBranchMin}
      scaleBranchMax={scaleBranchMax}
      scalePositionMin={scalePositionMin}
      scalePositionMax={scalePositionMax}
      positionGostMm={positionGostMm}
      xyScale={xyScale}
      bulkheadScale={bulkheadScale}
      fanScale={fanScale}
      printDialogOpenExport={printDialogOpenExport}
      setPrintDialogOpenExport={setPrintDialogOpenExport}
      showRenumberDialog={showRenumberDialog}
      showMoveSchema={showMoveSchema}
      setShowMoveSchema={setShowMoveSchema}
      moveSchemaCounts={moveSchemaCounts}
      onMoveSchema={handleMoveSchema}
      coordOrigin={c.coordOrigin}
      onSetCoordOrigin={c.handleSetCoordOrigin}
      selectedNodeNumber={c.selectedNodeId ? (nodes.find(n => n.id === c.selectedNodeId)?.number ?? "") : ""}
      setShowRenumberDialog={setShowRenumberDialog}
      renumberAll={renumberAll}
      showSelectSimilar={showSelectSimilar}
      setShowSelectSimilar={setShowSelectSimilar}
      selectedBranch={selectedBranch}
      selectedSymbolId={selectedSymbolId}
      setSelectedBranchId={setSelectedBranchId}
      setSelectedBranchIds={setSelectedBranchIds}
      setSelectedNodeId={setSelectedNodeId}
      setSelectedSymbolId={setSelectedSymbolId}
      setSelectedSymbolIds={setSelectedSymbolIds}
      showDepressogram={showDepressogram}
      setShowDepressogram={setShowDepressogram}
      setDepressogramHighlight={setDepressogramHighlight}
      setDepressogramBlockers={c.setDepressogramBlockers}
      depressogramPickMode={depressogramPickMode}
      setDepressogramPickMode={setDepressogramPickMode}
      depressogramManualBranches={depressogramManualBranches}
      setDepressogramManualBranches={setDepressogramManualBranches}
      showFireStability={showFireStability}
      setShowFireStability={setShowFireStability}
      showWaterCheck={showWaterCheck}
      setShowWaterCheck={setShowWaterCheck}
      showEvacRisk={showEvacRisk}
      setShowEvacRisk={setShowEvacRisk}
      showFireControl={showFireControl}
      setShowFireControl={setShowFireControl}
      buildFireControlContext={buildFireControlContext}
      applyFireControlActions={applyFireControlActions}
      previewFireControlVariant={previewFireControlVariant}
      exportFireControlToPla={exportFireControlToPla}
      fireControlPreviewActive={!!fireControlPreview}
      showVds={showVds}
      setShowVds={setShowVds}
      vdsBulkheads={vdsBulkheads}
      showExplosibility={showExplosibility}
      setShowExplosibility={setShowExplosibility}
      solveResult={solveResult}
      computeFireStabilityFacts={computeFireStabilityFacts}
      showLicenseDialog={showLicenseDialog}
      setShowLicenseDialog={setShowLicenseDialog}
      showSettingsDialog={showSettingsDialog}
      setShowSettingsDialog={setShowSettingsDialog}
      pollutionThreshold={pollutionThreshold}
      setPollutionThreshold={setPollutionThreshold}
      license={license}
      isDemo={isDemo}
      showMultiBranchProps={showMultiBranchProps}
      setShowMultiBranchProps={setShowMultiBranchProps}
      selectedBranchIds={selectedBranchIds}
      pushHistory={pushHistory}
      updateBranch={updateBranch}
      showVentPipeDialog={showVentPipeDialog}
      setShowVentPipeDialog={setShowVentPipeDialog}
      ventPipeBranchIds={ventPipeBranchIds}
      buildVentPipeLine={buildVentPipeLine}
      deleteVentPipeLine={deleteVentPipeLine}
      showRampDialog={showRampDialog}
      setShowRampDialog={setShowRampDialog}
      onApplyRampZ={applyRampZ}
      onBuildSpiral={buildSpiralRamp}
      showHelpDialog={showHelpDialog}
      setShowHelpDialog={setShowHelpDialog}
    />

    {showOpoDialog && (
      <OpoDataDialog
        data={opoData}
        onChange={setOpoData}
        summary={opoSummary}
        horizons={horizons}
        onClose={() => setShowOpoDialog(false)}
      />
    )}

    <CadModals
      nodes={nodes}
      branches={branches}
      branchesRaw={branchesRaw}
      projectFileName={suggestedFileName()}
      scaleSettingsOpen={scaleSettingsOpen}
      setScaleSettingsOpen={setScaleSettingsOpen}
      scaleTextMin={scaleTextMin}
      setScaleTextMin={setScaleTextMin}
      scaleTextMax={scaleTextMax}
      setScaleTextMax={setScaleTextMax}
      scaleBranchMin={scaleBranchMin}
      setScaleBranchMin={setScaleBranchMin}
      scaleBranchMax={scaleBranchMax}
      setScaleBranchMax={setScaleBranchMax}
      widthBySectionOn={widthBySectionOn}
      setWidthBySectionOn={setWidthBySectionOn}
      tube3dOn={tube3dOn}
      setTube3dOn={setTube3dOn}
      scalePositionMin={scalePositionMin}
      setScalePositionMin={setScalePositionMin}
      scalePositionMax={scalePositionMax}
      setScalePositionMax={setScalePositionMax}
      positionGostMm={positionGostMm}
      setPositionGostMm={setPositionGostMm}
      bulkheadScale={bulkheadScale}
      setBulkheadScale={setBulkheadScale}
      fanScale={fanScale}
      setFanScale={setFanScale}
      setScaleLimitsEnabled={setScaleLimitsEnabled}
      resetSurveyDialog={resetSurveyDialog}
      setResetSurveyDialog={setResetSurveyDialog}
      resetAllNodesToSurvey={resetAllNodesToSurvey}
      movedNodeCount={movedNodeCount}
      nodeCount={nodes.length}
      deleteBranchDialog={deleteBranchDialog}
      setDeleteBranchDialog={setDeleteBranchDialog}
      confirmDeleteBranches={confirmDeleteBranches}
      mergeNodeDialog={mergeNodeDialog}
      setMergeNodeDialog={setMergeNodeDialog}
      doDeleteNode={doDeleteNode}
      mergeAdjacentBranches={mergeAdjacentBranches}
      squadDialog={squadDialog}
      setSquadDialog={setSquadDialog}
      squadCount={squadCount}
      setSquadCount={setSquadCount}
      addSymbol={addSymbol}
      setTool={setTool}
      setActiveSymbolTypeId={setActiveSymbolTypeId}
      showCloseConfirm={showCloseConfirm}
      setShowCloseConfirm={setShowCloseConfirm}
      handleSave={handleSave}
      showAbout={showAbout}
      setShowAbout={setShowAbout}
      compareShowDialog={compareShowDialog}
      setCompareShowDialog={setCompareShowDialog}
      compareLoading={compareLoading}
      setCompareLoading={setCompareLoading}
      setCompareResult={setCompareResult}
      setCompareFilter={setCompareFilter}
      setCompareSelectedId={setCompareSelectedId}
      setActiveSide={setActiveSide}
      setLeftPanelOpen={setLeftPanelOpen}
      setActiveRibbon={setActiveRibbon}
    />




    </>
  );
}