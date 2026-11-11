import { forceCloseDatabase } from 'fake-indexeddb'
import { unwrap } from 'idb'
import type { IDBPDatabase } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collections, warsawDistricts } from '../collections/index.ts'
import type { Collection } from '../collections/index.ts'
import {
  addPhoto,
  deletePhoto,
  getMeta,
  getPhoto,
  getPlace,
  isCalendarDate,
  listPhotos,
  listPlaces,
  openAppDb,
  reorderPhotos,
  updatePhoto,
  updatePlace,
} from './db.ts'
import type { AppDb, OpenOptions, PhotoPatch, PlacePatch } from './db.ts'
import { migrations } from './migrations.ts'
import type { UpgradeTransaction } from './migrations.ts'

const BEMOWO = 'warsaw-districts/bemowo'
const WOLA = 'warsaw-districts/wola'
const T1 = '2026-11-10T10:00:00.000Z'
const T2 = '2026-11-11T11:00:00.000Z'
const T3 = '2026-11-12T12:00:00.000Z'

let counter = 0
const opened: AppDb[] = []

function newName(): string {
  counter += 1
  return `pinezka-test-${counter}`
}

async function open(options: OpenOptions = {}): Promise<AppDb> {
  const db = await openAppDb({ name: newName(), ...options })
  opened.push(db)
  return db
}

/** Sets the clock that timestamps come from. Only the date is faked, not timers. */
function at(time: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(time))
}

function jpeg(...bytes: number[]): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, ...bytes, 0xff, 0xd9])], { type: 'image/jpeg' })
}

async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())]
}

