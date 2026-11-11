import { findPlace } from '../collections/index.ts'
import { isCalendarDate } from './db.ts'
import type { PlacePatch } from './db.ts'

// A note of edits that IndexedDB has not confirmed yet, kept in localStorage.
// A save reads the record before it writes it, and that read never finishes in
// a page that is being reloaded or closed, so an edit made in the last moment
// would be lost. Writing to localStorage finishes at once; the note is read
// back at the next start and the edits are saved then.
//
// Every page load writes under a key of its own. Two open copies of the app
// therefore never overwrite each other's notes, and a copy that starts later
// picks up what the others left behind.
//
// For milestone 6: importing a backup and resetting the app must remove every
// key that starts with JOURNAL_PREFIX and then reload the place store,
// otherwise old edits would be replayed onto the new data.
//
// For a later format: a change to the fields of a place must come with a new
// `v`, and that version must still read `v: 1` notes or drop them on purpose.

export type JournalEntry = {
  id: string
  patch: PlacePatch
  /**
   * What was stored in the edited fields when the edit was made, as far as
   * its writer knew. With it a reader can tell that a field has been saved
   * with another value since, by another open copy of the app, and leave that
   * newer value alone. A field that is missing here is not checked.
   */
  base?: PlacePatch
}

export type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export type EditJournal = {
  /** Every valid unconfirmed edit left by any earlier or other page load, oldest first. */
  read(): JournalEntry[]
  /** Replaces this page load's own entries. False when the browser refused to store them. */
  write(entries: readonly JournalEntry[]): boolean
  /** True while this page load's key still holds what it last wrote (false once another copy consumed it). */
  owned(): boolean
}

// Namespaced: GitHub Pages serves every project of one account from the same
// origin, and localStorage is shared per origin.
export const JOURNAL_PREFIX = 'pinezka:unsaved-edits:'

const VERSION = 1

/**
 * `storage` is asked for on every use and never at import time, so a browser
 * that blocks storage, or a test with none, only makes the journal report
 * that nothing could be kept.
 */
export function createEditJournal(
  storage: () => JournalStorage,
  sessionId: () => string = () => crypto.randomUUID(),
): EditJournal {
  let ownKey: string | undefined
  /** The exact text under the own key, or null when the key is meant to be absent. */
  let written: string | null = null
  /** The edits inside `written`. Compared instead of the whole text, which also carries the time. */
  let writtenEdits: string | null = null
  /** Keys of other page loads whose edits read() handed over and the next write may remove. */
  let consumed: string[] = []

  function key(): string {
    ownKey ??= JOURNAL_PREFIX + sessionId()
    return ownKey
  }

  function read(): JournalEntry[] {
    const notes: { at: number; edits: JournalEntry[] }[] = []
    const seen: string[] = []
    try {
      const store = storage()
      for (let index = 0; index < store.length; index += 1) {
        const name = store.key(index)
        // The own key is skipped: what this page load wrote, it still has in memory.
        if (name === null || !name.startsWith(JOURNAL_PREFIX) || name === ownKey) continue
        const note = parseNote(store.getItem(name))
        // A note in a format from a newer copy of the app is left for that copy.
        if (note === 'other-version') continue
        seen.push(name)
        if (note) notes.push(note)
      }
    } catch {
      return []
    }
    consumed = seen
    // Oldest first, so where two notes hold the same field the later one is applied last.
    notes.sort((a, b) => a.at - b.at)
    return notes.flatMap((note) => note.edits)
  }

  function write(entries: readonly JournalEntry[]): boolean {
    let store: JournalStorage
    try {
      store = storage()
      if (entries.length === 0) {
        if (written !== null) store.removeItem(key())
        written = null
        writtenEdits = null
      } else {
        // An entry without `base` is written without one: JSON leaves the key out.
        const edits = JSON.stringify(entries.map(({ id, patch, base }) => ({ id, patch, base })))
        if (edits !== writtenEdits) {
          const text = `{"v":${VERSION},"at":${Date.now()},"edits":${edits}}`
          store.setItem(key(), text)
          written = text
          writtenEdits = edits
        }
      }
    } catch {
      // An older note left under the own key would bring back values the user
      // has since changed, so the key is cleared rather than left stale.
      written = null
      writtenEdits = null
      try {
        if (ownKey !== undefined) storage().removeItem(ownKey)
      } catch {
        // Storage is unusable; there is nothing more to clean up.
      }
      return false
    }
    // Only now, with the own note safely stored, are the notes it replaces
    // removed. Had this come first, a refused write would leave the edits nowhere.
    try {
      for (const name of consumed) store.removeItem(name)
      consumed = []
    } catch {
      // Tried again with the next write.
    }
    return true
  }

  function owned(): boolean {
    if (written === null || ownKey === undefined) return true
    try {
      return storage().getItem(ownKey) === written
    } catch {
      // Unknown is not "taken over": the edits stay this page load's to save.
      return true
    }
  }

  return { read, write, owned }
}

/** One stored note, checked field by field. Anything unexpected is dropped, never guessed at. */
function parseNote(text: string | null): { at: number; edits: JournalEntry[] } | 'other-version' | null {
  if (text === null) return null
  let note: unknown
  try {
    note = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(note)) return null
  if (note.v !== VERSION) return typeof note.v === 'number' ? 'other-version' : null
  if (typeof note.at !== 'number' || !Number.isFinite(note.at) || !Array.isArray(note.edits)) return null
  const edits: JournalEntry[] = []
  for (const candidate of note.edits as unknown[]) {
    const entry = parseEntry(candidate)
    if (entry) edits.push(entry)
  }
  return { at: note.at, edits }
}

function parseEntry(value: unknown): JournalEntry | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !findPlace(value.id)) return null
  const patch = parseFields(value.patch)
  if (!patch) return null
  // Notes written before edits carried a base have none, and a base that
  // cannot be read is no reason to lose the edit: it is handed over unchecked.
  const base = parseFields(value.base)
  return base ? { id: value.id, patch, base } : { id: value.id, patch }
}

/** The fields of a place a note may hold, or null when there are none or any of them is wrong. */
function parseFields(value: unknown): PlacePatch | null {
  if (!isRecord(value)) return null
  const fields: PlacePatch = {}
  for (const [name, field] of Object.entries(value)) {
    if (name === 'done' && typeof field === 'boolean') fields.done = field
    else if (name === 'date' && (field === null || isCalendarDate(field))) fields.date = field
    else if (name === 'km' && (field === null || isDistance(field))) fields.km = field
    else if (name === 'stravaUrl' && typeof field === 'string') fields.stravaUrl = field
    else if (name === 'notes' && typeof field === 'string') fields.notes = field
    // One wrong field makes all of them suspect.
    else return null
  }
  return Object.keys(fields).length > 0 ? fields : null
}

function isDistance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
