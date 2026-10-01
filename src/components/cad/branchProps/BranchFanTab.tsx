// ─────────────────────────────────────────────────────────────────────────────
// BranchFanTab.tsx — вкладка «Вентилятор» панели свойств выработки.
//
// Карточки сверху вниз — в порядке работы инженера:
//   1. Паспорт: название, назначение (ГВУ/ВВУ/ВМП), работает/остановлен,
//      направление (прямой/реверс).
//   2. Режим работы: постоянный напор / характеристика / фиксированный расход
//      и поля выбранного режима (модель, лопатки, обороты, график Q–H).
//   3. Установка: число в параллели, внутри перемычки или нет, окно ΔS.
//   4. Результат расчёта: Q, H, N, КПД, R окна + предупреждения.
//   5. Значок на схеме: масштаб, убрать значок, удалить вентилятор.
//
// Формулы и поля данных — прежние. Что убрано:
//   • строка «+ : A → B» внизу — служебный вывод без подписи;
//   • «Диаметр, м» в расчётных — дублировал модель (Ø в списке моделей);
//   • размер подписи и «вернуть подпись» — переехали во вкладку «Индикаторы»
//     вентилятора, где выбирается и сама подпись;
//   • КПД при «постоянном напоре» стоял дважды (поле ввода и расчётное) —
//     теперь одно поле ввода, расчётное значение в результатах.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { useMemo, useState } from "react";
import { getFanById, fanQMax } from "@/lib/fanCurves";
import FanChart from "@/components/cad/FanChart";
import FanOperatingPointDialog from "@/components/cad/FanOperatingPointDialog";
import { useFanOpCurves, type BuiltCurve } from "@/components/cad/useFanOpCurves";
import { branchFanOpData, type FanOperatingPointData } from "@/lib/fanOperatingPointData";
import { FAN_OP_COLOR, FAN_NETWORK_COLOR, FAN_REVERSE_COLOR } from "@/lib/fanChartData";
import { type MineFanExport } from "@/components/cad/EquipmentRefDialog";
import { fanWindowRkMurg } from "@/lib/bulkheads";
import Icon from "@/components/ui/icon";
import {
  Card, Field, NumInput, ReadValue, Segmented, Stat, KV, inputCls, inputStyle,
} from "@/components/cad/propUi";

interface BranchFanTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  numFmt: (v: number, d?: number) => string;
  onRemoveFan?: () => void;
  fanSymbolScale?: number;
  onFanSymbolScale?: (scale: number) => void;
  /** Размер подписи и её сброс — теперь во вкладке «Индикаторы» вентилятора. */
  fanIndFontSize?: number;
  onFanIndFontSize?: (size: number) => void;
  onFanIndResetOffset?: () => void;
  onFanSymbolDelete?: () => void;
  /** Сменить направление вентилятора (куда дует), не трогая прямой/реверс. */
  onReverse?: () => void;
  normalFlows?: Record<string, number>;
  mineFans?: MineFanExport[];
  onOpenFanLibrary?: () => void;
}

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };

