// Диалог «Перемещение схемы» — сдвиг объектов по осям X, Y, Z.
//
// Зачем нужен: после импорта чертежа схема часто оказывается в маркшейдерских
// координатах (X ≈ −88 000) или на нулевой отметке, хотя горизонт находится
// на −40 м. Диалог сдвигает схему целиком, не меняя её формы: все расстояния
// между узлами сохраняются, поэтому длины выработок и сопротивление сети
// остаются прежними.
import { useState } from "react";
import Icon from "@/components/ui/icon";

/** Что именно двигаем */
export type MoveArea = "all" | "visible" | "selected";

export interface MoveSchemaOptions {
  area: MoveArea;
  dx: number;
  dy: number;
  dz: number;
}

interface Props {
  /** Сколько объектов попадёт под каждый вариант области — для подсказки */
  counts: { all: number; visible: number; selected: number };
  onConfirm: (opts: MoveSchemaOptions) => void;
  onClose: () => void;
}

export default function MoveSchemaDialog({ counts, onConfirm, onClose }: Props) {
  // По умолчанию — «Выделенные», если пользователь что-то выделил: обычно
  // диалог открывают именно ради них. Иначе вся схема.
  const [area, setArea] = useState<MoveArea>(counts.selected > 0 ? "selected" : "all");
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [dz, setDz] = useState(0);

  const affected = counts[area];
  const noShift = dx === 0 && dy === 0 && dz === 0;
  const canApply = affected > 0 && !noShift;

  const handleOk = () => {
    if (!canApply) return;
    onConfirm({ area, dx, dy, dz });
  };

  /** Ввод числа: разрешаем минус, запятую и пустое поле во время набора */
  const parse = (raw: string): number => {
    const v = parseFloat(raw.replace(",", "."));
    return isFinite(v) ? v : 0;
  };

  const S = {
    overlay: { position: "fixed" as const, inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" },
    dialog: { width: 360, background: "var(--c-s1, #ffffff)", border: "1px solid var(--c-b3, #aaa)", borderRadius: 4, boxShadow: "0 8px 32px rgba(0,0,0,0.35)", fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 12, color: "var(--c-t1, #1a1a1a)" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "linear-gradient(180deg,#dde4ef,#c5cfe0)", borderBottom: "1px solid #9aa8bf" },
    headerTitle: { display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13, color: "var(--c-t1, #1a1a1a)" },
    closeBtn: { width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "none", background: "transparent", fontSize: 12, color: "var(--c-t2, #333)", borderRadius: 2 },
    body: { padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 8, background: "var(--c-s1, #ffffff)" },
    row: { display: "flex", alignItems: "center", gap: 8 },
    label: { width: 92, flexShrink: 0, color: "var(--c-t2, #333)", fontSize: 12 },
    select: { flex: 1, height: 22, padding: "0 4px", border: "1px solid var(--c-b3, #aaa)", borderRadius: 2, fontSize: 12, background: "var(--c-s1, #fff)", color: "var(--c-t1, #1a1a1a)", outline: "none" },
    input: { flex: 1, height: 22, padding: "0 22px 0 4px", border: "1px solid var(--c-b3, #aaa)", borderRadius: 2, fontSize: 12, background: "var(--c-s1, #fff)", color: "var(--c-t1, #1a1a1a)", textAlign: "right" as const, outline: "none" },
    unit: { position: "absolute" as const, right: 6, top: 4, fontSize: 11, color: "var(--c-t3, #777)", pointerEvents: "none" as const },
    inputWrap: { position: "relative" as const, flex: 1, display: "flex" },
    hint: { fontSize: 11, color: "var(--c-t3, #555)", lineHeight: 1.4, paddingTop: 6, borderTop: "1px solid #ddd", marginTop: 2 },
    statVal: { fontWeight: 600, color: "var(--c-t1, #1a1a1a)" },
    footer: { display: "flex", justifyContent: "flex-end", gap: 6, padding: "8px 16px 10px", background: "var(--c-s3, #f0f0f0)", borderTop: "1px solid var(--c-b2, #ccc)" },
    btnOk: { height: 26, padding: "0 20px", fontSize: 12, background: canApply ? "var(--c-blue-bg, #2563eb)" : "var(--c-s2, #e5e5e5)", color: canApply ? "#fff" : "var(--c-t3, #999)", border: `1px solid ${canApply ? "var(--c-blue, #1d4ed8)" : "var(--c-b3, #ccc)"}`, borderRadius: 2, cursor: canApply ? "pointer" : "default", fontWeight: 600 },
    btnCancel: { height: 26, padding: "0 14px", fontSize: 12, background: "var(--c-s2, #f5f5f5)", color: "var(--c-t1, #1a1a1a)", border: "1px solid var(--c-b3, #aaa)", borderRadius: 2, cursor: "pointer" },
  };

  /** Поле ввода смещения по одной оси */
  const AxisRow = ({ label, value, onChange, title }: {
    label: string; value: number; onChange: (v: number) => void; title: string;
  }) => (
    <div style={S.row} title={title}>
      <span style={S.label}>{label}</span>
      <div style={S.inputWrap}>
        <input
          type="text"
          inputMode="decimal"
          value={String(value)}
          onChange={(e) => onChange(parse(e.target.value))}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => { if (e.key === "Enter") handleOk(); }}
          style={S.input}
        />
        <span style={S.unit}>м</span>
      </div>
    </div>
  );

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.dialog} onClick={(e) => e.stopPropagation()}>

        {/* Шапка */}
        <div style={S.header}>
          <div style={S.headerTitle}>
            <Icon name="Move" size={14} style={{ color: "var(--c-blue, #2563eb)" }} />
            Перемещение схемы
          </div>
          <button style={S.closeBtn} onClick={onClose} title="Закрыть">✕</button>
        </div>

        <div style={S.body}>

          {/* Область применения */}
          <div style={S.row}>
            <span style={S.label}>Область:</span>
            <select value={area} onChange={(e) => setArea(e.target.value as MoveArea)} style={S.select}>
              <option value="all">Вся схема ({counts.all})</option>
              <option value="visible">Видимые объекты ({counts.visible})</option>
              <option value="selected" disabled={counts.selected === 0}>
                Выделенные объекты ({counts.selected})
              </option>
            </select>
          </div>

          <AxisRow label="Вдоль OX:" value={dx} onChange={setDx}
            title="Плюс — на восток (вправо), минус — на запад" />
          <AxisRow label="Вдоль OY:" value={dy} onChange={setDy}
            title="Плюс — на север (вверх), минус — на юг" />
          <AxisRow label="Вдоль OZ:" value={dz} onChange={setDz}
            title="Плюс — вверх, минус — вниз. Например, −40 опустит схему на горизонт −40 м" />

          <div style={S.hint}>
            {affected > 0 ? (
              <>Переместится <span style={S.statVal}>{affected} узлов</span> вместе
                с выработками и подписями. Форма схемы и длины выработок не изменятся.</>
            ) : (
              <>Нет объектов для перемещения — выберите другую область.</>
            )}
          </div>
        </div>

        <div style={S.footer}>
          <button style={S.btnOk} onClick={handleOk} disabled={!canApply}>ОК</button>
          <button style={S.btnCancel} onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
