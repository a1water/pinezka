import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { warsawDistricts } from '../collections/index.ts'
import { progress } from '../features/list/progress.ts'
import { appDb, getMeta, getPlace, listPlaces, openAppDb, updatePlace } from './db.ts'
import type { AppDb, PlacePatch } from './db.ts'
import { createEditJournal, JOURNAL_PREFIX } from './edit-journal.ts'
import type { EditJournal, JournalEntry, JournalStorage } from './edit-journal.ts'
import { migrations } from './migrations.ts'
import { createPlaceStore, placeStore, SAVE_DELAY_MS } from './place-store.ts'
import type { PlaceStore, PlaceStoreDeps } from './place-store.ts'
import type { Place } from './types.ts'

const MOKOTOW = 'warsaw-districts/mokotow'
const WOLA = 'warsaw-districts/wola'
const OCHOTA = 'warsaw-districts/ochota'

// ----- Stand-ins for the database, the journal and localStorage -----

/** The stored records, as the store's `load` and `save` see them. */
function fakeDatabase(changes: Record<string, Partial<Place>> = {}) {
  const records = new Map<string, Place>()
  for (const { key } of warsawDistricts.places) {
    const id = `warsaw-districts/${key}`
    records.set(id, {
      id,
      collectionId: 'warsaw-districts',
      done: false,
      date: null,
      km: null,
      stravaUrl: '',
      notes: '',
      photoIds: [],
      updatedAt: 'seeded',
      ...changes[id],
    })
  }
  let writes = 0
  function write(id: string, patch: PlacePatch, by: string): Place {
    const current = records.get(id)
    if (!current) throw new Error(`The fake database has no ${id}`)
    writes += 1
    const next = { ...current, ...patch, updatedAt: `${by}-${writes}` }
    records.set(id, next)
    return next
  }
  return {
    records,
    write: (id: string, patch: PlacePatch) => write(id, patch, 'saved'),
    /** A write by another open copy of the app, which this store is not told about. */
    writeElsewhere: (id: string, patch: PlacePatch) => write(id, patch, 'elsewhere'),
  }
}

/** A journal that remembers what it was last given. */
function fakeJournal(left: JournalEntry[] = []) {
  const notes = {
    current: [] as JournalEntry[],
    writes: 0,
    reads: 0,
    /** Set to false to act like a browser that refuses to store. */
    accepts: true,
    owned: true,
  }
  const journal: EditJournal = {
    read() {
      notes.reads += 1
      return left
    },
    write(entries) {
      notes.writes += 1
      if (!notes.accepts) return false
      notes.current = entries.map(({ id, patch }) => ({ id, patch: { ...patch } }))
      return true
    },
    owned: () => notes.owned,
  }
  return { notes, journal }
}

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  const calls = { setItem: 0, removeItem: 0 }
  const storage: JournalStorage = {
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (name) => items.get(name) ?? null,
    setItem(name, value) {
      calls.setItem += 1
      items.set(name, value)
    },
    removeItem(name) {
      calls.removeItem += 1
      items.delete(name)
    },
  }
  return { storage, items, calls }
}

/** A save the test finishes by hand, so it decides what happens while the save is on its way. */
type PendingSave = { id: string; patch: PlacePatch; succeed(): void; fail(error?: unknown): void }

type SetupOptions = {
  db?: ReturnType<typeof fakeDatabase>
  /** Edits a previous page load left in the journal. */
  left?: JournalEntry[]
  journal?: EditJournal
}

function setup(options: SetupOptions = {}) {
  const db = options.db ?? fakeDatabase()
  const { notes, journal } = fakeJournal(options.left)
  const sent: PendingSave[] = []
  let atOnce = 0
  let mostAtOnce = 0

  const save = vi.fn<PlaceStoreDeps['save']>((id, patch) => {
    return new Promise<Place>((resolve, reject) => {
      atOnce += 1
      mostAtOnce = Math.max(mostAtOnce, atOnce)
      sent.push({
        id,
        patch: { ...patch },
        succeed() {
          atOnce -= 1
          resolve(db.write(id, patch))
        },
        fail(error = new Error('The disk said no')) {
          atOnce -= 1
          reject(error)
        },
      })
    })
  })
  const load = vi.fn<PlaceStoreDeps['load']>(async () => [...db.records.values()])
  const store = createPlaceStore({ load, save, journal: options.journal ?? journal })
  const notified = vi.fn()
  store.subscribe(notified)

  return {
    db,
    notes,
    save,
    load,
    store,
    notified,
    state: () => store.getState(),
    place: (id: string) => must(store.getState().places.get(id)),
    /** The save that was started as number `index`, counted from 0. */
    sent(index: number): PendingSave {
      return must(sent[index])
    },
    mostAtOnce: () => mostAtOnce,
  }
}

async function ready(options: SetupOptions = {}) {
  const h = setup(options)
  await h.store.load()
  h.notified.mockClear()
  return h
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a value')
  return value
}

