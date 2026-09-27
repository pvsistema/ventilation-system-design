// ─────────────────────────────────────────────────────────────────────────────
// BranchFireLoadTab.tsx — вкладка «Пож.нагрузка» панели свойств выработки.
//
// Сверху — «Итог по ветви»: суммарная мощность, нагрев воздуха, теплозапас.
// Ниже — по карточке на каждый источник (техника, лента, кабель, крепь).
// Карточка включается переключателем в заголовке; у включённой видны
// основные размеры, справочные свойства материала (ψ, ρ, Q_н) спрятаны
// в раскрывающийся блок, результат — плитками.
//
// Формулы — прежние (calcVehicleFire / calcBelt / calcCableFire /
// calcLinearFire), те же, что в акте устойчивости (fireStability.ts).
//
// Что исправлено при переделке:
//   • Колонка «Расход, м³/с» повторялась в каждой из пяти таблиц с одним и
//     тем же числом — теперь расход показан один раз, в итоге.
//   • У техники выводилась «t прод.» (20 + ΔT), у остальных — «ΔT» в той же
//     колонке; сравнить было нельзя. Теперь везде ΔT, а t продуктов — в итоге.
//   • Суммарный теплозапас не учитывал технику (heat: 0) — теперь берётся
//     сумма энергии материалов техники.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, type ReactNode } from "react";
import { type TopoBranch } from "@/lib/topology";
import {
  calcVehicleFire, calcBelt, calcLinearFire, calcCableFire, cableInputsOf,
  CABLE_DEFAULT_COUNT, CABLE_DEFAULT_FLAME_SPEED, CABLE_DEFAULT_CALC_TIME,
} from "@/lib/fireCalculator";
import Icon from "@/components/ui/icon";
import { Card, Field, NumInput, Stat, KV, inputCls, inputStyle } from "@/components/cad/propUi";

interface BranchFireLoadTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
}

/** Температура воздуха до очага, °C — та же база, что в расчёте техники. */
const AMBIENT_C = 20;

// ─── Вспомогательные элементы ───────────────────────────────────────────────

const fin = (v: number) => Number.isFinite(v) ? v : 0;
const fmt = (v: number, d: number) => Number.isFinite(v) ? v.toFixed(d) : "—";
const toNum = (s: string | undefined) => {
  const v = parseFloat((s ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : undefined;
};

/** Компактный переключатель для заголовка карточки. */
function Toggle({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} title={title}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className="relative flex-shrink-0 rounded-full transition-colors"
      style={{
        width: 28, height: 16, border: "none", cursor: "pointer",
        background: checked ? "var(--c-signal, #e8a317)" : "var(--c-b2, #d5d1c8)",
      }}>
      <span className="absolute top-[2px] rounded-full transition-all"
        style={{ width: 12, height: 12, left: checked ? 14 : 2, background: "var(--c-s1, #fff)" }} />
    </button>
  );
}

/** Карточка источника: иконка, название, переключатель; тело — только у включённого. */
function SourceCard({ icon, title, subtitle, enabled, onToggle, children }: {
  icon: string; title: string; subtitle?: string; enabled: boolean;
  onToggle: (v: boolean) => void; children: ReactNode;
}) {
  const color = enabled ? "var(--c-signal, #e8a317)" : "var(--c-t4, #767f8c)";
  return (
    <section className="rounded-lg overflow-hidden"
      style={{
        background: "var(--c-s1, #fff)",
        border: `1px solid ${enabled ? "color-mix(in srgb, var(--c-signal, #e8a317) 45%, transparent)" : "var(--c-b1, #e7e4dd)"}`,
      }}>
      <div className="flex items-center gap-2 px-2.5 py-2 select-none cursor-pointer" onClick={() => onToggle(!enabled)}>
        <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <Icon name={icon} size={13} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wider truncate"
            style={{ color: enabled ? "var(--c-t1, #1f2328)" : "var(--c-t3, #6b7280)" }}>{title}</span>
          {subtitle && (
            <span className="block text-[10px] truncate" style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-num)" }}>
              {subtitle}
            </span>
          )}
        </span>
        <Toggle checked={enabled} onChange={onToggle} title={enabled ? "Исключить источник" : "Учесть источник"} />
      </div>
      {enabled && <div className="px-2.5 pb-2.5 pt-0.5 space-y-2">{children}</div>}
    </section>
  );
}

