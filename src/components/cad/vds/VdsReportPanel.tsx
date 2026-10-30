// «Отчёт ВДС» — защищённый кодом доступа модуль вкладки ВДС.
// Код выдаётся администратором вместе с лицензионным ключом (админ-панель).
import { fillFromRequisites, saveRequisites } from "@/lib/actRequisites";
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { BranchBulkheadInfo } from "@/lib/branchBulkheadInfo";
import { emptyVdsForm, type VdsReportForm } from "@/lib/vdsReport/types";
import { calcVdsReport, f } from "@/lib/vdsReport/calc";
import { getStabilitySettings, getValidStabilityFacts } from "@/lib/stabilitySession";
import { buildConclusions } from "@/lib/vdsReport/conclusions";
import { buildVdsDocx, downloadBlob } from "@/lib/vdsReport/docx";
import { loadVdsAccess, verifyVdsCode, clearVdsAccess, VDS_OFFLINE_GRACE_MS } from "@/lib/vdsReport/access";
import VdsReportFormView from "./VdsReportForm";

interface LicenseLike {
  status?: string;
  info?: { key?: string; licensed?: boolean } | null;
  fingerprint?: string;
}

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  solved: boolean;
  bulkheads: Map<string, BranchBulkheadInfo>;
  projectName: string;
  license: LicenseLike | null | undefined;
  /** Ветви с полной депрессией/сопротивлением — как в «Акте устойчивости». */
  stabilityBranches?: TopoBranch[];
}

type Access = "checking" | "locked" | "granted" | "nolicense";

const FORM_LS = (project: string) => `pvs_vds_report_form:${project || "default"}`;

