// ─────────────────────────────────────────────────────────────────────────────
// BrandMark — фирменный знак «ПВ»: янтарный скруглённый квадрат, в нём
// стилизованная стрелка воздушного потока — две струи сливаются в одну и
// уходят по стволу вверх. Рядом (не внутри) может идти надпись «ПВ-Система».
// Используется в шапке вкладок и в водяном знаке демо-версии.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  size?: number;
  className?: string;
  title?: string;
}

export default function BrandMark({ size = 22, className, title = "ПВ-Система" }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <linearGradient id="pv-amber" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5b83d" />
          <stop offset="1" stopColor="#e8a317" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="7" fill="url(#pv-amber)" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="6.5" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="1" />
      <g fill="none" stroke="#1f2328" strokeLinecap="round" strokeLinejoin="round">
        {/* Две боковые струи сливаются к оси */}
        <path d="M6.5 25.5 C 11 25.5, 14 22.5, 16 18" strokeWidth="2.4" opacity=".5" />
        <path d="M25.5 25.5 C 21 25.5, 18 22.5, 16 18" strokeWidth="2.4" opacity=".5" />
        {/* Основной поток — стрелка вверх по стволу */}
        <path d="M16 26 L16 7.5" strokeWidth="3" />
        <path d="M10.5 13 L16 7 L21.5 13" strokeWidth="3" />
      </g>
    </svg>
  );
}

/** Знак + надпись «ПВ-Система» — для шапки и водяного знака. */
export function BrandLockup({ size = 20, color = "#e8eaed", accent = "#e8a317" }: { size?: number; color?: string; accent?: string }) {
  return (
    <span className="inline-flex items-center select-none" style={{ gap: size * 0.4 }}>
      <BrandMark size={size} />
      <span style={{ fontFamily: "var(--font-ui)", fontSize: size * 0.68, fontWeight: 700, letterSpacing: "0.01em", color, lineHeight: 1 }}>
        ПВ<span style={{ color: accent }}>-</span>Система
      </span>
    </span>
  );
}
