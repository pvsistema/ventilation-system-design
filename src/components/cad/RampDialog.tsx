// ─────────────────────────────────────────────────────────────────────────────
// RampDialog — построение наклонного съезда по нарисованной трассе.
//
// ЗАЧЕМ. Съезд обводят по маркшейдерской подложке на плане: X и Y человек
// задаёт мышью, а отметки Z остаются нулевыми. Раздать их вручную по десяткам
// узлов невозможно — и главное, невозможно на глаз проверить, что уклон нигде
// не вышел за предел для подземного транспорта. Диалог делает и то, и другое.
//
// Расчёт живой: цифры и вердикт пересчитываются на каждое изменение поля, ДО
// того как схема изменится. Человек видит «нужно ещё 43 м» заранее, а не после
// того, как построил неверный съезд.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import { type TopoNode, type TopoBranch, surveyXYZ } from "@/lib/topology";
import {
  buildRamp, buildSpiral, type RampMode, type RampResult, type SpiralResult,
  RAMP_WORK_ANGLE, RAMP_LIMIT_ANGLE,
} from "@/lib/rampBuilder";

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  /** Выделенные выработки — трасса будущего съезда. */
  selectedBranchIds: string[];
  /** Применить отметки к узлам. */
  onApply: (nodeZ: { id: string; z: number }[]) => void;
  /** Построить спиральный съезд из готовых точек. */
  onBuildSpiral: (points: { x: number; y: number; z: number }[]) => void;
  onClose: () => void;
}

/** Текст → число. Пустая строка и одинокий минус — промежуточный ввод. */
function num(raw: string): number {
  const v = parseFloat(raw.replace(",", "."));
  return isFinite(v) ? v : 0;
}

