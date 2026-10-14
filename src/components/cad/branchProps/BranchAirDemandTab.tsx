// ─────────────────────────────────────────────────────────────────────────────
// BranchAirDemandTab.tsx — вкладка «Расход воздуха» панели свойств выработки:
// карточка забоя по ФНиП № 505 п. 155 — потребность по каждому фактору
// отдельно, в зачёт идёт максимум, с проверкой фактической скорости.
//
// Формулы — прежние (calcFaceDemand). Оформление переведено на общие
// плотные карточки панели свойств (propUi), как у «Топологии»: группы
// факторов — сворачиваемые карточки с памятью, поля — строкой «подпись
// слева, поле справа», пояснения — во всплывающей подсказке подписи.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import {
  type VentSection, type VentNorms, type FaceType,
  FACE_TYPE_OPTIONS, FACE_TYPE_LABEL, FACE_TYPE_FACTORS, simultaneityFactor,
} from "@/lib/ventSections";
import { calcFaceDemand, FACTOR_LABEL } from "@/lib/airDemand";
import { DEFAULT_POLLUTION_THRESHOLD } from "@/lib/airPollution";
import Icon from "@/components/ui/icon";
import { Card, Row, Field, NumInput, Switch, Stat, inputCls, inputStyle } from "@/components/cad/propUi";

interface BranchAirDemandTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  ventSections: VentSection[];
  ventNorms: VentNorms;
  /** Доля загрязнённого воздуха в этой выработке (0..1). */
  pollutionFraction?: number;
  /** Доля, с которой струя считается загрязнённой. */
  pollutionThreshold?: number;
}

