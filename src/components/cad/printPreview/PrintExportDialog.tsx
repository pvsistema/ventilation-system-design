// ─────────────────────────────────────────────────────────────────────────────
// PrintExportDialog.tsx — окно экспорта схемы: выбор формата (PNG/JPG/BMP/
// SVG/PDF), разрешения в точках на дюйм и качества сжатия.
//
// Оформление — в стиле темы программы (printUi.tsx).
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import Icon from "@/components/ui/icon";
import { fitDpiToCanvas } from "@/lib/canvasLimits";
import { PHeader } from "@/components/cad/printPreview/printUi";

// Набор форматов — ровно тот же, что в состоянии PrintDialog.
type ExportFormat = "png" | "png-hq" | "jpg" | "bmp" | "tiff" | "svg" | "pdf" | "pdf-vector";

interface PrintExportDialogProps {
  exportFormat: ExportFormat;
  setExportFormat: React.Dispatch<React.SetStateAction<ExportFormat>>;
  exportDpi: number;
  setExportDpi: (v: number) => void;
  exportQuality: number;
  setExportQuality: (v: number) => void;
  pdfExporting: boolean;
  handleExport: () => void;
  setShowExportDialog: (v: boolean) => void;
  paper: { w: number; h: number };
}

export default function PrintExportDialog({
  exportFormat, setExportFormat, exportDpi, setExportDpi,
  exportQuality, setExportQuality, pdfExporting, handleExport, setShowExportDialog, paper,
}: PrintExportDialogProps) {
  return (
<div className="fixed inset-0 z-[10000] flex items-center justify-center"
  style={{ background: "rgba(0,0,0,0.45)", pointerEvents: "auto" }}>
  <div className="overflow-hidden"
    style={{ width: 420, fontFamily: "var(--font-ui)", background: "var(--c-s1)", border: "1px solid var(--c-b3)", borderRadius: 8, boxShadow: "0 16px 48px -12px rgba(0,0,0,.45)" }}>

    <PHeader icon="Download" title="Экспорт в файл" subtitle={`Лист ${paper.w}×${paper.h} мм`}
      onClose={() => setShowExportDialog(false)} />

    <div className="p-5 space-y-4">
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--c-t2)", marginBottom: 8 }}>Формат файла:</div>
        <div className="grid grid-cols-3 gap-2">
          {(["png","png-hq","jpg","bmp","tiff","svg","pdf","pdf-vector"] as const).map(f => (
            <button key={f} onClick={() => setExportFormat(f)}
              className="py-1.5 rounded border text-[12px] font-semibold uppercase"
              style={{
                background: exportFormat === f ? "var(--c-accent)" : "var(--c-s1)",
                color: exportFormat === f ? "#fff" : "var(--c-t2)",
                borderColor: exportFormat === f ? "var(--c-accent)" : "var(--c-b2)",
              }}>
              {f === "pdf-vector" ? "PDF ✦" : f === "png-hq" ? "PNG ★" : f.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--c-t3)", marginTop: 6 }}>
          {exportFormat === "png"        && "PNG — растр, без потерь. Рекомендуется для экрана."}
          {exportFormat === "png-hq"     && <span style={{ color: "var(--c-green)", fontWeight: 600 }}>PNG ★ — лист печати в выбранном DPI, точно как в предпросмотре. Для широкоформатной печати.</span>}
          {exportFormat === "jpg"        && "JPEG — растр, с потерями, меньше размер"}
          {exportFormat === "bmp"        && "BMP — растр, без сжатия"}
          {exportFormat === "tiff"       && "TIFF — растр, для полиграфии"}
          {exportFormat === "svg"        && "SVG — вектор, точно как в предпросмотре, масштаб бесконечен"}
          {exportFormat === "pdf"        && "PDF — растровый, все страницы, выбранный DPI"}
          {exportFormat === "pdf-vector" && "PDF ✦ — векторный, все листы, точно как в предпросмотре. Формируется в программе, без сервера."}
        </div>
      </div>

      {!["svg", "pdf-vector"].includes(exportFormat) && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--c-t2)", marginBottom: 8 }}>Разрешение (DPI):</div>
          <div className="flex gap-2 mb-2">
            {[72,96,150,300,600].map(d => (
              <button key={d} onClick={() => setExportDpi(d)}
                className="flex-1 py-1 rounded border text-[11px] font-medium"
                style={{
                  background: exportDpi === d ? "var(--c-accent)" : "var(--c-s1)",
                  color: exportDpi === d ? "#fff" : "var(--c-t2)",
                  borderColor: exportDpi === d ? "var(--c-accent)" : "var(--c-b2)",
                }}>{d}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 11.5, color: "var(--c-t3)" }}>Своё:</span>
            <input type="number" min={36} max={1200} value={exportDpi}
              onChange={e => setExportDpi(Math.max(36, Math.min(1200, +e.target.value || 96)))}
              className="font-num px-2 text-[12px] text-right outline-none"
              style={{ width: 70, height: 24, border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)", color: "var(--c-t1)" }} />
            <span style={{ fontSize: 11, color: "var(--c-t3)" }}>dpi</span>
          </div>
          {(() => {
            // Предел холста считается по стороне И по площади: раньше учитывалась
            // только сторона, и лист A0 при 600 dpi выходил пустым (см. canvasLimits.ts).
            const fit = fitDpiToCanvas(paper.w, paper.h, exportDpi);
            return (
              <div style={{ fontSize: 11, marginTop: 6, color: fit.limited ? "var(--c-amber)" : "var(--c-t3)" }}>
                Размер: {fit.width} × {fit.height} пикс.
                {fit.limited && (
                  <span> — запрошено {fit.requestedWidth}×{fit.requestedHeight}, качество снижено
                    до {fit.effectiveDpi} dpi (предел браузера)</span>
                )}
                {exportFormat === "png-hq" && !fit.limited && <span style={{ color: "var(--c-green)" }}> — вектор без пикселизации</span>}
              </div>
            );
          })()}
        </div>
      )}

      {exportFormat === "jpg" && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--c-t2)", marginBottom: 6 }}>
            Качество: {exportQuality}%
          </div>
          <input type="range" min={10} max={100} step={5}
            value={exportQuality} onChange={e => setExportQuality(+e.target.value)}
            className="w-full" style={{ accentColor: "var(--c-accent)" }} />
        </div>
      )}
    </div>

    <div className="flex gap-2 px-4 py-2.5 justify-end" style={{ background: "var(--c-s2)", borderTop: "1px solid var(--c-b2)" }}>
      <button onClick={() => setShowExportDialog(false)} disabled={pdfExporting}
        className="px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--c-s3)] disabled:opacity-60"
        style={{ border: "1px solid var(--c-b2)", borderRadius: 6, background: "var(--c-s1)", color: "var(--c-t2)" }}>
        Отмена
      </button>
      <button onClick={handleExport} disabled={pdfExporting}
        className="btn-brand flex items-center text-[12px] px-4 py-1.5">
        {pdfExporting
          ? <><Icon name="Loader" size={13} className="inline mr-1.5 animate-spin" />{exportFormat === "pdf-vector" ? "Конвертация SVG→PDF..." : exportFormat === "png-hq" ? "Рендер PNG HQ..." : "Генерация PDF..."}</>
          : <><Icon name="Download" size={13} className="inline mr-1.5" />Скачать {exportFormat === "pdf-vector" ? "PDF ✦ вектор" : exportFormat === "png-hq" ? "PNG ★ HQ" : exportFormat.toUpperCase()}</>
        }
      </button>
    </div>
  </div>
</div>
  );
}