/** Раскрывающийся блок для справочных (редко меняемых) свойств. */
function More({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded" style={{ background: "var(--c-s2, #f8f7f4)" }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-2 h-6 text-[10px] font-medium text-left"
        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-t3, #6b7280)" }}>
        <Icon name="ChevronRight" size={11} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
        {title}
      </button>
      {open && <div className="px-2 pb-2 grid grid-cols-2 gap-2">{children}</div>}
    </div>
  );
}

/** Поле названия источника (попадает в акт и описания). */
function NameInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <Field label="Название">
      <input className={inputCls} style={inputStyle} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Кнопка «= длина ветви» рядом с подписью поля длины. */
function FromBranch({ len, onClick }: { len: string; onClick: () => void }) {
  if (!len) return null;
  return (
    <button type="button" onClick={onClick} title={`Подставить длину выработки (${len} м)`}
      className="px-1 rounded text-[9px]"
      style={{ background: "var(--c-s3, #f1efea)", border: "none", cursor: "pointer", color: "var(--c-accent, #1e5a7a)" }}>
      = ветви
    </button>
  );
}

/** Плитки результата источника + пояснение, если данных не хватает. */
function SourceResult({ power, dT, children }: { power?: number; dT?: number; children?: ReactNode }) {
  if (power === undefined) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px]"
        style={{ background: "var(--c-tint-amber, #fff7ed)", color: "var(--c-amber-ink, #9a3412)" }}>
        <Icon name="TriangleAlert" size={11} />
        Заполните все параметры — все значения должны быть больше нуля
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="Мощность" value={fmt(power, 2)} unit="МВт" />
        <Stat label="Нагрев воздуха ΔT" value={dT && dT > 0 ? fmt(dT, 1) : "—"} unit="°C" />
      </div>
      {children && <div>{children}</div>}
    </div>
  );
}

type StrNumProps = {
  label: string; k: keyof TopoBranch; value: string; unit?: string; step?: number;
  aside?: ReactNode; hint?: string; onUpdate: (patch: Partial<TopoBranch>) => void;
};

/** Числовое поле для параметров, которые в схеме хранятся строкой. */
function StrNumField({ label, k, value, unit, step, aside, hint, onUpdate }: StrNumProps) {
  return (
    <Field label={label} aside={aside} hint={hint}>
      <NumInput value={toNum(value)} min={0} step={step} unit={unit}
        onChange={(v) => onUpdate({ [k]: String(v) } as Partial<TopoBranch>)} />
    </Field>
  );
}

// ─── Вкладка ────────────────────────────────────────────────────────────────

