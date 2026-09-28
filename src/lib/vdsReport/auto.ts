// ─────────────────────────────────────────────────────────────────────────────
// Отчёт ВДС — автозаполнение раздела 1 и параметров ВДС по модели сети.
//
// Раздел 1 (техническое задание) и раздел 2 (полевые работы) строятся из ОДНОЙ
// модели: всё, что можно определить по схеме (горизонты, главные выработки,
// вскрывающие выработки, схема проветривания, ГВУ, забои, люди, климат),
// подставляется автоматически. Пользователь вводит только то, чего в модели нет
// (реквизиты, геология), и может переопределить любое автозначение.
// Пустое поле формы = берётся автозначение.
// ─────────────────────────────────────────────────────────────────────────────
import type { Horizon, TopoBranch, TopoNode } from "@/lib/topology";
import { getFanById } from "@/lib/fanCurves";
import type { KeyValueRow, VdsGvuInput, VdsReportForm } from "./types";

export interface VdsEnv {
  horizons?: Horizon[];
  /** Температура на поверхности из параметров проекта, °C */
  surfaceTemp?: number;
  /** Барометрическое давление на поверхности из параметров проекта, кПа */
  surfacePressureKPa?: number;
}

/** Текстовые поля, для которых есть автозначение по модели */
export type AutoTextKey =
  | "horizons" | "supportType" | "activeFaces" | "maxPerShift" | "openingScheme"
  | "ventilationScheme" | "annotation" | "surveyPeriod" | "tSurvey" | "pSurvey" | "tExhaust";

export interface VdsAuto {
  text: Partial<Record<AutoTextKey, string>>;
  mainWorkings: KeyValueRow[];
  gvu: Record<string, Omit<VdsGvuInput, "branchId">>;
}

const MONTHS_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];

const cleanName = (b: TopoBranch) => String(b.type ?? "").replace(/^"(.*)"$/, "$1").trim();
const fx = (v: number, d = 1) => v.toFixed(d).replace(".", ",");

/** Кв по наименованию выработки, где стоит ГВУ (Метод. рекомендации) */
export function guessKv(name: string): number {
  const s = name.toLowerCase();
  if (s.includes("скип")) return 1.2;
  if (s.includes("клет") || s.includes("штольн")) return 1.15;
  if (s.includes("шурф") || s.includes("восст") || s.includes("скваж")) return 1.05;
  if (s.includes("ствол")) return 1.1;
  return 1.05;
}

