// ─────────────────────────────────────────────────────────────────────────────
// FanIndicatorsPanel.tsx — вкладка «Индикаторы» вентилятора: какие показатели
// подписать у ЗНАЧКА вентилятора на схеме.
//
// Подпись вентилятора читает только отметки самой выработки (b.indicators:
// fanNameInd, fanFlow, fanPressure, fanShaftPower, fanEfficiency) — общие
// настройки «Панели информации» на неё не действуют.
//
// Что убрано: отметка «Фактический расход воздуха» (branchFlow) — это подпись
// ВЫРАБОТКИ, а не вентилятора, она уже есть на вкладке «Индикаторы» ветви.
// Здесь она путала: галочка ставилась, а у значка ничего не появлялось.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";
import type { TopoBranch } from "@/lib/topology";
import { Card, Switch } from "@/components/cad/propUi";

const ROWS: { key: string; label: string; hint?: string; sample: (b: TopoBranch) => string }[] = [
  { key: "fanNameInd",    label: "Название вентилятора", sample: b => b.fanName || "—" },
  { key: "fanFlow",       label: "Расход через вентилятор", sample: b => `Qв=${Math.abs(b.flow ?? 0).toFixed(2)} м³/с` },
  { key: "fanPressure",   label: "Напор", sample: b => `Нв=${Math.abs(b.fanPressure ?? 0).toFixed(0)} Па` },
  { key: "fanShaftPower", label: "Мощность на валу", hint: "Показывается после расчёта сети",
    sample: b => `Nв=${((b.fanShaftPower ?? 0) / 1000).toFixed(1)} кВт` },
  { key: "fanEfficiency", label: "КПД", hint: "Показывается после расчёта сети",
    sample: b => `ηв=${((b.fanEfficiency ?? 0) * 100).toFixed(0)}%` },
];
const FAN_KEYS = ROWS.map(r => r.key);

interface Props {
  branch: TopoBranch | null;
  onChange: (indicators: Record<string, boolean>) => void;
  /** Размер подписи у значка (как в «Вентилятор»). */
  fontSize?: number;
  onFontSize?: (v: number) => void;
  onResetOffset?: () => void;
}

export default function FanIndicatorsPanel({ branch: b, onChange, fontSize, onFontSize, onResetOffset }: Props) {
  if (!b?.hasFan) {
    return (
      <div className="px-3 py-6 text-center text-xs" style={{ color: "var(--c-t4, #767f8c)" }}>
        <Icon name="Fan" size={20} className="mx-auto mb-1.5 opacity-60" />
        На выработке нет вентилятора
      </div>
    );
  }
  const own = b.indicators ?? {};
  const set = (k: string, v: boolean) => onChange({ ...own, [k]: v });
  const preview = ROWS.filter(r => own[r.key]).map(r => r.sample(b));
  const anyOn = FAN_KEYS.some(k => own[k]);

  return (
    <div className="p-2 space-y-2" style={{ fontFamily: "var(--font-ui)" }}>
      <Card icon="Captions" title="Подпись у вентилятора" tone="signal">
        <div className="rounded px-2 py-1.5 text-[11px] leading-tight min-h-[28px]"
          style={{ background: "var(--c-s2, #f8f7f4)", border: "1px dashed var(--c-b2, #d5d1c8)",
            color: "var(--c-t1, #1f2328)", fontFamily: "var(--font-num)" }}>
          {preview.length > 0
            ? preview.map((l, i) => <div key={i}>{l}</div>)
            : <span style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-ui)" }}>Подписи нет — включите показатели ниже</span>}
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onChange({ ...own, ...Object.fromEntries(FAN_KEYS.map(k => [k, true])) })}
            className="flex-1 h-7 rounded text-[11px] flex items-center justify-center gap-1"
            style={{ background: "var(--c-s3, #f1efea)", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3a3f45)", cursor: "pointer" }}>
            <Icon name="CheckCheck" size={12} /> Всё
          </button>
          <button type="button" disabled={!anyOn}
            onClick={() => onChange({ ...own, ...Object.fromEntries(FAN_KEYS.map(k => [k, false])) })}
            className="flex-1 h-7 rounded text-[11px] flex items-center justify-center gap-1 disabled:opacity-40"
            style={{ background: "var(--c-s3, #f1efea)", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3a3f45)", cursor: anyOn ? "pointer" : "default" }}>
            <Icon name="EyeOff" size={12} /> Скрыть подпись
          </button>
        </div>
      </Card>

      <Card icon="Gauge" title="Показатели">
        <div className="-mx-1">
          {ROWS.map(r => (
            <Switch key={r.key} checked={!!own[r.key]} onChange={v => set(r.key, v)} label={r.label} hint={r.hint} />
          ))}
        </div>
      </Card>

      {(onFontSize || onResetOffset) && (
        <Card icon="Type" title="Вид подписи" tone="muted" collapsible>
          {onFontSize && (
            <div>
              <div className="flex justify-between text-[10px] mb-0.5" style={{ color: "var(--c-t3, #6b7280)" }}>
                <span>Размер текста</span>
                <span style={{ fontFamily: "var(--font-num)" }}>{fontSize ?? 9}</span>
              </div>
              <input type="range" min={3} max={30} step={0.5} value={fontSize ?? 9}
                onChange={e => onFontSize(Number(e.target.value))}
                className="w-full" style={{ accentColor: "var(--c-accent, #1e5a7a)" }} />
            </div>
          )}
          {onResetOffset && (
            <button type="button" onClick={onResetOffset}
              className="w-full h-7 rounded text-[11px] flex items-center justify-center gap-1"
              style={{ background: "transparent", border: "1px dashed var(--c-b2, #d5d1c8)", color: "var(--c-accent, #1e5a7a)", cursor: "pointer" }}
              title="Подпись перетаскивается мышью на схеме — кнопка вернёт её к значку">
              <Icon name="LocateFixed" size={12} /> Вернуть подпись к значку
            </button>
          )}
        </Card>
      )}
    </div>
  );
}
