import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditJournal, JOURNAL_PREFIX } from './edit-journal.ts'
import type { JournalEntry, JournalStorage } from './edit-journal.ts'

const MOKOTOW = 'warsaw-districts/mokotow'
const WOLA = 'warsaw-districts/wola'

/** A stand-in for localStorage that counts what is done to it. */
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

function note(edits: unknown, at = 1000, v: unknown = 1): string {
  return JSON.stringify({ v, at, edits })
}

function at(time: number): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(time)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('keeping unconfirmed edits', () => {
  it('hands the edits of one page load to the next', () => {
    const { storage } = fakeStorage()
    const edits: JournalEntry[] = [
      { id: MOKOTOW, patch: { done: true, date: '2026-10-12', km: 12.4, stravaUrl: 'https://strava.app.link/a', notes: 'Wet\nand windy' } },
      { id: WOLA, patch: { date: null, km: null, notes: '' } },
    ]
    expect(createEditJournal(() => storage, () => 'first').write(edits)).toBe(true)

    expect(createEditJournal(() => storage, () => 'second').read()).toEqual(edits)
  })

  it('writes one versioned, dated note under a key of its own', () => {
    at(1_800_000_000_000)
    const { storage, items } = fakeStorage()
    createEditJournal(() => storage, () => 'abc').write([{ id: MOKOTOW, patch: { km: 12.4 } }])

    expect([...items.keys()]).toEqual([`${JOURNAL_PREFIX}abc`])
    expect(JSON.parse(items.get(`${JOURNAL_PREFIX}abc`) ?? '')).toEqual({
      v: 1,
      at: 1_800_000_000_000,
      edits: [{ id: MOKOTOW, patch: { km: 12.4 } }],
    })
    expect(JOURNAL_PREFIX).toBe('pinezka:unsaved-edits:')
  })

  it('keeps what each edit was made on next to it, in the same version of the note', () => {
    at(1_800_000_000_000)
    const { storage, items } = fakeStorage()
    const edits: JournalEntry[] = [
      {
        id: MOKOTOW,
        patch: { done: true, date: '2026-10-12', km: 12.4, stravaUrl: 'https://strava.app.link/a', notes: 'Wet' },
        base: { done: false, date: null, km: null, stravaUrl: '', notes: '' },
      },
      { id: WOLA, patch: { km: 6, notes: 'b' }, base: { km: 5 } },
      { id: WOLA, patch: { done: true } },
    ]
    createEditJournal(() => storage, () => 'first').write(edits)

    expect(JSON.parse(items.get(`${JOURNAL_PREFIX}first`) ?? '')).toEqual({ v: 1, at: 1_800_000_000_000, edits })
    const read = createEditJournal(() => storage, () => 'second').read()
    expect(read).toEqual(edits)
    expect(read[2]).not.toHaveProperty('base')
  })

  it('writes again when only what an edit was made on has changed', () => {
    const { storage, calls } = fakeStorage()
    const journal = createEditJournal(() => storage, () => 'a')
    journal.write([{ id: MOKOTOW, patch: { km: 6 }, base: { km: null } }])
    journal.write([{ id: MOKOTOW, patch: { km: 6 }, base: { km: 5 } }])
    expect(calls.setItem).toBe(2)
    expect(createEditJournal(() => storage, () => 'b').read()).toEqual([
      { id: MOKOTOW, patch: { km: 6 }, base: { km: 5 } },
    ])
  })

  it('gives every page load a different key unless told otherwise', () => {
    const { storage, items } = fakeStorage()
    createEditJournal(() => storage).write([{ id: MOKOTOW, patch: { done: true } }])
    createEditJournal(() => storage).write([{ id: MOKOTOW, patch: { done: true } }])

    const keys = [...items.keys()]
    expect(keys).toHaveLength(2)
    for (const key of keys) expect(key).toMatch(/^pinezka:unsaved-edits:[0-9a-f-]{36}$/)
  })

  it('removes its key when nothing is left to confirm', () => {
    const { storage, items, calls } = fakeStorage()
    const journal = createEditJournal(() => storage, () => 'a')
    journal.write([{ id: MOKOTOW, patch: { done: true } }])

    expect(journal.write([])).toBe(true)
    expect(items.size).toBe(0)
    expect(calls).toEqual({ setItem: 1, removeItem: 1 })
  })

  it('does not touch storage while there has never been anything to keep', () => {
    const { storage, calls } = fakeStorage()
    const journal = createEditJournal(() => storage, () => 'a')

    expect(journal.write([])).toBe(true)
    expect(journal.write([])).toBe(true)
    expect(calls).toEqual({ setItem: 0, removeItem: 0 })
  })

  it('does not write the same edits twice', () => {
    at(1000)
    const { storage, calls } = fakeStorage()
    const journal = createEditJournal(() => storage, () => 'a')
    journal.write([{ id: MOKOTOW, patch: { notes: 'a' } }])
    // Later, so only the comparison of the edits can stop the second write.
    vi.setSystemTime(2000)
    expect(journal.write([{ id: MOKOTOW, patch: { notes: 'a' } }])).toBe(true)
    expect(calls.setItem).toBe(1)

    journal.write([{ id: MOKOTOW, patch: { notes: 'ab' } }])
    expect(calls.setItem).toBe(2)

    // After the key was emptied, the same edits are new again.
    journal.write([])
    journal.write([{ id: MOKOTOW, patch: { notes: 'ab' } }])
    expect(calls.setItem).toBe(3)
  })

  it('ignores what else is stored on the same origin', () => {
    const { storage, items } = fakeStorage({ 'other-app': 'x', 'pinezka:theme': 'dark' })
    const journal = createEditJournal(() => storage, () => 'a')
    expect(journal.read()).toEqual([])
    journal.write([{ id: MOKOTOW, patch: { done: true } }])
    journal.write([])
    expect(Object.fromEntries(items)).toEqual({ 'other-app': 'x', 'pinezka:theme': 'dark' })
  })
})