/** Lets everything that waits on an already finished promise run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

async function land(save: PendingSave): Promise<void> {
  save.succeed()
  await settle()
}

async function reject(save: PendingSave, error?: unknown): Promise<void> {
  save.fail(error)
  await settle()
}

function newerVersionError(): Error {
  return new Error('This data was saved by a newer version of Pinezka.', {
    cause: new DOMException('The requested version (1) is less than the existing version (2).', 'VersionError'),
  })
}

function totals(store: PlaceStore) {
  return progress(warsawDistricts, store.getState().places.values())
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ----- Loading -----

describe('loading', () => {
  it('starts out loading, with nothing to show', () => {
    const h = setup()
    expect(h.state()).toEqual({
      status: 'loading',
      loadError: null,
      places: new Map(),
      unsaved: new Map(),
      saves: new Map(),
      save: { phase: 'idle', error: null, journaled: true },
    })
    expect(h.load).not.toHaveBeenCalled()
  })

  it('reads every place once and becomes ready', async () => {
    const db = fakeDatabase({ [MOKOTOW]: { done: true, km: 12.4 } })
    const h = setup({ db })
    await h.store.load()

    expect(h.state().status).toBe('ready')
    expect(h.state().places.size).toBe(18)
    expect(h.place(MOKOTOW)).toBe(db.records.get(MOKOTOW))
    expect(totals(h.store)).toEqual({ total: 18, done: 1, left: 17, km: 12.4 })
    expect(h.notified).toHaveBeenCalledTimes(1)
    expect(h.save).not.toHaveBeenCalled()
  })

  it('does the work on the first call, shares it between callers, and does not read again once ready', async () => {
    const h = setup()
    const first = h.store.load()
    const second = h.store.load()
    expect(second).toBe(first)
    await first
    expect(h.load).toHaveBeenCalledTimes(1)

    await h.store.load()
    expect(h.load).toHaveBeenCalledTimes(1)
  })

  it('gives a place with no stored record a blank one, and stores nothing for it', async () => {
    const db = fakeDatabase()
    db.records.delete(WOLA)
    const h = await ready({ db })

    expect(h.state().places.size).toBe(18)
    expect(h.place(WOLA)).toEqual({
      id: WOLA,
      collectionId: 'warsaw-districts',
      done: false,
      date: null,
      km: null,
      stravaUrl: '',
      notes: '',
      photoIds: [],
      updatedAt: '',
    })
    expect(h.save).not.toHaveBeenCalled()
    expect(totals(h.store)).toEqual({ total: 18, done: 0, left: 18, km: 0 })
  })

  it('leaves out stored records of places the app does not know', async () => {
    const db = fakeDatabase()
    db.records.set('warsaw-districts/atlantis', { ...must(db.records.get(WOLA)), id: 'warsaw-districts/atlantis' })
    const h = await ready({ db })
    expect(h.state().places.size).toBe(18)
    expect(h.state().places.has('warsaw-districts/atlantis')).toBe(false)
  })

  it('reports a failed load, shows no places, and loads on the next try', async () => {
    const h = setup()
    h.load.mockRejectedValueOnce(new Error('cannot open'))
    await h.store.load()

    expect(h.state().status).toBe('error')
    expect(h.state().loadError).toEqual({ kind: 'other', message: 'cannot open' })
    // Empty, so made-up defaults are never shown as if they were the user's data.
    expect(h.state().places.size).toBe(0)

    h.store.edit(MOKOTOW, { done: true }, 'now')
    await h.store.flush()
    h.store.retry()
    await h.store.refresh()
    expect(h.save).not.toHaveBeenCalled()
    expect(h.state().places.size).toBe(0)

    await h.store.load()
    expect(h.load).toHaveBeenCalledTimes(2)
    expect(h.state()).toMatchObject({ status: 'ready', loadError: null })
    expect(h.state().places.size).toBe(18)
  })

  it('shows no places either when loading fails after the records were read', async () => {
    const { journal } = fakeJournal()
    let broken = true
    const h = setup({
      journal: {
        ...journal,
        read() {
          if (broken) throw new Error('journal trouble')
          return [{ id: MOKOTOW, patch: { notes: 'kept' } }]
        },
      },
    })
    await h.store.load()
    expect(h.state()).toMatchObject({ status: 'error', loadError: { kind: 'other', message: 'journal trouble' } })
    expect(h.state().places.size).toBe(0)

    broken = false
    await h.store.load()
    expect(h.state().status).toBe('ready')
    expect(h.place(MOKOTOW).notes).toBe('kept')
  })

  it('shows that it is loading again while the second try runs', async () => {
    const h = setup()
    h.load.mockRejectedValueOnce(new Error('cannot open'))
    await h.store.load()

    let release = () => {}
    h.load.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([...h.db.records.values()]))))
    const loading = h.store.load()
    expect(h.state()).toMatchObject({ status: 'loading', loadError: null })
    release()
    await loading
    expect(h.state().status).toBe('ready')
  })

  it('says why loading failed', async () => {
    const newer = setup()
    newer.load.mockRejectedValueOnce(newerVersionError())
    await newer.store.load()
    expect(newer.state().loadError).toEqual({
      kind: 'newer-version',
      message: 'This data was saved by a newer version of Pinezka.',
    })

    const full = setup()
    full.load.mockRejectedValueOnce(new DOMException('No space left', 'QuotaExceededError'))
    await full.store.load()
    expect(full.state().loadError).toEqual({ kind: 'storage-full', message: 'No space left' })

    const odd = setup()
    odd.load.mockRejectedValueOnce('just a string')
    await odd.store.load()
    expect(odd.state().loadError).toEqual({ kind: 'other', message: 'just a string' })
  })

  it('ignores edits made before the places are loaded', () => {
    const h = setup()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    expect(h.save).not.toHaveBeenCalled()
    expect(h.notified).not.toHaveBeenCalled()
  })
})

// ----- Edits left by a previous page load -----

describe('edits left in the journal', () => {
  it('shows them at once, saves them, and then empties the journal', async () => {
    const h = setup({ left: [{ id: MOKOTOW, patch: { km: 12.4, notes: 'From before the reload' } }] })
    await h.store.load()

    expect(h.place(MOKOTOW)).toMatchObject({ km: 12.4, notes: 'From before the reload' })
    expect(h.state().save.phase).toBe('saving')
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { km: 12.4, notes: 'From before the reload' })
    // Still noted while the save is on its way: a second reload must not lose it.
    expect(h.notes.current).toEqual([{ id: MOKOTOW, patch: { km: 12.4, notes: 'From before the reload' } }])

    await land(h.sent(0))
    expect(h.notes.current).toEqual([])
    expect(h.state().save.phase).toBe('idle')
    expect(h.db.records.get(MOKOTOW)).toMatchObject({ km: 12.4, notes: 'From before the reload' })
  })

  it('saves nothing for an edit that is already stored', async () => {
    const db = fakeDatabase({ [MOKOTOW]: { done: true, km: 5 } })
    const h = setup({ db, left: [{ id: MOKOTOW, patch: { done: true, km: 5 } }] })
    await h.store.load()
    await settle()

    expect(h.save).not.toHaveBeenCalled()
    expect(h.state().save.phase).toBe('idle')
    // Written all the same, so the journal can clear away the note it handed over.
    expect(h.notes.writes).toBeGreaterThan(0)
    expect(h.notes.current).toEqual([])
  })

  it('sends only the fields that differ from what is stored', async () => {
    const db = fakeDatabase({ [MOKOTOW]: { done: true } })
    const h = setup({ db, left: [{ id: MOKOTOW, patch: { done: true, km: 7 } }] })
    await h.store.load()
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { km: 7 })
  })

  it('lets a later note win over an earlier one, field by field', async () => {
    const h = setup({
      left: [
        { id: MOKOTOW, patch: { notes: 'older', km: 5, done: true } },
        { id: WOLA, patch: { done: true } },
        // The later note put the tick back to what is stored.
        { id: MOKOTOW, patch: { notes: 'newer', done: false } },
      ],
    })
    await h.store.load()

    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'newer', km: 5 })
    await land(h.sent(0))
    expect(h.save).toHaveBeenLastCalledWith(WOLA, { done: true })
    await land(h.sent(1))
    expect(h.mostAtOnce()).toBe(1)
  })

  it('skips a note for a place it does not have', async () => {
    const h = setup({ left: [{ id: 'countries/ES', patch: { notes: 'x' } }] })
    await h.store.load()
    expect(h.state().status).toBe('ready')
    expect(h.save).not.toHaveBeenCalled()
  })

  it('leaves out an edit whose field has been stored with another value since the edit was made', async () => {
    // Typed as 5 over an empty field in one copy; 7 was saved from another copy afterwards.
    const db = fakeDatabase({ [MOKOTOW]: { km: 7 } })
    const h = setup({ db, left: [{ id: MOKOTOW, patch: { km: 5 }, base: { km: null } }] })
    await h.store.load()
    await settle()

    expect(h.save).not.toHaveBeenCalled()
    expect(h.place(MOKOTOW).km).toBe(7)
    expect(h.db.records.get(MOKOTOW)?.km).toBe(7)
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(h.state().unsaved.size).toBe(0)
    // The note is cleared away all the same, so no later start brings the 5 back.
    expect(h.notes.current).toEqual([])
    expect(h.notes.writes).toBeGreaterThan(0)
  })

  it('still saves an edit whose field is stored as it was when the edit was made', async () => {
    const h = setup({ left: [{ id: MOKOTOW, patch: { km: 5 }, base: { km: null } }] })
    await h.store.load()

    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { km: 5 })
    await land(h.sent(0))
    expect(h.db.records.get(MOKOTOW)?.km).toBe(5)
  })

  it('decides that field by field, and saves a field the note says nothing about', async () => {
    const db = fakeDatabase({ [MOKOTOW]: { km: 7 }, [WOLA]: { km: 7 } })
    const h = setup({
      db,
      left: [
        { id: MOKOTOW, patch: { km: 5, notes: 'Windy', done: true }, base: { km: null, notes: '', done: false } },
        // A note from before edits carried what they were made on, or one that lost part of it.
        { id: WOLA, patch: { km: 5, notes: 'Flat' }, base: { notes: '' } },
      ],
    })
    await h.store.load()

    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'Windy', done: true })
    expect(h.place(MOKOTOW)).toMatchObject({ km: 7, notes: 'Windy', done: true })
    await land(h.sent(0))
    expect(h.save).toHaveBeenLastCalledWith(WOLA, { km: 5, notes: 'Flat' })
    await land(h.sent(1))
    expect(h.db.records.get(MOKOTOW)).toMatchObject({ km: 7, notes: 'Windy', done: true })
    expect(h.db.records.get(WOLA)).toMatchObject({ km: 5, notes: 'Flat' })
  })

  it('does not write the journal before it has read it, however loading goes', async () => {
    const h = setup({ left: [{ id: MOKOTOW, patch: { notes: 'kept' } }] })
    h.load.mockRejectedValueOnce(new Error('cannot open'))
    await h.store.load()
    expect(h.notes.writes).toBe(0)

    let release = () => {}
    h.load.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([...h.db.records.values()]))))
    const loading = h.store.load()
    // The "loading again" state is published without touching the journal either.
    expect(h.state().status).toBe('loading')
    expect(h.notes.writes).toBe(0)
    release()
    await loading
    expect(h.notes.writes).toBeGreaterThan(0)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'kept' })
  })

  it('keeps the stored note through a failed load, then saves it after a good one', async () => {
    const key = `${JOURNAL_PREFIX}earlier`
    const text = JSON.stringify({ v: 1, at: 1000, edits: [{ id: MOKOTOW, patch: { notes: 'Typed on a full phone' } }] })
    const { storage, items, calls } = fakeStorage({ [key]: text })
    const h = setup({ journal: createEditJournal(() => storage, () => 'now') })

    h.load.mockRejectedValueOnce(newerVersionError())
    await h.store.load()
    expect(h.state().status).toBe('error')
    expect(calls).toEqual({ setItem: 0, removeItem: 0 })
    expect(Object.fromEntries(items)).toEqual({ [key]: text })

    await h.store.load()
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'Typed on a full phone' })
    // Handed over to this page load's own key until the save is confirmed.
    expect([...items.keys()]).toEqual([`${JOURNAL_PREFIX}now`])
    await land(h.sent(0))
    expect(items.size).toBe(0)
    expect(h.db.records.get(MOKOTOW)?.notes).toBe('Typed on a full phone')
  })
})

// ----- Editing and saving -----

describe('an edit', () => {
  it('shows at once and tells listeners once, before anything is saved', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true, km: 12.4 }, 'soon')

    expect(h.notified).toHaveBeenCalledTimes(1)
    expect(h.place(MOKOTOW)).toMatchObject({ done: true, km: 12.4 })
    expect(totals(h.store)).toEqual({ total: 18, done: 1, left: 17, km: 12.4 })
    expect(h.state().save.phase).toBe('saving')
    expect(h.save).not.toHaveBeenCalled()
    expect(h.db.records.get(MOKOTOW)).toMatchObject({ done: false, km: null })
  })

  it('tells listeners once for an edit that is sent straight away, too', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.notified).toHaveBeenCalledTimes(1)
    expect(totals(h.store).done).toBe(1)
  })

  it('is noted in the journal in the same moment', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    expect(h.notes.current).toEqual([{ id: MOKOTOW, patch: { notes: 'a' } }])
    h.store.edit(WOLA, { done: true }, 'soon')
    expect(h.notes.current).toEqual([
      { id: MOKOTOW, patch: { notes: 'a' } },
      { id: WOLA, patch: { done: true } },
    ])
  })

  it('changes only what it touches, so screens watching other parts are left alone', async () => {
    const h = await ready()
    const before = h.state()
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    const after = h.state()

    expect(after).not.toBe(before)
    expect(after.places).not.toBe(before.places)
    expect(after.places.get(MOKOTOW)).not.toBe(before.places.get(MOKOTOW))
    expect(after.places.get(WOLA)).toBe(before.places.get(WOLA))
    expect(after.unsaved).toBe(before.unsaved)
    expect(after.saves).toBe(before.saves)

    // A second keystroke: still saving, so the save part is the same object.
    h.store.edit(MOKOTOW, { notes: 'ab' }, 'soon')
    expect(h.state().save).toBe(after.save)
    expect(h.state().places.get(WOLA)).toBe(before.places.get(WOLA))
  })

  it('keeps the state object until something changes', async () => {
    const h = await ready()
    const before = h.state()
    h.store.edit(MOKOTOW, { done: false, notes: '' }, 'now')
    h.store.edit('warsaw-districts/atlantis', { done: true }, 'now')
    h.store.edit(MOKOTOW, {}, 'now')
    await h.store.flush()
    h.store.retry()
    h.store.discard()
    await h.store.refresh()

    expect(h.state()).toBe(before)
    expect(h.notified).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('never puts a field into a save that the user cannot edit', async () => {
    const h = await ready()
    const sneaky = { notes: 'ok', photoIds: ['x'], updatedAt: 'never' } as PlacePatch
    h.store.edit(MOKOTOW, sneaky, 'now')
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'ok' })
    expect(h.place(MOKOTOW).photoIds).toEqual([])
  })

  it('stops telling a listener that unsubscribed', async () => {
    const h = await ready()
    const listener = vi.fn()
    const unsubscribe = h.store.subscribe(listener)
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    unsubscribe()
    h.store.edit(MOKOTOW, { notes: 'ab' }, 'soon')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('what the note says an edit was made on', () => {
  /** A store on the real journal, and the edits that journal has put in storage. */
  async function noting(db = fakeDatabase()) {
    const { storage, items } = fakeStorage()
    const h = await ready({ db, journal: createEditJournal(() => storage, () => 'mine') })
    const noted = (): unknown => {
      const text = items.get(`${JOURNAL_PREFIX}mine`)
      return text === undefined ? null : (JSON.parse(text) as { edits: unknown }).edits
    }
    return { ...h, items, noted }
  }

  it('is the stored value of every edited field', async () => {
    const h = await noting(fakeDatabase({ [MOKOTOW]: { km: 3 } }))
    h.store.edit(MOKOTOW, { km: 5, notes: 'a' }, 'soon')
    h.store.edit(WOLA, { done: true }, 'soon')

    expect(h.noted()).toEqual([
      { id: MOKOTOW, patch: { km: 5, notes: 'a' }, base: { km: 3, notes: '' } },
      { id: WOLA, patch: { done: true }, base: { done: false } },
    ])
    // The same note format as before: a copy that knows nothing of this still reads it.
    expect(JSON.parse(h.items.get(`${JOURNAL_PREFIX}mine`) ?? '')).toMatchObject({ v: 1 })
  })

  it('stays with an edit whose save failed', async () => {
    const h = await noting()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    await reject(h.sent(0))
    h.store.edit(MOKOTOW, { notes: 'Typed after the failure' }, 'soon')

    expect(h.noted()).toEqual([
      { id: MOKOTOW, patch: { km: 5, notes: 'Typed after the failure' }, base: { km: null, notes: '' } },
    ])
  })

  it('follows the stored value when another copy changes it under an edit that is still waiting', async () => {
    const h = await noting()
    h.store.edit(MOKOTOW, { notes: 'Being typed' }, 'soon')
    h.db.writeElsewhere(MOKOTOW, { notes: 'From the other copy' })
    await h.store.refresh()

    // This copy goes on to save its value over the other one's. The note has
    // to agree, or a restart in this moment would decide differently.
    expect(h.noted()).toEqual([
      { id: MOKOTOW, patch: { notes: 'Being typed' }, base: { notes: 'From the other copy' } },
    ])
  })

  it('is left open for a field while an older value of it is on its way', async () => {
    const h = await noting()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    expect(h.noted()).toEqual([{ id: MOKOTOW, patch: { km: 5 }, base: { km: null } }])

    // Whether the 5 reached the database is not known until its save answers,
    // so the note must not claim the 6 was typed over an empty field.
    h.store.edit(MOKOTOW, { km: 6, notes: 'a' }, 'soon')
    expect(h.noted()).toEqual([{ id: MOKOTOW, patch: { km: 6, notes: 'a' }, base: { notes: '' } }])

    await land(h.sent(0))
    expect(h.noted()).toEqual([{ id: MOKOTOW, patch: { km: 6, notes: 'a' }, base: { km: 5, notes: '' } }])
  })

  it('lets the next start save the newer value whether or not the older one landed', async () => {
    for (const landed of [true, false]) {
      const db = fakeDatabase()
      const { storage, items } = fakeStorage()
      const a = await ready({ db, journal: createEditJournal(() => storage, () => 'a') })
      a.store.edit(MOKOTOW, { km: 5 }, 'now')
      a.store.edit(MOKOTOW, { km: 6 }, 'now')
      // The page is closed here. Its save of 5 may or may not have reached the database.
      if (landed) db.write(MOKOTOW, { km: 5 })

      const b = await ready({ db, journal: createEditJournal(() => storage, () => 'b') })
      expect(b.save).toHaveBeenCalledTimes(1)
      expect(b.save).toHaveBeenCalledWith(MOKOTOW, { km: 6 })
      await land(b.sent(0))
      expect(db.records.get(MOKOTOW)?.km).toBe(6)
      expect(items.size).toBe(0)
    }
  })
})