afterEach(() => {
  for (const db of opened) db.close()
  opened.length = 0
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('opening the database', () => {
  it('creates the stores and their indexes', async () => {
    const db = await open()
    expect([...db.objectStoreNames]).toEqual(['meta', 'photos', 'places'])
    const tx = db.transaction(['places', 'photos', 'meta'])
    const places = tx.objectStore('places')
    const photos = tx.objectStore('photos')
    const meta = tx.objectStore('meta')
    expect([...places.indexNames]).toEqual(['collectionId'])
    expect([...photos.indexNames]).toEqual(['placeId', 'tripId'])

    // The exact shape is what later versions build on, so it is pinned here.
    expect([places.keyPath, places.autoIncrement]).toEqual(['id', false])
    expect([photos.keyPath, photos.autoIncrement]).toEqual(['id', false])
    expect([meta.keyPath, meta.autoIncrement]).toEqual([null, false])
    const shape = (index: { keyPath: unknown; unique: boolean; multiEntry: boolean }) => [
      index.keyPath,
      index.unique,
      index.multiEntry,
    ]
    expect(shape(places.index('collectionId'))).toEqual(['collectionId', false, false])
    expect(shape(photos.index('placeId'))).toEqual(['placeId', false, false])
    expect(shape(photos.index('tripId'))).toEqual(['tripId', false, false])
  })

  it('writes the meta record on first run', async () => {
    at(T1)
    const db = await open()
    expect(await getMeta(db)).toEqual({
      schemaVersion: 1,
      createdAt: T1,
      lastBackupAt: null,
      lastChangeAt: null,
    })
  })

  it('creates an untouched record for each of the 18 districts', async () => {
    at(T1)
    const db = await open()
    const places = await listPlaces(db, 'warsaw-districts')
    expect(places.map((place) => place.id).sort()).toEqual(
      warsawDistricts.places.map((place) => `warsaw-districts/${place.key}`).sort(),
    )
    for (const place of places) {
      expect(place).toEqual({
        id: place.id,
        collectionId: 'warsaw-districts',
        done: false,
        date: null,
        km: null,
        stravaUrl: '',
        notes: '',
        photoIds: [],
        updatedAt: T1,
      })
    }
  })

  it('keeps everything when the app is opened again', async () => {
    const name = newName()
    at(T1)
    const first = await open({ name })
    at(T2)
    await updatePlace(first, BEMOWO, { done: true, date: '2026-11-08', km: 12.4, notes: 'Fort Bema loop' })
    const photo = await addPhoto(first, { placeId: BEMOWO, image: jpeg(1, 2, 3), thumb: jpeg(4) })
    first.close()

    at(T3)
    const second = await open({ name })
    expect(await getMeta(second)).toEqual({
      schemaVersion: 1,
      createdAt: T1,
      lastBackupAt: null,
      lastChangeAt: T2,
    })
    expect(await getPlace(second, BEMOWO)).toEqual({
      id: BEMOWO,
      collectionId: 'warsaw-districts',
      done: true,
      date: '2026-11-08',
      km: 12.4,
      stravaUrl: '',
      notes: 'Fort Bema loop',
      photoIds: [photo.id],
      updatedAt: T2,
    })
    expect((await getPlace(second, WOLA))?.updatedAt).toBe(T1)
    expect(await listPlaces(second, 'warsaw-districts')).toHaveLength(18)
    const stored = await getPhoto(second, photo.id)
    expect(await bytesOf(stored!.image)).toEqual([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])
  })

  it('puts back a district record that went missing, leaving the others alone', async () => {
    const name = newName()
    at(T1)
    const first = await open({ name })
    await updatePlace(first, WOLA, { done: true })
    await first.delete('places', BEMOWO)
    first.close()

    at(T2)
    const second = await open({ name })
    expect(await listPlaces(second, 'warsaw-districts')).toHaveLength(18)
    expect((await getPlace(second, BEMOWO))?.updatedAt).toBe(T2)
    expect(await getPlace(second, WOLA)).toMatchObject({ done: true, updatedAt: T1 })
  })

  it('upgrades to a later schema version without changing stored records', async () => {
    const name = newName()
    at(T1)
    const first = await open({ name })
    await updatePlace(first, BEMOWO, { done: true, km: 5 })
    const photo = await addPhoto(first, { placeId: BEMOWO, image: jpeg(9), thumb: jpeg(8) })
    const before = await listPlaces(first, 'warsaw-districts')
    first.close()

    // What version 2 of the app is planned to do: add a trips store.
    at(T2)
    const second = await open({
      name,
      version: 2,
      migrations: {
        ...migrations,
        2: (db) => {
          const plain = db as unknown as IDBPDatabase
          plain.createObjectStore('trips', { keyPath: 'id' }).createIndex('placeId', 'placeId')
        },
      },
    })
    expect([...second.objectStoreNames]).toEqual(['meta', 'photos', 'places', 'trips'])
    expect(await listPlaces(second, 'warsaw-districts')).toEqual(before)
    expect(await bytesOf((await getPhoto(second, photo.id))!.image)).toEqual([0xff, 0xd8, 9, 0xff, 0xd9])
    expect(await getMeta(second)).toEqual({
      schemaVersion: 2,
      createdAt: T1,
      lastBackupAt: null,
      lastChangeAt: T1,
    })
  })

  it('fails without touching the data when a migration is missing', async () => {
    const name = newName()
    const first = await open({ name })
    await updatePlace(first, BEMOWO, { done: true })
    first.close()

    await expect(openAppDb({ name, version: 2 })).rejects.toThrow('no migration to schema version 2')

    const again = await open({ name })
    expect(again.version).toBe(1)
    expect(await getPlace(again, BEMOWO)).toMatchObject({ done: true })
  })

  it('rolls a failed migration back completely', async () => {
    const name = newName()
    const first = await open({ name })
    await updatePlace(first, BEMOWO, { km: 4 })
    first.close()

    const broken = {
      ...migrations,
      2: (db: AppDb) => {
        ;(db as unknown as IDBPDatabase).createObjectStore('trips', { keyPath: 'id' })
        db.deleteObjectStore('photos')
        throw new Error('migration went wrong')
      },
    }
    await expect(openAppDb({ name, version: 2, migrations: broken })).rejects.toThrow('migration went wrong')

    const again = await open({ name })
    expect(again.version).toBe(1)
    expect([...again.objectStoreNames]).toEqual(['meta', 'photos', 'places'])
    expect(await getPlace(again, BEMOWO)).toMatchObject({ km: 4 })
    expect((await getMeta(again)).schemaVersion).toBe(1)
  })

  it('rolls back a migration that fails after it has already rewritten records', async () => {
    const name = newName()
    at(T1)
    const first = await open({ name })
    await updatePlace(first, BEMOWO, { km: 4 })
    first.close()

    at(T2)
    const broken = {
      ...migrations,
      2: async (_db: AppDb, tx: UpgradeTransaction) => {
        const store = tx.objectStore('places')
        const place = await store.get(BEMOWO)
        await store.put({ ...place!, km: 999, notes: 'half migrated' })
        throw new Error('migration failed half-way')
      },
    }
    await expect(openAppDb({ name, version: 2, migrations: broken })).rejects.toThrow('migration failed half-way')

    const again = await open({ name })
    expect(again.version).toBe(1)
    expect(await getPlace(again, BEMOWO)).toMatchObject({ km: 4, notes: '', updatedAt: T1 })
    expect((await getMeta(again)).schemaVersion).toBe(1)
  })

  it('keeps the changes of an async migration that succeeds', async () => {
    const name = newName()
    const first = await open({ name })
    await updatePlace(first, BEMOWO, { km: 4 })
    first.close()

    const second = await open({
      name,
      version: 2,
      migrations: {
        ...migrations,
        2: async (_db, tx) => {
          const store = tx.objectStore('places')
          const place = await store.get(BEMOWO)
          await store.put({ ...place!, notes: 'migrated' })
        },
      },
    })
    expect(await getPlace(second, BEMOWO)).toMatchObject({ km: 4, notes: 'migrated' })
    expect((await getMeta(second)).schemaVersion).toBe(2)
  })

  it('keeps the date of the last backup through an edit and an upgrade', async () => {
    const name = newName()
    at(T1)
    const first = await open({ name })
    // Backup arrives in a later milestone; until then the date is set by hand.
    await first.put('meta', { ...(await getMeta(first)), lastBackupAt: T1 }, 'app')
    at(T2)
    await updatePlace(first, BEMOWO, { done: true })
    expect(await getMeta(first)).toEqual({ schemaVersion: 1, createdAt: T1, lastBackupAt: T1, lastChangeAt: T2 })
    first.close()

    at(T3)
    const second = await open({ name, version: 2, migrations: { ...migrations, 2: () => {} } })
    expect(await getMeta(second)).toEqual({ schemaVersion: 2, createdAt: T1, lastBackupAt: T1, lastChangeAt: T2 })
  })

  it('passes on any other failure to open as it is', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('the disk is broken', 'UnknownError')
    })
    const name = newName()
    await expect(openAppDb({ name })).rejects.toThrow('the disk is broken')
    await expect(openAppDb({ name })).rejects.not.toThrow('newer version of Pinezka')
  })

  it('tells its owner when it steps aside or is closed by the browser', async () => {
    const name = newName()
    let steppedAside = 0
    await open({ name, onClosed: () => (steppedAside += 1) })
    expect(steppedAside).toBe(0)
    await open({ name, version: 2, migrations: { ...migrations, 2: () => {} } })
    expect(steppedAside).toBe(1)

    let closedByBrowser = 0
    const other = await open({ onClosed: () => (closedByBrowser += 1) })
    // The cast works around the function's published type, which asks for the class.
    forceCloseDatabase(unwrap(other) as never)
    await vi.waitFor(() => expect(closedByBrowser).toBe(1))
  })

  it('explains itself when the data comes from a newer version of the app', async () => {
    const name = newName()
    const newer = await open({ name, version: 2, migrations: { ...migrations, 2: () => {} } })
    newer.close()

    await expect(openAppDb({ name })).rejects.toThrow('newer version of Pinezka')
  })

  it('steps aside when a newer copy of the app needs to upgrade', async () => {
    const name = newName()
    const old = await open({ name })
    // No close(): the newer copy can only open if the old connection lets go.
    const newer = await open({ name, version: 2, migrations: { ...migrations, 2: () => {} } })
    expect(newer.version).toBe(2)
    await expect(getMeta(old)).rejects.toThrow()
  })
})