function Note({ tone, children }: { tone: "warn" | "info" | "danger"; children: React.ReactNode }) {
  const st = tone === "danger"
    ? { bg: "var(--c-tint-red, #fef2f2)", fg: "var(--c-red-ink, #991b1b)", icon: "OctagonAlert" }
    : tone === "warn"
      ? { bg: "var(--c-tint-amber, #fffbeb)", fg: "var(--c-amber-ink, #865412)", icon: "TriangleAlert" }
      : { bg: "var(--c-s2, #f8f7f4)", fg: "var(--c-t2, #3a3f45)", icon: "Info" };
  return (
    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[11px] leading-snug"
      style={{ background: st.bg, color: st.fg }}>
      <Icon name={st.icon} size={12} className="flex-shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}

/** Большая кнопка-состояние (работает/остановлен, прямой/реверс). */
function StateBtn({ on, onClick, disabled, icon, label, tone }: {
  on: boolean; onClick: () => void; disabled?: boolean; icon: string; label: string;
  tone: "green" | "amber" | "red";
}) {
  const c = tone === "green" ? "var(--c-green, #15803d)" : tone === "amber" ? "var(--c-amber, #a66b0d)" : "var(--c-red, #dc2626)";
  const bg = tone === "green" ? "var(--c-tint-green, #f0fdf4)" : tone === "amber" ? "var(--c-tint-amber2, #fef3c7)" : "var(--c-tint-red, #fef2f2)";
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex-1 h-8 rounded-md flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
      style={{
        background: on ? bg : "var(--c-s1, #fff)",
        color: on ? c : "var(--c-t3, #6b7280)",
        border: `1px solid ${on ? `color-mix(in srgb, ${c} 45%, transparent)` : "var(--c-b2, #d5d1c8)"}`,
        cursor: disabled ? "not-allowed" : "pointer",
      }}>
      <Icon name={icon} size={13} /> {label}
    </button>
  );
}

export default function BranchFanTab({
  branch, onUpdate, numFmt, onRemoveFan, fanSymbolScale, onFanSymbolScale,
  onFanSymbolDelete, onReverse, normalFlows, mineFans, onOpenFanLibrary,
}: BranchFanTabProps) {
  const b = branch;
  const isVmp = b.fanType === "ВМП";
  const curve = getFanById(b.fanCurveId);
  const inBulkhead = (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки";
  const autoDS = curve && curve.diameter > 0 ? Math.PI * curve.diameter * curve.diameter / 4 : 0;
  const dS = (b.fanWindowArea ?? 0) > 0.001 ? b.fanWindowArea : autoDS;
  const solved = Math.abs(b.flow ?? 0) > 0.01;
  const qShown = b.fanReverse && !isVmp ? -Math.abs(b.flow) : Math.abs(b.flow);

  return (
    <div className="p-2 space-y-2" style={{ fontFamily: "var(--font-ui)" }}>

      {/* ═══ 1. Паспорт ════════════════════════════════════════════════ */}
      <Card icon="Fan" title="Вентилятор">
        <Field label="Название (для подписи на схеме)">
          <input type="text" className={inputCls} style={inputStyle}
            value={b.fanName ?? ""} placeholder="Например, ВО-22/14АР"
            onChange={(e) => onUpdate({ fanName: e.target.value })} />
        </Field>
        <Field label="Назначение">
          <Segmented value={b.fanType ?? "ГВУ"}
            onChange={(v) => onUpdate({ fanType: v as "ГВУ" | "ВВУ" | "ВМП" })}
            options={[
              { value: "ГВУ", label: "ГВУ", title: "Главная вентиляторная установка" },
              { value: "ВВУ", label: "ВВУ", title: "Вспомогательная вентиляторная установка" },
              { value: "ВМП", label: "ВМП", title: "Вентилятор местного проветривания" },
            ]} />
        </Field>
        <div className="flex gap-1.5">
          <StateBtn on={!b.fanStopped} tone="green" icon="Play" label="Работает"
            onClick={() => onUpdate({ fanStopped: false })} />
          <StateBtn on={!!b.fanStopped} tone="amber" icon="Square" label="Остановлен"
            onClick={() => onUpdate({ fanStopped: true })} />
        </div>
        {onReverse && (
          <Field label="Куда дует" hint={`Сейчас: от узла ${b.fromId} к узлу ${b.toId}. Режим (прямой/реверс) не меняется.`}>
            <button type="button" onClick={onReverse}
              className="w-full h-8 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1.5"
              style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-accent, #1e5a7a)", color: "var(--c-accent, #1e5a7a)", cursor: "pointer" }}>
              <Icon name="ArrowLeftRight" size={13} /> Сменить направление вентилятора
            </button>
          </Field>
        )}
        {!isVmp ? (
          <>
            <div className="flex gap-1.5">
              <StateBtn on={!b.fanReverse} tone="green" icon="ArrowRight" label="Прямой"
                disabled={b.fanStopped} onClick={() => onUpdate({ fanReverse: false })} />
              <StateBtn on={!!b.fanReverse} tone="red" icon="ArrowLeft" label="Реверс"
                disabled={b.fanStopped} onClick={() => onUpdate({ fanReverse: true })} />
            </div>
            {b.fanReverse && normalFlows && Object.keys(normalFlows).length === 0 && (
              <Note tone="warn">Сначала выполните расчёт в прямом режиме — для проверки нормы ПБ (Q реверса ≥ 60 %).</Note>
            )}
          </>
        ) : (
          <Note tone="info">Реверса у ВМП нет — направление нагнетания меняется кнопкой «Сменить направление вентилятора».</Note>
        )}
      </Card>

      {/* ═══ 2. Режим работы ═══════════════════════════════════════════ */}
      <Card icon="SlidersHorizontal" title="Режим работы">
        <Segmented value={b.fanMode}
          onChange={(mode) => {
            // При первом переключении на «фиксированный расход» подставляем
            // текущий расход ветви — чтобы начинать с привычной рабочей точки.
            const patch: Partial<TopoBranch> = { fanMode: mode as TopoBranch["fanMode"] };
            if (mode === "fixed" && !(b.fanFixedQ && b.fanFixedQ > 0)) {
              patch.fanFixedQ = Math.round(Math.abs(b.flow ?? 0) * 100) / 100;
            }
            onUpdate(patch);
          }}
          options={[
            { value: "curve", label: "Характеристика", title: "Напорная характеристика модели из каталога" },
            { value: "constant", label: "Напор", title: "Постоянный напор, заданный вручную" },
            { value: "fixed", label: "Расход", title: "Фиксированный расход" },
          ]} />

        {b.fanMode === "constant" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Напор">
                <NumInput value={b.fanPressure} step={10} min={0} unit="Па" onChange={(v) => onUpdate({ fanPressure: v })} />
              </Field>
              <Field label="КПД">
                <NumInput value={Math.round(b.fanEfficiency * 100) || 65} step={1} min={1} max={100} unit="%"
                  onChange={(v) => onUpdate({ fanEfficiency: (v || 65) / 100 })} />
              </Field>
            </div>
            {b.fanPressure <= 0 && <Note tone="warn">Напор 0 Па — расчёт даст Q = 0. Задайте напор вентилятора.</Note>}
          </>
        )}

        {b.fanMode === "fixed" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Расход">
                <NumInput value={b.fanFixedQ ?? 0} step={0.1} min={0} unit="м³/с" onChange={(v) => onUpdate({ fanFixedQ: v })} />
              </Field>
              <Field label="КПД">
                <NumInput value={Math.round(b.fanEfficiency * 100) || 65} step={1} min={1} max={100} unit="%"
                  onChange={(v) => onUpdate({ fanEfficiency: (v || 65) / 100 })} />
              </Field>
            </div>
            {!(b.fanFixedQ && b.fanFixedQ > 0)
              ? <Note tone="warn">Расход 0 — задайте расход, который должен выдавать вентилятор.</Note>
              : <Note tone="info">Вентилятор выдаёт ровно {b.fanFixedQ} м³/с, напор подбирается расчётом под сопротивление сети.</Note>}
          </>
        )}

        {b.fanMode === "curve" && (
          <CurveMode branch={b} onUpdate={onUpdate} mineFans={mineFans} onOpenFanLibrary={onOpenFanLibrary} />
        )}
      </Card>

      {/* ═══ 3. Установка ══════════════════════════════════════════════ */}
      <Card icon="Blocks" title="Установка">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Вентиляторов в параллели">
            <NumInput value={b.fanParallel ?? 1} step={1} min={1} unit="шт" onChange={(v) => onUpdate({ fanParallel: Math.max(1, Math.round(v)) })} />
          </Field>
          <Field label="Окно ΔS" hint={inBulkhead ? (b.fanWindowArea > 0.001 ? undefined : "по колесу π·D²/4") : "нет перемычки"}>
            <ReadValue value={inBulkhead ? numFmt(dS, 2) : "—"} unit="м²" />
          </Field>
        </div>
        <Field label="Где установлен">
          <Segmented value={inBulkhead ? "in" : "out"}
            onChange={(v) => onUpdate({ fanInstall: v === "in" ? "Внутри перемычки" : "Без перемычки" })}
            options={[
              { value: "in", label: "В перемычке", title: "Вентилятор в окне перемычки — окно добавляет сопротивление" },
              { value: "out", label: "Без перемычки" },
            ]} />
        </Field>
      </Card>

      {/* ═══ 4. Результат расчёта ══════════════════════════════════════ */}
      <Card icon="Activity" title="Результат расчёта" tone="signal">
        {b.fanStopped && <Note tone="warn">Вентилятор остановлен — напор 0, воздух идёт по естественной тяге.</Note>}
        {!b.fanStopped && b.fanReverse && !isVmp && (() => {
          const eff = curve?.reverseEfficiencyFactor ?? 0.82;
          return <Note tone="danger">Реверс: напор ≈ {Math.round(eff * 100)} % от прямого, КПД ниже на {Math.round((1 - eff) * 100)} %.</Note>;
        })()}
        {(() => {
          if (b.fanMode !== "curve" || !solved || !curve) return null;
          const Q = Math.abs(b.flow);
          // Паспортный предел — общей функцией, как у решателя сети
          const qMaxScaled = fanQMax(curve, b.fanBladeAngle, b.fanRpm);
          if (Q <= qMaxScaled * 1.02) return null;
          return <Note tone="warn">Q = {Q.toFixed(2)} м³/с больше паспортного максимума {qMaxScaled.toFixed(1)} м³/с (угол {b.fanBladeAngle ?? "—"}°) — вентилятор вне рабочей зоны.</Note>;
        })()}

        {!solved && !b.fanStopped ? (
          <Note tone="info">Выполните «Расчёт сети» (F9), чтобы увидеть рабочую точку.</Note>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="Расход Q" value={numFmt(qShown, 2)} unit="м³/с" />
            <Stat label="Напор H" value={numFmt(Math.abs(b.fanPressure), 0)} unit="Па" />
            <Stat label="Мощность" value={numFmt(b.fanShaftPower / 1000, 1)} unit="кВт" />
            <Stat label="КПД" value={numFmt(b.fanEfficiency * 100, 1)} unit="%" />
          </div>
        )}

        {inBulkhead && dS > 0.001 && (() => {
          const sBr = b.area ?? 0;
          // Окно — сужение потока: R = ρ/(2·μ²)·(1/ΔS² − 1/S²). При ΔS ≥ S
          // сужения нет и R = 0 — показываем причину, а не голый ноль.
          const noSection = sBr <= 0.001;
          const windowTooBig = !noSection && dS >= sBr;
          return (
            <>
              <KV label="Сопротивление окна" value={numFmt(fanWindowRkMurg(dS, sBr), 4)} unit="кМюрг" />
              {windowTooBig && (
                <Note tone="warn">Окно ΔS = {numFmt(dS, 2)} м² не меньше сечения выработки S = {numFmt(sBr, 2)} м² — поток не сужается, R окна = 0.</Note>
              )}
              {noSection && (
                <Note tone="warn">У выработки не задано сечение — R окна посчитан как для очень большой выработки.</Note>
              )}
            </>
          );
        })()}
      </Card>

      {/* ═══ 5. Значок на схеме ════════════════════════════════════════ */}
      <Card icon="Shapes" title="Значок на схеме" tone="muted" collapsible defaultOpen={false}>
        {onFanSymbolScale && (
          <div>
            <div className="flex justify-between text-[10px] mb-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>
              <span>Размер значка</span>
              <span style={{ fontFamily: "var(--font-num)" }}>{Math.round((fanSymbolScale ?? 1) * 100)} %</span>
            </div>
            <input type="range" min={5} max={400} step={5}
              value={Math.round((fanSymbolScale ?? 1) * 100)}
              onChange={(e) => onFanSymbolScale(Number(e.target.value) / 100)}
              className="w-full" style={{ accentColor: "var(--c-accent, #1e5a7a)" }} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-1.5">
          {onFanSymbolDelete && (
            <button type="button" onClick={onFanSymbolDelete}
              className="h-7 rounded text-[11px] flex items-center justify-center gap-1"
              title="Убрать только значок — вентилятор в расчёте остаётся"
              style={{ background: "var(--c-s3, #f1efea)", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3a3f45)", cursor: "pointer" }}>
              <Icon name="EyeOff" size={12} /> Убрать значок
            </button>
          )}
        </div>
        {onRemoveFan && (
          <button type="button" onClick={onRemoveFan}
            className="w-full h-7 rounded text-[11px] flex items-center justify-center gap-1"
            title="Удалить вентилятор с выработки (из расчёта тоже)"
            style={{ background: "var(--c-tint-red, #fef2f2)", border: "1px solid color-mix(in srgb, var(--c-red, #dc2626) 35%, transparent)", color: "var(--c-red, #dc2626)", cursor: "pointer" }}>
            <Icon name="Trash2" size={12} /> Удалить вентилятор
          </button>
        )}
      </Card>
    </div>
  );
}

/** Режим «Напорная характеристика»: модель, лопатки, обороты, график Q–H. */
function CurveMode({ branch: b, onUpdate, mineFans, onOpenFanLibrary }: {
  branch: TopoBranch; onUpdate: (p: Partial<TopoBranch>) => void;
  mineFans?: MineFanExport[]; onOpenFanLibrary?: () => void;
}) {
  const curve = getFanById(b.fanCurveId);
  const [zoom, setZoom] = useState(false);
  const zoomData = useMemo(() => (zoom && curve ? branchFanOpData(b, curve) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoom, curve, b.id, b.fanRpm, b.fanBladeAngle, b.fanReverse, b.fanType, b.flow, b.fanPressure, b.fanParallel, b.fanStopped, b.fanName]);
  const rpm = b.fanRpm || (curve?.rpmNominal ?? 0);
  const bladeAngle = b.fanBladeAngle ?? (curve?.bladeAngles?.length ? curve.bladeAngles[Math.floor(curve.bladeAngles.length / 2)] : 45);

  if (!mineFans || mineFans.length === 0) {
    return (
      <button type="button" onClick={onOpenFanLibrary}
        className="w-full flex items-start gap-2 px-2 py-2 rounded text-left text-[11px] leading-snug"
        style={{ background: "var(--c-tint-amber, #fffbeb)", color: "var(--c-amber-ink, #865412)", border: "none", cursor: "pointer" }}>
        <Icon name="BookPlus" size={14} className="flex-shrink-0 mt-px" />
        <span>Вентиляторы рудника не добавлены. <span className="underline">Открыть «Справочники → Вентиляторы»</span></span>
      </button>
    );
  }

  return (
    <>
      <Field label="Модель">
        <div className="flex gap-1">
          <select className={`${inputCls} flex-1`} style={selectStyle} value={b.fanCurveId}
            onChange={(e) => {
              const f = getFanById(e.target.value);
              // Окно ΔS по умолчанию = площадь рабочего колеса π·D²/4
              const dS = f && f.diameter > 0 ? Math.round((Math.PI * f.diameter * f.diameter / 4) * 100) / 100 : 0;
              onUpdate({
                fanCurveId: e.target.value,
                fanName: f?.name ?? "",
                fanRpm: f ? (f.rpmNominal ?? 0) : 0,
                fanBladeAngle: f?.bladeAngles?.length ? f.bladeAngles[Math.floor(f.bladeAngles.length / 2)] : 45,
                fanWindowArea: dS,
              });
            }}>
            <option value="">— выберите модель —</option>
            {mineFans.map(mf => getFanById(mf.catalogId)).filter((f): f is NonNullable<typeof f> => !!f)
              .filter((f, i, arr) => arr.findIndex(x => x.id === f.id) === i)
              .map((f) => (
                <option key={f.id} value={f.id}>{f.name} (Ø{f.diameter} м){f.isUser ? " — свой" : ""}</option>
              ))}
          </select>
          {onOpenFanLibrary && (
            <button type="button" onClick={onOpenFanLibrary} title="Справочник вентиляторов рудника"
              className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded"
              style={{ background: "var(--c-s3, #f1efea)", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3a3f45)", cursor: "pointer" }}>
              <Icon name="BookOpen" size={13} />
            </button>
          )}
        </div>
      </Field>

      {curve && (
        <>
          {curve.bladeAngles.length > 0 && (
            <Field label="Угол лопаток">
              <select className={inputCls} style={selectStyle} value={bladeAngle}
                onChange={(e) => onUpdate({ fanBladeAngle: Number(e.target.value) })}>
                {curve.bladeAngles.map(a => <option key={a} value={a}>{a}°</option>)}
              </select>
            </Field>
          )}
          <div>
            <div className="flex justify-between text-[10px] mb-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>
              <span>Частота вращения</span>
              <span style={{ fontFamily: "var(--font-num)", color: "var(--c-t1, #1f2328)" }}>{rpm} об/мин</span>
            </div>
            <input type="range" min={curve.rpmMin} max={curve.rpmMax} step={10} value={rpm}
              onChange={(e) => onUpdate({ fanRpm: Number(e.target.value) })}
              className="w-full" style={{ accentColor: "var(--c-accent, #1e5a7a)" }} />
            <div className="flex justify-between text-[9px]" style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-num)" }}>
              <span>{curve.rpmMin}</span><span>{curve.rpmMax}</span>
            </div>
          </div>
          <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--c-b1, #e7e4dd)", background: "var(--c-s1, #fff)" }}>
            <FanOpMiniChart branch={b} onPickAngle={(a) => onUpdate({ fanBladeAngle: a })} onZoom={() => setZoom(true)} />
            <div className="px-2 pb-1.5 flex gap-x-3 gap-y-0.5 text-[9px] justify-center flex-wrap" style={{ color: "var(--c-t3, #6b7280)" }}>
              <span style={{ color: "var(--c-t1, #1f2328)" }}>━ выбранный угол {bladeAngle}°</span>
              <span>━ другие (клик — выбрать)</span>
              {curve.reverseH0 !== undefined && b.fanType !== "ВМП" && <span style={{ color: FAN_REVERSE_COLOR }}>┅ реверс</span>}
              {Math.abs(b.flow) > 0.01 && !b.fanStopped && <>
                <span style={{ color: FAN_NETWORK_COLOR }}>┅ сеть R·Q²</span>
                <span style={{ color: FAN_OP_COLOR }}>● рабочая точка</span>
              </>}
            </div>
          </div>
          {zoomData && (
            <FanOperatingPointDialog data={zoomData} onClose={() => setZoom(false)}
              onPickAngle={curve.bladeAngles.length > 1 ? (a) => onUpdate({ fanBladeAngle: a }) : undefined} />
          )}
        </>
      )}
    </>
  );
}

/**
 * График рабочей точки ветви — тот же график, что в справочнике вентиляторов
 * и в окне увеличенного просмотра (общие данные branchFanOpData): все углы
 * лопаток на оборотах ветви, выбранный угол выделен, реверс, характеристика
 * сети R·Q² и рабочая точка из расчёта. Клик по кривой — выбрать угол.
 */
function FanOpMiniChart({ branch: b, onPickAngle, onZoom }: {
  branch: TopoBranch; onPickAngle: (a: number) => void; onZoom: () => void;
}) {
  const curve = getFanById(b.fanCurveId);
  const data = useMemo(() => (curve ? branchFanOpData(b, curve) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [curve, b.id, b.fanRpm, b.fanBladeAngle, b.fanReverse, b.fanType, b.flow, b.fanPressure, b.fanParallel, b.fanStopped, b.fanName]);
  if (!curve || !data) return null;
  return <FanOpMiniChartInner data={data} onPickAngle={onPickAngle} onZoom={onZoom} />;
}

function FanOpMiniChartInner({ data, onPickAngle, onZoom }: {
  data: FanOperatingPointData; onPickAngle: (a: number) => void; onZoom: () => void;
}) {
  const { fwdCurves, revCurves, networks } = useFanOpCurves(data);
  const rev = !!data.selected?.reverse;
  // В прямом режиме реверсная кривая — бледным пунктиром для сравнения
  const curves = rev ? [...revCurves, ...fwdCurves.map(c => ({ ...c, highlight: false }))] : [...fwdCurves, ...revCurves.map(c => ({ ...c, highlight: false }))];
  const pts = data.points.filter(p => p.reverse === rev);
  return (
    <div className="relative">
      <FanChart curves={curves} type="qh" operatingPoints={pts} networks={networks(rev)}
        width={300} height={170} fluid
        onCurveClick={c => { const bc = c as BuiltCurve; if (!bc.reverse) onPickAngle(bc.angle); }} />
      <button type="button" onClick={onZoom} title="Увеличить график, PNG и выгрузка рабочей точки в Excel"
        className="absolute top-1 right-1 h-6 px-1.5 rounded flex items-center gap-1 text-[10px]"
        style={{ background: "var(--c-s1, #fff)", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3a3f45)", cursor: "pointer" }}>
        <Icon name="Maximize2" size={11} /> Увеличить
      </button>
    </div>
  );
}
