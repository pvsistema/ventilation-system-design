// ─────────────────────────────────────────────────────────────────────────────
// BranchWaterPipeTab.tsx — вкладка «Трубы» панели свойств выработки.
//
// Две карточки с переключателем в заголовке: «Водопровод ППЗ» и
// «Воздухопровод». У включённой видны параметры трубы.
// Для водопровода дополнительно:
//   • «Результат расчёта» — расход, скорость, потери (плитки);
//   • «Запорный вентиль» и «Редукционный клапан» — только если они стоят
//     на ветви (ставятся значком на схеме).
//
// Логика расчёта не менялась — те же поля ветви, что читает
// calcWaterNetwork() в lib/waterHydraulics.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { type ReactNode } from "react";
import { type TopoBranch } from "@/lib/topology";
import { type WaterBranchResult } from "@/lib/waterHydraulics";
import { PRESSURE_REDUCING_VALVES, getValveById, MPA_TO_ATM } from "@/lib/pressureReducingValves";
import Icon from "@/components/ui/icon";
import {
  Card, Field, NumInput, ReadValue, Segmented, Stat, KV, inputCls, inputStyle,
} from "@/components/cad/propUi";

interface Props {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  waterBranchResult?: WaterBranchResult;
  onRemoveGate?: () => void;
  onRemoveReducer?: () => void;
  reducerSymbolScale?: number;
  onReducerSymbolScale?: (scale: number) => void;
}

const MATERIALS = ["Сталь", "Чугун", "Полиэтилен", "ПВХ", "Асбестоцемент", "Прочее"];
/** Шероховатость «гладкой» трубы — та же константа, что в calcWaterNetwork. */
const SMOOTH_ROUGHNESS_MM = 0.03;

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };
const fmt = (v: number | undefined, d: number) => (v !== undefined && Number.isFinite(v) ? v.toFixed(d) : "—");

// ─── Вспомогательные элементы ───────────────────────────────────────────────

/** Карточка трубы: иконка, название, переключатель «есть / нет». */
function PipeCard({ icon, title, subtitle, enabled, onToggle, children }: {
  icon: string; title: string; subtitle?: string; enabled: boolean;
  onToggle: (v: boolean) => void; children: ReactNode;
}) {
  const color = enabled ? "var(--c-accent, #1e5a7a)" : "var(--c-t4, #767f8c)";
  return (
    <section className="rounded-lg overflow-hidden"
      style={{
        background: "var(--c-s1, #fff)",
        border: `1px solid ${enabled ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 40%, transparent)" : "var(--c-b1, #e7e4dd)"}`,
      }}>
      <div className="flex items-center gap-2 px-2.5 py-2 select-none cursor-pointer" onClick={() => onToggle(!enabled)}>
        <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <Icon name={icon} size={13} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wider truncate"
            style={{ color: enabled ? "var(--c-t1, #1f2328)" : "var(--c-t3, #6b7280)" }}>{title}</span>
          <span className="block text-[10px] truncate" style={{ color: "var(--c-t4, #767f8c)" }}>
            {enabled ? subtitle : "Нет в выработке — включите, чтобы задать"}
          </span>
        </span>
        <button type="button" role="switch" aria-checked={enabled}
          title={enabled ? "Убрать трубу из выработки" : "Проложить трубу в выработке"}
          onClick={(e) => { e.stopPropagation(); onToggle(!enabled); }}
          className="relative flex-shrink-0 rounded-full transition-colors"
          style={{ width: 28, height: 16, border: "none", cursor: "pointer",
            background: enabled ? "var(--c-accent, #1e5a7a)" : "var(--c-b2, #d5d1c8)" }}>
          <span className="absolute top-[2px] rounded-full transition-all"
            style={{ width: 12, height: 12, left: enabled ? 14 : 2, background: "var(--c-s1, #fff)" }} />
        </button>
      </div>
      {enabled && <div className="px-2.5 pb-2.5 pt-0.5 space-y-2">{children}</div>}
    </section>
  );
}

/** Переключатель «по ветви / вручную» рядом с подписью длины. */
function AutoManual({ manual, onChange }: { manual: boolean; onChange: (manual: boolean) => void }) {
  return (
    <div style={{ width: 96 }}>
      <Segmented size="sm" value={manual ? "m" : "a"} onChange={(v) => onChange(v === "m")}
        options={[
          { value: "a", label: "по ветви", title: "Длина трубы = длина выработки" },
          { value: "m", label: "вручную", title: "Задать длину трубы вручную" },
        ]} />
    </div>
  );
}

