import { useSyncExternalStore } from 'react'
import { collections, placeId } from '../collections/index.ts'
import { appDb, listPlaces, updatePlace } from './db.ts'
import type { PlacePatch } from './db.ts'
import { createEditJournal } from './edit-journal.ts'
import type { EditJournal, JournalEntry } from './edit-journal.ts'
import type { Place } from './types.ts'

// Every place record the screens show, the edits that are not stored yet, and
// the state of saving them. It lives outside React, so a save started on one
// screen finishes, or fails where the user can see it, after that screen is gone.
//
// An edit shows at once: screens read `places`, which is the stored record
// with the waiting edits laid over it. Saves run one at a time, in the order
// the edits were made. When a save fails, every waiting edit leaves `places`
// and moves to `unsaved`, so the list and the totals only ever show what is
// stored or still on its way, and nothing the user typed is thrown away.

/** How long typing must pause before the typed value is saved. */
export const SAVE_DELAY_MS = 600

export type SaveError = { kind: 'newer-version' | 'storage-full' | 'other'; message: string }

export type SavePhase = 'idle' | 'saving' | 'failed' | 'blocked'

export type PlaceStoreState = {
  status: 'loading' | 'ready' | 'error'
  loadError: SaveError | null
  /** Stored records with the edits being saved laid over them. Never contains failed edits. */
  places: ReadonlyMap<string, Place>
  /** Edits whose save failed, per place. Only non-empty patches. */
  unsaved: ReadonlyMap<string, PlacePatch>
  /** Confirmed saves per place id since the app started. A place not in the map has none. */
  saves: ReadonlyMap<string, number>
  save: {
    phase: SavePhase
    /** Why saving stopped. Set only while the phase is 'failed' or 'blocked'. */
    error: SaveError | null
    /** False when the browser refused to keep the note of unconfirmed edits. */
    journaled: boolean
  }
}

export type PlaceStoreDeps = {
  /** Every stored place of every collection. */
  load: () => Promise<Place[]>
  save: (id: string, patch: PlacePatch) => Promise<Place>
  journal: EditJournal
}

export type PlaceStore = {
  subscribe(listener: () => void): () => void
  /** The same object until something changes, and unchanged parts keep their identity. */
  getState(): PlaceStoreState
  /** Reads the stored places. Does nothing once they are loaded; runs again after a failure. */
  load(): Promise<void>
  /** Shows an edit at once and saves it: 'now' immediately, 'soon' when typing pauses. */
  edit(id: string, patch: PlacePatch, when: 'now' | 'soon'): void
  /** Saves waiting edits without the pause. Resolves when nothing is waiting or on its way. */
  flush(): Promise<void>
  /** Sends the edits whose save failed again. */
  retry(): void
  /** Gives up the edits whose save failed. */
  discard(): void
  /** Reads the stored places again, to pick up what another open copy of the app saved. */
  refresh(): Promise<void>
  /**
   * For the page-lifecycle handler: drop failed edits another copy has taken
   * over, re-read, then retry. Nothing is retried when the re-read did not go through.
   */
  resume(): Promise<void>
}

type Field = keyof PlacePatch

const FIELDS: readonly Field[] = ['done', 'date', 'km', 'stravaUrl', 'notes']

type Entry = {
  /** The record as last read from or written to the database. */
  saved: Place
  /** Edits waiting for their save. */
  queued: PlacePatch
  /** Edits whose save failed. */
  failed: PlacePatch
}

function copyField<K extends Field>(into: PlacePatch, from: PlacePatch, key: K): void {
  into[key] = from[key]
}

function isEmpty(patch: PlacePatch): boolean {
  return Object.keys(patch).length === 0
}

/** Removes the fields of a patch that would not change the record. */
function dropSame(patch: PlacePatch, record: Place): void {
  for (const key of FIELDS) {
    if (key in patch && Object.is(patch[key], record[key])) delete patch[key]
  }
}

function sameFields<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[]
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]))
}

/** True when two reads of a record hold the same values. The photo list is a new array on every read. */
function sameRecord(a: Place, b: Place): boolean {
  if (a.photoIds.length !== b.photoIds.length || a.photoIds.some((id, index) => id !== b.photoIds[index])) return false
  return sameFields({ ...a, photoIds: b.photoIds }, b)
}

/** What a place holds before anything is stored for it. */
function blankPlace(id: string, collectionId: string): Place {
  return { id, collectionId, done: false, date: null, km: null, stravaUrl: '', notes: '', photoIds: [], updatedAt: '' }
}

function classify(error: unknown): SaveError {
  const message = error instanceof Error ? error.message : String(error)
  // The data layer reports a database upgraded by a newer copy of the app
  // with the browser's VersionError as the cause. The wording is not matched.
  if (error instanceof Error && error.cause instanceof DOMException && error.cause.name === 'VersionError') {
    return { kind: 'newer-version', message }
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return { kind: 'storage-full', message }
  }
  return { kind: 'other', message }
}

