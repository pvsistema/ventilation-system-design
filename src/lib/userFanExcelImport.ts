// ─────────────────────────────────────────────────────────────────────────────
// userFanExcelImport.ts — импорт своего вентилятора из Excel в формате
// «рабочая точка ГВУ» (тот же, что выгружает программа):
//
//   лист «Табличные данные»:
//     «Напорные характеристики» — пары столбцов Q / H, над парой подпись угла
//                                 («-10 °», «+20°», «0 °»);
//     «Рабочая точка»           — пропускается;
//     «Значения КПД»            — линии равного КПД («60%», «65%»…), пары Q / H.
//   лист «Табличные данные (реверс)» — то же для реверса (берётся 1-я кривая).
//
// КПД в образце задан не по углам, а линиями равного КПД. Каждая точка такой
// линии лежит на одной из кривых угла — по ней и определяется угол, а точка
// с известным КПД добавляется к характеристике этого угла.
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import type { FanCurve, UserFanPoint } from "@/lib/fanCurves";
import { fitQuadratic } from "@/lib/userFanFit";

type Grid = (string | number | null | undefined)[][];

interface Block { label: string; pts: { q: number; h: number }[] }

export interface UserFanImport {
  name: string;
  type?: FanCurve["type"];
  diameter?: number;
  rpmNominal?: number;
  angles: { angle: number; points: UserFanPoint[] }[];
  reverse?: UserFanPoint[];
  /** Что и откуда взято — для сообщения пользователю */
  notes: string[];
}

const toNum = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};
const isQ = (v: unknown) => typeof v === "string" && /^\s*q\b/i.test(v);
const isH = (v: unknown) => typeof v === "string" && /^\s*[hн]\b/i.test(v);   // H латиницей или Н кириллицей
const cellStr = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Строка, где столбцы — пары «Q | H». Возвращает номера столбцов Q. */
function qhCols(row: Grid[number] | undefined): number[] {
  if (!row) return [];
  const cols: number[] = [];
  for (let c = 0; c < row.length - 1; c++) if (isQ(row[c]) && isH(row[c + 1])) cols.push(c);
  return cols;
}

/** Блок кривых, начиная с заголовка «Q/H» в строке hr: подписи — строкой выше. */
function readBlocks(g: Grid, hr: number): Block[] {
  const labels = g[hr - 1] ?? [];
  return qhCols(g[hr]).map(c => {
    const pts: { q: number; h: number }[] = [];
    for (let r = hr + 1; r < g.length; r++) {
      const q = toNum(g[r]?.[c]), h = toNum(g[r]?.[c + 1]);
      if (!Number.isFinite(q) || !Number.isFinite(h)) {
        // Пустая строка — конец блока; текст (заголовок следующего блока) — тоже
        if (cellStr(g[r]?.[c]) === "" && cellStr(g[r]?.[c + 1]) === "" && pts.length === 0) continue;
        break;
      }
      pts.push({ q, h });
    }
    return { label: cellStr(labels[c]), pts };
  }).filter(b => b.pts.length > 0);
}

/** Первая строка «Q/H» после строки from (и до строки to). */
function findHeader(g: Grid, from: number, to = g.length): number {
  for (let r = Math.max(1, from); r < to; r++) if (qhCols(g[r]).length > 0) return r;
  return -1;
}

/** Строка, где встречается текст (заголовок блока). */
function findText(g: Grid, re: RegExp, from = 0): number {
  for (let r = from; r < g.length; r++) {
    if ((g[r] ?? []).some(v => typeof v === "string" && re.test(v))) return r;
  }
  return -1;
}

const angleOf = (label: string): number | null => {
  const m = label.replace(",", ".").match(/[-+−]?\s*\d+(?:\.\d+)?/);
  if (!m) return null;
  return parseFloat(m[0].replace(/\s/g, "").replace("−", "-"));
};

function readSheet(ws: XLSX.WorkSheet) {
  const g = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: null }) as Grid;
  const effRow = findText(g, /кпд/i);
  const opRow = findText(g, /рабоч[а-яё]*\s+точк/i);
  const headStart = findText(g, /напорн/i);
  const firstHdr = findHeader(g, headStart >= 0 ? headStart + 1 : 1,
    [opRow, effRow].filter(r => r > 0).reduce((a, b) => Math.min(a, b), g.length));
  const curves = firstHdr > 0 ? readBlocks(g, firstHdr) : [];
  let effs: Block[] = [];
  if (effRow >= 0) {
    const eh = findHeader(g, effRow + 1);
    if (eh > 0) effs = readBlocks(g, eh);
  }
  return { curves, effs };
}