export default function BranchAirDemandTab({
  branch, onUpdate, ventSections, ventNorms,
  pollutionFraction = 0, pollutionThreshold = DEFAULT_POLLUTION_THRESHOLD,
}: BranchAirDemandTabProps) {
  const faceType = (branch.ventFaceType ?? "none") as FaceType;
  const isNone = faceType === "none";
  const section = ventSections.find(s => s.id === (branch.ventSectionId ?? "")) ?? null;
  const d = calcFaceDemand(branch, ventNorms, section);

  // Доля загрязнённого воздуха в струе: 0 — свежая, 1 — полностью грязная.
  const pct = Math.max(0, Math.min(1, pollutionFraction)) * 100;
  const pctText = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  const thresholdPct = (pollutionThreshold * 100).toFixed(0);
  const isPolluted = (branch.pollutesAir ?? false) || pollutionFraction >= pollutionThreshold;

  // Набор факторов, применимых к выбранному типу забоя: лишние поля
  // не показываем, чтобы карточка не пугала объёмом. Если по скрытому
  // фактору остались данные от прежнего типа забоя — блок показываем
  // с предупреждением, иначе цифра «молча» уйдёт в расчёт.
  const F = FACE_TYPE_FACTORS[faceType];
  const hasBlastData  = (branch.ventBlastMassCoal ?? 0) > 0 || (branch.ventBlastMassRock ?? 0) > 0;
  const hasDieselData = (branch.ventDieselPower ?? 0) > 0 || (branch.ventDieselCount ?? 0) > 0;
  const showBlast  = F.blast  || hasBlastData;
  const showDiesel = F.diesel || hasDieselData;

  /** Предупреждение о данных, не типичных для этого типа забоя */
  const StaleNote = ({ what }: { what: string }) => (
    <div className="flex items-start gap-1.5 px-2 py-1 rounded text-[10px] leading-snug"
      style={{ background: "var(--c-tint-amber, #fffbeb)", color: "var(--c-amber-ink, #92400e)" }}>
      <Icon name="TriangleAlert" size={11} className="flex-shrink-0 mt-px" />
      <span>
        Для типа «{FACE_TYPE_LABEL[faceType]}» {what} обычно не учитывают,
        но данные заданы и участвуют в расчёте. Очистите поля, если они не нужны.
      </span>
    </div>
  );

  /** Числовое поле фактора: пусто (0) — берётся значение по умолчанию. */
  // top — подпись над полем (для пары полей в ряд), иначе — слева.
  const Num = ({ label, value, step, unit, def, hint, onChange, int, top }: {
    label: string; value: number | undefined; step: number; unit?: string;
    def?: number; hint?: string; int?: boolean; top?: boolean; onChange: (v: number) => void;
  }) => {
    const tip = hint ?? (def !== undefined ? `Пусто — по умолчанию ${def}` : undefined);
    const input = (
      <NumInput value={value || undefined} step={step} min={0} unit={unit}
        placeholder={def !== undefined ? String(def) : undefined}
        onChange={(v) => onChange(int ? Math.max(0, Math.round(v)) : Math.max(0, v))} />
    );
    return top
      ? <div title={tip}><Field label={label}>{input}</Field></div>
      : <Row label={label} hint={tip}>{input}</Row>;
  };

  const FactorRow = ({ label, value, active }: { label: string; value: number; active: boolean }) => (
    <div className="flex items-baseline gap-2 px-1.5 py-0.5 rounded text-[11px]"
      style={{
        background: active ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 10%, transparent)" : undefined,
        color: active ? "var(--c-accent, #1e5a7a)" : "var(--c-t2, #3a3f45)",
        fontWeight: active ? 600 : 400,
      }}>
      <span className="flex-1 min-w-0 truncate">{active && "▸ "}{label}</span>
      <span style={{ fontFamily: "var(--font-num)" }}>{value > 0 ? value.toFixed(2) : "—"}</span>
      <span className="text-[10px] w-8" style={{ color: "var(--c-t4, #767f8c)", fontWeight: 400 }}>м³/с</span>
    </div>
  );

  return (
    <div className="p-1.5 space-y-1.5" style={{ fontFamily: "var(--font-ui)" }}>

      {/* ═══ Забой ═════════════════════════════════════════════════════ */}
      <Card dense collapsible persistKey="air.face" icon="Pickaxe" title="Забой"
        aside={
          <span className="px-1.5 rounded-full text-[10px] font-semibold normal-case"
            title={isPolluted
              ? `Струя загрязнённая: доля ${pctText} % не ниже порога ${thresholdPct} % — стрелки синие`
              : `Струя свежая: доля ${pctText} % ниже порога ${thresholdPct} % — стрелки красные`}
            style={{
              fontFamily: "var(--font-num)",
              background: isPolluted ? "var(--c-tint-blue, #eff6ff)" : "var(--c-tint-green, #f0fdf4)",
              color: isPolluted ? "var(--c-blue, #1d4ed8)" : "var(--c-green, #15803d)",
            }}>
            {pctText} % загр.
          </span>
        }>
        <Row label="Тип забоя"
          hint={isNone ? "Укажите тип — выработка попадёт в расчёт количества воздуха (ФНиП № 505, п. 155): по людям, газам ВР, дизелю и мин. скорости, в зачёт идёт наибольшее" : undefined}>
          <select className={inputCls} style={{ ...inputStyle, cursor: "pointer" }} value={faceType}
            onChange={(e) => onUpdate({ ventFaceType: e.target.value as FaceType })}>
            {FACE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Row>
        {/* Загрязнение — свойство выработки, не зависит от типа забоя;
            окрашивает стрелки направления воздуха ниже по потоку. */}
        <div title="Выработка — источник загрязнения. Ниже по потоку доля загрязнённого воздуха считается по смешению струй пропорционально расходам.">
          <Switch checked={branch.pollutesAir ?? false} onChange={(v) => onUpdate({ pollutesAir: v })}
            label="Загрязняет воздух" />
        </div>
        {!isNone && (<>
          <div className="text-[10px] leading-snug px-0.5" style={{ color: "var(--c-t4, #767f8c)" }}>
            Факторы: люди{F.blast && ", газы ВР"}{F.diesel && ", дизель"}, мин. скорость
          </div>
          <Row label="Наименование">
            <input className={inputCls} style={inputStyle} value={branch.ventDescription ?? ""}
              onChange={(e) => onUpdate({ ventDescription: e.target.value })} />
          </Row>
          <Row label="Участок">
            <select className={inputCls} style={{ ...inputStyle, cursor: "pointer" }}
              value={branch.ventSectionId ?? ""}
              onChange={(e) => onUpdate({ ventSectionId: e.target.value })}>
              <option value="">— не задан —</option>
              {ventSections.map(s => (
                <option key={s.id} value={s.id}>{s.number ? `${s.number}. ` : ""}{s.name || "Без названия"}</option>
              ))}
            </select>
          </Row>
          <Switch checked={branch.ventReserve ?? false} onChange={(v) => onUpdate({ ventReserve: v })}
            label="Резервный забой" />
        </>)}
      </Card>

      {!isNone && (<>
        {/* ═══ Исходные данные ══════════════════════════════════════════ */}
        <Card dense collapsible persistKey="air.inputs" icon="ClipboardList" title="Исходные данные">
          <Num label="Людей в смену" value={branch.ventPeopleCount} step={1} unit="чел" int
            hint={`Норма ${ventNorms.airPerPerson} м³/мин на человека, по наибольшему числу одновременно работающих`}
            onChange={(v) => onUpdate({ ventPeopleCount: v })} />

          {showBlast && (<>
            <div className="pt-1 text-[10px] font-semibold uppercase tracking-wider"
              title={`Газовыделение: ${ventNorms.gasPerKgCoal} л/кг по углю, ${ventNorms.gasPerKgRock} л/кг по породе. Пустые поля — значения из справочника норм.`}
              style={{ color: "var(--c-t3, #6b7280)" }}>Взрывные работы</div>
            {!F.blast && <StaleNote what="газы взрывных работ" />}
            <div className="grid grid-cols-2 gap-1.5">
              <Num label="ВВ по углю" top value={branch.ventBlastMassCoal} step={0.1} unit="кг"
                onChange={(v) => onUpdate({ ventBlastMassCoal: v })} />
              <Num label="ВВ по породе" top value={branch.ventBlastMassRock} step={0.1} unit="кг"
                onChange={(v) => onUpdate({ ventBlastMassRock: v })} />
            </div>
            <Num label="Время провет." value={branch.ventBlastTime} step={1} unit="мин" def={ventNorms.blastVentTime}
              onChange={(v) => onUpdate({ ventBlastTime: v })} />
            <Num label="Объём выраб." value={branch.ventBlastVolume} step={1} unit="м³"
              def={+(branch.area * branch.length).toFixed(0)}
              hint="Пусто — сечение × длина выработки"
              onChange={(v) => onUpdate({ ventBlastVolume: v })} />
            <Num label="Коэф. обводнён." value={branch.ventBlastWatering} step={0.05} def={ventNorms.wateringFactor}
              onChange={(v) => onUpdate({ ventBlastWatering: v })} />
          </>)}

          {showDiesel && (<>
            <div className="pt-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--c-t3, #6b7280)" }}>Дизельное оборудование</div>
            {!F.diesel && <StaleNote what="дизельное оборудование" />}
            <div className="grid grid-cols-2 gap-1.5">
              <Num label="Число машин" top value={branch.ventDieselCount} step={1} unit="шт" int
                onChange={(v) => onUpdate({ ventDieselCount: v })} />
              <Num label="Мощность Σ" top value={branch.ventDieselPower} step={1} unit="кВт"
                onChange={(v) => onUpdate({ ventDieselPower: v })} />
            </div>
            <Num label="Норма" value={branch.ventDieselNorm} step={0.1} unit="м³/мин·кВт" def={ventNorms.airPerKwDiesel}
              onChange={(v) => onUpdate({ ventDieselNorm: v })} />
            <Num label="Коэф. одноврем." value={branch.ventDieselSimult} step={0.05}
              def={simultaneityFactor(branch.ventDieselCount ?? 0, ventNorms)}
              hint="Подставляется по числу машин; можно задать своё значение"
              onChange={(v) => onUpdate({ ventDieselSimult: v })} />
          </>)}

          <div className="pt-1 text-[10px] font-semibold uppercase tracking-wider"
            title="Пусто — берётся из участка, а если там не задано — из норм"
            style={{ color: "var(--c-t3, #6b7280)" }}>Коэффициенты</div>
          <div className="grid grid-cols-2 gap-1.5">
            <Num label="Коэф. запаса" top value={branch.ventReserveFactor} step={0.05} def={d.reserveFactor}
              hint="Пусто — из участка или норм"
              onChange={(v) => onUpdate({ ventReserveFactor: v })} />
            <Num label="Коэф. утечек" top value={branch.ventLeakFactor} step={0.05} def={d.leakFactor}
              hint="Пусто — из участка или норм"
              onChange={(v) => onUpdate({ ventLeakFactor: v })} />
          </div>
        </Card>

        {/* ═══ Потребность ══════════════════════════════════════════════ */}
        <Card dense collapsible persistKey="air.result" icon="Wind" title="Потребность в воздухе" tone="signal"
          aside={
            <span className="px-1.5 rounded-full text-[10px] font-semibold normal-case"
              style={{ background: d.verdict === "Обеспечено" ? "var(--c-tint-green, #f0fdf4)" : "var(--c-tint-red, #fef2f2)", color: d.verdict === "Обеспечено" ? "var(--c-green, #15803d)" : "var(--c-red, #b91c1c)" }}>
              {d.verdict}
            </span>
          }>
          <div>
            <FactorRow label="По людям" value={d.byPeople} active={d.factor === "people"} />
            {showBlast && <FactorRow label="По газам ВР" value={d.byBlast} active={d.factor === "blast"} />}
            {showDiesel && <FactorRow label="По дизелю" value={d.byDiesel} active={d.factor === "diesel"} />}
            <FactorRow label="По мин. скорости" value={d.byVMin} active={d.factor === "vmin"} />
          </div>
          {d.formula && (
            <div className="text-[10px] leading-snug px-0.5" style={{ color: "var(--c-t4, #767f8c)" }}>
              Определяющий: {FACTOR_LABEL[d.factor]} = {d.formula}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1">
            <Stat label="Расчётная" value={d.base > 0 ? d.base.toFixed(2) : "—"} unit="м³/с" />
            <Stat label="С коэффициентами" value={d.total > 0 ? d.total.toFixed(2) : "—"} unit="м³/с" />
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Stat label="Фактически Q" value={d.actualFlow.toFixed(2)} unit="м³/с" danger={!d.flowOk} />
            <Stat label="Скорость V" value={d.actualVelocity.toFixed(2)} unit="м/с" danger={!d.velocityOk}
              hint={`Допустимо: ${d.vMin}–${d.vMax} м/с`} />
          </div>
          {d.recommendation && (
            <div className="text-[10px] leading-snug px-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>{d.recommendation}</div>
          )}
        </Card>
      </>)}
    </div>
  );
}