export default function RampDialog({
  nodes, branches, selectedBranchIds, onApply, onBuildSpiral, onClose,
}: Props) {
  const [tab, setTab] = useState<"ramp" | "spiral">("ramp");

  // Отметки храним ТЕКСТОМ: иначе нельзя набрать «-100» — после первого
  // символа «−» строка стала бы нулём и минус пропал.
  const [z0Text, setZ0Text] = useState(() => {
    const first = selectedBranchIds.length > 0
      ? branches.find((b) => b.id === selectedBranchIds[0]) : null;
    const n = first ? nodes.find((x) => x.id === first.fromId) : null;
    return n ? String(Math.round(surveyXYZ(n).z)) : "0";
  });
  const [z1Text, setZ1Text] = useState("-100");
  const [workAngle, setWorkAngle] = useState(RAMP_WORK_ANGLE);
  const [limitAngle, setLimitAngle] = useState(RAMP_LIMIT_ANGLE);
  const [mode, setMode] = useState<RampMode>("even");
  const [usePlatforms, setUsePlatforms] = useState(false);
  const [platEvery, setPlatEvery] = useState("200");
  const [platLen, setPlatLen] = useState("20");
  const [lockHorizon, setLockHorizon] = useState(true);

  // Спираль
  const [radius, setRadius] = useState("30");
  const [spiralStep, setSpiralStep] = useState("15");
  const [clockwise, setClockwise] = useState(true);

  const z0 = num(z0Text);
  const z1 = num(z1Text);

  // ── Живой предпросчёт съезда ──────────────────────────────────────────
  const result: RampResult | null = useMemo(() => {
    if (tab !== "ramp" || selectedBranchIds.length === 0) return null;
    return buildRamp(nodes, branches, selectedBranchIds, {
      z0, z1, workAngle, limitAngle, mode,
      platformEvery: usePlatforms ? num(platEvery) : 0,
      platformLen: usePlatforms ? num(platLen) : 0,
      lockHorizonNodes: lockHorizon,
    });
  }, [tab, nodes, branches, selectedBranchIds, z0, z1, workAngle, limitAngle,
      mode, usePlatforms, platEvery, platLen, lockHorizon]);

  // ── Живой предпросчёт спирали ─────────────────────────────────────────
  const spiral: SpiralResult | null = useMemo(() => {
    if (tab !== "spiral") return null;
    // Центр спирали — середина выделенной трассы, если она есть, иначе ноль.
    let cx = 0, cy = 0;
    const first = branches.find((b) => b.id === selectedBranchIds[0]);
    const n = first ? nodes.find((x) => x.id === first.fromId) : null;
    if (n) { const s = surveyXYZ(n); cx = s.x; cy = s.y; }
    return buildSpiral({
      cx, cy, radius: num(radius), z0, z1,
      angle: workAngle, stepDeg: num(spiralStep), clockwise,
    });
  }, [tab, nodes, branches, selectedBranchIds, radius, z0, z1, workAngle, spiralStep, clockwise]);

  const canApplyRamp = !!result && result.status !== "fail";
  const canBuildSpiral = !!spiral && spiral.points.length > 1 && Math.abs(z1 - z0) > 0.5;

  // Цвет вердикта: зелёный — в норме, жёлтый — выше рабочего, красный — нельзя.
  const verdictColor = result?.status === "ok" ? "#15803d"
    : result?.status === "warn" ? "#b45309" : "#b91c1c";
  const verdictBg = result?.status === "ok" ? "#f0fdf4"
    : result?.status === "warn" ? "#fffbeb" : "#fef2f2";
  const verdictBorder = result?.status === "ok" ? "#86efac"
    : result?.status === "warn" ? "#fcd34d" : "#fca5a5";

  const S = {
    overlay: { position: "fixed" as const, inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" },
    dialog: { width: 470, maxHeight: "88vh", overflowY: "auto" as const, background: "#fff", border: "1px solid var(--c-b3, #aaa)", borderRadius: 4, boxShadow: "0 8px 32px rgba(0,0,0,0.35)", fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 12, color: "var(--c-t1, #1a1a1a)" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "linear-gradient(180deg,#dde4ef,#c5cfe0)", borderBottom: "1px solid #9aa8bf", position: "sticky" as const, top: 0, zIndex: 2 },
    headerTitle: { display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 },
    closeBtn: { width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "none", background: "transparent", fontSize: 12, borderRadius: 2 },
    tabs: { display: "flex", gap: 0, borderBottom: "1px solid #ccc", background: "#f5f5f5" },
    tab: (on: boolean) => ({ flex: 1, height: 26, fontSize: 12, cursor: "pointer", border: "none", borderBottom: on ? "2px solid var(--c-blue, #2563eb)" : "2px solid transparent", background: on ? "#fff" : "transparent", color: on ? "var(--c-blue, #1d4ed8)" : "var(--c-t2, #444)", fontWeight: on ? 600 : 400 }),
    body: { padding: "10px 14px", display: "flex", flexDirection: "column" as const, gap: 7 },
    row: { display: "flex", alignItems: "center", gap: 8 },
    label: { width: 132, flexShrink: 0, color: "var(--c-t2, #333)" },
    input: { flex: 1, height: 22, padding: "0 22px 0 4px", border: "1px solid var(--c-b3, #aaa)", borderRadius: 2, fontSize: 12, textAlign: "right" as const, outline: "none", background: "#fff" },
    inputWrap: { position: "relative" as const, flex: 1, display: "flex" },
    unit: { position: "absolute" as const, right: 6, top: 4, fontSize: 11, color: "var(--c-t3, #777)", pointerEvents: "none" as const },
    select: { flex: 1, height: 22, padding: "0 4px", border: "1px solid var(--c-b3, #aaa)", borderRadius: 2, fontSize: 12, background: "#fff", outline: "none" },
    sectionTitle: { fontSize: 11, fontWeight: 600, color: "var(--c-t2, #444)", borderBottom: "1px solid #e5e5e5", paddingBottom: 3, marginTop: 4 },
    stats: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 10px", padding: "7px 9px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 3, fontSize: 11 },
    statLabel: { color: "var(--c-t3, #64748b)" },
    statVal: { fontWeight: 600, textAlign: "right" as const },
    verdict: { padding: "7px 9px", borderRadius: 3, fontSize: 11, lineHeight: 1.45, background: verdictBg, border: `1px solid ${verdictBorder}`, color: verdictColor },
    footer: { display: "flex", justifyContent: "flex-end", gap: 6, padding: "8px 14px 10px", background: "#f0f0f0", borderTop: "1px solid #ccc", position: "sticky" as const, bottom: 0 },
    btnOk: (on: boolean) => ({ height: 26, padding: "0 18px", fontSize: 12, background: on ? "var(--c-blue-bg, #2563eb)" : "#e5e5e5", color: on ? "#fff" : "#999", border: `1px solid ${on ? "var(--c-blue, #1d4ed8)" : "#ccc"}`, borderRadius: 2, cursor: on ? "pointer" : "default", fontWeight: 600 }),
    btnCancel: { height: 26, padding: "0 14px", fontSize: 12, background: "#f5f5f5", border: "1px solid var(--c-b3, #aaa)", borderRadius: 2, cursor: "pointer" },
    check: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11.5, color: "var(--c-t2, #333)" },
  };

  /** Поле ввода числа с единицей. Обычная функция, не компонент — иначе
      React пересоздавал бы поле на каждое нажатие и фокус слетал. */
  const field = (
    label: string, value: string, onChange: (v: string) => void,
    unit: string, title?: string, allowNeg = true,
  ) => (
    <div style={S.row} title={title}>
      <span style={S.label}>{label}</span>
      <div style={S.inputWrap}>
        <input
          type="text" value={value}
          onChange={(e) => {
            const v = e.target.value;
            const re = allowNeg ? /^-?\d*[.,]?\d*$/ : /^\d*[.,]?\d*$/;
            if (v === "" || re.test(v)) onChange(v);
          }}
          onFocus={(e) => e.target.select()}
          onBlur={() => { if (value === "" || value === "-") onChange("0"); }}
          style={S.input}
        />
        <span style={S.unit}>{unit}</span>
      </div>
    </div>
  );

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.dialog} onClick={(e) => e.stopPropagation()}>

        <div style={S.header}>
          <div style={S.headerTitle}>
            <Icon name="TrendingDown" size={14} style={{ color: "var(--c-blue, #2563eb)" }} />
            Наклонный съезд
          </div>
          <button style={S.closeBtn} onClick={onClose} title="Закрыть">✕</button>
        </div>

        <div style={S.tabs}>
          <button style={S.tab(tab === "ramp")} onClick={() => setTab("ramp")}>
            По нарисованной трассе
          </button>
          <button style={S.tab(tab === "spiral")} onClick={() => setTab("spiral")}>
            Спиральный съезд
          </button>
        </div>

        <div style={S.body}>

          {/* ═══ СЪЕЗД ПО ТРАССЕ ═══════════════════════════════════════ */}
          {tab === "ramp" && (
            <>
              {selectedBranchIds.length === 0 ? (
                <div style={{ ...S.verdict, background: "#fffbeb", borderColor: "#fcd34d", color: "#b45309" }}>
                  Не выделено ни одной выработки. Обведите трассу съезда по подложке
                  инструментом «Ветвь», затем выделите её (Ctrl+клик по выработкам)
                  и откройте это окно снова.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: "var(--c-t3, #64748b)" }}>
                    Выделено выработок: <b style={{ color: "var(--c-t1,#1a1a1a)" }}>{selectedBranchIds.length}</b>.
                    Отметки узлов будут разложены по трассе, X и Y не изменятся.
                  </div>

                  <div style={S.sectionTitle}>Отметки</div>
                  {field("Начало (Z), м", z0Text, setZ0Text, "м", "Высотная отметка первого узла трассы")}
                  {field("Конец (Z), м", z1Text, setZ1Text, "м", "Высотная отметка последнего узла трассы")}

                  <div style={S.sectionTitle}>Уклон</div>
                  <div style={S.row} title="Уклон, на котором транспорт работает постоянно">
                    <span style={S.label}>Рабочий угол</span>
                    <div style={S.inputWrap}>
                      <input type="number" min={1} max={30} step={0.5} value={workAngle}
                        onChange={(e) => setWorkAngle(Math.max(1, Math.min(30, Number(e.target.value) || 12)))}
                        style={S.input} />
                      <span style={S.unit}>°</span>
                    </div>
                  </div>
                  <div style={S.row} title="Предельный уклон — выше него съезд не строится">
                    <span style={S.label}>Предельный угол</span>
                    <div style={S.inputWrap}>
                      <input type="number" min={1} max={40} step={0.5} value={limitAngle}
                        onChange={(e) => setLimitAngle(Math.max(1, Math.min(40, Number(e.target.value) || 15)))}
                        style={S.input} />
                      <span style={S.unit}>°</span>
                    </div>
                  </div>

                  <div style={S.row}>
                    <span style={S.label}>Раскладка</span>
                    <select value={mode} onChange={(e) => setMode(e.target.value as RampMode)} style={S.select}>
                      <option value="even">Равномерный уклон по всей трассе</option>
                      <option value="maxSlope">Под рабочим углом, остаток горизонтально</option>
                    </select>
                  </div>

                  <label style={S.check}>
                    <input type="checkbox" checked={usePlatforms}
                      onChange={(e) => setUsePlatforms(e.target.checked)} />
                    Горизонтальные площадки (для разъезда и отдыха)
                  </label>
                  {usePlatforms && (
                    <>
                      {field("Через каждые", platEvery, setPlatEvery, "м",
                        "Расстояние между площадками по плановой длине", false)}
                      {field("Длина площадки", platLen, setPlatLen, "м",
                        "Площадки съедают длину — наклонные участки становятся круче", false)}
                    </>
                  )}

                  <label style={S.check} title="Узлы на сопряжениях со штреками сохранят отметку своего горизонта">
                    <input type="checkbox" checked={lockHorizon}
                      onChange={(e) => setLockHorizon(e.target.checked)} />
                    Не менять отметки узлов, привязанных к горизонту
                  </label>

                  {/* ── Предпросчёт ─────────────────────────────────── */}
                  {result && (
                    <>
                      <div style={S.sectionTitle}>Расчёт</div>
                      <div style={S.stats}>
                        <span style={S.statLabel}>Длина в плане</span>
                        <span style={S.statVal}>{result.planLength} м</span>
                        <span style={S.statLabel}>Длина по выработке</span>
                        <span style={S.statVal}>{result.length3d} м</span>
                        <span style={S.statLabel}>Перепад отметок</span>
                        <span style={S.statVal}>{result.drop} м</span>
                        <span style={S.statLabel}>Наибольший уклон</span>
                        <span style={{ ...S.statVal, color: verdictColor }}>
                          {result.maxAngle}° ({result.slopePermille}‰)
                        </span>
                        <span style={S.statLabel}>Нужно в плане (для {limitAngle}°)</span>
                        <span style={S.statVal}>{result.requiredPlanLength} м</span>
                      </div>
                      <div style={S.verdict}>
                        <b>
                          {result.status === "ok" ? "✓ В пределах нормы"
                            : result.status === "warn" ? "⚠ Выше рабочего уклона"
                            : "✗ Построить нельзя"}
                        </b>
                        <div style={{ marginTop: 3 }}>{result.message}</div>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ═══ СПИРАЛЬНЫЙ СЪЕЗД ═════════════════════════════════════ */}
          {tab === "spiral" && (
            <>
              <div style={{ fontSize: 11, color: "var(--c-t3, #64748b)", lineHeight: 1.45 }}>
                Когда прямой трассы не хватает по длине, съезд закручивают в спираль:
                на небольшой площади набирается любой перепад. Узлы и выработки будут
                созданы автоматически.
              </div>

              <div style={S.sectionTitle}>Отметки</div>
              {field("Начало (Z), м", z0Text, setZ0Text, "м")}
              {field("Конец (Z), м", z1Text, setZ1Text, "м")}

              <div style={S.sectionTitle}>Геометрия спирали</div>
              {field("Радиус", radius, setRadius, "м",
                "Радиус по оси выработки. Чем больше — тем меньше витков", false)}
              <div style={S.row} title="Уклон спирали">
                <span style={S.label}>Угол наклона</span>
                <div style={S.inputWrap}>
                  <input type="number" min={1} max={20} step={0.5} value={workAngle}
                    onChange={(e) => setWorkAngle(Math.max(1, Math.min(20, Number(e.target.value) || 12)))}
                    style={S.input} />
                  <span style={S.unit}>°</span>
                </div>
              </div>
              {field("Шаг по дуге", spiralStep, setSpiralStep, "°",
                "Меньше шаг — глаже спираль, но больше узлов", false)}
              <div style={S.row}>
                <span style={S.label}>Направление</span>
                <select value={clockwise ? "cw" : "ccw"}
                  onChange={(e) => setClockwise(e.target.value === "cw")} style={S.select}>
                  <option value="cw">По часовой стрелке</option>
                  <option value="ccw">Против часовой стрелки</option>
                </select>
              </div>

              {spiral && (
                <>
                  <div style={S.sectionTitle}>Расчёт</div>
                  <div style={S.stats}>
                    <span style={S.statLabel}>Витков</span>
                    <span style={S.statVal}>{spiral.turns.toFixed(2)}</span>
                    <span style={S.statLabel}>Набор высоты за виток</span>
                    <span style={S.statVal}>
                      {(2 * Math.PI * num(radius) * Math.tan((workAngle * Math.PI) / 180)).toFixed(1)} м
                    </span>
                    <span style={S.statLabel}>Длина по выработке</span>
                    <span style={S.statVal}>{spiral.length3d} м</span>
                    <span style={S.statLabel}>Уклон</span>
                    <span style={S.statVal}>{spiral.angle}° ({spiral.slopePermille}‰)</span>
                    <span style={S.statLabel}>Будет создано узлов</span>
                    <span style={S.statVal}>{spiral.points.length}</span>
                  </div>
                  <div style={{ ...S.verdict, background: "#f0fdf4", borderColor: "#86efac", color: "#15803d" }}>
                    {spiral.message}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div style={S.footer}>
          <button style={S.btnCancel} onClick={onClose}>Отмена</button>
          {tab === "ramp" ? (
            <button
              style={S.btnOk(canApplyRamp)}
              disabled={!canApplyRamp}
              onClick={() => { if (result && canApplyRamp) { onApply(result.nodes); onClose(); } }}>
              Построить съезд
            </button>
          ) : (
            <button
              style={S.btnOk(canBuildSpiral)}
              disabled={!canBuildSpiral}
              onClick={() => { if (spiral && canBuildSpiral) { onBuildSpiral(spiral.points); onClose(); } }}>
              Построить спираль
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