export function buildVdsAuto(branches: TopoBranch[], nodes: TopoNode[], env: VdsEnv, surveyDate: string): VdsAuto {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const atm = new Set(nodes.filter(n => n.atmosphereLink).map(n => n.id));
  const real = branches.filter(b => !b.isVentPipeBranch && !b.isLeakage);
  const text: VdsAuto["text"] = {};

  // ── Горизонты ──
  const hzUsed = new Set(real.map(b => b.horizonId).filter(Boolean));
  const hz = (env.horizons ?? []).filter(h => h.id !== "H_OVERVIEW" && (hzUsed.size === 0 || hzUsed.has(h.id)));
  if (hz.length) {
    text.horizons = `${hz.length} (${[...hz].sort((a, b) => b.z - a.z).map(h => h.name || `гор. ${h.z} м`).join(", ")})`;
  }
  const hzName = (b: TopoBranch) => env.horizons?.find(h => h.id === b.horizonId)?.name ?? "";

  // ── Преобладающая крепь (по суммарной длине) ──
  const bySurface = new Map<string, number>();
  for (const b of real) if (b.surface) bySurface.set(b.surface, (bySurface.get(b.surface) ?? 0) + (b.length ?? 0));
  const topSurf = [...bySurface.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topSurf) text.supportType = topSurf[0];

  // ── Забои и люди ──
  const faces = real.filter(b => b.ventFaceType && b.ventFaceType !== "none" && b.ventFaceType !== "chamber");
  if (faces.length) text.activeFaces = String(faces.length);
  const people = real.reduce((s, b) => s + (b.ventFaceType && b.ventFaceType !== "none" ? (b.ventPeopleCount ?? 0) : 0), 0);
  if (people > 0) text.maxPerShift = String(people);

  // ── Выработки, связанные с поверхностью ──
  const surfaceWorkings = real.filter(b => atm.has(b.fromId) || atm.has(b.toId));
  const inflowOf = (b: TopoBranch) => {
    const q = b.flow ?? 0;
    return (atm.has(b.fromId) && q > 0) || (atm.has(b.toId) && q < 0);
  };
  const intake = surfaceWorkings.filter(b => !b.hasFan && inflowOf(b) && Math.abs(b.flow ?? 0) > 1e-6);
  const exhaust = surfaceWorkings.filter(b => b.hasFan || (!inflowOf(b) && Math.abs(b.flow ?? 0) > 1e-6));
  const listNames = (arr: TopoBranch[]) => [...new Set(arr.map(cleanName).filter(Boolean))];

  if (surfaceWorkings.length) {
    const names = listNames(surfaceWorkings);
    text.openingScheme = `Месторождение вскрыто выработками, имеющими выход на поверхность: ${names.join(", ")}.`;
  }

  // ── ГВУ ──
  const gvuBr = real.filter(b => b.hasFan && b.fanType === "ГВУ" && !b.fanStopped);
  const gvu: VdsAuto["gvu"] = {};
  for (const b of gvuBr) {
    // Вентилятор, который выбрасывает воздух в атмосферу, — всасывающий
    const outToAtm = ((b.flow ?? 0) >= 0 ? atm.has(b.toId) : atm.has(b.fromId)) || (!atm.has(b.fromId) && !atm.has(b.toId) && !inflowOf(b));
    const nm = cleanName(b);
    // Ближайшая выработка к ГВУ (ствол/шурф) — для Кв
    const adj = real.find(x => x.id !== b.id && (x.fromId === b.fromId || x.toId === b.toId || x.fromId === b.toId || x.toId === b.fromId) && !x.hasFan);
    gvu[b.id] = {
      place: nm || (adj ? cleanName(adj) : "") || "ГВУ",
      kv: guessKv(`${nm} ${adj ? cleanName(adj) : ""}`),
      channelArea: b.area ? fx(b.area, 1) : "",
      extLeakFact: "",
      mode: outToAtm ? "Всасывающий" : "Нагнетательный",
    };
  }

  // ── Схема проветривания (текст из модели) ──
  const vent: string[] = [];
  if (gvuBr.length) {
    const modes = new Set(Object.values(gvu).map(g => g.mode));
    const schemeKind = gvuBr.length > 1 ? "с несколькими главными вентиляторными установками" : "с одной главной вентиляторной установкой";
    vent.push(`Проветривание рудника осуществляется по ${[...modes].map(m => m === "Всасывающий" ? "всасывающему" : "нагнетательному").join(" и ")} способу ${schemeKind}.`);
    for (const b of gvuBr) {
      const curve = b.fanCurveId ? getFanById(b.fanCurveId) : undefined;
      const model = curve?.name || b.fanName || "ГВУ";
      const q = Math.abs(b.flow ?? 0), h = Math.abs(b.fanPressure ?? 0) / 10;
      vent.push(`${gvu[b.id].place}: вентилятор ${model}${b.fanParallel > 1 ? ` (${b.fanParallel} шт. в параллель)` : ""}` +
        (q > 0 ? `, подача ${fx(q)} м³/с (${fx(q * 60, 0)} м³/мин), депрессия ${fx(h)} даПа` : "") + ".");
    }
  }
  const inN = listNames(intake), exN = listNames(exhaust.filter(b => !b.hasFan));
  if (inN.length) vent.push(`Свежий воздух поступает в рудник по выработкам: ${inN.join(", ")}.`);
  if (exN.length || gvuBr.length) vent.push(`Исходящая струя выдаётся на поверхность по выработкам: ${[...exN, ...listNames(gvuBr)].filter((v, i, a) => a.indexOf(v) === i).join(", ")}.`);
  const dead = real.filter(b => b.hasVentPipe);
  if (dead.length) vent.push(`Тупиковые выработки (${dead.length}) проветриваются вентиляторами местного проветривания по вентиляционным трубопроводам.`);
  if (vent.length) text.ventilationScheme = vent.join("\n");
  if (vent.length) text.annotation = vent[0];

  // ── Главные выработки (Таблица 1): связанные с поверхностью + капитальные ──
  const main = [...surfaceWorkings, ...real.filter(b => b.capital && !surfaceWorkings.includes(b))]
    .filter(b => !b.hasFan && cleanName(b));
  const agg = new Map<string, { S: number; L: number; hz: Set<string> }>();
  for (const b of main) {
    const k = cleanName(b);
    const a = agg.get(k) ?? { S: 0, L: 0, hz: new Set<string>() };
    a.S = Math.max(a.S, b.area ?? 0);
    a.L += b.length ?? 0;
    const h = hzName(b); if (h) a.hz.add(h);
    agg.set(k, a);
  }
  const mainWorkings = [...agg.entries()].slice(0, 30).map(([name, a]) => ({
    name,
    value: [a.hz.size ? [...a.hz].join(", ") : "", a.S > 0 ? `S = ${fx(a.S)} м²` : "", a.L > 0 ? `L = ${fx(a.L, 0)} м` : ""].filter(Boolean).join("; "),
  }));

  // ── Период и климат ──
  const d = surveyDate ? new Date(surveyDate) : null;
  if (d && !isNaN(d.getTime())) text.surveyPeriod = `${MONTHS_PREP[d.getMonth()]} ${d.getFullYear()} года`;
  if (env.surfaceTemp != null && Number.isFinite(env.surfaceTemp)) text.tSurvey = String(env.surfaceTemp);
  if (env.surfacePressureKPa && env.surfacePressureKPa > 0) text.pSurvey = String(Math.round(env.surfacePressureKPa * 1000 / 133.322));
  // Температура исходящей струи — средняя по узлам выработок, выдающих струю
  const exNodes = exhaust.flatMap(b => [b.fromId, b.toId]).filter(id => !atm.has(id)).map(id => nodeById.get(id)).filter(Boolean) as TopoNode[];
  if (exNodes.length) {
    const t = exNodes.reduce((s, n) => s + (n.computedAirTemp ?? n.airTemp ?? 0), 0) / exNodes.length;
    if (Number.isFinite(t)) text.tExhaust = fx(t, 1).replace(",", ".");
  }

  return { text, mainWorkings, gvu };
}