describe('reading notes back', () => {
  function readOne(text: string): JournalEntry[] {
    const { storage } = fakeStorage({ [`${JOURNAL_PREFIX}old`]: text })
    return createEditJournal(() => storage, () => 'new').read()
  }

  it.each<[string, string]>([
    ['text that is not JSON', '{"v":1,"at":1,"edits":['],
    ['an empty value', ''],
    ['a bare list', JSON.stringify([{ id: MOKOTOW, patch: { done: true } }])],
    ['null', 'null'],
    ['another version', note([{ id: MOKOTOW, patch: { done: true } }], 1000, 2)],
    ['no version', JSON.stringify({ at: 1, edits: [{ id: MOKOTOW, patch: { done: true } }] })],
    ['a version written as text', note([{ id: MOKOTOW, patch: { done: true } }], 1000, '1')],
    ['no time', JSON.stringify({ v: 1, edits: [{ id: MOKOTOW, patch: { done: true } }] })],
    ['a time that is not a number', note([{ id: MOKOTOW, patch: { done: true } }], 'now' as never)],
    ['edits that are not a list', note({ id: MOKOTOW, patch: { done: true } })],
  ])('drops a note holding %s', (_what, text) => {
    expect(readOne(text)).toEqual([])
  })

  it.each<[string, unknown]>([
    ['a place the app does not know', { id: 'warsaw-districts/atlantis', patch: { done: true } }],
    ['a collection the app does not know', { id: 'countries/ES', patch: { notes: 'x' } }],
    ['no place id', { patch: { done: true } }],
    ['a field the user cannot edit', { id: MOKOTOW, patch: { photoIds: [] } }],
    ['an unknown field next to a good one', { id: MOKOTOW, patch: { done: true, colour: 'red' } }],
    ['a tick that is not true or false', { id: MOKOTOW, patch: { done: 'yes' } }],
    ['a tick that is null', { id: MOKOTOW, patch: { done: null } }],
    ['a day that does not exist', { id: MOKOTOW, patch: { date: '2026-02-30' } }],
    ['a date in another format', { id: MOKOTOW, patch: { date: '12.10.2026' } }],
    ['a date that is a number', { id: MOKOTOW, patch: { date: 20261012 } }],
    ['a negative distance', { id: MOKOTOW, patch: { km: -1 } }],
    ['a distance written as text', { id: MOKOTOW, patch: { km: '12.4' } }],
    ['a link that is not text', { id: MOKOTOW, patch: { stravaUrl: null } }],
    ['notes that are not text', { id: MOKOTOW, patch: { notes: 7 } }],
    ['no fields at all', { id: MOKOTOW, patch: {} }],
    ['no patch', { id: MOKOTOW }],
    ['a patch that is a list', { id: MOKOTOW, patch: [true] }],
    ['something that is not an entry', 'done'],
  ])('drops an edit with %s', (_what, entry) => {
    expect(readOne(note([entry]))).toEqual([])
  })

  it('drops a distance that is not a finite number', () => {
    // JSON cannot hold Infinity, but a number too large to read becomes it.
    expect(readOne(`{"v":1,"at":1,"edits":[{"id":"${MOKOTOW}","patch":{"km":1e999}}]}`)).toEqual([])
  })

  it('keeps the good edits of a note that also holds a bad one', () => {
    const good = { id: WOLA, patch: { km: 0, date: null, notes: '' } }
    expect(readOne(note([{ id: MOKOTOW, patch: { km: -1 } }, good, 'junk']))).toEqual([good])
  })

  // What an edit was made on is extra knowledge. Without it the edit is
  // still the user's, so it is handed over as a note that never had any.
  it.each<[string, unknown]>([
    ['text', 'null'],
    ['a list', [null]],
    ['null', null],
    ['no fields', {}],
    ['a value of the wrong kind', { km: '5' }],
    ['a wrong value next to a good one', { km: 5, notes: 7 }],
    ['a field the user cannot edit', { km: 5, updatedAt: 'x' }],
    ['a day that does not exist', { date: '2026-02-30' }],
  ])('keeps an edit, without what it was made on, when that is %s', (_what, base) => {
    const read = readOne(note([{ id: MOKOTOW, patch: { km: 6, notes: 'a' }, base }]))
    expect(read).toEqual([{ id: MOKOTOW, patch: { km: 6, notes: 'a' } }])
    expect(read[0]).not.toHaveProperty('base')
  })

  it('still drops an edit with a bad patch, whatever it says it was made on', () => {
    expect(readOne(note([{ id: MOKOTOW, patch: { km: -1 }, base: { km: null } }]))).toEqual([])
  })

  it('reads the notes of every other page load, oldest first', () => {
    // Stored in the opposite order, to show the time decides and not the key.
    const { storage } = fakeStorage({
      [`${JOURNAL_PREFIX}c`]: note([{ id: MOKOTOW, patch: { notes: 'newest' } }], 3000),
      [`${JOURNAL_PREFIX}a`]: note([{ id: MOKOTOW, patch: { notes: 'oldest', km: 5 } }], 1000),
      [`${JOURNAL_PREFIX}b`]: note([{ id: WOLA, patch: { done: true } }], 2000),
    })

    expect(createEditJournal(() => storage, () => 'new').read()).toEqual([
      { id: MOKOTOW, patch: { notes: 'oldest', km: 5 } },
      { id: WOLA, patch: { done: true } },
      { id: MOKOTOW, patch: { notes: 'newest' } },
    ])
  })

  it('does not read back what this page load wrote itself', () => {
    const { storage } = fakeStorage()
    const journal = createEditJournal(() => storage, () => 'a')
    journal.write([{ id: MOKOTOW, patch: { done: true } }])
    expect(journal.read()).toEqual([])
  })
})

