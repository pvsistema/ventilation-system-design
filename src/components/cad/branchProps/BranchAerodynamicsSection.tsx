// ─────────────────────────────────────────────────────────────────────────────
// BranchAerodynamicsSection.tsx — раздел «Аэродинамика» вкладки «Топология».
// Способ задания сопротивления (тип поверхности, α, шероховатость, вручную,
// трубопровод), марка и типоразмер вентиляционного рукава, местные ξ и V max.
//
// Вынесено из BranchTopologyTab.tsx БЕЗ изменений разметки, формул и подписей.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { SURFACE_TYPES, PIPE_ALPHA_TYPES } from "@/lib/aerodynamics";
import { VENT_DUCT_BRANDS, getDuctBrand, getDuctSize } from "@/lib/ventDucts";
import {
  SectionHeader, EditInput, ComputedInput, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface BranchAerodynamicsSectionProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  uRes: { fromBase: (v: number) => number; symbol: string; decimals: number };
  numFmt: (v: number, d?: number) => string;
}

export default function BranchAerodynamicsSection({
  branch, onUpdate, uRes, numFmt,
}: BranchAerodynamicsSectionProps) {
  return (
  <>
    <SectionHeader title="Аэродинамика" />

    <InlineLabel label="Способ задания R">
      <select
        value={branch.resistanceMode}
        onChange={(e) => onUpdate({ resistanceMode: e.target.value as TopoBranch["resistanceMode"] })}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
        <option value="surface">По типу поверхности</option>
        <option value="alpha">По коэф. α</option>
        <option value="roughness">По шероховатости Δ</option>
        <option value="manual">Вручную (R)</option>
        <option value="pipe">Трубопровод (R=6.48αL/D⁵)</option>
      </select>
    </InlineLabel>

    {branch.resistanceMode === "surface" && (
      <InlineLabel label="Тип поверхности">
        <select
          value={branch.surfaceId}
          onChange={(e) => {
            const s = SURFACE_TYPES.find((x) => x.id === e.target.value);
            if (s) onUpdate({ surfaceId: s.id, surface: s.name, alphaCoef: s.alpha, roughness: s.roughness });
          }}
          className="w-full text-[11px] px-1"
          style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
          {SURFACE_TYPES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </InlineLabel>
    )}

    {(branch.resistanceMode === "alpha" || branch.resistanceMode === "surface") && (
      <InlineLabel label="Коэф. α, ×10⁻⁴">
        {branch.resistanceMode === "alpha" ? (
          <EditInput
            type="number" step="1"
            value={branch.alphaCoef}
            onChange={(v) => onUpdate({ alphaCoef: parseFloat(v) || 0 })}
          />
        ) : (
          <ComputedInput value={numFmt(branch.alphaCoef, 0)} />
        )}
      </InlineLabel>
    )}

    {branch.resistanceMode === "roughness" && (
      <InlineLabel label="Шероховатость Δ, мм">
        <EditInput
          type="number" step="1"
          value={branch.roughness}
          onChange={(v) => onUpdate({ roughness: parseFloat(v) || 0 })}
        />
      </InlineLabel>
    )}

    {branch.resistanceMode === "manual" && (
      <InlineLabel label={`Сопротивление R, ${uRes.symbol}`}>
        <EditInput
          type="number" step="0.001"
          value={branch.manualR}
          onChange={(v) => onUpdate({ manualR: parseFloat(v) || 0 })}
        />
      </InlineLabel>
    )}

    {branch.resistanceMode === "pipe" && (() => {
      const duct = getDuctBrand(branch.vpBrandId);
      return (
      <>
        {/* Марка рукава — синхронизирована с окном построения
            вентрубопровода: выбор марки подставляет α, диаметр,
            паспортные утечки и предельное рабочее давление. */}
        <InlineLabel label="Марка рукава">
          <select
            value={branch.vpBrandId ?? ""}
            onChange={(e) => {
              const b = getDuctBrand(e.target.value);
              if (!b) {
                onUpdate({ vpBrandId: "", vpWorkPressure: 0 });
                return;
              }
              const curD = Math.round((branch.pipeDiameter ?? 0.5) * 1000);
              const size = getDuctSize(b, curD) ?? b.sizes[0];
              onUpdate({
                vpBrandId: b.id,
                pipeAlpha: b.alpha,
                vpPipeAlpha: b.alpha,
                pipeDiameter: size.diameter / 1000,
                vpDiameter: size.diameter,
                shape: "round", diameter: size.diameter / 1000, manualSection: false,
                vpLeakageCoeff: size.lossPer100m,
                vpWorkPressure: size.workPressure,
                vpPipeType: "",
              });
            }}
            className="w-full text-[11px] px-1"
            style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
            <option value="">— без марки —</option>
            {VENT_DUCT_BRANDS.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </InlineLabel>
        {duct ? (
          <>
            {/* У марки диаметр выбирается только из выпускаемых типоразмеров */}
            <InlineLabel label="Диаметр D, мм">
              <select
                value={Math.round((branch.pipeDiameter ?? 0.5) * 1000)}
                onChange={(e) => {
                  const d = Number(e.target.value);
                  const size = getDuctSize(duct, d);
                  onUpdate({
                    pipeDiameter: d / 1000,
                    vpDiameter: d,
                    // Сечение ветви — под диаметр рукава
                    shape: "round", diameter: d / 1000, manualSection: false,
                    ...(size ? { vpLeakageCoeff: size.lossPer100m, vpWorkPressure: size.workPressure } : {}),
                  });
                }}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
                {duct.sizes.map(sz => (
                  <option key={sz.diameter} value={sz.diameter}>Ø {sz.diameter}</option>
                ))}
              </select>
            </InlineLabel>
            <InlineLabel label="Утечки, % на 100 м">
              <ComputedInput value={numFmt(branch.vpLeakageCoeff ?? 0, 1)} />
            </InlineLabel>
            <InlineLabel label="Раб. давление, Па">
              <ComputedInput value={numFmt(branch.vpWorkPressure ?? 0, 0)} />
            </InlineLabel>
          </>
        ) : (
        <InlineLabel label="Диаметр D, м">
          <EditInput
            type="number" step="0.05"
            value={branch.pipeDiameter ?? 0.5}
            onChange={(v) => {
              const d = parseFloat(v) || 0;
              onUpdate({ pipeDiameter: d, vpDiameter: Math.round(d * 1000) });
            }}
          />
        </InlineLabel>
        )}
        {/* Тип трубопровода — только когда марка не задана: у марки
            коэффициент α берётся из её паспорта. */}
        {!duct && (
          <InlineLabel label="Тип трубопровода">
            <select
              value={PIPE_ALPHA_TYPES.find(p => p.alpha === (branch.pipeAlpha ?? 9))?.id ?? ""}
              onChange={(e) => {
                const p = PIPE_ALPHA_TYPES.find(x => x.id === e.target.value);
                if (p) onUpdate({ pipeAlpha: p.alpha, vpPipeAlpha: p.alpha, vpPipeType: p.id });
              }}
              className="w-full text-[11px] px-1"
              style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
              <option value="">— выбрать из справочника —</option>
              {PIPE_ALPHA_TYPES.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.alphaMin}–{p.alphaMax})
                </option>
              ))}
            </select>
          </InlineLabel>
        )}
        <InlineLabel label="Коэф. α, ×10⁻⁴">
          <EditInput
            type="number" step="0.05"
            value={branch.pipeAlpha ?? 9}
            onChange={(v) => {
              const a = parseFloat(v) || 0;
              // Ручная правка α — марка больше не соответствует паспорту
              onUpdate({ pipeAlpha: a, vpPipeAlpha: a, ...(duct ? { vpBrandId: "" } : {}) });
            }}
          />
        </InlineLabel>
      </>
      );
    })()}

    <InlineLabel label="Местные ξ (сумма)">
      <EditInput
        type="number" step="0.1"
        value={branch.localXi}
        onChange={(v) => onUpdate({ localXi: parseFloat(v) || 0 })}
      />
    </InlineLabel>

    <InlineLabel label="V max допустимая, м/с">
      <EditInput
        type="number" step="0.5"
        value={branch.vMax}
        onChange={(v) => onUpdate({ vMax: parseFloat(v) || 0 })}
      />
    </InlineLabel>
  </>
  );
}
