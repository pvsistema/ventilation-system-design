// Блок «Сдвиг горизонта» в карточке горизонта (вкладка «Горизонты»).
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
    <label className="flex items-stretch flex-1 min-w-0 overflow-hidden" title={title}
      style={{ border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)", opacity: empty ? 0.5 : 1 }}>
      <span className="px-1 flex items-center text-[10px] flex-shrink-0" style={{ color: "var(--c-t4)", background: "var(--c-s3)" }}>{label}</span>
      <input
        type="text"
        inputMode="text"
        value={value}
        onChange={(e) => { if (isTypable(e.target.value)) set(e.target.value); }}
        onFocus={(e) => e.target.select()}
        onBlur={() => { if (value === "" || value === "-") set("0"); }}
        onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
        className="font-num w-full min-w-0 h-6 px-1 text-[11px] text-right outline-none bg-transparent"
        style={{ color: "var(--c-t1)" }}
        disabled={empty}
      />
    </label>
  );

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] leading-snug" style={{ color: "var(--c-t3)" }}>
        Сдвигает только этот горизонт, в метрах. Узлы стыковки с другими горизонтами остаются на месте.
      </div>
      {/* Три поля и кнопки — в одну строку */}
      <div className="flex items-center gap-1">

        {field("X", dx, setDx, "Плюс — на восток (вправо), минус — на запад")}
        {field("Y", dy, setDy, "Плюс — на север (вверх), минус — на юг")}
        {field("Z", dz, setDz, "Плюс — вверх, минус — вниз")}

        <button onClick={apply} disabled={!canMove}
          title="Переместить горизонт на указанное смещение"
          className="h-6 px-1.5 flex items-center gap-1 rounded flex-shrink-0 text-[10.5px] font-medium disabled:opacity-40"
          style={{
            background: canMove ? "var(--c-accent)" : "var(--c-s1)",
            border: `1px solid ${canMove ? "var(--c-accent)" : "var(--c-b2)"}`,
            color: canMove ? "#fff" : "var(--c-t3)",
          }}>
          <Icon name="Check" size={11} />Сдвинуть
        </button>

        <button onClick={doAlign} disabled={empty || !align}
          title={align
            ? `Совместить по узлам: ${align.label}`
            : "Совместить по узлу: выделите два узла (Ctrl+клик) — один на этом горизонте, второй на основной схеме"}
          className="w-6 h-6 flex items-center justify-center rounded flex-shrink-0 disabled:opacity-40"
          style={{
            background: align && !empty ? "var(--c-tint-green)" : "var(--c-s1)",
            border: `1px solid ${align && !empty ? "var(--c-green)" : "var(--c-b2)"}`,
            color: align && !empty ? "var(--c-green)" : "var(--c-t3)",
          }}>
          <Icon name="Crosshair" size={12} />
        </button>
      </div>

      {!empty && !align && (
        <div className="text-[10px] leading-snug" style={{ color: "var(--c-t4)" }}>
          <Icon name="Crosshair" size={10} className="inline -mt-px" /> — совместить по узлам: выделите Ctrl+клик
          один узел на этом горизонте и один на основной схеме.
        </div>
      )}
      {/* Подсказка: что произойдёт по кнопке совмещения */}
      {!empty && align && (
        <div className="text-[9px] leading-snug flex items-center gap-1 flex-wrap"
          style={{ color: "var(--c-green)" }}>
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
        <div className="text-[10px] leading-snug" style={{ color: "var(--c-t4)" }}>
          На горизонте нет выработок — двигать нечего.
        </div>
      )}
    </div>
  );
}