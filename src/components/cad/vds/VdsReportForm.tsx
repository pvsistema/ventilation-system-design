// Форма исходных данных отчёта ВДС (раздел 1 и титул — заполняет рудник;
// параметры ГВУ и климат — для расчётных разделов 2–4).
import { useState } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch } from "@/lib/topology";
import { KV_OPTIONS, type KeyValueRow, type VdsReportForm as Form } from "@/lib/vdsReport/types";
import type { VdsAuto, AutoTextKey } from "@/lib/vdsReport/auto";

const inputCls = "w-full px-2 py-1 text-[12px] border border-gray-300 rounded outline-none focus:border-blue-500 bg-white";

interface Props {
  form: Form;
  setForm: (fn: (f: Form) => Form) => void;
  gvuBranches: TopoBranch[];
  /** Автозначения по модели: подставляются, если поле оставлено пустым */
  auto: VdsAuto;
}

function Group({ title, children, open: initial = false, hint }: { title: string; children: React.ReactNode; open?: boolean; hint?: string }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="border border-gray-200 rounded mb-2 bg-white">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-gray-800 hover:bg-gray-50">
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} />
        <span className="flex-1">{title}</span>
        {hint && <span className="text-[10px] font-normal text-gray-400">{hint}</span>}
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-2">{children}</div>}
    </div>
  );
}

function Field({ label, value, onChange, area, rows = 3, placeholder, auto }: {
  label: string; value: string; onChange: (v: string) => void; area?: boolean; rows?: number; placeholder?: string;
  /** Значение из модели: используется, пока поле пустое */
  auto?: string;
}) {
  const usingAuto = !!auto && !value.trim();
  const ph = auto || placeholder;
  const cls = `${inputCls} ${usingAuto ? "placeholder:text-emerald-700 bg-emerald-50/40" : ""}`;
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-[11px] text-gray-600 mb-0.5">
        <span className="flex-1">{label}</span>
        {auto && (usingAuto
          ? <span className="text-[10px] text-emerald-700 flex items-center gap-0.5" title="Значение берётся из модели сети"><Icon name="Sparkles" size={10} />из модели</span>
          : <button type="button" className="text-[10px] text-gray-400 hover:text-emerald-700" title="Сбросить и взять из модели" onClick={e => { e.preventDefault(); onChange(""); }}>↺ из модели</button>)}
      </span>
      {area
        ? <textarea className={cls} rows={rows} value={value} placeholder={ph} onChange={e => onChange(e.target.value)} />
        : <input className={cls} value={value} placeholder={ph} onChange={e => onChange(e.target.value)} />}
    </label>
  );
}

function KvTable({ rows, onChange, cols }: { rows: KeyValueRow[]; onChange: (r: KeyValueRow[]) => void; cols: [string, string] }) {
  return (
    <div>
      <table className="w-full text-[12px] border-collapse">
        <thead><tr className="bg-gray-50 text-gray-600">
          <th className="border border-gray-200 px-2 py-1 text-left font-medium">{cols[0]}</th>
          <th className="border border-gray-200 px-2 py-1 text-left font-medium">{cols[1]}</th>
          <th className="border border-gray-200 w-7" />
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="border border-gray-200 p-0.5"><input className={inputCls} value={r.name} onChange={e => onChange(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></td>
              <td className="border border-gray-200 p-0.5"><input className={inputCls} value={r.value} onChange={e => onChange(rows.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} /></td>
              <td className="border border-gray-200 text-center">
                <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="X" size={13} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...rows, { name: "", value: "" }])}
        className="mt-1 text-[11px] text-blue-600 hover:underline flex items-center gap-1"><Icon name="Plus" size={12} />Добавить строку</button>
    </div>
  );
}

