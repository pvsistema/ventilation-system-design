// ─────────────────────────────────────────────────────────────────────────────
// Расчёт вентиляционного канала ГВУ на максимальную производительность
// вентилятора (по паспортной характеристике с учётом угла лопаток и оборотов).
//
//   Q_max (м³/с)   = Q_max,пасп(угол) · (n / n_ном) · N_парал
//   Q_max (м³/мин) = 60 · Q_max (м³/с)
//   S_min          = Q_max / V_доп          — минимальное сечение канала, м²
//   D_экв          = √(4·S_min / π)         — эквивалентный диаметр, м
//   V_факт         = Q_max / S_канала        — скорость в существующем канале
//   h_ск           = ρ·V² / 2                — скоростной напор, Па
//   V_доп = 15 м/с — макс. допустимая скорость в вентиляционных каналах (ПБ).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import type { TopoBranch } from "@/lib/topology";
import { getFanById, fanQMax } from "@/lib/fanCurves";

interface Props {
  fans: TopoBranch[];
  label: (b: TopoBranch) => string;
}

const RHO = 1.2;

function n(s: string): number {
  const v = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

export default function VdsChannelSection({ fans, label }: Props) {
  const gvu = useMemo(() => fans.filter(f => f.fanType === "ГВУ"), [fans]);
  const list = gvu.length ? gvu : fans;
  const [fanId, setFanId] = useState<string>(list[0]?.id ?? "");
  const [vDop, setVDop] = useState("15");
  const [qManual, setQManual] = useState("");

  const b = list.find(x => x.id === fanId);
  const curve = b?.fanCurveId ? getFanById(b.fanCurveId) : undefined;
  const qCurve = b && curve ? fanQMax(curve, b.fanBladeAngle, b.fanRpm) * Math.max(1, b.fanParallel || 1) : 0;
  const qMax = qManual.trim() ? n(qManual) : qCurve;
  const V = n(vDop);
  const sMin = qMax > 0 && V > 0 ? qMax / V : 0;
  const dEq = sMin > 0 ? Math.sqrt((4 * sMin) / Math.PI) : 0;
  const sFact = b?.area ?? 0;
  const vFact = sFact > 0 ? qMax / sFact : 0;
  const hSk = (RHO * vFact * vFact) / 2;
  const ok = vFact > 0 && V > 0 ? vFact <= V : null;
  const qNow = Math.abs(b?.flow ?? 0);

  const inputCls = "w-full px-2 py-1 text-[12px] border border-gray-300 rounded outline-none focus:border-blue-500";
  const f = (x: number, d = 2) => (x > 0 ? x.toFixed(d) : "—");

  return (
    <div className="mt-4 pt-3" style={{ borderTop: "1px solid #dde3ec" }}>
      <div className="text-[13px] font-semibold text-gray-800">Вентиляционный канал ГВУ на макс. производительность</div>
      <div className="text-[11px] text-gray-500 leading-snug mb-2">
        Q<sub>max</sub> — по паспортной характеристике выбранного вентилятора (угол лопаток, обороты, число в параллель).
        S<sub>min</sub> = Q<sub>max</sub> / V<sub>доп</sub>; V<sub>доп</sub> = 15 м/с для вентиляционных каналов.
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2 text-[12px]">
        <label className="col-span-3 sm:col-span-1">
          <span className="text-gray-600">Вентилятор</span>
          <select className={inputCls + " bg-white"} value={fanId} onChange={e => { setFanId(e.target.value); setQManual(""); }}>
            {list.length === 0 && <option value="">— нет в схеме —</option>}
            {list.map(x => <option key={x.id} value={x.id}>{label(x)}</option>)}
          </select>
        </label>
        <label>
          <span className="text-gray-600">Q<sub>max</sub>, м³/с {qCurve > 0 && !qManual ? "(паспорт)" : ""}</span>
          <input className={inputCls} inputMode="decimal" value={qManual} placeholder={qCurve ? qCurve.toFixed(2) : "ввести"}
            onChange={e => setQManual(e.target.value)} />
        </label>
        <label>
          <span className="text-gray-600">V<sub>доп</sub>, м/с</span>
          <input className={inputCls} inputMode="decimal" value={vDop} onChange={e => setVDop(e.target.value)} />
        </label>
      </div>

      {b && !curve && !qManual && (
        <div className="mb-2 text-[11px] px-2 py-1.5 rounded" style={{ background: "#fff7e6", border: "1px solid #ffe0a3", color: "#9a6700" }}>
          У вентилятора не задана модель из справочника — введите Q<sub>max</sub> вручную.
        </div>
      )}

      <div className="rounded p-3 grid grid-cols-2 gap-y-1.5 text-[12px]" style={{ background: "#f7f9fc", border: "1px solid #dde3ec" }}>
        <span className="text-gray-600">Модель:</span>
        <span className="font-medium">{curve?.name || b?.fanName || "—"}</span>
        <span className="text-gray-600">Макс. производительность Q<sub>max</sub>:</span>
        <span className="font-medium">{f(qMax)} м³/с = {f(qMax * 60, 0)} м³/мин</span>
        <span className="text-gray-600">Текущая подача Q:</span>
        <span className="font-medium">{f(qNow)} м³/с = {f(qNow * 60, 0)} м³/мин</span>
        <span className="text-gray-600">Мин. сечение канала S<sub>min</sub> = Q<sub>max</sub>/V<sub>доп</sub>:</span>
        <span className="font-bold text-blue-700">{f(sMin)} м²</span>
        <span className="text-gray-600">Эквивалентный диаметр D = √(4S/π):</span>
        <span className="font-medium">{f(dEq)} м</span>
        <span className="text-gray-600">Сечение ветви канала в схеме:</span>
        <span className="font-medium">{f(sFact)} м²</span>
        <span className="text-gray-600">Скорость при Q<sub>max</sub> V = Q<sub>max</sub>/S:</span>
        <span className="font-medium" style={{ color: ok === false ? "#dc2626" : ok ? "#16a34a" : undefined }}>
          {f(vFact)} м/с {ok === false ? "— превышает V доп, канал мал" : ok ? "— в норме" : ""}
        </span>
        <span className="text-gray-600">Скоростной напор h<sub>ск</sub> = ρV²/2:</span>
        <span className="font-medium">{f(hSk, 1)} Па ({f(hSk / 10)} даПа)</span>
      </div>
    </div>
  );
}
