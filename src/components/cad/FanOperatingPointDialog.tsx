// ─────────────────────────────────────────────────────────────────────────────
// FanOperatingPointDialog — увеличенный просмотр характеристики вентилятора
// с рабочими точками и выгрузкой в Excel (по образцу «рабочая точка ГВУ»):
// диаграмма Excel + табличные данные по углам, рабочая точка, линии КПД,
// отдельные листы для реверса. Сохранение картинки PNG.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import FanChart from "@/components/cad/FanChart";
import { exportFanOperatingPointToExcel, type FanXlsBlock } from "@/lib/fanOperatingPointExcel";
import { useFanOpCurves, type BuiltCurve } from "@/components/cad/useFanOpCurves";
import type { FanOperatingPointData } from "@/lib/fanOperatingPointData";

export type { FanOperatingPointData, FanOpAngle, FanOpPoint } from "@/lib/fanOperatingPointData";

interface Props {
  data: FanOperatingPointData;
  onClose: () => void;
  /** Выбор угла лопаток кликом по кривой (только в окне ветви) */
  onPickAngle?: (angle: number) => void;
}

export default function FanOperatingPointDialog({ data, onClose, onPickAngle }: Props) {
  const { catalog, angles, points, fanName, selected, subtitle } = data;
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasReverse = angles.some(a => a.reverse) || points.some(p => p.reverse);
  const [mode, setMode] = useState<"forward" | "reverse">(selected?.reverse ? "reverse" : "forward");
  // Режим ветви сменили в панели (прямой ↔ реверс) — окно переключается вслед
  useEffect(() => { if (selected) setMode(selected.reverse ? "reverse" : "forward"); }, [selected?.reverse]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chart, setChart] = useState<"qh" | "qp">("qh");
  const [showIso, setShowIso] = useState(true);
  const [busy, setBusy] = useState(false);

  // Esc закрывает только это окно, а не весь справочник под ним
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const { fwdCurves, revCurves, fwdIso, networks } = useFanOpCurves(data);

  const isRev = mode === "reverse";
  const curves = isRev ? revCurves : fwdCurves;
  const opPts = points.filter(p => p.reverse === isRev);
  const iso = isRev ? [] : fwdIso;

  const handleExcel = async () => {
    setBusy(true);
    try {
      const block = (cs: BuiltCurve[], rev: boolean, isoL: typeof fwdIso): FanXlsBlock => ({
        curves: cs.map(c => ({ label: c.label, color: c.color, pts: c.pts })),
        points: points.filter(p => p.reverse === rev).map(p => ({ label: p.label, q: p.q, h: p.h })),
        isolines: isoL,
      });
      await exportFanOperatingPointToExcel({
        fanName,
        forward: block(fwdCurves, false, fwdIso),
        reverse: revCurves.length > 0 ? block(revCurves, true, []) : undefined,
      });
    } finally { setBusy(false); }
  };

  const handlePng = () => {
    const svg = wrapRef.current?.querySelector("svg");
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = svg.clientWidth * scale;
      canvas.height = svg.clientHeight * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `Характеристика ${fanName}${isRev ? " (реверс)" : ""}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, "image/png");
    };
    img.src = url;
  };

  const W = Math.min(900, window.innerWidth - 80);
  const H = Math.min(500, window.innerHeight - 300);

  const seg = (active: boolean) =>
    "px-2.5 h-7 text-[11px] rounded-md transition-colors " +
    (active ? "bg-[var(--c-accent)] text-white" : "text-[var(--c-t2)] hover:bg-[var(--c-s3)]");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: "rgba(15,20,25,0.5)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden bg-[var(--c-s1)] border border-[var(--c-b2)]"
        style={{ width: W + 32, maxHeight: "calc(100vh - 32px)" }}>
        {/* Шапка */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s2, #f8f7f4)" }}>
          <Icon name="Wind" size={15} className="text-[var(--c-accent)]" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--c-t1)] truncate">Рабочая точка — {fanName}</div>
            <div className="text-[11px] text-[var(--c-t3)]">
              {catalog.type === "axial" ? "Осевой" : catalog.type === "vmp" ? "ВМП" : "Центробежный"} · Ø{catalog.diameter} м
              {subtitle ? ` · ${subtitle}` : ""}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={handlePng}
              className="h-7 px-2.5 inline-flex items-center gap-1 text-[11px] rounded-md border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t2)] hover:bg-[var(--c-s3)]"
              title="Сохранить график как изображение PNG">
              <Icon name="Image" size={13} /> PNG
            </button>
            <button onClick={handleExcel} disabled={busy}
              className="h-7 px-2.5 inline-flex items-center gap-1 text-[11px] rounded-md text-white disabled:opacity-60"
              style={{ background: "#16794a" }}
              title="Выгрузка в Excel: диаграмма + табличные данные (характеристики, рабочая точка, КПД, реверс)">
              <Icon name={busy ? "Loader2" : "Sheet"} size={13} className={busy ? "animate-spin" : undefined} /> Экспорт в Excel
            </button>
            <button onClick={onClose} className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--c-t3)] hover:bg-[var(--c-s3)]" title="Закрыть (Esc)">
              <Icon name="X" size={16} />
            </button>
          </div>
        </div>

        {/* Переключатели */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--c-b1)] flex-shrink-0">
          <div className="flex gap-1 p-0.5 rounded-lg border border-[var(--c-b2)]">
            <button className={seg(chart === "qh")} onClick={() => setChart("qh")}>Напор — Расход</button>
            <button className={seg(chart === "qp")} onClick={() => setChart("qp")}>Мощность — Расход</button>
          </div>
          {hasReverse && (
            <div className="flex gap-1 p-0.5 rounded-lg border border-[var(--c-b2)]">
              <button className={seg(!isRev)} onClick={() => setMode("forward")}>Прямой</button>
              <button className={seg(isRev)} onClick={() => setMode("reverse")}>Реверс</button>
            </div>
          )}
          {chart === "qh" && !isRev && fwdIso.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--c-t2)] cursor-pointer select-none">
              <input type="checkbox" checked={showIso} onChange={e => setShowIso(e.target.checked)} style={{ accentColor: "var(--c-accent)" }} />
              Линии КПД
            </label>
          )}
        </div>

        {/* Увеличенный график */}
        <div className="flex-1 overflow-auto">
          <div ref={wrapRef} className="flex justify-center p-4 bg-white">
            <FanChart curves={curves} type={chart} operatingPoints={opPts}
              isolines={showIso ? iso : []} width={W} height={H} labels
              networks={networks(isRev)}
              onCurveClick={onPickAngle ? (c => { const bc = c as BuiltCurve; if (!bc.reverse) onPickAngle(bc.angle); }) : undefined} />
          </div>

          {/* Рабочие точки */}
          <div className="px-4 pb-3 pt-2 border-t border-[var(--c-b1)]">
            <div className="text-[11px] font-semibold text-[var(--c-t2)] mb-1.5">
              Рабочие точки{isRev ? " (реверс)" : ""}
              {onPickAngle && !isRev && <span className="ml-2 font-normal text-[var(--c-t4)]">Клик по кривой — выбрать угол лопаток ветви</span>}
            </div>
            {opPts.length === 0 ? (
              <div className="text-[11px] text-[var(--c-t4)]">
                Нет рабочих точек. Выполните «Расчёт сети» (F9) для ветвей с этим вентилятором или задайте точку вручную при добавлении характеристики.
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[var(--c-t3)] text-left">
                    <th className="font-medium py-1 w-6" />
                    <th className="font-medium py-1">Точка</th>
                    <th className="font-medium py-1 text-right">Q, м³/с</th>
                    <th className="font-medium py-1 text-right">H, Па</th>
                    <th className="font-medium py-1 text-right pr-1">Источник</th>
                  </tr>
                </thead>
                <tbody>
                  {opPts.map((p, i) => (
                    <tr key={i} className="border-t border-[var(--c-b1)]">
                      <td className="py-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} /></td>
                      <td className="py-1 text-[var(--c-t1)]">{p.label}</td>
                      <td className="py-1 text-right font-mono text-[var(--c-t1)]">{p.q.toFixed(2)}</td>
                      <td className="py-1 text-right font-mono text-[var(--c-t1)]">{Math.round(p.h)}</td>
                      <td className="py-1 text-right pr-1 text-[var(--c-t3)]">{p.source === "calc" ? "расчёт сети" : "задана вручную"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
