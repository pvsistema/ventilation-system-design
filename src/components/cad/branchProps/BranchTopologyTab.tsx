// ─────────────────────────────────────────────────────────────────────────────
// BranchTopologyTab.tsx — вкладка «Топология» панели свойств выработки.
//
// Четыре карточки сверху вниз — в том порядке, в каком инженер задаёт ветвь:
//   1. «Геометрия»      — узлы, длина и угол (авто из координат или вручную);
//   2. «Сечение»        — форма и размеры либо S и P вручную, участок рудника;
//   3. «Сопротивление»  — способ задания R, местные ξ, допустимая скорость,
//                          признак утечки;
//   4. «Результат расчёта» — главные показатели потока плитками, остальное
//                          (сопротивления, Re, мощность) — компактным списком.
//
// Формулы, поля данных и подстановка марки рукава — прежние; менялись
// оформление и состав полей.
//
// Что убрано и почему:
//   • Галочки у «Вычисленных параметров» — ничего не скрывали и нигде не
//     сохранялись: строки показывались всегда.
//   • Повторы: «Ветвь №», «Название», «Длина», «Угол», «Площадь» в расчётном
//     блоке дублировали поля выше; «Геометр. сопр.» и «R трение» — одно и то
//     же значение (rFriction) под двумя подписями.
//   • «Тупик» как галочка — в расчёт сети не передавался: сервер определяет
//     тупики сам по графу, и после расчёта отметка перезаписывалась. Теперь
//     это метка состояния в заголовке «Результата расчёта».
//   • «Коэф. утечки» — не участвовал ни в расчёте, ни в выгрузках. Сам признак
//     «Утечка» оставлен: он окрашивает ветвь и исключает её из маршрутов
//     выхода людей.
//   • «Капитальная / Проектируемая» — уже есть во вкладке «Общие» (раздел
//     «Статус»); два места для одного и того же поля путают.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { type VentSection } from "@/lib/ventSections";
import { SURFACE_TYPES, PIPE_ALPHA_TYPES } from "@/lib/aerodynamics";
import { VENT_DUCT_BRANDS, getDuctBrand, getDuctSize } from "@/lib/ventDucts";
import { G_ACCEL } from "@/lib/bulkheads";
import Icon from "@/components/ui/icon";
import {
  Card, Field, Switch, NumInput, ReadValue, Segmented, Stat, KV, inputCls, inputStyle,
} from "@/components/cad/propUi";

interface BranchTopologyTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  shortNode: (id: string) => string;
  angle: number;
  unitR: number;
  uRes: { fromBase: (v: number) => number; symbol: string; decimals: number };
  rToDisplay: (rKmurg: number) => number;
  numFmt: (v: number, d?: number) => string;
  fmtR: (rKmu: number, minDecimals?: number) => string;
  bulkheadRKmu: number;
  ventSections: VentSection[];
  onOpenSectionsLibrary?: () => void;
}

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };

/** Переключатель «авто / вручную» рядом с подписью поля. */
function AutoManual({ manual, onChange }: { manual: boolean; onChange: (manual: boolean) => void }) {
  return (
    <div style={{ width: 84 }}>
      <Segmented size="sm" value={manual ? "m" : "a"} onChange={(v) => onChange(v === "m")}
        options={[
          { value: "a", label: "авто", title: "Считать по координатам узлов" },
          { value: "m", label: "вручную", title: "Задать значение вручную" },
        ]} />
    </div>
  );
}

