// Блок «Смещение горизонта» в настройках каждого горизонта — одна строка.
//
// Зачем нужен: горизонты часто импортируют по одному, отдельными чертежами.
// Маркшейдер ведёт каждый горизонт в своих координатах, поэтому свежий
// горизонт почти никогда не встаёт на место — его нужно подвинуть, чтобы
// стволы и сбойки сошлись с уже построенной сетью.
//
// Отличие от «Перемещения схемы» (вкладка «Схема»): здесь двигается только
// один горизонт, а узлы, общие с другими горизонтами, остаются на месте —
// это точки стыковки, и рвать их нельзя.
import { useState } from "react";
import Icon from "@/components/ui/icon";

/** Готовое совмещение по двум выделенным узлам */
export interface HorizonAlign {
  dx: number;
  dy: number;
  dz: number;
  /** Что с чем совмещаем — для подсказки */
  label: string;
}

interface Props {
  horizonId: string;
  /** Сколько выработок на горизонте — если ноль, двигать нечего */
  branchCount: number;
  onMove: (horizonId: string, dx: number, dy: number, dz: number) => void;
  /**
   * Совмещение по узлам: null — выделение не подходит (нужны ровно два узла,
   * один на этом горизонте, другой вне его).
   */
  align: HorizonAlign | null;
}

/** Текст поля → число. Пустая строка и одиночный минус считаются нулём. */
function toNum(raw: string): number {
  const v = parseFloat(raw.replace(",", "."));
  return isFinite(v) ? v : 0;
}

/** Пропускаем в поле только то, из чего может получиться число */
const isTypable = (v: string) => v === "" || /^-?\d*[.,]?\d*$/.test(v);

export default function HorizonShiftBlock({ horizonId, branchCount, onMove, align }: Props) {
  // Значения храним как ТЕКСТ: иначе нельзя набрать «-40» — после первого
  // символа «-» строка превратилась бы в 0 и минус пропал.
  const [dx, setDx] = useState("0");
  const [dy, setDy] = useState("0");
  const [dz, setDz] = useState("0");

  const nx = toNum(dx), ny = toNum(dy), nz = toNum(dz);
  const empty = branchCount === 0;
  const canMove = !empty && (nx !== 0 || ny !== 0 || nz !== 0);

  const apply = () => {
    if (!canMove) return;
    onMove(horizonId, nx, ny, nz);
    setDx("0"); setDy("0"); setDz("0");
  };

  const doAlign = () => {
    if (empty || !align) return;
    onMove(horizonId, align.dx, align.dy, align.dz);
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    title: string,
  ) => (
    <div className="flex items-center gap-0.5 flex-1 min-w-0" title={title}>
      <span className="text-[10px] text-gray-500 flex-shrink-0">{label}</span>
      <input
        type="text"
        inputMode="text"
        value={value}
        onChange={(e) => { if (isTypable(e.target.value)) set(e.target.value); }}
        onFocus={(e) => e.target.select()}
        onBlur={() => { if (value === "" || value === "-") set("0"); }}
        onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
        className="cad-input w-full min-w-0 text-right"
        disabled={empty}
      />
    </div>
  );

  return (
    <div className="pt-1 pb-1 space-y-1" style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)" }}>
      {/* Всё смещение — в одну строку: подпись, три поля, кнопки */}
      <div className="flex items-center gap-1">
        <Icon name="Move" size={11} className="flex-shrink-0"
          style={{ color: empty ? "var(--c-t3, #9ca3af)" : "var(--c-blue, #2563eb)" }} />
        <span className="text-[10px] text-gray-600 flex-shrink-0" title="Смещение горизонта по осям, м">
          Сдвиг:
        </span>

        {field("X", dx, setDx, "Плюс — на восток (вправо), минус — на запад")}
        {field("Y", dy, setDy, "Плюс — на север (вверх), минус — на юг")}
        {field("Z", dz, setDz, "Плюс — вверх, минус — вниз")}

        <button onClick={apply} disabled={!canMove}
          title="Переместить горизонт на указанное смещение"
          className="w-5 h-5 flex items-center justify-center rounded border flex-shrink-0 disabled:opacity-30"
          style={{
            background: canMove ? "var(--c-tint-blue, #eff6ff)" : "transparent",
            borderColor: canMove ? "var(--c-blue-lt, #3b82f6)" : "var(--c-b2, #d1d5db)",
          }}>
          <Icon name="Check" size={11} style={{ color: canMove ? "var(--c-blue, #1d4ed8)" : "var(--c-t3, #9ca3af)" }} />
        </button>

        <button onClick={doAlign} disabled={empty || !align}
          title={align
            ? `Совместить по узлам: ${align.label}`
            : "Совместить по узлу: выделите два узла (Ctrl+клик) — один на этом горизонте, второй на основной схеме"}
          className="w-5 h-5 flex items-center justify-center rounded border flex-shrink-0 disabled:opacity-30"
          style={{
            background: align && !empty ? "var(--c-tint-green, #ecfdf5)" : "transparent",
            borderColor: align && !empty ? "var(--c-green, #10b981)" : "var(--c-b2, #d1d5db)",
          }}>
          <Icon name="Crosshair" size={11}
            style={{ color: align && !empty ? "var(--c-green-dk, #047857)" : "var(--c-t3, #9ca3af)" }} />
        </button>
      </div>

      {/* Подсказка: что произойдёт по кнопке совмещения */}
      {!empty && align && (
        <div className="text-[9px] leading-snug flex items-center gap-1 flex-wrap"
          style={{ color: "var(--c-green-dk, #047857)" }}>
          {/* Точки повторяют цвет колец на схеме: жёлтый узел поедет,
              зелёный останется — так подсказка читается без пояснений */}
          <span className="inline-flex items-center gap-0.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "#f59e0b" }} />
            поедет
          </span>
          <span>→</span>
          <span className="inline-flex items-center gap-0.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "#10b981" }} />
            останется
          </span>
          <span>· {align.label} · сдвиг {align.dx.toFixed(1)}, {align.dy.toFixed(1)}, {align.dz.toFixed(1)} м</span>
        </div>
      )}
      {empty && (
        <div className="text-[9px] text-gray-400 leading-snug">
          На горизонте нет выработок — двигать нечего.
        </div>
      )}
    </div>
  );
}