describe('when an edit is saved', () => {
  it('sends a tick at once', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { done: true })
  })

  it('waits for typing to pause, and starts waiting again with every keystroke', async () => {
    expect(SAVE_DELAY_MS).toBe(600)
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1)
    expect(h.save).not.toHaveBeenCalled()

    h.store.edit(MOKOTOW, { notes: 'ab' }, 'soon')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1)
    expect(h.save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'ab' })
  })

  it('sends two edits of one field as one save with the last value', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 1 }, 'soon')
    h.store.edit(MOKOTOW, { km: 12 }, 'soon')
    h.store.edit(MOKOTOW, { km: 12.4 }, 'soon')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)

    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { km: 12.4 })
  })

  it('sends edits of two fields as one save with both', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 12.4 }, 'soon')
    h.store.edit(MOKOTOW, { notes: 'Windy' }, 'soon')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)

    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { km: 12.4, notes: 'Windy' })
  })

  it('takes typed edits along when a tick is sent at once', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'Windy' }, 'soon')
    h.store.edit(MOKOTOW, { done: true }, 'now')
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'Windy', done: true })

    await land(h.sent(0))
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(h.save).toHaveBeenCalledTimes(1)
  })

  it('saves places in the order they were first edited, one after the other', async () => {
    const h = await ready()
    h.store.edit(WOLA, { notes: 'first' }, 'soon')
    h.store.edit(MOKOTOW, { notes: 'second' }, 'soon')
    h.store.edit(WOLA, { notes: 'first, longer' }, 'soon')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)

    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.sent(0)).toMatchObject({ id: WOLA, patch: { notes: 'first, longer' } })
    await land(h.sent(0))
    expect(h.sent(1)).toMatchObject({ id: MOKOTOW, patch: { notes: 'second' } })
    await land(h.sent(1))
    expect(h.mostAtOnce()).toBe(1)
    expect(h.state().save.phase).toBe('idle')
  })

  it('takes the record the save returned, counts the save for that place only, and settles', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    const whileSaving = h.place(MOKOTOW)
    await land(h.sent(0))

    expect(h.place(MOKOTOW)).toBe(h.db.records.get(MOKOTOW))
    expect(h.place(MOKOTOW)).not.toBe(whileSaving)
    expect(h.place(MOKOTOW).updatedAt).toBe('saved-1')
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(h.state().saves.get(MOKOTOW)).toBe(1)
    expect(h.state().saves.get(WOLA)).toBeUndefined()
    expect(h.notes.current).toEqual([])
    // One read at the start; a save never causes another.
    expect(h.load).toHaveBeenCalledTimes(1)
  })

  it('counts saves per place, so one place’s save says nothing about another', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    await land(h.sent(0))
    const afterFirst = h.state().saves

    h.store.edit(WOLA, { done: true }, 'now')
    expect(h.state().saves).toBe(afterFirst)
    await land(h.sent(1))
    h.store.edit(WOLA, { done: false }, 'now')
    await land(h.sent(2))

    expect(h.state().saves.get(MOKOTOW)).toBe(1)
    expect(h.state().saves.get(WOLA)).toBe(2)
    expect(h.state().saves.get(OCHOTA)).toBeUndefined()
    expect(h.state().saves).not.toBe(afterFirst)
  })
})