export default function VdsReportFormView({ form, setForm, gvuBranches, auto }: Props) {
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
  const A = (k: AutoTextKey) => auto.text[k];
  const userMain = form.mainWorkings.some(x => x.name.trim());
  const gvuInput = (branchId: string) => form.gvu.find(g => g.branchId === branchId);
  const setGvu = (branchId: string, patch: Partial<Form["gvu"][number]>) => setForm(f => {
    const exists = f.gvu.some(g => g.branchId === branchId);
    const a = auto.gvu[branchId];
    const base = { branchId, place: "", kv: a?.kv ?? 1.05, channelArea: "", extLeakFact: "", mode: "" };
    return {
      ...f,
      gvu: exists ? f.gvu.map(g => g.branchId === branchId ? { ...g, ...patch } : g) : [...f.gvu, { ...base, ...patch }],
    };
  });

  return (
    <div>
      <div className="text-[11px] text-gray-500 mb-2 leading-snug">
        Разделы 1 и 2 формируются вместе из модели вентиляционной сети: горизонты, главные и вскрывающие выработки,
        схема проветривания, ГВУ, забои, климат подставляются автоматически
        (<span className="text-emerald-700">зелёные подсказки «из модели»</span> — поле можно оставить пустым или переписать).
        Вручную вводятся только реквизиты и геология. Реквизиты организации, проводящей ВДС, запоминаются для всех проектов.
      </div>

      <Group title="Титульный лист" open>
        <Field label="Вышестоящая организация (построчно)" area rows={3} value={form.surveyOrgParent} onChange={set("surveyOrgParent")} />
        <Field label="Организация, выполнившая ВДС" value={form.surveyOrg} onChange={set("surveyOrg")} placeholder="Филиал «Копейский ВГСО»" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Должность утверждающего" value={form.approverTitle} onChange={set("approverTitle")} />
          <Field label="ФИО утверждающего" value={form.approverName} onChange={set("approverName")} />
          <Field label="Рудник / шахта" value={form.mineName} onChange={set("mineName")} placeholder="Рудник Вишневского месторождения" />
          <Field label="Предприятие" value={form.companyName} onChange={set("companyName")} placeholder="ООО «…»" />
          <Field label="Должность исполнителя" value={form.performerTitle} onChange={set("performerTitle")} />
          <Field label="ФИО исполнителя" value={form.performerName} onChange={set("performerName")} />
          <Field label="Город" value={form.city} onChange={set("city")} />
          <Field label="Год" value={form.approveYear} onChange={set("approveYear")} />
        </div>
      </Group>

      <Group title="Аннотация и цель ВДС">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Период проведения ВДС" value={form.surveyPeriod} onChange={set("surveyPeriod")} placeholder="ноябре 2025 года" auto={A("surveyPeriod")} />
          <Field label="Предыдущая съёмка" value={form.previousSurvey} onChange={set("previousSurvey")} placeholder="в феврале 2024 года" />
        </div>
        <Field label="Состав исполнителей" area rows={2} value={form.surveyTeam} onChange={set("surveyTeam")} />
        <Field label="Дополнение к аннотации (схема подачи воздуха и т.п.)" area value={form.annotation} onChange={set("annotation")} auto={A("annotation")} />
      </Group>

      <Group title="1.1 Сведения о руднике">
        <Field label="Юридический адрес" value={form.companyAddress} onChange={set("companyAddress")} />
        <div className="grid grid-cols-3 gap-2">
          <Field label="ИНН" value={form.inn} onChange={set("inn")} />
          <Field label="Телефон / факс" value={form.phone} onChange={set("phone")} />
          <Field label="E-mail" value={form.email} onChange={set("email")} />
        </div>
        <Field label="Руководитель" value={form.director} onChange={set("director")} placeholder="Генеральный директор — …" />
        <Field label="Местоположение месторождения" area value={form.location} onChange={set("location")} />
        <Field label="Лицензия на пользование недрами" area rows={2} value={form.subsoilLicense} onChange={set("subsoilLicense")} />
      </Group>

      <Group title="1.2 Общие сведения о руднике">
        <Field label="Регистрация ОПО, класс опасности" area rows={2} value={form.opoRegistration} onChange={set("opoRegistration")} />
        <div className="grid grid-cols-5 gap-2">
          <Field label="Персонал всего" value={form.staffTotal} onChange={set("staffTotal")} />
          <Field label="Подземных" value={form.staffUnderground} onChange={set("staffUnderground")} />
          <Field label="ИТР" value={form.staffItr} onChange={set("staffItr")} />
          <Field label="Макс. в смену" value={form.maxPerShift} onChange={set("maxPerShift")} auto={A("maxPerShift")} />
          <Field label="Действ. забоев" value={form.activeFaces} onChange={set("activeFaces")} auto={A("activeFaces")} />
        </div>
        <Field label="Основное горное оборудование (по строке на позицию)" area rows={4} value={form.equipment} onChange={set("equipment")} />
        <Field label="Действующие горизонты" value={form.horizons} onChange={set("horizons")} auto={A("horizons")} />
        <Field label="Преобладающий вид крепления" value={form.supportType} onChange={set("supportType")} auto={A("supportType")} />
        <div className="text-[11px] text-gray-600 font-medium">Характер опасности</div>
        <KvTable rows={form.hazards} onChange={set("hazards")} cols={["Вид опасности", "Оценка"]} />
        <div className="text-[11px] text-gray-600 font-medium mt-2">Сечение и протяжённость главных выработок</div>
        {!userMain && auto.mainWorkings.length > 0 ? (
          <div className="border border-emerald-200 bg-emerald-50/40 rounded p-2">
            <div className="flex items-center gap-2 text-[11px] text-emerald-800 mb-1">
              <Icon name="Sparkles" size={11} />
              <span className="flex-1">Из модели: выработки, связанные с поверхностью, и капитальные ({auto.mainWorkings.length})</span>
              <button type="button" className="text-blue-600 hover:underline" onClick={() => set("mainWorkings")(auto.mainWorkings.map(x => ({ ...x })))}>Редактировать</button>
            </div>
            <table className="w-full text-[11px]"><tbody>
              {auto.mainWorkings.map((x, i) => <tr key={i}><td className="pr-2 text-gray-700">{x.name}</td><td className="text-gray-500">{x.value}</td></tr>)}
            </tbody></table>
          </div>
        ) : (
          <>
            <KvTable rows={form.mainWorkings} onChange={set("mainWorkings")} cols={["Выработка", "Параметры (гор., S, L)"]} />
            {userMain && auto.mainWorkings.length > 0 && (
              <button type="button" className="text-[11px] text-gray-500 hover:text-emerald-700" onClick={() => set("mainWorkings")([{ name: "", value: "" }])}>↺ Вернуть таблицу из модели</button>
            )}
          </>
        )}
      </Group>

      <Group title="1.3 Геология, водоотлив, вскрытие, системы разработки, проветривание">
        <Field label="Запасы и характеристика полезного ископаемого" area rows={4} value={form.reserves} onChange={set("reserves")} />
        <Field label="Гидрогеология (водопритоки)" area value={form.hydrogeology} onChange={set("hydrogeology")} />
        <Field label="Водоотлив и пожарно-оросительный трубопровод" area value={form.drainage} onChange={set("drainage")} />
        <Field label="Схема вскрытия, вскрывающие выработки" area value={form.openingScheme} onChange={set("openingScheme")} auto={A("openingScheme")} />
        <Field label="Схема подготовки и системы разработки" area value={form.miningSystems} onChange={set("miningSystems")} />
        <Field label="Проветривание рудника (проектная схема)" area rows={5} value={form.ventilationScheme} onChange={set("ventilationScheme")} auto={A("ventilationScheme")} />
      </Group>

      <Group title="Параметры ВДС для расчётных разделов" open hint="разделы 2–4">
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="block text-[11px] text-gray-600 mb-0.5">Дата ВДС</span>
            <input type="date" className={inputCls} value={form.surveyDate} onChange={e => set("surveyDate")(e.target.value)} />
          </label>
          <Field label="Qрасч. по руднику, м³/с (пусто — по забоям схемы)" value={form.requiredAir} onChange={set("requiredAir")} />
          <Field label="Кн — коэф. неравномерности" value={form.kn} onChange={set("kn")} />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Field label="t при ВДС, °С" value={form.tSurvey} onChange={set("tSurvey")} auto={A("tSurvey") ?? "5"} />
          <Field label="P при ВДС, мм рт.ст." value={form.pSurvey} onChange={set("pSurvey")} auto={A("pSurvey") ?? "745"} />
          <Field label="t лето, °С" value={form.tSummer} onChange={set("tSummer")} />
          <Field label="P лето, мм рт.ст." value={form.pSummer} onChange={set("pSummer")} />
          <Field label="t зима, °С" value={form.tWinter} onChange={set("tWinter")} />
          <Field label="P зима, мм рт.ст." value={form.pWinter} onChange={set("pWinter")} />
          <Field label="t исходящей струи, °С" value={form.tExhaust} onChange={set("tExhaust")} auto={A("tExhaust") ?? "8"} />
          <Field label="Цена эл.энергии, руб/кВт·ч" value={form.electricityCost} onChange={set("electricityCost")} />
        </div>

        <div className="text-[11px] text-gray-600 font-medium mt-1">Главные вентиляторные установки (из схемы)</div>
        {gvuBranches.length === 0 && <div className="text-[11px] text-amber-700">В схеме нет работающих ГВУ.</div>}
        {gvuBranches.map(b => {
          const g = gvuInput(b.id);
          return (
            <div key={b.id} className="border border-gray-200 rounded p-2 bg-gray-50">
              <div className="text-[12px] font-semibold text-gray-700 mb-1">{b.fanName || "ГВУ"} · {String(b.type || "").replace(/^"(.*)"$/, "$1")}</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Место установки" value={g?.place ?? ""} onChange={v => setGvu(b.id, { place: v })} auto={auto.gvu[b.id]?.place} />
                <label className="block">
                  <span className="block text-[11px] text-gray-600 mb-0.5">Кв — внешние утечки по месту установки</span>
                  <select className={inputCls} value={g?.kv ?? auto.gvu[b.id]?.kv ?? 1.05} onChange={e => setGvu(b.id, { kv: parseFloat(e.target.value) })}>
                    {KV_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <Field label="Сечение вент. канала, м²" value={g?.channelArea ?? ""} onChange={v => setGvu(b.id, { channelArea: v })} auto={auto.gvu[b.id]?.channelArea} />
                <Field label="Внешние утечки по замеру, м³/с" value={g?.extLeakFact ?? ""} onChange={v => setGvu(b.id, { extLeakFact: v })} />
              </div>
            </div>
          );
        })}

        <div className="text-[11px] text-gray-600 font-medium mt-1">Средства измерения</div>
        <table className="w-full text-[12px] border-collapse">
          <thead><tr className="bg-gray-50 text-gray-600">
            {["Наименование", "Кол-во", "Параметр", "Погрешность", ""].map(t => <th key={t} className="border border-gray-200 px-1 py-1 text-left font-medium">{t}</th>)}
          </tr></thead>
          <tbody>
            {form.instruments.map((r, i) => (
              <tr key={i}>
                {(["name", "count", "parameter", "accuracy"] as const).map(k => (
                  <td key={k} className="border border-gray-200 p-0.5">
                    <input className={inputCls} value={r[k]} onChange={e => set("instruments")(form.instruments.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} />
                  </td>
                ))}
                <td className="border border-gray-200 text-center w-7">
                  <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => set("instruments")(form.instruments.filter((_, j) => j !== i))}><Icon name="X" size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={() => set("instruments")([...form.instruments, { name: "", count: "1", parameter: "", accuracy: "" }])}
          className="text-[11px] text-blue-600 hover:underline flex items-center gap-1"><Icon name="Plus" size={12} />Добавить прибор</button>
      </Group>

      <Group title="Дополнительные выводы и рекомендации">
        <Field label="Дополнительные выводы (по строке на пункт)" area rows={4} value={form.extraConclusions} onChange={set("extraConclusions")} />
        <Field label="Дополнительные рекомендации (по строке на пункт)" area rows={4} value={form.recommendations} onChange={set("recommendations")} />
      </Group>
    </div>
  );
}
