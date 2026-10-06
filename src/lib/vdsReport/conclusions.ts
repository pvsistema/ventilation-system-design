// Автоматические выводы по результатам ВДС (раздел «Выводы»), формулируются
// по рассчитанным показателям — так же, как в отчёте-образце.
import type { VdsCalcResult } from "./calc";
import { f } from "./calc";

export function buildConclusions(r: VdsCalcResult, mineName: string): string[] {
  const out: string[] = [];
  const mine = mineName ? `«${mineName}»` : "рудника";
  if (r.requiredAir > 0) {
    out.push(
      `Фактическое количество воздуха, поступающего в рудник на момент обследования, составляет ` +
      `${f(r.QshTotal)} м³/с (${f(r.QshTotal * 60)} м³/мин) при расчётном ${f(r.requiredAir)} м³/с ` +
      `(${f(r.requiredAir * 60)} м³/мин), т.е. обеспеченность ${mine} по подаваемому расходу воздуха составляет ${f(r.supplyPct)}%.`,
    );
  } else {
    out.push(`Фактическое количество воздуха, поступающего в рудник, составляет ${f(r.QshTotal)} м³/с (${f(r.QshTotal * 60)} м³/мин).`);
  }
  for (const g of r.gvu) {
    out.push(
      `Главная вентиляторная установка ${g.fanModel} (${g.place}) работает с параметрами: ` +
      `Qв = ${f(g.Qv)} м³/с; Hв = ${f(g.Hv)} даПа` +
      (g.rpm ? `; n = ${g.rpm} об/мин` : "") +
      (g.bladeAngle ? `; θ = ${g.bladeAngle}°` : "") +
      (g.reservePct != null ? `; резерв по производительности ${f(g.reservePct)}%` : "") + ".",
    );
    if (g.extLeakMeasured) {
      const over = g.extLeakFact - g.extLeakNorm;
      out.push(
        `Внешние утечки на ГВУ ${g.fanModel} составляют ${f(g.extLeakFact)} м³/с (${f(g.extLeakPct)}% от Qвент.), ` +
        (over > 0.05
          ? `что превышает нормативные (${f(g.extLeakNorm)} м³/с) на ${f(over)} м³/с.`
          : `что не превышает нормативных (${f(g.extLeakNorm)} м³/с).`),
      );
    }
  }
  if (r.deadEnds.length) {
    const ok = r.deadEnds.filter(d => d.ok).length;
    out.push(`Из ${r.deadEnds.length} обследованных тупиковых (подготовительных и нарезных) выработок расчётным расходом воздуха обеспечены ${ok}.`);
    r.deadEnds.filter(d => !d.ok).forEach(d =>
      out.push(`— ${d.name}: в забой поступает ${f(d.qFace)} м³/с при расчётном ${f(d.qRequired)} м³/с.`));
  }
  if (r.faces.length) {
    const ok = r.faces.filter(d => d.ok).length;
    out.push(`Из ${r.faces.length} забоев (выемочных участков), проветриваемых за счёт общерудничной депрессии, расчётным количеством воздуха обеспечены ${ok}.`);
  } else {
    out.push("Очистные работы в выемочных выработках, проветриваемых за счёт общерудничной депрессии, на момент ВДС в модели не заданы.");
  }
  if (r.chambers.length) {
    const ok = r.chambers.filter(d => d.ok).length;
    out.push(`Проветривание камер служебного назначения обособленной струёй воздуха: ${r.chambers.length} камер, из них обеспечены расчётным количеством воздуха ${ok}.`);
  }
  out.push(`Внутрирудничные утечки воздуха составили ${f(r.intLeakTotal)} м³/с (${f(r.intLeakPct)}% от Qрудника)` +
    (r.intLeakNormTotal > 0 && r.intLeakTotal > r.intLeakNormTotal
      ? ` и превышают нормативные на ${f(r.intLeakTotal - r.intLeakNormTotal)} м³/с.` : "."));
  const viol = r.structures.filter(s => s.violation);
  if (viol.length) {
    out.push("Состояние вентиляционных устройств удовлетворительное, за исключением (нарушения п. 158, 168 ФНиП):");
    viol.forEach(s => out.push(
      `— ${s.name}, ${s.type}: Qут.н = ${f(s.norm)} м³/с, Qут.ф = ${f(s.fact)} м³/с, сверх нормы ${f(s.over)} м³/с (${f(s.overPct)}%).`));
  } else if (r.structures.length) {
    out.push("Состояние вентиляционных устройств по руднику удовлетворительное, утечки через них не превышают нормативных.");
  }
  const heMax = Math.max(0, ...r.naturalDraft.map(n => Math.max(Math.abs(n.heSummer), Math.abs(n.heWinter))));
  out.push(`Естественная тяга определена расчётным способом; максимальная расчётная величина на предельные температуры — ${f(heMax)} даПа` +
    (r.Hmine > 0 && heMax < r.Hmine * 0.1 ? ", существенного влияния на вентиляционный режим рудника не оказывает." : "."));
  if (r.Nud > 0) out.push(`Рудник относится к ${r.ventDifficulty.replace("легко проветриваемый", "лёгкой степени проветривания")} по показателю трудности проветривания: Nуд = ${f(r.Nud, 2)} кВт·с/м³; эквивалентное отверстие А = ${f(r.Aeq, 2)} м² (${r.openingClass}).`);
  if (r.Hmine > 0) out.push(`Депрессия рудника на момент проведения ВДС составляет ${f(r.Hmine)} даПа.`);
  if (r.solved) {
    const n = r.stabilityDown.length + r.stabilityUp.length;
    out.push(n
      ? (r.unstableCount
        ? `По результатам расчёта устойчивости проветривания наклонных выработок при пожаре неустойчивыми признаны ${r.unstableCount} из ${n} выработок — требуется разработка мероприятий.`
        : `Проветривание всех ${n} наклонных выработок с пожарной нагрузкой при пожаре устойчиво, опрокидывания вентиляционной струи не происходит.`)
      : `Наклонные выработки (угол ≥ ${f(r.stabilityAngle, 0)}°, длина ≥ ${f(r.stabilityLength, 0)} м) с заданной пожарной нагрузкой в модели отсутствуют.`);
  }
  out.push("Математическая модель вентиляционной сети создана по фактическим значениям, полученным при проведении полевых работ, и может применяться для решения задач по совершенствованию проветривания и расчётов аварийных режимов.");
  return out;
}