describe('edits made while a save is on its way', () => {
  it('are sent only after that save has landed, never alongside it', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    h.store.edit(MOKOTOW, { km: 6 }, 'now')
    h.store.edit(MOKOTOW, { km: 7 }, 'now')
    h.store.edit(WOLA, { done: true }, 'now')
    expect(h.save).toHaveBeenCalledTimes(1)
    // The newest value shows the whole time.
    expect(h.place(MOKOTOW).km).toBe(7)

    await land(h.sent(0))
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.sent(1)).toMatchObject({ id: MOKOTOW, patch: { km: 7 } })
    await land(h.sent(1))
    expect(h.sent(2)).toMatchObject({ id: WOLA, patch: { done: true } })
    await land(h.sent(2))

    expect(h.mostAtOnce()).toBe(1)
    expect(h.save).toHaveBeenCalledTimes(3)
    expect(h.place(MOKOTOW).km).toBe(7)
    expect(h.db.records.get(MOKOTOW)?.km).toBe(7)
    expect(h.state().save.phase).toBe('idle')
  })

  it('wait for typing to pause like any other typed edit', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    await land(h.sent(0))
    // The tick has landed; the note is still being typed.
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.state().save.phase).toBe('saving')
    expect(h.place(MOKOTOW)).toMatchObject({ done: true, notes: 'a' })

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.sent(1)).toMatchObject({ id: MOKOTOW, patch: { notes: 'a' } })
  })

  it('are sent right after it when their pause ran out in the meantime', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(h.save).toHaveBeenCalledTimes(1)

    await land(h.sent(0))
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.mostAtOnce()).toBe(1)
  })

  it('tick, untick, tick: the last tick matches what is on its way, so nothing more is sent', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(MOKOTOW, { done: false }, 'now')
    expect(h.place(MOKOTOW).done).toBe(false)
    h.store.edit(MOKOTOW, { done: true }, 'now')
    expect(h.place(MOKOTOW).done).toBe(true)

    await land(h.sent(0))
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.place(MOKOTOW).done).toBe(true)
    expect(h.state().save.phase).toBe('idle')
  })

  it('tick, untick: the untick is saved second, so the database ends up unticked', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(MOKOTOW, { done: false }, 'now')

    await land(h.sent(0))
    expect(h.sent(1)).toMatchObject({ id: MOKOTOW, patch: { done: false } })
    await land(h.sent(1))
    expect(h.db.records.get(MOKOTOW)?.done).toBe(false)
    expect(h.place(MOKOTOW).done).toBe(false)
    expect(h.mostAtOnce()).toBe(1)
  })
})

describe('edits that change nothing', () => {
  it('saves nothing for a value that is already stored', async () => {
    const db = fakeDatabase({ [MOKOTOW]: { done: true, km: 12.4, date: '2026-10-12' } })
    const h = await ready({ db })
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(MOKOTOW, { km: 12.4, date: '2026-10-12' }, 'soon')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)

    expect(h.save).not.toHaveBeenCalled()
    expect(h.notified).not.toHaveBeenCalled()
    expect(h.notes.current).toEqual([])
    expect(h.state().save.phase).toBe('idle')
  })

  it('saves nothing when a typed value is put back before the pause ends', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    expect(h.notes.current).toHaveLength(1)
    h.store.edit(MOKOTOW, { notes: '' }, 'soon')

    expect(h.state().save.phase).toBe('idle')
    expect(h.place(MOKOTOW)).toBe(h.db.records.get(MOKOTOW))
    expect(h.notes.current).toEqual([])
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2)
    await h.store.flush()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('drops only the field that was put back', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 12, notes: 'Windy' }, 'soon')
    h.store.edit(MOKOTOW, { km: null }, 'soon')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'Windy' })
  })
})

describe('flush', () => {
  it('sends waiting edits without the pause', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    const flushed = h.store.flush()
    expect(h.save).toHaveBeenCalledTimes(1)

    await land(h.sent(0))
    await flushed
    // The pause that was running is over with: nothing is sent a second time.
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(h.save).toHaveBeenCalledTimes(1)
  })

  it('is done only when nothing is waiting, including an edit made while it ran', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    let done = false
    const flushed = h.store.flush().then(() => {
      done = true
    })

    h.store.edit(MOKOTOW, { notes: 'ab' }, 'soon')
    await land(h.sent(0))
    expect(done).toBe(false)
    // Sent at once, not after the pause the second edit asked for.
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.sent(1)).toMatchObject({ id: MOKOTOW, patch: { notes: 'ab' } })

    await land(h.sent(1))
    await flushed
    expect(done).toBe(true)
    expect(h.state().save.phase).toBe('idle')
    expect(h.mostAtOnce()).toBe(1)
  })

  it('waits for a save that is already on its way', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    let done = false
    const flushed = h.store.flush().then(() => {
      done = true
    })
    await settle()
    expect(done).toBe(false)
    expect(h.save).toHaveBeenCalledTimes(1)

    await land(h.sent(0))
    await flushed
    expect(done).toBe(true)
  })

  it('calls nothing when nothing is waiting', async () => {
    const h = await ready()
    await h.store.flush()
    expect(h.save).not.toHaveBeenCalled()
    expect(h.notified).not.toHaveBeenCalled()
  })

  it('ends when the save fails, and does not try again by itself', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    const flushed = h.store.flush()
    await reject(h.sent(0))
    await flushed
    expect(h.state().save.phase).toBe('failed')

    await h.store.flush()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.state().save.phase).toBe('failed')
  })
})

