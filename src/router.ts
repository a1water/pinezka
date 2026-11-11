import { useMemo, useSyncExternalStore } from 'react'
import { collections, findPlace, getCollection } from './collections/index.ts'
import type { Collection, PlaceDefinition } from './collections/index.ts'

// Hash routes. The text after `#/` is a collection id, a stored place id or
// `settings`, so a route never needs a lookup table of its own:
//   #/warsaw-districts              the list
//   #/warsaw-districts?show=done    the list, filtered
//   #/warsaw-districts/mokotow      one place
//   #/settings
// Nothing here touches the browser until startRouter() runs, so the parsing
// can be tested without one.

export type ListFilter = 'all' | 'left' | 'done'

export type Route =
  | { name: 'list'; collection: Collection; show: ListFilter }
  | { name: 'place'; collection: Collection; place: PlaceDefinition; placeId: string }
  | { name: 'settings' }
  | { name: 'not-found' }

export const SETTINGS_HASH = '#/settings'

/** The address of a collection's list. The filter is left out when it shows everything. */
export function listHash(collectionId: string, show: ListFilter = 'all'): string {
  return show === 'all' ? `#/${collectionId}` : `#/${collectionId}?show=${show}`
}

/** The address of one place, from its stored id. */
export function placeHash(placeId: string): string {
  return `#/${placeId}`
}

/**
 * Reads the screen an address stands for. An address that matches nothing is
 * `not-found`; it is never quietly turned into another screen.
 */
export function parseRoute(hash: string): Route {
  const text = hash.startsWith('#') ? hash.slice(1) : hash
  const mark = text.indexOf('?')
  const path = mark < 0 ? text : text.slice(0, mark)
  const query = mark < 0 ? '' : text.slice(mark + 1)
  if (path !== '' && !path.startsWith('/')) return { name: 'not-found' }

  // Ids and keys are plain ASCII, so nothing is decoded. Dropping empty parts
  // lets an address with a slash at the end still work.
  const segments = path.split('/').filter((segment) => segment !== '')
  const [first, second] = segments

  if (first === undefined) {
    // The bare app address opens the first collection, with no redirect.
    const home = collections[0]
    return home ? { name: 'list', collection: home, show: 'all' } : { name: 'not-found' }
  }
  if (second === undefined) {
    if (first === 'settings') return { name: 'settings' }
    const collection = getCollection(first)
    if (!collection) return { name: 'not-found' }
    // Parameters this version does not know are ignored, so a later one can add its own.
    const show = new URLSearchParams(query).get('show')
    return { name: 'list', collection, show: show === 'left' || show === 'done' ? show : 'all' }
  }
  if (segments.length === 2) {
    const placeId = `${first}/${second}`
    const ref = findPlace(placeId)
    if (ref) return { name: 'place', collection: ref.collection, place: ref.place, placeId }
  }
  return { name: 'not-found' }
}

// ----- Navigation -----
//
// Going forward is always a plain link. The router only listens, and numbers
// each history entry so it can tell Back from Forward and remember how far
// each screen was scrolled. Next to its number a new entry keeps the address
// it was opened from, which is the entry behind it.

export type Navigation = {
  /** How the current screen was reached. */
  direction: 'start' | 'push' | 'back' | 'forward' | 'replace'
  /** The address shown before. */
  from: string
}

let started = false
let hash = ''
/** Position of the current entry in this tab's history, counted from where the app was opened. */
let idx = 0
let last: Navigation = { direction: 'start', from: '' }
const scrollByEntry = new Map<number, number>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function currentHash(): string {
  return hash
}

/** The number this router stamped on the current history entry, if it has one. */
function stampedIndex(): number | undefined {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null || !('idx' in state)) return undefined
  return typeof state.idx === 'number' ? state.idx : undefined
}

/** True when the entry behind the current one is known to be the list that `listAddress` stands for. */
function listIsBehind(listAddress: string): boolean {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null || !('from' in state)) return false
  if (typeof state.from !== 'string') return false
  const behind = parseRoute(state.from)
  const wanted = parseRoute(listAddress)
  // Any filter will do: the list is to come back the way it was left.
  return behind.name === 'list' && wanted.name === 'list' && behind.collection.id === wanted.collection.id
}

function onHashChange(): void {
  // The screen being left is still on the page, so this is its scroll position.
  scrollByEntry.set(idx, window.scrollY)
  const from = hash
  hash = window.location.hash

  const stamped = stampedIndex()
  let direction: Navigation['direction']
  if (stamped !== undefined) {
    // An entry seen before: the user went back or forward to it.
    direction = stamped < idx ? 'back' : 'forward'
    idx = stamped
  } else {
    // A link made a new entry. It takes the next number, and whatever an
    // earlier entry with that number remembered no longer applies.
    idx += 1
    window.history.replaceState({ idx, from }, '')
    scrollByEntry.delete(idx)
    direction = 'push'
  }
  last = { direction, from }
  notify()
}

/** Starts listening to the address bar. Call once, before the first render. */
export function startRouter(): void {
  if (started) return
  started = true
  // The app restores scroll positions itself, once the screen has its content.
  window.history.scrollRestoration = 'manual'
  hash = window.location.hash
  const stamped = stampedIndex()
  if (stamped !== undefined) {
    // A reload: the entry keeps its number, so Back still knows what is behind it.
    idx = stamped
  } else {
    idx = 0
    window.history.replaceState({ idx }, '')
  }
  last = { direction: 'start', from: hash }
  // Only hashchange, not popstate as well: one navigation fires both, and
  // handling it twice would overwrite the saved scroll position.
  window.addEventListener('hashchange', onHashChange)
}

/** The current address and the screen it stands for. */
export function useRoute(): { hash: string; route: Route } {
  const current = useSyncExternalStore(subscribe, currentHash, currentHash)
  const route = useMemo(() => parseRoute(current), [current])
  return { hash: current, route }
}

/**
 * Changes the list filter in the address without adding a history entry, so
 * Back never steps through filters and the filter is still set after opening
 * a place and coming back.
 */
export function replaceFilter(collectionId: string, show: ListFilter): void {
  const next = listHash(collectionId, show)
  if (next === hash) return
  const from = hash
  // replaceState, because location.replace would drop the entry's number.
  window.history.replaceState({ idx }, '', next)
  hash = next
  last = { direction: 'replace', from }
  notify()
}

/**
 * Goes back to the list `fallbackHash` stands for. When that list is the
 * entry behind this one, this is the phone's own back button. A screen opened
 * straight from a link has nothing behind it, and one whose address was
 * entered while another screen was showing has that screen behind it; such a
 * screen turns into `fallbackHash` instead.
 */
export function goBack(fallbackHash: string): void {
  if (idx > 0 && listIsBehind(fallbackHash)) {
    window.history.back()
    return
  }
  if (fallbackHash === hash) return
  const from = hash
  window.history.replaceState({ idx }, '', fallbackHash)
  hash = fallbackHash
  scrollByEntry.delete(idx)
  last = { direction: 'back', from }
  notify()
}

/** How the current screen was reached, for scroll and focus handling. */
export function lastNavigation(): Navigation {
  return last
}

/** How far the current history entry was scrolled when it was left, if it has been shown before. */
export function savedScroll(): number | undefined {
  return scrollByEntry.get(idx)
}
