// ─────────────────────────────────────────────────────────────────────────────
// CadScaleSettingsModal — компактная плавающая панель «Пределы масштабов».
// Окно перетаскивается за заголовок, не перекрывает схему затемнением —
// изменения видны на схеме сразу. «Отмена» возвращает значения на момент открытия.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/icon";

export interface CadScaleSettingsModalProps {
  scaleSettingsOpen: boolean;
  setScaleSettingsOpen: (v: boolean) => void;
  scaleTextMin: number; setScaleTextMin: (v: number) => void;
  scaleTextMax: number; setScaleTextMax: (v: number) => void;
  scaleBranchMin: number; setScaleBranchMin: (v: number) => void;
  scaleBranchMax: number; setScaleBranchMax: (v: number) => void;
  /** Ширина ветви зависит от площади её сечения (см. branchWidthBySection.ts). */
  widthBySectionOn: boolean; setWidthBySectionOn: (v: boolean) => void;
  tube3dOn: boolean; setTube3dOn: (v: boolean) => void;
  scalePositionMin: number; setScalePositionMin: (v: number) => void;
  scalePositionMax: number; setScalePositionMax: (v: number) => void;
  positionGostMm: number; setPositionGostMm: (v: number) => void;
  bulkheadScale: number; setBulkheadScale: (v: number) => void;
  fanScale: number; setFanScale: (v: number) => void;
  setScaleLimitsEnabled: (v: boolean) => void;
}

const W = 400;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, isFinite(v) ? v : a));

function Num({ value, onChange, min, max, step = 1, suffix, width = 52 }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string; width?: number;
}) {
  return (
    <div className="inline-flex items-center rounded-md border overflow-hidden focus-within:ring-2 focus-within:ring-blue-400/40"
      style={{ borderColor: "var(--c-b2, #d1d5db)", background: "var(--c-s1, #fff)" }}>
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={e => onChange(clamp(Number(e.target.value), min, max))}
        className="text-right text-[12px] px-1.5 outline-none bg-transparent tabular-nums"
        style={{ width, height: 24 }} />
      {suffix && <span className="text-[11px] pr-1.5 text-gray-400">{suffix}</span>}
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex ml-1 align-middle cursor-help text-gray-400 hover:text-blue-500">
      <Icon name="Info" size={12} />
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-10 w-64 rounded-md px-2.5 py-1.5 text-[11px] leading-snug text-white bg-gray-800 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
        {text}
      </span>
    </span>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-center justify-between gap-2 py-1 cursor-pointer select-none">
      <span className="text-[12px] text-gray-700">{label}<Hint text={hint} /></span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className="relative w-8 h-[18px] rounded-full transition-colors shrink-0"
        style={{ background: checked ? "#3b82f6" : "#cbd5e1" }}>
        <span className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all"
          style={{ left: checked ? 16 : 2 }} />
      </button>
    </label>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[12px] text-gray-700 truncate">{label}{hint && <Hint text={hint} />}</span>
      <div className="flex items-center gap-1.5 shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 border-b last:border-b-0" style={{ borderColor: "var(--c-b1, #eef0f3)" }}>
      <div className="flex items-center gap-1.5 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        <Icon name={icon} size={11} />{title}
      </div>
      {children}
    </div>
  );
}

const MinMax = ({ min, max, setMin, setMax }: { min: number; max: number; setMin: (v: number) => void; setMax: (v: number) => void }) => (
  <>
    <Num value={min} onChange={setMin} min={10} max={500} suffix="%" />
    <span className="text-gray-300 text-[11px]">—</span>
    <Num value={max} onChange={setMax} min={10} max={500} suffix="%" />
  </>
);