// ----- Failed saves -----

describe('a save that fails', () => {
  it('puts every view back on what is stored, without reading the database again', async () => {
    const db = fakeDatabase({ [MOKOTOW]: { km: 3 } })
    const h = await ready({ db })
    const before = h.state()
    h.store.edit(MOKOTOW, { done: true, km: 12.4 }, 'now')
    expect(totals(h.store)).toEqual({ total: 18, done: 1, left: 17, km: 12.4 })

    await reject(h.sent(0), new Error('The disk said no'))

    expect(h.place(MOKOTOW)).toBe(before.places.get(MOKOTOW))
    expect(totals(h.store)).toEqual({ total: 18, done: 0, left: 18, km: 3 })
    expect(h.load).toHaveBeenCalledTimes(1)
    expect(h.state().unsaved).toEqual(new Map([[MOKOTOW, { done: true, km: 12.4 }]]))
    expect(h.state().save).toEqual({
      phase: 'failed',
      error: { kind: 'other', message: 'The disk said no' },
      journaled: true,
    })
    expect(h.state().saves.get(MOKOTOW)).toBeUndefined()
    // The edit is not lost: it stays noted for the next start as well.
    expect(h.notes.current).toEqual([{ id: MOKOTOW, patch: { done: true, km: 12.4 } }])
  })

  it('takes the waiting edits of other places out of the view too, and does not send them', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(WOLA, { notes: 'Typed meanwhile' }, 'soon')
    await reject(h.sent(0))

    expect(h.state().unsaved).toEqual(
      new Map([
        [MOKOTOW, { done: true }],
        [WOLA, { notes: 'Typed meanwhile' }],
      ]),
    )
    expect(h.place(WOLA).notes).toBe('')
    expect(totals(h.store).done).toBe(0)

    // The pause that was running for the typed edit is called off as well.
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2)
    expect(h.save).toHaveBeenCalledTimes(1)
  })

  it('stops the places still waiting in the same round', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'one' }, 'soon')
    h.store.edit(WOLA, { notes: 'two' }, 'soon')
    h.store.edit(OCHOTA, { notes: 'three' }, 'soon')
    void h.store.flush()
    await land(h.sent(0))
    await reject(h.sent(1))

    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.place(MOKOTOW).notes).toBe('one')
    expect(h.state().saves.get(MOKOTOW)).toBe(1)
    expect(h.state().unsaved).toEqual(
      new Map([
        [WOLA, { notes: 'two' }],
        [OCHOTA, { notes: 'three' }],
      ]),
    )
    expect(h.state().places.get(OCHOTA)?.notes).toBe('')
  })

  it('keeps the newer value when the same field was edited again meanwhile', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'a', km: 5 }, 'now')
    h.store.edit(MOKOTOW, { notes: 'ab' }, 'soon')
    await reject(h.sent(0))

    expect(h.state().unsaved.get(MOKOTOW)).toEqual({ notes: 'ab', km: 5 })
    expect(h.place(MOKOTOW)).toMatchObject({ notes: '', km: null })
  })

  it('has nothing to report when the edit was undone meanwhile', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(MOKOTOW, { done: false }, 'now')
    await reject(h.sent(0))

    // Unticked is what is stored, so no change is unsaved and no warning is due.
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(h.notes.current).toEqual([])
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.place(MOKOTOW).done).toBe(false)
  })

  it('never shows a failed edit in the places, whatever happens next', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    await reject(h.sent(0))
    h.store.edit(MOKOTOW, { km: 5 }, 'soon')
    h.store.edit(WOLA, { done: true }, 'now')

    for (const place of h.state().places.values()) expect(place).toMatchObject({ done: false, km: null })
    expect(totals(h.store)).toEqual({ total: 18, done: 0, left: 18, km: 0 })
  })

  it('says when the phone is out of space', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    await reject(h.sent(0), new DOMException('The quota has been exceeded.', 'QuotaExceededError'))
    expect(h.state().save).toMatchObject({
      phase: 'failed',
      error: { kind: 'storage-full', message: 'The quota has been exceeded.' },
    })
  })

  it('goes by the cause of an error, not by its wording', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    await reject(h.sent(0), new Error('This data was saved by a newer version of Pinezka.'))
    expect(h.state().save).toMatchObject({ phase: 'failed', error: { kind: 'other' } })
  })

  it('reports whatever was thrown, even when it is not an error object', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    await reject(h.sent(0), 'nope')
    expect(h.state().save.error).toEqual({ kind: 'other', message: 'nope' })
  })
})

describe('editing while something is unsaved', () => {
  async function failed() {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    void h.store.flush()
    await reject(h.sent(0))
    h.notified.mockClear()
    return h
  }

  it('adds the edit to the unsaved ones and sends nothing, so the warning stays put', async () => {
    const h = await failed()
    h.store.edit(MOKOTOW, { notes: 'ab' }, 'soon')
    h.store.edit(MOKOTOW, { km: 5 }, 'soon')
    h.store.edit(WOLA, { done: true }, 'now')

    expect(h.state().unsaved).toEqual(
      new Map([
        [MOKOTOW, { notes: 'ab', km: 5 }],
        [WOLA, { done: true }],
      ]),
    )
    expect(h.notes.current).toEqual([
      { id: MOKOTOW, patch: { notes: 'ab', km: 5 } },
      { id: WOLA, patch: { done: true } },
    ])
    expect(h.state().save.phase).toBe('failed')
    expect(h.state().save.error).toMatchObject({ kind: 'other' })

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 3)
    await h.store.flush()
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.state().save.phase).toBe('failed')
    expect(h.place(MOKOTOW)).toMatchObject({ notes: '', km: null })
    expect(h.place(WOLA).done).toBe(false)
  })

  it('sends the failed and the newer values in one save on retry, and clears the warning', async () => {
    const h = await failed()
    h.store.edit(MOKOTOW, { notes: 'ab' }, 'soon')
    h.store.edit(MOKOTOW, { km: 5 }, 'soon')

    h.store.retry()
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.sent(1)).toMatchObject({ id: MOKOTOW, patch: { notes: 'ab', km: 5 } })
    // On its way again: it shows in the places and is no longer "unsaved".
    expect(h.place(MOKOTOW)).toMatchObject({ notes: 'ab', km: 5 })
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toMatchObject({ phase: 'saving', error: null })

    await land(h.sent(1))
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(h.state().saves.get(MOKOTOW)).toBe(1)
    expect(h.notes.current).toEqual([])
    expect(h.db.records.get(MOKOTOW)).toMatchObject({ notes: 'ab', km: 5 })
  })

  it('forgets an unsaved field that is typed back to what is stored', async () => {
    const h = await failed()
    h.store.edit(MOKOTOW, { km: 5 }, 'soon')
    h.store.edit(MOKOTOW, { notes: '' }, 'soon')
    expect(h.state().unsaved.get(MOKOTOW)).toEqual({ km: 5 })
    expect(h.state().save.phase).toBe('failed')

    // The last unsaved field goes: nothing is unsaved any more, so the warning is over.
    h.store.edit(MOKOTOW, { km: null }, 'soon')
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(h.notes.current).toEqual([])
    expect(h.save).toHaveBeenCalledTimes(1)

    // And editing works as usual again.
    h.store.edit(MOKOTOW, { done: true }, 'now')
    expect(h.save).toHaveBeenCalledTimes(2)
  })

  it('gives screens an unsaved patch that the store does not go on changing', async () => {
    const h = await failed()
    const first = h.state().unsaved.get(MOKOTOW)
    h.store.edit(MOKOTOW, { km: 5 }, 'soon')
    expect(first).toEqual({ notes: 'a' })
    expect(h.state().unsaved.get(MOKOTOW)).not.toBe(first)

    const untouched = h.state().unsaved
    h.store.edit(MOKOTOW, { km: 5 }, 'soon')
    expect(h.state().unsaved).toBe(untouched)
    expect(h.notified).toHaveBeenCalledTimes(1)
  })
})

