// Блок «Смещение горизонта» в настройках каждого горизонта.
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

interface Props {
  horizonId: string;
  /** Сколько выработок на горизонте — если ноль, двигать нечего */
  branchCount: number;
  onMove: (horizonId: string, dx: number, dy: number, dz: number) => void;
}

/** Текст поля → число. Пустая строка и одиночный минус считаются нулём. */
function toNum(raw: string): number {
  const v = parseFloat(raw.replace(",", "."));
  return isFinite(v) ? v : 0;
}

/** Пропускаем в поле только то, из чего может получиться число */
const isTypable = (v: string) => v === "" || /^-?\d*[.,]?\d*$/.test(v);

export default function HorizonShiftBlock({ horizonId, branchCount, onMove }: Props) {
  // Значения храним как ТЕКСТ: иначе нельзя набрать «-40» — после первого
  // символа «-» строка превратилась бы в 0 и минус пропал.
  const [dx, setDx] = useState("0");
  const [dy, setDy] = useState("0");
  const [dz, setDz] = useState("0");

  const nx = toNum(dx), ny = toNum(dy), nz = toNum(dz);
  const canMove = branchCount > 0 && (nx !== 0 || ny !== 0 || nz !== 0);

  const apply = () => {
    if (!canMove) return;
    onMove(horizonId, nx, ny, nz);
    setDx("0"); setDy("0"); setDz("0");
  };

  /** Шаговая кнопка: сдвигает горизонт сразу, без ввода числа */
  const step = (ax: "x" | "y" | "z", d: number) => {
    if (branchCount === 0) return;
    onMove(horizonId, ax === "x" ? d : 0, ax === "y" ? d : 0, ax === "z" ? d : 0);
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    axis: "x" | "y" | "z",
    title: string,
  ) => (
    <div className="flex items-center gap-1" title={title}>
      <span className="text-[10px] text-gray-600 w-4 flex-shrink-0">{label}</span>
      <input
        type="text"
        inputMode="text"
        value={value}
        onChange={(e) => { if (isTypable(e.target.value)) set(e.target.value); }}
        onFocus={(e) => e.target.select()}
        onBlur={() => { if (value === "" || value === "-") set("0"); }}
        onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
        className="cad-input flex-1 min-w-0 text-right"
        disabled={branchCount === 0}
      />
      <span className="text-[10px] text-gray-400 flex-shrink-0">м</span>
      {/* Мелкая подстройка на месте — удобнее, чем набирать число */}
      <button onClick={() => step(axis, -1)} disabled={branchCount === 0}
        title="Сдвинуть на −1 м"
        className="w-4 h-4 flex items-center justify-center rounded hover:bg-blue-100 disabled:opacity-30 text-[11px] leading-none">−</button>
      <button onClick={() => step(axis, 1)} disabled={branchCount === 0}
        title="Сдвинуть на +1 м"
        className="w-4 h-4 flex items-center justify-center rounded hover:bg-blue-100 disabled:opacity-30 text-[11px] leading-none">+</button>
    </div>
  );

  return (
    <div className="pt-1 pb-1 space-y-1" style={{ borderBottom: "1px solid var(--c-b1, #e5e7eb)" }}>
      <div className="flex items-center gap-1 text-[10px] font-medium text-gray-700">
        <Icon name="Move" size={11} className="flex-shrink-0" style={{ color: "var(--c-blue, #2563eb)" }} />
        Смещение горизонта
      </div>

      {branchCount === 0 ? (
        <div className="text-[10px] text-gray-400 leading-snug">
          На горизонте нет выработок — двигать нечего.
        </div>
      ) : (
        <>
          {field("X:", dx, setDx, "x", "Плюс — на восток (вправо), минус — на запад")}
          {field("Y:", dy, setDy, "y", "Плюс — на север (вверх), минус — на юг")}
          {field("Z:", dz, setDz, "z", "Плюс — вверх, минус — вниз")}

          <div className="flex items-center gap-1">
            <button onClick={apply} disabled={!canMove}
              className="flex-1 px-2 py-1 text-[10px] rounded border font-medium disabled:opacity-40"
              style={{
                background: canMove ? "var(--c-tint-blue, #eff6ff)" : "transparent",
                borderColor: canMove ? "var(--c-blue-lt, #3b82f6)" : "var(--c-b2, #d1d5db)",
                color: canMove ? "var(--c-blue, #1d4ed8)" : "var(--c-t3, #9ca3af)",
              }}>
              Переместить горизонт
            </button>
          </div>

          <div className="text-[9px] text-gray-500 leading-snug">
            Узлы стыковки с другими горизонтами остаются на месте.
            Длины выработок не меняются. Отмена — Ctrl+Z.
          </div>
        </>
      )}
    </div>
  );
}
