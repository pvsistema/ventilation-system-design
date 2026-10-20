// ─────────────────────────────────────────────────────────────────────────────
// ventChannelExcel.ts — выгрузка расчёта вентиляционного канала ГВУ в Excel.
// Лист 1 «Расчёт»   — исходные данные, маршрут канала, результаты, проверки,
//                     экономика.
// Лист 2 «Методика» — формулы и порядок расчёта, чтобы результат был
//                     проверяемым.
// ─────────────────────────────────────────────────────────────────────────────

export interface VentChannelRouteRow {
  name: string;
  nodes: string;
  length: number;
  area: number;
  angle: number;
  rWork: number;
  rFull: number;
  vWork: number;
  vDesign: number;
  hWork: number;
  isFan: boolean;
  isNarrow: boolean;
}

export interface VentChannelReport {
  projectName: string;
  fanLabel: string;
  fanModel: string;
  parallel: number;
  angleNow: string;
  angleBest: string;
  rpm: number;
  qManual: boolean;
  kLossPct: number;
  tariff: number;
  hours: number;

  qNom: number; hNom: number; etaMax: number;
  qMaxNow: number; qMaxPassportBest: number;
  qNow: number; hNow: number; etaNow: number; rNet: number;
  ratio: number; zoneOk: boolean | null; etaOk: boolean | null; stallOk: boolean | null; hStall: number;

  qDesign: number; hDesign: number; etaDesign: number;
  sRec: number; dEq: number; sRecNote: string;
  qMaxNet: number; hMaxNet: number; sRecTop: number; dEqTop: number; sRecTopNote: string;
  sFact: number; narrowName: string; okSection: boolean | null; okTop: boolean | null;
  qRecFact: number; qRecFactBy: string;

  totalL: number; totalR: number; rFixed: number;
  hFactWork: number; pctWork: number; hFactDesign: number; hRecDesign: number;
  vWork: number; vDesign: number; hSk: number;

  pFact: number; pRec: number; eFact: number; eRec: number;
  costFact: number; costRec: number; saving: number; savingRub: number;

  route: VentChannelRouteRow[];
  routeChain: boolean;
  startNode: string; endNode: string; startKind: string; endKind: string;
  warnings: string[];
}