describe('retry and discard', () => {
  it('retry sends every failed edit again, the failed places first', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(WOLA, { notes: 'two' }, 'soon')
    await reject(h.sent(0))

    h.store.retry()
    expect(h.sent(1)).toMatchObject({ id: MOKOTOW, patch: { done: true } })
    await land(h.sent(1))
    expect(h.sent(2)).toMatchObject({ id: WOLA, patch: { notes: 'two' } })
    await land(h.sent(2))

    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(totals(h.store).done).toBe(1)
    expect(h.mostAtOnce()).toBe(1)
  })

  it('a retry that fails again leaves everything unsaved as before', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    await reject(h.sent(0))
    h.store.retry()
    await reject(h.sent(1), new DOMException('Still full', 'QuotaExceededError'))

    expect(h.state().unsaved).toEqual(new Map([[MOKOTOW, { done: true }]]))
    expect(h.state().save).toMatchObject({ phase: 'failed', error: { kind: 'storage-full' } })
    expect(h.place(MOKOTOW).done).toBe(false)
  })

  it('retry does nothing when nothing failed', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    h.store.retry()
    // In particular it does not cut the typing pause short.
    expect(h.save).not.toHaveBeenCalled()
  })

  it('discard gives the failed edits up without reading or writing anything', async () => {
    const h = await ready()
    const before = h.state()
    h.store.edit(MOKOTOW, { done: true, notes: 'gone' }, 'now')
    h.store.edit(WOLA, { km: 5 }, 'soon')
    await reject(h.sent(0))

    h.store.discard()
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(h.notes.current).toEqual([])
    expect(h.place(MOKOTOW)).toBe(before.places.get(MOKOTOW))
    expect(h.place(WOLA)).toBe(before.places.get(WOLA))

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2)
    h.store.retry()
    await h.store.flush()
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.load).toHaveBeenCalledTimes(1)
  })
})

describe('a newer copy of the app has upgraded the data', () => {
  async function blockedStore() {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(WOLA, { notes: 'Typed meanwhile' }, 'soon')
    await reject(h.sent(0), newerVersionError())
    h.notified.mockClear()
    return h
  }

  it('stops saving for good and keeps the edits as unsaved', async () => {
    const h = await blockedStore()
    expect(h.state().save).toEqual({
      phase: 'blocked',
      error: { kind: 'newer-version', message: 'This data was saved by a newer version of Pinezka.' },
      journaled: true,
    })
    expect(h.state().unsaved).toEqual(
      new Map([
        [MOKOTOW, { done: true }],
        [WOLA, { notes: 'Typed meanwhile' }],
      ]),
    )
    expect(h.place(MOKOTOW).done).toBe(false)
    // Kept for the copy that opens after the update.
    expect(h.notes.current).toHaveLength(2)
  })

  it('ignores edits, retry, flush and refresh from then on', async () => {
    const h = await blockedStore()
    const before = h.state()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    h.store.edit(OCHOTA, { done: true }, 'soon')
    h.store.retry()
    await h.store.flush()
    await h.store.refresh()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2)

    expect(h.state()).toBe(before)
    expect(h.notified).not.toHaveBeenCalled()
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.load).toHaveBeenCalledTimes(1)
  })

  it('stays blocked, with its reason, even when the unsaved edits are given up', async () => {
    const h = await blockedStore()
    h.store.discard()
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toMatchObject({ phase: 'blocked', error: { kind: 'newer-version' } })
  })

  it('is blocked even when the edit that met the error had been undone', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    h.store.edit(MOKOTOW, { done: false }, 'now')
    await reject(h.sent(0), newerVersionError())
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toMatchObject({ phase: 'blocked', error: { kind: 'newer-version' } })
  })
})

describe('the journal refusing to store', () => {
  it('is reported for as long as it lasts', async () => {
    const h = await ready()
    expect(h.state().save.journaled).toBe(true)

    h.notes.accepts = false
    h.store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    expect(h.state().save).toEqual({ phase: 'saving', error: null, journaled: false })

    h.notes.accepts = true
    h.store.edit(MOKOTOW, { notes: 'ab' }, 'soon')
    expect(h.state().save.journaled).toBe(true)
  })

  it('is told to the listeners even when nothing else changed', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    await reject(h.sent(0))
    const before = h.state()
    h.notified.mockClear()

    // The same value again: the only news is that the note could not be kept.
    h.notes.accepts = false
    h.store.edit(MOKOTOW, { done: true }, 'now')
    expect(h.state().save).toEqual({ ...before.save, journaled: false })
    expect(h.state().unsaved).toBe(before.unsaved)
    expect(h.state().places).toBe(before.places)
    expect(h.notified).toHaveBeenCalledTimes(1)
  })
})

// ----- More than one open copy of the app -----