/** Длина трубы: по ветви (только чтение) или своя. */
function LengthField({ manual, value, branchLen, onManual, onChange }: {
  manual: boolean; value: number; branchLen: number;
  onManual: (v: boolean) => void; onChange: (v: number) => void;
}) {
  return (
    <Field label="Длина трубы" aside={<AutoManual manual={manual} onChange={onManual} />}>
      {manual
        ? <NumInput value={value} min={0} step={1} unit="м" onChange={onChange} />
        : <ReadValue value={fmt(branchLen, 1)} unit="м" title="Берётся из длины выработки" />}
    </Field>
  );
}

function MaterialSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputCls} style={selectStyle} value={value} onChange={(e) => onChange(e.target.value)}>
      {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

/** Маленькая кнопка «убрать» в заголовке карточки оборудования. */
function RemoveBtn({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="w-6 h-6 flex items-center justify-center rounded"
      style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-red, #dc2626)" }}>
      <Icon name="Trash2" size={12} />
    </button>
  );
}

function StateBtn({ on, onClick, icon, label, tone }: {
  on: boolean; onClick: () => void; icon: string; label: string; tone: "green" | "red";
}) {
  const c  = tone === "green" ? "var(--c-green, #15803d)" : "var(--c-red, #dc2626)";
  const bg = tone === "green" ? "var(--c-tint-green, #f0fdf4)" : "var(--c-tint-red, #fef2f2)";
  return (
    <button type="button" onClick={onClick}
      className="flex-1 h-8 rounded-md flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors"
      style={{
        background: on ? bg : "var(--c-s1, #fff)",
        color: on ? c : "var(--c-t3, #6b7280)",
        border: `1px solid ${on ? `color-mix(in srgb, ${c} 45%, transparent)` : "var(--c-b2, #d5d1c8)"}`,
        cursor: "pointer",
      }}>
      <Icon name={icon} size={13} /> {label}
    </button>
  );
}

function Hint({ icon = "Info", children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-[10px] leading-snug" style={{ color: "var(--c-t4, #767f8c)" }}>
      <Icon name={icon} size={11} className="flex-shrink-0 mt-[1px]" />
      <span>{children}</span>
    </div>
  );
}

// ─── Вкладка ────────────────────────────────────────────────────────────────

export default function BranchWaterPipeTab({
  branch: b, onUpdate, waterBranchResult: r, onRemoveGate,
  onRemoveReducer, reducerSymbolScale, onReducerSymbolScale,
}: Props) {
  const hasWater = b.hasWaterPipe ?? false;
  const hasAir   = b.hasAirPipe ?? false;
  const branchLen = b.length ?? 0;

  const wpDiam = b.wpDiameter ?? 100;
  const roughMode = b.wpRoughnessMode ?? "rough";
  const solved = (r?.flow ?? 0) > 0;

  return (
    <div className="p-2 space-y-2" style={{ fontFamily: "var(--font-ui)" }}>

      {/* ═══ Водопровод ППЗ ══════════════════════════════════════════════ */}
      <PipeCard icon="Droplets" title="Водопровод ППЗ" enabled={hasWater}
        subtitle={`Ø${wpDiam} мм · ${b.wpMaterial ?? "Сталь"}`}
        onToggle={(v) => onUpdate({ hasWaterPipe: v })}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Диаметр">
            <NumInput value={wpDiam} min={0} step={5} unit="мм" onChange={(v) => onUpdate({ wpDiameter: v })} />
          </Field>
          <Field label="Материал">
            <MaterialSelect value={b.wpMaterial ?? "Сталь"} onChange={(v) => onUpdate({ wpMaterial: v })} />
          </Field>
        </div>
        <LengthField manual={b.wpLengthManual ?? false} value={b.wpLength ?? 0} branchLen={branchLen}
          onManual={(v) => onUpdate(v
            ? { wpLengthManual: true, wpLength: b.wpLength || Math.round(branchLen) }
            : { wpLengthManual: false })}
          onChange={(v) => onUpdate({ wpLength: v })} />

        <Field label="Сопротивление трубы">
          <Segmented value={roughMode}
            onChange={(v) => onUpdate({ wpRoughnessMode: v })}
            options={[
              { value: "smooth", label: "Гладкая", title: `Шероховатость ${SMOOTH_ROUGHNESS_MM} мм` },
              { value: "rough",  label: "Шероховатая", title: "Задать шероховатость стенки" },
              { value: "manual", label: "Своё R", title: "Задать сопротивление напрямую" },
            ]} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {roughMode === "rough" && (
            <Field label="Шероховатость">
              <NumInput value={b.wpRoughness ?? 0.5} min={0} step={0.05} unit="мм"
                onChange={(v) => onUpdate({ wpRoughness: v })} />
            </Field>
          )}
          {roughMode === "smooth" && (
            <Field label="Шероховатость">
              <ReadValue value={String(SMOOTH_ROUGHNESS_MM)} unit="мм" title="Фиксированное значение для гладкой трубы" />
            </Field>
          )}
          {roughMode === "manual" ? (
            <Field label="R трубы" hint="Длина, диаметр и ξ в расчёт не идут">
              <NumInput value={b.wpManualR ?? 0} min={0} step={0.001} unit="МН·с²/м⁸"
                onChange={(v) => onUpdate({ wpManualR: v })} />
            </Field>
          ) : (
            <Field label="Местные сопр. Σξ">
              <NumInput value={b.wpLocalXi ?? 0} min={0} step={0.5}
                onChange={(v) => onUpdate({ wpLocalXi: v })} />
            </Field>
          )}
        </div>
      </PipeCard>

      {hasWater && (<>
        {/* ═══ Результат расчёта ═════════════════════════════════════════ */}
        <Card icon="Gauge" title="Результат расчёта">
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="Расход воды" value={solved ? fmt(r?.flow, 1) : "—"} unit="м³/ч" />
            <Stat label="Скорость" value={solved ? fmt(r?.velocity, 2) : "—"} unit="м/с" />
          </div>
          <div>
            <KV label="Потери давления" value={solved ? fmt(r?.deltaP, 4) : "—"} unit="МПа" />
            <KV label="Сопротивление трубы" value={fmt(r?.resistance ?? 0, 4)} unit="МН·с²/м⁸" />
          </div>
          {!solved && (
            <Hint>
              {b.wpHasGate && b.wpGateClosed
                ? "Вентиль закрыт — вода по ветви не идёт."
                : "Воды в трубе нет: откройте потребителя (кран, ороситель) или выполните расчёт водопровода."}
            </Hint>
          )}
        </Card>

        {/* ═══ Запорный вентиль ══════════════════════════════════════════ */}
        {b.wpHasGate && (
          <Card icon="CircleDot" title="Запорный вентиль"
            aside={onRemoveGate && <RemoveBtn title="Убрать вентиль с ветви и схемы" onClick={onRemoveGate} />}>
            <div className="flex gap-1.5">
              <StateBtn on={!b.wpGateClosed} tone="green" icon="CircleCheck" label="Открыт"
                onClick={() => onUpdate({ wpGateClosed: false })} />
              <StateBtn on={!!b.wpGateClosed} tone="red" icon="CircleX" label="Закрыт"
                onClick={() => onUpdate({ wpGateClosed: true })} />
            </div>
            <Hint>{b.wpGateClosed ? "Течение воды в этой ветви перекрыто." : "Вода свободно проходит через ветвь."}</Hint>
          </Card>
        )}

        {/* ═══ Редукционный клапан ═══════════════════════════════════════ */}
        {b.wpHasReducer && (() => {
          const modelId = b.wpReducerModel ?? "kppr_50";
          const model = getValveById(modelId);
          const isManual = modelId === "manual";
          const outMinAtm = (model?.outletPressureMin ?? 0.1) * MPA_TO_ATM;
          const outMaxAtm = (model?.outletPressureMax ?? 9.9) * MPA_TO_ATM;
          const active = r?.reducerActive ?? false;
          const atm = (mpa: number | undefined) => `${fmt(mpa, 3)} МПа · ${fmt((mpa ?? 0) * MPA_TO_ATM, 1)} атм`;
          return (
            <Card icon="Gauge" title="Редукционный клапан"
              aside={<>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                  title={active ? "Клапан срезает давление" : "Давление на входе ниже настройки — клапан не работает"}
                  style={{
                    background: active ? "var(--c-tint-amber2, #fef3c7)" : "var(--c-s3, #f1efea)",
                    color: active ? "var(--c-amber, #a66b0d)" : "var(--c-t3, #6b7280)",
                  }}>
                  {active ? "Срезает" : "Не активен"}
                </span>
                {onRemoveReducer && <RemoveBtn title="Убрать клапан с ветви и схемы" onClick={onRemoveReducer} />}
              </>}>
              <Field label="Модель"
                hint={model && !isManual
                  ? `${model.manufacturer} · DN${model.nominalDiameter} · вход до ${fmt(model.inletPressureMax * MPA_TO_ATM, 0)} атм · до ${model.flowMax} м³/ч`
                  : undefined}>
                <select className={inputCls} style={selectStyle} value={modelId}
                  onChange={(e) => {
                    const valve = getValveById(e.target.value);
                    if (!valve) return;
                    onUpdate({
                      wpReducerModel: valve.id,
                      wpReducerMaxFlow: valve.id === "manual" ? (b.wpReducerMaxFlow ?? 25) : valve.flowMax,
                    });
                  }}>
                  {PRESSURE_REDUCING_VALVES.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Давление на выходе" hint={`${fmt(outMinAtm, 0)}–${fmt(outMaxAtm, 0)} атм`}>
                  <NumInput value={+((b.wpReducerOutPressure ?? 0.5) * MPA_TO_ATM).toFixed(1)}
                    min={outMinAtm} max={outMaxAtm} step={0.5} unit="атм"
                    onChange={(v) => onUpdate({ wpReducerOutPressure: v / MPA_TO_ATM })} />
                </Field>
                {isManual && (
                  <Field label="Макс. расход">
                    <NumInput value={b.wpReducerMaxFlow ?? 25} min={0} step={1} unit="м³/ч"
                      onChange={(v) => onUpdate({ wpReducerMaxFlow: v })} />
                  </Field>
                )}
              </div>
              {active && (
                <div>
                  <KV label="На входе" value={atm(r?.reducerInP)} />
                  <KV label="На выходе" value={atm(r?.reducerOutP)} />
                  <KV label="Срезано" value={atm(r?.reducerDeltaP)} />
                </div>
              )}
              {onReducerSymbolScale && (
                <div>
                  <div className="flex justify-between text-[10px] mb-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>
                    <span>Размер значка на схеме</span>
                    <span style={{ fontFamily: "var(--font-num)" }}>{Math.round((reducerSymbolScale ?? 1) * 100)} %</span>
                  </div>
                  <input type="range" min={5} max={400} step={5}
                    value={Math.round((reducerSymbolScale ?? 1) * 100)}
                    onChange={(e) => onReducerSymbolScale(Number(e.target.value) / 100)}
                    className="w-full" style={{ accentColor: "var(--c-accent, #1e5a7a)" }} />
                </div>
              )}
            </Card>
          );
        })()}
      </>)}

      {/* ═══ Воздухопровод ═══════════════════════════════════════════════ */}
      <PipeCard icon="Wind" title="Воздухопровод" enabled={hasAir}
        subtitle={`Сжатый воздух · Ø${b.apDiameter ?? 100} мм · ${fmt(b.apPressure ?? 6, 1)} атм`}
        onToggle={(v) => onUpdate({ hasAirPipe: v })}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Диаметр">
            <NumInput value={b.apDiameter ?? 100} min={0} step={5} unit="мм" onChange={(v) => onUpdate({ apDiameter: v })} />
          </Field>
          <Field label="Материал">
            <MaterialSelect value={b.apMaterial ?? "Сталь"} onChange={(v) => onUpdate({ apMaterial: v })} />
          </Field>
        </div>
        <Field label="Рабочее давление">
          <NumInput value={b.apPressure ?? 6} min={0} step={0.5} unit="атм" onChange={(v) => onUpdate({ apPressure: v })} />
        </Field>
        <LengthField manual={b.apLengthManual ?? false} value={b.apLength ?? 0} branchLen={branchLen}
          onManual={(v) => onUpdate(v
            ? { apLengthManual: true, apLength: b.apLength || Math.round(branchLen) }
            : { apLengthManual: false })}
          onChange={(v) => onUpdate({ apLength: v })} />
        <Hint>Воздухопровод показывается на схеме. Параметры справочные — расчёт сжатого воздуха пока не выполняется.</Hint>
      </PipeCard>
    </div>
  );
}
