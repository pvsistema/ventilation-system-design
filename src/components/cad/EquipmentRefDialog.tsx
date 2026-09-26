// Справочник оборудования — аналог справочников в АэроСети
import { useState, useCallback, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { FAN_CATALOG, fanHAngle, fanQMax, type FanCurve } from "@/lib/fanCurves";
import {
  BULKHEAD_CATALOG, BULKHEAD_TYPE_LABELS, BULKHEAD_TYPE_COLORS,
  type BulkheadCatalogItem, type BulkheadType, airPermToR,
} from "@/lib/bulkheads";
import UnitsConfigPanel from "@/components/cad/UnitsConfigPanel";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { PUMP_CATALOG, PUMP_TYPE_NAMES, pumpHead, type PumpModel } from "@/lib/pumps";
import { CONSUMER_CATALOG, CONSUMER_GROUP_NAMES, type ConsumerGroup } from "@/lib/waterConsumers";
import PumpChart from "@/components/cad/PumpChart";
import { type VentNorms, DEFAULT_VENT_NORMS } from "@/lib/ventSections";
import {
  type ExplosionThresholds, DEFAULT_EXPLOSION_THRESHOLDS,
  TYPICAL_EXPLOSION_THRESHOLDS, EXPLOSION_HAZARD_COLORS,
} from "@/lib/explosionCalculator";

type TabId = "fans" | "types" | "bulkheads" | "airnorms" | "blastzones" | "sensors" | "typical" | "pumps" | "consumers" | "pipes" | "transport" | "units";

export interface MineFanExport {
  catalogId: string;
  name: string;
  diameter: number;
  rpmMin: number;
  rpmMax: number;
}

export interface MineBulkheadExport {
  id: string;
  name: string;
  type: BulkheadType;
  airPermeability: number;
  rMkyurg: number;     // сопротивление в Мюрг
  failurePressure: number;
  note: string;
  color: string;
  isCustom?: boolean;
}

interface Props {
  activeTab: TabId;
  onTabChange: (t: TabId) => void;
  onClose: () => void;
  onMineFansChange?: (fans: MineFanExport[]) => void;
  onMineBulkheadsChange?: (bulkheads: MineBulkheadExport[]) => void;
  onBranchTypesChange?: (types: BranchType[]) => void;
  initialMineFans?: MineFanExport[];
  initialBranchTypes?: BranchType[];
  initialMineBulkheads?: MineBulkheadExport[];
  unitsConfig?: UnitsConfig;
  onUnitsConfigChange?: (cfg: UnitsConfig) => void;
  /** Нормы расхода воздуха (ФНиП № 505) */
  ventNorms?: VentNorms;
  onVentNormsChange?: (n: VentNorms) => void;
  /** Пороги зон поражения взрывом */
  blastThresholds?: ExplosionThresholds;
  onBlastThresholdsChange?: (t: ExplosionThresholds) => void;
}

// ─── Оформление в палитре темы (--c-accent / --c-s* / --c-b* / --c-t*) ────
// Одни и те же классы для всех разделов: раньше каждый раздел красил кнопки
// и поля по-своему (bg-blue-600, border-gray-300…) и выпадал из темы.
const INPUT =
  "w-full h-8 px-2 text-[12px] rounded-md outline-none border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t1)] focus:border-[var(--c-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--c-accent)_20%,transparent)]";
const LABEL = "block text-[10px] font-medium mb-1 text-[var(--c-t3)]";
const BTN =
  "h-7 px-2.5 inline-flex items-center justify-center gap-1 text-[11px] rounded-md border border-[var(--c-b2)] bg-[var(--c-s1)] text-[var(--c-t2)] hover:bg-[var(--c-s3)] transition-colors";
const BTN_PRIMARY =
  "h-7 px-3 inline-flex items-center justify-center gap-1 text-[11px] font-medium rounded-md text-white bg-[var(--c-accent)] hover:bg-[var(--c-accent-ink)] disabled:opacity-40 transition-colors";
const BTN_DANGER =
  "h-7 px-2.5 inline-flex items-center justify-center gap-1 text-[11px] rounded-md border border-[var(--c-tint-red2)] text-[var(--c-red)] hover:bg-[var(--c-tint-red)] transition-colors";
const ICON_BTN =
  "w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--c-t3)] hover:bg-[var(--c-s3)] hover:text-[var(--c-t1)] transition-colors";
const MODAL = "rounded-xl shadow-2xl flex flex-col overflow-hidden bg-[var(--c-s1)] border border-[var(--c-b2)]";
const MODAL_HEAD = "flex items-center gap-2 px-4 h-11 border-b border-[var(--c-b1)] flex-shrink-0";

const TABS: { id: TabId; label: string; icon: string; group: string; hint: string; demo?: boolean }[] = [
  { id: "fans",      label: "Вентиляторы",        icon: "Wind",      group: "Вентиляция",
    hint: "Вентиляторы, установленные на руднике. Добавляются из библиотеки, затем назначаются ветвям в свойствах." },
  { id: "types",     label: "Типы выработок",      icon: "Layers",    group: "Вентиляция",
    hint: "Типовые сечения и крепь. Тип выбирается в свойствах ветви — сечение и сопротивление подставятся сами." },
  { id: "bulkheads", label: "Перемычки",           icon: "Square",    group: "Вентиляция",
    hint: "Перемычки рудника с воздухопроницаемостью. Сопротивление R считается автоматически." },
  { id: "airnorms",  label: "Нормы расхода воздуха", icon: "Calculator", group: "Вентиляция",
    hint: "Нормы для расчёта количества воздуха по ФНиП № 505." },
  { id: "blastzones",label: "Зоны поражения взрывом", icon: "Bomb",   group: "Аварии",
    hint: "Пороги избыточного давления для зон поражения и окраски выработок." },
  { id: "sensors",   label: "Датчики",             icon: "Radio",     group: "Аварии",
    hint: "Датчики рудника. Заполняется вручную. В расчётах пока не используется." },
  { id: "typical",   label: "Типовые мероприятия", icon: "FileText",  group: "Аварии",
    hint: "Типовые мероприятия. Заполняется вручную. В расчётах пока не используется." },
  { id: "pumps",     label: "Насосы",              icon: "Gauge",     group: "Трубопровод",
    hint: "Библиотека насосов. Нажмите строку — откроется напорная характеристика." },
  { id: "consumers", label: "Потребители",         icon: "Flame",     group: "Трубопровод",
    hint: "Пожарные стволы, распылители, пеногенераторы. Модель выбирается в свойствах узла-потребителя." },
  { id: "pipes",     label: "Трубы",               icon: "GitBranch", group: "Трубопровод",
    hint: "Трубы рудника. Заполняется вручную. В расчётах пока не используется." },
  { id: "transport", label: "Транспорт",           icon: "Truck",     group: "Общее",
    hint: "Самоходная техника: пожарная нагрузка (резина, дизель, масло), кг." },
  { id: "units",     label: "Единицы измерения",   icon: "Ruler",     group: "Общее",
    hint: "Единицы, в которых программа показывает и принимает значения." },
];
const TAB_GROUPS = ["Вентиляция", "Аварии", "Трубопровод", "Общее"];

// ─── Типы для справочника вентиляторов рудника ────────────────────────────
const CURVE_COLORS = ["#e91e63", "#ff5722", "#ff9800", "#4caf50", "#2196f3", "#9c27b0", "#00bcd4"];

interface MineAngle {
  id: string;
  angle: number;
  reverse: boolean;
  rpm: number;
  color: string;
  operatingQ?: number;
  operatingH?: number;
}
interface MineFan {
  id: string;
  catalogId: string;
  name: string;
  type: string;
  diameter: number;
  rpmMin: number;
  rpmMax: number;
  bladeAngles: MineAngle[];
  note?: string;
}

/**
 * Точки кривой Q-H для графика.
 *
 * Считаются ТОЙ ЖЕ функцией, что и расчёт сети (fanHAngle), иначе картинка в
 * справочнике расходилась бы с рабочей точкой: раньше здесь была своя формула
 * угла лопаток (0.6 + 0.4·t), а в расчёте — другая, и график показывал одно,
 * а сеть считала другое.
 *
 * Кривая рисуется до паспортного предела для выбранного угла: при малом угле
 * вентилятор физически не выдаёт полный номинальный расход.
 */
function fanCurvePoints(c: FanCurve, angle?: number, n = 40): { q: number; h: number; p: number }[] {
  const pts = [];
  const qMaxA = fanQMax(c, angle);
  const qMinA = Math.min(c.qMin, qMaxA * 0.9);
  for (let i = 0; i <= n; i++) {
    const q = qMinA + (qMaxA - qMinA) * (i / n);
    const h = fanHAngle(c, q, angle);
    const eta = Math.min(0.85, Math.max(0.05, c.e0 + c.e1 * q + c.e2 * q * q));
    const p = eta > 0 ? (h * q) / eta / 1000 : 0;
    pts.push({ q: +q.toFixed(2), h: +h.toFixed(0), p: +Math.max(0, p).toFixed(1) });
  }
  return pts;
}

function reverseCurvePoints(c: FanCurve, n = 40): { q: number; h: number; p: number }[] {
  if (c.reverseH0 === undefined) return [];
  const pts = [];
  const qMin = c.reverseQMin ?? c.qMin;
  const qMax = c.reverseQMax ?? c.qMax;
  for (let i = 0; i <= n; i++) {
    const q = qMin + (qMax - qMin) * (i / n);
    const h = Math.max(0, c.reverseH0! + (c.reverseH1 ?? 0) * q + (c.reverseH2 ?? 0) * q * q);
    const eta = Math.min(0.85, Math.max(0.05, c.e0 + c.e1 * q + c.e2 * q * q)) * (c.reverseEfficiencyFactor ?? 0.82);
    const p = eta > 0 ? (h * q) / eta / 1000 : 0;
    pts.push({ q: +q.toFixed(2), h: +h.toFixed(0), p: +Math.max(0, p).toFixed(1) });
  }
  return pts;
}

// ─── График Q-H / Q-P ─────────────────────────────────────────────────────
function FanChart({ curves, type, operatingPoints }: {
  curves: { pts: { q: number; h: number; p: number }[]; color: string; dash?: boolean }[];
  type: "qh" | "qp";
  operatingPoints?: { q: number; h: number; color: string }[];
}) {
  const W = 340, H = 190, PL = 46, PR = 12, PT = 10, PB = 30;
  const cw = W - PL - PR, ch = H - PT - PB;

  const allPts = curves.flatMap(c => c.pts);
  if (allPts.length === 0) return <svg width={W} height={H}><text x={W/2} y={H/2} textAnchor="middle" fontSize="11" style={{ fill: "var(--c-t4, #999)" }}>Нет данных</text></svg>;

  const maxQ = Math.max(...allPts.map(p => p.q)) * 1.05 || 100;
  const maxV = type === "qh"
    ? Math.max(...allPts.map(p => p.h)) * 1.15 || 1000
    : Math.max(...allPts.map(p => p.p)) * 1.15 || 100;

  const toX = (q: number) => PL + (q / maxQ) * cw;
  const toY = (v: number) => PT + ch - (v / maxV) * ch;

  const yTicks = 4, xTicks = 5;
  return (
    <svg width={W} height={H} style={{ fontFamily: "var(--font-num)", display: "block" }}>
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const y = PT + (i / yTicks) * ch;
        const val = maxV * (1 - i / yTicks);
        return <g key={i}>
          <line x1={PL} y1={y} x2={W - PR} y2={y} style={{ stroke: "var(--c-b1, #e5e7eb)" }} strokeWidth="0.7" />
          <text x={PL - 4} y={y + 3} fontSize="8" textAnchor="end" style={{ fill: "var(--c-t3, #888)" }}>
            {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
          </text>
        </g>;
      })}
      {Array.from({ length: xTicks + 1 }).map((_, i) => {
        const x = PL + (i / xTicks) * cw;
        const val = maxQ * (i / xTicks);
        return <g key={i}>
          <line x1={x} y1={PT} x2={x} y2={PT + ch} style={{ stroke: "var(--c-b1, #e5e7eb)" }} strokeWidth="0.7" />
          <text x={x} y={H - 8} fontSize="8" textAnchor="middle" style={{ fill: "var(--c-t3, #888)" }}>{val.toFixed(0)}</text>
        </g>;
      })}
      <rect x={PL} y={PT} width={cw} height={ch} fill="none" style={{ stroke: "var(--c-b2, #ccc)" }} strokeWidth="0.8" />
      {curves.map((c, ci) => {
        if (c.pts.length === 0) return null;
        const d = c.pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.q).toFixed(1)},${toY(type === "qh" ? p.h : p.p).toFixed(1)}`).join(" ");
        return <path key={ci} d={d} fill="none" stroke={c.color} strokeWidth={c.dash ? 1.2 : 2}
          strokeDasharray={c.dash ? "4,3" : undefined} strokeLinejoin="round" />;
      })}
      {operatingPoints?.map((op, i) => (
        <g key={i}>
          <circle cx={toX(op.q)} cy={toY(op.h)} r={4} fill={op.color} stroke="white" strokeWidth={1.5} />
        </g>
      ))}
      <text x={PL + cw / 2} y={H - 1} fontSize="8" textAnchor="middle" style={{ fill: "var(--c-t3, #666)" }}>Расход, м³/с</text>
      <text transform={`translate(9,${PT + ch / 2}) rotate(-90)`} fontSize="8" textAnchor="middle" style={{ fill: "var(--c-t3, #666)" }}>
        {type === "qh" ? "Напор, Па" : "Мощность, кВт"}
      </text>
    </svg>
  );
}

// ─── Диалог выбора из библиотеки ──────────────────────────────────────────
function LibraryDialog({ onSelect, onClose }: { onSelect: (c: FanCurve) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "axial" | "centrifugal" | "vmp">("all");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const list = FAN_CATALOG.filter(c =>
    (filter === "all" || c.type === filter) &&
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const preview = previewId ? FAN_CATALOG.find(c => c.id === previewId) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(15,20,25,0.45)" }}>
      <div className={MODAL} style={{ width: 760, height: 520 }}>
        {/* Шапка */}
        <div className={MODAL_HEAD} style={{ background: "var(--c-s2, #f8f7f4)" }}>
          <Icon name="BookOpen" size={14} className="text-[var(--c-blue)]" />
          <span className="text-[13px] font-semibold text-[var(--c-t1)]">Библиотека вентиляторов</span>
          <button onClick={onClose} className={ICON_BTN + " ml-auto"}><Icon name="X" size={16} /></button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          {/* Левая панель — список */}
          <div className="flex flex-col border-r border-[var(--c-b1)]" style={{ width: 280 }}>
            {/* Поиск + фильтр */}
            <div className="p-2 border-b border-[var(--c-b1)] space-y-1.5 flex-shrink-0">
              <div className="flex items-center gap-1 border border-[var(--c-b2)] rounded-md px-2 bg-[var(--c-s1)]">
                <Icon name="Search" size={12} className="text-[var(--c-t4)]" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Поиск..." className="flex-1 text-[12px] py-1 outline-none bg-transparent text-[var(--c-t1)]" />
              </div>
              <div className="flex gap-1">
                {([["all", "Все"], ["axial", "Осевые"], ["centrifugal", "Центробежные"], ["vmp", "ВМП"]] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setFilter(v)}
                    className="flex-1 py-0.5 text-[10px] rounded-md border"
                    style={{ background: filter === v ? "var(--c-blue-bg, #1e5a7a)" : "var(--c-s1, #fff)", color: filter === v ? "white" : "var(--c-t3, #555)", borderColor: filter === v ? "var(--c-blue-bg, #1e5a7a)" : "var(--c-b2, #d1d5db)" }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {/* Список */}
            <div className="flex-1 overflow-y-auto">
              {list.map(c => (
                <div key={c.id}
                  onClick={() => setPreviewId(c.id)}
                  className="flex items-center justify-between px-3 py-2 cursor-pointer border-b border-[var(--c-b1)] select-none hover:bg-[var(--c-tint-blue)]"
                  style={{ background: previewId === c.id ? "var(--c-tint-blue2, #dbeafe)" : undefined }}>
                  <div>
                    <div className="text-[12px] font-semibold text-[var(--c-blue-ink)]">{c.name}</div>
                    <div className="text-[10px] text-[var(--c-t3)]">{c.type === "axial" ? "Осевой" : c.type === "vmp" ? "ВМП" : "Центробежный"}</div>
                  </div>
                  <span className="text-[10px] text-[var(--c-t4)]">Ø{c.diameter} м</span>
                </div>
              ))}
              {list.length === 0 && (
                <div className="flex items-center justify-center h-24 text-[12px] text-[var(--c-t4)]">Не найдено</div>
              )}
            </div>
          </div>

          {/* Правая панель — предпросмотр */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {preview ? (
              <>
                <div className="px-4 py-3 border-b border-[var(--c-b1)] flex-shrink-0">
                  <div className="text-[14px] font-bold text-[var(--c-t1)]">{preview.name}</div>
                  <div className="text-[11px] text-[var(--c-t3)] mt-0.5">
                    {preview.type === "axial" ? "Осевой" : preview.type === "vmp" ? "ВМП" : "Центробежный"} · Ø{preview.diameter} м · {preview.rpmMin}–{preview.rpmMax} об/мин
                  </div>
                  <div className="flex gap-3 mt-1.5 text-[11px] text-[var(--c-t2)]">
                    {/* Паспортный диапазон: с учётом крайних углов лопаток —
                        минимум по самому закрытому, максимум по самому открытому */}
                    <span>Q: {(() => {
                      const a = preview.bladeAngles;
                      const lo = a.length > 1 ? fanQMax(preview, a[0]) / preview.qMax * preview.qMin : preview.qMin;
                      const hi = a.length > 1 ? fanQMax(preview, a[a.length - 1]) : preview.qMax;
                      const f = (v: number) => v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
                      return `${f(lo)}–${f(hi)}`;
                    })()} м³/с</span>
                    <span>H: {Math.round(
                      preview.bladeAngles.length > 1
                        ? fanHAngle(preview, preview.qMin, preview.bladeAngles[preview.bladeAngles.length - 1])
                        : preview.h0
                    )} Па (max)</span>
                    {preview.bladeAngles.length > 0 && <span>Углы: {preview.bladeAngles.join(", ")}°</span>}
                    {preview.reverseH0 !== undefined && <span className="text-[var(--c-green)] font-medium">✓ Реверс</span>}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {/* Q-H кривые для всех углов */}
                  {(() => {
                    const angles = preview.bladeAngles.length > 0 ? preview.bladeAngles : [0];
                    const curves = angles.map((a, i) => ({
                      pts: fanCurvePoints(preview, a),
                      color: CURVE_COLORS[i % CURVE_COLORS.length],
                    }));
                    const reverseCurves = preview.reverseH0 !== undefined ? [{
                      pts: reverseCurvePoints(preview),
                      color: "#9c27b0",
                      dash: true,
                    }] : [];
                    return (
                      <div className="space-y-2">
                        <div>
                          <div className="text-[10px] text-[var(--c-t3)] font-medium mb-1">Напор — Расход</div>
                          <div style={{ border: "1px solid var(--c-b1, #e5e7eb)", borderRadius: "var(--radius-ui)", overflow: "hidden" }}>
                            <FanChart curves={[...curves, ...reverseCurves]} type="qh" />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {angles.map((a, i) => (
                            <div key={i} className="flex items-center gap-1">
                              <div className="w-5 h-1.5 rounded-md" style={{ background: CURVE_COLORS[i % CURVE_COLORS.length] }} />
                              <span className="text-[10px] text-[var(--c-t2)]">{a > 0 ? "+" : ""}{a}°</span>
                            </div>
                          ))}
                          {preview.reverseH0 !== undefined && (
                            <div className="flex items-center gap-1">
                              <div className="w-5 h-0.5 rounded-md" style={{ borderTop: "2px dashed #9c27b0" }} />
                              <span className="text-[10px] text-[var(--c-purple)]">Реверс</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--c-t4)] flex-col gap-2">
                <Icon name="MousePointer2" size={24} className="text-[var(--c-b3)]" />
                Выберите вентилятор из списка
              </div>
            )}
          </div>
        </div>
        {/* Кнопки */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s2, #f8f8f8)" }}>
          <span className="text-[11px] text-[var(--c-t3)] flex-1">
            {preview ? `Выбран: ${preview.name}` : "Выберите вентилятор из списка для импорта"}
          </span>
          <button onClick={onClose} className={BTN}>
            Отмена
          </button>
          <button onClick={() => preview && onSelect(preview)} disabled={!preview}
            className={BTN_PRIMARY}>
            Импортировать
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Диалог добавления характеристики ─────────────────────────────────────
function AddAngleDialog({ fan, onAdd, onClose }: {
  fan: MineFan;
  onAdd: (a: MineAngle) => void;
  onClose: () => void;
}) {
  const catalog = FAN_CATALOG.find(c => c.id === fan.catalogId);
  const availAngles = catalog?.bladeAngles ?? [];
  const [angle, setAngle] = useState(availAngles[0] ?? 0);
  const [reverse, setReverse] = useState(false);
  const [rpm, setRpm] = useState(fan.rpmMax);
  const [opQ, setOpQ] = useState(catalog?.qNominal ?? 0);
  const [opH, setOpH] = useState(catalog?.hNominal ?? 0);

  const preview = catalog ? fanCurvePoints(catalog, angle) : [];
  const revPts = (reverse && catalog?.reverseH0 !== undefined) ? reverseCurvePoints(catalog) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(15,20,25,0.45)" }}>
      <div className={MODAL} style={{ width: 520, maxHeight: 520 }}>
        <div className={MODAL_HEAD} style={{ background: "var(--c-s2, #f8f7f4)" }}>
          <Icon name="Plus" size={14} className="text-[var(--c-blue)]" />
          <span className="text-[13px] font-semibold">Новая рабочая характеристика — {fan.name}</span>
          <button onClick={onClose} className={ICON_BTN + " ml-auto"}><Icon name="X" size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL}>Угол лопаток, °</label>
              {availAngles.length > 0 ? (
                <select value={angle} onChange={e => setAngle(+e.target.value)}
                  className={INPUT}>
                  {availAngles.map(a => <option key={a} value={a}>{a > 0 ? "+" : ""}{a}°</option>)}
                </select>
              ) : (
                <input type="number" value={angle} onChange={e => setAngle(+e.target.value)}
                  className={INPUT} />
              )}
            </div>
            <div className="space-y-1">
              <label className={LABEL}>Скорость, об/мин</label>
              <input type="number" min={fan.rpmMin} max={fan.rpmMax} value={rpm}
                onChange={e => setRpm(+e.target.value)}
                className={INPUT} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="rev-check" checked={reverse}
              onChange={e => setReverse(e.target.checked)}
              className="w-4 h-4" style={{ accentColor: "#9333ea" }} />
            <label htmlFor="rev-check" className="text-[12px] text-[var(--c-t2)]">
              Реверсивная характеристика
              {!catalog?.reverseH0 && " (данные по реверсу отсутствуют в каталоге)"}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={LABEL}>Рабочая точка Q, м³/с</label>
              <input type="number" min={0} step={1} value={opQ} onChange={e => setOpQ(+e.target.value)}
                className={INPUT} />
            </div>
            <div className="space-y-1">
              <label className={LABEL}>Рабочая точка H, Па</label>
              <input type="number" min={0} step={10} value={opH} onChange={e => setOpH(+e.target.value)}
                className={INPUT} />
            </div>
          </div>
          {/* Предпросмотр */}
          {catalog && (
            <div>
              <div className="text-[10px] text-[var(--c-t3)] font-medium mb-1">Предпросмотр Q–H</div>
              <div style={{ border: "1px solid var(--c-b1, #e5e7eb)", borderRadius: "var(--radius-ui)", overflow: "hidden" }}>
                <FanChart
                  curves={[
                    { pts: preview, color: "#2196f3" },
                    ...(revPts.length ? [{ pts: revPts, color: "#9c27b0", dash: true }] : []),
                  ]}
                  type="qh"
                  operatingPoints={opQ > 0 ? [{ q: opQ, h: opH, color: "#e91e63" }] : []}
                />
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 px-4 py-2 border-t border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s2, #f8f8f8)" }}>
          <button onClick={onClose} className={BTN}>Отмена</button>
          <button onClick={() => {
            onAdd({
              id: `a${Date.now()}`,
              angle, reverse, rpm,
              color: CURVE_COLORS[0],
              operatingQ: opQ || undefined,
              operatingH: opH || undefined,
            });
            onClose();
          }} className={BTN_PRIMARY + " ml-auto"}>
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Секция вентиляторов ──────────────────────────────────────────────────
function catalogToMineFan(c: FanCurve): MineFan {
  const defaultAngles = c.bladeAngles.length > 0 ? c.bladeAngles : [0];
  return {
    id: `mf_${c.id}_${Date.now()}`,
    catalogId: c.id,
    name: c.name,
    type: c.type === "axial" ? "Осевой" : "Центробежный",
    diameter: c.diameter,
    rpmMin: c.rpmMin,
    rpmMax: c.rpmMax,
    bladeAngles: defaultAngles.map((a, i) => ({
      id: `a${i}`,
      angle: a,
      reverse: false,
      rpm: c.rpmNominal,
      color: CURVE_COLORS[i % CURVE_COLORS.length],
    })),
    note: "",
  };
}





function exportToMineFan(exp: MineFanExport): MineFan {
  const catalog = FAN_CATALOG.find(c => c.id === exp.catalogId);
  const defaultAngles = catalog && catalog.bladeAngles.length > 0 ? catalog.bladeAngles : [0];
  return {
    id: `mf_${exp.catalogId}_restored`,
    catalogId: exp.catalogId,
    name: exp.name,
    type: catalog ? (catalog.type === "axial" ? "Осевой" : "Центробежный") : "Осевой",
    diameter: exp.diameter,
    rpmMin: exp.rpmMin,
    rpmMax: exp.rpmMax,
    bladeAngles: defaultAngles.map((a, i) => ({
      id: `a${i}`,
      angle: a,
      reverse: false,
      rpm: catalog?.rpmNominal ?? exp.rpmMax,
      color: CURVE_COLORS[i % CURVE_COLORS.length],
    })),
    note: "",
  };
}

// ─── Секция вентиляторов ──────────────────────────────────────────────────
function FansSection({ onMineFansChange, initialMineFans }: { onMineFansChange?: (fans: MineFanExport[]) => void; initialMineFans?: MineFanExport[] }) {
  const [fans, setFans] = useState<MineFan[]>(() =>
    initialMineFans && initialMineFans.length > 0
      ? initialMineFans.map(exportToMineFan)
      : []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [addAngleFor, setAddAngleFor] = useState<MineFan | null>(null);
  const [editNote, setEditNote] = useState(false);

  const selected = fans.find(f => f.id === selectedId) ?? null;
  const catalog = selected ? FAN_CATALOG.find(c => c.id === selected.catalogId) : null;

  const updateFans = (next: MineFan[]) => {
    setFans(next);
    onMineFansChange?.(next.map(f => ({ catalogId: f.catalogId, name: f.name, diameter: f.diameter, rpmMin: f.rpmMin, rpmMax: f.rpmMax })));
  };

  const importFromLibrary = (c: FanCurve) => {
    const mf = catalogToMineFan(c);
    updateFans([...fans, mf]);
    setSelectedId(mf.id);
    setShowLibrary(false);
  };

  const removeFan = (id: string) => {
    const next = fans.filter(f => f.id !== id);
    updateFans(next);
    if (selectedId === id) setSelectedId(null);
  };

  const updateAngle = (fanId: string, angleId: string, patch: Partial<MineAngle>) => {
    updateFans(fans.map(f => f.id === fanId
      ? { ...f, bladeAngles: f.bladeAngles.map(a => a.id === angleId ? { ...a, ...patch } : a) }
      : f
    ));
  };

  const removeAngle = (fanId: string, angleId: string) => {
    updateFans(fans.map(f => f.id === fanId
      ? { ...f, bladeAngles: f.bladeAngles.filter(a => a.id !== angleId) }
      : f
    ));
  };

  const addAngle = (fanId: string, angle: MineAngle) => {
    updateFans(fans.map(f => f.id === fanId
      ? { ...f, bladeAngles: [...f.bladeAngles, { ...angle, color: CURVE_COLORS[f.bladeAngles.length % CURVE_COLORS.length] }] }
      : f
    ));
  };

  // Кривые для текущего вентилятора
  const buildCurves = (fan: MineFan) => {
    const c = FAN_CATALOG.find(x => x.id === fan.catalogId);
    if (!c) return [];
    return fan.bladeAngles.map(a => ({
      pts: a.reverse && c.reverseH0 !== undefined
        ? reverseCurvePoints(c)
        : fanCurvePoints(c, a.angle),
      color: a.color,
      dash: a.reverse,
    }));
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Левая панель — список вентиляторов рудника */}
      <div className="flex flex-col border-r border-[var(--c-b1)]" style={{ width: 220, flexShrink: 0 }}>
        {/* Шапка */}
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s3, #f1efea)" }}>
          <span className="text-[11px] font-semibold text-[var(--c-t2)]">Вентиляторы рудника</span>
          <button onClick={() => setShowLibrary(true)}
            className="flex items-center gap-1 text-[10px] text-[var(--c-blue)] hover:text-[var(--c-blue-ink)]">
            <Icon name="Library" size={11} /> Из библиотеки
          </button>
        </div>

        {/* Список */}
        <div className="flex-1 overflow-y-auto">
          {fans.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-3 gap-2 py-8">
              <Icon name="Wind" size={28} className="text-[var(--c-b3)]" />
              <span className="text-[12px] text-[var(--c-t3)] text-center">Справочник пуст</span>
              <span className="text-[10px] text-[var(--c-t4)] text-center">Импортируйте вентиляторы из библиотеки</span>
              <button onClick={() => setShowLibrary(true)}
                className={BTN_PRIMARY + " mt-1"}>
                <Icon name="Library" size={11} /> Открыть библиотеку
              </button>
            </div>
          ) : fans.map(f => (
            <div key={f.id}
              onClick={() => setSelectedId(f.id)}
              className="group flex items-start justify-between px-2 py-2 cursor-pointer border-b border-[var(--c-b1)] select-none hover:bg-[var(--c-tint-blue)]"
              style={{ background: selectedId === f.id ? "var(--c-tint-blue2, #dbeafe)" : undefined }}>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[var(--c-blue-ink)] truncate">{f.name}</div>
                <div className="text-[10px] text-[var(--c-t3)]">{f.type} · Ø{f.diameter} м</div>
                <div className="text-[10px] text-[var(--c-t4)]">{f.bladeAngles.length} хар-ик</div>
              </div>
              <button onClick={e => { e.stopPropagation(); removeFan(f.id); }}
                className="opacity-0 group-hover:opacity-100 text-[var(--c-b3)] hover:text-[var(--c-red)] ml-1 mt-0.5">
                <Icon name="Trash2" size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* Кнопка добавить */}
        {fans.length > 0 && (
          <button onClick={() => setShowLibrary(true)}
            className="flex-shrink-0 flex items-center justify-center gap-1 py-2 text-[11px] text-[var(--c-blue)] hover:bg-[var(--c-tint-blue)] border-t border-[var(--c-b1)]">
            <Icon name="Plus" size={11} /> Добавить из библиотеки
          </button>
        )}
      </div>

      {/* Правая панель */}
      {selected && catalog ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Шапка */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s2, #f8f8f8)" }}>
            <span className="text-[13px] font-bold text-[var(--c-t1)]">{selected.name}</span>
            <span className="text-[11px] text-[var(--c-t3)]">Ø{selected.diameter} м</span>
            <span className="text-[10px] text-[var(--c-t4)]">·</span>
            <span className="text-[11px] text-[var(--c-t3)]">{selected.type}</span>
            <span className="text-[10px] text-[var(--c-t4)] ml-1">{selected.rpmMin}–{selected.rpmMax} об/мин</span>
            {catalog.reverseH0 !== undefined && (
              <span className="ml-1 px-1.5 py-0.5 bg-[var(--c-tint-purple)] text-[var(--c-purple)] text-[10px] rounded-md font-medium">✓ Реверс</span>
            )}
            <button onClick={() => selected && setAddAngleFor(selected)}
              className={BTN_PRIMARY + " ml-auto"}>
              <Icon name="Plus" size={11} /> Характеристика
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Таблица характеристик */}
            <div className="flex flex-col border-r border-[var(--c-b1)] flex-shrink-0" style={{ width: 240 }}>
              <div className="grid text-[10px] font-semibold text-[var(--c-t2)] border-b border-[var(--c-b1)] px-1 py-1.5 select-none"
                style={{ background: "var(--c-s2, #f8f7f4)", gridTemplateColumns: "14px 42px 36px 64px 22px" }}>
                <div />
                <div>Угол</div>
                <div className="text-center">Реверс</div>
                <div>Об/мин</div>
                <div />
              </div>
              <div className="flex-1 overflow-y-auto">
                {selected.bladeAngles.length === 0 ? (
                  <div className="flex items-center justify-center h-20 text-[11px] text-[var(--c-t4)]">
                    Нет характеристик
                  </div>
                ) : selected.bladeAngles.map(a => (
                  <div key={a.id}
                    className="grid items-center gap-0.5 px-1 py-1.5 border-b border-[var(--c-b1)] hover:bg-[var(--c-s2)]"
                    style={{ gridTemplateColumns: "14px 42px 36px 64px 22px" }}>
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
                    {/* Угол */}
                    {catalog.bladeAngles.length > 0 ? (
                      <select value={a.angle}
                        onChange={e => updateAngle(selected.id, a.id, { angle: +e.target.value })}
                        className="text-[10px] border border-[var(--c-b2)] rounded-md px-0.5 py-0.5 w-full text-[var(--c-t1)] bg-[var(--c-s1)]">
                        {catalog.bladeAngles.map(ba => <option key={ba} value={ba}>{ba > 0 ? "+" : ""}{ba}°</option>)}
                      </select>
                    ) : (
                      <input type="number" value={a.angle}
                        onChange={e => updateAngle(selected.id, a.id, { angle: +e.target.value })}
                        className="text-[10px] border border-[var(--c-b2)] rounded-md px-1 py-0.5 w-full text-[var(--c-t1)] text-right" />
                    )}
                    {/* Реверс */}
                    <div className="flex justify-center">
                      <input type="checkbox" checked={a.reverse}
                        onChange={e => updateAngle(selected.id, a.id, { reverse: e.target.checked })}
                        className="w-3.5 h-3.5" style={{ accentColor: "#9333ea" }} />
                    </div>
                    {/* Об/мин */}
                    <input type="number" value={a.rpm} min={selected.rpmMin} max={selected.rpmMax} step={10}
                      onChange={e => updateAngle(selected.id, a.id, { rpm: +e.target.value })}
                      className="text-[10px] border border-[var(--c-b2)] rounded-md px-1 py-0.5 w-full text-[var(--c-t1)] text-right" />
                    {/* Удалить */}
                    <button onClick={() => removeAngle(selected.id, a.id)}
                      className="text-[var(--c-b3)] hover:text-[var(--c-red)] flex justify-center">
                      <Icon name="X" size={11} />
                    </button>
                  </div>
                ))}
              </div>
              {/* Рабочие точки */}
              {selected.bladeAngles.some(a => a.operatingQ) && (
                <div className="border-t border-[var(--c-b1)] px-2 py-1.5 flex-shrink-0" style={{ background: "var(--c-tint-amber, #fefce8)" }}>
                  <div className="text-[10px] font-semibold text-[var(--c-amber-ink)] mb-1">Рабочие точки</div>
                  {selected.bladeAngles.filter(a => a.operatingQ).map(a => (
                    <div key={a.id} className="flex items-center gap-1.5 mb-0.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
                      <span className="text-[10px] text-[var(--c-t2)]">
                        {a.angle > 0 ? "+" : ""}{a.angle}°: Q={a.operatingQ} м³/с, H={a.operatingH} Па
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* Заметка */}
              <div className="border-t border-[var(--c-b1)] px-2 py-1.5 flex-shrink-0">
                {editNote ? (
                  <textarea
                    autoFocus
                    value={selected.note ?? ""}
                    onChange={e => updateFans(fans.map(f => f.id === selected.id ? { ...f, note: e.target.value } : f))}
                    onBlur={() => setEditNote(false)}
                    className="w-full text-[10px] border border-[var(--c-b2)] rounded-md px-1 py-0.5 text-[var(--c-t1)] resize-none"
                    rows={2} placeholder="Заметка..." />
                ) : (
                  <div onClick={() => setEditNote(true)}
                    className="text-[10px] text-[var(--c-t4)] cursor-text hover:text-[var(--c-t2)] min-h-[24px]">
                    {selected.note || "Добавить заметку..."}
                  </div>
                )}
              </div>
            </div>

            {/* Графики */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {(() => {
                const curves = buildCurves(selected);
                const opPoints = selected.bladeAngles.filter(a => a.operatingQ).map(a => ({
                  q: a.operatingQ!, h: a.operatingH ?? 0, color: a.color,
                }));
                return (
                  <>
                    <div>
                      <div className="text-[11px] font-semibold text-[var(--c-t2)] mb-1">Напор — Расход</div>
                      <div style={{ border: "1px solid var(--c-b1, #e5e7eb)", borderRadius: 6, overflow: "hidden" }}>
                        <FanChart curves={curves} type="qh" operatingPoints={opPoints} />
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-[var(--c-t2)] mb-1">Мощность — Расход</div>
                      <div style={{ border: "1px solid var(--c-b1, #e5e7eb)", borderRadius: 6, overflow: "hidden" }}>
                        <FanChart curves={curves} type="qp" />
                      </div>
                    </div>
                    {/* Легенда */}
                    <div className="flex flex-wrap gap-2">
                      {selected.bladeAngles.map(a => (
                        <div key={a.id} className="flex items-center gap-1">
                          <div className="w-5 rounded-md" style={{
                            height: 2,
                            background: a.reverse ? undefined : a.color,
                            borderTop: a.reverse ? `2px dashed ${a.color}` : undefined,
                          }} />
                          <span className="text-[10px] text-[var(--c-t2)]">
                            {a.angle > 0 ? "+" : ""}{a.angle}°{a.reverse ? " (рев.)" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Инфо из каталога */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[var(--c-b1)] text-[11px]">
                      <div className="text-[var(--c-t3)]">Q раб.: <span className="text-[var(--c-t1)]">{catalog.qMin}–{catalog.qMax} м³/с</span></div>
                      <div className="text-[var(--c-t3)]">H max: <span className="text-[var(--c-t1)]">{Math.round(catalog.h0)} Па</span></div>
                      <div className="text-[var(--c-t3)]">Об/мин: <span className="text-[var(--c-t1)]">{catalog.rpmMin}–{catalog.rpmMax}</span></div>
                      {catalog.reverseH0 !== undefined && (
                        <div className="text-[var(--c-purple)]">Реверс: ~{Math.round((catalog.reverseEfficiencyFactor ?? 0.82) * 100)}% напора</div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center text-[var(--c-t4)]">
          <Icon name="Wind" size={32} className="text-[var(--c-b3)]" />
          <span className="text-[13px]">Выберите вентилятор из списка</span>
          <span className="text-[11px]">или импортируйте из библиотеки</span>
        </div>
      )}

      {/* Диалог библиотеки */}
      {showLibrary && (
        <LibraryDialog
          onSelect={importFromLibrary}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* Диалог добавления характеристики */}
      {addAngleFor && (
        <AddAngleDialog
          fan={addAngleFor}
          onAdd={angle => addAngle(addAngleFor.id, angle)}
          onClose={() => setAddAngleFor(null)}
        />
      )}
    </div>
  );
}

// ─── Типы выработок: редактируемый справочник ─────────────────────────────

export interface BranchType {
  id: string;
  name: string;
  color: string;
  shape: "round" | "rect" | "arch" | "trap";
  surface: string;
  area: number;   // м² (типовое значение)
  vMax: number;   // м/с
  alphaCoef: number; // ×10⁻⁴
}

const SHAPE_LABELS: Record<string, string> = {
  round: "Круглое", rect: "Прямоугольное", arch: "Арочное", trap: "Трапециевидное",
};

const SURFACE_OPTIONS = [
  "ГИ, Жесткий металлический",
  "БШПУ, Буровзрывная проходка",
  "ГИ, Буровзрывная проходка",
  "Бетонная крепь гладкая",
  "Деревянная крепь, рамная",
  "Металлическая арочная крепь",
  "Анкерная крепь",
  "Незакреплённая, ровная порода",
  "Ствол с тюбинговой крепью",
  "Ствол со скиповым подъёмом",
];

const EMPTY_TYPE: Omit<BranchType, "id"> = {
  name: "", color: "var(--c-blue-lt, #3b82f6)", shape: "arch", surface: SURFACE_OPTIONS[0], area: 10, vMax: 8, alphaCoef: 30,
};

function TypesSection({ initialTypes = [], onBranchTypesChange }: {
  initialTypes?: BranchType[];
  onBranchTypesChange?: (types: BranchType[]) => void;
}) {
  const [types, setTypes] = useState<BranchType[]>(initialTypes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Omit<BranchType, "id">>(EMPTY_TYPE);
  const [newName, setNewName] = useState("");
  const nextId = useCallback(() => `t${Date.now()}`, []);

  const updateTypes = (next: BranchType[]) => {
    setTypes(next);
    onBranchTypesChange?.(next);
  };

  const selected = types.find(t => t.id === selectedId) ?? null;

  const startEdit = (t: BranchType) => {
    setEditForm({ name: t.name, color: t.color, shape: t.shape, surface: t.surface, area: t.area, vMax: t.vMax, alphaCoef: t.alphaCoef });
    setIsEditing(true);
  };
  const saveEdit = () => {
    if (!selectedId) return;
    updateTypes(types.map(t => t.id === selectedId ? { ...t, ...editForm } : t));
    setIsEditing(false);
  };
  const cancelEdit = () => setIsEditing(false);

  const selectRow = (t: BranchType) => {
    if (isEditing) cancelEdit();
    setSelectedId(t.id);
  };

  const addType = () => {
    const name = newName.trim();
    if (!name) return;
    const t: BranchType = { id: nextId(), ...EMPTY_TYPE, name };
    updateTypes([...types, t]);
    setNewName("");
    setSelectedId(t.id);
    setEditForm({ ...EMPTY_TYPE, name });
    setIsEditing(true);
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    updateTypes(types.filter(t => t.id !== selectedId));
    setSelectedId(null);
    setIsEditing(false);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Список типов */}
      <div className="flex flex-col border-r border-[var(--c-b1)]" style={{ width: 380 }}>
        {/* Шапка */}
        <div className="grid text-[11px] font-semibold text-[var(--c-t2)] border-b border-[var(--c-b2)] flex-shrink-0 select-none"
          style={{ background: "var(--c-s3, #f1efea)", gridTemplateColumns: "28px 1fr 52px 80px 44px 44px 48px" }}>
          <div className="px-1 py-1.5" />
          <div className="px-2 py-1.5">Название</div>
          <div className="px-1 py-1.5 text-center">Цвет</div>
          <div className="px-1 py-1.5">Сечение</div>
          <div className="px-1 py-1.5 text-right">S, м²</div>
          <div className="px-1 py-1.5 text-right">V, м/с</div>
          <div className="px-1 py-1.5 text-right">α×10⁻⁴</div>
        </div>

        {/* Строки */}
        <div className="flex-1 overflow-y-auto">
          {types.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-12">
              <Icon name="Layers" size={32} className="text-[var(--c-b3)]" />
              <span className="text-[13px] font-medium text-[var(--c-t3)]">Справочник пуст</span>
              <span className="text-[11px] text-[var(--c-t4)] text-center px-6">
                Добавьте типы выработок вашего рудника — введите название ниже и нажмите «Добавить»
              </span>
            </div>
          )}
          {types.map((t, i) => {
            const isSel = t.id === selectedId;
            return (
              <div key={t.id}
                className="grid items-center border-b border-[var(--c-b1)] cursor-pointer select-none"
                style={{
                  gridTemplateColumns: "28px 1fr 52px 80px 44px 44px 48px",
                  minHeight: 28,
                  background: isSel ? "var(--c-tint-blue2, #dbeafe)" : i % 2 === 0 ? "var(--c-s2, #fafafa)" : "var(--c-s1, #fff)",
                  outline: isSel ? "1px solid var(--c-blue-lt, #3b82f6)" : "none",
                }}
                onClick={() => selectRow(t)}>
                <button className="flex items-center justify-center w-full h-full hover:text-[var(--c-red)] text-[var(--c-b3)]"
                  onClick={e => { e.stopPropagation(); const next = types.filter(x => x.id !== t.id); updateTypes(next); if (selectedId === t.id) { setSelectedId(null); setIsEditing(false); } }}>
                  <Icon name="Trash2" size={11} />
                </button>
                <span className="px-2 text-[12px] text-[var(--c-t1)] font-medium truncate">{t.name}</span>
                <div className="flex items-center justify-center px-1">
                  <div className="w-7 h-4 rounded-md border border-[var(--c-b2)]" style={{ background: t.color }} />
                </div>
                <span className="px-1 text-[11px] text-[var(--c-t1)]">{SHAPE_LABELS[t.shape]}</span>
                <span className="px-1 text-[11px] text-[var(--c-t1)] text-right">{t.area}</span>
                <span className="px-1 text-[11px] text-[var(--c-t1)] text-right">{t.vMax}</span>
                <span className="px-1 text-[11px] text-[var(--c-t1)] text-right">{t.alphaCoef}</span>
              </div>
            );
          })}
        </div>

        {/* Добавление */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-[var(--c-b2)] flex-shrink-0" style={{ background: "var(--c-s3, #f0f0f0)" }}>
          <input className="flex-1 text-[12px] border border-[var(--c-b2)] rounded-md px-2 py-1 bg-[var(--c-s1)] text-[var(--c-t1)]"
            placeholder="Укажите название нового типа"
            value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addType()} />
          <button onClick={addType}
            className={BTN_PRIMARY}>
            <Icon name="Plus" size={11} /> Добавить
          </button>
        </div>
      </div>

      {/* Правая панель: просмотр / редактирование */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Заголовок панели */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s2, #f8f8f8)" }}>
              <div className="w-6 h-6 rounded-md border border-[var(--c-b2)] flex-shrink-0" style={{ background: isEditing ? editForm.color : selected.color }} />
              <span className="text-[13px] font-semibold text-[var(--c-t1)] truncate">
                {isEditing ? (editForm.name || "Новый тип") : selected.name}
              </span>
              {!isEditing ? (
                <>
                  <button onClick={() => startEdit(selected)}
                    className={BTN + " ml-auto"}>
                    <Icon name="Edit2" size={11} /> Изменить
                  </button>
                  <button onClick={deleteSelected}
                    className={BTN_DANGER}>
                    <Icon name="Trash2" size={11} /> Удалить
                  </button>
                </>
              ) : (
                <>
                  <button onClick={saveEdit}
                    className={BTN_PRIMARY + " ml-auto"}>
                    Сохранить
                  </button>
                  <button onClick={cancelEdit}
                    className={BTN}>
                    Отмена
                  </button>
                </>
              )}
            </div>

            {/* Поля */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isEditing ? (
                <>
                  <EditField label="Название">
                    <input autoFocus className={INPUT}
                      value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && saveEdit()} />
                  </EditField>
                  <EditField label="Цвет линии на схеме">
                    <div className="flex items-center gap-2">
                      <input type="color" value={editForm.color}
                        onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))}
                        className="w-10 h-8 border border-[var(--c-b2)] rounded-md cursor-pointer" />
                      <span className="text-[12px] text-[var(--c-t2)]">{editForm.color}</span>
                    </div>
                  </EditField>
                  <EditField label="Форма сечения">
                    <select className={INPUT}
                      value={editForm.shape} onChange={e => setEditForm(f => ({ ...f, shape: e.target.value as BranchType["shape"] }))}>
                      {Object.entries(SHAPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </EditField>
                  <EditField label="Поверхность / крепь">
                    <select className={INPUT}
                      value={editForm.surface} onChange={e => setEditForm(f => ({ ...f, surface: e.target.value }))}>
                      {SURFACE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </EditField>
                  <div className="grid grid-cols-3 gap-3">
                    <EditField label="S, м²">
                      <input type="number" min={0} step={0.1}
                        className={INPUT}
                        value={editForm.area} onChange={e => setEditForm(f => ({ ...f, area: parseFloat(e.target.value) || 0 }))} />
                    </EditField>
                    <EditField label="Vmax, м/с">
                      <input type="number" min={0} step={1}
                        className={INPUT}
                        value={editForm.vMax} onChange={e => setEditForm(f => ({ ...f, vMax: parseFloat(e.target.value) || 0 }))} />
                    </EditField>
                    <EditField label="α ×10⁻⁴">
                      <input type="number" min={0} step={1}
                        className={INPUT}
                        value={editForm.alphaCoef} onChange={e => setEditForm(f => ({ ...f, alphaCoef: parseFloat(e.target.value) || 0 }))} />
                    </EditField>
                  </div>
                </>
              ) : (
                <>
                  <ViewRow label="Форма сечения">{SHAPE_LABELS[selected.shape]}</ViewRow>
                  <ViewRow label="Поверхность / крепь">{selected.surface}</ViewRow>
                  <ViewRow label="Типовая площадь">{selected.area} м²</ViewRow>
                  <ViewRow label="Vmax">{selected.vMax} м/с</ViewRow>
                  <ViewRow label="Коэф. α">{selected.alphaCoef} ×10⁻⁴</ViewRow>
                  <ViewRow label="Цвет">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-6 h-4 rounded-md border border-[var(--c-b2)] inline-block" style={{ background: selected.color }} />
                      <span className="text-[var(--c-t2)] text-[12px]">{selected.color}</span>
                    </span>
                  </ViewRow>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center text-[var(--c-t4)]">
            <Icon name="MousePointer2" size={28} className="text-[var(--c-b3)]" />
            <span className="text-[13px]">Выберите тип выработки</span>
            <span className="text-[11px]">Нажмите строку, затем «Изменить» для редактирования</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className={LABEL}>{label}</label>
      {children}
    </div>
  );
}

function ViewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-[var(--c-b1)]">
      <span className="text-[12px] text-[var(--c-t3)] w-40 flex-shrink-0">{label}</span>
      <span className="text-[13px] text-[var(--c-t1)] font-medium">{children}</span>
    </div>
  );
}


// ─── Справочник перемычек ─────────────────────────────────────────────────────
function rFmt(r: number): string {
  if (r >= 1_000_000) return `${(r / 1_000_000).toFixed(1)} ММюрг`;
  if (r >= 1_000) return `${Math.round(r / 1_000)} кМюрг`;
  return `${Math.round(r)} Мюрг`;
}

function BulkheadsSection({ onMineBulkheadsChange, initialMineBulkheads }: { onMineBulkheadsChange?: (b: MineBulkheadExport[]) => void; initialMineBulkheads?: MineBulkheadExport[] }) {
  const [mineBulkheads, setMineBulkheads] = useState<MineBulkheadExport[]>(() => {
    if (initialMineBulkheads && initialMineBulkheads.length > 0) return initialMineBulkheads;
    // Автоматически загружаем весь каталог при первом открытии
    return BULKHEAD_CATALOG.map(item => ({
      id: `mb_${item.id}`,
      name: item.name,
      type: item.type,
      airPermeability: item.airPermeability,
      rMkyurg: airPermToR(item.airPermeability),
      failurePressure: item.failurePressure,
      note: item.note,
      color: item.color,
    }));
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<BulkheadType | "all">("all");
  const [editForm, setEditForm] = useState<Partial<MineBulkheadExport>>({});

  const selected = mineBulkheads.find(b => b.id === selectedId) ?? null;

  // Уведомляем родителя об начальном состоянии при монтировании
  useEffect(() => {
    if (!initialMineBulkheads || initialMineBulkheads.length === 0) {
      onMineBulkheadsChange?.(mineBulkheads);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const notify = (list: MineBulkheadExport[]) => {
    setMineBulkheads(list);
    onMineBulkheadsChange?.(list);
  };

  const importFromCatalog = (item: BulkheadCatalogItem) => {
    const ex: MineBulkheadExport = {
      id: `mb_${item.id}_${Date.now()}`,
      name: item.name,
      type: item.type,
      airPermeability: item.airPermeability,
      rMkyurg: airPermToR(item.airPermeability),
      failurePressure: item.failurePressure,
      note: item.note,
      color: item.color,
    };
    const next = [...mineBulkheads, ex];
    notify(next);
    setSelectedId(ex.id);
    setShowCatalog(false);
  };

  const startEdit = (b: MineBulkheadExport) => {
    setEditForm({ ...b });
    setIsEditing(true);
  };

  const saveEdit = () => {
    const next = mineBulkheads.map(b => b.id === selectedId ? { ...b, ...editForm } as MineBulkheadExport : b);
    notify(next);
    setIsEditing(false);
  };

  const deleteBulkhead = (id: string) => {
    const next = mineBulkheads.filter(b => b.id !== id);
    notify(next);
    if (selectedId === id) { setSelectedId(null); setIsEditing(false); }
  };

  const addCustom = () => {
    const ex: MineBulkheadExport = {
      id: `mb_custom_${Date.now()}`,
      name: "Новая перемычка",
      type: "custom",
      airPermeability: 0.001,
      rMkyurg: 1_000_000,
      failurePressure: 0,
      note: "",
      color: "#546e7a",
      isCustom: true,
    };
    const next = [...mineBulkheads, ex];
    notify(next);
    setSelectedId(ex.id);
    setEditForm({ ...ex });
    setIsEditing(true);
  };

  // Каталог с фильтрацией
  const catalogList = BULKHEAD_CATALOG.filter(c =>
    (catalogFilter === "all" || c.type === catalogFilter) &&
    c.name.toLowerCase().includes(catalogSearch.toLowerCase())
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Левая панель — список рудника */}
      <div className="flex flex-col border-r border-[var(--c-b1)]" style={{ width: 260, flexShrink: 0 }}>
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s3, #f1efea)" }}>
          <span className="text-[11px] font-semibold text-[var(--c-t2)]">Перемычки рудника</span>
          <div className="flex gap-1">
            <button onClick={() => setShowCatalog(true)}
              className="flex items-center gap-1 text-[10px] text-[var(--c-blue)] hover:text-[var(--c-blue-ink)]">
              <Icon name="Library" size={11} /> Каталог
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {mineBulkheads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-3 gap-2 py-8">
              <Icon name="Square" size={28} className="text-[var(--c-b3)]" />
              <span className="text-[12px] text-[var(--c-t3)] text-center">Справочник пуст</span>
              <span className="text-[10px] text-[var(--c-t4)] text-center">Добавьте перемычки из каталога</span>
              <button onClick={() => setShowCatalog(true)}
                className={BTN_PRIMARY + " mt-1"}>
                <Icon name="Library" size={11} /> Открыть каталог
              </button>
            </div>
          ) : mineBulkheads.map(b => (
            <div key={b.id}
              onClick={() => { setSelectedId(b.id); setIsEditing(false); }}
              className="group flex items-start justify-between px-2 py-2 cursor-pointer border-b border-[var(--c-b1)] select-none hover:bg-[var(--c-tint-blue)]"
              style={{ background: selectedId === b.id ? "var(--c-tint-blue2, #dbeafe)" : undefined }}>
              <div className="flex items-start gap-1.5 flex-1 min-w-0">
                <div className="w-3 h-3 rounded-sm flex-shrink-0 mt-0.5" style={{ background: b.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-[var(--c-t1)] truncate">{b.name}</div>
                  <div className="text-[10px] text-[var(--c-t3)]">{BULKHEAD_TYPE_LABELS[b.type]}</div>
                  <div className="text-[10px] text-[var(--c-t4)]">R = {rFmt(b.rMkyurg)}</div>
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); deleteBulkhead(b.id); }}
                className="opacity-0 group-hover:opacity-100 text-[var(--c-b3)] hover:text-[var(--c-red)] ml-1 mt-0.5 flex-shrink-0">
                <Icon name="Trash2" size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-1 px-2 py-1.5 border-t border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s3, #f0f0f0)" }}>
          <button onClick={() => setShowCatalog(true)}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] text-[var(--c-blue)] hover:bg-[var(--c-tint-blue)] rounded-md border border-[var(--c-b2)]">
            <Icon name="Plus" size={11} /> Из каталога
          </button>
          <button onClick={addCustom}
            className="flex items-center justify-center gap-1 py-1 px-2 text-[11px] text-[var(--c-t2)] hover:bg-[var(--c-s3)] rounded-md border border-[var(--c-b2)]">
            <Icon name="Edit3" size={11} /> Своя
          </button>
        </div>
      </div>

      {/* Правая панель */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Шапка */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s2, #f8f8f8)" }}>
            <div className="w-5 h-5 rounded-sm border border-[var(--c-b2)] flex-shrink-0" style={{ background: selected.color }} />
            <span className="text-[13px] font-bold text-[var(--c-t1)] truncate flex-1">
              {isEditing ? (editForm.name || "Перемычка") : selected.name}
            </span>
            {!isEditing ? (
              <>
                <button onClick={() => startEdit(selected)}
                  className={BTN + " ml-auto"}>
                  <Icon name="Edit2" size={11} /> Изменить
                </button>
                <button onClick={() => deleteBulkhead(selected.id)}
                  className={BTN_DANGER}>
                  <Icon name="Trash2" size={11} /> Удалить
                </button>
              </>
            ) : (
              <>
                <button onClick={saveEdit}
                  className={BTN_PRIMARY + " ml-auto"}>
                  Сохранить
                </button>
                <button onClick={() => setIsEditing(false)}
                  className={BTN}>
                  Отмена
                </button>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isEditing ? (
              <>
                <div className="space-y-1">
                  <label className={LABEL}>Название</label>
                  <input value={editForm.name ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    className={INPUT} />
                </div>
                <div className="space-y-1">
                  <label className={LABEL}>Тип</label>
                  <select value={editForm.type ?? "solid"}
                    onChange={e => setEditForm(f => ({ ...f, type: e.target.value as BulkheadType }))}
                    className={INPUT}>
                    {(Object.entries(BULKHEAD_TYPE_LABELS) as [BulkheadType, string][]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className={LABEL}>Воздухопроницаемость A, м²/(с·√Па)</label>
                    <input type="number" min={0} step={0.0001} value={editForm.airPermeability ?? 0}
                      onChange={e => {
                        const A = parseFloat(e.target.value) || 0;
                        setEditForm(f => ({ ...f, airPermeability: A, rMkyurg: airPermToR(A) }));
                      }}
                      className={INPUT} />
                  </div>
                  <div className="space-y-1">
                    <label className={LABEL}>R, Мюрг (авто)</label>
                    <div className="px-2 py-1.5 bg-[var(--c-s2)] rounded-md border border-[var(--c-b1)] text-[13px] text-[var(--c-t2)] font-medium">
                      {rFmt(editForm.rMkyurg ?? 0)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className={LABEL}>Давление разрушения, МПа</label>
                    <input type="number" min={0} step={0.01} value={editForm.failurePressure ?? 0}
                      onChange={e => setEditForm(f => ({ ...f, failurePressure: parseFloat(e.target.value) || 0 }))}
                      className={INPUT} />
                  </div>
                  <div className="space-y-1">
                    <label className={LABEL}>Цвет</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={editForm.color ?? "#546e7a"}
                        onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))}
                        className="w-10 h-8 border border-[var(--c-b2)] rounded-md cursor-pointer" />
                      <span className="text-[12px] text-[var(--c-t3)]">{editForm.color}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className={LABEL}>Примечание</label>
                  <input value={editForm.note ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                    className={INPUT} />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-medium text-white"
                    style={{ background: BULKHEAD_TYPE_COLORS[selected.type] }}>
                    {BULKHEAD_TYPE_LABELS[selected.type]}
                  </span>
                  {selected.isCustom && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] bg-[var(--c-s3)] text-[var(--c-t2)]">Пользовательская</span>
                  )}
                </div>
                {[
                  ["Воздухопроницаемость", `${selected.airPermeability.toFixed(6)} м²/(с·√Па)`],
                  ["Сопротивление R", rFmt(selected.rMkyurg)],
                  ["Давление разрушения", selected.failurePressure > 0 ? `${selected.failurePressure} МПа` : "Не нормируется"],
                  ["Примечание", selected.note || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start gap-3 py-1.5 border-b border-[var(--c-b1)]">
                    <span className="text-[12px] text-[var(--c-t3)] w-44 flex-shrink-0">{label}</span>
                    <span className="text-[13px] text-[var(--c-t1)] font-medium">{value}</span>
                  </div>
                ))}
                <div className="mt-3 p-3 rounded-lg text-[11px] text-[var(--c-blue-ink)]" style={{ background: "var(--c-tint-blue, #eff6ff)", border: "1px solid var(--c-tint-blue2, #d7e7ee)" }}>
                  Чтобы применить перемычку к выработке — выберите ветвь на схеме и укажите перемычку в панели свойств ветви.
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center text-[var(--c-t4)]">
          <Icon name="Square" size={32} className="text-[var(--c-b3)]" />
          <span className="text-[13px]">Выберите перемычку из списка</span>
          <span className="text-[11px]">или добавьте из каталога</span>
        </div>
      )}

      {/* Диалог каталога */}
      {showCatalog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(15,20,25,0.45)" }}>
          <div className={MODAL} style={{ width: 720, height: 540 }}>
            <div className={MODAL_HEAD} style={{ background: "var(--c-s2, #f8f7f4)" }}>
              <Icon name="Library" size={14} className="text-[var(--c-blue)]" />
              <span className="text-[13px] font-semibold text-[var(--c-t1)]">Каталог перемычек</span>
              <button onClick={() => setShowCatalog(false)} className={ICON_BTN + " ml-auto"}>
                <Icon name="X" size={16} />
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              {/* Фильтры */}
              <div className="flex flex-col border-r border-[var(--c-b1)] flex-shrink-0 p-2 gap-1.5" style={{ width: 170 }}>
                <span className="text-[10px] font-semibold text-[var(--c-t3)] uppercase">Тип</span>
                {([["all", "Все"], ...Object.entries(BULKHEAD_TYPE_LABELS)] as [string, string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setCatalogFilter(v as BulkheadType | "all")}
                    className="text-left px-2 py-1 text-[11px] rounded-md"
                    style={{
                      background: catalogFilter === v ? "var(--c-blue-bg, #1e5a7a)" : "var(--c-s1, #fff)",
                      color: catalogFilter === v ? "white" : "var(--c-t2, #374151)",
                      border: `1px solid ${catalogFilter === v ? "var(--c-blue-bg, #1e5a7a)" : "var(--c-b1, #e5e7eb)"}`,
                    }}>
                    {l}
                  </button>
                ))}
              </div>
              {/* Список */}
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--c-b1)] flex-shrink-0">
                  <Icon name="Search" size={12} className="text-[var(--c-t4)]" />
                  <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)}
                    placeholder="Поиск..." className="flex-1 text-[12px] py-0.5 outline-none text-[var(--c-t1)] bg-transparent" />
                </div>
                <div className="flex-1 overflow-y-auto">
                  {/* Шапка */}
                  <div className="grid text-[10px] font-semibold text-[var(--c-t2)] px-2 py-1 border-b border-[var(--c-b1)] sticky top-0"
                    style={{ background: "var(--c-s3, #f1efea)", gridTemplateColumns: "14px 1fr 110px 90px 80px" }}>
                    <div />
                    <div>Название</div>
                    <div className="text-right">A, м²/(с·√Па)</div>
                    <div className="text-right">R</div>
                    <div className="text-right">P разр.</div>
                  </div>
                  {catalogList.map(item => {
                    const already = mineBulkheads.some(b => b.id.includes(item.id));
                    return (
                      <div key={item.id}
                        className="grid items-center gap-1 px-2 py-1.5 border-b border-[var(--c-b1)] hover:bg-[var(--c-tint-blue)] cursor-pointer select-none"
                        style={{ gridTemplateColumns: "14px 1fr 110px 90px 80px" }}
                        onClick={() => !already && importFromCatalog(item)}>
                        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: item.color }} />
                        <div>
                          <div className="text-[11px] text-[var(--c-t1)]">{item.name}</div>
                          <div className="text-[9px] text-[var(--c-t4)]">{BULKHEAD_TYPE_LABELS[item.type]}</div>
                        </div>
                        <div className="text-[10px] text-[var(--c-t2)] text-right">{item.airPermeability.toFixed(6)}</div>
                        <div className="text-[10px] text-[var(--c-t2)] text-right font-medium">{rFmt(airPermToR(item.airPermeability))}</div>
                        <div className="text-right">
                          {already ? (
                            <span className="text-[9px] text-[var(--c-green)] font-medium">✓ добавлена</span>
                          ) : item.failurePressure > 0 ? (
                            <span className="text-[10px] text-[var(--c-t3)]">{item.failurePressure} МПа</span>
                          ) : (
                            <span className="text-[10px] text-[var(--c-b3)]">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {catalogList.length === 0 && (
                    <div className="flex items-center justify-center h-24 text-[12px] text-[var(--c-t4)]">Не найдено</div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center px-4 py-2 border-t border-[var(--c-b1)] flex-shrink-0" style={{ background: "var(--c-s2, #f8f8f8)" }}>
              <span className="text-[11px] text-[var(--c-t3)] flex-1">Нажмите на строку для добавления в справочник рудника</span>
              <button onClick={() => setShowCatalog(false)}
                className={BTN}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
interface MineVehicle {
  name: string;
  type: string;
  tonnage?: string;
  rubber: number;
  diesel: number;
  oil: number;
}

const MINE_VEHICLES: MineVehicle[] = [
  { name: "Sandvik TH315",        type: "Самосвал",          tonnage: "15 т",  rubber: 780,  diesel: 260, oil: 160 },
  { name: "Sandvik TH430",        type: "Самосвал",          tonnage: "30 т",  rubber: 1200, diesel: 400, oil: 220 },
  { name: "Sandvik TH540",        type: "Самосвал",          tonnage: "40 т",  rubber: 1500, diesel: 520, oil: 280 },
  { name: "Sandvik LH203",        type: "ПДМ",               tonnage: "2 т",   rubber: 260,  diesel: 100, oil: 70  },
  { name: "Sandvik LH307",        type: "ПДМ",               tonnage: "7 т",   rubber: 520,  diesel: 180, oil: 110 },
  { name: "Sandvik LH514",        type: "ПДМ",               tonnage: "14 т",  rubber: 900,  diesel: 280, oil: 180 },
  { name: "Epiroc ST7 Scooptram", type: "ПДМ",               tonnage: "6.8 т", rubber: 480,  diesel: 170, oil: 120 },
  { name: "Epiroc ST14 Scooptram",type: "ПДМ",               tonnage: "14 т",  rubber: 900,  diesel: 280, oil: 200 },
  { name: "Epiroc MT42",          type: "Самосвал",          tonnage: "42 т",  rubber: 1600, diesel: 550, oil: 300 },
  { name: "Caterpillar R1300G",   type: "ПДМ",               tonnage: "13 т",  rubber: 850,  diesel: 260, oil: 180 },
  { name: "Caterpillar R1600H",   type: "ПДМ",               tonnage: "16 т",  rubber: 950,  diesel: 290, oil: 210 },
  { name: "Caterpillar AD22",     type: "Самосвал",          tonnage: "22 т",  rubber: 1000, diesel: 340, oil: 200 },
  { name: "Caterpillar AD45B",    type: "Самосвал",          tonnage: "41 т",  rubber: 1500, diesel: 530, oil: 290 },
  { name: "Komatsu WJ-5",         type: "ПДМ",               tonnage: "5 т",   rubber: 400,  diesel: 150, oil: 95  },
  { name: "Normet Spraymec",      type: "Набрызг-машина",    tonnage: undefined, rubber: 360, diesel: 140, oil: 90  },
  { name: "Epiroc Boomer T1D",    type: "Буровая установка", tonnage: undefined, rubber: 800, diesel: 290, oil: 240 },
  { name: "Epiroc Boltec LC",     type: "Анкеровщик",       tonnage: undefined, rubber: 480, diesel: 180, oil: 140 },
  { name: "TH-545",               type: "Самосвал",          tonnage: "45 т",  rubber: 1200, diesel: 400, oil: 200 },
  { name: "БелАЗ-7555",           type: "Самосвал карьерный",tonnage: "55 т",  rubber: 2000, diesel: 700, oil: 400 },
];

function VehicleCatalogSection() {
  const [search, setSearch] = useState("");
  const filtered = MINE_VEHICLES.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.type.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div style={{ background: "var(--c-s1, #fff)", minHeight: "100%", padding: "12px" }}>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--c-t4, #9ca3af)", fontSize: 14 }}>🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию или типу..."
          style={{
            width: "100%", boxSizing: "border-box",
            background: "var(--c-s3, #f3f4f6)", border: "1px solid var(--c-b2, #d1d5db)", borderRadius: "var(--radius-ui)",
            color: "var(--c-t1, #111827)", fontSize: 12, padding: "8px 10px 8px 32px", outline: "none",
          }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {filtered.map((v, i) => (
          <div key={i} style={{
            background: "var(--c-s2, #f8fafc)", border: "1px solid var(--c-b1, #e2e8f0)", borderRadius: "var(--radius-ui)", padding: "10px 12px",
            cursor: "default",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ color: "var(--c-t1, #111827)", fontWeight: 600, fontSize: 13 }}>{v.name}</div>
                <div style={{ color: "var(--c-t3, #6b7280)", fontSize: 11, marginTop: 1 }}>
                  {v.type}{v.tonnage ? ` · ${v.tonnage}` : ""}
                </div>
              </div>
              <span style={{ color: "var(--c-t4, #d1d5db)", fontSize: 14 }}>›</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 8 }}>
              {[
                { label: "РЕЗИНА", val: v.rubber, color: "var(--c-t2, #374151)" },
                { label: "ДИЗЕЛЬ", val: v.diesel, color: "var(--c-blue, #2563eb)" },
                { label: "МАСЛО",  val: v.oil,    color: "var(--c-amber, #ea580c)" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: "var(--c-s3, #eef2f7)", borderRadius: 6, padding: "5px 6px" }}>
                  <div style={{ color: "var(--c-t4, #9ca3af)", fontSize: 9, fontWeight: 600, letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ color, fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>{val}</div>
                  <div style={{ color: "var(--c-t4, #9ca3af)", fontSize: 9 }}>КГ</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ color: "var(--c-t4, #9ca3af)", fontSize: 10, marginTop: 12, textAlign: "center", fontStyle: "italic" }}>
        Данные приблизительные. После выбора можно скорректировать значения вручную.
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="sticky top-0 px-3 h-8 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--c-t3)] border-b border-[var(--c-b2)] select-none whitespace-nowrap" style={{ background: "var(--c-s3, #f1efea)" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 h-8 text-[12px] text-[var(--c-t1)] border-b border-[var(--c-b1)]">{children}</td>;
}

/** Таблица только для просмотра — строки не кликабельны (раньше был
 *  cursor-pointer без обработчика, и казалось, что строку можно открыть). */
/** Редактируемая таблица справочника: пустая по умолчанию, данные вводит пользователь.
 *  Сохраняется в localStorage браузера. */
function EditableTable({ headers, storageKey }: { headers: string[]; storageKey: string }) {
  const [rows, setRows] = useState<string[][]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(rows)); } catch { /* ignore */ }
  }, [rows, storageKey]);

  const addRow = () => setRows(r => [...r, headers.map(() => "")]);
  const delRow = (i: number) => setRows(r => r.filter((_, k) => k !== i));
  const setCell = (i: number, j: number, v: string) =>
    setRows(r => r.map((row, k) => k === i ? row.map((c, m) => m === j ? v : c) : row));

  return (
    <div className="flex flex-col">
      <table className="w-full border-collapse">
        <thead><tr>{headers.map(h => <Th key={h}>{h}</Th>)}<Th>{""}</Th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-[var(--c-s2)]">
              {headers.map((h, j) => (
                <td key={j} className="px-2 py-1 border-b border-[var(--c-b1)]">
                  <input className={INPUT} value={r[j] ?? ""} placeholder={h}
                    onChange={e => setCell(i, j, e.target.value)} />
                </td>
              ))}
              <td className="px-1 py-1 border-b border-[var(--c-b1)] w-9">
                <button className={ICON_BTN} title="Удалить строку" onClick={() => delRow(i)}>
                  <Icon name="Trash2" size={13} />
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={headers.length + 1}
              className="px-4 py-8 text-center text-[12px] text-[var(--c-t3)]">
              Справочник пуст. Нажмите «Добавить строку», чтобы внести данные.
            </td></tr>
          )}
        </tbody>
      </table>
      <div className="p-3">
        <button className={BTN_PRIMARY} onClick={addRow}>
          <Icon name="Plus" size={13} /> Добавить строку
        </button>
      </div>
    </div>
  );
}

// ─── Справочник насосов с картой характеристик (двойной клик по строке) ──────
function PumpsSection() {
  const [selected, setSelected] = useState<PumpModel | null>(null);

  return (
    <>
      <table className="w-full border-collapse">
        <thead><tr>
          {["Марка", "Тип", "Подача", "Напор", "Обороты", "Мощность", "КПД"].map(h => <Th key={h}>{h}</Th>)}
        </tr></thead>
        <tbody>
          {PUMP_CATALOG.map((p) => (
            <tr key={p.id}
              className="hover:bg-[var(--c-tint-blue)] cursor-pointer"
              onClick={() => setSelected(p)}
              title="Открыть напорную характеристику">
              <Td>{p.brand} {p.model}</Td>
              <Td>{PUMP_TYPE_NAMES[p.type]}</Td>
              <Td>{p.Qopt} м³/ч</Td>
              <Td>{Math.round(pumpHead(p, p.Qopt))} м</Td>
              <Td>{p.rpm} об/мин</Td>
              <Td>{p.power} кВт</Td>
              <Td>{Math.round(p.etaMax * 100)} %</Td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && <PumpCharacteristicCard pump={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

// ─── Справочник потребителей воды (пожарные стволы, распылители, пеногенераторы)
function ConsumersSection() {
  return (
    <>
      <div className="text-[11px] text-[var(--c-t3)] px-3 pt-3 pb-1 leading-snug">
        Библиотека потребителей противопожарного водопровода. Выбрать модель для узла можно
        в свойствах узла-потребителя (вкладка «Трубы» → «Модель из библиотеки») —
        требуемый расход и диаметр выходного отверстия подставятся автоматически.
      </div>
      {(Object.keys(CONSUMER_GROUP_NAMES) as ConsumerGroup[]).map((g) => (
        <div key={g} className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider px-3 py-2 text-[var(--c-t2)]">
            {CONSUMER_GROUP_NAMES[g]}
          </div>
          <table className="w-full border-collapse">
            <thead><tr>
              {["Наименование", "Ø отв., мм", "Расход, л/с", "Расход, м³/ч", "Расход, л/мин", "Площадь туш., м²", "Дальность струи", "Раб. давл., МПа", "кгс/см²"].map(h => <Th key={h}>{h}</Th>)}
            </tr></thead>
            <tbody>
              {CONSUMER_CATALOG.filter(c => c.group === g).map((c) => (
                <tr key={c.id} className="hover:bg-[var(--c-s2)]">
                  <Td>{c.name}</Td>
                  <Td>{c.outletDiameter > 0 ? c.outletDiameter : "—"}</Td>
                  <Td>{c.flowLps.toLocaleString("ru")}</Td>
                  <Td>{c.flowM3h.toLocaleString("ru")}</Td>
                  <Td>{c.flowLmin.toLocaleString("ru")}</Td>
                  <Td>{c.extinguishArea.toLocaleString("ru")}</Td>
                  <Td>{c.jetRange}</Td>
                  <Td>{c.workPressureMPa}</Td>
                  <Td>{c.workPressureAtm}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

// Модальная карта характеристик выбранного насоса
function PumpCharacteristicCard({ pump, onClose }: { pump: PumpModel; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={MODAL} style={{ width: 560 }}>
        {/* Заголовок */}
        <div className={MODAL_HEAD}>
          <IconBadge icon="Waves" />
          <span className="text-[13px] font-semibold text-[var(--c-t1)]">Характеристика насоса — {pump.brand} {pump.model}</span>
          <button onClick={onClose} className={ICON_BTN + " ml-auto"}><Icon name="X" size={14} /></button>
        </div>

        <div className="p-4 flex gap-4">
          {/* График */}
          <div className="flex-shrink-0">
            <div className="text-[11px] text-[var(--c-t3)] mb-1 font-medium">Напорная характеристика Q–H</div>
            <PumpChart pump={pump} width={300} height={200} />
            <div className="text-[10px] text-[var(--c-t4)] mt-1">
              <span className="inline-block w-3 h-0.5 align-middle" style={{ background: "var(--c-red-bg, #dc2626)" }} /> напор ·
              <span className="inline-block w-3 h-0.5 align-middle ml-1" style={{ background: "#9ca3af" }} /> КПД
            </div>
          </div>

          {/* Параметры */}
          <div className="flex-1 text-[12px]">
            <div className="text-[11px] text-[var(--c-t3)] mb-1 font-medium uppercase tracking-wide">Параметры</div>
            <table className="w-full">
              <tbody>
                {[
                  ["Тип", PUMP_TYPE_NAMES[pump.type]],
                  ["Подача оптимальная", `${pump.Qopt} м³/ч`],
                  ["Диапазон подачи", `${pump.Qmin}…${pump.Qmax} м³/ч`],
                  ["Напор при Qопт", `${Math.round(pumpHead(pump, pump.Qopt))} м вод. ст.`],
                  ["Напор при нуле H₀", `${Math.round(pump.H0)} м`],
                  ["Частота вращения", `${pump.rpm} об/мин`],
                  ["Мощность двигателя", `${pump.power} кВт`],
                  ["КПД максимальный", `${Math.round(pump.etaMax * 100)} %`],
                  ["Масса", pump.weight ? `${pump.weight} кг` : "—"],
                ].map(([k, v], idx) => (
                  <tr key={idx} className="border-b border-[var(--c-b1)]">
                    <td className="py-1 text-[var(--c-t3)]">{k}</td>
                    <td className="py-1 text-right font-medium text-[var(--c-t1)]">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pump.notes && <div className="text-[10px] text-[var(--c-t4)] mt-2 italic">{pump.notes}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Пороги зон поражения взрывом ───────────────────────────────────────────
function BlastZonesSection({ thresholds, onChange }: {
  thresholds: ExplosionThresholds;
  onChange: (t: ExplosionThresholds) => void;
}) {
  const t = thresholds;
  const set = (patch: Partial<ExplosionThresholds>) => onChange({ ...t, ...patch });

  // Ряд должен строго убывать: иначе зоны вложатся в неверном порядке
  // и радиус «тяжёлой» окажется больше радиуса «лёгкой».
  const broken = !(t.lethal > t.heavy && t.heavy > t.medium
    && t.medium > t.light && t.light > t.safeLimit);

  const Row = ({ label, value, onSet, color, range }: {
    label: string; value: number; onSet: (v: number) => void; color: string; range: string;
  }) => (
    <div className="flex items-center gap-2 py-1" style={{ borderBottom: "1px solid var(--c-b1, #e7e4dd)" }}>
      <div style={{ width: 6, height: 26, background: color, borderRadius: "var(--radius-ui)", flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-[var(--c-t2)]">{label}</div>
        <div className="text-[10px] text-[var(--c-t4)] leading-snug">{range}</div>
      </div>
      <input type="number" step="1" min="0" value={value}
        onChange={e => onSet(parseFloat(e.target.value) || 0)}
        className="text-[11px] px-1 text-right flex-shrink-0"
        style={{ background: "var(--c-s1, #fff)", color: "var(--c-t1, #1f2328)", border: "1px solid var(--c-b2, #d5d1c8)", borderRadius: 6, height: 26, width: 88, outline: "none", fontFamily: "var(--font-num)" }} />
      <span className="text-[10px] text-[var(--c-t3)] flex-shrink-0" style={{ width: 40 }}>кПа</span>
    </div>
  );

  return (
    <div className="px-4 py-2">
      <div className="text-[10px] text-[var(--c-t3)] leading-snug pb-2">
        Границы зон поражения по избыточному давлению во фронте ударной волны.
        Ряд порогов в разных документах различается, поэтому предприятие
        выставляет тот, под который аттестован расчёт. Значения применяются
        и к радиусам зон, и к окраске выработок на схеме.
      </div>

      <Row label="Летальная" color={EXPLOSION_HAZARD_COLORS.lethal}
        range={`ΔP ≥ ${t.lethal} кПа — летальный исход, полное разрушение`}
        value={t.lethal} onSet={v => set({ lethal: v })} />
      <Row label="Тяжёлые поражения" color={EXPLOSION_HAZARD_COLORS.heavy}
        range={`ΔP ${t.heavy}–${t.lethal} кПа — тяжёлые травмы, обрушение конструкций`}
        value={t.heavy} onSet={v => set({ heavy: v })} />
      <Row label="Средние поражения" color={EXPLOSION_HAZARD_COLORS.medium}
        range={`ΔP ${t.medium}–${t.heavy} кПа — средние травмы, повреждение оборудования`}
        value={t.medium} onSet={v => set({ medium: v })} />
      <Row label="Лёгкие поражения" color={EXPLOSION_HAZARD_COLORS.light}
        range={`ΔP ${t.light}–${t.medium} кПа — контузии, звуковая травма`}
        value={t.light} onSet={v => set({ light: v })} />
      <Row label="Граница безопасной зоны" color={EXPLOSION_HAZARD_COLORS.safe}
        range="Дальше этого расстояния воздействие пренебрежимо мало. Задаёт внешний контур зон и предел шкалы волны"
        value={t.safeLimit} onSet={v => set({ safeLimit: v })} />

      {broken && (
        <div className="mt-2 px-2 py-1.5 rounded-md text-[10px]"
          style={{ background: "var(--c-tint-amber, #fffbeb)", border: "1px solid var(--c-tint-amber2, #fef3c7)", color: "var(--c-amber-ink, #865412)" }}>
          Ряд должен убывать: летальная &gt; тяжёлые &gt; средние &gt; лёгкие &gt; граница
          безопасной. Сейчас это не так — при расчёте значения будут приведены
          к убывающему ряду, и часть зон совпадёт.
        </div>
      )}

      <div className="text-[11px] font-semibold text-[var(--c-t3)] uppercase tracking-wide mt-4 mb-1">Готовые ряды</div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => onChange(DEFAULT_EXPLOSION_THRESHOLDS)}
          className={BTN}>
          100 / 50 / 30 / 10 — прежний в программе
        </button>
        <button onClick={() => onChange(TYPICAL_EXPLOSION_THRESHOLDS)}
          className={BTN}>
          100 / 60 / 40 / 20 — типовые таблицы поражения человека
        </button>
      </div>
      <div className="text-[10px] text-[var(--c-t4)] leading-snug mt-2">
        Оба ряда даны как заготовки. Какой из них применим — определяет
        документ, под который аттестуется расчёт на вашем предприятии.
      </div>
    </div>
  );
}

// ─── Нормы расхода воздуха (ФНиП № 505) ─────────────────────────────────────
function AirNormsSection({ norms, onChange }: {
  norms: VentNorms;
  onChange: (n: VentNorms) => void;
}) {
  const set = (patch: Partial<VentNorms>) => onChange({ ...norms, ...patch });

  const Row = ({ label, value, onSet, step = "0.01", unit, hint }: {
    label: string; value: number; onSet: (v: number) => void;
    step?: string; unit?: string; hint?: string;
  }) => (
    <div className="flex items-start gap-2 py-1" style={{ borderBottom: "1px solid var(--c-b1, #e7e4dd)" }}>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-[var(--c-t2)]">{label}</div>
        {hint && <div className="text-[10px] text-[var(--c-t4)] leading-snug">{hint}</div>}
      </div>
      <input type="number" step={step} value={value}
        onChange={e => onSet(parseFloat(e.target.value) || 0)}
        className="text-[11px] px-1 text-right flex-shrink-0"
        style={{ background: "var(--c-s1, #fff)", color: "var(--c-t1, #1f2328)", border: "1px solid var(--c-b2, #d5d1c8)", borderRadius: 6, height: 26, width: 88, outline: "none", fontFamily: "var(--font-num)" }} />
      <span className="text-[10px] text-[var(--c-t3)] flex-shrink-0" style={{ width: 74 }}>{unit ?? ""}</span>
    </div>
  );

  const Group = ({ title }: { title: string }) => (
    <div className="text-[11px] font-semibold text-[var(--c-t3)] uppercase tracking-wide mt-3 mb-1">{title}</div>
  );

  return (
    <div className="px-4 py-2">
      <div className="text-[10px] text-[var(--c-t3)] leading-snug pb-1">
        Нормы применяются при расчёте количества воздуха. Значения по умолчанию —
        по ФНиП № 505 и практике проектирования рудников. Предприятие может
        согласовать собственные значения (особенно по дизельной технике).
      </div>

      <Group title="По людям" />
      <Row label="Расход воздуха на одного человека" unit="м³/мин" step="0.5"
        value={norms.airPerPerson} onSet={v => set({ airPerPerson: v })}
        hint="ФНиП: 6 м³/мин на человека, по максимальному числу одновременно работающих" />

      <Group title="По газам взрывных работ" />
      <Row label="Газовыделение при взрывании по углю" unit="л на 1 кг ВВ" step="1"
        value={norms.gasPerKgCoal} onSet={v => set({ gasPerKgCoal: v })} />
      <Row label="Газовыделение при взрывании по породе" unit="л на 1 кг ВВ" step="1"
        value={norms.gasPerKgRock} onSet={v => set({ gasPerKgRock: v })} />
      <Row label="Время проветривания после взрыва" unit="мин" step="1"
        value={norms.blastVentTime} onSet={v => set({ blastVentTime: v })} />
      <Row label="Коэффициент обводнённости" unit="" step="0.05"
        value={norms.wateringFactor} onSet={v => set({ wateringFactor: v })}
        hint="1,0 — сухая выработка; при обводнённости газы поглощаются водой" />
      <Row label="ПДК условного оксида углерода" unit="%" step="0.001"
        value={norms.coLimit} onSet={v => set({ coLimit: v })} />

      <Group title="По дизельному оборудованию" />
      <Row label="Норма подачи на единицу мощности" unit="м³/мин на кВт" step="0.1"
        value={norms.airPerKwDiesel} onSet={v => set({ airPerKwDiesel: v })}
        hint="6,8 м³/мин·кВт — пересчёт классической нормы 5 м³/мин на 1 л.с. Норма установлена в 1970-х и для современной техники обычно снижается по согласованию" />
      <Row label="Коэффициент одновременности: 1 машина" unit="" step="0.05"
        value={norms.simult1} onSet={v => set({ simult1: v })} />
      <Row label="Коэффициент одновременности: 2 машины" unit="" step="0.05"
        value={norms.simult2} onSet={v => set({ simult2: v })} />
      <Row label="Коэффициент одновременности: 3 и более" unit="" step="0.05"
        value={norms.simult3} onSet={v => set({ simult3: v })} />

      <Group title="Скорости движения воздуха" />
      <Row label="Минимальная в очистных и подготовительных" unit="м/с" step="0.05"
        value={norms.vMinFace} onSet={v => set({ vMinFace: v })} />
      <Row label="Минимальная в прочих выработках" unit="м/с" step="0.05"
        value={norms.vMinOther} onSet={v => set({ vMinOther: v })} />
      <Row label="Максимальная в выработках" unit="м/с" step="0.5"
        value={norms.vMaxDrift} onSet={v => set({ vMaxDrift: v })} />
      <Row label="Максимальная в стволах с подъёмом людей" unit="м/с" step="0.5"
        value={norms.vMaxShaft} onSet={v => set({ vMaxShaft: v })}
        hint="Превышение максимальной скорости так же недопустимо, как и недостаток" />

      <Group title="Коэффициенты запаса и утечек" />
      <Row label="Общий коэффициент запаса" unit="" step="0.05"
        value={norms.reserveFactor} onSet={v => set({ reserveFactor: v })}
        hint="ФНиП п.155 требует введения обоснованных коэффициентов запаса" />
      <Row label="Общий коэффициент утечек" unit="" step="0.05"
        value={norms.leakFactor} onSet={v => set({ leakFactor: v })} />
      <Row label="Доля потребности для резервных забоев" unit="" step="0.05"
        value={norms.reserveShare} onSet={v => set({ reserveShare: v })}
        hint="0,5 — в норматив включается половина расчётной потребности" />

      <div className="flex justify-end py-3">
        <button onClick={() => onChange(DEFAULT_VENT_NORMS)}
          className={BTN}>
          Сбросить к нормативным значениям
        </button>
      </div>
    </div>
  );
}

function TabContent({ tab, onMineFansChange, onMineBulkheadsChange, onBranchTypesChange, initialMineFans, initialBranchTypes, initialMineBulkheads, unitsConfig, onUnitsConfigChange, ventNorms, onVentNormsChange, blastThresholds, onBlastThresholdsChange }: {
  tab: TabId;
  onMineFansChange?: (fans: MineFanExport[]) => void;
  onMineBulkheadsChange?: (b: MineBulkheadExport[]) => void;
  onBranchTypesChange?: (types: BranchType[]) => void;
  initialMineFans?: MineFanExport[];
  initialBranchTypes?: BranchType[];
  initialMineBulkheads?: MineBulkheadExport[];
  unitsConfig?: UnitsConfig;
  onUnitsConfigChange?: (cfg: UnitsConfig) => void;
  ventNorms?: VentNorms;
  onVentNormsChange?: (n: VentNorms) => void;
  blastThresholds?: ExplosionThresholds;
  onBlastThresholdsChange?: (t: ExplosionThresholds) => void;
}) {
  if (tab === "blastzones") return <BlastZonesSection
    thresholds={blastThresholds ?? DEFAULT_EXPLOSION_THRESHOLDS}
    onChange={onBlastThresholdsChange ?? (() => {})} />;
  if (tab === "fans") return <FansSection onMineFansChange={onMineFansChange} initialMineFans={initialMineFans} />;
  if (tab === "airnorms") return <AirNormsSection
    norms={ventNorms ?? DEFAULT_VENT_NORMS}
    onChange={onVentNormsChange ?? (() => {})} />;
  if (tab === "types") return <TypesSection initialTypes={initialBranchTypes} onBranchTypesChange={onBranchTypesChange} />;
  if (tab === "bulkheads") return <BulkheadsSection onMineBulkheadsChange={onMineBulkheadsChange} initialMineBulkheads={initialMineBulkheads} />;
  if (tab === "units") return <UnitsConfigPanel unitsConfig={unitsConfig ?? DEFAULT_UNITS_CONFIG} onChange={onUnitsConfigChange ?? (() => {})} />;
  if (tab === "sensors") return <EditableTable key="sensors" storageKey="pv_ref_sensors"
    headers={["Марка", "Измеряет", "Диапазон", "Класс", "Примечание"]} />;
  if (tab === "typical") return <EditableTable key="typical" storageKey="pv_ref_typical"
    headers={["Мероприятие", "Шагов", "Ответственный", "Время"]} />;
  if (tab === "pumps") return <PumpsSection />;
  if (tab === "consumers") return <ConsumersSection />;
  if (tab === "pipes") return <EditableTable key="pipes" storageKey="pv_ref_pipes"
    headers={["Материал", "DN", "Стенка", "Давление"]} />;
  if (tab === "transport") return <VehicleCatalogSection />;
  return null;
}

/** Иконка-маркер в цветной подложке — как в карточках панели свойств. */
function IconBadge({ icon, size = 24 }: { icon: string; size?: number }) {
  return (
    <span className="rounded-md flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, color: "var(--c-accent, #1e5a7a)",
        background: "color-mix(in srgb, var(--c-accent, #1e5a7a) 14%, transparent)" }}>
      <Icon name={icon} size={Math.round(size * 0.55)} fallback="Square" />
    </span>
  );
}

export default function EquipmentRefDialog({ activeTab, onTabChange, onClose, onMineFansChange, onMineBulkheadsChange, onBranchTypesChange, initialMineFans, initialBranchTypes, initialMineBulkheads, unitsConfig, onUnitsConfigChange, ventNorms, onVentNormsChange, blastThresholds, onBlastThresholdsChange }: Props) {
  const currentTab = TABS.find(t => t.id === activeTab) ?? TABS[0];

  // Esc закрывает окно (вложенные окна библиотеки/каталога перехватывают клик,
  // а Esc — общий выход, как в остальных диалогах программы)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,20,25,0.45)" }}
      // mousedown, а не click: иначе выделение текста мышью с отпусканием
      // за пределами окна закрывало справочник
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={MODAL}
        style={{ width: 960, maxWidth: "100%", height: 620, maxHeight: "100%", fontFamily: "var(--font-ui)" }}>

        {/* Заголовок */}
        <div className={MODAL_HEAD} style={{ background: "var(--c-s1, #fff)" }}>
          <IconBadge icon="BookOpen" />
          <span className="text-[13px] font-semibold text-[var(--c-t1)]">Справочники</span>
          <Icon name="ChevronRight" size={13} className="text-[var(--c-t4)]" />
          <span className="text-[13px] text-[var(--c-t2)] truncate">{currentTab.label}</span>
          <button onClick={onClose} title="Закрыть (Esc)" className={ICON_BTN + " ml-auto"}>
            <Icon name="X" size={15} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Навигация по разделам */}
          <nav className="w-52 flex-shrink-0 overflow-y-auto py-2 px-2 border-r border-[var(--c-b1)]"
            style={{ background: "var(--c-s2, #f8f7f4)" }}>
            {TAB_GROUPS.map(group => (
              <div key={group} className="mb-2">
                <div className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--c-t4)]">{group}</div>
                {TABS.filter(t => t.group === group).map(tab => {
                  const active = activeTab === tab.id;
                  return (
                    <button key={tab.id} onClick={() => onTabChange(tab.id)}
                      className="w-full flex items-center gap-2 px-2 h-8 rounded-md text-left text-[12px] transition-colors"
                      style={{
                        background: active ? "color-mix(in srgb, var(--c-accent, #1e5a7a) 12%, transparent)" : "transparent",
                        color: active ? "var(--c-accent-ink, #173d52)" : "var(--c-t2, #3a3f45)",
                        fontWeight: active ? 600 : 400,
                        boxShadow: active ? "inset 3px 0 0 var(--c-accent, #1e5a7a)" : "none",
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--c-s4, #e6e3dc)"; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                      <Icon name={tab.icon} size={14} fallback="Square"
                        style={{ color: active ? "var(--c-accent, #1e5a7a)" : "var(--c-t3, #6b7280)", flexShrink: 0 }} />
                      <span className="flex-1 truncate">{tab.label}</span>
                      {tab.demo && (
                        <span className="text-[9px] px-1 rounded" title="Образец данных, в расчётах не используется"
                          style={{ color: "var(--c-t4, #767f8c)", border: "1px solid var(--c-b2, #d5d1c8)" }}>образец</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Содержимое раздела */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="flex items-start gap-2.5 px-4 py-2.5 border-b border-[var(--c-b1)] flex-shrink-0"
              style={{ background: "var(--c-s1, #fff)" }}>
              <IconBadge icon={currentTab.icon} size={28} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[var(--c-t1)]">{currentTab.label}</div>
                <div className="text-[11px] leading-snug text-[var(--c-t3)]">{currentTab.hint}</div>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <TabContent tab={activeTab} onMineFansChange={onMineFansChange} onMineBulkheadsChange={onMineBulkheadsChange} onBranchTypesChange={onBranchTypesChange} initialMineFans={initialMineFans} initialBranchTypes={initialBranchTypes} initialMineBulkheads={initialMineBulkheads} unitsConfig={unitsConfig} onUnitsConfigChange={onUnitsConfigChange} ventNorms={ventNorms} onVentNormsChange={onVentNormsChange} blastThresholds={blastThresholds} onBlastThresholdsChange={onBlastThresholdsChange} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
