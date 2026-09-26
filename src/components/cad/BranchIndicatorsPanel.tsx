// ─────────────────────────────────────────────────────────────────────────────
// BranchIndicatorsPanel.tsx — вкладка «Индикаторы» панели свойств выработки:
// какие величины подписать на схеме у ЭТОЙ выработки.
//
// Как это работает (см. branchLabelLines.ts): у выработки есть свои отметки
// b.indicators, они перекрывают общие настройки «Панели информации». Если
// своей отметки нет — действует общая. Поэтому переключатель показывает
// ФАКТИЧЕСКОЕ состояние на схеме, а точка рядом — что оно задано именно для
// этой выработки. «Как на всей схеме» убирает все свои отметки.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";
import type { TopoBranch } from "@/lib/topology";
import type { InfoDisplayConfig } from "@/lib/infoConfig";
import { Card, Field, Switch, PresetSlider } from "@/components/cad/propUi";

type Key = keyof InfoDisplayConfig;

/**
 * Только те величины, которые рисовальщик подписи действительно выводит.
 * Раньше здесь были ещё 6 «аварийных» отметок (метан, CO, водород, оксиды
 * азота, тепловые депрессии) — их никто не читал, галочка ставилась, а на
 * схеме ничего не появлялось.
 */
const GROUPS: { title: string; icon: string; rows: { key: Key; label: string; sample: string }[] }[] = [
  { title: "Обозначение", icon: "Tag", rows: [
    { key: "branchNumber", label: "Номер выработки", sample: "1055" },
    { key: "branchName",   label: "Название",        sample: "Штрек" },
  ] },
  { title: "Геометрия", icon: "Ruler", rows: [
    { key: "branchLength",  label: "Длина",               sample: "L=127м" },
    { key: "branchAngle",   label: "Угол наклона",        sample: "A=−2.0°" },
    { key: "branchSection", label: "Площадь сечения",     sample: "S=7.4м²" },
    { key: "branchHeight",  label: "Высота сечения",      sample: "Высота=3.2м" },
  ] },
  { title: "Сопротивление", icon: "Wind", rows: [
    { key: "branchResistance",    label: "Сопротивление выработки",   sample: "R=…" },
    { key: "branchResistanceSum", label: "Сопротивление с перемычками", sample: "Rсум=…" },
    { key: "branchAlpha",         label: "Коэффициент α",             sample: "α=12·10⁻⁴" },
    { key: "branchVMax",          label: "Допустимая скорость",       sample: "Vmax=15м/с" },
  ] },
  { title: "Результат расчёта", icon: "Activity", rows: [
    { key: "branchFlow",       label: "Расход воздуха",          sample: "Q=109м³/с" },
    { key: "branchVelocity",   label: "Скорость воздуха",        sample: "V=14.7м/с" },
    { key: "branchDepression", label: "Депрессия",               sample: "Н=459Па" },
    { key: "branchExtraFan",   label: "Напор вентилятора",       sample: "ДопН=…" },
    { key: "branchPeople",     label: "Количество людей",        sample: "Людей=12" },
  ] },
];

interface Props {
  branch: TopoBranch | null;
  /** Общие настройки «Панели информации» — действуют, пока нет своей отметки. */
  infoConfig: InfoDisplayConfig;
  onChange: (indicators: Record<string, boolean>) => void;
  /** Правка вида подписи (поворот, размер) — у всех выбранных выработок. */
  onBranchPatch: (patch: Partial<TopoBranch>) => void;
  /** Сколько выработок затронет правка (Ctrl-выделение). */
  editCount: number;
}

