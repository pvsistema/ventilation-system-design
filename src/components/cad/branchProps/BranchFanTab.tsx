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
//   5. Значок на схеме: масштаб, развернуть ветвь, удалить значок/вентилятор.
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
import { FAN_CATALOG, getFanById, fanQMax, fanHAngle } from "@/lib/fanCurves";
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
          <Note tone="info">У ВМП направление нагнетания меняется разворотом ветви (Ctrl+R).</Note>
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
        <div className="grid grid-cols-2 gap-1.5">
          {onReverse && (
            <button type="button" onClick={onReverse}
              className="h-7 rounded text-[11px] flex items-center justify-center gap-1"
              title="Поменять начало и конец ветви местами"
              style={{ background: "var(--c-s3, #f1efea)", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3a3f45)", cursor: "pointer" }}>
              <Icon name="ArrowLeftRight" size={12} /> Развернуть ветвь
            </button>
          )}
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
            {FAN_CATALOG.filter(f => mineFans.some(mf => mf.catalogId === f.id)).map((f) => (
              <option key={f.id} value={f.id}>{f.name} (Ø{f.diameter} м)</option>
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
          <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--c-b1, #e7e4dd)", background: "var(--c-s2, #f8f7f4)" }}>
            <FanQHChart branch={b} rpm={rpm} bladeAngle={bladeAngle} onPickAngle={(a) => onUpdate({ fanBladeAngle: a })} />
            <div className="px-2 pb-1.5 flex gap-3 text-[9px] justify-center flex-wrap" style={{ color: "var(--c-t3, #6b7280)" }}>
              <span style={{ color: "var(--c-accent, #1e5a7a)" }}>━ выбранный угол</span>
              <span>┅ другие (клик — выбрать)</span>
              {Math.abs(b.flow) > 0.01 && <span style={{ color: "var(--c-red, #dc2626)" }}>● рабочая точка</span>}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** График Q–H: кривые по углам лопаток (закон подобия по оборотам), реверс, рабочая точка. */
function FanQHChart({ branch: b, rpm, bladeAngle, onPickAngle }: {
  branch: TopoBranch; rpm: number; bladeAngle: number; onPickAngle: (a: number) => void;
}) {
  const curve = getFanById(b.fanCurveId);
  if (!curve) return null;
  const W = 260, H = 130, padL = 36, padR = 8, padT = 8, padB = 24;
  const gW = W - padL - padR, gH = H - padT - padB;
  // Закон подобия: Q ~ n/n0, H ~ (n/n0)²
  const k = rpm > 0 && curve.rpmNominal > 0 ? rpm / curve.rpmNominal : 1;
  const qMin = curve.qMin * k, qMax = curve.qMax * k;
  const angles = curve.bladeAngles.length > 0 ? curve.bladeAngles : [bladeAngle];

  // Напор — общей функцией fanHAngle, как у расчёта сети
  let hMax = 0;
  angles.forEach(a => {
    for (let i = 0; i <= 20; i++) {
      const h = fanHAngle(curve, curve.qMin + (curve.qMax - curve.qMin) * i / 20, a) * k * k;
      if (h > hMax) hMax = h;
    }
  });
  hMax = Math.ceil(hMax / 500) * 500 || 2000;
  const tx = (q: number) => padL + (q - qMin) / (qMax - qMin) * gW;
  const ty = (h: number) => padT + gH - Math.max(0, Math.min(1, h / hMax)) * gH;
  const qWork = Math.abs(b.flow);
  const R = qWork > 0.01 ? b.fanPressure / (qWork * qWork) : 0;
  const axis = { fill: "var(--c-t3, #6b7280)" };
  const grid = { stroke: "var(--c-b1, #e7e4dd)" };

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", fontFamily: "var(--font-num)" }}>
      <rect x={padL} y={padT} width={gW} height={gH} style={{ fill: "var(--c-s1, #fff)", stroke: "var(--c-b2, #d5d1c8)" }} strokeWidth={0.5} />
      {Array.from({ length: 5 }, (_, i) => Math.round(hMax * i / 4)).map(h => (
        <g key={h}>
          <line x1={padL} y1={ty(h)} x2={padL + gW} y2={ty(h)} style={grid} strokeWidth={0.5} />
          <text x={padL - 3} y={ty(h) + 3} textAnchor="end" fontSize={8} style={axis}>{h}</text>
        </g>
      ))}
      {Array.from({ length: 5 }, (_, i) => Math.round(qMin + (qMax - qMin) * i / 4)).map(q => (
        <g key={q}>
          <line x1={tx(q)} y1={padT} x2={tx(q)} y2={padT + gH} style={grid} strokeWidth={0.5} />
          <text x={tx(q)} y={padT + gH + 10} textAnchor="middle" fontSize={8} style={axis}>{q}</text>
        </g>
      ))}
      <g opacity={b.fanReverse ? 0.35 : 1}>
        {angles.map(a => {
          // Кривая — до паспортного предела ДЛЯ ЭТОГО угла
          const qMaxA = fanQMax(curve, a);
          const pts = Array.from({ length: 31 }, (_, i) => {
            const qn = curve.qMin + (qMaxA - curve.qMin) * i / 30;
            return `${tx(qn * k).toFixed(1)},${ty(fanHAngle(curve, qn, a) * k * k).toFixed(1)}`;
          });
          const sel = a === bladeAngle;
          return (
            <polyline key={a} points={pts.join(" ")} fill="none"
              style={{ stroke: sel ? "var(--c-accent, #1e5a7a)" : "var(--c-blue-lt, #81b0c4)", cursor: "pointer" }}
              strokeWidth={sel ? 2 : 1} strokeDasharray={sel ? undefined : "3,2"} opacity={sel ? 1 : 0.7}
              onClick={() => onPickAngle(a)}>
              <title>Угол {a}°</title>
            </polyline>
          );
        })}
      </g>
      {curve.reverseH0 !== undefined && curve.reverseH1 !== undefined && curve.reverseH2 !== undefined && (() => {
        const revQMax = (curve.reverseQMax ?? curve.qMax) * k;
        const pts: string[] = [];
        for (let i = 0; i <= 30; i++) {
          const qn = curve.qMin + (curve.qMax - curve.qMin) * i / 30;
          if (qn * k > revQMax) break;
          const hr = Math.max(0, curve.reverseH0! + curve.reverseH1! * qn + curve.reverseH2! * qn * qn) * k * k;
          pts.push(`${tx(qn * k).toFixed(1)},${ty(hr).toFixed(1)}`);
        }
        return (
          <polyline points={pts.join(" ")} fill="none" style={{ stroke: "var(--c-red, #dc2626)" }}
            strokeWidth={b.fanReverse ? 2 : 1} strokeDasharray={b.fanReverse ? undefined : "5,3"} opacity={b.fanReverse ? 1 : 0.4}>
            <title>Реверс</title>
          </polyline>
        );
      })()}
      {qWork > 0.01 && (
        <>
          <polyline fill="none" style={{ stroke: "var(--c-signal, #e8a317)" }} strokeWidth={1} strokeDasharray="4,2"
            points={Array.from({ length: 20 }, (_, i) => {
              const q = qMin + (qMax - qMin) * i / 19;
              return `${tx(q).toFixed(1)},${ty(R * q * q).toFixed(1)}`;
            }).join(" ")} />
          <circle cx={tx(qWork)} cy={ty(Math.abs(b.fanPressure))} r={4} style={{ fill: "var(--c-red, #dc2626)", stroke: "var(--c-s1, #fff)" }} strokeWidth={1} />
        </>
      )}
      <text x={padL + gW / 2} y={H - 2} textAnchor="middle" fontSize={8} style={axis}>Q, м³/с</text>
      <text x={6} y={padT + gH / 2} textAnchor="middle" fontSize={8} style={axis}
        transform={`rotate(-90,6,${padT + gH / 2})`}>H, Па</text>
    </svg>
  );
}