const BORDER = {
  top: { style: "thin" as const, color: { argb: "FFD1D5DB" } },
  left: { style: "thin" as const, color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin" as const, color: { argb: "FFD1D5DB" } },
  right: { style: "thin" as const, color: { argb: "FFD1D5DB" } },
};
const ACCENT = "FF1E5A7A";
const TINT = "FFEEF5F8";

const okTxt = (v: boolean | null, good = "соответствует", bad = "не соответствует") =>
  v === null ? "—" : v ? good : bad;

export async function exportVentChannelXlsx(r: VentChannelReport): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.default.Workbook();
  wb.creator = "ПВ-Система";
  wb.created = new Date();

  // ═══════════════════════ Лист «Расчёт» ═══════════════════════
  const ws = wb.addWorksheet("Расчёт", { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 5 }, { width: 30 }, { width: 13 }, { width: 9 }, { width: 9 },
    { width: 8 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 12 },
  ];
  const LAST = "K";
  let row = 1;

  const title = (text: string, sub?: string) => {
    ws.mergeCells(`A${row}:${LAST}${row}`);
    const c = ws.getCell(`A${row}`);
    c.value = text;
    c.font = { name: "Arial", size: 14, bold: true, color: { argb: ACCENT } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } };
    ws.getRow(row).height = 28;
    row++;
    if (sub) {
      ws.mergeCells(`A${row}:${LAST}${row}`);
      const s = ws.getCell(`A${row}`);
      s.value = sub;
      s.font = { name: "Arial", size: 9, color: { argb: "FF475569" } };
      s.alignment = { horizontal: "center" };
      row++;
    }
    row++;
  };

  const section = (text: string) => {
    ws.mergeCells(`A${row}:${LAST}${row}`);
    const c = ws.getCell(`A${row}`);
    c.value = text.toUpperCase();
    c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    c.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(row).height = 18;
    row++;
  };

  // Строка «параметр — обозначение — значение — ед. — примечание»
  const kv = (label: string, sym: string, value: number | string | null, unit = "", note = "", digits = 2, strong = false) => {
    ws.mergeCells(`A${row}:B${row}`);
    const a = ws.getCell(`A${row}`);
    a.value = label;
    a.font = { name: "Arial", size: 9, bold: strong };
    a.alignment = { vertical: "middle", wrapText: true, indent: 1 };
    const s = ws.getCell(`C${row}`);
    s.value = sym;
    s.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF64748B" } };
    s.alignment = { horizontal: "center", vertical: "middle" };
    ws.mergeCells(`D${row}:E${row}`);
    const v = ws.getCell(`D${row}`);
    if (typeof value === "number" && Number.isFinite(value)) {
      v.value = value;
      v.numFmt = digits === 0 ? "# ##0" : `0.${"0".repeat(digits)}`;
    } else v.value = value == null || value === "" ? "—" : value;
    v.font = { name: "Arial", size: 9, bold: true, color: { argb: strong ? ACCENT : "FF111827" } };
    v.alignment = { horizontal: "right", vertical: "middle" };
    const u = ws.getCell(`F${row}`);
    u.value = unit;
    u.font = { name: "Arial", size: 9, color: { argb: "FF64748B" } };
    u.alignment = { vertical: "middle" };
    ws.mergeCells(`G${row}:${LAST}${row}`);
    const nn = ws.getCell(`G${row}`);
    nn.value = note;
    nn.font = { name: "Arial", size: 8, color: { argb: "FF64748B" } };
    nn.alignment = { vertical: "middle", wrapText: true };
    for (const col of ["A", "C", "D", "F", "G"]) ws.getCell(`${col}${row}`).border = BORDER;
    if (note.length > 70) ws.getRow(row).height = 24;
    row++;
  };

  const date = new Date().toLocaleDateString("ru-RU");
  title("РАСЧЁТ ВЕНТИЛЯЦИОННОГО КАНАЛА ГВУ", `${r.projectName || "Проект"}  |  ${date}  |  ${r.fanLabel}`);

  section("1. Исходные данные");
  kv("Вентилятор (модель)", "", `${r.fanModel}${r.parallel > 1 ? ` × ${r.parallel} в параллель` : ""}`);
  kv("Угол лопаток: текущий / наибольшей производительности", "θ", `${r.angleNow} / ${r.angleBest}`);
  if (r.rpm > 0) kv("Частота вращения", "n", r.rpm, "об/мин", "", 0);
  kv("Расчётный расход", "Q расч", r.qDesign, "м³/с", r.qManual ? "задан вручную" : "рабочая точка по расчёту сети");
  kv("Допустимые потери в канале", "k", r.kLossPct, "% H", "доля напора вентилятора, теряемая в канале", 1);
  kv("Тариф на электроэнергию", "Ц", r.tariff, "руб/кВт·ч");
  kv("Время работы в год", "T", r.hours, "ч/год", "", 0);
  row++;

  section("2. Характеристики вентилятора и сети");
  kv("Номинальная подача (η = max) при текущем угле", "Q ном", r.qNom, "м³/с");
  kv("Напор в номинальной точке", "H ном", r.hNom, "Па", "", 0);
  kv("Максимальный КПД", "η max", r.etaMax * 100, "%", "", 0);
  kv("Паспортная макс. подача при текущем угле", "Q max", r.qMaxNow, "м³/с");
  kv(`Паспортная макс. подача при угле ${r.angleBest}`, "Q max", r.qMaxPassportBest, "м³/с");
  kv("Рабочая точка по расчёту сети: подача", "Q раб", r.qNow, "м³/с");
  kv("Рабочая точка по расчёту сети: напор", "H раб", r.hNow, "Па", "", 0);
  kv("Сопротивление рудника (характеристика сети)", "R сети", r.rNet, "Н·с²/м⁸", "R сети = H раб / Q раб²", 5);
  row++;

  section("3. Маршрут вентканала");
  kv("Начало канала", "", `узел ${r.startNode}`, "", r.startKind);
  kv("Конец канала", "", `узел ${r.endNode}`, "", r.endKind);
  kv("Длина канала", "L", r.totalL, "м", `${r.route.length} ветв.`, 1);
  kv("Сопротивление канала (полное)", "R к", r.totalR, "Н·с²/м⁸", "выработки + вентсооружения + окно/перемычка ГВУ", 5);
  kv("в т.ч. постоянная часть (не зависит от сечения)", "R пост", r.rFixed, "Н·с²/м⁸", "", 5);
  if (!r.routeChain) kv("Внимание", "", "ветви не образуют одну линию", "", "порядок ветвей — как выбраны");
  row++;

  const heads = ["№", "Выработка", "Узлы", "L, м", "S, м²", "∠, °", "R, Н·с²/м⁸", "V раб, м/с", "V расч, м/с", "h раб, Па", "Примечание"];
  const hr = ws.getRow(row);
  heads.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { name: "Arial", size: 8, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BORDER;
  });
  hr.height = 26;
  row++;
  r.route.forEach((x, i) => {
    const rr = ws.getRow(row);
    const note = [x.isFan ? "вентилятор" : "", x.isNarrow ? "узкое место" : "", x.rFull !== x.rWork ? "R с сооружениями" : ""].filter(Boolean).join(", ");
    const vals: (string | number)[] = [i + 1, x.name, x.nodes, x.length, x.area, x.angle, x.rFull, x.vWork, x.vDesign, x.hWork, note];
    const fmts = ["0", "", "", "0.0", "0.00", "0", "0.00000", "0.00", "0.00", "0.0", ""];
    vals.forEach((v, j) => {
      const c = rr.getCell(j + 1);
      c.value = v;
      if (fmts[j]) c.numFmt = fmts[j];
      c.font = { name: "Arial", size: 8, bold: x.isFan };
      c.alignment = { horizontal: j === 1 || j === 10 ? "left" : "center", vertical: "middle" };
      c.border = BORDER;
      if (x.isFan) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } };
    });
    row++;
  });
  row++;

  section("4. Сечение канала");
  kv("Рекомендуемое сечение при Q расч", "S рек", r.sRec || r.sRecNote, "м²", `Q = ${r.qDesign.toFixed(2)} м³/с, H = ${r.hDesign.toFixed(0)} Па`, 2, true);
  kv("Эквивалентный диаметр", "D экв", r.dEq, "м");
  kv("Макс. производительность в этой сети", "Q max сети", r.qMaxNet, "м³/с", `угол ${r.angleBest}, H = ${r.hMaxNet.toFixed(0)} Па`);
  kv("Рекомендуемое сечение при Q max сети", "S рек max", r.sRecTop || r.sRecTopNote, "м²", "", 2, true);
  kv("Эквивалентный диаметр", "D экв", r.dEqTop, "м");
  kv("Фактическое (наименьшее) сечение", "S факт", r.sFact, "м²", r.narrowName);
  kv("Соответствие при Q расч", "", okTxt(r.okSection, "достаточно", "меньше рекомендуемого"));
  kv("Соответствие при Q max сети", "", okTxt(r.okTop, "достаточно", "меньше рекомендуемого"));
  kv("Рекомендуемая производительность при факт. сечении", "Q рек", r.qRecFact, "м³/с", r.qRecFactBy, 2, true);
  row++;

  section("5. Потери и скорости");
  kv("Потери в канале при Q раб", "h к", r.hFactWork, "Па", `${r.pctWork.toFixed(1)} % от H раб (допустимо ${r.kLossPct} %)`, 1);
  kv("Потери при Q расч: фактическое сечение", "h к", r.hFactDesign, "Па", "", 1);
  kv("Потери при Q расч: рекомендуемое сечение", "h к рек", r.hRecDesign, "Па", "", 1);
  kv("Скорость в узком месте при Q раб / Q расч", "V", `${r.vWork.toFixed(2)} / ${r.vDesign.toFixed(2)}`, "м/с", "справочно, не регламентируется");
  kv("Скоростной напор при Q раб", "h ск", r.hSk, "Па", "ρ = 1,2 кг/м³", 1);
  row++;

  section("6. Проверка рабочей точки вентилятора");
  kv("Отношение Q раб / Q ном (норма 0,8…1,15)", "", r.ratio, "", okTxt(r.zoneOk, "в зоне экономичной работы", r.ratio < 0.8 ? "левее номинала — вибрация, риск помпажа" : "правее номинала — перегрузка двигателя"));
  kv("КПД в рабочей точке (≥ 0,9·η max)", "η раб", r.etaNow > 0 ? r.etaNow * 100 : null, "%", okTxt(r.etaOk, "экономичный режим", "неэкономичный режим"), 0);
  kv("Устойчивость: H раб ≤ 0,9·H max", "", `${r.hNow.toFixed(0)} ≤ ${r.hStall.toFixed(0)}`, "Па", okTxt(r.stallOk, "без срыва", "зона срыва потока"));
  row++;

  section("7. Экономика (режим Q раб)");
  kv("Мощность на преодоление сопротивления канала: факт", "N факт", r.pFact, "кВт", "N = h к · Q / η / 1000", 1);
  kv("То же при рекомендуемом сечении", "N рек", r.pRec || null, "кВт", "", 1);
  kv("Электроэнергия в год: факт", "Э факт", r.eFact, "кВт·ч/год", "", 0);
  kv("Электроэнергия в год: при S рек", "Э рек", r.eRec || null, "кВт·ч/год", "", 0);
  kv("Затраты в год: факт", "З факт", r.costFact, "руб/год", "", 0);
  kv("Затраты в год: при S рек", "З рек", r.costRec || null, "руб/год", "", 0);
  kv("Экономия при сечении S рек", "ΔЭ", r.saving > 0 ? r.saving : "канал достаточен", "кВт·ч/год", "", 0);
  kv("Экономия в деньгах", "ΔЗ", r.savingRub > 0 ? r.savingRub : "—", "руб/год", "", 0, true);
  row++;

  if (r.warnings.length) {
    section("Замечания");
    for (const w of r.warnings) {
      ws.mergeCells(`A${row}:${LAST}${row}`);
      const c = ws.getCell(`A${row}`);
      c.value = `• ${w}`;
      c.font = { name: "Arial", size: 9, color: { argb: "FF92400E" } };
      c.alignment = { wrapText: true, indent: 1 };
      ws.getRow(row).height = 26;
      row++;
    }
  }

  ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };

  // ═══════════════════════ Лист «Методика» ═══════════════════════
  const wm = wb.addWorksheet("Методика", { views: [{ showGridLines: false }] });
  wm.columns = [{ width: 6 }, { width: 110 }];
  let m = 1;
  const mt = (text: string) => {
    wm.mergeCells(`A${m}:B${m}`);
    const c = wm.getCell(`A${m}`);
    c.value = text;
    c.font = { name: "Arial", size: 14, bold: true, color: { argb: ACCENT } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    wm.getRow(m).height = 28;
    m += 2;
  };
  const mh = (num: string, text: string) => {
    const a = wm.getCell(`A${m}`);
    a.value = num;
    a.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    a.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    a.alignment = { horizontal: "center", vertical: "middle" };
    const b = wm.getCell(`B${m}`);
    b.value = text;
    b.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    b.alignment = { vertical: "middle", indent: 1 };
    wm.getRow(m).height = 18;
    m++;
  };
  const mp = (text: string, formula = false) => {
    const b = wm.getCell(`B${m}`);
    b.value = text;
    b.font = formula
      ? { name: "Consolas", size: 10, bold: true, color: { argb: "FF1F2937" } }
      : { name: "Arial", size: 9, color: { argb: "FF374151" } };
    b.alignment = { wrapText: true, vertical: "top", indent: formula ? 3 : 1 };
    if (formula) b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    const lines = Math.ceil(text.length / 120);
    wm.getRow(m).height = Math.max(15, lines * 13);
    m++;
  };

  mt("МЕТОДИКА РАСЧЁТА ВЕНТИЛЯЦИОННОГО КАНАЛА ГВУ");

  mh("1", "Назначение и принцип");
  mp("Вентиляционный канал соединяет главную вентиляторную установку (ГВУ) со стволом. Часть депрессии вентилятора тратится на преодоление сопротивления канала и не используется для проветривания рудника. Сечение канала подбирается так, чтобы эти потери не превышали заданной доли k напора вентилятора (по умолчанию 5 %).");
  mp("Скорость воздуха в вентиляционном канале ГВУ нормативно не ограничивается и приводится справочно. Определяющим критерием являются потери давления.");
  m++;

  mh("2", "Состав канала и его сопротивление");
  mp("Канал — непрерывная последовательность выработок от сопряжения со стволом до выхода на поверхность через ветвь вентилятора. Состав задаётся автоматически (трассировка от вентилятора) или вручную — выбором ветвей на схеме.");
  mp("R к = Σ ( R i + R соор,i ) + R окна ГВУ + R перемычки ГВУ", true);
  mp("R i — аэродинамическое сопротивление выработки, Н·с²/м⁸ (то же значение, что использует расчёт вентиляционной сети); R соор — сопротивление вентсооружений на ветви; R окна ГВУ = ρ / (2·μ²·ΔS²) — окно вентилятора, установленного в перемычке. Потери давления h = R·Q² получаются сразу в паскалях.");
  m++;

  mh("3", "Расчётные режимы");
  mp("Режим 1 — расчётный расход Q расч. По умолчанию — рабочая точка вентилятора по расчёту сети (Q раб, H раб). Если необходимый расход задан вручную, напор H расч берётся по характеристике вентилятора при этом расходе: при текущем угле лопаток, а если расход превышает его паспортный предел — при ближайшем угле, обеспечивающем этот расход.");
  mp("Характеристика рудника (сети), на которую работает вентилятор:");
  mp("H сети(Q) = R сети · Q²,   R сети = H раб / Q раб²", true);
  mp("Проверяется, обеспечит ли вентилятор депрессию рудника при Q расч, и определяется необходимый угол лопаток.");
  mp("Режим 2 — максимальная производительность в данной сети. Выбирается угол лопаток с наибольшей паспортной подачей; рабочая точка — пересечение характеристики вентилятора при этом угле с характеристикой рудника:");
  mp("N·H(Q/N, θ max) = R сети · Q²   →   Q max сети, H max сети", true);
  mp("N — число вентиляторов, работающих в параллель: каждый пропускает Q/N, напор установки N·H(Q/N) — так же, как в расчёте сети.");
  m++;

  mh("4", "Рекомендуемое сечение");
  mp("При изменении сечения выработки сопротивление трения меняется по закону подобия (периметр P ∝ √S):");
  mp("R i(S) = R i · ( S i / S ) ^ 2,5", true);
  mp("Рекомендуемое сечение — такое единое сечение канала, при котором потери равны допустимым:");
  mp("Σ R i·S i^2,5 / S^2,5 + R пост = k · H / Q²", true);
  mp("S рек = [ Σ R i·S i^2,5 / ( k·H/Q² − R пост ) ] ^ (1/2,5)", true);
  mp("R пост — постоянная часть (вентсооружения, окно ГВУ, выработки без сечения). Если R пост·Q² ≥ k·H, то увеличение сечения выработок не позволяет уложиться в допустимые потери — необходимо снижать сопротивление сооружений. Эквивалентный диаметр: D экв = √(4·S/π).");
  mp("Фактическое сечение — наименьшее сечение выработок маршрута (узкое место). Канал считается достаточным, если S факт ≥ 0,98·S рек.");
  m++;

  mh("5", "Рекомендуемая производительность при фактическом сечении");
  mp("Наибольший расход на характеристике вентилятора при угле наибольшей производительности, при котором потери в существующем канале не превышают допустимых:");
  mp("R к · Q² ≤ k · N·H(Q/N, θ max),   Q ≤ Q max паспорт", true);
  mp("Если условие выполняется на паспортном пределе — канал не ограничивает вентилятор.");
  m++;

  mh("6", "Проверка рабочей точки вентилятора");
  mp("Номинальная точка Q ном, H ном — точка максимального КПД на паспортной характеристике при текущем угле лопаток и оборотах (закон подобия: Q ∝ n, H ∝ n²).");
  mp("Зона экономичной работы:   0,8 ≤ Q раб / Q ном ≤ 1,15", true);
  mp("Экономичность:   η раб ≥ 0,9 · η max", true);
  mp("Устойчивость (без срыва потока):   H раб ≤ 0,9 · H max", true);
  mp("Работа левее номинала ведёт к росту вибрации и риску помпажа; правее — к перегрузке двигателя и подшипников.");
  m++;

  mh("7", "Экономика");
  mp("Расчёт выполняется в фактическом режиме работы (Q раб) для фактического и рекомендуемого сечения:");
  mp("N = h к · Q / η / 1000, кВт;    Э = N · T, кВт·ч/год;    З = Э · Ц, руб/год", true);
  mp("ΔЭ = Э факт − Э рек;    ΔЗ = ΔЭ · Ц", true);
  mp("η — КПД вентилятора в рабочей точке (при недостоверной кривой КПД — из свойств вентилятора или 0,7); T — время работы в год; Ц — тариф.");
  m++;

  mh("8", "Допущения");
  mp("• Местные потери (повороты, вход и выход из канала, диффузор) учитываются, только если заданы в свойствах ветвей (коэффициент ξ).");
  mp("• Плотность воздуха ρ = 1,2 кг/м³ (для скоростного напора).");
  mp("• Изменение расхода в руднике при реконструкции канала оценивается по неизменной характеристике сети (R сети постоянно).");

  wm.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = (r.projectName || "проект").replace(/[\\/:*?"<>|]+/g, "_");
  a.download = `Расчёт вентканала ГВУ — ${safe}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