export default function BranchIndicatorsPanel({ branch: b, infoConfig, onChange, onBranchPatch, editCount }: Props) {
  if (!b) {
    return (
      <div className="px-3 py-6 text-center text-xs" style={{ color: "var(--c-t4, #767f8c)" }}>
        <Icon name="MousePointerClick" size={20} className="mx-auto mb-1.5 opacity-60" />
        Выберите выработку на схеме
      </div>
    );
  }

  const own = b.indicators ?? {};
  // «Расход» в подписи включают две отметки (branchFlow и branchFlowCalc) —
  // для переключателя это одна величина.
  const isOn = (k: Key): boolean => {
    const v = (key: Key) => (key in own ? own[key] : !!infoConfig[key]);
    return k === "branchFlow" ? v("branchFlow") || v("branchFlowCalc") : v(k);
  };
  const isOwn = (k: Key) => k in own || (k === "branchFlow" && "branchFlowCalc" in own);
  const set = (k: Key, val: boolean) => {
    const next: Record<string, boolean> = { ...own, [k]: val };
    if (k === "branchFlow") next.branchFlowCalc = val;
    onChange(next);
  };
  const ownCount = Object.keys(own).length;

  // Примерный вид подписи: какие строки появятся (значения — условные)
  const preview = GROUPS.flatMap(g => g.rows).filter(r => isOn(r.key)).map(r => r.sample);

  return (
    <div className="p-2 space-y-2" style={{ fontFamily: "var(--font-ui)" }}>

      {/* ═══ Подпись на схеме ══════════════════════════════════════════ */}
      <Card icon="Captions" title="Подпись на схеме" tone="signal">
        <div className="text-[10px] leading-snug" style={{ color: "var(--c-t3, #6b7280)" }}>
          Что показать у этой выработки. Остальные выработки подписываются по
          общим настройкам «Панели информации».
        </div>
        <div className="rounded px-2 py-1.5 text-[11px] leading-tight min-h-[28px]"
          style={{ background: "var(--c-s2, #f8f7f4)", border: "1px dashed var(--c-b2, #d5d1c8)",
            color: "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)" }}>
          {preview.length > 0
            ? preview.map((l, i) => <div key={i}>{l}</div>)
            : <span style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-ui)" }}>Подписи нет</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[10px]" style={{ color: "var(--c-t4, #767f8c)" }}>
            {ownCount > 0 ? "Есть свои настройки у этой выработки" : "Как на всей схеме"}
          </span>
          <button type="button" disabled={ownCount === 0}
            onClick={() => onChange({})}
            className="h-6 px-2 flex items-center gap-1 rounded text-[10px] disabled:opacity-40"
            style={{ background: "var(--c-s3, #f1efea)", border: "1px solid var(--c-b2, #d5d1c8)",
              color: "var(--c-t2, #3a3f45)", cursor: ownCount ? "pointer" : "default" }}
            title="Убрать свои настройки — подпись как у остальных выработок">
            <Icon name="RotateCcw" size={11} /> Как на всей схеме
          </button>
        </div>
      </Card>

      {/* ═══ Вид подписи: поворот и размер ═════════════════════════════ */}
      <Card icon="Type" title="Вид подписи">
        <Field label="Поворот блока меток">
          <PresetSlider value={b.labelAngle ?? 0} min={-180} max={180} step={5}
            presets={[-90, -45, 0, 45, 90]} fmt={(v) => `${v}°`}
            onChange={(v) => onBranchPatch({ labelAngle: v })}
            onReset={() => onBranchPatch({ labelAngle: 0 })} />
        </Field>
        <Field label="Размер текста">
          <PresetSlider value={b.labelSize ?? 1} min={0.3} max={4} step={0.1}
            presets={[0.5, 0.75, 1, 1.5, 2]} fmt={(v) => `×${v}`}
            onChange={(v) => onBranchPatch({ labelSize: v === 1 ? undefined : v })}
            onReset={() => onBranchPatch({ labelSize: undefined })} />
        </Field>
        {editCount > 1 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px]"
            style={{ background: "var(--c-tint-amber, #fffbeb)", color: "var(--c-amber-ink, #865412)" }}>
            <Icon name="Layers" size={11} />
            Применится сразу к {editCount} выбранным выработкам
          </div>
        )}
      </Card>

      {GROUPS.map(g => (
        <Card key={g.title} icon={g.icon} title={g.title} collapsible defaultOpen={false}
          aside={g.rows.some(r => isOn(r.key)) ? (
            <span className="px-1.5 rounded-full text-[10px] font-semibold"
              style={{ background: "var(--c-tint-amber2, #fef3c7)", color: "var(--c-amber-ink, #865412)", fontFamily: "var(--font-num)" }}
              title="Включено индикаторов">
              {g.rows.filter(r => isOn(r.key)).length}
            </span>
          ) : undefined}>
          <div className="-mx-1">
            {g.rows.map(r => (
              <div key={r.key} className="flex items-center">
                <div className="flex-1 min-w-0">
                  <Switch checked={isOn(r.key)} onChange={v => set(r.key, v)} label={r.label} />
                </div>
                {isOwn(r.key) && (
                  <span className="w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0"
                    title="Задано для этой выработки"
                    style={{ background: "var(--c-signal, #e8a317)" }} />
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <div className="flex items-center gap-1.5 px-1 text-[10px]" style={{ color: "var(--c-t4, #767f8c)" }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--c-signal, #e8a317)" }} />
        — задано для этой выработки, остальное — по «Панели информации»
      </div>
    </div>
  );
}