describe('places', () => {
  it('saves changed fields and records when', async () => {
    at(T1)
    const db = await open()
    at(T2)
    const saved = await updatePlace(db, BEMOWO, {
      done: true,
      date: '2026-11-08',
      km: 10.5,
      stravaUrl: 'https://www.strava.com/activities/1',
      notes: 'Windy',
    })
    expect(saved).toEqual({
      id: BEMOWO,
      collectionId: 'warsaw-districts',
      done: true,
      date: '2026-11-08',
      km: 10.5,
      stravaUrl: 'https://www.strava.com/activities/1',
      notes: 'Windy',
      photoIds: [],
      updatedAt: T2,
    })
    expect(await getPlace(db, BEMOWO)).toEqual(saved)
    expect((await getMeta(db)).lastChangeAt).toBe(T2)
  })

  it('changes only the fields it is given', async () => {
    const db = await open()
    await updatePlace(db, BEMOWO, { done: true, km: 8, notes: 'first' })
    const saved = await updatePlace(db, BEMOWO, { notes: 'second' })
    expect(saved).toMatchObject({ done: true, km: 8, notes: 'second' })
  })

  it('clears a date and km with null', async () => {
    const db = await open()
    await updatePlace(db, BEMOWO, { date: '2026-01-31', km: 3 })
    const saved = await updatePlace(db, BEMOWO, { date: null, km: null })
    expect(saved).toMatchObject({ date: null, km: null })
  })

  it('does not count saving the same values again as a change', async () => {
    at(T1)
    const db = await open()
    at(T2)
    await updatePlace(db, BEMOWO, { done: true, km: 7 })
    at(T3)
    const saved = await updatePlace(db, BEMOWO, { done: true, km: 7 })
    expect(saved.updatedAt).toBe(T2)
    expect((await getMeta(db)).lastChangeAt).toBe(T2)
  })

  it('saves a patch in which only some of the values are new', async () => {
    at(T1)
    const db = await open()
    at(T2)
    await updatePlace(db, BEMOWO, { done: true, km: 7 })
    at(T3)
    const saved = await updatePlace(db, BEMOWO, { done: true, km: 9 })
    expect(saved).toMatchObject({ done: true, km: 9, updatedAt: T3 })
    expect((await getPlace(db, BEMOWO))?.km).toBe(9)
    expect((await getMeta(db)).lastChangeAt).toBe(T3)
  })

  it('sets values back to off, empty and zero', async () => {
    const db = await open()
    await updatePlace(db, BEMOWO, { done: true, km: 5, notes: 'n', stravaUrl: 'u' })
    const saved = await updatePlace(db, BEMOWO, { done: false, km: 0, notes: '', stravaUrl: '' })
    expect(saved).toMatchObject({ done: false, km: 0, notes: '', stravaUrl: '' })
    expect(await getPlace(db, BEMOWO)).toMatchObject({ done: false, km: 0, notes: '', stravaUrl: '' })
  })

  it('does not count an untouched district as a change', async () => {
    at(T1)
    const db = await open()
    at(T2)
    await updatePlace(db, BEMOWO, { done: false, date: null, km: null, stravaUrl: '', notes: '' })
    expect((await getMeta(db)).lastChangeAt).toBeNull()
  })

  it.each<[string, PlacePatch]>([
    ['a date that does not exist', { date: '2026-02-30' }],
    ['a date in another format', { date: '08.11.2026' }],
    ['a date with a time', { date: '2026-11-08T10:00:00Z' }],
    ['negative km', { km: -1 }],
    ['km that is not a number', { km: Number.NaN }],
    ['endless km', { km: Number.POSITIVE_INFINITY }],
    ['km as text', { km: '5' as unknown as number }],
    ['done as text', { done: 'yes' as unknown as boolean }],
    ['notes that are not text', { notes: 5 as unknown as string }],
    ['a link that is not text', { stravaUrl: null as unknown as string }],
  ])('rejects %s and stores nothing', async (_name, patch) => {
    at(T1)
    const db = await open()
    at(T2)
    await expect(updatePlace(db, BEMOWO, patch)).rejects.toThrow()
    expect((await getPlace(db, BEMOWO))?.updatedAt).toBe(T1)
    expect((await getMeta(db)).lastChangeAt).toBeNull()
  })

  it('never lets a patch replace the id or the photo list', async () => {
    const db = await open()
    const patch = { id: 'other', collectionId: 'other', photoIds: ['x'], notes: 'ok' } as PlacePatch
    const saved = await updatePlace(db, BEMOWO, patch)
    expect(saved).toMatchObject({ id: BEMOWO, collectionId: 'warsaw-districts', photoIds: [], notes: 'ok' })
  })

  it('rejects a place that is in no collection', async () => {
    const db = await open()
    await expect(updatePlace(db, 'warsaw-districts/atlantis', { done: true })).rejects.toThrow('Unknown place')
    await expect(updatePlace(db, 'countries/ES', { notes: 'x' })).rejects.toThrow('Unknown place')
    expect(await listPlaces(db, 'warsaw-districts')).toHaveLength(18)
    expect((await getMeta(db)).lastChangeAt).toBeNull()
  })

  it('gives a place of an unseeded collection its record on the first real edit, not before', async () => {
    const islands: Collection = {
      ...warsawDistricts,
      id: 'test-islands',
      places: [{ key: 'wolin', name: 'Wolin' }],
      seeded: false,
    }
    const all = collections as Collection[]
    all.push(islands)
    try {
      at(T1)
      const db = await open()
      expect(await listPlaces(db, 'test-islands')).toEqual([])

      at(T2)
      // What autosave sends when a screen is opened and left unchanged.
      const untouched = await updatePlace(db, 'test-islands/wolin', {})
      expect(untouched).toMatchObject({ id: 'test-islands/wolin', notes: '', done: false })
      await updatePlace(db, 'test-islands/wolin', { notes: '', done: false, km: null })
      expect(await getPlace(db, 'test-islands/wolin')).toBeUndefined()
      expect((await getMeta(db)).lastChangeAt).toBeNull()

      at(T3)
      await updatePlace(db, 'test-islands/wolin', { notes: 'Ferry from Świnoujście' })
      expect(await getPlace(db, 'test-islands/wolin')).toEqual({
        id: 'test-islands/wolin',
        collectionId: 'test-islands',
        done: false,
        date: null,
        km: null,
        stravaUrl: '',
        notes: 'Ferry from Świnoujście',
        photoIds: [],
        updatedAt: T3,
      })
      expect((await getMeta(db)).lastChangeAt).toBe(T3)
      expect(await listPlaces(db, 'warsaw-districts')).toHaveLength(18)
    } finally {
      all.pop()
    }
  })

  it('lists only the places of the collection asked for', async () => {
    const db = await open()
    expect(await listPlaces(db, 'countries')).toEqual([])
    expect(await getPlace(db, 'countries/ES')).toBeUndefined()
  })
})