describe('refresh', () => {
  it('picks up what another copy saved, and the totals follow', async () => {
    const h = await ready()
    const before = h.state()
    h.db.writeElsewhere(WOLA, { done: true, km: 7 })

    await h.store.refresh()
    expect(h.place(WOLA)).toBe(h.db.records.get(WOLA))
    expect(totals(h.store)).toEqual({ total: 18, done: 1, left: 17, km: 7 })
    expect(h.notified).toHaveBeenCalledTimes(1)
    // Only the changed place is a new object.
    expect(h.place(MOKOTOW)).toBe(before.places.get(MOKOTOW))
    expect(h.save).not.toHaveBeenCalled()
    expect(h.state().saves.size).toBe(0)
    expect(h.state().save.phase).toBe('idle')
  })

  it('changes nothing and tells nobody when the stored records are the same', async () => {
    const h = await ready()
    const before = h.state()
    await h.store.refresh()
    expect(h.load).toHaveBeenCalledTimes(2)
    expect(h.state()).toBe(before)
    expect(h.notified).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('keeps every object when the records it reads are equal copies, as the database hands out', async () => {
    const db = fakeDatabase({ [MOKOTOW]: { done: true, photoIds: ['a', 'b'] } })
    const h = await ready({ db })
    const before = h.state()
    h.load.mockImplementationOnce(async () => {
      return [...db.records.values()].map((record) => ({ ...record, photoIds: [...record.photoIds] }))
    })
    await h.store.refresh()
    expect(h.state()).toBe(before)
    expect(h.notified).not.toHaveBeenCalled()
  })

  it('picks up a change that carries the same time stamp as the record it replaces', async () => {
    const h = await ready()
    const stored = must(h.db.records.get(WOLA))
    h.db.records.set(WOLA, { ...stored, done: true })
    await h.store.refresh()
    expect(h.place(WOLA).done).toBe(true)

    // The photo list counts too, and so does its order.
    h.db.records.set(WOLA, { ...stored, done: true, photoIds: ['a', 'b'] })
    await h.store.refresh()
    expect(h.place(WOLA).photoIds).toEqual(['a', 'b'])
    h.db.records.set(WOLA, { ...stored, done: true, photoIds: ['b', 'a'] })
    await h.store.refresh()
    expect(h.place(WOLA).photoIds).toEqual(['b', 'a'])
    expect(h.notified).toHaveBeenCalledTimes(3)
  })

  it('keeps edits that are waiting in the view, on top of the fresh record', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { notes: 'Being typed' }, 'soon')
    h.db.writeElsewhere(MOKOTOW, { km: 7 })

    await h.store.refresh()
    expect(h.place(MOKOTOW)).toMatchObject({ km: 7, notes: 'Being typed' })
    expect(h.save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'Being typed' })
    await land(h.sent(0))
    expect(h.db.records.get(MOKOTOW)).toMatchObject({ km: 7, notes: 'Being typed' })
  })

  /** Makes the next read hand back what was stored when it started, when the test says so. */
  function holdNextRead(h: Awaited<ReturnType<typeof ready>>): () => void {
    let release = () => {}
    h.load.mockImplementationOnce(() => {
      const snapshot = [...h.db.records.values()]
      return new Promise((resolve) => (release = () => resolve(snapshot)))
    })
    return () => release()
  }

  it('throws its result away when a save started and finished while it was reading', async () => {
    const h = await ready()
    const release = holdNextRead(h)
    const refreshed = h.store.refresh()

    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    await land(h.sent(0))
    release()
    await refreshed

    // The read saw the record from before the save; using it would undo the save on screen.
    expect(h.place(MOKOTOW).km).toBe(5)
    expect(h.place(MOKOTOW)).toBe(h.db.records.get(MOKOTOW))
  })

  it('throws its result away when it arrives while a later save is on its way', async () => {
    const h = await ready()
    const release = holdNextRead(h)
    const refreshed = h.store.refresh()

    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    await land(h.sent(0))
    h.store.edit(WOLA, { done: true }, 'now')
    release()
    await refreshed

    // Mokotów's save has landed; the read is older than it, whatever else is going on.
    expect(h.place(MOKOTOW).km).toBe(5)
    expect(h.place(WOLA).done).toBe(true)
    await land(h.sent(1))
    expect(h.place(MOKOTOW)).toBe(h.db.records.get(MOKOTOW))
    expect(h.place(WOLA)).toBe(h.db.records.get(WOLA))
  })

  it('does not read while a save is on its way', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { done: true }, 'now')
    await h.store.refresh()
    expect(h.load).toHaveBeenCalledTimes(1)
    await land(h.sent(0))

    await h.store.refresh()
    expect(h.load).toHaveBeenCalledTimes(2)
  })

  it('ignores a read that fails', async () => {
    const h = await ready()
    const before = h.state()
    h.load.mockRejectedValueOnce(new Error('cannot read'))
    await h.store.refresh()
    expect(h.state()).toBe(before)
    expect(h.state().status).toBe('ready')
  })

  it('forgets an unsaved edit that another copy has stored in the meantime', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 5, notes: 'Mine' }, 'now')
    await reject(h.sent(0))
    h.db.writeElsewhere(MOKOTOW, { km: 5 })

    await h.store.refresh()
    expect(h.state().unsaved.get(MOKOTOW)).toEqual({ notes: 'Mine' })
    expect(h.state().save.phase).toBe('failed')

    h.db.writeElsewhere(MOKOTOW, { notes: 'Mine' })
    await h.store.refresh()
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(h.save).toHaveBeenCalledTimes(1)
  })

  it('gives an unsaved edit up when another copy has stored a different value for that field', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 5, notes: 'Mine' }, 'now')
    await reject(h.sent(0))
    // Entered in the other copy after this one failed, so 7 is the newer value.
    h.db.writeElsewhere(MOKOTOW, { km: 7 })

    await h.store.refresh()
    expect(h.place(MOKOTOW).km).toBe(7)
    // Only the field the other copy changed is given up.
    expect(h.state().unsaved).toEqual(new Map([[MOKOTOW, { notes: 'Mine' }]]))
    expect(h.state().save.phase).toBe('failed')
    expect(h.notes.current).toEqual([{ id: MOKOTOW, patch: { notes: 'Mine' } }])

    h.store.retry()
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.sent(1)).toMatchObject({ id: MOKOTOW, patch: { notes: 'Mine' } })
    await land(h.sent(1))
    expect(h.db.records.get(MOKOTOW)).toMatchObject({ km: 7, notes: 'Mine' })
  })

  it('keeps an unsaved edit when another copy changed only other fields of the place', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    await reject(h.sent(0))
    h.db.writeElsewhere(MOKOTOW, { notes: 'From the other copy' })
    h.db.writeElsewhere(WOLA, { km: 7 })

    await h.store.refresh()
    expect(h.state().unsaved).toEqual(new Map([[MOKOTOW, { km: 5 }]]))
    expect(h.place(MOKOTOW)).toMatchObject({ km: null, notes: 'From the other copy' })
  })
})

describe('resume, when the app comes back to the front', () => {
  it('only re-reads when nothing is unsaved', async () => {
    const h = await ready()
    h.db.writeElsewhere(WOLA, { done: true })
    await h.store.resume()
    expect(h.place(WOLA).done).toBe(true)
    expect(h.save).not.toHaveBeenCalled()
  })

  it('re-reads first and then tries the unsaved edits again', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    await reject(h.sent(0))
    h.db.writeElsewhere(WOLA, { done: true })

    const resumed = h.store.resume()
    await settle()
    expect(h.place(WOLA).done).toBe(true)
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.sent(1)).toMatchObject({ id: MOKOTOW, patch: { km: 5 } })
    await land(h.sent(1))
    await resumed
    expect(h.state().save.phase).toBe('idle')
    expect(h.db.records.get(MOKOTOW)?.km).toBe(5)
  })

  it('gives its unsaved edits up when another copy has taken them over', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    await reject(h.sent(0))
    // The other copy read this one's note, saved 5, and the user then corrected it to 7 there.
    h.notes.owned = false
    h.db.writeElsewhere(MOKOTOW, { km: 7 })

    await h.store.resume()
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(h.place(MOKOTOW).km).toBe(7)
    // The old 5 was not written over the newer 7.
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.db.records.get(MOKOTOW)?.km).toBe(7)
  })

  it('does not ask who owns the note while nothing is unsaved', async () => {
    const h = await ready()
    h.notes.owned = false
    h.store.edit(MOKOTOW, { notes: 'Being typed' }, 'soon')
    await h.store.resume()
    expect(h.place(MOKOTOW).notes).toBe('Being typed')
    expect(h.state().save.phase).toBe('saving')
  })

  it('works for two copies sharing one database and one localStorage', async () => {
    const db = fakeDatabase()
    const { storage, items } = fakeStorage()

    // Copy A cannot save: the edit stays unsaved and noted under A's key.
    const a = await ready({ db, journal: createEditJournal(() => storage, () => 'a') })
    a.store.edit(MOKOTOW, { km: 5 }, 'now')
    await reject(a.sent(0), new DOMException('Full', 'QuotaExceededError'))
    expect([...items.keys()]).toEqual([`${JOURNAL_PREFIX}a`])

    // Copy B starts, finds the note, saves the edit, and the user corrects it there.
    const b = await ready({ db, journal: createEditJournal(() => storage, () => 'b') })
    expect(b.save).toHaveBeenCalledWith(MOKOTOW, { km: 5 })
    await land(b.sent(0))
    b.store.edit(MOKOTOW, { km: 7 }, 'now')
    await land(b.sent(1))
    expect(items.size).toBe(0)

    // Back in copy A.
    await a.store.resume()
    expect(a.state().unsaved.size).toBe(0)
    expect(a.place(MOKOTOW).km).toBe(7)
    expect(a.save).toHaveBeenCalledTimes(1)
    expect(db.records.get(MOKOTOW)?.km).toBe(7)
  })

  it('does not put an unsaved value over one another copy stored since, while the note is still its own', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    await reject(h.sent(0))
    // The other copy was already open, so it never read this one's note: the
    // note is untouched, and still the user has entered 7 there since.
    h.db.writeElsewhere(MOKOTOW, { km: 7 })

    await h.store.resume()
    await settle()
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.db.records.get(MOKOTOW)?.km).toBe(7)
    expect(h.place(MOKOTOW).km).toBe(7)
    expect(h.state().unsaved.size).toBe(0)
    expect(h.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(h.notes.current).toEqual([])
  })

  it('leaves the unsaved edits alone when it could not read what is stored now', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    await reject(h.sent(0))
    // Entered in another copy since. This copy cannot find that out: its read fails.
    h.db.writeElsewhere(MOKOTOW, { km: 7 })
    h.load.mockRejectedValueOnce(new Error('cannot read'))

    await h.store.resume()
    await settle()
    // Not sent blind: the 7 is still stored, and the edit is still the user's to send or to give up.
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.db.records.get(MOKOTOW)?.km).toBe(7)
    expect(h.state().unsaved).toEqual(new Map([[MOKOTOW, { km: 5 }]]))
    expect(h.state().save.phase).toBe('failed')

    // The next time the read works, and the newer value is seen.
    await h.store.resume()
    await settle()
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.place(MOKOTOW).km).toBe(7)
    expect(h.state().unsaved.size).toBe(0)
  })

  it('sends nothing by itself when the user tried again while it was reading', async () => {
    const h = await ready()
    h.store.edit(MOKOTOW, { km: 5 }, 'now')
    await reject(h.sent(0))
    let finishRead = () => {}
    h.load.mockImplementationOnce(
      () =>
        new Promise<Place[]>((resolve) => {
          finishRead = () => resolve([...h.db.records.values()])
        }),
    )

    const resumed = h.store.resume()
    await settle()
    // "Try again", pressed before the read is back, and the save fails once more.
    h.store.retry()
    await reject(h.sent(1))
    finishRead()
    await resumed
    await settle()

    // The read is older than that try and says nothing about what is stored
    // now, so it is no ground for sending the edit a third time unasked.
    expect(h.save).toHaveBeenCalledTimes(2)
    expect(h.state().unsaved).toEqual(new Map([[MOKOTOW, { km: 5 }]]))
    expect(h.state().save.phase).toBe('failed')
  })

  it('works for two copies when the other one was open before the save failed', async () => {
    const db = fakeDatabase()
    const { storage, items } = fakeStorage()
    const b = await ready({ db, journal: createEditJournal(() => storage, () => 'b') })

    // Copy A cannot save: the edit stays unsaved and noted under A's key.
    const a = await ready({ db, journal: createEditJournal(() => storage, () => 'a') })
    a.store.edit(MOKOTOW, { km: 5 }, 'now')
    await reject(a.sent(0), new DOMException('Full', 'QuotaExceededError'))

    // The user enters the right value in copy B, which has not looked at the notes since it started.
    await b.store.resume()
    b.store.edit(MOKOTOW, { km: 7 }, 'now')
    await land(b.sent(0))
    expect([...items.keys()]).toEqual([`${JOURNAL_PREFIX}a`])

    // Back in copy A.
    await a.store.resume()
    await settle()
    expect(a.save).toHaveBeenCalledTimes(1)
    expect(db.records.get(MOKOTOW)?.km).toBe(7)
    expect(a.place(MOKOTOW).km).toBe(7)
    expect(a.state().unsaved.size).toBe(0)
    expect(a.state().save).toEqual({ phase: 'idle', error: null, journaled: true })
    // Nothing is left for a later start to bring back either.
    expect(items.size).toBe(0)
  })

  it('does not bring an older note back at the next start, over a value another copy saved since', async () => {
    const db = fakeDatabase()
    const { storage, items } = fakeStorage()
    const b = await ready({ db, journal: createEditJournal(() => storage, () => 'b') })

    // Copy A is closed while its save is on its way; the save never lands.
    const a = await ready({ db, journal: createEditJournal(() => storage, () => 'a') })
    a.store.edit(MOKOTOW, { km: 5, notes: 'Typed in A' }, 'now')
    expect([...items.keys()]).toEqual([`${JOURNAL_PREFIX}a`])

    await b.store.resume()
    b.store.edit(MOKOTOW, { km: 7 }, 'now')
    await land(b.sent(0))

    // Any copy that starts now finds A's note.
    const c = await ready({ db, journal: createEditJournal(() => storage, () => 'c') })
    // The note that nobody touched since is still saved; the distance is not.
    expect(c.save).toHaveBeenCalledTimes(1)
    expect(c.save).toHaveBeenCalledWith(MOKOTOW, { notes: 'Typed in A' })
    await land(c.sent(0))
    expect(db.records.get(MOKOTOW)).toMatchObject({ km: 7, notes: 'Typed in A' })
    expect(c.place(MOKOTOW).km).toBe(7)
    expect(items.size).toBe(0)
  })
})

