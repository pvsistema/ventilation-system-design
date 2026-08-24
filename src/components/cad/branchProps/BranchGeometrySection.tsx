// ─────────────────────────────────────────────────────────────────────────────
// BranchGeometrySection.tsx — раздел «Геометрия» вкладки «Топология».
// Узлы ветви, длина и угол, форма и размеры сечения, участок рудника,
// итоговые S и P, признаки «капитальная» и «проектируемая».
//
// Вынесено из BranchTopologyTab.tsx БЕЗ изменений разметки, формул и подписей.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { type VentSection } from "@/lib/ventSections";
import {
  SectionHeader, EditInput, ComputedInput, CheckField, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface BranchGeometrySectionProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  shortNode: (id: string) => string;
  angle: number;
  numFmt: (v: number, d?: number) => string;
  ventSections: VentSection[];
  onOpenSectionsLibrary?: () => void;
}

export default function BranchGeometrySection({
  branch, onUpdate, shortNode, angle, numFmt, ventSections, onOpenSectionsLibrary,
}: BranchGeometrySectionProps) {
  return (
  <>
    <SectionHeader title="Геометрия" />

    <InlineLabel label="Ветвь №">
      <EditInput value={branch.id} readOnly />
    </InlineLabel>

    <InlineLabel label="Нач. узел">
      <EditInput value={shortNode(branch.fromId)} readOnly />
    </InlineLabel>

    <InlineLabel label="Кон. узел">
      <EditInput value={shortNode(branch.toId)} readOnly />
    </InlineLabel>

    <InlineLabel label="Длина, м">
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        <div className="flex-1 min-w-0">
          {branch.manualLength ? (
            <EditInput
              type="number"
              step="0.5"
              value={branch.length}
              onChange={(v) => onUpdate({ length: parseFloat(v) || 0 })}
            />
          ) : (
            <ComputedInput value={numFmt(branch.length, 1)} />
          )}
        </div>
        <button
          onClick={() => onUpdate({ manualLength: !branch.manualLength })}
          title={branch.manualLength ? "Вычислять автоматически из координат" : "Задать вручную"}
          style={{ fontSize: 10, padding: "1px 4px", border: "1px solid var(--c-b2, #c8c8c8)", borderRadius: 2, background: branch.manualLength ? "var(--c-tint-blue2, #dbeafe)" : "var(--c-s2, #f5f5f5)", cursor: "pointer", flexShrink: 0, lineHeight: "14px" }}>
          {branch.manualLength ? "рук" : "авт"}
        </button>
      </div>
    </InlineLabel>

    <InlineLabel label="Угол наклона, °">
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        <div className="flex-1 min-w-0">
          {branch.manualAngle ? (
            <EditInput
              type="number"
              step="1"
              value={angle}
              onChange={(v) => onUpdate({ angle: Math.max(0, Math.min(90, Math.abs(parseFloat(v) || 0))) })}
            />
          ) : (
            <ComputedInput value={numFmt(angle, 1)} />
          )}
        </div>
        <button
          onClick={() => onUpdate({ manualAngle: !branch.manualAngle })}
          title={branch.manualAngle ? "Вычислять автоматически из координат" : "Задать вручную"}
          style={{ fontSize: 10, padding: "1px 4px", border: "1px solid var(--c-b2, #c8c8c8)", borderRadius: 2, background: branch.manualAngle ? "var(--c-tint-blue2, #dbeafe)" : "var(--c-s2, #f5f5f5)", cursor: "pointer", flexShrink: 0, lineHeight: "14px" }}>
          {branch.manualAngle ? "рук" : "авт"}
        </button>
      </div>
    </InlineLabel>

    <InlineLabel label="Форма сечения">
      <select
        value={branch.shape}
        onChange={(e) => {
          const s = e.target.value as TopoBranch["shape"];
          const extra: Partial<TopoBranch> = { shape: s, manualSection: s === "custom" };
          if (s === "arch" && (!branch.archHeight || branch.archHeight > branch.rectWidth / 2)) {
            extra.archHeight = branch.rectWidth / 2;
          }
          onUpdate(extra);
        }}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
        <option value="round">Круглое</option>
        <option value="rect">Прямоугольное</option>
        <option value="trap">Трапециевидное</option>
        <option value="arch">Арочное</option>
        <option value="custom">Задано вручную</option>
      </select>
    </InlineLabel>

    {/* Участок рудника — группа выработок для позабойного расчёта
        количества воздуха (ФНиП № 505, п. 155). */}
    <InlineLabel label="Участок">
      <div className="flex items-center gap-0.5 w-full">
        <select
          value={branch.ventSectionId ?? ""}
          onChange={(e) => onUpdate({ ventSectionId: e.target.value })}
          className="flex-1 min-w-0 text-[11px] px-1"
          style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
          <option value="">— не задан —</option>
          {ventSections.map(s => (
            <option key={s.id} value={s.id}>
              {s.number ? `${s.number}. ` : ""}{s.name || "Без названия"}
            </option>
          ))}
        </select>
        {onOpenSectionsLibrary && (
          <button
            onClick={onOpenSectionsLibrary}
            title="Справочник участков рудника"
            style={{ fontSize: 10, padding: "1px 4px", border: "1px solid var(--c-b2, #c8c8c8)", borderRadius: 2, background: "var(--c-s2, #f5f5f5)", cursor: "pointer", flexShrink: 0, lineHeight: "14px" }}>
            …
          </button>
        )}
      </div>
    </InlineLabel>

    {/* Способ задания сечения: по габаритам (S и P считаются) или вручную
        (задаются прямо S и P). Тип выработки из справочника включает ручной
        режим — там площадь берётся из справочника. */}
    <InlineLabel label="Задание сечения">
      <select
        value={branch.manualSection ? "manual" : "dims"}
        onChange={(e) => onUpdate({ manualSection: e.target.value === "manual" })}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid var(--c-b2, #c8c8c8)", height: 18, outline: "none" }}>
        <option value="dims">По габаритам</option>
        <option value="manual">Вручную (S и P)</option>
      </select>
    </InlineLabel>

    {!branch.manualSection && branch.shape === "round" && (
      <InlineLabel label="Диаметр D, м">
        <EditInput
          type="number" step="0.1"
          value={branch.diameter}
          onChange={(v) => onUpdate({ diameter: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {!branch.manualSection && (branch.shape === "rect" || branch.shape === "trap" || branch.shape === "arch") && (
      <InlineLabel label="Ширина a, м">
        <EditInput
          type="number" step="0.1"
          value={branch.rectWidth}
          onChange={(v) => onUpdate({ rectWidth: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {!branch.manualSection && (branch.shape === "rect" || branch.shape === "trap" || branch.shape === "arch") && (
      <InlineLabel label="Высота b, м">
        <EditInput
          type="number" step="0.1"
          value={branch.rectHeight}
          onChange={(v) => onUpdate({ rectHeight: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {!branch.manualSection && branch.shape === "arch" && (
      <InlineLabel label="Стрела свода h, м">
        <EditInput
          type="number" step="0.05"
          value={branch.archHeight}
          onChange={(v) => onUpdate({ archHeight: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {!branch.manualSection && branch.shape === "trap" && (
      <InlineLabel label="Верх c, м">
        <EditInput
          type="number" step="0.1"
          value={branch.trapTopWidth}
          onChange={(v) => onUpdate({ trapTopWidth: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {/* Итоговые S и P. Если сечение задано вручную (в т.ч. после выбора типа
        выработки из справочника) — разрешаем править их напрямую, иначе они
        считаются по габаритам и остаются только для чтения. */}
    <InlineLabel label="Периметр P, м">
      {branch.manualSection ? (
        <EditInput
          type="number" step="0.1"
          value={branch.perimeter}
          onChange={(v) => onUpdate({ perimeter: parseFloat(v) || 0, manualSection: true })}
        />
      ) : (
        <ComputedInput value={numFmt(branch.perimeter, 2)} />
      )}
    </InlineLabel>

    <InlineLabel label="Площадь S, м²">
      {branch.manualSection ? (
        <EditInput
          type="number" step="0.1"
          value={branch.area}
          onChange={(v) => onUpdate({ area: parseFloat(v) || 0, manualSection: true })}
        />
      ) : (
        <ComputedInput value={numFmt(branch.area, 2)} />
      )}
    </InlineLabel>

    <InlineLabel label="Гидр. диаметр Dh, м">
      <ComputedInput value={numFmt(branch.dh, 3)} />
    </InlineLabel>

    <div style={{ borderBottom: "1px solid var(--c-b1, #e0e0e0)", margin: "2px 0" }} />

    <InlineLabel label="Капитальная">
      <CheckField checked={branch.capital ?? false} onChange={(v) => onUpdate({ capital: v })} />
    </InlineLabel>

    <InlineLabel label="Проектируемая">
      <CheckField checked={branch.designed ?? false} onChange={(v) => onUpdate({ designed: v })} />
    </InlineLabel>
  </>
  );
}
