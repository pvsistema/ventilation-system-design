import { type TopoBranch } from "@/lib/topology";
import { type MineBulkheadExport } from "@/components/cad/EquipmentRefDialog";
import { WINDOW_BULKHEAD_IDS } from "@/lib/schemaSymbols";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { type UnitsConfig, getUnit } from "@/lib/unitsConfig";
import { symbolBulkheadR, branchOwnBulkheadR } from "@/lib/bulkheadResistance";
import { depressionPa, siToBaseUnit } from "@/lib/resistanceUnits";
import {
  SectionHeader, EditInput, ComputedInput, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface Props {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  mineBulkheads?: MineBulkheadExport[];
  bulkheadSymTypeId?: string;
  bulkheadSymbol?: SchemaSymbol;
  onUpdateBulkheadSym?: (patch: Record<string, unknown>) => void;
  unitsConfig: UnitsConfig;
}

/**
 * Вкладка «Перемычка» панели свойств ветви.
 * Перенос 1:1 из BranchPropsPanel — разметка и логика не менялись.
 */
export default function BranchBulkheadTab({
  branch, onUpdate, mineBulkheads, bulkheadSymTypeId, bulkheadSymbol,
  onUpdateBulkheadSym, unitsConfig,
}: Props) {
  // Справочник перемычек рудника в виде Map — его ждут общие функции расчёта R.
  const bulkheadsMap = new Map((mineBulkheads ?? []).map(b => [b.id, b]));
  return (
    <div>
      <SectionHeader title="Перемычка в выработке" />
      <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
        <span className="text-[11px] text-gray-700 flex-shrink-0" style={{ width: 130 }}>Установлена</span>
        <input type="checkbox" checked={branch.hasBulkhead ?? false}
          onChange={e => onUpdate({
            hasBulkhead: e.target.checked,
            ...(e.target.checked ? {} : {
              bulkheadId: "", bulkheadName: "", bulkheadR: 0, bulkheadAirPerm: 0,
              bulkheadResMode: "project", bulkheadManualAirPerm: false, bulkheadCustomAirPerm: 0,
              bulkheadSurveyQ: 0, bulkheadSurveyDP: 0, bulkheadManualR: 0,
              bulkheadWindowArea: 0, bulkheadFailurePressure: 0,
            })
          })}
          style={{ width: 12, height: 12, cursor: "pointer", accentColor: "#2563eb" }} />
      </div>
      {branch.hasBulkhead && (
        <>
          {/* ── Тип перемычки из справочника ── */}
          <InlineLabel label="Тип перемычки">
            <select
              value={branch.bulkheadId ?? ""}
              onChange={e => {
                const sel = mineBulkheads?.find(b => b.id === e.target.value);
                onUpdate({
                  bulkheadId: e.target.value,
                  bulkheadName: sel?.name ?? "",
                  bulkheadR: sel?.rMkyurg ?? 0,
                  bulkheadAirPerm: sel?.airPermeability ?? 0,
                  bulkheadFailurePressure: sel?.failurePressure ?? 0,
                });
              }}
              className="w-full text-[11px] px-1"
              style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
              <option value="">— выберите из справочника —</option>
              {(mineBulkheads ?? []).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </InlineLabel>
          {!mineBulkheads?.length && (
            <div className="mx-1 my-1 px-2 py-1 text-[10px] rounded"
              style={{ background: "var(--c-tint-amber2, #fef3c7)", border: "1px solid #fcd34d", color: "var(--c-amber-ink, #92400e)" }}>
              Справочник перемычек пуст. Откройте Справочники → Перемычки и добавьте перемычки.
            </div>
          )}

          {/* ── Аэродинамическое сопротивление перемычки ── */}
          <SectionHeader title="Аэродинамическое сопротивление" />

          {/* R = ... (вычисленное/итоговое) */}
          <div className="flex items-center justify-center py-1" style={{ borderBottom: "1px solid #ebebeb" }}>
            <span className="text-[13px] font-semibold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>
              R = {(() => {
                const uRes = getUnit(unitsConfig, "resistance");
                // R считаем ТЕМИ ЖЕ функциями, что уходят в решатель, — здесь
                // была их дословная копия со своими единицами. Значок перемычки
                // главнее полей ветви (если он есть, поля не учитываются).
                const rSi = bulkheadSymbol
                  ? symbolBulkheadR(bulkheadSymbol, branch, bulkheadsMap)
                  : branchOwnBulkheadR(branch);
                if (rSi === 0) return `— ${uRes.symbol}`;
                return `${uRes.fromBase(siToBaseUnit(rSi)).toFixed(uRes.decimals)} ${uRes.symbol}`;
              })()}
            </span>
          </div>

          {/* Задается: */}
          <InlineLabel label="Задается:">
            <select
              value={branch.bulkheadResMode ?? "project"}
              onChange={e => {
                const mode = e.target.value as "project" | "survey" | "manual";
                onUpdate({ bulkheadResMode: mode });
                onUpdateBulkheadSym?.({ bkResMode: mode });
              }}
              className="w-full text-[11px] px-1"
              style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
              <option value="project">Проектными данными</option>
              <option value="survey">Воздушной съемкой</option>
              <option value="manual">Вручную</option>
            </select>
          </InlineLabel>

          {/* Режим: Проектными данными */}
          {(branch.bulkheadResMode ?? "project") === "project" && (
            <>
              {(bulkheadSymTypeId && WINDOW_BULKHEAD_IDS.has(bulkheadSymTypeId)) ? (
                /* Перемычка с окном/проёмом — показываем S вентокна */
                <InlineLabel label="S вентокна:">
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <EditInput
                      type="number" step="0.1"
                      value={branch.bulkheadWindowArea ?? 0}
                      onChange={v => onUpdate({ bulkheadWindowArea: parseFloat(v) || 0 })}
                    />
                    <span style={{ fontSize: 10, color: "var(--c-t4, #9ca3af)", flexShrink: 0 }}>м²</span>
                  </div>
                </InlineLabel>
              ) : (
                /* Глухая перемычка — воздухопроницаемость */
                <>
                  <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                    <span className="text-[11px] font-semibold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>Воздухопроницаемость</span>
                  </div>
                  <div className="flex items-center px-1 py-0.5 gap-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                    <span className="text-[11px] text-gray-700 flex-shrink-0" style={{ width: 130 }}>Тип:</span>
                    <input type="checkbox"
                      checked={branch.bulkheadManualAirPerm ?? false}
                      onChange={e => onUpdate(
                        e.target.checked
                          ? {
                              bulkheadManualAirPerm: true,
                              // при включении ручного режима подставляем ТОЧНОЕ
                              // каталожное значение (не округлённое отображаемое),
                              // чтобы сопротивление не менялось
                              bulkheadCustomAirPerm: (branch.bulkheadCustomAirPerm ?? 0) > 0
                                ? branch.bulkheadCustomAirPerm
                                : (branch.bulkheadAirPerm ?? 0),
                            }
                          : { bulkheadManualAirPerm: false }
                      )}
                      style={{ width: 11, height: 11, cursor: "pointer", accentColor: "#2563eb" }} />
                    <span className="text-[11px] text-gray-600">Задается вручную</span>
                  </div>
                  <InlineLabel label="Значение:">
                    {branch.bulkheadManualAirPerm ? (
                      <EditInput
                        type="number" step="0.0001"
                        value={branch.bulkheadCustomAirPerm ?? 0}
                        onChange={v => onUpdate({ bulkheadCustomAirPerm: parseFloat(v) || 0 })}
                      />
                    ) : (
                      <ComputedInput value={branch.bulkheadAirPerm ? `${branch.bulkheadAirPerm.toPrecision(4)} м²/(с·√Па)` : "—"} />
                    )}
                  </InlineLabel>
                </>
              )}
              <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                <span className="text-[11px] font-semibold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>Вычисленные параметры</span>
              </div>
              <InlineLabel label="ΔP:">
                <ComputedInput value={(() => {
                  const u = getUnit(unitsConfig, "pressure");
                  // ΔP = R·Q² в паскалях; R — общей функцией (см. выше).
                  const rSi = bulkheadSymbol
                    ? symbolBulkheadR(bulkheadSymbol, branch, bulkheadsMap)
                    : branchOwnBulkheadR(branch);
                  const Q = branch.flow ?? 0;
                  if (rSi === 0 || Q === 0) return "—";
                  return `${u.fromBase(depressionPa(rSi, Q)).toFixed(u.decimals)} ${u.symbol}`;
                })()} />
              </InlineLabel>
              <InlineLabel label="P разр., МПа:">
                <EditInput
                  type="number" step="0.01"
                  value={branch.bulkheadFailurePressure ?? 0}
                  onChange={v => onUpdate({ bulkheadFailurePressure: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            </>
          )}

          {/* Режим: Воздушной съемкой */}
          {(branch.bulkheadResMode ?? "project") === "survey" && (
            <>
              <InlineLabel label="Расход:">
                <EditInput
                  type="number" step="0.1"
                  value={branch.bulkheadSurveyQ ?? 0}
                  onChange={v => {
                    const val = parseFloat(v) || 0;
                    onUpdate({ bulkheadSurveyQ: val });
                    onUpdateBulkheadSym?.({ bkSurveyQ: val });
                  }}
                />
              </InlineLabel>
              <InlineLabel label="Падение Р:">
                <EditInput
                  type="number" step="1"
                  value={branch.bulkheadSurveyDP ?? 0}
                  onChange={v => {
                    const val = parseFloat(v) || 0;
                    onUpdate({ bulkheadSurveyDP: val });
                    onUpdateBulkheadSym?.({ bkSurveyDP: val });
                  }}
                />
              </InlineLabel>
              <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                <span className="text-[11px] font-semibold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>Вычисленные параметры</span>
              </div>
              <InlineLabel label="ΔP:">
                <ComputedInput value={(() => {
                  const u = getUnit(unitsConfig, "pressure");
                  // Режим «по съёмке»: R=ΔP_зам/Q_зам² (Н·с²/м⁸), ΔP=R·Q² в Па.
                  const rSi = bulkheadSymbol
                    ? symbolBulkheadR(bulkheadSymbol, branch, bulkheadsMap)
                    : branchOwnBulkheadR(branch);
                  const Q = branch.flow ?? 0;
                  if (rSi === 0 || Q === 0) return "—";
                  return `${u.fromBase(depressionPa(rSi, Q)).toFixed(u.decimals)} ${u.symbol}`;
                })()} />
              </InlineLabel>
              <InlineLabel label="P разр., МПа:">
                <EditInput
                  type="number" step="0.01"
                  value={branch.bulkheadFailurePressure ?? 0}
                  onChange={v => onUpdate({ bulkheadFailurePressure: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            </>
          )}

          {/* Режим: Вручную */}
          {(branch.bulkheadResMode ?? "project") === "manual" && (
            <>
              {/* Поле хранит РУДНИЧНЫЕ кМюрг — в них же перемычки задают в
                  «АэроСети» и в них лежат числа старых проектов. Подпись была
                  «Н·с²/м⁸» и вводила в заблуждение: значение уходило в расчёт
                  как СИ, то есть перемычка оказывалась в 9,81 раза слабее. */}
              <InlineLabel label="R (кМюрг):">
                <EditInput
                  type="number" step="0.0001"
                  value={branch.bulkheadManualR ?? 0}
                  onChange={v => {
                    const val = parseFloat(v) || 0;
                    onUpdate({ bulkheadManualR: val });
                    onUpdateBulkheadSym?.({ bkManualR: val });
                  }}
                />
              </InlineLabel>
              <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                <span className="text-[11px] font-semibold" style={{ color: "var(--c-blue-ink, #1a3a6b)" }}>Вычисленные параметры</span>
              </div>
              <InlineLabel label="ΔP:">
                <ComputedInput value={(() => {
                  const u = getUnit(unitsConfig, "pressure");
                  // Режим «вручную»: R из значка (bkManualR) или из поля ветви,
                  // перевод кМюрг→СИ внутри общей функции. ΔP=R·Q² в Па.
                  const rSi = bulkheadSymbol
                    ? symbolBulkheadR(bulkheadSymbol, branch, bulkheadsMap)
                    : branchOwnBulkheadR(branch);
                  const Q = branch.flow ?? 0;
                  if (rSi === 0 || Q === 0) return "—";
                  return `${u.fromBase(depressionPa(rSi, Q)).toFixed(u.decimals)} ${u.symbol}`;
                })()} />
              </InlineLabel>
              <InlineLabel label="P разр., МПа:">
                <EditInput
                  type="number" step="0.01"
                  value={branch.bulkheadFailurePressure ?? 0}
                  onChange={v => onUpdate({ bulkheadFailurePressure: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            </>
          )}
        </>
      )}
    </div>
  );
}