/**
 * Итоговые данные отчёта: пустые поля формы заменяются автозначениями.
 * Именно эта форма уходит и в расчёт (разделы 2–4), и в Word (раздел 1),
 * поэтому обе части всегда согласованы.
 */
export function resolveVdsForm(form: VdsReportForm, auto: VdsAuto): VdsReportForm {
  const out: VdsReportForm = { ...form };
  for (const [k, v] of Object.entries(auto.text) as [AutoTextKey, string][]) {
    if (!String(out[k] ?? "").trim() && v) (out[k] as string) = v;
  }
  const userMain = form.mainWorkings.filter(x => x.name.trim());
  out.mainWorkings = userMain.length ? userMain : auto.mainWorkings;
  const byId = new Map(form.gvu.map(g => [g.branchId, g]));
  out.gvu = Object.entries(auto.gvu).map(([branchId, a]) => {
    const u = byId.get(branchId);
    return {
      branchId,
      place: u?.place?.trim() || a.place,
      kv: u?.kv ?? a.kv,
      channelArea: u?.channelArea?.trim() || a.channelArea,
      extLeakFact: u?.extLeakFact ?? "",
      mode: u?.mode || a.mode,
    };
  });
  return out;
}

// ── Реквизиты организации, проводящей ВДС: общие для всех проектов ─────────
const ORG_LS = "pvs_vds_org_profile";
export const ORG_KEYS = [
  "surveyOrgParent", "surveyOrg", "approverTitle", "approverName",
  "performerTitle", "performerName", "city", "surveyTeam", "instruments",
] as const;
type OrgKey = typeof ORG_KEYS[number];

export function loadOrgProfile(): Partial<Pick<VdsReportForm, OrgKey>> {
  try { return JSON.parse(localStorage.getItem(ORG_LS) || "{}"); } catch { return {}; }
}
export function saveOrgProfile(form: VdsReportForm) {
  const p: Record<string, unknown> = {};
  for (const k of ORG_KEYS) p[k] = form[k];
  try { localStorage.setItem(ORG_LS, JSON.stringify(p)); } catch { /* ignore */ }
}
