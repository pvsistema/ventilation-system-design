// ─────────────────────────────────────────────────────────────────────────────
// PrintSettingsPanel.tsx — левая панель окна печати.
//
// Порядок блоков — по ходу работы инженера: лист → масштаб и положение схемы →
// принтер и копии → поля → шаблоны. Кнопки «Печать» и «Экспорт» живут в
// подвале окна (раньше «Печать» была продублирована трижды).
// ─────────────────────────────────────────────────────────────────────────────
import {
  PAPER_SIZES, type PaperFormat, type Orientation,
} from "@/components/cad/printPreview/printDialogParts";
import {
  PSection, PSegmented, PField, PSelect, PCheck, PButton, PNote,
} from "@/components/cad/printPreview/printUi";

interface PrintSettingsPanelProps {
  templates: Record<string, object>;
  loadTemplate: (name: string) => void;
  saveTemplate: () => void;
  deleteTemplate: (name: string) => void;
  templateName: string;
  setTemplateName: (v: string) => void;
  format: PaperFormat;
  setFormat: (v: PaperFormat) => void;
  orientation: Orientation;
  setOrientation: (v: Orientation) => void;
  customW: number;
  setCustomW: (v: number) => void;
  customH: number;
  setCustomH: (v: number) => void;
  copies: number;
  setCopies: (v: number) => void;
  reverseOrder: boolean;
  setReverseOrder: (v: boolean) => void;
  /** Принтеры Windows. Пусто в браузере — там выбор делает системное окно. */
  printers: { name: string; isDefault: boolean }[];
  printerName: string;
  setPrinterName: (v: string) => void;
  scaleDisplay: number;
  setScaleDisplay: (v: number) => void;
  offsetXDisplay: number;
  setOffsetXDisplay: (v: number) => void;
  offsetYDisplay: number;
  setOffsetYDisplay: (v: number) => void;
  setUserScale: (v: number | null) => void;
  setUserOffsetX: (v: number | null) => void;
  setUserOffsetY: (v: number | null) => void;
  marginTop: number;
  setMarginTop: (v: number) => void;
  marginBottom: number;
  setMarginBottom: (v: number) => void;
  marginLeft: number;
  setMarginLeft: (v: number) => void;
  marginRight: number;
  setMarginRight: (v: number) => void;
  showPageNumbers: boolean;
  setShowPageNumbers: (v: boolean) => void;
  /** Приложить перечень позиций ПЛА отдельными листами. */
  withPlaSheet: boolean;
  setWithPlaSheet: (v: boolean) => void;
  positionsCount: number;
  mineWideCount: number;
  plaPageCount: number;
  paper: { w: number; h: number };
  baseView: { defaultOffsetX: number; defaultOffsetY: number };
  totalPages: number;
}

const FORMATS = ["A4", "A3", "A2", "A1", "A0"] as const;
/** Печать листов ведётся при 150 dpi: мм → px. */
const mmToPx150 = (mm: number) => mm * 150 / 25.4;

