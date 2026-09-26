import React from "react";

interface Props {
  children: React.ReactNode;
  /** Название окна — для сообщения об ошибке. */
  title: string;
  onClose: () => void;
}
interface State { error: Error | null }

/**
 * Предохранитель для окон расчётов (подбор режима и т. п.).
 *
 * Без него ошибка внутри окна роняла всё приложение — пользователь видел
 * белый экран и терял несохранённую схему. Теперь вместо окна показывается
 * сообщение об ошибке, а схема и остальной интерфейс продолжают работать.
 */
export default class DialogErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[DialogErrorBoundary] Ошибка в окне «${this.props.title}»:`, error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fixed inset-0 z-[210] flex items-start justify-center pt-24"
        style={{ background: "rgba(0,0,0,0.35)" }}>
        <div className="rounded-lg shadow-2xl p-4 flex flex-col gap-2"
          style={{ width: 460, background: "var(--c-s1, #fff)", border: "1px solid var(--c-red, #dc2626)" }}>
          <div className="font-semibold text-[13px]" style={{ color: "var(--c-red-ink, #991b1b)" }}>
            Ошибка в окне «{this.props.title}»
          </div>
          <div className="text-[12px] break-words" style={{ color: "var(--c-t2, #3a3f45)" }}>
            {this.state.error.message}
          </div>
          <div className="text-[11px]" style={{ color: "var(--c-t3, #6b7280)" }}>
            Схема и остальные расчёты не пострадали. Закройте окно и повторите расчёт.
          </div>
          <div className="flex justify-end pt-1">
            <button
              onClick={() => { this.setState({ error: null }); this.props.onClose(); }}
              className="px-3 py-1 rounded text-[12px]"
              style={{ background: "var(--c-accent, #1e5a7a)", color: "#fff", border: "none", cursor: "pointer" }}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    );
  }
}
