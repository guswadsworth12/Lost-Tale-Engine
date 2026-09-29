import { vi } from 'vitest'
import { RELAY_HEADERS, RELAY_PATH } from '@/lib/accounts/contract'

/** What the upstream service (or this server, for a same-origin call) is asked, as the relay would forward it. */
export interface UpstreamInit extends Omit<RequestInit, 'headers'> {
  /** Lower-cased header names, without the relay's own `x-relay-*` instructions. */
  headers: Record<string, string>
  /** The relay's instructions; undefined for a same-origin call that never went through it. */
  relay?: { secret: string | null; auth: string | null; username: string | null }
}

/**
 * Test-only: stubs `fetch` with the relay's side of the wire. A request to `RELAY_PATH` is handed
 * to `upstream` as its real target URL, with the relay's instructions in `init.relay` and only the
 * headers the service itself would receive. A same-origin request is handed over as-is (`relay`
 * undefined). Returns the raw stub, for assertions on what actually left the browser.
 */
export function stubRelayedFetch(upstream: (url: string, init: UpstreamInit) => Response | Promise<Response>) {
  const raw = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const headers = new Headers(init.headers)
    const forwarded: Record<string, string> = {}
    headers.forEach((value, name) => {
      if (!name.startsWith('x-relay-')) forwarded[name] = value
    })
    if (url !== RELAY_PATH) return upstream(url, { ...init, headers: forwarded })
    return upstream(headers.get(RELAY_HEADERS.target) ?? '', {
      ...init,
      headers: forwarded,
      relay: {
        secret: headers.get(RELAY_HEADERS.secret),
        auth: headers.get(RELAY_HEADERS.auth),
        username: headers.get(RELAY_HEADERS.username),
      },
    })
  })
  vi.stubGlobal('fetch', raw)
  return raw
}
