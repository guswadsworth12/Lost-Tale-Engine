import { useEffect, useState } from 'react'

function matches(query: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  } catch {
    return false
  }
}

/** Live `matchMedia` result; false wherever media queries aren't available. */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query))
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    let list: MediaQueryList
    try {
      list = window.matchMedia(query)
    } catch {
      return
    }
    const onChange = () => setValue(list.matches)
    onChange()
    list.addEventListener?.('change', onChange)
    return () => list.removeEventListener?.('change', onChange)
  }, [query])
  return value
}

/**
 * Reduced motion, from either source this app honours: the OS setting, or Settings → Appearance →
 * Reduced motion (which puts `.reduced-motion` on the root element; see `useApplyTheme`).
 */
export function usePrefersReducedMotion(): boolean {
  const system = useMediaQuery('(prefers-reduced-motion: reduce)')
  const app = typeof document !== 'undefined' && document.documentElement.classList.contains('reduced-motion')
  return system || app
}