export default function PrintSettingsPanel(p: PrintSettingsPanelProps) {
  const {
    templates, loadTemplate, saveTemplate, deleteTemplate, templateName, setTemplateName,
    format, setFormat, orientation, setOrientation, customW, setCustomW, customH, setCustomH,
    copies, setCopies, reverseOrder, setReverseOrder, printers, printerName, setPrinterName,
    scaleDisplay, setScaleDisplay, offsetXDisplay, setOffsetXDisplay, offsetYDisplay, setOffsetYDisplay,
    setUserScale, setUserOffsetX, setUserOffsetY,
    marginTop, setMarginTop, marginBottom, setMarginBottom, marginLeft, setMarginLeft, marginRight, setMarginRight,
    showPageNumbers, setShowPageNumbers, paper, baseView, totalPages,
    withPlaSheet, setWithPlaSheet, positionsCount, mineWideCount, plaPageCount,
  } = p;

  const fitToSheet = () => {
    setUserScale(null);
    setUserOffsetX(null); setUserOffsetY(null);
    setOffsetXDisplay(0); setOffsetYDisplay(0);
    setScaleDisplay(100);
  };

  const resetAll = () => {
    fitToSheet();
    setMarginTop(5); setMarginBottom(5); setMarginLeft(5); setMarginRight(5);
    setShowPageNumbers(true);
    setCopies(1); setReverseOrder(false);
  };

  const marginsEqual = marginTop === marginBottom && marginTop === marginLeft && marginTop === marginRight;
  const templateNames = Object.keys(templates);
  const templateExists = templateNames.includes(templateName.trim());

  return (
    <div className="flex-shrink-0 overflow-y-auto flex flex-col"
      style={{ width: 250, background: "var(--c-s1)", borderRight: "1px solid var(--c-b2)", color: "var(--c-t1)" }}>

      {/* 1. Лист */}
      <PSection icon="FileText" title="Лист">
        <PSegmented value={orientation} onChange={setOrientation}
          options={[
            { value: "landscape" as Orientation, label: "Альбомная", icon: "RectangleHorizontal" },
            { value: "portrait" as Orientation, label: "Книжная", icon: "RectangleVertical" },
          ]} />
        <PSegmented value={format} onChange={setFormat}
          options={[
            ...FORMATS.map(f => ({ value: f as PaperFormat, label: f, title: `${f}: ${PAPER_SIZES[f].w}×${PAPER_SIZES[f].h} мм` })),
            { value: "custom" as PaperFormat, label: "Свой", title: "Произвольный размер" },
          ]} />
        {format === "custom" ? (
          <div className="grid grid-cols-2 gap-2">
            <PField label="Ширина" unit="мм" value={customW} min={50} step={10}
              onChange={v => setCustomW(Math.max(50, v || 210))} />
            <PField label="Высота" unit="мм" value={customH} min={50} step={10}
              onChange={v => setCustomH(Math.max(50, v || 297))} />
          </div>
        ) : (
          <div className="text-[10.5px] flex justify-between" style={{ color: "var(--c-t3)" }}>
            <span>Размер листа</span>
            <span className="font-num" style={{ color: "var(--c-t2)" }}>{paper.w} × {paper.h} мм</span>
          </div>
        )}
      </PSection>

      {/* 2. Масштаб и положение */}
      <PSection icon="Scaling" title="Схема на листе">
        <div className="grid gap-2 items-end" style={{ gridTemplateColumns: "1fr auto" }}>
          <PField label="Масштаб" unit="%" value={scaleDisplay} min={1} max={10000} step={10}
            hint="100 % — вся схема вписана в один лист. Больше — схема крупнее и займёт несколько листов."
            onChange={v => {
              const s = Math.max(1, v || 1);
              setScaleDisplay(s);
              setUserScale(s / 100);
            }} />
          <PButton icon="Maximize" onClick={fitToSheet} title="Вписать всю схему в один лист">Вписать</PButton>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PField label="Сдвиг вправо" unit="мм" value={offsetXDisplay} step={5}
            onChange={mm => { setOffsetXDisplay(mm); setUserOffsetX(baseView.defaultOffsetX + mmToPx150(mm)); }} />
          <PField label="Сдвиг вниз" unit="мм" value={offsetYDisplay} step={5}
            onChange={mm => { setOffsetYDisplay(mm); setUserOffsetY(baseView.defaultOffsetY + mmToPx150(mm)); }} />
        </div>
        <PNote>Схему можно двигать мышью прямо на листе. Колесо мыши приближает просмотр и на печать не влияет.
          {totalPages > 1 && <> Сейчас схема займёт <b>{totalPages}</b> {plural(totalPages)}.</>}
        </PNote>
      </PSection>

      {/* 3. Печать */}
      <PSection icon="Printer" title="Печать">
        {printers.length > 0 ? (
          <>
            <PSelect value={printerName} onChange={setPrinterName} title="Принтер">
              {printers.map(pr => (
                <option key={pr.name} value={pr.name}>{pr.name}{pr.isDefault ? " (по умолчанию)" : ""}</option>
              ))}
            </PSelect>
            <PNote tone="ok">Печать сразу на выбранный принтер — без окна Windows.</PNote>
          </>
        ) : (
          <PNote>Принтер и двустороннюю печать вы выберете в окне Windows после нажатия «Печать».</PNote>
        )}
        <div className="grid gap-2 items-end" style={{ gridTemplateColumns: "90px 1fr" }}>
          <PField label="Копии" value={copies} min={1} max={99} step={1}
            onChange={v => setCopies(Math.min(99, Math.max(1, Math.round(v) || 1)))} />
          <div className="pb-1"><PCheck checked={showPageNumbers} onChange={setShowPageNumbers} label="Номера листов" /></div>
        </div>
        {totalPages > 1 && (
          <PCheck checked={reverseOrder} onChange={setReverseOrder} label="В обратном порядке" />
        )}
      </PSection>

      {/* Позиции ПЛА */}
      <PSection icon="MapPin" title="Позиции ПЛА" defaultOpen={false}
        summary={withPlaSheet && positionsCount > 0 ? `+${plaPageCount} ${plural(plaPageCount)}` : "нет"}>
        {positionsCount === 0 ? (
          <PNote>На схеме нет позиций ПЛА.</PNote>
        ) : (
          <>
            <PCheck checked={withPlaSheet} onChange={setWithPlaSheet} label="Приложить перечень позиций" />
            <PNote>
              Отдельными листами после схемы: № и маркер, название, вид аварии, режим проветривания, тип и сценарий.
              Общешахтные позиции ({mineWideCount}) — в начале перечня. Всего позиций: {positionsCount}.
            </PNote>
          </>
        )}
      </PSection>

      {/* 4. Поля */}
      <PSection icon="Frame" title="Поля" defaultOpen={false}
        summary={marginsEqual ? `${marginTop} мм` : `${marginTop}/${marginRight}/${marginBottom}/${marginLeft} мм`}>
        <div className="grid grid-cols-2 gap-2">
          <PField label="Сверху" unit="мм" value={marginTop} min={0} max={50} onChange={v => setMarginTop(clampMargin(v))} />
          <PField label="Снизу" unit="мм" value={marginBottom} min={0} max={50} onChange={v => setMarginBottom(clampMargin(v))} />
          <PField label="Слева" unit="мм" value={marginLeft} min={0} max={50} onChange={v => setMarginLeft(clampMargin(v))} />
          <PField label="Справа" unit="мм" value={marginRight} min={0} max={50} onChange={v => setMarginRight(clampMargin(v))} />
        </div>
        <PNote>Рамка, штамп и условные обозначения настраиваются в «Слое печати» на панели горизонтов.</PNote>
      </PSection>

      {/* 5. Шаблоны */}
      <PSection icon="Bookmark" title="Шаблоны" defaultOpen={false}
        summary={templateNames.length ? `${templateNames.length} шт.` : "нет"}>
        {templateNames.length > 0 && (
          <PSelect value={templateExists ? templateName.trim() : ""}
            onChange={name => { if (name) { setTemplateName(name); loadTemplate(name); } }}>
            <option value="">— применить шаблон —</option>
            {templateNames.map(n => <option key={n} value={n}>{n}</option>)}
          </PSelect>
        )}
        <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Название шаблона"
          className="w-full text-[11.5px] px-2 py-1 outline-none"
          style={{ border: "1px solid var(--c-b2)", borderRadius: 4, background: "var(--c-s1)", color: "var(--c-t1)" }} />
        <div className="grid grid-cols-2 gap-1.5">
          <PButton icon="Save" onClick={saveTemplate} disabled={!templateName.trim()}
            title="Сохранить формат, ориентацию, масштаб, поля и нумерацию листов">
            {templateExists ? "Обновить" : "Сохранить"}
          </PButton>
          <PButton icon="Trash2" danger onClick={() => deleteTemplate(templateName.trim())} disabled={!templateExists}>
            Удалить
          </PButton>
        </div>
      </PSection>

      <div className="mt-auto px-3 py-2.5" style={{ borderTop: "1px solid var(--c-b1)" }}>
        <PButton icon="RotateCcw" onClick={resetAll} className="w-full">Сбросить настройки</PButton>
      </div>
    </div>
  );
}

function clampMargin(v: number) { return Math.min(50, Math.max(0, v || 0)); }
function plural(n: number) { return n === 1 ? "лист" : n < 5 ? "листа" : "листов"; }
