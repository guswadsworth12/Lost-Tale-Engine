/**
 * The Lost Tales Engine mark: a hanging lantern with an amber flame. The frame takes
 * `currentColor` (the theme accent where it's used); the flame keeps its own warm colour so the
 * mark reads the same in light and dark themes. `public/favicon.svg` is the same drawing.
 */
export function BrandMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="2.6" r="1.35" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.2 6.2 L12 4 L15.8 6.2 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="7" y="6.2" width="10" height="12" rx="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 8.6 C13.9 10.7 14.5 12.1 14.5 13.3 A2.5 2.5 0 0 1 9.5 13.3 C9.5 12.1 10.1 10.7 12 8.6 Z" fill="#f5b544" />
      <path d="M12 11.4 C12.8 12.3 13 12.9 13 13.4 A1 1 0 0 1 11 13.4 C11 12.9 11.2 12.3 12 11.4 Z" fill="#fff3cf" />
      <rect x="8.6" y="18.2" width="6.8" height="2.2" rx="1.1" fill="currentColor" />
    </svg>
  )
}

/** Mark plus wordmark, for places with room to say the name. */
export function BrandWordmark({ size = 28, subtitle = true, className = '' }: { size?: number; subtitle?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} className="shrink-0 text-accent" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-text" style={{ fontSize: size * 0.72 }}>Lost Tales</span>
        {subtitle && <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.28em] text-text-muted">Engine</span>}
      </span>
    </span>
  )
}
