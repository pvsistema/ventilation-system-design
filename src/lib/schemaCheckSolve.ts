// ─────────────────────────────────────────────────────────────────────────────
// Проверка схемы: РЕЗУЛЬТАТЫ РАСЧЁТА ВОЗДУХОРАСПРЕДЕЛЕНИЯ.
//
// Имеет смысл только после расчёта сети (F9): берёт расходы и скорости,
// записанные расчётом в ветви, и сравнивает с нормами ФНиП (п. 155 и далее)
// из справочника норм проекта. Аналог «Отчёта по нарушениям» АэроСети и
// «Velocity / Fan operating point warnings» Ventsim.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoBranch } from "./topology";
import { getFanById, bladeAngleFactor } from "./fanCurves";
import { calcFaceDemand } from "./airDemand";
import type { VentNorms, VentSection } from "./ventSections";
import { type BranchNote, pushCapped, fmtNum } from "./schemaCheckTypes";
import type { BranchBulkheadInfo } from "./branchBulkheadInfo";

export interface SolveCheckResult {
  /** Расчёт выполнялся — иначе все списки пусты и проверка не имеет смысла. */
  solved: boolean;
  /** Скорость выше допустимой. */
  highVelocity: BranchNote[];
  /** Скорость ниже минимальной (застой). */
  lowVelocity: BranchNote[];
  /** Вентилятор работает против потока (опрокидывание). */
  fanAgainstFlow: BranchNote[];
  /** Рабочая точка вентилятора вне паспортной характеристики. */
  fanOutOfRange: BranchNote[];
  /** Риск рециркуляции у ВМП. */
  recirculation: BranchNote[];
  /** Забой получает меньше требуемого. */
  faceDeficit: BranchNote[];
  /** Утечки через перемычки больше порога — одно сообщение с итогом. */
  leakage: { percent: number; leakFlow: number; fanFlow: number; branches: BranchNote[]; windowFlow: number } | null;
  truncated: boolean;
}

export interface SolveCheckOptions {
  /** Доля подачи ВМП от расхода в выработке, выше которой — рециркуляция (ФНиП: 0,7) */
  recircShare?: number;
  /** Доля утечек через перемычки от подачи ГВУ, выше которой — предупреждение */
  leakShare?: number;
  /** Расход ниже этого (м³/с) считается «нет потока» */
  zeroFlow?: number;
  /**
   * Вентсооружения ветвей (значки + вкладка ветви) с сопротивлением, которое
   * реально уходит в решатель. Без неё утечки считались по одному флагу
   * hasBulkhead — без учёта значков и заданного вручную R.
   */
  bulkheads?: Map<string, BranchBulkheadInfo>;
}

const FACE_TYPES = new Set(["stoping", "development", "deadend"]);

