// Диалог «Перемещение схемы» — сдвиг объектов по осям X, Y, Z
// и привязка схемы к реальной (маркшейдерской / AutoCAD) системе координат.
//
// Вкладка «Сдвиг»: после импорта чертежа схема часто оказывается в маркшейдерских
// координатах (X ≈ −88 000) или на нулевой отметке, хотя горизонт находится
// на −40 м. Диалог сдвигает схему целиком, не меняя её формы: все расстояния
// между узлами сохраняются, поэтому длины выработок и сопротивление сети
// остаются прежними.
//
// Вкладка «Привязка координат»: схема на экране остаётся на месте, но
// задаётся смещение до реальной системы координат. После этого в свойствах
// узла X/Y показываются и вводятся в координатах AutoCAD / «Вентиляции 2.0»,
// а экспорт выгружает реальные координаты.
import { useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import { type TopoNode, surveyXYZ } from "@/lib/topology";

/** Что именно двигаем */
export type MoveArea = "all" | "visible" | "selected";

export interface MoveSchemaOptions {
  area: MoveArea;
  dx: number;
  dy: number;
  dz: number;
}

export type CoordOrigin = { x: number; y: number } | null;

interface Props {
  /** Сколько объектов попадёт под каждый вариант области — для подсказки */
  counts: { all: number; visible: number; selected: number };
  onConfirm: (opts: MoveSchemaOptions) => void;
  onClose: () => void;
  /** Узлы схемы — для привязки по известной точке. */
  nodes?: TopoNode[];
  /** Текущая привязка к реальной системе координат. */
  coordOrigin?: CoordOrigin;
  /** Номер выделенного узла — подставляется в привязку по точке. */
  initialNodeNumber?: string;
  /** Задать (или сбросить — null) привязку координат. */
  onSetOrigin?: (origin: CoordOrigin) => void;
}

/**
 * Превращает введённый текст в число.
 * Пустая строка, одиночный минус и «-,» — это промежуточные состояния набора,
 * они считаются нулём, но НЕ стирают то, что человек печатает.
 */
function parseShift(raw: string): number {
  const v = parseFloat(raw.replace(",", "."));
  return isFinite(v) ? v : 0;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (v: number) => r1(v).toLocaleString("ru-RU", { maximumFractionDigits: 1 });

type Tab = "move" | "bind";
type BindMode = "point" | "manual";

export default function MoveSchemaDialog({
  counts, onConfirm, onClose, nodes = [], coordOrigin = null, initialNodeNumber = "", onSetOrigin,
}: Props) {
  const [tab, setTab] = useState<Tab>("move");

  // ── Вкладка «Сдвиг» ───────────────────────────────────────────────────────
  // По умолчанию — «Выделенные», если пользователь что-то выделил: обычно
  // диалог открывают именно ради них. Иначе вся схема.
  const [area, setArea] = useState<MoveArea>(counts.selected > 0 ? "selected" : "all");

  // Смещения храним КАК ТЕКСТ, а не как число. Иначе нельзя набрать «-40»:
  // после первого символа «-» строка превращалась бы в 0 и минус пропадал,
  // так же как и «0,» при вводе дробного значения.
  const [dxText, setDxText] = useState("0");
  const [dyText, setDyText] = useState("0");
  const [dzText, setDzText] = useState("0");

  const dx = parseShift(dxText);
  const dy = parseShift(dyText);
  const dz = parseShift(dzText);

  const affected = counts[area];
  const noShift = dx === 0 && dy === 0 && dz === 0;
  const canMove = affected > 0 && !noShift;

  // ── Вкладка «Привязка координат» ──────────────────────────────────────────
  const [bindMode, setBindMode] = useState<BindMode>("point");
  const [nodeNum, setNodeNum] = useState(initialNodeNumber);
  const [realXText, setRealXText] = useState("");
  const [realYText, setRealYText] = useState("");
  const [oxText, setOxText] = useState(String(coordOrigin?.x ?? 0));
  const [oyText, setOyText] = useState(String(coordOrigin?.y ?? 0));

  const refNode = useMemo(() => {
    const key = nodeNum.trim();
    if (!key) return null;
    return nodes.find(n => String(n.number).trim() === key) ?? null;
  }, [nodes, nodeNum]);

  const curOx = coordOrigin?.x ?? 0;
  const curOy = coordOrigin?.y ?? 0;

  // Смещение, которое получится после применения
  const newOrigin = useMemo<{ x: number; y: number } | null>(() => {
    if (bindMode === "manual") {
      return { x: r1(parseShift(oxText)), y: r1(parseShift(oyText)) };
    }
    if (!refNode || realXText.trim() === "" || realYText.trim() === "") return null;
    const s = surveyXYZ(refNode);
    return { x: r1(parseShift(realXText) - s.x), y: r1(parseShift(realYText) - s.y) };
  }, [bindMode, oxText, oyText, refNode, realXText, realYText]);

  const canBind = !!onSetOrigin && !!newOrigin
    && (newOrigin.x !== curOx || newOrigin.y !== curOy);

  const canApply = tab === "move" ? canMove : canBind;

  const handleOk = () => {
    if (!canApply) return;
    if (tab === "move") onConfirm({ area, dx, dy, dz });
    else if (newOrigin && onSetOrigin) {
      onSetOrigin(newOrigin.x === 0 && newOrigin.y === 0 ? null : newOrigin);
    }
  };

  const S = {
    overlay: { position: "fixed" as const, inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" },
    dialog: { width: 400, background: "var(--c-s1, #ffffff)", border: "1px solid var(--c-b3, #aaa)", borderRadius: "var(--radius-ui)", boxShadow: "0 8px 32px rgba(0,0,0,0.35)", fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--c-t1, #1a1a1a)" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "linear-gradient(180deg,#dde4ef,#c5cfe0)", borderBottom: "1px solid #9aa8bf" },
    headerTitle: { display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13, color: "var(--c-t1, #1a1a1a)" },
    closeBtn: { width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "none", background: "transparent", fontSize: 12, color: "var(--c-t2, #333)", borderRadius: "var(--radius-ui)" },
    tabs: { display: "flex", gap: 0, padding: "0 12px", background: "var(--c-s3, #f0f0f0)", borderBottom: "1px solid var(--c-b2, #ccc)" },
    body: { padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 8, background: "var(--c-s1, #ffffff)" },
    row: { display: "flex", alignItems: "center", gap: 8 },
    label: { width: 110, flexShrink: 0, color: "var(--c-t2, #333)", fontSize: 12 },
    select: { flex: 1, height: 22, padding: "0 4px", border: "1px solid var(--c-b3, #aaa)", borderRadius: "var(--radius-ui)", fontSize: 12, background: "var(--c-s1, #fff)", color: "var(--c-t1, #1a1a1a)", outline: "none" },
    input: { flex: 1, height: 22, padding: "0 22px 0 4px", border: "1px solid var(--c-b3, #aaa)", borderRadius: "var(--radius-ui)", fontSize: 12, background: "var(--c-s1, #fff)", color: "var(--c-t1, #1a1a1a)", textAlign: "right" as const, outline: "none", minWidth: 0 },
    unit: { position: "absolute" as const, right: 6, top: 4, fontSize: 11, color: "var(--c-t3, #777)", pointerEvents: "none" as const },
    inputWrap: { position: "relative" as const, flex: 1, display: "flex" },
    hint: { fontSize: 11, color: "var(--c-t3, #555)", lineHeight: 1.4, paddingTop: 6, borderTop: "1px solid #ddd", marginTop: 2 },
    infoBox: { fontSize: 11, lineHeight: 1.45, padding: "6px 8px", borderRadius: "var(--radius-ui)", background: "var(--c-s3, #f3f5f9)", border: "1px solid var(--c-b2, #d5dbe5)", color: "var(--c-t2, #333)" },
    statVal: { fontWeight: 600, color: "var(--c-t1, #1a1a1a)" },
    radio: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--c-t1, #1a1a1a)" },
    footer: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px 10px", background: "var(--c-s3, #f0f0f0)", borderTop: "1px solid var(--c-b2, #ccc)" },
    btnOk: { height: 26, padding: "0 20px", fontSize: 12, background: canApply ? "var(--c-blue-bg, #2563eb)" : "var(--c-s2, #e5e5e5)", color: canApply ? "#fff" : "var(--c-t3, #999)", border: `1px solid ${canApply ? "var(--c-blue, #1d4ed8)" : "var(--c-b3, #ccc)"}`, borderRadius: "var(--radius-ui)", cursor: canApply ? "pointer" : "default", fontWeight: 600 },
    btnCancel: { height: 26, padding: "0 14px", fontSize: 12, background: "var(--c-s2, #f5f5f5)", color: "var(--c-t1, #1a1a1a)", border: "1px solid var(--c-b3, #aaa)", borderRadius: "var(--radius-ui)", cursor: "pointer" },
    btnLink: { height: 26, padding: "0 8px", fontSize: 11, background: "transparent", color: "var(--c-red, #b91c1c)", border: "none", cursor: "pointer", textDecoration: "underline" },
  };

  const tabBtn = (id: Tab, label: string) => {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        style={{
          padding: "6px 12px", fontSize: 12, cursor: "pointer", border: "none",
          background: "transparent", marginBottom: -1,
          borderBottom: active ? "2px solid var(--c-blue, #2563eb)" : "2px solid transparent",
          color: active ? "var(--c-t1, #1a1a1a)" : "var(--c-t3, #666)",
          fontWeight: active ? 600 : 400,
        }}
      >{label}</button>
    );
  };

  /**
   * Строка ввода числа в метрах.
   *
   * Это обычная функция, а НЕ вложенный компонент. Раньше здесь был компонент,
   * объявленный внутри MoveSchemaDialog: при каждом нажатии клавиши React
   * считал его новым типом, выбрасывал старое поле и создавал пустое — фокус
   * слетал, и цифры «не набирались».
   */
  const axisRow = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    title: string,
    placeholder = "",
  ) => (
    <div style={S.row} title={title}>
      <span style={S.label}>{label}</span>
      <div style={S.inputWrap}>
        <input
          type="text"
          inputMode="text"
          value={value}
          placeholder={placeholder}
          // Пропускаем только то, из чего может получиться число:
          // цифры, минус в начале, одна точка или запятая.
          onChange={(e) => {
            const v = e.target.value.replace(/\s/g, "");
            if (v === "" || /^-?\d*[.,]?\d*$/.test(v)) onChange(v);
          }}
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

        {onSetOrigin && (
          <div style={S.tabs}>
            {tabBtn("move", "Сдвиг схемы")}
            {tabBtn("bind", "Привязка координат")}
          </div>
        )}

        {tab === "move" ? (
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

            {axisRow("Вдоль OX:", dxText, setDxText,
              "Плюс — на восток (вправо), минус — на запад")}
            {axisRow("Вдоль OY:", dyText, setDyText,
              "Плюс — на север (вверх), минус — на юг")}
            {axisRow("Вдоль OZ:", dzText, setDzText,
              "Плюс — вверх, минус — вниз. Например, −40 опустит схему на горизонт −40 м")}

            <div style={S.hint}>
              {affected > 0 ? (
                <>Переместится <span style={S.statVal}>{affected} узлов</span> вместе
                  с выработками и подписями. Форма схемы и длины выработок не изменятся.</>
              ) : (
                <>Нет объектов для перемещения — выберите другую область.</>
              )}
            </div>
          </div>
        ) : (
          <div style={S.body}>
            <div style={S.infoBox}>
              Текущее смещение:{" "}
              {coordOrigin ? (
                <span style={S.statVal}>X {fmt(curOx)} · Y {fmt(curOy)} м</span>
              ) : (
                <span style={S.statVal}>не задано</span>
              )}
              <div style={{ marginTop: 3 }}>
                Схема на экране не сдвигается. Меняются координаты в свойствах
                узлов, ввод новых узлов и выгрузка в .cdf3 / CSV.
              </div>
            </div>

            <label style={S.radio}>
              <input type="radio" checked={bindMode === "point"} onChange={() => setBindMode("point")} />
              По известной точке (узел + его координаты из AutoCAD)
            </label>
            <label style={S.radio}>
              <input type="radio" checked={bindMode === "manual"} onChange={() => setBindMode("manual")} />
              Ввести смещение вручную
            </label>

            {bindMode === "point" ? (
              <>
                <div style={S.row}>
                  <span style={S.label}>Номер узла:</span>
                  <div style={S.inputWrap}>
                    <input
                      type="text"
                      value={nodeNum}
                      onChange={(e) => setNodeNum(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleOk(); }}
                      placeholder="например, 331"
                      style={{ ...S.input, padding: "0 4px" }}
                    />
                  </div>
                </div>
                {nodeNum.trim() !== "" && (
                  <div style={{ fontSize: 11, color: refNode ? "var(--c-t3, #555)" : "var(--c-red, #b91c1c)", paddingLeft: 118 }}>
                    {refNode
                      ? <>Сейчас в программе: X {fmt(surveyXYZ(refNode).x + curOx)} · Y {fmt(surveyXYZ(refNode).y + curOy)}</>
                      : <>Узел с таким номером не найден</>}
                  </div>
                )}
                {axisRow("Реальный X:", realXText, setRealXText,
                  "Координата X этого узла в AutoCAD / «Вентиляции 2.0»", "из AutoCAD")}
                {axisRow("Реальный Y:", realYText, setRealYText,
                  "Координата Y этого узла в AutoCAD / «Вентиляции 2.0»", "из AutoCAD")}
              </>
            ) : (
              <>
                {axisRow("Смещение X:", oxText, setOxText,
                  "Сколько прибавить к X схемы, чтобы получить реальную координату")}
                {axisRow("Смещение Y:", oyText, setOyText,
                  "Сколько прибавить к Y схемы, чтобы получить реальную координату")}
              </>
            )}

            <div style={S.hint}>
              {newOrigin ? (
                <>Новое смещение: <span style={S.statVal}>X {fmt(newOrigin.x)} · Y {fmt(newOrigin.y)} м</span>.
                  Реальная координата = координата схемы + смещение.</>
              ) : (
                <>Укажите узел и его координаты из AutoCAD — смещение посчитается само.</>
              )}
            </div>
          </div>
        )}

        <div style={S.footer}>
          {tab === "bind" && coordOrigin && onSetOrigin && (
            <button style={S.btnLink} onClick={() => onSetOrigin(null)}
              title="Убрать привязку — координаты снова будут как на схеме">
              Сбросить привязку
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button style={S.btnOk} onClick={handleOk} disabled={!canApply}>ОК</button>
          <button style={S.btnCancel} onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