export default function BranchTopologyTab({
  branch: b, onUpdate, shortNode, angle, unitR, uRes, rToDisplay,
  numFmt, fmtR, bulkheadRKmu, ventSections, onOpenSectionsLibrary,
}: BranchTopologyTabProps) {
  const manualSection = b.manualSection || b.shape === "custom";
  const hasBox = b.shape === "rect" || b.shape === "trap" || b.shape === "arch";

  // ── Сопротивления и депрессия — те же суммы, что уходят в расчёт сети ──
  // Общее R = выработка + перемычка/окно + вентилятор «Внутри перемычки».
  const fanCrossingKmu = (b.hasFan && (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
    ? (b.fanCrossingR ?? 0) / 1000 : 0;
  const totalR = b.resistance + (bulkheadRKmu ?? 0) + fanCrossingKmu;
  const Q = b.flow ?? 0;
  const fanH = b.hasFan ? (b.fanPressure ?? 0) : 0;
  const dpTotal = totalR * Math.abs(Q) * Q * G_ACCEL - fanH;
  const hasStructure = (bulkheadRKmu ?? 0) > 0 || fanCrossingKmu > 0;
  // Аэродинамическое R не может быть меньше сопротивления трения.
  const rWrong = b.rFriction > 0 && b.resistance < b.rFriction;
  const overV = b.vMax > 0 && Math.abs(b.velocity) > b.vMax;
  const solved = Math.abs(Q) > 0 || Math.abs(b.velocity) > 0;
  const rs = uRes.symbol;
  const R = (v: number, extra = 0) => fmtR(rToDisplay(v), uRes.decimals + extra);

  const duct = b.resistanceMode === "pipe" ? getDuctBrand(b.vpBrandId) : undefined;

  return (
    <div className="p-2 space-y-2" style={{ fontFamily: "var(--font-ui)" }}>

      {/* ═══ 1. Геометрия ═══════════════════════════════════════════════ */}
      <Card icon="Ruler" title="Геометрия">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded text-[11px]"
          style={{ background: "var(--c-s2, #f8f7f4)", color: "var(--c-t2, #3a3f45)", fontFamily: "var(--font-num)" }}>
          <Icon name="CircleDot" size={11} style={{ color: "var(--c-t4, #767f8c)" }} />
          <span title="Начальный узел">{shortNode(b.fromId)}</span>
          <Icon name="ArrowRight" size={11} style={{ color: "var(--c-t4, #767f8c)" }} />
          <span title="Конечный узел">{shortNode(b.toId)}</span>
          <span className="ml-auto" style={{ color: "var(--c-t4, #767f8c)", fontFamily: "var(--font-ui)" }}>ветвь №{b.id}</span>
        </div>

        <Field label="Длина" aside={<AutoManual manual={b.manualLength} onChange={(m) => onUpdate({ manualLength: m })} />}>
          {b.manualLength
            ? <NumInput value={b.length} step={0.5} min={0} unit="м" onChange={(v) => onUpdate({ length: v })} />
            : <ReadValue value={numFmt(b.length, 1)} unit="м" title="По маркшейдерским координатам узлов" />}
        </Field>
        <Field label="Угол наклона" aside={<AutoManual manual={b.manualAngle} onChange={(m) => onUpdate({ manualAngle: m })} />}
          hint={b.manualAngle ? "«+» — подъём от начального узла к конечному, «−» — спуск" : undefined}>
          {b.manualAngle
            // Знак угла сохраняется, как у автоматического. Раньше ручной
            // ввод брал модуль, и уклон вниз задать было нельзя.
            ? <NumInput value={angle} step={1} min={-90} max={90} unit="°" onChange={(v) => onUpdate({ angle: v })} />
            : <ReadValue value={numFmt(angle, 1)} unit="°" title="По маркшейдерским координатам узлов" />}
        </Field>
      </Card>

      {/* ═══ 2. Сечение ═════════════════════════════════════════════════ */}
      <Card icon="Square" title="Сечение">
        <Field label="Форма">
          <select className={inputCls} style={selectStyle} value={b.shape}
            onChange={(e) => {
              const s = e.target.value as TopoBranch["shape"];
              const extra: Partial<TopoBranch> = { shape: s, manualSection: s === "custom" };
              if (s === "arch" && (!b.archHeight || b.archHeight > b.rectWidth / 2)) {
                extra.archHeight = b.rectWidth / 2;
              }
              onUpdate(extra);
            }}>
            <option value="round">Круглое</option>
            <option value="rect">Прямоугольное</option>
            <option value="trap">Трапециевидное</option>
            <option value="arch">Арочное</option>
            <option value="custom">Произвольное (S и P вручную)</option>
          </select>
        </Field>

        {b.shape !== "custom" && (
          <Field label="Что задаём">
            <Segmented value={manualSection ? "manual" : "dims"}
              onChange={(v) => onUpdate({ manualSection: v === "manual" })}
              options={[
                { value: "dims", label: "Размеры", title: "S и P считаются по размерам сечения" },
                { value: "manual", label: "S и P напрямую", title: "Площадь и периметр задаются вручную" },
              ]} />
          </Field>
        )}

        {!manualSection && (
          <div className="grid grid-cols-2 gap-2">
            {b.shape === "round" && (
              <Field label="Диаметр D">
                <NumInput value={b.diameter} step={0.1} min={0} unit="м"
                  onChange={(v) => onUpdate({ diameter: v, manualSection: false })} />
              </Field>
            )}
            {hasBox && (
              <Field label={b.shape === "trap" ? "Низ a" : "Ширина a"}>
                <NumInput value={b.rectWidth} step={0.1} min={0} unit="м"
                  onChange={(v) => onUpdate({ rectWidth: v, manualSection: false })} />
              </Field>
            )}
            {hasBox && (
              <Field label={b.shape === "arch" ? "Высота стенки b" : "Высота b"}>
                <NumInput value={b.rectHeight} step={0.1} min={0} unit="м"
                  onChange={(v) => onUpdate({ rectHeight: v, manualSection: false })} />
              </Field>
            )}
            {b.shape === "arch" && (
              <Field label="Стрела свода h">
                <NumInput value={b.archHeight} step={0.05} min={0} unit="м"
                  onChange={(v) => onUpdate({ archHeight: v, manualSection: false })} />
              </Field>
            )}
            {b.shape === "trap" && (
              <Field label="Верх c">
                <NumInput value={b.trapTopWidth} step={0.1} min={0} unit="м"
                  onChange={(v) => onUpdate({ trapTopWidth: v, manualSection: false })} />
              </Field>
            )}
          </div>
        )}

        {/* Итог сечения: при ручном задании S и P правятся напрямую, иначе
            считаются по размерам и только показываются. */}
        <div className="grid grid-cols-3 gap-1.5">
          <Field label="Площадь S">
            {manualSection
              ? <NumInput value={b.area} step={0.1} min={0} unit="м²" onChange={(v) => onUpdate({ area: v, manualSection: true })} />
              : <ReadValue value={numFmt(b.area, 2)} unit="м²" />}
          </Field>
          <Field label="Периметр P">
            {manualSection
              ? <NumInput value={b.perimeter} step={0.1} min={0} unit="м" onChange={(v) => onUpdate({ perimeter: v, manualSection: true })} />
              : <ReadValue value={numFmt(b.perimeter, 2)} unit="м" />}
          </Field>
          <Field label="Dh = 4S/P">
            <ReadValue value={numFmt(b.dh, 2)} unit="м" title="Гидравлический диаметр" />
          </Field>
        </div>

        {/* Участок рудника — группа выработок для позабойного расчёта
            количества воздуха (ФНиП № 505, п. 155). */}
        <Field label="Участок рудника">
          <div className="flex gap-1">
            <select className={`${inputCls} flex-1`} style={selectStyle}
              value={b.ventSectionId ?? ""}
              onChange={(e) => onUpdate({ ventSectionId: e.target.value })}>
              <option value="">— не задан —</option>
              {ventSections.map(s => (
                <option key={s.id} value={s.id}>{s.number ? `${s.number}. ` : ""}{s.name || "Без названия"}</option>
              ))}
            </select>
            {onOpenSectionsLibrary && (
              <button type="button" onClick={onOpenSectionsLibrary} title="Справочник участков рудника"
                className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded"
                style={{ background: "var(--c-s3, #f1efea)", border: "1px solid var(--c-b2, #d5d1c8)", color: "var(--c-t2, #3a3f45)", cursor: "pointer" }}>
                <Icon name="BookOpen" size={13} />
              </button>
            )}
          </div>
        </Field>
      </Card>

      {/* ═══ 3. Сопротивление ═══════════════════════════════════════════ */}
      <Card icon="Wind" title="Сопротивление">
        <Field label="Как задать R">
          <select className={inputCls} style={selectStyle} value={b.resistanceMode}
            onChange={(e) => onUpdate({ resistanceMode: e.target.value as TopoBranch["resistanceMode"] })}>
            <option value="surface">По типу крепи (справочник)</option>
            <option value="alpha">По коэффициенту α</option>
            <option value="roughness">По шероховатости Δ</option>
            <option value="manual">Вручную — значение R</option>
            <option value="pipe">Трубопровод (R = 6,48·α·L / D⁵)</option>
          </select>
        </Field>

        {b.resistanceMode === "surface" && (
          <Field label="Тип крепи" hint={`α = ${numFmt(b.alphaCoef, 0)}·10⁻⁴ Н·с²/м⁴ — из справочника`}>
            <select className={inputCls} style={selectStyle} value={b.surfaceId}
              onChange={(e) => {
                const s = SURFACE_TYPES.find((x) => x.id === e.target.value);
                if (s) onUpdate({ surfaceId: s.id, surface: s.name, alphaCoef: s.alpha, roughness: s.roughness });
              }}>
              {SURFACE_TYPES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}

        {b.resistanceMode === "alpha" && (
          <Field label="Коэффициент α">
            <NumInput value={b.alphaCoef} step={1} min={0} unit="×10⁻⁴" onChange={(v) => onUpdate({ alphaCoef: v })} />
          </Field>
        )}

        {b.resistanceMode === "roughness" && (
          <Field label="Шероховатость Δ">
            <NumInput value={b.roughness} step={1} min={0} unit="мм" onChange={(v) => onUpdate({ roughness: v })} />
          </Field>
        )}

        {b.resistanceMode === "manual" && (
          <Field label="Сопротивление R">
            <NumInput value={b.manualR} step={0.001} min={0} unit={rs} onChange={(v) => onUpdate({ manualR: v })} />
          </Field>
        )}

        {b.resistanceMode === "pipe" && (
          <>
            {/* Марка рукава — синхронизирована с окном построения
                вентрубопровода: выбор марки подставляет α, диаметр,
                паспортные утечки и предельное рабочее давление. */}
            <Field label="Марка рукава">
              <select className={inputCls} style={selectStyle} value={b.vpBrandId ?? ""}
                onChange={(e) => {
                  const brand = getDuctBrand(e.target.value);
                  if (!brand) { onUpdate({ vpBrandId: "", vpWorkPressure: 0 }); return; }
                  const curD = Math.round((b.pipeDiameter ?? 0.5) * 1000);
                  const size = getDuctSize(brand, curD) ?? brand.sizes[0];
                  onUpdate({
                    vpBrandId: brand.id,
                    pipeAlpha: brand.alpha,
                    vpPipeAlpha: brand.alpha,
                    pipeDiameter: size.diameter / 1000,
                    vpDiameter: size.diameter,
                    shape: "round", diameter: size.diameter / 1000, manualSection: false,
                    vpLeakageCoeff: size.lossPer100m,
                    vpWorkPressure: size.workPressure,
                    vpPipeType: "",
                  });
                }}>
                <option value="">— без марки —</option>
                {VENT_DUCT_BRANDS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>

            {duct ? (
              <>
                {/* У марки диаметр — только из выпускаемых типоразмеров */}
                <Field label="Диаметр D">
                  <select className={inputCls} style={selectStyle}
                    value={Math.round((b.pipeDiameter ?? 0.5) * 1000)}
                    onChange={(e) => {
                      const d = Number(e.target.value);
                      const size = getDuctSize(duct, d);
                      onUpdate({
                        pipeDiameter: d / 1000,
                        vpDiameter: d,
                        // Сечение ветви — под диаметр рукава
                        shape: "round", diameter: d / 1000, manualSection: false,
                        ...(size ? { vpLeakageCoeff: size.lossPer100m, vpWorkPressure: size.workPressure } : {}),
                      });
                    }}>
                    {duct.sizes.map(sz => <option key={sz.diameter} value={sz.diameter}>Ø {sz.diameter} мм</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Утечки на 100 м">
                    <ReadValue value={numFmt(b.vpLeakageCoeff ?? 0, 1)} unit="%" title="По паспорту марки" />
                  </Field>
                  <Field label="Рабочее давление">
                    <ReadValue value={numFmt(b.vpWorkPressure ?? 0, 0)} unit="Па" title="По паспорту марки" />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <Field label="Диаметр D">
                  <NumInput value={b.pipeDiameter ?? 0.5} step={0.05} min={0} unit="м"
                    onChange={(d) => onUpdate({ pipeDiameter: d, vpDiameter: Math.round(d * 1000) })} />
                </Field>
                {/* Тип трубопровода — только без марки: у марки α берётся из паспорта. */}
                <Field label="Тип трубопровода">
                  <select className={inputCls} style={selectStyle}
                    value={PIPE_ALPHA_TYPES.find(p => p.alpha === (b.pipeAlpha ?? 9))?.id ?? ""}
                    onChange={(e) => {
                      const p = PIPE_ALPHA_TYPES.find(x => x.id === e.target.value);
                      if (p) onUpdate({ pipeAlpha: p.alpha, vpPipeAlpha: p.alpha, vpPipeType: p.id });
                    }}>
                    <option value="">— выбрать из справочника —</option>
                    {PIPE_ALPHA_TYPES.map(p => <option key={p.id} value={p.id}>{p.name} ({p.alphaMin}–{p.alphaMax})</option>)}
                  </select>
                </Field>
              </>
            )}
            <Field label="Коэффициент α трубы" hint={duct ? "Правка α отвязывает рукав от паспорта марки" : undefined}>
              <NumInput value={b.pipeAlpha ?? 9} step={0.05} min={0} unit="×10⁻⁴"
                onChange={(a) => onUpdate({ pipeAlpha: a, vpPipeAlpha: a, ...(duct ? { vpBrandId: "" } : {}) })} />
            </Field>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Местные ξ (сумма)">
            <NumInput value={b.localXi} step={0.1} min={0} onChange={(v) => onUpdate({ localXi: v })} />
          </Field>
          <Field label="V допустимая">
            <NumInput value={b.vMax} step={0.5} min={0} unit="м/с" onChange={(v) => onUpdate({ vMax: v })} />
          </Field>
        </div>

        <div className="pt-1" style={{ borderTop: "1px dashed var(--c-b1, #e7e4dd)" }}>
          <Switch checked={b.isLeakage ?? false} onChange={(v) => onUpdate({ isLeakage: v })}
            label="Утечка через перемычку / целик"
            hint="Ветвь рисуется оранжевым и не считается путём выхода людей" />
        </div>
      </Card>

      {/* ═══ 4. Результат расчёта ═══════════════════════════════════════ */}
      <Card icon="Activity" title="Результат расчёта" tone="signal"
        aside={b.isDead ? (
          <span className="px-1.5 rounded-full text-[10px]"
            title="Расчёт сети определил ветвь как тупиковую: сквозного движения воздуха через неё нет"
            style={{ background: "var(--c-s3, #f1efea)", color: "var(--c-t3, #6b7280)" }}>
            тупик
          </span>
        ) : undefined}>
        {!solved && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px]"
            style={{ background: "var(--c-s2, #f8f7f4)", color: "var(--c-t3, #6b7280)" }}>
            <Icon name="Info" size={12} />
            Выполните «Расчёт сети» (F9), чтобы увидеть расход и депрессию.
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Расход Q" value={numFmt(b.flow, 2)} unit="м³/с" />
          <Stat label="Скорость V" value={numFmt(b.velocity, 2)} unit="м/с" danger={overV}
            hint={overV ? `Выше допустимой ${b.vMax} м/с` : undefined} />
          <Stat label="Депрессия выработки" value={numFmt(b.dP, 2)} unit="Па" />
          <Stat label="Общая депрессия" value={numFmt(dpTotal, 2)} unit="Па"
            hint={hasStructure ? "С учётом перемычки / окна вентилятора на ветви" : "R общее · Q² · g − напор вентилятора"} />
        </div>
        {overV && (
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--c-red, #dc2626)" }}>
            <Icon name="TriangleAlert" size={11} />
            Скорость выше допустимой ({b.vMax} м/с)
          </div>
        )}

        {/* Напор вентилятора на ветви — правится и здесь: у импортированной
            выработки нет значка УО, через который открывается вкладка
            «Вентилятор», и поменять напор было бы негде. */}
        {b.hasFan && (
          <Field label="Напор вентилятора (доп. депрессия)">
            <NumInput value={b.fanPressure} step={10} unit="Па" onChange={(v) => onUpdate({ fanPressure: v })} />
          </Field>
        )}

        <div className="pt-1">
          <KV label="Аэродинамическое R" value={R(b.resistance)} unit={rs} danger={rWrong}
            title="Сопротивление самой выработки" />
          <KV label="Общее R (с сооружениями)" value={R(totalR)} unit={rs}
            title="Выработка + перемычка/окно + вентилятор «Внутри перемычки»" />
          <KV label="R трения" value={R(b.rFriction)} unit={rs} />
          <KV label="R местных сопротивлений" value={R(b.rLocal)} unit={rs} />
          <KV label="R удельное" value={R(unitR, 1)} unit={`${rs}/м`} />
          <KV label="Число Рейнольдса" value={numFmt(b.reynolds / 1000, 1)} unit="тыс." />
          <KV label="Энергозатраты N" value={numFmt(b.power, 0)} unit="Вт" />
        </div>
        {rWrong && (
          <div className="flex items-start gap-1.5 text-[10px] leading-snug" style={{ color: "var(--c-red, #dc2626)" }}>
            <Icon name="TriangleAlert" size={11} className="mt-px flex-shrink-0" />
            Аэродинамическое R меньше сопротивления трения — такого быть не может, проверьте параметры ветви.
          </div>
        )}
      </Card>
    </div>
  );
}