/** Догадки о паспорте по названию: тип, Ø (ВЦ-25 → 2,5 м), обороты. */
function guessFromName(name: string) {
  const n = name.toUpperCase();
  const type: FanCurve["type"] | undefined =
    /ВМЭ|ВМЦ|ВМ-|ВМ\d|ВМП/.test(n) ? "vmp" : /ВЦ/.test(n) ? "centrifugal" : /ВО|ВОД|ВОКД|ВОКР/.test(n) ? "axial" : undefined;
  const d = n.match(/(?:ВЦД|ВЦ|ВОД|ВОКД|ВО|ВМЭ|ВМЦ|ВМ)[-\s]?(\d+(?:[.,]\d+)?)/);
  const diameter = d ? Math.round(parseFloat(d[1].replace(",", ".")) * 10) / 100 : undefined;
  const r = name.match(/(\d{3,4})\s*об/i);
  return { type, diameter, rpmNominal: r ? +r[1] : undefined };
}

/** Название из имени файла: «рабочая точка ГВУ-ВЦ-25 (1).xlsx» → «ГВУ-ВЦ-25». */
function nameFromFile(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/\(\d+\)\s*$/, "")
    .replace(/рабоч[а-яё]*\s+точк[а-яё]*/i, "")
    .replace(/_/g, "/")
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, "")
    .trim();
}

export async function importUserFanFromExcel(file: File): Promise<UserFanImport> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const notes: string[] = [];

  const withData = wb.SheetNames.map(n => ({ n, d: readSheet(wb.Sheets[n]) })).filter(x => x.d.curves.length > 0);
  if (withData.length === 0) {
    throw new Error("В файле не найдены напорные характеристики: нужны пары столбцов «Q» и «H» с подписью угла над каждой парой.");
  }
  const isRev = (n: string) => /реверс/i.test(n);
  const fwd = withData.find(x => !isRev(x.n) && /табличн/i.test(x.n)) ?? withData.find(x => !isRev(x.n)) ?? withData[0];
  const rev = withData.find(x => x !== fwd && isRev(x.n));

  // ── Углы ──────────────────────────────────────────────────────────────
  const used = new Set<number>();
  const angles = fwd.d.curves.map((b, i) => {
    let a = angleOf(b.label);
    if (a === null || used.has(a)) {
      a = i * 5;
      notes.push(`У кривой «${b.label || `№${i + 1}`}» не распознан угол — поставлен ${a}°, проверьте.`);
    }
    used.add(a);
    return { angle: a, points: b.pts.map(p => ({ q: p.q, h: p.h } as UserFanPoint)) };
  });
  notes.push(`Лист «${fwd.n}»: ${angles.length} характеристик (${angles.map(a => `${a.angle}°`).join(", ")}).`);

  // ── КПД по линиям равного КПД ─────────────────────────────────────────
  if (fwd.d.effs.length > 0) {
    // Кривая каждого угла — по точкам файла, чтобы найти, на какой лежит точка КПД
    const fits = angles.map(a => {
      const f = fitQuadratic(a.points.map(p => ({ x: p.q, y: p.h })));
      const qs = a.points.map(p => p.q);
      return { a, f, qMin: Math.min(...qs), qMax: Math.max(...qs) };
    });
    let added = 0;
    for (const e of fwd.d.effs) {
      let eta = toNum(e.label.replace("%", ""));
      if (!Number.isFinite(eta)) continue;
      // В окне ввода КПД в процентах; ячейка-доля (0,6) → 60
      if (eta <= 1) eta *= 100;
      for (const p of e.pts) {
        let best: { a: typeof angles[number]; err: number; h: number } | null = null;
        for (const ft of fits) {
          if (!ft.f) continue;
          // Только внутри паспортной зоны угла — точки КПД не должны её расширять
          if (p.q < ft.qMin || p.q > ft.qMax) continue;
          const h = ft.f.a + ft.f.b * p.q + ft.f.c * p.q * p.q;
          const err = Math.abs(h - p.h) / Math.max(1, Math.abs(p.h));
          if (!best || err < best.err) best = { a: ft.a, err, h };
        }
        // Точка КПД должна лежать на кривой угла (с запасом 8 %)
        if (best && best.err < 0.08) {
          best.a.points.push({ q: p.q, h: Math.round(best.h * 10) / 10, eta });
          added++;
        }
      }
    }
    if (added > 0) notes.push(`КПД: ${added} точек с линий равного КПД (${fwd.d.effs.map(e => e.label).join(", ")}) привязаны к кривым углов.`);
    else notes.push("Линии КПД не совпали с кривыми углов — КПД будет оценён автоматически.");
  } else {
    notes.push("Значений КПД в файле нет — КПД будет оценён автоматически (лучше ввести с паспорта).");
  }
  angles.forEach(a => a.points.sort((x, y) => x.q - y.q));

  // ── Реверс ────────────────────────────────────────────────────────────
  let reverse: UserFanPoint[] | undefined;
  if (rev && rev.d.curves[0]) {
    reverse = rev.d.curves[0].pts.map(p => ({ q: p.q, h: p.h }));
    notes.push(`Реверс — лист «${rev.n}» (${reverse.length} точек).`);
  }

  const name = nameFromFile(file.name);
  return { name, ...guessFromName(name), angles, reverse, notes };
}
