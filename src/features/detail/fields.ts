// What the user types in the detail screen's fields, turned into what is stored.
// Kept free of React so every rule is unit-tested.

export type Parsed<T> = { ok: true; value: T } | { ok: false }

/**
 * Kilometres as typed. A comma or a dot is the decimal mark, so "12,4" and
 * "12.4" are both 12.4. Empty text means no distance.
 */
export function parseKm(text: string): Parsed<number | null> {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  const plain = trimmed.replace(',', '.')
  if (!/^(\d+\.?\d*|\.\d+)$/.test(plain)) return { ok: false }
  const value = Number(plain)
  return Number.isFinite(value) ? { ok: true, value } : { ok: false }
}

/** A stored distance as the text of the km field. */
export function kmText(km: number | null): string {
  return km === null ? '' : String(km)
}

const kmFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })

/** A distance for display, to one decimal at most: "12.4 km". */
export function formatKm(km: number): string {
  return `${kmFormat.format(km)} km`
}

// A fixed list, not Intl: the browser's own short names differ between versions
// ("Sep" in one, "Sept" in another), and the same date must read the same everywhere.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A stored `YYYY-MM-DD` date for display: "8 Nov 2026". */
export function formatDay(date: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const month = parts ? MONTHS[Number(parts[2]) - 1] : undefined
  // Anything that is not a stored date is shown as it is, never as "undefined".
  if (!parts || month === undefined) return date
  return `${Number(parts[3])} ${month} ${parts[1]}`
}

/** Today's date on the phone's own calendar, as `YYYY-MM-DD`. */
export function today(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * The address to open for a stored link, or null when it is not a web address.
 * Only http and https are ever turned into a link.
 */
export function webLink(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname.includes('.')) return null
  return url.href
}

/** Longer than any real activity link, and short enough to store without a thought. */
const MAX_LINK_LENGTH = 2000

/**
 * The link field as typed or pasted. Strava's share button copies a sentence
 * that ends with the link, so a web address found inside other text is taken
 * out of it. Empty text means no link.
 */
export function parseLink(text: string): Parsed<string> {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: '' }
  const pasted = /https?:\/\/\S+/i.exec(trimmed)
  // Punctuation right after a link belongs to the sentence around it.
  const candidate = pasted ? pasted[0].replace(/[.,;:!?)]+$/, '') : trimmed
  const href = webLink(candidate)
  if (href === null || href.length > MAX_LINK_LENGTH) return { ok: false }
  return { ok: true, value: href }
}
