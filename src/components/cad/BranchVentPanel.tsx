// ─────────────────────────────────────────────────────────────────────────────
// BranchVentPanel.tsx — вкладка «Вентиляция» левой панели: сводка по
// проветриванию выбранной выработки.
//
// Вкладка отвечает на три вопроса, в таком порядке:
//   1. Какая это выработка — тип из справочника рудника (подставляет сечение,
//      крепь, α и допустимую скорость) и что из него получилось.
//   2. Как по ней идёт воздух — расход, скорость (с проверкой по V max),
//      депрессия и сопротивление.
//   3. Всё ли в порядке — понятные предупреждения вместо «голых» чисел.
//
// Правка геометрии и сопротивления — на вкладке «Топология»; здесь только
// выбор типа и сводка, чтобы не было двух мест для одного поля.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";
import type { TopoBranch } from "@/lib/topology";
import type { BranchType } from "@/components/cad/EquipmentRefDialog";
import { type UnitsConfig, getUnit } from "@/lib/unitsConfig";
import { G_ACCEL } from "@/lib/bulkheads";
import { Card, Field, Stat, KV, inputCls, inputStyle } from "@/components/cad/propUi";

interface Props {
  branch: TopoBranch | null;
  mineTypes: BranchType[];
  /** Сколько ветвей получит тип (Ctrl-выделение). */
  editCount: number;
  unitsConfig: UnitsConfig;
  /** Сопротивление вентсооружений на ветви, кМюрг. */
  bulkheadRKmu: number;
  onApplyType: (typeName: string) => void;
  onOpenTypesLibrary: () => void;
  onOpenTopology: () => void;
}

const SHAPE_LABEL: Record<string, string> = {
  round: "круглое", rect: "прямоугольное", trap: "трапециевидное", arch: "арочное", custom: "произвольное",
};

const f = (v: number | undefined, d: number) => (Number.isFinite(v) ? (v as number).toFixed(d) : "—");