// ----- The real database -----

describe('with the real database', () => {
  const opened: AppDb[] = []

  function realStore(left: JournalEntry[] = []) {
    const { notes, journal } = fakeJournal(left)
    const save = vi.fn<PlaceStoreDeps['save']>(async (id, patch) => updatePlace(await appDb(), id, patch))
    const store = createPlaceStore({
      load: async () => listPlaces(await appDb(), warsawDistricts.id),
      save,
      journal,
    })
    return { store, save, notes }
  }

  function deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('pinezka')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  beforeEach(() => {
    // The in-memory IndexedDB schedules its work with real timers.
    vi.useRealTimers()
  })

  afterEach(async () => {
    for (const db of opened) db.close()
    opened.length = 0
    // Deleting closes the connection appDb() holds, which makes it forget that connection.
    await deleteDatabase()
  })

  it('stores an edit, typed or ticked, by the time flush is done', async () => {
    const { store } = realStore()
    await store.load()
    expect(store.getState().places.size).toBe(18)

    store.edit(MOKOTOW, { done: true, date: '2026-10-12' }, 'now')
    store.edit(MOKOTOW, { km: 12.4, notes: 'Windy' }, 'soon')
    await store.flush()

    const db = await appDb()
    const stored = await getPlace(db, MOKOTOW)
    expect(stored).toMatchObject({ done: true, date: '2026-10-12', km: 12.4, notes: 'Windy' })
    expect(store.getState().places.get(MOKOTOW)).toEqual(stored)
    expect(store.getState().save.phase).toBe('idle')
    expect((await getMeta(db)).lastChangeAt).not.toBeNull()
    expect(progress(warsawDistricts, store.getState().places.values())).toMatchObject({ done: 1, left: 17, km: 12.4 })
  })

  it('writes nothing for an edit equal to what is stored, so it does not count as a change', async () => {
    const { store, save } = realStore([{ id: WOLA, patch: { done: false, notes: '' } }])
    await store.load()
    store.edit(MOKOTOW, { done: false, km: null, notes: '' }, 'now')
    store.edit(MOKOTOW, { notes: 'a' }, 'soon')
    store.edit(MOKOTOW, { notes: '' }, 'soon')
    await store.flush()

    expect(save).not.toHaveBeenCalled()
    expect((await getMeta(await appDb())).lastChangeAt).toBeNull()
  })

  it('saves an edit left in the journal at the next start', async () => {
    const { store, notes } = realStore([{ id: WOLA, patch: { notes: 'Typed just before a reload' } }])
    await store.load()
    await store.flush()

    expect((await getPlace(await appDb(), WOLA))?.notes).toBe('Typed just before a reload')
    expect(notes.current).toEqual([])
  })

  it('recognises the data layer’s own error once a newer copy has upgraded the database', async () => {
    const { store } = realStore()
    await store.load()
    const newer = await openAppDb({ version: 2, migrations: { ...migrations, 2: () => {} } })
    opened.push(newer)

    store.edit(MOKOTOW, { done: true }, 'now')
    await store.flush()

    expect(store.getState().save).toMatchObject({ phase: 'blocked', error: { kind: 'newer-version' } })
    expect(store.getState().save.error?.message).toContain('newer version of Pinezka')
    expect(store.getState().unsaved.get(MOKOTOW)).toEqual({ done: true })
    expect(store.getState().places.get(MOKOTOW)?.done).toBe(false)
    expect(await getPlace(newer, MOKOTOW)).toMatchObject({ done: false })
  })

  it('sees a record another copy wrote, after a refresh', async () => {
    const { store } = realStore()
    await store.load()
    await updatePlace(await appDb(), WOLA, { done: true, km: 7 })
    expect(store.getState().places.get(WOLA)?.done).toBe(false)

    await store.refresh()
    expect(store.getState().places.get(WOLA)).toMatchObject({ done: true, km: 7 })
  })

  it('the app’s own store is wired to the database, and reaches localStorage only when it is used', async () => {
    const { storage, items } = fakeStorage()
    vi.stubGlobal('localStorage', storage)

    expect(placeStore.getState().status).toBe('loading')
    await placeStore.load()
    expect(placeStore.getState().places.size).toBe(18)

    placeStore.edit(OCHOTA, { notes: 'From the real store' }, 'soon')
    expect(items.size).toBe(1)
    expect([...items.keys()][0]).toMatch(/^pinezka:unsaved-edits:/)
    await placeStore.flush()

    expect((await getPlace(await appDb(), OCHOTA))?.notes).toBe('From the real store')
    expect(items.size).toBe(0)
    expect(placeStore.getState().save).toEqual({ phase: 'idle', error: null, journaled: true })
    expect(placeStore.getState().saves.get(OCHOTA)).toBe(1)
  })
})