export function createPlaceStore(deps: PlaceStoreDeps): PlaceStore {
  const entries = new Map<string, Entry>()
  /** Ids of places with waiting edits, oldest first. */
  let order: string[] = []
  let inFlight: { id: string; patch: PlacePatch } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let draining = false
  let drained: Promise<void> = Promise.resolve()
  /** Counts save runs, so a slow re-read can tell that a save overtook it. */
  let drains = 0
  /** Set when edits were asked to be sent while a save was on its way. */
  let again = false
  /** A newer copy of the app has upgraded the data: this copy can no longer save. */
  let blocked = false
  /** Why the latest failed save failed. Published only while its edits are unsaved or saving is blocked. */
  let lastError: SaveError | null = null
  let journaled = true
  /** False until the journal's edits have been taken over. Until then the journal is not written. */
  let hydrated = false
  let loading: Promise<void> | null = null
  let status: PlaceStoreState['status'] = 'loading'
  let loadError: SaveError | null = null
  let saves: ReadonlyMap<string, number> = new Map()

  let state: PlaceStoreState = {
    status,
    loadError,
    places: new Map(),
    unsaved: new Map(),
    saves,
    save: { phase: 'idle', error: null, journaled },
  }
  const listeners = new Set<() => void>()

  function anyFailed(): boolean {
    for (const entry of entries.values()) if (!isEmpty(entry.failed)) return true
    return false
  }

  function anyQueued(): boolean {
    for (const entry of entries.values()) if (!isEmpty(entry.queued)) return true
    return false
  }

  function phase(): SavePhase {
    if (blocked) return 'blocked'
    if (anyFailed()) return 'failed'
    if (inFlight || anyQueued()) return 'saving'
    return 'idle'
  }

  /**
   * Everything not confirmed as stored, which is what a restart would have to
   * save again, with the stored value each edit was made on.
   */
  function unconfirmed(): JournalEntry[] {
    const list: JournalEntry[] = []
    for (const [id, entry] of entries) {
      const flying = inFlight?.id === id ? inFlight.patch : undefined
      const patch = { ...entry.failed, ...flying, ...entry.queued }
      if (isEmpty(patch)) continue
      const base: PlacePatch = {}
      for (const key of FIELDS) {
        if (!(key in patch)) continue
        // A newer value waits behind one that is on its way. Until that save
        // answers, what the database holds for this field is not known, and a
        // wrong guess would make the next start throw the newer value away.
        if (flying && key in flying && key in entry.queued) continue
        copyField(base, entry.saved, key)
      }
      list.push(isEmpty(base) ? { id, patch } : { id, patch, base })
    }
    return list
  }

  function viewOf(id: string, entry: Entry): Place {
    const flying = inFlight?.id === id ? inFlight.patch : undefined
    if (!flying && isEmpty(entry.queued)) return entry.saved
    return { ...entry.saved, ...flying, ...entry.queued }
  }

  function nextPlaces(previous: ReadonlyMap<string, Place>): ReadonlyMap<string, Place> {
    const next = new Map<string, Place>()
    let changed = previous.size !== entries.size
    for (const [id, entry] of entries) {
      const before = previous.get(id)
      const view = viewOf(id, entry)
      const place = before && sameFields(before, view) ? before : view
      if (place !== before) changed = true
      next.set(id, place)
    }
    return changed ? next : previous
  }

  function nextUnsaved(previous: ReadonlyMap<string, PlacePatch>): ReadonlyMap<string, PlacePatch> {
    const next = new Map<string, PlacePatch>()
    for (const [id, entry] of entries) {
      if (isEmpty(entry.failed)) continue
      const before = previous.get(id)
      // A copy: the screens must never hold an object the store goes on changing.
      next.set(id, before && sameFields(before, entry.failed) ? before : { ...entry.failed })
    }
    const same = next.size === previous.size && [...next].every(([id, patch]) => previous.get(id) === patch)
    return same ? previous : next
  }

  /**
   * Publishes the current state. Parts that did not change keep their
   * identity, so a screen that reads one place is not redrawn for another,
   * and listeners are not called when nothing changed at all.
   */
  function emit(): void {
    // Not before the edits already in the journal have been taken over: until
    // then this store knows of none, and writing that down would erase them.
    if (hydrated) journaled = deps.journal.write(unconfirmed())

    const now = phase()
    // Decided here and nowhere else: once the unsaved edits are saved, given
    // up or undone, the reason they failed is of no interest to anyone.
    const error = now === 'failed' || now === 'blocked' ? lastError : null
    const before = state.save
    const save =
      before.phase === now && before.error === error && before.journaled === journaled
        ? before
        : { phase: now, error, journaled }
    const places = nextPlaces(state.places)
    const unsaved = nextUnsaved(state.unsaved)
    if (
      status === state.status &&
      loadError === state.loadError &&
      places === state.places &&
      unsaved === state.unsaved &&
      saves === state.saves &&
      save === state.save
    ) {
      return
    }
    state = { status, loadError, places, unsaved, saves, save }
    for (const listener of listeners) listener()
  }

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function load(): Promise<void> {
    if (loading) return loading
    if (status === 'ready') return Promise.resolve()
    const mine = read().finally(() => {
      if (loading === mine) loading = null
    })
    loading = mine
    return mine
  }

  async function read(): Promise<void> {
    status = 'loading'
    loadError = null
    emit()
    try {
      const stored = new Map((await deps.load()).map((place) => [place.id, place]))
      // One entry for every bundled place, stored or not, so the screens never
      // have to ask whether a record exists. Nothing is written for a blank one.
      entries.clear()
      for (const collection of collections) {
        for (const { key } of collection.places) {
          const id = placeId(collection.id, key)
          entries.set(id, { saved: stored.get(id) ?? blankPlace(id, collection.id), queued: {}, failed: {} })
        }
      }
      // Edits a previous page load could not confirm are saved now. Entries
      // come oldest first, so a later value of the same field replaces an earlier one.
      order = []
      for (const { id, patch, base } of deps.journal.read()) {
        const entry = entries.get(id)
        if (!entry) continue
        for (const key of FIELDS) {
          if (patch[key] === undefined) continue
          // The field no longer holds what this edit was made on: another
          // open copy of the app has saved it since, and that value is the
          // newer one. The same rule as in refresh().
          if (base && key in base && !Object.is(base[key], entry.saved[key])) continue
          if (Object.is(patch[key], entry.saved[key])) delete entry.queued[key]
          else copyField(entry.queued, patch, key)
        }
      }
      for (const [id, entry] of entries) if (!isEmpty(entry.queued)) order.push(id)
      hydrated = true
      status = 'ready'
      emit()
      if (order.length > 0) void drain()
    } catch (error) {
      // `places` stays empty: defaults must never be shown as if they were the user's data.
      entries.clear()
      order = []
      status = 'error'
      loadError = classify(error)
      emit()
    }
  }

  function edit(id: string, patch: PlacePatch, when: 'now' | 'soon'): void {
    if (status !== 'ready' || blocked) return
    const entry = entries.get(id)
    if (!entry) return

    if (anyFailed()) {
      // Saving has stopped and the user has been told. A new edit joins the
      // unsaved ones and is not sent: trying again on every keystroke would
      // make the warning come and go while the user types.
      for (const key of FIELDS) {
        if (patch[key] === undefined) continue
        if (Object.is(patch[key], entry.saved[key])) delete entry.failed[key]
        else copyField(entry.failed, patch, key)
      }
      emit()
      return
    }

    let changed = false
    for (const key of FIELDS) {
      const value = patch[key]
      if (value === undefined) continue
      // What the database will hold once the save on its way has landed.
      const flying = inFlight?.id === id ? inFlight.patch[key] : undefined
      const baseline = flying === undefined ? entry.saved[key] : flying
      if (Object.is(value, baseline)) {
        // Back to that value: there is nothing to save for this field.
        if (key in entry.queued) {
          delete entry.queued[key]
          changed = true
        }
      } else if (!Object.is(entry.queued[key], value)) {
        copyField(entry.queued, patch, key)
        changed = true
      }
    }
    if (!changed) return

    const position = order.indexOf(id)
    if (isEmpty(entry.queued)) {
      if (position >= 0) order.splice(position, 1)
    } else if (position < 0) {
      order.push(id)
    }
    emit()

    if (order.length === 0) {
      clearTimer()
    } else if (when === 'now') {
      void drain()
    } else {
      clearTimer()
      timer = setTimeout(() => {
        timer = undefined
        void drain()
      }, SAVE_DELAY_MS)
    }
  }

  /** Sends the waiting edits. The only place that calls deps.save, and it never runs twice at once. */
  function drain(): Promise<void> {
    clearTimer()
    if (draining) {
      again = true
      return drained
    }
    if (order.length === 0) return Promise.resolve()
    draining = true
    drains += 1
    drained = sendWaiting()
    return drained
  }

  async function sendWaiting(): Promise<void> {
    try {
      do {
        again = false
        // Edits made from here on wait for the next round, so each field is
        // sent after the save that is already on its way, never alongside it.
        const batch = order.splice(0)
        for (const id of batch) {
          const entry = entries.get(id)
          if (!entry || isEmpty(entry.queued)) continue
          const patch = entry.queued
          entry.queued = {}
          inFlight = { id, patch }
          emit()
          let record: Place
          try {
            record = await deps.save(id, patch)
          } catch (error) {
            fail(id, patch, error)
            return
          }
          // The record the write returned, not a second read.
          entry.saved = record
          inFlight = null
          saves = new Map(saves).set(id, (saves.get(id) ?? 0) + 1)
          emit()
        }
      } while (again && order.length > 0)
    } finally {
      draining = false
    }
  }

  /**
   * A save failed. From here on nothing is shown as if it were on its way:
   * every waiting edit, of every place, becomes an unsaved one.
   */
  function fail(id: string, patch: PlacePatch, error: unknown): void {
    inFlight = null
    for (const [otherId, entry] of entries) {
      // A value typed again while the save was on its way is the newer one.
      const sent = otherId === id ? patch : undefined
      entry.failed = { ...entry.failed, ...sent, ...entry.queued }
      entry.queued = {}
      // An edit that was undone in the meantime is not an unsaved change.
      dropSame(entry.failed, entry.saved)
    }
    order = []
    clearTimer()
    lastError = classify(error)
    blocked = lastError.kind === 'newer-version'
    emit()
  }

  async function flush(): Promise<void> {
    // More than one round when an edit arrives while a save is on its way.
    // It ends after a failure too: nothing is waiting then.
    // A save on its way is waited for by its own promise, so every turn of
    // this loop waits for real work and it can never spin without a pause.
    while (draining || order.length > 0) await (draining ? drained : drain())
  }

  function retry(): void {
    if (status !== 'ready' || blocked || !anyFailed()) return
    // While anything is unsaved nothing else waits, so the unsaved edits become the whole queue.
    order = []
    for (const [id, entry] of entries) {
      if (isEmpty(entry.failed)) continue
      entry.queued = entry.failed
      entry.failed = {}
      order.push(id)
    }
    emit()
    void drain()
  }

  function discard(): void {
    if (!anyFailed()) return
    for (const entry of entries.values()) entry.failed = {}
    emit()
  }

  /** Reads the stored places again. False when it could not, so nothing new is known about what is stored. */
  async function reread(): Promise<boolean> {
    if (status !== 'ready' || blocked || draining) return false
    const before = drains
    let stored: Place[]
    try {
      stored = await deps.load()
    } catch {
      // The screens keep what they have; the next save reports a real problem.
      return false
    }
    // A save that started meanwhile returns a newer record than this read saw.
    if (drains !== before) return false
    let replaced = false
    for (const place of stored) {
      const entry = entries.get(place.id)
      // Compared value by value: two writes can carry the same time stamp.
      if (!entry || sameRecord(entry.saved, place)) continue
      // A field another copy has stored since this one last read it holds the
      // newer value, whatever it is: this copy reads again each time it comes
      // to the front, so its failed edit is from before the user went over
      // there. Sending that edit again would put the older value back without
      // a word, so it is given up.
      for (const key of FIELDS) {
        if (key in entry.failed && !Object.is(entry.saved[key], place[key])) delete entry.failed[key]
      }
      entry.saved = place
      replaced = true
    }
    if (replaced) emit()
    return true
  }

  async function refresh(): Promise<void> {
    await reread()
  }

  async function resume(): Promise<void> {
    // A copy of the app that started later took this copy's unsaved edits
    // over and saves them itself. Sending them from here as well could put an
    // old value over one the user has corrected there since.
    if (anyFailed() && !deps.journal.owned()) discard()
    // A copy that was already open took nothing over, but the user may have
    // corrected a value there: the fresh read gives up the edits that would
    // undo that. Without a fresh read this copy cannot tell, so it sends
    // nothing by itself and leaves "Try again" to the user.
    if (await reread()) retry()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getState: () => state,
    load,
    edit,
    flush,
    retry,
    discard,
    refresh,
    resume,
  }
}

/** The app's one store. Nothing is opened or read until load() is called. */
export const placeStore: PlaceStore = createPlaceStore({
  async load() {
    // The connection is asked for each time and never kept: see appDb().
    const db = await appDb()
    const lists = await Promise.all(collections.map((collection) => listPlaces(db, collection.id)))
    return lists.flat()
  },
  async save(id, patch) {
    return updatePlace(await appDb(), id, patch)
  },
  journal: createEditJournal(() => localStorage),
})

/**
 * Reads one part of the store in a component. The selector must return a part
 * of the state as it is (`(s) => s.places.get(id)`), never a new object.
 */
export function usePlaceStore<T>(select: (state: PlaceStoreState) => T): T {
  return useSyncExternalStore(placeStore.subscribe, () => select(placeStore.getState()))
}