export default function CadScaleSettingsModal(p: CadScaleSettingsModalProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  // Перетаскивание идёт мимо React: координаты живут в ref и пишутся прямо в
  // transform окна, не чаще кадра экрана. Раньше каждое движение мыши меняло
  // состояние → окно перерисовывалось целиком, left/top пересчитывали раскладку,
  // а большая размытая тень перерисовывалась поверх схемы — отсюда тормоза и шлейф.
  const boxRef = useRef<HTMLDivElement>(null);
  const livePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const raf = useRef(0);
  const [dragging, setDragging] = useState(false);
  const snap = useRef<Record<string, number | boolean> | null>(null);

  // Снимок значений при открытии — для «Отмены».
  useEffect(() => {
    if (p.scaleSettingsOpen) {
      snap.current = {
        tMin: p.scaleTextMin, tMax: p.scaleTextMax, bMin: p.scaleBranchMin, bMax: p.scaleBranchMax,
        ws: p.widthBySectionOn, t3: p.tube3dOn, pMin: p.scalePositionMin, pMax: p.scalePositionMax,
        gost: p.positionGostMm, bh: p.bulkheadScale, fan: p.fanScale,
      };
      setPos(prev => prev ?? { x: Math.max(8, window.innerWidth - W - 340), y: 150 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.scaleSettingsOpen]);

  const cancel = () => {
    const s = snap.current;
    if (s) {
      p.setScaleTextMin(s.tMin as number); p.setScaleTextMax(s.tMax as number);
      p.setScaleBranchMin(s.bMin as number); p.setScaleBranchMax(s.bMax as number);
      p.setWidthBySectionOn(s.ws as boolean); p.setTube3dOn(s.t3 as boolean);
      p.setScalePositionMin(s.pMin as number); p.setScalePositionMax(s.pMax as number);
      p.setPositionGostMm(s.gost as number);
      p.setBulkheadScale(s.bh as number); p.setFanScale(s.fan as number);
    }
    p.setScaleSettingsOpen(false);
  };

  useEffect(() => {
    if (!p.scaleSettingsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.scaleSettingsOpen]);

  useEffect(() => { if (pos) livePos.current = pos; }, [pos]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const applyTransform = () => {
    raf.current = 0;
    const el = boxRef.current;
    if (el) el.style.transform = `translate3d(${livePos.current.x}px, ${livePos.current.y}px, 0)`;
  };

  const onDragStart = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button") || !pos) return;
    drag.current = { dx: e.clientX - livePos.current.x, dy: e.clientY - livePos.current.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    livePos.current = {
      x: clamp(e.clientX - drag.current.dx, 0, window.innerWidth - W),
      y: clamp(e.clientY - drag.current.dy, 0, window.innerHeight - 40),
    };
    if (!raf.current) raf.current = requestAnimationFrame(applyTransform);
  };
  const onDragEnd = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* уже отпущен */ }
    cancelAnimationFrame(raf.current);
    applyTransform();
    setDragging(false);
    // Итоговую позицию запоминаем один раз — чтобы окно открылось там же.
    setPos({ ...livePos.current });
  };

  if (!p.scaleSettingsOpen || !pos) return null;

  const setWidthBySection = (on: boolean) => {
    p.setWidthBySectionOn(on);
    // Прежние пределы 80–150% слишком узки для режима «по сечению» —
    // раздвигаем их, только если они остались стандартными.
    if (on && p.scaleBranchMin === 80 && p.scaleBranchMax === 150) {
      p.setScaleBranchMin(30); p.setScaleBranchMax(300);
    }
  };

  return (
    // Позиция — через transform (left/top = 0): сдвиг идёт на видеокарте без
    // пересчёта раскладки. Окно вынесено в свой слой (will-change), а тень во
    // время перетаскивания упрощена — большую размытую тень браузер не успевает
    // перерисовывать поверх схемы, от неё и оставался шлейф.
    <div ref={boxRef} className="fixed left-0 top-0 z-50 rounded-xl border overflow-hidden"
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        willChange: "transform",
        width: W, background: "var(--c-s1, #fff)", borderColor: "var(--c-b2, #e2e8f0)",
        fontFamily: "var(--font-ui)",
        boxShadow: dragging ? "0 4px 12px rgba(0,0,0,0.18)" : "0 20px 40px -12px rgba(0,0,0,0.3)",
      }}>
      {/* Заголовок — за него окно перетаскивается */}
      <div className="flex items-center gap-2 px-3 h-9 cursor-move select-none border-b touch-none"
        style={{ borderColor: "var(--c-b1, #eef0f3)", background: "var(--c-s2, #f8fafc)" }}
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
        <Icon name="GripVertical" size={13} className="text-gray-400" />
        <Icon name="Scaling" size={14} className="text-blue-500" />
        <span className="text-[12px] font-semibold text-gray-800 flex-1">Пределы масштабов</span>
        <button onClick={cancel} title="Закрыть (Esc)"
          className="w-6 h-6 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-200">
          <Icon name="X" size={13} />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto">
        <Section title="Подписи" icon="Type">
          <Row label="Текстовые объекты" hint="Номер узла, номер ветви, номер устройства, название и т.п.">
            <MinMax min={p.scaleTextMin} max={p.scaleTextMax} setMin={p.setScaleTextMin} setMax={p.setScaleTextMax} />
          </Row>
        </Section>

        <Section title="Выработки" icon="Spline">
          <Row label="Толщина ветви" hint="Насколько тонкой и толстой может стать линия выработки при масштабировании.">
            <MinMax min={p.scaleBranchMin} max={p.scaleBranchMax} setMin={p.setScaleBranchMin} setMax={p.setScaleBranchMax} />
          </Row>
          <Toggle checked={p.widthBySectionOn} onChange={setWidthBySection} label="Толщина по сечению"
            hint="Ширина линии зависит от площади сечения: схема выглядит как фактическая модель, ошибки в сечении (2 вместо 20) сразу видно. Выключено — все выработки одной толщины." />
          <Toggle checked={p.tube3dOn} onChange={p.setTube3dOn} label="Объёмный вид (3D)"
            hint="Выработка рисуется трубой по реальному сечению (ствол — круг, квершлаг — свод, штрек — трапеция). Видно в ИЗО, фронте и профиле; при отдалении возвращаются линии." />
        </Section>

        <Section title="Оборудование" icon="Fan">
          <Row label="Перемычки" hint="Размер относительно ширины ветви, синхронно с масштабом схемы.">
            <Num value={p.bulkheadScale} onChange={p.setBulkheadScale} min={20} max={500} suffix="%" width={56} />
          </Row>
          <Row label="Вентиляторы" hint="Размер относительно ширины ветви, синхронно с масштабом схемы.">
            <Num value={p.fanScale} onChange={p.setFanScale} min={50} max={2000} suffix="%" width={56} />
          </Row>
        </Section>

        <Section title="Позиции ПЛА" icon="MapPin">
          <Row label="Размер на схеме">
            <MinMax min={p.scalePositionMin} max={p.scalePositionMax} setMin={p.setScalePositionMin} setMax={p.setScalePositionMax} />
          </Row>
          <Row label="Размер по ГОСТ" hint="Диаметр маркера позиции ПЛА на чертеже, по умолчанию 13 мм.">
            <Num value={p.positionGostMm} onChange={p.setPositionGostMm} min={2} max={100} step={0.5} suffix="мм" width={48} />
          </Row>
        </Section>
      </div>

      {/* Подвал */}
      <div className="flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: "var(--c-b1, #eef0f3)", background: "var(--c-s2, #f8fafc)" }}>
        <button
          onClick={() => {
            p.setScaleTextMin(80); p.setScaleTextMax(150);
            p.setScaleBranchMin(80); p.setScaleBranchMax(150);
            p.setWidthBySectionOn(false);
            p.setScalePositionMin(80); p.setScalePositionMax(150);
            p.setPositionGostMm(13);
            p.setBulkheadScale(150); p.setFanScale(450);
          }}
          className="flex items-center gap-1 px-2 h-7 text-[12px] rounded-md text-gray-600 hover:bg-gray-200">
          <Icon name="RotateCcw" size={12} />По умолчанию
        </button>
        <div className="flex-1" />
        <button onClick={cancel}
          className="px-3 h-7 text-[12px] rounded-md border text-gray-700 hover:bg-gray-100"
          style={{ borderColor: "var(--c-b2, #d1d5db)", background: "var(--c-s1, #fff)" }}>
          Отмена
        </button>
        <button onClick={() => { p.setScaleLimitsEnabled(true); p.setScaleSettingsOpen(false); }}
          className="px-4 h-7 text-[12px] rounded-md text-white bg-blue-600 hover:bg-blue-700">
          Применить
        </button>
      </div>
    </div>
  );
}