export default function BranchVentPanel({
  branch: b, mineTypes, editCount, unitsConfig, bulkheadRKmu,
  onApplyType, onOpenTypesLibrary, onOpenTopology,
}: Props) {
  if (!b) {
    return (
      <div className="px-3 py-6 text-center text-xs" style={{ color: "var(--c-t4, #767f8c)" }}>
        <Icon name="MousePointerClick" size={20} className="mx-auto mb-1.5 opacity-60" />
        Выберите выработку на схеме
      </div>
    );
  }

  // Сопротивление: b.resistance хранится в кМюрг, базовая единица — Мюрг.
  // Перевод тот же, что на вкладке «Топология». Раньше здесь делилось на
  // 9,81·10⁻³ (как для Н·с²/м⁸), и число выходило в 9,81 раза меньше, чем
  // у той же выработки на «Топологии».
  const uR = getUnit(unitsConfig, "resistance");
  const rDisp = (kmu: number) => uR.fromBase(kmu * 1000).toFixed(uR.decimals);
  const fanCrossingKmu = (b.hasFan && (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
    ? (b.fanCrossingR ?? 0) / 1000 : 0;
  const structR = (bulkheadRKmu ?? 0) + fanCrossingKmu;
  const totalR = b.resistance + structR;
  const Q = b.flow ?? 0;
  const fanH = b.hasFan ? (b.fanPressure ?? 0) : 0;
  const dpTotal = totalR * Math.abs(Q) * Q * G_ACCEL - fanH;

  const solved = Math.abs(Q) > 0 || Math.abs(b.velocity) > 0;
  const V = Math.abs(b.velocity);
  const overV = b.vMax > 0 && V > b.vMax;
  const vPct = b.vMax > 0 ? Math.min(100, (V / b.vMax) * 100) : 0;
  const reversed = Q < 0;

  const typeKnown = mineTypes.some(t => t.name === b.mineTypeName);
  const shape = SHAPE_LABEL[b.shape] ?? b.shape;

  return (
    <div className="p-2 space-y-2" style={{ fontFamily: "var(--font-ui)" }}>

      {/* ═══ Тип выработки ═════════════════════════════════════════════ */}
      <Card icon="Layers" title="Тип выработки">
        {mineTypes.length > 0 ? (
          <Field label="Из справочника рудника"
            hint={editCount > 1
              ? `Тип получат все ${editCount} выбранные выработки`
              : "Подставляет сечение, крепь, α и допустимую скорость"}>
            <div className="flex gap-1">
              <select className={`${inputCls} flex-1`} style={{ ...inputStyle, cursor: "pointer" }}
                value={typeKnown ? b.mineTypeName : ""}
                onChange={(e) => onApplyType(e.target.value)}>
                {!typeKnown && <option value="" disabled>— тип не выбран —</option>}
                {mineTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <button type="button" onClick={onOpenTypesLibrary} title="Справочник типов выработок"
                className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded"
                style={{ background: "var(--c-s3, #f1efea)", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3a3f45)", cursor: "pointer" }}>
                <Icon name="BookOpen" size={13} />
              </button>
            </div>
          </Field>
        ) : (
          <button type="button" onClick={onOpenTypesLibrary}
            className="w-full flex items-start gap-2 px-2 py-2 rounded text-left text-[11px] leading-snug"
            style={{ background: "var(--c-tint-amber, #fffbeb)", color: "var(--c-amber-ink, #865412)", border: "none", cursor: "pointer" }}>
            <Icon name="BookPlus" size={14} className="flex-shrink-0 mt-px" />
            <span>
              В справочнике рудника пока нет типов выработок.{" "}
              <span className="underline">Открыть «Справочники → Типы выработок»</span>
            </span>
          </button>
        )}

        {/* Что сейчас у выработки — коротко, одной сводкой */}
        <div className="rounded px-2 py-1.5" style={{ background: "var(--c-s2, #f8f7f4)" }}>
          <KV label="Сечение" value={`${f(b.area, 2)} м² · P ${f(b.perimeter, 2)} м`} />
          <KV label="Форма" value={shape} />
          <KV label="Длина" value={f(b.length, 1)} unit="м" />
          <KV label="Коэффициент α" value={f(b.alphaCoef, 1)} unit="×10⁻⁴" />
          <KV label="V допустимая" value={f(b.vMax, 1)} unit="м/с" />
        </div>
        <button type="button" onClick={onOpenTopology}
          className="w-full h-7 flex items-center justify-center gap-1.5 rounded text-[11px]"
          style={{ background: "transparent", border: "1px dashed var(--c-b2, #d5d1c8)", color: "var(--c-accent, #1e5a7a)", cursor: "pointer" }}>
          <Icon name="PencilRuler" size={12} />
          Изменить сечение и сопротивление — «Топология»
        </button>
      </Card>

      {/* ═══ Воздух в выработке ════════════════════════════════════════ */}
      <Card icon="Wind" title="Воздух в выработке" tone="signal">
        {!solved ? (
          <div className="flex items-center gap-1.5 px-2 py-2 rounded text-[11px]"
            style={{ background: "var(--c-s2, #f8f7f4)", color: "var(--c-t3, #6b7280)" }}>
            <Icon name="Info" size={13} />
            Выполните «Расчёт сети» (F9), чтобы увидеть расход и скорость.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Расход Q" value={f(Math.abs(Q), 2)} unit="м³/с" />
              <Stat label="Скорость V" value={f(V, 2)} unit="м/с" danger={overV} />
            </div>

            {/* Скорость относительно допустимой — видно запас без счёта в уме */}
            {b.vMax > 0 && (
              <div>
                <div className="flex justify-between text-[10px] mb-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>
                  <span>Скорость от допустимой</span>
                  <span style={{ fontFamily: "var(--font-num)", color: overV ? "var(--c-red, #dc2626)" : undefined }}>
                    {f((V / b.vMax) * 100, 0)} % из {f(b.vMax, 1)} м/с
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--c-s3, #f1efea)" }}>
                  <div className="h-full rounded-full" style={{
                    width: `${vPct}%`,
                    background: overV ? "var(--c-red, #dc2626)" : vPct > 85 ? "var(--c-signal, #e8a317)" : "var(--c-accent, #1e5a7a)",
                  }} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Депрессия выработки" value={f(b.dP, 1)} unit="Па" />
              <Stat label="Энергозатраты" value={f(b.power, 0)} unit="Вт" />
            </div>

            <div className="pt-0.5">
              <KV label="Сопротивление выработки" value={rDisp(b.resistance)} unit={uR.symbol} />
              {structR > 0 && (
                <>
                  <KV label="+ перемычки / окно вентилятора" value={rDisp(structR)} unit={uR.symbol} />
                  <KV label="Общая депрессия ветви" value={f(dpTotal, 1)} unit="Па"
                    title="С учётом вентсооружений и напора вентилятора" />
                </>
              )}
            </div>
          </>
        )}
      </Card>

      {/* ═══ Замечания ═════════════════════════════════════════════════ */}
      {solved && (overV || reversed || b.isDead) && (
        <Card icon="TriangleAlert" title="Замечания" tone="muted">
          {overV && (
            <Note danger>
              Скорость {f(V, 2)} м/с выше допустимой {f(b.vMax, 1)} м/с — уменьшите расход или увеличьте сечение.
            </Note>
          )}
          {reversed && (
            <Note>
              Воздух идёт против направления ветви (от узла {b.toId} к {b.fromId}).
            </Note>
          )}
          {b.isDead && (
            <Note>
              Тупиковая выработка: сквозного движения воздуха нет — нужно проветривание вентилятором местного проветривания.
            </Note>
          )}
        </Card>
      )}
    </div>
  );
}

function Note({ danger, children }: { danger?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[11px] leading-snug"
      style={{
        background: danger ? "var(--c-tint-red, #fef2f2)" : "var(--c-s2, #f8f7f4)",
        color: danger ? "var(--c-red-ink, #991b1b)" : "var(--c-t2, #3a3f45)",
      }}>
      <Icon name={danger ? "OctagonAlert" : "Info"} size={12} className="flex-shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}