export function buildRecommendations(r: VdsCalcResult): string[] {
  const out: string[] = [];
  r.structures.filter(s => s.violation).forEach(s =>
    out.push(`Произвести ремонт (герметизацию) вентиляционного сооружения «${s.type}» в выработке «${s.name}» с доведением утечек до нормативных (${f(s.norm)} м³/с).`));
  r.gvu.filter(g => g.extLeakMeasured && g.extLeakFact > g.extLeakNorm + 0.05).forEach(g =>
    out.push(`Снизить внешние утечки на ГВУ ${g.fanModel} до нормативных (${f(g.extLeakNorm)} м³/с): герметизация ляд, тамбур-шлюзов и вентиляционного канала.`));
  r.deadEnds.filter(d => !d.ok).forEach(d =>
    out.push(`Обеспечить подачу расчётного количества воздуха (${f(d.qRequired)} м³/с) в забой «${d.name}»: проверить вентстав, сократить отставание от забоя, заменить ВМП.`));
  [...r.faces, ...r.chambers].filter(c => !c.ok).forEach(c =>
    out.push(`Обеспечить расчётное количество воздуха (${f(c.required)} м³/с) в «${c.name}».`));
  if (r.requiredAir > 0 && r.supplyPct < 100)
    out.push(`Увеличить подачу воздуха в рудник до расчётной величины ${f(r.requiredAir)} м³/с.`);
  if (r.unstableCount > 0)
    out.push("Разработать мероприятия по обеспечению устойчивости проветривания наклонных выработок при пожаре и отразить их в ПМЛА.");
  out.push("Воздушно-депрессионную съёмку проводить не реже одного раза в три года, а также при изменении схемы проветривания рудника.");
  out.push("Руководству рудника после получения материалов отчёта разработать план мероприятий по выполнению рекомендаций.");
  return out;
}