export default function VdsReportPanel({ branches, nodes, solved, bulkheads, projectName, license, stabilityBranches }: Props) {
  const licKey = license?.info?.key && license?.info?.licensed !== false ? license.info.key : "";
  const isOfflineKey = !!licKey && licKey.startsWith("PVSO.");
  const [access, setAccess] = useState<Access>("checking");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"form" | "preview">("form");
  const [exporting, setExporting] = useState(false);

  // ── Проверка доступа ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!licKey || isOfflineKey) { setAccess("nolicense"); return; }
      const saved = loadVdsAccess(licKey);
      if (!saved) { setAccess("locked"); return; }
      const res = await verifyVdsCode(licKey, saved.code, license?.fingerprint ?? "");
      if (cancelled) return;
      if (res.ok) setAccess("granted");
      else if (res.offline && Date.now() - saved.verifiedAt < VDS_OFFLINE_GRACE_MS) setAccess("granted");
      else { setErr(res.message); setAccess("locked"); }
    })();
    return () => { cancelled = true; };
  }, [licKey, isOfflineKey, license?.fingerprint]);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const res = await verifyVdsCode(licKey, code, license?.fingerprint ?? "");
    setBusy(false);
    if (res.ok) setAccess("granted");
    else setErr(res.message);
  }

  // ── Форма (сохраняется локально для проекта) ─────────────────────────────
  const [form, setFormState] = useState<VdsReportForm>(() => {
    try {
      const s = localStorage.getItem(FORM_LS(projectName));
      if (s) return fillFromRequisites({ ...emptyVdsForm(), ...JSON.parse(s) }, { companyName: "orgName" });
    } catch { /* ignore */ }
    return fillFromRequisites(emptyVdsForm(), { companyName: "orgName" });
  });
  const setForm = (fn: (f: VdsReportForm) => VdsReportForm) => setFormState(prev => {
    const next = fn(prev);
    try { localStorage.setItem(FORM_LS(projectName), JSON.stringify(next)); } catch { /* ignore */ }
    if (next.companyName !== prev.companyName) saveRequisites({ orgName: next.companyName });
    return next;
  });

  const gvuBranches = useMemo(
    () => branches.filter(b => b.hasFan && b.fanType === "ГВУ" && !b.fanStopped),
    [branches],
  );

  // Раздел устойчивости — по тем же условиям и тому же расчёту по факту, что
  // и «Акт устойчивости» (вкладка «Вентиляция»). Факт берётся, только если он
  // посчитан для ТЕКУЩЕГО состояния схемы, иначе — нормативная оценка.
  const result = useMemo(() => {
    if (access !== "granted") return null;
    const st = getStabilitySettings();
    const sb = stabilityBranches ?? branches;
    return calcVdsReport(branches, nodes, solved, form, bulkheads, {
      branches: sb,
      angleFilter: st.angleFilter,
      lengthFilter: st.lengthFilter,
      ambientTemp: st.ambientTemp,
      facts: getValidStabilityFacts(sb, nodes, st.ambientTemp),
      timber: { mode: st.timberPowerMode, arrivalMin: st.arrivalMin },
    });
  }, [access, branches, stabilityBranches, nodes, solved, form, bulkheads]);

  async function exportDocx() {
    if (!result) return;
    setExporting(true);
    try {
      const blob = await buildVdsDocx(form, result);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `Отчет_ВДС_${(form.mineName || projectName || "рудник").replace(/[\\/:*?"<>|«»]/g, "").slice(0, 60)}_${date}.docx`);
    } finally {
      setExporting(false);
    }
  }

  // ── Экраны блокировки ─────────────────────────────────────────────────────
  if (access === "checking") {
    return <div className="py-10 text-center text-[12px] text-[color:var(--c-t3,#6b7280)] flex items-center justify-center gap-2"><Icon name="Loader2" size={14} className="animate-spin" />Проверка доступа к отчёту ВДС…</div>;
  }
  if (access === "nolicense") {
    return (
      <div className="py-8 px-6 text-center">
        <Icon name="FileLock2" size={36} className="mx-auto text-[color:var(--c-t4,#9ca3af)]" />
        <div className="text-[13px] font-semibold text-[color:var(--c-t1,#111827)] mt-2">Отчёт ВДС доступен только по лицензии</div>
        <div className="text-[12px] text-[color:var(--c-t3,#6b7280)] mt-1 max-w-md mx-auto">
          {isOfflineKey
            ? "Для аварийного оффлайн-ключа модуль «Отчёт ВДС» не предоставляется. Активируйте основной лицензионный ключ."
            : "Активируйте лицензионный ключ программы, затем введите код доступа к отчёту ВДС, выданный вместе с ключом."}
        </div>
      </div>
    );
  }
  if (access === "locked") {
    return (
      <form onSubmit={submitCode} className="py-8 px-6 max-w-md mx-auto text-center">
        <Icon name="FileLock2" size={36} className="mx-auto text-indigo-500" />
        <div className="text-[13px] font-semibold text-[color:var(--c-t1,#111827)] mt-2">Модуль «Отчёт ВДС» защищён кодом доступа</div>
        <div className="text-[12px] text-[color:var(--c-t3,#6b7280)] mt-1">
          Введите код доступа, выданный правообладателем для лицензии <span className="font-mono">{licKey}</span>.
        </div>
        <input
          autoFocus value={code} onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="VDS-XXXX-XXXX"
          className="mt-3 w-full px-3 py-2 text-[13px] font-mono text-center border border-[color:var(--c-b2,#d1d5db)] rounded-md outline-none focus:border-[color:var(--c-accent,#1e5a7a)]"
        />
        {err && <div className="mt-2 text-[12px] text-red-600 flex items-center justify-center gap-1"><Icon name="AlertCircle" size={13} />{err}</div>}
        <button type="submit" disabled={busy || !code.trim()}
          className="mt-3 px-4 py-2 text-[12px] rounded-md text-white disabled:opacity-50 inline-flex items-center gap-2"
          style={{ background: "#4f46e5" }}>
          {busy ? <Icon name="Loader2" size={14} className="animate-spin" /> : <Icon name="KeyRound" size={14} />}
          Открыть отчёт
        </button>
      </form>
    );
  }

  // ── Доступ открыт ─────────────────────────────────────────────────────────
  const r = result!;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {(["form", "preview"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 text-[12px] rounded-md border ${tab === t ? "bg-[color:var(--c-accent,#1e5a7a)] text-white border-[color:var(--c-accent,#1e5a7a)]" : "bg-[color:var(--c-s1,#fff)] text-[color:var(--c-t2,#374151)] border-[color:var(--c-b2,#d1d5db)] hover:bg-black/5"}`}>
            {t === "form" ? "Исходные данные" : "Расчётные результаты"}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => { clearVdsAccess(); setAccess("locked"); setCode(""); }}
          title="Забыть код доступа на этом компьютере"
          className="text-[11px] text-[color:var(--c-t4,#9ca3af)] hover:text-[color:var(--c-t1,#111827)] flex items-center gap-1"><Icon name="Lock" size={12} />Заблокировать</button>
        <button onClick={exportDocx} disabled={exporting}
          className="px-3 py-1.5 text-[12px] rounded-md text-white inline-flex items-center gap-1.5 disabled:opacity-50"
          style={{ background: "#1d4ed8" }}>
          {exporting ? <Icon name="Loader2" size={14} className="animate-spin" /> : <Icon name="FileDown" size={14} />}
          Сформировать отчёт (Word)
        </button>
      </div>

      {!solved && (
        <div className="mb-2 text-[11px] px-2 py-1.5 rounded-md" style={{ background: "#fff7e6", border: "1px solid #ffe0a3", color: "#9a6700" }}>
          Сеть не рассчитана — расчётные разделы 2–4 будут пустыми. Выполните «Расчёт сети» перед формированием отчёта.
        </div>
      )}

      {tab === "form" ? (
        <VdsReportFormView form={form} setForm={setForm} gvuBranches={gvuBranches} />
      ) : (
        <div className="text-[12px] space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {[
              ["Поступает в рудник", `${f(r.QshTotal)} м³/с`],
              ["Требуется", r.requiredAir > 0 ? `${f(r.requiredAir)} м³/с` : "—"],
              ["Обеспеченность", r.requiredAir > 0 ? `${f(r.supplyPct)} %` : "—"],
              ["Депрессия рудника", `${f(r.Hmine)} даПа`],
              ["Внешние утечки", `${f(r.extLeakTotal)} м³/с`],
              ["Внутренние утечки", `${f(r.intLeakTotal)} м³/с (${f(r.intLeakPct)}%)`],
              ["Nуд", `${f(r.Nud, 2)} кВт·с/м³`],
              ["Экв. отверстие А", `${f(r.Aeq, 2)} м²`],
            ].map(([k, v]) => (
              <div key={k} className="border border-[color:var(--c-b1,#e5e7eb)] rounded-md p-2 bg-[color:var(--c-s2,#f9fafb)]">
                <div className="text-[10px] text-[color:var(--c-t3,#6b7280)]">{k}</div>
                <div className="text-[13px] font-semibold text-[color:var(--c-t1,#111827)]">{v}</div>
              </div>
            ))}
          </div>

          <div className="text-[11px] text-[color:var(--c-t3,#6b7280)]">
            ГВУ: {r.gvu.length} · тупиковых выработок: {r.deadEnds.length} · забоев: {r.faces.length} · камер: {r.chambers.length} ·
            вентсооружений: {r.structures.length} (с превышением утечек: {r.structures.filter(s => s.violation).length}) ·
            наклонных выработок в расчёте устойчивости: {r.stabilityDown.length + r.stabilityUp.length}
          </div>
          {r.solved && (
            <div className="text-[11px] px-2 py-1.5 rounded-md flex items-start gap-1.5"
              style={r.stabilityBasis === "fact"
                ? { background: "var(--c-tint-green, #f0fdf4)", color: "var(--c-green, #15803d)", border: "1px solid #bbf7d0" }
                : { background: "var(--c-tint-amber, #fff4e5)", color: "var(--c-amber, #8a5a00)", border: "1px solid #f0d9b5" }}>
              <Icon name={r.stabilityBasis === "fact" ? "CheckCircle2" : "Info"} size={12} className="shrink-0 mt-[1px]" />
              <span>
                Устойчивость при пожаре: угол ≥ {f(r.stabilityAngle, 0)}°, длина ≥ {f(r.stabilityLength, 0)} м, t = {f(r.stabilityTemp, 0)} °C —
                {r.stabilityBasis === "fact" ? " по расчёту сети при пожаре (как в Акте устойчивости)."
                  : r.stabilityBasis === "partial" ? " частично по расчёту сети, остальное — нормативная оценка."
                  : " нормативная оценка. Для расчёта по факту откройте «Вентиляция → Акт устойчивости» и нажмите «Рассчитать факт опрокидывания»."}
              </span>
            </div>
          )}

          <div>
            <div className="font-semibold text-[color:var(--c-t1,#111827)] mb-1">Выводы (формируются автоматически)</div>
            <ol className="list-decimal pl-5 space-y-1 text-[color:var(--c-t2,#374151)]">
              {buildConclusions(r, form.mineName).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