export default function BranchFireLoadTab({ branch: b, onUpdate }: BranchFireLoadTabProps) {
  // Расход для расчёта — ШТАТНЫЙ (до пожара), как в Аэросети. При активном
  // пожаре расход ветви очага может быть снижен тепловой депрессией; если
  // считать по нему, температура нефизично завышается (729°C вместо ~226°C).
  const airFlow = Math.abs(b.originalFlow ?? b.flow ?? 0);
  // Длина ветви — значение по умолчанию для длины горючего материала.
  const branchLenStr = b.length > 0 ? String(Math.round(b.length)) : "";

  const onTech  = b.fireLoadTech ?? false;
  const onBelt  = b.fireLoadConveyor ?? false;
  const onCable = b.fireLoadCable ?? false;
  const onWood  = b.fireLoadWoodSupport ?? false;

  // ── Техника ──
  const massRubber = b.fireVehicleMassRubber ?? 1200;
  const massDiesel = b.fireVehicleMassDiesel ?? 400;
  const massOil    = b.fireVehicleMassOil    ?? 200;
  const vfr = onTech ? calcVehicleFire([massRubber, massDiesel, massOil], airFlow) : null;
  const vfrHeat = vfr ? vfr.materials.reduce((s, m) => s + m.energy_MJ, 0) : 0;

  // ── Конвейерная лента ──
  const belt = {
    burnRate:   b.fireBeltBurnRate   ?? "0.013",
    density:    b.fireBeltDensity    ?? "1200",
    width:      b.fireBeltWidth      ?? "1.2",
    length:     b.fireBeltLength     ?? (branchLenStr || "100"),
    thickness:  b.fireBeltThickness  ?? "0.016",
    flameSpeed: b.fireBeltFlameSpeed ?? "0.013",
  };
  const beltRes = onBelt ? calcBelt(belt, airFlow) : null;

  // ── Кабель: собственная модель (S = π·d·L, пучок, нарастание пламени) ──
  const cableIn = cableInputsOf(b, branchLenStr);
  const cableRes = onCable ? calcCableFire(cableIn, airFlow) : null;

  // ── Деревянная крепь ──
  const wood = {
    heatValue:    b.fireWoodHeatValue  ?? "13.8",
    burnRate:     b.fireWoodBurnRate   ?? "0.027",
    density:      b.fireWoodDensity    ?? "500",
    length:       b.fireWoodLength     ?? (branchLenStr || "50"),
    sectionWidth: b.fireWoodWidth      ?? "8.9",
    sectionThick: b.fireWoodThick      ?? "0.08",
    flameSpeed:   b.fireWoodFlameSpeed ?? "0.024",
    calcTime:     b.fireWoodCalcTime   ?? "10",
  };
  const woodRes = onWood ? calcLinearFire(wood, airFlow) : null;

  // ── Итог по ветви ──
  const sources = [
    vfr     && { power: vfr.power_MW,     dT: vfr.deltaT_C,     heat: vfrHeat },
    beltRes && { power: beltRes.powerMax, dT: beltRes.deltaT_C, heat: beltRes.heatTotal },
    cableRes&& { power: cableRes.powerMW, dT: cableRes.deltaT_C, heat: cableRes.heatTotal },
    woodRes && { power: woodRes.powerMW,  dT: woodRes.deltaT_C,  heat: woodRes.heatTotal },
  ].filter((s): s is { power: number; dT: number; heat: number } => !!s);
  const totalPower = sources.reduce((a, s) => a + fin(s.power), 0);
  const totalDT    = sources.reduce((a, s) => a + fin(s.dT), 0);
  const totalHeat  = sources.reduce((a, s) => a + fin(s.heat), 0);
  const enabledCount = [onTech, onBelt, onCable, onWood].filter(Boolean).length;


  return (
    <div className="p-2 space-y-2" style={{ fontFamily: "var(--font-ui)" }}>

      {/* ═══ Итог по ветви ═══════════════════════════════════════════════ */}
      <Card icon="Flame" title="Итог по ветви" tone="signal"
        aside={enabledCount > 0 && (
          <span className="text-[10px]" style={{ color: "var(--c-t4, #767f8c)" }}>
            источников: {enabledCount}
          </span>
        )}>
        {sources.length === 0 ? (
          <div className="text-[11px] leading-snug" style={{ color: "var(--c-t3, #6b7280)" }}>
            {enabledCount === 0
              ? "Пожарной нагрузки нет. Включите источники горения ниже — их мощность пойдёт в расчёт устойчивости проветривания."
              : "Заполните параметры включённых источников."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Мощность пожара" value={fmt(totalPower, 2)} unit="МВт" danger />
              <Stat label="t продуктов горения" value={totalDT > 0 ? fmt(AMBIENT_C + totalDT, 0) : "—"} unit="°C"
                hint={`${AMBIENT_C} °C + нагрев воздуха ΔT`} />
            </div>
            <div>
              <KV label="Нагрев воздуха ΔT" value={totalDT > 0 ? fmt(totalDT, 1) : "—"} unit="°C" />
              <KV label="Теплозапас" value={fmt(totalHeat, 0)} unit="МДж" />
              <KV label="Расход воздуха (до пожара)" value={airFlow > 0 ? fmt(airFlow, 1) : "—"} unit="м³/с"
                title="Штатный расход до пожара — по нему считается нагрев" />
            </div>
          </>
        )}
        {airFlow <= 0 && enabledCount > 0 && (
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--c-t4, #767f8c)" }}>
            <Icon name="Info" size={11} />
            Нет расхода воздуха — выполните расчёт сети, чтобы получить нагрев.
          </div>
        )}
      </Card>

      {/* ═══ Техника ═════════════════════════════════════════════════════ */}
      <SourceCard icon="Truck" title="Самоходная техника" enabled={onTech}
        subtitle={vfr ? `${fmt(vfr.power_MW, 2)} МВт` : (b.fireVehicleName || undefined)}
        onToggle={(v) => onUpdate({ fireLoadTech: v })}>
        <NameInput value={b.fireVehicleName ?? ""} placeholder="Марка, например ПДМ LH-410"
          onChange={(v) => onUpdate({ fireVehicleName: v })} />
        <div className="grid grid-cols-3 gap-2">
          <Field label="Резина">
            <NumInput value={massRubber} min={0} step={10} unit="кг" onChange={(v) => onUpdate({ fireVehicleMassRubber: v })} />
          </Field>
          <Field label="Дизель">
            <NumInput value={massDiesel} min={0} step={10} unit="кг" onChange={(v) => onUpdate({ fireVehicleMassDiesel: v })} />
          </Field>
          <Field label="Масло">
            <NumInput value={massOil} min={0} step={10} unit="кг" onChange={(v) => onUpdate({ fireVehicleMassOil: v })} />
          </Field>
        </div>
        {vfr && (
          <SourceResult power={vfr.power_MW} dT={vfr.deltaT_C}>
            <KV label="Время горения" value={`${fmt(vfr.burnTime_min, 0)}`} unit="мин" />
            <KV label="Теплозапас" value={fmt(vfrHeat, 0)} unit="МДж" />
          </SourceResult>
        )}
      </SourceCard>

      {/* ═══ Конвейерная лента ═══════════════════════════════════════════ */}
      <SourceCard icon="ArrowRightLeft" title="Конвейерная лента" enabled={onBelt}
        subtitle={beltRes ? `${fmt(beltRes.powerMax, 2)} МВт` : undefined}
        onToggle={(v) => onUpdate(v
          ? { fireLoadConveyor: true, fireBeltLength: branchLenStr || b.fireBeltLength || "100" }
          : { fireLoadConveyor: false })}>
        <NameInput value={b.fireBeltName ?? "Конвейерная лента"} placeholder="Конвейерная лента"
          onChange={(v) => onUpdate({ fireBeltName: v })} />
        <div className="grid grid-cols-2 gap-2">
          <StrNumField onUpdate={onUpdate} label="Длина конвейера" k="fireBeltLength" value={belt.length} unit="м"
            aside={<FromBranch len={branchLenStr} onClick={() => onUpdate({ fireBeltLength: branchLenStr })} />} />
          <StrNumField onUpdate={onUpdate} label="Ширина ленты" k="fireBeltWidth" value={belt.width} unit="м" step={0.1} />
          <StrNumField onUpdate={onUpdate} label="Толщина ленты" k="fireBeltThickness" value={belt.thickness} unit="м" step={0.001} />
          <StrNumField onUpdate={onUpdate} label="Скорость пламени" k="fireBeltFlameSpeed" value={belt.flameSpeed} unit="м/с" step={0.001} />
        </div>
        <More title="Свойства материала ленты">
          <StrNumField onUpdate={onUpdate} label="Скорость выгорания ψ" k="fireBeltBurnRate" value={belt.burnRate} unit="кг/м²с" step={0.001} />
          <StrNumField onUpdate={onUpdate} label="Плотность ρ" k="fireBeltDensity" value={belt.density} unit="кг/м³" step={50} />
        </More>
        <SourceResult power={beltRes?.powerMax} dT={beltRes?.deltaT_C}>
          {beltRes && <>
            <KV label="Мощность через 30 / 60 мин" value={`${fmt(beltRes.power30, 2)} / ${fmt(beltRes.power60, 2)}`} unit="МВт" />
            <KV label="Масса ленты" value={fmt(beltRes.mass, 0)} unit="кг" />
            <KV label="Теплозапас" value={fmt(beltRes.heatTotal, 0)} unit="МДж" />
            {Number.isFinite(beltRes.burnTime_min) && (
              <KV label="Время горения" value={fmt(beltRes.burnTime_min, 0)} unit="мин" />
            )}
          </>}
        </SourceResult>
      </SourceCard>

      {/* ═══ Кабель ══════════════════════════════════════════════════════ */}
      <SourceCard icon="Cable" title="Кабельная трасса" enabled={onCable}
        subtitle={cableRes ? `${fmt(cableRes.powerMW, 2)} МВт` : undefined}
        onToggle={(v) => onUpdate(v
          ? { fireLoadCable: true, fireCableLength: branchLenStr || b.fireCableLength || "100" }
          : { fireLoadCable: false })}>
        <NameInput value={b.fireCableName ?? "Электрокабель"} placeholder="Электрокабель"
          onChange={(v) => onUpdate({ fireCableName: v })} />
        <div className="grid grid-cols-2 gap-2">
          <StrNumField onUpdate={onUpdate} label="Длина трассы" k="fireCableLength" value={cableIn.length} unit="м"
            aside={<FromBranch len={branchLenStr} onClick={() => onUpdate({ fireCableLength: branchLenStr })} />} />
          <StrNumField onUpdate={onUpdate} label="Кабелей в пучке" k="fireCableCount" value={cableIn.count ?? CABLE_DEFAULT_COUNT} unit="шт" step={1} />
          <StrNumField onUpdate={onUpdate} label="Диаметр кабеля" k="fireCableDiameter" value={cableIn.diameter} unit="м" step={0.005} />
          <StrNumField onUpdate={onUpdate} label="Толщина изоляции" k="fireCableInsulThick" value={cableIn.insulThick} unit="м" step={0.001} />
        </div>
        <More title="Свойства изоляции и режим горения">
          <StrNumField onUpdate={onUpdate} label="Теплота сгорания Q_н" k="fireCableHeatValue" value={cableIn.heatValue} unit="МДж/кг" />
          <StrNumField onUpdate={onUpdate} label="Скорость выгорания ψ" k="fireCableBurnRate" value={cableIn.burnRate} unit="кг/м²с" step={0.001} />
          <StrNumField onUpdate={onUpdate} label="Плотность ρ" k="fireCableDensity" value={cableIn.density} unit="кг/м³" step={50} />
          <StrNumField onUpdate={onUpdate} label="Скорость пламени" k="fireCableFlameSpeed" value={cableIn.flameSpeed ?? CABLE_DEFAULT_FLAME_SPEED} unit="м/с" step={0.001} />
          <StrNumField onUpdate={onUpdate} label="Время расчёта" k="fireCableCalcTime" value={cableIn.calcTime ?? CABLE_DEFAULT_CALC_TIME} unit="мин" step={5} />
        </More>
        <SourceResult power={cableRes?.powerMW} dT={cableRes?.deltaT_C}>
          {cableRes && <>
            {/* Площадь горения задаёт мощность N = ψ·S·Q_н: видно, охвачена
                ли трасса целиком или фронт пламени ещё идёт. */}
            <KV label="Охвачено пламенем" value={`${fmt(cableRes.lengthBurning, 1)}`} unit="м" />
            <KV label="Площадь горения" value={`${fmt(cableRes.surfaceArea, 2)} из ${fmt(cableRes.surfaceFull, 2)}`} unit="м²" />
            <KV label="Масса изоляции" value={fmt(cableRes.mass, 0)} unit="кг" />
            <KV label="Теплозапас" value={fmt(cableRes.heatTotal, 0)} unit="МДж" />
            {Number.isFinite(cableRes.burnTime_min) && (
              <KV label="Время горения" value={fmt(cableRes.burnTime_min, 0)} unit="мин" />
            )}
          </>}
        </SourceResult>
      </SourceCard>

      {/* ═══ Деревянная крепь ════════════════════════════════════════════ */}
      <SourceCard icon="TreePine" title="Деревянная крепь" enabled={onWood}
        subtitle={woodRes ? `${fmt(woodRes.powerMW, 2)} МВт` : undefined}
        onToggle={(v) => onUpdate(v
          ? { fireLoadWoodSupport: true, fireWoodLength: branchLenStr || b.fireWoodLength || "50" }
          : { fireLoadWoodSupport: false })}>
        <NameInput value={b.fireWoodName ?? "Деревянная крепь"} placeholder="Деревянная крепь"
          onChange={(v) => onUpdate({ fireWoodName: v })} />
        <div className="grid grid-cols-2 gap-2">
          <StrNumField onUpdate={onUpdate} label="Длина закреплённого участка" k="fireWoodLength" value={wood.length} unit="м"
            aside={<FromBranch len={branchLenStr} onClick={() => onUpdate({ fireWoodLength: branchLenStr })} />} />
          <StrNumField onUpdate={onUpdate} label="Периметр крепи" k="fireWoodWidth" value={wood.sectionWidth} unit="м" step={0.1}
            hint="Горящая ширина по контуру сечения" />
          <StrNumField onUpdate={onUpdate} label="Толщина элементов" k="fireWoodThick" value={wood.sectionThick} unit="м" step={0.01} />
          <StrNumField onUpdate={onUpdate} label="Скорость пламени" k="fireWoodFlameSpeed" value={wood.flameSpeed} unit="м/с" step={0.001} />
        </div>
        <More title="Свойства древесины и время расчёта">
          <StrNumField onUpdate={onUpdate} label="Теплота сгорания Q_н" k="fireWoodHeatValue" value={wood.heatValue} unit="МДж/кг" />
          <StrNumField onUpdate={onUpdate} label="Скорость выгорания ψ" k="fireWoodBurnRate" value={wood.burnRate} unit="кг/м²с" step={0.001} />
          <StrNumField onUpdate={onUpdate} label="Плотность ρ" k="fireWoodDensity" value={wood.density} unit="кг/м³" step={50} />
          <StrNumField onUpdate={onUpdate} label="Время расчёта" k="fireWoodCalcTime" value={wood.calcTime} unit="мин" step={5} />
        </More>
        <SourceResult power={woodRes?.powerMW} dT={woodRes?.deltaT_C}>
          {woodRes && <>
            <KV label={`Площадь горения через ${wood.calcTime} мин`} value={fmt(woodRes.surfaceArea, 1)} unit="м²" />
            <KV label="Масса крепи" value={fmt(woodRes.mass, 0)} unit="кг" />
            <KV label="Теплозапас" value={fmt(woodRes.heatTotal, 0)} unit="МДж" />
            {Number.isFinite(woodRes.burnTime_min) && (
              <KV label="Полное выгорание" value={fmt(woodRes.burnTime_min, 0)} unit="мин" />
            )}
          </>}
        </SourceResult>
      </SourceCard>
    </div>
  );
}