describe('several copies of the app', () => {
  it('lets two page loads keep their edits side by side', () => {
    const { storage, items } = fakeStorage()
    const first = createEditJournal(() => storage, () => 'first')
    const second = createEditJournal(() => storage, () => 'second')

    first.write([{ id: MOKOTOW, patch: { km: 5 } }])
    second.write([{ id: WOLA, patch: { done: true } }])
    expect(items.size).toBe(2)

    // The second one finishing its saves leaves the first one's note alone.
    second.write([])
    expect([...items.keys()]).toEqual([`${JOURNAL_PREFIX}first`])
    expect(createEditJournal(() => storage, () => 'third').read()).toEqual([{ id: MOKOTOW, patch: { km: 5 } }])
  })

  it('removes the notes it read with its first write, and not before', () => {
    const { storage, items, calls } = fakeStorage({
      [`${JOURNAL_PREFIX}old-1`]: note([{ id: MOKOTOW, patch: { km: 5 } }], 1000),
      [`${JOURNAL_PREFIX}old-2`]: note([{ id: WOLA, patch: { done: true } }], 2000),
    })
    const journal = createEditJournal(() => storage, () => 'new')

    const edits = journal.read()
    expect(items.size).toBe(2)
    expect(calls).toEqual({ setItem: 0, removeItem: 0 })

    journal.write(edits)
    expect([...items.keys()]).toEqual([`${JOURNAL_PREFIX}new`])
  })

  it('removes the notes it read even when their edits turned out to be stored already', () => {
    const { storage, items } = fakeStorage({ [`${JOURNAL_PREFIX}old`]: note([{ id: MOKOTOW, patch: { km: 5 } }]) })
    const journal = createEditJournal(() => storage, () => 'new')
    journal.read()
    journal.write([])
    expect(items.size).toBe(0)
  })

  it('never touches a note that appeared after it read', () => {
    const { storage, items } = fakeStorage({ [`${JOURNAL_PREFIX}old`]: note([{ id: MOKOTOW, patch: { km: 5 } }]) })
    const journal = createEditJournal(() => storage, () => 'new')
    journal.read()
    const later = createEditJournal(() => storage, () => 'later')
    later.write([{ id: WOLA, patch: { notes: 'mine' } }])

    journal.write([{ id: MOKOTOW, patch: { km: 5 } }])
    journal.write([{ id: MOKOTOW, patch: { km: 6 } }])
    journal.write([])
    expect([...items.keys()]).toEqual([`${JOURNAL_PREFIX}later`])
    expect(later.owned()).toBe(true)
  })

  it('cleans up a note nobody can read, but leaves one from a newer version of the app', () => {
    const newer = note([{ id: MOKOTOW, patch: { done: true } }], 1000, 2)
    const { storage, items } = fakeStorage({
      [`${JOURNAL_PREFIX}broken`]: 'not json',
      [`${JOURNAL_PREFIX}newer`]: newer,
    })
    const journal = createEditJournal(() => storage, () => 'new')
    expect(journal.read()).toEqual([])
    journal.write([])
    expect(Object.fromEntries(items)).toEqual({ [`${JOURNAL_PREFIX}newer`]: newer })
  })

  it('keeps the notes it read when its own write is refused', () => {
    const old = note([{ id: MOKOTOW, patch: { km: 5 } }])
    const { storage, items } = fakeStorage({ [`${JOURNAL_PREFIX}old`]: old })
    let full = true
    const guarded: JournalStorage = {
      ...storage,
      get length() {
        return storage.length
      },
      setItem(name, value) {
        if (full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        storage.setItem(name, value)
      },
    }
    const journal = createEditJournal(() => guarded, () => 'new')

    const edits = journal.read()
    expect(journal.write(edits)).toBe(false)
    // Still on disk: otherwise the edits would exist in this page's memory only.
    expect(Object.fromEntries(items)).toEqual({ [`${JOURNAL_PREFIX}old`]: old })

    full = false
    expect(journal.write(edits)).toBe(true)
    expect([...items.keys()]).toEqual([`${JOURNAL_PREFIX}new`])
  })

  it('knows whether its note is still its own', () => {
    const { storage, items } = fakeStorage()
    const journal = createEditJournal(() => storage, () => 'mine')
    // Nothing written, nothing that could have been taken over.
    expect(journal.owned()).toBe(true)

    journal.write([{ id: MOKOTOW, patch: { km: 5 } }])
    expect(journal.owned()).toBe(true)

    // Another copy starts, reads the note and takes the edits over.
    const other = createEditJournal(() => storage, () => 'other')
    const taken = other.read()
    other.write(taken)
    expect(journal.owned()).toBe(false)

    // Writing the same edits again does not bring the note back, so the answer stays.
    journal.write([{ id: MOKOTOW, patch: { km: 5 } }])
    expect(journal.owned()).toBe(false)
    expect(items.has(`${JOURNAL_PREFIX}mine`)).toBe(false)

    // With nothing left to confirm there is nothing to own or lose.
    journal.write([])
    expect(journal.owned()).toBe(true)
  })

  it('does not own a note that someone changed', () => {
    const { storage, items } = fakeStorage()
    const journal = createEditJournal(() => storage, () => 'mine')
    journal.write([{ id: MOKOTOW, patch: { km: 5 } }])
    items.set(`${JOURNAL_PREFIX}mine`, note([{ id: MOKOTOW, patch: { km: 6 } }]))
    expect(journal.owned()).toBe(false)
  })
})

describe('a browser that will not store', () => {
  it('is not asked for storage until the journal is used', () => {
    let asked = 0
    createEditJournal(() => {
      asked += 1
      throw new Error('blocked')
    })
    expect(asked).toBe(0)
  })

  it('reports that nothing could be kept when storage is blocked', () => {
    const journal = createEditJournal(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    expect(journal.read()).toEqual([])
    expect(journal.write([{ id: MOKOTOW, patch: { done: true } }])).toBe(false)
    // Unknown is not "taken over by another copy".
    expect(journal.owned()).toBe(true)
  })

  it('reads nothing when looking through storage fails', () => {
    const { storage } = fakeStorage({ [`${JOURNAL_PREFIX}old`]: note([{ id: MOKOTOW, patch: { km: 5 } }]) })
    const broken: JournalStorage = {
      ...storage,
      get length() {
        return storage.length
      },
      getItem() {
        throw new Error('unreadable')
      },
    }
    expect(createEditJournal(() => broken, () => 'new').read()).toEqual([])
  })

  it('clears its key when a write is refused, so an older value cannot come back', () => {
    const { storage, items } = fakeStorage()
    let full = false
    const guarded: JournalStorage = {
      ...storage,
      get length() {
        return storage.length
      },
      setItem(name, value) {
        if (full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        storage.setItem(name, value)
      },
    }
    const journal = createEditJournal(() => guarded, () => 'a')
    expect(journal.write([{ id: MOKOTOW, patch: { notes: 'short' } }])).toBe(true)

    full = true
    expect(journal.write([{ id: MOKOTOW, patch: { notes: 'a much longer note' } }])).toBe(false)
    expect(items.size).toBe(0)
    // Nobody took the note over; it simply could not be written.
    expect(journal.owned()).toBe(true)

    // The refused text is not remembered as written: the same edits are tried again.
    full = false
    expect(journal.write([{ id: MOKOTOW, patch: { notes: 'a much longer note' } }])).toBe(true)
    expect(createEditJournal(() => storage, () => 'b').read()).toEqual([
      { id: MOKOTOW, patch: { notes: 'a much longer note' } },
    ])
  })

  it('survives storage that fails even while cleaning up', () => {
    const broken: JournalStorage = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem() {
        throw new Error('no')
      },
      removeItem() {
        throw new Error('no')
      },
    }
    const journal = createEditJournal(() => broken, () => 'a')
    expect(journal.write([{ id: MOKOTOW, patch: { done: true } }])).toBe(false)
    expect(journal.write([])).toBe(true)
  })
})