export function checkSolve(
  branches: TopoBranch[],
  solved: boolean,
  norms: VentNorms,
  sections: VentSection[],
  opts: SolveCheckOptions = {},
): SolveCheckResult {
  const empty: SolveCheckResult = {
    solved, highVelocity: [], lowVelocity: [], fanAgainstFlow: [], fanOutOfRange: [],
    recirculation: [], faceDeficit: [], leakage: null, truncated: false,
  };
  if (!solved) return empty;

  const recircShare = opts.recircShare ?? 0.7;
  const leakShare = opts.leakShare ?? 0.3;
  const zeroQ = opts.zeroFlow ?? 0.01;
  let truncated = false;
  const push = <T,>(arr: T[], item: T) => { if (!pushCapped(arr, item)) truncated = true; };
  const r = empty;
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  // Приток воздуха к узлу по обычным выработкам (для оценки рециркуляции ВМП).
  const inflow = new Map<string, number>();
  for (const b of branches) {
    if (b.hasFan || b.isVentPipeBranch || b.isLeakage) continue;
    const q = b.flow ?? 0;
    if (q > zeroQ) inflow.set(b.toId, (inflow.get(b.toId) ?? 0) + q);
    else if (q < -zeroQ) inflow.set(b.fromId, (inflow.get(b.fromId) ?? 0) - q);
  }

  // Узлы, к которым примыкает хотя бы одна обычная выработка.
  const minedNodes = new Set<string>();
  // Ветви нити вентрубопровода по узлам (для прохода вверх по ставу).
  const pipeByNode = new Map<string, TopoBranch[]>();
  for (const b of branches) {
    if (b.isVentPipeBranch) {
      for (const id of [b.fromId, b.toId]) {
        const arr = pipeByNode.get(id);
        if (arr) arr.push(b); else pipeByNode.set(id, [b]);
      }
    } else if (!b.isLeakage) {
      minedNodes.add(b.fromId);
      minedNodes.add(b.toId);
    }
  }

  // ВМП на нити трубопровода всасывает из узла-дубликата, у которого нет
  // выработок. Идём по ставу против потока до узла примыкания к выработке —
  // там и оцениваем, сколько воздуха подходит к ВМП.
  const findIntakeJunction = (startId: string): string => {
    let cur = startId;
    const seen = new Set<string>([cur]);
    for (let i = 0; i < 10000 && !minedNodes.has(cur); i++) {
      let next: string | null = null;
      for (const pb of pipeByNode.get(cur) ?? []) {
        const pq = pb.flow ?? 0;
        const up = pb.toId === cur && pq > zeroQ ? pb.fromId
          : pb.fromId === cur && pq < -zeroQ ? pb.toId : null;
        if (up && !seen.has(up)) { next = up; break; }
      }
      if (!next) break;
      seen.add(next);
      cur = next;
    }
    return cur;
  };

  let fanFlow = 0, leakFlow = 0, windowFlow = 0;
  const leakList: BranchNote[] = [];

  for (const b of branches) {
    const q = b.flow ?? 0;
    const aq = Math.abs(q);
    const v = Math.abs(b.velocity ?? 0);
    const bk = opts.bulkheads?.get(b.id);
    const hasBk = bk ? bk.present : b.hasBulkhead;
    const aux = !!b.isVentPipeBranch || b.isLeakage || hasBk;

    // ── Скорости ──────────────────────────────────────────────────────────
    if (!aux && b.area > 0) {
      const isShaft = /ств/i.test(b.type || "");
      const vMax = Math.min(b.vMax > 0 ? b.vMax : Infinity, isShaft ? norms.vMaxShaft : norms.vMaxDrift);
      if (Number.isFinite(vMax) && v > vMax * 1.001) {
        push(r.highVelocity, { branch: b, note: `V = ${fmtNum(v, 2)} м/с при пределе ${fmtNum(vMax, 1)} м/с` });
      }
      if (!b.isDead) {
        const vMin = FACE_TYPES.has(b.ventFaceType ?? "") ? norms.vMinFace : norms.vMinOther;
        if (v < vMin * 0.999) {
          push(r.lowVelocity, {
            branch: b,
            note: aq < zeroQ ? "Воздух не движется (Q ≈ 0)" : `V = ${fmtNum(v, 2)} м/с при норме ${fmtNum(vMin, 2)} м/с`,
          });
        }
      }
    }

    // ── Вентиляторы ───────────────────────────────────────────────────────
    if (b.hasFan && !b.fanStopped) {
      const isVmp = b.fanType === "ВМП";
      const dir = isVmp ? 1 : (b.fanReverse ? -1 : 1);
      if (q * dir < -zeroQ) {
        push(r.fanAgainstFlow, { branch: b, note: `${b.fanType} ${b.fanName || ""}: воздух идёт против вентилятора (${fmtNum(q, 2)} м³/с)`.replace(/\s+/g, " ") });
      } else if (b.fanType === "ГВУ" || b.fanType === "ВВУ") {
        fanFlow += aq;
      }

      const curve = b.fanMode === "curve" ? getFanById(b.fanCurveId) : undefined;
      if (curve && aq > zeroQ) {
        const n = Math.max(1, b.fanParallel || 1);
        const k = curve.rpmNominal > 0 && b.fanRpm > 0 ? b.fanRpm / curve.rpmNominal : 1;
        const af = bladeAngleFactor(curve, b.fanBladeAngle);
        const qOne = aq / n;
        const qMin = curve.qMin * af * k, qMax = curve.qMax * af * k;
        if (qOne > qMax * 1.02) {
          push(r.fanOutOfRange, { branch: b, note: `${curve.name}: ${fmtNum(qOne, 1)} м³/с — правее паспортной зоны (до ${fmtNum(qMax, 1)})` });
        } else if (qOne < qMin * 0.98) {
          push(r.fanOutOfRange, { branch: b, note: `${curve.name}: ${fmtNum(qOne, 1)} м³/с — левее паспортной зоны (от ${fmtNum(qMin, 1)}), возможен помпаж` });
        }
      }

      // Рециркуляция ВМП: вентилятор забирает больше допустимой доли воздуха,
      // приходящего к нему по выработке (ФНиП: не более 70 %).
      if (isVmp && aq > zeroQ) {
        const intake = findIntakeJunction(q >= 0 ? b.fromId : b.toId);
        const avail = inflow.get(intake) ?? 0;
        if (avail <= zeroQ || aq > avail * recircShare) {
          push(r.recirculation, {
            branch: b,
            note: avail <= zeroQ
              ? `ВМП ${fmtNum(aq, 2)} м³/с, а свежий воздух к нему не подходит`
              : `ВМП ${fmtNum(aq, 2)} м³/с — ${fmtNum((aq / avail) * 100, 0)} % от ${fmtNum(avail, 2)} м³/с в выработке (допустимо ${fmtNum(recircShare * 100, 0)} %)`,
          });
        }
      }
    }

    // ── Утечки через перемычки ────────────────────────────────────────────
    // Утечка — это воздух, прошедший через ЗАКРЫТОЕ сооружение (глухую
    // перемычку, закрытую дверь). Не считаются утечкой:
    //   • ветвь с вентилятором — через ГВУ/ВМП идёт подача, а «перемычка» на
    //     ней — это обвязка вентилятора (раньше ГВУ целиком попадала в утечки);
    //   • регулируемое окно/проём — через него воздух пропускают намеренно;
    //   • открытая дверь.
    // Сопротивление берётся тем же расчётом, что уходит в решатель, в т.ч.
    // заданное вручную в значке.
    if (hasBk && aq > zeroQ && !b.hasFan && !b.isVentPipeBranch) {
      const name = bk?.name ?? (b.bulkheadName || "Перемычка");
      const rTxt = bk ? ` · R ${fmtNum(bk.rKmu, bk.rKmu < 10 ? 2 : 0)} кМюрг (${bk.modeLabel})` : "";
      if (bk?.allOpen || bk?.hasWindow) {
        windowFlow += aq;
      } else {
        leakFlow += aq;
        leakList.push({ branch: b, note: `${name}: ${fmtNum(aq, 2)} м³/с${rTxt}` });
      }
    }

    // ── Забои: расход меньше требуемого ───────────────────────────────────
    const ft = b.ventFaceType ?? "none";
    if (ft && ft !== "none") {
      const d = calcFaceDemand(b, norms, sectionById.get(b.ventSectionId ?? "") ?? null);
      if (d.total > 0 && !d.flowOk) {
        push(r.faceDeficit, { branch: b, note: `Нужно ${fmtNum(d.total, 2)} м³/с, поступает ${fmtNum(d.actualFlow, 2)} м³/с` });
      }
    }
  }

  if (fanFlow > zeroQ && leakFlow > fanFlow * leakShare) {
    leakList.sort((a, b) => Math.abs(b.branch.flow) - Math.abs(a.branch.flow));
    r.leakage = { percent: (leakFlow / fanFlow) * 100, leakFlow, fanFlow, branches: leakList.slice(0, 500), windowFlow };
  }

  r.highVelocity.sort((a, b) => Math.abs(b.branch.velocity) - Math.abs(a.branch.velocity));
  r.truncated = truncated;
  return r;
}