describe('calendar dates', () => {
  it.each(['2026-11-08', '2024-02-29', '1999-12-31'])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true)
  })

  it.each(['2025-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '26-11-08', '2026-1-8', '', ' 2026-11-08'])(
    'rejects %j',
    (value) => {
      expect(isCalendarDate(value)).toBe(false)
    },
  )

  it('rejects values that are not text', () => {
    expect(isCalendarDate(20261108)).toBe(false)
    expect(isCalendarDate(null)).toBe(false)
    expect(isCalendarDate(new Date())).toBe(false)
  })
})

describe('photos', () => {
  it('stores a photo byte for byte and adds it to its district', async () => {
    at(T1)
    const db = await open()
    at(T2)
    const image = jpeg(1, 2, 3, 4, 5)
    const thumb = jpeg(6, 7)
    const photo = await addPhoto(db, {
      placeId: BEMOWO,
      image,
      thumb,
      label: 'Fort Bema',
      caption: 'Morning fog',
      favourite: true,
      takenAt: '2026-11-08T07:15:00.000Z',
    })

    expect(photo.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    const stored = await getPhoto(db, photo.id)
    expect(stored).toMatchObject({
      id: photo.id,
      placeId: BEMOWO,
      tripId: null,
      label: 'Fort Bema',
      caption: 'Morning fog',
      favourite: true,
      takenAt: '2026-11-08T07:15:00.000Z',
      createdAt: T2,
    })
    expect(stored!.image).toBeInstanceOf(Blob)
    expect(stored!.image.type).toBe('image/jpeg')
    expect(await bytesOf(stored!.image)).toEqual(await bytesOf(image))
    expect(stored!.thumb.type).toBe('image/jpeg')
    expect(await bytesOf(stored!.thumb)).toEqual(await bytesOf(thumb))

    expect(await getPlace(db, BEMOWO)).toMatchObject({ photoIds: [photo.id], updatedAt: T2 })
    expect((await getMeta(db)).lastChangeAt).toBe(T2)
  })

  it('fills in an empty label, caption and star', async () => {
    const db = await open()
    const photo = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(2) })
    expect(photo).toMatchObject({ label: '', caption: '', favourite: false, takenAt: null, tripId: null })
  })

  it('keeps photos in the order they were added, each under its own district', async () => {
    const db = await open()
    const a = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(1) })
    const other = await addPhoto(db, { placeId: WOLA, image: jpeg(2), thumb: jpeg(2) })
    const b = await addPhoto(db, { placeId: BEMOWO, image: jpeg(3), thumb: jpeg(3) })
    const c = await addPhoto(db, { placeId: BEMOWO, image: jpeg(4), thumb: jpeg(4) })

    expect((await listPhotos(db, BEMOWO)).map((photo) => photo.id)).toEqual([a.id, b.id, c.id])
    expect((await listPhotos(db, WOLA)).map((photo) => photo.id)).toEqual([other.id])
    expect(await listPhotos(db, 'warsaw-districts/ursus')).toEqual([])
    expect(await db.countFromIndex('photos', 'placeId', BEMOWO)).toBe(3)
    expect(await db.countFromIndex('photos', 'tripId')).toBe(0)
  })

  it('rejects a photo for an unknown place or with an empty file, storing nothing', async () => {
    const db = await open()
    const empty = new Blob([], { type: 'image/jpeg' })
    await expect(addPhoto(db, { placeId: 'warsaw-districts/atlantis', image: jpeg(1), thumb: jpeg(1) })).rejects.toThrow(
      'Unknown place',
    )
    await expect(addPhoto(db, { placeId: BEMOWO, image: empty, thumb: jpeg(1) })).rejects.toThrow()
    await expect(addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: empty })).rejects.toThrow()
    await expect(addPhoto(db, { placeId: BEMOWO, image: 'x' as unknown as Blob, thumb: jpeg(1) })).rejects.toThrow()
    expect(await db.count('photos')).toBe(0)
    expect((await getPlace(db, BEMOWO))?.photoIds).toEqual([])
    expect((await getMeta(db)).lastChangeAt).toBeNull()
  })

  it('rolls back every write when the last step of a change fails', async () => {
    at(T1)
    const db = await open()
    // Break the last step of every change: the meta record that records the change.
    await db.delete('meta', 'app')
    at(T2)
    await expect(getMeta(db)).rejects.toThrow('no meta record')

    await expect(updatePlace(db, BEMOWO, { done: true })).rejects.toThrow('no meta record')
    expect(await getPlace(db, BEMOWO)).toMatchObject({ done: false, updatedAt: T1 })

    await expect(addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(1) })).rejects.toThrow('no meta record')
    expect(await db.count('photos')).toBe(0)
    expect(await getPlace(db, BEMOWO)).toMatchObject({ photoIds: [], updatedAt: T1 })
  })

  it('reports a change as failed when its transaction does not commit', async () => {
    at(T1)
    const db = await open()
    // What a full disk does: every request succeeds, then the transaction fails.
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args)
      if (this.name === 'meta') request.addEventListener('success', () => this.transaction.abort())
      return request
    })
    at(T2)
    await expect(updatePlace(db, BEMOWO, { done: true })).rejects.toThrow()
    await expect(addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(1) })).rejects.toThrow()
    vi.restoreAllMocks()

    expect(await getPlace(db, BEMOWO)).toMatchObject({ done: false, photoIds: [], updatedAt: T1 })
    expect(await db.count('photos')).toBe(0)
    expect((await getMeta(db)).lastChangeAt).toBeNull()
  })

  it('stores nothing new when the photo itself cannot be stored', async () => {
    at(T1)
    const db = await open()
    const id = '00000000-0000-4000-8000-000000000001'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(id)
    at(T2)
    await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(1) })
    at(T3)
    // The same id again: the photo cannot be stored, so its district must not list it twice.
    await expect(addPhoto(db, { placeId: BEMOWO, image: jpeg(2), thumb: jpeg(2) })).rejects.toThrow()

    expect(await getPlace(db, BEMOWO)).toMatchObject({ photoIds: [id], updatedAt: T2 })
    expect(await bytesOf((await getPhoto(db, id))!.image)).toEqual([0xff, 0xd8, 1, 0xff, 0xd9])
    expect((await getMeta(db)).lastChangeAt).toBe(T2)
  })

  it('stars, labels and captions a photo', async () => {
    at(T1)
    const db = await open()
    const photo = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(2) })
    at(T2)
    const saved = await updatePhoto(db, photo.id, { favourite: true, label: 'Lotnisko', caption: 'Runway' })
    expect(saved).toMatchObject({ favourite: true, label: 'Lotnisko', caption: 'Runway', createdAt: T1 })
    const stored = await getPhoto(db, photo.id)
    expect(stored).toMatchObject({ favourite: true, label: 'Lotnisko', caption: 'Runway' })
    expect(await bytesOf(stored!.image)).toEqual([0xff, 0xd8, 1, 0xff, 0xd9])
    expect((await getMeta(db)).lastChangeAt).toBe(T2)
  })

  it('does not count saving the same photo details again as a change', async () => {
    at(T1)
    const db = await open()
    const photo = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(2), label: 'Fort' })
    at(T2)
    await updatePhoto(db, photo.id, { label: 'Fort', favourite: false })
    expect((await getMeta(db)).lastChangeAt).toBe(T1)
  })

  it('saves photo details in which only some of the values are new', async () => {
    at(T1)
    const db = await open()
    const photo = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(2), label: 'Fort' })
    at(T2)
    await updatePhoto(db, photo.id, { label: 'Fort', caption: 'new' })
    expect(await getPhoto(db, photo.id)).toMatchObject({ label: 'Fort', caption: 'new' })
    expect((await getMeta(db)).lastChangeAt).toBe(T2)
  })

  it('takes a star off and empties a label and caption', async () => {
    const db = await open()
    const photo = await addPhoto(db, {
      placeId: BEMOWO,
      image: jpeg(1),
      thumb: jpeg(2),
      favourite: true,
      label: 'l',
      caption: 'c',
    })
    await updatePhoto(db, photo.id, { favourite: false, label: '', caption: '' })
    expect(await getPhoto(db, photo.id)).toMatchObject({ favourite: false, label: '', caption: '' })
  })

  it('rejects bad photo details and unknown photos', async () => {
    const db = await open()
    const photo = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(2) })
    await expect(updatePhoto(db, 'missing', { favourite: true })).rejects.toThrow('Unknown photo')
    await expect(updatePhoto(db, photo.id, { favourite: 1 as unknown as boolean })).rejects.toThrow()
    await expect(updatePhoto(db, photo.id, { label: null as unknown as string })).rejects.toThrow()
    await expect(updatePhoto(db, photo.id, { caption: 7 as unknown as string })).rejects.toThrow()
  })

  it('never lets a patch replace the image or move the photo', async () => {
    const db = await open()
    const photo = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(2) })
    const patch = { placeId: WOLA, image: jpeg(9), id: 'other', label: 'ok' } as PhotoPatch
    const saved = await updatePhoto(db, photo.id, patch)
    expect(saved).toMatchObject({ id: photo.id, placeId: BEMOWO, label: 'ok' })
    expect(await bytesOf(saved.image)).toEqual([0xff, 0xd8, 1, 0xff, 0xd9])
  })

  it('deletes a photo and takes it off its district', async () => {
    at(T1)
    const db = await open()
    const a = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(1) })
    const b = await addPhoto(db, { placeId: BEMOWO, image: jpeg(2), thumb: jpeg(2) })
    const c = await addPhoto(db, { placeId: BEMOWO, image: jpeg(3), thumb: jpeg(3) })
    at(T2)
    await deletePhoto(db, b.id)

    expect(await getPhoto(db, b.id)).toBeUndefined()
    expect(await getPlace(db, BEMOWO)).toMatchObject({ photoIds: [a.id, c.id], updatedAt: T2 })
    expect(await db.count('photos')).toBe(2)
    expect((await getMeta(db)).lastChangeAt).toBe(T2)
  })

  it('does nothing when asked to delete a photo that is not there', async () => {
    at(T1)
    const db = await open()
    at(T2)
    await deletePhoto(db, 'missing')
    expect((await getMeta(db)).lastChangeAt).toBeNull()
  })

  it('saves a new photo order', async () => {
    // Ids fall while the clock rises, so neither id order nor time order is the saved order.
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    at(T1)
    const db = await open()
    const a = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(1) })
    at(T2)
    const b = await addPhoto(db, { placeId: BEMOWO, image: jpeg(2), thumb: jpeg(2) })
    const c = await addPhoto(db, { placeId: BEMOWO, image: jpeg(3), thumb: jpeg(3) })
    expect((await listPhotos(db, BEMOWO)).map((photo) => photo.id)).toEqual([a.id, b.id, c.id])
    at(T3)
    const saved = await reorderPhotos(db, BEMOWO, [b.id, c.id, a.id])

    expect(saved).toMatchObject({ photoIds: [b.id, c.id, a.id], updatedAt: T3 })
    expect((await listPhotos(db, BEMOWO)).map((photo) => photo.id)).toEqual([b.id, c.id, a.id])
    expect((await getMeta(db)).lastChangeAt).toBe(T3)
  })

  it('skips a listed photo whose record is missing', async () => {
    const db = await open()
    const a = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(1) })
    const place = (await getPlace(db, BEMOWO))!
    await db.put('places', { ...place, photoIds: ['gone', a.id] })
    expect((await listPhotos(db, BEMOWO)).map((photo) => photo.id)).toEqual([a.id])
  })

  it('does not count saving the same order again as a change', async () => {
    at(T1)
    const db = await open()
    const a = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(1) })
    const b = await addPhoto(db, { placeId: BEMOWO, image: jpeg(2), thumb: jpeg(2) })
    at(T2)
    const saved = await reorderPhotos(db, BEMOWO, [a.id, b.id])
    expect(saved.updatedAt).toBe(T1)
    expect((await getMeta(db)).lastChangeAt).toBe(T1)
  })

  it('rejects an order that drops, adds or repeats a photo', async () => {
    at(T1)
    const db = await open()
    const a = await addPhoto(db, { placeId: BEMOWO, image: jpeg(1), thumb: jpeg(1) })
    const b = await addPhoto(db, { placeId: BEMOWO, image: jpeg(2), thumb: jpeg(2) })
    at(T2)
    await expect(reorderPhotos(db, BEMOWO, [a.id])).rejects.toThrow('exactly once')
    await expect(reorderPhotos(db, BEMOWO, [a.id, b.id, 'extra'])).rejects.toThrow('exactly once')
    await expect(reorderPhotos(db, BEMOWO, [a.id, a.id])).rejects.toThrow('exactly once')
    await expect(reorderPhotos(db, BEMOWO, [a.id, 'other'])).rejects.toThrow('exactly once')
    await expect(reorderPhotos(db, 'warsaw-districts/atlantis', [])).rejects.toThrow('Unknown place')

    expect(await getPlace(db, BEMOWO)).toMatchObject({ photoIds: [a.id, b.id], updatedAt: T1 })
    expect((await getMeta(db)).lastChangeAt).toBe(T1)
  })
})
