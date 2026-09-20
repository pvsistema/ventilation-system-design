// ─────────────────────────────────────────────────────────────────────────────
// BranchComputedSection.tsx — раздел «Вычисленные параметры» вкладки
// «Топология»: сопротивления (аэродинамическое, общее, геометрическое,
// единичное), скорость, депрессии, Re и энергозатраты.
//
// Вынесено из BranchTopologyTab.tsx БЕЗ изменений разметки, формул и подписей.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { G_ACCEL } from "@/lib/bulkheads";
import {
  SectionHeader, ParamRow, EditInput, ComputedInput,
} from "@/components/cad/BranchPropsPrimitives";

interface BranchComputedSectionProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  visible: Set<string>;
  toggle: (id: string) => void;
  angle: number;
  unitR: number;
  uRes: { fromBase: (v: number) => number; symbol: string; decimals: number };
  rToDisplay: (rKmurg: number) => number;
  numFmt: (v: number, d?: number) => string;
  fmtR: (rKmu: number, minDecimals?: number) => string;
  bulkheadRKmu: number;
}

export default function BranchComputedSection({
  branch, onUpdate, visible, toggle, angle, unitR, uRes, rToDisplay,
  numFmt, fmtR, bulkheadRKmu,
}: BranchComputedSectionProps) {
  return (
  <>
    <SectionHeader title="Вычисленные параметры" />

    <ParamRow id="v_name" label="Название ветви" visible={visible.has("v_name")} onToggle={toggle}>
      <ComputedInput value={branch.type || branch.id} />
    </ParamRow>

    <ParamRow id="v_length" label="Длина ветви, м" visible={visible.has("v_length")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.length, 1)} />
    </ParamRow>

    <ParamRow id="v_angle" label="Угол наклона, °" visible={visible.has("v_angle")} onToggle={toggle}>
      <ComputedInput value={numFmt(angle, 1)} />
    </ParamRow>

    <ParamRow id="v_area" label="Попер. сечение S, м²" visible={visible.has("v_area")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.area, 2)} />
    </ParamRow>

    <ParamRow id="v_resistance" label={`Аэродин. сопр. R, ${uRes.symbol}`} visible={visible.has("v_resistance")} onToggle={toggle}>
      {(() => {
        const rAero = rToDisplay(branch.resistance);
        const rGeom = rToDisplay(branch.rFriction);
        const isWrong = branch.rFriction > 0 && branch.resistance < branch.rFriction;
        return (
          <div className="relative flex items-center flex-1">
            <ComputedInput
              value={fmtR(rAero, uRes.decimals)}
              color={isWrong ? "#dc2626" : undefined}
            />
            {isWrong && (
              <span
                title={`Ошибка: аэродинамическое сопротивление (${fmtR(rAero, 4)}) меньше геометрического (${fmtR(rGeom, 4)}). Аэродинамическое R не может быть меньше геометрического — проверьте параметры ветви.`}
                className="ml-1 cursor-help flex-shrink-0"
                style={{ fontSize: 12, color: "var(--c-red, #dc2626)" }}
              >⚠</span>
            )}
          </div>
        );
      })()}
    </ParamRow>

    <ParamRow id="v_total_r" label={`Общее сопр. R, ${uRes.symbol}`} visible={visible.has("v_total_r")} onToggle={toggle}>
      {(() => {
        // Общее R ветви = сопротивление выработки + сопротивление
        // перемычки (если установлена) + сопротивление вентилятора,
        // установленного «Внутри перемычки». Единицы: Н·с²/м⁸ (= кМюрг).
        const fanCrossingKmu = (branch.hasFan && (branch.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
          ? (branch.fanCrossingR ?? 0) / 1000 : 0;
        const totalNsm8 = branch.resistance + (bulkheadRKmu ?? 0) + fanCrossingKmu;
        return <ComputedInput value={fmtR(rToDisplay(totalNsm8), uRes.decimals)} />;
      })()}
    </ParamRow>

    <ParamRow id="v_geom_r" label={`Геометр. сопр. R, ${uRes.symbol}`} visible={visible.has("v_geom_r")} onToggle={toggle}>
      <ComputedInput value={fmtR(rToDisplay(branch.rFriction), uRes.decimals)} />
    </ParamRow>

    <ParamRow id="v_unit_r" label={`Ед. сопр. R(ед), ${uRes.symbol}/м`} visible={visible.has("v_unit_r")} onToggle={toggle}>
      <ComputedInput value={fmtR(rToDisplay(unitR), uRes.decimals + 1)} />
    </ParamRow>

    <ParamRow id="v_velocity" label="Скорость V, м/с" visible={visible.has("v_velocity")} onToggle={toggle}>
      <ComputedInput value={`${numFmt(branch.velocity, 2)}${branch.velocity > branch.vMax ? " ⚠" : ""}`} />
    </ParamRow>

    <ParamRow id="v_adddep" label="Доп. депрессия, Па" visible={visible.has("v_adddep")} onToggle={toggle}>
      {/* Депрессии показываем до сотых: на слабонапорных ветвях разница
          в десятых долях паскаля существенна для анализа устойчивости.
          РАНЬШЕ поле было только для чтения: напор, пришедший из импорта,
          был виден, но поменять его было негде — вкладку «Вентилятор»
          открывал лишь клик по значку УО, которого у импортированной
          выработки нет. Теперь напор правится прямо здесь. */}
      {branch.hasFan
        ? <EditInput type="number" step="10" value={branch.fanPressure}
            onChange={(v) => onUpdate({ fanPressure: parseFloat(v) || 0 })} />
        : <ComputedInput value="0.00" />}
    </ParamRow>

    <ParamRow id="v_flow" label="Расход Q, м³/с" visible={visible.has("v_flow")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.flow, 2)} />
    </ParamRow>

    <ParamRow id="v_dep" label="Депрессия H, Па" visible={visible.has("v_dep")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.dP, 2)} />
    </ParamRow>

    <ParamRow id="v_dep_total" label="Общая депрессия, Па" visible={visible.has("v_dep_total")} onToggle={toggle}>
      {(() => {
        // Общая депрессия = R_общее · Q² · 9,81 − H вентилятора, где
        // R_общее = выработка + перемычка/окно + окно ГВУ (та же сумма,
        // что в строке «Общее сопротивление»). Именно эта величина
        // считается решателем сети и используется в расчёте пожара.
        const fanCrossingKmu = (branch.hasFan && (branch.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
          ? (branch.fanCrossingR ?? 0) / 1000 : 0;
        const totalR = branch.resistance + (bulkheadRKmu ?? 0) + fanCrossingKmu;
        const Q = branch.flow ?? 0;
        const fanH = branch.hasFan ? (branch.fanPressure ?? 0) : 0;
        const dpTotal = totalR * Math.abs(Q) * Q * G_ACCEL - fanH;
        const hasBk = (bulkheadRKmu ?? 0) > 0;
        return (
          <div className="flex items-center flex-1 min-w-0">
            <ComputedInput value={numFmt(dpTotal, 2)} />
            {hasBk && (
              <span
                title={`Учтено сопротивление вентиляционного сооружения на ветви. Депрессия самой выработки — ${numFmt(branch.dP, 2)} Па.`}
                className="ml-1 flex-shrink-0 cursor-help"
                style={{ fontSize: 11, color: "var(--c-blue, #2563eb)" }}
              >⛨</span>
            )}
          </div>
        );
      })()}
    </ParamRow>

    <ParamRow id="v_r_friction" label={`R трение, ${uRes.symbol}`} visible={visible.has("v_r_friction")} onToggle={toggle}>
      <ComputedInput value={fmtR(rToDisplay(branch.rFriction), uRes.decimals)} />
    </ParamRow>

    <ParamRow id="v_r_local" label={`R местные, ${uRes.symbol}`} visible={visible.has("v_r_local")} onToggle={toggle}>
      <ComputedInput value={fmtR(rToDisplay(branch.rLocal), uRes.decimals)} />
    </ParamRow>

    <ParamRow id="v_reynolds" label="Re (Рейнольдс), тыс." visible={visible.has("v_reynolds")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.reynolds / 1000, 1)} />
    </ParamRow>

    <ParamRow id="v_power" label="Энергозатраты N, Вт" visible={visible.has("v_power")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.power, 0)} />
    </ParamRow>
  </>
  );
}
