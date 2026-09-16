// ─────────────────────────────────────────────────────────────────────────────
// CadScaleSettingsModal — диалог настройки пределов масштабов.
// Выделен из CadModals без изменений разметки и логики (1:1).
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";

export interface CadScaleSettingsModalProps {
  scaleSettingsOpen: boolean;
  setScaleSettingsOpen: (v: boolean) => void;
  scaleTextMin: number; setScaleTextMin: (v: number) => void;
  scaleTextMax: number; setScaleTextMax: (v: number) => void;
  scaleBranchMin: number; setScaleBranchMin: (v: number) => void;
  scaleBranchMax: number; setScaleBranchMax: (v: number) => void;
  /** Ширина ветви зависит от площади её сечения (см. branchWidthBySection.ts). */
  widthBySectionOn: boolean; setWidthBySectionOn: (v: boolean) => void;
  tube3dOn: boolean; setTube3dOn: (v: boolean) => void;
  scalePositionMin: number; setScalePositionMin: (v: number) => void;
  scalePositionMax: number; setScalePositionMax: (v: number) => void;
  positionGostMm: number; setPositionGostMm: (v: number) => void;
  bulkheadScale: number; setBulkheadScale: (v: number) => void;
  fanScale: number; setFanScale: (v: number) => void;
  setScaleLimitsEnabled: (v: boolean) => void;
}

export default function CadScaleSettingsModal(p: CadScaleSettingsModalProps) {
  return (
    <>
      {/* ═══ ДИАЛОГ НАСТРОЙКИ ПРЕДЕЛОВ МАСШТАБОВ ═══════════════════════ */}
      {p.scaleSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => p.setScaleSettingsOpen(false)}>
          {/* Боковое меню разделов убрано.
              Из шести пунктов работал только «Пределы масштабов» — остальные
              («Схема», «Единицы измерения», «Координатная сетка», «Размеры
              объектов», «Цвета и шрифты») были нерабочими надписями: клик по
              ним ничего не открывал. Пустые пункты создают ложное ожидание
              настроек, которых нет, поэтому окно оставлено одностраничным. */}
          <div className="bg-white shadow-2xl border border-gray-300 flex"
            style={{ minWidth: 560, fontFamily: "Segoe UI, Tahoma, sans-serif", borderRadius: 0 }}
            onClick={e => e.stopPropagation()}>
            <div className="flex flex-col" style={{ flex: 1 }}>
              {/* Заголовок */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-300"
                style={{ background: "linear-gradient(180deg,var(--c-grad-a, #e8e8e8),var(--c-grad-b, #d8d8d8))" }}>
                <span className="text-[12px] font-semibold text-gray-800">Пределы масштабов</span>
                <button onClick={() => p.setScaleSettingsOpen(false)}
                  className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white text-gray-600">
                  <Icon name="X" size={12} />
                </button>
              </div>

              {/* Подзаголовок внутри убран: после удаления бокового меню он
                  повторял бы заголовок окна слово в слово. */}
              <div className="px-6 py-4 flex-1">
                {/* Таблица */}
                <table className="text-[12px] w-full mb-4" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th className="text-left py-1 pr-4 font-normal text-gray-500" style={{ width: "50%" }}></th>
                      <th className="text-center py-1 px-3 font-semibold text-gray-700" style={{ width: "25%" }}>Минимум</th>
                      <th className="text-center py-1 px-3 font-semibold text-gray-700" style={{ width: "25%" }}>Максимум</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Строка 1: Текстовые объекты */}
                    <tr style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)" }}>
                      <td className="py-2 pr-4 text-gray-700" style={{ verticalAlign: "top" }}>
                        Размер текстовых объектов<br />
                        <span className="text-[11px] text-gray-500">(номер узла, номер ветви, номер устройства, название и т.п.)</span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scaleTextMin}
                            onChange={e => p.setScaleTextMin(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid var(--c-b3, #999)", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scaleTextMax}
                            onChange={e => p.setScaleTextMax(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid var(--c-b3, #999)", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 2: Толщина ветви + режим «по сечению».
                        Галочка стоит здесь, а не отдельной настройкой: она
                        управляет ровно тем же — шириной линии выработки, и
                        пределы ниже действуют на неё же. */}
                    <tr style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)" }}>
                      <td className="py-2 pr-4 text-gray-700" style={{ verticalAlign: "top" }}>
                        <div>Толщина ветви</div>
                        <label className="flex items-start gap-1.5 mt-1.5 cursor-pointer select-none">
                          <input type="checkbox" checked={p.widthBySectionOn}
                            onChange={e => {
                              const on = e.target.checked;
                              p.setWidthBySectionOn(on);
                              // Разброс сечений на руднике — десятки раз, а
                              // прежние пределы (80–150%) рассчитаны на ручную
                              // подгонку толщины. В них разница между стволом и
                              // сбойкой почти незаметна, и смысл режима теряется.
                              // При первом включении раздвигаем их до рабочих,
                              // но только если они остались стандартными —
                              // осознанно выставленные числа не трогаем.
                              if (on && p.scaleBranchMin === 80 && p.scaleBranchMax === 150) {
                                p.setScaleBranchMin(30);
                                p.setScaleBranchMax(300);
                              }
                            }}
                            className="mt-0.5" />
                          <span className="text-[11px]">
                            <span className="text-gray-700">Масштаб выработок по сечению</span>
                            <span className="block text-[11px] text-gray-500">
                              Ширина линии зависит от площади сечения: схема выглядит как
                              фактическая модель, а ошибки в сечении (2 вместо 20) сразу
                              видно. Выключено — все выработки одной толщины.
                              Пределы справа задают, насколько тонкой и толстой может
                              стать линия.
                            </span>
                          </span>
                        </label>
                        {/* Объёмный вид — рядом с толщиной ветви: обе настройки
                            управляют тем, как выглядит сама выработка. */}
                        <label className="flex items-start gap-1.5 mt-2 cursor-pointer select-none">
                          <input type="checkbox" checked={p.tube3dOn}
                            onChange={e => p.setTube3dOn(e.target.checked)}
                            className="mt-0.5" />
                          <span className="text-[11px]">
                            <span className="text-gray-700">Объёмный вид выработок (3D)</span>
                            <span className="block text-[11px] text-gray-500">
                              Выработка рисуется трубой по реальному сечению: ствол —
                              круглый, квершлаг — сводчатый, штрек — трапеция. Видно
                              только в объёмных ракурсах (ИЗО, фронт, профиль): на плане
                              труба выглядит как обычная линия. Вблизи — объём, при
                              отдалении автоматически возвращаются линии, чтобы схема
                              не тормозила.
                            </span>
                          </span>
                        </label>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scaleBranchMin}
                            onChange={e => p.setScaleBranchMin(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid var(--c-b3, #999)", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scaleBranchMax}
                            onChange={e => p.setScaleBranchMax(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid var(--c-b3, #999)", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 3: Масштаб перемычек */}
                    <tr style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)" }}>
                      <td className="py-2 pr-4" style={{ verticalAlign: "top" }}>
                        <div className="text-gray-700">Масштаб перемычек</div>
                        <span className="text-[11px] text-gray-500">(размер по отношению к ширине ветви, синхронно с масштабом схемы)</span>
                      </td>
                      <td className="py-2 px-3 text-center" colSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={20} max={500} value={p.bulkheadScale}
                            onChange={e => p.setBulkheadScale(Math.max(20, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 60, height: 22, border: "1px solid var(--c-b3, #999)", outline: "none" }} />
                          <span className="text-gray-500">% от ширины ветви</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 4: Масштаб вентиляторов */}
                    <tr style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)" }}>
                      <td className="py-2 pr-4" style={{ verticalAlign: "top" }}>
                        <div className="text-gray-700">Масштаб вентиляторов</div>
                        <span className="text-[11px] text-gray-500">(размер по отношению к ширине ветви, синхронно с масштабом схемы)</span>
                      </td>
                      <td className="py-2 px-3 text-center" colSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={50} max={2000} value={p.fanScale}
                            onChange={e => p.setFanScale(Math.max(50, Math.min(2000, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 60, height: 22, border: "1px solid var(--c-b3, #999)", outline: "none" }} />
                          <span className="text-gray-500">% от ширины ветви</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 5: Пределы масштаба Позиций ПЛА */}
                    <tr style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)" }}>
                      <td className="py-2 pr-4 text-gray-700" style={{ verticalAlign: "middle" }}>
                        Размер позиций ПЛА
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scalePositionMin}
                            onChange={e => p.setScalePositionMin(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid var(--c-b3, #999)", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scalePositionMax}
                            onChange={e => p.setScalePositionMax(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid var(--c-b3, #999)", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 6: ГОСТ-размер маркера позиции ПЛА */}
                    <tr style={{ borderTop: "1px solid var(--c-b1, #e5e7eb)" }}>
                      <td className="py-2 pr-4" style={{ verticalAlign: "top" }}>
                        <div className="text-gray-700">Размер позиции по ГОСТ</div>
                        <span className="text-[11px] text-gray-500">(диаметр маркера позиции ПЛА на чертеже, по умолчанию 13 мм)</span>
                      </td>
                      <td className="py-2 px-3 text-center" colSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={2} max={100} step={0.5} value={p.positionGostMm}
                            onChange={e => p.setPositionGostMm(Math.max(2, Math.min(100, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 60, height: 22, border: "1px solid var(--c-b3, #999)", outline: "none" }} />
                          <span className="text-gray-500">мм</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Подвал диалога */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-gray-300" style={{ background: "var(--c-s2, #f5f5f5)" }}>
                <button
                  onClick={() => {
                    p.setScaleTextMin(80); p.setScaleTextMax(150);
                    p.setScaleBranchMin(80); p.setScaleBranchMax(150);
                    p.setWidthBySectionOn(false);
                    p.setScalePositionMin(80); p.setScalePositionMax(150);
                    p.setPositionGostMm(13);
                    p.setBulkheadScale(150); p.setFanScale(450);
                  }}
                  className="px-4 py-1 text-[12px] border border-gray-400 bg-white hover:bg-gray-100"
                  style={{ minWidth: 70 }}>
                  Сброс
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      p.setScaleLimitsEnabled(true);
                      p.setScaleSettingsOpen(false);
                    }}
                    className="px-4 py-1 text-[12px] border border-gray-500 bg-white hover:bg-gray-100"
                    style={{ minWidth: 70 }}>
                    ОК
                  </button>
                  <button
                    onClick={() => p.setScaleSettingsOpen(false)}
                    className="px-4 py-1 text-[12px] border border-gray-500 bg-white hover:bg-gray-100"
                    style={{ minWidth: 70 }}>
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
